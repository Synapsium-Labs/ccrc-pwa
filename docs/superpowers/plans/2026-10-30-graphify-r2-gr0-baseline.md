# Graphify revision 2, Task GR0: the measured baseline and the incremental-gap replay

**Plan:** `docs/superpowers/plans/2026-10-29-graphify-r2-shared-graphs.md`, Task GR0 (D-7346). **Spec:** `docs/superpowers/specs/2026-10-28-graphify-shared-graphs-design.md` §1.2, §1.4, §11 "Plan Task 0", §13.

**What this file is.** The plan's Step 4 says the coordinator writes GR0's tables into the plan's §Measured baseline as rev 1. The ledger guard (D-6926) forbids a non-ledger pull request to edit a merged plan, so the numbers land here, in a new file, and the coordinator folds them into the plan's §Measured baseline in the wave's ledger pull request (D-7577). Until then this file is the measured baseline that GR4's gate ("GR0 reported") and OA-GR2 read.

**Measured on 2026-10-30 (UTC), on the fleet box,** read-only towards every tree and every ccrc state file. Steps 1 and 2 are reads. Step 3's builds ran one at a time, each through `ccrc test --heavy --`, in one scratch directory under the box's `/tmp` that was removed afterwards. The scratch held a `git clone --shared --no-checkout` of this repository's main checkout and its own graph outputs, never the store path.

## Answer first

- **The one-day missing-edge share is 10.26%.** That is ten times the 1% that decides OA-GR2 (plan §Operator acts), so **OA-GR2 goes to the operator before GR4 is dispatched.**
- **The daily safety net is far too long. Only a safety net of about an hour stays under 1% on average.** The loss accrues with every incremental refresh: on day 1, about 215 edges for each 15-minute window in which main moved, or 0.22% of the graph a window. Day 1 had 47 such windows, about 2 an hour, so 1% is crossed after about 4 to 5 windows, about 2 to 2.5 hours at that pace. A `CCRC_GRAPH_FULL_REBUILD_SECS` of 3600 would hold the average gap near 0.5%. The worst case is not bounded, because one window can carry up to 200 files (`INCREMENTAL_MAX_FILES`), and the replay did not snapshot the chain inside a day.
- **The recommendation for OA-GR2: a full build on every refresh, box-wide.** Set `CCRC_GRAPH_INCREMENTAL_MAX_FILES=0`, so any diff makes the build full (spec §3.3's row "the diff names more than … files"). Spec G4 already offers this as "every refresh in full". The key is one line in the box's `ccrc.env` (spec §5), so the ruling covers all 24 repositories, not only this one. **Measured for this repository:** about 41 full builds a day at a median of 92 CPU-seconds is **about 63 CPU-minutes a day**, at 55 to 89 s wall and 3.6 to 4.6 GB peak each. **Estimated for the other 23 (§Fleet-wide below; their builds were not measured):** about 13 CPU-minutes a day more, so **about 75 to 80 CPU-minutes a day fleet-wide**, and at most about 130 if every other repository's full build cost as much as this one's largest. **Today's sweep** used **410.6 CPU-minutes** on its one full day in the journal, across every repository. So always-full is about 5 times cheaper than today by the estimate, and at least about 3 times by the bound. It serves a graph identical to a full build.
- **The alternatives cost less for this repository, but more fleet-wide, and they miss edges.** For this repository alone, incremental with an hourly full costs about 47 CPU-minutes a day, and incremental with the daily full about 20 CPU-minutes a day, missing 10% of edges by the end of the day. But `CCRC_GRAPH_FULL_REBUILD_SECS` is box-wide too, and the safety net builds a repository even when its main has not moved (spec §3.1 step 3: `fresh` needs the last full build to be younger than it). An hourly net would rebuild all 24 repositories every hour: about **220 CPU-minutes a day** fleet-wide by §Fleet-wide's estimate. Always-full builds only a repository whose main moved, plus the daily net for the rest.
- **What always-full adds is memory, and it is measured for this repository only.** Here it is 4.1 to 4.6 GB a refresh instead of 0.9 GB, inside the tests slice's 6 GB cap that it shares with test runs. 79 of the replay's 297 builds started with the other slot held, and none failed. Every other repository whose main moved in the week has a smaller graph than this one's tip, or one of about the same size (repository 3). The largest graph on the box, repository 8's, has not moved in the week and is built in full under every option (its first build and the daily net), so the ruling does not change its memory. §Fleet-wide lists what remains unmeasured.
- **Why the loss happens** (read from the pinned 0.9.9 engine, `graphify/watch.py#_rebuild_code`): the incremental path calls `extract()` on the changed files only, so cross-file symbol resolution sees only those files. A changed file's edges into any file outside that call's set are not rebuilt, and its old edges are evicted with its old nodes. 99.4% of day 1's missing edges are owned by a file that changed that day: 5,906 point from a changed file to an unchanged one, 4,130 between two files changed in different windows, and 61 otherwise. The edge kinds are `imports` 4,171, `calls` 2,289, `imports_from` 1,908 and `indirect_call` 1,000. Nodes are not lost: at most 16 nodes differ in either direction on any day. The loss never heals within the chain (below).

## Step 1: the disk baseline

The trees are the ones `ccd/ccd-graph-sweep#_gs_trees` enumerates, its six globs run by hand, with the same realpath top-level check and the same `.claude/worktrees` rule: a tree there counts only while a registered session's workdir names it. Each was measured with `nice -n 19 ionice -c3 du -sxk <tree>/graphify-out` where that is a real directory.

| | Count | `graphify-out` |
|---|---|---|
| Trees the sweep would enumerate | 208, every one with a real `graphify-out` directory, none a link | **12,045,744 KiB (11,763 MB)** |
| Repositories (distinct `--git-common-dir`) | 24 | |
| Candidates outside the sweep's set (a `.claude/worktrees` tree with no session) | 25: 2 with a stale graph, 23 with none | 31,512 KiB, not counted above |

Spec §1.2 measured 9,445 MB in 131 trees. The total grew by about a quarter in the days since.

Per repository: other repositories are numbered by size, since this repository is public.

| Repository | Trees | KiB | MB |
|---|---|---|---|
| this repository | 66 | 4,767,712 | 4,656 |
| repository 2 | 29 | 2,491,260 | 2,433 |
| repository 3 | 4 | 1,669,488 | 1,630 |
| repository 4 | 66 | 835,896 | 816 |
| repository 5 | 6 | 749,696 | 732 |
| repository 6 | 3 | 579,660 | 566 |
| repository 7 | 2 | 351,568 | 343 |
| repository 8 | 1 | 292,460 | 286 |
| repositories 9 to 24 (16) | 31 | 308,004 | 301 |
| **total** | **208** | **12,045,744** | **11,763** |

This repository's per-tree graphs: 24,424 KiB minimum, 76,588 KiB median, 87,180 KiB maximum.

## Step 2: the CPU baseline

Source: `journalctl --user -u ccd-graph-sweep.service -o cat | grep -E 'Consumed .* CPU time'`. **The journal holds 2.5 days, not 7.** It starts when the fleet changed hosts on 2026-10-28. The timer had been enabled continuously since 08:54 that day (96 passes on the one full day is every 15-minute slot).

| Day (UTC) | Passes | CPU, sum | CPU a pass, min / median / max | Wall a pass, min / median / max | Peak memory a pass, min / max |
|---|---|---|---|---|---|
| 2026-10-28 (from 08:54) | 55 | 260.2 CPU-min | 2.0 / 3.0 / 16.8 min | 2.0 / 3.1 / 12.9 min | 0.4 / 6.0 GB |
| 2026-10-29 (whole day) | 96 | **410.6 CPU-min (6.8 CPU-h)** | 2.0 / 3.8 / 12.0 min | 2.0 / 3.5 / 9.7 min | 0.4 / 6.0 GB |
| 2026-10-30 (to 21:23) | 85 | 329.8 CPU-min | 2.3 / 3.7 / 8.8 min | 2.3 / 3.5 / 7.6 min | 0.4 / 6.0 GB |
| all | 236 | 1,000.5 CPU-min over about 60.5 h (about 6.6 CPU-h a day) | | | |

56 of the 236 passes report exactly `6G memory peak`, the unit's `MemoryMax=6G`, and 63 report 5.5 GB or more. One pass, 2026-10-28 at 12:35, was SIGKILLed at its start timeout (`Failed with result 'timeout'`). The sweep's census over its last 10 passes counts these outcomes: fresh 1,980, refused-by-guard 84, stale-rebuilt 9, never-built 4, restamped 1. The 13 builds among them averaged 35 s.

The measured day (6.8 CPU-hours) sits inside spec §13's estimate of 6 to 27 CPU-hours a day for today's sweep.

## Step 3: the replay

**Window.** Main's tip, as this repository's main checkout on the box had last fetched it, was `be365308b` (2026-10-30 18:26 UTC). The base was main's last first-parent commit at or before the tip minus 7 days, `bea722cdf`. Between them main moved 427 first-parent commits. Grouped by 15-minute window (`floor(committer time / 900)`), that is 289 windows in which main moved. A day k (1 to 7) is the windows whose last commit falls in the k-th 24 hours after base. The day's last window's commit is that day's comparison point.

**Builds.** Each build was one call shaped like GR3's wrapper: `oom_score_adj` 1000, then `graphify.watch._rebuild_code(Path("."), changed_paths=…, force=True, acquire_lock=False)`, run with the checkout as the working directory and `GRAPHIFY_OUT` an absolute scratch path set before the process started. The environment was `GRAPHIFY_NO_BACKUP=1 PYTHONHASHSEED=0 GRAPHIFY_MAX_WORKERS=4` (the sweep's), the pinned venv's python with `-s -P`, under `nice -n 15`, inside `ccrc test --heavy --`. The process recorded its own scope's `memory.peak` and `cpu.stat` `usage_usec`, located from `/proc/self/cgroup`, before it read anything else. The chain was: one full build at base into the chain output. Then, per window, `checkout --detach --force` of the window's last commit and one incremental call. Its `changed_paths` were that window's `git diff -z --no-renames --name-only <previous window's commit> <commit>` as absolute paths. At each day's last commit there was also a cold full build into a second, emptied output (no cache), compared against the chain. The chain was never reset to a full build, so day k shows k days of accumulation.

**Edges** are compared as unordered node pairs, since the engine's `graph.json` is `directed: false` and `multigraph: false`. "Missing" means in the full build but not in the chain; "extra" means in the chain but not in the full build. "Newly missing" means missing that day and not missing the day before.

| Day | Day's commit | Files changed that day | Nodes, chain / full | Edges, chain / full | Edges missing | Share missing | Edges extra | Newly missing that day |
|---|---|---|---|---|---|---|---|---|
| **1** | `2b2ebef70` | 620 | 42,489 / 42,489 | 88,599 / 98,380 | 10,097 | **10.26%** | 316 (0.32%) | 10,097 (10.26%) |
| 2 | `d78cd3862` | 563 | 43,603 / 43,604 | 85,902 / 102,183 | 16,693 | 16.34% | 412 (0.40%) | 7,708 (7.54%) |
| 3 | `5068c2179` | 388 | 45,437 / 45,428 | 87,944 / 107,009 | 19,529 | 18.25% | 464 (0.43%) | 3,976 (3.72%) |
| 4 | `c332aca73` | 569 | 47,076 / 47,065 | 88,137 / 111,138 | 23,476 | 21.12% | 475 (0.43%) | 4,946 (4.45%) |
| 5 | `9eb2ff4c1` | 415 | 48,451 / 48,441 | 89,513 / 114,734 | 25,708 | 22.41% | 487 (0.42%) | 3,404 (2.97%) |
| 6 | `083ba2c18` | 496 | 49,942 / 49,933 | 92,323 / 118,537 | 26,774 | 22.59% | 560 (0.47%) | 2,747 (2.32%) |
| 7 | `be365308b` | 541 | 51,933 / 51,925 | 94,583 / 123,430 | 29,486 | 23.89% | 639 (0.52%) | 4,245 (3.44%) |

Even the lowest one-day increment (day 6, 2.32%, measured on a chain already missing many of the same files' edges) is above 1%. A loss is repaired only when the file that owns the edge and every file it points to are re-extracted in the same call, which a per-window diff rarely does.

**Cost of each call** (scope figures). For every call, the time from launching `ccrc test` to its exit was within 2.3 s of the engine's own wall time, so no build waited for a slot.

| Kind | Calls | Wall, median / max | Scope `memory.peak`, median / max | Scope CPU, median / max | CPU, sum | Changed paths a call, median / max |
|---|---|---|---|---|---|---|
| incremental | 289 | 27.1 / 46.8 s | 868 / 950 MB | 27.0 / 35.6 CPU-s | 131.7 CPU-min over 7 days (about 19 a day) | 8 to 13 / 200 |
| full (cold) | 8 | 69.5 / 89.1 s | 4,124 / 4,571 MB | 91.7 / 98.1 CPU-s | 12.1 CPU-min | — |

Per day: incrementals 33 to 47 a day, 14.6 to 22.1 CPU-minutes a day. Full builds grew with the corpus, from 3,617 MB / 75.7 CPU-s at base to 4,571 MB / 98.1 CPU-s at the tip.

The corpus is the scratch checkout's tracked files only, with no untracked files and no generated `.graphifyignore`: 40,323 nodes and 92,733 edges at base, 51,925 and 123,430 at the tip. Spec §1.4's 48,172 nodes / 114,127 edges came from a development machine at an earlier main. The incremental chain's shape (192 edges missing for 16 files there, about 16 a changed file here) matches.

## Fleet-wide: the other 23 repositories (estimated, not measured)

The review of OA-GR2 found that the recommendation covers the whole box, but Step 3 measured one repository. These figures bound the other 23 from reads only. No other repository's build was run, and no figure here is a measurement of cost.

**Read on 2026-10-31 (UTC).** For each repository, its largest tree's `graphify-out/graph.json` was counted for nodes and edges. The 15-minute windows in which main moved over 7 days were counted as in Step 3, from each repository's `refs/remotes/origin/HEAD` as its clone last fetched it. This repository counted 288 windows, against Step 3's 289. A repository that nobody fetched counts 0 even if its main moved. GR4's store fetches every 900 s, so it may see more movement than this table.

| Repository | Graph nodes / edges | Windows in 7 days | Full builds a day under always-full |
|---|---|---|---|
| this repository (Step 3's tip) | 51,925 / 123,430 | 288 | about 41 (measured) |
| repository 2 | 31,293 / 62,981 | 18 | about 2.6 |
| repository 3 | 52,241 / 119,718 | 8 | about 1.1 |
| repository 4 | 10,202 / 22,647 | 56 | 8 |
| repository 5 | 16,232 / 30,349 | 43 | about 6.1 |
| repository 6 | 20,527 / 34,413 | 1 | about 0.1 |
| repository 8 | 46,897 / 202,238 | 0 | the daily net only |
| the two of repositories 9 to 24 that moved | 9,445 and 11,572 edges | 32 | about 4.6 together |
| repository 7 and the 14 of repositories 9 to 24 that did not move | 92,082 edges in all, at most 32,837 each | 0 | the daily net only |

Repository 3's `graphify-out` is about 408 MB a tree (Step 1), but its `graph.json` is 72,840 KiB and its graph is about this repository's size. Most of the directory is not the graph, so the directory's size does not measure the build.

**The estimate** assumes a full build's CPU grows in proportion to its edges, at this repository's 92 CPU-s for 123,430 edges. On that assumption, the other repositories' full builds when main moved come to about 9 CPU-minutes a day. The daily net for the ones that did not move adds about 4. That makes about 13 CPU-minutes a day, and the fleet-wide always-full about 76 CPU-minutes. The hourly net in the Answer section rebuilds every other repository 24 times a day, which is about 175 CPU-minutes on top of this repository's 47.

**The bound** does not rely on proportion. It costs every other full build at this repository's largest, 98 CPU-s, and repository 8's at 1.64 times that (its edges against this repository's): 22.6 moved windows a day come to about 37 CPU-minutes, and the daily net for the 16 repositories that did not move to about 27. With this repository's 63, that is about 127 CPU-minutes a day.

**What stays unmeasured,** and is the operator's to accept or to have measured before ruling:

- **Any other repository's CPU and `memory.peak`.** The cheapest check is one cold full build each of repositories 3 and 8, through `ccrc test --heavy --`, shaped like Step 3's builds. Repository 3 is the largest graph that moves, and repository 8 the largest graph on the box.
- **Who reached the sweep's 6 GB peaks.** 56 of the 236 passes in Step 2 report exactly the unit's `MemoryMax=6G`. Today's sweep builds per tree inside its own unit, and `memory.peak` counts page cache, so the journal does not say which build, if any, came near the cap. GR4's builds each run in their own `ccrc test --heavy` scope, so these peaks do not carry over to GR4.
- **A per-repository setting.** Spec §5 has none. If the operator wants always-full for this repository only, the spec needs a per-repository override, which neither GR2's table nor the plan has. Without it, the choice is box-wide: always-full for every repository at the estimate above, or the daily net for every repository with this repository's 10% loss.

GR4's done check (OA-GR3) reads a week of the journal and measures the fleet-wide figure that this section estimates.

## Verify (plan Task GR0)

- **`ccrc test --status` before every build:** 297 status calls for 297 builds. Every one had rc 0 and a line matching `ccrctests.slice holds … of its 6.0G memory cap`, so the replay never stopped. Slots at the check were 0 of 2 held for 218 builds and 1 of 2 held for 79. Other runs sometimes waited behind them, but no build of the replay waited.
- **Every build succeeded on its first try:** 297 calls with rc 0, none retried.
- **The scratch directory is removed** (1.1 GB at the end).
- **`git worktree list` of the main checkout:** 97 worktrees before, 99 after. The two added were workspaces created by sessions during the run, and none is the replay's (the replay made a separate `--shared` clone, never a worktree).
- **Tree `graphify-out` mtimes:** recorded for all 210 trees with a real directory before and after. 4 changed, and each of the 4 is a tree the live sweep built during the run, by the `graph-sweep: build <tree>` lines in `~/.ccrc/graph-sweep.log`. None changed otherwise.

## Found while measuring

- **The sweep is not held.** On 2026-10-30 `ccd-graph-sweep.timer` was enabled and active and `~/.ccrc/graph-sweep-paused` did not exist. So the plan's `main` row ("the sweep held by its disabled timer") does not describe the box, and OA-GR0 (D-7365) has not been done. GR0 changed neither. Step 2 has data because the sweep ran.
- **The journal holds 2.5 days,** so Step 2's per-day figure is one whole day plus two part days, not 7 days. The done check (OA-GR3) reads a week of journal and should have one by then.

## Deviations

- **D-7577 (2026-10-30)** — `gr0-baseline-file`: GR0's measured baseline is recorded in this new file instead of the merged plan's §Measured baseline (the ledger guard, D-6926, forbids editing a merged plan in a non-ledger pull request); the coordinator folds it into the plan as rev 1 in the wave's ledger pull request.
