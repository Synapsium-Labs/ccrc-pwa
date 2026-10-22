# Program: desktop-polish

Spec: `docs/superpowers/specs/2026-10-15-ccrc-two-skins-design.md` (the two skins; this wave amends its §6 inline-answer row, D-6326)
Plan: `docs/superpowers/plans/2026-10-22-desktop-polish.md`
Home project: `ccrc-pwa`   Coordinator: the coordinator session of this wave   Workspace: **a fresh child per task**
**Status:** under way (2026-10-22). The plan landed as #1129; rev 3, the operator's later notes, as #1138; rev 4, Track C and S5a, as #1148.

**What this program is.** The operator reviewed the desktop experience (Refined, about 2000 px wide, a child
session waiting on a question) and was "not super happy". They accepted a defect list in order ("Order accepted,
please proceed"): Step 1, the ask shows Claude's own structured question, says who asks, uses plain words, and is
answered inline in the session pane at ≥900 (a phone keeps the sheet); Step 2, calmer chrome (the update banner a
quiet line, no desk FAB, legible gauges, counts of only what waits on the operator), to which the operator's later
note on Instrument's desk space adds T2e; Step 3, plain words in the fleet list, the session header and the
inspector. Track B carries the operator's two bugs of the same day: a send that sits unsent ("Return not being
pressed in the console") and the slow first open of a new session. One task is one PR, one wave, one run.

## Waves

| # | task | scope | PRs | state |
|---|---|---|---|---|
| 1 | T1a (D-6324) | server: the structured ask outlives the 30-minute cut while its menu is up | #1133 | awaiting review, review run 830 (fix round 2, R17) |
| 2 | T1b (D-6325) | the ask is Claude's own question: who asks, plain words, Recommended tag, Other, one scroller, no pane text | #1150 | awaiting review, review run 815 |
| 3 | T1c (D-6326) | the ask answered inline in the pane at ≥900; a phone keeps the sheet | — | planned, after T1b |
| 4 | T2a (D-6327) | the update banner becomes one quiet line, dismissible until a newer release | — | planned, after Step 1 and #1116's content |
| 5 | T2b (D-6328) | no floating `+` at the desk in Instrument | — | planned, after #1116 |
| 6 | T2c (D-6329) | gauges most free first in a full-width row; always a number with its window; never an empty bar | — | planned, run 802; waits for T1b's claims; ahead of the step order (Q1 ruled) |
| 7 | T2d (D-6330) | Inbox and Runs counts show only what waits on the operator | — | planned, after Step 1 and #1116 |
| 8 | T2e (D-6335) | Instrument's desk: no empty column, no second head in the list column, dense rows | #1153 | awaiting review, review run 826 |
| 18 | T2f (D-6371) | Instrument's desk column: no count line, no runs row, the chooser in project mode (Q5) | — | planned, after T2d |
| 9 | T3a (D-6331) | plain fleet words; one bucket vocabulary; the counts once | — | planned, after Step 2 |
| 10 | T3b (D-6332) | names whole where they fit; ⋯ revealed under a fine pointer | — | planned, after Step 2 |
| 11 | T3c (D-6333) | the header names the session; chips never cut at the desk; doors carry words | — | planned, after Step 2 |
| 12 | T3d (D-6334) | the inspector shows only sections with content and one honest routing line | — | planned, after Step 2 |
| 13 | B1 (D-6366) | a typed send waits long enough for its echo; a lost Enter reply does not end the proof | #1144 | fix round 2 under way (R19) |
| 14 | B2 (D-6367) | Retry resumes our own text | — | planned, after B1 |
| 15 | B3 (D-6368) | the drawer follows its pty; a phone's Return is Enter | — | planned, run 785; waits for B1's claim on `server.ts` |
| 16 | B4 (D-6369) | the transcript search runs in parallel | #1136 | **merged** `0c45d7c57`; run 786 closed |
| 17 | B5 (D-6370) | New session opens at once; an unprompted session says so | — | planned, after B4 and T1a |
| 19 | S5 (W2, D-5471; D-6443) | Refined's phone header and FAB, landed by a superseding PR for the unowned #1116 | #1139 | **merged** `f0e873c5d`; run 787 closed; #1116 closed |
| 20 | S18 (W2, D-5479; D-6389) | Instrument on a desk and Refined on a phone by default, brought forward | — | dispatched, run 801 |
| 21 | T3e (D-6385) | the right-side inspector hides and shows, per device | — | planned, after T3c, T3d, T2e and #1116 |
| 22 | T3f (D-6386) | Done above Working when grouped by status | — | planned, run 800; waits for T2e's claims |
| 23 | T4a (D-6387) | colour where the machine speaks: tool boxes, inline code, failed calls | — | planned, after T1c |
| 24 | C1 (D-6388) | registry reads bounded | — | planned, run 803; waits for B1's claim on `server.ts` |
| 25 | C0 | the console's responsiveness, measured (research, no PR) | — | **done** (R11): its report became C2 to C10 (R14) |
| 26 | C2 (D-6434) | the commands and PR routes read one row; the commands route reads a bounded tail | — | planned, run 820; waits for B1's claim on `server.ts` |
| 27 | C3 (D-6435) | the watcher's tick reads the registry once and captures with bounded concurrency | — | planned, after C1 |
| 28 | C4 (D-6436) | /api/projects from the watcher's fresh listing; a cached walk | — | planned, after C1 |
| 29 | C5 (D-6437) | a wheel over a code block scrolls the transcript | — | planned, run 821; waits for T1b's claims |
| 30 | C6 (D-6438) | the fleet store keeps unchanged rows; the shell subscribes narrowly | — | planned, run 822; waits for T1b's claims |
| 31 | C7 (D-6439) | the chat's rows memoised; markdown and highlighting cached | — | planned, after C6, C8 and T1c |
| 32 | C8 (D-6440) | one accounts poll; an equal answer keeps the previous value | — | planned, after C6 |
| 33 | C9 (D-6441) | the fleet list memoised; its clock a leaf | — | planned, after C6 and C8 |
| 34 | C10 (D-6442) | the Runs board folds its finished runs | — | planned, run 823; first in the queue (R20) |
| 35 | S5a (D-6466) | a phone shows the full accounts strip again, under S5's header | #1151 | **merged** `7ebdff20c` (v0.0.574); run 814 closed |

## Decisions & deviations

- **R1 (2026-10-22)**, the operator's brief: the defect list and its order are accepted; the design rules for the ask
  (structured, never pane text, who asks, plain words, inline at ≥900, phone keeps the sheet, routing and answer path
  unchanged); every width works; renders at 360/390/1280/1920 × both skins × dark and light against `origin/main`;
  adversarial review before landing; landing through the merge queue.
- **R2 (2026-10-22)**, measured before planning (read-only): the sheet already prefers Claude Code's structured
  AskUserQuestion payload, which the session hook copies verbatim; the scraped sheet takes over when that copy ages
  past 30 minutes, which 29% of 271 answered asks on the fleet box did, and for one read on every connect. T1a and
  T1b close both.
- **R3 (2026-10-22)**, the deviation block D-6324 to 6335 was issued before planning; one number per task.
- **R4 (2026-10-22)**, landing: the merge queue's method is squash, so a PR is enqueued with
  `gh pr merge <n> --match-head-commit <sha>` (no `--squash` flag: the queue applies its own method; never `--admin`).
- **R5 (2026-10-22)**, the operator added three problems mid-planning. Each was measured read-only before it got a
  task: Instrument's desk (rendered at 1280 to 1920: an empty 320 px column at ≥1600, a second wordmark and five
  repeated doors in the list column, the first row 60% down at 1280×800) became T2e on the spare D-6335; the send
  bug (a 12-poll echo window on a box at load 47 to 59 on 16 CPUs, an unchecked Enter, a Retry that cannot resume,
  and a drawer that keeps a dead pty) and the slow first open (a serial search of about 2,600 directories, about
  64 s, before the first frame) became Track B, on a block of six allocated for it, D-6366 to 6371 (its sixth went to T2f after rev 1's review).
- **R6 (2026-10-22)**, the plan's rev 0 was read by three adversarial lenses and a refute pass (54 findings), and
  rev 1 by two more (46 findings), all applied (the plan's §Review log). Rulings that rev 1 records rather than leaves to the operator: the untagged pool
  chip keeps the account-pools spec's ruling 3 flag and door and changes only its word; a multiSelect with no
  structured copy goes to the terminal (D-5091's phone answer for it is the accepted loss); an unresolvable stream
  connect stays unmeasured rather than sending an `ask_cleared` it did not measure.
- **R7 (2026-10-22)**, the plan landed as #1129 (`93f1c459b`). Dispatched at once: T1a (run 782), T1b (run 783) and B4
  (run 786); B1 (784) and B3 (785) wait on the fleet's concurrency cap (14 of 14). Two dispatches answered a transport
  timeout yet had spawned: a refused or silent dispatch is re-measured from `runs list` before any retry.
- **R8 (2026-10-22)**, the operator's later notes, each ruled in plan rev 3: the gauges (Q1, ruled: most free first, a
  full-width row under Refined's bar); dismiss a waiting release until a newer one (T2a part (b)); hide the right-side
  panel (T3e); colour in the chat (T4a, measured first: about 9% of the transcript carries colour, almost all in
  fenced code blocks that rarely appear); Instrument by default on a desk (W2's S18, brought forward ahead of S17 on
  the operator's note); Done above Working (T3f); the console's responsiveness (Track C: C0 measures, C1 bounds the
  registry read, measured at about 3,000 serial agent requests). T2e and T2c are dispatched ahead of the step order on
  the operator's notes. D-6385 to 6389 were allocated for rev 3; 6389 went to S18's bring-forward (`flip-before-parity`). Rev 3's
  review moved Instrument's count line from T2e to T2f, which waits on #1116's content, and T2e's queued brief was
  corrected before dispatch.
- **R9 (2026-10-22)**, #1116 (W2 S5) has no run, claim or live session and has been red since 02:14Z; it blocks
  T2a, T2b, T2d and T2f and the operator's duplicate desk `+`. The coordinator takes it over: run 787 builds on its
  branch, fixes its reds and lands a superseding PR; #1116 is closed pointing at it once that merges.
- **R10 (2026-10-22)**, T1a's review (run 796, at `2e4713b87`; the held-out panel confirmed all ten readings, nine
  findings, one important) went back as fix round 1. Rulings: F1, an aged multi-question envelope is kept on the
  pane's review screen (the plan's fixture 8; a third correspondence arm, under D-6324); F2, one unparsed mid-redraw
  capture keeps the previous tick's decision; F3, F4, F5, F6, F9 and F8's README line are fixed; F7 is accepted as
  an implementation detail of "labels match" (`alignAsk` owns how many rows may be forgiven, and the decider keeps no
  second copy of that bound); F8's two PWA comments go to T1b, which edits those files. F1 and F4 corrected the plan
  (its §Review log). A review run moves to `working` before its close (`REVIEW_RUN_TRANSITIONS`).
- **R11 (2026-10-22)**, C0 runs as the coordinator's own read-only measurement, not a fleet run: the fleet's
  concurrency cap was full, and C0 changes nothing. Its report decides whether C1 as planned is enough. Rev 3 landed
  as #1138 (`09fcd6189`); T3f, S18, T2c and C1 were opened as runs 800 to 803 and wait on the cap with T2e and B3.
- **R12 (2026-10-22)**, B4's review (run 798, at `b591bf569`): clean on behaviour (the serial search's answers, the
  bound per search across homes, the 15 s timeout started only once admitted; mutation table reproduced 4/4). Two
  minor test-coverage findings, both confirmed: F1, the limiter's release in `finally` has no case where a call
  rejects (unreachable by FleetIO's contract, yet a stated guard); F2, the equivalence case cannot pin listing or
  roster order, because `pickNewest` breaks ties on a total order. Ruled: B4 landed as it was (#1136, `0c45d7c57`), and
  both are carried into B5 (a rejecting-stat case held by a mutant; the comment gives the real reason).
- **R13 (2026-10-22)**, S5's review (run 799, at `d12926b09`): clean in product code; #1139 is #1116 plus one test
  locator hunk, and Refined's desk has one New session door. Two minor browser-leg findings, confirmed: F1, the
  toast-above-FAB case measures a hand-copied div rather than `ToastHost`; F2, "clears the home indicator" was measured
  with a zero inset. Ruled: #1139 landed (`f0e873c5d`; #1116 closed pointing at it) and both are carried into T2b. The
  panel refuted 2-1 that #1116's seven slug departures need numbers; the two that depart from Task S5's text are D-6443.
- **R14 (2026-10-22)**, plan rev 4: C0's report became Track C, C2 to C10 (D-6434 to 6442, allocated with 6443 as the
  spare that went to R13), and C1 gained a correction and the one bounded pool. The drafts' 47 findings all held under
  a refute pass; the coordinator's rulings are in the plan's §Review log. Dispatch has been blocked since B1's review first tried to dispatch (measured again at 17:00Z): `ccd`
  refuses new workspaces while the worktrees volume is under its 10 GB floor (9 to 10 GB free), so every queued run
  stays `planned` until space is reclaimed, which is the operator's or the fleet cleanup's, never this programme's.
- **R15 (2026-10-22)**, the operator, on v0.0.570 at phone width: "The accounts at the top on mobile looked and behaved
  better before this." #1139 had replaced the phone's full accounts strip (each lane's 5h and 7d rows with their reset
  countdowns) with the compact grid (one reading per lane); its renders used five lanes, and at 17 the grid is nine rows
  of cut names. Ruled: S5a (D-6466) restores the full strip under S5's header, first in the queue, and T2c sorts that
  strip most free first. A phone fixture for any gauge task carries the operator's lane count from now on.
- **R16 (2026-10-22)**, B1's review (run 808, at `b3873d962`): 8 findings, 3 medium; all 15 mutation rows reproduced.
  Sent back as fix round 1: F1, an own paste chip or a row-capped box waited the full echo budget (the loop now ends
  once the `ECHO_TRIES` floor is reached and the pane is proven ours); F2, pre-existing and narrowed, an all-blind
  post-Enter watch on the stash paths pressed a retry Enter onto a restored human draft (fixed in B1, which owns the
  proof); F3, a maybe-restored final read must offer no draft and nothing to submit, and a surviving mutant is killed;
  F4, a wall deadline on the proof's blind polls, so `coordMutex` is not held for about 202 s with tmux hung; F5, F7
  and F8 fixed; F6 accepted (pushed history is not rewritten).
- **R17 (2026-10-22)**, T1a's second review (run 805, at `2773cdc48`): 5 findings, 2 important. The review arm checked
  no correspondence (F1) and dropped a one-question multiSelect envelope on its own review screen (F2). One fix for
  both: keep only when every question the review lists is one of the envelope's, the listed questions parsed in
  `shared/ask-menu.ts` beside `reviewRows`, a departure from T1a's Files numbered **D-6478**. F3 (a failed capture
  counted as a second redraw) fixed. F4 and F5 were in the plan and are corrected there (its §Review log). Sent back
  as fix round 2.
- **R18 (2026-10-22)**, S5a's review (run 824, at `c7fc8e348`): 8 minor findings; the fix reproduces card for card
  against the build before #1139 at 390×844 with 17 lanes (17 cards in 2 columns with countdowns; the first session
  row at 761 px against 789 then and 422 on `main`). Ruled: #1151 lands as it is; it merged as `7ebdff20c` and shipped
  in v0.0.574. F7: D-6466 amends the spec's §5.3 phone row (its grid and its first row at about 38%), and the plan now
  says so. F1 to F6 go to T2c, which owns the strip next (Carried constraints). F8 (two widths of the three-build
  comparison unrendered) needs no code; the reviewer rendered 390. S5a's two departures are **D-6475** and **D-6476**.
- **R19 (2026-10-22)**, B1's fix round 1 review (run 819, at `784f4ae04`): 6 findings, 2 important; all 20 mutation
  rows reproduce. F1, introduced by R16's F4: the blind deadline counted from the watch's start, so on a loaded box
  one failed capture ended a watch that had read our box, and its retry Enter submitted the human's restored stash
  (measured at 200 and 400 ms captures). F2: R16's guard covered only an all-blind watch, and a watch that read our
  box once and then went blind still retried. Ruled one condition for both: on the stash paths, no retry Enter after
  any failed capture that follows the last box read; the deadline counts from the first failed capture of a blind run.
  F3: the needle check moves ahead of the early end, so a late echo keeps the echo proof. F4: the paste-chip half of
  the early end is pinned, or dropped with its proof. F5 is the ledger's: D-6366 now records both rulings. F6: the
  comment and the PR body say what is true. Sent back as fix round 2.
- **R20 (2026-10-22)**, the fleet box restarted at about 20:05Z; every worker of this programme resumed on its own,
  and load fell from about 200 to about 10. T2e's wave-done (`aedcc2ee0`, #1153) was verified and review run 826 reads
  it; its departure is **D-6477**. T1b's wave-done (#1150, at `3e946e22f`) had been verified before the restart, and
  review run 815 reads it; its departures are numbered once that review is ruled. T1a's fix round 2 (`c24ad9ce1`, CI
  green) was verified and review run 830 reads it. S18 dispatched as run 801. C2, C5, C6 and C10 were opened as runs
  820 to 823 with rev 4; C10 goes first because its files are free of every claim. B3, C1 and C2 each edit
  `server/src/server.ts`, which B1's claim holds until #1144 merges, so they wait for it; C5 and C6 wait for T1b's
  claims, T3f for T2e's, and T2c for T1b's (S5a's are released).
- **Open with the operator:** Q2 to Q9 in the plan's §Operator questions (Q1 is ruled), each with a recommended
  default the tasks build until ruled.

## Carried constraints

- #1116's content has merged as #1139 (`f0e873c5d`); #1116 is closed. Before T2a, T2b, T2d, T2f or T3e dispatches, their
  hunks are re-measured against `main`.
- B5 carries R12's two items; T2b carries R13's two items.
- T2c carries R18's F1 to F6, S5a's minor findings on the strip it sorts next: the strip's "two columns" comment says
  four from 700 px (F1); `CompactGauges`' `grid` doc and `FleetScreen`'s phone-head comment are corrected or the arm
  goes (F2); a case proves a tap goes through the command layer, not a handler of the strip's own (F3); the reset
  countdowns are checked visible by their client rect (F4); a long label's spill into its neighbour card is seen (F5);
  the comments S5a lengthened are re-wrapped (F6).
- What the not-started skins tasks inherit is listed in the plan's §Carried into the skins plans.
- The fleet box's load swung between about 10 and 200 on 16 CPUs on 2026-10-22 (a restart at about 20:05Z); dispatch
  at most the tasks a step needs, and run every suite under the plan's load rules.

## Next-wave brief

As the fleet's cap allows, and only once a task's files are free of other claims (R20): C10 (823) first; B3 (785),
C1 (803) and C2 (820) when B1 has merged; C5 (821) and C6 (822) when T1b has; T3f (800) when T2e has; T2c (802) when
T1b has; then C3 and C4 after C1, C8 after C6, C9 after C6 and C8, C7 after C6, C8 and T1c. Each brief names the plan path, its task, the number it defines, the
execution skill (superpowers:subagent-driven-development with superpowers:test-driven-development), the routing row (a
worker on a spec'd plan), and the branch rule: commit on this workspace's own branch, never a separate feature branch.
Step 1's T1c dispatches when T1b has merged; T2a, T2b, T2d and T2f now that #1139 has merged, once their hunks are
re-measured; B5 when T1a has merged (B4 has); B2 when B1 has.
