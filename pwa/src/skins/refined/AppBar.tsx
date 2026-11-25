// Refined's app bar at laptop and wide (W2 Task S4b, D-5471; spec §5.3, Shell, laptop and wide rows), inside the
// frame's `<header>`. Left to right on its line: the wordmark; the tabs, the console's desk places (`deskPlacesFor`, which has
// no fleet place while D25 stands: the sessions are in the column beside every page, desktop-polish PL10, D-7952; the
// Overlord's door first and the Fleet's second while the home is the Overlord, Overlord W1 home ruled F5); the bell, search and Settings (pushed to
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
import { FaceMark } from '../../face/FaceMark';
import { AccountsStrip } from '../../fleet/AccountsStrip';
import { badgePrint, placeBadge, useNavBadges } from '../../fleet/navBadges';
import { NotificationBell } from '../../fleet/NotificationBell';
import { deskPlacesFor, FLEET_PLACE, refinedDeskPlaces, type Place } from '../../lib/places';
import { useLocation } from '../../lib/router';
import { matchRoute, ROUTES, topRouteOf } from '../../lib/routes';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useDesignationState, useHome, useOverlordShown } from '../../stores/overlord';

/** Below this width the bar is crowded once the Overlord's and the Fleet's tabs are drawn (Overlord W1 home, measured in
 *  refined-bar.browser.test.ts: at 900 the line ran 105 px past its frame and at 1100 1 px, New session cut). A crowded bar names each tab
 *  by its place's short word where it has one ("Waiting", the phone bar's word) and draws New session as its "+" alone,
 *  named "New session", as Instrument's is (slug `refined-crowded-bar-sheds-words`). Five tabs are never crowded; Flows, a desk
 *  place (flows design 2026-11-19 §9), makes the desk six, which crowd too (measured: New session cut at 900 to 1000). With the Overlord's tabs a crowded bar
 *  leaves Flows off (`refinedDeskPlaces`): eight tabs cut New session even with the short words. */
export const REF_ROOMY_QUERY = '(min-width: 1200px)';
const ROOMY_TABS = 5;

function Tab({ place, here, count, word, crowded }: { place: Place; here: boolean; count: number; word: string; crowded: boolean }): ReactNode {
  const route = ROUTES.find((r) => r.id === place.id)!;
  // The shown word starts the name, so label in name holds in both forms ("Waiting 3" in "Waiting, 3 waiting on you").
  const shown = crowded ? place.short ?? route.title : route.title;
  const id = place.id;
  return (
    <Door
      {...commandDoor(`go-${id}`)}
      glyph={null}
      aria-label={count > 0 ? `${shown}, ${count} ${word}` : shown}
      aria-current={here ? 'page' : undefined}
      className="ref-tab font-ui text-ui font-medium aria-[current=page]:text-ink-primary"
    >
      {shown}
      {count > 0 && ' '}
      {count > 0 && <CountBadge>{badgePrint(count)}</CountBadge>}
    </Door>
  );
}

export function AppBar(): ReactNode {
  const { path } = useLocation();
  // A session sits under the Fleet (`topRouteOf`, the route table's rule, which Instrument's doors read too), so the Fleet
  // tab, where it is drawn, is current on `/fleet` and on a session (plan question 14, review 3319 A5). Every other tab is
  // current on its own route, as before.
  const here = topRouteOf(path)?.id === FLEET_PLACE ? FLEET_PLACE : (matchRoute(path)?.route.id ?? null);
  const badges = useNavBadges();
  const roomy = useMediaQuery(REF_ROOMY_QUERY);
  const places = refinedDeskPlaces(deskPlacesFor(useOverlordShown(), useDesignationState(), useHome()), roomy);
  const crowded = places.length > ROOMY_TABS && !roomy;
  return (
    <>
      <div className="ref-bar">
        <Wordmark className="ref-bar-mark" />
        <FaceMark />
        <nav aria-label="Primary" className="ref-tabs">
          {places.map((place) => (
            <Tab key={place.id} place={place} here={here === place.id} crowded={crowded} {...placeBadge(place.id, badges)} />
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
          {crowded ? (
            <Button {...commandDoor('new-session')} variant="primary" size="fit" aria-label="New session" className="ref-bar-new min-w-tap justify-center">
              <span aria-hidden="true">+</span>
            </Button>
          ) : (
            <Button {...commandDoor('new-session')} variant="primary" size="fit" className="ref-bar-new gap-1">
              <span aria-hidden="true">+</span>New session
            </Button>
          )}
        </div>
      </div>
      <AccountsStrip />
    </>
  );
}
