// The desk Docs head (desk-nav plan 2026-11-07, Task B; D-8101). At 600 px and wider a page draws one row (back, the
// crumbs, then the actions, inside `.docs-head-bar`) over one dense truth line, then the plain-view note and "Updated to"
// as before. The actions show an icon and their words: GitHub's visible word is "GitHub" and its name stays "View on
// GitHub"; Share's and Export's words and names are as before. jsdom lays nothing out, so this file holds the markup and
// the names; the stylesheet is docs-desk-css.test.ts's and the pixels are browser/docs-compact-head.browser.test.ts's.
// `atWidth` answers a width query as a real engine would (docs-compact-head.test.tsx#atWidth's form).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { DocsScreen } from '../src/screens/DocsScreen';
import { DocsHead, fullHeadFormFor, headLayoutFor } from '../src/docs/DocsHead';
import { DOCS_HEAD_TEXT, fillSentence, shortCommit } from '../src/docs/docsText';
import type { DocsLoaders } from '../src/docs/failures';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import type { DocsVisit } from '../src/docs/useDocsVisit';
import { COMMIT_B, draftOf, entry, fakeLoaders, holder, okTree, pageAt, treeOk, treeResponse, type FakeLoaders } from './docsFixtures';
import { labelInName, shownText } from './labelInName';

/** matchMedia at `width`: a min-width or max-width query answered as an engine at that width answers it. */
function atWidth(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const matches = (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1]))
      && (min !== null || max !== null);
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

function Routed(p: { readonly loaders: DocsLoaders }): ReactNode {
  const { path: at, search } = useLocation();
  return <DocsScreen path={at} search={search} loaders={p.loaders} parser={parser} />;
}

function open(url: string, f: FakeLoaders): ReturnType<typeof render> {
  navigate(url);
  return render(<Routed loaders={f.loaders} />);
}

const head = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('header.docs-head');
  if (el === null) throw new Error('no Docs head');
  return el;
};
const row = (): HTMLElement => {
  const el = head().querySelector<HTMLElement>(':scope > .docs-head-bar');
  if (el === null) throw new Error('no head row');
  return el;
};

/** The class each of the row's children carries, in DOM order. */
const rowOrder = (): string[] => [...row().children].map((c) => c.className.split(' ')[0] ?? '');

/** A ref view of a leaf with a modified draft in the main checkout: it opens the draft and offers the committed version. */
const DRAFT_TREE = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });

/** A committed leaf served from a local branch two commits ahead of origin: GitHub's copy may differ, and nothing else
 *  in the row changes (fix round 1, F1's note-only state). */
function aheadTree(): ReturnType<typeof treeOk> {
  const base = treeOk();
  return {
    ...base,
    ref: { ...base.ref, requested: 'lane-a', served: 'refs/heads/lane-a', name: 'lane-a', side: 'local', via: 'local', relation: 'local-ahead', counterpart: { ahead: 2, behind: 0 } },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('which head a desk page draws (desk-nav Part B)', () => {
  it('a leaf draws the compact row under 600 px and the full head at 600 and wider; headLayoutFor keeps its two arguments', () => {
    const leaf = pageAt('/docs/demo/specs/a.md');
    expect(headLayoutFor(true, leaf)).toBe('compact');
    expect(headLayoutFor(false, leaf)).toBe('full');
    expect(headLayoutFor.length).toBe(2);
  });

  it('at 412 the compact head is drawn, unchanged: no full row', async () => {
    atWidth(412);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(document.querySelector('.docs-head.docs-compact')).not.toBeNull();
    expect(document.querySelector('.docs-head-bar')).toBeNull();
  });
});

describe('the desk head is one row and one dense line (desk-nav Part B)', () => {
  it("a leaf's head is one row: back, the crumbs, then the actions, inside .docs-head-bar", async () => {
    atWidth(1280);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.export })).toBeEnabled());
    expect(rowOrder()).toEqual(['docs-back', 'docs-crumbs', 'docs-actions']);
    const actions = row().querySelector('.docs-actions') as HTMLElement;
    expect(within(actions).getByRole('link', { name: DOCS_HEAD_TEXT.github })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: DOCS_HEAD_TEXT.export })).toBeInTheDocument();
    expect(head().querySelectorAll('.docs-actions'), 'one actions group, in the row').toHaveLength(1);
  });

  it("the truth line is the row's next sibling", async () => {
    atWidth(1280);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(row().nextElementSibling).toHaveClass('docs-truth');
    expect(head().querySelector(':scope > .docs-truth'), 'the truth line is the head\'s own child').not.toBeNull();
  });

  it('the plain-view note and "Updated to" follow it, as before', () => {
    atWidth(1280);
    const tree = treeOk();
    const visit: DocsVisit = {
      tree: { s: 'ok', answer: treeResponse(tree), receivedAt: Date.now() },
      file: { s: 'none' }, freshness: { s: 'idle' }, updatedTo: COMMIT_B, pendingFragment: null,
      retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
    };
    render(<DocsHead page={pageAt('/docs/demo/specs/a.md')} visit={visit} tree={tree} plainView />);
    const kids = [...head().children].map((c) => c.className);
    expect(kids).toEqual(['docs-head-bar', 'docs-truth', 'docs-note', 'docs-updated']);
    expect(head().querySelector('.docs-note')?.textContent).toBe(DOCS_HEAD_TEXT.exportPlainShown);
    expect(head().querySelector('.docs-updated')?.textContent)
      .toBe(fillSentence(DOCS_HEAD_TEXT.updatedTo, { short: shortCommit(COMMIT_B) }));
  });

  it('GitHub shows "GitHub" and is named "View on GitHub" (label in name, D-7897)', async () => {
    atWidth(1280);
    open('/docs/demo/specs/a.md', fakeLoaders());
    const gh = await within(await waitFor(() => row())).findByRole('link', { name: DOCS_HEAD_TEXT.github });
    expect(gh.getAttribute('aria-label')).toBe(DOCS_HEAD_TEXT.github);
    expect(gh.querySelector('.docs-action-words')?.textContent).toBe(DOCS_HEAD_TEXT.githubShort);
    expect(DOCS_HEAD_TEXT.githubShort).toBe('GitHub');
    expect(shownText(gh)).toBe('GitHub');
    expect(labelInName(shownText(gh), gh.getAttribute('aria-label') ?? '')).toBe(true);
    expect(gh.querySelector('svg[aria-hidden="true"]'), 'its icon').not.toBeNull();
  });

  it('Share and Export keep their words and names; each draws an icon beside its words', async () => {
    atWidth(1280);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.export })).toBeEnabled());
    for (const name of [DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.export]) {
      const b = within(row()).getByRole('button', { name });
      expect(b.querySelector('.docs-action-words')?.textContent, name).toBe(name);
      expect(shownText(b), name).toBe(name);
      expect(labelInName(shownText(b), b.getAttribute('aria-label') ?? ''), name).toBe(true);
      expect(b.querySelector('svg[aria-hidden="true"]'), name).not.toBeNull();
    }
  });

  it('while the leaf moves to its pin, Share and Export keep the names they had: the words, and Export: <words>', async () => {
    atWidth(1280);
    const f = fakeLoaders();
    f.file.mockImplementation(() => new Promise(() => {}));
    open('/docs/demo/specs/a.md', f);
    const updating = fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(treeOk().ref.commit) });
    const share = await within(await waitFor(() => row())).findByRole('button', { name: updating });
    expect(share).toBeDisabled();
    expect(shownText(share)).toBe(updating);
    const exp = within(row()).getByRole('button', { name: fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: updating }) });
    expect(exp).toBeDisabled();
    expect(labelInName(shownText(exp), exp.getAttribute('aria-label') ?? '')).toBe(true);
  });

  it('Open committed version, when offered, sits in the row: an icon beside its words, named as before (F1)', async () => {
    atWidth(1280);
    open('/docs/demo/specs/a.md?ref=main', fakeLoaders({ tree: okTree(DRAFT_TREE) }));
    const link = await within(await waitFor(() => row())).findByRole('link', { name: DOCS_HEAD_TEXT.openCommitted });
    expect(link.closest('.docs-actions')?.parentElement).toBe(row());
    expect(shownText(link)).toBe(DOCS_HEAD_TEXT.openCommitted);
    expect(link.getAttribute('aria-label')).toBe(DOCS_HEAD_TEXT.openCommitted);
    expect(link.querySelector('.docs-action-words')?.textContent, 'its words hide under the container query').toBe(DOCS_HEAD_TEXT.openCommitted);
    expect(link.querySelector('svg[aria-hidden="true"]'), 'its icon').not.toBeNull();
  });

  it.each([
    ['a local ref ahead of origin', '/docs/demo/specs/a.md?ref=lane-a', aheadTree()],
    ['a modified draft', '/docs/demo/specs/a.md?ref=main', DRAFT_TREE],
  ])("on %s, GitHub's may-differ note is a marker: its words in its title and the link's description, read by a screen reader (F1)", async (_what, url, tree) => {
    atWidth(1280);
    open(url, fakeLoaders({ tree: okTree(tree) }));
    const gh = await within(await waitFor(() => row())).findByRole('link', { name: DOCS_HEAD_TEXT.github });
    const note = await waitFor(() => {
      const n = row().querySelector<HTMLElement>('.docs-action-note');
      if (n === null) throw new Error('no note');
      return n;
    });
    expect(note.getAttribute('title')).toBe(DOCS_HEAD_TEXT.githubMayDiffer);
    expect(note.querySelector('.sr-only')?.textContent, 'its words, for a screen reader').toBe(DOCS_HEAD_TEXT.githubMayDiffer);
    expect(shownText(note), 'only the marker is drawn').toBe('≠');
    expect(note.querySelector('[aria-hidden="true"]')?.textContent).toBe('≠');
    const described = gh.getAttribute('aria-describedby');
    expect(described).toBe(note.id);
    expect(document.getElementById(described ?? '')).toBe(note);
  });

  it.each([
    ['a project', '/docs/demo'],
    ['a section', '/docs/demo/specs'],
    ['a directory', '/docs/demo/specs/d/'],
  ])('%s draws the same row, its truth line under it', async (_what, url) => {
    atWidth(1280);
    open(url, fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'd/x.md')] })) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.copyCommit });
    expect(rowOrder()).toEqual(['docs-back', 'docs-crumbs', 'docs-actions']);
    expect(row().nextElementSibling).toHaveClass('docs-truth');
  });

  it('the index draws the row with back and the crumbs, and no truth line', async () => {
    atWidth(1280);
    const f = fakeLoaders();
    f.projects.mockImplementation(async () => ({ s: 'unreachable' }));
    open('/docs', f);
    await waitFor(() => expect(rowOrder()).toEqual(['docs-back', 'docs-crumbs']));
    expect(head().querySelector('.docs-truth')).toBeNull();
  });

  it('the via sentence, the one part of the line that may be cut, carries its whole words in its title (F2)', async () => {
    atWidth(1280);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    const via = head().querySelector<HTMLElement>(':scope > .docs-truth .docs-truth-via');
    expect(via?.textContent).not.toBe('');
    expect(via?.getAttribute('title')).toBe(via?.textContent);
  });

  it.each([
    ['a project', '/docs/demo'],
    ['a section', '/docs/demo/specs'],
    ['a directory', '/docs/demo/specs/d/'],
  ])('below 600 px %s draws the head as main draws it: the crumbs row, the truth line, then the actions in words (F2(b))', async (_what, url) => {
    atWidth(412);
    open(url, fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'd/x.md')] })) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.copyCommit });
    expect(document.querySelector('.docs-full'), 'no desk head below 600 px').toBeNull();
    expect([...head().children].map((c) => c.className)).toEqual(['docs-head-bar', 'docs-truth', 'docs-actions']);
    expect([...row().children].map((c) => c.className.split(' ')[0])).toEqual(['docs-back', 'docs-crumbs']);
    const gh = within(head()).getByRole('link', { name: DOCS_HEAD_TEXT.github });
    expect(gh.textContent, 'main\'s words').toBe(DOCS_HEAD_TEXT.github);
    expect(gh.getAttribute('aria-label')).toBeNull();
    expect(head().querySelector('.docs-action-words')).toBeNull();
  });

  it('fullHeadFormFor: the row at 600 px and wider, main\'s stacked head below it (F2(b))', () => {
    expect(fullHeadFormFor(false)).toBe('row');
    expect(fullHeadFormFor(true)).toBe('stacked');
  });

  it('every fact the truth line says, it still says: the ref, the commit, copy commit, how the ref was chosen and the chip', async () => {
    atWidth(1280);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    const truth = head().querySelector(':scope > .docs-truth') as HTMLElement;
    for (const part of ['.docs-truth-ref', '.docs-truth-commit', '.docs-copy', '.docs-truth-via', '.docs-truth-source', '.docs-fresh']) {
      expect(truth.querySelector(part), part).not.toBeNull();
    }
  });
});
