// The longest gap between animation frames while some work runs (native Docs reader, the reader lab plan of 2026-11-03,
// Task 7, refinement (j)): R19's measure (`screens/highlightMeasureRun.tsx`), moved here so the reader lab's stall
// figures are the same measure, not a second one. Ring L1: pure over an injected frame clock; no DOM of its own.

/** Awaits frames from `frame` until `during` settles, either way, and answers the longest gap between two consecutive
 *  frames, in the clock's own unit. A `during` that has settled by the first frame answers 0. */
export async function longestFrameGap(frame: () => Promise<number>, during: Promise<unknown>): Promise<number> {
  let done = false;
  void during.then(() => { done = true; }, () => { done = true; });
  let last = await frame();
  let gap = 0;
  while (!done) {
    const t = await frame();
    gap = Math.max(gap, t - last);
    last = t;
  }
  return gap;
}
