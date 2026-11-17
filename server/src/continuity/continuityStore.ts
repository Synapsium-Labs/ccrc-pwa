// L3 adapter: the start report's table and the generations' (Overlord spec §3.3.11, H12, W1a), the card's and the notes'
// (§3.3.3, §3.3.2; each its own section below), and the probes' (§3.3.5, the last section). `continuity_starts` has one writer, `insertStart`, and one read,
// `startsSince` (the generations lane's); `continuity_generations` and `continuity_cursor` are written only through the
// generation functions below, by the generations lane. `CoordStore` keeps one-line delegates of the same names. Nothing
// here decides: the door (`routes.ts`) validates, the lane's deciders decide, and this file records and measures.
// The renewal readings' section (W1, PR A) reads the closed-book spot probes by class and keeps the daily backstop's row,
// `renewal_backstop_settings`, whose one writer is `setBackstop`, called only by its door.
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  GENERATION_STATES, HOLD_OFF_MS, STATE_DEADLINE_S, isBookState, isGenerationOutcome, isGenerationState, isNoteKeyKind, isNoteKind,
  isProbeClass, isProbeGrade, isProbeRoundKind, isRenewalTrigger, isTriggerClass, startSourceOf, type BookState, type ContinuityReadDoor,
  type GenerationOutcome, type GenerationState, type HandoverNote, type HandoverThread, type NoteKey, type NoteKind, type ProbeClass,
  type ProbeGrade, type ProbeRoundKind, type RenewalTrigger, type StartRow, type TriggerClass,
} from '../../../shared/continuity.js';
import { isFleetRole, type FleetRole } from '../../../shared/fleetRoles.js';
import {
  TIMER_STATES, cancelActorOf, isTimerCancelReason, timerMoveAllowed, type TimerActor, type TimerCancelReason, type TimerState,
} from '../../../shared/continuity-timers.js';
import type { Observed } from '../time/observed.js';
import { isTickMailSubject } from '../coord/ledgersMail.js';
import { isDigestCorrectionSubject } from '../coord/digest.js';
import { isRulingSource, type Checkpoint, type CheckpointHandover, type CheckpointNote, type Ruling } from './checkpoint.js';
import type { GenView } from './generationMachine.js';
import { tx } from '../coord/tx.js';
import type { SpotProbe } from './probes.js';
import { isBackstopHour, isBackstopZone, type BackstopRead } from '../../../shared/renewal-readings.js';
import { startLoadsRowOf, type StartLoadsRaw, type StartLoadsReport, type StartLoadsRow } from './startLoads.js';
export type { StartLoadsReport } from './startLoads.js';

/** What the door hands the writer: `source` is the payload's word as it came. */
export interface StartInsert {
  sessionId: string;
  reportId: string;
  uuid: string;
  source: string;
  model: string | null;
  /** The registry row's incarnation (`CCRC_SESSION_GENERATION`, a lowercase UUID), or null. */
  rowIncarnation: string | null;
  reportedAt: number;
  receivedAt: number;
}

/** `fresh: false` is a resend that met the unique key: the first report's row stands and its id is answered. */
export type StartInsertResult = { ok: true; id: number; fresh: boolean } | { ok: false; kind: 'write-failed' };
export type StartsRead = { ok: true; rows: StartRow[] } | { ok: false; detail: string };

/** The table's one writer. A resend (the same `sessionId` and `reportId`) writes nothing and answers the stored row's
 *  id with `fresh: false`; a statement that fails answers `write-failed`, never a throw. */
export function insertStart(db: DatabaseSync, row: StartInsert): StartInsertResult {
  try {
    const res = db.prepare(
      'INSERT INTO continuity_starts (sessionId, reportId, uuid, source, model, rowIncarnation, reportedAt, receivedAt) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sessionId, reportId) DO NOTHING',
    ).run(row.sessionId, row.reportId, row.uuid, startSourceOf(row.source), row.model, row.rowIncarnation, row.reportedAt, row.receivedAt);
    if (Number(res.changes) === 1) return { ok: true, id: Number(res.lastInsertRowid), fresh: true };
    const held = db.prepare('SELECT id FROM continuity_starts WHERE sessionId = ? AND reportId = ?')
      .get(row.sessionId, row.reportId) as { id: number } | undefined;
    return held === undefined ? { ok: false, kind: 'write-failed' } : { ok: true, id: held.id, fresh: false };
  } catch {
    return { ok: false, kind: 'write-failed' };
  }
}

// ── The loads report (Overlord W1 sandbox, Task 5; spec §3.6 H4, Table 11.1e) ─────────────────────────────────────────
// `continuity_start_loads` has ONE writer, `insertStartLoads`, and one read, `startLoadsOfNewestStart`. No reader picks a
// report by session alone: every read joins the newest `startup` or `resume` start by `startId`, so an older start's report
// never answers for a newer start (Review Focus 3).

export type StartLoadsInsertResult = { ok: true; startId: number; fresh: boolean } | { ok: false; kind: 'unknown-start' | 'write-failed' };

/** The table's one writer. The start is the session's own `startup` or `resume` start the `reportId` names, the only
 *  sources the read returns (`unknown-start` when the server has not recorded it yet, which the hook keeps and resends, and
 *  for a `clear` or `compact` start, whose report no read would return: review 2135 nit). The first body for a start is kept (`fresh: true`); a resend of
 *  the same body changes nothing; a body that differs sets `conflicted`. Both answer `fresh: false`. */
export function insertStartLoads(db: DatabaseSync, sessionId: string, r: StartLoadsReport, receivedAt: number): StartLoadsInsertResult {
  try {
    return tx(db, () => {
      const start = db.prepare("SELECT id FROM continuity_starts WHERE sessionId = ? AND reportId = ? AND source IN ('startup', 'resume')").get(sessionId, r.reportId) as
        { id: number } | undefined;
      if (start === undefined) return { ok: false, kind: 'unknown-start' } as const;
      const res = db.prepare(
        'INSERT INTO continuity_start_loads (startId, profileRole, profileDigest, launchRc, claudeVersion, permissionMode, cwdInWorkspace, '
        + 'loaded, carriedFrom, bodySha256, reportedAt, receivedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (startId) DO NOTHING',
      ).run(start.id, r.profileRole, r.profileDigest, r.launchRc, r.claudeVersion, r.permissionMode,
        r.cwdInWorkspace === null ? null : r.cwdInWorkspace ? 1 : 0, JSON.stringify(r.loaded), r.carriedFrom, r.bodySha256, r.reportedAt, receivedAt);
      if (Number(res.changes) === 1) return { ok: true, startId: start.id, fresh: true } as const;
      db.prepare('UPDATE continuity_start_loads SET conflicted = 1 WHERE startId = ? AND bodySha256 != ? AND conflicted = 0').run(start.id, r.bodySha256);
      return { ok: true, startId: start.id, fresh: false } as const;
    });
  } catch {
    return { ok: false, kind: 'write-failed' };
  }
}

export type NewestStartLoadsRead =
  | { ok: true; newest: { start: StartRow; report: StartLoadsRow | null } | null }
  | { ok: false; detail: string };

/** The session's newest `startup` or `resume` start (by `reportedAt`, then id) with its report joined by `startId`, the
 *  start with a null report when none landed, or null when the session has no such start. A failed read answers ok: false. */
export function startLoadsOfNewestStart(db: DatabaseSync, sessionId: string): NewestStartLoadsRead {
  try {
    const row = stmt(db,
      'SELECT s.id, s.sessionId, s.reportId, s.uuid, s.source, s.model, s.rowIncarnation, s.reportedAt, s.receivedAt, '
      + 'l.startId AS lStartId, l.profileRole, l.profileDigest, l.launchRc, l.claudeVersion, l.permissionMode, l.cwdInWorkspace, '
      + 'l.loaded, l.carriedFrom, l.conflicted FROM continuity_starts s LEFT JOIN continuity_start_loads l ON l.startId = s.id '
      + "WHERE s.sessionId = ? AND s.source IN ('startup', 'resume') ORDER BY s.reportedAt DESC, s.id DESC LIMIT 1",
    ).get(sessionId) as (Record<string, unknown> & { source: string; lStartId: number | null }) | undefined;
    if (row === undefined) return { ok: true, newest: null };
    const start = { id: row['id'], sessionId: row['sessionId'], reportId: row['reportId'], uuid: row['uuid'], source: startSourceOf(row.source),
      model: row['model'], rowIncarnation: row['rowIncarnation'], reportedAt: row['reportedAt'], receivedAt: row['receivedAt'] } as StartRow;
    const report = row.lStartId === null ? null : startLoadsRowOf({ ...(row as unknown as StartLoadsRaw), startId: row.lStartId });
    return { ok: true, newest: { start, report } };
  } catch (e) {
    return { ok: false, detail: `continuity_start_loads read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Every recorded start after `sinceId`, in id order, at most `limit` of them (all when negative): the generations lane's
 *  read. A failed read answers ok: false. */
export function startsSince(db: DatabaseSync, sinceId: number, limit = -1): StartsRead {
  try {
    const rows = stmt(db,
      'SELECT id, sessionId, reportId, uuid, source, model, rowIncarnation, reportedAt, receivedAt FROM continuity_starts WHERE id > ? ORDER BY id LIMIT ?',
    ).all(sinceId, limit) as unknown as (Omit<StartRow, 'source'> & { source: string })[];
    // The table has no CHECK, so a word a newer build wrote reads through the same rule as the writer (review 1911, F10).
    return { ok: true, rows: rows.map((r) => ({ ...r, source: startSourceOf(r.source) })) };
  } catch (e) {
    return { ok: false, detail: `continuity_starts read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** One session's recorded starts, newest first in its own order (`reportedAt`, then id), at most `limit` of them: the
 *  read a coordinator's first generation is minted from (review 2003 F2). A failed read answers ok: false. */
export function startsOf(db: DatabaseSync, sessionId: string, limit: number): StartsRead {
  try {
    const rows = stmt(db,
      'SELECT id, sessionId, reportId, uuid, source, model, rowIncarnation, reportedAt, receivedAt FROM continuity_starts '
      + 'WHERE sessionId = ? ORDER BY reportedAt DESC, id DESC LIMIT ?',
    ).all(sessionId, limit) as unknown as (Omit<StartRow, 'source'> & { source: string })[];
    return { ok: true, rows: rows.map((r) => ({ ...r, source: startSourceOf(r.source) })) };
  } catch (e) {
    return { ok: false, detail: `continuity_starts read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------------------------------------------------- the generations
// `continuity_generations` and `continuity_cursor` (Overlord spec §3.3.1 C36, §3.3.11 H12, W1a; migration 68). ONE
// writer, the generations lane (`generationsLane.ts`), through the functions below; `CoordStore` keeps one-line
// delegates. Every write is a compare-and-set on the row the caller read (`GenExpect`), so a pass that raced another
// writer, or a restart, changes nothing it did not read.
//
// TWO STATE COLUMNS, ONE WALK (reviews 1896 R1, 1902 F1). A walk is a generation's way out of `active` or `degraded` and
// back: from a mint at `carded`, or from a due trigger. `walk` records the mode it began in, read once a pass from the
// `continuity` row: a live walk moves `state` and `deadlineAt`, a shadow walk moves `shadowState` and
// `shadowDeadlineAt`, and a walk keeps its mode to its end (`active`, `degraded` or `ended`) whatever the row says
// meanwhile. So shadow never moves `state` (the mail gate and the prompt route read it), a live walk finishes on `state`
// after the row drops to shadow, and a deadline set by a shadow walk never stands on a row whose `state` is `active`.
// When the row is live and a shadow walk's residue stands, `clearShadowWalk` removes it, and the next due trigger starts
// a live walk; nothing begun in shadow is carried into `state`.

/** The mode a walk began in. */
export type WalkMode = 'live' | 'shadow';

/** One row of `continuity_generations`, as read. Every column the machine's view needs is here, so a pass after a restart
 *  resumes from the row and never from memory. */
export interface GenRow {
  readonly id: number; readonly identity: string; readonly sessionId: string; readonly role: FleetRole;
  readonly term: number; readonly rowIncarnation: string | null; readonly n: number;
  readonly state: GenerationState; readonly shadowState: GenerationState | null; readonly walk: WalkMode | null;
  readonly walkClass: TriggerClass | null; readonly enteredAt: number;
  readonly deadlineAt: number | null; readonly shadowDeadlineAt: number | null;
  readonly dueSince: number | null; readonly dueWhy: RenewalTrigger | null; readonly dueClass: TriggerClass | null;
  readonly dueSinceObservedMs: number | null;
  readonly proven: boolean; readonly renudged: boolean; readonly probeRounds: number; readonly hostEnded: boolean;
  readonly blind: readonly RenewalTrigger[] | null;
  readonly model: string | null; readonly prevModel: string | null; readonly lane: string | null; readonly host: string | null;
  /** The previous generation's account, written by the mint alone, as `prevModel` is (account organization §4); null for
   *  the first generation, one whose predecessor had no lane, and a row an older build wrote. */
  readonly prevLane: string | null;
  readonly cardHash: string | null; readonly snapshotId: string | null; readonly attempts: number;
  readonly outcome: GenerationOutcome | null; readonly resumed: boolean;
  readonly startId: number; readonly startReportedAt: number;
  readonly observed: Observed; readonly mintedObservedMs: number;
  readonly softRenewalObservedMs: number | null; readonly holdOffUntilObservedMs: number | null;
}

/** What a compare-and-set compares: the row's place in its identity's line and both state columns with the walk, as the
 *  caller read them (the key `(identity, term, n, state)`, with the shadow column beside `state`). */
export type GenExpect = Pick<GenRow, 'term' | 'n' | 'state' | 'shadowState' | 'walk'>;
export const genExpectOf = (r: GenRow): GenExpect =>
  ({ term: r.term, n: r.n, state: r.state, shadowState: r.shadowState, walk: r.walk });

/** The column a walk moves. */
export type GenColumn = 'state' | 'shadowState';

/** THE ONE ACCESSOR for a generation's effective state (review 1902 F6): the state of the walk in flight, else, outside a
 *  walk, `state` while `continuity` is live and the shadow column's last word (or `state`) while it is shadow. The
 *  deadline is the same column's; the nudge point is derived from it (`CARDED_NUDGE_AT_MS`, review 1912 F3: the carded
 *  deadline less the lane period), so it is never a second stored fact. `column` is where the next step writes. */
export interface EffectiveGeneration {
  readonly state: GenerationState;
  readonly deadlineAt: number | null;
  readonly column: GenColumn;
  /** The shadow column holds what a walk begun in shadow left, and the row is live: `clearShadowWalk` removes it. */
  readonly shadowResidue: boolean;
}
export function effectiveGeneration(r: GenRow, live: boolean): EffectiveGeneration {
  const shadowResidue = live && r.walk !== 'live' && (r.shadowState !== null || r.walk === 'shadow');
  if (r.walk === 'live' || (r.walk === null && live)) return { state: r.state, deadlineAt: r.deadlineAt, column: 'state', shadowResidue };
  return { state: r.shadowState ?? r.state, deadlineAt: r.shadowState === null ? null : r.shadowDeadlineAt, column: 'shadowState', shadowResidue };
}

/** The machine's view of a generation (`generationStep`'s argument), from its effective state and its columns. */
export function genViewOf(r: GenRow, live: boolean): GenView {
  return {
    state: effectiveGeneration(r, live).state, tries: r.attempts, cls: r.walkClass, renudged: r.renudged,
    probeRounds: r.probeRounds, hostEnded: r.hostEnded, proven: r.proven,
  };
}

/** The states a walk ends in: outside them a walk is in flight. */
const WALK_ENDS: ReadonlySet<GenerationState> = new Set<GenerationState>(['active', 'degraded', 'ended']);
const deadlineFor = (s: GenerationState, now: number): number | null => {
  const sec = (STATE_DEADLINE_S as Readonly<Partial<Record<GenerationState, number>>>)[s];
  return sec === undefined ? null : now + sec * 1_000;
};

const GEN_COLUMNS = 'id, identity, sessionId, role, term, rowIncarnation, n, state, shadowState, walk, walkClass, enteredAt, '
  + 'deadlineAt, shadowDeadlineAt, dueSince, dueWhy, dueClass, dueSinceObservedMs, proven, renudged, probeRounds, hostEnded, '
  + 'blind, model, prevModel, lane, host, cardHash, snapshotId, attempts, outcome, resumed, startId, startReportedAt, observed, '
  + 'mintedObservedMs, softRenewalObservedMs, holdOffUntilObservedMs, prevLane';

/** The generation functions' statements, prepared once per database: the lane runs every period over a handful of rows,
 *  and compiling the same SQL on every call is most of a pass's cost. */
const PREPARED = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
function stmt(db: DatabaseSync, sql: string): StatementSync {
  let byText = PREPARED.get(db);
  if (byText === undefined) { byText = new Map(); PREPARED.set(db, byText); }
  let st = byText.get(sql);
  if (st === undefined) { st = db.prepare(sql); byText.set(sql, st); }
  return st;
}

const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'bigint' ? Number(v) : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
function observedOf(v: unknown): Observed | null {
  if (typeof v !== 'string') return null;
  try {
    const o = JSON.parse(v) as Record<string, unknown>;
    return typeof o.ms === 'number' && typeof o.mono === 'number' && typeof o.proc === 'string' ? { ms: o.ms, mono: o.mono, proc: o.proc } : null;
  } catch { return null; }
}
/** The `blind` column: null when never written, the triggers when every word is one this build knows, else `undefined`
 *  (the row does not read: review 2003 F13). */
function blindOf(v: unknown): RenewalTrigger[] | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  try {
    const a: unknown = JSON.parse(v);
    return Array.isArray(a) && a.every(isRenewalTrigger) ? a : undefined;
  } catch { return undefined; }
}

/** A row as stored, or the reason it is not one this build can read: a token outside a vocabulary, or a column a
 *  newer build wrote in a shape this one does not know. A row that does not read is never guessed into one. */
function genRowOf(raw: Record<string, unknown>): GenRow | string {
  const state = raw.state; const shadow = raw.shadowState; const walk = raw.walk; const role = raw.role;
  const observed = observedOf(raw.observed);
  const num = (k: string): number | null => intOrNull(raw[k]);
  if (!isGenerationState(state)) return `state ${String(state)}`;
  if (shadow !== null && !isGenerationState(shadow)) return `shadowState ${String(shadow)}`;
  if (walk !== null && walk !== 'live' && walk !== 'shadow') return `walk ${String(walk)}`;
  if (!isFleetRole(role)) return `role ${String(role)}`;
  if (observed === null) return 'observed';
  const id = num('id'); const term = num('term'); const n = num('n'); const enteredAt = num('enteredAt');
  const startId = num('startId'); const startReportedAt = num('startReportedAt'); const minted = num('mintedObservedMs');
  if (id === null || term === null || n === null || enteredAt === null || startId === null || startReportedAt === null || minted === null) return 'a counter';
  // A word column is null (not written) or a word this build knows; any other value fails the row, as `state` does (review
  // 2003 F13): a newer build's class read as "no class" would send a draining row down the soft branch.
  const walkClass = raw.walkClass; const dueWhy = raw.dueWhy; const dueClass = raw.dueClass; const outcome = raw.outcome;
  if (walkClass !== null && !isTriggerClass(walkClass)) return `walkClass ${String(walkClass)}`;
  if (dueWhy !== null && !isRenewalTrigger(dueWhy)) return `dueWhy ${String(dueWhy)}`;
  if (dueClass !== null && !isTriggerClass(dueClass)) return `dueClass ${String(dueClass)}`;
  if (outcome !== null && !isGenerationOutcome(outcome)) return `outcome ${String(outcome)}`;
  const blind = blindOf(raw.blind);
  if (blind === undefined) return `blind ${String(raw.blind)}`;
  return {
    id, identity: String(raw.identity), sessionId: String(raw.sessionId), role, term, rowIncarnation: strOrNull(raw.rowIncarnation),
    n, state, shadowState: shadow as GenerationState | null, walk: walk as WalkMode | null,
    walkClass, enteredAt,
    deadlineAt: num('deadlineAt'), shadowDeadlineAt: num('shadowDeadlineAt'),
    dueSince: num('dueSince'), dueWhy, dueClass,
    dueSinceObservedMs: num('dueSinceObservedMs'),
    proven: num('proven') === 1, renudged: num('renudged') === 1, probeRounds: num('probeRounds') ?? 0, hostEnded: num('hostEnded') === 1,
    blind, model: strOrNull(raw.model), prevModel: strOrNull(raw.prevModel), lane: strOrNull(raw.lane), prevLane: strOrNull(raw.prevLane),
    host: strOrNull(raw.host), cardHash: strOrNull(raw.cardHash), snapshotId: strOrNull(raw.snapshotId), attempts: num('attempts') ?? 0,
    outcome, resumed: num('resumed') === 1, startId, startReportedAt,
    observed, mintedObservedMs: minted, softRenewalObservedMs: num('softRenewalObservedMs'),
    holdOffUntilObservedMs: num('holdOffUntilObservedMs'),
  };
}

export type GenerationsRead = { ok: true; rows: GenRow[] } | { ok: false; detail: string };

/** Every generation that is not ended, in id order: the lane's read. ALL-OR-FAILURE: one row this build cannot read
 *  fails the read, so a pass acts on no partial picture. */
export function liveGenerations(db: DatabaseSync): GenerationsRead {
  try {
    const raws = stmt(db, `SELECT ${GEN_COLUMNS} FROM continuity_generations WHERE state <> 'ended' ORDER BY id`).all() as Record<string, unknown>[];
    const rows: GenRow[] = [];
    for (const raw of raws) {
      const r = genRowOf(raw);
      if (typeof r === 'string') return { ok: false, detail: `continuity_generations row ${String(raw.id)}: ${r}` };
      rows.push(r);
    }
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, detail: `continuity_generations read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The WHERE clause of every compare-and-set, and its arguments. */
const CAS = 'id = ? AND term = ? AND n = ? AND state = ? AND shadowState IS ? AND walk IS ?';
const casArgs = (id: number, e: GenExpect): (number | string | null)[] => [id, e.term, e.n, e.state, e.shadowState, e.walk];
const changedOf = (r: { changes: number | bigint }): { changed: boolean } => ({ changed: Number(r.changes) === 1 });

export interface MintInput {
  identity: string; sessionId: string; role: FleetRole; term: number; rowIncarnation: string | null;
  startId: number; startReportedAt: number; resumed: boolean; model: string | null; lane: string | null; host: string | null;
  /** The outcome written on the generation this start ends, when there is one. */
  outcome: GenerationOutcome;
  /** This process's monotonic reading and id: the new row's accumulator is re-anchored on them with no advance. */
  mono: number; proc: string;
  now: number;
}
export type MintResult = { ok: true; id: number; n: number } | { ok: false; kind: 'superseded' | 'write-failed' };

class Superseded extends Error {}

/** In ONE transaction: end the identity's live generation with `outcome` and insert the next at `carded`. `expect` is the
 *  live row the caller read, or null when it read none; `superseded` when the live row is not that, or the start was
 *  minted already. The new row walks live when the pass is live or the row it ends was on a live walk (a live walk that a
 *  start completes goes on, live, on the next generation, ruling F1), and in shadow otherwise, so a shadow mint never
 *  writes `state` past `active` and a walk begun in shadow is never carried into `state`. Its accumulator is the identity's newest row's `observed.ms` within the same `term`, re-anchored
 *  with no advance (0 for an identity's first generation of a term; review 2003 N2). `cursor`, when given, advances the lane's cursor in the same transaction, so a crash never
 *  separates the last mint of a pass from the cursor that covers it. */
export function mintGeneration(db: DatabaseSync, input: MintInput, expect: GenExpect | null, live: boolean,
  cursor: CursorAdvance | null = null): MintResult {
  try {
    return tx(db, () => {
      const held = stmt(db, `SELECT ${GEN_COLUMNS} FROM continuity_generations WHERE identity = ? AND state <> 'ended'`)
        .all(input.identity) as Record<string, unknown>[];
      const old = held.length === 0 ? null : genRowOf(held[0]!);
      if (typeof old === 'string') throw new Superseded();
      if (expect === null ? old !== null : old === null || old.term !== expect.term || old.n !== expect.n || old.state !== expect.state
        || old.shadowState !== expect.shadowState || old.walk !== expect.walk) throw new Superseded();
      if (stmt(db, 'SELECT 1 FROM continuity_generations WHERE startId = ?').get(input.startId) !== undefined) throw new Superseded();
      const newest = stmt(db, 'SELECT observed, n, model, lane FROM continuity_generations WHERE identity = ? AND term = ? ORDER BY n DESC LIMIT 1')
        .get(input.identity, input.term) as { observed: unknown; n: unknown; model: unknown; lane: unknown } | undefined;
      const carried = observedOf(newest?.observed)?.ms ?? 0;
      const n = (intOrNull(newest?.n) ?? 0) + 1;
      if (old !== null) {
        const ended = stmt(db, "UPDATE continuity_generations SET state = 'ended', outcome = ?, walk = NULL, deadlineAt = NULL, "
          + `shadowDeadlineAt = NULL WHERE ${CAS}`).run(input.outcome, ...casArgs(old.id, old));
        if (Number(ended.changes) !== 1) throw new Superseded();
      }
      const mode: WalkMode = old?.walk === 'live' || live ? 'live' : 'shadow';
      const deadline = deadlineFor('carded', input.now);
      const observed: Observed = { ms: carried, mono: input.mono, proc: input.proc };
      const res = stmt(db, 
        'INSERT INTO continuity_generations (identity, sessionId, role, term, rowIncarnation, n, state, shadowState, walk, enteredAt, '
        + 'deadlineAt, shadowDeadlineAt, proven, resumed, startId, startReportedAt, model, prevModel, lane, host, observed, mintedObservedMs, '
        + 'prevLane) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(input.identity, input.sessionId, input.role, input.term, input.rowIncarnation, n,
        mode === 'live' ? 'carded' : 'active', mode === 'live' ? null : 'carded', mode, input.now,
        mode === 'live' ? deadline : null, mode === 'live' ? null : deadline,
        input.resumed ? 1 : 0, input.startId, input.startReportedAt, input.model, strOrNull(newest?.model), input.lane, input.host,
        JSON.stringify(observed), carried, strOrNull(newest?.lane));
      if (cursor !== null && !advanceCursorIn(db, cursor)) throw new Superseded();
      return { ok: true as const, id: Number(res.lastInsertRowid), n };
    });
  } catch (e) {
    return { ok: false, kind: e instanceof Superseded ? 'superseded' : 'write-failed' };
  }
}

/** The designate arm's re-stamp (Overlord designation plan Task 1, X5), `overlordDesignationStore.ts#goLive`'s: the body's live
 *  generation, minted under its own session id (or already `overlord`), takes identity `overlord` and the raised `term`. It
 *  runs INSIDE the caller's transaction (`tx` does not nest), so it opens none and answers `changed: false` rather than
 *  throwing when the identity `overlord` already holds a live generation of another session (the live-identity index). */
export function restampOverlordGeneration(db: DatabaseSync, sessionId: string, term: number): { changed: boolean } {
  return changedOf(stmt(db, "UPDATE continuity_generations SET identity = 'overlord', term = ? WHERE sessionId = ? AND state <> 'ended' "
    + "AND identity IN (?, 'overlord') AND NOT EXISTS (SELECT 1 FROM continuity_generations o WHERE o.identity = 'overlord' "
    + "AND o.state <> 'ended' AND o.sessionId <> ?)").run(term, sessionId, sessionId, sessionId));
}

/** Retire's writer (Overlord designation A, F4): end the live `overlord` generation of `sessionId` with outcome `retired`, as a mint
 *  ends one (state, outcome, walk and deadlines), so a later designate's first mint finds no live `overlord` row. It runs INSIDE
 *  the caller's transaction and opens none. */
export function endOverlordGeneration(db: DatabaseSync, sessionId: string): { changed: boolean } {
  return changedOf(stmt(db, "UPDATE continuity_generations SET state = 'ended', outcome = 'retired', walk = NULL, deadlineAt = NULL, "
    + "shadowDeadlineAt = NULL WHERE identity = 'overlord' AND sessionId = ? AND state <> 'ended'").run(sessionId));
}

/** One step of a walk: the machine's next view, written to the walk's column (`effectiveGeneration`'s `column`).
 *  Entering a state with a deadline sets that column's deadline from `STATE_DEADLINE_S`; staying in a state leaves it
 *  as it was (ruling I2: no function takes a new deadline for a state the row is already in); entering `active` or
 *  `degraded` clears it and ends the walk. A step never ends a generation: only a mint does, so `ended` is refused.
 *  `card`, when given (a `card-read` step), records the card hash and snapshot the generation read, in the same write. */
export function stepGeneration(db: DatabaseSync, id: number, expect: GenExpect, next: GenView, live: boolean, now: number,
  card: { readonly hash: string; readonly snapshotId: string } | null = null): { changed: boolean } {
  if (next.state === 'ended' || !GENERATION_STATES.includes(next.state)) return { changed: false };
  const mode: WalkMode = expect.walk ?? (live ? 'live' : 'shadow');
  const current = mode === 'live' ? expect.state : (expect.shadowState ?? expect.state);
  const entering = next.state !== current;
  const walk = WALK_ENDS.has(next.state) ? null : mode;
  const stateCol = mode === 'live' ? 'state' : 'shadowState';
  const deadlineCol = mode === 'live' ? 'deadlineAt' : 'shadowDeadlineAt';
  const deadlineSet = entering ? `, ${deadlineCol} = ?` : '';
  const args: (number | string | null)[] = [next.state, walk, next.cls, next.proven ? 1 : 0, next.renudged ? 1 : 0, next.probeRounds,
    next.hostEnded ? 1 : 0, next.tries];
  if (entering) args.push(now, deadlineFor(next.state, now));
  if (card !== null) args.push(card.hash, card.snapshotId);
  const cardSet = card === null ? '' : ', cardHash = ?, snapshotId = ?';
  try {
    return changedOf(stmt(db, `UPDATE continuity_generations SET ${stateCol} = ?, walk = ?, walkClass = ?, proven = ?, renudged = ?, `
      + `probeRounds = ?, hostEnded = ?, attempts = ?${entering ? ', enteredAt = ?' : ''}${deadlineSet}${cardSet} WHERE ${CAS}`)
      .run(...args, ...casArgs(id, expect)));
  } catch {
    return { changed: false };
  }
}

/** The row is live and a walk begun in shadow left its residue: remove it, and the next due trigger starts a live walk.
 *  A row whose `state` is `active` is a working generation again, as `GEN_ACTIVE` (proven, no counters); a `degraded` one
 *  keeps its `proven` and its counters (review 2003 F12), so a generation the machine degraded is never marked proven by
 *  a shadow walk's clearing. */
export function clearShadowWalk(db: DatabaseSync, id: number, expect: GenExpect, now: number): { changed: boolean } {
  if (expect.walk === 'live') return { changed: false };
  const atRest = (col: string, value: number | 'NULL'): string => `${col} = CASE WHEN state = 'active' THEN ${value} ELSE ${col} END`;
  try {
    return changedOf(stmt(db, 'UPDATE continuity_generations SET shadowState = NULL, shadowDeadlineAt = NULL, walk = NULL, '
      + `${atRest('walkClass', 'NULL')}, ${atRest('proven', 1)}, ${atRest('renudged', 0)}, ${atRest('probeRounds', 0)}, `
      + `${atRest('hostEnded', 0)}, ${atRest('attempts', 0)}, enteredAt = ? WHERE ${CAS}`)
      .run(now, ...casArgs(id, expect)));
  } catch {
    return { changed: false };
  }
}

/** What a pass learnt of `renewalDue`: due (the trigger, its class, the wall time and the accumulator at which it became
 *  due) or not, and always the triggers it could not read. A generation already due keeps the time it became due. */
export type DueWrite = { due: true; why: RenewalTrigger; cls: TriggerClass; at: number; observedMs: number } | { due: false };
export function setGenerationDue(db: DatabaseSync, id: number, expect: GenExpect, due: DueWrite, blind: readonly RenewalTrigger[]): { changed: boolean } {
  try {
    const b = JSON.stringify(blind);
    if (!due.due) {
      return changedOf(stmt(db, 'UPDATE continuity_generations SET dueSince = NULL, dueWhy = NULL, dueClass = NULL, '
        + `dueSinceObservedMs = NULL, blind = ? WHERE ${CAS}`).run(b, ...casArgs(id, expect)));
    }
    return changedOf(stmt(db, 'UPDATE continuity_generations SET dueSince = COALESCE(dueSince, ?), dueWhy = ?, dueClass = ?, '
      + `dueSinceObservedMs = COALESCE(dueSinceObservedMs, ?), blind = ? WHERE ${CAS}`)
      .run(due.at, due.why, due.cls, due.observedMs, b, ...casArgs(id, expect)));
  } catch {
    return { changed: false };
  }
}

/** The identity's accumulator, advanced by the pass (`observeTime`). */
export function advanceObserved(db: DatabaseSync, id: number, expect: GenExpect, observed: Observed): { changed: boolean } {
  try {
    return changedOf(stmt(db, `UPDATE continuity_generations SET observed = ? WHERE ${CAS}`)
      .run(JSON.stringify(observed), ...casArgs(id, expect)));
  } catch {
    return { changed: false };
  }
}

/** The hold-off after a renewal that went back to `active` (the machine's `set-hold-off`; review 1902 F4): stored
 *  ABSOLUTE on the identity's accumulator, `observed.ms + HOLD_OFF_MS`, so the gather subtracts `mintedObservedMs` to put
 *  it on the generation's own age (`softTimesOf`). */
export function setHoldOff(db: DatabaseSync, id: number, expect: GenExpect): { changed: boolean } {
  try {
    return changedOf(stmt(db, 'UPDATE continuity_generations SET holdOffUntilObservedMs = '
      + `CAST(json_extract(observed, '$.ms') AS INTEGER) + ? WHERE ${CAS}`).run(HOLD_OFF_MS, ...casArgs(id, expect)));
  } catch {
    return { changed: false };
  }
}

/** The lane's place in `continuity_starts`. */
export interface CursorAdvance { lane: string; from: number; to: number }
export type CursorRead = { ok: true; lastStartId: number } | { ok: false; detail: string };

/** The cursor of `lane`: 0 when it has never advanced. */
export function generationsCursor(db: DatabaseSync, lane: string): CursorRead {
  try {
    const row = stmt(db, 'SELECT lastStartId FROM continuity_cursor WHERE lane = ?').get(lane) as { lastStartId: unknown } | undefined;
    if (row === undefined) return { ok: true, lastStartId: 0 };
    const v = intOrNull(row.lastStartId);
    return v === null ? { ok: false, detail: 'continuity_cursor.lastStartId is not a number' } : { ok: true, lastStartId: v };
  } catch (e) {
    return { ok: false, detail: `continuity_cursor read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function advanceCursorIn(db: DatabaseSync, c: CursorAdvance): boolean {
  if (!(c.to >= c.from)) return false;
  const r = c.from === 0
    ? stmt(db, 'INSERT INTO continuity_cursor (lane, lastStartId) VALUES (?, ?) ON CONFLICT (lane) DO UPDATE SET lastStartId = excluded.lastStartId '
      + 'WHERE continuity_cursor.lastStartId = 0').run(c.lane, c.to)
    : stmt(db, 'UPDATE continuity_cursor SET lastStartId = ? WHERE lane = ? AND lastStartId = ?').run(c.to, c.lane, c.from);
  return Number(r.changes) === 1;
}

/** Advance the cursor from `from` (what the caller read) to `to`; a cursor that moved meanwhile changes nothing. */
export function advanceCursor(db: DatabaseSync, c: CursorAdvance): { changed: boolean } {
  try { return { changed: advanceCursorIn(db, c) }; } catch { return { changed: false }; }
}

// ------------------------------------------------------------------------------------------------- the card
// `continuity_snapshots` and `continuity_card_reads` (Overlord spec §3.3.3 C38, §3.3.5, W1a, the card piece; migration 69).
// ONE writer, the card door (`routes.ts`), through `insertSnapshot` and `insertCardRead`; the generations lane reads a
// generation's card read through `cardReadOfStart`. A failed statement answers ok: false, never a throw.

export interface SnapshotInsert {
  /** sha256 of the facts JSON, the time of rendering left out. */
  readonly id: string;
  readonly sessionId: string;
  readonly at: number;
  readonly facts: string;
  /** The card hash this render produced. */
  readonly hash: string;
}

/** Store one render's snapshot: a new id inserts a row; a stored id keeps its row (one snapshot per id) and records this
 *  serve, its hash and its place in the serve sequence, so the session's current card is the snapshot served last. */
export function insertSnapshot(db: DatabaseSync, s: SnapshotInsert): { ok: true; fresh: boolean } | { ok: false } {
  try {
    return tx(db, () => {
      const held = stmt(db, 'SELECT 1 FROM continuity_snapshots WHERE id = ?').get(s.id) !== undefined;
      // The sequence is the session's own: only the order within one session is ever read, and keyed by session it is one
      // lookup on `continuity_snapshots_by_session` (review 2023 F11).
      const next = 'COALESCE((SELECT MAX(served) FROM continuity_snapshots WHERE sessionId = ?), 0) + 1';
      if (held) stmt(db, `UPDATE continuity_snapshots SET hash = ?, served = ${next} WHERE id = ?`).run(s.hash, s.sessionId, s.id);
      else {
        stmt(db, `INSERT INTO continuity_snapshots (id, sessionId, at, facts, hash, served) VALUES (?, ?, ?, ?, ?, ${next})`)
          .run(s.id, s.sessionId, s.at, s.facts, s.hash, s.sessionId);
      }
      return { ok: true as const, fresh: !held };
    });
  } catch {
    return { ok: false };
  }
}

export interface CardReadInsert {
  readonly sessionId: string;
  /** The conversation that read it: the door's attributed `byUuid`. */
  readonly uuid: string;
  readonly snapshotId: string;
  readonly hash: string;
  readonly pages: number;
  readonly at: number;
}

/** Record one full read: every page of one card hash was served to the session. */
export function insertCardRead(db: DatabaseSync, r: CardReadInsert): { ok: true; id: number } | { ok: false } {
  try {
    const res = stmt(db, 'INSERT INTO continuity_card_reads (sessionId, uuid, snapshotId, hash, pages, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.sessionId, r.uuid, r.snapshotId, r.hash, r.pages, r.at);
    return { ok: true, id: Number(res.lastInsertRowid) };
  } catch {
    return { ok: false };
  }
}

/** A generation's card read: the newest full read by the conversation its start reported, made at or after the start was
 *  received, with whether its hash is the session's current card (the hash of the snapshot served last). `read: null`
 *  when that conversation has read none since. */
export interface CardReadOfStart {
  readonly id: number; readonly hash: string; readonly snapshotId: string; readonly at: number; readonly current: boolean;
}
export type CardReadRead = { ok: true; read: CardReadOfStart | null } | { ok: false; detail: string };

/** The generations lane's read (`card-read` for a generation in `carded`): matched by the start's session and conversation
 *  uuid, so a read made before the lane minted the generation still counts and no cursor can pass over it, and bounded to
 *  reads made at or after the start's `receivedAt` (both the server's wall clock), so a resumed conversation, which keeps
 *  its uuid, never counts a read of its previous generation (review 2023 F3). */
export function cardReadOfStart(db: DatabaseSync, startId: number): CardReadRead {
  try {
    const row = stmt(db,
      'SELECT r.id AS id, r.hash AS hash, r.snapshotId AS snapshotId, r.at AS at, '
      + '(r.hash = (SELECT c.hash FROM continuity_snapshots c WHERE c.sessionId = r.sessionId ORDER BY c.served DESC LIMIT 1)) AS current '
      + 'FROM continuity_starts s JOIN continuity_card_reads r ON r.sessionId = s.sessionId AND r.uuid = s.uuid '
      + 'WHERE s.id = ? AND r.at >= s.receivedAt ORDER BY r.id DESC LIMIT 1',
    ).get(startId) as Record<string, unknown> | undefined;
    if (row === undefined) return { ok: true, read: null };
    const id = intOrNull(row.id); const at = intOrNull(row.at);
    if (id === null || at === null || typeof row.hash !== 'string' || typeof row.snapshotId !== 'string') {
      return { ok: false, detail: `continuity_card_reads row ${String(row.id)} does not read` };
    }
    return { ok: true, read: { id, hash: row.hash, snapshotId: row.snapshotId, at, current: intOrNull(row.current) === 1 } };
  } catch (e) {
    return { ok: false, detail: `continuity_card_reads read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------------------------------------------------- the timers
// `continuity_timers` (Overlord spec §3.3.12 C61 to C65, I17; W1a, the timers piece; migration 70). Each move of
// `TIMER_TRANSITIONS` has ONE writer here, and checks `timerMoveAllowed` before it writes: the set (`insertTimer`), the
// fire (`markTimersFired`), the cancel (`cancelTimer`) and the purge of terminal rows (`purgeTimers`). Every move is a
// compare-and-set on `state = 'pending'`. A read that fails answers ok: false with a detail, never an empty list.

/** What the set door hands the writer. `role` is `roleOf` at the set, or `undecided`. */
export interface TimerInsert {
  readonly setter: string;
  readonly setterIncarnation: string;
  readonly setById: string;
  readonly setByUuid: string;
  readonly role: FleetRole | 'undecided';
  readonly note: string;
  readonly runId: number | null;
  readonly programme: string | null;
  readonly setAt: number;
  readonly dueAt: number;
}

/** One row as read. `role` is the stored word: a newer build may have written a role this one does not know. */
export interface TimerRow extends Omit<TimerInsert, 'role'> {
  readonly id: number;
  readonly role: string;
  readonly state: TimerState;
  readonly firedAt: number | null;
  readonly mailId: number | null;
  readonly cancelledAt: number | null;
  readonly cancelReason: TimerCancelReason | null;
}
export type TimersRead = { ok: true; rows: TimerRow[] } | { ok: false; detail: string };
/** The stall hold's read (Task 9): the setter's earliest pending timer and its newest fired at or after `firedSince`. */
export type TimerHoldRead =
  | { ok: true; earliestPending: TimerRow | null; newestFired: TimerRow | null }
  | { ok: false; detail: string };

const TIMER_COLUMNS = 'id, setter, setterIncarnation, setById, setByUuid, role, note, runId, programme, setAt, dueAt, state, '
  + 'firedAt, mailId, cancelledAt, cancelReason';

/** A stored row, or the reason it does not read (a state or cancel reason outside this build's vocabulary included). */
function timerRowOf(raw: Record<string, unknown>): TimerRow | string {
  const id = intOrNull(raw.id); const setAt = intOrNull(raw.setAt); const dueAt = intOrNull(raw.dueAt);
  const { setter, setterIncarnation, setById, setByUuid, role, note, state, cancelReason } = raw;
  if (id === null || setAt === null || dueAt === null) return `continuity_timers row ${String(raw.id)} has a time or id that does not read`;
  if (typeof setter !== 'string' || typeof setterIncarnation !== 'string' || typeof setById !== 'string'
    || typeof setByUuid !== 'string' || typeof role !== 'string' || typeof note !== 'string') {
    return `continuity_timers row ${id} has a text column that does not read`;
  }
  if (typeof state !== 'string' || !(TIMER_STATES as readonly string[]).includes(state)) return `continuity_timers row ${id} has state ${String(state)}`;
  // A bound key that does not read fails the read rather than reading as unbound, which would skip the cleanup's run and
  // programme rungs and send the mail run-less (review 2038 F5).
  const runId = intOrNull(raw.runId);
  if (raw.runId !== null && runId === null) return `continuity_timers row ${id} has run ${String(raw.runId)}`;
  if (raw.programme !== null && typeof raw.programme !== 'string') return `continuity_timers row ${id} has programme ${String(raw.programme)}`;
  if (cancelReason !== null && (typeof cancelReason !== 'string' || !isTimerCancelReason(cancelReason))) {
    return `continuity_timers row ${id} has cancel reason ${String(cancelReason)}`;
  }
  return {
    id, setter, setterIncarnation, setById, setByUuid, role, note, runId, programme: strOrNull(raw.programme),
    setAt, dueAt, state: state as TimerState, firedAt: intOrNull(raw.firedAt), mailId: intOrNull(raw.mailId),
    cancelledAt: intOrNull(raw.cancelledAt), cancelReason: cancelReason as TimerCancelReason | null,
  };
}

function timersOf(raws: readonly Record<string, unknown>[]): TimersRead {
  const rows: TimerRow[] = [];
  for (const raw of raws) {
    const r = timerRowOf(raw);
    if (typeof r === 'string') return { ok: false, detail: r };
    rows.push(r);
  }
  return { ok: true, rows };
}

const readFailed = (e: unknown): { ok: false; detail: string } =>
  ({ ok: false, detail: `continuity_timers read failed: ${e instanceof Error ? e.message : String(e)}` });

/** The set: one pending row. A statement that fails answers `write-failed`, never a throw. */
export function insertTimer(db: DatabaseSync, row: TimerInsert): { ok: true; id: number } | { ok: false; kind: 'write-failed' } {
  if (!timerMoveAllowed(null, 'pending', 'set-door')) return { ok: false, kind: 'write-failed' };
  try {
    const res = stmt(db, 'INSERT INTO continuity_timers (setter, setterIncarnation, setById, setByUuid, role, note, runId, programme, '
      + "setAt, dueAt, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')")
      .run(row.setter, row.setterIncarnation, row.setById, row.setByUuid, row.role, row.note, row.runId, row.programme, row.setAt, row.dueAt);
    return { ok: true, id: Number(res.lastInsertRowid) };
  } catch {
    return { ok: false, kind: 'write-failed' };
  }
}

/** The cancel, by `actor` with `reason`: a pending row moves once, and a row that already moved answers `changed: false`.
 *  A reason that belongs to another actor (`cancelActorOf`) is a caller's defect, so it THROWS and moves nothing (slug
 *  cancel-reason-by-actor). */
export function cancelTimer(db: DatabaseSync, id: number, actor: TimerActor, reason: TimerCancelReason, at: number): { changed: boolean } {
  if (cancelActorOf(reason) !== actor) throw new Error(`cancelTimer: reason ${reason} is not ${actor}'s`);
  if (!timerMoveAllowed('pending', 'cancelled', actor)) throw new Error(`cancelTimer: ${actor} may not cancel`);
  return changedOf(stmt(db, "UPDATE continuity_timers SET state = 'cancelled', cancelledAt = ?, cancelReason = ? "
    + "WHERE id = ? AND state = 'pending'").run(at, reason, id));
}

/** The fire: every row of `ids` moves pending to fired with its one mail's id, or none does. A row that already moved makes
 *  it THROW, after undoing its own writes (a savepoint), so the caller's transaction rolls back its mail with it (I17). */
export function markTimersFired(db: DatabaseSync, ids: readonly number[], mailId: number, at: number): { changed: boolean } {
  if (!timerMoveAllowed('pending', 'fired', 'timer-lane')) throw new Error('markTimersFired: the lane may not fire');
  if (ids.length === 0) return { changed: false };
  db.exec('SAVEPOINT continuity_timers_fire');
  try {
    let moved = 0;
    for (const id of ids) {
      moved += Number(stmt(db, "UPDATE continuity_timers SET state = 'fired', firedAt = ?, mailId = ? WHERE id = ? AND state = 'pending'")
        .run(at, mailId, id).changes);
    }
    if (moved !== ids.length) throw new Error(`markTimersFired: ${ids.length - moved} of ${ids.length} timers were no longer pending`);
    db.exec('RELEASE continuity_timers_fire');
    return { changed: true };
  } catch (e) {
    try { db.exec('ROLLBACK TO continuity_timers_fire'); db.exec('RELEASE continuity_timers_fire'); } catch { /* already gone */ }
    throw e;
  }
}

/** One setter's pending timers, oldest due first: the list door's and the card's read. */
export function pendingTimersOf(db: DatabaseSync, setter: string): TimersRead {
  try {
    return timersOf(stmt(db, `SELECT ${TIMER_COLUMNS} FROM continuity_timers WHERE state = 'pending' AND setter = ? ORDER BY dueAt, id`)
      .all(setter) as Record<string, unknown>[]);
  } catch (e) { return readFailed(e); }
}

/** Every pending timer, oldest due first: the timers lane's read. */
export function pendingTimers(db: DatabaseSync): TimersRead {
  try {
    return timersOf(stmt(db, `SELECT ${TIMER_COLUMNS} FROM continuity_timers WHERE state = 'pending' ORDER BY dueAt, id`)
      .all() as Record<string, unknown>[]);
  } catch (e) { return readFailed(e); }
}

/** One timer by its id, whatever its state, or null when no row has it: the cancel doors' read (`timerCancelVerdict` tells
 *  another identity's row from one no longer pending). A row that does not read fails the read, never a null. */
export type TimerByIdRead = { ok: true; row: TimerRow | null } | { ok: false; detail: string };
export function timerById(db: DatabaseSync, id: number): TimerByIdRead {
  try {
    const r = timersOf(stmt(db, `SELECT ${TIMER_COLUMNS} FROM continuity_timers WHERE id = ?`).all(id) as Record<string, unknown>[]);
    return r.ok ? { ok: true, row: r.rows[0] ?? null } : r;
  } catch (e) { return readFailed(e); }
}

/** The stall hold's read: the setter's earliest pending timer, and its newest timer fired at or after `firedSince`. */
export function timerHoldFacts(db: DatabaseSync, setter: string, firedSince: number): TimerHoldRead {
  try {
    const pending = timersOf(stmt(db, `SELECT ${TIMER_COLUMNS} FROM continuity_timers WHERE state = 'pending' AND setter = ? `
      + 'ORDER BY dueAt, id LIMIT 1').all(setter) as Record<string, unknown>[]);
    if (!pending.ok) return pending;
    const fired = timersOf(stmt(db, `SELECT ${TIMER_COLUMNS} FROM continuity_timers WHERE state = 'fired' AND setter = ? AND firedAt >= ? `
      + 'ORDER BY firedAt DESC, id DESC LIMIT 1').all(setter, firedSince) as Record<string, unknown>[]);
    if (!fired.ok) return fired;
    return { ok: true, earliestPending: pending.rows[0] ?? null, newestFired: fired.rows[0] ?? null };
  } catch (e) { return readFailed(e); }
}

/** How many timers `setter` set at or after `since`, whatever became of them (the hourly rate counts cancelled ones). A
 *  failed read THROWS: the set door maps it to `timer-unmeasured`, so it never reads as zero. */
export function setsSince(db: DatabaseSync, setter: string, since: number): number {
  const row = stmt(db, 'SELECT COUNT(*) AS n FROM continuity_timers WHERE setter = ? AND setAt >= ?').get(setter, since) as { n: number | bigint };
  return Number(row.n);
}

/** The purge: fired and cancelled rows whose `firedAt` or `cancelledAt` is before `before` (the lane passes
 *  `now - TIMER_KEEP_MS`). A pending row is never purged. */
export function purgeTimers(db: DatabaseSync, before: number): { removed: number } {
  const res = stmt(db, "DELETE FROM continuity_timers WHERE (state = 'fired' AND firedAt < ?) OR (state = 'cancelled' AND cancelledAt < ?)")
    .run(before, before);
  return { removed: Number(res.changes) };
}

// ------------------------------------------------------------------------------------------------- the notes
// `continuity_notes` and `continuity_handovers` (Overlord spec §3.3.2 C37, W1a, the notes piece; migration 72). ONE writer,
// the note door (`routes.ts`), through `appendNote` and `putHandover`; the door and the card's gatherer read through
// `liveNotes`, `noteById` and `handoverBefore`. APPEND-ONLY: nothing here updates or deletes a note. A failed statement
// answers ok: false, never a throw; a row this build cannot read fails the read whole, never a partial list.

/** One row of `continuity_notes`, as read. */
export interface NoteRow {
  readonly id: number; readonly identity: string; readonly sessionId: string; readonly generationId: number | null;
  readonly key: NoteKey; readonly kind: NoteKind; readonly waitsOn: string; readonly next: string;
  readonly revises: number | null; readonly closes: boolean; readonly at: number;
}
export type NoteInsert = Omit<NoteRow, 'id'>;
export type NotesRead = { ok: true; notes: NoteRow[] } | { ok: false; detail: string };
/** One note and whether it is live (no row revises it and it does not close), or null when there is no such row. */
export type NoteByIdRead = { ok: true; note: (NoteRow & { readonly live: boolean }) | null } | { ok: false; detail: string };

const NOTE_COLUMNS = 'id, identity, sessionId, generationId, keyKind, keyRef, kind, waitsOn, next, revises, closes, at';
const NOTE_KEY_REF = /^[1-9][0-9]{0,15}$/;

/** A row as stored, or why it does not read: a word outside a vocabulary, or a key whose reference is not one. */
function noteRowOf(raw: Record<string, unknown>): NoteRow | string {
  const id = intOrNull(raw.id); const at = intOrNull(raw.at); const keyRef = raw.keyRef; const keyKind = raw.keyKind;
  if (id === null || at === null) return 'a counter';
  if (!isNoteKind(raw.kind)) return `kind ${String(raw.kind)}`;
  if (!isNoteKeyKind(keyKind) || typeof keyRef !== 'string') return `keyKind ${String(keyKind)}`;
  if (keyKind !== 'programme' && !NOTE_KEY_REF.test(keyRef)) return `keyRef ${keyRef}`;
  const key: NoteKey = keyKind === 'programme' ? { kind: 'programme', slug: keyRef } : { kind: keyKind, id: Number(keyRef) };
  if (typeof raw.waitsOn !== 'string' || typeof raw.next !== 'string') return 'text';
  return {
    id, identity: String(raw.identity), sessionId: String(raw.sessionId), generationId: intOrNull(raw.generationId), key,
    kind: raw.kind, waitsOn: raw.waitsOn, next: raw.next, revises: intOrNull(raw.revises), closes: intOrNull(raw.closes) === 1, at,
  };
}
const keyRefOf = (k: NoteKey): string => (k.kind === 'programme' ? k.slug : String(k.id));

function notesOf(raws: readonly Record<string, unknown>[]): NotesRead {
  const notes: NoteRow[] = [];
  for (const raw of raws) {
    const r = noteRowOf(raw);
    if (typeof r === 'string') return { ok: false, detail: `continuity_notes row ${String(raw.id)}: ${r}` };
    notes.push(r);
  }
  return { ok: true, notes };
}

/** The note door's writer. A second revision of one note meets `continuity_notes_one_revision` and answers `superseded`:
 *  two revisions race to one winner. */
export function appendNote(db: DatabaseSync, n: NoteInsert): { ok: true; id: number } | { ok: false; kind: 'superseded' | 'write-failed' } {
  try {
    const res = stmt(db, 'INSERT INTO continuity_notes (identity, sessionId, generationId, keyKind, keyRef, kind, waitsOn, next, '
      + 'revises, closes, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(n.identity, n.sessionId, n.generationId, n.key.kind,
      keyRefOf(n.key), n.kind, n.waitsOn, n.next, n.revises, n.closes ? 1 : 0, n.at);
    return { ok: true, id: Number(res.lastInsertRowid) };
  } catch (e) {
    const unique = e instanceof Error && /UNIQUE constraint failed: continuity_notes\.revises/.test(e.message);
    return { ok: false, kind: unique ? 'superseded' : 'write-failed' };
  }
}

const LIVE_NOTE = 'n.closes = 0 AND NOT EXISTS (SELECT 1 FROM continuity_notes r WHERE r.revises = n.id)';

/** An identity's live notes, newest first. */
export function liveNotes(db: DatabaseSync, identity: string): NotesRead {
  try {
    return notesOf(stmt(db, `SELECT ${NOTE_COLUMNS} FROM continuity_notes n WHERE n.identity = ? AND ${LIVE_NOTE} ORDER BY n.id DESC`)
      .all(identity) as Record<string, unknown>[]);
  } catch (e) {
    return { ok: false, detail: `continuity_notes read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** One note by id, with whether it is live. */
export function noteById(db: DatabaseSync, id: number): NoteByIdRead {
  try {
    const raw = stmt(db, `SELECT ${NOTE_COLUMNS}, (${LIVE_NOTE}) AS live FROM continuity_notes n WHERE n.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (raw === undefined) return { ok: true, note: null };
    const r = noteRowOf(raw);
    return typeof r === 'string' ? { ok: false, detail: `continuity_notes row ${id}: ${r}` } : { ok: true, note: { ...r, live: intOrNull(raw.live) === 1 } };
  } catch (e) {
    return { ok: false, detail: `continuity_notes read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** One stored handover note. */
export interface HandoverRow { readonly generationId: number; readonly n: number; readonly note: HandoverNote; readonly dropped: number; readonly at: number }
export type HandoverRead = { ok: true; handover: HandoverRow | null } | { ok: false; detail: string };

/** The note door's handover writer: one row per generation. A second answers `fresh: false` and the first stands, and
 *  `dropped` is always the STORED row's count, never the refused attempt's (review 2039, F6). */
export function putHandover(db: DatabaseSync, h: { generationId: number; note: HandoverNote; dropped: number; at: number }):
  { ok: true; fresh: boolean; dropped: number } | { ok: false } {
  try {
    const res = stmt(db, 'INSERT INTO continuity_handovers (generationId, note, dropped, at) VALUES (?, ?, ?, ?) ON CONFLICT (generationId) DO NOTHING')
      .run(h.generationId, JSON.stringify(h.note), h.dropped, h.at);
    if (Number(res.changes) === 1) return { ok: true, fresh: true, dropped: h.dropped };
    const held = stmt(db, 'SELECT dropped FROM continuity_handovers WHERE generationId = ?').get(h.generationId) as { dropped?: unknown } | undefined;
    const dropped = intOrNull(held?.dropped);
    return dropped === null ? { ok: false } : { ok: true, fresh: false, dropped };
  } catch {
    return { ok: false };
  }
}

/** A note key as JSON wrote it (a handover thread's reference, a checkpoint note's key), or null when it is not one. */
function noteKeyOfJson(ref: unknown): NoteKey | null {
  if (typeof ref !== 'object' || ref === null) return null;
  const r = ref as Record<string, unknown>;
  if (!isNoteKeyKind(r.kind)) return null;
  if (r.kind === 'programme') return typeof r.slug === 'string' ? { kind: 'programme', slug: r.slug } : null;
  return Number.isSafeInteger(r.id) ? { kind: r.kind, id: r.id as number } : null;
}

function handoverNoteOf(text: string): HandoverNote | null {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    const strings = (a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === 'string');
    if (!Array.isArray(v.threads) || !strings(v.cautions) || typeof v.tone !== 'string') return null;
    const threads: HandoverThread[] = [];
    for (const t of v.threads as Record<string, unknown>[]) {
      const key = noteKeyOfJson(t?.ref);
      if (typeof t?.waitsOn !== 'string' || typeof t.next !== 'string' || key === null) return null;
      threads.push({ ref: key, waitsOn: t.waitsOn, next: t.next });
    }
    return { threads, cautions: v.cautions, tone: v.tone };
  } catch {
    return null;
  }
}

/** This generation's own handover note (written while it was `checkpointed`), or null when it wrote none: the renewal
 *  walk's `handover` event and the checkpoint the acts seal read it (W1a renewal act). */
export function handoverOf(db: DatabaseSync, generationId: number): HandoverRead {
  try {
    const row = stmt(db, 'SELECT g.n AS n, h.note AS note, h.dropped AS dropped, h.at AS at FROM continuity_handovers h '
      + 'JOIN continuity_generations g ON g.id = h.generationId WHERE h.generationId = ?').get(generationId) as Record<string, unknown> | undefined;
    if (row === undefined) return { ok: true, handover: null };
    const note = typeof row.note === 'string' ? handoverNoteOf(row.note) : null;
    const n = intOrNull(row.n); const dropped = intOrNull(row.dropped); const at = intOrNull(row.at);
    if (note === null || n === null || dropped === null || at === null) return { ok: false, detail: `continuity_handovers row ${generationId} does not read` };
    return { ok: true, handover: { generationId, n, note, dropped, at } };
  } catch (e) {
    return { ok: false, detail: `continuity_handovers read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The soft renewals an identity's line spent in one term, as accumulator stamps: one row of `continuity_soft_renewals` per
 *  soft due the lane fed, so a generation that renews softly twice (after one went back) counts twice, and the budget's
 *  window spans generations (ruling R4; slug soft-renewals-are-rows). */
export function softRenewalsOf(db: DatabaseSync, identity: string, term: number): { ok: true; observedMs: number[] } | { ok: false; detail: string } {
  try {
    const rows = stmt(db, 'SELECT observedMs AS at FROM continuity_soft_renewals WHERE identity = ? AND term = ? ORDER BY id')
      .all(identity, term) as { at: unknown }[];
    const out: number[] = [];
    for (const r of rows) { const at = intOrNull(r.at); if (at === null) return { ok: false, detail: 'continuity_soft_renewals observedMs does not read' }; out.push(at); }
    return { ok: true, observedMs: out };
  } catch (e) {
    return { ok: false, detail: `continuity_soft_renewals read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Feeding a soft `due` spends one of the soft budget's renewals: one row, stamped at the accumulator's reading. */
export function recordSoftRenewal(db: DatabaseSync, g: { readonly id: number; readonly identity: string; readonly term: number }, observedMs: number): { ok: boolean } {
  try {
    stmt(db, 'INSERT INTO continuity_soft_renewals (identity, term, generationId, observedMs) VALUES (?, ?, ?, ?)').run(g.identity, g.term, g.id, observedMs);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** The handover note of the generation just before `liveGenerationId` in its identity's line (the one the live generation
 *  replaced), or null when that generation wrote none or there is none. It finds that generation by its place in the line
 *  (the identity's newest row older than the live one), never by reading a state column. */
export function handoverBefore(db: DatabaseSync, identity: string, liveGenerationId: number): HandoverRead {
  try {
    const row = stmt(db,
      'SELECT g.id AS gid, g.n AS n, h.note AS note, h.dropped AS dropped, h.at AS at FROM continuity_generations g '
      + 'LEFT JOIN continuity_handovers h ON h.generationId = g.id WHERE g.identity = ? AND g.id < ? ORDER BY g.id DESC LIMIT 1',
    ).get(identity, liveGenerationId) as Record<string, unknown> | undefined;
    if (row === undefined || row.note === null) return { ok: true, handover: null };
    const note = typeof row.note === 'string' ? handoverNoteOf(row.note) : null;
    const gid = intOrNull(row.gid); const n = intOrNull(row.n); const dropped = intOrNull(row.dropped); const at = intOrNull(row.at);
    if (note === null || gid === null || n === null || dropped === null || at === null) {
      return { ok: false, detail: `continuity_handovers row ${String(row.gid)} does not read` };
    }
    return { ok: true, handover: { generationId: gid, n, note, dropped, at } };
  } catch (e) {
    return { ok: false, detail: `continuity_handovers read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------------------------------------------------- the checkpoint
// `continuity_checkpoints` and `continuity_renew_calls` (Overlord spec §3.3.2 C37, §3.3.11 H12, W1a, the renewal act; its
// migration). ONE writer, the generations lane, through `putCheckpoint`, `claimRenewCall` and `answerRenewCall`; the card's gatherer
// reads the checkpoint of the generation that ended last (`checkpointBefore`), the lane the renew calls of one generation
// (`renewCallsOf`) and a coordinator's rulings (`rulingRowsOf`, which reads mail and writes nothing). A failed statement
// answers ok: false, never a throw; a row this build cannot read fails the read whole, never a partial row.

/** One stored checkpoint, with the outcome the generation it was assembled for ended with (null while it is still live). */
export interface CheckpointRow {
  readonly generationId: number; readonly n: number; readonly outcome: GenerationOutcome | null;
  readonly notes: readonly CheckpointNote[]; readonly rulings: readonly Ruling[]; readonly handover: CheckpointHandover | null;
  readonly at: number;
}
export type CheckpointRead = { ok: true; checkpoint: CheckpointRow | null } | { ok: false; detail: string };
export type CheckpointInsert = Checkpoint & { readonly generationId: number; readonly at: number };

/** The lane's checkpoint writer: one row per generation, the latest assembly standing (a retried step re-stores the same). */
export function putCheckpoint(db: DatabaseSync, c: CheckpointInsert): { ok: true } | { ok: false } {
  try {
    stmt(db, 'INSERT INTO continuity_checkpoints (generationId, notes, rulings, handover, at) VALUES (?, ?, ?, ?, ?) '
      + 'ON CONFLICT (generationId) DO UPDATE SET notes = excluded.notes, rulings = excluded.rulings, handover = excluded.handover, at = excluded.at')
      .run(c.generationId, JSON.stringify(c.notes), JSON.stringify(c.rulings), c.handover === null ? null : JSON.stringify(c.handover), c.at);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

const parsedList = (text: unknown): unknown[] | null => {
  if (typeof text !== 'string') return null;
  try { const v: unknown = JSON.parse(text); return Array.isArray(v) ? v : null; } catch { return null; }
};
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function checkpointNotesOf(text: unknown): CheckpointNote[] | null {
  const list = parsedList(text);
  if (list === null) return null;
  const out: CheckpointNote[] = [];
  for (const x of list) {
    if (!isObj(x)) return null;
    const key = noteKeyOfJson(x.key);
    if (!Number.isSafeInteger(x.id) || !Number.isSafeInteger(x.at) || !isNoteKind(x.kind) || key === null
      || typeof x.waitsOn !== 'string' || typeof x.next !== 'string') return null;
    out.push({ id: x.id as number, at: x.at as number, kind: x.kind, key, waitsOn: x.waitsOn, next: x.next });
  }
  return out;
}

function checkpointRulingsOf(text: unknown): Ruling[] | null {
  const list = parsedList(text);
  if (list === null) return null;
  const out: Ruling[] = [];
  for (const x of list) {
    if (!isObj(x) || !Number.isSafeInteger(x.at) || !isRulingSource(x.source) || typeof x.subject !== 'string' || typeof x.text !== 'string') return null;
    out.push({ at: x.at as number, source: x.source, subject: x.subject, text: x.text });
  }
  return out;
}

/** The handover as a checkpoint stores it: `{n, dropped, note}`, the note read by the handover row's own reader; undefined when
 *  the text is not one (a null handover is the column's NULL, never this). */
function checkpointHandoverOf(text: string): CheckpointHandover | undefined {
  try {
    const v: unknown = JSON.parse(text);
    if (!isObj(v) || !Number.isSafeInteger(v.n) || !Number.isSafeInteger(v.dropped) || !isObj(v.note)) return undefined;
    const note = handoverNoteOf(JSON.stringify(v.note));
    return note === null ? undefined : { n: v.n as number, dropped: v.dropped as number, note };
  } catch {
    return undefined;
  }
}

/** The checkpoint of the generation just before `liveGenerationId` in its identity's line (the one the live generation
 *  replaced), with that generation's outcome, or null when it stored none or there is none. It finds that generation by its
 *  place in the line, as `handoverBefore` does, and reads no state column. A row that does not read, or an outcome word this
 *  build does not know, is a failed read, never null. */
export function checkpointBefore(db: DatabaseSync, identity: string, liveGenerationId: number): CheckpointRead {
  try {
    const row = stmt(db,
      'SELECT g.id AS gid, g.n AS n, g.outcome AS outcome, c.notes AS notes, c.rulings AS rulings, c.handover AS handover, c.at AS at '
      + 'FROM continuity_generations g LEFT JOIN continuity_checkpoints c ON c.generationId = g.id '
      + 'WHERE g.identity = ? AND g.id < ? ORDER BY g.id DESC LIMIT 1',
    ).get(identity, liveGenerationId) as Record<string, unknown> | undefined;
    if (row === undefined || row.at === null) return { ok: true, checkpoint: null };
    const gid = intOrNull(row.gid); const n = intOrNull(row.n); const at = intOrNull(row.at);
    const outcome = row.outcome === null ? null : isGenerationOutcome(row.outcome) ? row.outcome : undefined;
    const notes = checkpointNotesOf(row.notes); const rulings = checkpointRulingsOf(row.rulings);
    const handover = row.handover === null ? null : typeof row.handover === 'string' ? checkpointHandoverOf(row.handover) : undefined;
    if (gid === null || n === null || at === null || outcome === undefined || notes === null || rulings === null || handover === undefined) {
      return { ok: false, detail: `continuity_checkpoints row ${String(row.gid)} does not read` };
    }
    return { ok: true, checkpoint: { generationId: gid, n, outcome, notes, rulings, handover, at } };
  } catch (e) {
    return { ok: false, detail: `continuity_checkpoints read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** One `SessionHost.renew` call the lane made for one try of one renewal of a generation. A renewal is an EPISODE, named by
 *  the wall time its generation entered `clearing` (set once on entry and kept while it retries there), because a
 *  generation that went back to `active` may renew again and its tries start at 1 again (slug renew-calls-keyed-by-episode).
 *  `answer` is null while the call is in flight, or when its answer was lost to a crash (the try is then never repeated: the
 *  lane reads the receipt first). */
export interface RenewCallRow {
  readonly generationId: number; readonly episode: number; readonly try: number; readonly at: number; readonly answer: string | null;
}
export type RenewCallsRead = { ok: true; calls: RenewCallRow[] } | { ok: false; detail: string };
/** Which call: the generation, its renewal's episode and the try within it. */
export interface RenewCallKey { readonly generationId: number; readonly episode: number; readonly try: number }

/** Claims a try BEFORE the call is made, so a crash between the claim and the call never repeats the try: `claimed: true`
 *  for the one caller that inserted the row, `claimed: false` when it was already there. A statement that fails is
 *  `ok: false`, kept apart from "already claimed". */
export function claimRenewCall(db: DatabaseSync, k: RenewCallKey, at: number): { ok: true; claimed: boolean } | { ok: false } {
  try {
    const res = stmt(db, 'INSERT OR IGNORE INTO continuity_renew_calls (generationId, episode, try, at, answer) VALUES (?, ?, ?, ?, NULL)')
      .run(k.generationId, k.episode, k.try, at);
    return { ok: true, claimed: Number(res.changes) === 1 };
  } catch {
    return { ok: false };
  }
}

/** Records a claimed try's answer word, once: the first answer stands, and a try never claimed has no row to answer
 *  (`recorded: false` for both). */
export function answerRenewCall(db: DatabaseSync, k: RenewCallKey, answer: string): { ok: true; recorded: boolean } | { ok: false } {
  try {
    const res = stmt(db, 'UPDATE continuity_renew_calls SET answer = ? WHERE generationId = ? AND episode = ? AND try = ? AND answer IS NULL')
      .run(answer, k.generationId, k.episode, k.try);
    return { ok: true, recorded: Number(res.changes) === 1 };
  } catch {
    return { ok: false };
  }
}

/** One renewal's calls (a generation's episode), in try order. */
export function renewCallsOf(db: DatabaseSync, generationId: number, episode: number): RenewCallsRead {
  try {
    const rows = stmt(db, 'SELECT generationId, episode, try, at, answer FROM continuity_renew_calls WHERE generationId = ? AND episode = ? ORDER BY try')
      .all(generationId, episode) as Record<string, unknown>[];
    const calls: RenewCallRow[] = [];
    for (const r of rows) {
      const g = intOrNull(r.generationId); const ep = intOrNull(r.episode); const t = intOrNull(r.try); const at = intOrNull(r.at);
      if (g === null || ep === null || t === null || at === null || (r.answer !== null && typeof r.answer !== 'string')) {
        return { ok: false, detail: `continuity_renew_calls row (${String(r.generationId)}, ${String(r.episode)}, ${String(r.try)}) does not read` };
      }
      calls.push({ generationId: g, episode: ep, try: t, at, answer: r.answer as string | null });
    }
    return { ok: true, calls };
  } catch (e) {
    return { ok: false, detail: `continuity_renew_calls read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type RulingsRead = { ok: true; rulings: Ruling[] } | { ok: false; detail: string };

/** A coordinator's rulings, newest first, at most `limit`: the operator's mail to its session id that rides no run and whose
 *  subject is a tick's or a digest correction's (measured in `w1a-renewal-act/departures.md`, rulings-rows). The mail kind is
 *  not selected on: the stall watch raises `operator` mail too, and only the subject tells a ruling from a notice. The text is
 *  the mail's body as stored. A mail row that does not read fails the read whole. */
export function rulingRowsOf(db: DatabaseSync, sessionId: string, limit: number): RulingsRead {
  try {
    const out: Ruling[] = [];
    const rows = stmt(db, "SELECT at, subject, body FROM mail WHERE fromId = 'operator' AND toId = ? AND runId IS NULL ORDER BY id DESC").iterate(sessionId);
    for (const r of rows as Iterable<Record<string, unknown>>) {
      const at = intOrNull(r.at);
      if (at === null || typeof r.subject !== 'string' || typeof r.body !== 'string') return { ok: false, detail: 'a mail row to the session does not read' };
      const source = isTickMailSubject(r.subject) ? 'tick' : isDigestCorrectionSubject(r.subject) ? 'correction' : null;
      if (source === null) continue;
      out.push({ at, source, subject: r.subject, text: r.body });
      if (out.length >= limit) break;
    }
    return { ok: true, rulings: out };
  } catch (e) {
    return { ok: false, detail: `mail read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------------------------------------------------- the probes
// `continuity_probes` and `continuity_reads` (Overlord spec §3.3.5 C41, §3.3.9 C52, W1a, the probes piece, PR B; migration 73).
// One writer per fact: the generations lane opens a round (`openRound`), the probe door records its answers (`answerRound`),
// and the card and note GETs stamp a session's reads (`stampContinuityRead`). The lane reads one generation's rounds
// (`probeRows`); the door reads the session's open round (`openProbeRound`) or one round by id (`probeRoundRows`), both in
// its live generation. A failed statement answers ok: false, never a throw; a row this build cannot read fails the read whole.

/** One question of a round as the lane opens it. `choices` is null for an id or `none`. */
export interface ProbeInsertQuestion {
  readonly qid: string; readonly cls: ProbeClass; readonly question: string; readonly choices: readonly string[] | null;
  readonly expected: string;
}
/** A round as the lane opens it: its questions, what it was drawn from, and whether a failed read made it short. */
export interface RoundInsert {
  readonly roundId: string; readonly sessionId: string; readonly generationId: number; readonly kind: ProbeRoundKind;
  readonly questions: readonly ProbeInsertQuestion[]; readonly snapshotId: string | null; readonly depthTokens: number | null;
  readonly modelClass: string | null; readonly roundUnmeasured: boolean; readonly askedAt: number;
  /** An unanswered spot round of the same generation this round supersedes (review 2063 F3), or null. */
  readonly supersedes: string | null;
}
/** One row of `continuity_probes`, as read. */
export interface ProbeRow extends ProbeInsertQuestion {
  readonly id: number; readonly roundId: string; readonly sessionId: string; readonly generationId: number;
  readonly kind: ProbeRoundKind; readonly snapshotId: string | null; readonly depthTokens: number | null;
  readonly modelClass: string | null; readonly roundUnmeasured: boolean; readonly askedAt: number;
  readonly answeredAt: number | null; readonly answer: string | null; readonly grade: ProbeGrade | null; readonly book: BookState | null;
}
export type ProbeRowsRead = { ok: true; rows: ProbeRow[] } | { ok: false; detail: string };

const PROBE_COLUMNS = 'id, roundId, qid, sessionId, generationId, kind, cls, question, choices, expected, snapshotId, depthTokens, '
  + 'modelClass, roundUnmeasured, askedAt, answeredAt, answer, grade, book';

function choicesOf(v: unknown): readonly string[] | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  try {
    const a: unknown = JSON.parse(v);
    return Array.isArray(a) && a.every((x) => typeof x === 'string') ? a : undefined;
  } catch { return undefined; }
}

/** A row as stored, or why it does not read: a word outside a vocabulary, or a column in a shape this build does not know. */
function probeRowOf(raw: Record<string, unknown>): ProbeRow | string {
  const id = intOrNull(raw.id); const generationId = intOrNull(raw.generationId); const askedAt = intOrNull(raw.askedAt);
  if (id === null || generationId === null || askedAt === null) return 'a counter';
  if (!isProbeRoundKind(raw.kind)) return `kind ${String(raw.kind)}`;
  if (!isProbeClass(raw.cls)) return `cls ${String(raw.cls)}`;
  if (raw.grade !== null && !isProbeGrade(raw.grade)) return `grade ${String(raw.grade)}`;
  if (raw.book !== null && !isBookState(raw.book)) return `book ${String(raw.book)}`;
  const choices = choicesOf(raw.choices);
  if (choices === undefined) return 'choices';
  if (typeof raw.roundId !== 'string' || typeof raw.qid !== 'string' || typeof raw.question !== 'string' || typeof raw.expected !== 'string') return 'text';
  if (raw.answer !== null && typeof raw.answer !== 'string') return 'answer';
  return {
    id, roundId: raw.roundId, qid: raw.qid, sessionId: String(raw.sessionId), generationId, kind: raw.kind, cls: raw.cls,
    question: raw.question, choices, expected: raw.expected, snapshotId: strOrNull(raw.snapshotId), depthTokens: intOrNull(raw.depthTokens),
    modelClass: strOrNull(raw.modelClass), roundUnmeasured: intOrNull(raw.roundUnmeasured) === 1, askedAt,
    answeredAt: intOrNull(raw.answeredAt), answer: strOrNull(raw.answer), grade: raw.grade as ProbeGrade | null, book: raw.book as BookState | null,
  };
}
function probeRowsOf(raws: readonly Record<string, unknown>[]): ProbeRowsRead {
  const rows: ProbeRow[] = [];
  for (const raw of raws) {
    const r = probeRowOf(raw);
    if (typeof r === 'string') return { ok: false, detail: `continuity_probes row ${String(raw.id)}: ${r}` };
    rows.push(r);
  }
  return { ok: true, rows };
}
const probeReadFailed = (e: unknown): { ok: false; detail: string } =>
  ({ ok: false, detail: `continuity_probes read failed: ${e instanceof Error ? e.message : String(e)}` });

class RoundHeld extends Error {}

/** The lane's writer: every question of one round, in ONE transaction. `open` when the generation already has a round with
 *  no answer (one open round at a time, compared and set here, so two passes never open two); a round with no question is
 *  never written (`empty`). A round that supersedes an unanswered spot round closes it first, in the same transaction, every
 *  question graded `unmeasured` with no answer (review 2063 F3): it was never the session's to answer, so it never fails. */
export function openRound(db: DatabaseSync, r: RoundInsert): { ok: true } | { ok: false; kind: 'open' | 'empty' | 'write-failed' } {
  if (r.questions.length === 0) return { ok: false, kind: 'empty' };
  try {
    return tx(db, () => {
      if (r.supersedes !== null) {
        stmt(db, "UPDATE continuity_probes SET answeredAt = ?, answer = NULL, grade = 'unmeasured', book = 'unmeasured' "
          + "WHERE roundId = ? AND generationId = ? AND kind = 'spot' AND answeredAt IS NULL").run(r.askedAt, r.supersedes, r.generationId);
      }
      if (stmt(db, 'SELECT 1 FROM continuity_probes WHERE generationId = ? AND answeredAt IS NULL LIMIT 1').get(r.generationId) !== undefined) {
        throw new RoundHeld();
      }
      const ins = stmt(db, 'INSERT INTO continuity_probes (roundId, qid, sessionId, generationId, kind, cls, question, choices, expected, '
        + 'snapshotId, depthTokens, modelClass, roundUnmeasured, askedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const q of r.questions) {
        ins.run(r.roundId, q.qid, r.sessionId, r.generationId, r.kind, q.cls, q.question, q.choices === null ? null : JSON.stringify(q.choices),
          q.expected, r.snapshotId, r.depthTokens, r.modelClass, r.roundUnmeasured ? 1 : 0, r.askedAt);
      }
      return { ok: true as const };
    });
  } catch (e) {
    return { ok: false, kind: e instanceof RoundHeld ? 'open' : 'write-failed' };
  }
}

/** One answered question, as the door records it. */
export interface ProbeAnswerWrite { readonly qid: string; readonly answer: string | null; readonly grade: ProbeGrade }

/** The probe door's writer: every question of one round answered, in ONE transaction, compared and set on the round being
 *  unanswered and the session's own. `closed` when the round was answered meanwhile, or does not hold exactly these
 *  questions. */
export function answerRound(db: DatabaseSync, roundId: string, sessionId: string, answers: readonly ProbeAnswerWrite[], book: BookState,
  at: number): { ok: true } | { ok: false; kind: 'closed' | 'write-failed' } {
  try {
    return tx(db, () => {
      const held = stmt(db, 'SELECT count(*) AS n FROM continuity_probes WHERE roundId = ? AND sessionId = ? AND answeredAt IS NULL')
        .get(roundId, sessionId) as { n: number | bigint };
      if (Number(held.n) !== answers.length) throw new RoundHeld();
      const up = stmt(db, 'UPDATE continuity_probes SET answeredAt = ?, answer = ?, grade = ?, book = ? '
        + 'WHERE roundId = ? AND sessionId = ? AND qid = ? AND answeredAt IS NULL');
      for (const a of answers) {
        if (Number(up.run(at, a.answer, a.grade, book, roundId, sessionId, a.qid).changes) !== 1) throw new RoundHeld();
      }
      return { ok: true as const };
    });
  } catch (e) {
    return { ok: false, kind: e instanceof RoundHeld ? 'closed' : 'write-failed' };
  }
}

/** Every question of one generation's rounds, in id order: the lane's read. */
export function probeRows(db: DatabaseSync, generationId: number): ProbeRowsRead {
  try {
    return probeRowsOf(stmt(db, `SELECT ${PROBE_COLUMNS} FROM continuity_probes WHERE generationId = ? ORDER BY id`).all(generationId) as Record<string, unknown>[]);
  } catch (e) { return probeReadFailed(e); }
}

/** The session's open round: the questions of the newest round with no answer of the session's live generation (its newest
 *  that has not ended, review 2063 F7), in id order, or an empty list when none is open. The door's read. */
export function openProbeRound(db: DatabaseSync, sessionId: string): ProbeRowsRead {
  try {
    return probeRowsOf(stmt(db, `SELECT ${PROBE_COLUMNS} FROM continuity_probes WHERE roundId = (SELECT roundId FROM continuity_probes `
      + 'WHERE sessionId = ? AND answeredAt IS NULL AND generationId = (SELECT max(id) FROM continuity_generations '
      + "WHERE sessionId = ? AND state <> 'ended') ORDER BY id DESC LIMIT 1) AND sessionId = ? ORDER BY id")
      .all(sessionId, sessionId, sessionId) as Record<string, unknown>[]);
  } catch (e) { return probeReadFailed(e); }
}

/** One round's questions by its id, in id order, or an empty list when no row of the session's live generation carries it
 *  (review 2068 F3: the answer door finds a round where the read door serves one, in the newest generation that has not
 *  ended, so a round an earlier generation left open is answered `probe-none-open`, never graded). */
export function probeRoundRows(db: DatabaseSync, roundId: string, sessionId: string): ProbeRowsRead {
  try {
    return probeRowsOf(stmt(db, `SELECT ${PROBE_COLUMNS} FROM continuity_probes WHERE roundId = ? AND sessionId = ? AND generationId = `
      + "(SELECT max(id) FROM continuity_generations WHERE sessionId = ? AND state <> 'ended') ORDER BY id")
      .all(roundId, sessionId, sessionId) as Record<string, unknown>[]);
  } catch (e) { return probeReadFailed(e); }
}

/** The card and note GETs' one writer: the session's newest read through `door`, kept as the latest time stamped. */
export function stampContinuityRead(db: DatabaseSync, sessionId: string, door: ContinuityReadDoor, at: number): { ok: boolean } {
  try {
    stmt(db, 'INSERT INTO continuity_reads (sessionId, door, at) VALUES (?, ?, ?) ON CONFLICT (sessionId, door) '
      + 'DO UPDATE SET at = MAX(continuity_reads.at, excluded.at)').run(sessionId, door, at);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** The session's newest card or notes read through the continuity doors, or null when it has made none. */
export function lastContinuityRead(db: DatabaseSync, sessionId: string): { ok: true; at: number | null } | { ok: false; detail: string } {
  try {
    const row = stmt(db, 'SELECT MAX(at) AS at FROM continuity_reads WHERE sessionId = ?').get(sessionId) as { at: unknown } | undefined;
    const at = row === undefined || row.at === null ? null : intOrNull(row.at);
    if (row !== undefined && row.at !== null && at === null) return { ok: false, detail: 'continuity_reads.at is not a number' };
    return { ok: true, at };
  } catch (e) {
    return { ok: false, detail: `continuity_reads read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** A stored snapshot's facts JSON (the card door's `snapshotFactsJson`), or null when no snapshot carries the id. */
export function snapshotFacts(db: DatabaseSync, id: string): { ok: true; facts: string | null } | { ok: false; detail: string } {
  try {
    const row = stmt(db, 'SELECT facts FROM continuity_snapshots WHERE id = ?').get(id) as { facts: unknown } | undefined;
    if (row === undefined) return { ok: true, facts: null };
    return typeof row.facts === 'string' ? { ok: true, facts: row.facts } : { ok: false, detail: `continuity_snapshots row ${id}: facts` };
  } catch (e) {
    return { ok: false, detail: `continuity_snapshots read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── The renewal readings (Overlord W1, plan `w1-renewal-readings.md`, PR A) ──────────────────────────────────────────────

/** The graded closed-book spot probes of one model class, across generations, for the fitted ceiling (C41;
 *  `renewalReadings.ts#fittedCeilingOf`): `kind = 'spot'`, `book = 'closed'`, graded `pass` or `fail`, with a depth. A
 *  question graded `unmeasured` never counts toward the ceiling's window or its rate (review 2183 F6, slug
 *  unmeasured-grades-never-fit-the-ceiling): the door could not grade it as served, which says nothing of the session's
 *  recall. `at` is when the question was asked. One statement, no new index: the table holds one row per question asked. */
export function closedSpotProbes(db: DatabaseSync, modelClass: string): { ok: true; spots: SpotProbe[] } | { ok: false; detail: string } {
  try {
    const rows = stmt(db, "SELECT id, depthTokens, grade, askedAt FROM continuity_probes WHERE kind = 'spot' AND book = 'closed' "
      + "AND grade IN ('pass', 'fail') AND depthTokens IS NOT NULL AND modelClass = ? ORDER BY askedAt, id").all(modelClass) as Record<string, unknown>[];
    const spots: SpotProbe[] = [];
    for (const r of rows) {
      const depthTokens = intOrNull(r.depthTokens); const at = intOrNull(r.askedAt);
      if (depthTokens === null || at === null || (r.grade !== 'pass' && r.grade !== 'fail')) return { ok: false, detail: `continuity_probes row ${String(r.id)}: a spot probe` };
      spots.push({ depthTokens, grade: r.grade, closed: true, modelClass, at });
    }
    return { ok: true, spots };
  } catch (e) { return probeReadFailed(e); }
}

/** The daily backstop's setting (R19), narrowed through `isBackstopHour` and `isBackstopZone`: a row outside them, or no
 *  row, reads `{ ok: false }` with what failed, never a default in its place. */
export function backstopRead(db: DatabaseSync): BackstopRead {
  try {
    const r = stmt(db, 'SELECT hour, zone, isDefault, setAt FROM renewal_backstop_settings WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (r === undefined) return { ok: false, detail: 'renewal_backstop_settings has no row' };
    const setAt = intOrNull(r.setAt);
    if (!isBackstopHour(r.hour)) return { ok: false, detail: `renewal_backstop_settings.hour ${String(r.hour)}` };
    if (!isBackstopZone(r.zone)) return { ok: false, detail: 'renewal_backstop_settings.zone is not a time zone' };
    if (setAt === null || (r.isDefault !== 0 && r.isDefault !== 1)) return { ok: false, detail: 'renewal_backstop_settings row' };
    return { ok: true, backstop: { hour: r.hour, zone: r.zone, isDefault: r.isDefault === 1, setAt } };
  } catch (e) {
    return { ok: false, detail: `renewal_backstop_settings read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The backstop's ONE writer, called only by its door (`POST /api/continuity/renewal-backstop`): the operator's hour and
 *  zone, `isDefault` cleared, in one transaction. The door has validated both; the row exists from the migration. */
export function setBackstop(db: DatabaseSync, b: { hour: number; zone: string; at: number }): { ok: boolean } {
  try {
    return tx(db, () => {
      const r = stmt(db, 'UPDATE renewal_backstop_settings SET hour = ?, zone = ?, isDefault = 0, setAt = ? WHERE id = 1').run(b.hour, b.zone, b.at);
      return { ok: Number(r.changes) === 1 };
    });
  } catch {
    return { ok: false };
  }
}
