// The lanes' one word home (T2c, D-6329): what a window's reading, a lane and the accounts door are called. Pure: no
// I/O, types imported only. `windowReading` is the one reading of a window (R48): a measured window is its
// percentage, a rolled-over one a zero that says it is inferred, a never-measured one a dash that says so.
import type { AccountUsage, RosterWire } from '../../../shared/api';
import { accountLabel } from '../lib/accounts';
import { bindingWindow } from './laneOrder';

/** The door's bare name, the full strip's too: what it is and where it goes. */
export const ACCOUNTS_DOOR_LABEL = 'account usage — open accounts';

/** A window's one reading: `shown` is what prints, `spoken` what a screen reader hears. A measured window is `n%`,
 *  spoken the same; one that rolled over (the server zeroed it, so the zero is inferred, not measured) is `0%`, spoken
 *  with that said; one never measured is `—`, spoken as not measured. */
export function windowReading(pct: number | null, rolledOver: boolean): { shown: string; spoken: string } {
  if (rolledOver) return { shown: '0%', spoken: '0%, inferred: the window reset' };
  if (pct === null) return { shown: '—', spoken: 'not measured' };
  return { shown: `${pct}%`, spoken: `${pct}%` };
}

/** The row's accessible name: the fullest of EVERY lane given, by its binding window, in `windowReading`'s spoken
 *  words; "no reading" when no lane was read. The group is no door, so no "open accounts". */
export function lanesRowLabel(lanes: readonly AccountUsage[], roster: readonly RosterWire[]): string {
  let top: { lane: AccountUsage; w: NonNullable<ReturnType<typeof bindingWindow>>; pct: number } | null = null;
  for (const lane of lanes) {
    const w = bindingWindow(lane);
    if (w === null || w.pct === null) continue;
    if (top === null || w.pct > top.pct) top = { lane, w, pct: w.pct };
  }
  if (top === null) return 'account usage, no reading';
  return `account usage, highest ${accountLabel(roster, top.lane.wrapper)} ${windowReading(top.w.pct, top.w.rolledOver).spoken}`;
}
