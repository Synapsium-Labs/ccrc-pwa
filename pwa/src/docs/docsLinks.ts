// The Docs link policy (spec 2026-10-01 4.10 "Highlighting" and 4.11; W5 part 1 Task 6). `detachUrls` takes every
// URL out of a parsed tree before it renders, so no URL-bearing attribute reaches the DOM except through `DocLink` and
// `DocImage`; `docLinkTarget` is the one decision
// `DocLink` renders; `imagePinFor` is the one pin rule for a page's images (W5 part 1 Task 7); `docsLocation` is the
// one builder of a page location a Docs view links to (refinement (q)). `docLinkTarget` and `docsLocation`, with
// `docLinkTarget`'s answer type and `docsLocation`'s target type, are defined in `docLinkTarget.ts` and re-exported from here
// (the reader's policy asks `docLinkTarget` and must not reach this file's hook-module import of `pinFor`). Pure: no React state or hook (`imagePinFor`
// asks the visit's pure `pinFor` for the page's own pin), no DOM, no module state, and no input is ever written.
// `sessionDocsHref` is the one builder of a session's link into Docs, for the actions sheet's row and the session
// menu's item alike (spec 4.8; W5 part 1 Task 11). `docHref` is the one builder of the Docs reader address of a repository
// document path, which the ledgers and chat both ask (moved here from `ledgers/ledgerLinks.ts`, chat reading Task L, D-8062).
import type { Element as HastElement, Root as HastRoot, RootContent } from 'hast';
import { urlAttributes } from 'html-url-attributes';
import type { FleetSession } from '../../../shared/api';
import {
  DOC_SECTIONS, DOC_SECTION_SLUGS, admitDraft, docsPageUrl, entryView, isDocsBareRef, isDocsProject, isDocsRelPath,
  type DocPin, type DocsEntry, type DocsPageLocation, type DocsRefSpec, type DocsTreeOk,
} from '../../../shared/docs';
import { docsLocation } from './docLinkTarget';
import { pinFor } from './useDocsVisit';

// `docLinkTarget` and `docsLocation`, with their `DocLinkTarget` and `DocsPageTarget` types, are defined in
// `docLinkTarget.ts` (pure, no hook module, so the reader's policy can ask them) and re-exported here: every importer keeps this path.
export { docLinkTarget, docsLocation } from './docLinkTarget';
export type { DocLinkTarget, DocsPageTarget } from './docLinkTarget';

/** What `detachUrls` recorded for one element of the copy. `attrs` holds every URL property moved off it (empty when it
 *  carried none), keyed by its hast property name, its value as text. `imageIndex: null` means the element is not an
 *  `img`. */
export interface DetachedUrls {
  readonly attrs: Readonly<Record<string, string>>;
  readonly imageIndex: number | null;
}

/** A detached copy: the tree to render, the map its elements' URLs and decisions live in (keyed by the COPY's
 *  elements, which are the `node` a component receives), and how many `img` elements it numbered. */
export interface Detached {
  readonly tree: HastRoot;
  readonly urls: WeakMap<HastElement, DetachedUrls>;
  readonly images: number;
}

/** Every property name `html-url-attributes` (3.0.1) lists, and the URL-bearing names in hast's property form it
 *  lacks: `srcSet` and `imageSrcSet` (a list of URLs), `xLinkHref`, `xLinkArcRole` and `xmlBase` (SVG and XML), the
 *  legacy `longDesc`, `lowSrc`, `background`, `classId`, `codeBase`, `archive`, `useMap` and `profile`. So
 *  `URL_KEYS` is a superset of `html-url-attributes`. Moved off EVERY element whatever its tag: the package's tag
 *  lists say where a browser reads the key as a URL, and a key on another tag is moved too, so nothing depends on
 *  that list being right (fail closed). */
const URL_KEYS: readonly string[] = [
  ...Object.keys(urlAttributes),
  'srcSet', 'imageSrcSet', 'xLinkHref', 'xLinkArcRole', 'xmlBase', 'longDesc', 'lowSrc', 'background', 'classId',
  'codeBase', 'archive', 'useMap', 'profile',
];

/** A hast property value as URL text: a string as is, a number in decimal, a list space-joined (as hast-util-to-jsx-
 *  runtime writes a space-separated attribute); `null` for a boolean, `null` or `undefined`, which hold no URL. */
function urlText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).join(' ');
  return null;
}

/** A copy of `tree` with every URL moved out (spec 4.11; refinement (n)). Iteratively, in document pre-order: the root
 *  and every element are copied (text, comment and doctype nodes are shared, untouched); every `URL_KEYS` property of
 *  an element is deleted from its copy and recorded in `urls` under the copy; `img` elements are numbered 0..n-1. An element with nothing to record has no
 *  entry. Never writes `tree`, so a kept outcome can be detached again, and part 2's Export reuses the copy and its
 *  map (a second detach of the copy finds no URL).
 *  From W5h-a it decides nothing about highlighting: the page's highlight store does (`lib/highlightStore.ts`). */
export function detachUrls(tree: HastRoot): Detached {
  const urls = new WeakMap<HastElement, DetachedUrls>();
  const root: HastRoot = { ...tree, children: [] };
  // Children are pushed last to first, so they pop first to last; each entry names the array its copy joins.
  const stack: { node: RootContent; to: RootContent[] }[] = [];
  const schedule = (from: readonly RootContent[], to: RootContent[]): void => {
    for (let i = from.length - 1; i >= 0; i--) stack.push({ node: from[i]!, to });
  };
  let images = 0;
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
    if (Object.keys(attrs).length > 0 || imageIndex !== null) {
      urls.set(copy, { attrs, imageIndex });
    }
    to.push(copy);
    schedule(node.children, copy.children);
  }
  return { tree: root, urls, images };
}

/** Which bytes a Markdown image on a Docs page may show (spec 4.11's pin rule). `ok`: `pin` names them; `draft` is
 *  true exactly when `pin` is a `DraftPin` (the image wears the `draft` chip and counts in the page banner);
 *  `uncommittedNotShown` is true exactly when a committed page in a ref view shows the committed bytes of an image
 *  whose draft would overlay there ("uncommitted change not shown"). Not ok, each one reason: `absent` (no entry at
 *  the path, or the side the rule needs is not a committed file or exec), `deleted-in-worktree` (a draft page whose
 *  image the worktree deletes), `draft-withheld` (a draft page whose image's draft is withheld or a type change: the
 *  committed bytes are never shown in its place). */
export type ImagePin =
  | { ok: true; pin: DocPin; draft: boolean; uncommittedNotShown: boolean }
  | { ok: false; why: 'absent' | 'deleted-in-worktree' | 'draft-withheld' };

/** THE pin rule for a page's images (spec 4.11; the ONE derivation: `DocImage` now, Export in part 2, the W6 mockup
 *  planner). `e` is the tree entry at the image's resolved path; `undefined` means there is none. The page is a DRAFT
 *  page exactly when its own leaf opens a draft (`pinFor` answers a `DraftPin`); every other page is committed (the
 *  default view, `view=committed`, a ref-view leaf that opens committed, and a page whose leaf is not in the tree).
 *  - committed page: a committed file or exec gives `CommittedPin(ref.commit, ref.served)` (at `page.at` on a version
 *    page), else `absent`; in a ref view an image whose draft `admitDraft` admits is marked `uncommittedNotShown` (never
 *    on a version page). A draft is never resolved.
 *  - draft page (an admitted holder at the served commit): no draft on the image gives the committed side under the
 *    same condition; a deleted draft is `deleted-in-worktree`; a draft `entryView` opens gives
 *    `DraftPin(drafts.branch, worktree head, fp)`; any other draft is `draft-withheld`.
 *  `pageDraft` is `pageOpensDraft(tree, page)` when the caller already holds it (the mockup planner asks it once per
 *  plan, so a page of many references does not search the listing for the page's own entry once per reference); when
 *  omitted it is asked here. */
export function imagePinFor(
  e: DocsEntry | undefined, tree: DocsTreeOk, page: DocsPageLocation & { kind: 'path' }, pageDraft?: boolean,
): ImagePin {
  if (e === undefined) return { ok: false, why: 'absent' };
  const drafts = tree.drafts;
  const committed = (uncommittedNotShown: boolean): ImagePin => {
    const kind = e.committed?.kind;
    if (kind !== 'file' && kind !== 'exec') return { ok: false, why: 'absent' };
    // Refinement (n): a version page's images are read at its version (rich-docs spec G6), never at the tip.
    const pin: DocPin = {
      kind: 'committed', commit: page.at ?? tree.ref.commit, servedRef: tree.ref.served, section: e.section, path: e.path,
    };
    return { ok: true, pin, draft: false, uncommittedNotShown };
  };
  if (!(pageDraft ?? pageOpensDraft(tree, page))) return committed(page.at === null && page.ref !== null && admitDraft(e, drafts));
  const draft = e.draft;
  if (draft === null) return committed(false);
  if (entryView(e, drafts, 'ref').badge === 'deleted') return { ok: false, why: 'deleted-in-worktree' };
  if (entryView(e, drafts, 'ref').opens !== 'draft' || drafts.state !== 'holder' || draft.fp === null) {
    return { ok: false, why: 'draft-withheld' };
  }
  const pin: DocPin = {
    kind: 'draft', branch: drafts.branch, head: drafts.worktree.head, section: e.section, path: e.path, fp: draft.fp,
  };
  return { ok: true, pin, draft: true, uncommittedNotShown: false };
}

/** Whether `page` is a DRAFT page for `imagePinFor`: its own leaf opens a draft (`pinFor` answers a `DraftPin`). */
export function pageOpensDraft(tree: DocsTreeOk, page: DocsPageLocation & { kind: 'path' }): boolean {
  return pinFor(tree, page)?.kind === 'draft';
}

/** A session's link into Docs (spec 4.8). `href`: the session's project at the branch its worktree holds NOW, written
 *  verbatim as `?ref=<branch>`, never the workspace slug (workspaces are renamed). `label`: the words both surfaces
 *  show. `branch`: the branch linked; null means the default view is linked, because the session reports no branch or
 *  one outside the bare grammar (and the string `null` never reaches a URL). */
export interface SessionDocsLink {
  readonly href: string;
  readonly label: string;
  readonly branch: string | null;
}

/** THE one builder of a session's link into Docs: `SessionActionsSheet`'s row and `SessionHeader`'s menu item both
 *  call it, and neither builds a Docs URL of its own. It reads `s.project`, never `boardHome(s)`: a session's docs
 *  are its own repository's, whatever card it renders on. The URL goes through `docsLocation` and `docsPageUrl`
 *  (refinement (q)). Null has one meaning: `s.project` fails the project grammar, so there is no row to render. */
export function sessionDocsHref(s: FleetSession): SessionDocsLink | null {
  const project = s.project;
  if (!isDocsProject(project)) return null;
  const home = docsLocation({ kind: 'index' }, { kind: 'default-view', project });
  const ref = sessionBranchRef(s.branch);
  if (ref === null) return { href: docsPageUrl(home), label: 'Docs, default branch', branch: null };
  const at = docsLocation(home, { kind: 'same-page', project, ref });
  return { href: docsPageUrl(at), label: 'Docs on ' + ref.name, branch: ref.name };
}

/** The ref a session's Docs links open at: its worktree's branch as a bare ref when the branch is in the bare grammar, else
 *  null (no branch, or one outside it), which links the default view. The one rule `sessionDocsHref` and chat's document links
 *  share (chat reading Task L, D-8062, R12). */
export function sessionBranchRef(branch: string | null): (DocsRefSpec & { kind: 'bare' }) | null {
  return branch !== null && isDocsBareRef(branch) ? { kind: 'bare', name: branch } : null;
}

/** The Docs reader address of a repository document path (`docs/superpowers/specs/x.md`) in `homeProject`, at `ref` (null, the
 *  default: the project's default view, as the ledgers link), or null: no home project, a home the Docs grammar refuses, or a
 *  path outside the docs sections or outside their path grammar. Chat passes the session's branch (`sessionBranchRef`, R12). */
export function docHref(repoPath: string, homeProject: string | null, ref: DocsRefSpec | null = null): string | null {
  if (homeProject === null || !isDocsProject(homeProject)) return null;
  for (const section of DOC_SECTION_SLUGS) {
    const dir = `${DOC_SECTIONS[section]}/`;
    if (!repoPath.startsWith(dir)) continue;
    const path = repoPath.slice(dir.length);
    if (!isDocsRelPath(path)) return null;
    return docsPageUrl(docsLocation(
      { kind: 'project', project: homeProject, ref },
      { kind: 'path', section, path, dirSlash: false },
    ));
  }
  return null;
}
