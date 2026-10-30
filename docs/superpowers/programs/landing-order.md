# Program: landing-order

Spec: `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`
Plans: `docs/superpowers/plans/2026-09-2?-landing-order-wave<N>-*.md` — each written once the waves it depends on
have landed what it reads
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-quiet-river` (assigned by the operator 2026-10-02)   Workspace: **a fresh one per wave**
Ticket: GitHub issue #198 (mirrored from the tracker) — the coordinator is created from it
Companion programme: `docs/superpowers/programs/session-continuity.md`

**What this program is.** The fleet manufactures main churn — ritual syncs, `update-branch`, repeat absorptions —
and lands in whatever order merges happen to arrive, testing no composition. This programme stops the churn,
makes landing order a recorded fact, and lets the coordinator land a tested composition. **The coordinator
merges, workers never do, and an unattended landing is the goal when every safeguard holds** (spec §3, R5 as amended 2026-10-25). The operator's rulings are the spec's §3
(R1–R10); every §11 decision was ruled on 2026-09-23.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 | worker clause 16 and coordinator clause 15 with their pins and count words; the PreToolUse advisory on syncs of `main`; `ccrc restamp`; `update-branch` pinned absent from executable source and counted in the skills | skills, hook (fleet box) | — | #231 | merged 2026-10-02 (`10f32755`); run 218 closed; deploy AGENT-FIRST by the update mechanism |
| 2 | 2, repository code | `ci.yml` gains `merge_group`, the macOS skip and a `pull_request` concurrency group; `pr-state`'s `queue` field; the dequeue feed event and coordinator mail; the hook denies `gh pr merge` to workers; clause 15's native-queue sentence | ccd, hook, server | wave 1; child-reclamation wave 3 | #234 | merged 2026-10-03 (`0087a045`); run 238 closed; deploy via ccrc's updater (fleet-first measured safe); Task 7's proof run 2026-10-20 stopped by stop rule 3 (Decisions, 2026-10-20 13:00); its re-run on 2026-10-21 turned the queue on, and it stays on by the operator's ruling after stop rule 6 (Decisions, 2026-10-21 12:15) |
| 2b | 2, the bypass deny | the hook denies `--admin` and a `gh api` merge call in every fleet session | hook | the operator's queue ruleset, approvals at 0, and the proof run; wave 3d; wave 3e | plan #1678 | planned 2026-10-27 (`docs/superpowers/plans/2026-10-27-landing-order-wave2b-bypass-deny.md`, D-7111 to D-7116; amended by #1753 with the operator's per-project allowance, D-7249); run 1144 (the run's wave 8) dispatched 2026-10-29, once wave 3e had merged and another programme's worker, on the operator's instruction, released its claim on `ccd/session-hook.sh`; block 7309–7318; PR #1863; fix round 1 after review 1184; accepted on `e0a57a94` after review run 1195 and merged through the native queue as `d3250900` (Decisions, 2026-10-29 09:41); D-7309–D-7315 defined after the merge; deploy and live check wait (Next-wave brief) |
| 3 | — | Task 7's preconditions (the payload cap, the quote-dense timing pin), wave 2's residue, Task 7's runbook text | hook, ccd, doctor | wave 2 | #248 | merged 2026-10-07 (`9a255a74`); run 250 closed; deploy AGENT-FIRST via ccrc's updater, then Task 7; run 250 (`ccrc-pwa-still-delta`); block 3906–3915 + 3916–3920 |
| 3b | 3 | `ccd-land-probe`, the read-only conflict radar, and its opt-in mirror | ccd, deploy | wave 3 | plan #1678 | planned 2026-10-27 (`docs/superpowers/plans/2026-10-27-landing-order-wave3b-conflict-radar.md`); run 310 (the run's wave 4) dispatched 2026-10-27 on `ccrc-pwa-clear-ridge`, block 4326–4335; PR #1740; fix rounds 1–5 after reviews 1109, 1125, 1140, 1143 and 1158; accepted on `8190c6df` after review run 1171 and merged through the native queue as `3ca67389` (Decisions, 2026-10-29 06:01); D-4335 and D-7382–D-7400 defined after the merge; deploy and live proof wait (Next-wave brief) |
| 3c | — | Task 7's re-run preconditions: `pr-state`'s per-workspace git cost, a sweep failure the server reports, the two suite flakes the queue turned into removals, the runbook's re-run changes | ccd, server, tests, plan text | wave 2's proof run | plan #974; #1046 | merged 2026-10-21 (`4ce282f8`) after reviews 718, 724 and 726 and two fix rounds; run 710 (the run's wave 5) closed; its block of 10 defined in the plan; deployed 2026-10-21 by ccrc's updater, fleet box first (v0.0.508); Task 7's re-run followed (Decisions, 2026-10-21 12:15) |
| 3d | 2, the lane | the dequeue lane treats the removal GitHub records at a successful queue merge as no dequeue: `pr-state` reads the removal's `reason`, and a removal whose reason is `merged` reads `landed`, never `dequeued`; any other reason, or none, is still announced on its first read; no two-sweep wait, no new wire field, no reason allowlist; and the `merged` feed record is kept once per workspace and PR across a server restart (stop rule 6; Decisions, 2026-10-21 14:49) | server, ccd | Task 7's re-run | plan #1088; #1096 | merged 2026-10-21 (`e173c1aa`) through the merge queue after review 759, with no fix round; run 751 (the run's wave 6) closed; three numbers of its block of 10 defined in the plan; deploy via ccrc's updater (either box first, the fleet box by default), then the live proof (Decisions, 2026-10-21 19:17) |
| 3e | 2, the landing route | the coordinator reads the repository's own rules before each landing: the merge method from every effective `pull_request` rule and the merge settings, the required checks from the rulesets and classic protection (confirmed absence apart from an unreadable read), three routes (the native queue, a gated direct merge, an ungated direct merge), a merge-commits-only repository landing with `--merge` at the reviewed head, and every conflict a stop (spec §5.7) | skills, tests | wave 3d | plan #1121 | §5.7's text approved 2026-10-22; planned 2026-10-22 in `docs/superpowers/plans/2026-10-22-landing-order-wave3e-landing-route.md` (Decisions, 2026-10-22 07:13); run 774 (the run's wave 7), PR #1127; fix rounds 1–6; accepted on `c8b56b8e` after review run 1141 and merged through the native queue as `7e38b5f4` (Decisions, 2026-10-28 19:12); D-6336–D-6345; live proof complete 2026-10-29 (Decisions, 2026-10-29 06:01) |
| 3f | — | the server's checks word reads a queued or running check run as `pending`, not `pass`; the cost of the 30 s sweep cadence is measured in its plan (spec §5.7.8) | server | wave 3e | #1383 | ruled 2026-10-21; the fix shipped from outside the programme in #1383 (`5a009277`, 2026-10-25); the cadence-cost measurement is left (Decisions, 2026-10-29 09:41) |
| 4 | 4 | the opted-in lineage table; `lineage-unmeasured` | server | waves 3b and 3e | plan #1678 | planned 2026-10-27 (`docs/superpowers/plans/2026-10-27-landing-order-wave4-lineage-acceptance.md`, D-7102 to D-7110; amended 2026-10-28, D-7268 and D-7269); run 1189 (the run's wave 9) dispatched 2026-10-29, block 7433–7442, with the coordinator's rulings on where the plan had drifted from `main` (Decisions, 2026-10-29 09:41); PR #1884; fix round 1 after review 1212; accepted on `5aa30a97` after review run 1216 and merged through the native queue as `f6b67a5b` (Decisions, 2026-10-29 17:38); D-7433–D-7442 and D-7464–D-7467 defined after the merge; deploy, arming (the operator's) and the live proof wait (Next-wave brief) |
| 4b | 3, the console half | the radar's server reader, its wire field `FleetSession.landing` and the PWA predicted-conflict chip (moved out of wave 3b, D-4329) | server, pwa | waves 4 and 4c | #1923 (plan #1906) | planned 2026-10-29 (`docs/superpowers/plans/2026-10-29-landing-order-wave4b-radar-console.md`, D-7477 to D-7484; Decisions, 2026-10-29 18:40); run 1224 (the run's wave 12) opened and dispatched after wave 4c merged, before run 1219 closed (Decisions, 2026-10-29 22:55); sent back once after review run 1225, accepted on `38bcaf1e` after review run 1226, and merged through the native queue as `85d61aa8` (Decisions, 2026-10-30 02:32); D-7514–D-7523 defined in its departures note, and D-7526 after the merge |
| 4c | 4, hardening | the lineage hardening carried from wave 4's reviews (Carried constraints), kept apart from 4b so that no PR mixes an acceptance change with a display change (D-4329's reason) | server, skills | wave 4 | #1911 | run 1219 (the run's wave 10) opened 2026-10-29 as planned, before run 1189 closed, under the title "wave 4b: lineage hardening" given before this row was split from 4b (Decisions, 2026-10-29 17:38); planned 2026-10-29 (`docs/superpowers/plans/2026-10-29-landing-order-wave4c-lineage-hardening.md`, D-7469 to D-7476); the coordinator-side re-proof moved to the operator (Decisions, 2026-10-29 18:40); accepted on `0a9ff1b2` after review run 1220, then one clean merge of `main` reviewed alone (run 1223), and merged through the native queue as `9ec4fc54` (Decisions, 2026-10-29 22:55); D-7486–D-7495 defined after the merge |
| 5 | 5 | the landing line: entries, intents, holds, `land-candidate`, the coordinator's pinned merge, the PWA doors | server, ccd, skills, pwa | waves 2–4; session-continuity wave 1 | — | split 2026-10-30 into sub-waves 5b to 5k (Decisions, 2026-10-30 23:24); run 1227 (the run's wave 13) opened 2026-10-30, before run 1224 closed (Decisions, 2026-10-30 02:32) |
| 5a | 3 and 4, hardening | the hardening that the reviews of waves 4c and 4b, and three older review items (1141, 1216, 1222), carried forward: the lineage parser, the radar lane, the chip's words, and text and pins (Carried constraints). Kept apart from 5 so that the landing line's PR carries only its own data, routes and verb (D-4329's reason) | server, pwa, skills | waves 4c and 4b | #1960 (plan #1944) | planned 2026-10-30 (`docs/superpowers/plans/2026-10-30-landing-order-wave5a-carried-hardening.md`, D-7528 to D-7539; Decisions, 2026-10-30 03:40); run 1228 (the run's wave 14) opened 2026-10-30; reviewed once (run 1232) and accepted with no fix round; merged 2026-10-30 (`d196d8b3`); five departures, D-7544 to D-7548, in `docs/superpowers/plans/2026-10-30-landing-order-wave5a-departures.md` (Decisions, 2026-10-30 08:16) |
| 5b | 5, skill text | the new-head route is the coordinator's own act (the operator's answer to D-7536's question), the evidence that a red is `main`'s own, the report-less fix round from `merging`, review 1232's F9 (a) and (c), and **A requested change** against clause 19; D-7546's restatement is a droppable task, held for the operator | skills | wave 5a | — | planned 2026-10-30 (`docs/superpowers/plans/2026-10-30-landing-order-wave5b-landing-skill-text.md`, D-7588 to D-7592; Decisions, 2026-10-30 23:24) |
| 5c | 5, landed state | `ccd pr-state --project <p> --pr <n>`: its five words, its train proof and its capability token; the server's words, reader and capability-gated brand; wave 3d's F1 and F6 text and review 1109's paged rules read | ccd (fleet box first), server | wave 5a | — | planned 2026-10-30 (`docs/superpowers/plans/2026-10-30-landing-order-wave5c-pr-keyed-pr-state.md`, D-7593 to D-7599; Decisions, 2026-10-30 23:24) |
| 5d | 5, the lander key | the radar's conf accepts `lander=coordinator` or `none`, mirrored to a marker the server reads | ccd (fleet box first) | — | — | to plan; waits on the operator's question 3 |
| 5e | 5, the line's core | `landing_entries` and `landing_projects`, the `landing.log` journal and its replay, an entry pinned at `advance → merging`, ejection and the second-ejection ask, the order and hold decider, and the coordinator's read of the line | server, skills | wave 5a | — | to plan |
| 5f | 5, attributed writes | `POST /api/landing/entries` and `POST /api/landing/order`, `setBy` and their feed events | server, skills | 5e | — | to plan |
| 5g | 5, intents | dispatch's `intents[]` and `intent-held`, in a table of their own | server, skills | 5e | — | to plan |
| 5h | 5, the landed reader | the lane that walks the entries with 5c's form, apart from `sweepMerged` | server | 5c on the fleet box, and 5e | — | to plan |
| 5i | 5, the line's head | `mainRedHold` from the radar's `main-health`, the next-to-land mail, and the reader of 5d's marker | server, skills | 5d on the fleet box, 5e and 5h | — | to plan |
| 5j | 5, the doors (server) | the two session-only routes, pause the line and withdraw an entry, and `landing-subtractive.test.ts` | server, skills | 5e and 5i | — | to plan |
| 5k | 5, the doors (PWA) | the line on the project card, the pause control and the withdraw sheet | pwa | 5j | — | to plan |

**A fresh workspace per wave (R4) is child-reclamation's.** The spec first drew it as step 6 of the wave lifecycle,
gated on #166 wave 3. #166 wave 2 (#178) made it live on `main` as "One PR per child", so wave 1 no longer
carries it (spec §5.1, amended 2026-09-24).

## Decisions & deviations

- **2026-09-23 — the design, its rulings and the written spec.** Approved in the brainstorm (R1–R8); the operator
  ruled both open decisions on the written spec the same day: break-glass keeps the repository-admin role as the
  ruleset's only bypass actor (R9); strict protection comes off project-n and project-e after a week of
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
- **2026-10-05 11:00 — review 267 ruled; fix round 1 sent** (mail 3507). The review run closed `done`, keeping its
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
- **2026-10-05 11:05 — F3 reshaped** (the worker's question 3508, answered by 3510). Once the segment rule exists,
  it matches every shape bash runs that MERGE_OVERCAP_RE matches. The regex is therefore redundant, and its
  mutations can only red when composed with another.
  - **Ruling:** RETIRE MERGE_OVERCAP_RE. The fixed-split segment rule stands alone, with a word-bounded `gh`, and
    every single-row mutation goes red.
  - 3915 is restated as history, superseded by 3917.
  - The newline-separated `gh`/`pr`/`merge`, which only the regex matched, is three commands to bash, so it is
    pinned as a pass.
- **2026-10-05 12:08 — the split list narrowed** (the worker's question 3512, confirmed). Splitting on `( ) < >` cut a
  flag VALUE away from the words. So `gh -R "$(git remote get-url origin)" pr merge 42`, an ordinary spelling that
  main denies, passed over the cap.
  - **The segment rule now splits only on `; & |` and newline,** and `merge`'s end class widens to `( ) < >`.
  - A `;` inside a quoted flag value (`gh pr -R "a;b" merge`) is LISTED as deliberate.
  - The worst over-cap shape costs about 600 ms through the hook at 100 KB, about 40% of the 1500 ms bound. It is
    pinned, and stated as such.
- **2026-10-05 15:48 — fix round 1 done** (wave-done 3535, PR #248 at `2324053a`).
  - **CI is fully green,** both test-macos legs included: Homebrew jq 1.8.2, merge-deny 120 cases.
  - **F1 (3916) `94459248`:** the paren, and a structural pin over 52 jq programs. Merge-deny is 120/120 under jq
    1.7 and 1.8.2.
  - **F3 (3917) `60c22193` and `1804eaa6`:** MERGE_OVERCAP_RE is retired. A fixed-string split on `; & |` and
    newline, then in-order word tests, denies the four flag shapes and the six flag-value shapes. Six 100 KB timing
    pins run at 90–384 ms.
  - **F4:** the operator and TAB cases.
  - **F5 `762d572a` and `5d29390c`:** the Task 7 CANARY runs the installed hook in a fixture HOME and expects a
    deny. It was verified to deny on jq 1.7 and 1.8.2, and to catch the old hook failing open on 1.8.2.
  - **F6:** README's `jq_regex` row, and the plan's text brought to the shipped rule (the replay is byte-identical).
  - **Main merged** (clause 16 trigger 1, the stamp line). 3918–3920 are unused.
  - **The worker's ledger notes**, for the review to classify:
    - (a) any jq runtime error passes the deny. The candidate: fail CLOSED in a held or child session whose payload
      holds `merge`.
    - (b) doctor's `jq_regex` PASS text claims too much.
    - (c) a NUL makes bash warn.
  - **Re-measured:** the tip matches the claim, and the run went to `awaiting-review`.
  - **Acceptance review 273** is dispatched to `ccrc-pwa-quiet-mesa`, with the held-out panel named.
  - **Overlap:** delegation-broker's run 271 is cleared by this worker to edit session-hook.sh.
- **2026-10-05 15:49 — Task 7, read through (Steps 1–7, from the branch's wave-2 plan) before it is due.** Three things gate
  it beyond the sequence above:
  1. **Step 5 needs five PRs bound to fleet workspaces.** The runbook was written for the operator, as five
     `ccd ws-add`s. Coordinator clause 1 forbids this session a `ccd` act that changes fleet state.
     - Within the contract: dispatch five one-wave proof runs, each committing a one-line doc change and opening a
       PR. The server binds them, and reclaims them at close. The dequeue lane's mails, which the runbook says the
       proof cannot stage, would then be measured too.
     - Otherwise the operator makes the five.
     - Put to the operator.
  2. **Stop rule 4.** `allow_auto_merge` is false. If gh reaches a required queue only through the auto-merge
     mutation, the enqueue is refused, and the proof halts for the operator (ruling 2026-09-29). It is not this
     coordinator's setting to write.
  3. **After Step 4, this coordinator's landing spelling becomes clause 15's queue spelling:**
     `gh pr merge <n> --match-head-commit <sha>`, with no `--admin` and no `--squash`. Step 1's two box reads use
     `ccrc version` on each box (read-only). No `ccrc rollout`, even `--check`.
- **2026-10-06 04:55 — review 273 ruled; fix round 2 sent** (mail 3621). Report: `~/.cc-clips/ccrc-pwa-quiet-mesa/review-273-2324053a.md`.
  - **The panel ran as written:** 11 confirmed, 1 refuted, nothing unexamined, no lens unverified.
  - **The round is sound:** the suites are green under jq 1.7 and 1.8.2, every row reds, the canary behaves on both
    jq versions, and the hook replay is byte-identical.
  - **Rulings:**
    - F1 (important): a tight multi-byte fixture, so a byte-offset slice reds.
    - F2: the over-cap prose class is ACCEPTED and NAMED. THE COST sentence names any one segment holding `gh`,
      then `pr`, then `merge` as words, a one-line JSON mail body included. The refusal also names `ccrc-api mail
      send --json <file>` as the way to send a long mail. There is no narrowing, because a flags-only gap needs the
      nested quantifier the rule exists to avoid.
    - F3: absorb main (#281's README and doctor test, keeping both sides; #250's stamp), then re-gate under both jqs
      and re-run the canary.
    - F4: the fix round's rows go into the plan as JSON.
    - F5 (a)–(j): text and tests.
  - **The worker's ledger note (a), carried as an OPERATOR CANDIDATE:** today any jq runtime error passes the deny.
    A held or child session whose payload holds `merge` could fail CLOSED instead. Not this wave's.
- **2026-10-06 07:02 — `ccd/ccd` shared by region** (mail 3648, for the record). Run 250's claim 1043 keeps the stamp and
  its `pr-state` lines. Runs 245 and 274 edit their own regions of `ccd/ccd` without a claim. The second to land
  merges main and re-stamps. Fix round 2 is unchanged.
- **2026-10-06 07:27 — fix round 2 done at `6850f261`** (wave-done 3650; three commits, plus a merge of main at
  `21f536a5`; no new number, 3918–3920 unused).
  - **What landed:**
    - F1: the tight multi-byte fixture; row MB reds 1 of 123 on jq 1.7 and on 1.8.2.
    - F2: THE COST sentence names the accepted class, and the refusal names `ccrc-api mail send --json <file>`;
      row F2P reds 3.
    - F3: main merged; README and the doctor test keep both sides; only the stamp line was resolved by hand.
    - F4: the rows are in the plan as JSON.
    - F5 (a)–(j): text corrections.
    - Claim 1043 released.
  - **Re-measured:**
    - The tip matches the claim, and the four required checks are green (CI 37427142508).
    - #248 merges clean onto `9221416a` (#291).
    - The canary denies on the merged hook under jq 1.7 and 1.8.2.
  - **Run state:** the run went to `awaiting-review`, with its items already settled.
  - **Acceptance review 289** is opened, and its brief names the held-out panel. Its dispatch was refused `cap-daily`
    (24 of 24 in the rolling day). It dispatches when run 266's dispatch ages out at 07:47.
  - **2026-10-06 07:49 — review 289 dispatched** to `ccrc-pwa-bright-summit`. The tip was re-read first and is still
    `6850f261`.
  - **Merge order with #286:** whichever acceptance lands first merges first. The second merges main and
    re-stamps `ccd/ccd`, by the shared-region ruling.
- **2026-10-06 20:21 — review 289 ACCEPTED wave 3** (review-done 3656, reviewed tip `6850f261`; report copied on receipt).
  This session's mail was held for about twelve hours behind a background planning workflow, so 3656 was read only
  at 20:15.
  - **The verdict:** 15 agents, no unverified lens. 4 confirmed and 0 refuted. Six findings, all minor and text-only.
    Everything the brief asked holds: MB 1 and F2P 3 on both jqs; the accepted class in both directions; the canary
    deny/deny and fail-open on 3f9cca09; 54 deny shapes still denied; ordinary commands pass.
  - **The landing round was sent** (mail 3751; run 250 back at `working`):
    - `git merge origin/main`, where only `ccd/ccd`'s stamp conflicts (#286), then re-stamp;
    - the text fixes F1–F4 and F6, with no number;
    - the re-gate, and the canary on the merged hook.
  - **F5, the stale PR #248 body, is the coordinator's.** I re-write it from the plan's Task 5 text before merging.
  - **ccrc-history** (quiet-ridge's runs 293 and 302) edits README, the doctor checks and deploy.sh. It has consent
    (3750); the second lander merges main.
- **2026-10-06 23:31 — the landing round is done at `cf0170e7`** (wave-done 3771). It merged main twice, because main moved
  during the first re-gate: `b27fabc15`, then `8d85c7cf4`. Each time only the stamp conflicted, with README's SKIP
  sentence kept both ways. The text fixes F1–F4 and F6 landed. The re-gate on `cf0170e7` was all green on the first
  run: canary deny/deny on jq 1.7 and 1.8.2, fail-open on 3f9cca09 under 1.8.2. The four required checks are green.
  The round's own commits are text only (verified).
  - **Main moved a THIRD time** (#299, `1bb88d5e`, the coordinator's merge). #248 conflicts on ccd/ccd's stamp line
    ONLY (merge-tree). Clause 16 allows one absorb per conflict, so a **merge-only round** names #248 NEXT TO LAND
    (mail 3772): merge, re-stamp, and a narrow re-gate. CI is the arbiter for the doctor and install files #299
    changed. Nothing else of this coordinator's that touches ccd/ccd merges before #248.
  - **F5 is done:** #248's description was re-written from the plan's Task 5 text, with the jq 1.8 fix and the
    canary added, through the REST API, because `gh pr edit` fails on GitHub's retired classic-projects field. The
    retired regex and "gh's flags pass unparsed" are gone from it.
  - **Lesson for ccd/ccd waves:** every merge to main that changes ccd/ccd re-conflicts every open ccd/ccd PR on the
    generated stamp line. Land them one at a time, each with a merge-only round just before its merge.
- **2026-10-06 23:53 — the merge-only round is done at `eb6cb5a0`** (wave-done 3773). It is one merge commit, of main
  `1bb88d5e`, where only the stamp conflicted. The narrow re-gate was green, including the canary deny/deny. Landing
  3b is opened as **run 310** (the run's wave 4, planned; block 4326–4335, written bare), ready for wave 3's final close.
  - **CI is red on one test,** `pools-prose`'s README size ratchet. Main's README is exactly 5,800 lines, at the edge
    against CLAUDE.md's "~5700". #248 adds one line, making 5,801. The test asks the PR that crosses the edge to
    re-measure, so fix round 5 (mail 3774) makes ONE line of CLAUDE.md read `~5800`.
- **2026-10-07 00:26 — wave 3 MERGED: #248** (`9a255a74`, squash at 00:24 UTC). Fix round 5 (wave-done 3782, tip `4c8f8048`)
  is the one CLAUDE.md line, `~5800`, made with quiet-ridge's consent over claim 1055 (mail 3779). Verified before the
  merge: the commit is that line alone, all four required checks green on `4c8f8048` (macOS legs advisory), the head
  unchanged and merge-tree clean against main `1bb88d5e`.
  - **Runs:** 250 advanced to `merging`, then closed final (`merged`). Its child reclaim is deferred, because the
    programme still holds the workspace while run 310 (wave 3b) is open.
  - **Task 7, in order:** (1) both boxes carry `9a255a74` (the operator applies dev builds from the console; the time
    is recorded here); (2) a trusted full CI run on `main`; (3) Task 7 Steps 1–7 from the wave-2 plan's runbook, canary
    first, with the rollback JSON written before the first ruleset write. Wave 2b follows the proof run.
- **2026-10-07 00:33 — Task 7's sequence, ruled.** The operator delegated Task 7 to this coordinator on 2026-10-04 ("Run
  task 7 when you think it's most appropriate").
  1. **Step 1.** It waits until both boxes run a build containing `9a255a74` (v0.0.111 or later). The trusted full run
     is 37552120108, a `workflow_dispatch` on `9a255a74` started at 00:28. Then the canary, the census and Step 2's
     reads.
  2. **Step 4,** the ruleset write. The coordinator keeps `ruleset-rollback.json` in its evidence folder.
  3. **(a0) runs FIRST,** on the coordinator's next ledger PR (slot C), before any proof dispatch. If gh refuses
     because the repository has auto-merge off, that is stop rule 4. The proof halts and the operator decides. The
     queue stays on meanwhile: the admin bypass keeps every other programme's landing exactly as it was.
  4. **Only after a clean (a0),** the proof programme `landing-order-proof` is dispatched: three runs, each on a fresh
     workspace, with ledger `docs/superpowers/programs/landing-order-proof.md`. Their route is the matrix's docs row:
     Sonnet · medium, Haiku subagents, workflow off.
  5. **The proof itself:**
     - (a1) on slot D. The coordinator pushes an empty commit to start D's checks, then enqueues.
     - The three landings, A, B and C, enqueued within a minute, then readings (a)–(d).
     - (e) on slot D. The coordinator removes it from the queue with GraphQL's `dequeuePullRequest` (the same removal
       as the UI's button), then closes D unmerged.
     - (f) is in slot D's brief: its held worker runs `gh pr merge 248` once and reports the refusal.
  6. **Step 7** records every reading here, on its own ledger PR.
  - **Departures from the runbook, and why.**
    - Three dispatches instead of five. The fleet's rolling daily cap is full (24 of 24 at 00:30), and every proof
      workspace costs one dispatch. So the coordinator's own ledger PR is landing PR C, and (a1) runs on slot D before
      (e) instead of on a fifth PR. PR C is a workspace PR, so `is_ours` has a workspace to bind, and it is how every
      coordinator lands after this runbook.
    - The proof runs advance to `merging` before they are enqueued. So the lane's `merged:#<pr>` mail is measured
      too, which the runbook leaves to the first programme landing.
    - (d) is read before each run's final close, because the close reclaims the child workspace.
    - (e)'s feed body may not read "No open run names a coordinator to tell", because D's workspace belongs to an
      open run (at `awaiting-review`, not `merging`). It is recorded as found.
- **2026-10-07 01:39 — Task 7 Steps 1, 2 and 4 done: the merge queue is ON for `main` (ruleset write 01:38:37 UTC).**
  - **Deploy.** Wave 3 has been on both boxes since 2026-10-07 00:51 UTC. Both boxes run v0.0.112 (`543777fb`, which
    contains `9a255a74`), applied from the console: the fleet box finished at 00:51:18 and the server box at 00:51:42.
    Each box's `update.json` reads phase `done`, and `ccrc version` reads `install: complete` on both.
  - **Step 1.**
    - `merge_group` is on `main`'s `ci.yml` (`1`).
    - The trusted full run is 37552120108 (`workflow_dispatch` on `9a255a74`, five server shards). `typecheck (server)`,
      `server 1/5`–`5/5`, `test (server)`, `test (agent)`, `test (pwa)` and `build-pwa` all read `success`. The macOS
      legs are not read; one failed.
    - `MERGE_PARSE_CAP=2048` is in the installed hook (`1`). Doctor reads `PASS jq_regex`, with no FAIL line.
    - THE CANARY printed `deny` on the fleet box's `/usr/bin/jq`, jq-1.7.
    - The census read `census-done: 11 coordinator(s) checked`, with no MARKED or HELD line.
    - **Substitution:** both boxes were measured with `ccrc version` and `update.json` instead of
      `ccrc rollout --check --to v0.0.112`, because the operator's 2026-09-30 ruling forbids running `ccrc rollout`
      by hand.
  - **Step 2** matched the runbook's 2026-09-23 values:
    - Two rulesets: main's is 22520257, and stable's is 23740920.
    - Main's one rule was `pull_request` with 1 approval, and its bypass actors were roles 2 (maintain) and 5 (admin),
      both in `pull_request` mode.
    - Classic protection: `strict` false, the four required contexts, `enforce_admins` true, 0 approvals.
    - Repository settings: `allow_squash_merge` true, `allow_auto_merge` false, `allow_update_branch` false and
      `delete_branch_on_merge` true.
    - The only new reading is three parameters GitHub now reports on the rule, a schema addition:
      `allowed_merge_methods`, `dismissal_restriction` and `require_extra_approval_for_unattributed_changes` (true).
  - **Step 3 and Step 4.** Step 4a's diff showed exactly the three changes:
    - the maintain bypass (role 2) removed, as R9 ruled;
    - approvals 1 → 0;
    - the `merge_queue` rule added: SQUASH, build concurrency 1, group size 1–1, wait 0, ALLGREEN, timeout 60 minutes.

    Step 4b's PUT answered `rules: ["pull_request","merge_queue"]` with the one bypass actor (role 5), and a re-read
    shows the same. The ruleset's name still says "Admin and Maintain bypass", because the runbook's transform keeps the
    name. `ruleset-before.json`, `ruleset-rollback.json`, `ruleset-after.json` and `ruleset-written.json` are kept in
    the coordinator's evidence folder. The rollback is a PUT of `ruleset-rollback.json` to ruleset 22520257.
  - **Next: (a0) on this ledger PR (slot C)** once its own CI is green, then the proof dispatches.
- **2026-10-07 01:53 — (a0) hit STOP RULE 4. The proof halts, the ruleset is ROLLED BACK, and the operator decides.**
  - **(a0)** ran at 01:52:12 on this ledger PR (#311, slot C), with every required check green at `907cb649`.
    `gh pr merge 311 --match-head-commit 0000…` answered `GraphQL: Auto merge is not allowed for this repository
    (enablePullRequestAutoMerge)`, rc 1. The read-back showed `mergeQueueEntry: null` and `autoMergeRequest: null`:
    nothing was queued and nothing was armed. gh 2.45 reaches a required queue through the auto-merge mutation
    (Pre-flight finding 16), and the repository's `allow_auto_merge` is false (Step 2). The refusal names auto-merge,
    not the head, so it is stop rule 4, not (a0)'s pass. Under the operator's 2026-09-29 ruling the proof halts here.
    The coordinator does not change that setting (clause 15).
  - **The rollback, at 01:52:56.** This revises the sequence entry's "the queue stays on meanwhile", for this reason.
    On a native-queue project, clause 15 tells every coordinator to land with
    `gh pr merge <n> --match-head-commit <sha>`, never with `--admin`. With auto-merge off, that spelling can land
    nothing. So any ccrc-pwa coordinator following its clause literally could not land until the operator rules,
    while the proof can make no progress either way. `ruleset-rollback.json` was PUT back. A re-read is identical to
    it: the `pull_request` rule with 1 approval, and the maintain and admin bypasses. The queue was on from 01:38:37
    to 01:52:56. Nothing merged to `main` in that window (the last merge was #310, at 00:47).
  - **For the operator: three ways on.**
    1. **Enable "Allow auto-merge"** (Settings → General → Pull Requests). The coordinator then re-applies Step 4 from
       the saved `ruleset-after.json` and re-runs the proof from (a0). This is the path the runbook assumes: (a1)
       expects an armed auto-merge request. Held and child sessions are already denied every `gh pr merge`, `--auto`
       included, and wave 2b closes the `gh api graphql` mutations. **Recommended.**
    2. **Keep auto-merge off,** and land through the queue with a direct GraphQL `enqueuePullRequest` call that
       carries `expectedHeadOid`. That is not clause 15's spelling, so clause 15, the runbook and the hook's deny
       need a wave first.
    3. **Park Task 7,** and keep landing with `--admin` as now.
  - **Slot C (#311)** stays open, unmerged, until the operator rules. The proof programme `landing-order-proof` is NOT
    opened, and no dispatch was spent.
- **2026-10-20 13:00 — Task 7's proof run, stopped by stop rule 3; the queue is off.** This is Step 7's record.
  - **Arming.** The operator chose "Run Task 7 now" on 2026-10-20. Step 1 was clean: a trusted full run on `main`
    (daily run 39364571048), both boxes on one release, the payload cap in the installed hook, doctor's
    `PASS jq_regex`, the canary's `deny` and a clean census. Step 2's read differed from the runbook's in one setting:
    the repository allows auto-merge, an operator change covered by the ruling. Step 4 wrote the queue ruleset at
    08:59:54Z, removing the maintain role's bypass (Step 3) at both writes; each rollback restored it. The fleet's
    daily dispatch cap then refused the proof dispatches, so the coordinator rolled the ruleset back at 09:07:30Z
    (nothing had merged) and wrote it again at 11:53:33Z, once slots A, B and C were green and D was open. The queue
    was on from 11:53:33Z to 12:56:47Z.
  - **Departures.** Slot C was this coordinator's continuity ledger PR, #409, because its other ledger PR conflicted
    with `main`. The proof slots wrote new one-line files under `docs/superpowers/programs/landing-order-proof/`
    instead of the proof ledger's slot lines, which another run's claim held. Runs 690 and 691 went to `merging`
    before the enqueue, as ruled on 2026-10-07.
  - **Readings.**
    - (a0), twice (09:00 and 11:53), on #409: the wrong sha was refused ("expected head oid does not match the
      current head oid"), and nothing was queued or armed. Stop rule 7 did not fire.
    - (a1), on D (#965): an empty commit started its checks, and `gh pr merge --match-head-commit` answered rc 0 and
      printed nothing (no TTY). The read showed an armed auto-merge request (method MERGE), not a queue entry. A
      second empty push from the same login left the request armed: a push by the arming login does not disarm it,
      so clause 15's disarm rule carries weight. It was disarmed with `--disable-auto`. Both pushes were made
      outside D's workspace, so the PR's head left the workspace's own tip, and `pr-state` stopped binding D.
    - The enqueue: #942 (`abafcd696`), #963 (`d82ccb0e2`) and #409 (`b5efafba3`) within 9 s. Each entry read back
      non-null within about 2 s.
    - (a) while waiting: A and B read `open queued <time>`. C read `unknown`, its known branch drift.
    - (a2), (b), (c) and (d) were not reached: nothing merged.
    - **What stopped it.** At 12:01 another programme's ledger PR, #964, was merged through the admin bypass while
      the queue was on. `main` moved, and the queue rebuilt #942's group on the new base. In that group one server
      shard ran only `ccd-tick-diet-equivalence.test.ts` and hit the 30-minute job bound (run 39419159770). That
      shard is slow everywhere: measured while planning wave 3c, its median over the day's successful runs was 20.9
      minutes and its 90th percentile 26.7, and one pull-request run hit the same bound. GitHub removed #942 at 12:32:35Z (`failed_checks`), and the
      coordinator enqueued it again at 12:52:04Z, after reading why. #963's group failed in `fleetws.test.ts`:
      `ENOTEMPTY` from the `afterEach` removal of the test's home, which reads as a race with a write still landing
      (run 39423071534). GitHub removed it at 12:54:52Z (`failed_checks`). Neither failure was its PR's own.
    - **The lane was blind.** `ccd pr-state --project` read #942 as `dequeued 12:32:35Z`, correctly. Yet no `queue`
      feed event appeared and this coordinator got no `dequeued:` mail, although run 690 was waiting at `merging`.
      Measured afterwards, under heavy load: that call takes about 60 s on the fleet box, against the server's 25 s
      bound for `pr-state` (the same bound in both releases the boxes ran during the window). So most likely every
      sweep of this project timed out. That was not measured on the server side, because a failed sweep backs off
      as if the agent were down and logs nothing. The cost is in `ccd`: for each workspace, `is_ours` runs two `git` calls for every listed PR,
      while only the rows that name that workspace's own branch can ever bind it. The `merged:` notice could not be
      measured, and on this project neither notice wakes a coordinator until this is fixed.
    - (e), on D: enqueued, then removed with `dequeuePullRequest`; the timeline reads Added, then Removed
      (`manual`). No feed event appeared, which was expected twice over: D no longer bound, and the lane was blind.
      #965 was closed unmerged and run 692 closed.
    - (f): D's held worker ran `gh pr merge` and the wave-hold arm refused it, live. Pass.
  - **Stop rule 3 fired** on the second queue run that failed for a reason not its PR's own. After the first, the
    coordinator ruled it not fired: one slow file over a job bound, measured passing twice that hour. The second
    failure, and the blind lane, decided it: with no lane the proof could not be clean this round, so more queue
    time only exposed other sessions' landings. The ruleset was rolled back at 12:56:47Z, and its writable projection
    equals `ruleset-rollback.json` (one approval, both bypass roles). Landing is back on the pre-queue path.
  - **Finding: turning the queue requirement off drops every entry silently.** #409, #942 (enqueued again) and two
    other sessions'
    PRs (#936, #947) then read open, not queued and not armed, and each timeline's last queue act is still its
    `AddedToMergeQueueEvent`. GitHub records no removal, so no lane can announce one. This coordinator commented on
    #936 and #947.
  - **The 2026-10-07 order for slot D is superseded.** Running (a1) and then (e) on one PR spent (e): (a1)'s pushes
    unbound the PR. Wave 3c's runbook runs (e) on the fourth PR right after (a0), before (a1) and before any landing,
    and never runs (e) on a PR that (a1) has pushed to.
  - **State.** Runs 690 and 691 wait at `merging` with #942 and #963 open, unqueued, and their own checks green; they
    are held for wave 3c's re-run. Wave 2b is not planned, because the proof is not clean.
  - **Next: wave 3c, Task 7's re-run preconditions.**
    - `pr-state --project` reads each workspace's rows with one batched object check and one ancestry list, with
      the same answers.
    - The server reports a failed sweep.
    - The two flakes are fixed.
    - The runbook changes:
      - before arming, the project's sweep is measured finishing within its bound;
      - inside the window, (e) comes first, and a silent lane is a stop;
      - every entry is dequeued before any rollback;
      - a bypass merge during the window is recorded, not a stop.
- **2026-10-20 18:07 — wave 3c dispatched: run 710.** The plan merged as #974 (`afd71583`, squash at 17:31 UTC)
  after three plan reviews and a verification pass, all findings folded. Main's own citation ratchet was red on
  every pull request that afternoon (a count one below an exact baseline), so #974 waited for #988's fix and then
  merged main in. The dispatch at 17:33 was refused at the daily session cap and retried at 18:07.
  - **The run.** Run 710 is this programme's wave 5 on the server; the ledger calls it wave 3c. Run 310 (wave 3b)
    stays open and planned. A block of 10 deviation numbers was issued at run-open. The worker names each departure
    in its wave-done, and the coordinator defines the numbers at the wave's close, in the plan's Deviations found.
  - **Task order, by the claims at dispatch.** Two other runs held files this wave edits: run 308's worker held
    `ccd/ccd` (Task 1), and the path-identity worker held `server/src/watch.ts`, `shared/api.ts` and
    `server/test/single-definition.test.ts` (Task 2). So the brief runs Tasks 3, 4 and 5 first, Task 2 when its
    files free, and Task 1 when `ccd/ccd` frees. A worker that runs out of free tasks pushes, reports and waits.
- **2026-10-20 23:50 — wave 3c's wave-done, review 718, and fix round 1.**
  - **The wave-done** came back at `24f52cf0` (PR #1046). All six tasks were done, each with a clean task review,
    then a whole-branch review with fixes and its fix wave. Its suite line read red, which it put down to `boot`'s
    hung-ccd wall-clock case. Review 718 measured that case red on the merge base's source too and green in CI, so
    it is the box's.
  - **No pull-request CI ran.** The PR was opened while it already conflicted with `main` on `ccd/ccd`'s stamp, so
    GitHub made no merge ref to test. A full run at the tip (`workflow_dispatch`) was red on one server file,
    `collect-lane-prose`.
  - **Review 718** ran the held-out panel and two wave lenses, with no finding unexamined and no lens unverified.
    It found two important and nine minor findings. Three need a ruling:
    - F1: Task 2's two added lines in `shared/api.ts` moved a test-pinned citation in the child-reclamation
      spec's Appendix A. The wave re-anchored the README's citations but not this one, and it is the full run's red.
    - F2: the runbook's UI-armed by-hand path ran the rollback block's `exit 1` lines in the operator's own shell,
      and it stopped before the block's queue-empty and `seen` prints.
    - F3: the rollback block writes the ruleset even after a `STILL LISTED` line, against the letter of the
      carried constraint below.
  - **Fix round 1, as ruled:**
    - a land-sync merge of `main` first, on the stamp only, with the `ccd/ccd` holder's consent;
    - F1 re-anchored by content, with `collect-lane-prose` added to the gate;
    - F2's by-hand path runs inside the subshell, without the guard and without the write;
    - two new pins, for the sweep latch's change of reason and for an external signal (F4, F5);
    - the text fixes to a docstring, a comment, a moved docstring and the runbook's old function name (F6, F8,
      F9, F11), with F6 made only with the `ccd/ccd` holder's agreement.
    - F7 is a behaviour edit inside a docs-titled commit. Its answers are unchanged, as measured, so there is no
      history rewrite.
  - **F3 stands.** A rollback exists to unwedge the repository, so waiting on a `LOCKED` entry that never clears
    would defeat it. The carried constraint below now names that exception.
  - **Carried to a later wave (F10).** A failed sweep's log line carries no detail on the agent's deadline kill.
    So the plan's sentence that a reader can tell which case it was holds only for a call that never ran.
- **2026-10-21 02:12 — wave 3c merged as #1046 (`4ce282f8`); run 710 closed.**
  - **Fix round 1** came back at `a91a490c`. It merged `main` once, on the stamp only, under the `ccd/ccd` holder's
    consent, and it shipped every ruling, the docstring fix with the holder's own agreement.
    - Review 724 found five minor findings and no regression.
    - A full run at that tip passed on every leg, macOS included.
  - **Fix round 2** came back at `ca246c27`. It is three small items: the by-hand rollback restores the UI settings
    only after a run with no `STOP:` line, the proof record and the spec name `ours_of`, and a tip-null partner to
    test (g) is added. Its pull-request CI passed on every job.
    - Review 726 found six minor findings, four of them on the runbook's wording and one older behaviour, and no
      regression. They are carried below, not sent back: none blocks the re-run, and each is read by hand inside it.
  - **The merge.** It was a squash at the reviewed head, through the admin bypass, at 02:11 UTC. Before it, a
    scratch landing merge with the newer `main` (#832 had also edited `server/src/watch.ts`) type-checked, and its
    citation, prose, sweep and compaction-card suites passed.
  - **The close.** Run 710 closed done and released its workspace. The wave's ten numbers are defined in the plan's
    Deviations found, with the measured counts and the review rulings.
- **2026-10-21 12:15 — Task 7's re-run: the queue is on, stop rule 6 fired, and the operator kept it on.**
  This is Step 7's record of the re-run.
  - **The deploy.** The operator applied v0.0.508, which carries wave 3c, from the console. The fleet box finished
    at 05:35:58 UTC and the server box at 05:38:59 UTC.
  - **Step 1.**
    - The trusted full run was the daily run 39538919564 on `4ce282f8`. Every job the runbook reads passed.
    - `merge_group` is in `main`'s `ci.yml`, and the payload cap is in the installed hook.
    - Doctor printed `PASS jq_regex` and no failure. The canary printed `deny` on jq 1.7.
    - The census checked 13 coordinators and found none marked or held.
    - The project's sweep took 9.8, 8.9 and 9.5 s in three timed calls, against a 25 s bound. The server's log
      had no failed sweep line after its restart.
    - The last check could not be met. No PR bound to a workspace merged after the deploy: five PRs merged, all
      from unbound branches, so the merged lane had nothing to say. The operator ruled to go ahead without it. The
      queue event below shows a sweep finishing and the landing lane speaking, and (e) ran first in the window.
  - **The lane, before the window.** Wave 3c's `ccd` reached the fleet box first. A sweep at 05:37 UTC, about a
    minute after it, recorded #963's removal of 2026-10-20 12:54:52 UTC and mailed this coordinator
    `dequeued:#963@2026-10-20T12:54:52Z`, with run 691 waiting at `merging`. The server was still the old build,
    so wave 3c's `ccd` change alone made the lane hear again. That is the "real dequeue mailed it" reading Step 7
    asks for. Nothing was done on it: the queue was off, and run 691 was held for the re-run.
  - **Departures.**
    - Slot D carried all four of its readings on one PR (#1056, run 732), as the proof ledger lists them, so the
      re-run spent one dispatch. (f) was read first, during the run's own wave and before the write; (a0), (e)
      and (a1) followed inside the window, in that order.
    - Slot C was this coordinator's ledger PR #1018. It read `unknown` throughout, its known branch drift.
    - The canary's fixture was left in a scratch directory for the reaper, instead of the final delete.
  - **The write.** Step 2's read at 07:06 UTC matched the state the 2026-10-20 rollback left, with auto-merge
    allowed, as before. Step 4 wrote the ruleset at 07:07:07 UTC, with the queue rule, approvals at 0 and the
    admin role as the only bypass actor. The maintain role's bypass is removed (Step 3, R9).
  - **Readings on slot D.**
    - (f), at 05:51 UTC, before the write: slot D's held worker ran `gh pr merge`, and the wave-hold arm refused
      it, live.
    - (a0): the wrong sha was refused ("expected head oid does not match the current head oid"). Nothing was
      queued or armed.
    - (e): enqueued at 07:07:26 UTC, its entry read back at once, then removed at 07:07:35 UTC with
      `dequeuePullRequest`; the timeline reads Added, then Removed (`manual`). The `queue` event came 71 s later.
      The lane also mailed this coordinator `dequeued:#1056@…`, because run 732 was open at `awaiting-review`. So
      the dequeue mail reaches an open run's coordinator before `merging` too. Stop rule 8 did not fire.
    - (a1), after (e): an empty commit was pushed from outside the workspace. While its checks ran,
      `gh pr merge --match-head-commit` answered rc 0, printed nothing, and armed an auto-merge request rather than
      queueing. A second empty push left the request armed, as on 2026-10-20, so clause 15's disarm rule carries
      weight. It was disarmed with `--disable-auto`. #1056 was closed unmerged, and run 732 closed.
  - **The landings.** #942, #963 and #1018 were enqueued within 7 s at 07:10 UTC, each entry read back at once.
    While they waited, (a) read A and B `open queued <time>`. They landed one at a time: #942 at 07:24:15 UTC
    (`2dfc794b`), #963 at 07:39:06 UTC (`c53bebc6`) and #1018 at 07:54:30 UTC (`8846779a`).
    - `merged:#942` woke this coordinator 3 min 10 s after its merge, and run 690 closed at 07:29 UTC.
    - `merged:#963` was sent 1 min 19 s after its merge, but this coordinator read it only at 12:10 UTC: the
      session was waiting on the operator's ruling below. Run 691 closed at 12:11 UTC. The proof programme then
      had no open run left.
  - **Stop rule 6 fired, on #942's readings at 07:28 UTC.** GitHub records a removal at a successful queue merge.
    - (a) read A, and later B, `merged … none`, never `landed`. C read `unknown`, as above.
    - (a2): each of the three timelines ends in a removal within a second of its merge: at the same second for
      #942 and #963, one second before for #1018.
    - So `landed` is unreachable. The dequeue lane can also announce a removal for a PR that merged, if a sweep
      reads it in the moment before the PR reads merged. No false notice appeared in the window: the only `queue`
      event was (e)'s.
    - The rule lets the queue stay on only if the operator rules so. This coordinator asked at about 07:31 UTC and
      left the queue on while the question was open, because nothing merges wrongly under this rule. #963 and
      #1018 landed through it in that time, and their readings confirmed #942's.
  - **The other readings passed.**
    - (b): three consecutive first-parent commits, one per PR, each with its own tag (v0.0.516, v0.0.517,
      v0.0.518), one release run and one prerelease. Each sha has a `ci` push run; #963's reads cancelled, which
      is the refresh group's expected behaviour.
    - (c): three `merge_group` runs passed, none cancelled. Every required job ran; the macOS legs, `full-suite`,
      the trace shards, the map and times builds and the storybook check skipped. The selection table on each
      run's page was not read.
    - (d): A and B read `merged` with their PR numbers before their runs closed. C read `unknown`, as above.
  - **The operator's ruling, at about 12:09 UTC:** keep the queue on. It stays on. Wave 2b is not planned until
    wave 3d makes the lane ignore a landed PR's removal.
  - **Every landing in the window.** By 12:10 UTC, every first-parent commit on `main` from #942 on had gone
    through the queue with a passing queue run: the three proof PRs and 11 others, 14 in all. None merged through
    the admin bypass.
  - **One more finding, minor.** The operator applied v0.0.528 later, and the server restarted at 11:52 UTC. The
    merged lane then wrote #963's `merged` feed event a second time, with run 691 still waiting at `merging`. No
    second mail was sent. Wave 3d reads it.
- **2026-10-21 14:49 — wave 3d's remedy, ruled: read the removal's reason.**
  - **The evidence.** A removal carries a `reason`. It read `merged` on every queue merge measured: 16 of 16
    since 07:07 UTC, at the merge's second or one second before it. Failed groups read `failed_checks`, and a
    removal by hand reads `manual`. So one read tells a landing from a dequeue.
  - **The operator's ruling (2026-10-21): "Read the reason."** A removal with reason `merged` reads `landed`. Any
    other reason, or none, is still announced on its first read. There is no two-sweep wait, no new wire field
    and no reason allowlist.
  - **What it replaces.** Stop rule 6's prescribed remedy, announce only after two consecutive sweeps, is not
    built. A real dequeue is still announced on its first read, so stop rule 8's 120 s bound stays true. The
    risk the operator accepted: if GitHub ever records a successful merge under another reason, the old
    one-second false-notice window returns for that case.
  - **The plan.** `docs/superpowers/plans/2026-10-21-landing-order-wave3d-trailing-removal.md`, drafted
    prototype-first and read by three review lenses, each finding refuted or folded. It also makes the `merged`
    feed record once-only across a server restart. Its run and its block of numbers open at dispatch.
- **2026-10-21 16:41 — the landing route from the repository's own rules, ruled.**
  - **Why.** A repository that depends on ccrc's landing will allow merge commits only and require a check from a
    third-party App. Today the coordinator squashes on every repository without a queue, and it never asks which
    methods the rules allow or where the required checks live. On this repository the four required checks live
    in classic protection only, so reading the rules alone would find none.
  - **A write-free observation first.** What ccrc does today with a check that is not required, while the required
    checks pass: nothing ccrc gates on reads it. A non-required red turns the PR's keycap red (measured on #1068).
    A pending commit status speeds the PR sweep to 30 s. A queued or running check run reads as passing, required
    or not, because gh writes its conclusion as an empty string (measured on #1010).
  - **The amendment.** Spec §5.7: the coordinator's reads before each landing, the method set, the required set
    and the other gates, three routes, the stops, what does not change, and the measurements. It is skill text
    and its pins only.
  - **The operator's rulings (2026-10-21), all as recommended:** squash then merge; a rebase-only repository
    stops; on a 401 or 403 the check set comes from the branch's public protection view; the approval licence
    stays on both direct routes, stated narrowly, until wave 2b; the running-check fix is a separate small server
    wave; the skill wave is planned after wave 3d; the text is a new §5.7; rollout to the prerelease that carries
    it, then the installed text is verified; the reads ask about the PR's own base. They are §11, items 7 to 15.
  - **Next.** Waves 3e (skills) and 3f (server) are added to the table. The plan for 3e follows wave 3d's merge.
- **2026-10-21 19:17 — wave 3d merged as #1096 (`e173c1aa`); run 751 closed.**
  - **The wave.** Six tasks in five commits, each reviewed. Two of its files were held by other programmes' workers
    when it reached them, `ccd/ccd` and `README.md`. Both edits were made under their holders' consent, inside
    the bounds each gave, and the review measured them there.
  - **Review 759.** The held-out panel and two wave-specific lenses (the ruling and the reason; the consents and
    the restart), none unverified. Seven findings after merging duplicates, none a behaviour defect. Every gate
    file, the build and all 15 mutations reproduced as the plan predicted. Accepted, with no fix round.
  - **The two findings that needed a ruling.**
    - The timing sentence is false for one merge. Of 22 queue merges on 2026-10-21, 14 recorded the `merged`
      removal in the merge's second, 7 one second before and 1 one second after (#960). This corrects the
      14:49 entry's evidence line. Behaviour is unaffected: in that second the PR already reads MERGED with the
      add last, and the kept arm answers `landed`. The wording is carried.
    - An open PR whose last act is a `merged` removal, and that never reads MERGED, reads `landed` with no
      notice, and the stall watch does not look at a run at `merging`. It follows from the ruling ("whether the
      PR reads open or merged"), and it has not been seen: every merge measured read MERGED within a second of
      the removal. It is carried as a residual, with a backstop as a later-wave candidate.
  - **The merge.** Enqueued at the reviewed head at 18:53 UTC with clause 15's spelling. The queue's
    `merge_group` run passed, and the PR merged at 19:09:47 UTC. The removal read `merged`, one second before the
    merge; the `merged:#1096` notice came about three minutes later, and no `dequeued:` notice came.
  - **The close.** Run 751 closed done and released its workspace. Three numbers are defined in the plan's
    Deviations found; the rest of the block is unused.
  - **Next.** The deploy, by ccrc's updater, then the live proof as the plan's Task 6 says, read with one
    correction from the review: the deploy's first sweep may repeat one `merged` row for each merged workspace
    whose pre-wave-3d row's reason clause (its hold or its open run) has changed since, once each.
- **2026-10-22 07:13 — §5.7's text approved; wave 3e planned.**
  - **The approval.** The operator merged #1092 (the written §5.7 and this ledger's wave 3d record) on 2026-10-21
    at 22:14 UTC, from GitHub and outside the queue, and confirmed on 2026-10-22 that the merge is the approval of
    §5.7's text and that wave 3e is to be planned from it.
  - **Wave 3d's live proof so far.** Both boxes run the release that carries #1096 since 2026-10-21 20:33 UTC.
    Since the server's restart: no `dequeued:` notice, and no `merged` feed row written twice. Every queue merge
    since then removed its PR with reason `merged`. The `merged … landed` reading waits for the next queue merge of
    a bound PR, which at the latest is wave 3e's own.
  - **The plan, prototype-first.** The decision §5.7 describes is code the coordinator runs, not prose it recalls:
    one fenced block in `wave-lifecycle.md`'s new §5b makes reads 1 to 6 with `gh`, GETs only, and prints one line
    (a route with its method and licence, a wait, a red, a merged PR to prove, or a stop with its reason). A new
    test file runs it against a stub `gh`, one case per route and per stop, each with a mutation. Clause 15 and
    the route prose name what each line means; the merge itself stays a spelling the coordinator types.
  - **What the prototype's read-only runs on this repository found.** A large rules answer overflowed `jq`'s
    argument list and an early draft fell through to route Q while a required check was red; the block now fails
    closed. And `gh pr checks --required` exited 0 while a required check had not reported, so the text wave 2
    wrote would have armed auto-merge instead of enqueueing; the wait now watches every check.
  - **The coordinator's rulings on the draft.** Under read 3b the head-behind-the-base stop applies to the direct
    routes only, since a queue tests the merged group itself. The new test file, a base name outside a safe
    character set, a review-conversation rule an admin could skip, and a verdict that prints no line, two lines or
    an unknown word are named departures: each adds a stop and never a merge. README's paraphrase of clause 15's
    never-writes list gains the merge-method settings, and the skill's final-merge step points at §5b.
  - **Review.** Three Opus lenses (spec fidelity, executability, safety) with a Sonnet refute pass per finding:
    18 findings confirmed and folded, 2 refuted. Every mutation count in the plan is the prototype's, and the
    worker re-measures each one.
- **2026-10-25 — R5 overturned: unattended landing is the goal (D-6857).** The operator ruled "WE WANT UNATTENDED MERGES ... maximise autonomy with safeguards". A lane, a timer or the operator's keeper may land a PR unattended when the native queue re-tests the combined code, the required checks gate the enqueue, the landing binds the verified head with `--match-head-commit`, and there is no `--admin` and no `update-branch`. Orchestrator call, open to overturn: a worker never merges its own PR. The coordinator skill (clause 15 and the wave lifecycle) and the worker skill (clause 16) match; the wave lifecycle's allowance of `--admin` where the ruleset requires it is withdrawn. Stages 3 to 5 are not touched here; where their text says a landing never comes from a timer, R5 as amended governs.
- **2026-10-25 — rulings 2, 3 and 5 (D-6857).** Ruling 5: governance of merges (who may merge, `--admin`, GitHub API merges, bypass) belongs to the repository's external policy authority, not to ccrc text; ccrc provides the enforcement points. It supersedes the narrow approval-licence pointer: in the wave lifecycle, `--admin` and GitHub API merge or enqueue calls are governed by that authority, and until it answers (wave 2b) a coordinator never uses them. Ruling 2: the live queue's grouping (build 2, merge 3) is accepted; one release may cover several commits. Ruling 3: the two private repositories should drop strict protection; the native queue is not available on their plan, so how they land is open.
- **2026-10-27 08:20 — wave 3e: fix round 5 handed off; its fresh review waits on the review-round cap.**
  - **The run.** Wave 3e is run 774 (the run's wave 7) on `ws/warm-summit`, PR #1127. Reviews 780, 827 and 863 each
    ruled a fix round (1, 2 and 3). The fourth review run, 903, was abandoned; the operator authorised one local
    independent review in its place, which ruled CHANGES REQUIRED at `1ba4d1f0` (four important source-boundary
    findings at reads 1, 3 and 6, and one minor), and fix round 4 answered them.
  - **Fix round 5**, approved by the operator on 2026-10-26, made one more ordinary merge of a pinned `main`
    (`ba36d742`) into the PR and reconciled clause 15 and the wave lifecycle's route paragraph with ruling 5: the narrow
    approval licence is retired, the route prints `admin=never`, and a direct route whose required approval is missing
    stops. Its wave-done was verified at `04745c73`: the workspace branch and the PR head agree, the exact-head CI run
    passed with both owning test files in its selection, and run 774 moved to `awaiting-review`.
  - **Held.** Opening the fresh review was refused `cap-review-rounds` (4 rounds against a cap of 3) on 2026-10-26 at
    15:27 UTC and again on 2026-10-27 at 08:08. The ask is the operator's: the console lifts a run's cap. The worker
    keeps the branch frozen, and nothing lands until a fresh independent review is accepted.
- **2026-10-27 11:06 — waves 3b, 4 and 2b planned and approved; wave 3b dispatched.**
  - **The plans** landed together in #1678 (`89472477`):
    - wave 3b, the conflict radar, `docs/superpowers/plans/2026-10-27-landing-order-wave3b-conflict-radar.md`, on run 310's
      block (4326 to 4334 defined, 4335 spare). The radar's console half, its server reader, wire fields and PWA chip,
      moves to a new wave 4b (D-4329);
    - wave 4, lineage acceptance, `docs/superpowers/plans/2026-10-27-landing-order-wave4-lineage-acceptance.md`, D-7102 to
      D-7110;
    - wave 2b, the bypass deny, `docs/superpowers/plans/2026-10-27-landing-order-wave2b-bypass-deny.md`, D-7111 to D-7116.
  - **Their numbers.** Waves 4 and 2b have no run yet, so their blocks were minted when their plans landed, not at a
    run's open: `dtbd.test.ts` refuses a plan that carries a `D-TBD` placeholder. A departure found while executing
    either plan is numbered when it is ruled.
  - **Review.** Each plan had three Opus lenses with a Sonnet refuter per finding, then an Opus recheck after each
    revision until a pass found nothing important. The operator approved all three on 2026-10-27.
  - **Wave 3b dispatched** as run 310 on a fresh child, `ccrc-pwa-clear-ridge`. Its Task 4 edits `README.md`, which
    wave 3e's worker holds, so that task waits for the claim or for its holder's consent.
  - **What waits.** Wave 4 dispatches after waves 3b and 3e merge; arming it is the operator's (`lineage=on` in the
    project's landing conf). Wave 2b dispatches after wave 3e, once the operator confirms its fleet-wide reach: the
    coordinator measured that reach privately on 2026-10-27, and the findings stay out of this file. Wave 3b's live
    proof needs the operator to write the project's landing conf with `lineage=off`.
  - **Noted for wave 2b's brief:** the deny refuses `--admin=false` with the other spellings, with a reason that says
    to drop the flag. Refusing a harmless spelling is the safe direction.
  - **Wave 3e is still held.** The operator reported lifting run 774's review-round cap, but at 11:05 the server still
    read it as not lifted, so the fresh review was not opened.
  - **#311**, the old ledger branch, was closed unmerged and its branch deleted. Its records landed through #1674,
    #1675 and #1676.
- **2026-10-28 08:00 — wave 3b reviewed and sent back for one fix round; the operator's answers.**
  - **The wave-done.** Run 310's worker reported wave-done at `f372653a`, PR #1740, after one absorption of `main`
    (worker clause 16, trigger 2: `main`'s D-7054 cadence census landed after the branch's base). The tip, the PR's
    head and the remote branch agreed, and the required checks were green. The run went to `awaiting-review`.
  - **Review run 1109** ran the held-out panel and two wave lenses (the read-only boundary and the interface stage 4
    reads). It found 7 confirmed findings, 14 advisory and 7 refuted, with no lens unverified. The confirmed ones:
    - the branch-rules read took one page, so a required check past it could read green;
    - the git door's option rule was a prefix deny list, which a file-writing option and abbreviated long options pass
      (no call site reaches them today);
    - git refreshes the time of an object the project already has instead of writing a copy;
    - a stop signal during the closing rewrite left the scratch behind;
    - the `GIT_*` scrub had no red;
    - a fetch cut by the project budget left old lineage files in place;
    - the source pins missed aliased spawns.
  - **Ruled: fix round 1.** Six of the seven are fixed, each with a red, together with nine advisories. The git door
    becomes an allowlist of argument forms. The git refresh is accepted: it changes no content, ref, setting, hook or
    object set, so only the wording of the read-only claim changes. The operator accepted that ruling on 2026-10-28.
    Null store figures after an interrupted tick are inside the `probe` grammar. Doctor's PASS for `pending` and
    `no-required-set` stays.
  - **`enabled` is reconciled at each tick's start.** The reviewer measured up to about 1110 s between two writes of
    `enabled` with four opted-in projects, and more in a contrived case, against wave 4's three-interval bound of
    900 s, because it was written after each project's measurement. A pre-pass now writes or removes it before any
    project is measured, so its spacing is the spacing of tick starts. Wave 4's bound still needs one change, owed by
    this coordinator before wave 4 dispatches: four intervals (1200 s), because a tick that runs past one interval
    delays the next start.
  - **The fleet box moved to new hardware** between about 06:44 and 07:46. Run 310's worker was restarted twice,
    which cost it a gate run and its scratch files. Its commits are intact and unpushed; the gate runs again.
  - **The operator's answers.**
    - A repository whose PRs need an approval no session can give keeps landing them by admin merge, with the
      operator's express permission. So wave 2b's deny gets an operator-written allowance for that one project, with
      no writer in the tree, before wave 2b dispatches. Which repository it is stays out of this file.
    - The other projects' notes that tell sessions to merge with `--admin` or through `gh api` are the operator's to
      change; no coordinator mail goes out.
  - **Wave 3e is still held.** At 08:00 run 774 still reads 4 review rounds against a cap of 3, and no lift is
    recorded.
- **2026-10-28 11:05 — wave 3b's fix round 1 reviewed and sent back for a second; wave 4's lineage reads amended.**
  - **The wave-done.** Run 310's worker reported fix round 1's wave-done at `b3b5e7ab`, four commits after the
    reviewed tip. The tip, the PR's head and the remote branch agreed, and the required checks were green. The run went
    to `awaiting-review`.
  - **Review run 1125**, round 2 of the run's cap of 3, ran the held-out panel over the fix round and two wave lenses
    (conformance to the round-1 rulings, and the read-only boundary over the whole probe). It found 6 important
    findings, 11 advisory and 9 refuted, with no lens unverified. The wave's suites and the repo-wide guards were
    green at the tip. The reviewer re-measured 15 of the worker's 53 mutation rows, all red, and planted five gaps of
    its own, each green. The important ones:
    - nothing goes red when the child is recorded only after the signals are unblocked;
    - the table of option forms the git door admits has no literal pin, unlike the door's other tables;
    - README says the door refuses an option after an operand, and it does not;
    - README and a test name say the spawn pins catch any other way to start a process, and an `asyncio` spawn passes;
    - an aliased import after a semicolon passes the alias pin;
    - an undecided row's lineage carries `tip: null`, which the plan's form does not allow, and no test pins it.
  - **Ruled: fix round 2.** The advisories traced most of the remaining cleanup gaps to one cause: the stop-signal
    handler raises wherever the interpreter happens to be. A signal in the closing path, just after the scratch or a
    temp file is made, or inside the stale sweep's removal can leave the scratch or a temp file behind. Masks narrow
    those windows but cannot close them. So:
    - the handler now only records the signal and kills the child's process group;
    - the probe stops at fixed points, and every cleanup runs to its end.
    - The spawn pins become a census of the program's syntax tree: its imports, their aliases and the dynamic
      builtins.
    - The git door refuses a dash-led element after the fetch's `--` too.
    - Each unpinned guard gets its red, and the prose says what the pins hold.
  - **Accepted:**
    - `tip: null` for a row whose local read the budget left undecided;
    - `fetch-failed` for a failure before the first write;
    - the probe header's step list;
    - the wider wording "an object the project already holds";
    - the child unblocking its signals before its exec;
    - `gh pr list` being a GraphQL read.

    Their numbers are defined when the wave is accepted.
  - **Wave 4's reads amended** (its plan, D-7268 and D-7269):
    - the lineage file's own `at` gets a freshness bound of 2400 s, so a lineage the radar stopped rewriting never
      accepts;
    - an unmeasured doc's `null` fields read as absent, and a `null` tip answers `lineage-unmeasured` with the fixed
      detail `tip-unmeasured`. The ruling first said the answer would carry the doc's own `why`. A fixed word keeps
      text from the file out of the mail, so the plan uses it.
  - **The review cap.** The next review of wave 3b is the last before the operator must lift run 310's cap.
  - **Wave 3e is still held.** At 11:05 run 774 still reads 4 review rounds against a cap of 3, and no lift is
    recorded.
- **2026-10-28 19:12 — wave 3e accepted and merged; wave 3b's fix round 2 reviewed and sent back for a third.**
  - **Wave 3e's cap.** The operator lifted run 774's review-round cap on 2026-10-28. The cap had held its fresh review
    since 2026-10-27 (Decisions, 2026-10-27 08:20).
  - **Review run 1138** read the whole wave at `04745c73`, the first held-out panel since review run 863. It found no
    behaviour defect and three gaps in the pins:
    - the half of the approval check that counts any `pull_request` rule, not only the first, had no test;
    - no case pinned "exactly `APPROVED`" against a near miss;
    - clause 15 was pinned as a substring, so a licence appended to its line left the suite green.
  - **Ruled: fix round 6, tests and comments only.** It added the cases, a whole-line pin of clause 15 and two comment
    fixes, with no change to the skill or its reference.
  - **Review run 1141** read the round at `c8b56b8e`. Neither panel confirmed a finding. All 15 of the worker's
    mutants were red at the tip, and seven sampled ones survived the old tests. **Accepted.** Its one advisory, that a
    verbatim copy of clause 15 elsewhere in SKILL.md passes beside a rewritten real one, is carried (D-6345).
  - **Merged.** PR #1127 went through the native queue at `c8b56b8e` as `7e38b5f4`.
  - **Recorded:**
    - the wave's departures, D-6336 to D-6345, in its plan's Deviations;
    - spec §5.7, §6's skill row, §11 item 10 and §12 amended to match ruling 5's retirement of the approval licence,
      with no ruling new (spec §11, Amendment 2026-10-28).
  - **The live proof's first part.** gh 2.103.3's `pr checks --required` exits `0` when every required check passed,
    `1` when one failed and `8` when one was pending, as the route prose assumes. It was measured on three open PRs at
    the landing. The rest waits on the deploy: the installed skill text in every home, and the next landing that the
    verdict routes.
  - **Wave 3b's fix round 2** reached its wave-done at `36f3e207`. That included a second merge of `main`, licensed by
    ruling because `ccd/ccrc`'s uninstall summary conflicted with #1738. The one licensed resolution was `main`'s line
    whole, with the probe's name inserted.
  - **Review run 1140,** the last review round under run 310's cap, found the merge exact and the round-2 rulings
    held. It also found two important gaps:
    - a read the stop signal killed in the before-first-write fallback was decided, so its row's old lineage file was
      deleted instead of rewritten unmeasured;
    - an interrupted tick's probe has the in-progress shape, so doctor shows the previous tick's main-health verdict
      until the next tick.
  - **Ruled: fix round 3.**
    - Only rc 0 (with a 40-hex tip) and rc 1 decide a row; every other answer leaves it undecided.
    - The census holds the git door's option table bound once and never written.
    - The self-signal pin reads the whole tracked tree.
    - Four sentences are corrected.
    - The interrupted-tick reading is accepted as the in-progress shape, so an explicit marker is a later wave's.
  - **Wave 3b is held.** The fix round's wave-done came at `ab98835c`. Opening its review was refused at the cap,
    and the server raised the ask to the operator.
- **2026-10-29 06:01 — wave 3b accepted and merged; wave 3e's live proof complete; wave 2b dispatched.**
  - **The cap.** The operator lifted run 310's review-round cap on 2026-10-29, and review run 1143 read fix round 3.
  - **Review run 1143** (fix round 3, `ab98835c`) found fix round 3's rulings held, and seven important gaps. In three
    of them a read that could not answer still deleted a lineage file:
    - an unlistable registry;
    - a registry field that exists but cannot be read;
    - git's rc 1, which also answers for a broken or unreadable ref.

    **Ruled: fix round 4**, on one principle: the probe never narrows a distinction it received, and takes git's answer
    where git does not tell the cases apart.
    - An unlistable registry decides nothing.
    - An unreadable registry row is held whole.
    - The wording about rc 1 is corrected, with `git show-ref --exists` carried as its remedy.
    - The option-table census pins every occurrence, and two rule arms got their missing tests.

    `main` had moved since the branch's last absorption, so the round absorbed it once more, by ruling, for one
    conflicting hunk in `server/test/ccrc-doctorFixture.ts`. Wave 3b and #1785 had each raised `HEALTHY_SKIPS`, the
    expected count of doctor SKIP lines, and the resolution keeps both.
  - **Review run 1158** (fix round 4, `02896df4`) found the round's rulings held, and two important gaps:
    - the option-table census missed the keyword names in a `match` statement's class patterns, and the `__globals__`
      and `f_globals` attributes;
    - a `ws/` branch holding a NUL byte stopped the whole lineage pass.

    One of its minor findings was that a `ws/` branch shaped like a revision expression was read as one.

    **Ruled: fix round 5, declared the wave's last open-ended round.** From then on, a finding outside the round's
    diff, present before it and failing closed was carried, not fixed. A finding fails closed when wave 4 can never
    accept on what it leaves, and a bad registry row never stops another row from being measured. In the round:
    - a `ws/` branch that is not a well-formed name is held;
    - the census counts those keyword names and refuses the `__globals__`, `f_globals` and `f_locals` attributes;
    - two routes got their tests;
    - four overstated sentences were corrected.

    The narrowing that an unlistable registry gives every head a null `id` is carried to waves 4 and 4b.
  - **Review run 1171** (fix round 5, `8190c6df`) was scoped to the round. Neither panel confirmed a finding; its seven
    minor findings all fail closed. **Accepted**, with the minors carried (Carried constraints).
  - **Landed.** The landing verdict read `ROUTE Q method=squash admin=never strict=no`, and the required-checks gate
    exited `0`.
    - The first queue attempt was dequeued. Its group failed a `delegation-spool.test.ts` race case, which none of the
      PR's files reaches, and the delegation programme's coordinator was told.
    - One re-enqueue under the skill's dequeue rule landed: PR #1740 merged at `8190c6df` as `3ca67389`.
  - **Recorded:** the wave's twenty departures, D-4335 and D-7382 to D-7400, in its plan's Deviations, one per row of
    the notes' departures table.
  - **Wave 3e's live proof is complete.**
    - Part 2: after the deploy of v0.0.797, which carries #1127, the installed coordinator skill text was byte-equal
      to that release in all 18 skill homes on the fleet box, measured file by file.
    - Part 3: #1740 was the first landing the shipped verdict routed. It was routed to the queue, enqueued at the
      reviewed head after the checks gate, read back as queued, and re-enqueued once after a dequeue the PR did not
      cause.
  - **Wave 2b** is run 1144. Its prerequisite, the operator's per-project allowance, was answered on 2026-10-28 and
    planned by #1753 (D-7249). It was dispatched once wave 3e had merged and another programme's worker, on the
    operator's instruction, released its claim on `ccd/session-hook.sh`.
- **2026-10-29 09:41 — wave 2b accepted and merged; wave 4 dispatched; wave 3f's fix found already shipped.**
  - **The operator** asked, on 2026-10-29, for everything ready to land to land and for the waves to proceed. The wave 3b
    ledger PR, #1861, then landed through the queue as `fa275b66`, at its reviewed head.
  - **Review run 1184** (wave 2b's first, `76ad2ff4`) found no false refusal of a landing spelling the skill prescribes.
    It extracted 13 spellings from the skill text on `main` and fed each to the branch's hook from a fixture HOME. Its
    one important finding was that the operator's allowance accepted an over-long `.project`: the hook's registry
    reader cuts a file at 128 characters and then trims blanks, so `proj-a`, 122 spaces and `junk` read as `proj-a`.
    **Ruled: fix round 1.**
    - The allowance refuses a value that filled the read.
    - A plain read refused because a later redirect target, quoted string or glued argument holds `/merge` stays
      refused. It is named as a cost, and the reason gives the remedy.
    - The over-cap `/merge` keeps no end bound, because it is also what catches `/merges`.
    - Several header words and pins.

    The worker's seven departures were accepted.
  - **Review run 1195** (fix round 1, `e0a57a94`) was scoped to the round.
    - The rulings held. No refusal the first review measured reopened, and every prescribed landing spelling still
      passes.
    - Its ten items are minor or carried. The five in the round's diff fail closed.
    - The two that do not, a NUL-padded `.project` and a symlinked one, were there before the round. They pass only
      through planted registry state, and only as the allowed project's own name. By the deny's stopping line they are deliberate evasions, to be listed;
      the listing is carried (Carried constraints).

    **Accepted.**
  - **Landed.** The landing verdict read `ROUTE Q method=squash admin=never strict=no`, run on its own, and the
    required-checks gate exited `0`. PR #1863 was enqueued at the reviewed head and merged at `e0a57a94` as `d3250900`,
    with no dequeue.
  - **Recorded:** the wave's seven departures, D-7309 to D-7315, in its plan's Deviations.
  - **From the deploy of wave 2b on,** the coordinator runs the landing verdict, the checks gate and the enqueue as
    separate commands. Run as one, they are refused over the cap, because the verdict block's comments name `--admin`
    (D-7314). The skill already runs them separately.
  - **Wave 4** is run 1189. Its brief rules on where the plan had drifted from `main`, measured at dispatch. The plan is
    amended after the merge, with each ruling as a departure.
    - `FleetIO` has `lstatMeasured`, so D-7109's premise is false: the reader re-proves the probe's regular-file rule,
      and reads the pause markers by lstat.
    - The landing briefs take no head today, so the episode head is carried into `landingVerdict`; their pins are in
      `landing-verdict.test.ts` and `pr-queue-lane.test.ts`.
    - The measured list of `handoffCommit` readers.
    - One rule sentence for every `<handoffCommit>` in `wave-lifecycle.md` §5 and §5b, never editing the verdict
      block's code.
    - A single-definition guard for `DONE_REFUSAL_CODES`.
  - **Wave 3f's fix** shipped from outside the programme in #1383 on 2026-10-25: the first non-empty of a check entry's
    conclusion, state and status speaks for it, so a queued or running check run reads `pending`. What remains is the
    plan's measurement of what the 30 s sweep cadence costs; where it runs is for that plan to decide.
- **2026-10-29 17:38 — wave 4 accepted and merged; wave 4c opened.**
  - **Review run 1212** (wave 4's first, `2a7e0db9`) found the wave sound where it measured:
    - the touched files, the guards and both typechecks green, and the sampled mutation rows red;
    - red-first measured, and the brief's rulings applied;
    - no interaction with #1844, the one overlapping `main` commit no CI run had tested beside the wave.

    Its three important findings, and the worker's items:
    - **F1.** An `unmeasured` doc, or one naming no base, accepted when its chain held the claim. The radar never
      writes such a doc, and spec §5.4's accept row says "fetched base named". **Ruled: fixed.** A non-empty chain
      requires a sha `base` and a `stop`, and `state` and `stop` agree.
    - **F2.** The forgery's reach, measured: a session that puts its own `ws/` ref at a head and writes a fresh
      `enabled` marker and a consistent lineage file lands that head unreviewed. It needs no forged mail, works after
      the genuine review closed, and can opt in a project the operator never opted in. **Ruled: accepted at
      attribution grade,** as spec §4 and its edge-case list already say. The plan's sentence that stage 4 "adds no
      capability a session lacked" is corrected: it adds no new class, but it lowers the cost. A coordinator-side
      re-proof of the chain is carried to wave 4c.
    - **F3.** D-7441's rule had no end, so it would wedge an ordinary fix round. **Ruled: fixed,** scoped to the
      wave-done it answers.
    - **The worker's items:**
      - a `TIP MOVED` report whose close was accepted is followed by a fresh review run against the live tip;
      - a brief names the radar base as a ref name, read from the PR's `baseRefName`;
      - an unreadable marker keeps its `landing-marker-unreadable` detail even in a project nobody opted in, as spec
        §5.4's second row says. So the plan's "a project with no `enabled` marker answers byte for byte as today" holds
        for a marker proven absent.
  - **`main` moved during the review.** #1797 conflicted with the wave in `landing.ts`. Fix round 1 absorbed `main` with
    one merge, resolved as #1797's doc comment over the wave's signature. It pinned a merged brief that carries both the
    recorded head and #1797's train proof.
  - **Review run 1216** (fix round 1, `5aa30a97`) was scoped to the round.
    - The rulings held, no wider and no narrower, and the merge changed only its one hunk.
    - The suites and guards were green, and the sampled mutation rows red.
    - Its nine findings are none critical. Each fails closed except one: the new parser header claims more than its two
      checks hold. A measured doc with no `branch`, a cut walk with no `why`, and an `unmeasured` doc with a full chain
      still accept, though each needs a hand-written file, within F2's accepted reach.

    **Accepted, with no fix round 2.** The findings are carried to wave 4c (Carried constraints).
  - **Landed.** The landing verdict read `ROUTE Q method=squash admin=never strict=no`, run on its own, and the
    required-checks gate exited `0`. PR #1884 was enqueued at the reviewed head and merged at `5aa30a97` as `f6b67a5b`,
    with no dequeue.
  - **Recorded:** D-7433 to D-7442 and D-7464 to D-7467 in the plan's Deviations, and the plan's "What this does not
    claim" corrected.
  - **Wave 4c** is run 1219, opened as planned before run 1189 closed, so the programme keeps an open run. It takes the
    lineage hardening carried from wave 4's reviews. It is a row of its own, not part of wave 4b, for D-4329's reason:
    one PR must not mix an acceptance change with a display change. The run's title, "wave 4b: lineage hardening",
    was given before the split, and no route retitles a run. Wave 4b, the console half, opens its own run when it
    dispatches.
  - **Until wave 4c lands,** the coordinator's first worker brief for an opted-in project names the radar base as
    `origin/<default branch>`, because no PR exists yet to read `baseRefName` from.
- **2026-10-29 18:40 — waves 4c and 4b planned; the coordinator-side re-proof goes to the operator.**
  - **Both plans had two Opus review passes.** The first pass was three lenses per plan (spec fidelity, executability,
    fail-closed), with a Sonnet refuter on each serious finding. The second pass was one Opus reader per plan, reading the
    rewrite. Every finding that held is answered in the plans.
  - **Wave 4c**, the lineage hardening (run 1219), keeps the parser's radar-shape rules, one shared freshness predicate,
    the dequeue brief's head, two pins and the base before a PR. It defines D-7469, D-7470 and D-7472 to D-7475.
  - **The coordinator-side re-proof is not in wave 4c (D-7472).** Each review pass measured a new way to make a git walk
    in the coordinator's checkout answer for objects other than the ones that land. The redirections were replace refs,
    a graft file, attributes and a merge driver, hooks, a commit-graph file, and the remote's URL. Every fleet session
    can write each of them, and they are the same class of write as the forgery the walk exists to stop.
    - A robust walk needs a scratch repository with every config source disabled, a base sha and a head sha read from
      GitHub, and a stated stopping line.
    - Choosing that line is a threat-model decision, so it is put to the operator. Until the operator rules, wave 4's
      attribution grade stands, as ruled after review 1212.
  - **The review-cap ask's handling of a `TIP MOVED` report** is carried to the programme that owns the review cap
    (D-6795, D-6910, D-6911). The ask is the operator's, and the PWA sheet must say what the notice says.
  - **Wave 4b**, the console half, ships `FleetSession.landing` and the predicted-conflict chip, and dispatches after
    wave 4c merges. Two parts of spec §5.3's text are narrowed, and the operator is told:
    - `RunSummary.landing` is not shipped, because a run's landing is its session's (D-7477);
    - `main-health` is stage 5's to read (D-7478).
  - **Wave 4b alone does not move spec §10's stage 3 metric.** It gives the operator the reading. A coordinator-skill
    reader is not yet planned (D-7483), so the metric's two-week clock should not start at wave 4b's rollout.
- **2026-10-29 22:55 — a red `main` fixed first; wave 4c accepted and merged; wave 4b dispatched.**
  - **`main` went red under every landing.** #1897 gave `ccd/ccd` a second sourced library, and
    `ccd-retire-verdicts.test.ts` extracted the merge base's `ccd` with only the first one beside it. Its 15 rows failed
    wherever the file ran: in at least six pull-request runs on four branches, none of them touching `ccd/ccd` or
    `ccd/lib`, and in one merge-queue run (#1910's). By the same code it would red the daily run too. No fix was open, so this programme ran one (run 1221, the run's wave 11): `baseCcd()` writes every
    file the merge base's own `ccd/lib/` holds (D-7496, defined in
    `docs/superpowers/plans/2026-10-29-retire-verdicts-base-libs.md`). Review run 1222 confirmed no finding.
  - **#1913 merged before its review reported.** Auto-merge was enabled on it at 20:41Z, before its wave-done and its
    review. The coordinator did not enable it, and the brief forbids the worker any merge command. GitHub records one
    shared login for every session, so it cannot show which one did. The PR landed through the queue at the head the
    review then read (`23b426d9`, as `62857ed9`), and the review confirmed nothing, so the landing stands. Who enabled
    it is put to the operator.
  - **Review run 1220** (wave 4c, `0a9ff1b2`) found nothing critical or important. Every touched suite and guard was
    green at the worker's counts, all 12 plan mutation rows were red, and red-first was measured against the merge
    base. Every radar shape git's tools can make still parses, and each new refused case fails one rule. Its eight
    minor findings fail closed or are text. **Accepted, with no fix round for its findings.**
    - **F1:** a hand-made commit object with two identical parent lines passes the radar's walk, and the `p1 === p2`
      rule refuses its doc. The rule stays (D-7494).
    - **F2, F3, F4 and F8** are carried to wave 5 (Carried constraints).
    - **F5:** nothing pins `freshWithin`'s one definition. It is added in wave 4b's Task 1, from that run's block.
  - **The landing needed a new head (D-7495).** The verdict judges every check suite on the head, and two runs on
    `0a9ff1b2` stay red on `main`'s old failure for good, because a rerun replays a run's original merge commit. Closing
    and reopening the PR started fresh runs, the first on a merge ref GitHub had not yet recomputed. So the run was sent
    back once (fix round 1) for one clean merge of `main` and nothing else, which gave the PR a new head. Review run 1223 found the merge's tree equal to `git merge-tree` of its
    parents and the wave's 11 files unchanged.
  - **Landed.** The verdict on the new head read `ROUTE Q method=squash admin=never strict=no`, run on its own, and the
    required-checks gate exited `0`. PR #1911 was enqueued at `390445dc` and merged as `9ec4fc54`, with no dequeue.
  - **Wave 4b** is run 1224 (the run's wave 12). It was opened before run 1219 closed, so the programme keeps an open
    run, and dispatched with an execution block minted then and the `freshWithin` row added to its Task 1.
- **2026-10-30 02:32 — wave 4b sent back once, accepted and merged; wave 5 opened.**
  - **Review run 1225** (wave 4b, `38409807`) found nothing critical or important after refutation. All 23 plan
    mutation rows were red, and every touched suite, every guard the plan names and all three typechecks were green, the
    full PWA suite included; the full server suite is left to the merge queue. But the wave's one promise is that the
    chip's words are true, and the review measured a landing past its window on the wire. While the registry
    could not be listed, the `/ws/fleet` cold frame and `GET /api/fleet`'s degraded arm sent the watcher's last fleet,
    aged landing and all. And the chip could show such a landing as fresh for one render, the first after a long gap. **Sent
    back once (fix round 1):**
    - **R1:** one helper in `fleet.ts`, `dropStaleLandings`, drops every landing `freshWithin` no longer accepts from
      the four sends that do not assemble afresh: the cold frame, the degraded arm, that arm's fallback to the saved
      snapshot, and the remote disconnected arm. `assembleFleet` keeps its own check.
    - **R2:** the chip ages by the later of its stored clock and the render's own.
    - **R3:** three things the review's own mutants showed unpinned are now pinned: the tick's `null` hand-off for an
      unlistable registry, the radar lane's 60 s cadence and its skip-while-in-flight rule, and `readRegular`'s check of
      the bytes it read.
    - **R4:** a PR the sweep is backing off on (`unknown`, `unchecked`) keeps its number and matches nothing, so its
      sessions' landings are absent while the sweep fails. That fails closed and stays, and the text now says so.
    - **R5 and R6:** the PR body discloses three more decisions against the plan's text, and the departures note
      defines D-7516 to D-7523.
    - Review 1225's F5, F6, F9 and the smaller gaps of its F4 are carried to wave 5 (Carried constraints). Its F8, four
      intermediate commits red on one census, is accepted, because the merge is a squash.
  - **Review run 1226** (the round, `38bcaf1e`) found nothing critical or important. No send was missed, the new tests were
    red before the fix, all six mutants were red as predicted, and the departures matched the rulings byte for byte. **Accepted, with no
    second round.** Its F1 and F2 are text, carried to wave 5. Its F3 is the worker's one departure, D-7526:
    `dropStaleLandings` returns its input when nothing is stale, because the cold frame's cache is keyed on the array.
    It is defined in the departures note after the merge.
  - **Landed.** The verdict on the new head read `ROUTE Q method=squash admin=never strict=no`, run on its own, and the
    required-checks gate exited `0`. PR #1923 was enqueued at `38bcaf1e` and merged as `85d61aa8`, with no dequeue.
  - **Wave 5** is run 1227 (the run's wave 13). It was opened as planned before run 1224 closed, so the programme keeps
    an open run.
- **2026-10-30 03:40 — wave 5 split; wave 5a planned.**
  - **Stage 5 is unbuilt.** A read-only survey of `main` found no code for the landing line yet: no landing tables,
    routes, `land-candidate` verb, PR-keyed `pr-state` form or `main-health` reader. Every dependency row 5 names is
    merged. Its scope still has open questions that are the operator's (below).
  - **Wave 5a** takes what the reviews of waves 4c and 4b carried to wave 5, apart from the landing line, and three
    older review items (1141, 1216 and 1222). Every item is
    minor, fails closed, is a gap in a test or guard, or is text. It is run 1228 (the run's wave 14), and its plan,
    `docs/superpowers/plans/2026-10-30-landing-order-wave5a-carried-hardening.md`, defines D-7528 to D-7539. Each task was drafted against `main` and checked against `main` by a second
    reader. Three Opus lenses then reviewed the plan, a Sonnet refuter checked each serious finding, and each finding
    that held is answered.
  - **D-7495's carried question is ruled (D-7536).** The landing verdict keeps its strict rule. A red that is `main`'s
    own ends as the `red-unreachable` stop, and its report names the new-head route. Spec §5.7.5 makes a red that is
    not the PR's own a stop once it is still red after the one rerun, or at once when it is not a GitHub Actions run, so
    the coordinator does not take the route unasked. Whether it may, as wave 4c's landing did, is put to the operator.
  - **Closed:** wave 4's "lenient chains and times" item. Cycles, duplicate entries and `p2 === p1` are refused on
    `main`. Wave 4c kept `Date.parse` through `freshWithin` and dropped the strict time format on purpose (its plan's
    review).
  - **Not in 5a, and carried on.** These stay carried to the next wave that edits each file:
    - the items in `ccd/ccd`, `ccd/session-hook.sh` and `ccd/ccd-land-probe`;
    - `deploy/measure-landing.py`'s single-page read.

    Three items are left for stage 5, whose PR-keyed landed reader (spec §5.5) may serve them:
    - wave 3d's backstop for an open PR read as landed;
    - wave 2's closed-unmerged PR reading `unmeasured`;
    - review 1216's first item, a train-landed spent producer's proof after its row is reclaimed.
  - **Put to the operator for stage 5.**
    1. On this repository the native queue is the composition test, so `ccd land-candidate` has no consumer here.
       Does wave 5 ship the line (entries, intents, holds, the PWA doors, the next-to-land mail) and leave
       `land-candidate` until a project lands without a queue?
    2. How do the two private repositories land (ruling 3 left it open)?
    3. Where is `lander:coordinator` declared? The spec uses it three times and never defines it.
    4. The spec names three CLAUDE.md amendments: the coord.db invariant, the box-token bullet and the ccd-verb rule
       (§5.5, §6 and §7). §7 says the ccd-verb rule's wording is the operator's. Should the wave's PR propose the text
       of all three for the operator to apply?
    5. The plan prerequisite of spec §10, the coordinator's mail latency, has a measuring tool, but no recorded
       result since wave 1's plan. May the coordinator run its read-only measurement?
- **2026-10-30 08:16 — wave 5a accepted and merged; D-7544 to D-7548 defined.**
  - **Review run 1232** (wave 5a, `981b77cf`) found one important finding and minors. All 67 plan mutation rows were
    red, and 21 of them were supersets, the same 21 the worker found. Red-first failed 40 cases at the base's source,
    each new or amended on purpose. Every touched suite, every guard the plan names, all three typechecks and the full
    PWA suite were green, and §5b's verdict block was byte-identical. The full server suite was left to the merge
    queue. **Accepted, with no fix round.** No change the wave makes reads cleaner than before. Every finding but one
    is text, a gap in a guard, or fails closed. The exception is F1 (D-7547), which was there before the wave and
    needs a corrupt or hand-made registry file. F5's io past the deadline happens in local mode only, so the live
    server, which is remote, is not affected.
  - **Five numbers are defined** in `docs/superpowers/plans/2026-10-30-landing-order-wave5a-departures.md`:
    - D-7544 and D-7545 are the worker's two departures. The plan's literal pin (D-7544) and the brief's literal path
      (D-7545) would each have failed the build, and the review measured both.
    - **D-7546:** read 5 lists only the latest run of each check name (M1, measured). So the strict rule of D-7536
      decides over the latest run of each name, and a failed-then-green rerun of a required name reads green. Until the
      operator rules, the coordinator also reads every head with `filter=all`, read-only, before the enqueue.
    - **D-7547:** D-7532 holds for an io failure only (F1). The server and the radar read `.project` by different
      rules, so four hand-made shapes can still read a landing cleaner. The gap was there before the wave.
    - **D-7548:** the chip drops four things, not three (F2), and "under 5,000 characters" is not a bound (F3).
  - **The spec** gains two inline notes for D-7537 (F8), at §5.7.4's merge proof and at §5.7.5's not-at-head stop.
  - **Landed.** The verdict on the head read `ROUTE Q method=squash admin=never strict=no`, and the required-checks
    gate exited `0` with all four required checks passing. Every attempt of those four on the head had passed
    (`filter=all`). PR #1960 was
    enqueued at `981b77cf` and merged as `d196d8b3`, with no dequeue.
  - **Put to the operator, beside wave 5's questions:** D-7546. Either read 5 adds `filter=all`, which holds the rule as
    written but stops a flake cleared by a rerun from landing without a new head, or the stop paragraph is restated as
    the rule over the latest run of each name, which is the gate every landing so far has used. It is the companion of
    D-7536's question (may the coordinator take the new-head route unasked): both decide what clears a red.
- **2026-10-30 10:50 — the operator's answers; waves 3b and 2b proven live; the mail latency measured.**
  - **The operator answered (about 10:40):**
    - **D-7536:** the coordinator may take the new-head route on its own when a red is `main`'s own. The skill's
      sentence for it goes in wave 5, with review 1232's F9 (b).
    - **Wave 5, question 1:** `ccd land-candidate` is left out of wave 5.
    - **Question 4:** wave 5's PR proposes the text of the three CLAUDE.md amendments, for the operator to apply.
    - **Question 5:** the mail-latency measurement is run (below).
    - **Deploys and switches** are the coordinator's to make.
  - **Still open, with the coordinator's recommendation:**
    - **Question 2, the two private repositories.** The options are (a) a direct merge once the PR's own checks pass
      (route G), (b) the combination test of `ccd land-candidate`, or (c) leaving them out of the landing line. The
      coordinator recommends (a) now, with `main`'s breakage there measured before (b) is built.
    - **Question 3, where `lander:coordinator` is declared.** The coordinator recommends a `lander=` key in the
      project's landing conf, the one per-project file for landing switches, which the radar already reads.
    - **D-7546.** The coordinator recommends restating the stop paragraph as the rule over the latest attempt of each
      name, which is GitHub's own rule, and keeping the every-attempt read as a report, not a stop.
    - **D-7472.** The coordinator recommends building the re-proof in wave 5, measured in a fresh scratch clone
      fetched from GitHub with a clean environment rather than in a shared checkout, and arming `lineage=on` after it.
      Until then `lineage=on` is not set, because it changes how every coordinator's wave-dones on this project are
      accepted.
  - **The deploy.** The fleet box runs v0.0.862 (`c69ad880`), which carries waves 2b, 4, 4c, 4b and 5a. The server
    box's version was not measured from the fleet box.
  - **Wave 3b's live proof** (its plan's Task 4 Step 4) holds. The conf `~/.ccrc/landing/ccrc-pwa.conf` was written at
    10:45 with `base=main` and `lineage=off`. The tick at 10:46 took 4 s:
    - `probe` is `measured`: 15 open PRs, 15 pairs of 6 heads, no cut;
    - all 30 answers reproduce exactly (9 of the 15 base answers and 11 of the 15 pair answers are conflicts) with
      `git merge-tree --write-tree --name-only --no-messages` in a scratch repository;
    - `main-health` reads `green` at `main`'s tip, and GitHub reports the four required checks passing there;
    - `enabled` is absent;
    - the project's store is unchanged by the tick (0 objects added);
    - doctor's `land-probe` line passes.
  - **Wave 2b's live check** (its plan's Task 3 Step 4) holds. The installed hook is byte-equal to the release tree's.
    Fed from a fixture HOME, it denies `gh pr merge 1 --admin` and a `gh api` enqueue, and passes clause 15's spelling
    and a verdict read. The operator's allowance file for the one project allowed to keep admin merges (D-7249) is
    absent, so that project's sessions are refused an admin merge until the operator writes it.
  - **The mail latency** (spec §10's prerequisite), measured from 2026-10-16 to 2026-10-29 with
    `deploy/measure-landing.py mail-latency`, over 14 coordinators:
    - 1161 mails: median 0.2 min, 90th percentile 8.8 min, maximum 1651.8 min;
    - none unmatched and 14 undelivered;
    - 6 coordinators' pages came back full, so their mail is left out, and the closed-run read reached its cap of
      500. The figure covers 8 of the 14 coordinators.
  - **Wave 4b's live read** waits. The plan's read is `GET /api/fleet`, and the fleet box has no read of it.
- **2026-10-30 23:24 — the operator's second answers; stage 5 split into ten sub-waves; waves 5b and 5c planned.**
  - **The operator answered (about 22:15):**
    - **The allowance file (D-7249):** the coordinator writes it. It was written at 22:20, an empty regular file at the
      path the hook reads, for the one project allowed to keep admin merges.
    - **Question 2: (a).** The two private repositories land by direct merge once the PR's own checks pass (route G).
      Nothing tests a PR combined with `main` there before it lands. Ruling R10's strict-protection flip stays the
      operator's.
    - **The server box:** likely moved by the 10:22 update; it is not measured from the fleet box. The fleet box moved
      again, to v0.0.874, by a console update at 19:35.
  - **Still open, each with the coordinator's recommendation:**
    - **Question 3:** a `lander=coordinator` key in the project's landing conf. The radar refuses an unknown key, so
      sub-wave 5d teaches it the key before anyone writes it.
    - **D-7546:** restate the rule as the latest attempt of each required check name, and keep the every-attempt read
      as a report line. Wave 5b's Task 2 holds that text, and it is droppable.
    - **D-7472, changed:** no re-proof in wave 5, and `lineage=on` stays off. On this repository the queue does not
      require a PR to be up to date (`strict=no`), so a clean merge of `main` after review is rare. Its one routine
      case, the new-head route, is followed by a short review of one merge commit. Lineage and the re-proof pay where a
      project requires up-to-date branches, and they are revisited when one joins the landing line.
    - **Wave 4b's live read:** a look at the chip on two bound PRs' cards, named to the operator.
    - **The CLAUDE.md lines (question 4).** `box-token-census` and `collect-switch-prose` read the PR's own
      `CLAUDE.md`, so sub-waves 5e, 5f and 5j must carry their box-token and coord.db lines in the PR itself. The
      coordinator proposes to hold each such PR for the operator to read those lines before the enqueue. The ccd-verb
      rule needs no change: with `land-candidate` left out, stage 5 adds no verb.
  - **Stage 5 is split into ten sub-waves, 5b to 5k** (Waves table), from a read-only survey of `main`, so that each
    PR carries only its own data, routes and verb (D-4329's reason):
    - first, in parallel: 5b (skill text), 5c (the PR-keyed `pr-state`), and 5d (the `lander=` key) once question 3
      is answered;
    - then 5e, 5f and 5g in series, because they share the schema, the store and the routes;
    - then 5h once 5c runs on the fleet box, and 5i once 5d does;
    - then 5j and 5k.

    The survey's open design choices for 5e onward are settled in each sub-wave's own plan: two migrations, no `repo`
    column, an entry's identity, when `landing.log` is replayed, and the rest.
  - **Waves 5b and 5c are planned** (D-7588 to D-7599). Each task was drafted against `main` by an Opus reader and checked by a Sonnet reader, and all 22 fixes are applied. Five Opus lenses then reviewed the two plans, Sonnet refuters checked the serious findings, and a reader checked each fixed plan for consistency. One critical finding per plan held and is answered: in 5c, Task 2's reader expected a line Task 1 never prints; in 5b, a number word the clause-count census refuses. So is every important finding. Until sub-wave 5e records a base, 5b reads clause 15's ejection as covering its report-less round, on the operator's answer to D-7536's question (D-7590).
  - **The spec** gains an inline note for D-7588, in Figure 1's caption and in §5.7.5's row for a red nothing here can
    reach.
  - **Clause 19.** The coordinator's own workflows now run as clause 19 says: short, time-capped and at `medium`
    effort. Earlier ones in this programme ran at `high`.
- **Deviation blocks** are minted per wave, at that wave's run-open, by the coordinator. No `D-` token appears in
  this file until a plan on the same ref defines it (`deviation-refs.test.ts`).

## Measurement — 2026-10-25

Spec §10, run for the first time, nine days after its two-week check was due (stage 1 rolled out 2026-10-02; the
native merge queue was switched on 2026-10-21). Read-only: `deploy/measure-landing.py` through `gh api -X GET`, plus
`gh api` GETs for the queue metric it did not have. Repository `Synapsium-Labs/ccrc-pwa`, `main`. Required contexts
(read by the tool from the ruleset and classic protection): `build-pwa`, `test (agent)`, `test (pwa)`, `test (server)`.
The measuring tool gained a `queue-ejections` subcommand with this section (tests in
`server/test/measure-landing.test.ts`; its one `gh` door now also passes `--allow-escape-sequences`, because a
job log carries colour codes that `gh` refuses to print, and it still sends only a GET).

**Windows.** Baseline 2026-09-08..09-22 (re-run, to check the tool against the frozen figures); stage 1 before the
queue 2026-10-02..10-20; the queue era 2026-10-21..10-25 (the run ends 2026-10-25 midday); and 2026-10-22..10-25,
the days after the last `update-branch` commit. The re-run of the baseline window reproduces the spec's frozen
figures where the spec's definitions match: green-to-merge median 32.0 min (spec 33), 14 fleet-on-fleet
inversions (spec 14). It reads 2 fleet `update-branch` commits where the spec says 8, and 9.0 h of required-only
red where the spec says "prerequisite"; the spec's 8 is the archived scan's figure, and the committed tool is the
baseline from here on (§10).

### Against each §10 target

| Metric | Baseline | Target | 10-02..10-16 (two-week mark) | 10-02..10-20 | 10-21..10-25 | 10-22..10-25 | Verdict |
|---|---|---|---|---|---|---|---|
| fleet `update-branch` commits | 8 (tool: 2) | 0 | 0 | 10, all on 10-20 | 12, all on 10-21 | 0 | met at the two-week mark (0 on 10-02..10-16); the 10-20/10-21 burst was legacy PRs; 0 since 10-21 22:20 UTC |
| repeat absorptions, per merge | 0.58 (41 of 71) | under 1/3 | 0.45 (70 of 157) | 0.51 (270 of 527) | 0.33 (20 of 61) | 0.24 (7 of 29) | over 10-02..10-16 it fell 0.58 to 0.45 (moved; rule does not fire), target still missed; met after the queue |
| merges per PR (fleet local merges of `main`) | 2.4 (71, 30) | n/a | 1.80 (157 merges, 87 PRs) | 2.05 (527 merges, 257 PRs) | 1.49 (61, 41) | 1.32 (29, 22) | context for the row above |
| ritual syncs per week | about 76 (episodes) | halved | not computable here | not computable here; proxy below | not computable here; proxy below | n/a | proxy only |
| green-to-merge median | 33 min (tool: 32.0) | under 10 min | not read | 1.0 min | 77.7 min (p90 310) | 99.6 min (p90 276) | missed, and the wrong way |
| fleet-on-fleet inversions | 14 | 0 | not read | 125 (153 all actors) | 54 (58) | 36 (36) | missed; the scan's meaning under a queue is doubtful (below) |
| required-leg red hours on `main` | 9.0 h | halved | not read | 47.5 h | 0 h | not run | see the note |
| queue-group ejections (new) | n/a | none set | n/a | n/a | 47 failed runs of 241 completed (19.5%); 45 failure events | n/a | new; see below |

Notes on the rows.
- **update-branch.** Every one of the 22 commits since 10-02 is on 10-20 or 10-21, on PRs opened before the rollout
  (#956, #960, #983, #984, #985, #987, #1069, #1075). There were none from 10-02 to 10-19 (so none at the two-week mark, 10-16) and none after 10-21 22:20 UTC. The
  repository setting that removes the button (`allow_update_branch=false`) came with the queue on 10-21.
- **Repeat absorptions.** The baseline is measured over the ruled two-identity fleet set (the gh login plus the
  placeholder identity that made 37 of the window's 75 merges of `main`): 41 repeats in 71 merges of 30 PRs, 0.58.
  Over 10-02..10-16 (the two-week mark) the share fell to 0.45, which is movement but still misses the one-third target; over 10-02..10-20 it is 0.51, context only, as that window takes in the 10-20 legacy-PR burst. The volume
  fell with the queue: 527 fleet merges of `main` in 19 days (about 28 a day) against 29 in the last 4 days (about 7
  a day). Clause 16 and the queue arrived together, so this run cannot say which earned the drop.
- **Ritual syncs.** The metric is the transcript episode scan, which reads Claude Code transcripts on the fleet box.
  This run was on the build machine, where `episodes --project ccrc-pwa` finds none, so the figure is not
  measured here. Proxy by `remerge`: a merge of `main` whose `--remerge-diff` is empty needed no hand edit. Clean
  merges per measured merge: 10-02..10-20, 301 of 489 (62%, about 111 a week); 10-21..10-25, 43 of 72 (60%);
  10-22..10-25, 11 of 26 (42%, about 19 a week). The proxy halves from about 111 to about 19 a week after the
  queue. The baseline window has too few of its commits in the local clone to compare (66 of 75 unmeasured).
- **Green-to-merge** (a merged PR's final head going green on every required context, to its merge). Before the
  queue the wait was one minute because a coordinator merged at once, with no test of the composition. In the
  queue era it is split by `queue-waits` (PRs merged 10-21..10-25 with a green head and a queue entry in each PR's
  timeline: 194 PRs, 14 merged with no entry, 3 with a head not green): green to the first queue entry **0.5 min
  median** (p90 107.6), last queue entry to merge **38.4 min median** (p90 135.3), green to merge 82.4 min (p90
  318.9). For 10-22..10-25 (164 PRs): 0.4, 54.5 and 99.6 min. A "first entry" is the earliest
  `added_to_merge_queue` event at or after the green time; the "last entry" is the latest such event before the
  merge, so an entry that was ejected and re-added counts from its last add. The wait is therefore NOT before the
  queue: PRs are enqueued within a minute of going green at the median (the p90 of about 107 min is the tail
  that waited for something else). It is inside the queue: one merge_group run is 16.7 min median (p90 29.8, from
  the merge_group runs list), and the remainder is time behind other entries and re-runs. 54 of the 194 PRs were
  added again after a removal. **A median under 10 minutes cannot be reached while one successful entry takes
  17.** An earlier draft of this section put the split at 43 min before enqueue and 17 min inside; that split is
  withdrawn, because its enqueue times cannot be reproduced from the commands below. The `green-to-merge`
  row in the table (77.7 min) is the older subcommand's PR set (PRs created, merged or closed in the window) and
  differs a little from the 82.4 above (PRs merged in the window).
- **Inversions.** The scan dates a PR as ready from its first sync, and counts any PR open then that merged before
  it. A queue lands in queue order by design, so a non-zero count no longer separates a landing-order fault from the
  queue's own ordering. The figures are stated for completeness; the metric needs a redefinition before it can
  gate anything.
- **Required-leg red on `main`.** 0 h in the queue era is real: a queue merge is tested before it lands. The
  10-02..10-20 figure (47.5 h in 6 intervals) is a floor: 198 of 455 pushes ran no test legs after CI test selection
  (#183) and read as unmeasured, as the tool's docstring warns. It is not comparable with the baseline.

### Queue-group ejections (added)

The tool could not compute this, so `queue-ejections` does: every `merge_group` run in the window, a failed one read
down to the failing job's log, the aggregator's "Refuse a prerequisite" job set aside as a consequence, and each
ejected PR checked for a later merge. A cancelled run (2) is the queue dropping an entry behind an ejected one, and is
not counted. 244 runs read (194 success, 47 failure, 2 cancelled, 1 still running); a re-run later the same day read
248 (199 success) and the same 47 failures. The live queue settings are build 2, merge 3, minimum 1, grouping ALLGREEN.

**What a row counts.** A row is one failed merge_group run, named for the PR in its queue branch. Under build-2
grouping the runs of one group overlap, so one breaking change can fail two runs seconds apart, and a failed run is
not always the named PR's own ejection: that PR may only have ridden behind the culprit. The tool therefore also
reports `failureEvents`, which collapses failed runs created within 10 s of each other that share a failing test
(or name no test and the same cause): 45 events, two pairs collapsed (10-24 09:11:27/29, `lane-beats`; 10-25
00:26:37/38, `single-definition`), both real. The pair at 10-25 10:41:53/54 has different causes and stays two. The
per-PR count from the timelines is `queue-waits`' re-queued figure: 54 PRs were added again after a removal.

| Cause (log signature) | Ejections |
|---|---|
| flake: timing or throughput assertion (`sent 0 bytes in`, `Operation too slow`, `expected N to be less than/greater than`) | 18 |
| flake: vitest `EnvironmentTeardownError` on `onUserConsoleLog` (no failed test beside it) | 3 |
| flake: port held (`EADDRINUSE`, `Address already in use`) | 1 |
| flake: `EPIPE` | 1 |
| real: a test assertion on content (totality, single-definition, growth-check, lane characterizations, others) | 20 |
| real: test-tree typecheck (`error TS`) | 3 |
| unclassified (the job died before a test ran) | 1 |

23 flake, 23 real, 1 unclassified by run (by event: 23 flake, 21 real, 1 unclassified). The split is by signature,
so the real count is an upper bound for what the PR itself broke: a content assertion can still be load-dependent.
The timing signature has one known limit the other way: its bare `expected N to be less than/greater than M` form
carries no unit, so a content assertion on a count (`expected 0 to be greater than 0`) would land in the flake
bucket too; this run's 8 timing rows that match only that form were read by hand, and each is a latency, clock, peak-RSS or
slice-size bound, not a count. 35 distinct PRs were ejected at least once and 34
of them merged afterwards: an ejection cost a retry, and no PR was lost. One PR (#1200) was ejected 5 times; 8 others
were ejected twice.
- **One test is 13 of the 47 ejections.** `ccrc-update.test.ts` (the curl-based fetch test, "sent 0 bytes in 2 s")
  failed 13 queue runs on 11 PRs between 2026-10-23 21:06 and 10-24 03:28 UTC and not again in the window. 11 of
  the 13 are in the timing-flake bucket (11 of its 18 rows); the other 2 (#1197, #1203) are classed `real:test`,
  because another test failed beside it.
- **The flakes being fixed.** The vitest teardown race (lane tests leaving a lane running) is fixed by #1379, merged
  2026-10-25; the held port in the codex tests is fixed by #1382 (open when this was written). Together they are 4
  of the 23 flake rows, and all of 10-25's flakes but one; the curl flake above stopped recurring on its own.
- **By day** (flake / real / other): 10-21 2/1/0; 10-22 2/0/1; 10-23 5/3/0; 10-24 9/12/0; 10-25 5/7/0. The queue
  grouping changed to build 2 / merge 3 on 10-24, the day the count peaks. The same day had the curl flake, and
  this run cannot separate the two.
- **A teardown error** names the test file that was running (`collect-*`, `child-reclaim-*`), not the cause; it is
  vitest closing its worker while a console log is pending.

### Kill-rule verdict (spec §10: a stage whose metric has not moved two weeks after rollout is retired or redesigned)

- **Stage 1, prose parts (clauses 15 and 16, the sync advisory): the rule does not fire at the two-week mark.** The
  rule retires a stage only when its metric has not moved two weeks after rollout. Every figure below uses the same
  window, 10-02..10-16. `update-branch` count was 0, so that target was met (the 22 commits on 10-20 and 10-21 were
  on PRs opened before the rollout). The repeat share moved from 0.58 to 0.45, so it moved, though it is still above the
  target of one third and that target was missed. The ritual-sync rate was not measured (it needs the fleet box's
  transcripts). For context only, 10-02..10-20 gives a repeat share of 0.51, a window that takes in the 10-20
  legacy-PR burst. The open question is the missed repeat-share target, not a failed rollout, and the queue
  (10-21) confounds it: what moved the numbers after 10-21 was the queue, and the drop in fleet merges of `main`
  with it. This section does not retire the clauses: with `allow_update_branch` off and the queue in place,
  clause 16's three triggers cover what remains. Whether to retire the advisory or keep it is the operator's call.
- **Stage 2 (the queue), due about 2026-11-04: not yet due, and heading the wrong way on green-to-merge.** The
  median is 77.7 min against the target 10, almost all of it inside the queue: PRs enqueue within a minute of green at the median, then spend 38 min
  from last entry to merge (one run is 17 min of CI; the rest is time behind other entries) and pay for a 19.5% ejection rate. The target as written is not reachable with a 17-minute
  merge_group run. Redesign candidates, measured here: shorten the queue entry's CI; remove the flakes behind 23 of
  the 47 ejections (starting with the one test that made 13); re-define the target as "enqueue to merge" or as the
  wait the queue adds over the PR's own CI, since the queue's job is the composition test that 10-02..10-20 never had.
- **Stages 3 to 5** were not built, so they have nothing to measure.

### Re-running this

The tool writes a cache and one JSON report per subcommand under `--out`; read-only, no `gh` token scope beyond
read. `<fleet-login>` is the fleet's gh login. For a window before 2026-09-23 append the placeholder git identity with a
comma (the baseline needs it; the `absorptions` census lists the actors to choose from); later windows have none. Run from the repository root (`T` is a path relative to it); `<clone>` is a local clone of the repository.

```
T=deploy/measure-landing.py; R=Synapsium-Labs/ccrc-pwa
python3 -I $T required $R --out out
for W in "2026-09-08 2026-09-22" "2026-10-02 2026-10-16" "2026-10-02 2026-10-20" "2026-10-21 2026-10-25" "2026-10-22 2026-10-25"; do
  set -- $W
  python3 -I $T absorptions    $R --fleet-login <fleet-login> --since $1 --until $2 --out out
  python3 -I $T inversions     $R --fleet-login <fleet-login> --since $1 --until $2 --out out
  python3 -I $T green-to-merge $R --since $1 --until $2 --out out
  python3 -I $T main-red       $R --since $1 --until $2 --out out
  python3 -I $T remerge        $R --clone <clone> --since $1 --until $2 --out out
done
python3 -I $T queue-ejections $R --since 2026-10-21 --until 2026-10-25 --out out
# the queue wait split: green -> first entry -> last entry -> merge (reads each PR's issue timeline,
# filtered to added_to_merge_queue and removed_from_merge_queue; GET only)
python3 -I $T queue-waits $R --since 2026-10-21 --until 2026-10-25 --out out
python3 -I $T queue-waits $R --since 2026-10-22 --until 2026-10-25 --out out
# ritual syncs: on the fleet box, where the transcripts are
python3 -I $T episodes --project ccrc-pwa --since 2026-10-02 --until 2026-10-25 --out out
# the queue's entry-to-merge time and the live queue settings
gh api -X GET "repos/$R/actions/runs?event=merge_group&per_page=100&created=2026-10-21..2026-10-25" --paginate
gh api -X GET "repos/$R/rules/branches/main"
```

(Run the loop in bash: zsh does not split `$W` at the space.) The window 10-21..10-25 and the queue-era splits
above were read on 2026-10-25 and end at that day's midday; a later run of the same commands will include more days.

## Carried constraints

- **A run the dead-coordinator lane closes is an operator abandon here** (workspace-lifecycle spec §6, the Landing-order
  bullet; recorded 2026-10-07, where the spec said it already was). Workspace lifecycle's wave 4 (run 314) adds
  `causedBy: 'sweep'` to `closeRun`'s abandon arm. Every landing reading keyed on an abandon treats a `sweep` close
  exactly as an `operator` one. Wave 4's plan measures what landing code keys on `causedBy` today and pins the
  equivalence with a test. A landing plan written after it inherits the rule.
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
- **From Task 7's proof run (2026-10-20).** Never switch the queue requirement off while entries are in it: dequeue
  each entry first, so that GitHub records the removal and the lane can announce it. A queue window on this project
  starts only once the project's sweep is measured finishing within its bound, and inside it (e) is read first: a
  removal the lane does not announce within one sweep ends the window. A rollback that cannot empty the queue (a
  `LOCKED` entry that never clears, entries that keep arriving, or a dequeue that fails) writes anyway, and records
  each such PR as silently dropped, with a comment on it (wave 3c, review 718's F3).
- **From Task 7's re-run (2026-10-21).** The merge queue is on for `main`. Coordinators land with clause 15's
  spelling, and a landed PR's run closes only after its `merged:` notice is proven. GitHub records a removal at a
  successful queue merge, so `queue` never reads `landed`. Until wave 3d ships, a `dequeued:` notice for a PR that
  reads merged is that removal, not a dequeue. The dequeue mail also reaches an open run's coordinator before
  `merging`. A server restart re-writes a `merged` feed event for a run still at `merging` (no second mail).
  Wave 3d merged on 2026-10-21 (#1096); these two sentences hold until each box runs it.
- **From wave 3c's reviews, carried:**
  - A failed sweep's log line names no detail for the agent's deadline kill (review 718's F10).
  - Task 7's runbook, the by-hand rollback (review 726):
    - its sentence says a run that printed `STOP:` "did not read the queue", where it means its last read failed;
    - it does not point at the Expected paragraph's record-and-comment step for a `DEQUEUE FAILED` or
      `STILL LISTED` PR;
    - a `STOP:` after an earlier pass dequeued entries exits before the `seen` print, in the full block too. The
      re-run reads the queue's removal events itself before relying on `seen`.
  - Test (h)'s comment's last clause holds for the commit/blob collision only (review 726's F6).
- **From wave 3d's review (759), carried:**
  - The sentence that GitHub records the `merged` removal "at or one second before" the merge is false for one
    measured merge (F1). A later wave rewords it, to "within a second of the merge, either side", in ccd's
    queue-block header, the `ccd-pr-queue` comment, the spec's §5.2 amendment, README's queue paragraph and
    `prstate.ts`'s `landed` gloss.
  - An open PR whose last act is a removal with reason `merged`, and that never reads MERGED, reads `landed` on
    every sweep with no notice, and the stall watch skips a run at `merging` (F4). Not seen. A backstop, a bound
    on a run at `merging` or on an open `landed` across sweeps, is a later-wave candidate.
  - "Three repeats remain" leaves out a fourth: a feed-archive write that throws (F2). A row written before wave
    3d repeats once whenever its body's reason clause has changed, a hold placed or released included, not only
    when its run has closed (F3).
  - `sweepPr`'s docstring still calls a restart's loss of the latch a silently replaced notification (F5).
    §5.2's query bullet keeps the rationale the wave 3d amendment disproves (F6). The MERGED `none` cases carry
    no number and no list as a reason (F7).
- **From wave 3b's review (1109), carried:** two other readers of `GET repos/<slug>/rules/branches/<base>` take one
  page, as the probe did before its fix round: `ccd/ccd`'s landing-rules read and `deploy/measure-landing.py`. A
  later wave pages them, or treats a full page as unmeasured.
- **From wave 3e's review (1141), carried:** clause 15's whole-line pin checks that the line exists, not how often. A
  verbatim copy of clause 15 left elsewhere in SKILL.md, beside a rewritten real one, passes. A later wave asserts
  that SKILL.md splits on clause 15's line into exactly two parts (D-6345).
- **From wave 3b's reviews (1140, 1143, 1158 and 1171), carried.** Each fails closed: wave 4 never accepts on what it
  leaves, and a bad registry row never stops another row from being measured.
  - **rc 1 and git's name lookup.** `rev-parse --verify -q` answers rc 1 for a missing ref and for one git ignores as
    broken or cannot read. It also resolves a missing but well-formed branch through another ref of a matching name,
    such as a tag named `refs/heads/ws/<x>`. `git show-ref --exists` tells both apart (D-7391), but it adds a verb to
    the probe's git door, so it is a later wave's. Wave 4's reader reads a claim's live tip by its full ref name
    exactly, never through git's name lookup.
  - **A null `id`** in `probe` means one of four things: no row names the head's branch, more than one does, the only
    one that does is held, or the registry could not be listed. The record does not say which (D-7393). Waves 4 and
    4b read the registry state themselves before trusting a null `id`, or add a marker to the probe.
  - **An interrupted tick** reads as a running one until the next tick. A later reader that must tell them apart adds
    an explicit marker (review 1140).
  - **What a killed tick can leave.** A SIGKILLed tick can leave a `.lp.*` temp file, or a scratch directory with no
    marker file. A removal that takes the marker file first and then fails, or is SIGKILLed, leaves a remnant. No sweep
    clears either. The remedy is to remove the marker file last.
  - **The option-table census is a tripwire, not a boundary.** It does not see a refused builtin reached through the
    builtins module (`globals`, `getattr`, `vars`, `exec`, `eval`), through a frame's `f_builtins`, or under a name
    built as a string. Its known-limit paragraph names the first as a class and covers the others by its string
    clause.
  - **A `ws/` branch whose name contains a git setting the probe pins on every call** (`core.fsmonitor`,
    `core.hooksPath`) passes ccd, git and the probe's grammar. The git door then refuses it, so that row never gets a
    lineage file. Two sentences are reworded later: the grammar comment's "covers every name ccd writes", and
    `qualifying`'s "decided, logged once" (it is once per refused row).
  - **Wording and pins left by review 1171:**
    - no test pins that the two `lineage-skip` lines stay apart;
    - README's and `project_rows`' "a shape git forbids" is true only of the ruled shapes: the grammar also holds
      git-valid names such as `ws/a+b`;
    - the census header's "a call's keyword" understates an arm that counts any keyword;
    - the notes' undecided-rows row and `qualifying`'s docstring name only some of the failure routes that rewrite
      with `tip: null`;
    - README and the PR body still list an alternates failure under the before-first-write fallback's
      `fetch-failed`;
    - the doctor header's and the notes' no-checkpoint cases leave out an all-cross-repository PR list and a spent
      budget.
- **A project the tick budget leaves unstarted** keeps its old lineage files while `enabled` stays fresh, and the
  tick takes projects in sorted order, so the same tail project can miss every tick (review 1125's N6). Wave 4's
  lineage freshness bound makes that fail safe (D-7268). A later wave may rotate the order.
- **From wave 2b's reviews (1184 and 1195), carried** to the next wave that edits `ccd/session-hook.sh`. Four of them
  are passes: a NUL-padded or symlinked `.project` and an allowance directory symlink or hard link, each only through
  planted state; the `xargs` bulk merge, a listed class; and the dispatcher jq's fail-open, older than this wave. The
  rest are wording, pins or an extra refusal:
  - **A NUL-padded or symlinked `.project`** reads as the allowed project, because the registry reader drops NUL bytes
    without counting them and follows links. List both in the allowance header with a pin each, or close them with the
    generation reader's `read -d '' -n` probe and a `-L` refusal.
  - **The other `.project` readers and the hold reader** have the same cut-then-trim shape with no check of the raw
    length. They decide display, grouping or an extra refusal, never a pass.
  - **An allowance directory that is itself a symlink, and a hard link to the allowance file,** both pass. The header
    describes only the test on the file, so code and header agree.
  - **A bulk admin merge through `xargs`** passes under the cap and is refused over it. It is wave 2's listed `xargs` head
    class; closing it changes wave 2's grammar for every worker.
  - **The dispatcher jq** exits the whole hook on a lone UTF-16 surrogate escape: a fail-open older than this wave.
  - **Wording and pins:**
    - the header credits the glued `pulls/<n>;x/merge` to the separator-bounded reading, but the space-free one
      refuses it;
    - the new comments' "filled the read" holds for NUL-free files only;
    - add the 127/128 boundary pair as a control;
    - a control's title says ccd writes a newline, which it does not;
    - the new PullRequest prefilter control is masked by an older assertion;
    - the allowance header and README list fewer refusals than the code makes;
    - the `\u` listed pass pairs `--input -` with `-f query=`, where gh encodes the value, so that call cannot merge.
  - **jq 1.6 and 1.7** are unmeasured; only 1.8.1 was installed where the wave was measured.
- **From wave 4's reviews (1212 and 1216), carried to wave 4c** (landed in #1911, except the re-proof, which is the operator's (D-7472), the review-cap ask, which is another programme's, the close after a second merge, carried to wave 5; the lenient chains and times, closed 2026-10-30; and the header's
restatement, taken by wave 5a). None of them accepts wrongly a doc the radar writes:
  each fails closed, or needs a hand-written file within the attribution-grade reach the plan states.
  - **The parser header** says the parser reads only the radar's shapes. But a measured doc with no `branch`, a cut walk
    with no `why`, a measured doc with a `why`, and an `unmeasured` doc with an 8-entry chain still accept. Require
    `branch`, make `why` agree with `state` and an 8-entry chain with `stop: 'limit'`, then restate the header. Until
    then, it reads "an inconsistent `state`, `stop`, `base` or chain is unreadable".
  - **One "radar control"** has a sha base, an empty chain and a null stop, which is not a radar shape. It answers a
    wait, never an accept. Move it out of the controls, or refuse it.
  - **The base before a PR exists.** The opt-in paragraph reads `baseRefName` from the PR, but a first worker brief comes
    before one exists. Add the fallback: the default branch.
  - **The head-null merged brief's case** asserts less than its comment says. Assert equality with `main`'s text.
    (These items, the base and the dequeue brief are planned in wave 4c's plan, D-7469, D-7470 and D-7473.)
  - **A train-landed line** answers `merged` before any head check. The coordinator's MERGED proof still refuses a
    different head. Pin a train-landed line under a lineage-accepted episode head.
  - **The review-cap ask** carries the newest `review-done` report, which can be a `TIP MOVED` one that is never ruled
    on. Carried to the programme that owns the review cap (D-6795, D-6910, D-6911): the ask is the operator's, and the
    PWA sheet must say what the notice says (Decisions, 2026-10-29 18:40).
  - **A coordinator-side re-proof of the chain** before a lineage-bound landing. It would walk the verified head back to
    the reviewed tip, checking two parents, a second parent on the base and a clean merge tree, so the files become
    hints. **The operator's decision (D-7472).** A walk in the coordinator's checkout can be redirected by writes any
    fleet session can make, so the design needs a stated stopping line (Decisions, 2026-10-29 18:40).
  - **The dequeue brief** reads the current episode's head without checking the run's state. So a run sent back and
    later dequeued could print the earlier episode's head.
  - **A close after a second merge following the wave-done** records a third sha. Clause 9 forbids that merge, and the
    MERGED proof comes first.
  - **Lenient chains and times:** closed (Decisions, 2026-10-30 03:40). Cycles, duplicate entries and `p2 === p1` are
    refused on `main`, and wave 4c kept `Date.parse` through `freshWithin` on purpose.
- **From wave 4c's review (1220) and its landing, carried to wave 5; taken by wave 5a** (#1960 `d196d8b3`; Task 1, D-7528 and D-7529; D-7495's question ruled as D-7536, though read 5 judges only the latest run of each name, D-7546). Each fails closed or is text.
  - **F2.** The unmeasured half of the `state`/`stop` rule (wave 4 fix round 1) can no longer go red: wave 4c's two
    unmeasured rules refuse every doc it refuses. Delete it, or keep it as a stated belt with a measured red.
  - **F3 and F4.** The parser header says it refuses every doc the radar cannot write, and that the accept row is
    reachable only through the radar's shapes. Docs the radar cannot write still parse and accept, though none widens
    what `decideLineage` accepts, and a null `tip` with a sha `base` parses and answers `tip-unmeasured`. Restate the
    header, and D-7469's text, to the measured rules, and decide whether to refuse a null `tip` with a base.
  - **F8.** No lane-level case dequeues a run sent back to `working`. The verdict-level cases pin the arm, and the
    review measured the production loop. An optional pin.
  - **The verdict's reading of several check suites on one head (D-7495).** It calls a required name red if any run of
    it on the head failed, which is stricter than GitHub's rule that the newest run counts, because a later passing run
    of the same name could hide a real failure. But it leaves a main-red fixed on `main` no route through a rerun. Decide
    between judging the newest run per name, app and workflow, and keeping the rule while the skill names the new-head
    route.
- **From wave 4b's reviews (1225 and 1226), carried to wave 5; taken by wave 5a** (#1960 `d196d8b3`; D-7530 to D-7535 and D-7538), apart from the residual of the first item (D-7547, below). None fails on a healthy box at today's scale: each
  needs an unreadable file, a hostile listing or a much larger fleet, or is text or a gap in a test or guard.
  - **A row whose `.project` the server cannot read** is filed under its own id, so its branch is absent from its
    project's rows while the radar gives that branch's head `id:null`. `unbound` can then be missed for that head, and
    the project's landings can read clean. It needs an unreadable `.project` (review 1225, F5).
  - **The chip's sentence** has no length cap: ten heads of twenty 300-character paths measured a 334,403-character
    accessible name. "(list cut)" names three different cuts, and the partial clauses name no PR or project (F6).
  - **Hardening at scale and against a hostile `FleetIO`** (review 1225, F9). Only the first needs a listing a real
    `readdir` cannot return; the rest are scale and fault cases:
    - the radar's reads apply no `isSafeProjectSegment` to the listing;
    - a newline in a project name forges a second log line;
    - the per-project fan-out is unbounded;
    - the deadline covers the reads only, so a hung local listing never settles, and an abandoned pass released
      later overwrites a newer map with an empty one;
    - a thrown listing warns on every pass.
  - **The smaller gaps of review 1225's F4:**
    - no case checks that the chip sits after the hot-files strip;
    - one test's title names the broadcast but asserts only `currentLandings()`;
    - `core-vocab`'s D-7514 scan skips a reader file that no longer exists, and does not see a server reader's
      `new Date(`;
    - no guard pins that `landingOf` is the PWA's one reader.
  - **Two comments still say the cold frame is what the watcher last broadcast:** `server.ts`'s comment above the cold frame
    and `watch.ts`'s `currentFleet` docstring. Since fix round 1, a cold frame past the window drops the landing, and
    the next tick that can list the registry corrects it. Correct both (review 1226, F1).
  - **The G6 case's title says "re-aged"**, but its second tick runs inside the window, so it pins the hand-off and
    the kept map only. Retitle it (review 1226, F2).
- **From review 1222 (the retire-verdicts fix, D-7496), for the next wave that edits that test; taken by wave 5a** (#1960 `d196d8b3`, D-7539). No present failure.
  - The guard compares the extracted `ccd/lib` names with the base's, never their contents; compare blob ids.
  - The extraction drops each entry's mode, so a symlink or an executable library would extract as a plain file.
  - `baseCcd()`'s comment says it never throws at collection time, but its temp writes can.
- **From wave 4's review 1216, for the next wave that edits the merge-train proof text (#1797).** The second item is
  taken in §5b's prose by wave 5a (#1960 `d196d8b3`, D-7537), and the verdict block still prints the `CLOSED` stop; the
  first is left for stage 5. Both fail closed: the coordinator reports instead of acting.
  - A train-landed spent producer cannot prove its landing once its row is reclaimed, because the proof reads
    `ccd pr-state --session <id>` after the close.
  - §5b's prose and verdict do not name the `landedInTrain` alternative that step 3 accepts.
- **From wave 5a's review (1232), carried to the next wave that edits each file.** Each is text or a gap in a guard,
  or fails closed, apart from the first, which needs a corrupt or hand-made registry file (D-7547).
  - **The server's `.project` reader takes the radar's rule** (D-7547): no symlink, one line, UTF-8, at most 4096
    bytes. Restate `radar.ts`'s comment on held rows and the `ProjectEvidence` docstring's `absent`.
  - **The chip** (D-7548): restate the `conflictWords.ts` header and Review Focus 3's three to four. Either bound each
    path in the PWA reader, or restate the claim to the 300-character wire bound.
  - **Two guard gaps the review's own mutants survived:**
    - an abandoned pass that speaks, with `gen !== this.radarGen` moved below the `said` line;
    - a second reader of `projectEvidence` inside `registry.ts`.
  - **Local-mode io past the deadline.** `localIO.readdirMeasured` ignores `timeoutMs` and `signal`, and `lstat` and
    `stat` take no signal, so the reader's "the read is aborted" holds for the last step only. The remote adapter
    honours both, so the live server is not affected.
  - **The `ProjectEvidence` docstring** says nothing decides on `project`, but several deciders still read the folded
    id. One is `lineageQualifies`, which answers `lineage-not-expected` for an unreadable `.project` where the honest
    word is unmeasured. Every one fails closed.
  - **Text and wrap:**
    - the golden's comment in `registry-bounded-read.test.ts` still says the golden was generated on the base;
    - §5b's "On every route" paragraph needs rewrapping;
    - once the operator answers D-7536, one clause saying when the new-head route is taken;
    - `trainUnread` has two remedies under one word;
    - the `mergeBaseFiles` docstring omits its `null` answer.
  - **Guard reach:**
    - the `new Date(` scan reads `watch.ts`, `server.ts` and `fleet.ts` whole;
    - T4-2's two scans go red by a bare ENOENT, not by their own message;
    - the double-quote census leaves out two new sentences of §5b.
- **SAFETY.** Never a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`,
  `~/.cc-limits` or `claude-session@*.service` directly; fixture HOMEs only in tests; `gh` stays off the exec
  whitelist; never print secret contents.

## Next-wave brief

Waves 1–3, 2b, 3b, 3c, 3d, 3e, 4, 4c, 4b and 5a are merged (#231 `10f32755`, #234 `0087a045`, #1863 `d3250900`, #248 `9a255a74`,
#1740 `3ca67389`, #1046 `4ce282f8`, #1096 `e173c1aa`, #1127 `7e38b5f4`, #1884 `f6b67a5b`, #1911 `9ec4fc54`, #1923 `85d61aa8`, #1960 `d196d8b3`). Task 7's re-run on 2026-10-21 turned the merge queue on for `main`, and
it stays on by the operator's ruling (Decisions, 2026-10-21 12:15). Wave 3d answers its stop rule 6: a removal whose
reason is `merged` reads `landed` (Decisions, 2026-10-21 14:49 and 19:17).

**Wave 3d's deploy and live proof come first.** The operator moves both boxes with ccrc's updater. Then the
coordinator reads, read-only, what the plan's Task 6 names: the next queue merge of a bound PR reads `merged …
landed`; no `dequeued:` notice names a PR that then reads merged; after the deploy's own restart, at most one
extra `merged` row per merged workspace whose pre-wave-3d row's reason clause has changed (review 759's F3); and no
second `merged` row after a later restart.

**Wave 3e is merged and proven** (#1127 `7e38b5f4`): the landing route from the repository's own rules (spec §5.7).
Its live proof finished with #1740's landing (Decisions, 2026-10-29 06:01). Next in that line is wave 3f, whose fix
shipped in #1383; its plan's measurement of the 30 s sweep cadence's cost is left.

**Wave 3b is merged** (#1740 `3ca67389`; Decisions, 2026-10-29 06:01): `ccd-land-probe`, the read-only conflict radar.
- **Deploy.** The fleet box's installed release read v0.0.811 on 2026-10-29, the first release that carries it. Doctor's `services` and
  `land-probe` lines are expected to read SKIP while no project has a conf.
- **Proven live** on 2026-10-30, with `lineage=off` (Decisions, 2026-10-30 10:50).
- **The proof never sets `lineage=on`.** That is wave 4's to arm.

**Wave 4 is merged** (#1884 `f6b67a5b`; Decisions, 2026-10-29 17:38). A clean merge of `main` keeps its wave-done and
its review, for a project the operator opts in.
- **Deploy.** ccrc's updater carries the skills before the server (AGENT-FIRST, plan Task 4 Step 3).
- **Arming is the operator's:** `lineage=on` in the radar's conf for `ccrc-pwa`, after wave 3b's live proof with
  `lineage=off`.
- **The live proof** is the programme's next work run whose worker absorbs the base cleanly after its wave-done. The
  advance with the original claim answers `verifiedHead`, the landing binds it, and the ledger records both shas. That
  run's brief names the opt-in and the base: a PR's `baseRefName`, or, before a PR exists, the repository's default
  branch (wave 4c, D-7473).

**Wave 2b is merged** (#1863 `d3250900`; Decisions, 2026-10-29 09:41): `--admin` and `gh api` merges are refused in every
fleet session, with the operator's per-project allowance (D-7249).
- **Deploy.** ccrc's updater carries the hook to every home (AGENT-FIRST).
- **The live check, plan Task 3 Step 4,** holds (Decisions, 2026-10-30 10:50). The operator's allowance file
  (D-7249) was written on 2026-10-30 at the operator's instruction (Decisions, 2026-10-30 23:24).
- **From then on,** the landing verdict, the checks gate and the enqueue run as separate commands (D-7314).

**Wave 4c is merged** (#1911 `9ec4fc54`; Decisions, 2026-10-29 22:55): the lineage parser refuses the docs the radar's
rules rule out (a measured doc with no `branch`, a `why` that disagrees with `state`, an 8-entry chain not at `limit`, a
`p1` equal to its `p2`), though it still reads some docs the radar cannot write (carried to wave 5); the radar files'
freshness rule is one predicate (`freshWithin`); the dequeue brief prints a head only at `merging`; and a first brief
names its base before a PR exists. It ships with the next release: the skill sentence through ccrc's updater, skills
before the server, and the rest with the server. Nothing in it needs arming, and `lineage=on` stays the operator's.

**Wave 4b is merged** (#1923 `85d61aa8`; Decisions, 2026-10-30 02:32). The server reads the radar's probe for each
project a fleet session belongs to. A session whose current PR matches a head the radar measured, in a probe within its
window, carries `FleetSession.landing`, and the PWA shows a read-only predicted-conflict chip. No send carries a landing
past its window, and the chip ages a frame it already holds.
- **Deploy.** ccrc's updater carries the server and the PWA. The order of the two boxes does not matter, because the
  wave reads files wave 3b already writes.
- **The live read** (plan Task 4 Step 4) is the coordinator's, read-only, once a project has a conf: `GET /api/fleet`'s
  `landing` for that project's bound sessions, and the chip. The ledger then records the release, the rollout date
  (which starts §10's stage 3 clock for the operator's view only, D-7483) and the first fresh landing seen.

**Waiting on the operator** (Decisions, 2026-10-30 23:24): question 3 (the `lander=` key), D-7546, D-7472, a look at
wave 4b's chip, and whether the PRs that must carry `CLAUDE.md` lines wait for the operator's read.

**Wave 5a is merged** (#1960 `d196d8b3`; Decisions, 2026-10-30 08:16). It carries the hardening that the reviews of
waves 4c and 4b, and three older review items, left for wave 5:
- the lineage parser refuses a null tip under a base;
- the radar lane's pass is bounded, under one deadline that covers its listing, with a generation;
- an unreadable `.project` stays a fact;
- the chip's sentence is capped, and the radar's cut and an unbound head have sentences of their own (a path-list cut
  stays a note on its own line, D-7548);
- §5b names the new-head route and the train-landed proof, and its verdict block is unchanged.

Deploy: ccrc's updater carries the server, the PWA and the skill text.

**Wave 5**, the landing line, is split into sub-waves 5b to 5k (Waves table; Decisions, 2026-10-30 23:24). Questions
1, 2, 4 and 5 and D-7536 are answered.
- **5b and 5c are planned** and share no file, so they run in parallel: `docs/superpowers/plans/2026-10-30-landing-order-wave5b-landing-skill-text.md` and `docs/superpowers/plans/2026-10-30-landing-order-wave5c-pr-keyed-pr-state.md`. 5b's Task 2 (D-7546)
  waits on the operator, and is dropped if the operator rules against it.
- **5c reaches the fleet box** before 5h reads it.
- **5d waits on question 3.** 5e to 5k are planned in order, each against `main` as it then stands.
