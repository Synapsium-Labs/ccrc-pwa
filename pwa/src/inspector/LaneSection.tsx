// The inspector's Lane (W2 Task S8, D-5474): the session's lane as ONE meter, its name in mono. The reading is the
// lane's BINDING window, the fuller of its two (the one that runs out first, `bindingWindow`'s in laneOrder.ts), through
// `AccountMeterRow`, the accounts strip's and screen's own row; a rolled-over window reads "0%" through `windowReading`
// (laneWords.ts), spoken as inferred, and the reset countdown means what it means there. The numbers come from the
// fleet store's `usage`, the store's one read of `GET /api/accounts`; a session route opens no poll of its own.
import type { ReactNode } from 'react';
import { useNow } from '@ccrc/ui';
import { AccountMeterRow } from '../fleet/AccountMeterRow';
import { bindingWindow } from '../fleet/laneOrder';
import { accountLabel } from '../lib/accounts';
import { useFleetStore } from '../stores/fleet';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

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
