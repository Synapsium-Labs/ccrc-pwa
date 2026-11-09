// Refined's app bar at laptop and wide (W2 Task S4b, D-5471; spec §5.3, Shell, laptop and wide rows), inside the
// frame's `<header>`. Left to right on its line: the wordmark; the tabs, the console's desk places (`DESK_PLACES`, which has
// no fleet place: the sessions are in the column beside every page, desktop-polish PL10, D-7952); the bell, search and Settings (pushed to
// the line's right edge); `+ New session`. Under the line the header holds the lanes row, the full accounts strip
// (T2c, D-6329): every lane's card, one instance, since the bar mounts only at the desk.
//
// EVERY CONTROL IS A DOOR (the plan's door table): each tab, search, Settings and New session is built
// with `commandDoor(id)`, so the bar and the palette run the same command with the same context. A tab's place comes
// from `ROUTES` (its title, and whether it is current), never from a path written here. Its badge comes from the one
// function the fleet's own door reads (`useNavBadges`, through `placeBadge`), and a badged tab says its count in its name
// ("Inbox, 2 waiting for you"). This file holds markup and its own class names only.
import type { ReactNode } from 'react';
import { Button, CountBadge, Door, Icon, Wordmark } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { AccountsStrip } from '../../fleet/AccountsStrip';
import { badgePrint, placeBadge, useNavBadges } from '../../fleet/navBadges';
import { NotificationBell } from '../../fleet/NotificationBell';
import { DESK_PLACES } from '../../lib/places';
import { useLocation } from '../../lib/router';
import { matchRoute, ROUTES } from '../../lib/routes';

function Tab({ id, here, count, word }: { id: string; here: boolean; count: number; word: string }): ReactNode {
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
      {count > 0 && ' '}
      {count > 0 && <CountBadge>{badgePrint(count)}</CountBadge>}
    </Door>
  );
}

export function AppBar(): ReactNode {
  const { path } = useLocation();
  const here = matchRoute(path)?.route.id ?? null;
  const badges = useNavBadges();
  return (
    <>
      <div className="ref-bar">
        <Wordmark className="ref-bar-mark" />
        <nav aria-label="Primary" className="ref-tabs">
          {DESK_PLACES.map(({ id }) => (
            <Tab key={id} id={id} here={here === id} {...placeBadge(id, badges)} />
          ))}
        </nav>
        <div className="ref-bar-doors">
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
      <AccountsStrip />
    </>
  );
}
