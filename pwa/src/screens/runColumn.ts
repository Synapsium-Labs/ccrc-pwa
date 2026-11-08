// The runs column's one layout rule (the runs rebuild, Task 9a, D-8072; spec 2026-11-04 §8.1). A run's rows, heads, cards and
// pane take their form from the width of the board's OWN column, never from the window: the column is what a skin's tokens
// leave of it. `fleet.css`'s `@container runs` thresholds spell these same numbers; skin-axis-census.test.ts reds a drift.
import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

export const RUN_COLUMN = { medium: 640, cards: 840, broad: 1240 } as const;

export type ColumnName = 'narrow' | 'medium' | 'broad';

/** The column a width falls in: narrow below 640, medium from 640, broad from 1240. */
export function columnName(width: number): ColumnName {
  if (width >= RUN_COLUMN.broad) return 'broad';
  if (width >= RUN_COLUMN.medium) return 'medium';
  return 'narrow';
}

/** The named column of the element a ref points at, or null until it is first measured. One `ResizeObserver`. */
export function useMeasuredColumn(ref: RefObject<HTMLElement | null>): ColumnName | null {
  const [name, setName] = useState<ColumnName | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    setName(columnName(el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width ?? el.clientWidth;
      setName(columnName(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return name;
}

/** The named column of the element a ref points at, narrow until it is measured. */
export function useColumnName(ref: RefObject<HTMLElement | null>): ColumnName {
  return useMeasuredColumn(ref) ?? 'narrow';
}
