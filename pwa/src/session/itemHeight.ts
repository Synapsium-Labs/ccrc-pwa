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
// the RENDERING (font, line height), so it carries from session to session,
// which a mean never could.
//
// AND FROM WIDTH TO WIDTH, because a line is counted in the column the row is
// drawn in (`Measures`): the record is one per browser, and one browser is a
// phone held upright and then on its side, or a window dragged narrower.
//
// WHAT IS REMEMBERED IS THE EVIDENCE, NOT THE LINE: the most recent measured
// rows of each kind, as `(lines, px, row)` triples — never any text; `row` is
// a number naming the row (`rowId`). The line is fitted from them, robustly,
// whenever the list opens. Two things follow that a stored line could not do:
//
//   - A kind that turns up once or twice a visit (the asks in a tool-heavy
//     session) accumulates rows ACROSS visits until there are enough to fit,
//     instead of freezing whatever constant its first one or two rows implied.
//     Rows, not sightings: the same row measured on a later visit replaces its
//     older measurement, so a session reopened three times is not three rows.
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

/** A kind needs this many measured ROWS — different rows, not sightings of one
 *  — before it is priced from them at all. One or two rows are not a kind: a
 *  single 50-line report at 1413px, taken as the kind's constant, priced every
 *  later two-line reply at 1413px. Below this the kind keeps the fallback, and
 *  its rows wait in the record for more. */
export const MIN_FIT_ROWS = 3;

/** How many measured rows of each kind the record keeps — the newest. */
export const RESERVOIR_ROWS = 30;

/** How many rows one visit may add to a kind. A third of the record: one
 *  atypical session — a long tool-only run, one enormous report — NUDGES the
 *  fit rather than seizing it, and a changed rendering is learned in about
 *  three visits as its rows displace the oldest. */
export const VISIT_ROWS = 10;

/** The record: `{ [kind]: [[lines, px, row], …] }`, newest last; `row` is `rowId`.
 *
 *  `-v2`: its lines are lines of the column the row was measured in. The
 *  record before it counted every row against a fixed 60 characters — a
 *  different unit, which no row of this one may be fitted together with. */
export const ROWS_KEY = 'ccrc:chat-row-samples-v2';

/** Records in a unit nothing reads any more; a save clears them away. */
const RETIRED_KEYS = ['ccrc:chat-row-samples'] as const;

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
 * HOW MANY CHARACTERS OF PROSE ONE LINE HOLDS, in the two forms text wraps in:
 * an assistant paragraph (`prose`, capped at the reading measure once the
 * column is wide enough) and a user bubble (`bubble`, 85% of the row, no cap).
 * Read in the browser, in the live column (`ChatList.tsx`'s `measuresOf`).
 *
 * WHY THE PREDICTOR NEEDS IT. Counted against a fixed measure a row is the same
 * number of "lines" at every width, so the learned px-per-line carries the
 * wrap of whatever width it was learned at: 35.5px per line for a bubble at
 * 390px, 5.6px at 2560px. Measured in headless Chromium with the real
 * virtuoso, a model learned on a phone held upright opened a prompt-heavy
 * session in landscape +32.6% off its true length. Counted in the column's own
 * lines the slope is the line height at every width (22-23.7px for a bubble,
 * 20.6-22px for prose, from 360px to 2560px), and transfers: learned at one
 * width and opened at another, every measured session opened within 6.6% of
 * its true length (a session of screenshots aside — its thumbnails take no
 * height until they load, at any width).
 */
export interface Measures { prose: number; bubble: number }

/**
 * THE PREDICTOR for a row drawn as MARKDOWN (an assistant turn): how many lines
 * this text takes at `measure` characters a line — the column's own measure,
 * `Measures.prose`. `NOMINAL_MEASURE` is only what a column that cannot be
 * read (not laid out) is assumed to hold.
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

/** The measures of a column nothing could be read from. */
export const NOMINAL_MEASURES: Measures = { prose: NOMINAL_MEASURE, bubble: NOMINAL_MEASURE };

export function nominalLines(text: string, measure: number = NOMINAL_MEASURE): number {
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
    lines += Math.max(1, Math.ceil(line.length / measure));
  }
  // A turn cut off mid-block — a streaming assistant message — still saturates.
  if (inFence) lines += Math.min(fenced, WELL_LINES);
  return lines;
}

/** The predictor for text drawn AS IT IS, `white-space: pre-wrap` — a user
 *  bubble, a pill — at `measure` characters a line. No Markdown happens there,
 *  so nothing saturates: a pasted fence is every one of its lines, and a `|`
 *  line is a line. */
export function plainLines(text: string, measure: number = NOMINAL_MEASURE): number {
  const body = String(text ?? '');
  if (body === '') return 0;
  let lines = 0;
  for (const line of body.split('\n')) lines += Math.max(1, Math.ceil(line.trimEnd().length / measure));
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

/** A measured row as the record keeps it: with the number that names it
 *  (`rowId`), so the same row measured again is recognised as the same row. */
export interface MeasuredRow extends RowSample { id: number }

/** A row the list is about to show, before anything has rendered. `attach` is
 *  the rows of attachment thumbnails above it (0 or absent: none). */
export interface RowShape { bucket: RowKind; lines: number; attach?: number }

export type RowModels = Record<HeightBucket, RowModel | null>;

/** What this browser remembers: the newest measured rows of each kind. */
export type RowRecord = Record<HeightBucket, readonly MeasuredRow[]>;

const isSample = (s: RowSample): boolean =>
  Number.isFinite(s.px) && s.px > 0 && Number.isFinite(s.lines) && s.lines >= 0;

const isRowId = (id: unknown): id is number =>
  typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < 2 ** 32;

/**
 * THE NUMBER THAT NAMES A ROW: a 32-bit FNV-1a hash of the session and the
 * row's key (an event's uuid, a tool call's id). Review 191, F3 after the fix:
 * the record kept rows as bare `(lines, px)`, so a session reopened three times
 * added its one long report three times, and three sightings of one row passed
 * `MIN_FIT_ROWS` as three rows. Measured in a browser: the next ordinary
 * session opened at +104.5% of its true length.
 *
 * A HASH, so the record can tell one row from another without holding the key
 * or anything else from the transcript. THE SESSION IS PART OF IT because a key
 * is not unique across sessions: the working row is `working` in every one.
 */
export function rowId(session: string, key: string): number {
  let h = 0x811c9dc5;
  const name = `${session}\u0000${key}`;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * THE KINDS PRICED BY THEIR PROSE — a row of these runs from one line to
 * hundreds — for which a LEVEL is not a model.
 *
 * Rows that are all one length cannot show a slope, and a slope that will not
 * rise says the rows do not follow their text. For a kind whose rows ARE one
 * length by construction that level is exactly right: a divider, a folded card,
 * the working row, a collapsed tool card, a task card's summary, a system pill
 * (a second line folds it into `folded`; only a long line wraps), a row of
 * thumbnails. For the four kinds below it is the per-kind constant review
 * 191's F3 removed, reached another way: three one-line replies would price a
 * 50-line report at 40px, and three 46-line reports every reply at 1790px. So
 * they are priced by a rising line or not at all — the fallback, until rows of
 * different lengths arrive.
 */
export const PROSE_KINDS: ReadonlySet<HeightBucket> = new Set<HeightBucket>(['user', 'assistant', 'pending', 'mail']);

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
 * `needsSlope` (a `PROSE_KINDS` kind) refuses the level too: no rising slope,
 * no model.
 *
 * A NEGATIVE INTERCEPT IS REFUSED BY REFITTING THROUGH THE ORIGIN, not by
 * clamping: a fit is a pair, and clamping `a` while keeping the slope computed
 * FOR a negative one leaves a line that misses its own data — measured, it put
 * every assistant row ~40px low. The robust line through the origin is the
 * median of `px / lines`.
 */
export function fitRowModel(samples: readonly RowSample[], needsSlope = false): RowModel | null {
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
  if (!(free > 0)) return needsSlope ? null : { a: clampIntercept(median(rows.map((r) => r.px))), b: 0 };
  const b = clampSlope(free);
  const a = median(rows.map((r) => r.px - b * r.lines));
  if (a >= 0) return { a: clampIntercept(a), b };
  const ratios = rows.filter((r) => r.lines > 0).map((r) => r.px / r.lines);
  return { a: 0, b: clampSlope(ratios.length === 0 ? 0 : median(ratios)) };
}

/** Every kind's line, fitted from the record. Run once per mount. */
export function modelsOf(record: RowRecord): RowModels {
  const out = {} as RowModels;
  for (const b of HEIGHT_BUCKETS) out[b] = fitRowModel(record[b], PROSE_KINDS.has(b));
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

const emptyRecord = (): Record<HeightBucket, MeasuredRow[]> => {
  const out = {} as Record<HeightBucket, MeasuredRow[]>;
  for (const b of HEIGHT_BUCKETS) out[b] = [];
  return out;
};

/** The record as it stands. A row that is not a well-formed `[lines, px, row]`
 *  triple is dropped — a row nothing names cannot be told from a second
 *  sighting of itself — a kind that is not an array is empty, and a refused or
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
    const rows: MeasuredRow[] = [];
    for (const triple of v) {
      if (!Array.isArray(triple) || triple.length !== 3) continue;
      const [lines, px, id] = triple as unknown[];
      if (typeof lines !== 'number' || typeof px !== 'number' || !isRowId(id)) continue;
      const row = { lines, px, id };
      if (isSample(row)) rows.push(row);
    }
    out[k] = rows.slice(-RESERVOIR_ROWS);
  }
  return out;
}

/** At most `n` of a visit's rows, chosen to SPAN its lengths rather than to be
 *  whichever it saw first — the slope lives in the spread. */
function spread<T extends RowSample>(rows: readonly T[], n: number): T[] {
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
 * A ROW IS ONE ROW, however many visits measure it: a row this visit measured
 * replaces its older measurement in the record (by `rowId`) and moves to the
 * newest end, so a session reopened three times does not vote three times.
 *
 * A kind with no measured row is left exactly as it now stands: silence is not
 * evidence. A save that measured nothing writes NOTHING, so an empty visit can
 * never look like a learned one.
 */
export function rememberRows(
  visit: ReadonlyMap<HeightBucket, readonly MeasuredRow[]>,
  baseline: RowRecord,
  s: Storage | null = store(),
): void {
  if (s === null) return;
  const fresh = new Map<HeightBucket, MeasuredRow[]>();
  for (const [bucket, rows] of visit) {
    // One entry per row, its last measurement, even within the visit.
    const measured = [...new Map(rows.filter((r) => isSample(r) && isRowId(r.id)).map((r) => [r.id, r])).values()];
    if (measured.length === 0) continue;
    const added = spread(measured, VISIT_ROWS);
    const again = new Set(added.map((r) => r.id));
    fresh.set(bucket, [...baseline[bucket].filter((r) => !again.has(r.id)), ...added].slice(-RESERVOIR_ROWS));
  }
  if (fresh.size === 0) return;
  const now = rememberedRows(s);
  const out: Record<string, [number, number, number][]> = {};
  for (const b of HEIGHT_BUCKETS) {
    const rows = fresh.get(b) ?? now[b];
    // Lengths to two places (a table row is 1.58 lines), whole pixels, and the
    // row's number: nothing else is stored, and no text ever is.
    if (rows.length > 0) out[b] = rows.map((r) => [Math.round(r.lines * 100) / 100, Math.round(r.px), r.id]);
  }
  try {
    s.setItem(ROWS_KEY, JSON.stringify(out));
    for (const k of RETIRED_KEYS) s.removeItem(k);
  } catch { /* storage refused — keep the fallback */ }
}
