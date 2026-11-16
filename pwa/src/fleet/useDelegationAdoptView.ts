// D-8114: the Settings card "Worktrees left behind", its read of `GET /api/coord/delegation-adopt`. The hook has
// `useDispatchAbandonView`'s shape: the newest issued request is authoritative, a failed poll keeps the last GOOD view
// beside its failure, the page becoming visible re-polls, `pollMs <= 0` is the injected mode, and `settle(view)` installs
// a write's reply so an older poll cannot put the old choice back. A not-available answer (an older server's 404) drops
// the view: a radio from before a rollback must not stay checked. `reload()` returns its read's issue number and `landed` is
// the newest issue that landed, good or failed, at or after the newest `reload()`, so the card can wait for the view a
// re-read returns (review 1703 F6). A poll nobody asked for moves no `landed` (Task C38, D-8670, review 1709): the Settings
// frame keys this poll's memo by its fields, and a failed poll that changes none of them re-renders nothing, as every other
// card's failed poll does.
import { useCallback, useRef, useState } from 'react';
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
  /** The issue number of the newest read that landed, good or failed, at or after the newest `reload()`; 0 before any. A
   *  poll after the last asked read has landed, and a settle, land none. */
  landed: number;
  settle: (view: DelegationAdoptView) => void;
}

export function useDelegationAdoptView(pollMs: number = DELEGATION_ADOPT_POLL_MS): DelegationAdoptPoll {
  const [state, setState] = useState<{ view: DelegationAdoptView | null; failure: SettingsReadFailure | null; landed: number }>(
    { view: null, failure: null, landed: 0 });
  // The newest issue a `reload()` asked for and that has not landed yet; 0 when none is waited for.
  const asked = useRef(0);
  const { reload: load, supersede } = usePoll({
    pollMs,
    request: (signal) => api.delegationAdopt({ signal }),
    onOutcome: (outcome, issue) => {
      // Only the newest issued read lands, so a newer poll that overtook the asked read lands for it.
      const lands = asked.current > 0 && issue >= asked.current;
      if (lands) asked.current = 0;
      const next = (prev: typeof state, view: DelegationAdoptView | null, failure: SettingsReadFailure | null): typeof state => {
        const landed = lands ? issue : prev.landed;
        return view === prev.view && failure === prev.failure && landed === prev.landed ? prev : { view, failure, landed };
      };
      if (outcome.ok) {
        const view = asDelegationAdoptView(outcome.raw);
        setState((prev) => (view === null ? next(prev, prev.view, 'failed') : next(prev, view, null)));
      } else {
        const failure = settingsReadFailure(outcome.err);
        setState((prev) => next(prev, failure === 'not-configured' ? null : prev.view, failure));
      }
    },
  });
  const reload = useCallback((): number => {
    const issue = load();
    if (issue > 0) asked.current = issue;
    return issue;
  }, [load]);
  const settle = useCallback((view: DelegationAdoptView) => {
    supersede();
    setState((prev) => ({ view, failure: null, landed: prev.landed }));
  }, [supersede]);
  return { view: state.view, failure: state.failure, reload, landed: state.landed, settle };
}
