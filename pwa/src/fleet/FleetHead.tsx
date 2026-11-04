// The fleet screen's header — the wordmark, the readouts, and the doors the phone's bottom bar does not hold (PL10).
//
// WHY IT IS ITS OWN FILE. `FleetScreen` was ONE component with a 932-line
// body, worse than `SessionLine` was before this branch cut it. This header
// is 59 of those lines and three quarters of them are the ARGUMENT for the
// doors: why `/accounts` needs a labelled door at all (D-161 — the accounts
// strip was the only one, and its accessible name reads as data, not
// navigation), why the label is text and not a lone glyph, and why a fifth
// item makes the group wrap rather than overflow (D-3303).
//
// Those reasons are about the header, and they are why it is a component
// rather than a fragment inlined in a screen: a reader looking for "how do I
// reach settings" should land in a file that is only about that.
import type { ReactNode } from 'react';
import { Door, SETTINGS_GLYPH } from '@ccrc/ui';
import { NotificationBell } from '../fleet/NotificationBell';
import { PoolLag } from './poolLag';
import { navigate } from '../lib/router';
import '../fleet/fleet.css';

export function FleetHead(
  { countLine, poolLag, chrome = true }: {
    /** The "N sessions" readout, or `null` when the fleet is empty or the frame's status bar prints the count
     *  (Instrument at a desk, T2g). Both draw the same: nothing. */
    countLine: string | null;
    /** The account-pool projection's lag, when there is one to show. */
    poolLag: string | null;
    /** The wordmark and the doors. False where the skin's frame holds them: Refined's bar holds both, and Instrument's
     *  top bar holds the wordmark while its rail holds the doors (Refined's `Sidebar` and Instrument's `ListColumn` at a
     *  desk, W2 Task S4b, T2e): the readouts stay here, and the identity mark is drawn once. With no
     *  chrome, no count line and no lag the head draws nothing (T2g, D-6715). */
    chrome?: boolean;
  },
): ReactNode {
  // Nothing to draw: no header, so no empty box keeping its padding and the column's gap (both skins, T2g, D-6715).
  if (!chrome && countLine === null && poolLag === null) return null;
  return (
    <header className="fleet-head">
        {chrome && <span className="wordmark">ccrc</span>}
        <div className="fleet-head-right">
          {countLine !== null && <span className="fleet-count">{countLine}</span>}
          {poolLag !== null && <PoolLag text={poolLag} />}
          {chrome && (
            <>
              {/* THE PHONE'S PLACES ARE THE BOTTOM BAR'S (desktop-polish PL10, D-7952; the coordinator's ruling of 2026-11-04,
                  "the phone bar is the phone's one navigation"). This head's doors to Docs (`/docs`), Account (`/accounts`, the
                  Accounts place) and Mail (`/mail`, the Inbox place) each opened a place the bar holds, so they are gone, and
                  the doors the bar lacks stay: Settings and the bell. D-161's "a durable door to /accounts" and D-2's "the only
                  door to /mail" are the bar's Accounts and Inbox doors now, mounted on every page but an open session. */}
              {/* THE DOOR TO /settings (centralised update management §13) — the
                  `.accounts-door` pattern directly above, for the argument its
                  comment makes: a glyph AND a short text label, because an
                  icon-only gear would be exactly as undiscoverable as the
                  AccountsStrip tap target that D-161 found was the only door to
                  /accounts. The accessible name says what is behind it — updates
                  and notifications — because "Settings" alone names no content;
                  it begins with the visible word, so a voice user saying what
                  they see still reaches it. Rendered unconditionally: a first-run
                  fleet with no sessions needs the screen as much as any. A fifth
                  item does not fit this group's measured width budget on a
                  phone, so the group now wraps rather than overflowing
                  (fleet.css, D-3303). */}
              <Door
                className="settings-door"
                glyph={SETTINGS_GLYPH}
                aria-label="Settings — updates and notifications"
                onClick={() => navigate('/settings')}
              >
                Settings
              </Door>
              <NotificationBell />
            </>
          )}
        </div>
    </header>

  );
}
