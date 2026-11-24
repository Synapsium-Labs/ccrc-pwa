// An in-app link's behaviour, by the Docs tab rule (desktop polish wave 174; the rule is `opensNewTab`, `lib/docTab.ts`).
// Ring L4: these hooks read the desk test and the tab's kind and act; they decide nothing themselves.
//
// A link that opens a new tab is a plain anchor with `target="_blank"` and no click handler, so the browser opens the tab
// itself: one new tab per click, and the browser's own middle click, copy link and context menu work on it as on any link.
// Every other in-app link keeps `inAppClick`, which moves within the app on a plain click and leaves a modified one to the
// browser, as before. A control that is not an anchor (a command, a button) moves through `useFollowLink`, which asks the
// same rule and opens the same tab.
import { createContext, useCallback, useContext } from 'react';
import type { MouseEvent } from 'react';
import { useDesk } from '@ccrc/ui';
import { inAppClick } from '../fleet/settingsText';
import { navigate } from './router';
import { opensNewTab } from './docTab';

/** Whether this tree is drawn in a Docs tab (`isDocsTab`). `App` provides it; outside its provider the answer is the
 *  console's, `false`. */
export const DocsTabContext = createContext(false);

/** A new tab's `rel`: the design system's own for a link that leaves (`TextLink`'s stated contract), so the tab is opened
 *  with no opener and no referrer. */
const NEW_TAB_REL = 'noopener noreferrer';

/** The props an in-app anchor spreads: its address, and either a new-tab target or the in-app click. */
export type TabLinkProps =
  | { readonly href: string; readonly target: '_blank'; readonly rel: typeof NEW_TAB_REL; readonly onClick?: undefined }
  | { readonly href: string; readonly target?: undefined; readonly rel?: undefined;
      readonly onClick: (e: MouseEvent<HTMLAnchorElement>) => void };

/** A function from an in-app address to its anchor's props, at the width and in the tab this component is drawn in. One
 *  hook call serves every link a component draws, a list's included. */
export function useTabLink(): (href: string) => TabLinkProps {
  const desk = useDesk();
  const docsTab = useContext(DocsTabContext);
  return useCallback(
    (href: string): TabLinkProps => opensNewTab(href, desk, docsTab)
      ? { href, target: '_blank', rel: NEW_TAB_REL }
      : { href, onClick: inAppClick(href) },
    [desk, docsTab],
  );
}

/** A move from a control that is not an anchor (a command the palette, a bar door or a key runs, a menu command, a
 *  button), by the same rule: where it opens a new tab, one new tab opens and this one stays where it is; otherwise it is
 *  `navigate(href)`. */
export function useFollowLink(): (href: string) => void {
  const desk = useDesk();
  const docsTab = useContext(DocsTabContext);
  return useCallback(
    (href: string): void => {
      if (opensNewTab(href, desk, docsTab)) window.open(href, '_blank', 'noopener,noreferrer');
      else navigate(href);
    },
    [desk, docsTab],
  );
}
