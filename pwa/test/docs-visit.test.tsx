// Docs W5 part 1, Task 5: one visit's slots (spec 2026-10-01 4.3). The tree slot is keyed by (project, ref) and
// reused across the visit's pages; the leaf's pin comes from `pinFor` (committed, draft or none); a committed body is
// keyed by its blob; a file read that says the listing moved re-lists once, then says "changing"; a word with an
// `auto` plan is retried once per (key, word), a `manual` one never; a 401 re-fetches on sign-in (M4.F5); and an
// unmount ends every timer and read. Loaders are spies; nothing reaches a server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Activity, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { DOCS_CLASS_CAP, type DocPin, type DocsPageLocation } from '../../shared/docs';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { DOCS_RELIST_WORDS } from '../src/docs/docsText';
import { fileKey, pinFor, treeKey, useDocsVisit } from '../src/docs/useDocsVisit';
import type { DocsLoaders } from '../src/docs/failures';
import {
  BLOB_1, BLOB_2, COMMIT_A, COMMIT_B, FP_1, SERVED, draftOf, entry, failedAnswer, fakeLoaders, holder, okFile, okTree,
  pageAt, recordingRejections, treeOk,
} from './docsFixtures';

afterEach(() => {
  cleanup();
  clearAuthLost();
  vi.useRealTimers();
});

const NUL = String.fromCharCode(0);

/** Let every answer already resolved land, and the renders and effects it causes run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await act(async () => {});
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

function visit(loaders: DocsLoaders, url: string | null, strict = false) {
  return renderHook(
    (p: { page: DocsPageLocation | null }) => useDocsVisit(p.page, loaders),
    { initialProps: { page: url === null ? null : pageAt(url) }, reactStrictMode: strict },
  );
}

const committedPin = (path: string, commit = COMMIT_A): DocPin =>
  ({ kind: 'committed', commit, servedRef: SERVED, section: 'specs', path });

describe('treeKey and the tree slot (spec 4.3)', () => {
  it('is exactly project + NUL + the ref as the page names it, empty for the default view', () => {
    expect(treeKey('demo', null)).toBe('demo' + NUL);
    expect(treeKey('demo', { kind: 'bare', name: 'ws/a' })).toBe('demo' + NUL + 'ws/a');
    expect(treeKey('demo', { kind: 'qualified', ref: 'refs/heads/main' })).toBe('demo' + NUL + 'refs/heads/main');
  });

  it('a page that failed to parse, and the index, make no request and have no tree slot', async () => {
    const f = fakeLoaders();
    const a = visit(f.loaders, null);
    const b = visit(f.loaders, '/docs');
    await flush();
    expect(f.tree).not.toHaveBeenCalled();
    expect(a.result.current.tree).toBeNull();
    expect(b.result.current.tree).toBeNull();
    expect(b.result.current.file).toEqual({ s: 'none' });
    expect(b.result.current.freshness).toEqual({ s: 'idle' });
  });

  it('shows loading, then the answer, with the time it was received', async () => {
    const f = fakeLoaders();
    const { result } = visit(f.loaders, '/docs/demo');
    expect(result.current.tree).toEqual({ s: 'loading' });
    await flush();
    expect(f.tree).toHaveBeenCalledWith('demo', null);
    expect(result.current.tree?.s).toBe('ok');
  });

  it('two refs of one project are two slots, and going back to the first costs no GET', async () => {
    const f = fakeLoaders();
    f.tree.mockResolvedValueOnce(okTree(treeOk({ commit: COMMIT_A })));
    f.tree.mockResolvedValueOnce(okTree(treeOk({ commit: COMMIT_B })));
    const { result, rerender } = visit(f.loaders, '/docs/demo?ref=a');
    await flush();
    rerender({ page: pageAt('/docs/demo?ref=b') });
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    expect(f.tree.mock.calls[1]).toEqual(['demo', { kind: 'bare', name: 'b' }]);
    const b = result.current.tree;
    expect(b?.s === 'ok' && b.answer.tree.ref.commit).toBe(COMMIT_B);
    rerender({ page: pageAt('/docs/demo?ref=a') });
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    const a = result.current.tree;
    expect(a?.s === 'ok' && a.answer.tree.ref.commit).toBe(COMMIT_A);
  });

  it('one GET per key at a time: a Retry while the GET is in flight adds none', async () => {
    const f = fakeLoaders();
    f.tree.mockImplementationOnce(() => new Promise(() => {}));
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    act(() => result.current.retryTree());
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it('a tree failure is the slot; an unknown word is kept whole', async () => {
    const f = fakeLoaders({ tree: failedAnswer('a-word-from-a-newer-server') });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(result.current.tree).toEqual(failedAnswer('a-word-from-a-newer-server'));
  });
});

describe('pinFor: the leaf the tree implies (spec 4.3 item 5)', () => {
  const modified = entry('specs', 'a.md', { draft: draftOf('modified') });

  it('a default-view leaf opens the committed side at the served commit', () => {
    expect(pinFor(treeOk(), pageAt('/docs/demo/specs/a.md'))).toEqual(committedPin('a.md'));
  });

  it('the default view never opens a draft, even one a holder at the served commit admits', () => {
    const tree = treeOk({ entries: [modified], drafts: holder() });
    expect(pinFor(tree, pageAt('/docs/demo/specs/a.md'))).toEqual(committedPin('a.md'));
  });

  it("a ref view opens an admitted modified draft at the holder's branch, HEAD and fingerprint", () => {
    const tree = treeOk({ entries: [modified], drafts: holder(COMMIT_A) });
    expect(pinFor(tree, pageAt('/docs/demo/specs/a.md?ref=refs/heads/main'))).toEqual(
      { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: 'a.md', fp: FP_1 });
  });

  it('view=committed on that draft opens the committed side', () => {
    const tree = treeOk({ entries: [modified], drafts: holder() });
    expect(pinFor(tree, pageAt('/docs/demo/specs/a.md?ref=refs/heads/main&view=committed'))).toEqual(committedPin('a.md'));
  });

  it('a holder whose HEAD is not the served commit overlays nothing', () => {
    const tree = treeOk({ entries: [modified], drafts: holder(COMMIT_B, false) });
    expect(pinFor(tree, pageAt('/docs/demo/specs/a.md?ref=refs/heads/main'))).toEqual(committedPin('a.md'));
  });

  it.each(['deleted', 'typechange'] as const)('a %s draft opens the committed side', (state) => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf(state) })], drafts: holder() });
    expect(pinFor(tree, pageAt('/docs/demo/specs/a.md?ref=refs/heads/main'))).toEqual(committedPin('a.md'));
  });

  it('a withheld new file opens nothing', () => {
    const tree = treeOk({
      entries: [entry('specs', 'n.md', { committed: null, draft: draftOf('untracked', { fp: null }) })], drafts: holder(),
    });
    expect(pinFor(tree, pageAt('/docs/demo/specs/n.md?ref=refs/heads/main'))).toBeNull();
  });

  it('a new file under view=committed opens nothing (there is no committed side)', () => {
    const tree = treeOk({ entries: [entry('specs', 'n.md', { committed: null, draft: draftOf('added') })], drafts: holder() });
    expect(pinFor(tree, pageAt('/docs/demo/specs/n.md?ref=refs/heads/main&view=committed'))).toBeNull();
  });

  it('a committed symlink opens nothing', () => {
    const tree = treeOk({ entries: [entry('specs', 'l.md', { committed: { kind: 'symlink', blob: BLOB_1, size: 4 } })] });
    expect(pinFor(tree, pageAt('/docs/demo/specs/l.md'))).toBeNull();
  });

  it('a directory page, a path with no entry, a section and a project open nothing', () => {
    const tree = treeOk({ entries: [entry('specs', 'd/a.md')] });
    expect(pinFor(tree, pageAt('/docs/demo/specs/d/'))).toBeNull();
    expect(pinFor(tree, pageAt('/docs/demo/specs/d'))).toBeNull();
    expect(pinFor(tree, pageAt('/docs/demo/specs'))).toBeNull();
    expect(pinFor(tree, pageAt('/docs/demo'))).toBeNull();
  });
});

describe('fileKey: a committed body by its blob, a draft by its whole pin (spec 4.3 item 2)', () => {
  it('a committed key names the blob and its place, never the commit', () => {
    const tree = treeOk();
    expect(fileKey(committedPin('a.md'), tree)).toBe(['blob', BLOB_1, 'specs', 'a.md'].join(NUL));
    expect(fileKey(committedPin('a.md', COMMIT_B), tree)).toBe(fileKey(committedPin('a.md'), tree));
  });

  it('a draft key names branch, head, section, path and fingerprint', () => {
    const pin: DocPin = { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: 'a.md', fp: FP_1 };
    expect(fileKey(pin, treeOk())).toBe(['draft', 'main', COMMIT_A, 'specs', 'a.md', FP_1].join(NUL));
  });
});

describe('the file slot', () => {
  it('a leaf reads its committed pin once and shows the answer with that pin', async () => {
    const f = fakeLoaders();
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    expect(f.file).toHaveBeenCalledTimes(1);
    expect(f.file.mock.calls[0]?.[0]).toBe('demo');
    expect(f.file.mock.calls[0]?.[1]).toEqual(committedPin('a.md'));
    expect(f.file.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    expect(result.current.file.s).toBe('ok');
    expect(result.current.file.s === 'ok' && result.current.file.pin).toEqual(committedPin('a.md'));
  });

  it('a draft leaf in a ref view reads the draft pin', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() })) });
    visit(f.loaders, '/docs/demo/specs/a.md?ref=refs/heads/main');
    await flush();
    expect(f.file.mock.calls[0]?.[1]).toEqual(
      { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: 'a.md', fp: FP_1 });
  });

  it('a directory, a section and a raster leaf read no file', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'd/a.md'), entry('specs', 'p.png')] })) });
    const { result, rerender } = visit(f.loaders, '/docs/demo/specs/d/');
    await flush();
    rerender({ page: pageAt('/docs/demo/specs') });
    await flush();
    rerender({ page: pageAt('/docs/demo/specs/p.png') });
    await flush();
    expect(f.file).not.toHaveBeenCalled();
    expect(result.current.file).toEqual({ s: 'none' });
  });

  it('a leaf listed over its class cap is too-large and is never requested (spec 4.4)', async () => {
    const cap = DOCS_CLASS_CAP.markdown;
    const big = entry('specs', 'big.md', { committed: { kind: 'file', blob: BLOB_1, size: cap + 1 } });
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [big] })) });
    const { result } = visit(f.loaders, '/docs/demo/specs/big.md');
    await flush();
    expect(f.file).not.toHaveBeenCalled();
    expect(result.current.file).toEqual({ s: 'too-large', pin: committedPin('big.md'), size: cap + 1, cap });
  });

  it('a leaf listed at exactly its cap is read', async () => {
    const cap = DOCS_CLASS_CAP.markdown;
    const edge = entry('specs', 'edge.md', { committed: { kind: 'file', blob: BLOB_1, size: cap } });
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [edge] })) });
    visit(f.loaders, '/docs/demo/specs/edge.md');
    await flush();
    expect(f.file).toHaveBeenCalledTimes(1);
  });

  it('a committed leaf whose blob is unchanged after the branch moves is not read again, and reports the new pin', async () => {
    const f = fakeLoaders();
    f.tree.mockResolvedValueOnce(okTree(treeOk({ commit: COMMIT_A })));
    f.tree.mockResolvedValueOnce(okTree(treeOk({ commit: COMMIT_B })));
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    act(() => result.current.retryTree());
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    expect(f.file).toHaveBeenCalledTimes(1);
    expect(result.current.file.s === 'ok' && result.current.file.pin).toEqual(committedPin('a.md', COMMIT_B));
    expect(result.current.updatedTo).toBeNull();
  });

  it('a changed blob is read at the new pin, the old body stays until it answers, then updatedTo names the commit', async () => {
    const f = fakeLoaders();
    const moved = treeOk({ commit: COMMIT_B, entries: [entry('specs', 'a.md', { committed: { kind: 'file', blob: BLOB_2, size: 100 } })] });
    f.tree.mockResolvedValueOnce(okTree(treeOk()));
    f.tree.mockResolvedValueOnce(okTree(moved));
    let release: (v: Awaited<ReturnType<DocsLoaders['file']>>) => void = () => {};
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    f.file.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    act(() => result.current.retryTree());
    await flush();
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(f.file.mock.calls[1]?.[1]).toEqual(committedPin('a.md', COMMIT_B));
    expect(result.current.file.s === 'ok' && result.current.file.pin).toEqual(committedPin('a.md'));
    expect(result.current.updatedTo).toBeNull();
    await act(async () => release(okFile('# B')));
    await flush();
    expect(result.current.file.s === 'ok' && result.current.file.pin).toEqual(committedPin('a.md', COMMIT_B));
    expect(result.current.updatedTo).toBe(COMMIT_B);
  });

  it('a draft leaf whose fingerprint changes under the same holder HEAD reads the new draft but names no commit', async () => {
    const FP_2 = 'e'.repeat(64);
    const withFp = (fp: string) => okTree(treeOk({
      entries: [entry('specs', 'a.md', { draft: draftOf('modified', { fp }) })], drafts: holder(COMMIT_A),
    }));
    const f = fakeLoaders();
    f.tree.mockResolvedValueOnce(withFp(FP_1));
    f.tree.mockResolvedValueOnce(withFp(FP_2));
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md?ref=refs/heads/main');
    await flush();
    act(() => result.current.retryTree());
    await flush();
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(f.file.mock.calls[1]?.[1]).toMatchObject({ kind: 'draft', head: COMMIT_A, fp: FP_2 });
    expect(result.current.file).toMatchObject({ s: 'ok', pin: { fp: FP_2 } });
    expect(result.current.updatedTo).toBeNull();
  });

  it('opening the committed version of a draft is a new leaf, not an update', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
    const f = fakeLoaders({ tree: okTree(tree) });
    const { result, rerender } = visit(f.loaders, '/docs/demo/specs/a.md?ref=refs/heads/main');
    await flush();
    rerender({ page: pageAt('/docs/demo/specs/a.md?ref=refs/heads/main&view=committed') });
    await flush();
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(result.current.updatedTo).toBeNull();
  });
});

describe('a file read that says the listing moved (spec 4.3 item 1)', () => {
  const WORDS = ['unknown-commit', 'draft-changed', 'worktree-moved', 'worktree-gone'];

  it('the re-list words are exactly the four the spec names', () => {
    expect([...DOCS_RELIST_WORDS].sort()).toEqual([...WORDS].sort());
  });

  it.each(WORDS)('%s re-lists the tree once and reads again, then shows changing with Retry', async (word) => {
    const f = fakeLoaders();
    f.file.mockResolvedValueOnce(failedAnswer(word));
    f.file.mockResolvedValueOnce(failedAnswer(word));
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(result.current.file).toEqual({ s: 'changing', pin: committedPin('a.md'), word });
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    act(() => result.current.retryFile());
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(3);
    expect(f.file).toHaveBeenCalledTimes(3);
    expect(result.current.file.s).toBe('ok');
  });

  it('a word outside the four is the slot, with no re-list', async () => {
    const f = fakeLoaders({ file: failedAnswer('absent-path') });
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(1);
    expect(result.current.file).toEqual({ s: 'failed', pin: committedPin('a.md'), body: failedAnswer('absent-path').body });
  });
});

describe('retries: one automatic retry per key and word, a manual word never (spec 4.3 item 4, 4.7)', () => {
  it('docs-busy {retryAfterMs: 2000} re-GETs the tree once at 2000, then offers only Retry', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: failedAnswer('docs-busy', { retryAfterMs: 2000 }) });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(1);
    await advance(1999);
    expect(f.tree).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(f.tree).toHaveBeenCalledTimes(2);
    await advance(600_000);
    expect(f.tree).toHaveBeenCalledTimes(2);
    expect(result.current.tree?.s).toBe('failed');
    act(() => result.current.retryTree());
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(3);
  });

  it('a manual word never retries by itself', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: failedAnswer('git-failed') });
    visit(f.loaders, '/docs/demo');
    await flush();
    await advance(600_000);
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it('caps-unknown waits 5 s', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: failedAnswer('caps-unknown') });
    visit(f.loaders, '/docs/demo');
    await flush();
    await advance(4999);
    expect(f.tree).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(f.tree).toHaveBeenCalledTimes(2);
  });

  it('the bookkeeping is per word: a second word gets its own one retry, a repeated one none', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.tree.mockResolvedValueOnce(failedAnswer('docs-busy', { retryAfterMs: 1000 }));
    f.tree.mockResolvedValueOnce(failedAnswer('link-failed', { retryAfterMs: 1000 }));
    f.tree.mockResolvedValueOnce(failedAnswer('docs-busy', { retryAfterMs: 1000 }));
    visit(f.loaders, '/docs/demo');
    await flush();
    await advance(1000);
    await advance(1000);
    expect(f.tree).toHaveBeenCalledTimes(3);
    await advance(60_000);
    expect(f.tree).toHaveBeenCalledTimes(3);
  });

  it('a file read answering an auto word is read once more after its wait, then offers Retry', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ file: failedAnswer('docs-busy', { retryAfterMs: 2000 }) });
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    expect(f.file).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(f.file).toHaveBeenCalledTimes(2);
    await advance(600_000);
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(result.current.file.s).toBe('failed');
    act(() => result.current.retryFile());
    await flush();
    expect(f.file).toHaveBeenCalledTimes(3);
  });

  it('a file read answering a manual word is not read again until Retry', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ file: failedAnswer('git-failed') });
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    await advance(600_000);
    expect(f.file).toHaveBeenCalledTimes(1);
    act(() => result.current.retryFile());
    await flush();
    expect(f.file).toHaveBeenCalledTimes(2);
  });
});

describe('a timer acts only on the state it was set for', () => {
  const busy = () => failedAnswer('docs-busy', { retryAfterMs: 5000 });

  it('a manual Retry at 1 s settles the read; the 5 s timer then drops nothing and reads nothing', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.file.mockResolvedValueOnce(busy());
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    expect(result.current.file.s).toBe('failed');
    await advance(1000);
    act(() => result.current.retryFile());
    await flush();
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(result.current.file.s).toBe('ok');
    await advance(4000);
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(result.current.file.s).toBe('ok');
  });

  it('a manual read still in flight at 5 s is not read a second time', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.file.mockResolvedValueOnce(busy());
    f.file.mockImplementationOnce(() => new Promise(() => {}));
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    await advance(1000);
    act(() => result.current.retryFile());
    await flush();
    expect(f.file).toHaveBeenCalledTimes(2);
    await advance(4000);
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(result.current.file.s).toBe('loading');
  });

  it('a tree retry set for a page the user then left makes no GET', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.tree.mockResolvedValueOnce(busy());
    const { rerender } = visit(f.loaders, '/docs/demo');
    await flush();
    rerender({ page: pageAt('/docs/other') });
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(f.tree).toHaveBeenCalledTimes(2);
  });

  it('a tree retry whose page is open when it fires is made', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders();
    f.tree.mockResolvedValueOnce(busy());
    const { rerender } = visit(f.loaders, '/docs/demo');
    await flush();
    rerender({ page: pageAt('/docs/other') });
    await flush();
    rerender({ page: pageAt('/docs/demo/specs') });
    await flush();
    await advance(5000);
    expect(f.tree.mock.calls.filter((c) => c[0] === 'demo')).toHaveLength(2);
  });
});

describe('a request that fails leaves no mark behind', () => {
  it('a tree loader that rejects does not pin its key: Retry makes the next GET', async () => {
    const f = fakeLoaders();
    f.tree.mockImplementationOnce(() => Promise.reject(new Error('loader broke')));
    const { result } = visit(f.loaders, '/docs/demo');
    const seen = await recordingRejections(flush);
    expect(seen).toHaveLength(1);
    act(() => result.current.retryTree());
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    expect(result.current.tree?.s).toBe('ok');
  });
});

describe('sign-in and unmount', () => {
  it('M4.F5: a 401 gives the auth slot, and clearAuthLost() calls loaders.tree again', async () => {
    const f = fakeLoaders();
    f.tree.mockResolvedValueOnce({ s: 'auth' });
    const { result } = visit(f.loaders, '/docs/demo');
    await flush();
    expect(result.current.tree).toEqual({ s: 'auth' });
    raiseAuthLost('expired');
    act(() => clearAuthLost());
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    expect(result.current.tree?.s).toBe('ok');
  });

  it('a sign-in after unmount re-fetches nothing', async () => {
    const f = fakeLoaders({ tree: { s: 'auth' } });
    const { unmount } = visit(f.loaders, '/docs/demo');
    await flush();
    unmount();
    raiseAuthLost('expired');
    clearAuthLost();
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it('unmount cancels a pending automatic retry', async () => {
    vi.useFakeTimers();
    const f = fakeLoaders({ tree: failedAnswer('docs-busy', { retryAfterMs: 2000 }) });
    const { unmount } = visit(f.loaders, '/docs/demo');
    await flush();
    unmount();
    await advance(10_000);
    expect(f.tree).toHaveBeenCalledTimes(1);
  });

  it('unmount aborts a file read in flight', async () => {
    const f = fakeLoaders();
    f.file.mockImplementationOnce(() => new Promise(() => {}));
    const { unmount } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    const signal = f.file.mock.calls[0]?.[2];
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe('an effect cleanup that aborts a read', () => {
  it('drops that read\'s entry, so showing the screen again reads once more instead of loading for ever', async () => {
    const f = fakeLoaders();
    f.file.mockImplementationOnce(() => new Promise(() => {}));
    let mode: 'visible' | 'hidden' = 'visible';
    const wrapper = ({ children }: { children: ReactNode }) => <Activity mode={mode}>{children}</Activity>;
    const props = { page: pageAt('/docs/demo/specs/a.md') as DocsPageLocation | null };
    const { rerender, result } = renderHook((p: { page: DocsPageLocation | null }) => useDocsVisit(p.page, f.loaders), {
      initialProps: props, wrapper,
    });
    await flush();
    expect(f.file).toHaveBeenCalledTimes(1);
    const signal = f.file.mock.calls[0]?.[2];
    mode = 'hidden';
    rerender(props);
    await flush();
    expect(signal?.aborted).toBe(true);
    mode = 'visible';
    rerender(props);
    await flush();
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(result.current.file.s).toBe('ok');
  });
});

describe('an effect cleanup while the first tree GET is in flight', () => {
  it('drops the loading slot, so showing the screen again lists again instead of loading for ever', async () => {
    const f = fakeLoaders();
    let answer: (a: Awaited<ReturnType<DocsLoaders['tree']>>) => void = () => {};
    f.tree.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    let mode: 'visible' | 'hidden' = 'visible';
    const wrapper = ({ children }: { children: ReactNode }) => <Activity mode={mode}>{children}</Activity>;
    const props = { page: pageAt('/docs/demo') as DocsPageLocation | null };
    const { rerender, result } = renderHook((p: { page: DocsPageLocation | null }) => useDocsVisit(p.page, f.loaders), {
      initialProps: props, wrapper,
    });
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(1);
    mode = 'hidden';
    rerender(props);
    await flush();
    await act(async () => answer(okTree()));
    await flush();
    mode = 'visible';
    rerender(props);
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
    expect(result.current.tree?.s).toBe('ok');
  });
});

describe('the fragment hand-off', () => {
  it('holds a fragment until it is cleared', () => {
    const f = fakeLoaders();
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    expect(result.current.pendingFragment).toBeNull();
    act(() => result.current.setFragment('user-content-x'));
    expect(result.current.pendingFragment).toBe('user-content-x');
    act(() => result.current.setFragment(null));
    expect(result.current.pendingFragment).toBeNull();
  });
});
