import path from 'node:path';
import type { SkillState } from '../../shared/api.js';
import type { FleetIO } from './io.js';

/**
 * THE skill-presence read. ONE definition, on purpose (program-leverage fold
 * ruling, 2026-08-28).
 *
 * The adjacent graphify lane is building its own skill-convergence machinery,
 * and the two cannot literally be one function: that one is bash, runs on the
 * fleet box, walks EVERY roster home realpath-de-duplicated, compares a version
 * stamp against a pin, and emits an operator verdict; this one is TypeScript,
 * runs in the server process, reads ONE bound worker's config dir, measures a
 * file's existence, and emits a wire field. What the two lanes converge on is
 * the VOCABULARY and the absent-vs-unmeasurable distinction — `SkillState` in
 * `shared/api.ts` — not the code. If a second TypeScript caller ever needs to
 * ask whether a skill is installed, it calls THIS and `WORKER_SKILL_DIR` grows
 * a parameter; it does not grow a second join.
 *
 * Shaped after `readLiveStateMeasured` (`livestate.ts`) and `readTasks`
 * (`tasks/read.ts`): the CALLER supplies the config dir, because turning a
 * wrapper into a directory is `configDirFor`'s single job (`config.ts`) and
 * `single-definition.test.ts` fails the build on a second site that does it.
 */

/** The directory `ccd/install-worker-skill.sh` writes, under `<configDir>/skills/`. */
export const WORKER_SKILL_DIR = 'ccrc-worker';

/** The one file that installer's `REQUIRED_FILES` names. */
export function workerSkillPath(configDir: string): string {
  return path.join(configDir, 'skills', WORKER_SKILL_DIR, 'SKILL.md');
}

/**
 * An `undefined` configDir is NOT a missing skill — it is a missing PATH, and
 * the two are different facts. It arrives two ways, both real: `configDirFor`
 * answers `undefined` for a wrapper this box's roster does not carry (a
 * deployment gap that no retry can heal, since the roster is read once at
 * boot), and dispatch's resume arm tolerates a session absent from a listable
 * registry, leaving no wrapper to map at all. Neither read a file, so neither
 * may say `absent`.
 *
 * Uses `readFileMeasured`, never `readFile` — the latter folds absent and
 * unreadable into one `null`, which is precisely the distinction this function
 * exists to carry. One read, not a readdir plus a stat: in remote fleet mode
 * this is an agent round trip inside a mutex-held critical section, and
 * `io.stat`'s agent half answers EACCES as `{missing:true}`, so a directory
 * probe would LIE about absence.
 */
export async function readWorkerSkillState(
  io: Pick<FleetIO, 'readFileMeasured'>, configDir: string | undefined,
): Promise<SkillState> {
  if (configDir === undefined) return 'unmeasurable';
  const read = await io.readFileMeasured(workerSkillPath(configDir));
  if (read.ok) return 'present';
  return read.reason === 'absent' ? 'absent' : 'unmeasurable';
}
