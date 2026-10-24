// The lanes' one order and the one decider of a lane's binding window (T2c, D-6329): the window that stops work first,
// read by the lanes row, the inspector's Lane and the row's name alike. Pure L1: no I/O, types imported only.
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

/** The lanes most free first: by binding use (`bindingPct`), lowest first, ties in the order given (the roster's).
 *  A lane never read (no percentage) and a lane whose sign-in expired go last, keeping their own relative order: neither
 *  has a use that says it is free. Returns a new array. */
export function lanesByFree<T extends AccountUsage>(lanes: readonly T[]): T[] {
  const last = (a: T): boolean => a.authDead === true || bindingPct(a) === null;
  return lanes
    .map((lane, i) => ({ lane, i }))
    .sort((x, y) => {
      const lx = last(x.lane);
      const ly = last(y.lane);
      if (lx !== ly) return lx ? 1 : -1;
      if (lx) return x.i - y.i;
      return (bindingPct(x.lane) ?? 0) - (bindingPct(y.lane) ?? 0) || x.i - y.i;
    })
    .map((e) => e.lane);
}
