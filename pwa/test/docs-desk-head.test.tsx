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
function atWidth(width: number, pointer: { readonly coarse?: boolean } = {}): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const matches = q === '(pointer: coarse)' ? pointer.coarse === true
      : (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1])) && (min !== null || max !== null);
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
    ref: { ...base.ref, requested: 'lane-a', served: 'refs/heads/lane-a', name: 'lane-a', side: 'local', via: 'local', relation: 'local-ahead', counterpart: { ref: 'refs/remotes/origin/lane-a', commit: COMMIT_B, ahead: 2, behind: 0, count: 'measured' } },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

// The row's stage probe (`useRowStage`, review 1704 F7 and F9; Task C16, D-8139). jsdom lays nothing out, so a probe
// is counted by its one read of the crumbs' box (`rowFits` reads it once and, finding no box, keeps stage 0), and the
// observers and the font set are stood in for.
describe("the row's stage probe (review 1704 F7, F9)", () => {
  type Resized = (entries: { readonly contentRect: { readonly width: number } }[]) => void;
  let resized: Resized | null = null;
  class FakeResizeObserver {
    constructor(cb: Resized) { resized = cb; }
    observe(): void {}
    disconnect(): void {}
  }
  /** Probes so far: reads of the crumbs' box. */
  function countProbes(): () => number {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    return () => spy.mock.contexts.filter((el) => (el as Element).classList.contains('docs-crumbs')).length;
  }
  async function settled(): Promise<void> {
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.export })).toBeEnabled());
    await new Promise((r) => setTimeout(r, 0));
  }

  it('a row that changes width by less than a pixel is probed again: the guard reads contentRect, not clientWidth (F9)', async () => {
    atWidth(1280);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const probes = countProbes();
    open('/docs/demo/specs/a.md', fakeLoaders());
    await settled();
    resized!([{ contentRect: { width: 900.25 } }]);
    const before = probes();
    resized!([{ contentRect: { width: 900.75 } }]);
    expect(probes(), 'a 0.5 px change probes').toBe(before + 1);
    resized!([{ contentRect: { width: 900.75 } }]);
    expect(probes(), 'no change, no probe').toBe(before + 1);
  });

  it('a font face that finishes loading while another still loads re-probes the row (F7)', async () => {
    atWidth(1280);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    let loaded!: () => void;
    const face = { status: 'loading', loaded: new Promise<void>((r) => { loaded = r; }) };
    let onLoading: ((e: { fontfaces: readonly unknown[] }) => void) | null = null;
    let late!: () => void;
    const lateFace = { status: 'loading', loaded: new Promise<void>((r) => { late = r; }) };
    const fonts = {
      forEach: (f: (x: unknown) => void) => { f(face); },
      addEventListener: (type: string, fn: never) => { if (type === 'loading') onLoading = fn; },
      removeEventListener: () => {},
    };
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
    try {
      const probes = countProbes();
      open('/docs/demo/specs/a.md', fakeLoaders());
      await settled();
      const before = probes();
      loaded();
      await waitFor(() => expect(probes(), 'the face loaded at mount').toBe(before + 1));
      onLoading!({ fontfaces: [lateFace] });
      late();
      await waitFor(() => expect(probes(), 'a face that starts loading later').toBe(before + 2));
    } finally {
      Reflect.deleteProperty(document, 'fonts');
    }
  });
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

  it('while the leaf moves to its pin, Share is named Share: <words> and Export: <words>, as their icon forms are (F4)', async () => {
    atWidth(1280);
    const f = fakeLoaders();
    f.file.mockImplementation(() => new Promise(() => {}));
    open('/docs/demo/specs/a.md', f);
    const updating = fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(treeOk().ref.commit) });
    const share = await within(await waitFor(() => row())).findByRole('button', { name: fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: updating }) });
    expect(share).toBeDisabled();
    expect(shownText(share)).toBe(updating);
    expect(labelInName(shownText(share), share.getAttribute('aria-label') ?? '')).toBe(true);
    expect(within(row()).queryByRole('button', { name: updating }), 'never the bare sentence').toBeNull();
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

  // Review 1697 F5 (Task C16, D-8139): a touch user has no hover, so a `title` never shows; under a coarse pointer the
  // note draws its words, as the head did before the marker, and the link is still described by them.
  it.each([
    ['a local ref ahead of origin', '/docs/demo/specs/a.md?ref=lane-a', aheadTree()],
    ['a modified draft', '/docs/demo/specs/a.md?ref=main', DRAFT_TREE],
  ])("on %s under a coarse pointer, GitHub's may-differ note shows its words, not a bare marker (review 1697 F5)", async (_what, url, tree) => {
    atWidth(1280, { coarse: true });
    open(url, fakeLoaders({ tree: okTree(tree) }));
    const gh = await within(await waitFor(() => row())).findByRole('link', { name: DOCS_HEAD_TEXT.github });
    const note = await waitFor(() => {
      const n = row().querySelector<HTMLElement>('.docs-action-note');
      if (n === null) throw new Error('no note');
      return n;
    });
    expect(shownText(note), 'its words are drawn').toBe(DOCS_HEAD_TEXT.githubMayDiffer);
    expect(note.textContent, 'no marker').not.toContain('≠');
    expect(gh.getAttribute('aria-describedby')).toBe(note.id);
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
    expect(via).not.toBeNull();
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

  it('every crumb that can shorten carries its whole name in its title, the page\'s own included (F5)', async () => {
    atWidth(1280);
    const tree = treeOk({ entries: [entry('specs', 'd/x.md')] });
    open('/docs/demo/specs/d/x.md', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    const crumbs = [...row().querySelectorAll<HTMLElement>('.docs-crumb, .docs-crumb-here')];
    expect(crumbs.map((c) => c.textContent)).toEqual(['Docs', 'demo', 'specs', 'd', 'x.md']);
    expect(crumbs.map((c) => c.getAttribute('title'))).toEqual(crumbs.map((c) => c.textContent));
  });

  it('GitHub\'s refusal in the row carries its whole words in its title, since the row may cut it (F5)', async () => {
    atWidth(1280);
    const tree = { ...treeOk(), github: { state: 'named' as const, slug: 'not a slug' } };
    open('/docs/demo/specs/a.md', fakeLoaders({ tree: okTree(tree) }));
    const off = await waitFor(() => {
      const el = row().querySelector<HTMLElement>('.docs-actions > .docs-action-off');
      if (el === null) throw new Error('no refusal');
      return el;
    });
    expect(off.textContent).toMatch(/^View on GitHub: /);
    expect(off.getAttribute('title')).toBe(off.textContent);
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

// Fix round 2 (D-8101): the order in which the row gives way. jsdom lays nothing out, so a fake ResizeObserver reports the
// row once and the page's crumb reads as cut or whole by the stage the row stands at; the pixels are the browser file's.
describe('the desk row gives way in order: the words, then the middle crumbs (fix round 2)', () => {
  const DEEP = treeOk({ entries: [entry('specs', 'd/e/x.md')] });

  /** A ResizeObserver that reports its element once, a microtask after `observe`, as an engine reports a first size. */
  class OnceObserver {
    private readonly cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(): void { queueMicrotask(() => this.cb([], this as unknown as ResizeObserver)); }
    unobserve(): void {}
    disconnect(): void {}
  }

  /** Lays the row out so that the page's name is whole only when `whole(wordsOff, folded)` says so. */
  function layOut(whole: (wordsOff: boolean, folded: boolean) => boolean): void {
    vi.stubGlobal('ResizeObserver', OnceObserver);
    const rowOf = (e: Element): Element | null => e.closest('.docs-head-bar');
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      const r = rowOf(this);
      if (!this.classList.contains('docs-crumb-here') || r === null) return 0;
      return whole(r.getAttribute('data-words') === 'off', r.querySelector('.docs-crumbs-more') !== null) ? 40 : 120;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('docs-crumb-here') ? 60 : 900;
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 10, 44));
  }

  it('the crumbs tell docs.css how many are drawn, the `…` button counted: every crumb at a desk, three folded', async () => {
    atWidth(1280);
    open('/docs/demo/specs/d/e/x.md', fakeLoaders({ tree: okTree(DEEP) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    const nav = (): HTMLElement => row().querySelector<HTMLElement>('.docs-crumbs')!;
    expect(nav().style.getPropertyValue('--docs-crumbs-n')).toBe('6');
    cleanup();
    atWidth(768);
    open('/docs/demo/specs/d/e/x.md', fakeLoaders({ tree: okTree(DEEP) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(row().querySelector('.docs-crumbs-more')).not.toBeNull();
    expect(nav().style.getPropertyValue('--docs-crumbs-n')).toBe('3');
  });

  it('a row that is never measured (no ResizeObserver) keeps the words and every crumb', async () => {
    atWidth(1280);
    vi.stubGlobal('ResizeObserver', undefined);
    open('/docs/demo/specs/d/e/x.md', fakeLoaders({ tree: okTree(DEEP) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(row().getAttribute('data-words')).toBeNull();
    expect(row().querySelector('.docs-crumbs-more')).toBeNull();
  });

  it('a name cut by a fraction of a pixel is not whole: its text is measured against its box, past the integer widths', async () => {
    atWidth(1280);
    layOut(() => true);
    // The integer widths agree (whole), but with the words shown the text runs half a pixel past its box, which still
    // draws the ellipsis; with them hidden it fits.
    const rangeRect = vi.fn(function (this: Range) {
      const row = (this.startContainer as Element).closest?.('.docs-head-bar');
      return new DOMRect(0, 0, row?.getAttribute('data-words') === 'off' ? 10 : 10.5, 20);
    });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: rangeRect });
    try {
      open('/docs/demo/specs/d/e/x.md', fakeLoaders({ tree: okTree(DEEP) }));
      await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
      await waitFor(() => expect(row().getAttribute('data-words')).toBe('off'));
      expect(row().querySelector('.docs-crumbs-more')).toBeNull();
      expect(rangeRect).toHaveBeenCalled();
    } finally {
      delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });

  it.each([
    ['the name is whole with the words', () => true, null, false],
    ['the name is whole only as icons: the words hide first, every crumb still drawn', (off: boolean) => off, 'off', false],
    ['the name is whole only with the crumbs folded: the words hide, then the middle crumbs fold', (off: boolean, folded: boolean) => off && folded, 'off', true],
    ['the name is never whole: the words hide and the crumbs fold, and the rest is the stylesheet\'s', () => false, 'off', true],
  ] as const)('%s', async (_what, whole, words, folded) => {
    atWidth(1280);
    layOut(whole);
    open('/docs/demo/specs/d/e/x.md', fakeLoaders({ tree: okTree(DEEP) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    await waitFor(() => expect(row().getAttribute('data-words')).toBe(words));
    await waitFor(() => expect(row().querySelector('.docs-crumbs-more') !== null).toBe(folded));
    // Whatever the stage, each action keeps its name.
    expect(within(row()).getByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeInTheDocument();
    expect(within(row()).getByRole('link', { name: DOCS_HEAD_TEXT.github })).toBeInTheDocument();
  });
});
