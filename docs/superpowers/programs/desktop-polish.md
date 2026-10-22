# Program: desktop-polish

Spec: `docs/superpowers/specs/2026-10-15-ccrc-two-skins-design.md` (the two skins; this wave amends its §6 inline-answer row, D-6326)
Plan: `docs/superpowers/plans/2026-10-22-desktop-polish.md`
Home project: `ccrc-pwa`   Coordinator: the coordinator session of this wave   Workspace: **a fresh child per task**
**Status:** planning (2026-10-22). The plan is in its docs PR.

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
| 1 | T1a (D-6324) | server: the structured ask outlives the 30-minute cut while its menu is up | — | planned |
| 2 | T1b (D-6325) | the ask is Claude's own question: who asks, plain words, Recommended tag, Other, one scroller, no pane text | — | planned |
| 3 | T1c (D-6326) | the ask answered inline in the pane at ≥900; a phone keeps the sheet | — | planned, after T1b |
| 4 | T2a (D-6327) | the update banner becomes one quiet line | — | planned, after Step 1 and #1116 |
| 5 | T2b (D-6328) | no floating `+` at the desk in Instrument | — | planned, after #1116 |
| 6 | T2c (D-6329) | gauges always print a number, name their window, never an empty bar | — | planned, after Step 1 |
| 7 | T2d (D-6330) | Inbox and Runs counts show only what waits on the operator | — | planned, after Step 1 and #1116 |
| 8 | T2e (D-6335) | Instrument's desk: no empty column, no second head in the list column, dense rows | — | planned, after Step 1 |
| 8b | T2f (D-6371) | Instrument's runs row and class chooser at the desk (Q5) | — | planned, after T2d |
| 9 | T3a (D-6331) | plain fleet words; one bucket vocabulary; the counts once | — | planned, after Step 2 |
| 10 | T3b (D-6332) | names whole where they fit; ⋯ revealed under a fine pointer | — | planned, after Step 2 |
| 11 | T3c (D-6333) | the header names the session; chips never cut at the desk; doors carry words | — | planned, after Step 2 |
| 12 | T3d (D-6334) | the inspector shows only sections with content and one honest routing line | — | planned, after Step 2 |
| 13 | B1 (D-6366) | a typed send waits long enough for its echo; a lost Enter reply does not end the proof | — | planned, beside Step 1 (Q6) |
| 14 | B2 (D-6367) | Retry resumes our own text | — | planned, after B1 |
| 15 | B3 (D-6368) | the drawer follows its pty; a phone's Return is Enter | — | planned, beside Step 1 (Q6) |
| 16 | B4 (D-6369) | the transcript search runs in parallel | — | planned, beside Step 1 (Q6) |
| 17 | B5 (D-6370) | New session opens at once; an unprompted session says so | — | planned, after B4 and T1a |

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
- **Open with the operator:** Q1 to Q6 in the plan's §Operator questions, each with a recommended default the
  tasks build until ruled.

## Carried constraints

- #1116 (W2 S5) is open and blocked; T2a, T2b, T2d and T2f wait for it and do not hold Step 3.
- What the not-started skins tasks inherit is listed in the plan's §Carried into the skins plans.
- The fleet box runs at a load average near 50 on 16 CPUs; dispatch at most the tasks a step needs, and run every
  suite under the plan's load rules.

## Next-wave brief

Dispatch T1a and T1b, and (under Q6's default) B1, B3 and B4, once the plan's docs PR has merged. Each brief names
the plan path, its task, the D-number it defines, the execution skill (superpowers:subagent-driven-development with
superpowers:test-driven-development), the routing row (a worker on a spec'd plan), and the branch rule: commit on
this workspace's own branch, never a separate feature branch.
