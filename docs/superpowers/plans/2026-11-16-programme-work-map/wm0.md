# Task WM0: the task note (desktop polish run 2362, D-8715)

The note for the programme work map's Task WM0, written by its worker for the coordinator to fold into the ledger. Each
claim says whether it was **measured** (read on the tree or the live server by this task) or **inferred**.

## 1. The first commit: review 2268's amendments

The first commit is docs only. It amends the spec (`docs/superpowers/specs/2026-11-16-programme-work-map-design.md`)
and the plan (`docs/superpowers/plans/2026-11-16-programme-work-map.md`) for review 2268's findings, as the brief
directs. Where a finding left a choice, the narrowest reading consistent with the rulings was taken, and the table
says which.

| Finding | What changed | Choice taken |
|---|---|---|
| F1 | Table 6 row 4 covers a done ticket with no stored evidence ("marked done, but no evidence stored"); WM1's migration back-fills `doneEvidence {runId}` and `doneAt` from the ticket's run; §4.1, WM1 and WM2 say so | Both of the review's directions: the back-fill (measured: the only writer of `done` is `onRunAdvancedInTx`'s done arm, which keeps `runId`) and the explicit row, so the decider never falls through |
| F2 | One piece of evidence closes at most one ticket; `{ runId }` needs the run's own ticket to be an auto ticket or none; the fold names exactly one declared ticket; WM1 tests | Refusal rides `evidence-unverified` with a detail, no new word |
| F3 | A whole-epic reference to a dropped epic still holds its done tickets; the strip keeps a dropped epic's chip, marked dropped, while it holds a done ticket | The rule that keeps the strip's sum equal to the headline (done work stays counted) |
| F4 | `left-open` is a status and a group of its own; a phase with a left-open ticket reads "left open" and is not finished | A new group, rather than folding into an existing one |
| F5 | `shared/api.ts` (`ServerCap`, `SERVER_CAP_MAP`) in WM0's and WM1's Files and Table 2; `census-w3/claimant.test.ts` in both test lists | As directed |
| F6 | `PhaseView.number` derived once by `phaseNumbers` in `planPolicy.ts` (L1); `WorkPhaseView.number` and the carry fields carry numbers from it; `PlanView.phases` is optional; each field's reader named | The derivation lives in L1 policy, where both the plan read (WM0) and `workMapOf` (WM2) reach it |
| F7 | `WorkMapView.initiatives` is a list, one per workspace, as `PlanView` carries it | As directed |
| F8 | The Task 6.1 overlap stated both ways; WM5 adds the words with recoveries to `plan.md` and `ticket-required` to `api.md`, the pin from five to six | As directed |
| F9 | Table 6a's "Done" is the verified status; a done-unverified ticket is outstanding (held) and keeps its phase open; no verb re-records evidence in this build | "It stays held", the narrower of the two directions |
| F10 | Corrected to the coordinator's ruling: the hierarchy's close with a reason is kept as its own outcome, "closed", counted apart, Table 6 row 2; D11, Table 8 and §8 corrected | The ruling |
| F11 | One sentence under Figure 4: the sample needs WM6 (Q5 yes); no re-render | As the brief said |
| F12 | A recorded carry is never undone or corrupted without a refusal: `remove` of either end of a recorded carry is refused `bad-carry`, every other remove allowed; a put that orders a carry's target at or before its source is refused `bad-carry`; one transaction; `plan-closed` on both verbs. Dropping a carry's target phase still voids it, since that act needs a reason and is recorded | Refuse rather than void, so nothing undoes a carry silently; the drop path was already in the spec |
| F13 | The claim inventory replaced by "re-read the live claims list", with today's holders (claims 4728, 4732, 4737) as the example; `planRoutes.ts` named in the overlap; WM2 gated on it | As directed |
| F14 | An empty phase (no own work, no carry out) is never finished; `carriedFrom` is a list in phase order | A list, so a ticket carried into one phase from two keeps both |
| F15 | The last view lives in WM4 alone; the route's answer when the plan read itself fails is a refusal with no `plan` and no `work` | As directed |
| F16 | "11 of 20" corrected to "11 of 21" in WM3 | As directed |
| F17 | Item numbers paired with R129 to R133 in the spec and the plan; item 359 named in Q5 | The spec and the plan only; the C37 section is the coordinator's ledger |
| F18 | Overlord row: 48 plan files (49 with the index plan beside it) | Both figures, so nothing is lost |
| F19 | `{ pr }` evidence is judged by the ticket's own project, in the spec and the plan | The ticket's project: a re-projected ticket's pull request lands in its own project |
| F20 | "Only `linear-text-public` has a console sentence"; WM0 corrects `PLAN_REFUSALS`' doc comment | As directed |
| F21 | `plan ticket-done` reuses `plan-runs-open` and `plan-bad-body`; `ticket-not-open` is never added | Reuse, the narrower vocabulary |
| F22 | D3 says fifteen statuses in nine groups; `WORK_STATUSES` follows Table 6's order plus `failed`; "carried" is `carriedWords`' word, not a status | As directed |
| F23 | `WorkEpicView.checkpointsMet` and `checkpointsTotal`, dropped checkpoints in neither | Decided on the server, in `workMapOf` |
| F24 | The spec's Q5 text aligned to WM6's rule | As directed |
| F25 | "Waiting" means the operator on the Work card; the page head's run count is the runs' own word | Narrowed the sentence rather than renaming the head |
| F26 | Moot: the PR merged | — |
| F27 | `docs/superpowers/plans/2026-10-22-desktop-polish.md` C37: the "Decided" bullet's trailing sentence ("The card replaces the Linear hierarchy plan's Task 5.2.") dropped, unclaimed as the brief said | Read "the trailing sentence" as the review's location field gives it: the last sentence of the Decided bullet, which repeated that bullet's own first sentence. The D-8669 entry keeps its statement |

R133 (item 359, Q5 yes) is recorded in the spec's Table 1b, §3, Table 8 and "Where things stand", and in the plan's
header, Gates, WM6 and "Where things stand". The spec's status line says the operator approved it (item 363).

## 2. The build

### 2.1 What it adds

| Part | Where | What |
|---|---|---|
| Vocabulary | `shared/plan.ts` (L0) | `PHASE_REF_KINDS`, `PHASE_REF_OPS`, `PLAN_BOUNDS.phases` (24) and `refsPerPhase` (200); `unknown-ref` and `bad-carry` in `PLAN_REFUSALS` (F20's doc comment corrected); the phase bodies, `PlanPutBody.phases?`, `PlanPhaseRefMoveBody`, `PhaseRefView`, `PhaseView`, `PlanView.phases?` |
| Statuses | `shared/refusal.ts` | `unknown-ref` 404 (like the other absent objects), `bad-carry` 409 |
| Capability | `shared/api.ts` | `plan-phases-v1` in `ServerCap` and `SERVER_CAP_MAP` (F5) |
| Migration | `server/src/coord/schema.ts` | Entry 88: `plan_phases` and `plan_phase_refs`, new tables only, with UNIQUE (`program`, `key`), UNIQUE (`phaseId`, `kind`, `refId`) and CHECKs that a carry has its time and is a ticket's |
| Deciders | `server/src/coord/planPolicy.ts` (L1) | `parsePlanPut` takes `phases`; `parsePlanPhaseRef`; `phaseNumbers` (the one derivation of a phase's number, F6); `diffPhases` (a put's phases, D18 and F12's reorder rule); `phaseRefVerdict` (add, remove and carry, D17 and F12's remove rule) |
| Store | `server/src/coord/planStore.ts` (L3) | `phasesOf`; a put's phases applied inside `applyPlanChanges`' transaction; `writePhaseRef`, the one writer of `plan phase-ref`, a carry's two halves in one transaction |
| Routes | `server/src/coord/planRoutes.ts` (L4) | `plan put` masks and text-checks phase text, then `diffPhases`; `plan show` answers `phases` only when the programme declares one; `POST /api/programmes/:slug/plan/phases/refs` behind the box token, the query identity, the owner check and `plan-closed` |
| Gate | `server/src/auth/gate.ts` | The route's EXEMPT row, like its plan siblings; the lane counts (eighty-three and eighty-six) and the route count (251) |
| Client | `ccd/ccrc-api` | `plan phase-ref <slug> --json <f>`, refused locally `capability-missing` when a current cap file omits `plan-phases-v1` |

`openRun.ts` is untouched (WM1's). `runs open` is unchanged for every plan (measured: the acceptance case below).

### 2.2 The migration slot

Measured: `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` printed 87 at
`421be9977` (the branch's base), so WM0 takes 88. The Linear hierarchy's wave 4 holds a migration of its own (its
`linear_*` tables); on the coordinator's terms whichever of the two lands second takes the next free slot. The slot is
re-measured before the PR and again before merge.

### 2.3 The rows and what reds each

`server/test/plan-phases.test.ts` holds the plan's Step 1 rows (49 cases: 27 decider cases from `planPhasesCases.ts`, 20
route cases and the 2 acceptance cases). **Run to fail, measured:** the file against `origin/main`'s source (the eight
touched source files checked out from `origin/main` over a committed tree, then restored) gave 48 failed and 1 passed,
the one pass being the characterization, green on `main` by design.

| Row | Reds when |
|---|---|
| plan put stores phases in order with their references | the put's phases are not stored or not answered |
| a phase's number counts only phases not dropped | `phaseNumbers` counts a dropped phase (mutants N-1, N-2) |
| a put with no phases key leaves the stored phases | an absent `phases` drops or rewrites the stored ones |
| a put adds references and never removes one | a put replaces references (D18) |
| a phase may reference a whole epic and a ticket; one ticket may be referenced by two phases | either kind or a shared ticket is refused |
| a new reference to an unknown or dropped object is refused unknown-ref | the put's unknown-ref check is gone (UR-4 to UR-8) |
| a reference stored before its ticket dropped is kept | a held reference is re-judged (K-1) |
| dropping a phase needs a reason and leaves its tickets alone | the droppedWhy requirement is gone (DW-1, DW-2) |
| more than 24 phases; a repeated key; an unknown reference kind | the parser's bounds |
| a put that orders a carry's target before its source is refused bad-carry | F12's reorder rule is gone (F12-3, F12-3b) |
| phase-ref adds and removes one reference | the verb's write |
| phase-ref carries a ticket and records the time; a carry out of a whole-epic reference is stored on a ticket reference | the carry's two halves |
| each bad-carry case is refused, and changes nothing | any bad-carry arm is gone (BC-1 to BC-5d) |
| removing either end of a recorded carry is refused bad-carry; removing any other reference is allowed | F12's remove rule is gone or too wide (F12-1, F12-1b, F12-2) |
| add and remove refuse an unknown or dropped phase, and an unknown object | the verb's unknown-ref checks (UR-1 to UR-3) |
| phase-ref refuses a caller that is not the coordinator; a body naming byId is refused; plan-closed after the plan ends | the owner check, the closed body, the end check |
| the stored plans read the same as before | a plan with no phases reads differently from `main` |
| runs open is unchanged for every plan | a phased plan changes what `runs open` admits or attaches |
| `ccrc-api.test.ts`: the phase-ref row is refused locally without plan-phases-v1 | the client gate is gone (measured: the gate replaced by `if false` reds the row; restored from a saved copy) |

**The acceptance (measured).** `fixtures/plan-phases/characterization.json` was produced by
`helpers/planPhasesFixture.ts`, which uses only routes that exist before WM0, run against `origin/main`'s source: two
plans shaped like the two live ones (six epics, one wave each, 26 tickets, a done run, a started run, an auto ticket, a
dropped ticket; and one epic with a failed run). On WM0's code the same builder reads byte-for-byte the same JSON, and a
plan that declares phases opens a run with a named ticket and one with none exactly as before.

### 2.4 The mutants

`server/test/sim/planPhasesSets.ts` registers three deciders in `MUTANT_SETS`, each run against every case of
`planPhasesCases.ts`; `mutation-floors.json` holds a floor of 1 for each (measured: 27 of 27 killed). Two mutants
survived the first run, BC-1 and BC-2: a dropped phase has no number, so the "not later" check refused the same carry
with the same word. The cases now pin the detail ("phase pd was dropped"), which is what tells the coordinator the cause.

| Decider | Mutant | What it removes | Killed by |
|---|---|---|---|
| `phaseNumbers` | N-1 | the dropped test | a phase's number counts only the phases not dropped |
| `phaseNumbers` | N-2 | the 1-base | the same |
| `diffPhases` | DW-1 | **the droppedWhy requirement** | dropped-needs-reason: a stored phase left out of the put |
| `diffPhases` | DW-2 | a new phase's droppedWhy refusal | a phase dropped with a reason is dropped; a new one cannot carry droppedWhy |
| `diffPhases` | UR-4 | **the put's unknown-ref check** | unknown-ref: a put's new reference to a dropped or unknown object |
| `diffPhases` | UR-5, UR-6 | an epic dropped by the put; a stored dropped epic named again | the same |
| `diffPhases` | UR-7, UR-8 | an open ticket of an epic the put drops; a dropped ticket | the same |
| `diffPhases` | K-1 | the skip of a reference the phase holds | a reference stored before its object dropped is kept |
| `diffPhases` | F12-3, F12-3b | **F12's reorder refusal** (removed; narrowed) | F12: a put that orders a carry's target at or before its source |
| `phaseRefVerdict` | BC-1 | **bad-carry: the from phase dropped** | bad-carry: the from phase is dropped, and the detail says so |
| `phaseRefVerdict` | BC-2 | **bad-carry: the to phase dropped** | bad-carry: the to phase is dropped, and the detail says so |
| `phaseRefVerdict` | BC-3, BC-3b | **bad-carry: not later** (removed; `>=`) | bad-carry: the to phase is not later (earlier, or the same phase) |
| `phaseRefVerdict` | BC-4 | **bad-carry: the ticket done** | bad-carry: the ticket is done |
| `phaseRefVerdict` | BC-5 | **bad-carry: not the from phase's work** | bad-carry: the ticket is not the from phase's work |
| `phaseRefVerdict` | BC-5b, BC-5c, BC-5d | its three parts: carried out, dropped, a void carry | already carried out; a dropped ticket held through its epic; a carry to a dropped phase is void |
| `phaseRefVerdict` | UR-1, UR-2, UR-3 | **the verb's unknown-ref checks**: a dropped object, a dropped phase, a reference not held | unknown-ref: a new reference to a dropped or unknown object; on a dropped or unknown phase; remove deletes … |
| `phaseRefVerdict` | F12-1, F12-1b | **F12's remove refusal, the source end** (removed; widened to a void carry) | F12: removing the source end …; F12: every other remove is allowed |
| `phaseRefVerdict` | F12-2 | **F12's remove refusal, the target end** | F12: removing the target end of a recorded carry is bad-carry |

Bold rows are the brief's list: each bad-carry arm, the unknown-ref check, the droppedWhy requirement and F12's remove
refusal.

### 2.5 Claims and consent

- Claimed by this task (measured): 4741 (the spec, this plan, this note, `shared/api.ts`, `gate.ts`, and the tests not
  held elsewhere), 4742 (the new test files, the fixture, the mutation floors), 4743 (`census-w3/claimant.ts`).
- Co-edited under the Linear hierarchy wave 4's claims 4728, 4732 and 4737 (`schema.ts`, `planStore.ts`,
  `planPolicy.ts`, `planRoutes.ts`, `shared/plan.ts`, `shared/refusal.ts`, `ccd/ccrc-api`, `plan-store.test.ts`,
  `ccrc-api.test.ts`, `ccrc-api-closed.test.ts`, `coord-db.test.ts`, `auth-gate.test.ts`): the coordinator's grant
  (mail delivery 22681) and the holder's consent (22680, "Yes: co-edit …, on the coordinator's terms"), measured from
  the mail. The lines WM0 changes in each were mailed to the holder (mail 22709). `plan-store.test.ts` needed no
  change.
- `docs/superpowers/plans/2026-10-22-desktop-polish.md` was edited unclaimed (F27's one sentence), as the brief said.
- `README.md` is held by another run (claim 4717). Its lane count is the one line `box-token-census.test.ts` reads. The
  exact two-line scope against `421be9977` went to its holder (mail 22708), and the holder answered yes to each line
  separately (relayed, mail delivery 22724): the count word eighty-five to eighty-six, and `phases/refs` in the plan
  verbs' route list. Those two lines are the whole README change (measured with `git diff`).
