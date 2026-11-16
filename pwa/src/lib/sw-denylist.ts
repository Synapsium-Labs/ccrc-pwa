// Which navigations the service worker must NOT answer with the app shell.
//
// The PWA is served at `/` with an SPA fallback, so by default every unknown
// path renders ccrc. That is right for ccrc's own routes and wrong for anything
// else living at the same origin. Three of ccrc's own prefixes are always denied
// — `/api/` and `/ws/` are server state, and a cached shell answering an API
// navigation is a page that looks fine and is lying; `/licenses/` holds the
// licence files the build ships verbatim (D-5095), which the shell would hide.
//
// CO-TENANTS ARE NOT CCRC'S BUSINESS TO KNOW. A box may put a wiki at `/wiki`
// and a preview at `/fleet` behind the same reverse proxy; a release tarball
// installed by a stranger has neither, and shipping their paths as a built-in
// would be one operator's reverse-proxy layout compiled into everybody's
// service worker. So they move to a BUILD-TIME knob: whoever builds the bundle
// knows what else is on that origin.
//
// The failure it prevents is quiet and confusing: the co-tenant keeps working
// on a hard load and breaks only on a client-side navigation, once the worker
// is installed — so it looks like an intermittent fault in the OTHER app.

import { DOCS_PAGE_PREFIX } from '../../../shared/docs';

/** Escape a literal path segment for embedding in a RegExp. */
function escapePath(p: string): string {
  return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The denylist for `navigateFallbackDenylist`.
 *
 * @param extra comma-separated absolute paths that belong to something else on
 *   this origin (`CCRC_SW_DENYLIST`, e.g. `"/wiki,/fleet"`). Empty, absent, or
 *   all-blank yields just ccrc's own three, the default for an origin ccrc has to
 *   itself. `/docs` is ccrc's own (its Docs pages): an entry covering it throws.
 *
 * Each extra path matches the path itself and everything under it (`/wiki`,
 * `/wiki/`, `/wiki/a/b`), and NOT a sibling that merely starts the same way
 * (`/wikis` stays ccrc's). Entries are accepted with or without a leading
 * slash and trailing slashes are ignored, because a knob that silently does
 * nothing when you write `wiki` instead of `/wiki` is worse than no knob.
 */
export function swDenylist(extra: string | undefined): RegExp[] {
  // /licenses/ is ccrc's own too (D-5095): a file the build ships verbatim
  // from pwa/public/, which the shell answering it would hide.
  const own = [/^\/api\//, /^\/ws\//, /^\/licenses\//];
  const paths = (extra ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, '').replace(/^\/*/, '/'))
    .filter((s) => s !== '/');
  // Judged on the NORMALISED entry, so ` /docs/ `, `docs` and `//docs` are all
  // refused; `/docsy` is a sibling, not under the prefix, and builds.
  const docs = paths.find((p) => p === DOCS_PAGE_PREFIX || p.startsWith(`${DOCS_PAGE_PREFIX}/`));
  if (docs !== undefined) {
    throw new Error(
      `CCRC_SW_DENYLIST entry ${docs} covers ${DOCS_PAGE_PREFIX}, ccrc's own Docs pages; a service worker that refuses them the app shell breaks them on every hard load. Remove it from CCRC_SW_DENYLIST (deploy.sh reads it from ~/.ccrc/deploy.env on the deploying machine) and build again.`,
    );
  }
  return [...own, ...paths.map((p) => new RegExp(`^${escapePath(p)}(/|$)`))];
}
