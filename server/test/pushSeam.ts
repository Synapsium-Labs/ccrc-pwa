// The ONE seam of the push-outbox characterization (`push-outbox-characterization.test.ts`): a recording
// `PushService.notify` double, and how a harness installs it.
//
// Every push site of the characterization reaches the double through `NoticeDeps.push` / `Deps.push`, the place the
// funnel (`notice.ts#sendPush`) reads it today. When a later change moves the send behind a verdict, only this file
// changes (the double starts to answer one), and no site's test is edited: that is why no case builds its own
// `{ notify }` literal.
//
// `notify` records the payload it receives, in order, and answers a `PushSendVerdict` (one subscription, accepted), as
// `PushService.notify` does since the push outbox (Task 3). The sender (Task 4) reads it: this is the suite's one seam change.
import type { PushPayload, PushService } from '../src/push.js';

/** What a harness installs: the double itself (`push`) and what it recorded (`sent`). */
export interface PushSeam {
  /** Every payload `notify` received, in the order it received them. */
  readonly sent: PushPayload[];
  /** The funnel's view of the push service: `Pick<PushService, 'notify'>`. */
  readonly push: Pick<PushService, 'notify'>;
  /** The next `n` sends are recorded, then reject with `err` (the release push's `failed` sentence reads this). */
  rejectNext(err: Error, n?: number): void;
}

export function pushSeam(): PushSeam {
  const sent: PushPayload[] = [];
  let rejects: { err: Error; left: number } | null = null;
  // The cast is the one place the double's answer type is named.
  const push = {
    notify: (payload: PushPayload): Promise<unknown> => {
      sent.push(payload);
      if (rejects !== null && rejects.left > 0) {
        rejects.left -= 1;
        return Promise.reject(rejects.err);
      }
      return Promise.resolve({ kind: 'sent', subs: [{ endpointHash: 'seam', verdict: 'accepted', status: 201 }] });
    },
  } as unknown as Pick<PushService, 'notify'>;
  return { sent, push, rejectNext: (err, n = 1) => { rejects = { err, left: n }; } };
}

/** The deps key a harness sets, in one place: `Deps.push` is the whole `PushService` and `NoticeDeps.push` its `notify`;
 *  the double stands in for both. `null` is a box with no push service (no VAPID keys): the key is ABSENT, not
 *  `undefined`, as `index.ts` builds it. Sets the key in place and returns `deps`, so a harness that already built its
 *  deps object installs on the very object its watcher or server holds. */
export function installPush<T extends object>(deps: T, seam: PushSeam | null): T {
  const d = deps as { push?: unknown };
  if (seam === null) delete d.push;
  else d.push = seam.push;
  return deps;
}

/** The spread form of `installPush`, for a harness that builds its deps literal in one expression. */
export const pushDeps = (seam: PushSeam | null): { push?: never } => (seam === null ? {} : { push: seam.push as never });
