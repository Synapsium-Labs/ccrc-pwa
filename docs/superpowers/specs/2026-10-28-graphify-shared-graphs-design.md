# Graphify on the fleet, revision 2: shared base graphs per repository, overlays only where a session keeps querying — design

**Date:** 2026-10-28 · **Status:** draft for operator review · **Branch:** `docs/graph-design-v2`
**Revision 2 of this draft** (after review): one config file and one parser for every reader (§4.2); bases are
always full builds, and overlays are the only patch path (§5.3, G11); the engine invocation is fixed, covering
cwd, root, lock, queue and `GRAPHIFY_OUT` (§5.3); overlay eligibility is counted on the patch set, not on branch
size (§6.2); a tick-and-due-check replaces the `.path` unit (§10); the census gains `jobs[]`, with every reader
listed (§10).
**Replaces:** the **Store** ruling of `2026-08-27-graphify-fleet-integration-design.md` (§2, §3.4, §D, the
`workspace-graph-store` / `project-graph-store` rows of §7) and the sweep body of its §C.
**Keeps:** the engine pin and its provisioning (§A), skill convergence (§B), AST-only depth (Appendix A), the
pre-build corpus guard (§E, moved out of the trees), the census vocabulary (§C.3), the "zero trees probed is an
error" rule (§C.4), and the read side of `2026-09-02-graphify-read-side-ccrc-level-design.md` and
`2026-09-09-graphify-compaction-card-design.md`, retargeted to the new store (§9 below).

## 0. Answer first

The operator's objection is right: one full graph per worktree is the wrong unit. On the reference fleet it means
131 graphs, 9.4 GB, and a sweep that spends between 4 and 17 CPU-minutes of every 15-minute pass rebuilding whole
graphs of a repository whose worktrees each change about 0.4% of its files.

The new unit is **one base graph per repository per nearby commit**, shared by every tree of that repository,
plus a small **overlay** built only for a tree whose session keeps querying and whose branch is small enough to
patch. Concretely:

1. **Bases** are immutable graphs keyed by `(commit, engine pin)`, built **in full** from `git archive <commit>`
   in a store outside every tree. A repository keeps a few of them (default 6): the main-line tip, plus the
   merge-bases its worktrees actually sit on. Each tree is served the base whose commit is nearest its own
   merge-base, and a tree more than 50 files from every base asks for one at its merge-base.
2. **Overlays** are built lazily: only after a session in that tree has made 2 graph queries (a query forced by
   the search gate does not count), only when the tree's `HEAD` differs from its served base by 100 files or
   fewer, and keyed by the tree's `HEAD^{tree}`, so two trees with the same content share one. They are built by
   the engine's own incremental path, `_rebuild_code(changed_paths=…)`, not by a ccrc-written merger. An overlay is
   the only patched graph in the design; bases are never patched (§5.3, G11).
3. **One config file**, `~/.ccrc/graph.env`, read by one parser, is the only place a deployment sets any of this.
   The sweep, the session hook, the doctor, `ccrc install` and `ccrc uninstall` all read it the same way (§4.2).
4. **Each tree holds one ignored symlink**, `graphify-out -> <store>/<repo>/trees/<tree-key>`. Every existing
   reader keeps working unchanged in shape: the skill's fast path, `graphify query`, the card, the gate, the
   compaction helper.
5. **When a tree has no overlay**, the card tells the session exactly which files its branch changed relative to
   the graph, so a session that asks one question (129 of 197 measured sessions) still knows where the graph is
   blind. That costs one `git diff --name-status`.

Build cost then grows with how often each repository's main line and merge-bases move, and with how many sessions
query a branch more than once — not with the number of worktrees.

---

## 1. What this replaces, and why

### 1.1 The ruling being replaced

The 2026-08-27 operator decision table recorded: **Store — per-tree, `GRAPHIFY_OUT` unset, graphify's default
`<tree>/graphify-out/`, excluded via `<repo>/.git/info/exclude`.** It rested on three measured results in its
§3.4. Each is re-examined here; two still hold and the design keeps them, one is answered differently.

| 08-27 result | Still true? | How this design treats it |
|---|---|---|
| "Cache sharing is inexpressible" (`cache_dir` derives only from `GRAPHIFY_OUT`) | True, and worse than stated: the per-file cache is **bypassed entirely for JS/TS** (`extract.py:92` `_JS_CACHE_BYPASS_SUFFIXES`; `:16388-16393`, `:16167`). The sweep log's 10,078 "N/N uncached files (100%)" lines are this. Even a perfect cache saves at most about 34% of a build (§2.3). | Not relied on. The unit of reuse is the whole graph, not the per-file cache. |
| "A shared per-project store livelocks" (one `built_at_commit`, trees on different branches, 8 rebuilds in 8 visits) | True of **one mutable `graph.json` per repo**. | Bases are **immutable and content-addressed by commit**. Nothing alternates: a tree selects among existing bases and never rewrites one. Overlays are keyed by tree content. |
| "An ignored in-tree store needs no cleanup code" | True, and it is the property worth keeping. | The tree now holds only an **ignored symlink**. Measured: with `graphify-out` (no trailing slash) in `info/exclude`, `git check-ignore` passes, `git worktree remove` succeeds without `--force`, and the symlink target is left intact. The store therefore needs a collector, which §15 adds. |

### 1.2 The measured facts that decide it

All counts measured 2026-10-28 on the reference fleet's fleet box, read-only and at idle priority. No transcript
or question text was read out; only counts.

**Usage — sessions do use the graphs, and they use them about main-line code.**

- graphify's own query log: 10,312 queries from 2026-07-22 to 2026-10-28, rising monthly (Jul 258, Aug 1,315,
  Sep 2,699, Oct 6,040); typically 150 to 300 a day over the last 14 days. 94.5% are `query`.
- 8,335 queries went to a worktree's graph, 1,970 to a main checkout's.
- Session transcripts, last 21 days, 3,625 deduplicated graph commands: **98.0% queried the session's own tree**;
  1.7% another repository; one query another worktree of the same repository; **none** queried the main
  checkout's graph from a worktree. Sessions do not choose a graph — whatever sits at `graphify-out/` in their cwd
  is what they read. Routing to a shared graph must therefore happen at that path, not by asking sessions.
- Queries per session: p50 1, p90 23, max 828. **129 of 197 sessions ran exactly one query.**
- In 14% of transcript files the first query came right after a search-gate denial.
- For 2,580 worktree queries whose tree still exists and has branch changes: the query names a changed file's
  stem in **11.9%**; the result cites a changed file in 36.8% (inflated: results are about 300 nodes and 6.3k
  chars); **neither in 58.2%**. Reading: at least about 58% of queries concern existing code only, at most about
  12% are directly about the branch's own changes.
- Per query: p50 1.88 s, p90 4.95 s; results sit at the token budget (p50 6,300 chars).

**Cost — almost all of it is rebuilding near-identical graphs.**

- 131 trees in the last census pass; 121 worktrees across 14 repositories. This repository alone has 63 trees
  (62 worktrees, 61 of them carrying a graph).
- Disk: 9,445 MB of `graphify-out` in total; this repository's trees 4,128 MB (about 53 MB `graph.json` + 21 MB
  cache + 0.6 MB manifest + 0.5 MB report each, about 48k nodes).
- This repository's worktrees: median 12 commits ahead, about 35 behind `origin/main` (1 to 889); **files changed
  versus their merge-base: median 15.5, p90 34, max 80 of about 4,015 tracked (≈0.4%)**. Files differing from the
  *current* main tip: p50 323, p90 1,738. The 62 worktrees share **25 distinct merge-bases**; the 5 most common
  cover 33 trees. `origin/main` moved 348 commits touching 1,817 files in 7 days.
- Sweep passes (the journal holds one day since the fleet changed hosts): 4m01s to 16m48s CPU per pass, 3m35s to
  12m51s wall, peak memory 4.6 to 6.0 GB. The last pass was SIGKILLed at its start timeout. The timer is currently
  disabled pending this redesign.
- Census, 10 passes: fresh 1,139, refused-by-guard 98, stale-rebuilt 16, never-built 11, restamped 1. A
  head-moved rebuild of one of this repository's worktrees costs 69 to 84 s; a cold build 65 to 77 s.
- The sweep log records 11,007 `graphify update` runs over its life, every one a full re-extraction.

**Engine — what 0.9.9 can and cannot do** (paths under the venv's `site-packages/graphify/`):

- **Incremental update exists in the library, not the CLI.** `watch.py:660` `_rebuild_code(watch_path, *,
  changed_paths=None, …)` re-extracts only `changed_paths`, preserves unchanged files' nodes from the existing
  graph and evicts deleted paths (`watch.py:676-679`, `:782-840`). Clustering still runs over the whole merged
  graph (`watch.py:955`). The CLI `graphify update` never passes `changed_paths` (`__main__.py:3827`).
- **Merging is union only.** `merge-graphs` prefixes every node by repo tag (a cross-repo union);
  `merge-driver` is an un-prefixed union capped at 50 MB / 100k nodes (`__main__.py:3933-3934`), below this
  repository's graph size. Neither subtracts a base or overrides a base's nodes for changed files.
- **`GRAPHIFY_OUT` accepts an absolute path** (`paths.py:23`), so the engine can build into the store.

### 1.3 The measurement that shapes the overlay

Building this repository's `origin/main` (4,104 tracked files) with the pinned engine and 4 workers, on a
development machine:

| | Full build | Patch of 16 changed files via `_rebuild_code(changed_paths)` |
|---|---|---|
| Wall time | 77.4 s | 36 s |
| Peak memory | 4.2 GB | 1.25 GB |
| Result | 48,172 nodes / 114,127 edges | 192 edges missing versus a full build, nearly all touching the changed files |

Full-build phases: `extract()` 57.1 s, of which per-file parse ≈26.5 s and cross-file symbol resolution
(`_augment_symbol_resolution_edges`, which re-parses every JS/TS file over the whole corpus) 30.6 s; whole-graph
work after extraction ≈20 s. Adding neighbour files to a patch made the loss **worse** (192 → 648 missing edges),
so the design keeps patches small rather than widening them.

---

## 2. Rejected alternatives, recorded so no later PR relitigates them

| Alternative | Why not |
|---|---|
| **Keep per-tree stores, share the per-file cache** | The cache is bypassed for JS/TS; even a perfect cache saves ≤34% of a build; sharing needs a wrapper overriding a private module global. Still one 53 MB graph per tree. |
| **Main tip only, one graph per repository** | Cheapest, but worktrees sit a median 35 commits behind main and differ from its tip in a median 323 files, so even "existing code" answers would describe code the tree does not have. Its good ideas (one resolver, a small `meta.json`, publish checks with an atomic swap, periodic full rebuilds, a diff notice, configurable gate limits) are grafted in below. |
| **Base plus an eagerly materialized overlay for every tree** | Rebuilds a per-tree graph for every tree that queries — the cost the operator called extreme — and needs a ccrc-owned graph merger. That merger is the riskiest part: node ids for colliding names can differ between overlay and base, and a renamed symbol loses its callers. Its good ideas (engine pin in each base's identity, serve-the-base fallback on timeout, optional untracked files marked partial, moving `memory/` into the store) are grafted in below. |
| **Query-time merge without writing a file** | Would reimplement the CLI verbs (`__main__.py:2924-3015` loads one JSON file per call). |
| **A `graphify` shim on PATH that rewrites `--graph`** | A new interception point on every session's command line; the symlink achieves the same routing with no code on the query path. |
| **Patched bases** (a new base patched from the nearest retained one, with a full build every N generations) | Its own thresholds kill it: merge-base and tip demand fire only once the nearest base is far, which is exactly when a patch is out of its size limit, so almost every base would be a full build anyway. Where it could apply (tip bases, 4 a day here), it saves about 6 CPU-minutes a day for this repository (§13). It costs a patch-chain state (generation counts, full-ancestor age) and a drift class bases otherwise do not have. Overlays keep the patch path; bases are always full and therefore exact. |
| **A `ccd-graph-sweep.path` unit on the request files** | `PathChanged=` watches one path through inotify, non-recursively; per-repo request directories (`<store>/<repo-key>/requests/`) sit one level below a parent a static unit can name, and the hook touches an existing request on every query (150–300 a day), which would start a pass per query with no debounce. The sweep's own short tick with a due check (§10) gives the same latency with no new unit. |
| **Process environment as the config source** (today's `: ${CCRC_GRAPH_X:=…}`) | Four processes with four different environments (systemd unit, each session, the operator's shell, `ccrc install`) would each see their own values; nothing makes the hook and the sweep agree. One file, one parser (§4.2). |
| **Giving the store its own registered `git worktree`** | It would appear as a child of every main checkout in `ccd`'s worktree enumeration (`_ws_children`, reap and audit). Bases are built from `git archive` instead. |

---

## 3. Shape

```
<tree>/graphify-out ──symlink──▶ <store>/<repo-key>/trees/<tree-key> ──symlink──▶ views/<tree-key>.<gen>/
                                                                                   ├─ graph.json        ─▶ bases/<base-id>/graph.json
                                                                                   │                       or overlays/<ov-key>/graph.json
                                                                                   ├─ GRAPH_REPORT.md, .graphify_labels.json, manifest.json  (same target)
                                                                                   ├─ meta.json         (real file: what this tree is served, see §4.4)
                                                                                   ├─ .graphify_engine  (compatibility stamp, one release)
                                                                                   └─ memory          ─▶ ../memory/<tree-key>/   (writable; save-result)
```

The two-level link exists so the swap is one atomic `rename(2)`: the sweep builds a new `views/<tree-key>.<gen+1>/`,
then `mv -T` a fresh `trees/<tree-key>` link over the old one. The in-tree link never changes after it is created.
A reader that already opened the previous view's files keeps reading them; the old view is collected after a grace
period (§15).

---

## 4. Store layout and config keys

### 4.1 Layout

```
$CCRC_GRAPH_STORE/                          default $HOME/.ccrc/graphs
  .ccrc-graph-store                         marker written at creation; uninstall and the collector refuse a root without it
  requests/<repo-key>.<tree-key>            overlay request, ONE flat directory for the whole store (§6.1, §10)
  <repo-key>/                               basename of the main checkout + "-" + sha8 of realpath(git common dir)
    source                                  realpath of the common dir (identity, collision check)
    bases/<base-id>/                        base-id = <commit>-<engine pin>; IMMUTABLE once published (0444 files, 0555 dir)
      graph.json  GRAPH_REPORT.md  .graphify_labels.json  manifest.json  meta.json
    overlays/<ov-key>/                      ov-key = sha12(base-id, HEAD^{tree}[, untracked digest]); immutable once published
      graph.json  GRAPH_REPORT.md  .graphify_labels.json  manifest.json  meta.json
    trees/<tree-key> -> ../views/<tree-key>.<gen>     tree-key = sha12 of realpath(tree)
    views/<tree-key>.<gen>/                 see §3; plus tree.json {tree, repo_key, created}
    memory/<tree-key>/                      graphify save-result output, moved here from the tree
    index.json                              the sweep's selection table: bases, demand, per-tree served graph (sweep is its only writer)
  .last-pass                                the due check's stamp: last pass start + the requests/ mtime it saw (§10)
  .scratch/<job>/                           one job's whole working set, created empty and removed after the job:
    src/                                      the `git archive` export; the engine's cwd and scan root
    out/                                      the engine's GRAPHIFY_OUT (graph.json, manifest, labels, cache/, any lock or queue file)
    pub/                                      the publish staging copy
  .trash/                                   migrated in-tree dirs and collected views awaiting deletion
  store.lock                                held by the sweep for a pass
```

**One resolver.** `ccd/graph-resolve` (a sourced bash library) is the single definition of the config reader
(§4.2), `repo-key`, `tree-key`, the store root and "the source ref of this repository". The sweep, the exclude
writer, the session hook, the compaction-card path, the doctor, `ccrc install` and `ccrc uninstall` all source it.
No second spelling, and no caller reads a `CCRC_GRAPH_*` value from anywhere else.

### 4.2 Where config lives, and how every reader loads it

**The file.** `$HOME/.ccrc/graph.env`, operator-owned. It holds `KEY=value` lines, one per key, plus `#` comments.
It is not a shell script and is never sourced. `ccrc install` seeds it once with every key commented out at its
default, in the same seed-once way `ccrc.env` is seeded (`_inst_env`, D-88). After that ccrc never writes it again,
so the operator's edits are never fought. A missing file means "all defaults", not an error.

**The parser.** `graph-resolve` exposes `_gr_config_load`. It reads the file once per process and accepts only
lines matching `^CCRC_GRAPH_[A-Z0-9_]+=`. It checks each value against the key's type: a non-negative integer, a
size (`6G`), `on`/`off`, an absolute path, or a ref name. It then sets a shell variable of the same name. If a key
is unknown or a value fails its type, the parser drops that line, keeps the default, and records the line in
`GR_CONFIG_BAD`. The doctor reports what `GR_CONFIG_BAD` holds (§11). A bad line therefore never stops a pass and
is never silent.

**Precedence.** A built-in default is overridden by `graph.env`, and by nothing else. No process environment
overrides a key. That is what makes the four readers agree: whichever environment a reader starts in, it ends with
the same values.

**Test knobs.** The test harness isolates by `HOME`, as `ccd` and the sweep already do. A test writes its fixture
HOME's `graph.env`. The `: "${CCRC_GRAPH_…:=…}"` lines at the top of `ccd/ccd-graph-sweep` on `main`
(`BUILD_TIMEOUT`, `BUDGET`, `MAX_WORKERS`, the two retired escape keys, and `HOOKSTATE_FRESH_SECS` at :288) are
removed, and `graph-sweep.test.ts` moves its knobs into the fixture file.

**The store-root override and the sweep's no-override rule.** The sweep's header says "HOME-derived roots, no
override". That rule exists so that a fixture HOME is a complete isolation boundary. `CCRC_GRAPH_STORE` keeps that
property: the override can only come from `$HOME/.ccrc/graph.env`, which is itself under HOME. A test therefore
reaches a store outside its fixture only if its own fixture file says so. The header is reworded to say exactly
this: roots are derived from HOME, or from a file under HOME. The value must be an absolute path. It must not be
`/`, `$HOME`, or a path inside any tree the sweep enumerates; otherwise the parser drops the value (§11 reports
it). Every other root (`REG`, `PROJECTS_ROOT`, `WORKTREES_ROOT`, the venv, the census) stays HOME-derived with no
override.

**Who reads what.**

| Reader | Runs in | Loads config by | Keys it needs |
|---|---|---|---|
| `ccd-graph-sweep` | its systemd unit | `graph-resolve` → `_gr_config_load` at pass start. The unit gets **no** `EnvironmentFile=`, so systemd never parses the file a second way. | all except the gate keys |
| `ccd/session-hook.sh` | each session's environment | the same `_gr_config_load`, called lazily on the graph paths only (the card, the gate, the request touch) | `STORE`, `OVERLAY_*`, `GATE_*`, `CARD_DIFF_LIST_MAX` |
| `ccrc doctor` (`_check_graphify`) | the operator's shell | the same | all; it also reports `GR_CONFIG_BAD` |
| `ccrc install` / `update` | the operator's shell | the same, after seeding the file | the rendered unit values below |
| `ccrc uninstall` | the operator's shell | the same, **before** it touches anything | `STORE` |

**Rendered unit values.** Three values reach a unit file: `CCRC_GRAPH_TICK_SECS` (the timer's
`OnUnitActiveSec`), the service's `TimeoutStartSec`, and `CCRC_GRAPH_SWEEP_MEMORY_MAX` (the service's
`MemoryMax`). `TimeoutStartSec` is derived as `(BUDGET + OVERLAY_BUDGET) × BUILD_TIMEOUT + 600`. The shipped
`deploy/systemd/ccd-graph-sweep.{service,timer}` become templates with `@TICK_SECS@`, `@TIMEOUT_START_SECS@` and
`@SWEEP_MEMORY_MAX@` placeholders. `ccrc install` and `update` render them into a temporary file from the loaded
config and lay them down with `_inst_atomic`, as today. A change to any of those keys therefore takes effect at the
next `ccrc update`. The doctor WARNs when an installed unit's value differs from what the current config would
render (§11). The sweep also enforces its own pass deadline from the same formula, so a stale render is never
unsafe, only inexact. `CCRC_GRAPH_POLL_SECS` is deliberately **not** rendered. The sweep reads it on every tick
(§10), so changing the poll needs no reinstall.

**Uninstall.** `ccrc uninstall` resolves the store root through the same parser first. It removes that root only
if the root holds the `.ccrc-graph-store` marker; otherwise it prints that it kept the path and why. It removes the
in-tree links it can find. It keeps `graph.env`, which is operator-owned. `ccrc uninstall --purge`, which already
purges `~/.ccrc`'s config, removes `graph.env` along with the rest.

### 4.3 Config keys

Every size, interval, path and limit is deployment config with the neutral default below, set only in `graph.env`
(§4.2). Existing keys keep their names and meaning unless marked.

| Key | Default | Meaning |
|---|---|---|
| `CCRC_GRAPH_STORE` | `$HOME/.ccrc/graphs` | Store root (§4.2 for its constraints). A deployment points it at the filesystem that holds its worktrees (§15 migration needs same-filesystem renames). |
| `CCRC_GRAPH_SOURCE_REF` | `origin/HEAD` | The main line. Falls back to `origin/main`, `origin/master`, then the local default branch for a repo with no remote. |
| `CCRC_GRAPH_REPOS_EXCLUDE` | empty | Repo keys that get no graph. |
| `CCRC_GRAPH_TICK_SECS` | 60 | **Rendered** into the timer. How often the sweep wakes to check whether a pass is due (§10). A tick with no pass due exits in milliseconds and writes no census. |
| `CCRC_GRAPH_POLL_SECS` | 300 | Maximum gap between passes (was a 15-minute timer). A new overlay request makes a pass due at the next tick instead. |
| `CCRC_GRAPH_FETCH_SECS` | 600 | Throttle on the sweep's own `git fetch`; 0 relies on refs others fetch. |
| `CCRC_GRAPH_MAX_BASES` | 6 | Retained bases per repository. |
| `CCRC_GRAPH_BASE_MAX_DRIFT_FILES` | 50 | A tree whose nearest base is more than this many files from its merge-base votes for a base at its merge-base. The tip wants a base once the newest base is more than this many files from the tip. **Must be below `OVERLAY_MAX_FILES`** (§6.2); the doctor WARNs otherwise. |
| `CCRC_GRAPH_BASE_MIN_VOTES` | 1 | Live-session trees that must vote for a merge-base before it is built. |
| `CCRC_GRAPH_TIP_MIN_INTERVAL_SECS` | 21600 | At most one tip base per repository per window. Merge-base bases are bounded by `BUDGET`, `MIN_VOTES` and the no-thrash eviction rule (§5.1) instead. |
| `CCRC_GRAPH_BASE_TTL_SECS` | 172800 | An unselected base older than this is collected even under the retention ceiling. |
| `CCRC_GRAPH_BUDGET` | 2 | **Changed meaning:** base builds per pass (was: tree rebuilds per pass, default 8). |
| `CCRC_GRAPH_OVERLAY` | `on` | Allow overlays. |
| `CCRC_GRAPH_OVERLAY_MIN_QUERIES` | 2 | Queries in the session before its tree's overlay is requested; a query that directly follows a gate denial does not count. |
| `CCRC_GRAPH_OVERLAY_MAX_FILES` | 100 | Cap on the overlay's **patch set**: the files differing between the served base's commit and `HEAD`, which is base drift plus the branch's own changes (§6.2). Larger patch sets get no overlay; the card's diff list covers them. |
| `CCRC_GRAPH_OVERLAY_BUDGET` | 4 | Overlay builds per pass. |
| `CCRC_GRAPH_OVERLAY_MIN_INTERVAL_SECS` | 600 | Coalescing: at most one overlay build per tree per window. |
| `CCRC_GRAPH_OVERLAY_TTL_SECS` | 86400 | A request with no query for this long lapses; an unreferenced overlay is collected after it. |
| `CCRC_GRAPH_OVERLAY_UNTRACKED` | `off` | Include untracked, non-ignored files and uncommitted edits; such an overlay is marked `partial` (§6.4). |
| `CCRC_GRAPH_OVERLAY_MAX_FILE_BYTES` | 262144 | Skip larger files in an untracked-inclusive overlay. |
| `CCRC_GRAPH_MAX_SHRINK_PCT` | 20 | Publish check: refuse a graph whose node count is this much below its predecessor's. |
| `CCRC_GRAPH_STORE_MAX_MB` | 4096 | Soft ceiling; over it the collector evicts unselected bases, then overlays, oldest first, and the doctor warns. |
| `CCRC_GRAPH_MIGRATE_BUDGET` | 8 | In-tree `graphify-out` directories migrated per pass (§15.1). |
| `CCRC_GRAPH_VIEW_GRACE_SECS` | 3600 | Superseded views and trashed dirs are deleted after this. |
| `CCRC_GRAPH_RUNNER` | `local` | `local`: a transient scope in `CCRC_GRAPH_SLICE`. `remote`: the runner of §12.2. |
| `CCRC_GRAPH_SLICE` | empty | The systemd slice builds run in. Empty: the sweep service's own cgroup. A deployment points it at its capped test slice. |
| `CCRC_GRAPH_BUILD_MEMORY_MAX` | `6G` | `MemoryMax` of each build's transient scope. |
| `CCRC_GRAPH_SWEEP_MEMORY_MAX` | `1G` | **Rendered** into the service's `MemoryMax`. Covers the probe and git only, since builds run in their own scope (§12). Applies only when `CCRC_GRAPH_SLICE` is set; with it empty, builds run in the service's own cgroup, so `install` renders `BUILD_MEMORY_MAX` instead. |
| `CCRC_GRAPH_BUILD_TIMEOUT` | 600 | Kept. Per build. |
| `CCRC_GRAPH_MAX_WORKERS` | 4 | Kept. `GRAPHIFY_MAX_WORKERS` for every build. |
| `CCRC_GRAPH_GATE_MAX_DIFF_FILES` | 300 | **New, replaces the hook's hard-coded `GRAPH_GATE_MAX_BEHIND=10`.** The gate arms only when the served graph's commit differs from `HEAD` by at most this many files. |
| `CCRC_GRAPH_GATE_MAX_DENIALS` | 3 | Replaces the hard-coded `GRAPH_GATE_MAX_DENIALS=3`. |
| `CCRC_GRAPH_CARD_DIFF_LIST_MAX` | 20 | Changed files named in the card before it summarizes the rest as a count. |

Retired: `CCRC_GRAPH_STALE_ESCAPE_COMMITS`, `CCRC_GRAPH_STALE_ESCAPE_SECS` (the idle gate's escape hatch; there is
no idle gate on builds any more, §7). `CCRC_GRAPH_HOOKSTATE_FRESH_SECS` survives only for the migration step, and
it moves into `graph.env` like every other key.

### 4.4 `meta.json`

About 1 KB, in every published base and overlay, and a per-tree copy in every view. Readers read this instead of
tail-reading a 53 MB `graph.json`.

```json
{ "schema": 1, "repo_key": "…", "kind": "base|overlay",
  "commit": "<full sha>", "tree_sha": "<HEAD^{tree} for overlays>", "base_id": "…",
  "engine": "0.9.9", "patch_files": 16, "partial": false,
  "nodes": 48172, "edges": 114127, "files": 4104, "built_at": "<iso>", "duration_ms": 36000 }
```

`patch_files` exists only on an overlay. It is the size of the set the overlay re-extracted:
`git diff --no-renames --name-only <base commit> <overlay commit>`. A base is always a full build and carries no
patch fields.

The view's copy adds the tree's position, as measured by the pass that wrote the view:

```json
{ "tree": "…", "served": "base|overlay", "requested": true,
  "merge_base": "<full sha>", "drift_files": 12, "branch_files": 15, "head_files": 27 }
```

- `drift_files`: the number of files that differ between the served base's commit and `merge_base`.
- `branch_files`: the number of files that differ between `merge_base` and `HEAD`. These are the branch's own
  changes.
- `head_files`: the number of files that differ between the served graph's commit and `HEAD` at that pass.

All three are counted with `git diff --no-renames --name-only`.

These three counts are distinct and are never interchanged. `drift_files` decides merge-base demand (§5.1).
`head_files` against an assigned base is the overlay's prospective patch set, so it decides overlay eligibility
(§6.2). `branch_files` is what G4's measured numbers describe, and it is what the card lists first (§9).

`graph.json`'s own `built_at_commit` is also correct: the build runs with its working directory in scratch
(`.scratch/<job>/src`) and `GIT_CEILING_DIRECTORIES` set so the engine's `_git_head` (which shells `git rev-parse HEAD` with no `cwd=`, the
U3 upstream defect) cannot stamp an unrelated repository; the sweep then writes the true commit with the existing
restamp splice (`_gs_restamp`) before publishing. `graph.json` stays self-describing for any tool that reads it.

---

## 5. Bases

### 5.1 Which commits get a base

Each pass, per repository, the sweep computes for every tree its merge-base `mb` with the source ref, and for
every retained base `b` at the current pin the drift `d(b, mb) = git diff --name-only b mb | wc -l`. The tree
is assigned the base with the smallest drift; ties go to the newest.

Demand for a new base:

- **Tip demand.** The main checkout and any newly created worktree sit at or near the tip. The tip wants a base
  when the newest base differs from the source-ref tip by more than `BASE_MAX_DRIFT_FILES`. At most one tip base
  is built per repository per `TIP_MIN_INTERVAL_SECS`.
- **Merge-base demand.** A tree votes for a base at `mb` when its assigned base drifts more than
  `BASE_MAX_DRIFT_FILES` from `mb`, that is, when `drift_files` (§4.4) exceeds the limit. Only trees with a
  registered session vote (the R2 read, unchanged), so dead trees do not drive builds. A merge-base needs at least
  `BASE_MIN_VOTES` votes.

Each pass builds at most `BUDGET` bases fleet-wide, highest-vote demand first.

On this repository's measured spread, 25 distinct merge-bases cover 62 trees, and the 5 most common cover 33 of
them. With 6 retained bases, most trees therefore sit within `BASE_MAX_DRIFT_FILES` of their merge-base. Trees
still waiting for their base are served the nearest one, and the card states the larger drift (§8). The plan's
Task 0 replays the selection over the measured merge-bases. It reports the share of trees within the limit, so
the operator can set `MAX_BASES` and the limit from data (G9).

Every base is a **full** build (§5.3). The demand rules therefore never need a nearby predecessor, and nothing
in the selection depends on patch distance.

**Retention, with no thrash.** When a repository holds more than `MAX_BASES` bases, the sweep evicts the base
assigned to the fewest live-session trees, oldest first. A demand build that would force an eviction runs only
if its vote count is **strictly greater** than the victim's assigned count. A single-vote merge-base therefore
cannot evict another single-tree base and be evicted in turn on the next pass. A base assigned to no tree for
`BASE_TTL_SECS` is evicted regardless. The base assigned to the main checkout is never evicted while it is
assigned.

### 5.2 Identity and engine pin

`base-id = <commit>-<pin>`. A pin bump therefore makes every base ineligible at once, exactly as C.1's two-dimensional
staleness intended, but the rebuild is **one base per repository first** (the most-voted), drained `BUDGET` per
pass; trees keep being served their previous-pin base, marked as such in `meta.json`, until their new base
publishes. A bad bump is rolled back by restoring the old pin: the old bases are still on disk until collected.

### 5.3 How a base is built

Every base is a full build. Base and overlay jobs share one job shape and one engine entrypoint, so the two kinds
cannot disagree on any convention below.

**The job.** `.scratch/<job>/` is created empty, holds `src/`, `out/` and `pub/` (§4.1), and is removed when the
job ends (trap; the collector removes crash leftovers). Nothing in it is shared with another job. In particular
no engine lock file, no `.pending_changes` queue, no stat index and no cache outlives the job or reaches a job for
another base. There is no per-repository build directory.

1. `git -C <main checkout> archive <commit> | tar -x -C .scratch/<job>/src/`. This gives exactly the tracked
   files at that commit, so gitignored files cannot be ingested by construction.
2. Write the ephemeral `.graphifyignore`, made from the tracked-noise list (`ccd/graph-noise.default.list` plus
   the operator's `graph-noise/<repo>.list`), **into `src/`**, the engine's scan root. `detect()` reads it from
   there. If the archive carries a committed `.graphifyignore`, the generated lines are appended to the scratch
   copy, since every file in scratch is the job's own. The file is never written into a tree, which removes the
   trap/SIGKILL hazard of 08-27 §E from the trees.
3. The corpus guard is unchanged in spirit. `detect()` on `src/` must be a subset of
   `git ls-tree -r --name-only <commit>`, with the generated `.graphifyignore` excused as it is today. On a
   breach the job's outcome is `refused-by-guard` and nothing is published.
4. Build, by running `ccd/graph-patch --full` (below).
5. Publish checks: the graph parses; its node count is not below the predecessor's by more than
   `MAX_SHRINK_PCT` (`refused-shrink`); `built_at_commit` is restamped; `meta.json` is written. For a base, the
   predecessor is the base it replaces as the tip, or the nearest retained base for a merge-base.
6. Publish: copy into `pub/`, `chmod` it read-only, then `mv` it to `bases/<base-id>` as one rename. Then rewrite
   the views of every tree whose assignment changed (§3).

**The engine entrypoint, `ccd/graph-patch`.** This is a short Python program run by the pinned venv's
interpreter. It is the only way ccrc invokes the engine; `graphify update` is no longer called by the sweep.

| Aspect | Fixed as |
|---|---|
| Working directory | `.scratch/<job>/src`. |
| Watch path | `Path(".")`. It is relative, so `_rebuild_code` takes `project_root = Path.cwd()` (`watch.py:746`), and every `source_file` is relativized against `src/`, which is the tree root. That is the same convention today's per-tree builds use (`cd <tree> && graphify update .`, `ccd-graph-sweep:943-945`). A session's tree-relative paths, the base's nodes and an overlay's evictions therefore all speak one spelling. Running `graphify update src` from the scratch root is forbidden, because it stamps every node `src/…`. An absolute watch path would also relativize against `src/`, but it changes the report's root label and the base that relative `changed_paths` resolve against. The design therefore fixes one convention, and row N17 pins it. |
| `changed_paths` (overlay only) | `git diff --no-renames --name-only <base commit> HEAD`, as paths relative to the tree root, which is `src/` and the cwd. `--no-renames` reports a rename as delete plus add. A path that no longer exists on disk is evicted by the engine (`watch.py:676-679`). |
| Output | `GRAPHIFY_OUT=<abs path of .scratch/<job>/out>`, **exported by the sweep before the interpreter starts**. `paths.py` reads it once at import (`paths.py:23`), so setting it inside the program after `import graphify` would be ignored. After import, `graph-patch` checks that `graphify.paths.GRAPHIFY_OUT` equals its `--out` argument, and exits 2 (job `failed`, reason `GRAPHIFY_OUT not honoured`) if it does not. |
| Predecessor (overlay only) | The sweep copies the base's `graph.json`, `manifest.json` and `.graphify_labels.json` into the empty `out/` before the call. The labels keep community names stable between base and overlay (`watch.py:962-966`). |
| Lock and queue | `acquire_lock=False`. The engine's per-directory flock and its `.pending_changes` queue exist for concurrent post-commit hooks. Here the sweep's pass lock already serializes jobs and `out/` is private to the job, so there is nothing to queue against and nothing to drain. With `acquire_lock=False` the engine neither queues nor drains (`watch.py:694-743`). |
| Shrink | `force=True`. Our own `MAX_SHRINK_PCT` check in step 5 is the shrink policy. Without `force`, a patch that deletes files is refused by the engine's own `_check_shrink`, and the full-build path keeps today's stderr-parsing discriminator. |
| Calls | Full: `_rebuild_code(Path("."), force=True, acquire_lock=False)`. Overlay: the same plus `changed_paths=[…]`. |
| Environment | `GRAPHIFY_OUT` as above, `GRAPHIFY_NO_BACKUP=1`, `PYTHONHASHSEED=0`, `GRAPHIFY_MAX_WORKERS=$CCRC_GRAPH_MAX_WORKERS`, `GIT_CEILING_DIRECTORIES=<store root>`, under `nice -n 15 timeout $CCRC_GRAPH_BUILD_TIMEOUT`. |
| Result | Exit 0 when `_rebuild_code` returns True, 1 when it returns False, and 124 on timeout. A True return with "outputs left untouched" (the topology did not change) is a success: `out/graph.json` is then the copied predecessor, and the restamp in step 5 gives it the right commit. |

`_rebuild_code` is a private engine function. The pin makes that acceptable. A test pins its signature, its
`changed_paths` behaviour, its relative-root behaviour and its `acquire_lock=False` no-queue behaviour against the
pinned package (§18), so a pin bump that changes any of them goes red rather than silent.

---

## 6. Overlays

### 6.1 When one is requested

The session hook already counts graph queries into hookstate (`graphQueries`, read-side R4). A request is made
when that count reaches `OVERLAY_MIN_QUERIES` for the session's cwd tree. A query whose immediately preceding event
was a gate denial does not count. The hook resolves both keys by reading its own `graphify-out` link, with no
recomputation and no registry access, and writes `<store>/requests/<repo-key>.<tree-key>`. All requests live in
that one flat directory (§4.1).

- **First request.** If the file is absent, the hook creates it as a new directory entry (write to a temporary
  name in the same directory, then `mv`). Only this creation changes the directory's own mtime, and that mtime is
  what wakes the sweep (§10).
- **Later queries.** If the file exists, the hook only `touch`es it. That updates the file's mtime, which is the
  request's liveness. It does not change the directory's mtime, so later queries never start a pass.

A request lapses `OVERLAY_TTL_SECS` after its last touch, and the sweep then removes it.

On the measured distribution, 68 of 197 sessions crossed 2 queries. The 129 one-query sessions never cause a
build.

### 6.2 When one is built

An overlay is the assigned base patched with **every** file that differs between the base's commit and the
tree's `HEAD`. That set is the base's drift from the merge-base plus the branch's own changes, so an overlay
describes `HEAD` itself (§8). Its size is the view's `head_files` (§4.4). The cap applies to that set, because the
patch set is what the engine re-extracts and where edge loss grows (§1.3). The sweep builds an overlay for a
requested tree when all of the following hold:

- `CCRC_GRAPH_OVERLAY=on`.
- `1 ≤ head_files ≤ OVERLAY_MAX_FILES` against the assigned base.
- No published overlay already has the key `sha12(base-id, HEAD^{tree})`. If one does (another tree with
  identical content, or this tree before an amend that kept the tree), the view is simply pointed at it.
- The tree's last overlay build is older than `OVERLAY_MIN_INTERVAL_SECS`.
- The pass has `OVERLAY_BUDGET` left.

**Who qualifies.** `head_files` is at most `drift_files + branch_files`. Merge-base demand keeps `drift_files` at
or below `BASE_MAX_DRIFT_FILES` (50) for every tree whose base has been built (§5.1). Such a tree therefore
qualifies whenever its branch changed at most 50 files. This repository's worktrees measure a median of 15.5 and a
p90 of 34 branch files, so on those numbers about nine in ten trees qualify once their base exists. That claim is
about trees *at their target drift* and no wider. Two kinds of tree may not qualify:

- A tree still waiting for its merge-base base (served one more than 50 files away) may exceed 100 until that
  base publishes. Meanwhile its card lists the files (§9).
- A branch of more than 50 files may or may not qualify, depending on its drift.

The plan's Task 0 measures the qualifying share on the box from `drift_files` and `branch_files` together, never
from branch files alone.

### 6.3 How it is built

Overlays use the same job shape and the same entrypoint as a base (§5.3):

1. `git -C <tree> archive HEAD` into the job's `src/`.
2. Copy the assigned base's `graph.json`, `manifest.json` and `.graphify_labels.json` into the job's empty `out/`.
3. Run `ccd/graph-patch` with `changed_paths` = `git diff --no-renames --name-only <base commit> HEAD`.
4. Run the same guard, plus publish checks against the base.
5. Publish to `overlays/<ov-key>` and swap the tree's view.

The tree is never written, and the session is never waited on.

When `HEAD` moves, the view keeps serving the previous overlay, marked with its commit, until the new one
publishes. The previous overlay is closer than the bare base. If the new `head_files` exceeds `OVERLAY_MAX_FILES`,
the view falls back to the base and the card says why.

### 6.4 Uncommitted and untracked work (optional)

With `CCRC_GRAPH_OVERLAY_UNTRACKED=on`, the scratch export also takes the working tree's modified tracked files
and `git ls-files --others --exclude-standard` (never ignored files) up to `OVERLAY_MAX_FILE_BYTES` each. The key
adds a digest of those files; `meta.json` says `"partial": true` and names no commit as fully covered. The corpus
guard's rule becomes "tracked at HEAD, or untracked and not ignored"; ignored files stay out. Default `off` (§19).

### 6.5 Accuracy, stated where sessions see it

A patch loses some cross-file edges from the changed files into unchanged code (§1.3: 192 of 114k on a 16-file
patch, almost all touching the changed files). The card for an overlay therefore says: *"overlay of N changed
files — calls from those files into unchanged code may be missing; confirm with a direct read."* (N is the
overlay's `patch_files`.) Overlays are
short-lived, are always patched from a full base, and never become a predecessor of anything, so patch error
never compounds.

---

## 7. Freshness: what triggers what

| Trigger | Effect | Bound |
|---|---|---|
| `POLL_SECS` (300 s) since the last pass started | Pass: resolve refs (fetch if throttle expired), recompute assignments and demand, build ≤ `BUDGET` bases and ≤ `OVERLAY_BUDGET` overlays, swap views, collect. | A pass with nothing to do: about 24 `rev-parse` calls plus a few `git diff --name-only` per tree, a few seconds. |
| A new request file in `<store>/requests/` (G7) | The next tick (`TICK_SECS`, 60 s) finds the directory's mtime changed and runs a pass, so an overlay does not wait out `POLL_SECS`. A touch of an existing request does not change the directory mtime and starts nothing. | Overlay ready ≈ one tick + one build (≈36 s for a 16-file patch of this repository) after the second query. |
| Main line moves | Tip demand once the newest base is more than `BASE_MAX_DRIFT_FILES` from the tip. | ≤ one tip base per repo per `TIP_MIN_INTERVAL_SECS` (6 h). |
| New worktree | Assigned to the nearest base at once (a view swap, no build); creates merge-base demand only if that base is far. | Immediate. |
| Pin bump | Bases rebuilt `BUDGET` per pass, most-voted first; old-pin bases served meanwhile. | Hours, not a fleet-wide stall. |

**There is no idle gate on builds.** Builds touch no tree and no session's files, so "is the session busy" no
longer matters. This retires the 08-27 O3 tension ("a tree goes stale exactly when its session commits —
precisely when it is not idle") and the escape-hatch knobs.

---

## 8. What a session queries, and how stale it can be

The session runs `graphify query …` in its tree exactly as today; `graphify-out/graph.json` resolves through the
link to the graph it is served.

| Session's tree | Graph served | Staleness bound for existing code | Staleness for the branch's own changes |
|---|---|---|---|
| Main checkout at the tip | Tip base | What main moved since the last tip base: more than `BASE_MAX_DRIFT_FILES` (50) only while `TIP_MIN_INTERVAL_SECS` (6 h) has not elapsed | n/a |
| Worktree, base within 50 files of its merge-base | Assigned base | `drift_files` ≤ 50 (stated in the card) | Not in the graph; **the card lists the changed files** |
| Same, after 2+ queries, `head_files` ≤ 100 | Overlay | None at the overlay's commit: the patch covers the drift files too | Covered as of the overlay's commit; ≤ one tick + one build behind `HEAD`; edge caveat of §6.5 |
| Worktree whose merge-base is far from every retained base | Nearest base | `drift_files` > 50, stated as a number; merge-base demand recorded | Card lists the changed files |
| `head_files` > 100 | Assigned base | as above | Card gives the counts and the first `CARD_DIFF_LIST_MAX` paths, branch files first |
| Repo excluded, or store missing | Nothing (no link, or a dangling one) | — | Card says no graph and why, from the census |

Today's per-tree graph is exact for the tree's `HEAD` when the sweep has caught up. The honest trade is this.
Without an overlay, the new design is exact for the files the branch did not change when the base sits at the
merge-base, and it states its drift when it does not. With an overlay, which only sessions that ask more than once
get, it describes `HEAD` subject to the edge caveat. The usage
measurement says that is where the questions are.

---

## 9. Read side

All read-side changes are in `ccd/session-hook.sh` and the compaction helper's inputs; none changes the
`FleetSession` protocol.

- **`_hook_graph_measure`** reads `graphify-out/meta.json` (it follows the link) for commit, engine, nodes,
  served kind and the view's `merge_base`. It no longer uses `tail -c 4096 graph.json` or `head -c` of the report.
  It computes two live counts, both with `git diff --no-renames --name-only`, so they reflect `HEAD` now rather
  than at the last pass:
  - `GM_DIFF`: files differing between the served graph's commit and `HEAD`. This is everything the graph does
    not describe, and it is the only count the gate uses.
  - `GM_BRANCH`: files differing between `merge_base` and `HEAD`, the branch's own changes. It is computed only
    when `merge_base` is an ancestor of `HEAD` (`git merge-base --is-ancestor`). After a rebase that moved the
    merge-base, it is left empty until the next pass rewrites the view.

  `GM_DIFF_LIST` holds the first `CARD_DIFF_LIST_MAX` paths of `GM_DIFF`, with the `GM_BRANCH` paths ordered
  first, so the branch's own files are never crowded out by main-line drift. `GM_BEHIND` stays for the card's
  wording. A tree whose `graphify-out` is still a real directory (not yet migrated) is measured the old way for one
  release.
- **The card (R1)** names what it is: *"graph of this repository at `<sha8>` (base)"* or *"overlay at
  `<sha8>`"*. For a base it appends *"your tree differs from this graph in `GM_DIFF` files: `GM_BRANCH` your
  branch changed, the rest main-line changes the graph predates: …"* followed by the list. For an overlay,
  `GM_DIFF` counts only the commits since the overlay was built, so the same sentence applies. The card keeps the
  instruction not to run `graphify update`.
- **The gate (R5)** arms when `GM_DIFF ≤ CCRC_GRAPH_GATE_MAX_DIFF_FILES` (replacing `GM_BEHIND ≤ 10`), with
  `CCRC_GRAPH_GATE_MAX_DENIALS` read from `graph.env` through `_gr_config_load`. The hard-coded
  `GRAPH_GATE_MAX_BEHIND` / `GRAPH_GATE_MAX_DENIALS` at `session-hook.sh:2376-2377` are removed. A graph far from the tree is not worth forcing a session
  through. Gate-forced first queries do not request overlays (§6.1).
- **The compaction card** passes `--graph graphify-out/graph.json --labels graphify-out/.graphify_labels.json`
  as today; both resolve through the link. Its admissible-size bound is unchanged.
- **R4** (`graphQueries` in hookstate) is unchanged; it is now also the overlay trigger.
- **The skill.** The installed body is the package's own and its fast path ("`graphify-out/graph.json` exists →
  query") needs no change: the link satisfies it. `install-graphify-skill.sh` gains one appended ccrc clause in the
  assembled SRC: `graphify-out` is a ccrc-managed link; never delete, replace or build into it; branch coverage
  arrives by asking more than one question. The convergence `diff` and `.graphify_version` stamping are
  unchanged.
- **Writes through the link fail closed.** Published files are `0444` in `0555` directories, so a session that
  runs `graphify update .` anyway gets `EACCES` and changes nothing shared. `graphify save-result` writes to
  `graphify-out/memory/`, which is the only writable member of a view.

---

## 10. Changes to `ccd-graph-sweep` and its units

Same name, same unit, same census path, same pause file, same pass flock. New body:

0. **Due check.** The timer fires every `TICK_SECS`. The sweep loads config (§4.2) and stats two things: its own
   last-pass stamp (`<store>/.last-pass`: the start time, plus the `requests/` directory mtime it saw at
   enumeration) and the current mtime of `<store>/requests/`. A pass is due when `POLL_SECS` have passed since the
   last start, **or** the directory's mtime differs from the recorded one, meaning a request was created or
   removed. Otherwise the sweep exits 0 with no census row, so ticks never fill the 10-pass census ring. The
   tick is the debounce: however many requests appear within one tick, they cost one pass. A request created
   during a pass, after enumeration, changes the mtime and makes the next tick due. The pass's own removal of
   lapsed requests does the same, which costs at most one extra pass that finds nothing to do.
1. Pass lock, pause file, pin check — unchanged.
2. Enumerate trees with today's `_gs_trees` (unchanged, including the `.claude/worktrees` registered-session rule).
   Group by `repo-key` via `graph-resolve`. Zero trees probed on a box with trees stays `probed-zero` (C.4).
3. Per tree: precondition `git check-ignore -q graphify-out` (**no trailing slash**, so it holds for a link);
   ensure the link exists (create it, or migrate a real directory, §15); record assignment and demand.
4. Per repo: fetch if throttled-out; tip demand; choose and run base jobs within `BUDGET`.
5. Overlay jobs within `OVERLAY_BUDGET` for live requests (§6.2).
6. Swap changed views; write `index.json`.
7. Collect (§15).
8. Census.

**Census shape.** The census file, its 10-pass ring and the pass-level fields (`started`, `finished`, `pin`,
`status`) are unchanged. Pass statuses are unchanged as well; a not-due tick writes nothing, so it adds no status.
Each pass gains one array, so a pass object is `{started, finished, pin, status, trees: [...], jobs: [...]}`.

- **`trees[]`**: one row per enumerated tree. Rows keep exactly today's four fields, `{path, outcome, reason,
  duration_ms}`, and add `repo_key`, `served` (a base-id or ov-key, or empty) and `job` (the id of the job whose
  outcome this tree's row reports, or empty). Tree outcomes:
  - `served-base` and `served-overlay`, with `reason` empty unless something is pending: *"overlay pending"*,
    *"overlay failed: <job reason>"*, or *"base for merge-base pending"*.
  - `no-base`: the repo has no published base at the current or previous pin. Its `reason` is the reason of the
    job that failed to provide one, for example the guard's refusal text, and `job` names that job.
  - `refused-no-exclude`, `migrated`, `migrate-busy` and `no-graph` (an excluded repo).
- **`jobs[]`**: one row per build job attempted or skipped, `{job, kind: "base"|"overlay", repo_key, commit, key,
  outcome, reason, duration_ms, trees: [paths]}`. `key` is the base-id or ov-key; `trees` lists the trees the job
  was for. Job outcomes: `base-built`, `overlay-built`, `refused-by-guard`, `refused-shrink`, `timed-out`,
  `failed`, `skipped-budget`, `coalesced` and `skipped-locked`.

The discriminators for `timed-out` (exit 124) and `refused-shrink` (our own publish check now, not the engine's
stderr text) are simpler than today's, because the job's output directory is ours.

**Retired tree outcomes, and their readers.** `fresh`, `stale-rebuilt`, `never-built`, `restamped` and
`skipped-busy` leave `trees[]`. `refused-by-guard`, `refused-shrink`, `timed-out`, `failed`, `skipped-budget` and
`skipped-locked` move to `jobs[]`, because what they describe is now a job. `fresh` is **retired, not
redefined**. On `main`, no code branches on the census string `fresh`: the search covered `ccd/`, `server/src`,
`shared/` and `pwa/src`. Only the README's census paragraph and `graph-sweep.test.ts` name it. The card's own
`GM_FRESH` word (`session-hook.sh:240-290`) is a separate vocabulary computed from git, and it does not read the
census. Every census reader on `main`, and how each changes:

| Reader | Today | Change |
|---|---|---|
| `ccrc-doctor-checks:4814-4834` | `.passes[-1].status`, `.finished`, `.pin` | none |
| `ccrc-doctor-checks:4843-4860` (age bound) | 3 × the timer's `OnUnitActiveSec` via `_dr_cycles_s ccd-graph-sweep.timer 3` | 3 × `CCRC_GRAPH_POLL_SECS` from `_gr_config_load`. The timer now ticks every minute, so its period no longer measures passes. |
| `ccrc-doctor-checks:4886-4888` | counts `.passes[-1].trees[]` with outcome `refused-by-guard` and `failed` | counts `.passes[-1].jobs[]` with those outcomes; `gfx_rowtotal` counts jobs. The WARN-never-FAIL ruling and its text stand. A `no-base` tree count is added to the same line, since its remedy is the same. |
| `ccrc-doctor-checks:4998` (remedy text) | points at `.passes[-1].trees[]` | points at `.passes[-1].jobs[]` and says *"a refused base keeps the repo's previous base served"* (the old *"a refused tree keeps its last graph"* no longer describes anything) |
| `ccd/session-hook.sh:325-329` | when the tree has no graph, prints the tree row whose `path` matches and whose `reason` is non-empty | **unchanged shape**. It works because a `no-base` row carries the job's reason. The 400-character clip (D-1335) still applies. |
| `README.md` §"The sweep" (≈:5883) and the card paragraph (≈:5486) | lists the old tree outcomes and the 15-minute timer | rewritten for `trees[]`/`jobs[]`, the tick and `graph.env` |
| `shared/lifecycle.ts:30` (`graph-sweep-census`) | root, pattern R | unchanged, plus the new classes of §16 |
| Tests: `graph-sweep.test.ts`, `ccrc-doctor-graphify.test.ts`, `ccrc-doctorFixture.ts:1387`, `session-hook.test.ts:1222` | fixture censuses with tree-level job outcomes | fixtures move job outcomes into `jobs[]`; doctor fixtures gain a `no-base` row case |

**Units.** The shipped `ccd-graph-sweep.timer` and `ccd-graph-sweep.service` become templates rendered at install
(§4.2). The timer gets `OnUnitActiveSec=@TICK_SECS@` and keeps `OnBootSec`. The service gets
`TimeoutStartSec=@TIMEOUT_START_SECS@` and `MemoryMax=@SWEEP_MEMORY_MAX@`, and still no `EnvironmentFile=`.
**There is no new unit.** No `.path` unit is added, so the install (`ccd/ccrc` ≈:17410), enable (≈:17880) and
uninstall (≈:26299, ≈:26327) lists keep exactly the two names they hold today. The plan changes only how the two
files reach `$dir`: they are rendered first, then laid down with `_inst_atomic`. Should G7 ever choose a `.path`
unit instead (rejected in §2), it would watch only the flat `<store>/requests/` directory with `PathModified=`,
and it would have to be added to all four lists in the same change.

**Exclude writer (D').** `ccd ws-add` and `ccrc install`/`update` append **both** `graphify-out/` and
`graphify-out` (no slash) per common dir, plus `.graphifyignore` as today. Measured: the slash-only line does not
ignore a symlink (`git status` shows `?? graphify-out`).

**Registry read (R2).** Narrowed, not widened: the sweep still reads `*.workdir` and hookstate for the
`.claude/worktrees` rule, for demand weighting and for the migration idle check. It still writes nothing under
`$REG`.

---

## 11. Doctor

`_check_graphify` keeps its multi-condition shape and its engine, PATH-shadowing and skill-stamp arms, and changes
or adds these:

| Condition | Verdict |
|---|---|
| `graph.env` has lines `_gr_config_load` dropped (`GR_CONFIG_BAD`: unknown key, bad type, a forbidden store root) | WARN naming each line and the default used instead |
| `BASE_MAX_DRIFT_FILES ≥ OVERLAY_MAX_FILES` | WARN: no tree could ever qualify for an overlay (§6.2) |
| An installed `ccd-graph-sweep.timer` / `.service` value differs from what the current config renders (`TICK_SECS`, `TimeoutStartSec`, `MemoryMax`) | WARN: "run `ccrc update` to apply" |
| Store root exists, is writable and carries `.ccrc-graph-store` | FAIL if not |
| `df` on the store root's device below the disk floor | WARN/FAIL (replaces the `WORKTREES_ROOT` arm for graph data; keeps it for worktrees) |
| Store size over `CCRC_GRAPH_STORE_MAX_MB` | WARN |
| Every non-excluded repo has ≥1 base at the current pin | WARN naming the missing |
| Trees whose `graphify-out` is still a real directory | WARN with the count (migration pending) |
| Dangling `graphify-out` links | FAIL naming them (a session would fall into the skill's full-build path) |
| `check-ignore -q graphify-out` per common dir | FAIL naming the repo (unchanged predicate, now without the slash) |
| Oldest live overlay request older than two poll periods with no overlay | WARN (overlay pipeline stuck) |
| Last pass census: `probed-zero`, or the last N passes' `jobs[]` all `failed`/`timed-out` for one repo | FAIL / WARN |
| Census age over 3 × `POLL_SECS` (replacing 3 × the timer period) | WARN, as today |
| Last pass `jobs[]` with `refused-by-guard` or `failed`, and `trees[]` with `no-base` (the re-pointed :4886 arm, §10) | WARN, never FAIL (ruling unchanged) |
| `graph-patch` signature probe against the pinned engine | FAIL (the private-function dependency of §5.3) |

---

## 12. Where heavy builds run

### 12.1 Default: a capped transient scope on the fleet host

Every job runs as `systemd-run --user --wait --collect --scope` (or `--unit`) with `--slice=$CCRC_GRAPH_SLICE`
when set, `-p MemoryMax=$CCRC_GRAPH_BUILD_MEMORY_MAX`, `nice`, the worker cap and the timeout. On the reference
fleet the deployment sets `CCRC_GRAPH_SLICE` to its capped test slice, so graph builds compete with test runs
under one memory ceiling instead of with sessions. One job at a time; the sweep's pass lock serializes them. Peak
per job: about 4.2 GB for a full build of this repository, about 1.25 GB for a patch (§1.3).

### 12.2 Option: the future test box

`CCRC_GRAPH_RUNNER=remote` with `CCRC_GRAPH_REMOTE=<ssh target>` sends the job's inputs (the `git archive`
stream, the predecessor `graph.json` + `manifest.json`, the changed-path list, the pin) to a runner with the same
pinned engine, and receives the build directory back as a tar. **Publish checks, the guard's subset test and the
publish itself always run on the fleet host**, so a remote runner cannot publish anything the host would refuse.
Because jobs are already pure functions of an archive and a predecessor graph, the remote runner is an adapter
on one seam, not a redesign. Not built in the first wave.

---

## 13. Cost: today versus this design

Today's figures are measured (§1.2). This design's figures are **estimates** from those measurements; the plan's
Task 0 re-measures them on the box.

| | Today (per-tree, every 15 min) | This design |
|---|---|---|
| Builds | ~2–5 full rebuilds of ~75 s per pass for this repository alone, 96 passes a day | This repository: ≤4 tip bases a day (`TIP_MIN_INTERVAL_SECS`); merge-base bases only on demand, a handful in steady state since new worktrees start near the tip; all bases **full** (~77 s). Overlays (~36 s for a 16-file patch) for sessions with 2+ queries: measured ≈3 such sessions a day, a few `HEAD` moves each |
| CPU | 4–17 CPU-min per pass ≈ **6–27 CPU-hours a day** | Estimate **~1–1.5 CPU-hours a day** fleet-wide; breakdown below |
| Peak memory | 4.6–6.0 GB per pass, in the sweep's own unit | ≤4.2 GB for a full build, ≤1.25 GB for a patch, inside the capped slice |
| Disk | **9,445 MB** (131 graphs) | Estimate **~2–3 GB**: this repository ≤6 bases × ~55 MB plus overlays (~55 MB each, TTL 24 h); other repos ≤ their tree count in bases; hard-capped by `STORE_MAX_MB` |
| Writes inside trees | Every rebuild rewrites ~75 MB in the tree | One symlink, once |
| Stalls a session | Skipped while busy; escape hatch after 20 commits / 6 h | Never touches a session |

**How the CPU estimate is made.** It assumes ≈3 CPU-minutes per full build of this repository and ≈1.5 per overlay
patch, scaled from the wall times in §1.3. For this repository, per day:

| Source | Count | CPU-minutes |
|---|---|---|
| Tip bases | ≤ 4 | ≤ 12 |
| Merge-base bases, steady state | ≈ 4 | ≈ 12 |
| Overlays | ≈ 3 sessions × ≈ 5 `HEAD` moves = ≈ 15 | ≈ 22 |
| **Total** | | **≈ 46** |

The one-off migration adds at most `MAX_BASES` full builds per repository, about 18 CPU-minutes here.

This repository holds about half the fleet's trees and the largest graph, so the fleet-wide figure is about twice
this one, which gives the ~1–1.5 CPU-hours above.

Two consequences:

- Patching the tip bases would save about 6 of those 46 minutes. That is why bases are not patched (§2, G11).
- No term in the estimate grows with the number of worktrees.

---

## 14. How every 08-27 constraint is still met

| Constraint (08-27 §8 and §3) | Met by |
|---|---|
| A pin bump refreshes nothing | Pin is part of `base-id` (§5.2); `meta.json.engine` is read by card and gate |
| Sweep silently enforces nothing | `probed-zero` kept; doctor reds on a stuck overlay queue and on repos without a base |
| Un-ignored store wedges `ws-rm` / reap / gc | Only an ignored symlink in the tree; exclude writer appends the no-slash line; predicate without the slash |
| Leftover `.graphifyignore` wedges the same seams | Never written into a tree any more; exclude line kept for legacy trees |
| `built_at_commit` stamped from the wrong repo | Builds run outside any repo with `GIT_CEILING_DIRECTORIES`; the sweep restamps the true commit |
| Shrink refusal leaves a tree permanently stale | Our own publish check; a refused base is not published and the tree keeps its previous base |
| One wedged build stops the timer | Per-job timeout, job lock probe, pass `TimeoutStartSec` |
| Rebuild storm starves the fleet | ≤ `BUDGET` + `OVERLAY_BUDGET` jobs a pass, serialized, in a capped slice |
| Unbounded backup accrual | `GRAPHIFY_NO_BACKUP=1` kept |
| Generated artifacts poison a graph | Bases from `git archive` are tracked-only by construction; the subset guard still runs |
| Guard false positive on `graphify-out/memory/` | `memory/` lives in the store, outside the scratch corpus |
| A gitignored secret enters a graph | `git archive` excludes it; no `!` lines; untracked inclusion uses `--exclude-standard` |
| Engine upgraded but callers reach the old one | Unchanged (§A absolute venv paths, PATH-shadow check) |
| Sweep on a server-role box | Role matrix unchanged |
| "Graph destroyed on `ws-rm`" (intended) | Now: the link goes with the tree; the view and memory are collected by the sweep (§15) |
| Doctor watches the wrong filesystem (G-1) | `df` on the store's device |
| O3 interval vs idle gate | Gone: no idle gate on builds |
| O5 `_ws_ignored_digest` consent token invalidated by unattended rebuilds | Gone after migration: the tree's ignored content is a constant symlink |
| O6 post-commit hooks | Still not installed; overlays replace the "latency accelerator" |
| O7 `project-graph-store` permanence | Replaced: every store class now has a collector (§16) |
| Livelock of a shared store | Bases immutable and commit-keyed; overlays content-keyed |

---

## 15. Migration and cleanup

### 15.1 Existing per-tree `graphify-out` directories

Done by the sweep, idle-gated (the only remaining use of the R2 idle check), `CCRC_GRAPH_MIGRATE_BUDGET` (default
8) trees per pass:

1. The exclude writer has run for the common dir (both lines present); otherwise `refused-no-exclude`.
2. The tree's repo has a base at the current pin; otherwise wait (the tree keeps its old graph meanwhile).
3. The tree's session is idle by today's `_gs_busy`; otherwise `migrate-busy`, retried next pass.
4. Move `graphify-out/memory/` (if any) to `<store>/<repo>/memory/<tree-key>/`.
5. `mv <tree>/graphify-out <store>/.trash/<tree-key>.<ts>` — a same-filesystem rename, which is why
   `CCRC_GRAPH_STORE` should sit on the worktrees' filesystem. On a different filesystem a rename is a copy, so
   the sweep instead deletes the directory in place under `ionice -c3` and then places the link; the gap without
   a graph is seconds, and only for an idle session.
6. `ln -s <store>/<repo>/trees/<tree-key> <tree>/graphify-out`; census `migrated`.

A stray `.graphifyignore` the sweep generated is removed as today. Directories are only moved if they look like
graphify's (contain `graph.json` or `.graphify_engine`); anything else is reported, never deleted.

The reference fleet's 9.4 GB drains in roughly `131 / MIGRATE_BUDGET` passes (under two hours at the default
poll). Leftover `/tmp/gfx-std*` files from killed passes are deleted by the first new pass.

### 15.2 Steady-state collection (every pass, at the end, `ionice -c3`)

| Class | Collected when |
|---|---|
| `views/<tree-key>.<gen>` superseded | older than `VIEW_GRACE_SECS` |
| `trees/<tree-key>`, its views, `memory/<tree-key>`, `<store>/requests/<repo-key>.<tree-key>` | `tree.json.tree` no longer exists (the worktree was removed) for `VIEW_GRACE_SECS` |
| `overlays/<ov-key>` | referenced by no view and older than `OVERLAY_TTL_SECS` |
| `bases/<base-id>` | retention rules of §5.1, or a pin other than current and assigned to no tree |
| `<store>/requests/*` | last touched more than `OVERLAY_TTL_SECS` ago |
| `.scratch/<job>` | the job ended (trap), or older than 2 × `BUILD_TIMEOUT` (crash leftovers) |
| `.trash/*` | older than `VIEW_GRACE_SECS` |
| `<repo-key>/` entirely | its `source` common dir is gone |

`ccrc uninstall` gains the store root in its REMOVES list and removes in-tree links it can find; links it cannot
find dangle harmlessly (ignored).

---

## 16. Artifact lifecycle declarations (replacing 08-27 §7's store rows)

| Class | Root | Pattern | Creator | Collector | Bound |
|---|---|---|---|---|---|
| `graph-base` | `<store>/<repo>/bases/` | R (ring-capped) | sweep | sweep (§5.1 retention + TTL) | `MAX_BASES` per repo |
| `graph-overlay` | `<store>/<repo>/overlays/` | E (TTL) | sweep | sweep | `OVERLAY_TTL_SECS`, `STORE_MAX_MB` |
| `graph-view` | `<store>/<repo>/views/`, `trees/` | W (tree-bound) | sweep | sweep, on tree death | tree lifetime + grace |
| `graph-tree-link` | `<tree>/graphify-out` | W | sweep, `ccd ws-add` | the worktree's three collectors (ignored) | tree lifetime |
| `graph-memory` | `<store>/<repo>/memory/` | W | graphify `save-result` | sweep, on tree death | tree lifetime + grace |
| `graph-request` | `<store>/requests/` | E | session hook | sweep | `OVERLAY_TTL_SECS` |
| `graph-scratch` | `<store>/.scratch/` | E | sweep job | job trap + sweep | one job |
| `graph-sweep-census` | `~/.ccrc/graph-sweep.json` | R | sweep | sweep, last N passes | unchanged (shape gains `jobs[]`, §10) |
| `graph-config` | `~/.ccrc/graph.env` | operator-owned, seed-once | `ccrc install` (seed only) | `ccrc uninstall --purge` | one file |

No class is permanent, so no `ruling` string is needed (O7 dissolves).

**Rings.** `graph-resolve` and the selection rule (assignment, demand, retention) are pure functions of git
output and the store index: the bash library keeps the decider (L1) separate from the job runner and the swaps
(L4), on the same pattern `ccd-graph-sweep` already uses. The session hook gains one write (the request touch),
its only write into the store. The server reads nothing new.

---

## 17. Failure modes

| Failure | Behaviour |
|---|---|
| Overlay build exceeds its timeout or budget | Base keeps being served; card says "overlay pending" or "overlay failed, see census"; the session never blocks and never builds |
| Branch diff over `OVERLAY_MAX_FILES` | Base plus the diff list; no build |
| A session runs `graphify update .` in its tree | `EACCES` on the read-only target; nothing shared changes |
| Store missing or link dangling | Skill fast path fails; the skill would attempt a full build into a dangling path and fail on `ENOENT`. Doctor FAILs the dangling link; the next pass recreates the view |
| Pin bump | Old-pin bases served, marked, until new ones publish |
| `_rebuild_code` signature or behaviour changes at a pin bump | `graph-patch` contract test and doctor arm go red; full builds go through the same entrypoint, so the bump is refused as a whole rather than half-working |
| `graph.env` has a bad line | That key keeps its default in every reader alike; doctor WARNs with the line |
| A crashed job leaves engine state | Nothing reaches the next job: each job's `out/` is private and the scratch dir is collected (§5.3) |
| Unit rendered from an older config | Sweep enforces its own pass deadline; doctor WARNs until `ccrc update` |
| Rename of a symbol on a branch | Its callers in unchanged files lose the edge in the overlay; stated in the card (§6.5) |
| Two trees with the same content | One overlay, shared |
| A merge-base no base covers | Nearest base, drift stated, demand recorded |
| Store fills | `STORE_MAX_MB` eviction, doctor WARN; disk floor on the store's device |
| Pass killed mid-swap | `rename` is atomic; the old view stands; scratch collected next pass |
| Session reads while the view swaps | It already holds the old files open; the new view applies to its next query |
| Gate on a far graph | Does not arm (`GATE_MAX_DIFF_FILES`) |
| Remote runner returns a bad graph | Host-side publish checks refuse it |

---

## 18. Test plan (mutation rows, fixture HOMEs only)

Existing rows 1, 4, 5a, 6, 7, 8, 10, 12, 13, 15, 16, 17, 18 of 08-27 §9 carry over with their targets moved to the
store. New rows, each red before and green after:

| # | Guard | Goes red when |
|---|---|---|
| N1 | Link ignored | the no-slash exclude line is dropped; `git worktree remove` refuses a tree with a link |
| N2 | Base immutability | publish leaves files writable; a fake `graphify update` through the link succeeds |
| N3 | Commit-keyed bases | two trees on different branches cause a base to be rewritten (the 08-27 livelock fixture) |
| N4 | Content-keyed overlays | two trees with identical `HEAD^{tree}` cause two overlay builds |
| N5 | Lazy trigger | one query, or one gate-forced query plus one, produces a request |
| N6 | Overlay cap counts the patch set | a tree with `branch_files` 10 and `drift_files` 95 (so `head_files` > `OVERLAY_MAX_FILES`) is built, or the cap is checked against `branch_files` |
| N7 | Serve-base fallback | a timed-out overlay leaves the tree without a graph |
| N8 | Publish shrink check | a graph with 50% fewer nodes is published |
| N9 | Restamp | the published `graph.json` carries a `built_at_commit` other than the base commit |
| N10 | Atomic swap | a killed swap leaves `trees/<key>` missing |
| N11 | Collector | a removed worktree's view, memory and request survive past grace |
| N12 | Migration safety | a busy tree is migrated; a non-graphify `graphify-out` directory is deleted |
| N13 | `graph-patch` contract | the pinned engine's `_rebuild_code` is replaced by one ignoring `changed_paths`, `force` or `acquire_lock`, and the probe stays green |
| N14 | Card diff list | a tree served a base omits its changed files from the card |
| N15 | Gate config | `CCRC_GRAPH_GATE_MAX_DIFF_FILES` is ignored |
| N16 | One config source | a fixture `graph.env` sets `OVERLAY_MIN_QUERIES=5` and `GATE_MAX_DENIALS=1`, the session's process env sets other values, and the hook and the sweep do not both act on the file's values |
| N17 | Root convention | a base or overlay is published whose `source_file`s carry a `src/` prefix, or an overlay fails to evict a deleted file's nodes from its base |
| N18 | Private job state | a `.pending_changes` or `.rebuild.lock` planted in a previous job's output reaches the next job, or `graph-patch` is called with `acquire_lock=True` |
| N19 | `GRAPHIFY_OUT` honoured | `graph-patch` sets `GRAPHIFY_OUT` after importing graphify and still exits 0 |
| N20 | Due check | touching an existing request starts a pass; creating a new one does not make the next tick due; a not-due tick writes a census row |
| N21 | Census readers | a `refused-by-guard` row in `jobs[]` is not counted by the doctor arm, or a `no-base` tree row loses its reason in the session card |
| N22 | Rendered units | changing `TICK_SECS` in `graph.env` and running `ccrc update` leaves the old `OnUnitActiveSec`, or the doctor does not WARN before the update |
| N23 | Store marker | `ccrc uninstall` removes a configured store root that lacks `.ccrc-graph-store` |

---

## 19. Operator decisions

| # | Decision | Options | Recommended |
|---|---|---|---|
| **G1** | Replace the per-tree store ruling of 2026-08-27 with shared bases plus lazy overlays | (a) this design; (b) main tip only, one graph per repo; (c) keep per-tree | **(a)** — the usage numbers put most questions on existing code, which (b) answers against the wrong commit and (c) answers at 6–27 CPU-hours a day |
| **G2** | Where the store lives | (a) on the worktrees' filesystem; (b) under `$HOME/.ccrc` on the home device | **(a)** via `CCRC_GRAPH_STORE`, so migration and swaps are same-filesystem renames and the disk floor watches the right device |
| **G3** | Overlay trigger | (a) 2 queries, gate-forced first query not counted; (b) 1 query; (c) no overlays, diff list only | **(a)** — 129 of 197 sessions ask once; they get the diff list, the rest get an overlay |
| **G4** | Overlay size cap, on the patch set (`head_files` = drift + branch) | 50 / **100** / 200 files | **100**: with drift held at ≤ 50 (G9), any branch of ≤ 50 files qualifies, and the measured p90 branch is 34; edge loss grows with patch size |
| **G5** | Uncommitted and untracked files in overlays | (a) off; (b) on, marked partial | **(a) off** for the first wave; turn on once overlay latency is measured |
| **G6** | Where builds run | (a) capped test slice on the fleet host; (b) remote test box | **(a)** now; (b) when that box exists — it is one adapter on the job seam |
| **G7** | Overlay latency | (a) a 60 s tick with a due check that fires on a new request (§10); (b) a `.path` unit on the flat `requests/` dir; (c) poll only | **(a)**: the overlay lands about one tick plus one build after the second query, with no new unit, and the tick is the debounce |
| **G8** | Migration of the 131 existing `graphify-out` directories | (a) automatic, idle-gated, budgeted, `memory/` preserved; (b) operator-run one-shot | **(a)** |
| **G9** | Base retention, drift and rate | `MAX_BASES` 6, `BASE_MAX_DRIFT_FILES` 50, one tip base per repo per 6 h; or tighter/looser | **6, 50 and 6 h**, set from Task 0's replay, then revisited after a week of census data |
| **G11** | Patch bases too? | (a) bases always full, overlays the only patch path; (b) patch tip bases from the previous tip with a periodic full build | **(a)**: about 6 CPU-minutes a day saved here does not pay for a patch-chain state and a drift class on shared graphs (§2, §13) |
| **G10** | Gate arming | (a) by files differing (`GATE_MAX_DIFF_FILES`, default 300); (b) keep commits behind (10) | **(a)** — a worktree 12 commits ahead of a base at its merge-base is a good graph, and "commits behind" would refuse it |

---

## 20. Out of scope

- Semantic (LLM) extraction — still declined (08-27 Appendix A).
- Cross-repository graphs (`merge-graphs`) — 1.7% of queries reach another repository; not worth a union graph.
- Any change to graphify upstream. The incremental CLI flag (`graphify update --changed …`) would let
  `graph-patch` disappear; worth proposing upstream, not waiting for.
- A PWA surface for the store beyond the existing pause file and census.
