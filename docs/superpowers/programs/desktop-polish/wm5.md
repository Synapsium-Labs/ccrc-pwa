# Task WM5: the task note (desktop polish run 2969, D-8844)

The note for the programme work map's Task WM5, written by its worker for the coordinator to fold into the ledger. Each
claim says whether it was **measured** (read on the tree, or in a test run by this task) or **inferred**, or is a **report**
(what a mail or a review said, which this task cannot re-read). It is a rules-and-docs task: no product code. It describes the
tip after fix round 2 (review 3112), which follows fix round 1 (review 2975); where an earlier push differed, it says so.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| A new last section of the plan reference, "Keep the plan: the programme page shows what remains": what the Work card is drawn from; the rule that a put restates what it keeps; `plan put` with `phases`; `plan ticket-add`; naming the ticket at `runs open`; `plan phase-ref` (carry, add, remove); `plan ticket-done`; `unknown-ref`, `bad-carry` and `evidence-unverified` each with its recovery; the back-fill | `ccd/coordinator-skill/references/plan.md` | Measured: the diff; each recovery was read from `parsePlanPhaseRef`, `diffPlan`, `diffPhases`, `phaseRefVerdict`, `ticketDoneVerdict` and the plan routes |
| `ticket-required` and `ticket-unavailable` in the `runs open` refusal list say what `runMustNameTicket` decides ("an open ticket with no run attached that is not an auto ticket"; "open with none unless `ticket-required` refuses that"), and `ticket-unavailable` lists what `planGate` refuses, in the words the Linear hierarchy's wave-6 PR gives it ("held by another run (started, or open with a run attached, a planned run included)"), with a key outside the plan said in `api.md` and in the section | `references/plan.md` (refusal list), `references/api.md` (the "`runs open` also answers six refusals" list) | Measured; review 2975 F4 |
| A test that sends the section's examples, in order, to the real plan routes over a real coord.db, on the plan the `plan put` example under `## plan put` leaves; each must answer 200 | `server/test/coordinator-plan-examples.test.ts` (new) | Measured: 4 cases (round 2: the `ticket-done` example keeps its shape, every example is one the test runs, and the back-fill's drop body runs on the final plan); the mutants in §4 |
| WM1's `NOT_MET` row for `evidence-unverified` deleted and `phase-ref` and `ticket-done` out of `WORK_MAP_VERBS` (the set is empty); pins of the section's refusal words, its recovery bullets and their remedies, its evidence rule, its capability sentences and its rules, inside the section only (round 2 added the remedies and the evidence rule that were pinned nowhere); the one body the back-fill line gives parsed by `parsePlanTicketMove` | `server/test/coordinator-plan-reference.test.ts` | Measured: 24 cases at the round-2 tip, 27 at the merge tip (§7); the mutants in §4 |
| The two new corpus commands in the closed-table pin's sorted list | `server/test/ccrc-api-closed.test.ts` | Measured: it went red on exactly those two names when the section landed |
| Task WM5's Files line, Steps 1, 1b, 3 and 4 ticked, and the D-8844 entry with its lead-in | `docs/superpowers/plans/2026-11-16-programme-work-map.md` | Measured |

## 2. What review 2975 found, and what changed

| Finding | What changed | Basis |
|---|---|---|
| F1: the `plan put` example was refused by the server on every plan | The example restates every live epic with its checkpoints and tickets and declares both phases; the section says in one sentence what a put restates, before the examples | Report: the review measured the first example (it parsed and the routes refused it); measured: the new test sends the new one |
| F2: the examples did not chain | The section states one starting plan (the `plan put` example under `## plan put`) and each example names only what an earlier one declared (`p2` and `w1-2` come from the put, `w1-3` from `plan ticket-add`) | Measured: the test runs them in order |
| F3: the `unknown-ref` recovery was a dead end for a dropped object | A dropped phase, epic or ticket is never declared again: name a live object or a new key; a carry to or from a dropped phase is `bad-carry` | Measured against `phaseRefVerdict` |
| F4: the `ticket-required` recovery | Qualified for the epic-of-no-waves case, says to read `plan show`, says "open, no run attached, not an auto ticket", and `ticket-unavailable` for a ticket a planned run holds; `api.md`'s line after `ticket-unavailable` fixed | Measured against `runMustNameTicket` and `epicForOpen` |
| F5: the `ticket-done` text | Recorded done only when the run ends `done` (a failed run puts the ticket back to open); `plan-bad-body` for a malformed body; the `evidence-unverified` list as `ticketDoneVerdict` refuses; the back-fill says one ticket per past run and gives the drop body | Measured against `ticketDoneVerdict` and `onRunAdvancedInTx` |
| F6: thin tests | The route-level test, and the section's words and recoveries pinned inside the section, with each remove, carry and add form run | Measured |
| F7: the judge's `rules-mixed` | Not changed here: the coordinator rules, and holds the push | Report: the coordinator's mail |
| F8: the records | Sections cited, not line numbers; the Files line true; Step 4 ticked; D-8844's lead-in; `closed-table-pin` reworded; #3088 described as the Linear hierarchy's wave-4 follow-ups; every claim here labelled | Measured |

### Review 3112 (fix round 2)

| Finding | What changed | Basis |
|---|---|---|
| F1: `evidence-unverified` omitted the route's own refusal for a run it cannot read, and "never record it again" was too broad | "the run could not be read" joins the run conditions; the sentence is narrowed to a refusal about a fact, and a failed read may be retried | Measured against the `ticket-done` route and `ticketDoneVerdict`; the pin is red when either is removed |
| F2: the examples test replaced the whole `ticket-done` evidence | Only the run number is replaced; the evidence must be exactly one `runId` and a positive integer, and cases for the three broken shapes the review named (`runId` beside `pr`, `pr` alone, another key) are red | Measured: the mutants in §4 |
| F3: recoveries pinned nowhere | The `bad-carry`, `evidence-unverified`, `unknown-ref` and `ticket-required` remedies, the put's `bad-carry`, the run-evidence rule, the retry sentence and the key-outside-the-plan sentence are each pinned inside the section | Measured: each red when removed (§4) |
| F4: the `ticket-unavailable` list | `plan.md`'s bullet takes the Linear hierarchy wave-6 PR's wording verbatim (its holder asked for that; the merge after #3151 still needed a hand resolution, §7); `api.md` has the same words; "a key not in the plan" is said in the section and in `api.md`, not in that bullet, to leave the other PR's hunk untouched | Measured; report: the holder's mail |
| F5: an example the test cannot parse was skipped | The count of `"$API" plan` lines and of `--json -` in the section must equal the parsed examples, and another head or heredoc form is refused | Measured: three form mutants red |
| F6, F7: D-8844's `closed-table-pin` and `ticket-required` entries | Corrected (the word is WM1's, D-8727; the case of no waves is WM6's), and the ticket-sentence clause is recorded | Measured |
| F8: the ledger copy | No change: the coordinator copies this note whole and only WM5's own hunks of the plan; every WM5 edit to the plan is inside its Task WM5 section and D-8844 | Report: the coordinator's ruling |
| F10 to F17 | "declare only one ticket for it, or, where the plan already holds several, keep one and drop each extra"; the put's `bad-carry` said; "none is refused" qualified (your home project, your run number); `<home project>` is to be replaced; the examples' heredoc closers are at the start of a line (the section's examples sit outside list items); "four verbs"; the no-phases sentence says `wave-epic-mismatch` where every live epic lists waves; "the `plan put` example under `## plan put`"; "a planned run" given its meaning | Measured: the diff |
| F9, F18 | Left as they are, by the coordinator's ruling | Report: the coordinator's mail |
| F19 | This note's labels and the reach statement fixed | Measured |

## 3. The carried wording, read against the code on `main`

The carried wordings named in the brief (the lead paragraph, the ticket sentence, the two refusal bullets and `api.md`'s list) were each read against `planGate`, `epicForOpen`, `epicForWave` and `runMustNameTicket`
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

On a saved copy of `plan.md`, restored byte for byte after each (`cmp` against the saved copy), through the box's test wrapper. A mutant that does not apply (a line wrap
in the way) was re-run with a whitespace-tolerant edit; one that hit an older section by mistake (the first `ticket-add` example is in the `plan ticket-add` section) was
re-run on an example only this section has.

- **Round 1.** The examples test went red, naming the example, for: a carry to a phase the put does not declare; `p2` renamed; a `ticket-add` of a stored key; a `remove`
  of a reference never added. The reference test went red for each of ten sentences and bullets moved out of the section.
- **Round 2, the reference test**, red for each of nine more sentences removed or changed: the `bad-carry` recovery; the put's `bad-carry`; the `unknown-ref` recovery; the
  `ticket-required` remedy; the run-evidence rule; the `evidence-unverified` recovery; the run-read refusal; the retry sentence; the key-outside-the-plan sentence.
- **Round 2, the examples test**, red for: the `ticket-done` example with `runId` beside `pr`, with `pr` alone, with another key (each fails the shape case and the run case);
  an example with a quoted heredoc, with a `ccrc-api` head, and with no space before `<<JSON` (each fails the order case and the count case).

## 5. Claims and co-edits

- Mine: `api.md`, this note, the plan, the new test file.
- Held by wave 7's worker in round 1 (claims 5967 and 5954): `plan.md`, `coordinator-plan-reference.test.ts` and `ccrc-api-closed.test.ts`. It consented to co-edits of exactly my
  lines on **2026-11-20**, by mail, and again on the same date for this fix round's rewrite of my section, my case and my import, and for the `ticket-required`
  bullet. It named its own hunks: the migration section of `plan.md`, its import before `clientRoutes`, one case before the `plan take` examples case, three
  `NOT_MET` rows, and `plan.map-propose` before `plan.met` in the closed-table list. Report: its mails. Inferred: that a three-way merge stays clean, since
  none of its hunks touches or abuts mine.
- Round 2: `plan.md` and the reference test were held by the Linear hierarchy wave-6 worker's claim 6298. Its holder consented on **2026-11-21**, by mail, to my section, my
  `ticket-required` clause, the sentence in `plan put`, my cases and one new pin, and named its own hunks (the hierarchy paragraph, the `ticket-unavailable` bullet, the triage and
  take `unreachable` entries, a map-propose sentence; in the test, the header comment, its console case and two new cases, its `unreachable` case). It asked that the
  `ticket-unavailable` bullet take its wording verbatim, which this round does. Its PR was frozen in its last review round, so no further change of its comes. Report: its mail.
  My own claims (`api.md`, the plan, this note, the examples test) were re-taken as claim 6343 after the earlier ones lapsed.
- The plan was held by claim 5899 of WM4's ended session, which lapsed on its own at 15:40Z; the coordinator would not break it. Report: the coordinator's mail.
  The Task WM7 worker (run 2970) later asked and was given a co-edit of one new section after Task WM6.

## 6. Runs

Each through `ccrc test`, in `server/`, `--maxWorkers=2`, one file per process, at the round 2 tip before its commits. Load is the 1-minute average at the start of the run. Measured.

| File | Load | Result |
|---|---|---|
| `coordinator-skill` | 8.7 | 290 passed |
| `skill-size-ratchet` | 8.7 | 32 passed |
| `ccrc-api-closed` | 8.7 | 52 passed |
| `coordinator-plan-reference` | 8.9 | 24 passed |
| `coordinator-plan-examples` | 8.9 | 4 passed |
| `plan-policy` | 8.8 | 62 passed |
| `plan-phases` | 8.8 | 59 passed |
| `plan-ticket-done` | 9.7 | 64 passed |
| `plan-ticket-required` | 8.8 | 15 passed |
| `plan-routes` | 9.0 | 45 passed |
| `plan-epic-waves` | 7.5 | 18 passed |
| `deviation-refs` (after `git fetch origin main`) | 8.0 | 34 passed |
| `dtbd` | 8.2 | 1 passed |
| `topology-clean` | 8.2 | 61 passed |
| `single-definition`, each of its 42 files in its own process | 8 to 9 | all passed |
| the ledger guard, as a pull request from `ws/polish-wm5` | n/a | passes by the head's `Ledger-Edit: D-8844` trailer |

Round 1's runs (a load flake each in `plan-phases`, `deviation-refs` and `topology-clean`, green on the rerun) are in the first push's note and did not recur.

## 7. Not green, said plainly

- **Nothing red in round 2.** Every run above passed on its first process; no rerun was needed.
- **Not run here:** the browser, pwa and agent suites, and no full run. Measured: CI's fast run at the previous tip ran `test (pwa)` and `test (agent)` and both
  passed; CI at this round's tip decides this one. Inferred: `.github/ci/reach.mjs` sends a docs change to the pwa suite and a `ccd` or server change to the agent suite, which is
  why they run at all.
- **Not seen:** the section on the rendered Docs reader (a skill reference, not a doc page); and no example was run through a live server, only through the plan
  routes over a fixture coord.db (measured: the examples test).
- **F7 is settled:** the judge's `rules-mixed` is resolved by the split the coordinator ruled (report: its mail); this PR keeps the rules files and their tests, and
  the coordinator lands this note and the plan's WM5 hunks first, then asks for a land-sync.

## 7. The merge after #3151, and this copy (coordinator, 2026-11-21)

- **Measured** (by the coordinator, `git show --remerge-diff` and a tree merge of the parents): after fix round 2 the branch
  merged `origin/main` at `bedc03d85` as `84714006a`, because #3151 had changed `plan.md`. The merge needed a hand
  resolution in two files, not one: `plan.md` (the `ticket-required` and `ticket-unavailable` bullets, `ticket-unavailable`
  kept in #3151's words) and `coordinator-plan-reference.test.ts` (a test title kept as main's). It differs from an automatic
  merge in those two files only.
- **Report** (the worker's wave-done 29544): at the merge tip the reference test ran 27 cases, the examples test 4,
  `coordinator-skill` 290 and `ccrc-api-closed` 52, each green; `single-definition` is 43 files there.
- **Measured**: review 3143 read the merge tip and found nothing that blocks. Its two text findings (D-8844's
  `api-md-ticket-wording` and this note's staleness) are fixed in this copy, which lands on the coordinator's ledger PR
  apart from the rules files (the judge's `rules-mixed`, recorded call 50). Where this copy and the branch differ, the
  branch's land-sync takes this copy.

