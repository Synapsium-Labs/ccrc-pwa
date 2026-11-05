// D-7319: the Settings card "Dispatches that never came back", its read of `GET /api/coord/dispatch-abandon`. The
// hook has `useStallWatchView`'s shape: the newest issued request is authoritative, a failed poll keeps the last GOOD
// view beside its failure, the page becoming visible re-polls, `pollMs <= 0` is the injected mode, and `settle(view)`
// installs a write's reply so an older poll cannot put the old choice back. A not-available answer (501
// `not-configured`, an older server's 404) drops the view, as the collector's does: a radio from before a rollback must
// not stay checked. It also reads a write's rejection (`dispatchAbandonWriteRefusal`), beside the client it reads.
import { useCallback, useState } from 'react';
import { isDispatchAbandonRefusal, type DispatchAbandonView } from '../../../shared/dispatch-abandon';
import { ApiError, api, apiErrorText } from '../lib/api';
import { isRecord } from '../lib/wire';
import { settingsReadFailure, type SettingsReadFailure } from '../lib/notAvailable';
import { usePoll } from '../lib/usePoll';
import { forget, peek, put, settingsKey } from '../lib/screenCache';
import { asDispatchAbandonView } from './dispatchAbandonWords';

/** The read's cadence, the stall section's: 60 s, the lane's own beat. */
export const DISPATCH_ABANDON_POLL_MS = 60_000;

/** This read's key in the screen cache: its last good answer is drawn at once on the next mount; a write, or a
 *  not-available answer, forgets it. */
const CACHE_KEY = settingsKey('dispatch-abandon');

export interface DispatchAbandonPoll {
  /** The LAST GOOD answer: a failed read keeps it; a not-available answer drops it. */
  view: DispatchAbandonView | null;
  /** The latest poll's failure; null after a good answer or a settle. */
  failure: SettingsReadFailure | null;
  reload: () => void;
  settle: (view: DispatchAbandonView) => void;
}

export function useDispatchAbandonView(pollMs: number = DISPATCH_ABANDON_POLL_MS): DispatchAbandonPoll {
  const [state, setState] = useState<{ view: DispatchAbandonView | null; failure: SettingsReadFailure | null }>(
    () => ({ view: asDispatchAbandonView(peek(CACHE_KEY)?.raw), failure: null }));
  const { reload: load, supersede } = usePoll({
    pollMs,
    request: (signal) => api.dispatchAbandon({ signal }),   // aborted when the hook unmounts or a write supersedes it
    onOutcome: (outcome) => {
      if (outcome.ok) {
        const view = asDispatchAbandonView(outcome.raw);
        if (view !== null) put(CACHE_KEY, outcome.raw, Date.now());
        setState((prev) => (view === null ? { view: prev.view, failure: 'failed' } : { view, failure: null }));
      } else {
        const failure = settingsReadFailure(outcome.err);
        if (failure === 'not-configured') forget(CACHE_KEY);
        setState((prev) => ({ view: failure === 'not-configured' ? null : prev.view, failure }));
      }
    },
  });
  // A caller of `reload` is a write's re-read (the section's `.finally`, an unconfirmed or failed branch, an ack or a
  // move; console speed C2 fix rounds 1 and 2), with a few re-reads that follow no write (the collector's
  // marker-still-controls answer, Linear's legacy act), which cost only a Loading on the next visit. The kept answer
  // goes first: leaving Settings before the re-read lands (which aborts it) must not bring a pre-write view back.
  const reload = useCallback(() => { forget(CACHE_KEY); load(); }, [load]);
  const settle = useCallback((view: DispatchAbandonView) => {
    supersede();
    forget(CACHE_KEY);
    setState({ view, failure: null });
  }, [supersede]);
  return { view: state.view, failure: state.failure, reload, settle };
}

/** A write's rejection, read: the server's own refusal (a known code, with its detail), or an answer that proves
 *  nothing about the write (a network failure, a gateway's 502, a code this build does not know), which may have stored
 *  it and so is never called a refusal. */
export type DispatchAbandonWriteRefusal = { kind: 'refused'; detail: string } | { kind: 'unconfirmed'; detail: string | null };

const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

export function dispatchAbandonWriteRefusal(err: unknown): DispatchAbandonWriteRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unconfirmed', detail: null };
  const body = isRecord(err.body) ? err.body : {};
  const detail = nonBlank(body.detail) ?? nonBlank(body.message) ?? nonBlank(apiErrorText(err)) ?? `HTTP ${err.status}`;
  return isDispatchAbandonRefusal(body.error) ? { kind: 'refused', detail } : { kind: 'unconfirmed', detail };
}
