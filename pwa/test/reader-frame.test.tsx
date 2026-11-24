// Docs W8a Task 8: ReaderFrame, the two sheets and the leaf wiring (the rich-docs spec's (amended 2026-10-31) section 4.1,
// section 4.6, M8.7, M8.11, M8.17, M8.19 and the W8a plan's refinement (g)). Every case injects `render`, `mount`, `images` and the
// `parser`; none reaches a worker, the library's host or a server. The router's `navigate` and `replaceFragment` and
// the clipboard writer are module mocks, so a case can see what the frame asked of them. Every address is a
// placeholder (`demo`, `https://a.example`), and control characters are built with `String.fromCharCode`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DOC_SECTION_SLUGS, type DocsShowOk } from '../../shared/docs';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import {
  DOC_FORMATTING, DOC_MARKDOWN_ACTION, docGateSentence, docsPlainNote,
} from '../src/docs/DocMarkdown';
import { ReaderFrame, lazyMountReader, type ReaderDeps } from '../src/docs/ReaderFrame';
import type { ReaderMount, ReaderMountInput } from '../src/docs/reader/bridge';
import type { ReaderChrome, ReaderLink } from '../src/docs/reader/policy';
import { ReaderBarContext, type ReaderBar } from '../src/docs/readerBar';
import { leafName } from '../src/docs/docsTree';
import { READER_FALLBACK_NOTE, READER_SHEET_TEXT } from '../src/docs/reader/readerText';
import { READER_COPY_SHEET_MARKERS_MAX } from '../src/lib/readerLimits';
import { createFetchQueue } from '../src/docs/fetchQueue';
import { copyText } from '../src/docs/share';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import { docsRunner, type MarkdownParser } from '../src/lib/markdownRunner';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { navigate, replaceFragment } from '../src/lib/router';
import { DocsScreen } from '../src/screens/DocsScreen';
import { fakeLoaders, fileResponse, okFile, treeOk } from './docsFixtures';

const bridge = vi.hoisted(() => ({ broken: false }));
vi.mock('../src/docs/reader/bridge', async (importOriginal) => {
  if (bridge.broken) throw new Error('the adapter chunk did not load');
  return importOriginal();
});
vi.mock('../src/lib/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/router')>()),
  navigate: vi.fn(),
  replaceFragment: vi.fn(),
}));
/** How many `onAuthRegained` listeners are subscribed now: the real announcer, wrapped only to count (review 2378 F3). */
const authListeners = vi.hoisted(() => ({ live: 0 }));
vi.mock('../src/lib/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/auth')>();
  return {
    ...real,
    onAuthRegained: (fn: () => void): (() => void) => {
      const off = real.onAuthRegained(fn);
      authListeners.live += 1;
      let on = true;
      return () => {
        if (on) {
          on = false;
          authListeners.live -= 1;
        }
        off();
      };
    },
  };
});
/** The theme choice, as a store a case can move: it holds the console's real palette ids (`system`, `phosphor`, `light`, ...). */
const themeChoice = vi.hoisted(() => ({ value: 'light', subs: new Set<() => void>() }));
vi.mock('../src/lib/theme', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/theme')>();
  const { useSyncExternalStore } = await import('react');
  return {
    ...real,
    useThemeChoice: () => useSyncExternalStore(
      (cb) => { themeChoice.subs.add(cb); return () => { themeChoice.subs.delete(cb); }; },
      () => themeChoice.value,
    ),
  };
});
function chooseTheme(value: string): void {
  themeChoice.value = value;
  for (const cb of themeChoice.subs) cb();
}
vi.mock('../src/docs/share', () => ({ copyText: vi.fn(async () => {}) }));

const LINK: Omit<DocLinkContextValue, 'urls'> = {
  project: 'demo', pageRef: null, pageAt: null, view: 'effective', section: DOC_SECTION_SLUGS[0]!, path: 'a.md', tree: treeOk(),
  pageSource: 'committed', onFragment: () => {},
};

const RENDERED: ReaderRenderOutcome = {
  kind: 'rendered',
  result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: null, frontList: null, headings: [], figures: 0, mermaidKinds: [] } },
  mermaid: { fences: 0, largestBytes: 0, totalBytes: 0, largestChars: 0, totalChars: 0 },
  images: [],
  imagesTruncated: false,
};

function showOf(text: string): DocsShowOk {
  return fileResponse(text).show;
}

interface Harness {
  readonly reader: ReaderDeps;
  readonly renderFn: ReturnType<typeof vi.fn<ReaderDeps['render']>>;
  readonly mountFn: ReturnType<typeof vi.fn<ReaderDeps['mount']>>;
  readonly imagesFn: ReturnType<typeof vi.fn<ReaderDeps['images']>>;
  readonly handle: {
    destroy: ReturnType<typeof vi.fn>; setPrefs: ReturnType<typeof vi.fn>; command: ReturnType<typeof vi.fn>;
    openAt: ReturnType<typeof vi.fn>;
  };
  readonly inputs: ReaderMountInput[];
  readonly parser: ReturnType<typeof vi.fn<MarkdownParser>>;
  readonly onDraftAsset: ReturnType<typeof vi.fn<(delta: number) => void>>;
  readonly onFragment: ReturnType<typeof vi.fn<DocLinkContextValue['onFragment']>>;
  readonly consumed: ReturnType<typeof vi.fn<() => void>>;
}

function harness(over: Partial<{
  outcome: ReaderRenderOutcome; mount: ReaderDeps['mount']; drafts: number;
}> = {}): Harness {
  const inputs: ReaderMountInput[] = [];
  const handle = { destroy: vi.fn(), setPrefs: vi.fn(), command: vi.fn(), openAt: vi.fn() };
  const renderFn = vi.fn<ReaderDeps['render']>(async () => over.outcome ?? RENDERED);
  const mountFn = vi.fn<ReaderDeps['mount']>(over.mount ?? (async (_el, input) => {
    inputs.push(input);
    return handle as ReaderMount;
  }));
  const imagesFn = vi.fn<ReaderDeps['images']>(async () => ({ urls: {}, drafts: over.drafts ?? 0, auth: 0 }));
  const parser = vi.fn<MarkdownParser>(async (): Promise<ParseOutcome> => parseMarkdown('# Formatted', 'docs'));
  return {
    reader: { render: renderFn, mount: mountFn, images: imagesFn },
    renderFn, mountFn, imagesFn, handle, inputs, parser,
    onDraftAsset: vi.fn<(delta: number) => void>(),
    onFragment: vi.fn<DocLinkContextValue['onFragment']>(),
    consumed: vi.fn<() => void>(),
  };
}

function frame(h: Harness, over: {
  text?: string; bodyKey?: string; pending?: string | null; show?: DocsShowOk; link?: Partial<Omit<DocLinkContextValue, 'urls'>>;
} = {}): ReactNode {
  const assets: DocsAssetContextValue = {
    loaders: fakeLoaders().loaders, queue: createFetchQueue(), onDraftAsset: h.onDraftAsset,
  };
  return (
    <DocsAssetContext value={assets}>
      <ReaderFrame
        key={over.bodyKey ?? 'k1'}
        show={over.show ?? showOf(over.text ?? '# A')} bodyKey={over.bodyKey ?? 'k1'} link={{ ...LINK, ...over.link, onFragment: h.onFragment }}
        parser={h.parser} reader={h.reader} pendingFragment={over.pending ?? null} onFragmentConsumed={h.consumed}
      />
    </DocsAssetContext>
  );
}

/** The text the open copy sheet shows (the `pre` of its marked text), or '' when there is none. */
function sheetText(): string {
  return document.querySelector('.docs-reader-sheet-text')?.textContent ?? '';
}

/** `frame(h)` under a bar slot that asks for `chrome` and publishes to `publish`. */
function slotted(h: Harness, chrome: ReaderChrome, publish: (bar: ReaderBar | null) => void): ReactNode {
  return <ReaderBarContext value={{ chrome, publish }}>{frame(h)}</ReaderBarContext>;
}

/** matchMedia at `width`, as an engine at that width answers a min-width or max-width query. */
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

/** Lets what is pending settle: the mount's promise resolves and the body's run goes on past it. */
async function settled(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

async function ready(h: Harness): Promise<ReaderMountInput> {
  await waitFor(() => expect(h.inputs.length).toBeGreaterThan(0));
  return h.inputs[h.inputs.length - 1] as ReaderMountInput;
}

beforeEach(() => {
  themeChoice.value = 'light';
  vi.mocked(navigate).mockClear();
  vi.mocked(replaceFragment).mockClear();
  vi.mocked(copyText).mockReset();
  vi.mocked(copyText).mockResolvedValue(undefined);
  bridge.broken = false;
});

afterEach(() => {
  cleanup();
  clearAuthLost();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the triggers that land on the plain view (spec 4.6)', () => {
  it('M8.17: a doc over the render gate never renders or mounts, and shows the gate prompt', async () => {
    const h = harness();
    const text = 'x'.repeat(DOCS_RENDER_GATE_BYTES + 1);
    const { container } = render(frame(h, { text }));
    expect(screen.getByText(docGateSentence(DOCS_RENDER_GATE_BYTES + 1))).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(h.renderFn).not.toHaveBeenCalled();
    expect(h.mountFn).not.toHaveBeenCalled();
    expect(h.parser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: DOC_MARKDOWN_ACTION.formatAnyway }));
    expect(await screen.findByRole('heading', { name: 'Formatted' })).toBeInTheDocument();
    expect(h.parser).toHaveBeenCalledTimes(1);
    expect(h.renderFn).not.toHaveBeenCalled();
    expect(h.mountFn).not.toHaveBeenCalled();
    expect(container.querySelector('.docs-reader')).toBeNull();
  });

  it('a render timeout shows the timeout note with no mount and no parse', async () => {
    const h = harness({ outcome: { kind: 'timeout', budgetMs: 4000 } });
    render(frame(h));
    expect(await screen.findByText(docsPlainNote({ kind: 'timeout', budgetMs: 4000 }))).toBeInTheDocument();
    expect(h.mountFn).not.toHaveBeenCalled();
    expect(h.parser).not.toHaveBeenCalled();
  });

  it.each([
    ['refused', { kind: 'refused', why: 'container-depth', line: 3, value: 99 } as const, 'refused: container-depth at line 3'],
    ['not-rendered (over-limit)', { kind: 'not-rendered', why: 'over-limit' } as const, 'not-rendered: over-limit'],
    ['not-rendered (output-over-limit)', { kind: 'not-rendered', why: 'output-over-limit' } as const, 'not-rendered: output-over-limit'],
    ['not-rendered (failed)', { kind: 'not-rendered', why: 'failed' } as const, 'not-rendered: failed'],
    ['threw', { kind: 'threw', error: 'Boom' } as const, 'threw: Boom'],
    ['worker-failed', { kind: 'worker-failed', error: 'error' } as const, 'worker-failed: error'],
    ['worker-unavailable', { kind: 'worker-unavailable' } as const, 'worker-unavailable'],
  ])('a %s render shows the plain view, mounts nothing, and names the render`s own reason in the console', async (_name, outcome, reason) => {
    const h = harness({ outcome });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(frame(h));
    expect(await screen.findByRole('heading', { name: 'Formatted' })).toBeInTheDocument();
    expect(h.parser).toHaveBeenCalled();
    expect(h.mountFn).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(READER_FALLBACK_NOTE);
    expect(warn.mock.calls.map((c) => String(c[0])), 'the line carries the arm and its own reason')
      .toContain(`ccrc: reader not rendered (${reason})`);
  });

  it('a refused render shows DocMarkdown`s own refusal note', async () => {
    const refused: ParseOutcome = { kind: 'refused', why: 'container-depth', line: 3, value: 99 };
    const h = harness({ outcome: refused });
    h.parser.mockResolvedValue(refused);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(frame(h));
    expect(await screen.findByText(docsPlainNote(refused))).toBeInTheDocument();
    expect(h.mountFn).not.toHaveBeenCalled();
  });

  it('M8.11: onFallback unmounts, shows the fixed note, never shows the reason, and never mounts again', async () => {
    const h = harness();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, rerender } = render(frame(h));
    const input = await ready(h);
    act(() => { input.onFallback('timeout'); });
    expect(await screen.findByText(READER_FALLBACK_NOTE)).toBeInTheDocument();
    expect(h.handle.destroy).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('timeout');
    expect(await screen.findByRole('heading', { name: 'Formatted' })).toBeInTheDocument();
    rerender(frame(h));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(h.renderFn).toHaveBeenCalledTimes(1);
  });

  it('a rejected adapter import falls back with the fixed note', async () => {
    bridge.broken = true;
    const h = harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(frame({ ...h, reader: { ...h.reader, mount: lazyMountReader } }));
    expect(await screen.findByText(READER_FALLBACK_NOTE)).toBeInTheDocument();
    expect(container.textContent).not.toContain('did not load');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('mocking a module'))).toBe(true); // the bridge module's evaluation threw, so its `import()` rejected
    expect(await screen.findByRole('heading', { name: 'Formatted' })).toBeInTheDocument();
  });

  it('a mount that rejects with a RangeError falls back with the fixed note', async () => {
    const h = harness({ mount: async () => { throw new RangeError('x'); } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(frame(h));
    expect(await screen.findByText(READER_FALLBACK_NOTE)).toBeInTheDocument();
    expect(container.textContent).not.toContain('RangeError');
    expect(await screen.findByRole('heading', { name: 'Formatted' })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.mountFn).toHaveBeenCalledTimes(1);
  });

  it('a new body key mounts again', async () => {
    const h = harness();
    const { rerender } = render(frame(h));
    await ready(h);
    rerender(frame(h, { bodyKey: 'k2' }));
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(2));
    expect(h.inputs[0]).not.toBe(h.inputs[1]);
  });
});

describe('what the frame reports (spec 4.1, M8.7, M8.19)', () => {
  it('hands the mount the document, the file name and the fragment, and spends the fragment', async () => {
    const h = harness();
    render(frame(h, { pending: 'part' }));
    const input = await ready(h);
    expect(input.title).toBe('a.md');
    expect(input.document.initialHash).toBe('part');
    expect(input.document.result.html).toBe('<p>x</p>');
    expect(input.prefs).toEqual({ theme: 'light' });
    // The fragment is spent when the frame reports ready, not when the mount resolves (completion plan Task 13).
    await settled();
    expect(h.consumed).not.toHaveBeenCalled();
    act(() => { input.onReady(); });
    expect(h.consumed).toHaveBeenCalledTimes(1);
  });

  it('F1: a percent-encoded fragment is decoded before the frame is seeded; a malformed escape stays raw', async () => {
    const h1 = harness();
    render(frame(h1, { pending: 'caf%C3%A9' }));
    expect((await ready(h1)).document.initialHash).toBe('café');
    cleanup();
    const h2 = harness();
    render(frame(h2, { pending: '%E0%A4%A' }));
    expect((await ready(h2)).document.initialHash).toBe('%E0%A4%A');
  });

  it('refinement (k): a committed doc reaches the mount with its commit and no draft flag, a draft with its head and the flag', async () => {
    const commit = 'a'.repeat(40);
    const head = 'b'.repeat(40);
    const h1 = harness();
    render(frame(h1, { show: { ...showOf('# A'), source: 'committed', commit } }));
    expect((await ready(h1)).version).toEqual({ sha: commit, draft: false, commits: null, only: null });
    cleanup();
    const h2 = harness();
    render(frame(h2, { show: { ...showOf('# A'), source: 'draft', head } }));
    expect((await ready(h2)).version).toEqual({ sha: head, draft: true, commits: null, only: null });
  });

  it('a fallback before the mount lands keeps the fragment for the plain view', async () => {
    const h = harness({ mount: async (_el, input) => {
      input.onFallback('timeout');
      return { destroy: vi.fn(), setPrefs: vi.fn() } as ReaderMount;
    } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(frame(h, { pending: 'part' }));
    expect(await screen.findByText(READER_FALLBACK_NOTE)).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.consumed).not.toHaveBeenCalled();
  });

  it('a mount that resolves and then falls back before ready keeps the fragment for the plain view (completion plan Task 13)', async () => {
    const h = harness();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(frame(h, { pending: 'part' }));
    const input = await ready(h);
    await settled();
    act(() => { input.onFallback('timeout'); });
    expect(await screen.findByText(READER_FALLBACK_NOTE)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Formatted' })).toBeInTheDocument();
    await settled();
    expect(h.consumed).not.toHaveBeenCalled();
  });

  it('a mount that resolves and then reports ready spends the fragment exactly once', async () => {
    const h = harness();
    render(frame(h, { pending: 'part' }));
    const input = await ready(h);
    await settled();
    expect(h.consumed).not.toHaveBeenCalled();
    act(() => { input.onReady(); });
    expect(h.consumed).toHaveBeenCalledTimes(1);
    act(() => { input.onReady(); });
    await settled();
    expect(h.consumed).toHaveBeenCalledTimes(1);
  });

  it('a body with no pending fragment spends nothing at ready', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    await settled();
    act(() => { input.onReady(); });
    await settled();
    expect(h.consumed).not.toHaveBeenCalled();
  });

  it('a ready after the body fell back, or after it ended, spends nothing', async () => {
    const h1 = harness();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(frame(h1, { pending: 'part' }));
    const fellBack = await ready(h1);
    await settled();
    act(() => { fellBack.onFallback('timeout'); });
    await screen.findByText(READER_FALLBACK_NOTE);
    act(() => { fellBack.onReady(); });
    expect(h1.consumed).not.toHaveBeenCalled();
    cleanup();
    const h2 = harness();
    const r2 = render(frame(h2, { pending: 'part' }));
    const ended = await ready(h2);
    await settled();
    r2.unmount();
    act(() => { ended.onReady(); });
    expect(h2.consumed).not.toHaveBeenCalled();
  });

  it('a mount that rejects keeps the fragment for the plain view', async () => {
    const h = harness({ mount: async () => { throw new RangeError('x'); } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(frame(h, { pending: 'part' }));
    expect(await screen.findByText(READER_FALLBACK_NOTE)).toBeInTheDocument();
    expect(h.consumed).not.toHaveBeenCalled();
  });

  it('M8.7: an external link opens the sheet, and window.open runs only on Open, with _blank and noopener,noreferrer', async () => {
    const h = harness();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(frame(h));
    const input = await ready(h);
    const link: ReaderLink = { kind: 'external', url: 'https://a.example/p', scheme: 'https', host: 'a.example' };
    act(() => { input.onLink(link); });
    expect(await screen.findByText(READER_SHEET_TEXT.linkTitle)).toBeInTheDocument();
    expect(screen.getByText('https://a.example/p')).toBeInTheDocument();
    expect(screen.getByText(READER_SHEET_TEXT.linkForeign('a.example'))).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: READER_SHEET_TEXT.linkOpen }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://a.example/p', '_blank', 'noopener,noreferrer');
  });

  it('an external link that is cancelled opens nothing', async () => {
    const h = harness();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(frame(h));
    const input = await ready(h);
    act(() => { input.onLink({ kind: 'external', url: 'https://a.example/p', scheme: 'https', host: 'a.example' }); });
    fireEvent.click(await screen.findByRole('button', { name: READER_SHEET_TEXT.linkCancel }));
    expect(open).not.toHaveBeenCalled();
  });

  it('a doc link routes in-app and hands the fragment to the visit', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    act(() => { input.onLink({ kind: 'relative', path: 'b.md', fragment: 'sec' }); });
    expect(navigate).toHaveBeenCalledTimes(1);
    const href = vi.mocked(navigate).mock.calls[0]?.[0] as string;
    expect(href).toContain('/docs/demo/specs/b.md');
    expect(h.onFragment).toHaveBeenCalledWith('sec', href);
  });

  it("a doc link on a version page keeps the page's at and ref through onLink and routeReaderLink (refinement (o), D-8654)", async () => {
    // Review run 2208's F2: the version context reaches the frame's navigate only through ReaderFrame's link context.
    const at = 'a'.repeat(40);
    const h = harness();
    render(frame(h, { link: { pageRef: { kind: 'bare', name: 'ws/a' }, pageAt: at } }));
    const input = await ready(h);
    act(() => { input.onLink({ kind: 'relative', path: 'b.md', fragment: 'sec' }); });
    expect(navigate).toHaveBeenCalledTimes(1);
    const href = vi.mocked(navigate).mock.calls[0]?.[0] as string;
    expect(href).toBe(`/docs/demo/specs/b.md?ref=ws/a&at=${at}`);
    expect(h.onFragment).toHaveBeenCalledWith('sec', href);
  });

  it('a link the plain view would refuse does nothing', async () => {
    const h = harness();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(frame(h));
    const input = await ready(h);
    act(() => { input.onLink({ kind: 'external', url: 'javascript:void(0)', scheme: 'https', host: 'a.example' }); });
    expect(navigate).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByText(READER_SHEET_TEXT.linkTitle)).toBeNull();
  });

  it('M8.19: a copy with hidden characters shows the sheet with a marker each, and copyText waits for its button', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    const text = `a${String.fromCharCode(27)}b${String.fromCharCode(0x202e)}c`;
    const hidden = [
      { index: 1, codePoint: 27, name: 'ESCAPE' },
      { index: 3, codePoint: 0x202e, name: 'RIGHT-TO-LEFT OVERRIDE' },
    ];
    act(() => { input.copy(text, hidden); });
    expect(await screen.findByText(READER_SHEET_TEXT.copyTitle)).toBeInTheDocument();
    expect(copyText).not.toHaveBeenCalled();
    // §4.4: a sheet shows the text, with each hidden character replaced in place by its visible marker.
    expect(sheetText()).toBe(`a${READER_SHEET_TEXT.copyMarker(hidden[0] as never)}b${READER_SHEET_TEXT.copyMarker(hidden[1] as never)}c`);
    expect(document.body.textContent).not.toContain(String.fromCharCode(0x202e));
    expect(document.body.textContent).not.toContain(String.fromCharCode(27));
    fireEvent.click(screen.getByRole('button', { name: READER_SHEET_TEXT.copyAnyway }));
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith(text);
    await waitFor(() => expect(screen.queryByText(READER_SHEET_TEXT.copyTitle)).toBeNull());
  });

  it('a Copy anyway that the clipboard refuses keeps the sheet open and says so', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    const hidden = [{ index: 1, codePoint: 27, name: 'ESCAPE' }];
    act(() => { input.copy(`a${String.fromCharCode(27)}b`, hidden); });
    vi.mocked(copyText).mockRejectedValueOnce(new Error('denied'));
    expect(screen.queryByText(READER_SHEET_TEXT.copyFailed)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: READER_SHEET_TEXT.copyAnyway }));
    expect(await screen.findByText(READER_SHEET_TEXT.copyFailed)).toBeInTheDocument();
    expect(screen.getByText(READER_SHEET_TEXT.copyTitle)).toBeInTheDocument();
    // The refused state keeps the marked text on the sheet, to copy by hand, and says how.
    expect(sheetText()).toBe(`a${READER_SHEET_TEXT.copyMarker(hidden[0] as never)}b`);
    expect(screen.getByText(READER_SHEET_TEXT.copyByHandMarked), 'and says the text shown holds the markers').toBeInTheDocument();
  });

  it('a copy with more hidden characters than the cap names the first ones, marks the rest without a name, and says how many', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    const total = READER_COPY_SHEET_MARKERS_MAX + 7;
    const zws = String.fromCharCode(0x200b);
    const hidden = Array.from({ length: total }, (_, i) => ({ index: 2 * i + 1, codePoint: 0x200b, name: 'ZERO WIDTH SPACE' }));
    act(() => { input.copy(`x${zws}`.repeat(total), hidden); });
    await screen.findByText(READER_SHEET_TEXT.copyTitle);
    const shown = sheetText();
    expect(shown.split(READER_SHEET_TEXT.copyMarker(hidden[0] as never)).length - 1, 'the named markers stop at the cap').toBe(READER_COPY_SHEET_MARKERS_MAX);
    expect(shown.split(READER_SHEET_TEXT.copyMarkerUnnamed).length - 1, 'the rest are marked, unnamed').toBe(7);
    expect(shown.includes(zws), 'no raw hidden character is left in the sheet').toBe(false);
    expect(screen.getByText(READER_SHEET_TEXT.copyUnnamed(7))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: READER_SHEET_TEXT.copyAnyway }));
    expect(copyText).toHaveBeenCalledWith(`x${zws}`.repeat(total));
  });

  it('clean text calls copyText directly; a rejected write opens the copy-failed sheet', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    act(() => { input.copy('plain words', []); });
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith('plain words');
    expect(screen.queryByText(READER_SHEET_TEXT.copyTitle)).toBeNull();
    vi.mocked(copyText).mockRejectedValueOnce(new Error('denied'));
    act(() => { input.copy('more words', []); });
    expect(await screen.findByText(READER_SHEET_TEXT.copyFailedTitle)).toBeInTheDocument();
    expect(copyText).toHaveBeenCalledTimes(2);
    // Never the hidden-characters sheet; the text is there to select, and the sentence says what happened.
    expect(screen.queryByText(READER_SHEET_TEXT.copyTitle)).toBeNull();
    expect(screen.queryByText(READER_SHEET_TEXT.copyWarning)).toBeNull();
    expect(screen.getByText(READER_SHEET_TEXT.copyFailed)).toBeInTheDocument();
    expect(screen.getByText(READER_SHEET_TEXT.copyByHand)).toBeInTheDocument();
    expect(screen.getByText('more words')).toBeInTheDocument();
  });

  it('Try again on the copy-failed sheet: a second refusal keeps it open, a write closes it', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    vi.mocked(copyText).mockRejectedValueOnce(new Error('denied')).mockRejectedValueOnce(new Error('denied'));
    act(() => { input.copy('more words', []); });
    fireEvent.click(await screen.findByRole('button', { name: READER_SHEET_TEXT.copyTryAgain }));
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(2));
    expect(screen.getByText(READER_SHEET_TEXT.copyFailedTitle)).toBeInTheDocument();
    expect(screen.getByText(READER_SHEET_TEXT.copyFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: READER_SHEET_TEXT.copyTryAgain }));
    await waitFor(() => expect(screen.queryByText(READER_SHEET_TEXT.copyFailedTitle)).toBeNull());
    expect(copyText).toHaveBeenCalledTimes(3);
    expect(copyText).toHaveBeenLastCalledWith('more words');
  });

  it('onHash calls replaceFragment', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    act(() => { input.onHash('part-2'); });
    expect(replaceFragment).toHaveBeenCalledWith('part-2');
  });

  it('a link to this very page spelled with its file name rewrites the address and opens the frame at its anchor, with no new body read', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    await settled();
    act(() => { input.onLink({ kind: 'relative', path: 'a.md', fragment: 'sec' }); });
    expect(h.handle.openAt).toHaveBeenCalledTimes(1);
    expect(h.handle.openAt).toHaveBeenCalledWith('sec');
    expect(replaceFragment).toHaveBeenCalledWith('sec');
    expect(navigate).not.toHaveBeenCalled();
    await settled();
    expect(h.renderFn).toHaveBeenCalledTimes(1);
    expect(h.imagesFn).toHaveBeenCalledTimes(1);
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(h.handle.destroy).not.toHaveBeenCalled();
  });

  it('the anchor reaches openAt decoded, and the address bar keeps the link`s own spelling', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    await settled();
    act(() => { input.onLink({ kind: 'relative', path: 'a.md', fragment: 'caf%C3%A9' }); });
    expect(h.handle.openAt).toHaveBeenCalledWith('café');
    expect(replaceFragment).toHaveBeenCalledWith('caf%C3%A9');
  });

  it('a #fragment link rewrites the address and does not reopen the frame', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    await settled();
    act(() => { input.onLink({ kind: 'fragment', id: 'sec' }); });
    expect(replaceFragment).toHaveBeenCalledWith('sec');
    expect(h.handle.openAt).not.toHaveBeenCalled();
  });

  it('a mount with no openAt takes a same-page link as an address rewrite alone', async () => {
    const h = harness({ mount: async () => ({ destroy: vi.fn(), setPrefs: vi.fn() }) as ReaderMount });
    render(frame(h));
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(1));
    await settled();
    const input = h.mountFn.mock.calls[0]?.[1] as ReaderMountInput;
    act(() => { input.onLink({ kind: 'relative', path: 'a.md', fragment: 'sec' }); });
    expect(replaceFragment).toHaveBeenCalledWith('sec');
    expect(navigate).not.toHaveBeenCalled();
    expect(h.onFragment, 'no frame opens at the anchor, so the visit is handed nothing').not.toHaveBeenCalled();
  });

  it('the visit holds a same-page link\'s anchor until the frame opened at it is ready (review of Task 13, minor 3)', async () => {
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    await settled();
    act(() => { input.onReady(); });
    expect(h.consumed, 'no fragment was handed to the first frame').not.toHaveBeenCalled();
    act(() => { input.onLink({ kind: 'relative', path: 'a.md', fragment: 'sec' }); });
    expect(h.onFragment).toHaveBeenCalledWith('sec', location.pathname + location.search);
    expect(h.consumed).not.toHaveBeenCalled();
    act(() => { input.onReady(); });
    expect(h.consumed, 'the frame opened at the anchor is up: the visit lets it go').toHaveBeenCalledTimes(1);
    act(() => { input.onReady(); });
    expect(h.consumed, 'once').toHaveBeenCalledTimes(1);
  });

  it('a fallback of the frame opened at a same-page anchor leaves the anchor with the visit, for the plain view\'s scroll', async () => {
    const h = harness();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(frame(h));
    const input = await ready(h);
    await settled();
    act(() => { input.onReady(); });
    act(() => { input.onLink({ kind: 'relative', path: 'a.md', fragment: 'sec' }); });
    act(() => { input.onFallback('timeout'); });
    expect(await screen.findByText(READER_FALLBACK_NOTE)).toBeInTheDocument();
    expect(h.onFragment).toHaveBeenCalledWith('sec', location.pathname + location.search);
    expect(h.consumed).not.toHaveBeenCalled();
  });

  it('a same-page link that arrives after the body fell back, or ended, opens nothing', async () => {
    const h1 = harness();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(frame(h1));
    const fellBack = await ready(h1);
    await settled();
    act(() => { fellBack.onFallback('timeout'); });
    await screen.findByText(READER_FALLBACK_NOTE);
    act(() => { fellBack.onLink({ kind: 'relative', path: 'a.md', fragment: 'sec' }); });
    expect(h1.handle.openAt).not.toHaveBeenCalled();
    cleanup();
    const h2 = harness();
    const r2 = render(frame(h2));
    const ended = await ready(h2);
    await settled();
    r2.unmount();
    act(() => { ended.onLink({ kind: 'relative', path: 'a.md', fragment: 'sec' }); });
    expect(h2.handle.openAt).not.toHaveBeenCalled();
  });
});

describe('the lifetime of a mount (spec 4.1)', () => {
  it('unmount aborts the render and destroys the mount', async () => {
    const h = harness();
    let signal: AbortSignal | undefined;
    h.renderFn.mockImplementation(async (_s, o) => { signal = o.signal; return RENDERED; });
    const { unmount } = render(frame(h));
    await ready(h);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(h.handle.destroy).toHaveBeenCalledTimes(1);
  });

  it('an unmount while the render is pending ignores its answer and mounts nothing', async () => {
    const h = harness();
    let answer: (o: ReaderRenderOutcome) => void = () => {};
    let signal: AbortSignal | undefined;
    h.renderFn.mockImplementation((_s, o) => { signal = o.signal; return new Promise((r) => { answer = r; }); });
    const { unmount } = render(frame(h));
    await waitFor(() => expect(h.renderFn).toHaveBeenCalled());
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { answer(RENDERED); await Promise.resolve(); });
    expect(h.imagesFn).not.toHaveBeenCalled();
    expect(h.mountFn).not.toHaveBeenCalled();
  });

  it('a mount that resolves after unmount is destroyed', async () => {
    const h = harness();
    let resolveMount: (m: ReaderMount) => void = () => {};
    h.mountFn.mockImplementation(() => new Promise<ReaderMount>((r) => { resolveMount = r; }));
    const { unmount } = render(frame(h));
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(1));
    unmount();
    expect(h.handle.destroy).not.toHaveBeenCalled();
    await act(async () => { resolveMount(h.handle as ReaderMount); await Promise.resolve(); });
    expect(h.handle.destroy).toHaveBeenCalledTimes(1);
  });

  it('a mount that resolves after its body key changed is destroyed', async () => {
    const h = harness();
    const resolvers: ((m: ReaderMount) => void)[] = [];
    h.mountFn.mockImplementation(() => new Promise<ReaderMount>((r) => { resolvers.push(r); }));
    const { rerender } = render(frame(h));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    rerender(frame(h, { bodyKey: 'k2' }));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => { resolvers[0]?.(h.handle as ReaderMount); await Promise.resolve(); });
    expect(h.handle.destroy).toHaveBeenCalledTimes(1);
  });

  it('a theme change calls setPrefs once and never remounts', async () => {
    const h = harness();
    render(frame(h));
    await ready(h);
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(1));
    act(() => { chooseTheme('phosphor'); });
    await waitFor(() => expect(h.handle.setPrefs).toHaveBeenCalledTimes(1));
    expect(h.handle.setPrefs).toHaveBeenCalledWith({ theme: 'dark' });
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(h.handle.destroy).not.toHaveBeenCalled();
  });

  it('the palette decides the frame theme: dark seeds dark, system is auto, and a switch within a mode sends nothing', async () => {
    themeChoice.value = 'phosphor';
    const h = harness();
    render(frame(h));
    const input = await ready(h);
    expect(input.prefs).toEqual({ theme: 'dark' });
    await waitFor(() => expect(h.consumed.mock.calls.length + h.mountFn.mock.calls.length).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    act(() => { chooseTheme('nord'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.handle.setPrefs).not.toHaveBeenCalled();
    act(() => { chooseTheme('system'); });
    await waitFor(() => expect(h.handle.setPrefs).toHaveBeenCalledTimes(1));
    expect(h.handle.setPrefs).toHaveBeenLastCalledWith({ theme: 'auto' });
    expect(h.mountFn).toHaveBeenCalledTimes(1);
  });

  it('a theme change while the mount is pending reaches the frame once it lands', async () => {
    const h = harness();
    let resolveMount: (m: ReaderMount) => void = () => {};
    h.mountFn.mockImplementation(() => new Promise<ReaderMount>((r) => { resolveMount = r; }));
    render(frame(h));
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(1));
    act(() => { chooseTheme('phosphor'); });
    expect(h.handle.setPrefs).not.toHaveBeenCalled();
    await act(async () => { resolveMount(h.handle as ReaderMount); await Promise.resolve(); });
    expect(h.handle.setPrefs).toHaveBeenCalledTimes(1);
    expect(h.handle.setPrefs).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('loaded draft images are counted once and taken back on unmount', async () => {
    const h = harness({ drafts: 2 });
    const { unmount } = render(frame(h));
    await ready(h);
    expect(h.onDraftAsset.mock.calls).toEqual([[2]]);
    unmount();
    expect(h.onDraftAsset.mock.calls).toEqual([[2], [-2]]);
  });

  it('a fallback takes the drafts back once, and the unmount takes back nothing more', async () => {
    const h = harness({ drafts: 2 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { unmount } = render(frame(h));
    const input = await ready(h);
    act(() => { input.onFallback('timeout'); });
    expect(await screen.findByText(READER_FALLBACK_NOTE)).toBeInTheDocument();
    expect(h.onDraftAsset.mock.calls).toEqual([[2], [-2]]);
    unmount();
    expect(h.onDraftAsset.mock.calls).toEqual([[2], [-2]]);
  });
});

/** One image the way the loader hands it back: a `data:` URL under its ref. */
const IMG_URL = 'data:image/png;base64,AAAA';

describe('a body whose images answered 401 asks once more when sign-in returns (completion plan Task 8)', () => {
  it('mounts once, then on sign-in asks the images again, destroys the old mount and mounts with the image', async () => {
    const h = harness();
    h.imagesFn.mockResolvedValueOnce({ urls: {}, drafts: 1, auth: 1 });
    h.imagesFn.mockResolvedValueOnce({ urls: { 'i.png': IMG_URL }, drafts: 1, auth: 0 });
    render(frame(h));
    await ready(h);
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(h.inputs[0]?.document.images).toEqual({});
    expect(h.onDraftAsset.mock.calls).toEqual([[1]]);
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(2));
    expect(h.imagesFn).toHaveBeenCalledTimes(2);
    expect(h.inputs[1]?.document.images).toEqual({ 'i.png': IMG_URL });
    expect(h.handle.destroy).toHaveBeenCalledTimes(1);
    // The first run's draft count went back before the second run counted its own.
    expect(h.onDraftAsset.mock.calls).toEqual([[1], [-1], [1]]);
  });

  // Review 2372 F1: sign-in is announced once, so the body listens from before its images walk.
  it('a sign-in that completes while a queued image load is still pending starts the new body once the walk ends, and its mount shows the image', async () => {
    const h = harness();
    let walked!: (i: { urls: Record<string, string>; drafts: number; auth: number }) => void;
    h.imagesFn.mockImplementationOnce(() => new Promise((r) => { walked = r; }));
    h.imagesFn.mockResolvedValueOnce({ urls: { 'i.png': IMG_URL }, drafts: 1, auth: 0 });
    render(frame(h));
    await waitFor(() => expect(h.imagesFn).toHaveBeenCalledTimes(1));
    // A load of the walk answered 401 (the login screen is up), and sign-in completes while a queued load is still pending.
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await act(async () => { walked({ urls: {}, drafts: 1, auth: 1 }); await Promise.resolve(); });
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(1));
    expect(h.imagesFn).toHaveBeenCalledTimes(2);
    expect(h.inputs[0]?.document.images, 'the one mount is the new body\'s, with the image the 401 had kept out').toEqual({ 'i.png': IMG_URL });
    expect(h.handle.destroy).not.toHaveBeenCalled();
    // The first body counted no drafts and mounted nothing: only the new body's count stands.
    expect(h.onDraftAsset.mock.calls).toEqual([[1]]);
  });

  it('a sign-in during a walk that answered no 401 starts nothing: the body mounts once and stops listening', async () => {
    const before = authListeners.live;
    const h = harness();
    let walked!: (i: { urls: Record<string, string>; drafts: number; auth: number }) => void;
    h.imagesFn.mockImplementationOnce(() => new Promise((r) => { walked = r; }));
    render(frame(h));
    await waitFor(() => expect(h.imagesFn).toHaveBeenCalledTimes(1));
    expect(authListeners.live, 'the body listens during its walk').toBe(before + 1);
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await act(async () => { walked({ urls: { 'i.png': IMG_URL }, drafts: 0, auth: 0 }); await Promise.resolve(); });
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(1));
    expect(authListeners.live, 'a walk with no 401 drops the listener').toBe(before);
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.imagesFn).toHaveBeenCalledTimes(1);
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(h.handle.destroy).not.toHaveBeenCalled();
  });

  // Review 2378 F3: the drop after a walk with no 401 is measured by the live listeners, which is all it changes.
  it('a walk with no 401 drops the sign-in listener: a sign-in after it finds no listener of the body and starts nothing', async () => {
    const before = authListeners.live;
    const h = harness();
    h.imagesFn.mockResolvedValueOnce({ urls: { 'i.png': IMG_URL }, drafts: 0, auth: 0 });
    const { unmount } = render(frame(h));
    await ready(h);
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(authListeners.live, 'the mounted body holds no listener').toBe(before);
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(authListeners.live).toBe(before);
    expect(h.imagesFn).toHaveBeenCalledTimes(1);
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(h.handle.destroy).not.toHaveBeenCalled();
    unmount();
    expect(authListeners.live).toBe(before);
  });

  // Review 2361 F1: the run after sign-in is a new body, so it lands where its own outcome says, from `rendering`.
  /** A harness whose first run mounts with a 401 image and whose render after sign-in answers `second`. */
  function armed(second: () => Promise<ReaderRenderOutcome>): Harness {
    const h = harness();
    h.imagesFn.mockResolvedValueOnce({ urls: {}, drafts: 0, auth: 1 });
    h.renderFn.mockResolvedValueOnce(RENDERED).mockImplementationOnce(second);
    return h;
  }
  /** The first mount is ready (no note), then sign-in returns and the second render is asked. */
  async function signInAgain(h: Harness): Promise<void> {
    const first = await ready(h);
    act(() => { first.onReady(); });
    expect(screen.queryByText(DOC_FORMATTING)).toBeNull();
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await waitFor(() => expect(h.renderFn).toHaveBeenCalledTimes(2));
  }

  it('a second run whose render times out lands on the plain view with the timeout note and mounts nothing more', async () => {
    const h = armed(async () => ({ kind: 'timeout', budgetMs: 4000 }));
    const { container } = render(frame(h));
    await signInAgain(h);
    expect(await screen.findByText(docsPlainNote({ kind: 'timeout', budgetMs: 4000 }))).toBeInTheDocument();
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(h.handle.destroy).toHaveBeenCalledTimes(1);
    expect(h.parser).not.toHaveBeenCalled();
    expect(container.querySelector('.docs-reader')).toBeNull();
  });

  it('a second run whose render is refused lands on the plain view, which formats the body itself', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = armed(async () => ({ kind: 'refused', why: 'container-depth', line: 3, value: 99 }));
    const { container } = render(frame(h));
    await signInAgain(h);
    expect(await screen.findByRole('heading', { name: 'Formatted' })).toBeInTheDocument();
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.docs-reader')).toBeNull();
    // The plain view, not the fallback, which draws the same heading under its fixed note (review 2372 M-f).
    expect(container.textContent).not.toContain(READER_FALLBACK_NOTE);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain('ccrc: reader not rendered (refused: container-depth at line 3)');
  });

  it('a second run whose render rejects lands on the plain view', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = armed(async () => { throw new Error('the worker went away'); });
    const { container } = render(frame(h));
    await signInAgain(h);
    expect(await screen.findByRole('heading', { name: 'Formatted' })).toBeInTheDocument();
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.docs-reader')).toBeNull();
    expect(container.textContent).not.toContain(READER_FALLBACK_NOTE);
  });

  it('a sign-in while the first mount is still in flight: the new body mounts with the image, and the late first mount is destroyed when it lands (review 2372 M-f)', async () => {
    const h = harness();
    h.imagesFn.mockResolvedValueOnce({ urls: {}, drafts: 0, auth: 1 });
    h.imagesFn.mockResolvedValueOnce({ urls: { 'i.png': IMG_URL }, drafts: 0, auth: 0 });
    const late = { destroy: vi.fn(), setPrefs: vi.fn(), command: vi.fn() };
    let land!: () => void;
    h.mountFn.mockImplementationOnce((_el, input) => new Promise((resolve) => {
      h.inputs.push(input);
      land = () => resolve(late as unknown as ReaderMount);
    }));
    render(frame(h));
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(1));
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(2));
    expect(h.imagesFn).toHaveBeenCalledTimes(2);
    expect(h.inputs[1]?.document.images).toEqual({ 'i.png': IMG_URL });
    await act(async () => { land(); await Promise.resolve(); });
    expect(late.destroy, 'the first body was gone when its mount landed').toHaveBeenCalledTimes(1);
    expect(h.handle.destroy, 'the new body\'s mount stands').not.toHaveBeenCalled();
  });

  it('while the second run renders, the "Formatting…" note shows, and it goes once the new mount is ready', async () => {
    let release!: (o: ReaderRenderOutcome) => void;
    const h = armed(() => new Promise((r) => { release = r; }));
    render(frame(h));
    await signInAgain(h);
    expect(await screen.findByText(DOC_FORMATTING)).toBeInTheDocument();
    release(RENDERED);
    await waitFor(() => expect(h.inputs).toHaveLength(2));
    act(() => { h.inputs[1]!.onReady(); });
    expect(screen.queryByText(DOC_FORMATTING)).toBeNull();
  });

  it('asks once: a second sign-in after a body with no 401 left does nothing', async () => {
    const h = harness();
    h.imagesFn.mockResolvedValueOnce({ urls: {}, drafts: 0, auth: 1 });
    render(frame(h));
    await ready(h);
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(2));
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.mountFn).toHaveBeenCalledTimes(2);
    expect(h.imagesFn).toHaveBeenCalledTimes(2);
  });

  it('a body whose images answered no 401 is not run again by sign-in', async () => {
    const h = harness();
    render(frame(h));
    await ready(h);
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.imagesFn).toHaveBeenCalledTimes(1);
    expect(h.mountFn).toHaveBeenCalledTimes(1);
    expect(h.renderFn).toHaveBeenCalledTimes(1);
    expect(h.handle.destroy).not.toHaveBeenCalled();
  });

  it('a fallback takes the subscription away: sign-in afterwards runs nothing again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    h.imagesFn.mockResolvedValueOnce({ urls: {}, drafts: 0, auth: 1 });
    render(frame(h));
    const input = await ready(h);
    act(() => { input.onFallback('timeout'); });
    expect(await screen.findByText(READER_FALLBACK_NOTE)).toBeInTheDocument();
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.imagesFn).toHaveBeenCalledTimes(1);
    expect(h.mountFn).toHaveBeenCalledTimes(1);
  });

  it('a run that is replaced takes its subscription away: sign-in after a new text asks once, not twice', async () => {
    const h = harness();
    h.imagesFn.mockResolvedValueOnce({ urls: {}, drafts: 0, auth: 1 });
    const { rerender } = render(frame(h, { text: '# A' }));
    await ready(h);
    rerender(frame(h, { text: '# B' }));
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(2));
    expect(h.imagesFn).toHaveBeenCalledTimes(2);
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.imagesFn).toHaveBeenCalledTimes(2);
    expect(h.mountFn).toHaveBeenCalledTimes(2);
  });

  it('an unmount takes the subscription away: sign-in afterwards asks for nothing', async () => {
    const h = harness();
    h.imagesFn.mockResolvedValueOnce({ urls: {}, drafts: 0, auth: 1 });
    const { unmount } = render(frame(h));
    await ready(h);
    unmount();
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.imagesFn).toHaveBeenCalledTimes(1);
    expect(h.mountFn).toHaveBeenCalledTimes(1);
  });
});

describe('an old body cannot publish into a new body (completion plan Task 8)', () => {
  it('body A\'s images, resolving after the leaf changed, count no drafts and reach no mount', async () => {
    const h = harness();
    const answers: ((i: { urls: Record<string, string>; drafts: number; auth: number }) => void)[] = [];
    const signals: AbortSignal[] = [];
    h.imagesFn.mockImplementation((_refs, _link, _assets, signal) => new Promise((resolve) => {
      signals.push(signal);
      answers.push((i) => resolve(i));
    }));
    const { rerender } = render(frame(h));
    await waitFor(() => expect(answers).toHaveLength(1));
    rerender(frame(h, { bodyKey: 'k2' }));
    await waitFor(() => expect(answers).toHaveLength(2));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    await act(async () => { answers[0]?.({ urls: { 'a.png': IMG_URL }, drafts: 2, auth: 1 }); await Promise.resolve(); });
    expect(h.mountFn).not.toHaveBeenCalled();
    expect(h.onDraftAsset).not.toHaveBeenCalled();
    await act(async () => { answers[1]?.({ urls: { 'b.png': IMG_URL }, drafts: 1, auth: 0 }); await Promise.resolve(); });
    await waitFor(() => expect(h.mountFn).toHaveBeenCalledTimes(1));
    expect(h.inputs[0]?.document.images).toEqual({ 'b.png': IMG_URL });
    expect(h.onDraftAsset.mock.calls).toEqual([[1]]);
    // A's 401 count did not subscribe the new body to sign-in either.
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.imagesFn).toHaveBeenCalledTimes(2);
  });
});

describe('the default reader (spec 4.1)', () => {
  it('with no Worker, DocsScreen`s default reader is null and docsRunner.render is never called', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    Reflect.deleteProperty(globalThis, 'Worker');
    try {
      const spy = vi.spyOn(docsRunner, 'render');
      const f = fakeLoaders({ file: okFile('# Hello') });
      const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');
      render(<DocsScreen path="/docs/demo/specs/a.md" search="" loaders={f.loaders} parser={parser} />);
      expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) Object.defineProperty(globalThis, 'Worker', saved);
    }
  });
});

describe('a deep link survives a fallback raised after the mount resolved (completion plan Task 13)', () => {
  it('the real plain view scrolls the element the fragment names', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');
    const h = harness();
    history.pushState(null, '', '/docs/demo/specs/a.md#user-content-fn-1');
    try {
      const { container } = render(<DocsScreen
        path="/docs/demo/specs/a.md" search="" loaders={fakeLoaders({ file: okFile('Body.[^1]\n\n[^1]: The note.\n') }).loaders}
        parser={parser} reader={h.reader}
      />);
      const input = await ready(h);
      expect(input.document.initialHash).toBe('user-content-fn-1');
      await settled();
      act(() => { input.onFallback('timeout'); });
      expect(await screen.findByText(READER_FALLBACK_NOTE)).toBeInTheDocument();
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
      expect(scroll.mock.contexts[0]).toBe(container.querySelector('article li#user-content-fn-1'));
    } finally {
      history.replaceState(null, '', '/');
    }
  });
});

describe('ccrc\'s bar (the take-up plan, Task 5)', () => {
  const lastBar = (publish: ReturnType<typeof vi.fn<(bar: ReaderBar | null) => void>>): ReaderBar | null | undefined =>
    publish.mock.calls[publish.mock.calls.length - 1]?.[0];

  it('a host-bar slot mounts with ccrc\'s bar and asks for progress', async () => {
    const h = harness();
    render(slotted(h, 'host-bar', vi.fn()));
    const input = await ready(h);
    expect(input.chrome).toBe('host-bar');
    expect(typeof input.onProgress).toBe('function');
  });

  it('a frame-bar slot, and no slot, mount with the frame\'s own bar and ask for no progress; nothing is published', async () => {
    const h1 = harness();
    const publish = vi.fn<(bar: ReaderBar | null) => void>();
    render(slotted(h1, 'frame-bar', publish));
    const i1 = await ready(h1);
    expect(i1.chrome).toBe('frame-bar');
    expect(i1.onProgress).toBeUndefined();
    act(() => { i1.onReady(); });
    expect(publish.mock.calls.filter((c) => c[0] !== null)).toEqual([]);
    cleanup();
    const h2 = harness();
    render(frame(h2));
    const i2 = await ready(h2);
    expect(i2.chrome).toBe('frame-bar');
    expect(i2.onProgress).toBeUndefined();
  });

  it('the bar is published at ready, not before', async () => {
    const h = harness();
    const publish = vi.fn<(bar: ReaderBar | null) => void>();
    render(slotted(h, 'host-bar', publish));
    const input = await ready(h);
    // Let the mount promise settle and React commit whatever it leads to, so "not before" is measured after the
    // mount has landed, not merely after the mount was asked for.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(publish.mock.calls.filter((c) => c[0] !== null)).toEqual([]);
    act(() => { input.onReady(); });
    expect(lastBar(publish)).not.toBeNull();
    expect(lastBar(publish)).toBeDefined();
  });

  it('the bar\'s title is the document\'s own, else the file name', async () => {
    const titled: ReaderRenderOutcome = {
      ...RENDERED,
      result: { ...RENDERED.result, meta: { ...RENDERED.result.meta, title: 'Doc title' } },
    } as ReaderRenderOutcome;
    const h1 = harness({ outcome: titled });
    const p1 = vi.fn<(bar: ReaderBar | null) => void>();
    render(slotted(h1, 'host-bar', p1));
    const i1 = await ready(h1);
    act(() => { i1.onReady(); });
    expect(lastBar(p1)?.title).toBe('Doc title');
    cleanup();
    const h2 = harness();
    const p2 = vi.fn<(bar: ReaderBar | null) => void>();
    render(slotted(h2, 'host-bar', p2));
    const i2 = await ready(h2);
    act(() => { i2.onReady(); });
    expect(lastBar(p2)?.title).toBe(leafName(showOf('# A').path));
  });

  it('the bar\'s command reaches the mount\'s command', async () => {
    const h = harness();
    const publish = vi.fn<(bar: ReaderBar | null) => void>();
    render(slotted(h, 'host-bar', publish));
    const input = await ready(h);
    act(() => { input.onReady(); });
    lastBar(publish)?.command('contents');
    expect(h.handle.command).toHaveBeenCalledWith('contents');
  });

  it('progress reaches the bar\'s store and its listeners', async () => {
    const h = harness();
    const publish = vi.fn<(bar: ReaderBar | null) => void>();
    render(slotted(h, 'host-bar', publish));
    const input = await ready(h);
    act(() => { input.onReady(); });
    const spy = vi.fn();
    const bar = lastBar(publish);
    bar?.progress.subscribe(spy);
    act(() => { input.onProgress?.(0.4); });
    expect(bar?.progress.read()).toBe(0.4);
    expect(spy).toHaveBeenCalled();
  });

  it('a fallback after ready withdraws the bar, and so does an unmount', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h1 = harness();
    const p1 = vi.fn<(bar: ReaderBar | null) => void>();
    render(slotted(h1, 'host-bar', p1));
    const i1 = await ready(h1);
    act(() => { i1.onReady(); });
    expect(lastBar(p1)).not.toBeNull();
    act(() => { i1.onFallback('error'); });
    expect(lastBar(p1)).toBeNull();
    cleanup();
    const h2 = harness();
    const p2 = vi.fn<(bar: ReaderBar | null) => void>();
    const { unmount } = render(slotted(h2, 'host-bar', p2));
    const i2 = await ready(h2);
    act(() => { i2.onReady(); });
    expect(lastBar(p2)).not.toBeNull();
    unmount();
    expect(lastBar(p2)).toBeNull();
  });

  it('sign-in withdraws the old mount\'s bar until the new mount is ready, then publishes the new one (completion plan Task 8; review M7d)', async () => {
    const h = harness();
    let release!: (v: { urls: Record<string, string>; drafts: number; auth: number }) => void;
    h.imagesFn.mockResolvedValueOnce({ urls: {}, drafts: 0, auth: 1 });
    h.imagesFn.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const publish = vi.fn<(bar: ReaderBar | null) => void>();
    render(slotted(h, 'host-bar', publish));
    const first = await ready(h);
    act(() => { first.onReady(); });
    const oldBar = lastBar(publish);
    expect(oldBar).not.toBeNull();
    // Sign-in returns: the destroyed mount's bar must not stand while the new run is still asking for its images.
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await waitFor(() => expect(h.imagesFn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.handle.destroy).toHaveBeenCalledTimes(1));
    expect(lastBar(publish)).toBeNull();
    // The new mount is up and ready: its own bar is published.
    release({ urls: {}, drafts: 0, auth: 0 });
    await waitFor(() => expect(h.inputs).toHaveLength(2));
    act(() => { h.inputs[1]!.onReady(); });
    const newBar = lastBar(publish);
    expect(newBar).not.toBeNull();
    expect(newBar).not.toBe(oldBar);
  });

  it('the slot\'s bar is read as the mount starts: a later change does not remount', async () => {
    const h = harness();
    const publish = vi.fn<(bar: ReaderBar | null) => void>();
    const { rerender } = render(slotted(h, 'host-bar', publish));
    await ready(h);
    rerender(slotted(h, 'frame-bar', publish));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.mountFn).toHaveBeenCalledTimes(1);
  });

  it('a phone turned sideways keeps the one bar: a frame mounted with ccrc\'s bar still publishes it after the slot asks for the frame\'s own', async () => {
    // Refinement (f): the bar that was mounted decides the head for the frame's life. Turned before ready, the frame
    // publishes at ready; turned after ready, it re-publishes through the new slot.
    const h1 = harness();
    const p1 = vi.fn<(bar: ReaderBar | null) => void>();
    const r1 = render(slotted(h1, 'host-bar', p1));
    const i1 = await ready(h1);
    r1.rerender(slotted(h1, 'frame-bar', p1));
    act(() => { i1.onReady(); });
    expect(lastBar(p1)).not.toBeNull();
    expect(lastBar(p1)).toBeDefined();
    cleanup();
    const h2 = harness();
    const p2 = vi.fn<(bar: ReaderBar | null) => void>();
    const r2 = render(slotted(h2, 'host-bar', p2));
    const i2 = await ready(h2);
    act(() => { i2.onReady(); });
    const before = lastBar(p2);
    expect(before).not.toBeNull();
    const p3 = vi.fn<(bar: ReaderBar | null) => void>();
    r2.rerender(slotted(h2, 'frame-bar', p3));
    expect(lastBar(p3)).toBe(before);
    expect(h2.mountFn).toHaveBeenCalledTimes(1);
  });

  it('a frame mounted with its own bar publishes none, even once the slot asks for ccrc\'s (a window narrowed after the mount)', async () => {
    // Refinement (f): a desk-born frame keeps its own bar for its life, so the head keeps option 1's row over it.
    const h = harness();
    const publish = vi.fn<(bar: ReaderBar | null) => void>();
    const r = render(slotted(h, 'frame-bar', publish));
    const input = await ready(h);
    expect(input.chrome).toBe('frame-bar');
    r.rerender(slotted(h, 'host-bar', publish));
    act(() => { input.onReady(); });
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    expect(publish.mock.calls.filter((c) => c[0] !== null)).toEqual([]);
    expect(h.mountFn).toHaveBeenCalledTimes(1);
  });

  it('the Docs screen asks for ccrc\'s bar under the compact width and for the frame\'s own above it', async () => {
    const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');
    atWidth(412);
    const h1 = harness();
    render(<DocsScreen path="/docs/demo/specs/a.md" search="" loaders={fakeLoaders({ file: okFile('# Hello') }).loaders} parser={parser} reader={h1.reader} />);
    expect((await ready(h1)).chrome).toBe('host-bar');
    cleanup();
    atWidth(1280);
    const h2 = harness();
    render(<DocsScreen path="/docs/demo/specs/a.md" search="" loaders={fakeLoaders({ file: okFile('# Hello') }).loaders} parser={parser} reader={h2.reader} />);
    expect((await ready(h2)).chrome).toBe('frame-bar');
  });
});
