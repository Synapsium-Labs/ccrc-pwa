// An outside folder's pages: the loader seam and the pure rules (X2 P2.4, spec 4.1). L1 policy plus the seam's types, no React,
// no DOM, no state, and no URL of its own: every link is `docsPageUrl`'s over a `DocsFolderLocation`.
//
// WHY A MODULE OF ITS OWN. `DocsHead.tsx` owns the project page's truth line and the five actions' off reasons, and another
// programme holds it (#3289), so this wave does not edit it. The folder page's words (`DOCS_FOLDER_TEXT`, docsText.ts) and the
// deciders here (`folderTruthLine`, `folderActions`, `folderCrumbs`, `folderUp`) are what `DocsHead` is to read once it can
// take a folder page; until then `FolderHead` (FolderPages.tsx) draws them. A folder has no repository, so none of a project
// page's facts exist for it: no ref, no commit, no drafts, no freshness, no version, no GitHub page. Its one fact is the
// modified time of the file read, and only a fingerprinted file read (the show answer) carries it: a range read's prepare
// answer carries none, so the truth line says its first clause alone there (a known limit).
import {
  DOC_SECTION_SLUGS, DOCS_CLASS_CAP, DOCS_RANGE_MAX_BYTES, contentClass, docsPageUrl, statPin,
  type DocSectionSlug, type DocsFailure, type DocsFolderAddResponse, type DocsFolderEntry, type DocsFolderFileResponse, type DocsFolderLabelRow,
  type DocsFolderLocation,
  type DocsFolderRemoveResponse, type DocsFolderTreeOk, type DocsFolderTreeResponse, type DocsFoldersLabelsResponse,
  type DocsFoldersPathsResponse, type DocsRangeFrame, type DocsRangePin, type DocsRangePrepared,
} from '../../../shared/docs';
import { DOCS_FOLDER_TEXT, DOCS_HEAD_TEXT, DOCS_RELIST_WORDS, fillSentence } from './docsText';
import type { DocsAnswer } from './failures';
import { SECTION_LABEL, SECTION_ORDER } from './docsTree';
import type { RangeLoader, RangeTarget } from './range/readRange';

/** The loader seam of the folder pages and Settings' section (spec 4.1 and 7); `api.docs.folders` is the default and tests
 *  inject their own. Each resolves an answer, as every docs loader does: a docs word is `{s:'failed'}`, a client slot is its
 *  own arm. `paths` is called only by Settings' Docs folders section (the one door whose answer carries an absolute path,
 *  `docs-ring.test.ts` holds it). `add` and `remove` REJECT with the box's `ApiError` for an account gate refusal
 *  (`{error: 'step-up-required' | 'auth-off' | ...}`, which has no docs word), so the section's step-up can read it. */
export interface DocsFolderLoaders {
  labels(): Promise<DocsAnswer<DocsFoldersLabelsResponse>>;
  paths(): Promise<DocsAnswer<DocsFoldersPathsResponse>>;
  add(label: string, path: string): Promise<DocsAnswer<DocsFolderAddResponse>>;
  remove(label: string): Promise<DocsAnswer<DocsFolderRemoveResponse>>;
  tree(label: string, signal?: AbortSignal): Promise<DocsAnswer<DocsFolderTreeResponse>>;
  file(label: string, section: DocSectionSlug, path: string, fp: string, signal?: AbortSignal): Promise<DocsAnswer<DocsFolderFileResponse>>;
  readonly range: {
    prepare(label: string, section: DocSectionSlug, path: string, range: DocsRangePin, signal: AbortSignal): Promise<DocsAnswer<DocsRangePrepared>>;
    frame(label: string, section: DocSectionSlug, path: string, range: DocsRangePin, snapshot: string, offset: number,
      length: number, signal: AbortSignal): Promise<DocsAnswer<DocsRangeFrame>>;
  };
}

/** What the index shows of the outside folders, from the labels read: the rows, or one quiet line. The index never shows an
 *  error banner for them and never a group with nothing in it. `null`: no read answered yet. The smallest honest behaviour:
 *  a refused read (sign-in dark, or no session) says so in one note; any other failure says the folders could not be read;
 *  an empty registry draws nothing. */
export type FolderIndexSlot =
  | { readonly s: 'ok'; readonly rows: readonly DocsFolderLabelRow[] }
  | { readonly s: 'quiet'; readonly text: string };

export function folderIndexSlot(a: DocsAnswer<DocsFoldersLabelsResponse>): FolderIndexSlot {
  if (a.s === 'ok') return { s: 'ok', rows: a.value.folders };
  const dark = a.s === 'auth' || (a.s === 'failed' && (a.body.failure === 'auth-off' || a.body.failure === 'unauthenticated'));
  return { s: 'quiet', text: dark ? DOCS_FOLDER_TEXT.indexNeedsSignIn : DOCS_FOLDER_TEXT.indexUnread };
}

/** A folder's `RangeLoader` for the range leaf (`RangeLeaf` reads through one): the target's place and range pin, the label
 *  closed over. The target's `project` is never read, so the leaf's key can carry any text. */
export function folderRangeLoader(label: string, folders: DocsFolderLoaders['range']): RangeLoader {
  return {
    prepare: (t: RangeTarget, signal) => folders.prepare(label, t.pin.section, t.pin.path, t.range, signal),
    frame: (t: RangeTarget, snapshot, offset, length, signal) =>
      folders.frame(label, t.pin.section, t.pin.path, t.range, snapshot, offset, length, signal),
  };
}

/** The range side of a folder leaf's visit (`RangeLeaf` reads through one). A word that means the file changed under the read
 *  (`DOCS_RELIST_WORDS`, `draft-changed` for a folder) re-reads the folder's listing: the first time on its own (`'relist'`),
 *  then, once that is spent, only on the reader's tap (`'changing'`, whose button calls `rangeRetry`). Any other word is none
 *  of the listing's business (`'other'`). `reload` re-reads the tree; `relists` counts the trees read since the page opened,
 *  which `RangeLeaf` watches to read again; `spent` answers and records whether the one automatic re-list was used. */
export function folderRangeVisit(reload: () => void, relists: number, spent: { current: boolean }): {
  rangeFailed(word: DocsFailure): 'relist' | 'changing' | 'other';
  rangeRead(): void; rangeRetry(): void; readonly rangeRelists: number; readonly rangeWaiting: boolean;
} {
  return {
    rangeFailed: (word) => {
      if (!DOCS_RELIST_WORDS.has(word)) return 'other';
      if (spent.current) return 'changing';
      spent.current = true;
      reload();
      return 'relist';
    },
    rangeRead: () => { spent.current = false; },
    rangeRetry: reload,
    rangeRelists: relists,
    rangeWaiting: false,
  };
}

/** One section or directory page's rows: folders first with the number of entries under each, then files, each in
 *  `SECTION_ORDER[section]`. Every kind of entry is listed (a symlink is shown and never opened), so the listing says what
 *  is there. */
export interface FolderListing {
  readonly folders: readonly { name: string; count: number }[];
  readonly files: readonly DocsFolderEntry[];
}

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function folderListing(entries: readonly DocsFolderEntry[], section: DocSectionSlug, dir: string): FolderListing {
  const prefix = dir === '' ? '' : dir + '/';
  const folders = new Map<string, number>();
  const files: DocsFolderEntry[] = [];
  for (const e of entries) {
    if (e.section !== section || !e.path.startsWith(prefix)) continue;
    const rest = e.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash < 0) files.push(e);
    else folders.set(rest.slice(0, slash), (folders.get(rest.slice(0, slash)) ?? 0) + 1);
  }
  const sign = SECTION_ORDER[section] === 'newest-first' ? -1 : 1;
  return {
    folders: [...folders].map(([name, count]) => ({ name, count })).sort((a, b) => sign * byName(a.name, b.name)),
    files: files.sort((a, b) => sign * byName(a.path, b.path)),
  };
}

/** What a path page of a folder IS, from the listing, never from the URL's shape: a listed entry with exactly this section
 *  and path (a `leaf`, whatever its kind), else a directory with entries under it, else `missing`. */
export type FolderPathKind =
  | { readonly kind: 'leaf'; readonly entry: DocsFolderEntry }
  | { readonly kind: 'dir' }
  | { readonly kind: 'missing' };

export function folderPathKind(tree: DocsFolderTreeOk, section: DocSectionSlug, path: string): FolderPathKind {
  const exact = tree.entries.find((e) => e.section === section && e.path === path);
  if (exact !== undefined) return { kind: 'leaf', entry: exact };
  const under = path + '/';
  return tree.entries.some((e) => e.section === section && e.path.startsWith(under)) ? { kind: 'dir' } : { kind: 'missing' };
}

/** The sections a folder's root page lists, in `DOC_SECTION_SLUGS` order, each with the number of its entries. */
export function folderSectionRows(tree: DocsFolderTreeOk): readonly { section: DocSectionSlug; count: number }[] {
  return DOC_SECTION_SLUGS.map((section) => ({ section, count: tree.entries.filter((e) => e.section === section).length }))
    .filter((r) => r.count > 0);
}

/** How a folder leaf is read (spec 4.3 for the range side). `file`: within the class cap and fingerprinted, one read of the
 *  file door keyed by `fp`. `range`: above the cap or unfingerprinted, a snapshot read up to `DOCS_RANGE_MAX_BYTES`, pinned
 *  by `fp` or, with none, by the listing's size and time (`statPin`). `none`: nothing to read, with the reason. A raster
 *  has no folder view (the file door serves no raster), so it is `none` too. */
export type FolderReadPlan =
  | { readonly mode: 'file'; readonly fp: string }
  | { readonly mode: 'range'; readonly range: DocsRangePin; readonly size: number }
  | { readonly mode: 'none'; readonly why: 'not-a-file' | 'no-preview' | 'too-large' | 'unpinned' };

export function folderReadPlan(entry: DocsFolderEntry): FolderReadPlan {
  if (entry.kind !== 'file' || entry.size === null) return { mode: 'none', why: 'not-a-file' };
  const cls = contentClass(entry.path);
  if (cls === 'raster' || cls === 'other') return { mode: 'none', why: 'no-preview' };
  if (entry.size <= DOCS_CLASS_CAP[cls] && entry.fp !== null) return { mode: 'file', fp: entry.fp };
  if (entry.size > DOCS_RANGE_MAX_BYTES) return { mode: 'none', why: 'too-large' };
  const range: DocsRangePin | null = entry.fp !== null ? { kind: 'fp', sha: entry.fp } : statPin(entry.size, entry.mtimeNs ?? undefined);
  return range === null ? { mode: 'none', why: 'unpinned' } : { mode: 'range', range, size: entry.size };
}

/** A listed modified time as the truth line writes it: UTC, to the minute. `null` for a time outside the grammar (a time
 *  before 1970 is negative and never matches), so the line says nothing rather than a wrong time. */
export function folderTimeText(mtimeNs: string | null): string | null {
  if (mtimeNs === null || !/^(0|[1-9][0-9]{0,18})$/.test(mtimeNs)) return null;
  const ms = Number(BigInt(mtimeNs) / 1000000n);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/** The folder page's truth line: "Not in a repository", and the file's modified time (the listing's, or the show's, which is
 *  the time of the bytes read) when there is one. A directory or a section page has no file time: the first clause alone. */
export function folderTruthLine(mtimeNs: string | null): string {
  const time = folderTimeText(mtimeNs);
  return time === null ? DOCS_FOLDER_TEXT.notInRepo : fillSentence(DOCS_FOLDER_TEXT.truth, { time });
}

/** The five actions a project page offers, and each one's state on a folder page: all five are off, each with its reason. */
export const FOLDER_ACTIONS = ['history', 'changes', 'versions', 'github', 'share'] as const;
export type FolderAction = (typeof FOLDER_ACTIONS)[number];

export function folderActions(): readonly { action: FolderAction; on: false; reason: string }[] {
  return FOLDER_ACTIONS.map((action) => ({ action, on: false as const, reason: DOCS_FOLDER_TEXT.off[action] }));
}

/** A folder page's crumbs: Docs, the folder (`~label`), the section, then each directory of the path. */
export function folderCrumbs(loc: DocsFolderLocation): { label: string; href: string }[] {
  const crumbs: { label: string; href: string }[] = [{ label: DOCS_HEAD_TEXT.index, href: docsPageUrl({ kind: 'index' }) }];
  crumbs.push({ label: '~' + loc.label, href: docsPageUrl({ kind: 'folder', label: loc.label }) });
  if (loc.kind === 'folder') return crumbs;
  crumbs.push({ label: SECTION_LABEL[loc.section], href: docsPageUrl({ kind: 'folder-section', label: loc.label, section: loc.section }) });
  if (loc.kind === 'folder-section') return crumbs;
  const parts = loc.path.split('/');
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    crumbs.push({
      label: part,
      href: docsPageUrl({
        kind: 'folder-path', label: loc.label, section: loc.section, path: parts.slice(0, i + 1).join('/'),
        dirSlash: last ? loc.dirSlash : true,
      }),
    });
  });
  return crumbs;
}

/** The page one level up from a folder page. */
export function folderUp(loc: DocsFolderLocation): string {
  if (loc.kind === 'folder') return docsPageUrl({ kind: 'index' });
  if (loc.kind === 'folder-section') return docsPageUrl({ kind: 'folder', label: loc.label });
  const cut = loc.path.lastIndexOf('/');
  return docsPageUrl(cut < 0
    ? { kind: 'folder-section', label: loc.label, section: loc.section }
    : { kind: 'folder-path', label: loc.label, section: loc.section, path: loc.path.slice(0, cut), dirSlash: true });
}
