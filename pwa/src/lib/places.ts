// The console's places (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D25): the ONE list of the places the navigation
// offers, in its order, with each place's icon. Pure (ring L1): no store, no DOM.
//
// Three readers, no second list: Refined's desk bar (`AppBar`, its tabs), Instrument's top bar doors (`TopBar`,
// `DESK_DOORS`) and the phone's bottom bar (`PhoneBar`, shared by both skins). A place added here appears on all three with no
// second edit. Each id is a `ROUTES` row that is `top`, and its door is the registry's own "Go to" command
// (`commandDoor('go-<id>')`).
//
// THE FLEET PLACE IS THE PHONE'S ONLY (D25), while no Overlord's door is drawn. At a desk the sessions are in the column beside
// every page, so neither desk navigation shows a fleet place (`deskPlacesFor`); on a phone the bar is how the operator gets back
// to the sessions from another screen, so it keeps the fleet (`placesFor`). Operator, 2026-11-04: "the sessions button in main
// nav is useless at the moment on desktop … On mobile it's useful".
//
// THE BADGES are `placeBadge`'s (`fleet/navBadges.ts`), over the one reader every door's count comes from (`useNavBadges`).
//
// THE LIST IS DERIVED (Overlord W1 home, Task 1; spec 2026-11-09 §4, C8): `placesFor` answers it from the designation's state,
// so no second list can drift from it. The Overlord's door is first on every bar while one is designated, and while a failed
// first start stands, and only while the server advertises `overlord-v1` (`overlordShown`). A desk gains a Fleet door only
// while the Overlord's door is drawn and the home is not the Fleet (`deskPlacesFor`, ruled F5): the wordmark no longer leads
// to the Fleet then. D25 stands otherwise.
import type { IconName } from '@ccrc/ui';
import { OVERLORD_DOOR, type DesignationState, type HomeAnswer } from '../overlord/homePlace';
import { matchRoute } from './routes';

export interface Place {
  /** A `top` row of `ROUTES`; its door is `go-<id>`. */
  readonly id: string;
  readonly icon: IconName;
  /** The word under the phone bar's icon, where the route's title is too long for a seventh of a phone; absent, the title.
   *  The phone bar's door is named by this word too ("Waiting, 3 waiting on you"), so the text it shows is in its name
   *  (review 1722); the desk bars name the place by its title. */
  readonly short?: string;
}

/** Today's places, in the navigation's order, fleet first: the list every bar draws with no Overlord's door. */
const BASE_PLACES: readonly Place[] = [
  { id: 'fleet', icon: 'layout-list' },
  { id: 'waiting', icon: 'hand', short: 'Waiting' },
  { id: 'inbox', icon: 'mail' },
  { id: 'runs', icon: 'workflow' },
  { id: 'accounts', icon: 'key-round' },
  { id: 'docs', icon: 'file-text' },
];

/** The Overlord's place, first on every bar while its door is drawn. */
export const OVERLORD_PLACE: Place = { id: 'overlord', icon: 'bot' };

/** The place a desk's navigation leaves out while D25 stands: the sessions are in the column beside every page there. */
export const FLEET_PLACE = 'fleet';

/** The places, in the phone's order: the Overlord first while its door is drawn (`shown` is `overlordShown`), then today's. */
export function placesFor(shown: boolean, d: DesignationState): readonly Place[] {
  return shown && OVERLORD_DOOR[d.kind] ? [OVERLORD_PLACE, ...BASE_PLACES] : BASE_PLACES;
}

/** The places a desk's navigation shows: every place but the fleet, in the same order, and the Fleet second, after the
 *  Overlord, only while the Overlord's door is drawn and the home is not the Fleet (ruled F5). */
export function deskPlacesFor(shown: boolean, d: DesignationState, home: HomeAnswer): readonly Place[] {
  const all = placesFor(shown, d);
  const rest = all.filter((p) => p.id !== FLEET_PLACE);
  const fleet = all.find((p) => p.id === FLEET_PLACE);
  if (rest[0]?.id !== OVERLORD_PLACE.id || home.place === 'fleet' || fleet === undefined) return rest;
  return [rest[0], fleet, ...rest.slice(1)];
}

/** The tap minimum, in CSS pixels, of a phone bar door (WCAG 2.5.8's enhanced target, the console's `--tap-min`). */
export const PHONE_DOOR_MIN_PX = 44;
/** The width a phone bar door keeps when places are fitted: the tap minimum, raised to the measured width at which every
 *  place's word shows whole. The bar shares its width evenly, and "Accounts" was cut at 45.7 px (a 320 px bar of seven doors)
 *  and whole at 48.75 px (390 px, eight doors) in the browser leg (slug `phone-door-floor-is-the-word`). */
export const PHONE_DOOR_FIT_PX = 48;
/** The places `phoneDoorsFit` never drops: the way to the Overlord and the way back to the sessions. */
const PHONE_KEEPS: ReadonlySet<string> = new Set([OVERLORD_PLACE.id, FLEET_PLACE]);

/** The places a phone bar `widthPx` wide draws beside its Search door, each at least `PHONE_DOOR_FIT_PX` wide (plan question
 *  13, slug `phone-bar-sheds-doors-to-search`): as many as fit, dropped from the end of the list, never the Overlord or the
 *  Fleet. A dropped place stays reachable through Search, whose palette lists every "Go to" command. */
export function phoneDoorsFit(widthPx: number, places: readonly Place[]): readonly Place[] {
  const room = Math.max(0, Math.floor(widthPx / PHONE_DOOR_FIT_PX) - 1);
  let over = places.length - room;
  if (over <= 0) return places;
  const kept = [...places];
  for (let i = kept.length - 1; i >= 0 && over > 0; i--) {
    if (PHONE_KEEPS.has(kept[i]!.id)) continue;
    kept.splice(i, 1);
    over -= 1;
  }
  return kept;
}

/** Whether a phone draws its bottom bar on `path`: on every page but an open session, where the composer owns the bottom of the
 *  screen and the session's own back stays (D25). The frame asks this; a desk never draws the bar. */
export function phoneBarShown(path: string): boolean {
  return matchRoute(path)?.route.id !== 'session';
}
