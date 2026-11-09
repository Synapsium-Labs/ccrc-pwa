// D-8075 (spec 2026-11-04 §11.6, A26, A32, A55): `GET /api/programmes`, one row per programme. A query over the coord db,
// SYNCHRONOUS like `runFind.ts` and through the same structural `RunsDb` port, so this file names no sqlite module. It
// declares no ring: its ring follows its facts.
//
// ONE AGGREGATE STATEMENT gives every run fact: runs grouped by programme, wave, kind, state, claimant and close, with the
// counts, the newest times, the newest id, the open ids and the count closed since `since`. Everything else folds in from
// memory: the wave buckets and the current wave (`shared/programmes.ts`), the ending, and the stuck pass's answers
// (`RunVerdicts`). "Open" comes from runs, never from `programs.state`: abandoning the last open run retires that column
// (`closeRun`'s retirement check), so a leftover review's abandon would otherwise mark a completed programme abandoned (A26).
import type {
  ProgrammeEnding, ProgrammePendingClose, ProgrammeRow, ProgrammesAnswer, ProgrammeWaves, RunClosedBy, StuckReason,
} from '../../../shared/api.js';
import { WAVE_BUCKET, programmeCurrentWave, type WaveBucket, type WaveFact } from '../../../shared/programmes.js';
import type { RunsDb } from './runsPage.js';
import type { RunLastMovesRead } from './runWire.js';
import type { RunVerdicts } from './runVerdicts.js';
import { PROGRAMME_GONE_KEEP_MS } from './runStuckPass.js';

/** `since` reaches back no further than this: "today" is the operator's local day and no day is longer (A32). */
export const PROGRAMMES_SINCE_MAX_MS = 48 * 3_600_000;
/** A programme with no open run stays listed this long after its last close: A55's window, the one the stuck pass measures
 *  a closed programme's claimant for (`PROGRAMME_GONE_KEEP_MS`), so a row and its `coordinatorGone` end together. */
export const PROGRAMMES_FINISHED_WINDOW_MS = PROGRAMME_GONE_KEEP_MS;

const CLOSED_BY: readonly string[] = ['coordinator', 'operator', 'sweep'];
const NEVER_STARTED_DETAIL = 'abandon:never-started';

interface GroupRow {
  program: string; title: string; wave: number; kind: string; state: string; claimedBy: string | null;
  closedBy: string | null; closeDetail: string | null; n: number; maxId: number; waveOf: number | null;
  lastClosed: number | null; lastOpened: number; lastDispatched: number | null; closedSince: number; openIds: string | null;
}

export interface ProgrammesDeps {
  readonly terminalStatesSql: string;
  readonly verdicts: RunVerdicts;
  readonly runLastMoves: (runIds: readonly number[]) => RunLastMovesRead;
}

/** The operator's `since`, held to `[now - 48 h, now]`. PURE. */
export const clampProgrammesSince = (since: number, now: number): number =>
  Math.min(now, Math.max(now - PROGRAMMES_SINCE_MAX_MS, since));

export function readProgrammes(db: RunsDb, opts: { since: number; now: number }, deps: ProgrammesDeps): ProgrammesAnswer {
  const since = clampProgrammesSince(opts.since, opts.now);
  const terminal = deps.terminalStatesSql;
  const groups = db.prepare(
    'SELECT r.program AS program, p.title AS title, r.wave AS wave, r.kind AS kind, r.state AS state, ' +
    'r.claimedBy AS claimedBy, r.closedBy AS closedBy, r.closeDetail AS closeDetail, COUNT(*) AS n, MAX(r.id) AS maxId, ' +
    'MAX(r.waveOf) AS waveOf, MAX(r.closedAt) AS lastClosed, MAX(r.openedAt) AS lastOpened, ' +
    'MAX(r.dispatchedAt) AS lastDispatched, ' +
    'SUM(CASE WHEN r.closedAt IS NOT NULL AND r.closedAt >= ? THEN 1 ELSE 0 END) AS closedSince, ' +
    `group_concat(CASE WHEN r.state NOT IN ${terminal} THEN r.id END) AS openIds ` +
    'FROM runs r JOIN programs p ON p.slug = r.program ' +
    'GROUP BY r.program, r.wave, r.kind, r.state, r.claimedBy, r.closedBy, r.closeDetail ' +
    'ORDER BY r.program',
  ).all(since) as unknown as GroupRow[];

  const closedToday = { operator: 0, sweep: 0, coordinator: 0 };
  const byProgramme = new Map<string, GroupRow[]>();
  for (const g of groups) {
    if (g.closedSince > 0 && g.closedBy !== null && CLOSED_BY.includes(g.closedBy)) closedToday[g.closedBy as RunClosedBy] += g.closedSince;
    const list = byProgramme.get(g.program);
    if (list === undefined) byProgramme.set(g.program, [g]);
    else list.push(g);
  }

  const openIdsOf = (gs: readonly GroupRow[]): number[] =>
    gs.flatMap((g) => (g.openIds === null ? [] : g.openIds.split(',').map(Number)));
  const live = [...byProgramme.values()].filter((gs) => openIdsOf(gs).length > 0 ||
    Math.max(...gs.map((g) => g.lastClosed ?? 0)) >= opts.now - PROGRAMMES_FINISHED_WINDOW_MS);

  const allOpen = live.flatMap(openIdsOf);
  const moves = allOpen.length === 0 ? null : deps.runLastMoves(allOpen);
  const moveOf = (id: number): number | null => (moves !== null && moves.ok ? moves.moves.get(id) ?? null : null);
  const all = deps.verdicts.all();

  const programmes: ProgrammeRow[] = live.map((gs) => {
    const openIds = openIdsOf(gs);
    const first = gs[0]!;
    return {
      slug: first.program,
      title: first.title,
      ...currentWaveOf(gs),
      claimedBy: claimantOf(gs),
      ...goneOf(first.program, openIds, deps.verdicts),
      waves: wavesOf(gs).counts,
      ...stuckOf(openIds, all),
      lastMoveAt: lastMoveOf(gs, openIds, moveOf),
      ending: openIds.length > 0 ? null : endingOf(gs),
    };
  });
  return { ok: true, programmes, closedToday };
}

/** Each work wave's bucket: its newest open work run, else its newest work run. */
function wavesOf(gs: readonly GroupRow[]): { counts: ProgrammeWaves; facts: WaveFact[] } {
  const byWave = new Map<number, GroupRow>();
  for (const g of gs) {
    if (g.kind !== 'work') continue;
    const cur = byWave.get(g.wave);
    const open = g.openIds !== null;
    const curOpen = cur !== undefined && cur.openIds !== null;
    if (cur === undefined || (open && !curOpen) || (open === curOpen && g.maxId > cur.maxId)) byWave.set(g.wave, g);
  }
  const counts: ProgrammeWaves = { working: 0, waiting: 0, queued: 0, done: 0, failed: 0 };
  const facts: WaveFact[] = [];
  for (const [wave, g] of byWave) {
    const bucket: WaveBucket = WAVE_BUCKET[g.state as keyof typeof WAVE_BUCKET] ?? 'working';
    counts[bucket] += 1;
    const waveOf = gs.filter((x) => x.kind === 'work' && x.wave === wave).reduce<number | null>(
      (m, x) => (x.waveOf === null ? m : m === null ? x.waveOf : Math.max(m, x.waveOf)), null);
    facts.push({ wave, waveOf, bucket });
  }
  return { counts, facts };
}

function currentWaveOf(gs: readonly GroupRow[]): { currentWave: number | null; waveOf: number | null } {
  const cur = programmeCurrentWave(wavesOf(gs).facts);
  return { currentWave: cur === null ? null : cur.wave, waveOf: cur === null ? null : cur.waveOf };
}

/** The newest open run's claimant, else the newest run's. */
function claimantOf(gs: readonly GroupRow[]): string | null {
  let best: GroupRow | null = null;
  for (const g of gs) {
    if (best === null) { best = g; continue; }
    const open = g.openIds !== null, bestOpen = best.openIds !== null;
    if ((open && !bestOpen) || (open === bestOpen && g.maxId > best.maxId)) best = g;
  }
  return best === null ? null : best.claimedBy;
}

/** `coordinatorGone` from the programme's open runs, else its own entry (A55). Absent when the reader holds neither (A60). */
function goneOf(slug: string, openIds: readonly number[], verdicts: RunVerdicts): { coordinatorGone?: boolean } {
  const read = openIds.flatMap((id) => { const v = verdicts.of(id); return v === null ? [] : [v.coordinatorGone]; });
  if (read.length > 0) return { coordinatorGone: read.some(Boolean) };
  const own = verdicts.ofProgramme(slug);
  return own === null ? {} : { coordinatorGone: own };
}

/** `stuck` and `pendingClose` from the pass's answers; absent while the reader is empty and the programme has open runs. */
function stuckOf(
  openIds: readonly number[], all: ReturnType<RunVerdicts['all']>,
): { stuck?: number; pendingClose?: ProgrammePendingClose[] } {
  if (all.size === 0 && openIds.length > 0) return {};
  const reasons = new Map<StuckReason, { at: number; armed: boolean }[]>();
  let stuck = 0;
  for (const id of openIds) {
    const s = all.get(id)?.stuck ?? null;
    if (s === null) continue;
    stuck += 1;
    if (s.closes === null) continue;
    const list = reasons.get(s.reason);
    if (list === undefined) reasons.set(s.reason, [s.closes]);
    else list.push(s.closes);
  }
  const pendingClose: ProgrammePendingClose[] = [];
  for (const [reason, clocks] of reasons) {
    // Armed and shadow runs mix: the armed ones are counted and the shadow ones are not (A37).
    const armed = clocks.some((c) => c.armed);
    const counted = clocks.filter((c) => c.armed === armed);
    pendingClose.push({ reason, count: counted.length, soonestAt: Math.min(...counted.map((c) => c.at)), armed });
  }
  return { stuck, pendingClose };
}

function lastMoveOf(gs: readonly GroupRow[], openIds: readonly number[], moveOf: (id: number) => number | null): number | null {
  let best: number | null = null;
  const take = (v: number | null): void => { if (v !== null && (best === null || v > best)) best = v; };
  for (const g of gs) { take(g.lastClosed); take(g.lastDispatched); take(g.lastOpened); }
  for (const id of openIds) take(moveOf(id));
  return best;
}

/** How a programme with no open run ended, from its WORK runs alone (A26). Null with no work run. The ending is judged from each
 *  wave's newest work run, the pick `wavesOf` makes: a wave whose first attempt failed and whose retry finished is done, and a
 *  superseded attempt gives neither `neverStarted` nor `closedBy`. */
function endingOf(gs: readonly GroupRow[]): ProgrammeEnding | null {
  const work = gs.filter((g) => g.kind === 'work');
  if (work.length === 0) return null;
  const newestOf = new Map<number, GroupRow>();
  for (const g of work) {
    const cur = newestOf.get(g.wave);
    if (cur === undefined || g.maxId > cur.maxId) newestOf.set(g.wave, g);
  }
  const waves = newestOf.size;
  const failed = [...newestOf.values()].filter((g) => g.state === 'failed');
  if (failed.length === 0) return { outcome: 'complete', waves, neverStarted: 0, closedBy: null };
  const neverStarted = failed.filter((g) => g.closeDetail === NEVER_STARTED_DETAIL).length;
  const newest = failed.reduce((a, b) => ((b.lastClosed ?? 0) > (a.lastClosed ?? 0) ? b : a));
  const closedBy = newest.closedBy !== null && CLOSED_BY.includes(newest.closedBy) ? (newest.closedBy as RunClosedBy) : null;
  return { outcome: 'ended', waves, neverStarted, closedBy };
}
