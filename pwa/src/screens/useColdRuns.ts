// The run board's ARCHIVE read: `GET /api/runs?closed=1`, its race guard, and
// the four independent transitions that re-fire it (unless the caller reads
// once per mount: `rereadOnTransitions: false`).
//
// It is the ONLY carrier of a finished run — the live `/ws/runs` frame is
// active-only by construction, so it can never itself report a row that has
// closed. That is why so much of this file is about re-reading: every way a
// finished row's content can change after it closed needs its own trigger here,
// or the board shows a stale answer until the operator navigates away.
//
// Extracted from `RunsScreen`, where these 170 lines sat between the store
// selectors and three unrelated sheet targets. None of it renders.
//
// NOT A POLL, four times over. Each trigger is a diff against the PREVIOUS
// frame, so it fires on a real transition and never on an unrelated re-render.
import { useEffect, useRef, useState } from 'react';
import type { RunSummary } from '../../../shared/api';
import { childReclaimDoneRefreshDue, childReclaimRefreshDue } from '../fleet/runWords';
import { childReclaimDoneAtOf } from '../fleet/childReclaimWords';
import type { FleetStore } from '../stores/fleet';
import { api, ApiTimeout } from '../lib/api';

/** THE ONE archive reader (C7n, D-7192): `GET /api/runs?closed=1`, the run board's default and the Inbox's. Hoisted to
 *  module scope, not an inline default-parameter arrow: a default parameter expression is re-evaluated on every
 *  render, so an inline `() => api.runs(true)` would be a fresh identity every time `setCold` fires, and a caller that
 *  keys its effect on that identity tears the effect down and fires it again — forever, on the one path (the shipping
 *  default) no test exercises directly.
 *
 *  `true` (i.e. `?closed=1`), not the bare default: `includeClosed` is the only thing that drops `CoordStore.runs`'s
 *  `WHERE` clause, so it is the only call that can ever return a FINISHED run — the live `{type:'runs'}` frame is
 *  active-only by construction (`watch.ts`'s emitter calls `coord.runs()` with no options), and `api.runs()`'s own
 *  bare default matches it (reconciliation item 5: "a deliberate cold-start bandwidth choice … pass `?closed=1` for
 *  the archive view"). Without this, the board's own "Finished" group could never receive real data on a cold deep
 *  link, and the Inbox could not title a record whose run finished yesterday. */
export const loadColdRuns = (): Promise<{ runs: RunSummary[] }> => api.runs(true);

/** The archive reader: `loadColdRuns`, and every caller's own. */
export type ColdLoader = () => Promise<{ runs: RunSummary[] }>;

export interface ColdRuns {
  /** The archive rows, or `null` for "no answer yet". Read `state` to tell
   *  which kind of no-answer this is. */
  readonly cold: RunSummary[] | null;
  /**
   * Review finding 19: `cold`'s own `null` used to mean BOTH "still loading"
   * and "every attempt has failed" — the same collapse `MailScreen`'s `feed`
   * had, and the one `AccountsScreen`'s `!accounts` branch was written
   * specifically to avoid ("'never asked' reads as 'never landed' to whoever is
   * looking"). A three-state read, so a read failure can render its own honest
   * message instead of falling through to "No runs." — a POSITIVE claim about
   * the program's whole history that a failed read has no standing to make.
   * It is the RE-READ's state: only `loadCold` sets and clears it. A failed older page is `loadOlder`'s own outcome.
   */
  readonly state: 'loading' | 'ok' | 'error';
  /** Whether a re-read is on its way: from the mount, which always reads, until the newest re-read issued settles (chat reading
   *  Task L, D-8062; review 1586 F4). A run leaving the live frame raises it in the very render that shows it gone, before the
   *  effect issues that re-read (review 1597 F2), so an answer read before the run left is never the last word on it. `state`
   *  keeps the last answer meanwhile, so a held `ok` may be about to change. An older page (`loadOlder`) is not a re-read. */
  readonly reading: boolean;
  /** Whether the re-read that left `state` at `error` ran out of time (C1's `ApiTimeout`), the one failure the board words as
   *  "Could not load runs. Try again." (spec §8.2). False in every other state. */
  readonly timedOut: boolean;
  /** Re-read now. The two sheets that close a run call it on `onDone`: the
   *  finished half of the board has no source but this read. */
  readonly reload: () => Promise<void>;
}

export interface ColdRunsOptions {
  /** Re-read on the three transitions below (a run leaving the live slice, a child leaving the fleet frame, a new
   *  reclaim end). Default `true`: the run board's schedule. `false` reads once per mount and never again, the
   *  Inbox's schedule (C7n, D-7209): its programme headers need the titles, not a finished row's reclaim chip. */
  readonly rereadOnTransitions?: boolean;
}

export function useColdRuns(
  store: FleetStore,
  loadRuns: ColdLoader,
  { rereadOnTransitions = true }: ColdRunsOptions = {},
): ColdRuns {
  const live = store((s) => s.runs);
  const runsFrameSeen = store((s) => s.runsFrameSeen);
  const sessions = store((s) => s.sessions);
  const fleetFrameSeen = store((s) => s.fleetFrameSeen);
  const coordFrame = store((s) => s.coord);
  const coordFrameSeen = store((s) => s.coordFrameSeen);

  const [cold, setCold] = useState<RunSummary[] | null>(null);
  const [coldState, setColdState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [reading, setReading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);

  // Held in a ref, not the effect's own dependency array — the same fix
  // `MailScreen` already applies to `loadFeed`: "once per mount" has to hold
  // regardless of the CALLER's identity discipline, not only the hoisted
  // default's. The ref always reads the LATEST `loadRuns` without ever being a
  // reason for the effect to re-run.
  const loadRunsRef = useRef(loadRuns);
  loadRunsRef.current = loadRuns;

  // Never fires a `set*` after this instance has unmounted — shared by the
  // mount-time read below and every transition-triggered re-read.
  //
  // RE-ARMED as the effect's OWN first statement, not left to the `useRef(true)`
  // initialiser alone (I1, regression, measured): React 18 StrictMode (dev
  // only) runs every effect as mount -> cleanup -> mount, on the SAME component
  // instance, so `aliveRef` survives the whole sequence rather than being
  // re-created. With no re-arm, the simulated cleanup's `= false` was never
  // undone by the simulated second mount — `aliveRef.current` stayed `false`
  // for the rest of the component's real life, so every read below silently
  // dropped its own resolution and the board hung on "Loading…" forever under
  // StrictMode. Setting it `true` here, every time the effect body runs, is
  // what makes the ref correct across both.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // THE RACE, AND ITS GUARD (spec §5.9). A reclaim now puts two archive reads in
  // flight a tick or two apart: the vanish read (the child's session leaving the
  // fleet frame) and the board's second trigger (the coord frame's newest reclaim
  // end). Responses can arrive in any order, and this used to apply whichever
  // landed last, so a slow older read overwrote a newer one and the row showed
  // the stale "workspace pending" chip again. Each call takes a sequence number
  // from `issued`; a read may set `cold` only when it is NEWER than the last one
  // applied (`applied`, the high-water mark). The `catch` is held to the same
  // mark, so a rejection from a read older than an applied one cannot set
  // `error` over the newer answer. A rejection does NOT advance the mark: it
  // carries no reading to be newer than, so a newer success still wins over an
  // older error in either arrival order, and an older success still lands its rows
  // after a newer failure (the freshest answer there is), though not its `ok` (below).
  //
  // The newest SETTLED failure holds `state` at `error` and owns `timedOut` (reviews 1606 F2 and 1689 F1; Task C14, D-8110).
  // An older success still lands its ROWS, but clears neither failure signal; an older failure cannot replace `timedOut`.
  // Only a success newer than that failure clears both signals. `failed` is the newest sequence that settled as a failure.
  const issued = useRef(0);
  const applied = useRef(0);
  const failed = useRef(0);
  const loadCold = (): Promise<void> => {
    const seq = ++issued.current;
    setReading(true);
    // The newest re-read issued settling ends the reading, whatever it answered; an older one settling leaves it on its way.
    const settled = (): void => { if (aliveRef.current && seq === issued.current) setReading(false); };
    return loadRunsRef.current()
      .then((r) => {
        // The body is read BEFORE the mark moves: a success whose body cannot be
        // read (a `null` answer) throws here, reaches the `catch` below as an
        // error for this same `seq`, and so cannot advance the mark first.
        const rows = r.runs;
        if (!aliveRef.current || seq <= applied.current) return;
        applied.current = seq;
        setCold(rows);
        if (seq > failed.current) {
          setColdState('ok');
          setTimedOut(false);
        }
      })
      // A failed read changes its failure signals: the rows stay (never a fold to empty).
      .catch((e: unknown) => {
        if (!aliveRef.current || seq <= applied.current) return;
        const newest = seq >= failed.current;
        failed.current = Math.max(failed.current, seq);
        setColdState('error');
        if (newest) setTimedOut(e instanceof ApiTimeout);
      })
      .finally(settled);
  };

  useEffect(() => {
    // UNCONDITIONAL — the earlier gate (`if (store.getState().runs.length > 0)
    // return`) meant this only ever ran when the live slice was already empty,
    // so on the ordinary door path (FleetScreen -> here, with at least one
    // active run) the cold read — the ONLY carrier of a finished run — was never
    // issued at all, and the Finished group stayed unreachable forever (fix
    // round 1, task 5, finding 1). `?closed=1` returns active AND finished rows,
    // but only its FINISHED half is ever read by the board; the active half
    // never races `live` for the same answer because the two feed separate
    // slices, not one.
    void loadCold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Review finding 22: a run that closes while the screen is already open must
  // not simply vanish. The live frame is active-only BY CONSTRUCTION — it can
  // never itself carry the now-closed row — so the only way `finished` learns
  // about it is a fresh archive read, fired exactly when a run id that WAS in
  // the live active set stops being there (a close, or a run leaving this box's
  // view some other way).
  const prevLiveIdsRef = useRef<Set<number> | null>(null);
  // The same vanish, seen DURING the render that brings it (review 1597 F2): the re-read below is issued only in the effect,
  // after that render commits, so `reading` is raised here first, by React's own "adjust state when a value changes" form.
  // No render shows a held answer as the last word on a run that has just left the frame. The live rows last rendered are
  // kept as state, under the same conditions as the effect's ref: a frame seen, a schedule that re-reads.
  const [renderedLive, setRenderedLive] = useState<RunSummary[] | null>(null);
  if (rereadOnTransitions && runsFrameSeen && live !== renderedLive) {
    setRenderedLive(live);
    if (renderedLive !== null) {
      const ids = new Set(live.map((r) => r.id));
      if (renderedLive.some((r) => !ids.has(r.id))) setReading(true);
    }
  }
  useEffect(() => {
    if (!runsFrameSeen) return;
    const ids = new Set(live.map((r) => r.id));
    const prev = prevLiveIdsRef.current;
    if (prev !== null) {
      let vanished = false;
      for (const id of prev) if (!ids.has(id)) { vanished = true; break; }
      if (vanished && rereadOnTransitions) void loadCold();
    }
    prevLiveIdsRef.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, runsFrameSeen]);

  // Child-reclamation wave 5 (spec §5.9): a finished row's reclaim chip changes
  // AFTER its run closed (pending → reclaimed), and `finished` has one source,
  // this read. A reclaim purges the child's registry row, so its session leaves
  // the next fleet frame. That vanish is the trigger: a diff against the
  // PREVIOUS fleet frame, exactly like the run-id diff above. The decision is
  // `childReclaimRefreshDue`'s. The dependencies are the fleet frame's,
  // deliberately: a cold read landing is not a transition of the fleet, and
  // re-running on it would compare a frame with itself. A re-read changes
  // `cold`, never `sessions`, so it cannot loop.
  const prevSessionIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!fleetFrameSeen) return;
    const ids = new Set(sessions.map((s) => s.id));
    const prev = prevSessionIdsRef.current;
    prevSessionIdsRef.current = ids;
    if (rereadOnTransitions && prev !== null && childReclaimRefreshDue(cold ?? [], prev, ids)) void loadCold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, fleetFrameSeen]);

  // Child-reclamation wave 6 (spec §5.9): the SECOND trigger. ccd purges a
  // reclaimed child's registry row before it journals the reclaim's end, and the
  // server's journal mirror is never awaited, so the vanish read above usually
  // lands first and the row comes back with no chip. The coord frame carries the
  // newest reclaim end the mirror has committed. When THAT changes, and a
  // finished row is still unsettled, the board reads its archive once. A null (a
  // restarted server, or one older than the field) is never a reason to read,
  // and the first value this board sees is its baseline, not a change.
  //
  // Which runs had a child is the server's to say (`RunSummary.hadChild`, D-8068),
  // so a board reloaded after the child left reads the same as one that saw it.
  // `undefined` = no coord frame seen yet by this board; null = seen, no value.
  const prevDoneAtRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!coordFrameSeen) return;
    const after = childReclaimDoneAtOf(coordFrame);
    const before = prevDoneAtRef.current;
    prevDoneAtRef.current = after;
    if (rereadOnTransitions && before !== undefined && childReclaimDoneRefreshDue(cold ?? [], before, after)) {
      void loadCold();
    }
    // The coord frame's dependencies only, as wave 5's effect takes the fleet
    // frame's: a cold read landing is not a change of the value, and a re-read
    // changes `cold`, never `coordFrame`, so it cannot loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordFrame, coordFrameSeen]);

  return { cold, state: coldState, timedOut: coldState === 'error' && timedOut, reading, reload: loadCold };
}
