# Program: child-reclamation

Spec: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`
Plans: `docs/superpowers/plans/2026-09-22-child-reclamation-wave{1,2,3,4,5}-*.md`
Contract: `docs/superpowers/programs/child-reclamation-contract.md` (cross-wave names and types; §7–§8 rulings)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-mesa`   Workspace: **a fresh one per wave**
Ticket: CCR-15

**What this program is.** A workspace the coordinator dispatches is a *child*: declared as one by the server
at creation, never tended by a human, used for at most one PR, and reclaimed with its artifacts when its run
closes. Every other workspace — the operator's, the coordinator's, and every workspace that exists before
wave 1 ships — keeps today's human cleanup ceremony exactly. The operator's four rules and four rulings are
quoted in the spec's §1; §3 argues why an automatic collector is safe on this population when the one
removed on 2026-09-10 was not.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | `--child <runId>` on ws-add behind `child-argv-v1`; the `.child` marker; a child's `TMPDIR` under `~/.cc-tmp/<id>` on every spawn; the scratchpad measurement; the pre-policy count | **AGENT-FIRST** | #175 | **deployed** v0.0.19 (`bbb5e714`, 2026-09-23 15:46–15:51 UTC; run 131 on `keen-hollow`; reviews 135, 136) |
| 2 | the registry's three-way child reading; the three-valued spent verdict with a live measurement; `workspace-spent` and `spent-unmeasured` at open and at dispatch; dispatch clears a spent binding | server | #178 | **deployed** v0.0.22 (`37d9da66`, merged 2026-09-24 00:25 UTC, rolled out by 00:33 (rc 3: the server box's known inactive agent unit); run 138 on `plain-river`; reviews 144, 145, 147). Live measurement: an open naming `ccrc-pwa-plain-river` answered `409 workspace-spent pr:178` and left no run row |
| 3 | `ws-audit --reclaim` and its token; `ws-reclaim` with its own ladder, pin phase, tail arm and breadcrumb; the `reclaim` journal act; close's fourth act; delivery cancellation | **AGENT-FIRST** | #187 | **deployed** v0.0.33 (`1ffdf947`, merged 2026-09-28 16:14 UTC, rolled out 16:16–16:21, fleet box first, rc 0; run 148 on `plain-summit`; reviews 170, 171, 172). Live: run 148's close reclaimed `plain-summit` in 10 s |
| 4 | the reclaim sweep over marked children; `ccd reclaim-pause` and its route and Runs-screen toggle; the attention list of unreclaimable children in the Runs banner; R32/R33 as built (contract §10); the carried ccd, prose and test items | **AGENT-FIRST** | #215 | **done** — accepted by convergence review run 258 on `f8f0af9a`; merged as `b40f4145` 2026-10-04 22:10; release v0.0.79 |
| 5 | the closed run's reclaim chip and its sentences; R25's orphan temp-root collector (R36) | **AGENT-FIRST** (R36 makes it one) | — | **planned** — run 260 opened 2026-10-04 with its block; plan amendments before dispatch |

**Rule 3 is enforced at the end of wave 2** with no destructive verb in existence: a second bind on a
PR-bearing child refuses. **Wave 3 is the only wave that destroys anything.** Waves 3 and 4 do nothing on a
box whose ccd does not advertise their capability tokens; wave 2 does nothing to a workspace without a
marker, which is every workspace until wave 1 is deployed.

**This programme follows its own rule 3 from wave 1.** Every wave runs on a freshly dispatched workspace and
the coordinator opens wave N+1 without `sessionId`. Nothing enforces that until wave 2 ships; the
coordinator does it anyway, because a programme that builds one-PR-per-child while reusing one workspace
across five PRs would be arguing against itself.

**Deviation block: forty numbers, the first of them 3330** (allocated once at run-open, 2026-09-23; floor now
3370). No number of the block is spelled as a `D-` token here until a plan DEFINES it: `deviation-refs.test.ts`
reds on any tracked `D-` ref above the highest defined one, so an issued-but-undefined number in this file
would turn every commit red. Every wave draws from this block. A worker never calls the allocator (worker
clause 11): it names a departure in its wave-done mail and the coordinator assigns a number from the block.

Run ids: wave 1 = **131** (reviews **135**, **136**); wave 2 = **138** (reviews **144**, **145**, **147**); wave 3 = **148** (reviews **170**, **171**, **172**); wave 4 = **174**. Numbers defined so far: D-3330 … D-3339 in the wave-1 plan, D-3340 … D-3351 in the wave-2 plan. Wave 3 draws from the rest of the block.

## Decisions & deviations

- **2026-10-05 14:31 — the backlog has drained; wave 5's "measure first" item is measured.** Read-only.
  - **Drain:** 90 sweep reclaims, the last at 14:19, about one every 70 s from 12:36, with no presence wedge seen.
    3 failures, all the same child.
  - **Left, with reasons (10 children whose own run is finished):**
    - Six are review children of `eng-metrics-way-forward`, whose work runs 183, 187 and 198 sit at
      `awaiting-review` since 2026-09-30 and 2026-10-01. That rule is `review-report-live`: they leave when those
      runs settle. That programme's coordinator owns the settling, not this programme.
    - `bright-hollow` (review 267 of run 250) and `plain-hollow` (review 268 of run 248) are kept by the same rule.
      Their work runs are `working`.
    - `brisk-meadow` (review 171 of run 148, both `done`, no `.hold`) is passed over with no feed row. That skip is
      invisible by construction. It is wave 5's attention-list item (R37/R-5d skips) in a live case.
    - `expoAI-assistant-calm-mesa` (run 139) fails `pin-failed: refs/heads/ws/calm-mesa does not resolve … there is
      no branch tip to pin` at 14:04, 14:20 and 14:24. It fails closed, retries, and will reach the attention list.
      **New for wave 5:** a child whose branch is already gone can never be reclaimed today. Wave 5 decides what
      may be pinned instead (the worktree's HEAD) or names the operator act.

- **2026-10-05 13:33 — what a reclaim frees, and what it leaves.** Measured read-only, for the operator's
  idle-process question.
  - **Browser MCP servers:** no real headless Chrome was running. The memory is `playwright-mcp` (74 processes,
    about 1.3 GB) and `chrome-devtools-mcp` (102 processes, about 2.1 GB). Every session starts both, about 74 MB
    per session. Attributed by pane scope: about 1.3 GB sat in 7 finished-run children, which the sweep takes;
    about 0.25 GB in 2 open-run children; and about 2.4 GB in 14 sessions that are not children (coordinators and
    hand-made workspaces), which reclamation never takes (rule 4).
  - **A reclaim does end them:** 39 sweep reclaims by 13:21, and running children fell from 31 to 19, yet no pane
    scope without a `claude` process held an MCP server.
  - **What it leaves:** reclaim ends a pane with `tmux kill-session`, which does not stop the pane's scope. 13 such
    scopes hold detached stragglers, about 25 MB together, some 21 days old. One more held a SessionEnd hook's
    900 MB parse, which was transient. This programme does not own that fix: session-continuity wave 4
    (`ccd-scope-sweep`) and wave 9 ("ccd stops a pane's scope when it ends the pane", every verb including reclaim)
    do. Wave 5 does not duplicate it.
  - **Not reclamation:** the graph sweep's 14 kills in 7 days are its own `MemoryMax=4G` cgroup OOM
    (`ccd-graph-sweep.service`, `oom-kill`). The trees near the kills are mostly `MekWarLive/swift-harbor`, then
    `expoAI-assistant/identity-flake`, neither of them a child.

- **2026-10-05 13:06 — the fleet converged past v0.0.79 and the sweep is live.** Measured read-only.
  - **Convergence:** the halt cleared overnight. The updater sent the fleet box v0.0.84 at 12:22 (from v0.0.78)
    and the server box v0.0.84 at 12:34 (from v0.0.76). The fleet box's `update.json` reads `done` for v0.0.84, and
    `ccd caps` lists `reclaim-v1`, `reclaim-pause-v1` and `lifecycle-v1`.
  - **First passes:** the first sweep reclaim landed at 12:36 (`amber-basin`, run 230). By 13:03, 24 children had
    gone, one in flight at a time, about one every 70 s, in id order through `clear-summit`. Every feed row reads
    "Nothing uncommitted was left". The feed has no `child reclaim failed` row since the sweep went live.
  - **What remains (13:03):** 81 child markers. Of those, 75 are children whose runs have all finished: 25 running
    panes in the Released fold and 50 stopped rows that were already archived. The other 6 belong to open
    runs. Two children earlier in id order were passed over. `bright-hollow` reviewed landing-order run 250, which
    is still `working`, so it is kept as ruled. `brisk-meadow` (review 171 of run 148, both done, no `.hold`) has
    no reason measured yet. It is checked again once the backlog drains.
  - **Not this programme's:** 21 unmarked workspaces are archived with finished runs or none. The sweep never takes
    them (rule 4). Their 7-day expiry is workspace-lifecycle wave 3: the plan was merged as #252, the `ws-expire`
    verb ships inert, and the lane that calls it is wave 3b.

- **2026-10-04 23:41 — still halted; no further checks scheduled.** Re-measured read-only at 23:41. The fleet box's
  `~/.ccrc/update.json` still reads `phase: failed` for v0.0.78, written at 22:10 and not changed since. `ccrc
  rollout --to v0.0.79 --check` still reports the fleet box on v0.0.78 and the server box on v0.0.76, both behind.
  The feed has no update event after 22:02's queued v0.0.78 run. The halt lifts only when the operator acks the
  fleet node from the Updates screen. Convergence and the first sweep passes are measured after that ack, not by a
  timer.

- **2026-10-04 22:59 — v0.0.79 has not converged: a failed v0.0.78 row on the fleet box halts the updater.**
  Measured read-only at 22:57.
  - **Where the boxes are:** `ccrc rollout --to v0.0.79 --check` reports the fleet box on v0.0.78 (`f789d97d`) and
    the server box on v0.0.76 (`698f679d`), both behind. The fleet box's projection says channel dev, desired
    v0.0.79, auto channel.
  - **Why nothing moved:** the fleet box's auto update to v0.0.78 was queued at 22:02. At 22:10 it wrote
    `phase: failed`, because its supervisor sweep restarted `claude-session@ccrc-pwa-still-summit.service` and the
    unit did not stay up. The box installed v0.0.78 anyway (`ccrc version`: `install: complete`). A failed node
    halts every move in the fleet until it is acked (`dispatch.ts`, refusal `halted`), so v0.0.79 has been sent to
    neither box.
  - **Who has it:** `ccrc-pwa-bright-river` filed "update v0.0.78 failed falsely: serial sweep verify vs a hand
    archive" at 22:24. `still-summit` measures stopped now. The ack is the operator's act, from the Updates
    screen (`POST /api/updates/ack` is session-only). This programme neither acks nor rolls out.
  - **The sweep is not live:** `ccd caps` lists `reclaim-v1` but not `reclaim-pause-v1`. There are 99 child
    markers, none without a row: 63 rows stopped (62 at 21:25) and 36 running. Close-time reclaim still works:
    `swift-hollow` was reclaimed at 22:12 when run 174 closed.
  - **Next:** one more one-shot check at about 23:40, read-only.

- **2026-10-04 22:12 — convergence review run 258 accepts wave 4; PR #215 merged; wave 5 opened.**
  `ccrc-pwa-keen-mesa` read `f8f0af9a` (31 agents, none dead or empty; `unverifiedLenses` and `unexamined` none).
  - **Panel:** 9 raised, 7 confirmed (6 distinct, G1 to G6), 2 refuted 3/3. Every finding is minor; none is
    critical or important.
  - **SAFETY holds:** no path removes or commits away a live child. Fix round 1 only removes licensed asks or
    sightings, and every new guard goes red under mutation. Seeded interleavings found 0 licensed asks without a
    continuous, fresh presence chain by the implementation's own clock (seeds 1–300, 11,760 requests, 57 licensed),
    and review 254's F1–F6 are resolved as ruled.
  - **Ruling, G1 (round, conditional).** "Answer" in the 15:13 and 15:52 rulings means the pass time of the request
    it answered. That is A9 item 1's `nowMs` convention and the field's docstring, and the 15:52 arithmetic counted
    between asks. So it is no departure. The residual: a real observation can trail its request, so consecutive
    observations may be up to about 300 s apart while the requests stay within the bound. Freshness at the ask still
    holds in real time. Stamping at arrival is carried to wave 5 together with G4.
  - **Ruling, G3 (round).** Accepted as the stated cost of the F1 rule: while three or more children stay
    presence-held, each is asked every third pass and its episode restarts at every answer, so none is ever licensed.
    That fails closed; liveness is the only cost. It is spec §5.7's named wedge ("Unbounded would be worse than
    absent") in that case, so **wave 5 must bound it**, for example with continuity measured per pass the child was
    due, or a gap scaled with the due count. Wave 5 also states it truthfully in A9, the docstring and lens 1's
    sentence.
  - **Acceptance under the convergence rule:** the SAFETY lens holds and no confirmed critical or important finding
    stands. The round introduced no behavioural defect: G2 is a false reason in a comment, G3's behaviour is exactly
    the ruled rule, and G6 is a report line count. They join the carried class, as review 215's F1 did for
    row-placement. G4 and G5 predate the round and carry to wave 5.
  - **Landing.** `main` moved to `f789d97d` after the reviewed tip: #241 changed `watch.ts`, `store.ts`,
    `shared/api.ts` and `README.md`, and #243, #244 and #245 were docs. GitHub's merge ref stayed on the older base,
    so the coordinator built the exact combination locally, a scratch commit never pushed (tree `031992de`). On it:
    - `tsc` was clean;
    - census, deviation and store suites passed (7 files, 594 tests);
    - stall, sweep, close, asks and auth suites passed (13 files, 1,381 tests);
    - the README and citation pins passed (96 tests).

    Run 174 then advanced to `merging`, and `gh pr merge 215 --squash --admin --match-head-commit f8f0af9a…` landed
    `b40f4145` at 22:10:25Z with a coordinator-written message carrying no deviation number. The merged tree equals
    the tested tree. `release-main.yml` published prerelease v0.0.79 at 22:11.
  - **Wave 5 opened first, then wave 4 closed.** Run 260 (wave 5) opened `planned`, and its block was allocated at
    run-open: 3926, 3927, 3928, 3929, 3930, 3931, 3932, 3933, 3934, 3935, 3936, 3937, 3938, 3939, 3940, 3941, 3942,
    3943, 3944 and 3945. Run 174 then closed `done`, not final, with `prPhase` `merged`, answering `childReclaim:
    queued` for `swift-hollow`.
  - **Evidence kept.** The review reports for runs 212 to 217, 222, 254 and 258, and `swift-hollow`'s gitignored SDD
    directory and reports, are copied to `.superpowers/sdd/ccr15-evidence-archive/` in the coordinator worktree
    (gitignored, never reclaimed). Their originals go when their children are reclaimed.
  - **What goes live with v0.0.79:** the sweep, once both boxes advertise `reclaim-v1` and `reclaim-pause-v1`. It
    starts on the backlog: 62 child-marked rows sat stopped on the fleet box at 21:25, including the reviewers of this
    programme's runs 212 to 258. The operator's kill switch is `reclaim-pause` (Runs screen). Convergence and the
    first passes are observed read-only.

- **2026-10-04 20:34 — fix round 1 re-measured; convergence review run 258 dispatched.** Wave-done 3409 claimed
  `f8f0af9a`. Re-measured:
  - PR #215's head is that sha, open and mergeable, and current `main` (`22f7931a`) is an ancestor, merged twice and
    never rebased.
  - The tip's migration 15 equals #237's line for line, and #215's own migration is 16.
  - `verifyMarker` answers `ccrc-unmodified` with one marker line, and `mark.mjs --check` exits 0.
  - `bash -n` passes on each shell file alone, and both Python files compile.
  - `_ws_reclaim_resolve`, `_ws_reclaim_plain_path` and `_ws_reclaim_owned` equal `main`'s.
  - `_svc_real_home` is identical in `ccd/ccd` and `ccd/ccrc` and reads
    `^[${az}${d}_][${az}${d}._@-]*$ && ! ^[$d]+$`, as ruled.
  - The deviation numbers new against `main` are still exactly wave 4's twenty.
  - Required Linux CI is green (run 37231602141).

  Run 174 advanced to `awaiting-review`. Review run 258 was dispatched to `ccrc-pwa-keen-mesa` with the panel, the
  plan's SAFETY lens at Opus `xhigh` (extended to F1's continuity, F2 and F3's deletes, F5's charset and the merges)
  and the convergence rule. The worker's "Named, not fixed" list is known and ruled.
- **2026-10-04 17:06 — overlap rule agreed with stall-watch wave 7 (mail 3401).** Stall-watch wave 7 amends
  coordinator clause 16, with `CONTRACT[15]`, its own new rows in `coordinator-skill.test.ts` and
  `worker-skill.test.ts`, and the sentences that quote that clause. #215 changes clause 3 only (`CONTRACT` at :110,
  plus added blocks at :523 and :1572), measured at `6138030e`, and clause 16 reaches #215 only through `main`. So the
  edits are disjoint: both PRs land, and the second lander merges `main`, keeps both sides and re-runs the skill
  suites and the README citation cases.
- **2026-10-04 15:52 — F1's bound refined to 2.5 sweep intervals.** `swift-hollow` implemented the 15:13 bound at
  exactly two intervals (≤ 120,000 ms) and measured a consequence (mail 3393). The watcher ticks every 2 s and the
  sweep keeps its own 60 s clock, so passes land 60 to 62 s apart. A child that sits out one pass is therefore
  re-asked 120 to 124 s after its last presence answer, just past the bound, and the licence was withheld once two
  children were due, not three as the ruling intended. **Ruling:** both conditions use 2.5 ×
  `CHILD_RECLAIM_SWEEP_MS` (150,000 ms, inclusive, derived from the constant rather than written as a literal). One
  skipped pass with tick jitter keeps the episode, and two skipped passes (≥ 180 s) restart it. So the licence is
  withheld once three or more children are due, as intended, and it still fails closed. Pins: a one-skipped-pass case
  at the jitter's high end keeps the episode, and a two-skipped-pass case restarts it.
- **2026-10-04 15:13 — review run 254: no containment bypass, two important findings; wave 4 fix round 1.**
  `ccrc-pwa-still-cove` read `6138030e` (34 agents, none dead or empty; `unverifiedLenses` and `unexamined` none).
  - **Panel:** correctness raised 3 and confirmed 2; spec 1, 1; reproduce 2, 1; SAFETY (Opus `xhigh`) 4, 4. Every
    confirmation was 0/3 refuted, and two findings were refuted (3/3 and 2/3).
  - **SAFETY:** no path removes or commits away a live child through containment, row placement or ownership. C1
    re-measured `unmeasured` at the tip and goes red under 3d's line. 20,000 random and child-targeted decoy spellings
    gave 0 mismatches against `cd -L; pwd -P`. #226's and #222's pins are green, and so are the full suite (12
    shards, 493 files) and Linux CI.
  - **Rulings.** Run 174 is back at `working`, and review run 254 closed `done`.
    - **F1, important, predates the round:** one stale presence sample plus the one-slot round-robin licenses
      `--defer-expired` with no continuous presence (`R254-P`: the second ask came 17 minutes after the only
      sample), and the licensed attempt skips ccd's `attached` and `tree-busy` rungs. **Ruling:** R-4 and spec §5.7
      say "continuous", so the rule is made literal.
      - An episode is continuous only while consecutive presence-class answers are at most two sweep-pass intervals
        apart; a longer gap restarts the episode at the new answer.
      - A request goes out licensed only when the episode spans the ceiling AND its latest presence answer is within
        two intervals of the ask.
      - Both conditions only remove licensed asks, never add one. Under a backlog of three or more due children,
        presence-held children wait unlicensed until it drains, which fails closed.
      - This amends A9's presence arm in place by coordinator ruling. The plan is the coordinator's, so it is no
        departure and takes no number. `R254-P` goes red first, and dropping either condition reds a case.
    - **F2, important, predates the round:** the sweep's two entry-delete guards (`watch.ts` at the ineligible
      verdict and at the vanished row) have no red test. Add the reviewer's `R254-L10` and `R254-L12` probes and their
      mutation rows.
    - **F3, minor, predates the round:** A10.1's "Its answer deletes the entry unconditionally" and case (ix) are not
      implemented, and a test pins the contrary. **Ruling:** implement the plan. The release answer deletes the entry,
      (ix) needs two fresh unheld passes after the answer, and the test at `child-reclaim-sweep.test.ts:442` moves to
      match. That is conformance, with no number.
    - **F4, minor, predates the round:** the executor's `unmeasurable` pause arm is unpinned (`pause === 'set'` stays
      green). Add the second-listing-fails case and its mutation row.
    - **F5, minor, introduced by the round:** `_svc_real_home`'s charset refuses digit-led and `@`-bearing login
      names that `main` resolved, and its comment's reason is false: `~5user` is a password-database lookup, and only an
      all-number prefix reads the directory stack. **Ruling:** accept `^[A-Za-z0-9_][A-Za-z0-9._@-]*$` except an
      all-digit name. Refuse all-digit, sign-led, backslash and every other shell syntax. Correct the comment and the
      test titles, keep every injection canary, and change both copies identically. The remaining cost is that an
      all-digit or backslash login name on a Mac stops launchd management; it is recorded, not fixed.
    - **F6, minor, predates the round (`main`'s mechanism):** an inherited `GIT_CONFIG_PARAMETERS` is applied after
      the containment's COUNT entries and overrides its hook and fsmonitor pins. **Ruling:** state it truthfully in
      the containment's comment now. A16-5's "kept by design" premise is wrong for this variable. Unsetting it is
      carried to wave 5's SAFETY lens.
    - **F7, minor, introduced by the round:** two stale gate-table counts in the report. Record-only.
  - **Landing:** `main` is `c9ada654` with #237 landed. By the rule agreed in mail 3364, #215 merges `main` (never
    rebasing), keeps #237's version 15 and renumbers its own migration to `user_version` 16 (its banner, comment and
    pins), then re-runs `coord-db`, `coord-store`, `asks-store`, the census, S6-R11 and the stamp gate.
  - **Convergence rule for the next review:** it accepts the wave when the SAFETY lens holds, no confirmed critical
    or important finding stands, and this fix round introduced no defect. A newly found minor that predates the round
    is carried to wave 5.
- **2026-10-04 12:09 — wave 4's wave-done re-measured; held-out review run 254 dispatched.** Wave-done 3374 claimed
  `6138030e`. Re-measured:
  - PR #215's head is that sha, open, not draft and mergeable.
  - `cf9e4cc8`, `db44b136` and `0087a045` are ancestors, all four merges were done without rebasing, and `main` has
    since moved to `3255571a`. The ordered stop on chasing `main` held, and `git merge-tree` against current `main` is
    clean. `main`'s schema ends at version 14, so the tip's version 15 is free for now.
  - `verifyMarker` answers `ccrc-unmodified` with one marker line, and an edited control answers `ccrc-edited`.
  - `bash -n` passes on `ccd/ccd`, `ccd/ccrc` and `deploy/deploy.sh`, each checked alone, and both Python files
    compile.
  - The new `shared/mark.mjs --check` exits 0 on the stamped body and 1 on a missing file.
  - `_ws_reclaim_resolve` and `_ws_reclaim_plain_path` equal `0087a045`'s byte for byte, so option A landed.
  - The deviation numbers new against `main` are exactly wave 4's twenty, the same set as before the round, each
    defined. Nothing new was minted.
  - Required Linux CI is green (run 37199924539); macOS is advisory.

  Run 174 advanced to `awaiting-review`. Review run 254 opened under this programme's title and was dispatched to
  `ccrc-pwa-still-cove` with:
  - the standard panel;
  - the plan's mandatory SAFETY lens at Opus `xhigh`, extended to re-measure C1, try further decoy landscapes, and
    check that #226 and #222 survived, the case-fold superset, the login-name charset and the sweep's defer and pause
    seams;
  - the full server suite in twelve shards.

  The worker asks that commit bodies quoting existing deviation numbers stay out of the squash message, so the
  coordinator writes that message at merge. The #237 slot collision is ruled after this review.
- **2026-10-03 23:15 — item 3d is reverted: the re-walk-first order deleted a live child. The 15:35 ruling is
  withdrawn.** `swift-hollow` stopped before push (mail 3366). Its own integration review's Opus SAFETY lens
  measured end to end, in a scratch copy, that 3d's order deletes a live child (C1, critical):
  - **The row.** A crafted `.workdir` row `$HOME/L1/../L2/s/../../worktrees/demo/quiet-basin`, with a plantable
    landscape of symlinks and a decoy directory. Its pane's logical `cd` lands exactly in the child.
  - **What 3d did with it.** The resolver answered `complete` at `$HOME/d/worktrees/demo/quiet-basin`, outside the
    child. `_ws_reclaim_workdir_shared` ignored the row, evaluation minted a token, and `ws-reclaim` removed the
    child tree.
  - **Every merge parent refused it.** `abb3f6940`, `cf9e4cc8` and `db44b136` all answer `unmeasured` for the same
    spelling.
  - **Mechanism.** Re-walking the prefix before the rest's `..` is checked lets a rest `..` pop above the re-walk's
    landing, into a physical path the decoy makes exist.

  This falsifies the claim the 15:35 ruling accepted ("refuses none that BASE resolved"). That claim was taken from
  the worker's report without an adversarial measurement of the new order. **Ruling (mail 3367):** option A.
  - Revert 3d's resolver lines to `main`'s order, the rest's `..` refusal first, as reviewed four times in #226.
  - Revert `067151e64`'s member slug under 3538.
  - Replace 3d's two cases with a regression case pinning C1's spelling at `unmeasured`, whose mutation (restoring
    the re-walk-first line) must go red.
  - Keep 3a, 3b and 3c.
  - Option B, keeping 3d behind a net-`..` guard, is declined. Each reorder of this resolver has produced the next
    measured bypass, and the only thing 3d bought was a truthful detail on a fail-shut retry.
  - **Carried to the path-identity follow-up:** the row that logically IS the child still lands in retryable `unres`
    with a detail that is false for it.
  - **Also carried there:** m1, which the same lens measured. The `/proc` unplaced arm is literal-only, so a row
    spelled through a symlink to `/proc/self/cwd` resolves against the reclaim process's own cwd, and with that cwd
    elsewhere the verb removed the child. It predates this round in a stronger form, because `main` has no `/proc`
    arm at all, and no ccd writer produces such a row. That is the same reasoning as review 217's F6.
  - **m2** (a future Python's UTF-8 mode against the GB18030 fold) is noted for the Python-floor decision; nothing
    changes now.

  The ordering in mail 3357 is superseded: revert first, then merge `0087a045`, then push and send the wave-done.
- **2026-10-03 23:11 — wave 4 is blocked again; an overlap rule agreed with stall-watch.** `swift-hollow` has not
  committed since 17:35 (`067151e64`, nothing pushed). Mails 3350 and 3357 have sat `queued` at gate `not-idle`
  since they were sent, and the stall-watch coordinator reports a Bash approval prompt (mail 3363). The operator was
  asked to clear it. Stall-watch wave 5 (run 252) edits `server/src/coord/store.ts` (the stall read only), the
  `README.md` stall-watch paragraphs, and adds a migration that, like #215's, takes `user_version` 15. Agreed by mail
  3364: both PRs land, and the second lander merges `main`, keeps both sides, renumbers its own migration to the
  next free version, and re-runs `coord-db`, `coord-store` and the README citation cases. If #215 lands second, its
  renumber is a landing delta ruled after its review.
- **2026-10-03 18:32 — third merge done; `main` moved a fourth time; no further chase.** `swift-hollow` merged
  `db44b136` (`0dcd3ad39`) and recorded the bounded re-walk under 3538 (`067151e64`), with nothing pushed yet. Then
  #234 (landing-order wave 2) merged as `0087a045`. It edits `ccd/ccd`, the coordinator skill and its
  `wave-lifecycle.md`, `childSpent.ts`, `close.ts` and `store.ts` (mail 3356); its coordinator's merge-tree showed
  conflicts. Ruling (mail 3357): merge `0087a045`, then push and send the wave-done without re-merging for a later
  move unless asked. If `main` moves again before landing, a conflict is ruled after the review, against its own
  delta, so the branch does not chase every other programme's landing.
- **2026-10-03 17:36 — items 4–6 reported (mail 3349); four slugs ruled.** The work is at local `65da6cafe`, after
  the second merge. The third merge (`db44b136`) and the push are still to come. Every slug is accepted, and none
  departs from the spec, the contract or a plan, so none takes a number:
  - **`unresolved-real-home-refuses-system-launchctl`.** `_svc_real_home` evaluates only a login name matching
    `^[A-Za-z_][A-Za-z0-9._-]*$`, with the letters spelled out because a bracket range follows collation. A leading
    digit, `+` or `-` is excluded, since `~0`, `~+N` and `~-` read the directory stack. Any other name answers no
    home with exit 1. `_svc_launchctl` now also treats an unresolved home as a sandbox, which closes the case where an
    empty `$HOME` compared `""` with `""` and reached the system launchctl. That follows the guard's own stated rule:
    a sandbox HOME plus the system launchctl must not proceed, and an unresolved home cannot prove it is not one.
    Both copies are changed identically and the change is line-neutral. Accepted. The held-out review judges whether
    the charset refuses a real macOS account-name class (a directory-bound name, for one), because on such a box this
    refusal would stop launchd management altogether.
  - **`protected-fold-is-a-locale-superset`.** U+0130 was measured to fold under `nocasematch` in a UTF-8 locale, so
    an ASCII-only fold would leave that gap open. A non-ASCII character is a one-character wildcard, counted in code
    points and in bytes. This is inside the 2026-10-02 ruling that a superset is harmless: a variant started
    protected meets the body's exact compare and exits 1 `usage:`.
  - **`mark-check-runs-only-as-the-started-script`.** It was measured that `ccrc restamp` imports `mark.mjs` under
    `node -e` with `argv[1]` set to that file. An eval run therefore checks only when `--check` follows.
  - **`exit2-launcher-arm-pinned-by-a-fixture-installer`.** It stays inside the claimed test file.
- **2026-10-03 16:40 — items 4–6 committed; `main` moved again.** `swift-hollow` merged `fe7b9775` (`3a4b88070`) and
  committed items 4 to 6 locally (`ec18654fb`, `6d5a736e3`, `65da6cafe`). Then #235 (session-continuity wave 2) merged
  as `db44b136` and added 458 lines to `ccd/ccd` (mail 3344). Mail 3346 asks for one more merge of `origin/main`
  before the wave-done, with the stamp, the S6-R11 census and the citation re-measure re-run.
- **2026-10-03 15:35 — integration items 1–3 done locally; one ruling.** `swift-hollow` reported by mail 3335,
  with nothing pushed. The second merge of `fe7b9775`, items 4–6 and mail 3329's additions are still to come. Its
  resolutions:
  - **The merge.** `main`'s span from `_ws_reclaim_workdir_shared` to `_ws_reclaim_absent` was taken byte for byte,
    plus two deliberate wave-4 additions: the `/proc` arm and the newline-safe `dirname` read.
  - **Item 2:** the re-walk prose now names only an entered-prefix `..`, and the `printf` control is bound to the
    child.
  - **Item 3:** each surface now pins the printed remedy text; each ladder row case asserts its own resolver answer;
    the rc-1 clause is pinned as printed.
  - **Ruling, `rest-refusal-applies-once-rewalked` (item 3d's form).** A plain swap (re-walk before every rest's
    `..` refusal) measured cubic on `lnk/../`×N: 11.2 s at N=200, and still running at 600 s on the way to N=585.
    Any session can write a `.workdir` row and every reclaim reads every row, so one such row would stall every
    reclaim. The committed form:
    - the top-level call re-walks first;
    - inside a re-walk, the rest's refusal applies first, so a spelling is re-walked at most twice;
    - a third nested `<lnk>/..` answers `unres`, so the reclaim reads `unmeasured` and refuses.

    Against the old order it resolves strictly more spellings (depths 1 and 2, the row that IS the child), and
    refuses none the old order resolved. Accepted. **(Withdrawn 2026-10-03 23:15: C1 measured that it does.)** It is fail-shut and holds a child rather than deleting one, the
    same class of accepted cost as a gone alternate row. Like `resolvable-rest-dotdot` and
    `resolvable-dotdot-physical-fallback` before it, it joins 3538 as a member slug added by coordinator mail: that
    number's scope is fail-shut refusal semantics for unsafe path spellings. No new number. The bounded form costs
    21 s on a 14 KB hand-written row (N=2000), against 7.7 s for the old order; the held-out review judges that cost.
  - **Accepted as no departure:**
    - `ladder-row-cases-assert-the-row-resolution`: an eval-level split is impossible, because every non-`complete`
      row gets one answer by design;
    - `verb-split-keeps-mains-alternate-row-cases`;
    - `r28-shift-measured-five-not-three`: the 2026-10-02 entry's "three lines" was wrong; R28 moved from 477 to
      482 and is re-anchored by content at :482–489.
- **2026-10-03 13:34 — `main` moved and `ccd/ccrc` is free, so the integration round widens.** `origin/main` is
  now `fe7b9775`, after #230 (session continuity wave 1), #231 (landing-order wave 1) and #233 (workspace-lifecycle
  wave 2). Since `cf9e4cc8` they change `ccd/ccd` (483 lines), `ccd/ccrc` and `server/src/coord/store.ts`. #233's
  coordinator measured its `store.ts` hunk disjoint from #215's (mail 3328), and #215 is the second lander. No claim
  is live in `ccrc-pwa`: claim 882 ended with #231, and wave 4's own 890 has lapsed. Ruling: the items carried
  "until `ccd/ccrc` is free" join this round. They are review 222's R2, R3's `ccd/ccrc` sentence, and the same
  `_svc_real_home` repair in `ccd/ccrc`'s identical copy, so the two copies do not diverge. Before its wave-done, the
  worker merges `origin/main` again, never rebasing, takes both sides, re-stamps `ccd/ccd` and re-takes its claims.
- **2026-10-03 12:15 — wave 4's integration round is stalled on a permission prompt.** The stall-watch coordinator
  reported (mail 3313) that `swift-hollow` has been at a Claude Code Bash approval prompt since 2026-10-02 19:38Z.
  The command is a read-only `git diff --stat abb3f6940 HEAD; git diff abb3f6940 HEAD | grep …`, and the prompt is
  not a ccrc ask. Measured read-only: `origin/main` `cf9e4cc8` is merged as `abb3f6940`, without a rebase. Items 2
  and 3 are in progress (`1d2cdffd1`, `823c9523d`, the last at 19:23); nothing is pushed, and the tree is clean. No
  coordinator route clears a pane dialog, so the operator was asked to approve it from the PWA or the pane.
- **2026-10-02 15:03 — the entry-safety prerequisite has merged; wave 4's integration round opens.** PR #222 landed
  as `cf9e4cc8` after review runs 216, 217 and 222 (that programme's ledger; release v0.0.60), and run 199 closed
  final. Both prerequisites are on `main`, so the landing order reaches wave 4. Run 174 stays `working` (items 817 to
  834 pending) and `swift-hollow` receives one integration round, by status mail, in this order:
  1. **Merge `origin/main`** into local `1a02baac7abfbb1a88a1a7a251c7326c11ae9f08`, never rebasing. `main` now
     carries #226's port of this branch's resolver substrate, extended with the `complete|absent-suffix|unmeasured`
     basis, and #222's launcher, installer and 30-line body guard. Where both sides define the same code, `main`'s is
     the base, and a wave 4 change on top of it must be deliberate and stated. Every #226 and #222 pin stays green.
     Regenerate and re-stamp `ccd/ccd`.
  2. **Fix round 3's two minors:** `_ws_reclaim_workdir_shared`'s prose overstates which `..` spellings are
     re-walked, and the imported-`printf` control hard-codes `quiet-basin`.
  3. **The row-placement carries (below):** the remedy pin binding the printed text; the three row-level ladder
     cases; the child's rc-1 remedy clause; `_ws_reclaim_resolve`'s `..` ordering; the three plan selectors naming
     `repairing the alias`; and the wave-3 plan's R28 citation re-anchored. The two `//` remedy wordings stay with the
     path-identity follow-up.
  4. **The operator's `_svc_real_home` ruling** in `ccd/ccd`.
  5. **Review 217's carries:** case-insensitive protected tokens in `ccd/ccd-entry.py`'s `is_protected`, with the
     guard comment and launcher header saying so. Ruling: this closes the gap 3697 recorded, so it needs no new
     departure, and 3697's text in the merged entry-safety plan stays as history. `shared/mark.mjs` gains a real
     `--check <file>` that exits 0 only on `ccrc-unmodified` and non-zero otherwise, a missing file included, so the
     plans' existing citations become true.
  6. **Review 222's R1 and R3** (below).
  - **Claims.** Live claims 882 (run 218), 885 (run 219) and 889 (run 221) hold `ccd/ccrc`, `README.md`,
    `CLAUDE.md`, both skills and their tests, `ccd/session-hook.sh`, `server/src/watch.ts` and others. This round makes
    no new edit under them. Wave 4's existing diff already edits `README.md`, `CLAUDE.md`, both skills, their tests
    and `watch.ts`. A merge resolution there is allowed and reported, and the holder is told. So R2, R3's `ccd/ccrc`
    sentence and `ccd/ccrc`'s identical `_svc_real_home` copy are carried until `ccd/ccrc` is free. That copy is
    reached by an operator's own `ccrc` run on Darwin, never by the unattended sweep.
  - **Numbers.** Wave 4's block is used up, and clause 10 forbids a mid-wave allocation. Every item above is a repair,
    a pin or a prose correction, so none needs a number. If one would need a defined departure, the worker stops
    and reports its slug by mail, never as a number or a tracked placeholder.
  - Then the worker re-runs the required gates (`ownership.test.ts` as the stamp gate) and submits a fresh exact
    wave-done. Only a server-accepted fingerprint at that tip advances wave 4 to its official held-out review.
- **2026-10-02 — the row-placement prerequisite has merged.** PR #226 landed as `0db98707` after review runs 212-215
  (release v0.0.58). The landing order moves on: run 199 (`reclaim-entry-safety`) now merges current `main` without
  rebasing, integrates that prerequisite through its fourth item and returns a fresh fingerprint for its own held-out
  review; wave 4 stays stopped until PR #222 also merges.
- **2026-10-01 — the row-placement prerequisite is in its first fix round; its review adds two carries here.**
  Run 208 (`reclaim-row-placement-safety`) opened PR #226 at `dd4e2a86`, and held-out review run 212 found no path
  that removes a live child through the removed-alias class. Its rulings (that programme's ledger) reach this one:
  - The binding invariant's accepted cost holds every other child, a vanished one included, while any alternate
    row's directory is gone, and two vanished or interrupted children hold each other (operator ruling: accept, pin,
    fix later). Wave 5 inherits the recovery: evidence that a gone row named ccd's own former worktree, read from
    git's worktree record or the reclaim journal and never from process state, so that row stops holding others.
    Until wave 4's sweep ships, a held child is not retried after its one close-time attempt.
  - Two pre-existing aliasing classes still resolve `complete` and outside: a re-pointed (not removed) alias and a
    bind-mount spelling (operator ruling: document in #226, follow up). A path-identity follow-up programme opens
    after wave 5, carrying device/inode ancestry and the tail's unre-asked window before `git worktree remove`.
  - #226 edits the contract, shifting a wave-3 plan's citation of R28 by three lines; wave 4's integration round
    re-anchors it, because that plan lies outside run 208's claim.
- **2026-10-01 — Fix Round 3 is scoped-clean, but a second safety prerequisite now blocks both later branches.**
  - The official read-only rereview of `1fd35e76d..1a02baac7` accepts the round's N-1, N-2, m-1 and m-2 repairs and
    finds no new Critical or Important defect in that diff. Two minors remain for Wave 4's eventual integration:
    `_ws_reclaim_workdir_shared` overstates which `..` spellings are re-walked, and the imported-`printf` hostility
    control hard-codes `quiet-basin` rather than deriving or asserting the fixture child's basename.
  - The same rereview measured a pre-existing Important-grade R31 failure outside the fix diff. A competing row can
    enter a child through an ancestor symlink, retain that physical cwd after the symlink is removed, and then be
    placed by `_ws_reclaim_resolve` only through textual suffix projection below the proven-absent component. The
    current consumer treats that projection as ordinary identity evidence; evaluation mints a token and final
    ownership remeasurement can repeat the false-safe answer before removing the live tree.
  - **Binding invariant:** during destructive cross-row ownership comparison, an alternate registry row proves
    non-containment only when its complete current spelling resolves through existing directories. A path rebuilt
    textually below a proven-absent component is a namespace projection, not identity evidence, and makes reclaim
    `unmeasured` regardless of modeled tmux state. This does not change the subject child's own R19 vanished-worktree
    arm. Process cwd observations may strengthen refusal but never authorize deletion.
  - The repair is the separate one-wave programme `reclaim-row-placement-safety`; run 208 opened after Wave 4
    released claims 850 and 851, and its sixteen-number block begins at D-3731. Its finalized plan, fresh child, PR
    and official review remain distinct acts. It is neither run 199's inherited-Bash entry boundary nor Wave 5
    product scope, and neither existing run may absorb it by changing shape.
  - Landing order is `reclaim-row-placement-safety`, then run 199 `reclaim-entry-safety`, then Wave 4. Run 199 keeps
    its immutable four items and uses its existing merge-current-main item to integrate the first prerequisite.
    Wave 4 stays stopped at local commit `1a02baac7abfbb1a88a1a7a251c7326c11ae9f08`; PR #215 receives no fresh
    handoff until both prerequisite PRs merge and `swift-hollow` merges current main, regenerates and re-stamps ccd,
    repairs the two remaining minors, reruns the required gates and produces a new exact fingerprint.
- **2026-09-30 — wave 4 post-handoff safety rounds remain open; no fresh handoff accepted.**
  - The original wave-done and its fingerprint are superseded. Run 174 remains `working`; items 817–834 remain pending;
    no official review run is open and PR #215 is not merge-eligible from coordinator evidence.
  - At local worker commit `1fd35e76d`, the ruled shared logical resolver places both the child and every competing row
    from one result. The rereview still measured two blocking resolver failures: imported `builtin`/`set` can shadow
    the primitive, and its physical prefix discovery can disagree with logical entry on a linked-root `..` spelling.
    Fix round 3 owns those two findings and two truthful-prose minors; its claims are 850–853.
  - The same rereview measured a separate R31 destruction: an imported `find` can return success with an empty registry
    listing at both evaluation and final ownership remeasurement, fabricate that no competing row names the tree, and
    let unattended `ws-reclaim` remove a live child. Mail 2807 ruled this **blocking** despite the inherited environment
    not being remote-request input: existing ccd contracts explicitly tolerate inherited shell state, and the mandatory
    xhigh SAFETY lens requires this fail direction shut before automatic deletion ships.
  - Two independent audits corrected mail 2807 in mail 2818. A complete wave-4 repair may be a pre-Bash,
    source-safe, argv-selective boundary for direct `ws-reclaim` and `ws-audit --reclaim`; every ccd verb need not
    change. The boundary must establish and remeasure PATH-selected Bash >=4.4 privileged-mode semantics before any
    Bash body or `BASH_ENV` runs. Normal systemd/launchd, agent, local-server and installed-path entry are in scope;
    detached swap self-reexec is not covered because its ordinary outer `bash -c` runs first. A `find`-only patch is
    insufficient because other decision-critical commands remain ambient.
  - Mail 2818 also retracts the proposed deviation fold. `resolvable-dotdot-physical-fallback` is explicitly a
    path-spelling departure; `ccd-imported-functions-hijack-reclaim-reads` is a distinct cross-cutting mechanism.
    The run-open block is exhausted, coordinator clause 10 forbids another mid-wave allocation, and plan R-12 forbids
    a tracked placeholder. The slug therefore remains in mail evidence only. The worker must finish and report fix
    round 3, then stop: fix round 4 needs an operator-authorized separately opened scope with allocation at run-open,
    and automatic reclamation remains blocked meanwhile.
  - **Operator ruling (2026-09-30): split a safety prerequisite.** After fix round 3 reports, open a fresh run and
    fresh child with a new run-open deviation block; land the reclaim-entry repair in its own PR before PR #215 may
    proceed. This is not wave 5 and inherits none of wave 5's product scope. Run 174 remains `working`, its items remain
    pending, and no old or new wave-done can advance it until the prerequisite is merged and the Wave 4 branch is
    synchronized and freshly handed off. One child per PR remains intact.
  - Fix round 3 reported `DONE_WITH_CONCERNS` at local worker commit
    `1a02baac7abfbb1a88a1a7a251c7326c11ae9f08`, parent
    `1fd35e76d7fbde678e4ca66235639267bf8cac75`; it closes only the two scoped resolver findings and two prose
    minors. The worker stopped correctly: the branch is clean, no push and no new wave-done occurred, and PR #215
    remains at remote head `e21247286b5cd2dcce5b5f097df3c68254114af8`.
  - The prerequisite is the separate one-wave programme `reclaim-entry-safety`. Its number-free skeleton and
    this parent update commit before run-open. At run-open it receives its own eight-number deviation block; the
    first issued number defines `ccd-imported-functions-hijack-reclaim-reads` in a tracked plan committed at an
    exact coordinator handoff SHA. A fresh child copies that blob byte-for-byte with read-only `git show`, commits
    it first, and opens the prerequisite's one PR. No coordinator ancestry is cherry-picked and no separate docs
    merge is inserted before the prerequisite.
  - Deployment remains automatic-updater-only. The coordinator will not manually roll out this wave.
- **2026-09-28 — wave 3 DEPLOYED (v0.0.33) and measured live; wave 4 dispatched (run 174).**
  - **Rollout.** `ccrc rollout --to v0.0.33`, 16:16–16:21 UTC: fleet box first, rc 0, both boxes agreed at `1ffdf947`.
    The server box's doctor now reads 0 failed; its standing agent-unit FAIL is gone. The fleet box's `ccd caps` lists
    `ws-reclaim` and `reclaim-v1`.
  - **The first live reclaim.** Run 148's non-final close (`prPhase: merged`) answered `childReclaim: queued`, and the
    reclaim took about 10 s. The journal shows `release`, then `reclaim intent`, `unsupervise`, `purge` and
    `reclaim done`. The feed reads "ccrc-pwa-plain-summit, child of run #148, was reclaimed (close). Nothing
    uncommitted was left."
    - Gone: the registry rows, the worktree, the local branch and the clips directory.
    - Kept: the transcripts, and the tombstone `.reaped/ccrc-pwa-plain-summit.json`.
    - The attic pins the tip `135f1625`, the merge `244a185d`, and the `reflogs` keep ref.
    - The remote branch was deleted by GitHub's `delete_branch_on_merge` at merge time, not by the reclaim.
    - Before the close, the coordinator archived the worker's and the reviewers' reports into its own clips
      (`wave3-archive/`), because the ledger and wave 4's amendments cite them.
  - **Residue seen.** Three dot-lock files outlive the reclaim: `.reap-<id>.lock`, `.<id>.compactions.lock` and
    `.prstate-<id>.lock`. Harmless today. But wave 5's R25 collector treats any `$REG` entry named `.<id>.*` as a live
    row, so a leftover `.compactions.lock` would keep a human-orphaned temp root uncollected. Wave 5 inherits it.
  - **Wave 4.** Docs PR #188 merged as `6ff4e2e9` (amendments A1 to A17, contract §10). Run 174 opened and was
    dispatched to a fresh child, `swift-hollow`, with 18 declared items and route Opus·high, subagent Sonnet,
    workflows off. Its deviation block is twenty numbers, the first of them 3534 and the last 3553 (floor now 3554).
  - **Run 148 closed** non-final `done`, after wave 4's run opened.
- **2026-09-28 — review 172 (`135f1625`): no destroy path; wave 3 MERGED as `1ffdf947` (#187).**
  - **The panel.** Four lenses (SAFETY at xhigh) and fifteen refuters; none died. Every mutation row the brief named
    reds, with green controls: F-A ×2, the F-B reader, the three `//` clauses, the writer's `-ef`, F-I and F-G.
  - **Measurements.** The boundary line is byte-identical at 19168, and S6-R11 passes 13/13 under the real selector.
    Suites are green bar `tmp-sweep`.
  - **Ruled.**
    - F1 (class 2): the hidden read forks per absent flagged path, which can strand a large sparse child and fails
      closed. It rides wave 4 (A17). Measured first: 0 of 37 live marked children with a tree use sparse checkout or
      skip-worktree.
    - F2 (class 3, text): rides wave 4.
    - R1 (refuted as pre-existing; a `/proc/self/cwd` workdir): recorded in wave 4 as A17.3.
  - **Merged** with `--admin --match-head-commit 135f1625`. Every Linux leg is green. `test-macos 2/2` was cancelled at
    its cap, which the operator's ruling treats as flaky.
  - **Pre-rollout census, read-only, live.** 0 of 79 registry workdirs are any of:
    - empty, relative, `//` or `/proc`;
    - unreadable, or containing a newline;
    - resolving through a `//` path.

    So F-B's fail-closed reader stops nothing on rollout.
  - **Review run 172 is closed.** Run 148 stays at `awaiting-review` until wave 4's run opens, then closes final.
- **2026-09-28 — wave 3's second fix round done (`135f1625`); review 172 dispatched.**
  - **The round.** It shipped F-I (3523), F-A (3369), F-B (3521), and F-C through F-G.
    - Each fix had an Opus review, and scoped re-reviews until clean.
    - F-B's reviews found three more pre-existing shapes, each a MEASURED deletion of another session's file:
      - an other row spelled `//…`;
      - an other row resolving through a `//`-target link;
      - a child whose own workdir resolves through one.
    - The worker closed them as one fail-closed extension, `double-slash-row-unplaceable`. The coordinator ratified
      it, and told the worker that a scope extension is named for the coordinator to rule, never ruled by the worker.
  - **Slugs.** Every departure slug is FOLDED into 3369, 3521 or 3523 (mail 2452), and the worker named nine of them
    in the plan (`135f1625`). Three more F-A slugs are folded too: `gitdir-rides-the-logs-list`,
    `location-guard-case-added` and `default-config-reach-wider`. Their entry text rides wave 4.
  - **Gate.**
    - Server: 16437 passed at the merge. The reds were `tmp-sweep`, plus two load flakes that pass alone.
    - One shard failed first on ccd's 10 G free-space floor. The worker freed its own scratch and re-ran it green.
      The box's root filesystem is at 93–97%, which is the operator's to deal with.
    - agent 331/331; pwa 3010/3010; the ledger guards 87/87.
    - S6-R11 (the real selector) is 196/196/196 on every ccd commit, and 13/13 at the merge.
  - **The frozen boundary's line** now reads at 19168. Main added 37 lines above it; the bytes are unchanged.
  - **Review 172** (`keen-ridge`) is scoped to `1715d410` up to the tip: the held-out panel, plus SAFETY at xhigh on
    F-A, F-B and F-I. Only a destroy path THIS round opened re-opens the wave. Mail 2457 corrected line 8 of its
    brief: three slug names blanked by a shell-quoting slip.
  - **Wave 4's plan gained A16** (`3de54b6b`, docs PR #188), with the round's carries:
    - `ws-gc` and `ws-rm` obey `showUntrackedFiles=no`;
    - a staged intermediate version is kept;
    - a foreign clone's reflog-only commits fail closed;
    - F-A's keep is finished;
    - `probe-unmeasured` is not resumable.
  - **Before rollout**, re-count the live registry for workdirs that are empty, not absolute, or `//`-prefixed, and
    resolve each path, because the two link shapes do not show in the stored text.
- **2026-09-26 — review 171 on wave 3's fix round (`1715d410`): two destroy paths; a SECOND, tight fix round.**
  - **The panel.** Five Opus lenses (SAFETY at xhigh), and three Sonnet refuters per finding. 56 agents ran, none
    died; 15 survived and merged into 8 findings, and 2 were refuted. The reviewer reproduced the two class-1
    findings, and measured every mutation row for F1, F2, F3, F4, F7 and 3520 itself: all red.
  - **Class 1.**
    - F-A: the round OPENED a narrow loss. F3's four-reflog keep skips the child's per-worktree refs. Under
      `core.logAllRefUpdates=always` the base kept those commits, by accident, and the tip loses them.
    - F-B: F2's nested-row check misses a RELATIVE `.workdir` spelling, and the other session's tree is removed.
  - **Class 2.** F-C: the hidden-link hash lacks `-C`, which is fail-safe.
  - **Class 3.** F-D to F-H.
  - **The rulings were attacked before sending** (three Opus agents, on git 2.43, in fixture HOMEs). They measured:
    - `for-each-ref` passes a mode-000 ref at rc 0, a live destroy path. So F-A reads the worktree's own git
      directory's FILES, and covers pseudo-ref reflogs and the autostash too. An autostash is a user's uncommitted
      edits, lost today under `--defer-expired`.
    - F-B's `cd && pwd` writer stores two lines under an exported CDPATH, and lets a command into the pane through a
      quote in the cwd's name. So the writer is rewritten, and the reader decides after the loop.
    - A new pre-existing destroy path, F-I: rung 9's foreign-clean proof obeys `status.showUntrackedFiles=no`.
  - **Numbers:** 3369 (F-A), 3521 (F-B) and 3523 (F-I, issued; 3522 went to another session).
  - **Measured live before ruling:** 0 of 75 registry rows hold a relative workdir, so F-B's fail-closed reader
    strands nothing today. It is re-measured immediately before rollout.
  - **Review run 171 is closed. Run 148 is at `working`**, with fix-round mail 2439. The rulings are in the
    coordinator's clips, `rulings-review-171.md` and `attack-rulings-171.json`. After this round's scoped review,
    only a destroy path the round opens earns another round.
- **2026-09-26 — wave 4 pre-flight: four lenses, three blocking; rulings attacked before sending; contract §10.**
  - **Why.** The operator ruled on 2026-09-24 that wave 4 dispatches the moment wave 3 merges. Wave 4's plan predates
    wave 3's amendments and departures, R25, R32 and R33, and every item the ledger carried into it.
  - **The pre-flight.** Four Opus lenses (interfaces, carried items, safety, rulings) read the plan against wave 3 at
    `1715d410`. Three findings were blocking:
    - Task 1's fact 4 prints five lines, not four;
    - the presence ceiling, once expired, licenses `--defer-expired` for good, so the sweep would skip the `attached`
      and `tree-busy` rungs and kill an operator's pane;
    - R32 is contradicted by the plan's own tests.
  - **The attack.** Three Opus agents attacked the drafted rulings, one for each of these areas:
    - R32's release;
    - the birth, presence and bounds;
    - the ccd edits and the words.

    They found:
    - hand holds are written in the programme grammar BY DESIGN (Build 8, the PWA placeholder, the ledger template),
      and a shipped pin forbids parsing a hold. So a hold is ACCOUNTED against the server's own renderings, never
      parsed;
    - cross-attempt adoption is live, because the BEFORE read tolerates an unlistable registry, so an adopted child
      binds with a null birth;
    - the drafted in-flight sort starved the queue, and the fence read a 500-row window that a failing child scrolls
      through in days;
    - `_ws_attic_pin` cannot be fixed in place (two callers, no failure path, and an attic shape that others read).
  - **Ruled.** The rulings are R-1 to R-13 in the plan, and cross-wave as contract R34 to R37:
    - R34: R32 is a release, then the ordinary path;
    - R35: R33 is a write-once `sessionBornAt`;
    - R36: R25's collector moves to wave 5;
    - R37: a workspace that has ever coordinated is never reclaimed automatically.

    Seven new tasks: 1b (split the verb suite), 2b (ccd below the boundary), 2c (ccd above it, line-neutral), 4b
    (birth), 5b (words), 5c (one pr-state per close), 9b (prose) and 9c (the slug residue).
  - **Left the programme**, as follow-ups with the measured instruments recorded in the plan:
    - `is_ours` three-valued (R-7: since R28 no reclamation reader consults `ours`);
    - `reap-attic-complete`, `_ws_attic_pin`'s capped reflog read on `ws-reap`/`ws-rm` (R-8). It carries the residue
      of wave 3's number 3515.
  - **Records.** The four lens reports and three attack reports are in the coordinator's clips, under
    `wave4-preflight/`.
- **2026-09-26 — wave 3's wave-done re-sent at `1715d410`; scoped review 171 dispatched.**
  - **The claim holds.** The tip is one docs-only commit past `f2b32a86`, touching only the wave-3 plan, and main is
    an ancestor. It defines 3520 (`index-copy-keeps-its-mtime`), names the fix commit, and names every fix-round slug
    in its entry. The worker measured 3520 by mutation in an isolated copy: `cp -p --` changed to `cp --` reds the
    tracked-file case only.
  - **Recorded, not numbered:** the ccd comment above that copy says "a hidden one too", which overstates it at this
    tree, because a hidden-flag edit is found by content in step 3. The comment rides wave 4 beside F8's.
  - **Run 148 is at `awaiting-review`.** Review 171 covers `c5962a94` up to the tip, with the held-out panel plus the
    plan's SAFETY lens at xhigh on the round's ccd changes. Only a destroy path, or a shipped-behaviour defect this
    round introduced, re-opens the wave; anything else rides wave 4.
- **2026-09-26 — wave 3's fix round done (`f2b32a86`, 31 commits); departures ruled; 3520 assigned.**
  - **The round.** All 23 findings were fixed, each through an Opus review and re-reviews until clean. Every number
    is defined in the commit that shipped its fix: 3367, 3368 and 3513 to 3519.
  - **Boundary.** Nothing new above `ccd/ccd:19131` except the authorised in-place `_session_probe` anchor (two
    lines), line-neutral comments, and F5's one in-place audit line. Line 19131 is byte-identical, and S6-R11 was
    green on every ccd commit.
  - **Suites.** The first full run caught one real red, the new `resume` words missing from the kebab guard, fixed
    in-round. The second: server 16339 passed, only the box-local `tmp-sweep` case red; agent 331; pwa 3010.
  - **Departures.** Covered by their fixes' numbers, apart from `index-copy-keeps-its-mtime`, which takes 3520. It
    also fixes a pre-existing WIP loss for ordinary tracked files (a same-second, same-size edit was left out).
    Accepted within the fixes:
    - a `..`-spelled row refuses even when it names an ancestor (narrow fail-closed);
    - `cmd_ws_audit --reclaim` is contained whole (wrapping only the fork left a hook running);
    - F20 recognises ccd's pinned pre-lock texts.
  - **F1's exit-empty exception matches real tmux.** Measured by the rulings' attacker on tmux 3.4 with an isolated
    socket: the last `kill-session` exits 0, then `no server running`.
  - **macOS at `f2b32a86` (CI run 36228530456).**
    - test-macos 2/2 (job 108367122769) passed: 211 files, 6668 tests. That covers the pin, audit, ws-reap and
      session-hook suites and the server's close, mark, prose and store cases.
    - test-macos 1/2 (job 108367122762) passed 59 files, including the verb suite (143, with the F1, F2, F3, F4 and
      F7 cases) and lifecycle-purge, then went silent at 08:26 and was cancelled at the 55-minute cap.
    - probe-macos (job 108367079482) failed only on the known D-2661 FIFO flake. Leg 2 passed the same file 7/7.
    - **Ruled: no re-run.** Leg 1's file list puts `ccgpt-proxy.test.ts` 19th, ahead of the ladder, `child-reclaim`
      and `wsaudit` files. A re-run wedges at main's hang before it reaches them. The ladder's Darwin evidence (the
      ported F23 normalise cases, A10 fail-closed, the F2 ladder cases) is therefore UNMEASURED. It is carried as a
      post-merge measurement for when that hang is fixed on main.
- **2026-09-25 — review 170 on wave 3 (`c5962a94`): four critical, seven important, twelve minor; ONE full fix round.**
  - **The panel.** Nine Opus lenses, SAFETY at xhigh; 126 agents; 32 findings survived and merge into 22; 7 were
    refuted. Suites green except the box-local `tmp-sweep` case. AGENT-FIRST, the run-id parses and fixture-only
    tests hold. Whole-branch (a), "nothing deleted that was not first kept", held only pending the critical rulings.
  - **The criticals, each a way to delete something not first kept:**
    - F1: rung 5 and the tail read an unreachable tmux as no session;
    - F2: a registry row nested inside the child is torn out;
    - F3: the reflog pin keeps the 200 lowest shas repo-wide, so the child's own reflog-only commits can be lost;
    - F4: `skip-worktree`/`assume-unchanged` edits are deleted unrecorded.
  - **The rulings were attacked before sending.** Three Opus agents found that my first F1 control would itself have
    reopened the D-308 fail-open, since `no server running` is `unknown`, never gone. They also found:
    - F1: the tmux exit-empty strand, and `_session_probe`'s missing anchor;
    - F7: `_svc_is_loaded` folds "could not ask launchd" into "not loaded";
    - F4: record-only contradicts spec §5.5 step 2 for non-secret tracked edits;
    - F3: nested branches' reflogs were missed, as were unreadable-reflog refusal and pin-before-delete order.

    Every amendment is incorporated. The full rulings travel with the fix-round mail, in the coordinator's clips as
    `rulings-review-170.md`.
  - **Rulings, in short:**
    - F1: `_session_probe` with an anchored target (one authorised line-neutral edit above the boundary); only
      `can't find session` is gone; the tail re-measures the pane, with one exit-empty exception;
    - F2: refuse a nested row (an ancestor row is not refused);
    - F3: the child's own reflogs pinned completely, old and new values, each before its deleting act;
    - F4: a hidden-flag edit goes through the secret classifier, kept in the WIP unless it is secret-shaped;
    - F5: the ladder's reads contained at `_ws_reclaim_fork`;
    - F6: the claim narrowed;
    - F7: stopped only on launchctl rc 113;
    - F8: numbered;
    - F9 to F13: sentences and prose made true;
    - F20: pre-lock dies recognised positively;
    - F21: `wip` discriminated;
    - every other minor fixed.
  - **Accepted:** the +35 lines above the boundary, which are code plus one-line pointers under plan rule R9.
  - **Numbers.** 3367 for F8 and 3368 for F11 and F13, from the programme's block. A new block, 3513 through 3520,
    was minted for this round's safety fixes; 3369 and 3520 stay unassigned.
  - **Advance commitment.** After this round, a review scoped to its commits. Only a destroy path, or a
    shipped-behaviour defect the round introduces, earns another send-back.
- **2026-09-25 — wave 3 in review.** The worker defined 3352 to 3366 in one docs-only commit (`c5962a94`); the
  commit's one moved line repointed the plan's own lens-1 citation. Run 148 advanced to awaiting-review, and
  review run 170 was dispatched with seven lenses: the held-out three, plus the plan's four, SAFETY at xhigh.
  - **macOS is partly measured.** test-macos 1/2 (job 108201932197) passed 210/210 files, including the ladder
    suite, so `find -perm`/`-quit` are measured on Darwin.
  - Leg 2/2 (job 108201932195) hung on main's `ccgpt-proxy` wedge after `ccd-ws-reap` and `ccd-lifecycle-purge`.
    The pin, audit and close suites are therefore unmeasured on Darwin. A re-run would hang the same way, and
    CI's workflow_dispatch cannot select files, so the review reads their portability by hand.
- **2026-09-25 — wave 3's wave-done at `fcd84cd0` (PR #187); re-measured; numbers assigned before review.**
  - **The claim holds.** PR #187 is open against main, and the merge base is current main (`dcac4691`, merged twice,
    never rebased). 70 files, +9616 lines, 38 commits under the noreply identity.
  - **What the worker measured.** The frozen boundary measured three times at `ccd/ccd:19131`. S6-R11 was paid per
    task, with the headline at 196. First full run on the merged tree: server 16187 passed, and the ONE red was the
    box-local `tmp-sweep` case. At the tip, server 16210, agent 331 and pwa 3010. The scratch-slug case is green in
    both TMPDIR arms (10b).
  - **Mutations.** Every task has a mutation table. The survivors are named double defences, and the final fix wave
    has 29 rows.
  - **Numbers.** Fifteen plan departures, one per task (T1–T10b, the merge), plus `wip-moves-no-ref` and
    `child-gitdir-proof-before-rung-6`. They are 3352 to 3366, to be defined in the wave-3 plan before the review
    opens.
  - **`wip-moves-no-ref` is ACCEPTED.** The WIP is built with `commit-tree` and pinned in the attic, and moves no
    branch or HEAD. "Pin everything" holds, and moving no ref is safer. The spec §5.5 step 2 wording follows later.
  - **Ledger-only.** T0's two commits are a brief-level departure. Tasks 2–4 ran Opus implementers where the brief
    said Sonnet, because the plan's routing row asked for Opus on the destructive ladder, pin and verb. That is a
    routing change under clause 13, judged right for the destructive tasks and recorded here; nothing is escalated
    or demoted.
  - **Open items ruled.** #1, the stranded held child, becomes contract R32 for wave 4's sweep. #2, a retry that
    re-stamps the birth, becomes R33 for wave 4. #3 to #6 are carried (Carried constraints). None destroys
    anything it should not, so none is a send-back.
  - **macOS.** `_ws_reclaim_residue` now derives its root from `${TMPDIR:-/tmp}` and is pinned. The normalise
    cases' `find -perm`/`-quit` await the PR's macOS leg.
- **2026-09-24 — main's macOS leg is red on wave 1's `_child_tmpdir`; fixed by a separate one-wave programme.**
  - **The defect.** `chmod 0700 -- "$dir"` puts `--` after the mode operand. BSD `chmod` reads it as a file and
    exits 1, so on macOS every child answers rc 2 and spawns uncontained. Reported by bright-river; upheld by a
    three-agent check (the runner's `chmod` is BSD, and every failure goes through that rc 2).
  - **Owner.** Programme `child-tmpdir-bsd` (ledger `docs/superpowers/programs/child-tmpdir-bsd.md`).
  - **Why it does not wait for wave 3's claim on `ccd/ccd`.** ws-slug-collision waited out wave 1's claim; this
    narrows that precedent. Two of this coordinator's workers may share a claimed file when the second's edit is
    line-neutral, in a function the first carries unchanged, and the first merges main before its PR as it must
    anyway. The only text both branches change is ccd's generated stamp line. Clause 10 itself governs splitting
    one wave across workers, which this is not.
  - **Not ours.** Main's macOS 3/4 cancellation is `ccgpt-proxy.test.ts` (#165) wedging the single macOS worker
    on every main run since 2026-09-22, before this programme existed. It also blocks stable promotion; it is
    reported to the operator.
  - **Wave 3 portability, from the same check.** `_ws_reclaim_residue` hardcodes `/tmp/claude-<uid>` where
    `ccd-tmp-sweep` uses `${TMPDIR:-/tmp}/claude-<uid>`, so on macOS it reads a measured-looking 0. Its `find
    -perm`/`-quit` are the first Darwin-reachable uses in ccd and need the macOS leg to confirm them. Both are
    mailed to wave 3's worker. Nothing else in its 1151 new lines is platform-sensitive.
- **2026-09-24 — wave 3 stalled for ~3 h after an account move.** At ~16:02 the worker moved from one wrapper
  to another at the weekly limit. The move stopped its background merge subagent (the merge commit `b05d0be5`
  had landed; its S6-R11 follow-up is unknown), and the resumed session never took a turn. Woken by mail at 18:59
  to verify S6-R11 on the merge and continue at Task 5.
- **2026-09-24 — scoped review 147 (`95703aa7`): accepted; wave 2 merges.**
  - **The panel.** 36 agents; 8 findings survived 3–0 and merge into 5 minors; 3 were refuted. All 12 mutations
    behaved as claimed; the named suites passed 1141/1141 and the ledger/topology suites 87/87.
  - **Ruling.** The round's advance commitment was that only a shipped-behaviour defect the round introduced
    earns another send-back. None did: every finding is a stale count, a comment or a commit message. Accepted,
    and the text corrections ride wave 3 as one declared item (Carried constraints).
  - **Three settlements on wave 3's A1**, because the round changed `childSpent` after the pre-flight read it
    (recorded under Carried constraints and in wave 3's brief).
- **2026-09-23 — wave 2 fix round done (`95703aa7`); scoped review 147.** The round fixed the null-tip fail-open
  and the malformed-head lines as one departure (3351) and review 144's ruled minors as another (3350).
- **2026-09-23 — scoped review 145 (`76594fec`): R28/R29 as ruled; one shipped fail-open; one tight round.**
  - **The panel.** 28 agents; 7 findings survived 3–0 and 1 was refuted. 11/11 mutations red, suites green, the
    remerge-diff empty.
  - **The fail-open that earned the round.** A marked child whose registered branch no longer resolves (renamed
    in place) gives ccd a `tip:null` line with no rows. The server read that as `unspent`, and the bind was
    permitted. It predates the fix round but is wave 2's own code, so as committed it is a shipped-behaviour
    defect.
  - **Fixed in the round, as one departure:** that fail-open, plus malformed-head lines answering `unmeasured`.
  - **Bookkeeping under one number:** review 144's ruled minors, which changed plan-prescribed text.
  - **Four small test and prose leftovers** are fixed now rather than carried into the destructive wave.
  - **Numbers.** Two new, 3350 and 3351.
- **2026-09-23 — wave 2's fix round done (`76594fec`); scoped review 145; wave 3 pre-flight started.**
  - **The round.** Every ruling applied, and each fix group got its own review. The R28 measurement passed on
    the real read path: ccd lists `gh pr list --head <branch> --state all` with no base filter.
  - **#177 merged in** from main, clean (no rebase; nothing touched `shared/api.ts`).
  - **First full suite.** Red only on the carried `tmp-sweep` case and a `ccrc-doctor` case that was green
    alone.
  - **Review 145.** Scoped to the round (base = the merge commit). It adds an xhigh fail-shut lens on the two
    changed reads.
  - **Wave 3 pre-flight.** Started in parallel as a workflow, because R28's broader `spent` meets wave 3's
    close-act eligibility. A no-PR child on a recycled slug must not be reclaimed as spent.
- **2026-09-23 — review 144 on wave 2 (`08e40675`): four important, twelve minor; the last full fix round.**
  - **The panel.** Six lenses (the held-out panel plus the plan's three; the fail-shut lens at xhigh), 99
    agents, 25 survivors merged into 16 findings, 6 refuted. Whole-branch: nothing destroyed, wire additive
    with one reader, citation tax paid per commit (green at each of the three commits). Fail-shut held
    everywhere except two reads that take "none" at its word.
  - **Rulings, with contract §9 R28 and R29 written the same hour:**
    1. **Spent means OPENED from the branch.** A same-repo PR whose head is the child's branch spends it,
       even when it does not bind: a stacked base, or a head the local tip does not contain. Measured first on
       the real read path. If ccd's line cannot carry unbound rows, this goes to wave 3.
    2. **A listed-but-absent marker is `unreadable`.**
    3. **Every `unbound:false` names its cause.** §2 says stop on a permanent cause, and otherwise retry once.
    4. **The actor pin binds the call site's value.**
    5. **The minors are all fixed.**
  - **Held items.** A same-project producer's exact SHA is its verified `handoffCommit`, proven merged by the
    PR's `headRefOid`.
  - **Numbers.** Ten assigned, 3340 through 3349.
  - **Named in advance as the last full fix round:** a scoped review follows, and only a shipped-behaviour
    defect sends it back again.
- **2026-09-23 — wave 2's wave-done (PR #178, `08e40675`); review 144 dispatched.**
  - **The claim.** Tasks 1–7 through Step 5, plus the declared wave-1 prose item. Main had not moved, so no
    merge was needed. The server accepted the claim; 8/8 items settled.
  - **First full suite red** (`failure: unclear`). Load flakes, each green alone (`boot`, `ccrc-update`, a
    `session-hook` p95), and the carried `tmp-sweep` case. Run with `TMPDIR=/tmp` as ruled.
  - **Citation tax** paid in each of Tasks 1, 2 and 5's own commits. README's `shared/api.ts` anchors moved
    by content; the census entry stayed at 1 and the sum at 195. Registry-read census 30/31/721 → 31/32/745.
  - **Six departures numbered 3340 through 3345**, to be defined in the plan with the review's fix round:
    - task4-first;
    - anchors-measured-not-plan;
    - mutation-row1-6-of-8;
    - run-routes-stale-sentences;
    - fresh-child-default-branch-prose;
    - leftovers-60s-lane-remote-only.
  - **Five items the worker left for a ruling**, held until the review reports:
    1. a DANGLING-symlink `.child` reads as a proven ENOENT, so `none`, so a bind is permitted;
    2. which exact SHA proves a same-project spent producer merged;
    3. the wave-1 plan still says 13/13 at :1328;
    4. two wording minors in SKILL.md and wave-lifecycle.md;
    5. an unreachable `unbound:false` with no detail.
- **2026-09-23 — wave 2 stalled on claims; ruled to proceed.**
  - **The stall.** At about 17:00 UTC run 138 had Task 4 and the carried prose done, and was blocked on
    Tasks 1, 2, 3, 5 and 6. run 128 (centralised-update-management W2, `warm-river`, PR #176) holds claims
    735 and 736 over `shared/api.ts`, `store.ts`, `watch.ts`, `server.ts`, `README.md` and
    `fleet-health.test.ts`. The worker's mail to warm-river had sat queued for about 45 minutes behind its
    not-idle gate. #176 was still `working` at 22,880 lines.
  - **The ruling.** Proceed with narrow, additive hunks. Claims are advisory: they buy an early answer
    instead of an end-of-wave conflict, and waiting would have stalled all five waves for hours. Whichever
    PR merges second merges main (never rebase), resolves, re-points and re-measures. warm-river's
    coordinator, `bright-river`, was told and invited to object (mail 2235).
  - **Two worker findings carried to wave 3** (see Carried constraints).
- **2026-09-23 — wave 1 deployed; its two measurements; wave 2 dispatched.**
  - **Rollout.** `ccrc rollout --to v0.0.19`, default order (fleet box first), exit 3. Both boxes moved from
    v0.0.15 and agree at `bbb5e714`. The release also carried #171, #173 and #174, which had never been
    rolled out.
    - Fleet box doctor: 0 failed, 5 warned, all pre-existing kinds.
    - Server box doctor: its one FAIL is the old inactive `ccrc-agent.service` unit on a server-role box,
      which is the operator's to clear and predates this programme.
    - Before moving, #171's two new files (`ccgpt-proxy.py`, `ccgpt-usage.py`) were checked on the fleet
      box: neither path was occupied, and no live OpenClaw file names them. The shared unit pair stays
      unplaced (D-3172).
  - **Measurement (a): the scratchpad FOLLOWS `TMPDIR`.** Wave 1's quiescent probe found Claude Code's
    per-uid root under `TMPDIR`, with nothing under `/tmp/claude-<uid>` for that cwd. A child's harness
    scratch therefore dies with its temp root.
  - **Measurement (b): the pre-policy stock.**
    - Pre-merge snapshot, 2026-09-23T12:49:56Z: 27 workspaces, 0 marked.
    - **Shipping figure, 2026-09-23T15:52:17Z, right after the rollout: 31 workspaces, 0 with a `.child`
      marker, 31 pre-policy, 5 of them archived.** That is the stock this programme never reclaims.
    - It includes this programme's own earlier children (`keen-hollow`, `amber-summit`, `plain-ridge`),
      minted before the ccd shipped, and `warm-hollow` (ws-slug-collision, dispatched minutes before the
      rollout). They keep the human ceremony.
  - **Wave 2's dispatch is the first marked child.** `ccrc-pwa-plain-river.child` holds `138`, and
    `~/.cc-tmp/ccrc-pwa-plain-river` exists at 0700.
- **2026-09-23 — wave 1 accepted and merged (`bbb5e714`, #175).** Scoped review 136 over `31c11916..4c23fa25`:
  the held-out panel, 30 agents, nine raw findings, none refuted, merged into six. None is a shipped-behaviour
  defect. Two are false prose in the new `wave-lifecycle.md` sentence: its remedy does not fit the causes it
  lists, and it misses the empty-list case. Four are plan text left stale: row 9's old title, two more copies
  of the census over-claim, and the suite size. As committed before that round opened, the wave is accepted
  and all six are carried into wave 2 as one declared item (see Carried constraints). Two rulings go with
  them: the census over-claim is narrowed wherever the plan states it (plan:49, :843, :984, :1344); and prose
  added under a ruled deviation gets no content pin, since the mutation doctrine binds guards and a prose pin
  against prose is green while both lie. Required checks green on the PR; the macOS leg is non-required and
  was still pending. Merged with `--admin`. Contract §9 (R24–R27) records wave 1's four rulings.
- **2026-09-23 — the last fix round done; scoped review 136 dispatched.** Tip `4c23fa25`: two commits, `ccd/ccd`
  untouched; row 4 re-spelled and measured red on exactly its one case (17/18); the `child-omitted` sentence
  added; the census title narrowed; the count corrected. Touched suites and guards green; `suite: unrun`, as
  ruled. Review 136 reads `31c11916..4c23fa25` on the held-out panel alone. Its first dispatch answered a bare
  502: `ws-add` picked the slug `quiet-delta`, and `git worktree add` refused because a branch `ws/quiet-delta`
  from 2026-09-17 still exists. Nothing was created (run still `planned`, no worktree, no registry row), so it
  was retried once and landed on `plain-ridge`. **An observed ccd defect, outside this programme's scope:**
  `_ws_slug_free` asks only the registry, never whether `ws/<slug>` exists as a branch, so a random pick can
  collide with any leftover branch. Measured the same hour: 27 of this repo's 33 `ws/*` branches have no
  registry row. The operator asked for it to be fixed: its own programme, `ws-slug-collision` (run 137).
- **2026-09-23 — review run 135 on `31c11916`: six minors, no shipped-behaviour defect; one last fix round.**
  Six Opus lenses (the held-out panel plus the plan's three), 51 agents, none died, nothing unexamined;
  whole-branch points (a)–(e) hold; suites green but for the carried `tmp-sweep` case and a `boot.test.ts`
  load flake green alone. Rulings: (F1) mutation row 4, stale since the marker ruling, is re-spelled against
  the shipped line inside that ruling's number; (F2) `wave-lifecycle.md` §2 gains one sentence naming the
  no-evidence cause of `child-omitted` (a server holding no caps list), a new number; (F3) the run-id census is
  a literal-absence pin, accepted as that — its title narrowed, a new number — and wave 3's review reads every
  new run-id parse for a call to `_child_runid_valid`; (F4) no second `-L` after the `chmod`: a path can be
  swapped at any later moment, so it moves the window rather than closing it, and wave 3's tail, which never
  follows a link leaf, is the defence; (F5) a count corrected 18 → 19; (F6) a commit message's false
  "already", recorded only. **Named in advance as wave 1's last fix round:** its review is scoped to the
  round's commits, and anything it finds that is not a shipped-behaviour defect is carried forward and the
  wave accepted with it recorded.
- **2026-09-23 — wave 1's fix round done; review dispatched.** Tip `31c11916` (the marker ruling line-neutral,
  its new case red 5/5 on the old test; the eight numbers defined; `origin/main`'s #174 merged in, no
  rebase, citation corpus re-measured unchanged). Suite red only on the carried `tmp-sweep` case. Review
  run 135 dispatched on the held-out panel plus the plan's three lenses (six Opus lenses). Two things the
  worker flagged are the coordinator's and are owed after the merge: the contract's §1 "non-empty" wording
  (superseded by the marker ruling) and the gap below for live children.
- **2026-09-23 — wave 1's first wave-done, sent back before review for two rulings.** PR #175, tip
  `08442ef4`, re-measured and accepted by the server (`awaiting-review`, 6/6 items). Its report asked
  two rulings, both ruled and sent back in one fix round so the held-out review reads the final tip once:
  (a) `_child_tmpdir` judges the marker with `_child_runid_valid`, not a non-empty test — one run-id
  grammar for every ccd reader of the marker, and a corrupt marker's scratch stays where `ccd-tmp-sweep`
  collects it (a contract change: §1's "non-empty" is superseded); (b) a child's `~/.cc-tmp/<id>` left
  behind by a human verb has no collector — it gets one in wave 4 (a leaf with no registry row,
  twice-observed, only on a clean listing, `reclaim-paused` honoured, never following a link), and the
  interim leak until wave 4 deploys is accepted. Eight numbers of the block are assigned for these two and
  six departures the worker named (probe location; the probe re-run; two test-hygiene fixes from its own
  final review; stopping at Step 6 per the brief; an out-of-scope README anchor repair), defined in the
  wave-1 plan by the fix round. The measurements: the scratchpad **follows** `TMPDIR` (a second,
  quiescent probe; the first was confounded by a concurrent subagent and a probe directory under a path
  containing `/scratchpad/`); a pre-merge snapshot counts 27 workspaces, none marked (5 archived) — the
  shipping figure is owed after rollout. First full suite: red (`failure: unclear`) — a `boot.test.ts`
  load flake, a `typecheck-tests` install-order artifact, and `tmp-sweep.test.ts`'s "FAILS CLOSED" case,
  which the worker measured red on an untouched `aed80210` while CI's test-server leg passed on main:
  box-environment, not this wave's. No routing change: the red is not the worker's.
- **2026-09-23 — documents merged, wave 1 dispatched.** Spec, contract, ledger and plans reached main as
  `aed80210` (#173; the non-required macOS leg was cancelled at its time limit with no test failed). Run 131
  dispatched into a fresh child; `skillState: present`.

- **2026-09-22 — the design, its four rulings, and the accepted spec.** The operator gave four rules, then
  ruled on four questions: pin everything then reap; a PR *opened* spends a child; transcripts are kept;
  kill-switch plus attached-defer. The first form of the design was reviewed adversarially before approval
  (six lenses, 44 findings, three refuters each, 38 survived); the spec's Appendix B records what each
  changed.
- **2026-09-22 — delivery cancellation moves to wave 3.** The spec's §5.6 made it part of the reclaim act
  while its wave table placed it in wave 4. Corrected in the spec before any plan was written: shipping
  reclaim-on-close without it would run the slug-recycling hazard at the new rate for as long as wave 4
  took. Not a deviation — the spec was self-inconsistent and was fixed at the source.
- **2026-09-22 — the artifacts section reconciled with `ccd-tmp-sweep` (#168).** That sweep landed the day the
  spec was written and gives `/tmp/claude-<uid>/` its first collector. Its root and a child's
  `~/.cc-tmp/<id>` are disjoint; the spec's §5.2 states the one consequence (a child under a terminal
  refusal keeps its temp root).

## Carried constraints

Findings every wave's reviewers get, because each is easy to lose between waves:

- **macOS CI legs are treated as FLAKY** (operator, 2026-09-28: "ignore the macos runs for now, they are being
  fixed, treat as flaky for the moment"). A red, cancelled or hung macOS leg (`test-macos`, `probe-macos`) blocks no
  merge, no review and no wave-done, and nobody waits on one or re-runs one. Darwin evidence is still reported as
  found, with job ids, or as unmeasured, but it gates nothing until the operator lifts this.
- **Two authorities, always.** Child-ness is the box marker AND the server's `--child-of` argv, equal. No wave
  may add a path that infers child-ness from anything else — not `--no-rc`, not a dec reason string, not a
  run row alone.
- **No boolean at the child seam.** The registry's reading is three-way (not a child, child with run id,
  unreadable) and the spent verdict is three-way (spent, unspent, unmeasured). An unreadable marker REFUSES
  a bind and DEFERS a reclaim; an unmeasured spent verdict REFUSES a bind. Any wave that collapses either
  is reintroducing the fail-open the spec's Appendix B item 6 exists to prevent.
- **Every new surface is capability-gated and read with `capSupported`**, never `verbSupported`, which
  permits when the box's verb list is absent. Three tokens: `child-argv-v1` (wave 1), `reclaim-v1`
  (wave 3), `reclaim-pause-v1` (wave 4).
- **The pause file is read inside `ws-reclaim`**, on the fresh path and on resume. A server-side check alone
  fails open into deletion.
- **`ws-reclaim` never resumes `ws-reap`'s work and vice versa.** The breadcrumb value is `reclaim:<phase>`;
  a mismatched flavour refuses.
- **Every CITED file pays the citation tax.** An insertion into `ccd/ccd` or `shared/api.ts` (the files the
  README and the frozen compaction-card corpus cite by line) pays S6-R11 in the same task, and edit length
  above the frozen corpus's highest `ccd/ccd` anchor is a decision: prose there stays length-neutral, long
  comments go below it.
- **Another programme holds claims on files waves 2–5 edit.** At run-open (2026-09-23) the
  centralised-update-management workers (runs 128, 129) held claims covering `shared/api.ts`,
  `server/src/coord/schema.ts`, `ccd/ccrc` and `ccd/ccrc-doctor-checks`. Wave 1 touches none of them. From
  wave 2 a worker's `POST /api/claims` may answer 409 naming that holder; the claim protocol (worker clause 11)
  is the answer — mail the holder, work what is uncontested — and a long stall is reported, never forced by
  the worker. The COORDINATOR may rule it to proceed (done for wave 2, 2026-09-23), telling the holder's
  coordinator; the second PR to merge pays the conflict.
- **A journal line with no `at` is invisible to the generation fence and the attention list** (contract §8
  R22′, D8: the ingest time is never an event time). Two consequences are accepted, not fixed: a terminal
  refusal journaled without `at` keeps its child out of the sweep but off the attention list, and a clockless
  `create` cannot fence a recycled slug. ccd writes `at` from one clock read on every line, so both need a
  corrupt or degraded journal; a reviewer who finds a real producer of clockless lines reopens this.
- **A child's temp root outlives a human verb until wave 5** (R36 moved R25's collector there, 2026-09-26). `ws-rm`/`ws-reap`/`ws-gc --prune`/`forget` on
  a child drop its marker and keep `~/.cc-tmp/<id>`; wave 4's sweep is its owner (ruled 2026-09-23 on
  wave 1's report). Wave 4's plan gains that task before its dispatch. And from wave 1's deploy until
  wave 3's, NO child's temp root is collected, live or finished: they accumulate, still marked, and wave 3's
  reclaim and wave 4's sweep take them.
- **Wave 1's six prose leftovers ride wave 2 as one declared item** (review 136). All of them are text, and none
  is shipped behaviour:
  - `ccd/coordinator-skill/references/wave-lifecycle.md` §2's `child-omitted` sentences get one remedy per cause:
    - the local boot window and a remote list-less or EMPTY-list ready frame both clear within about a minute,
      with no action (the watcher's 60 s caps lane);
    - a failed local caps probe needs a server restart;
    - an agent that stays list-less past that lane needs its ccd or agent looked at.

    The rewrite must still agree with the next sentence, "not an error". D-3338's bullet in the wave-1 plan
    says "two sentences" and matches the text.
  - The wave-1 plan's census over-claim is narrowed wherever it is stated: :49, :843, :984 and :1344 (row 9's
    old title). D-3339 says so.
  - Task 2 Step 7's "13/13" becomes 18/18, and D-3336 names the five invalid-marker cases it added.
- **Two declared items for wave 3, found by wave 2's worker.** Wave 3 is the next wave that edits ccd.
  1. **The scratch-slug guards do not know a child's temp root.** `-tmp*|-private-tmp*|-var-folders*|-private-var-folders*`
     is spelled at `ccd/session-hook.sh:712`, `ccd/ccrc:3486` and `ccd/ccrc-doctor-checks:4670`. A claude
     session rooted under `$HOME/.cc-tmp/<id>` therefore gets a durable memory store, and
     `session-hook.test.ts`'s "skips a scratch slug" case reds inside every marked child (its `os.tmpdir()`
     is that root). All three guards must learn the `$HOME/.cc-tmp/` shape; the second and third files may be
     claimed by the update programme. Until then, a child runs that suite with `TMPDIR=/tmp` and names the case.
  2. **(MOVED TO WAVE 4 by the wave 3 pre-flight's R-5: since R28, `childSpent` never reads `ours`.)**
     **ccd's PR ownership read folds a failed git read into "not ours".** `is_ours` (ccd ~5423) folds a failed
     `git cat-file`/`merge-base` into False. A transient git failure therefore reads a real PR as absent,
     and wave 2's `childSpent` answers `unspent`, which permits a bind. The read becomes three-valued: an
     unreadable answer is `unmeasured`, which already refuses. This is the programme's no-boolean rule, one
     layer down.
- **Wave 3: a recycled slug inherits its head name's PR history** (ruled 2026-09-23 on wave 2's F1 fix).
  Slugs recycle within a 144-name namespace per project; 12 are already PR heads on this repo. `gh pr list
  --head` returns every PR ever opened from that head name. Since R28 counts unbound rows, a child on a
  recycled slug reads `spent` from birth. That is safe, and it costs only a re-bind of a research child: a
  fresh child is never gated. Wave 3 adds `createdAt` to ccd's `PR_JSON_FIELDS`, and a same-branch row then
  counts only if it was created at or after this incarnation's birth. A row with no readable `createdAt` still
  counts.
- **Wave 3 is amended before dispatch** (pre-flight, 2026-09-23; the plan's appended "Pre-dispatch amendments",
  contract R30 and R31). Among them:
  - the incarnation rule, as a new Task 7b;
  - the close reclaims on `spent` only when this incarnation's PR is dated;
  - the reclaim never follows a symlinked workdir, nor acts on a workdir another registry row names;
  - the scratch-slug guards, as a new Task 10b;
  - claims proceed as in wave 2.
- **Wave 3 settlements on A1** (2026-09-24, after wave 2's last round moved `childSpent`):
  1. The live rung's order at `95703aa7`:
     - a non-string `branch` → unmeasured;
     - any same-repo same-branch row → spent, naming the highest number;
     - a non-fork row with a non-string head → unmeasured;
     - an unestablished repository → unmeasured;
     - a non-string `tip` → unmeasured;
     - then `phaseFor`.

     A1's placement goes inside the same-repo same-branch step.
  2. "Only `inherited` rows are dropped" means dropped from every later step, `phaseFor`'s `boundRow` included.
     The tip-rung comment's "boundRow can only return null here" stays true, and an inherited-only line answers
     unspent even when the old row would bind the tip (the merge-commit shape). That case is added.
  3. R-2's row placement is `this | inherited | unplaced`. A birth that cannot be placed is the birth's own arm.
     The round's local `unplaceable` (a non-fork row whose head cannot be read) is neither. No two meanings share
     one word.
- **Review 147's text corrections ride wave 3 as one declared item** (docs and comments only; D-3350 and D-3351
  are edited in place, with no new numbers):
  - F1: the wave-2 plan's rows 2 and 7, and D-3350, name the commit their counts were measured at (90c51032, 62
    cases), or are re-measured at `95703aa7` (65/65; 61/65).
  - F2: `child-reclaim-spent.test.ts` (xii)'s comment gets the true reason: no case covered an ABSENT `tip` key.
  - F3: `child-reclaim-refusals.test.ts`'s sha-tip comment is narrowed to `noPrLine`.
  - F4: `childSpent.ts`'s tip-rung comment attributes the null half to its sources and claims the absent half as
    3351's own.
  - R1: case (vii)'s label reads F7, and D-3351's "for either" gains "for every row with a string head".
  - `wave-lifecycle.md`: a repeated `spent-unmeasured` usually means the child's branch no longer resolves (a hand
    rename), and the next run opens on a fresh child instead of retrying (review 147's dissenting refuter).
- **Wave 4 also inherits from wave 3's fix round** (2026-09-26):
  - the tail's anchored `kill-session` has no deadline (pre-existing);
  - `_ws_tombstone`'s `reflog` field still writes `reflog show --all | head -200`, other sessions' commit ids, into a
    child's tombstone, beside `_ws_attic_pin`'s capped read;
  - `_ws_tombstone`'s comment is inverted under branch drift (F8);
  - a nested checkout's held `index.lock` is checked nowhere, so a nested tree mid-write is committed from disk;
  - "before wave 1's deploy" in `wave-lifecycle.md` and the coordinator SKILL.md (#178) has F11's problem;
  - the reclaim verb suite runs ~414 s against a 600 s ceiling; split it;
  - `ccd-child-reclaim-ladder`, `child-reclaim` and `wsaudit` are unmeasured on Darwin, because main's macOS hang
    precedes them in leg 1. Measure them on the first macOS leg that gets past `ccgpt-proxy.test.ts`, and report the
    job id.
  - the comment above `_ws_wip_commit`'s index copy says "a hidden one too"; 3520's copy fixes ordinary tracked edits
    only, and a hidden-flag edit is found by content. Correct the comment.
- **Wave 4 also inherits from review 171's rulings** (2026-09-26, measured by the attack; none of it is opened by wave 3):
  - a staged intermediate version is lost (stage A, edit to B; the WIP keeps B). Rule a second WIP parent from the
    unmodified index copy, or name the residual;
  - a foreign clone's reflog-only commits go with its tree (rung 9's `rev-list --all` counts 0, `--reflog` 1).
    Design a keep, for example fetch those ids into the child's repository and pin them, or name the residual.
    Refusing would strand every clone with amend history;
  - `parseChildReclaimResult` maps every `{failed:…}` to resumable, including ccd's in-lock `probe-unmeasured`;
  - an absolute other row whose `_ws_realpath` fails is compared unresolved;
  - minor, fail-closed: a flagged link whose target ends in a newline; an inherited `GIT_DIR`, `GIT_WORK_TREE` or
    `GIT_INDEX_FILE`; a `$REG` filename containing a newline;
  - git ≥ 2.48 is unmeasured on the box.

  Accepted residuals, all fail-safe:
  - an aliased `..` row through a link to a standing child is not refused;
  - an exec-bit-only change on a flagged file is not an edit;
  - launchctl's rc 113 is taken from ccd's measured comments, not measured on a real macOS.
- **Wave 4 also carries review 163's three test-text minors** from `child-tmpdir-bsd` (#185), in
  `server/test/ccd-child-tmpdir.test.ts`:
  - the census comment should name line continuation among its blind spots, or join `\`-continued lines first;
  - "the decision lives in _spawn_start" should move out of the `describe.each(CHMODS)` block, or its plan
    entry should be narrowed;
  - the shim comment's "on macOS the real chmod is already BSD" should say it was measured on the CI runner.
- **Wave 4 inherits from wave 3's wave-done** (2026-09-25):
  - contract R32: the sweep reclaims a child held by a programme that has retired, and `not-finished` splits into
    three words;
  - contract R33: birth is the FIRST dispatch stamp;
  - the close's two pr-state calls run inside the coordination mutex for up to ~40 s, against the client's 30 s
    timeout. Bound them, or document the client-side retry;
  - coordinator clause 3 says "reclaimed … when that child's run closes", which overstates for review children and
    non-final closes. It is pinned verbatim, so the change needs a test edit;
  - `wave-lifecycle.md`'s "commits … on the child's branch" is wrong under `wip-moves-no-ref`;
  - the fail-safe portability residuals, recorded, not scheduled:
    - no `origin/HEAD` refuses every child `branch-elsewhere`;
    - git ≥2.48 relative worktree paths refuse `containment-unproven`;
    - a SHA-256 repository gets `pin-failed`;
    - two terminal `tree-unreadable` residuals;
    - an unsearchable `$REG`, clips or temp root.
  Spec text owed by the coordinator's docs PR: R30's placement is in the contract only, while comments cite §5.3;
  §5.5 step 2 needs rewording for `wip-moves-no-ref`; §6 and Appendix A carry T1's counts.
- **Wave 4 inherits, from wave 3's pre-flight:**
  - `is_ours` three-valued;
  - a `ws-reap` guard mirroring R31's symlinked-workdir refusal (`ws-reap` is human-gated but follows the link the
    same way);
  - the sweep as the owner of a child whose close trigger was lost to a server restart, or that wave 2's dispatch
    refusal released.
- **Wave 4's inherited items above are placed** by its plan's pre-dispatch amendments (2026-09-26). Exceptions:
  - `is_ours` and `_ws_attic_pin` left the programme (R-7, R-8);
  - R25 moved to wave 5 (R36).
- **Wave 5 inherits from wave 4's pre-flight:**
  - R25's collector (R36), with the requirements the pre-flight measured;
  - whether the ten close words are recorded for the chip;
  - whether R37's and R-5d's skips (`coordinating`, `minting-run-postdates-child`, `child-birth-unplaced`) reach the
    attention list;
  - ccd journaling the failures the mirror never sees: audit-time `unmeasured`, `probe-unmeasured`, pre-lock dies,
    `flock-unavailable` and `lock-unopenable`.
- **Wave 4's integration round inherits, from the row-placement reviews (2026-10-02):** a remedy pin that binds
  `_ws_reclaim_workdir_shared`'s shared string rather than the text the audit, verb and tail print; three row-level
  ladder cases (`demo-alias-up`, the newline spelling, the logical-entry spelling) that no longer tell their resolver
  guards apart since every non-`complete` row gives one answer; and the two pre-existing `//` remedy wordings that
  still name a re-point, which ride with the path-identity follow-up's wording.
- **Wave 4's integration round also inherits, from review run 215 (2026-10-02):** the child's own rc-1 remedy
  clause "never remove or replace what stands at this child's own workdir" is bound by no assertion (the remedy-pin
  class above); `_ws_reclaim_resolve` refuses a `..` in the rest before re-walking a prefix that holds one, so a row
  that logically is the child lands in retryable `unres` with a detail that is false for it; and three row-placement
  plan selectors still name the retired `repairing the alias` control.
- **Wave 4 fixes, by operator ruling (2026-10-02, from entry-safety review run 216):** `_svc_real_home` builds the
  home path with `eval printf '%s' "~$u"` from `USER` or `LOGNAME`, and on Darwin both the audit's unit-state read
  and the reclaim's launchd disable reach it, so a `USER` carrying shell syntax executes inside a protected start.
  It is on `main` already and Darwin-only. Validate the login name before the expansion, or avoid `eval`, before the
  sweep runs unattended on any macOS box.
- **Wave 4 also inherits, from entry-safety review run 217 (2026-10-02):** classify the launcher's protected tokens
  case-insensitively (`ccd/ccd-entry.py`'s `is_protected`), because an inherited `nocasematch` widens the body's
  dispatcher and audit parse while the launcher compares exactly, so a case-variant protected verb starts ordinary
  and rests on the best-effort body guard. Protecting a superset is harmless. Separately, `node shared/mark.mjs
  --check` is a hollow stamp gate (no CLI; exits 0 for any file) cited by several plans; give it a real CLI or
  retire the citation, with `ownership.test.ts` as the gate meanwhile.
- **Wave 4 also inherits, from entry-safety review run 222 (2026-10-02):** R1, the destination-type half of the
  installer's "every refusal comes before anything is created" has no red mutation (moving `makedirs` between the
  layout refusal and the destination loop stays green); pin it with a fresh-HOME row where `~/.local/bin/ccd` is a
  directory and `~/.local/libexec` is absent. R3, the exit-2 sentence ("the body moved and the launcher did not … the
  mismatched pair now refuses every start by digest") is false for the launcher-postcondition arm, which exits 2
  after both halves moved; correct it in `ccd/ccd-entry-install.py`'s header and stderr and in `deploy/deploy.sh`.
- **Carried until `ccd/ccrc` is free of another programme's claim (2026-10-02; joined wave 4's round 2026-10-03):** review 222's R2 (`ccd/ccrc`'s
  `_inst_entry_python` signature comment and `cmd_install` comment still say the shebang names the canonical
  python3), R3's `ccd/ccrc` sentence, and `ccd/ccrc`'s identical copy of `_svc_real_home`'s `eval`.
- **Wave 5 inherits, from wave 4's reviews 254 and 258 (2026-10-04):**
  - **G3 (must bound):** the F1 continuity rule never licenses while three or more children stay presence-held, which
    is spec §5.7's unbounded wedge. Bound it, and state it truthfully in A9, the docstring and lens 1's "presence can
    defer but never reset the ceiling".
  - **G4:** move the lane's presence clocks onto a monotonic clock, so that a backward wall-clock step cannot hide an
    unobserved hole.
  - **G1's residual:** consider stamping presence at the answer's arrival.
  - **F6:** unset `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG` inside the containment, for wave 5's SAFETY lens.
  - **Prose:** G2's false reason for keeping the release mark (`watch.ts` and plan A10), and G5's "on the same clock"
    in `ChildReclaimRequest`.
  - **Measure first:** on a live box, the first sweep passes and the shape of the backlog drain.
- **Wave 5 inherits, from the row-placement review (2026-10-01):** recovery for gone-directory alternate rows. An
  alternate row whose path is gone holds every other child at `unmeasured`, and two vanished or interrupted children
  hold each other; the recovery must prove the gone path was ccd's own worktree without consulting process state.
- **After wave 5, a path-identity follow-up programme:** a re-pointed alias and a bind-mount spelling resolve
  `complete` and outside although a session may sit inside the child; device/inode ancestry is the measured
  direction, and the window between `_ws_reclaim_owned` and the tail's `git worktree remove` rides with it.
- **Wave 5 inherits, from wave 3's first live reclaim:** dot-lock files (`.reap-<id>.lock`,
  `.<id>.compactions.lock`, `.prstate-<id>.lock`) outlive a reclaim. The R25 collector's "no `$REG` entry of any
  suffix" condition must not read a lock as a live row, or the reclaim's tail must remove them.
- **Wave 5 inherits:** the PWA's abandon confirmation says the child's workspace will be reclaimed. The ungated
  abandon door (D-282) reaching a destructive act is inside the single-user trust model; it is recorded, not
  changed.
- **Wave 4 also carries ws-slug-collision's review residue** (that programme's ledger, "Residue"). It is two
  unpinned arms of `_ws_slug_git_state`, plus header and plan wording, plus two fail-closed narrowings. It is
  ccd-only and below the frozen boundary, and it rides wave 4 because wave 4 edits ccd anyway.
- **Wave 3 inherits two readings from wave 1's review.** Every run-id parse wave 3 adds calls
  `_child_runid_valid` — the census only catches a verbatim second copy, so the reviewers check it by
  reading. And `_child_tmpdir` checks the leaf for a symlink once, before `chmod` (contract R1, check-once
  under the single-user trust model): wave 3's tail must re-judge the leaf at removal time and never follow
  a link.
- **`tmp-sweep.test.ts`'s "FAILS CLOSED" case reds on the fleet box on an untouched main** (wave 1,
  2026-09-23) and passes in CI. A reviewer who meets it measures it against the base before calling it a
  wave's.
- **Anchors in these plans are snapshots.** Two other programmes (centralised-update-management W2–W5,
  gpt-lane 2b/3) are live against the same files. Every plan locates code by content; its line numbers are
  not addresses. `ccd/ccd` edits re-stamp and pay the citation-corpus tax.

## Next-wave brief

**Wave 4 has merged** (#215 `b40f4145`, v0.0.79), after both prerequisites (#226, #222). **Wave 5 is run 260,
`planned`,** with its block 3926, 3927, 3928, 3929, 3930, 3931, 3932, 3933, 3934, 3935, 3936, 3937, 3938, 3939,
3940, 3941, 3942, 3943, 3944 and 3945.

Before it is dispatched:
1. Observe v0.0.79's convergence and the sweep's first passes, read-only.
2. Write wave 5's pre-dispatch amendments to `docs/superpowers/plans/2026-09-22-child-reclamation-wave5-run-chip.md`,
   placing every "Wave 5 inherits" item above (G3's bound first) beside the run chip and R36. The coordinator
   commits them on its branch, and they reach the worker as a handoff blob.
3. Run a pre-flight review of the amended plan.

Then dispatch one fresh child with the standard routing and the mandatory SAFETY lens. After wave 5 merges, open the
path-identity follow-up programme.
