# Program: workspace-lifecycle

Spec: `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`
Plans: `docs/superpowers/plans/2026-09-2?-workspace-lifecycle-wave<N>-*.md` — each written once the waves it depends on
have landed what it reads
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-quiet-river` (assigned by the operator 2026-10-02)   Workspace: **a fresh one per wave**
Ticket: `CCR-17` (Linear; mirrored as GitHub issue #196) — the coordinator is created from it
Companion programme: `docs/superpowers/programs/child-reclamation.md` (CCR-15) — waves 2–4 here build on its waves 3–4

**What this program is.** Released workers littered the fleet board: 29 of 56 registry rows on 2026-09-24 were
workspaces a programme had finished with, loose at the top of their cards under generated names, and the operator
archived them by hand. This programme folds them into a `Released (N)` section per card, makes Stop and Archive one
feature, cleans an archived workspace up losslessly 7 days after its archive, and ends the programme of a coordinator
that crashed and stayed dead for an hour. The operator's rulings are the spec's §2 (L1–L6); both consequences in its
§11 were confirmed on 2026-09-26.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 | `FleetSession.releasedFrom`; the `Released (N)` fold grouped by programme; "Archive all" (plain archives, children skipped); `deploy/measure-workspace-lifecycle.py` | server + pwa | — | #229 | merged 2026-10-02 (`a7b9831c`); run 220 closed; deploy measure-only |
| 2 | 2 | one "Archive"; the busy confirm; the coordinator ask (end programme or cancel); the Archived fold takes stopped main checkouts; "Restore" | server + pwa | wave 1; child-reclamation wave 3 merged | #233 | merged 2026-10-03 (`fe7b9775`); run 236 closed; deploy measure-only |
| 3 | 3, the verb | `ws-audit --expire` and `ws-expire` (ladder, pin phase, tail, `expire:` breadcrumb and ws-reap's resume arm, spawn-path refusals, the `expire` journal act); the server's argv builder and `expire-v1` token, uncalled; wave 2's residue; wave 1's instrument items | **AGENT-FIRST** | child-reclamation waves 3–4 merged and deployed; the archive→return delay measured (done: not held) | #286 | merged 2026-10-06 (`77c11245`) after review 288; run 245 closed; deploy AGENT-FIRST via ccrc's updater; plan #252 (`b5593725`); block 3886–3895 + 3958–3965 |
| 3b | 3, the lane | `archivedExpiryVerdict` and the expiry population in the reclaim sweep; `reclaim-paused` becomes the one cleanup switch; coordinator clause 3, README and wave-lifecycle §6; the 409 detail, the 404 fold, FM7 | server + pwa | wave 3 merged and deployed; PRECONDITION: the 3893 return-verb race closed before go-live | — | #312 | merged 2026-10-07 (`9b074208`) after review 313, no fix round; run 290 closed; block 4114–4125; plan #308 (`67657ef2`); deployed (both boxes on v0.0.119, 10-07); the lane ships SHADOWED, and arming is the operator's, after wave 4's arming blockers |
| 4 | 4 | FIRST: review 313's residue and the lane's arming blockers; then the dead-coordinator lane: crash-only, 1 hour, no successor, circuit breaker | server (+ pwa for the residue) | waves 2–3; child-reclamation waves 3–4 | — | run 314 open (planned; the run's wave 5 of 5), blocks 4348–4363 and 4430–4433; plan #323 (`8c446eab`); DISPATCHED 2026-10-07 22:28 → `ccrc-pwa-swift-cove`; wave-done 10-08 04:3x, PR #328 @ `701839b52`; review run 339 (`ccrc-pwa-keen-summit`), no fix round; **merged 2026-10-08 (`669b8305`)**, prerelease v0.0.123; run 314 closed; deploy via ccrc's updater; the lane ships SHADOWED |
| 5 | 3–4, follow-ups | FIRST: review 339's residue and the dead-coordinator lane's arming blockers; then the expiry lane's follow-ups: the kept-leaf reader, the `state-changed` reading, the answer to a repeating resumable failure, the in-lock window close | server (+ **AGENT-FIRST** if the window close lands in ccd) | wave 4; CCR-15 wave 6 (#326) merged | — | run 345 DISPATCHED 2026-10-08 22:10 to ccrc-pwa-keen-hollow (the run's wave 6 of 6), block 4480–4495; plan merged #333 → `b2b438d0b` (13 tasks) |

## Decisions & deviations

- **2026-09-24 — the rulings.** L1–L6 in dialogue (spec §2); rev 2 of the spec applies a four-lens review.
- **2026-09-26 — the spec approved, both §11 consequences confirmed.** Archiving a coordinator with open runs offers
  "End programme and archive" or "Cancel" only (mail to an archived session parks, D-1066; pausing is the coordinator
  pause switch). Every workspace archive, a "stop for now" included, starts the 7-day clock; main checkouts are never
  deleted.
- **2026-09-26 — wave 1 planned, measured and reviewed.** The plan's edits were prototyped and measured red-first and
  green task by task; its blocks are generated from the prototype and replay onto a clean base byte for byte. Three
  independent reviewers (spec fidelity, correctness and tests, executability and merges) found no blocker; every
  finding was applied, and the mutation table grew to 72 rows, 71 red and one (a double-tap guard jsdom cannot
  reach) recorded as unpinnable. The spec's §5.1 and §9 were corrected the same day to say what the plan builds
  (`lastRunBySession(sessionIds)`, the `ChildMark` words, the instrument on the server box alone). The operator
  approved the plan on 2026-09-28.
- **Execution: coordinator dispatch** (the operator's 2026-09-24 ruling for these programmes). One coordinator per
  programme, created by the operator from its ticket; each wave goes to a fresh worker workspace running
  subagent-driven development, a review run reads the worker's branch, and the coordinator rules and merges. The
  plans reach a worker only from `main`.
- **2026-09-28 (evening) — wave 1 re-verified against `023fe94d`.** Child-reclamation wave 3 (#187) and
  update-management wave 4 (#181) merged. The plan replays unchanged: every Find occurs once, the fixture sweep still
  touches 31 files, and `readme-reanchor.py` now prints `shared/api.ts:7641-7643, :7683, :7691, :7704` (the plan's own
  numbers are stated on a `df4fe069` base). Typechecks clean; PWA 3041; server six shards green apart from the two known
  reds. The fleet box's root disk sat below `ccd`'s 10G `ws-add` floor while measuring, which reds every `ws-add` test
  on the unedited base too: run the suites with `CCD_DISK_FLOOR_GB=1` when that happens. Wave 2 is unblocked.
- **2026-09-30 — wave 1 re-verified against `c88625aa`, then `5b1c58a8`.** On `c88625aa` the plan replays unchanged
  and its server suites are green. On `5b1c58a8` the worker stall watch (#216) had split the two-line `store.ts`
  import block Task 3 inserts into, so that one Find now anchors on the `placement.js` import line alone; the output
  on `c88625aa` is byte-identical. The same PR added a 33rd `child: { kind: 'none' }` fixture (`stall-sweep.test.ts`),
  so Task 1's sweep now touches 32 files, and the plan says so. With that, the plan replays onto `5b1c58a8` in a git
  checkout (the sweep reads `git grep`), `readme-reanchor.py` prints the same `shared/api.ts` lines, both typechecks
  are clean, and the wave's suites are green there: server `released` 20, `released-store` 7, `released-wire` 14,
  `fleet-released` 7, `measure-workspace-lifecycle` 9, `stall-sweep` 42, `single-definition`, the citation cases; PWA
  `groupFleet`, `archiveReleased`, `project-card`, `fleet-screen`, `tap-targets` and `fleet-css` (376), `contrast`
  256, and the design audit.
- **2026-10-01 — wave 2 planned and approved; both plans re-checked on `e0a52953`.** Wave 2's plan (#223) was
  prototyped on `main` `5b1c58a8` with wave 1 applied and reviewed through three lenses; the operator approved it
  by merging #223. The same day the worker stall watch's wave 2 Part B (#224) landed: it grew
  `single-definition.test.ts` with a second describe whose closing lines match the one wave 2's Task 1 inserts after,
  so that Find now carries the line above it (the output on `5b1c58a8` is byte-identical), and it added a second
  `child: { kind: 'none' }` literal to `stall-sweep.test.ts`, so wave 1's sweep is 32 files and 33 lines. With those,
  both plans replay onto `e0a52953` in a git checkout, both typechecks are clean, and wave 2's server (26 files, 1628
  tests) and PWA (14 files, 641) suites are green. Wave 2's Task 12 skips its `CLAUDE.md` edit there, as its Step 3
  says: `main` already re-measured the README claim (`~3800`). The plan's two open questions stay open.
- **2026-10-02 — the coordinator assigned.** The operator made session `ccrc-pwa-quiet-river` — the planning session
  that wrote this programme's plans — the coordinator of landing-order, session-continuity and workspace-lifecycle
  together. Each wave is its own run under that session id; a fresh coordinator resumes only under the same id
  (the coordinator skill's `references/resume.md`). Wave 1 dispatches now; wave 2 after wave 1 merges.
- **2026-10-02 — wave 1 dispatched as run 220** to a fresh workspace (`ccrc-pwa-calm-prairie`, branch `ws/calm-prairie`),
  executing by subagent-driven development on the matrix's "worker executing a spec'd plan" row (Opus · high,
  Sonnet · high implementers, an Opus · high reviewer per task, workflow off, compact 40). Its deviation
  numbers, issued at run-open and written bare here until a plan on the same ref defines them: 3778 through 3787.
  The brief adds two rules that post-date the plan: the wave stops at the PR (the coordinator merges; the
  fleet moves by ccrc's own update mechanism, operator ruling 2026-09-30), and main is measured fresh.
- **2026-10-02 — wave 1 done, in review.** Run 220's wave-done (PR #229, tip `79812043`) passed the server's
  re-measurement. The run is at `awaiting-review` and its ten items are settled.
  - **Departures.** The worker used six of its issued numbers: 3778 through 3783. Each is defined in the plan on
    the branch. 3784 through 3787 went unused.
  - **Signals.** `suite: red`, `failure: unclear`. The first full local run timed out at load average 40–95: every
    PWA failure was a timeout, and two server cases passed when run alone. No assertion on this wave's code failed,
    and CI's required Linux checks are green.
  - **Routing.** Not escalated. The red measures the box, not the worker's effort, and clause 13 revises routing
    only on evidence about the work.
  - **Review.** Review run 225 went to `ccrc-pwa-swift-river` on Opus · high with workflows on, so it can run the
    held-out panel. Its first dispatch answered a bare 502: the `subagent` route field takes only haiku or sonnet,
    and the panel's Opus lenses ride the Workflow call's own `model:`. Re-dispatched with `sonnet`. No workspace was
    spawned in between.
  - **Deferred, ruled at review.** The final whole-branch review deferred binding the instrument's `RETURN_ACTS` and
    `ENDS_THE_ARCHIVE` to ccd's `_LC_ACTS`; reclaim, gc, rename and rehome are in neither list. That must be fixed
    before wave 3 reads its archive→return delay. Whether it blocks this wave is the review's to report and mine to
    rule.
- **2026-10-02 — review 225 ruled: one fix round.** The held-out panel ran clean: three lenses verified, 30 agents,
  7 findings confirmed, 2 refuted, none unexamined. The reviewer then measured one of the confirmed findings false
  (R1). Six findings remained:
  - spec lens: 1 (F1);
  - correctness lens: 5 (F2–F6);
  - reproduce lens: none, after 36 tool calls.

  Twelve mutation rows were re-measured, all red, P25 and S38 included. The suites reproduced: server 602 passed, PWA
  3141 passed, the census 7 passed. Rulings:
  - **Fix now.**
    - F1: name the final commit's `holdsSelection` widening as a departure. It is right and pinned.
    - F2: the Released toggle must not flip its stored key while the selection forces the fold open.
    - F3: retitle the fleet-screen double-tap case, which cannot red for the guard.
    - F5: released rows must not rank their card below an all-archived card.

    Each takes one of the block's unused numbers, 3784 through 3787, and the worker merges main (cf9e4cc8, no shared
    files).
  - **Accepted, F6.** `single-definition`'s one-reader scan for `releasedFrom` matches dotted access only. A
    destructured or bracketed read would pass it. Named cost: the single-reader rule is pinned against the common
    spelling only.
  - **Deferred to stage 3's plan.** F4, the RETURN_ACTS / ENDS_THE_ARCHIVE binding, and R1's residual. They are
    listed under Carried constraints.
- **2026-10-02 — wave 1's fix round done, in re-review.** The fresh wave-done (tip `56ad0992`) passed the server's
  re-measurement.
  - **Fixes:** F1, F2, F3 and F5, as 3784 through 3787. That uses the whole block, each number defined in the commit
    it records.
  - **Main merged:** `cf9e4cc8`, with no hand resolution (no `--cc` hunk).
  - **CI:** every required Linux leg is green. One server shard needed a re-run, red in two of #222's files that this
    wave does not touch (`update-inventory` "inside the same second" and a `ccrc-update` hook timeout).
  - **Re-review:** review run 229 went to `ccrc-pwa-keen-summit`. The held-out panel reads the fix range
    `79812043..dd34f2a3`.
  - **Open for that review: whether F2 reads clearly.** F2 chose a disabled toggle with no `:disabled` style, so a
    sighted operator sees an unchanged toggle that ignores the tap. The review judges that against the ruling's
    "whichever reads more clearly to the operator".
- **2026-10-02 — re-review 229 ruled: fix round 2.**
  - **The panel:** 30 agents, 7 confirmed, 2 refuted, none unexamined.
  - **Measured:** all four round-1 rulings hold where they act, and the pins red at the worker's counts. The whole
    PWA suite passed, 3143 of 3143.
  - **Two important findings:**
    - F2's control cannot tell `disabled={selectionInReleased}` from `disabled={releasedShown}`. The latter would
      lock an operator-opened fold open.
    - F5's new concatenation also lifts UNRELEASED dead rows above archived ones. Nobody asked for that or ledgered
      it.
  - **Ruled:**
    - Restore sortFleet's order for unreleased dead rows. F5 lifts released rows only.
    - Pin the operator-opened toggle, the released-dead lift, and both orders.
    - Drop the overclaiming second tap.
    - Re-anchor the stale mutation rows P30 and P31.
    - Correct two stale comments.
    - Give the disabled toggle `cursor: default`. The reviewer judged the shipped look no worse than a no-op, and
      a pointer cursor offers a tap that does nothing.
  - **Numbering:** each fix extends the departure it completes (3785, 3786, 3787), so no new number is minted.
- **2026-10-02 — fix round 2 done, in re-review.** The fresh wave-done (tip `dc4be181`) passed the server's
  re-measurement. Four commits address A1 through A6, each extending its departure, with no new number.
  - New rows P35, P36 and P37 red, and P30 and P31 are re-anchored, none of them SKIPPED.
  - The whole PWA suite passed, 3145 tests.
  - CI's required Linux legs were green on the first attempt.
  - Review run 231 went out with the held-out panel over `56ad0992..dc4be181`.
- **2026-10-02 — re-review 231 ruled: fix round 3.**
  - **The panel:** 21 agents, 4 confirmed, 2 refuted.
  - **Measured:** A1 through A6 hold, and P30, P31 and P35–P37 reproduce exactly. The four-part order moves only
    rows in the Released fold relative to sortFleet's RANK, measured with a three-card probe.
  - **What is left:**
    - "unreleased dead" in four texts means "dead and not in the fold", which is false for a released row with a
      strand marker;
    - that row's order is unpinned;
    - three D-3786/D-3787 sentences are inexact.
  - **Ruled, option (a):** keep the code, rename and reword to "unfolded", pin the stranded row below an
    archived-only card, and correct the three sentences. Option (b), keying on `releasedFromOf`, is not taken,
    because it would move an unfolded, visible row relative to RANK.
  - **Numbering:** no new number.
- **2026-10-02 — fix round 3 done, in re-review.**
  - **Fixes:** four commits (tip `add311d4`). The rename to `unfoldedDead`, the reworded texts, and the stranded-row
    pin (P38, red under the panel's remedy). P31, P36 and P37 are re-anchored on the 54-case file.
  - **CI:** the required Linux legs are green on the first attempt.
  - **Re-review:** review run 234 went out with the held-out panel over `dc4be181..add311d4`.
- **2026-10-02 — wave 1 accepted and merged.**
  - **Review 234** read fix round 3 and found one optional finding: P3 and P4 red one more case than Task 10's table
    records. The table states its counts as at-least prototype figures, so nothing in it is false. Accepted as is.
  - **Totals:** four review runs (225, 229, 231, 234) and three fix rounds. All ten issued numbers are used, 3778
    through 3787.
  - **Merge:** PR #229 squash-merged at the verified tip `add311d4`, as `a7b9831c`, with `--admin` and
    `--match-head-commit`. Wave 2's run (236) was opened before run 220 closed. Run 220 closed `done`, released,
    and its child was queued for reclaim.
  - **Deploy:** server + PWA, measure-only, through ccrc's own update mechanism.
  - **Owed:** the instrument run on the server box (Task 9's), `released_top_level` and `released_wire_only`
    recorded here.
- **2026-10-02 — wave 2 dispatched as run 236** to a fresh workspace, on the matrix's "worker executing a spec'd plan"
  row (Opus · high, Sonnet · high implementers, an Opus · high reviewer per task, workflow off, compact 40). Its
  deviation numbers, issued at run-open and written bare: 3836 through 3845.
  - **Anchors:** before dispatch, all 99 of the plan's find blocks were scanned against `a7b9831c`. 95 match once.
    The other 4 are written by Task 1, or are CLAUDE.md's size claim, which main already re-measured (Task 12's skip
    arm).
  - **Wave 1's shipped order:** the brief carries the four-part card order. A stopped main checkout keeps dead's
    rank in part 4, and `unfoldedDead`'s text must say "not in the Released fold".
  - **Serialised overlap (clause 10).** Task 12 edits README and CLAUDE.md, which run 218 (#231, in final review)
    claims, so Task 12 waits for #231's merge.
  - **Repo-wide guards:** they run in every task, per the landing-order ruling.
  - **Open questions:** the plan's three stay the operator's, built as the plan says.
- **2026-10-02 — run 236 mid-wave: two numbers added, and a claim wait.**
  - **Progress:** Tasks 1–5, 7 and 8 are committed and reviewed, and main is merged.
  - **Numbers:** the block 3836–3845 is fully used. Two departures found in execution took 3866 and 3867, minted on
    the worker's request:
    - 3866: a wave-1 test mock resolves `null` under Task 7's new return type;
    - 3867: ArchiveSheet shares one exported run predicate instead of a copy that falsified its one-reader docstring.
    - 3868 and 3869: a stopped main checkout's Restore, in the actions sheet and in the header, sends the same
      `/ensure` that Restart sends, so it takes the same substrate-fault gate. A workspace's `ws-restore` stays
      ungated.
    - 3870: the Archive sheet's "Stop only", now the PWA's only stop control, takes the substrate-fault gate and the
      fire-time re-check that the header's Stop session had. Substrate §4 lists stop as destructive under an outage.
  - **Claim wait:** CLAUDE.md and README.md, which Tasks 6 and 12 edit, are held by stall-watch wave 4's claim 897
    (run 226). The peer protocol forbids editing a contested path, so the worker holds those tasks. Calm-harbor has
    been asked (mail 3245) to extend the second-lander rule agreed for run 238.
  - **Agreed (mail 3246):** both PRs land, and whichever lands second merges main and keeps both sides. Because
    Task 12 inserts a README subsection, the second lander also re-runs the README citation rows, which must stay
    green. The worker has been told.
  - **Parked, accepted:** an Important finding. On a store-read failure the archive door's 409 body drops
    `measured()`'s detail, which is base behaviour (D-2545). It is named in the PR as a follow-up.
- **2026-10-02 21:30 — wave 1 deployed and measured on the server box.**
  - **Deploy:** both boxes run v0.0.63 (`10f32755`, which carries #229), applied from the console 19:52–20:00. Each
    `ccrc update --check` reads current.
  - **The instrument** (`deploy/measure-workspace-lifecycle.py`, read-only, from the installed tree, as the server's
    user), against a 142-row snapshot 12 s old:
    - `released_computed` 14, `released_needs_person` 0;
    - **`released_top_level` 0** (baseline 29 of 56 on 2026-09-24; target 0);
    - **`released_wire_only` 0** (target 0).

    Wave 1's purpose holds on the live board.
  - **Archive rows**, for wave 3:
    - `archived_over_7d_unheld` 50 and `archived_over_7d_held` 0;
    - `archive_returns` 16 over a 41.4-day journal horizon, the longest 43,326 s (about 12 h);
    - `archive_returns_over_6d` 0 and `archive_returns_over_7d` 0;
    - `archive_acts_per_day` 129 over 14 days.

    Spec §9's kill-rule band is empty, so the measured archive→return delay does not hold stage 3. That measurement
    is the one wave 3 waited on.
- **2026-10-02 21:39 — wave 2 done: PR #233 at `3b07b2bc`** (wave-done 3274).
  - **Re-measured:** the branch tip is the claimed sha, the PR is open and mergeable, and CI is running.
  - **Advanced:** `working`, then `awaiting-review`, both ok. All 13 items are settled done.
  - **The worker's signals:** `suite: red`, `failure: unclear`. Its first full run had three reds, none from this
    wave:
    - two boot.test.ts boot-time cases at 3.6 s against a 3.0 s limit under load, 4 of 4 green in isolation;
    - tmp-sweep's FAILS CLOSED, which is red on main too.
  - **Routing:** the "worker executing a spec'd plan" row stands for wave 3. The signal names no fault of this
    wave's.
  - **Mutation table:** 96 of 98 plan rows are red, with S42 green by construction and its control S42c red. P23
    was adapted to P23a. The worker's own rows X1–X6b are red.
  - **Deviations:** fifteen, each defined once: 3836–3845, plus 3866–3870.
  - **Task 12** took Step 3's skip arm: README is 3852 lines against CLAUDE.md's "~3800", so CLAUDE.md's size
    claim is untouched.
  - **Follow-ups named in the PR body:**
    - the 409 detail, already carried;
    - the base's 404 for an unlistable registry, where only the comment was corrected;
    - Released/Archived fold-disjointness hardening;
    - `idleForStop`'s placement in L4.
  - **Review run 240** is open. The 24-hour window is full until 00:09:10 (2026-10-03), which is this programme's
    slot under the split with the stall-watch coordinator (mail 3276). The brief asks the panel to hold the door's
    irreversible acts, the rings, the four-part order, the three fault gates and the census. It also asks it to
    compare boot.test.ts at the tip with main.
  - **Slots agreed with the stall-watch coordinator** (mail 3277, reply 3278), for the window's next age-outs:
    - this session's three programmes take 00:09:10, 02:42:08 and 11:53:20;
    - stall-watch takes 10:11:41 and 11:53:42.
    Whoever won't use a slot mails the other before it ages out.
- **2026-10-03 00:10 — review run 240 dispatched** to `ccrc-pwa-brisk-hollow`, in the 00:09:10 slot, after
  re-measuring the tip as `3b07b2bc`. #233's required CI is green.
- **2026-10-03 00:40 — review 240 closed and ruled** (report
  `~/.cc-clips/ccrc-pwa-brisk-hollow/review-240-3b07b2bc.md`; the held-out panel, 27 agents, no lens unverified;
  7 confirmed, 1 refuted, 2 more from the reviewer).
  - **The review accepts the wave's shape:**
    - the door's check-before-act ordering;
    - the rings, apart from F9;
    - the four-part order (X3 red);
    - the three fault gates on one predicate;
    - the census, the removed and unchanged surfaces, and the open questions (none widened).
    All suites are green at the tip, 17 sampled mutation rows reproduce, and boot.test.ts is unmoved against main.
  - **Fix round 1** (mail 3296; numbers 3877–3881 issued, written bare here):
    - F8, 3877: with `{programme:'end'}` and no `interrupt`, a workspace's busy is read fail-closed before the
      programme ends. This wave made it measurable, and spec §5.2 asks for every measurable check before the
      irreversible act.
    - F9, 3878: `idleForStop`'s rule moves to L1 beside `decideArchive` (it was a decision in delivery).
    - F2, 3879: the test that `withAbandon` shares the routes' mutex must red under a second, separately bound mutex.
      It was green 82/82 under that mutation.
    - F5, 3880: the Task 2 fixture change gets its number.
    - F1: comment correction only. Since #143 every ccd spawn clears the archive marker, so the panel's premise (a
      live pane carrying a marker) is history except for a pre-#143 pane never respawned. The door reading ccd's
      `already archived` exit 0 as success is carried.
    - F3 and F4: the Deviations preamble is reworded, and spec amendment A10 names the three fault gates.
    - F6 needs no number. F7 is commit-message history, so no action.
    - 3881 is a spare.
  - **The re-review** needs a dispatch slot. This programme's next agreed slot is 11:53:20.
- **2026-10-03 01:04 — fix round 1 done at `4daf7696`** (wave-done 3300; 7 commits, 9 files).
  - F9 landed first: `stopIsIdle` is pure L1 in `archiveDoor.ts`.
  - F8: `busyReadFailsClosed` (L1) refuses a busy or unmeasurable workspace with `409 session-busy` before any
    programme end. X7 and its variants are red.
  - F2: the pin races `close` and `open` against a held `withAbandon`. X8 was green before the change and is red
    now.
  - F1, F3, F4 and F5 are as ruled. A10 is in the spec, and the worker also stated 3877 in §5.2 step 1 and §8.
    3881 is unused.
  - Re-measured: the tip is the claimed sha. Run 236 advanced to `awaiting-review`, ok.
  - **Review run 242** is open. Its brief holds the round to its rulings, F2's determinism under load, and F9's
    verdict identity. It dispatches at 11:53:20, this programme's agreed slot. The next age-out after the split,
    11:54:07, goes to continuity's review: stall-watch agreed (mail 3302).
- **2026-10-03 11:54 — review run 242 dispatched** to `ccrc-pwa-swift-canyon`, in the 11:53:20 slot, after
  re-measuring the tip as `4daf7696`.
- **2026-10-03 12:20 — review 242 closed and ruled** (report
  `~/.cc-clips/ccrc-pwa-swift-canyon/review-242-4daf7696.md`; the held-out panel, 27 agents, no lens unverified;
  5 confirmed, merged to 4, and 3 refuted).
  - **Round 1's rulings hold:**
    - F8 and F9 are pure L1, with verdicts identical;
    - the mutex pin reds 4 of 4 under X8 and stays green across 14 repeats at load 17–27;
    - 17 rows reproduce, and every suite is green.
  - **Fix round 2** (mail 3316):
    - F5, 3881 (the spare): the fail-closed read folded "unmeasured" into `session-busy`. So the operator was offered
      the interrupt consent on a false "it is working", and with it the programme ended and ccd then refused
      `status-unknown`. The PWA handles the two words oppositely, so this is the overloaded-result defect, on the very
      act the wave was asked to protect. The verdict becomes three-valued in L1, and unmeasured answers
      `status-unknown` for both kinds of row. Under `programme:'end'`, a workspace's read runs even with `interrupt`,
      so only a measured busy is consented.
    - F1–F4: comment and plan-text corrections. The pin's 2 s bound is stated, the comment names functions rather
      than `ccd:N` lines, the spec is cited by section rather than the "A10" label, and the docstring names its second
      caller.
- **2026-10-03 12:34 — fix round 2 done at `a2e5744f`** (wave-done 3318).
  - **3881:** `stopVerdict` is idle, busy or unmeasured, in L1. Unmeasured refuses `status-unknown` before anything,
    and a measured busy without `interrupt` refuses `session-busy`. A workspace under `programme:'end'` is read with or
    without `interrupt`.
  - **The worker's three rulings**, for the review to judge:
    - the arm mapping follows ccd's `_ws_status`;
    - unmeasured refuses whatever the consents, the main checkout included (`interrupt` consents to a measured turn's
      loss only);
    - the stop's re-read runs only without `interrupt`.
  - **Review run 243** is dispatched to `ccrc-pwa-plain-canyon` at 12:35. The window had room: 21 of 24, and
    stall-watch holds no slot.
- **2026-10-03 12:55 — review 243 closed and ruled** (report
  `~/.cc-clips/ccrc-pwa-plain-canyon/review-243-a2e5744f.md`; 8 minor findings; the panel confirmed 10, each 3–0,
  and refuted 3).
  - **Fix round 2 holds.** The verdict is pure L1, and the worker's rulings 2 and 3 are consistent with the intent.
    18 rows reproduce, and every suite is green.
  - **Fix round 3** (mail 3321), with each leak closed under 3881 by extending its entry, no new number:
    - F7 (ruled): a plain workspace archive with `interrupt` still stopped a pane it could not measure, because the
      frame row folds tmux `unknown` to dead and the stop precedes ccd's `_ws_status`. `busyReadFailsClosed` now
      also holds whenever `interrupt` is set: interrupt consents to losing a measured turn only.
    - F1: an empty or unextractable status word is unmeasured, as ccd's `[[ -n "$st" ]]` reads it.
    - F2: the config dir is read before the tmux verdict, in ccd's order.
    - F3–F6 and F8: L0 refusal docs, spec text, the preamble, and README re-wrapped to its line count.
- **2026-10-03 13:09 — fix round 3 done at `53f31389`** (wave-done 3322; one commit, all under 3881).
  - F7: interrupt takes the fail-closed read, and the review's three probes now refuse `status-unknown` with nothing
    stopped.
  - F1: an unextractable status word is unmeasured.
  - F2: the config dir is read first, as in ccd.
  - The new rows X14–X16 are red.
  - **Review run 244** is dispatched to `ccrc-pwa-still-canyon` at 13:10. It asks whether the unmeasured rule is now
    whole on every path, and whether `stopVerdict` agrees with ccd's `_ws_status` arm for arm.
- **2026-10-03 13:31 — review 244 ruled; wave 2 MERGED as #233 (`fe7b9775`)**, squash, at the reviewed head
  `53f31389`, with every required check green (report `~/.cc-clips/ccrc-pwa-still-canyon/review-244-53f31389.md`;
  24 agents, no lens unverified; 3 minor findings).
  - **The panel's verdict.** The unmeasured rule is whole on every path, apart from the windows inherent to reading
    before the mutex. `stopVerdict` matches ccd's `_ws_status` arm for arm and in order. There is no regression.
  - **Accepted after four review rounds.** The three findings left are carried to wave 3's first commit as residue,
    as landing-order did with its wave 1:
    - F1: the status-word check reads the parsed value, not ccd's raw grep, so a spaced or non-string `status`
      diverges. All 40 live files observed are compact, and no writer is seen to produce another shape.
    - F2: reading the config dir first also refuses a main checkout's gone pane under an unrostered wrapper. It fails
      closed, and "Stop only" remains.
    - F3: a present-but-malformed live file is a second stricter arm the spec does not list.
  - **The boundary:**
    - wave 3's run 245 opened first (planned; block 3886–3895);
    - run 236 closed `final` (`released:true`, `childReclaim:queued`).
  - **Overlap notices** (mails 3325–3328):
    - run 238 merges main before its wave-done (routes.ts, close.ts, store.ts and shared/api.ts, measured clean);
    - run 237 merges main before its README edits;
    - stall-watch's #232 and child-reclamation's #215 are now second landers on README/CLAUDE.md and store.ts.
  - **Deploy:** server + PWA, measure-only. It rides ccrc's own updater; nobody moves boxes by hand.
- **2026-10-04 22:28 — wave 3 split at the agent-first seam; its plan is drafting.**
  - **Unblocked:** child-reclamation wave 4 merged as #215 (`b40f4145`, 22:10). Its deploy waits for the operator to
    acknowledge the fleet box's failed v0.0.78 update row (landing-order ledger, same date). Wave 3 dispatches only once
    #215 is deployed.
  - **Why split.** Stage 3 holds a sibling verb and a sweep population. Child-reclamation shipped the same two things
    as two waves: its verb was a 7,498-line plan and a +14k PR, its sweep 5,533 lines and +14k. One wave would not be
    reviewable. Agent-first is the spec's own order.
  - **Wave 3 is the verb**, inert on deploy because nothing calls it:
    - `ws-audit --expire` and `ws-expire`, with spec §5.3's ladder, pin phase and tail;
    - the `expire:` breadcrumb, ws-reap's resume arm and every spawn path's refusal;
    - the `expire` act in `_LC_ACTS` and every declaration that agrees with it;
    - the server's argv builder, `expire-v1` and the type fixture;
    - CLAUDE.md's SAFETY list, which is true as soon as the verb exists.
  - **Wave 3b is the lane:**
    - `archivedExpiryVerdict` and the second population in the sweep;
    - the widened switch and its banner label;
    - coordinator clause 3's move;
    - README and wave-lifecycle §6, which would be false before the server expires anything.
  - **Rulings in the brief:**
    - the first commit is review 244's residue (F1–F3);
    - all three instrument items land in wave 3, with `expire` joining `ENDS_THE_ARCHIVE` in the same commit as `_LC_ACTS`;
    - review 240's `already archived` follow-up becomes a SAFETY requirement: an `.archived` row whose pane or
      supervisor is live is never expired, and the plan names and pins the rung that refuses it;
    - the 409 detail, the 404 fold and FM7 go to wave 3b;
    - child-reclamation wave 5 (run 260) is the overlap on ccd/ccd: whichever lands second merges main.
  - **The plan workflow** (wf_0b9331f4-22e): an Opus drafter prototyping in its own worktree; four Opus lenses (spec,
    safety and data loss, replay, test honesty); an Opus reviser; a Sonnet replay verifier. The plan goes to branch
    `docs/workspace-lifecycle-wave3-plan`.
- **2026-10-05 10:07 — wave 3's plan is ready: #252** (`93771c0b2`, 5,290 lines, 10 tasks, 14 departure slugs).
  - **How it was made:** the drafter prototyped every task. Four Opus lenses reviewed it, none unverified. The
    reviser applied 23 findings and rejected 5 with reasons. A Sonnet verifier replayed all 128 blocks onto main
    `4100ae1c9`: each matched exactly once, every stage's red and green counts agreed, and 20 sampled mutation rows
    went red.
  - **What the safety lens caught:** on Darwin, ccd's stale `failed` stamp let a running launchd supervisor pass the
    `live` check. The check now asks launchd itself, and is keyed on the token's binding rather than the flavour
    global.
  - **Rulings on its open questions:**
    1. ws-reap's `expire:` arm REFUSES (`expire-in-progress`), and ws-expire's own resume re-asserts the epoch.
       This is child reclamation's carried constraint 5. The 22:28 brief's ruling (E) ran the two together; this
       corrects it.
    2. The spawn gate's reap lock also refuses a spawn of an archived row during a human reap or restore. Kept,
       because a refusal is safer than the race.
    3. **Amendment:** rung 5 also refuses `in-use` when any process's working directory is in the worktree. On Linux
       the probe reads `/proc/*/cwd`; on Darwin it uses `lsof`; an unmeasured answer refuses. Ruling (D) meant
       "never while in use", and a refusal can only defer an expiry. The verb's ladder belongs to the verb's wave.
    4. More numbers were issued: 3958–3965 (slugs 11–14, the amendment, three spares).
  - **Dispatch waits** for #215's deploy. The fleet box still holds the failed v0.0.78 row unacknowledged, so the
    fleet has not moved since 2026-10-04 22:10. The operator was notified at 10:05. The brief and its dispatch body
    are ready.
- **2026-10-05 10:31 — #252 merged** (`b5593725`), squash, at the verified head `93771c0b2`, with every required check
  green. The fleet is still on v0.0.78 behind the unacknowledged failed row, so run 245 waits.
- **2026-10-05 12:41 — wave 3 dispatched** (run 245 → `ccrc-pwa-bright-canyon`; worker skill present; route Opus ·
  high, Sonnet subagents, workflow off, compact 40; ten items, one per plan task).
  - **The gate was met:** the operator acknowledged the failed row, and both boxes reached v0.0.84 (`00f8a193`, phase
    done). That build contains #215 (`b40f4145`) and #252.
  - **The brief carries rulings 1–4,** including the `in-use` amendment (3962). The worktree disk had 13 GB free at
    dispatch, against ccd's 10 GB floor.
- **2026-10-06 04:55 — wave 3's wave-done** (mail 3607; PR #286 at `3373287e`; 17 commits plus a merge of main).
  - **What landed:** the ten tasks, amendment (3) as Task 9A (`/proc` on Linux, `lsof` on Darwin bounded at 20 s;
    unmeasured refuses), and spare 3963 (the resume asks presence on the vanished-worktree arm). 3964 and 3965 are
    unused.
  - **Re-measured:** the tip matches the claim, and every required Linux check is green; the macOS legs gate nothing.
    The run went to `awaiting-review`, and its ten items were settled.
  - **Review 284** is dispatched to `ccrc-pwa-amber-river`, with the held-out panel named.
  - **Rulings on the worker's two asks:**
    - (a) The return-verb journal race (3893's disclosed residual) is CARRIED TO 3B AS A PRECONDITION. Nothing calls
      the verb until 3b's lane, so the race is unreachable now, and 3b closes it before the server ever calls the
      verb.
    - (b) Yes, the `in-use` probe also runs at the later resume phases where the worktree is present. Asking only
      refuses, and deletion happens there. It goes into a fix round if review 284 asks for one; otherwise it is a 3b
      precondition.
  - **Overlap with child-reclamation wave 5** (calm-mesa's 3560, agreed in 3622):
    - additive and disjoint edits in shared/api.ts, single-definition and wsaudit.ts;
    - the second lander merges main and re-runs single-definition, typecheck-tests, the citation cases and
      deviation-refs;
    - neither wave waits on the other;
    - child-reclamation's wave 6 (the ccd half) dispatches after #286 merges.
- **2026-10-06 05:48 — review 284 closed** (review-done 3630, reviewed tip `3373287e`; report copied to the coordinator's
  evidence directory on receipt).
  - **The verdict: the wave's core is accepted.** The panel ran 33 agents, none unverified. It confirmed P1–P9, all
    minor, and refuted X1. No path was found by which `ws-expire` acts on the wrong workspace or loses anything git
    knows. All 26 mutation rows are red, and every named suite and guard is green. Departures 3962 and 3963 are
    confirmed.
  - **Fix round 1 was sent to run 245** (mail 3631; the run is back at `working`), with spares 3964 and 3965:
    - **R2 → 3964:** ruling (b) reduces to one phase. The `in-use` probe is asked on resume at `expire:worktree`
      with the tree standing, and it refuses and never kills. `artifacts`, and `branch` after a `present`
      tombstone, are vacuous because the tree is gone there.
    - **R1:** the six test-macos reds are this wave's own Linux-only cases, which do not force `CCD_OS=linux`.
      They are fixed now: merged, they would hold main's daily macOS full-suite red, and the stable gate reads that.
      probe-macos's platform-hazards red is main's.
    - **P4 → 3965:** the CCR-15 texts this wave falsifies are amended now, per spec §6: ws-reap's resume fork, and
      CCR-15's "Not changed, deliberately" sentence (it now names ws-reap's `expire-in-progress` and ws-restore's
      refusal). Child reclamation's coordinator was told in mail 3632 and agreed (3633). Their #290 edits that
      spec's §1 and §5.5 only, so this edit stays inside the :780 passage; a wider edit asks first (mail 3634).
    - **P1–P3, P5–P8:** text and test corrections. P3 adds the young re-archive case. P6 writes Task 9A's as-built
      section with review 284's rows M08, M09, M14 and M26. P7 names the 20 s lsof bound in 3962. P8 records
      caps-token-shape's repair in 3961.
    - **P9:** no change. The commit's stated red-first count is stale; the measured count is 3 failed, 22 passed
      (25).
    - **R3 agrees with ruling (a).** The 3893 race is not fixed now. The plan's Carried row becomes "a PRECONDITION
      of 3b's go-live" and lists what the race can leave: orphan field files that keep the slug taken, a `swap`
      journal row read as a RETURN, and a started unit that dies at `ensure` until StartLimitBurst.
  - **Main:** #286 merged clean onto `21f536a5` (merge-tree); the round does not absorb main.
  - **Carried to 3b's operator text (R4):** one archived row on the fleet box today, `ccrc-pwa-brisk-mesa`, holds a
    leaked test tmux server in its tree. The lane will refuse it `in-use` on every pass. The refusal text must name
    what a pid is before it suggests ending one, because the fleet's own tmux server is also a `tmux: server`.
- **2026-10-06 07:02 — fix round 1 edits `ccd/ccd` without a claim** (mail 3647, answering bright-canyon's stuck 3635).
  - **`ccd/ccd` is shared by region, not by claim.** Claim 1043 (run 250) does not block a disjoint-region edit,
    and nobody takes, breaks or waits on a `ccd/ccd` claim for it. The regions: run 250 has the stamp and its
    `pr-state` lines; run 245 has the RECLAIM/EXPIRE region and the spawn paths' refusal; run 274 has wave 3's
    operator-choice section, then what its plan names. The second to land merges main, re-stamps and re-runs the
    citation cases, cite-remeasure and the `_reg_get` census. A worker whose edit must leave its region asks first.
- **2026-10-06 07:24 — fix round 1 done at `21d510f6`** (wave-done 3649; four commits on `3373287e`; no merge of main).
  - **What landed:**
    - R1: the Linux-only cases force Linux, and the live-unit row stubs launchd.
    - R2 → 3964: the `worktree` resume asks the `in-use` probe and never kills. A pane that came back counts as a
      cwd user.
    - P4 → 3965: one hunk in CCR-15's passage. The contract carries no such sentence.
    - The text fixes P1–P3 and P5–P8, and R3's precondition row.
  - **Re-measured:**
    - The tip matches the claim, and the four required checks are green (CI 37424981281).
    - #286 still merges clean onto `9221416a`.
    - All six of review 284's macOS reds are gone. test-macos 1/2's one red is main's `ccrc-update` D3 case
      (wave 11). probe-macos's platform-hazards red is main's. Neither gates.
  - **Run state:** the run went to `awaiting-review`, with its items already settled.
  - **Acceptance review 288** was dispatched to `ccrc-pwa-soft-meadow`, with the held-out panel named. #286 merges
    on its verdict.
- **2026-10-06 08:29 — review 288 accepted wave 3; #286 merged** (`77c11245`, 08:28; review-done 3654, reviewed tip
  `21d510f6`; report copied on receipt).
  - **The verdict:** 33 agents, none unverified; 7 confirmed, all minor, and 3 refuted. Nothing touches what the verb
    deletes or when. All 24 mutation rows red as named, and the forced-linux and launchctl controls are green on Linux
    and red under Darwin semantics. Every suite is green.
  - **Accepted at `21d510f6`, with no further round.** The verb is inert until 3b calls it, so the residue carries.
    **Review 288's F1–F7 are 3b's FIRST commit:**
    - F1: the CONTROL's unit half is hollow. Plant an active unit, or drop "and the unit" from its title.
    - F2: D-3964 and the resume header say that a pane that came back is a cwd user.
    - F3: 3964 gets its mutation row in the plan (W1, verb 2).
    - F4: CCR-15's qualification adds "or a breadcrumb that stands but cannot be read" (D-3894), inside the :780
      passage only. Child reclamation's coordinator is told before it is pushed (mail 3655).
    - F5 and F6, ruled: the plan's as-built rows are CORRECTED TO THE MEASURED COUNTS (M08 ladder 17, M26 verb 3), with
      a note that review 284 quoted 1 and 2. A measured count beats a quoted one.
    - F7: `close_time`'s list adds U+0085, or says "among them".
  - **Carried to 3b's operator text, beside R4:** a process that ignored the first attempt's SIGHUP (a `nohup` dev
    server, say) holds a `worktree` resume at `in-use` on every pass until a human ends it.
  - **Runs:** 245 advanced to `merging`, then closed final (`merged`). Its child workspace is queued for
    reclamation. Run 290 opened FIRST, planned: 3b is the run's wave 4 of 5, and the dead-coordinator lane is wave 5.
    Block 4114–4125 was issued, written bare.
  - **Overlaps after the merge:** main's `ccd/ccd` moved, so #248 (landing wave 3, in acceptance review 289) and run
    274's branch now conflict on it (merge-tree). #248 merges main after review 289's verdict, never during it. Run 274
    merges main when it lands, by the shared-region ruling. Child reclamation's wave 6 is clear to dispatch (3655).
  - **Deploy:** AGENT-FIRST, by ccrc's updater, never by hand. The time both boxes reach the build containing
    `77c11245` is recorded here, and 3b's lane waits on it.
- **2026-10-06 08:33 — wave 3b planning started** (workflow wf_45bc20c3-008: Opus drafter, four Opus lenses for spec,
  deletion safety, replay and test honesty, an Opus reviser and a Sonnet replay verifier). The plan goes to branch
  `docs/workspace-lifecycle-wave3b-plan`. The coordinator's rulings for it:
  - **(A) The first commit** is review 288's F1–F7, as the 08:29 entry rules them.
  - **(B) The precondition** is closing 3893's return-verb race. No interleaving may let an expiry act on a row that a
    return verb (start, enable, ensure, swap or ws-restore) has passed its reap gate for. The worker either holds the
    gate across the journal line or clears the archive inside it, whichever is smaller, measured. A test forces the
    interleaving.
  - **(C) The server never types the threshold.** `ws-audit --expire` gains `expiresAt`, on `expirable` and on
    `not-expired`, and sets `archivedAt` on `not-expired` too. An absent key is no evidence, so the lane composes
    nothing for that row. The deploy is therefore AGENT-FIRST (ccd), then server and pwa.
  - **(D) The lane** is `archivedExpiryVerdict` in its own L1 file, plus a second population in the reclaim sweep
    with its own map, clocks, feed and attention entries, invisible to wave 5's chip. It audits, then calls the verb
    with the audit's token. It acts only on `capSupported(EXPIRE_CAP)`. It tells box words from composition errors.
    Its word map is held equal to ccd's. It composes at most one `ws-expire` per tick, fleet-wide.
  - **(E) The lane ships SHADOWED.** Until `$REG/expire-lane-live` exists, it audits and records "would expire" but
    never composes the verb. That file has no writer in the tree, which is pinned beside `stall-watch-live` and
    `scope-sweep-live`. `reclaim-paused` stops everything. The reason: 29 of today's 30 archived rows on the fleet
    box are past seven days (review 284's R4 measurement), so the first armed pass faces that backlog. **Arming is
    the operator's.**
  - **(F) The switch and the words.** `reclaim-paused` is the one cleanup switch, and the banner label widens. CCR-15's
    §6 item 1 text touches only its `reclaim-paused` passages; child reclamation's coordinator is told before the
    push. The rest are coordinator clause 3's move with its verbatim pin, README, wave-lifecycle §6 and the confirm
    copy. None of this text lands before the live arm.
  - **(G) Operator text.** A standing `in-use` is expected. After bounded passes it becomes an attention entry that
    names the pid, its comm and the path. It never says "end the pid" without naming the process. The lane never kills.
  - **(H) Carried items taken:** the 409 detail; the 404 fold; FM7; the door's `already archived` reading; ws-reap's
    fresh arm on an unreadable breadcrumb; ws-gc's advisory lines. **Not taken:** ws-reclaim's word for an `expire:`
    breadcrumb (both readings are retries).
  - **(I) Overlap.** #290 (child reclamation wave 5) edits the sweep and banner files, so the plan is re-verified on
    main after #290 merges, before dispatch. `ccd/ccd` is shared by region.
- **2026-10-06 09:18 — a security finding against the 3b draft, binding before dispatch.** An automated commit review
  flagged a MEDIUM JSON injection in the plan drafter's prototype of ruling (G) (workflow worktree, `proto T3 green`),
  not in main.
  - **The flaw:** the cwd probe's python emits `pid<TAB>comm<TAB>path` lines, and bash splices `$pid` raw into an
    `EXPIRE_IN_USE` JSON array. A newline in a cwd path, or in a process's `comm` (both set by whoever owns the
    process), splits one record into two, and the second record's "pid" is attacker-chosen text inside the JSON.
  - **Reach:** none to a deletion. ccd re-measures every rung, rung 5 included, under the reap lock, and the token is
    ccd's own. The reach is the integrity of the audit document the lane will parse: a forged key, or a malformed
    line read as unmeasured.
  - **Main is not affected.** Its probe emits `pid<TAB>path` into prose only.
  - **RULED, binding on the 3b plan:**
    - python emits each record already JSON-encoded (`json.dumps`, pid as an integer, strings decoded with
      surrogateescape), one per line, or the whole array at once;
    - bash never splices a field;
    - a pid that is not `^[0-9]+$` makes the probe unmeasured;
    - a fixture whose cwd path and `comm` carry a newline, a tab and a quote yields one record, valid JSON, with the
      exact bytes;
    - each guard has a mutation row.
  - **The returned plan is checked for this before dispatch,** and amended if it carries the spliced form.
- **2026-10-06 20:21 — wave 3b's plan is ready:** branch `docs/workspace-lifecycle-wave3b-plan` at `335c0e7c` (5,694 lines,
  12 tasks, 12 departure slugs). It was made by workflow wf_45bc20c3-008, whose 7 agents all returned. The
  reviser applied 24 findings and rejected 4, each with a reason. A Sonnet verifier replayed all 117 blocks onto
  `b27fabc15` (#290): 114 matched exactly once and 3 needed a re-anchor by content, as the plan predicted. All 14
  mutation rows it ran went red. The plan has no stray D-tokens and no docserver URLs.
  - **The security ruling of 09:18 is built in** (Task 3, rows T3.4 and T3.5): `json.dumps` at the source, pid as an
    integer, and a non-digit pid is unmeasured.
  - **3893 is closed by "a return clears the archive inside its gate"**, measured smaller and safe on all five
    verbs. Holding the lock across the journal line breaks every supervised return.
  - **CORRECTION to ruling (E)'s figure:** review 284's R4 "29" counts rows with no process in their tree, not rows
    past seven days. The plan measured the backlog read-only: **20 of 30 archived rows past seven days at 09:34 UTC,
    22 at 18:56.** The ruling stands: ship shadowed.
  - **Rulings on its coordinator questions:**
    - (4) child reclamation's 3657 and 3666 were answered in 3749. 3b edits none of the shared tail, containment,
      ladder or platform. `_ws_expire_cwd_users`' header is wave 6's and its body is 3b's.
    - (5) the sibling pass is ACCEPTED as ruling (D).
    - (6) the plan is re-anchored onto main after #290. A Sonnet agent is doing it now, with the two stale counts.
    - The five plan-only departures reach spec §5.2 and §5.3 in Task 12.
    - Q1's docs half: README, clause 3 and wave-lifecycle §6 state the arming condition, so they are true before and
      after arming.
  - **For the operator:**
    - the PWA confirm copy before arming;
    - the first armed pass (about 20 expiries, at most one a pass), or raising `WS_EXPIRE_AFTER_S` first;
    - whether to end brisk-mesa's leaked test tmux server before arming.
  - **Wave 3's deploy:** the fleet box runs v0.0.105 (`b27fabc1`, which contains #286) since 19:03 UTC. v0.0.96 is
    the first release containing it.
  - **Child reclamation wave 6** (run 291, plan #293) changes shared code that `ws-expire` runs: F6's GIT_CONFIG
    strip, `_ws_leaf_remove`, the bounded temp-root wait, the token's `branchState=`, and the gone-directory recovery
    (expire breadcrumbs are not evidence). All of it is AGREED under the 3622 rule (3749).
- **2026-10-06 22:08 — wave 3b's plan is PR #308** (`bd73ed31`, 5,840 lines, 12 tasks).
  - **Re-anchored on main `8d85c7cf4`** (#290, #284, #302, #303, #304): all 123 blocks match exactly once, and the
    stated counts were re-measured there.
  - **The coordinator's rulings are written into the plan:**
    - its Open questions 4–6 and pre-flight 16 are marked answered;
    - Task 8's README, clause 3 and wave-lifecycle §6 state the arming condition;
    - Task 12 Step 2 carries the five plan-only departures into spec §5.2 and §5.3.
  - **Ruled:** the skill files state the arming condition in words and never name `expire-lane-live`, because a
    session told the marker could arm a deletion (the existing pin). README and the spec name the file.
  - **The brief and dispatch body are ready:** twelve items; route Opus · high, Sonnet subagents, workflow off,
    compact 40; numbers 4114–4125 in the plan's slug order. Run 290 dispatches when #308 merges.
  - **Wave 3's deploy dependency is met:** the fleet box's ccd (v0.0.105) carries `expire-v1`, and 3b composes
    against it.
- **2026-10-06 22:28 — #308 merged (`67657ef2`, 22:27); wave 3b dispatched** (run 290 → `ccrc-pwa-calm-basin`; worker skill
  present; route Opus · high, Sonnet subagents, workflow off, compact 40; twelve items, one per plan task).
  - **The workspace branch** is at origin/main `67657ef2`, with nothing ahead, and it contains #308.
  - **The caps at dispatch:** 23 of 24 daily and 6 of 7 concurrent.
- **2026-10-07 05:02 — wave 3b done: PR #312 at `3990aaad`** (wave-done 3794, `ccrc-pwa-calm-basin`; 17 own commits plus two
  merges of main, afbb7767d (#299) and 359f76030 (#248, #310); each merge conflicted only on ccd/ccd's stamp line).
  - **Re-measured:** the branch tip, the PR head and the handoff commit agree at `3990aaad`, and #312 is open and
    MERGEABLE. Run 290 advanced dispatched → working → awaiting-review.
  - **The worker reports `suite: red`, `failure: unclear`.** The only reds are the two known ones (tmp-sweep "FAILS
    CLOSED", session-hook "skips a scratch slug" under a non-/tmp TMPDIR), each red again in isolation and neither
    this wave's. Everything else passed: 528 server files, agent 465, pwa 1670 and 1647, pwa tsc.
  - **Deviations:** 4114–4125, all defined, with a continuation line on 4124 (the idle re-read).
  - **Five named departures:**
    - T6's extra test;
    - T9's idle re-read at the act;
    - T11's "once the lane is armed" wording;
    - the final review's eligibleSince reset (a pause only the executor saw forgets the sighting);
    - single-definition's adjacency after absorbing #299.
  - **Four items the worker parked, for review and then a ruling before arming:**
    - learn starvation: an unreadable learn audit is retried every pass with no backoff, and learn slots go in
      registry order. The final review grades it fix-before-arming;
    - the archive-confirm copy, which is unconditional while the lane is shadowed;
    - clause 3's missing "no child marker";
    - the dropped `resumable`.
  - **Review run 313 is dispatched** to `ccrc-pwa-brisk-basin` (the held-out panel; route Opus · high, Sonnet
    subagents, workflow on). The brief's suite list is `.superpowers/sdd/coordinator-evidence/run290/review-suites.md`,
    and the worker's two artifacts are copied beside it.
  - **Child reclamation's coordinator (calm-mesa) was told in mail 3796** that #312 edits CCR-15's §5.8 and the
    wave-3 qualification (ruling (F)). It landed after the push, not before it, but before any merge.
- **2026-10-07 06:01 — wave 3b ACCEPTED and MERGED: #312 → `9b074208` (06:00:41), with no fix round.**
  - **Review 313** (`ccrc-pwa-brisk-basin`, workflow wf_53450d64-096, 36 agents, no lens unverified) read
    `3990aaad`. Its report is copied to `.superpowers/sdd/coordinator-evidence/run290/review-313-3990aaad.md`.
    - Deletion safety holds on every path. Each `ws-expire` passes `capSupported` twice, the cleanup switch twice, a
      store re-read, presence, a same-archive audit with its own token and a known instant, the live file read
      nearest the argv, and ccd's in-lock re-proof.
    - 3893 is closed on start, enable, ensure and swap, and ws-restore's lock spans its unarchive.
    - Seven confirmed findings, all minor, and three refuted. All 37 mutation rows were red, and every suite in the
      brief was green.
  - **Why no fix round:** while shadowed, the lane composes nothing. What is left is the shadow record's fidelity
    and wording that must be settled before arming. This is review 288's precedent: wave 3 was accepted while its
    verb was inert, and its residue became 3b's first commit.
  - **The merge:**
    - #312's PR CI ran on a merge ref that already held #309, the only main commit since the branch's last merge.
      Every required leg was green; only the macOS legs were red, and they gate nothing.
    - `git merge-tree` was clean. It landed with `--squash --admin --match-head-commit 3990aaad`, because the
      queue is off since Task 7's rollback.
    - Run 290 went merging → closed final with `prPhase: merged`; its child reclaim is queued.
    - The worker was told in 3799.
    - Child reclamation's coordinator found no conflict in substance with run 291 (3797). Its merge-tree against
      `ws/amber-river` conflicts only on the ccd/ccd stamp and README's `shared/api.ts` anchors, both second-lander
      work.
  - **RULED — wave 4's FIRST commit is review 313's residue and the arming blockers:**
    - **Parked item 1 (ARMING BLOCKER):** a learn audit that is unreadable, or answers `archivedAt: null` (a ws-reap
      breadcrumb's `reap-in-progress`), backs off and is reported on the expiry attention list. Learn slots go in
      `nextAskAt` order, not registry order.
    - **Parked item 4 (ARMING BLOCKER):** `ExpireVerbRead.failed.resumable` is carried through the outcome type
      rather than narrowed. A wrong-row `expired`, an unknown refusal word or `probe-unmeasured` reports and stops
      at once, never after the one-hour ceiling.
    - **F1 (ARMING BLOCKER, the shadow record is the operator's arming evidence):** an ineligible sighting clears a
      `would-expire` or `in-use` report as well as a `held` one, so the attention list follows the row.
    - **F2:** the executor checks `audit.archivedAt` against the queued archive before classifying a refusal.
    - **F3:** the `held` sentence says "past its expiry (due <instant>)" and never types seven days.
    - **F4:** `wsExpire`'s doc comment drops "Composed by nothing in this build".
    - **F5, ruled:** the final review's eligibleSince reset gets a continuation line in the 3b plan's Deviations
      found, under 4117, as 4124's fix-round change did. Naming it in a brief is not the plan's record.
    - **F6, ruled:** amend spec §6 item 6 and §5.3's "hosts a second population" sentence to the sibling pass
      (4118) now, in the residue commit. Do not carry it further.
    - **F7, O1, O2:** correct the 3b plan's recorded rows: T7.2 now reds 1 of 23, because the executor-side reset
      also forgets the sighting, and T3.5 reds 4. Make 4124's main line true on its own.
    - **Parked item 3:** coordinator clause 3 gains "when it carries no child marker", with its verbatim pin.
  - **For the operator, before arming** (touching `$REG/expire-lane-live` by hand is the operator's act alone):
    - (a) wave 4's first commit merged and deployed: the three blockers above;
    - (b) the archive-confirm copy (parked item 2): both confirms say "after that it is cleaned up", which is false
      while shadowed, under `reclaim-paused`, and on a box without `expire-v1`. It errs safe, because it overstates
      a deletion. The coordinator's recommendation: hedge it in wave 4's residue commit to a sentence true before
      and after arming, as the docs already are. The text is the operator's (plan Open question 1);
    - (c) the first armed pass faces the backlog (20–22 of 30 archived rows past seven days, at one expiry a pass),
      or raise `WS_EXPIRE_AFTER_S` first;
    - (d) whether to end brisk-mesa's leaked test tmux server first.
  - **Run 314 is open** (planned; the run's wave 5 of 5), with block 4348–4363 (sixteen numbers: the residue's
    behaviour changes plus the dead-coordinator lane).
- **2026-10-07 06:05 — wave 4 planning started** (workflow wf_07ea3938-e5a: an Opus drafter, four Opus lenses for spec, act
  safety, replay and test honesty, an Opus reviser and a Sonnet replay verifier). The plan goes to
  `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md` on branch
  `docs/workspace-lifecycle-wave4-plan`. The coordinator's rulings for it:
  - **(A) The first commits** are review 313's residue and the expiry lane's three arming blockers, as the 06:01 entry
    rules them. The archive-confirm copy (parked item 2) is one separate task the brief can strike, because it is the
    operator's text.
  - **(B) The lane ships SHADOWED.**
    - Until `$REG/dead-coordinator-lane-live` exists, the lane measures, keeps its anchor, trips its breaker, and
      records "would end programme X". It never calls the abandon arm.
    - The file has no writer in the tree, pinned beside `expire-lane-live`.
    - `reclaim-paused` stops the lane entirely.
    - The skill files state the arming condition in words.
    - The reason: once armed, the lane ends other coordinators' programmes and gets their workers' workspaces
      reclaimed, losing a turn mid-flight. This is the precedent of the scope sweep and the expiry lane.
  - **(C)–(H) are spec §5.4 as written:**
    - the verdict is widened in one place;
    - a crash and only a crash, with one journal reader, where an unreadable journal is unmeasured;
    - the durable hour, its anchor only ever raised, measured on two passes;
    - the circuit breaker, evaluated in shadow too. Its clear is the smallest act the box-token census allows, and
      a new door is an open question;
    - no successor: the act runs on the coordination serialiser, compare-and-set on `claimedBy`, with a forced
      revive test;
    - `causedBy: 'sweep'`, additive.
  - **(E) The migration:** the plan measures what a rolled-back older server does on meeting the new `user_version`,
    and chooses a shape that keeps a rollback bootable.
  - **(H) Landing:** a `sweep` close reads as an operator abandon, with a test. Landing-order's ledger now carries
    that constraint; spec §6 said it already did, and it did not.
  - **(I) Relations:** the stall watch's coordinator-deaf arm notifies, and this lane acts. Neither double-reports
    one dead coordinator as two incidents. It is a sibling pass on the child lane's tick.
  - **(J) Overlaps:** child reclamation wave 6 (run 291), ccrc-history (run 302; claims 1065, 1066 and 1068) and
    centralised update W15 (run 300). There is a re-measure-at-dispatch note, and ccd/ccd is shared by region.
  - **Departure: the plan is Markdown, not HTML.** That is the operator's standing preference since 2026-10-06, but
    this repo's `deviation-refs` guard and the ledger floor seed (`server/src/coord/ledgerseed.ts`) read only `.md`
    plans. An HTML plan's D-numbers would be invisible to both.
- **2026-10-07 19:26 — wave 4 plan drafted, reviewed and revised; re-basing onto #320.** Workflow wf_07ea3938-e5a returned
  plan commit `3f581396` on `docs/workspace-lifecycle-wave4-plan` (6422 lines, 14 tasks, 134 replay blocks, 120 mutation
  rows, 20 departure slugs). The four lenses:
  - **Act safety** found one critical gap and four important ones, each measured on the drafted policy file:
    - the journal clause trusted a mirror it cannot trust (unavailable, gapped, or a failed ccd append);
    - the breaker forgot its cluster after one unmeasurable read;
    - a revive seen by the executor reset nothing;
    - the compare-and-set cannot see a same-id revive, and the forced-interleaving test raced a writer the serialiser
      already excludes;
    - in shadow only the longest-dead claimant was ever listed.
  - **Spec** found the breaker's fleet-wide arm narrowed, §9's stage-4 measurement row missing, `resume.md` false once
    the lane is armed (ruling B's "in words"), and ruling (I)'s coordinator-deaf relation unanalysed.
  - **Test honesty** found the shadow-time pause, the unreadable journal at the lane and the executor, and the landing
    pin vacuous.
  - **Replay** reproduced every count.
  The reviser applied all 22 findings. It rejected two only in their exact form, each replaced by a stronger measured
  guard (the failed-append rule became durable, by the errors file's mtime against the last successful spawn).
  - **The verifier:** clean on its base `282e79e44` (134 of 134 anchors, every count, 35 of 35 rows red, 0 new
    D-tokens, 0 docserver URLs). NOT clean on main `7f7bf4afc`: #320 (stall-watch-settings wave 1) took
    `user_version` 16 → 17, and 6 anchors miss. Workflow wf_25f19b4a-cf7 re-bases it: migration to slot 18, Task 6's
    mail-routes block re-anchored, #320's effects re-checked, then a fresh replay.
  - **A second block, 4430–4433,** is issued to run 314 for the four slugs past 4348–4363. The brief names all twenty;
    the plan stays slugs-only.
  - **Rulings on the reviser's open questions:**
    - A one-tap breaker-clear door is not this wave. The breaker clears through the existing doors; a new
      session-gated door is a later candidate.
    - The recommended arming order: the expiry lane first, once wave 4's blockers are deployed and its shadow list
      read; then the dead-coordinator lane, after its own shadow list and any breaker trip are worked through. Arming
      stays the operator's.
    - Task 5, the confirm copy, stays and is droppable; the operator may strike it before merge.
    - The journal-gap trade is accepted: a coordinator whose last successful spawn is not newer than a recorded gap
      stays listed as unmeasured, never ended, until it spawns again. Ageing a gap out is carried, for a decision on
      shadow evidence.
  - **The ops notice (mail 3889, acked).** On 10-07 the operator expired 15 archived workspaces by hand (8 ccrc-pwa,
    7 expoAI-assistant; `CCD_EXPIRE_BY_HAND=1`, actor operator; 0 refused; residueBytes 0 and secretsDropped 0
    throughout; one wip commit, expoAI-assistant-still-river). The server composed none; these are the first live
    `ws-expire` runs, and the arming evidence for 3b. They also cut most of pre-arming item (c), the backlog.
    `ccrc-pwa-brisk-mesa` was skipped: a stray 09-14 `tmux -S /tmp/tmuxtest_verify` server holds it. The operator ends
    that server and re-runs, which is pre-arming item (d).
  - **Carried (a candidate, not this programme's wave):** run 245's 9.7 GiB TMPDIR leak came from mkTmp fixtures
    cleaned only in `afterAll`, so a killed vitest run leaks them all. Cleanup on exit or SIGTERM in the test helpers
    would stop a repeat.
- **2026-10-07 21:21 — wave 4 plan MERGED: #323 → `8c446eab` (21:20:21), re-based on #320.** Workflow wf_25f19b4a-cf7:
  - **The re-base:** Opus, on `7f7bf4afc`. The migration moved to slot 18, and the coord-db describe now finds its slot
    by DDL, as #320's does. Task 6's union is mail-routes' fifteenth. Pre-flight finding 9 was rewritten: the stall
    watch's push gate is now one resolution, `resolveStallWatch`, files under Follow, a Settings level otherwise.
    coordinator-skill is 161.
  - **The replay:** Sonnet. 134 of 134 anchors match once; every count and both reds agree; 21 rows red; the guards
    green; 0 new D-tokens, 0 docserver URLs, 0 D-TBD sentences.
  - **CI:** #323 green, including all four server shards and `test (server)`.
  - **Run 314's dispatch REFUSED `cap-daily`** (24 of 24, fleet-wide). The brief names 4348–4363 then 4430–4433 against
    the plan's slug order, with the live claims of run 322 and run 302 and the 409 rule. A retry re-measures the oldest
    in-window dispatch before each try (first age-out 22:20:17, run 307) and stops on any other answer.
  - **Wave 3b is deployed.** Both boxes report v0.0.119 (`7f7bf4afc`, which contains #312): the fleet box by
    `ccrc version`, the server by `/health`. The lane runs shadowed. Its feed holds "archived workspace would be
    cleaned up" rows for 18 distinct workspaces since 10-07 10:19, re-recorded after each server restart, as its
    in-memory list is designed to be. No `ws-expire` was composed.
- **2026-10-07 22:28 — run 314 DISPATCHED → `ccrc-pwa-swift-cove`.** The brief was queued; the workspace was
  freshly spawned; the worker skill was present. The retry lost the 22:20 age-out to another coordinator and took the
  22:27:47 one. Route: Opus · high, workflow off, compact 40, Sonnet implementers, an Opus act-safety reviewer per task.
  14 items.
- **2026-10-08 00:49 — run 314 asks about a claim it does not hold; ruled (b) with a merge gate; one number issued.**
  swift-cove (mail 3948, progress: Tasks 1–12 committed locally, each with an Opus per-task review) asked whether it may
  append two describes at the end of `server/test/single-definition.test.ts` — Task 3's type-no-period pin and Task 13's
  dead-coordinator no-writer pin — while run 302's claim 1094 holds that file (its mail 3942 to soft-delta sat
  undelivered behind a busy gate). Ruled (mail 3949): not without the holder's consent, which is run 302's to give,
  not this programme's; the plan's overlap text (ruling J) settles how the appends merge, not whether a live claim may
  be crossed. The pins stay staged and land, appended and adjacent, as their own commit once claim 1094 is released or
  lapses or consent is forwarded; if they are still out when the rest is done, the PR and the wave-done say so, the
  review goes ahead, and the merge waits for that commit and a scoped re-review of it. No relocation to another file.
  Consent asked of run 302's coordinator `ccrc-pwa-quiet-ridge` (mail 3950). The worker's new departure — a hold no
  longer overwrites a final or terminal expiry report (a Task 2 review fix) — was issued 4454 by the allocator.
- **2026-10-08 00:50 — consent given; the merge gate is lifted.** `ccrc-pwa-quiet-ridge` answered (mail 3951): run 314 may
  append both describes at the end of `single-definition.test.ts` under claim 1094, on two conditions — no existing
  line changes, and the second lander merges `origin/main` (never a rebase) keeping both sides. Measured on their side:
  at `ws/soft-delta` `ebef2fbfe` run 302's only change to the file is itself a 298-line end-of-file append. Forwarded
  to swift-cove (mail 3953); the "pins owed" path and the merge hold of mail 3949 no longer apply; 4454 stands.
- **2026-10-08 01:39 — wave 6's effect on `ws-expire`, measured; item 8 re-ruled; one new arming blocker.** calm-mesa's
  mail 3956 answered the carried question ("widened") and named two more `ws-expire` effects of wave 6. A read-only
  workflow measured all three (3 Opus finders, a Sonnet refuter each; every serious claim upheld, two line numbers
  corrected). Re-ruled under Carried constraints: the widening is kept in the attic (not a blocker); `_ws_expire_cwd_users`'
  newline fail-open is an arming blocker; the kept-leaf silence is a follow-up. Findings for wave 6's own fix round went
  to calm-mesa as mail 3961: `_ws_path_users` unfixed at the tip, a new wrong-target site in `_ws_leaf_remove`, a
  new-word skew loop, a never-terminal tail retry. Its answer on the shared helper is pending.
- **2026-10-08 01:44 — calm-mesa answered 3961 (mail 3963).** Wave 6's fix round takes all three newline sites through one helper
  (4458), our function included on our consent. It adds `clipsKept`/`tmpRootKept` to the done document (4462). It mints
  no new word. The sweep under Carried constraints is updated, and the next wave owns the kept-leaf reader.
- **2026-10-08 04:37 — run 314 wave-done, re-measured, and at `awaiting-review`; review run 339 opened.** swift-cove's mail 3974:
  Tasks 1–14 done, PR #328, tip `701839b52`, 29 own commits, 0 behind `main`, no merges. Re-measured: the remote branch,
  the workspace HEAD and the PR head all agree; the tree is clean; CI is green on every gating leg (5 server shards,
  `test (server)`, agent, pwa, build-pwa, node floor, typecheck), with the macOS legs red (advisory). Advanced `working` →
  `awaiting-review` on that fingerprint. The worker's evidence is copied to `coordinator-evidence/run314/`.
  - **The worker's report.** Local suite red only on the three known environment and load reds. One Opus review per
    task under the act-safety lens; two whole-branch Opus reviews; one fix wave; a scoped re-review. Eight review fixes
    beyond the plan's text, each pinned. The two single-definition pins landed in `f367a4a9c` under 1094's consent.
    Task 5 is `1b9b4cb5c`. Some subagent commits carry a Sonnet trailer, not a finding.
  - **Three items it asks to be decided:** the breaker trips after any lane gap of over ten minutes; the mirror reads
    ok despite a failed generation read; the residual same-id revive. The reviewer classifies them, and this
    programme rules on the report.
  - **Review run 339** (kind review, reviews 314) has its brief and five items. Its dispatch was refused `cap-daily`
    (24/24), and a retry waits for the 05:02:17 age-out. The brief names the held-out panel (`review-panel.md`), the
    act-safety questions, the Task 5 revert measurement and sixteen-plus mutation rows.
  - Claim 1097 was released for CCR-15's spec edits (calm-mesa's 3973; answered by 3976, copied to amber-river by 3977).
- **2026-10-08 08:06 — ws-expire's parser misreads a pre-breadcrumb `state-changed` as resumable (CCR-15 mail 3984).**
  calm-mesa reports the twin of review 335's F3, which run 291's fix round fixed on the reclaim side as 4457.
  `parseExpireResult` (`server/src/archivedExpiry.ts:231`) reads every `failed` word except `probe-unmeasured` as
  resumable. ccd prints `state-changed` (the consent binding changed) before the tombstone and the breadcrumb, so
  nothing has started, yet the lane backs off and retries it, and reports it only past the one-hour ceiling.
  Measured: the line is unchanged at run 314's tip `701839b52`, so wave 4 neither introduced it nor is held by it.
  The lane is shadowed, so nothing acts on it today.
  - **Ruled: an arming blocker, carried to wave 5.** It is parked item 4's class: a failure that will not resume
    reports and stops at once. Wave 5's plan measures whether any ws-expire producer prints `state-changed` after
    the breadcrumb. If none does, the parser reads it as not resumable, as 4457 does, red-first. If one does, the
    reader waits for CCR-15 wave 7's additive `crumb` field. `pin-failed` and `tombstone-unwritable` stay resumable,
    because each has producers after the breadcrumb.
  - The 05:02:17 age-out went to another programme's dispatch (refused `cap-daily` again at 05:02:36). The retry
    sleeps to the next age-out, 08:47:34. Calm-harbor's run 340 and calm-mesa's run 341 also wait on the cap.
- **2026-10-08 10:39 — review run 339 dispatched** to `ccrc-pwa-keen-summit` (brief queued, skill present, no resume).
  The retry lost the 08:47, 09:58 and 10:34 age-outs to other programmes' dispatches before taking the 10:39 slot.
  Run 314 stays at `awaiting-review` on `701839b52` until the review-done arrives.
- **2026-10-08 12:02 — review 339 ruled; wave 4 MERGED (#328 → `669b8305`); run 345 opened for wave 5.** keen-summit's
  review-done 4002 at `701839b52`, the tip unchanged. The held-out panel ran as written: three Opus lenses, a Sonnet
  refute pass per finding, 45 agents, none lost. 13 findings, one important. 35 mutation rows, 34 red, 1 survivor
  (F1). Every finding is safe while both lanes are shadowed, so wave 4 merges with no fix round. Its residue is wave
  5's first commit, as review 313's was wave 4's. The report is `coordinator-evidence/run314/review-339-701839b5.md`.
  Run 339 closed `done`, run 345 opened (planned, block 4480–4495), and run 314 closed merged and final. The worker's
  child workspace is queued for reclaim. The PR body was corrected first: it claimed every review fix had a red, and
  F1 is the exception.
  - **Arming blockers for the dead-coordinator lane, fixed in wave 5's first commit:**
    - **F1 (important):** the lane's wiring of the executor's fresh clock (`watch.ts:4202`) survives mutation. Add a
      lane case where a heartbeat lands between the pass's measure and the act, plus its mutation row.
    - **F2:** in shadow, a crash, revive and second crash writes no second feed row. A sighting that ends the episode
      clears `lastOutcome`. The shadow record is the operator's arming evidence, as review 313's F1 was.
    - **F3:** `sweep-stopped.released` folds a release and a re-hold into one boolean. Carry which act ran and word
      each (an overloaded value at a seam).
    - **F13:** an act that throws after a fleet act, having closed nothing, writes no feed row. Every thrown act
      writes one, naming what is known.
    - **The worker's open item 2:** the mirror reads `ok` after an unreadable generation. A persistent failure must
      be measured and reported.
  - **F4, ruled: the stop keeps its anchor.** A mirror that turns `stale`/`unknown` between the pass and the act stops
    the act like the switch does. The anchor and the run of passes are kept, because the adapter's own contract says
    "a slow mirror never deletes an anchor". The port carries `.hold` as well as `.trust`. This fails safe today, so
    it is not a blocker.
  - **F5, ruled: both texts are true; the spec gains the missing sentence.** The programme row reads `abandoned`, and
    nothing resets it (§5.4's "permanently"). A coordinator revived under the crashed id can still open a new run
    under its fenced slug (resume.md), and that run's programme row still reads `abandoned`. Wave 5 amends §5.4's
    bullet to say both, and its plan measures what the board and `toId:'coordinator'` mail do in that state. Whether
    a new run should reset the row is a new decision: operator question (f).
  - **F6, ruled: re-word 4348's entry** to state the qualified rule (an older ccd's audit with no `expiresAt` reads
    `no-evidence`). This follows the 2026-10-07 ruling that the arm implements the spec's own design.
  - **The plan corrections, in the same commit:** F7 (4454's "none minted" tail), F8 ("twenty" → twenty-one), F10
    and F11 (stale counts), and F12 (write T6.30–T6.33 and the review-fix rows into the plan). F9 sits in a commit
    message that the squash dropped, so nothing is owed.
  - **The worker's open items 1 and 3 are accepted** and go to the operator with the arming question. Item 1 (A-I3):
    a lane gap over ten minutes re-anchors every crashed coordinator together. The breaker then holds, and no shadow
    row is written, until all but one are revived, reclaimed or abandoned. Item 3 (ruling (G)): a same-id revive
    inside the act's last re-measure window, sub-second to one agent round trip, can still lose its runs.
  - **Measured by the reviewer:** Task 5 reverts in one plan hunk with every suite green, so the operator's (b)
    stays cheap either way. Migration 18 rolls back: the base build opens a version-18 `coord.db` and reads it. The
    expiry residue's blockers (T1–T3, 4454, the older-ccd arm) each go red when mutated.
- **2026-10-08 13:12 — #326 merged (`b0647d850`, CCR-15 mail 4011); wave 5's plan is being drafted.** What lands for
  this programme: `_ws_dir_physical` at `_ws_expire_cwd_users`' parent (4458), so that arming blocker clears; check the
  merged lines before arming. The `clipsKept`/`tmpRootKept` keys (4462) are on the tail's done document for both verbs.
  F1's leaf rules reach ws-expire.
  - **The cross-side record (review 346's safety lens, class c), ruled: no code change.** The dead-coordinator journal
    clause counts any non-refused `reclaim` row as deliberate. A child's pre-start `reclaim` `failed`
    `probe-unmeasured` row therefore reads deliberate, and the lane abstains. Abstention ends nothing, so this fails
    safe. Wave 5 states it in §5.4 as an accepted abstention, reachable only by a marked child that becomes a claimant
    or heir before any successful reclaim.
  - **Ruled: the lane's answer to a repeating resumable failure.** After 24 hours of continuous resumable failure on
    one archive, the report becomes final, and the lane stops asking for that archive until the archive changes. The
    entry names the first failure, the attempts and the last detail; it never suggests a destructive verb. A restart
    re-learns, because the lane's memory is in-memory. CCR-15 wave 7's shared terminal word maps to not-resumable when
    it arrives.
  - **The kept-leaf reader's lean:** a kept word raises an attention entry. An absent key (an older ccd) reads
    unmeasured and is recorded in the feed row only, so the rollout skew does not alarm on every expiry.
  - **The plan:** workflow wf_36dce1c9-36e. An Opus drafter prototypes on `origin/main`, with four Opus lenses (spec,
    act safety, replay, test honesty), an Opus reviser and a Sonnet replay verifier. The plan is
    `docs/superpowers/plans/2026-10-08-workspace-lifecycle-wave5-residue-and-expiry-follow-ups.md` on branch
    `docs/workspace-lifecycle-wave5-plan`. B4, the in-lock window close, edits ccd, so the wave is AGENT-FIRST.
- **2026-10-08 20:00 — wave 5's plan is drafted and verified. CCR-15's overlap questions are answered (mail 4036). The
  expiry lane never strands a row.**
  - **The plan:** workflow wf_36dce1c9-36e, seven agents over 6.7 h. The draft is `30fae386e`. Four Opus lenses (spec,
    act safety, replay, test honesty) reviewed it, and the revision `30b841c01` applies every finding and rejects
    none. The Sonnet replay verifier says PASS:
    - all 119 anchors matched on `origin/main` `226bb881c` (docs-only drift);
    - every count agreed, and 20 of 20 mutation rows went red;
    - there is no new D-number and no docserver URL.
    It has 13 tasks and 14 departure slugs against the 16 numbers.
  - **Correction to the 12:02 entry (F5): "nothing resets it" is measured false.** In a fixture store, the next close of the
    programme's last open run rewrites the row to `done` or `abandoned`. Question (f)'s framing in the Next-wave brief now
    says so.
  - **Restated: review 339's accepted item 3 window.** Wave 5's Task 6 reads the journal's trust before the claimant's
    measure, so the claimant's tmux measure is now the last awaited step before the commit. The window narrows; it
    never widens.
  - **CCR-15 mails 4014 and 4033, answered in 4036.** Wave 7 is ruled as CCR-15's contract §14 (R65–R72), and its wave 8
    (run 348) is in pre-flight. CCR-15's R69 asks this lane to adopt wave 8's persistent tier or to state the stranding.
    - **One word reader, two carriers.**
      - Wave 5 exports `keptLeafWord`: ccd's three words, with any other value read as `unmeasured`.
      - CCR-15 wave 8's mirror carrier (word | unreported | truncated) imports it.
      - Wave 5's done-document carrier keeps null (removed) apart from absence (`unreported`). The done document prints
        null, so folding the two would narrow a distinction the adapter received.
    - **Ruled, revising the 13:12 ruling: the expiry lane never strands a row in-process.** After B3's day of
      resumable failures, the row moves to a persistent tier: one ask every 4 h, never stopping. The attention entry
      stands until an attempt completes or the archive changes. A row parked at +∞ behind an expire breadcrumb would
      need a server restart once the cause was fixed, and the operator prefers tolerance to freezing. Today's parser
      reads `containment-refuted` as resumable (CCR-15 wave 7 pins that), so the word reaches the tier after a day.
      Attention at once for it (CCR-15's `stuck` class) is wave 6's.
    - **Ruled, so operator question (h) is withdrawn: a failed `state-changed` audits afresh,** which is the reclaim
      side's meaning of "not resumable", rather than reading final. Its one expiry producer (B4) prints before the
      breadcrumb, so nothing was deleted. The entry forgets its token, and a later audit mints a fresh one.
    - **Routed to wave 6, question (k): the resumed arm's `probe-unmeasured`.** On a resumed expiry it prints after a
      standing breadcrumb and reads final, which is `main`'s reading. Wave 6 sets CCR-15 wave 7's `crumb` on
      ws-expire's resumed arm and reads `crumb:true` as resumable. Until then it is an arming blocker for the expiry
      lane.
    - Rung 8's change and the reason cap need nothing here.
    - Order in `server/src/watch.ts`: wave 5 expects to land first, and the second lander merges main (CCR-15's R56).
  - **The revision:** workflow wf_f00582c4-463, with an Opus reviser, an Opus act-safety lens on the delta, an Opus
    fixer if the lens finds anything blocking, and a Sonnet replay verifier. It applies these rulings to the plan
    branch. Then come the plan PR and run 345's dispatch.
  - **The plan's operator questions continue the ledger's letters:**
    - (g) F4's two halves: the plan keeps the run of passes, where the switch resets it;
    - (i) kept entries live until a server restart;
    - (j) B4 refuses a branch made inside the lock as well as one deleted.
    (h) is ruled and (k) is routed.
- **2026-10-08 21:55 — wave 5's plan is revised for the 20:00 rulings, verified again, and in plan PR #333.**
  - **The revision:** workflow wf_f00582c4-463, four agents over 1.9 h.
    - The reviser's `0459dcb73` applies R1–R5: the 4 h persistent tier, the `restart` reading, `keptLeafWord`,
      (k) routed to wave 6, and the prose. There are still 14 slugs, two of them renamed.
    - The Opus act-safety lens on that change found it act-safe on the destructive path. Every re-ask runs a fresh
      audit and spends that audit's token, the lane still composes at most one act per pass, and no sentence names a
      destructive verb. It found one important problem: the would-expire, retry-refusal and in-use arms dropped the
      standing entry and reset its run. The shadow arm replaced the entry with "nothing was deleted", said of a
      workspace that may be part-cleaned.
    - The fixer's `c8861bfc8` adds `standingThrough(entry)`, spread last in every arm that ends no attempt: deferred,
      would-expire, retry refusals, in-use, not-expired and no-evidence. These are rows T10.7–T10.14.
    - The Sonnet verifier says PASS on `origin/main` `21683c0d8`:
      - all 132 anchors matched exactly once;
      - every suite count agreed;
      - every mutation row went red at its own stage;
      - the stamp is `940c0208…fc3b`;
      - server and PWA `tsc` exit 0;
      - there is no D-number and no docserver URL.
  - **Correction to the 20:00 entry: the lane holds no token.** Every act audits first and spends that audit's token,
    so "the entry forgets its token" is implemented as forgetting the learned instant and sightings: the row returns
    to learning. An old server's retry is already a fresh audit.
  - **Ruled, on the fixer's two open questions:**
    - The standing sentence reads "…keeps this entry until an attempt completes, finds that none had begun or stops
      for good, or the workspace is archived again." Accepted: the 20:00 wording was false for `restart` and for
      final verdicts.
    - An in-use refusal under a standing entry stays in its feed row (ccd's detail names the processes). There is
      no new report field; the standing entry keeps the row's one report slot.
  - **The lens's two minor findings are stated in the plan (`f8ec01cc4`) and carried to wave 6:**
    - A `restart` is uncounted. A `state-changed` that recurs (only a racing actor can cause one) composes again
      about every three passes, writes its feed row once, and is never listed: invisibility, not deletion.
    - Task 11's measurement uses a detached HEAD. With HEAD symbolic to `ws/<slug>`, a branch deleted in the window
      ends at the pin as `pin-failed` (resumable), never as `restart`.
  - **CCR-15 mail 4040 agrees.** Its wave 8 Task 1 MOVES `keptLeafWord` to L0 (`shared/api.ts`) as `leafKeptWord`
    once wave 5 lands. Answered in 4045: consent to L0. The word half reads null as `unmeasured`; null → null is the
    done-document carrier's arm. The plan's test now pins that.
- **2026-10-08 22:10 — wave 5's plan merged (#333 → `b2b438d0b`), and run 345 is dispatched.**
  - #333's gating legs all passed, both macOS legs included, at head `f8ec01cc4`. It merged at 22:09 with
    `--admin --match-head-commit`.
  - **Run 345 dispatched at 22:10** to `ccrc-pwa-keen-hollow`, on the first try (`skillState: present`). It has 13 items,
    one per task.
    - Routing is the worker row: Opus · high main loop, workflow off, compact 40; Sonnet · high implementers; an
      Opus · high per-task reviewer holding the act-safety lens; Haiku scouts. Nothing in wave 4's evidence moves it.
    - Numbers 4480–4493 go to the plan's fourteen slugs in order. 4494 and 4495 are held and reported unused.
  - **Claims live at dispatch, named in the brief:**
    - run 347 (`ccd/ccd`, `shared/api.ts`; claim 1113), which Tasks 11 and 9 need;
    - run 320 (`README.md` 1115, `server/src/coord/routes.ts` 1116), which Tasks 7, 12 and 3 need;
    - run 302 (`server/test/session-hook.test.ts` 1117), which the worker only runs.
    The worker claims per task and asks a holder for a region split on a 409. Wave 5's ccd region is
    `_ws_expire_locked` alone, and its `shared/api.ts` edit is one line in `ExpiryAttention.kind`.
  - **Rulings carried in the brief:**
    - `keptLeafWord`'s shape is a cross-programme contract (4040/4045).
    - The standing-entry sentence and the in-use reading are as ruled at 21:55.
    - The two lens minors stay stated, not fixed.
- **Deviation blocks** are minted per wave, at that wave's run-open, by the coordinator. No `D-` number is defined in
  this file.

## Carried constraints

- **CCR-15 wave 3 (#187) and this wave share README's anchor sentence.** Both re-anchor README's four pointers into
  `shared/api.ts`. Whichever lands second takes either side of that one hunk and runs the plan's `readme-reanchor.py`
  (measured: the citation cases and this wave's server files green on the merged tree).
- **`shared/api.ts` is a cited file**, and waves 1 and 2 both insert into it; each pays S6-R11 in its own commit.
- **Stage 3 changes a human-only contract.** `ws-reap` stays human-only; `ws-expire` is a sibling verb with its own
  vocabulary and is never named in the skills (spec §5.3).
- **Landing-order** keys landing entries to runs, and stage 4 can fail a run with `causedBy:'sweep'`; that programme's
  stage 5 must treat it as an operator abandon (spec §6).
- **Stage 3's plan carries three instrument items** from wave 1's review (run 225). These are owed before wave 3
  reads its archive→return delay:
  1. Bind `deploy/measure-workspace-lifecycle.py`'s `RETURN_ACTS` and `ENDS_THE_ARCHIVE` to ccd's `_LC_ACTS` by a
     test. At the least, `expire` joins `ENDS_THE_ARCHIVE`.
  2. Widen its `closedAt` doubt from NULL-only to the server's rule: a non-positive or non-integer close time is
     doubt too. Do it without dropping mutation row S38's anchor.
  3. Make the read-only pin structural by comparing the `-wal` file as well.
- **A follow-up owes the archive door's unreadable-store 409 its detail.** On a store-read failure, the
  `coordinator-has-open-runs` and `run-open` bodies drop `measured()`'s detail, and nothing logs it (base behaviour,
  D-2545). Wave 2 parked it, because the fix reshapes about six replayed assertions.
- **Wave 2's carried follow-ups** (review 240):
  - the archive door reads ccd's `already archived` exit 0 as `archived:true` without checking that a measured-live
    row was stopped (reachable only on a pre-#143 pane never respawned);
  - the base's 404 for an unlistable registry (`knownId` before the 503 ladder) folds "unlistable" into "unknown";
  - Released/Archived fold disjointness rests on `released.ts` alone, and `inReleasedFold` could add
    `!inArchivedFold` (FM7).
  Wave 3 rewrites the archive's end of life, so its plan takes these up or rules them out.
- **`ws-expire` has no recompute-to-pin branch-state check** (CCR-15's coordinator, mail 3939, 10-07, item 8 of
  wave 6's X2 list). `_ws_expire_locked` recomputes the fingerprint inside the lock (`_ws_expire_fork`), then pins
  without re-reading the branch. **Re-ruled 2026-10-08 01:39** on wave 6's reviewer's "widened" (mail 3956), measured read-only at
  `8c0f2cd94` against `origin/main` (wf_00681611-998):
  - **The window widens in the deleted direction only, and more broadly than the reviewer said.** At wave 6's tip, an
    expiry now completes where `main` stopped at `pin-failed` in three cases: a branch deleted inside the in-lock window,
    a branch ALREADY ABSENT at mint, and a branch deleted between the fresh pin and the settle. The pin reads the branch
    three ways and treats a proven-absent one as nothing to pin. A HEAD still symbolic to the deleted branch fails the
    pin, as before.
  - **The work is kept in refs, not reflogs.** Commits, the WIP commit, and every commit the worktree's reflogs name
    are pinned under `refs/ccrc/attic/<id>/*` in the main repo. git gc never prunes those, and only the terminal-only
    `ccd ws-attic --drop` removes them. In the widened cases, ignored and secret-shaped files go with the tree, as the
    standing expiry policy (and the token's digests) says. `main` kept them only because its pin failed.
  - **Ruled: not an arming blocker.** Closing the in-lock window (refuse `state-changed` on present→absent between the
    fork and the pin's branch read) stays a follow-up after #326, reusing wave 6's three-way read. The operator gets
    both behaviour facts with the arming question.
- **ARMING BLOCKER for the expiry lane: `_ws_expire_cwd_users` fails open on a newline-ended path** (CCR-15 mail 3956
  item 2, confirmed 2026-10-08 01:39). It resolves the worktree's parent with a bare `$(cd … && pwd -P)`, and command substitution
  strips trailing newlines. A parent whose physical path ends in a newline then matches no `/proc` cwd, and a process
  inside the tree reads as nobody. This is the expiry's only cwd-in-use guard, and its body is 3b's. Exposure on the
  fleet box today is nil, measured. Wave 6 carries two twins: `_ws_path_users`, still unfixed at `8c0f2cd94` despite the
  review's word, and `_ws_leaf_remove`'s root, a new site that can remove the wrong target. Both went to calm-mesa (mail
  3961) with one question: does wave 6's fix round apply one shared sentinel helper at all three sites (this programme
  consents to that one change to the body), or does lifecycle take its own after #326?
  - **Answered 2026-10-08 01:44 (mail 3963): wave 6 takes all three** through one helper on `_ws_reclaim_resolve`'s sentinel
    idiom, refusing a newline-bearing physical path as unmeasured. In `_ws_expire_cwd_users` only the parent's
    resolution changes, landing on its existing `_ws_reclaim_unmeasured` arm, red-first, one case per site. CCR-15
    defines it as 4458, naming the three sites and this programme's consent. **The blocker clears when #326 merges
    with it**; check the merged lines before arming.
- **ARMING BLOCKER for the expiry lane: a pre-breadcrumb `state-changed` reads resumable** (CCR-15 mail 3984, ruled
  2026-10-08 08:06). `parseExpireResult` at `archivedExpiry.ts:231` treats every `failed` word but `probe-unmeasured`
  as resumable, so an act that never started is retried and reported only after the hour. Wave 5 measures the
  `state-changed` producers. If all print before the breadcrumb, the parser reads the word as not resumable, as
  CCR-15's 4457 does on the reclaim side; otherwise it waits for CCR-15 wave 7's `crumb` field.
  - **Measured by wave 5's plan (2026-10-08 20:00):** `main` has no expiry producer. B4's new refusal is the only one,
    on the fresh arm and before the breadcrumb, and a census of every occurrence in ccd/ccd holds that. **Ruled: it
    audits afresh** (the 20:00 entry). Wave 5 closes this blocker.
- **ARMING BLOCKER for the expiry lane: a resumed expiry's `probe-unmeasured` reads final** (wave 5's safety lens,
  question (k); routed 2026-10-08 20:00). `_ws_expire_locked` prints it at its verdict point on every arm. On a resumed
  expiry it therefore follows a standing breadcrumb, and the tree may be part-deleted, yet the parser stops the lane
  for that archive until a restart. Wave 6 sets CCR-15 wave 7's `crumb` on ws-expire's resumed arm and reads
  `crumb:true` as resumable.
- **ARMING BLOCKERS for the dead-coordinator lane (review 339, ruled 2026-10-08 12:02):** F1, the lane's wiring of the
  fresh clock, has no red. F2: a repeated crash writes no second shadow row. F3: release and re-hold share one
  boolean. F13: a thrown act with nothing closed writes no feed row. The worker's open item 2: the mirror reads `ok`
  after an unreadable generation. Wave 5's first commit takes all five; check the merged lines before arming.
- **Carried (a follow-up, not a blocker): a kept leaf is silent.** When ccd's shared tail keeps clips or the temp
  root, `ws-expire` still prints `expired`. The server records "cleaned up" and raises no attention entry. The keep
  lives only in the journal row's `detail`, which no PWA surface renders. CCR-15 is asked for additive
  `clipsKept`/`tmpRootKept` keys on the done document. The server reads them into an attention entry in this
  programme's next wave. Also on the CCR-15 side: if F1 mints a new nested word, `ExpireToken` gains it in the same PR,
  or it reuses `containment-unproven`. Otherwise the audit reads `unreadable` and re-audits every pass through the
  rollout skew. And the tail's moved-tree arm retries hourly forever, never terminal.
  - **Answered 2026-10-08 01:44 (mail 3963).** The done document gains `clipsKept` and `tmpRootKept` (CCR-15's 4462, in wave 6's
    fix round), each the kept word (`refused`/`unmeasured`/`in-use`) or null. An older ccd omits both, so absence
    reads as unmeasured. `parseExpireResult` reads named keys only, so agent-first stays safe. **The reader and its
    attention entry are this programme's next wave.** No new word: rows in a leaf refuse `containment-unproven`
    (4455), which `ExpireToken` already holds as terminal. The never-terminal tail retry stays as written (fail-closed).
    The expiry lane's answer to a repeating resumable failure is this programme's. A shared terminal word is raised at
    CCR-15 wave 7's pre-flight, beside its carried "persistent per-child failures that retry for ever".
- **SAFETY.** Never a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`, `~/.cc-limits`
  or `claude-session@*.service` directly; fixture HOMEs only in tests; `gh` stays off the exec whitelist; never print
  secret contents.

## Next-wave brief

Waves 1, 2, 3, 3b and 4 are merged: #229 `a7b9831c`, #233 `fe7b9775`, #286 `77c11245`, #312 `9b074208` and #328
`669b8305`. Both lanes ship SHADOWED. The expiry lane records "would expire" and composes no `ws-expire` until the
operator creates `$REG/expire-lane-live` by hand. The dead-coordinator lane records "would end" and closes nothing until
the operator creates `$REG/dead-coordinator-lane-live` by hand.

**Wave 5 is run 345** (dispatched 2026-10-08 22:10 to ccrc-pwa-keen-hollow; the run's wave 6 of 6), with numbers 4480–4495, written bare. Its plan is
`docs/superpowers/plans/2026-10-08-workspace-lifecycle-wave5-residue-and-expiry-follow-ups.md` on
`docs/workspace-lifecycle-wave5-plan`. It was revised for the 20:00 rulings and verified again (the 21:55 entry,
head `f8ec01cc4`), and merged as #333 (`b2b438d0b`). The brief is in the 22:10 entry.
- **Its FIRST commit is review 339's residue,** as ruled in the 2026-10-08 12:02 entry. First the dead-coordinator
  lane's arming blockers: F1, F2, F3, F13 and the worker's open item 2. Then F4, F5's spec sentence, F6's entry, and
  the plan corrections F7, F8, F10, F11 and F12. Review 339's report is
  `.superpowers/sdd/coordinator-evidence/run314/review-339-701839b5.md` in the coordinator's worktree.
- **Then the expiry lane's follow-ups:** the kept-leaf reader (`clipsKept`/`tmpRootKept` become an attention entry, and
  an absent key reads unmeasured); the `state-changed` reading (Carried constraints, 08:06); the lane's answer to a
  repeating resumable failure; and the ws-expire in-lock window close, reusing CCR-15 wave 6's three-way read.
- **Its plan reads main after #326,** which merged 2026-10-08 13:07 (`b0647d850`). That carries the kept-leaf keys (4462) and
  the newline helper (4458). The plan is drafted by workflow wf_36dce1c9-36e (the 13:12 entry).
- **Wave 4 deploys through ccrc's updater** (the operator applies it from the console). Afterwards, check that both
  boxes report v0.0.123 or later, and that the feed shows the dead-coordinator lane's shadow rows.
- **The operator's questions before arming** are (b)–(d) in the 06:01 entry. (b), the confirm copy, is still open. On
  10-07 the operator expired 15 archived workspaces by hand, which cuts most of (c), the backlog. (d) is in hand: the
  operator ends brisk-mesa's stray tmux server (see the entry after 06:05).
- **Arming the expiry lane also waits on** a check of `_ws_expire_cwd_users`' merged newline fix (4458, in #326,
  merged 13:07), on wave 5's `state-changed` reading (Carried constraints, 08:06), and on wave 6's reading of a
  resumed expiry's `probe-unmeasured` (question (k), Carried constraints). Wave 4 closed
  its own blockers, and review 339 found each one red when mutated. Once #326 lands, the operator
  should also know two facts. An archived workspace whose branch is already gone now expires, with its work kept in
  the attic, where `main` stops at `pin-failed`. In that case, ignored and secret-shaped files go with the tree.
- **Arming the dead-coordinator lane waits on** wave 5's first commit (Carried constraints, 12:02) and, in the
  recommended order, on the expiry lane being armed first. The operator should know the worker's open items 1 and 3
  (the 12:02 entry): a lane gap over ten minutes trips the breaker for every crashed coordinator at once, and a
  same-id revive in the act's last instant can still lose its runs.
- **Operator question (f), from review 339's F5:** when a coordinator revived under a crashed id opens a new run
  under its abandoned programme, should the programme row return to active? Today it stays `abandoned` until the next
  close of the programme's last open run rewrites it (measured in a fixture store). Meanwhile, `toId:'coordinator'` mail
  without a `runId` is refused while nothing else is active, and is delivered to ANOTHER programme's coordinator when
  exactly one other programme is active. Mail with a `runId` reaches the revived coordinator.
- **The plan's other operator questions:** (g) F4's two halves; (i) the life of a kept-leaf entry; (j) B4's two
  directions. (h) is ruled (the 20:00 entry).
- **After wave 5 — wave 6, once CCR-15 wave 7 is on `main`:** ws-expire sets `crumb` on its resumed arm, and the
  parser reads `crumb:true` as resumable (question (k), an arming blocker for the expiry lane). `containment-refuted`
  gets attention at once (CCR-15's `stuck` class). Also from wave 5's act-safety lens (the 21:55 entry): a count
  for a `restart` that recurs, so it climbs the failure ladder; and a control case with HEAD symbolic to `ws/<slug>`,
  pinning that a branch deleted in the window ends at the pin as `pin-failed`.
- **Wave 2's three operator questions stay open:** the PR sheet's "Archive now", the remote-mode worktree check, and
  L5's sentence.
