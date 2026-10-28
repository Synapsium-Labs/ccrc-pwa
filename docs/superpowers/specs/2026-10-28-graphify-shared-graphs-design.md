# Graphify on the fleet, revision 2: one graph per repository, built from main — design

**Date:** 2026-10-28 · **Status:** draft for operator review · **Branch:** `docs/graph-design-v2`
**Revision 4 of this draft.** Operator direction, 2026-10-28: one graph per repository, at main, not one per
worktree; the per-worktree sweep is "extreme". This text replaces revisions 1 to 3 as a whole. Their machinery
(per-branch overlays, one base per merge-base cluster, demand votes, request files, views, a `.path` trigger) is
gone. What survives of it is a short **Later options** section (§12) with the measured case for and against each.
**Revision 5** fixes the build mechanics a review found unbuildable: staged copies are writable until publish
(§3.5), every build has its own id (§2.1), saved results have one absolute link and a guard exemption (§2.1,
§2.2), the build output keeps the engine's own directory name (§3.4), and where each new file lives and how each
reader loads it is stated (§5.2).
**Replaces:** the **Store** ruling of `2026-08-27-graphify-fleet-integration-design.md` (§2, §3.4, §D, the
`workspace-graph-store` / `project-graph-store` rows of its §7) and the sweep body of its §C.
**Keeps:** the engine pin and its provisioning (§A), skill convergence (§B), AST-only depth (Appendix A), the
census vocabulary (§C.3) where a word still describes something, the "zero trees probed is an error" rule (§C.4),
and the read side of `2026-09-02-graphify-read-side-ccrc-level-design.md` (R1 card, R4 query count, R5 gate) and
`2026-09-09-graphify-compaction-card-design.md`, retargeted to the repository's graph (§6).

## 0. Answer first

1. **One graph per repository**, built from the repository's main line (`origin/HEAD`, configurable) in a
   ccrc-owned store outside every worktree. The store holds one ccrc-owned checkout of main per repository and the
   published graph built from it.
2. **Refreshed when main moves, incrementally.** Each pass compares main's tip with the commit the published graph
   was built at. If they differ, the sweep re-extracts **only** the files `git diff --name-only <built> <tip>`
   names, through a small ccrc wrapper (`ccd/graph-build`) that calls the pinned engine's own incremental path,
   `_rebuild_code(changed_paths=…)`. A full rebuild runs as a safety net every `CCRC_GRAPH_FULL_REBUILD_SECS`
   (default one day), and whenever an incremental refresh would not be safe (§3.3).
3. **Every session's default graph is its repository's graph.** Each tree keeps one git-ignored symlink,
   `graphify-out -> <store>/<repo-key>/current`, so the skill, `graphify query`, the card, the gate and the
   compaction helper all read it through the path they read today. A session reads its own branch's changes from
   `git diff`; the card names them. Staleness is how far main has moved since the last refresh, and it is bounded
   by the refresh interval (§6.2).
4. **Builds run in the capped tests slice** (`ccrc-tests.slice`, #1785) through `ccrc test --heavy`, at low CPU
   and IO weight, behind the same admission queue as test runs, so a build never starves a coding session (§4).
5. **Migration** deletes the per-worktree `graphify-out` directories, which are git-ignored, so removing a
   worktree is unaffected. The sweep does it, idle-gated and budgeted. It deletes nothing that does not look like
   graphify output (§9). The census gains one row per repository in place of one row per tree (§7).
6. **Every size, interval, path and limit is a ccrc setting** in the box's `~/.ccrc/ccrc.env`, read by ccrc's one
   settings reader, `_ccrc_knob`, with a neutral default (§5).

Build cost then grows with how often main moves, not with the number of worktrees.

---

## 1. Measured facts

All counts were measured 2026-10-28 on the reference fleet's fleet box, read-only and at idle priority. No
transcript or question text was read out; only counts.

### 1.1 Usage: sessions use the graphs, mostly about existing code

- graphify's own query log: 10,312 queries from 2026-07-22 to 2026-10-28, rising monthly (Jul 258, Aug 1,315,
  Sep 2,699, Oct 6,040); typically **150 to 300 a day** over the last 14 days. 94.5% are `query`.
- 8,335 queries went to a worktree's graph, 1,970 to a main checkout's.
- Session transcripts, last 21 days, 3,625 deduplicated graph commands: 98.0% queried the session's own tree;
  1.7% another repository; one query another worktree of the same repository; none queried the main checkout's
  graph from a worktree. Sessions do not choose a graph: whatever sits at `graphify-out/` in their cwd is what they
  read. Routing to a shared graph must therefore happen at that path, not by asking sessions.
- Queries per session: p50 1, p90 23, max 828. 129 of 197 sessions ran exactly one query.
- In 14% of transcript files the first query came right after a search-gate denial.
- For 2,580 worktree queries whose tree still exists and has branch changes: the query names a changed file's
  stem in **11.9%**; the result cites a changed file in 36.8% (inflated: results are about 300 nodes and 6.3k
  chars); **neither in 58.2%**. Reading: **at least about 58% of queries concern existing code only; at most about
  12% are directly about the branch's own changes.**
- Per query: p50 1.88 s, p90 4.95 s; results sit at the token budget (p50 6,300 chars).

### 1.2 Cost: today's sweep rebuilds near-identical graphs in full

- 131 trees in the last census pass; 121 worktrees across 14 repositories. This repository alone had 63 trees
  (62 worktrees, 61 of them carrying a graph).
- Disk: 9,445 MB of `graphify-out` in total; this repository's trees 4,128 MB (about 53 MB `graph.json` + 21 MB
  cache + 0.6 MB manifest + 0.5 MB report each, about 48k nodes).
- This repository's worktrees: median 12 commits ahead of `origin/main` and about 35 behind (1 to 889). Files
  changed versus their merge-base: **median 15.5**, p90 34, max 80, of about 4,015 tracked (≈0.4%). Files
  differing from the *current* main tip: p50 323, p90 1,738. `origin/main` moved 348 commits touching 1,817 files
  in 7 days.
- Sweep passes (one day of journal since the fleet changed hosts): 4m01s to 16m48s CPU per pass, 3m35s to 12m51s
  wall, peak memory 4.6 to 6.0 GB. The last pass was SIGKILLed at its start timeout. The timer is currently
  disabled pending this redesign.
- Census, 10 passes: fresh 1,139, refused-by-guard 98, stale-rebuilt 16, never-built 11, restamped 1. A
  head-moved rebuild of one of this repository's worktrees costs 69 to 84 s; a cold build 65 to 77 s.
- The sweep log records 11,007 `graphify update` runs over its life, **every one a full re-extraction**: the
  0.9.9 CLI's `update` never passes `changed_paths` (`__main__.py:3827`).

### 1.3 Engine: what the pinned 0.9.9 can do

Paths are under the venv's `site-packages/graphify/`.

- **Incremental re-extraction exists in the library.** `watch.py:660` `_rebuild_code(watch_path, *,
  changed_paths=None, follow_symlinks=False, force=False, no_cluster=False, acquire_lock=True,
  block_on_lock=False)` re-extracts only `changed_paths`, keeps unchanged files' nodes from the existing
  `graph.json` in its output directory, and evicts paths that no longer exist on disk (`watch.py:782-840`).
  Clustering still runs over the whole merged graph. The engine's own git post-commit hook uses exactly this path,
  feeding it the commit's files through `GRAPHIFY_CHANGED` (`hooks.py:111-134`).
- **Output directory.** `paths.py:23` reads `GRAPHIFY_OUT` **once, at import**; an absolute path is accepted.
  `_rebuild_code` writes to `watch_path / GRAPHIFY_OUT`, which is the absolute path itself when it is absolute.
- **Root and `source_file`.** With a relative `watch_path`, `project_root = Path.cwd().resolve()`
  (`watch.py:746`), and every `source_file` is relativized against it (`watch.py:854`). Absolute changed paths
  are taken as they are; relative ones are tried against the cwd and the watch root (`watch.py:218-240`).
- **Lock and queue.** With `acquire_lock=True` and `block_on_lock=False` (the default), an incremental call that
  finds `<out>/.rebuild.lock` held appends its paths to `<out>/.pending_changes`, prints "changes queued" and
  returns False (`watch.py:694-707`); the holder drains the queue later. That silent hand-off is what this design
  must not inherit. With `acquire_lock=False` the engine takes no lock, writes no queue and drains none.
- **Commit stamp.** `_git_head()` runs `git rev-parse HEAD` in the **process's cwd** (`watch.py:181-188`), and its
  result is written as `built_at_commit` (`watch.py:826`, `:979-983`). Run with the cwd at a checkout of the target
  commit, it stamps that commit.
- **"Outputs left untouched."** When an incremental refresh changes no topology, the engine returns True and
  leaves `graph.json` as it was (`watch.py:940-953`), still carrying the previous `built_at_commit`.
- **Merging is union only** (`merge-graphs`, `merge-driver`); neither overrides a graph's nodes for changed files.

### 1.4 The incremental measurement

Building this repository's `origin/main` (4,104 tracked files) with the pinned engine and 4 workers, on a
development machine:

| | Full build | Patch of 16 changed files via `_rebuild_code(changed_paths)` |
|---|---|---|
| Wall time | 77.4 s | 36 s |
| Peak memory | 4.2 GB | 1.25 GB |
| Result | 48,172 nodes / 114,127 edges | 192 edges missing versus a full build, nearly all touching the changed files |

Full-build phases: `extract()` 57.1 s, of which per-file parse ≈26.5 s and cross-file symbol resolution 30.6 s;
whole-graph work after extraction ≈20 s. Adding neighbour files to a patch made the loss worse (192 → 648 missing
edges), so the design passes exactly the changed files and nothing more. A chain of incremental refreshes can
accumulate such losses; the periodic full rebuild bounds that (§3.3), and the plan's first task measures it (§11).

---

## 2. Shape and store

### 2.1 Layout

```
$CCRC_GRAPH_STORE/                     default $HOME/.ccrc/graphs; always used as its realpath
  .ccrc-graph-store                    marker written at creation; uninstall and every collector refuse a root without it
  settings.json                        the read-side settings, resolved by the sweep each pass (§5.3)
  <repo-key>/                          basename of the main checkout + "-" + sha8 of realpath(git common dir)
    source                             realpath of the repository's common dir (identity and collision check)
    <repo-name>/                       the ccrc-owned checkout of main (§2.2); the engine's cwd and scan root
    builds/<build-id>/                 one published graph; read-only once published (0444 files, 0555 dirs)
      graph.json  GRAPH_REPORT.md  .graphify_labels.json  manifest.json  meta.json  .graphify_engine
      memory -> <store>/<repo-key>/memory   absolute link; the only writable member (graphify save-result)
    current -> builds/<build-id>       the served graph; replaced by one rename
    memory/                            save-result output for this repository
    staging/                           the build in progress; private to the running build, removed after it
      changed.z  .started              the sweep's and the wrapper's working files; never published
      graphify-out/                    GRAPHIFY_OUT for the build (§3.4); becomes builds/<build-id> at publish
  .trash/                              per-tree directories being deleted by migration, when same-filesystem (§9)
```

Each tree holds one ignored symlink, `<tree>/graphify-out -> <store>/<repo-key>/current` (absolute).

**Build id.** `<build-id>` is `<commit12>-<pin>-<UTC time of the build's start, YYYYmmddTHHMMSSZ>`. Two builds at
the same commit, which is normal (the safety-net full rebuild of a repository whose main has not moved, a
`noise_digest` change, a `.graphifyignore` change), therefore never share a directory. Builds are serialized by
the pass lock (§3.4), so two builds of one repository cannot start in the same second; if the target exists
anyway, the publish refuses (`failed: build id exists`) and the next pass gets a new id. A published build is
never replaced in place.

**The `memory` link.** Every staged and published build holds `memory -> <store realpath>/<repo-key>/memory`,
absolute, so it resolves the same from `staging/graphify-out/` and from `builds/<build-id>/`, and the move at
publish cannot break it. The sweep creates `<repo-key>/memory/` (0755) before the first build.

**One resolver.** `ccd/graph-resolve` (a sourced bash library) is the single definition of `repo-key`, the store
root's realpath and "the source ref of this repository". The sweep, the exclude writer, the doctor, `ccrc install`
and `ccrc uninstall` source it. The session hook does not: it learns everything it needs from the build's
`meta.json` through its own link (§6.1), and finds a repository's census row by its `source` path (§7).

### 2.2 The checkout of main

Per repository the store holds one checkout, made once by the sweep:

```
git clone --shared --no-checkout --no-tags -q <realpath of common dir> <store>/<repo-key>/<repo-name>
git -C <checkout> config gc.auto 0
git -C <checkout> config core.hooksPath /dev/null
```

and moved to a new commit before each build with:

```
git -C <checkout> checkout -q --detach --force <commit>
git -C <checkout> clean -ffdxq -e /.graphifyignore
```

- **Why a shared clone, not a `git worktree`.** A registered worktree would appear in the main checkout's
  `git worktree list`, and therefore as a child in `ccd`'s worktree enumeration (`_ws_children`, `ccd:12051`) and
  in its reap and audit verbs. A shared clone is a separate repository that borrows the main repository's objects
  through `objects/info/alternates`: nothing in the main repository refers to it, no object is copied, and its
  working files cost one tracked tree (about 176 MB for this repository).
- **Why it is safe to borrow objects.** The checkout only ever checks out a commit the main repository's source
  ref names at that moment, which the main repository's `gc` cannot prune. The clone itself never runs `gc`
  (`gc.auto 0`) and runs no hooks.
- **Nothing else writes there.** Sessions are never pointed at it. `checkout --force` plus `clean -ffdx` before
  every build makes it exactly the tracked files at the commit, so untracked and ignored files cannot be ingested.
  The generated `.graphifyignore` (the tracked-noise list: `ccd/graph-noise.default.list` plus the operator's
  `graph-noise/<repo>.list`, appended to a committed `.graphifyignore` if the commit carries one) is written into
  the checkout's root, where `detect()` reads it, and is excluded in the checkout's own `.git/info/exclude`. It is
  never written into a session's tree any more.
- **The corpus guard stays,** as a consistency check: `detect()` on the checkout must be a subset of
  `git ls-tree -r --name-only <commit>`, with two exemptions: the generated `.graphifyignore`, and saved results.
  `detect()` always adds the files under `GRAPHIFY_OUT/memory` (`detect.py:1101-1104`), which here is
  `staging/graphify-out/memory`, the link to `<repo-key>/memory/`. Those paths are outside the checkout, so they
  are never in `git ls-tree`. The guard runs `detect()` with the same `GRAPHIFY_OUT` as the build, makes each path
  it reports absolute and real (`os.path.realpath` against the checkout), and excuses every path under
  `realpath(<store>/<repo-key>/memory)/`. This replaces today's `^graphify-out/memory/` exemption
  (`ccd-graph-sweep:422`), which matched the in-tree spelling and matches nothing now. On a clean checkout it
  should never fire; if it does, the outcome is `refused-by-guard` and nothing is published. The 98 per-tree
  refusals of §1.2 came from untracked files in worktrees, which a clean checkout of main does not have.
- **Store root constraints.** The store root must be an absolute path, not `/`, not `$HOME`, and not inside
  `PROJECTS_ROOT` or `WORKTREES_ROOT`, which `_gs_trees` and `ccd` enumerate; otherwise the sweep refuses to run
  (`status: failed`, reason named) and the doctor FAILs (§8).

### 2.3 `meta.json`

About 1 KB, in every published build. Readers read it instead of tail-reading a 53 MB `graph.json`.

```json
{ "schema": 1, "build_id": "<commit12>-<pin>-<ts>", "repo_key": "…", "source": "<realpath of common dir>", "store": "<store realpath>",
  "ref": "refs/remotes/origin/main", "commit": "<full sha>", "engine": "0.9.9",
  "kind": "full|incremental", "changed_files": 16,
  "last_full_commit": "<sha>", "last_full_at": "<iso>", "noise_digest": "<sha256 of the generated .graphifyignore>",
  "nodes": 48172, "edges": 114127, "files": 4104,
  "built_at": "<iso>", "duration_ms": 36000, "peak_rss_kb": 1310720 }
```

`meta.json` is also the build state: the next pass reads the current build's `commit`, `engine`,
`last_full_at` and `noise_digest` to decide between no build, an incremental refresh and a full rebuild (§3.3).
There is no second state file.

---

## 3. Refresh

### 3.1 When

The sweep's timer fires every `CCRC_GRAPH_REFRESH_SECS` (default 900, today's cadence; the value is rendered into
the timer at install, §5.2). Each pass, per repository with at least one enumerated tree:

1. **Fetch,** throttled: if `CCRC_GRAPH_FETCH_SECS` is above 0 and the main checkout's `FETCH_HEAD` is older than
   it, `git -C <main checkout> fetch --no-tags -q origin <branch of the source ref>` with `GIT_TERMINAL_PROMPT=0`
   and a 60 s timeout. A failed fetch is recorded as the row's `reason` and the pass carries on with the refs it
   has. The fetch writes only `refs/remotes/origin/<branch>`, which sessions already share.
2. **Resolve** the source ref to a commit, `tip` (`CCRC_GRAPH_SOURCE_REF`, default `origin/HEAD`, falling back to
   `origin/main`, `origin/master`, then the local default branch for a repository with no remote).
3. **Compare** `tip` with the current build's `meta.json`. Equal commit, same engine pin, same noise digest, and
   the last full build younger than `FULL_REBUILD_SECS`: outcome `fresh`, nothing is built.
4. Otherwise a build is due, incremental or full by §3.3, within the pass's `CCRC_GRAPH_BUDGET` (default 4 builds
   a pass). A due build past the budget is `skipped-budget` and goes first next pass. Order: repositories with no
   published build first, then the most commits behind `tip`.

Commits that land between passes coalesce: one refresh covers all of them.

### 3.2 Incremental refresh

```
git -C <checkout> diff -z --no-renames --name-only <built commit> <tip>  >  <staging>/changed.z
```

`--no-renames` reports a rename as a delete plus an add, so the engine evicts the old path and extracts the new
one. Paths are relative to the repository root, which is the checkout's root. The engine itself filters them
against what `detect()` found, so a noise-listed or non-code path in the list costs nothing.

### 3.3 Full instead of incremental

A full rebuild (`changed_paths=None`) runs instead when any of these holds:

| Condition | Why |
|---|---|
| No published build for the repository | Nothing to patch. |
| The current build's `engine` differs from the pin | A new engine must re-extract everything (08-27 C.1). |
| `noise_digest` differs | The corpus definition changed; files leaving or entering it are not in the diff. |
| `git merge-base --is-ancestor <built> <tip>` fails | Main was rewritten; the diff no longer describes a history. |
| The diff names more than `CCRC_GRAPH_INCREMENTAL_MAX_FILES` (default 200) files | Edge loss grows with patch size (§1.4); a large patch is close to a full build's cost anyway. |
| The diff names `.graphifyignore` | Same as a noise change. |
| `last_full_at` is older than `CCRC_GRAPH_FULL_REBUILD_SECS` (default 86400) | The safety net: it bounds how long incremental edge loss can accumulate. |
| The previous build of this repository failed | Do not build a patch on a state that just failed. |

### 3.4 The engine wrapper, `ccd/graph-build`

A short Python program run by the pinned venv's interpreter. It is the only way ccrc invokes the engine; the sweep
no longer runs `graphify update`.

**The sweep's call.** The sweep prepares `staging/` (§3.5) and then runs, from the checkout's realpath:

```
cd <store>/<repo-key>/<repo-name>                       # realpath; the engine's cwd and project root
GRAPHIFY_OUT=<store>/<repo-key>/staging/graphify-out \  # absolute; set in the environment BEFORE the interpreter starts
GRAPHIFY_NO_BACKUP=1 PYTHONHASHSEED=0 \
GRAPHIFY_MAX_WORKERS=$CCRC_GRAPH_MAX_WORKERS GIT_TERMINAL_PROMPT=0 \
timeout --kill-after=30 $((CCRC_GRAPH_SLOT_WAIT_SECS + CCRC_GRAPH_BUILD_TIMEOUT)) \
  "$GRAPH_LIB/ccrc-test" --heavy -- \
    nice -n "$CCRC_GRAPH_BUILD_NICE" ionice -c3 \
    timeout --kill-after=30 "$CCRC_GRAPH_BUILD_TIMEOUT" \
      "$VENV/bin/python" -s -P "$GRAPH_LIB/graph-build" \
        --root <checkout realpath> --out <staging realpath>/graphify-out --commit <tip> --pin <pin> \
        [--changed <staging realpath>/changed.z]
```

`$GRAPH_LIB` is the directory holding the shipped `ccrc`, `ccrc-test` (the file `ccrc test` runs, #1785), `graph-build` and `graph-resolve` (§5.2);
`$VENV` is the pinned engine's venv, `$HOME/.ccrc/graphify-venv`, as today (`ccd-graph-sweep:11`).

**The output directory is named `graphify-out`.** The pinned engine adds `GRAPHIFY_OUT`'s basename
(`GRAPHIFY_OUT_NAME`, `paths.py:215`) to the directories `detect()` skips (`detect.py:696`) everywhere in the
scanned tree. Any other basename would silently drop every source directory of that name from the graph, and the
subset-only corpus guard cannot notice a missing file (`staging` would drop a tracked `staging/` directory, which
at least one fleet repository has). `graphify-out` is the engine's default and is already skipped by today's
builds, so this keeps the corpus exactly what it is today. The wrapper checks it (below), and test N24 holds it.

`ccrc test` runs its command as a scope in place, so the command keeps this environment and working directory
(#1785). `-s -P` keeps user site-packages and the script's directory off `sys.path`, so a module at the root of a
repository can never shadow an import.

**What the wrapper checks before it calls the engine**, each failure exiting 2 with one line on stderr (outcome
`failed`, the line as reason):

| Check | Why |
|---|---|
| `os.path.realpath(os.getcwd()) == --root` | `source_file` is relativized against the cwd (§1.3); a wrong cwd silently re-roots every node. |
| After `import graphify`: `graphify.paths.GRAPHIFY_OUT == --out` | `GRAPHIFY_OUT` is read once at import; a value set later is ignored. |
| `os.path.basename(--out) == "graphify-out"` | Any other basename becomes a skipped directory name in the scan (above). |
| Every file in `--out` is writable by the wrapper | The engine rewrites the report, labels and manifest in place (`watch.py:1017-1018`, `save_manifest`); a read-only copy makes `_rebuild_code` return False (`watch.py:1072`) with no clear reason. |
| `importlib.metadata.version("graphifyy") == --pin` (the package exports no `__version__`) | The private function below is pinned to this version. |
| `git rev-parse HEAD` in the cwd equals `--commit` | `_git_head()` stamps the cwd's `HEAD` (§1.3); this makes the stamp the target commit. |
| `inspect.signature(_rebuild_code)` has `changed_paths`, `force` and `acquire_lock` | A pin bump that changes the private API goes red here, not silently. |

**The call.**

| Aspect | Fixed as |
|---|---|
| Watch path | `Path(".")`, relative, so `project_root = Path.cwd().resolve()` is the checkout's realpath and the report's root label is the repository's name (the checkout directory is named after it, §2.1). Every `source_file` is repository-relative, the same spelling today's `cd <tree> && graphify update .` produces, so sessions' paths, the graph's nodes and the evictions all agree. |
| `changed_paths` | Incremental: the NUL-separated list from §3.2, each made absolute as `<root>/<path>`. Absolute paths resolve the same way whatever the engine's cwd/watch-root fallback does (`watch.py:218-240`), and a path missing on disk is evicted. Full: `None`. |
| Lock | `acquire_lock=False`. The engine takes no `.rebuild.lock`, writes no `.pending_changes` and drains none, so nothing is ever queued for a later process that may never run. Serialization is ccrc's: the sweep's pass lock (`flock -n` on `~/.ccrc/graph-sweep.lock`, unchanged); a second pass that finds it held exits at once with census status `pass-locked`, which the doctor reads. Nothing waits on a lock silently, and the only wait in the path, for a heavy test slot, is bounded and reported (§4). |
| Shrink | `force=True`; ccrc's own `MAX_SHRINK_PCT` publish check decides (§3.5). |
| Clustering | Default (`no_cluster=False`); the predecessor's `.graphify_labels.json` in `staging/graphify-out/` keeps community names stable. |
| Result | Exit 0 when `_rebuild_code` returns True, 1 when False, 2 on a failed check, 124 from `timeout`. The wrapper also writes `.started` beside `--out` (in `staging/`, so it is never published) before the call, so the sweep can tell a build that timed out from one that never got a slot (§4), and prints its own `ru_maxrss` for `meta.json`'s `peak_rss_kb`. |

`_rebuild_code` is private. The pin makes that acceptable, and both the wrapper's signature check and a contract
test (§11, N3) go red if a new pin changes it.

### 3.5 Staging and publish

1. `staging/` and `staging/graphify-out/` are created empty (0755), then the current build's `graph.json`,
   `manifest.json`, `.graphify_labels.json` and `GRAPH_REPORT.md` are copied into `staging/graphify-out/` (for a
   full build too: the predecessor graph is what the engine remaps community ids against). **The copies are made
   writable:** the published originals are 0444, and a plain `cp` keeps that mode, so each copy is written with
   `install -m 0644` (or `cp` then `chmod 0644`). The engine and the stamper rewrite these files in place (§3.4,
   step 3); only step 5 removes write permission. The absolute `memory` link of §2.1 is placed so the report's
   learning section reads the repository's saved results, as it does per tree today. No lock file, queue file or
   `.graphify_root` is ever copied.
2. The build runs (§3.4).
3. **Stamp.** If the engine left its outputs untouched (an incremental refresh with no topology change, §1.3),
   `graph.json` still carries the previous commit. The sweep's stamper, today's `_gs_restamp` retargeted from
   `$tree/graphify-out` to a directory argument (`_gs_stamp <dir> <sha>`), replaces the `built_at_commit` value in
   the last 4 KiB and the `Built from commit` line of `GRAPH_REPORT.md`. Every build runs inside a git checkout,
   so the key is always present; a `graph.json` without it is a refusal (`failed: cannot stamp`).
4. **Publish checks:** `graph.json` parses; its `built_at_commit` equals `tip`; its node count is not below the
   predecessor's by more than `CCRC_GRAPH_MAX_SHRINK_PCT` (default 20; `refused-shrink`); `meta.json` is written.
5. **Publish:** `find staging/graphify-out ! -type l -exec chmod a-w {} +` (files 0444, directories 0555; the
   `memory` link is not followed and stays as it is), `mv -T staging/graphify-out builds/<build-id>` (`-T`, so an
   existing target fails instead of receiving the directory inside it; §2.1 says why it never exists), then
   `ln -s builds/<build-id> current.new && mv -T current.new current`, one rename, then `staging/` is removed. A
   reader that already opened the previous build's files keeps reading them. This is the only step that removes
   write permission.
6. Superseded builds beyond `CCRC_GRAPH_KEEP_BUILDS` (default 2: the current one and its predecessor, kept for a
   rollback) are deleted once older than `CCRC_GRAPH_BUILD_GRACE_SECS` (default 3600).

A refused or failed build publishes nothing: `current` keeps serving the previous graph, and the next pass tries
again (a full rebuild, by §3.3's last row).

---

## 4. Where builds run

Builds run in the capped tests slice, through its one owner, `ccrc test` (#1785, D-TBD-test-containment):

- **The slice.** `ccrc-tests.slice` has a hard `MemoryMax`, bounded swap, `CPUWeight` and `IOWeight` of 20 against
  a session's systemd default of 100, a CPU quota, and no `MemoryHigh` (#72, #84). Its limits are ccrc settings
  (`CCRC_TEST_SLICE_*`) that `ccrc test` applies before every run. A build there always yields CPU and IO to coding
  sessions and to `ccrc-agent`, and a build past the cap is OOM-killed inside the slice without pushing the session
  slice into reclaim.
- **Within the slice,** `nice` (`CCRC_GRAPH_BUILD_NICE`, default 15) and `ionice -c3` put the build behind the
  test runs it shares the slice with.
- **Admission.** `--heavy` takes one of the fleet-wide heavy slots (`CCRC_TEST_HEAVY_SLOTS`), so builds and heavy
  test runs share one queue and one pressure check (`CCRC_TEST_PRESSURE_MAX`). There is no second admission
  mechanism here. The wait for a slot is bounded by the outer `timeout` (`SLOT_WAIT_SECS + BUILD_TIMEOUT`). If it
  fires and `staging/.started` does not exist, the outcome is `skipped-slots` (the queue was full for
  `SLOT_WAIT_SECS`); if `.started` exists it is `timed-out`. Both are census rows the doctor reads, never a silent
  wait.
- **A missing slice is refused, never created.** `ccrc test` refuses a slice the user manager has not loaded. The
  build is then `failed` with that reason, and the doctor WARNs (§8). On a host with no user systemd manager
  (macOS), `ccrc test` runs the command uncontained and says so; the sweep records it in the row's `reason`.
- **Memory.** An incremental refresh of this repository peaks around 1.25 GB, a full rebuild around 4.2 GB
  (§1.4). Full rebuilds are therefore the build that can meet the slice's cap while a heavy test run holds the
  other slot. One OOM-killed build costs one retry next pass and serves the previous graph meanwhile. The wrapper
  records `peak_rss_kb` in `meta.json`, and the doctor WARNs when the last full build's peak exceeds 75% of the
  slice's `MemoryMax` (§8), so the operator sizes `CCRC_TEST_SLICE_MEMORY_MAX` from a measurement (decision G5).
- **Ordering.** This design lands after #1785. Until then the sweep cannot build, and its rows say why.

One build at a time: the pass lock serializes them.

---

## 5. Config: where each key lives and how each reader loads it

### 5.1 The mechanism

Every key below is a **ccrc setting**: it is added to the one `CCRC_SETTINGS=(…)` list in `ccd/ccrc` and read by
the one reader, `_ccrc_knob <KEY> <default>` (D-6587): the process environment, else the box's
`~/.ccrc/ccrc.env`, else the default. This is the file and reader ccrc already uses for per-box settings, and the
one #1752 and #1785 use for the session slice and the tests slice. No new config file is added. A helper in
`ccd/ccrc`, `_graph_knobs`, reads and validates all graph settings in one place, in the shape `_test_knobs` uses
(#1785): one line per key with its default, value and source; a value of the wrong shape keeps its default and is
reported with the key, the value and where it came from, so a typo never removes a bound. `deploy/ccrc.env.example`
lists every key, commented out at its default, and README's "ccrc's own settings" paragraph names them.
`ccrc-settings-census.test.ts` derives the list from `CCRC_SETTINGS`, as it does today.

### 5.2 The readers

**Where the files live, and how each reader finds them.** The two new files, `ccd/graph-build` (Python) and
`ccd/graph-resolve` (sourced bash), ship in the ccrc tree beside `ccd/ccrc` and `ccd/ccrc-test`, and are used
**from the shipped tree only**: `$HOME/ccrc/ccd/`, the directory the launcher already execs into
(`CCRC_SHIPPED`, `_inst_shim`). Nothing new is installed into `~/.local/bin` or `~/.local/libexec`, so
`_inst_*`, `deploy.sh`'s agent lane, the uninstall removal list (which removes `~/ccrc` whole), the bin census
and the orphan scan need no change, and the tests that pin those lists stay as they are. Each reader sets
`GRAPH_LIB`, the directory it loads from, once:

- `ccrc install` / `update` / `uninstall` / `doctor` run inside the `ccrc` body, so `GRAPH_LIB=$CCRC_HERE`.
- `ccd-graph-sweep` is installed as a copy at `~/.local/bin/ccd-graph-sweep` (`ccrc:16694`, `deploy/deploy.sh:680`),
  where the `ccrc` beside it is the generated launcher, not the sourceable body. **The sweep never sources the
  launcher.** It uses its own directory when `graph-resolve` and `ccrc` sit beside it (a checkout or a test runs
  it from the tree), and otherwise `$HOME/ccrc/ccd`. It then sources `$GRAPH_LIB/ccrc` (whose dispatch runs only
  when it is executed, `ccrc:27302`) and `$GRAPH_LIB/graph-resolve`. A `GRAPH_LIB` without all four files is a
  refusal: pass `status: failed`, reason naming the missing file, nothing built.
- `ccd/session-hook.sh` loads neither (§2.1, below).

The sweep copy and the shipped tree come from the same install or update, which writes both.

| Reader | Runs in | Loads settings by | Keys |
|---|---|---|---|
| `ccd-graph-sweep` | its systemd user service, which has no `EnvironmentFile=` | at pass start it sources `$GRAPH_LIB/ccrc` (above), as `ccd/ccrc-test` sources the `ccrc` beside it (#1785), and calls `_graph_knobs`. With no process environment set by the unit, the values are the file's or the defaults. The `: "${CCRC_GRAPH_…:=…}"` lines at the top of today's sweep (`:17-21`, `:288`) are removed. Tests keep setting keys in the sweep's environment, which `_ccrc_knob` reads first, and their fixture HOME isolates `ccrc.env`. | all sweep keys |
| `ccrc install` / `ccrc update`, and `deploy.sh agent` | the operator's shell / the agent lane | `_graph_knobs`, then one renderer, `_inst_graph_timer <template> <dest>`, writes the timer from `deploy/systemd/ccd-graph-sweep.timer` with `OnUnitActiveSec=` set to `CCRC_GRAPH_REFRESH_SECS`; the agent lane calls the same function the way #1752's `_slice_limits_unit` does. Unset gives today's bytes (`15min`). The service's `TimeoutStartSec` is rendered the same way as `BUDGET × (SLOT_WAIT_SECS + BUILD_TIMEOUT) + 600`. | `REFRESH_SECS`, `BUDGET`, `SLOT_WAIT_SECS`, `BUILD_TIMEOUT` |
| `ccrc doctor` (`_check_graphify`) | the operator's shell; `cmd_doctor` already sources ccrc | `_graph_knobs` in `file` mode (`_ccrc_knob … file`), which ignores the shell's environment and so reports what the sweep's unit sees | all |
| `ccrc uninstall` | the operator's shell | `_graph_knobs` before it touches anything | `STORE` |
| `ccd/session-hook.sh` | every session | **never reads `ccrc.env`** (ccd keeps that file out of sessions, `ccd:1290`, `:1839`). It reads `<store>/settings.json`, which the sweep writes at the end of each pass with the resolved values of the three read-side keys. It finds the store through `graphify-out/meta.json`'s `store` field. Absent or unparseable: the same defaults, which a test holds equal to `_graph_knobs`' defaults. | `GATE_MAX_DIFF_PCT`, `GATE_MAX_DENIALS`, `CARD_DIFF_LIST_MAX` |

A change to `REFRESH_SECS` or a value in `TimeoutStartSec` takes effect at the next `ccrc update`; the doctor WARNs
until then (§8). Every other key takes effect at the next pass.

### 5.3 `settings.json`

`{"schema": 1, "gate_max_diff_pct": 25, "gate_max_denials": 3, "card_diff_list_max": 20}`, written through a
temporary file and a rename. It is a snapshot the one reader wrote, not a second source: no one edits it, and the
sweep rewrites it every pass.

### 5.4 Keys

| Key | Default | Meaning |
|---|---|---|
| `CCRC_GRAPH_STORE` | `$HOME/.ccrc/graphs` | Store root (§2.1; constraints §2.2). |
| `CCRC_GRAPH_SOURCE_REF` | `origin/HEAD` | The main line, with the fallbacks of §3.1. |
| `CCRC_GRAPH_REPOS_EXCLUDE` | empty | Space-separated repo keys that get no graph. |
| `CCRC_GRAPH_REFRESH_SECS` | 900 | Timer period and refresh interval; **rendered** into the timer. |
| `CCRC_GRAPH_FETCH_SECS` | 900 | Fetch throttle per repository; 0 never fetches and relies on refs others fetch. |
| `CCRC_GRAPH_FULL_REBUILD_SECS` | 86400 | Safety-net full rebuild interval (§3.3). |
| `CCRC_GRAPH_INCREMENTAL_MAX_FILES` | 200 | Above this many changed files, rebuild in full. |
| `CCRC_GRAPH_BUDGET` | 4 | **Changed meaning:** repository builds per pass (was: tree rebuilds, default 8). |
| `CCRC_GRAPH_BUILD_TIMEOUT` | 600 | Kept. Per build, inside the slot. |
| `CCRC_GRAPH_SLOT_WAIT_SECS` | 600 | Longest wait for a heavy test slot before `skipped-slots`. |
| `CCRC_GRAPH_BUILD_NICE` | 15 | `nice` of the build inside the tests slice. |
| `CCRC_GRAPH_MAX_WORKERS` | 4 | Kept. `GRAPHIFY_MAX_WORKERS`. |
| `CCRC_GRAPH_MAX_SHRINK_PCT` | 20 | Publish check (§3.5). |
| `CCRC_GRAPH_KEEP_BUILDS` | 2 | Published builds kept per repository. |
| `CCRC_GRAPH_BUILD_GRACE_SECS` | 3600 | A superseded build, and a trashed per-tree directory, is deleted after this. |
| `CCRC_GRAPH_MIGRATE_BUDGET` | 8 | Per-tree directories cleaned per pass (§9). |
| `CCRC_GRAPH_HOOKSTATE_FRESH_SECS` | 1800 | Kept; now used only by migration's idle check. |
| `CCRC_GRAPH_GATE_MAX_DIFF_PCT` | 25 | The gate arms when the files differing between the graph's commit and `HEAD` are at most this share of the graph's `files`. Replaces the hook's hard-coded `GRAPH_GATE_MAX_BEHIND=10` (`session-hook.sh:2376`). |
| `CCRC_GRAPH_GATE_MAX_DENIALS` | 3 | Replaces the hard-coded `GRAPH_GATE_MAX_DENIALS=3` (`session-hook.sh:2377`). |
| `CCRC_GRAPH_CARD_DIFF_LIST_MAX` | 20 | Changed files the card names before it gives the rest as a count. |

Retired: `CCRC_GRAPH_STALE_ESCAPE_COMMITS`, `CCRC_GRAPH_STALE_ESCAPE_SECS` (builds never touch a session's tree, so
there is no idle gate on builds and no escape hatch from one).

---

## 6. Read side

All read-side changes are in `ccd/session-hook.sh`, the skill's appended clause and the compaction helper's inputs;
none changes the `FleetSession` protocol, and the server reads nothing new.

### 6.1 Routing: the link

`<tree>/graphify-out` is a symlink to `<store>/<repo-key>/current`, in every tree of the repository, the main
checkout included. Every existing reader keeps its path: the skill's fast path ("`graphify-out/graph.json` exists
→ query"), `graphify query`'s default `graphify-out/graph.json`, the card, the gate and the compaction card's
`--graph graphify-out/graph.json --labels graphify-out/.graphify_labels.json`.

- **Who creates it.** Only the sweep, and only once the repository's `current` resolves to a published build: an
  absent `graphify-out` gets the link at once; a real directory is migrated first (§9). A tree of a repository
  with no published build gets no link, so a link never points at nothing when it is made.
- **Ignored.** The exclude writer (`ccd ws-add`, `ccrc install`/`update`) appends both `graphify-out/` and
  `graphify-out` (no slash) to each common dir's `info/exclude`. Measured in revision 1: the slash-only line does
  not ignore a symlink (`git status` shows `?? graphify-out`); with the no-slash line `git check-ignore` passes and
  `git worktree remove` succeeds without `--force`, leaving the link's target intact. The sweep's precondition
  becomes `git check-ignore -q graphify-out` (no slash).
- **Writes through it fail closed.** Published builds are read-only, so a session that runs `graphify update .`
  anyway gets `EACCES` and changes nothing shared. `graphify save-result` writes to `graphify-out/memory/`, which
  links to the repository's writable `memory/`.

### 6.2 What a session sees, and how stale it is

The graph describes the source ref's commit at the last refresh. Two separate distances matter, and the card gives
both:

- **Main moved since the refresh** (`GM_MAIN_MOVED`): `git rev-list --count <graph commit>..<meta.ref>`. It is
  bounded by one `REFRESH_SECS` plus one fetch throttle plus one build when refreshes succeed; when they fail, the
  census and the doctor say so (§7, §8).
- **This tree versus the graph** (`GM_DIFF`): `git diff --no-renames --name-only <graph commit> HEAD`, split into
  **`GM_BRANCH`**, the branch's own changes (`git diff --name-only $(git merge-base <graph commit> HEAD) HEAD`), and
  the rest, which are main-line files the tree has not merged or the graph predates. The graph commit is always in
  the tree's object store, because the source ref belongs to the repository every worktree shares.

A session reads its own branch's changes from `git diff`, and reads the files directly. Measured (§1.1): at least
about 58% of queries concern only existing code, which the main graph answers; at most about 12% concern the
branch's own changes, which the card points at.

### 6.3 The hook

- **`_hook_graph_measure`** reads `graphify-out/meta.json` (through the link) for `commit`, `engine`, `nodes`,
  `files`, `ref` and `built_at`, instead of `tail -c 4096 graph.json` and `head -c` of the report. It computes
  `GM_DIFF`, `GM_BRANCH`, `GM_MAIN_MOVED` and `GM_DIFF_LIST` (the first `CARD_DIFF_LIST_MAX` paths, branch files
  first, so main-line drift never crowds them out). A tree whose `graphify-out` is still a real directory is
  measured the old way until its migration (§9).
- **The card (R1)** says what it is: *"graph of this repository's main at `<sha8>`, refreshed `<age>` ago; main has
  moved `<GM_MAIN_MOVED>` commits since. Your tree differs from it in `<GM_DIFF>` files, `<GM_BRANCH>` of them your
  branch's own: … — read those directly."* It keeps the instruction not to run `graphify update`.
- **No graph.** When the tree has no link, or the link dangles, the card prints the repository's census row's
  `outcome: reason` (§7), clipped as today (D-1335).
- **The gate (R5)** arms when `GM_DIFF × 100 ≤ GATE_MAX_DIFF_PCT × meta.files` and `meta.engine` equals the pin,
  with `GATE_MAX_DENIALS` from `settings.json`. Measured: this repository's worktrees differ from the current tip in
  p50 323 and p90 1,738 of about 4,000 files, so the default 25% (about 1,000 files here) arms for most trees and
  stays off for a tree far behind main, where the graph describes code the tree does not have.
- **R4** (`graphQueries` in hookstate) is unchanged.

### 6.4 The skill

The installed body stays the package's own. `install-graphify-skill.sh` appends one ccrc clause: `graphify-out` is
a ccrc-managed link to the repository's graph of main; never delete, replace or build into it; when it is absent
the graph is not ready yet, so do not build one, use search and read the card; for the branch's own changes, use
`git diff` and read the files. The convergence `diff` and `.graphify_version` stamping are unchanged.

---

## 7. Census: one row per repository

The census file (`~/.ccrc/graph-sweep.json`), its 10-pass ring and the pass fields (`started`, `finished`, `pin`,
`status`) are unchanged, as are the pass statuses (`ok`, `failed`, `probed-zero`, `pass-locked`, …). The per-tree
`trees[]` array is **replaced** by `repos[]`, one row per repository the pass enumerated:

```json
{ "repo_key": "…", "source": "<realpath of common dir>", "ref": "refs/remotes/origin/main",
  "tip": "<sha>", "served": "<sha of current, or empty>", "outcome": "…", "kind": "full|incremental|",
  "changed_files": 16, "reason": "…", "duration_ms": 36000, "peak_rss_kb": 1310720,
  "nodes": 48172, "edges": 114127,
  "trees": 63, "linked": 61, "migrate": { "done": 8, "pending": 53, "refused": [ { "path": "…", "reason": "…" } ] } }
```

Outcomes: `fresh` (served equals tip, nothing built), `refreshed` (incremental build published), `rebuilt` (full
build published), `skipped-budget`, `skipped-slots`, `refused-by-guard`, `refused-shrink`, `timed-out`, `failed`,
`no-source` (the source ref did not resolve), `excluded`. A fetch failure is a `reason`, not an outcome. The
words `stale-rebuilt`, `never-built`, `restamped`, `skipped-busy` and `refused-no-exclude` leave the vocabulary;
the last becomes a `migrate.refused` reason.

**Every consumer of the census file on `main`, and its change:**

| Consumer | Today | Change |
|---|---|---|
| `ccd/ccd-graph-sweep` (writer, `CENSUS=` `:14`) | writes `trees[]` | writes `repos[]` |
| `ccd/session-hook.sh:325-329` | prints the `trees[]` row whose `path` is the cwd and whose `reason` is non-empty | selects the `repos[]` row whose `source` equals the realpath of `git rev-parse --git-common-dir` in the cwd; prints `outcome: reason`; the D-1335 clip is unchanged |
| `ccd/ccrc-doctor-checks:4813-4834` (status arms) | `.passes[-1].status`, `.finished`, `.pin` | none |
| `ccd/ccrc-doctor-checks:4843-4860` (age bound) | 3 × the shipped timer's `OnUnitActiveSec` via `_dr_cycles_s ccd-graph-sweep.timer 3` (D-7054) | 3 × `CCRC_GRAPH_REFRESH_SECS` from `_graph_knobs`, since the timer is now rendered from it |
| `ccd/ccrc-doctor-checks:4886-4888` (row counts, D-1454) | `trees[]` with `refused-by-guard` / `failed` | `repos[]` with those outcomes plus `timed-out` and `skipped-slots`; the WARN-never-FAIL ruling and its text stand |
| `ccd/ccrc-doctor-checks:4998` (remedy text) | ".passes[-1].trees[]; a refused tree keeps its last graph" | ".passes[-1].repos[]; a refused build keeps the repository's previous graph served" |
| `README.md` ≈:5486 (card paragraph) and ≈:5883 (§"The sweep") | the tree row and the 15-minute timer | `repos[]`, the refresh setting, the store |
| `shared/lifecycle.ts:30` (`graph-sweep-census`) | root, pattern R | unchanged; the other graph rows change (§10) |
| `server/test/graph-sweep.test.ts:139` | reads `trees[]` | reads `repos[]` |
| `server/test/ccrc-doctor-graphify.test.ts` (:251-471) and `server/test/ccrc-doctorFixture.ts:1387` | fixture censuses with `trees[]` | `repos[]` fixtures |
| `server/test/session-hook.test.ts:920`, `:1222` | a `trees[]` row by path | a `repos[]` row by `source` |
| `server/test/lifecycle.test.ts:1027` | names `graph-build-lock`, `graph-corpus-filter` | the class names of §10 |
| `server/test/single-definition/vocabularies.test.ts:1040` | the census path is spelled by writers and readers only | unchanged (the same files still hold it) |

No server, `shared/` or PWA code reads the census (searched `server/src`, `shared/`, `pwa/src`).

---

## 8. Doctor

`_check_graphify` keeps its multi-condition shape and its engine, PATH-shadowing and skill-stamp arms. It changes
or adds:

| Condition | Verdict |
|---|---|
| A graph setting `_graph_knobs` could not read or rejected (wrong shape, unreadable `ccrc.env`, a store root that breaks §2.2) | WARN naming the key, the value, its source and the default used; FAIL for a rejected store root |
| The installed timer's `OnUnitActiveSec` or the service's `TimeoutStartSec` differs from what the current settings render | WARN: "run `ccrc update` to apply" |
| Store root missing, unwritable, or without `.ccrc-graph-store` | FAIL |
| `df` on the store's device below the disk floor | WARN/FAIL (the graph arm moves from `WORKTREES_ROOT` to the store's device; D-995's worktree arm stays) |
| A non-excluded repository with trees has no published build at the current pin | WARN naming it |
| A repository's `current` commit is more than 3 × `REFRESH_SECS` old while its source ref has moved past it | WARN: refresh stuck, with the last row's outcome and reason |
| A repository's `last_full_at` is older than 2 × `FULL_REBUILD_SECS` | WARN: the safety net is not running |
| Trees whose `graphify-out` is still a real directory | WARN with the count (migration pending) and each `migrate.refused` path and reason |
| Dangling `graphify-out` links | FAIL naming them |
| `git check-ignore -q graphify-out` fails for a common dir | FAIL naming the repository (no slash now) |
| `ccrc-tests.slice` is not loaded on a Linux host | WARN: graph builds are refused until it is installed |
| The last full build's `peak_rss_kb` is above 75% of the tests slice's `MemoryMax` | WARN with both numbers (decision G5) |
| The last N passes' rows for one repository are all `skipped-slots` | WARN: the heavy queue never had room |
| Census rows `refused-by-guard`, `failed`, `timed-out` (the re-pointed :4886 arm) | WARN, never FAIL (ruling unchanged) |
| `graph-build --probe` against the pinned engine (the checks of §3.4 without a build) | FAIL |
| Census: `probed-zero`; census age over 3 × `REFRESH_SECS` | FAIL / WARN, as today |

---

## 9. Migration and cleanup

### 9.1 Per-tree `graphify-out` directories

The sweep cleans them, at most `CCRC_GRAPH_MIGRATE_BUDGET` trees a pass, only in repositories whose `current`
build is published. For each enumerated tree whose `graphify-out` is a real directory, in this order:

1. **Ignored:** `git -C <tree> check-ignore -q graphify-out` passes; otherwise `migrate.refused`, reason
   `not ignored` (the exclude writer runs first in the same pass, so this means someone removed the line).
2. **Idle:** the tree's session is idle by today's `_gs_busy`; otherwise it waits for a later pass (counted in
   `pending`).
3. **Looks like graphify's:** the directory is not a mount point, is on the tree's filesystem, and every top-level
   entry is one graphify writes (`graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `.graphify_labels.json`,
   `.graphify_engine`, `.graphify_root`, `.graph.tmp.json`, `.rebuild.lock`, `.pending_changes`, `needs_update`,
   `graph.html`, `cache/`, `memory/`). Anything else and nothing is touched: `migrate.refused`, reason naming the
   first unexpected entry.
4. **Keep saved results:** `memory/`, if present, is moved to `<store>/<repo-key>/memory/migrated-<tree-key>/`.
5. **Remove:** `mv <tree>/graphify-out <store>/.trash/<tree-key>.<ts>` when the store is on the same filesystem,
   otherwise `rm -rf --one-file-system -- <tree>/graphify-out` under `ionice -c3`. Nothing outside that one path is
   named by either command.
6. **Link:** `ln -s <store>/<repo-key>/current <tree>/graphify-out`.

A stray `.graphifyignore` the old sweep generated is removed as today. The sweep never writes anything else in a
tree. Because both the directory and the link are git-ignored, `git worktree remove`, `ccd ws-rm`, reap and
`ws-gc` behave exactly as before: the link goes with the tree, and its target is shared and untouched.

The reference fleet's 9.4 GB of per-tree graphs drains in about `131 / MIGRATE_BUDGET` passes. The store then
holds about 14 checkouts and up to 28 published graphs.

**Excluded repositories.** Steps 1 to 5 apply, with no link at step 6, so their sessions stop reading a graph
nothing refreshes. An existing link in a repository excluded later is unlinked.

### 9.2 Steady-state collection (every pass, at the end, `ionice -c3`)

| Class | Collected when |
|---|---|
| Superseded `builds/<id>` | beyond `KEEP_BUILDS` and older than `BUILD_GRACE_SECS` |
| `staging/` | when its build ends (trap), or at the next pass if a crash left it |
| `.trash/*` | older than `BUILD_GRACE_SECS` |
| `<repo-key>/` entirely (checkout, builds, memory) | its `source` common dir is gone, or the repository is excluded, for `BUILD_GRACE_SECS` |

`ccrc uninstall` resolves the store root through `_graph_knobs`, removes it only if it carries the marker, and
removes the in-tree links it can find; links it cannot find dangle harmlessly (ignored).

---

## 10. Artifact lifecycle declarations (replacing 08-27 §7's graph rows in `shared/lifecycle.ts`)

| Class | Root | Pattern | Creator | Collector | Bound |
|---|---|---|---|---|---|
| `graph-repo-build` | `<store>/<repo-key>/builds/` | E | sweep | sweep (§9.2) | `KEEP_BUILDS` per repository |
| `graph-repo-checkout` | `<store>/<repo-key>/<repo-name>/` | O | sweep | sweep, when the repository is gone or excluded | one per repository |
| `graph-repo-memory` | `<store>/<repo-key>/memory/` | O | graphify `save-result` | sweep, with its repository | repository lifetime |
| `graph-staging` | `<store>/<repo-key>/staging/` | E | sweep | build trap + sweep | one build |
| `graph-tree-link` | `<tree>/graphify-out` | W | sweep | the worktree's own collectors (ignored) | tree lifetime |
| `graph-sweep-census` | `~/.ccrc/graph-sweep.json` | R | sweep | sweep, last 10 passes | unchanged |

`workspace-graph-store`, `project-graph-store`, `graph-corpus-filter` (`<tree>/.graphifyignore`) and
`graph-build-lock` (`<tree>/graphify-out/.rebuild.lock`) are removed: none of those paths is written any more.
No class is permanent, so no `ruling` string is needed.

---

## 11. Failure modes and test plan

| Failure | Behaviour |
|---|---|
| A build fails, times out, is refused or never gets a slot | `current` keeps the previous graph; the row says why; the next pass retries in full |
| Main rewritten (force-push) | `--is-ancestor` fails, so a full rebuild |
| Engine pin bump | Full rebuild per repository, `BUDGET` per pass, repositories with no build first; the old-pin graph is served meanwhile and the card names its engine |
| A session runs `graphify update .` | `EACCES` on the read-only build; nothing shared changes |
| Link dangles (store removed) | Doctor FAIL; the card prints the census reason; the next pass recreates the store |
| Tests slice missing | Builds `failed` with the reason; doctor WARN; previous graph served |
| A second pass while one runs | `pass-locked`, at once |
| Pass killed mid-publish | `mv` and `mv -T` are atomic; the old `current` stands; staging collected next pass |
| A bad setting | That key keeps its default in every reader; the doctor names it |
| A rebuild at an unchanged commit | A new `build_id` (§2.1); it is published beside the old build, which `KEEP_BUILDS` later collects |

Existing rows 1, 4, 5a, 6, 7, 8, 10, 12, 13, 15, 16, 17, 18 of 08-27 §9 carry over with their targets moved to the
store. New rows, each red before and green after, in fixture HOMEs only:

| # | Guard | Goes red when |
|---|---|---|
| N1 | Link ignored | the no-slash exclude line is dropped, or `git worktree remove` refuses a tree holding the link |
| N2 | Read-only builds | a published build is writable, or `graphify update .` through the link succeeds |
| N3 | Engine contract | the pinned `_rebuild_code` is replaced by one that ignores `changed_paths`, `force` or `acquire_lock`, and `graph-build --probe` stays green |
| N4 | Incremental is incremental | a one-file main commit re-extracts more than that file (counted through the engine's extraction call), or a deleted file's nodes survive |
| N5 | Full-rebuild triggers | any row of §3.3's table does not lead to a full rebuild |
| N6 | Root convention | a published `source_file` carries the checkout's path or any prefix, or the wrapper runs with a cwd other than `--root` |
| N7 | `GRAPHIFY_OUT` honoured | the wrapper sets `GRAPHIFY_OUT` after importing graphify and still exits 0 |
| N8 | No silent queue | a `.pending_changes` or `.rebuild.lock` appears in staging or in a published build, or the wrapper calls with `acquire_lock=True` |
| N9 | Stamp | an untouched-outputs refresh is published still carrying the previous commit, or a build whose `built_at_commit` differs from `tip` is published |
| N10 | Shrink check | a graph with 50% fewer nodes is published |
| N11 | Atomic publish | a killed publish leaves `current` missing |
| N12 | Slice and slot | a build runs outside `ccrc test --heavy`; a slot wait past `SLOT_WAIT_SECS` is reported as anything but `skipped-slots`; a build past its timeout is reported as anything but `timed-out` |
| N13 | Settings | a key set in the fixture `ccrc.env` is not what the sweep uses; a bad value removes a bound instead of keeping its default; the hook's defaults differ from `_graph_knobs`' |
| N14 | Rendered timer | changing `REFRESH_SECS` and running `ccrc update` leaves the old `OnUnitActiveSec`, or the doctor does not WARN before the update |
| N15 | Migration safety | a busy tree is cleaned; a `graphify-out` holding an unexpected entry is touched; anything outside `<tree>/graphify-out` is removed |
| N16 | Link after build | a tree gets a link before its repository's `current` resolves |
| N17 | Census readers | a `refused-by-guard` repo row is not counted by the doctor, or a tree with no graph loses its repository row's reason in the card |
| N18 | Card | a tree's branch files are missing from the card, or main-line files are listed before them |
| N19 | Gate | `GATE_MAX_DIFF_PCT` from `settings.json` is ignored, or the gate arms for a tree differing in more than that share |
| N20 | Store marker | `ccrc uninstall` removes a configured store root without `.ccrc-graph-store` |
| N21 | Second build | a second build of an unchanged commit (a safety-net full rebuild, a noise change) is not published, or its predecessor's files are read-only in `staging/` when the engine runs |
| N22 | Same-commit id | two builds at one commit get one `build_id`, or `mv` nests a build inside an existing one |
| N23 | Saved results | a published build's `memory` link does not resolve to `<repo-key>/memory/`, `save-result` through a tree's `graphify-out/memory/` fails, or a saved result makes the guard refuse |
| N24 | Output name | a repository tracking a directory named `staging` (or any name other than `graphify-out`) loses that directory's files from the graph, or the wrapper accepts an `--out` with another basename |
| N25 | Loading | the installed sweep sources or runs the `ccrc` launcher, or runs with a `GRAPH_LIB` missing `ccrc`, `ccrc-test`, `graph-build` or `graph-resolve` without refusing |

**Plan Task 0** (measure before building on it): on the box, replay one week of this repository's main commits as
incremental refreshes against a full build at each day's last commit, and record the edge and node gaps. If the
gap after a day is above what decision G4 accepts, `FULL_REBUILD_SECS` shortens before the first wave lands.

---

## 12. Later options (out of scope, recorded with their measured case)

| Option | Case for | Case against |
|---|---|---|
| **Per-branch overlays** (the main graph patched with a tree's own changes, built when its session keeps querying) | At most about 12% of queries are directly about the branch's changes; branches are small (median 15.5 files), so a patch costs about 36 s; 68 of 197 sessions asked more than once. | At least about 58% of queries need none; the card's diff list already names the branch's files; it needs request files, per-tree views, a trigger and a second collector, and patching from a graph of main (not of the branch's merge-base) widens the patch by every main-line file the tree lacks (p50 323). |
| **Merge-base bases** (a graph at each live merge-base cluster) | Worktrees sit a median 35 commits behind main and differ from its tip in p50 323 files; a graph at the merge-base answers "existing code" for exactly the code the tree has. | The replay needed 30 bases for 94 worktrees of this repository (about 1.65 GB), with clustering, retention and an assignment table; it trades the operator's "one graph per repository" for exactness the gate's share threshold and the card already cover. |
| **Demand votes** (build only what queries ask for) | Nothing built that no one reads. | One graph per repository refreshed incrementally is already cheap (§13); votes add hook-side state and writes on every query. |
| **Path-unit or request triggers** | Lower latency than a timer. | `PathChanged=` is non-recursive and would fire per query (150 to 300 a day); main moves about twice an hour here, so a `REFRESH_SECS` poll loses little. |

Each can be added later on the same store: an overlay or a merge-base graph is another directory beside `current`,
built by the same wrapper.

---

## 13. Cost: today versus this design

| | Today (per tree, every 15 min) | This design |
|---|---|---|
| Builds | about 2 to 5 full rebuilds of ~75 s per pass for this repository alone | one incremental refresh per repository when main moved, plus one full rebuild per repository a day |
| CPU | 4 to 17 CPU-min per pass, about **6 to 27 CPU-hours a day** | estimate, this repository: main moved 348 commits in 7 days (about 50 a day), which at a 15-minute refresh coalesces into at most about 40 refreshes a day; at about 1.5 CPU-min each (scaled from §1.4's 36 s) ≈ 60 CPU-min, plus one full build ≈ 3 CPU-min. Fleet-wide, with this repository about half the load: **about 2 CPU-hours a day or less** |
| Peak memory | 4.6 to 6.0 GB in the sweep's own unit | about 1.25 GB per refresh, about 4.2 GB per daily full build, inside the tests slice's cap |
| Disk | **9,445 MB** (131 graphs) | per repository one checkout (about 176 MB here) plus up to two graphs (about 75 MB each here): estimate **1 to 2 GB** fleet-wide |
| Writes inside trees | every rebuild rewrites ~75 MB in the tree | one symlink, once |
| Session impact | skipped while busy; escape hatch after 20 commits / 6 h | never touches a session's tree; builds run behind sessions in the tests slice |

The CPU and disk figures are estimates from §1's measurements; Task 0 and the first week of census rows (which
carry `duration_ms` and `peak_rss_kb`) replace them with measurements.

---

## 14. Rejected alternatives

| Alternative | Why not |
|---|---|
| Keep per-tree stores and share the per-file cache | The cache is bypassed for JS/TS (`extract.py:92`); even a perfect cache saves at most about 34% of a build; still one 53 MB graph per tree. |
| Keep per-tree stores and make each incremental | Still one graph per tree (131 graphs, 9.4 GB), and each tree's refresh repeats the same main-line diff. |
| A registered `git worktree` of main as the build checkout | Appears in `ccd`'s worktree enumeration and reap/audit (§2.2). |
| `git archive` into scratch for every build | The incremental path needs the whole tree on disk for `detect()`, so every refresh would export 176 MB; a persistent checkout moves by `checkout`. |
| `graphify update` from the CLI | Never passes `changed_paths`, so every run is a full re-extraction (§1.2). |
| Route sessions with `GRAPHIFY_OUT` in their environment instead of a link | `graphify query` honours it, but the skill's fast path, the card, the gate and the compaction card read `graphify-out/` literally, and a session's own `graphify update .` would then aim at the store. |
| A dedicated graph slice with its own admission check (revision 3) | A second admission mechanism beside #1785's queue for the same box resource; the operator directed the tests slice. |
| A separate `graph.env` config file (revision 2) | A second config file and parser beside ccrc's settings reader. |

---

## 15. Operator decisions

| # | Decision | Options | Recommended |
|---|---|---|---|
| **G1** | Replace the per-tree store ruling of 2026-08-27 | (a) one graph per repository at main, incremental (this design); (b) keep per-tree graphs | **(a)**: most questions are about existing code (≥58%), and (b) costs 6 to 27 CPU-hours a day and 9.4 GB |
| **G2** | The build checkout | (a) a shared clone under the store; (b) a registered `git worktree`; (c) `git archive` per build | **(a)** (§2.2, §14) |
| **G3** | Refresh interval `REFRESH_SECS` | 300 / **900** / 1800 | **900**: today's cadence; main moves about twice an hour here, so staleness averages minutes, and a refresh is cheap enough to shorten later |
| **G4** | Safety net | `FULL_REBUILD_SECS` 86400 and `INCREMENTAL_MAX_FILES` 200; or weekly; or every refresh in full | **daily and 200**, revisited after Task 0 measures the incremental gap (§11) |
| **G5** | Where builds run, and the slice's memory | (a) the tests slice through `ccrc test --heavy`, sharing its queue; (b) a dedicated graph slice | **(a)**, as directed; size `CCRC_TEST_SLICE_MEMORY_MAX` so one full build (about 4.2 GB here) fits beside a heavy test run, from the doctor's `peak_rss_kb` WARN |
| **G6** | Gate arming | (a) by share of files differing, `GATE_MAX_DIFF_PCT` 25; (b) keep "10 commits behind" | **(a)**: against a graph of main, "commits behind" no longer describes a worktree; the share works for any repository size |
| **G7** | Fetching main | (a) the sweep fetches, throttled by `FETCH_SECS` 900; (b) rely on refs sessions fetch | **(a)**: a graph of main is only as current as the local ref; the fetch writes only the remote-tracking ref |
| **G8** | Migration | (a) automatic, idle-gated, budgeted, deleting only graphify-shaped directories; (b) operator-run one-shot | **(a)** |
| **G9** | Saved results (`memory/`) | (a) one per repository, per-tree ones moved under it; (b) dropped | **(a)**: cheap, and keeps what sessions saved |

---

## 16. Out of scope

- Semantic (LLM) extraction: still declined (08-27 Appendix A).
- Cross-repository graphs: 1.7% of queries reach another repository.
- Any change to graphify upstream. An incremental CLI flag (`graphify update --changed …`) would let
  `graph-build` disappear; worth proposing upstream, not waiting for.
- The options of §12.
