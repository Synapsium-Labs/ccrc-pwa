// What the chat list believes a row costs before it has measured one — learned
// from this browser's own rows rather than guessed once in the source.
//
// WHY IT CANNOT BE A CONSTANT. Virtuoso needs a height for every item it has
// not measured, and the total it reports — the scrollbar — is built from those
// numbers. Get them wrong and the thumb lies, then corrects as real heights
// arrive, dragging the scroll position with it.
//
// WHY IT CANNOT BE ONE NUMBER PER ROW KIND EITHER. The chat shows the last
// `BACKLOG_N = 50` events, so the list is about three dozen rows — there is no
// averaging to hide behind. Measured in a real browser on one live session: 18
// tool cards at a flat 62px, 3 dividers at 35px, and 8 assistant turns running
// from 40px to 1413px. Eight rows of thirty-five carried 76% of the list's
// height, with a 35x spread INSIDE that one kind. A mean of that population
// describes none of its members.
//
// SO THE MODEL IS A LINE, not a number: `px = a + b * lines`, one pair per
// kind. The predictor is what the row SHOWS — its prose, or the one row a
// folded card or a collapsed tool call draws whatever it carries — which the
// list knows at mount, before anything is rendered. The slope is a property of
// the RENDERING (font, measure, line height), so it carries from session to
// session, which a mean never could.
//
// WHAT IS REMEMBERED IS THE EVIDENCE, NOT THE LINE: the most recent measured
// rows of each kind, as `(lines, px)` pairs — never any text. The line is
// fitted from them, robustly, whenever the list opens. Two things follow that a
// stored line could not do:
//
//   - A kind that turns up once or twice a visit (the asks in a tool-heavy
//     session) accumulates rows ACROSS visits until there are enough to fit,
//     instead of freezing whatever constant its first one or two rows implied.
//   - One odd row — an opened card, a turn measured mid-render — is outvoted
//     by its neighbours rather than bending the least-squares line for the
//     whole kind.

/** Used for any kind this browser has not measured enough of. */
export const FALLBACK_ITEM_HEIGHT = 96;

/** What one row of attachment thumbnails costs before any has been measured:
 *  `.msg-attach-img { max-height: 220px }`, the CSS's own cap. A screenshot is
 *  usually tall enough to hit it; the measured term replaces it from then on. */
export const THUMB_ROW_PX = 220;

/** The band a per-row ESTIMATE lands in.
 *
 *  THE CEILING IS A SANITY BOUND ON A CORRUPTED MODEL, NOT A BELIEF ABOUT
 *  ROWS, and it is set high for a reason paid for twice. A 600px band quietly
 *  halved every long turn, and a 4000px one was measured, in a browser, to be
 *  the ENTIRE remaining error on one session: a single assistant turn of 396
 *  nominal lines really renders 7728px, the model predicted 7291px — a 6% miss
 *  — and the ceiling threw away 3291px of it. A ceiling that trims a correct
 *  prediction is not a guard. What remains here only refuses arithmetic nobody
 *  could mean.
 *
 *  The floor is what a divider costs (35px, measured) with room to spare. */
export const MIN_ROW_PX = 16;
export const MAX_ROW_PX = 50_000;

/** The slope's band: pixels per nominal line. Measured values run from 0 (a
 *  row whose height ignores its content) to a few tens (a user bubble). */
export const MAX_PX_PER_LINE = 200;

/** A kind needs this many measured rows before it is priced from them at all.
 *  One or two rows are not a kind: a single 50-line report at 1413px, taken as
 *  the kind's constant, priced every later two-line reply at 1413px. Below
 *  this the kind keeps the fallback, and its rows wait in the record for more. */
export const MIN_FIT_ROWS = 3;

/** How many measured rows of each kind the record keeps — the newest. */
export const RESERVOIR_ROWS = 30;

/** How many rows one visit may add to a kind. A third of the record: one
 *  atypical session — a long tool-only run, one enormous report — NUDGES the
 *  fit rather than seizing it, and a changed rendering is learned in about
 *  three visits as its rows displace the oldest. */
export const VISIT_ROWS = 10;

/** The record: `{ [kind]: [[lines, px], …] }`, newest last. */
export const ROWS_KEY = 'ccrc:chat-row-samples';

/** `localStorage` throws outright in some privacy modes — on merely being
 *  named — and a thumbnailer or a preview frame can hand back a store that
 *  refuses writes. Every access goes through this, and every failure means
 *  "nothing remembered": the list renders identically, with the fallback. */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const clampRow = (px: number): number =>
  Math.min(MAX_ROW_PX, Math.max(MIN_ROW_PX, Math.round(px)));
const clampIntercept = (a: number): number =>
  Math.min(MAX_ROW_PX, Math.max(0, a));
const clampSlope = (b: number): number =>
  Math.min(MAX_PX_PER_LINE, Math.max(0, b));

/**
 * THE PREDICTOR for a row drawn as MARKDOWN (an assistant turn): how many lines
 * of the nominal measure this text would take.
 *
 * It is deliberately NOT a pixel count. The three rules below are shape, drawn
 * from this tree's own CSS; the conversion from shape to pixels is the slope,
 * and the slope is measured in the browser that will do the rendering.
 *
 *   1. A line shorter than the measure is ONE line. Raw character count gets
 *      this catastrophically wrong: a ten-item list is ten lines, not one
 *      sixth of one.
 *   2. A table row does not WRAP however wide it is, because `.md-table-wrap`
 *      scrolls sideways. It is taller than a line of prose, by a ratio the
 *      tokens state outright: a cell is `--text-sm` at `--leading-normal` with
 *      `--sp-2` above and below, so (13 x 1.5 + 8 + 8) / (15 x 1.5) = 1.58.
 *      Counting it as one line under-measured a table-heavy session by 15%.
 *   3. A fenced block SATURATES, because `.msg-assist pre` caps at
 *      `--well-max` (240px) and scrolls inside itself. `WELL_LINES` is that
 *      cap in this function's own unit: 240px over a ~24px text line.
 */
export const NOMINAL_MEASURE = 60;
export const WELL_LINES = 10;
export const TABLE_ROW_LINES = 1.58;

export function nominalLines(text: string): number {
  const body = String(text ?? '');
  // No text is no lines: a row with nothing in it has no prose to price.
  if (body === '') return 0;
  let lines = 0;
  let inFence = false;
  let fenced = 0;
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      if (inFence) { lines += Math.min(fenced, WELL_LINES); fenced = 0; }
      inFence = !inFence;
      lines += 1;
      continue;
    }
    if (inFence) { fenced += 1; continue; }
    if (/^\s*\|/.test(line)) { lines += TABLE_ROW_LINES; continue; }
    lines += Math.max(1, Math.ceil(line.length / NOMINAL_MEASURE));
  }
  // A turn cut off mid-block — a streaming assistant message — still saturates.
  if (inFence) lines += Math.min(fenced, WELL_LINES);
  return lines;
}

/** The predictor for text drawn AS IT IS, `white-space: pre-wrap` — a user
 *  bubble, a pill. No Markdown happens there, so nothing saturates: a pasted
 *  fence is every one of its lines, and a `|` line is a line. */
export function plainLines(text: string): number {
  const body = String(text ?? '');
  if (body === '') return 0;
  let lines = 0;
  for (const line of body.split('\n')) lines += Math.max(1, Math.ceil(line.trimEnd().length / NOMINAL_MEASURE));
  return lines;
}

/** The predictor for a `pre.well`: it neither wraps (it scrolls sideways) nor
 *  grows past `--well-max` (it scrolls inside itself). */
export function wellLines(text: string): number {
  const body = String(text ?? '');
  return body === '' ? 0 : Math.min(body.split('\n').length, WELL_LINES);
}

/**
 * THE POPULATION A ROW BELONGS TO, for sizing — by the FORM it renders in.
 *
 * `message` splits by its event kind because a user turn and an assistant turn
 * are the two ends of the distribution, and every other `ChatItem` kind is its
 * own population. `folded` is the one bucket that is a form rather than a kind:
 * a /compact recap and a multi-line system row both render as one collapsed
 * card, whoever said them and however long they are, so they are one
 * population of fixed-height rows.
 *
 * `attach` prices no row of its own. It is a TERM: a row of attachment
 * thumbnails above a user bubble, measured off the grid's own element and
 * added to the bubble's estimate, so a screenshot neither looks like a line of
 * text nor teaches the user bucket that three lines cost 300px.
 *
 * THE RECORD IS THE VOCABULARY. `HEIGHT_BUCKETS` derives from it rather than
 * restating it, so a new bucket is a compile error here, not an unsized row.
 */
export type RowKind =
  | 'user' | 'assistant' | 'system' | 'folded'
  | 'divider' | 'tool' | 'mail' | 'task' | 'pending' | 'working';
export type HeightBucket = RowKind | 'attach';

const BUCKET_MAP: Record<HeightBucket, true> = {
  user: true, assistant: true, system: true, folded: true,
  divider: true, tool: true, mail: true, task: true, pending: true, working: true,
  attach: true,
};

export const HEIGHT_BUCKETS = Object.keys(BUCKET_MAP) as HeightBucket[];
const isBucket = (k: string): k is HeightBucket => Object.hasOwn(BUCKET_MAP, k);

/** What a row of one kind costs: `px = a + b * lines`. */
export interface RowModel { a: number; b: number }

/** One measured row: what it was predicted to be worth, and what it cost. */
export interface RowSample { lines: number; px: number }

/** A row the list is about to show, before anything has rendered. `attach` is
 *  the rows of attachment thumbnails above it (0 or absent: none). */
export interface RowShape { bucket: RowKind; lines: number; attach?: number }

export type RowModels = Record<HeightBucket, RowModel | null>;

/** What this browser remembers: the newest measured rows of each kind. */
export type RowRecord = Record<HeightBucket, readonly RowSample[]>;

const isSample = (s: RowSample): boolean =>
  Number.isFinite(s.px) && s.px > 0 && Number.isFinite(s.lines) && s.lines >= 0;

function median(xs: number[]): number {
  const v = [...xs].sort((p, q) => p - q);
  const mid = v.length >> 1;
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/**
 * Fit the line to measured rows — ROBUSTLY (Theil–Sen): the slope is the
 * median of the slopes between every pair of rows of different length, and
 * the intercept the median of what is left over. Its breakdown point is about
 * 29%: fewer wrong rows than that cannot drag the line arbitrarily far. Least
 * squares, which this replaced, let ONE row decide it: six asks at ~28px/line plus one folded
 * recap (262 lines of text, 47px on screen) fitted `{a: 633, b: 0}`, and every
 * ask, one line or fifty, was priced at 633px. Measured in a browser.
 *
 * FEWER THAN `MIN_FIT_ROWS` ROWS ARE NO MODEL — null, and the kind keeps the
 * fallback. Rows that are all one length cannot show a slope, and say what
 * they can: a level, `b = 0`.
 *
 * A FALLING SLOPE IS REFUSED, and what is left is the LEVEL of the rows — the
 * median of what they measured. More text cannot make a row shorter, and the
 * intercept that belonged to the falling line sits above every row that was
 * measured, so it is not kept. (Review 191, F4.)
 *
 * A NEGATIVE INTERCEPT IS REFUSED BY REFITTING THROUGH THE ORIGIN, not by
 * clamping: a fit is a pair, and clamping `a` while keeping the slope computed
 * FOR a negative one leaves a line that misses its own data — measured, it put
 * every assistant row ~40px low. The robust line through the origin is the
 * median of `px / lines`.
 */
export function fitRowModel(samples: readonly RowSample[]): RowModel | null {
  const rows = samples.filter(isSample);
  if (rows.length < MIN_FIT_ROWS) return null;
  const slopes: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const dx = rows[j]!.lines - rows[i]!.lines;
      if (dx !== 0) slopes.push((rows[j]!.px - rows[i]!.px) / dx);
    }
  }
  const free = slopes.length === 0 ? 0 : median(slopes);
  if (!(free > 0)) return { a: clampIntercept(median(rows.map((r) => r.px))), b: 0 };
  const b = clampSlope(free);
  const a = median(rows.map((r) => r.px - b * r.lines));
  if (a >= 0) return { a: clampIntercept(a), b };
  const ratios = rows.filter((r) => r.lines > 0).map((r) => r.px / r.lines);
  return { a: 0, b: clampSlope(ratios.length === 0 ? 0 : median(ratios)) };
}

/** Every kind's line, fitted from the record. Run once per mount. */
export function modelsOf(record: RowRecord): RowModels {
  const out = {} as RowModels;
  for (const b of HEIGHT_BUCKETS) out[b] = fitRowModel(record[b]);
  return out;
}

/** What one row is believed to cost. A kind with no model takes the caller's
 *  GUESS; it is substituted here, at the render, and never stored. */
export function estimateRow(
  model: RowModel | null,
  lines: number,
  unmeasured: number,
): number {
  if (model === null) return unmeasured;
  return clampRow(model.a + model.b * Math.max(0, lines));
}

/** One row's estimate: its own kind's line, plus its thumbnails' term. */
export function estimateShape(shape: RowShape, models: RowModels, unmeasured: number): number {
  const body = estimateRow(models[shape.bucket] ?? null, shape.lines, unmeasured);
  const thumbs = shape.attach ?? 0;
  if (!(thumbs > 0)) return body;
  return clampRow(body + estimateRow(models.attach, thumbs, thumbs * THUMB_ROW_PX));
}

/** Every row's own estimate, in order — what the list seeds virtuoso with, so
 *  the total is right at open AND stays right as real heights replace them. */
export function rowHeights(
  rows: Iterable<RowShape>,
  models: RowModels,
  unmeasured: number,
): number[] {
  const out: number[] = [];
  for (const r of rows) out.push(estimateShape(r, models, unmeasured));
  return out;
}

/** The single number virtuoso prices anything it was not seeded with — a row
 *  that arrives later while the session tails. The mean of this transcript's
 *  own rows is the best available answer for a row nobody has seen yet. */
export function openingHeight(
  rows: Iterable<RowShape>,
  models: RowModels,
  unmeasured: number,
): number {
  const px = rowHeights(rows, models, unmeasured);
  // An empty transcript has no composition to weigh, and a mean of nothing is
  // not zero — it is unknown, which is what the fallback is for.
  if (px.length === 0) return FALLBACK_ITEM_HEIGHT;
  return clampRow(px.reduce((a, b) => a + b, 0) / px.length);
}

const emptyRecord = (): Record<HeightBucket, RowSample[]> => {
  const out = {} as Record<HeightBucket, RowSample[]>;
  for (const b of HEIGHT_BUCKETS) out[b] = [];
  return out;
};

/** The record as it stands. A row that is not a well-formed `[lines, px]`
 *  pair is dropped, a kind that is not an array is empty, and a refused or
 *  corrupted store is an empty record — never a throw: a hand-edited value is
 *  not a reason to render badly. */
export function rememberedRows(s: Storage | null = store()): RowRecord {
  const out = emptyRecord();
  const raw = (() => { try { return s?.getItem(ROWS_KEY) ?? null; } catch { return null; } })();
  if (raw === null) return out;
  let saved: unknown;
  try { saved = JSON.parse(raw); } catch { return out; }
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (!isBucket(k) || !Array.isArray(v)) continue;
    const rows: RowSample[] = [];
    for (const pair of v) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [lines, px] = pair as unknown[];
      if (typeof lines !== 'number' || typeof px !== 'number') continue;
      const row = { lines, px };
      if (isSample(row)) rows.push(row);
    }
    out[k] = rows.slice(-RESERVOIR_ROWS);
  }
  return out;
}

/** At most `n` of a visit's rows, chosen to SPAN its lengths rather than to be
 *  whichever it saw first — the slope lives in the spread. */
function spread(rows: readonly RowSample[], n: number): RowSample[] {
  if (rows.length <= n) return [...rows];
  const sorted = [...rows].sort((p, q) => p.lines - q.lines || p.px - q.px);
  return Array.from({ length: n }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]!);
}

/**
 * Add this visit's measured rows to the record — ONCE per visit, however many
 * times this is called.
 *
 * THE BASELINE IS A PARAMETER, and that is the whole point. The list saves
 * whenever the page is hidden and again when the session is left, and a
 * backgrounded PWA can be hidden many times in one visit. Each save writes the
 * record THIS VISIT OPENED WITH plus this visit's rows, so every save of a
 * visit lands in the same place and the last one wins — a fourth save is not a
 * fourth vote.
 *
 * A kind with no measured row is left exactly as it now stands: silence is not
 * evidence. A save that measured nothing writes NOTHING, so an empty visit can
 * never look like a learned one.
 */
export function rememberRows(
  visit: ReadonlyMap<HeightBucket, readonly RowSample[]>,
  baseline: RowRecord,
  s: Storage | null = store(),
): void {
  if (s === null) return;
  const fresh = new Map<HeightBucket, RowSample[]>();
  for (const [bucket, rows] of visit) {
    const measured = rows.filter(isSample);
    if (measured.length === 0) continue;
    fresh.set(bucket, [...baseline[bucket], ...spread(measured, VISIT_ROWS)].slice(-RESERVOIR_ROWS));
  }
  if (fresh.size === 0) return;
  const now = rememberedRows(s);
  const out: Record<string, [number, number][]> = {};
  for (const b of HEIGHT_BUCKETS) {
    const rows = fresh.get(b) ?? now[b];
    // Lengths to two places (a table row is 1.58 lines) and whole pixels:
    // nothing else is stored, and no text ever is.
    if (rows.length > 0) out[b] = rows.map((r) => [Math.round(r.lines * 100) / 100, Math.round(r.px)]);
  }
  try { s.setItem(ROWS_KEY, JSON.stringify(out)); } catch { /* storage refused — keep the fallback */ }
}
