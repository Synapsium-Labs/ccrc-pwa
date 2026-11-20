# Wave 7: the per-team migration (D-8186)

Run 2846, ticket `w7-migration` (epic `migration`). Plan: `docs/superpowers/plans/2026-11-10-linear-hierarchy.md`, Wave 7,
Tasks 7.1 to 7.4. Design: `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md` §10, §11.1 and §11.3. This run
BUILDS the migration and runs none: the pilot (the operator's "Reshape in Linear" on ccrc's own team, then the report) is
the operator's, in the console, after this lands.

## What was built

| Task | Built |
|---|---|
| 7.1 | `server/src/linear/migrationPolicy.ts` (L1): `checkMap`, `applySteps`, `reconcileMove`, `putBackSteps`, `replacementComment`; `IssueSnapshot` and `MapBody` in `shared/plan.ts` beside D-8737's shapes; `isPlanKebab` admits the map classes |
| 7.2 | `POST /api/projects/:project/hierarchy/migrate` (session-gated) and the map item's `approve` and `return` (`hierarchyRoutes.ts`); `plan map-propose`, `POST /api/teams/:team/plan/map` (box token, the team's Linear owner, `planRoutes.ts`), its client row and its section in `references/plan.md`; the console's "Reshape in Linear" |
| 7.3 | `server/src/linear/migration.ts` (`LinearMigration`, L4): the owner and coordinator mails for a map, the apply at wave boundaries, the report; the plan store's migration functions; the `linearMigration` lane (30 s); migration 114 (four columns on `linear_migrations`, D-8800) |
| 7.4 | The report item's `put-back` and `done`; put back from the move record alone, run by the lane |

## Departures (defined in the plan's Deviations found)

- **D-8795, migration-policy-interfaces** (the coordinator's ruling, with four conditions, all built): `checkMap` takes the
  project facts it cannot read; `applySteps` takes the after-state from its caller; `after.expect` is compared by key and type;
  a created milestone is put back by no write and listed. Added by a security review of the wave's commits: an epic the map
  declares must sit in the map's own team (`epic-other-team`).
- **D-8796, migration-through-the-sync** (the coordinator's ruling, with six conditions, all built): adoption with its move
  row in one transaction, the after-state from `PlanSync#plannedOwnedNow`, the key's pass sending the write; the structure
  through the sync's pass; closes by `runCcrcOp`; the migration's sync steps on lane `migration`; put back run by the lane.
  The conditions and where each is tested:

  | Condition | Test |
  |---|---|
  | 1. lane `migration`, at most what its budget allows a tick | `migration-apply.test.ts`: the charge to lane and pass `migration`; a large map does not delay an ordinary programme's step; at most `MIGRATION_WRITES_PER_TICK` writes a tick |
  | 2. the wave boundary before any adoption | `a live programme's part waits until no run is dispatched or working` (no ticket, no binding meanwhile) |
  | 3. one write per issue; a crash between the adoption and the pass | `the sync emits nothing for an adopted issue on its next pass`; `a crash between the adoption transaction and the pass` |
  | 4. `applied` means settled | `applied only when every move is applied or skipped` |
  | 5. put back and the sync | `a sync pass between two put-back writes writes nothing to a restored issue` |
  | 6. a done programme's initiative | D-8796's text and the report item's words; no forced state is written |
- **D-8798, D-8799, D-8800** (fix round 1, the coordinator's rulings on review 2892): see the table below.
- **D-8801, finished-evidence** (the coordinator's rulings on review 2892 F7 and review 2918 F4): a finished entry carries a
  pull request (`target.pr`) or, with none, a one-line reason (`target.reason`). Both are new members of `MapEntry.target`
  beyond Task 7.1's interface, where the spec and Task 7.3 name the merged pull request alone, and `checkMap` checks the pull
  request's shape only (L1 cannot ask GitHub whether it exists or merged).
- **D-8802, plan-by-follows-the-last-put** (the coordinator's rulings on review 2892 F1 and review 2918 F4): a coordinator's
  first plan write after the map's rewrites `planBy` and `planAt`, where Task 2.2 sets them on the first call only, so put back
  never ends a programme its coordinator has since taken over.
- **D-8797, upkeep-link-with-key** (the coordinator's ruling): the Upkeep link shows with a team key; the inbound count only
  when issues wait; pinned both ways in `project-linking-card.test.tsx`.

## Wire differences from the plan's Interfaces

| Where | Plan | Built |
|---|---|---|
| 7.1 `checkMap` | three arguments | a fourth, `ctx` (D-8795) |
| 7.1 `applySteps` | three arguments | a fourth, `afterOf` (D-8795) |
| 7.1 `putBackSteps` | `{ steps, moved }` | `{ steps, moved, left }`, `left` the created milestones (D-8795) |
| 7.3 `adoptIssueAsTicket` | its own transaction, after the write, with the after-state's fingerprint | `adoptIssueAsTicketInTx`, in the caller's transaction with the move row, the adopted fingerprint (D-8796) |
| 7.3 the `applying` guard in `planSync.ts` | the sync emits no issue step for a listed issue with no applied move row | not needed: a listed issue has no binding until its move row exists (D-8796); the sync instead charges a migrating object's steps to lane `migration` |
| 7.4 put back | run by the act | asked by the act (`putBackAskedAt`), run by the migration lane (D-8796) |
| 7.2 approve | the map item settles on `applied` | it settles on Approve, with a note that the report follows; the report item is raised on `applied` (D-8799) |
| — | no migration in wave 7 | migration 114 (D-8800): `linear_migrations.project`, `report`, `putBackAskedAt`, `reportDoneAt` |
| — | — | `GET /api/migrations/:id` (session-gated, masked), D-8737's read for the map and report bodies |
| — | a server cap per new verb | none: `shared/api.ts` may only shrink (D-8635), so `plan map-propose` rides `plan-v1`; an older server answers 404 |

## Carries

1. Wave 3 A5: `ticketOfRun` leaves out a ticket put back (`putBackAt`), as the sync's snapshot does. Built in the store's one
   `ticketOfRun`, which the sync asks (fix round 1, F9). The F3/F5 interaction: built in fix round 1, see the end of this note.
2. D-8737's handover: built (`GET /api/migrations/:id`; the map item's epics and checkpoints section; the report's lists).
3. Wave 5 round 3 F1: built (`--safe-bottom`; the browser file emulates a home indicator).
4. Wave 5 minors: A1, A2, A3/A8, A6 and A7 built with tests; A5 is D-8797.
5. Wave 6 review round 3 F4 (added by the coordinator during the run): a worker's follow-up ticket (`plan ticket-add`, source
   `worker`) is mailed to the programme's coordinator once, naming its key, title and epic; the coordinator's own ticket-add
   mails nobody. The words are `planPolicy.ts#followUpTicketMail`; the mail rides the route's `serial`
   (`plan-routes.test.ts`).

## Reviews inside the run

- A held-out Opus review of the server diff found nine important and seven minor points; every important one is fixed with a
  test that goes red without its fix (`2b164e1ef`): reads by id inside the key's flight, texts compared through
  `normalText`, an adopted issue changed before its write put aside, the map's rule judged again at apply, initiatives off,
  the rate budget and the lane's rest, the Upkeep epic shared with the inbound path, put back in batches that finish, bound
  issues out of the map, and the follow-up mail's subject.
- Two security reviews of the commits: a map declares structure only in its own team (`epic-other-team`, `82f39dbcb`); a
  follow-up map opens only the issues this migration set aside, put back ends only a plan that is still the map's, and drops
  every record the migration made (`85387008a`).
- Browser: the stuck act bar's case goes red against the old offset (the bar 34 px into the phone bar under an emulated
  home indicator) and green with `--safe-bottom`; both browser files pass in all views, the 1920 report case included,
  after the structure lists' CSS was measured (see `pwa/src/ledgers/migration.css`).

## Fix round 1 (review 2892, the coordinator's mail of 2026-11-20)

Every code fix has a test seen red before it (one run over the six server files, 24 red, and one over the two console files,
2 red), and green after it.

| Finding | Built | Test |
|---|---|---|
| F1 | a coordinator's first plan write after a map's makes `planBy` theirs (`planStore.ts#applyPlanChangesInTx`); put back reads it | `migration-putback.test.ts` drives the coordinator's write; `plan-store.test.ts` pins the writer |
| F2 | put back saves the issues found moved since before its early return | `migration-putback.test.ts`, a refused second read |
| F3 | a step that cannot be placed now is asked before any of the migration's own issue reads and writes, spends none of them, and is listed as waiting with its reason (`waitingWhy`); for an upkeep step the ask may run the Upkeep epic's own pass (review 2918 F3) | `migration-apply.test.ts`: two unplaceable issues ahead, the closers run |
| F4 | a retired move row is not a move: Return puts the follow-up's issues back on the skipped list | `migration-propose.test.ts` |
| F5 (ruled) | the set-aside issue's binding is `retired` (a new binding state, the row kept), with its ticket put back and its row set aside, in one transaction (`setAsideAdopted`); every reader that takes a binding as holding its issue skips a retired one | `migration-apply.test.ts`: the owner is mailed once and the issue never written; `plan-store.test.ts` |
| F6 | a successor exists on the map or in ccrc's plan, or `plan-bad-body` `unknown-successor` | `migration-policy.test.ts` |
| F7 (ruled) | a finished entry carries `target.pr` (`<owner>/<repo>#<n>`) or a one-line `target.reason`, or `plan-bad-body` `finished-needs-evidence`; the close names it through the public-text check, and a public team names a pull request outside the project's own repository as "a pull request" (`finishedComment`); `references/plan.md` documents both fields | `migration-policy.test.ts` |
| F8 (ruled) | D-8798: `planRequired` for the programmes the map names and the team's programmes with a declared plan | `migration-apply.test.ts` |
| F9 | one `ticketOfRun` (the store's), which leaves out a ticket put back; the plan sync asks it | `plan-store.test.ts` |
| A1 | the relation names an issue by its applied move row, and is sent once (marked on the row) | `migration-apply.test.ts` |
| A2 | a follow-up map is stored on its own, the map it joins kept as `prior` until Approve merges them; its item counts its own entries | `migration-propose.test.ts` |
| A3 | the console's `migration-in-flight` sentences: one for Reshape (one team at a time, or migrated already), one for Put back (refused for good) | `linear-item-controls.test.tsx` |
| A4 | `stateOfTeam` reads the workspace the team's key routes to | `migration-propose.test.ts` |
| A5 | D-8799 (the map item settles on Approve) and D-8800 (migration 114's four columns) in the plan | — |
| A6 | the report names a done programme whose initiative stays active while its placed tickets are open | `migration-policy.test.ts` |
| A7 | `MIGRATION_CALLS_PER_TICK` counts every Linear call of a tick; a rate refusal of any of them rests the lane | `migration-apply.test.ts` |

Also in this round: `main` merged after #3088 (migration 110 is `main`'s, so this run's is 111; the gate's route counts and the
census words recounted), and the wave 3 F3/F5 carry (below).

## Fix round 2 (review 2918, the coordinator's mail of 2026-11-20)

Every code fix has a test seen red before it (one run over the five server files: F1's two cases and F2's two, red; the
console's report list, red), and green after it. Each wiring the panel mutated green now has a case that goes red under that
mutation, measured one mutation at a time from a saved copy:

| Finding | Built | Test, and the mutation that reds it |
|---|---|---|
| F1 | a follow-up map no longer opens a set-aside issue by its set-aside row (its retired binding already leaves it out of the held issues), so an issue a live binding holds stays out on both paths; the store's adoption refuses an issue a live binding holds (`IssueHeldError`), and the apply skips and lists it | `migration-apply.test.ts`: set aside, taken by the owner through inbound, then a follow-up map naming it; and a live binding that comes to hold an approved map's issue before the apply |
| F2 (ruled: keep the spec) | a replaced level relates to the first ticket placed under it (`migrationPolicy.ts#closerRelation`): while a leaf under it is adopted and not applied, or not placed yet, its close waits before any call, listed `placed-ticket-not-applied`; with no leaf under it placed (none listed, or every one skipped) it closes with no relation and the report lists it under `unrelated` ("Closed with no ticket placed under them" in the console) | `migration-apply.test.ts`: the same-tick map `[leaf, epic]`, and the all-skipped case; `migration-body.test.tsx` |
| F3 (ruled: narrow the text) | `MIGRATION_CALLS_PER_TICK` counts the migration's own issue reads and writes; the structure pass and the Upkeep epic's pass are the plan sync's own passes on lane `migration`, bounded by the writes cap, the lane and the one rate service. D-8796's amended sentence and the step 2 comment say so | — |
| F4 (ruled) | D-8801 and D-8802 defined in the plan, cited in `migrationPolicy.ts`, `shared/plan.ts` and `planStore.ts`, and named above | — |
| F5 (1) | the finished close's comment, built by `finishedComment` at the call site | `migration-apply.test.ts` "F5 (1)": red with the call replaced by a fixed sentence |
| F5 (2) | `putBackTickets` passed from the plan sync's snapshot into the policy | `plan-sync.test.ts` "review 2918 F5 (2)": red with the field removed |
| F5 (3) | the call budget's `budget.calls >= calls` | `migration-apply.test.ts` "F5 (3)": three replaced levels relating to one leaf, two of them due in one tick (8 calls); red with the check removed |
| A1 | `MIGRATION_WRITES_PER_TICK`'s doc: a close is up to four calls, closes go one a tick, the pilot takes about two to four hours | — |
| A2 | `bindingsInWorkspace`'s one JSDoc; `graceBindingsOf` skips a retired binding | the existing drift-pass suite |
| A3 | `single-definition/plan.test.ts` rows for `MIGRATION_WAITING_WHY`, `MigrationWaitingWhy` and `MIGRATION_PLAN_BY` | — |
| A4 to A7 | the four wirings the panel mutated green: round 1's A6 done-programme sentence, F6's `heldIssues` wiring in the proposal, F6's self-reference by issue id with F8's `unclear` exclusion, and A4's newest-first sort in `stateOfTeam` | `migration-apply.test.ts` "A6" (red with `done` dropped) and "F8: a programme named only by an unclear entry" (red without the exclusion); `migration-propose.test.ts` "F6: a superseded entry may name a successor ccrc already holds" (red without `heldIssues`) and "A4: of two rows" (red with the sort reversed); `migration-policy.test.ts` F6, by issue id (red without the check) |

Also in this round: `main` merged twice more (it took migration 111, the waiting workers' lane-arm row, and then 112, the
dispatch cap's lane-arm row), so this run's migration was 113; the land-sync below moves it to 114. README's count word is applied (see below), so
the census case red since round 1 is green.

## Review 2955 and the land-sync (round 3, the coordinator's mail of 2026-11-20)

Review 2955 (round 3, the last under the review cap) read `d2a497e99` and found four important findings and four advisories,
real defects in the migration's report and its closers that cannot fire until the operator starts a team's migration from the
console. The coordinator's ruling: this PR lands at the cap as a land-sync only (`main` merged at `f95ac048a`, which took
migration 113 for the admission wait, so this run's migration is 114; the monotonic lane count is 57 with `main`'s admission
wake; nothing else changes), and the findings go to a follow-up run of their own, plan ticket `w7-fixes` in the `migration`
epic, with a fresh review, which must land before any team's migration is started. The wave 7 pilot waits for it.

The rulings, for that run:

| Item | Ruling |
|---|---|
| F1 | The three early returns on an unread read save the report with the tick's `unrelated` set merged in, and (A2) a level joins `unrelated` only after its state write succeeds. Test: a no-relation close, then a refused read in the same tick, and the report still lists it. |
| F2 (ruled) | An issue a live binding holds leaves the migration: once the owner has taken it through inbound, it is neither skipped nor waited on. The report lists it as taken by the owner (its own list and console words, not "Skipped as changed"), the owner's mail never asks to map it, and the apply does not wait on it. D-8796 is amended to name the cause. |
| A1 (ruled) | F1's one-writer rule covers closers too: a closer-class entry (epic, stale, superseded, finished) naming an issue a live binding holds is not commented on or closed; it goes to the same taken-by-the-owner list. |
| F3 | D-8796's amended sentence and the two comments say what the code does: the Upkeep epic's create goes out on lane `sync` as the plan sync's own pass, and step 1's pass and the Upkeep pass are bounded by the lane, the pass deadline and the one rate service, not by the writes cap. "Never spent" and "the writes cap" are dropped for those two passes. |
| F4 | `graceBindingsOf`'s retired guard gets a test that goes red without it. |
| A3 | The waiting words cover a leaf not yet placed, and say that a leaf later skipped means the level closes with no relation. |
| A4 | D-8802 is cited at the put-back gate it explains. |

## Run 2984 (w7-fixes): what was built

The follow-up run the rulings above name (plan ticket `w7-fixes`, epic `migration`). No departure number was needed (the two
issued to the run stay unused), and no file outside the run's claims was edited, so no consent was asked; D-8796's text is amended
in the plan under the head commit's `Ledger-Edit` trailer, as the brief allowed.

| Item | Built | Test, and what reds it |
|---|---|---|
| F1 | `saveReport` takes the tick's lists (`skipped`, `unrelated`, `taken`), and all four of its calls pass the same sets, so an early return on an unread read keeps what the tick learned | `migration-apply.test.ts`, one test per early return: "F1: … stays listed when step 2's own next read is refused", "F1: … stays listed when step 3's closer read is then refused" and "F1: … kept when step 3 then ends early on a refused adoption read"; each goes red, and only it, with `unrelated` dropped from its own return's save |
| A2 | a level joins `unrelated` only once its state write lands (`closeIssue`), and a step-2 row that `reconcileMove` finds already closed joins it there | "A2: a no-relation close whose state write is refused is not listed as unrelated until the write lands" |
| F2 | an issue a live binding holds (`issueBound`, the store's one reader, the same one `IssueHeldError` uses) leaves the migration: `migrationPolicy.ts#shedTaken` moves it from `skipped` to the report's new `taken` list, at the start of every apply tick, on every tick of an applied row whose report is open, and when a follow-up map is stored; an adoption refused `IssueHeldError` answers `taken`, not `changed`; `fresh`, the closers' relation, and the done check treat a taken issue as settled, so nothing waits on it and the owner's follow-up mail never names it. The console lists it as "Taken by the Linear owner", after the skipped ones (the owner's map reference, a rules file, is left as it is: its sentence that a follow-up map naming such an issue is refused `map-incomplete` still holds, and the review judge's `rules-mixed` keeps rules files out of a code PR) | "F2: an issue on the skipped list that the owner then takes leaves it for `taken`, …", "F2: a replaced level whose only leaf is taken closes with no relation, …", the two review 2918 F1 tests updated to the new end state, `migration-policy.test.ts` `shedTaken`, `migration-body.test.tsx` "lists the issues taken by the Linear owner on their own" |
| A1 | a closer-class entry naming an issue a live binding holds is asked before any call, in step 2 (an unapplied row) and in step 3: no comment, no relation, no close, and it goes to `taken` | "A1: a stale closer and a replaced epic naming an issue a live binding holds …", "A1: a closer whose move row is unapplied, then held by a live binding, …" (taken between the map's approval and the close) |
| F3 | the two cap comments in `migration.ts` and D-8796's sentence say what bounds the sync's two passes: step 1's structure pass on lane `migration`, the Upkeep epic's create on lane `sync` as the plan sync's own (it has no move row), each bounded by its lane, the pass deadline and the one rate service, never by the writes cap | — |
| F4 | — (the guard stands) | `plan-store.test.ts` "graceBindingsOf leaves out a retired binding whose grace still stands": red without `state <> 'retired'` |
| A3 | `placed-ticket-not-applied`'s words (console and `shared/plan.ts`) cover a leaf still to be placed and say a level with none placed closes with no relation | `migration-body.test.tsx` "a replaced level's wait covers a leaf still to be placed, …" |
| A4 | D-8802 cited at the put-back gate in `migration.ts` | — |

Two minor points of the round's task review are left, each judged not worth a change now: the report item's one-line summary
counts skipped issues but not taken ones (the report's own list shows them); and the held check of a skipped identifier that
no map entry names falls back to the identifier alone (a binding holding the issue with no identifier stored is then missed,
and the issue stays skipped until the operator's Done).

## Follow-ups and open points

- **The F3/F5 interaction, built in fix round 1** (wave 3's carry: a bound ticket put back could take its held team off its
  project). The sync's snapshot keeps the epic ids of tickets put back (`putBackTicketsOf`), and F3's team list keeps the teams
  of bound tickets put back; a retired binding holds none (`plan-sync-policy.test.ts`).
- **README's machine-lane count word**, "ninety-three" to "ninety-four" (forced by `box-token-census.test.ts` since the merge
  of `main`): applied in fix round 2 as the one-line packet run 1850's coordinator said yes to (item 496 answered, mail of
  2026-11-20), at its frozen terms; a later run that lands second rebuilds the word to the count the census derives then.
- **Two minor points left**, each named by the review and judged not worth a change now: a worker's follow-up ticket and
  its mail are two transactions (a crash between them loses the mail, never the ticket); a follow-up's earlier report item
  is settled in its own transaction after the new one is raised. The third, a replaced level's close that did not wait for
  the issues placed under it, is built in fix round 2 (review 2918 F2).
- **The suites under load.** `coord-db`, `secret-mask` and `mail-routes` failed only by timeouts (20 s to 235 s per case) in a
  test slice at its memory cap, with OOM kills from other sessions' runs. `hierarchy-routes` and `plan-store` failed the same
  way in one batch and pass alone (73 of 73). CI on the quiet box is the arbiter.
- The pilot (ccrc's own team) is the operator's, in the console, after this lands: "Reshape in Linear", the owner's map,
  Approve, the report, before any other team.
