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
  cls: ModelClass | 'default' | '';
  /** The lane under test — `claude` is Anthropic, `gpt` is codex in DEFAULT_TEST_ROSTER. */
  lane: 'claude' | 'gpt';
  /** `~/.cc-limits/<lane>.json` bytes, as a function of now; absent = no file. */
  limits?: (now: number) => string;
  /** The sweep pass: age in seconds and the lane's estimate (a fraction, or
   *  null, or ABSENT = no row for the lane); absent = no file at all. */
  sweep?: { ageS: number; estimate?: number | null };
  expect: 'skipped' | 'servable' | 'unservable' | 'unmeasured';
  /** The why-word both sides print/return on unservable and unmeasured. */
  why?: 'ceiling' | 'backend' | 'no-figure' | 'stale'
    | 'credits' | 'billing-unset' | 'billing-unread' | 'no-continuity' | 'continuity-unread';
  /** Whose question (plan question 5). Absent = `other`, so every row written before the Overlord's arms is unedited.
   *  `set-side` writes the asking session's `poolset` entry; `other` writes none. */
  asking?: 'set-side' | 'other';
  /** For `set-side`: how the session's set reads. Absent = a valid set; the two others are the undecidable words. */
  side?: 'set' | 'set-malformed' | 'set-unreadable';
  /** The lane's two roster facts, spelled out. `continuity` is the record's `recordedAt` (absent = no record);
   *  `projection: 'old'` is an `accounts.sh` that predates both facts, `'old-billing'` one that predates the billing fact alone (the bash arms read `unread`). */
  facts?: { fableBilling?: 'included' | 'credits'; continuity?: number; projection?: 'old' | 'old-billing' };
  /** The figure both sides agree on for servable/ceiling rows. */
  figurePct?: number;
}

/** The statusline's row for a payload with no 5h figure. */
const fiveNull = (seven: number) => (now: number): string =>
  JSON.stringify({ five: null, seven, ts: now, fiveResetAt: null, sevenResetAt: now + 400_000 });
const fresh = (five: number, seven: number) => (now: number): string =>
  JSON.stringify({ five, seven, ts: now, fiveResetAt: now + 10_000, sevenResetAt: now + 400_000 });
const rolled = (now: number): string =>
  JSON.stringify({ five: 10, seven: 50, ts: now - 700_000, fiveResetAt: now - 600_000, sevenResetAt: now - 100 });

/** A continuity record's `recordedAt`, in the past of every case. */
const REC = 1_790_000_000;

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
  { name: 'opus reads the weekly figure of a row whose 5h figure is unknown', cls: 'opus', lane: 'claude', limits: fiveNull(40), expect: 'servable', figurePct: 40 },
  { name: 'opus at the seven-day ceiling is unservable on a row whose 5h figure is unknown', cls: 'opus', lane: 'claude', limits: fiveNull(98), expect: 'unservable', why: 'ceiling', figurePct: 98 },
  { name: 'sonnet with no limits file is unmeasured', cls: 'sonnet', lane: 'claude', expect: 'unmeasured', why: 'no-figure' },
  { name: 'haiku with a rolled-over seven-day window is unmeasured, not its inferred 0', cls: 'haiku', lane: 'claude', limits: rolled, expect: 'unmeasured', why: 'no-figure' },
  { name: 'opus on a codex lane reads its own seven-day figure (the backend refusal is fable only)', cls: 'opus', lane: 'gpt', limits: fresh(0, 12), expect: 'servable', figurePct: 12 },

  // THE OVERLORD'S ARMS (serviceability plan Task 2): a `set-side` asker only. Every fact is spelled out (F5).
  { name: 'set-side fable, included billing, recorded, share 39: servable', cls: 'fable', lane: 'claude', asking: 'set-side', facts: { fableBilling: 'included', continuity: REC }, limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'servable', figurePct: 39 },
  { name: 'set-side fable, credits billing, recorded, share 39: credits', cls: 'fable', lane: 'claude', asking: 'set-side', facts: { fableBilling: 'credits', continuity: REC }, limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'unservable', why: 'credits' },
  { name: 'set-side fable, no billing fact, recorded: billing-unset', cls: 'fable', lane: 'claude', asking: 'set-side', facts: { continuity: REC }, limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'unservable', why: 'billing-unset' },
  { name: 'set-side fable, a projection without the billing function, recorded: billing-unread', cls: 'fable', lane: 'claude', asking: 'set-side', facts: { projection: 'old-billing', continuity: REC }, limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'unservable', why: 'billing-unread' },
  { name: 'set-side opus, credits billing, recorded, seven 50: servable (billing is Fable\'s alone)', cls: 'opus', lane: 'claude', asking: 'set-side', facts: { fableBilling: 'credits', continuity: REC }, limits: fresh(10, 50), expect: 'servable', figurePct: 50 },
  { name: 'set-side opus, included billing, no record: no-continuity', cls: 'opus', lane: 'claude', asking: 'set-side', facts: { fableBilling: 'included' }, limits: fresh(10, 50), expect: 'unservable', why: 'no-continuity' },
  { name: 'set-side fable, included billing, no record: no-continuity (before the figure)', cls: 'fable', lane: 'claude', asking: 'set-side', facts: { fableBilling: 'included' }, limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'unservable', why: 'no-continuity' },
  { name: 'set-side opus, an old projection: continuity-unread', cls: 'opus', lane: 'claude', asking: 'set-side', facts: { projection: 'old' }, limits: fresh(10, 50), expect: 'unservable', why: 'continuity-unread' },
  { name: 'set-side fable, an old projection: continuity-unread', cls: 'fable', lane: 'claude', asking: 'set-side', facts: { projection: 'old' }, limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'unservable', why: 'continuity-unread' },
  { name: 'set-side default, no record: no-continuity (F8: before the default fold)', cls: 'default', lane: 'claude', asking: 'set-side', facts: { fableBilling: 'included' }, expect: 'unservable', why: 'no-continuity' },
  { name: 'set-side empty class, no record: no-continuity (F8)', cls: '', lane: 'claude', asking: 'set-side', facts: { fableBilling: 'included' }, expect: 'unservable', why: 'no-continuity' },
  { name: 'set-side default, recorded: skipped', cls: 'default', lane: 'claude', asking: 'set-side', facts: { continuity: REC }, expect: 'skipped' },
  { name: 'set-side empty class, recorded: skipped', cls: '', lane: 'claude', asking: 'set-side', facts: { continuity: REC }, expect: 'skipped' },
  { name: 'set-malformed side fable, credits billing, recorded: credits (the strict arms)', cls: 'fable', lane: 'claude', asking: 'set-side', side: 'set-malformed', facts: { fableBilling: 'credits', continuity: REC }, limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'unservable', why: 'credits' },
  { name: 'set-unreadable side fable, credits billing, recorded: credits (the strict arms)', cls: 'fable', lane: 'claude', asking: 'set-side', side: 'set-unreadable', facts: { fableBilling: 'credits', continuity: REC }, limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'unservable', why: 'credits' },
  { name: 'other fable, credits billing, no record, share 39: servable (unchanged for everyone else)', cls: 'fable', lane: 'claude', asking: 'other', facts: { fableBilling: 'credits' }, limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'servable', figurePct: 39 },
  { name: 'set-side fable on a codex lane, credits billing, recorded: backend (before billing)', cls: 'fable', lane: 'gpt', asking: 'set-side', facts: { fableBilling: 'credits', continuity: REC }, limits: fresh(0, 0), sweep: { ageS: 1, estimate: 0 }, expect: 'unservable', why: 'backend' },
];
