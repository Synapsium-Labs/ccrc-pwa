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
//   - The reader's render job (W8a Task 4) is a second kind of job on the SAME runner: `render()` queues behind and
//     ahead of parse jobs in the one FIFO, with the same budget timer, terminate-and-respawn, abort and dispose. A
//     parse job posts exactly `{id, src, profile}`, a render job exactly `{id, kind: 'render', src}`, and
//     `ParseOutcome` keeps its eight arms: a render job's own outcome type is `ReaderRenderOutcome`.
// Messages are received by ASSIGNING `onmessage`, never by adding a listener (refinement (w)).
//
// Two module singletons, `docsRunner` and `chatRunner`: a 30 s docs job never delays a chat message. Neither spawns
// anything until it is first used. The worker URL is one literal expression, so Vite's static analysis sees it and
// emits the worker as its own chunk (`markdown-runner.test.ts` pins the text).
//
// W5h-a Task 4 (base spec 2026-10-01 section 4.10's "The highlighter" and "The highlight runner"): everything above
// is `createWorkerRunner<M, O>`, generic over the message a job posts and the outcome it resolves with. The parse
// runner (`createMarkdownRunner`, both of its job kinds) is one instance and behaves exactly as described above,
// which `markdown-runner.test.ts` pins case by case. It uses neither of the two options:
//   - `bootBudgetMs`, the ready handshake: a spawned worker takes no job until it posts `{ready: true}`. The boot timer
//     starts at spawn; past it, or on an error before ready, the worker is dropped and every job waiting for it
//     answers `onFailed`. The next job, `prewarm` or `status` respawns once; a second boot failure in a row is sticky,
//     and every later job answers `onFailed('boot')` at once, with no spawn, until the app reloads. A job's own timer
//     starts at post, after ready, so a boot never counts against a block.
//   - `abortRunning: 'detach'`: an aborted running job rejects at once, but the worker is kept and the job's timer still
//     runs; its answer, or its timeout, reaches nobody, and the FIFO waits for it at most one deadline.
// The highlighter (`createHighlighter`) is the other instance: a deadline of HIGHLIGHT_BLOCK_DEADLINE_MS from post, a
// boot budget of HIGHLIGHT_BOOT_BUDGET_MS, detach. Its worker is spawned through ONE literal, in `spawnHighlightWorker()`,
// which both singletons and R19's measurement page use, so Vite emits a second worker chunk (M7.11). Two singletons,
// `docsHighlighter` and `chatHighlighter`: a Docs page's queue never delays chat, and no highlight job ever shares a
// queue or a terminate with a parse or a render job (the rich-docs spec's A6).
import type { MarkdownJob, MarkdownProfile, ParseOutcome } from './markdownParse';
import type { ReaderRenderJob, ReaderRenderOutcome } from './readerRenderJob';
import type {
  Highlighter, HighlighterStatus, HighlightJob, HighlightOutcome, HighlightRequest,
} from './highlightProtocol';
import { HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_BOOT_BUDGET_MS } from './markdownLimits';

/** The type of `runner.parse`. Resolves with the job's outcome; rejects only on an abort or `dispose()`. */
export type MarkdownParser = (
  src: string,
  opts: { readonly profile: MarkdownProfile; readonly budgetMs: number; readonly signal?: AbortSignal },
) => Promise<ParseOutcome>;

/** The part of a `Worker` a runner uses; a test hands in a fake. `M` is the message a job posts. */
export interface WorkerLike<M = MarkdownJob | ReaderRenderJob> {
  postMessage(message: M): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

export interface MarkdownRunnerDeps<M = MarkdownJob | ReaderRenderJob> {
  /** Starts a worker. A throw means no worker can be had here, for good. */
  spawn: () => WorkerLike<M>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface MarkdownRunner {
  readonly parse: MarkdownParser;
  /** The reader's render job, on the same queue and budget as `parse`. Resolves with the job's outcome; rejects only
   *  on an abort or `dispose()`. */
  readonly render: (src: string, o: { budgetMs: number; signal?: AbortSignal }) => Promise<ReaderRenderOutcome>;
  /** Spawns the worker now, when there is none, so the first job does not wait for it to start. */
  prewarm(): void;
  /** Terminates the worker and rejects every pending job with an `AbortError`. A later job spawns again. */
  dispose(): void;
}

/** A module worker over `markdownWorker.ts`. Throws where there is no `Worker` (jsdom, an old browser). */
export function defaultSpawn(): WorkerLike {
  return new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

/** What a runner reads from one worker message: a reply for the job `id`, the ready handshake, or neither. */
export type WorkerMessage<O> =
  | { readonly kind: 'reply'; readonly id: unknown; readonly outcome: O }
  | { readonly kind: 'ready' }
  | { readonly kind: 'other' };

const OTHER = { kind: 'other' } as const;

export interface WorkerRunnerOptions<M, O> extends MarkdownRunnerDeps<M> {
  /** Reads one message from the worker. */
  readonly read: (data: unknown) => WorkerMessage<O>;
  /** The outcomes the runner makes itself. */
  readonly onTimeout: (budgetMs: number) => O;
  readonly onFailed: (error: string) => O;
  readonly onUnavailable: () => O;
  /** What an abort does to the running job: terminate the worker, or drop the job's answer and keep the worker. */
  readonly abortRunning: 'terminate' | 'detach';
  /** The ready handshake's budget, from spawn; absent, a spawned worker takes jobs at once. */
  readonly bootBudgetMs?: number;
}

export interface WorkerRunner<M, O> {
  /** Queues one job; `message(id)` is what it posts. Resolves with its outcome; rejects only on an abort or
   *  `dispose()`. `onPosted` runs right after the job is posted. */
  run(
    message: (id: number) => M, budgetMs: number,
    opts?: { readonly signal?: AbortSignal; readonly onPosted?: () => void },
  ): Promise<O>;
  /** Spawns when no worker is live, then answers whether a job can be taken. */
  status(): 'live' | 'unavailable' | 'failed';
  prewarm(): void;
  dispose(): void;
}

/** The error a job answers once two boots have failed in a row. */
const BOOT_FAILED = 'boot';

interface Job<M, O> {
  readonly id: number;
  readonly message: (id: number) => M;
  readonly budgetMs: number;
  /** The caller's signal; absent when the caller gave none. */
  readonly signal?: AbortSignal;
  readonly onPosted?: () => void;
  readonly resolve: (outcome: O) => void;
  readonly reject: (reason: unknown) => void;
  readonly onAbort: () => void;
}

/** The name of whatever was thrown: `name` for an error (a `DOMException` included), else its `typeof`. */
function thrownName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return typeof e;
}

export function createWorkerRunner<M, O>(o: WorkerRunnerOptions<M, O>): WorkerRunner<M, O> {
  const { spawn, setTimer, clearTimer, read, onTimeout, onFailed, onUnavailable, abortRunning, bootBudgetMs } = o;
  /** The live worker; absent before the first spawn and after a drop. */
  let worker: WorkerLike<M> | undefined;
  /** Set by a spawn that threw; never cleared. */
  let unavailable = false;
  /** Boots that failed in a row; two make the runner sticky. Only a runner with a handshake ever counts one. */
  let bootFailures = 0;
  /** Whether the live worker may take a job: from spawn without a handshake, from `{ready}` with one. */
  let booted = false;
  /** The live worker's boot timer, while it boots. */
  let bootTimer: unknown;
  let nextId = 1;
  const queue: Job<M, O>[] = [];
  /** The posted job, its timer, and whether it was detached; absent while no job is posted. */
  let running: { readonly job: Job<M, O>; readonly timer: unknown; detached: boolean } | undefined;

  const sticky = (): boolean => bootFailures >= 2;

  /** Forgets the live worker: its boot timer is cleared, its handlers are cleared, then it is terminated. */
  function drop(): void {
    const w = worker;
    worker = undefined;
    if (bootTimer !== undefined) {
      clearTimer(bootTimer);
      bootTimer = undefined;
    }
    if (w === undefined) return;
    w.onmessage = null;
    w.onerror = null;
    w.onmessageerror = null;
    w.terminate();
  }

  /** The live worker, spawned when there is none; absent when no worker can be had (unavailable, or sticky). */
  function live(): WorkerLike<M> | undefined {
    if (unavailable || sticky()) return undefined;
    if (worker !== undefined) return worker;
    let w: WorkerLike<M>;
    try {
      w = spawn();
    } catch {
      unavailable = true;
      return undefined;
    }
    w.onmessage = (e) => {
      const m = read(e.data);
      if (m.kind === 'ready') {
        if (!booted) ready();
        return;
      }
      if (m.kind === 'reply' && running !== undefined && m.id === running.job.id) finish(m.outcome);
    };
    w.onerror = () => fail('error');
    w.onmessageerror = () => fail('messageerror');
    worker = w;
    booted = bootBudgetMs === undefined;
    if (bootBudgetMs !== undefined) bootTimer = setTimer(() => bootFail('boot-timeout'), bootBudgetMs);
    return w;
  }

  /** The live worker said ready: its boot timer stops, the failure count resets, and the queue moves. */
  function ready(): void {
    booted = true;
    bootFailures = 0;
    if (bootTimer !== undefined) {
      clearTimer(bootTimer);
      bootTimer = undefined;
    }
    pump();
  }

  /** The live worker never said ready: it is dropped, one failure is counted, and every waiting job answers. */
  function bootFail(error: string): void {
    drop();
    bootFailures += 1;
    for (const job of queue.splice(0)) {
      job.signal?.removeEventListener('abort', job.onAbort);
      job.resolve(onFailed(error));
    }
  }

  /** The running job answers `outcome` (nobody hears it when it was detached); the next queued job is posted. */
  function finish(outcome: O): void {
    const r = running;
    if (r === undefined) return;
    running = undefined;
    clearTimer(r.timer);
    r.job.signal?.removeEventListener('abort', r.job.onAbort);
    if (!r.detached) r.job.resolve(outcome);
    pump();
  }

  /** The worker failed: before ready, a boot failure; after, it is dropped and the running job answers `onFailed`. */
  function fail(error: string): void {
    if (!booted) {
      bootFail(error);
      return;
    }
    drop();
    finish(onFailed(error));
  }

  /** The budget of `job` ran out. */
  function expire(job: Job<M, O>): void {
    if (running?.job !== job) return;
    drop();
    finish(onTimeout(job.budgetMs));
  }

  /** Posts the next queued job when none is running and the worker is ready; with no worker to be had, answers each
   *  queued job at once. A queued job whose signal is already aborted is skipped and rejects as an abort does, with
   *  no spawn and no post (review 408, F7). */
  function pump(): void {
    while (running === undefined) {
      const job = queue[0];
      if (job === undefined) return;
      if (job.signal?.aborted) {
        queue.shift();
        job.signal.removeEventListener('abort', job.onAbort);
        job.reject(job.signal.reason);
        continue;
      }
      const w = live();
      if (w === undefined) {
        queue.shift();
        job.signal?.removeEventListener('abort', job.onAbort);
        job.resolve(unavailable ? onUnavailable() : onFailed(BOOT_FAILED));
        continue;
      }
      if (!booted) return;
      queue.shift();
      running = { job, timer: setTimer(() => expire(job), job.budgetMs), detached: false };
      try {
        w.postMessage(job.message(job.id));
      } catch (e) {
        fail(thrownName(e));
        continue;
      }
      job.onPosted?.();
    }
  }

  function abort(job: Job<M, O>): void {
    const reason: unknown = job.signal?.reason;
    if (running?.job === job) {
      if (abortRunning === 'detach') {
        running.detached = true;
        job.reject(reason);
        return;
      }
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

  function run(
    message: (id: number) => M, budgetMs: number,
    opts: { readonly signal?: AbortSignal; readonly onPosted?: () => void } = {},
  ): Promise<O> {
    return new Promise<O>((resolve, reject) => {
      const signal = opts.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const id = nextId;
      nextId += 1;
      const job: Job<M, O> = {
        id, message, budgetMs, signal, onPosted: opts.onPosted, resolve, reject, onAbort: () => abort(job),
      };
      signal?.addEventListener('abort', job.onAbort, { once: true });
      queue.push(job);
      pump();
    });
  }

  function status(): 'live' | 'unavailable' | 'failed' {
    live();
    return unavailable ? 'unavailable' : sticky() ? 'failed' : 'live';
  }

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
      if (!r.detached) pending.unshift(r.job);
    }
    drop();
    for (const job of pending) {
      job.signal?.removeEventListener('abort', job.onAbort);
      job.reject(reason);
    }
  }

  return { run, status, prewarm, dispose };
}

const realSetTimer = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);
const realClearTimer = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>);

/** The parse worker's reply: `{id, outcome}`; anything else (a `{ready: true}` included) is not one. */
function readParseReply(data: unknown): WorkerMessage<ParseOutcome | ReaderRenderOutcome> {
  const reply = data as { readonly id?: unknown; readonly outcome?: ParseOutcome | ReaderRenderOutcome } | null;
  if (typeof reply !== 'object' || reply === null || reply.outcome === undefined) return OTHER;
  return { kind: 'reply', id: reply.id, outcome: reply.outcome };
}

export function createMarkdownRunner(deps: Partial<MarkdownRunnerDeps> = {}): MarkdownRunner {
  const core = createWorkerRunner<MarkdownJob | ReaderRenderJob, ParseOutcome | ReaderRenderOutcome>({
    spawn: deps.spawn ?? defaultSpawn,
    setTimer: deps.setTimer ?? realSetTimer,
    clearTimer: deps.clearTimer ?? realClearTimer,
    read: readParseReply,
    onTimeout: (budgetMs) => ({ kind: 'timeout', budgetMs }),
    onFailed: (error) => ({ kind: 'worker-failed', error }),
    onUnavailable: () => ({ kind: 'worker-unavailable' }),
    abortRunning: 'terminate',
  });
  // The worker answers each kind with that kind's own outcome type, and the runner's three arms belong to both.
  const parse: MarkdownParser = (src, opts) =>
    core.run((id) => ({ id, src, profile: opts.profile }), opts.budgetMs, { signal: opts.signal }) as Promise<ParseOutcome>;
  const render: MarkdownRunner['render'] = (src, opts) =>
    core.run((id) => ({ id, kind: 'render', src }), opts.budgetMs, { signal: opts.signal }) as Promise<ReaderRenderOutcome>;
  return { parse, render, prewarm: () => core.prewarm(), dispose: () => core.dispose() };
}

/** The Docs screen's runner (W5 passes `docsRunner.parse` as its default parser). */
export const docsRunner: MarkdownRunner = createMarkdownRunner();
/** Chat's runner, for messages over `CHAT_SYNC_MAX_BYTES` (Task 6). */
export const chatRunner: MarkdownRunner = createMarkdownRunner();

/** The highlight worker's message: `{ready: true}`, or `{id, result}` with a result object. */
function readHighlightReply(data: unknown): WorkerMessage<HighlightOutcome> {
  if (typeof data !== 'object' || data === null) return OTHER;
  const d = data as { readonly ready?: unknown; readonly id?: unknown; readonly result?: unknown };
  if (d.ready === true) return { kind: 'ready' };
  if (typeof d.result !== 'object' || d.result === null) return OTHER;
  return { kind: 'reply', id: d.id, outcome: d.result as HighlightOutcome };
}

/** A module worker over `markdownHighlightWorker.ts`: the ONE literal that spawns it (M7.11). Throws where there is no
 *  `Worker`. */
export function spawnHighlightWorker(): WorkerLike<HighlightJob> {
  return new Worker(new URL('./markdownHighlightWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike<HighlightJob>;
}

export interface HighlighterDeps extends MarkdownRunnerDeps<HighlightJob> {
  /** A job's deadline from post: HIGHLIGHT_BLOCK_DEADLINE_MS unless R19's page measures past it. */
  readonly deadlineMs: number;
  /** From spawn to `{ready}`: HIGHLIGHT_BOOT_BUDGET_MS. */
  readonly bootBudgetMs: number;
}

const HIGHLIGHTER_STATUS: Readonly<Record<'live' | 'unavailable' | 'failed', HighlighterStatus>> = {
  live: 'live', unavailable: 'worker-unavailable', failed: 'worker-failed',
};

/** A highlighter: `createWorkerRunner` over the highlight worker, with the ready handshake and the detach abort. */
export function createHighlighter(deps: Partial<HighlighterDeps> = {}): Highlighter {
  const deadlineMs = deps.deadlineMs ?? HIGHLIGHT_BLOCK_DEADLINE_MS;
  const core = createWorkerRunner<HighlightJob, HighlightOutcome>({
    spawn: deps.spawn ?? spawnHighlightWorker,
    setTimer: deps.setTimer ?? realSetTimer,
    clearTimer: deps.clearTimer ?? realClearTimer,
    read: readHighlightReply,
    onTimeout: (budgetMs) => ({ kind: 'timeout', budgetMs }),
    onFailed: (error) => ({ kind: 'worker-failed', error }),
    onUnavailable: () => ({ kind: 'worker-unavailable' }),
    abortRunning: 'detach',
    bootBudgetMs: deps.bootBudgetMs ?? HIGHLIGHT_BOOT_BUDGET_MS,
  });
  const message = (r: HighlightRequest) => (id: number): HighlightJob =>
    r.mode === 'line' ? { id, lang: r.lang, code: r.code, mode: 'line' } : { id, lang: r.lang, code: r.code };
  return {
    highlight: (request, opts) => core.run(message(request), deadlineMs, opts),
    status: () => HIGHLIGHTER_STATUS[core.status()],
    prewarm: () => core.prewarm(),
  };
}

/** The Docs screen's highlighter: a Docs page's, a text leaf's (and from W6 a mockup Source's) blocks. */
export const docsHighlighter: Highlighter = createHighlighter();
/** Chat's highlighter: every message's blocks and every tool well's. */
export const chatHighlighter: Highlighter = createHighlighter();
