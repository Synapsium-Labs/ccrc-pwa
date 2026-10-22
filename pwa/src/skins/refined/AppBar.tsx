// Refined's app bar at laptop and wide (W2 Task S4b, D-5471; spec §5.3, Shell, laptop and wide rows), inside the
// frame's `<header>`. Left to right: the wordmark; the five tabs; the compact lane gauges; the bell, search and
// Settings; `+ New session`.
//
// EVERY CONTROL IS A DOOR (the plan's door table): each tab, the gauges, search, Settings and New session is built
// with `commandDoor(id)`, so the bar and the palette run the same command with the same context. A tab's place comes
// from `ROUTES` (its title, and whether it is current), never from a path written here. Its badge comes from the one
// function the fleet's own door reads (`useNavBadges`), and a badged tab says its count in its name ("Inbox, 3
// unread"). This file holds markup and its own class names only.
import type { ReactNode } from 'react';
import { Button, CountBadge, Door, Icon, Wordmark } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { AccountsStrip } from '../../fleet/AccountsStrip';
import { useNavBadges } from '../../fleet/navBadges';
import { NotificationBell } from '../../fleet/NotificationBell';
import { UpdateIndicator } from '../../fleet/UpdateIndicator';
import { useLocation } from '../../lib/router';
import { matchRoute, ROUTES } from '../../lib/routes';

/** The bar's places, in its order (spec §5.3): each is a `ROUTES` id. */
export const TAB_IDS = ['fleet', 'inbox', 'runs', 'accounts', 'docs'] as const;
type TabId = (typeof TAB_IDS)[number];

/** A badge's printed cap; the accessible name carries the real number. */
const PRINT_CAP = 99;

function Tab({ id, here, count, word }: { id: TabId; here: boolean; count: number; word: string }): ReactNode {
  const route = ROUTES.find((r) => r.id === id)!;
  return (
    <Door
      {...commandDoor(`go-${id}`)}
      glyph={null}
      aria-label={count > 0 ? `${route.title}, ${count} ${word}` : route.title}
      aria-current={here ? 'page' : undefined}
      className="ref-tab font-ui text-ui font-medium aria-[current=page]:text-ink-primary"
    >
      {route.title}
      {count > 0 && <CountBadge>{count > PRINT_CAP ? `${PRINT_CAP}+` : count}</CountBadge>}
    </Door>
  );
}

export function AppBar(): ReactNode {
  const { path } = useLocation();
  const here = matchRoute(path)?.route.id ?? null;
  const { unreadMail, openRuns } = useNavBadges();
  const badge = (id: TabId): { count: number; word: string } =>
    id === 'inbox' ? { count: unreadMail, word: 'unread' } : id === 'runs' ? { count: openRuns ?? 0, word: 'active' } : { count: 0, word: '' };
  return (
    <div className="ref-bar">
      <Wordmark className="ref-bar-mark" />
      <nav aria-label="Primary" className="ref-tabs">
        {TAB_IDS.map((id) => (
          <Tab key={id} id={id} here={here === id} {...badge(id)} />
        ))}
      </nav>
      <div className="ref-bar-gauges">
        <AccountsStrip compact="bar" />
      </div>
      <div className="ref-bar-doors">
        <UpdateIndicator form="bar" />
        <NotificationBell />
        <Door {...commandDoor('open-palette')} glyph={<Icon name="search" />} aria-label="Search and commands" className="ref-bar-door">
          <kbd className="ref-bar-key font-mono">⌘K</kbd>
        </Door>
        <Door {...commandDoor('go-settings')} glyph={<Icon name="settings" />} aria-label="Settings" className="ref-bar-door">
          <span className="sr-only">Settings</span>
        </Door>
        <Button {...commandDoor('new-session')} variant="primary" size="fit" className="ref-bar-new gap-1">
          <span aria-hidden="true">+</span>New session
        </Button>
      </div>
    </div>
  );
}
