// The row keeper (C6): a fleet frame arrives as fresh objects, and a row that did not change must keep the object
// it had, so everything that compares rows by identity (memoised cards, selectors) sees no change for it.
//
// `prev` comes back itself when every row is `sameJson` to its counterpart in the same order; otherwise a new array
// in `next`'s order, taking `prev`'s object for each id whose row is `sameJson` and `next`'s row for the rest. The
// equality is `sameJson`, the one there is: an extra key is a change, so a revived snapshot row takes the live one.
// If `prev` holds an id twice, the first row is the one kept.
import { sameJson } from '../lib/sameJson';

export function keepRows<T extends { readonly id: string }>(prev: T[], next: T[]): T[] {
  if (prev.length === next.length && next.every((row, i) => sameJson(prev[i], row))) return prev;
  const before = new Map<string, T>();
  for (const row of prev) if (!before.has(row.id)) before.set(row.id, row);
  return next.map((row) => {
    const old = before.get(row.id);
    return old !== undefined && sameJson(old, row) ? old : row;
  });
}
