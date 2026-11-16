# GR2 and wave 29's sweep census: the graph settings the graph sweep still reads by `:=`, ruled

- **D-7524 (2026-10-29)** — W29-S2 classes the four graph settings the graph sweep still reads by its `:=` lines as named transitional rows until GR4, correcting #1578's hand-off note

**D-7524.** The graphify r2 plan's Task GR2 adds the 22 `CCRC_GRAPH_*` keys of spec §5.4 to `CCRC_SETTINGS` and
leaves `ccd/ccd-graph-sweep` untouched; its GR4 replaces the sweep's own `: "${CCRC_GRAPH_…:=default}"` lines with
ccrc's reader. Four of those keys are read today by such a line: `CCRC_GRAPH_BUILD_TIMEOUT`, `CCRC_GRAPH_BUDGET`,
`CCRC_GRAPH_MAX_WORKERS` and `CCRC_GRAPH_HOOKSTATE_FRESH_SECS`. Between GR2 and GR4 each of them is both a setting
and an environment read in the sweep.

**What the hand-off note got wrong.** Wave 29's plan (#1578, under D-7500) says GR2 removes those four rows from
`SIBLING_ENV_ONLY` in `server/test/ccrc-settings-census.test.ts` "or W29-S2's `aSetting` reds". Removing them does not
make W29-S2 green. Its `envReads()` matches the sweep's `:=` lines whether or not a row names the key, so with the
keys in `CCRC_SETTINGS`, `aSetting` lists all four with the rows kept or removed. Kept, W29-S3 also reds, because
the example now documents each as a `# KEY=value` line, which an environment-only exception may not have. Measured
on the rebased GR2 tip before this change: W29-S2's `aSetting` and W29-S3 each list the four names.

**The ruling.** The census gets one named table, `GRAPH_TRANSITIONAL`, holding exactly those four names with a
reason each. It is never derived. W29-S2 leaves out of its read set only a name in that table, and only when the
read is in `ccd/ccd-graph-sweep`. Every other setting read from the environment by any sweep still reds `aSetting`,
including a fifth graph key the graph sweep read by `:=`. A new row, W29-S2t, holds each transitional name to four
rules: it is in `CCRC_SETTINGS`; it is no environment-only exception (`SIBLING_ENV_ONLY` or `ENV_ONLY`); the graph
sweep has exactly one `: "${NAME:=…}"` line for it; and no sibling reads it from the environment any other way. The
four names leave `SIBLING_ENV_ONLY`. `CCRC_GRAPH_STALE_ESCAPE_COMMITS` and `CCRC_GRAPH_STALE_ESCAPE_SECS` are not
settings and stay there.

**GR2's Step 0, with #1578 on `main`.** #1578 merged without its graph hunk (D-7500). `ccd/ccd-graph-sweep` and
`server/test/graph-sweep.test.ts` are as they were, and no W29-G row exists, so GR4 has no graph line of #1578's to
delete and no W29-G row to re-point. What #1578 left for this wave is the four rows above, now `GRAPH_TRANSITIONAL`,
and `ccd/lib/ccrc-settings.sh`, which `deploy/gen-settings-lib.mjs` regenerates from the `CCRC_SETTINGS` line. GR2
regenerates it, so the library's list holds the 22 graph keys, and GR4 sources that library for `_ccrc_knob`. The
graph keys sit before the four sweep settings in `CCRC_SETTINGS`, so the line's comment ("the last four names")
still holds.

**How it ends.** GR4 deletes each `:=` line and takes the key through ccrc's reader. W29-S2t then reds on that
name (no `:=` line), and GR4 deletes its row in the same commit. GR4 is done with this when `GRAPH_TRANSITIONAL` is
empty and has been deleted together with its exemption in W29-S2 and W29-S2t itself.

**Mutations (each a scratch edit, then reverted).**

| Mutation | Row that reds |
|---|---|
| The graph sweep reads `CCRC_GRAPH_FETCH_SECS` by a new `:=` line | W29-S2 (`aSetting`) |
| The graph sweep's `CCRC_GRAPH_BUDGET` `:=` line is deleted | W29-S2t |
| `CCRC_GRAPH_BUDGET` leaves `CCRC_SETTINGS` | W29-S2t, C4 |
| `ccd-usage-sweep` reads `${CCRC_GRAPH_BUDGET:-8}` | W29-S2, W29-S2t |
| The graph sweep gets a second `CCRC_GRAPH_BUDGET` `:=` line | W29-S2t |
