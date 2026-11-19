# Task WM6: the task note (desktop polish run 2780, D-8780)

The note for the programme work map's Task WM6 (an epic may run without a wave range), written by its worker for the
coordinator to fold into the ledger. Each claim says whether it was **measured** (read on the tree, or a test run by this
task) or **inferred**.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| `PlanEpicBody.waves` is optional on the wire; its doc comment names the one reader | `shared/plan.ts` (the one line, with WM2's consent, §5) | Measured: both server compile checks (§4) |
| `listedWaves`, the one reader of an epic's waves (an absent list and an empty one both list none), and `listsWaves` | `server/src/coord/planPolicy.ts` | Measured: `plan-epic-waves.test.ts` reader case; mutant M2c |
| `parsePlanPut` accepts an absent `waves`, and still refuses one that is not a list of wave numbers | `planPolicy.ts` | Measured: `an epic with no waves is accepted`; `waves that are not a list…`; mutant M1 |
| `diffPlan` checks `waves-not-contiguous` and `wave-overlap` among the epics that list waves, stores `[]` for one that lists none | `planPolicy.ts` | Measured: `two epics with no waves run side by side`, `an epic that lists waves keeps …` |
| `epicOfRun`, the one decider of the epic a run opens into; `planGate` calls it and reads a named ticket before the epic | `planPolicy.ts`, `server/src/coord/openRun.ts` | Measured: `plan-policy.test.ts` (the `epicOfRun` cases), `open-run-preconditions.test.ts` (three refusal rows and one admit row), the route cases; mutants M3 to M6 |

Nothing else moved: `planRunFacts.ts` already hands `planGate` an epic's waves as `[]` when it has none, and
`attachTicketInTx` never compared the wave, so neither needed a change (**measured**: `plan-run-attach.test.ts` green).

## 2. Acceptance: every stored plan opens runs exactly as before

The last describe of `plan-epic-waves.test.ts` (`every plan whose epics all list waves opens runs exactly as before`) is a
plan of two epics that both list waves, driven through the real server. **Measured before the change:** with the
tests in place and `planPolicy.ts` and `openRun.ts` as `main` has them, the five cases of that describe passed
(`Tests 9 failed | 5 passed (14)`, the nine failures being the new behaviour and the reader's own case; the first
run's wrong expectations in the file, a `wave-overlap` status of 409 and an auto ticket I had miscounted, were corrected
in the test, not in the code). **Measured after:** the same five cases pass (`14 passed`). The refusals in them are
`wave-epic-mismatch` for a wave no epic lists (with a ticket, with none, and with a ticket that does not exist),
`wave-epic-mismatch` for a ticket of another epic than the wave's, `waves-not-contiguous` and `wave-overlap`.

## 3. Departures (D-8780's slugs, in the plan's ledger)

- `wm6-one-reader-and-one-chooser`: `listedWaves` is the one reader, and `epicOfRun` the one chooser of the epic a run opens
  into. Measured.
- `wm6-ticket-read-before-the-epic`: `planGate` reads `p.ticket(key)` before it chooses the epic. A ticket that does not
  exist names no epic, so the order of refusals for it is as before: `wave-epic-mismatch` at a wave no epic lists,
  `ticket-unavailable` at one an epic lists. Measured (`plan-epic-waves`, the held-or-missing case).
- `wm6-live-epics-only`: "any epic lists no waves" counts the live epics. A dropped epic cannot take a run, so naming a
  ticket is no remedy for it. Measured (`a dropped epic of no waves …`; mutant M5).
- `wm6-absent-waves-clears`: a put that omits `waves` on a stored epic that lists some stores none. **Inferred** from how
  the put reads `project` (an absent `project` becomes the home) and from the put being the programme's whole desired
  state; no spec sentence says it. Measured: `a put that omits the waves of a stored epic leaves it with no waves`.
- `wm6-contiguity-needs-no-condition`: see §4, M2a and M2b.

## 4. The runs and the mutants

Every run went through `ccrc test`, from `server/`, `--maxWorkers=2`, one at a time. The box's load average was 13 to 20
throughout (**measured**, `uptime` before each run).

| Run | Result |
|---|---|
| `plan-epic-waves` | red first: `9 failed \| 5 passed (14)`; then `14 passed` |
| `plan-policy` | 47 passed |
| `open-run-preconditions` | 129 passed (after correcting the new admit row's expectation: the ticket sits under `open`) |
| `plan-run-attach` | 18 passed |
| `plan-ticket-required` | 15 passed |
| `plan-phases` | 59 passed |
| `plan-store` | 57 passed (it outran the foreground's ten minutes under load, and was finished in the background) |
| `plan-routes` | 34 passed |

**Mutants.** `mutate.py` (a scratch script, not committed) applied each to a saved copy's source in turn, ran
`plan-epic-waves`, `plan-policy` and `open-run-preconditions` together (190 tests), and restored the file from the saved
copy after each (`cmp` against the saved copies after the last one: identical). Never `git checkout`.

| # | Mutant | Verdict (**measured**) | Cases that went red |
|---|---|---|---|
| M1 | `waves` required again (the validation without its `undefined` arm) | red, 9 failed | `an epic with no waves is accepted`, `two epics with no waves run side by side`, `a put that omits the waves …`, the run cases, `an epic that omits waves parses …` |
| M2a | `waves-not-contiguous` without the lists-waves condition | **green: an equivalent mutant** | none can: `contiguous([])` is true |
| M2b | `wave-overlap` without the lists-waves condition | **green: an equivalent mutant** | none can: an empty list owns no wave |
| M2c | the reader without its default (`e.waves!`, an absent list read as a list) | red, 12 failed | the reader's own case, `an epic with no waves is accepted`, `two epics …`, the put and contiguity cases |
| M3 | `planGate` takes the ticket's epic without the lists-waves condition | red, 4 failed | `epicOfRun`'s named-ticket case, the preconditions row for a ticket of an epic that lists waves, and the two `keeps wave-epic-mismatch` route cases |
| M4 | a run with no ticket goes to `wave-epic-mismatch` | red, 3 failed | `epicOfRun`'s no-ticket case, the preconditions row, the route case `… is refused ticket-required, not wave-epic-mismatch` |
| M5 | a dropped epic of no waves counts toward `ticket-required` | red, 2 failed | `epicOfRun`'s no-ticket case, the route case `a dropped epic of no waves …` |
| M6 | `planGate` ignores the named ticket's epic (the old choice) | red, 7 failed | the preconditions admit row and two refusal rows, `two epics with no waves …`, `a run naming a ticket of an epic with no waves opens …` |

**M2a and M2b cannot go red, and I say so rather than claim a case.** The brief asks for a red case for "dropping the lists
waves condition from each check", but an epic that lists none has an empty list, which is contiguous and overlaps
nothing, so the two checks give the same answer with or without the condition. The condition is kept in the code because
the plan words the rule that way; what actually guards "an epic with no waves passes both checks" is the reader
(`listedWaves`), and M2c, which breaks it, reds 12 cases. D-8780 names this as `wm6-contiguity-needs-no-condition`.

**The rest of the runs**, all measured, `--maxWorkers=2`, one at a time, load average 11 to 15:

| Run | Result |
|---|---|
| `test/single-definition` (41 files) | first run: 1 failed, 1529 passed: `advance-switches.test.ts`'s `the pin scan parses only the test files that spell a W1a basename` **timed out at 20000 ms under load** (a file this change does not touch). Rerun alone once: 53 passed |
| `test/rings` (12 files) | 133 passed |
| `test/coord-policy-rings.test.ts` | 20 passed |
| `test/sim/mutation-floors.test.ts` | **not run**: `planPolicy.ts`'s sets did not change (no word, state or list was added to or removed from one), so the brief's condition did not arise |
| server compile check (`tsc --noEmit -p tsconfig.json`) | clean (after one fix: `listedWaves` first returned a `readonly` array and `diffPlan`'s insert wants a mutable one; it now returns a copy) |
| server test-project compile check (`tsc --noEmit -p test/tsconfig.tests.json`) | **UNMEASURED locally.** Four runs, each alone and each killed by the test slice's memory cap (`MemoryMax=6G`, exit 137; the last with a bounded heap, `--max-old-space-size=3500`, and one other job in the slice). `typecheck-tests.test.ts` (the same compile inside the suite) was killed the same way at its first run. The compile of `src` passes and every test file ran under vitest, which does not typecheck, so a type error in the new tests is not excluded; CI's `typecheck-tests` guard on this pull request is the arbiter |
| `deviation-refs` (after `git fetch origin main`) | 34 passed |
| `dtbd` | 1 passed |
| `topology-clean` | 61 passed |
| `ledger-guard.mjs --base origin/main` | exit 0: passed by the `Ledger-Edit` trailer on the head, layout ok. `ci-ledger-guard.test.ts`: 32 passed |
| `git merge-tree` against `origin/HEAD` | exit 0: clean (main moved by one commit, the mail times change of #3065, which this branch does not touch), so no absorption (clause 16) |

## 5. Co-edit consent

WM2's claim (5592) held `shared/plan.ts` and the work-map plan. WM2's worker (run 2779, session `ccrc-pwa-polish-wm2`)
consented by mail (delivery 26353, answering my question 26345) to exactly: `shared/plan.ts`'s `PlanEpicBody` `waves` line and
its doc comment, and the plan's Task WM6 section with a new D-8780 bullet at the end of Deviations found. It warned that
its own D-8779 bullet goes right after the D-8727 bullet, so whoever lands second keeps both (D-8779 then D-8780).

## 6. Sentences of the Linear hierarchy's documents that read false or short after WM6

This task edits none of them: they are that programme's documents, and the coordinator carries them to its coordinator.
Line numbers are at `a9a529388` (**measured**, read on the tree).

| File and line | Sentence | After WM6 |
|---|---|---|
| `docs/superpowers/plans/2026-11-10-linear-hierarchy.md:1128-1129` | "`wave-epic-mismatch` (no live epic lists the wave, or the named ticket's epic is not the wave's)" (Task 2's refusal list for `runs open`) | **False for an epic that lists no waves**: a named ticket's epic that lists none takes the run at any wave, and a run with no ticket at an unlisted wave in a plan with such an epic is refused `ticket-required` (WM1's word, WM6's case), not `wave-epic-mismatch`. The sentence needs "an epic that lists waves" and the second refusal. |
| `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md:145-149` (§4.1, "Wave stays a programme-wide number") | "the plan declares each epic's waves … A run opened into a wave that no epic lists … is refused (`wave-epic-mismatch`)" | Already carries the amendment of 2026-11-16 in the same bullet (lines 150-153), which is what WM6 builds, so the bullet reads true as amended. Listed because the amendment's last clause says "A run that names no ticket, into a plan where any epic lists no waves, is refused `ticket-required`": WM6 reads that as the live epics, and only for a wave no epic lists (D-8780, `wm6-live-epics-only`). |
| `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md:773` (§16 call 2) | "The plan declares each epic's waves; a run in a wave no epic lists is refused `wave-epic-mismatch`" | Carries the same amendment, so it reads true as amended; the same two refinements apply. |
| `docs/superpowers/plans/2026-11-10-linear-hierarchy.md:1794-1795` (Task 6.1, clause 21) | "each with its waves when it runs in waves" | Already worded for WM6; true as it stands. |
| `ccd/coordinator-skill/references/plan.md:4` (this repository, the coordinator's corpus, not that programme's) | "**epic** is one plan-sized stage and lists the waves that run in it" | Reads short: an epic may list none, and a run into one names its ticket. It is a rules file, so it changes only in a pull request of its own (the review judge's rules-mixed reason), as WM1r did; I did not touch it. |

