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
| 5 | the closed run's reclaim chip; the presence lease and its clocks (R39); R37 fenced to the generation (R40); the sweep's verdicts visible (R41–R44); the abandon copy and prose (R45, R46) | server + pwa (R38) | #290 | **deployed** v0.0.105 (`b27fabc15`, merged 2026-10-06 18:50; both boxes current by 19:04, through the updater); run 260 closed 19:05; reviews 285 and 303 (scoped, after fix round 1: no defect) |
| 6 | `ws-reclaim` repaired (R48): the ONE removal helper and the in-use wait/keep of a temp root (R49); the positive witness `$REG/tmproots/<id>` (R50); F6 and the harness strip (R51); journaling `probe-unmeasured` and the id-tied pre-lock dies (R52); the three-way gone-branch read (R53); the `recorded` placement basis (R54); the vanish re-read's second trigger (R55) | **AGENT-FIRST** | #326 | **merged** `b0647d850` (2026-10-08 13:07Z) — run 291 (`ccrc-pwa-amber-river`); reviews 335, 341 and 346; deploy observed next |
| 7 | the temp-root collector verb, inert (R57): audit + token, destructive verb, cap token, agent grant, entry guard; witness-matched, slug-free, unused, idle 24 h, twice observed | **AGENT-FIRST** | — | **to plan**: its own run, block and pre-flight |
| 8 | the collector's server lane (R58), after workspace-lifecycle wave 3b merges and the fleet advertises wave 7's token; SAFETY and SECURITY lenses | server | — | **to plan** |

**Rule 3 is enforced at the end of wave 2** with no destructive verb in existence: a second bind on a
PR-bearing child refuses. **Wave 3's `ws-reclaim` and wave 7's collector are the only verbs that destroy anything** (R38, R48). Waves 3 and 4 do nothing on a
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

- **2026-10-08 13:08 — review 346 ruled clean of class (a); #326 MERGED as `b0647d850` at the reviewed tip
  `d12b6467e`.** The report is `ccr15-evidence-archive/reviews/review-346-d12b6467.md`, and run 346 closed `done`.
  - **Review 346.**
    - The merge's code resolution is an exact union of both sides.
    - `ccd/ccd` and `ccd/ccrc` have no non-comment change beyond the stamp, proven four ways.
    - SAFETY found no merged path from main that composes `ws-reclaim` or `ws-expire`, carries their tokens, or
      queues a child reclaim outside wave 6's checks. Every path is tabled.
    - The README departure was forced, and its anchors are right.
  - **Its four class (b) findings are comment and plan prose, all fail-safe. Three repeat sentences this coordinator
    dictated. None goes back; each is carried to wave 7, which edits these regions anyway:**
    - (F1) `_ws_dir_physical`'s list of bare captures is not exhaustive, and two of them are label prefixes only;
    - (F2) "only a back-linked tree passes" holds outside the leaf only;
    - (F3) an inner NUL reads refused, not unmeasured, for the back-link caller;
    - (F4) the two `childReclaim.ts` comments still state the audit-failure clause without the arm. The spec, the
      contract and 4457 already carry the widened residual.
  - **Wave 7's brief also names the server half of the `crumb` fix:** `childReclaimAudit` maps an audit's exit 1 to
    `unreadable` before it parses stdout.
  - **Record (class c).** Main's dead-coordinator journal clause counts a child's pre-start `failed`
    `probe-unmeasured` reclaim row as deliberate, so the lane abstains. That is fail-safe, and it goes to quiet-river.
  - **The merge.** `gh pr merge 326 --squash --admin --match-head-commit d12b6467e`. Every gating check was green
    (`test (server)` included); the macOS legs are advisory. Main `669b83055` was an ancestor of the tip.
  - **Next.** Observe the release and the automatic agent-first deploy, read-only. Then open wave 7's run, and only
    then close run 291 `final:true`.

- **2026-10-08 12:22 — the integration round's wave-done is verified (mail 4007); run 291 is at `awaiting-review` on
  `d12b6467e`, and scoped review run 346 is opened.** The evidence is under `ccr15-evidence-archive/wave6-int-done/`.
  - **Measured.** The tip is pushed, PR #326's head equals it, and main `669b83055` is an ancestor. The round has two
    commits:
    - `de01c465d` merges main. `ccd/ccd` and `ccd/ccrc` are unchanged by it.
    - `d12b6467e` holds the text fixes. Its `ccd/ccd` change is line-count-neutral, and `mark --check` exits 0.

    The R56 gates, the status readers and `tsc` are green, as the worker reports. CI on the tip was still running.
  - **The README hunk takes no number.** It was one sentence whose `shared/api.ts` anchors both sides had re-pointed,
    so keeping both texts would have printed it twice, each copy with stale anchors. The worker's
    `readme-api-anchors-remeasured-on-merge` points it at the merged file's lines instead. That departs from the
    integration ruling's "byte for byte", not from the plan, so it takes no deviation number. 4463 stays unused, and
    the block ends there.
  - **Review run 346.** Its brief is `ccr15-evidence-archive/review-291-int-brief.md`, scoped to the two commits. It
    adds a SAFETY lens at xhigh asking whether #328's merged code composes or queues `ws-reclaim` or `ws-expire` on a
    path wave 6's checks do not expect. Its dispatch waited on the daily cap, and it was dispatched at 12:39 to
    `ccrc-pwa-warm-basin`, on the first freed slot.

- **2026-10-08 12:03 — review 341 ruled: wave 6 is accepted on its code; an integration round merges main (mail
  4004).** Rulings: `ccr15-evidence-archive/reviews/integration-291-rulings.md`.
  - **Review 341.** It read fix round 1 at `750910110`. 41 findings were raised by 139 agents, and 11 survived the
    refute pass, which merge into 9. None is class (a). F1's SAFETY property holds:
    - review 335's case keeps the leaf under reclaim and under expire, in the temp root and in clips;
    - so do the four shapes;
    - the straggler races found 0 removals in 94 runs.

    The review run closed `done` on the reviewer's `{reviewedTip, report}`.
  - **Rulings.**
    - The three prose findings (F1, F2, F3) and F8's record are fixed as text in the integration round, folded into
      4457, 4149 and 4458.
    - F4, F5, F6, F7 and F9 are pins, recorded and carried to wave 7.
    - F1's code fix rides wave 7's `crumb` field. Its residual now names the audit path too.
  - **Integration.** #328 (workspace lifecycle wave 4) landed first, as `669b83055`. #326 conflicts in one hunk of
    `server/src/watch.ts` (the coord status literal) and one of `README.md`, and `ccd/ccd` is unchanged on main.
    - Under R56, wave 6 is the second lander: the worker merges main and keeps both sides, then runs the R56 gates
      and the status readers.
    - The full suite is not re-run: PR CI's selection on the merged tree is the arbiter.
    - Run 291 is back at `working`.
  - **Next.** A scoped review reads only the merge resolution and the text fixes. Then the merge, then the deploy.

- **2026-10-08 08:01 — fix round 1's wave-done verified (mail 3983); run 291 is at `awaiting-review` on
  `750910110`.** The wave-done's fingerprint was re-measured, and the evidence is archived under
  `ccr15-evidence-archive/wave6-fr1-done/`.
  - **Measured.** The tip is pushed, PR #326's head equals it, and the merge-tree against main `3c33d3218` is clean.
    CI on the new tip was still running.
  - **Suite.** The full suite ran on code tip `bf8c542fb`, with server, agent and pwa all green apart from two reds:
    - `tmp-sweep`'s "FAILS CLOSED", which is red on main too;
    - `ccd-spawn-split`, a load flake that passes alone.

    Six commits followed, five docs-only and one comment-only. The tests that read the docs re-ran on the final tip.
  - **Numbers.** 32 numbers are defined singly in the plan. 4463 was not used, and no new departure was found.
  - **Accepted.** The spec's §5.2 gained one witness sentence beyond the four regions, because 4459 had made the old
    sentence false. It lies far from #328's §5.8 replace.
  - **Ruled.** A `probe-unmeasured` on a RESUMED arm still reads not-resumable while a breadcrumb stands. Its
    classification is unchanged in this round, and it is carried to wave 7 with the additive `crumb` field. The
    scoped review checks the worker's claim that only the sentence is wrong, never the act. ws-expire's parser
    (`archivedExpiry.ts:231`) has F3's twin, which is workspace-lifecycle's and goes to quiet-river.
  - **Landing order.** #328 (run 314) and #325 (bright-harbor) overlap this PR's files. Under R56, whichever lands
    second merges main and restamps, then re-runs `expiry-lane-prose`, `ccd-reg-get-census` and the session-hook
    citation census.
  - **Next.** Scoped review run **341** is opened, and its brief is
    `ccr15-evidence-archive/review-291-fr1-brief.md`. The panel is held out, with lens 0 SAFETY at xhigh on F1. Its
    dispatch waits on the rolling daily cap; the next slot is 08:47Z. F3's twin went to quiet-river (3984), and
    amber-river was told to stay idle (3985).
  - **10:34 — run 341 dispatched to `ccrc-pwa-clear-summit`.** The cap refused it twice first, at 08:47 and 09:58,
    each time another dispatch taking the freed slot.

- **2026-10-08 04:35 — fix round 1's spec text waits on claim 1097 (asked in 3971, answered in 3975).** The round's
  code is done; its spec text is not applied. The spec is held by claim 1097: swift-cove, run 314, workspace-lifecycle
  wave 4's Task 13. That task touches the spec once, in a §5.8 replace. This round's text touches §5.5, §5.6, §5.9
  and §7 item 6, so the two are disjoint and git merges them cleanly.
  - Consent was asked of quiet-river, as run 314's coordinator, in 3973.
  - On consent, the text is applied before the wave-done. Only the tests that read the spec re-run on that
    docs-only commit.
  - Without consent, the wave-done ships the text as an artifact, which the scoped review reads. It is applied in one
    docs-only commit after the review closes, never during it, and that commit is measured before the merge.
  - **Settled the same minute (3976, relayed to amber-river in 3978).** Claim 1097 was already released, and
    quiet-river's answer was yes in any case. So the first path applies. Run 314 is at wave-done (PR #328): whichever
    of #326 and #328 lands second merges main and re-runs `expiry-lane-prose.test.ts`.

- **2026-10-08 01:42 — fix round 1 gets an addendum (mail 3962), after workspace-lifecycle's coordinator measured
  the tip (3961; answered in 3963).** The binding text is the rulings file's final section.
  - **F4 (4458) now covers three sites through one shared helper.** The helper uses `_ws_reclaim_resolve`'s sentinel
    idiom and refuses a physical path holding a newline. The sites are `_ws_leaf_remove`'s root, `_ws_path_users`'
    parent and `_ws_expire_cwd_users`' parent. Only that resolution changes in the third, which is
    workspace-lifecycle's body: its owner consented in 3961, and ruled its twin an arming blocker for the expiry lane.
  - **New number 4462 (`done-document-carries-kept-leaves`).** The tail's stdout done document gains additive
    `clipsKept` and `tmpRootKept` keys. Each holds the kept word, or `null` when nothing was kept. An older ccd omits
    both, and absence reads as unmeasured. Both server parsers read named keys only, so the keys are safe to ship
    agent-first. Readers come later: the expiry lane's from workspace-lifecycle's next wave, the reclaim side's from
    wave 7's collector. Without these keys, a leaf F1 keeps under ws-expire would reach the operator nowhere.
  - **No new refusal word.** Rule 2's rows in a leaf refuse with `containment-unproven`, the NESTED word, which the
    expiry lane's `ExpireToken` already holds as terminal.
  - **Recorded, no change.** `_ws_reclaim_owned`'s moved-tree arm fails resumable on every resume while a foreign tree
    stands in the child. It is fail-closed, and joins wave 7's carried "persistent per-child failures that retry for
    ever".
  - 4463 stays in reserve.

- **2026-10-08 01:28 — run 291 goes to fix round 1 (mail 3955). The rulings are
  `ccr15-evidence-archive/reviews/fix-round-291-1-rulings.md`, and contract §13 gains R64.**
  - **How the ruling was checked.** Before ruling, the workflow `wf_a685fa5e-319` (two Opus agents, one Sonnet, all
    read-only) checked the F1 design. It corrected the coordinator's draft, which had a breadcrumb trigger with
    "refuse on any `.git`". That draft would have held about 13% of temp roots and missed a tree moved AS the leaf, a
    recycled admin name, and the resumed arms.
  - **F1, numbers 4149 and 4455.**
    - Rule 1 is row-agnostic and lives INSIDE `_ws_leaf_remove`. A directory leaf holding a `.git` file that links
      to an admin directory outside the leaf is refused, unless that admin directory's back-link names the
      checkout. An unreadable scan answers unmeasured. A clone, or a submodule inside the leaf, passes. No git runs
      inside a leaf.
    - Step 6 keeps and records that leaf, and the act completes. Every caller, wave 7's collector included,
      inherits the rule.
    - On today's 45 temp roots it holds none.
    - Rule 2: rows at, inside or through either leaf are NESTED, compared in one registry pass.
  - **The minor findings.** F2 is 4456, F3 4457, F4 4458, F6 4459, the pins (F8, F9, F10) 4460 and F11 4461.
    - F5 and F14 fold into 4146, and F7 into 4132.
    - F12 is recorded here: the witness costs four execs, about 15 ms per spawn.
    - F13 is 4148.
  - **Numbers.** The allocator issued 4455, 4456, 4457, 4458, 4459, 4460, 4461, 4462 and 4463 for this round, after
    the wave's block ran short. 4462 and 4463 are reserve.
  - **Carried to wave 7.** The pre-breadcrumb `pin-failed` feed sentence, fixed by an additive `crumb` field. The
    collector must call `_ws_leaf_remove`, so that it inherits Rule 1.
  - **Workspace-lifecycle (3956).** Quiet-river was told:
    - X2 item 8's measurement: the window is widened in the deleted direction only, and nothing is deleted wrongly;
    - the fail-open newline twin in `_ws_expire_cwd_users`, which is theirs to fix;
    - that F1's fix reaches ws-expire through the shared helper.
  - **The run.** Run 291 is back at `working`.
- **2026-10-08 01:12 — review 335 is closed (`done`, released); wave 6 is NOT accepted as it stands.**
  - **The report.** Mail 3954, archived as `reviews/review-335-8c0f2cd9.md`. The panel and the plan's lenses ran 183
    agents with no errors: 56 findings, 17 confirmed, 39 refuted, none unexamined. After merging duplicates, that
    leaves 14 findings.
  - **F1 is a SAFETY regression.** The lens rated it critical; two refuters who reproduced it rate it important.
    - Task 9's recovery makes another workspace's tree deletable once that tree has been `mv`'d into the child's
      temp root or clips leaf. Its uncommitted file is lost.
    - Base held the same shape `unmeasured`. The reviewer reproduced both at the tip and at base, and ws-expire's
      clips path is reached too.
  - **Thirteen minor findings:**
    - F2: the walker's ESRCH;
    - F3: pre-breadcrumb `state-changed` read as resumable;
    - F4: a newline-ended root;
    - F5: the old-git resume, wider than R53 says;
    - F6: the witness left beside an absent leaf;
    - F7, F8, F9 and F10: unpinned guards;
    - F11: the `loadCold` race;
    - F12: the witness's exec count;
    - F13 and F14: two departures on neither list.
  - **What the lenses found clean.**
    - The races: 70 seeds under reclaim and 50 under expire, with 0 removals while a user lived.
    - The 9 × 6 ref-state table, and 104 gone-row rows with 0 prunes.
    - All 13 of the plan's mutation rows red.
    - SECURITY and derivation found nothing.
  - **X2 item 8.** Wave 6 widened ws-expire's window in the deleted direction only, and nothing was deleted wrongly.
  - **Suites.** Green, apart from `tmp-sweep` (red on main) and the `boot` load flake.
  - **Before ruling.** The workflow `wf_a685fa5e-319` checks the F1 fix design: the moved-tree question asked of all
    three trees, plus rows inside the leaves treated as nested. It runs one Opus feasibility agent, one Opus adversary
    and one Sonnet agent for the minor fixes. 6 of 45 live temp roots hold a scratch checkout, so "keep any leaf that
    holds a checkout" would leak about 13% of them.
- **2026-10-07 22:20 — review run 335 is dispatched to `ccrc-pwa-brisk-basin`.** The daily cap refused at 24 of 24,
  and the background retry dispatched at the 22:20 age-out. The brief is
  `ccr15-evidence-archive/review-291-brief.md`: the held-out panel, plus the plan's four lenses (SAFETY and SECURITY
  mandatory), and the a/b/c classes. Each finding is classed (a) shipped behaviour, (b) shipped prose or
  (c) record only. X2 item 8 went to quiet-river (3939).
- **2026-10-07 21:57 — wave 6's wave-done (3938) is verified; run 291 is at `awaiting-review`; the departures are
  numbered.**
  - **The claim, re-measured.** `ws/amber-river` at `8c0f2cd94` is PR #326's head, and the PR is open. The branch
    carries #290 and one merge of main (`4e4d47bea`, after #312). `git merge-tree` against main `3c33d3218` is clean.
    CI is running.
  - **The run.** `advance` moved run 291 through `working` to `awaiting-review`. Its 15 items are settled done.
  - **The suite.** `red`, failure `shallow`:
    - two static-scan breaks, both fixed on the branch;
    - `tmp-sweep` FAILS CLOSED, red on main;
    - load flakes green in isolation (`boot`, `ccrc-codex`, `ccd-spawn-split`, `session-hook`);
    - agent 465 and pwa 3446, green.
  - **Numbers.** The worker named 37 slugs. Each substantive departure has its own number: 4126 and 4127 (ruled at
    dispatch), and 4128, 4129, 4130, 4131, 4132, 4133, 4134, 4135 and 4136 (fail-closed additions). Each task's
    plan-text corrections share one number: 4137, 4138, 4139, 4140, 4141, 4142, 4143, 4144, 4145, 4146 and 4147.
    4148 and 4149 are reserve. The table is `ccr15-evidence-archive/wave6-done/deviation-numbers.md`. Each number is
    defined in the plan at the fix round.
  - **For workspace-lifecycle (X2, item 8).** `_ws_expire_locked` has no recompute-to-pin branch-state check, so
    `ws-expire` keeps that window in both directions. This goes to quiet-river.
  - **Two wave-3 defects found by wave 6's reviews** go to wave 7's pre-flight:
    - rung 8 reads git's silent omission of an unreadable gitdir or `worktrees/` as "no record";
    - the ladder's `_WS_NORMALISE_WHY` refusal detail is uncapped.
- **2026-10-07 16:47 — the operator's fleet disk cleanup reaches CCR-15 (ops notice 3890; no reply wanted).**
  - **What it did here.** It removed reclaim-row-placement-safety's review scratch and run 174's
    `swift-hollow` scratch directory. It hand-ran `ws-expire` on four archived, unmarked
    workspaces of this programme's era: `amber-summit`, `keen-hollow`, `plain-ridge` and `warm-hollow`. Their attic
    refs and tombstones are kept.
    - It also removed `expoAI-assistant-calm-mesa`'s `node_modules` and its `~/.cc-tmp` leaf, keeping the worktree.
    - Nothing of this session's was touched.
  - **`expoAI-assistant-calm-mesa`'s reclaim loop, measured.**
    - 249 attempts since 10-05 14:04, every one `pin-failed` ("refs/heads/ws/calm-mesa does not resolve — there is no
      branch tip to pin").
    - It is paced at one attempt every 15.5 min, about 190 journal rows a day. That is harmless, and it ends when wave
      6's gone-branch pin deploys.
    - **Ruling: R59 stands.** No session recreates the branch. The notice's suggestion, recreating `ws/calm-mesa` at
      `af784dbff290`, remains the operator's own option to end it sooner.
  - **Carried to wave 7's pre-flight.** A deterministic per-child failure, such as `pin-failed` on a missing branch,
    retries for ever at the sweep's pacing. Whether a persistent failure should back off further, or stop journaling
    each repeat, is a question for that pre-flight.
  - **The `rescue/B9-*` branches** in the home repo are kept. They are additive and cost nothing.
- **2026-10-07 16:18 — stall-watch-settings W1 merged (#320, `7f7bf4afc`). Its wave 2 (run 322) is granted
  comment and residue edits to W1's own lines inside claim 1070 (mail 3871, on 3815's terms).**
  - **The lines granted.** `shared/api.ts` :9251, inside W1's appended block. In `watch.ts`: `StallResolution`,
    `sweepStalls`' outer catch comment, and `stallResolveNow`'s docstring and returns.
  - **Measured on run 291's tip `9bdcb0d2a`, which now carries Task 12.** Its `watch.ts` and `shared/api.ts` hunks
    are nowhere near those lines. `git merge-tree` against main `7f7bf4afc` is clean.
- **2026-10-07 14:53 — no objection to W1's `judgeStall` edit in `watch.ts` (mail 3858).** It was left out of 3830's
  list: `judgeStall`'s signature and its `StallInput` literal, between `sweepStalls` and `sweepMail`. Re-measured:
  `git merge-tree` of `ws/swift-meadow` (`ccd3eced1`, PR #320) against run 291's tip `a1e62db41` is clean, and wave 6
  had not yet edited `watch.ts`. It is none of Task 12's sites.
- **2026-10-07 11:33 — stall-watch-settings W1 may also co-edit `server/src/watch.ts` inside claim 1070, in exactly its
  listed regions (mail 3830, granted on 3815's terms).**
  - **W1's regions:** its own imports, the stall constants, the fields after `stallWarned`, and the bodies of
    `sweepStalls` and `sweepMail`.
  - **Measured:** wave 6 had not edited `watch.ts` at `899e4f12a`. Its Task 12 sites are the `childReclaim.js` import,
    the accessor after `currentChildMarks()`, `tick()`'s `childMarks` lines and `emitCoord`. The nearest pair is two
    import lines about 18 lines apart.
  - amber-river was told to keep Task 12 to its planned sites.
- **2026-10-07 10:03 — stall-watch-settings W1 (run 295) may co-edit `shared/api.ts` inside claim 1070 by appending at
  its end (mail 3813, granted).**
  - **The grant.** W1 appends one block at the very end and changes no line above it. Claim 1070 stands, and wave 6
    changes nothing. The second lander resolves structural adjacency only, and a same-sentence collision comes back
    to both coordinators.
  - **Measured on run 291's tip `e5effb842`.** Wave 6's `shared/api.ts` edits are all interior (`CoordStatus`,
    `LcRefusalToken` and `LC_REFUSAL_WORD`, `LifecycleMeas`), so an end-append shifts none of them or README's anchors.
  - **Not granted.** `server/src/watch.ts` is not in the grant. W1 asks again at its Task 5.
  - amber-river was told.
- **2026-10-07 08:55 — wave 6 progress (mail 3801; confirmed in 3802).**
  - **Done so far.** Tasks 0 to 6 are committed on `ws/amber-river`, each past its task review. Task 6 reproduced the
    swift-hollow race red, then closed it.
  - **Main absorbed once.** #312 (workspace-lifecycle 3b) landed first, so the worker merged main (`4e4d47bea`). The
    stamp was restamped, `_ws_expire_cwd_users` keeps 3b's body under wave 6's header, the README anchors are
    re-pointed, and the R56 checks are green.
  - **Two calls confirmed:**
    - guards the plan's mutation tables missed are pinned, by the brief's SAFETY rule;
    - `leaf-mount-point-refused` (Task 5 refuses a leaf that is itself a mount point, because
      `rm --one-file-system` measures from its argument) is accepted in principle and numbered at wave-done.
  - **Claims.** 1057 and 1058 lapsed at the 8 h cap, and were re-taken as 1070 and 1071.
- **2026-10-07 05:02 — workspace-lifecycle's PR #312 (wave 3b, run 290) edits two passages of our spec (mail 3796,
  answered in 3797).**
  - **The two passages.** §5.8: `reclaim-paused` now also stops the expiry of archived workspaces, making it the
    fleet's one cleanup switch. The wave-3 qualification near §6: `ws-restore` also refuses an unreadable `expire:`
    breadcrumb. Both are true for our programme, and neither conflicts with wave 6's planned spec text. Task 13's
    §7 sentence sits beside the :807 line, so it is a text merge.
  - **Measured against run 291's local tip `4abb87010`** (not pushed). `git merge-tree` finds two textual conflicts:
    `ccd/ccd`'s generated stamp line, and README's `shared/api.ts:` anchors in the purge-refusal sentence. Both are
    the second lander's R56 work: a re-stamp, and re-pointing by content. `_ws_expire_cwd_users` auto-merges.
  - **Arming.** 3b's expiry lane ships shadowed, until `$REG/expire-lane-live` exists.
- **2026-10-06 20:21 — delegation-broker's overlap is closed (mail 3755).** Its wave 1 (#284) landed second, as
  `22b4eabda`, after #290. `git merge-tree` against `b27fabc15` was clean. Its coordinator ran
  `session-hook.test.ts` (335/335), `typecheck-tests` and the hook suites on that exact merged tree. Nothing is owed
  between the two programmes.
- **2026-10-06 20:18 — workspace-lifecycle answers 3657/3666 (mail 3749; the delay was its mail gate).**
  - **Measured from wave 3b's plan** (`docs/workspace-lifecycle-wave3b-plan` @`335c0e7c`):
    - 3b edits none of `_ws_reclaim_tail`, `_ws_reclaim_contained`, `_ws_reclaim_ladder`,
      `_ws_reclaim_workdir_shared`, `_ws_reclaim_owned` or the platform block.
    - In ccd it touches the EXPIRE region, the MIRROR block, the return verbs' gate lines, `_ws_reap_locked`'s first
      line, ws-gc's advisory arms and the `_reg_get` census sentence.
  - **The one shared function** is `_ws_expire_cwd_users`. Wave 6 corrects its header comment, and 3b rewrites its
    body. The second lander keeps both.
  - **Every X2 item is agreed** under 3622, including expire breadcrumbs never being placement evidence.
  - **Order:** 3b dispatches after its plan PR merges, re-verified on `b27fabc15`. Neither wave waits.
  - The worker was told (status mail).
- **2026-10-06 19:49 — run 302's overlap is settled (mail 3745 from `ccrc-pwa-quiet-ridge`).**
  - R56 is agreed.
  - Run 302 does not edit `ccd/ccrc`'s platform block; it only calls `_plat_timeout`. Its README edits sit after
    `## License` and in the floor and SAFETY prose.
  - The claimant consents to wave 6's two edits inside claim 1055.
  - So no sequencing is needed, and the worker was told in a status mail.
- **2026-10-06 19:12 — the first live reclaims on wave 5, observed read-only. Both children are gone; one took two
  passes.**
  - **`ccrc-pwa-quiet-meadow`** (run 260's child, a recycled slug) was reclaimed in one pass: intent 19:05:50, done
    19:06:07.
  - **`ccrc-pwa-brisk-meadow`** (archived by hand on 09-28; the one child R40 moves) was reclaimed on the second pass.
    - **The first attempt failed closed.** It started at 19:05:51 and stopped at 19:06:05 on
      `worktree-remove-failed`, with the breadcrumb at `reclaim:children` and the session unsupervised. The reason:
      "registry row(s) ccrc-pwa-quiet-meadow name a workdir that cannot be resolved completely". The two reclaims ran
      concurrently. ccd had already removed quiet-meadow's tree, but its row and breadcrumb stood until its purge,
      two seconds later. So brisk-meadow's check of the other rows was unmeasured, and it stopped before deleting
      anything further.
    - **The resume succeeded.** It ran at 19:11:18 and finished at 19:11:26 (`purge done`, `reclaim done`). The
      worktree and the breadcrumb are gone.
  - **What this shows.**
    - The fail-closed arm and the breadcrumb resume work live.
    - The state the race exposed is exactly what wave 6's Task 9 breadcrumb arm (R54) places. That is a row whose
      tree ccd's own `git worktree remove` took, with a `branch`, `artifacts` or `clips` phase beside its tombstone.
      So after wave 6 this race passes in one pass instead of two, and no instruction to the worker is needed.
  - **R59's first live-residue item is resolved.** `brisk-meadow` moved when wave 5 deployed, as R59 said it would.
- **2026-10-06 19:05 — wave 5 is LIVE (v0.0.105), and run 260 is closed.**
  - **The deploy, observed read-only.** The updater dispatched the fleet box at 19:01:42 and the server box at
    19:04:14. `ccrc rollout --to v0.0.105 --check` then read both `[current]` at `b27fabc1`. Nothing was rolled out by
    hand.
  - **The close.** First the merge was proven: `gh pr view 290` reads MERGED, with its head at `9aa20cb2b`, equal to
    the `handoffCommit`. Then `runs close 260` with `final:true` answered `done`, `released:true`,
    `childReclaim:"queued"`. Run 291 keeps the programme open.
  - **Children to watch, read-only.**
    - `ccrc-pwa-quiet-meadow`, the slug recycled from 10-05, whose earlier reclaim finished: its reclaim is queued
      behind the sweep's presence lease.
    - `ccrc-pwa-brisk-meadow` is the one child R40 moves. It had no reclaim event at 19:05.
    - If either stays kept past the bound, it is reported, not acted on (R59).
- **2026-10-06 18:51 — #290 merged (`b27fabc15`); wave 6 dispatched (run 291 → `ccrc-pwa-amber-river`).**
  - **The merge.** `gh pr merge 290 --squash --admin --match-head-commit 9aa20cb2b…` at 18:50. Every required check
    was green after re-running the failed jobs: `ccrc-sweep-window` W21 passed, so it was a flake. Only macOS 2/2 was
    still running, and it is advisory.
  - **The deploy.** Through the updater only, observed read-only. v0.0.105 is building, and the fleet box is on
    v0.0.104 until it moves. Run 260 closes once the server box converges.
  - **Wave 6's dispatch.**
    - Brief: `ccr15-evidence-archive/wave6-brief.md`, with planSha `26e3318b` and 15 items (Tasks 0 to 14).
    - Route: opus · xhigh, subagent sonnet, workflows on, compact 40.
    - The brief also carries review 303's Task 13 additions (G1, G4) and the overlaps as re-read: run 302's claim 1055
      on `ccd/ccrc` and `README.md`; workspace-lifecycle wave 3b (run 290) and stall-watch-settings W1 (run 295), both
      planned. R56 governs all three.
  - **The conditions this dispatch waived.** quiet-river never answered 3657/3666: both are still queued behind its
    `not-idle` gate. Waiting on them gains nothing, because its wave 3b is planned and R56 already binds both sides.
    The X2 list reaches it durably once its gate opens.
- **2026-10-06 18:40 — R47's pre-landing line for the operator (`r40-pre-landing-class-list`), measured read-only on
  the fleet box before #290 lands.**
  - **What R40 moves.** Of the 29 marked children, `ccrc-pwa-brisk-meadow` is the only one any run names
    `claimedBy`. Its eight runs (10, 12, 14, 16, 18, 19, 28 and 30) are all `done`, the last closed 2026-09-04 14:53.
    Its current birth is 2026-09-26 09:09 (run 171's dispatch). So it **would move**, and it is the only one. No other
    child needs telling. Not listed: the API cannot read displacement rows.
  - **The widening.** Once the server box converges, R39 and R40 widen what reaches the destructive path, with no
    capability gate.
  - **F6's residual, as measured.** None of git's 15 local environment variables (`git rev-parse --local-env-vars`)
    appears by name in the user manager's environment, in any `ccrc*` unit, or in the running agent's environment.
  - **The operator's stop.** `reclaim-pause`, on the Runs screen.
  - **The PR body.** It names `ccrc-pwa-brisk-meadow` and `reclaim-pause` and asks for no hand rollout.
- **2026-10-06 18:40 — review 303 closed (`done`, released); wave 5 is accepted at `9aa20cb2b` with no fix round.**
  - **The report.** 3734, archived as `reviews/review-303-9aa20cb2.md`. The panel ran 28 agents, and none died. It
    found 4 confirmed findings, all record-only, with no shipped-behaviour defect and no broken shipped prose.
  - **SAFETY.**
    - F4's cross-run window is closed: the reviewer's own probe is red on `e79b1da7` and under both mutations, and
      green at the tip.
    - F1's gate and F2's run key change no decision (R41 holds).
    - F11 makes no child eligible.
  - **The rulings** (`reviews/review-303-rulings.md`):
    - G1 (the docstring's "PLACES") and G4 (spec §5.7's "Each is kept") go to wave 6's Task 13, as additions in its
      brief.
    - G2: the record's true count is 18. The widening mutation reds 18, not 24, because the six terminal-refusal cases
      answer before `marked`. The plan is not edited.
    - G3 is ruled as contract §13 R62.
    - X1 (a queued licensed request reaching the same run's re-minted workspace; SAFETY class) and X3 (the
      hold-retired memory keyed by id) are pre-existing since wave 4. They go to wave 7's pre-flight as R63.
  - **CI on #290.** Server shard 1/5 failed on `ccrc-sweep-window` W21, a centralised-update test that came in with
    the merge of main. The failed jobs are re-running. #290 lands only on a green `test (server)`.
  - **Overlap.** Run 302 (ccrc-history wave 2) claims `ccd/ccrc` and `README.md`, both of which wave 6 edits. The R56
    rule is proposed to `ccrc-pwa-quiet-ridge` (3736, corrected in 3737).
  - **quiet-river.** It has been `not-idle` since 08:35, with 3657, 3666 and five other mails still queued. Its
    wave 3b (run 290) is still `planned`, so R56 alone governs that overlap.
- **2026-10-06 17:16 — run 260's fix round 1 is verified; scoped review run 303 is opened (wave-done 3728).**
  - **The claim.** `ws/quiet-meadow` at `9aa20cb2b` is PR #290's head, and the PR is open. It contains the merge
    `19441194b` of `77c11245a`, and `git merge-tree` against today's main (`4db20aa17`) is clean.
  - **The run.** `advance` moved run 260 to `awaiting-review`, and all 19 items read done.
  - **Numbers.** 3926, 3927, 3928, 3929, 3930, 3931, 3932, 3933, 3934, 3935, 3936, 3937, 3938, 3939, 3940, 3941, 3942,
    3943 and 3944 are defined in the plan. 3945 is unused.
  - **The suite.** `red`, with no real break: load reds that are green alone, plus three files red on a clean
    origin/main.
  - **Review run 303.** Its brief is `ccr15-evidence-archive/review-260fr1-brief.md`. It covers F1, F2/F18, F4 (with
    the SAFETY lens, Opus xhigh) and F11/F12, then the merge's `--remerge-diff`, then the rest of the round's diff.
    Each finding is classed as shipped behaviour, shipped prose or record only.
  - **Dispatch.** The rolling daily cap refused at 24 of 24. The background retry dispatched it at 17:32:11, once
    the oldest dispatch aged out, to `ccrc-pwa-brisk-delta` (the skill is present).
- **2026-10-06 12:39 — `kept-word-ends-on-late-birth` is a stated residual, number 3944 (mail 3695, ruled in 3696).**
  - **The finding.** quiet-meadow found it during fix round 1 while making F11 true. A recycled slug's new `create`
    may not be placed yet. If its minting run is already past `minting-run-open`, a pass judges the new marker against
    the older birth (`childReclaimBornAt` reads `create` events only). It can then answer
    `minting-run-postdates-child`, a kept word, for a child that turns eligible seconds later.
  - **What it affects.** Display only, and the eventual reclaim is correct.
  - **Ruling: option A.** Number 3944 is defined in the wave-5 plan, and no code or ruled sentence changes.
    - B is rejected: it would weaken a promise that is true everywhere else.
    - C as worded is rejected: comparing the birth with the run's dispatch would fold every true postdating run into
      doubt.
  - **What carries forward.** The closure goes to wave 7's pre-flight: the last placed create counts as unplaced
      when a placed removal follows it.
  - **The contract.** Contract §13 is appended. R60 moves `child-birth-unplaced` to doubt, amending R41's table
    (F11, number 3941). R61 records the residual. 3945 stays in reserve.
- **2026-10-06 12:31 — a macOS red is ours, intermittent, and carried to wave 7's pre-flight (mail 3691, answered in 3692).**
  - **The red.** In full CI run 37456924516 (PR #295, not ours), test-macos 2/4 (job 112246816971) failed wave 4's
    case "reclaims through a SYMBOLIC ref and a stale empty `.lock`". The reclaim completed, but the purge answered
    `purge-refused` because `.demo-quiet-basin.compactions.lock` was unavailable. COMPACT_LOCK_WHY was empty, so this
    was contention: a `flock -w 5` timeout, or a failed alias `link` or open.
  - **It is intermittent.** The same case passed on test-macos in the last three daily full runs on main: jobs
    112094297477, 111606033808 and 111362458510.
  - **Ruling.** No gate (the macOS ruling). Wave 6's plan does not touch the purge lock. The cause is carried to
    wave 7's pre-flight as a residual, unmeasured. If the stable gate needs it green first, the answer is a full
    re-run.
- **2026-10-06 11:42 — stall-watch-settings W1 (run 295, `ccrc-pwa-calm-harbor`) is sequenced after run 260 (mail 3674).**
  - **Their wave.** Run 295 waits for run 260 to release its claims on `shared/api.ts`, `coord/store.ts`, `watch.ts`
    and `coord/routes.ts`.
  - **The overlap with wave 6.** Wave 6 (run 291) also touches `shared/api.ts` (additive tokens, meas keys and one
    optional `CoordStatus` field) and `watch.ts` (a small change). It leaves `store.ts` and `routes.ts` alone.
  - **The proposed rule (mail 3675), the same as 3622.**
    - Both proceed once run 260 releases its claims, and neither waits on the other.
    - Edits stay additive.
    - The second lander merges main, then re-runs `single-definition`, `typecheck-tests`, the citation cases and
      `deviation-refs`.
- **2026-10-06 10:50 — #293 merged (`26e3318b`); wave 6's brief is ready; dispatch waits for #290 and quiet-river.**
  - **The PR.** The required checks passed on `372e663b`: server 4/4, agent, pwa, build, typecheck. macOS is
    advisory. The squash merge is `26e3318b`, and the plan, the contract and this ledger on main equal the tested
    tree.
  - **planSha** is `26e3318b3ee3f66cd21a875b58946aab2d205208`. The brief, about 4 KB, is in the evidence archive as
    `wave6-brief.md`.
  - **quiet-river** got the full X2 list in status mail 3666. Mail 3657's question stays open: does WL 3b edit the
    tail, the containment, the ladder or the platform block?
  - **Dispatch** follows #290's merge, the answer to that question, and a fresh claims read.
- **2026-10-06 10:40 — wave 6's plan is written, attack-reviewed and corrected. Contract §12 is appended. The docs PR
  is next.**
  - **Drafting.**
    - Seven Opus drafters (`wf_0103bba8-870`) wrote Tasks 1 to 12, against `77c11245` and #290.
    - The coordinator ruled on their 64 open items (`wave6-preflight/drafts-rulings.md`).
      - X1: dispatch only after #290 merges, so there is no mid-wave merge.
      - The witness's staleness test includes `run`.
      - The old-git positive fallback.
      - A new `failed` token, `branch-unmeasured`, at step 5.
      - A clips leaf the helper refuses is kept and recorded.
    - Appliers turned the rulings into exact edits, and a frame writer wrote the header and Tasks 0, 13 and 14
      (`wf_61563232-198`).
    - 80 contract citations inside code blocks were mapped to spec sections, as R23 requires.
  - **The attack** (`wf_40cb2b7a-1f5`): four Opus lenses, safety-removal and safety-placement at `xhigh`, plus security
    and executability, with two Sonnet refuters per serious finding. The important findings that stood, and their
    fixes (`attack-rulings.md`):
    - **S2-2.** A symbolic registry branch read `present`, and the step-5 CAS would have deleted the branch it names,
      possibly main. Wave 3's code already has this. Now such a branch reads `unmeasured`, and every branch delete is
      `update-ref -d --no-deref`.
    - **S2-1.** The breadcrumb arm could place a moved tree. It now places a row only while git keeps no record of the
      tree.
    - **S1-02.** The in-use probe's single snapshot missed a fork-then-exit chain (40 of 40 in scratch). The walk is
      now a fixed point.
    - **S1-03.** An exited thread-group leader is now read through its threads. A thread that is already exiting
      counts as vanishing, measured.
    - **S1-04.** Link and file leaves skip the probe and are unlinked as in wave 3.
    - **S1-01.** A `stat` call outside the platform block is replaced by `ls -dn`.
    - **S1-05 and S2-3.** Two scan and grep defects are fixed: one check's scope, and `grep -F`.
    - **SEC-3.** The harness-strip scan is broadened.
    - **The executability findings.**
      - Task 0's h5 now counts 4.
      - `ALL_TOKENS` keeps `branch-unmeasured`.
      - Task 8 pays the R43 status list.
      - Task 12 pays S6-R11.
      - The bare `reclaim*` identifiers are renamed `childReclaim*`.
    - Every minor finding is accepted as a text or test fix, and Task 13 states each residual in spec §7.
    - 189 edits were applied with uniqueness checks. The coordinator fixed one more: an old-git shim pattern that
      never matched `--exists`.
  - **The plan** is at `docs/superpowers/plans/2026-10-06-child-reclamation-wave6-reclaim-repairs.md`, about 9200
    lines.
  - **Contract §12 (R48–R59)** is appended, with R49, R53 and R54 carrying the attack's fixes.
  - **The waves table** now has rows 6, 7 and 8, and the next-wave brief is rewritten.
  - **The docs PR** carries the plan, contract §12 and this ledger. It merges before dispatch, and dispatch waits for
    #290.
- **2026-10-06 09:15 — review run 285 (wave 5, `e79b1da7`): no safety defect; fix round 1 sent.**
  - **The review.** Report 3658, at `~/.cc-clips/ccrc-pwa-clear-harbor/review-285-e79b1da7.md`, archived.
    - The panel ran 149 agents: 36 confirmed, 10 refuted, 0 unexamined, and no lens unverified. The 36 merge to
      31 findings, 2 important and 29 minor.
    - **SAFETY.**
      - The R39 probe ran 15 759 times, through the model and the real watcher. It found 0 broken chains and 0
        early second licences, and every bound held.
      - Every A5 mutation reds.
      - R40 has one fence, one read and one placement.
      - F6's names are absent on the fleet box.
      - Live, only `brisk-meadow` would move.
    - **Suites.** Every red was load (`boot`, `update-store-nodes`, `archive-all-guard`), apart from `tmp-sweep`'s
      FAILS CLOSED case, which is red on main.
  - **Review run 285** advanced to `working` and closed `done`, released (`review-report-live`).
  - **Rulings** (in the archive, `reviews/fix-round-260-1-rulings.md`):
    - F1 (important) is fixed as 3938, `chip-arms-gated-on-standing-child`. Step 4's failure, paused-token and
      retry arms answer only for a child that still stands as this run's. A-S3-4's binding text was wrong.
    - F2 and F18 (important) are fixed as 3939, `kept-verdicts-keyed-by-run`. Kept verdicts and the kept-feed memory
      carry the marker's run id.
    - F4 (SAFETY) is fixed as 3940, `generation-reset-keys-marker-run`, and residual 10's wording is corrected.
    - F11 and F12 are fixed as 3941, `birth-unplaced-is-doubt`. R40 already calls an unplaceable birth doubt.
    - F7 is fixed as 3942: the abandon sentence lists the temp root and the registry row.
    - F3, F8, F16, F17 and F27 are fixed as 3943, `prescribed-prose-corrected`.
    - F5, F6, F9, F10, F13, F14, F15, F19, F20, F21, F24, F25, F26 and F31 are fixed.
    - F22, F23 and F28 are accepted. F29 and F30 go in the next wave-done.
    - 3944 and 3945 stay in reserve.
  - **Run 260** was sent back to `working`, with fix-round mail 3660.
    - Step 0 merges main (`77c11245`); README conflicts, and this branch is the second lander.
    - A scoped review follows, and only a shipped-behaviour defect sends the wave back again.
- **2026-10-06 08:49 — wave 6's pre-flight done. Rulings R48–R59 are drafted as contract §12; the plan is
  drafting.**
  - **The pre-flight.** Six read-only Opus scouts (workflow `wf_9703ecf7-bc3`) read `77c11245`, #290 and the live box.
    The evidence is in `.superpowers/sdd/ccr15-evidence-archive/wave6-preflight/`.
  - **R38's first measurement.** Wave 3's tail removed `~/.cc-tmp/ccrc-pwa-swift-hollow` while the killed pane's
    processes still ran with `TMPDIR` set to it. One of them recreated it 3.7 s after `reclaim done`, at
    22:12:10.735 on 2026-10-04; the pane's scope ended 2 ms later. The tail asks only whether tmux still has the
    session. The leaf's 2026-10-05 birth time comes from the operator's rsync onto the new disk.
  - **The live population.**
    - 26 child leaves, about 27 GiB, every one marked and rowed;
    - one orphan leaf (swift-hollow, empty);
    - 18 foreign directories and 105 loose files, about 6.66 GiB.
  - **The rulings, in summary** (contract §12 lands with the plan in the docs PR):
    - **R48:** R38's wave 6 becomes three waves.
      - Wave 6 (run 291) repairs `ws-reclaim` and lays the collector's groundwork.
      - Wave 7 adds the collector verb, inert and AGENT-FIRST.
      - Wave 8 adds its server lane, after WL 3b and after the fleet advertises wave 7's token.
      The reason is one destructive subject per SAFETY panel, given an unsplit 8k to 12k insertions.
    - **R49:** ONE removal helper with a three-way answer. Its in-use probe reads `TMPDIR` in environ, cwd and fds.
      The tail waits at most 15 s after the kill, keeps a temp root that is still in use, and runs its destructive
      git calls contained.
    - **R50:** the positive witness `$REG/tmproots/<id>`, written by `_child_tmpdir`'s rc-0 arm. It binds
      `dev`/`ino`/`btime` and dies only after the leaf is proven absent.
    - **R51:** F6 unsets `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG` and `GIT_CONFIG_COUNT` above the count, and the
      harness strip goes in a new `gitEnvStrip.ts`.
    - **R52:** `probe-unmeasured` is journaled `failed`, an R5′ exception. The pre-lock dies tied to an id are
      journaled `refused` and classified.
    - **R53:** `git show-ref --exists` three-way at every arm, with an explicit `branch=absent` in the token.
    - **R54:** a `recorded` placement basis, with a git-record arm, a breadcrumb arm and the moved-tree check.
    - **R55:** the vanish re-read gets a second trigger, the mirror's newest reclaim-`done` `at` carried on the
      `coord` frame.
    - **R56:** #290 lands first, then the overlap rule and the citation tax.
    - **R57 and R58:** the outlines of waves 7 and 8.
    - **R59:** the live residue stays the operator's.
  - **Overlap.** The proposal went to `ccrc-pwa-quiet-river` (mail 3657): the shared tail and containment, a new
    probe, `_child_tmpdir`, and a new strip file beside run 274's `ccdWsHelpers.ts`.
  - **The plan.** Seven Opus drafters, one per task group (workflow `wf_0103bba8-870`). After them come an attack
    review, a docs PR (plan, contract §12, spec §5.5 step 3 and §8), and dispatch after #290 merges.
- **2026-10-06 08:31 — wave 6's run opened (run 291, `planned`) before run 260 closes; its block allocated.**
  - Run 291 is opened as wave 6 of 6 under the programme's own title. Run 260 keeps `waveOf` 5 (R38).
  - **Block:** 24 numbers, written singly: 4126, 4127, 4128, 4129, 4130, 4131, 4132, 4133, 4134, 4135, 4136, 4137,
    4138, 4139, 4140, 4141, 4142, 4143, 4144, 4145, 4146, 4147, 4148, 4149. Floor 4150.
  - **Next:** wave 6's pre-flight against `77c11245`. It begins with R38's first measurement, why
    `~/.cc-tmp/ccrc-pwa-swift-hollow` reappeared after wave 3's tail removed it. Then come the coordinator's rulings
    on the detail, as contract §12; the plan; an attack review; a docs PR; and the dispatch.
- **2026-10-06 08:30 — #286 merged (WL wave 3, `77c11245`, 08:28); wave 6 is clear to dispatch; #290's CI is green.**
  - **WL's notice (mail 3655).**
    - The CCR-15 spec now carries the one agreed hunk in the "Not changed, deliberately" passage (about :778 to
      :785).
    - WL's review 288 (F4) adds one more qualification there: ws-restore also refuses `in-progress` on a `.reaping`
      breadcrumb that cannot be read. WL carries that to its wave 3b's first commit, and quiet-river says before 3b
      pushes it.
    - `ccd/ccd` changed on main in the RECLAIM/EXPIRE region, and `_WS_RCL_ACT`'s flavour extraction is
      byte-identical for reclaim. So wave 6 merges main and re-stamps.
  - **#290 is now the second lander.**
    - Its required checks all pass on `e79b1da7` (CI 37419380049, `test (server)` included).
    - `git merge-tree` against main `77c11245` conflicts in `README.md` only. `shared/api.ts` and the spec merge
      cleanly.
    - The review's fix round merges main (never rebases), resolves README, and runs the second-lander checks agreed
      in 3622 and 3623.
    - Review 285 is still reading the pre-merge tip, and the worker holds pushes until it reports.
  - **Wave 6** now gets its plan and pre-flight against `77c11245`, and its run opens before run 260 closes.
- **2026-10-06 05:48 — workspace-lifecycle amends one CCR-15 text (mail 3632; answered in 3633).**
  - **The finding.** WL's review 284 found that #286 falsifies the spec's "Not changed, deliberately" sentence
    (about :780). #286 ships ws-reap's `expire-in-progress` refusal and a spawn-path refusal that covers ws-restore.
  - **WL's fix (their D-3965).** bright-canyon names the two refusals there, points at WL's §5.3, and makes the
    same edit in the contract if it carries the claim.
  - **No contention.** #290 edits the spec only at §1 (about :39) and §5.5 step 2 (about :371 to :395), and leaves
    the contract alone. The hunks are disjoint, so the second lander merges main and keeps both, the rule agreed in
    3622.
- **2026-10-06 05:41 — wave 5's wave-done re-measured (mail 3627, PR #290 at `e79b1da7`); numbers assigned; review
  run 285 opened.**
  - **The claim holds.**
    - PR #290 is open, not a draft and mergeable, and its head is `e79b1da7`, which is also the worker's ref.
    - Its merge base with main is `d12b5aba` (one merge of main, `66d4354c`, never rebased), and `git merge-tree`
      against today's main (`21f536a5`) is clean.
    - 29 commits, all under the noreply identity; 48 files, +6957/−785.
    - Nothing under `ccd/`, `agent/` or `deploy/` changed (A1).
  - **Run 260** advanced to `working` and then to `awaiting-review` (`ok`), and its 19 items are settled at 19/19.
  - **The suite claim.**
    - The worker reports `suite: red` / `failure: unclear`. The reds are `tmp-sweep` (red on a main archive too) and
      four load timeouts (`boot`, `ccrc-codex`, `update-store-nodes`, pwa `contrast`), each green in isolation.
    - Agent 453/453, pwa 3303/3304, session-hook 335/335; the wave surface is 24 server and 15 pwa files, all green.
    - Mail 3623's checks ran against `21f536a5`: deviation-refs 31/31, citation cases 7/7.
    - CI run 37419380049: typecheck, build-pwa, select, agent and pwa pass; the five server shards are pending at
      05:41.
  - **D tokens the branch adds:**
    - D-282 and D-3365, as A6 prescribes;
    - one citation of D-2545, a number already defined, in a new `routes.ts` comment. Task 5's code prescribes that
      comment (plan:1990), and A6's "only D-282 and D-3365" missed it. The citation is accepted and mints nothing.
  - **Numbers assigned** to the twelve substantive departures, each to be defined in the plan's `## Deviations found`
    with the review's fix round:
    - 3926 `no-session-copy-scoped-to-run` (Task 9b; ruled in 3613);
    - 3927 `one-reader-pin-code-only` (Task 8);
    - 3928 `chip-census-tokens-widened` (Task 8, from the final PWA lens);
    - 3929 `verdict-reader-allowlist-pin`, a census beyond the plan (`child-reclaim-verdict-readers.test.ts`);
    - 3930 `fence-canonical-stamp`, a SAFETY item (`1185c609e`): a non-canonical stamp keeps the child;
    - 3931 `prose4-stamp-sentence-corrected` (A0b's prose 4);
    - 3932 `spec-wip-parents-reworded` (A[S4-2], spec §5.5 step 2);
    - 3933 `wall-step-rows-mint-early` (Task 0b's harness);
    - 3934 `open-arm-mutation-fails-shut-at-runtime` (Task 0c's mutation table);
    - 3935 `0b-mutation-table-corrected`;
    - 3936 `a-s3-14-literals-beyond-the-list` (Task 4d);
    - 3937 `prescribed-citations-dropped` (Tasks 2, 6, 0c and 3).
  - **Reserve.** 3938, 3939, 3940, 3941, 3942, 3943, 3944 and 3945 stay unassigned for the review's fix round. The
    thirty editorial and test-shape slugs get no number.
  - **Observations.** Both are recorded and get no number:
    - while the listing is unavailable, a `paused` chip shows the underlying pending or deferred word;
    - a kept verdict carried across a pause is keyed by id.
    A-S3-6's docstring "each ends only by a person's act" is false for `child-birth-unplaced`, and it is left as
    display-only.
  - **Review run 285 dispatched to `ccrc-pwa-clear-harbor`** (05:44) with:
    - the panel;
    - A5's four lenses, SAFETY at Opus `xhigh` with its own seeded probe (seeds 1 to 300, N 3 to 6, eleven modes,
      one N through the real watcher) and the R47 check of the units' environment;
    - the full server suite in twelve shards.
    The first dispatch was refused, and nothing was touched: ccd refused `subagent: opus`, because the roster's
    `CCRC_SUBAGENT_CLASSES` is `haiku sonnet`. The route sent was `{opus, xhigh, sonnet, workflow on, compact 40}`.
    The brief is at `.superpowers/sdd/ccr15-evidence-archive/review-285-brief.md`. Worker status mail 3629 says
    to hold pushes and gives the numbers.
- **2026-10-06 04:51 — `ccrc-pwa-quiet-river` agreed to the overlap rule (mail 3622, replying to 3560).**
  - Rules 1–4 stand as written.
  - **Added to rule 2.** `shared/api.ts` is a cited file, because the README anchors and the S6-R11 census read its
    line numbers. So the second lander also re-runs, after `git fetch origin main`:
    - `session-hook.test.ts`'s citation cases, which the full run already covers;
    - `deviation-refs.test.ts`.
  - Forwarded to the worker as status mail 3623.
  - **Timing.** Run 245 (WL wave 3) sent its wave-done, PR #286 at `3373287e`, and its acceptance review is
    dispatching. Wave 6 plans against #286 as it lands.
  - **For wave 6.** WL wave 3 carries a return-verb journal race and an in-use probe gap to WL 3b, both in ccd's
    EXPIRE region and the spawn gate. quiet-river will say if 3b's plan touches the reclaim tail.
- **2026-10-06 01:36 — finding 3612 (Task 9b) ruled A: the no-session abandon sentence is scoped to the run.**
  - **The finding.** A[S4-1] prescribed "It holds no workspace, so nothing is released or reclaimed." That is false
    in one reachable case. Wave N+1's run is opened unbound, wave N's close holds its child for wave N+1, and the
    operator then abandons that unbound run. The programme retires, the sweep answers `hold-retired`, and wave N's
    child is released and then reclaimed.
  - **The ruling (answer mail 3613).**
    - The sentence becomes "Abandon run ${run.id}? It holds no workspace of its own, so it has none to release or
      reclaim." The worker's "so none is released or reclaimed" still read as "no workspace is".
    - AB4's constant changes with it, with a mutation row on "of its own".
    - It is a departure, slug `no-session-copy-scoped-to-run`, numbered from the block at wave-done.
    - B, copy naming the programme-retire effect, is not built. That effect is rule 1 working, the work is pinned
      first, leaving it out states nothing false, and B would need the PWA to judge "last open run" with copy nobody
      has reviewed. The wave-done mentions the omission. It is not carried.
- **2026-10-06 00:48 — finding 3608 (Task 7) ruled D: a named residual, carried to wave 6.**
  - **The finding.** Task 7 is built as the plan prescribes and passed its per-task review. ccd purges the
    registry row a few milliseconds before it journals `done reclaim`, and the journal mirror runs on its own
    5 s clock (`LC_SWEEP_MS`), which the 2 s tick never awaits. So the vanish re-read usually lands before the
    mirror holds `done`. R21 then falls through to the row rule, the row is absent, and the chip reads null. The
    row also stays openable until the next mount. The reviewer estimates this at about 80%; nobody has measured
    it. Before Task 7, the same row showed a stale `pending` until the next mount.
  - **The ruling (answer mail 3609), D.**
    - Build none of A, B or C:
      - A, awaiting the mirror for a vanished marked child before the fleet frame: it changes the order of the
        2 s tick, the pre-flight never reviewed it, and it lies in WL 3b's lane.
      - B, an "under way" word for an absent row behind an `intent`: it amends R21, and it would stick forever
        when ccd dies between `_reg_purge` and `_lc_done`.
      - C, follow-up re-reads on later frames: a retry cadence the no-polling rule never covered.
    - The effect is staleness until the next mount, the class the plan already accepts for pending → refused.
    - The worker names `vanish-reread-races-mirror` in the wave-done and in one sentence of the PR body. It gets
      no D number, because it is not a departure.
- **2026-10-05 18:47 — #282 merged, and wave 5 dispatched as run 260 to `ccrc-pwa-quiet-meadow`.**
  - **The docs PR.** The required checks passed on `e453ef1b`. Main had moved by #240, #280, #281 and #250, none of
    which touches these files, and the merge was clean. #282 merged as `6f6923cd`, and the four docs files on main
    equal the tested tree.
  - **The brief.**
    - It names `homeRepoRoot`, `planRepoPath` and planSha `6f6923cd`.
    - It names the execution skill `superpowers:subagent-driven-development`.
    - It fixes the task order: 0b, 0c, 1 to 9 with 2b, 4b, 4c, 4d, 6b, 9b and 9c, then 10.
    - It states A1's hard boundary, and the block written singly.
    - It ends at the PR: no hand rollout.
  - **The dispatch** carried 19 items and the route `{opus, xhigh, sonnet, workflow on, compact 40}`, and answered
    `ok`: not resumed, brief queued, skill present.
  - **Overlaps.** `ccrc-pwa-soft-basin` agreed to the rule (mail 3563), with one addition. Run 271 also edits
    README.md, in the registered-events paragraph and the capture section. So the second lander re-runs
    `session-hook.test.ts` IN FULL, where a README collision would show. The brief carries that. `ccrc-pwa-quiet-river`
    has not replied to mail 3560 by dispatch, so the proposed rule stands.

- **2026-10-05 18:35 — wave 5's pre-flight, the coordinator's rulings R38–R47 (contract §11), and the split into
  waves 5 and 6.**
  - **The pre-flight.** It read the 2026-09-22 plan against `334fb722a`, and the live fleet read-only.
    - Three Opus lenses (anchors, contract, process) raised 50 findings: 9 blocking, 23 important and 18 minor.
    - Five Opus design agents turned every "Wave 5 inherits" item into options. None of those items had been placed.
    - The process sections were stale against the 2026-09-30 updater ruling.
    - The estimate came to 12k to 18k insertions, above waves 3 and 4.
  - **The rulings.** R38 to R47 are now contract §11.
    - **R38 splits the wave.** Wave 5 is server and PWA only:
      - the chip;
      - the presence lease and clocks (R39);
      - R37 fenced to the workspace's current generation (R40);
      - the sweep's verdicts made visible (R41 to R44);
      - the abandon copy and the prose (R45, R46).

      Wave 6 is AGENT-FIRST and carries R36's collector, rewritten to a positive witness: `~/.cc-tmp` holds 16
      foreign directories (6.5 GB) that R25 as written would delete. It also carries the dot-locks, F6, ccd's
      journaling, the gone-branch pin and the gone-row recovery. It waits for workspace-lifecycle wave 3.
    - **R47:** deploy through the updater only; the SAFETY lens is mandatory; delivery is by `planSha`.
  - **How the amendments were written.** Four Opus composers wrote them, and three Opus attacks went at them:
    SAFETY, executability and rulings. The attacks found one blocking defect: the lease had no tenure bound. The
    rulings were corrected:
    - a forfeit, and three stated figures for the bound;
    - R40 stated as Task 0c's instant rule, which keeps an heir;
    - the kept sentence's ending.

    The coordinator then ruled on the composers' open issues and on the editors' remaining items. A reconcile pass,
    a whole-text consistency check (13 conflicts, all applied) and one final edit pass followed. The records are in
    the evidence archive (`wave5-preflight/`, `wave5-amendments/`, `wave5-final/`, `wave5-reconciled/`,
    `wave5-applied/`).
  - **The live cases.**
    - `ccrc-pwa-brisk-meadow` is an R37 false positive: its slug coordinated program-leverage runs 10 to 30 in
      August. R40 lets the sweep take it.
    - `expoAI-assistant-calm-mesa` (`pin-failed`, branch gone, HEAD `af784dbf` on `origin/main`) waits for wave 6,
      or for the operator's one `update-ref`.
  - **Route (clause 13), changed from wave 4's Opus·high with workflows off:**
    `{class:'opus', effort:'xhigh', subagent:'sonnet', workflow:'on', compact:'40'}`. This is the bulk row, because
    the amended wave exceeds one context. The implementation floor is `sonnet` / `high`. Tasks 0b and 0c and the
    verdict accessor are `opus`.
  - **Overlaps.** Claims read at 18:20. Overlap rules were proposed to `ccrc-pwa-quiet-river` (mail 3560; run 245
    holds `shared/api.ts` and `single-definition.test.ts`) and `ccrc-pwa-soft-basin` (mail 3562; run 271 holds
    `session-hook.test.ts`). The rule: additive edits; the second lander merges main, never rebases, and re-runs the
    shared suites; neither waits.
  - **Docs guards pass locally:** deviation-refs, topology-clean, crossrepo-prose, routing-references,
    ledger-instruction, runbook-holds, license and oss-metadata, 178 of 178. No block number is spent on the
    amendments.

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

- **Placed 2026-10-06 by wave 6's plan and contract §12.** The "Wave 6 inherits" items below are placed as follows:
  - the gone-directory alternate-row recovery: Task 9 (R54);
  - `vanish-reread-races-mirror`: Task 12 (R55);
  - F6: Task 1 (R51);
  - ccd journaling of the mirror-invisible failures: Tasks 10 and 11 (R52);
  - the gone-branch pin: Task 8 (R53).
  These go to wave 7 instead (R48, R57):
  - R36's collector, with the dot-locks: `_ws_slug_free` is the no-entry test, and dot-locks are never unlinked.
  - Wave 6 lays only the collector's groundwork: the witness (R50), the removal helper and the in-use probe (R49).
  Wave 7 also inherits:
  - a kept clips leaf, which nothing collects;
  - the witness's whole-second `btime`;
  - the recycled-slug quarantine proof;
  - the witness writer's temp-file residue.
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
- **Wave 5 inherits from wave 4's pre-flight** (placed 2026-10-05 by contract §11: the close words in R42, the skips in R41;
  R36 and ccd's journaling moved to wave 6 by R38):
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
- **Wave 5 inherits, from wave 4's reviews 254 and 258 (2026-10-04)** (placed 2026-10-05: G3, G4 and G1 in Task 0b by
  R39; G2 and G5 in Task 9c by R46; F6 moved to wave 6 by R38; "measure first" done at 13:06 and 14:31):
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
- **Wave 6 inherits (moved from wave 5 by R38), from the row-placement review (2026-10-01):** recovery for gone-directory alternate rows. An
  alternate row whose path is gone holds every other child at `unmeasured`, and two vanished or interrupted children
  hold each other; the recovery must prove the gone path was ccd's own worktree without consulting process state.
- **Wave 6 inherits (finding 3608, ruled 2026-10-06 00:48): `vanish-reread-races-mirror`.** Wave 5's vanish re-read
  usually lands before the journal mirror holds the `done reclaim`, so the row shows no chip and stays openable
  until the next mount. Wave 6's pre-flight picks the fix. The candidates are A, the tick awaiting the mirror for
  a vanished marked child before it emits the fleet frame (only after WL 3b's tick changes land), or a change to
  ccd's ordering. R21's fall-through stands until then.
- **After wave 6 (R38), a path-identity follow-up programme:** a re-pointed alias and a bind-mount spelling resolve
  `complete` and outside although a session may sit inside the child; device/inode ancestry is the measured
  direction, and the window between `_ws_reclaim_owned` and the tail's `git worktree remove` rides with it.
- **Wave 6 inherits (moved from wave 5 by R38), from wave 3's first live reclaim:** dot-lock files (`.reap-<id>.lock`,
  `.<id>.compactions.lock`, `.prstate-<id>.lock`) outlive a reclaim. The R25 collector's "no `$REG` entry of any
  suffix" condition must not read a lock as a live row, or the reclaim's tail must remove them.
- **Wave 5 inherits (placed 2026-10-05 in Task 9b by R45):** the PWA's abandon confirmation says the child's workspace will be reclaimed. The ungated
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

**Wave 5 is run 260, in fix round 1** (mail 3660), at `working`. The fix round merges `main`, defines its eighteen
assigned numbers (listed singly in the 05:41 and 09:15 entries) in the wave-5 plan, and sends one wave-done. A SCOPED review run follows: F1, F2, F4,
F11, the merge and the round's diff. Only a shipped-behaviour defect sends it back again. Before #290 lands, the
operator is told in one ledger line (R47); the PR body names `brisk-meadow` and `reclaim-pause`. Then merge,
observe the deploy read-only, and close run 260 (wave 6's run 291 is already open, so the programme stays live).

**Wave 6 is run 291, `planned`,** with its block 4126, 4127, 4128, 4129, 4130, 4131, 4132, 4133, 4134, 4135, 4136,
4137, 4138, 4139, 4140, 4141, 4142, 4143, 4144, 4145, 4146, 4147, 4148 and 4149.

**Its plan is `docs/superpowers/plans/2026-10-06-child-reclamation-wave6-reclaim-repairs.md`, binding with contract
§12 (R48–R59).** Both reach `main` in one docs PR before dispatch, and the brief names `homeRepoRoot`, `planRepoPath`
and `planSha` (that PR's squash commit). The plan carries its drafting rulings and attack rulings already applied.

Before dispatch:
1. #290 has merged (R56; X1: the worker branches from a `main` that already carries wave 5, and Task 0 proves it).
2. Tell `ccrc-pwa-quiet-river` what reaches ws-expire through shared code (drafting ruling X2): F6, the contained
   tail, the helper and the wait, the gone-branch reads, the gone-directory recovery, the expire-probe header
   comment, `ccdWsHelpers.ts`'s in-place strip and the `ccd/ccrc` platform-block edit. Mail 3657's question about
   WL 3b's edits to `_ws_reclaim_tail`/`_ws_reclaim_contained` is answered first.
3. Re-read `GET /api/claims?project=ccrc-pwa` and apply R56's overlap rule (workspace-lifecycle; run 274).

Then dispatch one fresh child:
- **Route:** `{class:'opus', effort:'xhigh', subagent:'sonnet', workflow:'on', compact:'40'}` (the bulk row: about 9200
  plan lines, ccd-heavy). Tasks 3 to 9 are SAFETY-critical and run on Opus `high` implementers and reviewers.
- **Execution skill:** `superpowers:subagent-driven-development`, with `superpowers:test-driven-development`.
- **Task order:** Task 0, Tasks 1 to 12 in order, Task 13 (docs), Task 14 (whole-branch verification and the PR).
- **Lenses:** the plan's SAFETY (Opus `xhigh`) and SECURITY lenses, both mandatory, beside the held-out panel.

**Wave 7** (the collector verb, R57) and **wave 8** (its lane, R58) are new runs, each opened before the previous
wave's run closes, each with its own block, plan and pre-flight. Wave 7 inherits: a kept clips leaf with no collector;
whole-second `btime`; the recycled-slug quarantine proof; the witness writer's temp-file residue; the intermittent
macOS `purge-refused` in the symbolic-ref reflogs case (decision 12:31); the closure of `kept-word-ends-on-late-birth`
(R61, decision 12:39); X1 and X3 (R63); a persistent per-child failure's endless paced retry (decision 2026-10-07
16:47), which now includes `_ws_reclaim_owned`'s moved-tree arm and a row at or inside a leaf; from wave 6's review 335
round: rung 8 reading a silent omission as "no record", the uncapped `_WS_NORMALISE_WHY`, the additive `crumb` field
on ccd's failed document (the pre-breadcrumb `pin-failed`/`tombstone-unwritable` sentence, and the resumed-arm
`probe-unmeasured` on the verb and on the audit), and the collector calling `_ws_leaf_remove`; from review 341: the
pins for F4 (writable `builtin`), F5 (the clips odd word), F6 (a FIFO at an outside admin `gitdir`), F7 (a fixed find
order for row 17) and F9 (the vacuous kebab line) (decision 2026-10-08 12:03). Wave 8 waits for
workspace-lifecycle wave 3b and for the fleet's `ccd caps` to advertise wave 7's token. The path-identity follow-up
programme comes after wave 8.
