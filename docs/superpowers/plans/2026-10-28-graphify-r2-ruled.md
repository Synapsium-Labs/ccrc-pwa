# Graphify revision 2: the operator decisions, ruled

- **D-7292 (2026-10-28)** — the operator ruled every decision in `docs/superpowers/specs/2026-10-28-graphify-shared-graphs-design.md` §15, G1 to G9, each as recommended: one incrementally refreshed graph per repository at main replaces the per-tree graphs (G1); a shared clone under the store (G2); refresh every 900 s (G3); daily full rebuild and 200-file incremental cap (G4); builds in the tests slice (G5); gate by share of files differing (G6); the sweep fetches main (G7); automatic idle-gated migration of the per-tree stores (G8); one saved-results folder per repository (G9).

The spec's last review round left four build-level findings. The build closes them with tests:
1. A refused full build counts toward full-build backoff, and the doctor names how a genuine shrink is accepted.
2. The slot wait is bounded by the wrapper itself: it refuses to start once the time since launch exceeds the slot wait.
3. One exit-code, start-marker and stderr table maps every outcome.
4. Saved-result nodes have a stated, resolvable spelling, which the source-file row honours.
