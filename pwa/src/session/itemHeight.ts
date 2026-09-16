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

/** The height to open with. Read ONCE per mount by the caller: virtuoso takes
 *  `defaultItemHeight` at initialisation, so changing it later changes nothing
 *  and only risks re-running the initial positioning. */
export function rememberedHeight(s: Storage | null = store()): number {
  const raw = (() => { try { return s?.getItem(KEY) ?? null; } catch { return null; } })();
  if (raw === null) return FALLBACK_ITEM_HEIGHT;
  const n = Number(raw);
  // A corrupted or hand-edited value is not a reason to render badly.
  return Number.isFinite(n) && n > 0 ? clampHeight(n) : FALLBACK_ITEM_HEIGHT;
}

/** Fold this visit's measured average into what is remembered. */
export function rememberHeight(sampleMean: number, s: Storage | null = store()): void {
  if (!Number.isFinite(sampleMean) || sampleMean <= 0 || s === null) return;
  const raw = (() => { try { return s.getItem(KEY); } catch { return null; } })();
  const prev = raw === null ? null : Number(raw);
  const next = prev !== null && Number.isFinite(prev) && prev > 0
    ? prev * (1 - BLEND) + sampleMean * BLEND
    : sampleMean;
  try { s.setItem(KEY, String(clampHeight(next))); } catch { /* storage refused — keep the fallback */ }
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
