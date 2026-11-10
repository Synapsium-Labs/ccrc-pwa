// D-8126, row 38: the worker skill's self-install, in a file of its own. `dispatch.ts` holds no deadline timer (it stays an
// inner-ring file the dead-dispatch pass imports `bindReturnedChild` from), and this verb's overdue guard is one, so it
// lives here and the route (the only caller) imports it.
import { CCD_ARGV, ccdCan } from '../ccdargv.js';
import type { SkillInstall } from '../../../shared/api.js';
import type { DispatchOutcome, DispatchRunDeps } from './dispatch.js';

/** The bound on one `skill-ensure` call: two installers over one home, no network. */
const SKILL_ENSURE_DEADLINE_MS = 60_000;

/**
 * D-8126, row 38: a dispatch that measured the worker skill `absent` installs it. Called by the route AFTER
 * `coordMutex` releases `dispatchRun` (the bind is committed and the `skill-preflight` row written by then, so the
 * install never delays it), and never refuses: a failed, unparsable or overdue verb answers `failed` and the dispatch
 * stands. `present` and `unmeasurable` run nothing. The verb's own JSON line names the result; its rc alone does not.
 */
export async function installAbsentSkill(
  deps: Pick<DispatchRunDeps, 'coord' | 'runCcd' | 'fleetState'> & { skillEnsureDeadlineMs?: number },
  out: DispatchOutcome,
): Promise<DispatchOutcome> {
  if (!out.ok || out.skillState !== 'absent' || out.skillWrapper === null) return out;
  if (!ccdCan(deps.fleetState, 'skillEnsure')) return out;
  let result: SkillInstall = 'failed';
  // `skill-ensure` installs the coordinator and worker skills only, never the reviewer skill that a `review` run
  // measures (`skillDirFor`). A review run (or one that cannot be read) answers `failed` without running the verb,
  // so a converged worker skill is never reported as the reviewer skill's install.
  const read = deps.coord.run(out.id);
  const kindOk = read.ok && read.run !== null && read.run.kind === 'work';
  if (!kindOk) {
    deps.coord.recordRunEvent(out.id, 'coordinator', `skill-install:${result}`);
    return { ...out, skillInstall: result };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const overdue = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), deps.skillEnsureDeadlineMs ?? SKILL_ENSURE_DEADLINE_MS); });
    const wrapper = out.skillWrapper;
    const verb = (async () => {
      const ensured = await deps.runCcd(CCD_ARGV.skillEnsure(wrapper));
      // A verb the runner did not run answers `failed`, like an overdue one.
      if (ensured.ran === false) return null;
      return ensured;
    })();
    const res = await Promise.race([verb, overdue]);
    if (res !== null && res.ok) {
      const line = res.stdout.trim().split('\n').filter((l) => l.trim() !== '').pop() ?? '';
      try {
        const word = (JSON.parse(line) as { result?: unknown }).result;
        if (word === 'installed' || word === 'converged') result = word;
      } catch { /* an unparsable answer is a failure */ }
    }
  } catch { /* a refused argv or a throwing runner is a failure too */ }
  finally { if (timer !== undefined) clearTimeout(timer); }
  deps.coord.recordRunEvent(out.id, 'coordinator', `skill-install:${result}`);
  return { ...out, skillInstall: result };
}
