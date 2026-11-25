// What this browser tab has been, kept across a reload (desktop polish wave 174, fix round 2, R4). A tab that has been the
// console stays the console when it loads a page again (a reload, a release's reload on a move, a back or forward
// reload), so a Docs address it loads is shown inside the console; the rule itself is `isDocsTab` (`docTab.ts`), and this
// file only keeps its one input across the load. Ring L3: it names the tab's store through the one storage port.
//
// The mark is per tab (`tabStorage`, the tab's session storage), so a new tab starts with none: a tab opened by a link or a
// command of the console, with no opener (`rel="noopener noreferrer"`, `window.open(…, 'noopener,noreferrer')`), gets no
// copy of it (measured in Chrome, `docs-own-tab.browser.test.ts`). Every read and write is guarded by the port: with no
// store, or one that refuses, the mark reads as absent and the first page decides, as before.
import { readKey, tabStorage, writeKey } from './storage';

/** The tab's mark: its key and its one value. */
const TAB_KEY = 'ccrc-tab';
const CONSOLE = 'console';
/** The mark as data, for a harness that opens a page as a console tab's reload would (`browser/app.ts`'s `tab`). */
export const CONSOLE_TAB_MARK = { key: TAB_KEY, value: CONSOLE } as const;

/** Whether this tab has been the console before this load. */
export function wasConsoleTab(): boolean {
  return readKey(TAB_KEY, tabStorage) === CONSOLE;
}

/** Mark this tab as the console, for every later load of it. A store that refuses keeps nothing. */
export function markConsoleTab(): void {
  writeKey(TAB_KEY, CONSOLE, tabStorage);
}
