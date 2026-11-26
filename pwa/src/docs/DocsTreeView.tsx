// The project, section and directory pages of the Docs screen (spec 2026-10-01 4.4; W5 part 1 Task 9), and a path
// page the tree answer does not list. Pure renderers of one tree answer: every row and link is built by
// `docsLocation` (refinement (q)), so it keeps the page's project and ref; rows come from `listDir` in
// `SECTION_ORDER`; every word is `DOCS_VIEW_TEXT`'s. The header and the banners above it (crumbs, truth line, actions,
// the default-view hint) are `DocsHead`'s and `DocsBanners`', which `DocsScreen` mounts.
import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  DOC_SECTION_SLUGS, contentClass, docsPageUrl, entryView,
  type DocSectionSlug, type DocsPageLocation, type DocsTreeOk, type EntryMode,
} from '../../../shared/docs';
import { navigate } from '../lib/router';
import { docsLocation } from './docsLinks';
import { DOCS_VIEW_TEXT, ENTRY_BADGE_TEXT, fillSentence, kib, pluralS, shortCommit } from './docsText';
import {
  CLASS_GLYPH, FOLDER_GLYPH, SECTION_LABEL, docTitle, docsPathKind, leafName, listDir, sectionDocs, sectionFacts,
} from './docsTree';

/** An in-app link to a Docs page: a real `href` (a modifier or middle click opens a new tab), and a plain left click
 *  navigates in place with a history entry. */
export function DocsPageLink(p: {
  readonly href: string; readonly className?: string; readonly children: ReactNode;
  /** The link's full words where it may be drawn shortened (a crumb, desk-nav Part B); absent: none. */
  readonly title?: string;
  /** The link's name where its visible words may hide (the desk head's row, desk-nav Part B); absent: its text. */
  readonly label?: string;
}): ReactNode {
  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(p.href);
  };
  return <a href={p.href} className={p.className} title={p.title} aria-label={p.label} onClick={onClick}>{p.children}</a>;
}

/** One `.docs-row` button (spec 4.4: one `<button>` per row); a tap navigates with a history entry. */
export function RowButton(p: { readonly href: string; readonly children: ReactNode; readonly title?: string }): ReactNode {
  return <button type="button" className="docs-row" title={p.title} onClick={() => navigate(p.href)}>{p.children}</button>;
}

/** A doc's title and its date label, the words every listing of docs draws (X2 P4.1): the title is `docTitle`'s, the date its
 *  own quiet label when the name carried one. The raw name stays in the row's details (its `title`). */
function DocTitleWords(p: { readonly name: string; readonly nested?: true }): ReactNode {
  const { title, date } = docTitle(p.name);
  return (
    <>
      <span className={p.nested ? 'min-w-0 [overflow-wrap:anywhere]' : 'docs-row-name'}>{title}</span>
      {date !== null && <> <span className="docs-row-note">{date}</span></>}
    </>
  );
}

/** Indent the index and project page's child lists without changing a row's tap height. */
export const DOC_CHILD_LIST = 'min-w-0 ps-[var(--sp-4)]';

/** One doc of a section as a link row (the project page's and the index's lists): its title and date, and its draft badge. */
export function DocLinkRow(p: {
  readonly href: string; readonly name: string; readonly badge?: string | null;
  /** The raw name kept in the row's details: the section-relative path (two nested docs can share a leaf name); absent: `name`. */
  readonly detail?: string;
}): ReactNode {
  return (
    <DocsPageLink href={p.href} className="docs-row" title={p.detail ?? p.name}>
      <DocTitleWords name={p.name} nested />
      {p.badge != null && <> <span className="docs-badge">{p.badge}</span></>}
    </DocsPageLink>
  );
}

/** One directory's list item in a listing: its glyph, its name with a trailing slash, and how many entries lie under it. The
 *  project pages' listing and an outside folder's (`FolderPages.tsx`) draw their directories through this one. */
export function DirRow(p: { readonly href: string; readonly name: string; readonly count: number }): ReactNode {
  return (
    <li>
      <RowButton href={p.href}>
        <span className="docs-row-glyph" aria-hidden="true">{FOLDER_GLYPH}</span>
        <span className="docs-row-name">{p.name}/</span> <span className="docs-row-count">{p.count}</span>
      </RowButton>
    </li>
  );
}

function modeOf(page: DocsPageLocation): EntryMode {
  return page.kind !== 'index' && page.ref !== null ? 'ref' : 'default';
}

/** A project's section rows, in `DOC_SECTIONS` order, for the sections the tree answer lists, and its notes (spec 4.4). */
function ProjectPage(p: { readonly tree: DocsTreeOk; readonly page: DocsPageLocation }): ReactNode {
  const { tree, page } = p;
  const mode = modeOf(page);
  const short = shortCommit(tree.ref.commit);
  const drafts = tree.drafts;
  return (
    <div className="docs-project">
      <ul className="docs-rows">
        {DOC_SECTION_SLUGS.map((slug) => {
          const s = sectionFacts(tree, slug);
          if (s === null) return null;
          const label = <span className="docs-row-name">{SECTION_LABEL[slug]}</span>;
          const path = <span className="docs-row-path">{s.path}</span>;
          if (s.state !== 'present') {
            const why = s.state === 'absent' ? DOCS_VIEW_TEXT.sectionAbsent : DOCS_VIEW_TEXT.sectionNotDir;
            return (
              <li key={slug}>
                <div className="docs-row docs-row-off" data-section={slug}>
                  {label} {path} <span className="docs-row-note">{fillSentence(why, { short })}</span>
                </div>
              </li>
            );
          }
          let drafted = 0;
          let withheld = 0;
          if (mode === 'ref') {
            for (const e of tree.entries) {
              if (e.section !== slug) continue;
              const badge = entryView(e, drafts, 'ref').badge;
              if (badge === 'withheld') withheld += 1;
              else if (badge !== null) drafted += 1;
            }
          }
          const href = docsPageUrl(docsLocation(page, { kind: 'section', section: slug }));
          const docs = sectionDocs(tree.entries, slug, mode, drafts);
          return (
            <li key={slug}>
              <RowButton href={href}>
                {label} {path} <span className="docs-row-count">{s.count}</span>
                {drafted + withheld > 0 && (
                  <span className="docs-row-drafts">
                    {fillSentence(DOCS_VIEW_TEXT.sectionDrafts, { n: drafted, s: pluralS(drafted) })}
                    {withheld > 0 && ` · ${fillSentence(DOCS_VIEW_TEXT.sectionWithheld, { n: withheld })}`}
                  </span>
                )}
              </RowButton>
              {docs.length > 0 && (
                <div className={DOC_CHILD_LIST}>
                  <ul className="docs-rows" aria-label={SECTION_LABEL[slug]}>
                    {docs.map(({ entry, view }) => (
                      <li key={entry.path}>
                        <DocLinkRow
                          name={leafName(entry.path)} detail={entry.path} badge={view.badge === null ? null : ENTRY_BADGE_TEXT[view.badge]}
                          href={docsPageUrl(docsLocation(page, { kind: 'path', section: slug, path: entry.path, dirSlash: false }))}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {tree.unlisted.count > 0 && (
        <p className="docs-note">
          {fillSentence(DOCS_VIEW_TEXT.treeUnlisted, { n: tree.unlisted.count, s: pluralS(tree.unlisted.count) })}
        </p>
      )}
      {drafts.state === 'holder' && drafts.opaque.length > 0 && (
        <p className="docs-note">{fillSentence(DOCS_VIEW_TEXT.opaque, { dirs: drafts.opaque.join(', ') })}</p>
      )}
    </div>
  );
}

/** A section root (`dir === ''`) or a directory: a filter and `listDir`'s rows (spec 4.4). */
function ListingPage(p: {
  readonly tree: DocsTreeOk; readonly page: DocsPageLocation; readonly section: DocSectionSlug; readonly dir: string;
}): ReactNode {
  const { tree, page, section, dir } = p;
  const [filter, setFilter] = useState('');
  const listing = listDir(tree.entries, section, dir, modeOf(page), tree.drafts);
  const needle = filter.toLowerCase();
  const shown = (name: string): boolean => needle === '' || name.toLowerCase().includes(needle);
  const prefix = dir === '' ? '' : dir + '/';
  const folders = listing.folders.filter((f) => shown(f.name));
  const files = listing.files.filter((f) => shown(leafName(f.entry.path)) || shown(docTitle(leafName(f.entry.path)).title));
  return (
    <div className="docs-listing">
      <input
        type="search" className="docs-filter" aria-label={DOCS_VIEW_TEXT.filterEntries} placeholder={DOCS_VIEW_TEXT.filterEntries} value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {sectionFacts(tree, section) === null
        ? <p className="docs-note">{DOCS_VIEW_TEXT.sectionUnserved}</p>
        : listing.folders.length + listing.files.length === 0 && <p className="docs-note">{DOCS_VIEW_TEXT.emptyListing}</p>}
      <ul className="docs-rows">
        {folders.map((f) => (
          <DirRow
            key={'d:' + f.name} name={f.name} count={f.count}
            href={docsPageUrl(docsLocation(page, { kind: 'path', section, path: prefix + f.name, dirSlash: true }))}
          />
        ))}
        {files.map(({ entry, view }) => {
          const href = docsPageUrl(docsLocation(page, { kind: 'path', section, path: entry.path, dirSlash: false }));
          const size = view.opens === 'draft' ? entry.draft?.size : entry.committed?.size;
          const mark = view.committedKind === 'symlink' || view.committedKind === 'submodule' ? view.committedKind : null;
          return (
            <li key={'f:' + entry.path}>
              <RowButton href={href} title={leafName(entry.path)}>
                <span className="docs-row-glyph" aria-hidden="true">{CLASS_GLYPH[contentClass(entry.path)]}</span>
                <DocTitleWords name={leafName(entry.path)} />
                {view.badge !== null && <> <span className="docs-badge">{ENTRY_BADGE_TEXT[view.badge]}</span></>}
                {mark !== null && <> <span className="docs-row-mark">{mark}</span></>}
                {typeof size === 'number' && <> <span className="docs-row-size">{kib(size)}</span></>}
              </RowButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A path the tree answer does not list (spec 4.4): "Not in this listing at <short commit>". The default-view hint
 *  that may follow it (spec 4.4: "plus the default-view hint when it applies") is `DocsBanners`' one hint, shown on
 *  every default-view page of a holder with drafts, so this page draws no second copy of it. */
function MissingPage(p: { readonly tree: DocsTreeOk; readonly section: DocSectionSlug }): ReactNode {
  const unserved = sectionFacts(p.tree, p.section) === null;
  return (
    <div className="docs-missing">
      <p className="docs-note">
        {unserved ? DOCS_VIEW_TEXT.sectionUnserved : fillSentence(DOCS_VIEW_TEXT.missing, { short: shortCommit(p.tree.ref.commit) })}
      </p>
    </div>
  );
}

/** The project, section and directory pages, and a path page that is not a leaf (spec 4.4). A leaf is `DocsLeaf`'s;
 *  given one here (or the index), this renders nothing. */
export function DocsTreeView(p: { readonly tree: DocsTreeOk; readonly page: DocsPageLocation }): ReactNode {
  const { tree, page } = p;
  switch (page.kind) {
    case 'index':
      return null;
    case 'project':
      return <ProjectPage tree={tree} page={page} />;
    case 'section':
      return <ListingPage key={page.section} tree={tree} page={page} section={page.section} dir="" />;
    case 'path': {
      const kind = docsPathKind(tree, page.section, page.path, modeOf(page)).kind;
      if (kind === 'dir') {
        return <ListingPage key={page.section + '/' + page.path} tree={tree} page={page} section={page.section} dir={page.path} />;
      }
      return kind === 'missing' ? <MissingPage tree={tree} section={page.section} /> : null;
    }
  }
}
