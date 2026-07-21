/**
 * Per-key FIFO async queue: fns submitted under the same key run one at a
 * time in submission order; different keys are fully independent. A rejected
 * fn rejects its own caller but never blocks the fns queued behind it.
 */
export class KeyedQueue {
  private tails = new Map<string, Promise<void>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}
