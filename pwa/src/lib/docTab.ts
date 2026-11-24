// The Docs tab (desktop polish wave 174): at a desk a document opens in a browser tab of its own, and that tab draws the
// Docs reader alone, so the operator can keep several documents open beside the sessions they came from. Pure (ring L1):
// no store, no DOM, no clock.
//
// ONE RULE, `opensNewTab`. A tab is one of two kinds: the console, or a Docs tab (`isDocsTab`: a Docs route at a desk). An
// in-app link that crosses from one kind to the other opens a NEW browser tab, every time (an anchor's `target="_blank"`,
// never a named tab that a second click would reuse); a link that stays within its kind moves in the tab as before. So, at
// a desk: the console's links to a document open a Docs tab; a Docs tab's links to another document move within it; and a
// Docs tab's links to a console page (the link back, a session, a run) open the console in a new tab rather than drawing it
// in the Docs tab. Below the desk width nothing crosses: a phone keeps the Docs screen inside the app, as before.
//
// THE WIDTH IS THE SHELL'S OWN DESK TEST (`DESK_QUERY`, `@ccrc/ui`, 900px): the callers pass its answer in, so this file
// names no breakpoint. Two readers ask the rule: `useTabLink` (an anchor's props) and `followLink` (a move made by a command
// or a button, `lib/router.ts`).
import { parseDocsPage } from '../../../shared/docs';
import { SECTION_LABEL } from '../docs/docsTree';
import { ROUTES, matchRoute } from './routes';

/** The console's root, the address a Docs tab's link back opens: the route table's home row. */
export const CONSOLE_PATH: string = ROUTES.find((r) => r.id === 'home')!.path!;

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

/** Whether the tab showing `path` is a Docs tab: a Docs route at a desk (`desk` is the shell's desk test). */
export function isDocsTab(path: string, desk: boolean): boolean {
  return desk && isDocsHref(path);
}

/** THE RULE: whether an in-app link to `href`, followed from a tab that is (`docsTab`) or is not a Docs tab, opens a new
 *  browser tab. True exactly at a desk when the link crosses between the console and the Docs reader. An address that is
 *  not in-app never opens a new tab by this rule: an outside link has its own (`openExternal`). */
export function opensNewTab(href: string, desk: boolean, docsTab: boolean): boolean {
  if (!desk || !href.startsWith('/') || href.startsWith('//')) return false;
  return isDocsHref(href) !== docsTab;
}

/** The title of a Docs tab, so several can be told apart: the document's file name first, then its project, as a tab's
 *  narrow label shows its start. A directory or a section reads its own name; the index, and an address the reader would
 *  refuse, read "Docs". Every title ends with the console's name. */
export function docsTabTitle(path: string, search: string): string {
  const tail = 'Docs · ccrc';
  const parsed = parseDocsPage(path, search);
  if (!parsed.ok) return tail;
  const loc = parsed.loc;
  switch (loc.kind) {
    case 'index': return tail;
    case 'project': return `${loc.project} · ${tail}`;
    case 'section': return `${SECTION_LABEL[loc.section]} · ${loc.project} · ${tail}`;
    case 'path': {
      const segs = loc.path.split('/').filter((s) => s !== '');
      const name = segs.at(-1) ?? SECTION_LABEL[loc.section];
      return `${name} · ${loc.project} · ${tail}`;
    }
  }
}
