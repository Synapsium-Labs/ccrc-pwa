// The Docs index (spec 2026-10-01 4.4's index row; refinement (r); W5 part 1 Task 9): every project folder the fleet
// box listed, `ready` rows with docs first by name, then the rest in words, and the projects with no docs folded
// under one disclosure. A pure renderer of one `projects()` answer; every link is `docsLocation`'s.
import { useState, type ReactNode } from 'react';
import { docsPageUrl, type DocsIndexRow, type DocsProjectsResponse } from '../../../shared/docs';
import { formatAge } from '../fleet/formatReset';
import { navigate } from '../lib/router';
import { docsLocation } from './docsLinks';
import { DOCS_VIEW_TEXT, fillSentence, pluralS, shortCommit } from './docsText';
import { sectionCountsText } from './docsTree';
import { DocsPageLink } from './DocsTreeView';

/** A non-ready state in words (spec 4.4). `linked-worktree` and `shared-repo` are "part of <owner>" instead. */
const INDEX_STATE_TEXT: Readonly<Record<Exclude<DocsIndexRow['state'], 'ready' | 'linked-worktree' | 'shared-repo'>, string>> = {
  'not-a-git-repo': 'not a git repository',
  'partial-clone': 'partial clone',
  'no-default-branch': 'no default branch',
  'repo-unreadable': 'unreadable',
};

/** The page the index's links start from. It names no project and no ref, so nothing refinement (q) guards (the page's
 *  project and ref, W5b's `at`) can be dropped by spelling it; every target from it is `default-view`. */
const INDEX: { kind: 'index' } = { kind: 'index' };

function byName(a: DocsIndexRow, b: DocsIndexRow): number {
  return a.project < b.project ? -1 : a.project > b.project ? 1 : 0;
}

/** Whether a row has docs to show: a ready repository with any section count other than 0 (`null`, unknown, counts
 *  as maybe), or a plain folder with a section on disk. Every other state is shown in words, docs or not. */
function hasDocs(row: DocsIndexRow): boolean {
  if (row.state === 'ready') return row.sections === undefined || Object.values(row.sections).some((n) => n !== 0);
  if (row.state === 'not-a-git-repo') return (row.sectionsOnDisk?.length ?? 0) > 0;
  return true;
}

function defaultViewHref(project: string): string {
  return docsPageUrl(docsLocation(INDEX, { kind: 'default-view', project }));
}

function IndexRow(p: { readonly row: DocsIndexRow; readonly sameAs: readonly string[] }): ReactNode {
  const { row, sameAs } = p;
  const dup = sameAs.length > 0
    ? <span className="docs-row-note">{fillSentence(DOCS_VIEW_TEXT.duplicate, { other: sameAs.join(', ') })}</span>
    : null;
  if (row.state === 'ready') {
    const fetch = row.fetch;
    return (
      <button type="button" className="docs-row" onClick={() => navigate(defaultViewHref(row.project))}>
        <span className="docs-row-name">{row.project}</span>
        {row.default !== undefined && (
          <> <span className="docs-row-ref">{row.default.name} · <code>{shortCommit(row.default.commit)}</code></span></>
        )}
        {row.sections !== undefined && <> <span className="docs-row-count">{sectionCountsText(row.sections)}</span></>}
        {fetch !== undefined && (
          <> <span className="docs-row-age">
            {fetch.okAgeMs === null
              ? DOCS_VIEW_TEXT.neverFetched
              : fillSentence(DOCS_VIEW_TEXT.fetched, { age: formatAge(fetch.okAgeMs / 1000) })}
          </span></>
        )}
        {dup !== null && <> {dup}</>}
      </button>
    );
  }
  let state: ReactNode;
  if (row.state === 'linked-worktree' || row.state === 'shared-repo') {
    const owner = row.owner;
    state = typeof owner === 'string'
      ? <DocsPageLink className="docs-owner-link" href={defaultViewHref(owner)}>{fillSentence(DOCS_VIEW_TEXT.partOf, { owner })}</DocsPageLink>
      : DOCS_VIEW_TEXT.partOfUnknown;
  } else {
    state = INDEX_STATE_TEXT[row.state];
  }
  return (
    <div className="docs-row docs-row-off" data-state={row.state}>
      <span className="docs-row-name">{row.project}</span> <span className="docs-row-state">{state}</span>
      {dup !== null && <> {dup}</>}
    </div>
  );
}

/** The index page (spec 4.4): the header sentence, a filter, the rows, the no-docs disclosure and the footers
 *  (refinement (r): `unwalked` has its own footer, `duplicates` say "same repository as", `cacheAgeMs` is not shown). */
export function DocsIndexView(p: { readonly answer: DocsProjectsResponse }): ReactNode {
  const index = p.answer.index;
  const [filter, setFilter] = useState('');
  const needle = filter.toLowerCase();
  const rows = index.projects.filter((r) => needle === '' || r.project.toLowerCase().includes(needle));
  const sameAs = (row: DocsIndexRow): string[] => {
    const group = index.duplicates.find((d) => row.repoKey !== undefined && d.repoKey === row.repoKey);
    return group === undefined ? [] : group.projects.filter((x) => x !== row.project);
  };
  const ready = rows.filter((r) => r.state === 'ready' && hasDocs(r)).sort(byName);
  const rest = rows.filter((r) => r.state !== 'ready' && hasDocs(r)).sort(byName);
  const none = rows.filter((r) => !hasDocs(r)).sort(byName);
  const unwalked = index.unwalked ?? 0;
  const item = (row: DocsIndexRow): ReactNode => <li key={row.project}><IndexRow row={row} sameAs={sameAs(row)} /></li>;
  return (
    <div className="docs-index">
      <p className="docs-index-head">{DOCS_VIEW_TEXT.indexHead}</p>
      <input
        type="search" className="docs-filter" aria-label={DOCS_VIEW_TEXT.filterProjects} value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="docs-rows">{ready.map(item)}{rest.map(item)}</ul>
      {none.length > 0 && (
        <details className="docs-nodocs">
          <summary>{fillSentence(DOCS_VIEW_TEXT.noDocs, { n: none.length })}</summary>
          <ul className="docs-rows">{none.map(item)}</ul>
        </details>
      )}
      {index.unlisted > 0 && (
        <p className="docs-note">{fillSentence(DOCS_VIEW_TEXT.indexUnlisted, { n: index.unlisted, s: pluralS(index.unlisted) })}</p>
      )}
      {unwalked > 0 && (
        <p className="docs-note">{fillSentence(DOCS_VIEW_TEXT.indexUnwalked, { n: unwalked, s: pluralS(unwalked) })}</p>
      )}
    </div>
  );
}
