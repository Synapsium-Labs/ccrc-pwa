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
  DOCS_LANE_MAX_WAIT_MS, DOCS_LANE_QUEUE, LISTING_JOB, RANGE_PREPARE_JOB, docsBusyBody, laneStep, type DocsJob, type LaneLoad,
} from '../src/docs/policy.js';
import { blocker } from './docsRouteHelpers.js';

/** A small read job: far under every bound. */
const SMALL: DocsJob = { raw: 1000, wire: 2000 };
/** A large read job: one byte over the large threshold, its wire well inside the byte budget. */
const LARGE: DocsJob = { raw: DOCS_LANE_LARGE_RAW + 1, wire: 1100000 };
const IDLE = { execs: 0, bytes: 0, large: 0, prepares: 0, queued: 0 };

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
    expect(lane.load()).toStrictEqual({ execs: 2, bytes: 4000, large: 0, prepares: 0, queued: 1 });
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
    expect(lane.load()).toStrictEqual({ execs: 1, bytes: 2000000, large: 0, prepares: 0, queued: 1 });
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
    expect(lane.load()).toStrictEqual({ execs: 1, bytes: 1100000, large: 1, prepares: 0, queued: 1 });
    b.release(0, 'a');
    await flush();
    expect(b.started()).toBe(2);
    b.release(1, 'b');
    await Promise.all(runs);

    const edge: DocsJob = { raw: DOCS_LANE_LARGE_RAW, wire: 1100000 };
    const c = blocker<string>();
    const more = [lane.run(edge, live(), c.exec), lane.run(edge, live(), c.exec)];
    expect(c.started()).toBe(2);
    expect(lane.load()).toStrictEqual({ execs: 2, bytes: 2200000, large: 0, prepares: 0, queued: 0 });
    c.release(0, 'x');
    c.release(1, 'y');
    await Promise.all(more);
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('docs-lanes: a prepare takes at most one read exec, so a tree read is admitted while a prepare runs', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const first = lane.run(RANGE_PREPARE_JOB, live(), b.exec);
    const second = lane.run(RANGE_PREPARE_JOB, live(), b.exec);
    // A second prepare waits in the queue, though a second exec is free.
    expect(b.started()).toBe(1);
    expect(lane.load()).toStrictEqual({ execs: 1, bytes: RANGE_PREPARE_JOB.wire, large: 0, prepares: 1, queued: 1 });
    b.release(0, 'a');
    await flush();
    expect(await first).toStrictEqual({ kind: 'ran', value: 'a' });
    expect(b.started()).toBe(2);
    b.release(1, 'b');
    expect(await second).toStrictEqual({ kind: 'ran', value: 'b' });
    expect(lane.load()).toStrictEqual(IDLE);

    // With one prepare running, a tree read (the listing job) is admitted at once.
    const c = blocker<string>();
    const prepare = lane.run(RANGE_PREPARE_JOB, live(), c.exec);
    const tree = lane.run(LISTING_JOB, live(), c.exec);
    expect(c.started()).toBe(2);
    expect(lane.load()).toMatchObject({ execs: 2, prepares: 1, queued: 0 });
    c.release(0, 'p');
    c.release(1, 't');
    await Promise.all([prepare, tree]);
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('docs-lanes: a prepare held back by the one-prepare rule is passed by the reads behind it, and keeps its place among prepares', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const first = lane.run(RANGE_PREPARE_JOB, live(), b.exec);
    const second = lane.run(RANGE_PREPARE_JOB, live(), b.exec);
    // The second prepare is at the head of the queue; a tree read that arrives now is admitted at once, past it.
    const tree = lane.run(LISTING_JOB, live(), b.exec);
    expect(b.started(), 'the first prepare and the tree read run').toBe(2);
    expect(lane.load()).toMatchObject({ execs: 2, prepares: 1, queued: 1 });
    b.release(1, 't');
    expect(await tree).toStrictEqual({ kind: 'ran', value: 't' });
    b.release(0, 'a');
    expect(await first).toStrictEqual({ kind: 'ran', value: 'a' });
    await flush();
    expect(b.started(), 'the second prepare starts once the first ends').toBe(3);
    b.release(2, 'b');
    expect(await second).toStrictEqual({ kind: 'ran', value: 'b' });
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('laneStep: a prepare refused only by the one-prepare rule is skipped; any other refusal stops the pump', () => {
    const one: LaneLoad = { execs: 1, bytes: RANGE_PREPARE_JOB.wire, large: 0, prepares: 1 };
    expect(laneStep(one, RANGE_PREPARE_JOB)).toBe('skip');
    expect(laneStep(one, LISTING_JOB)).toBe('start');
    const full: LaneLoad = { execs: 2, bytes: 2 * RANGE_PREPARE_JOB.wire, large: 0, prepares: 1 };
    expect(laneStep(full, RANGE_PREPARE_JOB), 'no exec free: the pump stops, whatever the job').toBe('stop');
    expect(laneStep(full, LISTING_JOB)).toBe('stop');
  });

  it('an idle lane admits one job over the whole byte budget, alone', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const huge: DocsJob = { raw: 1000, wire: DOCS_LANE_BYTES + 854272 };
    const runs = [lane.run(huge, live(), b.exec), lane.run(SMALL, live(), b.exec)];
    expect(b.started()).toBe(1);
    expect(lane.load()).toStrictEqual({ execs: 1, bytes: huge.wire, large: 0, prepares: 0, queued: 1 });
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
    expect(lane.load()).toStrictEqual({ execs: 1, bytes: 1100000, large: 1, prepares: 0, queued: 2 });
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
    expect(lane.load()).toStrictEqual({ execs: 2, bytes: 4000, large: 0, prepares: 0, queued: DOCS_LANE_QUEUE });
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
    expect(lane.load()).toStrictEqual({ execs: 2, bytes: 1102000, large: 1, prepares: 0, queued: 0 });
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
    expect(read.load()).toStrictEqual({ execs: DOCS_LANE_EXECS, bytes: DOCS_LANE_EXECS * SMALL.wire, large: 0, prepares: 0, queued: DOCS_LANE_QUEUE });
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

// X5 A3.3 part 1: the read lane's rules for artifact jobs. Appended, so no case above is touched; the names it adds to
// the policy import sit in this second import (imports are hoisted) for the same reason.
import { DOCS_LANE_ARTIFACT_QUEUE, laneAdmit, laneNext } from '../src/docs/policy.js';

/** A small artifact job: far under every bound. */
const ART: DocsJob = { raw: 1000, wire: 2000, source: 'artifact' };
/** An artifact job at exactly the large threshold: the most an artifact job may carry. */
const ART_EDGE: DocsJob = { raw: DOCS_LANE_LARGE_RAW, wire: 1100000, source: 'artifact' };
/** An artifact range prepare: `RANGE_PREPARE_JOB` plus the source. */
const ART_PREPARE: DocsJob = { ...RANGE_PREPARE_JOB, source: 'artifact' };
const BUSY_READ: DocsLaneRun<string> = { kind: 'busy', body: docsBusyBody('read') };

describe('X5 A3.3: artifact jobs on the read lane', () => {
  it('lane: console first behind artifact jobs', async () => {
    // One artifact job runs and two wait; a console job starts at once, before both.
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    void lane.run(ART, live(), named(order, 'a1', b));
    void lane.run(ART, live(), named(order, 'a2', b));
    void lane.run(ART, live(), named(order, 'a3', b));
    expect(order).toStrictEqual(['a1']);
    expect(lane.load()).toMatchObject({ execs: 1, artifact: 1, queued: 0, artifactQueued: 2 });
    void lane.run(SMALL, live(), named(order, 'c1', b));
    expect(order).toStrictEqual(['a1', 'c1']);

    // A console job waiting behind a full lane is started before an artifact job that arrived earlier.
    const lane2 = readLane();
    const b2 = blocker<string>();
    const order2: string[] = [];
    void lane2.run(SMALL, live(), named(order2, 'c1', b2));
    void lane2.run(SMALL, live(), named(order2, 'c2', b2));
    void lane2.run(ART, live(), named(order2, 'a1', b2));
    void lane2.run(SMALL, live(), named(order2, 'c3', b2));
    expect(order2).toStrictEqual(['c1', 'c2']);
    b2.release(0, 'x');
    await flush();
    expect(order2).toStrictEqual(['c1', 'c2', 'c3']);
    b2.release(1, 'y');
    await flush();
    expect(order2).toStrictEqual(['c1', 'c2', 'c3', 'a1']);

    // A running artifact job at the large threshold does not make a console job wait: it is not counted large.
    const lane3 = readLane();
    const b3 = blocker<string>();
    void lane3.run(ART_EDGE, live(), b3.exec);
    void lane3.run(LARGE, live(), b3.exec);
    expect(b3.started()).toBe(2);
    expect(lane3.load()).toMatchObject({ execs: 2, large: 1, artifact: 1 });

    // An artifact job never passes a console job that waits: a second large console job is held at the console head
    // (one large runs), an artifact job that the lane could admit waits behind it, and a pump caused by a console job
    // behind the head leaving does not let the artifact job through.
    const lane5 = readLane();
    const b5 = blocker<string>();
    const order5: string[] = [];
    void lane5.run(LARGE, live(), named(order5, 'l1', b5));
    void lane5.run(LARGE, live(), named(order5, 'l2', b5));
    const gone5 = new AbortController();
    const behind = lane5.run(SMALL, gone5.signal, named(order5, 'c', b5));
    void lane5.run(ART, live(), named(order5, 'a', b5));
    expect(order5).toStrictEqual(['l1']);
    gone5.abort();
    expect(await behind).toStrictEqual({ kind: 'abandoned' });
    await flush();
    expect(order5).toStrictEqual(['l1']);
    expect(lane5.load()).toMatchObject({ execs: 1, queued: 1, artifactQueued: 1 });
    b5.release(0, 'x');
    await flush();
    expect(order5).toStrictEqual(['l1', 'l2', 'a']);

    // The artifact queue's own bound: the seventeenth queued artifact job is busy at once, the console queue is empty
    // and the console's own bound is untouched.
    const lane4 = readLane();
    const b4 = blocker<string>();
    void lane4.run(ART, live(), b4.exec);
    for (let i = 0; i < DOCS_LANE_ARTIFACT_QUEUE; i += 1) void lane4.run(ART, live(), b4.exec);
    expect(lane4.load()).toMatchObject({ queued: 0, artifactQueued: DOCS_LANE_ARTIFACT_QUEUE });
    expect(await settledOrPending(lane4.run(ART, live(), b4.exec))).toStrictEqual(BUSY_READ);
    expect(lane4.load()).toMatchObject({ queued: 0, artifactQueued: DOCS_LANE_ARTIFACT_QUEUE });
    // The execs are two: one artifact job runs, one console job runs, and a full console queue still fits.
    void lane4.run(SMALL, live(), b4.exec);
    for (let i = 0; i < DOCS_LANE_QUEUE; i += 1) void lane4.run(SMALL, live(), b4.exec);
    expect(lane4.load()).toMatchObject({ queued: DOCS_LANE_QUEUE, artifactQueued: DOCS_LANE_ARTIFACT_QUEUE });
    expect(await settledOrPending(lane4.run(SMALL, live(), b4.exec))).toStrictEqual(BUSY_READ);

    // The decider refuses an artifact job above the threshold even on an idle lane.
    expect(laneAdmit({ execs: 0, bytes: 0, large: 0, prepares: 0 }, { raw: DOCS_LANE_LARGE_RAW + 1, wire: 1, source: 'artifact' })).toBe(false);
    expect(laneAdmit({ execs: 0, bytes: 0, large: 0, prepares: 0 }, ART_EDGE)).toBe(true);
  });

  it('lane: one artifact job at a time', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const first = lane.run(ART, live(), b.exec);
    const second = lane.run(ART, live(), b.exec);
    // A second exec is free, yet the second artifact job waits.
    expect(b.started()).toBe(1);
    expect(lane.load()).toMatchObject({ execs: 1, artifact: 1, queued: 0, artifactQueued: 1 });
    b.release(0, 'a');
    await flush();
    expect(await first).toStrictEqual({ kind: 'ran', value: 'a' });
    expect(b.started()).toBe(2);
    expect(lane.load()).toMatchObject({ execs: 1, artifact: 1, artifactQueued: 0 });
    b.release(1, 'b');
    expect(await second).toStrictEqual({ kind: 'ran', value: 'b' });
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('lane: a second artifact range prepare waits while one runs', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const first = lane.run(ART_PREPARE, live(), b.exec);
    const second = lane.run(ART_PREPARE, live(), b.exec);
    expect(b.started()).toBe(1);
    // D-9146: the prepare is counted by `prepares`, not by the artifact read share.
    expect(lane.load()).toMatchObject({ execs: 1, prepares: 1, artifact: 0, artifactQueued: 1 });
    b.release(0, 'a');
    await flush();
    expect(await first).toStrictEqual({ kind: 'ran', value: 'a' });
    expect(b.started()).toBe(2);
    b.release(1, 'b');
    expect(await second).toStrictEqual({ kind: 'ran', value: 'b' });
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('lane: laneNext', () => {
    const idle: LaneLoad = { execs: 0, bytes: 0, large: 0, prepares: 0 };
    const full: LaneLoad = { execs: DOCS_LANE_EXECS, bytes: 0, large: 0, prepares: 0 };
    const artifactRunning: LaneLoad = { execs: 1, bytes: 2000, large: 0, prepares: 0, artifact: 1 };
    // A console head that is admitted goes first, even with an artifact head also admitted.
    expect(laneNext(idle, SMALL, ART)).toBe('reader');
    // A console head that is not admitted blocks the artifact head, which alone would be admitted.
    expect(laneAdmit({ execs: 1, bytes: 0, large: 1, prepares: 0 }, LARGE)).toBe(false);
    expect(laneAdmit({ execs: 1, bytes: 0, large: 1, prepares: 0 }, ART)).toBe(true);
    expect(laneNext({ execs: 1, bytes: 0, large: 1, prepares: 0 }, LARGE, ART)).toBeNull();
    // No console head: the artifact head by laneAdmit.
    expect(laneNext(idle, null, ART)).toBe('artifact');
    expect(laneNext(full, null, ART)).toBeNull();
    expect(laneNext(artifactRunning, null, ART)).toBeNull();
    // Nothing waits.
    expect(laneNext(idle, null, null)).toBeNull();
  });

  it('lane: artifact jobs leave on abort, wait and close', async () => {
    const lane = docsReadLane();
    const b = blocker<string>();
    void lane.run(ART, live(), b.exec);

    // Abort: abandoned, dequeued, timer cleared.
    const gone = new AbortController();
    const aborted = lane.run(ART, gone.signal, b.exec);
    expect(lane.load()).toMatchObject({ artifactQueued: 1 });
    gone.abort();
    expect(await settledOrPending(aborted)).toStrictEqual({ kind: 'abandoned' });
    expect(lane.load()).toMatchObject({ artifactQueued: 0 });
    expect(vi.getTimerCount()).toBe(0);

    // Wait: still waiting one millisecond early, busy at DOCS_LANE_MAX_WAIT_MS.
    const waiting = lane.run(ART, live(), b.exec);
    await vi.advanceTimersByTimeAsync(DOCS_LANE_MAX_WAIT_MS - 1);
    expect(await settledOrPending(waiting)).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(await settledOrPending(waiting)).toStrictEqual(BUSY_READ);
    expect(lane.load()).toMatchObject({ artifactQueued: 0 });
    expect(vi.getTimerCount()).toBe(0);

    // Close: every queued job of both FIFOs is busy, no timer is left, and a later run is busy and never starts.
    const queuedArtifact = lane.run(ART, live(), b.exec);
    void lane.run(SMALL, live(), b.exec);
    const queuedConsole = [0, 1].map(() => lane.run(SMALL, live(), b.exec));
    expect(lane.load()).toMatchObject({ queued: 2, artifactQueued: 1 });
    lane.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(await Promise.all([queuedArtifact, ...queuedConsole].map(settledOrPending))).toStrictEqual([BUSY_READ, BUSY_READ, BUSY_READ]);
    expect(lane.load()).toMatchObject({ queued: 0, artifactQueued: 0 });
    expect(await settledOrPending(lane.run(ART, live(), b.exec))).toStrictEqual(BUSY_READ);
    expect(b.started()).toBe(2);
    b.release(0, 'a');
    b.release(1, 'b');
    await flush();
    expect(b.started()).toBe(2);
  });

  // D-9146: an artifact range prepare is held by the prepare clause alone; the artifact share is for artifact READS.
  it('lane: an artifact frame runs beside an artifact prepare (D-9146)', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    void lane.run(ART_PREPARE, live(), named(order, 'p', b));
    expect(order).toStrictEqual(['p']);
    const frame = lane.run(ART, live(), named(order, 'f', b));
    expect(order, 'the frame starts at once beside the prepare').toStrictEqual(['p', 'f']);
    expect(lane.load()).toMatchObject({ execs: 2, prepares: 1, artifact: 1, artifactQueued: 0 });
    // The prepare is still running past the lane's wait: the frame never answered busy for the prepare alone.
    await vi.advanceTimersByTimeAsync(DOCS_LANE_MAX_WAIT_MS + 1);
    expect(await settledOrPending(frame)).toBe('pending');
    b.release(1, 'frame');
    expect(await frame).toStrictEqual({ kind: 'ran', value: 'frame' });
    b.release(0, 'prepare');
    await flush();
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('lane: the console is next beside an artifact prepare and frame (D-9146)', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    void lane.run(ART_PREPARE, live(), named(order, 'p', b));
    void lane.run(ART, live(), named(order, 'f1', b));
    void lane.run(ART, live(), named(order, 'f2', b));
    void lane.run(ART, live(), named(order, 'f3', b));
    expect(order).toStrictEqual(['p', 'f1']);
    expect(lane.load()).toMatchObject({ execs: 2, artifactQueued: 2 });
    // A console job waits (both execs busy); the next free exec is the console's, not the queued frames'.
    void lane.run(SMALL, live(), named(order, 'c', b));
    expect(lane.load()).toMatchObject({ queued: 1, artifactQueued: 2 });
    b.release(1, 'x');
    await flush();
    expect(order).toStrictEqual(['p', 'f1', 'c']);
    expect(lane.load()).toMatchObject({ queued: 0, artifactQueued: 2 });
    b.release(2, 'y');
    await flush();
    expect(order).toStrictEqual(['p', 'f1', 'c', 'f2']);
    // The decider itself: a console head that admits is first even though artifact heads wait.
    const beside: LaneLoad = { execs: 1, bytes: 100, large: 0, prepares: 1, artifact: 0 };
    expect(laneNext(beside, SMALL, ART)).toBe('reader');
    expect(laneNext(beside, null, ART)).toBe('artifact');
  });

  it('lane: never two prepares, never two artifact reads (D-9146)', async () => {
    // An artifact prepare runs: a second prepare, artifact or console, waits.
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    void lane.run(ART_PREPARE, live(), named(order, 'p1', b));
    void lane.run(ART_PREPARE, live(), named(order, 'p2', b));
    void lane.run(RANGE_PREPARE_JOB, live(), named(order, 'p3', b));
    expect(order).toStrictEqual(['p1']);
    expect(lane.load()).toMatchObject({ execs: 1, prepares: 1, queued: 1, artifactQueued: 1 });

    // An artifact read runs: a second artifact read waits, though an exec is free.
    const lane2 = readLane();
    const b2 = blocker<string>();
    const order2: string[] = [];
    void lane2.run(ART, live(), named(order2, 'r1', b2));
    void lane2.run(ART, live(), named(order2, 'r2', b2));
    expect(order2).toStrictEqual(['r1']);
    expect(lane2.load()).toMatchObject({ execs: 1, artifact: 1, artifactQueued: 1 });

    // Both at once: a prepare and a read run; a second of either waits.
    const lane3 = readLane();
    const b3 = blocker<string>();
    const order3: string[] = [];
    void lane3.run(ART_PREPARE, live(), named(order3, 'p1', b3));
    void lane3.run(ART, live(), named(order3, 'r1', b3));
    void lane3.run(ART, live(), named(order3, 'r2', b3));
    expect(order3).toStrictEqual(['p1', 'r1']);
    expect(lane3.load()).toMatchObject({ execs: 2, prepares: 1, artifact: 1, artifactQueued: 1 });

    // The decider: the share counts reads only, and the prepare clause is unchanged.
    const readRunning: LaneLoad = { execs: 1, bytes: 2000, large: 0, prepares: 0, artifact: 1 };
    const prepareRunning: LaneLoad = { execs: 1, bytes: 1000, large: 0, prepares: 1, artifact: 0 };
    expect(laneAdmit(readRunning, ART)).toBe(false);
    expect(laneAdmit(readRunning, ART_PREPARE)).toBe(true);
    expect(laneAdmit(prepareRunning, ART)).toBe(true);
    expect(laneAdmit(prepareRunning, ART_PREPARE)).toBe(false);
    expect(laneAdmit(prepareRunning, RANGE_PREPARE_JOB)).toBe(false);
  });

  // X5 A3 fix round 1 (item 5) pinned that a waiting console prepare held the artifact FIFO's jobs until its own wait ended. X5-FU
  // item 1 (x5-fu-console-prepare-waits) changes that on purpose: a console prepare held back only because a prepare already runs
  // waits up to DOCS_LANE_PREPARE_MAX_WAIT_MS, so the artifact jobs pass it instead of waiting behind it (D-9146 kept).
  it('lanes: an artifact frame passes a waiting console prepare, which is not answered busy at the lane\'s wait (X5-FU)', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    void lane.run(RANGE_PREPARE_JOB, live(), named(order, 'p', b));
    const waiting = lane.run(RANGE_PREPARE_JOB, live(), named(order, 'c', b));
    expect(order, 'a prepare runs, the console prepare waits (skipped)').toStrictEqual(['p']);
    await vi.advanceTimersByTimeAsync(1000);
    const frame = lane.run(ART, live(), named(order, 'f', b));
    expect(order, 'the frame starts at once, past the waiting console prepare').toStrictEqual(['p', 'f']);
    expect(lane.load()).toMatchObject({ execs: 2, prepares: 1, artifact: 1, queued: 1, artifactQueued: 0 });
    // Past the lane's ordinary wait, the console prepare still waits, and the frame still runs.
    await vi.advanceTimersByTimeAsync(DOCS_LANE_MAX_WAIT_MS + 1000);
    expect(await settledOrPending(waiting), 'the console prepare is not busy').toBe('pending');
    expect(await settledOrPending(frame)).toBe('pending');
    b.release(1, 'frame');
    expect(await frame).toStrictEqual({ kind: 'ran', value: 'frame' });
    b.release(0, 'prepare');
    await flush();
    expect(order, 'the console prepare starts once the prepare ends').toStrictEqual(['p', 'f', 'c']);
    b.release(2, 'console');
    expect(await waiting).toStrictEqual({ kind: 'ran', value: 'console' });
    await flush();
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('lanes: an artifact frame behind an artifact prepare at the artifact head is admitted when that wait ends, not answered busy', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    void lane.run(ART_PREPARE, live(), named(order, 'p', b));
    const waiting = lane.run(ART_PREPARE, live(), named(order, 'q', b));
    expect(order, 'a prepare runs, the second artifact prepare waits at the artifact head').toStrictEqual(['p']);
    await vi.advanceTimersByTimeAsync(1000);
    const frame = lane.run(ART, live(), named(order, 'f', b));
    expect(order, 'the frame waits behind it in the artifact FIFO, though an exec is free').toStrictEqual(['p']);
    expect(lane.load()).toMatchObject({ execs: 1, prepares: 1, queued: 0, artifactQueued: 2 });
    await vi.advanceTimersByTimeAsync(DOCS_LANE_MAX_WAIT_MS - 1000);
    expect(await waiting).toStrictEqual(BUSY_READ);
    expect(order, 'the frame starts as that wait ends').toStrictEqual(['p', 'f']);
    expect(await settledOrPending(frame), 'and is not busy').toBe('pending');
    expect(lane.load()).toMatchObject({ execs: 2, prepares: 1, artifact: 1, queued: 0, artifactQueued: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await settledOrPending(frame)).toBe('pending');
    b.release(1, 'frame');
    expect(await frame).toStrictEqual({ kind: 'ran', value: 'frame' });
    b.release(0, 'prepare');
    await flush();
    expect(lane.load()).toStrictEqual(IDLE);
  });
});

// X5-FU item 1 (x5-fu-console-prepare-waits, D-9146's residual): a console range prepare held back only because a prepare already
// runs waits up to DOCS_LANE_PREPARE_MAX_WAIT_MS, long enough to wait out an artifact prepare (measured worst about 23 s), and the
// artifact jobs pass it while it waits, so none of them waits behind it past its own DOCS_LANE_MAX_WAIT_MS (which would reopen
// D-9146). Appended; the names it adds sit in this third import, for the reason the second gives.
import { DOCS_LANE_PREPARE_MAX_WAIT_MS, laneWaitMs } from '../src/docs/policy.js';

describe('X5-FU item 1: a console prepare waits out an artifact prepare', () => {
  /** The measured worst case of one prepare (ccd's 20 s helper deadline, 2 s kill grace, 1 s abort lock wait). */
  const PREPARE_MS = 23000;

  it('lanes: a console prepare waits out an artifact prepare of about 23 s, and an artifact frame queued meanwhile is admitted within its wait', async () => {
    const lane = readLane();
    const b = blocker<string>();
    const t0 = Date.now();
    const starts: Record<string, number> = {};
    const timed = (name: string) => (): Promise<string> => {
      starts[name] = Date.now() - t0;
      return b.exec();
    };
    // Execs start in this order, which is the blocker's index: p 0, f1 1, f2 2, c 3.
    const prepare = lane.run(ART_PREPARE, live(), timed('p'));
    await vi.advanceTimersByTimeAsync(1000);
    const consolePrepare = lane.run(RANGE_PREPARE_JOB, live(), timed('c'));
    await vi.advanceTimersByTimeAsync(1000);
    const f1 = lane.run(ART, live(), timed('f1'));
    await vi.advanceTimersByTimeAsync(1000);
    const f2 = lane.run(ART, live(), timed('f2'));
    expect(starts, 'the first frame starts at once beside the artifact prepare, past the waiting console prepare')
      .toStrictEqual({ p: 0, f1: 2000 });
    expect(lane.load()).toMatchObject({ execs: 2, prepares: 1, artifact: 1, queued: 1, artifactQueued: 1 });

    // 11000 ms: where the console prepare's wait used to end (arrival 1000 + DOCS_LANE_MAX_WAIT_MS). It still waits.
    await vi.advanceTimersByTimeAsync(1000 + DOCS_LANE_MAX_WAIT_MS - (Date.now() - t0));
    expect(Date.now() - t0).toBe(11000);
    expect(await settledOrPending(consolePrepare), 'the console prepare is not busy at the lane\'s wait').toBe('pending');
    // The first frame ends: the frame queued behind the artifact share starts now, though the console prepare still waits.
    b.release(1, 'f1');
    expect(await f1).toStrictEqual({ kind: 'ran', value: 'f1' });
    await flush();
    expect(starts.f2, 'the queued frame starts at 11000 ms, 8000 ms after it arrived, within its own wait').toBe(11000);
    expect(await settledOrPending(f2), 'and is never answered busy').toBe('pending');
    await vi.advanceTimersByTimeAsync(DOCS_LANE_MAX_WAIT_MS);
    expect(await settledOrPending(f2), 'still running past its own wait, never cut').toBe('pending');
    b.release(2, 'f2');
    expect(await f2).toStrictEqual({ kind: 'ran', value: 'f2' });

    // 23000 ms: the artifact prepare ends; the console prepare starts at once, having waited 22000 ms.
    await vi.advanceTimersByTimeAsync(PREPARE_MS - (Date.now() - t0));
    expect(await settledOrPending(consolePrepare)).toBe('pending');
    b.release(0, 'p');
    expect(await prepare).toStrictEqual({ kind: 'ran', value: 'p' });
    await flush();
    expect(starts.c, 'the console prepare starts as the artifact prepare ends').toBe(PREPARE_MS);
    expect(starts.c! - 1000, 'it waited past the lane\'s ordinary wait').toBeGreaterThan(DOCS_LANE_MAX_WAIT_MS);
    expect(starts.c! - 1000, 'and within its own').toBeLessThan(DOCS_LANE_PREPARE_MAX_WAIT_MS);
    b.release(3, 'c');
    expect(await consolePrepare, 'the console is answered, not busy').toStrictEqual({ kind: 'ran', value: 'c' });
    await flush();
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('lanes: a console prepare is busy only at DOCS_LANE_PREPARE_MAX_WAIT_MS; an artifact prepare keeps DOCS_LANE_MAX_WAIT_MS', async () => {
    const lane = readLane();
    const b = blocker<string>();
    void lane.run(ART_PREPARE, live(), b.exec);
    const consolePrepare = lane.run(RANGE_PREPARE_JOB, live(), b.exec);
    const artifactPrepare = lane.run(ART_PREPARE, live(), b.exec);
    await vi.advanceTimersByTimeAsync(DOCS_LANE_MAX_WAIT_MS - 1);
    expect(await settledOrPending(artifactPrepare)).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(await settledOrPending(artifactPrepare), 'the artifact prepare keeps the lane\'s wait').toStrictEqual(BUSY_READ);
    await vi.advanceTimersByTimeAsync(DOCS_LANE_PREPARE_MAX_WAIT_MS - DOCS_LANE_MAX_WAIT_MS - 1);
    expect(await settledOrPending(consolePrepare), 'one millisecond early').toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(await settledOrPending(consolePrepare)).toStrictEqual(BUSY_READ);
    expect(b.started(), 'neither ever started').toBe(1);
    expect(lane.load()).toStrictEqual({ execs: 1, bytes: RANGE_PREPARE_JOB.wire, large: 0, prepares: 1, queued: 0 });
  });

  it('lanes: a console job that is not a skipped prepare still holds the artifact jobs behind it (console first kept)', async () => {
    // An artifact prepare runs; a console prepare waits (skipped); a console job the byte budget refuses waits behind it; a frame.
    const BIG: DocsJob = { raw: 1000, wire: DOCS_LANE_BYTES };
    const lane = readLane();
    const b = blocker<string>();
    const order: string[] = [];
    void lane.run(ART_PREPARE, live(), named(order, 'p', b));
    const consolePrepare = lane.run(RANGE_PREPARE_JOB, live(), named(order, 'c', b));
    const big = lane.run(BIG, live(), named(order, 'big', b));
    const goes = new AbortController();
    const gone = lane.run(SMALL, goes.signal, named(order, 'gone', b));
    const frame = lane.run(ART, live(), named(order, 'f', b));
    expect(order, 'the frame waits behind the console job the lane refuses, though an exec is free').toStrictEqual(['p']);
    expect(lane.load()).toMatchObject({ execs: 1, prepares: 1, queued: 3, artifactQueued: 1 });
    // A console job leaving pumps the lane: the refused console job still holds the frame.
    goes.abort();
    expect(await gone).toStrictEqual({ kind: 'abandoned' });
    expect(order, 'still held after a pump').toStrictEqual(['p']);
    expect(lane.load()).toMatchObject({ execs: 1, prepares: 1, queued: 2, artifactQueued: 1 });
    // The refused console job's wait ends first (it arrived first): then only the skipped prepare waits, and the frame starts.
    await vi.advanceTimersByTimeAsync(DOCS_LANE_MAX_WAIT_MS);
    expect(await big).toStrictEqual(BUSY_READ);
    expect(order).toStrictEqual(['p', 'f']);
    expect(await settledOrPending(frame)).toBe('pending');
    expect(await settledOrPending(consolePrepare)).toBe('pending');
    b.release(1, 'f');
    b.release(0, 'p');
    await flush();
    expect(order).toStrictEqual(['p', 'f', 'c']);
    b.release(2, 'c');
    expect(await consolePrepare).toStrictEqual({ kind: 'ran', value: 'c' });
    await flush();
    expect(lane.load()).toStrictEqual(IDLE);
  });

  it('laneWaitMs: a console prepare waits DOCS_LANE_PREPARE_MAX_WAIT_MS; every other job DOCS_LANE_MAX_WAIT_MS', () => {
    expect(DOCS_LANE_PREPARE_MAX_WAIT_MS, 'long enough to wait out one prepare').toBeGreaterThan(PREPARE_MS);
    expect(laneWaitMs(RANGE_PREPARE_JOB)).toBe(DOCS_LANE_PREPARE_MAX_WAIT_MS);
    expect(laneWaitMs({ ...RANGE_PREPARE_JOB, source: 'reader' })).toBe(DOCS_LANE_PREPARE_MAX_WAIT_MS);
    expect(laneWaitMs(ART_PREPARE)).toBe(DOCS_LANE_MAX_WAIT_MS);
    expect(laneWaitMs(SMALL)).toBe(DOCS_LANE_MAX_WAIT_MS);
    expect(laneWaitMs(LARGE)).toBe(DOCS_LANE_MAX_WAIT_MS);
    expect(laneWaitMs(ART)).toBe(DOCS_LANE_MAX_WAIT_MS);
  });
});
