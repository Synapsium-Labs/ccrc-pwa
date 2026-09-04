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
 *
 * THAT DAY ARRIVED (program-leverage wave 3, F3): the program-ready
 * measurement asks the same question about the COORDINATOR skill, in every
 * rostered home. It grew the parameter this docstring promised — `skillPath`
 * takes the skill dir — rather than a second join, and `readWorkerSkillState`
 * is now a delegate that keeps its own signature for the dispatch preflight.
 */

/** The directory `ccd/install-worker-skill.sh` writes, under `<configDir>/skills/`. */
export const WORKER_SKILL_DIR = 'ccrc-worker';

/**
 * The directory `ccd/install-coordinator-skill.sh` writes, same parent.
 *
 * NOTE the deliberate narrowing (D-1027): that installer names five REQUIRED
 * reference files beside `SKILL.md` and refuses the install without them, so
 * "SKILL.md is readable" is WIDER than the installer's own definition of
 * installed — a home whose refs were deleted reads `present` here. The
 * narrower read is chosen on cost (each ref would be another agent round trip
 * per home in remote fleet mode, five on top of two) and because the
 * ref-level verdict belongs to the doctor lane, not this one. `skillPath`
 * takes the dir as a parameter precisely so a caller that needs the wider
 * answer can have it without a second join.
 */
export const COORDINATOR_SKILL_DIR = 'ccrc-coordinator';

/** THE join — one, still. The file both installers' `REQUIRED_FILES` name. */
export function skillPath(configDir: string, skillDir: string): string {
  return path.join(configDir, 'skills', skillDir, 'SKILL.md');
}

/** Kept for the caller that predates the parameter: same signature, same path. */
export function workerSkillPath(configDir: string): string {
  return skillPath(configDir, WORKER_SKILL_DIR);
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
export async function readSkillState(
  io: Pick<FleetIO, 'readFileMeasured'>, configDir: string | undefined, skillDir: string,
): Promise<SkillState> {
  if (configDir === undefined) return 'unmeasurable';
  const read = await io.readFileMeasured(skillPath(configDir, skillDir));
  if (read.ok) return 'present';
  return read.reason === 'absent' ? 'absent' : 'unmeasurable';
}

/** The dispatch preflight's call, unchanged in signature and in semantics. */
export async function readWorkerSkillState(
  io: Pick<FleetIO, 'readFileMeasured'>, configDir: string | undefined,
): Promise<SkillState> {
  return readSkillState(io, configDir, WORKER_SKILL_DIR);
}
