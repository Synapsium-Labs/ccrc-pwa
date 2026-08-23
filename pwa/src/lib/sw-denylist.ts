// Which navigations the service worker must NOT answer with the app shell.
//
// The PWA is served at `/` with an SPA fallback, so by default every unknown
// path renders ccrc. That is right for ccrc's own routes and wrong for anything
// else living at the same origin. Two of ccrc's own prefixes are always denied
// — `/api/` and `/ws/` are server state, and a cached shell answering an API
// navigation is a page that looks fine and is lying.
//
// CO-TENANTS ARE NOT CCRC'S BUSINESS TO KNOW. The reference box happens to put
// a docserver at `/docs` and a preview at `/fleet` behind the same
// `tailscale serve`; a release tarball installed by a stranger has neither, and
// shipping their paths as a built-in would be one operator's reverse-proxy
// layout compiled into everybody's service worker. So they move to a
// BUILD-TIME knob: whoever builds the bundle knows what else is on that origin.
//
// The failure it prevents is quiet and confusing: the co-tenant keeps working
// on a hard load and breaks only on a client-side navigation, once the worker
// is installed — so it looks like an intermittent fault in the OTHER app.

/** Escape a literal path segment for embedding in a RegExp. */
function escapePath(p: string): string {
  return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The denylist for `navigateFallbackDenylist`.
 *
 * @param extra comma-separated absolute paths that belong to something else on
 *   this origin (`CCRC_SW_DENYLIST`, e.g. `"/docs,/fleet"`). Empty, absent, or
 *   all-blank yields just ccrc's own two — which is the correct default for an
 *   origin ccrc has to itself.
 *
 * Each extra path matches the path itself and everything under it (`/docs`,
 * `/docs/`, `/docs/a/b`), and NOT a sibling that merely starts the same way
 * (`/docsearch` stays ccrc's). Entries are accepted with or without a leading
 * slash and trailing slashes are ignored, because a knob that silently does
 * nothing when you write `docs` instead of `/docs` is worse than no knob.
 */
export function swDenylist(extra: string | undefined): RegExp[] {
  const own = [/^\/api\//, /^\/ws\//];
  const paths = (extra ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, '').replace(/^\/*/, '/'))
    .filter((s) => s !== '/');
  return [...own, ...paths.map((p) => new RegExp(`^${escapePath(p)}(/|$)`))];
}
