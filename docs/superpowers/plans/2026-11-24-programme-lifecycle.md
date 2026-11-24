# Programme lifecycle: plan

Spec: `docs/superpowers/specs/2026-11-24-programme-lifecycle-design.md`. Deviations D-8983..D-8993 (issued).

## The operator's rulings of 2026-11-24

R1 to R10 in the spec's §1: every coordinator joins a programme at spawn; a programme is a business objective; the
Overlord starts and ends programmes (amended the same day: the Overlord has every programme act the operator has, at
maximum autonomy, with no acknowledgement queue and no step-up, its acts recorded in the history like anyone else's); an end is proposed by the coordinator and confirmed by the operator or the
Overlord, never a side effect (D-51 goes); the states are Open, Active, Idle, Paused, Done and Abandoned; no
Waiting-on-you item for idleness; a coordinator's exit leaves "no coordinator", not an end; every programme's page tells
its story; the backfill is the operator's per-programme decisions, applied from a private file; the `plain` role is
aligned with R1. R11 (same day): one coordinator owns one programme and one programme has one coordinator, at any one
time; a coordinator whose programme ended may be given a new one; there are no members. The spec's §3 states the
ownership rules as eight plain sentences; every wave below holds to them.

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
| W1 | The model: migration (with the unambiguous-pair seed and its conflicts), the one writer, `lifecycleOf`, D-51 removed, gates re-pointed, the 1:1 binding through `reclaimProgram`, the boot re-measure | — |
| W2 | The doors: start, state, hand over, end proposal, plan close, confirm, decline, archive, ticks, history, reads | W1 |
| W3 | The backfill door and its conflicts list (the operator applies the private file and resolves the conflicts from a shell right after W1 and W2 are deployed) | W2 |
| W4 | Join at spawn: picks and their guard, the join sweep, placeholders, filing, the start card, skill clause 22 | W1, W2 (file door) |
| W5 | The role code: `plain` retired | — (parallel with W1) |
| W6 | The console: lifecycle words, chips, coordinator line, History, controls, Finished fold, portfolio, coordinators with no programme, the create sheet opening a led programme's coordinator, the Settings upload for the backfill | W2, W3, W4 |
| W7 | The Overlord's cell and door rows, including its archive row | W2 |

**W1 and W2 roll out together.** W1's gates read `isEnded(state)`, and a D-51 end the migration keeps (spec §13 step 4)
then refuses its next wave with `plan-closed` until the operator reopens it, which needs W2's state door. So the
rollout that carries W1 also carries W2, and the operator's backfill (W3) follows it at once: the window in which a
programme the operator wants Idle still reads Done is one deploy, not several.

## W1: the model (one PR, server and `shared/`)

1. **Characterization.** `coord-store-programme-lifecycle-char.test.ts`: today's `openRun` row creation, `closeRun`'s
   retire (`done`/`abandoned` at zero open runs), `programmeLive` on `planEnd`, `soleActiveCoordinator` on `state`,
   `claimsProgramme` on open runs, `reclaimProgram` and `moveClaims` on `claimedBy`, and `openRun` admitting one
   session as claimant in two programmes (the case R11 refuses). Green on `main`. Later tasks flip
   the rows they change in their own commits.
2. **`shared/programmeLifecycle.ts`** (L0, imports nothing): `ProgrammeLifecycle`, `lifecycleOf(stored, placeholder,
   runs)`, `isEnded(stored)`, `CoordinatorLine` and `coordinatorLineOf(binding, registry)`. Tests: the spec §3 truth
   table row by row: a programme whose only open run is `planned` after an earlier dispatched wave is Active; one whose
   runs were never dispatched (an abandoned `planned` run included) is Open; stored `unknown` and an out-of-vocabulary
   value are Unknown; a filed or withdrawn placeholder has no lifecycle. `coordinatorLineOf`: a uuid mismatch and an
   archived row are `no-coordinator`; an unreadable registry, an unreadable uuid and a mid-swap row are `unmeasured`.
   Mutations: fold `unknown` into `active` → red; count `planned` as not open → red.
3. **Migration** (the next slot when the PR lands): columns `coordinator`, `coordinatorUuid`, `coordinatorSince`,
   `placeholder`, `filedInto`; the partial unique index on `(coordinator, IFNULL(coordinatorUuid, ''))`; tables `programme_events`
   (with its `(program, at)` and `(session, sessionUuid)` indexes) and `programme_picks`; the `started`, `coordinator`
   and `migrated` events; the state rule (spec §13 step 4), then the binding seed (step 3, after step 4). Tests from
   the previous version's fixture: a D-51 `done` row with an open run migrates to `active` and shows Active; a D-51
   `done` row with no open run stays `done` with its `migrated` event; a `planEnd='abandoned'` row reading `done`
   becomes `abandoned`, and a `planEnd='done'` row reading `abandoned` becomes `done`; `paused`, `unknown` and an
   out-of-vocabulary value are untouched; the reserved `linear-sync` row is skipped; one `started` event per row; the
   binding seeded only for an unambiguous pair (one claimant, claiming open runs in no other programme), with a null
   uuid, none for a programme that step 4 leaves ended; a live programme with no open run seeded with the claimant
   `main`'s `openRun` admits (its lowest claimed run, any state) when that session is unambiguous, and given a
   `past-claimant-in-several` event naming it otherwise; a session claiming open runs in two programmes binds to
   neither and each gets a `migrated` event naming `session-in-several` with the claimant in `session`; a programme whose open runs
   two sessions claim binds to none (`programme-several-claimants`); no `programme_members` table exists; the
   migration's SQL holds no string literal that could be a slug (a scan). Rollback: a database one version newer is read as-is with the warning
   (`sqliteFile.ts`'s rule), never refused.
4. **`server/src/coord/programmeLifecycleStore.ts`** (L3): `decideInTx(slug, edge, actor, why, detail)`, `mintInTx`,
   `bindCoordinatorInTx`, `pickInTx`, `fileInTx`, `appendEventInTx`, and the read `programmeOf(session, uuid)` (the
   binding from the coordinator's side). `CoordStore#setProgramState` and
   `planStore.ts#closePlan` become private steps of `decideInTx` or are deleted; `mintInTx` admits an initial `paused`
   for the Linear backlog only (actor kind `system`). Tests: every edge writes one event with actor and why; an equal
   target writes nothing; an end writes `planEnd` fields equal to the state in the same transaction; a reopen clears
   them; a repair records the unreadable value; an end (confirm, direct, archive, a repair to an end) releases the
   binding in the same transaction and names the released coordinator in the `ended` event; `bindCoordinatorInTx`
   refuses `owns-another-programme` for an incarnation that owns another live real programme, and with that check
   deleted the partial unique index still refuses (both measured red), for a uuid binding and for two null-uuid
   bindings of one session id (red without the index's `IFNULL`); moving a session from its placeholder to a real
   programme clears the placeholder's binding first (red if the order is swapped: the index fires mid-transaction). Census (`single-definition/`): `UPDATE programs
   SET state`, `SET planEnd`, `SET coordinator`, `SET placeholder`, and inserts into `programme_events` and
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
7. **`openRun`**: rows created only through `mintInTx` (event `started`, actor the claimant, who is bound, and whose
   unfiled placeholder is unbound and filed into the new row), and only for a claimant that owns no live real programme
   and claims no open run in a programme it does not own (else `owns-another-programme`, naming it), and that owns its
   unfiled placeholder or has never been joined (else `not-your-programme`, "you own no programme now"); refusals `programme-paused`, `programme-unknown` and `programme-provisional`;
   a claimant that is not the bound coordinator is refused `claimed-by-another` when the binding names another (measured
   absent included) and `not-your-programme` when there is no binding; it never binds an existing programme and never
   takes one over (spec R11 rule 8); withdraws an open end proposal in its transaction. Tests: each refusal; a
   coordinator owning programme A opening a run in a free programme B is refused `not-your-programme` and in a new slug
   `owns-another-programme` (red with either check removed); a conflict's party (open runs in A and B, owning neither)
   opening a new slug is refused `owns-another-programme`; a coordinator whose programme was handed over opening a new
   slug is refused `not-your-programme`; a coordinator owning only an unfiled placeholder opening a
   new slug owns the new programme and its placeholder reads `filed`; a programme whose coordinator exited is not taken
   by a run; a Linear backlog programme refuses its first wave until it is resumed; a recycled slug cannot be ended and
   opened in one transaction.
8. **The binding**: `CoordStore#reclaimProgram` keyed on the programme, moving every claimed run's `claimedBy`,
   finished ones included, as `main` does (D-8199), and calling `bindCoordinatorInTx` in one transaction (the binding
   alone for a programme with no claimed run); `moveClaims`'s release clears both; the ladder re-keyed as
   `reclaim.ts#reclaimProgrammeTo(slug, heir, opts)` with each caller's rungs as spec §3's table states them (the
   hand-over door skips rung 4 as `displacing` and mails the displaced session; picks and filings take only
   `no-coordinator`; rung 1 answers `unknown-programme` for the programme-keyed callers); reclaim's heir rule gains the
   rung `owns-another-programme` (an heir's unfiled placeholder is withdrawn instead); `CoordStore#claimsProgramme` reads the binding and compares the uuid (D-5298's comparison; the
   id alone for a seeded null uuid); `soleActiveCoordinator` resolves over programmes that show Active; a session left
   owning nothing by a move, a release or an end gets one system mail ("You own no programme now"). Tests: after a
   hand-over, run-keyed mail, the close check and the stall notices name the heir, and the previous coordinator owns
   nothing; an heir that owns another live programme is refused and nothing moves (red with the rung deleted); after a
   release, the next coordinator's `openRun` is refused `not-your-programme` until a pick, filing or hand-over binds
   it; the hand-over door moves a live coordinator's programme to an heir (rung 4 skipped, red if asked) and mails the
   displaced session; the reclaim door still refuses `claimant-alive`; a hand-over to a programme with no binding and no
   claimed run moves the binding alone (red if rung 2 is asked); W1's characterization of the all-rows move stays
   green; a reused session id with a new uuid owns nothing; an Idle programme's coordinator still owns it; wave N+1
   `planned` with wave N closed keeps run-less mail resolving; two Active programmes → null; reclaim writes a
   `coordinator` event; a census that nothing but `reclaimProgram`, `mintInTx`, `fileInTx` (every filed or withdrawn placeholder,
   from the re-file withdraw, the led-programme refusal, the heir and start paths and the child found late), `decideInTx`'s
   end release, the registry lane's uuid stamp and seeded-binding release, and the boot re-measure calls
   `bindCoordinatorInTx`; a withdrawn placeholder's session can then be handed a programme (red if `fileInTx` leaves
   the binding).
9. **The boot re-measure** (spec §15): rows with no `started` event get one; a row whose stored state differs from its
   newest event's `toState` goes through step 4's rule with a `migrated` event; an ended row's binding is released; a
   live row whose open runs' claimant differs from its binding goes through step 3's rule. Tests: a `done` written with
   no event (an older build's D-51) over an open run becomes `active`; one with no open run is kept and recorded; a
   second programme claimed by one session under an older build is left unbound and listed as a conflict; a second
   boot writes nothing.

### W1 notes (review round 1, 2026-11-24)

- **Moved to W2, with its doors:** the "You own no programme now" mail (item 8). Every move W1 reaches leaves a session that
  is being put down: the reclaim door's displaced claimant measures gone (rung 4), and `moveClaims`' is the session the
  operator is archiving or stopping; the ends W1 reaches are the coordinator's own `plan close` and the operator's abandon
  with an end. The mail matters from W2's hand-over and decide doors, where a live coordinator is displaced, and ships with
  them, beside the decline's mail. Withdrawing an open end proposal on `openRun` (item 7) moves too: proposals exist only
  from W2.
- **The ladder, keyed on the programme (item 8):** W1 adds `reclaim.ts#reclaimProgrammeTo(deps, slug, from, heir, opts)`
  and `CoordStore#reclaimProgramme(slug, from, …)` over the same ladder and writer, so `moveClaims` moves an Open or Idle
  programme's binding (and its finished claims) when the session claims no open run of it. The run-keyed door stays
  `reclaimRun`. The per-caller rung table (the hand-over door skipping rung 4 and mailing the displaced session; picks and
  filings taking only `no-coordinator`; rung 1 `unknown-programme`) ships with those callers, in W2 and W4.
- **Brought forward from W2 and W4**, because W1 can reach `main` and a prerelease on its own: the archive door's
  `programme:'end'` ends the programme by decision (W2 item 5; it ended nothing once D-51 was gone), CLAUDE.md's "Open
  wave N+1's run BEFORE closing wave N's" reason (W2 item 8), and the coordinator skill references' "the server retires
  the program" sentences (`wave-steps.md`, `wave-lifecycle-5-boundary.md`, `wave-lifecycle-6-final-merge.md`; W4 item 6).
- **Review fixes recorded on the deviations below:** a plan put on a new slug is a start (D-8993); the first recorded end
  stands, and a kept D-51 end has no effect outside the database until it is decided (D-8983); the plan's owner is the
  binding (D-8985); `moveClaims` asks R11 rule 4 before its first move (D-8993).

## W2: the doors (one PR, server)

1. **`POST /api/programmes`** (start, binding the named coordinator, or none for the start sheet's pick),
   **`POST /api/programmes/:slug/state`** (`pause`, `resume`, `end`, `reopen`, `repair`),
   **`POST /api/programmes/:slug/coordinator`** (hand over, through `reclaimProgram`), all in
   `server/src/coord/ledgersRoutes.ts`'s operator registration. Decisions in an L1 decider
   `programmeEdgePolicy.ts#edgeDecision(stored, placeholder, runs, edge, actorKind)` and the credential rule of spec §14
   in one L1 table; the route acts. Tests: the transition table (spec §5) row by row, including `end` over open runs
   without and with `abandonRuns`, Done refused over open runs, every edge allowed for the Overlord without a step-up, every edge
   refused on a placeholder, pause working while sign-in is dark with actor `unmeasured` and `flag-off`, the step-ups,
   the Overlord's start refused without a coordinator; the operator's start without a coordinator refused
   `coordinator-required` until W4 ships the pick (W4 lifts it, with a test); a start naming a coordinator that owns another live programme
   refused `owns-another-programme` (and one owning only an unfiled placeholder admitted, the placeholder withdrawn); a
   hand-over to such an heir refused; every end leaving the programme with no coordinator; a reopen showing "No
   coordinator".
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
6. **Ticks on idle** (unchanged by R11): `PROGRAMME_ENDED_SENTENCE` is refused only for an ended programme; an idle tick mails the bound
   coordinator; with none, `no-coordinator`. Tests: Idle tick delivered; ended tick refused; unbound refused.
7. **Reads**: `GET /api/programmes/:slug/history` (programme events, those of placeholders filed into it, runs and
   `run_events`, oldest first) and `GET /api/sessions/:id/programme` (the session's one programme, or `none` with why).
   `programmesRead.ts#readProgrammes` adds `lifecycle`, `coordinatorLine`, `placeholder`, `pausedOpenRuns` and
   `claimConflict` to `ProgrammeRow` and a `coordinatorsWithoutProgramme` list (additive) and skips the reserved row.
   Tests: the merged order; a migrated row says so; a coordinator that handed over is listed without a programme, with
   why, and one that is a conflict's party is not.
8. **Census**: `LEDGER_OPERATOR_DOORS`, `gate.ts` EXEMPT for the box-token doors, `auth-gate.test.ts`, CLAUDE.md's
   box-token sentence in the same commit (`box-token-census.test.ts` checks both directions). Also CLAUDE.md's
   "Open wave N+1's run BEFORE closing wave N's" bullet: its reason changes from "the server retires the program" to
   "mail with no run id resolves only over a programme that shows Active, and the open `planned` run keeps it Active".

## W3: the backfill door (one PR, then the operator's act)

1. `POST /api/programmes/decisions` (spec §13): preview by default, `apply:true` behind the step-up; posted from the
   operator's shell with a session (the Settings upload rides W6). Tests (neutral slugs only): each preview refusal,
   the reserved row and a placeholder included; `active`/`idle`/`open` mismatches reported and not forced; a D-51
   `done` row decided `idle` takes the reopen edge; an Unknown row decided takes the repair edge; a second apply writes
   zero events; the answer's counts over the listed rows, its `unlisted`, `placeholders`, `conflicts` and reserved-row
   lines; a `session-in-several` conflict leaves the list after a hand-over of each of its programmes (the first to the
   party itself, admitted by R11 rule 4's exception; the second to another coordinator, the party mailed), and a file
   entry never resolves one.
2. **Operational, not a PR**: right after W1 and W2 are deployed, the operator previews then applies the private
   decisions file from a shell, checks the listed counts against R9's 56, decides or leaves each `unlisted` row, and
   resolves each conflict with a hand-over (1 measured on 2026-11-24: one session holding open runs in two
   programmes).

## W4: join at spawn (one PR, server, ccd text, skill)

1. **`programmeJoin.ts#joinDecision`** (L1), its "who joins" input being `roleOf`'s answer and its history input
   "this incarnation has ever been joined" (bound now, or named by a `coordinator` event). Tests: child, Overlord,
   auditor, replay → skip; a held coordinator joins; a row seen once, or with no uuid → skip (not settled); an
   unreadable marker → skip unmeasured; bound now → `already-joined`; a coordinator that handed over, whose programme
   ended, or whose placeholder was withdrawn → `already-joined`, never minted (red if keyed on current ownership); a
   session claiming open runs with no binding (a conflict's party) → skip; a conflict's party whose programmes were
   both handed to others (named only by its `migrated` event) → `already-joined`, never minted (red if the migration
   event is not read); a reused id with a new uuid → joins as new; a pick whose programme is free → `join-picked`; a
   pick for a session joined before that owns nothing → `join-picked` (a revival); a pick whose programme gained a live
   coordinator, a live claimant or an end → `pick-taken`, which mints only for a session never joined.
2. **Picks**: `POST /api/sessions` and the non-child arm of `POST /api/projects/:project/workspaces` (optional
   `programme` body field) ask the pick guard (spec §5's pick row), then record a pick before the start; the
   start-programme sheet (`StartProgramSheet.tsx`) passes its slug. Tests: a programme whose line is `led`, or with an
   unexpired pick or reservation, or whose open runs a present session other than the binding claims (a conflict), is
   refused `programme-has-coordinator` naming that session and no session is started (red with the guard removed);
   `unmeasured` → `coordinator-unmeasured`; ended, placeholder → their codes; a revival of a row that owns another
   programme → `owns-another-programme`; the reservation is written before the start and keyed by ccd's answered id
   after it (a plain `ws-add` included); a start ccd refuses drops the reservation, and the next pick of that
   programme is admitted; a pick expires after an hour; the operator's start with no coordinator is admitted now; the
   kickoff stays mail-only.
3. **The join sweep**: measure which existing lane re-reads the registry for the coordination store and extend it; if
   none fits, record the "legitimately different" reason in the PR. Live rows only. It completes picks through
   `reclaimProgram` (moving any open runs), mints `p-<base36 ms>` placeholders (a collision retries with a suffix) on
   `mint-provisional` and `pick-taken` (for a session never joined), drops a pick whose ladder refuses and treats it as
   `pick-taken` (a second pass does not retry it), unbinds a session whose `.child` marker appears late, stamps a seeded binding's
   uuid, and writes `coordinator-gone` / `coordinator-back` per incarnation after two passes. Tests: a hand-started
   session is joined on its second settled pass; a `ws-add` child whose `.child` lands between passes is never joined;
   one whose marker appears after a join is unbound and its placeholder withdrawn; a pick and a sweep in the same window
   mint nothing; a pick into a programme whose coordinator exited takes it over with its open runs; `pick-taken` mints
   and the mail names the programme's coordinator; an exited row is left alone; a second pass writes nothing; a swap
   reads `unmeasured` and writes no exit; a seeded null uuid is stamped once; a seeded binding whose session is absent
   on the first pass is released with one `coordinator` event and no `coordinator-gone`.
4. **Filing**: `POST /api/programmes/:slug/file` (box token, the placeholder's coordinator) and
   `POST /api/programmes/:slug/refile` (operator, including `{withdraw:true, why}`), one L1 decision `fileDecision`.
   `{name, title}` and `{into}` a programme with no live coordinator (none, or measured absent with no present claimant, taken through
   `reclaimProgram`) mark the placeholder `filed` and bind the session; `{into}` a led programme answers 409
   `programme-has-coordinator` naming it and withdraws the placeholder in the same transaction, with no auto-archive;
   `{into}` an `unmeasured` one refuses and writes nothing; nothing is deleted. `programmeWritable(row)` is asked by
   every slug-keyed write door (spec §7's list), and a census lists those doors. Tests: every arm and refusal; the
   target's history shows the placeholder's events; `/remaining`, `/spec`, `/calls`, `/modifications`, the portfolio
   rank and goals ratify refuse an unfiled placeholder; after the led-programme refusal the session owns nothing, is
   listed without a programme and is still running (red if the arm binds it or archives it).
5. **The start card**: `ccd/session-hook.sh#_hook_role_card`'s fresh and revival texts become unconditional (spec §7),
   with the one-programme sentence, the led-objective sentence, and the "You own no programme now" text for a session
   whose programme read answers `none`. Tests: the hook suite's card-text pins; card-off, children, held sessions and a
   start whose anchor printed still get no role card, and the join mail carries the filing sentence.
6. **The coordinator skill**: clause 22 (`ccd/coordinator-skill/SKILL.md`) says the end is proposed with `plan close`,
   with evidence against the definition of done, and confirmed by the operator or the Overlord;
   `coordinator-skill.test.ts` updated in the same commit. References (`plan.md`, `api.md`, `resume.md`,
   `wave-steps.md`, `wave-lifecycle-5-boundary.md`, `wave-lifecycle-6-final-merge.md`) lose "the program retires" and
   gain filing, one coordinator per programme and one programme per coordinator (a led objective gets your work by mail,
   not a second coordinator; with no programme, open no runs), and the end proposal. `claimed-by-another` keeps its name
   everywhere.

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
   dark-sign-in sentence and the conflict sentence; Pause, Resume, End, Reopen, Repair, Hand to coordinator and Re-file
   controls, each asking for a why; the end proposal shown on Open, Idle and Paused programmes.
5. The Programmes screen's **Coordinators with no programme** list (spec §6): why and since when, with Start a
   programme, Hand it a programme and Archive. The create and start sheets show each programme's coordinator line and,
   on `programme-has-coordinator`, open the named coordinator's session instead of starting one.
6. Settings, "Apply programme decisions": uploads a file from the operator's device to W3's door, preview then apply.
7. Tests: an Idle programme is under the Idle chip and not under Finished; its items are live; no Waiting-on-you row
   is raised for idleness; an open end proposal shows on an Idle programme; each control posts the right edge; the
   History renders every event kind; picking a led programme opens its coordinator and starts nothing; a coordinator
   with no programme is listed with its three acts and nothing archives it automatically.

## W7: the Overlord (one PR)

1. `RUNG_CELL_MAP` gains `programme-lifecycle` (full only); `overlordDoors.ts` rows for every programme edge the
   operator has (start, pause, resume, end, confirm, decline, reopen, repair, hand over, re-file, withdraw a placeholder).
   No decision-model row, no call-record entry, no step-up. An archive row (spec §10): the archive door for a
   coordinator with no programme (no live programme, no open run, re-measured at the act) and for archive-end. A start
   row (R12, spec §10): the Overlord starts a new top-level session as a new programme's coordinator, or as the
   coordinator of a programme that has none, through the operator's create routes and the pick's guards. Tests: refused at chat and advise, allowed at full; the event's
   `actorKind` is `overlord`; no call record row and no operator item is written for an Overlord act; below full, a
   proposal's item says it waits on the operator; the archive row archives a coordinator with no programme and refuses
   one that owns a live programme or claims an open run (red with the re-measure removed).
   The start row: a new programme and its coordinator in one act, with `started`, `joined` and `coordinator` events,
   actor the Overlord; a pick of a programme with a live coordinator refused `programme-has-coordinator`; a create
   refusal (pool, disk floor) answered in the route's words with no programme left behind (the start rolls back).
   Children stay the coordinator's (R12): no Overlord door opens a run, dispatches, reclaims, archives, keeps or
   releases a child, or answers a child; a test lists `overlordDoors.ts`'s rows and refuses any child-workspace act,
   and the archive row refuses a `.child` session (`is-child`).
2. `OVERLORD_OPERATOR_DOORS` and CLAUDE.md's sentence updated in the same commit.

## Deviations found

- **D-8983 (2026-11-24)** — one-end-fact-one-writer. `programs.state` is the programme's one decision fact and its end
  fact; `planEnd`, `planEndWhy` and `planEndAt` become the end's record, written with it (`planEnd` equal to the ended
  state) by `programmeLifecycleStore.ts#decideInTx` in the same transaction, and cleared by a reopen. The D-51
  auto-retire in `CoordStore#closeRun` is deleted, `setProgramState` and `closePlan` stop being writers, and every gate
  that read `planEnd` reads `isEnded(state)`. Linear's `programmeEnd` reads the decision, Abandoned never syncing as
  completed. The refusal code `plan-closed` is kept for the ended programme (no second code). A boot re-measure records
  any state an older build wrote after a rollback. Overturns D-51 and D-8558's "NOT `programs.state`". The unmerged
  kept-worker branch (D-8980..D-8982) reads the same predicate. Amended in the W1 review: the first RECORDED end stands
  (`decideInTx` refuses a different end over one, `already-ended`; only a reopen moves it, and the boot re-measure's
  `migrated` edge follows the record an older build wrote), and an end is recorded when `planEnd` equals the state
  (`endRecorded`). A D-51 end the migration kept (`planEnd` unset) is not, until the operator decides: every gate inside
  ccrc reads `isEnded`, but the two acts no reopen undoes wait for a recorded end: the timers lane cancels no timer for a
  kept end (`CoordStore#programmeEndDecided`), and the Linear sync maps a kept end exactly as `main` did
  (`planPolicy.ts#programmeEnd`). The boot re-measure is a re-measurement, not a migration: a throw rolls it back whole and
  the server starts on the rows as they are, saying so.
- **D-8984 (2026-11-24)** — activity-is-derived. Open, Active and Idle are never stored: `lifecycleOf` in
  `shared/programmeLifecycle.ts` decides them from the stored decision and the runs. An open run is any non-terminal
  run (the store's existing predicate, `planned` and `unknown` included); Active needs an open run and a run that was
  ever dispatched (read from `run_events`), so wave N+1's planned run keeps a programme Active and a never-dispatched
  programme is Open. Stored `unknown` and an out-of-vocabulary value show Unknown, are never folded, and leave only by
  the operator's repair edge.
- **D-8985 (2026-11-24, amended the same day for R11)** — the-coordinator-is-a-stored-binding.
  `programs.coordinator` with `coordinatorUuid` names the programme's coordinator (one writer, `bindCoordinatorInTx`),
  seeded by the migration only for an unambiguous pair of open runs and their one claimant, or, for a live programme
  with no open run, the unambiguous claimant `main`'s `openRun` admits today, with a null uuid the first registry pass
  stamps (or releases, when the session is absent). It moves only through `CoordStore#reclaimProgram`, which moves every
  claimed run's `claimedBy` with it in one transaction (finished rows too, D-8199's choice kept), from the hand-over
  door, the reclaim door, `moveClaims` (whose release clears both) and a pick or filing that takes a programme whose
  coordinator is measured absent, through reclaim's ladder re-keyed on the programme with each caller's rungs stated
  (the hand-over door skips `claimant-alive` as `displacing` does and mails the displaced session); an end releases it.
  `claimsProgramme` reads it and compares the uuid, so an Idle programme keeps its owner and a reused session id owns
  nothing. `openRun` never binds or takes over an existing programme: another claimant is refused `claimed-by-another`
  when a binding names someone else and `not-your-programme` when there is none (as first written, it bound an empty
  binding and took over one measured absent; R11 removed both). `soleActiveCoordinator` resolves over programmes that
  show Active. Overturns spec 2026-10-17 §8's "coordinator-ness is derived from claims"; its "a lighter run kind is out
  of scope" stands. Amended in the W1 review: every owner read passes the caller's attributed uuid (the ledger,
  remaining, calls, review-rounds, quiz and continuity doors and the note keys), the reclaim stamps the heir's MEASURED
  uuid (an unreadable one refuses `registry-unmeasurable`), and re-naming the current coordinator never changes its
  incarnation; the `coordinator` event names the caller's actor and why (the reclaim door is `system`/`unmeasured` with the
  door in its why; the archive and stop doors are the operator's); an ended programme or a filed or withdrawn placeholder is
  never bound (`programme-ended`), so a reclaim of an ended programme's run moves its claims and binds nobody. The plan's
  owner (`planStore.ts#planOwnerOf`) is the binding; a live programme released from its coordinator has no plan owner now,
  so the plan doors refuse every writer until a hand-over (`planOwnerless`), while an ended or never-bound programme keeps
  `main`'s rule, so the Linear sync still tells whoever ran it.
- **D-8986 (2026-11-24, amended the same day for R11)** — join-at-spawn-and-provisional. Every session `roleOf` calls
  a coordinator joins a programme, held ones included, and joining means becoming that programme's coordinator. Create
  routes and the start sheet only record a pick, after refusing a programme that already has a live coordinator or a
  pending pick (`programme-has-coordinator`, naming it, which the console opens instead of starting a session); the
  join sweep over live registry rows is the one act site, joining a settled spawn (uuid present, seen twice with no
  `.child`) that has never been joined (bound now, or named by a `coordinator` event or a migration event), or one that
  has a pick (an operator's pick completes for a joined session that owns nothing; picks are reserved before the start
  and keyed by the id ccd answers, and dropped when the start fails): to its pick, through
  `reclaimProgram`, or to a minted placeholder `p-<base36 ms>` (also when the pick was taken meanwhile). A session
  that has been joined is never minted again, so one that handed over, whose programme ended or whose placeholder was
  withdrawn owns nothing and is listed for the operator or the Overlord; a conflict's party is skipped. A placeholder
  can hold no run, plan, item, statement, pin or rank (`programmeWritable`, every slug-keyed write door); filing
  `{into}` a programme with no live coordinator, or as `{name, title}`, makes the session its coordinator, and filing
  into a led one answers `programme-has-coordinator` and withdraws the placeholder (no auto-archive); filing never
  deletes a placeholder or its events; the operator can withdraw one, and it is filed or withdrawn when its session
  takes a real programme, or withdrawn when the session turns out to be a child. The sweep's first pass is R9's
  one-time pass. No ccd verb is added. The start card becomes unconditional, and the join mail carries its filing
  sentence. As first written it kept `programme_members` (one lead, any number of members); R11 removed them.
  Overturns D-8142's conditional wording.
- **D-8987 (2026-11-24)** — an-end-is-proposed-then-confirmed. The coordinator's end proposal raises a decide item
  (`action:'end-programme'`) with required evidence against the definition of done (free lines when none is pinned);
  `plan close` raises the same proposal with its own outcome and evidence and no longer ends anything; the operator or
  the Overlord confirms (the operator behind a step-up, the Overlord through its door) or declines. The proposal belongs to the programme: a hand-over keeps it, a
  run opened withdraws it. A direct end over open runs must name `abandonRuns` and is always Abandoned; the archive
  door's programme end is an explicit decision. Changes pinned coordinator clause 22.
- **D-8988 (2026-11-24)** — overlord-programme-lifecycle-cell. A `programme-lifecycle` cell (full rung only) and door
  rows give the Overlord every programme edge the operator has, pause, reopen and repair included, plus an archive row
  for a coordinator with no programme and for archive-end; the pick, which starts a session, stays the operator's. The cell is the whole
  permission (no decision-model row, no step-up), and an Overlord act is recorded in the programme's history like any
  other, with no call-record entry or Seen to clear (the operator's amendment of 2026-11-24: maximum autonomy, no
  unnecessary admin burden).
  Amended (R12, 2026-11-24): the Overlord may start a new top-level session as a new programme's coordinator, or as the
  coordinator of a programme that has none; it delegates child workspaces to coordinators and has no door that acts on
  a child.
- **D-8989 (2026-11-24)** — the-programme-tells-its-story. `programme_events` (append-only and never deleted, one row per
  decision, mint, coordinator change, filing, withdrawal, end proposal and coordinator exit or return, each with actor
  kind, actor, why and detail; a coordinator change also carries the incoming session and uuid) and `GET /api/programmes/:slug/history`, which merges them, and those of placeholders
  filed into the programme, with the runs and `run_events`. Derived transitions (Open to Active, Active to Idle) write
  no programme event; the run rows record them.
- **D-8990 (2026-11-24)** — migration-by-rule-backfill-by-private-file. The migration names no programme and skips the
  reserved row: a set `planEnd` makes the state its own outcome; an ended state over open runs becomes `active`; any
  other D-51 end is kept until the operator decides; `active`, `paused` and `unknown` stay. Each changed or kept row is
  recorded. It binds a coordinator only for an unambiguous pair (or, with no open run, the unambiguous claimant `main`
  admits) and lists every other programme with open runs as a conflict (`session-in-several`, `programme-several-claimants`), which the backfill door's answer derives and the
  operator resolves by hand-over; 1 conflict measured on 2026-11-24. The operator's per-programme decisions are applied from a private file through `POST
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
- **D-8993 (2026-11-24)** — one-coordinator-one-programme (R11). At any one time a live programme has exactly one
  coordinator and a coordinator owns exactly one live programme; an ended programme has none, and a coordinator whose
  programme ended may be given a new one. There are no members. The binding is the one fact, read both ways
  (`claimsProgramme`, `programmeOf`), with `bindCoordinatorInTx`'s `owns-another-programme` refusal and a partial unique
  index on `(coordinator, IFNULL(coordinatorUuid, ''))` behind it. Every way to own a programme (pick, mint, filing,
  first run of a new programme, start naming a session, hand-over, reclaim) refuses a session that owns another live
  real programme or claims an open run in one it does not own (an unfiled placeholder is filed or withdrawn instead;
  a conflict's party may be handed a programme whose runs it holds), and a pick or filing into a programme with a live
  coordinator or a live claimant is refused `programme-has-coordinator`. `openRun` never changes ownership except the
  first run of a new programme, which a session that has been joined and owns nothing may not open. Amended in the W1
  review: a `plan put` on a slug that does not exist yet is the same start as that first run (a new programme's run needs
  its plan first, so the put is where the start happens): it binds the putter with its attributed uuid, and is refused
  exactly as the run is (`owns-another-programme`, `not-your-programme`), never minting a programme nobody owns. An archive
  or stop door's hand-over asks rule 4 before its first move: a session holding the runs of several programmes is refused
  `owns-another-programme` with nothing moved (it is released, or each programme is handed over on its own), and so is an
  heir that owns another programme.
  A coordinator left owning nothing is told by mail, listed as a coordinator with no programme, never minted a new one
  and never archived automatically: the operator or the Overlord starts one for it, hands it one, or archives it. The
  migration never invents an owner. Overturns this spec's earlier "one lead and any number of members" and R2's "no
  rule ties one session to one programme".
