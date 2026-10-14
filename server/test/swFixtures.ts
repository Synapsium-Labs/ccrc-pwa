// swFixtures.ts — the ONE fixture text for the PWA bundle's service worker, `server/dist-pwa/sw.js` (native Docs
// reader W4, spec 2026-10-01 section 7.2). `ccrc doctor`'s `docs-sw` check measures the installed worker, and every
// fixture that runs the closing doctor plants one: `ccrc-doctor.test.ts`'s `healthy()`, `installTreeFixture.ts`'s
// `TREE_STUBS` (the install suites) and `ccrc-update.test.ts`'s staged tree. One text, so the three cannot drift
// apart or away from what a build emits.
//
// THE SHAPE IS A REAL BUILD'S: workbox emits `sw.js` as ONE minified line, and the navigation route carries the list
// as `{denylist:[...]}` with each entry printed as a RegExp literal. `SW_DENYLIST_DEFAULT` is that list with no
// `CCRC_SW_DENYLIST` set (`pwa/src/lib/sw-denylist.ts`'s two built-ins); W4 Task 10 Step 5 compared it with a
// scratch `vite build` and recorded the result.
//
// Imports nothing, so `installTreeFixture.ts` stays vitest-free (its header) when it imports this file.

/** The denylist a build with no `CCRC_SW_DENYLIST` prints into `sw.js`: `/api/` and `/ws/`, nothing else. */
export const SW_DENYLIST_DEFAULT = 'denylist:[/^\\/api\\//,/^\\/ws\\//]';

/** A one-line, workbox-shaped `sw.js` whose navigation route carries `denylist` verbatim (the `denylist:[...]`
 *  text, or any text a test wants in that slot); `SW_DENYLIST_DEFAULT` when omitted. */
export function swJs(denylist: string = SW_DENYLIST_DEFAULT): string {
  return 'define(["./workbox-fixture"],(function(e){"use strict";self.skipWaiting(),e.clientsClaim(),'
    + 'e.precacheAndRoute([{url:"index.html",revision:"fixture"}],{}),e.cleanupOutdatedCaches(),'
    + `e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("/index.html"),{${denylist}})),`
    + 'e.registerRoute(/\\/(?:api|ws)\\//,new e.NetworkOnly,"GET")}));\n';
}
