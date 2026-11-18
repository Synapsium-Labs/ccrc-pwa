// The Docs link decision, in a module of its own so the reader's policy (`reader/policy.ts`, ring L1) can ask it without
// reaching a hook module (the completion plan's Task 13; `reader-policy.test.ts` walks policy.ts's runtime imports and
// fails on a `.tsx`, a hook module, a store or `lib/api.ts`). It holds `docLinkTarget`, the one decision for a Markdown
// link on a Docs page (spec 2026-10-01 4.11), its `DocLinkTarget` answer, and `docsLocation` with its `DocsPageTarget`,
// the one builder of a page location a Docs view links to (refinement (q)), which `docLinkTarget` builds a page URL
// through. Pure: no React, no DOM, no module state, and no input is ever written. `docsLinks.ts` re-exports these names,
// so every importer keeps its path and each name is still defined once, here.
import {
  docsPageUrl, githubBlobUrl, resolveDocRef, type DocSectionSlug, type DocsPageLocation, type DocsRefSpec,
} from '../../../shared/docs';
import { DOC_LINK_INERT_SENTENCE, type DocLinkInertReason } from './docsText';
import type { DocLinkContextValue } from './DocLink';

/** Where a page links (refinement (q)). `index`: the Docs index. `project`, `section` and `path`: a page of the same
 *  project at the same ref. `default-view`: another (or the same) project's default view, `ref: null`, from any page,
 *  the index included. `same-page`: this very page (its section, path, view and frame) in `project` at `ref`
 *  (`ref: null` is that project's default view): the linked-worktree redirect (spec 4.7) and every "open this page at
 *  another ref" link. It keeps the page's `at`, so switching the ref keeps the version. A `path` target's `view` absent means `effective`. */
export type DocsPageTarget =
  | { kind: 'index' }
  | { kind: 'project' }
  | { kind: 'default-view'; project: string }
  | { kind: 'same-page'; project: string; ref: DocsRefSpec | null }
  | { kind: 'section'; section: DocSectionSlug }
  | { kind: 'path'; section: DocSectionSlug; path: string; dirSlash: boolean; view?: 'effective' | 'committed';
      /** Absent: the page's own version (a leaf page's `at`, else the latest); `null`: the latest; a sha: that version. */
      at?: string | null }
  /** This leaf at the version `at`, or at the latest for `null` (rich-docs spec G6): Back to the latest, and W8b's
   *  `version` op. Keeps the page's project, ref and frame; `view` is `effective` (a version is committed bytes). */
  | { kind: 'version'; at: string | null };

/** THE one builder of a page location a Docs view links to (refinement (q)): it keeps `page`'s project and ref and
 *  applies `to`; a `path` target's `frame` is `inline` (W6 owns `full`), while a `same-page` target keeps the page's
 *  own frame, view and everything else. Every page URL a view writes is
 *  `docsPageUrl(docsLocation(page, to))`; no view builds a `DocsPageLocation` literal. The index names no project, so
 *  a `project`, `section`, `path` or `same-page` target from it is a programming error and throws. A `path` target
 *  inherits a leaf page's `at` unless it names one; `version` sets or clears it. */
export function docsLocation(page: DocsPageLocation, to: DocsPageTarget): DocsPageLocation {
  if (to.kind === 'index') return { kind: 'index' };
  if (to.kind === 'default-view') return { kind: 'project', project: to.project, ref: null };
  if (page.kind === 'index') throw new Error(`docsLocation: the index names no project for a ${to.kind} target`);
  if (to.kind === 'same-page') return { ...page, project: to.project, ref: to.ref };
  if (to.kind === 'version') {
    if (page.kind !== 'path') throw new Error(`docsLocation: a version target needs a leaf page, not a ${page.kind}`);
    return { ...page, at: page.dirSlash ? null : to.at, view: 'effective' };
  }
  const { project, ref } = page;
  switch (to.kind) {
    case 'project':
      return { kind: 'project', project, ref };
    case 'section':
      return { kind: 'section', project, section: to.section, ref };
    case 'path':
      return {
        kind: 'path', project, section: to.section, path: to.path, dirSlash: to.dirSlash, ref,
        // Refinement (o): a leaf's version follows its links, as a GitHub blob URL's commit does; a directory has none.
        at: to.dirSlash ? null : to.at !== undefined ? to.at : page.kind === 'path' ? page.at : null,
        view: to.view ?? 'effective', frame: 'inline',
      };
  }
}

/** What `DocLink` renders for one link (spec 4.11). `in-app`: a Docs page of the same project at the page's ref
 *  (`href` is that page's URL, never with a fragment; `fragment: null` means the link names none). `fragment`: an
 *  anchor in this page. `external`: an http, https or mailto URL, opened on tap only. `github`: an in-repo file outside
 *  the docs sections, on GitHub through `githubBlobUrl`, with that builder's `note`, except on a version page, where the
 *  note is always `may-differ`: the link names the branch, which may have moved past the version shown (`may-differ` is
 *  the caution View on GitHub carries too). `inert`: everything else, with the span's whole title. */
export type DocLinkTarget =
  | { kind: 'in-app'; href: string; fragment: string | null }
  | { kind: 'fragment'; fragment: string }
  | { kind: 'external'; href: string }
  | { kind: 'github'; href: string; note: 'may-differ' | null }
  | { kind: 'inert'; title: string };

/** The one decision for a Markdown link on a Docs page: `raw`, the link's `href` as `detachUrls` moved it (`''` for a
 *  link with none), resolved from the page's own section and path by L0 `resolveDocRef`. A doc link keeps the page's
 *  project and ref and drops `view` (`docsLocation`'s `path` target with no `view`), except that a link to THIS page
 *  that names a fragment is a `fragment` link. An inert link's title is `<sentence>: <raw>`. */
export function docLinkTarget(ctx: DocLinkContextValue, raw: string): DocLinkTarget {
  const inert = (why: DocLinkInertReason): DocLinkTarget => ({ kind: 'inert', title: `${DOC_LINK_INERT_SENTENCE[why]}: ${raw}` });
  const r = resolveDocRef({ section: ctx.section, path: ctx.path }, raw);
  switch (r.kind) {
    case 'doc': {
      // This very page, spelled with its file name and a fragment: an anchor in the page, not a second history entry.
      if (r.fragment !== null && r.section === ctx.section && r.path === ctx.path) {
        return { kind: 'fragment', fragment: r.fragment };
      }
      const here: DocsPageLocation = { kind: 'project', project: ctx.project, ref: ctx.pageRef };
      const href = docsPageUrl(docsLocation(here, { kind: 'path', section: r.section, path: r.path, dirSlash: false, at: ctx.pageAt }));
      return { kind: 'in-app', href, fragment: r.fragment };
    }
    case 'fragment':
      return { kind: 'fragment', fragment: r.fragment };
    case 'external':
      return { kind: 'external', href: r.url };
    case 'repo': {
      const link = githubBlobUrl(ctx.tree.github, ctx.tree.ref, { kind: 'repo', repoPath: r.repoPath });
      // Refinement (o), ruled: the link names the branch, and the file there may differ from this version's, so on a
      // version page its caution always shows.
      return link.ok ? { kind: 'github', href: link.url, note: ctx.pageAt !== null ? 'may-differ' : link.note } : inert(link.why);
    }
    case 'self-contained':
      return inert(r.scheme);
    case 'refused':
      return inert(r.why);
  }
}
