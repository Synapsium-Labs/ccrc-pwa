// The Docs tab (desktop polish wave 174): at a desk a document opens in a browser tab of its own, and that tab draws the
// Docs reader alone, so the operator can keep several documents open beside the sessions they came from. Pure (ring L1):
// no store, no DOM, no clock.
//
// WHAT A DOCS TAB IS (`isDocsTab`, the one definition). A tab is one of two kinds: the console, or a Docs tab, which draws
// the reader alone. What a tab is comes from its history alone, never from its width (fix round 2, R2): it is a Docs tab
// while it shows a Docs page and has shown only Docs pages, so a document opened in a tab of its own, at any width, stays
// a Docs tab however its window is resized, and a console that shows a document in the app stays the console, as on main.
// Its history survives a reload of the tab (`tabMark.ts` keeps "this tab has been the console" in the tab's own store).
//
// ONE RULE FOR A CLICK, `opensNewTab`. An in-app link that crosses from one kind of tab to the other opens a NEW browser
// tab, every time (an anchor's `target="_blank"`, never a named tab that a second click would reuse); a link that stays
// within its kind moves in the tab as before. So, at a desk: the console's links to a document open a Docs tab; a Docs
// tab's links to another document move within it; and a Docs tab's links to a console page (the link back, a session, a
// run, the reader's own Back at the index) open the console in a new tab rather than drawing it in the Docs tab. Below the
// desk width nothing opens a tab: a phone keeps documents inside the app, and a narrow Docs tab, which draws no bar (fix round
// 3), goes back by the reader's Back at the index, which moves in place.
//
// THE WIDTH IS THE SHELL'S OWN DESK TEST (`DESK_QUERY`, `@ccrc/ui`, 900px), asked live, and it decides only whether a
// click opens a tab: the callers pass its answer in, so this file names no breakpoint. Two readers ask the click rule, both in `useTabLink.ts`: `useTabLink` (an anchor's props)
// and `useFollowLink` (a move made by a command or a button). The tab's kind reaches them from `App`, which asks
// `isDocsTab`.
import { ROUTES, matchRoute } from './routes';

/** The console's root, the address a Docs tab's link back opens: the route table's home row. */
export const CONSOLE_ROOT: string = ROUTES.find((r) => r.id === 'home')!.path!;

/** What a link that opens a new tab adds to its accessible name, so a screen reader hears where it goes. */
export const NEW_TAB_WORDS = ', opens in a new tab';

/** The path half of an in-app address: everything before its `?` or `#`. */
function pathOf(href: string): string {
  const cut = href.search(/[?#]/);
  return cut < 0 ? href : href.slice(0, cut);
}

/** Whether `href`, an in-app address (a path, with an optional `?search` and `#fragment`), is a page of the Docs route.
 *  Anything that is not a path from the root (an outside URL, a protocol-relative one, a fragment alone) is not: the
 *  route's own pattern refuses it. */
export function isDocsHref(href: string): boolean {
  return matchRoute(pathOf(href))?.route.id === 'docs';
}

/** Whether the tab showing `path` is a Docs tab, given whether it has shown only Docs pages before this one
 *  (`docsSoFar`): it is exactly when this page is a Docs page too. It is also the fold `App` keeps over every page its tab
 *  shows, starting at the first page from what the tab was before its load (`wasConsoleTab`): once false, it stays false. */
export function isDocsTab(path: string, docsSoFar: boolean): boolean {
  return docsSoFar && isDocsHref(path);
}

/** THE RULE: whether an in-app link to `href`, followed from a tab that is (`docsTab`) or is not a Docs tab, opens a new
 *  browser tab. True exactly at a desk when the link crosses between the console and the Docs reader. An address that is
 *  not in-app never opens a new tab by this rule: an outside link has its own (`openExternal`). */
export function opensNewTab(href: string, desk: boolean, docsTab: boolean): boolean {
  if (!desk || !href.startsWith('/') || href.startsWith('//')) return false;
  return isDocsHref(href) !== docsTab;
}
