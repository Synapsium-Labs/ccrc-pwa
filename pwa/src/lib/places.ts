// The console's places (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D25): the ONE list of the places the navigation
// offers, in its order, with each place's icon. Pure (ring L1): no store, no DOM.
//
// Three readers, no second list: Refined's desk bar (`AppBar`, its tabs), Instrument's top bar doors (`TopBar`,
// `DESK_DOORS`) and the phone's bottom bar (`PhoneBar`, shared by both skins). A place added here appears on all three with no
// second edit. Each id is a `ROUTES` row that is `top`, and its door is the registry's own "Go to" command
// (`commandDoor('go-<id>')`).
//
// THE FLEET PLACE IS THE PHONE'S ONLY (D25). At a desk the sessions are in the column beside every page, so neither desk
// navigation shows a fleet place (`DESK_PLACES`); on a phone the bar is how the operator gets back to the sessions from another
// screen, so it keeps the fleet first (`PLACES`). Operator, 2026-11-04: "the sessions button in main nav is useless at the
// moment on desktop … On mobile it's useful".
//
// THE BADGES are `placeBadge`'s (`fleet/navBadges.ts`), over the one reader every door's count comes from (`useNavBadges`).
import type { IconName } from '@ccrc/ui';
import { matchRoute } from './routes';

export interface Place {
  /** A `top` row of `ROUTES`; its door is `go-<id>`. */
  readonly id: string;
  readonly icon: IconName;
  /** The word under the phone bar's icon, where the route's title is too long for a seventh of a phone; absent, the title.
   *  The door's accessible name is the title, which begins with this word. */
  readonly short?: string;
}

/** The places, in the navigation's order, fleet first. */
export const PLACES: readonly Place[] = [
  { id: 'fleet', icon: 'layout-list' },
  { id: 'waiting', icon: 'hand', short: 'Waiting' },
  { id: 'inbox', icon: 'mail' },
  { id: 'runs', icon: 'workflow' },
  { id: 'accounts', icon: 'key-round' },
  { id: 'docs', icon: 'file-text' },
];

/** The place a desk's navigation leaves out: the sessions are in the column beside every page there. */
export const FLEET_PLACE = 'fleet';

/** The places a desk's navigation shows: every place but the fleet, in the same order. */
export const DESK_PLACES: readonly Place[] = PLACES.filter((p) => p.id !== FLEET_PLACE);

/** Whether a phone draws its bottom bar on `path`: on every page but an open session, where the composer owns the bottom of the
 *  screen and the session's own back stays (D25). The frame asks this; a desk never draws the bar. */
export function phoneBarShown(path: string): boolean {
  return matchRoute(path)?.route.id !== 'session';
}
