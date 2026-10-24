# Program: desktop-polish

Spec: `docs/superpowers/specs/2026-10-15-ccrc-two-skins-design.md` (the two skins; this wave amends its §6 inline-answer row, D-6326)
Plan: `docs/superpowers/plans/2026-10-22-desktop-polish.md`
Home project: `ccrc-pwa`   Coordinator: the coordinator session of this wave   Workspace: **a fresh child per task**
**Status:** under way (measured 2026-10-24). The plan landed as #1129; rev 3, the operator's later notes, as #1138; rev 4, Track C and S5a, as #1148.

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
| 1 | T1a (D-6324) | server: the structured ask outlives the 30-minute cut while its menu is up | #1133 | **merged** `2978d46ef`; run 782 closed (R31, R47) |
| 2 | T1b (D-6325) | the ask is Claude's own question: who asks, plain words, Recommended tag, Other, one scroller, no pane text | #1150 | **merged** `30f9bdc9f`; run 783 closed (R45, R58) |
| 3 | T1c (D-6326) | the ask answered inline in the pane at ≥900; a phone keeps the sheet | #1313 | working, run 911; R49 carry and one prerequisite merge authorized (R55, R56) |
| 4 | T2a (D-6327) | the update banner becomes one quiet line, dismissible until a newer release | #1164 | **merged** `24551a5b6`; run 831 closed (R41, R47) |
| 5 | T2b (D-6328) | no floating `+` at the desk in Instrument | — | planned, after #1116 |
| 6 | T2c (D-6329) | the desk's lanes row in both skins: full 5h/7d cards with resets, most free first, each a door to its lane; never an empty bar | — | planned, run 802; rewrite brief for R48, then fresh claim check |
| 7 | T2d (D-6330) | Inbox and Runs counts show only what waits on the operator | — | planned, after Step 1 and #1116 |
| 8 | T2e (D-6335) | Instrument's desk: no empty column, no second head in the list column, dense rows | #1153 | **merged** `fd15dd7e0` (R32, R47) |
| 18 | T2f (D-6371) | Instrument's desk column: no runs row, the chooser in project mode (Q5); its count line is T2g's (R28) | — | planned, after T2d and T2g |
| 9 | T3a (D-6331) | plain fleet words; one bucket vocabulary; the counts once | — | planned, after Step 2 |
| 10 | T3b (D-6332) | names whole where they fit; ⋯ revealed under a fine pointer | — | planned, after Step 2 |
| 11 | T3c (D-6333) | the header names the session; chips never cut at the desk; doors carry words | — | planned, after Step 2 |
| 12 | T3d (D-6334) | the inspector shows only sections with content and one honest routing line | — | planned, after Step 2 |
| 13 | B1 (D-6366) | a typed send waits long enough for its echo; a lost Enter reply does not end the proof | #1144 | **merged** `aa4d287af`; run 784 closed (R29) |
| 14 | B2 (D-6367) | Retry resumes our own text | #1214 | **merged** `5a4ab3aef`; run 869 closed (R49, R58) |
| 15 | B3 (D-6368) | the drawer follows its pty; a phone's Return is Enter | #1216 | **merged** `7d3ab55e7`; run 785 closed (R50, R58) |
| 16 | B4 (D-6369) | the transcript search runs in parallel | #1136 | **merged** `0c45d7c57`; run 786 closed |
| 17 | B5 (D-6370) | New session opens at once (the unprompted line dropped, R39) | #1227 | working, fix round 2 after review 913; F8 blocks landing (R52, R53, R59) |
| 19 | S5 (W2, D-5471; D-6443) | Refined's phone header and FAB, landed by a superseding PR for the unowned #1116 | #1139 | **merged** `f0e873c5d`; run 787 closed; #1116 closed |
| 20 | S18 (W2, D-5479; D-6389) | Instrument on a desk and Refined on a phone by default, brought forward | #1158 | **merged** `c0841a9f3` (R30, R47) |
| 21 | T3e (D-6385) | the right-side inspector hides and shows, per device | — | planned, after T3c, T3d, T2e and #1116 |
| 22 | T3f (D-6386) | Done above Working when grouped by status | — | planned, run 800; dispatch waits for a daily-cap slot |
| 23 | T4a (D-6387) | colour where the machine speaks: tool boxes, inline code, failed calls | — | planned, after T1c |
| 24 | C1 (D-6388) | registry reads bounded | #1217 | **merging**: refreshed head queued after review 912 (R54) |
| 25 | C0 | the console's responsiveness, measured (research, no PR) | — | **done** (R11): its report became C2 to C10 (R14) |
| 26 | C2 (D-6434) | the commands and PR routes read one row; the commands route reads a bounded tail | #1210 | **merged** `bea722cdf` (R40, R47) |
| 27 | C3 (D-6435) | the watcher's tick reads the registry once and captures with bounded concurrency | — | planned, after C1 |
| 28 | C4 (D-6436) | /api/projects from the watcher's fresh listing; a cached walk | — | planned, after C1 |
| 29 | C5 (D-6437) | a wheel over a code block scrolls the transcript | — | planned, run 821; prerequisites merged, reconstruct brief and check claims |
| 30 | C6 (D-6438) | the fleet store keeps unchanged rows; the shell subscribes narrowly | — | planned, run 822; prerequisites merged, reconstruct brief and check claims |
| 31 | C7 (D-6439) | the chat's rows memoised; markdown and highlighting cached | — | planned, after C6, C8 and T1c |
| 32 | C8 (D-6440) | one accounts poll; an equal answer keeps the previous value | — | planned, after C6 |
| 33 | C9 (D-6441) | the fleet list memoised; its clock a leaf | — | planned, after C6 and C8 |
| 34 | C10 (D-6442) | the Runs board folds its finished runs | #1197 | **merged** `7a3104abd`; run 823 closed (R44, R58) |
| 35 | S5a (D-6466) | a phone shows the full accounts strip again, under S5's header | #1151 | **merged** `7ebdff20c` (v0.0.574); run 814 closed |
| 36 | S5b (D-6530) | the strip's fold at every width: four lanes on a phone, one row at the desk; "+n more" counts the hidden lanes that need the operator | — | planned, after T2c (R22, R48) |
| 37 | T5a (D-6714) | the top search finds sessions by name, workspace, branch, project and a coordinator's programme, after the commands, coordinators first on an equal match | #1316 | working, run 908; CI after census correction, not a handoff (R58) |
| 38 | T2g (D-6715) | Instrument's desk column draws no count line; the status bar's count is the one | #1225 | **merged** `0b717eb08`; run 877 closed (R51, R58) |

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
- **R21 (2026-10-22)**, T2e's review (run 826, at `aedcc2ee0`): 8 findings, 3 important; its table and its 8 mutants
  reproduce, Refined measured identical, and D-6477 is honest. Sent back as fix round 1: F1, at Instrument's desk the
  unread count showed nowhere once the column dropped `MailBadge`, so the rail's Inbox door carries it through
  `useNavBadges` (**D-6539**); F2, with realistic names the needs-you rows at 1280 are three lines (58.5 px, under the
  old 61, no fact dropped), accepted, with the browser fixture carrying realistic names so the cases pin what holds,
  and the layout question carried to T3b; F3, the touch case measures the padding box; F4, the first-row budget is the
  measured saving, exactly; F5, the lamp sits on the name's line in a one-line row; F6, the guard's words; F7 carried
  to T2f.
- **R22 (2026-10-22)**, the operator ruled both open questions "yes" (about 22:00Z). T2a, the update banner as one
  quiet line dismissible until a newer release, is brought forward ahead of the step order (run 831, dispatched about
  22:12Z; it claims `instrument-shell.test.tsx` once T2e merges). A folded phone strip becomes Task S5b (**D-6530**,
  after T2c and T2a; Q10, ruled): the four freest lanes (two rows on a phone, one row of four from 700 px, the
  coordinator's change to the "fill two rows" default offered), "+n more" counting the hidden lanes whose sign-in
  expired or that are rate-limited, expanded in place and remembered on the device. One Opus drafter and three Opus
  lenses with a Sonnet refute pass wrote and checked it (29 findings, all upheld and applied), and two verifiers
  checked the revision (the plan's §Review log).
- **R23 (2026-10-22)**, T1b's review (run 815, at `3e946e22f`): 6 findings, 1 important; its 11 mutants red at the
  head, 72 renders clean, the answer path byte-identical. Sent back as fix round 1: F1, three dialog-sheet cases
  pinned a hand-off the server never sends, rewritten to the production shape; F2, an open ask vanished on every
  reconnect (measured gone from 2.25 s to 3.79 s), so the surface now holds through a reconnect, read-only, until the
  new connection's first deciding frame (**D-6538**); F3, an ending ask closes with the sheet's exit again; F4, the
  Other field's edge and its dashed disabled cue restored, no departure; F5, ruled by land order: T1a lands before
  T1b; F6 resolved by measurement. T1b's named departures are **D-6531** to **D-6537**; `ask-fixtures-module`,
  `open-time-focus-keeps-scroll` and the census key renames are implementation notes.
- **R24 (2026-10-22)**, T1a's fix round 2 review (run 830, at `c24ad9ce1`): 7 findings, 1 important; 20 mutation rows
  reproduce and CI is green (the worker's red suite line was the first full run's real type error, fixed at
  `2e4713b87`). Sent back as fix round 3: F1, a regression from R17's F3, the aged envelope was held while captures
  kept failing after the dialog had cleared, so the clearing tick, and every failing tick after it, reads as no menu;
  F2, ruled fail-closed: an aged envelope is not kept on its own review screen before any question is answered (the
  plan's decider says so now); F3, the one matcher stays and the parsed arm's loosening is pinned and documented; F4
  to F7, wording, three pinned bounds, D-6478 cited, the PR body.
- **R25 (2026-10-22)**, S18's wave-done (`580a221a0`, #1158, CI green) was verified and review run 834 opened, but its
  dispatch was refused `cap-daily` (64 of 64 sessions in a rolling 24 hours; the next frees at about 23:27Z). The
  daily cap is the operator's setting; they were asked whether to raise it. B1's fix round 2 (`7da5a749a`) was
  verified and review run 832 reads it. #1156 left the merge queue on a runner's package-mirror 403 during setup (no
  test ran) and was re-enqueued.
- **R26 (2026-10-22)**, B1's fix round 2 review (run 832, at `7da5a749a`): 5 findings, 1 important (a test gap); 25
  mutation rows reproduce; the hung-tmux bound holds at four captures. Sent back as fix round 3: F1, the all-absent
  watch is pinned per stash path; F2, ruled (it predates B1): an absent box after the last box read joins R19's
  condition, so the stash paths press no retry Enter then, giving up the retry when an overlay hides the box, because an
  unsent send that says so is the lesser harm than a restored draft submitted; "failed" and "absent" stay two facts;
  F3 to F5, the PR body, a dead arm and the blind deadline's cases. D-6366 says so now.
- **R27 (2026-10-22)**, T2a's ask (23:33Z), answered by the coordinator from the plan: at 900 Refined's bar has 143 px
  free with no gauges and the update line needs 178, and T2c frees no more, so Refined's desk indicator sits in a
  full-width row under the bar, shown only while a release waits and is not dismissed; the bar's first line is
  unchanged. T2c's gauge row shares that row once both land. Instrument's status bar as planned (D-6717).
- **R28 (2026-10-23)**, the operator's two asks. Once the worktrees disk had room again (about 14:38Z), the six
  waiting review runs and C10 (run 823) were dispatched. (1) With a screenshot of Instrument's desk list column (the wordmark,
  the session count, Docs, Account, Settings, the inbox and the bell): the section is superseded by the new UI. T2e
  removes the wordmark and the five doors; the count line is split out of T2f as Task T2g (D-6715), to land right after
  T2e, and T2f keeps the runs row and the class chooser. (2) "Refine the search bar at the top to search across
  coordinator workspace names and projects": Task T5a (D-6714). The operator ruled Q11 A (every session matches at the
  palette's first level, on its name, workspace, branch, project and, for a coordinator, its programme; coordinators
  before workers on an equal match; a project name lists its sessions; an empty query shows the commands) and Q12 A (no
  project row). The coordinator's defaults for the rest: sessions rank after every matching command, so a query that
  matches a command keeps what Enter does today; a session needs two or more letters and a contiguous match; the field's
  words do not change; a phone's search door is S11's.
- **R29 (2026-10-23)**, B1's fix round 3 review (run 841, at `674e03dd4`): 2 minor findings, no ruling needed; all five
  of R26's rulings are implemented and pinned; a moving-clock probe found 0 bad sends in 36,000 (530 at `7da5a749a`).
  Ruled: B1 lands as is (#1144 enqueued). F1, a comment in `send.ts` (≈:346) still calls a failed capture "exactly
  like an absent box", and F2, the reset of the absent fact on a box read (≈:368) is unpinned (deleting it survives
  230 of 230), go to B2, which edits `send.ts` next, with review 841's notes for B2. B1 merged as `aa4d287af`, and B3
  (785), C1 (803), C2 (820) and B2 (a new run, 869) were dispatched.
- **R30 (2026-10-23)**, S18's review (run 834, at `580a221a0`): 5 minor findings; the 7 mutation rows reproduce; the
  browser leg is 8 of 8. Ruled: S18 lands as is (#1158 enqueued). F1 accepted: on a desk, a stored skin value this
  build does not know paints Refined for one frame, then Instrument; it is rare (a hand edit, or a move back from a
  build with a newer skin), and a fix would need the catalogue in the pre-paint snippet, which single-definition
  forbids (D-6721). F2: both comment edits outside S18's files are in scope (D-6722, D-6720). F1's two comments, F2's
  stale tense, F3 (a browser run line), F4 (a README wrap) and F5 (a test comment that states jsdom's name) are text
  only and go to T5a. S18's three named departures are D-6718 to D-6720.
- **R31 (2026-10-23)**, T1a's fix round 3 review (run 837, at `e641fd7e0`): 4 findings; all R24 rulings applied;
  review 830's probe now clears; 25 of 25 mutation rows reproduce; suites and CI green. Ruled: T1a lands as is (#1133
  enqueued), and the test and doc items go to B5, which edits `sessionws.ts` next: F1, the new `captureHeld` reset on a
  successful capture (≈:400) is a guard with no red case (deleting it leaves an aged envelope unmatched after one held
  failure): B5 adds the stream case (an aged envelope, panes MENU, MENU, a failed capture, then an empty pane or
  another call's review; one `ask` and one `ask_cleared`) and its mutant row; F2, `captureHeld`'s doc says "the last
  capture this stream judged failed and held"; F3, the parsed arm's "a prefix either way" is pinned by an assertion in
  the aged-ask case. F4 was PR-body wording only.
- **R32 (2026-10-23)**, T2e's fix round 1 review (run 840, at `f9ad95190`): 9 minor findings; all six wave lenses and 14
  of 16 mutation rows reproduce; the browser file is 18 of 18. Ruled: T2e lands as is (#1153 enqueued). F1: T2d's
  Files gain `Rail.tsx`, so the rail's Inbox door counts and says what Refined's door says ("waiting for you"), and
  the four copies of the badge's print cap become one constant. F2 (a two-line row with no context is 53 px, the cost of
  R21's lamp rule) goes to T3b with R21's F2. F3 to F7 and F9 go to T2g, written into its Files: the dense block's two
  stale comments, the browser file's fixture header, an unread case at the ack's own stamp, the token guard scanning
  every rule of the dense block, a browser case for the rail badge's placement, and the "rounds 1 and 2" labels. F8,
  `Rail.tsx`'s comment on who reads `useNavBadges`, goes to T2d, which rewrites that door. D-6716 records the three-line
  rows.
- **R33 (2026-10-23)**, T2a's review (run 844, at `003289668`, its wave-done verified): 9 findings, 1 important; all 15
  mutants reproduce; the full pwa suite, the browser files and the rings are green. Sent back as fix round 1: F1, on a
  phone the dismiss moved focus to the main landmark, which the phone's fleet view hides, so focus fell to the body
  (measured at 390 in both skins): focus a landmark that is displayed, pinned by a browser case at 390; F2, a case for the
  cross-tab `storage` event; F3 accepted (a 0.5 px overhang at the viewport's bottom edge; the 24 px target floor
  stands); F4, README stops describing the update banner, in this PR; F5, F6 and F8, a test header, the session route's
  missing renders and the PR's citations; F7 accepted (commit order inside a squashed PR); F9, a log line in
  `watch.ts` that still says "the banner", goes to C3.
- **R34 (2026-10-23)**, T1b's fix round 1 review (run 843, at `4ae8b26a2`, its wave-done verified): 7 findings, 2
  important; all 20 mutation rows reproduce; in Chrome the held sheet keeps its Other text and focus through a drop.
  Sent back as fix round 2: F1 (it predates T1b), after a reconnect in which the menu went away the new stream sends no
  dialog frame, so the pre-drop menu was offered live and a tap sent a stale answer: the store lowers `dialog` with
  `askFrameSeen` when the socket is not open, which the hold survives because it lives in the sheet; F2 accepted, the
  transcript's card follows the connection, and its comment says so; F3, in the gap the send controls are disabled
  (not the Other field, not the dismissal) and the status line promises no queue; F4 to F6, test comments and the
  comments handed over from T1a. F7: the four CodeQL alerts are the same `useStore(selector)` false-positive class main
  carries; dismissing them is the operator's, at landing.
- **R35 (2026-10-23)**, C2's Step 0: `parseSkillListing` drops a skill line that carries only a name after its dash
  (86 of 723 listings). Ruled in as a departure (D-6761). T1b and B2 settled their overlapping claim on the session
  store between themselves.
- **R36 (2026-10-23)**, C2's ask, answered with option 0: when the commands route falls back to the head, it applies
  the window's deltas after the head's last full listing, the plan's answer rule across both reads (D-6762).
- **R37 (2026-10-23)**, C10's review (run 870, at `d09040385`): 8 findings, 1 important; no behaviour defect. Sent
  back as fix round 1: F1, nothing guarded that a finished row's clock still moves (a clock frozen at mount passed
  every case), so a case at the 30 s step's boundary and its mutant row; F2, a case for the focus flag's reset after a
  middle Show more; F3, a census entry of its own for the Show more control; F4, the memo comment says that a fleet
  frame re-renders every mounted finished row with a live session; F5, the 500-run cases take fewer rows or a per-case
  timeout; F6, the measure command's working flags; F7, the PR body; F8, the `FINISHED_CLOCK_MS` comment (the two lags
  add). F4's scope goes to C6: until C6 keeps unchanged rows, every fleet frame re-renders those rows.
- **R38 (2026-10-23)**, B2's wave-done (#1214, at `a7b7c8e79`) named a gap, ruled in before its review: `retry()`
  resumes on every `enter-ignored` (an empty box answers nothing to submit, our own text gets one Enter, anything else
  is a draft present); `verify-failed` keeps the drafted rule (R43's F3 later took `type-failed` off it: it carries no draft and
  retypes); a second Retry after nothing to submit retypes. Not a departure: the plan's acceptance applied.
- **R39 (2026-10-23)**, B5's ask, answered with option 1, the plan's own fallback: Step 0 found a new session's turn
  marker present (SessionStart's `startup` writes it, with `turnAt` null), so the premise of the "No messages yet"
  bullet fails. The bullet is dropped and reported, and the banner stays. `turnAt` null is not the signal, because a
  resumed or swapped session can read null with history. Whether an unprompted signal from `turnAt` null and a fresh
  generation becomes a task of its own is the operator's question.
- **R40 (2026-10-23)**, C2's review (run 873, at `27b143aac`): 3 minor findings, no ruling needed; the request counts
  reproduce; 21 of 22 mutation rows reproduce. Ruled: C2 lands as is (#1210 enqueued). Carried to C3: F1, the comment
  in `commands.ts` (≈:111) says the head can overlap the window's oldest chunk in a file of four or five chunks, and
  the replay is idempotent (a case at four and a half chunks is optional); F2, the title in `backread.test.ts` (≈:76)
  drops its unpinned max(1, …) half, or a zero size is refused; F3, the case in `commands.test.ts` (≈:402) named "the
  head's first answers" pins the last and is renamed. The plan's C2 Step 1 name and its two mutation-table rows are
  corrected in this ledger PR. C2's departures are D-6761 to D-6764.
- **R41 (2026-10-23)**, T2a's fix round 1 review (run 872, at `a7e481226`): 8 minor findings; the phone dismissal's
  focus holds (24 of 24 at the desk, the phone green); all 18 mutants red. Ruled: T2a lands as is (#1164 enqueued).
  T2a's departures are D-6717 (R27) and D-6752 to D-6756, the last F5's: the dismissal focuses the shown landmark through `frame.tsx`,
  outside its Files. F6 accepted (commit order inside a squashed PR). F7: #1193 conflicts with T2a (T2a deletes
  `UpdateBanner`, which #1193 edits, and #1193 moves `newestPending` to `updatesRead.ts`); T2a lands first, and a note on #1193 asks it to
  absorb the change and repoint the import in `releaseWaiting.ts`. Carried to T5a: the command layer's restore drops
  focus to the body at 390 on the fleet view (measured three ways), so it goes through `focusShownLandmark`; F1,
  `preventScroll` is pinned; F2, the docstring in `frame.tsx` (`skipToContent` passes no `preventScroll`). Carried to
  T2c: F3, the header of `release-waiting.test.ts` (the null case moved to `update-indicator.test.tsx` ≈:191; the
  `releaseWaitingWords` and `shownRelease` cases are new); F8, README's lead says the line shows on every screen at a
  desk, and on the fleet view below 900 px. F4, a note for T1c: if the inline ask card is not a dialog, `useAskKeys`
  fires only from the body, so a click on the fleet column's empty space at the desk takes its keys away; T1c measures
  it.
- **R42 (2026-10-23)**, B3's review (run 876, at `a19f2d078`): 3 findings, 1 important; 32 of 32 renders reproduce.
  Sent back as fix round 1: F1 (safety), no case pinned the guard that stops a stale bridge's `kill()` after exit, so
  a late close could kill a reused pty id: a stale-kill-after-reconnect case with a spy on `sendPty`, and its mutant;
  F2, both failed-open branches are pinned; F3, ruled: the re-attach verdict moves into an L1 pure function
  (`reattachVerdict`, in `typedFrame.ts`) in this PR, replacing the departure `inline-reattach-decision`. B3's
  departure `shared-pty-exit-code` is numbered after review; `load-tolerant-verification` and
  `setup-only-typecheck-red` are process notes.
- **R43 (2026-10-23)**, B2's review (run 879, at `f68b33e25`): 4 findings, 2 important; all 9 mutation rows reproduce.
  Sent back as fix round 1: F1, the whole-box resume refuses a box at its row cap (answering `draft-present`), because a
  capped box can hide foreign rows above its window (a probe got one Enter onto it); F2, two rulings were on no committed page, so
  this ledger PR amends the plan: B2's "When" bullet (every `enter-ignored` resumes, `verify-failed` with a draft,
  `type-failed` retypes), D-6367 (R38), D-6366 (R29's comment and the `absentSinceRead` pins ride B2) and B2's Files,
  which gain `send-stash.test.ts`; F3, the dead `type-failed` arm goes; F4 accepted (a commit titled red whose server
  case was green).
- **R44 (2026-10-23)**, C10's fix round 1 review (run 881, at `f7d09783d`): 4 minor findings, prose and citations, no
  ruling needed; the mutation table reproduces; CI green. Ruled: C10 lands as is (#1197 enqueued). Carried to C6: G1,
  the memo comment in `RunRow.tsx` (≈:31) says a tick inside one 30 s step re-renders no finished row, and at most 20
  until Show more; G2, the comment in `runs-finished-fold.test.tsx` (≈:252) says `--reporter=verbose` is the flag that
  matters; G3, its comment at ≈:94 says the per-case budget is the fix, and the fixtures are sized to what they
  assert. G4, a PR-body citation, is moot once merged. C10's departures are D-6757 to D-6760.
- **R45 (2026-10-23)**, T1b's fix round 2 review (run 882, at `d983f146e`): 6 minor findings; R34's F1 holds (no stale
  menu offered live, no double send or silent loss across a drop, every send control disabled in the gap; 26 rows and
  10 gap mutants red); the answer path is byte-identical. Ruled: T1b lands. Carried to T1c, text only: F1, the
  `ask-structured` case at ≈:881 is renamed (the disabled Deny sends nothing) or drives `claim()`'s refusal; F2, the
  comment in `session.ts` (≈:302) says `dialog` also falls at the drop and `ask` does not (B2's file: after B2 lands,
  or with its consent); F3, `DialogSheet.tsx` (≈:219) and `dialog-sheet.test.tsx` (≈:2937) cite "review 844", which is
  T2a's, and say "fix round 2's own review" instead; F4, the entry in `audit.mjs` (≈:885) points at
  `ui/src/primitives/sheet.tsx` (≈:275). F5 resolves once `main` is in; F6 needs nothing. Auto-merge was armed,
  blocked by four CodeQL alerts (R34's F7) and disarmed; their dismissal waited on the operator (R47).
- **R46 (2026-10-24)**, C1's review (run 878, at `acd541e19`): 7 minor findings; every plan and pool mutant red; 2,512
  requests down to 849 and 81 rounds down to 11 reproduce, and so does the base golden. Ruled: C1 lands as is (#1217
  enqueued). F6 accepted: the census rewrite rides the code commit, because neither order lands green alone (not a
  departure). F5, PR prose, is moot. Carried to C3: F1, the `emitPools` docstring in `watch.ts` (≈:3061): the registry
  read is no longer serial, about one timeout per 8 sessions; F2, the two untagged "~721" comments (`watch.ts` ≈:2236,
  `child-reclaim-watch-view.test.ts` :3) give today's census; F3, the header of `bounded.ts` says "no imports, no
  timers, no I/O", and its deadlock rule narrows to "never await a call under the same limiter from inside a call
  under it"; F4, one live-after figure in `registry.ts` (≈:1272): 14 rounds, derived, at the measured round time; F7,
  a case for a late call issued synchronously right after a resolve, before any await (a handoff that dips in a
  microtask). C1's departure is D-6765.
- **R47 (2026-10-24)**, the operator's answers to two questions. The coordinator dismisses T1b's four CodeQL alerts
  (#177, #178, #179 and #181, the `useStore(selector)` false-positive class `main` carries) as false positives; it
  did, and T1b was enqueued. The operator chose to raise the fleet's daily cap from 64 to 96, a setting they make on the
  Runs board's caps control. Merged since R29's B1: S18 (`c0841a9f3`), T1a (`2978d46ef`; run 782 closed), T2e
  (`fd15dd7e0`), C2 (`bea722cdf`), T2a (`24551a5b6`; run 831 closed) and the previous ledger PR #1201
  (`eab2deb35`). C10 and C1 are in the merge queue. C10 left it once on two flaky tests in other areas (a
  trickle-timing case in `ccrc-update.test.ts` and a relay case in `history-maint.test.ts`) and was re-enqueued; #1201
  left it once on a timing case in `session-hook-approval-deny.test.ts` and was re-enqueued. B2's and B3's fix rounds
  are done and review runs 907 and 905 are opened; B5 (#1227) and T2g (#1225) are done and review runs 906 and 904 are
  opened; their dispatch waits for daily-cap slots; T5a was opened as run 908, and T3f (800) waits for a daily-cap slot.
- **R48 (2026-10-24)**, the operator, with a screenshot of Instrument's top-bar lane meters (one number per lane, six
  lanes shown, "+11"): "I don't like the fact that I've lost information on the 5h and 7d limits and when they reset,
  and also that I only see a sliver of all connected accounts. Could we put this one line down as its own line and get
  the information back and also make it nicer and easier to navigate?" Ruled by answered questions: Q13 A (one row of
  the freest lanes, then "+n more" counting the hidden lanes that need the operator; one click expands in place to
  every lane, wrapping, remembered on the device; the phone strip's fold, one component) and Q14 A (each lane card is
  its own door to the Accounts screen at that lane). T2c becomes the desk's lanes row in both skins: the full cards
  (5h and 7d, each with its meter, percentage and reset countdown) in a full-width row under the bar, most free first,
  and the compact gauges leave both bars. S5b's fold applies at every width: four lanes on a phone, one measured row at
  the desk. T2c lands first and shows every lane; S5b adds the fold.
- **R49 (2026-10-24)**, B2's fix round 1 review (run 907, at `77eea817d`): two minor findings; all eleven mutation
  rows reproduce, the held-out panel is complete, and the main-plus-branch targeted suites pass. Ruled: land as is.
  F1 and F2 are carried into T1c, each in its own commit: add `type-failed` with a non-empty draft to the
  `retryResumes` false matrix and measure it red on the restored old arm; correct `boxRowCap`'s three safety comments
  so they distinguish tail's fail-closed acceptance from whole's formula-dependent refusal. No prompt behaviour
  change was requested. B2 subsequently merged as `5a4ab3aef`; run 869 closed with its reviewed head.
- **R50 (2026-10-24)**, B3's fix round 1 review (run 905, at `eeb07cb2f`): four minor findings, no new behavioural
  defect; the held-out panel completed (nine confirmed readings, none refuted or unexamined), and all ten table rows
  reproduce across seventeen executed mutants. The prior stale-kill and failed-open guards red, and `reattachVerdict`
  is pure L1. Ruled: land as is. F1 to F3 remain **unowned follow-ups**, not assigned by the merge: the module header
  describes its fourth connection-policy job and restores its D-6368 citation; the rejected-open assertions become
  non-vacuous; the verdict's null-first arm gets a red pin. F4, the plan-named failed-open case was renamed, is
  accepted and recorded here. `shared-pty-exit-code` is D-6800. B3 merged as `7d3ab55e7`; run 785 closed.
- **R51 (2026-10-24)**, T2g's review (run 904, at `9df8c1db1`): F1's fixture omitted T2a's waiting update indicator.
  The reviewer measured the merged tree at 900 and 1000 under fine and coarse pointers with that indicator drawn:
  the count fits whole (211 px), so no `flex: none` is needed. Ruled: accept that measured product behaviour and land.
  The mandatory panel completed; mutation rows 1 to 7 reproduce. F1 to F5 go to T2f: serve the update view in
  `WITH_RUNS` and assert the indicator; assert the column exists in both missed loops; correct the table footer
  (rows 1 and 4 also run in the browser, row 7 only there); name the frame's status bar and the rail's doors honestly;
  list all seven red cases for row 6. T2g merged as `0b717eb08`; run 877 closed.
- **R52 (2026-10-24)**, B5's review (run 906, at `44100b52f`): eight findings, three important; the mandatory panel
  completed, all thirteen reported mutants red and all thirty-two before/after renders reproduce. Sent back as fix
  round 1: F1 preserves the pre-B5 immediate toast and close for an already-live main checkout, through the existing
  wrapper-independent owner, with no navigation or 60 s wait. F2 restores the deleted dismissal/clock/listener cases
  and separately kills unsubscribe and clear-timeout mutants. F3 adds a real unmount-during-wait case and kills the
  missing cleanup. F4 guards a late unreadable named answer against closing a reopened sheet. F5 reconciles a cached
  pick by workdir against fresh project rows, retaining the existing crossing policy. F6 makes the header honest
  about fallbacks. F7 retains the out-of-Files prerequisite tests (D-6803). F8 widens the actual plain-words read to
  include the new inline adapter error and its length pin, subject to R53. Named-unreadable and toast departures are
  D-6801 and D-6802; the dropped unprompted bullet remains R39. No acceptance of the new fix-round head is implied.
- **R53 (2026-10-24)**, B5's prerequisite question: F8's plain-words suite exists on merged main, not on its branch,
  and a clean branch has no ordinary sync trigger. Ruled: **deferred to landing, not waived or complete**. No
  speculative main absorption or copying/cherry-picking the missing suite. Complete F8 before landing once an
  authorized sync makes it available; the fresh handoff must name the fence explicitly.
- **R54 (2026-10-24)**, C1's post-conflict review (run 912, at `60bd4a863`): no new finding, complete mandatory
  panel (three Opus/high lenses and three Sonnet/high refuters per finding; no death, unverified lens or unexamined
  finding). The conflict resolves only the architecture map's K-row union; accepted implementation is otherwise
  unchanged, the limiter remains byte-identical to B4's, all named suites and both union mutants reproduce. R46's
  accepted items and C3 carries are not reopened. Ruled: land the refreshed head; run 803 is merging and #1217 queued.
  The C1/B5 second-lander fence remains: absorb under that recorded obligation, run transcript-ladder and
  bounded-pool, and measure the release-outside-finally mutant at `bounded.ts` after C1's move.
- **R55 (2026-10-24)**, T1c's status, not a handoff: #1313 opened and the worker reports its first full PWA run green,
  twelve mutation rows red and a before/after render matrix. These are claims awaiting independent review. R49 stays
  in T1c, not a later wave; it first waited for B2's proved merge. That merge is now proved and the wake was sent.
  A branch-local numeric citation in `audit.mjs` failed the required server check; the worker corrected it to
  `sheet.tsx#Sheet` and reports targeted gates green. T1c still owes the inherited fixes and a fresh verified handoff.
- **R56 (2026-10-24)**, the operator explicitly chose **One Main Merge** after T1c measured the R49 prerequisite
  decider, matrix and whole/tail code absent from its otherwise clean branch. This is a one-time exception: one
  fresh-fetch `git merge origin/main` into T1c's own workspace branch, solely to obtain the now-merged prerequisite
  and finish R49 in this PR. No rebase, force-push, update-branch, cherry-pick or second absorption from this ruling;
  the general sync contract and B5's separate fences are unchanged. Preserve the newer citation fix; claim the added
  paths; each inherited fix gets its own commit. Report the actual main SHA and resolution, rerun targeted T1c/R49,
  citation, ring, contrast and typecheck gates, and require terminal-success CI including `test (server)` before a
  fresh handoff. No second full local PWA or full local server run. A fresh independent whole-branch review follows.
- **R57 (2026-10-24)**, the operator repeated the desktop floating-plus complaint with a screenshot: it duplicates
  the top-right New session door and covers session rows. This reaffirms T2b's existing desktop removal; the top-right
  door and phone behaviour stay. It is not a new instruction to skip Step 1's landing gate.
- **R58 (2026-10-24)**, verified source-merge and run state: T1b (#1150, `30f9bdc9f`) and C10 (#1197, `7a3104abd`)
  merged and their runs closed; the R35 to R48 ledger #1303 merged as `78270966c`. B2, B3 and T2g then merged at their
  original reviewed PR heads; final closes answered done and released, and each closed row was re-read as done. The
  server owns any deferred child cleanup; this session performed none. B5's fresh head `77f723f66` is verified and
  awaiting review run 913, successfully dispatched; F8 still blocks landing. T5a #1316 is working, not a handoff:
  after its first status it corrected a missing `hibernate-census` row for the exited-tier reader in
  `sessionEntries.ts`, and is rerunning CI at `ee4ad7993`. Its first-full-suite, mutation and render claims are not
  independently accepted; the out-of-Files census edit is for the eventual reviewer to assess. T1c acknowledged R56.
  Daily-cap refusals still measured 64/64 after the operator chose 96; later successful dispatches are not
  evidence that the setting changed. No polling dispatcher is running.
- **R59 (2026-10-24)**, B5's fix round 1 review (run 913, at `77f723f66`): complete mandatory panel, no dead or
  unverified lens or unexamined finding; nineteen table rows red, plus separately disclosed surviving mutants, and
  sixty-four fresh render cells with reused before images. The review closed successfully before this ruling.
  Sent back as fix round 2: N1 pins the unnamed post-create generation guard alone with an already-live answer
  after dismissal and reopen; N2 completes deliberate-crossing survival and current-tag-at-Start cases, held by the
  withdraw-every-changed-row mutant. N3 keeps the existing pre-live snapshot as disclosed defence in depth, pinned
  only at its policy owner; the sheet case is renamed to say workspace rows are excluded for not being main
  checkouts. N4 drops the vacuous root-fallback assertion from the bare-sheet case, keeping real error assertions.
  N5 corrects the taken-slug-suffix premise, retaining navigation to the returned id. N6 needs nothing at the tip.
  F1 to F4, F6 and F7 otherwise reproduce; F5's code is correct but its tests were partial. F8 remains incomplete
  under R53; neither R56 nor this fix round authorizes B5 to absorb main. The C1 second-lander fence remains. The
  reviewer used a fixed process cap, so the next mutation evidence must record the measured thread count plus 1500,
  not claim that a fixed bound proved the required procedure. Run 875 is working; fix-round mail sent. The separate
  read-only check of this ledger batch through R58 returned no additional finding; this entry records the later report.
- **Open with the operator:** Q2 to Q9 in the plan's §Operator questions (Q1 and Q10 to Q14 are ruled), each with a recommended
  default the tasks build until ruled; and R39's question, whether an unprompted signal (`turnAt` null with a fresh
  generation) becomes a task of its own.

## Carried constraints

- #1116's content has merged as #1139 (`f0e873c5d`); #1116 is closed. Before T2b, T2d, T2f or T3e dispatches, their
  hunks are re-measured against `main`.
- T2b carries R13's two items.
- C3 carries R33's F9 (the `watch.ts` log line), R40's F1 to F3 (C2's comment, test title and case name) and R46's F1
  to F4 and F7 (C1's comments, the bounded pool's header and a case for a handoff that dips in a microtask).
- C6 carries R37's F4 (until C6, a fleet frame re-renders every mounted finished row with a live session) and R44's G1
  to G3 (C10's memo comment and two test comments).
- T1c carries R41's F4 (the inline key scope), R45's F1 to F4 (text fixes), and R49's false matrix row and honest
  whole/tail comments. R56 authorizes one prerequisite main merge for those otherwise absent B2 facts, not general sync.
- T5a carries R30's F1 to F5 (text only) and R41's three items: the command layer's restore goes through
  `focusShownLandmark`, and its F1 and F2 (`preventScroll` pinned, the `frame.tsx` docstring).
- T2d's Files gain `Rail.tsx` and one print cap (R32's F1 and F8). T1c, T2c, T2d, T5a, C3 and C6 carry theirs in the
  plan's text too.
- T3b carries R21's F2 (a needs-you row's state word on the context line, or a wrapping name, in Instrument's 340 px
  column), and R32's F2 (a two-line row with no context is 53 px).
- Landing order within Step 1: T1a, then T1b (R23's F5), then T1c.
- T2c carries R18's F1 to F6, S5a's minor findings on the strip it sorts next: the strip's "two columns" comment says
  four from 700 px (F1); `CompactGauges`' `grid` doc and `FleetScreen`'s phone-head comment are corrected or the arm
  goes (F2); a case proves a tap goes through the command layer, not a handler of the strip's own (F3); the reset
  countdowns are checked visible by their client rect (F4); a long label's spill into its neighbour card is seen (F5);
  the comments S5a lengthened are re-wrapped (F6). T2c also carries R41's F3 (the header of `release-waiting.test.ts`)
  and F8 (README's lead). R48 supersedes R27's shared row: bar, lanes row, banners, then the separate update line.
- T2f carries R51's F1 to F5: update fixture, column-presence assertions, table footer, frame/rail wording and row-6 reds.
- B3 R50 F1 to F3 remain unowned follow-ups; no merge silently assigns them. B5 F8 remains incomplete under R53.
- What the not-started skins tasks inherit is listed in the plan's §Carried into the skins plans.
- The fleet box's load swung between about 10 and 200 on 16 CPUs on 2026-10-22 (a restart at about 20:05Z); dispatch
  at most the tasks a step needs, and run every suite under the plan's load rules.

## Next-wave brief

On the next genuine mail wake, process and acknowledge incoming work first. Review 913 is closed and B5 is working
on R59's fix round 2; its next verified handoff gets a new review run, never a reuse of 913. B5 F8 and the C1/B5
second-lander limiter proof still block its landing. T1c is working under R56 and owes the R49 carry, targeted
post-merge gates and a fresh verified handoff; T5a is working and awaits CI before its handoff. Every new verified
handoff gets a fresh review run and the fixed held-out panel. Step 1 is reported complete only after T1c also merges,
with before/after phone and desktop screenshots, never from the worker's status.

As caps and fresh path claims allow, reconstruct and dispatch C6 (822, carrying R37 F4 and R44), C5 (821) and T3f
(800, a fresh unused workspace slug); T1b is merged. T2c (802) needs a rewritten R48 brief before dispatch: no compact
bar meters, full cards in a row under both bars, per-lane navigation and one shared reading/order/stepper owner.
It carries R18 and R41; S5b supplies the shared fold only after T2c. Do not reuse an older compact-gauge brief.
When C1 has merged: C3 (R33 F9, R40 and R46) and C4. C8 after C6; C9 after C6 and C8; C7 after C6, C8 and T1c.
T2b and T2d land only after Step 1, and T2f after T2d and T2g, with R51, each after its hunks are re-measured on main;
T3a to T3d after Step 2, T3e after T3c and T3d, T4a after T1c. B3's R50 follow-ups still need an owner.

The actual last cap refusal is 64/64, not proof of the chosen 96. Dispatch once on a wake and stop on a refusal;
no polling dispatcher. Keep queued branches frozen, land through the native queue, and close a producer only after
MERGED at its reviewed PR head. Never change another workspace or repository protection settings.
Each brief names the plan path, its task, the number it defines, the execution skill
(superpowers:subagent-driven-development with superpowers:test-driven-development), the routing row (a worker on a
spec'd plan), and the branch rule: commit on this workspace's own branch, never a separate feature branch.
