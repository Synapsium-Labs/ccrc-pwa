import type { DatabaseSync } from 'node:sqlite';
import { tx } from './db.js';
import { decideClaim, type ClaimRow } from './claims.js';
import { decideAllocation } from './ledger.js';
import type { LedgerLog } from './ledgerlog.js';
import { CLEAR_REFUSED_STRANDS_TEXT } from './rundefs.js';
import { reviveDec, reviveMeas, reviveObs, type JournalRow } from './journalparse.js';
import {
  CLAIM_HARD_CAP_MS, CLAIM_LEASE_MS, DONE_AUTHORITY_CODES,
  isClaimState, isDeviationAllocState, isLifecycleAct, isLifecycleGapReason, isLifecycleOutcome,
  isMailDeliveryState, isMailGate, isMailKind, isNotifyKind, isProgramState, isRunState, isWorkItemState,
  LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN,
  // D-1143: the kickoff cancellation keys on the SUBJECT, and the subject has
  // exactly one home — `shared/api.ts`, beside the body it labels. Its own
  // docstring gives the second reason it lives there rather than in
  // `coord/kickoff.ts`: "no hyphenated literal under `server/src/coord` for
  // `mail-routes.test.ts`'s scanner to arbitrate". Imported, never retyped.
  PROGRAM_KICKOFF_SUBJECT,
  RUN_TRANSITIONS,
  type ClaimConflict, type ClaimState, type ClaimSummary,
  type CoordCaps, type DeviationAllocation, type DeviationAllocState,
  type LifecycleGap, type LifecycleGapReason,
  type MailDeliveryState, type MailGate,
  type MailKind, type MailRejectCode, type MailSummary, type MirroredLifecycleEvent,
  type NotifyEvent, type PeerDeliverable, type ProgramState,
  type RunHealth, type RunItemTally, type RunState,
  type RunSummary,
  type WorkItemState,
} from '../../../shared/api.js';

/** One entry in `$REG/<id>.prhistory` (ccd/ccd:2252-2253). Re-declared as a TYPE
 *  here rather than parsed twice: `coord/prhistory.ts` owns the reader. */
export interface PrLineageEntry { pr: number; branch: string; phase: string; recordedAt: number }

/** The run states nothing can leave — DERIVED from `RUN_TRANSITIONS` (a state
 *  with no outgoing edge IS terminal), never a second hand-written list of the
 *  same two words. Adding a terminal state to the table is enough. */
const TERMINAL_RUN_STATES: readonly RunState[] =
  (Object.keys(RUN_TRANSITIONS) as RunState[]).filter((s) => RUN_TRANSITIONS[s].length === 0);

/**
 * A run row as the STORE reads it: `RunSummary` (the wire shape) plus
 * `prLineage`, which is server-internal review material — folded once, at
 * close, from `.prhistory` — and deliberately absent from `RunSummary`
 * itself. `RunSummary`'s own docstring says why: it "rides the fleet socket
 * alongside a full session snapshot on every change", and `prLineage` is
 * neither small nor something that changes on every frame. `PrLineageEntry`
 * cannot live in `shared/` without `RunSummary` importing server-only
 * knowledge of `.prhistory`'s shape, so this stays a server-side supertype
 * rather than growing the wire type.
 */
export interface RunRow extends RunSummary { prLineage: PrLineageEntry[] }

/** One open run naming a session. NOT a `RunRow`: these four columns are all
 *  the three consumers (`closeRun`, `FleetWatcher.archiveMerged`, the by-hand
 *  archive route) need, and hydrating a whole run to answer "is this
 *  workspace still claimed?" would drag `prLineage` JSON and a `programs`
 *  join through a decision that turns on four integers and a slug. */
export interface OpenSibling {
  id: number; program: string; wave: number; waveOf: number | null;
}

/** `RunRow` -> `RunSummary`: strips `prLineage`, server-internal review
 *  material `RunSummary`'s own docstring says is "deliberately absent" from
 *  the wire shape — "neither small nor something that changes on every
 *  frame." Shared by `GET /api/runs` (`coord/routes.ts`) and the `runs` WS
 *  frame's own emitter (`watch.ts`'s `emitRuns`, Task 10) rather than each
 *  holding its own copy of the strip. */
export const toRunSummary = (row: RunRow): RunSummary => {
  const { prLineage: _prLineage, ...summary } = row;
  return summary;
};

export type OpenRunResult =
  | { id: number; program: string; state: RunState }
  | { refused: 'claimed-by-another'; by: string };

export type AdvanceResult =
  | { ok: true; from: RunState; to: RunState }
  | { ok: false; error: 'bad-transition'; from: RunState; to: RunState }
  | { ok: false; error: 'unknown-run' };

/** The reclaim's three answers. `kind`, not `error`, because these are not
 *  `advance`'s arms and folding them into `AdvanceResult` would put two
 *  vocabularies behind one discriminant. `unknown-run` is spelled the way its
 *  `MailRejectCode` twin is (shared/api.ts:3446); `no-claimant` is this wave's
 *  own word, admitted to `mail-routes.test.ts`'s scanner through the exported
 *  `isReclaimRefuseCode` guard rather than an allowlist entry — the standing
 *  remedy that file states for every union after the first. */
export type ReclaimProgramResult =
  | { ok: true; program: string; runIds: number[]; from: string }
  | { ok: false; kind: 'unknown-run' }
  | { ok: false; kind: 'no-claimant' };

/** The three terminal members, ONCE (spec §3.2). The SQL literal in
 *  `setWorkItemState`'s `WHERE` is BUILT from this list and `settleItems`'
 *  pre-pass READS it, so the guard and the precheck cannot drift — and
 *  `single-definition.test.ts` pins that this is the only place the trio is
 *  spelled as one adjacent list under any of the four roots. */
export const TERMINAL_ITEM_STATES = ['done', 'failed', 'abandoned'] as const satisfies
  readonly WorkItemState[];

/** `setWorkItemState` stops returning `void` — the exact defect
 *  `architecture:25-30` names for `markDelivered`. A refusal that the caller
 *  cannot see is a refusal that reads as a success. */
export type SetWorkItemResult =
  | { ok: true; state: WorkItemState }
  | { ok: false; why: 'unknown-item' }
  | { ok: false; why: 'terminal'; state: WorkItemState };

export interface SettleItem { id: number; state: WorkItemState; claimedBy: string | null }

/** A batch is all-or-nothing, so its refusal names WHICH id refused it —
 *  "partial success on a ledger write is how tallies drift" (spec §3.2), and
 *  a caller told only that something in its body was bad cannot fix it. */
export type SettleItemsResult =
  | { ok: true; items: RunItemTally }
  | { ok: false; itemId: number; why: 'unknown-item' }
  | { ok: false; itemId: number; why: 'terminal'; state: WorkItemState };

/** Build 9 wave 7 (D12). The failure arms are `decideClaim`'s own, verbatim —
 *  the store adds nothing to a refusal and takes nothing from it (the payloads
 *  pass through untouched; only the `ok`/`why` discriminant is the store's,
 *  so this union reads like its `SetWorkItemResult` neighbours). */
export type ClaimAttemptResult =
  | { ok: true; claims: ClaimSummary[] }
  | { ok: false; why: 'bad-path'; paths: readonly string[] }
  | { ok: false; why: 'conflict'; conflicts: readonly ClaimConflict[] };

/** Release and break share this shape — `setWorkItemState`'s refusal family:
 *  a caller must be able to see that ITS call was not the one that landed.
 *  `state` on the not-live arm is `null` for exactly ONE condition, a stored
 *  token this build cannot model (a newer build's word — coord/db.ts rule 3:
 *  a rollback must be able to READ, and reading is `isClaimState`, never a
 *  cast; `ClaimState` has no designated we-do-not-know member to degrade to,
 *  by the L0 pin). */
export type ClaimEndResult =
  | { ok: true; state: 'released' | 'broken' }
  | { ok: false; why: 'unknown-claim' }
  | { ok: false; why: 'not-live'; state: ClaimState | null };

/** One `ledger_alloc` row on the way OUT — the L0 wire row's own fields
 *  (`DeviationAllocation`) minus `stale`, which is DERIVED by the READER
 *  from a clock this store does not own (`allocatedAt + LEDGER_STALE_MS`,
 *  the watcher's and the route's policy, never stored) — and with `state`
 *  read through the same we-do-not-know rule as every enum column in this
 *  file: `DeviationAllocState` has no designated unknown member (the L0 pin
 *  stores exactly two words), so the store's row widens it rather than
 *  degrading a token a newer build wrote to a guess. */
export interface LedgerRow extends Omit<DeviationAllocation, 'state' | 'stale'> {
  state: DeviationAllocState | 'unknown';
}

/** The ok payload of `allocateDeviations` — one allocated BLOCK. The L0
 *  wire row is one row PER NUMBER; the allocator decides per BLOCK
 *  (contiguous `numbers` from one floor read), so the ok arm carries the
 *  block's shared identity plus the numbers, not N copies of a row. */
export interface AllocatedBlock extends Pick<DeviationAllocation,
  'project' | 'title' | 'allocatedTo' | 'runId' | 'allocatedAt'> {
  numbers: readonly number[];
  floor: number;
}

/** The failure arms are `decideAllocation`'s own (`ledger.js`), re-keyed to
 *  this file's `ok`/`why` house shape — the `ClaimAttemptResult` stance: the
 *  store adds nothing to a refusal and takes nothing from it. */
export type AllocateResult =
  | { ok: true; allocation: AllocatedBlock }
  | { ok: false; why: 'not-seeded' }
  | { ok: false; why: 'bad-count' };

/** The raw row shape common to `run(id)` and `runs()` — named columns only
 *  (no `SELECT *` anywhere in this file), joined once against `programs` for
 *  its title. */
interface RunRowDb {
  id: number; program: string; programTitle: string; wave: number; waveOf: number | null;
  project: string; sessionId: string | null; workspace: string | null; branch: string | null;
  state: string; claimedBy: string | null;
  resumed: number; clearedAt: number | null; openedAt: number;
  dispatchStartedAt: number | null; dispatchedAt: number | null; closedAt: number | null;
  handoffCommit: string | null;
  prLineage: string | null;
  briefQueued: number | null;
  clearError: string | null;
}

const RUN_ROW_COLUMNS =
  'r.id, r.program, p.title AS programTitle, r.wave, r.waveOf, r.project, r.sessionId, ' +
  'r.workspace, r.branch, r.state, r.claimedBy, ' +
  'r.resumed, r.clearedAt, r.openedAt, r.dispatchStartedAt, ' +
  'r.dispatchedAt, r.closedAt, ' +
  'r.handoffCommit, r.prLineage, r.briefQueued, r.clearError';

/**
 * Coordination's own terminal-state rule, spelled ONCE (bounded context 5:
 * "acked and rejected are terminal" — `docs/superpowers/specs/2026-08-10-
 * architecture-ddd-clean-solid.md`): the states a delivery sits in while it
 * is still "outstanding". Before fix round 1 (findings 2/4) this predicate
 * was spelled independently, in SQL, at three call sites in this file
 * (`cancelOutstandingDeliveries`, `unreadMailCount`, `hasOutstandingMail`) —
 * and a FOURTH copy, re-implemented as a JS `.filter()`, lived outside the
 * store entirely, in `sessionws.ts`'s `checkMail`, on the wrong side of
 * `mailForRecipient`'s own `LIMIT`: applied to a 100-row *history* window
 * rather than to the query that produces it, so an old unacked delivery
 * could fall out of that window and read as gone while still genuinely
 * queued. `outstandingMailFor` below is the store-side fix; this constant is
 * what lets every "is this delivery outstanding" query converge on one
 * fragment instead of independently agreeing four times.
 */
const OUTSTANDING_STATES_SQL = "('queued','delivered')";

/** `?,?,?` for an `IN (...)` bound to a JS array (D-1141). `node:sqlite` has no
 *  array bind, so the list has to be BUILT — and a built SQL fragment is exactly
 *  where a value would slip into the statement text. One home, and it can emit
 *  nothing but question marks whatever it is handed: every value still travels as
 *  a positional bind. Callers guard `n > 0` themselves — an empty `IN ()` is a
 *  syntax error in SQLite, and a helper that silently returned a
 *  matches-nothing fragment would hide the caller's own missing guard. */
const placeholders = (n: number): string => new Array(n).fill('?').join(',');

/** The replay-ceiling park's own `lastError`, written by exactly one call
 *  site (`watch.ts`'s `sweepMail`, `store.rejectDelivery(d.id, 'undeliverable',
 *  MAIL_REPLAY_CEILING_ERROR)`) and read back by exactly one other
 *  (`markAcked` below, deviation D-67-b / orchestrator ruling I2): a shared
 *  constant rather than the same string literal typed twice, so the two can
 *  never drift apart and silently stop recognising each other's writes. */
export const MAIL_REPLAY_CEILING_ERROR = 'replayed without ack past the replay ceiling';

/** `cancelOutstandingDeliveries`'s own park sentence, promoted to a constant on
 *  `MAIL_REPLAY_CEILING_ERROR`'s exact argument (D-1143). It was already typed
 *  twice — once by the writer at `cancelOutstandingDeliveries`, once by the
 *  READ-side exclusion in `OUTSTANDING_OR_ABANDONED_SQL` below — which is the
 *  drift the constant above exists to forbid: the day one of the two is reworded
 *  the park silently stops being recognised as deliberate and every closed run's
 *  cancelled mail reappears as "still needs a human's attention". Two literals
 *  that MUST match are one definition, wherever they happen to live. */
export const MAIL_RUN_CLOSED_ERROR = 'run closed';

/**
 * The reclaim's own park sentence (D-1143), and the second member of the pair
 * below. Written by `reclaimProgram`'s kickoff cancellation and read back by the
 * same READ-side exclusion — the identical writer/reader pair the constant above
 * describes, minted as a constant from the start rather than as two literals a
 * later fix round has to notice.
 *
 * IT IS NOT `MAIL_RUN_CLOSED_ERROR`, and reusing that string would have been the
 * cheap way to inherit the exclusion for free: no run closed here. A reclaim
 * moves the chair while every run of the program stays exactly as open as it
 * was, and `lastError` is free text a maintainer greps for the ROW's own history
 * — a park that lies about why it happened is worse than a park nobody
 * excluded. Contains no apostrophe, deliberately: it is interpolated into the
 * SQL fragment below, where the surrounding quotes are the only escaping there
 * is.
 */
export const MAIL_RECLAIM_CANCELLED_ERROR = 'coordinator reclaimed';

/** The two parks that are DECISIONS rather than abandonment — a run closing
 *  (`closeRun`) and a chair changing hands (`reclaimProgram`) — as one SQL list,
 *  so the read-side exclusion below names a set rather than growing a second
 *  hand-written `!=` per writer. Every future "this delivery was cancelled on
 *  purpose" park joins HERE and inherits the exclusion; a park that means "we
 *  gave up" (the replay ceiling, the attempt ceiling, a purged recipient) must
 *  never be added, because those are exactly the rows that predicate exists to
 *  keep visible. */
const DELIBERATE_CANCEL_ERRORS_SQL =
  `('${MAIL_RUN_CLOSED_ERROR}','${MAIL_RECLAIM_CANCELLED_ERROR}')`;

/**
 * The READ-side "still needs a human's attention" predicate (fix, review
 * finding 2) — `OUTSTANDING_STATES_SQL` above, unioned with a `rejected`
 * delivery THIS BUILD gave up retrying before anyone ever acted on it: the
 * replay-ceiling park (`watch.ts`'s `MAIL_REPLAY_MAX_ATTEMPTS`), a delivery
 * that never sent at all past `MAIL_MAX_ATTEMPTS`, or a recipient the
 * registry no longer lists. `renderEnvelope`'s own ack line promises
 * replay "until you ack" — true only up to that ceiling, never past it —
 * and before this fix, the moment a park landed, the row vanished from
 * every reader built on `OUTSTANDING_STATES_SQL` alone: `RunSummary.unreadMail`
 * silently dropped to 0, `MailStrip` unmounted itself, and only a full
 * `?all=1` history read still knew. A message that was never acked and
 * never acted on does not stop being a fact worth surfacing just because
 * the lane stopped trying to hand it over.
 *
 * DELIBERATELY EXCLUDES `cancelOutstandingDeliveries`'s own park
 * (`MAIL_RUN_CLOSED_ERROR`): that one is not abandonment, it is the run
 * closing making the delivery moot BY DESIGN — surfacing it as "still needs
 * attention" would be exactly the false alarm this predicate exists to
 * avoid on the other end.
 *
 * …AND, SINCE D-1143, `MAIL_RECLAIM_CANCELLED_ERROR` BESIDE IT — the same
 * argument, measured rather than assumed. `reclaimProgram`'s kickoff
 * cancellation writes a `rejected` row whose `mail.runId` IS NULL (the program
 * kickoff names no run, by construction — `kickoff.ts`'s own docstring), so the
 * `LEFT JOIN runs rr` arm two paragraphs down cannot help: `rr.state` is NULL,
 * `COALESCE(rr.state,'')` is `''`, and the row would have stayed abandoned-and-
 * visible FOREVER, on the corpse's own `toId`. Every reader was walked before
 * this clause was written, and the answer differs per reader — which is why the
 * fix is here and not in a writer:
 *   `outstandingMailFor(toId)` — the one that breaks. `GET /api/mail?to=<dead
 *     id>` and `sessionws.ts`'s `checkMail` both read it, and `checkMail` is
 *     keyed on the SESSION's own id. A reclaimed workspace id is not gone for
 *     good: `ccd start` / `ws-restore` bring the same id back, and `_ws_slug_new`
 *     recycles a purged slug outright (`ccd/ccd:3516`) — so the returning
 *     session's mail strip would open on a kickoff briefing it to coordinate a
 *     program somebody else now holds. That is MINOR 9's own two-coordinator
 *     hazard, re-entered through the READ side after the write side closed it.
 *   `unreadMailCount(runId, sessionId)` — unaffected, and not by luck: its
 *     `WHERE m.runId = ?` cannot match a NULL `runId` at all, so no
 *     `RunSummary.unreadMail` ever counted the kickoff, before or after the
 *     cancellation.
 *   `mailForRecipient` (`?all=1`) — unaffected ON PURPOSE. It is the history
 *     read; a cancelled kickoff is exactly the kind of fact an operator
 *     inspecting `/mail` should still find.
 *   `hasOutstandingMail` / `dueDeliveries` / the peer-quota reads — all built on
 *     the narrower `OUTSTANDING_STATES_SQL`, for which `rejected` is simply
 *     terminal. The lane stops replaying and the dedupe slot frees up, which is
 *     the correct consequence: the cancelled kickoff no longer blocks a fresh
 *     one to that same id.
 *
 * `COALESCE(d.lastError, '')` (nit I7): SQLite's `!=` — and `NOT IN`, which
 * D-1143 widened it to for the second member, on the identical NULL rule —
 * is NULL, not true, against a NULL `lastError` (a delivery rejected for a
 * reason that never wrote one), and NULL is FALSY in a `WHERE` — the bare
 * comparison silently dropped exactly that row out of the whole OR chain
 * instead of counting it as abandoned.
 *
 * ALSO EXCLUDES an abandoned row whose OWN run has since reached a terminal
 * state (orchestrator ruling I2, part (a) — "run close clears by
 * derivation, not mutation"): before this clause, an abandoned delivery
 * (parked at the replay ceiling, `MAIL_REPLAY_CEILING_ERROR` above) was
 * permanently outstanding — `cancelOutstandingDeliveries` only ever matches
 * `queued`/`delivered` rows, so a run's close never touches a delivery that
 * was already `rejected` for a DIFFERENT reason, and `markAcked` refused
 * every `rejected` row outright. The MailStrip row and `unreadMail` count
 * survived both acking and run close, forever. Rather than teach a writer to
 * chase this (another mutation, another race with the same close-time park
 * this file's other comments spend so many words guarding against), the
 * READ derives it: `rr.state` (via the `LEFT JOIN runs rr ON rr.id =
 * m.runId` every caller of this fragment now carries) is checked directly,
 * and `COALESCE(rr.state, '')` — not a bare `rr.state NOT IN (...)` — is
 * deliberate: SQLite's `IN` against a NULL `rr.state` (no run named at all,
 * `m.runId IS NULL`, or a runId the `runs` table has no row for) is NULL,
 * and `NOT NULL` is NULL, not TRUE, which would silently exclude a
 * NULL-runId abandoned row instead of leaving it visible until acked —
 * exactly the outcome the ruling's own text calls out. Written entirely as
 * a `LEFT JOIN` in this one SQL definition: no writer touched, no park
 * restamped, every existing park-immutability guard in this file (`markDelivered`/
 * `backOff`/`rejectDelivery`'s own `NOT IN ('acked','rejected')` guards)
 * unchanged.
 *
 * DELIBERATELY NOT threaded through `hasOutstandingMail` (the dedupe guard
 * on `queueSystemMail`'s own retry loop) or `dueDeliveries`/`markDelivered`/
 * `rejectDelivery`'s own `NOT IN ('acked','rejected')` write-guards — this
 * predicate answers "is this worth a human's attention", a UI-facing
 * question, not "should the delivery lane act on this again", which stays
 * exactly `'rejected'`-is-terminal (bounded context 5) for every one of
 * those.
 */
const OUTSTANDING_OR_ABANDONED_SQL =
  `(d.state IN ${OUTSTANDING_STATES_SQL} OR (d.state = 'rejected' ` +
  `AND COALESCE(d.lastError, '') NOT IN ${DELIBERATE_CANCEL_ERRORS_SQL} ` +
  "AND COALESCE(rr.state, '') NOT IN ('done','failed')))";

/** The joined row shape `mailForRecipient` and `outstandingMailFor` both
 *  read — they differ only in their WHERE clause, never in these columns.
 *
 *  `d.id AS deliveryId` ALONGSIDE `m.id AS id` (blocking review finding,
 *  re-opened D-41): `m.id` (`mail.id`) and `d.id` (`mail_deliveries.id`) are
 *  two independent `AUTOINCREMENT` sequences (`schema.ts`) that only walk
 *  together while every mail resolves to exactly one delivery. Both
 *  `GET /api/mail/:id` (`deliveryEnvelope`) and `POST /api/mail/:id/ack`
 *  (`coord.delivery`) key on the DELIVERY id, and the reference-nudge
 *  protocol (`renderMailNudge`, `coord/envelope.ts`) sends a worker straight
 *  from this listing into both of those routes — without this column the
 *  only id on offer was `mail.id`, which resolves the WRONG row (or 404s)
 *  the moment one mail fans out to more than one recipient. */
const MAIL_ROW_COLUMNS =
  'm.id AS id, d.id AS deliveryId, m.at AS at, m.fromId AS fromId, d.toId AS toId, m.runId AS runId, ' +
  'm.kind AS kind, m.subject AS subject, m.artifacts AS artifacts, d.state AS state, ' +
  // Task 408: the two columns the lane has always WRITTEN and nothing ever
  // read. `state` alone cannot tell a delivery blocked against a dirty input
  // box from one merely waiting for its next attempt window.
  'd.attempts AS attempts, d.lastError AS lastError, ' +
  // D-792: WHAT refused it, and for how long. Both mail reads share this
  // one list, so the gate reaches every consumer through a single reader
  // (`hydrateMail`) rather than being added to each query in turn.
  'd.lastGate AS lastGate, d.gateCount AS gateCount, ' +
  'd.gateSince AS gateSince, d.gateAt AS gateAt';

interface MailRowDb {
  id: number; deliveryId: number; at: number; fromId: string; toId: string; runId: number | null;
  kind: string; subject: string; artifacts: string; state: string;
  attempts: number; lastError: string | null;
  lastGate: string | null; gateCount: number; gateSince: number | null; gateAt: number | null;
}

/** A route argument can never ask either mail read to walk more history (or
 *  more outstanding rows) than is reasonable to JSON-stringify into one
 *  response — the same clamp `mailForRecipient` has always applied, now
 *  shared with `outstandingMailFor`. */
const clampMailLimit = (limit: number): number =>
  Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 100;

/** One row of `lifecycle_generations`. `retired` is a boolean here and an
 *  INTEGER in the column — the narrowing happens once, in
 *  `journalGenerations`, so no caller ever sees SQLite's 0/1. */
export interface JournalGeneration {
  gen: string; firstSeenAt: number; lastSweepAt: number;
  cursor: number; size: number; retired: boolean;
}

/**
 * One `(observed class, declared surface)` pair off a lifecycle row — the only
 * type that crosses the L1/L3 seam carrying two of the three identity
 * families, and the one place their two legitimate spellings are reconciled.
 *
 * THE WIRE/JOURNAL FIELDS ARE `obs.cg` AND `dec.surface`; the DERIVED PAIR is
 * `obsClass`/`decSurface`, matching `corroboration(obsClass, decSurface)`'s own
 * parameter names. Both spellings are correct at their own layer; this
 * docstring is what stops a later reader "fixing" either one. Likewise `id`:
 * the COLUMN is `sessionId` (because `id` is `lifecycle_events`' autoincrement
 * key) and the SQL below aliases it back.
 *
 * Both strings are RAW. Narrowing them is `corroboration`'s job and
 * `divergence.ts`'s call, and this type must not pre-empt it by claiming they
 * are members of anything.
 */
export interface ProvenancePair {
  readonly id: string;
  readonly at: number | null;
  readonly obsClass: string;
  readonly decSurface: string;
}

/** JSON text out of a column back to `unknown`, or null. Never throws: a
 *  column this process wrote can still be a column an older build wrote. */
const jsonOrNull = (s: string | null): unknown => {
  if (s === null) return null;
  try { return JSON.parse(s); } catch { return null; }
};

/**
 * Every read and every write of the coordination database, in one class, and
 * SYNCHRONOUS throughout — `DatabaseSync` has no async surface, so a whole
 * transaction runs without yielding the event loop and nothing can interleave
 * inside one. That is why there is no `KeyedQueue` here and no lock: the
 * serialisation the `KeyedQueue` gives injection (`server/src/inject/queue.ts`)
 * is already given here by the runtime.
 *
 * NO `SELECT *` ANYWHERE IN THIS FILE. Columns are named explicitly on every
 * read, which is exactly what makes "an older build ignores unknown columns"
 * (spec:78-81) true rather than aspirational.
 */
export class CoordStore {
  constructor(readonly db: DatabaseSync) {}

  // ── programs & runs ────────────────────────────────────────────────────────

  openRun(input: {
    program: string; title: string; project: string;
    wave: number; waveOf: number | null; claimedBy: string;
  }): OpenRunResult {
    return tx(this.db, () => {
      // `AND claimedBy IS NOT NULL` (deviation D-12, found in Task 3 review —
      // the original query read the absolute first row regardless of whether
      // it was ever claimed): `reconstruct` inserts every rebuilt run with
      // `claimedBy` bound to NULL — it has no way to know who will resume the
      // program — so without this clause the lowest-id row of a reconstructed
      // program pinned the guard at NULL forever and a second coordinator was
      // never refused. Skipping the unclaimed rows finds the first row a real
      // `openRun` actually claimed, which is the one the refusal must read.
      const existing = this.db.prepare(
        'SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id LIMIT 1',
      ).get(input.program) as { claimedBy: string | null } | undefined;
      // spec:291-292: multi-coordinator arbitration is a NON-GOAL. A second
      // coordinator is refused AT OPEN TIME, in words, rather than silently
      // allowed to interleave dispatches with the first one's. What this refusal
      // no longer means is "forever": `reclaimProgram` below rewrites the column
      // this reads, for a claimant measured dead. The refusal is still the only
      // answer to two LIVE coordinators — nothing arbitrates between them — and
      // that is the non-goal spec:291-292 actually names.
      if (existing?.claimedBy != null && existing.claimedBy !== input.claimedBy) {
        return { refused: 'claimed-by-another' as const, by: existing.claimedBy };
      }
      // Idempotent retry (fix — review findings 19/32): a run already open,
      // `planned`, and claimed by the SAME coordinator for this exact
      // (program, wave, waveOf) is REUSED rather than duplicated. Without
      // this, an HTTP retry after a client timeout on a successful open, or
      // after a transient `ws-hold` 501/502 on the wave N>=2 reclaim path
      // below (the row is already committed by the time that call runs),
      // minted a SECOND `planned` row pointing at the same claim — two
      // dispatchable runs for one piece of work, and (finding 32)
      // `programOpenRunCount` counting the orphan forever, wedging
      // `resolveCoordinator(null)`'s "exactly one active program" guard the
      // same way D-26/D-51 were filed to prevent. Scoped to `state =
      // 'planned'`: a run that has already dispatched, closed, or failed is
      // never a stand-in for a fresh open call naming the same wave.
      const dup = this.db.prepare(
        "SELECT id, state FROM runs WHERE program = ? AND wave = ? AND (waveOf IS ?) " +
        "AND claimedBy = ? AND state = 'planned' ORDER BY id LIMIT 1",
      ).get(input.program, input.wave, input.waveOf, input.claimedBy) as
        { id: number; state: string } | undefined;
      if (dup) {
        return { id: dup.id, program: input.program, state: isRunState(dup.state) ? dup.state : 'unknown' };
      }
      const now = Date.now();
      this.db.prepare(
        'INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(slug) DO UPDATE SET title = excluded.title',
      ).run(input.program, input.title, now, 'active');
      const res = this.db.prepare(
        'INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(input.program, input.wave, input.waveOf, input.project, 'planned', input.claimedBy, now);
      return { id: Number(res.lastInsertRowid), program: input.program, state: 'planned' as const };
    });
  }

  /**
   * The whole reclaim commit, as ONE transaction — `dispatchRun`/`closeRun`'s
   * shape (D-277's argument applied to a batch instead of a sequence). It is
   * ONE `tx()` and it calls no public method that opens its own:
   * `DatabaseSync` transactions do not nest, the rule `advanceInner`'s
   * docstring (:514-520) states in full. `recordRunEvent` is safe here for the
   * same reason `cancelOutstandingDeliveries` is safe inside `closeRun` — it
   * holds no `tx()`.
   *
   * EVERY RUN OF THE PROGRAM IS REWRITTEN, TERMINAL ONES INCLUDED (operator
   * ruling R1, D-1123). Both readers of this column — `openRun`'s
   * one-coordinator guard (:381-383) and `resolveCoordinator(null)`
   * (:1282-1284) — run the identical
   * `SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL
   * ORDER BY id LIMIT 1`, with NO state predicate and lowest id first. On a
   * program standing at wave 5 the lowest claimed id IS wave 1's closed run, so
   * a rewrite scoped to non-terminal runs leaves both readers answering the dead
   * session and the wedge outlives the door built to clear it. Terminality is
   * about what may still HAPPEN to a run; this column is about who is driving
   * the program, and those are not the same question.
   *
   * SO THIS `WHERE` CARRIES NO STATE PREDICATE AT ALL, and the omission is a
   * decision rather than an oversight (D-1135): this file holds two disagreeing
   * answers to "terminal" — `TERMINAL_RUN_STATES` is DERIVED from
   * `RUN_TRANSITIONS` and yields three words, while eight SQL predicates here
   * hand-write two — and a method that needed the word would have to pick one.
   * Ruling R1 means this one does not, so it does not inherit the disagreement.
   *
   * A row whose `claimedBy` IS NULL STAYS NULL. `reconstruct` mints rebuilt runs
   * that way because it cannot know who will resume the program, and D-12's
   * clause exists to skip them; writing a claimant into one here would hand the
   * guard a row it was deliberately taught to ignore.
   *
   * `causedBy` is the literal `operator`, hardcoded at this one call site and
   * never read from a request body. Attribution, not authentication
   * (spec:26-30) — and on an operator door that carries no box token, a
   * body-supplied `causedBy` is a free-text field writing the audit trail.
   *
   * THE MAIL MOVES WITH THE CHAIR, IN THIS SAME TRANSACTION (D-1141/D-1143,
   * blocking review MAJOR 1 and MINOR 9). Until this round the reclaim rewrote
   * `runs.claimedBy` and NOTHING else, and `mail_deliveries.toId` is frozen to
   * the RESOLVED id at queue time — `coord/routes.ts` resolves `coordinator` once
   * through `resolveCoordinator` and hands the answer to `queueDelivery`, which
   * is the only writer of that column in the tree. `GET /api/mail` is
   * recipient-scoped. So a wave-done the worker sent minutes before the reclaim
   * stayed addressed to the corpse while `resolveCoordinator(runId)` answered the
   * heir: the heir's box read empty, the sweep walked the report to
   * `rejected('undeliverable')`, and the wave's own report was lost — with the
   * coordinator corpus (`ccd/coordinator-skill/references/resume.md`) sending the
   * heir to that empty box in as many words, "read outstanding mail before
   * deciding anything".
   *
   * `mail.toId` DECIDES, because it already records the addressing. It keeps the
   * PRE-resolution recipient — the literal role `coordinator`, or a literal
   * session id — beside `mail_deliveries.toId`'s resolved answer, which is
   * exactly the distinction this fix turns on and the reason no new column is
   * needed for it:
   *   (a) role-addressed (`mail.toId = 'coordinator'`), naming a run of THIS
   *       program, still outstanding, addressed to a displaced claimant ->
   *       REPOINTED. Mail sent to a ROLE follows the role.
   *   (b) addressed to a literal session id -> LEFT. It was sent to a session,
   *       not to a chair, and the session is the same session it always was.
   *   (c) already `acked` or otherwise terminal -> NEVER MOVED. That is
   *       `OUTSTANDING_STATES_SQL`, the constant, not a fourth hand-written pair
   *       of words.
   *   (d) role-addressed with `mail.runId` NULL -> LEFT. See D-1142 on
   *       `repointCoordinatorMail` below: it cannot be PROVEN to be this
   *       program's, and the fold is recorded rather than opened.
   * …and, in the opposite direction, an outstanding `program-kickoff` to a
   * displaced claimant is CANCELLED rather than repointed (D-1143,
   * `cancelKickoffsTo`): a re-kickoff queued minutes before a reclaim would
   * otherwise still brief the session the reclaim just displaced, which is two
   * coordinators — the exact state the skill's clause 8 exists to prevent.
   *
   * THE COUNTERS ARE NOT TOUCHED, measured rather than assumed. A repointed row
   * keeps its `attempts`, its `nextAttemptAt` and its gate columns, all of them
   * accumulated against the corpse. That reads wrong and is not: `attempts` only
   * ever ratchets on a SEND FAILURE or a provably-dead recipient (`watch.ts`'s
   * two dead rungs) — every gate (`not-idle`, `not-quiet`, `pending-ask`,
   * cooldown) `continue`s without touching it — so against a LIVE heir the very
   * next due sweep delivers and the ratchet stops. The whole cost is one backoff
   * step of delay, at most `MAIL_BACKOFF_BASE_MS * 2^4` = 8 minutes, and the
   * benefit of resetting them would be to erase the row's own record of what
   * already happened to it. What DOES bound this fix is arm (c) and it is worth
   * knowing: `MAIL_MAX_ATTEMPTS` is 6 on a 30 s doubling, so a never-delivered
   * mail to a provably-dead coordinator parks itself `undeliverable` about
   * fifteen and a half minutes after it was queued. Past that window there is
   * nothing outstanding left to repoint and the report stays on the corpse,
   * visible to `outstandingMailFor(<corpse>)` and to nobody else. Reopening a
   * parked row is a different decision, on a different door, and this one does
   * not make it.
   *
   * THE ENVELOPE IS NOT RE-RENDERED, deliberately (D-1142). `renderEnvelope`
   * runs exactly ONCE, at queue time (spec:174-177, "verbatim, never
   * re-rendered"; `setDeliveryEnvelope`'s own docstring calls itself the second
   * half of that one INSERT and not a second render). A repointed delivery
   * therefore still carries a `to:` line naming the OUTGOING id, and that is
   * accepted rather than papered over: it is a TRUE record of who held the chair
   * when the message was queued, the `ack:` line names the DELIVERY id — which
   * this statement does not change — and the nudge the lane actually types is
   * `renderMailNudge(d.toId)`, a function of the row's CURRENT recipient, so the
   * heir is nudged correctly and finds the stale `to:` only inside the body it
   * fetches. Re-rendering it here would trade a true historical line for a
   * violation of the one rule the mail body has.
   */
  reclaimProgram(runId: number, to: string, at: number): ReclaimProgramResult {
    return tx(this.db, () => {
      const run = this.db.prepare('SELECT program, claimedBy FROM runs WHERE id = ?')
        .get(runId) as { program: string; claimedBy: string | null } | undefined;
      if (!run) return { ok: false as const, kind: 'unknown-run' as const };
      // Refused BEFORE the UPDATE, so a refusal writes nothing at all: an
      // unclaimed run names no handover to make, and rewriting its siblings off a
      // row that never had a claimant is a reassignment nobody asked for.
      if (run.claimedBy === null) return { ok: false as const, kind: 'no-claimant' as const };
      // Read before the write, and excluding rows ALREADY naming `to`: the
      // attribution rows record a CHANGE, so re-running the same reclaim writes
      // none rather than a second identical trail. `ORDER BY id` so `runIds` is
      // the same list twice — the query planner may reach these rows through
      // `runs_by_program` (schema.ts:88) rather than by rowid.
      const moved = this.db.prepare(
        'SELECT id, claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ' +
        'AND claimedBy != ? ORDER BY id',
      ).all(run.program, to) as { id: number; claimedBy: string }[];
      this.db.prepare('UPDATE runs SET claimedBy = ? WHERE program = ? AND claimedBy IS NOT NULL')
        .run(to, run.program);
      for (const m of moved) {
        // One `at` for N rows (D-1134): the operator acted once, and a trail that
        // reads five clock samples describes five acts.
        this.recordRunEvent(m.id, 'operator', `reclaim:${m.claimedBy} -> ${to}`, at);
      }
      // EVERY id THIS RECLAIM DISPLACED, not just `run.claimedBy`. The result's
      // `from` names one row's claimant; `moved` is the set the UPDATE above
      // actually rewrote, and on a program whose rows somehow disagree (a
      // hand-recovered row, a `reconstruct` a human finished by hand) that set
      // has more than one member. The runs half already rewrites all of them —
      // the mail half addressed to only one of them would leave the others'
      // reports on corpses the same rewrite just declared displaced. `to` is
      // never in this set: the `claimedBy != ?` selection above excludes it.
      const displaced = [...new Set(moved.map((m) => m.claimedBy))];
      if (displaced.length > 0) {
        this.cancelKickoffsTo(displaced);
        this.repointCoordinatorMail(run.program, to, displaced);
      }
      return {
        ok: true as const, program: run.program,
        runIds: moved.map((m) => m.id), from: run.claimedBy,
      };
    });
  }

  /**
   * D-1143 (blocking review MINOR 9) — the reclaim's OPPOSITE verb, and the
   * reason it is a second statement rather than a widening of the repoint below.
   *
   * `queueProgramKickoff` addresses the kickoff to a LITERAL session id with
   * `runId: null` (`coord/kickoff.ts`: "It names NO run, because there is none"),
   * so the repoint's own `mail.toId = 'coordinator'` filter already declines it —
   * arm (b). Left at that, a re-kickoff queued minutes before a reclaim goes on
   * briefing the session the reclaim just displaced: two sessions each told they
   * coordinate this program, which is precisely the state
   * `ccd/coordinator-skill/SKILL.md`'s clause 8 exists to prevent. A kickoff is
   * not a report that needs a new reader; it is an INSTRUCTION to take a chair
   * that has just been given to somebody else, and the only honest thing to do
   * with it is to end it.
   *
   * THE PARK IS `cancelOutstandingDeliveries`'s, precedent for precedent:
   * `rejected` + `undeliverable` + a `lastError` of its own
   * (`MAIL_RECLAIM_CANCELLED_ERROR`, excluded from the read-side "needs
   * attention" predicate by `DELIBERATE_CANCEL_ERRORS_SQL` — see that constant
   * and `OUTSTANDING_OR_ABANDONED_SQL`'s own docstring for the reader-by-reader
   * measurement). Not a DELETE: nothing in this tree deletes from
   * `mail_deliveries` ("bound the producer, never the record").
   *
   * THE KEY IS `queueProgramKickoff`'S DEDUPE KEY, three quarters of it: the same
   * `(fromId, runId, subject)` triple `hasOutstandingMail` reads, with `toId`
   * bound to each displaced claimant instead of to one recipient. Written that
   * way on purpose and not as `subject = ?` alone — peer `subject` is
   * caller-chosen free text (D-1041's own finding), so a peer mail that happened
   * to carry this subject would otherwise be parked by an act that has nothing to
   * do with it. The pleasant consequence of matching the key exactly: once these
   * rows are terminal the dedupe slot is free, so a fresh kickoff to that same id
   * is no longer swallowed by the one this cancelled.
   *
   * IT RUNS BEFORE THE REPOINT, and the order is a deliberate choice about
   * MEASURABILITY rather than about behaviour. The two statements are disjoint by
   * construction — this one matches only `mail.runId IS NULL`, the repoint only
   * rows that JOIN a `runs` row — so on correct code the order cannot change the
   * outcome. On INCORRECT code it can: an over-broad cancel running first
   * swallows the row the repoint was supposed to move, and the repoint's own
   * `state IN` guard then leaves it visibly parked. Run second, the same
   * over-broad cancel would find that row already repointed to `to` (never a
   * member of `displaced`) and quietly miss it — a mutation that cannot go red.
   * Narrowing statement first, so a widened one is caught by the suite instead of
   * by a program.
   */
  private cancelKickoffsTo(displaced: readonly string[]): void {
    this.db.prepare(
      "UPDATE mail_deliveries SET state = 'rejected', rejectCode = 'undeliverable', " +
      `lastError = '${MAIL_RECLAIM_CANCELLED_ERROR}' ` +
      `WHERE state IN ${OUTSTANDING_STATES_SQL} AND toId IN (${placeholders(displaced.length)}) ` +
      'AND mailId IN (SELECT id FROM mail WHERE runId IS NULL AND fromId = ? AND subject = ?)',
    ).run(...displaced, 'operator', PROGRAM_KICKOFF_SUBJECT);
  }

  /**
   * D-1141 (blocking review MAJOR 1) — role-addressed mail follows the role.
   *
   * Every arm of the ruling is one clause of this one statement, and none of them
   * is a branch in TypeScript:
   *   `state IN OUTSTANDING_STATES_SQL` is arm (c) — an `acked` delivery, or one
   *     already parked by any writer, is never moved. The CONSTANT, so this query
   *     agrees with `cancelOutstandingDeliveries`, `hasOutstandingMail` and the
   *     read-side predicate by construction rather than by four texts matching.
   *   `d.toId IN (<displaced>)` scopes it to the ids this reclaim actually took
   *     the chair from — never a delivery already addressed to `to`, and never
   *     one addressed to a third session that has nothing to do with this act.
   *   `m.toId = 'coordinator'` is arm (b), and it is the whole reason no new
   *     column is needed: `mail.toId` keeps the PRE-resolution addressing while
   *     `mail_deliveries.toId` carries the resolved answer, so "sent to the
   *     chair" and "sent to that session" are already two distinguishable facts
   *     in this schema.
   *   `JOIN runs r ON r.id = m.runId` scopes it to THIS program — and, being an
   *     inner join, drops every `m.runId IS NULL` row on the way, which is arm
   *     (d) falling out of the SQL rather than needing a branch of its own.
   *
   * D-1142 — THE `runId IS NULL` FOLD, RECORDED AND DELIBERATELY LEFT CLOSED,
   * beside D-1132's own entry in this wave (`coord-kickoff.test.ts`'s
   * `THE FOLD (D-1132)` and the plan's ledger) and for the same shape of reason.
   * A mail addressed to the ROLE with no run named IS reachable: `POST /api/mail`
   * accepts `{toId:'coordinator', runId:null}` and resolves it through
   * `resolveCoordinator(null)`, the single-active-program arm. Once queued,
   * nothing about that row records WHICH program the sender meant — the
   * resolution is spent, `mail.runId` is NULL, and `resolveCoordinator(null)`'s
   * own answer is a function of the fleet's state at the moment it ran, not a
   * fact stored anywhere. Measured: no column, no join and no read in this store
   * can recover it. So repointing such a row would be this method GUESSING that a
   * message with no program on it belonged to the program being reclaimed, on a
   * door whose entire discipline is refusing to guess (`resolveCoordinator`'s own
   * "no guessing", `measureClaimant`'s "doubt is not evidence"). It stays on the
   * outgoing claimant, outstanding and visible at `outstandingMailFor(<that
   * id>)` — the honest outcome, since the party that can tell which program it
   * meant is the human reading it. Recorded here rather than opened; an operator
   * door that re-points one by id is a decision somebody makes on purpose.
   */
  private repointCoordinatorMail(program: string, to: string, displaced: readonly string[]): void {
    this.db.prepare(
      `UPDATE mail_deliveries SET toId = ? WHERE state IN ${OUTSTANDING_STATES_SQL} ` +
      `AND toId IN (${placeholders(displaced.length)}) AND mailId IN (` +
      'SELECT m.id FROM mail m JOIN runs r ON r.id = m.runId ' +
      "WHERE m.toId = 'coordinator' AND r.program = ?)",
    ).run(to, ...displaced, program);
  }

  /**
   * The ONLY way a run's state changes, and the only place a `run_events` row
   * naming a TRANSITION is written — one call, so "every transition records
   * who caused it" (spec:126) is a property of the code rather than of
   * everyone remembering. (Amended for §1.5: `recordRunEvent` below writes the
   * same table for facts that are NOT transitions, and cannot reach `state`.)
   *
   * `causedBy` is `'coordinator' | 'operator' | <session id>` and is NOT
   * validated against the registry: it is attribution, not authentication
   * (spec:26-30), and pretending otherwise in a column comment would be the
   * kind of claim this repo has already had to retract elsewhere.
   */
  advance(runId: number, to: RunState, causedBy: string, detail?: string): AdvanceResult {
    return tx(this.db, () => this.advanceInner(runId, to, causedBy, detail));
  }

  /** `advance`'s body, WITHOUT its own `tx()` wrapper — split out (fix,
   *  review finding 25/D-25's own wedge, reached a second way) so `closeRun`
   *  below can commit `closing` and the final state as ONE transaction
   *  instead of two independent ones. `DatabaseSync`'s transactions do not
   *  nest (a second `BEGIN` while one is open throws), so a caller that needs
   *  atomicity across more than one state write must call THIS, inside its
   *  own single `tx()`, never the public `advance` twice. */
  private advanceInner(runId: number, to: RunState, causedBy: string, detail?: string): AdvanceResult {
    const row = this.db.prepare('SELECT state FROM runs WHERE id = ?').get(runId) as
      { state: string } | undefined;
    if (!row) return { ok: false as const, error: 'unknown-run' as const };
    const from = isRunState(row.state) ? row.state : 'unknown';
    if (!(RUN_TRANSITIONS[from] as readonly string[]).includes(to)) {
      return { ok: false as const, error: 'bad-transition' as const, from, to };
    }
    const now = Date.now();
    this.db.prepare(
      "UPDATE runs SET state = ?, closedAt = CASE WHEN ? IN ('done','failed') THEN ? ELSE closedAt END " +
      'WHERE id = ?',
    ).run(to, to, now, runId);
    this.db.prepare(
      'INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(runId, now, from, to, causedBy, detail ?? null);
    return { ok: true as const, from, to };
  }

  /**
   * A `run_events` row for something that HAPPENED TO a run without changing
   * its state — §1.5's `dispatch-refused:…`, the first such fact this build
   * has. `advance` above stays "the only place a run's state changes"; it is
   * no longer the only place `run_events` is WRITTEN, and that sentence in its
   * docstring has been amended rather than quietly left wrong.
   *
   * `fromState` and `toState` are both the run's CURRENT state, which is the
   * honest encoding of "no transition occurred" — not a sentinel, and not a
   * fabricated hop the `RUN_TRANSITIONS` table would refuse. Unknown run: a
   * silent no-op, because the column is `REFERENCES runs(id)` and the caller
   * (a refusal path) has nothing better to do with the failure than the row
   * itself was going to record.
   *
   * ON THE NOTIFY LANE (amended, wave 2 F2 — the future this paragraph warned
   * about arrived): `FleetWatcher.pushNewRuns` skips any `run_events` row whose
   * run carries no `sessionId`, and §1.5's two callers record BEFORE
   * `coord.setSession` on a wave-1 run, so those still write to the feed and
   * push nothing.
   *
   * The skill preflight (`dispatch.ts`) is the first caller on a BOUND run, and
   * it did exactly what was predicted here: a second `▸ <state>` naming a state
   * the run was already resting in, tagged identically to the transition's own
   * push and carrying none of the preflight fact that motivated the row. The
   * tray collapsed it by tag; the NotifyLog ring and the durable feed did not.
   *
   * So the notify lane now SKIPS any row where `fromState === toState` — every
   * row this method writes, by construction. A non-transition is not a
   * transition notification. The row still lands in `run_events`, which is the
   * trail callers want; what it no longer does is impersonate a state change.
   *
   * `at` IS THE CALLER'S NOW (wave 5, D-1134). The `markDispatchStarted`/
   * `markDispatched` precedent, said there in full: "the caller owns the moment
   * being recorded." Defaulted, so every existing call site (`dispatch.ts:370`,
   * `:409`, `:615`) is unchanged — one call site, one fact, one clock read. The
   * reason it had to become a parameter: a batch that writes N attribution rows
   * for ONE operator act must stamp them with ONE moment, or the trail says the
   * operator acted N times. `reclaimProgram` above is that batch.
   */
  recordRunEvent(runId: number, causedBy: string, detail: string, at: number = Date.now()): void {
    const row = this.db.prepare('SELECT state FROM runs WHERE id = ?').get(runId) as
      { state: string } | undefined;
    if (!row) return;
    this.db.prepare(
      'INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(runId, at, row.state, row.state, causedBy, detail);
  }

  /**
   * The WHOLE dispatch commit, as ONE transaction (D-277 (was D-B4-4)). Before this, the
   * dispatch route ran `markDispatched`, `setClearedAt` and `advance` as three
   * independent `tx()`s — the identical split `closeRun` below was created to
   * close (review finding 25). The work items make it load-bearing rather than
   * merely tidy: spec §3.1 requires that "a refused or failed dispatch leaves
   * no orphan rows", and rows inserted by a fourth independent statement after
   * a crashed third are exactly such orphans — a `planned` run carrying a
   * ledger nothing ever dispatched.
   *
   * Items are inserted AFTER the transition succeeds and INSIDE the same
   * transaction: `advanceInner`'s write is visible to the reads that follow it
   * within one `tx()`, and a refused transition returns before any INSERT
   * runs. What the ONE transaction buys over four independent ones is the
   * THROW case, not the refusal case (both shapes return early on a refused
   * transition): a `node:sqlite` write failure part-way through the ledger
   * rolls the session binding and the `dispatched` state back with it, so the
   * coordinator's retry gets a genuinely fresh dispatch rather than a
   * dispatched run carrying half a ledger. `run-routes.test.ts`'s "rolls the
   * WHOLE dispatch back when an item INSERT throws" is the test that can see
   * the difference; the refusal-shaped cases cannot, and do not claim to.
   */
  dispatchRun(input: {
    runId: number; sessionId: string; workspace: string | null; branch: string | null;
    resumed: boolean; clearedAt: number | null; items: readonly string[]; detail?: string;
    /** F7 (D-1298): what this dispatch DECIDED about the brief, and the
     *  `sendPrompt` refusal that made it false. OPTIONAL on the input so the
     *  disaster-recovery and test callers that know neither may omit both — an
     *  omitted pair leaves the columns NULL, which is exactly the "no dispatch
     *  decided anything here" reading migration 7 reserves for null. */
    briefQueued?: boolean; clearError?: string | null;
  }): AdvanceResult {
    return tx(this.db, () => {
      this.markDispatched(input.runId, input.sessionId, input.workspace, input.branch, input.resumed);
      if (input.clearedAt !== null) this.setClearedAt(input.runId, input.clearedAt);
      // Written UNCONDITIONALLY once `briefQueued` is given, both columns
      // together: recording only the interesting branch would make an older row
      // and a dispatch that queued its brief cleanly indistinguishable, which is
      // the same overloaded null the column's nullability exists to prevent.
      if (input.briefQueued !== undefined) {
        this.db.prepare('UPDATE runs SET briefQueued = ?, clearError = ? WHERE id = ?')
          .run(input.briefQueued ? 1 : 0, input.clearError ?? null, input.runId);
      }
      const adv = this.advanceInner(input.runId, 'dispatched', 'coordinator', input.detail);
      if (!adv.ok) return adv;
      for (const title of input.items) this.addWorkItem(input.runId, title, []);
      return adv;
    });
  }

  /**
   * The WHOLE close-time commit, as ONE transaction (fix — review finding 25,
   * D-25's wedge reached through a different door than the one D-25 itself
   * closed): the close route used to run `advance(id,'closing')` and
   * `advance(id, state)` as two INDEPENDENT transactions. A crash, a
   * `node:sqlite` write failure on a full disk, or a SIGTERM landing between
   * the two left the run wedged in `closing` PERMANENTLY — `RUN_TRANSITIONS.
   * closing = ['done','failed']` has no self-edge, no route in this build
   * exposes `POST /api/runs/:id/advance`'s `to:'closing'`, and every retried
   * close 409s at the route's own precondition before touching anything —
   * verbatim the harm D-48 already named for the OTHER ordering bug. Folding
   * both `advance` calls, the handoff-commit write, the outstanding-delivery
   * cancellation (review findings 8/14 — a run's own queued/delivered-unacked
   * mail must not survive its close and replay into the NEXT wave's freshly
   * `/clear`ed context) and the program-retirement check into one `tx()`
   * means a crash between any two of these statements rolls the WHOLE close
   * back to the run's PRE-close state — still `dispatched`/`working`/
   * `awaiting-review`/`merging` (widened, scoped-verify H5: the other two
   * gained their own direct `closing` edge in `RUN_TRANSITIONS` — see that
   * table's own docstring, "D-9's own text no longer describes this tree" —
   * so a crash mid-close can now roll back to either of them too), legally
   * retryable — rather than to a state with no way out.
   */
  closeRun(input: {
    runId: number; finalState: 'done' | 'failed'; causedBy: string;
    handoffCommit: string | null; program: string; viaClosing: boolean;
  }): AdvanceResult {
    return tx(this.db, () => {
      // `viaClosing: false` is the ABANDON of a `planned` run (D-281 (was D-B4-8)).
      // `RUN_TRANSITIONS.planned` has a `failed` edge and deliberately no
      // `closing` one (`shared/api.ts`'s own docstring), and that table is NOT
      // edited here — clients read it as a refusal vocabulary. So the hop is
      // skipped rather than the table widened; every other statement in this
      // transaction (the handoff write, the delivery cancellation, the
      // program-retirement check) is unchanged and still one commit.
      //
      // No default, for the D-279 (was D-B4-6) reason applied to this parameter: a default
      // is exactly how the abandon path would silently take the ordinary hop
      // and 409 on every wedged `planned` run.
      if (input.viaClosing) {
        const closingAdv = this.advanceInner(input.runId, 'closing', input.causedBy);
        if (!closingAdv.ok) return closingAdv;
      }
      const finalAdv = this.advanceInner(input.runId, input.finalState, input.causedBy);
      if (!finalAdv.ok) return finalAdv;
      // Only a SHAPE-VALID handoff commit is ever written (fix — review
      // findings 6/18): the caller (the close route) runs the same 40-hex
      // `SHA` test `verifyDone` uses, independent of whether `verifyDone`
      // itself ran (it is skipped entirely on an explicit abandon, D-49) —
      // `null` is left standing rather than writing a claim this database has
      // never measured or even shape-checked.
      if (input.handoffCommit !== null) this.setHandoffCommit(input.runId, input.handoffCommit);
      // Review findings 8/14: cancel this run's own outstanding mail rather
      // than leave it to replay into whatever session (this run's own, next
      // wave, or — once a purged workspace slug is re-minted — an unrelated
      // program entirely) next satisfies `dueDeliveries`'s gate.
      this.cancelOutstandingDeliveries(input.runId);
      // Build 9 D12: the run's claims are released in the SAME transaction as
      // the close — after the final advance succeeded (a refused close
      // releases nothing), beside the delivery cancellation it mirrors. The
      // watcher's `divergence.claim-orphan` is the alarm for the close that
      // never got here.
      this.releaseClaimsForRun(input.runId, Date.now());
      // D-51's program-retirement check, run inside the SAME transaction:
      // the run just closed already reads as terminal to this COUNT, because
      // the write above is visible to a later read within one `tx()`.
      if (this.programOpenRunCount(input.program) === 0) {
        this.setProgramState(input.program, input.finalState === 'failed' ? 'abandoned' : 'done');
      }
      return finalAdv;
    });
  }

  /** Review findings 8/14: every `queued` or `delivered`-but-unacked delivery
   *  of this run's OWN mail, parked `rejected('undeliverable')` — the same
   *  typed park `sweepMail` already uses for a delivery that cannot be
   *  completed. Called from `closeRun`'s own transaction, but plain enough
   *  (no nested `tx()`) to also call standalone, which `mail-sweep.test.ts`'s
   *  unit-level coverage of this method does. An already-`acked` row is left
   *  alone — it is not outstanding, and this is not the ack-race guard
   *  `markDelivered`/`rejectDelivery` carry for THEIR own callers. */
  cancelOutstandingDeliveries(runId: number): void {
    this.db.prepare(
      "UPDATE mail_deliveries SET state = 'rejected', rejectCode = 'undeliverable', " +
      `lastError = '${MAIL_RUN_CLOSED_ERROR}' WHERE state IN ${OUTSTANDING_STATES_SQL} ` +
      'AND mailId IN (SELECT id FROM mail WHERE runId = ?)',
    ).run(runId);
  }

  /**
   * Deviation (found while executing Task 9; not in the plan's own Task 9
   * File Structure entry, which named only `routes.ts` — see the plan's D-45):
   * `POST /api/runs`'s body may name an existing workspace (`sessionId?`,
   * wave N>=2 reclaiming the workspace it held since wave 1) and the OPEN
   * route places the hold immediately — spec:120-123, "When sessionId names
   * an existing workspace, places the hold immediately." Task 9's dispatch
   * route then needs to read `run.sessionId` back OFF THE ROW to decide
   * `CCD_ARGV.wsAdd` vs `CCD_ARGV.ensure` (D-1: "No sessionId on the run ->
   * ws-add; otherwise -> ensure") — but `openRun`'s own signature never took
   * a `sessionId`, and no writer of the column existed for anything but
   * `markDispatched` (a DISPATCH-time write that also stamps
   * `dispatchedAt`/`resumed`, both false of an open-time claim). This is the
   * matching open-time write, on `foldPrLineage`/`setHandoffCommit`'s single-
   * column-`UPDATE` pattern, deliberately NOT touching `dispatchedAt` or
   * `resumed` — a run whose wave N>=2 open just reclaimed its workspace has
   * not been dispatched yet, and must not read as though it had.
   */
  setSession(runId: number, sessionId: string): void {
    this.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(sessionId, runId);
  }

  /**
   * `runs.clearedAt` — the proof D-1's post-resume `/clear` actually
   * committed (`RunSummary.clearedAt`'s own docstring; the column landed in
   * Task 2's v1 DDL, unwritten, per D-1's own amendment). Mirrors
   * `foldPrLineage`/`setHandoffCommit`: a single-column `UPDATE`, called once,
   * by the dispatch route, and ONLY when the injected `/clear` actually
   * verified — a refused send (dialog open, draft present) leaves this
   * column honestly null, never called with a guess. */
  setClearedAt(runId: number, at: number): void {
    this.db.prepare('UPDATE runs SET clearedAt = ? WHERE id = ?').run(at, runId);
  }

  /**
   * Did a LIVE run's dispatch record that it typed `/clear` into this
   * session's box and never had it taken? (Task 407.)
   *
   * The provenance half of `sendPrompt`'s `ownStrandedClear` gate, and the
   * only thing in this system that can answer it. `dispatch.ts` types the
   * literal `/clear` into a resumed worker before its wave brief; when the
   * Enter is swallowed it writes `clear-refused:enter-ignored` onto the run
   * (D-47). That row is the record — the text in the box is not, because
   * `/clear` is four characters a human plausibly types and leaves sitting,
   * and nothing about the STRING distinguishes ours from theirs. No row, no
   * permission: `sendPrompt` refuses `draft-present` exactly as it does today,
   * which is the default rather than a fallback (operator ruling).
   *
   * THREE NARROWINGS, all deliberate:
   *  - `CLEAR_REFUSED_STRANDS_TEXT` only — see its own docstring for why
   *    `verify-failed`, which since Build 8 also leaves text in the box, is
   *    NOT proof of what is in it.
   *  - a run in a TERMINAL state grants nothing: a run nobody is waiting on
   *    is not a run whose box anyone is about to read.
   *  - AND THE PROOF IS SPENT BY THE FIRST DELIVERY THAT LANDS (review, W4c
   *    finding 1). Without this the row licensed a C-u at that box on EVERY
   *    later delivery for the whole life of the run — `run_events` rows are
   *    durable forever — so one strand, once, permanently defeated the
   *    operator ruling for that session: refuse-only EXCEPT where the lane
   *    can prove it typed THAT text. A proof that outlives the text it is
   *    about is not a proof of it.
   *
   * WHAT SPENDS IT, and why that fact and not a clock. `sweepMail` calls
   * `markDelivered` only on `sendPrompt`'s `ok`, which means the box echoed
   * our text and was EMPTY after Enter — so a delivery landed in this session
   * at or after the strand is durable, server-MEASURED evidence that the
   * stranded `/clear` is no longer in that box. Anything typed there since is
   * somebody else's, and gets the ordinary `draft-present` refusal. A time or
   * attempt bound was the alternative and is strictly worse here: the wedge
   * survives untouched for as long as no mail is due, so a clock would revoke
   * a proof that is still exactly true, and grant one that is not, purely on
   * how busy the program happened to be. `>=`, not `>`: a same-millisecond
   * tie retires the proof, biasing the ambiguous case toward the refusal. A
   * row still QUEUED carries a null `deliveredAt` and fails that comparison
   * on its own (SQLite's three-valued logic), so there is deliberately no
   * separate null check — it would be a conjunct no mutation could turn red.
   *
   * WHAT IT DOES NOT COVER, stated rather than discovered: a box emptied by
   * something this store cannot see — a later dispatch's own `/clear`, or an
   * operator (or the PWA composer) sending a turn by hand — leaves the proof
   * standing, because none of those write a durable row here. The terminal-
   * state narrowing above is the only backstop for that case. Closing it
   * properly means a fact about the BOX, which nothing in this system records
   * today.
   *
   * SYNCHRONOUS, like everything here, and a dedicated one-row read: it runs
   * only for a delivery that has already cleared every gate and is about to
   * be typed, never over every due row on every sweep. The `mail_deliveries`
   * arm has no index to use (`toId` carries none — `mailForRecipient` scans
   * it too), which is affordable at exactly that call rate and would not be
   * on a per-row one.
   */
  strandedClear(sessionId: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS x FROM run_events e JOIN runs r ON r.id = e.runId ' +
      `WHERE r.sessionId = ? AND e.detail = ? AND r.state NOT IN (${TERMINAL_RUN_STATES.map(() => '?').join(', ')}) ` +
      'AND NOT EXISTS (SELECT 1 FROM mail_deliveries d ' +
      'WHERE d.toId = r.sessionId AND d.deliveredAt >= e.at) ' +
      'LIMIT 1',
    ).get(sessionId, CLEAR_REFUSED_STRANDS_TEXT, ...TERMINAL_RUN_STATES);
    return row !== undefined;
  }

  /** Stamped immediately BEFORE the `ws-add` that mints a fresh workspace —
   *  the one moment the run knows a dispatch is in flight and the session id
   *  does not exist yet (the server learns that id by registry diff, after the
   *  call returns). A MEASUREMENT, not a mode flag: nothing clears it, `state`
   *  moving to `dispatched` is what ends the "dispatching" render, and
   *  `dispatchedAt - dispatchStartedAt` is then how long the spawn took. A
   *  retry overwrites it with the new attempt's start, which is the honest
   *  answer to "when did the dispatch that is running now begin".
   *
   *  ONE CALL SITE, AND IT IS THE FRESH-SPAWN ARM: the wave N>=2 resume (D-1)
   *  deliberately does not call this, so NULL means "no fresh-spawn dispatch
   *  has started" and not "nothing has been dispatched" — see
   *  `RunSummary.dispatchStartedAt`, which names both conditions, and the pin
   *  in `run-routes.test.ts` that makes the scope cost a test to change.
   *
   *  `setSession`/`setClearedAt`/`setHandoffCommit`'s single-column `UPDATE`,
   *  and deliberately touching NOTHING else — least of all `state`, which is a
   *  separate write with its own `run_events` attribution. Takes `at` rather
   *  than reading a clock, on `markDispatched`'s precedent: the caller owns the
   *  moment being recorded. */
  markDispatchStarted(runId: number, at: number): void {
    this.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(at, runId);
  }

  /** Dispatch's write: the workspace a run landed in, and whether it was a
   *  fresh spawn or D-1's resume+`/clear`. Does NOT itself advance `state` —
   *  the caller (Task 9's dispatch route) calls `advance` separately, so the
   *  two writes stay independently attributable in `run_events`.
   *
   *  `workspace`/`branch` are nullable, matching the column (`runs.workspace`/
   *  `runs.branch`, both `TEXT` with no `NOT NULL`) and `RunSummary`'s own
   *  wire type — Task 9's dispatch route resolves both from the live
   *  registry (falling back to the run row on wave N>=2, the identical
   *  fallback `fingerprint.ts`'s `verifyDone` uses), which can genuinely come
   *  back empty for a registry row `readRegistry` otherwise accepted. */
  markDispatched(runId: number, sessionId: string, workspace: string | null, branch: string | null,
                 resumed: boolean, at: number = Date.now()): void {
    this.db.prepare(
      'UPDATE runs SET sessionId = ?, workspace = ?, branch = ?, resumed = ?, dispatchedAt = ? WHERE id = ?',
    ).run(sessionId, workspace, branch, resumed ? 1 : 0, at, runId);
  }

  /** `runs.prLineage`, written once at close from a `.prhistory` read
   *  (`coord/prhistory.ts`). Stored as JSON (spec:92-95's fold), never
   *  reconstructed lazily on read — the same "store the render, don't defer
   *  it" reasoning `mail_deliveries.envelope`'s own column comment states. */
  foldPrLineage(runId: number, lineage: readonly PrLineageEntry[]): void {
    this.db.prepare('UPDATE runs SET prLineage = ? WHERE id = ?').run(JSON.stringify(lineage), runId);
  }

  /**
   * `runs.handoffCommit`, written once at close (fix, found in a later Task 3
   * review — D-25): before this method the column had exactly one writer in
   * the whole tree, `reconstruct`'s disaster-recovery INSERT, so every run
   * this build actually closed could only ever read `handoffCommit: null` on
   * the wire — silently disagreeing with the fingerprint the close route
   * re-measures and rejects a claim over (`fingerprint.ts`'s `no-handoff-
   * commit`, D-2). Mirrors `foldPrLineage`'s shape on purpose: a single-
   * column UPDATE, called once, at close. `closeRun` above is the caller
   * (fix, review finding 28: this docstring called Task 9's close route
   * "not yet written in this tree" for two fix rounds after it was — the
   * same staleness D-51 was filed against a neighbouring comment for, not
   * caught here at the time).
   */
  setHandoffCommit(runId: number, handoffCommit: string): void {
    this.db.prepare('UPDATE runs SET handoffCommit = ? WHERE id = ?').run(handoffCommit, runId);
  }

  run(id: number): RunRow | null {
    const row = this.db.prepare(
      `SELECT ${RUN_ROW_COLUMNS} FROM runs r JOIN programs p ON p.slug = r.program WHERE r.id = ?`,
    ).get(id) as RunRowDb | undefined;
    if (!row) return null;
    return this.hydrateRun(row, this.healthFor([row]).get(row.id)!);
  }

  /**
   * `includeClosed` (fix, review finding 24): the archive half was the one
   * read on this whole branch with no clamp on either side — `?closed=1`
   * walked the entire `runs` table, forever, with no LIMIT and no
   * retention, unlike every sibling read this build added or touched
   * (`feedEvents` clamps into `FEED_RETENTION`; `mailForRecipient`/
   * `outstandingMailFor` clamp at `clampMailLimit`'s 500). After a year of
   * programs this was every run ever recorded, rendered into one unbounded
   * DOM list, plus a per-row `unreadMailCount` subquery apiece.
   *
   * The clamp is asymmetric ON PURPOSE: an ACTIVE run (`state NOT IN
   * ('done','failed')`) is never dropped by it, however old — the live
   * board's whole job is showing every run still moving, and a program that
   * has been open for a year is exactly the one an operator most needs to
   * see, not the one to hide behind a LIMIT. Only the FINISHED half — which
   * grows without bound and is read-once-per-mount archive material, not a
   * live signal — is capped, to the newest `closedLimit` rows by id (a
   * closed run's id only ever moves forward). `runsFrameSeen`+the live
   * `{type:'runs'}` frame is what proves an active run "still there" isn't
   * silently truncated: this method's own `includeClosed:false` branch
   * (used by that frame) carries no LIMIT at all, clamped or otherwise.
   */
  runs(opts: { includeClosed?: boolean; closedLimit?: number } = {}): RunRow[] {
    if (!opts.includeClosed) {
      const rows = this.db.prepare(
        `SELECT ${RUN_ROW_COLUMNS} FROM runs r JOIN programs p ON p.slug = r.program ` +
        "WHERE r.state NOT IN ('done','failed') ORDER BY r.id",
      ).all() as unknown as RunRowDb[];
      const health = this.healthFor(rows);
      return rows.map((row) => this.hydrateRun(row, health.get(row.id)!));
    }
    const n = clampMailLimit(opts.closedLimit ?? 500);
    const rows = this.db.prepare(
      `SELECT ${RUN_ROW_COLUMNS} FROM runs r JOIN programs p ON p.slug = r.program ` +
      "WHERE r.state NOT IN ('done','failed') OR r.id IN " +
      "(SELECT id FROM runs WHERE state IN ('done','failed') ORDER BY id DESC LIMIT ?) " +
      'ORDER BY r.id',
    ).all(n) as unknown as RunRowDb[];
    const health = this.healthFor(rows);
    return rows.map((row) => this.hydrateRun(row, health.get(row.id)!));
  }

  /**
   * "Which OPEN runs name this session?" — the question the hold file
   * structurally cannot answer, asked at three destructive decision points.
   *
   * SYNCHRONOUS, like the rest of `CoordStore`. DO NOT WRAP IT ASYNC: the
   * store's synchrony is a stated concurrency invariant, and this read sits
   * OUTSIDE any transaction, so it neither lengthens one nor introduces an
   * `await` inside one — wrapping it is the only move that would threaten
   * the invariant.
   *
   * NO `AND dispatchedAt IS NOT NULL`. It looks like D-13's predicate on
   * `capsUsage`, but D-13 guards a GLOBAL, SESSION-LESS count whose problem
   * class is `planned` rows with no session — already excluded here by
   * `WHERE sessionId = ?`. Importing it would REINTRODUCE F9, because
   * `POST /api/runs` places the wave-N+1 hold at OPEN time, before any
   * dispatch, so a live claim legitimately belongs to a run with
   * `dispatchedAt IS NULL`. This sentence exists so a later reviewer does
   * not "fix" it.
   *
   * Nothing at this layer prevents two open runs naming one session
   * (`setSession`/`markDispatched` are bare UPDATEs with no uniqueness
   * constraint) and that is CORRECT — the coordinator protocol deliberately
   * creates that state by opening wave N+1 before closing wave N.
   *
   * `excludeRunId` defaults to `-1`, an id AUTOINCREMENT never mints, so the
   * "no exclusion" call and the excluding call are ONE query, not two.
   */
  openRunsForSession(sessionId: string, excludeRunId?: number): OpenSibling[] {
    return this.db.prepare(
      'SELECT id, program, wave, waveOf FROM runs ' +
      "WHERE sessionId = ? AND state NOT IN ('done','failed') AND id != ? ORDER BY id",
    ).all(sessionId, excludeRunId ?? -1) as unknown as OpenSibling[];
  }

  /** The sessions COORDINATING something live: every distinct `claimedBy` of a
   *  run this build calls non-terminal. NOT `openRunsForSession`'s question one
   *  method up — that one keys on `sessionId`, the WORKER column, which is the
   *  opposite fact about the same row (D-1241).
   *
   *  Two columns, no JOIN and no `hydrateRun`, for `OpenSibling`'s own stated
   *  reason (`:53-57`): dragging `prLineage` JSON and a `programs` join through
   *  a question that turns on one column is a cost this file does not pay.
   *  `runs({includeClosed:false})` would answer and would pay it, per row, on
   *  the box's busiest loop.
   *
   *  The predicate is `programOpenRunCount`'s (`:1284`), COPIED rather than
   *  re-derived. `RUN_TRANSITIONS` would answer differently — it gives
   *  `'unknown'` an empty target list, so a table-derived predicate would call
   *  an `'unknown'` row terminal while every shipped query here counts it open.
   *  That divergence is latent (this build never writes `'unknown'`; it is what
   *  a newer build's row degrades to on read), and it stays latent only while
   *  new predicates copy the SQL spelling instead of re-deriving one.
   *
   *  A row whose `claimedBy` was rewritten onto a TERMINAL run by
   *  `reclaimProgram` (`:620-660`) does not appear here, and must not: that
   *  rewrite deliberately covers every run of a programme, so appearing in some
   *  `claimedBy` is not evidence of coordinating anything live.
   *
   *  Synchronous, like every other read on this store — its synchrony is a
   *  stated concurrency invariant, not an oversight to be wrapped. */
  openCoordinatorIds(): string[] {
    return (this.db.prepare(
      'SELECT DISTINCT claimedBy FROM runs ' +
      "WHERE claimedBy IS NOT NULL AND state NOT IN ('done','failed')",
    ).all() as { claimedBy: string }[]).map((r) => r.claimedBy);
  }

  /** `detail` joins the SELECT (fix, found in Task 9 review — D-47): `advance`
   *  has always taken a `detail` parameter, but until the dispatch route's
   *  refused-`/clear` fix started passing one, nothing in this file ever
   *  wrote a non-null value, so no reader had ever needed the column back.
   *  Widening the return type is additive-only — every existing caller reads
   *  a subset of these fields, never the whole shape by positional index. */
  runEvents(runId: number): { at: number; fromState: string; toState: string; causedBy: string; detail: string | null }[] {
    return this.db.prepare(
      'SELECT at, fromState, toState, causedBy, detail FROM run_events WHERE runId = ? ORDER BY id',
    ).all(runId) as { at: number; fromState: string; toState: string; causedBy: string; detail: string | null }[];
  }

  /**
   * The writer `programs.state` had none of, outside `openRun`'s hardcoded
   * `'active'` at first open (fix, found in a later Task 3 review — D-26):
   * the two `INSERT … ON CONFLICT(slug) DO UPDATE` sites (`openRun`,
   * `reconstruct`) both only ever touch `title` in their conflict arm, so a
   * program could never be retired. That silently disarmed
   * `resolveCoordinator(null)` the moment a SECOND program existed — its
   * "single active program" guard reads `ambiguous` (`active.length !== 1`)
   * forever once a prior program's runs finish and nothing ever moves it out
   * of `active`, which is this build's ordinary steady state, not an edge
   * case. Mirrors `setWorkItemState`'s shape.
   *
   * *Who* calls this and *when* a program should retire was deliberately left
   * to "whichever task closes the last run of a program" — Task 9's close
   * route now does (deviation D-51, found in Task 9 review: this writer had
   * ZERO callers in the tree Task 9 actually shipped, and this very
   * docstring still said "not yet written" about the task that had, by then,
   * been written for two commits). It checks `programOpenRunCount` below
   * immediately after its own final `advance()` succeeds, and calls this
   * with `'done'` or `'abandoned'` depending on how the closing run itself
   * ended — see the close route's own comment for the policy and its stated
   * limitation.
   */
  setProgramState(slug: string, state: ProgramState): void {
    this.db.prepare('UPDATE programs SET state = ? WHERE slug = ?').run(state, slug);
  }

  /** Count of this program's runs still in a NON-terminal state — the
   *  question `setProgramState`'s caller (the close route, D-51) needs
   *  answered to know whether the run it just closed was the LAST one: zero
   *  remaining means nothing under this program can dispatch, mail, or hold
   *  a workspace open any more, so `resolveCoordinator`'s "exactly one
   *  active program" guard (D-26) must stop counting it. Mirrors
   *  `capsUsage().running`'s own `state NOT IN ('done','failed')` predicate,
   *  scoped to one program instead of the whole fleet. */
  programOpenRunCount(program: string): number {
    return (this.db.prepare(
      "SELECT count(*) AS c FROM runs WHERE program = ? AND state NOT IN ('done','failed')",
    ).get(program) as { c: number }).c;
  }

  programs(): { slug: string; title: string; state: ProgramState }[] {
    const rows = this.db.prepare('SELECT slug, title, state FROM programs ORDER BY slug')
      .all() as { slug: string; title: string; state: string }[];
    // D-8: read through the guard, never a cast — the same rule `run()` below
    // holds for `RunState`.
    return rows.map((r) => ({ slug: r.slug, title: r.title, state: isProgramState(r.state) ? r.state : 'unknown' }));
  }

  /** `RunRowDb` -> `RunRow`. The one place a raw `runs` row becomes the typed
   *  shape everything else in this class and its callers use — every enum
   *  column goes through its guard here, never a cast, so this is also the
   *  one place that rule could be forgotten for a future column. */
  private hydrateRun(row: RunRowDb, health: RunHealth): RunRow {
    return {
      id: row.id, program: row.program, programTitle: row.programTitle,
      wave: row.wave, waveOf: row.waveOf, project: row.project,
      sessionId: row.sessionId, workspace: row.workspace, branch: row.branch,
      state: isRunState(row.state) ? row.state : 'unknown',
      // `runs.claimedBy` — TEXT, nullable — read straight through on
      // `sessionId`/`workspace`/`branch`'s idiom two lines up, with no guard
      // of its own: it is a free-form tmux-derived session id, not an enum, so
      // there is no vocabulary to read it through. NULL means no owner was
      // recorded (an older row, a hand-inserted recovery row), never a value
      // this build could not read; `RunSummary.claimedBy` says what a reader
      // does with that.
      claimedBy: row.claimedBy,
      resumed: row.resumed !== 0,
      // A real column (`runs.clearedAt`), read straight through — not a
      // placeholder. `setClearedAt` is Task 9's dispatch route's own write
      // (fix, review finding 28: this comment called that route "Task 9's"
      // as future tense for two fix rounds after it landed and started
      // calling `setClearedAt`) — null still means exactly what it always
      // did for a run that has not resumed-and-cleared: "nothing has
      // cleared anything," never a stand-in for a missing column.
      clearedAt: row.clearedAt,
      // A real column too (`runs.dispatchStartedAt`, migration 5), read
      // straight through on `clearedAt`'s idiom directly above. NULL means no
      // FRESH-SPAWN dispatch has started — which is two named conditions, not
      // one: nobody has dispatched this run, OR every dispatch it has had was a
      // wave N>=2 resume (D-1), which mints no workspace and stamps nothing.
      // Both are stated on `RunSummary.dispatchStartedAt`; neither is ever a
      // stand-in for a column this build could not read.
      dispatchStartedAt: row.dispatchStartedAt,
      openedAt: row.openedAt, dispatchedAt: row.dispatchedAt, closedAt: row.closedAt,
      handoffCommit: row.handoffCommit,
      items: this.itemTally(row.id),
      unreadMail: this.unreadMailCount(row.id, row.sessionId),
      // F7. Passed IN rather than measured here, and that is the whole design:
      // `hydrateRun` runs once per row, and four more per-row reads would cost
      // the board ~3,000 statements on a `?closed=1` load. `runHealth` answers
      // for the whole batch in four (D-1299). A REQUIRED parameter, so a caller
      // cannot forget it and quietly ship a zeroed health object.
      health,
      prLineage: row.prLineage ? (JSON.parse(row.prLineage) as PrLineageEntry[]) : [],
    };
  }

  private unreadMailCount(runId: number, sessionId: string | null): number {
    if (sessionId === null) return 0;
    return (this.db.prepare(
      'SELECT count(*) AS c FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ' +
      'LEFT JOIN runs rr ON rr.id = m.runId ' +
      `WHERE m.runId = ? AND d.toId = ? AND ${OUTSTANDING_OR_ABANDONED_SQL}`,
    ).get(runId, sessionId) as { c: number }).c;
  }

  /** `runHealth` for a batch of rows already read — the shape `runs()`/`run()`
   *  hold. Keeps the id/coordinator extraction in one place so the two call
   *  sites cannot disagree about which sessions count as coordinators. */
  private healthFor(rows: readonly RunRowDb[]): Map<number, RunHealth> {
    const coords = [...new Set(rows.map((r) => r.claimedBy).filter((c): c is string => c !== null))];
    return this.runHealth(rows.map((r) => r.id), coords);
  }

  /**
   * F7: every health fact for a set of runs, in FOUR statements TOTAL — not four
   * per row.
   *
   * The cost is the design (D-1299). `hydrateRun` already spends two statements
   * per row (`itemTally`, `unreadMailCount`), and `runs({includeClosed:true})`
   * returns every open run — deliberately uncapped — plus up to 500 closed ones,
   * so four naive per-row reads would be roughly three thousand statements for one
   * board load. Everything below is a `GROUP BY` over an `IN (...)`.
   *
   * EVERY id in `runIds` gets a row, including a run with no mail at all. A caller
   * forced to supply a default for a missing key is where an overloaded null is
   * born, and this method exists to remove those, not to add one.
   *
   * SYNCHRONOUS, like the rest of this class. Reads only; writes nothing.
   */
  runHealth(runIds: readonly number[], coordIds: readonly string[]): Map<number, RunHealth> {
    const out = new Map<number, RunHealth>();
    for (const id of runIds) {
      out.set(id, { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
                    lastRejectCode: null, briefQueued: null, clearError: null,
                    coordKickoffPendingSince: null });
    }
    // `placeholders` refuses nothing, but an empty `IN ()` is a SQLite syntax
    // error and the guard is the caller's — this method's own, here.
    if (runIds.length === 0) return out;
    const ph = placeholders(runIds.length);

    // (1) outstanding vs parked, and the replay high-water. The deliberate-cancel
    //     exclusion reuses DELIBERATE_CANCEL_ERRORS_SQL rather than respelling the
    //     two literals: `single-definition.test.ts` forbids the second copy, and a
    //     second copy is how the two lists would come to disagree.
    for (const row of this.db.prepare(
      'SELECT m.runId AS runId, ' +
      `SUM(CASE WHEN d.state IN ${OUTSTANDING_STATES_SQL} THEN 1 ELSE 0 END) AS outstanding, ` +
      "SUM(CASE WHEN d.state = 'rejected' AND " +
      `COALESCE(d.lastError, '') NOT IN ${DELIBERATE_CANCEL_ERRORS_SQL} ` +
      'THEN 1 ELSE 0 END) AS parked, ' +
      'MAX(d.replayCount) AS replayMax ' +
      'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ' +
      `WHERE m.runId IN (${ph}) GROUP BY m.runId`,
    ).all(...runIds) as unknown as
      { runId: number; outstanding: number; parked: number; replayMax: number | null }[]) {
      const h = out.get(row.runId);
      if (h === undefined) continue;
      out.set(row.runId, { ...h, mailOutstanding: row.outstanding, mailParked: row.parked,
                           mailReplayMax: row.replayMax ?? 0 });
    }

    // (2) done-claim refusals: how many, and the newest one's code. The
    //     correlated subquery orders by `at` and then `id`, because
    //     `recordRejection` stamps its own `Date.now()` and a retried close can
    //     write two rows inside one millisecond.
    const codes = placeholders(DONE_AUTHORITY_CODES.length);
    for (const row of this.db.prepare(
      'SELECT r.runId AS runId, count(*) AS c, ' +
      '(SELECT x.code FROM mail_rejections x WHERE x.runId = r.runId ' +
      `AND x.code IN (${codes}) ORDER BY x.at DESC, x.id DESC LIMIT 1) AS lastCode ` +
      `FROM mail_rejections r WHERE r.runId IN (${ph}) AND r.code IN (${codes}) GROUP BY r.runId`,
    ).all(...DONE_AUTHORITY_CODES, ...runIds, ...DONE_AUTHORITY_CODES) as unknown as
      { runId: number; c: number; lastCode: string | null }[]) {
      const h = out.get(row.runId);
      if (h === undefined) continue;
      out.set(row.runId, { ...h, doneRejects: row.c, lastRejectCode: row.lastCode });
    }

    // (3) what the last committed dispatch decided, straight off the run row.
    //     `briefQueued === null` is carried through as null, never coerced: the
    //     column is nullable precisely so "no dispatch committed" and "queued no
    //     brief" stay two facts (migration 7, D-1298).
    for (const row of this.db.prepare(
      `SELECT id, briefQueued, clearError FROM runs WHERE id IN (${ph})`,
    ).all(...runIds) as unknown as
      { id: number; briefQueued: number | null; clearError: string | null }[]) {
      const h = out.get(row.id);
      if (h === undefined) continue;
      out.set(row.id, { ...h,
        briefQueued: row.briefQueued === null ? null : row.briefQueued !== 0,
        clearError: row.clearError });
    }

    // (4) the un-briefed coordinator: an OUTSTANDING operator kickoff addressed to
    //     a run's `claimedBy`. `MIN(COALESCE(ingestedAt, deliveredAt, at))` is
    //     `dueDeliveries`' own idiom and for its own reason — a replay rewrites
    //     `deliveredAt` and never touches `ingestedAt`, so preferring
    //     `deliveredAt` would let the clock slide forward on every sweep and the
    //     age would never grow.
    if (coordIds.length > 0) {
      const since = new Map<string, number>();
      for (const row of this.db.prepare(
        'SELECT d.toId AS toId, MIN(COALESCE(d.ingestedAt, d.deliveredAt, m.at)) AS since ' +
        'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ' +
        "WHERE m.fromId = 'operator' AND m.runId IS NULL AND m.subject = ? " +
        `AND d.toId IN (${placeholders(coordIds.length)}) ` +
        `AND d.state IN ${OUTSTANDING_STATES_SQL} GROUP BY d.toId`,
      ).all(PROGRAM_KICKOFF_SUBJECT, ...coordIds) as unknown as
        { toId: string; since: number }[]) {
        since.set(row.toId, row.since);
      }
      if (since.size > 0) {
        for (const row of this.db.prepare(
          `SELECT id, claimedBy FROM runs WHERE id IN (${ph})`,
        ).all(...runIds) as unknown as { id: number; claimedBy: string | null }[]) {
          const h = out.get(row.id);
          if (h === undefined || row.claimedBy === null) continue;
          const at = since.get(row.claimedBy);
          if (at !== undefined) out.set(row.id, { ...h, coordKickoffPendingSince: at });
        }
      }
    }
    return out;
  }

  // ── caps ───────────────────────────────────────────────────────────────────

  caps(): CoordCaps {
    const row = this.db.prepare(
      'SELECT maxConcurrentWorkers, maxSessionsPerDay FROM coordinator_state WHERE id = 1',
    ).get() as { maxConcurrentWorkers: number; maxSessionsPerDay: number };
    return { maxConcurrentWorkers: row.maxConcurrentWorkers, maxSessionsPerDay: row.maxSessionsPerDay };
  }

  setCaps(next: CoordCaps): void {
    this.db.prepare(
      'UPDATE coordinator_state SET maxConcurrentWorkers = ?, maxSessionsPerDay = ?, updatedAt = ? WHERE id = 1',
    ).run(next.maxConcurrentWorkers, next.maxSessionsPerDay, Date.now());
  }

  /**
   * The two COUNTS, derived. `spec:201` says "rows in `coordinator_state`",
   * and the limits ARE rows there — but a stored counter beside them would be a
   * second copy of what `runs` already knows, and the copy is always the one
   * that drifts (`server/src/limits.ts:34-40` states the same lesson about
   * mirroring `_ws_least_loaded`: "put the authority in one place and let the
   * other predict"). Here there is no second box to predict for, so there is no
   * excuse for a second copy at all.
   */
  capsUsage(now: number = Date.now()): { running: number; dispatchedIn24h: number } {
    // `dispatchedAt IS NOT NULL` (deviation D-13, found in Task 3 review):
    // `state NOT IN ('done','failed')` alone also matched `planned` — the
    // state `openRun` writes and Task 9's `ambiguous-dispatch` refusal
    // deliberately leaves a run in, with no session and no workspace. Three
    // botched dispatches on one program would otherwise pin `running` at the
    // default `maxConcurrentWorkers` forever. In normal dispatch flow
    // `dispatchedAt` is the one column only `markDispatched` ever sets, so it
    // names the runs that actually hold a session rather than every
    // non-terminal state; `reconstruct`'s `working` wave (below) is the one
    // other writer, and for the same reason — it too holds a live session,
    // just one the database lost track of rather than one `markDispatched`
    // just minted.
    const running = (this.db.prepare(
      "SELECT count(*) AS c FROM runs WHERE dispatchedAt IS NOT NULL AND state NOT IN ('done','failed')",
    ).get() as { c: number }).c;
    const dispatchedIn24h = (this.db.prepare(
      'SELECT count(*) AS c FROM runs WHERE dispatchedAt IS NOT NULL AND dispatchedAt > ?',
    ).get(now - 24 * 3600_000) as { c: number }).c;
    return { running, dispatchedIn24h };
  }

  // ── work items ─────────────────────────────────────────────────────────────

  addWorkItem(runId: number, title: string, blockedBy: readonly number[]): { id: number } {
    const res = this.db.prepare(
      'INSERT INTO work_items (runId, title, state, blockedBy) VALUES (?, ?, ?, ?)',
    ).run(runId, title, 'pending', JSON.stringify(blockedBy));
    return { id: Number(res.lastInsertRowid) };
  }

  /** Work items have ONE invariant — `done`/`failed`/`abandoned` are terminal —
   *  and per `architecture:145-147` it gets one enforcement point rather than a
   *  `WORK_ITEM_TRANSITIONS` table (`RUN_TRANSITIONS` earns its place by
   *  encoding ~15 edges clients read as refusals; this encodes one).
   *
   *  THE GUARD IS IN THE `WHERE`, not in a read above it. A read-then-write
   *  would answer `ok` for a row a concurrent writer settled between the two
   *  statements — and, worse under a careless edit, would MOVE the row and then
   *  report the refusal. `changes === 0` past a successful lookup means exactly
   *  one thing: the row was already terminal. Mutant duty: deleting the
   *  `state NOT IN` clause, and moving the guard after the UPDATE, each go red
   *  (`coord-store.test.ts`'s two `setWorkItemState` refusal cases, which call
   *  this method DIRECTLY — `settleItems` below refuses earlier, so only a
   *  direct call can discriminate this clause).
   *
   *  RUN-SCOPED (D-278 (was D-B4-5)): `unknown-item` is spec §3.2's "an item id that is not
   *  THIS RUN's", so `runId` is part of both statements and an item of another
   *  run is unknown here, never moved. */
  private static readonly TERMINAL_SQL = `('${TERMINAL_ITEM_STATES.join("','")}')`;

  setWorkItemState(runId: number, id: number, state: WorkItemState,
                   claimedBy: string | null): SetWorkItemResult {
    const row = this.db.prepare('SELECT state FROM work_items WHERE id = ? AND runId = ?')
      .get(id, runId) as { state: string } | undefined;
    if (!row) return { ok: false, why: 'unknown-item' };
    const res = this.db.prepare(
      'UPDATE work_items SET state = ?, claimedBy = ? WHERE id = ? AND runId = ? ' +
      `AND state NOT IN ${CoordStore.TERMINAL_SQL}`,
    ).run(state, claimedBy, id, runId);
    if (Number(res.changes) === 0) {
      return { ok: false, why: 'terminal', state: isWorkItemState(row.state) ? row.state : 'unknown' };
    }
    return { ok: true, state };
  }

  /**
   * The settle batch, as ONE transaction (D-289 (was D-B4-16)) — the third member of the
   * family `dispatchRun` and `closeRun` already belong to (D-277, review
   * finding 25), and here for the same reason plus one more: spec §3.2
   * requires that "a body naming one bad id settles nothing", because
   * "partial success on a ledger write is how tallies drift".
   *
   * WHY THE PRE-PASS AND NOT A THROW. `tx` rolls back on a throw and only on a
   * throw (`db.ts`), so an in-flight refusal would otherwise need a private
   * sentinel class to travel out — in an L1 file that has no business holding
   * this handle at all (D-289). It does not need one HERE: `tx` takes the
   * write lock at `BEGIN IMMEDIATE` and `DatabaseSync` never yields the event
   * loop mid-transaction (`db.ts`'s own `tx` docstring: "no route, sweep or
   * socket can interleave inside one"), so a read taken in the pre-pass cannot
   * be overtaken before the writes below it. A refusal therefore returns
   * BEFORE anything is written, and there is nothing to roll back.
   *
   * The pre-pass carries the batch's OWN effect forward in `effective`: a body
   * naming the same id twice sees the first settle, so a second write onto a
   * now-terminal row is refused — the refusal it would earn from the `WHERE`
   * clause anyway, reached before the first write instead of after it.
   *
   * `setWorkItemState`'s `WHERE` guard stays exactly where it is and is still
   * the invariant's one home. This pass is a PRECHECK, not a second guard, and
   * it reads `TERMINAL_ITEM_STATES` — the same list the SQL literal is built
   * from — so the two cannot drift. If they somehow do, the write loop throws
   * rather than half-writing, and `tx` rolls the whole batch back.
   */
  settleItems(runId: number, items: readonly SettleItem[]): SettleItemsResult {
    return tx(this.db, () => {
      const effective = new Map<number, string>();
      for (const it of items) {
        const current = effective.get(it.id) ?? (this.db
          .prepare('SELECT state FROM work_items WHERE id = ? AND runId = ?')
          .get(it.id, runId) as { state: string } | undefined)?.state;
        if (current === undefined) return { ok: false as const, itemId: it.id, why: 'unknown-item' as const };
        if ((TERMINAL_ITEM_STATES as readonly string[]).includes(current)) {
          return { ok: false as const, itemId: it.id, why: 'terminal' as const,
            state: isWorkItemState(current) ? current : 'unknown' };
        }
        effective.set(it.id, it.state);
      }
      for (const it of items) {
        const res = this.setWorkItemState(runId, it.id, it.state, it.claimedBy);
        if (!res.ok) {
          throw new Error(
            `settleItems: item ${it.id} refused '${res.why}' inside its own transaction — ` +
            'the pre-pass and the WHERE guard disagree, which is a bug, not a refusal',
          );
        }
      }
      return { ok: true as const, items: this.itemTally(runId) };
    });
  }

  /** One run's ledger, in insertion order. Every enum read through
   *  `isWorkItemState`, never a cast — `hydrateRun`'s rule a few hundred lines
   *  up, and for its reason: a token this build does not know (a newer
   *  server's, a rolled-back binary's) reads as the designated `unknown`
   *  member rather than as a raw string nothing downstream can narrow. */
  workItems(runId: number): { id: number; title: string; state: WorkItemState; claimedBy: string | null }[] {
    const rows = this.db.prepare(
      'SELECT id, title, state, claimedBy FROM work_items WHERE runId = ? ORDER BY id',
    ).all(runId) as { id: number; title: string; state: string; claimedBy: string | null }[];
    return rows.map((r) => ({
      id: Number(r.id), title: r.title,
      state: isWorkItemState(r.state) ? r.state : 'unknown',
      claimedBy: r.claimedBy,
    }));
  }

  itemTally(runId: number): RunItemTally {
    const total = (this.db.prepare('SELECT count(*) AS c FROM work_items WHERE runId = ?')
      .get(runId) as { c: number }).c;
    const done = (this.db.prepare("SELECT count(*) AS c FROM work_items WHERE runId = ? AND state = 'done'")
      .get(runId) as { c: number }).c;
    return { done, total };
  }

  // ── mail (rows only; ingress validation is routes.ts, delivery is watch.ts) ─

  insertMail(m: { fromId: string; fromUuid: string; toId: string; runId: number | null;
                  kind: MailKind; subject: string; body: string;
                  artifacts: readonly string[] }): { id: number } {
    const res = this.db.prepare(
      'INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body, artifacts) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(Date.now(), m.fromId, m.fromUuid, m.toId, m.runId, m.kind, m.subject, m.body,
      JSON.stringify(m.artifacts));
    return { id: Number(res.lastInsertRowid) };
  }

  /**
   * `'coordinator'` is a ROLE, not a session id (Task 7's own docstring on the
   * ingress route). With a `runId`, it is that run's own claim; with none, it
   * is the claim of the ONE active program — ambiguous (more than one active
   * program) or absent (no program is both active and claimed) both answer
   * `null`, which the caller turns into `unknown-recipient`: "no guessing" —
   * an agent-to-agent message delivered to the wrong session is worse than
   * one refused with a reason.
   *
   * Mirrors `openRun`'s own one-coordinator guard query (`claimedBy IS NOT
   * NULL ORDER BY id LIMIT 1`) rather than re-deriving a different rule for
   * the same fact.
   */
  resolveCoordinator(runId: number | null): string | null {
    if (runId !== null) {
      const row = this.db.prepare('SELECT claimedBy FROM runs WHERE id = ?')
        .get(runId) as { claimedBy: string | null } | undefined;
      return row?.claimedBy ?? null;
    }
    const active = this.db.prepare("SELECT slug FROM programs WHERE state = 'active'")
      .all() as { slug: string }[];
    if (active.length !== 1) return null;   // no single active program: ambiguous or absent
    const row = this.db.prepare(
      'SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id LIMIT 1',
    ).get(active[0]!.slug) as { claimedBy: string | null } | undefined;
    return row?.claimedBy ?? null;
  }

  /** One delivery row by id, for the ack route: it must know who a delivery
   *  is ADDRESSED TO before deciding whether the acking session may touch it
   *  — `dueDeliveries` cannot answer that, it is scoped to what a SWEEP should
   *  inject, not to one row by id. */
  delivery(id: number): { id: number; mailId: number; toId: string; state: MailDeliveryState } | null {
    const row = this.db.prepare('SELECT id, mailId, toId, state FROM mail_deliveries WHERE id = ?')
      .get(id) as { id: number; mailId: number; toId: string; state: string } | undefined;
    if (!row) return null;
    return { id: row.id, mailId: row.mailId, toId: row.toId,
             state: isMailDeliveryState(row.state) ? row.state : 'unknown' };
  }

  /** The stored envelope for one delivery, for GET /api/mail/:id — the body
   *  channel the reference nudge (robust-mail-delivery spec §1.1/1.2) points
   *  at instead of a typed payload. Separate from `delivery()` so that route's
   *  hot path keeps its narrow 4-column select; this one adds only the single
   *  extra column a body-serving route needs. */
  deliveryEnvelope(id: number): { id: number; toId: string; state: MailDeliveryState; envelope: string } | null {
    const row = this.db.prepare('SELECT id, toId, state, envelope FROM mail_deliveries WHERE id = ?')
      .get(id) as { id: number; toId: string; state: string; envelope: string } | undefined;
    if (!row) return null;
    return { id: row.id, toId: row.toId,
             state: isMailDeliveryState(row.state) ? row.state : 'unknown', envelope: row.envelope };
  }

  /**
   * Every delivery ADDRESSED TO `toId`, newest first, as `MailSummary` — the
   * read side of `GET /api/mail?to=<id>` (review finding 15: this route fell
   * in the seam between the two plans, each naming the other as its author —
   * PR I's own D-9 said "PR J's `POST /api/runs/:id/advance`", PR J's own
   * interface list named PR I as the author of this GET route, and neither
   * shipped it). Joins through `mail_deliveries.toId` — the RESOLVED
   * recipient session, never the literal `'coordinator'` role `mail.toId`
   * may still carry (the same resolution `resolveCoordinator` already
   * performs before `queueDelivery` is ever called) — so a session reading
   * its own outstanding mail sees exactly what it was actually sent.
   * `limit` clamped the same way `feedEvents` clamps its own: a route
   * argument can never ask this table to walk more history than is
   * reasonable to JSON-stringify into one response.
   */
  mailForRecipient(toId: string, limit = 100): MailSummary[] {
    const n = clampMailLimit(limit);
    const rows = this.db.prepare(
      `SELECT ${MAIL_ROW_COLUMNS} FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ` +
      'WHERE d.toId = ? ORDER BY d.id DESC LIMIT ?',
    ).all(toId, n) as unknown as MailRowDb[];
    return this.hydrateMail(rows);
  }

  /**
   * Every delivery addressed to `toId` that still needs a human's attention,
   * newest first — `checkMail`'s (`sessionws.ts`) only caller, and the fix
   * for findings 2/4 (fix round 1): unlike `mailForRecipient`, the state
   * predicate is in the WHERE clause, so `limit` bounds these rows rather
   * than history. Before this method existed, `checkMail` filtered
   * `mailForRecipient`'s own 100-row history window in JS, AFTER the cap —
   * a delivery that was still genuinely queued, but older than the newest
   * 100 deliveries to that recipient, silently fell out of the window the
   * session mail strip watches. The coordinator session is the run-of-the-
   * mill victim: every worker's mail resolves to it (`resolveCoordinator`)
   * across every wave of a program.
   *
   * `OUTSTANDING_OR_ABANDONED_SQL`, not the narrower `OUTSTANDING_STATES_SQL`
   * (fix, review finding 2): a delivery the lane gave up retrying past its
   * own replay/attempt ceiling is `state:'rejected'` on the wire, distinct
   * from `'queued'`/`'delivered'` — a reader that cares can tell the
   * difference — but it stays in THIS list rather than disappearing from it,
   * because it was never acked and never acted on. Excludes the two
   * `'rejected'` shapes that are not abandonment (`DELIBERATE_CANCEL_ERRORS_SQL`
   * — `cancelOutstandingDeliveries`'s park, the run closing making the delivery
   * moot on purpose, and D-1143's reclaim park, the chair changing hands making
   * a kickoff moot the same way) AND, since orchestrator ruling I2(a), an abandoned row whose
   * OWN run has since reached a terminal state — see the predicate's own
   * docstring for why that is derived here, in the `LEFT JOIN runs rr` below,
   * rather than written by any mutation.
   */
  outstandingMailFor(toId: string, limit = 100): MailSummary[] {
    const n = clampMailLimit(limit);
    const rows = this.db.prepare(
      `SELECT ${MAIL_ROW_COLUMNS} FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ` +
      'LEFT JOIN runs rr ON rr.id = m.runId ' +
      `WHERE d.toId = ? AND ${OUTSTANDING_OR_ABANDONED_SQL} ORDER BY d.id DESC LIMIT ?`,
    ).all(toId, n) as unknown as MailRowDb[];
    return this.hydrateMail(rows);
  }

  /** Who sent a mail, under which run, and about what — the three fields a
   *  SENDER-SIDE notification needs and `dueDeliveries` deliberately does not
   *  select. A dedicated one-row read rather than a JOIN widening
   *  `dueDeliveries`: that query runs over every due row on every sweep, and
   *  this runs only when a notification is actually about to be raised.
   *  SYNCHRONOUS, like everything here.
   *
   *  `fromId` is returned RAW, including the literal `'coordinator'`, which is
   *  a ROLE rather than a session id. Resolving it is the caller's job
   *  (`resolveCoordinator`) because only the caller knows whether it is about
   *  to push, and resolving here would hide the unresolvable case behind a
   *  value that looks like an id. */
  mailOrigin(mailId: number): { fromId: string; runId: number | null; subject: string } | null {
    const row = this.db.prepare('SELECT fromId, runId, subject FROM mail WHERE id = ?')
      .get(mailId) as { fromId: string; runId: number | null; subject: string } | undefined;
    return row ?? null;
  }

  /** `MailRowDb` -> `MailSummary`: the one place a raw joined mail/delivery
   *  row becomes the typed shape, shared by `mailForRecipient` and
   *  `outstandingMailFor` — they differ only in their WHERE clause, never in
   *  how a row is read. */
  private hydrateMail(rows: readonly MailRowDb[]): MailSummary[] {
    return rows.map((r) => ({
      id: r.id, deliveryId: r.deliveryId, at: r.at, fromId: r.fromId, toId: r.toId, runId: r.runId,
      kind: isMailKind(r.kind) ? r.kind : 'unknown', subject: r.subject,
      artifacts: JSON.parse(r.artifacts) as string[],
      state: isMailDeliveryState(r.state) ? r.state : 'unknown',
      // RAW, both of them. `lastError` is free text (four writers, four kinds
      // of thing — see `MailSummary.lastError`'s own docstring for the rule
      // every client owes it); narrowing it HERE would be this store deciding
      // a display question on the reader's behalf, and would drop exactly the
      // detail a maintainer greps the column for.
      attempts: r.attempts, lastError: r.lastError,
      // The gate half is NARROWED here and `lastError` above is not, and the
      // difference is the point: `lastGate` is a CLOSED union, so an
      // unrecognised token is a server/client version mismatch that must not
      // reach a client as a `MailGate` it will key a total record off. It
      // degrades to null — "nothing to say about a gate" — which is the same
      // thing absence means on the wire.
      lastGate: isMailGate(r.lastGate) ? r.lastGate : null,
      gateCount: r.gateCount, gateSince: r.gateSince, gateAt: r.gateAt,
    }));
  }

  /** Whether an OUTSTANDING (`queued` or `delivered`, unacked) mail already
   *  exists for this (runId, toId, subject) — review finding 33: a retried
   *  close re-entering the SAME done-claim rejection queued a fresh mail +
   *  delivery row, and a fresh non-collapsing push (spec:236-237), on EVERY
   *  retry, with no dedupe and no rate limit. `subject` alone identifies
   *  "the same fact restated" for the two system-mail subjects this build
   *  ever sends on a retry loop (`wave-brief`, `wave-done-rejected`) —
   *  `queueSystemMail`'s own call sites are the only run-mail callers.
   *
   *  `m.runId IS ?`, not `= ?` (Build 9b wave 0, D10 hole 1): `runId` is
   *  nullable — peer mail is `runId:null` by definition — and a bound NULL
   *  under `=` equals nothing, so for exactly the traffic Wave 7 adds a
   *  second producer for, the dedupe guard structurally could not fire.
   *  SQLite's `IS` is null-safe on both arms, so a number still matches its
   *  own rows and ONLY a null matches the null ones: one query, one reader,
   *  no second method.
   *
   *  `m.fromId = ?` since program-leverage wave 4 (D-1041). The paragraph above
   *  used to end "…keyed WITHOUT the sender, because the coordinator is its only
   *  sender", and that premise was true only while every system mail carried a
   *  RUN. Wave 4 queues one that does not — the program kickoff, sent before the
   *  coordinator has opened anything to be the coordinator OF — so system mail
   *  and PEER mail now share the `runId IS NULL` key space, and peer `subject` is
   *  caller-chosen free text bounded only in bytes. Un-scoped, a peer mail that
   *  happened to carry the kickoff's subject would have made `queueSystemMail`
   *  return with no row, no error and no record. The collision was one-way, which
   *  is why nothing had caught it: `hasOutstandingPeerDuplicate` below was
   *  sender-scoped from the start, so a kickoff never blocked a peer — only a
   *  peer could swallow a kickoff. */
  hasOutstandingMail(fromId: string, runId: number | null, toId: string, subject: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS x FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ' +
      'WHERE m.fromId = ? AND m.runId IS ? AND d.toId = ? AND m.subject = ? ' +
      `AND d.state IN ${OUTSTANDING_STATES_SQL} LIMIT 1`,
    ).get(fromId, runId, toId, subject);
    return row !== undefined;
  }

  /** Whether an OUTSTANDING peer mail with this exact (fromId, toId, subject)
   *  triple exists — the 409 'duplicate' probe (Build 9b wave 0, D10 hole 2).
   *  `runId IS NULL` no longer scopes it to the peer lane by construction —
   *  program-leverage wave 4 (D-1041) put a run-less SYSTEM mail in that space,
   *  the program kickoff — but `m.fromId = ?` still does, and always did. System
   *  mail has its own dedupe (`hasOutstandingMail` above, via `queueSystemMail`),
   *  now keyed by sender for the same reason this one always was. `toId`
   *  here is the RESOLVED recipient — the id `mail_deliveries.toId` actually
   *  carries — never the pre-resolution role. */
  hasOutstandingPeerDuplicate(fromId: string, toId: string, subject: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS x FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ' +
      'WHERE m.runId IS NULL AND m.fromId = ? AND d.toId = ? AND m.subject = ? ' +
      `AND d.state IN ${OUTSTANDING_STATES_SQL} LIMIT 1`,
    ).get(fromId, toId, subject);
    return row !== undefined;
  }

  /** How many peer mails from `fromId` to `toId` are OUTSTANDING (`queued` or
   *  `delivered`, unacked) — the pair arm of the 429 'peer-quota' bound. An
   *  ack or a park frees the slot: the bound is on standing pressure against
   *  one recipient, not on history (the hourly arm below is the one history
   *  bound, and it deliberately uses a different denominator). */
  outstandingPeerCount(fromId: string, toId: string): number {
    return (this.db.prepare(
      'SELECT COUNT(*) AS n FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ' +
      `WHERE m.runId IS NULL AND m.fromId = ? AND d.toId = ? AND d.state IN ${OUTSTANDING_STATES_SQL}`,
    ).get(fromId, toId) as { n: number }).n;
  }

  /** How many peer mails `fromId` has had ACCEPTED in the sliding hour before
   *  `now` — the per-sender arm of the 429 'peer-quota' bound. Counts `mail`
   *  ROWS (inserts), not deliveries and not delivery state: a refusal inserts
   *  no row and charges nothing; an ack does not refund the hour. `now` is
   *  the caller's clock, passed in rather than read here — the same
   *  policy-stays-with-the-caller reason `dueDeliveries`/`capsUsage` already
   *  take theirs. */
  peerMailInLastHour(fromId: string, now: number): number {
    return (this.db.prepare(
      'SELECT COUNT(*) AS n FROM mail WHERE runId IS NULL AND fromId = ? AND at > ?',
    ).get(fromId, now - 3_600_000) as { n: number }).n;
  }

  queueDelivery(mailId: number, toId: string, envelope: string): { id: number } {
    const res = this.db.prepare(
      'INSERT INTO mail_deliveries (mailId, toId, state, envelope) VALUES (?, ?, ?, ?)',
    ).run(mailId, toId, 'queued', envelope);
    return { id: Number(res.lastInsertRowid) };
  }

  /**
   * Overwrites a delivery's stored `envelope` — used by the ingress route
   * ONLY, once, immediately after `queueDelivery`, to close a bug fix-round
   * finding 5 / D-41 named: the envelope's own `ack:` line has to name the
   * DELIVERY id (what `delivery(id)`/`markAcked` resolve by, both above),
   * but `mail.id` and `mail_deliveries.id` are two SEPARATE `AUTOINCREMENT`
   * sequences (`schema.ts`) that only happen to walk together while every
   * mail resolves to exactly one delivery. The delivery id does not exist
   * until the row is inserted, so the route inserts the row with an empty
   * envelope, renders the real one now that it can name the delivery's own
   * id, and calls this to land it — all inside the SAME transaction
   * `queueDelivery` ran in, so no reader ever observes the empty
   * intermediate. This is the second half of that one INSERT, not a
   * re-render: `renderEnvelope` itself still runs exactly once, at queue
   * time (spec:176-177, "verbatim, never re-rendered"), and this method
   * never re-derives its argument — it only stores what the caller already
   * computed. */
  setDeliveryEnvelope(id: number, envelope: string): void {
    this.db.prepare('UPDATE mail_deliveries SET envelope = ? WHERE id = ?').run(envelope, id);
  }

  /**
   * The due set for one sweep — two arms, not one (deviation, found in Task 3
   * review — see the plan's D-10). Spec:174-177 requires replay: "Until
   * acked, the delivery replays — verbatim, never re-rendered — on later
   * sweeps after cooldown." Only the `queued` arm shipped originally —
   * `markDelivered` moves a row OUT of `queued` and nothing ever moved it
   * back, so an unacked delivery could never be re-selected once injected,
   * which made replay-until-ack structurally impossible.
   *
   * `replayMs` is the caller's `MAIL_REPLAY_MS` (Task 8, `watch.ts`), passed
   * in rather than owned here: this file stores rows, it does not own mail
   * delivery POLICY — the same reason `capsUsage`/`markDispatched` take `now`
   * from the caller instead of calling `Date.now()` internally.
   *
   * The replay arm ALSO gates on `nextAttemptAt` (fix, found in Task 3
   * review — the two arms were asymmetric: `queued`'s arm always read it,
   * `delivered`'s never did). `backOff` writes `attempts`/`lastError`/
   * `nextAttemptAt` on whatever row it is given, delivered rows included —
   * it never moves a row's `state` — so a delivered row that just backed off
   * was selected again on the very next sweep regardless of the spacing
   * `backOff` had just written, making exponential backoff a no-op for
   * every replay (spec:170-172 held only for a delivery's first attempt).
   * The column defaults to 0, so a delivered row that has never backed off
   * is unaffected by this clause.
   *
   * `MAX(COALESCE(ingestedAt, 0), COALESCE(deliveredAt, 0))`, not
   * `COALESCE(ingestedAt, deliveredAt)` (fix, review findings 2/6): a REPLAY
   * calls only `markDelivered`, which writes a fresh `deliveredAt` and never
   * touches `ingestedAt` (`markIngested`'s own docstring). Under the old
   * `COALESCE`, once `ingestedAt` had ever been written once it was picked
   * forever and the new, later `deliveredAt` a replay just wrote was
   * silently ignored — so the clock froze at the FIRST `UserPromptSubmit`
   * edge and every replay after that one was due again almost immediately,
   * spaced only by the per-session `MAIL_COOLDOWN_MS` instead of
   * `MAIL_REPLAY_MS` (a 120 s floor standing in for the intended 10
   * minutes). `MAX` always picks whichever of the two actually happened
   * last, so a fresh replay's `deliveredAt` re-dates the clock exactly the
   * way the first delivery's did. Both arguments are `COALESCE`d to `0`
   * because SQLite's multi-argument `max()` returns NULL — not the other
   * argument — the instant ANY argument is NULL, and `ingestedAt` is NULL
   * until the first edge is ever observed.
   */
  dueDeliveries(now: number, replayMs: number): { id: number; mailId: number; toId: string;
                                attempts: number; lastError: string | null; envelope: string;
                                deliveredAt: number | null; ingestedAt: number | null;
                                lastGate: string | null; gateSince: number | null }[] {
    return this.db.prepare(
      // `lastError` (Task 409) is the row's INCOMING failure — what it already
      // carried before this sweep touched it — which is how `sweepMail` tells
      // a NEW block from a repeat of the same one without re-reading the row
      // it is about to write and racing itself.
      // `lastGate`/`gateSince` ride along for the SAME reason `lastError` does
      // (D-792): `noteGate` must tell a repeat of the same gate from a change
      // of gate, and reading the row again at write time would race the sweep
      // against itself on exactly the rows it is deciding about.
      'SELECT id, mailId, toId, attempts, lastError, envelope, deliveredAt, ingestedAt, ' +
      'lastGate, gateSince FROM mail_deliveries ' +
      "WHERE (state = 'queued' AND nextAttemptAt <= ?) " +
      "OR (state = 'delivered' AND MAX(COALESCE(ingestedAt, 0), COALESCE(deliveredAt, 0)) + ? <= ? " +
      'AND nextAttemptAt <= ?) ' +
      'ORDER BY id',
    ).all(now, replayMs, now, now) as { id: number; mailId: number; toId: string; attempts: number;
                    lastError: string | null; envelope: string;
                    deliveredAt: number | null; ingestedAt: number | null;
                    lastGate: string | null; gateSince: number | null }[];
  }

  /**
   * Every `delivered`, unacked row, with NO timing filter — unlike
   * `dueDeliveries` above, which only surfaces a `delivered` row once
   * `replayMs` has already elapsed since it last moved the clock. That is
   * exactly wrong for the ONE thing `ingestedAt` exists to do (review
   * finding 3): `hookstate.ts`'s own docstring calls a `UserPromptSubmit`
   * newer than delivery "the cheapest available proof that the injected
   * turn actually STARTED" — proof that is only worth anything while the
   * turn it is proving might still be running, i.e. in the minutes right
   * after delivery, not ten minutes later once `dueDeliveries` finally
   * agrees to look. A sweep that samples the edge only through
   * `dueDeliveries`'s own result can therefore never observe it before the
   * replay it was supposed to prevent. This is the set that sweep instead
   * walks EVERY tick of its own clock, independent of due-ness, purely to
   * keep `ingestedAt` current.
   */
  deliveredUnacked(): { id: number; toId: string; deliveredAt: number | null; ingestedAt: number | null }[] {
    return this.db.prepare(
      "SELECT id, toId, deliveredAt, ingestedAt FROM mail_deliveries WHERE state = 'delivered'",
    ).all() as { id: number; toId: string; deliveredAt: number | null; ingestedAt: number | null }[];
  }

  /** `WHERE state NOT IN ('acked','rejected')` (fix — review finding 22,
   *  widened by a scoped-verify fix — a park must not be reopened either):
   *  `sweepMail` reads the row it is about to (re)send BEFORE
   *  `await sendPrompt(...)`, and writes the outcome AFTER — a window of
   *  several seconds to half a minute in which `POST /api/mail/:id/ack` can
   *  land on the SAME row via `markAcked`, exactly finding 22's race. The
   *  identical window also lets a PARK land on the row: `POST
   *  /api/runs/:id/close` -> `cancelOutstandingDeliveries`, or `sweepMail`'s
   *  own replay-ceiling/reaped-recipient calls to `rejectDelivery` below —
   *  all write `state='rejected'` from a SEPARATE code path than the one
   *  whose in-flight send this row belongs to. `!= 'acked'` alone let that
   *  in-flight send's `ok` resolve AFTER the park committed and overwrite it
   *  right back to `state='delivered'`, leaving the row self-contradictory
   *  (`rejectCode` non-null, `state='delivered'`) and — the harm
   *  `cancelOutstandingDeliveries` exists to prevent — re-eligible for
   *  `dueDeliveries`'s replay arm again: wave N's mail replaying into wave
   *  N+1's freshly `/clear`-ed context. `'acked'` and `'rejected'` are this
   *  build's only two states a send racing a concurrent writer must never
   *  reopen; every other three-writers-of-this-column guard
   *  (`rejectDelivery` below) carries the identical `NOT IN` list for the
   *  same reason. `markAcked` itself already reads-before-writing for the
   *  identical reason (see its own docstring). */
  markDelivered(id: number, at: number): void {
    this.db.prepare(
      // The gate columns clear IN THE SAME STATEMENT as the move (D-792), so
      // the existing `state NOT IN (...)` guard covers them too and a row the
      // guard skips keeps its gate. A second UPDATE could clear a gate off a
      // row this one declined to touch.
      "UPDATE mail_deliveries SET state = 'delivered', deliveredAt = ?, " +
      "lastGate = NULL, gateCount = 0, gateSince = NULL, gateAt = NULL WHERE id = ? AND state NOT IN ('acked','rejected')",
    ).run(at, id);
  }

  /**
   * `mail_deliveries.replayCount + 1`, answered as a STATE (review finding
   * 20; union — Build 9b wave 0, D10 hole 4). Called by the sweep AFTER
   * `markDelivered`, and ONLY when the row it read was already `delivered`
   * before this send — i.e. this send was a REPLAY, not the first delivery.
   * Kept independent of `attempts` (`MAIL_MAX_ATTEMPTS`'s own docstring:
   * SEND FAILURES only) on purpose: without a separate counter,
   * spec:174-177's replay-until-ack has no ceiling at all once a delivery
   * succeeds even once — `MAIL_COOLDOWN_MS` only SPACES the injections, it
   * was never a bound on their number, and a delivery that keeps succeeding
   * can never fail its way into `MAIL_MAX_ATTEMPTS`. This is the ceiling
   * that lets a delivery no one ever acks eventually reach
   * `rejected('undeliverable')` — the spec's own terminal state, otherwise
   * structurally unreachable for exactly the deliveries that succeed.
   *
   * `AND state NOT IN ('acked','rejected')` — the same guard every other
   * writer of this table carries (`markDelivered`/`backOff`/`rejectDelivery`
   * above and below), closing the same seconds-to-half-a-minute window in
   * which an ack or a park lands from a separate code path between the
   * sweep's read and this write. And the RETURN is a union, not a bare
   * number, because the guard alone would hand the caller the row's
   * unchanged count — a value that reads as "not yet at the ceiling" for a
   * row already parked: two conditions, one value, at a seam (D10: "the
   * union is the fix; the guard alone is not"). `{state:'terminal'}` also
   * answers for a row that does not exist at all — collapsed deliberately
   * and stated here rather than papered over: nothing in this tree DELETEs
   * from `mail_deliveries` (D10's own measurement — "bound the producer,
   * never the record"), and the single caller's handling of the two is
   * identical (skip the ceiling check), so the collapse is of two conditions
   * no caller distinguishes.
   */
  bumpReplayCount(id: number): { state: 'counted'; replayCount: number } | { state: 'terminal' } {
    const res = this.db.prepare(
      "UPDATE mail_deliveries SET replayCount = replayCount + 1 WHERE id = ? AND state NOT IN ('acked','rejected')",
    ).run(id);
    if (res.changes === 0) return { state: 'terminal' };
    return {
      state: 'counted',
      replayCount: (this.db.prepare('SELECT replayCount FROM mail_deliveries WHERE id = ?')
        .get(id) as { replayCount: number }).replayCount,
    };
  }

  /** The `UserPromptSubmit` edge (`hookstate.ts:23-34`). Deliberately does
   *  NOT touch `deliveredAt` — a REPLAY re-dates the clock through its own
   *  fresh `markDelivered` call, and `dueDeliveries`'s `MAX(...)` above is
   *  what combines the two rather than either writer clobbering the other's
   *  column. `AND state NOT IN ('acked','rejected')` (Build 9b wave 0, D10
   *  hole 3): shielded until now only by its caller's query filter
   *  (`deliveredUnacked()` selects `delivered` rows) — a filter is a
   *  courtesy of one caller, a guard is a property of the row; the same
   *  ack-or-park-lands-mid-window race every sibling writer here already
   *  guards against. */
  markIngested(id: number, at: number): void {
    this.db.prepare(
      "UPDATE mail_deliveries SET ingestedAt = ? WHERE id = ? AND state NOT IN ('acked','rejected')",
    ).run(at, id);
  }

  /** false when already acked, absent, or PARKED — an ack is idempotent, but
   *  the CALLER (the ack route) needs to know whether ITS call was the one
   *  that landed, so a double-ack (or a late ack racing a park) answers
   *  honestly rather than reporting success twice. `'rejected'` joins
   *  `'acked'` in the refusal (fix — scoped-verify H2): a park is a DECISION
   *  that this delivery is done — undeliverable, and terminal — the same
   *  reason `markDelivered` above and `rejectDelivery` below both refuse to
   *  reopen a `'rejected'` row; an ack landing after `POST /api/runs/:id/close` ->
   *  `cancelOutstandingDeliveries` (or a replay-ceiling/reaped-recipient
   *  park) already committed had no such guard, so it flipped the row to
   *  `{state:'acked', rejectCode:'undeliverable'}` — self-contradictory, and
   *  the gap `markDelivered`'s own docstring already claimed shut ("`acked`
   *  and `rejected` are this build's only two states a concurrent writer
   *  must never reopen... `markAcked` itself already reads-before-writing
   *  for the identical reason") before this fix made that claim true here
   *  too. Harmless for replay either way (`dueDeliveries` selects neither
   *  `acked` nor `rejected`), but a row is not allowed to claim both an ack
   *  and a park happened to it.
   *
   *  ONE NAMED EXCEPTION (orchestrator ruling I2, part (b)): a row whose
   *  rejection is EXACTLY the replay-ceiling park — `rejectCode:'undeliverable'`
   *  and `lastError:MAIL_REPLAY_CEILING_ERROR`, the two columns
   *  `watch.ts`'s `sweepMail` writes together and only there — may still be
   *  acked. D-67/H2 above refuse a LATE ack racing a park so a
   *  self-contradictory row can never appear silently; this is a DIFFERENT
   *  act, requested explicitly, well after the park already committed and
   *  nothing is racing it: the recipient FINALLY SEEING an abandoned message
   *  is exactly what "acked" means, and the resulting row — `state:'acked'`,
   *  its park still readable in `lastError` — is the honest record of both
   *  things that happened to it, in order. The match is narrow and exact
   *  (both columns, not merely `state='rejected'`) so no OTHER park —
   *  `cancelOutstandingDeliveries`'s `'run closed'`, the never-delivered
   *  `MAIL_MAX_ATTEMPTS` park, an `enter-ignored` park — is ever let back in
   *  through this door; every one of those stays refused, unchanged. */
  markAcked(id: number, at: number): boolean {
    const row = this.db.prepare('SELECT state, rejectCode, lastError FROM mail_deliveries WHERE id = ?')
      .get(id) as { state: string; rejectCode: string | null; lastError: string | null } | undefined;
    if (!row || row.state === 'acked') return false;
    const isAbandonedReplayPark = row.state === 'rejected'
      && row.rejectCode === 'undeliverable' && row.lastError === MAIL_REPLAY_CEILING_ERROR;
    if (row.state === 'rejected' && !isAbandonedReplayPark) return false;
    this.db.prepare('UPDATE mail_deliveries SET state = ?, ackedAt = ?, '
      + 'lastGate = NULL, gateCount = 0, gateSince = NULL, gateAt = NULL WHERE id = ?')
      .run('acked', at, id);
    return true;
  }

  /** `WHERE state NOT IN ('acked','rejected')` (fix — scoped-verify H1, the
   *  same guard `markDelivered`/`rejectDelivery` below carry): this is the
   *  sweep's own SEND-FAILURE path, resolving on `sendPrompt`'s own delayed
   *  timeline, so a send that was in flight when a SEPARATE park
   *  (`cancelOutstandingDeliveries` on close, or this same sweep's own
   *  replay-ceiling/reaped-recipient `rejectDelivery`) already landed on the
   *  row could still resolve after it and clobber the park's own
   *  `lastError` (and bump `attempts`) even though `rejectDelivery`'s guard
   *  already protects `state`/`rejectCode` from that identical race. Left
   *  unguarded, that was exactly the gap `rejectDelivery`'s own docstring
   *  below claims closed for "a second writer" in general — true of
   *  `rejectDelivery` itself, false of this method until this fix.
   *  `dueDeliveries` never reads `attempts`/`lastError` on a `rejected` row
   *  (selected by neither arm), so the harm before this fix was a
   *  cosmetically wrong `lastError`/`attempts` on an already-closed row,
   *  never a resurrected replay — guarded anyway, for the same reason every
   *  other writer of this column is: the row's recorded reason for its own
   *  terminal state should name the write that actually caused it.
   *
   *  `countsAsAttempt` (registry ladder, default `true` — every EXISTING
   *  caller is a genuine send failure and stays unchanged): `false` is
   *  `sweepMail`'s own "recipient found but unmeasurable" branch, which never
   *  even reached `sendPrompt` — `attempts` is SEND-FAILURE budget
   *  (`MAIL_MAX_ATTEMPTS`'s own docstring), and ratcheting it on a row that
   *  was never attempted would let that branch march toward the SAME park
   *  ceiling a genuine failure does, for a recipient this sweep has not
   *  actually proven gone. */
  backOff(id: number, lastError: string, nextAttemptAt: number, countsAsAttempt = true): void {
    this.db.prepare(
      'UPDATE mail_deliveries SET attempts = attempts + ?, lastError = ?, nextAttemptAt = ? ' +
      "WHERE id = ? AND state NOT IN ('acked','rejected')",
    ).run(countsAsAttempt ? 1 : 0, lastError, nextAttemptAt, id);
  }

  /**
   * D-792: WHAT REFUSED THIS DELIVERY, recorded without changing what happens
   * to it. `sweepMail` calls this at every ordinary gate; it writes four
   * columns and reads none of them back into a decision.
   *
   * NOT A BACKOFF AND NOT AN ATTEMPT. `nextAttemptAt` is untouched, so the row
   * stays due on the next sweep exactly as it did before — an ordinary gate is
   * expected to hold for a busy session and must never approach
   * `MAIL_MAX_ATTEMPTS`. `attempts` is untouched for the same reason: it is
   * SEND-FAILURE budget (its own docstring), and no send was attempted here.
   * The two gates that ALSO back off call this in ADDITION, because "when may
   * this be retried" and "what refused it" are different questions and
   * collapsing them is the defect this repo bans by name.
   *
   * `sinceIfSame` is the row's CURRENT `gateSince`, handed in by the caller
   * from `dueDeliveries` rather than re-read here: a repeat of the same gate
   * keeps it, and a CHANGE of gate restarts it, because the question is "how
   * long has THIS gate been holding it", not "how long has it been stuck at
   * anything".
   */
  noteGate(id: number, gate: MailGate, now: number, same: boolean, sinceIfSame: number | null): void {
    this.db.prepare(
      'UPDATE mail_deliveries SET lastGate = ?, gateAt = ?, ' +
      'gateCount = CASE WHEN ? THEN gateCount + 1 ELSE 1 END, gateSince = ? ' +
      "WHERE id = ? AND state NOT IN ('acked','rejected')",
    ).run(gate, now, same ? 1 : 0, same ? (sinceIfSame ?? now) : now, id);
  }

  /** `WHERE state NOT IN ('acked','rejected')` (fix — review finding 22, the
   *  same ack-race guard `markDelivered` above now carries, applied to this
   *  writer's own unconditional `state` overwrite, and widened for the same
   *  reason): a `sendPrompt` failure resolving after a concurrent ack landed
   *  on the same row must not turn an ACKED message into a
   *  `rejected('undeliverable')` one, and — the scoped-verify addition — two
   *  parks racing the same row (e.g. `cancelOutstandingDeliveries` on close,
   *  and this same sweep's own replay-ceiling or reaped-recipient call to
   *  THIS method, both resolving against a row already parked by the other)
   *  must not let the SECOND clobber the first's `rejectCode`/`lastError`
   *  with a different, later reason. `state != 'acked'` alone let that
   *  second write through unconditionally; a park is terminal exactly the
   *  way `'acked'` is, so it needs the identical protection. */
  rejectDelivery(id: number, code: MailRejectCode, lastError: string): void {
    this.db.prepare(
      "UPDATE mail_deliveries SET state = 'rejected', rejectCode = ?, lastError = ?, " +
      "lastGate = NULL, gateCount = 0, gateSince = NULL, gateAt = NULL " +
      "WHERE id = ? AND state NOT IN ('acked','rejected')",
    ).run(code, lastError, id);
  }

  recordRejection(r: { code: MailRejectCode; fromId?: string; fromUuid?: string; toId?: string;
                       runId?: number | null; kind?: string; subject?: string;
                       detail?: string }): void {
    this.db.prepare(
      'INSERT INTO mail_rejections (at, code, fromId, fromUuid, toId, runId, kind, subject, detail) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(Date.now(), r.code, r.fromId ?? null, r.fromUuid ?? null, r.toId ?? null, r.runId ?? null,
      r.kind ?? null, r.subject ?? null, r.detail ?? null);
  }

  /** Every recorded rejection, oldest first — spec:147-148's "a rejected
   *  message is a fact about the fleet" needs a row, not necessarily a
   *  reader; this file's own tests are today's only consumer (PR J's feed is
   *  the eventual one). `code` stays a raw `string`: `mail_rejections.code`
   *  is not one of D-8's five we-do-not-know columns (it is written only from
   *  a typed `MailRejectCode` today, but nothing here re-validates it — the
   *  same honesty `RunRowDb`'s comment gives every OTHER column that IS
   *  guarded, stated instead of silently cast). */
  rejections(): { id: number; at: number; code: string; fromId: string | null; fromUuid: string | null;
                 toId: string | null; runId: number | null; kind: string | null; subject: string | null;
                 detail: string | null }[] {
    return this.db.prepare(
      'SELECT id, at, code, fromId, fromUuid, toId, runId, kind, subject, detail ' +
      'FROM mail_rejections ORDER BY id',
    ).all() as { id: number; at: number; code: string; fromId: string | null; fromUuid: string | null;
                 toId: string | null; runId: number | null; kind: string | null; subject: string | null;
                 detail: string | null }[];
  }

  // ── feed (Task 10, orchestrator-added scope: the durable archive behind ────
  //    NotifyLog's in-memory ring — PR J interface 5)

  /** Newest rows to keep. Also the upper clamp `feedEvents` enforces on its
   *  own `limit` argument, so a route can never be made to walk (and
   *  JSON-stringify) more history than the table is ever allowed to hold. */
  private static readonly FEED_RETENTION = 2000;

  /**
   * Append one notify event to the durable feed, beside `NotifyLog.record`
   * (`FleetWatcher.pushOne`'s own call — see that method's docstring). ALL
   * kinds land here, not just `mail`/`run`: a scrollback that silently
   * dropped `ask`/`done`/`merged` would not be a scrollback. `epoch`/`seq`
   * are `NotifyLog`'s own pair AT RECORD TIME, mirrored for correlation —
   * this table's own `id` is what orders `feedEvents`, since `seq` alone
   * cannot: it resets to 0 on every epoch rotation (a restart with an
   * unreadable watermark file), so two rows from different epochs can carry
   * the same `seq`.
   *
   * Retention (newest `FEED_RETENTION`) is pruned in the SAME transaction as
   * the insert, so a reader can never observe more rows than the retention
   * promise, even mid-write.
   */
  recordFeedEvent(epoch: string, e: NotifyEvent): void {
    tx(this.db, () => {
      this.db.prepare(
        'INSERT INTO feed_events (epoch, seq, at, kind, sessionId, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(epoch, e.seq, e.at, e.kind, e.sessionId, e.title, e.body);
      this.db.prepare(
        'DELETE FROM feed_events WHERE id NOT IN (SELECT id FROM feed_events ORDER BY id DESC LIMIT ?)',
      ).run(CoordStore.FEED_RETENTION);
    });
  }

  /**
   * `GET /api/feed`'s reader — oldest-first (the route's own promise), `limit`
   * clamped into `(0, FEED_RETENTION]` so neither an absent/non-positive
   * value nor one past the table's own retention ceiling can be asked for.
   * `kind` is read back through `isNotifyKind` (review finding 2), degrading
   * an unrecognised token to `'unknown'` — the same guard `isRunState`/
   * `isProgramState`/`isMailDeliveryState` already give the other we-do-not-
   * know columns in this file, never a bare cast. `coord/schema.ts`'s header
   * comment used to exempt this column on the grounds that it is "written
   * only from a value this server itself already typed" — true only until a
   * rollback (`shared/api.ts`'s own rollback paragraph) puts this server
   * behind a store a NEWER build already wrote `feed_events.kind` into.
   */
  feedEvents(limit: number): NotifyEvent[] {
    const n = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), CoordStore.FEED_RETENTION)
      : CoordStore.FEED_RETENTION;
    const rows = this.db.prepare(
      'SELECT seq, at, kind, sessionId, title, body FROM ' +
      '(SELECT * FROM feed_events ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
    ).all(n) as { seq: number; at: number; kind: string; sessionId: string; title: string; body: string }[];
    return rows.map((r) => ({
      seq: r.seq, at: r.at, kind: isNotifyKind(r.kind) ? r.kind : 'unknown', sessionId: r.sessionId,
      title: r.title, body: r.body,
    }));
  }

  // ── notify lanes (Task 10): what FleetWatcher polls to raise `mail`/`run` ──
  //    NotifyEvent pushes — level-triggered watermarks, the same shape every
  //    other lane in this build uses for "what is new since I last looked".

  /** `mail_deliveries`'s current high-water id — `FleetWatcher`'s priming read
   *  (its own `tick()`'s "no storm on boot" rule, extended to the mail lane
   *  per spec's restart semantics), so a restart does not re-notify for every
   *  delivery already queued before this process started. */
  maxMailDeliveryId(): number {
    return (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM mail_deliveries').get() as { m: number }).m;
  }

  /**
   * Every `mail_deliveries` row with `id > sinceId`, oldest first — mail
   * queued since `FleetWatcher` last looked, regardless of whether the
   * delivery lane (`sweepMail`) has attempted injection yet: spec:243-244's
   * push fires "at queue time (the message exists and is a record then), not
   * at injection — otherwise a message that never becomes deliverable is a
   * fact nothing recorded."
   *
   * `mailId` (for the push's non-collapsing tag, spec:236-237) and
   * `deliveryId` (the watermark's own unit) are deliberately BOTH returned —
   * two independent `AUTOINCREMENT` sequences, the same D-41 reason
   * `setDeliveryEnvelope`'s own comment gives for never assuming they walk
   * together. `workspace`/`project` come from the delivery's RUN when one is
   * named (`mail.runId`, nullable) — the common case, worker<->coordinator
   * mail inside a wave — and are `null` for ad-hoc mail with no run context;
   * the caller degrades both (`workspace ?? toId` for the title, same as
   * `pushOne`'s own fallback chains elsewhere in this file's callers).
   */
  mailQueuedSince(sinceId: number): { deliveryId: number; mailId: number; toId: string; kind: string;
                                       subject: string; project: string | null;
                                       workspace: string | null }[] {
    return this.db.prepare(
      'SELECT d.id AS deliveryId, m.id AS mailId, d.toId, m.kind, m.subject, r.project, r.workspace ' +
      'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId LEFT JOIN runs r ON r.id = m.runId ' +
      'WHERE d.id > ? ORDER BY d.id',
    ).all(sinceId) as { deliveryId: number; mailId: number; toId: string; kind: string; subject: string;
                         project: string | null; workspace: string | null }[];
  }

  /** `run_events`'s current high-water id — same priming role as
   *  `maxMailDeliveryId`, over the run-transition notify lane. */
  maxRunEventId(): number {
    return (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM run_events').get() as { m: number }).m;
  }

  /**
   * Every `run_events` row with `id > sinceId`, oldest first, joined back to
   * the run it belongs to — spec:243-244's `run` push copy needs `state`,
   * `workspace ?? project`, `program:<slug> wave <n>/<of>`, all of which live
   * on `runs` already (`program` IS the slug — `runs.program REFERENCES
   * programs(slug)`; the copy names the slug, never the program's title, so
   * no join to `programs` is needed here, unlike `RUN_ROW_COLUMNS`'s own
   * join for `programTitle`).
   *
   * `sessionId` rides straight off `runs.sessionId` (nullable — a run can
   * transition, e.g. `planned` -> `failed`, before dispatch ever mints one);
   * the caller (`FleetWatcher`) skips a row with no session rather than
   * guess one, since presence-gating and the push's own target both need a
   * real session id.
   */
  runEventsSince(sinceId: number): { eventId: number; runId: number; fromState: string; toState: string;
                                      sessionId: string | null;
                                      project: string; workspace: string | null; program: string;
                                      wave: number; waveOf: number | null }[] {
    return this.db.prepare(
      'SELECT re.id AS eventId, re.runId, re.fromState, re.toState, r.sessionId, r.project, r.workspace, ' +
      'r.program, r.wave, r.waveOf ' +
      'FROM run_events re JOIN runs r ON r.id = re.runId ' +
      'WHERE re.id > ? ORDER BY re.id',
    ).all(sinceId) as { eventId: number; runId: number; fromState: string; toState: string;
                         sessionId: string | null;
                         project: string; workspace: string | null; program: string;
                         wave: number; waveOf: number | null }[];
  }

  // ── disaster recovery (spec:82-85) ─────────────────────────────────────────

  /**
   * Rebuild a program's runs from the three artefacts that survive the database:
   * the markdown ledger (`docs/superpowers/programs/<slug>.md`, parsed by the
   * CALLER — nothing machine-reads it in ccrc, and this signature is what keeps
   * that true: it takes a parsed shape, never a path), the registry row, and
   * `.prhistory`.
   *
   * The drill is a TEST, not an operator tool, and its value is a constraint on
   * future columns: a column that cannot be reconstructed from these three
   * turns `coord-store.test.ts` red and has to justify itself in the diff.
   *
   * Two judgment calls the input does not fully pin, since the registry names
   * only the CURRENT state of one workspace, not each wave's own history:
   *  - every rebuilt run shares the registry's `sessionId`/`workspace`/
   *    `branch` — true by construction under D-1 (a session id is stable
   *    across waves; only its harness uuid rotates on `/clear`).
   *  - `.prhistory` entries fold onto the LAST wave that closed with this
   *    branch, not distributed across every closed wave — the honest
   *    approximation of "whatever `foldPrLineage` would have stored at THAT
   *    close" when the close-time snapshots themselves were lost with the
   *    database. A wave that has not closed gets `[]`, and that is NOT a
   *    stand-in: nothing has folded into it yet (`ccd/ccd:1957-1963`'s
   *    three-answer ladder).
   *
   * A THIRD rule (deviation D-11, found in Task 3 review — the plan's own
   * Step-4 rule 2, dropped on first landing): the LAST wave's state is read
   * from the hold, not guessed from the ledger alone. A wave with no handoff
   * commit is `working` ONLY while `registry.held` says the workspace is
   * still claimed for it; if the hold is gone too, nothing backs a live
   * session and calling it `working` would fabricate one — `spec:82-85`'s
   * "nothing is invented" for the DB-lost path applies to the STATE column
   * exactly as much as to any other field. Such a wave is `failed`: the
   * honest "this did not complete and nothing is running it", not a silent
   * default that also keeps counting against `capsUsage().running` forever.
   * Every wave BEFORE the last one is expected to already carry a handoff
   * commit (the ledger is append-only); the fallback below only ever matters
   * for the last one.
   *
   * A FOURTH rule (fix, found in Task 3 review): the `working` wave — and
   * ONLY that one — gets `dispatchedAt` bound to the reconstruction time,
   * the same honest-approximation reasoning `openedAt` already uses. Without
   * this, `capsUsage().running`'s `dispatchedAt IS NOT NULL` predicate
   * (below) could never count a rebuilt run no matter its state, so the very
   * run a disaster rebuild most needs the cap to see — a live session
   * surviving the database loss — was invisible to it; the THIRD rule's own
   * justification above ("keeps counting against `capsUsage().running`
   * forever" as the reason a hold-less last wave is `failed` rather than a
   * silently-defaulted `working`) only became true once this bound
   * `dispatchedAt` for `working`. A `done` or `failed` wave stays
   * `dispatchedAt = null`: it holds no live session for the cap to count,
   * and stamping the reconstruction time on a wave that in reality
   * dispatched long ago would falsify `dispatchedIn24h` for it too.
   */
  reconstruct(input: {
    ledger: { slug: string; title: string;
              waves: { wave: number; of: number; handoffCommit: string | null }[] };
    registry: { sessionId: string; project: string; workspace: string;
                branch: string; held: string | null };
    prHistory: readonly PrLineageEntry[];
  }): RunRow[] {
    return tx(this.db, () => {
      const now = Date.now();
      this.db.prepare(
        'INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(slug) DO UPDATE SET title = excluded.title',
      ).run(input.ledger.slug, input.ledger.title, now, 'active');

      const doneWaves = input.ledger.waves.filter((w) => w.handoffCommit !== null);
      const lastDoneWave = doneWaves.length > 0 ? doneWaves[doneWaves.length - 1] : null;
      const matchingLineage = input.prHistory.filter((e) => e.branch === input.registry.branch);
      const lastWave = input.ledger.waves[input.ledger.waves.length - 1];

      const ids: number[] = [];
      for (const wave of input.ledger.waves) {
        // The hold-based rule (D-11, above) applies ONLY to the last wave; a
        // done wave is always `done` regardless of position, matching the
        // original formula for every wave that HAS a handoff commit.
        const state: RunState = wave.handoffCommit !== null
          ? 'done'
          : wave === lastWave && input.registry.held === null
            ? 'failed'
            : 'working';
        const prLineage = wave === lastDoneWave ? matchingLineage : [];
        // Fix, found in Task 3 review (see the fourth rule in this method's
        // docstring): ONLY the `working` wave carries a live session, so only
        // it gets `dispatchedAt` bound — the reconstruction time stands in
        // for the real dispatch time nothing in the ledger preserves.
        const dispatchedAt = state === 'working' ? now : null;
        const res = this.db.prepare(
          'INSERT INTO runs (program, wave, waveOf, project, sessionId, workspace, branch, state, ' +
          'dispatchedAt, claimedBy, openedAt, handoffCommit, prLineage) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          input.ledger.slug, wave.wave, wave.of, input.registry.project,
          input.registry.sessionId, input.registry.workspace, input.registry.branch,
          state, dispatchedAt, null, now, wave.handoffCommit, JSON.stringify(prLineage),
        );
        ids.push(Number(res.lastInsertRowid));
      }
      return ids.map((id) => this.run(id)!);
    });
  }

  /* ── the lifecycle journal mirror (build 9) ────────────────────────────── */

  /**
   * Every generation this mirror has ever seen, retired ones included — the
   * retired rows are what make "this generation was rotated away with N bytes
   * undrained" answerable a year later.
   */
  journalGenerations(): JournalGeneration[] {
    const rows = this.db.prepare(
      'SELECT gen, firstSeenAt, lastSweepAt, cursor, size, retired ' +
      'FROM lifecycle_generations ORDER BY gen',
    ).all() as (Omit<JournalGeneration, 'retired'> & { retired: number })[];
    return rows.map((r) => ({ ...r, retired: r.retired !== 0 }));
  }

  /**
   * ONE TRANSACTION FOR THE ROWS AND THE CURSOR, and that is the whole of D6's
   * "the cursor is an optimisation, never a correctness input": it is advanced
   * only inside the same `tx()` as the rows it covers, so it can never move
   * past uncommitted data. A cursor hoisted out of here — even one line above
   * the loop, in its own transaction — is the mutant `lifecycle-store.test.ts`
   * exists to kill.
   *
   * `INSERT OR IGNORE` against the two partial unique indexes is what makes
   * idempotency INTRINSIC rather than positional: a parsed line dedupes on its
   * own `uid`, and a uid-less one on its bytes within its generation. Neither
   * is a function of where in the file the line happened to sit, so re-reading
   * a generation from offset 0 is always no-op-or-catch-up.
   *
   * Returns how many rows actually LANDED — the caller logs nothing on 0,
   * which is the ordinary answer for a sweep that only advanced a cursor.
   *
   * `badoutcome` rides alongside `badact` in the column list — added to
   * `MIGRATIONS[2]` and `JournalRow` by a fix round after this brief was
   * written, because ccd writes it today and `LifecycleEvent.badoutcome`
   * already requires it on every `MirroredLifecycleEvent`. Dropping it here
   * would silently lie on every row where ccd wrote one.
   */
  ingestJournal(input: {
    readonly gen: string;
    readonly rows: readonly JournalRow[];
    readonly cursor: number;
    readonly size: number;
    readonly at: number;
  }): number {
    return tx(this.db, () => {
      const ins = this.db.prepare(
        'INSERT OR IGNORE INTO lifecycle_events ' +
        '(uid, gen, at, ingestedAt, act, badact, outcome, badoutcome, verb, sessionId, tx, refusal, ' +
        'detail, truncated, obsJson, decJson, measJson, raw) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      let inserted = 0;
      for (const r of input.rows) {
        const res = ins.run(
          r.uid, input.gen, r.at, input.at, r.act, r.badact, r.outcome, r.badoutcome, r.verb,
          r.sessionId, r.tx, r.refusal, r.detail, r.truncated ? 1 : 0,
          r.obs === null ? null : JSON.stringify(r.obs),
          r.dec === null ? null : JSON.stringify(r.dec),
          r.meas === null ? null : JSON.stringify(r.meas),
          r.raw,
        );
        inserted += Number(res.changes);
      }
      this.db.prepare(
        'INSERT INTO lifecycle_generations (gen, firstSeenAt, lastSweepAt, cursor, size, retired) ' +
        'VALUES (?, ?, ?, ?, ?, 0) ' +
        'ON CONFLICT(gen) DO UPDATE SET lastSweepAt = excluded.lastSweepAt, ' +
        'cursor = excluded.cursor, size = excluded.size, retired = 0',
      ).run(input.gen, input.at, input.at, input.cursor, input.size);
      return inserted;
    });
  }

  /** A hole in the mirror, recorded rather than skipped (D6). Never pruned:
   *  the gap outlives the generation it is about, which is the only reason it
   *  is worth writing down.
   *
   *  `lostFrom`/`lostTo` are taken AS GIVEN, never constructed here: the
   *  coupling invariant (both null, or both numbers) is `mirrorplan.ts`'s
   *  private `coupledLoss` helper's job, at the one call site that builds a
   *  `PlannedGap`. This method is a pure write of whatever pair its caller
   *  already produced, so it does not re-derive — and cannot drift from —
   *  that invariant. */
  recordGap(g: {
    readonly at: number; readonly gen: string; readonly reason: LifecycleGapReason;
    readonly detail: string; readonly lostFrom: number | null; readonly lostTo: number | null;
  }): void {
    this.db.prepare(
      'INSERT INTO lifecycle_gaps (at, gen, reason, detail, lostFrom, lostTo) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
    ).run(g.at, g.gen, g.reason, g.detail, g.lostFrom, g.lostTo);
  }

  /** RETIRE, NEVER DELETE. A retired generation's cursor and size are the
   *  evidence behind its gap row; destroying them would destroy the record of
   *  what was lost, which is the same mistake `ws-restore` made until wave 3. */
  retireGeneration(gen: string, at: number): void {
    this.db.prepare(
      'UPDATE lifecycle_generations SET retired = 1, lastSweepAt = ? WHERE gen = ?',
    ).run(at, gen);
  }

  /** Bounded like `FEED_RETENTION` is, and for the same reason: a route that
   *  can be asked for the whole table is a route that can be asked for 90 MB. */
  static readonly LIFECYCLE_PAGE_MAX = 500;

  /** The column list, named ONCE. `SELECT *` is banned in this directory —
   *  naming every column is exactly what makes "an older build ignores unknown
   *  columns" true rather than aspirational. Includes `badoutcome`, added to
   *  the schema by a fix round after this brief was written — omitting it
   *  here would silently drop the outcome-side degrade token on every read. */
  private static readonly LC_COLS =
    'id, uid, gen, at, ingestedAt, act, badact, outcome, badoutcome, verb, sessionId, tx, refusal, ' +
    'detail, truncated, obsJson, decJson, measJson, raw';

  /**
   * One session's past tense, oldest-first, newest-`limit` window.
   *
   * ORDERED BY THIS TABLE'S OWN `id`, NEVER BY `at`. `at` is CCD's clock and is
   * nullable; `id` is monotonic across a generation rotation. `feed_events`
   * already relies on the identical argument for `GET /api/feed`.
   */
  lifecycleFor(q: { readonly sessionId?: string | null; readonly limit?: number }): MirroredLifecycleEvent[] {
    const raw = q.limit ?? CoordStore.LIFECYCLE_PAGE_MAX;
    const n = Number.isFinite(raw) && raw > 0
      ? Math.min(Math.floor(raw), CoordStore.LIFECYCLE_PAGE_MAX)
      : CoordStore.LIFECYCLE_PAGE_MAX;
    const c = CoordStore.LC_COLS;
    const rows = (q.sessionId
      ? this.db.prepare(
          `SELECT ${c} FROM (SELECT ${c} FROM lifecycle_events WHERE sessionId = ? ` +
          'ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
        ).all(q.sessionId, n)
      : this.db.prepare(
          `SELECT ${c} FROM (SELECT ${c} FROM lifecycle_events ORDER BY id DESC LIMIT ?) ` +
          'ORDER BY id ASC',
        ).all(n)) as {
          uid: string | null; gen: string; at: number | null; ingestedAt: number;
          act: string; badact: string | null; outcome: string; badoutcome: string | null;
          verb: string | null; sessionId: string | null; tx: string | null;
          refusal: string | null; detail: string | null; truncated: number;
          obsJson: string | null; decJson: string | null; measJson: string | null; raw: string;
        }[];
    return rows.map((r) => ({
      uid: r.uid, gen: r.gen, at: r.at, ingestedAt: r.ingestedAt,
      // Through the guards, never a cast — the same discipline `feedEvents`
      // gives `kind` and `programs()` gives `state`. A token a NEWER build
      // wrote lands somewhere honest, and `raw` still carries the bytes.
      act: isLifecycleAct(r.act) ? r.act : LC_ACT_UNKNOWN,
      badact: r.badact,
      outcome: isLifecycleOutcome(r.outcome) ? r.outcome : LC_OUTCOME_UNKNOWN,
      // `badact`'s twin. Same shape as `badact` above: a free-text echo of
      // whatever ccd (or this build's own degrade) wrote, never re-narrowed
      // here — narrowing already happened once, on the way in.
      badoutcome: r.badoutcome,
      verb: r.verb,
      // The COLUMN is `sessionId`; the WIRE event is `id`. One rename,
      // declared in `journalparse.ts` and undone here — see `ProvenancePair`.
      id: r.sessionId,
      tx: r.tx, refusal: r.refusal, detail: r.detail,
      truncated: r.truncated !== 0,
      // The SAME revivers the parser used on the way in: one definition, both
      // directions, and each returns a literal so a family gaining a field is
      // a compile error rather than a silently-dropped one.
      obs: reviveObs(jsonOrNull(r.obsJson)),
      dec: reviveDec(jsonOrNull(r.decJson)),
      meas: reviveMeas(jsonOrNull(r.measJson)),
      raw: r.raw,
    }));
  }

  /** The holes, newest-first — a timeline with a hole in it says so. */
  lifecycleGaps(limit = 100): LifecycleGap[] {
    const n = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), CoordStore.LIFECYCLE_PAGE_MAX)
      : 100;
    const rows = this.db.prepare(
      'SELECT at, gen, reason, detail, lostFrom, lostTo FROM lifecycle_gaps ORDER BY id DESC LIMIT ?',
    ).all(n) as {
      at: number; gen: string; reason: string; detail: string;
      lostFrom: number | null; lostTo: number | null;
    }[];
    return rows.map((r) => ({
      at: r.at, gen: r.gen,
      reason: isLifecycleGapReason(r.reason) ? r.reason : 'unknown',
      detail: r.detail, lostFrom: r.lostFrom, lostTo: r.lostTo,
    }));
  }

  /** What `/api/fleet/health` reports so the operator sees the growth coming
   *  (D8). `oldestAt` IS the reconstruction horizon: below it the mirror holds
   *  history the flat file no longer does. `AS n` and not `AS rows` — `ROWS`
   *  is a SQLite window-frame keyword and only parses here as a fallback
   *  identifier. */
  lifecycleStats(): {
    rows: number; oldestAt: number | null; newestAt: number | null;
    generations: number; gaps: number;
  } {
    const e = this.db.prepare(
      'SELECT count(*) AS n, MIN(at) AS oldestAt, MAX(at) AS newestAt FROM lifecycle_events',
    ).get() as { n: number; oldestAt: number | null; newestAt: number | null };
    const g = this.db.prepare('SELECT count(*) AS c FROM lifecycle_generations').get() as { c: number };
    const p = this.db.prepare('SELECT count(*) AS c FROM lifecycle_gaps').get() as { c: number };
    return { rows: e.n, oldestAt: e.oldestAt, newestAt: e.newestAt, generations: g.c, gaps: p.c };
  }

  /**
   * The pairs `divergence.provenance-mismatch` weighs — rows carrying BOTH a
   * kernel-observed actor class and a declared surface. NOTHING IS DECIDED
   * HERE: `corroboration()` (L0) is the only function allowed to relate the
   * families, and `divergence.ts` is where it is called. This is a read.
   *
   * `json_extract` rather than a second column pair: the families ride as JSON
   * precisely because they never merge, and two more columns would be two more
   * places for a newer ccd's field to be dropped.
   *
   * MAPPED, NOT CAST. `json_extract` answers whatever the JSON held — a
   * number, a boolean, a null — and `as unknown as ProvenancePair[]` would
   * launder that past the only narrowing door there is. A row whose class or
   * surface is not a string cannot be modelled AS A PAIR, and an unmodellable
   * value is not a disagreement, so it is dropped here rather than raised
   * downstream.
   */
  recentProvenance(sinceAt: number, limit: number): ProvenancePair[] {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 1000) : 500;
    const rows = this.db.prepare(
      "SELECT sessionId AS id, at, json_extract(obsJson, '$.cg') AS obsClass, " +
      // `INDEXED BY lifecycle_by_at`, FORCED rather than left to the planner
      // (Tasks 40/41 review, F1). Measured on an in-memory `node:sqlite` with
      // 500,000 rows over 30 days (~1.5-2yr of growth at schema.ts's own ~90
      // MB/year — this table is NEVER PRUNED): a bare `CREATE INDEX
      // lifecycle_by_at ON lifecycle_events(at)`, with NO hint, is not enough
      // -- SQLite still chose `SCAN lifecycle_events` (confirmed with and
      // without `ANALYZE`), because the WHERE column (`at`) and the ORDER BY
      // column (`id`) differ and the planner prefers the scan order that
      // satisfies `ORDER BY id DESC` for free over paying for an explicit
      // sort, even when that scan is the more expensive plan by orders of
      // magnitude. `INDEXED BY` does not change what this query MEANS —
      // `ORDER BY lifecycle_events.id DESC` below is untouched, byte for
      // byte, so every existing behaviour (the alias-shadowing note two
      // lines down included) still holds. It only forces the ACCESS PATH:
      // seek the `at` index to the window's lower bound (`SEARCH … USING
      // INDEX lifecycle_by_at (at>?)`), then sort ONLY the rows that
      // survived the WHERE (bounded by the window, never by table size) into
      // a temp b-tree for `id DESC` (`USE TEMP B-TREE FOR ORDER BY`).
      // Verified array-order-IDENTICAL to the unindexed query, row for row,
      // on three datasets: a realistic under-limit window, an out-of-order
      // two-generation case built specifically to prove `at` and `id` order
      // can diverge, and that same case pushed past the `limit` where a
      // reshaped `ORDER BY at DESC` (the alternative considered and
      // rejected) would have picked a DIFFERENT top-N.
      "json_extract(decJson, '$.surface') AS decSurface " +
      'FROM lifecycle_events INDEXED BY lifecycle_by_at ' +
      'WHERE sessionId IS NOT NULL AND obsJson IS NOT NULL AND decJson IS NOT NULL ' +
      // `lifecycle_events.id`, QUALIFIED: `id` is now an output alias for
      // `sessionId`, and SQLite resolves a bare `ORDER BY id` to the alias —
      // which would order this window by session name instead of by arrival.
      'AND at IS NOT NULL AND at >= ? ORDER BY lifecycle_events.id DESC LIMIT ?',
    ).all(sinceAt, n) as {
      id: string; at: number | null; obsClass: unknown; decSurface: unknown;
    }[];
    return rows.flatMap((r) => (
      typeof r.obsClass === 'string' && typeof r.decSurface === 'string'
        ? [{ id: r.id, at: r.at, obsClass: r.obsClass, decSurface: r.decSurface }]
        : []
    ));
  }

  /* ── claims (build 9 wave 7, D11/D12) ──────────────────────────────────── */

  /** The column list, named ONCE — `SELECT *` is banned in this directory. */
  private static readonly CLAIM_COLS =
    'id, project, heldBy, heldByUuid, intent, runId, state, ' +
    'createdAt, renewedAt, expiresAt, hardExpiresAt, endedAt, endedBy';

  /** One raw row + its path set -> the typed shape. `state` goes through
   *  `isClaimState`, never a cast — the same rule `hydrateRun`/`feedEvents`
   *  hold. `ClaimState` has no designated we-do-not-know member (the L0 pin:
   *  exactly four stored words), so a token a newer build wrote cannot be
   *  modelled AS A SUMMARY at all — `null`, and the list readers drop the row
   *  (`recentProvenance`'s rule: an unmodellable value is not a disagreement). */
  private hydrateClaim(r: {
    id: number; project: string; heldBy: string; heldByUuid: string | null;
    intent: string; runId: number | null; state: string; createdAt: number;
    renewedAt: number; expiresAt: number; hardExpiresAt: number;
    endedAt: number | null; endedBy: string | null;
  }, paths: readonly string[]): ClaimSummary | null {
    if (!isClaimState(r.state)) return null;
    return {
      id: r.id, project: r.project, paths, heldBy: r.heldBy, heldByUuid: r.heldByUuid,
      intent: r.intent, runId: r.runId, state: r.state,
      createdAt: r.createdAt, renewedAt: r.renewedAt,
      expiresAt: r.expiresAt, hardExpiresAt: r.hardExpiresAt,
      endedAt: r.endedAt, endedBy: r.endedBy,
    };
  }

  /** A claim's path set, fixed at insert — `claim_paths.live` mirrors the
   *  parent's state, it never shrinks the set, so the read is by claimId
   *  alone and an ended claim keeps answering "held ON WHAT until it died". */
  private claimPaths(claimId: number): string[] {
    return (this.db.prepare(
      'SELECT path FROM claim_paths WHERE claimId = ? ORDER BY rowid',
    ).all(claimId) as { path: string }[]).map((r) => r.path);
  }

  private claimRow(id: number): ClaimSummary {
    const row = this.db.prepare(
      `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE id = ?`,
    ).get(id) as Parameters<CoordStore['hydrateClaim']>[0] | undefined;
    if (row === undefined) throw new Error(`claims row ${id} vanished inside its own transaction`);
    const hydrated = this.hydrateClaim(row, this.claimPaths(id));
    // A row THIS transaction wrote carries this build's own state word.
    if (hydrated === null) throw new Error(`claims row ${id} unmodellable inside its own transaction`);
    return hydrated;
  }

  /**
   * Acquire (or renew) a set of path claims, as ONE transaction (D11) —
   * the two mechanisms IN THIS ORDER, so a reviewer does not read either
   * as redundant:
   *
   *  1. THE IN-TRANSACTION READ IS THE CAS. `tx()` is `BEGIN IMMEDIATE` and
   *     `DatabaseSync` has no async surface, so nothing can interleave
   *     between the read below and the inserts under it. `decideClaim` (L1)
   *     owns the conflict rule — exact match AND directory-prefix containment
   *     both ways (`shared` vs `shared/api.ts`), which no index can express.
   *  2. THE PARTIAL UNIQUE INDEX `claim_one_owner` IS THE BACKSTOP: if a
   *     future refactor ever loses the transaction, the failure is a LOUD
   *     constraint violation, never a silent duplicate.
   *
   * All-or-nothing (D12): five paths, one conflict ⇒ zero acquired, and the
   * refusal names EVERY conflicting path. A live claim this session already
   * holds on the exact path is RENEWED — intent re-written, lease re-armed,
   * never past the hard cap ("an intent can be written every ten minutes").
   *
   * `holderDeliverable` is the per-holder measurement the CALLER made
   * (`peerDeliverable` over records the route already holds) — the store
   * cannot measure the fleet, so when the caller did not either, the answer
   * on every conflict is the honest `'unknown'` (D9: unknown is not no).
   */
  claimAttempt(input: {
    project: string; paths: readonly string[]; sessionId: string; uuid: string;
    runId: number | null; intent: string; now?: number;
    holderDeliverable?: (sessionId: string) => PeerDeliverable;
  }): ClaimAttemptResult {
    const now = input.now ?? Date.now();
    const deliverable = input.holderDeliverable ?? ((): PeerDeliverable => 'unknown');
    return tx(this.db, () => {
      // 1 — expire lapsed rows IN THE SAME TX, then read, then insert (D11).
      this.expireLapsedInner(now);
      const liveRows = this.db.prepare(
        'SELECT id, heldBy, heldByUuid, intent, runId, expiresAt FROM claims ' +
        "WHERE project = ? AND state = 'live' ORDER BY id",
      ).all(input.project) as { id: number; heldBy: string; heldByUuid: string;
                                intent: string; runId: number | null; expiresAt: number }[];
      const livePaths = this.db.prepare(
        'SELECT claimId, path FROM claim_paths WHERE project = ? AND live = 1 ORDER BY rowid',
      ).all(input.project) as { claimId: number; path: string }[];
      const pathsOf = new Map<number, string[]>();
      for (const p of livePaths) {
        const list = pathsOf.get(p.claimId);
        if (list === undefined) pathsOf.set(p.claimId, [p.path]); else list.push(p.path);
      }
      // Object literals against the L1 interface — a `ClaimRow` member this
      // file forgets, or invents, is a compile error (the reviveFleetSession
      // mechanism, `decideClaim`'s own conflict literal holds it too).
      const live: ClaimRow[] = liveRows.map((c) => ({
        id: c.id, project: input.project, paths: pathsOf.get(c.id) ?? [],
        heldBy: c.heldBy, heldByUuid: c.heldByUuid, intent: c.intent, runId: c.runId,
        expiresAt: c.expiresAt, holderDeliverable: deliverable(c.heldBy),
      }));
      const decision = decideClaim(live, {
        project: input.project, paths: input.paths, sessionId: input.sessionId,
      });
      if ('refused' in decision) {
        return { ok: false as const, why: 'bad-path' as const, paths: decision.paths };
      }
      if ('conflict' in decision) {
        return { ok: false as const, why: 'conflict' as const, conflicts: decision.conflict };
      }
      // decideClaim's ok arm carries the NORMALIZED, deduped set — the only
      // spelling that may reach `claim_paths` (`normalizeClaimPath`, the
      // schema's own comment on the column).
      const paths = decision.paths;
      // The holder's own live claims: a requested path an own claim already
      // holds EXACTLY renews that whole claim (D12 ruling 3 — re-POSTing the
      // same paths re-writes intent AND re-arms the lease); only the paths no
      // own claim holds become a new row, so the backstop index never fires
      // on a legitimate re-declaration.
      const renewIds: number[] = [];
      const fresh: string[] = [];
      for (const p of paths) {
        const own = live.find((c) => c.heldBy === input.sessionId && c.paths.includes(p));
        if (own !== undefined) { if (!renewIds.includes(own.id)) renewIds.push(own.id); }
        else fresh.push(p);
      }
      const out: ClaimSummary[] = [];
      for (const id of renewIds) {
        this.db.prepare(
          'UPDATE claims SET heldByUuid = ?, runId = ?, intent = ?, renewedAt = ?, ' +
          "expiresAt = MIN(?, hardExpiresAt) WHERE id = ? AND state = 'live'",
        ).run(input.uuid, input.runId, input.intent, now, now + CLAIM_LEASE_MS, id);
        out.push(this.claimRow(id));
      }
      if (fresh.length > 0) {
        const res = this.db.prepare(
          'INSERT INTO claims (project, heldBy, heldByUuid, intent, runId, state, ' +
          'createdAt, renewedAt, expiresAt, hardExpiresAt) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(input.project, input.sessionId, input.uuid, input.intent, input.runId,
          'live', now, now, now + CLAIM_LEASE_MS, now + CLAIM_HARD_CAP_MS);
        const claimId = Number(res.lastInsertRowid);
        const ins = this.db.prepare(
          'INSERT INTO claim_paths (claimId, project, path, live) VALUES (?, ?, ?, 1)');
        for (const p of fresh) ins.run(claimId, input.project, p);
        out.push(this.claimRow(claimId));
      }
      return { ok: true as const, claims: out };
    });
  }

  /** THE GUARD IS IN THE `WHERE`, not in the read above it — `setWorkItemState`'s
   *  exact shape and reason: `changes === 0` past a successful lookup means
   *  exactly one thing, the row was not live. One `tx()` for the state word
   *  AND the `claim_paths.live` mirror bit — the schema's own contract: the
   *  bit is written in the SAME transaction as every `claims.state`
   *  transition, or the partial index answers for a claim that no longer is. */
  private endClaim(id: number, state: 'released' | 'broken', by: string,
                   now: number): ClaimEndResult {
    return tx(this.db, () => {
      const row = this.db.prepare('SELECT state FROM claims WHERE id = ?').get(id) as
        { state: string } | undefined;
      if (!row) return { ok: false as const, why: 'unknown-claim' as const };
      const res = this.db.prepare(
        "UPDATE claims SET state = ?, endedAt = ?, endedBy = ? WHERE id = ? AND state = 'live'",
      ).run(state, now, by, id);
      if (Number(res.changes) === 0) {
        return { ok: false as const, why: 'not-live' as const,
                 state: isClaimState(row.state) ? row.state : null };
      }
      this.db.prepare('UPDATE claim_paths SET live = 0 WHERE claimId = ?').run(id);
      return { ok: true as const, state };
    });
  }

  /** Expire in the same transaction as every claim attempt — the
   *  `feed_events` prune-on-write idiom (D12): a claim route never sees a
   *  stale row even if the watcher is wedged. Hard cap FIRST, so a row past
   *  both bounds records the harder word. LAPSE, NEVER DELETE. Each lane
   *  flips the `claim_paths.live` mirror bit under the SAME predicate before
   *  re-wording the parent — one transition, one transaction, or the partial
   *  index answers for a claim that no longer is. */
  private expireLapsedInner(now: number): void {
    this.db.prepare(
      'UPDATE claim_paths SET live = 0 WHERE claimId IN ' +
      "(SELECT id FROM claims WHERE state = 'live' AND hardExpiresAt <= ?)",
    ).run(now);
    this.db.prepare(
      "UPDATE claims SET state = 'lapsed', endedAt = ?, endedBy = 'hard-cap' " +
      "WHERE state = 'live' AND hardExpiresAt <= ?",
    ).run(now, now);
    this.db.prepare(
      'UPDATE claim_paths SET live = 0 WHERE claimId IN ' +
      "(SELECT id FROM claims WHERE state = 'live' AND expiresAt <= ?)",
    ).run(now);
    this.db.prepare(
      "UPDATE claims SET state = 'lapsed', endedAt = ?, endedBy = 'expired' " +
      "WHERE state = 'live' AND expiresAt <= ?",
    ).run(now, now);
  }

  claimRelease(id: number, by: string, now: number = Date.now()): ClaimEndResult {
    return this.endClaim(id, 'released', by, now);
  }

  /** `POST /api/claims/:id/break` — a door the CLAIMANT is not the one to walk
   *  through (the `abandon` shape). Same mechanics as release; a different
   *  word, because "I am done" and "someone pried this open" are different
   *  facts a `?all=1` reader needs to tell apart. */
  claimBreak(id: number, by: string, now: number = Date.now()): ClaimEndResult {
    return this.endClaim(id, 'broken', by, now);
  }

  activeClaims(): ClaimSummary[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE state = 'live' ORDER BY id`,
    ).all() as Parameters<CoordStore['hydrateClaim']>[0][];
    return rows.flatMap((r) => this.hydrateClaim(r, this.claimPaths(r.id)) ?? []);
  }

  /** The no-project `?all=1` arm: every project's rows, ended included — the
   *  same verbatim read `claimsForProject(project, true)` gives one project,
   *  for the PWA's whole-fleet history call (`api.claims({all:true})`). */
  allClaims(): ClaimSummary[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.CLAIM_COLS} FROM claims ORDER BY id`,
    ).all() as Parameters<CoordStore['hydrateClaim']>[0][];
    return rows.flatMap((r) => this.hydrateClaim(r, this.claimPaths(r.id)) ?? []);
  }

  /** `all` includes lapsed/released/broken rows — `?all=1`'s "held by X until
   *  it died" (D12: a destroyed claim is destroyed history). */
  claimsForProject(project: string, all = false): ClaimSummary[] {
    const rows = (all
      ? this.db.prepare(
          `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE project = ? ORDER BY id`)
      : this.db.prepare(
          `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE project = ? AND state = 'live' ORDER BY id`)
    ).all(project) as Parameters<CoordStore['hydrateClaim']>[0][];
    return rows.flatMap((r) => this.hydrateClaim(r, this.claimPaths(r.id)) ?? []);
  }

  /** The watcher's renew write (D12: no session-side heartbeat — the SERVER
   *  renews off records it already read). `MIN(?, hardExpiresAt)` is the 8 h
   *  bound no renewal can move; the `state = 'live'` guard keeps a racing
   *  lapse from being silently reopened. No `claim_paths` write: the state
   *  word does not change, so the mirror bit already tells the truth. */
  renewClaimRow(id: number, expiresAt: number, at: number): void {
    this.db.prepare(
      "UPDATE claims SET renewedAt = ?, expiresAt = MIN(?, hardExpiresAt) " +
      "WHERE id = ? AND state = 'live'",
    ).run(at, expiresAt, id);
  }

  /** LAPSE, NEVER DELETE (D12): the row survives with endedAt/endedBy, so
   *  `?all=1` can answer "held by X until it died". A destroyed claim is
   *  destroyed history. One `tx()` for the state word AND the
   *  `claim_paths.live` mirror bit — the schema's own contract, `endClaim`'s
   *  exact shape: the bit is written in the SAME transaction as every
   *  `claims.state` transition, or the partial index answers for a claim
   *  that no longer is. */
  lapseClaimRow(id: number, endedBy: string, at: number): void {
    tx(this.db, () => {
      const res = this.db.prepare(
        "UPDATE claims SET state = 'lapsed', endedAt = ?, endedBy = ? " +
        "WHERE id = ? AND state = 'live'",
      ).run(at, endedBy, id);
      if (Number(res.changes) > 0) {
        this.db.prepare('UPDATE claim_paths SET live = 0 WHERE claimId = ?').run(id);
      }
    });
  }

  /** Run close releases that run's claims IN THE CLOSE TRANSACTION (D12) —
   *  called from `closeRun` only, after the final advance has succeeded,
   *  beside the delivery cancellation it mirrors — and like that method it
   *  takes no `tx()` of its own, because it runs inside `closeRun`'s. The
   *  mirror-bit flip reads the parents through a subquery FIRST
   *  (`expireLapsedInner`'s idiom — it must see them while they still read
   *  live), then the parents take the released word. */
  releaseClaimsForRun(runId: number, at: number): void {
    this.db.prepare(
      'UPDATE claim_paths SET live = 0 WHERE claimId IN ' +
      "(SELECT id FROM claims WHERE runId = ? AND state = 'live')",
    ).run(runId);
    this.db.prepare(
      "UPDATE claims SET state = 'released', endedAt = ?, endedBy = 'run-closed' " +
      "WHERE runId = ? AND state = 'live'",
    ).run(at, runId);
  }

  /* ── the deviation ledger (build 9 wave 7, D8/D13) ─────────────────────── */

  ledgerFloor(project: string): { floor: number; evidence: string; updatedAt: number } | null {
    const row = this.db.prepare(
      'SELECT floor, evidence, updatedAt FROM ledger_floor WHERE project = ?',
    ).get(project) as { floor: number; evidence: string; updatedAt: number } | undefined;
    return row ?? null;
  }

  /** THE FLOOR ONLY EVER RISES (D13) — the conflict arm's WHERE clause is the
   *  mechanism, not caller discipline: a lower scan later (a plan deleted, a
   *  worktree's partial docs) can never walk allocation backward into numbers
   *  already handed out. */
  raiseLedgerFloor(project: string, floor: number, evidence: string, at: number): void {
    this.db.prepare(
      'INSERT INTO ledger_floor (project, floor, evidence, updatedAt) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(project) DO UPDATE SET floor = excluded.floor, ' +
      'evidence = excluded.evidence, updatedAt = excluded.updatedAt ' +
      'WHERE excluded.floor > ledger_floor.floor',
    ).run(project, floor, evidence, at);
  }

  /**
   * Allocate `count` contiguous deviation numbers, as ONE transaction — and
   * the ORDER inside it is the design (D8):
   *
   *   THE FILE FIRST, THE COMMIT SECOND. `log.append` runs before the
   *   INSERTs, inside the same synchronous flow, so a crash — or the
   *   `PRIMARY KEY (project, n)` backstop firing under a future refactor
   *   that loses this transaction — leaves numbers in the file that the
   *   database never committed. Recovery is MAX(file, db): those numbers
   *   are SKIPPED, NEVER REISSUED. Gaps cost nothing; a reissue is the
   *   bb47c9e incident (394 D-ref lines rewritten under merge pressure).
   *
   * Fails shut until seeded (`409 not-seeded` at the route) — `openCoordDb`'s
   * own "refuse to start rather than open empty", one level up. The route
   * owns the 3× in-request retry on a thrown constraint violation.
   *
   * `log` is a PARAMETER, not a constructor field: the route holds the
   * process's one `LedgerLog` (`defaultLedgerLogPath()`), and tests hand in
   * fixture-homed ones — the same reason `dueDeliveries` takes `replayMs`
   * from its caller instead of owning policy here.
   */
  allocateDeviations(input: {
    project: string; count: number; title: string; allocatedTo: string;
    runId: number | null; now?: number;
  }, log: LedgerLog): AllocateResult {
    const now = input.now ?? Date.now();
    return tx(this.db, () => {
      const floorRow = this.ledgerFloor(input.project);
      const dbMax = (this.db.prepare(
        'SELECT MAX(n) AS m FROM ledger_alloc WHERE project = ?',
      ).get(input.project) as { m: number | null }).m;
      const fileMax = log.maxAllocated(input.project);
      // `decideAllocation` (L1) only compares — the store MEASURES maxIssued,
      // and the file's half is what makes recovery MAX(file, db).
      const maxIssued = dbMax === null ? fileMax
        : fileMax === null ? dbMax : Math.max(dbMax, fileMax);
      const d = decideAllocation(floorRow, maxIssued, input.count);
      if (!('ok' in d)) return { ok: false as const, why: d.refused };
      log.append(d.numbers.map((n) => ({
        project: input.project, n, title: input.title,
        allocatedTo: input.allocatedTo, at: now,
      })));
      for (const n of d.numbers) {
        this.db.prepare(
          'INSERT INTO ledger_alloc (project, n, title, allocatedTo, runId, allocatedAt, state) ' +
          "VALUES (?, ?, ?, ?, ?, ?, 'allocated')",
        ).run(input.project, n, input.title, input.allocatedTo, input.runId, now);
      }
      return {
        ok: true as const,
        allocation: {
          project: input.project, numbers: d.numbers, floor: d.floor,
          title: input.title, allocatedTo: input.allocatedTo,
          runId: input.runId, allocatedAt: now,
        },
      };
    });
  }

  private static readonly LEDGER_COLS =
    'project, n, title, allocatedTo, runId, allocatedAt, state, landedAt, landedIn';

  private hydrateLedger(r: {
    project: string; n: number; title: string; allocatedTo: string; runId: number | null;
    allocatedAt: number; state: string; landedAt: number | null; landedIn: string | null;
  }): LedgerRow {
    // "Read back through the L0 guard, never a cast" — the schema's own rule.
    return { ...r, state: isDeviationAllocState(r.state) ? r.state : 'unknown' };
  }

  ledgerAllocations(project: string): LedgerRow[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.LEDGER_COLS} FROM ledger_alloc WHERE project = ? ORDER BY n`,
    ).all(project) as Parameters<CoordStore['hydrateLedger']>[0][];
    return rows.map((r) => this.hydrateLedger(r));
  }

  /** Every not-yet-landed allocation across every project — what
   *  `sweepLedgerReconcile` walks. */
  openAllocations(): LedgerRow[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.LEDGER_COLS} FROM ledger_alloc WHERE state = 'allocated' ` +
      'ORDER BY project, n',
    ).all() as Parameters<CoordStore['hydrateLedger']>[0][];
    return rows.map((r) => this.hydrateLedger(r));
  }

  /** allocated -> landed, once — `landed` genuinely means "in a merged plan"
   *  (D13), so the guard keeps a re-scan from re-stamping the date. */
  markLanded(project: string, n: number, landedIn: string, at: number): void {
    this.db.prepare(
      "UPDATE ledger_alloc SET state = 'landed', landedAt = ?, landedIn = ? " +
      "WHERE project = ? AND n = ? AND state = 'allocated'",
    ).run(at, landedIn, project, n);
  }

  /** Allocated at or before `cutoff`, never landed — REPORTED, never
   *  reclaimed (D13). The cutoff is the CALLER's (the watcher owns the
   *  7-day policy), the `dueDeliveries(replayMs)` pattern. */
  staleAllocations(cutoff: number): LedgerRow[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.LEDGER_COLS} FROM ledger_alloc ` +
      "WHERE state = 'allocated' AND allocatedAt <= ? ORDER BY project, n",
    ).all(cutoff) as Parameters<CoordStore['hydrateLedger']>[0][];
    return rows.map((r) => this.hydrateLedger(r));
  }
}
