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
import type { ReaderRenderJob, ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import type { HighlightJob, HighlightOutcome, HighlightRequest, HighlightResult } from '../src/lib/highlightProtocol';
import {
  chatHighlighter, chatRunner, createHighlighter, createMarkdownRunner, defaultSpawn, docsHighlighter, docsRunner,
  type MarkdownRunner, type WorkerLike,
} from '../src/lib/markdownRunner';
import {
  CHAT_PARSE_BUDGET_MS, DOCS_PARSE_BUDGET_LARGE_MS, DOCS_PARSE_BUDGET_MS, HIGHLIGHT_BLOCK_DEADLINE_MS,
  HIGHLIGHT_BOOT_BUDGET_MS,
} from '../src/lib/markdownLimits';

/** What a fake worker records of a job: a parse job's three fields, or a render job's `kind`. */
type Posted = Partial<Pick<MarkdownJob, 'profile'>> & Pick<MarkdownJob, 'id' | 'src'> & { readonly kind?: 'render' };

class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  readonly posts: Posted[] = [];
  terminated = 0;
  /** When set, `postMessage` throws it instead of recording the job. */
  throwOnPost: unknown = undefined;

  postMessage(job: MarkdownJob | ReaderRenderJob): void {
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
  value?: ParseOutcome | ReaderRenderOutcome;
  reason?: unknown;
}

function track(p: Promise<ParseOutcome | ReaderRenderOutcome>): Tracked {
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

  it('one signal shared by a running job and a queued one rejects both, with no respawn and no post', async () => {
    const { runner, workers, spawn, clock } = harness();
    const ac = new AbortController();
    const a = track(runner.parse('a', { ...CHAT, signal: ac.signal }));
    const b = track(runner.parse('b', { ...CHAT, signal: ac.signal }));
    expect(spawn).toHaveBeenCalledTimes(1);
    const reason = new DOMException('superseded', 'AbortError');
    ac.abort(reason);
    await flush();
    expect(a).toEqual({ state: 'rejected', reason });
    expect(b).toEqual({ state: 'rejected', reason });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(workers[0]!.posts.map((j) => j.src)).toEqual(['a']);
    expect(workers[0]!.terminated).toBe(1);
    expect(clock.pending).toBe(0);
    void runner.parse('c', CHAT);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[1]!.posts.map((j) => j.src)).toEqual(['c']);
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

  it('an already-aborted signal rejects at once while another job runs, and that job is never posted', async () => {
    const { runner, workers } = harness();
    void runner.parse('a', CHAT);
    const ac = new AbortController();
    ac.abort('gone');
    const b = track(runner.parse('b', { ...CHAT, signal: ac.signal }));
    await flush();
    expect(b).toEqual({ state: 'rejected', reason: 'gone' });
    const w = workers[0]!;
    w.reply(w.posts[0]!.id, answer(1));
    await flush();
    expect(w.posts.map((j) => j.src)).toEqual(['a']);
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

// Docs W5h-a Task 4, refinement (m): two behaviours of the parse runner no case above pinned, measured green on the
// BASE runner before it becomes one instance of the generic `createWorkerRunner`.
describe('W5h-a Task 4: the parse runner, pinned before the generic runner', () => {
  it('a parse runner ignores {ready: true} and a reply with no outcome; the running job answers only its own reply', async () => {
    const { runner, workers } = harness();
    const p = track(runner.parse('a', CHAT));
    workers[0]!.send({ ready: true });
    workers[0]!.send({ id: 1 });
    await flush();
    expect(p.state).toBe('pending');
    expect(workers[0]!.posts).toHaveLength(1);
    workers[0]!.reply(1, answer(1));
    await flush();
    expect(p).toMatchObject({ state: 'resolved', value: answer(1) });
  });

  it('a parse runner posts its first job in the same call that spawns, with no handshake', () => {
    const { runner, workers, spawn } = harness();
    void runner.parse('a', CHAT);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(workers[0]!.posts).toEqual([{ id: 1, src: 'a', profile: 'chat' }]);
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
  const MARKDOWN_FILES = readdirSync(LIB).filter((f) => /^(?:markdown|highlight).*\.tsx?$/.test(f)).sort();
  const WORKER_FILES = ['markdownHighlightWorker.ts', 'markdownRunner.ts', 'markdownWorker.ts'];
  /** Whether a source posts or receives messages; whether it adds a message listener. One predicate each, read by the real cases and by their planted controls. */
  const postsOrReceives = (s: string): boolean => /postMessage\s*\(|onmessage/.test(s);
  const addsMessageListener = (s: string): boolean => /addEventListener\s*\(\s*['"`]message/.test(s);

  it('markdownRunner.ts spells the worker URL as one literal expression, once', () => {
    const literal = "new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' })";
    expect(read('markdownRunner.ts').split(literal)).toHaveLength(2);
  });

  it("vite.config.ts bundles the worker as an ES module: worker: { format: 'es', plugins: ... }", () => {
    const config = readFileSync(path.join(import.meta.dirname, '..', 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/^ {2}worker: \{ format: 'es', plugins: \(\) => \[workerSafeEntries\(\)\] \},$/m);
  });

  it('the three worker files receive by assigning onmessage and send with postMessage( (M4.H3)', () => {
    for (const f of WORKER_FILES) {
      expect(read(f), f).toMatch(/\.onmessage\s*=\s*\(/);
      expect(read(f), f).toContain('postMessage(');
    }
  });

  it('no other lib/markdown* or lib/highlight* file posts or receives messages (M4.H3)', () => {
    expect(MARKDOWN_FILES).toEqual(expect.arrayContaining([...WORKER_FILES, 'markdownParse.ts', 'markdown.tsx', 'highlightJob.ts', 'highlightGrammars.ts']));
    for (const f of MARKDOWN_FILES.filter((m) => !WORKER_FILES.includes(m))) {
      expect(postsOrReceives(read(f)), f).toBe(false);
    }
  });

  it('no lib/markdown* or lib/highlight* file adds a message listener or makes an object URL (M4.H3)', () => {
    for (const f of MARKDOWN_FILES) {
      expect(addsMessageListener(read(f)), f).toBe(false);
      expect(read(f), f).not.toMatch(/URL\s*\.\s*createObjectURL\s*\(/);
    }
  });

  it('planted (M4.H3): a postMessage( or an onmessage assignment in the store is red', () => {
    expect(postsOrReceives('export const plant = (w: Worker) => w.postMessage(1);')).toBe(true);
    expect(postsOrReceives('export const plant = (w: { onmessage: unknown }) => { w.onmessage = null; };')).toBe(true);
    expect(MARKDOWN_FILES.filter((f) => !WORKER_FILES.includes(f)).every((f) => !postsOrReceives(read(f)))).toBe(true);
  });

  it('planted (M4.H3): a message listener in the store is red', () => {
    expect(addsMessageListener("self.addEventListener('message', () => undefined);")).toBe(true);
    expect(MARKDOWN_FILES.every((f) => !addsMessageListener(read(f)))).toBe(true);
  });

  it('M4.H3: the scan reads the store and the context, and a postMessage or a message listener planted in the store is red', () => {
    expect(MARKDOWN_FILES).toEqual(expect.arrayContaining(['highlightStore.ts', 'highlighterContext.ts']));
    expect(postsOrReceives(read('highlightStore.ts'))).toBe(false);
    const planted = `${read('highlightStore.ts')}\nself.postMessage(1);\nself.addEventListener('message', () => undefined);\n`;
    expect(postsOrReceives(planted)).toBe(true);
    expect(addsMessageListener(planted)).toBe(true);
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

// Docs W8a Task 4 (A6, M8.21): the reader's render job rides the same runner. It shares the FIFO, the budget timer,
// terminate-and-respawn, abort and dispose with a parse job, and posts its own shape; a parse job's shape and
// `ParseOutcome` are unchanged.
const DOCS = { profile: 'docs', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS } as const;
const RENDER = { budgetMs: 5000 } as const;
const NOT_RENDERED: ReaderRenderOutcome = { kind: 'not-rendered', why: 'over-limit' };

describe('W8a Task 4: a render job on the same runner', () => {
  it('a render job posts exactly {id, kind: render, src}', () => {
    const { runner, workers } = harness();
    void runner.render('# T', RENDER);
    expect(workers[0]!.posts).toEqual([{ id: expect.any(Number), kind: 'render', src: '# T' }]);
    expect(Object.keys(workers[0]!.posts[0]!).sort()).toEqual(['id', 'kind', 'src']);
  });

  it('a parse job still posts exactly {id, src, profile}', () => {
    const { runner, workers } = harness();
    void runner.parse('x', DOCS);
    expect(workers[0]!.posts).toEqual([{ id: expect.any(Number), src: 'x', profile: 'docs' }]);
    expect(Object.keys(workers[0]!.posts[0]!).sort()).toEqual(['id', 'profile', 'src']);
  });

  it('a render job answers with the worker\'s outcome for its id', async () => {
    const { runner, workers } = harness();
    const job = track(runner.render('x', RENDER));
    workers[0]!.send({ id: workers[0]!.posts[0]!.id, outcome: NOT_RENDERED });
    await flush();
    expect(job).toEqual({ state: 'resolved', value: NOT_RENDERED });
  });

  it('a render job answers timeout at budgetMs and the worker is terminated', async () => {
    const { runner, clock, workers, spawn } = harness();
    const job = track(runner.render('x', RENDER));
    clock.advance(RENDER.budgetMs - 1);
    await flush();
    expect(job.state).toBe('pending');
    expect(workers[0]?.terminated).toBe(0);
    clock.advance(1);
    await flush();
    expect(job).toEqual({ state: 'resolved', value: { kind: 'timeout', budgetMs: RENDER.budgetMs } });
    expect(workers[0]?.terminated).toBe(1);
    void runner.render('y', RENDER);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['y']);
  });

  it('render and parse share one FIFO: a render then a parse are posted in order, one at a time', async () => {
    const { runner, workers } = harness();
    const r = track(runner.render('r', RENDER));
    const p = track(runner.parse('p', DOCS));
    const w = workers[0]!;
    expect(w.posts.map((j) => j.src)).toEqual(['r']);
    w.send({ id: w.posts[0]!.id, outcome: NOT_RENDERED });
    await flush();
    expect(r.value).toEqual(NOT_RENDERED);
    expect(p.state).toBe('pending');
    expect(w.posts.map((j) => j.src)).toEqual(['r', 'p']);
    w.reply(w.posts[1]!.id, answer(1));
    await flush();
    expect(p.value).toEqual(answer(1));
  });

  it('an aborted render job rejects with AbortError and dispose rejects pending renders', async () => {
    const { runner, workers } = harness();
    const ac = new AbortController();
    const aborted = track(runner.render('a', { ...RENDER, signal: ac.signal }));
    ac.abort(new DOMException('gone', 'AbortError'));
    await flush();
    expect(aborted.state).toBe('rejected');
    expect((aborted.reason as DOMException).name).toBe('AbortError');
    expect(workers[0]?.terminated).toBe(1);

    const running = track(runner.render('b', RENDER));
    const queued = track(runner.render('c', RENDER));
    runner.dispose();
    await flush();
    expect(running.state).toBe('rejected');
    expect(queued.state).toBe('rejected');
    expect((running.reason as DOMException).name).toBe('AbortError');
    expect((queued.reason as DOMException).name).toBe('AbortError');
  });

  it('ParseOutcome keeps its eight arms', () => {
    const arms: Record<ParseOutcome['kind'], true> = {
      tree: true, refused: true, 'too-deep': true, 'too-wide': true, threw: true, timeout: true,
      'worker-unavailable': true, 'worker-failed': true,
    };
    expect(Object.keys(arms)).toHaveLength(8);
  });
});

// Docs W5h-a Task 4 (base spec 2026-10-01 section 4.10's "The highlight runner"; M4.H7, M4.H8, M4.H9, M4.H10): the
// highlighter is `createWorkerRunner` with the ready handshake and the detach abort. Fake spawn, fake clock. The parse
// runner's cases above pass unchanged beside it.
class FakeHlWorker implements WorkerLike<HighlightJob> {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  readonly posts: HighlightJob[] = [];
  terminated = 0;
  postMessage(job: HighlightJob): void { this.posts.push(job); }
  terminate(): void { this.terminated += 1; }
  ready(): void { this.onmessage?.({ data: { ready: true } }); }
  answer(id: number, result: HighlightResult): void { this.onmessage?.({ data: { id, result } }); }
  fail(): void { this.onerror?.({ type: 'error' }); }
}

function hlHarness(throwOnSpawn = false) {
  const clock = new FakeClock();
  const workers: FakeHlWorker[] = [];
  const spawn = vi.fn((): WorkerLike<HighlightJob> => {
    if (throwOnSpawn) throw new ReferenceError('Worker is not defined');
    const w = new FakeHlWorker();
    workers.push(w);
    return w;
  });
  const hl = createHighlighter({ spawn, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  return { hl, clock, workers, spawn };
}

const HTML = (s: string): HighlightResult => ({ kind: 'html', html: s, mode: 'block' });
function trackHl(p: Promise<HighlightOutcome>): { state: string; value?: HighlightOutcome; reason?: unknown } {
  const t: { state: string; value?: HighlightOutcome; reason?: unknown } = { state: 'pending' };
  p.then((v) => { t.state = 'resolved'; t.value = v; }, (r: unknown) => { t.state = 'rejected'; t.reason = r; });
  return t;
}
const req = (code: string): HighlightRequest => ({ lang: 'ts', code });

describe('W5h-a: the highlighter (createWorkerRunner with a ready handshake and detach)', () => {
  it('M4.H8: no job is posted before {ready}; then exactly {id, lang, code}, and a retry adds mode line', async () => {
    const { hl, workers } = hlHarness();
    void hl.highlight(req('a'), {});
    void hl.highlight({ lang: 'ts', code: 'b', mode: 'line' }, {});
    expect(workers[0]!.posts).toEqual([]);
    workers[0]!.ready();
    expect(workers[0]!.posts).toEqual([{ id: 1, lang: 'ts', code: 'a' }]);
    workers[0]!.answer(1, HTML('a'));
    await flush();
    expect(workers[0]!.posts[1]).toEqual({ id: 2, lang: 'ts', code: 'b', mode: 'line' });
  });

  it('M4.H8: the block deadline starts at post, not at request: a 1 999 ms boot then 749 ms of work is no timeout', async () => {
    const { hl, clock, workers } = hlHarness();
    const p = trackHl(hl.highlight(req('a'), {}));
    clock.advance(HIGHLIGHT_BOOT_BUDGET_MS - 1);
    workers[0]!.ready();
    clock.advance(HIGHLIGHT_BLOCK_DEADLINE_MS - 1);
    await flush();
    expect(p.state).toBe('pending');
    clock.advance(1);
    await flush();
    expect(p.value).toEqual({ kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS });
  });

  it('M4.H8: a worker that never says ready answers every waiting job worker-failed at the boot budget, terminated', async () => {
    const { hl, clock, workers } = hlHarness();
    const a = trackHl(hl.highlight(req('a'), {}));
    const b = trackHl(hl.highlight(req('b'), {}));
    clock.advance(HIGHLIGHT_BOOT_BUDGET_MS);
    await flush();
    expect([a.value, b.value]).toEqual([
      { kind: 'worker-failed', error: 'boot-timeout' }, { kind: 'worker-failed', error: 'boot-timeout' },
    ]);
    expect(workers[0]!.terminated).toBe(1);
    expect(workers[0]!.posts).toEqual([]);
  });

  it('M4.H8: the next job respawns once; a second boot failure in a row is sticky, with no further spawn', async () => {
    const { hl, clock, spawn } = hlHarness();
    void hl.highlight(req('a'), {});
    clock.advance(HIGHLIGHT_BOOT_BUDGET_MS);
    const b = trackHl(hl.highlight(req('b'), {}));
    expect(spawn).toHaveBeenCalledTimes(2);
    clock.advance(HIGHLIGHT_BOOT_BUDGET_MS);
    await flush();
    expect(b.value).toEqual({ kind: 'worker-failed', error: 'boot-timeout' });
    const c = trackHl(hl.highlight(req('c'), {}));
    await flush();
    expect(c.value).toEqual({ kind: 'worker-failed', error: 'boot' });
    expect(hl.status()).toBe('worker-failed');
    hl.prewarm();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('M4.H8: a boot that succeeds resets the count: fail, ready, then one more failure is not sticky', async () => {
    const { hl, clock, workers, spawn } = hlHarness();
    void hl.highlight(req('a'), {});
    clock.advance(HIGHLIGHT_BOOT_BUDGET_MS);
    const b = trackHl(hl.highlight(req('b'), {}));
    workers[1]!.ready();
    clock.advance(HIGHLIGHT_BLOCK_DEADLINE_MS);
    await flush();
    expect(b.value).toEqual({ kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS });
    void hl.highlight(req('c'), {});
    clock.advance(HIGHLIGHT_BOOT_BUDGET_MS);
    expect(hl.status()).toBe('live');
    expect(spawn).toHaveBeenCalledTimes(4);
  });

  it('M4.H8: an error event while booting is a boot failure for the waiting jobs', async () => {
    const { hl, workers } = hlHarness();
    const a = trackHl(hl.highlight(req('a'), {}));
    workers[0]!.fail();
    await flush();
    expect(a.value).toEqual({ kind: 'worker-failed', error: 'error' });
  });

  it('L2-1: a ready worker is not failed by its own boot budget (ready() clears the boot timer)', async () => {
    const { hl, clock, workers, spawn } = hlHarness();
    void hl.status();
    workers[0]!.ready();
    clock.advance(HIGHLIGHT_BOOT_BUDGET_MS - 100);
    const a = trackHl(hl.highlight(req('a'), {}));
    expect(workers[0]!.posts).toHaveLength(1);
    clock.advance(200);
    workers[0]!.answer(1, HTML('A'));
    await flush();
    expect(a.value).toEqual({ kind: 'html', html: 'A', mode: 'block' });
    expect(workers[0]!.terminated).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("L2-1: a boot failure's timer dies with its worker (drop() clears the boot timer)", async () => {
    const { hl, clock, workers } = hlHarness();
    const a = trackHl(hl.highlight(req('a'), {}));
    clock.advance(100);
    workers[0]!.fail();
    await flush();
    expect(a.value).toEqual({ kind: 'worker-failed', error: 'error' });
    clock.advance(100);
    void hl.highlight(req('b'), {});
    expect(workers).toHaveLength(2);
    clock.advance(HIGHLIGHT_BOOT_BUDGET_MS + 50 - 200);
    await flush();
    expect(workers[1]!.terminated).toBe(0);
    expect(hl.status()).toBe('live');
  });

  it('M4.H7: after {ready}, a job that never answers times out at the deadline, terminate once, the next job respawns', async () => {
    const { hl, clock, workers, spawn } = hlHarness();
    const a = trackHl(hl.highlight(req('a'), {}));
    workers[0]!.ready();
    clock.advance(HIGHLIGHT_BLOCK_DEADLINE_MS);
    await flush();
    expect(a.value).toEqual({ kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS });
    expect(workers[0]!.terminated).toBe(1);
    void hl.highlight(req('b'), {});
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('M4.H7: only the overrun block is lost: of a, b, c, b never answers and a and c are answered', async () => {
    const { hl, clock, workers } = hlHarness();
    const [a, b, c] = ['a', 'b', 'c'].map((s) => trackHl(hl.highlight(req(s), {})));
    workers[0]!.ready();
    workers[0]!.answer(1, HTML('A'));
    await flush();
    clock.advance(HIGHLIGHT_BLOCK_DEADLINE_MS);
    await flush();
    workers[1]!.ready();
    workers[1]!.answer(3, HTML('C'));
    await flush();
    expect([a!.value, b!.value, c!.value]).toEqual([HTML('A'), { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }, HTML('C')]);
  });

  it('M4.H9: aborting a running highlight job rejects it, never terminates, and the same worker serves the next job', async () => {
    const { hl, workers, spawn } = hlHarness();
    const ctl = new AbortController();
    const a = trackHl(hl.highlight(req('a'), { signal: ctl.signal }));
    const b = trackHl(hl.highlight(req('b'), {}));
    workers[0]!.ready();
    ctl.abort();
    await flush();
    expect(a.state).toBe('rejected');
    expect(workers[0]!.terminated).toBe(0);
    expect(workers[0]!.posts).toHaveLength(1);
    workers[0]!.answer(1, HTML('A'));
    await flush();
    expect(workers[0]!.posts[1]).toEqual({ id: 2, lang: 'ts', code: 'b' });
    workers[0]!.answer(2, HTML('B'));
    await flush();
    expect(b.value).toEqual(HTML('B'));
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('M4.H9: a detached job\'s deadline still runs: its timeout terminates and reaches nobody', async () => {
    const { hl, clock, workers } = hlHarness();
    const ctl = new AbortController();
    const a = trackHl(hl.highlight(req('a'), { signal: ctl.signal }));
    workers[0]!.ready();
    ctl.abort();
    clock.advance(HIGHLIGHT_BLOCK_DEADLINE_MS);
    await flush();
    expect(a.state).toBe('rejected');
    expect(workers[0]!.terminated).toBe(1);
  });

  it('M4.H9: aborting a running parse job still terminates', async () => {
    const { runner, workers } = harness();
    const ctl = new AbortController();
    const p = track(runner.parse('a', { ...CHAT, signal: ctl.signal }));
    ctl.abort();
    await flush();
    expect(p.state).toBe('rejected');
    expect(workers[0]!.terminated).toBe(1);
  });

  it('M4.H10: a spawn that throws is a sticky worker-unavailable: status says so, every job answers it, no further spawn', async () => {
    const { hl, spawn } = hlHarness(true);
    expect(hl.status()).toBe('worker-unavailable');
    const a = trackHl(hl.highlight(req('a'), {}));
    await flush();
    expect(a.value).toEqual({ kind: 'worker-unavailable' });
    hl.prewarm();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('M4.H10: HighlightOutcome is its own union of eight arms, and ParseOutcome keeps its eight', () => {
    const arms: Record<HighlightOutcome['kind'], true> = {
      html: true, unregistered: true, 'too-large': true, 'line-too-long': true, threw: true, timeout: true,
      'worker-unavailable': true, 'worker-failed': true,
    };
    expect(Object.keys(arms)).toHaveLength(8);
    // ParseOutcome keeps its eight arms: an exhaustive literal is a type error under the pwa typecheck when an arm is
    // added or removed (W8a's 'ParseOutcome keeps its eight arms' case pins the same, in this file).
    const parseArms: Record<ParseOutcome['kind'], true> = {
      tree: true, refused: true, 'too-deep': true, 'too-wide': true, threw: true, timeout: true,
      'worker-unavailable': true, 'worker-failed': true,
    };
    expect(Object.keys(parseArms)).toHaveLength(8);
    // @ts-expect-error a highlight answer is not a parse outcome
    const notParse: ParseOutcome = { kind: 'html', html: '', mode: 'block' };
    expect(notParse.kind).toBe('html');
  });

  it('onPosted runs when the job is posted: after ready, after the job ahead of it, never for an unposted job', async () => {
    const { hl, workers } = hlHarness();
    const seen: string[] = [];
    void hl.highlight(req('a'), { onPosted: () => seen.push('a') });
    void hl.highlight(req('b'), { onPosted: () => seen.push('b') });
    expect(seen).toEqual([]);
    workers[0]!.ready();
    expect(seen).toEqual(['a']);
    workers[0]!.answer(1, HTML('A'));
    await flush();
    expect(seen).toEqual(['a', 'b']);
  });

  it('a reply for another id, or with no result object, is ignored', async () => {
    const { hl, workers } = hlHarness();
    const a = trackHl(hl.highlight(req('a'), {}));
    workers[0]!.ready();
    workers[0]!.answer(9, HTML('X'));
    workers[0]!.onmessage?.({ data: { id: 1, result: null } });
    await flush();
    expect(a.state).toBe('pending');
  });

  it('A4: a reply whose result is not an outcome this build knows answers worker-failed / malformed-reply, and the next job still runs', async () => {
    const shapes: unknown[] = [
      { kind: 'bogus' }, { kind: 'html', mode: 'block' }, { kind: 'html', html: 'x', mode: 'span' }, { kind: 'timeout' }, {},
    ];
    for (const result of shapes) {
      const { hl, workers } = hlHarness();
      const a = trackHl(hl.highlight(req('a'), {}));
      const b = trackHl(hl.highlight(req('b'), {}));
      workers[0]!.ready();
      workers[0]!.onmessage?.({ data: { id: 1, result } });
      await flush();
      expect(a.value).toEqual({ kind: 'worker-failed', error: 'malformed-reply' });
      // The job left the queue like any answered one: the next is posted, on the same worker.
      expect(workers[0]!.posts[1]).toEqual({ id: 2, lang: 'ts', code: 'b' });
      workers[0]!.answer(2, HTML('B'));
      await flush();
      expect(b.value).toEqual({ kind: 'html', html: 'B', mode: 'block' });
      expect(workers).toHaveLength(1);
    }
  });

  it('docsHighlighter and chatHighlighter are two highlighters', () => {
    expect(docsHighlighter).not.toBe(chatHighlighter);
    expect(typeof docsHighlighter.highlight).toBe('function');
  });

  it('markdownRunner.ts spells the highlight worker URL as one literal expression, once, in spawnHighlightWorker', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'markdownRunner.ts'), 'utf8');
    const literal = "new Worker(new URL('./markdownHighlightWorker.ts', import.meta.url), { type: 'module' })";
    expect(src.split(literal)).toHaveLength(2);
    expect(src).toMatch(/export function spawnHighlightWorker\(\): WorkerLike<HighlightJob> \{\n\s+return new Worker\(new URL\('\.\/markdownHighlightWorker\.ts'/);
  });
});
