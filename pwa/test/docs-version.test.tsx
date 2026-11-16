// Docs W5b-2: the version view (the rich-docs spec's G6; the W5b plan's refinements (m) to (t)). A leaf page at `at=<sha>`
// opens the committed bytes at that commit, for a doc the served listing holds as a committed file: its pin carries the
// URL's commit and the listing's served ref (Task 17, refinement (p)), its body is keyed by that pin, and a word that would
// mean "the listing moved" is that commit's own answer. Every case renders `DocsScreen` (or the visit hook) over spies:
// `fakeLoaders` records every `file` and `raster` call, and a fake `ReaderDeps.mount` records what the reader was
// mounted with. Later tasks append their cases below the helpers. Placeholders only: project `demo`, branch `ws/a`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { DOCS_CLASS_CAP, entryView, resolveDocRef, type DocPin, type DocsPageLocation, type DocsShowOk } from '../../shared/docs';
import { DocsScreen } from '../src/screens/DocsScreen';
import { DocsBanners } from '../src/docs/DocsBanners';
import type { ReaderDeps } from '../src/docs/ReaderFrame';
import type { ReaderMount, ReaderMountInput } from '../src/docs/reader/bridge';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import {
  DOCS_BANNER_TEXT, DOCS_FAILURE_SENTENCE, DOCS_HEAD_TEXT, DOCS_VIEW_TEXT, ENTRY_BADGE_TEXT, fillSentence, kib, servedRefText,
  shareRefusalSentence, shortCommit,
} from '../src/docs/docsText';
import { exportLinkTarget } from '../src/docs/export/exportMarkdown';
import { pinFor, useDocsVisit } from '../src/docs/useDocsVisit';
import type { DocsFileAnswer, DocsLoaders } from '../src/docs/failures';
import type { FileSlot } from '../src/docs/useDocsVisit';
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
  vi.unstubAllGlobals();
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

  it.each([['git-failed', { step: 'show' }], ['docs-busy', {}]] as const)(
    'a version page whose read fails with %s shows that failure and Retry, not the missing-commit sentence',
    async (word, ctx) => {
      const f = versionLoaders();
      f.file.mockResolvedValue(failedAnswer(word, ctx));
      const { container } = open(`/docs/demo/specs/a.md?at=${VERSION}`, f);
      const own = fillSentence(DOCS_FAILURE_SENTENCE[word], ctx);
      await screen.findByText(own);
      // A word the visit retries by itself reads once more first: assert on the settled page.
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      expect(screen.getByText(own)).toBeInTheDocument();
      expect(container.querySelector(`[data-failure="${word}"]`)).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(container.textContent).not.toContain(fillSentence(DOCS_VIEW_TEXT.versionUnknownCommit, { short: shortCommit(VERSION) }));
    },
  );

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

/** matchMedia at `width`, as a real engine answers a min-width or max-width query (docs-compact-head.test.tsx#atWidth's form). */
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

const SHORT = shortCommit(VERSION);
const versionWords = (): string => fillSentence(DOCS_HEAD_TEXT.sourceVersion, { short: SHORT });
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };
/** `a.md` modified in the holder's worktree: in a ref view it opens its draft, with a committed version to offer. */
const drafted = (): ReturnType<typeof versionLoaders> => versionLoaders({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
const bannerIdsNow = (): string[] => [...document.querySelectorAll('[data-banner]')].map((n) => n.getAttribute('data-banner') ?? '');
/** The banner ids a screen at `url` draws once its leaf has settled; unmounts the screen. */
async function bannersAt(url: string, f: FakeLoaders): Promise<string[]> {
  open(url, f);
  expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
  await settle();
  const found = bannerIdsNow();
  cleanup();
  return found;
}

describe('the header and a banner name the version (refinement (q))', () => {
  it('the truth line names the version and links back to the latest', async () => {
    open(`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`, versionLoaders());
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    const truth = document.querySelector('.docs-truth') as HTMLElement;
    const source = truth.querySelector('.docs-truth-source') as HTMLElement;
    expect(source.textContent).toBe(versionWords());
    expect(source).toHaveAttribute('title', VERSION);
    const back = within(truth).getByRole('link', { name: DOCS_HEAD_TEXT.backToLatest });
    expect(back).toHaveClass('docs-hint-link');
    expect(back).toHaveAttribute('href', '/docs/demo/specs/a.md?ref=ws/a');
    expect(truth.querySelector('.docs-badge')).toBeNull();
  });

  it('the phone row\'s badge names the version', async () => {
    atWidth(412);
    open(`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`, versionLoaders());
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeInTheDocument();
    const where = document.querySelector('.docs-compact-where') as HTMLElement;
    expect(where.querySelector('.docs-badge')?.textContent).toBe(versionWords());
  });

  it('the version banner shows with Back to the latest', async () => {
    open(`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`, versionLoaders());
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    const banner = document.querySelector('[data-banner="version"]') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner).toHaveAttribute('data-tone', 'info');
    const served = servedRefText(treeOk().ref);
    expect(banner.querySelector('.docs-banner-text')?.textContent)
      .toBe(fillSentence(DOCS_BANNER_TEXT.version, { short: SHORT, served }));
    expect(within(banner).getByRole('link', { name: DOCS_HEAD_TEXT.backToLatest })).toHaveAttribute('href', '/docs/demo/specs/a.md?ref=ws/a');
  });

  it('the not-contained banner on a version says another branch, with no Re-list', async () => {
    const f = versionLoaders();
    f.file.mockImplementation(async (_project, pin) => {
      const r = fileResponse('# A');
      const commit = pin.kind === 'committed' ? pin.commit : COMMIT_A;
      return { s: 'ok', value: { ...r, show: { ...r.show, commit, blob: BLOB_1, onRef: 'not-contained' } } };
    });
    open(`/docs/demo/specs/a.md?at=${VERSION}`, f);
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    const banner = document.querySelector('[data-banner="not-contained"]') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.querySelector('.docs-banner-text')?.textContent)
      .toBe(fillSentence(DOCS_BANNER_TEXT.notContainedVersion, { short: SHORT, served: servedRefText(treeOk().ref) }));
    expect(within(banner).queryByRole('button', { name: DOCS_BANNER_TEXT.relist })).toBeNull();
    expect(screen.queryByRole('button', { name: DOCS_BANNER_TEXT.relist })).toBeNull();
  });

  it('no Open committed version on a version page', async () => {
    open('/docs/demo/specs/a.md?ref=ws/a', drafted());
    expect(await screen.findByRole('link', { name: DOCS_HEAD_TEXT.openCommitted })).toBeInTheDocument();
    cleanup();
    open(`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`, drafted());
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole('link', { name: DOCS_HEAD_TEXT.openCommitted })).toBeNull();
  });

  it.each([['the full head', 1280], ['the phone panel', 412]] as const)(
    'View on GitHub on a version page carries the may-differ caution (%s)', async (_what, width) => {
      atWidth(width);
      // The default listing serves origin's side, equal to itself: without `at` GitHub's note is null.
      const note = (): string | null => document.querySelector('.docs-action-note')?.textContent?.replace(/^≠/, '') ?? null;
      open('/docs/demo/specs/a.md?ref=ws/a', versionLoaders());
      expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
      await settle();
      expect(document.querySelector('a.docs-action[href^="https://github.com/"]')).not.toBeNull();
      expect(note()).toBeNull();
      cleanup();
      open(`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`, versionLoaders());
      expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
      await settle();
      expect(document.querySelector('a.docs-action[href^="https://github.com/"]')).not.toBeNull();
      expect(note()).toBe(DOCS_HEAD_TEXT.githubMayDiffer);
    },
  );

  it('a version page\'s draft badge is not drawn', async () => {
    open(`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`, drafted());
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    await settle();
    const truth = document.querySelector('.docs-truth') as HTMLElement;
    expect(truth.querySelector('.docs-truth-source')?.textContent).toBe(versionWords());
    expect(truth.querySelector('.docs-badge')).toBeNull();
  });

  it('a leaf that opens nothing still draws its badge in the truth line, as its phone row does', async () => {
    atWidth(412);
    const withheld = { section: 'specs', path: 'n.md', committed: null, draft: draftOf('untracked', { fp: null }) } as const;
    const tree = treeOk({ entries: [withheld], drafts: holder() });
    const want = entryView(withheld, tree.drafts, 'ref').badge;
    expect(want, 'the fixture withholds a new draft').not.toBeNull();
    open('/docs/demo/specs/n.md?ref=ws/a', fakeLoaders({ tree: okTree(tree) }));
    expect(await screen.findByText(DOCS_VIEW_TEXT.nothingToShow)).toBeInTheDocument();
    const row = document.querySelector('.docs-compact-where .docs-badge');
    const line = document.querySelector('.docs-more-panel .docs-truth .docs-badge');
    expect(row?.textContent).toBe(ENTRY_BADGE_TEXT[want!]);
    expect(line?.textContent).toBe(ENTRY_BADGE_TEXT[want!]);
    expect(document.querySelector('.docs-more-panel .docs-truth-source')?.textContent).toBe(DOCS_HEAD_TEXT.sourceNone);
  });

  it('a version page shows no banner about the latest\'s drafts', async () => {
    const entries = [
      entry('specs', 'a.md', { draft: draftOf('deleted', { kind: 'absent', fp: null, size: null }) }),
      entry('specs', 'b.md', { draft: draftOf('modified') }),
    ];
    // A ref view overlays only when the holder's base is the served commit, so the leaf's own `deleted` banner and the
    // base hint never stand together: one tree each.
    const loaders = (baseEqual: boolean): FakeLoaders => versionLoaders({ entries, drafts: holder(COMMIT_A, baseEqual) });
    const LATEST_DRAFTS = ['base-hint', 'default-hint', 'withheld', 'deleted', 'typechange', 'conflicted', 'draft-assets'];
    const ids = bannersAt;
    // The same pages without `at` say all they have to say about the drafts: the controls.
    expect(await ids('/docs/demo/specs/a.md?ref=ws/a', loaders(true))).toContain('deleted');
    expect(await ids('/docs/demo/specs/a.md?ref=ws/a', loaders(false))).toContain('base-hint');
    expect(await ids('/docs/demo/specs/a.md', loaders(true))).toContain('default-hint');
    for (const [url, baseEqual] of [
      [`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`, true],
      [`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`, false],
      [`/docs/demo/specs/a.md?at=${VERSION}`, true],
    ] as const) {
      const found = await ids(url, loaders(baseEqual));
      expect(found, url).toContain('version');
      for (const id of LATEST_DRAFTS) expect(found, `${url} ${id}`).not.toContain(id);
    }
    // A version page's own images are never drafts: the draft-images banner stays off whatever the page counts.
    const none: FileSlot = { s: 'none' };
    const tree = treeOk({ entries, drafts: holder(COMMIT_A, true) });
    render(<DocsBanners page={pageAt(`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`)} tree={tree} file={none} draftAssets={1} onRelist={vi.fn()} />);
    expect(bannerIdsNow()).toEqual(['version']);
  });

  it.each([
    ['withheld', draftOf('modified', { fp: null })],
    ['typechange', draftOf('typechange', { kind: 'symlink', fp: null })],
    ['conflicted', draftOf('conflicted')],
  ] as const)('a version page shows no %s banner', async (id, draft) => {
    const f = (): FakeLoaders => versionLoaders({ entries: [entry('specs', 'a.md', { draft })], drafts: holder() });
    // The same page without `at`, in a ref view the holder's base agrees with, draws it: the control.
    expect(await bannersAt('/docs/demo/specs/a.md?ref=ws/a', f())).toContain(id);
    const found = await bannersAt(`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`, f());
    expect(found).toContain('version');
    expect(found).not.toContain(id);
  });

  it('a version page keeps the banners about the listing\'s drafts snapshot', async () => {
    const f = (): FakeLoaders => versionLoaders({ drafts: { state: 'ambiguous', branch: 'main', candidates: ['/repo/wt/a', '/repo/wt/b'] } });
    expect(await bannersAt('/docs/demo/specs/a.md?ref=ws/a', f())).toContain('ambiguous');
    const found = await bannersAt(`/docs/demo/specs/a.md?ref=ws/a&at=${VERSION}`, f());
    expect(found).toEqual(expect.arrayContaining(['ambiguous', 'version']));
  });
});

describe('Export on a version page (refinement (t))', () => {
  const GH = 'https://github.com/example-org/example-repo';
  const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'b.md')] });
  const at = { section: 'specs' as const, path: 'a.md', tree };

  it('an Export of a version page writes its doc and repo links inert, in version-unmeasured\'s words', () => {
    const inert = { kind: 'inert', title: shareRefusalSentence('version-unmeasured', { short: shortCommit(VERSION) }, false) };
    expect(exportLinkTarget(at, VERSION, 'b.md')).toEqual(inert);
    // The repo href really is a repo link, so the row is the one the version arm covers.
    expect(resolveDocRef({ section: 'specs', path: 'a.md' }, '../../../README.md').kind).toBe('repo');
    expect(exportLinkTarget(at, VERSION, '../../../README.md')).toEqual(inert);
    expect(exportLinkTarget(at, VERSION, '#top')).toEqual({ kind: 'fragment', href: '#top' });
    expect(exportLinkTarget(at, VERSION, 'https://a.example/x')).toEqual({ kind: 'external', href: 'https://a.example/x' });
    // The listing's own commit: the same doc is a permalink.
    expect(exportLinkTarget(at, COMMIT_A, 'b.md'))
      .toEqual({ kind: 'permalink', href: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/b.md` });
  });
});
