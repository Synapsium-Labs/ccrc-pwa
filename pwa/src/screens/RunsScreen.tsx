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
import { DISPATCH_GLYPH, RUN_GLYPH, RUN_WORD, anyDispatchPending, dispatchWindow, isRunClosed, itemTallyLabel, programWave, resumeNote, runClosedAt, runItems, runState, runsByProgram } from '../fleet/runWords';
import { spawnVerdictChip } from '../fleet/spawnWords';
import { AbandonSheet } from '../fleet/AbandonSheet';
import { CoordBanner } from '../fleet/CoordBanner';
import { StartProgramSheet } from '../fleet/StartProgramSheet';
import { formatAge, formatElapsed } from '../fleet/formatReset';
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
  nowMs,
  session,
  onAbandon,
}: {
  run: RunSummary;
  /** The shared tick, in MILLISECONDS (Task 3). The row derives its own
   *  `nowSec` below; it does not receive one. The dispatch window's boundary
   *  is `SPAWN_STALL_MS` — a millisecond constant — so a tick already floored
   *  to seconds upstream could not state which side of it a row is on, by up
   *  to 999 ms — which is a claim a red suite holds, not this comment: the
   *  suite's `FROZEN` carries a sub-second remainder precisely so flooring
   *  here reds. One clock, in the unit every wire timestamp already uses. */
  nowMs: number;
  /** The run's session, as the live fleet snapshot currently has it — or
   *  `null` when there is none (no session, or the fleet frame hasn't named
   *  it yet). Looked up by the caller so this component stays a pure
   *  renderer of the one row it owns. */
  session: FleetSession | null;
  /** Opens the AbandonSheet for this row (Task 12, spec §4.3, D-287 (was D-B4-14)). */
  onAbandon: (run: RunSummary) => void;
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
  const nowSec = Math.floor(nowMs / 1000);
  // Task 3, the dispatch window. The DECISION is `dispatchWindow`'s (three
  // conditions, one place); this component only picks the words. `none` is
  // both "no fresh-spawn dispatch has started" and "the run has moved off
  // `planned`" — either way there is no spawn to narrate, and the row renders
  // byte-identically to how it read before the column existed, which is the
  // no-regression half of this branch.
  const spawn = dispatchWindow(run, nowMs);
  // Task 5, both of them facts this board already held and did not read.
  //
  // The spawn verdict comes off the SESSION this row links to — the same
  // `FleetSession` the degrade note above is read from — through the one table
  // (`spawnWords.ts`), which is where it moved when this became its second
  // surface. A row with no session says nothing: there is no pane to have a
  // last spawn.
  //
  // `spawnVerdictChip`, NOT `spawnChip`: the two are one arm apart and the
  // board asks the narrower one BY NAME, never by re-deriving a condition here.
  // The wider one adds `unstarted` for a session that recorded no verdict — a
  // word §Design opens by complaining about, which on this surface would be
  // reporting an UNREADABLE `.started` as a claim that was never made (the full
  // argument, with the ccd and registry anchors, is on `spawnChip`'s docstring;
  // both halves are pinned in `runs-screen.test.tsx`).
  //
  // The resume is the run's OWN fact and has ridden `RunSummary` since Build 4
  // with nothing in `pwa/src` ever rendering it. `resumeNote` decides; this
  // picks no words.
  const verdict = session === null ? null : spawnVerdictChip(session);
  const resume = resumeNote(run, nowSec);
  const body = (
    <>
      <span className="run-glyph" aria-hidden="true">{RUN_GLYPH[state]}</span>
      <span className="run-state">{RUN_WORD[state]}</span>
      <span className="run-ws">{run.workspace ?? run.branch ?? String(run.id)}</span>
      <span className="run-tally">{itemTallyLabel(items)}</span>
      <span className="run-when">
        {run.dispatchedAt === null ? '—' : formatAge(nowSec - Math.floor(run.dispatchedAt / 1000))}
      </span>
      {/* Two cues on both branches — a word and a glyph — the same rule every
          other state cell on this board follows: nothing here may be read out
          of colour alone. The in-flight line is an ordinary progress
          statement; the stalled one is the state `dispatch.ts` says "no verb
          names", and it is deliberately worded as what the OPERATOR now has
          to deal with (a workspace may exist) rather than as an error code. */}
      {spawn.phase === 'in-flight' && (
        <span className="run-dispatch" data-phase="in-flight">
          {/* The glyph comes from `DISPATCH_GLYPH` (Task 4), not a literal:
              the fleet card draws the same window now, and two surfaces
              spelling one vocabulary twice is the drift this repo's tables
              exist to prevent. */}
          <span className="run-dispatch-glyph" aria-hidden="true">{DISPATCH_GLYPH['in-flight']}</span>
          {'dispatching… '}{formatElapsed(spawn.elapsedMs)}
        </span>
      )}
      {spawn.phase === 'stalled' && (
        <span
          className="run-dispatch"
          data-phase="stalled"
          title={`the dispatch began ${formatElapsed(spawn.elapsedMs)} ago and the run is still planned`}
        >
          <span className="run-dispatch-glyph" aria-hidden="true">{DISPATCH_GLYPH.stalled}</span>
          {'dispatch never completed — a workspace may exist'}
        </span>
      )}
      {/* The linked session's spawn verdict, in `SessionLine`'s own class and
          `SessionLine`'s own word — the identical reuse this row already makes
          of `.sess-unmeasured` next door, and for the identical reason: a
          second `.run-…` class for one meaning is two vocabularies over one
          field. `.sess-line` and `.run-row` both sit on `--bg-surface`, so the
          chip's ink brings no new contrast pair with it. */}
      {verdict !== null && (
        <span className="sess-spawn" data-spawn={verdict.data} title={`last spawn: ${verdict.data}`}>
          {verdict.word}
        </span>
      )}
      {/* D-1, finally on screen. `data-cleared` carries the half the word
          alone cannot: the two branches are two different facts, and a test
          that could only read the string would be pinning prose. */}
      {resume !== null && (
        <span className="run-resumed" data-cleared={String(resume.cleared)} title={resume.title}>
          {resume.word}
        </span>
      )}
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
  // The abandon control, D-287: a SIBLING of `.run-open` inside the `<li>`,
  // never nested inside it — `RunsScreen.tsx:118-122` (pre-fix) wrapped the
  // whole row body in `<button className="run-open">`, and a `<button>`
  // inside a `<button>` is invalid HTML and unreachable to a screen reader.
  // It renders on EVERY row, including the inert (no-session) one just below
  // — an inert row is exactly the wedge shape (`ambiguous-dispatch`, a
  // `planned` run with no session) this control exists to release
  // (`abandon-sheet.test.tsx`'s own pin on that case).
  const abandonButton = (
    <button
      type="button"
      className="run-abandon"
      aria-label={`Abandon run ${run.id}`}
      onClick={() => onAbandon(run)}
    >
      Abandon
    </button>
  );

  // A run with no session has nothing to open. An inert row says that; a
  // button that navigates to a session that does not exist says something
  // false.
  //
  // Task 3: `data-inert` is about the TAP and nothing else, and it stays
  // exactly as it was — the in-flight row is the ONE row that is inert and
  // has something to say, and the two are not in tension. `body` renders
  // inside the inert `<li>` just as it does inside `.run-open`, and nothing
  // in `fleet.css` selects `[data-inert]` at all (measured), so no rule dims
  // or hides what the row now says while the spawn is under way. Making the
  // row tappable to let the affordance through would have traded a true
  // sentence for a dead tap onto a session id that does not exist yet.
  return run.sessionId === null
    ? <li className="run-row" data-inert="true">{body}{abandonButton}</li>
    : (
      <li className="run-row">
        <button type="button" className="run-open" onClick={() => navigate(`/s/${encodeURIComponent(run.sessionId!)}`)}>
          {body}
        </button>
        {abandonButton}
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
  const conn = store((s) => s.conn);
  const [cold, setCold] = useState<RunSummary[] | null>(null);
  // Review finding 19: `cold`'s own `null` used to mean BOTH "still loading"
  // and "every attempt has failed" — the same collapse `MailScreen`'s `feed`
  // had, and the one `AccountsScreen`'s `!accounts` branch was written
  // specifically to avoid ("'never asked' reads as 'never landed' to whoever
  // is looking"). A three-state read, so a read failure can render its own
  // honest message instead of falling through to "No runs." — a POSITIVE
  // claim about the program's whole history that a failed read has no
  // standing to make.
  const [coldState, setColdState] = useState<'loading' | 'ok' | 'error'>('loading');

  // Task 12, spec §4.3: which run's AbandonSheet is open, or `null`. ONE
  // sheet at screen level, reused across rows — the same shape
  // `SessionActionsSheet`'s single actions sheet uses rather than mounting
  // one sheet per row.
  const [abandonTarget, setAbandonTarget] = useState<RunSummary | null>(null);

  // Task 13, spec §4.4: the run board's own door onto a new program. ONE
  // door, rendered unconditionally below — including at zero runs, the same
  // "renders at zero runs too" rule `.fleet-runs-row` already holds one
  // screen over.
  const [startOpen, setStartOpen] = useState(false);

  // Held in a ref, not the effect's own dependency array — the same fix
  // `MailScreen` already applies to `loadFeed`: "once per mount" has to hold
  // regardless of the CALLER's identity discipline, not only the hoisted
  // default's. The ref always reads the LATEST `loadRuns` without ever being
  // a reason for the effect to re-run.
  const loadRunsRef = useRef(loadRuns);
  loadRunsRef.current = loadRuns;

  // Never fires a `set*` after this instance has unmounted — shared by the
  // mount-time read below and the transition-triggered re-read (finding 22),
  // the one this screen fires on its own initiative, mid-lifetime.
  //
  // RE-ARMED as the effect's OWN first statement, not left to the `useRef(true)`
  // initialiser alone (I1, regression, measured): React 18 StrictMode (dev
  // only) runs every effect as mount -> cleanup -> mount, on the SAME
  // component instance, so `aliveRef` survives the whole sequence rather than
  // being re-created. With no re-arm, the simulated cleanup's `= false` was
  // never undone by the simulated second mount — `aliveRef.current` stayed
  // `false` for the rest of the component's real life, so every `loadCold()`
  // below (`if (aliveRef.current) { setCold(...); setColdState(...) }`)
  // silently dropped its own resolution and the board hung on "Loading…"
  // forever under StrictMode. Setting it `true` here, every time the effect
  // body runs (both the StrictMode-simulated second mount and the one real
  // mount in production, where this effect only ever runs once), is what
  // makes the ref correct across both.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const loadCold = (): Promise<void> =>
    loadRunsRef.current()
      .then((r) => { if (aliveRef.current) { setCold(r.runs); setColdState('ok'); } })
      .catch(() => { if (aliveRef.current) setColdState('error'); });

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
    void loadCold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Review finding 22: a run that closes while this screen is already open
  // must not simply vanish. The live frame is active-only BY CONSTRUCTION
  // (see the file header) — it can never itself carry the now-closed row —
  // so the only way `finished` learns about it is a fresh archive read,
  // fired exactly when a run id that WAS in the live active set stops being
  // there (a close, or a run leaving this box's view some other way). Not a
  // poll: a diff against the PREVIOUS live frame, so it fires only on a real
  // transition, never on an unrelated re-render.
  const prevLiveIdsRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!runsFrameSeen) return;
    const ids = new Set(live.map((r) => r.id));
    const prev = prevLiveIdsRef.current;
    if (prev !== null) {
      let vanished = false;
      for (const id of prev) if (!ids.has(id)) { vanished = true; break; }
      if (vanished) void loadCold();
    }
    prevLiveIdsRef.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, runsFrameSeen]);

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
      onAbandon={setAbandonTarget}
    />
  );

  return (
    <div className="runs-screen" data-conn={conn}>
      <header className="runs-head">
        <button type="button" className="runs-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </button>
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

      {/* Task 13, spec §4.4: ONE door, rendered here regardless of the
          board's own state below — a program starts before any run exists
          to show. */}
      <button type="button" className="program-start-door" onClick={() => setStartOpen(true)}>
        Start a program
      </button>

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
                  <span className="runs-wave">wave {wave}{waveOf === null ? '' : `/${waveOf}`}</span>
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
      <AbandonSheet run={abandonTarget} onClose={() => setAbandonTarget(null)} onDone={() => { void loadCold(); }} />
      <StartProgramSheet open={startOpen} onClose={() => setStartOpen(false)} fleet={store} />
    </div>
  );
}
