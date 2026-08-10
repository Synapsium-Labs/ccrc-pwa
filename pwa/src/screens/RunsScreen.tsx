// The run board. `/accounts`'s anatomy, run over a different list: route regex,
// the data-view OR, the detail slot, a back control at the tap floor, one door.
//
// Live data rides the `{type:'runs'}` frame on /ws/fleet — additive, dropped
// silently by any client that predates it, and it inherits the socket's
// reconnect/backoff for free. `GET /api/runs` is the COLD start only: a deep
// link straight to /runs, and a server too old to send the frame. Polling it
// would be a fourth cadence for data that changes on human timescales.
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
import { RUN_GLYPH, RUN_WORD, runsByProgram } from '../fleet/runWords';
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
  const body = (
    <>
      <span className="run-glyph" aria-hidden="true">{RUN_GLYPH[run.state]}</span>
      <span className="run-state">{RUN_WORD[run.state]}</span>
      <span className="run-ws">{run.workspace ?? run.branch ?? String(run.id)}</span>
      <span className="run-tally">{run.items.done}/{run.items.total}</span>
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
    // Only when the frame has said nothing at all. An empty `runs` from a
    // server that DID send the frame is a true empty board, and re-asking would
    // make a cold read race a live one for the same answer.
    if (store.getState().runs.length > 0) return;
    let alive = true;
    void loadRunsRef.current().then((r) => { if (alive) setCold(r.runs); }).catch(() => {});
    return () => { alive = false; };
  }, [store]);

  const runs = live.length > 0 ? live : cold ?? [];
  const sessionById = new Map(sessions.map((s) => [s.id, s] as const));
  const active = runs.filter((r) => r.closedAt === null);
  const finished = runs.filter((r) => r.closedAt !== null)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));

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

      {runs.length === 0 ? (
        <p className="runs-empty">No runs. A program starts when a coordinator opens one.</p>
      ) : (
        <>
          {runsByProgram(active).map(({ program, runs: list }) => {
            const head = list[0]!;
            // `role="group"`, NOT `<section aria-label>`: seven named regions
            // holding nothing turn the landmark rotor into dead ends
            // (FleetScreen.tsx:288-294). The same reasoning, one screen over.
            return (
              <div key={program} className="runs-group" role="group" aria-label={`program ${program}`}>
                <p className="runs-group-head">
                  <span className="runs-program">{program}</span>
                  <span className="runs-wave">wave {head.wave}{head.waveOf === null ? '' : `/${head.waveOf}`}</span>
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
