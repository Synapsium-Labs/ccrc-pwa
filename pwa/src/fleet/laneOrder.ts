// The lanes' one order and the one decider of a lane's binding window (T2c, D-6329): the window that stops work first,
// read by the lanes row, the inspector's Lane and the row's name alike. The order is binding use, then the binding
// window's reset, then the other window's use, then the roster's (lanes-tie-break-soonest-reset). Pure L1: no I/O, types
// imported only.
import type { AccountUsage } from '../../../shared/api';

/** A lane's binding percentage: the fuller of its windows, the one that stops work first. Null when neither window
 *  was ever measured (a lane may report only the weekly one). */
export function bindingPct(a: Pick<AccountUsage, 'five' | 'seven'>): number | null {
  const known = [a.five, a.seven].filter((p): p is number => p !== null);
  return known.length === 0 ? null : Math.max(...known);
}

/** The window that binds: the fuller of the two, the 7d one on a tie (it resets later). `null` when neither is read.
 *  `pct` is `bindingPct`'s. A window rolled over (the server zeroed it; the zero is inferred) reads so only when every
 *  window at the binding percentage rolled over: on a tie, a window that was measured keeps the lane measured. */
export function bindingWindow(a: AccountUsage): { label: '5h' | '7d'; pct: number | null; resetAt: number | null; rolledOver: boolean } | null {
  const pct = bindingPct(a);
  if (pct === null) return null;
  const five = { label: '5h' as const, pct: a.five, resetAt: a.fiveResetAt, rolled: a.fiveRolledOver === true };
  const seven = { label: '7d' as const, pct: a.seven, resetAt: a.sevenResetAt, rolled: a.sevenRolledOver === true };
  const atBinding = [five, seven].filter((w) => w.pct === pct);
  const chosen = a.seven === pct ? seven : five;
  return { label: chosen.label, pct: chosen.pct, resetAt: chosen.resetAt, rolledOver: atBinding.every((w) => w.rolled) };
}

/** The lanes most free first: by binding use (`bindingPct`), lowest first. Lanes that tie on it go by the binding
 *  window's reset (`bindingWindow`'s, soonest first, so among equals the one that frees up soonest leads; a lane with no
 *  reset time after one with a reset time), then by the other window's use, lowest first (an unmeasured one after a
 *  measured one), and only then in the order given (the roster's) (lanes-tie-break-soonest-reset). A lane never read (no
 *  percentage) and a lane whose sign-in expired go last, keeping their own relative order: neither has a use that says it
 *  is free, and no tie-break applies to them. Returns a new array. */
export function lanesByFree<T extends AccountUsage>(lanes: readonly T[]): T[] {
  // Measure each lane once (binding use, its window's reset, the other window's use) and split the lanes that go last
  // (never read, or sign-in expired) off from the ones with a use to sort by, so the sort compares only numbers. An
  // absent reset or an unmeasured other window reads as Infinity: unknown goes after known. A reset already in the past
  // (a window that rolled over) is just a small number and sorts first.
  const ranked: { lane: T; pct: number; reset: number; other: number; i: number }[] = [];
  const last: T[] = [];
  lanes.forEach((lane, i) => {
    const binding = bindingWindow(lane);
    if (binding === null || binding.pct === null || lane.authDead === true) {
      last.push(lane);
      return;
    }
    const otherUse = binding.label === '5h' ? lane.seven : lane.five;
    ranked.push({ lane, pct: binding.pct, reset: binding.resetAt ?? Infinity, other: otherUse ?? Infinity, i });
  });
  // Infinity - Infinity is NaN, so the keys compare with < and > (a NaN would read as a tie and skip the later keys).
  const byKey = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);
  ranked.sort((x, y) => byKey(x.pct, y.pct) || byKey(x.reset, y.reset) || byKey(x.other, y.other) || x.i - y.i);
  return [...ranked.map((e) => e.lane), ...last];
}
