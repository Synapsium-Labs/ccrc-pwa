// An in-app anchor's props, by the Docs tab rule (desktop polish wave 174; the rule is `opensNewTab`, `lib/docTab.ts`).
// Ring L4: it reads the desk test and the tab's kind and hands a caller the props to spread on its `<a>`.
//
// A link that opens a new tab is a plain anchor with `target="_blank"` and no click handler, so the browser opens the tab
// itself: one new tab per click, and the browser's own middle click, copy link and context menu work on it as on any link.
// Every other in-app link keeps `inAppClick`, which moves within the app on a plain click and leaves a modified one to the
// browser, as before.
import { createContext, useCallback, useContext } from 'react';
import type { MouseEvent } from 'react';
import { useDesk } from '@ccrc/ui';
import { inAppClick } from '../fleet/settingsText';
import { opensNewTab } from './docTab';

/** Whether this tree is drawn in a Docs tab (`isDocsTab`). `App` provides it; outside its provider the answer is the
 *  console's, `false`. */
export const DocsTabContext = createContext(false);

/** The props an in-app anchor spreads: its address, and either a new-tab target or the in-app click. */
export type TabLinkProps =
  | { readonly href: string; readonly target: '_blank'; readonly rel: 'noopener'; readonly onClick?: undefined }
  | { readonly href: string; readonly target?: undefined; readonly rel?: undefined;
      readonly onClick: (e: MouseEvent<HTMLAnchorElement>) => void };

/** A function from an in-app address to its anchor's props, at the width and in the tab this component is drawn in. One
 *  hook call serves every link a component draws, a list's included. */
export function useTabLink(): (href: string) => TabLinkProps {
  const desk = useDesk();
  const docsTab = useContext(DocsTabContext);
  return useCallback(
    (href: string): TabLinkProps => opensNewTab(href, desk, docsTab)
      ? { href, target: '_blank', rel: 'noopener' }
      : { href, onClick: inAppClick(href) },
    [desk, docsTab],
  );
}
