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
import type { ReactNode } from 'react';
import {
  type FleetSession, type RunSummary, graphReadCount, unmeasuredFields,
} from '../../../shared/api';
import {
  DISPATCH_GLYPH, RUN_GLYPH, RUN_WORD, childReclaimChip, childReclaimGone,
  childReclaimTitle, crossingNote, dispatchWindow, isRunClosed, itemTallyLabel,
  resumeNote, runKindChip, runWarnings, runItems, runState,
} from '../fleet/runWords';
import { spawnVerdictChip } from '../fleet/spawnWords';
import { GraphChip, LastSpawnChip, UnmeasuredChip } from '../fleet/chips';
import { coordPresence } from '../fleet/coordWords';
import { formatAge, formatElapsed } from '../fleet/formatReset';
import { navigate } from '../lib/router';
import '../fleet/fleet.css';

export function RunRow({
  run,
  nowMs,
  session,
  coordSession,
  frameSeen,
  programHasOpenRun,
  onAbandon,
  onResume,
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
  /** The run's CLAIMANT as the live fleet snapshot has it — a different
   *  lookup from `session` above, which is the run's WORKER. Both come off
   *  `sessionById`, and conflating them would put the resume door on a row
   *  whose worker died while its coordinator is fine. */
  coordSession: FleetSession | null;
  /** Has a `{type:'fleet'}` frame ever landed. Passed rather than inferred
   *  from `coordSession !== null`: absence from a snapshot that never arrived
   *  and absence from one that did are opposite facts, and only the second is
   *  evidence of anything (D-1138). */
  frameSeen: boolean;
  /** Does this row's PROGRAM still have a run that can move, as the board
   *  currently measures it (D-1146)? The row's own `state` cannot answer that
   *  — it is a fact about the other rows — so the caller derives it once from
   *  the same `active` slice it renders and hands each row the single bit it
   *  needs, the same shape `session`/`coordSession` above are looked up in. */
  programHasOpenRun: boolean;
  /** Opens the AbandonSheet for this row (Task 12, spec §4.3, D-287 (was D-B4-14)). */
  onAbandon: (run: RunSummary) => void;
  /** Opens the ResumeSheet for this row (spec §7.3). */
  onResume: (run: RunSummary) => void;
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
  const body = (
    <>
      <span className="run-glyph" aria-hidden="true">{RUN_GLYPH[state]}</span>
      <span className="run-state">{RUN_WORD[state]}</span>
      <span className="run-ws">{run.workspace ?? run.branch ?? String(run.id)}</span>
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

  // The resume door. `coordPresence` decides the FIRST half — three answers,
  // and only `dead` opens it: `unknown` is what a substrate fault, a missing
  // row and an unarrived frame all read as, and each of those would otherwise
  // offer to hand a live coordinator's program to somebody else (D-309's
  // collapse, quoted on `coordPresence`'s own docstring; D-1129). D-1146 does
  // not touch that half and it must stay exactly this strong: widening the
  // second term below is only safe because the first one still refuses to act
  // on doubt.
  //
  // THE SECOND HALF IS THE PROGRAM'S FACT, NOT THE ROW'S (D-1146, review
  // MAJOR 2). It was `!isRunClosed(run)` alone, on the argument that "a done
  // wave's coordinator being dead is the ORDINARY end state, not a wedge" —
  // which is true of a finished wave sitting BESIDE one that can still move,
  // and false of exactly the case that needs this door most. `closeRun`
  // retires a program at zero open runs, and between closing wave N and
  // opening wave N+1 a program has no open run at all — the close-then-open
  // window ruling R1 names. There, every row is terminal, `ResumeSheet` has
  // ONE opener (this button), and the wave shipped no `ccrc-api` verb on
  // purpose, so the board rendered no control anywhere while the server half
  // worked perfectly: measured live, wave N+1's `POST /api/runs` refuses
  // `claimed-by-another by:<dead id>` and a reclaim is what makes it answer
  // ok. `Abandon` on the last open run reached the same dead end from the
  // other side, by removing the only Resume the program had.
  //
  // So: this run is open, OR its program has nothing open. A terminal row
  // whose program is still running keeps the old answer — the door belongs on
  // the wave that can move, not on the archive underneath it.
  //
  // The door is per ROW while the reclaim is per PROGRAM (contract R1 rewrites
  // `claimedBy` on every run of the program, terminal ones included), so an
  // all-terminal program with several waves offers the same door several
  // times — one action repeated, never two different ones. Electing a single
  // row to carry it would be this renderer deciding which wave represents a
  // program, and `programWave`'s own docstring records what that guess cost
  // the last time it was made here.
  //
  // D-1147, RECORDED AND DELIBERATELY NOT FIXED HERE: reclaiming an
  // all-terminal program does not make runId-less `toId:'coordinator'` mail
  // resolvable again. The close route retires the program
  // (`setProgramState('done')` once `programOpenRunCount` reads zero) and
  // `resolveCoordinator(null)` refuses on its single-active-program guard
  // BEFORE it ever reads `claimedBy` — so the column this door rewrites is not
  // the one that arm is stuck on. Mail naming an explicit `runId` resolves
  // through a direct row read and is unaffected, which is the path the
  // coordinator corpus already sends a resumed coordinator down.
  const presence = coordPresence(run.claimedBy, coordSession, frameSeen);
  const resumeButton = presence === 'dead' && (!isRunClosed(run) || !programHasOpenRun) ? (
    <button
      type="button"
      className="run-resume"
      aria-label={`Resume run ${run.id}`}
      onClick={() => onResume(run)}
    >
      Resume
    </button>
  ) : null;

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
  //
  // A reclaimed child's session no longer exists either (spec §5.9: the row
  // "stops offering to open its session"). It gets the same inert row, for the
  // same reason. `resumeButton` and `abandonButton` keep their place: neither
  // is about the worker's session.
  return run.sessionId === null || childReclaimGone(reclaim)
    ? <li className="run-row" data-inert="true">{body}{resumeButton}{abandonButton}</li>
    : (
      <li className="run-row">
        <button type="button" className="run-open" onClick={() => navigate(`/s/${encodeURIComponent(run.sessionId!)}`)}>
          {body}
        </button>
        {resumeButton}
        {abandonButton}
      </li>
    );
}
