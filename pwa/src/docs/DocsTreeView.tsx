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
import { CLASS_GLYPH, FOLDER_GLYPH, SECTION_LABEL, docsPathKind, leafName, listDir } from './docsTree';

/** An in-app link to a Docs page: a real `href` (a modifier or middle click opens a new tab), and a plain left click
 *  navigates in place with a history entry. */
export function DocsPageLink(p: { readonly href: string; readonly className?: string; readonly children: ReactNode }): ReactNode {
  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(p.href);
  };
  return <a href={p.href} className={p.className} onClick={onClick}>{p.children}</a>;
}

/** One `.docs-row` button (spec 4.4: one `<button>` per row); a tap navigates with a history entry. */
function RowButton(p: { readonly href: string; readonly children: ReactNode }): ReactNode {
  return <button type="button" className="docs-row" onClick={() => navigate(p.href)}>{p.children}</button>;
}

function modeOf(page: DocsPageLocation): EntryMode {
  return page.kind !== 'index' && page.ref !== null ? 'ref' : 'default';
}

/** A project's four section rows, in `DOC_SECTIONS` order, and its notes (spec 4.4's project row). */
function ProjectPage(p: { readonly tree: DocsTreeOk; readonly page: DocsPageLocation }): ReactNode {
  const { tree, page } = p;
  const mode = modeOf(page);
  const short = shortCommit(tree.ref.commit);
  const drafts = tree.drafts;
  return (
    <div className="docs-project">
      <ul className="docs-rows">
        {DOC_SECTION_SLUGS.map((slug) => {
          const s = tree.sections.find((x) => x.slug === slug);
          if (s === undefined) return null;
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
  const files = listing.files.filter((f) => shown(leafName(f.entry.path)));
  return (
    <div className="docs-listing">
      <input
        type="search" className="docs-filter" aria-label={DOCS_VIEW_TEXT.filterEntries} placeholder={DOCS_VIEW_TEXT.filterEntries} value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {listing.folders.length + listing.files.length === 0 && <p className="docs-note">{DOCS_VIEW_TEXT.emptyListing}</p>}
      <ul className="docs-rows">
        {folders.map((f) => (
          <li key={'d:' + f.name}>
            <RowButton href={docsPageUrl(docsLocation(page, { kind: 'path', section, path: prefix + f.name, dirSlash: true }))}>
              <span className="docs-row-glyph" aria-hidden="true">{FOLDER_GLYPH}</span>
              <span className="docs-row-name">{f.name}/</span> <span className="docs-row-count">{f.count}</span>
            </RowButton>
          </li>
        ))}
        {files.map(({ entry, view }) => {
          const href = docsPageUrl(docsLocation(page, { kind: 'path', section, path: entry.path, dirSlash: false }));
          const size = view.opens === 'draft' ? entry.draft?.size : entry.committed?.size;
          const mark = view.committedKind === 'symlink' || view.committedKind === 'submodule' ? view.committedKind : null;
          return (
            <li key={'f:' + entry.path}>
              <RowButton href={href}>
                <span className="docs-row-glyph" aria-hidden="true">{CLASS_GLYPH[contentClass(entry.path)]}</span>
                <span className="docs-row-name">{leafName(entry.path)}</span>
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
function MissingPage(p: { readonly tree: DocsTreeOk }): ReactNode {
  return (
    <div className="docs-missing">
      <p className="docs-note">{fillSentence(DOCS_VIEW_TEXT.missing, { short: shortCommit(p.tree.ref.commit) })}</p>
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
      return kind === 'missing' ? <MissingPage tree={tree} /> : null;
    }
  }
}
