// The native Docs reader's link protection (design 2026-10-01, section 6.3, section 6.4; W3 refinements (j), (n)
// and (p)): L4. One read lane per node (index, tree and show; cache hits never reach it), one fetch lane per node,
// single-flight with abandonment, and the per-(node, project) generation counter. The routes (Tasks 6 and 7) build
// one of each per node in `composeDocs`, never at module scope, and join a flight BEFORE a lane (refinement (k)).
//
// Ring (M7.10; the ring guard in `single-definition.test.ts`): this file owns timers and DECIDES NOTHING. Whether
// the head job is admitted is L1's `laneAdmit`; every bound, wait and busy body is an L1 constant or `docsBusyBody`.
// What stays here is bookkeeping: the counters `laneAdmit` reads, the FIFO, the timers, the listeners. A running
// exec is never cancelled (the agent has no cancel op, section 6.3): abandonment only ever removes a job that has
// not started.
import type { DocsFailureBody } from '../../../shared/docs.js';
import {
  DOCS_FETCH_GLOBAL, DOCS_FETCH_MAX_WAIT_MS, DOCS_FETCH_QUEUE, DOCS_LANE_LARGE_RAW, DOCS_LANE_MAX_WAIT_MS,
  DOCS_LANE_QUEUE, docsBusyBody, laneAdmit, type DocsJob, type DocsLaneName, type LaneLoad,
} from './policy.js';

/**
 * What a lane answers for one job. `ran`: the exec ran and fulfilled with `value` (a rejected exec rejects the
 * caller instead). `busy`: the lane refused it (its queue was full, its wait expired, or the lane is closed); the
 * exec never ran. `abandoned`: every requester left before the job started; the exec never ran.
 */
export type DocsLaneRun<T> = { kind: 'ran'; value: T } | { kind: 'busy'; body: DocsFailureBody } | { kind: 'abandoned' };

/** One node's read lane (section 6.3). `load()` is a fresh snapshot: the three counters `laneAdmit` reads, plus
 *  how many jobs wait in the FIFO. `close()` answers every queued job `busy` and every later `run` too. */
export interface DocsReadLane {
  run<T>(job: DocsJob, signal: AbortSignal, exec: () => Promise<T>): Promise<DocsLaneRun<T>>;
  load(): Readonly<LaneLoad & { queued: number }>;
  close(): void;
}

/** One node's fetch lane (section 6.4). `key` is the (node, project) key (`docsProjectKey`): jobs under one key
 *  run one at a time, in order. `queued` counts every accepted job that has not started (refinement (n)). */
export interface DocsFetchLane {
  run<T>(key: string, signal: AbortSignal, exec: () => Promise<T>): Promise<DocsLaneRun<T>>;
  load(): Readonly<{ running: number; queued: number }>;
  close(): void;
}

/** Single-flight (section 6.4). `join` answers the promise of the live flight under `key`, or starts one with
 *  `start(flight)`, where `flight` aborts only when every joiner's `signal` has aborted (refinement (j)). */
export interface DocsFlights {
  join<T>(key: string, signal: AbortSignal, start: (flight: AbortSignal) => Promise<T>): Promise<T>;
  size(): number;
}

/** The per-(node, project) generation counter (section 6.4): 0 until the first bump. */
export interface DocsGenerations {
  current(key: string): number;
  bump(key: string): number;
}

const ABANDONED: DocsLaneRun<never> = Object.freeze({ kind: 'abandoned' });

/** A `busy` run carrying a FRESH body from L1 (callers may hand the body on to a reply). */
function busy(lane: DocsLaneName): DocsLaneRun<never> {
  return { kind: 'busy', body: docsBusyBody(lane) };
}

/** A queued read job: its estimate, its signal, and the three ways it leaves the FIFO. */
interface ReadWaiter {
  job: DocsJob;
  signal: AbortSignal;
  timer: ReturnType<typeof setTimeout> | undefined;
  onAbort: () => void;
  begin: () => void;
  refuse: (run: DocsLaneRun<never>) => void;
}

/**
 * A read lane (section 6.3). A job starts at once only when the FIFO is empty and `laneAdmit` admits it; else it
 * queues (or is `busy` when `DOCS_LANE_QUEUE` jobs already wait). Only the HEAD is ever considered, so a large job
 * cannot starve. Every settle of a running exec releases its share exactly once (in `finally`) and pumps; so does a
 * queued job leaving, since the job behind it may now admit.
 */
export function docsReadLane(): DocsReadLane {
  const load: LaneLoad = { execs: 0, bytes: 0, large: 0 };
  const queue: ReadWaiter[] = [];
  let closed = false;

  const isLarge = (job: DocsJob): boolean => job.raw > DOCS_LANE_LARGE_RAW;

  /** Detach a waiter from its timer and its signal (on admission, expiry, abandonment or close). */
  const detach = (w: ReadWaiter): void => {
    clearTimeout(w.timer);
    w.signal.removeEventListener('abort', w.onAbort);
  };

  const pump = (): void => {
    while (queue.length > 0 && laneAdmit(load, queue[0].job)) {
      const head = queue.shift() as ReadWaiter;
      detach(head);
      head.begin();
    }
  };

  /** Take a queued job out of the FIFO and answer it `run`; the job behind it may now admit. */
  const leave = (w: ReadWaiter, run: DocsLaneRun<never>): void => {
    const i = queue.indexOf(w);
    if (i < 0) return;
    queue.splice(i, 1);
    detach(w);
    w.refuse(run);
    pump();
  };

  /** Give a running job's share back and pump: called once per started job, from `running`'s `finally`. */
  const release = (job: DocsJob): void => {
    load.execs -= 1;
    load.bytes -= job.wire;
    if (isLarge(job)) load.large -= 1;
    pump();
  };

  async function running<T>(job: DocsJob, exec: () => Promise<T>): Promise<DocsLaneRun<T>> {
    load.execs += 1;
    load.bytes += job.wire;
    if (isLarge(job)) load.large += 1;
    try {
      return { kind: 'ran', value: await exec() };
    } finally {
      release(job);
    }
  }

  return {
    run<T>(job: DocsJob, signal: AbortSignal, exec: () => Promise<T>): Promise<DocsLaneRun<T>> {
      if (signal.aborted) return Promise.resolve(ABANDONED);
      if (closed) return Promise.resolve(busy('read'));
      if (queue.length === 0 && laneAdmit(load, job)) return running(job, exec);
      if (queue.length >= DOCS_LANE_QUEUE) return Promise.resolve(busy('read'));
      return new Promise<DocsLaneRun<T>>((resolve) => {
        const w: ReadWaiter = {
          job, signal, timer: undefined,
          onAbort: () => leave(w, ABANDONED),
          begin: () => resolve(running(job, exec)),
          refuse: resolve,
        };
        w.timer = setTimeout(() => leave(w, busy('read')), DOCS_LANE_MAX_WAIT_MS);
        w.timer.unref();
        signal.addEventListener('abort', w.onAbort, { once: true });
        queue.push(w);
      });
    },
    load: () => ({ ...load, queued: queue.length }),
    close: () => {
      closed = true;
      for (const w of queue.splice(0)) {
        detach(w);
        w.refuse(busy('read'));
      }
    },
  };
}

/** An accepted fetch job, queued until it starts. */
interface FetchWaiter {
  key: string;
  signal: AbortSignal;
  timer: ReturnType<typeof setTimeout> | undefined;
  onAbort: () => void;
  begin: () => void;
  refuse: (run: DocsLaneRun<never>) => void;
}

/**
 * A fetch lane (section 6.4; refinement (n)). Jobs under one key run one at a time, in acceptance order; at most
 * `DOCS_FETCH_GLOBAL` run across keys. One FIFO holds every accepted job that has not started, behind its key or
 * the global bound, and each job's `DOCS_FETCH_MAX_WAIT_MS` runs from acceptance. A new job is queued and pumped
 * FIRST: one the pump starts at once never counts against the queue bound, and one left waiting as the
 * (`DOCS_FETCH_QUEUE` + 1)th job that has not started leaves at once as `busy`, having started nothing (refinement
 * (n): a pre-check on the queue's length would refuse a job on an idle key while a global slot is free).
 * A pump starts, in FIFO order, every job whose key has nothing running while a global slot is free;
 * a job whose key is busy is passed over, never reordered within its key. The per-key serialisation is this FIFO,
 * not a `KeyedQueue`: `single-definition.test.ts` ("one KeyedQueue for the process") holds the constructor to the
 * composition root, and the process's queue serialises session operations.
 */
export function docsFetchLane(): DocsFetchLane {
  const queue: FetchWaiter[] = [];
  const runningKeys = new Set<string>();
  let running = 0;
  let closed = false;

  const detach = (w: FetchWaiter): void => {
    clearTimeout(w.timer);
    w.signal.removeEventListener('abort', w.onAbort);
  };

  const pump = (): void => {
    for (let i = 0; i < queue.length && running < DOCS_FETCH_GLOBAL;) {
      if (runningKeys.has(queue[i].key)) {
        i += 1;
        continue;
      }
      const next = queue.splice(i, 1)[0];
      detach(next);
      next.begin();
    }
  };

  /** Take a queued job out of the FIFO and answer it `run`; it frees no slot, so nothing else can start. */
  const leave = (w: FetchWaiter, run: DocsLaneRun<never>): void => {
    const i = queue.indexOf(w);
    if (i < 0) return;
    queue.splice(i, 1);
    detach(w);
    w.refuse(run);
  };

  /** Free a running job's key and global slot and pump: called once per started job, from `fetching`'s
   *  `finally`. */
  const release = (key: string): void => {
    running -= 1;
    runningKeys.delete(key);
    pump();
  };

  async function fetching<T>(key: string, exec: () => Promise<T>): Promise<DocsLaneRun<T>> {
    running += 1;
    runningKeys.add(key);
    try {
      return { kind: 'ran', value: await exec() };
    } finally {
      release(key);
    }
  }

  return {
    run<T>(key: string, signal: AbortSignal, exec: () => Promise<T>): Promise<DocsLaneRun<T>> {
      if (signal.aborted) return Promise.resolve(ABANDONED);
      if (closed) return Promise.resolve(busy('fetch'));
      return new Promise<DocsLaneRun<T>>((resolve) => {
        const w: FetchWaiter = {
          key, signal, timer: undefined,
          onAbort: () => leave(w, ABANDONED),
          begin: () => resolve(fetching(key, exec)),
          refuse: resolve,
        };
        w.timer = setTimeout(() => leave(w, busy('fetch')), DOCS_FETCH_MAX_WAIT_MS);
        w.timer.unref();
        signal.addEventListener('abort', w.onAbort, { once: true });
        queue.push(w);
        pump();
        if (queue.length > DOCS_FETCH_QUEUE) leave(w, busy('fetch'));
      });
    },
    load: () => ({ running, queued: queue.length }),
    close: () => {
      closed = true;
      for (const w of queue.splice(0)) {
        detach(w);
        w.refuse(busy('fetch'));
      }
    },
  };
}

/** One flight: the promise every joiner receives, the signal handed to `start`, and its live joiners. */
interface Flight {
  promise: Promise<unknown>;
  controller: AbortController;
  live: number;
  /** Removes each joiner's abort listener once the flight settles. */
  detach: (() => void)[];
}

/**
 * Single-flight (section 6.4; refinement (j)). A join on a key whose flight is live joins it; a join on a new key,
 * or on a key whose flight every joiner has left (its signal aborted), starts a NEW flight under that key, so a
 * live request never receives an abandoned answer; the old flight settles alone. A flight's signal aborts only
 * when EVERY joiner's signal has aborted, so one tab closing never cancels another's answer. A settled flight
 * frees its key, fulfilled or rejected.
 */
export function docsFlights(): DocsFlights {
  const flights = new Map<string, Flight>();

  /** Count `signal` as one joiner of `f`. An already-aborted signal is a joiner that has already gone. */
  const attach = (f: Flight, signal: AbortSignal): void => {
    if (signal.aborted) {
      if (f.live === 0) f.controller.abort();
      return;
    }
    f.live += 1;
    const onAbort = (): void => {
      f.live -= 1;
      if (f.live === 0) f.controller.abort();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    f.detach.push(() => signal.removeEventListener('abort', onAbort));
  };

  return {
    join<T>(key: string, signal: AbortSignal, start: (flight: AbortSignal) => Promise<T>): Promise<T> {
      const found = flights.get(key);
      if (found !== undefined && !found.controller.signal.aborted) {
        attach(found, signal);
        return found.promise as Promise<T>;
      }
      const f: Flight = { promise: Promise.resolve(), controller: new AbortController(), live: 0, detach: [] };
      attach(f, signal);
      let p: Promise<T>;
      try {
        p = start(f.controller.signal);
      } catch (e) {
        p = Promise.reject(e);
      }
      f.promise = p;
      flights.set(key, f);
      const done = (): void => {
        for (const d of f.detach.splice(0)) d();
        if (flights.get(key) === f) flights.delete(key);
      };
      p.then(done, done);
      return p;
    },
    size: () => flights.size,
  };
}

/** The generation counter (section 6.4): per key, 0 until bumped; `bump` answers the new value. */
export function docsGenerations(): DocsGenerations {
  const gens = new Map<string, number>();
  return {
    current: (key) => gens.get(key) ?? 0,
    bump: (key) => {
      const next = (gens.get(key) ?? 0) + 1;
      gens.set(key, next);
      return next;
    },
  };
}
