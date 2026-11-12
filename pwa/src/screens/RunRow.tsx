// One row of the run board.
//
// WHY IT IS ITS OWN FILE. `RunsScreen.tsx` was 886 lines holding two
// components: this row (334) and the board (470). The row already WAS a
// component — it just shared a file with the screen that renders it, which is
// the shape that makes a file unreadable without anything being wrong in it.
//
// It is exported now, which it was not. That is the point: a row the board
// renders is a thing with a name, and a test can mount it without mounting
// the board's `/api/runs` poll and its three sheets.
//
// The classes stay `run-*`: fleet.css grounds them and the board is still
// their only other consumer. The shape moves, the ground stays.
import { memo } from 'react';
import type { ReactNode } from 'react';
import {
  type FleetSession, type RunSummary, graphReadCount, unmeasuredFields,
} from '../../../shared/api';
import {
  DISPATCH_GLYPH, DISPATCH_STALLED_WORDS, RUN_GLYPH, childReclaimChip, dispatchStalledTitle,
  branchCommitsNote, childReclaimTitle, crossingNote, dispatchWindow, itemTallyLabel, itemTallyTitle,
  resumeNote, runKindChip, runRowName, runWarnings, runItems, runState, runStateWord, runWaitLine, workerSeenNote,
} from '../fleet/runWords';
import { spawnVerdictChip } from '../fleet/spawnWords';
import { GraphChip, LastSpawnChip, UnmeasuredChip } from '../fleet/chips';
import { inAppClick } from '../fleet/settingsText';
import { formatAge, formatElapsed } from '../fleet/formatReset';
import { navigate } from '../lib/router';
import { runPath } from '../lib/routes';
import '../fleet/fleet.css';

// `memo` (D-6442, D-6438): the programme page re-renders each second while a dispatch is pending, and a row's props are stable
// between those ticks (the run object, its worker's session, and `nowMs`), so a tick inside one 30 s step re-renders no row.
// The fleet store keeps the object of every row that did not change (`keepRows`, C6), so a frame that changes one session
// re-renders only the rows holding it.
export const RunRow = memo(function RunRow({
  run,
  nowMs,
  session,
  current = false,
  quietMs = null,
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
  /** This run is the one open in the broad pane (spec §8.4): the row says so to a screen reader and to the eye. */
  current?: boolean;
  /** D-8285: the runs frame's `stallQuietMs`, the heartbeat's stale threshold; null (or omitted) is never quiet. */
  quietMs?: number | null;
}): ReactNode {
  // The registry ladder's degrade note, same idiom as `SessionLine.tsx`'s own
  // (`.sess-unmeasured`, reused verbatim rather than a second `.run-…` class
  // for the identical meaning): this row's session could not be fully
  // measured its last pass, so fields the fleet screen shows for it may be
  // frozen at a fallback. `unmeasuredFields`, never `session.unmeasured`
  // directly, for the same reason `SessionLine.tsx` gives — a live frame can
  // omit the key entirely at runtime even though the type says required.
  const degradedFields = session === null ? [] : unmeasuredFields(session);
  // Same discipline, same reason — the ONE reader for the count (D-1251).
  const graphReads = session === null ? null : graphReadCount(session);
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
  // F4. TWO facts, and only one of them is conditional: the run's own project is
  // rendered on every row (a badge that appears only sometimes teaches nothing),
  // while the crossing marker is `crossingNote`'s single answer — silent when the
  // home is unknown, silent when the home IS this project, two cues when it is
  // neither. This component compares nothing.
  const crossing = crossingNote(run);
  const kindChip = runKindChip(run);
  // F7. The DECISION is `runWarnings`' — five conditions, one place, tolerant of
  // a server that has never heard of `health`. This component picks no words and
  // compares no thresholds; it lays out what it was handed.
  const warnings = runWarnings(run, nowMs);
  // Child-reclamation wave 5 (spec §5.9): what became of this run's CHILD
  // workspace. `childReclaimChip` is the one reader. The word and the sentence
  // are the server's, and this component picks neither.
  const reclaim = childReclaimChip(run);
  // §7: what the run waits on, in place of the row's ordinary line. The DECISION is `runWaitLine`'s. A run behind a stuck run
  // links that run, and a link cannot sit inside the open button, so it stands beside it.
  const waitLine = runWaitLine(run, nowMs);
  // D-8285: the worker heartbeat, `workerSeenNote`'s words. Absent draws nothing.
  const seen = workerSeenNote(run, nowMs, quietMs);
  const commits = branchCommitsNote(run, session);
  const body = (
    <>
      <span className="run-glyph" aria-hidden="true">{RUN_GLYPH[state]}</span>
      <span className="run-state">{runStateWord(run)}</span>
      {/* D-6170: the name is the programme's title and wave in words, never a
          workspace, a branch or a run number — those ride the row's `title`. */}
      <span className="run-name">{runRowName(run)}</span>
      <span className="run-project">{run.project}</span>
      {crossing !== null && (
        <span className="run-crossing" data-home={crossing.home} title={crossing.title}>
          <span className="run-crossing-glyph" aria-hidden="true">{crossing.glyph}</span>
          {crossing.word}
        </span>
      )}
      {kindChip !== null && (
        <span className="run-kind" title={kindChip.title}>
          <span className="run-kind-glyph" aria-hidden="true">{kindChip.glyph}</span>
          {kindChip.word}
        </span>
      )}
      {/* D-8292: the tally says it counts settled items, and the worker branch's commits stand beside it as their own
          fact, from the PR read (`branchCommitsNote` decides; null draws nothing). */}
      <span className="run-tally" title={itemTallyTitle(items) ?? undefined}>{itemTallyLabel(items)}</span>
      {commits !== null && <span className="run-commits" title={commits.title}>{commits.word}</span>}
      <span className="run-when">
        {run.dispatchedAt === null ? '—' : formatAge(nowSec - Math.floor(run.dispatchedAt / 1000))}
      </span>
      {seen !== null && <span className="run-seen" data-quiet={String(seen.quiet)} title={seen.title}>{seen.word}</span>}
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
          title={dispatchStalledTitle(spawn.elapsedMs)}
        >
          <span className="run-dispatch-glyph" aria-hidden="true">{DISPATCH_GLYPH.stalled}</span>
          {DISPATCH_STALLED_WORDS}
        </span>
      )}
      {/* The linked session's spawn verdict, in `SessionLine`'s own class and
          `SessionLine`'s own word — the identical reuse this row already makes
          of `.sess-unmeasured` next door, and for the identical reason: a
          second `.run-…` class for one meaning is two vocabularies over one
          field. `.sess-line` and `.run-row` both sit on `--bg-surface`, so the
          chip's ink brings no new contrast pair with it. */}
      <LastSpawnChip chip={verdict} />
      {/* The worker's read counter, in the fleet card's own class — the same
          reuse this row already makes of `.sess-spawn` and `.sess-unmeasured`
          next door, and for the same reason: a second `.run-…` class for one
          meaning is two vocabularies over one field. Read through
          `graphReadCount`, never `session.graphQueries`, for the reason
          `unmeasuredFields` is used two lines up: the live frame is cast, not
          revived, so an older server's row omits this ADDITIVE key and a raw
          `!== null` paints `graph ` with no number (D-1251). */}
      <GraphChip reads={graphReads} gated={null} />
      {/* D-1, finally on screen. `data-cleared` carries the half the word
          alone cannot: the two branches are two different facts, and a test
          that could only read the string would be pinning prose. */}
      {resume !== null && (
        <span className="run-resumed" data-cleared={String(resume.cleared)} title={resume.title}>
          {resume.word}
        </span>
      )}
      {/* Wave 5: the reclaim chip, `.run-kind`'s shape (glyph + word, the long
          form in `title`). Informational, so it lives inside `body` and
          therefore inside `.run-open`, like `.run-warn`: the sibling rule
          binds controls, and this is prose. */}
      {reclaim !== null && (
        <span className="run-child-reclaim" data-child-reclaim={reclaim.word}
          title={childReclaimTitle(reclaim, nowSec)}>
          <span className="run-child-reclaim-glyph" aria-hidden="true">{reclaim.glyph}</span>
          {reclaim.label}
        </span>
      )}
      {/* A refusal's sentence on its own wrapped line (`flex-basis: 100%`,
          `.run-warn`'s idiom). The chip decides when there is one; this lays
          out what it was handed. */}
      {reclaim !== null && reclaim.line !== null && (
        <span className="run-child-reclaim-sentence">{reclaim.line}</span>
      )}
      <UnmeasuredChip fields={degradedFields} />
      {waitLine !== null && run.blockedBy == null && <span className="run-wait" data-testid="run-wait">{waitLine}</span>}
      {warnings.length > 0 && (
        // Its own wrapped LINE, not another inline cell: `.run-row` is
        // `flex-wrap: wrap`, so a `flex-basis: 100%` child becomes a sub-row
        // inside the existing <li> without a second list element and without a
        // fourth `flex: none` control competing for phone width. Not tappable, so
        // it may live inside `body` (and therefore inside `.run-open`) — D-287's
        // sibling rule binds controls, and this is prose.
        <span className="run-warn">
          {warnings.map((w) => (
            <span key={w.word} className="run-warn-item" title={w.title}>
              <span className="run-warn-glyph" aria-hidden="true">{w.glyph}</span>
              {' '}{w.word}
            </span>
          ))}
        </span>
      )}
    </>
  );
  // Abandon is not on this row (the runs rebuild, D-8074, Task 13): it sits on a stuck row in the Stuck band
  // (`StuckBand.tsx`) and on the run's own page, and nowhere else on the board.

  // Resume is not on a row (the runs rebuild, D-8075, Task 19; spec §9.5, F25): it sits once on the programme page's head and
  // on the run page, where `resumeShown` decides it.

  // Every row opens its run's page (the runs rebuild, D-8072; spec A9). A run with no session, a spawn under way or a
  // reclaimed child still has a page, so no row is inert any more: the page says what the row cannot. The session is one more
  // tap, on the page. The id rule stays D-5589's: the run number and the workspace (else the branch) live in the row's title
  // and the controls' accessible names only (D-6170).
  const where = run.workspace ?? run.branch;
  const rowTitle = where === null ? `run ${run.id}` : `run ${run.id} · ${where}`;
  return (
    <li className="run-row" title={rowTitle}>
      <button type="button" className="run-open" aria-current={current ? 'true' : undefined} onClick={() => navigate(runPath(run.id))}>
        {body}
      </button>
      {waitLine !== null && run.blockedBy != null && (
        <a className="run-wait" href={runPath(run.blockedBy)} onClick={inAppClick(runPath(run.blockedBy))}>{waitLine}</a>
      )}
    </li>
  );
});
