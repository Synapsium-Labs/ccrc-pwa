// The Overlord's one read runner (Overlord W1, inbox piece, Task 2; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`,
// questions 3, 4 and 18; spec §3.8, H10). Ring L4, context C5: every Overlord read door's "count, then record, then answer",
// once. A handler asks the gate with its own row's key and returns on `refused`, then hands the pass here; this runner never asks
// the gate. It READS the turn state and the ceiling's counter, ASKS `readCeilingVerdict` (L1), RECORDS the read-ledger line
// through the private store's one writer, and ANSWERS through `refuseRoute`; it decides nothing itself.
//
// NO LINE, NO READ: the turn state is read first, so every line carries one (the ledger's `CHECK` refuses a session's line
// without it); a counter that cannot count refuses 502 `unmeasured` before anything is read, and writes no line; a ceiling
// refusal writes one line for each door and window (the counter answers the newest), so a caller held at the ceiling cannot grow
// the store; a composed answer is sent only when its line landed. A failed write answers 503 `write-failed` and sends nothing.
//
// `caller` is always `overlord`: readers never reach these doors. A row whose `write` is false is not fenced, so its ceiling
// would count a forger's reads (question 18): the runner refuses to run for it unless the caller says `unfenced`.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { refuseRoute } from '../refuse.js';
import type { RouteRefusal } from '../../../shared/refusal.js';
import type { ReadDoor, ReadTurnState } from '../../../shared/operatorMessages.js';
import { READ_CEILING_OUTCOME, READ_CEILING_WINDOW_MS, READ_SERVED_OUTCOME } from '../../../shared/overlordInbox.js';
import type { OperatorModelStore } from '../operatorModel/store.js';
import type { OverlordDoorRow } from './overlordDoors.js';
import type { GateRun } from './overlordGateRun.js';
import { readCeilingVerdict } from './overlordInbox.js';

export interface OverlordReadDeps {
  /** The private store's counter and its one ledger writer; undefined on a server that never opened the store. */
  readonly ledger: Pick<OperatorModelStore, 'servedReadsSince' | 'recordRead'> | undefined;
  /** `readTurnMarkMeasured`, one word a state; a throw is read as `unmeasured`. */
  readonly turn: (sessionId: string, uuid: string) => Promise<ReadTurnState>;
  readonly now: () => number;
}

/** What a door's compose answers: rows to send, or a refusal word; either way its line's scope, count and outcome. */
export type ReadComposed =
  | { readonly kind: 'rows'; readonly body: unknown; readonly scope: string; readonly count: number }
  | { readonly kind: 'refuse'; readonly word: RouteRefusal; readonly detail: string; readonly scope: string; readonly outcome: string };

export interface OverlordReadArgs {
  readonly door: ReadDoor;
  /** The handler's own gate call, already past `refused`. */
  readonly pass: Extract<GateRun, { kind: 'pass' }>;
  /** Its row: `write` must be true (the fence), unless `unfenced`. */
  readonly row: OverlordDoorRow;
  /** Question 18: a door not yet fenced says so, and its ceiling counts every attributed line. */
  readonly unfenced?: true;
  readonly compose: () => ReadComposed | Promise<ReadComposed>;
}

export function runOverlordRead(deps: OverlordReadDeps): (req: FastifyRequest, reply: FastifyReply, a: OverlordReadArgs) => Promise<FastifyReply> {
  return async (_req, reply, a) => {
    // 1. A row that is not fenced says so, or this is a programming error the census catches.
    if (!a.row.write && a.unfenced !== true) throw new Error(`runOverlordRead: ${a.door} is not a fenced door and did not say unfenced`);
    // 2. No store, no read.
    const ledger = deps.ledger;
    if (ledger === undefined) return refuseRoute(reply, 'unavailable', { detail: 'the private store is not open' });
    // 3. The turn state, before any line, so every line carries one.
    let turnState: ReadTurnState;
    try { turnState = await deps.turn(a.pass.caller.sessionId, a.pass.caller.uuid); } catch { turnState = 'unmeasured'; }
    const at = deps.now();
    // 4. The ceiling's counter: a ceiling that cannot count cannot allow.
    const counted = ledger.servedReadsSince(a.door, at - READ_CEILING_WINDOW_MS);
    if (counted.kind === 'unmeasured') return refuseRoute(reply, 'unmeasured', { detail: 'the read ceiling could not be counted' });
    const generation = a.pass.generation === null ? { generation: null, generationRead: 'unmeasured' as const } : { generation: a.pass.generation.n, generationRead: 'measured' as const };
    const line = { at, door: a.door, caller: 'overlord' as const, ...generation, turnState };
    // 5. The ceiling: one line a door and window, and the refusal is answered whether or not that line landed.
    const verdict = readCeilingVerdict(a.door, counted.value, at);
    if (verdict.kind === 'refuse') {
      if (verdict.writeLine) {
        const wrote = ledger.recordRead({ ...line, scope: a.door, count: 0, outcome: READ_CEILING_OUTCOME });
        if (!wrote.ok) console.warn(`ccrc-server: the read-ceiling line of the ${a.door} door was not written (${wrote.error})`);
      }
      return refuseRoute(reply, 'read-ceiling', { retryAfterS: verdict.retryAfterS });
    }
    // 6. Compose: a throw is an unmeasured read, never a 500 that could carry the composer's own words.
    let composed: ReadComposed;
    try { composed = await a.compose(); } catch { return refuseRoute(reply, 'unmeasured', { detail: 'the read could not be composed' }); }
    // 7. The line, before anything is sent.
    const wrote = ledger.recordRead(composed.kind === 'rows'
      ? { ...line, scope: composed.scope, count: composed.count, outcome: READ_SERVED_OUTCOME }
      : { ...line, scope: composed.scope, count: 0, outcome: composed.outcome });
    // 8. A line that did not land sends nothing; one that did sends the rows or the refusal.
    if (!wrote.ok) return refuseRoute(reply, 'write-failed', { detail: 'the read could not be recorded' });
    if (composed.kind === 'rows') return reply.code(200).send(composed.body);
    return refuseRoute(reply, composed.word, { detail: composed.detail });
  };
}
