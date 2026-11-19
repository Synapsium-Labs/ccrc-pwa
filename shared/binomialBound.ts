// Overlord W2, the decision model's line admission (spec 2026-11-09 §3.7 H6; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 8, question 17). Ring: L0, shared kernel K: pure
// arithmetic, and it imports nothing, not even types.
//
// THE ONE-SIDED 95% CLOPPER-PEARSON UPPER BOUND on an error rate, exact: the `p` at which the chance of seeing `errors` or
// fewer errors in `n` cases is 5%. The chance falls as `p` rises, so a bisection over the binomial CDF finds it. The sum is
// kept in logs, so a large `n` does not underflow to a CDF of 0 at a `p` where the mass sits far from 0 errors.

/** The one-sided level: 95% confidence leaves 5% in the one tail. */
const TAIL = 0.05;
/** Halvings of [0, 1]: 2^-60 is about 9e-19, far below the 1e-9 a caller needs. */
const HALVINGS = 60;

/** P(X <= k) for X ~ Binomial(n, p), 0 < p < 1, summed in logs. */
function binomialCdf(k: number, n: number, p: number): number {
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  let term = n * lq;            // log P(X = 0)
  let max = term;
  const logs: number[] = [term];
  for (let i = 0; i < k; i++) {
    term += Math.log((n - i) / (i + 1)) + lp - lq;
    logs.push(term);
    if (term > max) max = term;
  }
  let sum = 0;
  for (const t of logs) sum += Math.exp(t - max);
  return Math.exp(max) * sum;
}

/** The one-sided 95% Clopper-Pearson upper bound on the error rate after `errors` errors in `n` cases. No cases, or every
 *  case an error, answers 1. A negative or non-integer argument throws: it is a caller's bug. */
export function upperBound95(errors: number, n: number): number {
  if (!Number.isInteger(errors) || !Number.isInteger(n) || errors < 0 || n < 0) {
    throw new Error(`upperBound95: errors and n are non-negative integers, got ${errors} and ${n}`);
  }
  if (n === 0 || errors >= n) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < HALVINGS; i++) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(errors, n, mid) > TAIL) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
