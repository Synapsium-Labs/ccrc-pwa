// The Docs screen's per-screen fetch queue (spec 2026-10-01 4.11 "Loading"; W5 part 1 Task 7). Every image a page
// loads, and from W6 every mockup asset, runs through one queue a `DocsScreen` owns, at most
// `DOCS_PWA_FETCH_CONCURRENCY` at a time, first come first served. The real bound is the server's (spec 6); this one
// keeps one page from opening thirty requests at once. No module state: each screen makes its own.

/** Requests one Docs screen runs at once (spec 4.11: "concurrency 2"). */
export const DOCS_PWA_FETCH_CONCURRENCY = 2;

/** One screen's queue.
 *  - `run(job, signal)`: `job` starts when a slot is free and receives a signal of its own, which aborts when the
 *    caller's `signal` aborts or the queue is disposed; the promise follows the job. A job whose caller aborts while
 *    it is still waiting never starts, and the promise rejects with the signal's reason. `signal` absent means the
 *    caller never aborts it (dispose still can).
 *  - `dispose()`: aborts every running job's signal, rejects every waiting job with an `AbortError`, and makes every
 *    later `run` reject with one. A slot frees only when its job settles, so a job that ignores its signal keeps its
 *    slot until it does. */
export interface FetchQueue {
  run<T>(job: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
  dispose(): void;
}

const disposedError = (): DOMException => new DOMException('The Docs fetch queue was disposed.', 'AbortError');

/** A queue running at most `concurrency` jobs at once (a positive integer; anything else throws a RangeError). */
export function createFetchQueue(concurrency: number = DOCS_PWA_FETCH_CONCURRENCY): FetchQueue {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`createFetchQueue: concurrency must be a positive integer, not ${String(concurrency)}`);
  }
  let running = 0;
  let disposed = false;
  const waiting: { start: () => void; drop: (reason: unknown) => void }[] = [];
  const live = new Set<AbortController>();

  const pump = (): void => {
    while (running < concurrency && waiting.length > 0) waiting.shift()!.start();
  };

  return {
    run<T>(job: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (disposed) {
          reject(disposedError());
          return;
        }
        if (signal?.aborted === true) {
          reject(signal.reason);
          return;
        }
        const ctl = new AbortController();
        const onAbort = (): void => {
          const at = waiting.indexOf(entry);
          if (at >= 0) {
            waiting.splice(at, 1);
            reject(signal!.reason);
          } else {
            ctl.abort(signal!.reason);
          }
        };
        const entry = {
          start: (): void => {
            running += 1;
            live.add(ctl);
            let p: Promise<T>;
            try {
              p = job(ctl.signal);
            } catch (err) {
              p = Promise.reject(err);
            }
            void p.then(resolve, reject).finally(() => {
              running -= 1;
              live.delete(ctl);
              signal?.removeEventListener('abort', onAbort);
              pump();
            });
          },
          drop: (reason: unknown): void => {
            signal?.removeEventListener('abort', onAbort);
            reject(reason);
          },
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        waiting.push(entry);
        pump();
      });
    },
    dispose(): void {
      disposed = true;
      for (const w of waiting.splice(0)) w.drop(disposedError());
      for (const ctl of live) ctl.abort(disposedError());
    },
  };
}
