# Graphify revision 2, Task GR4: the checkout-directory departure, numbered

**Plan:** `docs/superpowers/plans/2026-10-29-graphify-r2-shared-graphs.md`, Task GR4 (D-7350). The number was issued
by the ledger on 2026-10-31 for the departure that `2026-10-31-graphify-r2-gr4-ruled.md` recorded under a placeholder
while the allocator could not be reached. The reasoning and the measurements are in that note, under **D-7664**.

- **D-7664 (2026-10-31)** — GR4 graph sweep: per-repository checkout directory under the store

Spec §2.1 puts the checkout of main at `<repo-key>/<repo-name>/`, beside the store's fixed entries (`source`,
`builds/`, `current`, `memory/`, `staging/`). A repository named like one of those entries overwrote it, so the sweep
keeps the checkout at `<repo-key>/checkout/<repo-name>/`. `server/test/graph-repo-sweep.test.ts` pins the path and the
name-collision cases.
