// The run board. `/accounts`'s anatomy, run over a different list: route regex,
// the data-view OR, the detail slot, a back control at the tap floor, one door.
//
// TWO sources, TWO DIFFERENT HALVES — never one switched for the other (fix
// round 1, task 5, findings 1 and 3). The live `{type:'runs'}` frame
// (`/ws/fleet`) is ACTIVE-ONLY by construction: `watch.ts`'s `emitRuns` calls
// `coord.runs()` with no options, and `CoordStore.runs()` defaults to
// `WHERE state NOT IN ('done','failed')`. It can never carry a finished run,
// so it is trusted for the ACTIVE half only — the instant it has said
// anything at all, including an honestly empty `[]` (`runsFrameSeen`,
// `stores/fleet.ts`), because an empty array from a frame that DID arrive is
// a true empty roster, not silence.
//
// `GET /api/runs?closed=1` (`api.runs(true)`) is the COLD read: a deep link
// straight to /runs, a server too old to send the frame at all — AND, always,
// the only possible source of the FINISHED half, because `includeClosed` is
// the only thing that drops that `WHERE` clause. It is issued UNCONDITIONALLY
// on every mount (never gated on whether a live frame has already answered —
// that gate is exactly what starved the Finished group the moment anything
// was active) and it never races the live frame for the active half, because
// the two are never merged into one slice: `finished` reads ONLY the cold
// result, `active` reads `live` once `runsFrameSeen` is true and falls back to
// the cold result's own active-filtered rows only before that (the cold-start
// / old-server case). Polling would be a fourth cadence for data that changes
// on human timescales; this reads it once and lets the socket carry updates.
//
// RunSummary's SHIPPED shape (`shared/api.ts`, PR I) diverges from the plan's
// illustrative one on several points — no `waves` (it's `waveOf`), no
// `holdReason` at all (never rides the wire — the reason string this file's
// sibling docs keep citing, registry.ts:27, belongs to `FleetSession.held`,
// a DIFFERENT type), and `items` carries only `{done,total}` — no
// `failed`/`blocked` columns exist anywhere yet. This file renders exactly
// what PR I actually shipped, not the plan's historical sample.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { type FleetSession, type RunSummary, unmeasuredFields } from '../../../shared/api';
import { RUN_GLYPH, RUN_WORD, programWave, runClosedAt, runItems, runState, runsByProgram } from '../fleet/runWords';
import { formatAge } from '../fleet/formatReset';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { useNow } from '../lib/useNow';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import '../fleet/fleet.css';

/** Hoisted to module scope, not an inline default-parameter arrow — the exact
 *  defect `MailScreen`'s `loadFeedDefault` already fixed once (see that
 *  file's own comment, and the commit that fixed it: a default parameter
 *  expression is re-evaluated on every render, so an inline
 *  `() => api.runs(true)` would be a fresh identity every time `setCold`
 *  fires below, and a caller that keys its effect on that identity tears the
 *  effect down and fires it again — forever, on the one path (the shipping
 *  default) no test here ever exercises directly.
 *
 *  `true` (i.e. `?closed=1`), not the bare default: `includeClosed` is the
 *  only thing that drops `CoordStore.runs`'s `WHERE` clause, so it is the
 *  only call that can ever return a FINISHED run — the live `{type:'runs'}`
 *  frame is active-only by construction (`watch.ts`'s emitter calls
 *  `coord.runs()` with no options), and `api.runs()`'s own bare default
 *  matches it (reconciliation item 5: "a deliberate cold-start bandwidth
 *  choice … pass `?closed=1` for the archive view"). Without this, the
 *  board's own "Finished" group could never receive real data on a cold
 *  deep link — only ever from a test poking the store directly. */
const loadRunsDefault = (): Promise<{ runs: RunSummary[] }> => api.runs(true);

function RunRow({
  run,
  nowSec,
  session,
}: {
  run: RunSummary;
  nowSec: number;
  /** The run's session, as the live fleet snapshot currently has it — or
   *  `null` when there is none (no session, or the fleet frame hasn't named
   *  it yet). Looked up by the caller so this component stays a pure
   *  renderer of the one row it owns. */
  session: FleetSession | null;
}): ReactNode {
  // The registry ladder's degrade note, same idiom as `SessionLine.tsx`'s own
  // (`.sess-unmeasured`, reused verbatim rather than a second `.run-…` class
  // for the identical meaning): this row's session could not be fully
  // measured its last pass, so fields the fleet screen shows for it may be
  // frozen at a fallback. `unmeasuredFields`, never `session.unmeasured`
  // directly, for the same reason `SessionLine.tsx` gives — a live frame can
  // omit the key entirely at runtime even though the type says required.
  const degradedFields = session === null ? [] : unmeasuredFields(session);
  // Total lookup, never a raw index (finding 2): `state` degrades a token
  // this build's vocabulary has no key for to the designated `unknown`
  // member, and `items` defaults a row that reached this renderer without
  // one rather than throwing mid-render.
  const state = runState(run);
  const items = runItems(run);
  const body = (
    <>
      <span className="run-glyph" aria-hidden="true">{RUN_GLYPH[state]}</span>
      <span className="run-state">{RUN_WORD[state]}</span>
      <span className="run-ws">{run.workspace ?? run.branch ?? String(run.id)}</span>
      <span className="run-tally">{items.done}/{items.total}</span>
      <span className="run-when">
        {run.dispatchedAt === null ? '—' : formatAge(nowSec - Math.floor(run.dispatchedAt / 1000))}
      </span>
      {degradedFields.length > 0 && (
        <span
          className="sess-unmeasured"
          data-unmeasured="true"
          title={`registry ${degradedFields.join('/')} temporarily unreadable — retrying`}
        >
          unreadable
        </span>
      )}
    </>
  );
  // A run with no session has nothing to open. An inert row says that; a
  // button that navigates to a session that does not exist says something
  // false.
  return run.sessionId === null
    ? <li className="run-row" data-inert="true">{body}</li>
    : (
      <li className="run-row">
        <button type="button" className="run-open" onClick={() => navigate(`/s/${encodeURIComponent(run.sessionId!)}`)}>
          {body}
        </button>
      </li>
    );
}

export function RunsScreen({
  store = useFleetStore,
  loadRuns = loadRunsDefault,
}: {
  store?: FleetStore;
  loadRuns?: () => Promise<{ runs: RunSummary[] }>;
}): ReactNode {
  const live = store((s) => s.runs);
  const runsFrameSeen = store((s) => s.runsFrameSeen);
  const sessions = store((s) => s.sessions);
  const [cold, setCold] = useState<RunSummary[] | null>(null);
  const now = useNow(30_000);
  const nowSec = Math.floor(now / 1000);

  // Held in a ref, not the effect's own dependency array — the same fix
  // `MailScreen` already applies to `loadFeed`: "once per mount" has to hold
  // regardless of the CALLER's identity discipline, not only the hoisted
  // default's. The ref always reads the LATEST `loadRuns` without ever being
  // a reason for the effect to re-run.
  const loadRunsRef = useRef(loadRuns);
  loadRunsRef.current = loadRuns;

  useEffect(() => {
    // UNCONDITIONAL — the earlier gate (`if (store.getState().runs.length >
    // 0) return`) meant this only ever ran when the live slice was already
    // empty, so on the ordinary door path (FleetScreen -> here, with at
    // least one active run) the cold read — the ONLY carrier of a finished
    // run — was never issued at all, and the Finished group stayed
    // unreachable forever (fix round 1, task 5, finding 1). `?closed=1`
    // returns active AND finished rows, but only its FINISHED half is ever
    // read below; the active half never races `live` for the same answer
    // because the two feed separate slices, not one.
    let alive = true;
    void loadRunsRef.current().then((r) => { if (alive) setCold(r.runs); }).catch(() => {});
    return () => { alive = false; };
  }, [store]);

  const sessionById = new Map(sessions.map((s) => [s.id, s] as const));
  // ACTIVE reads `live` the instant the socket has said anything at all
  // (`runsFrameSeen`) — including an honest `[]`, which is what a run
  // closing broadcasts. Falling back to `live.length > 0 ? live : cold`
  // instead (the pre-fix shape) could not tell "nothing is active" apart
  // from "no frame has arrived yet", so the moment a run closed and the live
  // frame correctly said `[]`, the board fell back to `cold` — a snapshot
  // frozen at mount — and kept rendering the closed run as active
  // indefinitely (finding 3, failure A). Before any frame has ever landed
  // (a cold deep link, or a server too old to send the frame), `cold`'s own
  // active-filtered rows are the best available answer.
  const active = (runsFrameSeen ? live : cold ?? live)
    .filter((r) => runClosedAt(r) === null);
  // FINISHED reads ONLY `cold` — never `live`, which cannot carry a closed
  // run by construction (see the file header). Reading it from the same
  // `runs` slice `active` used (the pre-fix shape) meant the Finished group
  // vanished the instant anything went active, because `live` winning that
  // switch discarded whatever `cold` had found (finding 3, failure B).
  const finished = (cold ?? [])
    .filter((r) => runClosedAt(r) !== null)
    .sort((a, b) => (runClosedAt(b) ?? 0) - (runClosedAt(a) ?? 0));
  const hasAny = active.length > 0 || finished.length > 0;

  const rowFor = (run: RunSummary): ReactNode => (
    <RunRow
      key={run.id}
      run={run}
      nowSec={nowSec}
      session={run.sessionId === null ? null : sessionById.get(run.sessionId) ?? null}
    />
  );

  return (
    <div className="runs-screen">
      <header className="runs-head">
        <button type="button" className="runs-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </button>
        <h1 className="runs-title">Runs</h1>
      </header>

      {!hasAny ? (
        <p className="runs-empty">No runs. A program starts when a coordinator opens one.</p>
      ) : (
        <>
          {runsByProgram(active).map(({ program, runs: list }) => {
            // The program's OWN wave is the furthest one any of its rows has
            // reached, never `list[0]`'s own — `runsByProgram` orders each
            // group urgency-first, so the head row can be an older wave
            // stuck in review while a newer wave is already dispatched
            // beneath it (finding 4).
            const { wave, waveOf } = programWave(list);
            // `role="group"`, NOT `<section aria-label>`: seven named regions
            // holding nothing turn the landmark rotor into dead ends
            // (FleetScreen.tsx:288-294). The same reasoning, one screen over.
            return (
              <div key={program} className="runs-group" role="group" aria-label={`program ${program}`}>
                <p className="runs-group-head">
                  <span className="runs-program">{program}</span>
                  <span className="runs-wave">wave {wave}{waveOf === null ? '' : `/${waveOf}`}</span>
                </p>
                <ul className="runs-list">
                  {list.map(rowFor)}
                </ul>
              </div>
            );
          })}

          {finished.length > 0 && (
            <div className="runs-group" role="group" aria-label={`finished (${finished.length})`}>
              <p className="runs-group-head"><span className="runs-program">Finished</span></p>
              <ul className="runs-list">
                {finished.map(rowFor)}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
