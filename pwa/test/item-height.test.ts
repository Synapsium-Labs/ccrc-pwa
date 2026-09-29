// The learned row model — what the chat list believes a row costs before it has
// measured one.
//
// Testable where the list itself is not: jsdom reports every rendered height as
// 0, so nothing here can measure a bubble. What it CAN do is hold the
// arithmetic and the storage contract, which is where this goes wrong quietly —
// a model that drifts out of band, or a browser that refuses storage, both end
// as a scrollbar that lies and neither raises anything.
//
// THE PIXELS THEMSELVES were measured in a real browser against four live
// sessions (2026-09-28, headless Chromium on the fleet box). Trained on one
// session and asked about another it had never seen, a per-bucket MEAN missed
// the list's total by 24% on average and each row by 85-321px; the model this
// file pins missed by 5% and 9-35px, and improved all twelve train/test pairs.
// Those numbers are why the model is a LINE and not a number. They cannot be
// re-derived here — jsdom has no layout — so they are recorded, not asserted.
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_ITEM_HEIGHT, HEIGHT_BUCKETS, MAX_PX_PER_LINE, MAX_ROW_PX,
  MIN_ROW_PX, NOMINAL_MEASURE, TABLE_ROW_LINES, WELL_LINES,
  estimateRow, fitRowModel, nominalLines, openingHeight, rememberModels,
  rememberedHeight, rememberedModels, rowHeights,
  type HeightBucket, type RowModel, type RowSample,
} from '../src/session/itemHeight';

const KEY = 'ccrc:chat-item-height';
const KINDS_KEY = 'ccrc:chat-item-heights';

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

/** A Storage already holding learned MODELS. */
const learned = (m: Partial<Record<HeightBucket, RowModel | number>>): Storage => {
  const s = fake();
  s.setItem(KINDS_KEY, JSON.stringify(m));
  return s;
};

/** ONE visit: it opens with whatever is stored, then saves. The blend is a
 *  property of the visit, so a test that wants two blends runs this twice. */
const visit = (
  s: Storage,
  samples: Partial<Record<HeightBucket, RowSample[]>>,
): void => {
  const map = new Map<HeightBucket, RowSample[]>(
    Object.entries(samples) as [HeightBucket, RowSample[]][],
  );
  rememberModels(map, rememberedModels(s), s);
};

const modelOf = (s: Storage, b: HeightBucket = 'tool'): RowModel | null =>
  rememberedModels(s)[b];

/** Rows on an exact line, for the tests that check the fit recovers it. */
const onLine = (a: number, b: number, xs: number[]): RowSample[] =>
  xs.map((lines) => ({ lines, px: a + b * lines }));

describe('nominalLines — the predictor the model is a line in', () => {
  it('counts a short line as one, however short', () => {
    expect(nominalLines('ok')).toBe(1);
    expect(nominalLines('a\nb\nc')).toBe(3);
  });

  it('wraps a long line by the nominal measure', () => {
    expect(nominalLines('x'.repeat(NOMINAL_MEASURE))).toBe(1);
    expect(nominalLines('x'.repeat(NOMINAL_MEASURE + 1))).toBe(2);
    expect(nominalLines('x'.repeat(NOMINAL_MEASURE * 3))).toBe(3);
  });

  it('does not WRAP a table row however wide — the table scrolls sideways', () => {
    const row = `| ${'c'.repeat(400)} |`;
    expect(nominalLines(row)).toBe(TABLE_ROW_LINES);
    // and the same text outside a table does not get that exemption
    expect(nominalLines(row.slice(2))).toBeGreaterThan(5);
  });

  it('counts a table row as TALLER than a line of prose, by what the tokens say', () => {
    // A cell is --text-sm at --leading-normal with --sp-2 above and below:
    // (13 * 1.5 + 8 + 8) / (15 * 1.5). Counting it as one line under-measured
    // a table-heavy session by 15% in a browser.
    expect(TABLE_ROW_LINES).toBeCloseTo((13 * 1.5 + 8 + 8) / (15 * 1.5), 2);
    expect(nominalLines('| a | b |\n| c | d |')).toBeCloseTo(2 * TABLE_ROW_LINES, 6);
  });

  it('saturates a fenced block, because `pre` caps at --well-max and scrolls', () => {
    const body = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const fenced = '```js\n' + body + '\n```';
    // the two fence lines are real; the body is capped
    expect(nominalLines(fenced)).toBe(2 + WELL_LINES);
    // …and without the fence the same body is 200 lines
    expect(nominalLines(body)).toBe(200);
  });

  it('saturates a fence nobody closed — a streaming turn is cut mid-block', () => {
    const open = '```\n' + Array.from({ length: 80 }, () => 'x').join('\n');
    expect(nominalLines(open)).toBe(1 + WELL_LINES);
  });

  it('is never negative and answers zero for nothing', () => {
    expect(nominalLines('')).toBe(0);
  });
});

describe('fitRowModel — learning the line from measured rows', () => {
  it('recovers the line its samples lie on', () => {
    const m = fitRowModel(onLine(40, 18, [1, 5, 20, 60]), null);
    expect(m?.a).toBeCloseTo(40, 6);
    expect(m?.b).toBeCloseTo(18, 6);
  });

  it('learns a slope of ZERO for a row whose height does not follow its text', () => {
    // every tool card measured 62px in a real browser, across 18 cards whose
    // inputs ranged from 45 to 5696 characters.
    const m = fitRowModel([1, 9, 40, 300].map((lines) => ({ lines, px: 62 })), null);
    expect(m?.b).toBe(0);
    expect(m?.a).toBeCloseTo(62, 6);
  });

  it('KEEPS a slope it cannot re-measure, and re-seats only the intercept', () => {
    // A visit whose rows are all the same length says nothing about the slope.
    // Discarding what an earlier visit measured would be treating silence as
    // evidence, and it is how one thin session used to wipe a good model.
    const prior: RowModel = { a: 40, b: 18 };
    const m = fitRowModel([{ lines: 10, px: 400 }, { lines: 10, px: 400 }], prior);
    expect(m?.b).toBe(18);
    expect(m?.a).toBe(400 - 18 * 10);
  });

  it('refuses a slope from too few rows even when they do differ', () => {
    const m = fitRowModel([{ lines: 1, px: 50 }, { lines: 50, px: 900 }], { a: 0, b: 7 });
    expect(m?.b).toBe(7);
  });

  it('ignores a row virtuoso has not measured — it reports those as zero', () => {
    const m = fitRowModel(
      [...onLine(40, 18, [1, 5, 20, 60]), { lines: 999, px: 0 }],
      null,
    );
    expect(m?.b).toBeCloseTo(18, 6);
  });

  it('answers null when nothing in the batch was measurable', () => {
    expect(fitRowModel([{ lines: 5, px: 0 }, { lines: 7, px: -3 }], null)).toBeNull();
    expect(fitRowModel([], { a: 1, b: 1 })).toBeNull();
  });

  it('refits through the ORIGIN rather than clamping a negative intercept', () => {
    // Rows that bend upward: the free fit wants an intercept BELOW zero, so
    // the two treatments actually differ and this case can tell them apart.
    // Clamping `a` to zero while keeping the slope computed for a negative one
    // leaves a line that misses its own data, every row, for ever; the
    // constrained answer is least squares through the origin, b = Sxy / Sxx.
    const rows = [{ lines: 1, px: 5 }, { lines: 10, px: 200 }, { lines: 40, px: 900 }];
    const m = fitRowModel(rows, null);
    expect(m?.a).toBe(0);
    expect(m?.b).toBeCloseTo(38005 / 1701, 6);   // 22.34, not the free 23.05
    // …and on points that DO pass through the origin it is still the line.
    const exact = fitRowModel(onLine(0, 20, [1, 5, 20, 60]), null);
    expect(exact?.b).toBeCloseTo(20, 6);
    expect(estimateRow(exact, 20, 96)).toBe(400);
  });

  it('never learns that more text makes a row SHORTER', () => {
    const m = fitRowModel(onLine(900, -8, [1, 10, 40, 80]), null);
    expect(m?.b).toBe(0);
  });

  it('holds the slope and the intercept inside their bands', () => {
    const steep = fitRowModel(onLine(0, 10_000, [1, 2, 3, 4]), null);
    expect(steep?.b).toBe(MAX_PX_PER_LINE);
    const tall = fitRowModel([1, 2, 3, 4].map((lines) => ({ lines, px: 99_999 })), null);
    expect(tall?.a).toBeLessThanOrEqual(MAX_ROW_PX);
  });
});

describe('estimateRow — what one row is believed to cost', () => {
  const models = { assistant: { a: 40, b: 18 } } as Record<HeightBucket, RowModel | null>;

  it('prices a row by its own text', () => {
    expect(estimateRow(models.assistant, 10, 96)).toBe(220);
    expect(estimateRow(models.assistant, 60, 96)).toBe(1120);
  });

  it('hands an unlearned bucket the caller GUESS, and never stores it', () => {
    expect(estimateRow(null, 60, 137)).toBe(137);
  });

  it('does NOT trim a long turn — the ceiling is for nonsense, not for tall rows', () => {
    // Measured in a browser: one assistant turn of 396 nominal lines really
    // rendered 7728px. With `a=10.6, b=18.4` the model asks for 7291px, a 6%
    // miss; a 4000px ceiling turned that into a 34% one and was the whole of
    // the residual error on that session.
    expect(estimateRow({ a: 10.58, b: 18.38 }, 396, 96)).toBeGreaterThan(7000);
  });

  it('keeps every estimate inside the row band', () => {
    expect(estimateRow({ a: 0, b: 0 }, 0, 96)).toBe(MIN_ROW_PX);
    expect(estimateRow({ a: 600, b: 200 }, 10_000, 96)).toBe(MAX_ROW_PX);
  });
});

describe('openingHeight — the ONE number virtuoso opens with', () => {
  it('is the mean of what the rows are each believed to cost', () => {
    const models = {
      tool: { a: 62, b: 0 }, assistant: { a: 40, b: 18 },
    } as Record<HeightBucket, RowModel | null>;
    const rows = [
      ...Array.from({ length: 3 }, () => ({ bucket: 'tool' as const, lines: 5 })),
      { bucket: 'assistant' as const, lines: 60 },
    ];
    // (62 + 62 + 62 + 1120) / 4
    expect(openingHeight(rows, models, 96)).toBe(327);
    expect(rowHeights(rows, models, 96)).toEqual([62, 62, 62, 1120]);
  });

  it('answers the fallback for a transcript with no rows at all', () => {
    expect(openingHeight([], {} as Record<HeightBucket, RowModel | null>, 210))
      .toBe(FALLBACK_ITEM_HEIGHT);
  });
});

describe('the storage contract', () => {
  it('reads what an OLDER build left — a bare number is an intercept, no slope', () => {
    const s = learned({ tool: 64, assistant: 557 });
    expect(modelOf(s, 'tool')).toEqual({ a: 64, b: 0 });
    expect(modelOf(s, 'assistant')).toEqual({ a: 557, b: 0 });
    // …so the first visit after the upgrade prices rows exactly as before,
    // and the slope is learned from that visit's own measurements.
  });

  it('answers null for every bucket when storage refuses, and never throws', () => {
    const models = rememberedModels(hostile());
    for (const b of HEIGHT_BUCKETS) expect(models[b]).toBeNull();
    expect(() => visit(hostile(), { tool: [{ lines: 1, px: 62 }] })).not.toThrow();
    expect(rememberedHeight(hostile())).toBe(FALLBACK_ITEM_HEIGHT);
  });

  it('survives a corrupted record rather than rendering badly', () => {
    const s = fake(); s.setItem(KINDS_KEY, '{not json');
    for (const b of HEIGHT_BUCKETS) expect(rememberedModels(s)[b]).toBeNull();
  });

  it('leaves a bucket nobody sampled exactly as it was — silence is not evidence', () => {
    const s = learned({ tool: { a: 62, b: 0 }, assistant: { a: 40, b: 18 } });
    visit(s, { tool: onLine(70, 0, [1, 2, 3, 4]) });
    expect(modelOf(s, 'assistant')).toEqual({ a: 40, b: 18 });
  });

  it('writes NOTHING when a save accepted no sample', () => {
    const s = fake();
    visit(s, { tool: [{ lines: 3, px: 0 }] });
    expect(s.getItem(KINDS_KEY)).toBeNull();
  });
});

describe('the blend — one session nudges the model, it never seizes it', () => {
  it('takes a bucket nobody had measured WHOLE', () => {
    const s = fake('240');           // an old scalar is a guess, not a measurement
    visit(s, { assistant: onLine(40, 18, [1, 5, 20, 60]) });
    expect(modelOf(s, 'assistant')?.a).toBeCloseTo(40, 4);
    expect(modelOf(s, 'assistant')?.b).toBeCloseTo(18, 4);
  });

  it('moves a learned model 30% of the way, not all of it', () => {
    const s = learned({ assistant: { a: 40, b: 10 } });
    visit(s, { assistant: onLine(40, 20, [1, 5, 20, 60]) });
    expect(modelOf(s, 'assistant')?.b).toBeCloseTo(10 * 0.7 + 20 * 0.3, 4);
  });

  it('is IDEMPOTENT: saving twice inside one visit lands where saving once does', () => {
    // The list saves as it goes, for the tab that is closed without cleanup.
    // Blending from the value the VISIT opened with is what stops that from
    // being a second vote — measured before this rule: a 200-item visit saved
    // eight times and moved 94% of the way instead of 30%.
    const once = learned({ assistant: { a: 40, b: 10 } });
    const twice = learned({ assistant: { a: 40, b: 10 } });
    const base = rememberedModels(twice);
    const samples = new Map<HeightBucket, RowSample[]>([['assistant', onLine(40, 20, [1, 5, 20, 60])]]);
    visit(once, { assistant: onLine(40, 20, [1, 5, 20, 60]) });
    rememberModels(samples, base, twice);
    rememberModels(samples, base, twice);
    rememberModels(samples, base, twice);
    expect(modelOf(twice, 'assistant')).toEqual(modelOf(once, 'assistant'));
  });
});

describe('the whole point, in arithmetic', () => {
  // The shape of the session this was measured on: 18 tool cards at a flat
  // 62px, 8 assistant turns whose real heights ran 40px to 1413px, and the
  // list's true total was 7204px.
  const session = [
    ...Array.from({ length: 18 }, () => ({ bucket: 'tool' as const, lines: 4 })),
    ...[1, 2, 6, 14, 22, 35, 48, 74].map((lines) => ({ bucket: 'assistant' as const, lines })),
  ];

  it('a SECOND visit opens near the truth, where one number per bucket could not', () => {
    const s = fake();
    // visit one measures the rows; assistant really is 40 + 18.6/line here
    visit(s, {
      tool: Array.from({ length: 18 }, (_, i) => ({ lines: 4 + i, px: 62 })),
      assistant: onLine(40, 18.6, [1, 2, 6, 14, 22, 35, 48, 74]),
    });
    const models = rememberedModels(s);
    const truth = session.reduce(
      (sum, r) => sum + (r.bucket === 'tool' ? 62 : 40 + 18.6 * r.lines), 0);
    const believed = openingHeight(session, models, rememberedHeight(s)) * session.length;
    expect(Math.abs(believed - truth) / truth).toBeLessThan(0.02);
  });
});
