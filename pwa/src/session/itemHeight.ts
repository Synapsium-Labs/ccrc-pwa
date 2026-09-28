// What the chat list believes a row costs before it has measured one — learned
// from this browser's own transcripts rather than guessed once in the source.
//
// WHY IT CANNOT BE A CONSTANT. Virtuoso needs a height for every item it has
// not measured, and the total it reports — the scrollbar — is built from those
// numbers. Get them wrong and the thumb lies, then corrects as real heights
// arrive, dragging the scroll position with it.
//
// WHY IT CANNOT BE ONE NUMBER PER ROW KIND EITHER, which is what this module
// held until 2026-09-28. The chat shows the last `BACKLOG_N = 50` events, so
// the list is about three dozen rows — there is no averaging to hide behind.
// Measured in a real browser on one live session: 18 tool cards at a flat 62px,
// 3 dividers at 35px, and 8 assistant turns running from 40px to 1413px. Eight
// rows of thirty-five carried 76% of the list's height, with a 35x spread
// INSIDE that one kind. A mean of that population describes none of its
// members, and which member turns up in the last fifty events is a property of
// the session, not of the kind.
//
// SO THE MODEL IS A LINE, not a number: `px = a + b * lines`, one pair per
// kind, both learned. The predictor is the row's own text, which the list holds
// at mount, before anything is rendered. Cross-validated in a headless browser
// across four live sessions from two projects (2026-09-28) — trained on one
// session, asked about another it had never seen:
//
//     per-kind MEAN   total off by 24% on average, each row by 85-321px
//     per-kind LINE   total off by  5% on average, each row by   9- 35px
//
// and every one of the twelve train/test pairs improved. The slope is a
// property of the RENDERING — font, measure, line height — so it carries from
// session to session, which is exactly what a mean could never do.

/** Used only until this browser has measured anything at all. */
export const FALLBACK_ITEM_HEIGHT = 96;

/** The band a LEGACY SCALAR must land in — see `clampHeight`. */
export const MIN_ITEM_HEIGHT = 40;
export const MAX_ITEM_HEIGHT = 600;

/** The band a per-row ESTIMATE lands in.
 *
 *  THE CEILING IS A SANITY BOUND ON A CORRUPTED MODEL, NOT A BELIEF ABOUT
 *  ROWS, and it is set high for a reason paid for twice. The old band capped a
 *  row at 600px, which quietly halved every long turn. Raising it to 4000
 *  looked generous and was measured, in a browser, to be the ENTIRE remaining
 *  error on one session: a single assistant turn of 396 nominal lines really
 *  renders 7728px, the model predicted 7291px — a 6% miss — and the ceiling
 *  threw away 3291px of it, turning a 5% estimate into a 34% one. A ceiling
 *  that trims a correct prediction is not a guard. What remains here only
 *  refuses arithmetic nobody could mean.
 *
 *  The floor is what a divider costs (35px, measured) with room to spare. */
export const MIN_ROW_PX = 16;
export const MAX_ROW_PX = 50_000;

/** The slope's band: pixels per nominal line. It cannot sensibly exceed a few
 *  text lines' worth; measured values are 0 (a collapsed tool card, whose
 *  height ignores its content) to ~23 (a user bubble, `white-space: pre-wrap`).
 *
 *  THE INTERCEPT HAS NO BAND OF ITS OWN — it is held to the ROW band, which is
 *  wide. A tighter ceiling was tried and removed the same day: a visit that
 *  measures one row of a kind cannot see a slope, so the whole of that row's
 *  height lands in the intercept, and a 900px measurement clamped to 600 is the
 *  exact lie this change exists to remove. A measurement is not clamped away
 *  because it is inconvenient; the later visit that can see a slope moves it. */
export const MAX_PX_PER_LINE = 200;

/** How much of a fresh visit's fit is allowed to move the remembered one.
 *  Blended rather than replaced: one atypical session — a long tool-only run,
 *  a single enormous report — should nudge the model, not seize it. */
const BLEND = 0.3;

/** A fit needs this many measured rows before it is allowed to claim a slope,
 *  and their lengths must differ by at least this much (variance, in nominal
 *  lines squared). Below either, the visit has said nothing about the slope and
 *  the one already learned is kept — see `fitRowModel`. */
const MIN_FIT_ROWS = 3;
const MIN_LINE_VARIANCE = 1;

const KEY = 'ccrc:chat-item-height';

/** The per-bucket record. A SECOND key rather than a rewrite of the first: a
 *  browser that rolls back to an older build must keep working, and the oldest
 *  build reads a scalar from `KEY`.
 *
 *  This key now holds `{a, b}` pairs where it used to hold bare numbers. Both
 *  shapes are READ (a bare number is an intercept with no slope), so an upgrade
 *  keeps everything this browser had learned. A ROLLBACK is the other
 *  direction: the previous build reads `Number({a,b})` as NaN, discards it and
 *  falls back to the scalar guess — it renders exactly as it did before this
 *  key existed, which is a cost worth naming and not a break. */
const KINDS_KEY = 'ccrc:chat-item-heights';

/** `localStorage` throws outright in some privacy modes, and a thumbnailer or
 *  a preview frame can hand back a store that refuses writes. Every access here
 *  goes through this, and every failure means "nothing remembered" — the list
 *  renders identically, just with the fallback. */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function clampHeight(px: number): number {
  return Math.min(MAX_ITEM_HEIGHT, Math.max(MIN_ITEM_HEIGHT, Math.round(px)));
}

const clampRow = (px: number): number =>
  Math.min(MAX_ROW_PX, Math.max(MIN_ROW_PX, Math.round(px)));

/**
 * THE PREDICTOR: how many lines of the nominal measure this text would take.
 *
 * It is deliberately NOT a pixel count. The three rules below are shape, drawn
 * from this tree's own CSS; the conversion from shape to pixels is the slope,
 * and the slope is measured in the browser that will do the rendering. That
 * split is what lets one constant here be wrong by a factor and cost nothing —
 * the slope absorbs it — while a hard-coded pixel would simply be wrong.
 *
 *   1. A line shorter than the measure is ONE line. Raw character count gets
 *      this catastrophically wrong: a ten-item list is ten lines, not one
 *      sixth of one.
 *   2. A table row does not WRAP however wide it is, because `.md-table-wrap`
 *      scrolls sideways (`overflow-x: auto`). It is taller than a line of
 *      prose, though, and by a ratio the tokens state outright: a cell is set
 *      in `--text-sm` at `--leading-normal` with `--sp-2` above and below, so
 *      (13 x 1.5 + 8 + 8) / (15 x 1.5) = 1.58 — `TABLE_ROW_LINES`. Counting it
 *      as one line under-measured a table-heavy session by 15%, and this ratio
 *      is what brought four live sessions from 19.7-22.1 px per nominal line
 *      to 18.9-19.3 — the same rendering, finally described the same way.
 *   3. A fenced block SATURATES, because `.msg-assist pre` caps at
 *      `--well-max` (240px) and scrolls inside itself. `WELL_LINES` is that
 *      cap expressed in this function's own unit: 240px over a ~24px text
 *      line. A thousand-line diff and a twelve-line one cost the same.
 */
export const NOMINAL_MEASURE = 60;
export const WELL_LINES = 10;
export const TABLE_ROW_LINES = 1.58;

export function nominalLines(text: string): number {
  const body = String(text ?? '');
  // No text is no lines. Not one: a row with nothing in it has no prose to
  // price, and `''.split()` answering with a single empty line would teach the
  // fit that such a row costs a line's worth of pixels.
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

/** What the OLD single-number build left in this browser, or null if it left
 *  nothing usable. Absent and unusable fold together here on purpose — both
 *  mean "nothing learned" and there is no caller that treats them apart — but
 *  neither folds into a NUMBER, because "never learned" and "learned 96" are
 *  two conditions `openingHeight`'s caller answers differently. */
function learnedScalar(s: Storage | null): number | null {
  const raw = (() => { try { return s?.getItem(KEY) ?? null; } catch { return null; } })();
  if (raw === null) return null;
  const n = Number(raw);
  // A corrupted or hand-edited value is not a reason to render badly.
  return Number.isFinite(n) && n > 0 ? clampHeight(n) : null;
}

/** The best available GUESS for a kind nobody has measured. Read ONCE per mount
 *  by the caller: virtuoso takes its opening number at initialisation, so
 *  changing it later changes nothing and only risks re-running the initial
 *  positioning. */
export function rememberedHeight(s: Storage | null = store()): number {
  return learnedScalar(s) ?? FALLBACK_ITEM_HEIGHT;
}

/**
 * THE POPULATION A ROW BELONGS TO, for sizing.
 *
 * `message` splits by its event kind because a user turn and an assistant turn
 * are the two ends of the distribution. Every other member is its own
 * `ChatItem` kind.
 *
 * THE RECORD IS THE VOCABULARY. `HEIGHT_BUCKETS` derives from it rather than
 * restating it, so a new `ChatItem` kind is a compile error here and not a
 * silently unsized row — the rule `single-definition.test.ts` enforces across
 * this tree.
 */
export type HeightBucket =
  | 'user' | 'assistant' | 'system'
  | 'divider' | 'tool' | 'mail' | 'task' | 'pending' | 'working';

const BUCKET_MAP: Record<HeightBucket, true> = {
  user: true, assistant: true, system: true,
  divider: true, tool: true, mail: true, task: true, pending: true, working: true,
};

export const HEIGHT_BUCKETS = Object.keys(BUCKET_MAP) as HeightBucket[];

/** What a row of one kind costs: `px = a + b * lines`. */
export interface RowModel { a: number; b: number }

/** One measured row: what it was predicted to be worth, and what it cost. */
export interface RowSample { lines: number; px: number }

/** A row the list is about to show, before anything has rendered. */
export interface RowShape { bucket: HeightBucket; lines: number }

export type RowModels = Record<HeightBucket, RowModel | null>;

/** What this browser has learned, per kind, or null where it has learned
 *  nothing. A bare number is what an older build wrote: an intercept with no
 *  slope, which prices rows exactly as that build did until the first visit
 *  measures a slope. */
export function rememberedModels(s: Storage | null = store()): RowModels {
  const raw = (() => { try { return s?.getItem(KINDS_KEY) ?? null; } catch { return null; } })();
  const saved: Record<string, unknown> = (() => {
    if (raw === null) return {};
    try {
      const v: unknown = JSON.parse(raw);
      return v !== null && typeof v === 'object' ? v as Record<string, unknown> : {};
    } catch { return {}; }
  })();
  const out = {} as RowModels;
  for (const b of HEIGHT_BUCKETS) out[b] = readModel(saved[b]);
  return out;
}

function readModel(v: unknown): RowModel | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) && v > 0 ? { a: clampIntercept(v), b: 0 } : null;
  }
  if (v === null || typeof v !== 'object') return null;
  const { a, b } = v as { a?: unknown; b?: unknown };
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || na < 0) return null;
  return { a: clampIntercept(na), b: Number.isFinite(nb) ? clampSlope(nb) : 0 };
}

const clampIntercept = (a: number): number =>
  Math.min(MAX_ROW_PX, Math.max(0, a));
const clampSlope = (b: number): number =>
  Math.min(MAX_PX_PER_LINE, Math.max(0, b));

/**
 * Fit the line to what this visit measured.
 *
 * A VISIT THAT CANNOT SEE THE SLOPE KEEPS THE ONE IT WAS GIVEN, and only
 * re-seats the intercept so the line passes through what it did measure. This
 * is the difference between a model that accumulates and one that is wiped by
 * the next thin session: a visit whose rows happen to be all the same length
 * has said nothing about how height grows with text, and discarding a measured
 * slope on that silence is treating silence as evidence. Measured against four
 * live sessions, the degenerate case is common — a chat that is nearly all tool
 * cards has too few turns of any other kind to fit anything.
 *
 * A NEGATIVE SLOPE IS REFUSED rather than stored. More text cannot make a row
 * shorter; a fit that says so is noise, and the clamp turns it into "this kind
 * does not grow with its text", which is the true statement nearby.
 */
export function fitRowModel(
  samples: readonly RowSample[],
  prior: RowModel | null,
): RowModel | null {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { lines, px } of samples) {
    // Virtuoso reports a size of 0 for an item it has not measured yet, and
    // folding those in would drag every model toward zero on a fast scroll.
    if (!Number.isFinite(px) || px <= 0) continue;
    if (!Number.isFinite(lines) || lines < 0) continue;
    n += 1; sx += lines; sy += px; sxx += lines * lines; sxy += lines * px;
  }
  if (n === 0) return null;
  const mx = sx / n;
  const my = sy / n;
  const spread = sxx - n * mx * mx;   // n * variance of the predictor
  if (!(n >= MIN_FIT_ROWS && spread >= n * MIN_LINE_VARIANCE)) {
    // Nothing here can see a slope. Keep the one already learned and re-seat
    // the intercept through what this visit did measure.
    const b = clampSlope(prior?.b ?? 0);
    return { a: clampIntercept(my - b * mx), b };
  }
  const free = (sxy - n * mx * my) / spread;
  const at = my - free * mx;
  // A NEGATIVE INTERCEPT IS REFUSED BY REFITTING, not by clamping. A row
  // cannot cost less than nothing, but a fit is a pair: clamping `a` to zero
  // while keeping the slope that was computed FOR a negative one leaves a line
  // that no longer passes through its own data, and the bias is systematic —
  // measured in a browser, it put every assistant row ~40px low. The honest
  // answer under the constraint is the least-squares line THROUGH THE ORIGIN.
  const b = clampSlope(at >= 0 ? free : (sxx === 0 ? 0 : sxy / sxx));
  return { a: clampIntercept(at >= 0 ? at : 0), b };
}

/** What one row is believed to cost. A kind with no model takes the caller's
 *  GUESS — the scalar an older build left, or the shipped fallback. It is
 *  substituted HERE, at the render, and never written back, so it can never be
 *  mistaken for evidence. */
export function estimateRow(
  model: RowModel | null,
  lines: number,
  unmeasured: number,
): number {
  if (model === null) return unmeasured;
  return clampRow(model.a + model.b * Math.max(0, lines));
}

/** Every row's own estimate, in order — what the list seeds virtuoso with, so
 *  the total is right at open AND stays right as real heights replace them. */
export function rowHeights(
  rows: Iterable<RowShape>,
  models: RowModels,
  unmeasured: number,
): number[] {
  const out: number[] = [];
  for (const r of rows) out.push(estimateRow(models[r.bucket] ?? null, r.lines, unmeasured));
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

/**
 * Fold this visit's fits into what is remembered — ONCE per visit, however many
 * times this is called.
 *
 * THE BASELINE IS A PARAMETER, and that is the whole point. The blend is meant
 * to let one atypical session nudge the model rather than seize it, and the
 * previous wiring broke that guarantee without touching the arithmetic: the
 * list saved every 25 new samples, so a 200-item visit blended eight times and
 * took 94% of the distance instead of 30%. Blending from the value this VISIT
 * opened with makes every save land in the same place, so saving early — which
 * exists for the tab that is closed without running cleanup — stops being a
 * second vote.
 *
 * A kind with no sample is left exactly as it was: silence is not evidence.
 */
export function rememberModels(
  samples: ReadonlyMap<HeightBucket, readonly RowSample[]>,
  baseline: RowModels,
  s: Storage | null = store(),
): void {
  if (s === null || samples.size === 0) return;
  const raw = (() => { try { return s.getItem(KINDS_KEY); } catch { return null; } })();
  const merged: Record<string, RowModel> = (() => {
    if (raw === null) return {};
    try {
      const v: unknown = JSON.parse(raw);
      if (v === null || typeof v !== 'object') return {};
      const out: Record<string, RowModel> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const m = readModel(val);
        if (m !== null) out[k] = m;
      }
      return out;
    } catch { return {}; }
  })();
  let took = 0;
  for (const [bucket, rows] of samples) {
    const prev = baseline[bucket] ?? null;
    const fit = fitRowModel(rows, prev);
    if (fit === null) continue;
    took += 1;
    // A kind this browser has never learned takes the fit WHOLE: there is
    // nothing to blend with, and blending against the shipped fallback would
    // hold every first visit 70% of the way to a number nobody measured.
    merged[bucket] = prev === null ? fit : {
      a: clampIntercept(prev.a * (1 - BLEND) + fit.a * BLEND),
      b: clampSlope(prev.b * (1 - BLEND) + fit.b * BLEND),
    };
  }
  // A save that accepted no sample writes NOTHING. Storing the merge anyway
  // would turn "nothing was measurable" into a record, and a later read cannot
  // tell that record from a learned one.
  if (took === 0) return;
  try { s.setItem(KINDS_KEY, JSON.stringify(merged)); } catch { /* storage refused — keep the fallback */ }
}
