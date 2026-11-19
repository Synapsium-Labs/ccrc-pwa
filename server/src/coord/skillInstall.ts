// D-8126 (wave A7-5, row 38): the worker skill's SELF-INSTALL, the L1 half. A dispatch measures the worker skill on the
// bound worker's home (`skill-preflight:<state>`, `dispatch.ts`); where it reads `absent`, the server installs the
// coordinator and worker skills on that one home through `ccd skill-ensure --wrapper <id>`. The act is a watcher lane
// (`skillInstallLane.ts`), never the dispatch route: the route's file is held, and a lane runs outside the coordination
// serialiser by construction, so the install never delays a bind, a close or another dispatch (departure
// `install-outcome-is-a-run-event`). The outcome is ONE run event, `skill-install:<outcome>`, its one writer the lane.
//
// L1: pure deciders over facts the lane read. No I/O, and only a type import.
import type { RunKind } from '../../../shared/api.js';

/** The `run_events.detail` prefix of the dispatch's skill measurement; followed by `present`, `absent` or `unmeasurable`.
 *  `dispatch.ts` writes it through this constant. */
export const SKILL_PREFLIGHT_EVENT = 'skill-preflight:';
/** The `run_events.detail` prefix of the self-install's outcome; followed by one `SkillInstallOutcome`. */
export const SKILL_INSTALL_EVENT = 'skill-install:';

/** What the self-install did: the verb's own answer (`installed`, `converged`, `failed`), or `unsupported` when this box's
 *  ccd does not advertise `skill-ensure`, recorded once so the run's trail says why nothing was installed. */
export type SkillInstallOutcome = 'installed' | 'converged' | 'failed' | 'unsupported';
const OUTCOME_WORDS: Record<SkillInstallOutcome, true> = { installed: true, converged: true, failed: true, unsupported: true };
/** Every outcome word, derived from the type. */
export const SKILL_INSTALL_OUTCOMES = Object.keys(OUTCOME_WORDS) as SkillInstallOutcome[];

/** How old a `skill-preflight:absent` row may be and still be acted on. A dispatch older than this is not the one in
 *  hand: a server that starts after an upgrade does not install on every run an older build left `absent`, and a box
 *  whose verb kept failing is not retried forever. */
export const SKILL_INSTALL_WINDOW_MS = 30 * 60_000;

/** One run as the lane reads it from `runs()`. */
export interface SkillInstallRun {
  readonly id: number;
  readonly kind: RunKind;
  readonly sessionId: string | null;
}

/** Whether run `run` waits for a self-install, from its own journal (oldest row first) at `now`: a WORK run with a
 *  bound session whose NEWEST skill measurement is `absent`, measured inside the window, with no install outcome
 *  recorded after it. A review run measures the reviewer skill, which `skill-ensure` does not install, so it is never
 *  due. Every doubt answers false: the dispatch stands either way. */
export function skillInstallDue(
  run: SkillInstallRun, events: readonly { at: number; detail: string | null }[], now: number,
): boolean {
  if (run.kind !== 'work' || run.sessionId === null) return false;
  let preflight = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]!.detail?.startsWith(SKILL_PREFLIGHT_EVENT) === true) { preflight = i; break; }
  }
  if (preflight === -1) return false;
  const row = events[preflight]!;
  if (row.detail !== `${SKILL_PREFLIGHT_EVENT}absent`) return false;
  if (now - row.at > SKILL_INSTALL_WINDOW_MS) return false;
  return !events.slice(preflight + 1).some((e) => e.detail?.startsWith(SKILL_INSTALL_EVENT) === true);
}

/** The verb's outcome from what the runner answered: `installed` or `converged` only when ccd exited 0 and its LAST
 *  non-empty stdout line is the JSON object naming that result; `null` (the verb did not run, or ran out its deadline),
 *  a non-zero exit, an unparsable line or any other word is `failed`. ccd's rc alone names no result: it answers 0 for
 *  all three. */
export function skillInstallOutcomeOf(res: { ok: boolean; stdout: string } | null): 'installed' | 'converged' | 'failed' {
  if (res === null || !res.ok) return 'failed';
  const line = res.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '').pop() ?? '';
  try {
    const parsed: unknown = JSON.parse(line);
    const word = typeof parsed === 'object' && parsed !== null ? (parsed as { result?: unknown }).result : undefined;
    return word === 'installed' || word === 'converged' ? word : 'failed';
  } catch {
    return 'failed';
  }
}
