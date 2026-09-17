// One truth table for the serviceability clause (routing spec §5.4), driven
// through BOTH spellings: `serviceability()` (shared/serviceability.ts) and
// ccd's `_serviceable` — the `POOL_RULE_CASES` idiom. Every row is a FILE
// LAYOUT (a limits row for the lane, a sweep pass) plus a class, so both sides
// read the same bytes and nothing here re-derives the rule.
//
// THE ONE IMPORT IS A TYPE, and it erases at compile time — so this file still
// re-derives nothing at RUNTIME while a class added to `CLASSES` becomes a
// compile error here rather than a row nobody wrote (Task 3's carried
// cannot-verify (c), the sibling of `fixtures/leastLoaded.ts`'s).
import type { ModelClass } from '../../../shared/models.js';

export interface ServiceabilityCase {
  name: string;
  cls: ModelClass | 'default';
  /** The lane under test — `claude` is Anthropic, `gpt` is codex in DEFAULT_TEST_ROSTER. */
  lane: 'claude' | 'gpt';
  /** `~/.cc-limits/<lane>.json` bytes, as a function of now; absent = no file. */
  limits?: (now: number) => string;
  /** The sweep pass: age in seconds and the lane's estimate (a fraction, or
   *  null, or ABSENT = no row for the lane); absent = no file at all. */
  sweep?: { ageS: number; estimate?: number | null };
  expect: 'skipped' | 'servable' | 'unservable' | 'unmeasured';
  /** The why-word both sides print/return on unservable and unmeasured. */
  why?: 'ceiling' | 'backend' | 'no-figure' | 'stale';
  /** The figure both sides agree on for servable/ceiling rows. */
  figurePct?: number;
}

const fresh = (five: number, seven: number) => (now: number): string =>
  JSON.stringify({ five, seven, ts: now, fiveResetAt: now + 10_000, sevenResetAt: now + 400_000 });
const rolled = (now: number): string =>
  JSON.stringify({ five: 10, seven: 50, ts: now - 700_000, fiveResetAt: now - 600_000, sevenResetAt: now - 100 });

export const SERVICEABILITY_CASES: readonly ServiceabilityCase[] = [
  { name: 'default is skipped whatever the lane says', cls: 'default', lane: 'claude', limits: fresh(99, 99), sweep: { ageS: 1, estimate: 0.99 }, expect: 'skipped' },
  { name: 'fable under the ceiling is servable with the figure', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'servable', figurePct: 39 },
  { name: 'fable AT the ceiling is unservable', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.40 }, expect: 'unservable', why: 'ceiling', figurePct: 40 },
  { name: 'fable rounds floor(x*100+0.5): 0.395 is 40, unservable', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.395 }, expect: 'unservable', why: 'ceiling', figurePct: 40 },
  { name: 'fable rounds floor(x*100+0.5): 0.394 is 39, servable', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.394 }, expect: 'servable', figurePct: 39 },
  // 0.395's product (38.499999999999996 for 38.5, or 39.5 rounding to 40 either
  // way) does NOT discriminate floor(x*100+0.5) from Python's round(): 39.5
  // rounds half-to-even to 40, which coincides with int(39.5+0.5)=40. 0.125 is
  // exactly representable (12.5 exactly), so round(12.5)=12 (half-to-even, 12
  // is the even neighbour) while floor(12.5+0.5)=13 — the row global constraint
  // 10 needs to keep the two-language rounding formula pinned rather than
  // merely stated in a comment.
  { name: 'fable rounds half UP, not half-to-even: 0.125 is 13', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.125 }, expect: 'servable', figurePct: 13 },
  { name: 'fable with no sweep file is unmeasured (no-figure)', cls: 'fable', lane: 'claude', limits: fresh(10, 10), expect: 'unmeasured', why: 'no-figure' },
  { name: 'fable with no row for the lane is unmeasured (no-figure)', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1 }, expect: 'unmeasured', why: 'no-figure' },
  { name: 'fable with a null estimate is unmeasured (no-figure)', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: null }, expect: 'unmeasured', why: 'no-figure' },
  { name: 'fable with a stale pass is unmeasured (stale), however low the estimate', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 28_801, estimate: 0.01 }, expect: 'unmeasured', why: 'stale' },
  { name: 'fable at exactly SHARE_FRESH_S is still fresh', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 28_800, estimate: 0.01 }, expect: 'servable', figurePct: 1 },
  { name: 'fable on a codex lane is unservable by backend before any figure', cls: 'fable', lane: 'gpt', limits: fresh(0, 0), sweep: { ageS: 1, estimate: 0 }, expect: 'unservable', why: 'backend' },
  { name: 'opus under the seven-day ceiling is servable', cls: 'opus', lane: 'claude', limits: fresh(50, 97), expect: 'servable', figurePct: 97 },
  { name: 'opus at the seven-day ceiling is unservable', cls: 'opus', lane: 'claude', limits: fresh(0, 98), expect: 'unservable', why: 'ceiling', figurePct: 98 },
  { name: 'sonnet with no limits file is unmeasured', cls: 'sonnet', lane: 'claude', expect: 'unmeasured', why: 'no-figure' },
  { name: 'haiku with a rolled-over seven-day window is unmeasured, not its inferred 0', cls: 'haiku', lane: 'claude', limits: rolled, expect: 'unmeasured', why: 'no-figure' },
  { name: 'opus on a codex lane reads its own seven-day figure (the backend refusal is fable only)', cls: 'opus', lane: 'gpt', limits: fresh(0, 12), expect: 'servable', figurePct: 12 },
];
