// `server/src/docs/lane.ts`, the native Docs reader's link protection (design 2026-10-01, section 6.3, section 6.4;
// W3 refinements (j), (n) and (p)). Task 4 drives each lane clause with blocking exec doubles (`blocker()`, section
// 6.10's M6.2 "blocking doubles") and fake timers: the read lane (laneAdmit applied to the HEAD only, strict FIFO,
// the queue bound, the 10 s wait, abandonment, release on every settle, close), the fetch lane (serial per key, the
// global bound, the queue of 8 counted across keys, the 20 s wait from acceptance), single-flight with abandonment
// (a flight aborts only when EVERY joiner has gone) and the generation counter. The route-level M-cases (M6.2's
// "a non-docs route is unaffected", M6.9, M6.10) are Tasks 6 and 7's; Task 7 appends the read/fetch separation case.
//
// Every bound, wait and busy body is read from L1 (`policy.ts`), never typed here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  docsFetchLane, docsFlights, docsGenerations, docsReadLane, type DocsFetchLane, type DocsLaneRun, type DocsReadLane,
} from '../src/docs/lane.js';
import {
  DOCS_FETCH_GLOBAL, DOCS_FETCH_MAX_WAIT_MS, DOCS_FETCH_QUEUE, DOCS_LANE_BYTES, DOCS_LANE_EXECS, DOCS_LANE_LARGE_RAW,
  DOCS_LANE_MAX_WAIT_MS, DOCS_LANE_QUEUE, docsBusyBody, type DocsJob,
} from '../src/docs/policy.js';
import { blocker } from './docsRouteHelpers.js';

/** A small read job: far under every bound. */
const SMALL: DocsJob = { raw: 1000, wire: 2000 };
/** A large read job: one byte over the large threshold, its wire well inside the byte budget. */
const LARGE: DocsJob = { raw: DOCS_LANE_LARGE_RAW + 1, wire: 1100000 };
const IDLE = { execs: 0, bytes: 0, large: 0, queued: 0 };

/** A signal nobody aborts. */
const live = (): AbortSignal => new AbortController().signal;
/** Let every pending promise hop run (a settle, a `finally`, a pump); fake timers fake no microtask. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}
/** The answer `p` has already given, or `'pending'` when it has given none after a flush. */
async function settledOrPending<T>(p: Promise<T>): Promise<T | 'pending'> {
  return Promise.race([p, flush().then(() => 'pending' as const)]);
}
/** An exec that records its name when the lane starts it, then blocks on `b`. */
function named(order: string[], name: string, b: ReturnType<typeof blocker<string>>): () => Promise<string> {
  return () => {
    order.push(name);
    return b.exec();
  };
}

let lanes: { close(): void }[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  lanes = [];
});
afterEach(() => {
  for (const l of lanes) l.close();
  vi.useRealTimers();
});
function readLane(): DocsReadLane {
  const l = docsReadLane();
  lanes.push(l);
  return l;
}
function fetchLane(): DocsFetchLane {
  const l = docsFetchLane();
  lanes.push(l);
  return l;
}

describe('W3 T4: the read lane admits by laneAdmit, applied to its head (section 6.3)', () => {
  it(`${DOCS_LANE_EXECS} small jobs start at once and the third waits for a slot`, async () => {
    const lane = readLane();
    const b = blocker<string>();
    const runs = [0, 1, 2].map(() => lane.run(SMALL, live(), b.exec));
    expect(b.started()).toBe(2);
    expect(lane.load()).toStrictEqual({ execs: 2, bytes: 4000, large: 0, queued: 1 });
    b.release(0, 'a');
    await flush();
    expect(b.started()).toBe(3);
    expect(await runs[0]).toStrictEqual({ kind: 'ran', value: 'a' });
    b.release(1, 'b');
    b.release(2, 'c');
    expect(await Promise.all(runs.slice(1))).toStrictEqual([{ kind: 'ran', value: 'b' }, { kind: 'ran', value: 'c' }]);
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('the byte budget holds a second job whose wire would pass DOCS_LANE_BYTES', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const job: DocsJob = { raw: 1000, wire: 2000000 };
    expect(2 * job.wire).toBeGreaterThan(DOCS_LANE_BYTES);
    const runs = [lane.run(job, live(), b.exec), lane.run(job, live(), b.exec)];
    expect(b.started()).toBe(1);
    expect(lane.load()).toStrictEqual({ execs: 1, bytes: 2000000, large: 0, queued: 1 });
    b.release(0, 'a');
    await flush();
    expect(b.started()).toBe(2);
    b.release(1, 'b');
    await Promise.all(runs);
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('a second large job waits; exactly DOCS_LANE_LARGE_RAW is not large', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const runs = [lane.run(LARGE, live(), b.exec), lane.run(LARGE, live(), b.exec)];
    expect(b.started()).toBe(1);
    expect(lane.load()).toStrictEqual({ execs: 1, bytes: 1100000, large: 1, queued: 1 });
    b.release(0, 'a');
    await flush();
    expect(b.started()).toBe(2);
    b.release(1, 'b');
    await Promise.all(runs);

    const edge: DocsJob = { raw: DOCS_LANE_LARGE_RAW, wire: 1100000 };
    const c = blocker<string>();
    const more = [lane.run(edge, live(), c.exec), lane.run(edge, live(), c.exec)];
    expect(c.started()).toBe(2);
    expect(lane.load()).toStrictEqual({ execs: 2, bytes: 2200000, large: 0, queued: 0 });
    c.release(0, 'x');
    c.release(1, 'y');
    await Promise.all(more);
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('an idle lane admits one job over the whole byte budget, alone', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const huge: DocsJob = { raw: 1000, wire: DOCS_LANE_BYTES + 854272 };
    const runs = [lane.run(huge, live(), b.exec), lane.run(SMALL, live(), b.exec)];
    expect(b.started()).toBe(1);
    expect(lane.load()).toStrictEqual({ execs: 1, bytes: huge.wire, large: 0, queued: 1 });
    b.release(0, 'a');
    await flush();
    expect(b.started()).toBe(2);
    b.release(1, 'b');
    await Promise.all(runs);
  });
});

describe('W3 T4: the read lane is strict FIFO (section 6.3)', () => {
  it('jobs start in the order they were queued', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    const runs = ['p', 'q', 'x', 'y', 'z'].map((n) => lane.run(SMALL, live(), named(order, n, b)));
    expect(order).toStrictEqual(['p', 'q']);
    b.release(0, 'p');
    await flush();
    expect(order).toStrictEqual(['p', 'q', 'x']);
    b.release(1, 'q');
    await flush();
    expect(order).toStrictEqual(['p', 'q', 'x', 'y']);
    b.release(2, 'x');
    await flush();
    expect(order).toStrictEqual(['p', 'q', 'x', 'y', 'z']);
    b.release(3, 'y');
    b.release(4, 'z');
    await Promise.all(runs);
  });

  it('a large head blocks a small job behind it that would admit on its own', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    const runs = [
      lane.run(LARGE, live(), named(order, 'a', b)),
      lane.run(SMALL, live(), named(order, 'p', b)),
      lane.run(LARGE, live(), named(order, 'b', b)),
      lane.run(SMALL, live(), named(order, 'c', b)),
    ];
    expect(order).toStrictEqual(['a', 'p']);
    b.release(1, 'p');
    await flush();
    expect(order).toStrictEqual(['a', 'p']);
    expect(lane.load()).toStrictEqual({ execs: 1, bytes: 1100000, large: 1, queued: 2 });
    b.release(0, 'a');
    await flush();
    expect(order).toStrictEqual(['a', 'p', 'b', 'c']);
    b.release(2, 'b');
    b.release(3, 'c');
    await Promise.all(runs);
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('a new job queues behind a waiting head even when the lane would admit it', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    const runs = [
      lane.run(LARGE, live(), named(order, 'a', b)),
      lane.run(LARGE, live(), named(order, 'b', b)),
    ];
    runs.push(lane.run(SMALL, live(), named(order, 'c', b)));
    expect(order).toStrictEqual(['a']);
    b.release(0, 'a');
    await flush();
    expect(order).toStrictEqual(['a', 'b', 'c']);
    b.release(1, 'b');
    b.release(2, 'c');
    await Promise.all(runs);
  });
});

describe('W3 T4: the read lane refuses past its queue and its wait (M6.2, section 6.3)', () => {
  it(`with ${DOCS_LANE_EXECS} running and ${DOCS_LANE_QUEUE} queued, the next is docs-busy {lane:'read'} at once`, async () => {
    const lane = readLane();
    const b = blocker<string>();
    for (let i = 0; i < DOCS_LANE_EXECS + DOCS_LANE_QUEUE; i += 1) void lane.run(SMALL, live(), b.exec);
    expect(lane.load()).toStrictEqual({ execs: 2, bytes: 4000, large: 0, queued: DOCS_LANE_QUEUE });
    const next = await settledOrPending(lane.run(SMALL, live(), b.exec));
    expect(next).toStrictEqual({ kind: 'busy', body: docsBusyBody('read') });
    expect(b.started()).toBe(2);
    expect(lane.load().queued).toBe(DOCS_LANE_QUEUE);
  });

  it(`a queued job still waits at ${DOCS_LANE_MAX_WAIT_MS - 1} ms, is docs-busy at ${DOCS_LANE_MAX_WAIT_MS} ms, and never starts`, async () => {
    const lane = readLane();
    const b = blocker<string>();
    void lane.run(SMALL, live(), b.exec);
    void lane.run(SMALL, live(), b.exec);
    const waiting = lane.run(SMALL, live(), b.exec);
    await vi.advanceTimersByTimeAsync(DOCS_LANE_MAX_WAIT_MS - 1);
    expect(await settledOrPending(waiting)).toBe('pending');
    expect(lane.load().queued).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settledOrPending(waiting)).toStrictEqual({ kind: 'busy', body: docsBusyBody('read') });
    expect(lane.load().queued).toBe(0);
    b.release(0, 'a');
    b.release(1, 'b');
    await flush();
    expect(b.started()).toBe(2);
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('admission clears the wait timer: a job that starts is never answered busy later', async () => {
    const lane = readLane();
    const b = blocker<string>();
    void lane.run(SMALL, live(), b.exec);
    void lane.run(SMALL, live(), b.exec);
    const third = lane.run(SMALL, live(), b.exec);
    b.release(0, 'a');
    await flush();
    expect(b.started()).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(DOCS_LANE_MAX_WAIT_MS);
    b.release(2, 'c');
    expect(await third).toStrictEqual({ kind: 'ran', value: 'c' });
  });
});

describe('W3 T4: abandonment in the read lane (refinement (j), section 6.3)', () => {
  it('aborting a queued job answers abandoned, dequeues it, and it never starts', async () => {
    const lane = readLane();
    const b = blocker<string>();
    void lane.run(SMALL, live(), b.exec);
    void lane.run(SMALL, live(), b.exec);
    const gone = new AbortController();
    const waiting = lane.run(SMALL, gone.signal, b.exec);
    expect(lane.load().queued).toBe(1);
    gone.abort();
    expect(await settledOrPending(waiting)).toStrictEqual({ kind: 'abandoned' });
    expect(lane.load().queued).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    b.release(0, 'a');
    b.release(1, 'b');
    await flush();
    expect(b.started()).toBe(2);
  });

  it('a signal already aborted answers abandoned at once, even on an idle lane, and never starts', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const gone = new AbortController();
    gone.abort();
    expect(await settledOrPending(lane.run(SMALL, gone.signal, b.exec))).toStrictEqual({ kind: 'abandoned' });
    expect(b.started()).toBe(0);
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('aborting a RUNNING job changes nothing: the exec is not cancelled and the answer is ran', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const gone = new AbortController();
    const running = lane.run(SMALL, gone.signal, b.exec);
    expect(b.started()).toBe(1);
    gone.abort();
    b.release(0, 'a');
    expect(await running).toStrictEqual({ kind: 'ran', value: 'a' });
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('abandoning a blocking head lets the job behind it start at once', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    void lane.run(LARGE, live(), named(order, 'a', b));
    const gone = new AbortController();
    const head = lane.run(LARGE, gone.signal, named(order, 'b', b));
    void lane.run(SMALL, live(), named(order, 'c', b));
    expect(order).toStrictEqual(['a']);
    gone.abort();
    expect(await head).toStrictEqual({ kind: 'abandoned' });
    expect(order).toStrictEqual(['a', 'c']);
    expect(lane.load()).toStrictEqual({ execs: 2, bytes: 1102000, large: 1, queued: 0 });
  });
});

describe('W3 T4: the read lane releases a slot on every settle, once (section 6.3)', () => {
  it('a rejected exec frees its slot (the next queued starts) and rejects its own caller', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const first = lane.run(SMALL, live(), b.exec);
    void lane.run(SMALL, live(), b.exec);
    const third = lane.run(SMALL, live(), b.exec);
    b.fail(0, new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    await flush();
    expect(b.started()).toBe(3);
    b.release(1, 'b');
    b.release(2, 'c');
    expect(await third).toStrictEqual({ kind: 'ran', value: 'c' });
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('an exec that throws before returning a promise frees its slot too', async () => {
    const lane = readLane();
    const thrown = lane.run(SMALL, live(), () => {
      throw new Error('sync');
    });
    await expect(thrown).rejects.toThrow('sync');
    expect(lane.load()).toStrictEqual(IDLE);
  });
});

describe('W3 T4: closing the read lane (the plugin onClose, Task 6)', () => {
  it('answers every queued job busy, leaves no timer, and refuses a later run without starting it', async () => {
    const lane = docsReadLane();
    const b = blocker<string>();
    void lane.run(SMALL, live(), b.exec);
    void lane.run(SMALL, live(), b.exec);
    const queued = [0, 1, 2].map(() => lane.run(SMALL, live(), b.exec));
    expect(vi.getTimerCount()).toBe(3);
    lane.close();
    expect(vi.getTimerCount()).toBe(0);
    const busy: DocsLaneRun<string> = { kind: 'busy', body: docsBusyBody('read') };
    expect(await Promise.all(queued.map(settledOrPending))).toStrictEqual([busy, busy, busy]);
    expect(lane.load().queued).toBe(0);
    b.release(0, 'a');
    b.release(1, 'b');
    await flush();
    expect(b.started()).toBe(2);
    expect(await settledOrPending(lane.run(SMALL, live(), b.exec))).toStrictEqual(busy);
    expect(b.started()).toBe(2);
  });
});

describe('W3 T4: the fetch lane, serial per key under a global bound (section 6.4, refinement (n))', () => {
  it('the same key twice: the second waits behind the first though a global slot is free', async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    const runs = [lane.run('demo', live(), b.exec), lane.run('demo', live(), b.exec)];
    await flush();
    expect(b.started()).toBe(1);
    expect(lane.load()).toStrictEqual({ running: 1, queued: 1 });
    b.release(0, 'a');
    await flush();
    expect(b.started()).toBe(2);
    b.release(1, 'b');
    expect(await Promise.all(runs)).toStrictEqual([{ kind: 'ran', value: 'a' }, { kind: 'ran', value: 'b' }]);
    expect(lane.load()).toStrictEqual({ running: 0, queued: 0 });
  });

  it(`three keys: ${DOCS_FETCH_GLOBAL} run and the third waits for a global slot`, async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    const runs = ['a', 'b', 'demo'].map((k) => lane.run(k, live(), b.exec));
    await flush();
    expect(b.started()).toBe(DOCS_FETCH_GLOBAL);
    expect(lane.load()).toStrictEqual({ running: 2, queued: 1 });
    b.release(1, 'b');
    await flush();
    expect(b.started()).toBe(3);
    b.release(0, 'a');
    b.release(2, 'c');
    await Promise.all(runs);
    expect(lane.load()).toStrictEqual({ running: 0, queued: 0 });
  });

  it('a job waiting behind its own key never holds back another key: the later key starts on a free slot', async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    const order: string[] = [];
    const runs = [
      lane.run('demo', live(), named(order, 'demo-1', b)),
      lane.run('demo', live(), named(order, 'demo-2', b)),
      lane.run('a', live(), named(order, 'a-1', b)),
    ];
    await flush();
    expect(order).toStrictEqual(['demo-1', 'a-1']);
    expect(lane.load()).toStrictEqual({ running: 2, queued: 1 });
    b.release(0, 'x');
    await flush();
    expect(order).toStrictEqual(['demo-1', 'a-1', 'demo-2']);
    b.release(1, 'y');
    b.release(2, 'z');
    expect(await Promise.all(runs)).toStrictEqual([
      { kind: 'ran', value: 'x' }, { kind: 'ran', value: 'z' }, { kind: 'ran', value: 'y' },
    ]);
  });

  it(`with ${DOCS_FETCH_GLOBAL} running and ${DOCS_FETCH_QUEUE} queued across keys, the next is docs-busy {lane:'fetch'}`, async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    void lane.run('a', live(), b.exec);
    void lane.run('b', live(), b.exec);
    await flush();
    for (let i = 0; i < DOCS_FETCH_QUEUE; i += 1) void lane.run(i % 2 === 0 ? 'a' : `k${i}`, live(), b.exec);
    await flush();
    expect(lane.load()).toStrictEqual({ running: 2, queued: DOCS_FETCH_QUEUE });
    const next = await settledOrPending(lane.run('demo', live(), b.exec));
    expect(next).toStrictEqual({ kind: 'busy', body: docsBusyBody('fetch') });
    expect(docsBusyBody('fetch')).toStrictEqual({ ok: false, failure: 'docs-busy', lane: 'fetch', retryAfterMs: 5000 });
    expect(b.started()).toBe(2);
  });

  it(`${DOCS_FETCH_QUEUE} queued behind one running key with a global slot free: a job on an idle key starts at once`, async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    void lane.run('a', live(), b.exec);
    for (let i = 0; i < DOCS_FETCH_QUEUE; i += 1) void lane.run('a', live(), b.exec);
    await flush();
    expect(lane.load()).toStrictEqual({ running: 1, queued: DOCS_FETCH_QUEUE });
    const idle = lane.run('demo', live(), b.exec);
    await flush();
    expect(b.started()).toBe(2);
    expect(lane.load()).toStrictEqual({ running: 2, queued: DOCS_FETCH_QUEUE });
    b.release(1, 'demo');
    expect(await idle).toStrictEqual({ kind: 'ran', value: 'demo' });
  });

  it(`the same queue with the global bound reached: the next job would be the ninth not started, so it is docs-busy at once, starts nothing and leaves no timer`, async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    void lane.run('a', live(), b.exec);
    for (let i = 0; i < DOCS_FETCH_QUEUE; i += 1) void lane.run('a', live(), b.exec);
    const second = lane.run('b', live(), b.exec);
    await flush();
    expect(lane.load()).toStrictEqual({ running: DOCS_FETCH_GLOBAL, queued: DOCS_FETCH_QUEUE });
    const timers = vi.getTimerCount();
    expect(await settledOrPending(lane.run('demo', live(), b.exec)))
      .toStrictEqual({ kind: 'busy', body: docsBusyBody('fetch') });
    expect(vi.getTimerCount()).toBe(timers);
    expect(lane.load()).toStrictEqual({ running: DOCS_FETCH_GLOBAL, queued: DOCS_FETCH_QUEUE });
    expect(b.started()).toBe(DOCS_FETCH_GLOBAL);
    b.release(1, 'b');
    expect(await second).toStrictEqual({ kind: 'ran', value: 'b' });
  });

  it(`a job waiting behind its key is docs-busy at ${DOCS_FETCH_MAX_WAIT_MS} ms and never runs when its key frees`, async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    const first = lane.run('demo', live(), b.exec);
    const second = lane.run('demo', live(), b.exec);
    await vi.advanceTimersByTimeAsync(DOCS_FETCH_MAX_WAIT_MS - 1);
    expect(await settledOrPending(second)).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(await settledOrPending(second)).toStrictEqual({ kind: 'busy', body: docsBusyBody('fetch') });
    expect(lane.load()).toStrictEqual({ running: 1, queued: 0 });
    b.release(0, 'a');
    expect(await first).toStrictEqual({ kind: 'ran', value: 'a' });
    await flush();
    expect(b.started()).toBe(1);
    expect(lane.load()).toStrictEqual({ running: 0, queued: 0 });
  });

  it('a job waiting for a global slot is docs-busy at its wait, never runs, and frees its place', async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    void lane.run('a', live(), b.exec);
    void lane.run('b', live(), b.exec);
    const third = lane.run('demo', live(), b.exec);
    await vi.advanceTimersByTimeAsync(DOCS_FETCH_MAX_WAIT_MS);
    expect(await settledOrPending(third)).toStrictEqual({ kind: 'busy', body: docsBusyBody('fetch') });
    expect(lane.load()).toStrictEqual({ running: 2, queued: 0 });
    b.release(0, 'a');
    await flush();
    expect(b.started()).toBe(2);
    expect(lane.load()).toStrictEqual({ running: 1, queued: 0 });
    const fourth = lane.run('demo', live(), b.exec);
    await flush();
    expect(b.started()).toBe(3);
    b.release(1, 'b');
    b.release(2, 'd');
    expect(await fourth).toStrictEqual({ kind: 'ran', value: 'd' });
  });

  it('aborting a queued fetch answers abandoned and dequeues it, behind its key or the global bound', async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    void lane.run('a', live(), b.exec);
    void lane.run('b', live(), b.exec);
    const behindKey = new AbortController();
    const behindGlobal = new AbortController();
    const k = lane.run('a', behindKey.signal, b.exec);
    const g = lane.run('demo', behindGlobal.signal, b.exec);
    await flush();
    expect(lane.load()).toStrictEqual({ running: 2, queued: 2 });
    behindKey.abort();
    behindGlobal.abort();
    expect(await settledOrPending(k)).toStrictEqual({ kind: 'abandoned' });
    expect(await settledOrPending(g)).toStrictEqual({ kind: 'abandoned' });
    expect(lane.load()).toStrictEqual({ running: 2, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);
    b.release(0, 'a');
    b.release(1, 'b');
    await flush();
    expect(b.started()).toBe(2);
    expect(lane.load()).toStrictEqual({ running: 0, queued: 0 });
  });

  it('a signal already aborted answers abandoned with no exec; aborting a running fetch changes nothing', async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    const gone = new AbortController();
    gone.abort();
    expect(await settledOrPending(lane.run('demo', gone.signal, b.exec))).toStrictEqual({ kind: 'abandoned' });
    expect(b.started()).toBe(0);
    const later = new AbortController();
    const running = lane.run('demo', later.signal, b.exec);
    await flush();
    expect(b.started()).toBe(1);
    later.abort();
    b.release(0, 'a');
    expect(await running).toStrictEqual({ kind: 'ran', value: 'a' });
  });

  it('a rejected fetch frees its key and its global slot and rejects its own caller', async () => {
    const lane = fetchLane();
    const b = blocker<string>();
    const first = lane.run('demo', live(), b.exec);
    void lane.run('a', live(), b.exec);
    const third = lane.run('demo', live(), b.exec);
    await flush();
    b.fail(0, new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    await flush();
    expect(b.started()).toBe(3);
    expect(lane.load()).toStrictEqual({ running: 2, queued: 0 });
    b.release(1, 'a');
    b.release(2, 'c');
    expect(await third).toStrictEqual({ kind: 'ran', value: 'c' });
  });

  it('close answers every queued fetch busy, leaves no timer, and refuses a later run', async () => {
    const lane = docsFetchLane();
    const b = blocker<string>();
    void lane.run('a', live(), b.exec);
    void lane.run('b', live(), b.exec);
    const queued = [lane.run('a', live(), b.exec), lane.run('demo', live(), b.exec)];
    await flush();
    lane.close();
    expect(vi.getTimerCount()).toBe(0);
    const busy: DocsLaneRun<string> = { kind: 'busy', body: docsBusyBody('fetch') };
    expect(await Promise.all(queued.map(settledOrPending))).toStrictEqual([busy, busy]);
    b.release(0, 'a');
    b.release(1, 'b');
    await flush();
    expect(b.started()).toBe(2);
    expect(await settledOrPending(lane.run('demo', live(), b.exec))).toStrictEqual(busy);
    await flush();
    expect(b.started()).toBe(2);
  });
});

describe('W3 T4: single-flight (section 6.4, refinement (j))', () => {
  it('two joins on one key start once and both receive the one value', async () => {
    const flights = docsFlights();
    const b = blocker<string>();
    const start = vi.fn((_s: AbortSignal) => b.exec());
    const one = flights.join('k', live(), start);
    const two = flights.join('k', live(), start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(flights.size()).toBe(1);
    b.release(0, 'v');
    expect(await Promise.all([one, two])).toStrictEqual(['v', 'v']);
  });

  it('different keys start separately', () => {
    const flights = docsFlights();
    const b = blocker<string>();
    void flights.join('k1', live(), () => b.exec());
    void flights.join('k2', live(), () => b.exec());
    expect(b.started()).toBe(2);
    expect(flights.size()).toBe(2);
  });

  it('a settled flight frees its key: a third join starts again', async () => {
    const flights = docsFlights();
    const b = blocker<string>();
    const first = flights.join('k', live(), () => b.exec());
    b.release(0, 'v1');
    expect(await first).toBe('v1');
    await flush();
    expect(flights.size()).toBe(0);
    const again = flights.join('k', live(), () => b.exec());
    expect(b.started()).toBe(2);
    b.release(1, 'v2');
    expect(await again).toBe('v2');
  });

  it('a rejected flight rejects every joiner and frees its key', async () => {
    const flights = docsFlights();
    const b = blocker<string>();
    const one = flights.join('k', live(), () => b.exec());
    const two = flights.join('k', live(), () => b.exec());
    b.fail(0, new Error('boom'));
    await expect(one).rejects.toThrow('boom');
    await expect(two).rejects.toThrow('boom');
    await flush();
    expect(flights.size()).toBe(0);
    const thrown = flights.join('s', live(), () => {
      throw new Error('sync');
    });
    await expect(thrown).rejects.toThrow('sync');
    await flush();
    expect(flights.size()).toBe(0);
  });

  it("the flight's signal aborts only when EVERY joiner's signal has aborted", async () => {
    const flights = docsFlights();
    const b = blocker<string>();
    let flight: AbortSignal | undefined;
    const a = new AbortController();
    const c = new AbortController();
    void flights.join('k', a.signal, (s) => {
      flight = s;
      return b.exec();
    });
    void flights.join('k', c.signal, () => b.exec());
    expect(flight?.aborted).toBe(false);
    a.abort();
    expect(flight?.aborted).toBe(false);
    c.abort();
    expect(flight?.aborted).toBe(true);
  });

  it('a join on an abandoned flight starts a NEW flight; the old one settles alone', async () => {
    const flights = docsFlights();
    const b = blocker<string>();
    const signals: AbortSignal[] = [];
    const start = (s: AbortSignal): Promise<string> => {
      signals.push(s);
      return b.exec();
    };
    const a = new AbortController();
    const old = flights.join('k', a.signal, start);
    a.abort();
    expect(signals[0].aborted).toBe(true);
    const fresh = flights.join('k', live(), start);
    expect(b.started()).toBe(2);
    expect(signals[1].aborted).toBe(false);
    b.release(0, 'old');
    expect(await old).toBe('old');
    await flush();
    expect(flights.size()).toBe(1);
    b.release(1, 'new');
    expect(await fresh).toBe('new');
    await flush();
    expect(flights.size()).toBe(0);
  });

  it('a lone joiner whose signal is already aborted starts a flight whose signal is aborted', () => {
    const flights = docsFlights();
    const gone = new AbortController();
    gone.abort();
    let flight: AbortSignal | undefined;
    void flights.join('k', gone.signal, (s) => {
      flight = s;
      return new Promise<string>(() => {});
    });
    expect(flight?.aborted).toBe(true);
  });

  it('through the read lane: a queued flight whose every requester left is abandoned and never execs', async () => {
    const lane = readLane();
    const flights = docsFlights();
    const b = blocker<string>();
    void lane.run(SMALL, live(), b.exec);
    void lane.run(SMALL, live(), b.exec);
    const a = new AbortController();
    const c = new AbortController();
    const start = (s: AbortSignal): Promise<DocsLaneRun<string>> => lane.run(SMALL, s, b.exec);
    const one = flights.join('k', a.signal, start);
    const two = flights.join('k', c.signal, start);
    expect(lane.load().queued).toBe(1);
    a.abort();
    expect(lane.load().queued).toBe(1);
    c.abort();
    expect(await Promise.all([one, two])).toStrictEqual([{ kind: 'abandoned' }, { kind: 'abandoned' }]);
    expect(lane.load().queued).toBe(0);
    b.release(0, 'a');
    b.release(1, 'b');
    await flush();
    expect(b.started()).toBe(2);
  });
});

describe('W3 T4: the generation counter (section 6.4)', () => {
  it('starts at 0 per key, bump answers the new value, and keys are independent', () => {
    const gens = docsGenerations();
    expect(gens.current('demo')).toBe(0);
    expect(gens.bump('demo')).toBe(1);
    expect(gens.bump('demo')).toBe(2);
    expect(gens.current('demo')).toBe(2);
    expect(gens.current('a')).toBe(0);
    expect(gens.bump('a')).toBe(1);
    expect(gens.current('demo')).toBe(2);
  });
});

describe('W3 T7: the fetch lane and the read lane are separate (section 6.4: fetch answers take no read-lane slot)', () => {
  it('a full read lane leaves a fetch untouched, and a read admits from its queue while the fetch lane is at its bound', async () => {
    const read = readLane();
    const fetch = fetchLane();
    const br = blocker<string>();
    const bf = blocker<string>();
    for (let i = 0; i < DOCS_LANE_EXECS + DOCS_LANE_QUEUE; i += 1) void read.run(SMALL, live(), br.exec);
    expect(read.load()).toStrictEqual({ execs: DOCS_LANE_EXECS, bytes: DOCS_LANE_EXECS * SMALL.wire, large: 0, queued: DOCS_LANE_QUEUE });
    expect(await read.run(SMALL, live(), br.exec)).toStrictEqual({ kind: 'busy', body: docsBusyBody('read') });
    void fetch.run('k0', live(), bf.exec);
    expect(bf.started()).toBe(1);
    for (let i = 1; i < DOCS_FETCH_GLOBAL + DOCS_FETCH_QUEUE; i += 1) void fetch.run(`k${i % DOCS_FETCH_GLOBAL}`, live(), bf.exec);
    expect(fetch.load()).toStrictEqual({ running: DOCS_FETCH_GLOBAL, queued: DOCS_FETCH_QUEUE });
    expect(await fetch.run('k-next', live(), bf.exec)).toStrictEqual({ kind: 'busy', body: docsBusyBody('fetch') });
    br.release(0, 'r0');
    await flush();
    expect(br.started()).toBe(DOCS_LANE_EXECS + 1);
    expect(read.load().queued).toBe(DOCS_LANE_QUEUE - 1);
    expect(bf.started()).toBe(DOCS_FETCH_GLOBAL);
  });
});

describe('FR1 review F6: a settled flight detaches its joiners, so a joiner that goes later touches nothing of the dead flight', () => {
  it.each(['fulfilled', 'rejected'] as const)('a joiner whose signal aborts AFTER a %s flight settled leaves the flight\'s own signal unaborted', async (how) => {
    const flights = docsFlights();
    const b = blocker<string>();
    const joiner = new AbortController();
    let flight: AbortSignal | undefined;
    const settled = flights.join('k', joiner.signal, (s) => {
      flight = s;
      return b.exec();
    });
    if (how === 'fulfilled') {
      b.release(0, 'v');
      await settled;
    } else {
      b.fail(0, new Error('boom'));
      await expect(settled).rejects.toThrow('boom');
    }
    await flush();
    expect(flights.size()).toBe(0);
    expect(flight?.aborted).toBe(false);
    joiner.abort();
    expect(flight?.aborted, 'the settled flight kept a listener on its joiner').toBe(false);
  });
});
