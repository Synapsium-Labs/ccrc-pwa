// The phone's bottom bar (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D25), the skin contract's `PhoneNav` part, which
// both skins fill with this one component inside the frame's `<nav aria-label="Navigation">`. The frame mounts it below 900
// only, and not in an open session, where the composer owns the bottom of the screen (`phoneBarShown`): mounted, never
// CSS-hidden, like every width-gated part.
//
// ITS DOORS ARE THE CONSOLE'S PLACES (`placesFor`, `lib/places.ts`, the one derivation both desk bars read too): the
// Overlord's first while its door is drawn, then the fleet, and then the Search door. As many places as fit at the tap
// minimum beside Search are drawn (`phoneDoorsFit`, over the bar's own measured width), dropped from the end of the list;
// a dropped place stays reachable through Search (Overlord W1 home, plan question 13). Each place is the registry's "Go to" command (`commandDoor('go-<id>')`), named by the word it
// shows (its route's title, or the place's `short` word where it has one: "Waiting", review 1722) and, while it counts
// something, by its count too ("Inbox, 2 waiting for you", "Waiting, 3 waiting on you", `placeBadge`); the place the page is on
// or under carries `aria-current="page"` (`topRouteOf`, the reader of Instrument's top bar doors too). Search is
// `commandDoor('open-palette')`, the desk bar's search door. This file holds markup and its own class names only
// (`styles/shell.css`).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CountBadge, Door, Icon } from '@ccrc/ui';
import { commandDoor } from '../command/door';
import { badgePrint, placeBadge, useNavBadges } from '../fleet/navBadges';
import { phoneDoorsFit, placesFor, type Place } from '../lib/places';
import { useLocation } from '../lib/router';
import { ROUTES, topRouteOf } from '../lib/routes';
import { useDesignationState, useOverlordShown } from '../stores/overlord';

/** `ROUTES`' title for a place, so the bar never spells a place's name of its own. */
function titleOf(id: string): string {
  const route = ROUTES.find((r) => r.id === id);
  if (route === undefined) throw new Error(`placesFor names ${id}, which is not a route`);
  return route.title;
}

/** A place's door. Its name starts with the word it shows, so the whole shown text ("Waiting 3") is in the name (label in
 *  name, D-7897): a place with a `short` word is named by it on the phone bar, where the desk bars name it by its title. */
function PlaceDoor({ place, here, count, word }: { place: Place; here: boolean; count: number; word: string }): ReactNode {
  const shown = place.short ?? titleOf(place.id);
  return (
    <Door
      {...commandDoor(`go-${place.id}`)}
      glyph={<Icon name={place.icon} />}
      aria-label={count > 0 ? `${shown}, ${count} ${word}` : shown}
      aria-current={here ? 'page' : undefined}
      className="phone-bar-door"
    >
      <span className="phone-bar-word" aria-hidden="true">{shown}</span>
      {count > 0 && ' '}
      {count > 0 && <CountBadge className="phone-bar-count" aria-hidden="true">{badgePrint(count)}</CountBadge>}
    </Door>
  );
}

/** The bar's own width, measured: the window's until the bar is laid out, then its box's, followed as it resizes. */
function useBarWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  const ref = useRef(setEl);
  useLayoutEffect(() => {
    if (el === null) return undefined;
    const measure = (): void => { if (el.clientWidth > 0) setWidth(el.clientWidth); };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref.current, width];
}

export function PhoneBar(): ReactNode {
  const { path } = useLocation();
  const here = topRouteOf(path)?.id ?? null;
  const badges = useNavBadges();
  const places = placesFor(useOverlordShown(), useDesignationState());
  const [barRef, width] = useBarWidth();
  return (
    <div className="phone-bar" ref={barRef}>
      {phoneDoorsFit(width, places).map((place) => <PlaceDoor key={place.id} place={place} here={here === place.id} {...placeBadge(place.id, badges)} />)}
      <Door {...commandDoor('open-palette')} glyph={<Icon name="search" />} aria-label="Search and commands" className="phone-bar-door">
        <span className="phone-bar-word" aria-hidden="true">Search</span>
      </Door>
    </div>
  );
}
