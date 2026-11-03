import type { LinearPolicyRefusal, LinearPolicyVerdict, LinearWriteAsk, LinearWriteDecision, LinearWritePolicy } from './policy.js';

/**
 * THE POLICY DECISION POINT ON LINEAR WRITES, its deadline and its default (#1444, spec §8, D-7672). The port is
 * `policy.ts` (L2, types only). This file holds the values the port cannot (D-7687): `askWithDeadline`, which holds a
 * deadline timer and so is L3 by the rings' facts, and `allowAll`, the default `index.ts` wires.
 *
 * FAILS CLOSED. A deny is `policy-denied`. A throw (a rejected promise or a synchronous one), no answer within
 * {@link LINEAR_POLICY_DEADLINE_MS}, or an answer of any other shape is `policy-unavailable`. The route journals both
 * refusals, with the decision id when one came back (spec §8). Nothing here fails open.
 */

/** How long the point waits for a policy's answer (spec §8). */
export const LINEAR_POLICY_DEADLINE_MS = 2_000;

/** The point's two refusal words, in the order `LinearPolicyRefusal` names them. */
export const LINEAR_POLICY_REFUSALS = ['policy-denied', 'policy-unavailable'] as const satisfies readonly LinearPolicyRefusal[];

/** The default policy (spec §8): every write is allowed, with no decision id. #279's rule is that without the hook
 *  configured, behaviour is unchanged. */
export const allowAll: LinearWritePolicy = async () => ({ allow: true, decisionId: null });

/** A decision id as the journal keeps it: SAFE_RE, bounded. */
const DECISION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const UNAVAILABLE: LinearPolicyVerdict = Object.freeze({ allow: false, code: 'policy-unavailable', decisionId: null });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const hasExactly = (o: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const isDecisionId = (v: unknown): v is string | null => v === null || (typeof v === 'string' && DECISION_ID_RE.test(v));

/** The verdict a policy's answer gives, or null for an answer of any other shape. */
function verdictOf(d: unknown): LinearPolicyVerdict | null {
  if (!isPlainObject(d)) return null;
  if (d['allow'] === true && hasExactly(d, ['allow', 'decisionId']) && isDecisionId(d['decisionId'])) {
    return { allow: true, decisionId: d['decisionId'] };
  }
  if (d['allow'] === false && hasExactly(d, ['allow', 'why', 'decisionId']) && isDecisionId(d['decisionId'])) {
    if (d['why'] === 'denied') return { allow: false, code: 'policy-denied', decisionId: d['decisionId'] };
    if (d['why'] === 'unavailable') return { allow: false, code: 'policy-unavailable', decisionId: d['decisionId'] };
  }
  return null;
}

/** Asks `policy` about `ask` within {@link LINEAR_POLICY_DEADLINE_MS}, and fails closed: the verdict the route acts
 *  on. Never throws. The deadline is cleared when the policy answers, so no timer outlives the ask. */
export async function askWithDeadline(policy: LinearWritePolicy, ask: LinearWriteAsk): Promise<LinearPolicyVerdict> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), LINEAR_POLICY_DEADLINE_MS); });
  try {
    const asked = new Promise<LinearWriteDecision>((resolve, reject) => {
      try { Promise.resolve(policy(ask)).then(resolve, reject); } catch (err) { reject(err); }
    });
    const answer = await Promise.race([asked, deadline]);
    if (answer === 'timeout') return UNAVAILABLE;
    return verdictOf(answer) ?? UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}
