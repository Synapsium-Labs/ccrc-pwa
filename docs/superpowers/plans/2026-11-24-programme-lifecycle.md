# Programme lifecycle: plan

Spec: `docs/superpowers/specs/2026-11-24-programme-lifecycle-design.md`. Deviations D-8983..D-8992 (issued).

## The operator's rulings of 2026-11-24

R1 to R10 in the spec's §1: every coordinator joins a programme at spawn; a programme is a business objective; the
Overlord starts and ends programmes; an end is proposed by the coordinator and confirmed by the operator or the
Overlord, never a side effect (D-51 goes); the states are Open, Active, Idle, Paused, Done and Abandoned; no
Waiting-on-you item for idleness; a coordinator's exit leaves "no coordinator", not an end; every programme's page tells
its story; the backfill is the operator's per-programme decisions, applied from a private file; the `plain` role is
aligned with R1.

## Ground rules for every PR

- Red-first: each guard ships with a test measured red with the guard deleted or mutated, and the PR says which.
- Characterization first when moving code: pin today's inputs and outputs, green on `main`, before the move.
- Fixture HOMEs only (`makeCcdHarness`); never `ccd` against the live `$HOME`; suites in the foreground, one file at a
  time from inside the package, timeout at least 600000 ms.
- No programme slug, account or host in any fixture or text: fixtures use `project-a`, `programme-a`, `lane-a`.
- The per-programme decisions file is never committed, not even as a fixture with real slugs.
- Push once per round (D-8397).

## Waves and order

| Wave | Content | Depends on |
|---|---|---|
| W1 | The model: migration, the one writer, `lifecycleOf`, D-51 removed, gates re-pointed, the binding through `reclaimProgram`, the boot re-measure | — |
| W2 | The doors: start, state, hand over, end proposal, plan close, confirm, decline, archive, ticks, history, reads | W1 |
| W3 | The backfill door (the operator applies the private file from a shell right after W1 and W2 are deployed) | W2 |
| W4 | Join at spawn: picks, the join sweep, placeholders, filing, the start card, skill clause 22 | W1, W2 (file door) |
| W5 | The role code: `plain` retired | — (parallel with W1) |
| W6 | The console: lifecycle words, chips, coordinator line, History, controls, Finished fold, portfolio, the Settings upload for the backfill | W2, W3 |
| W7 | The Overlord's cell, door rows and call-record entries | W2 |

**W1 and W2 roll out together.** W1's gates read `isEnded(state)`, and a D-51 end the migration keeps (spec §13 step 4)
then refuses its next wave with `plan-closed` until the operator reopens it, which needs W2's state door. So the
rollout that carries W1 also carries W2, and the operator's backfill (W3) follows it at once: the window in which a
programme the operator wants Idle still reads Done is one deploy, not several.

## W1: the model (one PR, server and `shared/`)

1. **Characterization.** `coord-store-programme-lifecycle-char.test.ts`: today's `openRun` row creation, `closeRun`'s
   retire (`done`/`abandoned` at zero open runs), `programmeLive` on `planEnd`, `soleActiveCoordinator` on `state`,
   `claimsProgramme` on open runs, `reclaimProgram` and `moveClaims` on `claimedBy`. Green on `main`. Later tasks flip
   the rows they change in their own commits.
2. **`shared/programmeLifecycle.ts`** (L0, imports nothing): `ProgrammeLifecycle`, `lifecycleOf(stored, placeholder,
   runs)`, `isEnded(stored)`, `CoordinatorLine` and `coordinatorLineOf(binding, registry)`. Tests: the spec §3 truth
   table row by row: a programme whose only open run is `planned` after an earlier dispatched wave is Active; one whose
   runs were never dispatched (an abandoned `planned` run included) is Open; stored `unknown` and an out-of-vocabulary
   value are Unknown; a filed or withdrawn placeholder has no lifecycle. `coordinatorLineOf`: a uuid mismatch and an
   archived row are `no-coordinator`; an unreadable registry, an unreadable uuid and a mid-swap row are `unmeasured`.
   Mutations: fold `unknown` into `active` → red; count `planned` as not open → red.
3. **Migration** (the next slot when the PR lands): columns `coordinator`, `coordinatorUuid`, `coordinatorSince`,
   `placeholder`, `filedInto`; tables `programme_events` (with its `(program, at)` index), `programme_members`,
   `programme_picks`; the `started`, `coordinator` and `migrated` events; the state rule (spec §13 step 4). Tests from
   the previous version's fixture: a D-51 `done` row with an open run migrates to `active` and shows Active; a D-51
   `done` row with no open run stays `done` with its `migrated` event; a `planEnd='abandoned'` row reading `done`
   becomes `abandoned`, and a `planEnd='done'` row reading `abandoned` becomes `done`; `paused`, `unknown` and an
   out-of-vocabulary value are untouched; the reserved `linear-sync` row is skipped; one `started` event per row; the
   binding seeded only from an open run's claimant, none for a programme with no open run; the migration's SQL holds no
   string literal that could be a slug (a scan). Rollback: a database one version newer is read as-is with the warning
   (`sqliteFile.ts`'s rule), never refused.
4. **`server/src/coord/programmeLifecycleStore.ts`** (L3): `decideInTx(slug, edge, actor, why, detail)`, `mintInTx`,
   `bindCoordinatorInTx`, `joinInTx`, `pickInTx`, `fileInTx`, `appendEventInTx`. `CoordStore#setProgramState` and
   `planStore.ts#closePlan` become private steps of `decideInTx` or are deleted; `mintInTx` admits an initial `paused`
   for the Linear backlog only (actor kind `system`). Tests: every edge writes one event with actor and why; an equal
   target writes nothing; an end writes `planEnd` fields equal to the state in the same transaction; a reopen clears
   them; a repair records the unreadable value. Census (`single-definition/`): `UPDATE programs SET state`, `SET
   planEnd`, `SET coordinator`, `SET placeholder`, and inserts into `programme_events`, `programme_members` and
   `programme_picks`, appear only in this file, with `schema.ts`'s migration SQL the one named exemption. Mutation: a
   second `UPDATE programs SET state` → red.
5. **Delete D-51** in `CoordStore#closeRun`. Test: closing the last run leaves stored `active` and shows Idle (red on
   `main`); a failed last run shows Idle too.
6. **Re-point the gates to `isEnded`**: `CoordStore#programmeLive`, `planStore.ts#planEndOf`'s gate users
   (`openRun.ts`'s `planGate`, `planRunFacts.ts`, the plan routes), `continuity/timerLane.ts` and `timers.ts`
   (`programme-ended`), `runClose.ts` and `runCloseRefusals.ts`, `overlapsLane.ts`, `continuity/routes.ts`,
   `planPolicy.ts#programmeEnd` (Done and Abandoned each to the Linear end it maps today; the `state === 'done'`
   inference from epics removed), `linear/migration.ts` (put-back through `decideInTx`; backlog minted `paused` through
   `mintInTx`). The refusal code `plan-closed` is kept; its words change. Tests: each reader flips with the decision,
   not with `planEnd` alone; an Abandoned programme never syncs as completed.
7. **`openRun`**: rows created only through `mintInTx` (event `started`, actor the claimant, who joins and is bound);
   refusals `programme-paused`, `programme-unknown` and `programme-provisional`; binds an empty binding; refuses another
   claimant with today's `claimed-by-another`; takes over a binding the route measured `no-coordinator` only when the
   programme has no open run; withdraws an open end proposal in its transaction. Tests: each refusal and the takeover
   (and no takeover over open runs, nor on `unmeasured`); a Linear backlog programme refuses its first wave until it is
   resumed; a recycled slug cannot be ended and opened in one transaction.
8. **The binding**: `CoordStore#reclaimProgram` keyed on the programme, moving open runs' `claimedBy` and calling
   `bindCoordinatorInTx` in one transaction (the binding alone for a programme with no open run); `moveClaims`'s
   release clears both; `CoordStore#claimsProgramme` reads the binding and compares the uuid (D-5298's comparison);
   `soleActiveCoordinator` resolves over programmes that show Active. Tests: after a hand-over, run-keyed mail, the
   close check and the stall notices name the heir; after a release, the next coordinator's `openRun` binds itself; a
   reused session id with a new uuid owns nothing; an Idle programme's coordinator still owns it; wave N+1 `planned`
   with wave N closed keeps run-less mail resolving; two Active programmes → null; reclaim writes a `coordinator`
   event; a census that nothing but `reclaimProgram` and the bind-when-empty paths calls `bindCoordinatorInTx`.
9. **The boot re-measure** (spec §15): rows with no `started` event get one; a row whose stored state differs from its
   newest event's `toState` goes through step 4's rule with a `migrated` event. Tests: a `done` written with no event
   (an older build's D-51) over an open run becomes `active`; one with no open run is kept and recorded; a second boot
   writes nothing.

## W2: the doors (one PR, server)

1. **`POST /api/programmes`** (start, binding the named coordinator, or none for the start sheet's pick),
   **`POST /api/programmes/:slug/state`** (`pause`, `resume`, `end`, `reopen`, `repair`),
   **`POST /api/programmes/:slug/coordinator`** (hand over, through `reclaimProgram`), all in
   `server/src/coord/ledgersRoutes.ts`'s operator registration. Decisions in an L1 decider
   `programmeEdgePolicy.ts#edgeDecision(stored, placeholder, runs, edge, actorKind)` and the credential rule of spec §14
   in one L1 table; the route acts. Tests: the transition table (spec §5) row by row, including `end` over open runs
   without and with `abandonRuns`, Done refused over open runs, every edge allowed for the Overlord without a step-up, every edge
   refused on a placeholder, pause working while sign-in is dark with actor `unmeasured` and `flag-off`, the step-ups,
   the Overlord's start refused without a coordinator.
2. **`POST /api/programmes/:slug/end-proposal`**: box token, attribution, `claimsProgramme`; raises the decide row
   `action:'end-programme'` (the `endRequest.ts` shape) with evidence per `doneWhen` line, or free lines and "no
   definition of done was pinned". Tests: 401, 403 `not-coordinator`, 409 `programme-runs-open`, `already-asked`,
   `programme-ended`, `evidence-required`; the item's text with and without a pin.
3. **`plan close` raises the proposal** (`planRoutes.ts`) with the close's own outcome and `evidence[]`; it no longer
   writes `planEnd`. Tests: after `plan close` with outcome `abandoned` the proposal says abandoned; the programme is not
   ended; one item is waiting; no evidence → `evidence-required`.
4. **Confirm, decline, withdraw**: `POST /api/items/:id/act {programme}` (`endProgrammeByOperator`) runs `decideInTx`
   (`ended`, evidence, item id) behind the step-up; `/decline` works dark, mails the coordinator bound at that moment
   (or none) and writes `end-declined`; `/withdraw` by the bound coordinator writes `end-withdrawn`. Tests: confirm
   refused dark; confirm refused while a run is open, the item left open; a hand-over keeps the proposal open and the
   decline mails the heir; a run opened withdraws the proposal.
5. **Archive door**: `archiveDoor.ts#decideArchive`'s `{programme:'end'}` calls `decideInTx` (Abandoned, "archived with
   programme end") after abandoning the runs. Test: the programme is Abandoned with the event, without D-51.
6. **Ticks on idle**: `PROGRAMME_ENDED_SENTENCE` is refused only for an ended programme; an idle tick mails the bound
   coordinator; with none, `no-coordinator`. Tests: Idle tick delivered; ended tick refused; unbound refused.
7. **Reads**: `GET /api/programmes/:slug/history` (programme events, those of placeholders filed into it, runs and
   `run_events`, oldest first) and `GET /api/sessions/:id/programme`. `programmesRead.ts#readProgrammes` adds
   `lifecycle`, `coordinatorLine`, `placeholder`, `pausedOpenRuns` to `ProgrammeRow` (additive) and skips the reserved
   row. Tests: the merged order; a migrated row says so.
8. **Census**: `LEDGER_OPERATOR_DOORS`, `gate.ts` EXEMPT for the box-token doors, `auth-gate.test.ts`, CLAUDE.md's
   box-token sentence in the same commit (`box-token-census.test.ts` checks both directions). Also CLAUDE.md's
   "Open wave N+1's run BEFORE closing wave N's" bullet: its reason changes from "the server retires the program" to
   "mail with no run id resolves only over a programme that shows Active, and the open `planned` run keeps it Active".

## W3: the backfill door (one PR, then the operator's act)

1. `POST /api/programmes/decisions` (spec §13): preview by default, `apply:true` behind the step-up; posted from the
   operator's shell with a session (the Settings upload rides W6). Tests (neutral slugs only): each preview refusal,
   the reserved row and a placeholder included; `active`/`idle`/`open` mismatches reported and not forced; a D-51
   `done` row decided `idle` takes the reopen edge; an Unknown row decided takes the repair edge; a second apply writes
   zero events; the answer's counts over the listed rows, its `unlisted`, `placeholders` and reserved-row lines.
2. **Operational, not a PR**: right after W1 and W2 are deployed, the operator previews then applies the private
   decisions file from a shell, checks the listed counts against R9's 56, and decides or leaves each `unlisted` row.

## W4: join at spawn (one PR, server, ccd text, skill)

1. **`programmeJoin.ts#joinDecision`** (L1), its "who joins" input being `roleOf`'s answer. Tests: child, Overlord,
   auditor, replay → skip; a held coordinator joins; a row seen once, or with no uuid → skip (not settled); an
   unreadable marker → skip unmeasured; a counting membership → `already-joined`; a membership only in an ended
   programme or a filed placeholder → mint; a hand-over's old lead → `already-joined`; a reused id with a new uuid →
   joins as new; a pick → `join-picked`.
2. **Picks**: `POST /api/sessions` and the non-child arm of `POST /api/projects/:project/workspaces` (optional
   `programme` body field) record a pick before the start; the start-programme sheet (`StartProgramSheet.tsx`) passes
   its slug. Tests: the pick is written before the start; a pick expires after an hour; the kickoff stays mail-only.
3. **The join sweep**: measure which existing lane re-reads the registry for the coordination store and extend it; if
   none fits, record the "legitimately different" reason in the PR. Live rows only. It completes picks, mints
   `p-<base36 ms>` placeholders (a collision retries with a suffix), joins as lead or member, withdraws a placeholder
   when its session joins a real programme, unbinds a session whose `.child` marker appears late, and writes
   `coordinator-gone` / `coordinator-back` per incarnation after two passes. Tests: a hand-started session is joined on
   its second settled pass; a `ws-add` child whose `.child` lands between passes is never joined; one whose marker
   appears after a join is unbound and its placeholder withdrawn; a pick and a sweep in the same window mint nothing;
   an exited row is left alone; a second pass writes nothing; a swap reads `unmeasured` and writes no exit.
4. **Filing**: `POST /api/programmes/:slug/file` (box token, the placeholder's coordinator) and
   `POST /api/programmes/:slug/refile` (operator, including `{withdraw:true, why}`), one L1 decision `fileDecision`.
   `{into}` and `{name, title}` mark the placeholder `filed`; nothing is deleted. `programmeWritable(row)` is asked by
   every slug-keyed write door (spec §7's list), and a census lists those doors. Tests: every arm and refusal; the
   target's history shows the placeholder's events; `/remaining`, `/spec`, `/calls`, `/modifications`, the portfolio
   rank and goals ratify refuse an unfiled placeholder.
5. **The start card**: `ccd/session-hook.sh#_hook_role_card`'s fresh and revival texts become unconditional (spec §7).
   Tests: the hook suite's card-text pins; card-off, children, held sessions and a start whose anchor printed still get
   no role card, and the join mail carries the filing sentence.
6. **The coordinator skill**: clause 22 (`ccd/coordinator-skill/SKILL.md`) says the end is proposed with `plan close`,
   with evidence against the definition of done, and confirmed by the operator or the Overlord;
   `coordinator-skill.test.ts` updated in the same commit. References (`plan.md`, `api.md`, `resume.md`,
   `wave-steps.md`, `wave-lifecycle-5-boundary.md`, `wave-lifecycle-6-final-merge.md`) lose "the program retires" and
   gain filing, membership under another lead, and the end proposal. `claimed-by-another` keeps its name everywhere.

## W5: the role code (one PR, server and `shared/`)

1. **Characterization**: `roleOf` and `profileFor` over today's fact grid, green on `main`.
2. `roleOf` decides from markers (spec §12); remove `coordinator-or-plain`, its `PROFILE_OF_UNDECIDED` arm, and `plain`
   from `FleetRole` and `FLEET_ROLES`; keep the renderer and compaction text auditor and replay use. A persisted `plain`
   reading revives as `coordinator`. Tests: a session with no runs and no intent is `coordinator`; `FLEET_ROLES` has no
   `plain`; auditor and replay cards are byte-identical to the characterization.
3. `POST /api/coord/plain-auto-memory` refuses `role-retired`; the Settings row is removed from the PWA. Test: the
   refusal; the stored value still reads.

## W6: the console (one PR, PWA)

1. `pwa/src/screens/programmeLifecycleWords.ts` (L1): the one reader of `lifecycle`, `coordinatorLine`, `placeholder`,
   `pausedOpenRuns`; the words of spec §6, including "Paused while sign-in was off" and the backlog hold.
2. The Programmes screen's chips with counts (Active, Idle, Open, Paused, No coordinator, Unfiled) and the Finished
   fold keyed on Done and Abandoned (`usePrograms.ts#endingWords`, `ProgrammeCard.tsx`); the Fleet header's "n idle"
   link.
3. `programmeIsLive` (`ledgerWords.ts`, `WaitingScreen.tsx`, `WaitingRoutes.tsx`, `ItemView.tsx`) reads the lifecycle,
   so an Idle programme's items are not shown as ended; `portfolioStore.ts`'s listing keeps every real programme that
   has not ended and no placeholder (server).
4. The Programme page (`ProgrammeScreen.tsx`): History section from the history read; the coordinator line with the
   dark-sign-in sentence; Pause, Resume, End, Reopen, Repair, Hand to coordinator and Re-file controls, each asking for a
   why; the end proposal shown on Open, Idle and Paused programmes.
5. Settings, "Apply programme decisions": uploads a file from the operator's device to W3's door, preview then apply.
6. Tests: an Idle programme is under the Idle chip and not under Finished; its items are live; no Waiting-on-you row
   is raised for idleness; an open end proposal shows on an Idle programme; each control posts the right edge; the
   History renders every event kind.

## W7: the Overlord (one PR)

1. `RUNG_CELL_MAP` gains `programme-lifecycle` (full only); `overlordDoors.ts` rows for every programme edge the
   operator has (start, pause, resume, end, confirm, decline, reopen, repair, hand over, re-file, withdraw a placeholder).
   No decision-model row, no call-record entry, no step-up. Tests: refused at chat and advise, allowed at full; the
   event's `actorKind` is `overlord`; no call record row and no operator item is written for an Overlord act; below
   full, a proposal's item says it waits on the operator.
2. `OVERLORD_OPERATOR_DOORS` and CLAUDE.md's sentence updated in the same commit.

## Deviations found

- **D-8983 (2026-11-24)** — one-end-fact-one-writer. `programs.state` is the programme's one decision fact and its end
  fact; `planEnd`, `planEndWhy` and `planEndAt` become the end's record, written with it (`planEnd` equal to the ended
  state) by `programmeLifecycleStore.ts#decideInTx` in the same transaction, and cleared by a reopen. The D-51
  auto-retire in `CoordStore#closeRun` is deleted, `setProgramState` and `closePlan` stop being writers, and every gate
  that read `planEnd` reads `isEnded(state)`. Linear's `programmeEnd` reads the decision, Abandoned never syncing as
  completed. The refusal code `plan-closed` is kept for the ended programme (no second code). A boot re-measure records
  any state an older build wrote after a rollback. Overturns D-51 and D-8558's "NOT `programs.state`". The unmerged
  kept-worker branch (D-8980..D-8982) reads the same predicate.
- **D-8984 (2026-11-24)** — activity-is-derived. Open, Active and Idle are never stored: `lifecycleOf` in
  `shared/programmeLifecycle.ts` decides them from the stored decision and the runs. An open run is any non-terminal
  run (the store's existing predicate, `planned` and `unknown` included); Active needs an open run and a run that was
  ever dispatched (read from `run_events`), so wave N+1's planned run keeps a programme Active and a never-dispatched
  programme is Open. Stored `unknown` and an out-of-vocabulary value show Unknown, are never folded, and leave only by
  the operator's repair edge.
- **D-8985 (2026-11-24)** — the-coordinator-is-a-stored-binding. `programs.coordinator` with `coordinatorUuid` names the
  programme's lead (one writer, `bindCoordinatorInTx`), seeded by the migration only from open runs. It moves only
  through `CoordStore#reclaimProgram`, which moves open runs' `claimedBy` with it in one transaction, from the hand-over
  door, the reclaim door and `moveClaims` (whose release clears both), under reclaim's heir rule. `claimsProgramme`
  reads it and compares the uuid, so an Idle programme keeps its owner and a reused session id owns nothing; `openRun`
  binds an empty binding, refuses another claimant with today's `claimed-by-another`, and takes over a binding measured
  absent only when no run is open; `soleActiveCoordinator` resolves over programmes that show Active. Overturns spec
  2026-10-17 §8's "coordinator-ness is derived from claims"; its "a lighter run kind is out of scope" stands.
- **D-8986 (2026-11-24)** — join-at-spawn-and-provisional. Every session `roleOf` calls a coordinator joins a programme,
  held ones included. Create routes and the start sheet only record a pick; the join sweep over live registry rows is
  the one act site, joining a settled spawn (uuid present, seen twice with no `.child`) that has no membership in a
  live programme: to its pick, or to a minted placeholder `p-<base36 ms>`. `programme_members` records every joined
  incarnation; a programme has one lead and any number of members, so a second session picking a led programme joins
  as a member. A placeholder can hold no run, plan, item, statement, pin or rank (`programmeWritable`, every slug-keyed
  write door); filing marks it `filed` and never deletes it or its events; the operator can withdraw one, and it is
  withdrawn when its session joins a real programme or turns out to be a child. The sweep's first pass is R9's
  one-time pass. No ccd verb is added. The start card becomes unconditional, and the join mail carries its filing
  sentence. Overturns D-8142's conditional wording.
- **D-8987 (2026-11-24)** — an-end-is-proposed-then-confirmed. The coordinator's end proposal raises a decide item
  (`action:'end-programme'`) with required evidence against the definition of done (free lines when none is pinned);
  `plan close` raises the same proposal with its own outcome and evidence and no longer ends anything; the operator or
  the Overlord confirms (the operator behind a step-up, the Overlord through its door) or declines. The proposal belongs to the programme: a hand-over keeps it, a
  run opened withdraws it. A direct end over open runs must name `abandonRuns` and is always Abandoned; the archive
  door's programme end is an explicit decision. Changes pinned coordinator clause 22.
- **D-8988 (2026-11-24)** — overlord-programme-lifecycle-cell. A `programme-lifecycle` cell (full rung only) and door
  rows give the Overlord every programme edge the operator has, pause, reopen and repair included. The cell is the whole
  permission (no decision-model row, no step-up), and an Overlord act is recorded in the programme's history like any
  other, with no call-record entry or Seen to clear (the operator's amendment of 2026-11-24: maximum autonomy, no
  unnecessary admin burden).
- **D-8989 (2026-11-24)** — the-programme-tells-its-story. `programme_events` (append-only and never deleted, one row per
  decision, mint, join, binding change, filing, withdrawal, end proposal and coordinator exit or return, each with actor
  kind, actor, why and detail) and `GET /api/programmes/:slug/history`, which merges them, and those of placeholders
  filed into the programme, with the runs and `run_events`. Derived transitions (Open to Active, Active to Idle) write
  no programme event; the run rows record them.
- **D-8990 (2026-11-24)** — migration-by-rule-backfill-by-private-file. The migration names no programme and skips the
  reserved row: a set `planEnd` makes the state its own outcome; an ended state over open runs becomes `active`; any
  other D-51 end is kept until the operator decides; `active`, `paused` and `unknown` stay. Each changed or kept row is
  recorded. The operator's per-programme decisions are applied from a private file through `POST
  /api/programmes/decisions` (preview, then apply with a step-up, idempotent), right after the model and the doors
  deploy together; its answer reports unlisted rows and placeholders apart from R9's counts. The file and its slugs never
  enter the repository.
- **D-8991 (2026-11-24)** — the-plain-role-retired. A non-child top-level session that is not the Overlord, an auditor
  or a replay is `coordinator`; `coordinator-or-plain`, its undecided profile and the `plain` role row go. The
  renderer auditor and replay reuse stays. The plain auto-memory door refuses `role-retired` for one release.
  Overturns the Overlord spec's §3.3.9 `plain` row and W1a's Settings row.
- **D-8992 (2026-11-24)** — idle-is-not-ended. An Idle programme raises no Waiting-on-you item for idleness (an open end
  proposal still shows), stays in the portfolio, is not folded under Finished, and its ticks mail its coordinator
  (refused `no-coordinator` when it has none). The Programmes screen's chips and the Fleet header's idle link make it
  easy to reach. Narrowing acts (pause, decline) work while sign-in is dark and record `flag-off`; widening ones refuse.
  Overturns the `PROGRAMME_ENDED_SENTENCE` rule of refusing a tick whenever no run is open.
