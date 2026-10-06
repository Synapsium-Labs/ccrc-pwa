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
| 3 | 3, the verb | `ws-audit --expire` and `ws-expire` (ladder, pin phase, tail, `expire:` breadcrumb and ws-reap's resume arm, spawn-path refusals, the `expire` journal act); the server's argv builder and `expire-v1` token, uncalled; wave 2's residue; wave 1's instrument items | **AGENT-FIRST** | child-reclamation waves 3–4 merged and deployed; the archive→return delay measured (done: not held) | — | dispatched 2026-10-05 12:41 as run 245 (`ccrc-pwa-bright-canyon`); plan #252 (`b5593725`); block 3886–3895 + 3958–3965 |
| 3b | 3, the lane | `archivedExpiryVerdict` and the expiry population in the reclaim sweep; `reclaim-paused` becomes the one cleanup switch; coordinator clause 3, README and wave-lifecycle §6; the 409 detail, the 404 fold, FM7 | server + pwa | wave 3 merged and deployed | — | to plan after wave 3 merges |
| 4 | 4 | the dead-coordinator lane: crash-only, 1 hour, no successor, circuit breaker | server | waves 2–3; child-reclamation waves 3–4 | — | to plan |

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
- **SAFETY.** Never a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`, `~/.cc-limits`
  or `claude-session@*.service` directly; fixture HOMEs only in tests; `gh` stays off the exec whitelist; never print
  secret contents.

## Next-wave brief

Waves 1 and 2 are merged (#229 `a7b9831c`, #233 `fe7b9775`). Wave 1's measurement on the server box is recorded
above: `released_top_level` 0 and `released_wire_only` 0, and the archive→return delay does not hold stage 3. After
wave 2's deploy converges, check that `/health` reports the merge's tag and that doctor shows 0 FAIL lines.

Wave 3 (the `ws-expire` verb, AGENT-FIRST) is open as run 245 (planned), with deviation numbers 3886 to 3895,
written bare. Wave 3b (the lane) is planned after it merges.
- **Dispatched 2026-10-05 12:41** to `ccrc-pwa-bright-canyon` (plan #252; numbers 3886–3895 and 3958–3965).
  Wave 3b (the lane) is planned after it merges.
- **Its plan's FIRST commit is wave 2's residue** from review 244 (`~/.cc-clips/ccrc-pwa-still-canyon/review-244-53f31389.md`):
  - F1: `stopVerdict` reads `status` only when it is a string, and its docstring and the 3881 entry name the
    parsed-value limit (a non-compact file diverges from ccd's grep);
  - F2: 3881 states the main-checkout consequence of reading the config dir first, with a pin;
  - F3: the present-but-malformed live file is named as a stricter arm in the spec, in 3881 and in the docstring.
- **It also takes up**, or rules out, the follow-ups listed under Carried constraints:
  - the three instrument items;
  - the 409 detail;
  - `already archived`;
  - the 404 fold;
  - fold disjointness.
- **The operator's questions** from wave 2's plan stay open:
  1. whether the PR sheet's "Archive now" opens ArchiveSheet;
  2. whether the remote-mode worktree check stays deferred to `ccd`;
  3. whether L5's "Its workers will be cleaned up" stands until wave 3.
