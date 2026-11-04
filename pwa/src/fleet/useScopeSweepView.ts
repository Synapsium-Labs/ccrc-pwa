// D-7994: the Settings card "Leftover processes", its read of `GET /api/coord/scope-sweep`. The hook has
// `useDispatchAbandonView`'s shape: the newest issued request is authoritative, a failed poll keeps the last GOOD view
// beside its failure, the page becoming visible re-polls, `pollMs <= 0` is the injected mode, and `settle(view)` installs
// a write's reply so an older poll cannot put the old choice back. A not-available answer (an older server's 404) drops
// the view: a radio from before a rollback must not stay checked. It also reads a write's rejection.
import { useCallback, useState } from 'react';
import { isScopeSweepRefusal, type ScopeSweepView } from '../../../shared/scope-sweep';
import { ApiError, api, apiErrorText } from '../lib/api';
import { isRecord } from '../lib/wire';
import { settingsReadFailure, type SettingsReadFailure } from '../lib/notAvailable';
import { usePoll } from '../lib/usePoll';
import { asScopeSweepView } from './scopeSweepWords';

/** The read's cadence: the sweep's own beat. */
export const SCOPE_SWEEP_POLL_MS = 60_000;

export interface ScopeSweepPoll {
  /** The LAST GOOD answer: a failed read keeps it; a not-available answer drops it. */
  view: ScopeSweepView | null;
  /** The latest poll's failure; null after a good answer or a settle. */
  failure: SettingsReadFailure | null;
  reload: () => void;
  settle: (view: ScopeSweepView) => void;
}

export function useScopeSweepView(pollMs: number = SCOPE_SWEEP_POLL_MS): ScopeSweepPoll {
  const [state, setState] = useState<{ view: ScopeSweepView | null; failure: SettingsReadFailure | null }>(
    { view: null, failure: null });
  const { reload: load, supersede } = usePoll({
    pollMs,
    request: () => api.scopeSweep(),
    onOutcome: (outcome) => {
      if (outcome.ok) {
        const view = asScopeSweepView(outcome.raw);
        setState((prev) => (view === null ? { view: prev.view, failure: 'failed' } : { view, failure: null }));
      } else {
        const failure = settingsReadFailure(outcome.err);
        setState((prev) => ({ view: failure === 'not-configured' ? null : prev.view, failure }));
      }
    },
  });
  const reload = useCallback(() => { load(); }, [load]);
  const settle = useCallback((view: ScopeSweepView) => {
    supersede();
    setState({ view, failure: null });
  }, [supersede]);
  return { view: state.view, failure: state.failure, reload, settle };
}

/** A write's rejection, read: the server's own refusal (a known code, with its detail), or an answer that proves nothing
 *  about the write (a network failure, a code this build does not know), which may have run the verb and so is never
 *  called a refusal. */
export type ScopeSweepWriteRefusal = { kind: 'refused'; detail: string } | { kind: 'unconfirmed'; detail: string | null };

const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

export function scopeSweepWriteRefusal(err: unknown): ScopeSweepWriteRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unconfirmed', detail: null };
  const body = isRecord(err.body) ? err.body : {};
  const detail = nonBlank(body.detail) ?? nonBlank(body.stderr) ?? nonBlank(body.message) ?? nonBlank(apiErrorText(err)) ?? `HTTP ${err.status}`;
  return isScopeSweepRefusal(body.error, body.stderr) ? { kind: 'refused', detail } : { kind: 'unconfirmed', detail };
}
