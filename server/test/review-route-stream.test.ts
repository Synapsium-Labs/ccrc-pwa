import path from 'node:path';
import { request, type ClientRequest, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { REVIEW_IDLE_MS } from '../../shared/docsReview.js';
import { buildServer } from '../src/server.js';
import type { ReviewEntry } from '../src/review/policy.js';
import { openReviewStore } from '../src/review/store.js';
import { fakeTime } from './fakeTime.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const route = '/api/review/open';
const waitMs = 2_000;
const realTimers = { setTimeout, clearTimeout };

function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function wait<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = realTimers.setTimeout(() => reject(new Error(`review fixture: ${label} did not settle`)), waitMs);
    })]);
  } finally { realTimers.clearTimeout(timer); }
}

async function fixture(firstBytes = Buffer.from('draft')) {
  const home = mkTmp('review-stream-');
  const opened = await openReviewStore(path.join(home, 'store'));
  if (!opened.ok) throw new Error(opened.why);
  const store = opened.store;
  const time = fakeTime();
  const deps = { ...testDeps(home), time: time.ports };
  const app = await buildServer({ ...deps, review: { store } });
  const clients = new Set<ClientRequest>();
  const sources: PassThrough[] = [];
  const observe = new Map<string, {
    closed: () => void;
    configure?: (raw: ServerResponse) => void;
    beforeSend?: (status: number) => Promise<void>;
  }>();
  const viewed = vi.spyOn(store, 'markViewed');
  const openRealBytes = store.openBytes.bind(store);
  const stop = async () => {
    for (const client of clients) client.destroy();
    for (const source of sources) source.destroy();
    app.server.closeAllConnections();
    await wait('server teardown', app.close());
    await wait('view writes', Promise.allSettled(viewed.mock.results.map(result => result.value)));
  };
  try {
    if (!app.reviewSweep) throw new Error('review sweep unavailable');
    await wait('sweep startup', app.reviewSweep.started);
    await wait('sweep stop', app.reviewSweep.stop());
    const entries: ReviewEntry[] = [];
    for (let i = 0; i < 10; i++) {
      const saved = await store.put({ project: 'project-a', section: 'specs', path: `draft-${i}.md`, branch: 'b',
        head: 'a'.repeat(40), servedRef: 'refs/remotes/origin/b', baseCommit: 'b'.repeat(40),
        fp: 'd'.repeat(64), committedBlob: null }, i === 0 ? firstBytes : Buffer.from('draft'), 0, deps.time.clock.wall());
      if (!saved.ok) throw new Error(saved.why);
      entries.push(saved.entry);
    }
    app.addHook('onRequest', (req, reply, done) => {
      const id = req.headers['x-fixture-request'];
      const observer = typeof id === 'string' ? observe.get(id) : undefined;
      if (observer) {
        reply.raw.once('close', observer.closed);
        observer.configure?.(reply.raw);
      }
      done();
    });
    app.addHook('onSend', (req, reply, payload, done) => {
      const id = req.headers['x-fixture-request'];
      const beforeSend = typeof id === 'string' ? observe.get(id)?.beforeSend : undefined;
      if (beforeSend === undefined) return done(null, payload);
      void beforeSend(reply.statusCode).then(() => done(null, payload), done);
    });
    const address = await wait('server listen', app.listen({ host: '127.0.0.1', port: 0 }));
    const newSource = () => {
      const stream = new PassThrough();
      sources.push(stream);
      stream.write('start');
      return { stream, size: 8 };
    };
    const openBytes = vi.spyOn(store, 'openBytes').mockImplementation(async () => newSource());
    let next = 0;
    const post = (share: number, configure?: (raw: ServerResponse) => void, beforeSend?: (status: number) => Promise<void>) => {
      const id = String(++next);
      const label = `request ${id} (share ${share})`;
      const headers = signal<number>();
      const body = signal<{ complete: boolean; text: string }>();
      const closed = signal<void>();
      const resolveClose = () => { observe.delete(id); closed.resolve(); };
      observe.set(id, { closed: resolveClose, configure, beforeSend });
      let text = '';
      let reading: { length: number; ready: () => void } | undefined;
      const req = request(`${address}${route}`, { method: 'POST', agent: false, headers: {
        'content-type': 'application/json', 'x-ccrc-review': '1', 'x-fixture-request': id,
      } }, res => {
        headers.resolve(res.statusCode ?? 0);
        res.setEncoding('utf8');
        res.on('data', chunk => {
          text += chunk;
          if (reading && text.length >= reading.length) {
            reading.ready();
            reading = undefined;
          }
        });
        res.on('error', () => {});
        res.once('close', () => body.resolve({ complete: res.complete, text }));
      });
      clients.add(req);
      req.on('error', () => { headers.resolve(0); body.resolve({ complete: false, text }); });
      req.once('close', () => clients.delete(req));
      req.end(JSON.stringify({ token: entries[share]!.token }));
      return {
        status: () => wait(`${label} headers`, headers.promise),
        body: () => wait(`${label} body`, body.promise),
        closed: () => wait(`${label} server close`, closed.promise),
        received: (length: number) => text.length >= length ? Promise.resolve() : wait(`${label} ${length} bytes`,
          new Promise<void>(ready => { reading = { length, ready }; })),
        abort: () => req.destroy(),
      };
    };
    return { sources, store, post, stop, openBytes, openRealBytes, viewed, entries, wall: deps.time.clock.wall, stepWall: time.stepWall };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function expectBusy(req: ReturnType<Awaited<ReturnType<typeof fixture>>['post']>) {
  expect(await req.status()).toBe(429);
  expect(await req.body()).toEqual({ complete: true, text: '{"ok":false,"error":"busy"}' });
}

describe('review response stream lifecycle', () => {
  it('allows exactly two concurrent sends for one share with global headroom', async () => {
    const f = await fixture();
    try {
      const held = [f.post(0), f.post(0)];
      expect(await Promise.all(held.map(req => req.status()))).toEqual([200, 200]);
      await Promise.all(held.map(req => req.received(5)));
      expect(f.viewed).toHaveBeenCalledTimes(2);
      await expectBusy(f.post(0));
      expect(f.viewed).toHaveBeenCalledTimes(2);
      expect(await f.post(1).status()).toBe(200);
    } finally { await f.stop(); }
  });

  it.each(['completion', 'abort', 'stream error', 'pending open'] as const)(
    'releases exactly one global slot and one share slot on %s', async reason => {
      const f = await fixture();
      const entered = signal<void>();
      const pending = signal<{ stream: PassThrough; size: number }>();
      const late = new PassThrough();
      const lateClosed = signal<void>();
      late.once('close', () => lateClosed.resolve());
      try {
        const { viewed } = f;
        if (reason === 'pending open') f.openBytes.mockImplementationOnce(() => {
          entered.resolve();
          return pending.promise;
        });
        const first = f.post(0);
        if (reason === 'pending open') await wait('pending open entered', entered.promise);
        else expect(await first.status()).toBe(200);

        const other = Array.from({ length: 15 }, (_, i) => f.post(Math.floor((i + 1) / 2)));
        expect(await Promise.all(other.map(req => req.status()))).toEqual(Array(15).fill(200));
        await expectBusy(f.post(8)); // All sixteen slots, including the pending one, are taken.

        if (reason === 'completion') f.sources[0]!.end('end');
        else if (reason === 'stream error') f.sources[0]!.destroy(new Error('fixture source failed'));
        else first.abort();
        await first.closed();
        if (reason === 'completion') expect(await first.body()).toEqual({ complete: true, text: 'startend' });
        else expect((await first.body()).complete).toBe(false);
        if (reason === 'pending open') {
          const before = viewed.mock.calls.length;
          pending.resolve({ stream: late, size: 0 });
          await wait('late stream disposal', lateClosed.promise);
          expect(viewed).toHaveBeenCalledTimes(before);
        } else {
          expect(f.sources[0]!.destroyed).toBe(true);
        }

        // Probe the global counter using unrelated shares. Exactly one new send fits.
        const refill = f.post(8);
        expect(await refill.status(), `${reason}: one global slot returned`).toBe(200);
        await expectBusy(f.post(9));
        // Return the refill and one unrelated slot, so the next refusal can only be per-share.
        refill.abort();
        other[1]!.abort();
        await Promise.all([refill.closed(), other[1]!.closed()]);
        expect(await f.post(0).status(), `${reason}: one original share slot returned`).toBe(200);
        await expectBusy(f.post(0));
        expect(await f.post(9).status(), 'global headroom remains after the share refusal').toBe(200);
      } finally {
        pending.resolve({ stream: late, size: 0 });
        late.destroy();
        await f.stop();
      }
    },
  );

  it('returns both slots on post-open expiry before the refusal finishes', async () => {
    const f = await fixture();
    const opened = signal<void>();
    const handOff = signal<void>();
    const refusing = signal<number>();
    const flush = signal<void>();
    let dispose = () => {};
    try {
      // Keep the entry for the same-share probe after restoring the fixture clock.
      vi.spyOn(f.store, 'remove').mockResolvedValueOnce({ ok: false, why: 'stale' });
      f.openBytes.mockImplementationOnce(async (hash, version) => {
        const source = await f.openRealBytes(hash, version);
        if (!source) throw new Error('fixture descriptor unavailable');
        dispose = () => { source.stream.destroy(); };
        opened.resolve();
        await handOff.promise;
        return source;
      });
      const first = f.post(0, undefined, status => {
        refusing.resolve(status);
        return flush.promise;
      });
      await wait('expiry descriptor opened', opened.promise);
      const held = Array.from({ length: 15 }, (_, i) => f.post(Math.floor((i + 1) / 2)));
      expect(await Promise.all(held.map(req => req.status()))).toEqual(Array(15).fill(200));
      await expectBusy(f.post(8));

      f.stepWall(REVIEW_IDLE_MS);
      handOff.resolve();
      expect(await wait('expiry refusal entered onSend', refusing.promise)).toBe(404);
      f.stepWall(-REVIEW_IDLE_MS);
      // The refusal has decided but the socket cannot finish while onSend is held.
      const refill = f.post(8);
      expect.soft(await refill.status(), 'one global slot returned before finish').toBe(200);
      await expectBusy(f.post(9));
      refill.abort();
      held[1]!.abort();
      await Promise.all([refill.closed(), held[1]!.closed()]);
      expect.soft(await f.post(0).status(), 'one original share slot returned before finish').toBe(200);
      await expectBusy(f.post(0));
      expect(await f.post(9).status(), 'global headroom remains after the share refusal').toBe(200);

      flush.resolve();
      expect(await first.status()).toBe(404);
      expect(await first.body()).toEqual({ complete: true, text: '{"ok":false,"error":"not-found"}' });
    } finally {
      handOff.resolve();
      flush.resolve();
      dispose();
      await f.stop();
    }
  });

  it('times out a pending open from slot reservation and disposes its late stream', async () => {
    const f = await fixture();
    const entered = signal<void>();
    const pending = signal<{ stream: PassThrough; size: number }>();
    const late = new PassThrough();
    const lateClosed = signal<void>();
    late.once('close', () => lateClosed.resolve());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      f.openBytes.mockImplementationOnce(() => { entered.resolve(); return pending.promise; });
      const first = f.post(0);
      await wait('pending open entered', entered.promise);
      vi.advanceTimersByTime(29_999);
      const second = f.post(0);
      expect(await second.status()).toBe(200);
      await expectBusy(f.post(0));
      vi.advanceTimersByTime(1);
      // The refill itself is a bounded assertion even if the timer is missing.
      const refill = f.post(0);
      expect(await refill.status(), 'pending open returned its slot').toBe(200);
      await first.closed();
      const before = f.viewed.mock.calls.length;
      pending.resolve({ stream: late, size: 0 });
      await wait('late stream disposal', lateClosed.promise);
      expect(f.viewed).toHaveBeenCalledTimes(before);
      await expectBusy(f.post(0));
    } finally {
      pending.resolve({ stream: late, size: 0 });
      late.destroy();
      vi.useRealTimers();
      await f.stop();
    }
  });

  it('cuts off a send 30 seconds after its last write and frees that slot', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const stalled = f.post(0);
      expect(await stalled.status()).toBe(200);
      await stalled.received(5);
      vi.advanceTimersByTime(29_999);
      const younger = f.post(0);
      expect(await younger.status()).toBe(200);
      await expectBusy(f.post(0));
      vi.advanceTimersByTime(1);
      await stalled.closed();
      expect(await stalled.body()).toEqual({ complete: false, text: 'start' });
      expect(await f.post(0).status()).toBe(200);
      await expectBusy(f.post(0));
    } finally {
      vi.useRealTimers();
      await f.stop();
    }
  });

  it('keeps sending while writes drain even after the total time exceeds 30 seconds', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const slow = f.post(0);
      expect(await slow.status()).toBe(200);
      await slow.received(5);
      const chunk = 'x'.repeat(16 * 1024);
      for (let step = 1; step <= 3; step++) {
        vi.advanceTimersByTime(20_000);
        f.sources[0]!.write(chunk);
        await slow.received(5 + step * chunk.length);
      }
      f.sources[0]!.end('end');
      expect(await slow.body()).toEqual({ complete: true, text: 'start' + chunk.repeat(3) + 'end' });
    } finally {
      vi.useRealTimers();
      await f.stop();
    }
  });

  it('does not record a view or extend the deadline when a write reports failure', async () => {
    const f = await fixture();
    const attempted = signal<(error: Error) => void>();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const failed = f.post(0, raw => {
        // The sink sends headers but accepts no body bytes. Report the result at a controlled time.
        raw.write = ((_chunk: unknown, encoding?: unknown, callback?: unknown) => {
          const complete = typeof encoding === 'function' ? encoding : callback;
          if (typeof complete !== 'function') throw new Error('fixture expected a write callback');
          raw.flushHeaders();
          attempted.resolve(error => complete(error));
          return true;
        }) as typeof raw.write;
      });
      expect(await failed.status()).toBe(200);
      const complete = await wait('failed write attempted', attempted.promise);
      vi.advanceTimersByTime(20_000);
      complete(new Error('fixture socket write failed'));
      expect(f.viewed).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      await failed.closed();
      expect(await failed.body()).toEqual({ complete: false, text: '' });
    } finally {
      vi.useRealTimers();
      await f.stop();
    }
  });

  it('finishes the open version-one descriptor after revoke and refuses a new open', async () => {
    const text = 'version-one\n'.repeat(20_000);
    const f = await fixture(Buffer.from(text));
    const held = signal<void>();
    let resume = () => {};
    try {
      f.openBytes.mockImplementationOnce(async (hash, version) => {
        const source = await f.openRealBytes(hash, version);
        if (!source) throw new Error('fixture version-one bytes unavailable');
        const read = source.stream._read.bind(source.stream);
        let reads = 0;
        // Stop the real file stream before its second read. Revoke unlinks its name, not this descriptor.
        source.stream._read = size => {
          if (++reads !== 2) return read(size);
          resume = () => read(size);
          held.resolve();
        };
        return source;
      });
      const entry = f.entries[0]!;
      expect(entry.version).toBe(1);
      const first = f.post(0);
      expect(await first.status()).toBe(200);
      await first.received(1);
      await wait('second descriptor read held', held.promise);
      expect(f.viewed).toHaveBeenCalledTimes(1);
      await wait('first view write', f.viewed.mock.results[0]!.value);
      const current = f.store.byId(entry.id);
      if (!current) throw new Error('fixture share vanished before revoke');
      expect((await f.store.remove(entry.tokenHash, current.rev, 'revoked', f.wall())).ok).toBe(true);
      const missing = f.post(0);
      expect(await missing.status()).toBe(404);
      expect(await missing.body()).toEqual({ complete: true, text: '{"ok":false,"error":"not-found"}' });
      const releaseRead = resume;
      resume = () => {};
      releaseRead();
      expect(await first.body()).toEqual({ complete: true, text });
    } finally {
      resume();
      await f.stop();
    }
  });
});
