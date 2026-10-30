// D-7512 (ARCH-05): the two pure verdicts over what Claude Code's live status file says, moved inward from
// `livestate.ts` (L3, which keeps the read and its torn-body wait) so `fleet.ts` (L1) reaches them without an outward
// edge. L1, pure: no clock, no I/O. `livestate.ts` re-exports both, so its importers read the same bindings.
import type { SessionStatus } from '../../shared/api.js';
import { turnSays, turnWordOf } from './sessionReading.js';
import { CLAUDE_MIN_BUILD, compareClaudeVersions, isClaudeVersion } from '../../shared/claudeVersion.js';

/**
 * The live file's `status` → the two states ccrc shows. Claude Code writes at
 * least four: `idle`, `busy` (the main query runs, OR a background agent or
 * workflow task is still open), `shell` (an IDLE main loop, relabelled while a
 * background shell or Monitor task runs — the worker stall watch design's
 * §3.1, binary-confirmed) and `waiting` (D-76 — blocked on the human, and the
 * bundle sets `working:!1` beside it). From the operator's side all three
 * non-idle words mean work is still running or a human is needed, so `idle` is
 * the ONLY value that reads as idle and everything else is busy.
 *
 * `waiting` COLLAPSES TO BUSY HERE, DELIBERATELY, and the fix for it is not
 * in this function. Its readers are `fleet.ts`'s `assembleFleet` (the fleet
 * card) and the per-session socket (the chat header); the interrupt route
 * reads the RAW word through `turnverdict.ts`, and none of them may paint a human-blocked session as at rest.
 * The mail delivery gate (`watch.ts`) no longer reads this collapse: it takes
 * the RAW word through `mailTurnIdle` (`turnidle.ts`), which delivers on `idle`
 * and on `shell` and refuses `waiting` by its own rule. What `waiting` actually
 * needs is the ATTENTION bucket, and it reaches that
 * through `fleet.ts`'s `dialogPending` (which reads `livestate.ts#LiveState`'s `waitingFor`)
 * — a field, not a status word. `livestate.test.ts` pins this collapse.
 *
 * The default direction is the whole point. Matching `busy` and calling the
 * rest idle (what this used to do) made a session mid-command render "idle · 1m
 * ago" on its fleet card while its own terminal showed the spinner, made the
 * two surfaces flap out of sync as a turn alternated between streaming and
 * shelling out, and fired a "Finished — back to idle" push on every shell-out.
 * That history is of builds before 2.1.277, which nobody read for how they
 * wrote `shell`; in 2.1.277–2.1.284 `shell` comes only from an idle main loop
 * (the paragraph at the top of this docstring).
 * A status we don't recognise is far likelier to be new work than new rest.
 */
export function liveSessionStatus(status: string): SessionStatus {
  // `keystroke` ON PURPOSE, not a display policy of its own: `SessionStatus` is not only the badge, it still gates
  // acts (the mail delivery gate and the per-session socket, `livestate.test.ts`), and its direction is keystroke's,
  // only `idle` is rest. `livestate.test.ts` pins every word's answer here directly, so an edit to the keystroke
  // policy that moved this collapse reds there instead of changing the fleet badge silently.
  return turnSays('keystroke', turnWordOf(status)) === 'rest' ? 'idle' : 'busy';
}

/**
 * Whether the live file's `status` already counts delegated work — a running
 * Workflow among it — for the Claude Code build that wrote it (`version`).
 *
 * From 2.1.277 the writer is `status: h.isLoading || h.delegatedActive ? "busy"
 * : "idle"`, where `delegatedActive` is any non-terminal task whose type is in
 * `new Set(["local_agent","remote_agent","in_process_teammate",
 * "local_workflow"])`. Found in the binaries of 2.1.277, 2.1.278 and
 * 2.1.280–2.1.283, and measured on 2.1.281–2.1.283: a workflow's orchestrator
 * reads `busy` after its own turn ends, and `idle` only when the workflow does.
 * So an `idle` from such a file has ruled a running workflow out, and the pane's
 * Workflow row must not overrule it (fleet.ts).
 *
 * `false` — keep the pane row as the fallback — for no version, for a build
 * below 2.1.277 (unmeasured, none on the fleet), and for any string that is
 * not a Claude Code build. Judged by the lexicon (`shared/claudeVersion.ts`'s
 * `isClaudeVersion`, `compareClaudeVersions` and `CLAUDE_MIN_BUILD`, D-5696),
 * not by `shared/semver.ts`'s `compareReleaseTags`, which takes release TAGS
 * (`vX.Y.Z`): this string comes from Claude Code's file, not from us. Since
 * D-5696 a string must be exactly `X.Y.Z` (a suffix or a leading zero, which
 * the old prefix parse let through, is `false`, toward the fallback).
 *
 * KNOWN LIMIT: the floor has no ceiling. Every build from 2.1.277 up is
 * trusted, the unmeasured ones above 2.1.283 (and 3.x) included, while the
 * unmeasured ones below 2.1.277 are not. A later Claude Code that narrows
 * `delegatedActive` — it already leaves out idle teammates and long-running
 * remote agents — would read a Workflow's orchestrator idle mid-run, and
 * this gate would silence the one pane row that could notice. Re-measure the
 * writer and the delegation set on every Claude Code bump; this function is
 * the single place to narrow the trust (a ceiling at the highest measured
 * build, say).
 */
export function liveStatusCoversDelegation(version: string | null): boolean {
  return isClaudeVersion(version) && compareClaudeVersions(version, CLAUDE_MIN_BUILD) >= 0;
}
