# Task WM1: the task note (desktop polish run 2416, D-8727)

The note for the programme work map's Task WM1, written by its worker for the coordinator to fold into the ledger. Each
claim says whether it was **measured** (read on the tree, the live server or a test run by this task) or **inferred**.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| Migration: `plan_tickets.doneAt INTEGER`, `plan_tickets.doneEvidence TEXT`, and the back-fill of every `done` ticket that names a run (`{"runId":n}` from its `runId`, `doneAt` from that run's `closedAt`) | `server/src/coord/schema.ts`, entry 106 (§2) | Measured: `plan-ticket-done.test.ts`'s back-fill case at the version before it |
| The done arm of `onRunAdvancedInTx` writes `{ runId }` and the time | `server/src/coord/planStore.ts` | Measured: `a run closing done stores doneAt and its runId` |
| `markTicketDone` (the verb's one writer: `done`, `doneAt`, `doneEvidence`, the epic settled, the sync due, one transaction); `doneFactsOf` and `ticketOfRun` (reads) | `planStore.ts`, on the port | Measured: the route cases |
| `runMustNameTicket` (the `ticket-required` rule), `parsePlanTicketDone`, `ticketDoneVerdict` (the evidence rule as review 2375 F2 corrected it), `landedFactOf` | `server/src/coord/planPolicy.ts` (L1) | Measured: `planTicketDoneCases.ts` |
| `planGate` refuses `ticket-required` after `wave-epic-mismatch`, in the no-ticket branch | `server/src/coord/openRun.ts` | Measured: `plan-ticket-required.test.ts` and the gate-order row |
| `phased` and an epic's `tickets` for `planGate` | `server/src/coord/planRunFacts.ts` | Measured: the route cases |
| `POST /api/programmes/:slug/plan/tickets/done` (`plan ticket-done`) | `server/src/coord/planRoutes.ts` | Measured: `plan-ticket-done.test.ts` |
| `evidence-unverified` in `PLAN_REFUSALS` (409); `ticket-required` a `RunRefuseCode` (409); `plan-ticket-done-v1` a `ServerCap`; `TicketDoneEvidence`, `PlanTicketDoneBody` | `shared/plan.ts`, `shared/refusal.ts`, `shared/api.ts` | Measured: `plan-vocabulary.test.ts` |
| The client row `plan.ticket-done`, refused `capability-missing` locally without `plan-ticket-done-v1` | `ccd/ccrc-api` | Measured: `ccrc-api.test.ts` |
| A run and the pull request it carried are one piece of work (review 2429 F2, the coordinator's ruling in fix round 1): `ticketDoneVerdict` reads the landing line's links; `evidenceLinksOf` reads them through `CoordStore.readLanding` only | `planPolicy.ts`, `planRunFacts.ts`, `planRoutes.ts` | Measured: the `verdict:` link cases and the route case `a run and the pull request it carried close one ticket` |
| Fix round 2 (review 2712, the coordinator's rulings): a `{ pr }` the landing line ties to a run that holds another declared ticket refuses, stored evidence or not (F1); on the `{ pr }` side only the linked run's own auto ticket folds in, by ticket id (F2); stored evidence that reads `malformed` goes to the verdict and refuses (F3). `evidenceLinksOf` now always reads a `{ pr }`'s own project's line and gives each tie the ticket its run holds, through `plan.ticketOfRun` | `planPolicy.ts`, `planRunFacts.ts`, `planRoutes.ts` | Measured: the `review 2712` verdict and route cases, red at `949df9ba5` and green after (§6), ST-10 to ST-14 and M-18, M-18b, M-19 (§4) |
| `ticket-required` named in the coordinator's corpus: added for CI's first run, then moved to WM1r, the rules half, in fix round 1 (the review judge's rules-mixed reason). This branch leaves `ccd/coordinator-skill/references/plan.md` as main has it. WM1r landed as #3001, so `coordinator-skill.test.ts`'s RunRefuseCode census is green here (289 of 289, run 26) | none on this branch | Measured: `git diff origin/main -- ccd/coordinator-skill/references/plan.md` is empty |
| The gate's EXEMPT row and the census rows | `server/src/auth/gate.ts`, `auth-gate.test.ts`, `box-token-census.test.ts`, `README.md`, `census-w3/claimant*.ts`, `ccrc-api-closed.test.ts` | Measured: those suites |

**Inferred, not measured (review 2712 F10 (i)):** a link is read from each landing entry's current `runId`, and a re-pin
overwrites it, so an earlier run's tie to the same pull request is invisible after a re-pin. This matches the ruling's "through
the landing line only". I could not establish whether a run whose entry was re-pinned to another run can still reach `done`;
if it can, its `{ runId }` and that pull request could each close a ticket.

## 2. The migration slot, and the merge of main

- **Measured** on `origin/main` at `9e79fb3c1` (WM0 merged): `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`
  printed 93, so this entry was 94. Forecasts A (#2987) then took 94.
- **Step B, after WM1r (#3001) landed** (measured when written, from the counts each merge printed; not re-measured since): one merge of `origin/main` at `8781ef20a`, on the coordinator's word. The same
  count printed 102 there, so this entry was 103. The pre-push fetch then showed the door process A1 (#3035) at 103, so a
  **second merge**, on the coordinator's word, took `origin/main` at `9e372d2bc` (count 103), and this entry was 104.
  Nine files conflicted there (`README.md`, `schema.ts` and the tests `auth-gate`, `box-token-census`, `ccrc-api-closed`,
  `ccrc-api`, `coord-db`, `run-close-switch` and `sim/mutation-floors.json`), each resolved keeping both sides. Both
  sides had added one box-token lane, one `ccrc-api` row and one route, so the lines each wrote alike merged clean one
  short and were re-measured too (`ccd/ccrc-api`, `gate.ts`, `README.md`).
- **The land-sync's merge** (measured when written; the delivery id is from the mail, which the tree cannot show), on the coordinator's word (mail delivery 26229), after review 2740 ruled the PR safe to land:
  the mail idempotency key (#3056) took 105, so the merge took `origin/main` at `c5b4d587c` (count 105), and this entry
  is **106**. Three files conflicted (`schema.ts`, `coord-db`, `run-close-switch`), each resolved keeping both sides;
  coord-db's version literals and `run-close-switch`'s replay count merged clean one short and were re-measured. After
  it: 106 migrations, and `run-close-switch` replays fifty-three (54 through 106). The route counts did not move.
- **Fix round 2's third merge** (measured: review 2740's third lens re-measured every count below and found them true; the delivery id is from the mail), on the coordinator's word (mail delivery 25954): the census of prompts (#3043) took 104,
  so the merge took `origin/main` at `de1cbeddd` (count 104), and this entry was 105. Three files conflicted
  (`schema.ts`, `auth-gate`, `coord-db`), each resolved keeping both sides; the lines each side wrote alike (coord-db's
  literals, auth-gate's route count, `gate.ts`'s route word, `run-close-switch`'s undo list and replay count) merged clean
  one short and were re-measured. After it: 105 migrations, 284 routes scanned, 281 at the gate's HTTP half, 101 exempt,
  180 gated, and `run-close-switch` replays fifty-two (54 through 105). The counts in the bullet "The counts, measured on the
  tree after the second merge", three bullets below, are the second merge's, not this one's.
- **The fifteen conflicted files of the first merge** (measured when written, from the merge's own conflict list; the reading of main's plan writers is inferred from reading them, not from a run), each resolved keeping both sides (the coordinator's terms), its counts re-measured on
  the merged tree: `README.md`, `ccd/ccrc-api`, `server/src/auth/gate.ts`, `server/src/coord/planPolicy.ts`,
  `planRoutes.ts`, `planStore.ts`, `schema.ts`, and the tests `auth-gate`, `box-token-census`, `ccrc-api-closed`,
  `ccrc-api`, `coord-db`, `open-run-preconditions`, `run-close-switch` and `sim/mutation-floors.json`. The plan files met
  only at import lines and header comments: main's new `plan_tickets` writers (the inbound path, #2982) insert an open
  ticket and move one, and neither writes `done`, so the done arm is still the one writer of `doneAt` and `doneEvidence`.
- **The one change the merge forced (its own commit)** (measured: the compile and the other-lanes census named it): since #2996 every plan write door names a row of `OTHER_LANES`
  (`server/src/coord/otherLanes.ts`) that refuses the Overlord's body with `overlord-uses-its-doors`, and the census pins
  the plan-door rows to exactly the write doors `planRoutes.ts` registers. So the `plan ticket-done` door is the row
  `planTicketsDone` (route `POST /api/programmes/:slug/plan/tickets/done`, `plan-door`), shaped as its neighbours; the
  `overlord-other-lanes.test.ts` counts ten plan-door rows (its case `the ten plan-door rows refuse the bound body with
  overlord-uses-its-doors`; review 2740 F11: this note named the pin file); `plan-ticket-done` has the refusal case, and a mutant of the row's word
  turns it red (§4.2, M-17). Claim 5404 holds the two other-lanes files.
- **The counts, measured on the tree after the second merge:** 104 migrations; 91 `ccrc-api` rows, 11 of them `plan`
  rows; 243 mutation floors (main's 239 and WM1's 4); 283 routes scanned, 280 at the gate's HTTP half, 101 exempt HTTP, 179
  gated; 92 machine lanes (89 box-token lanes, plus notify, pools/epoch and updates/intent). `run-close-switch`'s rollback
  undoes migrations 54 to 104, fifty-one in all. At the first merge it read fifty (54 to 103); main's line had said
  forty-three, short already against its own 102.
- **Two pins main gained, which met WM1 in CI's fast run at `74f096c81`** (measured: CI's run 44451428962 named both) (neither was in the run list; both fixed on the
  coordinator's word, each in its own commit, under claim 5437):
  - The plan-reference test from #3040 asks `plan.md` to name every `PLAN_REFUSALS` word, unless its `NOT_MET` table says
    where the word is answered. It already exempts WM1's verb `ticket-done` until WM5 documents it, but not WM1's word
    `evidence-unverified`, which now has a `NOT_MET` row with the same reasoning. Naming it in `plan.md` is a skill-file
    change, which the rules-mixed rule keeps out of this pull request.
  - The act-key store test from #3035 pinned its migration as the last entry, so WM1's 104 turned it red. It now finds the
    entry that creates `continuity_act_keys` and pins slot 102 exactly, since a landed migration never moves.

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
| Evidence already stored on another ticket refuses, except the run's own auto ticket (F2); the run id compared, global across the programme's projects (F5) | `verdict:` cases; route case | ST-1 to ST-5 | Measured |
| A run and the pull request it carried are one piece of work, whichever is named first: a `{ runId }` tied to a stored `{ pr }` and a `{ pr }` tied to a stored `{ runId }` refuse, but not the run's own auto ticket (reviews 2429 F2, 2712 F2) | `verdict:` link cases; the route cases `a run and the pull request it carried close one ticket …` | ST-6, ST-7, ST-9, ST-10, ST-14; M-14 to M-16, M-18, M-18b | Measured (review 2740's third lens counted the floor set, ST-1 to ST-14) |
| A `{ pr }` the landing line ties to a run that holds another declared ticket refuses, stored evidence or not; the run holding this very ticket does not (review 2712 F1) | `verdict:` cases; the route case `a run holding its ticket and the pull request it carried …` | ST-11, ST-12; M-18 | Measured |
| A link that cannot be read refuses (the landing line that ties runs to pull requests) | `verdict:` case; the fenced-landing route case | ST-8; M-13, M-15 | Measured |
| Stored evidence that reads `malformed` refuses every other ticket's `ticket-done` (review 2712 F3) | `verdict:` case; the route case `refuses evidence while another ticket stores evidence that cannot be read` | ST-13; M-19 | Measured |
| The back-fill | `the migration back-fills …` | M-2 | Measured |
| The done arm stores `{ runId }` and the time | `a run closing done stores doneAt and its runId` | M-3 | Measured |
| `markTicketDone` settles the epic and marks the sync due | `settles the epic` | M-4 | Measured |

## 4. Mutants

### 4.1 The floors (`server/test/sim/planTicketDoneSets.ts`)

Four new deciders joined `MUTANT_SETS` and `mutation-floors.json`, each run against every case of
`server/test/planTicketDoneCases.ts`. Measured: `mutation-floors.test.ts` for the four keys, every mutant killed, score 1,
so each floor is 1 (load 10.57). That build had 29 floor mutants (TR 5, BD 5, EV 12, ST 4, LF 3); earlier records said 30
(review 2429 F12). Fix round 1 added 9, so there were 38: TR-6, BD-6, ST-5 to ST-10 and LF-4, every one killed with the
other 29 (load 11.42). Fix round 2 (review 2712) rewrote ST-3 to ST-10 for the new code, made ST-10 tell the linked run's own
auto ticket from any auto ticket (F2), and added ST-11 and ST-12 (F1: the held-ticket refusal, and the run holding this
very ticket), ST-13 (F3: malformed stored evidence) and ST-14 (F8: the `{ pr }` side's ties are this project's, the
review's MD as a floor). There are 42, every one killed (load 4.13).

| Decider | Mutants | What each removes or narrows |
|---|---|---|
| `runMustNameTicket` | TR-1 to TR-6 | the rule whole; the phased test; the `open` test; the no-run test; the not-auto test; any open declared ticket, not every ticket (F9) |
| `parsePlanTicketDone` | BD-1 to BD-6 | the closed shape (a body naming `byId`); exactly one evidence key; the positive bound; the integer test; the plan-key test; a safe integer, not any integer (F10) |
| `ticketDoneVerdict` | EV-1 to EV-10, EV-7b, EV-7c, ST-1 to ST-14 | held (`plan-runs-open`); not open (`plan-bad-body`); no run; this programme; a work run; done; its own ticket (whole, the auto exception, the this-ticket case); no landing entry; unreadable; not landed; the evidence-already-stored rule; its auto-ticket exception; a pull request being one project's; the run id compared; a run id global across the programme's projects (F5); a `{ runId }` tied to a stored `{ pr }` and a `{ pr }` tied to a stored `{ runId }` (F2, one each); an unreadable link; a pull request being one project's on the link; the run's own auto ticket on the `{ pr }` side |
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

Fix round 2 (review 2712), measured the same way, each restored from its saved copy (identical, checked), every one killed
(loads 4.10 to 8.21):

| Id | File | Mutant | Test that reds |
|---|---|---|---|
| ME | `planStore.ts` | `markTicketDone`'s guard loses `AND runId IS NULL` (the review's ME; F4) | `markTicketDone leaves a ticket a run holds (started, or open with a planned run) …` (`plan-store` alone stays green, 57 of 57) |
| M-18 | `planRunFacts.ts` | `evidenceLinksOf` reads a `{ pr }`'s line only when a `{ runId }` is stored, as before (F1) | `a run holding its ticket and the pull request it carried close one ticket …` |
| M-18b | `planRunFacts.ts` | every tie's holder read as none (F1) | the same, and `a run and the pull request it carried close one ticket, whichever is named first` |
| M-19 | `planRoutes.ts` | the route folds `malformed` stored evidence to none again (F3) | `refuses evidence while another ticket stores evidence that cannot be read` |

The review's MD (the `{ pr }` side's project check dropped) is floor mutant ST-14 now, killed by the F8 verdict case.

## 5. Claims and consent

- Claimed by this task (measured): 4843 (the spec, the plan, this note, WM0's note, `shared/api.ts`, `gate.ts`,
  `store.ts`, the new tests, the census tests not held elsewhere, the mutation floors), 4844 (`planRunFacts.ts`, the new
  cases and sets, the shared fixture), 4848 (`plan-phases.test.ts`).
- Claimed by this task for the CI fix (measured): 4864 (`ccd/coordinator-skill/references/plan.md`), released in fix round 1
  once the file was back to main's copy, for WM1r's worker.
- The co-edit bullets below are recorded from the mails that granted them (delivery ids in each); the tree cannot show a consent, so none is measured here.
- Co-edited under the Linear hierarchy wave 4's claims 4783, 4787, 4791 and 4824 (`schema.ts`, `planStore.ts`,
  `planRoutes.ts`, `planPolicy.ts`, `ccd/ccrc-api`, `shared/plan.ts`, `shared/refusal.ts`, `plan-store`, `ccrc-api`,
  `ccrc-api-closed`, `auth-gate`, `coord-db`, `run-close-switch` and `refusal-status` tests): the coordinator's grant (mail
  delivery 23506) and the holder's (23529), on WM0's terms. The exact lines went to its holder (mail 23578, with the zero-context diff as its artifact).
- Co-edited under claim 4829 (Overlord W1 other lanes A): `openRun.ts` and `open-run-preconditions.test.ts`, the four
  edits asked for (mail 23519) and consented to, "Yes to all four, exactly as listed" (delivery 23525).
- Co-edited under claim 4832 (landing order 5i): `README.md`'s two lines, H1 (the lane count eighty-seven to eighty-eight)
  and H2 (`tickets/done` in the plan route list), consented to at main `9e79fb3c1` only (delivery 23558, relayed by
  the holder's frozen-routing session). Main's count has since moved twice (to ninety-one, then ninety-two machine lanes at
  the second merge); the coordinator's consent for README's machine-lane and row count words now stands for whatever the
  merged tree measures at this PR's landing (fix round 2, mail delivery 25901, ruling F10).
- Claimed for step B and fix round 2 (measured): 5404 (`otherLanes.ts`, `overlord-other-lanes.test.ts`), 5437
  (`coordinator-plan-reference.test.ts`, `continuity-act-key-store.test.ts`), and 5462 (fix round 2's paths: `planPolicy.ts`,
  `planRunFacts.ts`, `planRoutes.ts`, the cases and sets, `plan-ticket-done.test.ts`, `auth-gate.test.ts`,
  `overlord-other-lanes-routes.test.ts`, the plan and this note), taken after 4843, 4844 and 4848 lapsed. Three peers
  (runs 2672, 2446 and 2570) were sent the act-key pin's exact lines under 5437, so their branches merge it clean.

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
| 31 | After the second merge (`origin/main` 9e372d2bc, migration 104): `tsc --noEmit -p tsconfig.json` | 11.06 | clean |
| 32 | Each file alone: `run-close-switch`, `auth-gate`, `box-token-census`, `ccrc-api`, `ccrc-api-closed`, `plan-ticket-done`, `deviation-refs` (after `git fetch origin`), `ci-ledger-guard` and the 40 `single-definition/` files | 8.37 to 13.00 | every file green, 48 files: 2444 passed |
| 33 | `mutation-floors` for the four keys and the three checks; `tsc --noEmit -p test/tsconfig.tests.json` | 9.23 | 7 passed; clean |
| 34 | `coord-db` | 9.58 | 1 failed, 148 passed: the delegation tables' any-statement case timed out at 120 s again, with four OOM kills in the slice |
| 35 | `coord-db` again, alone | 10.83 | 2 failed, 147 passed: two other cases (goals versions, WM0's phases) timed out at 20 s, with two OOM kills in the slice. Every failure in runs 29, 34 and 35 is a timeout, never an assertion, a different case each time; run 30 was green, and CI's fast run (which runs `coord-db`) is the arbiter |
| 36 | CI's fast run at `74f096c81` (run 44451428962) | — | red on two shards, one real failure each, from pins main gained: the plan-reference test (`evidence-unverified` not in `plan.md`) and the act-key store test (its migration no longer last); every other shard green, `coord-db` included (149 passed in 17 s on shard 10: the local reds of runs 29, 34 and 35 were load) |
| 37 | `continuity-act-key-store` after its slot pin | 7.00 | 15 passed |
| 38 | `coordinator-plan-reference` after the `NOT_MET` row | 7.06 | 15 passed |
| 39 | `mutation-floors` for the four keys and the three checks; `deviation-refs` (after `git fetch origin`) | 5.66 | 7 passed; 34 passed |
| 40 | Fix round 2 (review 2712): `plan-ticket-done` with the new cases, before any code change (at `949df9ba5`'s code) | 3.08 | 5 failed, 59 passed: the F1, F2 and F3 verdict cases and the F1 and F3 route cases, each for the right reason (`ok` where a refusal is due, a `TypeError` on `malformed`, 200 where 409 is due); the F4, F8 and F9 (v) pins are green there, as pins of behaviour already right |
| 41 | `plan-ticket-done` after the fix; `tsc --noEmit -p tsconfig.json` | 3.65 | 64 passed; clean |
| 42 | `mutation-floors` for the four keys and the three checks | 4.13 | 7 passed: all 42 floor mutants killed |
| 43 | The hand mutants ME, M-18, M-18b, M-19 (§4.2) | 4.10 to 8.21 | 4 of 4 killed (ME also run against `plan-store`, which stays green) |
| 44 | Each file alone: `plan-ticket-done`, `plan-ticket-required`, `plan-store`, `plan-routes`, `plan-policy`, `plan-phases`, three `overlord-other-lanes` files (the pin file not), `coordinator-plan-reference`, `auth-gate`, `deviation-refs` (after `git fetch origin`), `dtbd`, `topology-clean`, `ci-ledger-guard` and the 40 `single-definition/` files | 6.45 to 11.52 | every file green, 55 files: 2547 passed |
| 45 | `tsc --noEmit` of `tsconfig.json`, then of `test/tsconfig.tests.json` | 8.42, 12.56 | both clean |
| 46 | `mutation-floors`, the whole file (after `npm ci` in `ui/` and `pwa/`) | 11.08, 12.80 | killed twice by the test slice's 6 GB memory cap (two and five OOM kills from the shared slice); a third try was stopped for the third merge, and the file runs again after it |
| 47 | After the third merge (`origin/main` de1cbeddd, migration 105): the server compile, `plan-ticket-done` (slot pinned at 105), `run-close-switch`, `coord-db`, and the test-project compile | 9.06 to 10.80 | clean; 64 passed; 21 passed; 149 passed; clean |
| 48 | `auth-gate` | 10.80 | 1 failed, 367 passed: the property loop's comment still said 280 HTTP routes, a line both sides wrote alike that merged clean one short; corrected to 281 |
| 49 | `auth-gate` again | 11.57 | 368 passed |
| 50 | `mutation-floors`, the whole file, one worker | 11.87 | 252 passed: every programme's floor mutants, WM1's 42 among them |

`suite: unrun` for this wave: no full server suite ran here; CI's run on the pull request is the next.

## 7. What review 2740 left, and what WM7 did with it (D-8845)

Recorded by Task WM7; the cases WM7 added and their mutants are in `wm7.md`. Each line says whether it was measured or inferred.

- **F3, a record (measured by reading and by grep).** One stored evidence that reads as `malformed` makes every `plan ticket-done` in
  that programme refuse `evidence-unverified`, whichever kind the caller names, and nothing in the tree repairs such a row. The
  refusal is `ticketDoneVerdict`'s `unread` arm (`server/src/coord/planPolicy.ts`, the `f.stored.find(… === 'malformed')` line, reached
  after the link check and before any holder rule). A row can only read `malformed` if `doneEvidence` holds text that is neither
  kind: the writers of that column are `markTicketDone` and the done arm of `onRunAdvancedInTx` in `planStore.ts` (a grep of
  `server/src/coord` for `doneEvidence` finds those two and the migration's back-fill), and each writes a typed evidence, so the
  state is reachable only by a hand edit of `coord.db`. The refusal fails closed, as review 2712 F3 ruled. A repair is an operator's
  edit of the row; no verb does it.
- **F5, a correction of a record (inferred, from the diff and run 40).** Fix round 2's commit message says its new F1, F2 and F3 verdict and
  route cases were red at `949df9ba5`. Run 40 (above) measured them red, but for one of them, the verdict case for stored
  `malformed` evidence, by a throw: the old verdict evaluated `in` on the string `malformed` (a `TypeError`), not a wrong
  verdict word. The route case `refuses evidence while another ticket stores evidence that cannot be read` is the one red for the right
  reason there (the old route dropped `malformed` before the verdict, so it answered 200 where 409 is due).
- **F7, the tally (measured by reading `auth-gate.test.ts`).** The comment chain of route counts in the property loop stays one low
  against its own pairs where WM1's fix round moved a jump down a line instead of removing it: the designation's Settings doors
  line ends at gated 163, and the next line (the 265-route inbound path, main's) reads "the gated count 162 -> 163". No assertion
  reads the comment; the file's own note near the Models line already says the gated figures in this tally trail the derived value
  (the HTTP half less the exempt-HTTP count) by one. WM7 left the comment as it stands: the file is held by another wave's claim, and
  the direction offered this record in its place.
- **F12, the route suite's door table (measured by reading `overlord-other-lanes-routes.test.ts`).** Review 2712 F7 asked for
  `planTicketsDone` among the route suite's `PLAN_DOORS`. The build added a separate `WORK_MAP_DOORS` table beside `INBOUND_DOORS` and
  loops both with the core doors. The table's own comment gives the reason: a plain session passes the Overlord's lane and is
  answered by the door's own evidence check (`409 evidence-unverified`, no landing entry), where a `PLAN_DOORS` row expects the
  lane's word. The suite is green (35 of 35 in review 2740's run).
- **F1 and F2, pins (measured by WM7's cases, `wm7.md`).** F1 (the landing lines `evidenceLinksOf` reads for a `{ runId }`) and F2
  (the `{ pr }` holder check over several ties) are pinned in `wm7.md`'s table, with their mutants.
- **F4, left (the review's own direction says later).** A run read that fails is refused by the route itself, because
  `TicketDoneFacts['run']` has no `unreadable` arm: a decision in delivery code, failing closed, pinned by `refuses a run that
  cannot be read` since review 2429 F3. The direction is an `unreadable` arm on `run`, decided in the verdict; it changes no
  answer, so no ruling is needed, and it is left for a later task that edits `ticketDoneVerdict`.
- **F6 belongs to WM5** (its Files line and Step 1b). **F8 is the coordinator's** (the migration slot, settled at landing).
  **F9, F10 and F11 are done in this note** (the rows of §3; the labels and the pointer of §2 and §5; the file name of §2).
