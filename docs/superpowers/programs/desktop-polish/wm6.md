# Task WM6: the task note (desktop polish run 2780, D-8780)

The note for the programme work map's Task WM6 (an epic may run without a wave range), written by its worker for the
coordinator to fold into the ledger. Each claim says whether it was **measured** (read on the tree, or a test run by this
task) or **inferred**. It covers the build (§1 to §6) and fix round 1 on review 2791 (§7).

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| `PlanEpicBody.waves` is optional on the wire; its doc comment names the one reader and what an absent field means | `shared/plan.ts` (the one line and its comment, with WM2's consent, §5) | Measured: both server compile checks (§4) |
| `listedWaves(e, stored?)`, the one reader of an epic's waves: an explicit list (`[]` included) is the range, an absent list keeps the stored range, with no stored epic it lists none; and `listsWaves` | `server/src/coord/planPolicy.ts` | Measured: `plan-policy.test.ts`'s reader case; mutants M2c, N3, N4 |
| `parsePlanPut` accepts an absent `waves`, and still refuses one that is not a list of wave numbers | `planPolicy.ts` | Measured: `an epic with no waves is accepted`; `waves that are not a list…`; mutant M1 |
| `diffPlan` checks `waves-not-contiguous` and `wave-overlap` among the epics that list waves, over the range a put leaves each epic with (a kept range included); it stores `[]` for a new epic that lists none and patches `waves` only when the range changes | `planPolicy.ts` | Measured: `two epics with no waves run side by side`, `an epic that lists waves keeps …`, the keeps and clears cases; mutants N3 to N5 |
| `epicForOpen`, the one decider of the epic a run opens into (named so the plan store's `epicOfRun` keeps its one meaning); `planGate` calls it and reads a named ticket before the epic | `planPolicy.ts`, `server/src/coord/openRun.ts` | Measured: `planEpicForOpenCases.ts` through `plan-policy.test.ts`, `open-run-preconditions.test.ts` (four refusal rows and two admit rows), the route cases; mutants M3 to M6, N1, N2, N6, N7 |
| `epicForOpen` in the mutant sets and the floors: its cases written once in `server/test/planEpicForOpenCases.ts`, its thirteen mutants in `server/test/sim/planEpicWavesSets.ts`, one import and one spread line in `mutation-floors.test.ts`, one row (floor 1) in `mutation-floors.json` | `server/test/` | Measured: 13 of 13 killed, score 1 over 14 baseline cases (§7) |

Nothing else moved: `planRunFacts.ts` already hands `planGate` an epic's waves as `[]` when it has none, and
`attachTicketInTx` never compared the wave, so neither needed a change (**measured**: `plan-run-attach.test.ts` green).

## 2. Acceptance: a plan whose live epics all list a non-empty range opens runs exactly as before

The last describe of `plan-epic-waves.test.ts` (`every plan whose epics all list waves opens runs exactly as before`) is a
plan of two epics that both list waves, driven through the real server; it has four cases. **Measured before the change:**
with the tests in place and `planPolicy.ts` and `openRun.ts` as `main` has them, the four cases of that describe passed,
and so did a fifth case elsewhere in the file (`waves that are not a list of wave numbers are still refused plan-bad-body`,
which is **inferred** to be the one: the run printed `Tests 9 failed | 5 passed (14)`, the nine failures being the new
behaviour and the reader's own case; the first run's wrong expectations in the file, a `wave-overlap` status of 409 and an
auto ticket I had miscounted, were corrected in the test, not in the code). **Measured after:** all 14 passed. The
refusals in the four cases are `wave-epic-mismatch` for a wave no epic lists (with a ticket, with none, and with a ticket
that does not exist), `wave-epic-mismatch` for a ticket of another epic than the wave's, `waves-not-contiguous` and
`wave-overlap`, and they open a wave an epic lists with its ticket and with none.

**What this does not show (review 2791 F3).** A stored live epic whose range is `[]` changes at the tip, as the plan
rules: a run with no ticket at an unlisted wave goes from `wave-epic-mismatch` to `ticket-required`, and that epic's
tickets open at any wave. `main` already accepted `waves: []`, and the store reads a NULL or malformed column as `[]`
(`planStore.ts`'s `epicOf`). **The number of stored live epics with an empty or unreadable range is unmeasured**: I did
not read the live store. The plan's Rollback line ("a plain revert, once no stored epic lacks waves") assumes none.

## 3. Departures (D-8780's slugs, in the plan's ledger)

- `wm6-one-reader-and-one-chooser`: `listedWaves` is the one reader of an epic's waves, after `parsePlanPut` has
  validated the raw field (the validator reads `e.waves` of an untyped body directly), and `epicForOpen` the one chooser of
  the epic a run opens into. Renamed from `epicOfRun` on the coordinator's ruling (F8). Measured.
- `wm6-ticket-read-before-the-epic`: `planGate` reads `p.ticket(key)` before it chooses the epic. A ticket that does not
  exist names no epic, so the order of refusals for it is as before: `wave-epic-mismatch` at a wave no epic lists
  (measured: `plan-epic-waves`'s held-or-missing case), `ticket-unavailable` at one an epic lists (that is the preconditions
  row `a ticket that does not exist`, which lists wave 1, as it did before).
- `wm6-live-epics-only`: "any epic lists no waves" counts the live epics, `epicAdmitsRun`: not `dropped`. A dropped epic
  cannot take a run, so naming a ticket is no remedy for it. Measured (`a dropped epic of no waves …`; mutants M5, N2).
  **Inferred, not covered by a spec sentence (review 2791 F12): a settled (`done`) waveless epic counts as live**, as the
  gate and the store's attach re-check already read it, so a run with no ticket at an unlisted wave in a plan whose only
  waveless epic is `done` is refused `ticket-required`, even when naming a ticket is no remedy (a `done` epic's tickets are
  all closed). Pinned at the decider by `a settled (done) epic that lists no waves counts as live …`.
- `wm6-absent-waves-keeps` (renamed from `wm6-absent-waves-clears`, F6): a put that omits `waves` on a stored epic keeps
  its stored range and an explicit `[]` clears it, on the coordinator's ruling, as an absent ticket `body` keeps the stored
  body. A coordinator that re-puts a plan without the field must not silently change how runs open. A new epic that omits
  it lists none, and `wave-overlap` is read against the kept range. Measured: the keeps and clears cases at the decider and
  the route, and mutants N3 to N5. (The first build cleared; that was **inferred** from how `project` is read, and the
  ruling replaced it.)
- `wm6-contiguity-needs-no-condition`: an empty list is trivially contiguous and overlaps nothing, so
  `waves-not-contiguous` and `wave-overlap` read only epics that list waves by skipping the others, and no mutant of that
  condition can go red (§4, M2a and M2b); the guard that can is the reader, which its mutants break (M2c, N3, N4).

## 4. The runs and the mutants of the build

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
| `test/single-definition` (41 files) | first run: 1 failed, 1529 passed: `advance-switches.test.ts`'s `the pin scan parses only the test files that spell a W1a basename` **timed out at 20000 ms under load**. Rerun alone once: 53 passed |
| `test/rings` (12 files), `coord-policy-rings` | 133 passed; 20 passed |
| `test/sim/mutation-floors.test.ts` | **not run in the build**: I read the brief's "if planPolicy's sets change" as the condition for the registration, which review 2791 F1 ruled wrong; it is run in the fix round (§7) |
| server compile check | clean |
| server test-project compile check | **unmeasured locally in the build**: four runs, each killed by the test slice's memory cap (`MemoryMax=6G`, exit 137). Review 2791 measured it clean (3,203 files); the fix round runs it again (§7) |
| `deviation-refs`, `dtbd`, `topology-clean`, the ledger guard | 34, 1 and 61 passed; ledger guard exit 0 |

**Mutants of the build.** A scratch script applied each to a saved copy's source in turn, ran `plan-epic-waves`,
`plan-policy` and `open-run-preconditions` together (190 tests), and restored the file from the saved copy after each
(`cmp` against the saved copy after the last one: identical). Never `git checkout`.

| # | Mutant | Verdict (**measured**) | Cases that went red |
|---|---|---|---|
| M1 | `waves` required again (the validation without its `undefined` arm) | red, 9 failed | `an epic with no waves is accepted`, `two epics with no waves run side by side`, the run cases, `an epic that omits waves parses …` |
| M2a | `waves-not-contiguous` without the lists-waves condition | **green: an equivalent mutant** | none can: `contiguous([])` is true |
| M2b | `wave-overlap` without the lists-waves condition | **green: an equivalent mutant** | none can: an empty list owns no wave |
| M2c | the reader without its default (`e.waves!`, an absent list read as a list) | red, 12 failed | the reader's own case, `an epic with no waves is accepted`, `two epics …`, the put and contiguity cases |
| M3 | the named ticket's epic taken without the lists-waves condition | red, 4 failed | `epicOfRun`'s named-ticket case (now `epicForOpen`'s), the preconditions row for a ticket of an epic that lists waves, and the two `keeps wave-epic-mismatch` route cases |
| M4 | a run with no ticket goes to `wave-epic-mismatch` | red, 3 failed | the decider's no-ticket case, the preconditions row, the route case `… is refused ticket-required, not wave-epic-mismatch` |
| M5 | a dropped epic of no waves counts toward `ticket-required` | red, 2 failed | the decider's no-ticket case, the route case `a dropped epic of no waves …` |
| M6 | `planGate` ignores the named ticket's epic (the old choice) | red, 7 failed | the preconditions admit row and two refusal rows, `two epics with no waves …`, `a run naming a ticket of an epic with no waves opens …` |

**M2a and M2b cannot go red, and I say so rather than claim a case.** The brief asks for a red case for "dropping the lists
waves condition from each check", but an epic that lists none has an empty list, which is contiguous and overlaps
nothing, so the two checks give the same answer with or without the condition. The condition is kept in the code because
the plan words the rule that way; what guards "an epic with no waves passes both checks" is the reader. Review 2791
confirmed the pair equivalent.

## 5. Co-edit consent

- **`shared/plan.ts` and the work-map plan** (claim 5592, held by the WM2 worker, run 2779, session
  `ccrc-pwa-polish-wm2`): consented by mail (delivery 26353, answering my question 26345) to exactly `shared/plan.ts`'s
  `PlanEpicBody` `waves` line and its doc comment, and the plan's Task WM6 section with a new D-8780 bullet at the end of
  Deviations found. It warned that its own D-8779 bullet goes right after the D-8727 bullet, so whoever lands second keeps
  both (D-8779 then D-8780). The fix round's edits to `shared/plan.ts` are that comment only; the plan edits are the
  D-8780 bullet.
- **`server/test/sim/mutation-floors.test.ts` and `.json`** (claim 5529, held by the mid-turn-mail PR 2 worker, session
  `ccrc-pwa-overlord-build-mtm-pr2`): consented by mail (delivery 26514, answering my question 26510) to one import line and
  one spread line in the test, beside the plan sets, and one floor row in the JSON, after the `landedFactOf` row. It named
  its own rows (the urgent-mail set and its floor key) as nowhere near mine, and said whoever lands second keeps both sides.

## 6. Sentences of the Linear hierarchy's documents that read false or short after WM6

This task edits none of them: they are that programme's documents, and the coordinator carries them to its coordinator
(the last row is this repository's rules file, which goes to a rules-only pull request). Line numbers are at `a9a529388`
(**measured**, read on the tree).

| File and line | Sentence | After WM6 |
|---|---|---|
| `docs/superpowers/plans/2026-11-10-linear-hierarchy.md:1128-1129` | "`wave-epic-mismatch` (no live epic lists the wave, or the named ticket's epic is not the wave's)" (Task 2's refusal list for `runs open`) | **False for an epic that lists no waves**: a named ticket's epic that lists none takes the run at any wave, and a run with no ticket at an unlisted wave in a plan with such an epic is refused `ticket-required` (WM1's word, WM6's case), not `wave-epic-mismatch`. The sentence needs "an epic that lists waves" and the second refusal. |
| `docs/superpowers/plans/2026-11-10-linear-hierarchy.md:776` (Task 2.1's wire contract) | "`PlanEpicBody { key; title; summary; project?; waves: number[]; checkpoints: …; tickets?: … }`" | **False**: `waves` is optional on the wire (`shared/plan.ts`). The stored-row type at line 884 stays `number[]` and is not at issue (review 2791 F4). |
| `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md:145-149` (§4.1, "Wave stays a programme-wide number") | "the plan declares each epic's waves … A run opened into a wave that no epic lists … is refused (`wave-epic-mismatch`)" | Reads true as amended, **read with the amendment at lines 151-154 and its next sentence ("Epics that list waves keep every rule above")**. The amendment's last clause, "A run that names no ticket, into a plan where any epic lists no waves, is refused `ticket-required`", read alone is false in two cases WM6 pins: a run at a wave some epic lists opens, and a dropped waveless epic gives `wave-epic-mismatch` (D-8780, `wm6-live-epics-only`). |
| `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md:773-774` (§16 call 2) | "The plan declares each epic's waves; a run in a wave no epic lists is refused `wave-epic-mismatch` … *Amended 2026-11-16:* an epic may list no waves, and a run into one names its ticket" | Reads true as amended, with the same two narrowings (live epics; a wave no epic lists). |
| `docs/superpowers/plans/2026-11-10-linear-hierarchy.md:1794-1795` (Task 6.1, clause 21) | "each with its waves when it runs in waves" | Already worded for WM6; true as it stands. |
| `ccd/coordinator-skill/references/plan.md:4` and `:21-24` (this repository, the coordinator's corpus, not that programme's) | Line 4: "**epic** is one plan-sized stage and lists the waves that run in it". Lines 21-24: `wave-epic-mismatch` ("no live epic lists this wave, or the `ticket` you named belongs to another epic than the one that lists the wave") and `ticket-required` ("the plan has phases, you named no `ticket`, and the epic that lists this wave still has an open ticket…") | **Read short**: an epic may list no waves, a run into one names its ticket, and `ticket-required` is also the word for a run with no ticket at a wave no epic lists in a plan with such an epic (review 2791 F7). It is a rules file, so it changes only in a pull request of its own (the review judge's rules-mixed reason), as WM1r did; I did not touch it. |

## 7. Fix round 1 (review 2791, the coordinator's rulings)

| Finding | What changed | Basis |
|---|---|---|
| F1 | `epicForOpen` joins `MUTANT_SETS` and `mutation-floors.json`. Its 14 cases are written once in `server/test/planEpicForOpenCases.ts` and run by `plan-policy.test.ts` against the real file and by `sim/planEpicWavesSets.ts` against 13 mutants (EO-1 to EO-13), including the F2 reversal (EO-7) and the F5 one (EO-3). The floor is 1 | **Measured**: a throwaway test over the set printed `score 1`, 13 killed of 13, over 14 baseline cases; the row is in `mutation-floors.json` at 1. `listedWaves` and `listsWaves` are one-line readers and are not registered (the review's refuters read them as arguably exempt); `epicForOpen` is the decider |
| F2 | The case `a named ticket of a live epic that lists no waves takes that epic, even at a wave another epic lists`, at the decider, in the preconditions table and at the route | **Measured**: red under N1 (the wave's epic chosen first; 3 cases) and green at the tip |
| F5 | The case `a named ticket of a dropped epic that lists no waves does not take that epic`, at the decider, in the preconditions table and at the route | **Measured**: red under N2 (the named ticket's epic read without its state gate; 3 cases) and green at the tip |
| F6 | An absent `waves` keeps the stored range, an explicit `[]` clears it, a new epic that omits it lists none, and `wave-overlap` is read against the kept range; one case each way at the decider and the route, and `an epic that keeps its range by omission still holds it` | **Measured**: red under N3 (5 cases), N4 (3) and N5 (2), green at the tip. Slug renamed `wm6-absent-waves-keeps`; the reason is in D-8780 |
| F8 | the policy's `epicOfRun` renamed `epicForOpen`; the store's `epicOfRun` keeps its one meaning | **Measured**: `grep` finds `epicOfRun` only in `planStore.ts`, its port and `server.ts` |
| F12 | A route case with an explicit `waves: []` epic (a named ticket opens at any wave; no ticket at an unlisted wave is refused `ticket-required`); the settled waveless epic is a decider case, and §3 records it as inferred | **Measured**: the route case is red under N7 (5 cases) and N6 (10) and green at the tip |
| F3, F9, F10, F11 | §2 narrowed and its stored-plan count labelled unmeasured; the amendment's two narrowings stated in §6; §2's "five cases" corrected to four plus the inferred fifth; the amendment's lines read 151-154; the slugs' wording corrected in D-8780 (the reader's "after validation"; the condition, not the reader, cannot go red); the head commit's `Ledger-Edit` reason now names the plan edit | Records |
| F4, F7 | §6 gains the hierarchy plan's line 776 and the rules file's lines 21-24 | Records |
| F13 | nothing: WM2's D-8779 and this D-8780 at the same place in the deviations list mean whoever lands second keeps both | The coordinator's ruling |

**The fix round's mutants** (a scratch script, one at a time on a saved copy, the three changed test files together, 211
tests; the source restored from the saved copy after each, `cmp` identical after the last):

| # | Mutant | Verdict (**measured**) | Cases that went red |
|---|---|---|---|
| N1 | the wave's epic chosen before the named ticket's (F2) | red, 3 failed | the decider's collision case, the preconditions admit row, the route case |
| N2 | the named ticket's epic read without its state gate (F5) | red, 3 failed | the decider's dropped case, the preconditions refusal row, the route case |
| N3 | an absent list does not keep the stored range (F6) | red, 5 failed | the decider's keeps case, its overlap case, the reader's case, the route's keeps and overlap cases |
| N4 | an explicit empty list does not clear (F6) | red, 3 failed | the decider's clears case, the reader's case, the route's keeps-and-clears case |
| N5 | overlap reads the put's own list, not the kept range (F6) | red, 2 failed | the decider's overlap case and the route's |
| N6 | `planGate` ignores the named ticket's epic | red, 10 failed | the preconditions rows and the route cases of a named ticket of a waveless epic, among them the F2 and F12 ones |
| N7 | a run with no ticket always goes to `wave-epic-mismatch` (F12) | red, 5 failed | the settled-epic case, the no-ticket cases, the preconditions row and the route's explicit-`[]` case |

**The fix round's runs**, all measured, `ccrc test`, from `server/`, `--maxWorkers=2`, one file per process, load average 11
to 15 (`uptime` before each), on the tree before the fix round's commit:

| Run | Result |
|---|---|
| `plan-epic-waves` | 18 passed |
| `plan-policy` | 62 passed |
| `open-run-preconditions` | 131 passed |
| `plan-run-attach` | 18 passed |
| `plan-ticket-required` | 15 passed |
| `plan-routes` | 34 passed |
| `plan-store` | 57 passed |
| `test/sim/mutation-floors.test.ts` (the whole file; no memory-cap kill, so no key filter was needed) | 255 passed: the 254 of before and the new key's own `every mutant is killed, and the score is at least its floor` case, and `the floors and the mutant sets name the same deciders` |
| `test/single-definition` (41 files) | 1530 passed (the load timeout of the build did not recur) |
| `test/rings` (12 files), `coord-policy-rings` | 133 passed; 20 passed |
| server compile check (`tsc --noEmit -p tsconfig.json`) | clean |
| server test-project compile check (`tsc --noEmit -p test/tsconfig.tests.json`) | **killed by the test slice's memory cap again** (exit 137, run alone; it is the whole 3,203-file project). **Narrower measured substitute:** a scratch project of this change's own files, `planPolicy.ts`, `openRun.ts`, `shared/plan.ts`, the three changed test files, `planEpicForOpenCases.ts`, `sim/planEpicWavesSets.ts`, `sim/mutation-floors.test.ts` and `sim/mutate.ts` with their imports, compiled clean (exit 0, no output); I removed the scratch file. Review 2791 measured the whole project clean at the previous tip, and CI's `typecheck-tests` is the arbiter for this one |

Run on the committed fix-round head (`95bb03254`, after `git fetch origin main`), all measured:

| Run | Result |
|---|---|
| `deviation-refs` | 34 passed |
| `dtbd` | 1 passed |
| `topology-clean` | 61 passed |
| `ledger-guard.mjs --base origin/main` | exit 0, passed by the head's `Ledger-Edit` trailer, which now names the plan edit it covers; layout ok. `ci-ledger-guard.test.ts`: 32 passed |
| the private-names scan (the canonical `private-names.mjs` against the operator's local list), tracked tree | exit 0, empty output |
| `git merge-tree` against `origin/HEAD` | exit 0: clean. Main has moved by two commits since the build's head (a mask-slice change and the mail times change), neither touching this branch's files, and I did not merge it |

## 8. The land-sync: one absorb of main (the coordinator's mail 27156)

**Why.** #3071 (WM2) merged at `62276e71b`, and at `301e453b4` this branch conflicted with main in three files. The
coordinator ordered one `git merge` of `origin/main` into `ws/polish-wm6`, keeping both sides, and told me to stop if any
hunk needed more (clause 16's third trigger). **Measured:** `origin/main` was `62276e71b7808a0901676507b070af9e4ce2f7f1`
at the merge and at the last fetch before the push; the merge commit is `be6e0c8fd`.

**The three conflicts, each resolved by keeping both sides and changing no line of either** (measured: the markers are gone,
`mutation-floors.json` parses as JSON with 258 keys, and `git diff --name-only origin/main HEAD` lists only this task's files):
- the work-map plan: WM2's D-8779 entry and its "Task WM2 departs" line, then this task's D-8780 entry (the order WM2 asked
  for and the coordinator's F13 ruling names);
- `server/test/sim/mutation-floors.json`: the `epicForOpen` row after `landedFactOf`, then main's rows (WM2's three
  `workMap.ts` keys and #3076's four `overlordGate.ts` keys); the `actKeyClaimVerdict` row on both sides was one row, kept
  once with the comma it needs now that it is no longer last;
- `server/test/sim/mutation-floors.test.ts`: both sides' import line (mine, then WM2's) and both sides' spread line.

**Claims.** My claims had lapsed (their hard expiry passed while the run waited for a slot), so I re-took the plan and
this note (claim 5756). The floors files were claimed by another worker (claim 5663, approvals PR 3), so that claim was
refused (`claim-conflict`); I resolved the merge conflicts in them under the coordinator's land-sync order and added no
content of my own, so no co-edit consent was asked. The earlier consent for my one import line, spread line and floor row
(§5) stands.

**Runs after the merge**, all measured, `ccrc test`, from `server/`, `--maxWorkers=2`, one file per process, load average
10 to 20:

| Run | Result |
|---|---|
| `test/sim/mutation-floors.test.ts`, the whole file | **killed by the test slice's memory cap** (163 of 267 had passed; exit 1). Rerun filtered to `epicForOpen`, WM2's three `workMap.ts` keys, #3076's four `overlordGate.ts` keys and the case that the floors and the sets name the same deciders: 9 passed, 258 skipped |
| `plan-epic-waves` | 18 passed |
| `plan-policy` | 62 passed |
| `open-run-preconditions` | 131 passed |
| `plan-routes` | 45 passed (main's WM2 cases are in it now) |
| `work-map` | 93 passed |
| `test/single-definition` (43 files) | first run: 2 failed, both **timeouts at 20000 ms under load** (`advance-switches`'s `the pin scan parses only the test files that spell a W1a basename`, and `docs-l0`'s `no python rule table fed to re.compile stands in ccd's shipped programs`), files this change does not touch. Rerun alone: `docs-l0` 142 passed; `advance-switches` timed out a second time at load 19, then passed, 53 of 53, at load 13 |
| `test/rings` (12 files), `coord-policy-rings` | 133 passed; 20 passed |
| server compile check | clean (exit 0) |
| server test-project compile check | clean (exit 0): the whole 3,203-file project, measured this time |
| `deviation-refs` (after a fresh `git fetch origin main`) | first run: 1 failed, a **timeout at 20000 ms under load** (`is looking at two real trees`); rerun alone: 34 passed |
| `dtbd`, `topology-clean` | 1 passed; 61 passed |
| the ledger guard (`ledger-guard.mjs --base origin/main`) and `ci-ledger-guard.test.ts` | exit 0, passed by the head's `Ledger-Edit` trailer (covering the work-map plan), layout ok; 32 passed |

