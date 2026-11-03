// Share (spec 2026-10-01 4.5, 4.16; native Docs reader W5, Share) and the Docs screen's one clipboard writer.
//
// `copyText` is the ONE place under `pwa/src/docs` that writes the clipboard (spec 4.5's "One clipboard writer";
// M4.SH7): the truth line's "copy commit", the share sheet's Copy link and the reader frame's copy op all call it.
//
// `shareTargetFor` is what Share sends: a GitHub permalink at the commit the page opened (L0 `githubPermalink`), its
// title and text, and the notes the sheet shows, or the closed word for why there is no link. It reads the tree
// answer, the page and what the leaf opened, never a document's bytes, so no h1, `<title>` or body text reaches a
// link (M4.SH1); every draft word it carries is `entryView`'s, through `ENTRY_BADGE_TEXT` and `WITHHELD_SENTENCE`
// (M4.T7); and a worktree is named only by its closed label. Its sentences are docsText.ts's; the sheet is
// ShareSheet.tsx. It makes no request and keeps no state. (`downloadExport` goes beside `saveBytes` in
// `docs/objectUrls.ts`, spec 4.1 and 5.4.)

import {
  DOC_SECTIONS, admitDraft, contentClass, docRepoPath, entryView, githubPermalink,
  type DocPin, type DocsPageLocation, type DocsShowOk, type DocsTreeOk, type EntryMode,
} from '../../../shared/docs';
import {
  DOCS_HEAD_TEXT, ENTRY_BADGE_TEXT, SHARE_TEXT, WITHHELD_SENTENCE, closedWorktreeLabel, fillSentence, pluralS,
  servedRefText, shortCommit,
} from './docsText';
import { docsPathKind, githubTargetFor, leafName } from './docsTree';

/** Writes `text` to the clipboard. Resolves once it is written; rejects when the clipboard refuses, or when the page
 *  has none (`navigator.clipboard` is absent outside a secure context, whatever the DOM types say). */
export async function copyText(text: string): Promise<void> {
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (clipboard === undefined) throw new Error('The clipboard is not available here.');
  await clipboard.writeText(text);
}

/** Why Share sends no link (spec 4.16 "Refusal words"). Each `GithubPermalink` refusal keeps its own word except
 *  `uncommitted`, which splits by what the leaf opens: `new-draft`, a readable new draft; `new-withheld`, a new file
 *  Docs did not read. They need different sentences, so they are different words. */
export type ShareRefusal =
  | 'no-github-origin' | 'bad-slug' | 'bad-target' | 'not-on-origin' | 'unmeasured' | 'new-draft' | 'new-withheld';

/** The sheet's notes (spec 4.16 "Note words"), one word per note. */
export type ShareNote =
  | 'access' | 'html-source' | 'onRef-not-contained' | 'onRef-unmeasured' | 'drafts-excluded' | 'view-committed'
  | 'admitted-committed' | 'dir-drafts';

/** The values a Share sentence names (`fillSentence`'s fields). */
export type ShareFields = Readonly<Record<string, string | number>>;

/** One note on the sheet: its word, and the values its sentence names. */
export interface ShareNoteLine {
  readonly note: ShareNote;
  readonly fields: ShareFields;
}

/** What the page opened, which decides the commit a link names (spec 4.16 "Which commit"). `file`: a leaf's opened
 *  pin (a raster leaf's is the pin its image settled at), with the file answer when the read answered (null for a
 *  raster leaf, a failed or too-large read, and a class Docs does not preview). `none`: the page opened no file: a
 *  project, section or directory page, or a leaf that opens nothing (a symlink, a submodule, a withheld new file). */
export type ShareOpened =
  | { readonly kind: 'file'; readonly pin: DocPin; readonly show: DocsShowOk | null }
  | { readonly kind: 'none' };

/** What Share sends from a page, or why it sends nothing (spec 4.16). A discriminated union, so a later kind of link
 *  (spec 4.13's expiring links) adds an arm without changing callers. Both arms carry the notes the sheet shows. */
export type ShareTarget =
  | {
    readonly ok: true; readonly url: string; readonly commit: string; readonly title: string; readonly text: string;
    readonly notes: readonly ShareNoteLine[];
  }
  | { readonly ok: false; readonly why: ShareRefusal; readonly fields: ShareFields; readonly notes: readonly ShareNoteLine[] };

/** How many entries in a listing page's scope a ref view badges: the uncommitted docs its link leaves out. A
 *  directory's scope is the entries under `path + '/'`, so `guide` never counts `guidebook/`. */
function draftsInScope(tree: DocsTreeOk, page: Exclude<DocsPageLocation, { kind: 'index' }>): number {
  const inScope = (e: DocsTreeOk['entries'][number]): boolean => page.kind === 'project'
    || (e.section === page.section && (page.kind === 'section' || e.path.startsWith(page.path + '/')));
  return tree.entries.filter((e) => inScope(e) && entryView(e, tree.drafts, 'ref').badge !== null).length;
}

/** What Share sends from `page` (spec 4.16), given what the page `opened`. Null has one meaning: the page has no Share
 *  (the index, or a path this listing does not hold; refinement (m)). The entry is read from the tree through
 *  `docsPathKind`, the rule that decides what the page is (refinement (g)). */
export function shareTargetFor(tree: DocsTreeOk, page: DocsPageLocation, opened: ShareOpened): ShareTarget | null {
  const target = githubTargetFor(page, tree);
  if (target === null || page.kind === 'index') return null;
  const mode: EntryMode = page.ref === null ? 'default' : 'ref';
  const kind = page.kind === 'path' ? docsPathKind(tree, page.section, page.path, mode) : null;
  const leaf = kind?.kind === 'leaf' ? kind : null;
  // Which commit: a leaf's opened committed pin; otherwise the tree's, which is also the committed side an opened draft
  // stands on (a draft opens only when its holder's HEAD is the served commit) and the commit of a leaf that opens
  // nothing, whose page shows the tree's own view of the entry (refinement (r)).
  const commit = leaf !== null && opened.kind === 'file' && opened.pin.kind === 'committed' ? opened.pin.commit : tree.ref.commit;
  const short = shortCommit(commit);
  const link = githubPermalink(tree.github, tree.ref, commit, target);
  const access: ShareNoteLine[] = tree.github.state === 'none' ? [] : [{ note: 'access', fields: { slug: tree.github.slug } }];
  if (!link.ok) {
    const why: ShareRefusal = link.why !== 'uncommitted' ? link.why
      : leaf !== null && leaf.view.opens === 'none' ? 'new-withheld' : 'new-draft';
    const withheld = leaf === null ? null : leaf.view.withheld;
    const fields: ShareFields = why === 'not-on-origin' || why === 'unmeasured' ? { short }
      : why === 'new-withheld' && withheld !== null ? { withheld: WITHHELD_SENTENCE[withheld].replace(/\.$/, '') }
        : {};
    // The access note names the slug, so it shows wherever there is a usable one (spec 4.16, decision 8).
    return { ok: false, why, fields, notes: why === 'no-github-origin' || why === 'bad-slug' ? [] : access };
  }
  const notes: ShareNoteLine[] = [];
  if (leaf !== null && page.kind === 'path') {
    const { entry, view } = leaf;
    const admitted = mode === 'ref' && admitDraft(entry, tree.drafts);
    const label = tree.drafts.state === 'holder' ? closedWorktreeLabel(tree.drafts.worktree) : DOCS_HEAD_TEXT.worktreeOther;
    if (admitted && page.view === 'committed') notes.push({ note: 'view-committed', fields: { label } });
    else if (view.opens === 'draft') notes.push({ note: 'drafts-excluded', fields: { short, label } });
    else if (admitted && view.badge !== null) {
      notes.push({ note: 'admitted-committed', fields: { badge: ENTRY_BADGE_TEXT[view.badge], label } });
    }
    if (contentClass(page.path) === 'html') notes.push({ note: 'html-source', fields: {} });
    // `onRef` describes the commit the answer was read at. After a same-blob re-list that is older than the opened pin,
    // and says nothing of it (refinement (a)).
    if (opened.kind === 'file' && opened.pin.kind === 'committed' && opened.show !== null
      && opened.show.commit === opened.pin.commit) {
      const served = servedRefText(tree.ref);
      if (opened.show.onRef === 'not-contained') notes.push({ note: 'onRef-not-contained', fields: { short, served } });
      if (opened.show.onRef === 'unmeasured') notes.push({ note: 'onRef-unmeasured', fields: { short, served } });
    }
  } else if (mode === 'ref') {
    const k = draftsInScope(tree, page);
    if (k > 0) notes.push({ note: 'dir-drafts', fields: { k, s: pluralS(k), be: k === 1 ? 'is' : 'are' } });
  }
  notes.push(...access);
  const repoPath = target.kind === 'root' ? null
    : target.kind === 'section' ? DOC_SECTIONS[target.section]
      : target.kind === 'repo' ? target.repoPath
        : docRepoPath(target.section, target.path);
  return {
    ok: true, url: link.url, commit: link.commit,
    title: repoPath === null ? page.project : leafName(repoPath),
    text: repoPath === null
      ? fillSentence(SHARE_TEXT.project, { project: page.project, short })
      : fillSentence(SHARE_TEXT.path, { project: page.project, path: repoPath, short }),
    notes,
  };
}
