# Task WM5: the task note (desktop polish run 2969, D-8844)

The note for the programme work map's Task WM5, written by its worker for the coordinator to fold into the ledger. Each
claim says whether it was **measured** (read on the tree, or in a test run by this task) or **inferred**, or is a **report**
(what a mail or a review said, which this task cannot re-read). It is a rules-and-docs task: no product code. It describes the
tip after fix round 1 (review 2975); where the first push differed, it says so.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| A new last section of the plan reference, "Keep the plan: the programme page shows what remains": what the Work card is drawn from; the rule that a put restates what it keeps; `plan put` with `phases`; `plan ticket-add`; naming the ticket at `runs open`; `plan phase-ref` (carry, add, remove); `plan ticket-done`; `unknown-ref`, `bad-carry` and `evidence-unverified` each with its recovery; the back-fill | `ccd/coordinator-skill/references/plan.md` | Measured: the diff; each recovery was read from `parsePlanPhaseRef`, `diffPlan`, `diffPhases`, `phaseRefVerdict`, `ticketDoneVerdict` and the plan routes |
| `ticket-required` and `ticket-unavailable` in the `runs open` refusal list say what `runMustNameTicket` decides ("an open ticket with no run attached that is not an auto ticket"; "open with none unless `ticket-required` refuses that") | `references/plan.md` (refusal list), `references/api.md` (the "`runs open` also answers six refusals" list) | Measured; review 2975 F4 |
| A test that sends the section's examples, in order, to the real plan routes over a real coord.db, on the plan the `plan put` example at the top of the file leaves; each must answer 200 | `server/test/coordinator-plan-examples.test.ts` (new) | Measured: 2 cases; the mutants in §4 |
| WM1's `NOT_MET` row for `evidence-unverified` deleted and `phase-ref` and `ticket-done` out of `WORK_MAP_VERBS` (the set is empty); pins of the section's refusal words, its three recovery bullets, its capability sentences and its rules, inside the section only; the one body the back-fill line gives parsed by `parsePlanTicketMove` | `server/test/coordinator-plan-reference.test.ts` | Measured: 22 cases; the mutants in §4 |
| The two new corpus commands in the closed-table pin's sorted list | `server/test/ccrc-api-closed.test.ts` | Measured: it went red on exactly those two names when the section landed |
| Task WM5's Files line, Steps 1, 1b, 3 and 4 ticked, and the D-8844 entry with its lead-in | `docs/superpowers/plans/2026-11-16-programme-work-map.md` | Measured |

## 2. What review 2975 found, and what changed

| Finding | What changed | Basis |
|---|---|---|
| F1: the `plan put` example was refused by the server on every plan | The example restates every live epic with its checkpoints and tickets and declares both phases; the section says in one sentence what a put restates, before the examples | Report: the review measured the first example (it parsed and the routes refused it); measured: the new test sends the new one |
| F2: the examples did not chain | The section states one starting plan (the `plan put` example at the top of the file) and each example names only what an earlier one declared (`p2` and `w1-2` come from the put, `w1-3` from `plan ticket-add`) | Measured: the test runs them in order |
| F3: the `unknown-ref` recovery was a dead end for a dropped object | A dropped phase, epic or ticket is never declared again: name a live object or a new key; a carry to or from a dropped phase is `bad-carry` | Measured against `phaseRefVerdict` |
| F4: the `ticket-required` recovery | Qualified for the epic-of-no-waves case, says to read `plan show`, says "open, no run attached, not an auto ticket", and `ticket-unavailable` for a ticket a planned run holds; `api.md`'s line after `ticket-unavailable` fixed | Measured against `runMustNameTicket` and `epicForOpen` |
| F5: the `ticket-done` text | Recorded done only when the run ends `done` (a failed run puts the ticket back to open); `plan-bad-body` for a malformed body; the `evidence-unverified` list as `ticketDoneVerdict` refuses; the back-fill says one ticket per past run and gives the drop body | Measured against `ticketDoneVerdict` and `onRunAdvancedInTx` |
| F6: thin tests | The route-level test, and the section's words and recoveries pinned inside the section, with each remove, carry and add form run | Measured |
| F7: the judge's `rules-mixed` | Not changed here: the coordinator rules, and holds the push | Report: the coordinator's mail |
| F8: the records | Sections cited, not line numbers; the Files line true; Step 4 ticked; D-8844's lead-in; `closed-table-pin` reworded; #3088 described as the Linear hierarchy's wave-4 follow-ups; every claim here labelled | Measured |

## 3. The carried wording, read against the code on `main`

The four carries named in the brief were each read against `planGate`, `epicForOpen`, `epicForWave` and `runMustNameTicket`
(`server/src/coord/openRun.ts`, `planPolicy.ts`) and their tests. All measured.

- **The lead paragraph** ("lists the waves that run in it, or lists none, when each of its runs names its ticket"): true of an optional `PlanEpicBody.waves`
  (WM6). Not changed.
- **The ticket sentence** ("a ticket of the epic that lists the wave or of a live epic that lists no waves (it opens at any wave)"): true. It said a run with
  no ticket gets an auto ticket with no exception; one clause says `ticket-required` can refuse it.
- **The `wave-epic-mismatch` bullet** in `plan.md` and `api.md`: already carries the epic-of-no-waves case and the "every live epic lists waves" case, and
  matches `epicForOpen`. Not changed.
- **The `ticket-required` bullet**: already named both cases; its "no run has started" is now "no run attached that is not an auto ticket" (F4).
- **`api.md`'s plan-added run refusals**: already six and pinned at six by `coordinator-skill.test.ts`, so Step 1's five-to-six was done before this task
  (`api-md-already-six`). WM1's review 2740 F6 is met: the Files line names the reference test.

## 4. Mutation (measured)

On a saved copy of `plan.md`, restored byte for byte after each (`cmp` against the saved copy), through the box's test wrapper:

- The examples test went red, naming the example, for: a carry to a phase the put does not declare; `p2` renamed so no phase `p2` exists; `ticket-add` of
  a key the put already stored; a `remove` of a reference never added.
- The reference test went red for each of: the put rule's sentence changed; the dropped-object recovery changed; the `plan show` recovery changed; the second
  `ticket-required` case changed; the failed-run clause removed; the malformed-body clause changed; the back-fill sentence changed; a capability word
  changed; the `bad-carry` bullet changed; the `unknown-ref` bullet changed (10 of 10). The failed-run mutant first did not apply (a line wrap) and was
  re-run with a whitespace-tolerant edit.
- The first version's mutant (a misspelt `ticket-done` command and a renamed word) went red on the verb check and on the examples case.

## 5. Claims and co-edits

- Mine: `api.md`, this note, the plan, the new test file.
- Held by wave 7's worker (claims 5967 and 5954): `plan.md`, `coordinator-plan-reference.test.ts` and `ccrc-api-closed.test.ts`. It consented to co-edits of exactly my
  lines on **2026-11-20**, by mail, and again on the same date for this fix round's rewrite of my section, my case and my import, and for the `ticket-required`
  bullet. It named its own hunks: the migration section of `plan.md`, its import before `clientRoutes`, one case before the `plan take` examples case, three
  `NOT_MET` rows, and `plan.map-propose` before `plan.met` in the closed-table list. Report: its mails. Inferred: that a three-way merge stays clean, since
  none of its hunks touches or abuts mine.
- The plan was held by claim 5899 of WM4's ended session, which lapsed on its own at 15:40Z; the coordinator would not break it. Report: the coordinator's mail.
  The Task WM7 worker (run 2970) later asked and was given a co-edit of one new section after Task WM6.

## 6. Runs

Each through `ccrc test`, in `server/`, `--maxWorkers=2`, one file per process. Load is the 1-minute average at the start of the run. Measured.

| File | Load | Result |
|---|---|---|
| `coordinator-skill` | 20 | 290 passed |
| `skill-size-ratchet` | 20 | 32 passed |
| `ccrc-api-closed` | 20 | 52 passed |
| `coordinator-plan-reference` | 20 | 22 passed |
| `coordinator-plan-examples` | 20 | 2 passed |
| `plan-policy` | 20 | 62 passed |
| `plan-phases` | 20 | 1 of 59 failed in the first process; 59 passed on the rerun alone |
| `plan-ticket-done` | 12 | 64 passed |
| `plan-ticket-required` | 21 | 15 passed |
| `deviation-refs` (after `git fetch origin main`) | 17 | 1 of 34 failed in the first process; 34 passed on the rerun alone |
| `dtbd` | 10 | 1 passed |
| `topology-clean` | 10 | SIGKILLed at 43 of 61; 61 passed on the rerun, the slice at 2.3 of 6.0 GiB |
| `single-definition`, each of its 42 files in its own process | 10 to 20 | all passed |
| the ledger guard, as a pull request from `ws/polish-wm5` | n/a | passes by the head's `Ledger-Edit: D-8844` trailer |

## 7. Not green, said plainly

- **Three load flakes, each green on the one rerun the brief allows.** `plan-phases` and `deviation-refs` each failed one case in the first process, at
  load 17 to 20, and passed alone. `topology-clean` was SIGKILLed once at 43 of 61 and passed 61 of 61 on the rerun. Inferred: the shared test slice's
  memory cap and load, not findings. `deviation-refs` reads the plan this task edits and passed against it.
- **Not run:** the browser, pwa and agent suites (a docs and test-file change, so none reaches them), and no full run (the queue and the daily run are the arbiters).
- **Not seen:** the section on the rendered Docs reader (a skill reference, not a doc page); and no example was run through a live server, only through
  the plan routes over a fixture coord.db.
- **F7 stands open:** the judge's `rules-mixed` on this PR, which the coordinator is putting to the operator.
