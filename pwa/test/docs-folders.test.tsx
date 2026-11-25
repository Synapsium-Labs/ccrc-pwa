// X2 P2.4 (native Docs parity plan, Task P2.4): outside folders in the console. The page grammar (`~<label>` is a folder,
// never a project), the index group, the folder pages and their reads, Settings' Docs folders section, and the one place
// a folder's absolute path may be drawn. Neutral fixtures only: labels `notes` and `team-a`, paths `/home/user/notes`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  docsPageUrl, parseDocsPage,
  type DocsFolderEntry, type DocsFolderTreeOk, type DocsIndexOk, type DocsProjectsResponse,
} from '../../shared/docs';
import { DocsScreen } from '../src/screens/DocsScreen';
import { DocsFoldersSection } from '../src/screens/settings/DocsFoldersSection';
import { DOCS_FOLDER_TEXT, DOCS_PAGE_INVALID_SENTENCE, DOCS_FAILURE_SENTENCE } from '../src/docs/docsText';
import { folderActions, folderReadPlan, folderTruthLine } from '../src/docs/folderPage';
import type { DocsFolderLoaders } from '../src/docs/folderPage';
import type { DocsAnswer } from '../src/docs/failures';
import { ApiError } from '../src/lib/apiError';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { api } from '../src/lib/api';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { renderSettings } from './settingsHost';
import { navigate, useLocation } from '../src/lib/router';
import { COMMIT_B, fakeLoaders, failedAnswer } from './docsFixtures';

const FP = 'f'.repeat(64);
const MTIME = '1700000000000000000';
const MTIME_TEXT = '2023-11-14 22:13 UTC';
/** The time of the bytes the show read: an hour after the listing's, so a page that wrongly shows the listing's is seen. */
const SHOW_MTIME = '1700003600000000000';
const SHOW_MTIME_TEXT = '2023-11-14 23:13 UTC';
const FOLDER_PATH = '/home/user/notes';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('parseDocsPage: ~label is a folder, never a project', () => {
  it('a folder root, a folder section and a folder leaf parse to folder locations and round-trip', () => {
    const root = parseDocsPage('/docs/~notes', '');
    expect(root).toEqual({ ok: true, loc: { kind: 'folder', label: 'notes' }, canonical: '/docs/~notes' });
    const section = parseDocsPage('/docs/~notes/specs', '');
    expect(section).toEqual({ ok: true, loc: { kind: 'folder-section', label: 'notes', section: 'specs' }, canonical: '/docs/~notes/specs' });
    const leaf = parseDocsPage('/docs/~notes/specs/a/b.md', '');
    expect(leaf).toEqual({
      ok: true, loc: { kind: 'folder-path', label: 'notes', section: 'specs', path: 'a/b.md', dirSlash: false },
      canonical: '/docs/~notes/specs/a/b.md',
    });
    const dir = parseDocsPage('/docs/~notes/specs/a/', '');
    expect(dir).toEqual({
      ok: true, loc: { kind: 'folder-path', label: 'notes', section: 'specs', path: 'a', dirSlash: true },
      canonical: '/docs/~notes/specs/a/',
    });
    for (const p of [root, section, leaf, dir]) {
      if (!p.ok) throw new Error('unreachable');
      expect(parseDocsPage(p.canonical, '')).toEqual(p);
      expect(docsPageUrl(p.loc)).toBe(p.canonical);
    }
  });

  it('a tilde page has no project: the project grammar never admits it', () => {
    const p = parseDocsPage('/docs/~notes', '');
    expect(p.ok && p.loc.kind).toBe('folder');
    expect(p.ok && 'project' in p.loc).toBe(false);
  });

  it('a label outside the grammar is page-invalid with its own word and sentence', () => {
    for (const bad of ['/docs/~', '/docs/~Notes', '/docs/~-a', '/docs/~a.b', '/docs/~' + 'a'.repeat(33), '/docs/~a%20b']) {
      expect(parseDocsPage(bad, ''), bad).toEqual({ ok: false, why: 'bad-label' });
    }
    expect(DOCS_PAGE_INVALID_SENTENCE['bad-label']).toMatch(/label/);
  });

  it('?ref= on a folder page is refused as an unknown key, as the index refuses it', () => {
    expect(parseDocsPage('/docs/~notes', '?ref=main')).toEqual({ ok: false, why: 'unknown-param' });
    expect(parseDocsPage('/docs/~notes/specs/a.md', '?ref=main')).toEqual({ ok: false, why: 'unknown-param' });
    expect(parseDocsPage('/docs/~notes/specs/a.md', '?view=committed')).toEqual({ ok: false, why: 'unknown-param' });
    expect(parseDocsPage('/docs', '?ref=main')).toEqual({ ok: false, why: 'unknown-param' });
  });

  it('a bad section or path under a folder keeps the project grammar words', () => {
    expect(parseDocsPage('/docs/~notes/nope', '')).toEqual({ ok: false, why: 'bad-section' });
    expect(parseDocsPage('/docs/~notes/specs/../x', '')).toEqual({ ok: false, why: 'bad-path' });
  });
});

// ---- fixtures ------------------------------------------------------------------------------------------------------

const file = (section: DocsFolderEntry['section'], path: string, over: Partial<DocsFolderEntry> = {}): DocsFolderEntry =>
  ({ section, path, kind: 'file', size: 5, mtimeNs: MTIME, fp: FP, ...over });

const TREE: DocsFolderTreeOk = {
  v: 1, verb: 'docs-folder-read', ok: true, elapsedMs: 2, label: 'notes',
  entries: [
    file('specs', 'a.md'),
    file('specs', 'd/x.md'),
    { section: 'plans', path: 'link.md', kind: 'symlink', size: null, mtimeNs: null, fp: null },
  ],
  unlisted: { count: 0, byReason: {} },
};

const ok = <T,>(value: T): DocsAnswer<T> => ({ s: 'ok', value });

interface FakeFolders {
  readonly folders: DocsFolderLoaders;
  readonly calls: string[];
}

/** Folder loaders that answer from `over`, recording every call by name (so a test sees the paths door is never called). */
function fakeFolders(over: Partial<DocsFolderLoaders> = {}): FakeFolders {
  const calls: string[] = [];
  const named = <A extends unknown[], R>(name: string, fn: (...a: A) => R) => (...a: A): R => { calls.push(name); return fn(...a); };
  const folders: DocsFolderLoaders = {
    labels: named('labels', async () => ok({ ok: true as const, folders: [{ label: 'notes', state: 'ok' as const }, { label: 'team-a', state: 'unreadable' as const }] })),
    paths: named('paths', async () => ok({ ok: true as const, folders: [
      { label: 'notes', path: FOLDER_PATH, state: 'ok' as const }, { label: 'team-a', path: null, state: 'unreadable' as const }] })),
    add: named('add', async (label: string) => ok({ ok: true as const, label })),
    remove: named('remove', async (label: string) => ok({ ok: true as const, label, removed: true as const })),
    tree: named('tree', async () => ok({ ok: true as const, tree: TREE })),
    file: named('file', async (_l: string, section, path) => ok({
      ok: true as const, contentClass: 'markdown' as const,
      show: {
        v: 1 as const, verb: 'docs-folder-read' as const, ok: true as const, elapsedMs: 1, label: 'notes', source: 'folder' as const,
        section, path, size: 5, sha256: FP, fp: FP, mtimeNs: SHOW_MTIME, encoding: 'utf8' as const, text: 'hello folder',
      },
    })),
    range: {
      prepare: named('range-prepare', () => new Promise(() => undefined)),
      frame: named('range-frame', () => new Promise(() => undefined)),
    },
  };
  // An override is recorded by name too, so a test sees which doors a page asked.
  const wrapped: Record<string, unknown> = { ...folders };
  for (const [name, fn] of Object.entries(over)) {
    if (typeof fn === 'function') wrapped[name] = (...a: unknown[]) => { calls.push(name); return (fn as (...x: unknown[]) => unknown)(...a); };
    else wrapped[name] = fn;
  }
  return { folders: wrapped as unknown as DocsFolderLoaders, calls };
}

function indexAnswer(): DocsProjectsResponse {
  const index: DocsIndexOk = {
    v: 1, verb: 'docs-index', ok: true, elapsedMs: 5, unlisted: 0, duplicates: [],
    projects: [{
      project: 'demo', state: 'ready', github: { state: 'none' }, default: { name: 'main', via: 'default:origin-head', commit: COMMIT_B },
      sections: { specs: 1, plans: 1, 'product-design': 1, conventions: 1 },
    }],
  };
  return { ok: true, index, cacheAgeMs: 1 };
}

function Routed(p: { readonly folders: DocsFolderLoaders; readonly loaders: ReturnType<typeof fakeLoaders>['loaders'] }): ReactNode {
  const { path, search } = useLocation();
  return <DocsScreen path={path} search={search} loaders={p.loaders} folders={p.folders} parser={async () => ({ kind: 'worker-unavailable' }) as never} reader={null} />;
}

function open(url: string, f: FakeFolders): ReturnType<typeof render> {
  const base = fakeLoaders();
  base.projects.mockResolvedValue({ s: 'ok', value: indexAnswer() });
  navigate(url);
  return render(<Routed folders={f.folders} loaders={base.loaders} />);
}

const bodyText = (): string => document.body.textContent ?? '';

// ---- the index ------------------------------------------------------------------------------------------------------

describe('index: folders listed after projects', () => {
  it('lists the labels in a group after the project rows, each linking to its folder page, from the labels read alone', async () => {
    const f = fakeFolders();
    open('/docs', f);
    await screen.findByText('~notes');
    const rows = [...document.querySelectorAll('.docs-rows .docs-row-name')].map((n) => n.textContent);
    expect(rows).toEqual(['demo', '~notes', '~team-a']);
    const group = document.querySelector('.docs-folders');
    expect(group).not.toBeNull();
    expect(within(group as HTMLElement).getByText('~team-a').closest('.docs-row')?.getAttribute('data-state')).toBe('unreadable');
    fireEvent.click(screen.getByText('~notes'));
    await waitFor(() => expect(location.pathname).toBe('/docs/~notes'));
    expect(f.calls).not.toContain('paths');
  });

  it('a refused labels read draws one quiet line, no group and no error banner', async () => {
    const f = fakeFolders({ labels: async () => ({ s: 'failed', body: { ok: false, failure: 'auth-off' } }) });
    open('/docs', f);
    await screen.findByText(DOCS_FOLDER_TEXT.indexNeedsSignIn);
    expect(document.querySelector('.docs-folders')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await screen.findByText('demo');
  });

  it('an empty registry draws nothing', async () => {
    const f = fakeFolders({ labels: async () => ok({ ok: true as const, folders: [] }) });
    open('/docs', f);
    await screen.findByText('demo');
    await waitFor(() => expect(f.calls).toContain('labels'));
    expect(document.querySelector('.docs-folders')).toBeNull();
    expect(document.querySelector('.docs-folders-quiet')).toBeNull();
  });
});

// ---- the folder pages -----------------------------------------------------------------------------------------------

describe('folder page: truth line and actions', () => {
  const truth = (): string | null | undefined => document.querySelector('[data-truth="folder"]')?.textContent;

  it('truth line says Not in a repository with the file\'s modified time, the time of the read that gave the bytes', async () => {
    const f = fakeFolders();
    open('/docs/~notes/specs/a.md', f);
    await screen.findByText('hello folder');
    // The listing says one time and the show another: the page shows the show's.
    expect(truth()).toBe(`Not in a repository · modified ${SHOW_MTIME_TEXT}`);
    expect(document.body.textContent).not.toContain(MTIME_TEXT);
    expect(folderTruthLine(MTIME)).toBe(`Not in a repository · modified ${MTIME_TEXT}`);
    expect(folderTruthLine(null)).toBe('Not in a repository');
  });

  it('the truth line says its first clause alone until the bytes arrive, and after a failed read', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((r) => { release = r; });
    const base = fakeFolders();
    const f = fakeFolders({
      file: async (...a: Parameters<DocsFolderLoaders['file']>) => { await held; return base.folders.file(...a); },
    });
    open('/docs/~notes/specs/a.md', f);
    await waitFor(() => expect(f.calls).toContain('file'));
    expect(truth()).toBe('Not in a repository');
    release?.();
    await screen.findByText('hello folder');
    expect(truth()).toBe(`Not in a repository · modified ${SHOW_MTIME_TEXT}`);
    cleanup();
    const bad = fakeFolders({ file: async () => failedAnswer('unreadable-path') });
    open('/docs/~notes/specs/a.md', bad);
    await screen.findByRole('alert');
    expect(truth()).toBe('Not in a repository');
  });

  it('a range read says its first clause alone: its prepare answer carries no time, so the listing\'s is never shown as the read\'s', async () => {
    const tree: DocsFolderTreeOk = { ...TREE, entries: [file('specs', 'big.md', { size: 3 * 1024 * 1024 })] };
    const f = fakeFolders({ tree: async () => ok({ ok: true as const, tree }) });
    open('/docs/~notes/specs/big.md', f);
    await waitFor(() => expect(f.calls).toContain('range-prepare'));
    expect(truth()).toBe('Not in a repository');
  });

  it('history, changes, versions, GitHub and Share are off with their reasons', async () => {
    const f = fakeFolders();
    open('/docs/~notes/specs/a.md', f);
    await screen.findByText('hello folder');
    for (const a of folderActions()) {
      const button = document.querySelector(`button[data-action="${a.action}"]`) as HTMLButtonElement;
      expect(button.disabled, a.action).toBe(true);
      expect(screen.getByText(a.reason)).toBeTruthy();
      expect(a.reason).toMatch(/outside a repository/);
    }
    expect(folderActions().map((a) => a.action)).toEqual(['history', 'changes', 'versions', 'github', 'share']);
  });

  it('the folder pages read the tree and the file doors only: never the paths door, never a project door', async () => {
    const f = fakeFolders();
    const base = fakeLoaders();
    navigate('/docs/~notes/specs/a.md');
    render(<Routed folders={f.folders} loaders={base.loaders} />);
    await screen.findByText('hello folder');
    expect(f.calls).toEqual(['tree', 'file']);
    expect(base.tree).not.toHaveBeenCalled();
    expect(base.file).not.toHaveBeenCalled();
  });

  it('the absolute path is drawn on no page outside Settings: not on the index, the root, a listing or a leaf', async () => {
    for (const url of ['/docs', '/docs/~notes', '/docs/~notes/specs', '/docs/~notes/specs/d/', '/docs/~notes/specs/a.md']) {
      const f = fakeFolders();
      open(url, f);
      await waitFor(() => expect(f.calls.length).toBeGreaterThan(0));
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(bodyText(), url).not.toContain(FOLDER_PATH);
      expect(bodyText(), url).not.toContain('/home/user');
      expect(f.calls, url).not.toContain('paths');
      cleanup();
    }
  });

  it('a folder root lists its sections and a section lists its rows, with links under /docs/~label', async () => {
    const f = fakeFolders();
    open('/docs/~notes', f);
    await screen.findByText('specs');
    fireEvent.click(screen.getByText('specs'));
    await waitFor(() => expect(location.pathname).toBe('/docs/~notes/specs'));
    await screen.findByText('a.md');
    fireEvent.click(screen.getByText('d/'));
    await waitFor(() => expect(location.pathname).toBe('/docs/~notes/specs/d/'));
    await screen.findByText('x.md');
  });

  it('an entry that is no regular file is listed with its kind and opens nothing', async () => {
    const f = fakeFolders();
    open('/docs/~notes/plans/link.md', f);
    await screen.findByText(DOCS_FOLDER_TEXT.notAFile);
    expect(f.calls).toEqual(['tree']);
  });

  it('folder: removed while open: the next read says the folder is gone', async () => {
    const f = fakeFolders({ tree: async () => failedAnswer('unknown-folder') });
    open('/docs/~notes/specs/a.md', f);
    await screen.findByText(DOCS_FAILURE_SENTENCE['unknown-folder']);
  });

  it('a bad label in the address is page-invalid, with a link to the index and no read', async () => {
    const f = fakeFolders();
    open('/docs/~Bad', f);
    await screen.findByText(DOCS_PAGE_INVALID_SENTENCE['bad-label']);
    expect(f.calls).toEqual([]);
  });

  it('a file above the class cap or with no fingerprint is read by range, pinned by fp or by size and time', () => {
    const big = file('specs', 'big.md', { size: 3 * 1024 * 1024 });
    expect(folderReadPlan(big)).toEqual({ mode: 'range', range: { kind: 'fp', sha: FP }, size: 3 * 1024 * 1024 });
    const noFp = file('specs', 'nofp.md', { fp: null });
    expect(folderReadPlan(noFp)).toEqual({ mode: 'range', range: { kind: 'stat', size: 5, mtimeNs: MTIME }, size: 5 });
    expect(folderReadPlan(file('specs', 'x.md', { fp: null, mtimeNs: null }))).toEqual({ mode: 'none', why: 'unpinned' });
    expect(folderReadPlan(file('specs', 'x.md', { size: 80 * 1024 * 1024, fp: null }))).toEqual({ mode: 'none', why: 'too-large' });
    expect(folderReadPlan(file('specs', 'x.png'))).toEqual({ mode: 'none', why: 'no-preview' });
  });

  it('a large folder file reads through the folder range door (prepare), not the file door', async () => {
    const tree: DocsFolderTreeOk = { ...TREE, entries: [file('specs', 'big.md', { size: 3 * 1024 * 1024 })] };
    const f = fakeFolders({ tree: async () => ok({ ok: true as const, tree }) });
    open('/docs/~notes/specs/big.md', f);
    // The leaf is a range leaf (RangeLeaf), which reads by prepare and frames; the file door is never asked.
    await waitFor(() => expect(f.calls).toContain('range-prepare'));
    expect(f.calls).not.toContain('file');
  });
});

describe('folder leaf: rendered as a draft is, with the folder\'s own links', () => {
  const mdFile = (text: string): Partial<DocsFolderLoaders> => ({
    file: async (_l, section, path) => ok({
      ok: true as const, contentClass: 'markdown' as const,
      show: {
        v: 1 as const, verb: 'docs-folder-read' as const, ok: true as const, elapsedMs: 1, label: 'notes', source: 'folder' as const,
        section, path, size: text.length, sha256: FP, fp: FP, mtimeNs: MTIME, encoding: 'utf8' as const, text,
      },
    }),
  });

  it('a folder .md leaf renders its heading as a heading, not as source', async () => {
    const f = fakeFolders(mdFile('# The Title\n\nSome *words*.\n'));
    open('/docs/~notes/specs/a.md', f);
    const h = await screen.findByRole('heading', { name: 'The Title' });
    expect(h.tagName).toBe('H1');
    expect(document.querySelector('.docs-folder-body pre.doc-plain')).toBeNull();
    expect(document.querySelector('.docs-folder-body article')).not.toBeNull();
  });

  it('a relative link resolves under /docs/~label/, and a link out of the six sections is not followed', async () => {
    const f = fakeFolders(mdFile('# T\n\n[sibling](b.md) [deep](d/x.md#top) [out](../../elsewhere.md) [web](https://example.com/x)\n'));
    open('/docs/~notes/specs/a.md', f);
    const sibling = await screen.findByRole('link', { name: 'sibling' });
    expect(sibling.getAttribute('href')).toBe('/docs/~notes/specs/b.md');
    expect(screen.getByRole('link', { name: 'deep' }).getAttribute('href')).toBe('/docs/~notes/specs/d/x.md#top');
    expect(screen.queryByRole('link', { name: 'out' })).toBeNull();
    expect(document.querySelector('.doc-link-inert')?.textContent).toBe('out');
    fireEvent.click(sibling);
    await waitFor(() => expect(location.pathname).toBe('/docs/~notes/specs/b.md'));
  });

  it('a relative image in folder Markdown is refused, never a crash: the text around it still renders', async () => {
    const f = fakeFolders(mdFile('# Pics\n\nbefore ![x](fig.png) and ![y](d.svg) after\n'));
    open('/docs/~notes/specs/a.md', f);
    await screen.findByRole('heading', { name: 'Pics' });
    expect(screen.getByText(/before/)).toBeTruthy();
    expect(screen.getByText(/after/)).toBeTruthy();
    expect(document.querySelector('.docs-folder-body img')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(f.calls).toEqual(['tree', 'file']);
  });

  it('a changed file recovers on Retry: the tree is read again and the file opens on the second try', async () => {
    let reads = 0;
    const base = fakeFolders();
    const f = fakeFolders({
      file: async (...a: Parameters<DocsFolderLoaders['file']>) => {
        reads += 1;
        return reads === 1 ? failedAnswer('draft-changed', { now: 'present' }) : base.folders.file(...a);
      },
    });
    open('/docs/~notes/specs/a.md', f);
    fireEvent.click(await screen.findByRole('button', { name: DOCS_FOLDER_TEXT.retry }));
    await screen.findByText('hello folder');
    expect(f.calls.filter((c) => c === 'tree')).toHaveLength(2);
    expect(reads).toBe(2);
  });

  it('a file URL with a trailing slash still shows the leaf', async () => {
    const f = fakeFolders();
    open('/docs/~notes/specs/a.md/', f);
    await screen.findByText('hello folder');
  });

  it('plain text stays source, as the project leaf shows it', async () => {
    const tree: DocsFolderTreeOk = { ...TREE, entries: [file('specs', 'n.txt')] };
    const f = fakeFolders({ tree: async () => ok({ ok: true as const, tree }), ...mdFile('plain words') });
    open('/docs/~notes/specs/n.txt', f);
    await waitFor(() => expect(document.querySelector('pre.doc-plain')?.textContent).toBe('plain words'));
  });
});

describe('settings: the Docs folders card sits on the Integrations section', () => {
  it('rendering Settings › Integrations shows the Docs folders card, a level-3 card after the three that were there', async () => {
    const never = (): Promise<never> => new Promise(() => {});
    vi.stubGlobal('fetch', vi.fn((): Promise<never> => never()));
    for (const name of ['updates', 'stallWatch', 'collectLane', 'dispatchAbandon', 'testbox'] as const) {
      vi.spyOn(api, name).mockImplementation(never);
    }
    vi.spyOn(api, 'linearWorkspaces').mockResolvedValue({ store: 'ok', workspaces: [], legacy: null });
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects: [] });
    vi.spyOn(api, 'hierarchy').mockRejectedValue(new ApiError(404, { ok: false }));
    renderSettings('integrations');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const levels = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    const card = SETTINGS_CARDS.integrations.docsFolders;
    expect(levels).toEqual(['Linear', 'Project linking', 'GitHub', card.title]);
    const region = screen.getByRole('region', { name: card.title });
    expect(within(region).getByText(card.scope)).toBeTruthy();
    expect(within(region).getByText(card.purpose)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

// ---- Settings -------------------------------------------------------------------------------------------------------

describe('settings: Docs folders section', () => {
  it('lists each folder by label with its path, an unreadable one by that word with no path, still removable', async () => {
    const f = fakeFolders();
    render(<DocsFoldersSection folders={f.folders} />);
    await screen.findByText(FOLDER_PATH);
    const bad = document.querySelector('li[data-folder="team-a"]') as HTMLElement;
    expect(bad.textContent).toContain(DOCS_FOLDER_TEXT.unreadableState);
    expect(within(bad).getByRole('button', { name: DOCS_FOLDER_TEXT.remove })).toBeTruthy();
  });

  it('add and remove round trip, refusal reason shown', async () => {
    let rows = [{ label: 'notes', path: FOLDER_PATH, state: 'ok' as const }];
    const add = vi.fn(async (label: string, path: string): Promise<DocsAnswer<{ ok: true; label: string }>> => {
      if (label === 'taken') return { s: 'failed', body: { ok: false, failure: 'label-exists' } };
      rows = [...rows, { label, path, state: 'ok' }];
      return ok({ ok: true, label });
    });
    const remove = vi.fn(async (label: string): Promise<DocsAnswer<{ ok: true; label: string; removed: true }>> => {
      rows = rows.filter((r) => r.label !== label);
      return ok({ ok: true, label, removed: true });
    });
    const f = fakeFolders({ paths: async () => ok({ ok: true as const, folders: rows }), add, remove });
    render(<DocsFoldersSection folders={f.folders} />);
    await screen.findByText(FOLDER_PATH);
    fireEvent.change(screen.getByLabelText(DOCS_FOLDER_TEXT.labelField), { target: { value: 'team-a' } });
    fireEvent.change(screen.getByLabelText(DOCS_FOLDER_TEXT.pathField), { target: { value: '/home/user/team' } });
    fireEvent.click(screen.getByRole('button', { name: DOCS_FOLDER_TEXT.add }));
    await screen.findByText('/home/user/team');
    expect(add).toHaveBeenCalledWith('team-a', '/home/user/team');
    expect(screen.getByText(DOCS_FOLDER_TEXT.added)).toBeTruthy();
    // A refusal says its reason.
    fireEvent.change(screen.getByLabelText(DOCS_FOLDER_TEXT.labelField), { target: { value: 'taken' } });
    fireEvent.change(screen.getByLabelText(DOCS_FOLDER_TEXT.pathField), { target: { value: '/home/user/other' } });
    fireEvent.click(screen.getByRole('button', { name: DOCS_FOLDER_TEXT.add }));
    await screen.findByText(DOCS_FAILURE_SENTENCE['label-exists']);
    // Remove.
    const row = document.querySelector('li[data-folder="notes"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: DOCS_FOLDER_TEXT.remove }));
    await waitFor(() => expect(document.querySelector('li[data-folder="notes"]')).toBeNull());
    expect(remove).toHaveBeenCalledWith('notes');
  });

  it('an account gate refusal of Add is its own fixed sentence', async () => {
    const add = vi.fn(async () => { throw new ApiError(403, { ok: false, error: 'insecure-origin' }); });
    const f = fakeFolders({ add });
    render(<DocsFoldersSection folders={f.folders} />);
    await screen.findByText(FOLDER_PATH);
    fireEvent.change(screen.getByLabelText(DOCS_FOLDER_TEXT.labelField), { target: { value: 'team-a' } });
    fireEvent.change(screen.getByLabelText(DOCS_FOLDER_TEXT.pathField), { target: { value: '/home/user/team' } });
    fireEvent.click(screen.getByRole('button', { name: DOCS_FOLDER_TEXT.add }));
    await screen.findByText(DOCS_FOLDER_TEXT.gateRefusal['insecure-origin']!);
  });

  it('a label outside the grammar cannot be added: the button stays off', async () => {
    const f = fakeFolders();
    render(<DocsFoldersSection folders={f.folders} />);
    await screen.findByText(FOLDER_PATH);
    fireEvent.change(screen.getByLabelText(DOCS_FOLDER_TEXT.labelField), { target: { value: 'Bad Label' } });
    fireEvent.change(screen.getByLabelText(DOCS_FOLDER_TEXT.pathField), { target: { value: '/home/user/team' } });
    expect((screen.getByRole('button', { name: DOCS_FOLDER_TEXT.add }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sign-in dark: auth-off says what to do, with no list, no Add form and no spinner', async () => {
    for (const [failure, sentence] of [['auth-off', DOCS_FOLDER_TEXT.signInNeeded], ['unauthenticated', DOCS_FOLDER_TEXT.signInAgain]] as const) {
      const f = fakeFolders({ paths: async () => ({ s: 'failed', body: { ok: false, failure } }) });
      render(<DocsFoldersSection folders={f.folders} />);
      await screen.findByText(sentence);
      expect(document.querySelector('[data-docs-folders="list"]')).toBeNull();
      expect(document.querySelector('[data-docs-folders="empty"]')).toBeNull();
      expect(document.querySelector('[data-docs-folders="add"]')).toBeNull();
      expect(document.querySelector('[data-docs-folders="loading"]')).toBeNull();
      expect(screen.queryByText(DOCS_FOLDER_TEXT.settingsEmpty)).toBeNull();
      expect(screen.queryByText(DOCS_FOLDER_TEXT.settingsReading)).toBeNull();
      expect(document.querySelector('[role="progressbar"], .spinner')).toBeNull();
      cleanup();
    }
    expect(DOCS_FOLDER_TEXT.signInNeeded).toBe('Turn sign-in on to see and add folders.');
    expect(DOCS_FOLDER_TEXT.signInAgain).toBe('Sign in to see and add folders.');
  });

  it('the client auth slot says sign in (sign-in is on then), and a sign-in again reads the list again', async () => {
    let answer: 'auth' | 'ok' = 'auth';
    const f = fakeFolders({
      paths: async () => (answer === 'auth' ? { s: 'auth' as const } : ok({ ok: true as const, folders: [{ label: 'notes', path: FOLDER_PATH, state: 'ok' as const }] })),
    });
    render(<DocsFoldersSection folders={f.folders} />);
    await screen.findByText(DOCS_FOLDER_TEXT.signInAgain);
    answer = 'ok';
    act(() => { raiseAuthLost('expired'); });
    act(() => { clearAuthLost(); });
    await screen.findByText(FOLDER_PATH);
    expect(f.calls.filter((c) => c === 'paths')).toHaveLength(2);
  });

  it('a refused Remove says why, in the refusal\'s own sentence, never "could not be read"', async () => {
    const f = fakeFolders({ remove: async () => failedAnswer('unknown-folder') });
    render(<DocsFoldersSection folders={f.folders} />);
    await screen.findByText(FOLDER_PATH);
    fireEvent.click(within(document.querySelector('li[data-folder="notes"]') as HTMLElement).getByRole('button', { name: DOCS_FOLDER_TEXT.remove }));
    await screen.findByText(DOCS_FAILURE_SENTENCE['unknown-folder']);
    expect(bodyText()).not.toContain(DOCS_FOLDER_TEXT.settingsUnread);
    cleanup();
    const gate = fakeFolders({ remove: async () => { throw new ApiError(403, { ok: false, error: 'unauthenticated' }); } });
    render(<DocsFoldersSection folders={gate.folders} />);
    await screen.findByText(FOLDER_PATH);
    fireEvent.click(within(document.querySelector('li[data-folder="notes"]') as HTMLElement).getByRole('button', { name: DOCS_FOLDER_TEXT.remove }));
    await screen.findByText(DOCS_FOLDER_TEXT.gateRefusal.unauthenticated);
  });

  it('api.docs.folders: a gate refusal (403 {error:"step-up-required"}) rejects as an ApiError; a docs word (4xx {failure:"label-exists"}) resolves failed', async () => {
    const reply = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const fetchStub = vi.fn(async (_url: string, _init?: RequestInit) => reply(403, { ok: false, error: 'step-up-required' }));
    vi.stubGlobal('fetch', fetchStub);
    const refused = await api.docs.folders.add('notes', FOLDER_PATH).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).status).toBe(403);
    expect(((refused as ApiError).body as { error: string }).error).toBe('step-up-required');
    // The write carried the docs marker header and a JSON body of the label and path.
    const init = fetchStub.mock.calls[0]?.[1] ?? {};
    expect(new Headers(init.headers).get('x-ccrc-docs')).toBe('1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ label: 'notes', path: FOLDER_PATH });
    fetchStub.mockImplementation(async () => reply(409, { ok: false, failure: 'label-exists' }));
    const word = await api.docs.folders.add('notes', FOLDER_PATH);
    expect(word.s).toBe('failed');
    expect(word.s === 'failed' && word.body.failure).toBe('label-exists');
    vi.unstubAllGlobals();
  });

  it('Add refused step-up-required through the real client shows the "Confirm it\'s you" step, and does not claim success', async () => {
    const reply = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/docs-folders/paths')) return reply(200, { ok: true, folders: [{ label: 'notes', path: FOLDER_PATH, state: 'ok' }] });
      if (url.endsWith('/api/docs-folders') && init?.method === 'POST') return reply(403, { ok: false, error: 'step-up-required' });
      return reply(500, { ok: false });
    }));
    render(<DocsFoldersSection />);
    await screen.findByText(FOLDER_PATH);
    expect(document.querySelector('[data-step-up]')).toBeNull();
    fireEvent.change(screen.getByLabelText(DOCS_FOLDER_TEXT.labelField), { target: { value: 'team-a' } });
    fireEvent.change(screen.getByLabelText(DOCS_FOLDER_TEXT.pathField), { target: { value: '/home/user/team' } });
    fireEvent.click(screen.getByRole('button', { name: DOCS_FOLDER_TEXT.add }));
    await waitFor(() => expect(document.querySelector('[data-step-up]')).not.toBeNull());
    expect(screen.queryByText(DOCS_FOLDER_TEXT.added)).toBeNull();
    vi.unstubAllGlobals();
  });

  it('any other failed read says so with a Retry, never an empty list', async () => {
    const f = fakeFolders({ paths: async () => ({ s: 'unreachable' }) });
    render(<DocsFoldersSection folders={f.folders} />);
    await screen.findByRole('button', { name: DOCS_FOLDER_TEXT.retry });
    expect(document.querySelector('[data-docs-folders="empty"]')).toBeNull();
  });
});
