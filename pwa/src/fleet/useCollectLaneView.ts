// The Temp root collector section's own read of `GET /api/coord/collect-lane` (path-identity spec 2026-10-12 §5.6,
// §5.7), and the three pure readers its writes need: the wire guard for the view, the guard for a 409 confirm body,
// and the reading of a write's rejection.
//
// The hook has `useStallWatchView`'s shape:
// - the newest issued request is authoritative;
// - the page becoming visible re-polls;
// - `pollMs <= 0` is the injected mode;
// - `settle(view)` installs a write's reply and moves the request generation on, so a poll issued before the write
//   that lands after it cannot put the old choice back.
// It differs in one rule, on purpose. Some answers from the SERVER drop the view that landed before:
// - this switch is not available here: 404 `not-found` or 501 `not-configured`, decided by the shared
//   `settingsReadFailure`;
// - its state cannot be measured: a 503 `state-unmeasurable` from the GET, where there is no row to read.
// So a Live radio from before a rollback, or from before a lost row, never stays on screen. A read that did not land,
// or an answer this guard cannot read whole, keeps the last good view beside its failure.
import { useCallback, useState } from 'react';
import {
  isCollectLaneRefusal,
  type CollectLaneConfirmRequired, type CollectLaneRefusal, type CollectLaneView,
} from '../../../shared/api';
import { ApiError, api, apiErrorText } from '../lib/api';
import { settingsReadFailure, type SettingsReadFailure } from '../lib/notAvailable';
import { usePoll } from '../lib/usePoll';
import { isRecord } from '../lib/wire';
import { asCollectLaneConfirm, asCollectLaneView } from './collectLaneRead';

/** The read's cadence, the stall section's: 60 s. */
export const COLLECT_LANE_POLL_MS = 60_000;

/** Why the latest poll produced no view: the shared helper's two words, plus the one answer this route alone gives
 *  (a 503 `state-unmeasurable` from the GET: the switch's row is absent, spec §5.6), with the server's bounded detail. */
export type CollectLaneReadFailure =
  | { kind: SettingsReadFailure }
  | { kind: 'state-unmeasurable'; detail: string };

export interface CollectLanePoll {
  /** The LAST GOOD answer. A failed read keeps it; a not-available or unmeasurable answer drops it. */
  view: CollectLaneView | null;
  /** The latest poll's failure; null after a good answer or a settle. */
  failure: CollectLaneReadFailure | null;
  /** One poll now, fire-and-forget, under the same newest-issued guard. A no-op in the injected mode. */
  reload: () => void;
  /** Install a write's reply (already through `asCollectLaneView`) and drop every poll issued before it. */
  settle: (view: CollectLaneView) => void;
}

/** The one GET refusal this hook reads as its own kind, typed by L0's refusal union so a rename there is a compile
 *  error here. */
const UNMEASURABLE: CollectLaneRefusal = 'state-unmeasurable';

/** A write's rejection, read. It is one of three:
 *  - the confirm the sheet shows;
 *  - a refusal: the server's own answer, carrying L0's code (the section's words table keys on it) and a detail that is
 *    never blank;
 *  - an answer that never arrived, or one that carries no code this build knows. Either may have stored the write, so
 *    it is never called a refusal. Its detail is the answer's when there was one, and null when none arrived. */
export type CollectLanePostRefusal =
  | { kind: 'confirm'; confirm: CollectLaneConfirmRequired }
  | { kind: 'refused'; code: CollectLaneRefusal; detail: string }
  | { kind: 'unconfirmed'; detail: string | null };

/** A string with something in it, trimmed; anything else is null. */
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

/** The detail, from the first source that is not blank:
 *  1. the server's own `detail`;
 *  2. Fastify's `message`;
 *  3. the error's own text;
 *  4. the HTTP status.
 *  So a line that shows it never renders an empty slot. */
const detailOf = (err: ApiError): string => {
  const body: Record<string, unknown> = isRecord(err.body) ? err.body : {};
  return nonBlank(body.detail) ?? nonBlank(body.message) ?? nonBlank(apiErrorText(err)) ?? `HTTP ${err.status}`;
};

/** A confirm needs BOTH the 409 status and a body `asCollectLaneConfirm` reads whole. An `ApiError` whose body's
 *  `error` is a known refusal code is the server's own answer, so it is `refused`: every known code but `write-failed`
 *  proves nothing was written, and `write-failed` keeps its own line, which says the server could not prove the choice
 *  was stored. Every other `ApiError` is `unconfirmed`, with its detail: a gateway's 502 or 504 can follow a POST that
 *  reached the server, and an unexpected 500 can follow a store that committed, so its answer proves nothing about the
 *  write. A rejection that is not an `ApiError` is a network failure, and the POST may have left before it, so it is
 *  `unconfirmed` with no detail. */
export function collectLanePostRefusal(err: unknown): CollectLanePostRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unconfirmed', detail: null };
  const confirm = err.status === 409 ? asCollectLaneConfirm(err.body) : null;
  if (confirm !== null) return { kind: 'confirm', confirm };
  const body: Record<string, unknown> = isRecord(err.body) ? err.body : {};
  if (isCollectLaneRefusal(body.error)) return { kind: 'refused', code: body.error, detail: detailOf(err) };
  return { kind: 'unconfirmed', detail: detailOf(err) };
}

/** A read's rejection. The shared helper decides 404/501 first. This route's 503 `state-unmeasurable` is then its own
 *  kind, carrying the server's bounded detail. Everything else is `failed`. */
const readFailureOf = (err: unknown): CollectLaneReadFailure => {
  if (settingsReadFailure(err) === 'not-configured') return { kind: 'not-configured' };
  if (err instanceof ApiError && err.status === 503) {
    const body: Record<string, unknown> = isRecord(err.body) ? err.body : {};
    if (body.error === UNMEASURABLE) return { kind: 'state-unmeasurable', detail: detailOf(err) };
  }
  return { kind: 'failed' };
};

/**
 * `GET /api/coord/collect-lane` every `pollMs` and whenever the page becomes visible. The newest ISSUED request is
 * authoritative: an older in-flight answer, good or bad, never overwrites a newer request's answer, nor a settled
 * write's. `pollMs <= 0` is the injected mode: no request, no interval, no listener; `settle` still installs.
 */
export function useCollectLaneView(pollMs: number = COLLECT_LANE_POLL_MS): CollectLanePoll {
  const [state, setState] = useState<{ view: CollectLaneView | null; failure: CollectLaneReadFailure | null }>(
    { view: null, failure: null });
  const { reload: load, supersede } = usePoll({
    pollMs,
    request: () => api.collectLane(),
    onOutcome: (outcome) => {
      if (outcome.ok) {
        const view = asCollectLaneView(outcome.raw);
        setState((prev) => (view === null ? { view: prev.view, failure: { kind: 'failed' } } : { view, failure: null }));
      } else {
        const failure = readFailureOf(outcome.err);
        // The server saying the switch is not here, or cannot be measured, drops the landed view; a read that did
        // not land keeps it.
        setState((prev) => ({ view: failure.kind === 'failed' ? prev.view : null, failure }));
      }
    },
  });

  const reload = useCallback(() => { load(); }, [load]);
  const settle = useCallback((view: CollectLaneView) => {
    supersede();   // every poll issued before this write now lands stale
    setState({ view, failure: null });
  }, [supersede]);
  return { view: state.view, failure: state.failure, reload, settle };
}
