// The learned item height — the number virtuoso opens the chat with.
//
// Testable where the list itself is not: jsdom reports every rendered height as
// 0, so nothing here can measure a bubble. What it CAN do is hold the arithmetic
// and the storage contract, which is where this can go wrong quietly — a value
// that drifts out of band, or a browser that refuses storage, both end as a
// scrollbar that lies and neither raises anything.
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_ITEM_HEIGHT, HEIGHT_BUCKETS, MAX_ITEM_HEIGHT, MIN_ITEM_HEIGHT,
  clampHeight, meanSize, openingHeight, rememberHeights,
  rememberedHeight, rememberedHeights, type HeightBucket,
} from '../src/session/itemHeight';

const KEY = 'ccrc:chat-item-height';

/** A Storage that works, so the tests do not depend on jsdom's own. */
const fake = (seed?: string): Storage => {
  const m = new Map<string, string>();
  if (seed !== undefined) m.set(KEY, seed);
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, v); },
  } as Storage;
};

/** A Storage that refuses everything — a private window, or site data blocked. */
const hostile = (): Storage => ({
  get length(): number { throw new Error('denied'); },
  clear: () => { throw new Error('denied'); },
  getItem: () => { throw new Error('denied'); },
  key: () => { throw new Error('denied'); },
  removeItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
}) as Storage;

const KINDS_KEY = 'ccrc:chat-item-heights';

/** A Storage that already holds PER-BUCKET measurements. Distinct from `fake`,
 *  which seeds the OLD scalar: the scalar is a guess and a bucket's first real
 *  measurement is taken whole, so a test about blending has to start from a
 *  measurement. */
const measured = (px: Partial<Record<HeightBucket, number>>): Storage => {
  const s = fake();
  s.setItem(KINDS_KEY, JSON.stringify(px));
  return s;
};

/** ONE visit: it opens with whatever is stored, then saves. The blend is a
 *  property of the visit, so a test that wants two blends runs this twice. */
const visit = (s: Storage, px: number, bucket: HeightBucket = 'tool'): void =>
  rememberHeights(new Map([[bucket, px]]), rememberedHeights(s), s);

/** What a bucket is worth now, as a number — for the tests that only care
 *  about the arithmetic. */
const learnedPx = (s: Storage, bucket: HeightBucket = 'tool'): number | null =>
  rememberedHeights(s)[bucket];

describe('meanSize', () => {
  // Virtuoso reports 0 for an item it has not measured yet. Averaging those in
  // would drag the estimate toward zero on every fast scroll — which is the
  // lying scrollbar again, pointing the other way.
  it('averages only what was actually measured', () => {
    expect(meanSize([100, 0, 200, 0])).toBe(150);
  });

  it('says nothing rather than zero when nothing was measured', () => {
    expect(meanSize([])).toBeNull();
    expect(meanSize([0, 0])).toBeNull();
    expect(meanSize([Number.NaN, -5])).toBeNull();
  });
});

describe('the remembered height stays inside a sane band', () => {
  // One transcript of nothing but giant tables must not teach the list that
  // every row is 2000px; a run of one-line dividers must not teach it 12px.
  // Either way the NEXT visit opens with the same lie, pointing the other way.
  it('clamps both ends', () => {
    expect(clampHeight(5000)).toBe(MAX_ITEM_HEIGHT);
    expect(clampHeight(3)).toBe(MIN_ITEM_HEIGHT);
    expect(clampHeight(137.4)).toBe(137);
  });

  it('never stores a value outside the band, however extreme the sample', () => {
    const s = fake();
    visit(s, 99_999);
    expect(learnedPx(s)).toBeLessThanOrEqual(MAX_ITEM_HEIGHT);
    const t = fake();
    visit(t, 1);
    expect(learnedPx(t)).toBeGreaterThanOrEqual(MIN_ITEM_HEIGHT);
  });
});

describe('rememberedHeight', () => {
  it('falls back when this browser has measured nothing yet', () => {
    expect(rememberedHeight(fake())).toBe(FALLBACK_ITEM_HEIGHT);
  });

  it('returns what was learned', () => {
    expect(rememberedHeight(fake('240'))).toBe(240);
  });

  // Hand-edited, half-written, or left over from another build. A bad value is
  // not a reason to render badly.
  it('ignores a value that is not a usable number', () => {
    for (const junk of ['', 'abc', '0', '-30', 'NaN', 'Infinity']) {
      expect(rememberedHeight(fake(junk)), junk).toBe(FALLBACK_ITEM_HEIGHT);
    }
  });

  it('survives a browser that refuses storage outright', () => {
    expect(rememberedHeight(hostile())).toBe(FALLBACK_ITEM_HEIGHT);
    expect(() => visit(hostile(), 200)).not.toThrow();
  });
});

describe('a new visit nudges the estimate rather than seizing it', () => {
  // One atypical session — a long tool-only run, a single enormous report —
  // should move the number, not replace it. Otherwise the estimate oscillates
  // between session shapes and the scrollbar jumps on every other visit.
  it('blends towards the new sample', () => {
    const s = measured({ tool: 100 });
    visit(s, 200);
    expect(learnedPx(s)).toBeGreaterThan(100);
    expect(learnedPx(s)).toBeLessThan(200);
  });

  it('takes the first sample whole — there is nothing to blend with', () => {
    const s = fake();
    visit(s, 180);
    expect(learnedPx(s)).toBe(180);
  });

  // TWENTY-FIVE VISITS, not twenty-five saves. Saving repeatedly inside one
  // visit is now idempotent by design, which is what the residual needed; the
  // property being pinned here is the one that always mattered — that the
  // estimate settles on the shape the content actually has.
  it('converges rather than drifting, when the content keeps its shape', () => {
    const s = measured({ tool: 100 });
    for (let i = 0; i < 25; i++) visit(s, 200);
    expect(learnedPx(s)).toBeGreaterThan(195);
    expect(learnedPx(s)).toBeLessThanOrEqual(200);
  });

  it('refuses a sample that measured nothing', () => {
    const s = fake('150');
    visit(s, 0);
    visit(s, Number.NaN);
    expect(s.getItem(KINDS_KEY)).toBeNull();
    expect(learnedPx(s)).toBeNull();
    // And the render still has a number to use: the old scalar, as a guess.
    expect(openingHeight(['tool'], rememberedHeights(s), rememberedHeight(s))).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE RESIDUAL PR #191 LEFT, and what measurement said about it.
//
// The thumb still opened at the wrong size and corrected while scrolling. The
// cause was NOT that one number cannot describe a bimodal transcript — modelled
// against virtuoso's own total (`sum(measured) + unmeasured * default`), the
// RIGHT single number opens within 1% of truth and moves 1% across a full
// scroll, clustered transcript included. The cause is that the number is wrong
// at open, and it is wrong for two reasons, both measured:
//
//   1. ONE VISIT SEIZED IT. `rememberHeight` blends 30% toward the sample, but
//      the list saved every 25 new samples, so a 200-item visit blended eight
//      times and took 94% of the distance — the estimate tracked the LAST
//      session instead of the long run. Modelled over alternating session
//      shapes: 191% mean opening error, against 106% for one blend per visit.
//
//   2. ONE SCALAR CANNOT SERVE TWO SHAPES. Even blending once per visit, a
//      review session (mean 175px) and a debugging session (mean 73px) pull the
//      same number in opposite directions for ever: 56% mean opening error, and
//      it never converges. Per BUCKET, weighted by the composition THIS session
//      already knows at mount, the same sequence gives 19% and converges visit
//      by visit, because a row's height is a property of the row.
// ─────────────────────────────────────────────────────────────────────────────

describe('one visit moves the estimate once, however often it saves', () => {
  // The guarantee `rememberHeight`'s docstring claimed and the wiring did not
  // keep. Saving mid-visit is for the closed tab that runs no cleanup; it must
  // not also be a second, third and eighth vote.
  // THE BASELINE MUST BE LEARNED AND DIFFERENT FROM THE SAMPLE, or this pins
  // nothing: against an unlearned bucket the first sample is taken whole, and
  // every later save then blends 300 with 300 and lands on 300 whichever value
  // it blended FROM. Measured — the first version of this case passed against
  // a `rememberHeights` that blended from the stored value instead of the
  // baseline, which is the exact defect it exists to catch.
  it('ten saves in one visit land exactly where one save lands', () => {
    const many = measured({ tool: 100 });
    const once = measured({ tool: 100 });
    const baseline = rememberedHeights(many);
    const sample = new Map<HeightBucket, number>([['tool', 300]]);
    for (let i = 0; i < 10; i++) rememberHeights(sample, baseline, many);
    rememberHeights(sample, rememberedHeights(once), once);
    expect(learnedPx(many)).toBe(learnedPx(once));
    expect(learnedPx(many)).toBe(160); // 100 * 0.7 + 300 * 0.3, once
  });

  it('still moves toward the sample — idempotent is not inert', () => {
    const s = measured({ tool: 100 });
    const baseline = rememberedHeights(s);
    for (let i = 0; i < 10; i++) rememberHeights(new Map([['tool', 300]]), baseline, s);
    expect(learnedPx(s)).toBe(160);
  });
});

describe('the opening height is THIS session, not an average of all sessions', () => {
  const learned = (px: Partial<Record<HeightBucket, number>>): Record<HeightBucket, number | null> => {
    const base = {} as Record<HeightBucket, number | null>;
    for (const b of HEIGHT_BUCKETS) base[b] = FALLBACK_ITEM_HEIGHT;
    return { ...base, ...px };
  };

  it('weights the learned heights by the composition the list already holds', () => {
    const l = learned({ tool: 60, assistant: 300 });
    const toolHeavy = [...Array(9).fill('tool'), 'assistant'] as HeightBucket[];
    const answerHeavy = [...Array(9).fill('assistant'), 'tool'] as HeightBucket[];
    expect(openingHeight(toolHeavy, l)).toBe(84);   // (9*60 + 300) / 10
    expect(openingHeight(answerHeavy, l)).toBe(276); // (9*300 + 60) / 10
  });

  it('falls back when the session is empty — there is no composition to weigh', () => {
    expect(openingHeight([], learned({}))).toBe(FALLBACK_ITEM_HEIGHT);
  });

  it('stays inside the band whatever the mixture claims', () => {
    const l = learned({ assistant: MAX_ITEM_HEIGHT });
    expect(openingHeight(['assistant'], l)).toBeLessThanOrEqual(MAX_ITEM_HEIGHT);
    expect(openingHeight(['divider'], learned({ divider: 1 }))).toBeGreaterThanOrEqual(MIN_ITEM_HEIGHT);
  });
});

describe('a browser that learned the old single number is not reset by the upgrade', () => {
  // THE SCALAR IS A GUESS, NOT A MEASUREMENT of any bucket — it is the mean of
  // a mixture. Seeding it INTO the buckets was measured as the reason the fix
  // looked inert: from a scalar of 240, a session whose true mean is 80 still
  // opened at 192 on its second visit and needed five or six more to arrive.
  // So it is substituted at the render and never stored, and a bucket's first
  // real measurement is taken whole.
  it('uses the scalar to RENDER, and stores nothing in its name', () => {
    const s = fake('140');
    for (const b of HEIGHT_BUCKETS) expect(rememberedHeights(s)[b]).toBeNull();
    expect(openingHeight(['tool', 'assistant'], rememberedHeights(s), rememberedHeight(s))).toBe(140);
  });

  it('a first real measurement replaces the guess outright, not by 30% of it', () => {
    const s = fake('240');
    visit(s, 80);
    expect(learnedPx(s)).toBe(80);
  });

  // NOT the fallback: "never learned" and "learned 96" are two conditions and
  // `rememberHeights` answers them differently — the first takes its sample
  // whole. Folding them into one number here would be the overloaded null the
  // ring rules forbid at a seam, and the caller that renders substitutes the
  // fallback itself.
  it('says NOTHING LEARNED rather than the fallback, when it had nothing', () => {
    const s = fake();
    for (const b of HEIGHT_BUCKETS) expect(rememberedHeights(s)[b]).toBeNull();
    expect(openingHeight(['tool'], rememberedHeights(s))).toBe(FALLBACK_ITEM_HEIGHT);
  });

  it('a bucket nobody sampled stays unmeasured, and still renders', () => {
    const s = fake('140');
    visit(s, 300);
    expect(rememberedHeights(s).assistant).toBeNull();
    expect(learnedPx(s)).toBe(300); // first measurement, taken whole
    expect(openingHeight(['assistant'], rememberedHeights(s), rememberedHeight(s))).toBe(140);
  });

  it('survives a browser that refuses storage outright', () => {
    expect(() => visit(hostile(), 300)).not.toThrow();
    for (const b of HEIGHT_BUCKETS) expect(rememberedHeights(hostile())[b]).toBeNull();
    expect(openingHeight(['tool', 'assistant'], rememberedHeights(hostile()))).toBe(FALLBACK_ITEM_HEIGHT);
  });
});
