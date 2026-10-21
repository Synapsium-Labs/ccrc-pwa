// The inspector's Lane (W2 Task S8, D-5474): the session's lane as ONE meter, its name in mono. The reading is the
// lane's BINDING window, the fuller of its two (the one that runs out first), through `AccountMeterRow`, the accounts
// strip's and screen's own row, so the three-way "reset" / "0%" / "—" and the reset countdown mean what they mean
// there. The numbers come from the fleet store's `usage`, the store's one read of `GET /api/accounts`; a session route
// opens no poll of its own.
import type { ReactNode } from 'react';
import { useNow } from '@ccrc/ui';
import type { AccountUsage } from '../../../shared/api';
import { AccountMeterRow } from '../fleet/AccountMeterRow';
import { accountLabel } from '../lib/accounts';
import { useFleetStore } from '../stores/fleet';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

/** The window that binds: the fuller of the two, the 7d one on a tie (it resets later). `null` when neither is read. */
export function bindingWindow(a: AccountUsage): { label: '5h' | '7d'; pct: number | null; resetAt: number | null; rolledOver: boolean } | null {
  const five = { label: '5h' as const, pct: a.five, resetAt: a.fiveResetAt, rolledOver: a.fiveRolledOver };
  const seven = { label: '7d' as const, pct: a.seven, resetAt: a.sevenResetAt, rolledOver: a.sevenRolledOver };
  if (a.five === null && a.seven === null) return null;
  if (a.five === null) return seven;
  if (a.seven === null) return five;
  return a.five > a.seven ? five : seven;
}

function LaneBody({ wrapper }: { wrapper: string }): ReactNode {
  const roster = useFleetStore((s) => s.roster);
  const usage = useFleetStore((s) => s.usage);
  const now = useNow(30_000);
  const reading = usage?.find((a) => a.wrapper === wrapper) ?? null;
  const win = reading === null ? null : bindingWindow(reading);
  return (
    <InspectorSection id="lane" title="Lane">
      <p className="insp-lane-name">{accountLabel(roster, wrapper)}</p>
      {win === null ? (
        <p className="insp-empty">{usage === null ? 'Usage not read yet' : 'No usage reported'}</p>
      ) : (
        <AccountMeterRow
          label={win.label} pct={win.pct} resetAt={win.resetAt} nowSec={Math.floor(now / 1000)}
          rolledOver={win.rolledOver} off={reading!.disabled || reading!.authDead === true}
        />
      )}
    </InspectorSection>
  );
}

export function LaneSection(): ReactNode {
  const session = useInspectorSession();
  if (session === null) return null;
  const wrapper = session.row?.wrapper ?? null;
  return wrapper === null ? (
    <InspectorSection id="lane" title="Lane"><p className="insp-empty">Not read yet</p></InspectorSection>
  ) : <LaneBody wrapper={wrapper} />;
}
