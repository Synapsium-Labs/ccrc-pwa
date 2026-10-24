// The lanes' one order and the one decider of a lane's binding window (T2c, D-6329): the window that stops work first,
// read by the lanes row, the inspector's Lane and the row's name alike. Pure L1: no I/O, types imported only.
import type { AccountUsage } from '../../../shared/api';

/** A lane's binding percentage: the fuller of its windows, the one that stops work first. Null when neither window
 *  was ever measured (a lane may report only the weekly one). */
export function bindingPct(a: Pick<AccountUsage, 'five' | 'seven'>): number | null {
  const known = [a.five, a.seven].filter((p): p is number => p !== null);
  return known.length === 0 ? null : Math.max(...known);
}

/** The window that binds: the fuller of the two, the 7d one on a tie (it resets later). `null` when neither is read. */
export function bindingWindow(a: AccountUsage): { label: '5h' | '7d'; pct: number | null; resetAt: number | null; rolledOver: boolean } | null {
  const five = { label: '5h' as const, pct: a.five, resetAt: a.fiveResetAt, rolledOver: a.fiveRolledOver };
  const seven = { label: '7d' as const, pct: a.seven, resetAt: a.sevenResetAt, rolledOver: a.sevenRolledOver };
  if (a.five === null && a.seven === null) return null;
  if (a.five === null) return seven;
  if (a.seven === null) return five;
  return a.five > a.seven ? five : seven;
}
