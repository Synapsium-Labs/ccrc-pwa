// The phone's bottom bar (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D25), the skin contract's `PhoneNav` part, which
// both skins fill with this one component inside the frame's `<nav aria-label="Navigation">`. The frame mounts it below 900
// only, and not in an open session, where the composer owns the bottom of the screen (`phoneBarShown`): mounted, never
// CSS-hidden, like every width-gated part.
//
// ITS DOORS ARE THE CONSOLE'S PLACES, fleet first (`PLACES`, `lib/places.ts`, the one list both desk bars read
// too), then the Search door. Each place is the registry's "Go to" command (`commandDoor('go-<id>')`), named by its route's
// title and, while it counts something, by its count too ("Inbox, 2 waiting for you", `placeBadge`); the place the page is on
// or under carries `aria-current="page"` (`topRouteOf`, the reader of Instrument's top bar doors too). Search is
// `commandDoor('open-palette')`, the desk bar's search door. This file holds markup and its own class names only
// (`styles/shell.css`).
import type { ReactNode } from 'react';
import { CountBadge, Door, Icon } from '@ccrc/ui';
import { commandDoor } from '../command/door';
import { badgePrint, placeBadge, useNavBadges } from '../fleet/navBadges';
import { PLACES, type Place } from '../lib/places';
import { useLocation } from '../lib/router';
import { ROUTES, topRouteOf } from '../lib/routes';

/** `ROUTES`' title for a place, so the bar never spells a place's name of its own. */
function titleOf(id: string): string {
  const route = ROUTES.find((r) => r.id === id);
  if (route === undefined) throw new Error(`PLACES names ${id}, which is not a route`);
  return route.title;
}

function PlaceDoor({ place, here, count, word }: { place: Place; here: boolean; count: number; word: string }): ReactNode {
  const title = titleOf(place.id);
  return (
    <Door
      {...commandDoor(`go-${place.id}`)}
      glyph={<Icon name={place.icon} />}
      aria-label={count > 0 ? `${title}, ${count} ${word}` : title}
      aria-current={here ? 'page' : undefined}
      className="phone-bar-door"
    >
      <span className="phone-bar-word" aria-hidden="true">{place.short ?? title}</span>
      {count > 0 && ' '}
      {count > 0 && <CountBadge className="phone-bar-count" aria-hidden="true">{badgePrint(count)}</CountBadge>}
    </Door>
  );
}

export function PhoneBar(): ReactNode {
  const { path } = useLocation();
  const here = topRouteOf(path)?.id ?? null;
  const badges = useNavBadges();
  return (
    <div className="phone-bar">
      {PLACES.map((place) => <PlaceDoor key={place.id} place={place} here={here === place.id} {...placeBadge(place.id, badges)} />)}
      <Door {...commandDoor('open-palette')} glyph={<Icon name="search" />} aria-label="Search and commands" className="phone-bar-door">
        <span className="phone-bar-word" aria-hidden="true">Search</span>
      </Door>
    </div>
  );
}
