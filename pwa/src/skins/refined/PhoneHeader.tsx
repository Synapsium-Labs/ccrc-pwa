// Refined's phone header (W2 Task S5, D-5471; spec §5.3, Fleet and Shell, phone rows), the fleet column's head on a
// phone. One row: the wordmark, then the Settings door, a registry command (`commandDoor`, the plan's door table). The
// places it held until PL10 (Waiting on you, Inbox, Runs, Docs, each badged by its count) are the phone's bottom bar's now
// (`PhoneBar`, desktop-polish PL10, D-7952; D25), which shows on every page but an open session, so the header keeps only
// the door the bar does not hold (the coordinator's ruling on PL10's question, 2026-11-04).
// Under it one mono readout, `fleetSummary`'s, and then the accounts strip: a group of lane cards (a row for each window
// it has, a meter and the reset countdown), each card a door to its own lane on the Accounts screen. The strip folds to its
// freest four lanes with a "+n more" control (the fold is the strip's own, stripFold.ts); one tap shows the lanes it folds
// away in a panel.
//
// THIS HEADER AND THAT PANEL ARE A PHONE'S ONLY: the frame mounts this head in the fleet column below 900 px alone. At the
// desk the strip sits under the app bar, and that strip draws All accounts at its end, the `go-accounts` door, and opens no
// panel; on a phone the bar's Accounts door is the only one (review 1466 F3; review 1511 F2). Docs is the bar's, one tap from every page
// (S17). The bell is Settings' (its notifications section renders it), one tap from the Settings door. Every count comes
// from a shared function (`fleetSummary`, `poolLagText`); this file holds markup and its own class names only.
import type { ReactNode } from 'react';
import { Door, Icon, Wordmark } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { FaceMark } from '../../face/FaceMark';
import { AccountsStrip } from '../../fleet/AccountsStrip';
import { useFleetChrome } from '../../fleet/FleetChrome';
import { fleetSummary } from '../../fleet/fleetSummary';
import { PoolLag, poolLagText } from '../../fleet/poolLag';
import { UpdateIndicator } from '../../fleet/UpdateIndicator';

export function PhoneHeader(): ReactNode {
  const useStore = useFleetChrome().store;
  const sessions = useStore((s) => s.sessions);
  const runs = useStore((s) => s.runs);
  const runsFrameSeen = useStore((s) => s.runsFrameSeen);
  const pools = useStore((s) => s.pools);
  // Runs before their first frame are unknown, not none: the readout leaves the part out (`fleetSummary`'s contract).
  const summary = fleetSummary(sessions, runsFrameSeen ? runs : null);
  const lag = poolLagText(pools?.epoch, pools?.observedEpoch);
  return (
    <header className="ref-phone-head">
      <div className="ref-phone-row">
        <Wordmark className="ref-phone-mark" />
        <FaceMark />
        <div className="ref-phone-doors">
          <Door {...commandDoor('go-settings')} glyph={<Icon name="settings" />} aria-label="Settings" className="ref-phone-door min-w-tap justify-center">
            {null}
          </Door>
        </div>
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
