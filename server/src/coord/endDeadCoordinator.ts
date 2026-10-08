import path from 'node:path';
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { NotifyLog } from '../notifylog.js';
import type { CoordStore } from './store.js';
import type { CloseOutcome, SweepCloseGuard } from './close.js';
import { closeRefusalOf } from './archiveDoor.js';
import { measureClaimant, type ReclaimDeps } from './reclaim.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import { LC_DIR_NAME, LC_ERRORS_NAME, type LifecycleHealth } from '../../../shared/api.js';
import {
  DEAD_COORDINATOR_LANE_LIVE_MARKER, deadCoordinatorBreakerFeedRow, deadCoordinatorCrash, deadCoordinatorFeedRows,
  deadCoordinatorJournal, deadCoordinatorThrewFeedRow,
  type DeadCoordinatorActOutcome, type DeadCoordinatorBreaker, type DeadCoordinatorJournal,
  type DeadCoordinatorJournalTrust, type DeadCoordinatorProgramme, type DeadCoordinatorStop,
} from '../deadCoordinator.js';

/**
 * THE DEAD-COORDINATOR LANE'S ONE EXECUTOR (workspace lifecycle spec 2026-09-24 §5.4, "No successor" and "The act").
 * Its one caller is `watch.ts`'s `sweepDeadCoordinators`, and it runs INSIDE the coordination serialiser — the lane
 * calls it through `CoordRoutesHandle.withSweepAbandon`, which hands it `abandon`, `closeRun`'s abandon arm with
 * `causedBy: 'sweep'`, the compare-and-set on `claimedBy` and this file's re-measure. So the reclaim door, which runs
 * inside that same serialiser, can never interleave with it. The race that remains is a revive of the SAME id (`ccd
 * ensure`, which takes no mutex and changes no `claimedBy`): the compare-and-set cannot see it, so the arm runs the
 * re-measure IMMEDIATELY before each run's fleet act and again after it, before the commit. That NARROWS the window to
 * one round trip; it does not close it (the departure `the-sweep-re-measures-inside-the-arm`).
 *
 * In order, every doubt "not this time":
 *   1. ONE registry listing, nearest the act: `reclaim-paused` — the fleet's one cleanup switch — stops it, and so does
 *      a listing that could not be taken; `dead-coordinator-lane-live` decides SHADOW or LIVE here, whatever the lane's
 *      pass read;
 *   2. the runs the claimant holds NOW (`openRunsClaimedBy`), grouped by programme; a store that cannot say ends it;
 *   3. shadow stops here: "would end programme <slug> (<n> runs)", and `abandon` is never called;
 *   4. live, for each run: `abandon(run, crashedId, stillCrashed)`. Inside the arm the switches are read again (a pause
 *      raised, or the lane disarmed, mid-act stops it), then the claimant is re-measured — the reclaim door's own
 *      verdict and the journal clause, read fresh, against a journal the lane still trusts — and anything but a crash
 *      ends the WHOLE act (`sweep-stopped`). A `claimant-changed` (a successor) ends the whole act too; any other
 *      refusal is listed (`stuck`) and the next run is still tried.
 * It never retries inside itself: the lane's backoff decides when it is asked again.
 */

/** The executor's ports (L2, declared by this consumer). `abandon` is the ONLY way it ends a run. `journalTrust` is the
 *  lane's own reading of the lifecycle mirror's health, gaps and ccd's write failures, asked fresh at each re-measure. */
export interface EndDeadCoordinatorDeps {
  coord: CoordStore;
  io: FleetIO;
  cfg: CcrcConfig;
  tmux: ReclaimDeps['tmux'];
  notifyLog?: NotifyLog;
  journalTrust: () => Promise<DeadCoordinatorJournalTrust>;
  abandon: (runId: number, crashedId: string, stillCrashed: SweepCloseGuard['stillCrashed']) => Promise<CloseOutcome>;
  /** The lane's clock, read at the moment each re-measure measures. A re-measure NEVER takes the pass's instant: a
   *  supervisor heartbeat stamped after that instant would read "from the future", not fresh, and a RESTARTING
   *  coordinator (heartbeat written before its pane is up) would read `orphan` — crashed. */
  now: () => number;
}

/**
 * HOW FAR THE LANE TRUSTS THE JOURNAL this pass (the departure `journal-loss-reads-as-unmeasured`) — read here, an
 * adapter, so the lane gathers and decides nothing. From the mirror's own health (`JournalMirror.health()`, which the
 * watcher already reports on `/api/fleet/health`), its recorded gaps, and — when ccd has counted write failures — the
 * counter file's mtime, the instant of the last one:
 *  - `unknown` (not swept since this process started) or `stale` (no sweep for three intervals): `hold` — the pass
 *    decides NOTHING, so a restart or a slow mirror never deletes an anchor, and never counts a pass toward the hour;
 *  - `unavailable` (the fleet's ccd does not journal at all): every dead claimant's journal is untrusted, so it is
 *    listed `unmeasured` and never acted on;
 *  - `ok`: trusted, with the gaps and the last write failure for the clause to place against each claimant's last start.
 */
export async function readDeadCoordinatorJournalTrust(
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'io' | 'cfg'>, health: LifecycleHealth | null,
): Promise<{ readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust }> {
  const untrusted = (why: string, hold: boolean) =>
    ({ hold: hold ? why : null, trust: { untrusted: why, gapGens: [], lastWriteErrorAt: null } });
  if (health === null) return untrusted('there is no coordination store to mirror the journal into', true);
  if (health.state === 'unknown' || health.state === 'stale') return untrusted(`the lifecycle mirror is ${health.state}`, true);
  if (health.state === 'unavailable') return untrusted('the fleet box’s ccd does not journal (no lifecycle-v1)', false);
  let gapGens: string[];
  try {
    gapGens = deps.coord.lifecycleGapGens();
  } catch (err) {
    return untrusted(`the mirror's recorded gaps could not be read (${err instanceof Error ? err.message : String(err)})`, false);
  }
  let lastWriteErrorAt: number | 'unknown' | null = null;
  // The mirror's `writeErrors` is `null` for an ABSENT errors file AND for one it has not been able to read since this
  // process started — two conditions, one value. ccd writes that file ONLY when it counts a failure, so its existence
  // alone means one was counted: a `null` is therefore measured here, and only a PROVEN absence (ENOENT) is "none".
  if (health.writeErrors === null || health.writeErrors > 0) {
    const st = await deps.io.statMeasured(path.join(deps.cfg.registryDir, LC_DIR_NAME, LC_ERRORS_NAME));
    if (st.ok) lastWriteErrorAt = st.mtimeMs;
    else if (!(health.writeErrors === null && st.reason === 'absent')) lastWriteErrorAt = 'unknown';
  }
  return { hold: null, trust: { untrusted: null, gapGens, lastWriteErrorAt } };
}

/** Is the lane ARMED in this registry listing? The one reader of the live switch outside its definer — so the watcher,
 *  which holds writes of its own, never names it (`single-definition.test.ts`'s no-writer pin). */
export const deadCoordinatorLaneArmed = (names: readonly string[]): boolean => names.includes(DEAD_COORDINATOR_LANE_LIVE_MARKER);

/** The runs, grouped by programme in the order the store listed them (id order). */
const byProgramme = (runs: readonly { id: number; program: string }[]): DeadCoordinatorProgramme[] => {
  const out = new Map<string, number[]>();
  for (const r of runs) out.set(r.program, [...(out.get(r.program) ?? []), r.id]);
  return [...out].map(([slug, runIds]) => ({ slug, runIds }));
};

/** The journal clause, read fresh for one claimant against the lane's trust. A read that throws is `unreadable` —
 *  never "no history". */
export function deadCoordinatorJournalOf(coord: CoordStore, id: string, trust: DeadCoordinatorJournalTrust): DeadCoordinatorJournal {
  try {
    const j = coord.deadCoordinatorJournalRows([id]).get(id)!;
    return deadCoordinatorJournal(j.rows, j.hasHistory, trust);
  } catch (err) {
    return { kind: 'unreadable', detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Is the claimant STILL crashed, and is the lane still armed and unpaused? `null` when it may go on; otherwise why
 *  it stops — typed (`DeadCoordinatorStop`), so the lane never re-splits the prose. */
export async function stillCrashed(deps: EndDeadCoordinatorDeps, id: string): Promise<DeadCoordinatorStop | null> {
  let names: readonly string[] | null;
  try { names = await deps.io.readdir(deps.cfg.registryDir); } catch { names = null; }
  if (names === null) return { kind: 'switch', why: `the registry did not list, so a raised ${RECLAIM_PAUSE_MARKER} cannot be ruled out` };
  if (names.includes(RECLAIM_PAUSE_MARKER)) return { kind: 'switch', why: `${RECLAIM_PAUSE_MARKER} was raised during the act` };
  if (!deadCoordinatorLaneArmed(names)) return { kind: 'switch', why: 'the lane was disarmed during the act' };
  const m = await measureClaimant({ coord: deps.coord, io: deps.io, cfg: deps.cfg, tmux: deps.tmux }, id, deps.now());
  const c = deadCoordinatorCrash(m, deadCoordinatorJournalOf(deps.coord, id, await deps.journalTrust()));
  switch (c.kind) {
    case 'crashed': return null;
    case 'alive': return { kind: 'remeasured', why: `re-measured alive: ${c.why}` };
    case 'stopped': return { kind: 'remeasured', why: 're-measured stopped' };
    case 'deliberate': return { kind: 'remeasured', why: `re-measured: a deliberate ${c.act} since its last start` };
    case 'unmeasurable': case 'unmeasured': return { kind: 'remeasured', why: `re-measured ${c.kind}: ${c.why}` };
  }
}

/** `_passNowMs` is the pass's instant, kept on the signature for the lane's call and for what is genuinely the pass's
 *  (anchors, feed rows — both the lane's). NO re-measure here may use it: each reads `deps.now()` as it measures. */
export async function endDeadCoordinator(
  deps: EndDeadCoordinatorDeps, claimantId: string, _passNowMs: number,
): Promise<DeadCoordinatorActOutcome> {
  // 1 — the switches, from ONE listing, nearest the act.
  let names: readonly string[] | null;
  try { names = await deps.io.readdir(deps.cfg.registryDir); } catch { names = null; }
  if (names === null) {
    return { kind: 'paused-at-server', detail: `the registry did not list, so a raised ${RECLAIM_PAUSE_MARKER} cannot be ruled out` };
  }
  if (names.includes(RECLAIM_PAUSE_MARKER)) {
    return { kind: 'paused-at-server', detail: `${RECLAIM_PAUSE_MARKER} is raised: cleanup is paused fleet-wide` };
  }
  // 2 — the runs it holds NOW.
  let runs: { id: number; program: string }[];
  try {
    const read = deps.coord.openRunsClaimedBy(claimantId);
    if (!read.ok) return { kind: 'store-unreadable', detail: read.detail };
    runs = read.siblings;
  } catch (err) {
    return { kind: 'store-unreadable', detail: err instanceof Error ? err.message : String(err) };
  }
  // 3 — shadow stops here: recorded, and `abandon` is never called.
  if (!deadCoordinatorLaneArmed(names)) return { kind: 'would-end', programmes: byProgramme(runs) };
  // 4 — each run: the abandon, with the compare-and-set and the re-measure inside the arm.
  const ended: { id: number; program: string }[] = [];
  const released: { id: number; program: string }[] = [];
  const reheld: { id: number; program: string }[] = [];
  const stuck: { runId: number; why: string }[] = [];
  let stoppedBy: DeadCoordinatorStop | null = null;
  // What the act has done so far, as its outcome — also what a THROWN act hands back (`DeadCoordinatorActThrew`).
  // The run whose abandon is in flight — what a throw names, since the arm answered nothing about it.
  let current: number | null = null;
  const outcome = (failed?: string): Extract<DeadCoordinatorActOutcome, { kind: 'ended' }> => {
    const closed = new Set(ended.map((r) => r.id));
    return { kind: 'ended', programmes: byProgramme(ended), open: byProgramme(runs.filter((r) => !closed.has(r.id))),
      stuck, stoppedBy, ...(released.length === 0 ? {} : { released: byProgramme(released) }),
      ...(reheld.length === 0 ? {} : { reheld: byProgramme(reheld) }),
      ...(failed === undefined ? {} : { failed, ...(current === null ? {} : { failedRun: current }) }) };
  };
  try {
    for (const run of runs) {
      current = run.id;
      const out = await deps.abandon(run.id, claimantId, () => stillCrashed(deps, claimantId));
      if (out.ok) { ended.push(run); continue; }
      if (out.kind === 'sweep-stopped') {
        // The stop came after the fleet act: the worker is released, or re-held under a surviving run, and its run stays
        // open. A TYPED fact, carried as the act that ran, so the lane records it whether or not the act closed anything
        // (`released` or `reheld` on the outcome) and words each as what it is (review 339, F3).
        if (out.fleetAct === 'released') released.push(run);
        else if (out.fleetAct === 're-held') reheld.push(run);
        stoppedBy = out.stop;
        break;
      }
      if (out.kind === 'claimant-changed') {
        stoppedBy = { kind: 'successor',
          why: `run ${run.id}'s programme has a coordinator again (${out.claimedBy ?? 'none'}) — no successor may be failed` };
        break;
      }
      const why = closeRefusalOf(run.id, out);
      stuck.push({ runId: run.id, why: why.detail === undefined ? why.kind : `${why.kind}: ${why.detail}` });
    }
    current = null;
  } catch (err) {
    // The runs that closed before the throw ARE closed: the lane records them, so the error carries them.
    throw new DeadCoordinatorActThrew(err, outcome(err instanceof Error ? err.message : String(err)));
  }
  return outcome();
}

/** A THROWN act, carrying what it had done: `message` is the original's, so every reader of the error reads what it read,
 *  and `outcome` is the executor's own answer up to the throw (`failed` says what failed). The lane records its closed
 *  programmes before it backs off — the throw loses the act's error, never its record. */
export class DeadCoordinatorActThrew extends Error {
  readonly outcome: Extract<DeadCoordinatorActOutcome, { kind: 'ended' }>;
  readonly original: unknown;
  constructor(original: unknown, outcome: Extract<DeadCoordinatorActOutcome, { kind: 'ended' }>) {
    super(original instanceof Error ? original.message : String(original));
    this.name = 'DeadCoordinatorActThrew';
    this.outcome = outcome;
    this.original = original;
  }
}

/** Feed rows, recorded and never pushed: `kind: 'run'` with no run and a claimant as the session. A missing log
 *  degrades the record and never the act. */
function recordRows(
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'notifyLog'>, sessionId: string,
  rows: readonly { readonly title: string; readonly body: string }[], what: string,
): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    for (const row of rows) {
      const ev = log.record({ kind: 'run', sessionId, runId: null, title: row.title, body: row.body });
      deps.coord.recordFeedEvent(log.epoch, ev);
    }
  } catch (err) {
    console.warn('ccrc-server: recordFeedEvent failed '
      + `(${err instanceof Error ? err.message : String(err)}) — dead coordinator ${what}, feed archive degraded`);
  } finally {
    void log.flush();
  }
}

/** The feed rows for an act or its shadow — ONE per programme, in the spec's words, with the instant the hour counted
 *  from (`deadCoordinatorFeedRows`, L1). */
export function recordDeadCoordinatorFeed(
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'notifyLog'>, claimantId: string, o: DeadCoordinatorActOutcome, since: number,
): void {
  recordRows(deps, claimantId, deadCoordinatorFeedRows(claimantId, o, since), o.kind);
}

/** The feed row for an act that THREW — every one, whatever it had done (review 339, F13). */
export function recordDeadCoordinatorThrew(
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'notifyLog'>, claimantId: string,
  done: Extract<DeadCoordinatorActOutcome, { kind: 'ended' }> | null, error: string, since: number,
): void {
  recordRows(deps, claimantId, [deadCoordinatorThrewFeedRow(claimantId, done, error, since)], 'act failed');
}

/** The breaker's feed row, under its first claimant — written by the lane when the trip begins or names a new set. */
export function recordDeadCoordinatorBreaker(
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'notifyLog'>, b: Extract<DeadCoordinatorBreaker, { tripped: true }>,
): void {
  recordRows(deps, b.claimants[0] ?? 'fleet', [deadCoordinatorBreakerFeedRow(b)], 'breaker');
}
