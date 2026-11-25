# Landing order, wave 1f — the known limits of waves 1c, 1d and 1e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: written by the coordinator on 2026-11-25. No implementation exists.** One small wave, one pull request. It builds on `main` at or after `ba0b0f40`, wave 1d's merge (#3365), because Task 3 edits lines that wave added.

**Goal:** Close the minor points the last reviews of waves 1c, 1d and 1e left open, and give two whole-tree scan cases the margin they lack, so that none of them removes a green pull request from the merge queue or lets a guard rot unseen.

**Architecture:** No new mechanism. Five kinds of edit: the coordinator's conflict-sync procedure reads the probe's own exit status; a few text guards gain the lines they lack; three comments and one README sentence say what was measured; the queue's liveness step tells a superseded group from a script that failed; two scan cases run under their own measured budget.

**Tech Stack:** Markdown (a skill reference, the README), the repository's workflow file, Node (one CI script), vitest suites under `server/test`.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`, sections 5.1 (the conflict-sync trigger) and 5.2 (the queue's own CI). The plans it follows: `docs/superpowers/plans/2026-11-24-landing-order-wave1c-conflict-sync.md`, `docs/superpowers/plans/2026-11-25-landing-order-wave1d-queue-ci.md` and `docs/superpowers/plans/2026-11-25-landing-order-wave1e-browser-shards.md`.

## Where each point comes from

| Point | Source | Task |
|---|---|---|
| The measure block's exit status is the rev-parse line's, not the probe's | review run 3751, F1 (wave 1c) | 1 |
| Two statements of the bound have no guard | review run 3751, F2 | 1 |
| The case that runs the hook does not read the limit or the own-probe condition | review run 3751, F3 | 1 |
| The README says "of that round" with no antecedent | review run 3751, F6 | 1 |
| The procedure does not say where the branch tip is read from; a path with a space | review run 3738, residuals | 1 |
| Two sentences of the browser job's comment, and one in its pin's comment | review run 3750, F2 and F3 (wave 1e) | 2 |
| A stale pointer in another browser test's header | review run 3750, F4 | 2 |
| Nothing pins that the armed rows resolve their base through `armedBase`, or where the queue base line sits | review run 3762, F1 (wave 1d) | 3 |
| The closure case admits a third script line | review run 3762, F2 | 3 |
| The deadline comment reads as claiming a pin for 45; the README sentence reads as if other runs keep 30 | review run 3762, F3 and F5 | 3 |
| A script that fails ends the job exactly as a superseded group does | review run 3762, F7 | 3 |
| The harness integrity scan and the cross-tree deviation scan each run at their 20-second limit | measured, below | 4 |

**Measured for Task 4** (2026-11-25):
- `ccd-harness-integrity.test.ts`, the case "no override names a function nothing ships": 16.9 s alone on the fleet box at load 13. Its whole file took 17.1 s in merge-queue run 45563248418 and 22.6 s in run 45565143100, where the case ran past its 20 s limit and removed a green pull request (#3362) from the queue.
- `deviation-refs.test.ts`, the case "is looking at two real trees, each with a real ledger in it": timed out at 20 s four times on 2026-11-25 on the fleet's test box and locally (22.5 s in one run), and passed, with all 34 cases, at a longer limit. Its whole file took 16.0 s and 24.9 s in the same two queue runs. Every other case of the file took under 2.4 s.

## What this does not claim

- It changes no clause of any skill. `ccd/coordinator-skill/SKILL.md`, `ccd/worker-skill/SKILL.md` and `ccd/coordinator-skill/references/wave-steps.md` are not edited, so no pin suite of a contract moves.
- It changes no deadline, shard count, permission, trigger, job, required check name or repository setting.
- It does not make the browser file-time table derive itself. That is a later wave's.
- It does not correct the "about a dozen" comments and test titles that call the armed rows' base "the merge-base" loosely (review run 3762, F6). None of them is false, and a sweep of them would touch a growth-checked file for wording alone.
- The text pin of Task 3 Step 1 is a text pin. It holds one line of a test file against deletion; it does not prove what a real queue run measures.

## Global Constraints

- Commit on the workspace's own branch. Push once, when the wave is complete, with code, tests and notes together.
- Every test and typecheck runs through `ccrc test -- <command>`, from inside the package, one file per process, `--maxWorkers=2`, in the foreground.
- A guard ships with a mutation row: the row is measured red, the file restored from a saved copy and its sha256 checked, then green.
- The README's lines are written exactly as this plan gives them. If an old block no longer occurs exactly once on the build's base, report it and stop on that block.
- `ccd/session-hook.sh` is not edited. Task 1 edits only the suite that runs it.
- Task 3 changes a file under `.github/`, so the pull request runs the full suite. Add no label and dispatch no run.
- The pull request is opened as a draft and stays one. Marking it ready and the merge queue are the coordinator's.
- Deviations: this plan defines D-9066, D-9067 and D-9068. A departure found while building is named by its bare slug in the task note, and as `D-TBD-<slug>` in the wave-done mail only.

## Review Focus

1. **A coordinator who follows the new measure block literally** on a clean branch, on a conflicting branch, and with a tip git cannot resolve. Each must print a `probe exit` line that tells the three apart, and only the second sends a mail.
2. **The liveness step in the two mixed orders.** A group built before this wave (the old step) with the new script on `main`, and this wave's own group (the new step) with the old script on `main`. Neither may end a live or a landed group's job.
3. **The exit code chosen for a superseded group** against the codes Node itself exits with (1 to 14 as documented, and 128 plus a signal's number). A script killed by a signal must read as failed, never as superseded.
4. **The placement pin** when the step that runs the suite is renamed or split: it should turn red and say why, never pass on a job that no longer runs the suite with the base.
5. **A longer budget hiding a real slowdown.** Each case's comment names the measured time and the date, so a reader can tell a budget from a guess.

---

### Task 1: the sender's measure step, and the last text guards of the conflict-sync mail

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle-run-care.md` (the section "A conflict mid-round: the conflict-sync mail")
- Modify: `README.md` (one sentence of the "Landing order" paragraph)
- Test: `server/test/conflict-sync-text.test.ts`, `server/test/session-hook-sync-advisory.test.ts`

**Interfaces:** none. The mail's form (D-9013) and the worker's clause are unchanged.

- [ ] **Step 1: Failing pins.** In `conflict-sync-text.test.ts`:
  - case 5 ("gives the mail the same two body entries…"): replace the pin of the fence, `'<the branch tip> origin/main git rev-parse origin/main ```'`, with three:
    - `has(runCare, 'tip=$(gh pr view <pr> --json headRefOid --jq .headRefOid)')`
    - `has(runCare, '"$tip" origin/main; rc=$? git rev-parse origin/main echo "probe exit $rc" ```')`
    - `has(runCare, "The probe's own exit status is the `probe exit` line")`
  - the same case: `has(runCare, "The paths are for the reader: the worker's own probe is what measures")`
  - case 2 ("bounds the fourth trigger…"): `has(readme, 'The first two license at most one absorption per PR.')`
  - case 3 ("closes the fourth trigger at the wave-done…"): `has(runCare, "Never after this round's wave-done")`, and the README pin becomes `'before the wave-done of the round the worker is in'`.

  In `session-hook-sync-advisory.test.ts`, the advisory case, after the `exactly that commit` line:

  ```ts
  expect(text).toContain("before this round's wave-done only");
  expect(text).toContain('your own probe of that commit agrees');
  ```

  Run both files. Expected: `conflict-sync-text` red on the four new run-care pins and the README pin; the two README and lead-in pins of F2 green at once (they pin text that exists); the advisory case green at once (the hook already prints both phrases). Say in the task note which were green at once, and cover those by their mutation rows.
- [ ] **Step 2: Rewrite the measure block** of the run-care section. The fence becomes exactly:

  ```bash
  tip=$(gh pr view <pr> --json headRefOid --jq .headRefOid)
  git merge-tree --write-tree --name-only --no-messages \
    "$tip" origin/main; rc=$?
  git rev-parse origin/main
  echo "probe exit $rc"
  ```

  and the paragraph after it says, in this order: the tip is the pull request's head as GitHub reads it, the commit the worker pushed; the probe's own exit status is the `probe exit` line, since the call's own status is the last command's; it must read `probe exit 1` with a tree id on the output's first line, then the conflicted paths; `probe exit 0`, or any other answer (exit 1 with no tree id is a ref git could not resolve), sends nothing; the `git rev-parse origin/main` line prints the commit that was measured, and that commit is the base. Keep the sentences the suite already pins (`git rev-parse origin/main`, `copied from the rev-parse output and never typed`).
- [ ] **Step 3: One sentence on the paths**, after "`paths: <the conflicted paths>`, space-separated.": `The paths are for the reader: the worker's own probe is what measures, so a path with a space in it needs no quoting.`
- [ ] **Step 4: The README sentence.** Old, exactly once in the file:

  ```text
  absorption of exactly the named commit per mail, before the worker's wave-done of that round only. An
  ```

  New:

  ```text
  absorption of exactly the named commit per mail, before the wave-done of the round the worker is in. An
  ```
- [ ] **Step 5: Run** `conflict-sync-text`, `session-hook-sync-advisory`, `coordinator-skill`, `worker-skill`, `skill-size-ratchet` and `docs-parity`. Green. A reference file carries no size cap, so the ratchet does not move.
- [ ] **Step 6: Commit.** `docs(landing-order): the conflict-sync measure step reads the probe's own exit status (wave 1f, D-9066)`

### Task 2: three comments say what was measured (wave 1e)

**Files:**
- Modify: `.github/workflows/ci.yml` (the comment above `timeout-minutes: 30` in job `browser-pwa`; comment lines only)
- Modify: `server/test/ci-pipeline.test.ts` (the comment inside the browser-leg case; comment lines only)
- Modify: `pwa/browser/add-project-sheet.browser.test.ts` (its header comment; comment lines only)

- [ ] **Step 1: The window.** In the workflow's `FOUR SHARDS (D-9026)` paragraph, "in the six merge-queue runs of 2026-11-25 that ran the suite" becomes "in the ten merge-queue runs created from 00:17Z to 01:58Z on 2026-11-25 that ran the suite". In the pin suite's comment, "in six merge-queue runs of 2026-11-25" becomes "in the ten merge-queue runs created from 00:17Z to 01:58Z on 2026-11-25". Re-wrap each comment at its own width. (Ten, not six: corrected after review run 3793; see "Corrections after review run 3793".)
- [ ] **Step 2: The slow-runner sentence.** In the workflow's `THE LIMIT IS 30 (D-9055)` paragraph:
  - "a third green shard was cancelled" becomes "another green shard was cancelled" (it was at least the fourth cancellation of that night);
  - "and at 1.7 times a balanced shard of four would stand about three minutes under 20." becomes "and at 1.7 times the slowest shard of the four-shard run that landed this (743 s of tests and about 40 s of setup) stands at about 22 minutes, over 20."
- [ ] **Step 3: The pointer.** In `add-project-sheet.browser.test.ts`'s header, "are copied, trimmed, from `project-linking-card.browser.test.ts`, which keeps them inside its file." becomes "are copied, trimmed, from `projectLinkingCardRig.ts`, which the two linking-card files share."
- [ ] **Step 4: Run** `ci-pipeline`, `ci-merge-queue`, `oss-metadata` and `workflow-yaml-parses` from `server/`, and `browser-leg` from `pwa/`. Green: no case reads these comments. `git diff` on the three files shows comment lines only.
- [ ] **Step 5: Commit.** `docs(ci): the browser job's comment names the runs and the slow-runner figure it measured (wave 1f)`

### Task 3: the queue's own CI, its last guards (wave 1d)

**Files:**
- Modify: `.github/ci/queue-live.mjs`, `.github/workflows/ci.yml` (the eleven liveness steps; the `server-shard` deadline's comment), `README.md` (one sentence)
- Test: `server/test/queue-live.test.ts`, `server/test/ci-merge-queue.test.ts`, `server/test/growth-check.test.ts`

**Interfaces:**
- Produces: `export const SUPERSEDED_EXIT = 64` in `.github/ci/queue-live.mjs`. The script exits with it on `superseded` and with 0 on every other fate.
- Consumes: `armedBase(env, root)` from `server/test/growthCheck.ts`, unchanged.

- [ ] **Step 1: The base's two unpinned links (F1).**
  - In `growth-check.test.ts`, delete the one-line wrapper `resolveBase` and write its call site as `const resolved = armedBase(process.env, ROOT);`, with the wrapper's comment above it. One link fewer.
  - Add a case to the stacked-entry `describe`: the suite reads its own source as text and finds `const resolved = armedBase(process.env, ROOT);` exactly once. This is a text pin, on purpose: the line runs at module load from the real environment, so no case can re-run it under another one. Say so in the case's comment.
  - In `ci-merge-queue.test.ts`, add a case: in job `server-shard`, the one step whose text holds `QUEUE_BASE_ENV_LINE` is the step named `Test`, and that step's script runs vitest. Read the job's steps the way `ci-pipeline.test.ts#steps` does.

  Both new cases are green at once; their mutation rows are 1F-05 and 1F-06.
- [ ] **Step 2: The closure case's end (F2).** `QUEUE_LIVE_STEP` in `ci-merge-queue.test.ts` gains an end: after the script's last line the next line is not a deeper script line (a negative lookahead for ten spaces). First measure the hole: add a third script line to `server-shard`'s step and see `ci-merge-queue` stay green; then anchor; then see it red; restore.
- [ ] **Step 3: A failed script is not a superseded group (F7, D-9067).** Failing cases first, in `queue-live.test.ts`:
  - the superseded case expects `status` 64, not 1;
  - a new end-to-end case: the script file is replaced by one that throws at load (`throw new Error('x')`), run through the step's own two script lines in a shell: exit 0, and the output holds `queue-live: unmeasured (the script failed, exit 1)`;
  - a new end-to-end case: the real script on the superseded fixture, through the same two lines: exit 1;
  - the whole-step pin's second script line becomes the new line below.

  Then the code. The script exits `SUPERSEDED_EXIT` where it exits 1, and its header says so. The step's second script line, in all eleven jobs, becomes exactly:

  ```bash
  node "$RUNNER_TEMP/queue-live.mjs" || { rc=$?; [ "$rc" -eq 64 ] && exit 1; echo "queue-live: unmeasured (the script failed, exit $rc)"; exit 0; }
  ```

  `QUEUE_LIVE_RUN` in `ci-merge-queue.test.ts` follows. The job still ends with exit 1 on a superseded group, so nothing a reader of the run sees changes. The two mixed orders are both safe, and the task note says so with the reasoning: an old step with the new script ends the job on 64 as it did on 1; the new step with the old script reads the old exit 1 as a failed script and lets the job run.
- [ ] **Step 4: The deadline's comment and the README sentence (F3, F5).**
  - In the workflow, above `timeout-minutes: 45`: "Pinned — key AND ceiling — by server/test/oss-metadata.test.ts." becomes "The key and the 60-minute ceiling are pinned by server/test/oss-metadata.test.ts; nothing pins 45 itself, which D-9014 allows." Re-wrap at the comment's width.
  - In the README, old, exactly once:

    ```text
    would catch what it skipped. In a queue run, a server shard's deadline is 45 minutes, not 30: a full queue shard
    ```

    New:

    ```text
    would catch what it skipped. A server shard's deadline is 45 minutes on every run, not 30: a full queue shard
    ```
- [ ] **Step 5: Run** `queue-live`, `ci-merge-queue`, `ci-pipeline`, `oss-metadata`, `workflow-yaml-parses`, `growth-caps`, and `growth-check` armed as wave 1d's task 3 note ran it. Green.
- [ ] **Step 6: Commit.** `fix(ci): a failed liveness script lets the job run; the queue base's two links are pinned (wave 1f, D-9067)`

### Task 4: two scan cases get the margin they lack

**Files:**
- Modify: `server/test/ccd-harness-integrity.test.ts`, `server/test/deviation-refs.test.ts`

- [ ] **Step 1: Measure where the time goes,** before any edit, and write the figures in the task note: for the harness scan, the time of `shippedFunctions()`, of reading the test sources, and of `overridesIn` over them; for the deviation scan, the count of `git` processes `plansAt` starts for each of the two refs and the time of each `plansAt` call.
- [ ] **Step 2: The deviation scan reads each tree in one process.** `plansAt` starts one `git cat-file blob` process for each plan file. Read the blobs of one ref through one `git cat-file --batch` process instead. First add a characterization case, green on the old code: for `HEAD`, the list `plansAt` answers (each path and each text) has a sha256 the case records; the batch read must answer the same list, byte for byte. Then change the read. Then measure the case again.
- [ ] **Step 3: Each of the two cases runs under its own budget (D-9068).** Pass a timeout as the case's last argument: 60000 for "no override names a function nothing ships", and 60000 for "is looking at two real trees, each with a real ledger in it" unless Step 2 brought it under 5 s on the test box, in which case leave it at the suite's limit and say so. Above each, a comment with the measured time, the date and the run it came from, in the style of `ccd-ws-collect-resume`'s budgets.
- [ ] **Step 4: Run** each file alone on the test box, three times, and once with `ccrc test --local`. Record each time. Green every time.
- [ ] **Step 5: Commit.** `test: two whole-tree scans run under a measured budget, and the plan read is one process per tree (wave 1f, D-9068)`

### Task 5: the gate, the mutation rows, the handoff

- [ ] **Step 1: The gate.** One file per process, from `server/`: every suite named in Tasks 1 to 4, then `citations`, `anchors`, `topology-clean`, `docs-parity`, `deviation-refs` (after `git fetch origin main`), `typecheck-tests`, and the server typecheck. From `pwa/`: `browser-leg`.
- [ ] **Step 2: The mutation rows** below, each measured red, restored from a saved copy with its sha256 checked, then green.
- [ ] **Step 3: Notes** under `docs/superpowers/programs/landing-order/` as `wave1f-task-<n>.md`. Check mail, probe the merge against `origin/main` after one fetch, push once on exit 0, open the draft pull request, wait for its run on the exact tip, send the wave-done.

## Mutation table

| Row | Mutation | Suite | Red at |
|---|---|---|---|
| 1F-01 | the fence loses `; rc=$?` and the `echo "probe exit $rc"` line | `conflict-sync-text` | case 5, the fence pin |
| 1F-02 | the README's "The first two license at most one absorption per PR." becomes "at most two" | `conflict-sync-text` | case 2 |
| 1F-03 | the run-care lead-in's "this round's" becomes "its" | `conflict-sync-text` | case 3 |
| 1F-04 | in a copy of the hook, the phrase "before this round's wave-done only" moves from the advisory's string into a comment | `session-hook-sync-advisory` | the advisory case |
| 1F-05 | `const resolved = armedBase(process.env, ROOT);` becomes a plain merge-base read | `growth-check` | the text-pin case |
| 1F-06 | the `QUEUE_BASE` env line moves from the `Test` step to the step before it | `ci-merge-queue` | the placement case |
| 1F-07 | a third script line is added to `server-shard`'s liveness step | `ci-merge-queue` | the closure case (green before Step 2's anchor) |
| 1F-08 | the script exits 1 on `superseded` again | `queue-live` | the superseded case, and the end-to-end case through the step's lines |
| 1F-09 | the step's line loses its `\|\|` arm and is the bare `node` line again | `queue-live` | the whole-step pin, and the failed-script case |
| 1F-10 | the batch read drops the last plan of a tree | `deviation-refs` | the characterization case |
| 1F-11 | the README's "before the wave-done of the round the worker is in" loses "of the round the worker is in" | `conflict-sync-text` | case 3 |
| 1F-12 | the fence's `tip=$(gh pr view <pr> --json headRefOid --jq .headRefOid)` line is removed | `conflict-sync-text` | case 5 |
| 1F-13 | the sentence "The probe's own exit status is the `probe exit` line" is removed | `conflict-sync-text` | case 5 |
| 1F-14 | the sentence "The paths are for the reader: the worker's own probe is what measures" is removed | `conflict-sync-text` | case 5 |

Row 1F-04 runs the suite against a mutated copy of the hook, as the suite's harness allows; the shipped hook is not edited.

## Corrections after review run 3793

Review run 3793 read the wave's branch at `d7daacef34` (pull request #3380): no critical or important finding, ten minor ones, and its panel confirmed none. Two were this plan's own errors, corrected here and in the tasks above. Where this section and a task disagree, this section wins.

- **Ten runs, not six (F1).** Task 2 Step 1 told the builder to write that six merge-queue runs created from 00:17Z to 01:58Z on 2026-11-25 ran the browser suite. Ten did. The coordinator measured them again after the review: their second shard took, in run order, 944, 998, 920, 1,204 (cancelled), 1,187, 924, 1,085, 916, 1,211 (cancelled) and 922 seconds. The range the comment gives, 916 s to 1,211 s, holds over the ten. Eight other runs created in that window skipped the browser tests by step and are not counted.
- **Node's own exit codes run to 14 (F2).** Review Focus 3 said 1 to 13. Node documents 14 as well. The conclusion is unchanged: 64 is no code Node exits with by itself.
- **The measure block's exit line (F7).** `probe exit 1` is printed for a conflict and for a tip git cannot resolve. The tree id on the output's first line is what tells them apart, which the paragraph after the fence says. Review Focus 1 asked the exit line alone to tell the three apart; it does not, and it need not.
- **Four pins without a row (F8).** Rows 1F-11 to 1F-14 above. The review measured each red; the builder measures them again in the fix round.
- **The characterization case and the legacy list (F4).** The case's recorded count and hash passed through the legacy exclusion filter, a list that may only shrink. The fix round makes the case independent of that list.
- **Built in the wave's first fix round:** the ten in three places, the exit code range, one contradicting comment removed, the harness budget comment made to agree with its note, the characterization case, and the four rows.

## Deviations found

Three numbers were issued for this plan on 2026-11-25. They are approved design, not as-built evidence. A worker reports execution departures by slug; the coordinator numbers and records them. Three more were issued the same day for the departures the build reported (D-9073 to D-9075); they are defined last.

- **D-9066 (2026-11-25)** — `conflict-sync-probe-status`: the run-care reference's measure step prints the probe's own exit status as a `probe exit` line, and reads the branch tip from the pull request's head. D-9062 put the rev-parse in the same call as the probe, which made the call's exit status the rev-parse line's, so the test the section names ("the probe must exit 1") could not be read from the call it prescribed. Not yet implemented.
- **D-9067 (2026-11-25)** — `queue-live-exit-code`: the liveness script exits 64 on a superseded group, and the workflow's step ends the job only on that code; any other failure of the script prints an `unmeasured` line and lets the job run. Wave 1d's step ran the script bare, so a script that could not run would have ended every long job of every queue group, and the fix for it would have had to land through that same queue. The step still ends a superseded group's job with exit 1 (D-9015 is unchanged). Not yet implemented.
- **D-9068 (2026-11-25)** — `scan-case-budget`: two whole-tree scan cases run under their own measured budget of 60 seconds, where the suite's limit is 20: the harness integrity scan of every test source, and the cross-tree deviation scan's first read of two trees. Each ran at 17 to 25 seconds in merge-queue runs, and the first removed a green pull request from the queue. The deviation scan also reads each tree's plans in one git process. **As built (review run 3793):** only the harness scan's case runs under 60 seconds. The one-process read brought the deviation scan's case from a timeout at 20 seconds to about 2 seconds, so it stays at the suite's limit, as Task 4 Step 3 allowed.
- **D-9073 (2026-11-25)** — `mutation-hook-copy-local`: row 1F-04 mutates a copy of the session hook in the temp root and points the advisory suite's hook constant at that copy, because the suite has no override for the hook's path.
  - It runs in the local slice only: the test box cannot read the temp root. The shipped hook is not edited; the review checked its sha256 before and after.
- **D-9074 (2026-11-25)** — `closure-anchor-blank-lines`: the closure case's end anchor skips blank lines before it looks for a deeper script line, where Task 3 Step 2 asked for a lookahead at the next line only.
  - A YAML block scalar runs on across a blank line, so a third script line after a blank one would have passed the plan's anchor. The built anchor is strictly stronger; the review measured it red on a third line, on a blank line then a third line, and green on a comment after the step.
- **D-9075 (2026-11-25)** — `plans-characterization-fixed-commit`: the byte-for-byte characterization case of the plan read reads a fixed commit on `main`, where Task 4 Step 2 said `HEAD`.
  - With `HEAD`, the recorded count and sha256 would go stale each time a plan is added. The fixed commit is permanent on `main`; in a checkout too shallow to hold it the case fails and says so, it does not skip, and the server shards check out the full history.
