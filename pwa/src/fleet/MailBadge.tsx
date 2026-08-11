// The door to /mail, and the feed's unread count.
//
// NOT a badge painted on the bell. `NotificationBell` is an aria-pressed toggle
// for Web Push; a count on it would make one control report one fact and do an
// unrelated thing (DIRECTION.md: "no state the user has to interpret"), and
// /mail would have no entry point at all. So this is a SIBLING button beside
// the bell — and, being the only door, it is always rendered, exactly as
// AccountsStrip must always render for /accounts (AccountsStrip.tsx:9-15).
import type { ReactNode } from 'react';
import { navigate } from '../lib/router';
import './fleet.css';

/** Printed cap. The accessible name still carries the REAL number — a count a
 *  screen reader announces as "99 plus" when it is 412 is a different lie from
 *  a narrow chip. */
const PRINT_CAP = 99;

export function MailBadge({ unread }: { unread: number }): ReactNode {
  return (
    <button
      type="button"
      className="mail-badge"
      data-unread={unread > 0 ? 'true' : 'false'}
      aria-label={unread > 0 ? `Mail — ${unread} unread` : 'Mail — nothing unread'}
      onClick={() => navigate('/mail')}
    >
      <span className="mail-badge-glyph" aria-hidden="true">✉</span>
      {unread > 0 && (
        <span className="mail-badge-count">{unread > PRINT_CAP ? `${PRINT_CAP}+` : unread}</span>
      )}
    </button>
  );
}
