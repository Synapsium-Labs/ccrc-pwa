# W8 Task C8-0b: notes from the build

The consolidation W8 plan (`2026-10-26-consolidation-w8-journals-spawn-launchd.md`, Task C8-0b) is not edited here; the
ledger guard refuses edits under `docs/superpowers/plans/`. This note records the one departure found while building
the task.

## D-TBD-c8-0b-header-wording: the census-w8 headers say "which never re-exports it"

**What the plan says.** C8-0b's Files list replaces each `census-w8/` module header's "and `consolidationCensus.ts`
re-exports this module, so every count a W8 PR body quotes still comes from a named census query" with "and it imports
what it needs from `consolidationCensus.ts`; it never re-exports this module, so no import cycle forms, and every count
a W8 PR body quotes comes from a named query of this module". The task's counted exit also requires
`git grep 're-exports this module' -- server/test/census-w8/` to go from 3 matching lines to 0.

**Why both cannot hold.** The prescribed replacement contains "never re-exports this module", so the grep still matches
each header: 3 matching lines, not 0 (measured on the branch after the literal edit). The literal wording is also
unclear about its subject: "it never re-exports this module" reads as the chain module re-exporting itself.

**What landed.** Each header says the module "imports what it needs from `consolidationCensus.ts`, which never
re-exports it, so no import cycle forms, and every count a W8 PR body quotes comes from a named query of this module",
plus the sentence the plan adds: it reads no imported value at top level (only types, and functions called inside a
query). The meaning is the plan's, the subject is explicit (the census module is the one that never re-exports), and
the counted exit holds (3 -> 0). Each module still holds only `export {};`; no query and no import.

**Number.** The controller issues this departure's D-number through the allocator and replaces the slug here and in
the three module headers before the PR lands; until then `server/test/dtbd.test.ts` is red by design on this branch.
