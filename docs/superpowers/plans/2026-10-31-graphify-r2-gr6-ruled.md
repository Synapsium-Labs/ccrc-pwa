# Graphify revision 2, Task GR6: the migration's builder choices, recorded

**Plan:** `docs/superpowers/plans/2026-10-29-graphify-r2-shared-graphs.md`, Task GR6 (D-7352). **Spec:**
`docs/superpowers/specs/2026-10-28-graphify-shared-graphs-design.md` §7, §9. Number issued by the ledger on
2026-10-31. The plan's own §Deviations found is not edited here (the ledger guard, D-6926); the coordinator folds this
one into it.

- **D-7666 (2026-10-31)** — graph revision 2 GR6 builder choices: the tree key, the excluded arm needs no published build, the collect-since marker, pending excludes refused

Spec §9 leaves five things to the builder. Each is decided once, in `ccd/ccd-graph-sweep`, and pinned by
`server/test/graph-migrate.test.ts`.

**1. The tree key.** §9.1 names `migrated-<tree-key>/` and `.trash/<tree-key>.<ts>` without defining `<tree-key>`. It is
`_gr_repo_key`'s shape asked of the tree: the basename of the tree's realpath (characters outside `A-Za-z0-9._-` made
`_`), `-`, then the first 8 hex of the sha256 of that realpath (`_gs_tree_key`). `<ts>` is epoch seconds. When
`migrated-<tree-key>/` already exists (a tree migrated twice), the second takes `migrated-<tree-key>.<ts>/`, so saved
results are never merged or overwritten.

**2. The excluded arm needs no published build.** §9.1 gates the migration on "repositories whose `current` build is
published" and then says of excluded repositories "steps 1 to 5 apply, with no link". The gate exists so that a tree
is never left with neither its old graph nor the shared link. An excluded repository gets no link at all, and its
`<repo-key>/` is collected after the grace (§9.2), so applying the gate there would leave its trees reading a graph
nothing refreshes, for ever, which is what the excluded arm is for. So the excluded arm migrates without the gate. It
runs the exclude writer first, as the published arm does (step 1's premise), and creates `<repo-key>/` with its
`source` file when the repository has none, so the saved results it keeps are under a directory §9.2 can account for.
The unlink of an earlier link touches only a link whose target lies under the store.

**3. The clock of "gone or excluded, for `BUILD_GRACE_SECS`".** §9.2 collects a whole `<repo-key>/` once its `source`
common dir has been gone, or its repository excluded, for the grace, but names no clock. The sweep writes
`<repo-key>/collect-since` (epoch seconds) the first pass it sees the condition, removes it the first pass it does not,
and collects the directory once the clock is older than the grace. `<repo-key>/checkout/` is where the checkout lives
(D-7664), so the name cannot clash with a repository's. A store directory with no `source` file is not one the sweep
made and is never collected. `.trash/*` is aged by the `<ts>` its name ends with, since `mv` keeps a directory's old
mtime; an entry whose name carries none falls back to its mtime. A `.trash` entry is removed as step 5 removes a
directory in place, never across a mount.

**4. `pending` and `refused`.** §7's row carries `migrate: {done, pending, refused: [{path, reason}]}`. A tree whose
`graphify-out` is still a real directory after the pass is counted exactly once: in `refused` when step 1 or 3 refused
it (reasons `not ignored`, `a mount point`, `on another filesystem than its tree`, `unexpected entry <name>`, or a
failed move), else in `pending` (busy, the budget spent, or a repository with no published build yet). `path` is the
tree as enumerated. Steps 1 to 3 only read, so a refusal spends no budget; the budget gates steps 4 and 5. A symlink
at the top level is an unexpected entry whatever its name, and `graph.json` and the other allowed files must be
regular files, `cache/` and `memory/` directories.

**5. Step 5 on each userland.** `rm -rf --one-file-system` is GNU's spelling; BSD `rm` (the Darwin arm) spells the same
flag `-x`. The sweep carries both, chosen by `CCD_OS`, so GR1's tree-write census counts five GR6 sites (the two
step-5 `rm` spellings, the two `mv`s, the excluded arm's unlink), not three: counted exit 2 → 7.
