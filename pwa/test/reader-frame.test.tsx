// Docs W8a Task 8: ReaderFrame, the two sheets and the leaf wiring (the rich-docs spec's (amended 2026-10-31) section 4.1,
// section 4.6, M8.7, M8.11, M8.17, M8.19 and the W8a plan's refinement (g)). Every case injects `render`, `mount`, `images` and the
// `parser`; none reaches a worker, the library's host or a server. The router's `navigate` and `replaceFragment` and
// the clipboard writer are module mocks, so a case can see what the frame asked of them. Every address is a
// placeholder (`demo`, `https://a.example`), and control characters are built with `String.fromCharCode`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DocsShowOk } from '../../shared/docs';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import {
  DOC_MARKDOWN_ACTION, docGateSentence, docsPlainNote,
} from '../src/docs/DocMarkdown';
import { ReaderFrame, lazyMountReader, type ReaderDeps } from '../src/docs/ReaderFrame';
import type { ReaderMount, ReaderMountInput } from '../src/docs/reader/bridge';
import type { ReaderLink } from '../src/docs/reader/policy';
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
  project: 'demo', pageRef: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
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
  readonly handle: { destroy: ReturnType<typeof vi.fn>; setPrefs: ReturnType<typeof vi.fn> };
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
  const handle = { destroy: vi.fn(), setPrefs: vi.fn() };
  const renderFn = vi.fn<ReaderDeps['render']>(async () => over.outcome ?? RENDERED);
  const mountFn = vi.fn<ReaderDeps['mount']>(over.mount ?? (async (_el, input) => {
    inputs.push(input);
    return handle as ReaderMount;
  }));
  const imagesFn = vi.fn<ReaderDeps['images']>(async () => ({ urls: {}, drafts: over.drafts ?? 0 }));
  const parser = vi.fn<MarkdownParser>(async (): Promise<ParseOutcome> => parseMarkdown('# Formatted', 'docs'));
  return {
    reader: { render: renderFn, mount: mountFn, images: imagesFn },
    renderFn, mountFn, imagesFn, handle, inputs, parser,
    onDraftAsset: vi.fn<(delta: number) => void>(),
    onFragment: vi.fn<DocLinkContextValue['onFragment']>(),
    consumed: vi.fn<() => void>(),
  };
}

function frame(h: Harness, over: { text?: string; bodyKey?: string; pending?: string | null; show?: DocsShowOk } = {}): ReactNode {
  const assets: DocsAssetContextValue = {
    loaders: fakeLoaders().loaders, queue: createFetchQueue(), onDraftAsset: h.onDraftAsset,
  };
  return (
    <DocsAssetContext value={assets}>
      <ReaderFrame
        key={over.bodyKey ?? 'k1'}
        show={over.show ?? showOf(over.text ?? '# A')} bodyKey={over.bodyKey ?? 'k1'} link={{ ...LINK, onFragment: h.onFragment }}
        parser={h.parser} reader={h.reader} pendingFragment={over.pending ?? null} onFragmentConsumed={h.consumed}
      />
    </DocsAssetContext>
  );
}

/** The text the open copy sheet shows (the `pre` of its marked text), or '' when there is none. */
function sheetText(): string {
  return document.querySelector('.docs-reader-sheet-text')?.textContent ?? '';
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
    await waitFor(() => expect(h.consumed).toHaveBeenCalledTimes(1));
  });

  it('refinement (k): a committed doc reaches the mount with its commit and no draft flag, a draft with its head and the flag', async () => {
    const commit = 'a'.repeat(40);
    const head = 'b'.repeat(40);
    const h1 = harness();
    render(frame(h1, { show: { ...showOf('# A'), source: 'committed', commit } }));
    expect((await ready(h1)).document.version).toEqual({ sha: commit, draft: false });
    cleanup();
    const h2 = harness();
    render(frame(h2, { show: { ...showOf('# A'), source: 'draft', head } }));
    expect((await ready(h2)).document.version).toEqual({ sha: head, draft: true });
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

  it('clean text calls copyText directly; a rejected write opens the copy sheet', async () => {
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
