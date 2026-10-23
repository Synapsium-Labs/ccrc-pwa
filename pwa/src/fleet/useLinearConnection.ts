// The Linear section's read of `GET /api/linear/connection` (named workspaces S4b, design §5.1), made ONCE by the
// Settings frame (`SettingsDataProvider`) like every other Settings read, and handed to the section as a poll.
//
// Unlike the update and stall-watch polls it does not poll: the connection changes only when the operator acts, or
// when a lookup's 401 marks it rejected, and the section's own acts install their answers (`settle`). It re-reads
// when the page becomes visible again, so a rejection marked while the tab was in the background shows on return.
// The newest-issued guard is `usePoll`'s, with no timer (`pollMs: null`): a read that lands after a write's answer cannot put the old state back.
import { useCallback, useState } from 'react';
import type { LinearConnectionView } from '../../../shared/linear';
import { api } from '../lib/api';
import { usePoll } from '../lib/usePoll';

/** Why there is no view: the read failed, or its answer was a body this build cannot read. */
export type LinearReadFailure = 'failed';

export interface LinearPoll {
  /** The LAST GOOD answer: a later failure never clears it. */
  view: LinearConnectionView | null;
  failure: LinearReadFailure | null;
  /** One read now, under the newest-issued guard. */
  reload: () => void;
  /** Install a write's answer and drop every read issued before it. */
  settle: (view: LinearConnectionView) => void;
}

export function useLinearConnection(): LinearPoll {
  const [state, setState] = useState<{ view: LinearConnectionView | null; failure: LinearReadFailure | null }>({ view: null, failure: null });
  const { reload: load, supersede } = usePoll({
    pollMs: null,
    request: () => api.linearConnection(),
    onOutcome: (outcome) => {
      if (outcome.ok) {
        const v = outcome.raw as LinearConnectionView | 'unreadable';
        setState((prev) => (v === 'unreadable' ? { view: prev.view, failure: 'failed' } : { view: v, failure: null }));
      } else {
        setState((prev) => ({ view: prev.view, failure: 'failed' }));
      }
    },
  });

  const reload = useCallback(() => { load(); }, [load]);
  const settle = useCallback((view: LinearConnectionView) => {
    supersede();
    setState({ view, failure: null });
  }, [supersede]);
  return { view: state.view, failure: state.failure, reload, settle };
}
