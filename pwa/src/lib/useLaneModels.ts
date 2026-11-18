// D-8406: the read of `GET /api/models/:lane`, the lane's classes as its own model files say them, for every surface
// that names a class's model: the session's model picker and its routing line, the inspector's routing line, and the
// new-session sheet's Class choice. Asked once when a lane is named and again when the page becomes visible, on
// `usePoll` (no timer: a registry moves at most hourly, and a return to the page re-reads it), and again each time a
// surface shows the models (`refreshOn`, the picker opening). The last good answer for
// a lane is kept in the screen cache, so a second surface, or a return to the session, names the models at once.
//
// `null` until a read lands for THIS lane: a caller then shows class names, never a model name it remembers. A failed
// read keeps the lane's last good answer; with none, it stays `null`. An answer for another lane is never shown.
//
// A TRANSIENT ANSWER (R3b fix round 1, F2): `busy` and `not-started` say nothing ran, so they never replace the lane's
// last good read, in this hook or in the screen cache. The read stays, and the word rides beside it (`transient`, read
// through `useLaneModelsView`); with no good read to keep, the transient arm is shown as the read. Each transient answer
// asks again ONCE, `LANE_TRANSIENT_RETRY_MS` later, so "the next read shows the models" is true without a loop: the
// retry's own answer, transient or not, schedules nothing, and only a surface's next read can. A `refused`,
// `unsupported`, `unreadable` or `absent` answer replaces the read as before.
import { useEffect, useRef, useState } from 'react';
import type { LaneModelsRead } from '../../../shared/models';
import { api } from './api';
import { asLaneModelsRead, laneReadFailureOf, type LaneReadFailure } from './models';
import { laneModelsKey, peek, put } from './screenCache';
import { usePoll } from './usePoll';

/** What a landed read came to, for a caller that says it (the Models sheet): `ok`, or the class of failure (F12). */
/** How long after a transient answer the hook asks once more (F2). */
export const LANE_TRANSIENT_RETRY_MS = 3_000;

/** The two arms that say nothing ran and pass by themselves. */
export type LaneTransientKind = 'busy' | 'not-started';
const isTransient = (r: LaneModelsRead): r is Extract<LaneModelsRead, { kind: LaneTransientKind }> =>
  r.kind === 'busy' || r.kind === 'not-started';

/** The hook's whole answer: the read a surface shows, and the transient word of the newest answer when it was kept
 *  beside an older good read instead of replacing it (`null` otherwise). */
export interface LaneModelsView { readonly read: LaneModelsRead | null; readonly transient: LaneTransientKind | null }

export type LaneModelsReadOutcome = { readonly ok: true } | { readonly ok: false; readonly failure: LaneReadFailure };

/** What a caller that writes the lane holds (the Models sheet): `supersede()` drops every read of this hook still in flight,
 *  so none of them lands, puts the screen cache back or replaces the shown read. The sheet calls it the moment an act's 200
 *  arrives, before the read it then asks for is issued (review 2523 F2: a read issued before the act could otherwise land in
 *  between). It is `usePoll`'s own `supersede`. */
export interface LaneModelsControl { readonly supersede: () => void }

const cached = (lane: string | null): LaneModelsRead | null =>
  lane === null ? null : asLaneModelsRead(peek(laneModelsKey(lane))?.raw);

/** `lane` is the session's wrapper, or `null` while there is none to ask about (the hook then asks nothing). `load` is
 *  injectable for tests; it defaults to the app's one API client. `refreshOn` is a surface's own "shown again" signal
 *  (the model picker opening): each time it turns true the lane is asked again, so a class the registry moved while the
 *  screen stayed open is named the moment the models are looked at. `refreshKey` is a caller's own "ask again": each time
 *  it changes the lane is read once more (the Models sheet, after every act). `control`, when given, is filled with this hook's
 *  `LaneModelsControl` once it is mounted. */
export function useLaneModels(
  lane: string | null,
  load: (lane: string, signal: AbortSignal) => Promise<unknown> = (l, signal) => api.laneModels(l, { signal }),
  refreshOn = false,
  refreshKey = 0,
  onRead?: (outcome: LaneModelsReadOutcome) => void,
  control?: { current: LaneModelsControl | null },
): LaneModelsRead | null {
  return useLaneModelsView(lane, load, refreshOn, refreshKey, onRead, control).read;
}

/** `useLaneModels` with the transient word beside the read (F2), for a surface that says it: the model picker and the
 *  Models sheet. The same parameters. */
export function useLaneModelsView(
  lane: string | null,
  load: (lane: string, signal: AbortSignal) => Promise<unknown> = (l, signal) => api.laneModels(l, { signal }),
  refreshOn = false,
  refreshKey = 0,
  onRead?: (outcome: LaneModelsReadOutcome) => void,
  control?: { current: LaneModelsControl | null },
): LaneModelsView {
  const [state, setState] = useState<{ lane: string | null; read: LaneModelsRead | null; transient: LaneTransientKind | null }>(
    () => ({ lane, read: cached(lane), transient: null }));
  // F2: whether the read in flight is the retry itself (its answer schedules no other), and the retry's timer.
  const retryAsked = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadNow = useRef<() => number>(() => 0);
  const current = useRef(lane);
  current.current = lane;
  const onReadNow = useRef(onRead);
  onReadNow.current = onRead;
  const { reload, supersede } = usePoll({
    // `null` asks once on mount and on every return to the page; `0` is the injected mode, which asks nothing.
    pollMs: lane === null ? 0 : null,
    request: (signal) => {
      const asked = current.current;
      if (asked === null) return Promise.reject(new Error('no lane'));
      return load(asked, signal).then((raw) => ({ asked, raw }));
    },
    onOutcome: (outcome) => {
      // Whatever it came to, the retry's answer has arrived (F2): read the flag once, here.
      const fromRetry = retryAsked.current;
      retryAsked.current = false;
      if (!outcome.ok) { onReadNow.current?.({ ok: false, failure: laneReadFailureOf(outcome.err) }); return; }
      const { asked, raw } = outcome.raw as { asked: string; raw: unknown };
      if (asked !== current.current) return;
      const read = asLaneModelsRead(raw);
      if (read === null) { onReadNow.current?.({ ok: false, failure: 'unreadable' }); return; }
      if (isTransient(read)) {
        // Nothing ran: keep the last good read (this hook's, else the cache's), never write the cache, and ask once more.
        setState((prev) => {
          const kept = prev.lane === asked ? prev.read : cached(asked);
          return kept?.kind === 'read' ? { lane: asked, read: kept, transient: read.kind } : { lane: asked, read, transient: null };
        });
        if (!fromRetry) {
          if (retryTimer.current !== null) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            if (current.current !== asked) return;
            retryAsked.current = true;
            reloadNow.current();
          }, LANE_TRANSIENT_RETRY_MS);
        }
        onReadNow.current?.({ ok: true });
        return;
      }
      put(laneModelsKey(asked), raw, Date.now());
      setState({ lane: asked, read, transient: null });
      onReadNow.current?.({ ok: true });
    },
  });
  reloadNow.current = reload;
  // The retry's timer goes with the hook, and with the lane it was set for.
  useEffect(() => () => { if (retryTimer.current !== null) clearTimeout(retryTimer.current); }, []);
  useEffect(() => {
    if (control === undefined) return undefined;
    control.current = { supersede };
    return () => { control.current = null; };
  }, [control, supersede]);
  // A new lane on a mounted hook (the session moved accounts): show its cached answer, if any, and ask about it now.
  // From no lane to one, `usePoll` asks by itself (its cadence changed), so only a move between two lanes asks here.
  const previous = useRef(lane);
  useEffect(() => {
    const was = previous.current;
    previous.current = lane;
    if (was === lane) return;
    if (retryTimer.current !== null) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    retryAsked.current = false;
    setState({ lane, read: cached(lane), transient: null });
    if (was !== null && lane !== null) reload();
  }, [lane, reload]);
  const wasShown = useRef(refreshOn);
  useEffect(() => {
    const before = wasShown.current;
    wasShown.current = refreshOn;
    if (refreshOn && !before && lane !== null) reload();
  }, [refreshOn, lane, reload]);
  // A caller's own "ask again" (the Models sheet, after every act): each change of the key reads the
  // lane once more. The first render's key is the baseline, so mounting asks nothing extra.
  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (lastKey.current === refreshKey) return;
    lastKey.current = refreshKey;
    if (lane !== null) reload();
  }, [refreshKey, lane, reload]);
  return state.lane === lane ? { read: state.read, transient: state.transient } : { read: cached(lane), transient: null };
}
