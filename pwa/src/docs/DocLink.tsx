// The Markdown `a` of a Docs page (spec 2026-10-01 4.11; W5 part 1 Task 6) and the context it reads. `DocLink` is,
// with Task 7's `DocImage`, the only way a URL reaches the DOM from a document: `detachUrls` took every URL out of the
// tree, and `DocLink` reads the link's own from the map through its `node`, asks `docLinkTarget` what it is, and
// renders that: an in-app link, an anchor that scrolls inside the article, an external or GitHub link opened on tap,
// or an inert span with no `href`.
import { createContext, useContext, type ComponentProps, type MouseEvent, type ReactNode } from 'react';
import type { Element as HastElement } from 'hast';
import type { DocSectionSlug, DocsRefSpec, DocsTreeOk } from '../../../shared/docs';
import { openExternal } from '../lib/markdown';
import { navigate } from '../lib/router';
import { DOC_LINK_OUTSIDE_PAGE } from './docsText';
import { docLinkTarget, type DetachedUrls } from './docsLinks';

/** The page a link is resolved from (spec 4.11's `{project, pageRef, view, section, path, tree, pageSource}`; refinement
 *  (p)), plus the detached tree's map and the fragment hand-off. `pageRef: null` is the default view (the page names
 *  no ref). `pageSource` is the source of the body on screen. `onFragment` receives a cross-doc link's fragment when
 *  its plain click navigates in-app, so the visit scrolls to it once the new body renders (refinement (o)). */
export interface DocLinkContextValue {
  readonly project: string;
  readonly pageRef: DocsRefSpec | null;
  readonly view: 'effective' | 'committed';
  readonly section: DocSectionSlug;
  readonly path: string;
  readonly tree: DocsTreeOk;
  readonly pageSource: 'committed' | 'draft';
  readonly urls: WeakMap<HastElement, DetachedUrls>;
  readonly onFragment: (fragment: string) => void;
}

/** The Docs page around a document body. `null`, the default, has ONE meaning: `DocLink` is rendered outside a Docs
 *  page, and renders every link inert. */
export const DocLinkContext = createContext<DocLinkContextValue | null>(null);

/** A primary-button click with no modifier: the one click `DocLink` handles in-app. A modifier or middle click is the
 *  browser's (a new tab onto `/docs/...`). */
function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** The element inside `article` whose id is `fragment`, or `fragment` percent-decoded once. The ids are compared as
 *  strings, so no selector is ever built from document text (spec 4.11 names `CSS.escape`; this needs no escaping, and
 *  jsdom has no `CSS`). An empty fragment names nothing. */
export function fragmentTarget(article: Element, fragment: string): Element | null {
  if (fragment === '') return null;
  let decoded: string | null;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    decoded = null;
  }
  for (const el of article.querySelectorAll('[id]')) {
    if (el.id === fragment || el.id === decoded) return el;
  }
  return null;
}

/** A fragment link's click, whatever the button or modifier: prevented, so there is never a history entry (a new tab
 *  would open this same page), and the element the fragment names inside this link's `<article>` is scrolled into
 *  view; nothing outside the article is. */
function scrollToFragment(e: MouseEvent<HTMLAnchorElement>, fragment: string): void {
  e.preventDefault(); // no history entry, whatever the click
  const article = e.currentTarget.closest('article');
  if (article !== null) fragmentTarget(article, fragment)?.scrollIntoView();
}

/** The Markdown `a` of a Docs page (spec 4.11). Its URL comes only from the detached map, through `node`; every other
 *  prop the tree gave it (an `id`, a `title`, a footnote's `data-*` and `aria-*`) is passed on, and no URL prop is.
 *  - `in-app`: `href` is the page URL plus `#fragment` when the link names one (a new tab keeps it); a plain left
 *    click is prevented, hands the fragment to `onFragment`, and navigates to the URL without it.
 *  - `fragment`: `scrollToFragment`, on any click.
 *  - `external` and `github`: `target="_blank" rel="noopener noreferrer"`, opened with `openExternal` on tap only;
 *    a GitHub link carries the trailing "↗ GitHub" mark.
 *  - `inert`, and any link outside a Docs page: `<span className="doc-link-inert" title>` with no `href`. */
export function DocLink(p: ComponentProps<'a'> & { node?: HastElement }): ReactNode {
  const { node, children, href: _href, ping: _ping, target: _target, rel: _rel, onClick: _onClick, ...rest } = p;
  const ctx = useContext(DocLinkContext);
  if (ctx === null) return <span className="doc-link-inert" title={DOC_LINK_OUTSIDE_PAGE}>{children}</span>;
  const raw = (node === undefined ? undefined : ctx.urls.get(node)?.attrs['href']) ?? '';
  const t = docLinkTarget(ctx, raw);
  switch (t.kind) {
    case 'in-app':
      return (
        <a {...rest} href={t.fragment === null ? t.href : `${t.href}#${t.fragment}`} onClick={(e) => {
          if (!isPlainClick(e)) return;
          e.preventDefault();
          if (t.fragment !== null) ctx.onFragment(t.fragment);
          navigate(t.href);
        }}>{children}</a>
      );
    case 'fragment':
      return <a {...rest} href={`#${t.fragment}`} onClick={(e) => scrollToFragment(e, t.fragment)}>{children}</a>;
    case 'external':
    case 'github':
      return (
        <a {...rest} href={t.href} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, t.href)}>
          {children}
          {t.kind === 'github' && <>{' '}<span className="doc-link-gh">↗ GitHub</span></>}
        </a>
      );
    case 'inert':
      return <span className="doc-link-inert" title={t.title}>{children}</span>;
  }
}
