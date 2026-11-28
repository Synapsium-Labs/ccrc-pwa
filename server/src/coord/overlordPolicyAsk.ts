// The door's one call of the `OverlordPolicy` port (Overlord W2, the act catalogue B; plan Task B4, review 2271 F15). Ring L1,
// context C5: pure. The port file holds types only (its ring is L2), so this reading of it lives beside it: an adapter's pass
// passes, and everything else, a refusal, a throw or an answer of another shape, is `policy-refused`, fail closed.
//
// EVERYTHING THAT TOUCHES THE ADAPTER IS INSIDE THE TRY (review 4213 F3): the call, and every read of its answer, because an
// answer's getter or a Proxy's trap is the adapter's code too. A throw answers a fixed reason, and a thrown value is never read:
// its text is nobody's to forward, and turning it into text can throw again.
import type { OverlordPolicy, PolicyQuestion, PolicyVerdict } from './overlordPolicy.js';

const THREW = 'the policy threw';
const NO_CHECK = 'the policy answered no check';

/** The adapter's answer read once, field by field: a pass, its refusal with its own reason, or no check. */
function readCheck(answer: unknown): PolicyVerdict {
  if (typeof answer !== 'object' || answer === null) return { ok: false, word: 'policy-refused', cause: 'malformed', why: NO_CHECK };
  const a = answer as { readonly ok?: unknown; readonly why?: unknown };
  const ok = a.ok;
  if (ok === true) return { ok: true };
  if (ok === false) {
    const why = a.why;
    if (typeof why === 'string') return { ok: false, word: 'policy-refused', cause: 'refused', why };
  }
  return { ok: false, word: 'policy-refused', cause: 'malformed', why: NO_CHECK };
}

export function askPolicy(p: OverlordPolicy, q: PolicyQuestion): PolicyVerdict {
  let verdict: PolicyVerdict;
  try {
    verdict = readCheck(p.check(q));
  } catch {
    verdict = { ok: false, word: 'policy-refused', cause: 'threw', why: THREW };
  }
  return verdict;
}
