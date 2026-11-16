// Docs W5b-2: the version view (the rich-docs spec's G6; the W5b plan's refinements (m) to (t)). A leaf page at `at=<sha>`
// opens the committed bytes at that commit, for a doc the served listing holds as a committed file: its pin carries the
// URL's commit and the listing's served ref (Task 17, refinement (p)), its body is keyed by that pin, and a word that would
// mean "the listing moved" is that commit's own answer. Every case renders `DocsScreen` (or the visit hook) over spies:
// `fakeLoaders` records every `file` and `raster` call, and a fake `ReaderDeps.mount` records what the reader was
// mounted with. Later tasks append their cases below the helpers. Placeholders only: project `demo`, branch `ws/a`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { DOCS_CLASS_CAP, type DocPin, type DocsPageLocation, type DocsShowOk } from '../../shared/docs';
import { DocsScreen } from '../src/screens/DocsScreen';
import type { ReaderDeps } from '../src/docs/ReaderFrame';
import type { ReaderMount, ReaderMountInput } from '../src/docs/reader/bridge';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { DOCS_FAILURE_SENTENCE, DOCS_VIEW_TEXT, fillSentence, kib, shortCommit } from '../src/docs/docsText';
import { pinFor, useDocsVisit } from '../src/docs/useDocsVisit';
import type { DocsFileAnswer, DocsLoaders } from '../src/docs/failures';
import { clearAuthLost } from '../src/lib/auth';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import {
  BLOB_1, BLOB_2, COMMIT_A, COMMIT_B, RAN, SERVED, draftOf, entry, failedAnswer, fakeLoaders, fileResponse, holder, okRefresh, okTree, pageAt,
  treeOk, treeResponse, type FakeLoaders,
} from './docsFixtures';

/** A commit the listing never names: the version the URL's `at=` asks for. */
const VERSION = '9'.repeat(40);

/** Parses in this thread, as the worker would. */
const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

const RENDERED: ReaderRenderOutcome = {
  kind: 'rendered',
  result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: null, frontList: null, headings: [], figures: 0, mermaidKinds: [] } },
  mermaid: { fences: 0, largestBytes: 0, totalBytes: 0, largestChars: 0, totalChars: 0 },
  images: [],
  imagesTruncated: false,
};

interface ReaderSpy {
  readonly reader: ReaderDeps;
  readonly inputs: ReaderMountInput[];
}

/** A `ReaderDeps` whose mount records its input and whose render answers a fixed outcome. */
function readerSpy(): ReaderSpy {
  const inputs: ReaderMountInput[] = [];
  const handle = { destroy: vi.fn(), setPrefs: vi.fn(), command: vi.fn() };
  return {
    inputs,
    reader: {
      render: vi.fn<ReaderDeps['render']>(async () => RENDERED),
      mount: vi.fn<ReaderDeps['mount']>(async (_el, input) => { inputs.push(input); return handle as ReaderMount; }),
      images: vi.fn<ReaderDeps['images']>(async () => ({ urls: {}, drafts: 0 })),
    },
  };
}

/** The screen under the live location, as the app's `docs` arm mounts it (one mount across navigations). */
function Routed(p: { readonly loaders: DocsLoaders; readonly reader?: ReaderDeps | null }): ReactNode {
  const { path, search } = useLocation();
  return <DocsScreen path={path} search={search} loaders={p.loaders} parser={parser} reader={p.reader ?? null} />;
}

function open(url: string, f: FakeLoaders, reader: ReaderDeps | null = null): ReturnType<typeof render> {
  navigate(url);
  return render(<Routed loaders={f.loaders} reader={reader} />);
}

/** A committed file answer for whatever pin it is asked: the show names that pin's commit and the listing's blob. */
function answerByPin(text = '# A'): (project: string, pin: DocPin) => Promise<DocsFileAnswer> {
  return async (_project, pin) => {
    const r = fileResponse(text);
    const show: DocsShowOk = pin.kind === 'draft'
      ? { ...r.show, source: 'draft', head: pin.head }
      : { ...r.show, commit: pin.commit, blob: BLOB_1 };
    return { s: 'ok', value: { ...r, show } };
  };
}

/** Loaders over a listing holding `a.md` (committed, blob 1) at the commit `COMMIT_A`, reading each pin as the pin says. */
function versionLoaders(over: Parameters<typeof treeOk>[0] = {}): FakeLoaders {
  const f = fakeLoaders({ tree: okTree(treeOk(over)) });
  f.file.mockImplementation(answerByPin());
  return f;
}

/** The pins every `file` call asked for, in order. */
const filePins = (f: FakeLoaders): DocPin[] => f.file.mock.calls.map((c) => c[1]);

const here = (): string => location.pathname + location.search;

function visitHook(loaders: DocsLoaders, url: string) {
  return renderHook(
    (p: { page: DocsPageLocation | null }) => useDocsVisit(p.page, loaders),
    { initialProps: { page: pageAt(url) } },
  );
}

afterEach(() => {
  cleanup();
  clearAuthLost();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('the visit opens the version (refinement (p), M9.11)', () => {
  it('a page at at= reads a committed pin at that commit, served ref the listing\'s', async () => {
    const f = versionLoaders();
    open(`/docs/demo/specs/a.md?at=${VERSION}`, f);
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    expect(f.file).toHaveBeenCalledTimes(1);
    expect(f.file.mock.calls[0]?.[0]).toBe('demo');
    expect(filePins(f)[0]).toEqual({ kind: 'committed', commit: VERSION, servedRef: SERVED, section: 'specs', path: 'a.md' });
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it('a version whose blob equals the latest\'s is read, not taken from the latest\'s body', async () => {
    const f = versionLoaders();
    open('/docs/demo/specs/a.md', f);
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    expect(f.file).toHaveBeenCalledTimes(1);
    act(() => { navigate(`/docs/demo/specs/a.md?at=${VERSION}`); });
    await waitFor(() => expect(f.file).toHaveBeenCalledTimes(2));
    expect(filePins(f).map((p) => (p.kind === 'committed' ? p.commit : p.head))).toEqual([COMMIT_A, VERSION]);
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it('unknown-commit on a version page fails it, with no re-list, and says the box has no such commit', async () => {
    const f = versionLoaders();
    f.file.mockResolvedValue(failedAnswer('unknown-commit'));
    const { container } = open(`/docs/demo/specs/a.md?at=${VERSION}`, f);
    const sentence = fillSentence(DOCS_VIEW_TEXT.versionUnknownCommit, { short: shortCommit(VERSION) });
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    // Nothing re-lists and nothing re-reads: the commit is the URL's, so no answer can change it.
    expect(f.tree).toHaveBeenCalledTimes(1);
    expect(f.file).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(sentence);
    expect(container.textContent).not.toContain(DOCS_FAILURE_SENTENCE['unknown-commit']);
    expect(container.textContent).not.toContain(DOCS_VIEW_TEXT.changing);
  });

  it('a version page skips the listing\'s size and lets the class cap answer', async () => {
    const cap = DOCS_CLASS_CAP.markdown;
    const big = entry('specs', 'a.md', { committed: { kind: 'file', blob: BLOB_1, size: cap + 1 } });
    const f = versionLoaders({ entries: [big] });
    open(`/docs/demo/specs/a.md?at=${VERSION}`, f);
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    expect(f.file).toHaveBeenCalledTimes(1);
    expect(filePins(f)[0]).toMatchObject({ kind: 'committed', commit: VERSION });
  });

  it('opening a version and coming back does not say Updated to', async () => {
    const f = versionLoaders();
    open('/docs/demo/specs/a.md', f);
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    act(() => { navigate(`/docs/demo/specs/a.md?at=${VERSION}`); });
    await waitFor(() => expect(f.file).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByText(/Updated to/)).toBeNull();
    act(() => { navigate('/docs/demo/specs/a.md'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(here()).toBe('/docs/demo/specs/a.md');
    expect(screen.queryByText(/Updated to/)).toBeNull();
    expect(f.file).toHaveBeenCalledTimes(2);
  });

  it('the reader remounts at a version with the same blob, its version sha the version\'s', async () => {
    const f = versionLoaders();
    const spy = readerSpy();
    const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };
    const shas = (): (string | null)[] => spy.inputs.map((i) => i.document.version?.sha ?? null);
    open('/docs/demo/specs/a.md', f, spy.reader);
    await waitFor(() => expect(spy.inputs.length).toBe(1));
    expect(shas()).toEqual([COMMIT_A]);
    act(() => { navigate(`/docs/demo/specs/a.md?at=${VERSION}`); });
    await waitFor(() => expect(spy.inputs.length).toBe(2));
    expect(shas()).toEqual([COMMIT_A, VERSION]);
    expect(f.file).toHaveBeenCalledTimes(2);
    // Both bodies are now held, so the slot moves from one ok body to the other with no loading frame between: only the
    // body key can remount the reader here, with the same blob on both sides.
    act(() => { navigate('/docs/demo/specs/a.md'); });
    await waitFor(() => expect(spy.inputs.length).toBe(3));
    await settle();
    expect(shas()).toEqual([COMMIT_A, VERSION, COMMIT_A]);
    act(() => { navigate(`/docs/demo/specs/a.md?at=${VERSION}`); });
    await waitFor(() => expect(spy.inputs.length).toBe(4));
    await settle();
    expect(shas()).toEqual([COMMIT_A, VERSION, COMMIT_A, VERSION]);
    expect(spy.inputs.every((i) => i.document.version?.draft === false)).toBe(true);
    expect(f.file).toHaveBeenCalledTimes(2);
  });

  it('a version of a doc the listing does not hold is Not in this listing', async () => {
    const f = versionLoaders();
    open(`/docs/demo/specs/gone.md?at=${VERSION}`, f);
    expect(await screen.findByText(fillSentence(DOCS_VIEW_TEXT.missing, { short: shortCommit(COMMIT_A) }))).toBeInTheDocument();
    expect(f.file).not.toHaveBeenCalled();
    expect(f.raster).not.toHaveBeenCalled();
  });

  it('a version of a new draft opens nothing', async () => {
    const newDraft = entry('specs', 'n.md', { committed: null, draft: draftOf('added') });
    const tree = treeOk({ entries: [newDraft], drafts: holder() });
    expect(pinFor(tree, pageAt(`/docs/demo/specs/n.md?ref=ws/a&at=${VERSION}`))).toBeNull();
    const f = versionLoaders({ entries: [newDraft], drafts: holder() });
    open(`/docs/demo/specs/n.md?ref=ws/a&at=${VERSION}`, f);
    expect(await screen.findByText(DOCS_VIEW_TEXT.nothingToShow)).toBeInTheDocument();
    expect(f.file).not.toHaveBeenCalled();
  });

  it('a pending fragment for the latest is not spent on the version', () => {
    const f = versionLoaders();
    const onVersion = visitHook(f.loaders, `/docs/demo/specs/a.md?at=${VERSION}`);
    act(() => onVersion.result.current.setFragment('fn-1', '/docs/demo/specs/a.md'));
    expect(onVersion.result.current.pendingFragment).toBeNull();
    act(() => onVersion.result.current.setFragment('fn-2', `/docs/demo/specs/a.md?at=${VERSION}`));
    expect(onVersion.result.current.pendingFragment).toBe('fn-2');
    const onLatest = visitHook(f.loaders, '/docs/demo/specs/a.md');
    act(() => onLatest.result.current.setFragment('fn-3'));
    expect(onLatest.result.current.pendingFragment).toBe('fn-3');
    onLatest.rerender({ page: pageAt(`/docs/demo/specs/a.md?at=${VERSION}`) });
    expect(onLatest.result.current.pendingFragment).toBeNull();
  });

  it('a version at the listing\'s own commit survives a listing move with no re-read and no Updated to', async () => {
    const moved = treeOk({ commit: COMMIT_B, entries: [entry('specs', 'a.md', { committed: { kind: 'file', blob: BLOB_2, size: 9 } })] });
    const f = versionLoaders();
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(moved)));
    const { result } = visitHook(f.loaders, `/docs/demo/specs/a.md?at=${COMMIT_A}`);
    await act(async () => {});
    await waitFor(() => expect(result.current.file.s).toBe('ok'));
    expect(f.file).toHaveBeenCalledTimes(1);
    act(() => result.current.refreshManual());
    await waitFor(() => {
      const t = result.current.tree;
      expect(t?.s === 'ok' && t.answer.tree.ref.commit).toBe(COMMIT_B);
    });
    for (let i = 0; i < 6; i += 1) await act(async () => {});
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.file).toHaveBeenCalledTimes(1);
    expect(result.current.file).toMatchObject({ s: 'ok', pin: { kind: 'committed', commit: COMMIT_A } });
    expect(result.current.updatedTo).toBeNull();
  });

  it('a version page\'s non-text leaf skips the listing\'s size', async () => {
    const cap = DOCS_CLASS_CAP.other;
    const listed = entry('specs', 'data.bin', { committed: { kind: 'file', blob: BLOB_1, size: cap + 1 } });
    const f = versionLoaders({ entries: [listed] });
    const { container } = open(`/docs/demo/specs/data.bin?at=${VERSION}`, f);
    expect(await screen.findByText(fillSentence(DOCS_VIEW_TEXT.noPreview, {}))).toBeInTheDocument();
    expect(container.textContent).not.toContain(kib(cap + 1));
    expect(f.file).not.toHaveBeenCalled();
  });
});
