// The Docs link policy (spec 2026-10-01 4.10 "Highlighting" and 4.11; W5 part 1 Task 6). `detachUrls` takes every
// URL out of a parsed tree before it renders, so no URL-bearing attribute reaches the DOM except through `DocLink` (and,
// from Task 7, `DocImage`), and records the page highlight budget's decision for each `pre`; `docLinkTarget` is the one
// decision `DocLink` renders; `docsLocation` is the one builder of a page location a Docs view links to (refinement
// (q)). Pure: no React, no DOM, no module state, and no input is ever written.
import type { Element as HastElement, Root as HastRoot, RootContent } from 'hast';
import { urlAttributes } from 'html-url-attributes';
import {
  docsPageUrl, githubBlobUrl, resolveDocRef, type DocSectionSlug, type DocsPageLocation,
} from '../../../shared/docs';
import { DOCS_HIGHLIGHT_PAGE_MAX_CHARS } from '../lib/markdownLimits';
import { DOC_LINK_INERT_SENTENCE, type DocLinkInertReason } from './docsText';
import type { DocLinkContextValue } from './DocLink';

/** What `detachUrls` recorded for one element of the copy. `attrs` holds every URL property moved off it (empty when it
 *  carried none), keyed by its hast property name, its value as text. `imageIndex: null` means the element is not an
 *  `img`; `highlight: null` means it is not a `pre`. */
export interface DetachedUrls {
  readonly attrs: Readonly<Record<string, string>>;
  readonly imageIndex: number | null;
  readonly highlight: boolean | null;
}

/** A detached copy: the tree to render, the map its elements' URLs and decisions live in (keyed by the COPY's
 *  elements, which are the `node` a component receives), and how many `img` elements it numbered. */
export interface Detached {
  readonly tree: HastRoot;
  readonly urls: WeakMap<HastElement, DetachedUrls>;
  readonly images: number;
}

/** Every property name `html-url-attributes` lists. Moved off EVERY element whatever its tag: the package's tag lists
 *  say where a browser reads the key as a URL, and a key on another tag is moved too, so nothing depends on that
 *  list being right (fail closed). */
const URL_KEYS: readonly string[] = Object.keys(urlAttributes);

/** A hast property value as URL text: a string as is, a number in decimal, a list space-joined (as hast-util-to-jsx-
 *  runtime writes a space-separated attribute); `null` for a boolean, `null` or `undefined`, which hold no URL. */
function urlText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).join(' ');
  return null;
}

/** The characters of text under `pre`'s `code` children (spec 4.10: `pre > code`), in UTF-16 code units as `CodeBlock`
 *  measures a block. Iterative. */
function preCodeChars(pre: HastElement): number {
  let chars = 0;
  const stack: RootContent[] = pre.children.filter((c) => c.type === 'element' && c.tagName === 'code');
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'text') chars += node.value.length;
    else if (node.type === 'element') for (const c of node.children) stack.push(c);
  }
  return chars;
}

/** A copy of `tree` with every URL moved out (spec 4.11; refinement (n)). Iteratively, in document pre-order: the root
 *  and every element are copied (text, comment and doctype nodes are shared, untouched); every `URL_KEYS` property of
 *  an element is deleted from its copy and recorded in `urls` under the copy; `img` elements are numbered 0..n-1;
 *  and each `pre` records the page highlight budget's decision: the `pre > code` text of every block so far, this one
 *  included, is summed, and the block is `highlight: true` while the sum is at most `DOCS_HIGHLIGHT_PAGE_MAX_CHARS`,
 *  `false` from the block that passes it on, for every later block too. An element with nothing to record has no
 *  entry. Never writes `tree`, so a kept outcome can be detached again, and part 2's Export reuses the copy and its
 *  map (a second detach of the copy finds no URL). */
export function detachUrls(tree: HastRoot): Detached {
  const urls = new WeakMap<HastElement, DetachedUrls>();
  const root: HastRoot = { ...tree, children: [] };
  // Children are pushed last to first, so they pop first to last; each entry names the array its copy joins.
  const stack: { node: RootContent; to: RootContent[] }[] = [];
  const schedule = (from: readonly RootContent[], to: RootContent[]): void => {
    for (let i = from.length - 1; i >= 0; i--) stack.push({ node: from[i]!, to });
  };
  let images = 0;
  let codeChars = 0;
  schedule(tree.children, root.children);
  while (stack.length > 0) {
    const { node, to } = stack.pop()!;
    if (node.type !== 'element') {
      to.push(node);
      continue;
    }
    const properties = { ...node.properties };
    const attrs: Record<string, string> = {};
    for (const key of URL_KEYS) {
      if (!Object.hasOwn(properties, key)) continue;
      const text = urlText(properties[key]);
      delete properties[key];
      if (text !== null) attrs[key] = text;
    }
    const copy: HastElement = { ...node, properties, children: [] };
    let imageIndex: number | null = null;
    if (node.tagName === 'img') {
      imageIndex = images;
      images += 1;
    }
    let highlight: boolean | null = null;
    if (node.tagName === 'pre') {
      codeChars += preCodeChars(node);
      highlight = codeChars <= DOCS_HIGHLIGHT_PAGE_MAX_CHARS;
    }
    if (Object.keys(attrs).length > 0 || imageIndex !== null || highlight !== null) {
      urls.set(copy, { attrs, imageIndex, highlight });
    }
    to.push(copy);
    schedule(node.children, copy.children);
  }
  return { tree: root, urls, images };
}

/** Where a page links (refinement (q)). `index`: the Docs index. `project`, `section` and `path`: a page of the same
 *  project at the same ref. `default-view`: another (or the same) project's default view, `ref: null`, from any page,
 *  the index included. A `path` target's `view` absent means `effective`. */
export type DocsPageTarget =
  | { kind: 'index' }
  | { kind: 'project' }
  | { kind: 'default-view'; project: string }
  | { kind: 'section'; section: DocSectionSlug }
  | { kind: 'path'; section: DocSectionSlug; path: string; dirSlash: boolean; view?: 'effective' | 'committed' };

/** THE one builder of a page location a Docs view links to (refinement (q)): it keeps `page`'s project and ref and
 *  applies `to`; `frame` is always `inline` (W6 owns `full`). Every page URL a view writes is
 *  `docsPageUrl(docsLocation(page, to))`; no view builds a `DocsPageLocation` literal. The index names no project, so
 *  a `project`, `section` or `path` target from it is a programming error and throws. */
export function docsLocation(page: DocsPageLocation, to: DocsPageTarget): DocsPageLocation {
  if (to.kind === 'index') return { kind: 'index' };
  if (to.kind === 'default-view') return { kind: 'project', project: to.project, ref: null };
  if (page.kind === 'index') throw new Error(`docsLocation: the index names no project for a ${to.kind} target`);
  const { project, ref } = page;
  switch (to.kind) {
    case 'project':
      return { kind: 'project', project, ref };
    case 'section':
      return { kind: 'section', project, section: to.section, ref };
    case 'path':
      return {
        kind: 'path', project, section: to.section, path: to.path, dirSlash: to.dirSlash, ref,
        view: to.view ?? 'effective', frame: 'inline',
      };
  }
}

/** What `DocLink` renders for one link (spec 4.11). `in-app`: a Docs page of the same project at the page's ref
 *  (`href` is that page's URL, never with a fragment; `fragment: null` means the link names none). `fragment`: an
 *  anchor in this page. `external`: an http, https or mailto URL, opened on tap only. `github`: an in-repo file outside
 *  the four sections, on GitHub through `githubBlobUrl`. `inert`: everything else, with the span's whole title. */
export type DocLinkTarget =
  | { kind: 'in-app'; href: string; fragment: string | null }
  | { kind: 'fragment'; fragment: string }
  | { kind: 'external'; href: string }
  | { kind: 'github'; href: string }
  | { kind: 'inert'; title: string };

/** The one decision for a Markdown link on a Docs page: `raw`, the link's `href` as `detachUrls` moved it (`''` for a
 *  link with none), resolved from the page's own section and path by L0 `resolveDocRef`. A doc link keeps the page's
 *  project and ref and drops `view` (`docsLocation`'s `path` target with no `view`); an inert link's title is
 *  `<sentence>: <raw>`. */
export function docLinkTarget(ctx: DocLinkContextValue, raw: string): DocLinkTarget {
  const inert = (why: DocLinkInertReason): DocLinkTarget => ({ kind: 'inert', title: `${DOC_LINK_INERT_SENTENCE[why]}: ${raw}` });
  const r = resolveDocRef({ section: ctx.section, path: ctx.path }, raw);
  switch (r.kind) {
    case 'doc': {
      const here: DocsPageLocation = { kind: 'project', project: ctx.project, ref: ctx.pageRef };
      const href = docsPageUrl(docsLocation(here, { kind: 'path', section: r.section, path: r.path, dirSlash: false }));
      return { kind: 'in-app', href, fragment: r.fragment };
    }
    case 'fragment':
      return { kind: 'fragment', fragment: r.fragment };
    case 'external':
      return { kind: 'external', href: r.url };
    case 'repo': {
      const link = githubBlobUrl(ctx.tree.github, ctx.tree.ref, { kind: 'repo', repoPath: r.repoPath });
      return link.ok ? { kind: 'github', href: link.url } : inert(link.why);
    }
    case 'self-contained':
      return inert(r.scheme);
    case 'refused':
      return inert(r.why);
  }
}
