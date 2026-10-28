// useRowWidth — the measure behind the strip's fold (desktop polish S5b, D-6530; the operator's ruling Q13; S5c). A
// `ResizeObserver` on the element that holds the lanes' cards answers its CONTENT width and its computed `column-gap`,
// both in px, and the number of column TRACKS its grid draws. `stripFold.ts`'s `rowFit` turns the width and gap into the
// desk's track count; the phone's grid has no card floor to fit, so its count is the drawn tracks read here. This file
// only measures and decides nothing. L4: it owns a browser observer and a piece of state.
//
// THE ANSWER. `null` before the first measure, and wherever `ResizeObserver` is absent (a server render, an old
// engine): the caller folds nothing then, as for an unmeasured row. A width of 0 passes through as it is, because
// `rowFit` reads it as unmeasured too (jsdom, a hidden row): one reading of "not a measurement", in one place. A
// `column-gap` that does not parse to a number reads 0: jsdom evaluates no stylesheet, so its computed gap is the
// word `normal` or empty, and a real engine answers `normal` for a grid that sets none.
//
// THE TRACKS. `tracks` is the number of whitespace-separated entries of the computed `grid-template-columns`: a real
// engine resolves a grid container's value to its used track sizes ('157px 157px' at a 390 px phone, four 145.5px
// entries at 700). An empty value, `none` or anything that is not a list of lengths (jsdom answers '') reads `null`,
// as an unmeasured row does. Crossing the 700 px breakpoint changes the track count but not the group's content
// width; the strip's height changes then (the cards re-flow), and `ResizeObserver` reports a content-box change in
// width OR height, so the callback still fires and re-reads the tracks.
//
// THE ELEMENT. The cards' group is not always mounted (the strip's placeholder states have no group), so the hook hands
// back a callback ref and watches whichever element holds it, re-observing when it changes. It measures at every width:
// the phone needs its tracks too.
import { useCallback, useEffect, useState } from 'react';

/** One measure of the cards' group: its content width and its column gap, in px, and the column tracks its grid draws
 *  (`null` when the computed track list is empty, `none` or not a list of lengths). */
export interface RowWidth {
  readonly width: number;
  readonly gap: number;
  readonly tracks: number | null;
}

/** The column tracks a computed `grid-template-columns` names: its entries, `null` for a value that is not a list of
 *  lengths (absent, empty, `none`, `repeat(...)`, a name). A real engine answers used sizes in px for a grid. */
function trackCount(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const entries = value.trim().split(/\s+/);
  return entries.length > 0 && entries.every((e) => /^-?\d*\.?\d+(?:px)?$/.test(e)) ? entries.length : null;
}

/** The measure of the element given to `ref`, or `null` while unmeasured. */
export function useRowWidth(): { ref: (el: HTMLElement | null) => void; row: RowWidth | null } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [row, setRow] = useState<RowWidth | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useEffect(() => {
    if (el === null || typeof ResizeObserver === 'undefined') {
      setRow(null);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      const style = getComputedStyle(el);
      const gap = Number.parseFloat(style.columnGap);
      const next: RowWidth = { width: entry.contentRect.width, gap: Number.isFinite(gap) ? gap : 0, tracks: trackCount(style.gridTemplateColumns) };
      // A re-observe with the same figures is no change: keep the object, so nothing downstream re-renders for it.
      setRow((prev) => (prev !== null && prev.width === next.width && prev.gap === next.gap && prev.tracks === next.tracks ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  return { ref, row };
}
