// The Stall watch section's own read of `GET /api/coord/stall-watch` (stall watch settings, design 2026-10-05 §13), and
// the reading of a write's rejection. The wire guards (`asStallWatchView`, `asStallConfirm`) are `stallWatchRead.ts`'s.
//
// The hook is `useUpdatesView`'s shape: the newest issued request is authoritative, a failed poll keeps the last GOOD
// view and reports the failure beside it, the page becoming visible re-polls, and `pollMs <= 0` is the injected mode.
// It adds `settle(view)`, which installs a write's reply and moves the request generation on, so a poll issued before
// the write that lands after it cannot put the old choice back (`usePoll`'s `supersede`). It has no `refresh()`: the server decides the
// confirm at the write (departure `server-decides-the-confirm` (D-4033)), so nothing here needs a fresh read to decide on.
import { useCallback, useState } from 'react';
import { isStallWatchRefusal } from '../../../shared/stall-watch';
import type { StallConfirmRequired, StallWatchView } from '../../../shared/api';
import { ApiError, api, apiErrorText } from '../lib/api';
import { settingsReadFailure, type SettingsReadFailure } from '../lib/notAvailable';
import { usePoll } from '../lib/usePoll';
import { isRecord } from '../lib/wire';
import { asStallConfirm, asStallWatchView } from './stallWatchRead';

/** The read's cadence: the stall sweep's own (60 s), so a faster read would fetch the same answer again. */
export const STALL_WATCH_POLL_MS = 60_000;

/** Why the latest poll produced no view. `not-configured` is a server with no stall-watch settings to offer (a box with
 *  no coordination database, or an older build without the route), which the section renders INSTEAD of any view that
 *  landed; `failed` is a read that did not land, rendered beside the last good view. */
export type StallWatchFailure = SettingsReadFailure;

export interface StallWatchPoll {
  /** The LAST GOOD answer: a later failure never clears it. */
  view: StallWatchView | null;
  /** The latest poll's failure; null after a good answer or a settle. */
  failure: StallWatchFailure | null;
  /** One poll now, fire-and-forget, under the same newest-issued guard. A no-op in the injected mode. */
  reload: () => void;
  /** Install a write's reply (already through `asStallWatchView`) and drop every poll issued before it. */
  settle: (view: StallWatchView) => void;
}

/** A write's rejection, read: the confirm the sheet shows, a refusal whose `detail` fills `STALL_CONFIRM_TEXT.refused`,
 *  or an answer that confirms nothing, which may have stored the write and so is never called a refusal. Its `detail`
 *  fills `STALL_CONFIRM_TEXT.unconfirmed`, and is null when no answer arrived (`STALL_CONFIRM_TEXT.unanswered`). */
export type StallWriteRefusal =
  | { kind: 'confirm'; confirm: StallConfirmRequired }
  | { kind: 'refused'; detail: string }
  | { kind: 'unconfirmed'; detail: string | null };

/** A string with something in it, trimmed; anything else is null. */
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

/**
 * A confirm needs BOTH the 409 status and a body `asStallConfirm` reads, as not-configured needs both its status and
 * its code. An `ApiError` whose body's `error` is one of the route's own codes (`isStallWatchRefusal`, L0's
 * `STALL_WATCH_REFUSALS`) is a refusal: the route answered it before any write. Every other `ApiError` is
 * `unconfirmed` (`an-answer-without-a-refusal-code-reads-unconfirmed` (D-4045)): a gateway's 502 or 504 can follow a
 * POST that reached the server, and a 500 can follow a store that committed, so its answer proves nothing about the
 * write. Either detail is the first non-blank of the server's own `detail` (a 400 naming an unknown key), the body's
 * `message` (Fastify's 500 carries the cause the route threw there), the error's own text through `apiErrorText` (a
 * non-JSON body), and last the HTTP status (an `{ error: '' }` body leaves that text empty), so neither line renders
 * with an empty slot. The status text is not an L0 line: it fills the server-answer detail slot, not section copy.
 *
 * A rejection that is not an `ApiError` is a network failure, and the POST may have left before it: the write may
 * have landed. It is `unconfirmed` with no detail, never a refusal, so the section never says "Nothing was changed"
 * about it.
 */
export function stallWriteRefusal(err: unknown): StallWriteRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unconfirmed', detail: null };
  const confirm = err.status === 409 ? asStallConfirm(err.body) : null;
  if (confirm !== null) return { kind: 'confirm', confirm };
  const body = isRecord(err.body) ? err.body : {};
  const detail = nonBlank(body.detail) ?? nonBlank(body.message) ?? nonBlank(apiErrorText(err)) ?? `HTTP ${err.status}`;
  return isStallWatchRefusal(body.error) ? { kind: 'refused', detail } : { kind: 'unconfirmed', detail };
}

// Moved to ../lib/notAvailable.ts (settingsReadFailure); the comment below stays for its history.
/** The two answers that mean "not available on this server", each status with its own code: 501 `not-configured` (no
 *  coordination database) and 404 `not-found` (the server's `/api/*` not-found answer, an older build that lacks the
 *  route; departure `older-server-404-reads-not-configured` (D-4035)). A 404 or 501 carrying any other body is a read
 *  that failed: folding it in would overload one value with two conditions the section renders differently. */

/**
 * `GET /api/coord/stall-watch` every `pollMs` and whenever the page becomes visible. The newest ISSUED request is
 * authoritative: an older in-flight answer, good or bad, never overwrites a newer request's, nor a settled write's.
 * State is set functionally, so a failure keeps whatever view the previous commit held. `pollMs <= 0` is the injected
 * mode: no request, no interval, no listener; `settle` still installs.
 */
export function useStallWatchView(pollMs: number = STALL_WATCH_POLL_MS): StallWatchPoll {
  const [state, setState] = useState<{ view: StallWatchView | null; failure: StallWatchFailure | null }>(
    { view: null, failure: null });
  const { reload: load, supersede } = usePoll({
    pollMs,
    request: () => api.stallWatch(),
    onOutcome: (outcome) => {
      if (outcome.ok) {
        const view = asStallWatchView(outcome.raw);
        setState((prev) => (view === null ? { view: prev.view, failure: 'failed' } : { view, failure: null }));
      } else {
        const failure = settingsReadFailure(outcome.err);
        setState((prev) => ({ view: prev.view, failure }));
      }
    },
  });

  const reload = useCallback(() => { load(); }, [load]);
  const settle = useCallback((view: StallWatchView) => {
    supersede();   // every poll issued before this write now lands stale
    setState({ view, failure: null });
  }, [supersede]);
  return { view: state.view, failure: state.failure, reload, settle };
}
