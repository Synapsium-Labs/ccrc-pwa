// The ONE poll of `GET /api/updates` (design 2026-09-20 §13; W3 Task 5), and
// the two pure readers every update surface shares — the settings screen, the
// fleet's update line and BuildLine all read THIS file's answers, so none of them can
// hold its own opinion of what "malformed" or "behind" means.
//
// The hook is `useFleetHealth`'s shape — newest issued request authoritative,
// `pollMs <= 0` as the injected mode, one poll per screen handed down — with
// two additions that hook does not need. (1) It keeps the last GOOD view across
// a failed poll and reports the failure BESIDE it rather than instead of it:
// the settings screen must not blank a node list because one read timed out,
// and must not claim the list is fresh either. (2) It re-polls when the page
// becomes visible, because a phone that slept through three polls should not
// show a 3-minute-old "vX is out" as current.
import { useMemo, useState } from 'react';
import type { UpdatesView } from '../../../shared/api';
import { ApiError, api } from '../lib/api';
import { usePoll } from '../lib/usePoll';
import { asUpdatesView } from './updatesRead';

/** The read's cadence. The spec names none for the PWA; 60 s is the server's
 *  own fastest cadence over these rows — the inventory sweep
 *  (`UPDATE_INVENTORY_MS`, `server/src/watch.ts`, design §9's "every inventory
 *  sweep (60 s)"); the catalogue poll is 30 min — so a faster read would fetch
 *  the same rows again. The visibility refresh covers a phone that slept
 *  through polls. */
export const UPDATES_POLL_MS = 60_000;

/** Why the latest poll produced no view — two words, because the screen says
 *  two different things: `not-configured` is a box with no control plane (a
 *  state, rendered as such), `failed` is a read that did not land (transient). */
export type UpdatesFailure = 'not-configured' | 'failed';

/** A later poll failed, so what a surface shows is the last answer that landed (`view` is kept, `failure` stands).
 *  The update plane's one sentence for it (wave 19, R24(b)), shown by every surface that reads this poll's kept
 *  view: the home screen's skew and halt banners, its update line and BuildLine, and announced once by the fleet
 *  screen's own status region (D-5124). Settings' own stale line says it too (its own exposure, a separate screen),
 *  imported from here. */
export const UPDATES_STALE_TEXT = 'The latest read failed — this is the last answer that landed.';

export interface UpdatesPoll {
  /** The LAST GOOD answer — a later failure never clears it. */
  view: UpdatesView | null;
  /** The latest poll's failure; null after a good answer. */
  failure: UpdatesFailure | null;
  /** The issue number of the read that set `view` (D-4273): 0 before any good read, and unchanged by a failed,
   *  malformed or 501 read, because the view is kept and so is its number. Set in the SAME `setState` call as
   *  `view`, so the two always describe one read. */
  seq: number;
  /** One poll now (after a write), under the same newest-issued guard; it returns that poll's issue number (D-4273),
   *  the number `seq` takes when that read's good answer is the one that lands. In the injected mode (`pollMs <= 0`)
   *  it issues nothing and returns 0: a consumer handed its view re-polls through its parent. */
  reload: () => number;
}

/** `not-configured` needs BOTH the status and the code: a 501 carrying any other
 *  word is a read that failed, and folding it into "this box has no control
 *  plane" would overload one value with two conditions the screen renders
 *  differently. */
const failureOf = (err: unknown): UpdatesFailure =>
  err instanceof ApiError && err.status === 501
    && typeof err.body === 'object' && err.body !== null
    && (err.body as { error?: unknown }).error === 'not-configured'
    ? 'not-configured'
    : 'failed';

/**
 * `GET /api/updates` every `pollMs` and whenever the page becomes visible.
 * Newest ISSUED request authoritative — an older in-flight answer, good or bad,
 * never overwrites a newer one (`useFleetHealth`'s issued/mine guard). State is
 * set functionally, so a failure keeps whatever view the previous commit held.
 * `pollMs <= 0` is the injected mode: no request, no interval, no listener.
 * Each request carries an issue number from one ref-held counter (monotonic across a `pollMs` change): `seq` is the
 * number of the read that set `view`, and `reload()` returns the number it issued, so a caller can tell a read issued
 * after some event from one issued before it (D-4273).
 */
export function useUpdatesView(pollMs: number = UPDATES_POLL_MS): UpdatesPoll {
  const [state, setState] = useState<{ view: UpdatesView | null; failure: UpdatesFailure | null; seq: number }>(
    { view: null, failure: null, seq: 0 });
  const { reload } = usePoll({
    pollMs,
    request: () => api.updates(),
    onOutcome: (outcome, issue) => {
      if (outcome.ok) {
        const view = asUpdatesView(outcome.raw);
        setState((prev) => (view === null
          ? { view: prev.view, failure: 'failed', seq: prev.seq }
          : { view, failure: null, seq: issue }));
      } else {
        const failure = failureOf(outcome.err);
        setState((prev) => ({ view: prev.view, failure, seq: prev.seq }));
      }
    },
  });
  // Memoised (C6, D-6438): `reload` is `usePoll`'s `useCallback([])`, so the plane changes only when a poll lands.
  return useMemo(
    () => ({ view: state.view, failure: state.failure, seq: state.seq, reload }),
    [state.view, state.failure, state.seq, reload],
  );
}
