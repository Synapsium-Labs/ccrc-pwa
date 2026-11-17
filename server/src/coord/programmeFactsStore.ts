// What a programme says is left: the SQL (Overlord W2 remaining work A, plan `w2-remaining-work.md` Task 2; spec §5.6
// H38, Table 11.1a). `programme_remaining` and `programme_edges` (one migration). It sits beside `store.ts` in the same
// ring and context (L3, Coordination), as `coordCallsStore.ts` does: every function takes the store's `DatabaseSync` and
// is synchronous, and `CoordStore` keeps one-line delegates of the same names.
//
// One writer per fact, and nothing else writes either table:
//   * `insertRemaining`  the only INSERT into `programme_remaining` (append-only: no UPDATE or DELETE names it) and the
//                        only INSERT into `programme_edges`, both in the statement's one transaction;
//   * the edge's state columns (`state`, `endedAt`, `evidence`, `unmeasuredSince`) are remaining work B's `settleEdge`'s,
//     called only by the forecast lane's edge arm. No coordinator path clears an edge.
// The body's rules and the target verdict are `programmeRemaining.ts`'s (L1); this file reads and writes.
//
// Sealed forecasts (Overlord W2 forecasts A, plan `w2-forecasts-health.md` Task 3): `programme_forecasts`, two writers,
// each called only by its arm of the forecast lane (`forecastLane.ts`):
//   * `sealForecast`   the only INSERT, `ON CONFLICT DO NOTHING`, so a second seal for one close is a no-op by the store;
//   * `scoreForecast`  writes `outcome` and `scoredAt` only, and only on an `open` row.
// The lead history, the seal's pairing and the outcome are `forecast.ts`'s (L1); the reads here hand it rows.
import type { DatabaseSync } from 'node:sqlite';
import {
  EDGE_KINDS, EDGE_STATES, OPEN_EDGES_PER_PROGRAMME_MAX, SEAL_LOOKBACK_DAYS, SEAL_WAIT_MINUTES, edgeTargetKey, isForecastKind,
  isForecastSource, isSealOutcome, isUnforecastableReason, parseEdgeTarget,
  type EdgeKind, type EdgeState, type EdgeTarget, type Forecast, type ProgrammeEdge, type RemainingRefusal, type RemainingStatement,
  type SealedForecast,
} from '../../../shared/programmeFacts.js';
import { redactCommand } from './redact.js';
import { waveRepresentative } from '../../../shared/programmes.js';
import {
  leadHistoryFrom, type ForecastHistory, type LeadRun, type OutcomeFacts, type UnsealedClose,
} from './forecast.js';
import { edgeTargetVerdict, type EdgeTargetFacts, type NewEdge, type NewRemaining } from './programmeRemaining.js';
import { tx } from './tx.js';

/** The types `CoordStore`'s delegates name, so `store.ts` takes one import for this file. */
export type { EdgeTarget, ProgrammeEdge, RemainingStatement, SealedForecast } from '../../../shared/programmeFacts.js';
export type { NewEdge, NewRemaining } from './programmeRemaining.js';
export type { ForecastHistory, OutcomeFacts, UnsealedClose } from './forecast.js';

export type InsertRemainingResult =
  | { ok: true; id: number; added: number[]; kept: number[] }
  | { ok: false; why: RemainingRefusal; detail: string };

/** Records one statement and its edges in ONE transaction. An edge already open with the same kind and target is kept,
 *  never duplicated (its id goes to `kept`); a new one is inserted (`added`). A statement that would take the programme
 *  past `OPEN_EDGES_PER_PROGRAMME_MAX` open edges writes nothing. THE ONLY INSERT into either table; it never updates a
 *  statement and never changes an edge's state. A throw (an unknown `program`, a busy file) rolls the whole statement
 *  back. */
export function insertRemaining(
  db: DatabaseSync, program: string, byId: string, statement: NewRemaining, edges: readonly NewEdge[], build: string | null, now: number,
): InsertRemainingResult {
  return tx(db, (): InsertRemainingResult => {
    const openId = db.prepare("SELECT id FROM programme_edges WHERE program = ? AND kind = ? AND target = ? AND state = 'open'");
    const keyed = edges.map((e) => ({ e, target: edgeTargetKey(e.target) }));
    const existing = keyed.map(({ e, target }) => (openId.get(program, e.kind, target) as { id: number } | undefined)?.id ?? null);
    const open = (db.prepare("SELECT COUNT(*) AS n FROM programme_edges WHERE program = ? AND state = 'open'").get(program) as { n: number }).n;
    const adding = existing.filter((id) => id === null).length;
    if (open + adding > OPEN_EDGES_PER_PROGRAMME_MAX) {
      return { ok: false, why: 'too-many-open-edges',
        detail: `programme ${program} would hold ${open + adding} open edges, more than ${OPEN_EDGES_PER_PROGRAMME_MAX}` };
    }
    const r = db.prepare(
      'INSERT INTO programme_remaining (program, at, byId, runId, lo, hi, reason, build) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(program, now, byId, statement.runId, statement.lo, statement.hi, statement.reason, build);
    const id = Number(r.lastInsertRowid);
    const insertEdge = db.prepare(
      'INSERT INTO programme_edges (program, statementId, kind, target, why, openedAt) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const added: number[] = [];
    const kept: number[] = [];
    keyed.forEach(({ e, target }, i) => {
      const was = existing[i]!;
      if (was !== null) { kept.push(was); return; }
      added.push(Number(insertEdge.run(program, id, e.kind, target, e.why, now).lastInsertRowid));
    });
    return { ok: true, id, added, kept };
  });
}

/** The facts a target's verdict reads (`programmeRemaining.ts#edgeTargetVerdict`). A run's `prLineage` is written by
 *  `foldPrLineage` alone, from a typed list, so one that does not parse as a list of entries is a corrupt file and
 *  throws, naming the run, rather than reading as a lineage that lists nothing. */
export function edgeTargetFacts(db: DatabaseSync, target: EdgeTarget): EdgeTargetFacts {
  if (target.predicate === 'operator-confirms') {
    const it = db.prepare('SELECT program, state FROM operator_items WHERE id = ?').get(target.itemId) as
      { program: string; state: string } | undefined;
    return { predicate: target.predicate, item: it ?? null };
  }
  const run = db.prepare('SELECT program, prLineage FROM runs WHERE id = ?').get(target.runId) as
    { program: string; prLineage: string | null } | undefined;
  if (run === undefined) return { predicate: target.predicate, run: null };
  if (target.predicate === 'run-closed') return { predicate: target.predicate, run: { program: run.program, prs: [] } };
  const v: unknown = run.prLineage === null || run.prLineage === '' ? [] : JSON.parse(run.prLineage);
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'object' && x !== null && typeof (x as { pr?: unknown }).pr === 'number')) {
    throw new Error(`run ${target.runId}: prLineage is not a list of pull request entries`);
  }
  return { predicate: target.predicate, run: { program: run.program, prs: (v as { pr: number }[]).map((x) => x.pr) } };
}

/** The door's step 9: `ok`, or why the target is refused. It reads (`edgeTargetFacts`) and asks the verdict; it writes
 *  nothing. A throw is the store's (an unreadable lineage). */
export function edgeTargetCheck(db: DatabaseSync, slug: string, target: EdgeTarget): { ok: true } | { ok: false; detail: string } {
  return edgeTargetVerdict(slug, target, edgeTargetFacts(db, target));
}

/** Every text is masked again as it is read, so a text stored under an older mask is served through today's. */
const mask = (t: string): string => redactCommand(t);

interface RemainingRaw { id: number; program: string; at: number; byId: string; runId: number | null; lo: number; hi: number; reason: string }

/** The programme's newest statements, newest first, at most `limit`. */
export function remainingOf(db: DatabaseSync, program: string, limit: number): RemainingStatement[] {
  return (db.prepare(
    'SELECT id, program, at, byId, runId, lo, hi, reason FROM programme_remaining WHERE program = ? ORDER BY id DESC LIMIT ?',
  ).all(program, limit) as unknown as RemainingRaw[]).map((r) => ({ ...r, reason: mask(r.reason) }));
}

interface EdgeRaw {
  id: number; program: string; kind: string; target: string; why: string; state: string; openedAt: number; openedBy: string;
  endedAt: number | null; evidence: string | null; unmeasuredSince: number | null;
}

/** One stored edge, read through its guards. An unknown `kind` or a `target` this build cannot read is carried as null with
 *  its flag, never dropped; an unknown `state` reads as `open` with `stateUnreadable`, so a block this build does not know
 *  is never hidden. `unmeasured` is set while the edge arm's run of unmeasured answers stands (remaining work B). */
function edgeOf(r: EdgeRaw): ProgrammeEdge {
  const kind = (EDGE_KINDS as readonly string[]).includes(r.kind) ? (r.kind as EdgeKind) : null;
  const target = parseEdgeTarget(r.target);
  const known = (EDGE_STATES as readonly string[]).includes(r.state);
  const state: EdgeState = known ? (r.state as EdgeState) : 'open';
  const edge: ProgrammeEdge = {
    id: r.id, program: r.program, kind, target, why: mask(r.why), state, openedAt: r.openedAt, openedBy: r.openedBy,
    endedAt: r.endedAt, evidence: r.evidence === null ? null : mask(r.evidence), unmeasuredSince: r.unmeasuredSince,
  };
  if (kind === null) edge.kindUnreadable = true;
  if (target === null) edge.targetUnreadable = true;
  if (!known) edge.stateUnreadable = true;
  if (state === 'open' && r.unmeasuredSince !== null) edge.unmeasured = true;
  return edge;
}

/** Every edge whose state is not `met`, for the listed programmes, oldest first. `openedBy` is the statement's sender. */
export function openEdgesOf(db: DatabaseSync, programs: readonly string[]): ProgrammeEdge[] {
  if (programs.length === 0) return [];
  const marks = programs.map(() => '?').join(', ');
  return (db.prepare(
    'SELECT e.id, e.program, e.kind, e.target, e.why, e.state, e.openedAt, s.byId AS openedBy, e.endedAt, e.evidence, ' +
    `e.unmeasuredSince FROM programme_edges e JOIN programme_remaining s ON s.id = e.statementId WHERE e.program IN (${marks}) ` +
    "AND e.state <> 'met' ORDER BY e.id",
  ).all(...programs) as unknown as EdgeRaw[]).map(edgeOf);
}

// ── Sealed forecasts (forecasts A) ──────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 3_600_000;
const MINUTE_MS = 60_000;
/** The seal arm's look-back: its own fact, which only shares the number with other seven-day spans (`token-shared.test.ts`
 *  names it in a row of its own). */
const SEAL_LOOKBACK_MS = SEAL_LOOKBACK_DAYS * DAY_MS;

/** What the seal arm writes: the close, its boundary, the statement it used, and the decider's answer. */
export interface NewSeal {
  readonly program: string; readonly closingRunId: number; readonly asOf: number;
  readonly statementId: number | null; readonly lo: number | null; readonly hi: number | null; readonly forecast: Forecast;
}

/** THE ONLY INSERT into `programme_forecasts`. One seal per closing run: a second is a no-op (`ON CONFLICT DO NOTHING`),
 *  answered `written: false`. */
export function sealForecast(db: DatabaseSync, seal: NewSeal, now: number): { written: boolean } {
  const f = seal.forecast;
  const dated = f.kind === 'forecast' ? f : null;
  const r = db.prepare(
    'INSERT INTO programme_forecasts (program, closingRunId, sealedAt, asOf, statementId, lo, hi, kind, reason, source, n, seed, ' +
    'medianAt, p85At) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(closingRunId) DO NOTHING',
  ).run(seal.program, seal.closingRunId, now, seal.asOf, seal.statementId, seal.lo, seal.hi, f.kind,
    f.kind === 'unforecastable' ? f.reason : null, dated?.source ?? null, dated?.n ?? null, dated?.seed ?? null,
    dated?.medianAt ?? null, dated?.p85At ?? null);
  return { written: Number(r.changes) === 1 };
}

/** Writes a seal's outcome: `outcome` and `scoredAt` only, and only while the row is `open`. `written: false` when the
 *  row is gone or already scored. */
export function scoreForecast(db: DatabaseSync, id: number, outcome: 'met' | 'missed', now: number): { written: boolean } {
  const r = db.prepare("UPDATE programme_forecasts SET outcome = ?, scoredAt = ? WHERE id = ? AND outcome = 'open'").run(outcome, now, id);
  return { written: Number(r.changes) === 1 };
}

interface SealRaw {
  id: number; program: string; closingRunId: number; sealedAt: number; asOf: number; statementId: number | null;
  lo: number | null; hi: number | null; kind: string; reason: string | null; source: string | null; n: number | null;
  seed: number | null; medianAt: number | null; p85At: number | null; outcome: string; scoredAt: number | null;
}

/** A stored forecast read back: a word this build cannot read, or a dated row missing a figure, is `unreadable`, carried
 *  and never scored, never a forecast with a made-up date. */
function forecastOf(r: SealRaw): Forecast | 'unreadable' {
  if (!isForecastKind(r.kind)) return 'unreadable';
  if (r.kind === 'unforecastable') return isUnforecastableReason(r.reason) ? { kind: 'unforecastable', reason: r.reason } : 'unreadable';
  if (!isForecastSource(r.source) || r.n === null || r.seed === null || r.medianAt === null || r.p85At === null) return 'unreadable';
  return { kind: 'forecast', medianAt: r.medianAt, p85At: r.p85At, n: r.n, source: r.source, seed: r.seed };
}
const sealOf = (r: SealRaw): SealedForecast => ({
  id: r.id, program: r.program, closingRunId: r.closingRunId, sealedAt: r.sealedAt, asOf: r.asOf, statementId: r.statementId,
  lo: r.lo, hi: r.hi, forecast: forecastOf(r), outcome: isSealOutcome(r.outcome) ? r.outcome : 'unreadable', scoredAt: r.scoredAt,
});

const SEAL_COLUMNS = 'id, program, closingRunId, sealedAt, asOf, statementId, lo, hi, kind, reason, source, n, seed, medianAt, ' +
  'p85At, outcome, scoredAt';

/** Seals, oldest first: one programme's (`{ program }`), or every `open` seal whose 85% date is at or before `dueBy` (the
 *  score arm's read). */
export function forecastsOf(db: DatabaseSync, q: { program: string } | { dueBy: number }): SealedForecast[] {
  const rows = 'program' in q
    ? db.prepare(`SELECT ${SEAL_COLUMNS} FROM programme_forecasts WHERE program = ? ORDER BY id`).all(q.program)
    : db.prepare(`SELECT ${SEAL_COLUMNS} FROM programme_forecasts WHERE outcome = 'open' AND p85At IS NOT NULL AND p85At <= ? ORDER BY id`).all(q.dueBy);
  return (rows as unknown as SealRaw[]).map(sealOf);
}

/** The seal arm's read: every work run closed in the last `SEAL_LOOKBACK_DAYS` with no seal, oldest close first, each
 *  paired with the newest statement naming it, else the newest of its programme standing `SEAL_WAIT_MINUTES` after the
 *  close. `missed` counts the work runs closed before the window, after the first sealed close, that have no seal: a gap
 *  the lane was down for, which is never sealed. `terminal` is the store's one SQL spelling of `TERMINAL_RUN_STATES`. */
export function unsealedClosesOf(db: DatabaseSync, now: number, terminal: string): { closes: UnsealedClose[]; missed: number } {
  const from = now - SEAL_LOOKBACK_MS;
  const rows = db.prepare(
    "SELECT r.id AS runId, r.program AS program, r.closedAt AS closedAt FROM runs r WHERE r.kind = 'work' " +
    `AND r.state IN ${terminal} AND r.closedAt IS NOT NULL AND r.closedAt >= ? AND r.program IS NOT NULL ` +
    'AND NOT EXISTS (SELECT 1 FROM programme_forecasts f WHERE f.closingRunId = r.id) ORDER BY r.closedAt, r.id',
  ).all(from) as unknown as { runId: number; program: string; closedAt: number }[];
  const named = db.prepare('SELECT id, at, lo, hi FROM programme_remaining WHERE runId = ? AND program = ? ORDER BY id DESC LIMIT 1');
  const standing = db.prepare('SELECT id, at, lo, hi FROM programme_remaining WHERE program = ? AND at <= ? ORDER BY id DESC LIMIT 1');
  type S = { id: number; at: number; lo: number; hi: number };
  const closes = rows.map((r): UnsealedClose => {
    const n = named.get(r.runId, r.program) as S | undefined;
    if (n !== undefined) return { ...r, statement: n, named: true };
    const st = standing.get(r.program, r.closedAt + SEAL_WAIT_MINUTES * MINUTE_MS) as S | undefined;
    return { ...r, statement: st ?? null, named: false };
  });
  const missed = (db.prepare(
    `SELECT COUNT(*) AS n FROM runs r WHERE r.kind = 'work' AND r.state IN ${terminal} AND r.closedAt < ? ` +
    'AND r.closedAt > (SELECT MIN(c.closedAt) FROM programme_forecasts f JOIN runs c ON c.id = f.closingRunId) ' +
    'AND NOT EXISTS (SELECT 1 FROM programme_forecasts f WHERE f.closingRunId = r.id)',
  ).get(from) as { n: number }).n;
  return { closes, missed };
}

const LEAD_COLUMNS = 'id, program, wave, kind, state, openedAt, dispatchedAt, closedAt, closeDetail, claimedBy';

/** The programme's and the fleet's lead history as of `asOf`, from `runs` alone (`forecast.ts#leadHistoryFrom`). */
export function leadHistoryOf(db: DatabaseSync, program: string, asOf: number): ForecastHistory {
  const runs = db.prepare(
    `SELECT ${LEAD_COLUMNS} FROM runs WHERE program IS NOT NULL AND kind = 'work' AND openedAt <= ? ORDER BY id`,
  ).all(asOf) as unknown as LeadRun[];
  return leadHistoryFrom(runs, program, asOf);
}

/** What `forecastOutcome` reads for one seal, from `runs` alone, never a statement: the close of each work wave whose
 *  representative (the wave rule) closed `done` after the seal's `asOf`, and every run of the programme still open or
 *  closed after `asOf`. Null for a seal id with no row. */
export function outcomeFactsOf(db: DatabaseSync, sealId: number): OutcomeFacts | null {
  const seal = db.prepare('SELECT program, asOf FROM programme_forecasts WHERE id = ?').get(sealId) as { program: string; asOf: number } | undefined;
  if (seal === undefined) return null;
  const work = db.prepare(
    "SELECT id, wave, state, closedAt FROM runs WHERE program = ? AND kind = 'work' ORDER BY id",
  ).all(seal.program) as unknown as { id: number; wave: number; state: string; closedAt: number | null }[];
  const byWave = new Map<number, typeof work>();
  for (const r of work) { const l = byWave.get(r.wave) ?? []; l.push(r); byWave.set(r.wave, l); }
  const doneWaveCloses: number[] = [];
  for (const list of byWave.values()) {
    const rep = waveRepresentative(list.map((r) => ({ id: r.id, open: r.closedAt === null, r })))!.r;
    if (rep.state === 'done' && rep.closedAt !== null && rep.closedAt > seal.asOf) doneWaveCloses.push(rep.closedAt);
  }
  const runs = db.prepare(
    'SELECT openedAt, closedAt, state FROM runs WHERE program = ? AND (closedAt IS NULL OR closedAt > ?) ORDER BY id',
  ).all(seal.program, seal.asOf) as unknown as { openedAt: number; closedAt: number | null; state: string }[];
  return { doneWaveCloses: doneWaveCloses.sort((a, b) => a - b), runs };
}
