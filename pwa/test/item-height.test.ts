// The learned row model — what the chat list believes a row costs before it has
// measured one.
//
// Testable where the list itself is not: jsdom reports every rendered height as
// 0, so nothing here can measure a bubble. What it CAN hold is the arithmetic
// and the storage contract, which is where this goes wrong quietly — a model
// bent by one odd row, a guess stored as if it were learned, a browser that
// refuses storage — and every one of those ends as a scrollbar that lies
// without raising anything.
//
// THE PIXELS THEMSELVES were measured in headless Chromium with the real
// react-virtuoso. They cannot be re-derived here — jsdom has no layout — so
// they are recorded in the PR description, not asserted.
import { afterEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_ITEM_HEIGHT, HEIGHT_BUCKETS, MAX_PX_PER_LINE, MAX_ROW_PX, MIN_FIT_ROWS,
  MIN_ROW_PX, NOMINAL_MEASURE, RESERVOIR_ROWS, ROWS_KEY, TABLE_ROW_LINES,
  THUMB_ROW_PX, VISIT_ROWS, WELL_LINES,
  estimateRow, estimateShape, fitRowModel, modelsOf, nominalLines, openingHeight,
  plainLines, rememberRows, rememberedRows, rowHeights, rowId, wellLines,
  type HeightBucket, type MeasuredRow, type RowModel, type RowModels, type RowRecord, type RowSample,
} from '../src/session/itemHeight';

/** A Storage that works, so the tests do not depend on jsdom's own. */
const fake = (): Storage => {
  const m = new Map<string, string>();
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

/** ONE visit: it opens with whatever is stored, then saves what it measured. */
const visit = (s: Storage, samples: Partial<Record<HeightBucket, MeasuredRow[]>>): void => {
  rememberRows(new Map(Object.entries(samples) as [HeightBucket, MeasuredRow[]][]), rememberedRows(s), s);
};

const modelOf = (s: Storage, b: HeightBucket): RowModel | null => modelsOf(rememberedRows(s))[b];

/** Every row a test measures is a DIFFERENT row unless the test says otherwise:
 *  each gets an identity of its own. */
let nextId = 0;
const fresh = (rows: RowSample[]): MeasuredRow[] => rows.map((r) => ({ ...r, id: (nextId += 1) }));

/** Rows on an exact line, for the tests that check the fit recovers it. */
const onLine = (a: number, b: number, xs: number[]): MeasuredRow[] =>
  fresh(xs.map((lines) => ({ lines, px: a + b * lines })));

/** What was measured, without who it was. */
const bare = (rows: readonly RowSample[]): RowSample[] => rows.map(({ lines, px }) => ({ lines, px }));

const none = (): RowModels => modelsOf(rememberedRows(fake()));

describe('nominalLines — the predictor for a row drawn as Markdown', () => {
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
    expect(nominalLines(row.slice(2))).toBeGreaterThan(5);
  });

  it('counts a table row as TALLER than a line of prose, by what the tokens say', () => {
    // A cell is --text-sm at --leading-normal with --sp-2 above and below.
    expect(TABLE_ROW_LINES).toBeCloseTo((13 * 1.5 + 8 + 8) / (15 * 1.5), 2);
    expect(nominalLines('| a | b |\n| c | d |')).toBeCloseTo(2 * TABLE_ROW_LINES, 6);
  });

  it('saturates a fenced block, because `pre` caps at --well-max and scrolls', () => {
    const body = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    expect(nominalLines('```js\n' + body + '\n```')).toBe(2 + WELL_LINES);
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

describe('plainLines and wellLines — the predictors for text drawn as it is', () => {
  it('a pre-wrap bubble wraps long lines and saturates NOTHING', () => {
    expect(plainLines('')).toBe(0);
    expect(plainLines('ok\nfine')).toBe(2);
    expect(plainLines('x'.repeat(NOMINAL_MEASURE * 2 + 1))).toBe(3);
    // No markdown here: a fence is two more lines, a table row is a line.
    const fence = '```\n' + Array.from({ length: 40 }, () => 'x').join('\n') + '\n```';
    expect(plainLines(fence)).toBe(42);
    expect(plainLines('| a | b |')).toBe(1);
  });

  it('a well neither wraps nor grows past its cap', () => {
    expect(wellLines('')).toBe(0);
    expect(wellLines('x'.repeat(5000))).toBe(1);
    expect(wellLines('a\nb\nc')).toBe(3);
    expect(wellLines(Array.from({ length: 300 }, () => 'x').join('\n'))).toBe(WELL_LINES);
  });
});

describe('fitRowModel — learning the line from measured rows', () => {
  it('recovers the line its samples lie on', () => {
    const m = fitRowModel(onLine(40, 18, [1, 5, 20, 60]));
    expect(m?.a).toBeCloseTo(40, 6);
    expect(m?.b).toBeCloseTo(18, 6);
  });

  it('learns a slope of ZERO for a row whose height does not follow its text', () => {
    const m = fitRowModel([1, 9, 40, 300].map((lines) => ({ lines, px: 62 })));
    expect(m).toEqual({ a: 62, b: 0 });
  });

  // Review 191, F3: one or two rows used to become a stored per-kind CONSTANT —
  // a 50-line report at 1413px priced every later 2-line reply at 1413px, and a
  // blend of 0.3 per visit took six visits to bring that to 226.
  it('claims NOTHING from fewer rows than it needs — one long report is not a kind', () => {
    expect(fitRowModel([{ lines: 50, px: 1413 }])).toBeNull();
    expect(fitRowModel([{ lines: 50, px: 1413 }, { lines: 2, px: 60 }])).toBeNull();
    expect(fitRowModel(onLine(30, 19, [2, 7, 50]))).not.toBeNull();
    expect(MIN_FIT_ROWS).toBe(3);
  });

  // Review 191, F2: one measured row whose height does not follow its text —
  // a folded recap, an opened card — used to bend least squares for the whole
  // kind. Measured in a browser: six real asks at ~28px/line plus one folded
  // recap fitted {a: 633, b: 0}, and every ask, one line or fifty, was 633px.
  it('is not bent by one row that does not follow its text', () => {
    const asks = onLine(62, 28, [4, 14, 33, 10, 57, 6]);
    const m = fitRowModel([...asks, { lines: 262, px: 47 }]);
    expect(m?.b).toBeCloseTo(28, 6);
    expect(m?.a).toBeCloseTo(62, 6);
  });

  it('is not moved by one card the reader happened to leave open', () => {
    const cards = [...Array.from({ length: 8 }, () => ({ lines: 1, px: 62 })), { lines: 1, px: 640 }];
    expect(fitRowModel(cards)).toEqual({ a: 62, b: 0 });
  });

  // Review 191, F4: a negative slope was clamped to zero while the intercept
  // computed FOR that slope was kept, leaving a line above all of its data.
  it('refusing a falling slope leaves the LEVEL of what was measured, not the old intercept', () => {
    // Free fit: 110 - 10/line. The intercept of a line that is then flattened
    // is 110 — above every row measured. The flat line through them is 85.
    const m = fitRowModel(onLine(110, -10, [1, 2, 3, 4]));
    expect(m).toEqual({ a: 85, b: 0 });
  });

  it('refits through the ORIGIN rather than clamping a negative intercept', () => {
    // Rows that bend upward: the free line would cross zero, and a row cannot
    // cost less than nothing. Clamping `a` alone keeps the slope computed for
    // the negative intercept and puts every row low; the constrained answer is
    // the (median) line through the origin.
    const m = fitRowModel([{ lines: 10, px: 150 }, { lines: 20, px: 400 }, { lines: 40, px: 900 }]);
    expect(m?.a).toBe(0);
    expect(m?.b).toBeCloseTo(20, 6);           // the median of 15, 20 and 22.5 px per line
    const exact = fitRowModel(onLine(0, 20, [1, 5, 20, 60]));
    expect(exact).toEqual({ a: 0, b: 20 });
    expect(estimateRow(exact, 20, 96)).toBe(400);
  });

  // A user turn that is ONLY attachments has no prose: 0 lines. It says nothing
  // about pixels per line, and dividing by its 0 lines is not a ratio.
  it('refits through the origin from the rows that HAVE lines', () => {
    const rows = [{ lines: 0, px: 20 }, { lines: 10, px: 150 }, { lines: 20, px: 400 }, { lines: 40, px: 900 }];
    // The free line through these crosses zero (23.5 px/line, -55), so it is
    // refitted — and the attachments-only row has no ratio to offer.
    const m = fitRowModel(rows);
    expect(m?.a).toBe(0);
    expect(m?.b).toBeCloseTo(20, 6);           // the median of 15, 20 and 22.5 px per line
  });

  it('never learns that more text makes a row SHORTER', () => {
    expect(fitRowModel(onLine(900, -8, [1, 10, 40, 80]))?.b).toBe(0);
  });

  it('holds the slope and the intercept inside their bands', () => {
    expect(fitRowModel(onLine(0, 10_000, [1, 2, 3, 4]))?.b).toBe(MAX_PX_PER_LINE);
    expect(fitRowModel([1, 2, 3, 4].map((lines) => ({ lines, px: 99_999 })))?.a).toBe(MAX_ROW_PX);
  });

  it('ignores a sample that is not a measurement', () => {
    const m = fitRowModel([
      ...onLine(40, 18, [1, 5, 20]),
      { lines: 999, px: 0 }, { lines: 3, px: -5 }, { lines: Number.NaN, px: 80 }, { lines: -1, px: 80 },
    ]);
    expect(m?.a).toBeCloseTo(40, 6);
    expect(m?.b).toBeCloseTo(18, 6);
    expect(fitRowModel([{ lines: 5, px: 0 }, { lines: 7, px: -3 }, { lines: 1, px: Number.NaN }])).toBeNull();
  });
});

// Review 191, F3, second half. A LEVEL — rows that are all one length, or a
// slope that will not rise — is a model only for a kind whose rows ARE one
// length by construction. For a kind priced by its prose it is the per-kind
// constant F3 removed: three one-line replies would price a 50-line report at
// 40px, and three sightings of one report would price every reply at 1400.
describe('a kind priced by its prose needs a SLOPE, not a level', () => {
  const level = (px: number, lines = 1) => onLine(px, 0, [lines, lines, lines]);

  it('learns no line for prose rows that are all one length', () => {
    const record = { ...rememberedRows(fake()) };
    for (const b of ['user', 'assistant', 'pending', 'mail'] as const) record[b] = level(40);
    const m = modelsOf(record);
    expect(m.user).toBeNull();
    expect(m.assistant).toBeNull();
    expect(m.pending).toBeNull();
    expect(m.mail).toBeNull();
  });

  it('learns no line for prose rows whose slope will not rise', () => {
    const record = { ...rememberedRows(fake()), assistant: onLine(110, -10, [1, 2, 3, 4]) };
    expect(modelsOf(record).assistant).toBeNull();
  });

  it('still learns the line once the rows differ in length', () => {
    const record = { ...rememberedRows(fake()), assistant: onLine(40, 18, [1, 1, 3]) };
    expect(modelsOf(record).assistant).toEqual({ a: 40, b: 18 });
  });

  it('takes the level of a kind that IS one length by construction', () => {
    const record = { ...rememberedRows(fake()) };
    for (const b of ['divider', 'tool', 'folded', 'working', 'task', 'system', 'attach'] as const) {
      record[b] = level(35, b === 'folded' || b === 'working' ? 0 : 1);
    }
    const m = modelsOf(record);
    for (const b of ['divider', 'tool', 'folded', 'working', 'task', 'system', 'attach'] as const) {
      expect(m[b]).toEqual({ a: 35, b: 0 });
    }
  });
});

describe('estimating a row — what it is believed to cost before it renders', () => {
  const assistant: RowModel = { a: 40, b: 18 };

  it('prices a row by its own text', () => {
    expect(estimateRow(assistant, 10, 96)).toBe(220);
    expect(estimateRow(assistant, 60, 96)).toBe(1120);
  });

  it('hands an unlearned kind the caller GUESS', () => {
    expect(estimateRow(null, 60, 137)).toBe(137);
  });

  it('does NOT trim a long turn — the ceiling is for nonsense, not for tall rows', () => {
    // Measured in a browser: one assistant turn of 396 nominal lines really
    // rendered 7728px; a 4000px ceiling turned a 6% miss into a 34% one.
    expect(estimateRow({ a: 10.58, b: 18.38 }, 396, 96)).toBeGreaterThan(7000);
  });

  it('keeps every estimate inside the row band', () => {
    expect(estimateRow({ a: 0, b: 0 }, 0, 96)).toBe(MIN_ROW_PX);
    expect(estimateRow({ a: 600, b: 200 }, 10_000, 96)).toBe(MAX_ROW_PX);
  });

  it('adds a row of thumbnails as its own term, at the CSS cap until one is measured', () => {
    const models = { ...none(), user: { a: 50, b: 20 } };
    expect(estimateShape({ bucket: 'user', lines: 1 }, models, 96)).toBe(70);
    expect(estimateShape({ bucket: 'user', lines: 1, attach: 2 }, models, 96)).toBe(70 + 2 * THUMB_ROW_PX);
    const learned = { ...models, attach: { a: 150, b: 0 } };
    expect(estimateShape({ bucket: 'user', lines: 1, attach: 1 }, learned, 96)).toBe(220);
  });
});

describe('openingHeight — the ONE number virtuoso opens with', () => {
  it('is the mean of what the rows are each believed to cost', () => {
    const models = { ...none(), tool: { a: 62, b: 0 }, assistant: { a: 40, b: 18 } };
    const rows = [
      ...Array.from({ length: 3 }, () => ({ bucket: 'tool' as const, lines: 1 })),
      { bucket: 'assistant' as const, lines: 60 },
    ];
    expect(openingHeight(rows, models, 96)).toBe(327);          // (62 * 3 + 1120) / 4
    expect(rowHeights(rows, models, 96)).toEqual([62, 62, 62, 1120]);
  });

  it('answers the fallback for a transcript with no rows at all', () => {
    expect(openingHeight([], none(), 210)).toBe(FALLBACK_ITEM_HEIGHT);
  });
});

describe('the storage contract', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (original !== undefined) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('answers an empty record when storage refuses, and never throws', () => {
    const rows = rememberedRows(hostile());
    for (const b of HEIGHT_BUCKETS) expect(rows[b]).toEqual([]);
    expect(() => visit(hostile(), { tool: onLine(62, 0, [1, 1, 1]) })).not.toThrow();
  });

  // The default store: some privacy modes throw on merely NAMING `localStorage`.
  it('survives a browser where touching `localStorage` itself throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('denied', 'SecurityError'); },
    });
    expect(rememberedRows().user).toEqual([]);
    expect(() => rememberRows(new Map([['user', onLine(50, 20, [1, 2, 3])]]), rememberedRows())).not.toThrow();
  });

  it('survives a corrupted record rather than rendering badly', () => {
    const s = fake();
    s.setItem(ROWS_KEY, '{not json');
    for (const b of HEIGHT_BUCKETS) expect(rememberedRows(s)[b]).toEqual([]);
    s.setItem(ROWS_KEY, '[1,2]');
    for (const b of HEIGHT_BUCKETS) expect(rememberedRows(s)[b]).toEqual([]);
  });

  it('keeps the well-formed rows of a record and drops the rest', () => {
    const s = fake();
    s.setItem(ROWS_KEY, JSON.stringify({
      user: [[1, 70, 11], [2, 'x', 12], [3, -4, 13], [Number.NaN, 5, 14], 'row', [-1, 50, 15], [2, 90, 16],
        // A row with no identity, or one that is not a whole number, is not a row.
        [4, 110], [4, 110, 'u1'], [4, 110, 1.5], [4, 110, -2]],
      tool: { a: 62, b: 0 },
      nonsense: [[1, 1, 1]],
    }));
    const rows = rememberedRows(s);
    expect(rows.user).toEqual([{ lines: 1, px: 70, id: 11 }, { lines: 2, px: 90, id: 16 }]);
    expect(rows.tool).toEqual([]);
  });

  it('never holds more than its bound, keeping the newest', () => {
    const s = fake();
    const many = Array.from({ length: RESERVOIR_ROWS + 7 }, (_, i) => [i, 100 + i, i]);
    s.setItem(ROWS_KEY, JSON.stringify({ assistant: many }));
    const rows = rememberedRows(s).assistant;
    expect(rows.length).toBe(RESERVOIR_ROWS);
    expect(rows[0]).toEqual({ lines: 7, px: 107, id: 7 });
  });

  it('never WRITES more than its bound either', () => {
    const s = fake();
    for (let v = 0; v < 6; v += 1) visit(s, { assistant: onLine(40, 18, Array.from({ length: VISIT_ROWS }, (_, i) => i + 1)) });
    const raw = JSON.parse(s.getItem(ROWS_KEY)!) as Record<string, unknown[]>;
    expect(raw.assistant!.length).toBe(RESERVOIR_ROWS);
  });

  it('stores lengths, pixels and a number that names the row — never text', () => {
    const s = fake();
    const rows = onLine(50, 20, [1, 2, 3]);
    visit(s, { user: rows });
    expect(JSON.parse(s.getItem(ROWS_KEY)!)).toEqual({ user: rows.map((r) => [r.lines, r.px, r.id]) });
  });

  // The identity is a HASH of the session and the row's key, so the record can
  // tell one row from another without holding either.
  it('names a row by a number, the same for the same row and different across sessions', () => {
    const a = rowId('session-a', 'evt-1');
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
    expect(rowId('session-a', 'evt-1')).toBe(a);
    expect(rowId('session-b', 'evt-1')).not.toBe(a);
    expect(rowId('session-a', 'evt-2')).not.toBe(a);
    // The boundary between the two parts is part of the name.
    expect(rowId('ab', 'c')).not.toBe(rowId('a', 'bc'));
  });

  // Two tabs: this one opened before the other saved. The kinds THIS visit did
  // not measure are what storage holds NOW, not what this visit opened with.
  it('leaves a kind it did not measure as storage holds it NOW, another tab\'s save included', () => {
    const s = fake();
    const opened = rememberedRows(s);
    const other = onLine(58, 0, [1, 1, 1]);
    visit(s, { tool: other });
    rememberRows(new Map([['user', onLine(50, 20, [1, 2, 3])]]), opened, s);
    expect(rememberedRows(s).tool).toEqual(other);
  });
});

describe('a visit — what it adds to the record, and how much', () => {
  it('writes NOTHING when the visit measured nothing', () => {
    const s = fake();
    visit(s, { tool: fresh([{ lines: 3, px: 0 }]) });
    rememberRows(new Map(), rememberedRows(s), s);
    expect(s.getItem(ROWS_KEY)).toBeNull();
  });

  it('leaves a kind nobody measured exactly as it was — silence is not evidence', () => {
    const s = fake();
    visit(s, { tool: onLine(62, 0, [1, 1, 1]), assistant: onLine(40, 18, [1, 5, 20]) });
    visit(s, { tool: onLine(70, 0, [1, 1, 1]) });
    expect(bare(rememberedRows(s).assistant)).toEqual(bare(onLine(40, 18, [1, 5, 20])));
  });

  // The other half of F3: a kind that turns up once or twice a visit — the
  // asks in a tool-heavy session — used to keep the constant its first visit
  // guessed. Its rows now ACCUMULATE until there are enough to fit.
  it('learns a kind that turns up twice a visit by its second visit, not from its first', () => {
    const s = fake();
    visit(s, { user: onLine(50, 25, [2, 30]) });
    expect(modelOf(s, 'user')).toBeNull();
    visit(s, { user: onLine(50, 25, [8, 1]) });
    expect(modelOf(s, 'user')?.a).toBeCloseTo(50, 6);
    expect(modelOf(s, 'user')?.b).toBeCloseTo(25, 6);
  });

  // THE VERIFIER'S REPRO (review 191, F3 after the fix). A session whose
  // rendered window holds ONE long report, visited three times: the same row
  // measured three times was three rows, enough to fit — and the fit was the
  // report, as a level. Measured in a browser: the next ordinary session opened
  // at +104.5% of its true length.
  it('counts a row seen on several visits ONCE — one report is still not a kind', () => {
    const s = fake();
    const report = { lines: 50, px: 1413, id: rowId('one-session', 'report') };
    for (let v = 0; v < 3; v += 1) visit(s, { assistant: [report] });
    expect(rememberedRows(s).assistant).toEqual([report]);
    expect(modelOf(s, 'assistant')).toBeNull();
  });

  it('replaces a row\'s older measurement with its newer one, newest last', () => {
    const s = fake();
    const [a, b] = onLine(40, 18, [5, 20]);
    visit(s, { assistant: [a!, b!] });
    // The next visit measures the first row again (it grew), and a new one.
    const grown = { ...a!, lines: 9, px: 202 };
    const [c] = onLine(40, 18, [2]);
    visit(s, { assistant: [grown, c!] });
    expect(rememberedRows(s).assistant).toEqual([b, grown, c]);
  });

  it('keeps one entry per row even if a visit hands the same row over twice', () => {
    const s = fake();
    const [a, b, c] = onLine(40, 18, [5, 20, 30]);
    visit(s, { assistant: [a!, b!, { ...a!, px: 140 }, c!] });
    expect(rememberedRows(s).assistant).toEqual([{ ...a!, px: 140 }, b, c]);
  });

  // A visit saves on every hide, and it may measure more rows in between. What
  // it adds is capped across ALL of its saves: each save starts again from the
  // record the visit opened with, so an earlier save's rows are replaced, not
  // added to. Re-reading storage instead would let a visit hidden twice add 15.
  it('caps what one visit adds across all of its saves, not per save', () => {
    const s = fake();
    const opened = rememberedRows(s);
    const rows = onLine(40, 18, Array.from({ length: 2 * VISIT_ROWS }, (_, i) => i + 1));
    rememberRows(new Map([['assistant', rows.slice(0, VISIT_ROWS + 5)]]), opened, s);
    rememberRows(new Map([['assistant', rows]]), opened, s);
    expect(rememberedRows(s).assistant.length).toBe(VISIT_ROWS);
  });

  it('lets one visit NUDGE the record, never seize it', () => {
    const s = fake();
    for (let v = 0; v < 3; v += 1) visit(s, { assistant: onLine(40, 18, [1, 3, 5, 8, 12, 20, 30, 45, 60, 80]) });
    // An atypical session: forty rows on a different line.
    visit(s, { assistant: onLine(200, 30, Array.from({ length: 40 }, (_, i) => i + 1)) });
    const rows = rememberedRows(s).assistant;
    expect(rows.length).toBe(RESERVOIR_ROWS);
    expect(rows.filter((r) => r.px === 200 + 30 * r.lines).length).toBe(VISIT_ROWS);
    // …spanning its whole range rather than the first ten it happened to see.
    const added = rows.slice(-VISIT_ROWS).map((r) => r.lines);
    expect(Math.min(...added)).toBe(1);
    expect(Math.max(...added)).toBe(40);
    // Two thirds of the record still speak for the long run.
    expect(modelOf(s, 'assistant')?.b).toBeCloseTo(18, 6);
  });

  it('lets the oldest rows go first, so a changed rendering is learned in a few visits', () => {
    const s = fake();
    for (let v = 0; v < 3; v += 1) visit(s, { tool: fresh(Array.from({ length: VISIT_ROWS }, () => ({ lines: 1, px: 62 }))) });
    for (let v = 0; v < 3; v += 1) visit(s, { tool: fresh(Array.from({ length: VISIT_ROWS }, () => ({ lines: 1, px: 58 }))) });
    expect(modelOf(s, 'tool')).toEqual({ a: 58, b: 0 });
  });

  it('is IDEMPOTENT: saving one visit four times lands where saving it once does', () => {
    // The list saves on every hide and again on leaving. Each save adds this
    // visit's rows to the record the VISIT OPENED WITH, so the fourth save is
    // not a fourth vote.
    const once = fake();
    const four = fake();
    const earlier = onLine(50, 20, [1, 2, 3]);
    visit(once, { user: earlier });
    visit(four, { user: earlier });
    const samples = new Map<HeightBucket, MeasuredRow[]>([['user', onLine(55, 22, [4, 5, 6])]]);
    rememberRows(samples, rememberedRows(once), once);
    const base: RowRecord = rememberedRows(four);
    for (let i = 0; i < 4; i += 1) rememberRows(samples, base, four);
    expect(four.getItem(ROWS_KEY)).toBe(once.getItem(ROWS_KEY));
  });
});

describe('the whole point, in arithmetic', () => {
  // The shape of a session measured in a browser: 18 tool cards at a flat
  // 62px, and 8 assistant turns from 40px to 1413px.
  const session = [
    ...Array.from({ length: 18 }, () => ({ bucket: 'tool' as const, lines: 1 })),
    ...[1, 2, 6, 14, 22, 35, 48, 74].map((lines) => ({ bucket: 'assistant' as const, lines })),
  ];

  it('a SECOND visit opens near the truth, where one number per kind could not', () => {
    const s = fake();
    visit(s, {
      tool: fresh(Array.from({ length: 18 }, () => ({ lines: 1, px: 62 }))),
      assistant: onLine(40, 18.6, [1, 2, 6, 14, 22, 35, 48, 74]),
    });
    const truth = session.reduce((sum, r) => sum + (r.bucket === 'tool' ? 62 : 40 + 18.6 * r.lines), 0);
    const believed = openingHeight(session, modelsOf(rememberedRows(s)), FALLBACK_ITEM_HEIGHT) * session.length;
    expect(Math.abs(believed - truth) / truth).toBeLessThan(0.02);
  });
});
