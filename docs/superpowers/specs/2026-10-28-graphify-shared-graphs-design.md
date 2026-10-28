# Graphify on the fleet, revision 2: shared base graphs per repository, overlays only where a session keeps querying — design

**Date:** 2026-10-28 · **Status:** draft for operator review · **Branch:** `docs/graph-design-v2`
**Revision 2 of this draft** (after review): one config file and one parser for every reader (§4.2); bases are
always full builds, and overlays are the only patch path (§5.3, G11); the engine invocation is fixed, covering
cwd, root, lock, queue and `GRAPHIFY_OUT` (§5.3); overlay eligibility is counted on the patch set, not on branch
size (§6.2); a tick-and-due-check replaces the `.path` unit (§10); the census gains `jobs[]`, with every reader
listed (§10).
**Revision 3** (after a second review): the base-coverage replay was run on the box before G1 is ruled (§5.1), and
it replaces the `MAX_BASES` count cap with one immutable base per live merge-base cluster, bounded by
`STORE_MAX_MB` (§5.1, G9); the tip's weight and the build order are defined (§5.1); overlays are pull-on-read, so
a `HEAD` move alone never builds one (§6.2); a new insert-or-replace stamper writes `built_at_commit` into the job's
`out/` (§5.3); the in-tree link is created only after its first view is published (§10); each job is a transient
service with its own hard memory cap in a dedicated slice, admitted only under a memory-pressure check, never in
the test slice (§12.1).
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
   in a store outside every tree. A repository keeps one base per **cluster** of live merge-bases (merge-bases
   within 50 files of each other share one), plus the main-line tip. There is no count cap; the store's size
   ceiling bounds them. Each tree is served the base whose commit is nearest its own merge-base. A base is built
   once and is never rebuilt, because a merge-base moves only when its tree rebases or merges.
2. **Overlays** are built lazily and pulled by reads: only after a session in that tree has made 2 graph queries
   (a query forced by the search gate does not count), only when the tree's `HEAD` differs from its served base
   by 100 files or fewer, and only when a query arrived after the served overlay was built. A `HEAD` move with no
   query after it builds nothing. They are keyed by the tree's `HEAD^{tree}`, so two trees with the same content
   share one. They are built by
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

Build cost then grows with how often each repository's main line and merge-bases move, and with how often a
session queries a branch again after changing it — not with the number of worktrees, and not with how often a
tree commits.

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
| **A per-repository count cap on bases (`MAX_BASES`, revision 2)** | The replay of §5.1 needs 30 clusters for this repository's 94 worktrees; 38 of 94 trees (about 40%) sit outside the six largest clusters. A vote-margin eviction rule cannot fix that: once every slot serves a tree, a single-tree merge-base never gets a base, so that tree is answered from a far base for as long as it lives. A base per cluster costs about 55 MB of disk and is built once; the size ceiling is the right bound. |
| **Rebuilding an overlay on every `HEAD` move of a requested tree (revision 2)** | A session that commits all day after two early queries would cost up to one overlay every `OVERLAY_MIN_INTERVAL_SECS` whether or not anyone reads it, about 144 a day for one tree. Pull-on-read (§6.2) builds only when a query follows a change. |
| **Running builds in the capped test slice (revision 2)** | Graph builds would share a memory ceiling with test runs, and on this fleet pressure inside a shared, capped slice is what stalls it (§12.1). A dedicated slice, a hard per-job cap and an admission check keep a build from taking memory others are using. |
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
`OnUnitActiveSec`), the service's `TimeoutStartSec`, and the service's `MemoryMax`, which is
`CCRC_GRAPH_SWEEP_MEMORY_MAX` (plus `CCRC_GRAPH_BUILD_MEMORY_MAX` only when `CCRC_GRAPH_RUNNER=inline`, §4.3). `TimeoutStartSec` is derived as `(BUDGET + OVERLAY_BUDGET) × BUILD_TIMEOUT + 600`. The shipped
`deploy/systemd/ccd-graph-sweep.{service,timer}` become templates with `@TICK_SECS@`, `@TIMEOUT_START_SECS@` and
`@SWEEP_MEMORY_MAX@` placeholders. `ccrc install` and `update` render them into a temporary file from the loaded
config and lay them down with `_inst_atomic`, as today. A change to any of those keys therefore takes effect at the
next `ccrc update`. The doctor WARNs when an installed unit's value differs from what the current config would
render (§11). The sweep also enforces its own pass deadline from the same formula, so a stale render is never
unsafe, only inexact. `CCRC_GRAPH_POLL_SECS` is deliberately **not** rendered. The sweep reads it on every tick
(§10), so changing the poll needs no reinstall.

**Values that are not rendered.** Exactly three values reach a unit file, and no others. In particular
`CCRC_GRAPH_SLICE`, `CCRC_GRAPH_BUILD_MEMORY_MAX`, `CCRC_GRAPH_BUILD_SWAP_MAX`, the build weights and the
admission thresholds are **not** rendered: the sweep passes them on each job's own `systemd-run` command line
(§12.1), so a change takes effect at the next job with no reinstall, and the doctor's drift check never compares
them. `SWEEP_MEMORY_MAX` caps only the sweep service itself (probe, git, publish), whatever `SLICE` says, because no
build ever runs in the service's cgroup under the default runner.

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
| `CCRC_GRAPH_BASE_MAX_DRIFT_FILES` | 50 | The cluster radius (§5.1): a merge-base more than this many files from every base and planned base starts a new cluster. The tip wants a base once the newest base is more than this many files from the tip. **Must be below `OVERLAY_MAX_FILES`** (§6.2); the doctor WARNs otherwise. |
| `CCRC_GRAPH_BASE_MIN_TREES` | 1 | Live-session trees a merge-base cluster needs before its base is built. (Revision 2's `MAX_BASES` and `BASE_MIN_VOTES` are dropped; there is no count cap and no vote margin, §5.1.) |
| `CCRC_GRAPH_TIP_MIN_INTERVAL_SECS` | 21600 | At most one tip base per repository per window. Merge-base clusters are bounded by `BUDGET`, `BASE_MIN_TREES` and `STORE_MAX_MB` instead. |
| `CCRC_GRAPH_BASE_TTL_SECS` | 172800 | A base assigned to no live tree, and not the repository's newest tip base, is collected after this long. |
| `CCRC_GRAPH_BUDGET` | 2 | **Changed meaning:** base builds per pass (was: tree rebuilds per pass, default 8). |
| `CCRC_GRAPH_OVERLAY` | `on` | Allow overlays. |
| `CCRC_GRAPH_OVERLAY_MIN_QUERIES` | 2 | Queries in the session before its tree's overlay is requested; a query that directly follows a gate denial does not count. |
| `CCRC_GRAPH_OVERLAY_MAX_FILES` | 100 | Cap on the overlay's **patch set**: the files differing between the served base's commit and `HEAD`, which is base drift plus the branch's own changes (§6.2). Larger patch sets get no overlay; the card's diff list covers them. |
| `CCRC_GRAPH_OVERLAY_BUDGET` | 4 | Overlay builds per pass. |
| `CCRC_GRAPH_OVERLAY_MIN_INTERVAL_SECS` | 600 | Coalescing: at most one overlay build per tree per window, even when queries keep following commits. |
| `CCRC_GRAPH_OVERLAY_TTL_SECS` | 86400 | A request with no query for this long lapses; an unreferenced overlay is collected after it. The TTL only keeps a request on file; it never causes a build (§6.2). |
| `CCRC_GRAPH_OVERLAY_UNTRACKED` | `off` | Include untracked, non-ignored files and uncommitted edits; such an overlay is marked `partial` (§6.4). |
| `CCRC_GRAPH_OVERLAY_MAX_FILE_BYTES` | 262144 | Skip larger files in an untracked-inclusive overlay. |
| `CCRC_GRAPH_MAX_SHRINK_PCT` | 20 | Publish check: refuse a graph whose node count is this much below its predecessor's. |
| `CCRC_GRAPH_STORE_MAX_MB` | 8192 | The bound on bases (§5.1). Over it the collector evicts unassigned bases, then unreferenced overlays, oldest first. It never evicts a base a live tree is assigned to; a new base that would not fit is `skipped-store-full` and the doctor WARNs. |
| `CCRC_GRAPH_MIGRATE_BUDGET` | 8 | In-tree `graphify-out` directories migrated per pass (§15.1). |
| `CCRC_GRAPH_VIEW_GRACE_SECS` | 3600 | Superseded views and trashed dirs are deleted after this. |
| `CCRC_GRAPH_RUNNER` | `local` | `local`: each job is a transient user service in `CCRC_GRAPH_SLICE` (§12.1). `inline`: the job is a plain child of the sweep with no per-job cgroup, for test fixtures and hosts without a user systemd manager; the doctor WARNs when it is set on a host that has one. `remote`: the runner of §12.2. |
| `CCRC_GRAPH_SLICE` | `ccrc-graph.slice` | The user slice each job's transient service joins. systemd creates it implicitly; ccrc ships no slice unit and sets no limit on it, because each job carries its own cap and jobs never overlap. It must not be a slice that other workloads use (§12.1). Not rendered. |
| `CCRC_GRAPH_BUILD_MEMORY_MAX` | `6G` | `MemoryMax` of each job's transient service. A hard cap: a build over it is OOM-killed and reported `failed`, never throttled. Not rendered. |
| `CCRC_GRAPH_BUILD_SWAP_MAX` | `0` | `MemorySwapMax` of each job, so a build cannot push other workloads' memory into swap. Not rendered. |
| `CCRC_GRAPH_BUILD_CPU_WEIGHT` | 20 | `CPUWeight` and `IOWeight` of each job (systemd's default is 100), so sessions win any contention. Not rendered. |
| `CCRC_GRAPH_ADMIT_MEM_PCT` | 25 | Admission: a job starts only when `MemAvailable` is at least `BUILD_MEMORY_MAX` plus this share of total memory (§12.1). |
| `CCRC_GRAPH_ADMIT_PSI_AVG10` | 10 | Admission: a job starts only when the host's memory pressure `some avg10` (`/proc/pressure/memory`) is at or below this. |
| `CCRC_GRAPH_SWEEP_MEMORY_MAX` | `1G` | **Rendered** into the service's `MemoryMax`. Covers the probe, git and publish only; under the `local` runner no build runs in the service's cgroup. With `RUNNER=inline` the service's cap is `BUILD_MEMORY_MAX` + this value, rendered the same way. |
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

**`built_at_commit` is written by ccrc, not by the engine.** The build runs with its working directory in scratch
(`.scratch/<job>/src`) and `GIT_CEILING_DIRECTORIES` set, so the engine's `_git_head` (which shells
`git rev-parse HEAD` with no `cwd=`, the U3 upstream defect) cannot stamp an unrelated repository. The price is that
it stamps nothing at all: outside a repository `_git_head()` returns `None`, `to_json` then writes **no**
`built_at_commit` key (`export.py:537-539`), and `GRAPH_REPORT.md` gets no "Graph Freshness" section
(`report.py:135-141`). This was confirmed with the pinned 0.9.9: `_rebuild_code(Path("."), force=True,
acquire_lock=False)` in a non-repository directory wrote a `graph.json` with no `built_at_commit`. Today's
`_gs_restamp` (`ccd-graph-sweep:821-825`) cannot fill that gap. It only replaces an existing sha (it returns 1 with
"no built_at_commit to replace" when the key is missing), and it hard-codes `$tree/graphify-out` as its target.

The design therefore replaces `_gs_restamp` with **`_gs_stamp <dir> <sha>`**, an insert-or-replace stamper whose
target is a directory argument, the job's `out/`:

- **`graph.json`.** It reads the last 4 KiB, as today. If a `"built_at_commit": "<sha>"` key is there, it replaces
  the sha (the case of an untouched predecessor copied from a base). Otherwise it checks that the file ends with
  the top-level object's closing `}` (optionally followed by a newline) and inserts `,\n  "built_at_commit":
  "<sha>"` before it. The key is therefore the last key either way, which is where the card's and `_gs_stale`'s
  tail reads expect it. The result goes to a temporary file in `out/` and is renamed over the original. A file
  whose tail matches neither shape is a refusal (`failed`, reason `cannot stamp graph.json`), and nothing is
  published.
- **`GRAPH_REPORT.md`.** If a `- Built from commit:` line exists, it replaces the sha. Otherwise it inserts
  `## Graph Freshness` and `- Built from commit: \`<sha8>\`` just before the first `## ` heading after `## Summary`,
  which is where the engine puts that section, or appends them when there is no such heading. It writes only
  those two lines. The engine's own section also says "Run `graphify update .` after code changes", which the
  card forbids. A failure here is logged and is not a refusal, as D-1509 ruled for the report today.

The publish check is then "`graph.json` parses and its `built_at_commit` equals the job's commit" (§5.3 step 5).
`graph.json` stays self-describing for any tool that reads it. Row N9 tests both the insert and the replace.

---

## 5. Bases

### 5.1 Which commits get a base

**The replay, run before G1 is ruled.** Revision 2 deferred this check to the plan's Task 0. It was run instead
on the reference fleet's box on 2026-10-28, read-only and at idle priority, over every worktree of this repository
present that day, whether or not a session was live in it. That makes it an upper bound on live demand. Inputs:
each tree's merge-base with `origin/main`, and `git diff --no-renames --name-only` between commits. It used the
clustering rule below.

| Measured | Value |
|---|---|
| Worktrees | 94 (the 62 of §1.2 were counted earlier the same day, on the previous host) |
| Distinct merge-bases | 50 |
| Clusters at radius 50 files, so bases needed | **30**; trees per cluster 12, 12, 11, 9, 7, 5, 4, 4, 3, 3, then twenty clusters of 1 or 2 |
| Clusters at radius 100 files | 26 |
| Trees whose `drift_files + branch_files` ≤ `OVERLAY_MAX_FILES` (100) once their cluster base exists | **94 of 94** at radius 50; 84 of 94 at radius 100 |
| Ages of the 30 cluster commits | 6 within the last 24 h, 16 within 7 days, the oldest about 49 days |

Revision 2's 6-slot cap could at best have served the six largest clusters, 56 of 94 trees. The other 38 trees, on 24
clusters, would have shared whatever slot the vote-margin rule ever freed. Under that rule a one-tree cluster can
never win a slot, so a tree like that would be answered from a far base for its whole life, where today's per-tree
graphs are exact. That rule is therefore dropped, together with the count cap.

**The rule: one immutable base per live merge-base cluster.** Each pass, per repository:

1. **Anchors.** Collect the merge-base `mb` with the source ref of every tree that has a registered session (the
   R2 read, unchanged), plus the **tip anchor**, which is the source-ref tip itself. Dead trees are not anchors, so
   they never drive a build.
2. **Clustering, stable by construction.** Retained bases at the current pin are cluster centres first. Then the
   anchors are taken newest commit first. An anchor within `BASE_MAX_DRIFT_FILES` of an existing or already-planned
   centre joins the nearest one. Otherwise it becomes a new planned centre, and its base will be built at that very
   commit. Existing centres never move, so a pass never re-plans a cluster that already has a base, and an
   anchor's cluster changes only when its tree rebases or merges.
3. **Assignment.** Each tree is served the published base with the smallest drift `d(b, mb)`, ties to the newest.
   Once its cluster's base is published, that drift is at most `BASE_MAX_DRIFT_FILES`. Until then the tree is
   served the nearest base, and the card states the drift (§8).
4. **Demand.** A planned centre is demand when its cluster holds at least `BASE_MIN_TREES` live trees. Each demand
   has a **weight**, the number of live trees in its cluster. The tip anchor's cluster also counts **one** for the
   main checkout, whether or not the main checkout has a live session, because new worktrees branch from the tip
   and land in that cluster. So a tip with no live tree near it has weight 1, and a tip that live trees sit on has
   weight 1 + those trees. Tip demand additionally waits out `TIP_MIN_INTERVAL_SECS` since the repository's last
   tip base. A live tree whose merge-base is a fresh tip forms a merge-base cluster in its own right, so a tree is
   never kept waiting by that interval.

**Build order.** Each pass builds at most `BUDGET` bases fleet-wide, in this order:

1. A repository with **no** base at the current or previous pin, its tip demand first. A repository with no base
   serves nothing, and its trees get no link (§10), so this comes before any refinement elsewhere.
2. Then demand by weight, highest first.
3. Ties: tip before merge-base, then the newer commit.

The order is the same on first install and after a pin bump (§5.2).

**Retention and the bound.** There is no per-repository count and no vote margin. A base is kept while any live
tree is assigned to it, and the repository's newest tip base is always kept. A base assigned to no live tree is
collected after `BASE_TTL_SECS`, which is what happens to a cluster once its trees rebase, merge or die. The bound is
`STORE_MAX_MB`. Before a base job starts, the sweep estimates its size as the repository's newest base size. If
publishing it would exceed the ceiling, the sweep first collects unassigned bases, then unreferenced overlays,
oldest first. If that is still not enough, the job is `skipped-store-full` and the doctor WARNs with the numbers.
An assigned base is never evicted to make room, so nothing thrashes. On the replay that is 30 bases × about 55 MB,
about 1.65 GB, for this repository.

**Steady state.** A base is built once, at a commit some live tree's merge-base has. New worktrees start at or
near the tip, so most join the newest cluster. The replay's cluster ages put new clusters at about 2 to 6 a day
for this repository (16 in 7 days, 6 in the last 24 hours). §13 costs that.

Every base is a **full** build (§5.3). The demand rules therefore never need a nearby predecessor, and nothing in
the selection depends on patch distance.

### 5.2 Identity and engine pin

`base-id = <commit>-<pin>`. A pin bump therefore makes every base ineligible at once, exactly as C.1's two-dimensional
staleness intended, but the rebuild is **one base per repository first** (the §5.1 build order, which puts every repository with no
current-pin base first), drained `BUDGET` per pass; trees keep being served their previous-pin base, marked as such in `meta.json`, until their new base
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
   `MAX_SHRINK_PCT` (`refused-shrink`); `_gs_stamp out/ <commit>` (§4.4) has inserted or replaced
   `built_at_commit`, and the stamped `graph.json` parses and carries exactly the job's commit; `meta.json` is
   written. For a base, the
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
| Result | Exit 0 when `_rebuild_code` returns True, 1 when it returns False, and 124 on timeout. A True return with "outputs left untouched" (the topology did not change) is a success: `out/graph.json` is then the copied predecessor, still stamped with the base's commit, and `_gs_stamp` in step 5 replaces it with the overlay's. A full build always reaches step 5 with no `built_at_commit` key, and `_gs_stamp` inserts one. |

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
- **Later queries.** If the file exists, the hook `touch`es it. That updates the file's mtime, which is both the
  request's liveness and **the time of the last read** that §6.2 compares against. It does not change the
  directory's mtime, so an ordinary later query never starts a pass.
- **A query against a stale graph.** When the hook's own measure shows the served graph no longer describes `HEAD`
  (`GM_DIFF > 0`, §9) and the request's recorded `wake` time is older than `OVERLAY_MIN_INTERVAL_SECS`, the hook
  rewrites the request through a temporary name and `mv` instead of touching it. The file holds one line,
  `{"wake": <epoch>}`. The rename changes the directory's mtime, so the next tick runs a pass. This is the only
  way a later query wakes the sweep, and it does so at most once per tree per coalescing window.

A request lapses `OVERLAY_TTL_SECS` after its last touch, and the sweep then removes it. Keeping a request on file
never causes a build by itself (§6.2).

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
- **Pull-on-read.** The request's mtime, which is the last query, is newer than the `built_at` of the overlay the
  tree is served now. If the tree has no overlay yet, this holds trivially. A `HEAD` move with no query after it
  therefore builds nothing, however long the request stays live, and an overlay is only ever built for a read
  that has already happened. That read was answered by the previous graph, and the card said by how much it
  differs (§9). The next read gets the new overlay.
- The tree's last overlay build is older than `OVERLAY_MIN_INTERVAL_SECS`.
- The pass has `OVERLAY_BUDGET` left.

So the overlay builds for one tree are bounded by the number of times a query followed a change, and by one per
`OVERLAY_MIN_INTERVAL_SECS`. A session that commits all day after two early queries costs one overlay, not one per
commit.

**Who qualifies.** `head_files` is at most `drift_files + branch_files`. Clustering keeps `drift_files` at or below
`BASE_MAX_DRIFT_FILES` (50) for every tree whose cluster base has been built (§5.1). Such a tree therefore
qualifies whenever its branch changed at most 50 files. This repository's worktrees measure a median of 15.5 and a
p90 of 34 branch files, so on those numbers about nine in ten trees qualify once their base exists. That claim is
about trees *at their target drift* and no wider. Two kinds of tree may not qualify:

- A tree still waiting for its merge-base base (served one more than 50 files away) may exceed 100 until that
  base publishes. Meanwhile its card lists the files (§9).
- A branch of more than 50 files may or may not qualify, depending on its drift.

The §5.1 replay measured the qualifying share from `drift_files` and `branch_files` together, never from branch
files alone: **94 of 94** worktrees have `drift_files + branch_files ≤ 100` once their cluster base exists.

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
| A query finds its served graph stale (`GM_DIFF > 0`) | The hook rewrites the request (§6.1), so the next tick runs a pass; the pass builds an overlay because the request's mtime is newer than the served overlay (§6.2). | ≤ one wake and ≤ one build per tree per `OVERLAY_MIN_INTERVAL_SECS`. The stale read itself is answered by the previous graph, with the diff in the card. |
| A requested tree's `HEAD` moves, no query follows | Nothing. | No build, however long the request lives. |
| Main line moves | Tip demand once the newest base is more than `BASE_MAX_DRIFT_FILES` from the tip. | ≤ one tip base per repo per `TIP_MIN_INTERVAL_SECS` (6 h). |
| New worktree | At the next pass: assigned to the nearest base, its view published, then its link created (§10); joins the nearest cluster or plans a new one (§5.1). | ≤ `POLL_SECS` if its repository has a base; until then no link, and the card says why. |
| Pin bump | Bases rebuilt `BUDGET` per pass in the §5.1 build order (repositories with no base first, then by weight); old-pin bases served meanwhile. | Hours, not a fleet-wide stall. |

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
| New tree, or repo at `no-base` | Nothing yet: no link until a view publishes (§10) | — | Card says the graph is pending and why, from the census |
| Repo excluded | Nothing: no link; a legacy directory is moved out (§15.1) | — | Card says the repository is excluded |
| Store missing under a live link | Nothing (dangling link) | — | Card says no graph; doctor FAILs |

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
  assembled SRC: `graphify-out` is a ccrc-managed link; never delete, replace or build into it; when it is absent
  the tree's graph is not ready yet, so do not build one, use search and read the card (§10); branch coverage
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
   last start, **or** the directory's mtime differs from the recorded one, meaning a request was created, rewritten
   by a stale-graph wake (§6.1) or removed. Otherwise the sweep exits 0 with no census row, so ticks never fill the 10-pass census ring. The
   tick is the debounce: however many requests appear within one tick, they cost one pass. A request created
   during a pass, after enumeration, changes the mtime and makes the next tick due. The pass's own removal of
   lapsed requests does the same, which costs at most one extra pass that finds nothing to do.
1. Pass lock, pause file, pin check — unchanged.
2. Enumerate trees with today's `_gs_trees` (unchanged, including the `.claude/worktrees` registered-session rule).
   Group by `repo-key` via `graph-resolve`. Zero trees probed on a box with trees stays `probed-zero` (C.4).
3. Per tree: precondition `git check-ignore -q graphify-out` (**no trailing slash**, so it holds for a link);
   record assignment and demand.
4. Per repo: fetch if throttled-out; tip demand; choose and run base jobs within `BUDGET`.
5. Overlay jobs within `OVERLAY_BUDGET` for live requests (§6.2).
6. Swap changed views; write `index.json`.
7. **Links, after views.** For each tree that has no `graphify-out` yet, and whose `trees/<tree-key>` now resolves
   to a published view whose `graph.json` exists, create the link. A real `graphify-out` directory is migrated
   instead (§15.1). Nothing else creates a link.
8. Collect (§15).
9. Census.

**When the in-tree link appears.** A link is created only after its view is published, in the same pass, by step
7. No placeholder view is written. A placeholder would satisfy the skill's fast path with an empty graph, and
sessions would get confident empty answers. So a link never points at nothing at the moment it is made. Three cases
follow:

- **A new tree in a repository that has a base.** The first pass after it appears assigns it, publishes its view
  and creates its link, so it waits at most one `POLL_SECS`. Before that, the tree has no `graphify-out`. The
  card says *"graph for this tree arrives within a few minutes"*. The census row is `pending-view` with the reason.
- **A tree of a repository still at `no-base`** (first install, a new repository, or a pin bump with no previous
  pin base). No view, no link. The census row is `no-base` with the failing or pending job's reason, and the card
  prints it (§10 census readers). A tree that already has a legacy real directory keeps it until migration
  (§15.1 step 2), so it keeps a graph meanwhile. The §5.1 build order puts a repository with no base first, so
  first install drains about one repository per base slot per pass.
- **The skill, on a tree with no link.** The appended ccrc clause (§9) says that in a ccrc-managed tree an
  absent `graphify-out` means "not ready yet". The session must not build one; it uses search and reads the card.
  If a session builds a graph anyway, the result is a real directory, and migration moves it to `.trash` like any
  legacy directory.

The doctor's dangling-link FAIL (§11) therefore fires only when something removed a view or the store under a
live link. That is a real fault, never a normal state.

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
  - `pending-view`: the repo has a base but this tree's first view has not been published yet. No link exists.
  - `refused-no-exclude`, `migrated`, `migrate-busy` and `no-graph` (an excluded repo).
- **`jobs[]`**: one row per build job attempted or skipped, `{job, kind: "base"|"overlay", repo_key, commit, key,
  outcome, reason, duration_ms, trees: [paths]}`. `key` is the base-id or ov-key; `trees` lists the trees the job
  was for. Job outcomes: `base-built`, `overlay-built`, `refused-by-guard`, `refused-shrink`, `timed-out`,
  `failed`, `skipped-budget`, `coalesced`, `skipped-locked`, `skipped-store-full` (§5.1) and `skipped-pressure`
  (the admission check of §12.1).

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
ignore a symlink (`git status` shows `?? graphify-out`). That is **all** `ccd ws-add` does for graphs. It creates no
link and no view, and it does not wait on the store. The new tree gets its link from the next pass (step 7).

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
| A loaded unit in `CCRC_GRAPH_SLICE` that is not a `ccrc-graph-job-*` | WARN: builds would share that slice's pressure with another workload (§12.1) |
| `CCRC_GRAPH_RUNNER=inline` on a host whose user systemd manager answers | WARN: builds run uncapped inside the sweep's own cgroup |
| The last N passes' `jobs[]` are all `skipped-pressure` | WARN: the box never has room for a build; the numbers it saw are named |
| A `skipped-store-full` job in the last pass | WARN with the store size, the ceiling and the assigned-base count |

---

## 12. Where heavy builds run

### 12.1 Default: one transient service per job, in a dedicated slice, admitted under a pressure check

**Why not the test slice.** Revision 2 ran builds in the deployment's capped test slice, "so graph builds compete
with test runs under one memory ceiling". That moves session starvation rather than removing it. On the reference
fleet, memory pressure inside a capped, shared slice is what has stalled the box: a slice throttled at its
`MemoryHigh` went into a reclaim storm that froze everything, with no OOM kill to end it. Test runs already fill that
slice, so a 4.2 GB build there either throttles the tests or is throttled with them, while sessions wait on both.
A build should instead be the first thing to give way, never the reason anything else waits.

**The invocation.** `systemd-run` refuses `--wait` together with `--scope` ("--wait may not be combined with
--scope"). The design therefore fixes one form: every job is a **transient service**, never a scope.

```
systemd-run --user --quiet --wait --collect --pipe \
  --unit=ccrc-graph-job-<job> --slice="$CCRC_GRAPH_SLICE" \
  -p MemoryMax="$CCRC_GRAPH_BUILD_MEMORY_MAX" -p MemorySwapMax="$CCRC_GRAPH_BUILD_SWAP_MAX" \
  -p MemoryHigh=infinity -p OOMPolicy=kill \
  -p CPUWeight="$CCRC_GRAPH_BUILD_CPU_WEIGHT" -p IOWeight="$CCRC_GRAPH_BUILD_CPU_WEIGHT" \
  -p RuntimeMaxSec=$((CCRC_GRAPH_BUILD_TIMEOUT + 30)) \
  --working-directory=<job>/src \
  --setenv=GRAPHIFY_OUT=… --setenv=GRAPHIFY_NO_BACKUP=1 --setenv=PYTHONHASHSEED=0 \
  --setenv=GRAPHIFY_MAX_WORKERS=… --setenv=GIT_CEILING_DIRECTORIES=… \
  -- nice -n 15 timeout "$CCRC_GRAPH_BUILD_TIMEOUT" <venv>/bin/python <ccd>/graph-patch …
```

- A transient service does not inherit the sweep's environment, so every variable §5.3 lists is passed with
  `--setenv`. Row N25 pins that list against §5.3's.
- `--wait` returns the service's exit status. `timeout` inside gives 124 on the job's own deadline, and
  `RuntimeMaxSec` is only a backstop 30 s later, if `timeout` itself is stuck.
- `--pipe` connects the job's stdout and stderr to the sweep, so the discriminators of §10 still read them.
- The job's cgroup is **always** its own transient service. The cap that applies is therefore always
  `BUILD_MEMORY_MAX` on that service, whatever `SLICE` says. The sweep service's `MemoryMax`
  (`SWEEP_MEMORY_MAX`) covers only the sweep itself. That is the single answer to "which cap applies", and the
  doctor's drift check compares the service's `MemoryMax` with `SWEEP_MEMORY_MAX` alone (§4.2).
- `MemoryMax` is a hard cap and `MemoryHigh=infinity` is explicit. A build that outgrows its cap is OOM-killed
  inside its own cgroup and reported `failed` with reason `oom`. It is never throttled into a stall.
  `MemorySwapMax=0` keeps it from pushing other workloads into swap.
- `CPUWeight` and `IOWeight` of 20, against systemd's 100, mean sessions and tests win any contention, and `nice`
  stays on top of that.

**The slice.** `CCRC_GRAPH_SLICE` defaults to `ccrc-graph.slice`, used by graph jobs and nothing else. systemd
creates it implicitly. ccrc ships no slice unit and puts no limit on it, because jobs never overlap (the pass lock)
and each job carries its own cap. A deployment may rename it, but it must not point it at a slice that other
workloads use. The doctor WARNs when any loaded unit in that slice is not a `ccrc-graph-job-*` (§11).

**Admission, before every job.** The sweep reads `/proc/meminfo` and `/proc/pressure/memory`. A job starts only when
`MemAvailable ≥ BUILD_MEMORY_MAX + ADMIT_MEM_PCT % of MemTotal`, **and** memory pressure `some avg10 ≤
ADMIT_PSI_AVG10`. Otherwise the job is `skipped-pressure`, the tree keeps its current graph, and the pass moves on.
It does not wait, so a pass never sits on a busy box. Overlays need about 1.25 GB, but the check uses the full cap,
since the cap is what the job may take. A host without PSI (an old kernel) uses the `MemAvailable` test alone, and
the doctor says so once.

**Runners.** `RUNNER=local` is the form above. `RUNNER=inline` runs the same command line minus `systemd-run`. It
exists for fixture HOMEs in the test suite and for hosts without a user systemd manager, and there the service's
rendered `MemoryMax` grows by `BUILD_MEMORY_MAX` (§4.3).

One job at a time; the sweep's pass lock serializes them. Peak per job: about 4.2 GB for a full build of this
repository, about 1.25 GB for a patch (§1.3).

### 12.2 Option: the future test box

`CCRC_GRAPH_RUNNER=remote` with `CCRC_GRAPH_REMOTE=<ssh target>` sends the job's inputs (the `git archive`
stream, the predecessor `graph.json` + `manifest.json`, the changed-path list, the pin) to a runner with the same
pinned engine, and receives the build directory back as a tar. **Publish checks, the guard's subset test and the
publish itself always run on the fleet host**, so a remote runner cannot publish anything the host would refuse.
Because jobs are already pure functions of an archive and a predecessor graph, the remote runner is an adapter
on one seam, not a redesign. Not built in the first wave.

---

## 13. Cost: today versus this design

Today's figures are measured (§1.2). This design's base figures come from the §5.1 replay; the rest are
**estimates** from those measurements, and the plan's first task re-measures them on the box.

| | Today (per-tree, every 15 min) | This design |
|---|---|---|
| Builds | ~2–5 full rebuilds of ~75 s per pass for this repository alone, 96 passes a day | This repository: each base built **once**, at a live merge-base cluster or the tip; ≈2–6 new clusters a day (replay, §5.1) plus ≤4 tip bases; all bases **full** (~77 s). Overlays (~36 s for a 16-file patch) only when a query follows a change (pull-on-read, §6.2) |
| CPU | 4–17 CPU-min per pass ≈ **6–27 CPU-hours a day** | Estimate **~1.5–2.5 CPU-hours a day** fleet-wide; breakdown below |
| Peak memory | 4.6–6.0 GB per pass, in the sweep's own unit | ≤4.2 GB for a full build, ≤1.25 GB for a patch, each in its own hard-capped transient service, started only when the box has room (§12.1) |
| Disk | **9,445 MB** (131 graphs) | Estimate **~3–4 GB**: this repository ≈30 bases × ~55 MB ≈ 1.65 GB (replay), other repos fewer and smaller, plus overlays (~55 MB each, TTL 24 h); bounded by `STORE_MAX_MB` (8 GB default) |
| Writes inside trees | Every rebuild rewrites ~75 MB in the tree | One symlink, once |
| Stalls a session | Skipped while busy; escape hatch after 20 commits / 6 h | Never touches a session's tree; builds yield on CPU and IO and never start under memory pressure |

**How the CPU estimate is made.** It assumes ≈3 CPU-minutes per full build of this repository and ≈1.5 per overlay
patch, scaled from the wall times in §1.3. For this repository, per day:

| Source | Count | CPU-minutes |
|---|---|---|
| New merge-base clusters | ≈ 2–6 (replay: 16 in 7 days, 6 in the last 24 h) | ≈ 6–18 |
| Tip bases | ≤ 4, often the same commit as a new cluster's | ≤ 12 |
| Overlays | queries that follow a change. Measured ≈3 sessions a day with 2+ queries; query volume roughly doubles each month (Jul 258 → Oct 6,040), so this allows ≈6 sessions × ≈5 such queries = ≈30 | ≈ 45 |
| **Total** | | **≈ 50–75** |

Overlay builds are bounded per tree by one per `OVERLAY_MIN_INTERVAL_SECS`, and only while queries keep following
commits. Fleet-wide they are bounded by `OVERLAY_BUDGET` per pass. A tree that commits and is not read costs
nothing after its first overlay. Revision 2 rebuilt on every `HEAD` move for 24 h after the last query, which
could reach about 144 overlays a day for one busy tree.

The one-off migration builds one base per live cluster: about 30 here, ≈90 CPU-minutes, drained `BUDGET` per pass
in the §5.1 order. Every repository gets its first base before any repository gets its second.

This repository holds about half the fleet's trees and the largest graph, so the fleet-wide figure is about twice
this one, which gives the ~1.5–2.5 CPU-hours above.

Two consequences:

- Patching the tip bases would save at most about 6 CPU-minutes a day. That is why bases are not patched (§2, G11).
- No term grows with the number of worktrees as such. Bases grow with *distinct live merge-bases* and are each
  built once. Overlays grow with reads that follow a change.

---

## 14. How every 08-27 constraint is still met

| Constraint (08-27 §8 and §3) | Met by |
|---|---|
| A pin bump refreshes nothing | Pin is part of `base-id` (§5.2); `meta.json.engine` is read by card and gate |
| Sweep silently enforces nothing | `probed-zero` kept; doctor reds on a stuck overlay queue and on repos without a base |
| Un-ignored store wedges `ws-rm` / reap / gc | Only an ignored symlink in the tree; exclude writer appends the no-slash line; predicate without the slash |
| Leftover `.graphifyignore` wedges the same seams | Never written into a tree any more; exclude line kept for legacy trees |
| `built_at_commit` stamped from the wrong repo | Builds run outside any repo with `GIT_CEILING_DIRECTORIES`, so the engine stamps nothing; the sweep's `_gs_stamp` inserts the job's commit into `out/` and the publish check refuses a graph without it (§4.4) |
| Shrink refusal leaves a tree permanently stale | Our own publish check; a refused base is not published and the tree keeps its previous base |
| One wedged build stops the timer | Per-job timeout, job lock probe, pass `TimeoutStartSec` |
| Rebuild storm starves the fleet | ≤ `BUDGET` + `OVERLAY_BUDGET` jobs a pass, serialized, each in its own hard-capped, low-weight transient service in a slice no other workload uses, admitted only under the memory and pressure check (§12.1) |
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
2. The tree's view is published (`trees/<tree-key>` resolves to a view with a `graph.json`); otherwise wait. The
   tree keeps its old graph meanwhile, and the link is never placed before its view exists (§10).
3. The tree's session is idle by today's `_gs_busy`; otherwise `migrate-busy`, retried next pass.
4. Move `graphify-out/memory/` (if any) to `<store>/<repo>/memory/<tree-key>/`.
5. `mv <tree>/graphify-out <store>/.trash/<tree-key>.<ts>` — a same-filesystem rename, which is why
   `CCRC_GRAPH_STORE` should sit on the worktrees' filesystem. On a different filesystem a rename is a copy, so
   the sweep instead deletes the directory in place under `ionice -c3` and then places the link; the gap without
   a graph is seconds, and only for an idle session.
6. `ln -s <store>/<repo>/trees/<tree-key> <tree>/graphify-out`; census `migrated`.

**Excluded repositories** (`CCRC_GRAPH_REPOS_EXCLUDE`). The same idle gate and budget apply, with steps 2 and 6
skipped. A legacy graphify directory goes to `.trash` (step 5), and its `memory/` is kept in the store (step 4).
No link is placed, so an excluded repository's sessions stop reading a graph that nothing refreshes any more. An
existing link in an excluded repository (the repository was excluded after migration) is unlinked, and its view
is collected after `VIEW_GRACE_SECS`. The census row is `no-graph` and the card says the repository is excluded.

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
| `graph-base` | `<store>/<repo>/bases/` | E (assignment + TTL) | sweep | sweep (§5.1 retention + TTL) | one per live merge-base cluster; `STORE_MAX_MB` |
| `graph-overlay` | `<store>/<repo>/overlays/` | E (TTL) | sweep | sweep | `OVERLAY_TTL_SECS`, `STORE_MAX_MB` |
| `graph-view` | `<store>/<repo>/views/`, `trees/` | W (tree-bound) | sweep | sweep, on tree death | tree lifetime + grace |
| `graph-tree-link` | `<tree>/graphify-out` | W | sweep only, after the view publishes (§10 step 7) | the worktree's three collectors (ignored) | tree lifetime |
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
| N9 | Stamp, insert and replace | (insert) a full build run outside any repository, whose `graph.json` has no `built_at_commit` key, is refused at publish or published without the key, or with the key anywhere but last, or `GRAPH_REPORT.md` gains no `Built from commit` line; (replace) an untouched-predecessor overlay is published still carrying the base's commit; or `_gs_stamp` writes anywhere but its directory argument |
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
| N20 | Due check | touching an existing request starts a pass; creating a new one, or a stale-graph wake rewriting one, does not make the next tick due; a second stale-graph query within `OVERLAY_MIN_INTERVAL_SECS` wakes again; a not-due tick writes a census row |
| N25 | Job invocation | a job runs as a scope, or without `--wait`, or in the sweep's own cgroup under `RUNNER=local`; or a §5.3 variable is missing from the job's `--setenv` list; or `MemoryHigh` is set below `infinity` |
| N26 | Admission | a job starts while the fixture `MemAvailable` is below `BUILD_MEMORY_MAX` plus the margin, or pressure is above `ADMIT_PSI_AVG10`; or a `skipped-pressure` job leaves its tree without its previous graph |
| N27 | Link after view | a pass creates a tree's link before its view's `graph.json` exists; `ccd ws-add` creates a link; or a tree of a `no-base` repository gets a link |
| N28 | Cluster bases, no starvation | with the store under its ceiling, a live one-tree merge-base more than `BASE_MAX_DRIFT_FILES` from every base never gets a base; an existing cluster centre is re-planned; or an assigned base is evicted to make room |
| N29 | Build order | a repository with no base waits while another repository's second base is built; or tip demand with no live tree near it outranks a cluster of two live trees |
| N24 | Pull-on-read | a requested tree's `HEAD` moves three times with no query after it and any overlay is built; or a query after a move does not lead to a build within one tick plus one build |
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
| **G4** | Overlay size cap, on the patch set (`head_files` = drift + branch) | 50 / **100** / 200 files | **100**: with drift held at ≤ 50 (G9), any branch of ≤ 50 files qualifies, and the measured p90 branch is 34; the §5.1 replay puts 94 of 94 worktrees within 100 once their cluster base exists; edge loss grows with patch size |
| **G5** | Uncommitted and untracked files in overlays | (a) off; (b) on, marked partial | **(a) off** for the first wave; turn on once overlay latency is measured |
| **G6** | Where builds run | (a) a dedicated `ccrc-graph.slice` on the fleet host, one hard-capped low-weight transient service per job, with an admission check; (b) the capped test slice; (c) remote test box | **(a)** now, never (b) (§12.1); (c) when that box exists — it is one adapter on the job seam |
| **G7** | Overlay latency | (a) a 60 s tick with a due check that fires on a new request (§10); (b) a `.path` unit on the flat `requests/` dir; (c) poll only | **(a)**: the overlay lands about one tick plus one build after the second query, with no new unit, and the tick is the debounce |
| **G8** | Migration of the 131 existing `graphify-out` directories | (a) automatic, idle-gated, budgeted, `memory/` preserved; (b) operator-run one-shot | **(a)** |
| **G9** | Base retention, drift and rate | (a) one immutable base per live merge-base cluster, radius `BASE_MAX_DRIFT_FILES` 50, bounded by `STORE_MAX_MB` (8 GB), one tip base per repo per 6 h; (b) revision 2's count cap (`MAX_BASES` 6) with vote-margin eviction; (c) (a) at radius 100 | **(a)**: the replay was run before this ruling (§5.1). It needs 30 bases (≈1.65 GB) for 94 worktrees, and every tree then qualifies for an overlay. (b) leaves a one-tree cluster without a base for its whole life; (c) saves 4 bases but drops 10 trees out of overlay range. Revisit after a week of census data |
| **G12** | When an overlay is rebuilt | (a) pull-on-read: only when a query arrived after the served overlay was built (§6.2); (b) on every `HEAD` move while the request is live (revision 2) | **(a)**: a `HEAD` move alone never builds; a busy tree that is not read costs nothing |
| **G11** | Patch bases too? | (a) bases always full, overlays the only patch path; (b) patch tip bases from the previous tip with a periodic full build | **(a)**: about 6 CPU-minutes a day saved here does not pay for a patch-chain state and a drift class on shared graphs (§2, §13) |
| **G10** | Gate arming | (a) by files differing (`GATE_MAX_DIFF_FILES`, default 300); (b) keep commits behind (10) | **(a)** — a worktree 12 commits ahead of a base at its merge-base is a good graph, and "commits behind" would refuse it |

---

## 20. Out of scope

- Semantic (LLM) extraction — still declined (08-27 Appendix A).
- Cross-repository graphs (`merge-graphs`) — 1.7% of queries reach another repository; not worth a union graph.
- Any change to graphify upstream. The incremental CLI flag (`graphify update --changed …`) would let
  `graph-patch` disappear; worth proposing upstream, not waiting for.
- A PWA surface for the store beyond the existing pause file and census.
