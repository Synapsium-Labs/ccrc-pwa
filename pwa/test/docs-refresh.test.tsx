// Docs W5 part 1, Task 5: auto-refresh and re-listing (spec 2026-10-01 4.3, M4.A1-A3, section 2 rows 60 and 61's
// PWA half). Once per open per (project, ref), only on a resolved tree, never on a refs/heads/ view; a return to the
// tab re-lists a stale listing with a GET and never a POST; a refresh answer's tree replaces the slot, its fetch
// failure changes only the freshness, its tree failure keeps the listing; fetch-too-soon and a young lock retry once,
// a stale lock and an unmeasured one never. Loaders are spies; nothing reaches a server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { DOCS_STALE_MS, type DocsPageLocation } from '../../shared/docs';
import { useDocsVisit } from '../src/docs/useDocsVisit';
import type { DocsLoaders, DocsRefreshLoaderAnswer } from '../src/docs/failures';
import {
  BLOB_2, COMMIT_A, COMMIT_B, RAN, bodyOf, entry, failedAnswer, fakeLoaders, fetchFailed, okFile, okRefresh, okTree,
  pageAt, treeOk, treeResponse,
} from './docsFixtures';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'visibilityState');
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await act(async () => {});
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

function visit(loaders: DocsLoaders, url: string, strict = false) {
  return renderHook(
    (p: { page: DocsPageLocation | null }) => useDocsVisit(p.page, loaders),
    { initialProps: { page: pageAt(url) }, reactStrictMode: strict },
  );
}

/** A tree answer that asks for a refresh. */
const due = () => okTree(treeOk(), true);

describe('M4.A1: once per open per (project, ref)', () => {
  it('refreshDue gives exactly one POST {ref: null, reason: auto}', async () => {
    const f = fakeLoaders({ tree: due() });
    visit(f.loaders, '/docs/demo');
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.refresh).toHaveBeenCalledWith('demo', { ref: null, reason: 'auto' });
  });

  it('no refreshDue, no POST', async () => {
    const f = fakeLoaders();
    visit(f.loaders, '/docs/demo');
    await flush();
    expect(f.refresh).not.toHaveBeenCalled();
  });

  it('project, section, leaf and sibling keep one POST and one tree GET', async () => {
    const f = fakeLoaders({ tree: due() });
    const { rerender } = visit(f.loaders, '/docs/demo');
    await flush();
    for (const url of ['/docs/demo/specs', '/docs/demo/specs/a.md', '/docs/demo/specs/b.md']) {
      rerender({ page: pageAt(url) });
      await flush();
    }
    expect(f.tree).toHaveBeenCalledTimes(1);
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it('a new ref adds one, with its ref text', async () => {
    const f = fakeLoaders({ tree: due() });
    const { rerender } = visit(f.loaders, '/docs/demo');
    await flush();
    rerender({ page: pageAt('/docs/demo?ref=ws/a') });
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.refresh.mock.calls[1]).toEqual(['demo', { ref: 'ws/a', reason: 'auto' }]);
  });

  it('a remount is a new open and adds one', async () => {
    const f = fakeLoaders({ tree: due() });
    const first = visit(f.loaders, '/docs/demo');
    await flush();
    first.unmount();
    visit(f.loaders, '/docs/demo');
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(2);
  });

  it('StrictMode still makes one GET and one POST', async () => {
    const f = fakeLoaders({ tree: due() });
    visit(f.loaders, '/docs/demo', true);
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(1);
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it('the POST is in flight as fetching, and a manual tap meanwhile adds nothing', async () => {
    const f = fakeLoaders({ tree: due() });
    f.refresh.mockImplementationOnce(() => new Promise(() => {}));
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(result.current.freshness).toEqual({ s: 'fetching', reason: 'auto' });
    act(() => result.current.refreshManual());
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('M4.A2 and row 60: only when resolved, never a refs/heads/ view', () => {
  it('an unresolved-ref answer makes zero POSTs; Fetch from origin makes one manual POST', async () => {
    const f = fakeLoaders({ tree: failedAnswer('unresolved-ref') });
    const { result } = visit(f.loaders, '/docs/demo?ref=gone');
    await flush();
    expect(f.refresh).not.toHaveBeenCalled();
    act(() => result.current.fetchFromOrigin());
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.refresh).toHaveBeenCalledWith('demo', { ref: 'gone', reason: 'manual' });
  });

  it('Fetch from origin is a no-op on any other slot', async () => {
    const f = fakeLoaders({ tree: failedAnswer('git-failed') });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    act(() => result.current.fetchFromOrigin());
    expect(f.refresh).not.toHaveBeenCalled();
  });

  it('a refs/heads/ view with refreshDue makes zero automatic POSTs, and a manual one is still allowed', async () => {
    const f = fakeLoaders({ tree: due() });
    const { result } = visit(f.loaders, '/docs/demo?ref=refs/heads/main');
    await flush();
    expect(f.refresh).not.toHaveBeenCalled();
    act(() => result.current.refreshManual());
    await flush();
    expect(f.refresh).toHaveBeenCalledWith('demo', { ref: 'refs/heads/main', reason: 'manual' });
  });

  it('a refs/remotes/origin/ view with refreshDue does auto-refresh (the refusal is local heads only)', async () => {
    const f = fakeLoaders({ tree: due() });
    visit(f.loaders, '/docs/demo?ref=refs/remotes/origin/main');
    await flush();
    expect(f.refresh).toHaveBeenCalledWith('demo', { ref: 'refs/remotes/origin/main', reason: 'auto' });
  });

  it('a manual refresh needs a listing', async () => {
    const f = fakeLoaders({ tree: { s: 'unreachable' } });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    act(() => result.current.refreshManual());
    expect(f.refresh).not.toHaveBeenCalled();
  });
});

describe('M4.A3: re-list on return', () => {
  function show(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('a listing older than DOCS_STALE_MS is re-listed by one GET and no POST, even when the answer says refreshDue', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.tree.mockResolvedValueOnce(okTree());
    f.tree.mockResolvedValueOnce(due());
    visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    await advance(DOCS_STALE_MS + 1);
    await act(async () => show('visible'));
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    expect(f.refresh).not.toHaveBeenCalled();
  });

  it('a younger listing is not re-listed', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    visit(f.loaders, '/docs/demo');
    await flush();
    await advance(DOCS_STALE_MS - 1);
    await act(async () => show('visible'));
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it('going hidden re-lists nothing', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    visit(f.loaders, '/docs/demo');
    await flush();
    await advance(DOCS_STALE_MS + 1);
    await act(async () => show('hidden'));
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it('a re-list that fails keeps the listing and says relist-failed', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.tree.mockResolvedValueOnce(okTree());
    f.tree.mockResolvedValueOnce({ s: 'unreachable' });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    const held = result.current.tree;
    await advance(DOCS_STALE_MS + 1);
    await act(async () => show('visible'));
    await flush();
    expect(result.current.tree).toBe(held);
    expect(result.current.freshness).toEqual({ s: 'relist-failed', answer: { s: 'unreachable' } });
  });

  it('a re-list answered 401 becomes the auth slot', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.tree.mockResolvedValueOnce(okTree());
    f.tree.mockResolvedValueOnce({ s: 'auth' });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    await advance(DOCS_STALE_MS + 1);
    await act(async () => show('visible'));
    await flush();
    expect(result.current.tree).toEqual({ s: 'auth' });
  });
});

describe('the refresh answer', () => {
  it('an ok tree replaces the slot and the freshness is answered', async () => {
    const f = fakeLoaders({ tree: due(), refresh: okRefresh(RAN, treeResponse(treeOk({ commit: COMMIT_B }))) });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    const slot = result.current.tree;
    expect(slot?.s === 'ok' && slot.answer.tree.ref.commit).toBe(COMMIT_B);
    expect(result.current.freshness).toMatchObject({ s: 'answered', fetch: RAN });
  });

  /** A visit whose auto POST waits for the test, so the slot before the answer can be held. */
  async function heldThenAnswered(answer: DocsRefreshLoaderAnswer) {
    let settle: (a: DocsRefreshLoaderAnswer) => void = () => {};
    const f = fakeLoaders({ tree: due() });
    f.refresh.mockImplementationOnce(() => new Promise((r) => { settle = r; }));
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    const held = result.current.tree;
    expect(held?.s).toBe('ok');
    await act(async () => settle(answer));
    await flush();
    return { result, held };
  }

  it('a fetch failure changes only the freshness: the tree slot is the same object', async () => {
    const fetch = fetchFailed('fetch-failed');
    const { result, held } = await heldThenAnswered(okRefresh(fetch, treeResponse(treeOk({ commit: COMMIT_B }))));
    expect(result.current.tree).toBe(held);
    expect(result.current.freshness).toMatchObject({ s: 'answered', fetch });
  });

  it('a tree failure keeps the listing and says relist-failed with its word', async () => {
    const { result, held } = await heldThenAnswered(okRefresh(RAN, bodyOf('git-failed')));
    expect(result.current.tree).toBe(held);
    expect(result.current.freshness).toEqual({ s: 'relist-failed', answer: failedAnswer('git-failed') });
  });

  it("a refresh answer that changes the leaf's pin re-reads it, keeps the old body meanwhile, then sets updatedTo", async () => {
    const moved = treeOk({ commit: COMMIT_B, entries: [entry('specs', 'a.md', { committed: { kind: 'file', blob: BLOB_2, size: 9 } })] });
    let settle: (a: DocsRefreshLoaderAnswer) => void = () => {};
    const f = fakeLoaders({ tree: due() });
    f.refresh.mockImplementationOnce(() => new Promise((r) => { settle = r; }));
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    expect(f.file).toHaveBeenCalledTimes(1);
    let release: (a: Awaited<ReturnType<DocsLoaders['file']>>) => void = () => {};
    f.file.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await act(async () => settle(okRefresh(RAN, treeResponse(moved))));
    await flush();
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(f.file.mock.calls[1]?.[1]).toMatchObject({ kind: 'committed', commit: COMMIT_B });
    expect(result.current.file).toMatchObject({ s: 'ok', pin: { commit: COMMIT_A } });
    expect(result.current.updatedTo).toBeNull();
    await act(async () => release(okFile('# B')));
    await flush();
    expect(result.current.file).toMatchObject({ s: 'ok', pin: { commit: COMMIT_B } });
    expect(result.current.updatedTo).toBe(COMMIT_B);
  });

  it('a POST the route did not answer is refresh-failed', async () => {
    const f = fakeLoaders({ tree: due(), refresh: { s: 'unreachable' } });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(result.current.freshness).toEqual({ s: 'refresh-failed', answer: { s: 'unreachable' } });
  });

  it('a route word with an auto plan on the POST is retried once', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: due(), refresh: failedAnswer('docs-busy', { retryAfterMs: 2000 }) });
    visit(f.loaders, '/docs/demo');
    await flush();
    await advance(2000);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    await advance(600_000);
    expect(f.refresh).toHaveBeenCalledTimes(2);
  });
});

describe('fetch-too-soon and the three lock ages (row 61, PWA half)', () => {
  it('fetch-too-soon gives soon and one automatic retry at retryAfterMs, with the same reason', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const f = fakeLoaders({ tree: due(), refresh: okRefresh(fetchFailed('fetch-too-soon', { retryAfterMs: 4000 })) });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(result.current.freshness).toEqual({ s: 'soon', retryAt: 1_004_000 });
    await advance(3999);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.refresh.mock.calls[1]).toEqual(['demo', { ref: null, reason: 'auto' }]);
    await advance(600_000);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.s).toBe('answered');
  });

  it('ref-locked at lockAgeMs 5000 retries once after 3000 ms', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: due(), refresh: okRefresh(fetchFailed('ref-locked', { lockAgeMs: 5000, ref: 'refs/heads/main' })) });
    visit(f.loaders, '/docs/demo');
    await flush();
    await advance(2999);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    await advance(600_000);
    expect(f.refresh).toHaveBeenCalledTimes(2);
  });

  it('ref-locked with lockAgeMs null (the lock went) retries after 3000 ms too', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: due(), refresh: okRefresh(fetchFailed('ref-locked', { lockAgeMs: null })) });
    visit(f.loaders, '/docs/demo');
    await flush();
    await advance(3000);
    expect(f.refresh).toHaveBeenCalledTimes(2);
  });

  it('ref-locked at lockAgeMs 120000 is a stale lock with no retry', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: due(), refresh: okRefresh(fetchFailed('ref-locked', { lockAgeMs: 120_000, ref: 'refs/heads/main' })) });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(result.current.freshness).toEqual({ s: 'stale-lock', ref: 'refs/heads/main' });
    await advance(600_000);
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it('a stale lock whose answer names no ref says so with null', async () => {
    const f = fakeLoaders({ tree: due(), refresh: okRefresh(fetchFailed('ref-locked', { lockAgeMs: 60_000 })) });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(result.current.freshness).toEqual({ s: 'stale-lock', ref: null });
  });

  it('ref-locked with lockAgeMs absent offers only a manual Retry', async () => {
    vi.useFakeTimers();
    const fetch = fetchFailed('ref-locked', { ref: 'refs/heads/main' });
    const f = fakeLoaders({ tree: due(), refresh: okRefresh(fetch) });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    await advance(600_000);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.freshness).toMatchObject({ s: 'answered', fetch });
    act(() => result.current.refreshManual());
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.refresh.mock.calls[1]).toEqual(['demo', { ref: null, reason: 'manual' }]);
  });
});
