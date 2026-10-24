// D-5896 (ARCH-05, #551): a pure leaf, moved out of `exec.ts`, which spawns processes. `exec.ts` re-exports both
// names. It imports nothing.
/**
 * THE VOCABULARY FOR "WE DID NOT MEASURE THIS", stated once here and used
 * unchanged at every seam that needed it (§1.7). Two shapes, and which one a
 * field gets is decided by whether the field can be absent at all:
 *
 *   • OPTIONAL field on a record that crosses a version boundary — ABSENCE is
 *     the unmeasured answer, presence is a measurement. `ExecResult.killed` and
 *     `ExecResult.signal` (`exec.ts`): an older agent omits them, and absence-permits
 *     is the wire rule (`shared/api.ts`, additive-only). A present `null` on
 *     `signal` is a MEASUREMENT — "it died of no signal" — and is not the same
 *     fact as the key being missing.
 *   • REQUIRED field, where absence is not spellable — unmeasured gets its OWN
 *     TOKEN, `UNMEASURED`, which is never a member of the measured domain.
 *     `CcdResult.killed`/`.signal` (`lifecycle.ts`) take this shape.
 *
 * The rule both shapes serve: a caller that handles "false" differently from "we
 * do not know" must never receive the same value for both. The third face of the
 * same rule lives at the render seam — a value this build cannot NAME is shown
 * as itself, never as a member it is not (`SessionLine.tsx`'s spawn chip).
 */
export const UNMEASURED = 'unmeasured';
export type Unmeasured = typeof UNMEASURED;

/** D-6034 (ARCH-10, #543, step 1): the FOURTH face of the same rule, one layer down — the command itself, not a
 *  measurement of it. Why a command NEVER RAN, or may not have:
 *   - `spawn`: it was never started, and that is known (a local spawn error; the agent declining the request,
 *     `forbidden` among them);
 *   - `transport`: the link failed (a dropped socket, an abort, a frame never handed to the link), so whether it ran
 *     is unknown;
 *   - `timeout`: this server stopped waiting, so whether it ran, or still runs, is unknown.
 *  None of the three is a refusal: a runner forges `code: 1` on this arm, and a reader that classified that code would
 *  read an agent drop as the verb saying no. */
export type NotRanReason = 'transport' | 'spawn' | 'timeout';

/** The arm `ExecResult` (`exec.ts`) and `CcdResult` (`coord/ports.ts`) both carry when the command never ran. */
export interface NotRan { ran: false; reason: NotRanReason; detail: string }

/** D-TBD-ran-required: the sentence a lane writes for a call that never ran, or may not have: the verb, the runner's
 *  reason and its own words. One spelling for every lane that answers it as unmeasured and retried later. */
export function notRanSentence(verb: string, r: NotRan): string {
  return `${verb} was not answered (${r.reason}: ${r.detail}) — unmeasured, asked again on a later pass`;
}
