// The door's one call of the `OverlordPolicy` port (Overlord W2, the act catalogue B; plan Task B4, review 2271 F15). Ring L1,
// context C5: pure. The port file holds types only (its ring is L2), so this reading of it lives beside it: an adapter's pass
// passes, and everything else, a refusal, a throw or an answer of another shape, is `policy-refused`, fail closed.
import type { OverlordPolicy, PolicyQuestion, PolicyVerdict } from './overlordPolicy.js';

const whyOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function askPolicy(p: OverlordPolicy, q: PolicyQuestion): PolicyVerdict {
  let answer: unknown;
  try {
    answer = p.check(q);
  } catch (e) {
    return { ok: false, word: 'policy-refused', cause: 'threw', why: `the policy threw: ${whyOf(e)}` };
  }
  if (typeof answer === 'object' && answer !== null) {
    const a = answer as { readonly ok?: unknown; readonly why?: unknown };
    if (a.ok === true) return { ok: true };
    if (a.ok === false && typeof a.why === 'string') return { ok: false, word: 'policy-refused', cause: 'refused', why: a.why };
  }
  return { ok: false, word: 'policy-refused', cause: 'malformed', why: 'the policy answered something that is not a check' };
}
