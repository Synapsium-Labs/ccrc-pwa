# ccrc history CP-39c: the export pass runs on its own slice of the run budget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Programme ccrc-history, run 982.

**Goal:** On a step whose cadence admits a pass, the export pass runs on its own slice of the ONE run budget, made with CP-39's `stepSlice` when the pass starts. On a step that owes a check after a bind, the check runs on a slice of its own, made before it. Each slice's floor is a new pair of lib constants. So the pass moves even when the tick's earlier steps spent the run, and the check neither starves nor holds the pass.

**Architecture:** The measured cause comes first.
- On the live store on the session-hosting node, read-only (2026-10-26, on a build whose `exportPass` is byte-identical to `origin/main`'s), `history status` read export `due_blobs` 597, `overdue_blobs` 597 and `last_pass_ms` null: no export pass has ever completed. Doctor FAILs `export-overdue`.
- The sweep unit's journal, every hour: "the export pass was held by the run's budget (90000 ms, 536870912 bytes) before it wrote a due row".
- A sweep run takes 82-147 s of wall clock on 38-56 s of CPU (see "Measured before dispatch"). The unit runs at Nice=19, CPUWeight=10 and idle I/O, so under load 90 s of wall clock is a small part of a core.

The cause is in `origin/main`'s code.
- CP-39 (D-6935, D-6936, D-6939) gave ingest a ceiling, and gave fts, nodes, card and census each a slice of the one run budget (`DERIVE_SHARES`, `budgetRungs`, `budgetFloors`, `runRungs`, `stepSlice`). Each slice may overrun the run by its floor.
- The export (tick step 23, `exportStep`) got no slice. `exportPass` reads `ctx.budget`, the run's own budget: `room = Math.min(EXPORT_SEGMENT_MAX_BYTES, ctx.budget.maxBytes - ctx.budget.bytes)` and `budgetLeft(ctx.budget)` (sweep.mjs about :9371-9372).
- On a backlog the steps before step 23 have always spent the run. So the pass takes D-5394's held path at every due interval: it records its attempt and waits an hour. It has never run.
- CP-39's plan named this as a residual ("`exportStep` keeps the full run budget … the export can spend what the ceilings leave"). Nothing is left: every step before it may overrun by its floor.
- The check after a bind (`checkSegmentMarks`) runs first in the step, outside the cadence, on the same run budget. On a spent run it stops before its first batch, every step.

What this wave changes:
- `exportStep` makes up to two slices, each `stepSlice(ctx.budget, <the run's own limits>, <its floor>)`, and never shares one:
  - the check's, `exportCheckSlice(ctx)`, only on a step that owes a check, just before the check (Task 2);
  - the pass's, `exportPassSlice(ctx)`, only when the cadence and the preflight admit a pass, after any check, as a fresh slice (Task 1).
- A step that does neither makes none. A step that does both makes two, so what the check spends never reaches the pass.
- Each slice is handed on through a spread context (`{ ...ctx, budget: slice }`, as `rctx` does at about :8834). So every `ctx.budget` read inside `exportPass`, `exportSelect`, `writeSegmentRows` and `noteExportPassHeld` reads the pass's slice, and every one inside `checkSegmentMarks` reads the check's. None of their signatures changes.
- Each ceiling is the run's own limits, as the census's is (`budgetRungs(…).census` equals the raw limits for every limit, since `ceilingOf(max, 1000)` is `max` for `max >= 1` and 0 for 0). On a run with time left, a slice holds what the run has left, as today.
- The pass's floor is lib's `EXPORT_SLICE_MS` and `EXPORT_SLICE_BYTES`; the check's is lib's `EXPORT_CHECK_SLICE_MS` and `EXPORT_CHECK_SLICE_BYTES`. An in-process test may set either through `ctx.deps.exportSliceFloor` or `ctx.deps.exportCheckSliceFloor` (D-4247). A zero floor gives exactly today's budget: the slice is then what the run has left.
- `stepSlice`'s byte accessor charges every byte to the run (O5).
- The held line names the pass's slice's limits, worded "held by its slice of the run's budget" (D-6976).

**Tech Stack:** Node ESM (`ccd/history/*.mjs`), `node:sqlite`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`: §9.2 step 6 (:2100, "from W1-B4, run the export pass, at most once an hour"), §9.2 step 7 (:2101, the one run budget, with D-6936's pending one-line amendment), §9.6's `export-marks-stalled` bullet (:2272), the failure-modes row "Export marks check stopped short" (:2406), and §9.15 "Write" (:2580, "within the run budget"), "Bounded" (:2585) and "Doctor" (:2586). This wave does not edit the spec. The PR body lists each sentence the coordinator corrects in its own docs PR.

## Global Constraints

- **One run budget (§9.2 step 7, O5).** Each slice is a `stepSlice` view of the run. No task makes a `newBudget` inside a tick; D-4344's `rederiveSlice` stays the only one. `DERIVE_SHARES`, `budgetRungs`, `budgetFloors`, `RUN_BUDGET_*` and `REDERIVE_SLICE_*` keep their values.
- **Not a `DERIVE_SHARES` entry.** A share cuts ingest's ceiling on every tick (`budgetRungs`: ingest's ceiling is the budget less every share). A 100 per mille export share would take ingest from 600 to 500 per mille (54 s to 45 s) on all 30 ticks an hour, for a step that runs on one of them. It would also lower the card step's ceiling, since the export runs between the card step and the census. A share's floor scales with the run, so a test's small run would starve the export again. `history-lib.test.ts` pins `DERIVE_SHARES` to its four keys, and that pin stays.
- **Two slices, never one shared (D-6975).** The check's slice is made only on a step that owes a check. The pass's slice is made only when the cadence admits a pass, after the check, as a fresh `stepSlice`. A step that does both makes two. So a tick whose cadence waits makes no pass slice, and a check that spends its own slice cannot hold the pass.
- **The tick is unchanged.** The order (D-4224, `history-tick-order`) stays. The export stays step 23, outside the ingest gate (D-4762).
- **Everything else the export does is unchanged:** the selection, the due rule, the segment format, the cadence, the marks, the preflight, the check's batches, bounds and stop words, and the held path's record (`budgetHeldPass`, the attempt clock, one stderr line). Only the line's wording changes, to name what held the pass.
- **`exportPass` and `checkSegmentMarks` keep their signatures.** A direct caller (the tests) still runs each on `ctx.budget`. Only `exportStep` makes the slices.
- **One definition.** `EXPORT_SLICE_MS = 180_000` (*chosen*, from the measurement below), `EXPORT_SLICE_BYTES = EXPORT_SEGMENT_MAX_BYTES` (derived), `EXPORT_CHECK_SLICE_MS = 20_000` and `EXPORT_CHECK_SLICE_BYTES = 128 * 1024 * 1024` (*chosen*: D-4344's `REDERIVE_SLICE_*` figures, as named constants of their own). Each is exported once from `lib.mjs`, declared in `lib.d.mts` and imported by `sweep.mjs`. Tests read them from lib.
- **Why these floors (D-6974, D-6975).**
  - The pass's bytes: the segment bound. A slice then never cuts a segment below its bound. The bytes are the stored bytes the pass reads from db/ and writes to export/. The preflight (`planExportRoom`) already admits the home filesystem for exactly `EXPORT_SEGMENT_MAX_BYTES` under its floor.
  - The pass's time: 180 s, chosen from "Measured before dispatch". The pass's fixed cost before the writer's first budget check is about 8-11 s of CPU, plus cold IO. At the unit's measured share that is about 20-110 s of wall clock. At the worst measured share (0.1 of a core), the fixed cost (about 110 s) still leaves about 70 s of writing. A 45 s floor would still hold the pass whenever the share is low. The pass runs at most once an hour, so the floor's overrun is paid on at most one tick in 30.
  - The check's: 20 s and 128 MiB, D-4344's slice figures. A check is owed only after a bind fact or a vanished segment, and each of its batches is bounded (`EXPORT_BIND_BYTES`, 16 MiB; `EXPORT_BIND_BATCH`). So a step that owes a check pays at most 20 s, plus the check's unbudgeted prefix, plus one batch, until the check is done. A check that spends its slice stops on `budget` and resumes on the next step, as it does today; it no longer holds the pass.
  - The check's slice is made in `exportStep`, so its clock also pays the check's unbudgeted prefix (C1-C5 under "Measured before dispatch"): the listing, the whole-and-own reads, `markedSegmentNames`' two `SELECT DISTINCT exported_seg` scans (blobs, about 1.2M rows, and entries, about 8.2M rows, with no index on `exported_seg`), `PRAGMA page_size` and the first WAL truncate. None of it asks the budget, and none of it is measured. The entries scan is of W4's size, and W4 took 7.0 s of CPU, so at a 0.1 share the prefix alone can pass 20 s. On a spent run the check then stops on `budget` before its first batch, every step, as it does today: the 20 s floor moves the check only when its prefix and one batch fit the slice (Residuals named).
- **The overrun bound grows (D-6936, as amended by D-6974 and D-6975).** A pass may overrun the run budget by at most D-6936's 36 s and 204.8 MiB plus one unit per step, plus 180 s and 256 MiB on a step that makes the pass's slice, plus 20 s and 128 MiB on a step that makes the check's slice, plus the pass's unbudgeted spans, plus the check's unbudgeted prefix, plus one row.
  - The check's unit is one batch (at most 16 MiB).
  - The check's unbudgeted prefix (C1-C5) runs before its first budget check, to its end once started.
  - The pass's unbudgeted spans run to their end once started. The selection prefix (the file clock S1, S2, S3 and the first page) runs before the selection's first budget check. The writer's W1-W4 run after the selection's last check and before the writer's first.
  - A due pass's worst wall clock is about 150 s (the tick), plus 180 s, plus its unbudgeted spans (measured below), plus one row. That is under `CARRIER_KILL_S` (600 s) with about 250 s to spare, paid at most once an hour. A step that also owes a check adds 20 s, plus the check's unbudgeted prefix (its C3 scans measured at about 6.7 s of CPU), plus one batch. The timer never starts a second instance while one runs.
  - A carrier kill inside an unbudgeted span leaves a stale segment temp that the next step removes (`removeStaleSegmentTemps`, before the preflight), nothing marked, and one death counted (a scheduled pass that ended without writing a tick), which doctor's `tick-stale` reads.
- **Files.** `ccd/history/lib.mjs`, `ccd/history/lib.d.mts`, `ccd/history/sweep.mjs`, `server/test/history-export.test.ts`, and this plan. Never `deploy/**`, `shared/**`, `.github/**`, the spec or the ledger. In-place edits of earlier cases only where this plan licenses them (E1-E9, D-6976).
- **D-numbers.** This wave was issued three numbers, and this plan defines all three: D-6974, D-6975 and D-6976. None is spare. A further departure is a stop: mail the coordinator.
- **Fixtures.** Synthetic fixture paths only, in the style the history tests already use. No private name, host or absolute home path.
- **Live safety.** Use fixture homes and fixture stores only, built by the tests' own harness. Never run the sweep, the shim, the CLI or any history verb against the live `$HOME` or `~/.ccrc`.

## Review Focus

1. **Which budget each read takes.** Every `ctx.budget` read in `exportPass`, `exportSelect`, `writeSegmentRows` and `noteExportPassHeld` reads the pass's slice, and every one in `checkSegmentMarks` reads the check's, each through a spread context. None of those functions writes any other `ctx` field. **Task 1, case (b); Task 2, case (a).**
2. **No slice, no overrun, on a step that needs none.** A step whose cadence waits and that owes no check reads the run's clock not once. **Task 1, case (c); mutants M3 and M10.**
3. **Every byte is the run's.** After a pass on a spent run, the run's byte count equals the bytes the pass wrote. After a check on a spent run, the run's byte count holds the cleared blobs' stored bytes. **Task 1, case (b); Task 2, case (a).**
4. **Two slices, never one shared.** The check's slice is made only when a check is owed, the pass's only when the cadence admits a pass, after the check. A check that spends its own slice leaves the pass a fresh slice that writes. **Task 2, case (b); mutant M9 (the pass reuses the check's slice).**
5. **The floor against the fixed cost.** 180 s is chosen from the timings in "Measured before dispatch". At a share well under 0.1 of a core the fixed cost alone can spend it; that is named under Residuals.

## Measured before dispatch

The coordinator measured these on 2026-10-26 at about 12:00Z, on the live store on the session-hosting node, read-only (a read-only, query-only connection), at a load of about 18. The floor in Global Constraints is chosen from them; no gate remains before dispatch.

- Table sizes, by max rowid: `entries` 8,169,461; `memberships` 8,165,810; `ingest_files` 1,119; `file_paths` 1,018; `transcripts` 701; `sidecars` 46,059; `blobs` 1,197,100.
- S1 (the file clock): 1,135 rows, 0.01 s of CPU. The plan is `SCAN f`, then an automatic covering index on `p(file_id)`.
- S2: 701 rows, 0.00 s.
- S3 (the DISTINCT over `entries_unexported`): 700 transcripts. Cold: 17.9 s of wall clock, 3.0 s of CPU. Warm: 0.5 s wall, 0.5 s CPU. No pass has ever run, so the index holds every entry.
- W4 (the full `memberships` scan): 8,165,810 rows, 19.4 s wall, 7.0 s CPU. `memberships` is PRIMARY KEY (`file_id`, `entry_id`), plus `memberships_order` (`file_id`, `line`); no index is led by `entry_id`.
- The unit: Nice=19, IOSchedulingClass=idle, CPUWeight=10, TimeoutStartSec=10min (`CARRIER_KILL_S` 600). The timer is OnUnitActiveSec=2min. A sweep run now takes 82-147 s of wall clock on 38-56 s of CPU (a 0.38-0.46 core share). The day before, at a load of about 45, the share was 0.1-0.17.

The arithmetic:
- The fixed cost before the writer's first budget check is about 8-11 s of CPU, plus cold IO. At the unit's share that is about 20-110 s of wall clock. A 45 s floor would still hold the pass whenever the share is low.
- With a 180 s floor, at the worst measured share (0.1 of a core), the fixed cost (about 110 s) still leaves about 70 s of writing.
- A due pass's worst wall clock is about 150 s (the tick), plus 180 s, plus its unbudgeted spans, plus one row. That is under `CARRIER_KILL_S` with about 250 s to spare, paid at most once an hour.
- At a share well under 0.1, the fixed cost alone can spend the slice, and the pass holds again (Residuals named).
- The check's prefix: C3 was measured on the same live store, read-only, cold, at load about 43. The blobs scan took 4.6 s of CPU (38.7 s wall) and the entries scan 2.1 s of CPU (16.7 s wall). Both found 0 names, because no segment exists yet. That is about 6.7 s of CPU, so at a 0.1 share C3 alone is about 67 s, past the check's 20 s; at a 0.4 share it is about 17 s (Residuals named). The check is latent on that store: it runs only after an adopt, a restore or a rebuild records a bind fact.

What the fixed cost is. The pass's slice is made after the preflight admits. Its clock then pays for everything below, in order, before the writer's first budget check.

Before `exportSelect` (in `exportPass`):
- P1. `ensureExportDirs`: a mkdir, no SQL.
- P2. `exportHomeDays`: one `meta` lookup by primary key per rostered home (`retention:<home>`).

`exportSelect`, before its first budget check (in `decide`, after the first page):
- S1. `exportFileClock` → `transcriptFiles`: `SELECT f.transcript_pk, f.source_key, f.mtime_ns / 1000000 AS mtime_ms, p.path FROM ingest_files f LEFT JOIN file_paths p ON p.file_id = f.file_id`. A full scan of `ingest_files`, with an automatic index on `file_paths(file_id)` (measured above). Per row with a path: one `realpathSync` (`homesOfPath`), and a `statSync` when `source_key` is `''`. Before the loop, one `projectsRootOf` per home.
- S2. `SELECT transcript_pk FROM transcripts ORDER BY transcript_pk`: a full scan of `transcripts` by rowid. Then lib `dueTranscriptKeys` over every transcript, in JS.
- S3. `EXPORT_UNEXPORTED_TRANSCRIPTS_SQL` (`SELECT DISTINCT transcript_pk FROM entries INDEXED BY entries_unexported WHERE exported_ms IS NULL`): a full scan of the partial index `entries_unexported` (every unexported entry), with a DISTINCT. Only when S2's due list is not empty.
- S4. Phase 1, only while due transcripts remain: `EXPORT_NULL_TS_ENTRIES_SQL`, a seek on `entries_unexported` at `ts_ms IS NULL`, each row filtered by `+transcript_pk IN json_each(<due>)`, LIMIT 256.
- S5. Phase 2, one call per due transcript, in order: `EXPORT_TRANSCRIPT_ENTRIES_SQL`, a seek on `entries_ts (transcript_pk, ts_ms >= cutoff)`, filtered `exported_ms IS NULL`.
- S6. Phase 3: `EXPORT_DUE_ENTRIES_SQL`, a range on `entries_unexported` (`ts_ms < cutoff`, row-value keyset), filtered by the due list.
- S7. Phase 4: `EXPORT_UNLINKED_SQL` (`sidecars s JOIN blobs b … WHERE s.entry_id IS NULL AND b.exported_ms IS NULL AND b.z IS NOT NULL AND s.blob_id > ? ORDER BY s.blob_id LIMIT ?`). It is not filtered to due transcripts. Not measured.
- Per candidate on each page, before `planSegment` takes it: `rowBlobs` (`entries`, `entry_variants` and `boundaries`, each by primary key), `sidecarsOf(pk)` once per transcript, `blobFact` per blob, and for a phase-4 candidate `unlinkedOf` (a `sidecars_blob` seek).

After the selection's last budget check, before the writer's first:
- W1. `listSegments(dir)`: a readdir and an lstat per segment.
- W2. `transcript.get(pk)` per selected transcript, by primary key.
- W3. `createSegment`: a new SQLite temp file with the segment's schema.
- W4. `writeSegmentRows`: `SELECT file_id, entry_id, line FROM memberships`, iterated whole into JS. It runs whatever was taken, a sidecar-only selection included.

The check's prefix. On a step that owes a check, the check's slice is made just before `checkSegmentMarks`. Its clock then pays for everything below, in order, before the check's first budget check (`markCheckStop`, sweep.mjs about :9795). Only C3 is measured (above).
- C1. `listSegments(dir)`: a readdir and an lstat per segment.
- C2. `segmentsWholeAndOwn`: a header read and a read-only open per listed segment; then `noteSegmentsDamaged`.
- C3. `markedSegmentNames` (about :3062-3066): `SELECT DISTINCT exported_seg FROM blobs WHERE exported_seg IS NOT NULL`, then the same over `entries`. Two full scans (blobs about 1.2M rows, entries about 8.2M rows, by max rowid), with no index on `exported_seg` (sweep.mjs about :9747: "no index, none added"). Measured: 4.6 s and 2.1 s of CPU.
- C4. `PRAGMA page_size`.
- C5. Only when a segment is missing: the first `truncateWalAfterBatch` (D-5639), a busy-tolerant checkpoint, before the first batch.

Outside both slices (before them, unbudgeted, as today): `measureSegmentListing`, `bindFactKeys` (`SELECT k FROM meta WHERE k LIKE 'bound:%'`), the mark-check decision's meta reads, `remeasureDamagedSegments`, `SELECT ts_ms FROM ticks ORDER BY tick_id LIMIT 1`, `ensureExportDirs`, `removeStaleSegmentTemps` and the statfs (5 s deadline).

## Files

| File | Change |
|---|---|
| `ccd/history/lib.mjs` | After `REDERIVE_SLICE_BYTES` (about :221; `EXPORT_SEGMENT_MAX_BYTES` is declared at :173, so no TDZ): `export const EXPORT_SLICE_MS = 180_000;` and `export const EXPORT_SLICE_BYTES = EXPORT_SEGMENT_MAX_BYTES;` (Task 1, D-6974), then `export const EXPORT_CHECK_SLICE_MS = 20_000;` and `export const EXPORT_CHECK_SLICE_BYTES = 128 * 1024 * 1024;` (Task 2, D-6975), each pair with its doc. |
| `ccd/history/lib.d.mts` | `export const EXPORT_SLICE_MS: number;`, `export const EXPORT_SLICE_BYTES: number;`, `export const EXPORT_CHECK_SLICE_MS: number;` and `export const EXPORT_CHECK_SLICE_BYTES: number;` beside `REDERIVE_SLICE_*` (about :48). |
| `ccd/history/sweep.mjs` | The lib import (about :58) names the four. Module-private `sliceFloor(seam, floor)` and `exportPassSlice(ctx)` (Task 1) and `exportCheckSlice(ctx)` (Task 2) above `exportStep`. `exportStep` makes each slice and hands it on (the pass at about :9570, Task 1; the check at about :9497, Task 2). `noteExportPassHeld`'s line and comment (about :9327-9330). The comments that say "the run's budget" for the pass or the check: `EXPORT_ATTEMPT_META`'s doc (about :8893), `exportPass`'s early-held comment (about :9373-9378), `exportStep`'s doc (about :9480), `checkSegmentMarks`' doc (about :9757-9759). The tick docstring's step 23 (about :3680) and the D-6936 comment (about :3723). |
| `server/test/history-export.test.ts` | Task 1's describe at the end of the file. Task 2's describe nested at the end of the bind-check describe (about :2766). In place (D-6976): E1-E9. |
| `docs/superpowers/plans/2026-10-26-ccrc-history-cp39c-export-slice.md` | This plan. |

## Not in this plan

- The spec sentences: the coordinator corrects them in a docs PR.
- A first-row guarantee for the pass, as D-6937 gave the census: it changes the held path's second shape, so it is the coordinator's to rule.
- Charging CPU instead of wall clock, and the unit's priority.
- The memberships scan's cost (W4): an index or a narrower read is a schema decision (Later).

---

### Task 1: the pass runs on its own slice (D-6974, D-6976)

**Files:** the four code and test files in the table.

**Interfaces:**
- Consumes:
  - `stepSlice(budget, ceiling, floor)` (sweep.mjs about :4392) and `budgetLeft(budget)` (about :4371), unchanged;
  - `exportStep(db, ctx)` (about :9485) and `exportPass(db, ctx)` (about :9360), with their signatures unchanged;
  - `tick(db, ctx)` (about :3687), `passCtx(o)` (about :4036) and `idsFromFiles(P)`, as CP-39's starvation describe uses them (history-derive.test.ts about :1617-1700);
  - the test file's `ingestedBox`, `exportCtx`, `onStore`, `metaOf`, `marks`, `segmentsOf` and `heldLine`.
- Produces:
  - `EXPORT_SLICE_MS` and `EXPORT_SLICE_BYTES`, from lib;
  - the seam `ctx.deps.exportSliceFloor = { maxMs, maxBytes }`: both safe integers `>= 0`, or lib's floor is used;
  - `sliceFloor(seam, floor)`: `seam` when it is a non-null object whose `maxMs` and `maxBytes` are both safe integers `>= 0`, else `floor`;
  - `exportPassSlice(ctx)`: `stepSlice(ctx.budget, { maxMs: ctx.budget.maxMs, maxBytes: ctx.budget.maxBytes }, sliceFloor(ctx.deps?.exportSliceFloor, { maxMs: EXPORT_SLICE_MS, maxBytes: EXPORT_SLICE_BYTES }))`.

- [ ] **Step 0: Check the base (no edit).**
  - CP-39c dispatches after #1561 (CP-39b) merges, because both edit the lib import block. This plan's line anchors are `origin/main`'s at `ea1e84c09`, so re-anchor each by its content on your base.
  - CP-39b (#1561) must be on your base, by content: `git grep -n "SIDECAR_READ_WHOLE_MAX" HEAD -- ccd/history/lib.mjs` prints at least one line. If it does not, stop and mail the coordinator.
  - The code this plan read must be there: `git grep -n "the export pass was held by the run's budget" HEAD -- ccd/history/sweep.mjs` prints exactly one line, the `noteExportPassHeld` line (about :9329; the shorter "held by the run's budget" also matches `EXPORT_ATTEMPT_META`'s doc, so do not grep that), and `git grep -n "return exportPass(db, ctx);" HEAD -- ccd/history/sweep.mjs` prints one line. If either differs, stop and mail the coordinator.

- [ ] **Step 1: Write the failing cases, and E1, E4, E5.**
  - E1 (in place): `heldLine` (about :58-61) says `held by its slice of the run's budget (${maxMs} ms, ${maxBytes} bytes)`, and its doc names the slice.
  - E4: beside it, `const ZERO_FLOOR = { maxMs: 0, maxBytes: 0 };` with a one-line doc: an export slice's floor seam (`exportSliceFloor` or `exportCheckSliceFloor`) at zero, so the slice is what the run has left, the budget before CP-39c (D-6976).
    Beside it, the one typed access to a context's budget (`exportCtx` returns `Record<string, unknown>`, so `c.budget` is `unknown` under strict mode), spelled exactly: `const budgetOf = (c: Record<string, unknown>) => c['budget'] as { bytes: number; maxMs: number; maxBytes: number; now: () => number; startMs: number };`, with a one-line doc saying so. Every case below reads or patches an `exportCtx` budget through `budgetOf(c)`, never `c.budget`.
  - E5: `SweepExport` (about :64-73) gains four members, spelled exactly:
    - `passCtx(o: Record<string, unknown>): Record<string, unknown> & { budget: { startMs: number; now: () => number } };`
    - `idsFromFiles(P: unknown): { storeId: string; writer: string } | null;`
    - `tick(db: unknown, ctx: unknown): Promise<void>;`
    - `budgetLeft(budget: Record<string, unknown>): boolean;`
  - Add `describe('CP-39c: the export pass runs on its own slice of the run budget (D-6974)')` at the end of the file. Prefix each case title with its letter, so `-t` can select one. Fixture prefixes start `ccrc-history-cp39c-`. Use a local `roomy` statfs as the D-5394 describe does. Every box is `ingestedBox(prefix, [row(1, 'one', 2 * DAY), row(2, 'two', DAY)])` unless a case says otherwise, and `T = Date.now() + 2 * HOUR` (past the store's first hour, so the cadence runs).
  - (a) `x9Lib.EXPORT_SLICE_MS` is `180_000`. `x9Lib.EXPORT_SLICE_BYTES` equals `x9Lib.EXPORT_SEGMENT_MAX_BYTES`. CONTROL: `x9Lib.DERIVE_SHARES` still equals `{ fts: 150, nodes: 100, card: 50, census: 100 }` (no export share).
  - (b) For `spent` in `bytes` and `clock`: the run is spent as the step starts (`limits` `{ maxBytes: 0 }` or `{ maxMs: 0 }`). Keep the context: `const c = exportCtx(box, ids, () => T, { deps: { statfs: roomy }, limits })`. Spy on stderr as the D-5394 cases do. Expect:
    - CONTROL: `SW.budgetLeft(budgetOf(c))` is false before the step.
    - `r` matches `{ state: 'written', rows: 2, complete: true }`.
    - No `history-sweep:` line contains `export pass was held`.
    - `export_pass_ms` is `String(T)`, and `export_attempt_ms` is null.
    - CONTROL: `r.bytes` is above 0. Then the run's bytes, `budgetOf(c).bytes`, equal `r.bytes`: every byte the slice charged is the run's.
  - (c) A waiting step makes no slice. Use `const c = exportCtx(box, ids, () => T, { deps: { statfs: roomy }, limits: { maxMs: 0 } })` (bytes left, so the clock is the only spent limit), and replace `budgetOf(c).now` with a counter that calls the original. Expect:
    - CONTROL: `metaOf(box, 'export_marks_checked_listing')` is not null (the fixture's passes left the record, so no check is owed).
    - With `export_pass_ms` set to `T - 10 * MIN`: the step answers null, and the counter reads 0.
    - CONTROL: with `export_pass_ms` set to `T - 2 * HOUR` and a fresh counter, the counter reads at least 1.
  - (d) The slice runs out inside the pass. The run is spent (`{ maxMs: 0, maxBytes: 0 }`). The clock answers `T` until the segment's temp exists under `export/<store_id>/`, then `T + x9Lib.EXPORT_SLICE_MS`, as the wall-clock case at about :413 builds it; a `flipped` flag records the switch. Expect:
    - `r` equals `{ state: 'held', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false }`.
    - CONTROL: `flipped` is true (the pass reached its writer).
    - One `history-sweep:` line, `heldLine(x9Lib.EXPORT_SLICE_MS, x9Lib.EXPORT_SLICE_BYTES)`.
    - `export_attempt_ms` is `String(T)`, `export_pass_ms` is null, `segmentsOf(box)` is `[]`, and both marks are null.
  - (e) On a run with time left, the slice holds what the run has left, not just its floor. The run's limits are `{ maxMs: 2 * x9Lib.EXPORT_SLICE_MS }` (the default run is shorter than the floor). The clock answers `T` until the temp exists, then `T + x9Lib.EXPORT_SLICE_MS + 1_000`. Expect:
    - CONTROL: `x9Lib.EXPORT_SLICE_MS + 1_000` is below `2 * x9Lib.EXPORT_SLICE_MS`.
    - `r` matches `{ state: 'written', rows: 2, complete: true }`.
  - (f) The measured defect, through `tick()`. Build the context as CP-39's `pass` helper does (history-derive.test.ts about :1678-1690): `SW.passCtx({ home: box.home, P, ids: SW.idsFromFiles(P), now: () => T, out: () => undefined, parsed: { homes: box.homes, secrets: [], unanswered: [], rosterUnreadable: false }, deps: { managedSettings: [], statfs: roomy }, pause: null, ingest: true })`, with no readdir patch. Then set `ctx.budget.startMs = T - (RUN_BUDGET_MS + 10_000)`: the run is spent before step 1. Run `SW.tick(db, ctx)` on a writer (`onStore`), with stderr spied. Expect:
    - CONTROL: `SW.budgetLeft(ctx.budget)` is false before the tick.
    - `segmentsOf(box)` equals `[`1.${ids.writer}.db`]`: step 23 published on its slice.
    - `export_pass_ms` is `String(T)`, and no `history-sweep:` line contains `export pass was held`.
    - Both rows are marked with that segment.

- [ ] **Step 2: Run, and record the reds.**
  `./node_modules/.bin/vitest run test/history-export.test.ts -t "CP-39c"` (from `server/`, foreground, timeout at least 600000). Predicted, for the worker to measure:
  - (a) red: `expected undefined to be 180000`.
  - (b) red, both arms: `expected { state: 'held', segment: null, rows: 0, … } to match object { state: 'written', rows: 2, complete: true }`.
  - (c) green. Today no step reads the budget on a waiting step. On the admitted step, the run has bytes left, so `origin/main`'s `exportPass` passes `room <= 0` and reads the clock through `budgetLeft`: the second CONTROL's counter reads 1. M3 is its red.
  - (d) red at the `flipped` CONTROL: `expected false to be true` (the pass is held before it selects).
  - (e) red at its CONTROL on the undefined constant (`NaN` is not below `NaN`).
  - (f) red: `expected [] to deeply equal [ '1.<writer>.db' ]`.
  Then run `-t "the selection reaches the due rows"`. Predicted: four cases red on E1's wording, at three `heldLine` assertion sites: the two direct-`exportPass` (c) cases (about :2154 and :2191, asserting at about :2177 and :2213) and both arms of the held-early pair (a loop over `bytes` and `clock`, about :2229, asserting at about :2246). Record what is measured.

- [ ] **Step 3a: The constants alone.** Add the pass's two lib.mjs exports and their lib.d.mts lines only, and re-run the CP-39c filter. Predicted: (a), (c) and (e) green ((e) on the run's own 360 s); (b), (d) and (f) red as before. Record what is measured.

- [ ] **Step 3b: The pass's slice.**
  - lib.mjs: the constants' doc says that the pass runs on its own slice of the one run budget (D-6974). It says that 180 s is *chosen* from a measurement: the pass's fixed cost before the writer's first budget check, about 8-11 s of CPU plus cold IO, is about 20-110 s of wall clock at the unit's measured share, and 180 s leaves about 70 s of writing at 0.1 of a core; the floor is paid on at most one tick in 30. It says that the bytes are the segment bound, which the preflight already admits on the home filesystem, and that neither is a `DERIVE_SHARES` entry, because a share cuts ingest's ceiling on every tick.
  - sweep.mjs: import both constants. Above `exportStep`, add:
    - `sliceFloor(seam, floor)`: `seam` when it is a non-null object whose `maxMs` and `maxBytes` are both safe integers `>= 0`, else `floor`. Its doc names D-4247 and says that a zero floor is the run's remainder, the budget before CP-39c.
    - `exportPassSlice(ctx)`: `stepSlice(ctx.budget, { maxMs: ctx.budget.maxMs, maxBytes: ctx.budget.maxBytes }, sliceFloor(ctx.deps?.exportSliceFloor, { maxMs: EXPORT_SLICE_MS, maxBytes: EXPORT_SLICE_BYTES }))`. Its doc says the ceiling is the run's own limits, as the census's is.
  - `exportStep`: replace `return exportPass(db, ctx);` with `return exportPass(db, { ...ctx, budget: exportPassSlice(ctx) });`, after the pause-clearing line. A comment names D-6974: made fresh at the pass's start, on a step whose cadence and preflight admitted it; every byte charged to it is the run's; a step that waits or pauses makes none.
  - `noteExportPassHeld`: the line becomes `history-sweep: the export pass was held by its slice of the run's budget (${ctx.budget.maxMs} ms, ${ctx.budget.maxBytes} bytes) before it wrote a due row; it tries again at its next interval`. Its comment says that the pass runs on its slice (D-6974), and the line names the slice's limits, both of them (D-6976).
  - Reword the comments the Files table names for the pass: "the run's budget" becomes "its slice of the run's budget" where it means the pass's budget. `exportPass`'s early-held comment says that through `exportStep` this branch is reached only by a zero floor over a spent run, and otherwise only by a direct caller on the run's budget. It names no third route.
  - The tick docstring's step 23 adds "on its own slice of the run's ONE budget (D-6974)". The step must still start with `` `exportStep` `` (history-sweep.test.ts's F39 describe reads it). The D-6936 comment (about :3723) adds: "and, on a step whose export runs, the export's floors, the pass's unbudgeted spans and the check's unbudgeted prefix (D-6974, D-6975)".
  Re-run the CP-39c filter: all green.

- [ ] **Step 4: The cases this changes, red first.** Run `-t "the selection reaches the due rows"`. Predicted, for the worker to measure:
  - the held-early pair (about :2229, `exportStep` on `{ maxBytes: 0 }` and `{ maxMs: 0 }`) is red: `written` where `held` was pinned. Those cases pin the defect's own mechanism;
  - the (f) pair (about :2268, `exportStep` with `limits: { maxBytes }` for a small room) stays green, but its room is now the floor, so "the first row forced past a small room" no longer happens.
  Record both, then Step 5.

- [ ] **Step 5: In place (D-6976).**
  - E2: the held-early pair. Its first `exportStep` call (at `T`) adds `exportSliceFloor: ZERO_FLOOR` to `deps`. Its title becomes `(c) an export step whose slice starts spent (a zero floor over a spent run: ${spent}) records its attempt and says so once, so the next step waits its interval; a step with a budget that lasts then writes the rows and clears the record`. The comment above it (about :2224-2227) says that the pass runs on its own slice (D-6974), so through the step only a zero floor (the seam) over a spent run reaches this hold. Its `heldLine` arguments stay.
  - E3: the (f) pair. Its `exportStep` call at `T` adds `exportSliceFloor: ZERO_FLOOR` to `deps`, so its small room stays the run's.
  - Nothing else in these cases changes.

- [ ] **Step 6: Run green.** One per call, from `server/`, in the foreground:
  - `./node_modules/.bin/vitest run test/history-export.test.ts`
  - `./node_modules/.bin/vitest run test/history-derive.test.ts -t "CP-39 Task 4"` (the export waits there; the first arm's elapsed bound must hold)
  - `./node_modules/.bin/vitest run test/history-sweep.test.ts -t "F39"`
  - `./node_modules/.bin/vitest run test/history-lib.test.ts`
  - `./node_modules/.bin/vitest run test/history-recover.test.ts`
  - `./node_modules/.bin/vitest run test/history-ingest.test.ts -t "CP-39 Task 4"`
  - `./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit`
  - `./node_modules/.bin/vitest run test/single-definition` (a directory filter)
  - `./node_modules/.bin/vitest run test/single-definition-pin.test.ts`

- [ ] **Step 7: Mutants.** Each must go red, and each is restored byte for byte, with `cmp` silent, before the next.
  - M1: `exportStep` returns `exportPass(db, ctx)` again. Expect (b), (d) and (f) red.
  - M2: `exportPassSlice` passes `{ maxMs: 0, maxBytes: 0 }` as its floor. Expect (b), (d) and (f) red ((d) at its `flipped` CONTROL: on the fully spent run the pass is held before it selects).
  - M3: `exportStep` makes the pass's slice at its first line (`const slice = exportPassSlice(ctx);`), unused until the pass. Expect (c) red (one read on a waiting step).
  - M4: `EXPORT_SLICE_BYTES = REDERIVE_SLICE_BYTES`. Expect (a) red. Run (a) alone (`-t "CP-39c.*\\(a\\)"`), because (b)-(f) read the constant by design.
  - M5: `noteExportPassHeld`'s line says "held by the run's budget" again. Expect (d) red, and E2's pair.
  - M6: `sliceFloor` accepts only values `> 0`, as `checkSegmentMarks`' seam does. Expect E2's pair red (`written`).
  - M7: `exportPassSlice` passes the floor as its ceiling too. Expect (e) red (`held`).

- [ ] **Step 8: Commit.** `fix(history): the export pass runs on its own slice of the run budget (CP-39c Task 1; D-6974, D-6976)`

### Task 2: the check after a bind runs on its own slice (D-6975, D-6976)

**Files:** `ccd/history/lib.mjs`, `ccd/history/lib.d.mts`, `ccd/history/sweep.mjs` (the import, `exportCheckSlice`, `exportStep`, `checkSegmentMarks`' doc), `server/test/history-export.test.ts`.

**Interfaces:**
- Consumes: `checkSegmentMarks(db, ctx, record, listing)` (about :9770), unchanged. Its budget reads are `markCheckStop({ budgetLeft: budgetLeft(ctx.budget), … })` before each batch (about :9795) and `ctx.budget.bytes += b.bytes` after it (about :9806). Task 1's `sliceFloor`, `ZERO_FLOOR` and `budgetOf`. The bind-check describe's `roomy`, `lostBox`, `bind` and `endState` (about :2767-2815).
- Produces:
  - `EXPORT_CHECK_SLICE_MS` and `EXPORT_CHECK_SLICE_BYTES`, from lib;
  - the seam `ctx.deps.exportCheckSliceFloor = { maxMs, maxBytes }`, read through `sliceFloor`;
  - `exportCheckSlice(ctx)`: `stepSlice(ctx.budget, { maxMs: ctx.budget.maxMs, maxBytes: ctx.budget.maxBytes }, sliceFloor(ctx.deps?.exportCheckSliceFloor, { maxMs: EXPORT_CHECK_SLICE_MS, maxBytes: EXPORT_CHECK_SLICE_BYTES }))`, made in `exportStep` only on a step that owes a check.

Why: the check runs first in the step and outside the cadence, on `ctx.budget`. On a spent run, `markCheckStop` answers `budget` before the first batch, every step, so a check with marks to clear never moves. Its own bounds (`EXPORT_BIND_BYTES`, `EXPORT_BIND_BATCH`, `EXPORT_BIND_WAL_CEILING`) bound a batch, not the step. It gets a slice of its own, not the pass's: a check that spent a shared slice would hold that step's pass, which would then wait an hour each time. An empty check (no marks) writes its done stamp without asking the budget, so on the live store, where no pass ever completed and no mark exists, the starvation is latent. `remeasureDamagedSegments` needs no slice: it reads no budget, and it is bounded by the names the damaged record holds (one header read and one read-only open each).

- [ ] **Step 1: Write the failing cases.** Nest `describe('CP-39c: the check after a bind runs on its own slice of the run budget (D-6975)')` at the end of the bind-check describe. `NOW = Date.now()` and `at = (ms) => () => NOW + ms`, as its cases use them. Prefix each case title with its letter.
  - (a) `const a = await lostBox('ccrc-history-cp39c-bind-', { lost: 6, zBytes: 1000 })` and `const b = await lostBox('ccrc-history-cp39c-bindctl-', { lost: 6, zBytes: 1000 })`; `bind` both at `NOW + MIN`. Step `a` once at `at(2 * MIN)` on a spent run: `const c = exportCtx(a.box, a.ids, at(2 * MIN), { deps: { exportBindBytes: 2000 }, limits: { maxMs: 0, maxBytes: 0 } })`. Step `b` once at `at(2 * MIN)` with `{ deps: { exportBindBytes: 2000 } }`. Both steps fall inside the store's first hour, so neither runs a pass. Expect:
    - CONTROL: `endState(b)` matches `{ missing: '13', stop: null, counted: null, counter: 1 }`.
    - `endState(a)` equals `endState(b)`: the check ran to its done stamp in one step, on its own slice.
    - The run's bytes, `budgetOf(c).bytes`, are at least 6000: the cleared blobs' stored bytes were charged to the run.
  - (b) A check that spends its own slice leaves the pass a fresh slice that writes. `const x = await lostBox('ccrc-history-cp39c-bindown-', { lost: 6, zBytes: 1000 })`; `bind` at `NOW + MIN`. `T = NOW + 2 * HOUR` (past the store's first hour, so the cadence admits a pass). The context: `const c = exportCtx(x.box, x.ids, () => t, { deps: { statfs: roomy, exportBindBytes: 2000, exportCheckSliceFloor: { maxMs: 3_000, maxBytes: 1 << 30 } }, limits: { maxMs: 0, maxBytes: 0 } })` with `let t = T`, then `budgetOf(c).now = () => (t += 1_000)` (only budget reads move the clock, as CP-39's helper does). The pass's floor is lib's. Spy on stderr. Expect:
    - the stop record matches `/^budget [0-9]+ [1-9][0-9]*$/`: the check cleared marks, then its own slice ran out;
    - `r` matches `{ state: 'written' }`, and `r.rows` is above 0: the pass ran on a fresh slice of its own;
    - no `history-sweep:` line contains `export pass was held`;
    - `export_pass_ms` is set, and `export_attempt_ms` is null.
    The figures (how many batches fit in 3 s at 1 s a read, and how many rows the pass writes) are the worker's to measure; the regex, the `written` state and the absent held line are the pins.
  - (c) `x9Lib.EXPORT_CHECK_SLICE_MS` is `20_000`, and `x9Lib.EXPORT_CHECK_SLICE_BYTES` is `128 * 1024 * 1024`.

- [ ] **Step 2: Run, and record the reds** at Task 1's tree: `-t "CP-39c: the check after a bind"`. Predicted, for the worker to measure:
  - (a) red: `stop` is `budget <ms> 0`, where null was expected (no batch on the spent run).
  - (b) red at the stop record: `budget <ms> 0` does not match (no batch cleared anything; the pass then writes on its own slice).
  - (c) red: `expected undefined to be 20000`.

- [ ] **Step 3: The check's slice.**
  - lib.mjs: after `EXPORT_SLICE_BYTES`, `export const EXPORT_CHECK_SLICE_MS = 20_000;` and `export const EXPORT_CHECK_SLICE_BYTES = 128 * 1024 * 1024;`. Their doc says: the check after a bind runs on its own slice of the one run budget (D-6975); D-4344's slice figures, *chosen*, as named constants of their own; made only on a step that owes a check, so such a step pays 20 s, plus the check's unbudgeted prefix (the listing, the whole-and-own reads, the two marked-name scans and the first WAL truncate, which the slice's clock pays before the first batch), plus one batch, until the check is done. lib.d.mts declares both.
  - sweep.mjs: import both. Beside `exportPassSlice`, add `exportCheckSlice(ctx)` as Interfaces gives it. Its doc says the ceiling is the run's own limits.
  - `exportStep`: inside `if (markCheck.check)`, the call becomes `checkSegmentMarks(db, { ...ctx, budget: exportCheckSlice(ctx) }, markCheck.record, listing)`. A comment names D-6975: made only on a step that owes a check, just before it; the pass never reads it, and makes its own fresh slice after (D-6974).
  - The pass's call stays as Task 1 left it. `exportPass`'s early-held comment and E2's comment stay as Task 1 wrote them: the check's slice never reaches the pass, so no third route to that branch exists.
  - `checkSegmentMarks`' doc: "its stored bytes to the run's budget" becomes "its stored bytes to its slice of the run's budget, and so to the run", and "a spent run budget (`budget`)" becomes "a spent slice of the run budget (`budget`)". It says that `exportStep` hands it a slice of its own (D-6975). `exportStep`'s doc says the same.
  Re-run the filter: all three green.

- [ ] **Step 4: The cases this changes, red first.** Run the bind-check describe (`-t "the check after a bind runs in bounded"`), then `-t "a carried segment counts only"` and `-t "the check re-arms"`. Predicted red, for the worker to measure: the four cases that stop a check on the run's budget through `exportStep`, because each check now finishes on its own floor. Each runs inside a waiting cadence, so only the check's slice changes them:
  - E6: "a check the run budget stops resumes on the next step" (about :2849);
  - E7: "a segment that arrives and one moved aside between two steps" (about :2879);
  - E8: "a check stopped on its budget before its first batch still records the damaged segment" (about :3505);
  - E9: "a listing that fails never deletes the stop record of a check the listing re-armed" (about :3681).
  Record what is measured, then Step 5.

- [ ] **Step 5: In place (D-6976).** E6 and E7: each `step` constant's `deps` adds `exportCheckSliceFloor: ZERO_FLOOR`. E8: its `exportStep` call adds `deps: { exportCheckSliceFloor: ZERO_FLOOR }`. E9: its first `exportStep` call's `deps` adds `exportCheckSliceFloor: ZERO_FLOOR`. Each case gets a one-line comment naming D-6976: a zero floor keeps the run's budget as the check's. Nothing else changes.

- [ ] **Step 6: Run green.** Task 1 Step 6's list, one per call.

- [ ] **Step 7: Mutants.** Each red, then restored byte for byte, with `cmp` silent.
  - M8: the check is called with `ctx` again. Expect (a) and (b) red.
  - M9: the pass reuses the check's slice. `exportStep` keeps the check's slice in a `let checkSlice = null`, and the pass becomes `exportPass(db, { ...ctx, budget: checkSlice ?? exportPassSlice(ctx) })`. Expect (b) red: `held`, with the line naming the check's slice (`3000 ms, 1073741824 bytes`).
  - M10: `exportStep` makes the check's slice at its first line, owed or not (`const checkSlice = exportCheckSlice(ctx);`). Expect Task 1's (c) red (one read on a waiting step that owes no check).
  - M11: `EXPORT_CHECK_SLICE_BYTES = EXPORT_SLICE_BYTES`. Expect (c) red. Run (c) alone (`-t "CP-39c: the check after a bind.*\\(c\\)"`).
  - Re-run M6 against this tree. Expect E2, E6, E7, E8 and E9 red.

- [ ] **Step 8: Commit.** `fix(history): the check after a bind runs on its own slice of the run budget (CP-39c Task 2; D-6975, D-6976)`

### Task 3: the plan and the PR

- [ ] Copy this plan to `docs/superpowers/plans/2026-10-26-ccrc-history-cp39c-export-slice.md`, with every predicted red replaced by the measured one. Commit: `docs(plan): CP-39c, the export pass and the check on their own slices (CP-39c; D-6974, D-6975, D-6976)`
- [ ] Before opening the PR, run `deviation-refs` after `git fetch origin main`, and the private-name scan over the added lines, the commit messages and the PR body (0 hits).
- [ ] Open the PR against main, ready for review, titled "ccrc history CP-39c: the export pass runs on its own slice of the run budget". Its body has these sections:
  - Summary
  - Departures (D-6974, D-6975, D-6976, each with its class as "Deviations found" gives it)
  - Residuals named, below
  - Tests run (each suite, its counts, and every red measured in Steps 2 and 4 of both tasks)
  - Steps for the coordinator or the operator, never the worker:
    1. Correct the spec in a docs PR. Every correction is in place and line-neutral, because spec line citations are pinned.
       - §9.2 step 6 (:2100): the export pass runs on its own slice of the run budget (D-6974).
       - D-6936's pending §9.2 step 7 text (:2101): replace "the hourly export pass (step 6) still runs under the whole budget" with: the pass runs on its own slice, floor `EXPORT_SLICE_MS` and `EXPORT_SLICE_BYTES`, and a check after a bind on a slice of its own, floor `EXPORT_CHECK_SLICE_MS` and `EXPORT_CHECK_SLICE_BYTES`. The overrun bound becomes D-6936's 36 s and 204.8 MiB plus one unit per step, plus 180 s and 256 MiB on a step that makes the pass's slice, plus 20 s and 128 MiB on a step that makes the check's slice, plus the pass's unbudgeted spans (the selection prefix: the file clock, S2, S3 and the first page; and the writer's W1-W4), plus the check's unbudgeted prefix (the listing, the whole-and-own reads, the two marked-name scans and the first WAL truncate).
       - §9.6's `export-marks-stalled` bullet (:2272): "A check that waits on the run budget (`budget`)" becomes "on its slice of the run budget (`budget`)". Its reason for not escalating gains a clause, and keeps its `lag-high` reason beside it: its own slice moves it whenever its unbudgeted prefix and one batch fit that slice (D-6975); one whose prefix outlasts the slice waits as before, and an ingest backlog that long already FAILs `lag-high`.
       - The failure-modes row "Export marks check stopped short" (:2406): "the run budget spent" becomes "its slice of the run budget spent".
       - §9.15 "Write" (:2580): "within the run budget" becomes "within its slice of the run budget".
       - §9.15 "Bounded" (:2585): "once the run budget is spent" becomes "once the check's slice of the run budget is spent" (D-6975). Its closing sentences, "The check charges the stored bytes it rewrites to the run's byte budget, and one that spends it holds the pass (D-5632); while budget remains the pass keeps running in the same step, which can only clear more, never lose a row", become: the check charges the stored bytes it rewrites to the run through its own slice; one that spends its slice stops, and the pass in the same step still runs on a slice of its own (D-6974, D-6975), which can only clear more, never lose a row.
       - §9.15 "Doctor" (:2586): "A check that waits on the run budget" becomes "on its slice of the run budget", with the same qualified reason as at :2272 (its slice moves it whenever its prefix and one batch fit; the `lag-high` reason stays beside it).
    2. Close CP-39's named residual "`exportStep` keeps the full run budget" in the programme ledger.
    3. After the merge, the rollout is the operator's. Then, read-only: within two hourly intervals the sweep journal shows no "export pass was held" line, and `history status` shows export `last_pass_ms` set. Doctor's `export-overdue` clears once the due rows are exported (597 when measured; each pass takes up to 256 MiB).
- [ ] Read the threads with `gh api graphql`, and confirm CI ran at the head and its `select tests` summary lists `history-export.test.ts`. If a leg is red, stop and mail the coordinator with the leg.

## Residuals named

- At a share well under 0.1 of a core, the pass's fixed cost alone can spend its 180 s slice, and the pass holds again, now with a line that names the slice. The lever then is the W4 narrowing (Later, a schema decision) or a first-row guarantee, as D-6937 gave the census (not in this wave).
- The pass's unbudgeted spans (the selection prefix: the file clock, S2, S3 and the first page; and the writer's W1-W4) run to their end once started. The overrun bound counts them. A carrier kill inside one leaves a stale temp that the next step removes, nothing marked, and one death counted for doctor's `tick-stale`.
- On a step that makes the pass's slice, the pass may read and write up to 256 MiB beyond the run's byte budget: read from db/, and written to export/ on the home filesystem, which the preflight admitted for that size. On a step that makes the check's slice, the check may rewrite up to 128 MiB of stored bytes, plus one batch, beyond it.
- A step that owes a check pays up to 20 s, plus the check's unbudgeted prefix, plus one batch, of overrun on every step until the check is done. A check is owed only after a bind fact or a vanished segment.
- The check's unbudgeted prefix (C1-C5: the listing, the whole-and-own reads, `markedSegmentNames`' two `SELECT DISTINCT exported_seg` scans over blobs and entries with no index, `PRAGMA page_size` and the first WAL truncate) runs on the check's slice clock before its first budget check. Its C3 scans measured about 6.7 s of CPU in all (Measured before dispatch), so at a 0.1 share the prefix alone (about 67 s) passes 20 s. The check is latent until an adopt, a restore or a rebuild. On a spent run the check then stops on `budget` before its first batch on every step, the starvation D-6975 cures only when the prefix and one batch fit the slice. The lever is the coordinator's to rule: an index on `exported_seg` (a schema decision), or a slice made after the prefix (a change to `checkSegmentMarks`).
- `measureSegmentListing`, `bindFactKeys`, `remeasureDamagedSegments`, the cadence's reads and the preflight run before both slices, unbudgeted, as before.
- A direct `exportPass` caller (tests only) runs on `ctx.budget`, and its held line still says "its slice"; the run's budget is then its slice.
- W4 scans all of `memberships` on every pass, a sidecar-only one included (8,165,810 rows, 19.4 s of wall clock and 7.0 s of CPU cold, measured). That was so before; it is now inside the pass's slice.
- The spec lags until the coordinator's docs PR.

## Deviations found

- **D-6974** — `history-export-pass-own-slice` (Task 1). **Spec amendment**, in place: §9.2 steps 6 and 7 and §9.15 "Write", amending D-6936's pending text. The coordinator's docs PR carries the text. The export pass runs on its own slice of the one run budget: `stepSlice(run, <the run's own limits>, <the pass's floor>)`, made fresh in `exportStep` when the pass starts, after any check, on a step whose cadence and preflight admitted it, and handed to `exportPass` as `ctx.budget`. A step that waits or pauses makes none.
  - The floor is lib's `EXPORT_SLICE_MS` (180 s, *chosen* from the measurement in "Measured before dispatch") and `EXPORT_SLICE_BYTES` (`EXPORT_SEGMENT_MAX_BYTES`, derived), or an in-process test's `ctx.deps.exportSliceFloor` (D-4247). A zero floor gives the budget before this wave.
  - Every byte charged to the slice is charged to the run (`stepSlice`'s accessor, O5).
  - It is not a `DERIVE_SHARES` entry: a share would cut ingest's ceiling on every tick for a step that runs at most once an hour.
  - The pass's unbudgeted spans run to their end once started: the selection prefix (the file clock, S2, S3 and the first page) and the writer's W1-W4. A carrier kill inside one leaves a stale temp that the next step removes, nothing marked, and one death counted for doctor's `tick-stale`.
  - D-6936's overrun bound becomes 36 s and 204.8 MiB plus one unit per step, plus 180 s and 256 MiB on a step that makes the pass's slice, plus the unbudgeted spans, plus one row. A due pass's worst wall clock is about 150 s, plus 180 s, plus those spans, plus one row: under `CARRIER_KILL_S` with about 250 s to spare, paid at most once an hour.
  - Measured defect: on the live store on the session-hosting node, read-only, no export pass had ever completed (`last_pass_ms` null, 597 due and overdue blobs, doctor FAIL `export-overdue`), and the journal showed the held line every hour. The steps before step 23 spend the run on a backlog, and CP-39 gave the export no slice. CP-39's residual "`exportStep` keeps the full run budget" is closed.
- **D-6975** — `history-export-bind-check-own-slice` (Task 2). **Spec amendment**, in place: §9.15 "Bounded" and "Doctor", §9.6's `export-marks-stalled` bullet, the failure-modes row "Export marks check stopped short", and §9.2 step 7's bound. The coordinator's docs PR carries the text. The check after a bind runs on its OWN slice of the one run budget, never the pass's.
  - Its floor is lib's `EXPORT_CHECK_SLICE_MS` (20 s) and `EXPORT_CHECK_SLICE_BYTES` (128 MiB), D-4344's slice figures, *chosen*, as named constants of their own; or an in-process test's `ctx.deps.exportCheckSliceFloor` (D-4247).
  - The check's slice is made only on a step that owes a check, just before it. The pass's slice is made only when the cadence admits a pass, after the check, as a fresh `stepSlice`. A step that does both makes two.
  - So "a tick whose cadence waits makes no pass slice" holds. A step that owes a check makes the check's slice even when its cadence waits, and pays 20 s and 128 MiB, plus the check's unbudgeted prefix, plus one batch, until the check is done.
  - The check's unbudgeted prefix runs on its slice clock before its first budget check, to its end once started: the listing, the whole-and-own reads, `markedSegmentNames`' two `SELECT DISTINCT exported_seg` scans (blobs and entries, no index), `PRAGMA page_size` and the first WAL truncate. Its C3 scans measured about 6.7 s of CPU. The overrun bound counts it. At a low share it can spend the 20 s alone, and the check then stops on `budget` before its first batch, as before this wave (Residuals named). Without it, the check runs first and outside the cadence on the run's budget, so on a spent run `markCheckStop` stops it on `budget` before its first batch, every step.
  - A check that spends its slice stops on `budget` and resumes on the next step. It cannot hold the pass: the pass's slice is fresh.
  - On the live store it is latent: no mark exists, and an empty check never asks the budget.
- **D-6976** — `history-export-held-line-names-the-slice` (Tasks 1 and 2; D-5394). **NEW departure** (no spec §16 row). The held line reads "the export pass was held by its slice of the run's budget (<ms> ms, <bytes> bytes) …", naming the pass's slice's limits, both of them. Its meaning is unchanged: the pass wrote no due row, its attempt is recorded, and it tries again at its next interval. Earlier test texts are edited in place:
  - E1: `heldLine`'s wording. E4: `ZERO_FLOOR` and `budgetOf`. E5: four `SweepExport` members (`passCtx`, `idsFromFiles`, `tick`, `budgetLeft`).
  - E2: the held-early pair through `exportStep` takes a zero pass floor and is retitled, because with lib's floor that step now writes (they pinned the defect's mechanism). Through the step, only a zero floor over a spent run reaches that hold; otherwise only a direct caller does.
  - E3: the (f) pair takes a zero pass floor, so its small room stays the run's.
  - E6-E9: four bind-check cases that stop a check on the run's budget through `exportStep` take a zero check floor.
