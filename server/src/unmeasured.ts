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
