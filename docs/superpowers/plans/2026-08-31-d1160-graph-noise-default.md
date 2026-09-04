# D-1160 — ccrc poisoned the corpus, then refused the build over its own mess

> **Not a multi-task plan.** This is the ledger record for a single fix, written in plan
> shape because that is where this repo's deviation ledger lives.

**Goal:** Stop `ccd-graph-sweep`'s corpus guard from refusing a repo's build because of
files ccrc's own tooling wrote into that repo.

---

## What was measured

`_gs_guard` refuses a build when any path `detect()` picks up is not git-tracked. That
guard is correct and stays: an untracked file entering the corpus silently changes a
graph nobody can reproduce.

The problem is what ccrc itself leaves behind. Every repo a fleet session touches
acquires `.remember/` transcripts, `.superpowers/` specs, a `.claude/settings.json`,
sometimes a `CLAUDE.local.md` — none tracked, all picked up by `detect()`. The guard then
held ccrc's own artifacts against the repo and refused its build **for ever**.

Measured on the reference fleet, by re-running `detect()` against `git ls-files` for every
refused tree:

```
14 of 57 trees refused-by-guard
304 breach paths in total
  126  .remember/          }
   58  .superpowers/       }  186 paths — 61% — written by ccrc itself
    2  .claude/            }
  117  project files (the guard doing its job)
    1  .astro/
```

Five repos — **OpenClawHetzner, custom-tools, data-internal, intake-platform,
wt-model-rates-sync** — were blocked by *nothing but* ccrc's own artifacts (16/16, 22/22,
40/40, 16/16 and 19/19 of their breaches). Their graphs had gone 3 to 26 days stale.

## Deviations found

- **D-1160** (2026-08-31) — `ccd-graph-sweep` reads a per-repo noise list
  (`~/.ccrc/graph-noise/<repo>.list`) and nothing else, so the artifacts ccrc's own
  skills write into every repo counted as corpus breaches and refused those repos'
  builds indefinitely. A DEFAULT list (`_default.list`) now ships with ccrc and is
  UNIONED with the per-repo one, default first. It carries only ccrc's own footprint —
  `.claude/`, `.remember/`, `.superpowers/`, `CLAUDE.local.md` — and deliberately not a
  repo's own untracked files, where the guard is doing exactly its job and the answer is
  to track the file or write a `<repo>.list` beside the default. The `'!'` negation check
  now runs over EVERY source rather than one, because a default that could smuggle a
  re-include past a per-repo check would be worse than shipping no default at all.
  `ccd/graph-noise.default.list` (new, shipped), `ccd/ccd-graph-sweep` (`_gs_guard`),
  `ccd/ccrc` (`_inst_graph_noise`, converged not kept — ccrc owns this file, the
  operator owns `<repo>.list`), `deploy/deploy.sh` (the agent lane ships it too: a fleet
  host is deployed daily and installed rarely).

## A test of mine that was vacuous, caught by its own mutation

The negation test — "a `'!'` line in the DEFAULT refuses too, not just in the per-repo
list" — planted only the default. With one source present, "check the last source" and
"check every source" are the same thing, so the mutation that reduces the loop to
`"${noise_files[@]: -1}"` stayed **green** and the test proved nothing its name claimed.
It now plants both lists with the `'!'` in the default, i.e. in the source that is *not*
last, and the mutation reddens. Fourth instance this week of *tests pin shape, not
effect*; the first caught by the mutation table rather than by review.

Measured, three mutations, each red:

| mutation | result |
| --- | --- |
| drop `_default.list` from the sources | the default and union tests red |
| check `'!'` only in the last source | the negation test red (after de-vacuuming it) |
| `grep -v` instead of `grep -hv` | the union test red — filenames prefixed every pattern |

## Known, and deliberately not fixed here

Nine of the fourteen refused trees carry genuinely untracked project files — `rp-llm` 62,
`expoAI-assistant` 38, `clone-me` 10, `mm-data` 2, one further TypeScript project 2 (its
name is one of the literal real identifiers this public-bound repo's pre-push guard
refuses outright, and the count is the part that carries the argument anyway),
`synapsium-platform` 1 (`.astro/`), `MekWarLive` 1 and its worktree, `egress-cost` 1.
Those stay refused, and should: the guard is protecting a reproducible graph. Each is an
operator decision — track the file, or add a `<repo>.list`.
