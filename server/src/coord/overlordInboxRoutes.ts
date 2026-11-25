// The Overlord's inbox doors (Overlord W1, inbox piece, Task 3; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`,
// questions 5, 6, 10 to 15 and 20; spec §6.8, §3.8 and §11.2). Ring L4, context C5: three box-token machine lanes, each behind the
// Overlord gate: `GET /api/overlord/inbox` (the work in its order, ids and server words only), `GET /api/overlord/messages/:id`
// (one of the operator's messages, the one place outside the private store that reads a message's text) and `POST
// /api/overlord/messages/:id/acknowledge` (settle one message). The file is its own because `overlordRoutes.ts` registers only
// the operator's session-gated doors (`box-token-census.test.ts` pins that).
//
// THE FORM (`overlord-gate-census.test.ts`): each registration's `onRequest` checks the box token and nothing else; the handler
// parses `byId` and `byUuid`, asks the ONE gate with its own row's key and returns on `refused`, and only then touches a store.
// Every row is `others: 'refuse'`, so a caller that is not the designated session is refused `not-the-overlord` at step 1, and
// the rows are `write: true`, so the fence, the witness and the counter run on all three: a forger of the attribution never holds
// the live key and reads no word and spends no ceiling (question 15, 18).
//
// The handlers read facts and ask deciders; they decide nothing. The inbox's order and bands are `composeInbox` (L1); which probe
// facts it reads is `inboxProbeSource`; a read's line, ceiling and refusals are `runOverlordRead`; whether `acknowledge` settles is
// `acknowledgeVerdict`. A message's state moves only through `OperatorModelStore.moveMessage`. `acknowledge` writes no read-ledger
// line; it stamps a text-free sequence line after a new settlement commits. If that stamp fails, it returns a partial 503:
// the settlement stands but the line could not be written. Only `messages` reads text (`operator-message-readers.test.ts`).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { refuseRoute } from '../refuse.js';
import { INBOX_SERVED_BANDS, parseMessageId, type InboxAnswer } from '../../../shared/overlordInbox.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { OperatorModelStore } from '../operatorModel/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from './token.js';
import { doorRow, type OverlordDoorRow } from './overlordDoors.js';
import { callerGenerationOf, type overlordGateRun } from './overlordGateRun.js';
import { acknowledgeVerdict, composeInbox, inboxProbeSourceOf, type GenerationFact } from './overlordInbox.js';
import { openRoundFact } from './overlordInboxWake.js';
import type { ReadComposed, runOverlordRead } from './overlordRead.js';
import type { CoordStore } from './store.js';

export interface OverlordInboxRoutesDeps {
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  readonly mailToken: () => string | BoxTokenHolder | null;
  /** The Overlord gate's runner (`overlordGateRun`, built once in `server.ts`). */
  readonly gate: ReturnType<typeof overlordGateRun>;
  /** The one read runner (`runOverlordRead`, built once in `server.ts`). */
  readonly readRunner: ReturnType<typeof runOverlordRead>;
  /** The private store's readers and its one state writer, or undefined on a server that never opened it. */
  readonly inboxStore: Pick<OperatorModelStore, 'unsettledFacts' | 'messageFactsById' | 'messageById' | 'moveMessage'> | undefined;
  /** The inbox's three coordination reads, and the acknowledgement's separate, post-commit sequence write. */
  readonly reads: Pick<CoordStore, 'designationRead' | 'liveGenerations' | 'openProbeRound' | 'recordInboxAcknowledgement'> | undefined;
  /** Whether the `continuity` row is live, for `effectiveGeneration` (as the gate's port is). */
  readonly continuityLive: () => boolean;
  readonly now: () => number;
}

const IDENTITY_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** Each box-token verdict's detail (the history door answers the same words). */
export const TOKEN_DETAIL = {
  legacy: `no box token presented: this lane takes the box token (${MAIL_TOKEN_HEADER}) and nothing else`,
  bad: 'wrong box token',
  unconfigured: 'no box token is configured on this server: this lane fails shut, it does not fail open',
} as const;

/** The caller's pair, from the query of a `GET` or the body of a `POST`: a shape check only, answered before the gate (the
 *  history door's too). */
export function callerOf(raw: unknown): { ok: true; id: string; uuid: string } | { ok: false } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false };
  const { byId, byUuid } = raw as Record<string, unknown>;
  if (typeof byId !== 'string' || !IDENTITY_RE.test(byId) || typeof byUuid !== 'string' || !IDENTITY_RE.test(byUuid)) return { ok: false };
  return { ok: true, id: byId, uuid: byUuid };
}

/** One of the Overlord's box-token doors' rows, narrowed: a key the table lacks, or one that is not an Overlord door, is a
 *  programming error (the history door's too). */
export function overlordRow(key: string): OverlordDoorRow {
  const row = doorRow(key);
  if (row.group !== 'overlord') throw new Error(`overlordInboxRoutes: ${key} is not an Overlord door`);
  return row;
}

const NO_STORE = 'the private store is not open';
const UNKNOWN_STATE = 'the message is in a state this build does not know';
const NO_COORD = 'no coordination store';

export function registerOverlordInboxRoutes(app: FastifyInstance, deps: OverlordInboxRoutesDeps): void {
  /** The caller's live generation's effective state, through the one reading the gate runner and the wake lane use
   *  (`overlordGateRun.ts#callerGenerationOf`): a state, no live generation, or the reason it could not be read. */
  function generationOf(sessionId: string): GenerationFact {
    if (deps.reads === undefined) return { kind: 'unmeasured', why: NO_COORD };
    const reads = deps.reads;
    let designation: DesignationRead;
    try { designation = reads.designationRead(); } catch (err) { return { kind: 'unmeasured', why: err instanceof Error ? err.message : String(err) }; }
    return callerGenerationOf({ generations: () => reads.liveGenerations(), continuityLive: deps.continuityLive }, sessionId, designation).generation;
  }

  /**
   * `GET /api/overlord/inbox?byId&byUuid` (question 5, 6, 14): the Overlord's work in its order, ids and server words only. The
   * token, the query's shape, then THE GATE; the open round is read only when `inboxProbeSource` asks (an `active` generation), the
   * unsettled messages as text-free facts, and `composeInbox` orders them. A source that cannot be read refuses 502 `unmeasured`
   * naming it, with its own line. The 200 carries no question, no expected answer and no word of any message.
   */
  app.get('/api/overlord/inbox', {
    config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'GET /api/overlord/inbox');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const c = callerOf(req.query);
    if (!c.ok) return refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid' });
    const g = await deps.gate(req, reply, 'inbox', { sessionId: c.id, uuid: c.uuid, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    // `others: 'refuse'` on the row: the gate never serves this door in the hook's group (answered as the linking confirm answers it).
    if (g.kind !== 'pass') return refuseRoute(reply, 'unavailable', { detail: 'the gate did not pass the call' });
    return deps.readRunner(req, reply, {
      door: 'inbox', pass: g, row: overlordRow('inbox'),
      compose: (): ReadComposed => {
        const gen = generationOf(c.id);
        const probe = inboxProbeSourceOf(gen, () => (deps.reads === undefined ? { ok: false, detail: NO_COORD } : openRoundFact(deps.reads, c.id)));
        const messages = deps.inboxStore === undefined ? { kind: 'unmeasured' as const, why: NO_STORE } : deps.inboxStore.unsettledFacts();
        const composed = composeInbox({ probe, messages });
        if (composed.kind === 'unmeasured') {
          return { kind: 'refuse', word: 'unmeasured', detail: composed.source, scope: 'inbox', outcome: 'unmeasured' };
        }
        const body: InboxAnswer = { ok: true, at: deps.now(), servedBands: INBOX_SERVED_BANDS, rows: composed.rows, behind: composed.behind };
        return { kind: 'rows', body, scope: 'inbox', count: composed.rows.length };
      },
    });
  });

  /**
   * `GET /api/overlord/messages/:id?byId&byUuid` (question 13, 15, 20): one of the operator's messages, in any state, served
   * only to the designated session that holds the live key. The id is parsed AFTER the gate (a caller that is not the Overlord
   * learns nothing about the id's shape). The answer is the private store's wire row, text included, masked by the one answer
   * hook; an id that is no message is 409 `said-not-operator`. The only handler outside the private store that reads a message's text.
   */
  app.get('/api/overlord/messages/:id', {
    config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'GET /api/overlord/messages/:id');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const c = callerOf(req.query);
    if (!c.ok) return refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid' });
    const g = await deps.gate(req, reply, 'messages', { sessionId: c.id, uuid: c.uuid, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    if (g.kind !== 'pass') return refuseRoute(reply, 'unavailable', { detail: 'the gate did not pass the call' });
    const id = parseMessageId((req.params as { id?: unknown }).id);
    if (!id.ok) return refuseRoute(reply, 'bad-request', { detail: id.detail });
    const scope = `id:${id.id}`;
    return deps.readRunner(req, reply, {
      door: 'messages', pass: g, row: overlordRow('messages'),
      compose: (): ReadComposed => {
        const r = deps.inboxStore === undefined ? { kind: 'unmeasured' as const, why: NO_STORE } : deps.inboxStore.messageById(id.id);
        if (r.kind === 'unmeasured') return { kind: 'refuse', word: 'unmeasured', detail: 'the message could not be read', scope, outcome: 'unmeasured' };
        if (r.value === 'absent') return { kind: 'refuse', word: 'said-not-operator', detail: 'no operator message has this id', scope, outcome: 'absent' };
        return { kind: 'rows', body: { ok: true, message: r.value }, scope, count: 1 };
      },
    });
  });

  /**
   * `POST /api/overlord/messages/:id/acknowledge { byId, byUuid }` (question 11, 12, 19): the Overlord settles one operator message.
   * The token, the body's shape, THE GATE with the fence and the witness, the id after it; then the message's text-free facts and
   * `acknowledgeVerdict`: an id that is no message is 409 `said-not-operator`, one already settled or spent 200 `changed: false`
   * (a retried call is harmless), one in a state this build does not know 501 `unsupported` (the store never moves it, so the
   * answer is not a success and a retry cannot settle it), else the one writer moves it. A move the store refuses is re-read:
   * a row settled or spent meanwhile is the same 200, one gone the same 409. It writes no read-ledger line. A new settlement
   * commits before its text-free sequence line is written; a refused stamp returns partial 503 `write-failed`, leaving the
   * private settlement durable and the line missing.
   */
  app.post('/api/overlord/messages/:id/acknowledge', {
    config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/overlord/messages/:id/acknowledge');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const c = callerOf(req.body);
    if (!c.ok) return refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid' });
    const g = await deps.gate(req, reply, 'acknowledge', { sessionId: c.id, uuid: c.uuid, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    if (g.kind !== 'pass') return refuseRoute(reply, 'unavailable', { detail: 'the gate did not pass the call' });
    const id = parseMessageId((req.params as { id?: unknown }).id);
    if (!id.ok) return refuseRoute(reply, 'bad-request', { detail: id.detail });
    const store = deps.inboxStore;
    if (store === undefined) return refuseRoute(reply, 'unavailable', { detail: NO_STORE });
    const before = store.messageFactsById(id.id);
    if (before.kind === 'unmeasured') return refuseRoute(reply, 'unmeasured', { detail: 'the message could not be read' });
    const verdict = acknowledgeVerdict(before.value);
    if (verdict.kind === 'absent') return refuseRoute(reply, 'said-not-operator', { detail: 'no operator message has this id' });
    if (verdict.kind === 'already') return { ok: true, changed: false, state: verdict.state };
    if (verdict.kind === 'unknown') return refuseRoute(reply, 'unsupported', { detail: UNKNOWN_STATE });
    const coord = deps.reads;
    if (coord === undefined) return refuseRoute(reply, 'unavailable', { detail: NO_COORD });
    const at = deps.now();
    const moved = store.moveMessage(id.id, 'settle', 'acknowledge', at);
    if (moved.ok) {
      // An accepted settle always changes state. The private store has committed; the line gets its own transaction.
      const stamp = coord.recordInboxAcknowledgement(id.id, at);
      if (!stamp.ok) {
        console.warn(`ccrc-server: inbox: acknowledgement sequence stamp refused for message ${id.id}: ${stamp.error}`);
        return refuseRoute(reply, 'write-failed', { detail: 'the message was settled but its sequence line could not be written' });
      }
      return { ok: true, changed: moved.value.changed, state: moved.value.state };
    }
    if (moved.error !== 'refused') return refuseRoute(reply, 'write-failed', { detail: 'the message could not be settled' });
    // The store refused the move: re-read, because a settle or a spend that raced this call, or a row that is gone, is an answer.
    const after = store.messageFactsById(id.id);
    if (after.kind === 'unmeasured') return refuseRoute(reply, 'unmeasured', { detail: 'the message could not be read' });
    const again = acknowledgeVerdict(after.value);
    if (again.kind === 'absent') return refuseRoute(reply, 'said-not-operator', { detail: 'no operator message has this id' });
    if (again.kind === 'already') return { ok: true, changed: false, state: again.state };
    if (again.kind === 'unknown') return refuseRoute(reply, 'unsupported', { detail: UNKNOWN_STATE });
    return refuseRoute(reply, 'write-failed', { detail: 'the message could not be settled' });
  });
}
