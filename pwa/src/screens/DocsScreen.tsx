// The Docs screen (spec 2026-10-01 3.1, 4.2-4.4, 4.7; W5 part 1 Task 9): the route component the app's `docs` arm
// mounts, unkeyed, so one mount is one visit. It parses the URL (a parse failure is its sentence and a link to the
// index), fixes a non-canonical URL by replace, loads the index or the visit's tree, follows a linked worktree to the
// repository that owns it by replace, and hands the page to its view: the index, a project, section or directory
// page, or a leaf. It owns the page's image queue and the drafted-asset count, and gives both to the images through
// `DocsAssetContext`. The header, banners and freshness chip are Task 10's.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DOCS_PAGE_PREFIX, docsPageUrl, parseDocsPage, parseDocsRef,
  type DocsPageLocation, type DocsProjectsResponse, type DocsRefSpec, type DocsTreeOk,
} from '../../../shared/docs';
import { DocsAssetContext, type DocsAssetContextValue } from '../docs/DocImage';
import { DocsFailureView } from '../docs/DocsFailureView';
import { DocsIndexView } from '../docs/DocsIndexView';
import { DocsLeaf } from '../docs/DocsLeaf';
import { DocsPageLink, DocsTreeView } from '../docs/DocsTreeView';
import { createFetchQueue } from '../docs/fetchQueue';
import type { DocsLoaders, DocsNotOk } from '../docs/failures';
import { docsLocation } from '../docs/docsLinks';
import { DOCS_PAGE_INVALID_SENTENCE, DOCS_VIEW_TEXT, fillSentence } from '../docs/docsText';
import { docsPathKind } from '../docs/docsTree';
import { useDocsVisit, type TreeSlot } from '../docs/useDocsVisit';
import { api } from '../lib/api';
import { onAuthRegained } from '../lib/auth';
import { docsRunner, type MarkdownParser } from '../lib/markdownRunner';
import { navigate } from '../lib/router';

/** The defaults are module-scope constants (spec 4.3, the `MailScreen` idiom), so their identities are stable across
 *  renders: a new `loaders` would reload every image on the page (`DocsAssetContext`'s contract). */
const DEFAULT_DOCS_LOADERS: DocsLoaders = api.docs;
const DEFAULT_DOCS_PARSER: MarkdownParser = (src, o) => docsRunner.parse(src, o);

/** The index's answer this visit. `null` has one meaning: no index request has been made in this visit yet. */
type IndexSlot = { s: 'loading' } | { s: 'ok'; answer: DocsProjectsResponse } | DocsNotOk;

/** A replace-navigation the screen owes, and the note the page it lands on shows (`null`: none). */
interface Redirect { readonly href: string; readonly note: string | null }

/** The words that send a page to the repository that owns it (spec 4.7). */
function isOwnedElsewhere(slot: TreeSlot | null): slot is Extract<TreeSlot, { s: 'failed' }> {
  return slot?.s === 'failed' && (slot.body.failure === 'linked-worktree' || slot.body.failure === 'shared-repo');
}

/** The owner redirect (spec 4.7, refinement (c)): the same page in the owner's project. `branch` a ref Docs can
 *  address: that ref. `branch: null` (a detached HEAD, or a branch ccd could not read): the owner's default view,
 *  with refinement (c)'s sentence. A `branch` string Docs cannot address: the default view, saying so. `branch`
 *  ABSENT (a `shared-repo` answer names only its owner): the page's own ref, since it is the same repository. An
 *  owner that is not a string (`null`, or absent): no redirect; the page renders the word's sentence. */
function ownerRedirect(page: DocsPageLocation, slot: TreeSlot | null): Redirect | null {
  if (!isOwnedElsewhere(slot) || page.kind === 'index') return null;
  const { owner, branch } = slot.body;
  if (typeof owner !== 'string') return null;
  let ref: DocsRefSpec | null = page.ref;
  let note: string | null = null;
  if (branch === null) {
    ref = null;
    note = fillSentence(DOCS_VIEW_TEXT.redirectNullBranch, { owner });
  } else if (typeof branch === 'string') {
    ref = parseDocsRef(branch);
    if (ref === null) note = fillSentence(DOCS_VIEW_TEXT.redirectBadBranch, { owner, branch });
  }
  return { href: docsPageUrl(docsLocation(page, { kind: 'same-page', project: owner, ref })), note };
}

/** A path page whose slash the tree contradicts (spec 3.1): a directory reached without its slash goes to the slash
 *  form, and a leaf reached with one goes to the slash-less form. */
function slashRedirect(page: DocsPageLocation, tree: DocsTreeOk): Redirect | null {
  if (page.kind !== 'path') return null;
  const kind = docsPathKind(tree, page.section, page.path, page.ref === null ? 'default' : 'ref').kind;
  if (kind === 'dir' && !page.dirSlash) {
    return { href: docsPageUrl(docsLocation(page, { kind: 'path', section: page.section, path: page.path, dirSlash: true })), note: null };
  }
  if (kind === 'leaf' && page.dirSlash) {
    const to = { kind: 'path', section: page.section, path: page.path, dirSlash: false, view: page.view } as const;
    return { href: docsPageUrl(docsLocation(page, to)), note: null };
  }
  return null;
}

function treeOf(slot: TreeSlot | null): DocsTreeOk | null {
  return slot?.s === 'ok' ? slot.answer.tree : null;
}

export function DocsScreen(p: {
  path: string; search: string; loaders?: DocsLoaders; parser?: MarkdownParser;
}): ReactNode {
  const { path, search, loaders = DEFAULT_DOCS_LOADERS, parser = DEFAULT_DOCS_PARSER } = p;
  const here = path + search;
  const parsed = useMemo(() => parseDocsPage(path, search), [path, search]);
  const page = parsed.ok ? parsed.loc : null;
  const visit = useDocsVisit(page, loaders);

  // The image queue and the drafted-asset count, one each per visit, stable across renders (DocsAssetContext).
  const [queue] = useState(createFetchQueue);
  const [draftAssets, setDraftAssets] = useState(0);
  const onDraftAsset = useCallback((delta: number) => setDraftAssets((n) => n + delta), []);
  const assets = useMemo<DocsAssetContextValue>(() => ({ loaders, queue, onDraftAsset }), [loaders, queue, onDraftAsset]);

  // The default parser's worker is started on mount, so the first leaf does not wait for it (spec 4.3).
  useEffect(() => {
    if (parser === DEFAULT_DOCS_PARSER) docsRunner.prewarm();
  }, [parser]);

  // A direct load's `#fragment` is honoured once, like a cross-doc link's (refinement (o)).
  const setFragment = visit.setFragment;
  useEffect(() => {
    if (location.hash.length > 1) setFragment(location.hash.slice(1));
  }, [setFragment]);

  // The index: one GET per visit, re-made after a sign-in when it answered `auth`.
  const [index, setIndex] = useState<IndexSlot | null>(null);
  const indexInflight = useRef(false);
  const loadIndex = useCallback(() => {
    if (indexInflight.current) return;
    indexInflight.current = true;
    setIndex((s) => (s?.s === 'ok' ? s : { s: 'loading' }));
    void loaders.projects().then((a) => {
      indexInflight.current = false;
      setIndex(a.s === 'ok' ? { s: 'ok', answer: a.value } : a);
    });
  }, [loaders]);
  const isIndex = page?.kind === 'index';
  useEffect(() => {
    if (isIndex && index === null) loadIndex();
  }, [isIndex, index, loadIndex]);
  useEffect(() => onAuthRegained(() => setIndex((s) => (s?.s === 'auth' ? null : s))), []);

  // Every redirect is a replace (M4.R4): canonicalisation, the slash the tree decides, the owner of a worktree.
  const tree = treeOf(visit.tree);
  let redirect: Redirect | null = null;
  if (parsed.ok && parsed.canonical !== here) redirect = { href: parsed.canonical, note: null };
  else if (page !== null && tree !== null) redirect = slashRedirect(page, tree);
  else if (page !== null) redirect = ownerRedirect(page, visit.tree);
  const [note, setNote] = useState<{ readonly at: string; readonly text: string } | null>(null);
  const target = redirect?.href ?? null;
  const targetNote = redirect?.note ?? null;
  useEffect(() => {
    if (target === null || target === here) return;
    if (targetNote !== null) setNote({ at: target, text: targetNote });
    navigate(target, { replace: true });
  }, [target, targetNote, here]);

  let body: ReactNode;
  if (!parsed.ok) {
    body = (
      <div className="docs-invalid" role="alert">
        <p className="docs-note">{DOCS_PAGE_INVALID_SENTENCE[parsed.why]}</p>
        <DocsPageLink className="docs-hint-link" href={DOCS_PAGE_PREFIX}>{DOCS_VIEW_TEXT.indexLink}</DocsPageLink>
      </div>
    );
  } else if (page === null || page.kind === 'index') {
    if (index === null || index.s === 'loading') body = <p className="docs-loading">{DOCS_VIEW_TEXT.loading}</p>;
    else if (index.s === 'ok') body = <DocsIndexView answer={index.answer} />;
    else body = <DocsFailureView answer={index} onRetry={() => { setIndex(null); }} />;
  } else {
    const slot = visit.tree;
    if (slot === null || slot.s === 'loading') {
      body = <p className="docs-loading">{DOCS_VIEW_TEXT.loading}</p>;
    } else if (slot.s === 'ok') {
      const t = slot.answer.tree;
      const leaf = page.kind === 'path' && !page.dirSlash
        && docsPathKind(t, page.section, page.path, page.ref === null ? 'default' : 'ref').kind === 'leaf';
      body = leaf && page.kind === 'path'
        ? <DocsLeaf visit={visit} tree={t} page={page} parser={parser} />
        : <DocsTreeView tree={t} page={page} />;
    } else if (isOwnedElsewhere(slot) && typeof slot.body.owner === 'string') {
      body = <p className="docs-loading">{fillSentence(DOCS_VIEW_TEXT.redirecting, { owner: slot.body.owner })}</p>;
    } else {
      const suggestHref = (name: string): string => {
        const ref = parseDocsRef(name);
        return ref === null ? here : docsPageUrl(docsLocation(page, { kind: 'same-page', project: page.project, ref }));
      };
      body = (
        <DocsFailureView
          answer={slot} onRetry={visit.retryTree} onFetchFromOrigin={visit.fetchFromOrigin} suggestHref={suggestHref}
        />
      );
    }
  }
  return (
    <DocsAssetContext value={assets}>
      <div className="docs-screen" data-draft-assets={draftAssets}>
        {note !== null && note.at === here && <p className="docs-note docs-redirect-note" role="status">{note.text}</p>}
        {body}
      </div>
    </DocsAssetContext>
  );
}
