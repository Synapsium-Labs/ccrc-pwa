// D-7994: the Settings card "Leftover processes", its read of `GET /api/coord/scope-sweep`. The hook has
// `useDispatchAbandonView`'s shape: the newest issued request is authoritative, a failed poll keeps the last GOOD view
// beside its failure, the page becoming visible re-polls, `pollMs <= 0` is the injected mode, and `settle(view)` installs
// a write's reply so an older poll cannot put the old choice back. A not-available answer (an older server's 404) drops
// the view: a radio from before a rollback must not stay checked.
import { useCallback, useState } from 'react';
import type { ScopeSweepView } from '../../../shared/scope-sweep';
import { api } from '../lib/api';
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
    request: (signal) => api.scopeSweep({ signal }),
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
