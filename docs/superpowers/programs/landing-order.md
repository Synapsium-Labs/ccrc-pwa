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
| 2 | 2, repository code | `ci.yml` gains `merge_group`, the macOS skip and a `pull_request` concurrency group; `pr-state`'s `queue` field; the dequeue feed event and coordinator mail; the hook denies `gh pr merge` to workers; clause 15's native-queue sentence | ccd, hook, server | wave 1; child-reclamation wave 3 | #234 | awaiting re-review (fix round 2 at `7e3b30bc`; review run 249 dispatched 2026-10-03 17:51) |
| 2b | 2, the bypass deny | the hook denies `--admin` and a `gh api` merge call in every fleet session | hook | the operator's queue ruleset, approvals at 0, and the proof run | — | to plan |
| 3 | 3 | `ccd-land-probe`, the read-only conflict radar, and its opt-in mirror | ccd, deploy | — | — | to plan |
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

Waves 1 and 2 are planned and reviewed; once the docs PR has merged, dispatch wave 1 on a fresh workspace with its
plan path and this file. Wave 2 needs wave 1's clause 15 to append its native-queue sentence to, and is dispatched
once wave 1 has merged; its dispatching coordinator re-measures Tasks 2–5 on the `main` it cuts the workspace from
(the plan's status block). After wave 2
merges, the operator applies the ruleset and approval change and runs the proof (spec §5.2 steps 2–3); wave 2b is
planned and dispatched only on that proof's result.
