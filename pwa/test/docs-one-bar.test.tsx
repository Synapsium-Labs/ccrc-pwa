// The one bar in the Docs header (the library 1.1 take-up plan, Task 6; refinements (f), (h), (j), (k), (l)). A leaf whose
// reader frame is ready on ccrc's bar draws back, the title and the reader's tools in one row, with the reading line along
// its bottom edge; the title opens the details panel that holds the crumbs, the truth line and the full header's actions.
// jsdom lays nothing out, so this file holds the markup: which head, the names and their order, the tap's own command,
// the panel's states and keyboard, the freshness words, the line's inline size, and what withdraws the bar. The
// stylesheet is docs-compact-css.test.ts's and the pixels are the browser file's. Every case injects the reader's
// `render`, `mount` and `images`; none reaches a worker. `atWidth` is the compact head test's form.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DocsScreen } from '../src/screens/DocsScreen';
import { DocsHead } from '../src/docs/DocsHead';
import type { ReaderDeps } from '../src/docs/ReaderFrame';
import type { ReaderMount, ReaderMountInput } from '../src/docs/reader/bridge';
import { createReaderProgress, type ReaderBar } from '../src/docs/readerBar';
import { DOCS_HEAD_TEXT, DOCS_TOOL_TEXT, ENTRY_BADGE_TEXT, shortCommit } from '../src/docs/docsText';
import type { DocsLoaders } from '../src/docs/failures';
import type { DocsVisit } from '../src/docs/useDocsVisit';
import { entryView } from '../../shared/docs';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import { COMMIT_B, draftOf, entry, fakeLoaders, holder, okTree, pageAt, treeOk, treeResponse, type FakeLoaders } from './docsFixtures';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

const RENDERED: ReaderRenderOutcome = {
  kind: 'rendered',
  result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'Doc title', frontList: null, headings: [], figures: 0, mermaidKinds: [] } },
  mermaid: { fences: 0, largestBytes: 0, totalBytes: 0, largestChars: 0, totalChars: 0 },
  images: [],
  imagesTruncated: false,
};

interface Rig {
  readonly reader: ReaderDeps;
  readonly inputs: ReaderMountInput[];
  readonly command: ReturnType<typeof vi.fn>;
}

/** A reader whose render answers a titled document and whose mount records its input and returns a live handle. */
function rig(): Rig {
  const inputs: ReaderMountInput[] = [];
  const command = vi.fn();
  const handle = { destroy: vi.fn(), setPrefs: vi.fn(), command };
  const reader: ReaderDeps = {
    render: vi.fn(async () => RENDERED),
    mount: vi.fn(async (_el, input) => {
      inputs.push(input);
      return handle as unknown as ReaderMount;
    }),
    images: vi.fn(async () => ({ urls: {}, drafts: 0 })),
  };
  return { reader, inputs, command };
}

function Routed(p: { readonly loaders: DocsLoaders; readonly reader: ReaderDeps | null }): ReactNode {
  const { path: at, search } = useLocation();
  return <DocsScreen path={at} search={search} loaders={p.loaders} parser={parser} reader={p.reader} />;
}

/** Opens a leaf at `width`, waits for the mount and reports ready (the frame's own `onReady`). */
async function openReady(url: string, width = 412, f: FakeLoaders = fakeLoaders()): Promise<Rig> {
  atWidth(width);
  const r = rig();
  navigate(url);
  render(<Routed loaders={f.loaders} reader={r.reader} />);
  await waitFor(() => expect(r.inputs.length).toBe(1));
  act(() => r.inputs[0]!.onReady());
  return r;
}

const oneBar = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.docs-head.docs-one-bar');
  if (el === null) throw new Error('no one bar');
  return el;
};
const titleButton = (): HTMLElement => {
  const el = oneBar().querySelector<HTMLElement>('.docs-title');
  if (el === null) throw new Error('no title');
  return el;
};
const panelOf = (): HTMLElement => {
  const el = document.getElementById(titleButton().getAttribute('aria-controls') ?? '');
  if (el === null) throw new Error('the title controls no element');
  return el;
};
const nameOf = (b: Element): string => b.getAttribute('aria-label') ?? b.textContent ?? '';
const barButtons = (): readonly HTMLElement[] =>
  within(oneBar().querySelector<HTMLElement>('.docs-compact-bar')!).getAllByRole('button');

describe('the one bar (refinements (f), (j), (k), (l))', () => {
  it('a ready frame on ccrc\'s bar turns the row into the one bar: back, the title, Quick jump, Contents', async () => {
    await openReady('/docs/demo/specs/a.md');
    const names = barButtons().map(nameOf);
    expect(names).toHaveLength(4);
    expect(names[0]).toBe(DOCS_HEAD_TEXT.back);
    expect(names[1]!.startsWith('specs')).toBe(true);
    expect(names[1]).toContain('Doc title');
    expect(names.slice(2)).toEqual([DOCS_TOOL_TEXT.jump, DOCS_TOOL_TEXT.contents]);
    for (const name of [DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.export]) {
      expect(within(oneBar().querySelector<HTMLElement>('.docs-compact-bar')!).queryByRole('button', { name })).toBeNull();
    }
    expect(within(oneBar().querySelector<HTMLElement>('.docs-compact-bar')!).queryByRole('button', { name: /^Page details/ })).toBeNull();
  });

  it('a plan\'s leaf adds Outline after Contents', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('plans', 'p.md')] })) });
    await openReady('/docs/demo/plans/p.md', 412, f);
    expect(barButtons().map(nameOf).slice(2)).toEqual([DOCS_TOOL_TEXT.jump, DOCS_TOOL_TEXT.contents, DOCS_TOOL_TEXT.outline]);
  });

  it('each tool runs its command in the tap itself', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('plans', 'p.md')] })) });
    const r = await openReady('/docs/demo/plans/p.md', 412, f);
    const bar = oneBar();
    fireEvent.click(within(bar).getByRole('button', { name: DOCS_TOOL_TEXT.jump }));
    expect(r.command).toHaveBeenCalledTimes(1);
    expect(r.command).toHaveBeenLastCalledWith('jump');
    fireEvent.click(within(bar).getByRole('button', { name: DOCS_TOOL_TEXT.contents }));
    expect(r.command).toHaveBeenCalledTimes(2);
    expect(r.command).toHaveBeenLastCalledWith('contents');
    fireEvent.click(within(bar).getByRole('button', { name: DOCS_TOOL_TEXT.outline }));
    expect(r.command).toHaveBeenCalledTimes(3);
    expect(r.command).toHaveBeenLastCalledWith('outline');
  });

  it('the title opens the details panel: the crumbs, the truth line and the full header\'s actions, in §4.5\'s order', async () => {
    await openReady('/docs/demo/specs/a.md');
    const title = titleButton();
    expect(title).toHaveAttribute('aria-expanded', 'false');
    expect(panelOf()).toHaveAttribute('hidden');
    fireEvent.click(title);
    expect(title).toHaveAttribute('aria-expanded', 'true');
    const panel = panelOf();
    expect(panel).not.toHaveAttribute('hidden');
    expect(panel.querySelector('nav')).not.toBeNull();
    expect(panel.querySelector('.docs-truth')).not.toBeNull();
    const actions = panel.querySelector('.docs-actions');
    expect(actions).not.toBeNull();
    const names = [...actions!.querySelectorAll('.docs-action')].map(nameOf);
    expect(names.slice(0, 3)).toEqual([DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.exportPlainView]);
    fireEvent.click(title);
    expect(title).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape from inside the panel, or on the title, closes it with focus on the title', async () => {
    await openReady('/docs/demo/specs/a.md');
    const title = titleButton();
    fireEvent.click(title);
    const inside = panelOf().querySelector<HTMLElement>('a, button');
    expect(inside).not.toBeNull();
    inside!.focus();
    fireEvent.keyDown(inside!, { key: 'Escape' });
    expect(title).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(title);
    fireEvent.click(title);
    expect(title).toHaveAttribute('aria-expanded', 'true');
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(title, { key: 'Escape' });
    expect(title).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(title);
  });

  it('the title\'s name carries the freshness words', async () => {
    await openReady('/docs/demo/specs/a.md');
    expect(nameOf(titleButton()).endsWith(DOCS_HEAD_TEXT.moreNever)).toBe(true);
    expect(titleButton().querySelector('.docs-title-dot')).toHaveAttribute('aria-hidden', 'true');
  });

  it('the reading line shows the share the frame reports', async () => {
    const r = await openReady('/docs/demo/specs/a.md');
    const line = oneBar().querySelector<HTMLElement>('.docs-read');
    expect(line).not.toBeNull();
    expect(line).toHaveAttribute('aria-hidden', 'true');
    act(() => r.inputs[0]!.onProgress!(0.5));
    expect(line!.style.inlineSize).toBe('50%');
    act(() => r.inputs[0]!.onProgress!(1));
    expect(line!.style.inlineSize).toBe('100%');
  });

  it('a fallback withdraws the one bar: the row comes back, with Page details', async () => {
    const r = await openReady('/docs/demo/specs/a.md');
    expect(oneBar()).not.toBeNull();
    act(() => r.inputs[0]!.onFallback('error'));
    await waitFor(() => expect(document.querySelector('.docs-one-bar')).toBeNull());
    expect(screen.getByRole('button', { name: /^Page details/ })).toBeInTheDocument();
  });

  it('Updated to stays under the bar, outside the panel', () => {
    atWidth(412);
    const tree = treeOk({ entries: [entry('specs', 'a.md')] });
    const visit: DocsVisit = {
      tree: { s: 'ok', answer: treeResponse(tree), receivedAt: Date.now() },
      file: { s: 'loading', pin: { kind: 'committed', commit: COMMIT_B, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'a.md' } }, freshness: { s: 'idle' }, updatedTo: COMMIT_B, pendingFragment: null,
      retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
    };
    const bar: ReaderBar = { title: 'Doc title', command: vi.fn(), progress: createReaderProgress() };
    render(<DocsHead page={pageAt('/docs/demo/specs/a.md')} visit={visit} tree={tree} readerBar={bar} />);
    const updated = oneBar().querySelector('.docs-updated');
    expect(updated).not.toBeNull();
    expect(updated!.textContent).toContain(shortCommit(COMMIT_B));
    expect(panelOf().contains(updated)).toBe(false);
  });

  it('the where line keeps a served ref and a draft badge above the title', () => {
    atWidth(412);
    const e = entry('specs', 'a.md', { draft: draftOf('modified') });
    const tree = treeOk({ entries: [e], drafts: holder() });
    const visit: DocsVisit = {
      tree: { s: 'ok', answer: treeResponse(tree), receivedAt: Date.now() },
      file: { s: 'loading', pin: { kind: 'committed', commit: COMMIT_B, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'a.md' } }, freshness: { s: 'idle' }, updatedTo: null, pendingFragment: null,
      retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
    };
    const bar: ReaderBar = { title: 'Doc title', command: vi.fn(), progress: createReaderProgress() };
    render(<DocsHead page={pageAt('/docs/demo/specs/a.md?ref=main')} visit={visit} tree={tree} readerBar={bar} />);
    const badge = entryView(e, tree.drafts, 'ref').badge;
    expect(badge, 'the fixture opens a badged draft').not.toBeNull();
    expect(document.querySelector('.docs-one-bar .docs-title .docs-compact-where .docs-badge')?.textContent).toBe(ENTRY_BADGE_TEXT[badge!]);
  });

  it('before ready, and at a wide width with no frame on ccrc\'s bar, the head is as before', async () => {
    atWidth(412);
    const r = rig();
    navigate('/docs/demo/specs/a.md');
    const { unmount } = render(<Routed loaders={fakeLoaders().loaders} reader={r.reader} />);
    await waitFor(() => expect(r.inputs.length).toBe(1));
    expect(document.querySelector('.docs-one-bar')).toBeNull();
    expect(document.querySelector('.docs-head.docs-compact')).not.toBeNull();
    expect(r.inputs[0]!.chrome).toBe('host-bar');
    unmount();
    cleanup();
    const wide = await openReady('/docs/demo/specs/a.md', 1280);
    expect(wide.inputs[0]!.chrome).toBe('frame-bar');
    expect(document.querySelector('.docs-one-bar')).toBeNull();
    expect(document.querySelector('.docs-head.docs-full')).not.toBeNull();
  });

  it('choosing the plain view withdraws the one bar: option 1\'s row comes back, with the plain-view note under it', async () => {
    await openReady('/docs/demo/specs/a.md');
    fireEvent.click(titleButton());
    fireEvent.click(within(panelOf()).getByRole('button', { name: DOCS_HEAD_TEXT.exportPlainView }));
    const shown = await screen.findByText(DOCS_HEAD_TEXT.exportPlainShown);
    await waitFor(() => expect(document.querySelector('.docs-reader')).toBeNull());
    expect(document.querySelector('.docs-one-bar')).toBeNull();
    expect(document.querySelector('.docs-head.docs-compact')).not.toBeNull();
    const more = screen.getByRole('button', { name: /^Page details/ });
    const panel = document.getElementById(more.getAttribute('aria-controls') ?? '');
    expect(panel?.contains(shown)).toBe(false);
  });

  it.each([[412, 'compact'], [1280, 'full']] as const)(
    'a bar handle without a usable tree at %s uses the %s head',
    (width, head) => {
      atWidth(width);
      const tree = treeOk({ entries: [entry('specs', 'a.md')] });
      const visit: DocsVisit = {
        tree: { s: 'ok', answer: treeResponse(tree), receivedAt: Date.now() },
        file: { s: 'loading', pin: { kind: 'committed', commit: COMMIT_B, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'a.md' } }, freshness: { s: 'idle' }, updatedTo: null, pendingFragment: null,
        retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
      };
      const bar: ReaderBar = { title: 'Doc title', command: vi.fn(), progress: createReaderProgress() };
      render(<DocsHead page={pageAt('/docs/demo/specs/a.md')} visit={visit} tree={null} readerBar={bar} />);
      expect(document.querySelector('.docs-one-bar')).toBeNull();
      expect(document.querySelectorAll(`.docs-head.docs-${head}`)).toHaveLength(1);
      expect(document.querySelectorAll('.docs-head')).toHaveLength(1);
    },
  );
});
