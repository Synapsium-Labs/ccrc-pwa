// Docs W5 part 1, Task 5: auto-refresh and re-listing (spec 2026-10-01 4.3, M4.A1-A3, section 2 rows 60 and 61's
// PWA half). Once per open per (project, ref), only on a resolved tree, never on a refs/heads/ view; a return to the
// tab re-lists a stale listing with a GET and never a POST; a refresh answer's tree replaces the slot, its fetch
// failure changes only the freshness, its tree failure keeps the listing; fetch-too-soon and a young lock retry once,
// a stale lock and an unmeasured one never. Loaders are spies; nothing reaches a server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Activity, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { DOCS_STALE_MS, type DocsPageLocation } from '../../shared/docs';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { useDocsVisit } from '../src/docs/useDocsVisit';
import type { DocsLoaders, DocsRefreshLoaderAnswer } from '../src/docs/failures';
import {
  BLOB_2, COMMIT_A, COMMIT_B, RAN, bodyOf, entry, failedAnswer, fakeLoaders, fetchFailed, okFile, okRefresh, okTree,
  pageAt, recordingRejections, treeOk, treeResponse,
} from './docsFixtures';

afterEach(() => {
  cleanup();
  clearAuthLost();
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

  it('a slot that goes ok again after a sign-in is not auto-refreshed again: one POST per key per open', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: due() });
    f.refresh.mockResolvedValueOnce(okRefresh());
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    f.tree.mockResolvedValueOnce({ s: 'auth' });
    await advance(DOCS_STALE_MS + 1);
    await act(async () => show('visible'));
    await flush();
    expect(result.current.tree).toEqual({ s: 'auth' });
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(3);
    expect(result.current.tree?.s).toBe('ok');
    expect(f.refresh).toHaveBeenCalledTimes(1);
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

describe('a timer or an answer acts only on the state it was for', () => {
  /** A held GET (started by Re-list) and a held POST, released by the test in either order. */
  function held<T>() {
    let settle: (v: T) => void = () => {};
    const promise = new Promise<T>((r) => { settle = r; });
    return { promise, settle: (v: T) => settle(v) };
  }

  it('a tap at 1 s on the soon chip settles the refresh; the 4 s timer then POSTs nothing', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const f = fakeLoaders({ tree: due() });
    f.refresh.mockResolvedValueOnce(okRefresh(fetchFailed('fetch-too-soon', { retryAfterMs: 4000 })));
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(result.current.freshness.s).toBe('soon');
    await advance(1000);
    act(() => result.current.refreshManual());
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.refresh.mock.calls[1]).toEqual(['demo', { ref: null, reason: 'manual' }]);
    await advance(10_000);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.s).toBe('answered');
  });

  it('an older GET that lands after a newer POST answer does not replace the slot or move the leaf back', async () => {
    const f = fakeLoaders();
    const get = held<Awaited<ReturnType<DocsLoaders['tree']>>>();
    f.tree.mockResolvedValueOnce(okTree(treeOk({ commit: COMMIT_A })));
    f.tree.mockImplementationOnce(() => get.promise);
    f.refresh.mockResolvedValueOnce(okRefresh(RAN, treeResponse(treeOk({ commit: COMMIT_B }))));
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    act(() => result.current.retryTree());
    await flush();
    act(() => result.current.refreshManual());
    await flush();
    const at = (slot: typeof result.current.tree) => (slot?.s === 'ok' ? slot.answer.tree.ref.commit : slot?.s);
    expect(at(result.current.tree)).toBe(COMMIT_B);
    expect(result.current.file).toMatchObject({ s: 'ok', pin: { commit: COMMIT_B } });
    await act(async () => get.settle(okTree(treeOk({ commit: COMMIT_A }))));
    await flush();
    expect(at(result.current.tree)).toBe(COMMIT_B);
    expect(result.current.file).toMatchObject({ s: 'ok', pin: { commit: COMMIT_B } });
    expect(result.current.updatedTo).toBeNull();
  });

  it('a GET that starts after the POST began and lands before it does not stop the POST\'s newer tree from landing', async () => {
    const f = fakeLoaders();
    const post = held<DocsRefreshLoaderAnswer>();
    f.tree.mockResolvedValueOnce(okTree(treeOk({ commit: COMMIT_A })));
    f.tree.mockResolvedValueOnce(okTree(treeOk({ commit: COMMIT_A })));
    f.refresh.mockImplementationOnce(() => post.promise);
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    act(() => result.current.refreshManual());
    await flush();
    act(() => result.current.retryTree());
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    await act(async () => post.settle(okRefresh(RAN, treeResponse(treeOk({ commit: COMMIT_B })))));
    await flush();
    const slot = result.current.tree;
    expect(slot?.s === 'ok' && slot.answer.tree.ref.commit).toBe(COMMIT_B);
    expect(result.current.file).toMatchObject({ s: 'ok', pin: { commit: COMMIT_B } });
  });

  it('an older GET that lands after a newer POST answer still releases the reads waiting on a listing', async () => {
    const moved = treeOk({ commit: COMMIT_B, entries: [entry('specs', 'a.md', { committed: { kind: 'file', blob: BLOB_2, size: 9 } })] });
    const f = fakeLoaders();
    const get = held<Awaited<ReturnType<DocsLoaders['tree']>>>();
    f.tree.mockResolvedValueOnce(okTree(treeOk({ commit: COMMIT_A })));
    f.tree.mockImplementationOnce(() => get.promise);
    f.refresh.mockResolvedValueOnce(okRefresh(RAN, treeResponse(moved)));
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    act(() => result.current.retryTree());
    await flush();
    // the POST answers; the read at the new pin says the listing moved, and its re-list is the GET already held
    f.file.mockResolvedValueOnce(failedAnswer('unknown-commit'));
    act(() => result.current.refreshManual());
    await flush();
    expect(f.file).toHaveBeenCalledTimes(2);
    await act(async () => get.settle(okTree(treeOk({ commit: COMMIT_A }))));
    await flush();
    expect(f.file).toHaveBeenCalledTimes(3);
    expect(result.current.file).toMatchObject({ s: 'ok', pin: { commit: COMMIT_B } });
  });

  it('a refresh retry set for a page the user then left makes no POST', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: due() });
    f.refresh.mockResolvedValueOnce(failedAnswer('docs-busy', { retryAfterMs: 2000 }));
    const { rerender } = visit(f.loaders, '/docs/demo');
    await flush();
    rerender({ page: pageAt('/docs/other') });
    await flush();
    await advance(10_000);
    expect(f.refresh.mock.calls.filter((c) => c[0] === 'demo')).toHaveLength(1);
  });

  it('a fetch-too-soon retry set for a page the user then left makes no POST', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: due() });
    f.refresh.mockResolvedValueOnce(okRefresh(fetchFailed('fetch-too-soon', { retryAfterMs: 4000 })));
    const { rerender } = visit(f.loaders, '/docs/demo');
    await flush();
    rerender({ page: pageAt('/docs/other') });
    await flush();
    await advance(10_000);
    expect(f.refresh.mock.calls.filter((c) => c[0] === 'demo')).toHaveLength(1);
  });

  it('a refresh loader that rejects does not pin its key: a tap makes the next POST', async () => {
    const f = fakeLoaders();
    f.refresh.mockImplementationOnce(() => Promise.reject(new Error('loader broke')));
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    const seen = await recordingRejections(async () => {
      act(() => result.current.refreshManual());
      await flush();
    });
    expect(seen).toHaveLength(1);
    act(() => result.current.refreshManual());
    await flush();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(result.current.freshness.s).toBe('answered');
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

describe('T13 review 3-6 and 4-5: a sign-in clears a refresh that failed for want of one', () => {
  it('a refresh POST that answered auth no longer shows refresh-failed once the sign-in is back, and does not POST again', async () => {
    const f = fakeLoaders({ tree: due() });
    f.refresh.mockResolvedValueOnce({ s: 'auth' });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(result.current.freshness).toEqual({ s: 'refresh-failed', answer: { s: 'auth' } });
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await flush();
    expect(result.current.freshness).toEqual({ s: 'idle' });
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it('a refresh that failed for another reason keeps its chip through a sign-in', async () => {
    const f = fakeLoaders({ tree: due() });
    f.refresh.mockResolvedValueOnce({ s: 'unreachable' });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(result.current.freshness).toEqual({ s: 'refresh-failed', answer: { s: 'unreachable' } });
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await flush();
    expect(result.current.freshness).toEqual({ s: 'refresh-failed', answer: { s: 'unreachable' } });
  });
});

describe('T13 review A-2: a refresh that answers while the screen is hidden leaves no fetching chip', () => {
  /** The hook under an Activity boundary, so `mode` hides it (effect cleanups run) and shows it again. */
  function hideable(loaders: DocsLoaders, url: string) {
    let mode: 'visible' | 'hidden' = 'visible';
    const wrapper = ({ children }: { children: ReactNode }) => <Activity mode={mode}>{children}</Activity>;
    const props = { page: pageAt(url) as DocsPageLocation | null };
    const r = renderHook((p: { page: DocsPageLocation | null }) => useDocsVisit(p.page, loaders), { initialProps: props, wrapper });
    return {
      result: r.result,
      set: (m: 'visible' | 'hidden') => {
        mode = m;
        r.rerender(props);
      },
    };
  }

  it('the answer is dropped and a screen shown again reads idle, not fetching', async () => {
    const f = fakeLoaders({ tree: due() });
    let answer: (a: DocsRefreshLoaderAnswer) => void = () => {};
    f.refresh.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const h = hideable(f.loaders, '/docs/demo');
    await flush();
    expect(h.result.current.freshness).toEqual({ s: 'fetching', reason: 'auto' });
    h.set('hidden');
    await flush();
    await act(async () => answer(okRefresh()));
    await flush();
    h.set('visible');
    await flush();
    expect(h.result.current.freshness).toEqual({ s: 'idle' });
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it('a manual refresh dropped the same way gives the chip back what it showed before', async () => {
    const f = fakeLoaders({ tree: due() });
    let answer: (a: DocsRefreshLoaderAnswer) => void = () => {};
    const h = hideable(f.loaders, '/docs/demo');
    await flush();
    expect(h.result.current.freshness.s).toBe('answered');
    const before = h.result.current.freshness;
    f.refresh.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    act(() => h.result.current.refreshManual());
    await flush();
    expect(h.result.current.freshness).toEqual({ s: 'fetching', reason: 'manual' });
    h.set('hidden');
    await flush();
    await act(async () => answer(okRefresh()));
    await flush();
    h.set('visible');
    await flush();
    expect(h.result.current.freshness).toEqual(before);
  });
});
