// Docs W5 part 1, Task 9: the Docs screen (spec 2026-10-01 3.1, 4.2-4.4, 4.7, 5.5, 6.1; M4.R4, M5.3's leaf-routing
// half, M5.20; refinements (b), (c), (o), (q), (r)). One mount is one visit: the URL is parsed and canonicalised by
// replace, a directory's slash is the tree answer's call, a linked worktree is followed to its owner by replace (and
// `branch: null` says what it means), and each view renders the slots and the tree answer it is given. Every test
// injects its loaders and a parser that parses in this thread, except the one that proves the defaults' identities,
// which stubs `fetch`. Placeholders only: projects `demo`, `a`, `b`; branches `main`, `ws/a`; `/repo/demo`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  DOCS_CLASS_CAP, DOCS_RASTER_TYPES,
  type DocPin, type DocsEntry, type DocsFileResponse, type DocsIndexOk, type DocsIndexRow, type DocsProjectsResponse,
  type DocsTreeOk, type DraftsFacts,
} from '../../shared/docs';
import { DocsScreen } from '../src/screens/DocsScreen';
import { DocsLeaf } from '../src/docs/DocsLeaf';
import { DocsAssetContext } from '../src/docs/DocImage';
import { createFetchQueue } from '../src/docs/fetchQueue';
import { detachUrls } from '../src/docs/docsLinks';
import type { ReaderDeps } from '../src/docs/ReaderFrame';
import { pinFor, type DocsVisit, type FileSlot } from '../src/docs/useDocsVisit';
import { exportStateFor } from '../src/docs/DocsHead';
import { DOCS_FAILURE_SENTENCE, DOCS_HEAD_TEXT, DOCS_PAGE_INVALID_SENTENCE, EXPORT_WAIT_TEXT, SHARE_EXPORT_CLAUSE, fillSentence, shortCommit } from '../src/docs/docsText';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { DOCS_RENDER_GATE_BYTES, HIGHLIGHT_PAGE_WORKER_MS } from '../src/lib/markdownLimits';
import type { DocsFileAnswer, DocsLoaders, DocsRasterAnswer } from '../src/docs/failures';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import { HighlighterContext } from '../src/lib/highlighterContext';
import type { Highlighter } from '../src/lib/highlightProtocol';
import type { HighlightClock } from '../src/lib/highlightStore';
import { docsRunner, type MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import {
  BLOB_1, BLOB_2, COMMIT_A, COMMIT_B, FP_1, RAN, draftOf, entry, failedAnswer, fakeLoaders, fetchFailed, fileResponse, holder,
  okFile, okRefresh, okTree, pageAt, treeOk, treeResponse, type FakeLoaders,
} from './docsFixtures';
import { inThreadContext, inThreadHighlighter, syncTestStore, withSyncHighlight } from './highlightTestStore';

/** Parses in this thread, as the worker would. */
const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

/** The screen under the live location, as the app's `docs` arm mounts it (one mount across navigations). */
function Routed(p: { readonly loaders: DocsLoaders; readonly parser?: MarkdownParser }): ReactNode {
  const { path, search } = useLocation();
  return <DocsScreen path={path} search={search} loaders={p.loaders} parser={p.parser ?? parser} />;
}

function open(url: string, f: FakeLoaders, withParser?: MarkdownParser): ReturnType<typeof render> {
  navigate(url);
  return render(<Routed loaders={f.loaders} parser={withParser} />);
}

const here = (): string => location.pathname + location.search;

/** A file answer of `contentClass` for `path`, its text sent as utf8. */
function fileAs(path: string, text: string, contentClass: DocsFileResponse['contentClass']): DocsFileAnswer {
  const r = fileResponse(text);
  return { s: 'ok', value: { ...r, contentClass, show: { ...r.show, path, size: text.length } } };
}

/** A PNG's own magic from L0's table (never spelled here) and two bytes of body. */
const pngBytes = (): Uint8Array<ArrayBuffer> => new Uint8Array([...DOCS_RASTER_TYPES.png.magic[0][0].bytes, 0, 255]);
const okPng = (): DocsRasterAnswer => ({ s: 'ok', value: { bytes: pngBytes(), mime: 'image/png' } });

/** Loaders whose `file` answers by path (an unknown path answers `absent-path`). */
function byPath(tree: DocsTreeOk, files: Readonly<Record<string, DocsFileAnswer>>): FakeLoaders {
  const f = fakeLoaders({ tree: okTree(tree) });
  f.file.mockImplementation(async (_project: string, pin: DocPin) => files[pin.path] ?? failedAnswer('absent-path'));
  f.raster.mockImplementation(async () => okPng());
  return f;
}

const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const SVG_DATA = 'data:image/svg+xml;base64,' + btoa(SVG_TEXT);

beforeEach(() => {
  vi.mocked(URL.createObjectURL).mockClear();
});

afterEach(() => {
  cleanup();
  clearAuthLost();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('canonical URLs are fixed by replace (spec 3.1, M4.R4)', () => {
  it.each([
    ['/docs/', '/docs'],
    ['/docs/demo/', '/docs/demo'],
    ['/docs/demo/specs/', '/docs/demo/specs'],
  ])('%s replace-navigates to %s, with no history entry', async (from, to) => {
    const f = fakeLoaders();
    navigate(from);
    const before = history.length;
    render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(here()).toBe(to));
    expect(history.length).toBe(before);
  });

  it('a directory reached without its slash replace-navigates to the slash form, keeping the ref', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'd/x.md')] })) });
    navigate('/docs/demo/specs/d?ref=ws/a');
    const before = history.length;
    render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(here()).toBe('/docs/demo/specs/d/?ref=ws/a'));
    expect(history.length).toBe(before);
    expect(await screen.findByText('x.md')).toBeInTheDocument();
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it('a leaf reached with a slash replace-navigates to the slash-less form', async () => {
    const f = fakeLoaders();
    navigate('/docs/demo/specs/a.md/');
    const before = history.length;
    render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(here()).toBe('/docs/demo/specs/a.md'));
    expect(history.length).toBe(before);
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
  });

  it.each([
    ['/docs/demo/specs/a.md?commit=' + COMMIT_A, 'commit-in-page'],
    ['/docs/demo?x=1', 'unknown-param'],
    ['/docs/demo/nope', 'bad-section'],
    ['/docs/demo/specs/a%2Fb.md', 'encoded-slash'],
  ] as const)('%s renders its parse sentence (%s) and a link to the index, and asks nothing', async (url, why) => {
    const f = fakeLoaders();
    open(url, f);
    expect(screen.getByText(DOCS_PAGE_INVALID_SENTENCE[why])).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Docs index' });
    expect(link).toHaveAttribute('href', '/docs');
    expect(f.tree).not.toHaveBeenCalled();
    expect(f.projects).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(here()).toBe('/docs');
  });
});

describe('the canonical fix keeps the #fragment (review M3)', () => {
  it.each([
    ['a leaf reached with a slash', '/docs/demo/specs/b.md/#sec', '/docs/demo/specs/b.md'],
    ['a percent-encoded ref', '/docs/demo/specs/b.md?ref=ws%2Fa#sec', '/docs/demo/specs/b.md?ref=ws/a'],
    ['a directory reached without its slash', '/docs/demo/specs/d?ref=ws/a#sec', '/docs/demo/specs/d/?ref=ws/a'],
  ])('%s: the address bar ends at the canonical URL and still carries #sec', async (_name, from, to) => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'b.md'), entry('specs', 'd/x.md')] })) });
    history.pushState(null, '', from);
    render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(here()).toBe(to));
    expect(location.hash).toBe('#sec');
  });
});

describe('a repeated query key, on the screen (review M4)', () => {
  it('?ref=a&ref=b shows the repeated-param sentence and a link to the index, and asks for no tree', () => {
    const f = fakeLoaders();
    open('/docs/demo/specs/a.md?ref=a&ref=b', f);
    expect(screen.getByText(DOCS_PAGE_INVALID_SENTENCE['repeated-param'])).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Docs index' })).toHaveAttribute('href', '/docs');
    expect(f.tree).not.toHaveBeenCalled();
    expect(f.projects).not.toHaveBeenCalled();
    expect(f.file).not.toHaveBeenCalled();
  });
});

describe('a linked worktree is followed to its owner by replace (spec 4.7, M4.R4, refinement (c))', () => {
  const owned = (ctx: Record<string, unknown>, word = 'linked-worktree'): FakeLoaders => {
    const f = fakeLoaders();
    f.tree.mockImplementation(async (project: string) =>
      project === 'b' ? failedAnswer(word, ctx) : okTree(treeOk({ entries: [entry('specs', 'x.md')] })));
    return f;
  };

  it("owner 'a' with branch 'ws/a': the same page in a at ref ws/a, and history.length is unchanged", async () => {
    const f = owned({ owner: 'a', branch: 'ws/a' });
    navigate('/docs/b/specs/x.md');
    const before = history.length;
    render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(here()).toBe('/docs/a/specs/x.md?ref=ws/a'));
    expect(history.length).toBe(before);
    await waitFor(() => expect(f.tree).toHaveBeenLastCalledWith('a', { kind: 'bare', name: 'ws/a' }));
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
  });

  it("branch null: the owner's default view, saying the checkout is not on a named branch or could not be read", async () => {
    const f = owned({ owner: 'a', branch: null });
    open('/docs/b/specs/x.md?ref=ws/a', f);
    await waitFor(() => expect(here()).toBe('/docs/a/specs/x.md'));
    expect(await screen.findByText(
      "That checkout is not on a named branch, or its branch could not be read; showing a's default branch.",
    )).toBeInTheDocument();
    expect(screen.queryByText(/detached/)).toBeNull();
    expect(f.tree).toHaveBeenLastCalledWith('a', null);
  });

  it("a branch Docs cannot address: the owner's default view, saying so", async () => {
    const f = owned({ owner: 'a', branch: 'a..b' });
    open('/docs/b/specs/x.md', f);
    await waitFor(() => expect(here()).toBe('/docs/a/specs/x.md'));
    expect(await screen.findByText(
      "That checkout's branch a..b is not one Docs can address; showing a's default branch.",
    )).toBeInTheDocument();
  });

  it('a shared-repo answer naming only its owner keeps the page\'s own ref', async () => {
    const f = owned({ owner: 'a' }, 'shared-repo');
    open('/docs/b?ref=main', f);
    await waitFor(() => expect(here()).toBe('/docs/a?ref=main'));
  });

  it('owner null renders the sentence only: no navigation, no second GET', async () => {
    const f = owned({ owner: null, branch: 'ws/a' });
    open('/docs/b/specs/x.md', f);
    expect(await screen.findByText(DOCS_FAILURE_SENTENCE['linked-worktree'])).toBeInTheDocument();
    expect(here()).toBe('/docs/b/specs/x.md');
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it.each([['linked-worktree', { branch: 'ws/a' }], ['shared-repo', {}]])(
    'an owner ABSENT from a %s answer (not null) renders the sentence only: no navigation, no second GET (review M4)',
    async (word, ctx) => {
      const f = owned(ctx, word);
      open('/docs/b/specs/x.md', f);
      expect(await screen.findByText(DOCS_FAILURE_SENTENCE[word as 'linked-worktree'])).toBeInTheDocument();
      expect(screen.queryByText(/Opening/)).toBeNull();
      expect(here()).toBe('/docs/b/specs/x.md');
      expect(f.tree).toHaveBeenCalledTimes(1);
    },
  );

  const LOOP = 'Docs did not follow it: the owner named for this folder leads back to this folder.';
  const NOTE = "That checkout is not on a named branch, or its branch could not be read; showing a's default branch.";

  it('the redirect note is absent on another page (review M4)', async () => {
    const f = owned({ owner: 'a', branch: null });
    open('/docs/b/specs/x.md?ref=ws/a', f);
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    act(() => { navigate('/docs/a/specs'); });
    expect(await screen.findByText('x.md')).toBeInTheDocument();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('the redirect note does not come back when the reader returns to the URL it was written for (review M1)', async () => {
    const f = owned({ owner: 'a', branch: null });
    open('/docs/b/specs/x.md?ref=ws/a', f);
    await waitFor(() => expect(here()).toBe('/docs/a/specs/x.md'));
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    act(() => { navigate('/docs/a/specs'); });
    expect(await screen.findByText('x.md')).toBeInTheDocument();
    act(() => { navigate('/docs/a/specs/x.md'); });
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('the canonical fix and the owner redirect carry #sec too (review M3)', async () => {
    const f = owned({ owner: 'a', branch: 'ws/a' });
    history.pushState(null, '', '/docs/b/specs/x.md#sec');
    render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(here()).toBe('/docs/a/specs/x.md?ref=ws/a'));
    expect(location.hash).toBe('#sec');
  });

  it('two projects that name each other as owner end in a sentence, not in a loop (review M2)', async () => {
    const f = fakeLoaders();
    f.tree.mockImplementation(async (project: string) =>
      failedAnswer('linked-worktree', { owner: project === 'a' ? 'b' : 'a', branch: 'main' }));
    open('/docs/a/specs/x.md', f);
    expect(await screen.findByText(LOOP)).toBeInTheDocument();
    expect(screen.getByText(DOCS_FAILURE_SENTENCE['linked-worktree'])).toBeInTheDocument();
    expect(screen.queryByText(/Opening/)).toBeNull();
    expect(here()).toBe('/docs/b/specs/x.md?ref=main');
    expect(f.tree).toHaveBeenCalledTimes(3);
  });

  it('a later, separate visit to a page that was redirected from is redirected again: the chain ends when the URL leaves it (review M2)', async () => {
    const f = owned({ owner: 'a', branch: 'ws/a' });
    open('/docs/b/specs/x.md', f);
    await waitFor(() => expect(here()).toBe('/docs/a/specs/x.md?ref=ws/a'));
    act(() => { navigate('/docs/a/specs?ref=ws/a'); });
    expect(await screen.findByText('x.md')).toBeInTheDocument();
    act(() => { navigate('/docs/b/specs/x.md'); });
    await waitFor(() => expect(here()).toBe('/docs/a/specs/x.md?ref=ws/a'));
    expect(screen.queryByText(LOOP)).toBeNull();
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
  });

  it.each([
    ['linked-worktree', { owner: 'a', branch: 'main' }, '/docs/a/specs/x.md?ref=main', 1],
    ['shared-repo', { owner: 'a' }, '/docs/a/specs/x.md?ref=main', 1],
    ['linked-worktree', { owner: 'a', branch: 'main' }, '/docs/a/specs/x.md', 2],
  ])('a %s answer %j naming the page\'s own project at the same ref is a sentence, never "Opening a…" (%s; review M2)',
    async (word, ctx, url, gets) => {
      const f = fakeLoaders();
      f.tree.mockResolvedValue(failedAnswer(word, ctx));
      open(url, f);
      expect(await screen.findByText(LOOP)).toBeInTheDocument();
      expect(screen.queryByText(/Opening/)).toBeNull();
      expect(f.tree).toHaveBeenCalledTimes(gets);
    });
});

/** The index fixture (refinement (r)): every state, a duplicate pair, a no-docs pair, both footers. */
function indexAnswer(): DocsProjectsResponse {
  const ready = (project: string, over: Partial<DocsIndexRow> = {}): DocsIndexRow => ({
    project, state: 'ready', github: { state: 'none' }, default: { name: 'main', via: 'default:origin-head', commit: COMMIT_B },
    sections: { specs: 1, plans: 1, 'product-design': 1, conventions: 1 }, ...over,
  });
  const index: DocsIndexOk = {
    v: 1, verb: 'docs-index', ok: true, elapsedMs: 5, unlisted: 2, unwalked: 1,
    duplicates: [{ repoKey: 'k1', projects: ['a', 'b'] }],
    projects: [
      { project: 'wt', state: 'linked-worktree', github: { state: 'none' }, owner: 'a', branch: 'ws/a' },
      ready('b', {
        repoKey: 'k1', sections: { specs: 12, plans: 40, 'product-design': 3, conventions: 0 },
        fetch: { okAgeMs: 300000, lastOutcome: 'ok' },
      }),
      { project: 'pc', state: 'partial-clone', github: { state: 'none' } },
      ready('a', { repoKey: 'k1', sections: { specs: null, plans: 1, 'product-design': 0, conventions: 0 }, fetch: { okAgeMs: null, lastOutcome: 'fetch-transport' } }),
      { project: 'orphan', state: 'linked-worktree', github: { state: 'none' }, owner: null, branch: null },
      { project: 'plain', state: 'not-a-git-repo', github: { state: 'none' }, sectionsOnDisk: ['specs'] },
      { project: 'nd', state: 'no-default-branch', github: { state: 'none' } },
      { project: 'ru', state: 'repo-unreadable', github: { state: 'none' } },
      ready('empty', { sections: { specs: 0, plans: 0, 'product-design': 0, conventions: 0 } }),
      { project: 'junk', state: 'not-a-git-repo', github: { state: 'none' }, sectionsOnDisk: [] },
    ],
  };
  return { ok: true, index, cacheAgeMs: 1234 };
}

function openIndex(): FakeLoaders {
  const f = fakeLoaders();
  f.projects.mockResolvedValue({ s: 'ok', value: indexAnswer() });
  open('/docs', f);
  return f;
}

const mainRowNames = (): string[] =>
  [...document.querySelectorAll('.docs-index > .docs-rows .docs-row-name')].map((n) => n.textContent ?? '');

describe('the index (spec 4.4, refinement (r))', () => {
  it('says what it lists, then ready rows by name, then the rest by name; no-docs projects fold under one line', async () => {
    openIndex();
    expect(await screen.findByText("Each project's default branch, read from the fleet box.")).toBeInTheDocument();
    expect(mainRowNames()).toEqual(['a', 'b', 'nd', 'orphan', 'pc', 'plain', 'ru', 'wt']);
    const fold = document.querySelector('details.docs-nodocs') as HTMLElement;
    expect(within(fold).getByText('Projects with no docs (2)')).toBeInTheDocument();
    expect([...fold.querySelectorAll('.docs-row-name')].map((n) => n.textContent)).toEqual(['empty', 'junk']);
  });

  it('a ready row: default branch and short commit, the four counts, the fetch age, and its duplicate', async () => {
    openIndex();
    const b = (await screen.findByText('b')).closest('.docs-row') as HTMLElement;
    expect(b).toHaveTextContent(`main · ${COMMIT_B.slice(0, 8)}`);
    expect(b).toHaveTextContent('12 specs · 40 plans · 3 design · 0 conventions');
    expect(b).toHaveTextContent('fetched 5m ago');
    expect(b).toHaveTextContent('same repository as a');
    const a = screen.getByText('a', { selector: '.docs-row-name' }).closest('.docs-row') as HTMLElement;
    expect(a).toHaveTextContent('? specs · 1 plan · 0 design · 0 conventions');
    expect(a).toHaveTextContent('never fetched');
    expect(a).toHaveTextContent('same repository as b');
    expect(document.body).not.toHaveTextContent('1234');
  });

  it('other states in words; "part of <owner>" links the owner', async () => {
    openIndex();
    await screen.findByText('pc');
    const state = (name: string): string =>
      (screen.getByText(name, { selector: '.docs-row-name' }).closest('.docs-row') as HTMLElement)
        .querySelector('.docs-row-state')?.textContent ?? '';
    expect(state('pc')).toBe('partial clone');
    expect(state('plain')).toBe('not a git repository');
    expect(state('nd')).toBe('no default branch');
    expect(state('ru')).toBe('unreadable');
    expect(state('orphan')).toBe('part of a repository outside the projects folder');
    const owner = screen.getByRole('link', { name: 'part of a' });
    expect(owner).toHaveAttribute('href', '/docs/a');
    fireEvent.click(owner);
    expect(here()).toBe('/docs/a');
  });

  it('the two footers, singular and plural', async () => {
    openIndex();
    expect(await screen.findByText('2 folders not listed (names Docs cannot address).')).toBeInTheDocument();
    expect(screen.getByText('1 project not checked (Docs ran out of time listing them).')).toBeInTheDocument();
  });

  it('the filter narrows the rows by name', async () => {
    openIndex();
    await screen.findByText('pc');
    // D-5502: the box says what it is on screen too (WCAG 3.3.2), not only to a screen reader.
    expect(screen.getByRole('searchbox', { name: 'Filter projects' })).toHaveAttribute('placeholder', 'Filter projects');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter projects' }), { target: { value: 'pla' } });
    expect(mainRowNames()).toEqual(['plain']);
  });

  it("a ready row opens the project's default view; the index is read once per visit", async () => {
    const f = openIndex();
    fireEvent.click((await screen.findByText('b')).closest('button') as HTMLElement);
    expect(here()).toBe('/docs/b');
    act(() => { navigate('/docs'); });
    expect(await screen.findByText("Each project's default branch, read from the fleet box.")).toBeInTheDocument();
    expect(f.projects).toHaveBeenCalledTimes(1);
  });
});

describe('the project page (spec 4.4)', () => {
  it('four section rows in DOC_SECTIONS order; absent and not-a-directory say so at the short commit', async () => {
    const t = treeOk();
    t.sections[2] = { ...t.sections[2]!, state: 'absent', count: 0 };
    t.sections[3] = { ...t.sections[3]!, state: 'not-a-directory', count: 0 };
    open('/docs/demo', fakeLoaders({ tree: okTree(t) }));
    await screen.findByText('specs');
    const rows = [...document.querySelectorAll('.docs-project .docs-row')];
    expect(rows.map((r) => r.querySelector('.docs-row-name')?.textContent)).toEqual(['specs', 'plans', 'design', 'conventions']);
    expect(rows[0]).toHaveTextContent('docs/superpowers/specs');
    expect(rows[2]).toHaveTextContent(`not in this repository at ${COMMIT_A.slice(0, 8)}`);
    expect(rows[3]).toHaveTextContent(`is not a directory at ${COMMIT_A.slice(0, 8)}`);
    expect(rows[2]!.tagName).toBe('DIV');
  });

  it('a section row keeps the ref through docsLocation', async () => {
    open('/docs/demo?ref=ws/a', fakeLoaders());
    fireEvent.click((await screen.findByText('plans')).closest('button') as HTMLElement);
    expect(here()).toBe('/docs/demo/plans?ref=ws/a');
  });

  it('a ref view counts drafts and withheld drafts per section; the default view does not', async () => {
    const entries: DocsEntry[] = [
      entry('specs', 'a.md', { draft: draftOf('modified') }),
      { section: 'specs', path: 'n.md', committed: null, draft: draftOf('untracked') },
      entry('specs', 'w.md', { draft: draftOf('modified', { kind: 'unreadable', fp: null }) }),
    ];
    open('/docs/demo?ref=main', fakeLoaders({ tree: okTree(treeOk({ entries, drafts: holder() })) }));
    const specs = (await screen.findByText('specs')).closest('.docs-row') as HTMLElement;
    expect(specs).toHaveTextContent('2 drafts · 1 withheld');
    cleanup();
    open('/docs/demo', fakeLoaders({ tree: okTree(treeOk({ entries, drafts: holder() })) }));
    const plain = (await screen.findByText('specs')).closest('.docs-row') as HTMLElement;
    expect(plain).not.toHaveTextContent('draft');
  });

  it('notes for unlisted names and for drafts.opaque', async () => {
    const t = treeOk({ drafts: { ...(holder() as Extract<DraftsFacts, { state: 'holder' }>), opaque: ['vendor/x'] } });
    t.unlisted = { count: 3, byReason: { 'unsafe-char': 3 } };
    open('/docs/demo', fakeLoaders({ tree: okTree(t) }));
    expect(await screen.findByText('3 files not listed (names Docs cannot address).')).toBeInTheDocument();
    expect(screen.getByText('Drafts inside nested repositories are not shown: vendor/x.')).toBeInTheDocument();
  });
});

describe('section and directory pages (spec 4.4)', () => {
  const entries: DocsEntry[] = [
    entry('specs', '2026-01-01-a.md'),
    entry('specs', '2026-02-01-b.md', { draft: draftOf('modified') }),
    entry('specs', 'old/x.md'),
    entry('specs', 'old/y.md'),
    entry('specs', 'l.md', { committed: { kind: 'symlink', blob: '1'.repeat(40), size: 4 } }),
  ];

  it('folders first with counts, then files newest first, each with its badge and size; taps keep the ref', async () => {
    open('/docs/demo/specs?ref=main', fakeLoaders({ tree: okTree(treeOk({ entries, drafts: holder() })) }));
    await screen.findByText('old/');
    const rows = [...document.querySelectorAll('.docs-listing .docs-row')];
    expect(rows.map((r) => r.querySelector('.docs-row-name')?.textContent)).toEqual(['old/', 'l.md', '2026-02-01-b.md', '2026-01-01-a.md']);
    expect(rows[0]).toHaveTextContent('2');
    expect(rows[2]).toHaveTextContent('draft · modified');
    expect(rows[2]).toHaveTextContent('1 KiB');
    expect(rows[1]).toHaveTextContent('symlink');
    fireEvent.click(rows[0] as HTMLElement);
    expect(here()).toBe('/docs/demo/specs/old/?ref=main');
    expect(await screen.findByText('y.md')).toBeInTheDocument();
    fireEvent.click(screen.getByText('y.md').closest('button') as HTMLElement);
    expect(here()).toBe('/docs/demo/specs/old/y.md?ref=main');
  });

  it('the filter narrows the listing', async () => {
    open('/docs/demo/specs', fakeLoaders({ tree: okTree(treeOk({ entries })) }));
    await screen.findByText('old/');
    expect(screen.getByRole('searchbox', { name: 'Filter this listing' })).toHaveAttribute('placeholder', 'Filter this listing');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter this listing' }), { target: { value: '-b.' } });
    expect([...document.querySelectorAll('.docs-listing .docs-row-name')].map((n) => n.textContent)).toEqual(['2026-02-01-b.md']);
  });

  it('a committed symlink leaf says it is not followed, and asks for no file', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries })) });
    open('/docs/demo/specs/l.md', f);
    expect(await screen.findByText('This is a symbolic link in the repository; Docs does not follow it.')).toBeInTheDocument();
    expect(f.file).not.toHaveBeenCalled();
  });

  it('a path not in the listing says so at the short commit', async () => {
    open('/docs/demo/specs/zzz.md', fakeLoaders({ tree: okTree(treeOk({ entries })) }));
    expect(await screen.findByText(`Not in this listing at ${COMMIT_A.slice(0, 8)}.`)).toBeInTheDocument();
    expect(screen.queryByText('Open the draft view')).toBeNull();
  });

  it('a draft-only file in the default view: not in this listing, and the default-view hint opens it at refs/heads/<branch>', async () => {
    const drafted: DocsEntry[] = [...entries, { section: 'specs', path: 'n.md', committed: null, draft: draftOf('untracked') }];
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: drafted, drafts: holder() })) });
    open('/docs/demo/specs/n.md', f);
    expect(await screen.findByText(`Not in this listing at ${COMMIT_A.slice(0, 8)}.`)).toBeInTheDocument();
    expect(screen.getByText('2 uncommitted docs in main checkout on main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the draft view' })).toHaveAttribute('href', '/docs/demo/specs/n.md?ref=refs/heads/main');
    expect(f.file).not.toHaveBeenCalled();
  });
});

describe('the leaf by content class (M5.3, leaf-routing half)', () => {
  it('markdown: article.doc-body from the committed pin', async () => {
    const f = fakeLoaders();
    const { container } = open('/docs/demo/specs/a.md', f);
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    expect(container.querySelector('.docs-leaf article.doc-body')).not.toBeNull();
    expect(f.file).toHaveBeenCalledTimes(1);
    expect(f.file.mock.calls[0]![1]).toMatchObject({ kind: 'committed', commit: COMMIT_A, section: 'specs', path: 'a.md' });
  });

  it('raster: ONE DocImage through loaders.raster, an object URL, and never loaders.file', async () => {
    const f = byPath(treeOk({ entries: [entry('specs', 'x.png')] }), {});
    const { container } = open('/docs/demo/specs/x.png', f);
    await waitFor(() => expect(container.querySelectorAll('.docs-leaf img')).toHaveLength(1));
    expect(container.querySelector('.docs-leaf img')?.getAttribute('src')).toMatch(/^blob:/);
    expect(f.raster).toHaveBeenCalledTimes(1);
    expect(f.file).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('svg: the data: image (never blob:, never /api/), with Source and Download', async () => {
    const f = byPath(treeOk({ entries: [entry('specs', 'd.svg')] }), { 'd.svg': fileAs('d.svg', SVG_TEXT, 'svg') });
    const { container } = open('/docs/demo/specs/d.svg', f);
    await waitFor(() => expect(container.querySelector('img[src^="data:image/svg+xml;base64,"]')).not.toBeNull());
    expect(container.querySelector('.docs-leaf img')?.getAttribute('src')).toBe(SVG_DATA);
    expect(container.querySelector('img[src^="blob:"], img[src^="/api/"]')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(container.querySelector('pre.doc-plain')?.textContent).toBe(SVG_TEXT);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it.each(['/docs/demo/specs/m.html', '/docs/demo/specs/m.html?ref=main&frame=full'])(
    'html (%s): the stand-in with its size, Source and Download, and no frame of any kind', async (url) => {
      const html = '<p>mock</p><script>x()</script>';
      const f = byPath(treeOk({ entries: [entry('specs', 'm.html')] }), { 'm.html': fileAs('m.html', html, 'html') });
      const { container } = open(url, f);
      expect(await screen.findByText('HTML mockups open in a later release; Source shows the file and Download saves it.')).toBeInTheDocument();
      expect(screen.getByText('Size: 1 KiB')).toBeInTheDocument();
      expect(container.querySelector('iframe, frame, object, embed, [srcdoc]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Source' }));
      expect(container.querySelector('pre.doc-plain')?.textContent).toBe(html);
      expect(container.querySelector('iframe, frame, object, embed, [srcdoc], script')).toBeNull();
      expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    });

  it('text with a registered grammar (x.ts) is highlighted through CodeBlock; x.txt is pre.doc-plain', async () => {
    const f = byPath(treeOk({ entries: [entry('specs', 'x.ts'), entry('specs', 'x.txt')] }), {
      'x.ts': fileAs('x.ts', 'const a: number = 1;', 'text'),
      'x.txt': fileAs('x.txt', 'plain words', 'text'),
    });
    navigate('/docs/demo/specs/x.ts');
    const { container } = render(withSyncHighlight(<Routed loaders={f.loaders} />));
    await waitFor(() => expect(container.querySelector('.docs-leaf .code-block')).not.toBeNull());
    expect(container.querySelector('.code-block-lang')?.textContent).toBe('TypeScript');
    expect(container.querySelector('.code-block code.hljs .hljs-keyword')?.textContent).toBe('const');
    act(() => { navigate('/docs/demo/specs/x.txt'); });
    await waitFor(() => expect(container.querySelector('.docs-leaf pre.doc-plain')?.textContent).toBe('plain words'));
    expect(container.querySelector('.docs-leaf .code-block')).toBeNull();
  });

  it('other (x.pdf): "No preview (N KiB)" with Download, and no file or raster request', async () => {
    const f = byPath(treeOk({ entries: [entry('specs', 'x.pdf', { committed: { kind: 'file', blob: '1'.repeat(40), size: 3000 } })] }), {});
    open('/docs/demo/specs/x.pdf', f);
    expect(await screen.findByText('No preview (3 KiB)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(f.file).not.toHaveBeenCalled();
    expect(f.raster).not.toHaveBeenCalled();
  });

  it('Download saves the bytes as an octet-stream named after the leaf', async () => {
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record(this: HTMLAnchorElement) {
      clicks.push(this);
    });
    const f = byPath(treeOk({ entries: [entry('specs', 'x.pdf')] }), { 'x.pdf': fileAs('x.pdf', 'bytes', 'other') });
    open('/docs/demo/specs/x.pdf', f);
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0]!.download).toBe('x.pdf');
    expect(f.file).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('application/octet-stream');
  });

  it('a listed size over DOCS_CLASS_CAP is the too-large sentence with zero file requests (spec 4.4, 6.1)', async () => {
    const big = DOCS_CLASS_CAP.markdown + 1;
    const f = byPath(treeOk({ entries: [
      entry('specs', 'a.md', { committed: { kind: 'file', blob: '1'.repeat(40), size: big } }),
      entry('specs', 'p.png', { committed: { kind: 'file', blob: '2'.repeat(40), size: DOCS_CLASS_CAP.raster + 1 } }),
    ] }), {});
    open('/docs/demo/specs/a.md', f);
    expect(await screen.findByText('This file is 2049 KiB; Docs shows files of this kind up to 2048 KiB.')).toBeInTheDocument();
    expect(f.file).not.toHaveBeenCalled();
    act(() => { navigate('/docs/demo/specs/p.png'); });
    expect(await screen.findByText('Image not loaded: it is 2049 KiB; Docs shows images up to 2048 KiB')).toBeInTheDocument();
    expect(f.raster).not.toHaveBeenCalled();
  });

  it('a file failure replaces the body with its sentence', async () => {
    const f = byPath(treeOk(), {});
    open('/docs/demo/specs/a.md', f);
    expect(await screen.findByText(DOCS_FAILURE_SENTENCE['absent-path'])).toBeInTheDocument();
  });
});

describe('SVG is a data: image in Markdown and as a leaf (M5.20)', () => {
  it('![](d.svg) in a Markdown leaf renders img[src^="data:image/svg+xml;base64,"], never blob: or /api/', async () => {
    const f = byPath(treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'd.svg')] }), {
      'a.md': fileAs('a.md', '# A\n\n![d](d.svg)\n', 'markdown'),
      'd.svg': fileAs('d.svg', SVG_TEXT, 'svg'),
    });
    const { container } = open('/docs/demo/specs/a.md', f);
    await waitFor(() => expect(container.querySelector('article img')?.getAttribute('src')).toBe(SVG_DATA));
    expect(container.querySelector('img[src^="blob:"], img[src*="/api/"]')).toBeNull();
    act(() => { navigate('/docs/demo/specs/d.svg'); });
    await waitFor(() => expect(container.querySelector('.docs-leaf img')?.getAttribute('src')).toBe(SVG_DATA));
    expect(container.querySelector('img[src^="blob:"], img[src*="/api/"]')).toBeNull();
  });
});

describe('one mount is one visit', () => {
  it('project, section and leaf share one tree GET', async () => {
    const f = fakeLoaders();
    open('/docs/demo', f);
    await screen.findByText('specs');
    act(() => { navigate('/docs/demo/specs'); });
    await screen.findByText('a.md');
    act(() => { navigate('/docs/demo/specs/a.md'); });
    await screen.findByRole('heading', { name: 'A' });
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it('the default parser prewarms docsRunner once per mount; an injected parser does not', async () => {
    const prewarm = vi.spyOn(docsRunner, 'prewarm').mockImplementation(() => {});
    const f = fakeLoaders();
    navigate('/docs/demo');
    const { rerender } = render(<DocsScreen path="/docs/demo" search="" loaders={f.loaders} />);
    rerender(<DocsScreen path="/docs/demo" search="" loaders={f.loaders} />);
    expect(prewarm).toHaveBeenCalledTimes(1);
    cleanup();
    render(<DocsScreen path="/docs/demo" search="" loaders={f.loaders} parser={parser} />);
    expect(prewarm).toHaveBeenCalledTimes(1);
  });

  it('with the default loaders, a re-render makes no second request: the tree, the file and the image once each', async () => {
    vi.spyOn(docsRunner, 'prewarm').mockImplementation(() => {});
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'd.png')] });
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const fetchSpy = vi.fn(async (url: RequestInfo | URL): Promise<Response> => {
      const u = String(url);
      if (u.startsWith('/api/docs/demo/tree')) return json(treeResponse(tree));
      if (u.includes('path=a.md')) return json(fileResponse('# A\n\n![d](d.png)\n'));
      if (u.includes('path=d.png')) return new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    navigate('/docs/demo/specs/a.md');
    const { rerender, container } = render(<DocsScreen path="/docs/demo/specs/a.md" search="" parser={parser} />);
    await waitFor(() => expect(container.querySelector('article img')?.getAttribute('src')).toMatch(/^blob:/));
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    rerender(<DocsScreen path="/docs/demo/specs/a.md" search="" parser={parser} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(container.querySelector('article img')?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('the drafted-asset count is the sum of the images\' deltas, and drops to 0 when the page goes', async () => {
    const drafted = (path: string): DocsEntry => entry('specs', path, { draft: draftOf('modified') });
    const f = byPath(treeOk({ entries: [drafted('a.md'), drafted('p.png'), drafted('q.png')], drafts: holder() }), {
      'a.md': fileAs('a.md', '# A\n\n![p](p.png) ![q](q.png)\n', 'markdown'),
    });
    const { container } = open('/docs/demo/specs/a.md?ref=main', f);
    const screenEl = (): Element => container.querySelector('.docs-screen') as Element;
    await waitFor(() => expect(screenEl()).toHaveAttribute('data-draft-assets', '2'));
    expect(f.file.mock.calls[0]![1]).toMatchObject({ kind: 'draft', fp: FP_1 });
    act(() => { navigate('/docs/demo/specs?ref=main'); });
    await waitFor(() => expect(screenEl()).toHaveAttribute('data-draft-assets', '0'));
  });
});

describe('fragments scroll once the new body renders (refinement (o))', () => {
  const FOOTNOTE = 'B.[^1]\n\n[^1]: The note.\n';

  it("a cross-doc link's fragment scrolls the target in the new page's article", async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const f = byPath(treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'b.md')] }), {
      'a.md': fileAs('a.md', '[to b](b.md#user-content-fn-1)\n', 'markdown'),
      'b.md': fileAs('b.md', FOOTNOTE, 'markdown'),
    });
    const { container } = open('/docs/demo/specs/a.md', f);
    fireEvent.click(await screen.findByRole('link', { name: 'to b' }));
    expect(here()).toBe('/docs/demo/specs/b.md');
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('article li#user-content-fn-1'));
  });

  it("a direct load's #fragment is honoured once", async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const f = byPath(treeOk({ entries: [entry('specs', 'b.md')] }), { 'b.md': fileAs('b.md', FOOTNOTE, 'markdown') });
    history.pushState(null, '', '/docs/demo/specs/b.md#user-content-fn-1');
    const { container } = render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('article li#user-content-fn-1'));
  });
});

describe('a fragment belongs to the page it was meant for (refinement (o), review I1)', () => {
  const FOOTNOTE = 'C.[^1]\n\n[^1]: The note.\n';
  const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };

  it('a fragment the linked page does not hold is not spent on the next page that does (measured)', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const f = byPath(treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'b.md'), entry('specs', 'c.md')] }), {
      'a.md': fileAs('a.md', '# A\n\n[to b](b.md#user-content-fn-1)\n\n[to c](c.md)\n', 'markdown'),
      'b.md': fileAs('b.md', '# B\n', 'markdown'),
      'c.md': fileAs('c.md', '# C\n\n' + FOOTNOTE, 'markdown'),
    });
    open('/docs/demo/specs/a.md', f);
    fireEvent.click(await screen.findByRole('link', { name: 'to b' }));
    expect(await screen.findByRole('heading', { name: 'B' })).toBeInTheDocument();
    await settle();
    act(() => { navigate('/docs/demo/specs/a.md'); });
    fireEvent.click(await screen.findByRole('link', { name: 'to c' }));
    expect(await screen.findByRole('heading', { name: 'C' })).toBeInTheDocument();
    await settle();
    expect(scroll).not.toHaveBeenCalled();
  });

  /** A leaf of `b.md` (or `path`) with the visit's file already read; the visit's actions are spies. */
  function renderLeaf(text: string, over: Partial<DocsVisit> = {}, path = 'b.md', contentClass: DocsFileResponse['contentClass'] = 'markdown') {
    const tree = treeOk({ entries: [entry('specs', path)] });
    const page = pageAt('/docs/demo/specs/' + path);
    if (page.kind !== 'path') throw new Error('fixture: not a leaf');
    const pin = pinFor(tree, page);
    if (pin === null) throw new Error('fixture: no pin');
    const base = fileResponse(text);
    const visit: DocsVisit = {
      tree: { s: 'ok', answer: treeResponse(tree), receivedAt: 0 },
      file: { s: 'ok', pin, answer: { ...base, contentClass }, receivedAt: 0 },
      freshness: { s: 'idle' }, updatedTo: null, pendingFragment: null,
      retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
      ...over,
    };
    return { visit, ...render(<DocsLeaf visit={visit} tree={tree} page={page} parser={parser} />) };
  }

  it("a direct load's fragment is honoured once: scrolled when the body holds it, and cleared right then", async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { visit, container } = renderLeaf('# B\n\n' + FOOTNOTE, { pendingFragment: 'user-content-fn-1' });
    expect(visit.setFragment).not.toHaveBeenCalled();
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('article li#user-content-fn-1'));
    expect(visit.setFragment).toHaveBeenCalledTimes(1);
    expect(visit.setFragment).toHaveBeenCalledWith(null);
  });

  it('a fragment the rendered body does not hold is cleared too, and nothing scrolls', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { visit } = renderLeaf('# B\n', { pendingFragment: 'user-content-fn-1' });
    expect(visit.setFragment).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'B' })).toBeInTheDocument();
    await waitFor(() => expect(visit.setFragment).toHaveBeenCalledWith(null));
    expect(scroll).not.toHaveBeenCalled();
  });

  it('a leaf that is not Markdown cannot hold a fragment: it is cleared, and nothing scrolls', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { visit } = renderLeaf('plain words', { pendingFragment: 'user-content-fn-1' }, 'x.txt', 'text');
    await waitFor(() => expect(visit.setFragment).toHaveBeenCalledWith(null));
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('the Markdown body is keyed by the pin (review I2)', () => {
  it('a re-list that moves a draft past the render gate asks first, instead of formatting on the old choice', async () => {
    const FP_2 = 'e'.repeat(64);
    const small = '# Small\n';
    const big = '# Big\n\n' + 'x'.repeat(DOCS_RENDER_GATE_BYTES);
    const draftTree = (fp: string): DocsTreeOk =>
      treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified', { fp }) })], drafts: holder() });
    const f = fakeLoaders({ tree: okTree(draftTree(FP_1)) });
    f.file.mockImplementation(async (_project: string, pin: DocPin) =>
      ({ s: 'ok', value: fileResponse(pin.kind === 'draft' && pin.fp === FP_2 ? big : small) }));
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(draftTree(FP_2))));
    const { container } = open('/docs/demo/specs/a.md?ref=main', f);
    expect(await screen.findByRole('heading', { name: 'Small' })).toBeInTheDocument();
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    expect(await screen.findByText(/Formatting it may take a while/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Format anyway' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Big' })).toBeNull();
  });
});

describe('the index after a sign-in (review I3)', () => {
  it('a sign-in reads an index that answered auth again, and the rows render', async () => {
    const f = fakeLoaders();
    f.projects.mockResolvedValueOnce({ s: 'auth' }).mockResolvedValue({ s: 'ok', value: indexAnswer() });
    open('/docs', f);
    await waitFor(() => expect(document.querySelector('.docs-fail[data-state="auth"]')).not.toBeNull());
    expect(f.projects).toHaveBeenCalledTimes(1);
    act(() => { raiseAuthLost('expired'); });
    act(() => { clearAuthLost(); });
    expect(await screen.findByText("Each project's default branch, read from the fleet box.")).toBeInTheDocument();
    expect(f.projects).toHaveBeenCalledTimes(2);
    expect(mainRowNames()).toContain('wt');
  });
});


describe('T13 review 3-3: a re-list that moves the pin but not the blob keeps the Markdown body', () => {
  it('same blob at a new commit: the same h1 node survives, the parser is called once, and no second read is made', async () => {
    const base = fileResponse('# A\n');
    const f = fakeLoaders({ tree: okTree(treeOk()) });
    f.file.mockResolvedValue({ s: 'ok', value: { ...base, show: { ...base.show, blob: BLOB_1, commit: COMMIT_A } } });
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({ commit: COMMIT_B }))));
    const counting = vi.fn(parser);
    const { container } = open('/docs/demo/specs/a.md', f, counting);
    const h1 = await screen.findByRole('heading', { name: 'A' });
    expect(counting).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    await waitFor(() => expect(container.querySelector('code.docs-truth-commit')?.getAttribute('title')).toBe(COMMIT_B));
    // The leaf's pin follows the tree in a later effect: let it settle before asking whether the body survived it.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByRole('heading', { name: 'A' })).toBe(h1);
    expect(counting).toHaveBeenCalledTimes(1);
    expect(f.file).toHaveBeenCalledTimes(1);
  });
});

describe('T13 review 2-2: the one image of a raster leaf is not a link to the leaf it is on', () => {
  it('tapping it pushes no history entry and leaves the URL as it was', async () => {
    const f = byPath(treeOk({ entries: [entry('specs', 'x.png')] }), {});
    const { container } = open('/docs/demo/specs/x.png', f);
    await waitFor(() => expect(container.querySelectorAll('.docs-leaf img')).toHaveLength(1));
    const url = here();
    const length = history.length;
    fireEvent.click(container.querySelector('.docs-leaf img') as HTMLElement);
    expect(history.length).toBe(length);
    expect(here()).toBe(url);
  });

  it('on view=committed the tap keeps the view and reads no draft', async () => {
    const f = byPath(treeOk({ entries: [entry('specs', 'x.png', { draft: draftOf('modified') })], drafts: holder() }), {});
    const { container } = open('/docs/demo/specs/x.png?ref=main&view=committed', f);
    await waitFor(() => expect(container.querySelectorAll('.docs-leaf img')).toHaveLength(1));
    const url = here();
    expect(url).toBe('/docs/demo/specs/x.png?ref=main&view=committed');
    const length = history.length;
    fireEvent.click(container.querySelector('.docs-leaf img') as HTMLElement);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(history.length).toBe(length);
    expect(here()).toBe(url);
    const pins = f.raster.mock.calls.map((c) => (c[1] as DocPin).kind);
    expect(pins).toEqual(['committed']);
  });
});

describe('T13 review 2-2: the leaf\'s own image is a plain img', () => {
  it('renders no doc-img-link button, only the img', async () => {
    const f = byPath(treeOk({ entries: [entry('specs', 'x.png')] }), {});
    const { container } = open('/docs/demo/specs/x.png', f);
    await waitFor(() => expect(container.querySelectorAll('.docs-leaf img')).toHaveLength(1));
    expect(container.querySelector('.docs-leaf button.doc-img-link')).toBeNull();
    expect(container.querySelectorAll('.docs-leaf .docs-raster button')).toHaveLength(0);
    expect(container.querySelector('.docs-leaf .docs-raster > img')).not.toBeNull();
  });
});

describe('T13 review 4-4: a drafted raster leaf is not an embedded draft asset', () => {
  it('data-draft-assets stays 0 and no draft-assets banner is drawn', async () => {
    const f = byPath(treeOk({ entries: [entry('specs', 'x.png', { draft: draftOf('modified') })], drafts: holder() }), {});
    const { container } = open('/docs/demo/specs/x.png?ref=refs/heads/main', f);
    await waitFor(() => expect(container.querySelectorAll('.docs-leaf img')).toHaveLength(1));
    await waitFor(() => expect(f.raster).toHaveBeenCalled());
    expect((f.raster.mock.calls[0]![1] as DocPin).kind).toBe('draft');
    expect(container.querySelector('.docs-screen')).toHaveAttribute('data-draft-assets', '0');
    expect(screen.queryByText(/embeds \d+ uncommitted asset/)).toBeNull();
  });
});

describe('T13 review 3-7: the index retries an auto-class word once, then shows Retry', () => {
  afterEach(() => { vi.useRealTimers(); });
  const busy = (): ReturnType<typeof failedAnswer> => failedAnswer('docs-busy', { retryAfterMs: 2000 });
  const advance = (ms: number): Promise<void> => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('docs-busy with retryAfterMs: one more GET after that wait, a second busy answer shows Retry and no third GET', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.projects.mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy())
      .mockResolvedValue({ s: 'ok', value: indexAnswer() });
    open('/docs', f);
    await advance(10);
    expect(f.projects).toHaveBeenCalledTimes(1);
    await advance(1500);
    expect(f.projects).toHaveBeenCalledTimes(1);
    await advance(600);
    expect(f.projects).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await advance(60_000);
    expect(f.projects).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await advance(10);
    expect(f.projects).toHaveBeenCalledTimes(3);
    expect(mainRowNames()).toContain('wt');
  });

  it('leaving the screen before the wait ends cancels the retry', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.projects.mockResolvedValue(busy());
    const { unmount } = open('/docs', f);
    await advance(10);
    expect(f.projects).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(f.projects).toHaveBeenCalledTimes(1);
  });

  it('a word that is not auto-class (a manual one) is not retried by itself', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.projects.mockResolvedValue(failedAnswer('repo-unreadable'));
    open('/docs', f);
    await advance(60_000);
    expect(f.projects).toHaveBeenCalledTimes(1);
  });
});

describe('T13 review 3-2: Fetch from origin on an unresolved ref says what it is doing and how it ended', () => {
  it('the button is disabled and the page says fetching while the POST runs, then the fetch failure sentence', async () => {
    const f = fakeLoaders({ tree: failedAnswer('unresolved-ref') });
    let release: (a: Awaited<ReturnType<DocsLoaders['refresh']>>) => void = () => {};
    f.refresh.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const { container } = open('/docs/demo?ref=ws/a', f);
    const button = await screen.findByRole('button', { name: 'Fetch from origin' });
    const before = container.innerHTML;
    expect(container.querySelector('.docs-fail-fresh')).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('.docs-fail-fresh')?.textContent).toBe('fetching…'));
    expect(screen.getByRole('button', { name: 'Fetch from origin' })).toBeDisabled();
    expect(container.innerHTML).not.toBe(before);
    const during = container.innerHTML;
    await act(async () => { release(okRefresh(fetchFailed('fetch-auth-failed'), failedAnswer('unresolved-ref').body)); });
    await waitFor(() => expect(container.querySelector('.docs-fail-fresh')?.textContent)
      .toContain(DOCS_FAILURE_SENTENCE['fetch-auth-failed']));
    expect(screen.getByRole('button', { name: 'Fetch from origin' })).toBeEnabled();
    expect(container.innerHTML).not.toBe(during);
    expect(container.innerHTML).not.toBe(before);
  });
});

describe('Review 450 F3: the no-listing page\'s fetch note stops counting at the end of its wait, as the chip does', () => {
  afterEach(() => { vi.useRealTimers(); });
  const advance = (ms: number): Promise<void> => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const tooSoon = (ms: number): ReturnType<typeof okRefresh> => okRefresh(fetchFailed('fetch-too-soon', { retryAfterMs: ms }), failedAnswer('unresolved-ref').body);
  const noteText = (c: HTMLElement): string | undefined => c.querySelector('.docs-fail-fresh')?.textContent ?? undefined;

  it('a second fetch-too-soon (past the visit\'s one automatic retry) counts down, never below 1s, then leaves no note', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: failedAnswer('unresolved-ref') });
    f.refresh.mockResolvedValueOnce(tooSoon(2000)).mockResolvedValueOnce(tooSoon(4000));
    const { container } = open('/docs/demo?ref=ws/a', f);
    await advance(10);
    fireEvent.click(screen.getByRole('button', { name: 'Fetch from origin' }));
    await advance(10);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(noteText(container)).toMatch(/^fetched moments ago; again in [12]s$/);
    await advance(2100);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(noteText(container)).toMatch(/^fetched moments ago; again in [1-4]s$/);
    // Never "again in 0s" while it counts: every second of the wait reads at least 1.
    for (let i = 0; i < 3; i += 1) {
      await advance(1000);
      const t = noteText(container);
      if (t !== undefined) expect(t).toMatch(/^fetched moments ago; again in [1-9]\d*s$/);
    }
    await advance(1000);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(noteText(container)).toBeUndefined();
    await advance(6000);
    expect(noteText(container)).toBeUndefined();
    await advance(120_000);
    expect(noteText(container)).toBeUndefined();
    expect(container.textContent).not.toContain('again in 0s');
    expect(screen.getByRole('button', { name: 'Fetch from origin' })).toBeEnabled();
  });

  it('a retry dropped because the user left the key: after the wait there is no "again in 0s"', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: failedAnswer('unresolved-ref') });
    f.refresh.mockResolvedValueOnce(tooSoon(3000)).mockResolvedValue(tooSoon(3000));
    const { container } = open('/docs/demo?ref=ws/a', f);
    await advance(10);
    fireEvent.click(screen.getByRole('button', { name: 'Fetch from origin' }));
    await advance(10);
    expect(noteText(container)).toMatch(/^fetched moments ago; again in [1-3]s$/);
    act(() => { navigate('/docs/demo?ref=ws/b'); });
    await advance(3500);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    act(() => { navigate('/docs/demo?ref=ws/a'); });
    await advance(10);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    await advance(6000);
    expect(noteText(container)).toBeUndefined();
    await advance(120_000);
    expect(noteText(container)).toBeUndefined();
    expect(container.textContent).not.toContain('again in 0s');
  });

  it('review 460 F12: the page\'s 1 s clock stops at the end of its wait: no timer of its own is pending one tick after it', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: failedAnswer('unresolved-ref') });
    let until = 0;
    f.refresh.mockResolvedValueOnce(tooSoon(2000)).mockImplementationOnce(async () => {
      until = Date.now() + 4000;
      return tooSoon(4000);
    });
    const { container } = open('/docs/demo?ref=ws/a', f);
    await advance(10);
    // What is pending with no wait at all: the page's own timers, none of them the 1 s clock.
    const idle = vi.getTimerCount();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch from origin' }));
    await advance(10);
    expect(noteText(container)).toMatch(/^fetched moments ago; again in [12]s$/);
    // During the wait the clock is the one extra timer.
    expect(vi.getTimerCount()).toBeGreaterThan(idle);
    await advance(2100);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(noteText(container)).toMatch(/^fetched moments ago; again in [1-4]s$/);
    expect(vi.getTimerCount()).toBeGreaterThan(idle);
    // The clock's first tick at or after `until` lands within one second of it and renders with the wait over, so
    // just past that second the note is gone and so is the clock. A clock that runs MORE than one tick longer stays
    // pending here; one extra tick does not (review 471 F2): the first tick at or after `until` lands at `until + 1`
    // and the count is read at `until + 1001`, so a clock stopped one tick late (`Date.now() < soon + 1000`, or
    // `+ 1001`) passes, and one stopped two ticks late (`+ 1002`) reds. Row W5P1-T13-M88 is `useNow`'s gate removed.
    expect(until).toBeGreaterThan(0);
    await advance(until - 1 - Date.now());
    expect(vi.getTimerCount()).toBeGreaterThan(idle);
    await advance(1002);
    expect(Date.now()).toBe(until + 1001);
    expect(noteText(container)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(idle);
    await advance(60_000);
    expect(vi.getTimerCount()).toBe(idle);
  });

  it('review 460 F13: a render at exactly the end of the wait shows no soon note and never "again in 0s"', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    // The page's clock ticks every second from when it was switched on: note when, so that the second answer's wait can
    // end on one of its ticks (the render at exactly `until` is the case; a tick is the only render that can land there).
    let phase = 0;
    const fakeSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((fn: () => void, ms?: number) => {
      if (ms === 1000) phase = Date.now();
      return fakeSetInterval(fn, ms);
    }) as typeof setInterval;
    try {
      const f = fakeLoaders({ tree: failedAnswer('unresolved-ref') });
      let until = 0;
      f.refresh.mockResolvedValueOnce(tooSoon(2000)).mockImplementationOnce(async () => {
        const landed = Date.now();
        // A whole number of seconds after the clock's start, at least 3 s after the answer lands.
        const wait = 3000 + ((((phase - landed) % 1000) + 1000) % 1000);
        until = landed + wait;
        return tooSoon(wait);
      });
      const { container } = open('/docs/demo?ref=ws/a', f);
      await advance(10);
      fireEvent.click(screen.getByRole('button', { name: 'Fetch from origin' }));
      await advance(10);
      await advance(2100);
      expect(f.refresh).toHaveBeenCalledTimes(2);
      expect(until).toBeGreaterThan(0);
      expect((until - phase) % 1000).toBe(0);
      // One millisecond before the end the note still counts, at 1s.
      await advance(until - 1 - Date.now());
      expect(Date.now()).toBe(until - 1);
      expect(noteText(container)).toBe('fetched moments ago; again in 1s');
      // The clock tick that lands on exactly `until` renders with now === until: no soon note, no "again in 0s".
      await advance(1);
      expect(Date.now()).toBe(until);
      expect(noteText(container)).toBeUndefined();
      expect(container.textContent).not.toContain('again in');
      await advance(5000);
      expect(noteText(container)).toBeUndefined();
      expect(container.textContent).not.toContain('again in');
    } finally {
      globalThis.setInterval = fakeSetInterval;
    }
  });
});

describe('Review 439 F3: the not-contained banner describes the pin, and a Re-list through the visit clears it', () => {
  /** A leaf whose file answer says its commit (COMMIT_A) is no longer on the served ref. */
  const notContained = (): DocsFileAnswer => {
    const r = fileResponse('# Kept\n');
    return { s: 'ok', value: { ...r, show: { ...r.show, commit: COMMIT_A, blob: BLOB_1, onRef: 'not-contained' } } };
  };
  const banner = (c: Element): Element | null => c.querySelector('[data-banner="not-contained"]');

  it("an answer read at the pin's own commit shows the banner, naming that commit", async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ commit: COMMIT_A })), file: notContained() });
    const { container } = open('/docs/demo/specs/a.md', f);
    expect(await screen.findByRole('heading', { name: 'Kept' })).toBeInTheDocument();
    expect(banner(container)?.textContent).toContain('Commit aaaaaaaa is no longer on origin/main');
  });

  it('Re-list that moves the tree to a new commit at the SAME blob: no re-read, the truth line names the new commit, no banner', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ commit: COMMIT_A })), file: notContained() });
    f.tree.mockResolvedValueOnce(okTree(treeOk({ commit: COMMIT_A })));
    f.tree.mockResolvedValueOnce(okTree(treeOk({ commit: COMMIT_B })));
    const { container } = open('/docs/demo/specs/a.md', f);
    expect(await screen.findByRole('heading', { name: 'Kept' })).toBeInTheDocument();
    expect(banner(container)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Re-list' }));
    await waitFor(() => expect(container.querySelector('code.docs-truth-commit')?.getAttribute('title')).toBe(COMMIT_B));
    await waitFor(() => expect(banner(container)).toBeNull());
    expect(f.file).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Kept' })).toBeInTheDocument();
  });
});

describe("Review 439 F23: a direct load's #fragment survives the linked-worktree owner redirect", () => {
  const FOOTNOTE = 'B.[^1]\n\n[^1]: The note.\n';

  it("is honoured once on the owner's page, and a later in-app visit to the page does not honour it again", async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const f = fakeLoaders();
    f.tree.mockImplementation(async (project: string) => project === 'b'
      ? failedAnswer('linked-worktree', { owner: 'a', branch: 'ws/a' })
      : okTree(treeOk({ entries: [entry('specs', 'x.md'), entry('specs', 'y.md')] })));
    f.file.mockImplementation(async (_project: string, pin: DocPin) => ({
      s: 'ok', value: fileResponse(pin.path === 'x.md' ? FOOTNOTE : '# Y\n'),
    }));
    history.pushState(null, '', '/docs/b/specs/x.md#user-content-fn-1');
    const { container } = render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(here()).toBe('/docs/a/specs/x.md?ref=ws/a'));
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('article li#user-content-fn-1'));
    act(() => { navigate('/docs/a/specs/y.md?ref=ws/a'); });
    expect(await screen.findByRole('heading', { name: 'Y' })).toBeInTheDocument();
    act(() => { navigate('/docs/a/specs/x.md?ref=ws/a'); });
    await waitFor(() => expect(container.querySelector('article li#user-content-fn-1')).not.toBeNull());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});

// ---- W5 Share, Task 4: a raster leaf's own image reports the pin it settled at ------------------------------------

describe("W5 Share: a raster leaf's own image reports the pin it settled at (spec 4.3 item 5, 4.16; refinement (f))", () => {
  const visitOf = (tree: DocsTreeOk, file: DocsVisit['file']): DocsVisit => ({
    tree: { s: 'ok', answer: treeResponse(tree), receivedAt: 0 }, file, freshness: { s: 'idle' }, updatedTo: null,
    pendingFragment: null, retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(),
    setFragment: vi.fn(),
  });

  /** `url`'s leaf alone, under the assets context the screen gives it, with `listen` as its leaf-image listener. */
  function leafAlone(url: string, tree: DocsTreeOk, f: FakeLoaders, listen: (pin: DocPin | null) => void,
    file: DocsVisit['file'] = { s: 'none' }): ReturnType<typeof render> {
    const page = pageAt(url);
    if (page.kind !== 'path') throw new Error('fixture: not a leaf');
    const assets = { loaders: f.loaders, queue: createFetchQueue(), onDraftAsset: () => {} };
    return render(
      <DocsAssetContext value={assets}>
        <DocsLeaf visit={visitOf(tree, file)} tree={tree} page={page} parser={parser} onLeafImage={listen} />
      </DocsAssetContext>,
    );
  }

  const RASTER = treeOk({ entries: [entry('specs', 'x.png')] });
  const RASTER_URL = '/docs/demo/specs/x.png';

  it("reports the leaf's pin once its bytes are shown, and null when it unmounts", async () => {
    const f = fakeLoaders({ tree: okTree(RASTER) });
    f.raster.mockResolvedValue(okPng());
    const seen = vi.fn();
    const view = leafAlone(RASTER_URL, RASTER, f, seen);
    const pin = pinFor(RASTER, pageAt(RASTER_URL));
    await waitFor(() => expect(seen).toHaveBeenLastCalledWith(pin));
    expect(seen.mock.calls.every(([p]) => p === null || JSON.stringify(p) === JSON.stringify(pin))).toBe(true);
    view.unmount();
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('reports nothing while the image loads', async () => {
    const f = fakeLoaders({ tree: okTree(RASTER) });
    f.raster.mockImplementation(() => new Promise<never>(() => {}));
    const seen = vi.fn();
    leafAlone(RASTER_URL, RASTER, f, seen);
    await waitFor(() => expect(f.raster).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(seen.mock.calls.filter(([p]) => p !== null)).toEqual([]);
  });

  it('a failed load settles it too: the pin is reported, as a failed read settles any leaf (refinement (f))', async () => {
    const f = fakeLoaders({ tree: okTree(RASTER) });
    f.raster.mockResolvedValue({ s: 'unreachable' });
    const seen = vi.fn();
    leafAlone(RASTER_URL, RASTER, f, seen);
    await waitFor(() => expect(seen).toHaveBeenLastCalledWith(pinFor(RASTER, pageAt(RASTER_URL))));
  });

  it('an image inside a Markdown document reports nothing', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png')] });
    const pin = pinFor(tree, pageAt('/docs/demo/specs/a.md'));
    if (pin === null) throw new Error('fixture: no pin');
    const f = fakeLoaders({ tree: okTree(tree) });
    f.raster.mockResolvedValue(okPng());
    const seen = vi.fn();
    const { container } = leafAlone('/docs/demo/specs/a.md', tree, f, seen,
      { s: 'ok', pin, answer: fileResponse('![x](x.png)\n'), receivedAt: 0 });
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(seen.mock.calls.filter(([p]) => p !== null)).toEqual([]);
  });
});


// ---- W5 Share, Task 6: Share on the Docs screen -----------------------------------------------------------------

describe('W5 Share on the Docs screen (spec 4.5, 4.16; M4.SH8 Share half, M4.EX12 Share half, M4.SH1 raster clause)', () => {
  const GH = 'https://github.com/example-org/example-repo';
  const shareButton = (): HTMLElement | null => screen.queryByRole('button', { name: DOCS_HEAD_TEXT.share });
  const updatingTo = (commit: string): string => fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(commit) });
  const sheetUrl = (): string | null | undefined => document.querySelector('.docs-share-url')?.textContent;
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve: (v: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  /** A committed answer for `a.md` at `commit`, of blob `blob`, its h1 `heading`. */
  function answerAt(commit: string, blob: string, heading: string, over: Partial<DocsFileResponse['show']> = {}): DocsFileAnswer {
    const r = fileResponse(`# ${heading}\n`);
    return { s: 'ok', value: { ...r, show: { ...r.show, commit, blob, onRef: 'contains', ...over } } };
  }

  /** The loading state held honestly: the leaf's image request has been made and its effects have run, the loader's
   *  promise has neither resolved nor rejected, and Share is still disabled, reading "Updating to <short>…". */
  async function expectSharePausedWhileImageLoads(f: { raster: { mock: { calls: unknown[] } } }, commit: string): Promise<void> {
    await waitFor(() => expect(f.raster.mock.calls.length).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.getByRole('button', { name: updatingTo(commit) })).toBeDisabled();
    expect(shareButton()).toBeNull();
  }

  it('no Share on the index (M4.SH8)', async () => {
    openIndex();
    await waitFor(() => expect(mainRowNames().length).toBeGreaterThan(0));
    expect(document.querySelector('.docs-share')).toBeNull();
  });

  it('no Share in frame=full; the same page inline has it (M4.SH8)', async () => {
    const tree = treeOk({ entries: [entry('specs', 'm.html')] });
    const files = { 'm.html': fileAs('m.html', '<p>a</p>', 'html') };
    open('/docs/demo/specs/m.html?ref=main&frame=full', byPath(tree, files));
    expect(await screen.findByRole('link', { name: DOCS_HEAD_TEXT.github })).toBeInTheDocument();
    expect(document.querySelector('.docs-share')).toBeNull();
    cleanup();
    open('/docs/demo/specs/m.html?ref=main', byPath(tree, files));
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeEnabled();
  });

  it('hidden while the tree slot is loading (M4.SH8)', async () => {
    const f = fakeLoaders();
    f.tree.mockImplementation(() => new Promise<never>(() => {}));
    open('/docs/demo/specs/a.md', f);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(f.tree).toHaveBeenCalled();
    expect(document.querySelector('.docs-share')).toBeNull();
  });

  it("a leaf's actions read View on GitHub, Share, Open committed version, in that order (M4.SH8)", async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
    open('/docs/demo/specs/a.md?ref=main', fakeLoaders({ tree: okTree(tree) }));
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeEnabled();
    const actions = [...document.querySelectorAll('.docs-actions .docs-action:not(.docs-export)')].map((e) => e.textContent);
    expect(actions).toEqual([DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.openCommitted]);
  });

  it('the project page carries View on GitHub and Share, through root (M4.SH8)', async () => {
    open('/docs/demo', fakeLoaders());
    expect(await screen.findByRole('link', { name: DOCS_HEAD_TEXT.github })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share }));
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/tree/${COMMIT_A}`));
  });

  it('a tree moved to C2 while the file is at C1 disables Share, reading Updating to; the C2 answer enables it, and the link names C2 (M4.EX12)', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk()) });
    const later = deferred<DocsFileAnswer>();
    f.file.mockImplementation(async (_project: string, pin: DocPin) =>
      (pin.kind === 'committed' && pin.commit === COMMIT_B ? later.promise : answerAt(COMMIT_A, BLOB_1, 'A')));
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({
      commit: COMMIT_B, entries: [entry('specs', 'a.md', { committed: { kind: 'file', blob: BLOB_2, size: 100 } })],
    }))));
    const { container } = open('/docs/demo/specs/a.md', f);
    await screen.findByRole('heading', { name: 'A' });
    expect(shareButton()).toBeEnabled();
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    expect(await screen.findByRole('button', { name: updatingTo(COMMIT_B) })).toBeDisabled();
    await act(async () => { later.resolve(answerAt(COMMIT_B, BLOB_2, 'B')); });
    await screen.findByRole('heading', { name: 'B' });
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_B}/docs/superpowers/specs/a.md`));
  });

  it("a same-blob re-list: Share links C2 with no second read, and the sheet says nothing of C1's onRef (refinement (a))", async () => {
    const f = fakeLoaders({ tree: okTree(treeOk()) });
    f.file.mockResolvedValue(answerAt(COMMIT_A, BLOB_1, 'A', { onRef: 'not-contained' }));
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({ commit: COMMIT_B }))));
    const { container } = open('/docs/demo/specs/a.md', f);
    await screen.findByRole('heading', { name: 'A' });
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    await waitFor(() => expect(container.querySelector('code.docs-truth-commit')?.getAttribute('title')).toBe(COMMIT_B));
    await waitFor(() => expect(shareButton()).toBeEnabled());
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_B}/docs/superpowers/specs/a.md`));
    expect(document.querySelector('.docs-share-sheet')?.textContent).not.toContain('GitHub may stop serving it');
    expect(f.file).toHaveBeenCalledTimes(1);
  });

  it('a raster leaf: Share waits for its image, then links the pin the image loaded (M4.SH1, M4.EX12; refinement (f))', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'x.png')] })) });
    const image = deferred<DocsRasterAnswer>();
    f.raster.mockImplementation(() => image.promise);
    open('/docs/demo/specs/x.png', f);
    expect(await screen.findByRole('button', { name: updatingTo(COMMIT_A) })).toBeDisabled();
    await expectSharePausedWhileImageLoads(f, COMMIT_A);
    await act(async () => { image.resolve(okPng()); });
    await waitFor(() => expect(shareButton()).toBeEnabled());
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/x.png`));
  });

  it('a ref-view raster leaf that opens a draft: Share waits for the drafted image, then sends the committed permalink at C with the drafts note', async () => {
    const tree = treeOk({ entries: [entry('specs', 'x.png', { draft: draftOf('modified') })], drafts: holder() });
    const f = fakeLoaders({ tree: okTree(tree) });
    const image = deferred<DocsRasterAnswer>();
    f.raster.mockImplementation(() => image.promise);
    open('/docs/demo/specs/x.png?ref=main', f);
    expect(await screen.findByRole('button', { name: updatingTo(COMMIT_A) })).toBeDisabled();
    await waitFor(() => expect(f.raster).toHaveBeenCalled());
    expect(f.raster.mock.calls[0]?.[1]?.kind).toBe('draft');
    await expectSharePausedWhileImageLoads(f, COMMIT_A);
    await act(async () => { image.resolve(okPng()); });
    await waitFor(() => expect(shareButton()).toBeEnabled());
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/x.png`));
    expect(document.querySelector('.docs-share-sheet')?.textContent).toContain('Drafts are not included');
  });

  it('the same raster leaf at view=committed: Share waits for the committed image, then sends the permalink with the not-included note', async () => {
    const tree = treeOk({ entries: [entry('specs', 'x.png', { draft: draftOf('modified') })], drafts: holder() });
    const f = fakeLoaders({ tree: okTree(tree) });
    const image = deferred<DocsRasterAnswer>();
    f.raster.mockImplementation(() => image.promise);
    open('/docs/demo/specs/x.png?ref=main&view=committed', f);
    await expectSharePausedWhileImageLoads(f, COMMIT_A);
    expect(f.raster.mock.calls[0]?.[1]?.kind).toBe('committed');
    await act(async () => { image.resolve(okPng()); });
    await waitFor(() => expect(shareButton()).toBeEnabled());
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/x.png`));
    expect(document.querySelector('.docs-share-sheet')?.textContent)
      .toContain('Uncommitted changes in main checkout are not included.');
  });

  // The two lifetime cases leave the sheet open across a change after which Share is ready AT ONCE, so an unkeyed
  // ShareAction (same position, `open` still true) would show the sheet again straight away: only the key closes it.
  it('a sheet left open closes when the page changes, even to a page whose Share is ready at once (refinement (n))', async () => {
    open('/docs/demo/specs/a.md', fakeLoaders());
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    act(() => { navigate('/docs/demo/specs'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sheetUrl()).toBeUndefined();
  });

  it('a sheet left open closes when a re-list moves the served commit (refinement (n))', async () => {
    const f = fakeLoaders();
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({ commit: COMMIT_B }))));
    const { container } = open('/docs/demo/specs', f);
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share }));
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/tree/${COMMIT_A}/docs/superpowers/specs`));
    // fireEvent.click dispatches no pointerdown, so the sheet's press-outside dismissal never runs here.
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    await waitFor(() => expect(container.querySelector('code.docs-truth-commit')?.getAttribute('title')).toBe(COMMIT_B));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sheetUrl()).toBeUndefined();
  });

  it('Share reads the visit, not the body: the reader frame gives the link the plain view gives (W8a)', async () => {
    const reader = { render: vi.fn(() => new Promise<never>(() => {})), mount: vi.fn(), images: vi.fn() } as unknown as ReaderDeps;
    const f = fakeLoaders();
    navigate('/docs/demo/specs/a.md');
    render(<DocsScreen path={location.pathname} search={location.search} loaders={f.loaders} parser={parser} reader={reader} />);
    await waitFor(() => expect(reader.render).toHaveBeenCalled());
    await waitFor(() => expect(shareButton()).toBeEnabled());
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`));
  });

  it('no refusal on the screen says Export while no page offers it (refinement (c))', async () => {
    open('/docs/demo', fakeLoaders({ tree: okTree({ ...treeOk(), github: { state: 'none' } }) }));
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share }));
    expect(await screen.findByText('No GitHub link for this project.')).toBeInTheDocument();
    expect(document.querySelector('.docs-share-sheet')?.textContent).not.toContain('Export');
  });

  it('a leaf whose read settled unreachable, then a same-blob re-list to C2: Share is enabled, not stuck Updating, and links C2', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk()) });
    f.file.mockResolvedValue({ s: 'unreachable' });
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({ commit: COMMIT_B }))));
    const { container } = open('/docs/demo/specs/a.md', f);
    await waitFor(() => expect(f.file).toHaveBeenCalled());
    await waitFor(() => expect(shareButton()).toBeEnabled());
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    await waitFor(() => expect(container.querySelector('code.docs-truth-commit')?.getAttribute('title')).toBe(COMMIT_B));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(shareButton()).toBeEnabled();
    expect(screen.queryByRole('button', { name: updatingTo(COMMIT_B) })).toBeNull();
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_B}/docs/superpowers/specs/a.md`));
  });
});

// ---- W5 Export, Task 8: Export on the Docs screen ----------------------------------------------------------------

describe('W5 Export on the Docs screen (spec 4.5, 4.17; M4.SH3, M4.SH8 Export halves, M4.EX12, M4.EX15; refinements (a), (j))', () => {
  const exportButton = (): HTMLElement | null => screen.queryByRole('button', { name: DOCS_HEAD_TEXT.export });
  const busy = (state: string): string => fillSentence(DOCS_HEAD_TEXT.exportBusy, { state });
  const updatingTo = (commit: string): string => fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(commit) });
  function deferredOf<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve: (v: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  function answerOf(commit: string, blob: string, heading: string): DocsFileAnswer {
    const r = fileResponse(`# ${heading}\n`);
    return { s: 'ok', value: { ...r, show: { ...r.show, commit, blob, onRef: 'contains' } } };
  }
  beforeEach(() => {
    vi.mocked(URL.createObjectURL).mockClear();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Taps Export, then Save, and answers the saved file, parsed. */
  async function exported(): Promise<Document> {
    fireEvent.click(exportButton() as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: /^Save / }));
    const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0];
    if (!(blob instanceof Blob)) throw new Error('nothing saved');
    return new DOMParser().parseFromString(new TextDecoder().decode(await blob.arrayBuffer()), 'text/html');
  }

  /** A store clock the case moves by hand (`highlight-store.test.ts#fakeClock`'s form): `advance` fires every timer due. */
  function handClock(): HighlightClock & { advance(ms: number): void } {
    let now = 0;
    let next = 1;
    const timers = new Map<number, { at: number; fn: () => void }>();
    return {
      now: () => now,
      setTimer: (fn, ms) => { const h = next++; timers.set(h, { at: now + ms, fn }); return h; },
      clearTimer: (h) => { timers.delete(h as number); },
      advance(ms) {
        const end = now + ms;
        for (;;) {
          const due = [...timers].filter(([, t]) => t.at <= end).sort(([, a], [, b]) => a.at - b.at)[0];
          if (due === undefined) break;
          timers.delete(due[0]);
          now = due[1].at;
          due[1].fn();
        }
        now = end;
      },
    };
  }

  // The lifetime pair (refinement (u)), after Share's two: the sheet stays open across a change after which Export is
  // ready again, so an unkeyed ExportAction (same position, its request still set) would show the sheet straight away.
  it('an open Export sheet closes when the page changes to another leaf Export is offered on (refinement (u))', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'b.md')] });
    open('/docs/demo/specs/a.md', fakeLoaders({ tree: okTree(tree) }));
    await waitFor(() => expect(exportButton()).toBeEnabled());
    fireEvent.click(exportButton() as HTMLElement);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    act(() => { navigate('/docs/demo/specs/b.md'); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an open Export sheet closes when a re-list moves the served commit (refinement (u))', async () => {
    const f = fakeLoaders();
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({ commit: COMMIT_B }))));
    const { container } = open('/docs/demo/specs/a.md', f);
    await waitFor(() => expect(exportButton()).toBeEnabled());
    fireEvent.click(exportButton() as HTMLElement);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    await waitFor(() => expect(container.querySelector('code.docs-truth-commit')?.getAttribute('title')).toBe(COMMIT_B));
    await waitFor(() => expect(exportButton()).toBeEnabled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("a leaf's actions read View on GitHub, Share, Export, Open committed version, in that order (M4.SH8)", async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
    open('/docs/demo/specs/a.md?ref=main', fakeLoaders({ tree: okTree(tree) }));
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const actions = [...document.querySelectorAll('.docs-actions .docs-action')].map((e) => e.textContent);
    expect(actions).toEqual([DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.export, DOCS_HEAD_TEXT.openCommitted]);
  });

  it('no Export on the index, a project, section or directory page, in frame=full, or while the tree slot loads (M4.SH8)', async () => {
    openIndex();
    await waitFor(() => expect(mainRowNames().length).toBeGreaterThan(0));
    expect(document.querySelector('.docs-export')).toBeNull();
    cleanup();
    const tree = treeOk({ entries: [entry('specs', 'd/x.md'), entry('specs', 'm.html')] });
    for (const url of ['/docs/demo', '/docs/demo/specs', '/docs/demo/specs/d/']) {
      open(url, fakeLoaders({ tree: okTree(tree) }));
      await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
      expect(document.querySelector('.docs-export'), url).toBeNull();
      cleanup();
    }
    open('/docs/demo/specs/m.html?ref=main&frame=full', byPath(tree, { 'm.html': fileAs('m.html', '<p>a</p>', 'html') }));
    expect(await screen.findByRole('link', { name: DOCS_HEAD_TEXT.github })).toBeInTheDocument();
    expect(document.querySelector('.docs-export')).toBeNull();
    cleanup();
    // The URL grammar keeps `frame=full` on an html leaf alone (shared/docs.ts#pageKeepsFrame), so the frame arm of
    // exportStateFor is read directly: the same ready Markdown leaf is offered inline and absent in the full frame.
    const mdTree = treeOk();
    const inline = pageAt('/docs/demo/specs/a.md');
    const mdPin = pinFor(mdTree, inline);
    if (mdPin === null || inline.kind !== 'path') throw new Error('fixture');
    const mdFile: FileSlot = { s: 'ok', pin: mdPin, answer: fileResponse('# T\n'), receivedAt: 0 };
    const mdParsed = parseMarkdown('# T\n', 'docs');
    if (mdParsed.kind !== 'tree') throw new Error('fixture');
    const mdD = detachUrls(mdParsed.tree);
    const mdLink = { project: 'demo', pageRef: null, view: 'effective' as const, section: 'specs' as const, path: 'a.md', tree: mdTree, pageSource: 'committed' as const, onFragment: () => {} };
    const mdBody = { kind: 'tree' as const, text: '# T\n', tree: mdD.tree, urls: mdD.urls, link: mdLink };
    const mdInputs = { body: mdBody, store: syncTestStore('docs'), settled: true, assets: null };
    expect(exportStateFor(inline, mdTree, mdFile, mdInputs).s).toBe('ready');
    expect(exportStateFor({ ...inline, frame: 'full' }, mdTree, mdFile, mdInputs)).toEqual({ s: 'absent' });
    const f = fakeLoaders();
    f.tree.mockImplementation(() => new Promise<never>(() => {}));
    open('/docs/demo/specs/a.md', f);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(document.querySelector('.docs-export')).toBeNull();
  });

  it('no Export for class other, nor for html in W5 (M4.SH8)', async () => {
    const tree = treeOk({ entries: [entry('specs', 'o.pdf'), entry('specs', 'm.html')] });
    open('/docs/demo/specs/o.pdf', fakeLoaders({ tree: okTree(tree) }));
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeEnabled());
    expect(document.querySelector('.docs-export')).toBeNull();
    cleanup();
    open('/docs/demo/specs/m.html', byPath(tree, { 'm.html': fileAs('m.html', '<p>a</p>', 'html') }));
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeEnabled());
    expect(document.querySelector('.docs-export')).toBeNull();
  });

  it("a new draft: Export is enabled and Share's refusal carries Export's clause; a withheld new file: no Export, no clause (M4.SH3)", async () => {
    const fresh = treeOk({ entries: [entry('specs', 'n.md', { committed: null, draft: draftOf('added') })], drafts: holder() });
    open('/docs/demo/specs/n.md?ref=main', fakeLoaders({ tree: okTree(fresh) }));
    await waitFor(() => expect(exportButton()).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: DOCS_HEAD_TEXT.share }));
    expect(await screen.findByText(`Not committed yet, so GitHub has nothing to show. ${SHARE_EXPORT_CLAUSE}`)).toBeInTheDocument();
    cleanup();
    const withheld = treeOk({ entries: [entry('specs', 'w.md', { committed: null, draft: draftOf('added', { fp: null }) })], drafts: holder() });
    open('/docs/demo/specs/w.md?ref=main', fakeLoaders({ tree: okTree(withheld) }));
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share }));
    expect(await screen.findByText(/^Not committed yet, and Docs did not read it/)).toBeInTheDocument();
    expect(document.querySelector('.docs-share-sheet')?.textContent).not.toContain(SHARE_EXPORT_CLAUSE);
    expect(document.querySelector('.docs-export')).toBeNull();
  });

  it('Formatting… while the parse runs, Export once it lands, and the file holds the tree the page shows (M4.EX15)', async () => {
    const text = '# Alpha\n\nbody text\n';
    let resolve: (o: ParseOutcome) => void = () => {};
    const slow: MarkdownParser = () => new Promise<ParseOutcome>((r) => { resolve = r; });
    open('/docs/demo/specs/a.md', fakeLoaders({ file: okFile(text) }), slow);
    expect(await screen.findByRole('button', { name: busy(EXPORT_WAIT_TEXT.formatting) })).toBeDisabled();
    await act(async () => { resolve(parseMarkdown(text, 'docs')); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const page = document.querySelector('.doc-body')?.textContent;
    const doc = await exported();
    expect(doc.querySelector('title')?.textContent).toBe('Alpha');
    expect(doc.querySelector('article')?.textContent).toBe(page);
  });

  it("Highlighting… until the page's store settles; then each exported block's HTML is what the page inserted (M4.EX15)", async () => {
    const docs = inThreadHighlighter({ hold: true });
    const f = fakeLoaders({ file: okFile('```bash\necho one\n```\n\n```bash\necho two\n```\n') });
    navigate('/docs/demo/specs/a.md');
    render(<HighlighterContext value={inThreadContext(docs)}><Routed loaders={f.loaders} /></HighlighterContext>);
    expect(await screen.findByRole('button', { name: busy(EXPORT_WAIT_TEXT.highlighting) })).toBeDisabled();
    await act(async () => { docs.release(); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const page = [...document.querySelectorAll('.doc-body pre code')].map((c) => c.innerHTML);
    expect(page).toHaveLength(2);
    expect(page.every((h) => h.includes('hljs-'))).toBe(true);
    const doc = await exported();
    expect([...doc.querySelectorAll('article pre code')].map((c) => c.innerHTML)).toEqual(page);
  });

  it('the page ceilings bound the wait: a highlighter that only times out settles the store, and Export saves those blocks plain, counted (M4.EX15)', async () => {
    const timesOut: Highlighter = {
      highlight: async (_r, o) => { o.onPosted?.(); return { kind: 'timeout', budgetMs: 750 }; },
      status: () => 'live', prewarm: () => undefined,
    };
    const text = ['one', 'two', 'three'].map((w) => `\`\`\`bash\necho ${w}\n\`\`\`\n`).join('\n');
    navigate('/docs/demo/specs/a.md');
    render(<HighlighterContext value={inThreadContext(timesOut)}><Routed loaders={fakeLoaders({ file: okFile(text) }).loaders} /></HighlighterContext>);
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect(doc.querySelectorAll('article pre code span')).toHaveLength(0);
    const count = (word: string): number => Number(doc.querySelector(`meta[name="ccrc:plain-${word}"]`)?.getAttribute('content') ?? '0');
    expect(count('timeout')).toBeGreaterThan(0);
    expect(count('page-ceiling')).toBeGreaterThan(0);
    expect(count('timeout') + count('page-ceiling')).toBe(3);
  });

  it('the worker-time ceiling bounds the wait: with a highlighter that never answers, Highlighting… holds until HIGHLIGHT_PAGE_WORKER_MS passes, then Export saves the blocks plain (M4.EX15)', async () => {
    const hangs: Highlighter = {
      highlight: (_r, o) => { o.onPosted?.(); return new Promise<never>(() => {}); },
      status: () => 'live', prewarm: () => undefined,
    };
    const clock = handClock();
    const text = ['one', 'two'].map((w) => `\`\`\`bash\necho ${w}\n\`\`\`\n`).join('\n');
    navigate('/docs/demo/specs/a.md');
    render(<HighlighterContext value={inThreadContext(hangs, undefined, undefined, clock)}><Routed loaders={fakeLoaders({ file: okFile(text) }).loaders} /></HighlighterContext>);
    expect(await screen.findByRole('button', { name: busy(EXPORT_WAIT_TEXT.highlighting) })).toBeDisabled();
    act(() => { clock.advance(HIGHLIGHT_PAGE_WORKER_MS - 1); });
    expect(screen.getByRole('button', { name: busy(EXPORT_WAIT_TEXT.highlighting) })).toBeDisabled();
    act(() => { clock.advance(1); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect(doc.querySelectorAll('article pre code span')).toHaveLength(0);
    expect(doc.querySelector('meta[name="ccrc:plain-page-ceiling"]')?.getAttribute('content')).toBe('2');
  });

  it('a body that answers another text is not exported: it reads Formatting… (M4.EX15)', () => {
    const tree = treeOk();
    const page = pageAt('/docs/demo/specs/a.md');
    const pin = pinFor(tree, page);
    if (pin === null) throw new Error('fixture');
    const file: FileSlot = { s: 'ok', pin, answer: fileResponse('# New\n'), receivedAt: 0 };
    const old = parseMarkdown('# Old\n', 'docs');
    if (old.kind !== 'tree') throw new Error('fixture');
    const d = detachUrls(old.tree);
    const link = { project: 'demo', pageRef: null, view: 'effective' as const, section: 'specs' as const, path: 'a.md', tree, pageSource: 'committed' as const, onFragment: () => {} };
    const body = { kind: 'tree' as const, text: '# Old\n', tree: d.tree, urls: d.urls, link };
    expect(exportStateFor(page, tree, file, { body, store: syncTestStore('docs'), settled: true, assets: null }))
      .toEqual({ s: 'waiting', why: 'formatting' });
    expect(exportStateFor(page, tree, file, { body: { ...body, text: '# New\n' }, store: syncTestStore('docs'), settled: true, assets: null }).s)
      .toBe('ready');
  });

  it('a tree moved to C2 while the file is at C1: Export reads Updating to; once C2 lands it exports C2 (M4.EX12)', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk()) });
    const later = deferredOf<DocsFileAnswer>();
    f.file.mockImplementation(async (_project: string, pin: DocPin) =>
      (pin.kind === 'committed' && pin.commit === COMMIT_B ? later.promise : answerOf(COMMIT_A, BLOB_1, 'A')));
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({
      commit: COMMIT_B, entries: [entry('specs', 'a.md', { committed: { kind: 'file', blob: BLOB_2, size: 100 } })],
    }))));
    const { container } = open('/docs/demo/specs/a.md', f);
    await screen.findByRole('heading', { name: 'A' });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    expect(await screen.findByRole('button', { name: busy(updatingTo(COMMIT_B)) })).toBeDisabled();
    await act(async () => { later.resolve(answerOf(COMMIT_B, BLOB_2, 'B')); });
    await screen.findByRole('heading', { name: 'B' });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect(doc.querySelector('meta[name="ccrc:commit"]')?.getAttribute('content')).toBe(COMMIT_B);
  });

  it('on a leaf the reader frame shows, Export (plain view) turns the reader off there, says so, then exports the plain view (refinement (a))', async () => {
    const reader = { render: vi.fn(() => new Promise<never>(() => {})), mount: vi.fn(), images: vi.fn() } as unknown as ReaderDeps;
    navigate('/docs/demo/specs/a.md');
    const { container } = render(<DocsScreen path={location.pathname} search={location.search} loaders={fakeLoaders().loaders} parser={parser} reader={reader} />);
    const plain = await screen.findByRole('button', { name: DOCS_HEAD_TEXT.exportPlainView });
    expect(container.querySelector('.docs-reader')).not.toBeNull();
    fireEvent.click(plain);
    expect(await screen.findByText(DOCS_HEAD_TEXT.exportPlainShown)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.doc-body')).not.toBeNull());
    expect(container.querySelector('.docs-reader')).toBeNull();
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect(doc.querySelector('meta[name="ccrc:view"]')?.getAttribute('content')).toBe('plain');
  });

  it('leaving the page brings the reader back, on a later return too (refinement (a))', async () => {
    const reader = { render: vi.fn(() => new Promise<never>(() => {})), mount: vi.fn(), images: vi.fn() } as unknown as ReaderDeps;
    const f = fakeLoaders();
    function WithReader(): ReactNode {
      const { path, search } = useLocation();
      return <DocsScreen path={path} search={search} loaders={f.loaders} parser={parser} reader={reader} />;
    }
    navigate('/docs/demo/specs/a.md');
    const { container } = render(<WithReader />);
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.exportPlainView }));
    await waitFor(() => expect(container.querySelector('.doc-body')).not.toBeNull());
    await act(async () => { navigate('/docs/demo/specs'); });
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    await act(async () => { navigate('/docs/demo/specs/a.md'); });
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.exportPlainView })).toBeEnabled();
    expect(container.querySelector('.docs-reader')).not.toBeNull();
    expect(screen.queryByText(DOCS_HEAD_TEXT.exportPlainShown)).toBeNull();
  });

  it('a raster leaf: Export waits for its own image, then exports its bytes; an image that failed disables it (M4.EX12, refinement (j))', async () => {
    const tree = treeOk({ entries: [entry('specs', 'x.png')] });
    const f = fakeLoaders({ tree: okTree(tree) });
    const image = deferredOf<DocsRasterAnswer>();
    f.raster.mockImplementation(() => image.promise);
    open('/docs/demo/specs/x.png', f);
    expect(await screen.findByRole('button', { name: busy(updatingTo(COMMIT_A)) })).toBeDisabled();
    await act(async () => { image.resolve(okPng()); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect([...doc.querySelectorAll('img')].map((i) => i.getAttribute('src')?.slice(0, 22))).toEqual(['data:image/png;base64,']);
    cleanup();
    open('/docs/demo/specs/x.png', fakeLoaders({ tree: okTree(tree) }));
    expect(await screen.findByRole('button', { name: busy(EXPORT_WAIT_TEXT['image-failed']) })).toBeDisabled();
  });

  // ---- Task 12: every arm of exportStateFor is reached by a screen case ----

  it('a Markdown leaf over the render gate reads Choose Format or Show as text first; after Show as text, Export saves the text (the gate and plain arms)', async () => {
    const big = '# Big\n\n' + 'x'.repeat(DOCS_RENDER_GATE_BYTES);
    open('/docs/demo/specs/a.md', fakeLoaders({ file: okFile(big) }));
    expect(await screen.findByRole('button', { name: busy(EXPORT_WAIT_TEXT.gate) })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show as text' }));
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect(doc.querySelector('pre.ccrc-export-plain')?.textContent).toBe(big);
  });

  it('x.txt is exportable at once; x.ts reads Highlighting… until its store settles, then exports (the text arm, both halves)', async () => {
    const docs = inThreadHighlighter({ hold: true });
    const tree = treeOk({ entries: [entry('specs', 'x.ts'), entry('specs', 'x.txt')] });
    const f = byPath(tree, { 'x.ts': fileAs('x.ts', 'const a: number = 1;', 'text'), 'x.txt': fileAs('x.txt', 'plain words', 'text') });
    navigate('/docs/demo/specs/x.txt');
    render(<HighlighterContext value={inThreadContext(docs)}><Routed loaders={f.loaders} /></HighlighterContext>);
    await waitFor(() => expect(exportButton()).toBeEnabled());
    expect((await exported()).querySelector('pre.ccrc-export-plain')?.textContent).toBe('plain words');
    expect(docs.calls).toHaveLength(0);
    act(() => { navigate('/docs/demo/specs/x.ts'); });
    expect(await screen.findByRole('button', { name: busy(EXPORT_WAIT_TEXT.highlighting) })).toBeDisabled();
    await waitFor(() => expect(docs.calls).toHaveLength(1));
    await act(async () => { docs.release(); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    expect((await exported()).querySelector('pre code .hljs-keyword')?.textContent).toBe('const');
  });

  it('an SVG leaf is exportable from its bytes, and saves one svg data: image; an answer that is not svg offers no Export (the svg arm)', async () => {
    const tree = treeOk({ entries: [entry('specs', 'd.svg')] });
    open('/docs/demo/specs/d.svg', byPath(tree, { 'd.svg': fileAs('d.svg', SVG_TEXT, 'svg') }));
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect([...doc.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([SVG_DATA]);
    cleanup();
    const other = byPath(tree, { 'd.svg': fileAs('d.svg', '# not svg', 'markdown') });
    open('/docs/demo/specs/d.svg', other);
    await waitFor(() => expect(other.file).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(document.querySelector('.docs-actions')).not.toBeNull();
    expect(document.querySelector('.docs-export')).toBeNull();
  });

  it('a leaf whose file failed or is over its class cap offers no Export (refinement (k))', async () => {
    open('/docs/demo/specs/a.md', byPath(treeOk(), {}));
    expect(await screen.findByText(DOCS_FAILURE_SENTENCE['absent-path'])).toBeInTheDocument();
    expect(document.querySelector('.docs-export')).toBeNull();
    cleanup();
    const big = treeOk({ entries: [entry('specs', 'a.md', { committed: { kind: 'file', blob: '1'.repeat(40), size: DOCS_CLASS_CAP.markdown + 1 } })] });
    open('/docs/demo/specs/a.md', byPath(big, {}));
    expect(await screen.findByText(/^This file is 2049 KiB; Docs shows files of this kind up to 2048 KiB/)).toBeInTheDocument();
    expect(document.querySelector('.docs-export')).toBeNull();
  });

  it('a raster listed over its cap offers no Export', async () => {
    const tree = treeOk({ entries: [entry('specs', 'p.png', { committed: { kind: 'file', blob: '2'.repeat(40), size: DOCS_CLASS_CAP.raster + 1 } })] });
    open('/docs/demo/specs/p.png', byPath(tree, {}));
    expect(await screen.findByText('Image not loaded: it is 2049 KiB; Docs shows images up to 2048 KiB')).toBeInTheDocument();
    expect(document.querySelector('.docs-export')).toBeNull();
  });
});
