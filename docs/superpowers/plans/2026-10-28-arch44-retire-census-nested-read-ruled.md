# ARCH-44 retire census: a port's nested read literal, ruled

- **D-7301 (2026-10-28)** — ARCH-44 retire census: retireGateLadders walks nested object literals, so a port's nested read literal is not a ladder

**D-7301.** `server/test/census-w4/retire.ts#retireGateLadders` says in its own doc that a port builder whose readers are separate nested arrows orders nothing itself and is not counted, the shape C4k, C4l and C4m leave behind. Its walk read only the members of the literal a function returns. `retireLane.ts#RetireActPort` (C4j) keeps its readers one level down, in its `read` member, so the shape the census names still counted as a ladder. Building C4k found it: at the move, `collectRetirePort` was reported as a ladder and the count stayed at 3.

The walk now reads the members of every object literal nested in one as a member's value, depth first. A call written as a member's value, outside any arrow or method, runs in the builder's own body and still counts. A FIXTURE row in a tree of its own pins both cases. The base count is unchanged (3). The plan (`2026-10-27-consolidation-arch44-retire.md`) is not edited, because merged plans are append-only, so this file is the record. C4k defines it; C4l and C4m cite it and need the same walk.
