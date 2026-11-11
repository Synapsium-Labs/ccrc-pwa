# Archiving or stopping a coordinator asks what happens to its runs

## Goal

When the operator archives or stops a session that claims open runs (coordination runs whose `claimedBy` is that session
and that are not closed), the console asks whether to **release** those runs, leaving them unclaimed, or **hand them over**
to a named live coordinator. It never ends a live programme by itself. A stop that keeps the session id (the stop half of
a restart) and a swap or roll never ask.

## What was read first

- The archive door: `POST /api/sessions/:id/archive`, `admitArchive` (`server/src/coord/archiveAdmission.ts`),
  `decideArchive` (`server/src/coord/archiveDoor.ts`) and `actArchive` (`server/src/archiveAct.ts`). A session that
  claims open runs was refused `coordinator-has-open-runs`, and the sheet's only answer was `{programme:'end'}`, which
  abandons every run.
- The stop door: `POST /api/sessions/:id/stop` read no claims at all. The PWA reaches it from "Stop only" in the archive
  sheet, and from the restart lists of the account sheets (`useRestarts`: stop, then ensure, the id kept).
- The one writer of `runs.claimedBy`: `CoordStore.reclaimProgram`, which rewrites every claimed row of a programme in one
  transaction and journals a `reclaim:<from> -> <to>` run event per row. Its decider, `reclaimRun`
  (`server/src/coord/reclaim.ts`), refuses a claimant that measures alive (rung 4). No writer cleared `claimedBy`.
- The child-reclaim fence (`childReclaimCoordinatorClaims`) reads `claimedBy` and the `reclaim:` rows to know which ids
  ever held a chair.
- The PWA's live-coordinator picker for a hand-over: `resumeHeirs` (`pwa/src/fleet/resumeHeirs.ts`).

## Deviations found

- **D-8199 (2026-11-11)** — archiving or stopping a session that claims open runs asks Release or Hand over; the claims move through the reclaim writer, a release journaling `release:<from>`; ending the programme is never the default and stays an explicit third answer on the archive sheet only; the stop never fails shut on an unreadable store.

## Design

- **Wire.** `ClaimsChoiceBody` (`shared/api.ts`): `{runs:'release'}` or `{runs:'handover', heir}`, on the archive body and
  on the new `StopBody`, which also carries `restart: true`. A malformed choice, a choice beside `programme:'end'`, or a
  choice beside `restart` is a 400. Both doors answer a session that claims open runs and gave no choice with the existing
  `409 coordinator-has-open-runs` naming the runs; the PWA repeats the request with the choice. A move that is refused
  answers the new word `409 claims-not-moved` with `moved`, `notMoved` and `refusal`, and nothing is stopped or archived.
  Every answer after a move carries `moved: {to, runs}`, and the sheet says it first on every later refusal and toast.
  The stop door never fails shut on a store it cannot read: it is the escape hatch "Stop only" offers after the archive
  door refused on that store, so it goes through, moving nothing, and answers `claimsUnreadable`.
- **Release.** `reclaimProgram(runId, null, …)`: every claimed row of the programme is set to NULL (the R1 rule, so the
  next coordinator's open is not refused by a terminal row), the displaced claimant's kickoffs are cancelled, no mail is
  repointed (there is no heir), and each row journals `release:<from>`. The fence reads `release:` rows as displacements
  beside `reclaim:` rows, so a released coordinator still reads as one that coordinated.
- **Hand-over.** `reclaimRun(…, {displacing: from})`: the whole reclaim ladder, with rung 4 lifted for the claimant the
  operator is putting down. The heir is proved live first (`heirLiveness`: its pane up, or hibernated), and is never the
  session itself.
- **Order.** Both doors decide on the coordination serialiser. The archive door moves the claims after every refusable
  check and before the stop and `ws-archive`; a claims choice reads the turn fail-closed, as a programme end does. The
  stop door moves them before `ccd stop`. `restart: true` skips the question; the swap route is not touched.
- **PWA.** The archive sheet's coordinator case lists the runs and offers **Release** and **Hand over to** a picker of
  live coordinators (`resumeHeirs`); one tap picks, a second confirms. **End programme** stays as a third answer on the
  archive question only (it was the sheet's one answer before, and it is still how a programme is ended from here); it is
  never preselected and never offered on a stop. "Stop only" asks the same question first when the frame shows claims;
  otherwise the sheet sends the stop, awaits it, and answers its `coordinator-has-open-runs` with the question and its
  `claims-not-moved` with the reason, then repeats the stop with the choice. The restart lists send `restart: true`.

## Tasks

- [x] T1. Tests first, red: archive and stop with no claims pass; with claims and no choice they refuse; release and
  hand-over each move the claims, journaled; a refused hand-over moves nothing; a restart stop and the swap route are
  untouched; the PWA sheet at phone, laptop and wide.
- [x] T2. Server: the choice parse, the move, the doors' wiring, the store's release arm and the fence.
- [x] T3. PWA: the sheet, the stop path and the restart flag.
- [x] T4. Review fixes: the stop door lets a stop through over an unreadable store; the sheet sends and awaits the stop
  so its refusals get the question and the repeat; `moved` is said first on every later refusal and toast; README
  and this line brought in line with the kept End programme answer. Red first for each: the server unit and end-to-end
  cases, the new sheet cases and the new browser width case (the moved line at 360, 390, 1280 and 1920). The earlier
  D-8199 sheet cases were also run against the pre-branch sheet and are red there (18 of them).
