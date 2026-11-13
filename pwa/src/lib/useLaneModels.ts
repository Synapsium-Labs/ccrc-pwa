// D-8406: the read of `GET /api/models/:lane`, the lane's classes as its own model files say them, for every surface
// that names a class's model: the session's model picker and its routing line, the inspector's routing line, and the
// new-session sheet's Class choice. Asked once when a lane is named and again when the page becomes visible, on
// `usePoll` (no timer: a registry moves at most hourly, and a return to the page re-reads it), and again each time a
// surface shows the models (`refreshOn`, the picker opening). The last good answer for
// a lane is kept in the screen cache, so a second surface, or a return to the session, names the models at once.
//
// `null` until a read lands for THIS lane: a caller then shows class names, never a model name it remembers. A failed
// read keeps the lane's last good answer; with none, it stays `null`. An answer for another lane is never shown.
import { useEffect, useRef, useState } from 'react';
import type { LaneModelsRead } from '../../../shared/models';
import { api } from './api';
import { asLaneModelsRead } from './models';
import { laneModelsKey, peek, put } from './screenCache';
import { usePoll } from './usePoll';

const cached = (lane: string | null): LaneModelsRead | null =>
  lane === null ? null : asLaneModelsRead(peek(laneModelsKey(lane))?.raw);

/** `lane` is the session's wrapper, or `null` while there is none to ask about (the hook then asks nothing). `load` is
 *  injectable for tests; it defaults to the app's one API client. `refreshOn` is a surface's own "shown again" signal
 *  (the model picker opening): each time it turns true the lane is asked again, so a class the registry moved while the
 *  screen stayed open is named the moment the models are looked at. */
export function useLaneModels(
  lane: string | null,
  load: (lane: string, signal: AbortSignal) => Promise<unknown> = (l, signal) => api.laneModels(l, { signal }),
  refreshOn = false,
): LaneModelsRead | null {
  const [state, setState] = useState<{ lane: string | null; read: LaneModelsRead | null }>(
    () => ({ lane, read: cached(lane) }));
  const current = useRef(lane);
  current.current = lane;
  const { reload } = usePoll({
    // `null` asks once on mount and on every return to the page; `0` is the injected mode, which asks nothing.
    pollMs: lane === null ? 0 : null,
    request: (signal) => {
      const asked = current.current;
      if (asked === null) return Promise.reject(new Error('no lane'));
      return load(asked, signal).then((raw) => ({ asked, raw }));
    },
    onOutcome: (outcome) => {
      if (!outcome.ok) return;
      const { asked, raw } = outcome.raw as { asked: string; raw: unknown };
      const read = asLaneModelsRead(raw);
      if (read === null || asked !== current.current) return;
      put(laneModelsKey(asked), raw, Date.now());
      setState({ lane: asked, read });
    },
  });
  // A new lane on a mounted hook (the session moved accounts): show its cached answer, if any, and ask about it now.
  // From no lane to one, `usePoll` asks by itself (its cadence changed), so only a move between two lanes asks here.
  const previous = useRef(lane);
  useEffect(() => {
    const was = previous.current;
    previous.current = lane;
    if (was === lane) return;
    setState({ lane, read: cached(lane) });
    if (was !== null && lane !== null) reload();
  }, [lane, reload]);
  const wasShown = useRef(refreshOn);
  useEffect(() => {
    const before = wasShown.current;
    wasShown.current = refreshOn;
    if (refreshOn && !before && lane !== null) reload();
  }, [refreshOn, lane, reload]);
  return state.lane === lane ? state.read : cached(lane);
}
