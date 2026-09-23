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
| 1 | `_ws_slug_git_state` (free / taken / unmeasurable); the random loop, the `CCD_WS_SLUG` arm and the named-slug refusal consult it; S6-R11 | AGENT-FIRST (ccd only) | #177 | **last fix round** 2026-09-23 — `ccrc-pwa-warm-hollow` (run 137; Opus·high, Sonnet subagents, workflows off, compact 40); review 141 at `e5238719`: 2 important + 6 minor |

**Deviation block: five numbers, the first of them 3473** (allocated at run-open, 2026-09-23; floor now
3478). No number of it is spelled as a `D-` token here until the plan defines one.

**Sequencing.** Dispatched only after child-reclamation wave 1 (run 131, PR #175) merges and its run closes,
because run 131's claim 734 holds `ccd/ccd` and one coordinator never puts two of its workers on
overlapping claims. It ships in the release after its own merge, rolled out fleet box first.

## Decisions & deviations

- **2026-09-23 — opened.** The fix does not widen `_ws_slug_free`. That function's contract (every refusal is
  one `_ws_slug_residue` can name) and its `ws-gc` caller are registry-only; the git and disk judgement is
  its own helper with three answers, so an unreadable repository is never read as a free slug or as a taken one.

- **2026-09-23 — wave-done at `e67c2df0` (PR #177); three numbers assigned before review.**
  - **The claim.** The frozen boundary measured at `ccd/ccd:19131`. The helper sits at 19276+, and every hunk
    above the boundary is line-neutral. S6-R11: README re-pointed; census unmoved (147/195/53/35,
    stated = base = tree). Ten mutation rows, each red.
  - **First full suite red, none of it the wave's:** the carried `tmp-sweep` case, plus load reds that were
    green alone.
  - **Departures ruled.** Three accepted and numbered from the block:
    - the README re-point under run 128's held claim (its coordinator agreed the second merger re-points);
    - two existing slug tests now plant a repo;
    - a toplevel proof, because git discovering an outer repository past a broken `.git` would read a taken
      slug as free.

    An empty directory at the worktree path now counts as taken. The plan's table specified that, so it is
    not a departure.
  - **Next.** One docs-only commit defines the numbers; then the held-out review.

- **2026-09-23 — review 141 at `e5238719`: two important findings, one of them the plan's own premise.**
  - **The panel.** Three lenses plus a git-first lens, 52 agents, 16 confirmed, none refuted. Frozen corpus
    unmoved, the refusal ahead of every mint, a free slug unchanged, `_ws_slug_free` untouched, fixture
    HOMEs only: all held.
  - **The plan was wrong.** It said `show-ref --verify` exits 1 only on an absent ref. Measured on git
    2.43.0, it also exits 1 for an unreadable or corrupt loose ref and for an unsearchable `refs/heads/ws/`,
    so "can't tell" folded into free (F2). Directory/file ref conflicts also read as free (F3), and an
    unsearchable worktree parent reads as free (F4). All three are fixed as D-3476.
  - **Test strength (F1).** Three existing tests now pass without a repo for the wrong reason. They get a
    repo, inside D-3474.
  - **Accepted as residual (F5).** The race between the judgement and `git worktree add`. git's own
    refusal stays the backstop, documented in the header.
  - **The rest.** A stale comment fixed in place (F6). "Not a slug" means "does not blame the slug", so no
    change (F7). The full mutation table goes in the PR body (F8).
  - **Named in advance as the last full fix round.**

## Carried constraints

- `tmp-sweep.test.ts`'s "FAILS CLOSED" case reds on the fleet box on untouched main and passes in CI.
- Inside a MARKED child (every session dispatched since v0.0.19), `session-hook.test.ts`'s "skips a scratch
  slug" case reds, because `os.tmpdir()` is the child's `~/.cc-tmp/<id>`. That is a wave-1 gap of
  child-reclamation, carried into its wave 3. It is not this programme's red: run that suite with
  `TMPDIR=/tmp`.
- The README anchors and the census move whenever another branch's `ccd/ccd` merges first; the second to
  merge re-points and re-measures.

## Next-wave brief

Wave 1: the plan above, Tasks 1–2, execution skill `superpowers:test-driven-development`. Worker route:
Opus·high, Sonnet subagents, workflows off, compact 40 (the matrix's spec'd-plan row).
