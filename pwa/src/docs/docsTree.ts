// The Docs listing's pure rules (spec 2026-10-01 4.4; W5 part 1 Task 9): what a section or directory page lists and
// in what order, what a path page IS (a leaf, a directory, or not in this listing), the section labels and the
// counts string. Every list of sections is derived from L0's `DOC_SECTION_SLUGS`, and the label and order tables are
// `Record`s over its type, so a seventh section is a compile error here until it has both. No React, no DOM, no state.
import {
  DOC_SECTION_SLUGS, DOCS_INDEX_NEWEST_PER_SECTION, entryView,
  type DocContentClass, type DocSectionSlug, type DocsEntry, type DocsIndexRow, type DocsPageLocation, type DocsTreeOk, type DraftsFacts,
  type EntryMode, type EntryView, type GithubTarget,
} from '../../../shared/docs';

/** A section's label, also the noun of its count (`12 specs · 40 plans · 3 design · 0 conventions`). */
export const SECTION_LABEL: Readonly<Record<DocSectionSlug, string>> = {
  specs: 'specs',
  plans: 'plans',
  'product-design': 'design',
  conventions: 'conventions',
  vision: 'vision',
  promise: 'promise',
};

/** How a section lists (spec 4.4): `specs` and `plans` newest first (name descending; their names are
 *  date-prefixed), the other four alphabetical. Folders and files each follow it. */
export const SECTION_ORDER: Readonly<Record<DocSectionSlug, 'newest-first' | 'alphabetical'>> = {
  specs: 'newest-first',
  plans: 'newest-first',
  'product-design': 'alphabetical',
  conventions: 'alphabetical',
  vision: 'alphabetical',
  promise: 'alphabetical',
};

/** A row's glyph by the path's content class (decorative; the row's name carries the meaning). */
export const CLASS_GLYPH: Readonly<Record<DocContentClass, string>> = {
  markdown: '¶',
  raster: '▣',
  svg: '◇',
  html: '⧉',
  pdf: '▤',
  text: '≡',
  other: '·',
};

/** A folder row's glyph. */
export const FOLDER_GLYPH = '▸';

/** One section or directory page's rows (spec 4.4): folders first, each with the number of LISTED entries anywhere
 *  under it, then files, each with its `entryView`. */
export interface DirListing {
  readonly folders: readonly { name: string; count: number }[];
  readonly files: readonly { entry: DocsEntry; view: EntryView }[];
}

/** Code-unit order, never the locale's: the same listing sorts the same way on every phone. */
function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The rows of `section` under `dir` (`''`: the section root; otherwise a directory path relative to the section,
 *  with no trailing slash). Only entries `entryView` lists in `mode` count, so a default-view page never lists a
 *  draft-only file and a ref view lists a new draft. Order is `SECTION_ORDER[section]` for folders and files alike. */
export function listDir(
  entries: readonly DocsEntry[], section: DocSectionSlug, dir: string, mode: EntryMode, drafts: DraftsFacts,
): DirListing {
  const prefix = dir === '' ? '' : dir + '/';
  const folders = new Map<string, number>();
  const files: { entry: DocsEntry; view: EntryView }[] = [];
  for (const entry of entries) {
    if (entry.section !== section || !entry.path.startsWith(prefix)) continue;
    const view = entryView(entry, drafts, mode);
    if (!view.listed) continue;
    const rest = entry.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash < 0) files.push({ entry, view });
    else folders.set(rest.slice(0, slash), (folders.get(rest.slice(0, slash)) ?? 0) + 1);
  }
  const sign = SECTION_ORDER[section] === 'newest-first' ? -1 : 1;
  return {
    folders: [...folders].map(([name, count]) => ({ name, count })).sort((a, b) => sign * byName(a.name, b.name)),
    files: files.sort((a, b) => sign * byName(a.entry.path, b.entry.path)),
  };
}

/** A count of one's noun (D-5502): `1 spec`, never `1 specs`. */
const SECTION_LABEL_ONE: Readonly<Record<DocSectionSlug, string>> = {
  specs: 'spec',
  plans: 'plan',
  'product-design': 'design',
  conventions: 'convention',
  vision: 'vision',
  promise: 'promise',
};

/** An index row's counts in `DOC_SECTION_SLUGS` order, for the sections its ccd serves: six, or four from a ccd without
 *  the sections token (rich-docs spec G1, W5b). THE ONE READER of `DocsIndexRow.sections` (the wire's absence-permits
 *  rule): a slug the row does not carry is left out, never shown as `?` or 0; a `null` count is kept (not known). */
export function presentSectionCounts(counts: Readonly<Partial<Record<DocSectionSlug, number | null>>>):
  readonly (readonly [DocSectionSlug, number | null])[] {
  return DOC_SECTION_SLUGS.flatMap((slug) => {
    const n = counts[slug];
    return n === undefined ? [] : [[slug, n] as const];
  });
}

/** The section counts `presentSectionCounts` gives, joined by ` · ` (spec 4.4). A `null` count renders `?`: the count is
 *  not known, never zero. A count of one takes the singular noun (D-5502). */
export function sectionCountsText(counts: Readonly<Partial<Record<DocSectionSlug, number | null>>>): string {
  return presentSectionCounts(counts)
    .map(([slug, n]) => `${n ?? '?'} ${n === 1 ? SECTION_LABEL_ONE[slug] : SECTION_LABEL[slug]}`)
    .join(' · ');
}

/** One section's facts from a tree answer. `null` has one meaning: this ccd serves no such section (a fleet box without
 *  the sections token). A section the repository lacks is a fact of its own (`state: 'absent'`), never `null`. THE ONE
 *  READER of `DocsTreeOk.sections`. */
export function sectionFacts(tree: DocsTreeOk, slug: DocSectionSlug): DocsTreeOk['sections'][number] | null {
  return tree.sections.find((s) => s.slug === slug) ?? null;
}

/** What a `path` page is, from the tree answer, never from the URL's shape (spec 3.1, 4.4): `leaf` when an entry has
 *  exactly this section and path and `entryView` lists it in `mode`; else `dir` when a listed entry lies under
 *  `path + '/'`; else `missing` ("Not in this listing"). */
export type DocsPathKind =
  | { readonly kind: 'leaf'; readonly entry: DocsEntry; readonly view: EntryView }
  | { readonly kind: 'dir' }
  | { readonly kind: 'missing' };

export function docsPathKind(tree: DocsTreeOk, section: DocSectionSlug, path: string, mode: EntryMode): DocsPathKind {
  const exact = tree.entries.find((e) => e.section === section && e.path === path);
  if (exact !== undefined) {
    const view = entryView(exact, tree.drafts, mode);
    if (view.listed) return { kind: 'leaf', entry: exact, view };
  }
  const under = path + '/';
  const dir = tree.entries.some((e) =>
    e.section === section && e.path.startsWith(under) && entryView(e, tree.drafts, mode).listed);
  return dir ? { kind: 'dir' } : { kind: 'missing' };
}

/** What View on GitHub and Share point at (spec 3.11, 4.4, 4.16): the repository root on a project page, the section,
 *  the directory, or the leaf (`uncommitted` when its entry has no committed side). Null has one meaning: the page has
 *  no GitHub counterpart (the index, or a path this listing does not hold). Moved here from `DocsHead.tsx`, which
 *  re-exports it, so `share.ts` reaches the one target rule without importing a component (refinement (k)). */
export function githubTargetFor(page: DocsPageLocation, tree: DocsTreeOk): GithubTarget | null {
  switch (page.kind) {
    case 'index':
      return null;
    case 'project':
      return { kind: 'root' };
    case 'section':
      return { kind: 'section', section: page.section };
    case 'path': {
      const k = docsPathKind(tree, page.section, page.path, page.ref === null ? 'default' : 'ref');
      if (k.kind === 'leaf') return { kind: 'leaf', section: page.section, path: page.path, uncommitted: k.entry.committed === null };
      return k.kind === 'dir' ? { kind: 'dir', section: page.section, path: page.path } : null;
    }
  }
}

/** The last segment of a section-relative path: a leaf's file name, and the name Download saves it under. */
export function leafName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A leaf name read as a title (X2 P4.1, spec §2.1 I3): the extension and a leading `YYYY-MM-DD-` come off, and every `-` and
 *  `_` becomes a space, runs collapsed. An extension is the last `.` followed by 1 to 10 letters or digits (at least one a
 *  letter) and nothing else, never a dotfile's whole name, so `v1.0-notes` and `release-1.2.3` keep their dots. The date is
 *  its own label (`'YYYY-MM-DD'`, else null). A name that leaves nothing reads as itself, whole, with no date label; a name
 *  whose stem is only a date keeps the date label and reads as itself. `name` is a leaf name, never a path. */
export function docTitle(name: string): { title: string; date: string | null } {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 && /^(?=.*[A-Za-z])[A-Za-z0-9]{1,10}$/.test(name.slice(dot + 1)) ? name.slice(0, dot) : name;
  if (/^\d{4}-\d{2}-\d{2}$/.test(stem)) return { title: name, date: stem };
  const m = /^(\d{4}-\d{2}-\d{2})-/.exec(stem);
  const body = m === null ? stem : stem.slice(m[0].length);
  const title = body.replace(/[-_]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return title === '' ? { title: name, date: null } : { title, date: m === null ? null : m[1]! };
}

/** One section's newest names from an index row (X2 P4.1, spec §5.1): `names` as received (newest first, at most
 *  `DOCS_INDEX_NEWEST_PER_SECTION`, never re-sorted), and `more` the docs the count holds beyond them. */
export interface IndexNewest {
  readonly slug: DocSectionSlug;
  readonly names: readonly string[];
  readonly more: number;
}

/** THE ONE READER of `DocsIndexRow.newest` (the wire's absence-permits rule, as `presentSectionCounts` is for `sections`):
 *  absent, nothing. Otherwise, in `DOC_SECTION_SLUGS` order, only a section the row's counts carry above 0 and whose names
 *  the row sent, its first five names and `more` = the count less the names shown, never negative. A project whose `newest`
 *  the wire cap dropped (ccd drops a whole project's, from the last project backwards) has the field absent, so it reads as
 *  nothing, its counts still whole in `sectionCountsText`. A field that is not an array, or an entry that is not a string
 *  (a newer or odd ccd), is left out, never a crash. */
export function indexNewest(row: DocsIndexRow): readonly IndexNewest[] {
  const newest = row.newest;
  if (newest === undefined || newest === null || row.sections === undefined) return [];
  return presentSectionCounts(row.sections).flatMap(([slug, n]) => {
    const sent: unknown = newest[slug];
    if (n === null || n <= 0 || !Array.isArray(sent)) return [];
    const names = (sent as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, DOCS_INDEX_NEWEST_PER_SECTION);
    if (names.length === 0) return [];
    return [{ slug, names, more: Math.max(0, n - names.length) }];
  });
}

/** A project page's docs of one section (X2 P4.1, spec §5.2): every file `entryView` lists in `mode`, at any depth, newest
 *  first (descending code-unit order of the section-relative path), from the tree answer the page already holds. */
export function sectionDocs(
  entries: readonly DocsEntry[], section: DocSectionSlug, mode: EntryMode, drafts: DraftsFacts,
): readonly { entry: DocsEntry; view: EntryView }[] {
  return entries
    .filter((e) => e.section === section)
    .map((entry) => ({ entry, view: entryView(entry, drafts, mode) }))
    .filter((x) => x.view.listed)
    .sort((a, b) => -byName(a.entry.path, b.entry.path));
}
