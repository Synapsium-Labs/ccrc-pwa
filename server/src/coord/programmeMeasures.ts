// Overlord W2, forecasts B (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md, Task 6). Ring: L1,
// context Coordination (C5). PURE: no `fs`, no store, no clock; `now` and every range are the caller's. It imports `shared/`
// and `../perf/stats.ts` (K) only.
//
// The programme measures the portfolio (`portfolio.ts`) and the health decider (`programmeHealth.ts`) share: the wave rule
// moved here from `portfolio.ts` unchanged (`wavesOf`, `Wave`, `isOpenRun`, `bucketOf`), `closedIn`, and `waveSpend`. This
// file imports neither of them, so there is no cycle.
import { TERMINAL_RUN_STATES, isRunState } from '../../../shared/api.js';
import type { PortfolioRun } from '../../../shared/portfolio.js';
import { SPEND_READ_GRACE_MINUTES, type RunSpendRow, type RunSpendState, type SpendReading } from '../../../shared/programmeFacts.js';
import { WAVE_BUCKET, countsAsWave, waveRepresentative, type WaveBucket } from '../../../shared/programmes.js';
import { percentile } from '../perf/stats.js';

const TERMINAL: readonly string[] = TERMINAL_RUN_STATES;
export const isOpenRun = (r: PortfolioRun): boolean => !TERMINAL.includes(r.state);
/** A state outside `RUN_STATES` buckets as `working`, as `WAVE_BUCKET`'s other readers do. */
export const bucketOf = (state: string): WaveBucket => (isRunState(state) ? WAVE_BUCKET[state] : 'working');

export interface Wave { wave: number; rep: PortfolioRun; runs: PortfolioRun[]; bucket: WaveBucket }

/** The programme's waves: its work runs grouped by `wave`, each standing as `waveRepresentative`'s run, bucketed through
 *  `WAVE_BUCKET`, exactly as `GET /api/programmes` buckets it. */
export function wavesOf(runs: readonly PortfolioRun[]): Wave[] {
  const byWave = new Map<number, PortfolioRun[]>();
  for (const r of runs) {
    if (!countsAsWave(r.kind)) continue;
    const list = byWave.get(r.wave) ?? [];
    list.push(r);
    byWave.set(r.wave, list);
  }
  return [...byWave].map(([wave, list]) => {
    const rep = waveRepresentative(list.map((r) => ({ id: r.id, open: isOpenRun(r), r })))!.r;
    return { wave, rep, runs: list, bucket: bucketOf(rep.state) };
  });
}

export const earliestDispatch = (w: Wave): number | null =>
  w.runs.reduce<number | null>((m, r) => (r.dispatchedAt === null ? m : m === null ? r.dispatchedAt : Math.min(m, r.dispatchedAt)), null);
/** A wave a rebuild stood in for: its `dispatchedAt` is the rebuild's time, never measured from (review 2130 F10). */
export const rebuiltWave = (w: Wave): boolean => w.runs.some((r) => r.rebuilt === true);

/** Done waves' cycle times, first dispatch to close (moved from `portfolio.ts`' entry, unchanged): a wave with no dispatch,
 *  no close, or a rebuilt run is counted in `unmeasured`, never a sample. The portfolio's cycle and the health decider's
 *  fleet reference read this one rule. */
export function doneCycles(done: readonly Wave[]): { cycles: number[]; unmeasured: number } {
  const cycles: number[] = [];
  let unmeasured = 0;
  for (const w of done) {
    const d = earliestDispatch(w);
    if (d === null || w.rep.closedAt === null || rebuiltWave(w)) unmeasured += 1;
    else cycles.push(Math.max(0, w.rep.closedAt - d));   // F10: never negative under clock skew
  }
  return { cycles, unmeasured };
}

/** The wave's representative closed `done` or `failed` at a time in `[from, to]`, edges included. */
export function closedIn(w: Wave, from: number, to: number): boolean {
  const at = w.rep.closedAt;
  return (w.bucket === 'done' || w.bucket === 'failed') && at !== null && at >= from && at <= to;
}

/** The median spend per work wave closed in `[from, to]`. A wave's spend is the sum of `cost` over its work runs and over
 *  the review runs whose `reviews` names one of them. A wave any of whose runs has no row, a row not `measured`, or a
 *  measured row with a null cost is left out and counted in `unmeasured`, never read as 0; the median is over the measured
 *  waves, and null when there are none. */
export function waveSpend(
  waves: readonly Wave[], runs: readonly PortfolioRun[], spend: ReadonlyMap<number, RunSpendRow>, from: number, to: number,
): { medianPerWave: number | null; measured: number; unmeasured: number } {
  const totals: number[] = [];
  let unmeasured = 0;
  for (const w of waves) {
    if (!closedIn(w, from, to)) continue;
    const ids = new Set(w.runs.map((r) => r.id));
    const own = [...w.runs, ...runs.filter((r) => r.kind === 'review' && r.reviews !== null && ids.has(r.reviews))];
    let total = 0;
    let known = true;
    for (const r of own) {
      const row = spend.get(r.id);
      if (row === undefined || row.state !== 'measured' || row.cost === null) { known = false; break; }
      total += row.cost;
    }
    if (known) totals.push(total); else unmeasured += 1;
  }
  return { medianPerWave: totals.length === 0 ? null : percentile(totals, 50), measured: totals.length, unmeasured };
}

// ── What a closed run cost (forecasts B, Task 7; question 10, ruled) ─────────────────────────────────────────────────

/** The run a spend verdict judges: a closed run, or an open one judged as of now (`closedAt` = now, fix round 1, F1).
 *  `redispatched`: a later run names the same session with a later `dispatchedAt`. `resumed` and `clearedAt`: whether the
 *  dispatch resumed an existing session, and when its `/clear` committed (null: refused or never typed). `conversation`:
 *  the registry's conversation id recorded at dispatch, after the `/clear` (F3); null when it was not measured. */
export interface SpendRun {
  readonly sessionId: string | null; readonly dispatchedAt: number | null; readonly closedAt: number; readonly redispatched: boolean;
  readonly resumed: boolean; readonly clearedAt: number | null; readonly conversation: string | null;
}
export type { SpendReading } from '../../../shared/programmeFacts.js';

const GRACE_MS = SPEND_READ_GRACE_MINUTES * 60_000;

/** What one run cost, first match: `absent` with no session, no reading, or a reading with no cost figure; `measured` only
 *  when every test holds, else `outside`:
 *  - the window: the reading lies in `[dispatchedAt, closedAt + SPEND_READ_GRACE_MINUTES]`;
 *  - freshness (F2, ruled): no main-thread turn of the session started after the reading was rendered, and its newest
 *    Stop left no background work live (F2-b, ruled: an agent, workflow or shell running past the render spends unseen,
 *    and a Stop cannot say when that work ended, so any live count, or one it could not count, fails it); a marker that
 *    could not vouch fails it;
 *  - the session was not dispatched to a later run since;
 *  - the conversation (F3, ruled; `clear-restarts-cost-by-session-id`): the reading was taken in the registry's current
 *    conversation AND in the one the run was dispatched into, so a mid-run `/clear` (a partial cost) reads outside;
 *  - the `/clear` (F10'): a resumed run whose `/clear` was refused still runs in the previous wave's conversation.
 *  Cost is kept on `measured` alone; the reading's class and time are kept as evidence. */
export function runSpendVerdict(
  run: SpendRun, reading: SpendReading | null,
): { state: RunSpendState; cost: number | null; class: string | null; readAt: number | null } {
  if (run.sessionId === null || reading === null) return { state: 'absent', cost: null, class: null, readAt: null };
  const evidence = { class: reading.class, readAt: reading.readAt };
  if (reading.cost === null) return { state: 'absent', cost: null, ...evidence };
  const inWindow = run.dispatchedAt !== null && reading.readAt >= run.dispatchedAt && reading.readAt <= run.closedAt + GRACE_MS;
  const fresh = reading.turn.kind === 'read'
    ? (reading.turn.turnAt === null || reading.turn.turnAt <= reading.readAt) && reading.turn.background === 0
    : false;   // an `unread` marker never vouches
  const sameConversation = reading.sidecarUuid !== null && reading.sidecarUuid === reading.conversationUuid
    && reading.sidecarUuid === run.conversation;
  const cleared = !run.resumed || run.clearedAt !== null;
  if (inWindow && fresh && !run.redispatched && sameConversation && cleared) return { state: 'measured', cost: reading.cost, ...evidence };
  return { state: 'outside', cost: null, ...evidence };
}
