# Program: landing-order

Spec: `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`
Plans: `docs/superpowers/plans/2026-09-2?-landing-order-wave<N>-*.md` — each written once the waves it depends on
have landed what it reads
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-quiet-river` (assigned by the operator 2026-10-02)   Workspace: **a fresh one per wave**
Ticket: `CCR-19` (Linear; mirrored as GitHub issue #198) — the coordinator is created from it
Companion programme: `docs/superpowers/programs/session-continuity.md`

**What this program is.** The fleet manufactures main churn — ritual syncs, `update-branch`, repeat absorptions —
and lands in whatever order merges happen to arrive, testing no composition. This programme stops the churn,
makes landing order a recorded fact, and lets the coordinator land a tested composition. **The coordinator
merges, workers never do, and nothing merges unattended** (spec §3, R5). The operator's rulings are the spec's §3
(R1–R10); every §11 decision was ruled on 2026-09-23.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 | worker clause 16 and coordinator clause 15 with their pins and count words; the PreToolUse advisory on syncs of `main`; `ccrc restamp`; `update-branch` pinned absent from executable source and counted in the skills | skills, hook (fleet box) | — | #231 | merged 2026-10-02 (`10f32755`); run 218 closed; deploy AGENT-FIRST by the update mechanism |
| 2 | 2, repository code | `ci.yml` gains `merge_group`, the macOS skip and a `pull_request` concurrency group; `pr-state`'s `queue` field; the dequeue feed event and coordinator mail; the hook denies `gh pr merge` to workers; clause 15's native-queue sentence | ccd, hook, server | wave 1; child-reclamation wave 3 | #234 | merged 2026-10-03 (`0087a045`); run 238 closed; deploy via ccrc's updater (fleet-first measured safe) |
| 2b | 2, the bypass deny | the hook denies `--admin` and a `gh api` merge call in every fleet session | hook | the operator's queue ruleset, approvals at 0, and the proof run | — | to plan |
| 3 | — | Task 7's preconditions (the payload cap, the quote-dense timing pin), wave 2's residue, Task 7's runbook text | hook, ccd, doctor | wave 2 | — | dispatched 2026-10-04 22:21 as run 250 (`ccrc-pwa-still-delta`); block 3906–3915 + 3916–3920 |
| 3b | 3 | `ccd-land-probe`, the read-only conflict radar, and its opt-in mirror | ccd, deploy | wave 3 | — | to plan after wave 3 merges |
| 4 | 4 | the opted-in lineage table; `lineage-unmeasured` | server | wave 3 | — | to plan |
| 5 | 5 | the landing line: entries, intents, holds, `land-candidate`, the coordinator's pinned merge, the PWA doors | server, ccd, skills, pwa | waves 2–4; session-continuity wave 1 | — | to plan |

**A fresh workspace per wave (R4) is child-reclamation's.** The spec first drew it as step 6 of the wave lifecycle,
gated on CCR-15 wave 3. CCR-15 wave 2 (#178) made it live on `main` as "One PR per child", so wave 1 no longer
carries it (spec §5.1, amended 2026-09-24).

## Decisions & deviations

- **2026-09-23 — the design, its rulings and the written spec.** Approved in the brainstorm (R1–R8); the operator
  ruled both open decisions on the written spec the same day: break-glass keeps the repository-admin role as the
  ruleset's only bypass actor (R9); strict protection comes off intake-platform and data-internal after a week of
  coordinator landings with composition tests (R10).
- **2026-09-23 — stage 2 split into two waves.** The spec's own rollout order puts the `--admin` deny after the
  operator's ruleset change and the proof run (§5.2 steps 2–4), so it ships as wave 2b rather than behind a flag in
  wave 2. Not a deviation — the spec's order, drawn as waves.
- **2026-09-24 — the Maintain-role bypass comes off.** The operator confirmed the removal wave 2's runbook makes
  (Task 7 Step 4) when it adds the queue rule: the repository-admin role stays the ruleset's only bypass actor.
- **2026-09-24 — execution: coordinator dispatch.** The operator creates one coordinator per programme from its
  ticket. Each wave goes to a fresh worker workspace running subagent-driven development, a review run reads the
  worker's branch, and the coordinator rules and merges; the plans reach a worker only from `main`, so the docs
  PR carrying the specs, the ledgers and the first four plans merges before the first dispatch.
- **2026-09-24 — the plans re-measured against `main` `b501698a`.** Main moved three commits after review (#176,
  #178, #179). Both plans' counts and line hints were re-measured and corrected. Step 6 left wave 1: child-reclamation
  delivered it. Wave 2's Tasks 3–5 are re-planned after child-reclamation wave 3 merges: under "One PR per child" a
  producer's run closes before its PR merges and wave 3 reclaims its workspace. So the dequeue lane has no open run
  or registry row to key on. The landing spelling must keep `--match-head-commit`, and the merge deny has a window
  (the plan's status block names the directions).
- **2026-09-28 — the plans re-measured against `main` `c62e22b9`; two rulings.** Nine commits landed after 2026-09-24
  (#182–#186, #192–#195). Eight opus agents re-checked every tree-dependent claim, a second per plan re-ran each. Wave 1:
  numbers only, except that CI test selection (#183) took away trigger 2's evidence — a push to main now runs no test
  legs and reports every required check green. **Ruled by the operator:** trigger 2 reads "a required check is red while
  main passes the same tests", measured by re-running the failing test files on a clean `origin/HEAD` (spec §5.1); Tasks 3
  and 5 re-measured with it. `measure-landing.py main-red` stays valid for the frozen baseline only; stage 2 reads
  red-main from runs that ran the required legs, or refuses a window crossing `814fc53d`. Wave 2: #183 landed first and
  reshaped `ci.yml`, so Task 1 and Task 7's precondition join Tasks 3–5 in the re-plan. **Ruled by the operator:** a
  merge-queue run runs the selected tests, like a PR.
- **2026-09-28 (evening) — wave 1 re-measured again against `023fe94d`.** Child-reclamation wave 3 (#187) and
  update-management wave 4 (#181) merged after `c62e22b9`. #181 rewrote `ccrc`'s usage line (`rollback`, `channel`,
  `watchdog`), so Task 2's usage edit, its `ccrc-cli` regex and mutation row R5 are restated on the new line and
  re-measured (`ccrc-restamp` 7|1 then 8/8, `ccrc-cli` 1|34 then 35/35). Wave 3 now lands first, so its skill `it`
  blocks are part of the base and Task 3 inserts below them with no conflict; everything else moved only in numbers.
  With #187 merged, wave 2's Tasks 3–5 re-plan is unblocked.
- **2026-09-29 — wave 2 re-planned; four operator rulings.** Re-planned prototype-first on `main` `6da36f0b` with wave 1
  applied, three independent opus reviews (21 findings, one blocker: gh 2.45 ARMS auto-merge rather than queueing a PR
  whose required checks have not passed, with the same success line), one fix round and an independent verification.
  The landing lane keys on the open run, a `merged:#<n>` mail wakes a coordinator waiting at `merging`, the merge deny
  also reads the child marker, the producer lands before its close (the last wave too), every landing binds
  `--match-head-commit`, and the coordinator enqueues only once the required checks pass and reads the queue entry
  back. **Ruled by the operator:** an independent wave N+1 still dispatches only after wave N closes; the `merged:`
  mail is in; the 2026-09-24 25 s `pr-state` ruling stands (a close's worst case is now about 50 s); and if the proof
  run's enqueue is refused because `allow_auto_merge` is off, stop rule 4 halts and the operator decides. The spec
  (§4–§6, §9) is amended to match. Wave 1's usage-line edits now anchor on the `|expose|version|` fragment, because
  the verb list grew again (#202's `versions`); re-measured on `cf24e4be`: `ccrc-restamp` 7|1 then 8/8, `ccrc-cli`
  1|34 then 35/35.
- **2026-10-02 — the coordinator assigned.** The operator made session `ccrc-pwa-quiet-river` — the planning session
  that wrote this programme's plans — the coordinator of landing-order, session-continuity and workspace-lifecycle
  together. Each wave is its own run under that session id; a fresh coordinator resumes only under the same id
  (the coordinator skill's `references/resume.md`). Wave 1 dispatches now; wave 2 after wave 1 merges (the 2026-09-29 ruling).
- **2026-10-02 — wave 1 dispatched as run 218** to a fresh workspace (`ccrc-pwa-swift-prairie`, branch `ws/swift-prairie`),
  executing by subagent-driven development on the matrix's "worker executing a spec'd plan" row (Opus · high,
  Sonnet · high implementers, an Opus · high reviewer per task, workflow off, compact 40). Its deviation
  numbers, issued at run-open and written bare here until a plan on the same ref defines them: 3758 through 3767.
  The brief adds two rules that post-date the plan: the wave stops at the PR (the coordinator merges; the
  fleet moves by ccrc's own update mechanism, operator ruling 2026-09-30), and main is measured fresh.
- **2026-10-02 — peer agreement with stall-watch on the skill clauses.** Stall-watch's coordinator
  (`ccrc-pwa-calm-harbor`) wrote about its wave 4 (run 226). That wave adds a coordinator clause and a worker clause.
  It will leave the skill files alone until this programme's wave 1 merges, then renumber its own clauses (spec
  2026-09-29 §10: whoever lands second moves the count words). Wave 1 keeps coordinator clause 15 and worker
  clause 16.
  - **Owed on merge:** a one-line mail to `ccrc-pwa-calm-harbor`.
  - **The peer's second finding.** The plan moves three of the five `fourteen` occurrences in
    `coordinator-skill.test.ts`. The two it leaves (about `:146` and `:181`) are comments, which no test reads, so
    they cannot red. Ruled: update both in clause 15's commit, as a departure from run 218's block.
- **2026-10-02 — wave 1 done, in review.** Run 218's wave-done (PR #231, tip `1f688879`) passed the server's
  re-measurement. The run is at `awaiting-review` and its seven items are settled.
  - **Departures.** The worker used 3758 through 3764 from its block, each defined in the plan on the branch. 3765
    through 3767 went unused.
  - **Merge state.** The branch has not merged main `cf9e4cc8`. Its merge-tree probe there is clean.
  - **Skipped step.** Task 7 Step 6 (rollout) was skipped by standing rule. The deploy is owed after the merge,
    through ccrc's own update mechanism, fleet box first.
  - **Signals:** `suite: red`, `failure: shallow`. The branch's own red was modelenv-single-writer: Task 2's restamp
    spelled `writeFileSync` inside `ccd/ccrc`. The task-scoped suite lists the plan wrote never ran that repo-wide
    guard, and the worker's first full run caught it (fixed as 3764).
  - **Routing: not escalated.** The miss is the plan's suite lists, not the worker's effort. An effort rung would
    not have run a guard nobody listed. The remedy is in the briefs: every later wave's brief names the repo-wide
    guards (the `single-definition` scans, `modelenv-single-writer`, `box-token-census`, `routing-references`) in
    each task's suite run.
  - **Review.** Review run 228 went to `ccrc-pwa-still-hollow`: the held-out panel, each lens given the plan's
    matching review item.
- **2026-10-02 — six items the worker raised for ruling.**
  1. Clause 16's triggers 1–2 are not bounded to "before wave-done", and clause 9 forbids a push after it. Spec §12
     names this, and stage 4's clause-9 exception closes it. Carried to stage 4.
  2. No coordinator step and no worker bullet describes a report-less fix round from `merging` (a land-sync, an
     ejection). Carried to stage 5, which owns ejection.
  3. The `update-branch` absence set leaves out `ccd/ccrc-*` helpers, `ccgpt-*` and `install-*.sh`. None spells the
     word today, so widening the set costs nothing and keeps it true as helpers are added. Ruled: widen it in
     wave 2.
  4. `main-red` over a window after #183 reads push runs that ran no test legs, because a merge to `main` runs no
     tests since the CI-selection design. Ruled: stage 2's re-measure counts trusted full runs only (daily, manual
     full, stable gate) and reports a window with none as unmeasured, never as green. Named cost: a one-day
     resolution on main's red intervals.
  5. Brief against plan on who assigns departure numbers: the brief governs, because it post-dates the plan and
     carries the issued block. The worker followed it.
  6. Commit trailers that name the authoring subagent's model are honest attribution and stay.
- **2026-10-02 — review 228 ruled: one fix round.**
  - **The panel:** three lenses, 63 agents, none unverified. 16 findings were confirmed, 4 refuted, and none left
    unexamined.
  - **The reviewer's checks:** 13 mutation rows re-ran red, the brief's suites were green, and 16 further repo-wide
    guards were green.
  - **CI:** the required Linux legs are green.
  - **The two important findings, both in the instrument:**
    - `inversions` reads GitHub before it refuses a missing `--fleet-login`;
    - `cmd_main_red`'s docstring claims to reproduce the archived 111.2 h, which the plan's own measurement says it
      does not.
  - **Ruled, fixed now:**
    - both important findings;
    - the hook's quadratic walk on `(` and `{` (it runs on every PreToolUse event, and D-3761 closed only the
      newline shape);
    - the instrument's cheap correctness gaps: the runs-list cap, uncounted inputs, a running re-run, `..` in a path;
    - restamp's failure message;
    - the I14 row text.

    The hook's false positives and misses are made true in its known-limits text, not changed in the regex. The fix
    round takes 3765 through 3767, one per group.
  - **Accepted:**
    - restamp's refusal is path-scoped, and a hard link defeats it; the operator is not an adversary, and the header
      will say so;
    - D-3761's restatement landed two commits after its definition; the tip is consistent and main squashes.
  - **Carried:** the report-less fix round, to stage 5.
- **2026-10-02 — wave 1's fix round done, in re-review.** The fresh wave-done (tip `db45cafc`) passed the server's
  re-measurement.
  - **Fixes:** four commits, then a clean merge of main `cf9e4cc8`. 3765 through 3767 are used, so the block is
    full.
  - **Rows:** 50 mutation rows red, none SKIPPED. The wave batch and the repo-wide guards passed, 790 tests, and the
    citation census reads stated=base=tree.
  - **The F3 trade:** no separator opens a quadratic walk any more (the 39 KB `(`/`{` payloads take 9–16 ms on the
    regex alone, down from 3.4–3.6 s). The cost is that a token holding `(` or `{` (`-C "$(pwd)"`, `-C ${WS}`) now
    ends the walk, so such a sync gets no advice.
  - **Re-review:** review run 232 judges that trade.
- **2026-10-02 — re-review 232 ruled: fix round 2.**
  - **The panel:** 7 confirmed, 2 refuted, collapsing to 5 distinct findings, all minor.
  - **Measured:** every ruling holds, and nine rows re-measured red. F3's whole-hook time fell from 4.7–9.8 s to
    about 105 ms.
  - **The F3 trade is proportionate.** Replayed over about 31 days of fleet Bash commands, the trade cost no real
    sync its advice: the 18 commands that lost it were mentions inside mail heredocs.
  - **Ruled:**
    - the closed-first read order is a stated guard, so it owes a pin;
    - name the delivered-then-parked mail in `undelivered`;
    - Step 8 prints the new counts;
    - restate H1, H2, H9, H14 and R4.

    Each extends D-3765 or D-3767, so no new number.
- **2026-10-02 — fix round 2 done, in re-review.**
  - **Fixes:** three commits (tip `e63e90e7`).
    - The closed-first read order is pinned (I25).
    - `undelivered` is named truly, with a rejected-at-close row in the counts case (I26).
    - Step 8 prints the new counts.
    - Each table header carries one snapshot.
  - **Rows:** I1–I26, R1–R10 and H1–H16 are all red, none SKIPPED.
  - **Re-review:** review run 235 went out with the held-out panel over `db45cafc..e63e90e7`.
- **2026-10-02 — wave 1 accepted and merged.**
  - **Review 235** read fix round 2 and found four minor findings: Step 8's two-way split of `undelivered` misses
    the replay-ceiling and two other parks; R7 and R8 name one red case where two red; Task 5 Step 5's 37/37 is
    unlabelled; and the new "run closed" row is credited with a red that another row gives.
  - **F4 ruled:** keep the row, and reword its comment, I26's cell and D-3765 to say it guards a future split keyed
    on `lastError`.
  - **Accepted:** all four, carried into wave 2's first commit.
  - **Totals:** three review runs (228, 232, 235) and two fix rounds. All ten numbers used, 3758 through 3767.
  - **Checked against main before merging:** #231 shared README with #229. The merge-tree was clean, and a scratch
    worktree of the merged tree ran 16 README-, count- and ledger-reading suites (731 of 731) and the citation cases
    (7 passed).
  - **Merge:** squash-merged at the verified tip `e63e90e7` as `10f32755`. Wave 2's run (238) was opened first. Run
    218 closed `done`, released, and its child was queued for reclaim.
  - **Mail sent:** the stall-watch coordinator was told clauses 15 and 16 are on main (as promised), and both
    wave 2 workers that their README tasks are unblocked.
- **2026-10-02 — wave 2 opened as run 238.** Deviation numbers, written bare: 3856 through 3865.
  - **The plan's status block makes the dispatching coordinator re-measure Tasks 2–5.** Since its last check
    (`cf24e4be`), nearly every file those tasks edit has moved: the stall watch, #219, and all three wave 1s. Task 1's
    `.github/` files have not.
  - The re-measure runs as a workflow, one Opus · high agent per task on an isolated worktree at `10f32755`. Dispatch
    waits on its answer.
- **2026-10-02 — wave 2's Tasks 2–5 re-measured on `10f32755`; dispatch waits on the daily cap.**
  - **Task 2** applies. Skip the README re-pointer (since #217 README has no `ccd/ccd:N` anchor); the census now
    reads 147/197.
  - **Task 3** applies with adaptations, none a design change:
    - `queue` is the ninth notify kind (#219 added `update`);
    - `hasMailWithSubject` already shipped in #224 (D-3639), so add only `hasFeedEvent`;
    - three comment and import re-anchors for the stall watch;
    - mutation K1 rewritten.
  - **Task 4** applies. The deny block is at 3347 by content, after the advisory. The deny's `jq` strip fails open
    without Oniguruma, and the block will say so.
  - **Task 5** applies as written.
  - **Overlaps:**
    - Continuity wave 2's `ccd/ccd` edits are measured disjoint from Task 2's, and only the line-2 stamp is
      shared, so the second lander merges and re-stamps.
    - Stall-watch wave 4 (run 226) claims the skill files Task 5 edits, and its coordinator has been told (mail
      3240).
  - **Deploy:** SERVER-FIRST. ccrc's updater moves the fleet node first, so the order is raised with the operator at
    merge.
  - **Dispatch** was refused `cap-daily` (24 of 24 in the fleet's rolling window). A background retry re-measures
    the window and dispatches at the next age-out (21:27:39 UTC). Raising `maxSessionsPerDay` is the operator's
    door.
- **2026-10-02 21:28 — wave 2 dispatched as run 238** to a fresh workspace (`ccrc-pwa-plain-prairie`), in the
  21:27:39 slot. The slot split was agreed with the stall-watch coordinator: its review 239 takes 22:34:18, and this
  session takes nothing before 00:09:10 without mailing it. Routing: the "worker executing a spec'd plan" row.
- **2026-10-02 21:30 — wave 1 deployed.** Both boxes run v0.0.63 (`10f32755`, #231's own merge), applied from the
  console 19:52–20:00. Task 7 Step 6's read-only proofs on the fleet box:
  - `PASS skills: 17/17 homes carry the shipped ccrc-coordinator, ccrc-worker and ccrc-reviewer`;
  - the hook carries `THE LANDING-ORDER ADVISORY` once;
  - `ccrc restamp --help` prints `usage: ccrc restamp <file>`;
  - doctor shows 0 FAIL lines.
- **2026-10-02 21:33 — run 238 gets six more numbers, 3871 to 3876** (mail 3267 asked; answer 3270). The plan's
  Deviations found lists ten slugs. With the residue's one departure and the brief's per-task adaptations, ten
  numbers do not cover the wave. The assignment:
  - 3856: the residue;
  - 3857 to 3865: the first nine slugs, in plan order;
  - 3871: held-coordinator-operator-enqueues;
  - 3872: Task 2's skipped README re-pointer and the moved census;
  - 3873: Task 3's adaptations (the ninth kind, the one read, the rundefs move);
  - 3874: Task 4's Oniguruma line;
  - 3875 and 3876: spares, each named in the wave-done.
- **2026-10-02 23:57 — wave 2 done: PR #234 at `a89d3dc7`** (wave-done 3291; report
  `~/.cc-clips/ccrc-pwa-plain-prairie/wave-done-238-a89d3dc7.md`).
  - **Re-measured:** the branch tip is the claimed sha, and the PR is open and mergeable. Advanced to `working`, then
    `awaiting-review`, both ok. All 7 items are settled done.
  - **The worker's signals:** `suite: red`, `failure: unclear`. The first full run's only red is tmp-sweep's FAILS
    CLOSED, which is red on main too: server 21335 passed, agent 422, PWA 3147. Routing stands.
  - **Deviations:** 3856 (the residue, in the wave-1 plan), 3857–3865 and 3871 (the ten slugs), 3872–3874 (the
    adaptations), and 3875, the spare used: the plan's deny regex was quadratic on separator-restart inputs, and
    the shipped one is linear there. 3876 is unused.
  - **The deploy order (3864), for the operator at merge.** The plan's SERVER-FIRST cannot happen: ccrc's
    updater moves the fleet node first, and nobody moves boxes by hand (ruling 2026-09-30). The worker argues the
    fleet-first window is harmless:
    - the old server's 20 s bound may kill a slow sweep, which retries next tick and writes nothing;
    - the deny is live at once;
    - no repository requires the queue before Task 7.
    Task 7 now requires both boxes on the tag first. Review 241 is asked to verify the argument.
  - **#233 and #234** were measured merging cleanly with each other. #232 (clause 16) will conflict on an adjacent
    line, and the second lander keeps both sides.
  - **Review run 241** is open. Its brief holds the merge deny as a security boundary. It dispatches at 02:42:08,
    this session's slot under the split with stall-watch.
- **2026-10-03 02:43 — review run 241 dispatched** to `ccrc-pwa-brisk-ridge`, in the 02:42:08 slot, after
  re-measuring the tip as `a89d3dc7`.
- **2026-10-03 03:25 — review 241 closed and ruled** (report
  `~/.cc-clips/ccrc-pwa-brisk-ridge/review-241-a89d3dc7.md`; the held-out panel, 27 agents, no lens unverified;
  6 confirmed 3–0, 2 refuted 3–0; 11 findings, 2 important).
  - **The review accepts the wave's shape:**
    - ci.yml's concurrency and legs;
    - the 17-of-25 budget;
    - the seven-site census;
    - both landing outcomes with no re-send;
    - clause 15 byte-identical;
    - the residue.
    All suites are green and 16 mutation rows reproduce.
  - **The deploy order (3864): fleet-first is safe**, measured against the tip. The old server's 20 s bound kills an
    overrunning sweep, which retries next tick. The deny only refuses. The land-before-close rule applies only to a
    project that requires the queue, and none does before Task 7. One correction: ccd writes its three registry fields
    before the queue call, the same measurements the old ccd writes. So at merge the operator's update from the
    console, fleet node first, is the deploy, and no hand order is needed.
  - **Fix round 1** (mail 3305; 3876 plus newly issued 3882–3885, written bare here):
    - F2 (must): the plan's Task 6 Step 6, PR-body template and rollback line still said `ccrc rollout --server-first`
      by hand. They are rewritten to the updater's order.
    - F1, 3876: the deny's quote strip failed OPEN on ordinary spellings, including clause 15's own natural
      `sha="$(git rev-parse HEAD)"`, then `gh pr merge … "$sha"`. The strip must consume a `$(`-holding span without
      opening a new one, with the five shapes added as deny cases. F6 folds in: the bounded-time case gets its hold.
    - F8: the hook header lists every unlisted pass class the review measured. The deny is contract-grade, so they
      are listed, not closed.
    - F5, 3882: ccd's five queue words are pinned to the server's map across languages. A rename silenced the lane
      before.
    - F9, 3883: `sweepLanding`'s decisions move to a pure L1 `landingVerdict`, the ring rule #233 was held to.
    - F10(a), 3884: §5's read-back asks the PR's `state` and `autoMergeRequest`, so a merged PR never reads as
      "disarm it".
    - F7 folds into 3873. F3, F4 and F11 are plan-text corrections. 3885 is a spare.
- **2026-10-03 11:58 — run 238 resumed** (mail 3310).
  - The fix round's hook-strip subagent ran a jq timing script at 72 KB. That command was SIGKILLed (exit 137) at
    03:41 on a memory-short box, and the session sat idle for 8 hours with a clean tree at `a89d3dc7`.
  - It restarts the round from the hook strip. Timing runs are now foreground, under `ulimit -v`, at 36 KB and
    100 KB only. A killed run is reported by mail, never left waiting at the pane.
- **2026-10-03 15:21 — fix round 1 done at `1a71493a`** (wave-done 3333; report
  `~/.cc-clips/ccrc-pwa-plain-prairie/wave-done-238-fix1.md`). It is 11 commits, plus a clean merge of main `fe7b9775`
  (#233) with ccd/ccd untouched. On the merged tree, 6837 passed and 0 failed; citations 7|328.
  - **3876, the deny:** three hook rounds. The per-part security reviews and the commit scanner found regressions, so
    the strip now FAILS CLOSED, and whatever it cannot complete stays raw to the end. merge-deny has 62 cases and 58
    live rows; sync-advisory is 68/68 within 1500 ms.
    - The accepted cost, named in the header: three non-standard heredoc spellings false-deny.
    - Listed for Task 7's runbook: the remaining unparsed classes, and the payload cap. Quote-dense input around
      0.5 MB can exhaust the hook, and it then fails open.
  - **The other rulings:**
    - 3882: the queue words are pinned;
    - 3883: `landingVerdict` is L1 in `coord/landing.ts`;
    - 3884: the read-back has three answers;
    - F2 and F7: the text follows the updater.
    3885 is unused.
  - **Review run 247** was dispatched at 15:23 to `ccrc-pwa-amber-hollow`. Its brief keeps the deny a security
    boundary, and asks for false denies on ordinary commands. Timing runs stay at or below 100 KB, under `ulimit -v`.
- **2026-10-03 16:15 — review 247 closed and ruled** (report
  `~/.cc-clips/ccrc-pwa-amber-hollow/review-247-1a71493a.md`; 63 agents, no lens unverified; 13 findings).
  - **What holds:**
    - the merge of main is clean, with ccd/ccd unchanged;
    - 3882, 3883 and 3884 hold and red;
    - no hand deploy remains.
  - **The deny keeps leaking under attack.** F1 is a regression: a `${…}` inside a quoted `$(…)` passed, where
    `a89d3dc7` denied it. F2–F5 are older unlisted bypasses. Every round's regex change has cost a regression.
  - **The stopping line**, ruled (fix round 2, mail 3340):
    - The deny is a contract, not an access boundary (spec §4).
    - A bypass is closed only if it is a regression or an ordinary spelling a careful session might type: F1, and
      F3's `gh pr merge;echo ok`, since bare `merge` lands the branch's own PR.
    - Deliberate evasions are listed in the header and in Task 7's runbook: F2 (` #` inside an unquoted `${…}`), F4
      (a form feed before `#`) and F5 (a path-qualified wrapper).
    - The payload cap and a quote-dense timing pin become preconditions of Task 7.
    - F6–F13 are text and rows.
    - The next review checks the rulings and looks for regressions. Any new bypass is classified, not hunted.
- **2026-10-03 17:50 — fix round 2 done at `7e3b30bc`** (wave-done 3352). Four commits, plus main `db44b136` (#235)
  absorbed: a stamp-only conflict, re-stamped; cite-remeasure unmoved at 147/197/52/35.
  - **Closed:**
    - F1, with H61;
    - F3, the operator terminator, with H62;
    - a regression the F1 fix itself opened (`pe` lacked `$$` and `$'…'`), with H63.
  - **Listed:** F2, F4, F5, and the top-level `"$${"` shape.
  - **F6:** the header is corrected, and Task 7 now carries PRECONDITIONS.
  - **F7–F13:** text and rows L24, W1, W2, S19 and S20.
  - **Merged tree:** merge-deny 71, sync-advisory 68, coordinator-skill 154, citations 7|328. No new number; 3885
    is still a spare.
  - **Review run 249** was dispatched at 17:51 to `ccrc-pwa-quiet-harbor`, under the stopping line: rulings and
    regressions, plus ordinary commands that must still pass. Any new bypass is classified, not hunted.
- **2026-10-03 18:30 — review 249 ruled; wave 2 MERGED as #234 (`0087a045`)**, squash, at the reviewed head
  `7e3b30bc` (report `~/.cc-clips/ccrc-pwa-quiet-harbor/review-249-7e3b30bc.md`; 24 agents, no lens unverified).
  - **No bypass and no regression:**
    - review 241's and 247's shapes deny through the real hook;
    - 41 of 41 deny shapes deny;
    - both earlier tips' merge-deny tests pass on the tip's hook;
    - 24 of 24 ordinary commands pass, including a coordinator's landing without a hold;
    - the merge of main changed only ccd/ccd's stamp.
  - **Four findings, carried as residue** (stopping line):
    - F1: the bounded-time case's unclosed-`$(` payload cannot red its guard, and H40's retirement reason is false.
      With a terminator line, a mutation takes the hook from 69 ms to 3896 ms. A timeout fails the deny open.
    - F2: only `;`, `&` and `)` of the operator terminators are pinned; `|<>` are not.
    - F3: the "four answers" count is unpinned.
    - F4: stale diff and row counts.
  - **CI:** every required Linux check is green. `full-suite` is red only because it needs `test-macos`, and this
    PR touches `.github/`, so it ran the full mode. The macOS legs gate nothing (2026-09-28), and a pull request's
    `full-suite` is never stable-gate evidence.
  - **The boundary:**
    - the next run, 250 (wave 3), opened first (planned; block 3906–3915, written bare);
    - run 238 closed `final` (`released:true`, `childReclaim:queued`).
  - **Overlap notices** (mails 3355 and 3356): #232 lands second on the clause 15/16 line and keeps both sides;
    #215 lands second on ccd/ccd and the coordinator files.
  - **Deploy:** through ccrc's updater. Fleet-first was measured safe (review 241). The deny is live on the fleet
    box at its update, and refuses only a held or child session.
- **2026-10-04 12:41 — the operator delegates Task 7 to this coordinator**: "Run task 7 when you think it's most
  appropriate..let's continue to finishing the programme". Task 7's own text says "not the coordinator", citing
  clause 15's "never writes rulesets or protection". This is the operator's explicit instruction in their own words,
  so this session runs Task 7 on the operator's behalf, from its shell, and records every write and the rollback file.
  - **The sequence it judges most appropriate:**
    1. run 250 lands Task 7 Step 1's two code preconditions (the payload cap and the quote-dense timing pin);
    2. ccrc's updater moves both boxes onto that build;
    3. a trusted full CI run on `main` passes;
    4. then Task 7, Steps 1–7, with Step 4's write backed up by `ruleset-rollback.json`.
  - **Deployed (2026-10-04, read-only):** both boxes run v0.0.69, which carries #233, #235 and #234. The fleet
    box's doctor shows 0 FAIL, skills 17/17, and the merge deny and the rescue policy are present in the installed
    tree. The server box's doctor also shows 0 FAIL.
  - **Run 250's plan** is being drafted, reviewed by three Opus lenses, and revised by a planning workflow
    (`docs/landing-order-wave3-plan`).
- **2026-10-04 21:20 — wave 3 planned** (#244, `docs/superpowers/plans/2026-10-04-landing-order-wave3-task7-preconditions.md`).
  - **How it was made:** drafted on a measured prototype, reviewed by three Opus lenses (spec, replay, test
    honesty), and all 14 findings applied.
  - **What it covers:**
    - Task 7's two code preconditions: `MERGE_PARSE_CAP` 2048, chosen so the costliest quote-dense shape (`"$(<)"`)
      stays inside 25% of the 1500 ms bound, and the quote-dense timing pin;
    - wave 2's residue: review 249 F2–F4, the `jq_regex` doctor check, and a closed-unmerged PR reading `none`;
    - Task 7's runbook text.
  - **Coordinator amendment at dispatch.** Over the cap, the deny matches a word-bounded `gh pr merge` against the
    raw text instead of the two fixed substrings "gh" and "merge". Measured over two days of fleet Bash commands longer
    than 2 KB, the substring rule matched 1,340 of 4,478, mostly prose ("through", "merged"), so a worker's long mail
    would be refused. The word-bounded rule matched 131. Its accepted cost: an over-cap mail that quotes `gh pr merge`
    literally is refused, with a split-or-rephrase message.
  - **Numbers:** 3906–3915, plus 3916–3920 issued for the plan's nine slugs, the amendment and the worker's own.
  - **Carried, with owners:**
    - `PR_QUEUE_MAP`'s `unmeasured` gloss lacks a not-closed qualifier; landing wave 4 owns it (server).
    - a repo-wide slicing convention for files over 600 s (ccrc-doctor, ccrc-install, ccrc-update) is a follow-up.
- **2026-10-04 22:21 — wave 3 dispatched** (run 250 → `ccrc-pwa-still-delta`; branch `ws/still-delta` at
  `b40f4145`; worker skill present; route Opus · high, Sonnet subagents, workflow off, compact 40; five items, one per
  plan task).
  - **Plans merged first:** #244 (`d9e18633`) and #245 (`f789d97d`), every required check green.
  - **The first attempt (about 22:02) was refused `registry-unmeasurable` (`disconnected`).** ccrc's PWA-driven update
    to v0.0.78 had restarted the fleet agent. Before any retry it was measured that nothing was spawned: no session on
    the run, and no new worktree or registry row. So the retry could not strand a workspace.
  - **That update ended `failed`, falsely.** `_upd_sweep` verifies each restarted supervisor in turn, and
    `verify-service.sh` holds each for 3 s plus 5 s, so 63 units take about 8.5 minutes. `still-summit` was archived by
    hand at 22:10:51, inside its own window, and the sweep died with "did not stay up". The fleet box is on v0.0.78
    with every supervisor active. The server box stays on v0.0.76 until the failed row is acknowledged. Reported to
    the operator and to the update-management coordinator.
  - **The brief was re-dated at dispatch.** #215 merged at `b40f4145` (22:10) before it, so the overlap line now says
    the branch already carries it and the plan's anchors in its files must be re-measured.
- **2026-10-05 10:00 — wave 3's wave-done** (mail 3457; PR #248 at `3f9cca09`): the plan's five tasks, the
  amendment, and 3906–3915 defined. 3916–3920 are unused.
  - **Re-measured:** the tip matches the claim, and every required Linux check is green. The worker's reds are load
    (each green alone) or tmp-sweep, which is red on main. The run went to `awaiting-review`, and its five items were
    settled.
  - **Review run 267** is dispatched to `ccrc-pwa-bright-hollow`.
  - **Open, ruled after the review (mail 3421):** over the cap, gh's own flags between the words
    (`gh -R o/r pr merge 42`) pass, where main denies them. That is a regression against main, so under the
    stopping line it will be CLOSED in the fix round, with a spare. The worker proposes a linear closure: split the
    raw text on separators, then test each segment. Review 267 costs it first.
  - **macOS (mail 3461, from bright-river).** session-hook-merge-deny fails 20 of 71 cases on test-macos in a full
    run on main, and 22 of 82 on #248. Every one is a merge after a heredoc or quoted substitution that is not
    denied: the deny fails OPEN on macOS. It blocks the stable gate. Review 267 diagnoses it from the job logs, and
    the fix round owns it.
  - **Main moved** under the branch (#247, #249, #246). #246 edits coordinator-skill.test.ts; the review judges the
    merged tree.
- **2026-10-05 10:40 — review 267 reported** (mail 3504; `~/.cc-clips/ccrc-pwa-bright-hollow/review-267-3f9cca09.md`).
  - **What it found:** six findings. All suites are green apart from one doctor case that fails under load and passes
    alone. Every mutation row matches the worker's table. The merged tree is clean.
  - **F1 gates Task 7. The macOS fail-open is jq 1.8, not macOS.** At session-hook.sh:3590, jq 1.8 binds `as $wp` to
    the whole `and` chain, so `startswith(true)` errors and the deny fails open on every heredoc. Reproduced on Linux
    with jq 1.8.1 and 1.8.2: 22/82 at the tip and 20/71 on main, the macOS counts. A one-paren prototype passes
    82/82 on jq 1.7, 1.8.1 and 1.8.2. This fleet runs jq 1.7.1, so it is not live here; it would be on any box with
    jq 1.8.
  - **F2:** doctor's `jq_regex` PASSes on jq 1.8, so the runbook's PASS read overstates.
  - **F3:** the over-cap flag shapes are a regression against main. The worker's `splits` closure is NOT linear on
    jq 1.7 (43 s at 100 KB). A fixed-string split variant runs in 60–234 ms, catches all four shapes, and costs +12
    over 129 over-cap matches in two days.
  - **F4–F6 are minor:** two over-cap mutations survive; the runbook grep does not prove 2048; README and plan text
    residue.
  - **Not yet ruled:** this report also lacks the refute pass (the same brief omission). Mail 3505 asks for it, and
    review 267 stays open until it arrives.
- **2026-10-05 11:01 — review 267 ruled; fix round 1 sent** (mail 3507). The review run closed `done`, keeping its
  workspace.
  - **The panel** (votes in `review-267-3f9cca09-panel.md`): 18 Sonnet refuters, none died.
    - CONFIRMED: F1, F3, F4, F5, F6.
    - REFUTED: F2. `jq_regex` claims only that a regex engine is present, and that is true.
    - The panel's three lenses were the reviewer's own single read, as in review 268. That is accepted for a fix
      round only; the re-review runs the panel as written before the wave is accepted.
  - **Rulings:**
    - **F1 (3916):** the jq 1.8 paren fix, now, because it gates Task 7. Also a structural pin against any `as`
      bound after a binary operator, and the jq floor named in the header.
    - **F3 (3917):** the over-cap flag shapes are CLOSED, with the reviewer's fixed-string split (never `splits()`,
      which is superlinear on jq 1.7), timing pins at 100 KB, and the +12 false-deny cost accepted. The bare
      backtick stays listed.
    - **F4:** two test cases.
    - **F5:** the runbook reads `^MERGE_PARSE_CAP=2048$`, names the jq floor, and gains a CANARY read for Task 7: the
      installed hook must deny a heredoc followed by `gh pr merge` in a fixture HOME. That canary, not
      `PASS jq_regex`, is what proves the deny on a box's jq.
    - **F6:** README's `jq_regex` row, and the plan's text brought to the shipped rule.
  - **Numbers:** 3918–3920 stay spares.
  - **For the stable gate:** F1's fix should also clear session-hook-merge-deny's macOS reds (bright-river's mail
    3461), because the macOS runner's jq is 1.8.2.
- **Deviation blocks** are minted per wave, at that wave's run-open, by the coordinator. No `D-` token appears in
  this file until a plan on the same ref defines it (`deviation-refs.test.ts`).

## Carried constraints

- **CI test selection landed first (#183, `814fc53d`).** Wave 2's re-plan derives its `ci.yml` edits against that shape
  rather than overwriting it: a `merge_group` run keeps a run-unique concurrency group (never the shared push-to-main
  refresh group, which may drop runs), the mode table gains a `merge_group` row, the macOS legs and `full-suite` skip a
  queue run, and the queue runs the selected tests (ruling 2026-09-28).
- **The skill pins move with the clauses.** `worker-skill.test.ts`, `coordinator-skill.test.ts`, and the
  clause-count words in `README.md` and `CLAUDE.md` that both pins read move in the same commit as a clause.
  session-continuity wave 8 appends its clauses after this programme's wave 1.
- **The hook is a contract, not an access boundary.** Identity on the fleet is attribution; the fleet's single
  GitHub login holds the admin role (R9).
- **From wave 1's rulings (2026-10-02).**
  - Wave 2 widens the `update-branch` absence set to `ccd/ccrc-*`, `ccgpt-*` and `install-*.sh`.
  - Stage 2's `main-red` counts trusted full runs only, and a window with none is unmeasured.
  - Stage 4 bounds clause 16's triggers 1–2 at wave-done through clause 9's exception.
  - Stage 5 writes the report-less fix round from `merging`.
  - Every brief names the repo-wide guards in each task's suite run.
  - **The sync advisory's spelling refinements (review 228 F4–F7).** A later landing wave owes:
    - silence for a main checkout updating itself, which is routine for coordinators;
    - a word in command position before `git`;
    - redirections glued to the target;
    - `~N`/`^N`, `refs/remotes/origin/main`, `main:main`.

    Each needs a pinned case and a timing check.
- **From wave 2's review (241), carried:**
  - a closed-unmerged PR reads `unmeasured` on every sweep, though its line already carries `phase: closed`;
  - a doctor check for jq's lookaround, so the deny's Oniguruma fail-open becomes a visible FAIL;
  - an optional cap on the payload the deny inspects (its 200 KB shapes run 1.4–2.9 s);
  - the no-`--squash` assertion's exact-text match on #178's span, which is brittle but not blind.
  Task 7's runbook names the deny's listed pass classes as its known limits before the operator relies on it.
- **The deny's stopping line (2026-10-03, review 247).** The hook's `gh pr merge` deny is contract-grade. A later
  wave closes a bypass only if it is a regression or an ordinary spelling, and lists a deliberate evasion. Task 7
  starts only once its runbook carries the listed classes, the payload cap and a quote-dense timing pin.
- **SAFETY.** Never a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`,
  `~/.cc-limits` or `claude-session@*.service` directly; fixture HOMEs only in tests; `gh` stays off the exec
  whitelist; never print secret contents.

## Next-wave brief

Waves 1 and 2 are merged (#231 `10f32755`, #234 `0087a045`).

**Task 7 (the operator's: the queue ruleset, approvals at 0, the proof run) WAITS.** It starts only once these
preconditions are on `main`:
- the deny's listed classes in its runbook (done, in #234);
- a payload cap on what the deny inspects;
- a quote-dense timing pin;
- review 249's F1, a live H40 row whose payload has a terminator.
Until then, nothing in #234 changes how a PR lands.

Run 250, wave 3, is dispatched (2026-10-04 22:21, `ccrc-pwa-still-delta`; deviation numbers 3906 to 3920, written
bare). It is the small preconditions wave:
- review 249 F1–F4;
- the payload cap and the quote-dense timing pin, with the coordinator's word-bounded over-cap amendment;
- the review-241 carries: closed-unmerged reads `none`, the doctor check for jq's lookaround, and the `--squash` span;
- Task 7's runbook text.

Then, in order:
1. ccrc's updater moves both boxes onto wave 3's build;
2. a trusted full CI run passes on `main`;
3. this coordinator runs Task 7 (delegated 2026-10-04 12:41).

**Wave 3b (stage 3, `ccd-land-probe`)** is planned after wave 3 merges.
- **Wave 2b** (deny `--admin` and `gh api` merges fleet-wide) is planned only on Task 7's proof result.
