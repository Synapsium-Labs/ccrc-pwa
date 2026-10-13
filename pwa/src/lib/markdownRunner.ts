// The main-thread side of the parse worker (native Docs reader, W4 Task 5; design 2026-10-01 section 4.10's "Worker
// and runner"). A runner owns at most one worker and posts it one job at a time; the others wait in a FIFO.
//   - The worker is spawned lazily, by the first job or by `prewarm()`. A spawn that throws SYNCHRONOUSLY (no
//     `Worker` global, a `SecurityError` from `new Worker`) makes the runner `worker-unavailable` for good: every
//     job, queued or later, answers that at once, and `spawn` is never called again. A worker script that fails to
//     LOAD is not that: `new Worker` returns and the failure arrives later as an async `error` event, so the job
//     answers `worker-failed`, the worker is dropped, and the next job spawns again (a respawn per job).
//   - A job's budget timer starts when the job is POSTED, never when it is queued, so no job pays for the one ahead
//     of it. When it fires: `terminate()`, the job answers `timeout`, and the next job spawns a fresh worker.
//   - An `error` or `messageerror` event answers the running job `worker-failed` with the event's name, and drops the
//     worker; the next job spawns a fresh one. A `postMessage` that throws does the same, with the thrown name.
//   - A reply whose `id` is not the running job's is ignored, and a dropped worker's handlers are cleared, so
//     nothing it sends afterwards is heard.
//   - An abort removes a queued job, or terminates the worker under a running one (the next job respawns); the
//     caller's promise rejects with the signal's reason, and an already-aborted signal rejects at once. `dispose()`
//     terminates the worker and rejects every pending job with an `AbortError`. So `ParseOutcome` keeps its eight
//     arms and none of them means "nobody is waiting" (the W4 plan's refinement (h)).
// Messages are received by ASSIGNING `onmessage`, never by adding a listener (refinement (w)).
//
// Two module singletons, `docsRunner` and `chatRunner`: a 30 s docs job never delays a chat message. Neither spawns
// anything until it is first used. The worker URL is one literal expression, so Vite's static analysis sees it and
// emits the worker as its own chunk (`markdown-runner.test.ts` pins the text).
import type { MarkdownJob, MarkdownProfile, ParseOutcome } from './markdownParse';

/** The type of `runner.parse`. Resolves with the job's outcome; rejects only on an abort or `dispose()`. */
export type MarkdownParser = (
  src: string,
  opts: { readonly profile: MarkdownProfile; readonly budgetMs: number; readonly signal?: AbortSignal },
) => Promise<ParseOutcome>;

/** The part of a `Worker` a runner uses; a test hands in a fake. */
export interface WorkerLike {
  postMessage(job: MarkdownJob): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

export interface MarkdownRunnerDeps {
  /** Starts a worker. A throw means no worker can be had here, for good. */
  spawn: () => WorkerLike;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface MarkdownRunner {
  readonly parse: MarkdownParser;
  /** Spawns the worker now, when there is none, so the first job does not wait for it to start. */
  prewarm(): void;
  /** Terminates the worker and rejects every pending job with an `AbortError`. A later job spawns again. */
  dispose(): void;
}

/** A module worker over `markdownWorker.ts`. Throws where there is no `Worker` (jsdom, an old browser). */
export function defaultSpawn(): WorkerLike {
  return new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

interface Job {
  readonly id: number;
  readonly src: string;
  readonly profile: MarkdownProfile;
  readonly budgetMs: number;
  /** The caller's signal; absent when the caller gave none. */
  readonly signal?: AbortSignal;
  readonly resolve: (outcome: ParseOutcome) => void;
  readonly reject: (reason: unknown) => void;
  readonly onAbort: () => void;
}

/** The name of whatever was thrown: `name` for an error (a `DOMException` included), else its `typeof`. */
function thrownName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return typeof e;
}

export function createMarkdownRunner(deps: Partial<MarkdownRunnerDeps> = {}): MarkdownRunner {
  const spawn = deps.spawn ?? defaultSpawn;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));

  /** The live worker; absent before the first spawn and after a drop. */
  let worker: WorkerLike | undefined;
  /** Set by a spawn that threw; never cleared. */
  let unavailable = false;
  let nextId = 1;
  const queue: Job[] = [];
  /** The posted job and its budget timer; absent while no job is posted. */
  let running: { readonly job: Job; readonly timer: unknown } | undefined;

  /** Forgets the live worker: its handlers are cleared, then it is terminated. */
  function drop(): void {
    const w = worker;
    worker = undefined;
    if (w === undefined) return;
    w.onmessage = null;
    w.onerror = null;
    w.onmessageerror = null;
    w.terminate();
  }

  /** The live worker, spawned when there is none; absent when no worker can be had. */
  function live(): WorkerLike | undefined {
    if (unavailable) return undefined;
    if (worker !== undefined) return worker;
    let w: WorkerLike;
    try {
      w = spawn();
    } catch {
      unavailable = true;
      return undefined;
    }
    w.onmessage = (e) => {
      const reply = e.data as { readonly id?: unknown; readonly outcome?: ParseOutcome } | null;
      if (typeof reply !== 'object' || reply === null || reply.outcome === undefined) return;
      if (running !== undefined && reply.id === running.job.id) finish(reply.outcome);
    };
    w.onerror = () => fail('error');
    w.onmessageerror = () => fail('messageerror');
    worker = w;
    return w;
  }

  /** The running job answers `outcome`; the next queued job is posted. */
  function finish(outcome: ParseOutcome): void {
    const r = running;
    if (r === undefined) return;
    running = undefined;
    clearTimer(r.timer);
    r.job.signal?.removeEventListener('abort', r.job.onAbort);
    r.job.resolve(outcome);
    pump();
  }

  /** The worker failed: it is dropped, and the running job, if any, answers `worker-failed`. */
  function fail(error: string): void {
    drop();
    finish({ kind: 'worker-failed', error });
  }

  /** The budget of `job` ran out. */
  function expire(job: Job): void {
    if (running?.job !== job) return;
    drop();
    finish({ kind: 'timeout', budgetMs: job.budgetMs });
  }

  /** Posts the next queued job when none is running; with no worker to be had, answers each queued job at once. A
   *  queued job whose signal is already aborted is skipped and rejects as an abort does, with no spawn and no post:
   *  one signal shared by the running job and a queued one aborts both, and the running job's abort pumps before the
   *  queued job's own listener runs (review 408, F7). */
  function pump(): void {
    while (running === undefined) {
      const job = queue.shift();
      if (job === undefined) return;
      if (job.signal?.aborted) {
        job.signal.removeEventListener('abort', job.onAbort);
        job.reject(job.signal.reason);
        continue;
      }
      const w = live();
      if (w === undefined) {
        job.signal?.removeEventListener('abort', job.onAbort);
        job.resolve({ kind: 'worker-unavailable' });
        continue;
      }
      running = { job, timer: setTimer(() => expire(job), job.budgetMs) };
      try {
        w.postMessage({ id: job.id, src: job.src, profile: job.profile });
      } catch (e) {
        fail(thrownName(e));
      }
    }
  }

  function abort(job: Job): void {
    const reason: unknown = job.signal?.reason;
    if (running?.job === job) {
      clearTimer(running.timer);
      running = undefined;
      drop();
      job.reject(reason);
      pump();
      return;
    }
    const at = queue.indexOf(job);
    if (at !== -1) {
      // Out of the queue now, not skipped by `pump` at its turn: its source is not held behind a running job.
      queue.splice(at, 1);
      job.reject(reason);
    }
  }

  const parse: MarkdownParser = (src, opts) =>
    new Promise<ParseOutcome>((resolve, reject) => {
      const signal = opts.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const id = nextId;
      nextId += 1;
      const job: Job = {
        id,
        src,
        profile: opts.profile,
        budgetMs: opts.budgetMs,
        signal,
        resolve,
        reject,
        onAbort: () => abort(job),
      };
      signal?.addEventListener('abort', job.onAbort, { once: true });
      queue.push(job);
      pump();
    });

  function prewarm(): void {
    live();
  }

  function dispose(): void {
    const reason = new DOMException('disposed', 'AbortError');
    const pending = queue.splice(0);
    const r = running;
    running = undefined;
    if (r !== undefined) {
      clearTimer(r.timer);
      pending.unshift(r.job);
    }
    drop();
    for (const job of pending) {
      job.signal?.removeEventListener('abort', job.onAbort);
      job.reject(reason);
    }
  }

  return { parse, prewarm, dispose };
}

/** The Docs screen's runner (W5 passes `docsRunner.parse` as its default parser). */
export const docsRunner: MarkdownRunner = createMarkdownRunner();
/** Chat's runner, for messages over `CHAT_SYNC_MAX_BYTES` (Task 6). */
export const chatRunner: MarkdownRunner = createMarkdownRunner();
