// L3 adapter: the start report's table and the generations' (Overlord spec §3.3.11, H12, W1a). `continuity_starts` has one
// writer, `insertStart`, and one read, `startsSince` (the generations lane's); `continuity_generations` and
// `continuity_cursor` are written only through the generation functions below, by the generations lane. `CoordStore` keeps
// one-line delegates of the same names. Nothing here decides: the door (`routes.ts`) validates, the lane's deciders decide,
// and this file records and measures.
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  GENERATION_STATES, HOLD_OFF_MS, STATE_DEADLINE_S, isGenerationOutcome, isGenerationState, isRenewalTrigger, isTriggerClass,
  startSourceOf, type GenerationOutcome, type GenerationState, type RenewalTrigger, type StartRow, type TriggerClass,
} from '../../../shared/continuity.js';
import { isFleetRole, type FleetRole } from '../../../shared/fleetRoles.js';
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
      const next = 'COALESCE((SELECT MAX(served) FROM continuity_snapshots), 0) + 1';
      if (held) stmt(db, `UPDATE continuity_snapshots SET hash = ?, served = ${next} WHERE id = ?`).run(s.hash, s.id);
      else {
        stmt(db, `INSERT INTO continuity_snapshots (id, sessionId, at, facts, hash, served) VALUES (?, ?, ?, ?, ?, ${next})`)
          .run(s.id, s.sessionId, s.at, s.facts, s.hash);
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

/** A generation's card read: the newest full read by the conversation its start reported, with whether its hash is the
 *  session's current card (the hash of the snapshot served last). `read: null` when that conversation has read none. */
export interface CardReadOfStart {
  readonly id: number; readonly hash: string; readonly snapshotId: string; readonly at: number; readonly current: boolean;
}
export type CardReadRead = { ok: true; read: CardReadOfStart | null } | { ok: false; detail: string };

/** The generations lane's read (`card-read` for a generation in `carded`): matched by the start's session and conversation
 *  uuid, so a read made before the lane minted the generation still counts and no cursor can pass over it. */
export function cardReadOfStart(db: DatabaseSync, startId: number): CardReadRead {
  try {
    const row = stmt(db,
      'SELECT r.id AS id, r.hash AS hash, r.snapshotId AS snapshotId, r.at AS at, '
      + '(r.hash = (SELECT c.hash FROM continuity_snapshots c WHERE c.sessionId = r.sessionId ORDER BY c.served DESC LIMIT 1)) AS current '
      + 'FROM continuity_starts s JOIN continuity_card_reads r ON r.sessionId = s.sessionId AND r.uuid = s.uuid '
      + 'WHERE s.id = ? ORDER BY r.id DESC LIMIT 1',
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

/** Declared coordinator intent on one incarnation of a session (the delegation lane's `delegation_sessions` projection,
 *  which the intent door writes through its checkpoint): true when that row carries an `explicitIntentAt`. The card's read
 *  (slug card-intent-reads-the-projection). */
export function coordinatorIntentDeclared(db: DatabaseSync, sessionId: string, incarnation: string):
  { ok: true; declared: boolean } | { ok: false; detail: string } {
  try {
    const row = stmt(db, 'SELECT explicitIntentAt FROM delegation_sessions WHERE sessionId = ? AND parentIncarnation = ?')
      .get(sessionId, incarnation) as { explicitIntentAt: unknown } | undefined;
    return { ok: true, declared: row !== undefined && intOrNull(row.explicitIntentAt) !== null };
  } catch (e) {
    return { ok: false, detail: `delegation_sessions read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
