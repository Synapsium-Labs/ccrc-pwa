// The run board. `/accounts`'s anatomy, run over a different list: route regex,
// the data-view OR, the detail slot, a back control at the tap floor, one door.
//
// TWO sources, TWO DIFFERENT HALVES — never one switched for the other (fix
// round 1, task 5, findings 1 and 3). The live `{type:'runs'}` frame
// (`/ws/fleet`) is ACTIVE-ONLY by construction: `watch.ts`'s `emitRuns` calls
// `coord.runs()` with no options, and `CoordStore.runs()` defaults to
// excluding `TERMINAL_RUN_STATES` (`shared/api.ts`'s `done`/`failed` pair). It
// can never carry a finished run, so it is trusted for the ACTIVE half only —
// the instant it has said anything at all, including an honestly empty `[]`
// (`runsFrameSeen`,
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
// sibling docs keep citing, registry.ts:28, belongs to `FleetSession.held`,
// a DIFFERENT type), and `items` carries only `{done,total}` — no
// `failed`/`blocked` columns exist anywhere yet. This file renders exactly
// what PR I actually shipped, not the plan's historical sample.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { type CoordCapsView, type RunSummary } from '../../../shared/api';
import {
  anyDispatchPending, isRunClosed, programWave, programsWithOpenRun, runClosedAt,
  runsByProgram, waveLabel,
} from '../fleet/runWords';
import { AbandonSheet, abandonChildOf } from '../fleet/AbandonSheet';
import { CoordBanner } from '../fleet/CoordBanner';
import { ChildReclaimBanner } from '../fleet/ChildReclaimBanner';
import { CapsControl } from '../fleet/CapsControl';
import { ResumeSheet } from '../fleet/ResumeSheet';
import { StartProgramSheet } from '../fleet/StartProgramSheet';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { BackButton, Button, useNow } from '@ccrc/ui';
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

/** The caps dial's default reader, module-scope beside `loadRunsDefault` and
 *  for the same reason: a stable identity rather than a fresh closure per
 *  render, so the control's own effect does not re-fire on every parent
 *  re-render. */
const loadCapsDefault = (): Promise<CoordCapsView> => api.coordCaps();

import { RunRow } from './RunRow';
import { useColdRuns } from './useColdRuns';


export function RunsScreen({
  store = useFleetStore,
  loadRuns = loadRunsDefault,
  loadCaps = loadCapsDefault,
}: {
  store?: FleetStore;
  loadRuns?: () => Promise<{ runs: RunSummary[] }>;
  /** The caps dial's own read, injected HERE rather than left to
   *  `CapsControl`'s default, for the reason `loadRuns` is: every loader this
   *  screen sets going on mount is one a test must be able to hold, and a
   *  component that reaches for the global `fetch` from inside the tree puts a
   *  request into every test that renders the board. Measured — it broke the
   *  resume-door test's `expect(fetchImpl).not.toHaveBeenCalled()`, which is a
   *  guard worth keeping exactly as strict as it was. */
  loadCaps?: () => Promise<CoordCapsView>;
}): ReactNode {
  const live = store((s) => s.runs);
  const runsFrameSeen = store((s) => s.runsFrameSeen);
  const sessions = store((s) => s.sessions);
  const fleetFrameSeen = store((s) => s.fleetFrameSeen);
  const conn = store((s) => s.conn);
  // Task 12, spec §4.3: which run's AbandonSheet is open, or `null`. ONE
  // sheet at screen level, reused across rows — the same shape
  // `SessionActionsSheet`'s single actions sheet uses rather than mounting
  // one sheet per row.
  const [abandonTarget, setAbandonTarget] = useState<RunSummary | null>(null);

  // Spec §7.3: which run's ResumeSheet is open, or `null`. ONE sheet at screen
  // level, reused across rows — `abandonTarget`'s own shape, one line up.
  const [resumeTarget, setResumeTarget] = useState<RunSummary | null>(null);

  // Task 13, spec §4.4: the run board's own door onto a new program. ONE
  // door, rendered unconditionally below — including at zero runs, the same
  // "renders at zero runs too" rule `.fleet-runs-row` already holds one
  // screen over.
  const [startOpen, setStartOpen] = useState(false);

  // The archive read — the only carrier of a finished run — with its race
  // guard and the four transitions that re-fire it: `useColdRuns`. 170 lines,
  // none of which rendered anything.
  const { cold, state: coldState, reload: loadCold } = useColdRuns(store, loadRuns);

  const sessionById = new Map(sessions.map((s) => [s.id, s] as const));
  // CCR-15 wave 5 (spec §5.7): the abandon sheet's confirm line branches on the
  // run's workspace's child mark, read off the fleet row this board already looks up.
  const abandonSession = abandonTarget === null || abandonTarget.sessionId === null
    ? undefined : sessionById.get(abandonTarget.sessionId);
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
  //
  // `isRunClosed` (state), never `runClosedAt` (fix, review findings 3/22):
  // `closedAt` is written by exactly one path outside `reconstruct`, and
  // `reconstruct` — the disaster-recovery rebuild — never writes it at all
  // (pinned by `reconstruction-drill.test.ts` as one of the twelve facts the
  // drill cannot recover). A rebuilt program's finished waves carry
  // `state:'done'`/`'failed'` with `closedAt:null` forever; splitting on
  // `closedAt` filed those rows in NEITHER group the instant a live frame
  // excluded them by state, or in BOTH depending on which slice happened to
  // answer first. `state` is the same line `CoordStore.runs()` itself draws.
  const active = (runsFrameSeen ? live : cold ?? live)
    .filter((r) => !isRunClosed(r));
  // The tick, and it is deliberately declared HERE rather than up with the
  // other hooks: it reads `active`, which is the list it has to describe.
  //
  // MILLISECONDS all the way to the row, which derives its own seconds for
  // `formatAge`. The dispatch window's boundary is `SPAWN_STALL_MS`, a
  // millisecond constant, and flooring here first would make it unmeasurable
  // by up to 999 of them (`runs-screen.test.tsx`'s `FROZEN` carries a
  // sub-second remainder so that claim is held by a red suite, not by this
  // comment).
  //
  // The CADENCE follows the content, the idiom `SessionHeader`
  // (`working ? 1_000 : 30_000`) and `ToolCard` (`useNow(1_000, running)`)
  // already use. 30 s was right while every readout on this board was
  // minute-granular; the dispatch window is not — it renders `formatElapsed`
  // to the second and flips phase on a millisecond threshold, so at 30 s the
  // operator watched `⟳ dispatching… 0:12` hold still for half a minute and
  // then jump to `0:42`, and the wedge landed up to 30 s after the runner had
  // certainly given up. §Design's own complaint about the state this build
  // fixes is "a board that never moves"; rendering a clock the tick cannot
  // honour would have kept it.
  //
  // `anyDispatchPending` and not an inline condition, because the answer must
  // stay `dispatchWindow`'s alone — and it can be asked before a tick exists
  // (that half of the answer is clock-independent; the helper's docstring has
  // the reasoning). `finished` is not consulted: it holds closed runs by
  // construction, and `dispatchWindow` answers `none` for every closed state.
  const now = useNow(anyDispatchPending(active) ? 1_000 : 30_000);
  // FINISHED reads ONLY `cold` — never `live`, which cannot carry a closed
  // run by construction (see the file header). Reading it from the same
  // `runs` slice `active` used (the pre-fix shape) meant the Finished group
  // vanished the instant anything went active, because `live` winning that
  // switch discarded whatever `cold` had found (finding 3, failure B).
  const finished = (cold ?? [])
    .filter((r) => isRunClosed(r))
    .sort((a, b) => (runClosedAt(b) ?? 0) - (runClosedAt(a) ?? 0));
  // Review finding 19: neither half is trustworthy enough to assert "there
  // are none of these" until IT has a real answer — `runsFrameSeen` for
  // active, `coldState === 'ok'` for finished (finished has no other
  // source). When NEITHER has ever answered, this screen knows nothing at
  // all, and must say so rather than rendering the ordinary empty state.
  const noSignalYet = !runsFrameSeen && coldState !== 'ok';
  // The board's own answer to "does this project already have a program
  // running?", handed to the sheet rather than fetched by it — the sheet's
  // composition is pinned at exactly two network calls
  // (`start-program.test.tsx`'s `expect(urls).toHaveLength(2)`).
  //
  // THREE-STATE, and `noSignalYet` is the third. Before either signal has
  // answered, `new Set()` would tell the sheet this board had measured an empty
  // world; `null` says it has measured nothing, which is what is true. Both of
  // the paths that reach it (a cold deep link, a server too old to send the
  // frame — the two `active`'s own comment above names) resolve to a measured
  // set the moment `api.runs(true)` returns, so this is a window and not a dead
  // end.
  //
  // Built from `active`, which is already `!isRunClosed`-filtered: a project
  // whose only run is `done` is not carrying a coordinator any more.
  const openRunProjects: ReadonlySet<string> | null =
    noSignalYet ? null : new Set(active.map((r) => r.project));
  // D-1146: the programs this board measures as still having a run that can
  // move — the resume door's PROGRAM-level half, derived once here rather than
  // re-asked per row. Deliberately a second, separate set from
  // `openRunProjects` above: that one is keyed by PROJECT and answers the
  // start-program sheet's "is this project already carrying a program?", this
  // one is keyed by PROGRAM and answers "is there still a wave to hang the
  // door on?" — two questions over one list that stop agreeing the moment one
  // project carries two programs.
  //
  // Built from `active`, and an EMPTY answer here is a measured empty rather
  // than silence in every window this board passes through — which is the
  // whole condition D-1146 turns on. A terminal row can only reach the screen
  // through the cold read (`finished` has no other source), and the cold read
  // is `?closed=1`, which carries the ACTIVE half too. So whenever there is a
  // finished row on screen to ask this about, `active` is either the live
  // frame's fleet-wide answer (`runsFrameSeen`) or that same cold read's own
  // active rows — never the not-yet-answered `null` window, which renders no
  // rows at all (`noSignalYet`, below). And the archive clamp cannot fake the
  // condition either: `CoordStore.runs`'s `closedLimit` is ASYMMETRIC BY
  // DESIGN (review finding 24) — it caps the newest closed rows and drops no
  // active run at any age, so a truncated cold read can lose an archive row
  // this door would have appeared on, never the open row whose presence
  // WITHHOLDS it.
  const programsOpen = programsWithOpenRun(active);
  const hasAny = active.length > 0 || finished.length > 0;
  // I6 (residual): `coldState === 'error'` is a fact about the FINISHED half
  // specifically — `active` can be fully answered by the live frame alone
  // (`runsFrameSeen`) even while the cold read that is `finished`'s only
  // source has failed outright. Before this, a failed cold read with
  // `runsFrameSeen` already true skipped `noSignalYet` entirely (that guard
  // reads `!runsFrameSeen`, and it IS seen) and fell straight through to
  // `!hasAny`'s ordinary "No runs." the moment no run was active either — a
  // POSITIVE claim about the program's whole history a failed archive read
  // has no standing to make, the exact thing `noSignalYet`'s own comment
  // above already refuses to do for the "never asked yet" case. Read below
  // for the second half: active rows present, finished's own read failed.
  const coldFailed = coldState === 'error';

  const rowFor = (run: RunSummary): ReactNode => (
    <RunRow
      key={run.id}
      run={run}
      nowMs={now}
      session={run.sessionId === null ? null : sessionById.get(run.sessionId) ?? null}
      coordSession={run.claimedBy === null ? null : sessionById.get(run.claimedBy) ?? null}
      frameSeen={fleetFrameSeen}
      programHasOpenRun={programsOpen.has(run.program)}
      onAbandon={setAbandonTarget}
      onResume={setResumeTarget}
    />
  );

  return (
    <div className="runs-screen" data-conn={conn}>
      <header className="runs-head">
        <BackButton className="runs-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </BackButton>
        <h1 className="runs-title">Runs</h1>
      </header>

      {/* Review finding 26: `runs`/`runsFrameSeen` are sticky across a socket
          loss (`stores/fleet.ts`, "sticky until replaced") — without this,
          the board keeps rendering ages that tick upward with nothing on
          screen saying the socket is down. Text, not an opacity fade —
          `fleet.css`'s own note by `.fleet-list` documents, with contrast
          numbers, why that idiom was tried here first and removed. */}
      {conn === 'down' && (
        <div className="offline-banner" role="status">
          Reconnecting…
        </div>
      )}

      {/* Task 11, spec §4.2: the coordination surface's own pause readout —
          `/runs` and nowhere else (FleetScreen never mounts this). Renders
          nothing until the first `{type:'coord'}` frame has arrived
          (`CoordBanner`'s own `coordFrameSeen` gate). */}
      <CoordBanner store={store} />

      {/* Child-reclamation wave 4 (spec §5.8, §5.9): the reclaim switch and the
          attention list, one row under the pause banner — `/runs` and nowhere
          else, rendering nothing until a coord frame that carries the field. */}
      <ChildReclaimBanner store={store} />

      {/* Wave 6, spec §8: the operator's dial on the two coordination caps,
          beside the pause control and on `/runs` alone. Renders nothing until
          its own read lands — and nothing at all on a box with no coordination
          database, where the caps do not exist to be shown. */}
      <CapsControl coordCaps={loadCaps} />

      {/* Task 13, spec §4.4: ONE door, rendered here regardless of the
          board's own state below — a program starts before any run exists
          to show. */}
      <Button variant="quiet" size="fit" className="program-start-door text-xs" onClick={() => setStartOpen(true)}>
        Start a program
      </Button>

      {noSignalYet ? (
        // Review finding 19: neither source has answered yet, so this is not
        // "no runs" — it is "no answer". `coldState === 'error'` only after
        // the cold read has actually failed; until then this is the ordinary
        // in-flight window every mount passes through.
        <p className="runs-empty" data-state={coldState === 'error' ? 'error' : 'loading'}>
          {coldState === 'error'
            ? 'Could not reach the server — runs may exist that are not shown.'
            : 'Loading…'}
        </p>
      ) : !hasAny ? (
        // I6: `noSignalYet` above only covers the "nothing has answered at
        // all" window — once the live frame has said `runsFrameSeen`, this
        // arm is reached even with `active` honestly empty AND the cold
        // read (finished's only source) having FAILED. That is not "No
        // runs" either: it is "no active runs, and the archive could not be
        // read", which must say so rather than claim the program's whole
        // history is empty.
        coldFailed ? (
          <p className="runs-empty" data-state="error">
            Could not reach the server — runs may exist that are not shown.
          </p>
        ) : (
          <p className="runs-empty" data-state="ok">No runs. A program starts when a coordinator opens one.</p>
        )
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
                  <span className="runs-wave">{waveLabel({ wave, waveOf })}</span>
                </p>
                <ul className="runs-list">
                  {list.map(rowFor)}
                </ul>
              </div>
            );
          })}

          {finished.length > 0 ? (
            <div className="runs-group" role="group" aria-label={`finished (${finished.length})`}>
              <p className="runs-group-head"><span className="runs-program">Finished</span></p>
              <ul className="runs-list">
                {finished.map(rowFor)}
              </ul>
            </div>
          ) : coldFailed ? (
            // I6, second half: at least one run is active (this branch is
            // only reached via `hasAny`), so the board is not empty — but
            // `finished` is empty ONLY because its one source, the cold
            // read, failed, never because the archive is honestly empty
            // (`coldState==='ok'` with zero rows renders nothing here, on
            // purpose — that IS an answered, empty Finished group). Silently
            // omitting the whole group here reads as "nothing has ever
            // finished", which the board has no standing to claim.
            <div className="runs-group" role="group" aria-label="finished, unknown">
              <p className="runs-group-head"><span className="runs-program">Finished</span></p>
              <p className="runs-empty" data-state="error">
                Could not reach the server — finished runs may exist that are not shown.
              </p>
            </div>
          ) : null}
        </>
      )}

      {/* Task 12, spec §4.3: `onDone` re-runs the screen's own `loadCold()`
          (Step 5) so an abandoned run moves into Finished — the live frame's
          own vanish-diff (above) also fires for the same close, and both
          landing is harmless because they feed separate slices (`active`
          from `live`, `finished` from `cold`, never merged). */}
      <AbandonSheet run={abandonTarget} workspaceChild={abandonChildOf(abandonSession)}
        onClose={() => setAbandonTarget(null)} onDone={() => { void loadCold(); }} />
      {/* Spec §7.3: `onDone` re-runs `loadCold()` for the same reason the
          abandon sheet's does — a reclaim rewrites `claimedBy` on EVERY run of
          the program, terminal ones included (contract R1), and the finished
          half of this board has no source but the cold read. */}
      <ResumeSheet run={resumeTarget} onClose={() => setResumeTarget(null)} onDone={() => { void loadCold(); }} />
      <StartProgramSheet open={startOpen} onClose={() => setStartOpen(false)} fleet={store}
        openRunProjects={openRunProjects} />
    </div>
  );
}
