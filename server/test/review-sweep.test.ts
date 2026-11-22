import path from 'node:path';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, REVIEW_RETENTION_MS, REVIEW_SWEEP_MS, REVIEW_PENDING_RETRY_MS,
  type ReviewSource,
} from '../../shared/docsReview.js';
import type { DocsTreeOk } from '../../shared/docs.js';
import { nodeReviewFs, openReviewStore, type ReviewStore } from '../src/review/store.js';
import { startReviewSweep } from '../src/review/sweep.js';
import { DOCS_CAP } from '../src/ccdargv.js';
import * as docsRoutes from '../src/docs/routes.js';
import { LISTING_JOB } from '../src/docs/policy.js';
import { buildServer, type Deps } from '../src/server.js';
import { committedEntry, draftEntry, FIXTURE_COMMIT, line, nodeLanes, treeOk } from './docsRouteHelpers.js';
import { fakeTime } from './fakeTime.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const T = Date.UTC(2026, 10, 20);
const source = (n: number, project = 'project-a'): ReviewSource => ({
  project, section: 'specs', path: `x${n}.md`, branch: 'b', head: 'a'.repeat(40),
  servedRef: 'refs/remotes/origin/b', baseCommit: 'b'.repeat(40), fp: 'd'.repeat(64), committedBlob: null,
});
async function fixture(): Promise<ReviewStore> {
  const result = await openReviewStore(path.join(mkTmp('review-sweep-'), 'store'));
  if (!result.ok) throw new Error(result.why);
  return result.store;
}
async function put(store: ReviewStore, n: number, at = T, project = 'project-a') {
  const result = await store.put(source(n, project), Buffer.from('draft'), 0, at);
  if (!result.ok) throw new Error(result.why);
  return result.entry;
}
async function failingFixture() {
  let fail = false;
  const opened = await openReviewStore(path.join(mkTmp('review-sweep-'), 'store'), {
    ...nodeReviewFs,
    rename: async (from, to) => {
      if (fail) throw new Error('injected');
      return nodeReviewFs.rename(from, to);
    },
    unlink: async name => {
      if (fail) throw new Error('injected');
      return nodeReviewFs.unlink(name);
    },
  });
  if (!opened.ok) throw new Error(opened.why);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return { store: opened.store, failWrites: (value: boolean) => { fail = value; } };
}
async function tickPending(store: ReviewStore): Promise<void> {
  const retry = vi.spyOn(store, 'retryPending');
  try {
    await vi.advanceTimersByTimeAsync(REVIEW_PENDING_RETRY_MS);
    expect(retry).toHaveBeenCalledTimes(1);
    await retry.mock.results[0]!.value;
  } finally {
    retry.mockRestore();
  }
}
function tree(project: string, count = 3): DocsTreeOk {
  return { project, ref: { served: 'refs/remotes/origin/b' }, entries: Array.from({ length: count }, (_, n) => ({
    section: 'specs', path: `x${n}.md`, committed: { blob: 'c'.repeat(40) },
  })) } as unknown as DocsTreeOk;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('review sweep', () => {
  it('cleans young boot temp files on a later pending tick', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const dir = path.join(mkTmp('review-young-'), 'store');
    mkdirSync(dir);
    const snapshot = path.join(dir, `${'f'.repeat(64)}.v1.html.${'1'.repeat(12)}.tmp`);
    const index = path.join(dir, `index.${'2'.repeat(12)}.tmp`);
    writeFileSync(snapshot, 'copy');
    writeFileSync(index, 'index');
    for (const name of [snapshot, index]) utimesSync(name, now / 1000, now / 1000);
    const opened = await openReviewStore(dir);
    if (!opened.ok) throw new Error(opened.why);
    const store = opened.store;
    const read = vi.fn(async () => ({ ok: false as const }));
    const sweep = startReviewSweep(store, { tree: read }, () => Date.now());
    try {
      await sweep.started;
      expect(store.bytesUsed()).toBe(4);
      await vi.advanceTimersByTimeAsync(REVIEW_PENDING_RETRY_MS);
      expect(existsSync(snapshot)).toBe(true);
      expect(existsSync(index)).toBe(true);
      expect(store.bytesUsed()).toBe(4);
      await vi.advanceTimersByTimeAsync(70_000);
      await vi.waitFor(() => {
        expect(existsSync(snapshot)).toBe(false);
        expect(existsSync(index)).toBe(false);
        expect(store.bytesUsed()).toBe(0);
      });
      expect(store.bytesUsed()).toBe(0);
      expect(read).not.toHaveBeenCalled();
    } finally { await sweep.stop(); }
  });
  it('groups by project and recorded served ref and removes changed blobs', async () => {
    const store = await fixture();
    await put(store, 0); await put(store, 1); await put(store, 2); await put(store, 0, T, 'project-b');
    const read = vi.fn(async (project: string) => ({ ok: true as const, tree: tree(project) }));
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    await sweep.started;
    expect(read.mock.calls).toEqual([['project-a', 'refs/remotes/origin/b'], ['project-b', 'refs/remotes/origin/b']]);
    expect(store.all()).toHaveLength(0);
    expect(store.tombstones().map(t => t.removed.why)).toEqual(['committed', 'committed', 'committed', 'committed']);
    await sweep.stop();
  });
  it('reads the served ref, not the local branch whose blob differs', async () => {
    const store = await fixture();
    const entry = await put(store, 0);
    const base = treeOk();
    const read = vi.fn(async (_project: string, ref: string) => ({ ok: true as const, tree: treeOk({
      project: 'project-a', ref: { ...base.ref, served: ref },
      entries: ref === 'refs/heads/b' ? [committedEntry('x0.md', 'c'.repeat(40), 5)]
        : [draftEntry('x0.md', entry.source.fp, 5)],
    }) }));
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    try {
      await sweep.started;
      expect(read.mock.calls).toEqual([['project-a', 'refs/remotes/origin/b']]);
      expect(store.byId(entry.id)).not.toBeNull();
    } finally {
      await sweep.stop();
    }
  });
  it('removes expired entries before reading a tree and retains unmeasured entries', async () => {
    const store = await fixture();
    const live = await put(store, 1);
    const expired = await put(store, 0, T - REVIEW_RETENTION_MS, 'project-b');
    const read = vi.fn(async () => {
      expect(store.byId(expired.id) === null, 'expired share was visible during the first tree read').toBe(true);
      return { ok: false as const };
    });
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    try {
      await sweep.started;
      expect(store.byId(live.id)).not.toBeNull();
      expect(store.tombstones()[0]?.removed.why).toBe('retention');
    } finally {
      await sweep.stop();
    }
  });
  it('does not read a tree when the only share has reached retention', async () => {
    const store = await fixture();
    await put(store, 0, T - REVIEW_RETENTION_MS);
    const read = vi.fn(async () => ({ ok: false as const }));
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    try {
      await sweep.started;
      expect(read).not.toHaveBeenCalled();
      expect(store.tombstones().map(t => t.removed.why)).toEqual(['retention']);
    } finally {
      await sweep.stop();
    }
  });
  it('retains a re-shared or pinned entry when its measured revision changes during the tree read', async () => {
    for (const change of ['pin', 'share'] as const) {
      const store = await fixture();
      const entry = await put(store, 0);
      const remove = vi.spyOn(store, 'remove');
      const sweep = startReviewSweep(store, { tree: async () => {
        const result = change === 'pin' ? await store.setPinned(entry.tokenHash, entry.rev, true, T)
          : await store.put(source(0), Buffer.from('new draft'), 0, T);
        expect(result.ok).toBe(true);
        return { ok: true as const, tree: tree('project-a') };
      } }, () => T);
      await sweep.started;
      expect(store.byId(entry.id)).not.toBeNull();
      expect(remove).toHaveBeenCalledWith(entry.tokenHash, entry.rev, 'committed', T);
      expect(await remove.mock.results[0]!.value).toEqual({ ok: false, why: 'stale' });
      await sweep.stop();
    }
  });
  it('leaves a missing path untouched', async () => {
    const store = await fixture();
    const entry = await put(store, 0);
    const sweep = startReviewSweep(store, { tree: async () => ({ ok: true, tree: tree('project-a', 0) }) }, () => T);
    await sweep.started;
    expect(store.byId(entry.id)).not.toBeNull();
    await sweep.stop();
  });
  it('serializes overlapping manual full passes without dropping either', async () => {
    const store = await fixture();
    await put(store, 0);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const firstRead = new Promise<void>(resolve => { entered = resolve; });
    let active = 0;
    let maximum = 0;
    const read = vi.fn(async () => {
      active++;
      maximum = Math.max(maximum, active);
      entered();
      await gate;
      active--;
      return { ok: false as const };
    });
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    await firstRead;
    const second = sweep.runOnce();
    release();
    await Promise.all([sweep.started, second]);
    expect(maximum).toBe(1);
    expect(read).toHaveBeenCalledTimes(2);
    await sweep.stop();
  });
  it('does not start later groups or queued manual passes after stop', async () => {
    const store = await fixture();
    await put(store, 0);
    await put(store, 0, T, 'project-b');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const read = vi.fn(async () => { await gate; return { ok: false as const }; });
    const all = vi.spyOn(store, 'all');
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const queued = sweep.runOnce();
    const stopping = sweep.stop();
    release();
    await Promise.all([sweep.started, queued, stopping]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(1);
  });
  it('leaves timers inert until the final cleanup has retried pending work', async () => {
    vi.useFakeTimers();
    const { store, failWrites } = await failingFixture();
    await put(store, 0);
    const entry = await put(store, 1);
    let releaseRead!: () => void;
    const gate = new Promise<void>(resolve => { releaseRead = resolve; });
    const read = vi.fn(async () => { await gate; return { ok: false as const }; });
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>(resolve => { releaseRetry = resolve; });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(1);
      failWrites(true);
      await store.remove(entry.tokenHash, entry.rev, 'revoked', T);
      expect(store.hasPending()).toBe(true);
      failWrites(false);
      const normalRetry = store.retryPending.bind(store);
      const retry = vi.spyOn(store, 'retryPending').mockImplementation(async at => {
        await retryGate;
        return normalRetry(at);
      });
      const stopping = sweep.stop();
      expect(vi.getTimerCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(2 * REVIEW_SWEEP_MS);
      expect(read).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();
      releaseRead();
      await vi.advanceTimersByTimeAsync(0);
      expect(retry).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(2);
      releaseRetry();
      await stopping;
      expect(retry).toHaveBeenCalledTimes(1);
      expect(store.hasPending()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      releaseRead();
      releaseRetry();
      await sweep.stop();
    }
  });
  it('skips periodic ticks while a full pass waits rather than replaying them', async () => {
    vi.useFakeTimers();
    const store = await fixture();
    await put(store, 0);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const read = vi.fn(async () => { await gate; return { ok: false as const }; });
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * REVIEW_SWEEP_MS);
    expect(read).toHaveBeenCalledTimes(1);
    release();
    await sweep.started;
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await sweep.stop();
  });
  it('runs a full sweep on its interval and does no disk retry on an empty pending tick', async () => {
    vi.useFakeTimers();
    const store = await fixture();
    const read = vi.fn(async () => ({ ok: false as const }));
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    try {
      await sweep.started;
      await put(store, 0);
      const retry = vi.spyOn(store, 'retryPending');
      await vi.advanceTimersByTimeAsync(REVIEW_PENDING_RETRY_MS);
      expect(retry).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(REVIEW_SWEEP_MS - REVIEW_PENDING_RETRY_MS);
      expect(read).toHaveBeenCalledExactlyOnceWith('project-a', 'refs/remotes/origin/b');
    } finally {
      await sweep.stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['timer', 'pass', 'stop'] as const)('retries pending removal by %s', async mode => {
    vi.useFakeTimers();
    const { store, failWrites } = await failingFixture();
    await put(store, 0);
    failWrites(true);
    const read = vi.fn(async () => ({ ok: true as const, tree: tree('project-a') }));
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    try {
      await sweep.started;
      expect(store.hasPending()).toBe(true);
      if (mode === 'timer') {
        await tickPending(store);
        expect(store.hasPending()).toBe(true);
      }
      failWrites(false);
      if (mode === 'timer') await tickPending(store);
      if (mode === 'pass') await sweep.runOnce();
      if (mode === 'stop') await sweep.stop();
      expect(store.hasPending()).toBe(false);
    } finally {
      await sweep.stop();
    }
    const retry = vi.spyOn(store, 'retryPending');
    const calls = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2 * REVIEW_SWEEP_MS);
    expect(read).toHaveBeenCalledTimes(calls);
    expect(retry).not.toHaveBeenCalled();
  });

  it.each(['between full passes', 'while a tree read waits'] as const)('retries newly pending work %s', async mode => {
    vi.useFakeTimers();
    const { store, failWrites } = await failingFixture();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const firstRead = new Promise<void>(resolve => { entered = resolve; });
    const read = vi.fn(async () => {
      entered();
      await gate;
      return { ok: false as const };
    });
    const sweep = startReviewSweep(store, { tree: read }, () => T);
    let pass: Promise<void> | undefined;
    try {
      await sweep.started;
      expect(store.hasPending()).toBe(false);
      const entry = await put(store, 0);
      if (mode === 'while a tree read waits') {
        pass = sweep.runOnce();
        await firstRead;
      }
      failWrites(true);
      await store.remove(entry.tokenHash, entry.rev, 'revoked', T);
      expect(store.hasPending()).toBe(true);
      failWrites(false);
      await tickPending(store);
      expect(store.hasPending()).toBe(false);
      expect(read).toHaveBeenCalledTimes(pass === undefined ? 0 : 1);
    } finally {
      release();
      await pass;
      await sweep.stop();
    }
  });
});

describe('buildServer review sweep', () => {
  it('books the Docs read lane and records a believed answer at the exact served ref', async () => {
    const store = await fixture();
    const entry = await put(store, 0);
    const served = entry.source.servedRef;
    const blob = 'c'.repeat(40);
    const base = treeOk();
    const answer = treeOk({
      project: entry.source.project, ref: { ...base.ref, served, name: 'b', requested: served },
      entries: [committedEntry(entry.source.path, blob, 5)],
    });
    const calls: string[][] = [];
    const baseDeps = testDeps(mkTmp('review-sweep-home-'), async (_cmd, argv) => {
      if (argv[0] !== 'docs-tree') return { ran: true, code: 1, stdout: '', stderr: '' };
      calls.push([...argv]);
      return { ran: true, code: 0, stdout: line(answer), stderr: '', killed: false, signal: null };
    });
    const deps: Deps = { ...baseDeps, time: fakeTime({ wallMs: T }).ports, review: { store },
      fleetState: { connected: true, downSince: null, ccdVerbs: ['caps', DOCS_CAP], rosterFp: null, build: null } };
    const compose = docsRoutes.composeDocs;
    const composition = vi.spyOn(docsRoutes, 'composeDocs').mockImplementation((...args) => {
      const docs = compose(...args);
      vi.spyOn(nodeLanes(docs).read, 'run');
      return docs;
    });
    const app = await buildServer(deps);
    try {
      const sweep = app.reviewSweep;
      expect(sweep).toBeTruthy();
      await sweep!.started;
      expect(calls).toEqual([
        ['docs-tree', '--project', 'project-a', '--ref', 'refs/remotes/origin/b'],
      ]);
      expect(store.tombstones().map(t => t.removed.why)).toEqual(['committed']);
      const docs = composition.mock.results[0]!.value!;
      const lanes = nodeLanes(docs);
      expect.soft(lanes.read.run).toHaveBeenCalledExactlyOnceWith(LISTING_JOB, expect.any(AbortSignal), expect.any(Function));
      expect.soft(lanes.caches.listing.lookup(docs.lanes.primary, 'project-a', FIXTURE_COMMIT, 'specs', 'x0.md'))
        .toMatchObject({ file: { blob } });
      await app.close();
      const retry = vi.spyOn(store, 'retryPending');
      await sweep!.runOnce();
      expect(retry).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('keeps review unavailable without opening a store when a manually assembled server has no time port', async () => {
    const { time: _time, ...base } = testDeps();
    const mkdir = vi.fn(nodeReviewFs.mkdir);
    // Ordinary narrow route fixtures predate the required time port and pass only the deps they use.
    const app = await buildServer({ ...base, review: { fs: { ...nodeReviewFs, mkdir } } } as Deps);
    try {
      expect.soft(mkdir).not.toHaveBeenCalled();
      expect.soft(app.reviewSweep).toBeNull();
      expect((await app.inject('/health')).statusCode).toBe(200);
      const answer = await app.inject({
        method: 'POST', url: '/api/review/open', headers: { [REVIEW_MARKER_HEADER]: REVIEW_MARKER_VALUE },
        payload: { token: 'a'.repeat(43) },
      });
      expect(answer.statusCode).toBe(404);
      expect(answer.json()).toEqual({ ok: false, error: 'not-found' });
    } finally {
      await app.close();
    }
  });

  it('serves health without a sweep when the review store cannot open', async () => {
    const deps = testDeps();
    const mkdir = vi.fn(async () => { throw new Error('injected'); });
    const app = await buildServer({ ...deps, review: { fs: { ...nodeReviewFs, mkdir } } });
    try {
      expect(app.reviewSweep).toBeNull();
      expect(mkdir).toHaveBeenCalledWith(deps.cfg.reviewStoreDir, expect.anything());
      expect((await app.inject('/health')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
