// Overlord W2, the operator's decision-model doors (spec 2026-11-09 §3.7 H6, §7.5, §7.6, §11.2; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 7; index Q7 and question 11). Ring: L4, context
// Coordination (C5): registered from `server.ts`, a lane source of its own for the door censuses (`DECISION_MODEL_DOORS`,
// `box-token-census.test.ts`). It decides nothing: every branch is an answer of `decisionLines.ts` (L1), and every write is
// the store's one writer (`decisionModelStore.ts`, L3) inside one `tx()`.
//
// SIX DOORS ON FIVE PATHS, none consulting the box token, each behind the session gate when sign-in is armed:
//   GET    /api/decision-model                     the read: every row, today's calls, the host, the key's record, never the key
//   POST   /api/decision-model/rows/:id/arm         { mode: 'shadow' | 'armed', line?, expected }
//   POST   /api/decision-model/rows/:id/off         { expected }  (ruling F14; falls back to `held` when the journal refuses, F1)
//   POST   /api/decision-model/rows/:id/ceiling     { ceiling, expected }  (ruling F4)
//   PUT    /api/decision-model/key                  { kind, endpoint, modelId, key? }
//   DELETE /api/decision-model/key
// Every write calls the account gate, so it refuses `auth-off` while sign-in is dark. THE STEP-UP FOLLOWS SPEC §7.5 (the
// coordinator's ruling, replacing the plan's "every write asks"): a widening asks it, a narrowing never does
// (`decisionLines.ts#decisionStepUp`): arming and setting a key always ask; switching an armed gate off and raising a ceiling
// ask; `shadow` to off, an advice row off, a lower ceiling and removing the key do not, so an emergency off is one tap.
//
// EACH MOVE IS AN AUTHORITY RECORD (§7.6): `moveDecisionRowInTx` appends `authority-decision-row` before it writes the row,
// so a widening over an incoherent journal is refused and a narrowing lands `row-only`. The journal's
// `authority-rolled-back` and `authority-unmeasured` both answer `authority-rolled-back` (503) with the guard's cause; any
// other writer error answers `journal-unreadable` (503). A change writes one record-only feed row naming the device actor.
//
// THE KEY NEVER LEAVES THE SERVER: it is written to its `.server` slot (`writeServerSecret`, no tail kept, registered with
// the egress masker) on the slot's own chain, and no answer, refusal, feed row or log line carries any part of it.
//
// THE HOST AND ITS HOLDS FIRST, THE KEY SECOND (review 2418 F1 and F6, the coordinator's ruling). The key is written bound to
// the origin it was entered for (`decisionModelHttp.ts#readDecisionModelKey`), after the host record and the holds have
// committed; a key removal holds the armed gates before it removes the slot. A transaction that fails changes nothing
// (`write-failed`); a key write or removal that fails after it leaves the host and holds written and answers
// `stored-not-applied`, and a key that is not bound to the stored host's origin is never sent.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { credentialBodyRoute, noStoreRoute, type AccountGate } from '../accounts/gate.js';
import { refuseRoute } from '../refuse.js';
import type { NoticeSink } from '../notice.js';
import type { TimePorts } from '../time/ports.js';
import {
  DECISION_FLEET_DAILY_TOTAL, DECISION_MODEL_KEY_SLOT, DECISION_QUESTIONS, DECISION_ROW_IDS, isDecisionRowId,
  type DecisionHeldCause, type DecisionRowId, type DecisionRowSide, type DecisionRowState,
} from '../../../shared/decisionModel.js';
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal.js';
import {
  SLOT_WAIT_MS, readServerSecretMeta, removeServerSecret, slotChains, writeServerSecret,
  type RegisterSecret,
} from './ledgersSecrets.js';
import { decisionDayOf } from './decisionModel.js';
import {
  decideKeyDoor, decideRowArm, decideRowCeiling, decideRowOff, decisionModelViewOf, decisionStepUp, heldOnHostChange, heldOnKeyRemoval,
  isDecisionGate, lineUnderKey, keyDoorHostname, offFallback, type DecisionDoorMove, type DecisionLineFacts,
} from './decisionLines.js';
import type {
  DecisionArmingReads, DecisionArmingStore, DecisionArmingTx, DecisionHostRow, DecisionLineKey, DecisionLineRow, DecisionRowMoved,
} from './decisionModelPort.js';
import { readDecisionModelKey } from './decisionModelHttp.js';

/** The key door's body cap: a key of at most 4096 characters, an endpoint and a model id, with room. */
export const DECISION_KEY_BODY_MAX = 16 * 1024;

export interface DecisionModelRouteDeps {
  /** The arming store over coord.db and the authority journal (`deps.decisions.store`), read at request time; absent on a
   *  server without coordination. */
  store: () => DecisionArmingStore | undefined;
  ccrcDir: string;
  gate: AccountGate;
  time: TimePorts;
  notice?: NoticeSink | undefined;
  /** The device actor of a request (`deviceActor`), or `flag-off` while sign-in is dark. */
  actorOf: (req: FastifyRequest) => string;
  /** The egress masker's registration (`SecretMasker.ingestSecret`): the key is told to it. */
  registerSecret: RegisterSecret;
  /** Every address a host name resolves to (a literal resolves to itself); the key door passes them to `decideKeyDoor`. */
  resolve: (hostname: string) => Promise<readonly string[]>;
  slotWaitMs?: number;
}

/** A row's line key under a host: the row's revision with the host's kind, origin and model. */
const lineKeyOf = (row: DecisionRowId, host: Pick<DecisionHostRow, 'kind' | 'origin' | 'modelId'>): DecisionLineKey =>
  ({ hostKind: host.kind, origin: host.origin, modelId: host.modelId, revision: DECISION_QUESTIONS[row].revision });
const factsOf = (l: DecisionLineRow, k: DecisionLineKey | null): DecisionLineFacts =>
  ({ id: l.id, line: l.line, underToday: lineUnderKey(l, k), canaryAsked: l.canaryAsked, canaryExpected: l.canaryExpected,
    canaryCrossed: l.canaryCrossed });
const sideOf = (s: DecisionRowState): DecisionRowSide => ({ mode: s.mode, ceiling: s.ceiling, armedLine: s.armedLine, held: s.held });

export function registerDecisionModelRoutes(app: FastifyInstance, deps: DecisionModelRouteDeps): void {
  const underSlot = slotChains(deps.slotWaitMs ?? SLOT_WAIT_MS);
  const opKey = (): string => `dm-${deps.time.entropy.hex(16)}`;
  const configured = (reply: FastifyReply): DecisionArmingStore | null => {
    const store = deps.store();
    if (store === undefined) {
      void refuseRoute(reply, 'not-configured', { detail: 'this server has no coordination store or authority journal' });
      return null;
    }
    return store;
  };
  const feed = (req: FastifyRequest, line: string): void => {
    if (deps.notice === undefined) return;
    deps.notice({ kind: 'coord', sessionId: '', title: 'decision model changed', runId: null, body: `${line}; by ${deps.actorOf(req)}` },
      'record-only', { degraded: 'decision-model change written, feed archive degraded' });
  };
  /** A refused move, in the words §7.6 gives the door (review 2262 F17). */
  const refusedMove = (reply: FastifyReply, m: Extract<DecisionRowMoved, { ok: false }>) => {
    if (m.error === 'row-changed') return refuseRoute(reply, 'row-changed', { detail: 'the row changed since it was read; read it again' });
    if (m.error === 'authority-rolled-back' || m.error === 'authority-unmeasured') {
      return refuseRoute(reply, 'authority-rolled-back', { detail: m.detail });
    }
    return refuseRoute(reply, 'journal-unreadable', { detail: 'detail' in m ? m.detail : m.error });
  };
  const hostOf = (store: DecisionArmingReads): DecisionHostRow | null => {
    const h = store.hostRead();
    return h.kind === 'host' ? h.host : null;
  };
  /** Whether a key is stored for this origin (bound to it, review 2418 F1). */
  const keySetFor = (origin: string): boolean => readDecisionModelKey(deps.ccrcDir, origin).kind === 'value';
  /** One door move in its own transaction. */
  const moveOne = (req: FastifyRequest, store: DecisionArmingStore, d: Extract<DecisionDoorMove, { ok: true }>): DecisionRowMoved =>
    store.move({ row: d.row, expected: d.expected, to: d.to, heldCause: d.heldCause, actor: deps.actorOf(req),
      at: deps.time.clock.wall(), opKey: opKey() });
  const answerRow = (reply: FastifyReply, row: DecisionRowId, state: DecisionRowState, extra: Record<string, unknown> = {}) =>
    reply.code(200).send({ ok: true, row, side: sideOf(state), heldWhy: state.heldCause, ...extra });
  const sideText = (s: DecisionRowSide): string =>
    `${s.mode}${s.held ? ' (held)' : ''}, ceiling ${s.ceiling}${s.armedLine === null ? '' : `, line ${s.armedLine.line} (#${s.armedLine.id})`}`;

  // ── the read ───────────────────────────────────────────────────────────────────────────────────────────────────────
  app.get('/api/decision-model', { onRequest: noStoreRoute.onRequest }, (_req, reply) => {
    const store = deps.store();
    if (store === undefined) return refuseRoute(reply, 'not-configured', { detail: 'this server has no coordination store' });
    const hostRead = store.hostRead();
    if (hostRead.kind === 'unreadable') return refuseRoute(reply, 'unavailable', { detail: 'the decision model\'s host record cannot be read' });
    const host = hostRead.kind === 'host' ? hostRead.host : null;
    const meta = readServerSecretMeta(deps.ccrcDir, DECISION_MODEL_KEY_SLOT);
    if (meta !== null && 'unreadable' in meta) return refuseRoute(reply, 'unavailable', { detail: 'the decision model\'s key slot cannot be measured' });
    const day = decisionDayOf(deps.time.clock.wall());
    const rows = [];
    for (const row of DECISION_ROW_IDS) {
      const r = store.rowRead(row);
      if (r.kind === 'unreadable') return refuseRoute(reply, 'unavailable', { detail: `the row ${row} cannot be read` });
      const usage = store.usage(row, day, r.state.ceiling);
      if (!usage.measured) return refuseRoute(reply, 'unavailable', { detail: 'today\'s calls cannot be read' });
      rows.push({ row, state: r.state, usage, current: host === null ? null : store.currentLine(row, lineKeyOf(row, host)) });
    }
    const fleetToday = rows.reduce((n, r) => n + (r.usage.measured ? r.usage.serve + r.usage.maintain + r.usage.reserved : 0), 0);
    const key = meta === null ? null : { setAt: meta.setAt ?? host?.keySetAt ?? 0, masked: 'masked' in meta ? meta.masked : false };
    return reply.code(200).send(decisionModelViewOf({ rows, fleetToday, fleetCap: DECISION_FLEET_DAILY_TOTAL,
      host: host === null ? null : { kind: host.kind, endpoint: host.endpoint, origin: host.origin, modelId: host.modelId }, key }));
  });

  // ── arm ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  app.post('/api/decision-model/rows/:id/arm', async (req, reply) => {
    // Arming is always a widening of what is asked or let through (§11.2): the step-up, before the body is used.
    if (!deps.gate(req, reply, { cap: null, stepUp: decisionStepUp('arm') }).pass) return reply;
    const c = configured(reply);
    if (c === null) return reply;
    const host = hostOf(c);
    const rowId = (req.params as { id: string }).id;
    const key = host !== null && isDecisionRowId(rowId) ? lineKeyOf(rowId, host) : null;
    const current = key !== null && isDecisionRowId(rowId) ? c.currentLine(rowId, key) : null;
    const d = decideRowArm({ rowId, body: req.body, host, keySet: host !== null && keySetFor(host.origin), currentLine: current === null ? null : factsOf(current, key),
      lineById: (id) => { const l = c.lineById(id); return l === null || l.row !== rowId ? null : factsOf(l, key); } });
    if (!d.ok) return refuseRoute(reply, d.refusal, { detail: d.detail });
    const m = moveOne(req, c, d);
    if (!m.ok) return refusedMove(reply, m);
    feed(req, `decision model ${d.row}: ${sideText(d.expected)} -> ${sideText(d.to)}`);
    return answerRow(reply, d.row, m.state);
  });

  // ── off ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  app.post('/api/decision-model/rows/:id/off', async (req, reply) => {
    if (!deps.gate(req, reply, { cap: null }).pass) return reply;
    const c = configured(reply);
    if (c === null) return reply;
    const d = decideRowOff({ rowId: (req.params as { id: string }).id, body: req.body });
    if (!d.ok) return refuseRoute(reply, d.refusal, { detail: d.detail });
    if (decisionStepUp('off', isDecisionGate(d.row), d.expected, d.to) && !deps.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    // The off move, and when the journal refuses that widening, the hold in its place, in ONE transaction (ruling F1).
    const answer = c.inTx((t): { kind: 'moved'; m: DecisionRowMoved } | { kind: 'held'; m: DecisionRowMoved; cause: string } | { kind: 'already-held'; cause: string } => {
      const first = t.move({ row: d.row, expected: d.expected, to: d.to, heldCause: null, actor: deps.actorOf(req),
        at: deps.time.clock.wall(), opKey: opKey() });
      if (first.ok || first.error === 'row-changed' || first.error === 'row-unreadable') return { kind: 'moved', m: first };
      const cause = 'detail' in first ? first.detail : first.error;
      const fb = offFallback(d.row, d.expected, first.error);
      if (fb === 'refuse') return { kind: 'moved', m: first };
      if (fb === 'already-held') return { kind: 'already-held', cause };
      const held = t.move({ row: d.row, expected: d.expected, to: { ...d.expected, held: true },
        heldCause: 'off-refused', actor: deps.actorOf(req), at: deps.time.clock.wall(), opKey: opKey() });
      return { kind: 'held', m: held, cause };
    });
    if (answer.kind === 'already-held') {
      return reply.code(200).send({ ok: true, row: d.row, state: 'held', offRefused: true, cause: answer.cause, side: d.expected });
    }
    if (!answer.m.ok) return refusedMove(reply, answer.m);
    if (answer.kind === 'held') {
      feed(req, `decision model ${d.row}: off refused by the journal, held instead`);
      return answerRow(reply, d.row, answer.m.state, { state: 'held', offRefused: true, cause: answer.cause });
    }
    feed(req, `decision model ${d.row}: ${sideText(d.expected)} -> off`);
    return answerRow(reply, d.row, answer.m.state, { state: 'off' });
  });

  // ── ceiling ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  app.post('/api/decision-model/rows/:id/ceiling', async (req, reply) => {
    if (!deps.gate(req, reply, { cap: null }).pass) return reply;
    const c = configured(reply);
    if (c === null) return reply;
    const d = decideRowCeiling({ rowId: (req.params as { id: string }).id, body: req.body });
    if (!d.ok) return refuseRoute(reply, d.refusal, { detail: d.detail });
    if (decisionStepUp('ceiling', isDecisionGate(d.row), d.expected, d.to) && !deps.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    const m = moveOne(req, c, d);
    if (!m.ok) return refusedMove(reply, m);
    feed(req, `decision model ${d.row}: ceiling ${d.expected.ceiling} -> ${d.to.ceiling}`);
    return answerRow(reply, d.row, m.state);
  });

  // ── the key ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const slotBusy = (reply: FastifyReply) => () =>
    refuseRoute(reply, LEDGER_ROUTE_REFUSALS.slotBusy, { detail: 'an earlier key change has not finished; nothing was done, try again' });

  /** In the key door's transaction: hold every armed row the host change leaves without its line (`line-key`), or, after a key
   *  removal, every armed gate (`no-key`). Narrowings, so each lands, `row-only` over an incoherent journal. */
  const holdRows = (req: FastifyRequest, t: DecisionArmingTx, which: (row: DecisionRowId, s: DecisionRowState) => boolean,
    cause: DecisionHeldCause): DecisionRowId[] => {
    // Every row is read before the first hold is journalled, so an unreadable row throws before any record is appended: a
    // record appended and then rolled back with the transaction would stand in the journal with no row.
    const states = DECISION_ROW_IDS.map((row) => {
      const r = t.rowRead(row);
      if (r.kind === 'unreadable') throw new Error(`the row ${row} cannot be read`);
      return [row, r.state] as const;
    });
    const held: DecisionRowId[] = [];
    for (const [row, state] of states) {
      if (!which(row, state)) continue;
      const side = sideOf(state);
      const m = t.move({ row, expected: side, to: { ...side, held: true }, heldCause: cause,
        actor: deps.actorOf(req), at: deps.time.clock.wall(), opKey: opKey() });
      if (!m.ok) throw new Error(`the hold of ${row} was refused (${m.error})`);
      held.push(row);
    }
    return held;
  };

  app.put('/api/decision-model/key', credentialBodyRoute(DECISION_KEY_BODY_MAX), async (req, reply) => {
    // Setting a key widens what may be asked (§11.2): the step-up, before the body is used.
    if (!deps.gate(req, reply, { cap: null, stepUp: decisionStepUp('key-put') }).pass) return reply;
    const c = configured(reply);
    if (c === null) return reply;
    const hostname = keyDoorHostname(req.body);
    let addresses: readonly string[] = [];
    if (hostname !== null) { try { addresses = await deps.resolve(hostname); } catch { addresses = []; } }
    return underSlot(DECISION_MODEL_KEY_SLOT, async () => {
      const stored = hostOf(c);
      const d = decideKeyDoor({ body: req.body, addresses,
        stored: stored === null ? null : { kind: stored.kind, origin: stored.origin, modelId: stored.modelId, keySet: keySetFor(stored.origin) } });
      if (!d.ok) return refuseRoute(reply, d.refusal, { detail: d.detail });
      const at = deps.time.clock.wall();
      const next = { kind: d.kind, endpoint: d.endpoint, origin: d.origin, modelId: d.modelId };
      // 1. The host record and its holds, in one transaction (review 2418 F1): nothing is changed when it fails.
      let held: DecisionRowId[];
      try {
        held = c.inTx((t) => {
          t.setHost({ ...next, keySetAt: d.key !== null ? at : (stored?.keySetAt ?? null) }, deps.actorOf(req), at);
          if (!d.hostChanged) return [];
          return holdRows(req, t, (row, s) => {
            const k = lineKeyOf(row, next);
            const line = isDecisionGate(row) ? (s.armedLine === null ? null : t.lineById(s.armedLine.id)) : t.currentLine(row, k);
            return heldOnHostChange(sideOf(s), lineUnderKey(line, k));
          }, 'line-key');
        });
      } catch {
        return refuseRoute(reply, 'write-failed', { detail: 'the host record and its holds could not be written; nothing was changed' });
      }
      // 2. The key, bound to the origin it was entered for, only now.
      if (d.key !== null) {
        let failed = false;
        try {
          await writeServerSecret(deps.ccrcDir, DECISION_MODEL_KEY_SLOT, d.key, at, deps.registerSecret, { tail: 'none', bound: d.origin });
        } catch {
          // Any failure, `OperatorSecretStoredUnrecorded` included: a value with no record is bound to no origin, so it is never
          // sent, and the operator sends the key again.
          failed = true;
        }
        if (failed) {
          feed(req, `decision model host: ${next.kind} ${next.origin} ${next.modelId}; the key was not stored${held.length > 0 ? `; held ${held.join(', ')}` : ''}`);
          return refuseRoute(reply, 'stored-not-applied', { detail: 'the host record was written, but the key was not stored; send it again' });
        }
      }
      feed(req, `decision model host: ${next.kind} ${next.origin} ${next.modelId}${d.keyChanged ? ', key set' : ''}${held.length > 0 ? `; held ${held.join(', ')}` : ''}`);
      const meta = readServerSecretMeta(deps.ccrcDir, DECISION_MODEL_KEY_SLOT);
      return reply.code(200).send({ ok: true, host: next, key: meta === null || 'unreadable' in meta ? null
        : { setAt: meta.setAt ?? at, masked: 'masked' in meta ? meta.masked : false }, held });
    }, slotBusy(reply));
  });

  app.delete('/api/decision-model/key', async (req, reply) => {
    // Removing the key narrows (every armed gate is held with it): no step-up.
    if (!deps.gate(req, reply, { cap: null, stepUp: decisionStepUp('key-delete') }).pass) return reply;
    const c = configured(reply);
    if (c === null) return reply;
    return underSlot(DECISION_MODEL_KEY_SLOT, async () => {
      const at = deps.time.clock.wall();
      const stored = hostOf(c);
      // 1. The holds first (review 2418 F6): a removal that then fails leaves every armed gate held, never re-opened by a key set
      //    again.
      let held: DecisionRowId[];
      try {
        held = c.inTx((t) => {
          if (stored !== null) t.setHost({ kind: stored.kind, endpoint: stored.endpoint, origin: stored.origin, modelId: stored.modelId, keySetAt: null }, deps.actorOf(req), at);
          return holdRows(req, t, (row, s) => heldOnKeyRemoval(isDecisionGate(row), sideOf(s)), 'no-key');
        });
      } catch {
        return refuseRoute(reply, 'write-failed', { detail: 'the host record and the holds could not be written; nothing was changed' });
      }
      // 2. Then the key.
      try { await removeServerSecret(deps.ccrcDir, DECISION_MODEL_KEY_SLOT); } catch {
        feed(req, `decision model key not removed${held.length > 0 ? `; held ${held.join(', ')}` : ''}`);
        return refuseRoute(reply, 'stored-not-applied', { detail: 'the armed gates were held, but the key could not be removed; remove it again' });
      }
      feed(req, `decision model key removed${held.length > 0 ? `; held ${held.join(', ')}` : ''}`);
      return reply.code(200).send({ ok: true, host: stored === null ? null : { kind: stored.kind, endpoint: stored.endpoint, origin: stored.origin,
        modelId: stored.modelId }, key: null, keySetAt: null, held });
    }, slotBusy(reply));
  });
}
