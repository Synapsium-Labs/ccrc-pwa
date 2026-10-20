// The Linear section's read of `GET /api/linear/connection` (named workspaces S4b, design §5.1), made ONCE by the
// Settings frame (`SettingsDataProvider`) like every other Settings read, and handed to the section as a poll.
//
// Unlike the update and stall-watch polls it does not poll: the connection changes only when the operator acts, or
// when a lookup's 401 marks it rejected, and the section's own acts install their answers (`settle`). It re-reads
// when the page becomes visible again, so a rejection marked while the tab was in the background shows on return.
// The newest-issued guard is the other hooks': a read that lands after a write's answer cannot put the old state back.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LinearConnectionView } from '../../../shared/linear';
import { api } from '../lib/api';

/** Why there is no view: the read failed, or its answer was a body this build cannot read. */
export type LinearFailure = 'failed';

export interface LinearPoll {
  /** The LAST GOOD answer: a later failure never clears it. */
  view: LinearConnectionView | null;
  failure: LinearFailure | null;
  /** One read now, under the newest-issued guard. */
  reload: () => void;
  /** Install a write's answer and drop every read issued before it. */
  settle: (view: LinearConnectionView) => void;
}

export function useLinearConnection(): LinearPoll {
  const [state, setState] = useState<{ view: LinearConnectionView | null; failure: LinearFailure | null }>({ view: null, failure: null });
  const issued = useRef(0);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let live = true;
    const load = (): void => {
      const mine = ++issued.current;
      void api.linearConnection().then(
        (v) => {
          if (!live || mine !== issued.current) return;
          setState((prev) => (v === 'unreadable' ? { view: prev.view, failure: 'failed' } : { view: v, failure: null }));
        },
        () => {
          if (!live || mine !== issued.current) return;
          setState((prev) => ({ view: prev.view, failure: 'failed' }));
        },
      );
    };
    const onVisible = (): void => { if (document.visibilityState === 'visible') load(); };
    loadRef.current = load;
    load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      loadRef.current = () => {};
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const reload = useCallback(() => { loadRef.current(); }, []);
  const settle = useCallback((view: LinearConnectionView) => {
    issued.current += 1;
    setState({ view, failure: null });
  }, []);
  return { view: state.view, failure: state.failure, reload, settle };
}
