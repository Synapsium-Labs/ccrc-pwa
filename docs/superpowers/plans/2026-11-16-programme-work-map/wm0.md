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

Filled in by the build commit.
