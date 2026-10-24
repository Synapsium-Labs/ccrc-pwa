// D-6795: the pure half of the review-round cap (`coord/reviewcap.ts`).
//
// MUTATION ROWS (each measured red on the case(s) named, then restored; `run-routes.test.ts` "review-round cap"):
//   `rounds >= CAP` -> `rounds > CAP` ............ the 4th opens: refused case + the pure row at 3
//   drop the `!lifted` arm ...................... the lifted case and the pure "lifted run" row
//   CAP 3 -> 4 .................................. the constant row and the 4th-refused case
//   raise the ask on every refusal .............. "raised exactly once" (second refusal adds a notice)
//   count only `planned` review runs ............ rounds 1-3 case (the failed rounds are not counted)
//   delete the store's guard .................... both the refusal case and the lifted case (never refuses)
//   `reviewCapLifted` always false .............. the lifted case (the 4th stays refused)
import { describe, it, expect } from 'vitest';
import { REVIEW_ROUND_CAP, reviewCapAsk, reviewCapNotice, reviewCapRefuses } from '../src/coord/reviewcap.js';

describe('reviewCapRefuses', () => {
  it('the cap is 3', () => { expect(REVIEW_ROUND_CAP).toBe(3); });
  it.each([[0, false], [1, false], [2, false], [3, true], [4, true]])('%i rounds, not lifted -> refuses %s', (n, want) => {
    expect(reviewCapRefuses(n, false)).toBe(want);
  });
  it('a lifted run is never refused', () => { expect(reviewCapRefuses(7, true)).toBe(false); });
});

describe('reviewCapNotice', () => {
  const none = { reviewRunId: null, summary: null, report: null };
  it('names the run, its rounds and the last review', () => {
    const n = reviewCapNotice(reviewCapAsk(12, 3, { reviewRunId: 15, summary: '2 findings', report: '/r.md' }));
    expect(n.title).toBe('Review cap reached on run 12');
    expect(n.body).toContain('3 review rounds (cap 3)');
    expect(n.body).toContain('Last review (run 15): 2 findings');
    expect(n.body).toContain('Report: /r.md');
  });
  it('says so when no review has reported', () => {
    expect(reviewCapNotice(reviewCapAsk(12, 3, none)).body).toContain('No review has reported yet.');
  });
});
