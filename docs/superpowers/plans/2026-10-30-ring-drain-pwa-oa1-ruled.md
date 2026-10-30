# Ring drain, PWA half: operator act OA1 ruled (D-7576)

**What this is.** The ledger entry for the operator's ruling on OA1 of `docs/superpowers/plans/2026-10-30-consolidation-ring-exemption-drain-pwa.md` (§Operator acts, Task RW7). The ruling and what RW7 must now do are recorded in `docs/superpowers/plans/2026-10-30-ring-drain-pwa/rw7-ruled.md`, the path the plan names. Docs only: it builds nothing and edits no plan.

## Deviations found

- **D-7576 (2026-10-30)** — `oa1-ruled-skin-registry-l4-composition` (operator act OA1; Task RW7; ARCH-05): the operator ruled option (a), the recommended one: `pwa/src/skins/index.ts` declares `L4 composition` in its header (the spec's header grammar, as `pwa/src/fleet/openers.ts` does with `delivery`), pinned by a `pwa-rings.test.ts` row, so both component-set pairs out of it leave `PWA_L1_EXEMPTIONS` in RW7's one drain commit (D-7575) and the set reaches 0. Options (b) and (c) are not taken; the `composition` declaration is limited to this one file.
