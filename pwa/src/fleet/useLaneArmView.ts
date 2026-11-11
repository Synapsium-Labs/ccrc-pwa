// D-8274 (spec 2026-10-28 R-6): Settings › Automation › Shadow lanes, its read of `GET /api/coord/lane-arm`. The hook has
// `useDispatchAbandonView`'s shape: the newest issued request is authoritative, a failed poll keeps the last GOOD view beside
// its failure, the page becoming visible re-polls, `pollMs <= 0` is the injected mode, and `settle(view)` installs a write's
// reply so an older poll cannot put the old choice back. A not-available answer (501 `not-configured`, an older server's 404)
// drops the view: a Live radio from before a rollback must not stay checked. It also reads a write's rejection
// (`laneArmWriteRefusal`), beside the client it reads.
import { useCallback, useState } from 'react';
import { isLaneArmRefusal, type LaneArmConfirmRequired, type LaneArmView } from '../../../shared/lane-arm';
import { ApiError, api, apiErrorText } from '../lib/api';
import { isRecord } from '../lib/wire';
import { settingsReadFailure, type SettingsReadFailure } from '../lib/notAvailable';
import { usePoll } from '../lib/usePoll';
import { forget, peek, put, settingsKey } from '../lib/screenCache';
import { asLaneArmConfirm, asLaneArmView } from './laneArmWords';

/** The read's cadence: 60 s, the other Automation switches'. */
export const LANE_ARM_POLL_MS = 60_000;

const CACHE_KEY = settingsKey('lane-arm');

export interface LaneArmPoll {
  /** The LAST GOOD answer: a failed read keeps it; a not-available answer drops it. */
  view: LaneArmView | null;
  /** The latest poll's failure; null after a good answer or a settle. */
  failure: SettingsReadFailure | null;
  reload: () => void;
  settle: (view: LaneArmView) => void;
}

export function useLaneArmView(pollMs: number = LANE_ARM_POLL_MS): LaneArmPoll {
  const [state, setState] = useState<{ view: LaneArmView | null; failure: SettingsReadFailure | null }>(
    () => ({ view: asLaneArmView(peek(CACHE_KEY)?.raw), failure: null }));
  const { reload: load, supersede } = usePoll({
    pollMs,
    request: (signal) => api.laneArm({ signal }),
    onOutcome: (outcome) => {
      if (outcome.ok) {
        const view = asLaneArmView(outcome.raw);
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
  const settle = useCallback((view: LaneArmView) => {
    supersede();
    forget(CACHE_KEY);
    setState({ view, failure: null });
  }, [supersede]);
  return { view: state.view, failure: state.failure, reload, settle };
}

/** A write's rejection, read: the server's confirm (a 409 with its facts and key), the server's own refusal (a known
 *  code, with its detail), or an answer that proves nothing about the write (a network failure, a gateway's 502, a code
 *  this build does not know), which may have stored it and so is never called a refusal. */
export type LaneArmWriteRefusal =
  | { kind: 'confirm'; confirm: LaneArmConfirmRequired }
  | { kind: 'refused'; code: string; detail: string }
  | { kind: 'unconfirmed'; detail: string | null };

const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

export function laneArmWriteRefusal(err: unknown): LaneArmWriteRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unconfirmed', detail: null };
  if (err.status === 409) {
    const confirm = asLaneArmConfirm(err.body);
    if (confirm !== null) return { kind: 'confirm', confirm };
  }
  const body = isRecord(err.body) ? err.body : {};
  const detail = nonBlank(body.detail) ?? nonBlank(body.message) ?? nonBlank(apiErrorText(err)) ?? `HTTP ${err.status}`;
  return isLaneArmRefusal(body.error) ? { kind: 'refused', code: body.error, detail } : { kind: 'unconfirmed', detail };
}
