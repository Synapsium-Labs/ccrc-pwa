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
