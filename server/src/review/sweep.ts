import { REVIEW_PENDING_RETRY_MS, REVIEW_SWEEP_MS } from '../../../shared/docsReview.js';
import { commitVerdict, expiryOf, type ReviewEntry } from './policy.js';
import type { ReviewTreeReader } from './ports.js';
import type { ReviewStore } from './store.js';

/** Full passes serialize their tree reads; the store's writer serializes disk retries and removals. */
export function startReviewSweep(store: ReviewStore, reader: ReviewTreeReader, now: () => number): {
  started: Promise<void>; stop(): Promise<void>; runOnce(): Promise<void>;
} {
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();
  let fullPasses = 0;
  let pendingRetry: Promise<void> | undefined;
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    const next = queue.then(work);
    queue = next.catch(() => { console.warn('ccrc-server: review sweep failed'); });
    return next;
  };
  const pass = async (): Promise<void> => {
    if (stopped) return;
    const groups = new Map<string, ReviewEntry[]>();
    for (const entry of store.all()) {
      if (entry.revoking) continue;
      const expiry = expiryOf(entry, now());
      if (!expiry.live) {
        await store.remove(entry.tokenHash, entry.rev, expiry.why, now());
      } else {
        const key = JSON.stringify([entry.source.project, entry.source.servedRef]);
        const group = groups.get(key) ?? [];
        group.push(entry);
        groups.set(key, group);
      }
    }
    for (const entries of groups.values()) {
      if (stopped) return;
      const first = entries[0]!;
      const result = await reader.tree(first.source.project, first.source.servedRef);
      for (const entry of entries) {
        if (commitVerdict(entry, result.ok ? result.tree : null) === 'committed') {
          await store.remove(entry.tokenHash, entry.rev, 'committed', now());
        }
      }
    }
    if (stopped) return;
    await store.retryPending(now());
    await store.purgeTombstones(now());
  };
  const runOnce = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    fullPasses++;
    return enqueue(async () => { try { await pass(); } finally { fullPasses--; } });
  };
  const started = runOnce();
  const fullTimer = setInterval(() => {
    if (!stopped && fullPasses === 0) void runOnce().catch(() => {});
  }, REVIEW_SWEEP_MS);
  fullTimer.unref();
  // A write can leave pending work between full passes or while a tree read waits. The tick
  // checks only in-memory state when idle and doesn't queue behind the sweep's tree reads.
  const pendingTimer = setInterval(() => {
    if (stopped || pendingRetry !== undefined || !store.hasPending()) return;
    pendingRetry = store.retryPending(now())
      .then(() => {}, () => { console.warn('ccrc-server: review removal retry failed'); })
      .finally(() => { pendingRetry = undefined; });
  }, REVIEW_PENDING_RETRY_MS);
  pendingTimer.unref();
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopping !== undefined) return stopping;
    stopped = true;
    stopping = enqueue(async () => {
      try {
        await pendingRetry;
        await store.retryPending(now());
      } finally {
        clearInterval(fullTimer);
        clearInterval(pendingTimer);
      }
    });
    return stopping;
  };
  return { started, stop, runOnce };
}
