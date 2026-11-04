// The route table (D-5466, W2 Task S2b): every path the shell routes, once.
//
// `app.tsx`'s ladder matches a path against this table and nothing else, the palette's "Go to" commands are derived
// from its `top` rows (`command/commands.ts`), Instrument's breadcrumb reads its titles, and the parity test walks it.
// A route added later is added here, once; `app.test.tsx` holds the table and the ladder to each other both ways.
//
// Pure: no store, no DOM.
import { shapeProgramSlug } from '../../../shared/api';

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
  /** Whether the row takes the decoded parameter its pattern captured. Absent: any. A parameter the row refuses is no match
   *  for the row, so the path is matched as if the row were not there (carry C, D-7951). */
  readonly accepts?: (param: string) => boolean;
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
  // R19's measurement page (W5h-a; base spec 2026-10-01 section 7.8): under Settings so the palette offers it ("Go to
  // Settings › Measure highlighting") on a phone; its id is not `settings-…`, so the ladder renders the page itself.
  { id: 'measure-highlighting', pattern: /^\/settings\/measure-highlighting\/?$/, title: 'Measure highlighting', top: false, path: '/settings/measure-highlighting' },
  // Any other id under Settings (D-5504): still Settings, which says "That section does not exist." above its index,
  // never the fallback, except a malformed escape (`/settings/%zz`), which is outside the table (`matchRoute`). No path, so
  // "Go to" leaves it out.
  { id: 'settings-section', pattern: /^\/settings\/([^/]+)\/?$/, title: 'Settings', top: false, path: null },
  // `/digest?day=YYYY-MM-DD` (D-5300): the daily digest push's deep link.
  { id: 'digest', pattern: /^\/digest\/?$/, title: 'Digest', top: false, path: null },
  // Waiting on you (desktop-polish PL5a, D-7712): the combined list, and one item under it by its numeric id.
  { id: 'waiting', pattern: /^\/waiting\/?$/, title: 'Waiting on you', top: true, path: '/waiting' },
  { id: 'item', pattern: /^\/waiting\/(\d+)\/?$/, title: 'Item', top: false, path: null },
  // The programme view (desktop-polish PL5b, D-7713): one programme by slug, opened from the chip on its box. It takes one path
  // segment, as the session row does, and the slug's GRAMMAR is the owner's (`shapeProgramSlug`, asked by `isProgrammeSlug`
  // below): a second copy of its pattern here would be one more place to be wrong (`pl5b-route-owner-grammar`). A segment the
  // owner refuses is no match (`accepts`), so it is a path outside the table: the fleet on a phone, the placeholder on a desk,
  // never a blank pane (carry C, D-7951; review 1388 F1). `top: false` and `path: null`: no rail highlight (only `session` is
  // carried under Fleet, `topRouteOf`), no "Go to" row.
  { id: 'programme', pattern: /^\/programmes\/([^/]+)\/?$/, title: 'Programme', top: false, path: null, accepts: isProgrammeSlug },
];

/** The one builder of a session's path, `/s/<id>`, which the `session` row above parses (D-7189). It encodes every
 *  id; over `isSessionIdShape`'s charset, every id the wire carries, `encodeURIComponent` is the identity, so the
 *  path is the id itself (`w7-session-path.test.ts`). */
export function sessionPath(id: string): string {
  return `/s/${encodeURIComponent(id)}`;
}

/** The one builder of a programme's path, `/programmes/<slug>`, which the `programme` row above parses. It encodes the slug,
 *  and over the owner's grammar (letters, digits, `_` and `-`) `encodeURIComponent` is the identity. */
export function programmePath(slug: string): string {
  return `/programmes/${encodeURIComponent(slug)}`;
}

/** Whether a string is a programme slug the server accepts: `shapeProgramSlug`'s grammar and length, the one owner of both,
 *  and the slug as it stands (the owner trims, a path segment must not change under it). This is what the programme row's
 *  `accepts` asks, and what the chip asks before it offers a door (`programmeIsOpenable`). */
export function isProgrammeSlug(slug: string): boolean {
  const shaped = shapeProgramSlug(slug);
  return shaped.ok && shaped.slug === slug;
}

/** Whether the programme's path leads to its view: the slug is a programme's, and the route resolves to it. A slug the view
 *  would refuse is not offered a door. The grammar is asked first, so a string the encoder refuses (a lone surrogate) is
 *  refused here, never thrown during a render (carry C, D-7951; review 1388's advisory). */
export function programmeIsOpenable(slug: string): boolean {
  if (!isProgrammeSlug(slug)) return false;
  const at = matchRoute(programmePath(slug));
  return at !== null && at.route.id === 'programme' && at.param === slug;
}

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

/** The accounts route's resume query (accounts plan Task A23, D-7871; spec §6.2): `/accounts?resume=<id>` opens the
 *  sheet of the sign-in this session started on lane `<id>`, at its code field. Only a shortcut: the attempt itself is
 *  read from `GET /api/accounts`, never from the URL or storage. */
export const ACCOUNTS_RESUME_QUERY = 'resume';

/** The one builder of `/accounts?resume=<id>`; `resumeParam` is its one reader. */
export function accountsResumeHref(wrapper: string): string {
  return `/accounts?${new URLSearchParams({ [ACCOUNTS_RESUME_QUERY]: wrapper }).toString()}`;
}

/** The lane id in the resume query, or null when it is absent or empty. */
export function resumeParam(search: string): string | null {
  const id = new URLSearchParams(search).get(ACCOUNTS_RESUME_QUERY);
  return id === null || id === '' ? null : id;
}

export interface RouteMatch {
  readonly route: Route;
  /** The pattern's first capture, decoded: the session id on `/s/:id`; null where the pattern captures nothing. */
  readonly param: string | null;
}

/** The decoded capture, or `undefined` for a malformed percent escape (`/s/%zz`), which `decodeURIComponent` throws on. */
function decodeParam(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/** The route a path is on, or null for a path outside the table. A path whose captured segment is not a well-formed escape is
 *  outside the table too: `App` calls this in its own body, outside every boundary but the root's, so it never throws
 *  (carry C, D-7951; review 1388 F3). A row's `accepts` refusing the parameter is no match for that row. */
export function matchRoute(path: string): RouteMatch | null {
  for (const route of ROUTES) {
    const m = route.pattern.exec(path);
    if (m === null) continue;
    if (m[1] === undefined) return { route, param: null };
    const param = decodeParam(m[1]);
    if (param === undefined) return null;
    if (route.accepts !== undefined && !route.accepts(param)) continue;
    return { route, param };
  }
  return null;
}

/** The frame's view for a path (the phone swap, `shell.css`): `fleet` on the fleet route and on a path outside the
 *  table (its placeholder), `session` for anything the detail pane shows. `app.tsx` hands it to the frame, and the
 *  resume banner reads it to place its one instance (accounts plan Task A23, D-7871 (3)). */
export function shellViewOf(path: string): 'fleet' | 'session' {
  const id = matchRoute(path)?.route.id ?? null;
  return id === null || id === 'fleet' ? 'fleet' : 'session';
}

/** The top route a path is on or under: `/settings/updates` is under Settings, `/docs/a/b` is Docs, a session is
 *  under Fleet (its breadcrumb reads "Fleet › …"). Null for a path outside the table and for a route that is no
 *  place's page (the digest). Read by the rail's current item, the phone's bottom bar and the breadcrumb (W2 Task S9,
 *  D-5472), so they never disagree about where a page sits. A path with a malformed escape is under no place, as
 *  `matchRoute` places it outside the table: the pane draws the placeholder, and no door says the page is there (review 1437
 *  F2). */
export function topRouteOf(path: string): Route | null {
  const at = matchRoute(path);
  if (at?.route.top === true) return at.route;
  if (at?.route.id === 'session') return ROUTES.find((r) => r.id === 'fleet') ?? null;
  if (at === null && decodeParam(path) === undefined) return null;
  return ROUTES.find((r) => r.top && r.path !== null && r.path !== '/' && path.startsWith(`${r.path}/`)) ?? null;
}
