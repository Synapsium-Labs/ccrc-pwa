// X2 Native Docs parity, Task P4.1 (spec 2026-11-18 §2.1 rows I1 to I3, §5 rows 5.1 and 5.2): readable titles, the project
// page's docs under each section row, and the index's newest names. `DocsTreeView` and `DocsIndexView` are pure renderers
// of the answer they are handed, so a render here makes no request of its own (no loader is in reach). Placeholders only.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DOCS_INDEX_NEWEST_PER_SECTION, type DocsIndexOk, type DocsIndexRow, type DocsPageLocation, type DocsProjectsResponse } from '../../shared/docs';
import { DocsIndexView } from '../src/docs/DocsIndexView';
import { DocsTreeView } from '../src/docs/DocsTreeView';
import { docTitle, indexNewest } from '../src/docs/docsTree';
import { COMMIT_B, draftOf, entry, holder, treeOk } from './docsFixtures';

afterEach(cleanup);

describe('docTitle', () => {
  const TABLE: readonly (readonly [string, string, string | null])[] = [
    ['2026-11-18-native-docs-parity-design.md', 'native docs parity design', '2026-11-18'],
    ['README.md', 'README', null],
    ['snake_case_name.txt', 'snake case name', null],
    ['2026-1-1-x.md', '2026 1 1 x', null],
    ['.env', '.env', null],
    ['2026-11-18-.md', '2026-11-18-.md', null],
    ['a.b.c.md', 'a.b.c', null],
    ['no-extension', 'no extension', null],
    // A real extension is the last `.` followed by 1 to 10 letters or digits (at least one a letter) and nothing else.
    ['v1.0-notes', 'v1.0 notes', null],
    ['release-1.2.3', 'release 1.2.3', null],
    ['notes.v 2', 'notes.v 2', null],
    // A name whose stem is only a date: the date label is kept, the title is the raw name.
    ['2026-11-18.md', '2026-11-18.md', '2026-11-18'],
  ];
  it('docTitle: table of names', () => {
    for (const [name, title, date] of TABLE) expect({ name, ...docTitle(name) }).toEqual({ name, title, date });
  });
});

describe('project page', () => {
  const entries = [
    entry('specs', '2026-02-02-middle_doc.md'),
    entry('specs', '2026-03-04-newest-doc.md'),
    entry('specs', '2025/2026-01-05-nested-doc.md'),
    entry('specs', '2026-05-05-new-draft.md', { committed: null, draft: draftOf('untracked') }),
    entry('plans', '2026-01-01-only-plan.md'),
  ];
  const tree = treeOk({ entries, drafts: holder() });
  const refPage: DocsPageLocation = { kind: 'project', project: 'demo', ref: { kind: 'bare', name: 'main' } };

  it('project page: each section lists its docs with title, date label and draft badge, newest first', () => {
    render(<DocsTreeView tree={tree} page={refPage} />);
    const lists = [...document.querySelectorAll('.docs-project > .docs-rows > li')] as HTMLElement[];
    const specsLi = lists.find((li) => li.querySelector(':scope > button')?.textContent?.includes('specs')) as HTMLElement;
    const links = [...specsLi.querySelectorAll('ul a')] as HTMLAnchorElement[];
    expect(links.map((a) => a.firstElementChild?.textContent)).toEqual([
      'new draft', 'newest doc', 'middle doc', 'nested doc',
    ]);
    expect(links.map((a) => a.querySelector('.docs-row-note')?.textContent)).toEqual([
      '2026-05-05', '2026-03-04', '2026-02-02', '2026-01-05',
    ]);
    expect(links[0]).toHaveTextContent('draft · new');
    expect(links[1]).not.toHaveTextContent('draft');
    expect(links[0]!.getAttribute('href')).toBe('/docs/demo/specs/2026-05-05-new-draft.md?ref=main');
    expect(links[3]!.getAttribute('href')).toBe('/docs/demo/specs/2025/2026-01-05-nested-doc.md?ref=main');
    // The raw name kept in the details is the section-relative path (two nested docs can share a leaf name).
    expect(links[3]!.getAttribute('title')).toBe('2025/2026-01-05-nested-doc.md');
    // The nested list is distinct from the section rows and named for its section.
    expect(within(specsLi).getByRole('list', { name: 'specs' })).toBeInTheDocument();
    const plansLi = lists.find((li) => li.querySelector(':scope > button')?.textContent?.includes('plans')) as HTMLElement;
    expect(within(plansLi).getByText('only plan')).toBeInTheDocument();
    // No link inside a button.
    expect(document.querySelectorAll('button a')).toHaveLength(0);
  });

  it('project page: a default-view page leaves a draft-only file out', () => {
    render(<DocsTreeView tree={tree} page={{ kind: 'project', project: 'demo', ref: null }} />);
    expect(screen.queryByText('new draft')).toBeNull();
    expect(screen.getByText('newest doc')).toBeInTheDocument();
  });

  it('section page: a file row shows its title and date, keeps the raw name in its details, and the filter matches both', () => {
    const page: DocsPageLocation = { kind: 'section', project: 'demo', section: 'specs', ref: null };
    render(<DocsTreeView tree={tree} page={page} />);
    const row = screen.getByText('newest doc').closest('button') as HTMLElement;
    expect(row).toHaveAttribute('title', '2026-03-04-newest-doc.md');
    expect(row).toHaveTextContent('2026-03-04');
    const filter = screen.getByRole('searchbox');
    fireEvent.change(filter, { target: { value: 'middle doc' } });
    expect(screen.queryByText('newest doc')).toBeNull();
    expect(screen.getByText('middle doc')).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: '2026-03-04-newest' } });
    expect(screen.getByText('newest doc')).toBeInTheDocument();
    expect(screen.queryByText('middle doc')).toBeNull();
  });
});

describe('the index', () => {
  const NAMES = ['2026-05-01-e.md', '2026-04-01-d.md', '2026-03-01-c.md', '2026-02-01-b.md', '2026-01-01-a_doc.md'];
  const ready = (over: Partial<DocsIndexRow> = {}): DocsIndexRow => ({
    project: 'demo', state: 'ready', github: { state: 'none' }, default: { name: 'main', via: 'default:origin-head', commit: COMMIT_B },
    sections: { specs: 8, plans: 0, 'product-design': 1, conventions: 2 }, ...over,
  });
  const answer = (row: DocsIndexRow, extra: Partial<DocsIndexOk> = {}): DocsProjectsResponse => ({
    ok: true, cacheAgeMs: 1,
    index: { v: 1, verb: 'docs-index', ok: true, elapsedMs: 5, unlisted: 0, duplicates: [], projects: [row], ...extra },
  });

  it('index: at most five newest per section', () => {
    expect(DOCS_INDEX_NEWEST_PER_SECTION).toBe(5);
    const row = ready({ newest: { specs: NAMES, 'product-design': ['x/2026-06-06-design_note.md'], plans: ['ignored.md'] } });
    render(<DocsIndexView answer={answer(row)} />);
    const lists = screen.getAllByRole('list', { name: /^demo: / });
    expect(lists).toHaveLength(2);
    const links = lists.flatMap((list) => within(list).getAllByRole('link'));
    expect(links.map((a) => a.firstElementChild?.textContent)).toEqual(
      ['e', 'd', 'c', 'b', 'a doc', '3 more', 'design note']);
    expect(links[0]!.getAttribute('href')).toBe('/docs/demo/specs/2026-05-01-e.md');
    // plans holds count 0: its names are never shown.
    expect(screen.queryByText('ignored')).toBeNull();
    // The "N more" link's name says the section and the project; its visible words stay "3 more".
    const more = screen.getByRole('link', { name: '3 more specs in demo' });
    expect(more).toHaveTextContent('3 more');
    expect(more.getAttribute('href')).toBe('/docs/demo/specs');
    // the design section's one name: it is the whole section, so no more link
    expect(screen.getAllByRole('link', { name: /^\d+ more / })).toHaveLength(1);
    // No region landmark per section group; each list is named by project and section.
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(screen.getByRole('list', { name: 'demo: specs' })).toBeInTheDocument();
    expect(screen.getByText('specs', { exact: true })).toBeVisible();
    // The raw name in the details is the section-relative path.
    expect(links[6]!.getAttribute('title')).toBe('x/2026-06-06-design_note.md');
    expect(document.querySelectorAll('button a')).toHaveLength(0);
    expect(screen.queryByText(/left out/)).toBeNull();
  });

  it('indexNewest: the one reader keeps order, caps at five, and never goes negative', () => {
    expect(indexNewest(ready())).toEqual([]);
    expect(indexNewest(ready({ newest: { specs: [...NAMES, '2025-01-01-six.md'], conventions: ['b.md', 'a.md', 'c.md'] } })))
      .toEqual([
        { slug: 'specs', names: NAMES, more: 3 },
        { slug: 'conventions', names: ['b.md', 'a.md', 'c.md'], more: 0 },
      ]);
  });

  it('indexNewest: a malformed field never crashes the read', () => {
    const odd = ready({
      newest: { specs: 'not-an-array', plans: [1, null], conventions: ['ok.md', 7, null, 'b.md'] } as unknown as DocsIndexRow['newest'],
      sections: { specs: 2, plans: 2, conventions: 5 },
    });
    expect(indexNewest(odd)).toEqual([{ slug: 'conventions', names: ['ok.md', 'b.md'], more: 3 }]);
    render(<DocsIndexView answer={answer(odd)} />);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('index: an answer without newest renders', () => {
    render(<DocsIndexView answer={answer(ready())} />);
    const b = screen.getByText('demo', { selector: '.docs-row-name' }).closest('button') as HTMLElement;
    expect(b).toHaveTextContent('8 specs · 0 plans · 1 design · 2 conventions');
    expect(document.querySelectorAll('.docs-index li ul')).toHaveLength(0);
    expect(screen.queryByText(/left out/)).toBeNull();
  });

  it('index: newestTruncated shows one note', () => {
    render(<DocsIndexView answer={answer(ready({ newest: { specs: NAMES } }), { newestTruncated: true })} />);
    expect(screen.getAllByText(/left out to keep this index small/)).toHaveLength(1);
  });
});
