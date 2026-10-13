// The parse worker's main-thread runner (native Docs reader, W4 Task 5; design 2026-10-01 section 4.10's "Worker and
// runner" and section 4.15's M4.P6, M4.P7, M4.P8 and M4.P11). jsdom has no `Worker`, so every case but the default
// one injects a fake `spawn` (each call a new FakeWorker that records its posts and lets the test emit `message`,
// `error` and `messageerror`) and a fake clock (`setTimer`/`clearTimer` that fire only when the test advances).
// M4.P6's "Format anyway posts a 30 000 job" is W5's half; here the runner honours a 30 000 budget (the W4 plan's
// refinement (a)). M4.P7's chat half (4 KiB in-thread, 5 KiB's note) is Task 6's.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MarkdownJob, ParseOutcome } from '../src/lib/markdownParse';
import {
  chatRunner, createMarkdownRunner, defaultSpawn, docsRunner, type MarkdownRunner, type WorkerLike,
} from '../src/lib/markdownRunner';
import { CHAT_PARSE_BUDGET_MS, DOCS_PARSE_BUDGET_LARGE_MS, DOCS_PARSE_BUDGET_MS } from '../src/lib/markdownLimits';

class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  readonly posts: MarkdownJob[] = [];
  terminated = 0;
  /** When set, `postMessage` throws it instead of recording the job. */
  throwOnPost: unknown = undefined;

  postMessage(job: MarkdownJob): void {
    if (this.throwOnPost !== undefined) throw this.throwOnPost;
    this.posts.push(job);
  }

  terminate(): void {
    this.terminated += 1;
  }

  /** The worker answers: whatever handler the runner left on this worker hears it. */
  send(data: unknown): void {
    this.onmessage?.({ data });
  }

  reply(id: number, outcome: ParseOutcome): void {
    this.send({ id, outcome });
  }

  fail(kind: 'error' | 'messageerror'): void {
    (kind === 'error' ? this.onerror : this.onmessageerror)?.({ type: kind });
  }
}

/** Timers that fire only when the test advances the clock, in due order. */
class FakeClock {
  now = 0;
  private nextHandle = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  readonly setTimer = (fn: () => void, ms: number): unknown => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { at: this.now + ms, fn });
    return handle;
  };

  readonly clearTimer = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= end && (due === undefined || entry[1].at < due[1].at)) due = entry;
      }
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = end;
  }
}

/** A promise's state, readable synchronously once `flush()` has run. */
interface Tracked {
  state: 'pending' | 'resolved' | 'rejected';
  value?: ParseOutcome;
  reason?: unknown;
}

function track(p: Promise<ParseOutcome>): Tracked {
  const t: Tracked = { state: 'pending' };
  p.then(
    (value) => { t.state = 'resolved'; t.value = value; },
    (reason: unknown) => { t.state = 'rejected'; t.reason = reason; },
  );
  return t;
}

/** Lets every settled promise's callbacks run. */
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

function harness(): { runner: MarkdownRunner; clock: FakeClock; workers: FakeWorker[]; spawn: () => WorkerLike } {
  const clock = new FakeClock();
  const workers: FakeWorker[] = [];
  const spawn = vi.fn((): WorkerLike => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  const runner = createMarkdownRunner({ spawn, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  return { runner, clock, workers, spawn };
}

const CHAT = { profile: 'chat', budgetMs: CHAT_PARSE_BUDGET_MS } as const;
/** An outcome tagged by `n`, so a test can tell which reply resolved a promise. */
const answer = (n: number): ParseOutcome => ({ kind: 'too-deep', depth: n });

describe('M4.P6: the budget, terminate and respawn', () => {
  it('a job that never answers is a timeout exactly at its budget, after one terminate', async () => {
    const { runner, clock, workers, spawn } = harness();
    const job = track(runner.parse('x', CHAT));
    clock.advance(CHAT_PARSE_BUDGET_MS - 1);
    await flush();
    expect(job.state).toBe('pending');
    expect(workers[0]?.terminated).toBe(0);
    clock.advance(1);
    await flush();
    expect(job).toEqual({ state: 'resolved', value: { kind: 'timeout', budgetMs: CHAT_PARSE_BUDGET_MS } });
    expect(workers[0]?.terminated).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('the next job after a timeout spawns a fresh worker and is answered by it', async () => {
    const { runner, clock, workers, spawn } = harness();
    void runner.parse('x', CHAT);
    clock.advance(CHAT_PARSE_BUDGET_MS);
    const next = track(runner.parse('y', CHAT));
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[0]?.posts.map((j) => j.src)).toEqual(['x']);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['y']);
    workers[1]?.reply(workers[1].posts[0]!.id, answer(1));
    await flush();
    expect(next).toEqual({ state: 'resolved', value: answer(1) });
  });

  it("honours each job's own budget: 30 000 ms (Format anyway's) times out at 30 000, not before", async () => {
    const { runner, clock } = harness();
    const job = track(runner.parse('x', { profile: 'docs', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS }));
    clock.advance(DOCS_PARSE_BUDGET_LARGE_MS - 1);
    await flush();
    expect(job.state).toBe('pending');
    clock.advance(1);
    await flush();
    expect(job.value).toEqual({ kind: 'timeout', budgetMs: 30000 });
  });

  it.each([
    [0, 2000],
    [1024, 2000],
    [65535, 2000],
    [65536, 3000],
    [131072, 4000],
    [1048576, 10000],
    [10485760, 10000],
  ])('DOCS_PARSE_BUDGET_MS(%i) is %i', (bytes, ms) => {
    expect(DOCS_PARSE_BUDGET_MS(bytes)).toBe(ms);
  });

  it('the timer starts when a job is posted, not when it is queued', async () => {
    const { runner, clock, workers } = harness();
    const first = track(runner.parse('a', CHAT));
    const second = track(runner.parse('b', CHAT));
    clock.advance(1500);
    workers[0]?.reply(workers[0].posts[0]!.id, answer(1));
    await flush();
    expect(first.value).toEqual(answer(1));
    expect(workers[0]?.posts.map((j) => j.src)).toEqual(['a', 'b']);
    clock.advance(CHAT_PARSE_BUDGET_MS - 1); // 3 499 ms after both were queued, 1 999 after 'b' was posted
    await flush();
    expect(second.state).toBe('pending');
    clock.advance(1);
    await flush();
    expect(second.value).toEqual({ kind: 'timeout', budgetMs: CHAT_PARSE_BUDGET_MS });
  });

  it('a reply, an error and an abort each cancel the job timer', async () => {
    const { runner, clock, workers } = harness();
    void runner.parse('a', CHAT);
    workers[0]?.reply(workers[0].posts[0]!.id, answer(1));
    expect(clock.pending).toBe(0);
    void runner.parse('b', CHAT);
    workers[0]?.fail('error');
    expect(clock.pending).toBe(0);
    const ac = new AbortController();
    runner.parse('c', { ...CHAT, signal: ac.signal }).catch(() => undefined);
    expect(clock.pending).toBe(1);
    ac.abort();
    expect(clock.pending).toBe(0);
    await flush();
  });
});

describe('M4.P7: worker-unavailable is its own outcome, and sticky', () => {
  it('a spawn that throws answers worker-unavailable at once, never a timeout, and is never retried', async () => {
    const clock = new FakeClock();
    const spawn = vi.fn((): WorkerLike => {
      throw new Error('no worker here');
    });
    const runner = createMarkdownRunner({ spawn, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const first = track(runner.parse('a', CHAT));
    const queued = track(runner.parse('b', CHAT));
    await flush();
    expect(first).toEqual({ state: 'resolved', value: { kind: 'worker-unavailable' } });
    expect(queued).toEqual({ state: 'resolved', value: { kind: 'worker-unavailable' } });
    expect(clock.pending).toBe(0);
    runner.prewarm();
    const later = track(runner.parse('c', { profile: 'docs', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS }));
    await flush();
    expect(later.value).toEqual({ kind: 'worker-unavailable' });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('with no Worker global, defaultSpawn throws and a runner with no deps answers worker-unavailable', async () => {
    expect(typeof globalThis.Worker).toBe('undefined');
    expect(() => defaultSpawn()).toThrow();
    await expect(createMarkdownRunner().parse('# hi', CHAT)).resolves.toEqual({ kind: 'worker-unavailable' });
  });
});

describe('M4.P8: a worker that fails', () => {
  it.each(['error', 'messageerror'] as const)(
    '%s: the event answers worker-failed with its name, terminates, and the next job respawns',
    async (kind) => {
      const { runner, workers, spawn } = harness();
      const job = track(runner.parse('a', CHAT));
      workers[0]?.fail(kind);
      await flush();
      expect(job).toEqual({ state: 'resolved', value: { kind: 'worker-failed', error: kind } });
      expect(workers[0]?.terminated).toBe(1);
      const next = track(runner.parse('b', CHAT));
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(workers[1]?.posts.map((j) => j.src)).toEqual(['b']);
      workers[1]?.reply(workers[1].posts[0]!.id, answer(2));
      await flush();
      expect(next.value).toEqual(answer(2));
    },
  );

  it('an error while no job runs drops the worker too; the next job respawns', () => {
    const { runner, workers, spawn } = harness();
    runner.prewarm();
    workers[0]?.fail('error');
    expect(workers[0]?.terminated).toBe(1);
    void runner.parse('a', CHAT);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[0]?.posts).toEqual([]);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['a']);
  });

  it('a postMessage that throws answers worker-failed with the thrown name, and the next job respawns', async () => {
    const { runner, workers, spawn, clock } = harness();
    runner.prewarm();
    workers[0]!.throwOnPost = new DOMException('could not be cloned', 'DataCloneError');
    const job = track(runner.parse('a', CHAT));
    await flush();
    expect(job.value).toEqual({ kind: 'worker-failed', error: 'DataCloneError' });
    expect(workers[0]?.terminated).toBe(1);
    expect(clock.pending).toBe(0);
    void runner.parse('b', CHAT);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['b']);
  });

  it('a dropped worker is no longer heard: its late reply and its error reach nobody', async () => {
    const { runner, clock, workers } = harness();
    void runner.parse('a', CHAT);
    clock.advance(CHAT_PARSE_BUDGET_MS);
    const next = track(runner.parse('b', CHAT));
    const id = workers[1]!.posts[0]!.id;
    workers[0]?.reply(id, answer(1));
    workers[0]?.fail('error');
    await flush();
    expect(next.state).toBe('pending');
    expect(workers[1]?.terminated).toBe(0);
    workers[1]?.reply(id, answer(2));
    await flush();
    expect(next.value).toEqual(answer(2));
  });
});

describe('M4.P11: stale results are ignored by id', () => {
  it("v1 answering after v2 was posted resolves only v2's promise, with v2's outcome", async () => {
    const { runner, workers } = harness();
    const ac = new AbortController();
    const v1 = track(runner.parse('v1', { ...CHAT, signal: ac.signal }));
    const v2 = track(runner.parse('v2', CHAT));
    const v1Id = workers[0]!.posts[0]!.id;
    ac.abort();
    const w = workers[1]!;
    expect(w.posts.map((j) => j.src)).toEqual(['v2']);
    w.reply(v1Id, answer(1));
    await flush();
    expect(v1.state).toBe('rejected');
    expect(v2.state).toBe('pending');
    w.reply(w.posts[0]!.id, answer(2));
    await flush();
    expect(v2.value).toEqual(answer(2));
  });

  it("a reply for an id never posted, or with no outcome, is ignored; the running job's own id answers", async () => {
    const { runner, workers } = harness();
    const job = track(runner.parse('a', CHAT));
    const w = workers[0]!;
    const id = w.posts[0]!.id;
    w.reply(id + 1000, answer(9));
    w.send({ id });
    w.send(null);
    w.send('a string');
    await flush();
    expect(job.state).toBe('pending');
    w.reply(id, answer(1));
    await flush();
    expect(job.value).toEqual(answer(1));
  });
});

describe('the queue: FIFO, abort, prewarm, dispose', () => {
  it('posts one job at a time, in order, each with its own id, src and profile', async () => {
    const { runner, workers } = harness();
    const a = track(runner.parse('a', CHAT));
    const b = track(runner.parse('b', { profile: 'docs', budgetMs: 4000 }));
    const c = track(runner.parse('c', CHAT));
    const w = workers[0]!;
    expect(w.posts).toEqual([{ id: expect.any(Number), src: 'a', profile: 'chat' }]);
    w.reply(w.posts[0]!.id, answer(1));
    expect(w.posts.map((j) => [j.src, j.profile])).toEqual([['a', 'chat'], ['b', 'docs']]);
    w.reply(w.posts[1]!.id, answer(2));
    w.reply(w.posts[2]!.id, answer(3));
    await flush();
    expect(new Set(w.posts.map((j) => j.id)).size).toBe(3);
    expect([a.value, b.value, c.value]).toEqual([answer(1), answer(2), answer(3)]);
  });

  it("an abort while queued removes the job: it is never posted, and rejects with the signal's reason", async () => {
    const { runner, workers } = harness();
    const ac = new AbortController();
    void runner.parse('a', CHAT);
    const b = track(runner.parse('b', { ...CHAT, signal: ac.signal }));
    void runner.parse('c', CHAT);
    const reason = new DOMException('superseded', 'AbortError');
    ac.abort(reason);
    await flush();
    expect(b).toEqual({ state: 'rejected', reason });
    const w = workers[0]!;
    w.reply(w.posts[0]!.id, answer(1));
    expect(w.posts.map((j) => j.src)).toEqual(['a', 'c']);
    expect(w.terminated).toBe(0);
  });

  it('an abort while running terminates the worker, rejects, and the next job respawns', async () => {
    const { runner, workers, spawn } = harness();
    const ac = new AbortController();
    const a = track(runner.parse('a', { ...CHAT, signal: ac.signal }));
    void runner.parse('b', CHAT);
    ac.abort();
    await flush();
    expect(a.state).toBe('rejected');
    expect((a.reason as DOMException).name).toBe('AbortError');
    expect(workers[0]?.terminated).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['b']);
  });

  it('an already-aborted signal rejects at once, spawning and posting nothing', async () => {
    const { runner, spawn, clock } = harness();
    const ac = new AbortController();
    ac.abort('gone');
    const a = track(runner.parse('a', { ...CHAT, signal: ac.signal }));
    await flush();
    expect(a).toEqual({ state: 'rejected', reason: 'gone' });
    expect(spawn).not.toHaveBeenCalled();
    expect(clock.pending).toBe(0);
  });

  it('prewarm spawns once and is idempotent; the next job uses that worker', () => {
    const { runner, workers, spawn } = harness();
    runner.prewarm();
    runner.prewarm();
    expect(spawn).toHaveBeenCalledTimes(1);
    void runner.parse('a', CHAT);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(workers[0]?.posts.map((j) => j.src)).toEqual(['a']);
  });

  it('dispose terminates, rejects every pending job with an AbortError, and a later job respawns', async () => {
    const { runner, workers, spawn, clock } = harness();
    const a = track(runner.parse('a', CHAT));
    const b = track(runner.parse('b', CHAT));
    runner.dispose();
    await flush();
    for (const t of [a, b]) {
      expect(t.state).toBe('rejected');
      expect((t.reason as DOMException).name).toBe('AbortError');
    }
    expect(workers[0]?.terminated).toBe(1);
    expect(clock.pending).toBe(0);
    void runner.parse('c', CHAT);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['c']);
  });
});

describe('two runners', () => {
  it('docsRunner and chatRunner are two runners, not one', () => {
    expect(chatRunner).not.toBe(docsRunner);
    expect(chatRunner.parse).not.toBe(docsRunner.parse);
  });

  it('a docs job blocked for 30 s does not delay a chat job', async () => {
    const docs = harness();
    const chat = harness();
    const slow = track(docs.runner.parse('a long doc', { profile: 'docs', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS }));
    const quick = track(chat.runner.parse('a message', CHAT));
    const w = chat.workers[0]!;
    expect(w.posts.map((j) => j.src)).toEqual(['a message']);
    w.reply(w.posts[0]!.id, answer(1));
    await flush();
    expect(quick.value).toEqual(answer(1));
    expect(slow.state).toBe('pending');
  });
});

// Source pins, on raw text. The worker URL must stay one literal expression, or Vite's static analysis cannot see
// the worker and emits no chunk; `vite.config.ts` bundles it as an ES module (without the key, Vite emits an IIFE,
// measured). Messages are received by assigning `onmessage` and sent with `postMessage(`, in the
// two worker files only (the W4 plan's refinement (w)); no `lib/markdown*` file adds a message listener or makes an
// object URL. The scans are NOT exhaustive: they read text, so a comment counts, and they miss a listener or an
// object URL reached through bracket access (`self['addEventListener']`, `URL['createObjectURL']`), through an alias
// (`const u = URL; u.createObjectURL(...)`), or through an event name held in a variable.
describe('source pins', () => {
  const LIB = path.join(import.meta.dirname, '..', 'src', 'lib');
  const read = (f: string): string => readFileSync(path.join(LIB, f), 'utf8');
  const MARKDOWN_FILES = readdirSync(LIB).filter((f) => /^markdown.*\.tsx?$/.test(f)).sort();
  const WORKER_FILES = ['markdownRunner.ts', 'markdownWorker.ts'];

  it('markdownRunner.ts spells the worker URL as one literal expression, once', () => {
    const literal = "new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' })";
    expect(read('markdownRunner.ts').split(literal)).toHaveLength(2);
  });

  it("vite.config.ts bundles the worker as an ES module: worker: { format: 'es' }", () => {
    const config = readFileSync(path.join(import.meta.dirname, '..', 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/^ {2}worker: \{ format: 'es' \},$/m);
  });

  it('the two worker files receive by assigning onmessage and send with postMessage(', () => {
    for (const f of WORKER_FILES) {
      expect(read(f), f).toMatch(/\.onmessage\s*=\s*\(/);
      expect(read(f), f).toContain('postMessage(');
    }
  });

  it('no other lib/markdown* file posts or receives messages', () => {
    expect(MARKDOWN_FILES).toEqual(expect.arrayContaining([...WORKER_FILES, 'markdownParse.ts', 'markdown.tsx']));
    for (const f of MARKDOWN_FILES.filter((m) => !WORKER_FILES.includes(m))) {
      expect(read(f), f).not.toMatch(/postMessage\s*\(|onmessage/);
    }
  });

  it('no lib/markdown* file adds a message listener or makes an object URL', () => {
    for (const f of MARKDOWN_FILES) {
      expect(read(f), f).not.toMatch(/addEventListener\s*\(\s*['"`]message/);
      expect(read(f), f).not.toMatch(/URL\s*\.\s*createObjectURL\s*\(/);
    }
  });
});

describe("T11 review 3-1: a dropped worker's messageerror is not heard", () => {
  it('a messageerror from a worker dropped by a timeout leaves the live worker and its job alone', async () => {
    const { runner, clock, workers } = harness();
    void runner.parse('a', CHAT).catch(() => undefined);
    clock.advance(CHAT_PARSE_BUDGET_MS);
    const next = track(runner.parse('b', CHAT));
    expect(workers).toHaveLength(2);
    workers[0]?.fail('messageerror');
    await flush();
    expect(next.state).toBe('pending');
    expect(workers[1]?.terminated).toBe(0);
  });
});

describe('T11 review 3-2: a spawn that fails mid-queue answers every queued job', () => {
  it('a respawn that throws answers worker-unavailable to each job queued behind the expired one', async () => {
    const clock = new FakeClock();
    let calls = 0;
    const spawn = vi.fn((): WorkerLike => {
      calls += 1;
      if (calls >= 2) throw new Error('no worker here');
      return new FakeWorker();
    });
    const runner = createMarkdownRunner({ spawn, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const a = track(runner.parse('a', CHAT));
    const b = track(runner.parse('b', CHAT));
    const c = track(runner.parse('c', CHAT));
    clock.advance(CHAT_PARSE_BUDGET_MS);
    await flush();
    expect(a.value).toEqual({ kind: 'timeout', budgetMs: CHAT_PARSE_BUDGET_MS });
    expect(b).toEqual({ state: 'resolved', value: { kind: 'worker-unavailable' } });
    expect(c).toEqual({ state: 'resolved', value: { kind: 'worker-unavailable' } });
  });
});
