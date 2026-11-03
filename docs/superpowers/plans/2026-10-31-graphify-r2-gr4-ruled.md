# Graphify revision 2, Task GR4: five departures of the repository sweep, recorded

**Plan:** `docs/superpowers/plans/2026-10-29-graphify-r2-shared-graphs.md`, Task GR4 (D-7350). **Spec:**
`docs/superpowers/specs/2026-10-28-graphify-shared-graphs-design.md`. Numbers issued by the ledger on 2026-10-31. The
plan's own §Deviations found is not edited here (the ledger guard, D-6926); the coordinator folds these five into it.

- **D-7648 (2026-10-31)** — graph builds run through `ccrc test --local --heavy --`, never the test box
- **D-7649 (2026-10-31)** — GR4's writes under a tree are the link and the ownership-gated stray `.graphifyignore` removal (2 sites, not 1)
- **D-7650 (2026-10-31)** — the repository sweep sources ccd/ccrc's body, not ccd/lib/ccrc-settings.sh
- **D-7651 (2026-10-31)** — a committed `.graphifyignore` takes the operator's noise list appended; rule 2's refusal arm is retired
- D-7664 (2026-10-31; defined in `2026-10-31-graphify-r2-gr4-checkout-dir.md`) — GR4 graph sweep: per-repository checkout directory under the store

**D-7648.** Spec §3.4 spells the build's call `"$GRAPH_LIB/ccrc-test" --heavy -- …`. Since the test box landed (D-7410),
`ccrc test` sends a run to the test box when the registry's switch marker is present and `CCRC_TESTBOX_URL` is set,
falling back to the local path only on a failed row. A graph build is this box's own work: it reads the store's
checkout and writes the store's staging directory, neither of which exists on the test box, and its scope's
`memory.peak` and CPU are the done check's measurement of this box. So the sweep passes `--local`, which `ccrc test`
already offers ("forces the local path and reads nothing of the test box"). Nothing in `ccrc test` changes (D-7356).
`graph-repo-sweep.test.ts` pins the argv (`--local --heavy --`).

**D-7649.** The plan's counted exit for GR4 is "writes under a tree in the sweep: GR1's `treeWriteSites` → 1 (the
link)", and its next one "in-tree `.graphifyignore` write sites: 7 → 0 (the stray removal remains)". GR1's census
counts every write OR REMOVE under a tree, so the ownership-gated removal of a stray `.graphifyignore` that a per-tree
sweep left behind (spec §9.1, "removed as today"; the plan keeps `_gs_owns_ignore` for it) is one of its sites. Measured
on GR4's tip: `treeWriteSites` is `_gs_rm_stray rm "$tree/.graphifyignore"` and `_gs_link ln "$tree/graphify-out"`, so
12 → 2, and the `.graphifyignore` write-or-remove sites are 7 → 1, that removal. No write under a tree remains besides
those two. `graph-r2-consumers.test.ts` pins both lists literally, and GR6 adds only `_gs_migrate_one`'s named moves.

**D-7650.** GR4's dispatch says the sweep sources `ccd/lib/ccrc-settings.sh` for `_ccrc_knob` instead of the whole
`ccrc` body. That library is generated with `_ccrc_knob` and its closure only (`deploy/gen-settings-lib.mjs`,
`SETTINGS_LIB_FUNCTIONS`), and the sweep needs three more things from ccd/ccrc: `_graph_knobs` (GR2's one reader of the
22 graph settings), the platform shims the resolver and the publish use (`_plat_sha256`, `_plat_mtime`,
`_plat_epoch_ms`, `_plat_mv_notdir`, `_plat_ln_swap`), and `_graph_exclude_common`. Sourcing the library would leave
all three undefined. Spec §5.2 and D-7500 already put the graph sweep outside the settings library's wave ("its GR2/GR4
read both through ccrc's reader"), and the census's W29-S5 row counts two settings-library readers, not the graph
sweep. So the sweep sources `$GRAPH_LIB/ccrc` (whose dispatch runs only when it is executed) and then
`$GRAPH_LIB/graph-resolve`, as spec §5.2 says, the way `ccd/ccrc-test` and `ccd/testbox-knobs` source the `ccrc` beside
them. The installed copy never sources the generated launcher (N25).

**D-7651.** The per-tree guard's rule 2 refused a build when a repository committed its own `.graphifyignore` and the
operator had written a `graph-noise/<repo>.list` for it, because the per-tree sweep would have had to overwrite a file
the session's tree owned; with only the default list present, the default yielded. The repository sweep writes the
generated filter into the store's own checkout, which `checkout --force` restores before every build, and spec §2.2
appends the noise list "to a committed `.graphifyignore` if the commit carries one". So the yield stays (the DEFAULT is
not appended to a committed file) and the refusal goes: the operator's list is appended to the committed content, which
is what an operator's list for that repository asks for. Rule 1 (a `!` line in either list refuses) and rule 3 (a
default pattern that would hide tracked files is withheld and said) stand. `graph-repo-sweep.test.ts` pins the
generated file's lines for the committed case.

**D-7664.** Spec §2.1 puts the checkout of main at `<repo-key>/<repo-name>/`, beside the fixed
entries `source`, `builds/`, `current`, `memory/` and `staging/`. The repository's name is free text (`_gr_repo_key`
only maps characters outside its shape to `_`), so a repository whose main checkout is named after one of those
entries put its checkout on top of it. Measured on the GR4 head with a fixture box: `memory` had its saved results
deleted by the checkout's re-clone and `clean -ffdx` on every pass, and the corpus guard's memory exemption covered
the whole checkout; `staging` lost its checkout to `_gs_stage` before every build, so every pass was
`refused-by-guard`; `source` failed setup from the second pass on (`cannot write …/source`); `builds` failed setup
from the second pass on (the checkout could not be moved); `current` failed every publish (`cannot point current at
builds/…`). So the checkout lives one level down, at `<repo-key>/checkout/<repo-name>/`: `checkout/` is a fixed entry
of its own, and inside it the name collides with nothing. Its basename is still the repository's name, which spec §3.4
needs (the report's root label). The sweep's store layout is new in GR4, so no box holds a checkout at the old path.
`graph-repo-sweep.test.ts` pins one row per fixed name (and `checkout` itself): each builds, rebuilds on a new commit
and is then fresh, and a repository named `memory` keeps a saved result over two passes that rebuild it.
