// useRowWidth — the measure behind the desk's one-line fold (desktop polish S5b, D-6530; the operator's ruling Q13).
// A `ResizeObserver` on the element that holds the lanes' cards answers its CONTENT width and its computed
// `column-gap`, both in px; `stripFold.ts`'s `rowFit` turns them into a track count, so this file only measures and
// decides nothing. L4: it owns a browser observer and a piece of state.
//
// THE ANSWER. `null` before the first measure, and wherever `ResizeObserver` is absent (a server render, an old
// engine): the caller folds nothing then, as for an unmeasured row. A width of 0 passes through as it is, because
// `rowFit` reads it as unmeasured too (jsdom, a hidden row): one reading of "not a measurement", in one place. A
// `column-gap` that does not parse to a number reads 0: jsdom evaluates no stylesheet, so its computed gap is the
// word `normal` or empty, and a real engine answers `normal` for a grid that sets none.
//
// THE ELEMENT. The cards' group is not always mounted (the strip's placeholder states have no group), so the hook hands
// back a callback ref and watches whichever element holds it, re-observing when it changes. `enabled` false (a phone,
// which folds to a lane count and measures nothing) observes nothing and answers `null`.
import { useCallback, useEffect, useState } from 'react';

/** One measure of the cards' group: its content width and its column gap, in px. */
export interface RowWidth {
  readonly width: number;
  readonly gap: number;
}

/** The measure of the element given to `ref`, or `null` while unmeasured or disabled. */
export function useRowWidth(enabled: boolean): { ref: (el: HTMLElement | null) => void; row: RowWidth | null } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [row, setRow] = useState<RowWidth | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useEffect(() => {
    if (!enabled || el === null || typeof ResizeObserver === 'undefined') {
      setRow(null);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      const gap = Number.parseFloat(getComputedStyle(el).columnGap);
      const next: RowWidth = { width: entry.contentRect.width, gap: Number.isFinite(gap) ? gap : 0 };
      // A re-observe with the same figures is no change: keep the object, so nothing downstream re-renders for it.
      setRow((prev) => (prev !== null && prev.width === next.width && prev.gap === next.gap ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, el]);

  return { ref, row };
}
