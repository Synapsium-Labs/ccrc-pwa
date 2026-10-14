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
import { pinFor, type DocsVisit } from '../src/docs/useDocsVisit';
import { DOCS_FAILURE_SENTENCE, DOCS_PAGE_INVALID_SENTENCE } from '../src/docs/docsText';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import type { DocsFileAnswer, DocsLoaders, DocsRasterAnswer } from '../src/docs/failures';
import { parseMarkdown } from '../src/lib/markdownParse';
import { docsRunner, type MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import {
  BLOB_1, COMMIT_A, COMMIT_B, FP_1, RAN, draftOf, entry, failedAnswer, fakeLoaders, fileResponse, holder,
  okRefresh, okTree, pageAt, treeOk, treeResponse, type FakeLoaders,
} from './docsFixtures';

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
    expect(a).toHaveTextContent('? specs · 1 plans · 0 design · 0 conventions');
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
    const { container } = open('/docs/demo/specs/x.ts', f);
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
    fireEvent.click(container.querySelector('.docs-leaf button.doc-img-link') as HTMLElement);
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
    fireEvent.click(container.querySelector('.docs-leaf button.doc-img-link') as HTMLElement);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(history.length).toBe(length);
    expect(here()).toBe(url);
    const pins = f.raster.mock.calls.map((c) => (c[1] as DocPin).kind);
    expect(pins).toEqual(['committed']);
  });
});
