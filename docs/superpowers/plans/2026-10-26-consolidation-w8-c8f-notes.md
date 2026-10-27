# Consolidation W8, Task C8f: notes while building (D-7058; ARCH-73, #808)

Task C8f of `2026-10-26-consolidation-w8-journals-spawn-launchd.md`, built on `origin/main` `fd32f3ecd`. The plan is not edited (the ledger guard). This note records what Step 0 fixed, what the build measured where the plan gave an estimate, and the departures, each within the latitude the plan gives Step 0. None changes behaviour. No new D-number is needed, so this note lists no `D-TBD-<slug>`.

## Step 0, re-grounded on `fd32f3ecd`

- **Gates.** C8-0b is on `main`: `census-w8/journal.ts` was an empty module (`export {};`) whose header says it is never re-exported, `consolidationCensus.ts` names no `census-w8/` module, and `.github/ci/testmap.mjs#WALK_FLOOR` already names `kernel-tail-journal`. Neither `server/src/journalKernel.ts` nor `single-definition/kernel-tail-journal.test.ts` existed.
- **Census at base** (the queries this task adds, run over a `git archive` of the base's `server/src`): `epochFloorReaders` 2 (`PoolEdgeLog.maxEpoch`, `UpdateIntentLog.maxEpoch`); `journalFloorSites` 3 (`allocateDeviations`, `setAccountPools`, `setIntent`); `appendBeforeApplySites` 4 (those three and `setCollectLane`). The plan said "3 or 4": it is 4.
- **`store.ts` at base:** 9626 lines (4228 code lines by `growthCheck.ts#codeLines`).
- **Rule 6.** 26 open PRs. `store.ts` is held by #1614 (the delegation frame, CONFLICTING), with hunks in the import block, beside `ObservationPredicate`, and early in `CoordStore`. C8f's `store.ts` hunks are one import line just below the `PoolEdgeLog` type import, the bodies of `allocateDeviations`, `setAccountPools`, `setIntent` and `setCollectLane`, and one module-private interface after `CollectLaneTxOutcome`. All are line-disjoint from #1614, and the second PR to land rebases. The class's closing lines are untouched. The 08-10 spec is held by #1217 (CONFLICTING since 2026-10-25), which adds `bounded.ts` to the same K row C8f edits. That is one table line, so the two changes are **not** line-disjoint. C8f appends `journalKernel.ts` at the end of the row's `server/src` cell. Whichever PR lands second resolves the conflict by keeping both entries, never by taking either side whole. No open PR holds `pooledgelog.ts`, `updateintentlog.ts`, `ledgerlog.ts` or any `census-w8/` file.
- **The census helpers `census-w8/journal.ts` imports:** `REPO`, `esc`, `sitesOf` and the `CensusSite` type from `consolidationCensus.ts`, and `parsedFile` from `scan/symbols.ts`, which parses through `scan/parse.ts`. It reads none of them at top level.

## The signature Step 0 fixed

- **`maxJournalEpoch(text, journal, path)`**, where `journal` is the caller's name for its file as the sentence opens: `'pool-edges journal'` or `'update-intent journal'`. The plan's sketch was `` `${what} journal exists at ${path}` `` with `what` = `'update-intent'`. Passing the bare `'update-intent'` would put that name quoted in `updateintentlog.ts`. `single-definition/update-stall.test.ts` refuses that: "the four names no older code spells are quoted nowhere else", so a quoted copy outside `shared/agent-protocol.ts` counts as a second definition of the node file name. The thrown sentence is unchanged byte for byte, and `journal-log-first.test.ts` pins both sentences.
- **`journalFloor`** keeps the plan's `(dbMax: number | null, fileMax: number | null): number | null` and adds one overload, `(dbMax: number, fileMax: number | null): number`, so `setAccountPools` and `setIntent` (whose db side is a seeded row, never null) get a `number` without a cast.
- **`appendThenApply(step, phase?)`** returns `R | S`: on `go` it returns what `apply` returns, and on a stop it returns the stop value. `phase` is `{ at: JournalPhase }` with `JournalPhase = 'decide' | 'append' | 'apply' | 'done'`. The caller starts it at `'decide'`, and the kernel sets the other three as it passes them, as the plan says.

## `setCollectLane`: moved, not kept

Every Step 1 row ran unchanged with the phase read from `appendThenApply`, so the method moved. Those rows are its refusals, `unchanged`, the failed phases `append`, `update` and `commit`, the decide-phase rethrow and the post-commit re-reads (`collect-lane-store`, `collect-lane-journal-undo`, `collect-lane-writers`, `collect-lane-route`, `collect-switch-lane` and `single-definition/child-reclaim`). The kernel's four positions map one to one onto the answer's words, so no fifth arm was needed: `decide` rethrows, `append` is `append`, `apply` is `update`, and `done` is `commit` (the callback has returned and `COMMIT` has not run yet). `appendBeforeApplySites()` is therefore empty, not "only `setCollectLane`".

## Where the build differs from the plan's text

- **The spec row landed with the kernel**, in the commit that creates `journalKernel.ts`, not in Step 4's ratchet commit. `rings/totality.test.ts` fails on any `server/src` file that no row of the ring-context table reaches, so the kernel commit would have been red without the row.
- **`store.ts` grew.** The plan observed that the file would shrink. It went from 9626 to 9659 lines (+33 raw, +20 code lines), because each writer's step object costs a few lines. That is under `GROWTH_LIMIT` (40), so no waiver file is added.
- **Mutation row 6** (`LedgerLog.maxAllocated` routed through `maxJournalEpoch`). `ledgerlog.test.ts` has no row named "a torn line for another project does not count". The rows the mutant turns red are `ledgerlog`'s "append creates the parent and maxAllocated reads back the per-project max" (the per-project filter is lost) and `journal-log-first`'s "LedgerLog.maxAllocated answers null on an EXISTING empty file" (the kernel throws on an empty file).
- **Mutation row 7** (`journalKernel.ts` imports `node:fs`). `rings/totality.test.ts` stays green, because a ring is assigned from imports and totality checks only that each file has a context. The mutant is red in `kernel-tail-journal` ("the kernel imports nothing") and in `rings/outward-edges` ("the outward runtime edges are exactly the exemptions").
- **Two guards were tripped mid-series and fixed in the series' last commit:** `update-stall` (above), and `single-definition/advance-switches`, the per-file ratchet on literal source pins. `census-w8/journal.test.ts` first read `store.ts` as text (56 -> 57), and now reads the parse instead.

## A fourth query, from the first review

The first review found no behaviour change. It did find a gap in the guard: `appendBeforeApplySites` passes over every append inside an `appendThenApply` call, so a row written in `decide`, or an append placed after a write in `apply`, would have kept the ratchet green. A query the plan did not list, `appendThenApplyBreaks()`, closes the gap. It names every `appendThenApply` call in `store.ts` that matches one of three cases:
- **`outside-tx`:** the call sits outside every `tx(` callback. The kernel opens no transaction of its own.
- **`write-before-append`:** a `this.db.prepare(` write comes before its first journal append.
- **`no-append`:** the census cannot see the call's append.

It finds nothing at the tip, and `kernel-tail-journal` pins it there. A mutant that writes a row in `setAccountPools`' `decide` step fails that pin. Smaller fixes from the same review:
- The `*Log` parameter check now reads the whole method (an inline object parameter type no longer hides the parameter), and escapes the name.
- The lexical queries go through `sitesOf`.
- `kernel-tail-journal` gains a positive control (`store.ts` parses and makes four `appendThenApply` calls).
- `setCollectLane` takes its phase words from a `satisfies`-typed map.

The second review (focus 6 to 8 only) found no defect. It found one gap in coverage: a refusal or no-op whose `COMMIT` throws must propagate as itself. Two rows in `journal-log-first.test.ts` now pin that.

## Known width of the new queries

`epochFloorReaders` and `journalFloorSites` are lexical, like most of `consolidationCensus.ts`'s own queries. They use `codeOf`'s comment rule and count one site per code line. A regex or a MAX spelled with other names, or assembled from pieces, is not seen. `appendBeforeApplySites` and `appendThenApplyBreaks` read the syntax tree (`scan/parse.ts`). They do not see a journal reached through an alias, a write not spelled `this.db.prepare(…)`, or a transaction not spelled `tx(…)`.
