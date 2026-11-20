# Task WM5: the task note (desktop polish run 2969, D-8844)

The note for the programme work map's Task WM5, written by its worker for the coordinator to fold into the ledger. Each
claim says whether it was **measured** (read on the tree, or in a test run by this task) or **inferred**. It is a rules-and-docs
task: no product code.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| A new last section of the plan reference, "Keep the plan: the programme page shows what remains": what the Work card is drawn from, `plan put` with `phases`, `plan ticket-add` in the same act as the plan file, naming the ticket at `runs open`, `plan phase-ref` (carry, add, remove) and `plan ticket-done`, with `unknown-ref`, `bad-carry` and `evidence-unverified` each followed by its recovery | `ccd/coordinator-skill/references/plan.md` | Measured: the diff; each recovery was read from `planPolicy.ts` (`parsePlanPhaseRef`, `phaseRefVerdict`'s refusals, `ticketDoneVerdict`) and `planRoutes.ts` |
| WM1's `NOT_MET` row for `evidence-unverified` deleted, and `ticket-done` and `phase-ref` out of `WORK_MAP_VERBS` (the set is now empty), so the test checks the word and both verbs from now on | `server/test/coordinator-plan-reference.test.ts` | Measured; the mutant in §4 |
| A new case that parses the new section's own examples (`plan put` with `phases`, `phase-ref` carry and add, `ticket-done`) as the routes parse them | the same file | Measured |
| The two new corpus commands in the closed-table pin's sorted list | `server/test/ccrc-api-closed.test.ts` | Measured: it went red on exactly those two names when the section landed |
| `api.md`: **no edit** | `ccd/coordinator-skill/references/api.md` | Measured: see §2 |
| Task WM5's Steps 1, 1b and 3 ticked, its Files line naming the plan-reference test, and the D-8844 entry | `docs/superpowers/plans/2026-11-16-programme-work-map.md` | Measured |

## 2. The carried wording, each read against the code on `main`

The brief named four carries. For each, the text on `main` (a976187839) was read against `planGate`, `epicForOpen`, `epicForWave`
and `runMustNameTicket` (`server/src/coord/openRun.ts`, `planPolicy.ts`) and their tests.

- **`plan.md` line 4** ("lists the waves that run in it"): already reads "lists the waves that run in it, or lists none, when each of its runs
  names its ticket". True of `PlanEpicBody.waves` optional (WM6). Not changed. Measured.
- **`plan.md` lines 14-17** (the ticket sentence): "a ticket of the epic that lists the wave or of a live epic that lists no waves (it opens at
  any wave)" is true. It said a run with no ticket gets an auto ticket "in the epic that lists the wave" with no exception, while a phased plan,
  and a plan with an epic of no waves, refuse such a run `ticket-required`. One clause added: "unless `ticket-required` refuses it (below)". Measured.
- **`plan.md` lines 21-24 and `api.md` lines 20-33** (`wave-epic-mismatch`): already carry the epic-of-no-waves case, the "no live epic lists this
  wave, and every live epic lists waves" case, and the live-epic note. They match `epicForOpen` (a named ticket of a waveless live epic takes the run at any
  wave; with no ticket and no epic listing the wave, `ticket-required` when a live epic lists none, else `wave-epic-mismatch`). Not changed. Measured.
- **`plan.md` lines 30-32 and `api.md` lines 34-37** (`ticket-required`): already name both cases (a phased plan whose epic has an open ticket no run
  has started; no epic lists the wave and a live epic lists none). They match `runMustNameTicket` and `epicForOpen`. `api.md` already lists six plan
  refusals (`ticket-required` was added there by #3088) and `coordinator-skill.test.ts` already pins six, so the plan's "five to six" was done before
  this task. Not changed. Measured.
- **WM1's review 2740 F6**: WM5's Files line in the plan now names `server/test/coordinator-plan-reference.test.ts`. Measured.

## 3. Departures, named by slug (the plan's D-8844 entry carries the same list)

- `api-md-already-six`: the plan's Step 1 asks for `ticket-required` in `api.md` and the pin to go from five to six. Both were already true on `main`, so
  `api.md` is not edited (§2). Measured.
- `work-map-verbs-empty`: the brief says remove `ticket-done` from `WORK_MAP_VERBS`; `phase-ref` is documented by this same section and its row is on
  `main`, so it leaves the set too and the set is empty. Without it the check would skip a verb the reference now documents. Measured.
- `closed-table-pin`: the plan lists no edit of `server/test/ccrc-api-closed.test.ts`. Documenting a verb's command line in the corpus makes the closed-table test
  list it, so two names are added to that list. Measured.
- `section-examples-parse`: a new test case parses the section's examples with the routes' own parsers, as the `plan take` examples already are. Beyond the
  plan's Step 1b; one `it()`. Measured.
- `step-2-left-open`: Step 2, the notice to every live coordinator, is the desktop-polish coordinator's, after this merges. Not done and not ticked.

## 4. Mutation (measured)

On a saved copy of `plan.md`, `` `evidence-unverified` `` renamed and `"$API" plan ticket-done` misspelled: `coordinator-plan-reference.test.ts` went
2 failed, 17 passed (the verb check, and the new examples case); the saved copy was put back and compared byte for byte. Before the edit, WM1's
`NOT_MET` row hid the word from the check, which is why the check could not go red by itself (D-8727).

## 5. Claims and co-edits

- Mine: `api.md` (unchanged, claim held), this note, the plan.
- Held by wave 7's worker (claims 5967 and 5954): `plan.md`, `coordinator-plan-reference.test.ts` and `ccrc-api-closed.test.ts`. It consented to co-edits of
  exactly my lines on **2026-11-20**, by mail, naming its own hunks so a three-way merge stays clean: it adds a `plan map-propose` section between `plan
  triage` and `plan take`, a `parseMapProposal` import, one case, and replaces three `NOT_MET` rows; and adds `plan.map-propose` before `plan.met` in the
  closed-table list. Mine sit after `plan take`, two lines below its `NOT_MET` rows, and after `plan.met` and `plan.ticket-add`. Measured: its mail.
- The plan was held by claim 5899 of WM4's ended session; it lapsed on its own and the coordinator would not break it. The Task WM7 worker needs the same
  file, for a new section after Task WM6.

## 6. Runs

Each through `ccrc test`, in `server/`, one at a time, `--maxWorkers=2`. Load is the 1-minute average at the start of the run.

| File | Load | Result |
|---|---|---|
| `coordinator-plan-reference` | 14 | 19 passed (18 before the new case) |
| `coordinator-skill` | 12 | 290 passed |
| `skill-size-ratchet` | 16 | 32 passed |
| `ccrc-api-closed` | 16 | red on the two new commands, then 52 passed after the list edit |
| `single-definition` (all) | 13 | `advance-switches` and `docs-l0` red in the batch; each green alone on one rerun (53 and 155 passed): load flakes |
| `dtbd` | 27 | 1 passed |
| `deviation-refs` (after `git fetch origin main`) | 20 | 34 passed |
| `topology-clean` | 12 to 20 | SIGKILLed five times, then 61 passed (§7) |
| the ledger guard (`.github/ci/ledger-guard.mjs`, as a pull request from `ws/polish-wm5`) | n/a | passes by the head's `Ledger-Edit: D-8844` trailer; the first head had the trailer in its own paragraph, which git's trailer parser does not read, so the commit was amended before the push |

## 7. Not green, said plainly

- **`topology-clean` was killed, then passed.** Its worker was SIGKILLed ("Worker exited unexpectedly with signal SIGKILL") on five runs, alone, with
  `--maxWorkers=2` and with one, while the test slice held 4.8 to 5.0 of its 6.0 GiB (other sessions' runs, measured: `ccrc test --status`). On the
  sixth, with the slice at 4.8, it passed 61 of 61. This task adds no name to any list it scans, and the whole-tree scan with the operator's local list, run at the tip, printed nothing. Inferred: the kills were the slice's
  memory cap, not a finding.
- **`single-definition`: two files red in the batch.** `advance-switches` and `docs-l0` failed in the 43-file batch at load 13 and each passed alone on
  the one rerun the brief allows (53 and 155 passed). Inferred: load flakes; neither reads a file this task changes.
- **Not run:** the browser, pwa and agent suites (a docs and test-file change, so none reaches them), and no full run (the queue and the daily run are the arbiters).
- **Not seen:** the new section was not read on the rendered Docs reader (it is a skill reference, not a doc page).
