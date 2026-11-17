import {
  EDGE_KIND_OF_PREDICATE, EDGE_KINDS, EDGE_PREDICATES, EDGE_WHY_MAX, EDGES_PER_STATEMENT_MAX, REMAINING_REASON_MAX,
  REMAINING_WAVES_MAX, edgeTargetKey, type EdgeKind, type EdgePredicate, type EdgeTarget,
} from '../../../shared/programmeFacts.js';
import { OPEN_ITEM_STATES } from '../../../shared/ledgers.js';
import { callText } from './coordCalls.js';

/**
 * WHAT A PROGRAMME SAYS IS LEFT: THE BODY'S RULES (Overlord W2 remaining work A, plan
 * `docs/superpowers/plans/2026-11-16-overlord-w2/w2-remaining-work.md` Task 1; spec §5.6, H38). L1: pure, no store, no
 * clock (the door hands `now`), no reply.
 *
 * A coordinator states the waves left as a range with a reason, at the plan and at every wave boundary, and what its
 * programme waits on as typed edges. `remainingBodyOf` reads the body of `POST /api/coord/programmes/:slug/remaining`;
 * whether each edge's target is a row of this tree is the store's read (`programmeFactsStore.ts#edgeTargetCheck`), and
 * whether the sender holds the programme is `claimsProgramme`'s.
 */

/** One edge as a coordinator states it: `why` is masked and cut. */
export interface NewEdge { kind: EdgeKind; target: EdgeTarget; why: string }

/** One statement as a coordinator states it: `reason` is masked and cut; `runId` is null at the plan. */
export interface NewRemaining { lo: number; hi: number; reason: string; runId: number | null }

export type RemainingBody = { ok: true; statement: NewRemaining; edges: NewEdge[] } | { ok: false; detail: string };

type Refuse = { ok: false; detail: string };
const refuse = (detail: string): Refuse => ({ ok: false, detail });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isWaves = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= REMAINING_WAVES_MAX;

/** The keys each target shape carries, `predicate` first: a target with any other key set is not that shape. */
const TARGET_KEYS: Record<EdgePredicate, readonly string[]> = {
  'run-closed': ['predicate', 'runId'],
  'pr-merged': ['predicate', 'runId', 'pr'],
  'operator-confirms': ['predicate', 'itemId'],
};

/** The predicate of a target whose key set is exactly one shape's, or null (row 7). */
function shapeOf(t: unknown): EdgePredicate | null {
  if (!isRecord(t) || typeof t.predicate !== 'string' || !(EDGE_PREDICATES as readonly string[]).includes(t.predicate)) return null;
  const p = t.predicate as EdgePredicate;
  const keys = Object.keys(t);
  return keys.length === TARGET_KEYS[p].length && TARGET_KEYS[p].every((k) => keys.includes(k)) ? p : null;
}

/** The body of `POST /api/coord/programmes/:slug/remaining`, read first match in the plan's order (Task 1's table, rows 1
 *  to 10). Never throws. `now` is the door's clock, taken for the rules a later row may need; no row reads it today. */
export function remainingBodyOf(raw: unknown, now: number): RemainingBody {
  void now;
  if (!isRecord(raw)) return refuse('the body must be a JSON object');
  for (const f of ['lo', 'hi'] as const) {
    if (!isWaves(raw[f])) return refuse(`${f} must be a whole number of waves from 0 to ${REMAINING_WAVES_MAX}`);
  }
  const lo = raw.lo as number;
  const hi = raw.hi as number;
  if (lo > hi) return refuse('lo must not exceed hi');
  const reason = callText(raw.reason, REMAINING_REASON_MAX, true);
  if (reason === null) return refuse(`reason must be one line of 1 to ${REMAINING_REASON_MAX} characters`);
  let runId: number | null = null;
  if (raw.runId !== undefined) {
    if (!isPositiveId(raw.runId)) return refuse('runId must be a positive integer');
    runId = raw.runId;
  }
  const list = raw.edges === undefined ? [] : raw.edges;
  if (!Array.isArray(list) || list.length > EDGES_PER_STATEMENT_MAX) {
    return refuse(`edges must be a list of at most ${EDGES_PER_STATEMENT_MAX} edges`);
  }

  // Row 7 over every edge before row 8 over any, so an earlier row wins across the list.
  const shaped: { kind: EdgeKind; predicate: EdgePredicate; t: Record<string, unknown>; why: string }[] = [];
  for (const [i, e] of list.entries()) {
    const at = `edge ${i}`;
    if (!isRecord(e)) return refuse(`${at} must be a JSON object`);
    if (typeof e.kind !== 'string' || !(EDGE_KINDS as readonly string[]).includes(e.kind)) {
      return refuse(`${at}: kind must be one of ${EDGE_KINDS.join(', ')}`);
    }
    const predicate = shapeOf(e.target);
    if (predicate === null) return refuse(`${at}: target must be one of the shapes ${EDGE_PREDICATES.join(', ')}`);
    if (EDGE_KIND_OF_PREDICATE[predicate] !== e.kind) {
      return refuse(`${at}: a ${predicate} target is a ${EDGE_KIND_OF_PREDICATE[predicate]} edge`);
    }
    const why = callText(e.why, EDGE_WHY_MAX, true);
    if (why === null) return refuse(`${at}: why must be one line of 1 to ${EDGE_WHY_MAX} characters`);
    shaped.push({ kind: e.kind as EdgeKind, predicate, t: e.target as Record<string, unknown>, why });
  }
  const edges: NewEdge[] = [];
  for (const [i, s] of shaped.entries()) {
    const bad = TARGET_KEYS[s.predicate].slice(1).find((k) => !isPositiveId(s.t[k]));
    if (bad !== undefined) return refuse(`edge ${i}: target ${bad} must be a positive integer`);
    const target = (s.predicate === 'run-closed' ? { predicate: s.predicate, runId: s.t.runId }
      : s.predicate === 'pr-merged' ? { predicate: s.predicate, runId: s.t.runId, pr: s.t.pr }
        : { predicate: s.predicate, itemId: s.t.itemId }) as EdgeTarget;
    edges.push({ kind: s.kind, target, why: s.why });
  }
  const seen = new Set<string>();
  for (const [i, e] of edges.entries()) {
    const key = `${e.kind} ${edgeTargetKey(e.target)}`;
    if (seen.has(key)) return refuse(`edge ${i}: duplicate edge, the same kind and target as an earlier one`);
    seen.add(key);
  }
  return { ok: true, statement: { lo, hi, reason, runId }, edges };
}

/** What the store read of one target (`programmeFactsStore.ts#edgeTargetFacts`): the run it names, with the pull requests
 *  its recorded lineage lists, or the item it names; null when there is no such row. */
export type EdgeTargetFacts =
  | { predicate: 'run-closed' | 'pr-merged'; run: { program: string; prs: readonly number[] } | null }
  | { predicate: 'operator-confirms'; item: { program: string; state: string } | null };

/** Every edge target is tied to a row of this tree (the door's step 9; plan question 2, review 2265 F5 and F6): a
 *  `run-closed` target is a run of ANOTHER programme; a `pr-merged` target names a run whose recorded lineage lists the
 *  pull request; an `operator-confirms` target is an item of THIS programme that still waits. First match. */
export function edgeTargetVerdict(slug: string, target: EdgeTarget, facts: EdgeTargetFacts): { ok: true } | { ok: false; detail: string } {
  if (target.predicate === 'operator-confirms') {
    const item = facts.predicate === 'operator-confirms' ? facts.item : null;
    if (item === null) return refuse(`item ${target.itemId} does not exist`);
    if (item.program !== slug) return refuse(`item ${target.itemId} is not an item of programme ${slug}`);
    if (!(OPEN_ITEM_STATES as readonly string[]).includes(item.state)) return refuse(`item ${target.itemId} is no longer open`);
    return { ok: true };
  }
  const run = facts.predicate === 'operator-confirms' ? null : facts.run;
  if (run === null) return refuse(`run ${target.runId} does not exist`);
  if (target.predicate === 'run-closed') {
    return run.program === slug ? refuse(`run ${target.runId} is a run of programme ${slug}; a run-closed edge names another programme's run`) : { ok: true };
  }
  return run.prs.includes(target.pr) ? { ok: true } : refuse(`run ${target.runId}'s recorded lineage does not list pull request ${target.pr}`);
}
