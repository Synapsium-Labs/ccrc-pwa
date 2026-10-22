# Program: desktop-polish

Spec: `docs/superpowers/specs/2026-10-15-ccrc-two-skins-design.md` (the two skins; this wave amends its §6 inline-answer row, D-6326)
Plan: `docs/superpowers/plans/2026-10-22-desktop-polish.md`
Home project: `ccrc-pwa`   Coordinator: the coordinator session of this wave   Workspace: **a fresh child per task**
**Status:** under way (2026-10-22). The plan landed as #1129; rev 3, the operator's later notes, as #1138.

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
| 1 | T1a (D-6324) | server: the structured ask outlives the 30-minute cut while its menu is up | #1133 | fix round 1 (review 796, R10), run 782 |
| 2 | T1b (D-6325) | the ask is Claude's own question: who asks, plain words, Recommended tag, Other, one scroller, no pane text | — | dispatched, run 783 |
| 3 | T1c (D-6326) | the ask answered inline in the pane at ≥900; a phone keeps the sheet | — | planned, after T1b |
| 4 | T2a (D-6327) | the update banner becomes one quiet line, dismissible until a newer release | — | planned, after Step 1 and #1116's content |
| 5 | T2b (D-6328) | no floating `+` at the desk in Instrument | — | planned, after #1116 |
| 6 | T2c (D-6329) | gauges most free first in a full-width row; always a number with its window; never an empty bar | — | planned, run 802 (cap), ahead of the step order (Q1 ruled) |
| 7 | T2d (D-6330) | Inbox and Runs counts show only what waits on the operator | — | planned, after Step 1 and #1116 |
| 8 | T2e (D-6335) | Instrument's desk: no empty column, no second head in the list column, dense rows | — | planned, run 788, ahead of the step order |
| 18 | T2f (D-6371) | Instrument's desk column: no count line, no runs row, the chooser in project mode (Q5) | — | planned, after T2d |
| 9 | T3a (D-6331) | plain fleet words; one bucket vocabulary; the counts once | — | planned, after Step 2 |
| 10 | T3b (D-6332) | names whole where they fit; ⋯ revealed under a fine pointer | — | planned, after Step 2 |
| 11 | T3c (D-6333) | the header names the session; chips never cut at the desk; doors carry words | — | planned, after Step 2 |
| 12 | T3d (D-6334) | the inspector shows only sections with content and one honest routing line | — | planned, after Step 2 |
| 13 | B1 (D-6366) | a typed send waits long enough for its echo; a lost Enter reply does not end the proof | — | dispatched, run 784 |
| 14 | B2 (D-6367) | Retry resumes our own text | — | planned, after B1 |
| 15 | B3 (D-6368) | the drawer follows its pty; a phone's Return is Enter | — | planned, run 785 (cap) |
| 16 | B4 (D-6369) | the transcript search runs in parallel | #1136 | awaiting review, run 786 (review run 798 waits on the cap) |
| 17 | B5 (D-6370) | New session opens at once; an unprompted session says so | — | planned, after B4 and T1a |
| 19 | S5 (W2, D-5471) | Refined's phone header and FAB, landed by a superseding PR for the unowned #1116 | #1139 | awaiting review, run 787 (review run 799 waits on the cap) |
| 20 | S18 (W2, D-5479; D-6389) | Instrument on a desk and Refined on a phone by default, brought forward | — | planned, run 801 (cap) |
| 21 | T3e (D-6385) | the right-side inspector hides and shows, per device | — | planned, after T3c, T3d, T2e and #1116 |
| 22 | T3f (D-6386) | Done above Working when grouped by status | — | planned, run 800 (cap) |
| 23 | T4a (D-6387) | colour where the machine speaks: tool boxes, inline code, failed calls | — | planned, after T1c |
| 24 | C1 (D-6388) | registry reads bounded | — | planned, run 803 (cap) |
| 25 | C0 | the console's responsiveness, measured (research, no PR) | — | running as the coordinator's own measurement (R11) |

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
- **Open with the operator:** Q2 to Q9 in the plan's §Operator questions (Q1 is ruled), each with a recommended
  default the tasks build until ruled.

## Carried constraints

- #1116 (W2 S5) is open, blocked and unowned; run 787's #1139 supersedes it (R9) and is in review. T2a, T2b, T2d and
  T2f wait for its content and do not hold Step 3. #1116 is closed pointing at #1139 once that merges.
- What the not-started skins tasks inherit is listed in the plan's §Carried into the skins plans.
- The fleet box runs at a load average near 50 on 16 CPUs; dispatch at most the tasks a step needs, and run every
  suite under the plan's load rules.

## Next-wave brief

As slots free, dispatch in this order: the review runs 798 (B4) and 799 (S5), then T2e (788), B3 (785), T3f (800),
S18 (801), T2c (802) and C1 (803). Each brief names the plan path, its task, the number it defines, the execution skill
(superpowers:subagent-driven-development with superpowers:test-driven-development), the routing row (a worker on a
spec'd plan), and the branch rule: commit on this workspace's own branch, never a separate feature branch. Step 1's
T1c dispatches when T1b has merged; T2a, T2b, T2d and T2f when #1139 (S5's content) has merged and their hunks are
re-measured against it; B5 when B4 and T1a have merged; B2 when B1 has.
