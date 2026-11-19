// D-8126 (wave A7-5, row 38): the worker skill's SELF-INSTALL lane, the L4 executor. One pass on the watcher's tick
// (`LANE_SCHEDULE`'s `skillInstall` row: single flight, its own cadence): for every ACTIVE work run whose journal says
// the dispatch measured the worker skill `absent` and nothing has been installed since (`skillInstallDue`, L1), it runs
// `ccd skill-ensure --wrapper <the bound worker's account>` under a deadline and records the outcome as one run event.
//
// OUTSIDE THE COORDINATION SERIALISER BY CONSTRUCTION: these deps carry no serialiser, so no close, reclaim or dispatch
// ever waits on two installers (the coordinator's ruling of 2026-11-19 for this wave). The dispatch itself is untouched:
// its bind and its `skill-preflight:` row are committed before this lane can see them. The latency is one lane beat
// (departure `install-latency-is-one-lane-beat`): the dispatch route's file is held, so nothing kicks the lane at once.
//
// What decides is L1 (`skillInstall.ts`); this file reads, runs and records.
import { ACTIVE_RUN_STATES, type RunState } from '../../../shared/api.js';
import { CCD_ARGV, ccdCan } from '../ccdargv.js';
import type { FleetState } from '../fleetstate.js';
import type { SessionRecord } from '../registry.js';
import type { RunCcd, WatcherCoordPort } from './ports.js';
import { SKILL_INSTALL_EVENT, skillInstallDue, skillInstallOutcomeOf, type SkillInstallOutcome } from './skillInstall.js';

/** The bound on one `skill-ensure` call: two installers over one home, no network. */
export const SKILL_ENSURE_DEADLINE_MS = 60_000;
/** At most this many installs a pass, so one pass stays inside its row's `staleAfterMs`. */
export const SKILL_INSTALL_PER_PASS = 3;

export interface SkillInstallLaneDeps {
  readonly coord: Pick<WatcherCoordPort, 'runs' | 'runEvents' | 'recordRunEvent'>;
  /** The tick's registry rows: the bound worker's account is its row's `wrapper`. */
  readonly records: readonly Pick<SessionRecord, 'id' | 'wrapper'>[];
  readonly runCcd: RunCcd;
  readonly fleetState: Pick<FleetState, 'ccdVerbs'> | undefined;
  readonly now: () => number;
  readonly deadlineMs?: number;
}

const ACTIVE: ReadonlySet<RunState> = new Set(ACTIVE_RUN_STATES);

/** One due run's outcome, or `null` when its worker's account is not known this pass (it is looked at again on the
 *  next). The capability gate sits in this scope with the call it gates. The deadline's handle is local to this one
 *  call, so it is a deadline, never a scheduler. */
async function installFor(deps: SkillInstallLaneDeps, wrapper: string): Promise<SkillInstallOutcome | null> {
  if (!ccdCan(deps.fleetState, 'skillEnsure')) return 'unsupported';
  if (wrapper === '') return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overdue = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), deps.deadlineMs ?? SKILL_ENSURE_DEADLINE_MS); });
  try {
    const verb = (async () => {
      const res = await deps.runCcd(CCD_ARGV.skillEnsure(wrapper));
      return res.ran === false ? null : res;
    })();
    return skillInstallOutcomeOf(await Promise.race([verb, overdue]));
  } catch {
    return skillInstallOutcomeOf(null);   // a refused argv or a throwing runner: the verb did not run
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One pass. Never throws on a run it cannot read: an unreadable store, a run with no registry row or no account
 *  answers nothing this pass and is looked at again on the next (the window in `skillInstallDue` bounds the retries). */
export async function skillInstallPass(deps: SkillInstallLaneDeps): Promise<SkillInstallOutcome[]> {
  const read = deps.coord.runs();
  if (!read.ok) return [];
  // The bound worker's registry row, by session id: a read of the row the run names, never a binding decision.
  const wrapperOf = new Map(deps.records.map((r) => [r.id, r.wrapper]));
  const done: SkillInstallOutcome[] = [];
  for (const run of read.runs) {
    if (done.length >= SKILL_INSTALL_PER_PASS) break;
    // Economy, never a permission: only an active run has a worker that reads the skill now.
    if (!ACTIVE.has(run.state)) continue;
    if (!skillInstallDue(run, deps.coord.runEvents(run.id), deps.now())) continue;
    const outcome = await installFor(deps, (run.sessionId === null ? undefined : wrapperOf.get(run.sessionId)) ?? '');
    if (outcome === null) continue;
    // `sweep`: the server's lane caused the row, as the dead-dispatch pass's close is caused.
    deps.coord.recordRunEvent(run.id, 'sweep', `${SKILL_INSTALL_EVENT}${outcome}`, deps.now());
    done.push(outcome);
  }
  return done;
}
