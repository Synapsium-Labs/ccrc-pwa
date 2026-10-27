# ccrc history CP-39d: grep searches its scope, and capture sees a turn while it runs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Programme ccrc-history, run 1039. This file is `docs/superpowers/plans/2026-10-27-ccrc-history-cp39d-w1-grep-and-lag.md`; the worker's first commit adds it byte for byte.

**Goal:** Two W1 acceptance rows read outside target for a real cause, and this wave fixes both before W2's act 6.
- **W1-f:** a family grep costs what its scope holds, not what the whole box holds. Every referrer arm is driven from the scope's transcripts. BM25 is read only by a sort that orders by it. The true count rides in the ranked statement, so the global match runs once.
- **W1-b:** the sweep sees a registered session's transcript grow mid-turn within about one tick. It does this at a bounded cost per tick, with no new hook line and no full scan per tick.

The wave also fixes the two measures behind those rows, and takes the sweep's owed review carries.

**Architecture:** The measured causes come first (see "Measured before dispatch").
- **W1-f.** `recall.mjs`'s `referrerSql` opens with `WITH m(blob_id, rank) AS (SELECT rowid, rank FROM blobs_fts WHERE blobs_fts MATCH :q)`. That is the whole box's match.
  - It joins every match to `entries`, `entry_variants` and `sidecars`, and only then filters the scope (`GREP_FILTER`'s `r.transcript_pk IN :tpks`).
  - It reads `rank` for every sort, so BM25 reads each match's document size.
  - `rankedAndCounted` runs the whole shape twice: once ranked (`rankedSql`) and once for the count (`countSql`).
  - So a family's grep pays for the box's matches. Measured live, the shipped shape takes 1.3-5.4 s cold, and a scope-first form takes 64-146 ms.
- **W1-b.** The tick's discovery (`sweep.mjs` `candidateFiles`) takes three groups of files: spool hints, "behind" files (`size > offset`, where `size` is the size last measured) and, every 30 minutes, the scan. The hook spools only on Stop, PostCompact and SessionStart.
  - A transcript that grows mid-turn has no hint, and its recorded size is stale. So it waits for the turn's Stop line or the next scan.
  - `ticks.lag_ms` counts from each new row's own timestamp. So the lag reads the turn's length: live p95 22 min, against a target of 4 min.
  - The spec's own capture goal (§2 item 1: "within two sweep ticks of being written, outside a backlog drain") cannot be met by §9.2 step 2's sources.

What this wave changes:
- **Task 1 (`recall.mjs`).** Every referrer arm filters its own transcript (`transcript_pk IN :tpks`), reads `entries` through `INDEXED BY entries_ts`, and tests its blob against the match with a unary `+`. So the scope drives every arm whatever the statistics say, and no arm can be driven from a blob-led index.
  - A sort whose ORDER BY names `rank` joins `rk`, the match's rank, in the form Step 3c measures cheapest. Recency reads no rank.
  - `count(*) OVER ()` carries the true count on every pooled row, and `countSql` is deleted.
  - Rows, order, snippets and counts are the shipped query's, pinned by an equivalence against the shipped statement's own text.
- **Task 2 (`lib.mjs`, `sweep.mjs`).** On a tick whose transcript scan is not due, after the hinted and behind files, the sweep reads `$REG/*.uuid`. It then lstats the live main-thread files of those uuids, each uuid's newest recorded copy first, at most `ACTIVE_STAT_MAX` (256) a tick. It takes each file whose identity, size or mtime changed since it was last examined, as lib's pure `decideActiveRead` rules.
- **Task 3 (`deploy/measure-history.py`).**
  - W1-f counts only the greps that ran to an answer (exit 0 or 3), optionally from `--w1f-since`.
  - W1-b leaves out a tick whose predecessor (by time) ended behind: the tick that finishes a backlog.
- **Task 4.** The carries owed by "the next wave that edits `ccd/history/sweep.mjs`" (reviews 987 and 999), and by "the next wave that edits `ccd/history/lib.mjs`" (review 964).

**Tech Stack:** Node ESM (`ccd/history/*.mjs`), `node:sqlite` (FTS5, window functions), Python 3 `sqlite3` (window functions, SQLite 3.25 or later), vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`:
- §2 item 1 (:172), the capture goal;
- §9.2 step 2 (:2067), the discovery sources;
- §10.2 (:2747-2748), the W1-b and W1-f queries;
- §10.7's W1-b and W1-f rows (:2896, :2900);
- C27 (:1972), scope before LIMIT.

This wave does not edit the spec. "Not in this plan" names each sentence the coordinator corrects in a docs PR after the merge.

## Measured before dispatch

The coordinator's investigation measured these on 2026-10-27, read-only (`mode=ro`, `query_only`, nice and ionice, under a timeout), on the session-hosting node's live store. They are the coordinator's figures. No worker step reads a live store.

**W1-f.**
- `recall_calls` held 211 grep rows with `arm IS NULL`: rc 0 = 96, rc 7 = 99 (every one an `fts-pending` refusal, 36-375 ms), rc 3 = 14, rc 2 = 2.
- After the FTS merge completed, rc 0 and 3 gave n 67 and **p95 2,567 ms**. rc 0 alone gave n 58 and p95 2,609 ms.
- First grep after 5 minutes idle: p50 1,927 ms and p95 7,237 ms. Within 5 minutes of a previous call: p50 479 ms.
- Shipped shape, one scope of 107 entries:
  - `"rollout"` (23,766 matches box-wide, 0 in scope): 5,046 ms cold, 575 ms warm;
  - `"error"` (96,708 matches, 2 in scope): 5,395 ms cold, 869 ms warm.
- Scope-first form (entries by `entries_ts` on `transcript_pk IN …`, blob tested against the match), run cold: `"migration"` 64 ms, `"commit"` 146 ms, with the same 7 rows as the shipped shape. That figure covers the entries arm alone. `entry_variants` (4,650 rows) and `sidecars` (6,298 rows) are small.
- The match alone over 96,708 matches costs 6-62 ms. Adding `rank` over 23,766 matches costs 692 ms cold and 48 ms warm.
- `ms` is timed from `readVerb`'s entry, so node's own start is not counted. The FTS index is merged (8 segments, one of them at level 64): no `optimize` is missing.

**Synthetic, from the plan review (2026-10-27).** In-memory stores with the real indexes, warm, under `node:sqlite`. No live store.
- Large scopes, 1M entries:
  - a rare term (5 matches): scope-first 1-3 ms over a 10k-entry scope, 7-12 ms over 50k and 33-39 ms over 200k, against about 0 ms blob-first;
  - a common term (100k matches): scope-first 62-105 ms, blob-first 260-300 ms.
  - So scope-first loses only on a rare term, and stays far under 2 s. One driver is kept (Decision 1). Cold-cache cost is not measured.
- The rank forms, over 200k `blobs_fts` rows with 20k global matches:

  | Form | 20 in scope | 200 in scope | 2,000 in scope |
  |---|---|---|---|
  | `rk` with `rowid IN (SELECT blob_id FROM refs)` | 14 ms | 140 ms | 1.4 s |
  | correlated `rowid = r.blob_id` | 13 ms | 135 ms | 1.3 s |
  | the global rank CTE joined on `blob_id` | 2 ms | 3 ms | 6 ms |

  - The first two cost about 0.7 ms per in-scope blob: FTS5 frees bm25's cached IDF on every xFilter, so each lookup recomputes it over the phrase's whole doclist. The plain global rank alone read 25-45 ms warm on the same store, which the table's last row does not explain. Task 1 Step 3c re-measures the three forms and takes the cheapest (Decision 2).
- A `sqlite_stat1` row for `entries_ts` (written by the writer's closing `PRAGMA optimize`, or by `ANALYZE`) makes the planner cost a family IN-list above a full scan: the scope-first arms then plan as `SCAN entries` unless `INDEXED BY entries_ts` names the index (Decision 1).

**The cap (the coordinator, read-only, 2026-10-27).** The figures Task 2's cap rests on:
- `$REG` named 81 `*.uuid` files, all 81 valid uuids. `activeRows` (Task 2 Interfaces) over them answered 273 rows in 2.7 ms: 257 files with a path under a home's `projects/`, held by 79 uuids. 36 uuids hold one copy; the most any holds is 16.
- In `activeRows`' order the 79 newest copies end at position 79. A cap of 64, the draft's, would leave out the newest copies of the 15 longest-idle sessions on every tick, which is the case Decision 5 exists for.
- One lstat of all 257 files took 2.1 ms, and 0.8 ms warm. None was missing; 9 had an mtime within 5 minutes and 12 had a recorded mtime that differed from the file's.
- So `ACTIVE_STAT_MAX` is 256 (*chosen*: about three times today's 79), the coordinator's ruling.

**W1-b.**
- 697 ticks from 10-26T06:20Z: lag p50 201 s, **p95 1,331 s**. Tick spacing p50 120 s, p95 137 s.
- Of the 289 ticks with lag over 4 min, all 289 captured main-transcript rows that were on disk while at least one earlier tick skipped the file (median 3 ticks skipped, max 165).
- The oldest new row was a user prompt in 165 of them: the turn's start.
- From the hint line to the start of the first later tick with `files_behind = 0`: p50 65 s, **p95 121.5 s**. Charging a whole extra tick as an upper bound: p95 265 s.
- `files_behind` was 0 on 684 of 697 ticks. The sweep is not falling behind. It is not looking.

## Global Constraints

- **Timing (R-B2).** This PR merges and releases before W2's act 6, and its release is the final W2 release. No install happens from act 6 to act 28.
  - It may change W2's `gate_code` files: `ccd/history/lib.mjs` and `deploy/measure-history.py` change here, so their sha256s change. No part 1 exists yet. The coordinator records the new shas at W2's open (PR body, "Steps for the coordinator").
- **Nothing W2 scores or emits changes.**
  - `measure-history.py`'s `w2` and `census` outputs stay byte-identical: Task 3 case (e), Task 3 Step 5's base-against-new run on the same stores, and its diff-hunk census.
  - What W2 reports but never scores reads this release's capture: `deploy/history-counters.mjs`'s per-window lag, `card_served` and `card_id_mismatch` (spec §10.2, :2742). Their code is untouched, and their values move (Residuals named).
  - grep's rows, order, snippets and counts stay identical, with or without the as-of cut: Task 1 cases (b), (c) and (g).
  - `deploy/history-gate.mjs`, `deploy/history-replay.mjs`, `deploy/history-counters.mjs`, `ccd/history/card.mjs`, `ccd/history/derive.mjs`, `ccd/history/cli.mjs`, `ccd/history/regex-worker.mjs` and `ccd/session-hook.sh` are not touched.
  - lib's `asOfEntrySql` and `asOfBinds` (the cut's one spelling) are not edited. Task 1 splices them where the shipped arms splice them.
  - The card line's grammar is untouched.
- **No schema change, no new counter, no new hook spool line, no new ccd verb.** `SCHEMA_VERSION`, `ticks` and `recall_calls` keep their columns.
- **The 30-minute scan and the hint path are unchanged.** `SCAN_INTERVAL_MS`, `hintedUuids`, `behindFiles`, `discoverTranscripts*` and `knownUuids`' answer are unchanged. On a scan tick the new pass does not run at all.
- **One definition.**
  - `ACTIVE_STAT_MAX = 256` (*chosen*: about three times the 79 registered uuids that hold a live main file today; Measured before dispatch) and `decideActiveRead` are exported once from `lib.mjs`, declared in `lib.d.mts` and imported by `sweep.mjs`. Tests read them from lib.
  - `W1F_SEARCH_RCS = (0, 3)` is a twin of lib's `EXIT.OK` and `EXIT.NOT_FOUND`, spelled once in `measure-history.py` because that file imports nothing from lib, as `RECALL_OFF_META` is. `measure-history.test.ts` holds the two equal.
  - Which sorts read `rank` is derived from `ftsOrderBy`'s own text, never a second list of sorts.
- **Files.** Exactly those in the Files table. Never `shared/**`, `.github/**`, the spec, the decisions document, the programme ledger, `README.md` or `CLAUDE.md`. In-place edits of earlier cases are made only where Task 1 Step 3b (F7's name list) and Task 4 license them.
- **D-numbers.** This wave was issued six numbers. This plan defines five, each first cited in the task that needs it. One stays unwritten. A further departure is a stop: mail the coordinator.
- **Fixtures.** Synthetic `/home/u`-style paths and the tests' own harness only. No private name, host or absolute home path.
- **Live safety.**
  - Fixture homes and fixture stores only (`makeHistoryBox`, `IX.newBox`, `createStore` in a temp home). `ccd` and the sweep run only against a fixture `HOME`.
  - Never run the sweep, the shim, the CLI, any history verb or `measure-history.py` against the live `$HOME`, `~/.ccrc`, `~/.cc-sessions` or a live store.
  - The binaries a test spawns are the harness's stubs (it poisons tmux, gh, ssh and curl).
- **Suites.** Run them from `server/`, in the foreground, one per call, with a timeout of at least 600000 ms. Use `./node_modules/.bin/vitest run <file> -t "<filter>"`, never bare `npx vitest`.
  - Every recorded run, red or green, notes "N passed, M failed, 0 skipped" with N + M equal to the cases its filter is meant to select. A filter that selects nothing, or any skipped case on Linux, is a stop.
- **The one-mutant procedure.** Each `json mutants` entry is run alone, in order, never two at once (the suites share fixture state):
  1. `cp <file> <scratch>/<id>.orig`, and record its `sha256sum`.
  2. Replace `anchor` with `repl` using a short script run under `node` that refuses unless `anchor` occurs exactly once in the file. `anchor` and `repl` are JSON strings: `\n` is a newline and `\\` is one backslash.
  3. Run `timeout -k 10 900 ./node_modules/.bin/vitest run test/<suite> -t "<select>"` from `server/`, in the foreground, in a shell under `ulimit -u 4096`.
  4. Record the first failing assertion's message. It must name what `red` names, and it must come from the named case, never from a describe's `beforeAll` or hook.
  5. Restore with `cp <scratch>/<id>.orig <file>`. Then `cmp` must be silent and the sha must equal the one recorded. Never restore with `git checkout`.
  6. A mutant that stays green is a stop: mail the coordinator with the run's output. The one exception is T1-M4b and T1-M4c (Task 1 Step 5).
- **Peers.** Wave 5h's hot files are `ccd/history/*.mjs` and the history tests (the ledger's "Peers"). Re-anchor every line citation by content on your base. Citations are `origin/main`'s at `5d3c6d25a`.

## Decisions

Each decision names its pin and its CONTROL.

1. **The arms are driven from the scope (Task 1).**
   - Each arm carries `<table>.transcript_pk IN (SELECT value FROM json_each(:tpks))`: `e` for the entry and variant arms, `s` for the sidecar arm.
   - Each arm carries `+<blob column> IN (SELECT blob_id FROM m)`, where `m` is the match's blob ids with no rank.
   - The entry and variant arms read `entries` as `(SELECT <cols> FROM entries INDEXED BY entries_ts) AS e`, through a new optional last argument of `versioned` (the `INDEXED BY` precedent is sweep.mjs's D-5018).
   - The unary `+` takes `entries_blob`, `entries_blob_prov`, `entry_variants_blob` and `sidecars_blob` out of the planner's choices. It does not force `entries_ts`: with an `entries_ts` row in `sqlite_stat1` the planner costs a family IN-list above a full scan and plans `SCAN entries` (Measured before dispatch). The writer's closing `PRAGMA optimize` writes that row, so a store holds it before any `ANALYZE`. `INDEXED BY entries_ts` makes the scope drive the entry and variant arms whatever the statistics say. The sidecar arm already plans on `sqlite_autoindex_sidecars_1 (transcript_pk=?)`.
   - One driver, never a per-call choice between scope-first and blob-first. Scope-first loses to blob-first only on a rare term over a large scope, by tens of ms (Measured before dispatch), far under the 2 s target.
   - `GREP_FILTER` loses its transcript term. Its other terms stay as they are, outside the arms, before the ORDER BY and the LIMIT (C27 kept).
   - Pins:
     - case (b) is an equivalence against the shipped statement over every sort, four scopes (one empty), filters and every LIMIT boundary;
     - case (f) is the plan pin: `entries_ts (transcript_pk=?)` appears, and no blob-led index does. Its CONTROL is the shipped statement's plan, which names `entries_blob` or `entries_blob_prov`. It is pinned as built and again, on a fresh reader, after `ANALYZE`.
2. **Rank only where it is read (Task 1).** `rankedSql` joins `rk` only when `/\brank\b/` matches `ftsOrderBy(sort, 'r.ts_ms')`. Its form is the cheapest of three that Step 3c measures:
   - the global rank CTE, `rk(blob_id, rank) AS (SELECT rowid, rank FROM blobs_fts WHERE blobs_fts MATCH :q)`, joined `JOIN rk ON rk.blob_id = r.blob_id` (Step 3b's default form, and the review's measured cheapest);
   - the in-scope form, the same CTE with `AND rowid IN (SELECT blob_id FROM refs)`;
   - the correlated form, `(SELECT rank FROM blobs_fts WHERE blobs_fts MATCH :q AND rowid = r.blob_id) AS rank` as a selected column, which `rankedAndCounted` strips with `total`.
   - BM25 depends on the row and the table's own statistics, never on which other rows are read, so every form's rank equals the global match's. The equivalence pins that for relevance and hybrid.
   - `rank` is never a column of a pooled row: the pool keeps exactly the shipped nine columns.
   - Pin: case (e). The recency statement holds no `rank`. CONTROL: the relevance and hybrid statements hold it.
3. **The count rides in the ranked statement (Task 1).** `count(*) OVER () AS total` counts every in-scope, filtered referrer before ORDER BY and LIMIT. `rankedAndCounted` reads it from the first row, as 0 when there is no row, and strips it from each pooled row. `countSql` is deleted.
   - Pins: case (d) (one prepared statement carries `blobs_fts MATCH` per grep), and case (b) at every pool size from 1 to the total plus 1. CONTROL: at a pool below the total, the oracle's total exceeds the pool's length.
4. **Test seams (Task 1).** `rankedAndCounted`, `FTS_MATCH` and `REGEX_MATCH` are exported, each documented as a test seam (the `leafHeads` precedent). Nothing else of `recall.mjs` is exported.
5. **Which files a tick stats mid-turn (Task 2).**
   - The registered uuids are the values of `$REG/<id>.uuid` now, read by `registeredUuids(home)`: `knownUuids`' registry half, factored out with its answer unchanged.
   - Of those uuids, the tick takes the live main-thread ingest rows (`agent_id = ''`, `source_key = ''`, `status = 'live'`). They are ordered each uuid's newest copy first: by `DENSE_RANK() OVER (PARTITION BY t.cc_session_uuid ORDER BY f.mtime_ns DESC, f.file_id)`, then recorded `mtime_ns` DESC, then `file_id`.
     - Why the partition: a uuid holds one live main copy per home its swaps carried it to (`ingest_files` is unique by dev, ino and source key). Ordered by recorded mtime alone, the stale copies of other uuids would sit ahead of an idle-then-active session's only copy, whose recorded mtime is hours old, and the cap would drop exactly the session this rule is for.
   - It takes one path per file, the first under a rostered home's `projects/` (Interfaces' `activeFiles`). A path already taken this tick (hinted or behind) is neither stat'ed nor counted.
   - At most `ACTIVE_STAT_MAX` lstats a tick. A row past the cap waits for its Stop hint or the scan, whose bound is unchanged. The cap counts files, not sessions. 256 is *chosen*: about three times the 79 uuids that hold a live main file today, so every uuid's newest copy is stat'ed before any older copy (Measured before dispatch).
   - Why registered rather than recently grown: a session idle for hours that starts a long turn has no recent growth. The registry names it.
   - Pins: cases (b), (c), (e), (p) and (q). CONTROL in (c): an unregistered uuid's growth waits for the scan, and the next due scan reads it.
6. **What counts as changed (Task 2).** lib's pure `decideActiveRead` answers `'skip'`, `'read'` or `'same'`, in this order:
   - `'skip'`: no stat, or not a regular file (lstat never follows a link);
   - `'read'`: dev or ino differ from the row (bindFile decides a retire);
   - `'read'`: size below the cursor (bindFile rescans, counts `source_shrank`);
   - `'read'`: mtime differs from the one recorded (a null recorded mtime differs);
   - `'read'`: size above the recorded size (null reads 0) while the file is fresher than `TORN_STALE_MS`. This is growth inside one coarse mtime tick. A stale torn tail is not re-read every tick;
   - else `'same'`.
   - A vanished path or a link is skipped silently. It is not counted `file_missing`, the row is not marked gone, and the hint and the scan own it.
   - A regular file whose open or read fails (EIO, an admission refusal) records no examined row, so its recorded mtime never moves and it answers `'read'` on every non-scan tick. Each such tick counts it again (`file_unreadable` or the admission word) and adds its uuid to the card's `skipped` set (D-5061's arm `copy`), as a behind file that fails already does. That is retry by design (D-4340), and it is named in Residuals; D-4340's "a hint-only file waits for its next hint or the next due scan" no longer holds for a registered uuid's file.
   - Pins: lib case (a)'s table, and cases (f) to (i). CONTROL: each row of the table flips with one input.
7. **Where the pass runs (Task 2).**
   - Only on a tick whose transcript scan is not due (`!scan`), and only while discovery is still `complete`.
   - It runs after the behind files, so a backlog keeps its place, and before the scan's group.
   - Before each lstat it asks `budgetLeft(budget)`. A spent budget ends the pass with `complete` false, as a cut listing does (D-6938).
   - A due scan that its budget cuts leaves `scan_discover_ms` unset, so the scan stays due and the pass does not run on the ticks that follow until a scan completes. Those ticks' scans read what they reach. Named in Residuals; no code here.
   - Its files do **not** add their uuids to the sidecar half's share (`take(a.files, false)`). Each uuid in that share costs `listSidecars` over every rostered home's `projects/` and slug directories and an lstat per existing sidecar, and paying that on every mid-turn tick would put an unbounded cost outside `ACTIVE_STAT_MAX`. A sidecar written mid-turn waits for its Stop hint or the scan, as before this wave. W1-b measures transcript rows only, and `notCaughtUp` already holds a sidecar until its transcript is caught up.
   - Seams on the ingest context (D-4247): `activeStat(path)` and `activeStatMax`, defaulting to the module's lstat and lib's constant.
   - Pins: cases (a), (d), (j) and (l). CONTROL in (d): the same box on a non-scan tick stats. CONTROL in (l): the next due scan stores the sidecar.
8. **W1-b's measure (Task 3).** A tick counts only if it and its predecessor (by `ts_ms`, then `tick_id`) both ended with `files_behind = 0`, through `LAG(files_behind) OVER (ORDER BY ts_ms, tick_id)` over every tick, before the week's filter. The store's first tick has no predecessor and does not count.
   - The investigation's "hint-to-capture" redefinition is not taken. With Task 2 the row-to-capture lag is what §2 item 1 asks for.
   - Pins: Task 3 case (d), with ticks inserted out of time order and an in-window first tick, and case (f), an in-window tick whose predecessor lies outside the week. CONTROL in (d): without the rule, the backlog-ending tick would be the p95.
9. **W1-f's measure (Task 3).**
   - Only rc 0 (OK) and rc 3 (NOT_FOUND) count: a search that ran to its answer. Refusals (2, 7) and failures (1) are left out.
   - `--w1f-since MS` (optional, default 0) and `--now` bound the window: `since <= ts_ms <= now`.
   - No key is added to the report.
   - Pins: cases (a) to (c). CONTROL in (a): the p95 over every grep row differs.
10. **Not changed.**
    - `recall_calls.ms` keeps its clock (from `readVerb`'s entry). A change there is a change to what the spool line carries.
    - W1-e.
    - `examineUuids`, which is not on the tick's path.
    - Any hook.
11. **Review 964's two `lib.mjs` comment carries are taken (Task 4).** The ledger binds them to the next wave that edits `lib.mjs`, and this wave does. They are comments only.

## Review Focus

1. **The equivalence is against the shipped text.**
   - The oracle in `history-recall.test.ts` is `origin/main`'s `referrerSql`, `rankedSql` and `countSql`, copied at the current schema.
   - Its match texts are `origin/main`'s `FTS_MATCH` and `REGEX_MATCH`, rank included.
   - Its cut splices come from lib's own `asOfEntrySql`.
   - It is never a second implementation. **Task 1, Step 1.**
2. **Every arm is scoped.** An out-of-scope transcript holds a matching entry, a variant and a sidecar that shares an in-scope blob, and none of them reaches a family's pool. **Task 1 (b); mutants T1-M5 and T1-M6.**
3. **The plan, as built and after `ANALYZE`.** **Task 1 (f); mutants T1-M4, T1-M4b and T1-M4c.**
4. **The scan tick is untouched, and the cap is a cap.** **Task 2 (a), (d), (e) and (q); mutants T2-M2, T2-M3, T2-M14 and T2-M15.**
5. **A stale torn tail and a link are not re-read.** **Task 2 (h) and (i); mutants T2-M5 and T2-M8.**
6. **`w2` and `census` are byte-identical.** **Task 3 (e), Step 5's base-against-new run, and its hunk census.**

## Files

| File | Change |
|---|---|
| `ccd/history/recall.mjs` | Task 1: `FTS_MATCH` and `REGEX_MATCH` (no rank; exported), a module-private `SCOPE_IN`, `GREP_FILTER` without its transcript term, `versioned`'s optional `indexedBy`, `referrerSql`'s three arms scope-first, `rankedSql` with `rk` and the window count, `countSql` deleted, `rankedAndCounted` exported. Its section comment and the docs of each are updated. |
| `ccd/history/lib.mjs` | Task 2: `ACTIVE_STAT_MAX` beside `SCAN_INTERVAL_MS` (about :269), and `decideActiveRead` beside `lagOfTick` (about :3580). Task 4: the doc carries (999 F4, 964). |
| `ccd/history/lib.d.mts` | Task 2: `export const ACTIVE_STAT_MAX: 256;` and `decideActiveRead`'s signature. |
| `ccd/history/sweep.mjs` | Task 2: the lib import, `registeredUuids` (out of `knownUuids`, about :1807), `statActive`, `tickStmts`' `activeRows`, `activeFiles`, `candidateFiles`' new group (about :5100), `makeIngestCtx`'s two seams (about :4968), and the tick's discovery comment (about :3739). Task 4: `ingestSidecar`'s `let make` comment (about :5669) and the 999 F4 comments. |
| `ccd/history/store.mjs` | Task 4: `compressFdRange`'s piece allocated inside its `try` (about :1064). |
| `deploy/measure-history.py` | Task 3: `W1F_SEARCH_RCS`, `W1B_SQL`, `W1F_SQL`, `--w1f-since`, the two queries, and the docstring's usage line and its `w1b_lag_p95_ms` and `w1f_grep_p95_ms` entries. |
| `server/test/history-recall.test.ts` | Task 1: the oracle (`SHIPPED_SQL`, `shippedPool`, a local `bindFor`) at module scope beside `GRX`, a new describe, case (f) nested at the end of the C27 describe (about :1512), case (g) nested at the end of the W2-D36 describe (about :6001), and F7's name list (about :1693) edited in place. `GrepMod` gains the three seams. |
| `server/test/history-ingest.test.ts` | Task 2: a new describe. Task 4: cases (h), (i) and carry (o) at the end of the CP-39b describe (about :2980), carry cases (m) and (n) after O2b (about :961), and DM47's case in place (about :1753). |
| `server/test/history-lib.test.ts` | Task 2: case (a). |
| `server/test/measure-history.test.ts` | Task 3: a new describe. |
| `server/test/history-export.test.ts` | Task 4: case (g) at the end of CP-39c Task 1's describe (about :3907), and E2's comment line (about :2232). |
| `docs/superpowers/plans/2026-10-27-ccrc-history-cp39d-w1-grep-and-lag.md` | This plan. |

## Not in this plan

- **The spec sentences: the coordinator's docs PR after the merge.** Each correction is in place and line-neutral, because spec line citations are pinned.
  - §9.2 step 2 (:2067), "Sources: spool hints from confirmed sids, plus a periodic scan (every 30 min, *chosen*)." It gains: "and, on a tick whose scan is not due, the files of the uuids `$REG/*.uuid` names whose identity, size or mtime changed since the sweep last examined them, at most `ACTIVE_STAT_MAX` (256, *chosen*) lstats a tick, each uuid's most recently recorded copy first", citing Task 2's departure.
  - The schema block's index comment (:815), `CREATE INDEX entries_blob ON entries(blob_id); -- FTS hit -> scope join`: the comment becomes "-- a blob's referrer probes; grep drives each arm from entries_ts (D-7095)", citing Task 1's departure. The column alignment of the line is kept.
  - §10.2 (:2747), W1-b's query: "with `files_behind = 0`" becomes "with `files_behind = 0` on the tick and on the tick before it, by time", citing Task 3's W1-b departure.
  - §10.2 (:2748), W1-f's query: "over `verb = 'grep'` rows with `arm IS NULL`" becomes "over `verb = 'grep'` rows with `arm IS NULL` and `rc` 0 or 3, from `--w1f-since` to `--now`", citing Task 3's W1-f departure.
  - §10.7's W1-b row (:2896), measure column: "`ticks.lag_ms` with `files_behind = 0`" becomes "`ticks.lag_ms` with `files_behind = 0` on the tick and its predecessor".
  - §10.7's W1-f row (:2900): no change. "By §10.2's query" carries it.
  - The errata list and the §16 rows: one per departure this plan defines (Deviations found), each with its class.
- The programme ledger: closing the carries Task 4 takes, and recording the new `gate_code` shas.
- `recall_calls.ms` from process start; any argument on the spool line.
- A pass-end time in `ticks` (a schema change).
- W1-e.
- The investigation's measure-only W1-b erratum ("hint-to-capture"). Decision 8 says why.

---

### Task 1: grep drives each referrer arm from its scope (D-7095)

**Files:** `ccd/history/recall.mjs`, `server/test/history-recall.test.ts`.

**Interfaces:**
- Consumes:
  - `bindFor`, `cutAnd`, `cutTerm`, `cutBinds`, `grepParams`, `runGrep` and `runRegex`, unchanged;
  - lib's `ftsOrderBy`, `asOfEntrySql`, `asOfBinds`, `RANK_POOL`, `SEARCHABLE_PROVENANCE`, `INDEXED_PROVENANCE`, `selectColumns` and `SCHEMA_ADDED`;
  - the test file's `GRX` (`seed`, `rc`, `recall`, `grepArgs`, `spyDb`, `cli`), `rH.seedFamily`, `rH.plantTranscript`, `rH.openStoreRO`, and the W2-D36 describe's `cut`, `withCut` and `both`.
- Produces:
  - `export const FTS_MATCH = 'SELECT rowid FROM blobs_fts WHERE blobs_fts MATCH :q';`
  - `export const REGEX_MATCH = 'SELECT value FROM json_each(:blobs)';`
  - `function versioned(rc, table, alias, cols, indexedBy = null)`: with `indexedBy` it answers `(SELECT <cols> FROM <table> INDEXED BY <indexedBy>) AS <alias>`; without it, the shipped text exactly. Every existing caller passes four arguments and is unchanged.
  - `referrerSql`'s entry helper, exactly `const e = (alias) => versioned(rc, 'entries', alias, REFERRER_ENTRY_COLS, 'entries_ts');`. The sidecar arm's `se` stays `versioned(rc, 'entries', 'se', …)` with no index named.
  - `export function rankedAndCounted(rc, matchSql, sort, all) -> { pool, total } | { result }`. Its contract is unchanged: `pool` rows carry exactly the shipped nine columns, and `all.pool` is at least 1, since the count rides on the first row.

- [ ] **Step 0: Check the base, then record the oracle (no edit).**
  - `git grep -n "WITH m(blob_id, rank) AS" HEAD -- ccd/history/recall.mjs` prints one line. `git grep -n "function countSql" HEAD -- ccd/history/recall.mjs` prints one line. `git grep -n "function exportPassSlice" HEAD -- ccd/history/sweep.mjs` prints one line (CP-39c is on the base). `git grep -n "const e = (alias) => versioned(rc, 'entries', alias, REFERRER_ENTRY_COLS);" HEAD -- ccd/history/recall.mjs` prints one line. `git grep -n "'rankedSql', 'countSql', 'GREP_FILTER'" HEAD -- server/test/history-recall.test.ts` prints one line (F7's name list). If any differs, stop and mail the coordinator.
  - Print `git show origin/main:ccd/history/recall.mjs` from `const FTS_MATCH` through `countSql`'s end, and `REGEX_MATCH`'s line. These are the oracle's source.

- [ ] **Step 1: Write the cases.** Add `describe('CP-39d: grep drives each referrer arm from its scope (D-7095)')` after the C27 describe. Skip it on darwin, as its neighbours do. Prefix each case title with its letter. Fixture prefixes start `ccrc-hist-cp39d-`. Its `beforeAll` (the box and its sweeps) carries a 240_000 ms timeout, as C27's does.
  - **The oracle, at module scope.** `SHIPPED_SQL` (Step 0's text), `shippedPool` and a local copy of `bindFor`'s rule are declared at module scope beside `GRX`, never inside a describe, so the new describe, (f) in the C27 describe and (g) in the W2-D36 describe all call them. Their doc comment names the commit they were copied from (`5d3c6d25a`, or the base Step 0 checked).
    - `shippedPool(db, match: 'fts' | 'regex', sort, all, cut: boolean)` prepares Step 0's text, with these substitutions only:
      - each `versioned(rc, T, A, cols)` becomes `(SELECT <cols> FROM T) AS A`, the form `selectColumns` gives at the current version. Assert that once against `libRead.selectColumns`;
      - each `cutAnd(rc, a)` becomes `` ` AND (${asOfEntrySql(a)})` `` and each `cutTerm(rc, a)` becomes `` `(${asOfEntrySql(a)})` `` when `cut`, each `''` otherwise, with lib's own `asOfEntrySql`. The sidecar arm's `WHERE` keyword stays conditional on `cut`, as `referrerSql` spells it;
      - the ranked and count statements' binds go through the local copy of `bindFor`'s rule.
      It answers `{ pool, total }`.
  - **Deep-equal** in every case below is `toEqual`, never `toStrictEqual`: `node:sqlite` rows have a null prototype, and the rewritten code's rest-spread rows do not.
  - **The box.** One box, swept twice, planted with:
    - A (`GRX.idA`, project `demo`, workdir `GRX.W`). Twelve rows with the word `zqeq`, as users and assistants, with BM25 spread by repeat counts. Two pairs carry an equal timestamp and an equal body length, which gives ties. One tool_use and tool_result pair carries `zqeq`.
    - B (`GRX.idB`, project `demo`, workdir `/home/u/worktrees/p/zqeq-b`). Six rows with `zqeq`.
    - O (`GRX.idO`, project `other`). Three rows with `zqeq`.
    - A second copy of A's and of B's transcript under `claude-b`, each differing in one `zqeq` row, so each holds a variant referrer.
    - Sidecars: in A, three byte-identical `zqeq` sidecars (one blob, three referrers, as the F4 describe ties them) and one unique one. In B, one sidecar byte-identical to A's shared one.
    Then:
    - CONTROL: A, B and O each hold a variant and a sidecar referrer, and the shared sidecar blob has referrers in A and in B.
    - CONTROL: `SELECT count(*) FROM blobs_fts WHERE blobs_fts MATCH 'zqeq'` is above the family scope's oracle total.
  - **The scopes.** Each is `GRX.rc(box, GRX.idA)` with `scope.transcriptPks` replaced: family `[A]`, project `[A, B]`, `[B]` alone (a scope that holds B but not the family), and the empty scope `[]`. Each is read from the store's `transcripts` by uuid.
  - **The params.** As `grepParams` builds them: `q` is `libRead.sanitizeFtsQuery('zqeq')`, `provs` is `SEARCHABLE_PROVENANCE`, `now_ms` is fixed, and `pool` is set per case.
  - (a1) The seams exist: `typeof recall.rankedAndCounted` is `'function'`, and `recall.FTS_MATCH` and `recall.REGEX_MATCH` are strings.
  - (a2) `recall.FTS_MATCH` and `recall.REGEX_MATCH` equal the two strings in Interfaces, with no rank column.
  - (b) For each sort in `GREP_SORTS`, each scope, and each filter set:
    - the filter sets are none; `role: 'user'`; `tool` set to the planted tool_use's name; a `since`/`before` window cutting the ties; `nodes` holding a subset of A's entry ids; and `provs` set to `INDEXED_PROVENANCE`;
    - the pools are `RANK_POOL` and every `k` from 1 to the oracle's total plus 1;
    - `recall.rankedAndCounted(rc, recall.FTS_MATCH, sort, all)` deep-equals `shippedPool(rc.db, 'fts', sort, all, false)`.
    CONTROL, per sort, for the family scope with no filter: for some `k` with `2 <= k` below the oracle's total, the oracle's rows `k - 1` and `k` (0-based) tie on that sort's key (`ts_ms` for recency, `rank` for relevance, the hybrid expression's value for hybrid) and differ in `blob_id` or `ref_key`, so the pool at `k` cuts a tie. CONTROL: the empty scope's oracle total is 0.
  - (c) The regex arm. `all.blobs` is every blob id whose decoded text holds `zqeq`. For each scope and pool, recency only (runRegex's one sort), `rankedAndCounted(rc, recall.REGEX_MATCH, 'recency', all)` deep-equals the oracle's regex form.
  - (d) For each sort, `recall.runGrep({ ...rc, db: GRX.spyDb(rc.db, calls) }, grepArgs(['zqeq', '--sort', sort]))` exits 0, and exactly one prepared statement contains `blobs_fts MATCH`, counted over the entries of `calls` (spyDb pushes every prepare), never over a set of texts: `expect(calls.filter((s) => s.includes('blobs_fts MATCH'))).toHaveLength(1)`. That statement contains `LIMIT :pool`.
  - (e) In the same way: recency's ranked statement does not match `/\brank\b/`. CONTROL: relevance's and hybrid's do.
  - (f) Nested as the last case of the C27 describe, on its box (3,000 out-of-scope `zqneedle` rows in B), titled `CP-39d (f) …` so `-t` selects it. It runs last, so no earlier C27 case reads what it adds.
    - First it plants, in B: 300 variant referrers (a second copy of B's transcript in the other home, whose first 300 `zqneedle` rows differ in their text) and 300 `zqneedle` sidecars. Then it runs the describe's two sweeps again. CONTROL: B holds at least 300 `entry_variants` rows and 300 `sidecars` rows whose blob matches `zqneedle`.
    - For each sort, on a reader opened after those sweeps:
      - capture the ranked statement with `GRX.spyDb`;
      - run `EXPLAIN QUERY PLAN` on it with the same binds;
      - some `detail` matches `/USING (?:COVERING )?INDEX entries_ts \(transcript_pk=\?/`;
      - no `detail` matches `/\b(?:entries_blob|entries_blob_prov|entry_variants_blob|sidecars_blob)\b/`.
    - CONTROL: the oracle's ranked statement's plan matches `/\bentries_blob(?:_prov)?\b/`.
    - Then run `ANALYZE` through `store.openWriter` on the fixture store and close the writer. SQLite loads `sqlite_stat1` into a connection only when its schema cookie changes, so open a fresh reader (`GRX.rc(box, GRX.idA)`) and re-capture the ranked statement on it. CONTROL on that reader: `SELECT count(*) FROM sqlite_stat1 WHERE tbl = 'entries' AND idx = 'entries_ts'` is 1. Then repeat the pin and the oracle CONTROL on it.
  - (g) Nested at the end of the W2-D36 describe, titled `CP-39d (g) …`, through its `both`. For each sort, with the cut and without it, over the queries `zqcutpool`, `zqcutsidevis`, `zqcutsidehid`, `zqcutsideorphan`, `zqcutvarvis` and `zqcutvarhid`, at pools `RANK_POOL`, 1 and 2, `rankedAndCounted` deep-equals the oracle with the matching `cut`. The same holds for the regex form over every blob id.
    CONTROL: for `zqcutpool` the oracle's totals differ between the cut and none.
  - (h) Through the CLI: `grep zqeq --json`, then the same with `--project` and with `--workspace`, from A's pane. Each exits 0, and its `total` equals the oracle's total over that scope's transcripts. For the workspace, the test computes the transcripts from A's workdir.

- [ ] **Step 2: Run, and record the reds.** Run `-t "CP-39d: grep drives"`, then `-t "C27"` and `-t "W2-D36"`. Predicted:
  - (a1) red: `typeof recall.rankedAndCounted` is `'undefined'`;
  - (b), (c) and (g) red on `rankedAndCounted is not a function`;
  - (a2) red: `recall.FTS_MATCH` is undefined;
  - (d) red with `expected 2 to be 1`;
  - (e) red on recency;
  - (f) red at its first pin: no `entries_ts (transcript_pk=?)`, or a blob-led index, in the plan, while the CONTROL passes;
  - (h) green, a CONTROL of the fixture.
  F7 stays green here: `countSql` still exists. Record what is measured.

- [ ] **Step 3a: The seams alone.** Export `rankedAndCounted` and the two match constants, with no other change. Re-run the filters. Predicted: (a1), (b), (c), (g) and (h) green; (a2) red, because the exported strings are still the shipped ones with their rank column (`'SELECT rowid, rank FROM …'`, `'SELECT value, 0 FROM …'`); and (d), (e) and (f) red with Step 2's text. This proves the oracle equals the shipped code.

- [ ] **Step 3b: Scope first.**
  - `FTS_MATCH` and `REGEX_MATCH` lose their rank column (Interfaces). `const SCOPE_IN = 'IN (SELECT value FROM json_each(:tpks))';`. `GREP_FILTER` starts at `r.provenance IN …`.
  - `versioned` gains its optional `indexedBy` (Interfaces), and `referrerSql`'s `e` helper passes `'entries_ts'`.
  - `referrerSql`: `WITH m(blob_id) AS (${matchSql}),` and `refs(via, entry_id, uuid, transcript_pk, ts_ms, role, provenance, tool_name, blob_id, name, ref_key)`, with the arms spelled exactly so:
    - entry: `FROM ${e('e')} WHERE e.transcript_pk ${SCOPE_IN} AND +e.blob_id IN (SELECT blob_id FROM m)${cutAnd(rc, 'e')}`, projecting `e.blob_id`;
    - variant: `FROM ${e('e')} JOIN ${versioned(rc, 'entry_variants', 'v', ['entry_id', 'blob_id'])} ON v.entry_id = e.entry_id` then `WHERE e.transcript_pk ${SCOPE_IN} AND +v.blob_id IN (SELECT blob_id FROM m) AND v.blob_id <> e.blob_id${cutAnd(rc, 'e')}`, projecting `v.blob_id`;
    - sidecar: `FROM ${versioned(… 's' …)} LEFT JOIN ${versioned(rc, 'entries', 'se', …)} ON se.entry_id = s.entry_id` then `WHERE s.transcript_pk ${SCOPE_IN} AND +s.blob_id IN (SELECT blob_id FROM m)${cutAnd(rc, 'se')}`, projecting `s.blob_id`.
  - `rankedSql`:
    - `const order = ftsOrderBy(sort, 'r.ts_ms');` and `const readsRank = /\brank\b/.test(order);`;
    - when `readsRank`, append the global rank CTE of Decision 2 and `JOIN rk ON rk.blob_id = r.blob_id` (Step 3c may replace this form);
    - select the nine columns plus `count(*) OVER () AS total`;
    - `ORDER BY ${order}, r.blob_id, r.entry_id, r.ref_key LIMIT :pool`.
  - `rankedAndCounted`: exactly
    `const rs = rankedSql(rc, matchSql, sort);`, `const rows = rc.db.prepare(rs).all(bindFor(rs, all));`,
    `const total = rows.length === 0 ? 0 : Number(rows[0].total);` and `const pool = rows.map(({ total: _total, ...hit }) => hit);`.
    Its `no such table: blobs_fts` arm is unchanged.
  - Delete `countSql`. Rewrite the section comment (about :406-415) and each doc:
    - the scope term and the provenance filter still run inside the ranking statement, before its LIMIT (C27);
    - each arm is driven from the scope's transcripts through `entries_ts`, and its blob term carries a unary `+` (D-7095);
    - rank is read only by a sort that orders by it;
    - the total is the window count on the same rows.
  - **F7, in place (D-7095).** `history-recall.test.ts`'s F7 ("Task 12's module-private helpers keep their exact names, each declared once", about :1693) lists `'countSql'` and asserts `decl(n) === 1`, so deleting `countSql` turns it red. Its name list drops `'countSql'` and gains `'SCOPE_IN'` and `'REGEX_MATCH'`, with a one-line comment naming D-7095. Nothing else in F7 changes. This is the one in-place edit Task 1 makes.
  Re-run the three filters, and `-t "F7"`: all green. Predicted before the F7 edit: F7 red on `countSql: expected 0 to be 1`.

- [ ] **Step 3c: Measure the rank forms (no commit).** A scratch `node` script under your scratch directory, never in the repo, builds an in-memory `node:sqlite` store with an FTS5 `blobs_fts` of about 200,000 rows, about 20,000 of which match one term, and `entries` with the real `entries_ts` index. It times, warm, five runs each, the relevance statement with each of Decision 2's three `rk` forms at 20, 200 and 2,000 in-scope matches.
  - Use the form whose worst figure over the three sizes is lowest. Record the nine medians in D-7095's text and in Residuals ("The rank lookup").
  - If that is the correlated form, it is a selected `rank` column, and the pool line becomes exactly `const pool = rows.map(({ total: _total, rank: _rank, ...hit }) => hit);`. The pool keeps exactly the shipped nine columns. If `node:sqlite` refuses a form, record that and drop it.
  - Re-run the three filters after any change of form: all green.

- [ ] **Step 4: Run green.** One per call: `history-recall.test.ts` whole, `history-cli.test.ts`, `history-replay.test.ts -t "grep"`, the test typecheck (`./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit`), and `test/single-definition`.
  The F4 describe's pin (`ORDER BY … r.ref_key LIMIT :pool`, the `refs(… ref_key …) AS` list and the three arm literals) must stay green unedited.

- [ ] **Step 5: Mutants.**

```json mutants
[
  {"id": "T1-M1", "file": "ccd/history/recall.mjs", "suite": "history-recall.test.ts", "select": "CP-39d: grep drives.*\\(b\\)",
   "anchor": "const total = rows.length === 0 ? 0 : Number(rows[0].total);", "repl": "const total = rows.length;",
   "red": "(b) at a pool below the true count: total"},
  {"id": "T1-M2", "file": "ccd/history/recall.mjs", "suite": "history-recall.test.ts", "select": "CP-39d: grep drives.*\\(d\\)",
   "anchor": "const total = rows.length === 0 ? 0 : Number(rows[0].total);",
   "repl": "const total = rows.length === 0 ? 0 : Number(rows[0].total); rc.db.prepare(rs).all(bindFor(rs, all));",
   "red": "(d) expected 2 to be 1"},
  {"id": "T1-M3", "file": "ccd/history/recall.mjs", "suite": "history-recall.test.ts", "select": "CP-39d: grep drives.*\\(e\\)",
   "anchor": "const readsRank = /\\brank\\b/.test(order);", "repl": "const readsRank = true;",
   "red": "(e) recency's statement reads rank"},
  {"id": "T1-M4", "file": "ccd/history/recall.mjs", "suite": "history-recall.test.ts", "select": "CP-39d.*\\(f\\)",
   "anchor": "REFERRER_ENTRY_COLS, 'entries_ts')", "repl": "REFERRER_ENTRY_COLS)",
   "red": "(f) no entries_ts (transcript_pk=?) in the plan"},
  {"id": "T1-M4b", "file": "ccd/history/recall.mjs", "suite": "history-recall.test.ts", "select": "CP-39d.*\\(f\\)",
   "anchor": "AND +v.blob_id IN (SELECT blob_id FROM m)", "repl": "AND v.blob_id IN (SELECT blob_id FROM m)",
   "red": "(f) entry_variants_blob in the plan"},
  {"id": "T1-M4c", "file": "ccd/history/recall.mjs", "suite": "history-recall.test.ts", "select": "CP-39d.*\\(f\\)",
   "anchor": "AND +s.blob_id IN (SELECT blob_id FROM m)", "repl": "AND s.blob_id IN (SELECT blob_id FROM m)",
   "red": "(f) sidecars_blob in the plan"},
  {"id": "T1-M5", "file": "ccd/history/recall.mjs", "suite": "history-recall.test.ts", "select": "CP-39d: grep drives.*\\(b\\)",
   "anchor": "WHERE s.transcript_pk ${SCOPE_IN} AND +s.blob_id IN (SELECT blob_id FROM m)", "repl": "WHERE +s.blob_id IN (SELECT blob_id FROM m)",
   "red": "(b) family scope: B's sidecar referrer of the shared blob in the pool"},
  {"id": "T1-M6", "file": "ccd/history/recall.mjs", "suite": "history-recall.test.ts", "select": "CP-39d: grep drives.*\\(b\\)",
   "anchor": "WHERE e.transcript_pk ${SCOPE_IN} AND +v.blob_id IN (SELECT blob_id FROM m) AND v.blob_id <> e.blob_id",
   "repl": "WHERE +v.blob_id IN (SELECT blob_id FROM m) AND v.blob_id <> e.blob_id",
   "red": "(b) family scope: B's variant referrer in the pool"},
  {"id": "T1-M7", "file": "ccd/history/recall.mjs", "suite": "history-recall.test.ts", "select": "CP-39d.*\\(g\\)",
   "anchor": "AND +e.blob_id IN (SELECT blob_id FROM m)${cutAnd(rc, 'e')}", "repl": "AND +e.blob_id IN (SELECT blob_id FROM m)",
   "red": "(g) with the cut: a hidden entry referrer in the pool"}
]
```

  T1-M4, T1-M4b and T1-M4c may go red in (f)'s as-built half or only in its after-`ANALYZE` half. Record which. A mutant red only after `ANALYZE` is held; say so in D-7095's text. T1-M4 green in both halves is a stop.
  T1-M4b and T1-M4c green in both halves is **not** a stop (the coordinator's ruling, 2026-10-27). The plan check found T1-M4b probably equivalent: with `INDEXED BY entries_ts`, the variant arm planned `entries_ts`, then `entry_variants`' primary key on `(entry_id=? AND blob_id=?)`, with or without the `+`, before and after `ANALYZE`. The sidecar arm may behave the same way. For either mutant green in both halves:
  - keep the `+`. It removes the blob-led index from any plan the live statistics might choose, and case (f) still pins that none drives the arm;
  - paste that arm's plan rows from both halves into D-7095, and call the mutant equivalent there;
  - go on to the next mutant.

- [ ] **Step 6: Commit.** `perf(history): grep drives each referrer arm from its scope (CP-39d Task 1; D-7095)`

### Task 2: the sweep reads a registered session's mid-turn growth within a tick (D-7096)

**Files:** `ccd/history/lib.mjs`, `ccd/history/lib.d.mts`, `ccd/history/sweep.mjs`, `server/test/history-lib.test.ts`, `server/test/history-ingest.test.ts`.

**Interfaces:**
- Consumes:
  - `candidateFiles(db, ctx, scan, sideScan, budget)` (about :5100), `knownUuids` (about :1807), `readRegPresence`, `tickStmts`, `budgetLeft`, `TORN_STALE_MS` (about :4995), `makeIngestCtx`, `ingestTick`, `recordTick` and `ingestPath`, all unchanged in signature;
  - the test file's `IX` (`newBox` registers `claude-demo` on `IX.U`; `plantCopy`, `openFixtureStore`, `tsMs`, `jsonl`, `user`, `cursorOf`, `count`) and `plantSession`.
- Produces:
  - lib's `export const ACTIVE_STAT_MAX = 256;`;
  - lib's `export function decideActiveRead({ row, stat, nowMs, tornStaleMs }) -> 'read' | 'same' | 'skip'`, where:
    - `row` is `{ dev: bigint, ino: bigint, offset: number, size: number | null, mtimeNs: bigint | null }`;
    - `stat` is `{ isFile: boolean, dev: bigint, ino: bigint, size: number, mtimeNs: bigint } | null`;
    - its body is exactly these six lines, in order:
      `if (stat === null || stat.isFile !== true) return 'skip';`
      `if (stat.dev !== row.dev || stat.ino !== row.ino) return 'read';`
      `if (stat.size < row.offset) return 'read';`
      `if (stat.mtimeNs !== row.mtimeNs) return 'read';`
      `if (stat.size > (row.size ?? 0) && nowMs - Number(stat.mtimeNs / 1_000_000n) < tornStaleMs) return 'read';`
      `return 'same';`
  - in `sweep.mjs` (module-private unless named):
    - `registeredUuids(home) -> Set<string>`: `knownUuids`' registry loop, moved. `knownUuids` becomes its epochs query plus this set.
    - `statActive(path)`: `lstatSync(path, { bigint: true })` mapped to `stat`'s shape (`size` as a number), or null when it throws.
    - `tickStmts(db).activeRows`, with `setReadBigInts(true)`:
      `SELECT f.file_id AS fileId, f.dev AS dev, f.ino AS ino, f.offset AS offset, f.size AS size, f.mtime_ns AS mtimeNs, p.path AS path, t.cc_session_uuid AS uuid FROM transcripts t JOIN ingest_files f ON f.transcript_pk = t.transcript_pk JOIN file_paths p ON p.file_id = f.file_id WHERE t.cc_session_uuid IN (SELECT value FROM json_each(?)) AND t.agent_id = '' AND f.source_key = '' AND f.status = 'live' ORDER BY DENSE_RANK() OVER (PARTITION BY t.cc_session_uuid ORDER BY f.mtime_ns DESC, f.file_id), f.mtime_ns DESC, f.file_id, p.path`. SQLite admits a window function in ORDER BY; the review ran this ORDER BY under Python's `sqlite3` 3.45.1.
    - `activeFiles(db, ctx, seen, budget) -> { files, complete }`, Decisions 5 to 7. `activeRows` answers one row per path, so before its loop `activeFiles` keeps, in `activeRows`' order, one row per `fileId`: the first whose `path` lies under a rostered home's `projects/` (`behindFiles`' test). A file with no such path is passed over. Each file it takes is `{ path, uuid, home }`, as `behindFiles` builds it, since `ingestPath` admits through `f.home`. Its uuids are exactly `const uuids = [...registeredUuids(ctx.home)];`. Its stat is `ctx.activeStat ?? statActive` and its cap is `ctx.activeStatMax ?? ACTIVE_STAT_MAX`. For each row the loop carries exactly `if (seen.has(row.path)) continue;`, `if (statted >= max) break;` and `if (budget !== null && !budgetLeft(budget)) return { files, complete: false };`, in that order, before the lstat. It converts `offset` and `size` to numbers before calling `decideActiveRead`.
    - In `candidateFiles`, right after `take(behindFiles(db, ctx.homes), true);`, exactly:
      `if (!scan && complete) {` / `const a = activeFiles(db, ctx, seen, budget);` / `take(a.files, false);` / `if (!a.complete) complete = false;` / `}`. The `false` keeps these files' uuids out of the sidecar half's share (Decision 7).
    - `makeIngestCtx` gains `activeStat: statActive, activeStatMax: ACTIVE_STAT_MAX`, named in its doc as injected parts a test may replace in-process.

- [ ] **Step 0: Check the base (no edit).** `git grep -n "take(behindFiles(db, ctx.homes), true);" HEAD -- ccd/history/sweep.mjs` prints one line, and `git grep -n "const TORN_STALE_MS = SCAN_INTERVAL_MS;" HEAD -- ccd/history/sweep.mjs` prints one line. If either differs, stop and mail the coordinator.

- [ ] **Step 1: Write the cases.**
  - `history-lib.test.ts`, `describe('CP-39d: decideActiveRead (D-7096)')`.
    - (a) `lib.ACTIVE_STAT_MAX` is 256.
    - (a) The table, from one base row and stat, with `tornStaleMs = lib.SCAN_INTERVAL_MS`:
      - null stat, and `isFile: false`, answer `skip`;
      - another ino, another dev, a size below the offset, another mtime, and a null recorded mtime each answer `read`;
      - a size above the recorded size with a fresh mtime answers `read`;
      - the same with an mtime older than `tornStaleMs` answers `same` (a stale torn tail);
      - an equal stat answers `same`.
      CONTROL: each `read` row answers `same` with its one changed input restored.
  - `history-ingest.test.ts`, `describe('CP-39d: a registered session\'s transcript that grew mid-turn is read within a tick (D-7096)')`, skipped on darwin.
    - Each case: `IX.newBox('ccrc-hist-cp39d-…')`, `IX.openFixtureStore`, and `t0 = IX.tsMs(0) + 600_000`.
    - `tick(ms, patch?, budget = S.newBudget())` builds `S.makeIngestCtx(box.home, box.homes, ms, ids)`, applies `patch`, runs `S.ingestTick` on `budget` and then `S.recordTick`.
    - A Stop hint, where a case names one, is D-4340's in-process form: an empty `spool/.draining/<id>.<ts>.1.jsonl` under the box's history root, removed after the tick.
    - A counting stat is `ctx.activeStat = (p) => { stats.push(p); return real(p); }`.
    - The first `tick(t0)` is a scan tick, which reads `IX.U`'s planted rows. Every later tick at `t0 + 120_000` is not a scan tick.
    - Cases:
      - (a) The production wiring. `S.makeIngestCtx(box.home, box.homes, t0, ids).activeStatMax` is `lib.ACTIVE_STAT_MAX`, and its `activeStat` is a function.
      - (b) The defect. After `tick(t0)`, append two rows stamped `IX.ts(500)` and `IX.ts(501)`, with no draining file and no hint. CONTROL: the row's recorded size equals its offset, and `scan_discover_ms` reads `t0`. After `tick(t0 + 120_000)`: both rows are stored, the cursor is at the file's end, the new ticks row's `lag_ms` is `t0 + 120_000 - IX.tsMs(500)`, and its `files_behind` is 0.
      - (c) A second transcript, `IX.U2`, known to the store only through a confirmed epoch planted through the writer (a `sessions` row and an `epochs` row, as `measure-history.test.ts`'s fixture plants them), with no `$REG` entry. It is read at the scan tick and then appended. After `tick(t0 + 120_000)` its new row is not stored. CONTROL: after `tick(t0 + lib.SCAN_INTERVAL_MS + 1_000)` it is.
      - (d) On a scan tick the pass stats nothing. Append, delete meta `scan_discover_ms`, and tick with the counting stat: `stats` is `[]` and the rows are stored (by the scan). CONTROL: the same append on a non-scan tick pushes one stat.
      - (e) The cap. Register two more sessions with `plantSession`, each with its own uuid and transcript, all read at the scan tick. Then set the three rows' recorded `mtime_ns` in descending order through the writer, and append to all three. Tick with `activeStatMax: 2` and the counting stat. `stats` holds the two most recent paths only. The third's new row is not stored. CONTROL: the next due scan stores it.
      - (f) A shrink. Rewrite `IX.U`'s file in place, holding its first row only, so it is shorter than its cursor (same inode, same first line). After the non-scan tick, `source_shrank` is 1 and the file is read from 0.
      - (g) A rename and a vanish. A new file renamed over `IX.U`'s path (a new inode) is read on the non-scan tick. Then, with the path removed: `file_missing` is unchanged, the row's `status` stays `live`, and the stat was made.
      - (h) A link at `IX.U`'s path, pointing at a regular file holding a new row, is not followed. Nothing is stored, `non_regular` is unchanged, and the counting stat saw the path.
      - (i) A stale torn tail. Append `{"pad":"x` with no `\n`, then set the file's times to more than `lib.SCAN_INTERVAL_MS` before the tick's clock. Run a scan tick, then a non-scan tick 120 s later. The stat was made, and `file_paths.last_seen_ms` still reads the scan tick (no bind ran).
      - (j) A spent budget. After an append, `tick(t0 + 120_000, patch, S.newBudget(Date.now, { maxBytes: 0 }))`. `stats` is `[]`.
      - (k) Through the real sweep, with a 120_000 ms timeout. `IX.sweepTwice(box)`, then append a row stamped a minute before now with no spool line, then one more `runSweep`. The row is stored, and the last ticks row's `lag_ms` is at most 600,000 ms.
      - (l) A sidecar written mid-turn waits for its Stop hint or the scan. Append a tool_result row naming `tool-results/zqmid.txt` and write that file. CONTROL: meta `scan_sidecars_ms` reads `t0` before the non-scan tick, so the sidecar scan is not due. After the non-scan tick the tool_result row is stored and no `sidecars` row names `zqmid.txt`. CONTROL: after `tick(t0 + lib.SCAN_INTERVAL_MS + 1_000)` one does.
      - (p) A hinted file is neither stat'ed nor counted against the cap. Register a second session V with `plantSession`, both read at the scan tick. Set `IX.U`'s recorded `mtime_ns` above V's through the writer, append to both, and plant a Stop hint for `IX.ID`. Tick at `t0 + 120_000` with `activeStatMax: 1` and the counting stat. `stats` equals `[V's path]`, and both new rows are stored (IX.U's by the hint). CONTROL: the same box shape with no hint (a second box) gives `stats[0]` equal to IX.U's path.
      - (q) Each uuid's newest copy comes first. `activeStatMax: 2`. V (`plantSession`) holds two live main copies, one per home (`IX.plantCopy` into both of `box.homes`), and `IX.U` holds one; all three are read at the scan tick. Through the writer, set both of V's recorded `mtime_ns` above IX.U's. Append to IX.U only. After the non-scan tick, `stats` holds V's newer copy and IX.U's path, and IX.U's new row is stored. CONTROL: V's older copy is not in `stats`, and ordered by recorded mtime alone the two newest rows are V's.

- [ ] **Step 2: Run, and record the reds.** `history-lib.test.ts -t "CP-39d"` and `history-ingest.test.ts -t "CP-39d: a registered"`. Predicted:
  - lib's (a) red on `undefined`; ingest's (a) red: `activeStatMax` is undefined;
  - (b), (e), (f), (g)'s rename half, (k) and (q) red: nothing read on a non-scan tick;
  - (l) red at "the tool_result row is stored": nothing reads the transcript on a non-scan tick yet. Once green it is held by T2-M4;
  - (h), (i) and (p) red at the stat CONTROL or pin (0 stats);
  - (d) red at its CONTROL: 0 stats on the non-scan tick, since nothing calls `ctx.activeStat` yet;
  - (c) and (j) green, held by mutants (T2-M10 and T2-M9).
  Record what is measured.

- [ ] **Step 3: The pass.** Add the lib constant and decider, with their docs, and their `lib.d.mts` lines.
  - `ACTIVE_STAT_MAX`'s doc says: *chosen*, about three times the registered sessions that hold a live main file (79 on 2026-10-27); it bounds lstats, not reads.
  - `decideActiveRead`'s doc gives each rule's reason, as Decision 6 does.
  - In `sweep.mjs`, build Interfaces' pieces. `candidateFiles`' doc gains the group: between scans, after the behind files, a registered session's files that changed, at most `ACTIVE_STAT_MAX` lstats, each uuid's newest recorded copy first; their uuids do not join the sidecar half's share (a mid-turn sidecar waits for its Stop hint or the scan); D-7096.
  - The tick's discovery comment (about :3739) adds the source.
  Re-run Step 2's filters: all green.

- [ ] **Step 4: Run green.** One per call, every `server/test/history-*.test.ts`. The ones at risk:
  - `history-ingest.test.ts` (the Task 20 ticks case at about :1140, D-4340 at about :4044, and `knownUuids` at about :249);
  - `history-card.test.ts` (its scan-forced case at about :723);
  - `history-derive.test.ts -t "CP-39"` (its readdir patch);
  - `history-drain.test.ts` and `history-holds.test.ts` (readdir spies);
  - `history-sweep.test.ts -t "F39"`;
  - then the test typecheck and `test/single-definition`.
  A red outside this plan's cases is a stop. Mail the coordinator with the case and its message: an earlier case that pinned the old discovery rule needs a ruling, not an in-place edit.

- [ ] **Step 5: Mutants.**

```json mutants
[
  {"id": "T2-M1", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(b\\)",
   "anchor": "const a = activeFiles(db, ctx, seen, budget);", "repl": "const a = { files: [], complete: true };",
   "red": "(b) the appended rows are not stored"},
  {"id": "T2-M2", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(d\\)",
   "anchor": "if (!scan && complete) {", "repl": "if (complete) {", "red": "(d) stats on a scan tick"},
  {"id": "T2-M3", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(e\\)",
   "anchor": "if (statted >= max) break;", "repl": "if (false) break;", "red": "(e) three stats past a cap of two"},
  {"id": "T2-M4", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(l\\)",
   "anchor": "take(a.files, false);", "repl": "take(a.files, true);", "red": "(l) a sidecars row for zqmid.txt on the non-scan tick"},
  {"id": "T2-M5", "file": "ccd/history/lib.mjs", "suite": "history-lib.test.ts", "select": "CP-39d",
   "anchor": "if (stat.size > (row.size ?? 0) && nowMs - Number(stat.mtimeNs / 1_000_000n) < tornStaleMs) return 'read';",
   "repl": "if (stat.size > (row.size ?? 0)) return 'read';", "red": "(a) a stale torn tail answers read"},
  {"id": "T2-M6", "file": "ccd/history/lib.mjs", "suite": "history-lib.test.ts", "select": "CP-39d",
   "anchor": "if (stat.size < row.offset) return 'read';", "repl": "if (false) return 'read';", "red": "(a) a size below the offset answers same"},
  {"id": "T2-M7", "file": "ccd/history/lib.mjs", "suite": "history-lib.test.ts", "select": "CP-39d",
   "anchor": "if (stat.dev !== row.dev || stat.ino !== row.ino) return 'read';", "repl": "if (false) return 'read';",
   "red": "(a) another ino answers same"},
  {"id": "T2-M8", "file": "ccd/history/lib.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(h\\)",
   "anchor": "if (stat === null || stat.isFile !== true) return 'skip';", "repl": "if (stat === null) return 'skip';",
   "red": "(h) non_regular counted: the link was offered to admission"},
  {"id": "T2-M9", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(j\\)",
   "anchor": "if (budget !== null && !budgetLeft(budget)) return { files, complete: false };", "repl": "",
   "red": "(j) a stat on a spent budget"},
  {"id": "T2-M10", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(c\\)",
   "anchor": "const uuids = [...registeredUuids(ctx.home)];", "repl": "const uuids = [...knownUuids(db, ctx.home)];",
   "red": "(c) U2's row stored on the non-scan tick"},
  {"id": "T2-M11", "file": "ccd/history/lib.mjs", "suite": "history-lib.test.ts", "select": "CP-39d",
   "anchor": "if (stat.mtimeNs !== row.mtimeNs) return 'read';", "repl": "if (false) return 'read';",
   "red": "(a) another mtime answers same"},
  {"id": "T2-M12", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(e\\)",
   "anchor": "), f.mtime_ns DESC, f.file_id, p.path", "repl": "), f.mtime_ns ASC, f.file_id, p.path",
   "red": "(e) stats hold the two oldest paths"},
  {"id": "T2-M13", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(p\\)",
   "anchor": "if (seen.has(row.path)) continue;", "repl": "",
   "red": "(p) stats hold IX.U's path"},
  {"id": "T2-M14", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(a\\)",
   "anchor": "activeStatMax: ACTIVE_STAT_MAX", "repl": "activeStatMax: Infinity",
   "red": "(a) the ctx cap is not ACTIVE_STAT_MAX"},
  {"id": "T2-M15", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d: a registered.*\\(q\\)",
   "anchor": "PARTITION BY t.cc_session_uuid ", "repl": "",
   "red": "(q) IX.U's new row is not stored"}
]
```

  Re-run T2-M5 with `select` `CP-39d: a registered.*\(i\)` too. Expect (i) red: `last_seen_ms` moved.

- [ ] **Step 6: Commit.** `fix(history): the sweep reads a registered session's mid-turn growth within a tick (CP-39d Task 2; D-7096)`

### Task 3: W1-f counts searches only, and W1-b leaves out the tick that ends a backlog (D-7097, D-7098)

**Files:** `deploy/measure-history.py`, `server/test/measure-history.test.ts`.

**Interfaces:**
- Consumes: `measure`, `report`, `plantedStore`, `NOW` and `createStore` (the test file's own imports), and `lib.EXIT` through a dynamic `const lib = await import(...)` inside the case, as the file's cases at about :411 and :1419 do (its top level imports only `SCHEMA_VERSION` from lib).
- Produces, at module level in `measure-history.py`, after `RECALL_OFF_META`:
  - `W1F_SEARCH_RCS = (0, 3)`, alone on its line, with its comment on the lines above it (as `RECALL_OFF_META`'s is, about :105-107) naming lib's `EXIT.OK` and `EXIT.NOT_FOUND` and the test that holds them equal (D-7097).
  - `W1B_SQL = ('SELECT lag_ms FROM (SELECT ts_ms, lag_ms, files_behind, ' 'LAG(files_behind) OVER (ORDER BY ts_ms, tick_id) AS prev_behind FROM ticks) ' 'WHERE files_behind = 0 AND prev_behind = 0 AND lag_ms IS NOT NULL AND ts_ms > ? AND ts_ms <= ?')` (D-7098).
  - `W1F_SQL = ("SELECT ms FROM recall_calls WHERE verb = 'grep' AND arm IS NULL " 'AND rc IN (' + ','.join('?' * len(W1F_SEARCH_RCS)) + ') AND ts_ms >= ? AND ts_ms <= ?')`.
  - `--w1f-since` (int, default None), read as `a.w1f_since if a.w1f_since is not None else 0`. The W1-f query is called with `(*W1F_SEARCH_RCS, since, now)`.

- [ ] **Step 0: Check the base (no edit).**
  - `python3 -I -c "import sqlite3; print(sqlite3.sqlite_version)"` prints 3.25.0 or later.
  - `git grep -n -F "SELECT ms FROM recall_calls WHERE verb = 'grep' AND arm IS NULL" HEAD -- deploy/measure-history.py` prints one line.
  - Save the base file to scratch for Step 5.

- [ ] **Step 1: Write the cases.** `describe('CP-39d: W1-f counts searches only, and W1-b leaves out the tick that ends a backlog (D-7097, D-7098)')`. A local `cp39dStore(plant)` uses `createStore` in an `mkTmp('ccrc-measure-history-cp39d-')` home, empties `ticks` and `recall_calls`, and runs `plant` on a writer.
  - (a) Twenty greps with rc 0 and ms 100 to 2,000 (step 100), and one with rc 3 and ms 2,100. Thirty with rc 7 and ms 3,000, two with rc 2 and ms 4,000, and one with rc 1 and ms 99,999: every refusal and failure above the sample. All are stamped inside `[0, NOW]` with `arm` NULL. Expect `w1f_grep_p95_ms` to be 2,000 (nearest rank 20 of the 21 rc 0 and 3 rows).
    CONTROL: the nearest-rank p95 of all 54 rows' ms, computed in the test with `measure-history.py`'s rule (`s[(95*n+99)//100 - 1]`), is 4,000: the base query's reading.
  - (b) The rc 0 sample at ts 1,000 to 1,020 with ms `100·i` for i = 1 to 21 (all distinct), one rc 0 row at ts 999 with ms 90,000, and one at `NOW + 1` with ms 80,000.
    - With `--w1f-since 1000`, expect 2,000 (the sample's p95).
    - Without it, the ts 999 row counts and the `NOW + 1` row never does: expect 2,100.
  - (c) With lib imported dynamically, the source matches `/^W1F_SEARCH_RCS = \((\d+), (\d+)\)$/m`, and its numbers equal `[lib.EXIT.OK, lib.EXIT.NOT_FOUND]`. CONTROL: `lib.EXIT.FTS_UNAVAILABLE` is not among them.
  - (d) Six ticks, all inside the week, inserted in this `tick_id` order. T5 is inserted before T4, so an order by `tick_id` would read the wrong predecessor:
    - T1 at `NOW - 5·HOUR`, `files_behind` 0, lag 800,000. It is the store's first tick, with no predecessor; counted, it would be the p95;
    - T2 at `NOW - 4·HOUR`, behind 0, lag 2,000;
    - T3 at `NOW - 3·HOUR`, behind 0, lag 3,000;
    - T5 at `NOW - 1·HOUR`, behind 0, lag 900,000. It ends the backlog: its predecessor by time is T4;
    - T4 at `NOW - 2·HOUR`, behind 3, lag 5,000. It is the catch-up;
    - T6 at `NOW - 0.5·HOUR`, behind 0, lag 4,000.
    The counted lags are T2's, T3's and T6's, so expect `w1b_lag_p95_ms` 4,000 (nearest rank 3 of 3).
    CONTROL: the base query, run on the fixture with `sqlite3` in the test, reads 900,000 (rank 5 of {2,000, 3,000, 4,000, 800,000, 900,000}).
  - (e) `plantedStore()` with `--families` and its window, once with `--w1f-since 100050` and once without it: `w2` deep-equals. The same with `--census --as-of NOW --since 0 --row-cap 5`: `census` deep-equals. CONTROL: `w1f_grep_p95_ms` differs between the runs.
  - (f) The predecessor is read before the week's filter. Three ticks: T0 at `NOW - 8·DAY`, behind 0, lag 1,000 (outside the week, the store's first tick); T1 at `NOW - 1·HOUR`, behind 0, lag 700,000; T2 at `NOW - 0.5·HOUR`, behind 0, lag 2,000. T1's predecessor is T0, which ended caught up, so T1 counts: expect `w1b_lag_p95_ms` 700,000 (nearest rank 2 of 2). CONTROL: the same LAG computed over the in-window ticks only, run in the test with `sqlite3`, reads 2,000.
  Unchanged and expected green: the O52 pins at about :197 (`w1b_lag_p95_ms` 20,000) and :199 (`w1f_grep_p95_ms` 2,000), :377 (812), and the key order at :449.

- [ ] **Step 2: Run, and record the reds.** `-t "CP-39d"`. Predicted:
  - (a) red: 4,000, the old query's value, against 2,000;
  - (b) red (`--w1f-since` is an unknown argument: exit 2);
  - (c) red (no match);
  - (d) red (900,000);
  - (e) red (exit 2 on the unknown argument);
  - (f) green: the base query has no predecessor rule. It is held by T3-M6.

- [ ] **Step 3: The measures.**
  - Add Interfaces' constants and argument. Replace the two queries with `W1B_SQL` and `W1F_SQL`.
  - Rewrite the docstring's usage line (`[--w1f-since MS]`) and its two entries:
    - `w1b_lag_p95_ms`: "… counting only ticks with files_behind = 0 whose predecessor by time also ended with files_behind = 0 (so not the tick that finishes a backlog) and a measured lag; the store's first tick has none (D-7098)";
    - `w1f_grep_p95_ms`: "… over verb = 'grep' rows with arm IS NULL and rc in W1F_SEARCH_RCS (a search that ran to its answer; refusals and failures are not searches), ts_ms from --w1f-since (default 0) to --now (D-7097)".
  Re-run: all green, and the whole file green.

- [ ] **Step 4: Run green.** One per call: `measure-history.test.ts` whole, `history-replay.test.ts` (it reads `measure-history.py`'s sha through `gate_code` fixtures), and the `history-gate` cases in `measure-history.test.ts`.

- [ ] **Step 5: Base against new, then the hunk census.**
  - Run the base copy saved in Step 0 and the new file on the same two stores, and compare their `w2` and `census` outputs byte for byte:
    - `plantedStore()` with `W2_ARGS(f, '400')`;
    - the census fixture with `--census --as-of … --since … --row-cap 5`, as (e) runs it.
    Do it from a throwaway test file under `server/test/` that builds both stores in fixture homes as (e) does, runs `python3 -I` on each script with the same arguments, and writes each output's `w2` and `census` value (`JSON.stringify` of the parsed report, which keeps the script's key order) to your scratch directory. The file is never staged, and is deleted after; `git status` shows it gone. Then `cmp` the base and new files of each pair. Paste "cmp silent ×2" into the PR body. A difference is a stop.
  - `git diff -U0 <base> -- deploy/measure-history.py`. Every hunk lies in one of these places, and none lies in `family_scope`, `copy_record`, `boundary_copies`, `family_report`, `families_report`, `recall_off_rows`, `w1e_statistic`, `LAST_MAIN_SQL` or `census_report`:
    - the docstring's usage line or its two W1 entries;
    - the new module constants;
    - `main`'s argparse block;
    - `main`'s two W1 entries.
    Paste the hunk headers into the PR body.

- [ ] **Step 6: Mutants.**

```json mutants
[
  {"id": "T3-M1", "file": "deploy/measure-history.py", "suite": "measure-history.test.ts", "select": "CP-39d.*\\((a|c)\\)",
   "anchor": "W1F_SEARCH_RCS = (0, 3)", "repl": "W1F_SEARCH_RCS = (0, 3, 7)", "red": "(a) 3000, and (c)"},
  {"id": "T3-M2", "file": "deploy/measure-history.py", "suite": "measure-history.test.ts", "select": "CP-39d.*\\(d\\)",
   "anchor": "'WHERE files_behind = 0 AND prev_behind = 0 AND lag_ms IS NOT NULL AND ts_ms > ? AND ts_ms <= ?'",
   "repl": "'WHERE files_behind = 0 AND lag_ms IS NOT NULL AND ts_ms > ? AND ts_ms <= ?'", "red": "(d) 900000"},
  {"id": "T3-M3", "file": "deploy/measure-history.py", "suite": "measure-history.test.ts", "select": "CP-39d.*\\(d\\)",
   "anchor": "OVER (ORDER BY ts_ms, tick_id)", "repl": "OVER (ORDER BY tick_id)", "red": "(d) the predecessor by insertion, not by time"},
  {"id": "T3-M4", "file": "deploy/measure-history.py", "suite": "measure-history.test.ts", "select": "CP-39d.*\\(b\\)",
   "anchor": "') AND ts_ms >= ? AND ts_ms <= ?')", "repl": "') AND ts_ms >= 0 * ? AND ts_ms <= ?')", "red": "(b) the row before --w1f-since counted"},
  {"id": "T3-M5", "file": "deploy/measure-history.py", "suite": "measure-history.test.ts", "select": "CP-39d.*\\(d\\)",
   "anchor": "'WHERE files_behind = 0 AND prev_behind = 0 AND", "repl": "'WHERE files_behind = 0 AND COALESCE(prev_behind, 0) = 0 AND",
   "red": "(d) 800000: the store's first tick counted"},
  {"id": "T3-M6", "file": "deploy/measure-history.py", "suite": "measure-history.test.ts", "select": "CP-39d.*\\(f\\)",
   "anchor": "AS prev_behind FROM ticks) '", "repl": "AS prev_behind FROM ticks WHERE ts_ms > (SELECT max(ts_ms) FROM ticks) - 604800000) '",
   "red": "(f) 2000: the predecessor read inside the week only"}
]
```

- [ ] **Step 7: Commit.** `fix(measure-history): W1-f counts searches only, and W1-b leaves out the tick that ends a backlog (CP-39d Task 3; D-7097, D-7098)`

### Task 4: the carried review items (D-7099)

**Files:** `ccd/history/sweep.mjs`, `ccd/history/store.mjs`, `ccd/history/lib.mjs`, `server/test/history-ingest.test.ts`, `server/test/history-export.test.ts`.

Each carry names its review, and the item's test where the carry asks for one.

- [ ] **Step 0: Check the base (no edit).** `git grep -n -e "const SCAN_PIECE = 1 << 20;" -e "const RANGE_PIECE = 1 << 20;" HEAD -- ccd/history/sweep.mjs ccd/history/store.mjs` prints exactly two lines: `findLineEnd`'s `SCAN_PIECE` in `sweep.mjs` and `compressFdRange`'s `RANGE_PIECE` in `store.mjs`. Both read with a buffer of up to `1 << 20` bytes, so 987 F6's patch keys on the read's position too. `findLineEnd` reads at `start + LINE_MAX`, `compressFdRange` first at the line's start. If either line differs, stop and mail the coordinator.

- [ ] **Step 1: Write the cases, and make the in-place edits (D-7099).**
  - **987 F1**, in the CP-39b describe: (h) "a short read destroys the encoder and answers null".
    - Use (g)'s pattern: `stubBrotli` with a pass-through encoder, a 3 MiB file, and `fs.readSync` replaced so that the case descriptor's second read returns 0.
    - Expect `compressFdRange` to resolve null and `made[0].destroyed` to be true. CONTROL: 2 reads.
  - **987 F5**, in the CP-39b describe: (i) "a throw from the piece's allocation destroys the encoder".
    - Stub the encoder, then `vi.spyOn(Buffer, 'allocUnsafe')` throwing a marked error only for `size === 777_777`.
    - Call `compressFdRange(fd, 0, 777_777)` on a file of that size. Expect it to reject with the mark, and the stub encoder to be destroyed. Restore both in a `finally`.
  - **987 F6**, after O2b, in-process through `S.ingestPath`, on the text `[user 1, long, user 4]`: O2b's over-long line between two short rows, with no malformed line. `longStart` is the over-long line's byte offset. `fs.readSync` is replaced so that only a read whose buffer is exactly `1 << 20` bytes **and** whose position is `longStart` (compressFdRange's first piece; Step 0) does what the case says. Each case carries O2b's `fs.rmSync(box.home, { recursive: true, force: true })` in its `finally` and O2b's 120_000 ms timeout.
    - (m), titled `CP-39d carry (m) …`: that read returns 0. Expect `atEof` false, the cursor at `longStart`, and no `line-too-long` raw row (the `raw_only` counter reads 0 or is absent). CONTROL: an unpatched second call stores the over-long line raw (`raw_only` 1) and reaches the end.
    - (n), titled `CP-39d carry (n) …`: that read throws `Object.assign(new Error('cp39d-k'), { code: 'EIO', syscall: 'read' })`. Expect `S.ingestPath` to reject with it and the cursor to be held. Through `S.ingestTick` on the same patch, `file_unreadable` is 1. This is the OS-error arm: `ingestTick` counts it and skips the file.
  - **987 F6, the compressor arm**, at the end of the CP-39b describe (its `stubBrotli` is declared there): (o), titled `CP-39d carry (o) a compressor error leaves the tick instead of hanging it`.
    - Plant the text `[user 1, long, user 4]` with `IX.plantCopy`. Stub the encoder with CP-39b (f)'s callback shape: its write callback carries `new Error('cp39d-o')`, which has no `syscall`. The over-long line is the only streamed compress on this path. CONTROL: the stub was constructed at least once.
    - Expect `S.ingestPath` to reject with the mark within 10 s (a `Promise.race` against a timer cleared in `finally`), and the cursor not past `longStart`.
    - Then expect `S.ingestTick` on the same store to reject with the mark within 10 s, `file_unreadable` unchanged, and the cursor still held.
    - Restore the stub, close the store and `fs.rmSync(box.home, …)` in `finally`. Timeout 120_000 ms.
  - **987 F3**, in place: DM47's case (about :1753) names its first file `stream64.txt` in place of `whole64.txt`, in its write and its `got` call.
    - It adds a decode check. For each name, read `b.z`, `brotliDecompressSync` it, and compare the result's sha256 and length with the written ones.
    - A one-line comment names D-7099. The walk-cap case's own `whole64.txt` (about :5180) stays.
  - **999 F5**, in CP-39c Task 1's describe: (g) "a step whose preflight refuses makes no pass slice".
    - Use (c)'s counting clock, with `statfs` answering a filesystem under the floor (`async () => ({ bsize: 1, bavail: 0, blocks: 8 * TIB })`) and `limits: { maxMs: 0 }`.
    - Expect `state: 'paused'`, and the counter reads 0. CONTROL: with `roomy` the counter reads at least 1.
  - **999 F4**, in place: E2's comment's first line (about :2232) becomes "The export is the tick's last step; before CP-39c it shared the run's 90 s / 512 MiB budget with ingest, the FTS backfill, nodes and". The rest of the comment is unchanged.

- [ ] **Step 2: Run, and record the reds.** Predicted:
  - (h), (m), (n), (o) and (g) green: each pins code already there, and each is held by a mutant;
  - (i) red: the allocation sits before the `try`.
  - DM47 is green with its new name.

- [ ] **Step 3: The code and the comments.**
  - **987 F5**, in `store.mjs`: `compressFdRange`'s `try {` comes first, and its first line is exactly `const piece = Buffer.allocUnsafe(Math.min(RANGE_PIECE, end - start));`. (i) turns green.
  - **987 F2**, in `ingestSidecar`: the `let make;` comment becomes "the body to store, stored only when no live blob holds this sha (D-4589's one probe, below): the whole arm compresses then, and the streamed arm has already compressed it in compressFdRange".
  - **999 F4**, wherever the pass's slice now governs:
    - in `sweep.mjs`: `exportSelect`'s doc ("the run's budget ended the scan"), `decide`'s doc ("the run's budget ends the selection") and comment ("each page under the run's budget"), the W1-B4 overview ("what the run's byte budget has left") and `writeSegmentRows`' doc (about :9162, where the phrase wraps: "it reads the run's" ends one line and " *  clock and history-off" begins the next, so search for "reads the run's" alone);
    - in `lib.mjs`: `budgetHeldPass`' doc ("the budget is all that is left", "the budget already spent as the pass started"). `exportPassIntervalMs`' doc never names the run's budget and is not changed.
    Each says "its slice of the run's budget" (D-6974).
  - **964**, in `lib.mjs`:
    - `SIDECAR_WALK_CHARS_MAX`'s doc says it is a soft bound: one name is admitted past it, and a walk's `done` grows by the names taken in the same call;
    - the `DERIVE_SHARES` comment (about :241) says that its 0.1-0.17 of a core was measured with a local, unshipped CPU-weight drop-in present.
  - Check: `git grep -n -e "or the run's budget ended the scan" -e "or the run's budget ends the selection" -e "each page under the run's budget" -e "what the run's byte budget has left" HEAD -- ccd/history/sweep.mjs` prints nothing after the commit. Each pattern keeps the word before the phrase, so a corrected "or its slice of the run's budget ended the scan" does not match it.

- [ ] **Step 4: Run green.** One per call: `history-ingest.test.ts -t "CP-39b"`, `-t "O2b"`, `-t "DM47"`, `-t "CP-39d"`, then `history-export.test.ts` whole, `history-lib.test.ts`, the test typecheck and `test/single-definition`.

- [ ] **Step 5: Mutants.**

```json mutants
[
  {"id": "T4-M1", "file": "ccd/history/store.mjs", "suite": "history-ingest.test.ts", "select": "CP-39b.*\\(h\\)",
   "anchor": "if (n === 0) { enc.destroy(); return null; }", "repl": "if (n === 0) { return null; }", "red": "(h) the encoder was destroyed"},
  {"id": "T4-M2", "file": "ccd/history/store.mjs", "suite": "history-ingest.test.ts", "select": "CP-39b.*\\(i\\)",
   "anchor": "  try {\n    const piece = Buffer.allocUnsafe(Math.min(RANGE_PIECE, end - start));",
   "repl": "  const piece = Buffer.allocUnsafe(Math.min(RANGE_PIECE, end - start));\n  try {", "red": "(i) the encoder was destroyed"},
  {"id": "T4-M3", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d carry.*\\(m\\)",
   "anchor": "if (c === null) return done(false);", "repl": "if (c === null) return done(true);", "red": "(m) atEof"},
  {"id": "T4-M4", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d carry.*\\(n\\)",
   "anchor": "const c = await compressFdRange(file.fd, offset, end);",
   "repl": "let c; try { c = await compressFdRange(file.fd, offset, end); } catch { return done(false); }", "red": "(n) ingestPath resolved"},
  {"id": "T4-M5", "file": "ccd/history/sweep.mjs", "suite": "history-export.test.ts", "select": "CP-39c: the export pass.*\\(g\\)",
   "anchor": "const probe = await statfsWithDeadline(",
   "repl": "const early = exportPassSlice(ctx); void early;\n  const probe = await statfsWithDeadline(", "red": "(g) expected 1 to be +0"},
  {"id": "T4-M6", "file": "ccd/history/sweep.mjs", "suite": "history-ingest.test.ts", "select": "CP-39d carry.*\\(o\\)",
   "anchor": "if (!isFsError(e)) throw e;\n        countAdmission(db, 'unreadable');\n        filesUnreadable = true;",
   "repl": "countAdmission(db, 'unreadable');\n        filesUnreadable = true;", "red": "(o) ingestTick resolved: a compressor error was counted unreadable"}
]
```

  Cases (m), (n) and (o) carry the `CP-39d carry` prefix in their titles, so these filters select them and never Task 2's cases.

- [ ] **Step 6: Commit.** `fix(history): the sweep's carried review items (CP-39d Task 4; D-7099)`

### Task 5: the plan's measured reds, and the PR

- [ ] Replace every predicted red and count in this plan with the measured one, and add a "## Measured" line per task (the reds, the green counts, each mutant's message). Commit: `docs(plan): CP-39d, the measured reds (CP-39d)`
- [ ] Clean the fixtures your runs left under `~/.cc-tmp` (the ledger's volume note).
- [ ] Before opening the PR:
  - run `git fetch origin main`, then `./node_modules/.bin/vitest run test/deviation-refs.test.ts` from `server/`;
  - run the private-name scan over the added lines, the commit messages and the PR body (0 hits).

## The PR

Commits, in order:
1. `docs(plan): CP-39d, grep from its scope and capture mid-turn (CP-39d; D-7095 to D-7099)`, which adds this plan byte for byte;
2. `perf(history): grep drives each referrer arm from its scope (CP-39d Task 1; D-7095)`;
3. `fix(history): the sweep reads a registered session's mid-turn growth within a tick (CP-39d Task 2; D-7096)`;
4. `fix(measure-history): W1-f counts searches only, and W1-b leaves out the tick that ends a backlog (CP-39d Task 3; D-7097, D-7098)`;
5. `fix(history): the sweep's carried review items (CP-39d Task 4; D-7099)`;
6. `docs(plan): CP-39d, the measured reds (CP-39d)`.

Open it against `main`, ready for review, titled "ccrc history CP-39d: grep searches its scope, and capture sees a turn while it runs". Its body has these sections:
- Summary;
- Departures (D-7095 to D-7099, each with its class);
- Residuals named, below;
- Tests run (each suite, its counts as "N passed, M failed, 0 skipped", every red from Steps 2, Task 1 Step 3c's nine rank figures, and Task 3 Step 5's "cmp silent ×2" and hunk headers);
- Steps for the coordinator or the operator, never the worker:
  1. The spec sentences in "Not in this plan", in a docs PR.
  2. The ledger: close review 987 F1, F2, F3, F5 and F6, review 999 F4 and F5, and review 964's two items.
  3. W2's `gate_code`: record the new sha256s of `ccd/history/lib.mjs` and `deploy/measure-history.py` from this release.
  4. After the operator's rollout, read-only:
     - W1-f is a deliberate run of at least 30 family greps over a fixed list of words, from a `cc-` pane, reported cold and warm with the box's load. The same list is run with `--sort relevance` and with `--sort hybrid`, each reported apart from the default recency. The measure is then `measure-history.py --w1f-since <install ms>`.
     - W1-b is read over the next full week by the new query.

Then read the threads with `gh api graphql`, and confirm CI ran at the head and that its `select tests` summary lists every test file this PR changed. If a leg is red, stop and mail the coordinator with the leg.

## Residuals named

- **The registry read.** Each non-scan tick reads `$REG/*.uuid` once: one listing and one bounded, nonblocking read per name, as `knownUuids` does at the scan. Its cost is the registry's size, tens of ids on the fleet, and one SQL read (`activeRows`) over `ingest_files` and `file_paths`, whose join columns (`transcript_pk`, `file_id`) carry no index: the shape `behindPaths` and `behindRows` already read every tick. The lstats are capped and these reads are not.
- **Past the cap.** A file past the first `ACTIVE_STAT_MAX` (256) in `activeRows`' order, each uuid's newest copy first, waits for its Stop hint or the 30-minute scan, as before this wave. Today's 79 newest copies all fall inside the cap. A newest copy would wait only once the registry held more than 256 uuids with a live main file.
- **A cut scan suspends the pass.** A due scan that its budget cuts leaves `scan_discover_ms` unset, so the scan stays due and the pass does not run until a scan completes. The investigation's 9 ticks of 32-44 min are consistent with cut scans.
- **A failing registered file is retried every tick.** A regular file whose open or read fails records no examined row, so the pass offers it on every non-scan tick: it is counted each tick (`file_unreadable` or an admission word) and its uuid's card prediction is withdrawn each tick (D-5061, arm `copy`), as a failing behind file already is. D-4340's "until its next hint or the next due scan" no longer bounds a registered uuid's file.
- **A mid-turn sidecar waits.** The pass's files do not join the sidecar half's share, so a sidecar written mid-turn is read at its Stop hint or the scan (Decision 7). W1-b reads transcript rows only.
- **W2's non-gating counters move.** `deploy/history-counters.mjs`'s per-window lag, `card_served` and `card_id_mismatch` read this release's capture, so they cannot be compared with readings taken before it. None feeds the gate.
- **W3's receipt hold.** Derivation's hold (`derive.mjs`, about :393, `pendingReceiptState.sessionUuids`) holds only uuids with a draining spool file. A compaction boundary that the pass ingests between the boundary's write and its SessionStart(compact) spool line derives its leaf with no hold, as one the scan or a behind file ingests already does. Steer receipts are written only from W3, so W2 is unaffected; the W3 wave owns it.
- **What W1-b's lag still holds.** A row written just after a tick's lstat waits for the next tick. The lag still holds up to one tick's spacing plus the pass's own time, and `ticks` records no pass end.
- **What W1-f's measure cannot tell.**
  - `recall_calls.ms` starts at `readVerb`'s entry, so node's own start is not counted.
  - The spool line carries no arguments, so W1-f's organic rows mix scopes and `--regex`. The deliberate run is the reading.
  - A `--regex` that ran past its budget (rc 2) is left out of W1-f.
- **The plan pin.** It relies on `INDEXED BY entries_ts` for the entry and variant arms, and on SQLite's documented rule that a unary `+` disqualifies a term from driving an index for every arm's blob term.
- **Scope-first on a rare term.** Over a large scope a rare term costs the scope's size (33-39 ms over 200k entries, synthetic and warm) where blob-first cost about 0 ms. Cold-cache cost over a large scope is not measured.
- **The rank lookup.** On relevance and hybrid, `rk` evaluates the match a second time, beside `m`, in the form Task 1 Step 3c measured cheapest; its nine figures replace this sentence at Task 5. The in-scope and correlated forms cost about 0.7 ms per in-scope blob (bm25's IDF is recomputed on every xFilter); the global form costs the box's whole match, as the shipped statement did. Step 3c's figures are warm. Cold, relevance and hybrid may still cost what the shipped statement cost on every sort: the rank over 23,766 matches took 692 ms cold, so over 96,708 it may take near 2.8 s. This wave makes no sort slower. Recency, the default, reads no rank. The coordinator rules this a residual (2026-10-27), and the post-rollout relevance and hybrid runs report it apart from recency.
- **The window count.** A project scope with many in-scope matches materializes them all for the window count, as `countSql` read them all.
- **`examineUuids`.** Its doc still lists the tick's old sources. It is not on the tick's path.
- **Every figure.** Each count and red in this plan is a prediction until Task 5 replaces it.

## Deviations found

- **D-7095** — `history-grep-scope-first` (Task 1). **Spec amendment**, the schema block's `entries_blob` comment (:815), which no longer describes grep; behaviour-preserving. grep's ranked statement drives each referrer arm from the scope's transcripts:
  - each arm carries its own `transcript_pk IN :tpks` term;
  - the entry and variant arms read `entries` through `INDEXED BY entries_ts` (`versioned`'s new optional argument), because with an `entries_ts` row in `sqlite_stat1`, which the writer's `PRAGMA optimize` writes, the planner otherwise plans `SCAN entries`;
  - each arm tests its blob against the match with a unary `+`, so no blob-led index can drive it.
  - A sort whose ORDER BY reads `rank` joins `rk`, the match's BM25 in the form Task 1 Step 3c measured cheapest (its figures here). Recency reads no rank.
  - F7's name list in `history-recall.test.ts` is edited in place: `countSql` out, `SCOPE_IN` and `REGEX_MATCH` in.
  - The true count is `count(*) OVER ()` on the same rows, read from the first row, and `countSql` is gone, so the global match runs once.
  - `rankedAndCounted`, `FTS_MATCH` and `REGEX_MATCH` are exported as test seams.
  - Rows, order, snippets and counts equal the shipped statement's over every sort, four scopes (one empty), the filters, every LIMIT boundary and the as-of cut. The scope still sits inside the ranking statement, before its LIMIT (C27).
  - Measured cause: the shipped shape matched the whole box first, at 1.3-5.4 s cold, against 64-146 ms for the scope-first entries arm. The live post-merge p95 was 2,567 ms against W1-f's target of under 2 s.
  - Large scopes (synthetic, warm): scope-first costs 33-39 ms for a rare term over 200k entries, where blob-first costs about 0 ms, and 62-105 ms for a common term, where blob-first costs 260-300 ms. One driver is kept.
- **D-7096** — `history-sweep-registered-growth` (Task 2). **Spec amendment**, §9.2 step 2's sources. The coordinator's docs PR carries the text.
  - On a tick whose transcript scan is not due, after the hinted and behind files, the sweep lstats the live main-thread files of the uuids `$REG/*.uuid` names, each uuid's newest recorded copy first (`DENSE_RANK` partitioned by uuid), at most `ACTIVE_STAT_MAX` (256, *chosen*) a tick. It never follows a link, and a path already taken this tick is not stat'ed.
  - It takes each file lib's `decideActiveRead` answers `read`: another inode, a size below the cursor, another mtime, or growth while the file is fresher than `TORN_STALE_MS`. A stale torn tail, a link and a vanished path are not taken, and nothing is counted for them. A regular file whose open or read fails is offered again every non-scan tick, and counted each time.
  - The files' uuids do not join the sidecar half's share: a mid-turn sidecar waits for its Stop hint or the scan, so the pass adds no per-tick `listSidecars` walk.
  - A due scan cut by its budget keeps the scan due, and the pass does not run until a scan completes.
  - `registeredUuids` is `knownUuids`' registry half, with `knownUuids`' answer unchanged.
  - The ingest context gains two in-process seams, `activeStat` and `activeStatMax` (D-4247).
  - The cap, measured read-only on 2026-10-27: 79 registered uuids held a live main file, across 257 files. A cap of 64 would have left out 15 newest copies on every tick. One lstat of all 257 took 2.1 ms.
  - Measured cause: the live W1-b p95 was 22 min. All 289 ticks over 4 min captured rows that had sat on disk through skipped ticks, because §9.2's sources see mid-turn growth only at Stop or at the scan. §2 item 1's goal ("within two sweep ticks of being written") needs this source.
- **D-7097** — `history-w1f-measures-searches` (Task 3). **Spec amendment**, §10.2's W1-f query.
  - `measure-history.py` counts a grep row only when its rc is in `W1F_SEARCH_RCS`, (0, 3): lib's `EXIT.OK` and `EXIT.NOT_FOUND`, a twin held equal by `measure-history.test.ts`.
  - It counts only rows with `ts_ms` from `--w1f-since` (default 0) to `--now`.
  - Measured: 99 of 211 live rows were rc 7 `fts-pending` refusals, and others predate the backfill.
  - The report's keys and the `w2` and `census` outputs are unchanged.
- **D-7098** — `history-w1b-after-a-caught-up-tick` (Task 3). **Spec amendment**, §10.2's W1-b query and §10.7's W1-b row.
  - A tick counts only when it and its predecessor by `(ts_ms, tick_id)` both ended with `files_behind = 0`. `files_behind` is measured at a tick's end, so a tick that finishes a backlog read as caught up.
  - The store's first tick has no predecessor and does not count.
- **D-7099** — `history-cp39d-carries` (Task 4). **NEW departure** (no spec row). The carries of reviews 987, 999 and 964:
  - `compressFdRange` allocates its piece inside its `try`, so any throw after the encoder exists destroys it (987 F5);
  - new cases pin the short-read destroy (987 F1), the over-long line's null arm, its OS-error arm (counted and skipped) and its compressor-error arm (leaves the tick, never hangs it) (987 F6), and a paused export step makes no pass slice (999 F5);
  - DM47's 64 MiB case is edited in place: its file is `stream64.txt`, and each blob is decoded and compared (987 F3);
  - E2's comment's first line is edited in place (999 F4);
  - doc comments are corrected (987 F2, 999 F4, and review 964's two `lib.mjs` items).
