// The route table (D-5466, W2 Task S2b): every path the shell routes, once.
//
// `app.tsx`'s ladder matches a path against this table and nothing else, the palette's "Go to" commands are derived
// from its `top` rows (`command/commands.ts`), Instrument's breadcrumb reads its titles, and the parity test walks it.
// A route added later is added here, once; `app.test.tsx` holds the table and the ladder to each other both ways.
//
// Pure: no store, no DOM.

export interface Route {
  /** Stable, and the suffix of the route's "Go to" command (`go-${id}`). */
  readonly id: string;
  readonly pattern: RegExp;
  /** The route's name as a person reads it: a "Go to" title, a breadcrumb. */
  readonly title: string;
  /** Offered directly by a phone navigation and by "Go to": a place, not a page reached from one. */
  readonly top: boolean;
  /** The one path a door navigates to. Null for a route whose path carries a parameter (a session) or a query. */
  readonly path: string | null;
}

/** Settings' five sections, in the index's order (D-5503): each is its own route, `/settings/<id>` (D-5504). The one
 *  list: the route entries below, the index rows and the section pages all read it. */
export const SETTINGS_SECTIONS = [
  { id: 'updates', title: 'Updates' },
  { id: 'appearance', title: 'Appearance' },
  { id: 'notifications', title: 'Notifications' },
  { id: 'automation', title: 'Automation' },
  { id: 'security', title: 'Security' },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

export const ROUTES: readonly Route[] = [
  { id: 'fleet', pattern: /^\/$/, title: 'Fleet', top: true, path: '/' },
  { id: 'session', pattern: /^\/s\/([^/]+)\/?$/, title: 'Session', top: false, path: null },
  { id: 'inbox', pattern: /^\/mail\/?$/, title: 'Inbox', top: true, path: '/mail' },
  { id: 'runs', pattern: /^\/runs\/?$/, title: 'Runs', top: true, path: '/runs' },
  { id: 'accounts', pattern: /^\/accounts\/?$/, title: 'Accounts', top: true, path: '/accounts' },
  // `/docs` and every page under it, never `/docsearch` (design 2026-10-01 section 4.2).
  { id: 'docs', pattern: /^\/docs(?:\/|$)/, title: 'Docs', top: true, path: '/docs' },
  { id: 'archive', pattern: /^\/archive\/?$/, title: 'Archive', top: true, path: '/archive' },
  { id: 'settings', pattern: /^\/settings\/?$/, title: 'Settings', top: true, path: '/settings' },
  // The five section pages (D-5504): pages under Settings, so not `top`; each has its own path, so "Go to" offers
  // "Go to Settings › Updates" and the others (`command/commands.ts`).
  ...SETTINGS_SECTIONS.map((s): Route => ({
    id: `settings-${s.id}`, pattern: new RegExp(`^/settings/${s.id}/?$`), title: s.title, top: false, path: `/settings/${s.id}`,
  })),
  // Any other id under Settings (D-5504): still Settings, which says "That section does not exist." above its index,
  // never the fallback. No path, so "Go to" leaves it out.
  { id: 'settings-section', pattern: /^\/settings\/([^/]+)\/?$/, title: 'Settings', top: false, path: null },
  // `/digest?day=YYYY-MM-DD` (D-5300): the daily digest push's deep link.
  { id: 'digest', pattern: /^\/digest\/?$/, title: 'Digest', top: false, path: null },
];

/** The accounts route's one query (T2c, D-6329): a lane card is a per-row door to its lane, so it rides a query on the
 *  existing `accounts` route, as the digest's `?day=` does, with no new route and no registry command. */
export const ACCOUNTS_LANE_QUERY = 'lane';

/** The one builder of `/accounts?lane=<id>`. `URLSearchParams` encodes the id; `laneParam` is its one reader. */
export function accountsLaneHref(wrapper: string): string {
  return `/accounts?${new URLSearchParams({ [ACCOUNTS_LANE_QUERY]: wrapper }).toString()}`;
}

/** The one reader of the lane query: the lane id in a `location.search`-shaped string (`useLocation().search` carries
 *  its leading `?`, and the parser accepts it with or without), or null when it is absent or empty. */
export function laneParam(search: string): string | null {
  const id = new URLSearchParams(search).get(ACCOUNTS_LANE_QUERY);
  return id === null || id === '' ? null : id;
}

export interface RouteMatch {
  readonly route: Route;
  /** The pattern's first capture, decoded: the session id on `/s/:id`; null where the pattern captures nothing. */
  readonly param: string | null;
}

/** The route a path is on, or null for a path outside the table. */
export function matchRoute(path: string): RouteMatch | null {
  for (const route of ROUTES) {
    const m = route.pattern.exec(path);
    if (m !== null) return { route, param: m[1] === undefined ? null : decodeURIComponent(m[1]) };
  }
  return null;
}

/** The top route a path is on or under: `/settings/updates` is under Settings, `/docs/a/b` is Docs, a session is
 *  under Fleet (its breadcrumb reads "Fleet › …"). Null for a path outside the table and for a route that is no
 *  place's page (the digest). Read by the rail's current item and the breadcrumb (W2 Task S9, D-5472), so the two
 *  never disagree about where a page sits. */
export function topRouteOf(path: string): Route | null {
  const at = matchRoute(path);
  if (at?.route.top === true) return at.route;
  if (at?.route.id === 'session') return ROUTES.find((r) => r.id === 'fleet') ?? null;
  return ROUTES.find((r) => r.top && r.path !== null && r.path !== '/' && path.startsWith(`${r.path}/`)) ?? null;
}
