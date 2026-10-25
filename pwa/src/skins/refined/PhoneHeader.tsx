// Refined's phone header (W2 Task S5, D-5471; spec §5.3, Fleet and Shell, phone rows), the fleet column's head on a
// phone. One row: the wordmark, then four icon doors (Inbox, Runs, Docs, Settings), each a registry command
// (`commandDoor`, the plan's door table), each named by its word, a badged one by its count too ("Inbox, 3 unread").
// Under it one mono readout, `fleetSummary`'s, and then the full accounts strip: each lane's 5h and 7d rows, a meter
// and the reset countdown, two columns, the whole strip one door to /accounts (the `go-accounts` door).
//
// DOCS, NOT ACCOUNT, among the four doors: the accounts strip is already the door to /accounts, one tap away, and a phone
// must keep Docs within two taps (S17). The bell is Settings' (its notifications section renders it), one tap from the
// Settings door. Every count comes from a shared function (`fleetSummary`, `useNavBadges`, `poolLagText`); this file
// holds markup and its own class names only.
import type { ReactNode } from 'react';
import { CountBadge, Door, Icon, Wordmark } from '@ccrc/ui';
import type { IconName } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { AccountsStrip } from '../../fleet/AccountsStrip';
import { useFleetChrome } from '../../fleet/FleetChrome';
import { fleetSummary } from '../../fleet/fleetSummary';
import { useNavBadges } from '../../fleet/navBadges';
import { PoolLag, poolLagText } from '../../fleet/poolLag';
import { UpdateIndicator } from '../../fleet/UpdateIndicator';

/** A badge's printed cap; the accessible name carries the real number (the app bar's rule). */
const PRINT_CAP = 99;

function HeadDoor({ id, icon, word, count = 0, unit = '' }: {
  id: string; icon: IconName; word: string; count?: number; unit?: string;
}): ReactNode {
  return (
    <Door
      {...commandDoor(id)}
      glyph={<Icon name={icon} />}
      aria-label={count > 0 ? `${word}, ${count} ${unit}` : word}
      className="ref-phone-door min-w-tap justify-center"
    >
      {count > 0 && <CountBadge className="ref-phone-badge">{count > PRINT_CAP ? `${PRINT_CAP}+` : count}</CountBadge>}
    </Door>
  );
}

export function PhoneHeader(): ReactNode {
  const useStore = useFleetChrome().store;
  const sessions = useStore((s) => s.sessions);
  const runs = useStore((s) => s.runs);
  const runsFrameSeen = useStore((s) => s.runsFrameSeen);
  const pools = useStore((s) => s.pools);
  const { unreadMail, openRuns } = useNavBadges();
  // Runs before their first frame are unknown, not none: the readout leaves the part out (`fleetSummary`'s contract).
  const summary = fleetSummary(sessions, runsFrameSeen ? runs : null);
  const lag = poolLagText(pools?.epoch, pools?.observedEpoch);
  return (
    <header className="ref-phone-head">
      <div className="ref-phone-row">
        <Wordmark className="ref-phone-mark" />
        <nav aria-label="Primary" className="ref-phone-doors">
          <HeadDoor id="go-inbox" icon="inbox" word="Inbox" count={unreadMail} unit="unread" />
          <HeadDoor id="go-runs" icon="list-checks" word="Runs" count={openRuns ?? 0} unit="active" />
          <HeadDoor id="go-docs" icon="file-text" word="Docs" />
          <HeadDoor id="go-settings" icon="settings" word="Settings" />
        </nav>
      </div>
      {/* An empty fleet says nothing here: the list below says it, and "0 sessions" during the first connect is not
          yet a fact. */}
      {(summary.sessions > 0 || lag !== null) && (
        <p className="ref-phone-sub">
          {summary.sessions > 0 && <span className="fleet-count">{summary.readout}</span>}
          {lag !== null && <PoolLag text={lag} />}
        </p>
      )}
      <AccountsStrip />
      <UpdateIndicator form="row" />
    </header>
  );
}
