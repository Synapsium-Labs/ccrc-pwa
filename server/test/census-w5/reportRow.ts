// The REPORT shape of a W5 census's REAL row whose fact is not yet at target (D-7071; Task C5d; plan
// 2026-10-27-consolidation-w5-ccd-helpers.md; spec §5.1 rule 3, "a pin lands in the commit that reaches its count").
// `accountMarkers.test.ts` (C5a) set the precedent: such a row prints its sites and holds only what is true at every step
// of the series, so the task that moves the count (C5e to C5j) does not red a pin its Files never listed, and lands its
// exact, may-only-shrink pin in its own ratchet commit. What it holds, so the row still cannot go blind or gain a site under another name:
//   - every name is a site measured at the base, or the name the plan's ratchet for that count names;
//   - each site appears once, so the count is at most the base sites and the target together. It is NOT held to the base
//     count: a green step adds the target beside the base sites before the move commits retire them (C5g Step 3 puts
//     the runner beside the four wrappers, 5; C5j Step 3 adds `recordCcdVerbs` before the callers move, 4);
//   - the count is at least `min` (1 where the target keeps a site, so a query that stops matching goes red; 0 where the
//     target is none, and the FIXTURE rows hold the query).
import { expect } from 'vitest';

export function expectReportRow(
  what: string, got: readonly string[], base: readonly string[], target: readonly string[], min: number,
): void {
  const allowed = new Set([...base, ...target]);
  expect(got.filter((n) => !allowed.has(n)), `${what}: names that are neither a base site nor the plan's target`).toEqual([]);
  expect(new Set(got).size, `${what}: each site once`).toBe(got.length);
  expect(got.length, `${what}: the query still finds a site`).toBeGreaterThanOrEqual(min);
}
