// The lanes' one word home (T2c, D-6329): what a window's reading, a lane and the accounts door are called. Pure: no
// I/O, types imported only. `windowReading` is the one reading of a window (R48): a measured window is its
// percentage, a rolled-over one a zero that says it is inferred, a never-measured one a dash that says so.
import type { AccountUsage, RosterWire } from '../../../shared/api';
import { accountLabel } from '../lib/accounts';
import { formatReset } from './formatReset';
import { bindingWindow } from './laneOrder';

/** The door's bare name, the full strip's too: what it is and where it goes. */
export const ACCOUNTS_DOOR_LABEL = 'account usage — open accounts';

/** The Accounts screen's all-lanes choice, named once. */
export const ALL_ACCOUNTS = 'All accounts';

/** What a lane never read says in place of a percentage: never 0%, which would claim a measurement. */
export const NO_READING = 'no reading';

/** A window's one reading: `shown` is what prints, `spoken` what a screen reader hears. A measured window is `n%`,
 *  spoken the same; one that rolled over (the server zeroed it, so the zero is inferred, not measured) is `0%`, spoken
 *  with that said; one never measured is `—`, spoken as not measured. */
export function windowReading(pct: number | null, rolledOver: boolean): { shown: string; spoken: string } {
  // Never measured first: a window with nothing read has nothing the server could have zeroed, so no flag makes it 0%.
  if (pct === null) return { shown: '—', spoken: 'not measured' };
  if (rolledOver) return { shown: '0%', spoken: '0%, inferred: the window reset' };
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
  if (top === null) return `account usage, ${NO_READING}`;
  return `account usage, highest ${accountLabel(roster, top.lane.wrapper)} ${windowReading(top.w.pct, top.w.rolledOver).spoken}`;
}

/** A lane card's accessible name: the lane, each window it has with its spoken reading and its countdown, and where the
 *  card goes. A lane never read says `NO_READING`, never a zero. */
export function laneDoorLabel(lane: AccountUsage, roster: readonly RosterWire[], nowSec: number): string {
  const name = accountLabel(roster, lane.wrapper);
  const window = (label: string, pct: number | null, resetAt: number | null, rolledOver: boolean): string => {
    const left = resetAt === null ? null : formatReset(resetAt, nowSec);
    const when = left === null ? 'no reset time' : left === 'now' ? 'resets now' : `resets in ${left}`;
    return `${label} ${windowReading(pct, rolledOver).spoken}, ${when}`;
  };
  const windows = [
    lane.five !== null ? window('5h', lane.five, lane.fiveResetAt, lane.fiveRolledOver === true) : null,
    lane.seven !== null ? window('7d', lane.seven, lane.sevenResetAt, lane.sevenRolledOver === true) : null,
  ].filter((w): w is string => w !== null);
  return `${name}: ${windows.length === 0 ? NO_READING : windows.join('; ')} — opens ${name} on the Accounts screen`;
}
