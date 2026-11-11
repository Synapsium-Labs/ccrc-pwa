# Retiring the standalone docs server drops no feature: the spec amendment

- **D-8287 (2026-11-11)** — the docs specs say that retiring the standalone docs server drops no feature: the rich-docs parity table marks variants, files over 2 MiB, PDFs, issue-tracker links, outside folders and a private draft-review store Kept (needed before the old server goes off), R-b and R-e/RD21 are reopened, and the retirement gate adds a side-by-side check against the old server.

## Why

On 2026-10-25 the operator ruled that retiring the standalone docs server drops no feature (#1418), and asked for a
private draft-review store with a lifecycle (#1420). The rich-docs spec (2026-10-12) still marked five of the old
server's capabilities Dropped, made moving outside folders under ccd's projects root as git repos a gate step (R-e,
RD21), and had no draft-store row. On 2026-11-10 the operator ruled that the 2026-10-25 ruling wins and that only the
documents change (#1423). This is docs only: no code, no plan task and no ledger row changes.

## Change

- `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md`:
  - R-b reopened: "at parity" means every capability.
  - R-e and RD21 reopened: outside folders stay as their own reader feature, with no move and no git conversion.
  - §6 G3 rewritten as a follow-on reader feature (status Reopened), and a new G11 row for the private draft-review store,
    carrying the recorded frozen-snapshot choice and naming what its threat model still owes.
  - §6 parity table: "Kept" and "Open" join the legend, and no row is Dropped. Variants, files over 2 MiB, PDFs,
    issue-tracker links, outside folders and draft review by link are Kept, needed before the old server goes off.
    Back-to-close, print and old-origin state are Open, to be delivered or waived by the operator, never by their older
    label.
  - §9: Step 1 is now the side-by-side check against the old server. The gate needs every Kept and Open row resolved
    and nothing missing side by side. A18, RD3, RD26, "Where things stand" and "Later" follow.
- `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` §7.4: the operator steps start behind the rich-docs
  gate, and an outside folder is not moved.
- `docs/superpowers/specs/2026-11-07-native-docs-reader-completion-design.md` §3 and §7: they point to the amended
  table, and the #1418/#1420 row reads Kept, needed before the old server goes off.

## Deviations found

- The ruling's comment asks to correct the completion spec's "Dropped" row. #2566 had already split that row so that
  #1418/#1420 were required. This change only names the disposition and points to the amended table.
- The completion spec asks for a full inventory of the standalone server against the native reader, not limited to the
  five named examples. This amendment writes the rows the specs already knew of. The full inventory is still owed by
  the follow-on parity spec, and the table says that it is not limited to the five.
