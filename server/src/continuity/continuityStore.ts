// L3 adapter: the start report's table and the generations' (Overlord spec §3.3.11, H12, W1a), the card's and the notes'
// (§3.3.3, §3.3.2; each its own section below). `continuity_starts` has one writer, `insertStart`, and one read,
// `startsSince` (the generations lane's); `continuity_generations` and `continuity_cursor` are written only through the
// generation functions below, by the generations lane. `CoordStore` keeps one-line delegates of the same names. Nothing
// here decides: the door (`routes.ts`) validates, the lane's deciders decide, and this file records and measures.
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  GENERATION_STATES, HOLD_OFF_MS, STATE_DEADLINE_S, isGenerationOutcome, isGenerationState, isNoteKeyKind, isNoteKind,
  isRenewalTrigger, isTriggerClass, startSourceOf, type GenerationOutcome, type GenerationState, type HandoverNote,
  type HandoverThread, type NoteKey, type NoteKind, type RenewalTrigger, type StartRow, type TriggerClass,
} from '../../../shared/continuity.js';
import { isFleetRole, type FleetRole } from '../../../shared/fleetRoles.js';
import {
  TIMER_STATES, cancelActorOf, isTimerCancelReason, timerMoveAllowed, type TimerActor, type TimerCancelReason, type TimerState,
} from '../../../shared/continuity-timers.js';
import type { Observed } from '../time/observed.js';
import type { GenView } from './generationMachine.js';
import { tx } from '../coord/tx.js';

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
  + 'mintedObservedMs, softRenewalObservedMs, holdOffUntilObservedMs';

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
    blind, model: strOrNull(raw.model), prevModel: strOrNull(raw.prevModel), lane: strOrNull(raw.lane),
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
      const newest = stmt(db, 'SELECT observed, n, model FROM continuity_generations WHERE identity = ? AND term = ? ORDER BY n DESC LIMIT 1')
        .get(input.identity, input.term) as { observed: unknown; n: unknown; model: unknown } | undefined;
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
        + 'deadlineAt, shadowDeadlineAt, proven, resumed, startId, startReportedAt, model, prevModel, lane, host, observed, mintedObservedMs) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(input.identity, input.sessionId, input.role, input.term, input.rowIncarnation, n,
        mode === 'live' ? 'carded' : 'active', mode === 'live' ? null : 'carded', mode, input.now,
        mode === 'live' ? deadline : null, mode === 'live' ? null : deadline,
        input.resumed ? 1 : 0, input.startId, input.startReportedAt, input.model, strOrNull(newest?.model), input.lane, input.host,
        JSON.stringify(observed), carried);
      if (cursor !== null && !advanceCursorIn(db, cursor)) throw new Superseded();
      return { ok: true as const, id: Number(res.lastInsertRowid), n };
    });
  } catch (e) {
    return { ok: false, kind: e instanceof Superseded ? 'superseded' : 'write-failed' };
  }
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

function handoverNoteOf(text: string): HandoverNote | null {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    const strings = (a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === 'string');
    if (!Array.isArray(v.threads) || !strings(v.cautions) || typeof v.tone !== 'string') return null;
    const threads: HandoverThread[] = [];
    for (const t of v.threads as Record<string, unknown>[]) {
      const ref = t?.ref as Record<string, unknown> | undefined;
      if (typeof t?.waitsOn !== 'string' || typeof t.next !== 'string' || ref === undefined || !isNoteKeyKind(ref.kind)) return null;
      const key: NoteKey | null = ref.kind === 'programme' ? (typeof ref.slug === 'string' ? { kind: 'programme', slug: ref.slug } : null)
        : Number.isSafeInteger(ref.id) ? { kind: ref.kind, id: ref.id as number } : null;
      if (key === null) return null;
      threads.push({ ref: key, waitsOn: t.waitsOn, next: t.next });
    }
    return { threads, cautions: v.cautions, tone: v.tone };
  } catch {
    return null;
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
