import type { KeyedQueue } from './inject/queue.js';
import type { reclaimChild } from './coord/childReclaim.js';
import type { expireArchived } from './coord/expireArchived.js';
import type { collectTempRoot } from './coord/collectTempRoot.js';
import type { childReclaimUnlessDisabled } from './coord/childReclaimDisabled.js';

/**
 * THE ONE QUEUE OWNER OF A RETIRE (D-7171; ARCH-44, consolidation spec K1 "Consumers move", §2.2): L4, it owns the
 * `KeyedQueue` call that runs a retire executor's entry on the session's own queue, the queue `POST /workspace/reap`
 * and the naming sweep join, so a retire never races either on one workspace. It decides nothing and composes nothing:
 * each caller hands it the job, and the job builds its deps literal INSIDE the callback, so the members are `deps`'s
 * answer when the job runs, never a snapshot taken when it was queued.
 *
 * Its callers keep whether they await (the watcher's child reclaim and archive expiry do; the collector's act and the
 * close route's reclaim do not), and each keeps its own `.catch` sentence. The entries are named as TYPES only
 * (D-7228), so no file that defines one imports this one (D-7198).
 */

/** What a retire entry answers: one of the three executors' entries, or the close route's `childReclaimUnlessDisabled`
 *  wrap of `reclaimChild` (D-7228). */
type RetireEntryAnswer = Awaited<ReturnType<typeof reclaimChild>> | Awaited<ReturnType<typeof expireArchived>>
  | Awaited<ReturnType<typeof collectTempRoot>> | Awaited<ReturnType<typeof childReclaimUnlessDisabled>>;

/** The job a caller queues: it answers one retire entry's answer. */
type RetireEntryRun<T extends RetireEntryAnswer> = () => Promise<T>;

/** Run `run` on `id`'s own queue, and answer what it answers. */
export function retireExecutor<T extends RetireEntryAnswer>(queue: Pick<KeyedQueue, 'run'>, id: string, run: RetireEntryRun<T>): Promise<T> {
  return queue.run(id, run);
}
