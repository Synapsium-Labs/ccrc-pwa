// The Overlord door table (Overlord W1, gates A, plan w1-gates.md Task 1; spec Table 11.2, Table 3.6b, §3.6 H2). Ring L1,
// context C5: pure data and one lookup, importing L0 `shared/` by type only. One row per door, keyed by a kebab name, and the
// row says which routes file registers it, its group, its verb class and, for an Overlord door, whether it writes, the server
// word that step 2 of the gate order checks, and what a caller that is not the Overlord is served. A route's handler names its
// row through `doorRow(key)`, so the gate and the census read ONE table.
//
// APPEND-ONLY REGISTRY: each piece that adds an Overlord route adds its row here (the timers piece, the claim door, the hook
// reports, the sandbox and the ladder). `overlord-doors-census.test.ts` reads the table against the routes files in both
// directions: every row is registered in its file, and every registration of `coord/overlordRoutes.ts` and
// `continuity/routes.ts` has a row or a `NOT_OVERLORD_DOORS` entry. An Overlord door carries the ladder's two columns (gates B):
// its door class (steps 4 and 10) and its act kind (step 10's cell). The ladder's operator doors are listed below.
import type { VerbClass } from '../../../shared/overlord-identity.js';
import type { LadderActKind } from '../../../shared/overlord-ladder.js';
import type { DoorClass } from './overlordLadder.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface DoorBase {
  readonly method: HttpMethod;
  readonly path: string;
  /** The repo-relative routes file that registers it. */
  readonly file: string;
  readonly verbClass: VerbClass;
}

/** An Overlord door (Table 11.2's first group): the gate order binds the designated session's calls. */
export interface OverlordDoorRow extends DoorBase {
  readonly group: 'overlord';
  /** A write runs the fence (steps 5 and 7), the witness (7a) and the counter. */
  readonly write: boolean;
  /** Step 2's word (Table 11.1d): `continuity-v1` for W1a's doors, `timers-v1` for the timers, `overlord-v1` for W1's. */
  readonly word: string;
  /** A caller that is not the Overlord: refused `not-the-overlord`, or served in the hook's group. */
  readonly others: 'refuse' | 'hook';
  /** The ladder's door class: `card-probe-note` skips steps 3, 4, 6, 8, 9 and 10 (§11.2; slug handover-is-a-note-door). */
  readonly ladderClass: DoorClass;
  /** Step 10's cell (the ladder's W1 act kinds). */
  readonly act: LadderActKind;
}

/** An operator door: the account gate, or a console that works dark, then the actor through the port. */
export interface OperatorDoorRow extends DoorBase { readonly group: 'operator' }

export type DoorRow = OverlordDoorRow | OperatorDoorRow;

const CONTINUITY = 'server/src/continuity/routes.ts';
const OVERLORD = 'server/src/coord/overlordRoutes.ts';
const LEDGERS = 'server/src/coord/ledgersRoutes.ts';

const operator = (method: HttpMethod, path: string, file: string, verbClass: VerbClass): OperatorDoorRow =>
  ({ group: 'operator', method, path, file, verbClass });
const continuity = (method: HttpMethod, path: string, verbClass: VerbClass, write: boolean, act: LadderActKind): OverlordDoorRow =>
  ({ group: 'overlord', method, path, file: CONTINUITY, verbClass, write, word: 'continuity-v1', others: 'hook', ladderClass: 'card-probe-note', act });

export const OVERLORD_DOORS: Readonly<Record<string, DoorRow>> = {
  designate: operator('POST', '/api/overlord/designate', OVERLORD, 'admin'),
  retire: operator('DELETE', '/api/overlord/designate', OVERLORD, 'admin'),
  designation: operator('GET', '/api/overlord/designation', OVERLORD, 'view'),
  model: operator('POST', '/api/overlord/model', OVERLORD, 'admin'),
  'account-set': operator('POST', '/api/overlord/account-set', OVERLORD, 'admin'),
  ladder: operator('GET', '/api/overlord/ladder', OVERLORD, 'view'),
  rung: operator('POST', '/api/overlord/rung', OVERLORD, 'admin'),
  pause: operator('POST', '/api/overlord/pause', OVERLORD, 'admin'),
  'latch-clear': operator('POST', '/api/overlord/latches/:cause/clear', OVERLORD, 'admin'),
  'portfolio-rank': operator('POST', '/api/portfolio/rank', LEDGERS, 'admin'),
  'goals-ratify': operator('POST', '/api/programmes/:slug/goals/ratify', LEDGERS, 'admin'),
  'private-names-read': operator('GET', '/api/overlord/private-names', 'server/src/operatorModel/nameListRoutes.ts', 'view'),
  'private-names-write': operator('PUT', '/api/overlord/private-names', 'server/src/operatorModel/nameListRoutes.ts', 'admin'),
  card: continuity('GET', '/api/sessions/:id/card', 'view', false, 'read'),
  // The card's recording page: the one registration a second row names (question 12), because its last page records a read.
  'card-record': continuity('GET', '/api/sessions/:id/card', 'view', true, 'read'),
  'notes-write': continuity('POST', '/api/sessions/:id/notes', 'operate', true, 'write-note'),
  'notes-read': continuity('GET', '/api/sessions/:id/notes', 'view', false, 'read'),
  handover: continuity('POST', '/api/sessions/:id/handover', 'operate', true, 'write-note'),
  'probe-read': continuity('GET', '/api/sessions/:id/probe', 'view', false, 'read'),
  'probe-answer': continuity('POST', '/api/sessions/:id/probe', 'operate', true, 'write-note'),
};

/** The row a registration names, by its key. A key the table lacks throws: a programming error the census catches. */
export function doorRow(key: string): DoorRow {
  const row = Object.prototype.hasOwnProperty.call(OVERLORD_DOORS, key) ? OVERLORD_DOORS[key] : undefined;
  if (row === undefined) throw new Error(`overlordDoors: no door row named ${key}`);
  return row;
}

/** `continuity/routes.ts`'s registrations that are not Overlord doors, keyed `METHOD path`, each with its reason (the
 *  census's other direction for that file, F8). */
export const NOT_OVERLORD_DOORS: Readonly<Record<string, { readonly file: string; readonly why: string }>> = {
  'POST /api/sessions/:id/start': { file: CONTINUITY, why: "the hook's SessionStart report: a box-token machine lane in the hook's group" },
  'POST /api/sessions/:id/start/loads': { file: CONTINUITY, why: "the hook's report of what a start loaded: the hook's group, box token" },
  'POST /api/sessions/:id/act-key': { file: CONTINUITY, why: "the door process's one claim of its act key: a box-token machine lane, before any fence (W1 door process A1)" },
  'POST /api/timers': { file: CONTINUITY, why: "a timer door of the Overlord timers piece's, until it adds its row (word timers-v1)" },
  'GET /api/timers': { file: CONTINUITY, why: "a timer door of the Overlord timers piece's, until it adds its row (word timers-v1)" },
  'POST /api/timers/:id/cancel': { file: CONTINUITY, why: "a timer door of the Overlord timers piece's, until it adds its row (word timers-v1)" },
  'GET /api/sessions/:id/timers': { file: CONTINUITY, why: "the operator's read of a session's timers: session-gated, no box token" },
  'POST /api/sessions/:id/timers/:timerId/cancel': { file: CONTINUITY, why: "the operator's cancel of a session's timer: session-gated, no box token" },
  'GET /api/continuity/renewal-backstop': { file: CONTINUITY, why: "the operator's read of the daily renewal backstop: session-gated, no box token" },
  'POST /api/continuity/renewal-backstop': { file: CONTINUITY, why: "the operator's daily renewal backstop setting: session-gated, no box token" },
  'POST /api/sessions/:id/renew': { file: CONTINUITY, why: "the operator's Renew now on one session: session-gated, no box token" },
  'GET /api/coord/renewal-mode': { file: CONTINUITY, why: "the operator's read of when soft renewals happen: session-gated, no box token" },
  'POST /api/coord/renewal-mode': { file: CONTINUITY, why: "the operator's setting of when soft renewals happen: session-gated, no box token" },
};

