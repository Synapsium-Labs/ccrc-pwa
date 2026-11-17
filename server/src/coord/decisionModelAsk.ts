// Overlord W2, the server's one caller of the decision model (spec 2026-11-09 §3.7 H6, §7.1 H24; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 5). Ring: L4, context Coordination (C5). It gathers
// before an act's transaction, never inside one, and decides nothing itself: every branch is an answer of
// `decisionModel.ts` (L1). Nothing calls it in PR A: PR B builds its deps in `index.ts` and hands them on as `deps.decisions`.
//
// ONE CALLER. This is the only code that calls `DecisionModel.ask` (Global Constraints). The anchor-set lane (PR B) calls it
// too, with `fresh: true` and `kind: 'maintain'`, and nothing else does.
//
// EVERY ATTEMPT IS COUNTED BEFORE IT IS MADE. Each request's rows are planned and reserved in one transaction of the store
// (`DecisionAskStore.reserve`), so concurrent gathers see each other's reservations, and each reservation is settled to the
// attempts the port reports, success or failure. A count that cannot be read plans `over-ceiling`.
//
// ONE HOST SNAPSHOT PER CALL (question 1, review 2262 F9). The host is read once, every row is planned with it, and an
// adapter `modelFor` builds for another kind or origin is refused (`unavailable`, `host-changed`) before any request; one whose
// endpoint does not parse answers `endpoint-unparseable` (review 2324 F4).
//
// ONE STATE PER REQUEST (review 2324 F1). Rows are split into requests by their `askedWith` group and their state
// (`decisionModel.ts#decisionRequestGroups`), and the egress screen, the record key, the size and the request all read that
// one state, so no row is screened on one state and sent with another.
//
// NO RESERVATION OUTLIVES A THROW (review 2324 F3). Anything that throws after the reservation settles it to 0 attempts
// first, then the throw goes on; a settle the store could not write is logged.
import {
  DECISION_QUESTIONS, DECISION_RESERVE_PER_REQUEST,
  type DecisionCheck, type DecisionHostKind, type DecisionRowId, type DecisionRowSide,
} from '../../../shared/decisionModel.js';
import type { TimePorts } from '../time/ports.js';
import {
  decisionCallMiss, decisionDayOf, decisionInlineOf, decisionLineGen, decisionMissCheck, decisionTexts, egressWordOf,
  decisionRequestGroups, encodeDecisionRequest, planDecision, readDecisionAnswers, sameDecisionHost,
  type DecisionEgressWord, type DecisionFields, type RowPlan,
} from './decisionModel.js';
import type { DecisionAskStore, DecisionModel, DecisionRecordRead } from './decisionModelPort.js';

/** Opaque ids drawn per request: enough for six candidates, `none`, three question keys and a swapped pair. */
const OPAQUE_IDS = 16;

export interface DecisionAskDeps {
  /** The records and day counts (`decisionModelStore.ts#decisionAskStore`). */
  store: DecisionAskStore;
  time: TimePorts;
  /** PR A: always DECISION_ROW_DEFAULT. */
  arming(row: DecisionRowId): DecisionRowSide;
  /** PR A: always null. */
  currentLine(row: DecisionRowId): { id: number; line: number } | null;
  host(): { kind: DecisionHostKind; endpoint: string; origin: string; modelId: string } | null;
  keySet(): boolean;
  /** One adapter per call, bound to the host snapshot the call planned with (question 1, review 2262 F9). */
  modelFor(host: { kind: DecisionHostKind; endpoint: string }): DecisionModel;
  /** The hosted egress screen (question 9). PR B wires it. */
  egress(texts: readonly string[]): 'clear' | 'hit' | 'no-list' | 'unreadable';
  /** SHA-256 of a row's canonical state, hex, from `index.ts`. */
  stateHash(state: unknown): string;
}

export interface DecisionAsk {
  rows: readonly DecisionRowId[];
  /** Each row's state, after the door built it. A row brought in by `askedWith` reads its group-mate's state. */
  fields: ReadonlyMap<DecisionRowId, DecisionFields>;
  /** Each row's ref fields, ids only, as its record keeps them (question 7). */
  refs: ReadonlyMap<DecisionRowId, DecisionFields>;
  kind?: 'serve' | 'maintain';
  fresh?: boolean;
}

/** The server's one caller of DecisionModel. Gathers before the act's transaction; never inside one. Answers one check per
 *  requested row, in request order. */
export async function gatherDecisions(deps: DecisionAskDeps, ask: DecisionAsk): Promise<readonly DecisionCheck[]> {
  // 1. H6: no model is called inside a transaction.
  if (deps.store.inTransaction()) throw new Error('gatherDecisions: never inside a transaction (H6, answers first, then the act)');
  const kind = ask.kind ?? 'serve';
  const fresh = ask.fresh ?? false;
  // 2. Complete askedWith, and read the host and the key once.
  const all: DecisionRowId[] = [];
  for (const r of ask.rows) for (const g of DECISION_QUESTIONS[r].askedWith) if (!all.includes(g)) all.push(g);
  const host = deps.host();
  const keySet = deps.keySet();
  const day = decisionDayOf(deps.time.clock.wall());
  const stateOf = (r: DecisionRowId): DecisionFields =>
    ask.fields.get(r) ?? DECISION_QUESTIONS[r].askedWith.map((g) => ask.fields.get(g)).find((f) => f !== undefined) ?? {};
  const opaque = (): string[] => {
    const ids = new Set<string>();
    while (ids.size < OPAQUE_IDS) ids.add(`x${deps.time.entropy.below(2 ** 32).toString(16).padStart(8, '0')}`);
    return [...ids];
  };
  const checks = new Map<DecisionRowId, DecisionCheck>();
  for (const { rows, state, stateHash } of decisionRequestGroups(all, stateOf, (f) => deps.stateHash(f))) {
    const fieldsMap = new Map(rows.map((r) => [r, state] as const));
    const egress: DecisionEgressWord = host?.kind === 'hosted' ? deps.egress(decisionTexts(state)) : 'not-hosted';
    const whole = encodeDecisionRequest(rows, fieldsMap, host?.modelId ?? '', opaque());
    const requestBytes = 'refused' in whole
      ? (whole.refused === 'over-size' ? Number.POSITIVE_INFINITY : 0)
      : new TextEncoder().encode(JSON.stringify(whole.body)).length;
    // 3. Each row's side, its line, its record key and its record.
    const facts = new Map(rows.map((r) => {
      const side = deps.arming(r);
      const lineGen = decisionLineGen(r, side, deps.currentLine(r));
      const key = host === null ? null : { row: r, revision: DECISION_QUESTIONS[r].revision, modelId: host.modelId,
        hostKind: host.kind, origin: host.origin, stateHash, lineGen };
      const record: DecisionRecordRead = key === null || fresh ? { kind: 'none' } : deps.store.recordOf(key);
      return [r, { side, lineGen, key, record }] as const;
    }));
    const planOf = (r: DecisionRowId, usage: Parameters<typeof planDecision>[0]['usage']): RowPlan => {
      const f = facts.get(r)!;
      return planDecision({ row: r, kind, fresh, side: f.side, host, keySet, fields: state, requestBytes, egress,
        record: f.record.kind === 'record' ? { id: f.record.id } : null, usage });
    };
    // 4. Plan and reserve in one transaction, so concurrent gathers see each other's reservations.
    const plans = new Map<DecisionRowId, RowPlan>();
    const reserved = deps.store.reserve(day, rows.map((r) => ({ row: r, ceiling: facts.get(r)!.side.ceiling })), (r, usage) => {
      const p = planOf(r, usage);
      plans.set(r, p);
      return p.do === 'ask';
    });
    if (reserved === 'unmeasured') for (const r of rows) plans.set(r, planOf(r, { measured: false }));
    const askRows = reserved === 'unmeasured' ? [] : [...reserved];
    let settled = askRows.length === 0;
    const settle = (attempts: number, unavailableMs: number): void => {
      settled = true;
      if (!deps.store.settle(day, kind, askRows, DECISION_RESERVE_PER_REQUEST, attempts, unavailableMs)) {
        console.warn(`ccrc-server: decision model: the settle of ${askRows.join(', ')} on ${day} failed; `
          + 'the reservation stands until the boot release');
      }
    };
    try {
      for (const r of rows) {
        const p = plans.get(r)!;
        const rec = facts.get(r)!.record;
        if (p.do === 'skip') checks.set(r, decisionMissCheck(r, p.outcome, p.why, 0, 0));
        if (p.do === 'reuse' && rec.kind === 'record' && host !== null) {
          checks.set(r, { row: r, outcome: 'answered', revision: DECISION_QUESTIONS[r].revision, modelId: host.modelId,
            hostKind: host.kind, lineGen: facts.get(r)!.lineGen, recordId: rec.id, verdict: rec.verdict, p: rec.p, band: rec.band,
            ms: 0, attempts: 0, reused: true, egress: egressWordOf(egress as Exclude<DecisionEgressWord, 'hit' | 'unreadable'>) });
        }
      }
      if (askRows.length === 0 || host === null) continue;
      // 5. One adapter, bound to this call's host snapshot.
      const model = deps.modelFor({ kind: host.kind, endpoint: host.endpoint });
      if (model.origin === null) {
        settle(0, 0);
        for (const r of askRows) checks.set(r, decisionMissCheck(r, 'unavailable', 'endpoint-unparseable', 0, 0));
        continue;
      }
      if (!sameDecisionHost({ kind: model.kind, origin: model.origin }, host)) {
        settle(0, 0);
        for (const r of askRows) checks.set(r, decisionMissCheck(r, 'unavailable', 'host-changed', 0, 0));
        continue;
      }
      // 6. One request for the rows that ask.
      const sent = encodeDecisionRequest(askRows, fieldsMap, host.modelId, opaque());
      if ('refused' in sent) {
        settle(0, 0);
        for (const r of askRows) {
          checks.set(r, sent.refused === 'over-size' ? decisionMissCheck(r, 'over-size', null, 0, 0)
            : decisionMissCheck(r, 'not-asked', 'missing-field', 0, 0));
        }
        continue;
      }
      const call = await model.ask(sent.body);
      if (!call.ok) {
        // 7. Settled to the attempts made, success or failure, with the time unavailable.
        settle(call.attempts, call.outcome === 'unavailable' ? call.ms : 0);
        for (const r of askRows) checks.set(r, decisionCallMiss(r, call));
        continue;
      }
      settle(call.attempts, 0);
      const read = readDecisionAnswers(sent.keys, host.modelId, call.answer);
      if ('malformed' in read) {
        for (const r of askRows) checks.set(r, decisionMissCheck(r, 'malformed', read.malformed, call.ms, call.attempts));
        continue;
      }
      for (const r of askRows) {
        const a = read.get(r)!;
        const f = facts.get(r)!;
        // A maintenance answer is never a record to serve from.
        const kept = fresh || f.key === null ? null : deps.store.record({ ...f.key, verdict: a.verdict, p: a.p, band: a.band,
          ms: call.ms, refs: ask.refs.get(r) ?? {}, inline: decisionInlineOf(r, state), at: deps.time.clock.wall() });
        // `recorded: false` names another answer's record under this key (an unreadable one, or a concurrent writer's), never
        // this answer's (review 2324 F5).
        checks.set(r, { row: r, outcome: 'answered', revision: DECISION_QUESTIONS[r].revision, modelId: host.modelId,
          hostKind: host.kind, lineGen: f.lineGen, recordId: kept === null || 'failed' in kept || !kept.recorded ? null : kept.id,
          verdict: a.verdict, p: a.p, band: a.band, ms: call.ms, attempts: call.attempts, reused: false,
          egress: egressWordOf(egress as Exclude<DecisionEgressWord, 'hit' | 'unreadable'>) });
      }
    } catch (err) {
      if (!settled) settle(0, 0);
      throw err;
    }
  }
  // 8. One check per requested row, in request order.
  return ask.rows.map((r) => checks.get(r)!);
}
