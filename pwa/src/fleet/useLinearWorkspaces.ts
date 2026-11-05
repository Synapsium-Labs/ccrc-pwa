// The Linear card's read of `GET /api/linear/workspaces` (#1444, spec §10.2), made ONCE by the Settings frame
// (`SettingsDataProvider`) like every other Settings read, and handed to the card as a poll. It takes over from the
// read of `GET /api/linear/connection`: the list carries the legacy key as its `legacy` row, so the card reads one list.
//
// Unlike the update and stall-watch polls it does not poll: the keys change only when the operator acts, or when a
// lookup's 401 marks one rejected, and the card's own acts install their answers (`settle`). It re-reads when the page
// becomes visible again, so a rejection marked while the tab was in the background shows on return. The
// newest-issued guard is `usePoll`'s, with no timer (`pollMs: null`): a read that lands after a write's answer cannot
// put the old list back.
import { useCallback, useState } from 'react';
import { api, readLinearWorkspaces, type LinearWorkspacesRead } from '../lib/api';
import { usePoll } from '../lib/usePoll';
import { forget, peek, put, settingsKey } from '../lib/screenCache';

/** This read's key in the screen cache: its last good list is drawn at once on the next mount; a write forgets it.
 *  The read already ran `api.linearWorkspaces`' reader, so what is kept is that list, and it is drawn back through
 *  `readLinearWorkspaces`, which reads its own answer whole (`settings-last-view.test.tsx` pins that). */
const CACHE_KEY = settingsKey('linear-workspaces');

/** Why there is no list: the read failed, or its answer was a body this build cannot read. */
export type LinearReadFailure = 'failed';

export interface LinearWorkspacesPoll {
  /** The LAST GOOD answer: a later failure never clears it. */
  view: LinearWorkspacesRead | null;
  failure: LinearReadFailure | null;
  /** One read now, under the newest-issued guard. */
  reload: () => void;
  /** Install a write's answer and drop every read issued before it. */
  settle: (view: LinearWorkspacesRead) => void;
}

export function useLinearWorkspaces(): LinearWorkspacesPoll {
  const [state, setState] = useState<{ view: LinearWorkspacesRead | null; failure: LinearReadFailure | null }>(
    () => ({ view: readLinearWorkspaces(peek(CACHE_KEY)?.raw), failure: null }));
  const { reload: load, supersede } = usePoll({
    pollMs: null,
    request: (signal) => api.linearWorkspaces({ signal }),   // aborted when the hook unmounts or a write supersedes it
    onOutcome: (outcome) => {
      if (outcome.ok) {
        const v = outcome.raw as LinearWorkspacesRead | 'unreadable';
        if (v !== 'unreadable') put(CACHE_KEY, v, Date.now());
        setState((prev) => (v === 'unreadable' ? { view: prev.view, failure: 'failed' } : { view: v, failure: null }));
      } else {
        setState((prev) => ({ view: prev.view, failure: 'failed' }));
      }
    },
  });

  const reload = useCallback(() => { load(); }, [load]);
  const settle = useCallback((view: LinearWorkspacesRead) => {
    supersede();
    forget(CACHE_KEY);
    setState({ view, failure: null });
  }, [supersede]);
  return { view: state.view, failure: state.failure, reload, settle };
}
