// D-8114: the Settings card "Worktrees left behind", its read of `GET /api/coord/delegation-adopt`. The hook has
// `useDispatchAbandonView`'s shape: the newest issued request is authoritative, a failed poll keeps the last GOOD view
// beside its failure, the page becoming visible re-polls, `pollMs <= 0` is the injected mode, and `settle(view)` installs
// a write's reply so an older poll cannot put the old choice back. A not-available answer (an older server's 404) drops
// the view: a radio from before a rollback must not stay checked. `reload()` returns its read's issue number and `landed` is
// the newest issue that landed, good or failed, so the card can wait for the view a re-read returns (review 1703 F6).
import { useCallback, useState } from 'react';
import type { DelegationAdoptView } from '../../../shared/delegation-adopt';
import { api } from '../lib/api';
import { settingsReadFailure, type SettingsReadFailure } from '../lib/notAvailable';
import { usePoll } from '../lib/usePoll';
import { asDelegationAdoptView } from './delegationAdoptWords';

/** The read's cadence: once a minute, `useScopeSweepView`'s beat; the switch and the last pass change slowly. */
export const DELEGATION_ADOPT_POLL_MS = 60_000;

export interface DelegationAdoptPoll {
  /** The LAST GOOD answer: a failed read keeps it; a not-available answer drops it. */
  view: DelegationAdoptView | null;
  /** The latest poll's failure; null after a good answer or a settle. */
  failure: SettingsReadFailure | null;
  /** One read now; its issue number, 0 in the injected mode (no read is issued). */
  reload: () => number;
  /** The issue number of the newest read that landed, good or failed; 0 before any. A settle lands none. */
  landed: number;
  settle: (view: DelegationAdoptView) => void;
}

export function useDelegationAdoptView(pollMs: number = DELEGATION_ADOPT_POLL_MS): DelegationAdoptPoll {
  const [state, setState] = useState<{ view: DelegationAdoptView | null; failure: SettingsReadFailure | null; landed: number }>(
    { view: null, failure: null, landed: 0 });
  const { reload: load, supersede } = usePoll({
    pollMs,
    request: (signal) => api.delegationAdopt({ signal }),
    onOutcome: (outcome, landed) => {
      if (outcome.ok) {
        const view = asDelegationAdoptView(outcome.raw);
        setState((prev) => (view === null ? { view: prev.view, failure: 'failed', landed } : { view, failure: null, landed }));
      } else {
        const failure = settingsReadFailure(outcome.err);
        setState((prev) => ({ view: failure === 'not-configured' ? null : prev.view, failure, landed }));
      }
    },
  });
  const reload = useCallback((): number => load(), [load]);
  const settle = useCallback((view: DelegationAdoptView) => {
    supersede();
    setState((prev) => ({ view, failure: null, landed: prev.landed }));
  }, [supersede]);
  return { view: state.view, failure: state.failure, reload, landed: state.landed, settle };
}
