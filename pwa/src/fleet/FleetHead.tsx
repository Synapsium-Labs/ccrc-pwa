// The fleet screen's header — the wordmark, the readouts, and the four doors.
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
import { MailBadge } from '../fleet/MailBadge';
import { NotificationBell } from '../fleet/NotificationBell';
import { navigate } from '../lib/router';
import '../fleet/fleet.css';

export function FleetHead(
  { countLine, poolLag, unreadMail }: {
    /** The "N sessions" readout, or `null` on an empty fleet. */
    countLine: string | null;
    /** The account-pool projection's lag, when there is one to show. */
    poolLag: string | null;
    unreadMail: number;
  },
): ReactNode {
  return (
    <header className="fleet-head">
        <span className="wordmark">ccrc</span>
        <div className="fleet-head-right">
          {countLine !== null && <span className="fleet-count">{countLine}</span>}
          {poolLag !== null && (
            <span className="pool-epoch-lag" data-testid="pool-epoch-lag" title="account-pool projection lag">
              {poolLag}
            </span>
          )}
          {/* THE DURABLE DOOR TO /accounts (D-161). The AccountsStrip tap
              target was the only one — its own comment says so — and its
              accessible name is "account usage — open accounts": a full-width
              readout of 5h/7d meters, which reads as DATA and not as
              navigation. /runs, /archive and /mail each have an explicit
              control; the screen carrying the passkey enrolment button and the
              sign-out button had none, so the operator hunting for it on a
              laptop never found the screen at all. The strip STAYS a door (a
              second one costs nothing and it is where a gauge is being looked
              at anyway); this is the one that says what it is.

              A SHORT TEXT LABEL, not a lone glyph: icon-only would be exactly
              as undiscoverable as the strip, which is the defect. The
              accessible name names both halves of the screen — sign-in and
              accounts — because "Account" alone is what the strip already
              failed to communicate. */}
          <Door
            className="accounts-door"
            glyph="🔑"
            aria-label="Your sign-in and accounts"
            onClick={() => navigate('/accounts')}
          >
            Account
          </Door>
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
          <MailBadge unread={unreadMail} />
          <NotificationBell />
        </div>
    </header>

  );
}
