# Program: ws-slug-collision

Plan: `docs/superpowers/plans/2026-09-23-ws-slug-git-collision.md` (the worker commits it as its branch's first commit)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-mesa`   Workspace: a fresh child
Asked for by the operator 2026-09-23 ("can we fix the ccd bug too please?").

**What this program is.** `ccd ws-add` judges a slug free by the registry alone. A random draw can land on a
slug whose `ws/<slug>` branch survives from an older workspace, and `git worktree add` then dies after the
pick. Measured 2026-09-23: child-reclamation's review run 136 got a bare 502 on `ws/quiet-delta`
(a branch from 2026-09-17), and 27 of this repo's 33 `ws/*` branches had no registry row. The fix adds a
three-answer git/disk judgement beside the registry check at both ws-add call sites, placed so the frozen
citation corpus never moves.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | `_ws_slug_git_state` (free / taken / unmeasurable); the random loop, the `CCD_WS_SLUG` arm and the named-slug refusal consult it; S6-R11 | AGENT-FIRST (ccd only) | — | planned |

**Deviation block: five numbers, the first of them 3473** (allocated at run-open, 2026-09-23; floor now
3478). No number of it is spelled as a `D-` token here until the plan defines one.

**Sequencing.** Dispatched only after child-reclamation wave 1 (run 131, PR #175) merges and its run closes,
because run 131's claim 734 holds `ccd/ccd` and one coordinator never puts two of its workers on
overlapping claims. It ships in the release after its own merge, rolled out fleet box first.

## Decisions & deviations

- **2026-09-23 — opened.** The fix does not widen `_ws_slug_free`. That function's contract (every refusal is
  one `_ws_slug_residue` can name) and its `ws-gc` caller are registry-only; the git and disk judgement is
  its own helper with three answers, so an unreadable repository is never read as a free slug or as a taken one.

## Carried constraints

- `tmp-sweep.test.ts`'s "FAILS CLOSED" case reds on the fleet box on untouched main and passes in CI.
- The README anchors and the census move whenever another branch's `ccd/ccd` merges first; the second to
  merge re-points and re-measures.

## Next-wave brief

Wave 1: the plan above, Tasks 1–2, execution skill `superpowers:test-driven-development`. Worker route:
Opus·high, Sonnet subagents, workflows off, compact 40 (the matrix's spec'd-plan row).
