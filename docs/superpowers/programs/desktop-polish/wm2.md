# Task WM2: the task note (desktop polish run 2779, D-8779)

The note for the programme work map's Task WM2, written by its worker for the coordinator to fold into the ledger. Each
claim says whether it was **measured** (read on the tree, the live server or a test run by this task) or **inferred**.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| `WORK_STATUSES` (Table 6's fourteen rows in order, then `failed`), `WORK_GROUPS` (nine), `WORK_SOURCES`, `WORK_VERDICT_READS`, `WORK_READ_FAILED`, `WorkItemView`, `PhaseFinish`, `WorkPhaseView`, `WorkEpicView`, `WorkMapView`, `WorkAnswer` | `shared/plan.ts`, beside `PlanView` | Measured: `single-definition/plan.test.ts` (all five lists declared once) and `work-map.test.ts`'s vocabulary cases |
| `workMapOf`, the one decider (D2): each ticket's status (Table 6), each phase's reading, counts, carries and finish (Table 6a), the strip, the four plan states (§5.1) and the no-plan fallback | `server/src/coord/workMap.ts` (L1, C5) | Measured: `work-map.test.ts` |
| `WORK_STATUS_GROUP`, the status-to-group table (D3), declared once beside its decider | `workMap.ts` | Measured: `single-definition/plan.test.ts` |
| `doneEvidenceVerdict`, the read side of WM1's evidence rule (§4.1: verified when recorded and on every read) | `workMap.ts` | Measured: the `evidence:` cases |
| `verdictsReadOf`: the run verdicts reader as the map reads it, `not-read` while absent or empty, never "not stuck" | `workMap.ts` | Measured: the `verdicts:` cases |
| `CoordStore.programmeWorkRuns(slug)`: every work run of one programme with its ticket's key (`runs.ticketId` joined to `plan_tickets.key`), all-or-failure, no clamp | `server/src/coord/store.ts`, after `runs()` | Measured: the route cases and RM-4 |
| `PlanRouteOpts.runVerdicts` (`Pick<RunVerdicts, 'all'>`), wired to the watcher's reader | `planRoutes.ts`, `server.ts` (one property) | Measured: the route's stuck case (the option); the wiring line by the server compile |
| `GET /api/programmes/:slug/plan` answers `{ ok, plan, work }`; a read behind `work` that fails answers `work: { unreadable: <word> }` and still serves `plan` (F15) | `planRoutes.ts` (`workOf`, which gathers and decides nothing) | Measured: `plan-routes.test.ts`'s `plan show carries the work map` block |
| Three mutant sets and three floors | `server/test/sim/workMapSets.ts`, `mutation-floors.test.ts`, `mutation-floors.json` | Measured (§4) |

No migration: the map reads WM0's and WM1's tables and the existing run, item and landing reads (measured: no
`schema.ts` change on this branch).

## 2. Departures, named by slug (the plan's D-8779 entry carries the same list)

The first twelve are the build's, the next two came from CI's first fast run (§7), and the last three from review 2795's
fix round (§8).

- `closed-reads-nothing-yet`: the hierarchy's close with a reason (its Task 4.3) stores a close only as a drop of an
  Upkeep ticket (`plan take`'s close arm sets `state: 'dropped'` with `droppedWhy`, measured in `planRoutes.ts`), so no
  programme ticket can be told apart as closed. `workMapOf` takes the close as an input map (`closed`, ticket key to
  reason), Table 6 row 2 reads it and its cases pin it, and the route passes it empty until that task stores one.
- `evidence-and-verdicts-decided-in-l1`: the route gathers and never decides, so the per-evidence verdict is a second pure
  decider, `doneEvidenceVerdict`, and "the reader is empty" is `verdictsReadOf`, both in `workMap.ts`.
- `last-move-from-the-run`: `lastMoveAt` comes from the run, stamped by `withLastMoves` (its existing owner), not from the
  verdicts map, so a `not-read` reader keeps every row's last move (and see `last-move-unmeasured-is-absent` below).
- `dropped-tickets-are-items`: the top-level `items` list every ticket once, a dropped one with status `dropped`, and
  `counts.dropped` counts it; no phase list, epic list, `notInPhase` or "N of M" holds it ("not shown, never counted").
- `declared-reads-planBy`: "declared" reads `planBy`, which the plan store's one statement writes together with `planAt`
  (`UPDATE programs SET planBy = ?, planAt = ?`), so no new read.
- `run-row-title-nullable`: `WorkItemView.title` is `string | null` (null only on a no-plan run row) and the fallback's
  `waves` is null for a programme with no work run.
- `held-by-an-unread-run`: a ticket held by a run the programme's run read did not return reads `state-unknown`.
- `unreadable-words`: `work.unreadable` is the store's word (`run-unreadable`) for a run read that answers a failure, and
  `read-failed` for a read that throws. A landing line that cannot be read is no reason to blank the map: that ticket's
  evidence reads "could not be read" and the ticket reads done-unverified (left-open in an ended plan).
- `dropped-epic-while-it-holds-a-ticket`: a dropped epic stays on the strip while it holds any ticket not dropped, which
  `dropEpicInto` leaves only for done ones, so the strip's counts add up to the headline's (F3).
- `not-in-phase-only-when-phased`: `notInPhase` is empty for a plan that declares no phase (the card groups by epic there).
- `three-floor-keys`: `workMap.ts` holds three deciders, so three `MUTANT_SETS` keys and three floors, not one.
- `tests-beside-the-decider`: the cases and the decider were written in one sitting, so no run saw the new cases red
  before `workMap.ts` existed; each row's red is measured by its mutant instead (§4), which is the acceptance's measure.
  The plan's Step 2 is left unticked with a note (review 2795 F6, ruled by the coordinator). Measured after the fact by
  review 2795's tests lens, at `main` with this task's tests: the work-map suite cannot import, and the five first
  `plan-routes.test.ts` cases red while its 34 older ones stay green. This round's new cases were measured red before the
  fix where a fix came with them (§8.2), and under their mutants (§4).
- `map-words-are-plan-words`: the map's sources and verdict reads are lists in `shared/plan.ts` too (`WORK_SOURCES`,
  `WORK_VERDICT_READS`) with `WORK_READ_FAILED`, and `isPlanKebab` admits them with the statuses and groups, never the
  store's `run-unreadable` (§7).
- `characterization-reads-plan-only`: the WM0 characterization (`planPhasesFixture.ts#readCharacterizationPlans`) sets
  `work` aside, so it still pins that `plan` reads as before WM0 (§7).
- `fold-by-the-held-ticket`: a `{ runId }` folds in the auto ticket its run HOLDS (`runs.ticketId`, joined to its key by
  `programmeWorkRuns`; `ticketDoneVerdict` compares the same ticket by id), never the key minted from the run's id, so an
  auto ticket the orphan arm handed to the wave's next run under its first key folds too (review 2795 F1). A run outside
  the programme's work runs folds nothing: no auto ticket of this programme can be its own.
- `pr-evidence-folds-its-carrier`: a declared ticket done by `{ pr }` evidence folds in the auto ticket of each run the
  landing line ties to that pull request. The route reads the ties through their existing owner, `evidenceLinksOf`
  (`planRunFacts.ts`, which `plan ticket-done` reads too), and hands them in as `prLinks`; a tie that cannot be read folds
  nothing, and that ticket's `{ pr }` then reads unverified by its own landing read (review 2795 F2).
- `last-move-unmeasured-is-absent`: an item whose run's last move could not be read (the read failed, or the run is not
  among the work runs) carries no `lastMoveAt`, as `withLastMoves` leaves a run, while null means no run or no move. The
  shared type marks the field optional and says so (review 2795 F3).

## 3. Rows, and what reds each

Every case lives once in `server/test/workMapCases.ts`; `work-map.test.ts` runs it against the real module, and the
mutant sets against each mutant.

### 3.1 Table 6 (a ticket's status)

| Row | Case(s) | Reds when | Basis |
|---|---|---|---|
| 1 dropped | `row 1: …`; `row 1 before row 2: …`; `a dropped ticket is in no total` | T6-1 | Measured |
| 2 closed | `row 2: …`; `row 2 before row 3: …`; 6a `row 2` cases | T6-2 | Measured |
| 3 done (verifies) | `row 3: …`; `row 3 before row 5: …` | T6-3 | Measured |
| 4 done-unverified (live plan; no evidence stored reads "no evidence stored") | `row 4: …` (both); `row 4 before row 6: …`; `a done-unverified ticket keeps its phase open` | T6-4, T6-4b, T6-G (its group) | Measured |
| 5 left-open, read before row 4 in an ended plan (L3-F1) | `row 5: …`; `row 5 before row 4: …`; `row 5 before row 6: …` | T6-5, T6-5b | Measured |
| 6 waiting on you (run's item, operator-act checkpoint's item) | `row 6: …` (three); `two epics with the same checkpoint key keep their items apart`; `row 6 before row 7: …` | T6-6, T6-6b, T6-6c, T6-6d | Measured |
| 7 stuck | `row 7: …`; `row 7 before row 9: …` | T6-7 | Measured |
| 8 blocked (planned only) | `row 8: …`; `row 8 reads only a planned run …` | T6-8, T6-8b | Measured |
| 9 working | `row 9: …` | T6-9, T6-9b | Measured |
| 10 state-unknown | `row 10: …`; `a ticket held by a run the read did not return …` | T6-10, T6-14b | Measured |
| 11 in-review | `row 11: …` | T6-11 | Measured |
| 12 merging (merging, closing) | `row 12: …` | T6-12, T6-12b | Measured |
| 13 queued | `row 13: …` | T6-13 | Measured |
| 14 not-started | `row 14: …`; `a failed run's ticket reads not-started with lastFailedRunId …` | T6-14, V-4, V-5 | Measured |
| Rows 7 and 8 need the reader | `verdicts not read skips stuck and blocked and says so`; the `verdicts:` cases | V-1, VR-1 to VR-3 | Measured |
| Review runs make no row | `a review run makes no row` | V-2 | Measured |
| A run's own ticket folds into the declared one | `a run's own ticket folds into the declared ticket it is evidence of` | V-3, V-3e | Measured |
| The fold reads the auto ticket the run holds (review 2795 F1) | `a reused auto ticket folds into the declared ticket its retry's run is evidence of` | V-3b | Measured |
| A `{ pr }` folds in its carrier's auto ticket (review 2795 F2) | `a pull request's carrier folds in: …` | V-3c, V-3d | Measured |
| Row 7 before row 8 (review 2795 F4 item 1) | `row 7 before row 8: …` | T6-7b | Measured |
| Rows 1 and 2 before row 5 in an ended plan (F4 item 2) | `row 1 before row 5: …`; `row 2 before row 5: …` | T6-1b, T6-2b | Measured |
| Table 6's Group column, rows 11 to 13 (F4 item 5) | `Table 6's Group column: rows 11, 12 and 13 …` | T6-G11, T6-G12, T6-G13 | Measured |
| `lastFailedRunId` only at not-started (F4 item 7) | `lastFailedRunId is set only on a ticket back at not-started` | V-4b | Measured |
| A last move not read is no field (F3) | `a run whose last move was not read gives its item no lastMoveAt; …` | V-6 | Measured |
| A verdict not handed reads "the evidence was not read" (F7) | `a done ticket whose stored evidence was not read …` | T6-4c | Measured |

### 3.2 Table 6a (a phase's reading)

| Row | Case(s) | Reds when | Basis |
|---|---|---|---|
| 1 dropped: not shown, not counted | `6a row 1: …`; `a dropped ticket is in no total` | T6a-1, R-2 | Measured |
| 2 closed: counted apart | `6a row 2: …`; `6a row 2 before row 3: …`; `a closed ticket alone does not finish its phase`; `6a row 2: a closed ticket is no part of its phase's own work …` (review 2795 F4 item 3) | T6a-2, T6a-2b | Measured |
| 3 carried out (to a phase not dropped) | `6a row 3: …`; `6a row 3 before row 4: …`; `a carry to a dropped phase is void`; `a phase's count excludes its carried tickets` | T6a-3, T6a-3b, C-3 | Measured |
| 4 done | `6a row 4: …`; `6a row 4 before row 5: …`; `a phase finishes at its latest own done or carry time` | T6a-4, F-4 | Measured |
| 5 left open (not finished) | `6a row 5: …` | T6a-5 | Measured |
| 6 outstanding | `6a row 6: …` | T6a-6 | Measured |
| Finish: empty, carry-only, unknown | `an empty phase is not finished`; `a phase whose every reference reads as nothing is empty`; `a phase that records only a carry out is finished at the carry`; `a finish with a missing time reads unknown` | F-1, F-2, F-3 | Measured |
| Carries read both ways, twice, from two, from a dropped source | `a ticket carried twice …`; `… from two names both`; `a carry from a dropped source stands …` | C-1, C-2 | Measured |
| Whole-epic references (D15), notInPhase | `a whole-epic reference takes a ticket added later …`; `two whole-epic references …`; `a ticket in no phase goes to notInPhase`; `a plan with no phases still fills epics and items` | R-1, R-3, R-4 | Measured |
| A phase's ticket references read through the fold (review 2795 F4 item 6) | `a phase that references only the folded auto ticket holds the declared ticket` | R-1b | Measured |

### 3.3 The view

| Rule | Case(s) | Reds when | Basis |
|---|---|---|---|
| The strip counts each epic over every phase and adds up to the headline (D16, F3) | `the epic strip …`; `the strip's counts add up to the headline's` | S-3 | Measured |
| An ended plan's strip leaves left-open out of its total (review 2795 F4 item 4) | `an ended plan's strip leaves a left-open ticket out of its total, …` | S-3b | Measured |
| A dropped epic's done ticket stays on its chip; an empty dropped epic is not listed | `a dropped epic's done ticket …` | S-1, S-2 | Measured |
| Checkpoints leave out dropped ones (F23) | `checkpoints met and total leave out dropped checkpoints` | S-4 | Measured |
| Four plan states (§5.1): ended, plan, declared-empty, runs | `6a row 5: an ended plan reads ended …`; `declared with nothing to count reads declared-empty`; `no plan: …` | S-5, S-6, S-7 | Measured |
| The fallback: newest first, failed apart, title equal to the programme's reads null, its verdicts | `no plan: …`; `a title equal to the programme's reads null`; `a no-plan run row reads its stuck and blocked verdicts` | N-1 to N-5 | Measured |
| Runs before the plan (D12) | `runs with no ticket on a planned programme count in beforePlan` | N-6 | Measured |
| Initiatives per workspace, done-when | `an initiative per workspace, and the done-when list …` | none: a pass-through, no mutant made | Measured (case) |

## 4. Mutants

### 4.1 The floors (`server/test/sim/workMapSets.ts`)

Three deciders joined `MUTANT_SETS` and `mutation-floors.json`, each run against every case of `workMapCases.ts`. Every
mutant killed, so each floor is 1. Measured twice: once through a scratch test file (not committed) before the floors
were registered (load 12.7), and then in `mutation-floors.test.ts` filtered to the three keys and the file's structural
checks (6 of 6 green, load 8.9).

| Decider | Mutants |
|---|---|
| `workMapOf` (76) | T6-1 to T6-14 with T6-1b, T6-2b, T6-4b, T6-4c, T6-5b, T6-6b to T6-6d, T6-7b, T6-8b, T6-9b, T6-12b, T6-14b, T6-G and T6-G11 to T6-G13; V-1 to V-6 with V-3b to V-3e and V-4b; T6a-1 to T6a-6 with T6a-2b and T6a-3b; F-1 to F-4; C-1 to C-3; R-1 to R-4 with R-1b; S-1 to S-7 with S-3b; N-1 to N-6 |
| `doneEvidenceVerdict` | EV-1 to EV-11: malformed, no run, programme, kind, state, the own-ticket rule whole and each half, no entry, unreadable, not landed |
| `verdictsReadOf` | VR-1 to VR-3: an empty reader read as read; the stuck flag; `blockedBy` |

### 4.2 By hand, outside the floors

Each made in place from a saved copy, `plan-routes.test.ts` run filtered to its work-map block, and the file restored
from the saved copy (never `git checkout`); a clean run after (39 of 39).

| Id | File | Mutant | Test that reds |
|---|---|---|---|
| RM-1 | `planRoutes.ts` | the `run-unreadable` arm removed | `a failing read answers work unreadable and still serves plan` |
| RM-2 | `planRoutes.ts` | the catch rethrows instead of answering `read-failed` | the same |
| RM-3 | `planRoutes.ts` | the plan read answers no `work` | every case of the block then (five; this note said four, review 2795 F6 measured five) |
| RM-4 | `store.ts` | `programmeWorkRuns` answers no ticket key | `the plan read carries work beside plan` (its `beforePlan`) |

## 5. Co-edits under other claims (each consent by mail, before the edit)

| File | Holder (claim, run) | What was edited | Consent |
|---|---|---|---|
| `server/src/coord/store.ts` | mtm-pr2 (5529, run 2747) | one read method after `runs()` | mail delivery 26369, "yes", 2026-11-19 |
| `server/test/sim/mutation-floors.test.ts`, `.json` | mtm-pr2 (5529) | one import, one spread line, three floor rows | the same mail (it answered the three-row addendum), 2026-11-19 |
| `server/src/server.ts` | gates-b (5558, run 2770) | one property in `registerPlanRoutes`' options | mail delivery 26421, "yes", 2026-11-19 |
| `server/test/overlord-other-lanes-pin.test.ts` | gates-b (5572, run 2770) | the plan doors' one inline snapshot, regenerated (§7) | mail delivery 26459, "yes", 2026-11-19 |

Each consent is dated by its delivery id, which falls between this task's brief (delivery 26341) and its first wave-done
(mail 26502), both of 2026-11-19.

`server/test/helpers/planPhasesFixture.ts` (§7) was under this task's own claim when it was edited, measured from the
claims list and this session's record: the claims list was read at 13:33:47Z, claim 5617 (this task's, the fixture
alone) was granted at 13:33:57Z, the edit was made at 13:34:02Z, and the commit that carries it is stamped 13:47:06Z. A
claim is all-or-nothing, so no other live claim held the path when 5617 was granted. Review 2795 F6 could not read the
claims list, so it left this unmeasured.

WM6 (run 2780) asked this task, which holds the plan file and `shared/plan.ts`, for a co-edit of the `PlanEpicBody`
`waves` line and of the plan's Task WM6 section with a deviation bullet of its own; this task said yes (mail 26350),
noting both tasks append a deviation bullet at the end of the same list.

## 6. Test runs

Every run through `ccrc test`, cd'd into `server/`, `--maxWorkers=2` unless said.

| Run | Result | Load (1 min) |
|---|---|---|
| `work-map` (first run, before the last cases were added) | 78 of 78 | 15.9 |
| `work-map` with the uncommitted scratch runner of the three mutant sets | 84 of 84: every mutant killed | 12.7 |
| `work-map`, `plan-routes`, `single-definition/plan` | one red, my own wrong expectation (an empty live epic is a chip), fixed; then `plan-routes` 39 of 39 | 12.7 |
| `test/rings` and `coord-policy-rings` | 153 of 153 | 16.5 |
| `test/single-definition` (41 files) | 1531 of 1531 | 19.4 |
| `overlord-other-lanes-census`, `auth-gate`, `box-token-census`, `public-text`, `plan-inbound`, `plan-ticket-done` | 626 of 626 | about 16 |
| `deviation-refs` (after `git fetch origin main`), `dtbd`, `topology-clean` | one real red, fixed: this note named another task's deviation number, which raised the floor seed (reworded); one 20 s timeout under load. Then `deviation-refs` alone: 34 of 34; `dtbd` and `topology-clean` green in the first run | 11.3, 12.4 |
| The ledger guard (`.github/ci/ledger-guard.mjs --base origin/main`) | passed by the head's `Ledger-Edit` trailer; layout ok | |
| `work-map`, `plan-routes`, `single-definition/plan` on the committed tree | 125 of 125 (81, 39 and 5) | 10.8 |
| The private-names scan of the tree, with the operator's local list | exit 0, empty output | |
| `sim/mutation-floors` whole | killed twice by the shared test slice's 6G memory cap (2 and 3 OOM kills; the first run's two reds were the face module's sets, cut off mid-run); then filtered to WM2's keys and the structural checks, `--maxWorkers=1`: 6 of 6 | 18.5, 14.3, 8.9 |
| server compile (`tsconfig.json`) | clean before the server wiring line, and clean after it (queued about 40 minutes for a slot) | 15, 8.5 |
| tests compile (`test/tsconfig.tests.json`) | killed by the slice's memory cap three times (exit 137); a narrowed config naming only this task's six test files and their imports compiled clean. The narrowed config was a temporary file in `server/test/`, removed after the run | 8.8 |

## 7. CI's first fast run, and its fix

CI's fast run on the first push (`710d115a0`) was red in three server shards, three real breaks this task's local runs had
not selected (measured from the job logs):

| Shard | Test | Cause | Fix |
|---|---|---|---|
| 7 | `mail-routes.test.ts`, every quoted kebab token in `server/src/coord` is declared | the map's words (`state-unknown` first) were quoted in `workMap.ts` and admitted by no guard | `shared/plan.ts` declares the map's other words as lists too (`WORK_SOURCES`, `WORK_VERDICT_READS` and `WORK_READ_FAILED`), the view's types read from them, and `isPlanKebab` admits them with the statuses and groups, but not `run-unreadable`, the store's read-failure word, which `plan-vocabulary.test.ts` pins out of the plan's words (CI's second fast run found that, shard 6). It builds its set on first use, because the lists sit below it, beside the view. The single-definition pin names the three new lists |
| 8 | `overlord-other-lanes-pin.test.ts`, the six plan doors, `plan show stays open` | its inline snapshot records the whole plan read's answer, which now carries `work` | that one inline snapshot regenerated (`-u` filtered to the case), a one-line diff, with the claim holder's consent (gates-b, claim 5572, mail delivery 26459) |
| 4 | `plan-phases.test.ts`, the stored plans read the same as before | the WM0 characterization compares the whole answer with a fixture taken before WM0 | `planPhasesFixture.ts#readCharacterizationPlans` sets `work` aside, so the case still pins that `plan` reads as before; the fixture is unchanged |

After the fix (load 13.2 to 15.3): `plan-phases`, `mail-routes`, `single-definition/plan`, `work-map`, `plan-routes`,
`plan-ticket-done` 309 of 309; `overlord-other-lanes-pin` with `plan-phases` 72 of 72; `ccrc-api`'s plan cases 23 of 23;
a narrowed compile of every changed test file and `server.ts` (its config in the session's temp root) clean.

## 8. Review 2795's fix round

Review 2795 read `002912bfe` and found F1 to F7; the coordinator ruled them all fixed here, each with its case (fix round
1, delivery 26583).

### 8.1 What changed

| Finding | Change | Case(s) and mutant(s) |
|---|---|---|
| F1 (a) | the fold finds the auto ticket the run holds (`fold-by-the-held-ticket`) | `a reused auto ticket folds …` (V-3b) |
| F2 | a `{ pr }` folds in its carrier's auto ticket (`pr-evidence-folds-its-carrier`); the route hands `prLinks` | `a pull request's carrier folds in: …` (V-3c, V-3d); route: `a pull request the landing line holds landed verifies, and the run that carried it folds in` (RM-6, RM-12) |
| F3 | a last move not read is no field (`last-move-unmeasured-is-absent`) | `a run whose last move was not read …` (V-6); route: `an item carries its run's last move …` (RM-9) |
| F4 | one case per item 1 to 7 | §3, review 2795 F4 rows (T6-7b, T6-1b, T6-2b, T6a-2b, S-3b, T6-G11 to T6-G13, R-1b, V-4b) |
| F5 | route cases for the gathering | §8.3 (RM-5 to RM-12) |
| F6 | records: §2's list, RM-3's count, §5's co-edits and dates, the fixture's claim, Step 2 unticked with its note, the PR body | this note, the plan's D-8779 entry |
| F7 | the fallback "the evidence was not read" | `a done ticket whose stored evidence was not read …` (T6-4c); the carry interaction is §8.4 |

### 8.2 Red before the fix

The new cases that come with a fix (F1, F2, F3) were run against `002912bfe`'s `workMap.ts`; the rest pin behaviour the
tip already had and are measured by their mutants (§4). Measured: `002912bfe`'s `workMap.ts` put in place from `git show`,
the work-map suite run (load 13.1), and the file restored from a saved copy of this round's (compared byte for byte):
exactly the three fix cases red (`a run whose last move was not read …`, `a reused auto ticket folds …`, `a pull
request's carrier folds in: …`), the other 90 green.

### 8.3 Route mutants (review 2795 F5)

Each made from a saved copy of `planRoutes.ts`, the route block run (`plan-routes.test.ts` filtered to `plan show carries
the work map`), and the file restored from the saved copy, never `git checkout`.

| Id | Mutant | Case that reds |
|---|---|---|
| RM-5 | the plan's end read as null | `an ended plan reads ended, its open tickets left open` |
| RM-6 | the landing fact always null (a `{ pr }` never verifies) | `a pull request the landing line holds landed verifies, …` |
| RM-7 | open items passed empty | `an open item on a ticket's run, and one on its operator-act checkpoint, …` |
| RM-8 | checkpoint items never filled | the same |
| RM-9 | run last moves not stamped | `an item carries its run's last move …` |
| RM-10 | the evidence run's own ticket key read as null | `evidence naming a run that did another declared ticket does not hold: …` |
| RM-11 | the `run-unreadable` arm of the evidence run read removed | `an evidence run that cannot be read answers work run-unreadable …` |
| RM-12 | the `{ pr }` ties not handed to the decider | `a pull request the landing line holds landed verifies, …` (its count) |

### 8.4 Known narrow case: one carry can hide another (review 2795 F7, not changed)

`carryOut` takes the first ticket reference in a phase whose key folds to the ticket and that records a carry. When a
phase references both the run's auto ticket (folded into a declared one) and the declared ticket, and the auto ticket's
reference carries to a phase that is dropped (a void carry), that void carry hides the declared ticket's valid one. It
needs a fold plus two carries in the same phase. Measured on the tip of this round with this input: tickets `d1` (done,
`{ runId: 5 }`) and `run-5` (done, run 5's auto ticket, so it folds into `d1`); phases `p1` referencing `run-5` carried
to `p3` at 50 and `d1` carried to `p2` at 100, `p2` referencing `d1`, `p3` dropped. The answer: `p1` reads `carried` 0
and `done` 1 (finish 500), where 1 carried is expected, and `d1`'s `p1` entry has `carriedTo` null while its `p2` entry
still names `p1` in `carriedFrom`. Ruled a known case by the coordinator; the carry logic is unchanged.

### 8.5 This round's runs

Every run through `ccrc test`, cd'd into `server/`, one file (or one directory, where named) per process, `--maxWorkers=2`.

| Run | Result | Load (1 min) |
|---|---|---|
| `work-map` | first 92 of 93, my own wrong expectation (the order of `nz`'s groups), fixed; then 93 of 93 | 11.6 |
| `plan-routes` | 45 of 45 | about 11 |
| the eight route mutants (§8.3), the work-map block alone each | each 1 red, 10 green | 6.0 to 13.1 |
| `work-map` against `002912bfe`'s `workMap.ts` (§8.2) | 3 red (the fix cases), 90 green | 13.1 |
| `sim/mutation-floors` whole | 255 of 257: every set green, the three work-map keys included; the 2 reds are the face module's two sets, whose baseline cannot import `@ccrc/ui`, which this worktree has not installed (`ui/` and `pwa/` carry no `node_modules`), as review 2795 measured | 12.3 |
| `plan-store`, `plan-policy`, `plan-phases`, `plan-ticket-done`, `plan-ticket-required`, `single-definition/plan` | 57, 41, 59, 64, 15 and 5, all green | 8.8 to 11.6 |
| `mail-routes` (the coordination word scan) | 61 of 61 | 9.8 |
| `overlord-other-lanes-census`, `-pin`, `-routes`, `overlord-other-lanes` | 54, 13, 35 and 153, all green | 9.9 to 12.7 |
| `coord-db`, `coord-policy-rings` | 149 and 20, all green | 10.8, 14.3 |
| `deviation-refs` (after `git fetch origin main`), `dtbd`, `topology-clean` | 34, 1 and 61, all green | 13.1, 12.8 |
| `test/single-definition` (41 files), `test/rings` (12 files) | 1531 and 133, all green | 13.1, 9.6 |
| server compile (`tsconfig.json`) | clean | 8.6 |
| tests compile (`test/tsconfig.tests.json`) | first run: 8 errors, all in `agent/src` (`ws` not found: `agent/` had no `node_modules` in this worktree, and this branch changes nothing there); after installing the agent package's dependencies (`npm ci`), clean. No memory-cap kill this time | 8.6, 8.3 |

### 8.6 A co-edit this task granted

The linear-hierarchy wave 4 follow-ups (run 2810) asked this task, which holds `planRoutes.ts` and
`single-definition/plan.test.ts`, for a co-edit of two doc comments and plan take's Upkeep lookup in the first, and one
appended case in the second; this task said yes (mail 26622, 2026-11-19), noting that the work gatherer ends just above
one of those comments and that the describe's last case is WM2's, so whoever lands second keeps both.

## 9. For later

- When the hierarchy's Task 4.3 stores a programme ticket's close apart from a drop, the route fills `closed` from it.
- WM3 draws the view; `epicPath(slug, key)` (`pwa/src/lib/routes.ts`) is the epic row's link.
