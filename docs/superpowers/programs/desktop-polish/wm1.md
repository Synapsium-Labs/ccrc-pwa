# Task WM1: the task note (desktop polish run 2416, D-8727)

The note for the programme work map's Task WM1, written by its worker for the coordinator to fold into the ledger. Each
claim says whether it was **measured** (read on the tree, the live server or a test run by this task) or **inferred**.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| Migration: `plan_tickets.doneAt INTEGER`, `plan_tickets.doneEvidence TEXT`, and the back-fill of every `done` ticket that names a run (`{"runId":n}` from its `runId`, `doneAt` from that run's `closedAt`) | `server/src/coord/schema.ts`, entry 94 | Measured: `plan-ticket-done.test.ts`'s back-fill case at the version before it |
| The done arm of `onRunAdvancedInTx` writes `{ runId }` and the time | `server/src/coord/planStore.ts` | Measured: `a run closing done stores doneAt and its runId` |
| `markTicketDone` (the verb's one writer: `done`, `doneAt`, `doneEvidence`, the epic settled, the sync due, one transaction); `doneFactsOf` and `ticketOfRun` (reads) | `planStore.ts`, on the port | Measured: the route cases |
| `runMustNameTicket` (the `ticket-required` rule), `parsePlanTicketDone`, `ticketDoneVerdict` (the evidence rule as review 2375 F2 corrected it), `landedFactOf` | `server/src/coord/planPolicy.ts` (L1) | Measured: `planTicketDoneCases.ts` |
| `planGate` refuses `ticket-required` after `wave-epic-mismatch`, in the no-ticket branch | `server/src/coord/openRun.ts` | Measured: `plan-ticket-required.test.ts` and the gate-order row |
| `phased` and an epic's `tickets` for `planGate` | `server/src/coord/planRunFacts.ts` | Measured: the route cases |
| `POST /api/programmes/:slug/plan/tickets/done` (`plan ticket-done`) | `server/src/coord/planRoutes.ts` | Measured: `plan-ticket-done.test.ts` |
| `evidence-unverified` in `PLAN_REFUSALS` (409); `ticket-required` a `RunRefuseCode` (409); `plan-ticket-done-v1` a `ServerCap`; `TicketDoneEvidence`, `PlanTicketDoneBody` | `shared/plan.ts`, `shared/refusal.ts`, `shared/api.ts` | Measured: `plan-vocabulary.test.ts` |
| The client row `plan.ticket-done`, refused `capability-missing` locally without `plan-ticket-done-v1` | `ccd/ccrc-api` | Measured: `ccrc-api.test.ts` |
| A run and the pull request it carried are one piece of work (review 2429 F2, the coordinator's ruling in fix round 1): `ticketDoneVerdict` reads the landing line's links; `evidenceLinksOf` reads them through `CoordStore.readLanding` only | `planPolicy.ts`, `planRunFacts.ts`, `planRoutes.ts` | Measured: the `verdict:` link cases and the route case `a run and the pull request it carried close one ticket` |
| `ticket-required` named in the coordinator's corpus: added for CI's first run, then moved to WM1r, the rules half, in fix round 1 (the review judge's rules-mixed reason). This branch leaves `ccd/coordinator-skill/references/plan.md` as main has it, so `coordinator-skill.test.ts`'s RunRefuseCode census is red here until WM1r lands (expected) | none on this branch | Measured: `git diff origin/main -- ccd/coordinator-skill/references/plan.md` is empty |
| The gate's EXEMPT row and the census rows | `server/src/auth/gate.ts`, `auth-gate.test.ts`, `box-token-census.test.ts`, `README.md`, `census-w3/claimant*.ts`, `ccrc-api-closed.test.ts` | Measured: those suites |

## 2. The migration slot, and the merge of main

- **Measured** on `origin/main` at `9e79fb3c1` (WM0 merged): `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`
  printed 93, so this entry was 94. Forecasts A (#2987) then took 94.
- **Step B, after WM1r (#3001) landed:** one merge of `origin/main` at `8781ef20a`, on the coordinator's word. The same
  count printed 102 there, so this entry is **103**. Re-measured just before the push; a later slot is said in the wave-done.
- **The fifteen conflicted files**, each resolved keeping both sides (the coordinator's terms), its counts re-measured on
  the merged tree: `README.md`, `ccd/ccrc-api`, `server/src/auth/gate.ts`, `server/src/coord/planPolicy.ts`,
  `planRoutes.ts`, `planStore.ts`, `schema.ts`, and the tests `auth-gate`, `box-token-census`, `ccrc-api-closed`,
  `ccrc-api`, `coord-db`, `open-run-preconditions`, `run-close-switch` and `sim/mutation-floors.json`. The plan files met
  only at import lines and header comments: main's new `plan_tickets` writers (the inbound path, #2982) insert an open
  ticket and move one, and neither writes `done`, so the done arm is still the one writer of `doneAt` and `doneEvidence`.
- **The one change the merge forced (its own commit):** since #2996 every plan write door names a row of `OTHER_LANES`
  (`server/src/coord/otherLanes.ts`) that refuses the Overlord's body with `overlord-uses-its-doors`, and the census pins
  the plan-door rows to exactly the write doors `planRoutes.ts` registers. So the `plan ticket-done` door is the row
  `planTicketsDone` (route `POST /api/programmes/:slug/plan/tickets/done`, `plan-door`), shaped as its neighbours; the
  other-lanes pin counts ten plan-door rows; `plan-ticket-done` has the refusal case, and a mutant of the row's word
  turns it red (§4.2, M-17). Claim 5404 holds the two other-lanes files.
- **The counts, measured on the merged tree:** 103 migrations; 90 `ccrc-api` rows, 11 of them `plan` rows; 242 mutation
  floors (main's 238 and WM1's 4); 282 routes scanned, 279 at the gate's HTTP half, 100 exempt HTTP, 179 gated; 91 machine
  lanes (88 box-token lanes, plus notify, pools/epoch and updates/intent). `run-close-switch`'s rollback undoes migrations 54
  to 103, fifty in all; main's line said forty-three, short already against its own 102, so it reads the measured fifty.

## 3. Rows, and what reds each

Each refusal and each verification has a case that reds when its check is deleted (the plan's acceptance). The pure
cases run against every mutant in §4; the route and store cases were mutated by hand (§4.2).

| Rule | Case(s) | Reds when | Basis |
|---|---|---|---|
| `ticket-required` (phased plan, open declared ticket no run holds) | REQUIRED_CASES; `plan-ticket-required.test.ts` | TR-1 to TR-5; the planGate line removed (M-1) | Measured |
| A plan with no phases opens as today | `a plan with no phases opens it as today`; REQUIRED_CASES 2 | TR-2 | Measured |
| `wave-epic-mismatch` first | `wave-epic-mismatch is answered first`; the gate-order row | the order table | Measured |
| Review runs untouched | `a review run is never refused` | inferred: the review branch returns before planGate's rule | Measured (case) |
| Body: one evidence key, positive integer, closed shape, plan key | `body:` cases; route cases | BD-1 to BD-5 | Measured |
| Held ticket `plan-runs-open`; not open `plan-bad-body` (F21) | `verdict:` cases; route cases | EV-1, EV-2 | Measured |
| `{ runId }`: exists, this programme's, a work run, done, its own ticket this one, auto or none | `verdict:` cases; route cases | EV-3 to EV-7c | Measured |
| `{ pr }`: landed for the ticket's own project; no entry names the run; unreadable refuses | `verdict:`/`landed:` cases; route cases | EV-8 to EV-10, LF-1 to LF-3 | Measured |
| Evidence already stored on another ticket refuses, except the run's own auto ticket (F2) | `verdict:` cases; route case | ST-1 to ST-4 | Measured |
| The back-fill | `the migration back-fills …` | M-2 | Measured |
| The done arm stores `{ runId }` and the time | `a run closing done stores doneAt and its runId` | M-3 | Measured |
| `markTicketDone` settles the epic and marks the sync due | `settles the epic` | M-4 | Measured |

## 4. Mutants

### 4.1 The floors (`server/test/sim/planTicketDoneSets.ts`)

Four new deciders joined `MUTANT_SETS` and `mutation-floors.json`, each run against every case of
`server/test/planTicketDoneCases.ts`. Measured: `mutation-floors.test.ts` for the four keys, every mutant killed, score 1,
so each floor is 1 (load 10.57). That build had 29 floor mutants (TR 5, BD 5, EV 12, ST 4, LF 3); earlier records said 30
(review 2429 F12). Fix round 1 added 9, so there are 38: TR-6, BD-6, ST-5 to ST-10 and LF-4, every one killed with the
other 29 (load 11.42).

| Decider | Mutants | What each removes or narrows |
|---|---|---|
| `runMustNameTicket` | TR-1 to TR-6 | the rule whole; the phased test; the `open` test; the no-run test; the not-auto test; any open declared ticket, not every ticket (F9) |
| `parsePlanTicketDone` | BD-1 to BD-6 | the closed shape (a body naming `byId`); exactly one evidence key; the positive bound; the integer test; the plan-key test; a safe integer, not any integer (F10) |
| `ticketDoneVerdict` | EV-1 to EV-10, EV-7b, EV-7c, ST-1 to ST-10 | held (`plan-runs-open`); not open (`plan-bad-body`); no run; this programme; a work run; done; its own ticket (whole, the auto exception, the this-ticket case); no landing entry; unreadable; not landed; the evidence-already-stored rule; its auto-ticket exception; a pull request being one project's; the run id compared; a run id global across the programme's projects (F5); a `{ runId }` tied to a stored `{ pr }` and a `{ pr }` tied to a stored `{ runId }` (F2, one each); an unreadable link; a pull request being one project's on the link; the run's own auto ticket on the `{ pr }` side |
| `landedFactOf` | LF-1 to LF-4 | any entry landed (not only the newest); the filter by pull request; the no-entry answer; any entry, not only the first (F6) |

### 4.2 By hand, outside the floors

Each was made in place from a saved copy of the file, the named test run, and the file restored from the saved copy
(never `git checkout`).

Measured (load 10.37), every one killed:

| Id | File | Mutant | Test that reds |
|---|---|---|---|
| M-1 | `openRun.ts` | the `ticket-required` line in `planGate` removed | `plan-ticket-required.test.ts` (the refusal case) |
| M-2 | `schema.ts` | the back-fill `UPDATE` removed | `plan-ticket-done.test.ts` (the back-fill case) |
| M-3 | `planStore.ts` | the done arm writes `done` only, no time or evidence | `a run closing done stores doneAt and its runId` |
| M-4 | `planStore.ts` | `markTicketDone` settles no epic | `settles the epic` |
| M-5 | `planRoutes.ts` | the route passes no stored evidence (the F2 rule unfed) | `refuses evidence already stored …` |
| M-6 | `planRoutes.ts` | the route reads every pull request as landed | the two `{ pr }` refusal cases |
| M-7 | `planRunFacts.ts` | `phased` always false | the `ticket-required` refusal case |

Fix round 1 (review 2429's missing pins and its F2 ruling), measured the same way (load 10.25, M-9 and M-13 again at 13.71
after the fenced case was reordered: M-9 survived the first time, because a stored `{ runId }` made the link read refuse
first), every one killed:

| Id | File | Mutant | Test that reds |
|---|---|---|---|
| M-8 | `planRoutes.ts` | a run read that fails is not refused (F3) | `refuses a run that cannot be read` |
| M-9 | `planRoutes.ts` | a fenced landing read counts as landed (F3) | `refuses a pull request, and a run tied to a stored one, when the landing line cannot be read` |
| M-10 | `schema.ts` | the back-fill writes every ticket that names a run, not only done ones (F4) | the back-fill case |
| M-11 | `planStore.ts` | `markTicketDone`'s `state = 'open' AND runId IS NULL` guard removed (F7) | `markTicketDone leaves a ticket a run holds (started) and a done ticket unchanged` |
| M-12 | `planRunFacts.ts` | `phased` counts only phases not dropped (F8) | `a plan whose only phase is dropped is still phased` |
| M-13 | `planRunFacts.ts` | `evidenceLinksOf` skips a landing line it cannot read | the fenced-landing route case |
| M-14 | `planRunFacts.ts` | `evidenceLinksOf` reads no line for a `{ pr }` | `a run and the pull request it carried close one ticket` |
| M-15 | `planRunFacts.ts` | `evidenceLinksOf` reads no line for a `{ runId }` | the same, and the fenced-landing case |
| M-16 | `planRoutes.ts` | the route hands the verdict no links | the same two |
| M-17 | `otherLanes.ts` | the `planTicketsDone` row's word `overlord-uses-its-doors` changed to `overlord-not-a-coordinator` (step B) | `plan-ticket-done` (the Overlord's body case) |

## 5. Claims and consent

- Claimed by this task (measured): 4843 (the spec, the plan, this note, WM0's note, `shared/api.ts`, `gate.ts`,
  `store.ts`, the new tests, the census tests not held elsewhere, the mutation floors), 4844 (`planRunFacts.ts`, the new
  cases and sets, the shared fixture), 4848 (`plan-phases.test.ts`).
- Claimed by this task for the CI fix (measured): 4864 (`ccd/coordinator-skill/references/plan.md`), released in fix round 1
  once the file was back to main's copy, for WM1r's worker.
- Co-edited under the Linear hierarchy wave 4's claims 4783, 4787, 4791 and 4824 (`schema.ts`, `planStore.ts`,
  `planRoutes.ts`, `planPolicy.ts`, `ccd/ccrc-api`, `shared/plan.ts`, `shared/refusal.ts`, `plan-store`, `ccrc-api`,
  `ccrc-api-closed`, `auth-gate`, `coord-db`, `run-close-switch` and `refusal-status` tests): the coordinator's grant (mail
  delivery 23506) and the holder's (23529), on WM0's terms. The exact lines went to its holder (mail 23578, with the zero-context diff as its artifact).
- Co-edited under claim 4829 (Overlord W1 other lanes A): `openRun.ts` and `open-run-preconditions.test.ts`, the four
  edits asked for (mail 23519) and consented to, "Yes to all four, exactly as listed" (delivery 23525).
- Co-edited under claim 4832 (landing order 5i): `README.md`'s two lines, H1 (the lane count eighty-seven to eighty-eight)
  and H2 (`tickets/done` in the plan route list), consented to at main `9e79fb3c1` only (delivery 23558, relayed by
  the holder's frozen-routing session). If main's count moves before this lands, a new exact consent is owed.

## 6. Runs

Every run through `ccrc test`, cd'd into `server/`, `--maxWorkers=2`; the load is the one-minute figure at the start.

| # | What | Load | Result |
|---|---|---|---|
| 1 | The two new files, red first | 16.76 | 54 failed, 6 passed (the six that pass are today's behaviour: no phases, review runs, held and auto tickets) |
| 2 | The two new files, after the build | 14.70 | 60 passed |
| 3 | `tsc --noEmit -p tsconfig.json` | 16.95 | clean (queued 471 s behind two heavy slots) |
| 4 | `tsc --noEmit -p test/tsconfig.tests.json` | 13.00, 15.53 | killed twice by the test slice's 6 GB memory cap (other heavy runs in the slice), each rerun once |
| 5 | the same | 10.42 | errors only in `agent/`, which had no `node_modules`; after `npm ci` there: clean (load 11.83) |
| 6 | Every test WM1's Files name, plus `plan-phases` and `run-close-switch` (16 files) | 15.50 | 4 failed, 1235 passed: the README count (its consent came later), WM0's runs-open acceptance case (which WM1 changes on purpose; updated), `plan-vocabulary`'s stale length, and `coord-db`'s back-fill case timing out at 20 s under load |
| 7 | `plan-phases`, `plan-vocabulary`, `coord-db` again | 11.49 | 217 passed (the timeout was load: green on the rerun) |
| 8 | `mutation-floors` for the four new keys and the two floor checks | 10.57 | 6 passed |
| 9 | The hand mutants | 10.37 | 7 of 7 killed |
| 10 | `single-definition`, `rings`, `coord-policy-rings`, and the guards `deviation-refs` (after `git fetch origin main`), `dtbd`, `topology-clean` | 12.61 | 54 files, 1756 passed |
| 11 | `box-token-census` (after the README lines) with the two new files | 10.75 | 121 passed |
| 12 | After CI's first run (shard 7 of 12 red on two guards: `coordinator-skill.test.ts`, `ticket-required` named nowhere in the skill; `mail-routes.test.ts`, the landing fact's kind `not-landed` an undeclared kebab token, renamed `unlanded`): those two, the two new files, `ccrc-api-closed`, `run-routes`, `mail-inbox-skills`, `routing-references`, `dead-coordinator-prose` | 8.94 | 9 files, 801 passed |
| 13 | `mutation-floors` for the four new keys and the floors-and-sets check, after the rename | 6.91 | 5 passed |
| 14 | After the one merge of `origin/main` 457997a78 (the coordinator's word; only the route counts conflicted, with #2992: 260 routes at the gate, 263 scanned, 163 gated): `auth-gate`, `box-token-census`, `single-definition`, `coordinator-skill`, `mail-routes`, `coord-db` and the two new files | 10.68 | 45 files, 2473 passed |
| 15 | `mutation-floors`' floors-and-sets, no-floor-falls and CONTROL checks after the merge | 8.50 | 3 passed |

| 16 | Fix round 1: `plan-ticket-done` (after C and D) | 8.61 | 57 passed (a first try had 1 red in my own new F7 case: two runs cannot open on one wave, so it holds one ticket and closes one) |
| 17 | `plan-ticket-required` | 11.49 | 15 passed (the dropped-phase case needs the phase declared before it is dropped) |
| 18 | `mutation-floors` for the four keys, the floors-and-sets, no-floor-falls and CONTROL checks | 11.42 | 7 passed: all 38 floor mutants killed |
| 19 | The hand mutants M-8 to M-16 (§4.2), each restored from its saved copy (sha checked) | 10.25, 13.71 | 9 of 9 killed |
| 20 | `tsc --noEmit` of `tsconfig.json`, then of `test/tsconfig.tests.json` | 11.58, 13.26 | both clean |
| 21 | `auth-gate` (the F13 comment) | 10.85 | 347 passed |
| 22 | `mail-routes`, `coord-policy-rings`, `rings/`, `single-definition/`, `deviation-refs` (after `git fetch origin main`), `coordinator-skill`, `anchors`, `citations` | 11.98 | 2011 passed, 1 failed: `coordinator-skill`'s RunRefuseCode census, expected until WM1r lands |
| 23 | Step B, after the merge of `origin/main` 8781ef20a: `tsc --noEmit -p tsconfig.json` | 10.40 | red at `planRoutes.ts` (the door with no other-lanes row, #2996's rule); clean after the fix |
| 24 | `plan-ticket-done` with the Overlord's body case | 9.89 | 58 passed |
| 25 | M-17 (the row's word changed), restored from its saved copy (`cmp` checked) | 11.13 | killed: the Overlord's body case red, 57 others passed |
| 26 | Each file alone, one process each: `run-close-switch`, `open-run-preconditions`, `auth-gate`, `box-token-census`, `ccrc-api`, `ccrc-api-closed`, the four `overlord-other-lanes` files, `plan-ticket-done`, `plan-ticket-required`, `plan-phases`, `plan-routes`, `plan-store`, `plan-policy`, `plan-vocabulary`, `plan-inbound`, `deviation-refs` (after `git fetch origin`), `dtbd`, `topology-clean`, `ci-ledger-guard`, `coordinator-skill` and the 40 `single-definition/` files | 7.45 to 22.11 | every file green, 63 files: 3439 passed (`coordinator-skill` green with WM1r's line on main) |
| 27 | `mutation-floors` for the four keys and the floors-and-sets, no-floor-falls and CONTROL checks | 11.31 | 7 passed |
| 28 | `tsc --noEmit` of `test/tsconfig.tests.json` (a first try was killed by the slice's 6 GB cap), then of `tsconfig.json` | 11.31, 11.57 | both clean |
| 29 | `coord-db` | 13.69 | 1 failed, 148 passed: the delegation tables' any-statement failure case timed out at 120 s, with two OOM kills in the slice during the run |
| 30 | `coord-db` again, alone | 11.48 | 149 passed (657 s) |

`suite: unrun` for this wave: no full server suite ran here; CI's run on the pull request is the next.
