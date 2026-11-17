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
| The gate's EXEMPT row and the census rows | `server/src/auth/gate.ts`, `auth-gate.test.ts`, `box-token-census.test.ts`, `README.md`, `census-w3/claimant*.ts`, `ccrc-api-closed.test.ts` | Measured: those suites |

## 2. The migration slot

- **Measured** on `origin/main` at `9e79fb3c1` (WM0 merged): `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`
  printed 93, so this entry is 94.
- **Inferred, and to re-measure at the push:** the Linear hierarchy's wave 4 (#2982) said it takes 94 when it merges WM0.
  If it lands first, this entry takes the next slot by one merge of `origin/main` (the coordinator's terms).

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
so each floor is 1 (load 10.57).

| Decider | Mutants | What each removes or narrows |
|---|---|---|
| `runMustNameTicket` | TR-1 to TR-5 | the rule whole; the phased test; the `open` test; the no-run test; the not-auto test |
| `parsePlanTicketDone` | BD-1 to BD-5 | the closed shape (a body naming `byId`); exactly one evidence key; the positive bound; the integer test; the plan-key test |
| `ticketDoneVerdict` | EV-1 to EV-10, EV-7b, EV-7c, ST-1 to ST-4 | held (`plan-runs-open`); not open (`plan-bad-body`); no run; this programme; a work run; done; its own ticket (whole, the auto exception, the this-ticket case); no landing entry; unreadable; not landed; the evidence-already-stored rule; its auto-ticket exception; a pull request being one project's; the run id compared |
| `landedFactOf` | LF-1 to LF-3 | any entry landed (not only the newest); the filter by pull request; the no-entry answer |

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

## 5. Claims and consent

- Claimed by this task (measured): 4843 (the spec, the plan, this note, WM0's note, `shared/api.ts`, `gate.ts`,
  `store.ts`, the new tests, the census tests not held elsewhere, the mutation floors), 4844 (`planRunFacts.ts`, the new
  cases and sets, the shared fixture), 4848 (`plan-phases.test.ts`).
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

`suite: unrun` for this wave: no full server suite ran here; CI's run on the pull request is the next.
