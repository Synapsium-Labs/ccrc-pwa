# Program: desktop-polish

Spec: `docs/superpowers/specs/2026-10-15-ccrc-two-skins-design.md` (the two skins; this wave amends its §6 inline-answer row, D-6326)
Plan: `docs/superpowers/plans/2026-10-22-desktop-polish.md`
Home project: `ccrc-pwa`   Coordinator: the coordinator session of this wave   Workspace: **a fresh child per task**
**Status:** planning (2026-10-22). The plan is in its docs PR.

**What this program is.** The operator reviewed the desktop experience (Refined, about 2000 px wide, a child
session waiting on a question) and was "not super happy". They accepted a defect list in order ("Order accepted,
please proceed"): Step 1, the ask shows Claude's own structured question, says who asks, uses plain words, and is
answered inline in the session pane at ≥900 (a phone keeps the sheet); Step 2, calmer chrome (the update banner a
quiet line, no desk FAB, legible gauges, counts of only what waits on the operator); Step 3, plain words in the
fleet list, the session header and the inspector. One task is one PR, one wave, one run.

## Waves

| # | task | scope | PRs | state |
|---|---|---|---|---|
| 1 | T1a (D-6324) | server: the structured ask outlives the 30-minute cut while the same call is pending | — | planned |
| 2 | T1b (D-6325) | the ask is Claude's own question: who asks, plain words, Recommended tag, Other, one scroller, no pane text | — | planned |
| 3 | T1c (D-6326) | the ask answered inline in the pane at ≥900; a phone keeps the sheet | — | planned, after T1b |
| 4 | T2a (D-6327) | the update banner becomes one quiet line | — | planned, after Step 1 |
| 5 | T2b (D-6328) | no floating `+` at the desk in Instrument | — | planned, after #1116 |
| 6 | T2c (D-6329) | gauges always print a number, name their window, never an empty bar | — | planned, after Step 1 |
| 7 | T2d (D-6330) | Inbox and Runs counts show only what waits on the operator | — | planned, after Step 1 and #1116 |
| 8 | T3a (D-6331) | plain fleet words; one bucket vocabulary; no doubled counts | — | planned, after Step 2 |
| 9 | T3b (D-6332) | names whole where they fit; ⋯ revealed under a fine pointer | — | planned, after Step 2 |
| 10 | T3c (D-6333) | the header names the session; chips never cut at the desk; doors carry words | — | planned, after Step 2 |
| 11 | T3d (D-6334) | the inspector shows only sections with content and one honest routing line | — | planned, after Step 2 |

## Decisions & deviations

- **R1 (2026-10-22)**, the operator's brief: the defect list and its order are accepted; the design rules for the ask
  (structured, never pane text, who asks, plain words, inline at ≥900, phone keeps the sheet, routing and answer path
  unchanged); every width works; renders at 360/390/1280/1920 × both skins × dark and light against `origin/main`;
  adversarial review before landing; landing through the merge queue.
- **R2 (2026-10-22)**, measured before planning (read-only): the sheet already prefers Claude Code's structured
  AskUserQuestion payload, which the session hook copies verbatim; the scraped sheet takes over when that copy ages
  past 30 minutes, which 29% of 271 answered asks on the fleet box did, and for a moment on every connect. T1a and
  T1b close both.
- **R3 (2026-10-22)**, the deviation block D-6324 to 6335 was issued before planning; one number per task, 6335 spare.
- **R4 (2026-10-22)**, landing: the merge queue's method is squash, so a PR is enqueued with
  `gh pr merge <n> --match-head-commit <sha>` (no `--squash` flag: the queue applies its own method; never `--admin`).

## Carried constraints

- #1116 (W2 S5) is open and red; T2b and T2d wait for it. Every other task stays line-disjoint from its hunks.
- What the not-started skins tasks inherit is listed in the plan's §Carried into the skins plans.

## Next-wave brief

Dispatch T1a and T1b in parallel once the plan's docs PR has merged. Each brief names the plan path, its task, the
D-number it defines, the execution skill (superpowers:subagent-driven-development with
superpowers:test-driven-development), the routing row (a worker on a spec'd plan), and the branch rule: commit on
this workspace's own branch, never a separate feature branch.
