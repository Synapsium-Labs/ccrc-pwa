// Instrument's breadcrumb (W2 Task S9, D-5472): where the page in the detail pane sits, as the top bar reads it.
//
// ONE DERIVATION PER WORD. The route titles are `ROUTES`' (lib/routes.ts), and a session's crumbs are the session
// header's own title and crumb (`sessionHeaderView`), so the bar can never name a session differently from the
// header under it. Pure: no store, no DOM; the part hands it the path and the fleet.
import type { FleetSession } from '../../../shared/api';
import { matchRoute, ROUTES, topRouteOf } from '../lib/routes';
import { sessionHeaderView } from '../session/sessionHeaderView';

const FLEET_TITLE = ROUTES.find((r) => r.id === 'fleet')!.title;

/** The crumbs, outermost first: "Fleet › project › workspace" on a session, "Settings › Updates" on a section page,
 *  the route's own title on a top route. Empty off the table. A session the fleet does not list (yet) reads as
 *  "Fleet › Session", never as a guessed name. */
export function breadcrumb(path: string, sessions: readonly FleetSession[]): string[] {
  const at = matchRoute(path);
  if (at === null) return [];
  const { route, param } = at;
  if (route.id === 'session') {
    const session = sessions.find((s) => s.id === param) ?? null;
    if (session === null) return [FLEET_TITLE, route.title];
    const view = sessionHeaderView({ session, status: null, statusUpdatedAt: null, now: 0, finePointer: true });
    return view.crumb === null ? [FLEET_TITLE, view.title] : [FLEET_TITLE, view.title, view.crumb];
  }
  const top = topRouteOf(path);
  if (top === null || top.id === route.id || top.title === route.title) return [route.title];
  return [top.title, route.title];
}
