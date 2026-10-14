// Docs W5 part 1, Task 10: the Docs header (spec 2026-10-01 4.4's layout, 4.5, 4.7's placement; M4.T1, M4.T6, the
// base form of M4.T7 (row and leaf badge text equal), M4.F4; spec 2 row 54). The truth line on every page with a
// listing, every state of the freshness chip, View on GitHub per page kind (the project page through `root`), Open
// committed version (the commit never enters the URL), copy commit through `copyText`, "Updated to", back as up one
// level, and the phone crumbs. Unit cases render `DocsHead` over a hand-built visit; the rest mount `DocsScreen` with
// injected loaders. Placeholders only: project `demo`, branches `main` and `ws/a`, `/repo/...`,
// `example-org/example-repo`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  entryView,
  type DocPin, type DocsEntry, type DocsPageLocation, type DocsRefreshFetch, type DocsTreeOk, type DraftsFacts,
} from '../../shared/docs';
import { DocsHead, githubTargetFor, truthSource } from '../src/docs/DocsHead';
import { DocsTreeView } from '../src/docs/DocsTreeView';
import { ENTRY_BADGE_TEXT } from '../src/docs/docsText';
import type { DocsLoaders } from '../src/docs/failures';
import { copyText } from '../src/docs/share';
import type { DocsVisit, Freshness } from '../src/docs/useDocsVisit';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import { DocsScreen } from '../src/screens/DocsScreen';
import {
  BLOB_2, COMMIT_A, COMMIT_B, FP_1, RAN, SERVED, draftOf, entry, failedAnswer, fakeLoaders, fetchFailed, holder,
  okRefresh, okTree, pageAt, treeOk, treeResponse, type FakeLoaders,
} from './docsFixtures';

const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

function Routed(p: { readonly loaders: DocsLoaders }): ReactNode {
  const { path, search } = useLocation();
  return <DocsScreen path={path} search={search} loaders={p.loaders} parser={parser} />;
}

function open(url: string, f: FakeLoaders): ReturnType<typeof render> {
  navigate(url);
  return render(<Routed loaders={f.loaders} />);
}

const here = (): string => location.pathname + location.search;
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const MIN = 60_000;

/** A visit whose tree slot is `ok` for `tree`, received at `receivedAt`; every action a spy. */
function visitOf(tree: DocsTreeOk, over: Partial<DocsVisit> = {}, receivedAt = NOW): DocsVisit {
  return {
    tree: { s: 'ok', answer: treeResponse(tree), receivedAt },
    file: { s: 'none' }, freshness: { s: 'idle' }, updatedTo: null, pendingFragment: null,
    retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
    ...over,
  };
}

function head(url: string, tree: DocsTreeOk | null, over: Partial<DocsVisit> = {}): ReturnType<typeof render> {
  const visit = tree === null
    ? { ...visitOf(treeOk(), over), tree: null }
    : visitOf(tree, over);
  return render(<DocsHead page={pageAt(url)} visit={visit} tree={tree} />);
}

const q = (sel: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(sel);
  if (el === null) throw new Error(`no ${sel}`);
  return el;
};

/** A holder in a linked workspace, its HEAD the served commit. */
function workspaceHolder(path = '/repo/wt/a', cls: 'main' | 'workspace' | 'other' = 'workspace'): DraftsFacts {
  return {
    state: 'holder', branch: 'main', worktree: { path, head: COMMIT_A, class: cls }, baseEqual: true, base: null,
    caveats: [], opaque: [],
  };
}

function withRef(over: Partial<DocsTreeOk['ref']>, tree: DocsTreeOk = treeOk()): DocsTreeOk {
  return { ...tree, ref: { ...tree.ref, ...over } };
}

function withStamp(stamp: DocsTreeOk['freshness']['stamp'], remote: 'origin' | null = 'origin'): DocsTreeOk {
  const t = treeOk();
  return { ...t, freshness: { ...t.freshness, remote, stamp } };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
  history.replaceState(null, '', '/');
});

describe('the truth line on every page with a listing (M4.T1)', () => {
  it.each(['/docs/demo', '/docs/demo/specs', '/docs/demo/specs/d/', '/docs/demo/specs/d/x.md'])(
    '%s shows the served ref, the 8-hex commit, how it was chosen and the chip', async (url) => {
      open(url, fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'd/x.md')] })) }));
      await waitFor(() => expect(document.querySelector('.docs-truth')).not.toBeNull());
      expect(q('.docs-truth-ref')).toHaveTextContent(/^origin\/main$/);
      expect(q('.docs-truth-ref')).toHaveAttribute('title', SERVED);
      expect(q('.docs-truth-commit')).toHaveTextContent(/^aaaaaaaa$/);
      expect(q('.docs-truth-commit')).toHaveAttribute('title', COMMIT_A);
      expect(q('.docs-truth-via')).toHaveTextContent(/^default branch \(origin\/HEAD\)$/);
      expect(document.querySelector('.docs-truth-relation')).toBeNull();
      expect(q('.docs-fresh')).toHaveAttribute('data-state', 'never');
      expect(q('.docs-fresh')).toHaveTextContent(/^never fetched ↻$/);
    });

  it('a local side reads `<b> (local)`, with the full refname in its title', () => {
    const tree = withRef({
      requested: 'ws/a', served: 'refs/heads/ws/a', name: 'ws/a', side: 'local', via: 'local', relation: 'local-ahead',
      counterpart: { ref: 'refs/remotes/origin/ws/a', commit: COMMIT_B, ahead: 2, behind: 0, count: 'measured' },
    });
    head('/docs/demo?ref=ws/a', tree);
    expect(q('.docs-truth-ref')).toHaveTextContent(/^ws\/a \(local\)$/);
    expect(q('.docs-truth-ref')).toHaveAttribute('title', 'refs/heads/ws/a');
    expect(q('.docs-truth-via')).toHaveTextContent(/^you asked for ws\/a, showing local$/);
    expect(q('.docs-truth-relation')).toHaveTextContent(/^local is 2 ahead of origin$/);
    expect(q('.docs-truth-relation')).toHaveAttribute('data-tone', 'info');
  });

  it.each([
    ['qualified', 'local', 'diverged', { ahead: 2, behind: 3 }, 'exactly the ref you asked for', 'local and origin have diverged (2 vs 3), showing local', 'warn'],
    ['origin', 'origin', 'equal', { ahead: 0, behind: 0 }, "you asked for ws/a, showing origin's", 'local and origin agree', 'info'],
    // ccd counts from the served side: a local-behind tree serves origin, whose lead over local is `ahead`.
    ['origin', 'origin', 'local-behind', { ahead: 3, behind: 0 }, "you asked for ws/a, showing origin's", 'origin is 3 ahead of local', 'info'],
    ['origin', 'origin', 'origin-only', { ahead: 2, behind: 3 }, "you asked for ws/a, showing origin's", 'only on origin', 'info'],
    ['local', 'local', 'unmeasured', { ahead: 2, behind: 3 }, 'you asked for ws/a, showing local', 'local vs origin not measured', 'info'],
  ] as const)('via %s (%s served) with relation %s: the via sentence, then the relation (%s; %s; tone %s)',
    (via, side, relation, counts, viaText, relationText, tone) => {
      const tree = withRef({
        requested: 'ws/a', via, relation, side,
        counterpart: { ref: 'refs/remotes/origin/ws/a', commit: COMMIT_B, ahead: counts.ahead, behind: counts.behind, count: 'measured' },
      });
      head('/docs/demo?ref=ws/a', tree);
      expect(q('.docs-truth-via').textContent).toBe(viaText);
      expect(q('.docs-truth-relation').textContent).toBe(relationText);
      expect(q('.docs-truth-relation')).toHaveAttribute('data-tone', tone);
    });

  it('a default the server chose shows no relation sentence', () => {
    head('/docs/demo', withRef({ via: 'default:local-main', side: 'local', relation: 'local-only' }));
    expect(q('.docs-truth-via').textContent).toBe('default branch (local main; no origin branch)');
    expect(document.querySelector('.docs-truth-relation')).toBeNull();
  });

  it('a dangling origin/HEAD in tried[0] adds its sentence', () => {
    head('/docs/demo', withRef({ via: 'default:origin-main', tried: [{ ref: 'refs/remotes/origin/feat', result: 'dangling' }] }));
    expect(q('.docs-truth-via').textContent).toBe('default branch (origin/main; origin/HEAD unset)');
    expect(q('.docs-truth-dangling').textContent).toBe('origin/HEAD points at a missing branch');
  });

  it('no dangling sentence when tried[0] resolved', () => {
    head('/docs/demo', withRef({ tried: [{ ref: 'refs/remotes/origin/main', result: 'resolved' }] }));
    expect(document.querySelector('.docs-truth-dangling')).toBeNull();
  });

  it('a tree failure keeps the crumbs and replaces the listing; there is no truth line (M4.F4)', async () => {
    open('/docs/demo/specs', fakeLoaders({ tree: failedAnswer('repo-unreadable') }));
    expect(await screen.findByText('The repository could not be read on the fleet box.')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Docs path' })).toBeInTheDocument();
    expect(document.querySelector('.docs-truth')).toBeNull();
    expect(document.querySelector('.docs-listing')).toBeNull();
  });

  it('the index has crumbs and back, and no truth line', () => {
    head('/docs', null);
    expect(within(screen.getByRole('navigation', { name: 'Docs path' })).getByText('Docs')).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector('.docs-truth')).toBeNull();
    expect(document.querySelector('.docs-actions')).toBeNull();
  });
});

describe("the leaf's source, badge and size (spec 2 row 54)", () => {
  it('a committed leaf: source `committed` and its size in KiB', async () => {
    open('/docs/demo/specs/a.md', fakeLoaders());
    await waitFor(() => expect(document.querySelector('.docs-truth-size')).not.toBeNull());
    expect(q('.docs-truth-source').textContent).toBe('committed');
    expect(q('.docs-truth-size').textContent).toBe('1 KiB');
    expect(document.querySelector('.docs-head .docs-badge')).toBeNull();
  });

  it('a draft leaf in a ref view: `draft · modified in workspace a`, the worktree path in its title', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: workspaceHolder() });
    const f = fakeLoaders({ tree: okTree(tree) });
    open('/docs/demo/specs/a.md?ref=main', f);
    await waitFor(() => expect(f.file).toHaveBeenCalled());
    await waitFor(() => expect(q('.docs-truth-source').textContent).toBe('draft · modified in workspace a'));
    expect(q('.docs-truth-source')).toHaveAttribute('title', '/repo/wt/a');
    expect(within(q('.docs-truth-source')).getByText('draft · modified')).toHaveClass('docs-badge');
    expect(f.file.mock.calls[0]?.[1]).toMatchObject({ kind: 'draft', fp: FP_1 });
  });

  it('view=committed: source `committed (view=committed)`', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
    open('/docs/demo/specs/a.md?ref=main&view=committed', fakeLoaders({ tree: okTree(tree) }));
    await waitFor(() => expect(q('.docs-truth-source').textContent).toBe('committed (view=committed)'));
  });

  it.each([
    ['/repo/demo', 'main', 'main checkout'],
    ['/repo/wt/a', 'workspace', 'workspace a'],
    ['/repo/x/y/z', 'other', 'y/z'],
  ] as const)('truthSource names the worktree at %s (%s) as %s', (path, cls, label) => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('conflicted') })], drafts: workspaceHolder(path, cls) });
    const page = pageAt('/docs/demo/specs/a.md?ref=main') as DocsPageLocation & { kind: 'path' };
    const pin: DocPin = { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: 'a.md', fp: FP_1 };
    expect(truthSource(tree, page, pin)).toBe(`draft · conflicted in ${label}`);
  });

  it('truthSource: a committed pin, a committed view, and nothing opened', () => {
    const tree = treeOk();
    const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'a.md' };
    const leaf = (url: string): DocsPageLocation & { kind: 'path' } => pageAt(url) as DocsPageLocation & { kind: 'path' };
    expect(truthSource(tree, leaf('/docs/demo/specs/a.md'), pin)).toBe('committed');
    expect(truthSource(tree, leaf('/docs/demo/specs/a.md?ref=main&view=committed'), pin)).toBe('committed (view=committed)');
    expect(truthSource(tree, leaf('/docs/demo/specs/a.md'), null)).toBe('nothing opened');
  });

  it('a withheld draft opens committed: source `committed` and the badge beside it', () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified', { fp: null }) })], drafts: holder() });
    head('/docs/demo/specs/a.md?ref=main', tree);
    expect(q('.docs-truth-source').textContent).toBe('committed');
    expect(q('.docs-head .docs-badge').textContent).toBe('draft · withheld');
  });
});

describe('one badge function: the row and the leaf say the same (M4.T7, base form)', () => {
  const COMMITTED = { kind: 'file', blob: BLOB_2, size: 100 } as const;
  it.each([
    ['modified', { committed: COMMITTED, draft: draftOf('modified') }],
    ['conflicted', { committed: COMMITTED, draft: draftOf('conflicted') }],
    ['added (new)', { committed: null, draft: draftOf('added') }],
    ['untracked (new)', { committed: null, draft: draftOf('untracked') }],
    ['deleted', { committed: COMMITTED, draft: draftOf('deleted', { kind: 'absent', fp: null, size: null }) }],
    ['typechange', { committed: COMMITTED, draft: draftOf('typechange', { kind: 'symlink', fp: null }) }],
    ['withheld, too large', { committed: COMMITTED, draft: draftOf('modified', { fp: null }) }],
    ['withheld, unreadable', { committed: COMMITTED, draft: draftOf('modified', { kind: 'unreadable', fp: null }) }],
    ['withheld, not a file', { committed: COMMITTED, draft: draftOf('modified', { kind: 'special', fp: null }) }],
  ] as const)('%s: the row badge equals the leaf badge, both ENTRY_BADGE_TEXT[entryView(...).badge]', (_name, over) => {
    const e: DocsEntry = { section: 'specs', path: 'x.md', ...over };
    const tree = treeOk({ entries: [e], drafts: holder() });
    const badge = entryView(e, tree.drafts, 'ref').badge;
    expect(badge).not.toBeNull();
    const want = ENTRY_BADGE_TEXT[badge ?? 'modified'];
    const row = render(<DocsTreeView tree={tree} page={pageAt('/docs/demo/specs?ref=main')} />);
    const rowText = row.container.querySelector('.docs-badge')?.textContent;
    row.unmount();
    const leaf = head('/docs/demo/specs/x.md?ref=main', tree);
    const leafText = leaf.container.querySelector('.docs-head .docs-badge')?.textContent;
    expect(rowText).toBe(want);
    expect(leafText).toBe(rowText);
  });
});

describe('the freshness chip (spec 4.5)', () => {
  const stamp = (over: Partial<NonNullable<DocsTreeOk['freshness']['stamp']>>): NonNullable<DocsTreeOk['freshness']['stamp']> =>
    ({ okAgeMs: 4 * MIN, attemptAgeMs: 4 * MIN, lastOutcome: 'ok', okCommit: COMMIT_A, ...over });
  const skipped: DocsRefreshFetch = { state: 'skipped', why: 'local-ref' };
  const cases: readonly [string, DocsTreeOk, Freshness, string, string][] = [
    ['no origin', withStamp(null, null), { s: 'idle' }, 'none', 'no origin'],
    ['never fetched', withStamp(null), { s: 'idle' }, 'never', 'never fetched ↻'],
    ['fetched, aged by now - receivedAt', withStamp(stamp({})), { s: 'idle' }, 'ok', 'fetched 5m ago ↻'],
    ['remote branch absent', withStamp(stamp({ lastOutcome: 'remote-branch-absent' })), { s: 'idle' }, 'local', 'local only ↻'],
    ['remote branch absent, answered this visit', withStamp(stamp({})),
      { s: 'answered', fetch: fetchFailed('remote-branch-absent'), at: NOW }, 'local', 'local only ↻'],
    ['a failed stamp', withStamp(stamp({ lastOutcome: 'fetch-transport', okAgeMs: 179 * MIN })), { s: 'idle' }, 'failed',
      'fetch failed 5m ago: Fetching from origin failed: the connection to origin did not work. · last good 3h ago ↻'],
    ['a failed stamp that never succeeded', withStamp(stamp({ lastOutcome: 'fetch-timeout', okAgeMs: null })), { s: 'idle' },
      'failed', 'fetch failed 5m ago: Fetching from origin took too long and was stopped. · last good never ↻'],
    ['in flight', withStamp(stamp({})), { s: 'fetching', reason: 'manual' }, 'fetching', 'fetching…'],
    ['fetch-too-soon', withStamp(stamp({})), { s: 'soon', retryAt: NOW + 4000 }, 'soon', 'fetched moments ago; again in 4s'],
    ['a stale lock', withStamp(stamp({})), { s: 'stale-lock', ref: 'refs/remotes/origin/main' }, 'failed',
      'stale lock on refs/remotes/origin/main'],
    ['a stale lock whose answer named no ref', withStamp(stamp({})), { s: 'stale-lock', ref: null }, 'failed',
      'stale lock (the answer named no ref)'],
    ['skipped: a local ref', withStamp(stamp({})), { s: 'answered', fetch: skipped, at: NOW }, 'local',
      'local ref; fetch does not change it'],
    ['a fetch failure answered now, beside the last good stamp', withStamp(stamp({})),
      { s: 'answered', fetch: fetchFailed('fetch-auth-failed'), at: NOW }, 'failed',
      "fetch failed just now: Fetching from origin was refused: the fleet box's credentials were not accepted. · last good 5m ago ↻"],
    ['a fetch that ran: the new stamp', withStamp(stamp({ attemptAgeMs: 0 })), { s: 'answered', fetch: RAN, at: NOW }, 'ok',
      'fetched just now ↻'],
    ['a re-list that failed', withStamp(stamp({})), { s: 'relist-failed', answer: { s: 'unreachable' } }, 'failed',
      're-list failed: The server could not be reached; Docs needs a connection. ↻'],
    ['a refresh with no route answer', withStamp(stamp({})), { s: 'refresh-failed', answer: failedAnswer('docs-busy') },
      'failed', 'refresh failed: Docs is busy with other reads right now. ↻'],
  ];

  it.each(cases)('%s', (_name, tree, freshness, state, text) => {
    vi.useFakeTimers({ now: NOW });
    render(<DocsHead page={pageAt('/docs/demo')} visit={visitOf(tree, { freshness }, NOW - MIN)} tree={tree} />);
    expect(q('.docs-fresh')).toHaveAttribute('data-state', state);
    expect(q('.docs-fresh').textContent).toBe(text);
  });

  it('an answered fetch failure is aged from `at`, not from when the listing landed; the last good age from receivedAt', () => {
    vi.useFakeTimers({ now: NOW });
    const tree = withStamp(stamp({}));
    const freshness: Freshness = { s: 'answered', fetch: fetchFailed('fetch-timeout'), at: NOW - 3 * MIN };
    render(<DocsHead page={pageAt('/docs/demo')} visit={visitOf(tree, { freshness }, NOW - 10 * MIN)} tree={tree} />);
    expect(q('.docs-fresh').textContent).toBe(
      'fetch failed 3m ago: Fetching from origin took too long and was stopped. · last good 14m ago ↻');
  });

  it('an answered fetch-too-soon is the soon state, counted from its own retryAfterMs and answer time (no auto-retry)', () => {
    vi.useFakeTimers({ now: NOW });
    const tree = withStamp(stamp({}));
    const freshness: Freshness = { s: 'answered', fetch: fetchFailed('fetch-too-soon', { retryAfterMs: 10_000 }), at: NOW - 4000 };
    render(<DocsHead page={pageAt('/docs/demo')} visit={visitOf(tree, { freshness }, NOW - MIN)} tree={tree} />);
    expect(q('.docs-fresh')).toHaveAttribute('data-state', 'soon');
    expect(q('.docs-fresh').textContent).toBe('fetched moments ago; again in 6s');
    act(() => { vi.advanceTimersByTime(6000); });
    expect(q('.docs-fresh').textContent).toBe('fetched moments ago; again in 0s');
  });

  it('no origin is static text, not a button', () => {
    head('/docs/demo', withStamp(null, null));
    expect(q('.docs-fresh').tagName).toBe('SPAN');
  });

  it('a tap is one manual refresh; in flight the chip is disabled', () => {
    const refreshManual = vi.fn();
    const tree = withStamp(null);
    const { rerender } = render(<DocsHead page={pageAt('/docs/demo')} visit={visitOf(tree, { refreshManual })} tree={tree} />);
    fireEvent.click(screen.getByRole('button', { name: 'never fetched ↻' }));
    expect(refreshManual).toHaveBeenCalledTimes(1);
    rerender(<DocsHead page={pageAt('/docs/demo')} visit={visitOf(tree, { refreshManual, freshness: { s: 'fetching', reason: 'manual' } })} tree={tree} />);
    const chip = screen.getByRole('button', { name: 'fetching…' });
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(refreshManual).toHaveBeenCalledTimes(1);
  });

  it('the age follows useNow(30 000): two minutes later it reads two minutes older', () => {
    vi.useFakeTimers({ now: NOW });
    const tree = withStamp(stamp({}));
    render(<DocsHead page={pageAt('/docs/demo')} visit={visitOf(tree, {}, NOW - MIN)} tree={tree} />);
    expect(q('.docs-fresh').textContent).toBe('fetched 5m ago ↻');
    act(() => { vi.advanceTimersByTime(2 * MIN); });
    expect(q('.docs-fresh').textContent).toBe('fetched 7m ago ↻');
  });
});

describe('the soon chip counts down on a 1 s clock (spec 4.5)', () => {
  const stamp = { okAgeMs: 4 * MIN, attemptAgeMs: 4 * MIN, lastOutcome: 'ok', okCommit: COMMIT_A } as const;

  async function flush(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await act(async () => {});
  }
  async function advance(ms: number): Promise<void> {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await flush();
  }

  it('a visit that mounted 25 s ago and is answered fetch-too-soon (10 s) reads 10s, then 9s a second later', () => {
    vi.useFakeTimers({ now: NOW });
    const tree = withStamp(stamp);
    const page = pageAt('/docs/demo');
    const { rerender } = render(<DocsHead page={page} visit={visitOf(tree)} tree={tree} />);
    act(() => { vi.advanceTimersByTime(25_000); });
    rerender(<DocsHead page={page} visit={visitOf(tree, { freshness: { s: 'soon', retryAt: NOW + 35_000 } })} tree={tree} />);
    expect(q('.docs-fresh').textContent).toBe('fetched moments ago; again in 10s');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(q('.docs-fresh').textContent).toBe('fetched moments ago; again in 9s');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(q('.docs-fresh').textContent).toBe('fetched moments ago; again in 6s');
  });

  it('measured end to end: mount, wait 25 s, tap, the answer says 10 s: the chip reads 10s, never 35s, then counts down', async () => {
    vi.useFakeTimers({ now: NOW });
    const f = fakeLoaders({ tree: okTree(treeOk({ commit: COMMIT_A })) });
    f.refresh.mockResolvedValueOnce(okRefresh(fetchFailed('fetch-too-soon', { retryAfterMs: 10_000 })));
    navigate('/docs/demo');
    render(<Routed loaders={f.loaders} />);
    await flush();
    expect(q('.docs-fresh').textContent).toBe('never fetched ↻');
    await advance(25_000);
    act(() => { fireEvent.click(q('.docs-fresh')); });
    await flush();
    expect(q('.docs-fresh')).toHaveAttribute('data-state', 'soon');
    expect(q('.docs-fresh').textContent).toBe('fetched moments ago; again in 10s');
    await advance(1000);
    expect(q('.docs-fresh').textContent).toBe('fetched moments ago; again in 9s');
  });

  it('a second fetch-too-soon in one visit is still soon (the one automatic retry is spent), and nothing retries again', async () => {
    vi.useFakeTimers({ now: NOW });
    const f = fakeLoaders({ tree: okTree(treeOk({ commit: COMMIT_A })) });
    f.refresh.mockResolvedValue(okRefresh(fetchFailed('fetch-too-soon', { retryAfterMs: 4000 })));
    navigate('/docs/demo');
    render(<Routed loaders={f.loaders} />);
    await flush();
    act(() => { fireEvent.click(q('.docs-fresh')); });
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(q('.docs-fresh').textContent).toBe('fetched moments ago; again in 4s');
    await advance(4000);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(q('.docs-fresh')).toHaveAttribute('data-state', 'soon');
    expect(q('.docs-fresh').textContent).toBe('fetched moments ago; again in 4s');
    expect(q('.docs-fresh').textContent).not.toMatch(/fetch failed/);
    await advance(60_000);
    expect(f.refresh).toHaveBeenCalledTimes(2);
  });
});

describe('View on GitHub (spec 3.11, 4.5)', () => {
  const tree = treeOk({
    entries: [entry('specs', 'd/x.md'), { section: 'specs', path: 'n.md', committed: null, draft: draftOf('untracked') }],
    drafts: holder(),
  });

  it.each([
    ['/docs', null],
    ['/docs/demo', { kind: 'root' }],
    ['/docs/demo/specs', { kind: 'section', section: 'specs' }],
    ['/docs/demo/specs/d/', { kind: 'dir', section: 'specs', path: 'd' }],
    ['/docs/demo/specs/d/x.md', { kind: 'leaf', section: 'specs', path: 'd/x.md', uncommitted: false }],
    ['/docs/demo/specs/n.md?ref=main', { kind: 'leaf', section: 'specs', path: 'n.md', uncommitted: true }],
    ['/docs/demo/specs/zzz.md', null],
  ] as const)('githubTargetFor(%s) is %j', (url, target) => {
    expect(githubTargetFor(pageAt(url), tree)).toEqual(target);
  });

  it.each([
    ['/docs/demo', 'https://github.com/example-org/example-repo/tree/main'],
    ['/docs/demo/specs', 'https://github.com/example-org/example-repo/tree/main/docs/superpowers/specs'],
    ['/docs/demo/specs/d/', 'https://github.com/example-org/example-repo/tree/main/docs/superpowers/specs/d'],
    ['/docs/demo/specs/d/x.md', 'https://github.com/example-org/example-repo/blob/main/docs/superpowers/specs/d/x.md'],
  ])('%s links %s and opens it with openExternal on tap', (url, href) => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    head(url, tree);
    const link = screen.getByRole('link', { name: 'View on GitHub' });
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(link);
    expect(opened).toHaveBeenCalledWith(href, '_blank', 'noopener,noreferrer');
    expect(screen.queryByText("GitHub's copy may differ from this view")).toBeNull();
  });

  it('a local side ahead of origin links with the may-differ note', () => {
    head('/docs/demo?ref=ws/a', withRef({ side: 'local', name: 'ws/a', via: 'local', relation: 'local-ahead' }));
    expect(screen.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/example-org/example-repo/tree/ws/a');
    expect(screen.getByText("GitHub's copy may differ from this view")).toBeInTheDocument();
  });

  describe('a leaf that shows draft bytes says GitHub may differ, whatever the ref relation', () => {
    const MAY_DIFFER = "GitHub's copy may differ from this view";
    const drafted = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });

    it('a draft leaf (the served ref equal to origin): link and note', () => {
      head('/docs/demo/specs/a.md?ref=main', drafted);
      expect(screen.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute(
        'href', 'https://github.com/example-org/example-repo/blob/main/docs/superpowers/specs/a.md');
      expect(screen.getByText(MAY_DIFFER)).toBeInTheDocument();
    });

    it('the same leaf at view=committed, a withheld draft, and the default view show committed bytes: no note', () => {
      head('/docs/demo/specs/a.md?ref=main&view=committed', drafted);
      expect(screen.queryByText(MAY_DIFFER)).toBeNull();
      cleanup();
      head('/docs/demo/specs/a.md?ref=main', treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified', { fp: null }) })], drafts: holder() }));
      expect(screen.queryByText(MAY_DIFFER)).toBeNull();
      cleanup();
      head('/docs/demo/specs/a.md', drafted);
      expect(screen.queryByText(MAY_DIFFER)).toBeNull();
    });

    it('the opened pin decides, not the entry: a draft pin read for a project page shows no note', () => {
      head('/docs/demo/specs?ref=main', drafted);
      expect(screen.queryByText(MAY_DIFFER)).toBeNull();
    });
  });

  it.each([
    ['no GitHub origin', '/docs/demo', { ...treeOk(), github: { state: 'none' } } as DocsTreeOk, 'View on GitHub: no GitHub origin'],
    ['a ref not on origin', '/docs/demo', withRef({ side: 'local', relation: 'local-only', via: 'local' }), 'View on GitHub: not pushed'],
    ['a draft-only leaf', '/docs/demo/specs/n.md?ref=main', tree, 'View on GitHub: not committed'],
  ] as const)('%s: no link, and the reason in words', (_name, url, t, text) => {
    head(url, t);
    expect(screen.queryByRole('link', { name: 'View on GitHub' })).toBeNull();
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

describe('Open committed version (M4.T6)', () => {
  const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });

  it('navigates to view=committed with a history entry; the loader gets the committed pin; no commit in the URL', async () => {
    const f = fakeLoaders({ tree: okTree(tree) });
    open('/docs/demo/specs/a.md?ref=main', f);
    const link = await screen.findByRole('link', { name: 'Open committed version' });
    expect(link).toHaveAttribute('href', '/docs/demo/specs/a.md?ref=main&view=committed');
    await waitFor(() => expect(f.file).toHaveBeenCalledTimes(1));
    expect(f.file.mock.calls[0]?.[1]).toMatchObject({ kind: 'draft' });
    const before = history.length;
    fireEvent.click(link);
    expect(here()).toBe('/docs/demo/specs/a.md?ref=main&view=committed');
    expect(history.length).toBe(before + 1);
    await waitFor(() => expect(f.file).toHaveBeenCalledTimes(2));
    expect(f.file.mock.calls[1]?.[1]).toEqual({ kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'a.md' });
    expect(location.href).not.toMatch(/[0-9a-f]{40}/);
    expect(screen.queryByRole('link', { name: 'Open committed version' })).toBeNull();
    expect(await screen.findByText('Showing the committed version at aaaaaaaa.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the draft' })).toHaveAttribute('href', '/docs/demo/specs/a.md?ref=main');
  });

  it('is not offered in the default view, nor for a file with no committed side', () => {
    head('/docs/demo/specs/a.md', tree);
    expect(screen.queryByRole('link', { name: 'Open committed version' })).toBeNull();
    const drafted = treeOk({ entries: [{ section: 'specs', path: 'n.md', committed: null, draft: draftOf('untracked') }], drafts: holder() });
    cleanup();
    head('/docs/demo/specs/n.md?ref=main', drafted);
    expect(screen.queryByRole('link', { name: 'Open committed version' })).toBeNull();
  });
});

describe('copy commit through copyText (spec 4.5, refinement (t))', () => {
  const clipboard = (writeText: (s: string) => Promise<void>): void => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  };

  it('copyText writes through the clipboard, and rejects when there is none', async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    await expect(copyText('x')).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith('x');
    Reflect.deleteProperty(navigator, 'clipboard');
    await expect(copyText('x')).rejects.toThrow('The clipboard is not available here.');
  });

  it('the button copies the FULL commit and says so', async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    head('/docs/demo', treeOk());
    fireEvent.click(screen.getByRole('button', { name: 'copy commit' }));
    expect(await screen.findByText('copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(COMMIT_A);
  });

  it('a re-list that moves the commit clears "copied": the next commit has not been copied', async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    const page = pageAt('/docs/demo');
    const { rerender } = render(<DocsHead page={page} visit={visitOf(treeOk())} tree={treeOk()} />);
    fireEvent.click(screen.getByRole('button', { name: 'copy commit' }));
    expect(await screen.findByText('copied')).toBeInTheDocument();
    const moved = treeOk({ commit: COMMIT_B });
    rerender(<DocsHead page={page} visit={visitOf(moved)} tree={moved} />);
    expect(screen.queryByText('copied')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'copy commit' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(COMMIT_B));
  });

  it('a refused clipboard says copy failed', async () => {
    clipboard(async () => { throw new Error('denied'); });
    head('/docs/demo', treeOk());
    fireEvent.click(screen.getByRole('button', { name: 'copy commit' }));
    expect(await screen.findByText('copy failed')).toBeInTheDocument();
  });
});

describe('Updated to <short> (spec 4.3)', () => {
  it('the head says the commit the leaf now reads at, and nothing when there was no move', () => {
    head('/docs/demo/specs/a.md', treeOk(), { updatedTo: COMMIT_B });
    expect(q('.docs-updated').textContent).toBe('Updated to bbbbbbbb');
    expect(q('.docs-updated')).toHaveAttribute('role', 'status');
    cleanup();
    head('/docs/demo/specs/a.md', treeOk());
    expect(document.querySelector('.docs-updated')).toBeNull();
  });

  it('an auto-refresh that moves the leaf re-reads it and says Updated to', async () => {
    const moved = treeOk({ commit: COMMIT_B, entries: [entry('specs', 'a.md', { committed: { kind: 'file', blob: BLOB_2, size: 100 } })] });
    let answer: (a: Awaited<ReturnType<DocsLoaders['refresh']>>) => void = () => {};
    const f = fakeLoaders({ tree: okTree(treeOk(), true) });
    f.refresh.mockImplementation(() => new Promise((r) => { answer = r; }));
    open('/docs/demo/specs/a.md', f);
    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();
    expect(document.querySelector('.docs-updated')).toBeNull();
    act(() => answer(okRefresh(RAN, treeResponse(moved))));
    expect(await screen.findByText('Updated to bbbbbbbb')).toBeInTheDocument();
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(q('.docs-truth-commit').textContent).toBe('bbbbbbbb');
  });
});

describe('failure placement (M4.F4)', () => {
  it('a file failure replaces the body and keeps the header and truth line', async () => {
    const f = fakeLoaders({ file: failedAnswer('absent-path') });
    open('/docs/demo/specs/a.md', f);
    expect(await screen.findByText('There is no file at that path in this commit.')).toBeInTheDocument();
    expect(q('.docs-truth-ref').textContent).toBe('origin/main');
    expect(q('.docs-truth-commit').textContent).toBe('aaaaaaaa');
    expect(document.querySelector('.doc-body')).toBeNull();
  });

  it('a fetch failure changes only the chip: the listing node is the same node', async () => {
    let answer: (a: Awaited<ReturnType<DocsLoaders['refresh']>>) => void = () => {};
    const f = fakeLoaders({ tree: okTree(treeOk(), true) });
    f.refresh.mockImplementation(() => new Promise((r) => { answer = r; }));
    open('/docs/demo/specs', f);
    await waitFor(() => expect(q('.docs-fresh')).toHaveAttribute('data-state', 'fetching'));
    const listing = q('.docs-listing');
    act(() => answer(okRefresh(fetchFailed('fetch-transport'))));
    await waitFor(() => expect(q('.docs-fresh')).toHaveAttribute('data-state', 'failed'));
    expect(q('.docs-fresh').textContent).toBe(
      'fetch failed just now: Fetching from origin failed: the connection to origin did not work. · last good never ↻');
    expect(q('.docs-listing')).toBe(listing);
    expect(f.tree).toHaveBeenCalledTimes(1);
  });
});

describe('back is up one level, and the crumbs (spec 4.4 layout)', () => {
  it.each([
    ['/docs/demo/specs/d/x.md', '/docs/demo/specs/d/'],
    ['/docs/demo/specs/x.md?ref=ws/a&view=committed', '/docs/demo/specs?ref=ws/a'],
    ['/docs/demo/specs/d/e/', '/docs/demo/specs/d/'],
    ['/docs/demo/specs/d/', '/docs/demo/specs'],
    ['/docs/demo/specs?ref=ws/a', '/docs/demo?ref=ws/a'],
    ['/docs/demo', '/docs'],
    ['/docs', '/'],
  ])('%s goes up to %s, with a history entry', (url, up) => {
    navigate(url);
    head(url, null);
    const before = history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Up one level' }));
    expect(here()).toBe(up);
    expect(history.length).toBe(before + 1);
  });

  const crumbNames = (): string[] =>
    [...screen.getByRole('navigation', { name: 'Docs path' }).querySelectorAll('a, [aria-current="page"]')].map((n) => n.textContent ?? '');

  it('a phone shows the last two crumbs behind a leading … button, which shows them all', () => {
    head('/docs/demo/specs/d/x.md?ref=ws/a', null);
    expect(crumbNames()).toEqual(['d', 'x.md']);
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole path' }));
    expect(crumbNames()).toEqual(['Docs', 'demo', 'specs', 'd', 'x.md']);
    expect(screen.getByRole('link', { name: 'demo' })).toHaveAttribute('href', '/docs/demo?ref=ws/a');
    expect(screen.getByRole('link', { name: 'd' })).toHaveAttribute('href', '/docs/demo/specs/d/?ref=ws/a');
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
    expect(screen.getByText('x.md')).toHaveAttribute('aria-current', 'page');
  });

  it('a desktop shows every crumb and no … button', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 900px)', media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    }));
    head('/docs/demo/specs/d/x.md', null);
    expect(crumbNames()).toEqual(['Docs', 'demo', 'specs', 'd', 'x.md']);
    expect(screen.queryByRole('button', { name: 'Show the whole path' })).toBeNull();
  });

  it('two crumbs or fewer need no … button', () => {
    head('/docs/demo', null);
    expect(crumbNames()).toEqual(['Docs', 'demo']);
    expect(screen.queryByRole('button', { name: 'Show the whole path' })).toBeNull();
  });
});

describe('T13 review 4-1: the relation sentence speaks of local against origin, whichever side ccd served', () => {
  // ccd counts from the SERVED side (ccd/ccd counts_of; server/test/ccd-docs-tree.test.ts 'counts measured from the
  // served side'): `ahead` is the served ref's lead over the counterpart, `behind` the counterpart's lead over it.
  it.each([
    ['local-ahead', 'local', { ahead: 2, behind: 0 }, 'local is 2 ahead of origin'],
    ['local-ahead', 'origin', { ahead: 0, behind: 2 }, 'local is 2 ahead of origin'],
    ['local-behind', 'local', { ahead: 0, behind: 3 }, 'origin is 3 ahead of local'],
    ['local-behind', 'origin', { ahead: 3, behind: 0 }, 'origin is 3 ahead of local'],
    ['diverged', 'local', { ahead: 2, behind: 3 }, 'local and origin have diverged (2 vs 3), showing local'],
    ['diverged', 'origin', { ahead: 3, behind: 2 }, 'local and origin have diverged (2 vs 3), showing local'],
  ] as const)('%s with %s served and counts %o reads %s', (relation, side, counts, text) => {
    const tree = withRef({
      requested: 'ws/a', served: side === 'local' ? 'refs/heads/ws/a' : 'refs/remotes/origin/ws/a', name: 'ws/a', side,
      via: 'qualified', relation,
      counterpart: { ref: side === 'local' ? 'refs/remotes/origin/ws/a' : 'refs/heads/ws/a', commit: COMMIT_B, ahead: counts.ahead, behind: counts.behind, count: 'measured' },
    });
    head('/docs/demo?ref=ws/a', tree);
    expect(q('.docs-truth-relation').textContent).toBe(text);
  });

  it('an unmeasured count stays out of the sentence on either side', () => {
    const tree = withRef({
      requested: 'ws/a', side: 'origin', via: 'qualified', relation: 'local-ahead',
      counterpart: { ref: 'refs/heads/ws/a', commit: COMMIT_B, ahead: 0, behind: null, count: 'timeout' },
    });
    head('/docs/demo?ref=ws/a', tree);
    expect(q('.docs-truth-relation').textContent).not.toMatch(/\d/);
  });
});
