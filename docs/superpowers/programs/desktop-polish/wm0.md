# Task WM0: the task note (desktop polish run 2362, D-8715)

The note for the programme work map's Task WM0, written by its worker for the coordinator to fold into the ledger. Each
claim says whether it was **measured** (read on the tree or the live server by this task) or **inferred**. It moved here
from `docs/superpowers/plans/2026-11-16-programme-work-map/wm0.md` in fix round 2, on the operator's ruling that task
notes leave `plans/` (the coordinator's mails 23007 and 23010).

## 1. The first commit: review 2268's amendments

The first commit is docs only. It amends the spec (`docs/superpowers/specs/2026-11-16-programme-work-map-design.md`)
and the plan (`docs/superpowers/plans/2026-11-16-programme-work-map.md`) for review 2268's findings, as the brief
directs. Where a finding left a choice, the narrowest reading consistent with the rulings was taken, and the table
says which.

| Finding | What changed | Choice taken | Basis |
|---|---|---|---|
| F1 | Table 6 row 4 covers a done ticket with no stored evidence ("marked done, but no evidence stored"); WM1's migration back-fills `doneEvidence {runId}` and `doneAt` from the ticket's run; §4.1, WM1 and WM2 say so | Both of the review's directions: the back-fill (measured: the only writer of `done` is `onRunAdvancedInTx`'s done arm, which keeps `runId`) and the explicit row, so the decider never falls through | Measured: the amended text at `3909c9056` |
| F2 | One piece of evidence closes at most one ticket; `{ runId }` needs the run's own ticket to be an auto ticket or none (corrected in fix round 1, review 2375 F2: the ticket itself, an auto ticket or none, and the run's own auto ticket's evidence never refuses); the fold names exactly one declared ticket; WM1 tests | Refusal rides `evidence-unverified` with a detail, no new word | Measured: the amended text at `3909c9056` |
| F3 | A whole-epic reference to a dropped epic still holds its done tickets; the strip keeps a dropped epic's chip, marked dropped, while it holds a done ticket | The rule that keeps the strip's sum equal to the headline (done work stays counted) | Measured: the amended text at `3909c9056` |
| F4 | `left-open` is a status and a group of its own; a phase with a left-open ticket reads "left open" and is not finished | A new group, rather than folding into an existing one | Measured: the amended text at `3909c9056` |
| F5 | `shared/api.ts` (`ServerCap`, `SERVER_CAP_MAP`) in WM0's and WM1's Files and Table 2; `census-w3/claimant.test.ts` in both test lists | As directed | Measured: the amended text at `3909c9056` |
| F6 | `PhaseView.number` derived once by `phaseNumbers` in `planPolicy.ts` (L1); `WorkPhaseView.number` and the carry fields carry numbers from it; `PlanView.phases` is optional; each field's reader named | The derivation lives in L1 policy, where both the plan read (WM0) and `workMapOf` (WM2) reach it | Measured: the amended text at `3909c9056` |
| F7 | `WorkMapView.initiatives` is a list, one per workspace, as `PlanView` carries it | As directed | Measured: the amended text at `3909c9056` |
| F8 | The Task 6.1 overlap stated both ways; WM5 adds the words with recoveries to `plan.md` and `ticket-required` to `api.md`, the pin from five to six | As directed | Measured: the amended text at `3909c9056` |
| F9 | Table 6a's "Done" is the verified status; a done-unverified ticket is outstanding (held) and keeps its phase open; no verb re-records evidence in this build | "It stays held", the narrower of the two directions | Measured: the amended text at `3909c9056` |
| F10 | Corrected to the coordinator's ruling: the hierarchy's close with a reason is kept as its own outcome, "closed", counted apart, Table 6 row 2; D11, Table 8 and §8 corrected | The ruling | Measured: the amended text at `3909c9056` |
| F11 | One sentence under Figure 4: the sample needs WM6 (Q5 yes); no re-render | As the brief said | Measured: the amended text at `3909c9056` |
| F12 | A recorded carry is never undone or corrupted without a refusal: `remove` of either end of a recorded carry is refused `bad-carry`, every other remove allowed; a put that orders a carry's target at or before its source is refused `bad-carry`; one transaction; `plan-closed` on both verbs. Dropping a carry's target phase still voids it, since that act needs a reason and is recorded | Refuse rather than void, so nothing undoes a carry silently; the drop path was already in the spec | Measured: the amended text at `3909c9056` |
| F13 | The claim inventory replaced by "re-read the live claims list", with today's holders (claims 4728, 4732, 4737) as the example; `planRoutes.ts` named in the overlap; WM2 gated on it | As directed | Measured: the amended text at `3909c9056` |
| F14 | An empty phase (no own work, no carry out) is never finished; `carriedFrom` is a list in phase order | A list, so a ticket carried into one phase from two keeps both | Measured: the amended text at `3909c9056` |
| F15 | The last view lives in WM4 alone; the route's answer when the plan read itself fails is a refusal with no `plan` and no `work` | As directed | Measured: the amended text at `3909c9056` |
| F16 | "11 of 20" corrected to "11 of 21" in WM3 | As directed | Measured: the amended text at `3909c9056` |
| F17 | Item numbers paired with R129 to R133 in the spec and the plan; item 359 named in Q5 | The spec and the plan only; the C37 section is the coordinator's ledger | Measured: the amended text at `3909c9056` |
| F18 | Overlord row: 48 plan files (49 with the index plan beside it) | Both figures, so nothing is lost | Measured: the amended text at `3909c9056` |
| F19 | `{ pr }` evidence is judged by the ticket's own project, in the spec and the plan | The ticket's project: a re-projected ticket's pull request lands in its own project | Measured: the amended text at `3909c9056` |
| F20 | "Only `linear-text-public` has a console sentence"; WM0 corrects `PLAN_REFUSALS`' doc comment (corrected in fix round 1, review 2375 F11: `item-act-mismatch` has one too, measured in `refusalWords.ts`) | As directed | Measured: the amended text at `3909c9056` |
| F21 | `plan ticket-done` reuses `plan-runs-open` and `plan-bad-body`; `ticket-not-open` is never added | Reuse, the narrower vocabulary | Measured: the amended text at `3909c9056` |
| F22 | D3 says fifteen statuses in nine groups; `WORK_STATUSES` follows Table 6's order plus `failed`; "carried" is `carriedWords`' word, not a status | As directed | Measured: the amended text at `3909c9056` |
| F23 | `WorkEpicView.checkpointsMet` and `checkpointsTotal`, dropped checkpoints in neither | Decided on the server, in `workMapOf` | Measured: the amended text at `3909c9056` |
| F24 | The spec's Q5 text aligned to WM6's rule | As directed | Measured: the amended text at `3909c9056` |
| F25 | "Waiting" means the operator on the Work card; the page head's run count is the runs' own word | Narrowed the sentence rather than renaming the head | Measured: the amended text at `3909c9056` |
| F26 | Moot: the PR merged | — | Inferred: the brief's word |
| F27 | `docs/superpowers/plans/2026-10-22-desktop-polish.md` C37: the "Decided" bullet's trailing sentence ("The card replaces the Linear hierarchy plan's Task 5.2.") dropped, unclaimed as the brief said | Read "the trailing sentence" as the review's location field gives it: the last sentence of the Decided bullet, which repeated that bullet's own first sentence. The D-8669 entry keeps its statement | Measured: the amended text at `3909c9056` |

R133 (item 359, Q5 yes) is recorded in the spec's Table 1b, §3, Table 8 and "Where things stand", and in the plan's
header, Gates, WM6 and "Where things stand". The spec's status line says the operator approved it (item 363).
Measured: the amended text at `3909c9056`.

## 2. The build

### 2.1 What it adds

| Part | Where | What | Basis |
|---|---|---|---|
| Vocabulary | `shared/plan.ts` (L0) | `PHASE_REF_KINDS`, `PHASE_REF_OPS`, `PLAN_BOUNDS.phases` (24) and `refsPerPhase` (200); `unknown-ref` and `bad-carry` in `PLAN_REFUSALS` (F20's doc comment corrected); the phase bodies, `PlanPutBody.phases?`, `PlanPhaseRefMoveBody`, `PhaseRefView`, `PhaseView`, `PlanView.phases?` | Measured: read on the tree |
| Statuses | `shared/refusal.ts` | `unknown-ref` 404 (like the other absent objects), `bad-carry` 409 | Measured: read on the tree |
| Capability | `shared/api.ts` | `plan-phases-v1` in `ServerCap` and `SERVER_CAP_MAP` (F5) | Measured: read on the tree |
| Migration | `server/src/coord/schema.ts` | Entry 92 (88 at the branch's start, 89 after the first merge, 90 after fix round 1's, 91 and then 92 after fix round 2's two; §2.2): `plan_phases` and `plan_phase_refs`, new tables only, with UNIQUE (`program`, `key`), UNIQUE (`phaseId`, `kind`, `refId`) and CHECKs that a carry has its time and is a ticket's | Measured: read on the tree |
| Deciders | `server/src/coord/planPolicy.ts` (L1) | `parsePlanPut` takes `phases`; `parsePlanPhaseRef`; `phaseNumbers` (the one derivation of a phase's number, F6); `diffPhases` (a put's phases, D18 and F12's reorder rule); `phaseRefVerdict` (add, remove and carry, D17 and F12's remove rule) | Measured: read on the tree |
| Store | `server/src/coord/planStore.ts` (L3) | `phasesOf`; a put's phases applied inside `applyPlanChanges`' transaction; `writePhaseRef`, the one writer of `plan phase-ref`, a carry's two halves in one transaction | Measured: read on the tree |
| Routes | `server/src/coord/planRoutes.ts` (L4) | `plan put` masks and text-checks phase text, then `diffPhases`; `plan show` answers `phases` only when the programme declares one; `POST /api/programmes/:slug/plan/phases/refs` behind the box token, the query identity, the owner check and `plan-closed` | Measured: read on the tree |
| Gate | `server/src/auth/gate.ts` | The route's EXEMPT row, like its plan siblings; the lane counts (eighty-four and eighty-seven) and the route count (257), as measured after fix round 2's second merge | Measured: read on the tree |
| Client | `ccd/ccrc-api` | `plan phase-ref <slug> --json <f>`, refused locally `capability-missing` when a current cap file omits `plan-phases-v1` | Measured: read on the tree |

`openRun.ts` is untouched (WM1's). `runs open` is unchanged for every plan (measured: the acceptance case below).

### 2.2 The migration slot

Measured: `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` printed 87 at
`421be9977` (the branch's base), so WM0 takes 88. The Linear hierarchy's wave 4 holds a migration of its own (its
`linear_*` tables); on the coordinator's terms whichever of the two lands second takes the next free slot. The slot is
re-measured before the PR and again before merge.

Re-measured after the PR's first CI run: renewal readings A (#2962) landed its backstop setting at 88 first (`origin/main`
`c6d52f92f` printed 88), so WM0 is the second to land and takes 89. The branch absorbed `origin/main` once by
`git merge` (the conflict probe answered 1, clause 16's first trigger), with the migration renumbered in the merge's
resolution: `schema.ts` (88 stays the backstop setting, 89 is `plan_phases` and `plan_phase_refs`), `coord-db.test.ts`
(89, and WM0's case pins its slot at 89), `auth-gate.test.ts` (256 routes, 253 over HTTP, 95 exempt, 157 gated) and
`gate.ts` (253), and the mutation floors and `MUTANT_SETS` keep both sides' rows. Superseded by the next paragraph.

Re-measured in fix round 1: remaining work A (#2951) landed its `programme_remaining` and `programme_edges` at 89
(`origin/main` `7b52b1ce7` printed 89, measured), so WM0 takes 90. The coordinator's fix-round mail licensed the one
merge. Its resolution (measured after it, by the suites in §3.1): `schema.ts` (89 stays remaining work's, 90 is
`plan_phases` and `plan_phase_refs`), `coord-db.test.ts` (90, and WM0's case pins its slot at 90, its comment now saying
why: review 2375 F15), `run-close-switch.test.ts` (drops both sides' tables, names 90, counts thirty-seven), and the
counts with main's remaining-work door added on top: 257 routes, 254 over HTTP, 96 exempt, 157 gated (`auth-gate`),
254 in `gate.ts`'s header, eighty-four box-token lanes and eighty-seven in all (`gate.ts`, `box-token-census`,
README), eighty-six `ccrc-api` rows (`ccd/ccrc-api`, `ccrc-api.test.ts`, `ccrc-api-closed.test.ts`). Re-measure before
merge: it must print 89 before WM0's entry is counted. Superseded by the next paragraph.

Re-measured in fix round 2: account organization D (#2958) landed `prevLane` on `continuity_generations` at 90
(`origin/main` `bd82b7f50` printed 90, measured), so WM0 takes 91. The coordinator's fix-round mail (delivery 23073)
licensed the one merge (`453cf3939`); `git merge-tree` named exactly `schema.ts` and `coord-db.test.ts` as conflicting
(measured). Its resolution (measured after it, by the suites in §4.1): `schema.ts` (90 stays main's `prevLane`, 91 is
`plan_phases` and `plan_phase_refs`, its comment naming #2958), `coord-db.test.ts` (version and `MIGRATIONS.length` 91,
the two comment lists naming `MIGRATIONS[89]` and `[90]`, WM0's SLOT pinned at 91), and `run-close-switch.test.ts` (its
comment names 91 and 90 and counts thirty-eight; no statement changed, since `prevLane` goes with the
`continuity_generations` table the case already drops). No route, lane, exempt, client or cap count moved: main's delta
since `7b52b1ce7` touches none of `auth-gate.test.ts`, `box-token-census.test.ts`, `gate.ts`, `ccd/ccrc-api`, its two
tests, `shared/api.ts` or README (measured with `git diff --name-only 7b52b1ce7 bd82b7f50`), so README needs no edit
and no new consent. Re-measure before merge: it must print 90 before WM0's entry is counted. Superseded by the next
paragraph.

Re-measured after fix round 2's push: designation A (#2950) landed `overlord_designation` at 91, with three
session-gated routes (`origin/main` `b0683770e` printed 91, measured), after `88664cdc5` was pushed and green. On the
coordinator's word (delivery 23234) the branch merged `origin/main` once more (`8ff650d4c`), conflicting in `schema.ts`,
`coord-db.test.ts`, `run-close-switch.test.ts`, `gate.ts` and `auth-gate.test.ts` (measured). Its resolution (measured
after it, by the suites in §4.2): `schema.ts` (91 stays designation A's, 92 is `plan_phases` and `plan_phase_refs`, its
comment naming #2950), `coord-db.test.ts` (version and `MIGRATIONS.length` 92, the comment lists naming `MIGRATIONS[90]`
and `[91]`, WM0's SLOT pinned at 92), `run-close-switch.test.ts` (its comment names 92 and 91 and counts thirty-nine; it
already drops `plan_phases` and main drops `overlord_designation`), and the route counts on both sides: 260 routes, 257
over HTTP, 96 exempt and 160 gated (`auth-gate`), 257 in `gate.ts`'s header. The designation doors carry no box token
(measured: their census block asserts no lane), so the lane counts, README and the client's rows are unchanged, and
README needs no new consent. Re-measure before merge: it must print 91 before WM0's entry is counted.

### 2.3 The rows and what reds each

`server/test/plan-phases.test.ts` holds the plan's Step 1 rows (49 cases at the build: 27 decider cases from
`planPhasesCases.ts`, 20 route cases and the 2 acceptance cases; 57 after fix round 1's eight decider rows, §3; 59
after fix round 2's two, §4). **Run to fail, measured:** the file against `origin/main`'s source (the eight
touched source files checked out from `origin/main` over a committed tree, then restored) gave 48 failed and 1 passed,
the one pass being the characterization, green on `main` by design.

| Row | Reds when | Basis |
|---|---|---|
| plan put stores phases in order with their references | the put's phases are not stored or not answered | Measured red on `main`'s source; the cause named is inferred from the row |
| a phase's number counts only phases not dropped | `phaseNumbers` counts a dropped phase (mutants N-1, N-2) | Measured: the named mutants killed, and red on `main`'s source |
| a put with no phases key leaves the stored phases | an absent `phases` drops or rewrites the stored ones | Measured red on `main`'s source; the cause named is inferred from the row |
| a put adds references and never removes one | a put replaces references (D18) | Measured red on `main`'s source; the cause named is inferred from the row |
| a phase may reference a whole epic and a ticket; one ticket may be referenced by two phases | either kind or a shared ticket is refused | Measured red on `main`'s source; the cause named is inferred from the row |
| a new reference to an unknown or dropped object is refused unknown-ref | the put's unknown-ref check is gone (UR-4 to UR-8) | Measured: the named mutants killed, and red on `main`'s source |
| a reference stored before its ticket dropped is kept | a held reference is re-judged (K-1) | Measured: the named mutants killed, and red on `main`'s source |
| dropping a phase needs a reason and leaves its tickets alone | the droppedWhy requirement is gone (DW-1, DW-2) | Measured: the named mutants killed, and red on `main`'s source |
| more than 24 phases; a repeated key; an unknown reference kind | the parser's bounds | Measured red on `main`'s source; the cause named is inferred from the row |
| a put that orders a carry's target before its source is refused bad-carry | F12's reorder rule is gone (F12-3, F12-3b) | Measured: the named mutants killed, and red on `main`'s source |
| phase-ref adds and removes one reference | the verb's write | Measured red on `main`'s source; the cause named is inferred from the row |
| phase-ref carries a ticket and records the time; a carry out of a whole-epic reference is stored on a ticket reference | the carry's two halves | Measured red on `main`'s source; the cause named is inferred from the row |
| each bad-carry case is refused, and changes nothing | any bad-carry arm is gone (BC-1 to BC-5d) | Measured: the named mutants killed, and red on `main`'s source |
| removing either end of a recorded carry is refused bad-carry; removing any other reference is allowed | F12's remove rule is gone or too wide (F12-1, F12-1b, F12-2) | Measured: the named mutants killed, and red on `main`'s source |
| add and remove refuse an unknown or dropped phase, and an unknown object | the verb's unknown-ref checks (UR-1 to UR-3) | Measured: the named mutants killed, and red on `main`'s source |
| phase-ref refuses a caller that is not the coordinator; a body naming byId is refused; plan-closed after the plan ends | the owner check, the closed body, the end check | Measured red on `main`'s source; the cause named is inferred from the row |
| the stored plans read the same as before | a plan with no phases reads differently from `main` | Measured: green on `main`'s source and on the tip |
| runs open is unchanged for every plan | a phased plan changes what `runs open` admits or attaches | Measured red on `main`'s source; the cause named is inferred from the row |
| `ccrc-api.test.ts`: the phase-ref row is refused locally without plan-phases-v1 | the client gate is gone (measured: the gate replaced by `if false` reds the row; restored from a saved copy) | Measured: the gate mutant |
| a put naming a dropped phase with a new title and a new reference changes nothing (fix round 1, F5) | the revive guard is gone (F5-1) | Measured: the mutant killed |
| unknown-ref, not a store failure: a ticket the put adds to an epic the same put drops (F6) | a new ticket counts in a dropped epic (F6-1) | Measured: the mutant killed |
| a phase of a put takes 200 references, and 201 is plan-too-large (F7) | the bound is gone or off by one (F7-1, F7-1b) | Measured: the mutants killed |
| bad-carry: a whole-epic reference holds only that epic's tickets (F8) | any epic reference counts as holding the ticket (F8-1) | Measured: the mutant killed, now by the floor's own case |
| unknown-ref: a new reference to an unknown or dropped object on a dropped phase (F9 ruling) | the dropped phase's references go unjudged (F9-2) | Measured: red on the code before fix round 1, and the mutant killed |
| unknown-ref: a new reference to an unknown or dropped object on a phase the same put drops (F9 ruling) | the dropping phase's references go unjudged (F9-1) | Measured: red on the code before fix round 1, and the mutant killed |
| F12: a carry from a dropped source stands, so its target end still cannot be removed (F10 ruling) | the target check skips a dropped source (F10-1) | Measured: the mutant killed |
| a stored reference to an object dropped since may be removed (F14) | a remove of a dropped object is refused (F14-1) | Measured: the mutant killed |
| a dropped phase restated, and one dropped, while holding references to objects dropped since: ok, nothing stored (fix round 2, L1-F1) | a held reference is judged again on a dropped or dropping phase (L1-F1, L1-F1b) | Measured: both mutants survived without the row and are killed with it |
| a phase the put drops while naming a live new reference: dropped, and the reference is not stored (fix round 2, L2-F1) | a dropping phase stores the put's valid new references (L2-F1) | Measured: the mutant survived without the row and is killed with it |

**The acceptance (measured).** `fixtures/plan-phases/characterization.json` was produced by
`helpers/planPhasesFixture.ts`, which uses only routes that exist before WM0, run against `origin/main`'s source: two
plans shaped like the two live ones (six epics, one wave each, 26 tickets, a done run, a started run, an auto ticket, a
dropped ticket; and one epic with a failed run). On WM0's code the same builder reads byte-for-byte the same JSON, and a
plan that declares phases opens a run with a named ticket and one with none exactly as before.

### 2.4 The mutants

`server/test/sim/planPhasesSets.ts` registers three deciders in `MUTANT_SETS`, each run against every case of
`planPhasesCases.ts`; `mutation-floors.json` holds a floor of 1 for each (measured: 27 of 27 killed at the build; 36 of 36 after fix round 1;
39 of 39 after fix round 2, re-measured, so each floor stays at 1). Measured: two mutants
survived the first run, BC-1 and BC-2: a dropped phase has no number, so the "not later" check refused the same carry
with the same word. The cases now pin the detail ("phase pd was dropped"), which is what tells the coordinator the cause.

| Decider | Mutant | What it removes | Killed by | Basis |
|---|---|---|---|---|
| `phaseNumbers` | N-1 | the dropped test | a phase's number counts only the phases not dropped | Measured: the floors run |
| `phaseNumbers` | N-2 | the 1-base | the same | Measured: the floors run |
| `diffPhases` | DW-1 | **the droppedWhy requirement** | dropped-needs-reason: a stored phase left out of the put | Measured: the floors run |
| `diffPhases` | DW-2 | a new phase's droppedWhy refusal | a phase dropped with a reason is dropped; a new one cannot carry droppedWhy | Measured: the floors run |
| `diffPhases` | UR-4 | **the put's unknown-ref check** | unknown-ref: a put's new reference to a dropped or unknown object | Measured: the floors run |
| `diffPhases` | UR-5, UR-6 | an epic dropped by the put; a stored dropped epic named again | the same | Measured: the floors run |
| `diffPhases` | UR-7, UR-8 | an open ticket of an epic the put drops; a dropped ticket | the same | Measured: the floors run |
| `diffPhases` | K-1 | the skip of a reference the phase holds | a reference stored before its object dropped is kept | Measured: the floors run |
| `diffPhases` | F12-3, F12-3b | **F12's reorder refusal** (removed; narrowed) | F12: a put that orders a carry's target at or before its source | Measured: the floors run |
| `phaseRefVerdict` | BC-1 | **bad-carry: the from phase dropped** | bad-carry: the from phase is dropped, and the detail says so | Measured: the floors run |
| `phaseRefVerdict` | BC-2 | **bad-carry: the to phase dropped** | bad-carry: the to phase is dropped, and the detail says so | Measured: the floors run |
| `phaseRefVerdict` | BC-3, BC-3b | **bad-carry: not later** (removed; `>=`) | bad-carry: the to phase is not later (earlier, or the same phase) | Measured: the floors run |
| `phaseRefVerdict` | BC-4 | **bad-carry: the ticket done** | bad-carry: the ticket is done | Measured: the floors run |
| `phaseRefVerdict` | BC-5 | **bad-carry: not the from phase's work** | bad-carry: the ticket is not the from phase's work | Measured: the floors run |
| `phaseRefVerdict` | BC-5b, BC-5c, BC-5d | its three parts: carried out, dropped, a void carry | already carried out; a dropped ticket held through its epic; a carry to a dropped phase is void | Measured: the floors run |
| `phaseRefVerdict` | UR-1, UR-2, UR-3 | **the verb's unknown-ref checks**: a dropped object, a dropped phase, a reference not held | unknown-ref: a new reference to a dropped or unknown object; on a dropped or unknown phase; remove deletes … | Measured: the floors run |
| `phaseRefVerdict` | F12-1, F12-1b | **F12's remove refusal, the source end** (removed; widened to a void carry) | F12: removing the source end …; F12: every other remove is allowed | Measured: the floors run |
| `phaseRefVerdict` | F12-2 | **F12's remove refusal, the target end** | F12: removing the target end of a recorded carry is bad-carry | Measured: the floors run |
| `diffPhases` | F5-1 | the revive guard (fix round 1) | a put naming a dropped phase with a new title and a new reference changes nothing | Measured: the floors run |
| `diffPhases` | F6-1 | a new ticket referable only in a live epic | unknown-ref, not a store failure: a ticket the put adds to an epic the same put drops | Measured: the floors run |
| `diffPhases` | F7-1, F7-1b | the put's bound of 200 references a phase (removed; `>=`), in the put's parse, carried in this set | a phase of a put takes 200 references, and 201 is plan-too-large | Measured: the floors run |
| `diffPhases` | F9-1, F9-2 | the new-reference check on a phase the put drops, and on a dropped phase | the two F9 rows | Measured: the floors run |
| `phaseRefVerdict` | F8-1 | a whole-epic reference holds only its own epic's tickets | bad-carry: a whole-epic reference holds only that epic's tickets | Measured: the floors run |
| `phaseRefVerdict` | F10-1 | a carry from a dropped source still pins its target | F12: a carry from a dropped source stands | Measured: the floors run |
| `phaseRefVerdict` | F14-1 | removing a stored reference to a dropped object | a stored reference to an object dropped since may be removed | Measured: the floors run |
| `diffPhases` | L1-F1, L1-F1b | the skip of a held reference on a phase the put drops or names dropped, and on a dropped phase restated without `droppedWhy` (fix round 2) | a dropped phase restated, and one dropped, while holding references to objects dropped since | Measured: the floors run, and red-first (all three of round 2's survived on round 1's rows) |
| `diffPhases` | L2-F1 | a dropping phase's valid new references go unstored (fix round 2) | a phase the put drops while naming a live new reference | Measured: the floors run, and red-first |

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
- Fix round 1: claim 4717 had ended, and `README.md` is now held by claim 4757 (landing order 5i). The merge's README
  change against `origin/main` `7b52b1ce7` is again exactly two lines (measured with `git diff`): eighty-six to
  eighty-seven machine lanes, and `phases/refs` in the plan verbs' route list. The exact lines went to its holder
  (mail 22907); the answer is recorded in §3.
- Fix round 1 also: done tests A (run 2327) asked to co-edit `mutation-floors.json` and `.test.ts` under claim 4742
  for its own rows only; this task said yes (mail 22885). Later, the same yes, additive only and both sides kept on a
  conflict, went to forecasts A (mail 22980), lane C (mail 22993) and decision model B (mail 23003, which also covers
  its doors in `box-token-census.test.ts` and `gate.ts`'s route numeral, re-counted on both sides by whichever lands
  second). Measured: the mails.
- Fix round 2: claim 4797 (this note's new path). The hierarchy's wave 4 now holds claims 4783, 4787 and 4791, each
  chained from the granted 4728, 4732 and 4737 (measured: `chainedFrom` on the claims list), so the grant stands for
  `schema.ts`, `coord-db.test.ts` and `run-close-switch.test.ts`. Its holder was mailed every line fix rounds 1 and 2
  changed in `planPolicy.ts` and `shared/plan.ts`, with the re-slot's three files, in one mail (mail 23079, review 2382
  L3-F9; measured: the send answered ok). `decision-model-records.test.ts` (claim 4765, done tests A) needed no change.
  Claims 4741 and 4742 reached their hard cap during the round and were re-taken whole as 4814 and 4815, chained from
  them (measured: the take answered `lapsedSince`). The same additive yes went to quiz record PR 2 (mail 23114),
  designation C (mail 23178), gates A (mail 23191) and the ladder (mail 23192). Measured: the mails.

### 2.6 The first CI run: red on two hidden migration pins

Superseded in its numbers (review 2382 L3-F2): this section records the PR's first run, at migration 89. At the tip
`run-close-switch.test.ts` names 92 and counts thirty-nine (§2.2). Measured: the CI run's two red shards and the
files below, at the time.

The PR's first run at `b2e0ce6a3` was red in two server shards, each on a test that walks the coord schema back past
the newest migration and so had to undo WM0's migration as well:

- `decision-model-records.test.ts` (the migration case) pinned the decision-model migration at
  `COORD_SCHEMA_VERSION - 2` and undid only 87. Renewal readings A (#2962) rewrote that case on `main` to derive every
  later migration's undo from its text, so after the merge it undoes WM0's two tables on its own and WM0 changes
  nothing in it (the consent asked of its holder, mail 22760, became moot; claim 4760 was taken and is released
  unused).
- `run-close-switch.test.ts` (migration 54's case) undid every migration down to 53 except WM0's, so the reopen failed
  on `table plan_phases already exists`. It now drops the two phase tables first, its comment names 89, and the count
  of replayed migrations reads thirty-six (54 to 89; `main` had left it at thirty-four after its own 88). It sits under
  wave 4's claim 4737, co-edited on the grant above; the lines went to its holder (mail 22761).

The wave-done's suite line reads red, as clause 15 has it; the kind is shallow (tests missed).

## 3. Fix round 1 (review 2375 of `a4952bbe1`)

The coordinator's rulings on review 2375 (fix-round mail delivery 22908), each answered:

| Finding | What changed | Basis |
|---|---|---|
| F1 (a) | One merge of `origin/main` (`7b52b1ce7`), migration 90, every count re-counted on both sides (§2.2) | Measured: the slot printed 89; the suites in §3.1 |
| F2 | The `{ runId }` rule: the run's own ticket is the ticket itself, an auto ticket or none; the run's own auto ticket's evidence never refuses the declared ticket's (spec §4.1 and its test line; plan WM1's rule, test names and fold sentence; WM5 Step 2) | Measured: the amended text |
| F3 | Plan line 52: `plan ticket-done` is a new transition beside the hierarchy's; "Carried to other plans" names the hierarchy's Task 4.3 as the builder of the reason-close | Measured: the amended text |
| F4 | "rows 7 and 8" in plan WM2 and spec §10 | Measured: the amended text |
| F5 to F8 | Four decider rows, each with its mutant in its set (§2.3, §2.4); F7's bound sits in the put's parse and its two mutants ride the put's set (`diffPhases`) | Measured: each mutant killed; floors re-measured at 1 |
| F9 (ruled) | `diffPhases` judges a new reference on a dropped phase and on a phase the same put drops before ignoring the rest; spec D18 and plan WM0 say both; a row for each | Measured: the two rows red on the code before, green after |
| F10 (ruled) | The carry stands (the code already held it); spec §3 and §7 sentences; WM2's `carriedFrom` entry is `{ key; number: number \| null }`; one row pins the target refusal | Measured: the row and its mutant |
| F11 | "only `linear-text-public` and `item-act-mismatch`" in the spec, Table 2's note, the plan's WM0 bullet and `PLAN_REFUSALS`' comment | Measured: a script matched `PLAN_REFUSALS` against `refusalWords.ts` and found both |
| F12 | The coordinator's; the C37 section is untouched beyond F27's one sentence | Measured: `git diff` of the desktop-polish plan is one line |
| F13 | (i) this note's slot and counts as measured after the merge, and a Basis column on every table; (ii) the null-number item dropped from D-8715's departures; (iii) Review Focus names every terminal outcome; (iv) WM3's tests gain the ended-plan done-unverified row; (v) "F1 to F9 and F12 to F25" in the spec and plan; (vi) history left | Measured: the amended text |
| F14 | A row pins that a stored reference to a dropped object may be removed; spec §7 and plan WM0 say so | Measured: the row and its mutant |
| F15 | WM0's coord-db case keeps its measured pin, and its comment says why | Measured: the amended comment |

README's two lines (eighty-six to eighty-seven machine lanes; `phases/refs` in the plan verbs' route list) carry claim
4757's holder's yes to each line separately, at `7b52b1ce7fa3bfc18b6eeae25f5c1fd28e6bfca8` only, relayed (mail delivery
22928, after the exact scope in mail 22916). Measured: `git diff` against that commit shows those two lines and nothing
else in README.

### 3.1 The suites fix round 1 ran

One at a time through `ccrc test`, `--maxWorkers=2`, at `d8c76c720`'s tree, each measured, with the load recorded at its
start (3.9 to 6.2 over the first eight):

| Suite | Result |
|---|---|
| `plan-phases`, `plan-store`, `plan-routes`, `plan-policy`, `plan-vocabulary` | 57, 30, 34, 23 and 8 passed |
| `coord-db`, `box-token-census`, `auth-gate`, `ccrc-api`, `ccrc-api-closed` | 149, 59, 341, 278 and 52 passed |
| `single-definition/plan`, `decision-model-records`, `run-close-switch` | 3, 13 and 21 passed |
| `single-definition` (whole directory), `rings` (whole directory) | 1494 and 132 passed |
| the server test typecheck (`tsc --noEmit -p test/tsconfig.tests.json`) | exit 0 |
| `deviation-refs` (after `git fetch origin main`), `dtbd`, `topology-clean` | 34, 1 and 61 passed |
| `sim/mutation-floors.test.ts` (whole file) | 165 of 167: the two `pwa/src/face/mood.ts` rows fail with "Cannot find package '@ccrc/ui'" (no `ui`/`pwa` dependencies installed in this worktree, an environment red; review 2382's lens 2 measured 167 of 167 with them installed) |

CI's required checks were green on `d8c76c720` (run 44098207252, measured).

## 4. Fix round 2 (review 2382 of `d8c76c720`)

The coordinator's rulings on review 2382 (fix-round mail delivery 23073), each answered:

| Finding | What changed | Basis |
|---|---|---|
| R2-F1 (a) | One merge of `origin/main` (`bd82b7f50`), migration 91, every count re-counted (§2.2); then, on the coordinator's word after main took 91, a second (`b0683770e`), migration 92, every count re-counted again | Measured: the slot printed 90, then 91; the suites in §4.1 and §4.2 |
| Note move | This note moved from `plans/2026-11-16-programme-work-map/` to `programs/desktop-polish/`; the plan's D-8715 entry names the new path; the spec never named it | Measured: `git grep` finds no reference to the old path |
| L3-F1 (ruled) | An ended plan shows no outstanding work, decided by `workMapOf`: spec Table 6 (row 4 limited to a plan not ended, row 5 covering a ticket marked done whose evidence does not verify, the caption saying row 5 is read before row 4 for an ended plan), Table 6a (its left-open row and the F9 caption), §5.1's ended state, §10's decider line; plan Review Focus, WM2's status and phase rules, a new WM2 decider test (`an ended plan's done-unverified ticket reads left-open …`), WM3's test made a wording test of the status WM2 sends | Measured: the amended text |
| L1-F1, L2-F1 | Two decider rows (a dropped phase restated, and one dropped, holding references to objects dropped since; a phase dropped while naming a live new reference) and three mutants in `DIFF_PHASES_SET` (L1-F1, L1-F1b, L2-F1) | Measured: red-first (each survived on round 1's rows), killed with the new rows; floors at 1 |
| L1-F2, L3-F7 | Spec D18: "its valid new references" ignored on a dropped or dropping phase, and a held reference never judged again there; §10's sequence lists the F9, F10 and F14 proofs and round 2's rows; Table 6a's "closes it with a reason"; the plan's WM0 bullet matches | Measured: the amended text |
| L3-F4 | F2's one wording ("another ticket of the programme, except on the run's own auto ticket") in spec §10 and the plan's WM1 test name | Measured: the amended text |
| L3-F6 | D-8715's entry names F9's code change, F2's correction and fix round 2; both "Where things stand" record the rulings on reviews 2375 and 2382; the spec's status line names both fix rounds | Measured: the amended text |
| L3-F8 | WM3's `carriedWords` words a carry from a phase dropped since ("from phase <key>, dropped", for a null `number`) | Measured: the amended text |
| L3-F2, F3, F5 | §2.6 marked superseded; a basis on every claim of §1, §2.4, §2.5 and §3; §3.1 lists fix round 1's suites with their results | Measured: this note |
| L3-F9 (ruled) | One mail to the hierarchy's holder with every line fix rounds 1 and 2 changed in `planPolicy.ts` and `shared/plan.ts` (round 2 changed none) and the re-slot's three files (§2.5) | Measured: mail 23079 |
| L2-F2 | Left as ruled, and named below | — |

### 4.1 The suites fix round 2 ran

One at a time from `server/`, each as `~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <files>`
(the typecheck as `~/.local/bin/ccrc test -- ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`), at
`b29602448`'s tree (no suite reads this note), each measured, with the load recorded at its start (7.4 to 13.0):

| Suite (files) | Result |
|---|---|
| `test/plan-phases.test.ts`, `test/plan-store.test.ts`, `test/plan-routes.test.ts`, `test/plan-policy.test.ts`, `test/plan-vocabulary.test.ts` | 59, 30, 34, 23 and 8 passed |
| `test/coord-db.test.ts` | 147 of 149 at load 12.4: two delegation-table cases timed out (20 s and 120 s), a load timeout; rerun alone once, as ruled: 149 passed (load 9.2) |
| `test/box-token-census.test.ts`, `test/auth-gate.test.ts`, `test/ccrc-api.test.ts`, `test/ccrc-api-closed.test.ts` | 59, 341, 278 and 52 passed |
| `test/single-definition/plan.test.ts`, `test/decision-model-records.test.ts`, `test/run-close-switch.test.ts` | 3, 13 and 21 passed |
| `test/sim/mutation-floors.test.ts` (whole file) | 165 of 167: the same two `pwa/src/face/mood.ts` environment reds as round 1 ("Cannot find package '@ccrc/ui'"); the three planPolicy floors pass, 39 of 39 mutants killed |
| `test/single-definition` (whole directory), `test/rings` (whole directory) | 1494 and 133 passed |
| the server test typecheck (the `tsc` command above) | exit 0; the slice did not kill it |
| `test/deviation-refs.test.ts` (after `git fetch origin main`: main at `bd82b7f50`, its slot count still 90), `test/dtbd.test.ts`, `test/topology-clean.test.ts` | 34, 1 and 61 passed |

### 4.2 The suites after the second merge

The same commands as §4.1, one at a time, at `8ff650d4c`'s tree (the merge; no suite reads this note), each measured,
with the load recorded at its start (6.9 to 20.2). Under that load four files had timeouts; each was rerun alone once,
as ruled, and passed:

| Suite (files) | Result |
|---|---|
| `test/plan-phases.test.ts`, `test/plan-store.test.ts`, `test/plan-routes.test.ts`, `test/plan-policy.test.ts`, `test/plan-vocabulary.test.ts` | 59, 30, 34, 23 and 8 passed |
| `test/coord-db.test.ts` | 144 of 149 at load 11.6, five cases timed out (20 s, and 120 s for the delegation migration case); rerun alone: 149 passed (load 13.5) |
| `test/box-token-census.test.ts`, `test/auth-gate.test.ts` | 60 and 344 passed (both with designation A's rows) |
| `test/ccrc-api.test.ts` | 270 of 278 at load 13.5: one case timed out at 20 s and the seven after it saw its leftover requests in their capture; rerun alone: 278 passed (load 12.6) |
| `test/ccrc-api-closed.test.ts`, `test/single-definition/plan.test.ts` | 52 and 3 passed |
| `test/decision-model-records.test.ts` | 11 of 13 at load 10.7, a setup hook timed out at 20 s; rerun alone: 13 passed (load 12.6) |
| `test/run-close-switch.test.ts` | 21 passed (the walk-back from 92) |
| `test/sim/mutation-floors.test.ts` (whole file) | 173 of 175: the same two `pwa/src/face/mood.ts` environment reds ("Cannot find package '@ccrc/ui'"); the three planPolicy floors pass |
| `test/single-definition` (whole directory), `test/rings` (whole directory) | 1494 and 133 passed |
| the server test typecheck (the `tsc` command of §4.1) | exit 0; the slice did not kill it |
| `test/deviation-refs.test.ts` (after `git fetch origin`: main at `b0683770e`, its slot count 91) | 33 of 34 at load 15.6, one case timed out at 20 s; rerun alone: 34 passed (load 10.3) |
| `test/dtbd.test.ts`, `test/topology-clean.test.ts` | 1 and 61 passed |

## 5. Open

- **The `#diffPhases` floor key names more than its function (review 2382 L2-F2).** F7-1 and F7-1b mutate
  `parsePlanPut`'s bound and ride `DIFF_PHASES_SET` under that key; the coordinator ruled to leave the key as it is,
  disclosed here and in `planPhasesSets.ts`' header.
- **The slot is re-measured before merge.** WM0's entry is 92 only while `origin/main` prints 91; whichever of two
  branches holding one slot merges second takes the next.
