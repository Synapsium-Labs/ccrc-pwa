// The lanes' words (T2c, D-6329): what a lane's reading and the accounts door are called, in one L1 home. Pure: no I/O,
// types imported only. Moved here unchanged from CompactGauges.tsx; a later commit replaces the reading and the name
// with the window reading both skins' cards share.
import type { AccountUsage, RosterWire } from '../../../shared/api';
import { accountLabel } from '../lib/accounts';
import { bindingPct } from './laneOrder';

/** The door's bare name, the full strip's too: what it is and where it goes. */
export const ACCOUNTS_DOOR_LABEL = 'account usage — open accounts';

/** The reading beside a lane's meter, kept three ways like the full strip's `AccountMeterRow`: "reset" when the
 *  window that binds rolled over (the server zeroed it; the zero is inferred, not measured), "—" never measured, else
 *  the measured percentage. */
export function compactReading(a: Pick<AccountUsage, 'five' | 'seven' | 'fiveRolledOver' | 'sevenRolledOver'>): string {
  const pct = bindingPct(a);
  if (pct === null) return '—';
  const binding = [
    { pct: a.five, rolled: a.fiveRolledOver === true },
    { pct: a.seven, rolled: a.sevenRolledOver === true },
  ].filter((w) => w.pct === pct);
  return binding.every((w) => w.rolled) ? 'reset' : `${pct}%`;
}

/** The door's accessible name: what it is, the fullest lane's reading, and where it goes. */
export function compactDoorLabel(lanes: readonly AccountUsage[], roster: readonly RosterWire[]): string {
  let top: AccountUsage | null = null;
  for (const a of lanes) if ((bindingPct(a) ?? -1) > (top === null ? -1 : bindingPct(top) ?? -1)) top = a;
  return top === null
    ? ACCOUNTS_DOOR_LABEL
    : `account usage, highest ${accountLabel(roster, top.wrapper)} ${compactReading(top)} — open accounts`;
}
