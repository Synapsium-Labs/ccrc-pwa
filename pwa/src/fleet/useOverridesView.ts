// D-8382: the read of `GET /api/fleet/overrides`, for Settings › Automation › Overrides in force and Settings › Security's
// approvals line. `useLaneArmView`'s shape without the write half: the newest issued request is authoritative, a failed
// poll keeps the last GOOD view beside its failure, the page becoming visible re-polls, `pollMs <= 0` is the injected
// mode, and a not-available answer (an older server's 404) drops the view.
import { useCallback, useState } from 'react';
import type { OverridesView } from '../../../shared/overrides';
import { api } from '../lib/api';
import { settingsReadFailure, type SettingsReadFailure } from '../lib/notAvailable';
import { usePoll } from '../lib/usePoll';
import { forget, peek, put, settingsKey } from '../lib/screenCache';
import { asOverridesView } from './overridesWords';

/** The read's cadence: 60 s, the Automation switches'. */
export const OVERRIDES_POLL_MS = 60_000;

const CACHE_KEY = settingsKey('overrides');

export interface OverridesPoll {
  /** The LAST GOOD answer: a failed read keeps it; a not-available answer drops it. */
  view: OverridesView | null;
  /** The latest poll's failure; null after a good answer. */
  failure: SettingsReadFailure | null;
  reload: () => void;
}

export function useOverridesView(pollMs: number = OVERRIDES_POLL_MS): OverridesPoll {
  const [state, setState] = useState<{ view: OverridesView | null; failure: SettingsReadFailure | null }>(
    () => ({ view: asOverridesView(peek(CACHE_KEY)?.raw), failure: null }));
  const { reload: load } = usePoll({
    pollMs,
    request: (signal) => api.fleetOverrides({ signal }),
    onOutcome: (outcome) => {
      if (outcome.ok) {
        const view = asOverridesView(outcome.raw);
        if (view !== null) put(CACHE_KEY, outcome.raw, Date.now());
        setState((prev) => (view === null ? { view: prev.view, failure: 'failed' } : { view, failure: null }));
      } else {
        const failure = settingsReadFailure(outcome.err);
        if (failure === 'not-configured') forget(CACHE_KEY);
        setState((prev) => ({ view: failure === 'not-configured' ? null : prev.view, failure }));
      }
    },
  });
  const reload = useCallback(() => { forget(CACHE_KEY); load(); }, [load]);
  return { view: state.view, failure: state.failure, reload };
}
