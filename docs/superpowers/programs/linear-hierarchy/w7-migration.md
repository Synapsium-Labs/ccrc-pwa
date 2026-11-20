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
| 7.3 | `server/src/linear/migration.ts` (`LinearMigration`, L4): the owner and coordinator mails for a map, the apply at wave boundaries, the report; the plan store's migration functions; the `linearMigration` lane (30 s); migration 110 (four columns on `linear_migrations`) |
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
| 7.2 approve | the map item settles on `applied` | it settles on Approve, with a note that the report follows; the report item is raised on `applied` |
| — | no migration in wave 7 | migration 110: `linear_migrations.project`, `report`, `putBackAskedAt`, `reportDoneAt` |
| — | — | `GET /api/migrations/:id` (session-gated, masked), D-8737's read for the map and report bodies |
| — | a server cap per new verb | none: `shared/api.ts` may only shrink (D-8635), so `plan map-propose` rides `plan-v1`; an older server answers 404 |

## Carries

1. Wave 3 A5: `ticketOfRun` leaves out a ticket put back (`putBackAt`), as the sync's snapshot does. Built, in
   `planSync.ts`. The F3/F5 interaction: see the end of this note.
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

## Follow-ups and open points

Three items are pending on this run, not carried to another: the coordinator's ruling (mail 27474) is that they are this
PR's fix round 1, once #3088 lands, together with whatever the review finds.

- **Pending: the F3/F5 interaction** (wave 3's carry: a bound ticket put back can take its held team off its project). It is
  in `planSyncPolicy.ts`, which run 2810 (#3088) holds, and this run has not edited that file. The fix: the snapshot keeps
  the epic ids of tickets put back, and F3's team list keeps the teams of bound tickets put back, with a test seen red first.
- **Pending: the merge of `main` after #3088 lands.** Migration 110 is renumbered then if `main` has taken that slot.
- **Pending: README's machine-lane count word** ("ninety-two" to "ninety-three", forced by `box-token-census.test.ts`). It
  is held by run 1850's freeze; its coordinator asked the operator to extend the additive-packet consent to every programme
  (item 496 on the landing-order programme). Until then README is untouched here, and one census case is red on this
  branch: `box-token-census.test.ts`, "README states the DERIVED lane counts".
- **Three minor points left**, each named by the review and judged not worth a change now: a worker's follow-up ticket and
  its mail are two transactions (a crash between them loses the mail, never the ticket); a follow-up's earlier report item
  is settled in its own transaction after the new one is raised; `issueRelationCreate` takes no caller-chosen id, so a redo
  after a crash can relate two issues twice (harmless in Linear).
- **The suites under load.** `coord-db`, `plan-store`, `hierarchy-routes`, `secret-mask` and `mail-routes` failed only by
  timeouts (20 s to 235 s per case) in a test slice at its memory cap, with OOM kills from other sessions' runs; the same
  files' other cases pass, and CI on the quiet box is the arbiter.
- The pilot (ccrc's own team) is the operator's, in the console, after this lands: "Reshape in Linear", the owner's map,
  Approve, the report, before any other team.
