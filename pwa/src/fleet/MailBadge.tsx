// The door to /mail, and the count of sessions waiting on the operator (`waitingOnYou`, T2d, D-6330). `null` is "not
// heard yet" (before the first fleet frame): the door is named plainly "Mail", never "nothing waiting", which only a
// measured 0 says.
//
// NOT a badge painted on the bell. `NotificationBell` is an aria-pressed toggle
// for Web Push; a count on it would make one control report one fact and do an
// unrelated thing (DIRECTION.md: "no state the user has to interpret"), and
// /mail would have no entry point at all. So this is a SIBLING button beside
// the bell — and, being the only door, it is always rendered, exactly as
// AccountsStrip must always render for /accounts (AccountsStrip.tsx:9-15).
import type { ReactNode } from 'react';
import { CountBadge, Icon } from '@ccrc/ui';
import { navigate } from '../lib/router';
import { badgePrint, INBOX_BADGE_UNIT } from './navBadges';
import './fleet.css';

export function MailBadge({ waiting }: { waiting: number | null }): ReactNode {
  const name = waiting === null ? 'Mail'
    : waiting > 0 ? `Mail — ${waiting} ${INBOX_BADGE_UNIT}` : `Mail — nothing ${INBOX_BADGE_UNIT}`;
  return (
    <button
      type="button"
      className="mail-badge"
      data-unread={waiting !== null && waiting > 0 ? 'true' : 'false'}
      aria-label={name}
      onClick={() => navigate('/mail')}
    >
      <span className="mail-badge-glyph" aria-hidden="true"><Icon name="mail" /></span>
      {waiting !== null && waiting > 0 && (
        <CountBadge className="mail-badge-count">{badgePrint(waiting)}</CountBadge>
      )}
    </button>
  );
}
