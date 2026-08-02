// POSITIVE CONTROL — lives in the SAME failing project as p1/p2, and
// `prphase.test.ts` asserts that tsc reports NO diagnostic against this file.
//
// Without it, "the prphase project fails" is satisfied by `shared/api.ts`
// failing to parse at all, or by `isPrPhase` disappearing along with the
// constant. The way `registry.ts` actually validates the field has to keep
// building, with no cast anywhere, and the narrowing has to be real — `raw` is
// `string` on the true branch of `isPrPhase` only because the predicate says
// so.
import { isPrPhase, type PrPhase } from '../../../../shared/api.js';

declare const prPhaseRaw: string | null;
export const phase: PrPhase | null = isPrPhase(prPhaseRaw) ? prPhaseRaw : null;
