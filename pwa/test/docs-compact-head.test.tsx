// The Docs reader's compact head (the phone-header plan of 2026-11-03, Task 4). Under DOCS_COMPACT_QUERY a leaf page
// draws one row (back, where and what, Share and Export as icons, Page details) and keeps the crumbs, the truth line and
// the link actions in a panel Page details opens; a tablet, a desktop and every listing keep the full header. jsdom lays
// nothing out, so this file holds the markup: which header, the names and their order, the panel's states, keyboard,
// the words the row keeps for the page's truth, and where the notes go. The stylesheet is docs-compact-css.test.ts's and
// the pixels are browser/docs-compact-head.browser.test.ts's. `atWidth` answers a width query as a real engine would
// (refined-phone.test.tsx#atWidth's form); setup.ts's default answers false to every query, which is the full header.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { entryView, type DocPin } from '../../shared/docs';
import { DocsScreen } from '../src/screens/DocsScreen';
import { DOCS_COMPACT_QUERY, DocsHead, freshDot, headLayoutFor } from '../src/docs/DocsHead';
import type { ReaderDeps } from '../src/docs/ReaderFrame';
import { DOCS_BANNER_TEXT, DOCS_HEAD_TEXT, ENTRY_BADGE_TEXT, EXPORT_WAIT_TEXT, fillSentence, servedRefText, shortCommit } from '../src/docs/docsText';
import type { DocsFileAnswer, DocsLoaders, DocsTreeAnswer } from '../src/docs/failures';
import { HighlighterContext } from '../src/lib/highlighterContext';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import type { DocsVisit } from '../src/docs/useDocsVisit';
import { navigate, useLocation } from '../src/lib/router';
import {
  COMMIT_A, FP_1, draftOf, entry, fakeLoaders, fileResponse, holder, okFile, okTree, pageAt, treeOk, treeResponse, type FakeLoaders,
} from './docsFixtures';
import { inThreadContext, inThreadHighlighter } from './highlightTestStore';

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

/** Parses in this thread, as the worker would. */
const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

/** A parse that never answers: a Markdown leaf stays on "Formatting…" and publishes no body. */
const heldParser: MarkdownParser = () => new Promise<never>(() => {});

/** The screen under the live location, as the app's `docs` arm mounts it (one mount across navigations). */
function Routed(p: { readonly loaders: DocsLoaders; readonly reader: ReaderDeps | null; readonly parser?: MarkdownParser }): ReactNode {
  const { path: at, search } = useLocation();
  return <DocsScreen path={at} search={search} loaders={p.loaders} parser={p.parser ?? parser} reader={p.reader} />;
}

function open(url: string, f: FakeLoaders, reader: ReaderDeps | null = null, withParser?: MarkdownParser): ReturnType<typeof render> {
  navigate(url);
  return render(<Routed loaders={f.loaders} reader={reader} parser={withParser} />);
}

/** "Export: <words>", the name a waiting Export carries and the panel's line for it. */
const exportBusy = (words: string): string => fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: words });

const more = (): HTMLElement => screen.getByRole('button', { name: /^Page details/ });
const panel = (): HTMLElement => {
  const el = document.getElementById(more().getAttribute('aria-controls') ?? '');
  if (el === null) throw new Error('Page details controls no element');
  return el;
};
const bar = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.docs-compact-bar');
  if (el === null) throw new Error('no compact row');
  return el;
};
/** A reader whose render never answers: the frame's arm stays up, so the leaf shows the reader (Export's plain view). */
const heldReader = (): ReaderDeps =>
  ({ render: vi.fn(() => new Promise<never>(() => {})), mount: vi.fn(), images: vi.fn() }) as unknown as ReaderDeps;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('which header a page draws (refinements (a), (b))', () => {
  it.each([
    [true, '/docs/demo/specs/a.md', 'compact'],
    [true, '/docs/demo/specs/d/x.md?ref=main', 'compact'],
    [true, '/docs/demo/specs/d/', 'full'],
    [true, '/docs/demo/specs', 'full'],
    [true, '/docs/demo', 'full'],
    [true, '/docs', 'full'],
    [false, '/docs/demo/specs/a.md', 'full'],
  ] as const)('compact width %s, %s: %s', (compactWidth, url, want) => {
    expect(headLayoutFor(compactWidth, pageAt(url))).toBe(want);
  });

  it('the compact width is under 600 CSS px, and only DocsHead.tsx spells it under pwa/src', () => {
    expect(DOCS_COMPACT_QUERY).toBe('(max-width: 599.98px)');
    const src = path.join(import.meta.dirname, '..', 'src');
    const spelled = readdirSync(src, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(tsx?|css)$/.test(d.name))
      .map((d) => path.join(d.parentPath, d.name))
      .filter((f) => readFileSync(f, 'utf8').includes('599.98'))
      .map((f) => path.relative(src, f).split(path.sep).join('/'));
    expect(spelled).toEqual(['docs/DocsHead.tsx']);
  });

  it.each([
    [390, true], [599, true], [600, false], [768, false], [1280, false],
  ] as const)('at %ipx a leaf draws the compact row: %s; the full header keeps its line of actions', async (width, compact) => {
    atWidth(width);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.export })).toBeEnabled());
    expect(document.querySelector('.docs-head.docs-compact') !== null).toBe(compact);
    // The full header's truth line is on the page at once; the row's is behind Page details.
    expect(screen.queryByRole('button', { name: DOCS_HEAD_TEXT.copyCommit }) !== null).toBe(!compact);
    if (!compact) {
      // Each action's NAME: the full head's row shows "GitHub" and names the link View on GitHub (desk-nav Part B).
      expect([...document.querySelectorAll('.docs-actions .docs-action')].map((e) => e.getAttribute('aria-label') ?? e.textContent))
        .toEqual([DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.export]);
    }
  });

  it.each(['/docs/demo/specs', '/docs/demo', '/docs/demo/specs/d/'])('%s at 390px keeps the full header', async (url) => {
    atWidth(390);
    open(url, fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'd/x.md')] })) }));
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.copyCommit })).toBeInTheDocument();
    expect(document.querySelector('.docs-compact')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Page details/ })).toBeNull();
  });
});

describe('the compact row (refinements (c), (e), (g))', () => {
  it('reads back, Share, Export and Page details, in that order, each named; Share and Export draw an icon and no word', async () => {
    atWidth(412);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.export })).toBeEnabled());
    expect(within(bar()).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual([DOCS_HEAD_TEXT.back, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.export, DOCS_HEAD_TEXT.moreNever]);
    expect(bar().querySelector('.docs-compact-where')?.textContent).toBe('specs');
    expect(bar().querySelector('.docs-compact-name')?.textContent).toBe('a.md');
    for (const name of [DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.export]) {
      const b = within(bar()).getByRole('button', { name });
      expect(b.querySelector('svg[aria-hidden="true"]'), name).not.toBeNull();
      expect(b.textContent, name).toBe('');
    }
  });

  it.each(['loading', 'unreachable'] as const)('while the tree slot is %s, the head is back and the crumbs (spec 4.7: a tree failure keeps the crumbs)', async (slot) => {
    atWidth(412);
    const f = fakeLoaders();
    if (slot === 'loading') f.tree.mockImplementation(() => new Promise<DocsTreeAnswer>(() => {}));
    else f.tree.mockResolvedValue({ s: 'unreachable' });
    open('/docs/demo/specs/d/x.md', f);
    await waitFor(() => expect(document.querySelector('.docs-compact .docs-compact-crumbs')).not.toBeNull());
    const head = document.querySelector('.docs-compact-crumbs') as HTMLElement;
    expect(within(head).getByRole('button', { name: DOCS_HEAD_TEXT.back })).toHaveClass('docs-back');
    expect(within(head).getByRole('link', { name: 'd' })).toHaveClass('docs-crumb');
    expect(within(head).getByRole('button', { name: DOCS_HEAD_TEXT.crumbsMore })).toHaveClass('docs-crumbs-more');
    expect(head.querySelector('[aria-current="page"]')?.textContent).toBe('x.md');
    expect(document.querySelector('.docs-compact-label')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Page details/ })).toBeNull();
  });

  it('a ref view names its served ref on the row, and a draft leaf its badge, in the truth line\'s words (refinement (g))', async () => {
    atWidth(412);
    const e = entry('specs', 'a.md', { draft: draftOf('modified') });
    const tree = treeOk({ entries: [e], drafts: holder() });
    open('/docs/demo/specs/a.md?ref=main', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    const badge = entryView(e, tree.drafts, 'ref').badge;
    expect(badge, 'the fixture opens a badged draft').not.toBeNull();
    const where = bar().querySelector('.docs-compact-where') as HTMLElement;
    expect(where.textContent).toBe(`specs · ${servedRefText(tree.ref)} · ${ENTRY_BADGE_TEXT[badge!]}`);
    // The ref is in the text that ends in an ellipsis; the badge is its sibling, so a long ref is cut and the badge never is.
    expect([...where.children].map((c) => c.className)).toEqual(['docs-compact-where-text', 'docs-badge']);
    expect(where.querySelector('.docs-compact-where-text')?.textContent).toBe(`specs · ${servedRefText(tree.ref)}`);
    expect(where.querySelector('.docs-badge')?.textContent).toBe(ENTRY_BADGE_TEXT[badge!]);
    cleanup();
    open('/docs/demo/specs/a.md', fakeLoaders());
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(bar().querySelector('.docs-compact-where')?.textContent, 'the default view on origin/HEAD adds nothing').toBe('specs');
  });

  it('a ref view of a nested leaf draws the parent directory and the ref as two spans, the ref with its separator (refinement (g))', async () => {
    atWidth(412);
    const tree = treeOk({ entries: [entry('specs', 'd/x.md')] });
    open('/docs/demo/specs/d/x.md?ref=main', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    const where = bar().querySelector('.docs-compact-where') as HTMLElement;
    expect(where.textContent).toBe(`d · ${servedRefText(tree.ref)}`);
    expect([...where.children].map((c) => c.className)).toEqual(['docs-compact-where-text']);
    const text = where.querySelector('.docs-compact-where-text') as HTMLElement;
    // Each is cut at its own end (docs.css), so a long directory never takes the whole line from the ref.
    expect([...text.children].map((c) => [c.className, c.textContent])).toEqual([
      ['docs-compact-where-crumb', 'd'],
      ['docs-compact-where-ref', ` · ${servedRefText(tree.ref)}`],
    ]);
    cleanup();
    open('/docs/demo/specs/d/x.md', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect([...bar().querySelectorAll('.docs-compact-where-text > *')].map((c) => c.className), 'no ref, no ref span')
      .toEqual(['docs-compact-where-crumb']);
  });

  it('on view=committed of a draft leaf the row keeps its ref and draft badge and says nothing of the view; the banner under it does (refinement (g), (h))', async () => {
    atWidth(412);
    const e = entry('specs', 'a.md', { draft: draftOf('modified') });
    const tree = treeOk({ entries: [e], drafts: holder() });
    open('/docs/demo/specs/a.md?ref=main&view=committed', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    const badge = entryView(e, tree.drafts, 'ref').badge;
    expect(badge, 'the fixture opens a badged draft').not.toBeNull();
    // The row is the draft view's row, byte for byte; the view is told by the banner in the flow, not by the row.
    expect(bar().querySelector('.docs-compact-where')?.textContent).toBe(`specs · ${servedRefText(tree.ref)} · ${ENTRY_BADGE_TEXT[badge!]}`);
    const banner = await screen.findByText(fillSentence(DOCS_BANNER_TEXT.viewCommitted, { short: shortCommit(tree.ref.commit) }));
    expect(bar().contains(banner) || panel().contains(banner), 'the banner is outside the row and its panel').toBe(false);
    expect(within(banner.closest('.docs-screen') as HTMLElement).getByRole('link', { name: DOCS_BANNER_TEXT.backToDraft })).toBeInTheDocument();
  });

  it('a default view served from anywhere but origin/HEAD names its served ref on the row (refinement (g))', async () => {
    atWidth(412);
    const base = treeOk();
    const tree = { ...base, ref: { ...base.ref, served: 'refs/heads/main', side: 'local' as const, via: 'default:local-main' as const } };
    open('/docs/demo/specs/a.md', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(servedRefText(tree.ref)).toBe('main (local)');
    expect(bar().querySelector('.docs-compact-where')?.textContent).toBe('specs · main (local)');
  });

  it('a draft the tree no longer lists draws the truth line\'s word on the row, as plain text, never as a badge (refinement (g))', () => {
    atWidth(412);
    // The pin outlived a re-list: the leaf's file slot holds a draft pin, and the tree's entry no longer carries a draft, so
    // entryView gives the leaf no badge and the truth line draws its plain word.
    const tree = treeOk({ entries: [entry('specs', 'a.md')], drafts: holder() });
    const pin: DocPin = { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: 'a.md', fp: FP_1 };
    const visit: DocsVisit = {
      tree: { s: 'ok', answer: treeResponse(tree), receivedAt: Date.now() },
      file: { s: 'loading', pin }, freshness: { s: 'idle' }, updatedTo: null, pendingFragment: null,
      retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
    };
    render(<DocsHead page={pageAt('/docs/demo/specs/a.md?ref=main')} visit={visit} tree={tree} />);
    const word = DOCS_HEAD_TEXT.sourceDraftUnbadged;
    const where = bar().querySelector('.docs-compact-where') as HTMLElement;
    expect(where.textContent, 'the row ends in the truth line\'s word').toBe(`specs · ${servedRefText(tree.ref)} · ${word}`);
    expect(where.querySelector('.docs-badge'), 'the row draws it as text, as the truth line does').toBeNull();
    const source = panel().querySelector('.docs-truth-source') as HTMLElement;
    expect(source.textContent?.startsWith(word), 'the truth line starts with the same word').toBe(true);
    expect(source.querySelector('.docs-badge'), 'the truth line draws no badge for it').toBeNull();
  });

  it.each(['default:origin-main', 'default:origin-master'] as const)(
    'an origin-side default view that is %s names its served ref on the row (refinement (g))',
    async (via) => {
      atWidth(412);
      const base = treeOk();
      const tree = { ...base, ref: { ...base.ref, side: 'origin' as const, via } };
      open('/docs/demo/specs/a.md', fakeLoaders({ tree: okTree(tree) }));
      await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
      expect(servedRefText(tree.ref)).toContain(tree.ref.name);
      expect(bar().querySelector('.docs-compact-where')?.textContent).toBe(`specs · ${servedRefText(tree.ref)}`);
    },
  );

  it('while the leaf moves to its pin, Share and Export are disabled and named for it, and the panel says why (refinement (e))', async () => {
    atWidth(412);
    const f = fakeLoaders();
    f.file.mockImplementation(() => new Promise<DocsFileAnswer>(() => {}));
    open('/docs/demo/specs/a.md', f);
    const updating = fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(COMMIT_A) });
    // Nothing visible says Share on the icon, so its waiting name says so, as Export's does.
    const shareBusy = fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: updating });
    expect(await screen.findByRole('button', { name: shareBusy })).toBeDisabled();
    expect(screen.queryByRole('button', { name: updating }), 'never the bare sentence').toBeNull();
    expect(screen.getByRole('button', { name: exportBusy(updating) })).toBeDisabled();
    fireEvent.click(more());
    expect(within(panel()).getByText(shareBusy)).toBeInTheDocument();
    expect(within(panel()).getByText(exportBusy(updating))).toBeInTheDocument();
  });

  // §4.17's "When it is offered" words a leaf can produce today, each the icon's name and the panel's line (refinement
  // (e)). "Updating to <short>…" is the case above; "Render the mockup first" needs W6's mockups, where Export is absent.
  it.each([
    ['Formatting…, a parse still running', EXPORT_WAIT_TEXT.formatting],
    ['Choose Format or Show as text first, a document over the render gate', EXPORT_WAIT_TEXT.gate],
    ['Image not loaded, a raster leaf whose image failed', EXPORT_WAIT_TEXT['image-failed']],
    ['Highlighting…, a text leaf whose colouring is held', EXPORT_WAIT_TEXT.highlighting],
  ] as const)('%s: the Export icon is named for it and the panel says it', async (_why, words) => {
    atWidth(412);
    if (words === EXPORT_WAIT_TEXT.formatting) {
      open('/docs/demo/specs/a.md', fakeLoaders(), null, heldParser);
    } else if (words === EXPORT_WAIT_TEXT.gate) {
      open('/docs/demo/specs/a.md', fakeLoaders({ file: okFile('# Big\n\n' + 'x'.repeat(DOCS_RENDER_GATE_BYTES)) }));
    } else if (words === EXPORT_WAIT_TEXT['image-failed']) {
      open('/docs/demo/specs/x.png', fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'x.png')] })) }));
    } else {
      const text = 'const a: number = 1;';
      const r = fileResponse(text);
      const f = fakeLoaders({
        tree: okTree(treeOk({ entries: [entry('specs', 'x.ts')] })),
        file: { s: 'ok', value: { ...r, contentClass: 'text', show: { ...r.show, path: 'x.ts', size: text.length } } },
      });
      navigate('/docs/demo/specs/x.ts');
      render(<HighlighterContext value={inThreadContext(inThreadHighlighter({ hold: true }))}><Routed loaders={f.loaders} reader={null} /></HighlighterContext>);
    }
    expect(await screen.findByRole('button', { name: exportBusy(words) })).toBeDisabled();
    fireEvent.click(more());
    expect(within(panel()).getByText(exportBusy(words))).toBeInTheDocument();
  });

  it('while the reader formats, the live DOM is the chain docs.css lays "Formatting…" over the host by (refinement (i))', async () => {
    atWidth(412);
    const { container } = open('/docs/demo/specs/a.md', fakeLoaders(), heldReader());
    await waitFor(() => expect(container.querySelector('.doc-formatting')).not.toBeNull());
    // docs.css: `.docs-screen:has(> .docs-compact) > .docs-leaf:has(> .docs-reader) > .doc-formatting`.
    const formatting = container.querySelector('.doc-formatting') as HTMLElement;
    const leaf = formatting.parentElement as HTMLElement;
    expect(leaf.classList.contains('docs-leaf')).toBe(true);
    expect([...leaf.children].some((c) => c.classList.contains('docs-reader'))).toBe(true);
    const screenEl = leaf.parentElement as HTMLElement;
    expect(screenEl.classList.contains('docs-screen')).toBe(true);
    expect([...screenEl.children].some((c) => c.matches('header.docs-head.docs-compact'))).toBe(true);
  });

  it('on a leaf the reader shows, the Export icon is named Export (plain view); its tap turns the reader off and says so under the row', async () => {
    atWidth(412);
    const { container } = open('/docs/demo/specs/a.md', fakeLoaders(), heldReader());
    const plain = await screen.findByRole('button', { name: DOCS_HEAD_TEXT.exportPlainView });
    expect(plain).toHaveClass('docs-export');
    expect(container.querySelector('.docs-reader')).not.toBeNull();
    fireEvent.click(more());
    expect(within(panel()).getByText(DOCS_HEAD_TEXT.exportPlainHint)).toBeInTheDocument();
    fireEvent.click(plain);
    const shown = await screen.findByText(DOCS_HEAD_TEXT.exportPlainShown);
    expect(panel().contains(shown), 'the note is under the row, not in the panel').toBe(false);
    await waitFor(() => expect(container.querySelector('.docs-reader')).toBeNull());
    expect(container.querySelector('.docs-head.docs-compact'), 'the plain view keeps the row').not.toBeNull();
  });
});

describe('Page details (refinements (c), (d), (f))', () => {
  it('opens the panel: the whole path with no … button, the truth line, View on GitHub; a second tap closes it', async () => {
    atWidth(412);
    open('/docs/demo/specs/d/x.md', fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'd/x.md')] })) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).not.toBeVisible();
    expect(screen.queryByRole('link', { name: DOCS_HEAD_TEXT.github }), 'behind the tap').toBeNull();
    fireEvent.click(more());
    expect(more()).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).toBeVisible();
    const region = screen.getByRole('region', { name: DOCS_HEAD_TEXT.more });
    expect(region).toBe(panel());
    expect(within(region).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Docs', 'demo', 'specs', 'd', 'x.md']);
    expect(within(region).queryByRole('button', { name: DOCS_HEAD_TEXT.crumbsMore })).toBeNull();
    expect(within(region).getByRole('button', { name: DOCS_HEAD_TEXT.copyCommit })).toHaveClass('docs-copy');
    expect(region.querySelector('.docs-truth-ref')?.getAttribute('title')).toBe(treeOk().ref.served);
    expect(region.querySelector('.docs-truth-commit')?.getAttribute('title')).toBe(COMMIT_A);
    expect(within(region).getByRole('link', { name: DOCS_HEAD_TEXT.github })).toHaveClass('docs-action');
    fireEvent.click(more());
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).not.toBeVisible();
  });

  it('Escape in the open panel closes it and puts focus back on Page details (refinement (d))', async () => {
    atWidth(412);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    fireEvent.click(more());
    const copy = within(panel()).getByRole('button', { name: DOCS_HEAD_TEXT.copyCommit });
    copy.focus();
    fireEvent.keyDown(copy, { key: 'Escape' });
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(more());
    // And on the button itself, where focus sits after a tap on it.
    fireEvent.click(more());
    more().focus();
    fireEvent.keyDown(more(), { key: 'Escape' });
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(more());
  });

  it('a new page closes the panel: the head is keyed by the page', async () => {
    atWidth(412);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    fireEvent.click(more());
    expect(more()).toHaveAttribute('aria-expanded', 'true');
    act(() => { navigate('/docs/demo/specs/b.md'); });
    await waitFor(() => expect(bar().querySelector('.docs-compact-name')?.textContent).toBe('b.md'));
    expect(more()).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([
    ['ok', 'ok'], ['never', 'warn'], ['failed', 'failed'], ['none', null], ['local', null], ['fetching', null], ['soon', null],
  ] as const)('the chip state %s draws the dot %s', (state, dot) => {
    expect(freshDot(state)).toBe(dot);
  });

  it('a page whose last fetch failed names it: Page details (freshness problem), with the failed dot (refinement (f))', async () => {
    atWidth(412);
    const base = treeOk();
    const tree = {
      ...base,
      freshness: {
        ...base.freshness,
        stamp: { okAgeMs: 179 * 60_000, attemptAgeMs: 5 * 60_000, lastOutcome: 'fetch-transport', okCommit: COMMIT_A },
      },
    } as const;
    open('/docs/demo/specs/a.md', fakeLoaders({ tree: okTree(tree) }));
    const b = await screen.findByRole('button', { name: DOCS_HEAD_TEXT.moreFailed });
    expect(b.querySelector('.docs-more-dot')).toHaveAttribute('data-tone', 'failed');
    expect(screen.queryByRole('button', { name: DOCS_HEAD_TEXT.moreNever }), 'failed is not never fetched').toBeNull();
  });

  it('a page never fetched draws the amber dot and says so in the name; the dot itself is hidden from a screen reader', async () => {
    atWidth(412);
    open('/docs/demo/specs/a.md', fakeLoaders());
    const b = await screen.findByRole('button', { name: DOCS_HEAD_TEXT.moreNever });
    const dot = b.querySelector('.docs-more-dot');
    expect(dot).toHaveAttribute('data-tone', 'warn');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });
});
