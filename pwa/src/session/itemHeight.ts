// What the chat list assumes an unmeasured item is tall — learned from this
// browser's own transcripts rather than guessed once in the source.
//
// WHY IT CANNOT BE A CONSTANT. Virtuoso needs a height for every item it has
// not measured, and the total it reports — the scrollbar — is that number times
// the count. Get it wrong and the thumb lies, then corrects as real heights
// arrive, dragging the scroll position with it. The number that makes the total
// right is the MEAN, and the mean here is decided by a handful of giants among
// a couple of hundred small rows: a collapsed tool card is ~60px and one
// assistant turn carrying two markdown tables is over 2000px. That ratio is a
// property of what THIS operator asks, not of the code, and no constant checked
// into a repository can know it. Measured 2026-09-16 on one real transcript:
// median 60px against a mean of 103px, and the mean was still an undercount.
//
// So the list measures itself. Virtuoso hands back the real pixel size of every
// item it renders (`itemsRendered`, `Item.size` — "the measured size of the
// item in pixels"); this module keeps the average of those across visits.

/** Used only until this browser has measured anything at all. */
export const FALLBACK_ITEM_HEIGHT = 96;

/** The band a learned value must land in. One transcript of nothing but giant
 *  tables must not teach the list that every row is 2000px tall, and a session
 *  of one-line dividers must not teach it that they are 20px — either way the
 *  next visit would open with the same lie, just pointing the other way. */
export const MIN_ITEM_HEIGHT = 40;
export const MAX_ITEM_HEIGHT = 600;

/** How much of a fresh visit's average is allowed to move the remembered one.
 *  Blended rather than replaced: one atypical session — a long tool-only run,
 *  a single enormous report — should nudge the estimate, not seize it. */
const BLEND = 0.3;

const KEY = 'ccrc:chat-item-height';

/** The per-bucket record. A SECOND key rather than a rewrite of the first: a
 *  browser that rolls back to an older build must keep working, and the old
 *  build reads a scalar. The old key is still the SEED for every bucket
 *  nobody has sampled yet, so an upgrade starts from what this browser already
 *  learned instead of from the fallback. */
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

/** What the OLD single-number build left in this browser, or null if it left
 *  nothing usable. Absent and unusable fold together here on purpose — both
 *  mean "nothing learned" and there is no caller that treats them apart — but
 *  neither folds into a NUMBER, because "never learned" and "learned 96" are
 *  two conditions `rememberHeights` answers differently. */
function learnedScalar(s: Storage | null): number | null {
  const raw = (() => { try { return s?.getItem(KEY) ?? null; } catch { return null; } })();
  if (raw === null) return null;
  const n = Number(raw);
  // A corrupted or hand-edited value is not a reason to render badly.
  return Number.isFinite(n) && n > 0 ? clampHeight(n) : null;
}

/** The height to open with. Read ONCE per mount by the caller: virtuoso takes
 *  `defaultItemHeight` at initialisation, so changing it later changes nothing
 *  and only risks re-running the initial positioning. */
export function rememberedHeight(s: Storage | null = store()): number {
  return learnedScalar(s) ?? FALLBACK_ITEM_HEIGHT;
}

/** The average of what was actually measured. `null` when nothing was: virtuoso
 *  reports a size of 0 for an item it has not measured yet, and averaging those
 *  in would drag the estimate toward zero on every fast scroll. */
export function meanSize(sizes: Iterable<number>): number | null {
  let sum = 0;
  let n = 0;
  for (const px of sizes) {
    if (Number.isFinite(px) && px > 0) { sum += px; n += 1; }
  }
  return n === 0 ? null : sum / n;
}

/**
 * THE POPULATION A ROW BELONGS TO, for sizing.
 *
 * WHY THIS EXISTS. One learned number had to serve every session, and the
 * sessions do not agree: modelled against virtuoso's own total, a review
 * session (mean 175px) and a debugging session (mean 73px) pull a single scalar
 * in opposite directions for ever — 56% mean error at open, converging on
 * nothing. The height of a ROW, though, is a property of the row and is stable
 * across sessions; what varies between sessions is the MIXTURE, and the list
 * already holds the mixture at mount, before anything is measured. So the
 * learned values are per bucket and the opening number is this session's own
 * composition weighed with them: 19% at open, and falling visit by visit.
 *
 * `message` splits by its event kind because a user turn and an assistant turn
 * are the two ends of the distribution and lumping them is the whole problem in
 * miniature. Every other member is its own `ChatItem` kind.
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

/**
 * What this browser has MEASURED, per bucket, or null where it has measured
 * nothing.
 *
 * THE OLD SCALAR IS NOT SEEDED IN HERE, and that is a correction rather than a
 * detail. It was, and the cost was measured in a browser: the scalar is the
 * mean of a MIXTURE, never a measurement of any one bucket, so seeding every
 * bucket with it made the first real per-bucket sample blend against a number
 * that had never described that bucket. Starting from a scalar of 240, a
 * session whose true mean is 80 still opened at 192 on the second visit and
 * needed five or six more to arrive — the fix looked inert exactly where it was
 * meant to show.
 *
 * So the scalar stays what it always was: the best available GUESS, which
 * `openingHeight` substitutes for a bucket with no measurement. A guess is not
 * evidence, and the first measurement of a bucket is therefore taken whole.
 */
export function rememberedHeights(s: Storage | null = store()): Record<HeightBucket, number | null> {
  const raw = (() => { try { return s?.getItem(KINDS_KEY) ?? null; } catch { return null; } })();
  const saved: Record<string, unknown> = (() => {
    if (raw === null) return {};
    try {
      const v: unknown = JSON.parse(raw);
      return v !== null && typeof v === 'object' ? v as Record<string, unknown> : {};
    } catch { return {}; }
  })();
  const out = {} as Record<HeightBucket, number | null>;
  for (const b of HEIGHT_BUCKETS) {
    const n = Number(saved[b]);
    out[b] = Number.isFinite(n) && n > 0 ? clampHeight(n) : null;
  }
  return out;
}

/** The number virtuoso opens with: THIS session's composition, weighed with
 *  what the buckets are worth. Read once per mount by the caller, for the
 *  reason `rememberedHeight` states. */
export function openingHeight(
  buckets: Iterable<HeightBucket>,
  learned: Record<HeightBucket, number | null>,
  unmeasured: number = FALLBACK_ITEM_HEIGHT,
): number {
  let sum = 0;
  let n = 0;
  for (const b of buckets) {
    // A bucket with no measurement takes the caller's guess — the scalar the
    // old build left, or the shipped fallback. It is substituted HERE, at the
    // render, and never written back, so it can never be mistaken for evidence.
    sum += learned[b] ?? unmeasured;
    n += 1;
  }
  // An empty transcript has no composition to weigh, and a mean of nothing is
  // not zero — it is unknown, which is what the fallback is for.
  return n === 0 ? FALLBACK_ITEM_HEIGHT : clampHeight(sum / n);
}

/**
 * Fold this visit's measured averages into what is remembered — ONCE per visit,
 * however many times this is called.
 *
 * THE BASELINE IS A PARAMETER, and that is the whole point. The blend is meant
 * to let one atypical session nudge the estimate rather than seize it, and the
 * previous wiring broke that guarantee without touching the arithmetic: the
 * list saved every 25 new samples, so a 200-item visit blended eight times and
 * took 94% of the distance instead of 30%. Blending from the value this VISIT
 * opened with makes every save land in the same place, so saving early — which
 * exists for the tab that is closed without running cleanup — stops being a
 * second vote.
 *
 * A bucket with no sample is left exactly as it was: silence is not evidence.
 */
export function rememberHeights(
  samples: ReadonlyMap<HeightBucket, number>,
  baseline: Record<HeightBucket, number | null>,
  s: Storage | null = store(),
): void {
  if (s === null || samples.size === 0) return;
  const raw = (() => { try { return s.getItem(KINDS_KEY); } catch { return null; } })();
  const merged: Record<string, number> = (() => {
    if (raw === null) return {};
    try {
      const v: unknown = JSON.parse(raw);
      return v !== null && typeof v === 'object' ? { ...v as Record<string, number> } : {};
    } catch { return {}; }
  })();
  let took = 0;
  for (const [bucket, sample] of samples) {
    if (!Number.isFinite(sample) || sample <= 0) continue;
    took += 1;
    // A bucket this browser has never learned takes the sample WHOLE: there is
    // nothing to blend with, and blending against the shipped fallback would
    // hold every first visit 70% of the way to a number nobody measured.
    const prev = baseline[bucket] ?? null;
    merged[bucket] = clampHeight(prev === null ? sample : prev * (1 - BLEND) + sample * BLEND);
  }
  // A save that accepted no sample writes NOTHING. Storing the merge anyway
  // would turn "nothing was measurable" into a record, and a later read cannot
  // tell that record from a learned one.
  if (took === 0) return;
  try { s.setItem(KINDS_KEY, JSON.stringify(merged)); } catch { /* storage refused — keep the fallback */ }
}
