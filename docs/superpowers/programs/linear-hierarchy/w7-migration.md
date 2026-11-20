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
| 7.3 | `server/src/linear/migration.ts` (`LinearMigration`, L4): the owner and coordinator mails for a map, the apply at wave boundaries, the report; the plan store's migration functions; the `linearMigration` lane (30 s); migration 111 (four columns on `linear_migrations`, D-8800) |
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
| — | no migration in wave 7 | migration 111 (D-8800): `linear_migrations.project`, `report`, `putBackAskedAt`, `reportDoneAt` |
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
| F3 | a step that cannot be placed now is asked before any call, spends nothing, and is listed as waiting with its reason (`waitingWhy`) | `migration-apply.test.ts`: two unplaceable issues ahead, the closers run |
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
| A5 | D-8799 (the map item settles on Approve) and D-8800 (migration 111's four columns) in the plan | — |
| A6 | the report names a done programme whose initiative stays active while its placed tickets are open | `migration-policy.test.ts` |
| A7 | `MIGRATION_CALLS_PER_TICK` counts every Linear call of a tick; a rate refusal of any of them rests the lane | `migration-apply.test.ts` |

Also in this round: `main` merged after #3088 (migration 110 is `main`'s, so this run's is 111; the gate's route counts and the
census words recounted), and the wave 3 F3/F5 carry (below).

## Follow-ups and open points

- **The F3/F5 interaction, built in fix round 1** (wave 3's carry: a bound ticket put back could take its held team off its
  project). The sync's snapshot keeps the epic ids of tickets put back (`putBackTicketsOf`), and F3's team list keeps the teams
  of bound tickets put back; a retired binding holds none (`plan-sync-policy.test.ts`).
- **Pending: README's machine-lane count word** ("ninety-three" to "ninety-four" since the merge of `main`, forced by
  `box-token-census.test.ts`). It is held by run 1850's freeze until the operator answers item 496. README is untouched here,
  and one census case is red on this branch: `box-token-census.test.ts`, "README states the DERIVED lane counts".
- **Three minor points left**, each named by the review and judged not worth a change now: a worker's follow-up ticket and
  its mail are two transactions (a crash between them loses the mail, never the ticket); a follow-up's earlier report item
  is settled in its own transaction after the new one is raised; a replaced level's close does not wait for the issues placed
  under it to settle, so with none applied yet it relates to none (the relation is evidence only).
- **The suites under load.** `coord-db`, `secret-mask` and `mail-routes` failed only by timeouts (20 s to 235 s per case) in a
  test slice at its memory cap, with OOM kills from other sessions' runs. `hierarchy-routes` and `plan-store` failed the same
  way in one batch and pass alone (73 of 73). CI on the quiet box is the arbiter.
- The pilot (ccrc's own team) is the operator's, in the console, after this lands: "Reshape in Linear", the owner's map,
  Approve, the report, before any other team.
