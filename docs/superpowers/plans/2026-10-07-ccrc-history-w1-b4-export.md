# ccrc history, wave 1 B4 (sole-copy export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship W1-B4 "sole-copy export" of the ccrc history spec (§9.15, ruled Q6 e) as ONE PR on `main` after B1 ("capture") and B2 ("recall") merge. Before Claude Code deletes a transcript, the sweep copies its text out of the store into immutable files beside it:
- every row that is due by the per-copy rule (ruled Q15, rev 3.4: every file holding a copy of it has passed its mtime plus its own home's retention, minus 30 days; a file gone from disk has passed), plus the bytes of every blob it references that is not yet exported, goes into an immutable SQLite segment `export/<store_id>/<seq>.<writer>.db` on the home filesystem;
- one segment per pass, at most hourly, behind a `planCopy` preflight on that filesystem;
- each segment is published by `link()`, never by rename, and its rows are marked after the link;
- B2's recovery step gains two segment-replay phases (blobs first, then rows), so a store rebuilt after its transcripts and `history.db` are both gone can `expand`, `describe` and scope the exported text again;
- the `history-export` lifecycle row, and doctor's `export-due` rule for a build with the export writer live.

Pins: O39, O40, O43 and O44's segment case (§10.5). B1 ships O41 and leaves its B4 cases open; this plan covers them. B4 must be live on every session-hosting node before the earliest first due date W1-k measures, and by 2026-12-19 at the latest: a coordinator or operator step, never a worker's.

**Architecture:** Fleet-side only: no wire, server, PWA, hook, `ccd/ccrc`, `ccd/ccd` or deploy change. Layered as B1 and B2 are; ring membership is a property of a file's imports.

*L1 `ccd/history/lib.mjs`* (imports `node:crypto` only) owns every decision:
- the export constants (`EXPORT_DIR`, `EXPORT_SEGMENT_MAX_BYTES`, `EXPORT_PASS_INTERVAL_MS`, `EXPORT_SEGMENT_FORMAT`) and the segment-name grammar (`segmentName`, `segmentTempName`, `parseSegmentName`, `orderSegmentNames`);
- `nextSegmentSeq`, the hourly cadence (`decideExportPass`) and the room verdict (`planExportRoom`, which is B1's `planCopy` with `floorThreshold` on the export filesystem and `EXPORT_SEGMENT_MAX_BYTES` as the size);
- the marks' two decisions (coordinator ruling RD2): the mark-failure backoff (`exportMarkFailsOf`, `decideMarkOutcome`: whether a pass backs off, and the next wait) and the check after a bind (`decideMarkCheck`: which bind facts a check covers and whether this step runs one; `missingSegmentNames`);
- the row-level due rule and what a segment carries (`planSegment`), deciding each row through the same reducer, with the same default, as the census's `planExport`: B2's `EXPORT_REDUCERS.perCopy` (ruled Q15, rev 3.4; ⟦D:history-export-due-per-copy⟧), so the pass and the census keep one clock (RD1); the oldest due-since added to `planExport`'s answer;
- the dead-file key (`exportedSourceKey`); the recovery phases and cursor arm (`RECOVER_PHASES` gains `export-blobs` and `export-rows` between `apply` and `reindex`); the segment replay verdict (`decideSegmentReplay`: replay, newer or foreign);
- the `export-due` rule for a build with the writer (Task 9), with no new health word.

*L3 `ccd/history/store.mjs`* stays the sole `node:sqlite` importer and owns the segment format: typed row tables sharing one write-order `ord`, plus `blobs` and `meta`. `createSegment` writes a temp opened `O_EXCL` 0600 with `journal_mode = OFF`; `publishSegment` fsyncs, links, answers `exists` on `EEXIST`, unlinks the temp and fsyncs the directory; `openSegment` is read-only; page readers, the listing and stale-temp removal complete it.

*L4 `ccd/history/sweep.mjs`* delivers without deciding:
- `exportStep` runs in the tick directly above B1's `// <<< history tick steps` marker, after `recordTick` and `markScan` and outside the ingest gate, so it never collides with B3's card writer after `deriveNodes`. It runs the bind mark check, then the cadence (backed off after a pass that published and could not mark), the stale-temp removal, the preflight and `exportPass`. Whether the check runs, what it covers, which segments are missing, whether a pass backs off and how long the next wait is are lib's answers: the sweep measures meta, the listing and the marked names, calls lib and acts (RD2).
- `exportPass` selects candidates through the `entries_unexported` index and B1's `transcriptFiles` clock (the census's, transcript-level: B1's D-4248 (`history-export-holding-files-by-transcript`)), plus, whatever their time, the rows of every transcript the per-copy rule makes due now (B2's `dueTranscriptKeys`, the census's own prefilter, so the pass offers every row the census counts due), writes through store.mjs, publishes, then marks in one NORMAL transaction after the link. A busy error between the link and the marks records the published seq and the attempt clock before it is rethrown (RD3).
- B1's `writeChunk` variant branch clears a late-variant entry's marks, and B1's `ingestSidecar` clears the marks of an exported entry a new sidecar row links to; B1's `exportCensus` also records the oldest due-since.
- `recoverExportBlobsChunk` and `recoverExportRowsChunk` sit in B2's `RECOVER_EXECUTORS` literal between `apply` and `reindex`, under B2's executor contract: one bounded chunk, the cursor committed in the same transaction, `pairsAdded` carried.

*L4 `ccd/history/cli.mjs`* fills the status envelope's export block (`segments`, `segment_bytes`, `last_pass_ms`, `due_oldest_ms`, `paused_low_disk`) by name and size, never opening a segment, and sets `exportWriterLive: true` in `healthInputsOf`. Doctor's bash relays status as before and needs no edit.

*L0 `shared/lifecycle.ts`* gains the `history-export` row.

B4 adds no schema migration (v1 already has `exported_ms` and `exported_seg`), no `historyPaths` key (the export path is `${historyPaths(home).root}/${EXPORT_DIR}`, B2's `RECALL_OFF_DIR` precedent, which keeps clear of B3's `historyPaths` edit), no `WRITING_FORMS` entry, no journal record kind and no health word.

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`): `node:sqlite` `DatabaseSync` (read-only handles, `setReadBigInts`, segments built with `journal_mode = OFF`), `node:fs` (`linkSync`, `fsyncSync`, `O_EXCL` opens, `statfs` through B1's deadline wrapper), `node:crypto`;
- vitest in `server/`, with `node-pty` (already a `server` dependency) for the `doctor --adopt` and `doctor --rebuild` doors;
- GitHub Actions: the `node-floor` leg's test list gains `history-export.test.ts`.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.5, which states this plan's `due_oldest_ms` (`number | null | 'unmeasured'`) in §9.15 "The gap guard" beside ⟦D:history-export-wait-from-census⟧; its other changes (W1-B1's corrections and the substring belt, §17) are B1's and B2's. Rev 3.4 was rev 3.3 plus the operator's rulings of 2026-10-07 on Q15–Q19 and on prune at low disk; §15.1 lists where each landed. §10.5 lists B4's contents and pins; §10.6 the sequencing; §10.7 the acceptance (W1-g, W1-k, W1-l); §9.15 the export; §9.14 the journal and recovery; §9.6 the health rules; §16 the slugs.

**Builds on:**
- `docs/superpowers/plans/2026-10-05-ccrc-history-w1-capture.md`: B1 is its Tasks 3–36. Every B1 name this plan consumes (`lib`, `store`, `sweep` and `cli` exports, test helpers, fixtures, preloads) is the name that plan produces.
- `docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md`: B2's tasks, its recovery step (Tasks 7, 25–29), its binding verbs, its test helpers, its coordinator rulings RB1–RB17, and its per-copy due-rule task (added after the operator's 2026-10-07 rulings; ⟦D:history-export-due-per-copy⟧), which adds `EXPORT_REDUCERS.perCopy` and makes it the default of B1's `planExport`, and so of the census and doctor's export arms, with no signature change. B4 consumes that task's reducer contract as Task 2's Interfaces state it, and Task 2 Step 2 checks the merged base holds it.

**Base:** `main` after B1's and B2's PRs merge. B3 may or may not be on the base.
- Anchors into files B1 or B2 created (`ccd/history/{lib,store,sweep,cli}.mjs` and their `.d.mts`, `server/test/history*.test.ts`, `historyHelpers.ts`, `server/test/fixtures/history/*`) are BY CONTENT: a function, const or marker name, a quoted line, or "above the entry guard". Never by line number.
- Anchors into pre-existing files were measured at `f7e51156f` and say so. Re-anchor each by its quoted content at the B4 base: B1, B2 and other programmes insert lines above several of them.
- B1's and B2's merged code may differ from their plan text. Before editing a B1 or B2 function in place, read it at the base. B2's Task 28 `journalStoreDirs` once read `journalEnds(…)?.head.store_id`; B2's plan now carries the fix (it reads `?.headStore`; coordinator ruling RD4), so B4 depends on no patch of its own, and Task 11 Step 1 still checks that the merged base holds it.
- Two other programmes' open PRs (landing order W3, session continuity W4) edit `ccd/session-hook.sh`, `ccd/ccrc-doctor-checks` and `README.md`. B4 edits neither of the first two, and its one README edit is in place inside B2's history section.

**PR:** B4 is one PR. It merges after B2 (⟦D:history-b4-after-b2⟧) and before or after B3 (B1's D-4246 (`history-w1b-three-prs`)). It edits `.github/workflows/ci.yml`, so its CI selects the full suite; the coordinator dispatches the full run. The live-by date, the rollout and any real-data drill are coordinator or operator steps named in the PR body (Task 12), never the worker's.

**Pins (spec §10.5, B4):** each is implemented and tested by the task named:
- **O39**, split by layer: T2 the pure halves (a hot blob with a young referrer, a pruned blob never carried, at least one row); T4 the store halves (published by link never rename, with its CONTROL; an existing name answers `exists`; a kill leaves only the `.tmp`; modes); T5 the segment's contents, marks after the link, a second pass writing nothing new and the hot blob end to end; T7 the kills mid-write and between link and marks, a counter behind the directory, never a replaced name, with the mark-before-link and rename CONTROLs; T8 the late variant and the adopt with segments left behind.
- **O40**: T1 `planExportRoom` is `planCopy` with the 256 MiB bound as the size (size-0 CONTROL); T6 the spawned home-filesystem statfs seam (no segment, `export_paused_low_disk` +1, ingest proceeds in the same tick, the 5 s deadline); T9 doctor's `export-paused-low-disk` WARN.
- **O43**: T11, on T10's replay (expand, describe and `--workspace` after the rebuild; the reused inode).
- **O44's segment case**: T3 the pure `newer` verdict; T10 the step completes and doctor FAILs `export-segment-newer` naming the segment.
- Also carried, though not on §10.5's B4 list: O58's B4 half ("and, in B4, `planSegment`, RD1's one clock"): T2 the pure half (`planSegment` with no reducer argument answers by `EXPORT_REDUCERS.perCopy`, equal to `planExport`'s due set, with O58's two CONTROLs, the node-shortest default and the row clock), T5 the pass (a 30-day home holding only a swap copy brings nothing forward; a transcript with no file left on disk goes whatever its rows' times); O41's B4 cases (T9); O17's `history-export` row and `HISTORY_LANDED` `'B4'` (T6); the O14 and O13 re-checks (T3, T12); O8-shape modes for export files and directories (T4).

**Operator rulings (spec §15.1 and §15.3, rev 3.4; ruled 2026-10-07, binding).** Every question this plan once followed a default for is ruled:
- **Q15 YES: the per-copy due rule** (spec §15.3 Q15 "The alternative"; slug ⟦D:history-export-due-per-copy⟧, B2-defined). A row is due when, for every file holding a copy of it, that file's mtime plus its own home's retention, minus 30 days, has passed (a file gone from disk has passed; a row with no holding file on record is due at once); a blob is due when its rows are. It replaces the node-shortest reducer as the default everywhere the due rule is computed. B2 adds `EXPORT_REDUCERS.perCopy` and makes it `planExport`'s default, so the census's due counts and doctor's `export-due`, `export-overdue` and `retention-lowered` arms follow it before B4 exists; B4's `planSegment` takes the same `reducer` parameter with the same default (Task 2), and the pass passes none (Task 5), so the pass and the census keep one clock (RD1). The per-row file set stays B1's (D-4248 (`history-export-holding-files-by-transcript`): a row's holding files are its transcript's files). The cadence and the preflight are unchanged. Under the ruled rule a 30-day home that holds only swap copies of a 180-day home's transcripts brings nothing forward; only text whose every holding file sits in 30-day homes is due from its file's last write. Doctor's `retention-lowered` WARN stays, as a reminder rather than a gate.
- **Q16 YES: SessionStart(fork) is spooled** (B2; slug `history-fork-spooled`, reversing B1's `history-fork-not-spooled`). No B4 task: B4 writes no spool line and no journal record. A `fork` epoch is an epoch to the export like any other: Task 5 writes every epoch row naming a transcript, its `cause` as stored, and Task 10's replay inserts or fills epochs without reading `cause` against `EPOCH_CAUSES` (`epochs.cause` is TEXT with no CHECK in schema v1). The rollback edge is B2's: a build rolled back to B1 reads a `fork` journal record as malformed and skips it; B1 has no segment replay, so no B4 path meets it.
- **Q17 as recommended** (B1 and B2: the kept-line wording, the close line naming `--purge-history`, the decommission runbook's confirmation). No B4 effect: the export lives under `~/.ccrc/history`, which the kept line names; B4 changes no uninstall wording.
- **Q18 YES, a W2 matter**: before W2's window opens, its open record carries the smallest passing point uptake computed from B1 and B3's data. No W1 task, and none here.
- **Q19 NO, not in W1**: no hand-mapping mode. B4 exports what the store holds and replays it; it maps nothing.
- **Prune at low disk: confirmed.** `history-prune-not-floor-gated` is ruled by the operator, no longer provisional; spec §9.3 is amended so `prune --apply` is gated on reachability only and truncates the WAL after each batch. B4 does not touch prune, and §6.6's "prune never touches the export" still holds.

**Coordinator rulings (RD1–RD4)** (every choice this plan put to the coordinator, as ruled; each NEW slug has its line in "Deviations found"):
- **RD1, accepted as the plan implements them** (each the default the tasks implement, now ruled):
  - the cadence's clock starts at the store's first tick (T1, T6; ⟦D:history-export-cadence-from-first-tick⟧), and a clock that went backwards runs the pass (T1; ⟦D:history-export-cadence-clock-backwards⟧);
  - the pass runs outside the capture pause (T6; ⟦D:history-export-outside-capture-pause⟧);
  - a row whose blob prune already tombstoned travels with a byte-less stub (T2, T5, T10; ⟦D:history-export-pruned-row-stub⟧), not skipped;
  - an unlinked sidecar travels with its blob (T5; ⟦D:history-export-unlinked-sidecar-with-blob⟧), with no v2 migration;
  - doctor's wait arm reads the census's oldest due-since (T2, T9; ⟦D:history-export-wait-from-census⟧);
  - replay gives a gone file's row the carried `eof_ms`, else the segment's cutoff (T10; ⟦D:history-export-dead-file-eof⟧); an unreadable segment stalls the step rather than being skipped (T10; ⟦D:history-export-segment-unreadable-stalls⟧); a replayed variant's first file is the dead-file row of the identity the segment names (T10; ⟦D:history-export-variant-first-file⟧);
  - epoch replay fills the NULL launch facts, `cwd`, `cwd_real` and `confirmed_ms` of the epoch the journal replayed, and skips a seq the journal gave another uuid, counted `export_epoch_conflict` (T10; within ⟦D:history-recovery-replay⟧);
  - `exportWriterLive` is a build fact (`true` in B4's `cli.mjs`), not a measurement (T9);
  - the per-row holding-file set B1 left owed to B4 (B1's D-4248 (`history-export-holding-files-by-transcript`), a NEW departure there) is NOT delivered: a row's holding files stay its transcript's files, so the export and the census keep one clock and doctor's arms stay consistent (T5, T9). The operator's Q15 ruling (rev 3.4) keeps that set as the per-copy rule's per-row set;
  - the segment bound counts each taken row at its new blob bytes plus a flat estimate of its metadata, `EXPORT_ROW_META_BYTES` (1.5 KiB), which also bounds a segment's row count; the first due row of a pass still travels whatever its size (T2, T5; ⟦D:history-export-segment-bound-estimated⟧);
  - a pass that published its segment and then failed to mark it backs off, the wait doubling per such pass up to a day, so a store whose own volume refuses the marks does not publish a copy every hour (T1, T7; ⟦D:history-export-mark-failure-backs-off⟧);
  - a sidecar row first linked after its entry was exported clears that entry's marks, as a late variant does (T8; ⟦D:history-export-late-sidecar-clears-marks⟧);
  - ~~Q15 keeps the ruled reducer~~: **SUPERSEDED** by the operator's Q15 ruling (rev 3.4, 2026-10-07, above). The reducer is now B2's per-copy one, the default of both `planExport` and `planSegment`; what RD1 still holds is the one clock: the pass decides each row through the census's reducer and per-row file set, never a second rule (T2, T5, T9).
- **RD2, rings.** The check after a bind's predicate (which bind facts a check covers, whether this step runs one, which marked segments are missing) and the mark-failure decision (whether a pass backs off, and the next wait) are decisions, so they are lib's (L1) pure functions with pure tests and mutation rows: `decideMarkCheck` and `missingSegmentNames`, `exportMarkFailsOf` and `decideMarkOutcome` (T1). `sweep.mjs` only measures meta, the directory listing and the marked names, calls them and acts (T7, T8).
- **RD3, a busy error between the link and the marks.** The pass records the published segment's seq (`export_seq`) and the attempt clock in one small transaction before it rethrows, so the next tick does not publish the same rows again; a busy is the lock's, not the volume's, so lib leaves the backoff as it stands. If that record itself fails, the first error still ends the tick, the next pass publishes the rows again, and replay absorbs the copy (insert-or-ignore by sha256): a residual the PR body names. Pinned in-process through the test's own connection (T7: two cases and their CONTROLs).
- **RD4, B2's rebuild defect.** B2's Task 28 `journalStoreDirs` (`journalEnds(…)?.head.store_id`) is fixed in B2's plan (it reads `?.headStore`). Task 11 Step 1 keeps its check of the merged base.

## Global Constraints

- **Base and anchors.** B4 executes on `main` after B1 and B2 merge. `ccd/history/*` and the B1/B2 test files are anchored by content (function, const and marker names), never by line numbers. Files that existed before B1 are measured at `f7e51156f` and re-measured on B4's own base. Before editing a B2 function in place (`RECOVER_PHASES`, `parseRecoverCursor`, `RECOVER_EXECUTORS`, `recoveryStep`, B2's cursor tests), re-read B2's MERGED code: its plan text is not ground truth.
- **R1 (entry guards; coordinator ruling).** `sweep.mjs` and `cli.mjs` end in the entry guard `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`. There is no top-level await, and every new block goes ABOVE that guard. `lib.mjs` and `store.mjs` have no guard; new code is appended at their end (except the four Task 1 constants, which must precede `MODE_CHECKED_FILE_ROOTS`). Each new export is declared exactly once in `lib.d.mts` or `store.d.mts`; `skipLibCheck` hides a duplicate, so count them.
- **Rings by imports.** `lib.mjs` is L1, imports only `node:crypto`, and makes every decision: cadence, room, seq, segment plan, the mark-failure backoff, the check after a bind, replay verdict and health (RD2: L4 delivery is not allowed to decide). `store.mjs` is L3, the sole `node:sqlite` importer; it writes and reads segments. `sweep.mjs` and `cli.mjs` are L4 and deliver without deciding. No adapter narrows a distinction: the pass states `paused`, `nothing-due`, `no-horizon`, `held` and `failed` stay distinct, and so do the replay verdicts `newer`, `foreign` and an unreadable segment. `shared/lifecycle.ts` is L0 and imports nothing.
- **Spec values, verbatim.** "Each holding file is measured against its own home's retention" (ruled Q15, rev 3.4): a home's horizon is its retention minus `EXPORT_MARGIN_DAYS` = 30, floored at 0 (B1's `exportHorizonDays`), and "A file's due date is its mtime plus its own home's retention, minus 30 days … A file gone from disk has passed it." The shortest retention over the rostered homes is no longer an input to the due rule; B4 still reads it for one thing only, the cutoff of Task 5's `ts_ms` prefilter, which never decides a row. The pass runs "in the tick's derive step, at most once an hour" (chosen). It writes "One segment per pass, holding every harness's due rows, at most 256 MiB (chosen), within the run budget" (90 s, 512 MiB); the bound counts each taken row's new blob bytes plus `EXPORT_ROW_META_BYTES` for its metadata (⟦D:history-export-segment-bound-estimated⟧). Preflight: "fs.promises.statfs on ~/.ccrc/history/export under the 5 s deadline, then planCopy with that filesystem's free space, its own threshold (§9.3's formula on that filesystem) and the segment bound as the size"; the threshold is min(15 GiB, 10% of the size) plus the run byte budget. "A refusal skips the pass: export_paused_low_disk, doctor WARN. Capture is unaffected."
- **Write.** "store.mjs writes export/<store_id>/.<seq>.<writer>.db.tmp, fsyncs it, and publishes it with link() to <seq>.<writer>.db, which fails if that name exists (the pass then takes the next number); then it unlinks the temp and fsyncs the directory. A segment is never published by rename … and never rewritten." The next seq is one past the highest seq on disk under `export/<store_id>/`, of any writer, and past the one meta last recorded. Segment meta holds `store_id`, writer, seq, harnesses, cutoff and format 1. Blobs are stored as (sha256, codec, raw_len, z). No internal id is written.
- **Mark.** "After the link, one transaction sets exported_ms and exported_seg (the segment's name) on its blobs and entries. A crash before the mark repeats the rows in the next segment, which replay absorbs. A variant first seen after its entry was exported clears that entry's marks." So does a sidecar row first linked to an exported entry (⟦D:history-export-late-sidecar-clears-marks⟧). After any bind (meta `bound:<ms>`, written by B2's `insertBindFacts` for adopt, restore and rebuild), the first tick after a bind fact the last check has not covered (by key, never by clock) clears every mark whose segment is not on this box: counter `export_segment_missing`, doctor WARN. lib decides which keys are bind facts, whether the check runs, what it covers and which segments are missing (RD2). A busy error between the link and the marks records the published seq and the attempt clock before it is rethrown (RD3).
- **Due** (ruled Q15, rev 3.4; ⟦D:history-export-due-per-copy⟧). "A row is due when every one of its holding files has passed its due date … A row with no holding file on record has no clock and is due at once: the export errs early, never late." "A due row is exported with the bytes of every blob it references that is not yet exported, whatever those blobs' younger referrers." A row's holding files are the files of its TRANSCRIPT (B1's `transcriptFiles`, the census's, not the row's own copies through memberships: B1's D-4248 (`history-export-holding-files-by-transcript`), which the ruling keeps), and its own `ts_ms` decides nothing. lib's `planSegment` asks the reducer, never a clock of its own: B2's `EXPORT_REDUCERS.perCopy` is its default, as it is `planExport`'s. A due row is exported whole: the entry's named columns, its variants, its boundary and sidecars, its memberships as (path, dev, ino, line), its transcripts row, every epoch row naming the transcript, and its family's natural key and project. "Pruned blobs are never exported or counted due. prune never touches the export." B2's prune stays gated on reachability only (operator ruling, rev 3.4: `history-prune-not-floor-gated`, ruled).
- **Readers.** "Only the recovery step … through store.mjs's read-only open. The CLI never reads it and never prints from it." `status` may count segment names and sizes but never opens a segment.
- **Replay (the B2 seam).** `export-blobs` and `export-rows` are added to `RECOVER_PHASES` (lib, the sole declaration, O14-bound) AND to the `RECOVER_EXECUTORS` object literal, between `apply` and `reindex`, in the same order; B2's history-recover test holds the two equal. Executor contract: `(db, run, cursor) => {cursor, moved, phaseDone}`, ONE bounded chunk, in its own NORMAL transaction, which also runs `UPDATE derivation_state SET cursor = ? WHERE step = 'recover' AND version = ?` with `run.version`. The executor adds the bytes it read to `run.budget.bytes`, respects `run.budget.chunkBytes`, sets `pairsAdded: run.pairsAdded` on every cursor it commits, and writes no journal record (O36) and no segment. Blobs: "insert-or-ignore by sha256". Rows: "in (seq, writer) order, through the same named-column inserts as ingest, entries by the newest-rank rule". "Families and epochs come from the journal first, and a segment's family and epoch rows fill only what the journal lacks." Memberships go onto a dead-file `ingest_files` row whose `source_key` is `'exported:' + hex(sha256(path ∖0 dev ∖0 ino))`, "never on a live file, even one that now reuses that inode". A newer format is "refused loudly (export-segment-newer, doctor FAIL) and skipped". "Replayed blobs and rows are marked with their segment."
- **Health.** "On a build with it (B4) … it fires only when a due blob has waited more than two pass intervals or the last pass is older than 2 h." `export-overdue` stays on the file clock, unchanged. B4 adds no `HEALTH_WORDS` member: `export-due`, `export-paused-low-disk`, `export-segment-newer` and `export-segment-missing` already exist in B1. New meta keys are spelled once, in `HEALTH_META` (lib) or a single `sweep.mjs` const, and never reuse a B1 or B2 meta name (`export_due`, `export_overdue`, `export_census_ms`, `oldest_row_ms`, `first_due_ms`, `first_deletion_ms`, `bound:<ms>`, `recover_unmoved_ticks`).
- **Modes.** Segment files are 0600; `export/` and `export/<store_id>/` are 0700, including under umask 0002. B1's doctor already mode-checks the `export` root, and `MODE_CHECKED_FILE_ROOTS` is re-pointed at `EXPORT_DIR` in place.
- **Seams and switches.** Test seams are in-process (`ctx.deps.statfs` receives the path; `ctx.deps.exportPageRows` pages Task 5's selection; Task 7's in-process patches of `node:fs` and, for RD3's busy cases, of the `exec` of the test's own writer connection) or test-only preloads. Shipped code reads no new env var, flag or file to arm one, and the `process.env` allow-list stays `HOME`, `TMUX_PANE`, `CLAUDECODE` and `CCRC_SESSION_GENERATION`. `sweep.mjs` never spells `/history-off` (O13 exact holders): history-off is read through the existing `ctx.paths.off`.
- **No `historyPaths` key.** B3 adds `scope` and `card` to `historyPaths`, and B3 and B4 merge in either order. B4 builds `${historyPaths(home).root}/${EXPORT_DIR}/${storeId}`, B2's `RECALL_OFF_DIR` precedent.
- **B2 rulings that bind.** Add no `WRITING_FORMS` entry, so RB6's `GT_FORMS` and the recovering-forms CONTROLs stay green and no new op is refused `recovering`. Prune stays gated on reachability only (ruled by the operator, rev 3.4; no longer provisional) and B4 does not touch it. Display prefixes are untouched. The export pass never runs on the recover arm: `recoverPass` never calls `tick`.
- **Tests.** Run from `server/` with `./node_modules/.bin/vitest run test/<f>.test.ts`, in the FOREGROUND, with a timeout of at least 600000 ms; never bare `npx`. Use fixture HOMEs only (`makeHistoryBox`, `mkTmp`), with `tmux`, `claude` and `gh` poisoned and `CLAUDECODE`, `CLAUDE_CONFIG_DIR`, `TMUX`, `TMUX_PANE` and `CCRC_RECALL_*` scrubbed (B1's helpers do this). Sweep tests skip on darwin (`skipOnDarwin()`, or the `beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); })` spelling O24 also accepts); lib and store tests run there, so Task 4's cases in history-store.test.ts must pass on macOS. They use only node:fs, node:sqlite, a plain-node child (under the fault preload, as B1's own store cases do) and `/bin/sh` for the umask. Every guard is pinned red-first: watch the test fail on the unguarded code, then measure the mutant red after the guard lands, with scratch copies under `.superpowers/sdd/history-w1-b4/scratch` and never `git stash`. The new `history-export.test.ts` joins `ci.yml`'s node-floor heredoc in the same commit; `ci-pipeline` derives the list from `server/test`. CLAUDE.md's load flakes are re-run in isolation before a red is called a break.
- **Citation corpus.** B4 edits none of `ccd/session-hook.sh`, `ccd/ccrc`, `ccd/ccd`, `deploy/deploy.sh` or `server/test/session-hook.test.ts`. `single-definition.test.ts` gets only in-place edits inside B1/B2's end-appended blocks, and no import line. README edits are in place and add no `file.ext:N` token. CLAUDE.md's `README.md (~N lines)` figure is re-measured only if README's line count moves (`pools-prose`: within 100). `ccrc-doctor.test.ts` is cited by line from other tests (`:66`, `:70`, `:195`, `:884` at f7e51156f). B1 inserted the history-CLI link block at `:110-115` (`// The history CLI (spec 2026-10-05 §9.6): …` through `symlinkSync(join(REPO, 'ccd', 'history'), join(ccd, 'history'));`), so at B1's tip (561609adc) the last two read `:200` and `:889`. Neither number named its helper even before that shift (`stubTmux` and `runDoctor` sit at `:283` and `:1028` on `main`). B2 Task 36 Step 4A re-cites both `ccrc-account.test.ts` comments by helper name, so from B2 on only `:66` and `:70` are line cites (`ccrc-install.test.ts`, `pool-name-parity.test.ts`). Refreshing them is never a B4 task. B4's edits to `ccrc-doctor.test.ts` are all in place inside the history describes (from the history imports at `:1248` down: the O41 `export-due` row, the two new `STATES` rows, the steady-state `it` and `cleanInputs` at `:13648`, all at 561609adc), so B4 adds or removes no line above `:1248` and moves no cited line.
- **Deviations.** Never write a deviation number. A departure carries `⟦D:<slug>⟧` with a spec §16 slug, or a NEW kebab slug marked NEW with a one-line why; "Deviations found" lists each. The coordinator mints the numbers. Read existing `D-N` refs in source comments as history and never delete them.
- **Public repo.** No hostnames, usernames, account, wrapper or home names, real pool names, session ids, IPs or docserver URLs in plan text, fixtures, commits or the PR body. Fixtures are synthetic, in the `/home/u/tree` style.
- **Live-box safety.** No worker step touches the live store, journal, export, registry, tmux, units or any account home, and no worker runs `ccd`, `ccrc` or history verbs against the live HOME. The W1-k dates, the rollout and any real-data drill are coordinator or operator steps named in the PR body.

## Review Focus

These are the inputs most likely to break the plan's synthetic fixtures. Each one has a test in its owning task.

1. **`db/` is a symlink onto a roomy volume while the home filesystem holding `~/.ccrc/history/export` is near its floor**, and every home the store's text sits in has no `cleanupPeriodDays` (each newly added account's home, since ccrc never writes the key), so each file's horizon is 0 and, under the per-copy rule, every row is due from its file's last write: the whole store at once.
   - Expected: the preflight statfs-es the export directory on the home filesystem, never `db/`, its link target or any path through the link. It refuses and counts `export_paused_low_disk` without writing a segment, so the root disk is not filled at 256 MiB an hour, while ingest on the volume proceeds.
   - Owning task: **Task 6**, `O40 / RC9: the preflight statfs-es ~/.ccrc/history/export and never db/, even with db/ a link onto a roomier volume; …` (a `ctx.deps.statfs` stub that records the path it receives and answers differently for `/export` and `db/`), and the spawned `O40: below the home filesystem's own floor the pass is skipped … and the same pass still ingests`. Every fixture home carries no `cleanupPeriodDays`, so each runs at horizon 0.
2. **A segment write fails halfway** between the preflight and the link: a statement throws (the stand-in for `SQLITE_FULL`), history-off appears between rows, or the run's wall clock runs out.
   - Expected: on a throw or history-off, nothing is published or marked, and the `.tmp` (with any SQLite sidecar) is removed now, or by the next step whose cadence runs, before its preflight, so a pause for room never keeps it; the scheduled pass still exits 0, its ticks row and census still run, a failure counts `export_write_failed` with one stderr line, and the next tick ingests. On the wall clock, the rows already written are published and marked (each row is whole, its dependencies before it in the shared `ord`) and the rest wait.
   - Owning tasks: **Task 7**, `a failed segment write removes its temp, marks nothing, is counted, and the pass exits 0; …`, `a stale temp goes before the preflight: …` and, for a failure after the link, `a pass that published its segment and could not mark it backs off: …` and, for a busy there (RD3), `a busy error between the link and the marks: …` with `RD3's residual: …`; **Task 5**, `history-off between rows: …` and `the wall clock: …`; **Task 4**, `O39: a kill at the link leaves only the temp, and removeStaleSegmentTemps removes it with its sidecars and nothing else`.
3. **Steady state on a node with a 180-day home and the hourly pass live**, read at every phase offset between census, pass and the next census; separately, the first day after B4 lands on a node whose 30-day homes hold text no longer-retention home holds (under the per-copy rule, due from its file's last write), with a multi-GB backlog.
   - Expected: steady state reads PASS at every offset (the census's due-since is at most about 1.5 h stale, under two pass intervals), so no false `export-due` WARN keeps W1-g from passing. That holds only if every due blob is selectable. The pass offers every row of each transcript the census's `dueTranscriptKeys` makes due, its young rows included, so its candidates cover the census's due set (Task 5), and a sidecar linked after its entry was exported clears the entry's marks (Task 8), so no due blob is left that no pass would take. A due blob the pass could not select would keep `export-due` WARNing for good, which is what the due-transcript phase rules out. The backlog day WARNs `export-due` truthfully until the segments drain at one an hour. Neither FAILs, so `ccrc update` does not exit 3 on it.
   - Owning task: **Task 9**, the pure `steady state at every phase between a census, a pass and the next census: PASS ok, nothing to warn` and `a due blob that has waited more than two pass intervals WARNs export-due, …`, and doctor's `O41 (B4): steady state … PASSes ok` with the two `O41 (B4)` `STATES` rows (`absent: ['FAIL history: ']`).
4. **A family re-keyed** (a gen-less `''` family merged into (id, G)) **or a `/clear` epoch chained after its rows were exported**, then transcripts and `history.db` lost, and `doctor --rebuild` replaying the journal and then the segments.
   - Expected: the rows phase resolves a segment's family through `merged_into` and the journal's epochs. It fills only NULL columns (launch facts, `cwd` and `cwd_real`, `confirmed_ms`) on the epoch the journal replayed, never creates a second family or a duplicate epoch, and skips and counts an epoch whose seq the journal gave another uuid.
   - Owning tasks: **Task 10**, `journal first: a segment's family and epoch rows fill only what the journal lacks, through merged_into; …`; **Task 11**, `O43: exported, then the transcript and history.db lost: …` (`--workspace` reaches the family through the replayed epoch's `cwd`).
5. **A long-lived session whose early rows were exported while its transcript kept growing**; `history.db` lost but the transcript (or a swap copy) still there, so after the rebuild `exported:` dead-file rows and re-ingested live rows coexist.
   - Expected: B2's `pickHoldingCopy` prefers the live copy; `expand` prints each row once; leaf ids equal the lost store's; memberships on the `exported:` row never merge into the live row; re-ingest leaves the replayed marks set, so nothing is exported twice.
   - Owning task: **Task 11**, `review focus: the same rebuild with the live transcript KEPT: …`, and `O43, a reused inode: …`.
6. **A store adopted on a new box, its old `export/<store_id>/` carried over AFTER the verb**, so its segments arrive once the marks were already cleared and re-exported; a restore later.
   - Expected: the bind check cleared the marks once, and the rows were re-exported under the new writer token. The carried segments never collide by name (seq counts past every name on disk; the writer tokens differ). Replay applies both copies in (seq, writer) order and absorbs the duplicates through insert-or-ignore and newest-rank. `export_segment_missing`'s WARN clears once the re-export leaves nothing due behind.
   - Owning tasks: **Task 8**, `O39: after an adopt with the segments left behind, …` and `the check runs on the first step after a bind and not again until the next one: …`; **Task 7**, `a counter behind the directory: …`; **Task 10**, `BK21: …` (two writers' segments replayed in (seq, writer) order).
7. **A newly rostered home on the 30-day default that holds only swap copies of a 180-day home's transcripts**; separately, a transcript whose every file was deleted early (a cleaned worktree, a hand `rm`) while its rows are days old, on a node whose every home keeps 180 days.
   - Expected (ruled Q15, rev 3.4; ⟦D:history-export-due-per-copy⟧): the swap copies bring nothing forward, because each row waits for its 180-day copy; once that copy is gone from disk the 30-day copy alone decides and the rows go. The early-deleted transcript's rows are taken at the next pass whatever their own time, though the `ts_ms` prefilter (the shortest home's horizon, 150 days back) would pass over them: their text may already be the store's only copy. So are a transcript's young rows held only by a file deleted early while an older file of it stays on disk, once that older file passes. `planSegment` and the census's `planExport` answer the same rows due (RD1's one clock), and the pass walks the same due transcripts as the census's prefilter.
   - Owning tasks: **Task 2**, `O58 (B4 half): with no reducer argument …` and `RD1's one clock: …`; **Task 5**, `Q15, per copy: a 30-day home that holds only a swap copy brings nothing forward …`, `per copy: a transcript whose every holding file is gone has its rows taken whatever their own time …` and `per copy: once its transcript is due, a young row held only by a file gone from disk is taken …`, each with a CONTROL mutant (the node-shortest default, the due-transcript phase deleted, and that phase narrowed to transcripts with no file on disk).

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `ccd/history/lib.mjs` | modify | The export constants (above `MODE_CHECKED_FILE_ROOTS`); segment names, order and numbering; `decideExportPass` (with its `intervalMs`), `exportPassIntervalMs` and `EXPORT_MARK_BACKOFF_MAX_MS`, `planExportRoom`, `exportedSourceKey`; the marks' decisions (RD2): `exportMarkFailsOf`, `decideMarkOutcome`, `decideMarkCheck`, `missingSegmentNames`; `EXPORT_ROW_META_BYTES`, `planSegment` and `planExport`'s `oldestDueSinceMs`; `RECOVER_PHASES` with the export phases, the cursor's export arm, `decideSegmentReplay`; `HEALTH_META`'s three new keys; `MODE_CHECKED_FILE_ROOTS`' `EXPORT_DIR`; `deriveHealth`'s `export-due` arms with their detail and remedy; the census due-since's one writer and one reader (`EXPORT_DUE_OLDEST_UNMEASURED`, `exportDueOldestMeta`, `readExportDueOldest`) | L1 | 1, 2, 3, 9 |
| `ccd/history/lib.d.mts` | modify | One declaration per new lib export and type (`ExportProbe`, `ExportRoom`, `ExportMarkOutcome`, `SegmentBlob`, `SegmentCandidate`, `SegmentPlan`); `HEALTH_META`'s keys; `planExport`'s widened answer; `HealthInputs`' two new fields; the due-since meta's three declarations | types | 1, 2, 3, 9 |
| `ccd/history/store.mjs` | modify | The segment format (`SEGMENT_DDL` from one row-table declaration); `ensureSegmentDir`, `createSegment`, `segmentInserts`, `publishSegment`, `setSegmentSeq`, `openSegment`, `segmentMeta`, `segmentBlobsAfter`, `segmentRowsAfter`, `listSegments`, `removeStaleSegmentTemps` | L3 | 4 |
| `ccd/history/store.d.mts` | modify | One declaration per new store export, with `SegmentMeta`, `SegmentHandle`, `SegmentRows`, `SegmentRowKind`, `SegmentInserts`, `SegmentRowRead`, `SegmentBlobRow`, `SegmentInt` | types | 4 |
| `ccd/history/sweep.mjs` | modify | Placeholder, then real, export executors in `RECOVER_EXECUTORS`; `exportPass` (select, write, publish, mark), its EEXIST retry, its mark-failure record and its busy record (RD3); `exportStep` in the tick (bind check, cadence with its backoff, stale temps, preflight), acting on lib's mark decisions (RD2); `checkSegmentMarks`; the late-variant mark clear in B1's `writeChunk` and the late-sidecar one in B1's `ingestSidecar`; the census's oldest due-since; segment replay. Every block above the R1 guard | L4 | 3, 5, 6, 7, 8, 9, 10 |
| `ccd/history/cli.mjs` | modify | The status envelope's export block (`last_pass_ms`, `due_oldest_ms`, `paused_low_disk`; `segments` and `segment_bytes` by name and size); `healthInputsOf` sets `exportWriterLive: true` and maps the new inputs. In place, above the R1 guard | L4 | 9 |
| `shared/lifecycle.ts` | modify | The `history-export` row (pattern O, creators `ccd/history/sweep.mjs (through store.mjs)`, collector null, kept with the store) | L0 | 6 |
| `server/test/lifecycle.test.ts` | modify | `HISTORY_LANDED` gains `'B4'`; the case `declares history-export: an O class the sweep writes through store.mjs, kept with the store` | test | 6 |
| `server/test/history-lib.test.ts` | modify | Appended pure describes (Tasks 1, 2, 3, 9); B2's `RecoverCursor` describe edited in place (five phases; `export-segments` as the invalid token); B1's `base()` literal gains the two new `HealthInputs` fields | test | 1, 2, 3, 9 |
| `server/test/history-store.test.ts` | modify | Appended segment I/O describe: link never rename with its CONTROL, `EEXIST`, a kill leaving only the temp, modes under umask 0002, no SQLite sidecar left, the format-1 literal, the read-only open | test | 4 |
| `server/test/history-export.test.ts` | create | The export pass in-process (Task 5), the export in the tick (Task 6), crash and collision safety, with RD3's busy cases (Task 7), marks that move (Task 8), the census's due-since and status's export block (Task 9) | test | 5, 6, 7, 8, 9 |
| `server/test/history-recover.test.ts` | modify | Appended: the export phases in the recovery step (Task 3); segment replay with O44's segment case (Task 10); O43 (Task 11) | test | 3, 10, 11 |
| `server/test/historyHelpers.ts` | modify | Appended: `exportDirOf`, `segmentsOf`, `segmentRows` (Task 5); `SegmentRowKind`, `PlantSegmentRow`, `PlantSegmentBlob`, `PlantSegmentSpec`, `segmentSha`, `plantSegment`, built through store.mjs (Task 10) | test helper | 5, 10 |
| `server/test/fixtures/history/preload-statfs.mjs` | modify | An appended block: `HISTORY_TEST_STATFS_EXPORT=<bavail>:<size>\|hang\|throw`, answering only statfs calls under `/.ccrc/history/export` | test fixture | 6 |
| `server/test/ccrc-doctor.test.ts` | modify | In place, inside B1's history describes: O41's `export-due` row re-planted on the last-pass arm; rows for the wait arm and `export-paused-low-disk`; a steady-state PASS case; `cleanInputs` gains the two new fields | test | 9 |
| `server/test/history-cli.test.ts` | re-run only | Its STATUS_SQL cost pin is re-run; B1 put `base()` in `history-lib.test.ts`, so this file is not edited (Task 9's Files list says why). Re-checked after B1's fix round 3 (at 561609adc): its one changed status row pins the refused-node count, its `Envelope` type's `export` member (`:35`) is a read-side annotation, and no case asserts the whole `export['claude-code']` object (`:341` pins only `Object.keys(e.export)`), so B4's new members stay additive here | test | 9 |
| `.github/workflows/ci.yml` | modify | The node-floor leg's heredoc gains `test/history-export.test.ts`; its deadline only if Task 12 Step 5 measures past 15 minutes | CI | 5, 12 |
| `server/test/single-definition.test.ts` | modify, only if needed | `VOCABS` gains any NEW frozen lib vocabulary, in place; none is expected | test (citation corpus) | 12 |
| `README.md` | modify | One in-place reflow in B2's history section: the store and its export are the text's only copies, the export's place and cadence, and `--rebuild` replays it (⟦D:history-readme-export-sentence⟧, NEW: §10.5 assigns B4 no README edit). No `file.ext:N` token | docs (citation corpus) | 12 |
| `CLAUDE.md` | modify, only if needed | The `README.md (~N lines)` figure, re-measured only if README's count moved | docs | 12 |

---

### Task 1: lib: export constants, segment names, their order and numbering, the hourly cadence, the room verdict, the exported: source key, the new meta keys, and the marks' two decisions (the mark-failure backoff and the check after a bind)

**Files:**
- Modify: `ccd/history/lib.mjs` (B1-created; B2 appends to it). Anchors are by content:
  - insert four constants directly below B1's constants-block line `export const EXPORT_MARGIN_DAYS = 30;`. They must sit ABOVE B1 Task 28's `MODE_CHECKED_FILE_ROOTS`, which names `EXPORT_DIR`: a `const` read before its declaration is a TDZ error when the module loads, so the block appended at the end cannot carry them;
  - in place, B1 Task 28's health block: the `MODE_CHECKED_FILE_ROOTS` declaration (its `'export'` member becomes `EXPORT_DIR`, every other member as it stands; B3 may have re-pointed `'card'`), and `HEALTH_META` (three members after `exportSegmentMissing`);
  - append one block at the END of the file (lib.mjs has no entry guard).
- Modify: `ccd/history/lib.d.mts`: `HEALTH_META`'s declaration in place (three members), and one block appended at the end.
- Test: `server/test/history-lib.test.ts` (B1-created): append one block at the END of the file. Its one import statement is at the block's head (ESM hoists it), the B2 Task 9 idiom, so no line above the end moves.
- Scratch, gitignored, never committed: `.superpowers/sdd/history-w1-b4/scratch/mutate.mjs` and `.superpowers/sdd/history-w1-b4/scratch/mutants-task1.json`.

**Interfaces:**
- Consumes (B1 `lib.mjs`, same module; re-read each on the base before editing):
  - `planCopy({ freeBytes, thresholdBytes, sizeBytes }): { admit: boolean; needBytes: number | null }` (admits only when free space EXCEEDS threshold + size);
  - `floorThreshold(fsSizeBytes, runBudgetBytes = RUN_BUDGET_BYTES)` (min(15 GiB, 10% of the size) plus one run's byte budget);
  - `WRITER_RE`, `sha256Hex(data)`;
  - B1 Task 28: `HEALTH_META` (keys `recoverUnmovedTicks`, `exportSegmentNewer`, `exportSegmentMissing`), `modeWantOf(rel, kind)`, and the module-private `MODE_CHECKED_FILE_ROOTS`.
- Consumes (B1 `sweep.mjs`, as a shape only): `statfsWithDeadline(p, ms, statfs)`'s answer, `{ state: 'ok', bytes, fsSize } | { state: 'unsettled' } | { state: 'threw' }`. `planExportRoom` takes exactly that answer; re-read it on the base, and if the merged shape differs, stop and report rather than adapt it here.
- Produces (`lib.mjs`, each declared once in `lib.d.mts`):
  - `export const EXPORT_DIR = 'export'`, `EXPORT_SEGMENT_MAX_BYTES = 256 * 1024 * 1024`, `EXPORT_PASS_INTERVAL_MS = 60 * 60 * 1000`, `EXPORT_SEGMENT_FORMAT = 1`;
  - `segmentName({ seq, writer }): string` → `<seq>.<writer>.db` (throws `TypeError` off the grammar);
  - `parseSegmentName(name): { seq: number; writer: string } | null`, by the module-private `SEGMENT_NAME_RE = /^([1-9][0-9]{0,15})\.([0-9a-f]{8})\.db$/` with `seq` a safe integer;
  - `segmentTempName(name): string` → `.<name>.tmp` (throws `TypeError` for a non-segment name);
  - `orderSegmentNames(names: readonly string[]): string[]`: `(seq, writer)` order, seq numerically, non-segment names dropped;
  - `nextSegmentSeq({ onDisk: readonly number[]; recorded: number | null }): number`;
  - `decideExportPass({ nowMs, lastPassMs: number | null, firstTickMs: number | null, intervalMs?: number }): 'run' | 'wait'` (`intervalMs` defaults to `EXPORT_PASS_INTERVAL_MS`);
  - `EXPORT_MARK_BACKOFF_MAX_MS = 24 * EXPORT_PASS_INTERVAL_MS` and `exportPassIntervalMs(markFails: number): number`: an hour, doubled for each pass in a row that published its segment and failed to mark it, at most a day (Task 7 records the count and passes the answer as `intervalMs`);
  - `type ExportProbe` (the statfs answer above), `interface ExportRoom { admit; word: 'ok' | 'low-disk' | 'unsettled'; needBytes: number | null }`, `planExportRoom(free: ExportProbe): ExportRoom`;
  - `exportedSourceKey(path: string, dev: string | number | bigint, ino: string | number | bigint): string` = `'exported:' + sha256Hex(path ∖0 dev ∖0 ino)`, dev and ino in decimal;
  - `HEALTH_META` gains `exportPassMs: 'export_pass_ms'`, `exportDueOldestMs: 'export_due_oldest_ms'`, `exportPaused: 'export_paused'`;
  - `MODE_CHECKED_FILE_ROOTS`' export member is `EXPORT_DIR`;
  - the marks' two decisions (coordinator ruling RD2: the sweep measures, calls these and acts):
    - `exportMarkFailsOf(recorded: string | null): number`: the count meta `export_mark_fails` holds; text off the grammar (module-private `EXPORT_MARK_FAILS_RE = /^(0|[1-9][0-9]{0,15})$/`) or past the safe integers is 0;
    - `type ExportMarkOutcome = 'marked' | 'mark-failed' | 'mark-busy' | 'write-failed'` and `decideMarkOutcome({ outcome, recorded }): { markFails: number; write: string | null; intervalMs: number }`: whether a pass backs off and the next wait. `'mark-failed'` counts one more and writes it; `'marked'` ends the backoff, writing `'0'` only over another value; `'mark-busy'` (RD3) and `'write-failed'` leave the count and write nothing; any other outcome throws `TypeError`. `intervalMs` is `exportPassIntervalMs` of the count that stands;
    - `decideMarkCheck({ metaKeys: readonly string[]; checkedRecord: string | null }): { check: boolean; facts: string[]; record: string }`: the bind facts among the keys (module-private `BIND_FACT_RE = /^bound:[0-9]{1,16}$/`), sorted; `check` when one is not in the last check's record (a JSON list; one that does not parse, or is not a list, covers nothing), by KEY and never by clock; `record` the JSON list the check writes;
    - `missingSegmentNames({ named: Iterable<string>; present: Iterable<string> }): string[]`: the marked names this box does not hold, once each, sorted.
- Later consumers: Task 3 (`parseSegmentName`, `EXPORT_SEGMENT_FORMAT`), Task 4 (`segmentName`, `segmentTempName`, `parseSegmentName`, `orderSegmentNames`), Task 5 (`nextSegmentSeq`, `EXPORT_SEGMENT_MAX_BYTES`, `EXPORT_DIR`, `HEALTH_META.exportPassMs`), Task 6 (`decideExportPass`, `planExportRoom`, `HEALTH_META.exportPaused`), Task 7 (`exportPassIntervalMs` and `exportMarkFailsOf`, passed to `decideExportPass` as `intervalMs`; `decideMarkOutcome` in `markExported`, the failure record and the busy record), Task 8 (`decideMarkCheck`, `missingSegmentNames`), Task 9 (`EXPORT_PASS_INTERVAL_MS`, `HEALTH_META.exportDueOldestMs`), Task 10 (`exportedSourceKey`, `orderSegmentNames`). No `historyPaths` key: B3 edits `historyPaths` and B1 pins its exact object, so the export directory is `${historyPaths(home).root}/${EXPORT_DIR}`, B2's `RECALL_OFF_DIR` precedent.

**Spec:** §9.15 "The pass" (Preflight: `planCopy` with the export filesystem's free space, its own threshold and the segment bound as the size; Write: `<seq>.<writer>.db`, the next seq past every name on disk and past meta's), §9.3 (the floor's formula, a probe that throws is low-disk), §6.2 (`ingest_files.source_key` `exported:<hex>`), §9.15 "Memberships of a gone file", §9.6 (segment files 0600), §9.15 "Mark" and "After a bind" (the decisions RD2 moves into lib). Pins: **O40**'s pure half (the room verdict at its boundary, with RC9's CONTROL), **O39**'s numbering half (a counter behind the directory moves past it), the cadence, and the pure halves of the mark-failure backoff and the check after a bind (Tasks 7 and 8 pin their sweep halves). Departures:
- ⟦D:history-sole-copy-export⟧, B1's D-4226 (`history-journal-writer-token`) (one number space per store, the writer token in every name), ⟦D:history-backup-preflight-and-rename⟧ (`planCopy` is the one copy preflight), B1's D-4179 (`history-free-space-floor`).
- ⟦D:history-export-cadence-from-first-tick⟧ (NEW): the hourly clock runs from the store's first tick until the first pass, so a new store writes no segment in its first hour, the pass and doctor's last-pass rule read one clock, and B1/B2 fixtures with the 30-day default keep their writes.
- ⟦D:history-export-cadence-clock-backwards⟧ (NEW): a last pass (or first tick) stamped after now means the wall clock went back; the pass runs rather than wait days for the clock to catch up, because a late segment widens the sole-copy window and an early one costs nothing.
- ⟦D:history-export-mark-failure-backs-off⟧ (NEW, wired by Task 7): §9.15 says "at most once an hour" and that a crash before the mark repeats the rows; a pass that published its segment and then failed to mark it would repeat them every hour, so the wait doubles per such pass in a row, at most a day. This task decides the count after each outcome and the interval (RD2); Task 7 measures the outcome, records what this task answers, and passes the interval to the cadence.
- The check after a bind reads bind facts by KEY (B1's D-4226 (`history-journal-writer-token`): each mark names its segment, cleared when the segment is missing after a bind); this task decides which keys are facts, whether a step checks and what it covers (RD2), and Task 8 measures and acts.

Choices this task makes (each copied into the PR body by Task 12 Step 9):
- **The floor on the home filesystem** (B1's D-4179 (`history-free-space-floor`)): `planExportRoom` applies the floor's own formula, `floorThreshold` of that filesystem's size, to the home filesystem the export lives on, with the segment bound as the copy's size; the store's floor on `db/` is not consulted. Replay of a segment keeps the store's floor, with no exemption (Task 10).
- The marks' decisions are lib's, by coordinator ruling RD2 (L4 delivery is not allowed to decide): `decideMarkOutcome` answers the count, the meta text to write and the next wait for each pass outcome; `decideMarkCheck` answers whether a step checks and the record it writes; `missingSegmentNames` answers which marked segments this box lacks. Tasks 7 and 8 measure meta, the listing and the marked names, call them and act.
- A marked pass writes `'0'` only over another value, so a store that never failed a mark gains no `export_mark_fails` key (Task 6 Step 7's exact meta listings stay as they are); a busy after the link (`'mark-busy'`, RD3) is the write lock's, not the volume's, so it leaves the backoff as it stands.
- A check record that does not parse, or is not a JSON list, covers nothing, so the check runs rather than miss a bind; a stray `bound:` key off `BIND_FACT_RE` is no bind fact.
- `orderSegmentNames` is declared here, beside the name grammar, not with Task 3's replay decisions: Task 4's `listSegments` orders by it.
- `exportedSourceKey` refuses a path holding a NUL (it could forge a separator; no POSIX path holds one) and a dev or ino that is not a non-negative integer. A BigInt dev or ino is rendered in decimal, as B1's `retired:` key renders the store's.
- `exportedSourceKey` accepts an EMPTY path. Task 5 writes `''` for a file row whose paths were all re-pointed (a retired row keeps none), and Task 10 keys that file's dead-file row from it; the key is still unique per (dev, ino) and never equals a live row's `''`.
- The new meta keys were checked against every meta name B1 and B2 write (`export_due`, `export_overdue`, `export_census_ms`, `oldest_row_ms`, `first_due_ms`, `first_deletion_ms`, `bound:<ms>`, `recover_unmoved_ticks`, and Task 5's `export_seq`): none is reused. Before Step 4, re-run `grep -rn "'export_" ccd/history/` on the base; a hit naming one of the three new keys is a stop.

- [ ] **Step 1: Write the mutation runner.** It is a gitignored scratch tool (`.superpowers/` is in `.gitignore`), never committed: B2's runner with its scratch path moved to this plan's directory. Tasks 1–4 write this same file, byte for byte, so each task stands alone and rewriting it changes nothing. A mutant is `{name, file, test, filter, edits: [{anchor, replacement}]}`, and each anchor must occur exactly once in the file as the earlier edits leave it. For each mutant the runner copies the pristine file to `.superpowers/sdd/history-w1-b4/scratch/keep/`, applies the edits and runs the named tests, which must fail; it then restores the file from the copy, removes the copy, and runs the same tests again, which must pass. Only a kill no handler sees leaves a copy in `scratch/keep/`; the next run then refuses, and the runner's header gives the one-line restore. From the repository root:

```bash
mkdir -p .superpowers/sdd/history-w1-b4/scratch/keep
cat > .superpowers/sdd/history-w1-b4/scratch/mutate.mjs <<'EOF_RUNNER'
// .superpowers/sdd/history-w1-b4/scratch/mutate.mjs: measures each guard RED with it mutated, then GREEN with
// it restored (the B4 plan's mutation-pin rule). Run from server/, in the foreground, with a timeout of at least
// 600000 ms:
//   node ../.superpowers/sdd/history-w1-b4/scratch/mutate.mjs <mutants.json>
// A mutant is {name, file, test, filter, edits: [{anchor, replacement}]}. `file` is repo-relative, `test` is
// server/-relative, and each anchor must occur exactly once in the file as the earlier edits leave it. The
// pristine file is copied to scratch/keep/<file with '/' as '__'>.orig BEFORE it is touched, and the copy is
// removed only after the file is restored from it. A kill no handler sees therefore leaves the original findable,
// and the next run REFUSES while any copy is left. To restore by hand, from the repository root:
//   for f in .superpowers/sdd/history-w1-b4/scratch/keep/*.orig; do t="$(basename "$f" .orig)"; cp "$f" "${t//__//}" && rm "$f"; done
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const KEEP = '../.superpowers/sdd/history-w1-b4/scratch/keep';
mkdirSync(KEEP, { recursive: true });
const left = readdirSync(KEEP).filter((n) => n.endsWith('.orig'));
if (left.length > 0) {
  console.log(`REFUSED: ${left.join(', ')} in ${KEEP}. An earlier run was interrupted and a source may hold a mutant: restore as this file's header says.`);
  process.exit(1);
}
const keepOf = (file) => `${KEEP}/${file.replaceAll('/', '__')}.orig`;
const restoreAll = () => {
  for (const n of readdirSync(KEEP)) {
    if (!n.endsWith('.orig')) continue;
    copyFileSync(`${KEEP}/${n}`, `../${n.slice(0, -'.orig'.length).replaceAll('__', '/')}`);
    rmSync(`${KEEP}/${n}`);
  }
};
// Every way out restores: the loop's end, process.exit and an uncaught throw all emit 'exit', and a signal is
// turned into an exit. A signal sent while the synchronous loop holds the thread is handled after the current
// child returns; a Ctrl-C also reaches the vitest child, and the loop stops on the child's signal below.
process.on('exit', restoreAll);
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => process.exit(130));
const vitest = (test, filter) => spawnSync('./node_modules/.bin/vitest', ['run', test, '-t', filter], { encoding: 'utf8' });
const mutants = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let bad = 0;
for (const m of mutants) {
  const target = `../${m.file}`;
  if (!existsSync(target)) { console.log(`NO SUCH FILE       ${m.name}`); bad += 1; continue; }
  const keep = keepOf(m.file);
  copyFileSync(target, keep);
  let src = readFileSync(keep, 'utf8');
  let unique = true;
  for (const e of m.edits) {
    const at = src.indexOf(e.anchor);
    if (at < 0 || src.indexOf(e.anchor, at + 1) >= 0) { unique = false; break; }
    src = src.slice(0, at) + e.replacement + src.slice(at + e.anchor.length);
  }
  if (!unique) { rmSync(keep); console.log(`ANCHOR NOT UNIQUE  ${m.name}`); bad += 1; continue; }
  writeFileSync(target, src);
  const red = vitest(m.test, m.filter);
  copyFileSync(keep, target);
  rmSync(keep);
  if (red.signal !== null) { console.log(`INTERRUPTED (${red.signal})  ${m.name}`); process.exit(130); }
  const failed = /Tests\s+(\d+) failed/.exec(red.stdout)?.[1] ?? '?';
  if (red.status === 0) { console.log(`STAYED GREEN       ${m.name}`); bad += 1; } else console.log(`red (${failed} failed)   ${m.name}`);
  const green = vitest(m.test, m.filter);
  if (green.signal !== null) { console.log(`INTERRUPTED (${green.signal})  ${m.name}`); process.exit(130); }
  if (green.status !== 0) { console.log(`RED AFTER RESTORE  ${m.name}`); bad += 1; } else console.log(`green              ${m.name}`);
}
console.log(bad === 0 ? 'every guard measured red, then green' : `${bad} guard(s) not measured`);
process.exit(bad === 0 ? 0 : 1);
EOF_RUNNER
```

- [ ] **Step 2: Write the failing tests.** Append to the END of `server/test/history-lib.test.ts` (B1's top-of-file `createHash` import from `node:crypto` is used as is):

```ts
// ===========================================================================
// W1-B4 Task 1: the sole-copy export's names, numbers, cadence, room and
// dead-file key (spec §9.15 "The pass", §9.3, §6.2; O39's numbering half, O40's
// pure half). Pure, on lib.mjs alone.
// ===========================================================================
import * as libSeg from '../../ccd/history/lib.mjs';

describe('W1-B4: segment names, their order and the next number (spec 9.15 "Write"; O39 numbering half)', () => {
  const W = '0a1b2c3d';
  it('the constants are the spec\'s chosen values, and MODE_CHECKED_FILE_ROOTS judges a segment and its temp under EXPORT_DIR', () => {
    expect(libSeg.EXPORT_DIR).toBe('export');
    expect(libSeg.EXPORT_SEGMENT_MAX_BYTES).toBe(256 * 1024 * 1024);
    expect(libSeg.EXPORT_PASS_INTERVAL_MS).toBe(3_600_000);
    expect(libSeg.EXPORT_SEGMENT_FORMAT).toBe(1);
    const sid = '0189abcd-1234-4678-9abc-0000000000e1';
    const name = libSeg.segmentName({ seq: 7, writer: W });
    expect(libSeg.modeWantOf(`${libSeg.EXPORT_DIR}/${sid}/${name}`, 'file')).toBe('0600');
    expect(libSeg.modeWantOf(`${libSeg.EXPORT_DIR}/${sid}/${libSeg.segmentTempName(name)}`, 'file')).toBe('0600');
    expect(libSeg.modeWantOf(`${libSeg.EXPORT_DIR}/${sid}`, 'dir')).toBe('0700');
  });
  it('segmentName, parseSegmentName and segmentTempName agree, and nothing off the grammar names a file', () => {
    expect(libSeg.segmentName({ seq: 12, writer: W })).toBe('12.0a1b2c3d.db');
    expect(libSeg.parseSegmentName('12.0a1b2c3d.db')).toEqual({ seq: 12, writer: W });
    expect(libSeg.segmentTempName('12.0a1b2c3d.db')).toBe('.12.0a1b2c3d.db.tmp');
    for (const bad of ['012.0a1b2c3d.db', '0.0a1b2c3d.db', '12.0A1B2C3D.db', '12.0a1b2c3.db', '.12.0a1b2c3d.db.tmp',
      '12.0a1b2c3d.db-journal', '12.0a1b2c3d.jsonl', '9999999999999999.0a1b2c3d.db', '12345678901234567.0a1b2c3d.db', '']) {
      expect(libSeg.parseSegmentName(bad), bad).toBeNull();
    }
    expect(libSeg.parseSegmentName('9007199254740991.0a1b2c3d.db')).toEqual({ seq: Number.MAX_SAFE_INTEGER, writer: W });
    expect(() => libSeg.segmentName({ seq: 0, writer: W })).toThrow(TypeError);
    expect(() => libSeg.segmentName({ seq: 1.5, writer: W })).toThrow(TypeError);
    expect(() => libSeg.segmentName({ seq: 3, writer: '../x' })).toThrow(TypeError);
    expect(() => libSeg.segmentTempName('../12.0a1b2c3d.db')).toThrow(TypeError);
  });
  it('orderSegmentNames is (seq, writer) with seq numeric, never the names\' lexical order; a non-segment is dropped', () => {
    expect(libSeg.orderSegmentNames(['10.0000000a.db', '9.ffffffff.db', '.9.0000000b.db.tmp', 'notes.db', '9.0000000b.db', '01.0000000a.db']))
      .toEqual(['9.0000000b.db', '9.ffffffff.db', '10.0000000a.db']);
  });
  it('O39: nextSegmentSeq is one past every seq on disk, of any writer, and past meta\'s; a counter behind the directory moves past it', () => {
    expect(libSeg.nextSegmentSeq({ onDisk: [], recorded: null })).toBe(1);
    expect(libSeg.nextSegmentSeq({ onDisk: [3, 9, 4], recorded: 5 })).toBe(10);
    expect(libSeg.nextSegmentSeq({ onDisk: [3], recorded: 12 })).toBe(13);
    expect(libSeg.nextSegmentSeq({ onDisk: [2], recorded: Number.NaN })).toBe(3);
  });
});

describe('W1-B4: the hourly cadence, the room verdict and the dead-file key (spec 9.15 "The pass", 9.3, 6.2; O40 pure half)', () => {
  const H = 3_600_000;
  const T = Date.UTC(2026, 11, 1);
  it('decideExportPass: within the hour of the last pass, or of the first tick before any pass, it waits; from the hour on it runs', () => {
    expect(libSeg.decideExportPass({ nowMs: T, lastPassMs: T - H + 1, firstTickMs: T - 10 * H })).toBe('wait');
    expect(libSeg.decideExportPass({ nowMs: T, lastPassMs: T - H, firstTickMs: T - 10 * H })).toBe('run');
    expect(libSeg.decideExportPass({ nowMs: T, lastPassMs: null, firstTickMs: T - H + 1 })).toBe('wait');
    expect(libSeg.decideExportPass({ nowMs: T, lastPassMs: null, firstTickMs: T - H })).toBe('run');
    expect(libSeg.decideExportPass({ nowMs: T, lastPassMs: null, firstTickMs: null })).toBe('wait');
  });
  it('decideExportPass: a clock that went backwards runs the pass rather than wait for it to catch up', () => {
    expect(libSeg.decideExportPass({ nowMs: T, lastPassMs: T + 24 * H, firstTickMs: T - 10 * H })).toBe('run');
    expect(libSeg.decideExportPass({ nowMs: T, lastPassMs: null, firstTickMs: T + 1 })).toBe('run');
  });
  it('exportPassIntervalMs: an hour, doubled for each pass in a row that published and could not mark, at most a day; decideExportPass waits that interval', () => {
    expect([0, 1, 2, 3, 4, 5, 99].map((n) => libSeg.exportPassIntervalMs(n))).toEqual([H, 2 * H, 4 * H, 8 * H, 16 * H, 24 * H, 24 * H]);
    for (const bad of [-1, 1.5, Number.NaN]) expect(libSeg.exportPassIntervalMs(bad), String(bad)).toBe(H);
    expect(libSeg.EXPORT_MARK_BACKOFF_MAX_MS).toBe(24 * H);
    expect(libSeg.decideExportPass({ nowMs: T, lastPassMs: T - 2 * H + 1, firstTickMs: null, intervalMs: 2 * H })).toBe('wait');
    expect(libSeg.decideExportPass({ nowMs: T, lastPassMs: T - 2 * H, firstTickMs: null, intervalMs: 2 * H })).toBe('run');
    expect(libSeg.decideExportPass({ nowMs: T, lastPassMs: T + H, firstTickMs: null, intervalMs: 2 * H }), 'a clock that went backwards still runs').toBe('run');
  });
  it('O40: planExportRoom admits only above the export filesystem\'s own floor plus one segment (RC9); a throw is low-disk, a hang unsettled', () => {
    const size = 100 * 1024 ** 3;
    const need = libSeg.floorThreshold(size) + libSeg.EXPORT_SEGMENT_MAX_BYTES;
    expect(libSeg.planExportRoom({ state: 'ok', bytes: need, fsSize: size })).toEqual({ admit: false, word: 'low-disk', needBytes: need });
    expect(libSeg.planExportRoom({ state: 'ok', bytes: need + 1, fsSize: size })).toEqual({ admit: true, word: 'ok', needBytes: need });
    expect(libSeg.planExportRoom({ state: 'threw' })).toEqual({ admit: false, word: 'low-disk', needBytes: null });
    expect(libSeg.planExportRoom({ state: 'unsettled' })).toEqual({ admit: false, word: 'unsettled', needBytes: null });
  });
  it('exportedSourceKey is exported: + hex(sha256(path NUL dev NUL ino)), dev and ino in decimal whatever their type', () => {
    const p = '/home/u/.claude-a/projects/-home-u-tree-demo/0189abcd-1234-4678-9abc-0000000000e2.jsonl';
    const want = `exported:${createHash('sha256').update(`${p}\0${'2049'}\0${'18446744073709551557'}`).digest('hex')}`;
    expect(libSeg.exportedSourceKey(p, 2049, 18446744073709551557n)).toBe(want);
    expect(libSeg.exportedSourceKey(p, 2049n, '18446744073709551557')).toBe(want);
    expect(libSeg.exportedSourceKey(p, 2049, 7)).not.toBe(libSeg.exportedSourceKey(p, 2049, 8));
    // A retired file row keeps no path, and Task 5 writes '' for it: the key is still (dev, ino)'s, and never ''.
    expect(libSeg.exportedSourceKey('', 2049, 7)).toMatch(/^exported:[0-9a-f]{64}$/);
    expect(libSeg.exportedSourceKey('', 2049, 7)).not.toBe(libSeg.exportedSourceKey('', 2049, 8));
    for (const [path, dev, ino] of [['/a\0b', 1, 2], ['/a', -1, 2], ['/a', 1, 2.5], ['/a', 1, '0x1f']] as const) {
      expect(() => libSeg.exportedSourceKey(path, dev, ino), `${JSON.stringify(path)} ${String(dev)} ${String(ino)}`).toThrow(TypeError);
    }
  });
  it('HEALTH_META names the export keys once each, and none reuses a key B1 or B2 writes', () => {
    expect(libSeg.HEALTH_META.exportPassMs).toBe('export_pass_ms');
    expect(libSeg.HEALTH_META.exportDueOldestMs).toBe('export_due_oldest_ms');
    expect(libSeg.HEALTH_META.exportPaused).toBe('export_paused');
    const values = Object.values(libSeg.HEALTH_META);
    expect(new Set(values).size).toBe(values.length);
    for (const taken of ['export_due', 'export_overdue', 'export_census_ms', 'oldest_row_ms', 'first_due_ms', 'first_deletion_ms', 'export_seq']) {
      expect(values, taken).not.toContain(taken);
    }
  });
});

describe('W1-B4: the mark-failure backoff and the check after a bind, decided in lib (spec 9.15 "Mark", "After a bind"; RD2)', () => {
  const H = 3_600_000;
  const W = '0a1b2c3d';
  it('exportMarkFailsOf: the count meta holds; text off the decimal grammar, or past the safe integers, is no failure', () => {
    expect(['0', '1', '7', '12'].map((v) => libSeg.exportMarkFailsOf(v))).toEqual([0, 1, 7, 12]);
    for (const bad of [null, '', '-1', '1.5', 'x', '01', ' 2', '9999999999999999', '99999999999999999']) {
      expect(libSeg.exportMarkFailsOf(bad), String(bad)).toBe(0);
    }
  });
  it('decideMarkOutcome: a pass that published and could not mark backs off one step more; a marked pass ends the backoff; a busy, or a failure before the link, leaves it as it stands', () => {
    expect(libSeg.decideMarkOutcome({ outcome: 'mark-failed', recorded: null })).toEqual({ markFails: 1, write: '1', intervalMs: 2 * H });
    expect(libSeg.decideMarkOutcome({ outcome: 'mark-failed', recorded: '2' })).toEqual({ markFails: 3, write: '3', intervalMs: 8 * H });
    expect(libSeg.decideMarkOutcome({ outcome: 'mark-failed', recorded: 'torn' })).toEqual({ markFails: 1, write: '1', intervalMs: 2 * H });
    expect(libSeg.decideMarkOutcome({ outcome: 'marked', recorded: '3' })).toEqual({ markFails: 0, write: '0', intervalMs: H });
    expect(libSeg.decideMarkOutcome({ outcome: 'marked', recorded: 'torn' })).toEqual({ markFails: 0, write: '0', intervalMs: H });
    expect(libSeg.decideMarkOutcome({ outcome: 'marked', recorded: '0' }), 'nothing to end: no write').toEqual({ markFails: 0, write: null, intervalMs: H });
    expect(libSeg.decideMarkOutcome({ outcome: 'marked', recorded: null }), 'a store that never failed a mark gains no meta key')
      .toEqual({ markFails: 0, write: null, intervalMs: H });
    expect(libSeg.decideMarkOutcome({ outcome: 'mark-busy', recorded: '2' }), 'a busy is the lock\'s, not the volume\'s (RD3)')
      .toEqual({ markFails: 2, write: null, intervalMs: 4 * H });
    expect(libSeg.decideMarkOutcome({ outcome: 'write-failed', recorded: '2' }), 'nothing was published').toEqual({ markFails: 2, write: null, intervalMs: 4 * H });
    expect(() => libSeg.decideMarkOutcome({ outcome: 'other' as unknown as 'marked', recorded: null })).toThrow(TypeError);
  });
  it('decideMarkCheck: a step checks when a bind fact exists that the last check did not cover, by KEY and never by clock, and records every fact it covers', () => {
    expect(libSeg.decideMarkCheck({ metaKeys: [], checkedRecord: null })).toEqual({ check: false, facts: [], record: '[]' });
    expect(libSeg.decideMarkCheck({ metaKeys: ['bound:1700000000000', 'export_seq'], checkedRecord: null }))
      .toEqual({ check: true, facts: ['bound:1700000000000'], record: '["bound:1700000000000"]' });
    expect(libSeg.decideMarkCheck({ metaKeys: ['bound:1700000000000'], checkedRecord: '["bound:1700000000000"]' }).check, 'a covered fact checks nothing').toBe(false);
    // a bind stamped before the last check (a box whose clock is behind, or a clock stepped back) is still a new fact
    expect(libSeg.decideMarkCheck({ metaKeys: ['bound:1700000500000', 'bound:1700000300000'], checkedRecord: '["bound:1700000500000"]' }),
      'a bind stamped before the last check was never checked')
      .toEqual({ check: true, facts: ['bound:1700000300000', 'bound:1700000500000'], record: '["bound:1700000300000","bound:1700000500000"]' });
  });
  it('decideMarkCheck: only bound:<ms> keys are bind facts, and a record that does not parse, or is not a list, covers nothing', () => {
    expect(libSeg.decideMarkCheck({ metaKeys: ['bound:', 'bound:12a', 'bound:12345678901234567', 'unbound:5', 'bound:5:x'], checkedRecord: null }))
      .toEqual({ check: false, facts: [], record: '[]' });
    for (const rec of ['not json', '{"bound:5":1}', '"bound:5"']) {
      expect(libSeg.decideMarkCheck({ metaKeys: ['bound:5'], checkedRecord: rec }).check, rec).toBe(true);
    }
    expect(libSeg.decideMarkCheck({ metaKeys: ['bound:5'], checkedRecord: '[5, "bound:5"]' }).check, 'a string entry still covers').toBe(false);
  });
  it('missingSegmentNames: the names the marks give that this box does not hold, once each, sorted', () => {
    expect(libSeg.missingSegmentNames({ named: new Set([`3.${W}.db`, `1.${W}.db`, `2.${W}.db`]), present: [`1.${W}.db`] })).toEqual([`2.${W}.db`, `3.${W}.db`]);
    expect(libSeg.missingSegmentNames({ named: [`2.${W}.db`, `2.${W}.db`], present: [] })).toEqual([`2.${W}.db`]);
    expect(libSeg.missingSegmentNames({ named: [`1.${W}.db`], present: [`1.${W}.db`, `9.${W}.db`] })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W1-B4')
```

Expected: FAIL, `Tests 15 failed`. The constants case fails `expected undefined to be 'export'`, the HEALTH_META case `expected undefined to be 'export_pass_ms'`, the other eight of the first two describes `TypeError: segmentName is not a function` (and the same for `orderSegmentNames`, `nextSegmentSeq`, `decideExportPass`, `exportPassIntervalMs`, `planExportRoom`, `exportedSourceKey`), and the five of the third `TypeError: libSeg.exportMarkFailsOf is not a function` (and the same for `decideMarkOutcome`, `decideMarkCheck`, `missingSegmentNames`).

- [ ] **Step 4: Implement.** In `ccd/history/lib.mjs`:

(a) Directly below the constants-block line `export const EXPORT_MARGIN_DAYS = 30;`, insert:

```js
// W1-B4 (spec §9.15): the sole-copy export's directory under the root, its segment bound and cadence (both chosen),
// and the one segment format this build writes and reads. Declared here, above MODE_CHECKED_FILE_ROOTS, which
// names EXPORT_DIR: a const read before its declaration is a TDZ error at load.
export const EXPORT_DIR = 'export';
export const EXPORT_SEGMENT_MAX_BYTES = 256 * 1024 * 1024;
export const EXPORT_PASS_INTERVAL_MS = 60 * 60 * 1000;
export const EXPORT_SEGMENT_FORMAT = 1;
```

(b) In B1 Task 28's health block, in the line that declares `MODE_CHECKED_FILE_ROOTS`, replace the member `'export'` with `EXPORT_DIR`. On B1's text the line becomes:

```js
const MODE_CHECKED_FILE_ROOTS = Object.freeze(['db', 'card', 'steer', 'journal', EXPORT_DIR]);
```

(c) In `HEALTH_META`'s object literal, directly below its member `  exportSegmentMissing: 'export_segment_missing',`, insert:

```js
  exportPassMs: 'export_pass_ms',               // W1-B4: when the last export pass ran (doctor's last-pass rule)
  exportDueOldestMs: 'export_due_oldest_ms',    // W1-B4: the census's oldest due-since (doctor's wait rule)
  exportPaused: 'export_paused',                // W1-B4: the export's pause for room on the home filesystem
```

(d) Append to the END of the file:

```js
// ===========================================================================
// The sole-copy export's decisions (spec §9.15 "The pass": Preflight, Write;
// §9.3 the floor; §6.2 ingest_files.source_key; W1-B4 Task 1). Pure: the sweep
// measures the export filesystem, lists export/<store_id>/ and reads meta, and
// passes what it saw; every verdict on those facts is taken here.
// ⟦D:history-sole-copy-export⟧ D-4226
// ⟦D:history-backup-preflight-and-rename⟧ D-4179
// ⟦D:history-export-cadence-from-first-tick⟧
// ===========================================================================

/** A published segment's name (§9.15 "Write"): `<seq>.<writer>.db`, seq a positive decimal with no leading zero
 *  and at most 16 digits (then a safe integer), writer the binding's 8-hex token (WRITER_RE's grammar). */
const SEGMENT_NAME_RE = /^([1-9][0-9]{0,15})\.([0-9a-f]{8})\.db$/;

/** The name segment `seq` of `writer` is published under. A part off its grammar is a caller's bug and throws: no
 *  file name is ever formed from an unchecked part. */
export function segmentName({ seq, writer }) {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new TypeError(`segmentName: seq must be a positive safe integer, got ${String(seq)}`);
  if (typeof writer !== 'string' || !WRITER_RE.test(writer)) throw new TypeError(`segmentName: writer must be 8 lowercase hex, got ${JSON.stringify(writer)}`);
  return `${seq}.${writer}.db`;
}

/** A segment name back to its parts, or null when it is not one: a temp, a stray file, a seq with a leading zero
 *  or past the safe integers. */
export function parseSegmentName(name) {
  if (typeof name !== 'string') return null;
  const m = SEGMENT_NAME_RE.exec(name);
  if (m === null) return null;
  const seq = Number(m[1]);
  return Number.isSafeInteger(seq) ? { seq, writer: m[2] } : null;
}

/** The temp a segment is built in before its link (§9.15: `.<seq>.<writer>.db.tmp`), a dot-name beside it, so it is
 *  never a published name. Only a segment name has one. */
export function segmentTempName(name) {
  if (parseSegmentName(name) === null) throw new TypeError(`segmentTempName: not a segment name: ${JSON.stringify(name)}`);
  return `.${name}.tmp`;
}

/** Segment names in the order replay applies them (§9.14 "Export replay": `(seq, writer)`): seq numerically, then
 *  the writer token in code-unit order, never the names' own lexical order (`10.…` before `9.…`). A name that is
 *  not a segment's is dropped. */
export function orderSegmentNames(names) {
  const parsed = [];
  for (const n of names) {
    const p = parseSegmentName(n);
    if (p !== null) parsed.push({ n, ...p });
  }
  parsed.sort((a, b) => a.seq - b.seq || (a.writer < b.writer ? -1 : a.writer > b.writer ? 1 : 0));
  return parsed.map((p) => p.n);
}

/** The next segment number (§9.15 "Write"): one past the highest seq on disk under export/<store_id>/, of any
 *  writer, and past the one meta last recorded, so a restored or rebuilt store whose counter is behind, or a
 *  directory carried in from another box, never has a number reused. A recorded value that is not a positive safe
 *  integer was not recorded. */
export function nextSegmentSeq({ onDisk, recorded }) {
  let top = Number.isSafeInteger(recorded) && recorded > 0 ? recorded : 0;
  for (const s of onDisk) if (s > top) top = s;
  return top + 1;
}

/** Whether this tick runs the export pass (§9.15 "The pass": at most once an hour, chosen). The clock runs from the
 *  last pass or, before the first, from the store's first tick (⟦D:history-export-cadence-from-first-tick⟧): a new
 *  store writes no segment in its first hour, and the pass and doctor's last-pass rule read one clock. A clock that
 *  went backwards (a last pass or first tick after now) runs the pass rather than wait for the clock to catch up:
 *  an early segment costs nothing, a late one widens the window in which the store is the only copy
 *  (⟦D:history-export-cadence-clock-backwards⟧). No clock at all waits: the tick that asks has recorded its own
 *  ticks row, so the next tick has one. `intervalMs` is exportPassIntervalMs' answer: an hour, or longer after
 *  passes that published and could not mark (⟦D:history-export-mark-failure-backs-off⟧). */
export function decideExportPass({ nowMs, lastPassMs, firstTickMs, intervalMs = EXPORT_PASS_INTERVAL_MS }) {
  const since = lastPassMs ?? firstTickMs;
  if (since === null) return 'wait';
  const age = nowMs - since;
  return age < 0 || age >= intervalMs ? 'run' : 'wait';
}

/** The longest the export waits between passes, however many passes in a row failed to mark (chosen: a day). */
export const EXPORT_MARK_BACKOFF_MAX_MS = 24 * EXPORT_PASS_INTERVAL_MS;

/** The export's interval after `markFails` passes in a row that published their segment and then failed to mark it
 *  (§9.15 "Mark"; Task 7 counts them in meta). Such a pass leaves its rows unmarked, so the next one publishes them
 *  again; while the store's own volume refuses the marks, an hourly retry would publish a copy every hour until the
 *  home filesystem's floor. The interval doubles per failure (1 h, 2 h, 4 h, …), at most EXPORT_MARK_BACKOFF_MAX_MS,
 *  and a count that is not a positive safe integer is no failure (⟦D:history-export-mark-failure-backs-off⟧). */
export function exportPassIntervalMs(markFails) {
  const n = Number.isSafeInteger(markFails) && markFails > 0 ? Math.min(markFails, 5) : 0;
  return Math.min(EXPORT_PASS_INTERVAL_MS * 2 ** n, EXPORT_MARK_BACKOFF_MAX_MS);
}

/** The export's room verdict (§9.15 "Preflight"; rev 3.1 review, RC9). `free` is the sweep's statfsWithDeadline
 *  answer for ~/.ccrc/history/export, judged by planCopy with THAT filesystem's own threshold (§9.3's formula,
 *  floorThreshold) and the segment bound as the copy's size, so one segment can never take the home filesystem
 *  below its floor. A probe that threw is `low-disk`, as the store's own floor reads one (§9.10); a probe that never
 *  answered is `unsettled`, kept apart so the pass can say which. */
export function planExportRoom(free) {
  if (free.state === 'unsettled') return { admit: false, word: 'unsettled', needBytes: null };
  if (free.state !== 'ok') return { admit: false, word: 'low-disk', needBytes: null };
  const r = planCopy({ freeBytes: free.bytes, thresholdBytes: floorThreshold(free.fsSize), sizeBytes: EXPORT_SEGMENT_MAX_BYTES });
  return { admit: r.admit, word: r.admit ? 'ok' : 'low-disk', needBytes: r.needBytes };
}

const EXPORT_DECIMAL_RE = /^(0|[1-9][0-9]*)$/;

/** dev or ino in decimal: a number, a BigInt (statSync's `bigint: true`, past 2^53) or the decimal text of one. */
function exportDecimal(v, what) {
  if (typeof v === 'bigint' && v >= 0n) return v.toString();
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === 'string' && EXPORT_DECIMAL_RE.test(v)) return v;
  throw new TypeError(`exportedSourceKey: ${what} must be a non-negative integer, got ${String(v)}`);
}

/** The source_key of the dead-file ingest_files row export replay puts a gone file's memberships on (§6.2; §9.15
 *  "Memberships of a gone file"): `exported:` plus hex(sha256(path ∖0 dev ∖0 ino)). It never equals a live row's
 *  key (''), so replay never lands on a live file, even one that now reuses that inode. dev and ino are rendered in
 *  decimal, so a BigInt past 2^53 keys exactly as the store holds it. A path holding a NUL could forge a separator,
 *  and no POSIX path holds one, so it throws. An empty path is a file the store knows no path for (a retired row
 *  keeps none; the export pass writes '' for it): it keys by (dev, ino) alone, and is still never a live key. */
export function exportedSourceKey(path, dev, ino) {
  if (typeof path !== 'string' || path.includes('\0')) throw new TypeError(`exportedSourceKey: path must be a string without NUL, got ${JSON.stringify(path)}`);
  return `exported:${sha256Hex(`${path}\0${exportDecimal(dev, 'dev')}\0${exportDecimal(ino, 'ino')}`)}`;
}

// ── The marks' two decisions (§9.15 "Mark", "After a bind"; coordinator ruling RD2: L4 delivery is not allowed to
// decide). The sweep measures meta, the directory listing and the marked names, calls these and acts on the answer.
// ⟦D:history-export-mark-failure-backs-off⟧ D-4226

/** The text meta export_mark_fails holds when it is a count: a decimal with no sign and no leading zero. */
const EXPORT_MARK_FAILS_RE = /^(0|[1-9][0-9]{0,15})$/;

/** The count meta export_mark_fails holds (Task 7 writes it), as the backoff reads it. Absent, torn or hand-edited
 *  text, or a number past the safe integers, is no failure: the export never waits longer on a value it cannot read. */
export function exportMarkFailsOf(recorded) {
  if (typeof recorded !== 'string' || !EXPORT_MARK_FAILS_RE.test(recorded)) return 0;
  const n = Number(recorded);
  return Number.isSafeInteger(n) ? n : 0;
}

/** What one pass's outcome does to the mark-failure backoff (⟦D:history-export-mark-failure-backs-off⟧): whether the
 *  pass backs off, and the next wait. `outcome` is what the sweep saw: 'mark-failed' (its segment was linked, then the
 *  marks threw), 'marked' (the marks committed), 'mark-busy' (linked, then SQLITE_BUSY: the write lock's, not the
 *  volume's, so no backoff; RD3) or 'write-failed' (a throw before any link: nothing was published). `recorded` is
 *  meta export_mark_fails as read. Answers the count that stands, the meta text to write (null: leave meta as it is;
 *  a marked pass writes '0' only over another value, so a store that never failed a mark gains no key) and the wait
 *  the cadence then applies. Any other outcome is a caller's bug and throws. */
export function decideMarkOutcome({ outcome, recorded }) {
  const prev = exportMarkFailsOf(recorded);
  let markFails;
  let write = null;
  switch (outcome) {
    case 'mark-failed': markFails = prev + 1; write = String(markFails); break;
    case 'marked': markFails = 0; if (recorded !== null && recorded !== '0') write = '0'; break;
    case 'mark-busy':
    case 'write-failed': markFails = prev; break;
    default: throw new TypeError(`decideMarkOutcome: not an export outcome: ${JSON.stringify(outcome)}`);
  }
  return { markFails, write, intervalMs: exportPassIntervalMs(markFails) };
}

/** A bind fact's meta key: `bound:<ms>`, as B2's insertBindFacts writes one inside every adopt, restore and rebuild. */
const BIND_FACT_RE = /^bound:[0-9]{1,16}$/;

/** Whether this step checks the export's marks against the segments on this box (§9.15 "After a bind"), and what
 *  that check records as covered. `metaKeys` are the store's meta keys that may be bind facts; `checkedRecord` is what
 *  the last check recorded (a JSON list of keys) or null. A step checks when a bind fact exists that the record does
 *  not hold: by KEY, never by comparing a bind's clock with the check's, because the two may be two boxes' clocks (an
 *  adopt) or one clock either side of a step back. A record that does not parse, or is not a list, covers nothing, so
 *  the check runs rather than miss a bind. `record` is every fact this check covers, sorted, as the check writes it. */
export function decideMarkCheck({ metaKeys, checkedRecord }) {
  const facts = metaKeys.filter((k) => typeof k === 'string' && BIND_FACT_RE.test(k)).sort();
  let parsed;
  try { parsed = JSON.parse(checkedRecord ?? '[]'); } catch { parsed = []; }
  const have = new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
  return { check: facts.some((k) => !have.has(k)), facts, record: JSON.stringify(facts) };
}

/** The segment names the store's marks give that export/<store_id>/ on this box does not hold, once each, sorted:
 *  their marks are cleared so their rows export again (§9.15 "After a bind"). `named` and `present` are the sweep's
 *  measurements: the marks' DISTINCT exported_seg values and listSegments' names. */
export function missingSegmentNames({ named, present }) {
  const here = new Set(present);
  return [...new Set(named)].filter((n) => !here.has(n)).sort();
}
```

`sha256Hex`, `planCopy`, `floorThreshold` and `WRITER_RE` are this module's own (B1). The `\0` in `exportedSourceKey` is the two characters backslash and zero in the source, never a raw NUL byte (`source-bytes.test.ts` refuses one); check with `grep -cP '\x00' ccd/history/lib.mjs` (expect 0).

- [ ] **Step 5: Declare the types.** In `ccd/history/lib.d.mts`, in `HEALTH_META`'s declaration, directly below its member `  exportSegmentMissing: 'export_segment_missing';`, insert:

```ts
  exportPassMs: 'export_pass_ms';
  exportDueOldestMs: 'export_due_oldest_ms';
  exportPaused: 'export_paused';
```

Then append to the END of the file:

```ts
// --- W1-B4 Task 1: the sole-copy export's names, numbers, cadence, room and dead-file key (spec §9.15, §9.3, §6.2)
export const EXPORT_DIR: 'export';
export const EXPORT_SEGMENT_MAX_BYTES: number;
export const EXPORT_PASS_INTERVAL_MS: number;
export const EXPORT_SEGMENT_FORMAT: number;
export function segmentName(i: { seq: number; writer: string }): string;
export function parseSegmentName(name: string): { seq: number; writer: string } | null;
export function segmentTempName(name: string): string;
export function orderSegmentNames(names: readonly string[]): string[];
export function nextSegmentSeq(i: { onDisk: readonly number[]; recorded: number | null }): number;
export function decideExportPass(i: { nowMs: number; lastPassMs: number | null; firstTickMs: number | null; intervalMs?: number }): 'run' | 'wait';
export const EXPORT_MARK_BACKOFF_MAX_MS: number;
export function exportPassIntervalMs(markFails: number): number;
/** The sweep's statfsWithDeadline answer for ~/.ccrc/history/export, as planExportRoom takes it. */
export type ExportProbe = { state: 'ok'; bytes: number; fsSize: number } | { state: 'unsettled' } | { state: 'threw' };
export interface ExportRoom { admit: boolean; word: 'ok' | 'low-disk' | 'unsettled'; needBytes: number | null }
export function planExportRoom(free: ExportProbe): ExportRoom;
export function exportedSourceKey(path: string, dev: string | number | bigint, ino: string | number | bigint): string;
// the marks' two decisions (RD2)
export function exportMarkFailsOf(recorded: string | null): number;
export type ExportMarkOutcome = 'marked' | 'mark-failed' | 'mark-busy' | 'write-failed';
export function decideMarkOutcome(i: { outcome: ExportMarkOutcome; recorded: string | null }): { markFails: number; write: string | null; intervalMs: number };
export function decideMarkCheck(i: { metaKeys: readonly string[]; checkedRecord: string | null }): { check: boolean; facts: string[]; record: string };
export function missingSegmentNames(i: { named: Iterable<string>; present: Iterable<string> }): string[];
```

Each name is declared once: `skipLibCheck: true` makes a duplicate silent (B1 Task 6 Step 13), so count them:

```bash
for n in segmentName parseSegmentName segmentTempName orderSegmentNames nextSegmentSeq decideExportPass exportPassIntervalMs planExportRoom exportedSourceKey exportMarkFailsOf decideMarkOutcome decideMarkCheck missingSegmentNames; do printf '%s %s\n' "$n" "$(grep -c "^export function $n(" ccd/history/lib.d.mts)"; done
for n in EXPORT_DIR EXPORT_SEGMENT_MAX_BYTES EXPORT_PASS_INTERVAL_MS EXPORT_SEGMENT_FORMAT EXPORT_MARK_BACKOFF_MAX_MS; do printf '%s %s %s\n' "$n" "$(grep -c "^export const $n:" ccd/history/lib.d.mts)" "$(grep -c "^export const $n = " ccd/history/lib.mjs)"; done
grep -c 'exportPassMs' ccd/history/lib.d.mts
grep -c '^export type ExportMarkOutcome ' ccd/history/lib.d.mts
```

Expected: every function line ends ` 1`, every constant line ` 1 1`, and the last two counts are 1.

- [ ] **Step 6: Run them and see them pass; then the whole file, the typecheck and the module's load.** In the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W1-B4')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
node -e "import('./ccd/history/lib.mjs').then((m) => console.log(m.EXPORT_DIR, m.modeWantOf('export/x/1.0a1b2c3d.db', 'file')))"
```

Expected: the first run `Tests 15 passed`; the second, every case in the file passes (B1's planExport, health and mode cases included: `modeWantOf` still answers 0600 under `export/`); `tsc` prints nothing and exits 0; the last line prints `export 0600` (no TDZ `ReferenceError` at load). Also run `(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')`: B1's O13/O14 describes and B2's VOCABS stay green (no vocabulary is added, no switch spelled).

- [ ] **Step 7: Measure every guard red, then green.** From the repository root:

```bash
cat > .superpowers/sdd/history-w1-b4/scratch/mutants-task1.json <<'MUT_EOF'
[
 {
  "name": "9.6: MODE_CHECKED_FILE_ROOTS stops judging the export directory",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: segment names",
  "edits": [{ "anchor": "'journal', EXPORT_DIR]);", "replacement": "'journal']);" }]
 },
 {
  "name": "9.15: a segment name formed from an unchecked seq",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: segment names",
  "edits": [{ "anchor": "  if (!Number.isSafeInteger(seq) || seq < 1) throw new TypeError(`segmentName: seq must be a positive safe integer, got ${String(seq)}`);\n", "replacement": "" }]
 },
 {
  "name": "9.15: a segment name formed from an unchecked writer",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: segment names",
  "edits": [{ "anchor": "  if (typeof writer !== 'string' || !WRITER_RE.test(writer)) throw new TypeError(`segmentName: writer must be 8 lowercase hex, got ${JSON.stringify(writer)}`);\n", "replacement": "" }]
 },
 {
  "name": "9.15: a seq past the safe integers parsed as a name",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: segment names",
  "edits": [{ "anchor": "  return Number.isSafeInteger(seq) ? { seq, writer: m[2] } : null;", "replacement": "  return { seq, writer: m[2] };" }]
 },
 {
  "name": "9.15: a temp name formed from a non-segment name",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: segment names",
  "edits": [{ "anchor": "  if (parseSegmentName(name) === null) throw new TypeError(`segmentTempName: not a segment name: ${JSON.stringify(name)}`);\n", "replacement": "" }]
 },
 {
  "name": "9.14: segments ordered by their names' lexical order",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: segment names",
  "edits": [{ "anchor": "  parsed.sort((a, b) => a.seq - b.seq || (a.writer < b.writer ? -1 : a.writer > b.writer ? 1 : 0));", "replacement": "  parsed.sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));" }]
 },
 {
  "name": "O39: the next seq ignores the names on disk",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: segment names",
  "edits": [{ "anchor": "  for (const s of onDisk) if (s > top) top = s;\n", "replacement": "" }]
 },
 {
  "name": "O39: the next seq ignores meta's recorded counter",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: segment names",
  "edits": [{ "anchor": "  let top = Number.isSafeInteger(recorded) && recorded > 0 ? recorded : 0;", "replacement": "  let top = 0;" }]
 },
 {
  "name": "9.15: no clock before the first pass (a new store exports at once)",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the hourly cadence",
  "edits": [{ "anchor": "  const since = lastPassMs ?? firstTickMs;", "replacement": "  const since = lastPassMs;" }]
 },
 {
  "name": "9.15: a clock that went backwards waits for it",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the hourly cadence",
  "edits": [{ "anchor": "  return age < 0 || age >= intervalMs ? 'run' : 'wait';", "replacement": "  return age >= intervalMs ? 'run' : 'wait';" }]
 },
 {
  "name": "9.15 backoff: decideExportPass ignores the interval it is given",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the hourly cadence",
  "edits": [{ "anchor": "  return age < 0 || age >= intervalMs ? 'run' : 'wait';", "replacement": "  return age < 0 || age >= EXPORT_PASS_INTERVAL_MS ? 'run' : 'wait';" }]
 },
 {
  "name": "9.15 backoff: never doubled after a mark failure",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the hourly cadence",
  "edits": [{ "anchor": "  return Math.min(EXPORT_PASS_INTERVAL_MS * 2 ** n, EXPORT_MARK_BACKOFF_MAX_MS);", "replacement": "  return EXPORT_PASS_INTERVAL_MS;" }]
 },
 {
  "name": "9.15 backoff: uncapped",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the hourly cadence",
  "edits": [{ "anchor": "  return Math.min(EXPORT_PASS_INTERVAL_MS * 2 ** n, EXPORT_MARK_BACKOFF_MAX_MS);", "replacement": "  return EXPORT_PASS_INTERVAL_MS * 2 ** n;" }]
 },
 {
  "name": "O40/RC9: the room verdict without the segment's size",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the hourly cadence",
  "edits": [{ "anchor": "sizeBytes: EXPORT_SEGMENT_MAX_BYTES });", "replacement": "sizeBytes: 0 });" }]
 },
 {
  "name": "O40: the room verdict without the export filesystem's threshold",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the hourly cadence",
  "edits": [{ "anchor": "thresholdBytes: floorThreshold(free.fsSize),", "replacement": "thresholdBytes: 0," }]
 },
 {
  "name": "9.10: a probe that threw read as unsettled",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the hourly cadence",
  "edits": [{ "anchor": "  if (free.state !== 'ok') return { admit: false, word: 'low-disk', needBytes: null };", "replacement": "  if (free.state !== 'ok') return { admit: false, word: 'unsettled', needBytes: null };" }]
 },
 {
  "name": "6.2: a NUL in the path forges a separator",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the hourly cadence",
  "edits": [{ "anchor": "|| path.includes('\\0')) throw", "replacement": ") throw" }]
 },
 {
  "name": "6.2: dev or ino text taken undecimal",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the hourly cadence",
  "edits": [{ "anchor": "  if (typeof v === 'string' && EXPORT_DECIMAL_RE.test(v)) return v;", "replacement": "  if (typeof v === 'string') return v;" }]
 },
 {
  "name": "RD2 backoff: a torn or signed count read as a count",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "  if (typeof recorded !== 'string' || !EXPORT_MARK_FAILS_RE.test(recorded)) return 0;\n", "replacement": "" }]
 },
 {
  "name": "RD2 backoff: a count past the safe integers read as itself",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "  return Number.isSafeInteger(n) ? n : 0;", "replacement": "  return n;" }]
 },
 {
  "name": "RD2 backoff: a failed mark leaves the backoff where it was",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "    case 'mark-failed': markFails = prev + 1; write = String(markFails); break;", "replacement": "    case 'mark-failed': markFails = prev; write = String(markFails); break;" }]
 },
 {
  "name": "RD2 backoff: a marked pass keeps the backoff",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "    case 'marked': markFails = 0; if (recorded !== null && recorded !== '0') write = '0'; break;", "replacement": "    case 'marked': markFails = prev; break;" }]
 },
 {
  "name": "RD2 backoff: a marked pass writes the key with nothing to end",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "markFails = 0; if (recorded !== null && recorded !== '0') write = '0';", "replacement": "markFails = 0; write = '0';" }]
 },
 {
  "name": "RD2/RD3 backoff: a busy after the link backs off",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "    case 'mark-busy':\n    case 'write-failed': markFails = prev; break;", "replacement": "    case 'write-failed': markFails = prev; break;\n    case 'mark-busy': markFails = prev + 1; write = String(markFails); break;" }]
 },
 {
  "name": "RD2 backoff: an unknown outcome passes as a failure before the link",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "    default: throw new TypeError(`decideMarkOutcome: not an export outcome: ${JSON.stringify(outcome)}`);", "replacement": "    default: markFails = prev;" }]
 },
 {
  "name": "RD2 after a bind: a check on every step after any bind",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "  return { check: facts.some((k) => !have.has(k)), facts, record: JSON.stringify(facts) };", "replacement": "  return { check: facts.length > 0, facts, record: JSON.stringify(facts) };" }]
 },
 {
  "name": "RD2 after a bind: decided by the facts' clocks, not their keys",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "  return { check: facts.some((k) => !have.has(k)), facts, record: JSON.stringify(facts) };", "replacement": "  return { check: facts.some((k) => Number(k.slice(6)) > Math.max(0, ...[...have].map((c) => Number(c.slice(6))))), facts, record: JSON.stringify(facts) };" }]
 },
 {
  "name": "RD2 after a bind: any bound: key taken for a bind fact",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "typeof k === 'string' && BIND_FACT_RE.test(k)", "replacement": "typeof k === 'string' && k.startsWith('bound:')" }]
 },
 {
  "name": "RD2 after a bind: a record that does not parse throws",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "  try { parsed = JSON.parse(checkedRecord ?? '[]'); } catch { parsed = []; }", "replacement": "  parsed = JSON.parse(checkedRecord ?? '[]');" }]
 },
 {
  "name": "RD2 after a bind: a record that is not a list read as one",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []", "replacement": "[].concat(parsed).filter((x) => typeof x === 'string')" }]
 },
 {
  "name": "RD2 after a bind: a present segment taken for a missing one",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the mark-failure backoff",
  "edits": [{ "anchor": "  return [...new Set(named)].filter((n) => !here.has(n)).sort();", "replacement": "  return [...new Set(named)].filter(() => true).sort();" }]
 }
]
MUT_EOF
(cd server && node ../.superpowers/sdd/history-w1-b4/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b4/scratch/mutants-task1.json)
```

Run it in the foreground with a timeout of at least 600000 ms. Expected: every row prints `red (N failed)` then `green`, the last line is `every guard measured red, then green`, and the exit code is 0. Measured while drafting, on B1's lib with B2's Task 7 block: every row red with 1 failed case, except `9.15: no clock before the first pass` (2). The three `9.15 backoff` rows were added after that measurement (review fix, ⟦D:history-export-mark-failure-backs-off⟧); each is expected red on the `exportPassIntervalMs` case alone, and `9.15: a clock that went backwards waits for it` now reds that case too (2). The thirteen `RD2` rows (filter `W1-B4: the mark-failure backoff`) were added with coordinator ruling RD2, after that measurement; each is expected red with 1 failed case (the `exportMarkFailsOf` case for the first two, the `decideMarkOutcome` case for the next five, one of the two `decideMarkCheck` cases for the next five, the `missingSegmentNames` case for the last), except `RD2 after a bind: a check on every step after any bind`, which reds both `decideMarkCheck` cases (2). The worker records the counts; only a `STAYED GREEN` is a failure. An `ANCHOR NOT UNIQUE` line means the merged lib spells the anchor twice: stop and report it, never loosen the anchor.

- [ ] **Step 8: Confirm the restore, and commit.** First, in the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b4/scratch/keep)" && echo RESTORED
```

Expected: every test passes and the last line is `RESTORED`. On anything else, stop and restore `lib.mjs` as the runner's header says. Only after `RESTORED`, in a separate call, on this workspace's own branch:

```bash
git diff --stat
git add ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-lib.test.ts
git commit -m "feat(history): export segment names and numbers, the hourly cadence, the room verdict, the dead-file key and the marks' decisions (W1-B4 task 1)"
```

`git diff --stat` before the add must list exactly those three files.

### Task 2: lib: planSegment, the row-level due rule and what a segment carries; planExport's oldest due-since

**Files:**
- Modify: `ccd/history/lib.mjs`:
  - B1 Task 10's `planExport`, as B2's per-copy task leaves it, in place by content (three edits: a declaration, a block below `due.push(blob.key);`, and its return line);
  - append one block at the END of the file.
- Modify: `ccd/history/lib.d.mts`: `planExport`'s return type in place, and one block appended at the end.
- Test: `server/test/history-lib.test.ts`: append one block at the END (its import at the block's head).
- Scratch, gitignored: `.superpowers/sdd/history-w1-b4/scratch/mutate.mjs` and `.superpowers/sdd/history-w1-b4/scratch/mutants-task2.json`.

**Interfaces:**
- Consumes (B1 `lib.mjs` as B2's per-copy task leaves it, same module; ⟦D:history-export-due-per-copy⟧):
  - `planExport({ nowMs, homeRetentionDays, blobs, reducer = EXPORT_REDUCERS.perCopy }): { horizonDays, due, overdue }`, B1's signature with B2's default, edited in place;
  - the reducer contract B2's task gives `ExportReducer` (its TypeScript type, `(candidate: ExportCandidate, homeRetentionDays) => number`, is B1's, unchanged): a reducer answers the time, in ms since the epoch, at which the candidate falls due, `-Infinity` when nothing holds it back, and a candidate is due exactly when that time is before `nowMs` (`planExport`'s due test is `reducer(r, homeRetentionDays) < nowMs`). B1's reducers answered a retention in days, which no per-copy rule can be: the per-copy rule reads each file's own mtime, not the row's;
  - `EXPORT_REDUCERS.perCopy` (B2): over the candidate's `files`, the latest of each PRESENT file's `mtimeMs + exportHorizonDays(homeRetentionDays[file.home], or Claude Code's 30-day default for a home not in it) × day`, a file gone from disk counting as passed (`-Infinity`); `-Infinity` for a candidate with no holding file on record. It never reads `tsMs`;
  - `EXPORT_REDUCERS.shortestHome` (B1's default, now history, kept by B2 under the same contract): the row clock (`ts_ms`, else the newest holding file's mtime, else `-Infinity`) plus the shortest retention's horizon. B4 names it only as a CONTROL (Task 2's mutants, Task 5's mutation table) and in one explicit-reducer assertion;
  - `exportHorizonDays(retentionDays)`, `shortestRetention`, `EXPORT_DAY_MS`, and the types `ExportFile { home; mtimeMs; present }`, `ExportCandidate { tsMs: number | null; files }` and `ExportReducer`. B4 reads a candidate's due time only through the reducer: no clock of its own, so a second clock is never two answers to one question.
- Consumes (Task 1): `EXPORT_SEGMENT_MAX_BYTES` (Task 5 passes it, or less, as `boundBytes`).
- Produces (`lib.mjs`, declared once in `lib.d.mts`):
  - `interface SegmentBlob { key: string; zBytes: number; exported: boolean; pruned: boolean }`;
  - `interface SegmentCandidate extends ExportCandidate { key: string; blobs: readonly SegmentBlob[] }` (a candidate ROW: its own time, which the per-copy default never reads, its holding files, which it does, and the blobs it references — its entry's blob, its variants', its sidecars', its boundary's kept blob);
  - `interface SegmentPlan { take: string[]; carry: string[]; stubs: string[]; bytes: number; leftDue: number; oldestLeftDueSinceMs: number | null }`, `bytes` the counted bytes of the taken rows: their new blob bytes plus `EXPORT_ROW_META_BYTES` each;
  - `export const EXPORT_ROW_META_BYTES = 1536`: what one taken row's metadata is counted for in the bound (chosen, an estimate);
  - `planSegment({ nowMs, homeRetentionDays, rows, boundBytes, reducer = EXPORT_REDUCERS.perCopy, takenBefore = false }): SegmentPlan`, the same `reducer` parameter and default as `planExport` (RD1's one clock); `takenBefore` says an earlier call of the same pass (an earlier page) already took a row, so this call's first due row must fit too;
  - `planExport`'s answer gains `oldestDueSinceMs: number | null`: the earliest due-since over the due blobs that carry one, null when none does. Null is never a time and never "due since the epoch": the same answer's `due` says whether anything is due, so `due: []` with null is nothing due, and a non-empty `due` with null is due but undated (additive: B1's and B2's callers and tests read `.due`, `.overdue` and `.horizonDays` only);
  - `SegmentPlan.oldestLeftDueSinceMs` reads the same way beside `leftDue`;
  - module-private `dueSinceMs(candidate, homeRetentionDays, reducer): number | null`, read by both functions. It answers the reducer's due time when the reducer names one. When the reducer answers `-Infinity`, it answers B2's own W1-k dating through `holderDueDateMs`: the last write the candidate's RECORDED files saw, else its row's time. It answers null (undated) when the candidate has neither, or when the only clock is not after the epoch. Never 0 (⟦D:history-export-wait-from-census⟧).
- Consumes (B2 Task 35, `lib.mjs`, module-private, same module): `holderDueDateMs(h, homeRetentionDays, reducer): number | null`, the one definition of "a candidate nothing on disk holds back is dated by a real clock, never a sentinel". B4 calls it and never writes a second copy.
- Later consumers: Task 5 (`planSegment` over its candidate page, with `takenBefore` from the second page on; `stubs` written as stub blobs; `EXPORT_ROW_META_BYTES` in its file-size case), Task 9 (B1's `exportCensus` records `oldestDueSinceMs` as `HEALTH_META.exportDueOldestMs`).

**Spec:** §9.15 "What is due" (its inputs; the per-row file set; a file's due date; a row is due; a blob is due; a due row is exported whole), "The pass" (Write: within the run budget, at most 256 MiB), "The gap guard" (a due blob that has waited more than two pass intervals), §6.6 (a pruned blob is never exported or counted due), §15.1 and §15.3 Q15 (ruled yes, rev 3.4: the per-copy rule is the default "wherever the due rule is computed", B4's pass included; one reducer, no signature change). Pins: **O39**'s pure halves (a hot blob's old row carries it while the census says not due, BK12; an exported blob never carried again; a pruned blob never carried or counted; the bound, with at least one row; input order), **O58**'s B4 half (`planSegment` with no reducer argument answers by `EXPORT_REDUCERS.perCopy`, "RD1's one clock", with both of O58's CONTROLs: the node-shortest default and the row clock), and the B4 input of **O41** (`oldestDueSinceMs`, with its CONTROL). Departures:
- ⟦D:history-export-row-carries-blob⟧ (a due row carries every unexported blob it references, whatever that blob's younger referrers);
- ⟦D:history-export-due-per-copy⟧ (B2-defined; ruled Q15): a row is due when every one of its holding files has passed its mtime plus its own home's retention, minus 30 days; a file gone from disk has passed; a row with no holding file on record is due at once. `planSegment` asks B2's reducer, its default, and never reads a row's `ts_ms`;
- ⟦D:history-export-pruned-row-stub⟧ (NEW): a row that falls due after `prune` tombstoned its blob is taken, and its blob travels as a stub (sha256, codec, raw_len, no bytes), because `entries.blob_id` is NOT NULL and a rebuild would otherwise lose the row's structure. A stub is never exported text, and its size never counts toward the bound (its row's metadata does). Ruled as implemented (coordinator ruling RD1, the header's "Coordinator rulings"): such rows travel with the stub rather than being skipped;
- ⟦D:history-export-wait-from-census⟧ (NEW, defined with Task 9): doctor's "waited more than two pass intervals" needs a due-since time, and the census computes it from the store's rows, here.
- ⟦D:history-export-segment-bound-estimated⟧ (NEW): §9.15 says a segment holds "at most 256 MiB". A row's metadata in the file is not small beside a short row's blob: a prototype of Task 4's format-1 tables measured 0.8–1.1 KiB per entry with one membership (about 0.2 KiB per further membership) over 56 KiB of schema pages, and a review prototype counting blob bytes alone wrote files 1.14× the bound at 8 KiB blobs and 2.3× at 0.5–2 KiB. So each taken row counts `EXPORT_ROW_META_BYTES` (1.5 KiB, chosen) beside its new blob bytes: a segment lands near the bound, can pass it only by the estimate's error, and holds at most about 175,000 rows, which also bounds the pass's memory when rows bring no new bytes (stubs, shared or exported blobs). The first due row of a pass is still taken whatever its size, so every pass moves the export forward; the preflight's floor margin absorbs that one row, and no second `planCopy` runs.

Choices this task makes (each copied into the PR body by Task 12 Step 9):
- planSegment's due rule is per ROW (§9.15 "A row is due"); planExport's stays per BLOB (the census counts blobs). Both read the same reducer's due time, with the same default (B2's `EXPORT_REDUCERS.perCopy`, ruled Q15), so the pass and the census keep one clock (RD1) and a later rule would still be one reducer and no signature.
- The bound counts each taken row's new blob bytes plus `EXPORT_ROW_META_BYTES` for its metadata (⟦D:history-export-segment-bound-estimated⟧). A candidate page bounds one statement's work, never the segment's row count: the metadata term is what bounds that, so a run of rows that bring no new bytes fills a segment instead of growing it until the wall clock.
- The first due row of the PASS is taken whatever its size, never the first of each call: the sweep pages its candidates, and passes `takenBefore` once an earlier page took a row, so a later page's first row must fit what is left (the paged answer equals the one-page answer).
- A segment is a PREFIX of the backlog: once a due row does not fit, no later row is taken, even one that would. The sweep passes rows oldest first, so the oldest text always leaves first.
- A blob falls due when its LAST referrer falls due. A referrer the reducer answers due from the start (`-Infinity`: under the per-copy rule, no holding file on record, or every one gone from disk) is dated as B2 dates W1-k's holders (`holderDueDateMs`): by the last write its RECORDED files saw (it cannot have fallen due before that, so the date errs early, as the rule does), else by its row's time. It is never dated as 0, the epoch. That value would reach `status --json` as a 1970 date and fire doctor's wait arm the moment the census counted the blob, with a detail of some 29 million minutes. A referrer with neither clock, or whose only clock is not after the epoch (B1's `transcriptFiles` reads a NULL `mtime_ns` as 0), is undated. A blob dates by its dated referrers, the early side. A blob with none stays due and counted, is undated, and is left out of the earliest, so it never hides a dated one and never stands in for one (⟦D:history-export-wait-from-census⟧).
- A CONTROL of the shape "a mutant that takes a row only when its blob is due" cannot be written here: a candidate row carries no other referrers of its blobs. BK12 is pinned instead by the hot-blob case asserting both answers side by side (planSegment takes the row, planExport says the blob is not due), and Task 5's candidate query owns the rest.

- [ ] **Step 1: Write the mutation runner.** It is a gitignored scratch tool (`.superpowers/` is in `.gitignore`), never committed: B2's runner with its scratch path moved to this plan's directory. Tasks 1–4 write this same file, byte for byte, so each task stands alone and rewriting it changes nothing. A mutant is `{name, file, test, filter, edits: [{anchor, replacement}]}`, and each anchor must occur exactly once in the file as the earlier edits leave it. For each mutant the runner copies the pristine file to `.superpowers/sdd/history-w1-b4/scratch/keep/`, applies the edits and runs the named tests, which must fail; it then restores the file from the copy, removes the copy, and runs the same tests again, which must pass. Only a kill no handler sees leaves a copy in `scratch/keep/`; the next run then refuses, and the runner's header gives the one-line restore. From the repository root:

```bash
mkdir -p .superpowers/sdd/history-w1-b4/scratch/keep
cat > .superpowers/sdd/history-w1-b4/scratch/mutate.mjs <<'EOF_RUNNER'
// .superpowers/sdd/history-w1-b4/scratch/mutate.mjs: measures each guard RED with it mutated, then GREEN with
// it restored (the B4 plan's mutation-pin rule). Run from server/, in the foreground, with a timeout of at least
// 600000 ms:
//   node ../.superpowers/sdd/history-w1-b4/scratch/mutate.mjs <mutants.json>
// A mutant is {name, file, test, filter, edits: [{anchor, replacement}]}. `file` is repo-relative, `test` is
// server/-relative, and each anchor must occur exactly once in the file as the earlier edits leave it. The
// pristine file is copied to scratch/keep/<file with '/' as '__'>.orig BEFORE it is touched, and the copy is
// removed only after the file is restored from it. A kill no handler sees therefore leaves the original findable,
// and the next run REFUSES while any copy is left. To restore by hand, from the repository root:
//   for f in .superpowers/sdd/history-w1-b4/scratch/keep/*.orig; do t="$(basename "$f" .orig)"; cp "$f" "${t//__//}" && rm "$f"; done
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const KEEP = '../.superpowers/sdd/history-w1-b4/scratch/keep';
mkdirSync(KEEP, { recursive: true });
const left = readdirSync(KEEP).filter((n) => n.endsWith('.orig'));
if (left.length > 0) {
  console.log(`REFUSED: ${left.join(', ')} in ${KEEP}. An earlier run was interrupted and a source may hold a mutant: restore as this file's header says.`);
  process.exit(1);
}
const keepOf = (file) => `${KEEP}/${file.replaceAll('/', '__')}.orig`;
const restoreAll = () => {
  for (const n of readdirSync(KEEP)) {
    if (!n.endsWith('.orig')) continue;
    copyFileSync(`${KEEP}/${n}`, `../${n.slice(0, -'.orig'.length).replaceAll('__', '/')}`);
    rmSync(`${KEEP}/${n}`);
  }
};
// Every way out restores: the loop's end, process.exit and an uncaught throw all emit 'exit', and a signal is
// turned into an exit. A signal sent while the synchronous loop holds the thread is handled after the current
// child returns; a Ctrl-C also reaches the vitest child, and the loop stops on the child's signal below.
process.on('exit', restoreAll);
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => process.exit(130));
const vitest = (test, filter) => spawnSync('./node_modules/.bin/vitest', ['run', test, '-t', filter], { encoding: 'utf8' });
const mutants = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let bad = 0;
for (const m of mutants) {
  const target = `../${m.file}`;
  if (!existsSync(target)) { console.log(`NO SUCH FILE       ${m.name}`); bad += 1; continue; }
  const keep = keepOf(m.file);
  copyFileSync(target, keep);
  let src = readFileSync(keep, 'utf8');
  let unique = true;
  for (const e of m.edits) {
    const at = src.indexOf(e.anchor);
    if (at < 0 || src.indexOf(e.anchor, at + 1) >= 0) { unique = false; break; }
    src = src.slice(0, at) + e.replacement + src.slice(at + e.anchor.length);
  }
  if (!unique) { rmSync(keep); console.log(`ANCHOR NOT UNIQUE  ${m.name}`); bad += 1; continue; }
  writeFileSync(target, src);
  const red = vitest(m.test, m.filter);
  copyFileSync(keep, target);
  rmSync(keep);
  if (red.signal !== null) { console.log(`INTERRUPTED (${red.signal})  ${m.name}`); process.exit(130); }
  const failed = /Tests\s+(\d+) failed/.exec(red.stdout)?.[1] ?? '?';
  if (red.status === 0) { console.log(`STAYED GREEN       ${m.name}`); bad += 1; } else console.log(`red (${failed} failed)   ${m.name}`);
  const green = vitest(m.test, m.filter);
  if (green.signal !== null) { console.log(`INTERRUPTED (${green.signal})  ${m.name}`); process.exit(130); }
  if (green.status !== 0) { console.log(`RED AFTER RESTORE  ${m.name}`); bad += 1; } else console.log(`green              ${m.name}`);
}
console.log(bad === 0 ? 'every guard measured red, then green' : `${bad} guard(s) not measured`);
process.exit(bad === 0 ? 0 : 1);
EOF_RUNNER
```

- [ ] **Step 2: Check the reducer contract B2 merged, then write the failing tests.** Every line below assumes the contract this task's Interfaces state for B2's per-copy task (⟦D:history-export-due-per-copy⟧). From the repository root:

```bash
grep -n 'perCopy\|shortestHome' ccd/history/lib.mjs ccd/history/lib.d.mts
grep -n -A8 '^export function planExport(' ccd/history/lib.mjs
```

Expected: `EXPORT_REDUCERS` holds both `perCopy` and `shortestHome` (and `lib.d.mts` declares both); `planExport`'s parameter list reads `reducer = EXPORT_REDUCERS.perCopy`; and its due test reads a reducer's answer as a due TIME, `reducer(r, homeRetentionDays) < nowMs`, with no `referrerAgeMs` call left in it. If the merged reducers answer anything else (B1's retention in days, a boolean, a function of `nowMs`), or `perCopy` is not the default, stop and report it to the coordinator: never adapt `planSegment` to a different contract here, because `planSegment` and the census must read one clock (RD1).

Then check B2's W1-k dating, which this task's `dueSinceMs` calls (one definition of "dated by a real clock, never a sentinel"):

```bash
grep -c '^function holderDueDateMs(h, homeRetentionDays, reducer) {' ccd/history/lib.mjs   # 1
grep -n -A6 '^function holderDueDateMs(' ccd/history/lib.mjs
```

Expected: `1`. The body must answer the reducer's time when that is not `-Infinity`, else the max recorded file mtime when the candidate has files, else `h.tsMs`. If it is absent, renamed or answers otherwise, stop and report it to the coordinator. Never copy its body into B4: the census's W1-k date and the wait clock must date a due-from-the-start candidate the same way.

Then append to the END of `server/test/history-lib.test.ts`:

```ts
// ===========================================================================
// W1-B4 Task 2: what one export segment carries, and the census's oldest
// due-since (spec §9.15 "What is due", "Write", "The gap guard"; O39's pure
// halves, O58's B4 half, O41's B4 input). Pure, on lib.mjs alone. The due
// rule is B2's per-copy reducer (ruled Q15, rev 3.4): a row is due when every
// file holding a copy of it has passed its mtime plus its own home's
// retention, minus 30 days, whatever the row's own time.
// ===========================================================================
import * as libCarry from '../../ccd/history/lib.mjs';

describe('W1-B4: planSegment, the row-level due rule and what a segment carries (spec 9.15; O39 pure halves)', () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 11, 1);
  const A = '/home/u/.claude-a';
  const C = '/home/u/.claude-c';
  const homes = { [A]: 180 };                          // home A's horizon: 150 days
  const M = libCarry.EXPORT_ROW_META_BYTES;            // each taken row's metadata, counted beside its new blob bytes
  const BOUND = 1_000 + 3 * M;                         // three rows' metadata and 1,000 blob bytes
  /** A present holding file of home A, last written `ageDays` ago. */
  const file = (ageDays: number): libCarry.ExportFile => ({ home: A, mtimeMs: NOW - ageDays * DAY, present: true });
  /** The same in home C, which keeps Claude Code's 30-day default where a case rosters it: horizon 0. */
  const inC = (ageDays: number): libCarry.ExportFile => ({ home: C, mtimeMs: NOW - ageDays * DAY, present: true });
  const blob = (key: string, zBytes: number, o: { exported?: boolean; pruned?: boolean } = {}): libCarry.SegmentBlob =>
    ({ key, zBytes, exported: o.exported ?? false, pruned: o.pruned ?? false });
  /** A candidate row written `ageDays` ago and held, unless `files` says otherwise, by ONE file of home A last written
   *  then: under the per-copy rule that file's clock decides, so a row's age here is its file's. */
  const row = (key: string, ageDays: number | null, blobs: libCarry.SegmentBlob[], files: libCarry.ExportFile[] = [file(ageDays ?? 0)]): libCarry.SegmentCandidate =>
    ({ key, tsMs: ageDays === null ? null : NOW - ageDays * DAY, files, blobs });
  const plan = (rows: libCarry.SegmentCandidate[], boundBytes = BOUND) =>
    libCarry.planSegment({ nowMs: NOW, homeRetentionDays: homes, rows, boundBytes });

  it('BK12: a hot blob\'s old row is taken and carries the blob, while planExport still answers the blob not due', () => {
    const hot = blob('b-hot', 40);
    const r = plan([row('e-old', 151, [hot]), row('e-young', 1, [hot])]);
    expect(r).toEqual({ take: ['e-old'], carry: ['b-hot'], stubs: [], bytes: 40 + M, leftDue: 0, oldestLeftDueSinceMs: null });
    const census = libCarry.planExport({ nowMs: NOW, homeRetentionDays: homes, blobs: [{ key: 'b-hot', referrers: [row('e-old', 151, [hot]), row('e-young', 1, [hot])] }] });
    expect(census.due).toEqual([]);
  });
  it('a row whose holding file has not passed its due date is neither taken nor counted', () => {
    expect(plan([row('e-young', 149, [blob('b-1', 10)])])).toEqual({ take: [], carry: [], stubs: [], bytes: 0, leftDue: 0, oldestLeftDueSinceMs: null });
  });
  it('a blob already exported is never carried again, and one shared by several taken rows is carried and counted once', () => {
    const shared = blob('b-shared', 300);
    const r = plan([row('e-1', 160, [shared, blob('b-done', 500, { exported: true })]), row('e-2', 155, [shared])]);
    expect(r).toEqual({ take: ['e-1', 'e-2'], carry: ['b-shared'], stubs: [], bytes: 300 + 2 * M, leftDue: 0, oldestLeftDueSinceMs: null });
  });
  it('a pruned blob is never carried and its size never counted: its row travels with a stub, once, and an exported one needs none', () => {
    const pruned = blob('b-pruned', 900, { pruned: true });
    const r = plan([row('e-1', 160, [pruned]), row('e-2', 159, [pruned, blob('b-gone', 700, { pruned: true, exported: true })])]);
    expect(r).toEqual({ take: ['e-1', 'e-2'], carry: [], stubs: ['b-pruned'], bytes: 2 * M, leftDue: 0, oldestLeftDueSinceMs: null });
  });
  it('the bound: rows in input order until the next would pass it (its new blob bytes and its metadata); nothing after that is taken, not even a row that would fit; the rest are counted with their earliest due-since', () => {
    const rows = [row('e-1', 170, [blob('b-1', 400)]), row('e-2', 165, [blob('b-2', 400)]), row('e-3', 160, [blob('b-3', 400)]),
      row('e-4', 158, [blob('b-4', 1)])];
    const r = plan(rows);
    expect(r.take).toEqual(['e-1', 'e-2']);
    expect(r.carry).toEqual(['b-1', 'b-2']);
    expect(r.bytes).toBe(800 + 2 * M);
    expect(r.leftDue).toBe(2);
    expect(r.oldestLeftDueSinceMs).toBe(NOW - 160 * DAY + 150 * DAY);
  });
  it('the first due row of the pass is taken whatever its size, so every pass moves the export forward', () => {
    expect(plan([row('e-big', 160, [blob('b-big', 5_000)]), row('e-next', 159, [blob('b-small', 1)])]))
      .toEqual({ take: ['e-big'], carry: ['b-big'], stubs: [], bytes: 5_000 + M, leftDue: 1, oldestLeftDueSinceMs: NOW - 9 * DAY });
  });
  it('a later page\'s first due row is held to what is left of the bound: with takenBefore, a row past it is left due, never taken whatever its size', () => {
    const big = [row('e-x', 160, [blob('b-x', 5_000)])];
    expect(libCarry.planSegment({ nowMs: NOW, homeRetentionDays: homes, rows: big, boundBytes: 1, takenBefore: true }))
      .toEqual({ take: [], carry: [], stubs: [], bytes: 0, leftDue: 1, oldestLeftDueSinceMs: NOW - 10 * DAY });
    expect(libCarry.planSegment({ nowMs: NOW, homeRetentionDays: homes, rows: big, boundBytes: 1 }).take, 'the pass\'s first row still travels')
      .toEqual(['e-x']);
  });
  it('each taken row counts EXPORT_ROW_META_BYTES beside its new blob bytes: rows that bring no new bytes (a stub, an exported blob) still fill a segment, so its row count is bounded', () => {
    expect(M).toBe(1536);
    const done = blob('b-done', 500, { exported: true });
    const stub = blob('b-stub', 0, { pruned: true });
    const rows = Array.from({ length: 10_000 }, (_, i) => row(`e-${i}`, 160, [i % 2 === 0 ? done : stub]));
    const r = plan(rows, 10 * M);
    expect(r.take).toHaveLength(10);
    expect(r.carry).toEqual([]);
    expect(r.bytes).toBe(10 * M);
    expect(r.leftDue).toBe(9_990);
  });
  it('rows come back in input order, never re-sorted by age', () => {
    expect(plan([row('e-c', 155, []), row('e-a', 170, []), row('e-b', 160, [])]).take).toEqual(['e-c', 'e-a', 'e-b']);
  });
  it('per copy: a row is due by its holding files, never by its own ts_ms; every file must pass; a file gone from disk has passed; a row with no holding file is due at once', () => {
    const r = plan([
      row('e-null-old', null, [], [file(200), file(160)]),            // both A copies past 150 days: due
      row('e-null-young', null, [], [file(200), file(5)]),            // a copy written 5 days ago holds it back
      row('e-long', 200, [], [file(1)]),                              // a 200-day-old row in an A file appended yesterday: not due
      row('e-gone', 1, [], [{ ...file(1), present: false }, file(151)]), // its young copy is gone, its other passed: due
      row('e-clockless', null, [], []),                               // no holding file on record: due at once
    ]);
    expect(r.take).toEqual(['e-null-old', 'e-gone', 'e-clockless']);
  });
  it('O58 (B4 half): with no reducer argument a row is due by its own copies (EXPORT_REDUCERS.perCopy): a 30-day home holding only swap copies brings no 180-day row forward, and its own rows are due from their file\'s last write; the reducer is one argument, never a signature', () => {
    const lowered = { ...homes, [C]: 30 };                           // home C rostered on the 30-day default: horizon 0
    const rows = [
      row('e-swap', 1, [blob('b-1', 1)], [file(1), inC(1)]),          // a swap copy in C: A's copy waits 149 more days
      row('e-a-only', 1, [blob('b-2', 1)]),                           // A alone: not due for 149 days
      row('e-c-only', 1, [blob('b-3', 1)], [inC(1)]),                 // C alone: due from its file's last write
    ];
    expect(libCarry.planSegment({ nowMs: NOW, homeRetentionDays: lowered, rows, boundBytes: BOUND }).take).toEqual(['e-c-only']);
    // The node-shortest reducer (B1's default, history since B2) would have taken all three: one home on the 30-day
    // default set the whole node's horizon to 0. Passing it is one argument, and no signature changes.
    expect(libCarry.planSegment({ nowMs: NOW, homeRetentionDays: lowered, rows, boundBytes: BOUND, reducer: libCarry.EXPORT_REDUCERS.shortestHome }).take)
      .toEqual(['e-swap', 'e-a-only', 'e-c-only']);
    const never: libCarry.ExportReducer = () => Number.POSITIVE_INFINITY;
    expect(libCarry.planSegment({ nowMs: NOW, homeRetentionDays: lowered, rows, boundBytes: BOUND, reducer: never }).take).toEqual([]);
  });
  it('RD1\'s one clock: with no reducer argument, planSegment takes exactly the rows planExport (the census) answers due, each row a blob of its own', () => {
    const lowered = { ...homes, [C]: 30 };
    const rows = [
      row('e-1', 151, []), row('e-2', 149, []), row('e-3', 1, [], [inC(1)]), row('e-4', 1, [], [file(1), inC(1)]),
      row('e-5', 300, [], [file(2)]), row('e-6', null, [], []), row('e-7', 2, [], [{ ...file(2), present: false }]),
    ];
    const seg = libCarry.planSegment({ nowMs: NOW, homeRetentionDays: lowered, rows, boundBytes: 100 * M });
    const census = libCarry.planExport({ nowMs: NOW, homeRetentionDays: lowered, blobs: rows.map((r) => ({ key: r.key, referrers: [r] })) });
    expect(seg.take).toEqual(census.due);
    expect(seg.take).toEqual(['e-1', 'e-3', 'e-6', 'e-7']);
  });
  it('a left-behind row due from the start dates by the last write its recorded files saw, never the epoch; one with no clock on record is counted but undated', () => {
    const r = libCarry.planSegment({ nowMs: NOW, homeRetentionDays: homes, boundBytes: 1, rows: [
      row('e-first', 160, [blob('b-first', 5_000)]),                                // the pass's first row: taken whatever its size
      row('e-gone', 3, [blob('b-gone', 1)], [{ ...file(3), present: false }]),       // its one file deleted: due from the start, last written 3 days ago
      row('e-clockless', null, [blob('b-none', 1)], []),                             // no file and no time on record: due, undated
    ] });
    expect(r.take).toEqual(['e-first']);
    expect(r.leftDue).toBe(2);
    expect(r.oldestLeftDueSinceMs, 'the recorded last write, never 0 (1970)').toBe(NOW - 3 * DAY);
    const undated = libCarry.planSegment({ nowMs: NOW, homeRetentionDays: homes, boundBytes: 1, takenBefore: true,
      rows: [row('e-clockless', null, [blob('b-none', 1)], [])] });
    expect(undated).toMatchObject({ take: [], leftDue: 1, oldestLeftDueSinceMs: null });
  });
});

describe('W1-B4: planExport\'s oldest due-since, the census input of doctor\'s wait rule (spec 9.15 "The gap guard"; O41 B4 input)', () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 11, 1);
  const A = '/home/u/.claude-a';
  const homes = { [A]: 180 };                          // home A's horizon: 150 days
  /** A referrer written `ageDays` ago, held by ONE file of home A last written then (the per-copy clock reads that
   *  file); null: no time and no holding file on record. */
  const ref = (ageDays: number | null): libCarry.ExportCandidate =>
    ({ tsMs: ageDays === null ? null : NOW - ageDays * DAY, files: ageDays === null ? [] : [{ home: A, mtimeMs: NOW - ageDays * DAY, present: true }] });
  const census = (blobs: { key: string; referrers: libCarry.ExportCandidate[] }[]) =>
    libCarry.planExport({ nowMs: NOW, homeRetentionDays: homes, blobs });
  it('the earliest time any due blob fell due; a blob falls due when its LAST referrer does (its file\'s last write plus 150 days)', () => {
    const r = census([
      { key: 'b-late', referrers: [ref(200), ref(170)] },        // due since its 170-day referrer's file passed: 20 days ago
      { key: 'b-early', referrers: [ref(190)] },                 // due 40 days ago
      { key: 'b-young', referrers: [ref(190), ref(10)] },        // not due
    ]);
    expect(r.due).toEqual(['b-late', 'b-early']);
    expect(r.oldestDueSinceMs).toBe(NOW - 40 * DAY);
  });
  it('null when nothing is due; a blob nothing on disk holds back is dated by the last write its recorded files saw, else its row\'s time, never the epoch (1970); one with no clock on record is due, counted and undated (null), and never hides a dated one', () => {
    expect(census([{ key: 'b-young', referrers: [ref(1)] }])).toMatchObject({ due: [], oldestDueSinceMs: null });
    /** Written `ageDays` ago, its one file of home A since deleted: due from the start under the per-copy rule. */
    const gone = (ageDays: number): libCarry.ExportCandidate =>
      ({ tsMs: NOW - ageDays * DAY, files: [{ home: A, mtimeMs: NOW - ageDays * DAY, present: false }] });
    expect(libCarry.EXPORT_REDUCERS.perCopy(gone(3), homes), 'precondition: the reducer answers due from the start').toBe(Number.NEGATIVE_INFINITY);
    expect(census([{ key: 'b-gone', referrers: [gone(3)] }])).toMatchObject({ due: ['b-gone'], oldestDueSinceMs: NOW - 3 * DAY });
    expect(census([{ key: 'b-fileless', referrers: [{ tsMs: NOW - 2 * DAY, files: [] }] }]))
      .toMatchObject({ due: ['b-fileless'], oldestDueSinceMs: NOW - 2 * DAY });
    expect(census([{ key: 'b-clockless', referrers: [ref(null)] }])).toMatchObject({ due: ['b-clockless'], oldestDueSinceMs: null });
    // A recorded mtime of 0 (B1's transcriptFiles reads a NULL mtime_ns as 0) is no clock either.
    expect(census([{ key: 'b-zero', referrers: [{ tsMs: null, files: [{ home: A, mtimeMs: 0, present: false }] }] }]))
      .toMatchObject({ due: ['b-zero'], oldestDueSinceMs: null });
    // The dated blob first, so an undated one met after it must not overwrite it.
    expect(census([{ key: 'b-early', referrers: [ref(190)] }, { key: 'b-clockless', referrers: [ref(null)] }]).oldestDueSinceMs)
      .toBe(NOW - 40 * DAY);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W1-B4: plan')
```

Expected: FAIL, `Tests 15 failed`. The thirteen planSegment cases fail with `TypeError: planSegment is not a function` (the metadata case may fail first on `expected undefined to be 1536`). The two due-since cases fail on `oldestDueSinceMs`, which does not exist yet (`expected undefined to be …`, or a `toMatchObject` diff naming `oldestDueSinceMs`); their `due` assertions already hold on B2's per-copy default.

- [ ] **Step 4: Implement.** In `ccd/history/lib.mjs`:

(a) In B1's `planExport`, directly below its two lines

```js
  const due = [];
  const overdue = [];
```

insert:

```js
  let oldestDueSinceMs = null;
```

(b) In the same function, directly below its line `    due.push(blob.key);`, insert:

```js
    // W1-B4: when this blob fell due — when its LAST referrer fell due, by the reducer's own due time (B2's per-copy
    // default, ⟦D:history-export-due-per-copy⟧), a referrer due from the start dated by its recorded files — and the
    // earliest over every DATED due blob, which doctor's wait rule reads from the census (§9.15 "The gap guard";
    // ⟦D:history-export-wait-from-census⟧). A blob with an undated referrer dates by its dated ones (the early side);
    // one with none stays due and counted, undated, and never stands in for the epoch.
    let since = null;
    for (const r of blob.referrers) {
      const t = dueSinceMs(r, homeRetentionDays, reducer);
      if (t !== null && (since === null || t > since)) since = t;
    }
    if (since !== null && (oldestDueSinceMs === null || since < oldestDueSinceMs)) oldestDueSinceMs = since;
```

The loop is not a spread: a hot blob can have tens of thousands of referrers (DM3), past `Math.max(...)`'s argument limit.

(c) Replace its return line

```js
  return { horizonDays: exportHorizonDays(shortestRetention(homeRetentionDays)), due, overdue };
```

with

```js
  return { horizonDays: exportHorizonDays(shortestRetention(homeRetentionDays)), due, overdue, oldestDueSinceMs };
```

Under the per-copy rule `horizonDays` decides nothing; it is the reported horizon (spec §8.4: "the shortest any home's files have, no longer the node's due rule"). If B2's per-copy task reworded this return line, keep its wording and add `oldestDueSinceMs` as the last member of the object it returns.

(d) Append to the END of the file:

```js
// ===========================================================================
// What one export segment carries (spec §9.15 "What is due", "Write"; W1-B4
// Task 2). Pure: the sweep pages its candidate rows, oldest first, with each
// row's time, its holding files and its blobs' export and prune state, and
// writes what this answers. Due-ness is the reducer's, B2's per-copy one by
// default (ruled Q15, rev 3.4), the census's own: one clock (RD1).
// ⟦D:history-export-row-carries-blob⟧ ⟦D:history-export-due-per-copy⟧
// ⟦D:history-export-pruned-row-stub⟧ ⟦D:history-export-segment-bound-estimated⟧
// ===========================================================================

/** What one taken row is counted for in the segment bound, beside its new blob bytes: an estimate of its metadata in
 *  the file (its entry's named columns, its memberships, its share of the family, transcript, epoch and file rows).
 *  Chosen: a prototype of the format-1 tables measured 0.8–1.1 KiB per entry with one membership and about 0.2 KiB
 *  per further membership, over a fixed 56 KiB of schema pages. Counting it keeps a segment near
 *  EXPORT_SEGMENT_MAX_BYTES when rows are small beside their metadata, and bounds a segment's rows (at most about
 *  EXPORT_SEGMENT_MAX_BYTES / EXPORT_ROW_META_BYTES, some 175,000), so rows that bring no new bytes cannot grow one,
 *  or the pass's memory, without limit (⟦D:history-export-segment-bound-estimated⟧). */
export const EXPORT_ROW_META_BYTES = 1536;

/** When a due candidate fell due, as a real clock, or null when it has none (W1-B4; ⟦D:history-export-wait-from-census⟧).
 *  The reducer's due time when it names one, the one clock, so due-ness and due-since never disagree. A candidate the
 *  reducer answers due from the start (-Infinity: under the per-copy rule, no holding file on disk) is dated by B2's
 *  own W1-k rule, holderDueDateMs, never by a sentinel: the last write its RECORDED files saw (it cannot have fallen
 *  due before that, so the date errs early, as the rule does), else its row's time. Null, undated, when it has
 *  neither, or when the only clock is not after the epoch (B1's transcriptFiles reads a NULL mtime_ns as 0): the
 *  candidate stays due and counted, and no 1970 due-since is ever answered for it (⟦D:history-export-due-per-copy⟧).
 *  Called only for a due candidate. */
function dueSinceMs(candidate, homeRetentionDays, reducer) {
  const at = holderDueDateMs(candidate, homeRetentionDays, reducer);
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;
}

/** One segment's contents (§9.15). A row is DUE when the reducer's due time for it is before nowMs: by default B2's
 *  EXPORT_REDUCERS.perCopy, under which every file holding a copy of the row has passed its mtime plus its own home's
 *  retention, minus 30 days (ruled Q15, rev 3.4; ⟦D:history-export-due-per-copy⟧), whatever its blobs' other referrers
 *  (rev 3.1 review, BK12; ⟦D:history-export-row-carries-blob⟧).
 *  A due row is taken with:
 *  - the bytes of every blob it references that is neither exported nor pruned (`carry`). A blob already exported
 *    is never carried again, and one shared by several taken rows is carried once;
 *  - a stub of every pruned blob it references that no segment carried before (`stubs`): its sha, codec and size
 *    with no bytes, so a rebuild keeps the row's structure (entries.blob_id is NOT NULL). A stub is never exported
 *    text and its size never counts toward the bound; its row's metadata does (⟦D:history-export-pruned-row-stub⟧).
 *  Rows are taken in input order, which the sweep makes oldest first, until the next due row's counted bytes (its new
 *  blob bytes plus EXPORT_ROW_META_BYTES) would pass `boundBytes`; from there no later row is taken, so a segment is
 *  a prefix of the backlog. The first due row of the PASS is taken whatever its size, so every pass moves the export
 *  forward: `takenBefore` says an earlier call of the same pass (an earlier page) already took one, and then this
 *  call's first row must fit too. The due rows left behind are counted, with the earliest time any of them fell
 *  due. planExport's per-BLOB rule stays the census's; both ask the same reducer with the same default, so the pass
 *  and the census read one clock (RD1), and a rule is still one reducer and no signature (rev 3.2 review, FE13). */
export function planSegment({ nowMs, homeRetentionDays, rows, boundBytes, reducer = EXPORT_REDUCERS.perCopy, takenBefore = false }) {
  const take = [];
  const carry = [];
  const stubs = [];
  const carried = new Set();
  const stubbed = new Set();
  let bytes = 0;
  let leftDue = 0;
  let oldestLeftDueSinceMs = null;
  let full = false;
  for (const row of rows) {
    const dueAt = reducer(row, homeRetentionDays);
    if (!(dueAt < nowMs)) continue;
    const fresh = new Map();
    for (const b of row.blobs) if (!b.exported && !b.pruned && !carried.has(b.key)) fresh.set(b.key, b);
    let add = EXPORT_ROW_META_BYTES;
    for (const b of fresh.values()) add += b.zBytes;
    if (full || ((take.length > 0 || takenBefore) && bytes + add > boundBytes)) {
      full = true;
      leftDue += 1;
      const since = dueSinceMs(row, homeRetentionDays, reducer);
      if (since !== null && (oldestLeftDueSinceMs === null || since < oldestLeftDueSinceMs)) oldestLeftDueSinceMs = since;
      continue;
    }
    take.push(row.key);
    for (const b of fresh.values()) {
      carried.add(b.key);
      carry.push(b.key);
    }
    bytes += add;
    for (const b of row.blobs) {
      if (b.pruned && !b.exported && !stubbed.has(b.key)) {
        stubbed.add(b.key);
        stubs.push(b.key);
      }
    }
  }
  return { take, carry, stubs, bytes, leftDue, oldestLeftDueSinceMs };
}
```

`dueSinceMs` is a function declaration, so `planExport` (above it in the file) calls it after hoisting. `EXPORT_ROW_META_BYTES` is a `const` above `planSegment` in the same block, read only when `planSegment` is called, and so is `EXPORT_REDUCERS.perCopy` in its default parameter (B2 declares it with `EXPORT_REDUCERS`, above). `!(dueAt < nowMs)` rather than `dueAt >= nowMs`, so a reducer answering `NaN` leaves the row waiting rather than exporting it on a non-number. Neither B4 function reads B1's `referrerAgeMs`: if B2 keeps it, it belongs to `shortestHome`'s row clock, and a second reader here would be a second clock.

`dueSinceMs` calls B2's module-private `holderDueDateMs` (B2 Task 35's export block, above both B4 functions in the file; Step 2 checked it), which runs the reducer once more. That is pure and cheap, and it is only reached for a due candidate. `dueSinceMs` never answers 0: `planExport` and `planSegment` skip a null from it, so `oldestDueSinceMs` and `oldestLeftDueSinceMs` are each a time or null, and the `due` / `leftDue` beside them says whether anything is due.

- [ ] **Step 5: Declare the types.** In `ccd/history/lib.d.mts`, in `planExport`'s declaration, replace its last line

```ts
}): { horizonDays: number; due: string[]; overdue: string[] };
```

with

```ts
}): { horizonDays: number; due: string[]; overdue: string[]; oldestDueSinceMs: number | null };
```

Then append to the END of the file:

```ts
// --- W1-B4 Task 2: what one export segment carries (spec §9.15 "What is due", "Write")
export interface SegmentBlob { key: string; zBytes: number; exported: boolean; pruned: boolean }
export interface SegmentCandidate extends ExportCandidate { key: string; blobs: readonly SegmentBlob[] }
export interface SegmentPlan { take: string[]; carry: string[]; stubs: string[]; bytes: number; leftDue: number; oldestLeftDueSinceMs: number | null }
export const EXPORT_ROW_META_BYTES: number;
export function planSegment(i: {
  nowMs: number; homeRetentionDays: Readonly<Record<string, number>>; rows: readonly SegmentCandidate[]; boundBytes: number; reducer?: ExportReducer;
  takenBefore?: boolean;
}): SegmentPlan;
```

Check: `grep -c '^export function planSegment(' ccd/history/lib.d.mts`, `grep -c '^export interface SegmentCandidate ' ccd/history/lib.d.mts`, `grep -c '^export const EXPORT_ROW_META_BYTES:' ccd/history/lib.d.mts` and `grep -c '^export const EXPORT_ROW_META_BYTES = ' ccd/history/lib.mjs` each print 1.

- [ ] **Step 6: Run them and see them pass; then the whole file and the typecheck.** In the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W1-B4: plan')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: `Tests 15 passed`; then every case in the file (B1's `planExport and retentionLowered` describe and B2's per-copy cases included, unchanged); `tsc` prints nothing. B1's census (`exportCensus` in sweep.mjs) reads `.due` and `.overdue` only, so its pins stay green too: `(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'O38|O58')` (B1 Task 26's describe `O38: the export's due rule (B1 half)`, as B2 re-ran its due cases under the per-copy default, and any O58 case B2's per-copy task put in that file).

- [ ] **Step 7: Measure every guard red, then green.** From the repository root:

```bash
cat > .superpowers/sdd/history-w1-b4/scratch/mutants-task2.json <<'MUT_EOF'
[
 {
  "name": "O39: an exported blob carried again",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "if (!b.exported && !b.pruned && !carried.has(b.key)) fresh.set(b.key, b);", "replacement": "if (!b.pruned && !carried.has(b.key)) fresh.set(b.key, b);" }]
 },
 {
  "name": "O39: a blob shared by two taken rows carried twice",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "if (!b.exported && !b.pruned && !carried.has(b.key)) fresh.set(b.key, b);", "replacement": "if (!b.exported && !b.pruned) fresh.set(b.key, b);" }]
 },
 {
  "name": "6.6: a pruned blob carried",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "if (!b.exported && !b.pruned && !carried.has(b.key)) fresh.set(b.key, b);", "replacement": "if (!b.exported && !carried.has(b.key)) fresh.set(b.key, b);" }]
 },
 {
  "name": "stub: a pruned blob's row travels without its stub",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "      if (b.pruned && !b.exported && !stubbed.has(b.key)) {\n        stubbed.add(b.key);\n        stubs.push(b.key);\n      }\n", "replacement": "" }]
 },
 {
  "name": "stub: an exported pruned blob stubbed again",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "      if (b.pruned && !b.exported && !stubbed.has(b.key)) {", "replacement": "      if (b.pruned && !stubbed.has(b.key)) {" }]
 },
 {
  "name": "9.15: the segment bound ignored",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "    if (full || ((take.length > 0 || takenBefore) && bytes + add > boundBytes)) {", "replacement": "    if (full) {" }]
 },
 {
  "name": "9.15: a first row over the bound refused (the pass never moves)",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "    if (full || ((take.length > 0 || takenBefore) && bytes + add > boundBytes)) {", "replacement": "    if (full || bytes + add > boundBytes) {" }]
 },
 {
  "name": "9.15: a later row that fits slips past the stop",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "    if (full || ((take.length > 0 || takenBefore) && bytes + add > boundBytes)) {", "replacement": "    if ((take.length > 0 || takenBefore) && bytes + add > boundBytes) {" }]
 },
 {
  "name": "9.15: a later page's first row taken whatever its size (takenBefore ignored)",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "    if (full || ((take.length > 0 || takenBefore) && bytes + add > boundBytes)) {", "replacement": "    if (full || (take.length > 0 && bytes + add > boundBytes)) {" }]
 },
 {
  "name": "9.15: row metadata not counted toward the bound",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "    let add = EXPORT_ROW_META_BYTES;", "replacement": "    let add = 0;" }]
 },
 {
  "name": "9.15: a row not yet due taken",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "    if (!(dueAt < nowMs)) continue;\n", "replacement": "" }]
 },
 {
  "name": "O58 CONTROL: planSegment's default stays the node-shortest reducer",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "reducer = EXPORT_REDUCERS.perCopy, takenBefore = false })", "replacement": "reducer = EXPORT_REDUCERS.shortestHome, takenBefore = false })" }]
 },
 {
  "name": "O58 CONTROL: a row aged by its own ts_ms (the row clock), not by its holding files",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "    const dueAt = reducer(row, homeRetentionDays);", "replacement": "    const dueAt = row.tsMs !== null ? row.tsMs + exportHorizonDays(shortestRetention(homeRetentionDays)) * EXPORT_DAY_MS : reducer(row, homeRetentionDays);" }]
 },
 {
  "name": "FE13: planSegment bypasses the reducer it is given",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "    const dueAt = reducer(row, homeRetentionDays);", "replacement": "    const dueAt = EXPORT_REDUCERS.perCopy(row, homeRetentionDays);" }]
 },
 {
  "name": "9.15: the left-behind due-since answers the latest",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "      if (since !== null && (oldestLeftDueSinceMs === null || since < oldestLeftDueSinceMs)) oldestLeftDueSinceMs = since;", "replacement": "      if (since !== null && (oldestLeftDueSinceMs === null || since > oldestLeftDueSinceMs)) oldestLeftDueSinceMs = since;" }]
 },
 {
  "name": "no epoch: an undated left-behind row overwrites the earliest",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planSegment",
  "edits": [{ "anchor": "      if (since !== null && (oldestLeftDueSinceMs === null || since < oldestLeftDueSinceMs)) oldestLeftDueSinceMs = since;", "replacement": "      if (oldestLeftDueSinceMs === null || since < oldestLeftDueSinceMs) oldestLeftDueSinceMs = since;" }]
 },
 {
  "name": "O41: the census's oldest due-since answers the maximum",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planExport's oldest due-since",
  "edits": [{ "anchor": "    if (since !== null && (oldestDueSinceMs === null || since < oldestDueSinceMs)) oldestDueSinceMs = since;", "replacement": "    if (since !== null && (oldestDueSinceMs === null || since > oldestDueSinceMs)) oldestDueSinceMs = since;" }]
 },
 {
  "name": "no epoch: an undated blob overwrites the census's earliest",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planExport's oldest due-since",
  "edits": [{ "anchor": "    if (since !== null && (oldestDueSinceMs === null || since < oldestDueSinceMs)) oldestDueSinceMs = since;", "replacement": "    if (oldestDueSinceMs === null || since < oldestDueSinceMs) oldestDueSinceMs = since;" }]
 },
 {
  "name": "O41: a blob falls due at its FIRST referrer's crossing",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planExport's oldest due-since",
  "edits": [{ "anchor": "      if (t !== null && (since === null || t > since)) since = t;", "replacement": "      if (t !== null && (since === null || t < since)) since = t;" }]
 },
 {
  "name": "THE OLD BEHAVIOUR: due from the start read as the epoch (1970)",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: plan",
  "edits": [{ "anchor": "  const at = holderDueDateMs(candidate, homeRetentionDays, reducer);\n  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;", "replacement": "  const at = reducer(candidate, homeRetentionDays);\n  return Number.isFinite(at) ? at : 0;" }]
 },
 {
  "name": "W1-k dating bypassed: a due-from-the-start candidate left undated",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: plan",
  "edits": [{ "anchor": "  const at = holderDueDateMs(candidate, homeRetentionDays, reducer);", "replacement": "  const at = reducer(candidate, homeRetentionDays);" }]
 },
 {
  "name": "no epoch: a recorded mtime of 0 passed through as a time",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: planExport's oldest due-since",
  "edits": [{ "anchor": "Number.isFinite(at) && at > 0 ? at : null;", "replacement": "Number.isFinite(at) ? at : null;" }]
 }
]
MUT_EOF
(cd server && node ../.superpowers/sdd/history-w1-b4/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b4/scratch/mutants-task2.json)
```

Foreground, timeout at least 600000 ms. Expected: every row `red (N failed)` then `green`, and `every guard measured red, then green`, exit 0. Measured while drafting, before the metadata term, `takenBefore` and the per-copy rewrite (rev 3.4): every row red with 1 failed case, except `9.15: the segment bound ignored` (2). With them, `9.15: row metadata not counted toward the bound` reds every planSegment case that asserts `bytes` as well as the metadata case, the bound rows may red the metadata case too, and the per-copy rows each red at least the case their name points at: `9.15: a row not yet due taken` the not-yet-passed case (and others), `O58 CONTROL: planSegment's default stays the node-shortest reducer` the per-copy, O58 and RD1 cases (O58's add-B CONTROL), `O58 CONTROL: a row aged by its own ts_ms` the per-copy case (`e-long`, `e-gone`) and the RD1 case (O58's long-lived-file CONTROL), `FE13: planSegment bypasses the reducer it is given` the O58 case's explicit-reducer assertions. These rows were not re-measured after that rewrite: the worker records the counts, and only a `STAYED GREEN` is a failure. `THE OLD BEHAVIOUR` reinstates B4's first `dueSinceMs` exactly and must red both new cases (`expected 0 to be …`, and `oldestLeftDueSinceMs: 0` where null was expected). `W1-k dating bypassed` reds `b-gone`, `b-fileless` and `e-gone` (null where a time was expected). The two `no epoch: … overwrites` rows red the cases that put a dated blob or row before an undated one.

- [ ] **Step 8: Confirm the restore, and commit.** In the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b4/scratch/keep)" && echo RESTORED
```

Only after `RESTORED`, in a separate call:

```bash
git diff --stat
git add ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-lib.test.ts
git commit -m "feat(history): planSegment, the row-level due rule with blobs carried and pruned blobs stubbed, and the census's oldest due-since (W1-B4 task 2)"
```

`git diff --stat` must list exactly those three files.

### Task 3: lib + sweep seam: the recovery step's export phases, their cursor arm, the segment replay verdict, and placeholder executors

**Files:**
- Modify: `ccd/history/lib.mjs`. B2 Task 7's recovery block, in place by content: the `RECOVER_PHASES` declaration, one constant inserted below `RECOVER_REINDEX_CURSOR_RE`, and one arm inserted in `parseRecoverCursor`. Then one block appended at the END of the file.
- Modify: `ccd/history/lib.d.mts`: append one declaration at the end.
- Modify: `ccd/history/sweep.mjs` (B1-created; B2 Task 25 wrote its recovery section). Every edit is above the entry guard `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {` (R1), inside B2's recovery section, which sits above `export async function tick(db, ctx) {`:
  - insert two functions directly above the doc comment that begins `/** One executor per RECOVER_PHASES phase, keyed by its name.`;
  - add two members inside the `RECOVER_EXECUTORS` object literal, between `apply:` and `reindex:` (never spread at its end: B2's test compares the key ORDER);
  - two comment sentences in place (the section header's and `RECOVER_EXECUTORS`' doc's "W1-B4 inserts/adds its export phases" sentences).
- Test: `server/test/history-lib.test.ts`: four in-place edits in B2 Task 7's describe `RecoverCursor: the recovery step cursor grammar (spec 9.14; B4 adds export phases)`, and one block appended at the END.
- Test: `server/test/history-recover.test.ts` (B2-created): one block appended at the END (its import at the block's head). It reuses B2's module-scope `SW`, `stepCtx`, `cursorOn`, `countersOn` and the file's imports (`makeHistoryBox`, `createStore`, `openWriter`, `closeWriter`, `historyPaths`, `DatabaseSync`, `HistoryBox`).
- Scratch, gitignored: `.superpowers/sdd/history-w1-b4/scratch/mutate.mjs` and `.superpowers/sdd/history-w1-b4/scratch/mutants-task3.json`.

**Interfaces:**
- Consumes (B2 Task 7, `lib.mjs`, MERGED — re-read before editing; the plan text is not ground truth):
  - `RECOVER_PHASES` (`['index', 'apply', 'reindex']`, frozen, O14-bound in B2's VOCABS);
  - `RecoverCursor { phase; file: string | null; offset; blobId: number | null; pairsAdded }`;
  - `formatRecoverCursor(c)`: throws `TypeError` for a phase outside `RECOVER_PHASES`; for any phase but `reindex` it prints `<phase>:<file>:<offset>` when `file` is set. Verify that arm on the base: the export phases need no change there;
  - `parseRecoverCursor(s)` with its two module-private regexes `RECOVER_JOURNAL_CURSOR_RE` and `RECOVER_REINDEX_CURSOR_RE`.
- Consumes (B2 Task 25/29, `sweep.mjs`, MERGED): the `RECOVER_EXECUTORS` literal `{ index: recoverIndexChunk, apply: recoverApplyChunk, reindex: recoverReindexChunk }`; `recoveryStep(db, ctx, executors = RECOVER_EXECUTORS)`, which on a phase's `phaseDone` commits `{ phase: RECOVER_PHASES[at + 1], file: null, offset: 0, blobId: null, pairsAdded: run.pairsAdded }`, takes `run.pairsAdded` from the stored cursor, and counts `recover_chunk_failed` for a stored cursor that does not parse.
- Consumes (Task 1): `parseSegmentName`, `EXPORT_SEGMENT_FORMAT`.
- Produces:
  - `RECOVER_PHASES = Object.freeze(['index', 'apply', 'export-blobs', 'export-rows', 'reindex'])`, the one declaration replaced in place;
  - `parseRecoverCursor` gains the export arm: `export-blobs` or `export-rows`, optionally `:<segment name>:<offset>` (the offset a blobs rowid in `export-blobs`, a row `ord` in `export-rows`), optionally `+pairs`. The segment name is checked by `parseSegmentName`, so its grammar is spelled once; a journal phase never names a segment and an export phase never names a journal file;
  - `decideSegmentReplay({ meta: { storeId: string; format: number }; storeId: string }): 'replay' | 'newer' | 'foreign'` (lib, declared in `lib.d.mts`);
  - `sweep.mjs`: module-private `recoverExportBlobsChunk(db, run, cursor)` and `recoverExportRowsChunk(db, run, cursor)`, placeholders answering `{ cursor, moved: false, phaseDone: true }`, in `RECOVER_EXECUTORS` as `'export-blobs'` and `'export-rows'`.
- Later consumers: Task 10 (replaces both placeholder bodies; reads the cursor arm and `decideSegmentReplay`). `orderSegmentNames`, which replay also reads, is Task 1's.

**Spec:** §9.14 "Recovery" (the cursor: "a journal file and byte offset, then an export phase and segment"; a cursor that does not parse is never a guess), "Export replay" (two passes over every segment, blobs first; a segment whose format is newer than the build reads is refused loudly, `export-segment-newer`, and skipped), §9.10 "Export replay". Pins: the pure half of **O44**'s segment case (`newer`, `foreign`, `replay`), the cursor round trip, and the seam: B2's `RECOVER_EXECUTORS runs every RECOVER_PHASES phase, and only those` stays green, and `+pairs` crosses both export phases. Departures: ⟦D:history-recovery-replay⟧, ⟦D:history-b4-after-b2⟧.

Choices this task makes (each copied into the PR body by Task 12 Step 9):
- A segment whose store_id is not this store's is `foreign` WHATEVER its format, so another store's newer segment is never this store's FAIL.
- The export arm checks the segment name with `parseSegmentName` rather than a second spelling of its grammar inside the cursor regex.
- B2's own cursor pins are edited in place, citing §9.14: `RECOVER_PHASES` has five phases, and the token B2 used as "an invalid phase" (`export-blobs`) is now a valid one, so `export-segments` takes its place in both the must-be-null list and the `formatRecoverCursor` throw.
- A step B2 registered before B4 (stored `apply…` cursors) moves through the new phases unchanged: `recoveryStep` builds the next phase's cursor from `RECOVER_PHASES`, with `+pairs` from the run. The history-recover case pins it.

- [ ] **Step 1: Write the mutation runner.** It is a gitignored scratch tool (`.superpowers/` is in `.gitignore`), never committed: B2's runner with its scratch path moved to this plan's directory. Tasks 1–4 write this same file, byte for byte, so each task stands alone and rewriting it changes nothing. A mutant is `{name, file, test, filter, edits: [{anchor, replacement}]}`, and each anchor must occur exactly once in the file as the earlier edits leave it. For each mutant the runner copies the pristine file to `.superpowers/sdd/history-w1-b4/scratch/keep/`, applies the edits and runs the named tests, which must fail; it then restores the file from the copy, removes the copy, and runs the same tests again, which must pass. Only a kill no handler sees leaves a copy in `scratch/keep/`; the next run then refuses, and the runner's header gives the one-line restore. From the repository root:

```bash
mkdir -p .superpowers/sdd/history-w1-b4/scratch/keep
cat > .superpowers/sdd/history-w1-b4/scratch/mutate.mjs <<'EOF_RUNNER'
// .superpowers/sdd/history-w1-b4/scratch/mutate.mjs: measures each guard RED with it mutated, then GREEN with
// it restored (the B4 plan's mutation-pin rule). Run from server/, in the foreground, with a timeout of at least
// 600000 ms:
//   node ../.superpowers/sdd/history-w1-b4/scratch/mutate.mjs <mutants.json>
// A mutant is {name, file, test, filter, edits: [{anchor, replacement}]}. `file` is repo-relative, `test` is
// server/-relative, and each anchor must occur exactly once in the file as the earlier edits leave it. The
// pristine file is copied to scratch/keep/<file with '/' as '__'>.orig BEFORE it is touched, and the copy is
// removed only after the file is restored from it. A kill no handler sees therefore leaves the original findable,
// and the next run REFUSES while any copy is left. To restore by hand, from the repository root:
//   for f in .superpowers/sdd/history-w1-b4/scratch/keep/*.orig; do t="$(basename "$f" .orig)"; cp "$f" "${t//__//}" && rm "$f"; done
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const KEEP = '../.superpowers/sdd/history-w1-b4/scratch/keep';
mkdirSync(KEEP, { recursive: true });
const left = readdirSync(KEEP).filter((n) => n.endsWith('.orig'));
if (left.length > 0) {
  console.log(`REFUSED: ${left.join(', ')} in ${KEEP}. An earlier run was interrupted and a source may hold a mutant: restore as this file's header says.`);
  process.exit(1);
}
const keepOf = (file) => `${KEEP}/${file.replaceAll('/', '__')}.orig`;
const restoreAll = () => {
  for (const n of readdirSync(KEEP)) {
    if (!n.endsWith('.orig')) continue;
    copyFileSync(`${KEEP}/${n}`, `../${n.slice(0, -'.orig'.length).replaceAll('__', '/')}`);
    rmSync(`${KEEP}/${n}`);
  }
};
// Every way out restores: the loop's end, process.exit and an uncaught throw all emit 'exit', and a signal is
// turned into an exit. A signal sent while the synchronous loop holds the thread is handled after the current
// child returns; a Ctrl-C also reaches the vitest child, and the loop stops on the child's signal below.
process.on('exit', restoreAll);
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => process.exit(130));
const vitest = (test, filter) => spawnSync('./node_modules/.bin/vitest', ['run', test, '-t', filter], { encoding: 'utf8' });
const mutants = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let bad = 0;
for (const m of mutants) {
  const target = `../${m.file}`;
  if (!existsSync(target)) { console.log(`NO SUCH FILE       ${m.name}`); bad += 1; continue; }
  const keep = keepOf(m.file);
  copyFileSync(target, keep);
  let src = readFileSync(keep, 'utf8');
  let unique = true;
  for (const e of m.edits) {
    const at = src.indexOf(e.anchor);
    if (at < 0 || src.indexOf(e.anchor, at + 1) >= 0) { unique = false; break; }
    src = src.slice(0, at) + e.replacement + src.slice(at + e.anchor.length);
  }
  if (!unique) { rmSync(keep); console.log(`ANCHOR NOT UNIQUE  ${m.name}`); bad += 1; continue; }
  writeFileSync(target, src);
  const red = vitest(m.test, m.filter);
  copyFileSync(keep, target);
  rmSync(keep);
  if (red.signal !== null) { console.log(`INTERRUPTED (${red.signal})  ${m.name}`); process.exit(130); }
  const failed = /Tests\s+(\d+) failed/.exec(red.stdout)?.[1] ?? '?';
  if (red.status === 0) { console.log(`STAYED GREEN       ${m.name}`); bad += 1; } else console.log(`red (${failed} failed)   ${m.name}`);
  const green = vitest(m.test, m.filter);
  if (green.signal !== null) { console.log(`INTERRUPTED (${green.signal})  ${m.name}`); process.exit(130); }
  if (green.status !== 0) { console.log(`RED AFTER RESTORE  ${m.name}`); bad += 1; } else console.log(`green              ${m.name}`);
}
console.log(bad === 0 ? 'every guard measured red, then green' : `${bad} guard(s) not measured`);
process.exit(bad === 0 ? 0 : 1);
EOF_RUNNER
```

- [ ] **Step 2: Write the failing tests.**

(a) In `server/test/history-lib.test.ts`, inside B2 Task 7's describe `RecoverCursor: the recovery step cursor grammar (spec 9.14; B4 adds export phases)`, make four in-place edits (§9.14: the cursor gains its export phases):
  - replace `  it('RECOVER_PHASES is index, apply, reindex, frozen', () => {` with `  it('RECOVER_PHASES is index, apply, export-blobs, export-rows, reindex, frozen', () => {`;
  - replace `    expect([...libReplay.RECOVER_PHASES]).toEqual(['index', 'apply', 'reindex']);` with `    expect([...libReplay.RECOVER_PHASES]).toEqual(['index', 'apply', 'export-blobs', 'export-rows', 'reindex']);`;
  - in the must-be-null list, replace `'reindex:-1', 'export-blobs', ''` with `'reindex:-1', 'export-segments', ''`;
  - in the throw case, replace `formatRecoverCursor({ phase: 'export-blobs', file: null,` with `formatRecoverCursor({ phase: 'export-segments', file: null,`.

(b) Append to the END of `server/test/history-lib.test.ts`:

```ts
// ===========================================================================
// W1-B4 Task 3: the recovery step's export phases, their cursor, and the
// segment replay verdict (spec §9.14 "Recovery", "Export replay"; O44's pure
// half). Pure, on lib.mjs alone.
// ===========================================================================
import * as libReplayExport from '../../ccd/history/lib.mjs';

describe('W1-B4: the export phases\' cursor and the segment replay verdict (spec 9.14; O44 pure half)', () => {
  const STORE = '0189abcd-1234-4678-9abc-0000000000e1';
  it('the export phases sit between apply and reindex, in that order', () => {
    const p = [...libReplayExport.RECOVER_PHASES];
    expect(p.indexOf('export-blobs')).toBe(p.indexOf('apply') + 1);
    expect(p.indexOf('export-rows')).toBe(p.indexOf('export-blobs') + 1);
    expect(p.indexOf('reindex')).toBe(p.indexOf('export-rows') + 1);
  });
  it('round-trips an export phase at its start, inside a segment, and with +pairs', () => {
    for (const s of ['export-blobs', 'export-blobs:7.0a1b2c3d.db:0', 'export-rows:12.0a1b2c3d.db:4096+pairs', 'export-rows+pairs', 'export-blobs+pairs']) {
      const c = libReplayExport.parseRecoverCursor(s);
      expect(c, s).not.toBeNull();
      expect(libReplayExport.formatRecoverCursor(c!), s).toBe(s);
    }
    expect(libReplayExport.parseRecoverCursor('export-rows:12.0a1b2c3d.db:4096+pairs'))
      .toEqual({ phase: 'export-rows', file: '12.0a1b2c3d.db', offset: 4096, blobId: null, pairsAdded: true });
  });
  it('an export phase names a segment, never a journal file; a journal phase never names a segment; anything else is null', () => {
    for (const s of ['export-rows:2026-10.0a1b2c3d.jsonl:1', 'export-blobs:01.0a1b2c3d.db:1', 'export-rows:notes.db:1',
      'export-blobs:7.0a1b2c3d.db:01', 'export-blobs:7.0a1b2c3d.db', 'export-rows:7.0a1b2c3d.db:9999999999999999',
      'index:7.0a1b2c3d.db:0', 'apply:7.0a1b2c3d.db:0', 'reindex:7.0a1b2c3d.db', 'export-segments', 'export-blobs:.7.0a1b2c3d.db.tmp:0']) {
      expect(libReplayExport.parseRecoverCursor(s), s).toBeNull();
    }
  });
  it('decideSegmentReplay: another store\'s segment is foreign whatever its format; this store\'s newer format is newer; format 1 replays', () => {
    const other = '0189abcd-1234-4678-9abc-0000000000e9';
    expect(libReplayExport.decideSegmentReplay({ meta: { storeId: STORE, format: 1 }, storeId: STORE })).toBe('replay');
    expect(libReplayExport.decideSegmentReplay({ meta: { storeId: STORE, format: 2 }, storeId: STORE })).toBe('newer');
    expect(libReplayExport.decideSegmentReplay({ meta: { storeId: other, format: 1 }, storeId: STORE })).toBe('foreign');
    expect(libReplayExport.decideSegmentReplay({ meta: { storeId: other, format: 2 }, storeId: STORE })).toBe('foreign');
  });
});
```

(c) Append to the END of `server/test/history-recover.test.ts`:

```ts
// ===========================================================================
// W1-B4 Task 3: the export phases in the recovery step (spec §9.14 "Recovery",
// "Export replay"). In-process on a real store, through B2's recoveryStep and
// its executors seam, with the SHIPPED export executors (placeholders until
// W1-B4 Task 10 gives them bodies) wrapped so the test sees each call. The
// import is namespaced, so this block binds no name the file already binds;
// ESM hoists it.
// ===========================================================================
import * as recExport from '../../ccd/history/lib.mjs';

describe('W1-B4: the export phases in the recovery step (spec §9.14)', () => {
  type ExportChunkAnswer = { cursor: recExport.RecoverCursor; moved: boolean; phaseDone: boolean };
  type ExportChunk = (db: DatabaseSync, run: unknown, c: recExport.RecoverCursor) => ExportChunkAnswer | Promise<ExportChunkAnswer>;
  /** An executor that records its cursor and ends the step for the pass. */
  const stopHere = (seen: string[]): ExportChunk => (_db, _run, c) => {
    seen.push(recExport.formatRecoverCursor(c));
    return { cursor: c, moved: false, phaseDone: false };
  };
  /** An executor whose phase is already done. */
  const finished: ExportChunk = (_db, _run, c) => ({ cursor: c, moved: false, phaseDone: true });
  /** The shipped executor of `phase`, recording the cursor it is called with. */
  const shipped = (phase: string, seen: string[]): ExportChunk => (db, run, c) => {
    seen.push(recExport.formatRecoverCursor(c));
    return (SW.RECOVER_EXECUTORS[phase] as ExportChunk)(db, run, c);
  };
  /** A fresh store with one recovery step registered at `cursor`, and the writer handle `body` runs on. */
  const withStep = async (cursor: string,
    body: (db: DatabaseSync, box: HistoryBox, ids: { storeId: string; writer: string }) => Promise<void>): Promise<void> => {
    const box = makeHistoryBox('ccrc-history-recover-b4-phases-');
    const ids = createStore(box.home);
    const db = openWriter(historyPaths(box.home).dbFile);
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, ?, NULL)").run(Date.now(), cursor);
      await body(db, box, ids);
    } finally {
      closeWriter(db);
    }
  };

  it('a step stored at apply+pairs walks export-blobs then export-rows, through the shipped executors, to reindex with +pairs kept', async () => {
    await withStep('apply+pairs', async (db, box, ids) => {
      const seen: string[] = [];
      const executors = {
        index: stopHere(seen), apply: finished, 'export-blobs': shipped('export-blobs', seen), 'export-rows': shipped('export-rows', seen),
        reindex: stopHere(seen),
      };
      expect(await SW.recoveryStep(db, stepCtx(box, ids), executors)).toEqual({ moved: true, done: false, held: false });
      expect(seen).toEqual(['export-blobs+pairs', 'export-rows+pairs', 'reindex+pairs']);
      expect(cursorOn(db)).toBe('reindex+pairs');
    });
  });

  it('a step stored inside an export phase resumes there: its cursor parses, and no chunk is counted failed', async () => {
    await withStep('export-rows:7.0a1b2c3d.db:12+pairs', async (db, box, ids) => {
      const seen: string[] = [];
      const executors = {
        index: stopHere(seen), apply: stopHere(seen), 'export-blobs': stopHere(seen), 'export-rows': shipped('export-rows', seen),
        reindex: stopHere(seen),
      };
      expect(await SW.recoveryStep(db, stepCtx(box, ids), executors)).toEqual({ moved: true, done: false, held: false });
      expect(seen).toEqual(['export-rows:7.0a1b2c3d.db:12+pairs', 'reindex+pairs']);
      expect(countersOn(db, 'recover_chunk_failed')).toEqual({ recover_chunk_failed: 0 });
    });
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'RecoverCursor|W1-B4: the export phases')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'W1-B4: the export phases in the recovery step')
```

Expected: the first FAILs with `Tests 4 failed | 4 passed`: B2's `RECOVER_PHASES is index, apply, export-blobs, export-rows, reindex, frozen` (`expected [ 'index', 'apply', 'reindex' ] to deeply equal [ …five… ]`), `the export phases sit between apply and reindex` (`expected -1 to be 2`), `round-trips an export phase` (`expected null not to be null`), and `decideSegmentReplay` (`TypeError: decideSegmentReplay is not a function`). The null-list cases pass already (every export token is null before the arm exists): they guard the arm's grammar from here on. The second FAILs with `Tests 2 failed`: the walk sees only `[ 'reindex+pairs' ]`, and the resumed step answers `{ moved: false, done: false, held: false }` with `recover_chunk_failed` 1, because its cursor does not parse yet.

- [ ] **Step 4: Implement the lib half.** In `ccd/history/lib.mjs`, in B2 Task 7's block:

(a) Replace

```js
export const RECOVER_PHASES = Object.freeze(['index', 'apply', 'reindex']);
```

with

```js
export const RECOVER_PHASES = Object.freeze(['index', 'apply', 'export-blobs', 'export-rows', 'reindex']);
```

(b) Directly below the line `const RECOVER_REINDEX_CURSOR_RE = /^reindex(?::(0|[1-9][0-9]{0,15}))?(\+pairs)?$/;`, insert:

```js
// W1-B4: an export phase names a segment (lib parseSegmentName's grammar, checked apart so it is spelled once) and a
// position in it: a blobs rowid in export-blobs, a row ord in export-rows (§9.14 "Recovery": "then an export phase
// and segment").
const RECOVER_EXPORT_CURSOR_RE = /^(export-blobs|export-rows)(?::([^:+]+):(0|[1-9][0-9]{0,15}))?(\+pairs)?$/;
```

(c) In `parseRecoverCursor`, directly below the reindex arm's two lines

```js
    return { phase: 'reindex', file: null, offset: 0, blobId, pairsAdded: r[2] !== undefined };
  }
```

insert (so it sits above the function's final `return null;`):

```js
  const x = RECOVER_EXPORT_CURSOR_RE.exec(s);
  if (x !== null) {
    if (x[2] !== undefined && parseSegmentName(x[2]) === null) return null;
    const offset = x[3] === undefined ? 0 : Number(x[3]);
    if (!Number.isSafeInteger(offset)) return null;
    return { phase: x[1], file: x[2] ?? null, offset, blobId: null, pairsAdded: x[4] !== undefined };
  }
```

(d) Append to the END of the file:

```js
// ===========================================================================
// Export replay's decisions (spec §9.14 "Export replay"; W1-B4 Task 3). Pure:
// the recovery step reads each segment's meta through store.mjs and passes
// what it saw; which segments replay, and in what order (lib
// orderSegmentNames), is taken here.
// ⟦D:history-recovery-replay⟧
// ===========================================================================

/** What export replay does with one segment, from the two meta facts every format keeps (store.mjs segmentMeta):
 *  - `foreign` when its store_id is not this store's, whatever its format: another store's text is skipped and
 *    counted, never applied, and never a FAIL of this store's;
 *  - `newer` when its format is past the one this build reads: refused loudly (export-segment-newer, doctor FAIL)
 *    and skipped, never read through tables it may not have;
 *  - `replay` otherwise. A build that bumps EXPORT_SEGMENT_FORMAT adds here the arm for each older format it still
 *    reads. */
export function decideSegmentReplay({ meta, storeId }) {
  if (meta.storeId !== storeId) return 'foreign';
  return meta.format > EXPORT_SEGMENT_FORMAT ? 'newer' : 'replay';
}
```

`formatRecoverCursor` needs no change: its non-reindex arm already prints `<phase>:<file>:<offset>`; confirm it with `grep -n 's += `:${c.file}:${c.offset}`' ccd/history/lib.mjs` (one line).

(e) Append to the END of `ccd/history/lib.d.mts`:

```ts

// --- W1-B4 Task 3: export replay's decisions (spec §9.14 "Export replay")
export function decideSegmentReplay(i: { meta: { storeId: string; format: number }; storeId: string }): 'replay' | 'newer' | 'foreign';
```

- [ ] **Step 5: Implement the sweep seam.** In `ccd/history/sweep.mjs`:

(a) Directly above the doc comment that begins `/** One executor per RECOVER_PHASES phase, keyed by its name.`, insert:

```js
/** export-blobs: the first pass of segment replay (§9.14 "Export replay": every segment's blobs, insert-or-ignore by
 *  sha256, before any segment's rows). W1-B4 Task 10 replaces this body; until then it answers its own phase done
 *  with the cursor it was given, so a step moves through it and keeps its +pairs. */
function recoverExportBlobsChunk(_db, _run, cursor) {
  return { cursor, moved: false, phaseDone: true };
}

/** export-rows: the second pass (every segment's rows in (seq, writer) order, filling only what the journal lacks).
 *  W1-B4 Task 10 replaces this body; until then it answers its own phase done. */
function recoverExportRowsChunk(_db, _run, cursor) {
  return { cursor, moved: false, phaseDone: true };
}
```

(b) In the `RECOVER_EXECUTORS` object literal, replace

```js
  apply: recoverApplyChunk,
  reindex: recoverReindexChunk,
```

with

```js
  apply: recoverApplyChunk,
  'export-blobs': recoverExportBlobsChunk,
  'export-rows': recoverExportRowsChunk,
  reindex: recoverReindexChunk,
```

(c) Two comment sentences, in place. In the section header's phase list, replace the line

```js
// W1-B4 inserts its export phases between apply and reindex, in RECOVER_PHASES and here (⟦D:history-b4-after-b2⟧).
```

with

```js
//   export-blobs  W1-B4, between apply and reindex: every segment's blobs, insert-or-ignore by sha256, before any
//                 segment's rows, so no row waits on a blob in a later segment (§9.14 "Export replay").
//   export-rows   W1-B4: every segment's rows in (seq, writer) order, filling only what the journal lacks
//                 (⟦D:history-b4-after-b2⟧).
```

and in `RECOVER_EXECUTORS`' doc comment replace ` *  W1-B4 adds its export phases here and to RECOVER_PHASES together; history-recover.test.ts holds the two equal. */` with ` *  W1-B4's export phases are here and in RECOVER_PHASES, in one order; history-recover.test.ts holds the two equal. */`. If B2's merged text words either sentence differently, edit the sentence that says W1-B4 inserts or adds its export phases; the code edits above are the ones the tests read.

(d) Check the file, from the repository root:

```bash
node --check ccd/history/sweep.mjs
grep -c "^function recoverExportBlobsChunk(" ccd/history/sweep.mjs     # expect 1
grep -c "^function recoverExportRowsChunk(" ccd/history/sweep.mjs      # expect 1
grep -c "'export-blobs'" ccd/history/sweep.mjs                         # expect 1: the literal; lib declares the phase
grep -n "^function recoverExport\|^if (process.argv\[1\] && import.meta.url" ccd/history/sweep.mjs
```

The last command must print both functions' line numbers before the guard's (R1: the guard stays the file's last statement). sweep.mjs declares no phase list of its own: `RECOVER_PHASES` stays lib's one O14-bound declaration.

- [ ] **Step 6: Run them and see them pass; then the blast radius.** In the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'RecoverCursor|W1-B4: the export phases')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'W1-B4: the export phases in the recovery step|RECOVER_EXECUTORS runs every')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: `Tests 8 passed`; then `Tests 3 passed` (this task's two and B2's key-order case); then every case of both files (B2's O44, O35, RB6 and reindex cases walk through the two placeholder phases, which add two cursor commits to a completing step and no pass); single-definition green (`RECOVER_PHASES` still declared once, in lib.mjs); `tsc` silent. A B2 case that pinned the exact sequence of phase cursors or transactions of a completing step goes red here: correct its expectation in place to the five-phase walk, citing §9.14 "then an export phase and segment", and record the case's name in the commit message; never weaken an assertion that is not about the phase list.

- [ ] **Step 7: Measure every guard red, then green.** From the repository root:

```bash
cat > .superpowers/sdd/history-w1-b4/scratch/mutants-task3.json <<'MUT_EOF'
[
 {
  "name": "9.14: RECOVER_PHASES without the export phases",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "RecoverCursor: the recovery step cursor grammar",
  "edits": [{ "anchor": "export const RECOVER_PHASES = Object.freeze(['index', 'apply', 'export-blobs', 'export-rows', 'reindex']);", "replacement": "export const RECOVER_PHASES = Object.freeze(['index', 'apply', 'reindex']);" }]
 },
 {
  "name": "9.14: a stored export cursor does not parse (the step would wait for ever)",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the export phases' cursor",
  "edits": [{ "anchor": "  const x = RECOVER_EXPORT_CURSOR_RE.exec(s);\n", "replacement": "  const x = null;\n" }]
 },
 {
  "name": "9.14: an export phase names a file that is not a segment",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the export phases' cursor",
  "edits": [{ "anchor": "    if (x[2] !== undefined && parseSegmentName(x[2]) === null) return null;\n", "replacement": "" }]
 },
 {
  "name": "9.14: an export offset past the safe integers",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the export phases' cursor",
  "edits": [{ "anchor": "    const offset = x[3] === undefined ? 0 : Number(x[3]);\n    if (!Number.isSafeInteger(offset)) return null;\n", "replacement": "    const offset = x[3] === undefined ? 0 : Number(x[3]);\n" }]
 },
 {
  "name": "9.14: another store's segment replayed",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the export phases' cursor",
  "edits": [{ "anchor": "  if (meta.storeId !== storeId) return 'foreign';\n", "replacement": "" }]
 },
 {
  "name": "O44: a newer format replayed through this build's tables",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the export phases' cursor",
  "edits": [{ "anchor": "  return meta.format > EXPORT_SEGMENT_FORMAT ? 'newer' : 'replay';", "replacement": "  return 'replay';" }]
 },
 {
  "name": "9.14: a foreign newer segment counted as this store's newer",
  "file": "ccd/history/lib.mjs",
  "test": "test/history-lib.test.ts",
  "filter": "W1-B4: the export phases' cursor",
  "edits": [{ "anchor": "  if (meta.storeId !== storeId) return 'foreign';\n  return meta.format > EXPORT_SEGMENT_FORMAT ? 'newer' : 'replay';", "replacement": "  if (meta.format > EXPORT_SEGMENT_FORMAT) return 'newer';\n  return meta.storeId !== storeId ? 'foreign' : 'replay';" }]
 },
 {
  "name": "9.14: RECOVER_EXECUTORS without the export phases",
  "file": "ccd/history/sweep.mjs",
  "test": "test/history-recover.test.ts",
  "filter": "W1-B4: the export phases in the recovery step",
  "edits": [{ "anchor": "  'export-blobs': recoverExportBlobsChunk,\n  'export-rows': recoverExportRowsChunk,\n", "replacement": "" }]
 }
]
MUT_EOF
(cd server && node ../.superpowers/sdd/history-w1-b4/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b4/scratch/mutants-task3.json)
```

Foreground, timeout at least 600000 ms. Expected: every row `red (N failed)` then `green`, and `every guard measured red, then green`, exit 0. Measured while drafting on B1's lib with B2's Task 7 block: each `lib.mjs` row red with 1 failed case. The `sweep.mjs` row was not measurable while drafting (B2's sweep was not on the drafting base); expected red with 2 failed (each wrapped placeholder call throws, the step counts `recover_chunk_failed`, and the walk stops at `export-blobs+pairs` or at the resumed `export-rows` cursor).

- [ ] **Step 8: Confirm the restore, and commit.** In the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts test/history-recover.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b4/scratch/keep)" && echo RESTORED
```

Only after `RESTORED`, in a separate call:

```bash
git diff --stat
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs server/test/history-lib.test.ts server/test/history-recover.test.ts
git commit -m "feat(history): the recovery step's export phases, their cursor arm, the segment replay verdict, placeholder executors (W1-B4 task 3)"
```

`git diff --stat` must list exactly those five files.

### Task 4: store.mjs: export segments: the format and its DDL, a temp written O_EXCL with mode 0600 and published by link(), the read-only open, page readers, the listing and stale temps

**Files:**
- Modify: `ccd/history/store.mjs` (B1-created; B2 appends to it). Add `orderSegmentNames`, `parseSegmentName`, `segmentName` and `segmentTempName` to its existing `from './lib.mjs'` import clause, in that clause's sorted order (B2 Task 12 added `ftsTextOf` the same way). Then append one section at the END of the file (store.mjs has no entry guard). Its `node:fs` import already holds every function the section calls (`chmodSync`, `closeSync`, `constants as FS`, `existsSync`, `fsyncSync`, `linkSync`, `lstatSync`, `openSync`, `readdirSync`, `unlinkSync`): check it on the base, and add a missing one to that clause rather than a second import. The section imports no `rmSync` (B1's store.mjs has none): it removes a name it owns through B1's own `removeEntry(path)` (by type: unlink, then rmdir of an EMPTY directory, answering `'removed' | 'absent' | 'kept-dir'`, never recursive; review 316 F22, B1's history-planted-entries-never-wedge departure), and makes its directories through B1's `mkdirDurable(dir, mode)` (every new entry fsynced up the chain; review 316 F23). Both are exports of store.mjs itself, declared in B1's `store.d.mts`, so nothing is imported for them.
- Modify: `ccd/history/store.d.mts`: append one block at the end.
- Test: `server/test/history-store.test.ts` (B1-created): append one block at the END (its imports at the block's head, namespaced, the B2 Task 9 idiom). It uses the file's B1 imports (`describe`, `it`, `expect`, `spawnSync`, `fs`, `path`, `pathToFileURL`, `DatabaseSync`, `mkTmp`, `StoreError`, and `recordDirFsyncs` from `./historyHelpers.js`, which B1's review 316 F23 cases import there).
- Scratch, gitignored: `.superpowers/sdd/history-w1-b4/scratch/mutate.mjs` and `.superpowers/sdd/history-w1-b4/scratch/mutants-task4.json`.

**Interfaces:**
- Consumes (B1 `store.mjs`, same module): `StoreError(word, message)` (its `.word`); the file-local `fsyncDir(dir)`; `removeEntry(path): 'removed' | 'absent' | 'kept-dir'` and `mkdirDurable(dir, mode?): boolean` (both exported, review 316 F22 and F23); the O_CREAT|O_EXCL 0600 temp idiom and the sidecar refusal of `createStore`; `openReader`'s read-only pragmas (`readOnly: true` plus `PRAGMA query_only = ON`); `StatementSync.setReadBigInts(true)` for the dev, ino and nanosecond columns (B1 Task 21's `ingest_files` reads).
- Consumes (Task 1, `lib.mjs`): `segmentName`, `segmentTempName`, `parseSegmentName`, `orderSegmentNames`, `EXPORT_DIR` and `EXPORT_SEGMENT_FORMAT` (tests); `UUID_RE`, `WRITER_RE` (B1).
- Produces (`store.mjs`, each declared once in `store.d.mts`):
  - `SEGMENT_DDL: readonly string[]`: `meta (k, v)`; `blobs (sha256 BLOB PRIMARY KEY, codec, raw_len, z, pruned)` with `CHECK (pruned IN (0, 1) AND (z IS NULL) = (pruned = 1))`; and the row tables `families`, `transcripts`, `epochs`, `files`, `entries`, `variants`, `boundaries`, `sidecars`, `memberships`, each `ord INTEGER PRIMARY KEY` then its columns, keyed by natural keys only. Derived from the module-private `SEGMENT_ROW_TABLES` (each row kind's table and columns, the one declaration);
  - `interface SegmentMeta { storeId; writer; seq; harnesses: readonly string[]; cutoffMs; format }` (meta keys `store_id`, `writer`, `seq`, `harnesses` as a JSON array, `cutoff_ms`, `format`);
  - `interface SegmentHandle { db: DatabaseSync | null; readonly temp: string; readonly name: string }`;
  - `interface SegmentRows` (one row shape per kind, exactly its table's columns, below), `type SegmentRowKind`, `type SegmentInserts`, `type SegmentRowRead`, `interface SegmentBlobRow`, `type SegmentInt = number | bigint`;
  - `ensureSegmentDir(exportRoot: string, storeId: string): string` (export/ and export/<store_id>/, made by `mkdirDurable` so every new directory entry is fsynced, both chmod 0700; answers the store's directory);
  - `createSegment(dir, name, meta: SegmentMeta): SegmentHandle`;
  - `segmentInserts(seg): SegmentInserts`: `blob(row)` and one insert per row kind, each taking exactly its columns and answering the `ord` it drew;
  - `publishSegment(seg, dir, name): 'linked' | 'exists'`;
  - `setSegmentSeq(temp: string, seq: number): void`;
  - `openSegment(path): DatabaseSync`; `segmentMeta(db): SegmentMeta` (throws `StoreError('segment-unreadable')`);
  - `segmentBlobsAfter(db, rowid, maxBytes): Array<SegmentBlobRow & { rowid: number }>`;
  - `segmentRowsAfter(db, ord, limit): SegmentRowRead[]` (`{ ord, kind, row }`, write order across kinds);
  - `listSegments(dir): { name; seq; writer; bytes }[]` in `(seq, writer)` order; `removeStaleSegmentTemps(dir): string[]`.
- The row shapes (`SegmentRows`), which Task 5 writes and Task 10 replays. No internal id of the store is written; a row names another by its natural key:
  - `family`: `ccrc_id`, `generation`, `project`, `first_seen_ms`;
  - `transcript`: `cc_session_uuid`, `agent_id`, `harness`, `parent_tool_use_id`, `workflow_run_id`, `agent_type`;
  - `epoch`: `ccrc_id`, `generation` (its family), `seq`, `cc_session_uuid`, `cause`, `declared_by`, `started_ms`, `cwd`, `cwd_real`, `git_branch`, `confirmed_ms`;
  - `file` (a holding file's identity, for the dead-file row): `path`, `dev`, `ino`, `cc_session_uuid`, `agent_id`, `size`, `mtime_ns`, `eof_ms`;
  - `entry`: `uuid`, `cc_session_uuid`, `agent_id`, then every named column of `entries` (`type`, `subtype`, `role`, `model`, `parent_uuid`, `ts_ms`, `request_id`, `api_block_index`, `msg_id`, `source_tool_use_id`, `tool_name`, `is_compact_summary`, `provenance`, `prov_version`, `parse_state`, `struct_rank_ns`), its structural file as `struct_path`, `struct_dev`, `struct_ino`, and its blob as `blob_sha256`;
  - `variant`: `uuid`, `blob_sha256`, `first_path`, `first_dev`, `first_ino`, `first_seen_ms`, `cause`;
  - `boundary`: `uuid` (its entry), `cc_session_uuid`, `agent_id`, `boundary_ord` (the store's `boundaries.ord`), `trigger`, `head_uuid`, `anchor_uuid`, `tail_uuid`, `kept_sha256`, `pre_tokens`, `post_tokens`, `duration_ms`;
  - `sidecar`: `cc_session_uuid`, `agent_id`, `name`, `blob_sha256`, `uuid` (its entry, or null), `first_seen_ms`;
  - `membership`: `path`, `dev`, `ino`, `uuid`, `line`.
- Later consumers: Task 5 (`ensureSegmentDir`, `createSegment`, `segmentInserts`, `publishSegment`, `listSegments`), Task 6 (`removeStaleSegmentTemps`, in `exportStep` before its preflight), Task 7 (`publishSegment`'s `exists`, `setSegmentSeq`), Task 9 (`listSegments` for status, which never opens a segment), Task 10 (`openSegment`, `segmentMeta`, `segmentBlobsAfter`, `segmentRowsAfter`, `listSegments`), Task 10's `plantSegment` test helper (builds through `createSegment` and `publishSegment`, so a planted segment and a real one share one DDL).

**Spec:** §9.15 "Write" (the temp `.<seq>.<writer>.db.tmp`, fsync, `link()` to `<seq>.<writer>.db`, which fails if the name exists, then unlink the temp and fsync the directory; never published by rename, never rewritten; meta `store_id`, writer, seq, harnesses, cutoff, format 1; the blobs as stored, `sha256`, `codec`, `raw_len`, `z`; no internal id), "Who reads it" (the recovery step only, through a read-only open), §9.4's `history-export` row, §9.6 (segment files 0600, every history directory 0700), §9.10 "Export segment" rows, §6.4 (store.mjs owns the segments). Pins: **O39**'s store half (link never rename, with a rename CONTROL; EEXIST; a kill at the link leaves only the temp; no SQLite sidecar beside a published segment), the modes under umask 0002 (the O8 shape), the format literal, and the read-only open. Departures: ⟦D:history-sole-copy-export⟧, B1's D-4226 (`history-journal-writer-token`) (the writer token in every segment name, so two writers never collide).

Choices this task makes (each copied into the PR body by Task 12 Step 9):
- **One write order across row kinds.** Every row table shares `ord`, drawn from one counter, so replay walks a segment with one cursor `(segment, ord)` and meets each row after the rows it names: Task 5 writes family, transcript, epoch and file before an entry, and an entry before its variants, boundary, sidecars and memberships.
- **A stub blob** (`pruned` 1, `z` NULL) is the shape Task 2's `stubs` travel in; the CHECK refuses a mix.
- **Meta is stable across formats.** Every later format keeps the six meta keys with their meaning, so `segmentMeta` reads a newer segment's meta and lib's `decideSegmentReplay` refuses it by name; a format bump changes tables, never meta. The test's format literal is keyed by `EXPORT_SEGMENT_FORMAT`, so a DDL change without a bump, or a bump without its literal, is red.
- **`ensureSegmentDir`** is the one directory maker the segment I/O needs: export/ and export/<store_id>/ are made by B1's `mkdirDurable` (review 316 F23: each directory that gained an entry is fsynced, so after a power loss a published segment's directory, and the `export/` entry naming it, are still there; the marks a segment carries are committed only after its link), and `chmod`ed 0700 on every call, as `createStore` does the root, so a hand-made 0755 directory is brought to the mode doctor checks. The store id must match `UUID_RE`, so no path is formed from anything else.
- **Every removal is by type, through B1's `removeEntry`** (review 316 F22): a stale temp, its sidecar or a failed build's temp is unlinked, an empty directory at its name is rmdir'd, and a non-empty directory planted there is kept, not listed and never recursed into. `fs.rmSync(path, { force: true })` without `recursive` throws on a directory, so a same-user directory planted at `.<seq>.<writer>.db.tmp` would make the stale-temp removal, which runs before the preflight on every tick whose cadence runs (Task 6), throw on every pass: the export would wedge loudly for good.
- **`publishSegment` checks the name against the temp's own meta** (re-read on a handle of its own), so a renumbered temp is published under its new number only, and a name and its meta never disagree.
- **Every insert takes exactly its columns**: a missing or an unknown key throws `TypeError`, so a misspelt column in Task 5 never writes NULL.
- The build runs with `journal_mode = OFF` and `synchronous = OFF`, then one fsync before the link: the temp is discarded whole on any failure, so nothing in it needs a journal. Task 5 may wrap its inserts in `BEGIN`/`COMMIT` on `seg.db` for speed; it adds no durability.
- `listSegments` lists regular files only (a link named like a segment is not one), and an absent directory is `[]` while any other listing failure throws (B1's `removeStaleTemps` rule: a listing it could not make is loud, never "nothing stale").

- [ ] **Step 1: Write the mutation runner.** It is a gitignored scratch tool (`.superpowers/` is in `.gitignore`), never committed: B2's runner with its scratch path moved to this plan's directory. Tasks 1–4 write this same file, byte for byte, so each task stands alone and rewriting it changes nothing. A mutant is `{name, file, test, filter, edits: [{anchor, replacement}]}`, and each anchor must occur exactly once in the file as the earlier edits leave it. For each mutant the runner copies the pristine file to `.superpowers/sdd/history-w1-b4/scratch/keep/`, applies the edits and runs the named tests, which must fail; it then restores the file from the copy, removes the copy, and runs the same tests again, which must pass. Only a kill no handler sees leaves a copy in `scratch/keep/`; the next run then refuses, and the runner's header gives the one-line restore. From the repository root:

```bash
mkdir -p .superpowers/sdd/history-w1-b4/scratch/keep
cat > .superpowers/sdd/history-w1-b4/scratch/mutate.mjs <<'EOF_RUNNER'
// .superpowers/sdd/history-w1-b4/scratch/mutate.mjs: measures each guard RED with it mutated, then GREEN with
// it restored (the B4 plan's mutation-pin rule). Run from server/, in the foreground, with a timeout of at least
// 600000 ms:
//   node ../.superpowers/sdd/history-w1-b4/scratch/mutate.mjs <mutants.json>
// A mutant is {name, file, test, filter, edits: [{anchor, replacement}]}. `file` is repo-relative, `test` is
// server/-relative, and each anchor must occur exactly once in the file as the earlier edits leave it. The
// pristine file is copied to scratch/keep/<file with '/' as '__'>.orig BEFORE it is touched, and the copy is
// removed only after the file is restored from it. A kill no handler sees therefore leaves the original findable,
// and the next run REFUSES while any copy is left. To restore by hand, from the repository root:
//   for f in .superpowers/sdd/history-w1-b4/scratch/keep/*.orig; do t="$(basename "$f" .orig)"; cp "$f" "${t//__//}" && rm "$f"; done
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const KEEP = '../.superpowers/sdd/history-w1-b4/scratch/keep';
mkdirSync(KEEP, { recursive: true });
const left = readdirSync(KEEP).filter((n) => n.endsWith('.orig'));
if (left.length > 0) {
  console.log(`REFUSED: ${left.join(', ')} in ${KEEP}. An earlier run was interrupted and a source may hold a mutant: restore as this file's header says.`);
  process.exit(1);
}
const keepOf = (file) => `${KEEP}/${file.replaceAll('/', '__')}.orig`;
const restoreAll = () => {
  for (const n of readdirSync(KEEP)) {
    if (!n.endsWith('.orig')) continue;
    copyFileSync(`${KEEP}/${n}`, `../${n.slice(0, -'.orig'.length).replaceAll('__', '/')}`);
    rmSync(`${KEEP}/${n}`);
  }
};
// Every way out restores: the loop's end, process.exit and an uncaught throw all emit 'exit', and a signal is
// turned into an exit. A signal sent while the synchronous loop holds the thread is handled after the current
// child returns; a Ctrl-C also reaches the vitest child, and the loop stops on the child's signal below.
process.on('exit', restoreAll);
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => process.exit(130));
const vitest = (test, filter) => spawnSync('./node_modules/.bin/vitest', ['run', test, '-t', filter], { encoding: 'utf8' });
const mutants = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let bad = 0;
for (const m of mutants) {
  const target = `../${m.file}`;
  if (!existsSync(target)) { console.log(`NO SUCH FILE       ${m.name}`); bad += 1; continue; }
  const keep = keepOf(m.file);
  copyFileSync(target, keep);
  let src = readFileSync(keep, 'utf8');
  let unique = true;
  for (const e of m.edits) {
    const at = src.indexOf(e.anchor);
    if (at < 0 || src.indexOf(e.anchor, at + 1) >= 0) { unique = false; break; }
    src = src.slice(0, at) + e.replacement + src.slice(at + e.anchor.length);
  }
  if (!unique) { rmSync(keep); console.log(`ANCHOR NOT UNIQUE  ${m.name}`); bad += 1; continue; }
  writeFileSync(target, src);
  const red = vitest(m.test, m.filter);
  copyFileSync(keep, target);
  rmSync(keep);
  if (red.signal !== null) { console.log(`INTERRUPTED (${red.signal})  ${m.name}`); process.exit(130); }
  const failed = /Tests\s+(\d+) failed/.exec(red.stdout)?.[1] ?? '?';
  if (red.status === 0) { console.log(`STAYED GREEN       ${m.name}`); bad += 1; } else console.log(`red (${failed} failed)   ${m.name}`);
  const green = vitest(m.test, m.filter);
  if (green.signal !== null) { console.log(`INTERRUPTED (${green.signal})  ${m.name}`); process.exit(130); }
  if (green.status !== 0) { console.log(`RED AFTER RESTORE  ${m.name}`); bad += 1; } else console.log(`green              ${m.name}`);
}
console.log(bad === 0 ? 'every guard measured red, then green' : `${bad} guard(s) not measured`);
process.exit(bad === 0 ? 0 : 1);
EOF_RUNNER
```

- [ ] **Step 2: Write the failing tests.** Append to the END of `server/test/history-store.test.ts`:

```ts
// ===========================================================================
// W1-B4 Task 4: export segments (spec 2026-10-05 §9.15 "Write", "Who reads
// it"; §9.14 "Export replay"; O39's store half). In-process on real files in
// mkTmp directories, and in a child that the fault preload kills or that runs
// under umask 0002. The imports are namespaced, so this block binds no name the
// file already binds; ESM hoists them.
// ===========================================================================
import * as segStore from '../../ccd/history/store.mjs';
import * as segLib from '../../ccd/history/lib.mjs';

describe('store.mjs: export segments (W1-B4; spec 9.15 "Write", "Who reads it"; O39 store half)', () => {
  const SEG_STORE_MJS = path.resolve(__dirname, '../../ccd/history/store.mjs');
  const SEG_FAULTS = path.resolve(__dirname, 'fixtures/history/preload-faults.mjs');
  const SID = '0189abcd-1234-4678-9abc-0000000000f1';
  const W = '0a1b2c3d';
  const G = '0189abcd-1234-4678-9abc-0000000000f2';
  const U1 = '0189abcd-1234-4678-9abc-0000000000a1';
  const E1 = '0189abcd-1234-4678-9abc-0000000000b1';
  const E2 = '0189abcd-1234-4678-9abc-0000000000b2';
  const PATH = '/home/u/.claude-a/projects/-home-u-tree-demo/0189abcd-1234-4678-9abc-0000000000a1.jsonl';
  const DEV = 2049n;
  const INO = 2n ** 60n + 7n;                        // past 2^53: kept exact only as a BigInt
  const NS = 1_764_000_000_123_456_789n;
  const segMode = (p: string): number => fs.statSync(p).mode & 0o777;
  const segWord = (fn: () => unknown): string => {
    try { fn(); } catch (e) { return e instanceof StoreError ? e.word : `not a StoreError: ${String(e)}`; }
    return 'no throw';
  };
  const sha = (n: number): Uint8Array => new Uint8Array(32).fill(n);
  const meta = (seq: number, o: Partial<segStore.SegmentMeta> = {}): segStore.SegmentMeta =>
    ({ storeId: SID, writer: W, seq, harnesses: ['claude-code'], cutoffMs: 1_764_000_000_000, format: segLib.EXPORT_SEGMENT_FORMAT, ...o });
  const freshDir = (): string => segStore.ensureSegmentDir(path.join(mkTmp('ccrc-history-seg-'), segLib.EXPORT_DIR), SID);
  const nameOf = (seq: number): string => segLib.segmentName({ seq, writer: W });
  const entryRow = (uuid: string, blob: Uint8Array): segStore.SegmentRows['entry'] => ({
    uuid, cc_session_uuid: U1, agent_id: '', type: 'user', subtype: null, role: 'user', model: null, parent_uuid: null,
    ts_ms: 1_000_010, request_id: null, api_block_index: null, msg_id: null, source_tool_use_id: null, tool_name: null,
    is_compact_summary: 0, provenance: 'operator', prov_version: 1, parse_state: 'ok', struct_rank_ns: NS, struct_path: PATH,
    struct_dev: DEV, struct_ino: INO, blob_sha256: blob,
  });
  /** One row of every kind, in write order, plus a carried blob and a stub. */
  const fillAll = (ins: segStore.SegmentInserts): number[] => {
    ins.blob({ sha256: sha(1), codec: 'br5', raw_len: 11, z: new Uint8Array([1, 2, 3]), pruned: false });
    ins.blob({ sha256: sha(2), codec: 'br5', raw_len: 40, z: null, pruned: true });
    return [
      ins.family({ ccrc_id: 'claude-a-demo', generation: G, project: 'demo', first_seen_ms: 1_000_000 }),
      ins.transcript({ cc_session_uuid: U1, agent_id: '', harness: 'claude-code', parent_tool_use_id: null, workflow_run_id: null, agent_type: null }),
      ins.epoch({ ccrc_id: 'claude-a-demo', generation: G, seq: 1, cc_session_uuid: U1, cause: 'startup', declared_by: 'hook',
        started_ms: 1_000_000, cwd: '/home/u/tree/demo', cwd_real: '/home/u/tree/demo', git_branch: 'main', confirmed_ms: 1_000_001 }),
      ins.file({ path: PATH, dev: DEV, ino: INO, cc_session_uuid: U1, agent_id: '', size: 512, mtime_ns: NS, eof_ms: 1_000_500 }),
      ins.entry(entryRow(E1, sha(1))),
      ins.variant({ uuid: E1, blob_sha256: sha(2), first_path: PATH, first_dev: DEV, first_ino: INO, first_seen_ms: 1_000_020, cause: 'unknown' }),
      ins.boundary({ uuid: E1, cc_session_uuid: U1, agent_id: '', boundary_ord: 1, trigger: 'manual', head_uuid: null, anchor_uuid: null,
        tail_uuid: null, kept_sha256: null, pre_tokens: 100, post_tokens: 10, duration_ms: 5 }),
      ins.sidecar({ cc_session_uuid: U1, agent_id: '', name: 'tool-results/x.txt', blob_sha256: sha(1), uuid: E1, first_seen_ms: 1_000_030 }),
      ins.membership({ path: PATH, dev: DEV, ino: INO, uuid: E1, line: 3 }),
    ];
  };
  /** A segment built and published in `dir` by this process. */
  const publishOne = (dir: string, seq: number, o: Partial<segStore.SegmentMeta> = {}): string => {
    const name = nameOf(seq);
    const seg = segStore.createSegment(dir, name, meta(seq, o));
    fillAll(segStore.segmentInserts(seg));
    expect(segStore.publishSegment(seg, dir, name)).toBe('linked');
    return path.join(dir, name);
  };
  /** The same build and publish in a child node: under the fault preload with HISTORY_TEST_KILL when `kill` is
   *  given, and under `umask` through /bin/sh. The `timeout` bounds a hang, ending it with SIGTERM so it is never
   *  read as the preload's SIGKILL. */
  const childPublish = (root: string, seq: number, o: { kill?: string; umask?: string } = {}): ReturnType<typeof spawnSync> => {
    const script = [
      `import { ensureSegmentDir, createSegment, segmentInserts, publishSegment } from ${JSON.stringify(pathToFileURL(SEG_STORE_MJS).href)};`,
      'const [root, sid, writer, seq] = process.argv.slice(1);',
      'const dir = ensureSegmentDir(root, sid);',
      'const name = `${seq}.${writer}.db`;',
      "const seg = createSegment(dir, name, { storeId: sid, writer, seq: Number(seq), harnesses: ['claude-code'], cutoffMs: 0, format: 1 });",
      "segmentInserts(seg).blob({ sha256: new Uint8Array(32).fill(7), codec: 'br5', raw_len: 3, z: new Uint8Array([1, 2, 3]), pruned: false });",
      'process.stdout.write(publishSegment(seg, dir, name));',
    ].join('\n');
    const node = [process.execPath, '--no-warnings', ...(o.kill ? ['--import', pathToFileURL(SEG_FAULTS).href] : []), '--input-type=module', '-e', script, root, SID, W, String(seq)];
    const env: Record<string, string> = { PATH: process.env['PATH'] ?? '', HOME: path.dirname(root), ...(o.kill ? { HISTORY_TEST_KILL: o.kill } : {}) };
    return o.umask
      ? spawnSync('/bin/sh', ['-c', `umask ${o.umask}; exec "$@"`, 'sh', ...node], { encoding: 'utf8', env, timeout: 60_000, killSignal: 'SIGTERM' })
      : spawnSync(node[0]!, node.slice(1), { encoding: 'utf8', env, timeout: 60_000, killSignal: 'SIGTERM' });
  };

  it('O39: built in a dot-temp, published by link, and read back whole: meta, a blob and a stub, every row kind in write order, BigInts exact', () => {
    const dir = freshDir();
    const name = nameOf(1);
    const seg = segStore.createSegment(dir, name, meta(1));
    expect(fillAll(segStore.segmentInserts(seg))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(fs.readdirSync(dir)).toEqual([segLib.segmentTempName(name)]);
    expect(segStore.publishSegment(seg, dir, name)).toBe('linked');
    expect(seg.db).toBeNull();
    expect(fs.readdirSync(dir), 'the temp is gone and no -journal, -wal or -shm is left beside the segment').toEqual([name]);
    expect(segStore.listSegments(dir)).toEqual([{ name, seq: 1, writer: W, bytes: fs.statSync(path.join(dir, name)).size }]);
    const db = segStore.openSegment(path.join(dir, name));
    try {
      expect(segStore.segmentMeta(db)).toEqual(meta(1));
      const blobs = segStore.segmentBlobsAfter(db, 0, 1 << 20);
      expect(blobs.map((b) => [b.rowid, b.raw_len, b.pruned, b.z === null ? null : [...b.z]])).toEqual([[1, 11, false, [1, 2, 3]], [2, 40, true, null]]);
      expect([...blobs[0]!.sha256]).toEqual([...sha(1)]);
      const rows = segStore.segmentRowsAfter(db, 0, 100);
      expect(rows.map((r) => [r.ord, r.kind])).toEqual([[1, 'family'], [2, 'transcript'], [3, 'epoch'], [4, 'file'], [5, 'entry'],
        [6, 'variant'], [7, 'boundary'], [8, 'sidecar'], [9, 'membership']]);
      const file = rows[3]!.row as segStore.SegmentRows['file'];
      expect([file.dev, file.ino, file.mtime_ns]).toEqual([DEV, INO, NS]);
      expect(typeof file.size).toBe('number');
      expect(typeof file.eof_ms).toBe('number');
      const entry = rows[4]!.row as segStore.SegmentRows['entry'];
      expect([entry.struct_rank_ns, entry.struct_ino, entry.ts_ms, entry.is_compact_summary]).toEqual([NS, INO, 1_000_010, 0]);
      expect([...entry.blob_sha256]).toEqual([...sha(1)]);
      expect(rows[8]!.row).toEqual({ path: PATH, dev: DEV, ino: INO, uuid: E1, line: 3 });
    } finally {
      db.close();
    }
  });

  it('pages: rows after an ord come back in write order across kinds, and a blob page stops before its bound but always takes one', () => {
    const dir = freshDir();
    const name = nameOf(1);
    const seg = segStore.createSegment(dir, name, meta(1));
    const ins = segStore.segmentInserts(seg);
    for (const n of [1, 2, 3]) ins.blob({ sha256: sha(n), codec: 'br5', raw_len: 10, z: new Uint8Array(10).fill(n), pruned: false });
    ins.entry(entryRow(E1, sha(1)));                                        // ord 1
    ins.membership({ path: PATH, dev: DEV, ino: INO, uuid: E1, line: 1 }); // ord 2
    ins.entry(entryRow(E2, sha(2)));                                        // ord 3
    ins.membership({ path: PATH, dev: DEV, ino: INO, uuid: E2, line: 2 }); // ord 4
    expect(segStore.publishSegment(seg, dir, name)).toBe('linked');
    const db = segStore.openSegment(path.join(dir, name));
    try {
      expect(segStore.segmentRowsAfter(db, 0, 10).map((r) => [r.ord, r.kind])).toEqual([[1, 'entry'], [2, 'membership'], [3, 'entry'], [4, 'membership']]);
      expect(segStore.segmentRowsAfter(db, 1, 2).map((r) => r.ord)).toEqual([2, 3]);
      expect(segStore.segmentRowsAfter(db, 4, 10)).toEqual([]);
      expect(segStore.segmentBlobsAfter(db, 0, 25).map((b) => b.rowid)).toEqual([1, 2]);
      expect(segStore.segmentBlobsAfter(db, 2, 25).map((b) => b.rowid)).toEqual([3]);
      expect(segStore.segmentBlobsAfter(db, 0, 1).map((b) => b.rowid), 'the first blob whatever its size').toEqual([1]);
    } finally {
      db.close();
    }
  });

  it('O39: an existing name answers exists and stays byte-identical; the temp, renumbered, publishes under the next number; a name off its meta is refused', () => {
    const dir = freshDir();
    const name = nameOf(1);
    fs.writeFileSync(path.join(dir, name), 'another writer\'s segment', { mode: 0o600 });
    const seg = segStore.createSegment(dir, name, meta(1));
    fillAll(segStore.segmentInserts(seg));
    expect(segStore.publishSegment(seg, dir, name)).toBe('exists');
    expect(fs.readFileSync(path.join(dir, name), 'utf8')).toBe('another writer\'s segment');
    expect(fs.existsSync(seg.temp), 'the temp is kept for the retry').toBe(true);
    expect(() => segStore.publishSegment(seg, dir, nameOf(2)), 'its meta still says seq 1').toThrow(TypeError);
    segStore.setSegmentSeq(seg.temp, 2);
    expect(segStore.publishSegment(seg, dir, nameOf(2))).toBe('linked');
    expect(fs.readdirSync(dir).sort()).toEqual([name, nameOf(2)].sort());
    const db = segStore.openSegment(path.join(dir, nameOf(2)));
    try { expect(segStore.segmentMeta(db).seq).toBe(2); } finally { db.close(); }
  });

  it('O39: a kill at the link leaves only the temp, and removeStaleSegmentTemps removes it with its sidecars and nothing else', () => {
    const root = path.join(mkTmp('ccrc-history-seg-kill-'), segLib.EXPORT_DIR);
    const r = childPublish(root, 1, { kill: `linkSync:${nameOf(1)}:1` });
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    const dir = path.join(root, SID);
    const temp = segLib.segmentTempName(nameOf(1));
    expect(fs.readdirSync(dir)).toEqual([temp]);
    for (const stray of [`${temp}-journal`, '.notes.tmp', 'notes.txt']) fs.writeFileSync(path.join(dir, stray), '');
    expect(segStore.removeStaleSegmentTemps(dir)).toEqual([temp, `${temp}-journal`]);
    expect(fs.readdirSync(dir).sort()).toEqual(['.notes.tmp', 'notes.txt']);
    expect(segStore.removeStaleSegmentTemps(path.join(root, 'absent'))).toEqual([]);
    expect(segStore.listSegments(path.join(root, 'absent'))).toEqual([]);
  });

  it('F22: a non-empty directory planted at a temp\'s name is kept and not listed, and the stale-temp removal never throws on it; an empty one is removed', () => {
    const dir = freshDir();
    const planted = path.join(dir, segLib.segmentTempName(nameOf(7)));
    fs.mkdirSync(planted);
    fs.writeFileSync(path.join(planted, 'not-ours.txt'), 'a same-user process put this here');
    const empty = path.join(dir, segLib.segmentTempName(nameOf(8)));
    fs.mkdirSync(empty);
    const stale = segLib.segmentTempName(nameOf(9));
    fs.writeFileSync(path.join(dir, stale), '');
    let removed: string[] = [];
    expect(() => { removed = segStore.removeStaleSegmentTemps(dir); }, 'a planted directory never wedges the pass').not.toThrow();
    expect(removed, 'the kept directory is not listed').toEqual([segLib.segmentTempName(nameOf(8)), stale]);
    expect(fs.readdirSync(planted), 'never recursed into').toEqual(['not-ours.txt']);
    expect(fs.existsSync(empty)).toBe(false);
    expect(segStore.removeStaleSegmentTemps(dir), 'the next pass meets it again and still does not throw').toEqual([]);
  });

  it('F23: ensureSegmentDir fsyncs every directory that gained an entry, up to and including export/, and nothing on a second call', () => {
    const base = mkTmp('ccrc-history-seg-durable-');
    const exportRoot = path.join(base, segLib.EXPORT_DIR);
    const first = recordDirFsyncs(() => segStore.ensureSegmentDir(exportRoot, SID));
    expect(first.out).toBe(path.join(exportRoot, SID));
    expect(first.dirs, 'the history root gained export/, and export/ gained <store_id>/').toEqual([base, exportRoot]);
    expect(recordDirFsyncs(() => segStore.ensureSegmentDir(exportRoot, SID)).dirs).toEqual([]);
  });

  it('modes: under an inherited umask 0002 the segment is 0600 and export/ and export/<store_id>/ are 0700; a hand-made export/ at 0755 is brought to 0700', () => {
    const root = path.join(mkTmp('ccrc-history-seg-umask-'), segLib.EXPORT_DIR);
    const r = childPublish(root, 1, { umask: '0002' });
    expect(r.status, String(r.stderr)).toBe(0);
    expect(r.stdout).toBe('linked');
    expect(segMode(root)).toBe(0o700);
    expect(segMode(path.join(root, SID))).toBe(0o700);
    expect(segMode(path.join(root, SID, nameOf(1)))).toBe(0o600);
    const hand = path.join(mkTmp('ccrc-history-seg-hand-'), segLib.EXPORT_DIR);
    fs.mkdirSync(path.join(hand, SID), { recursive: true });
    fs.chmodSync(hand, 0o755);
    fs.chmodSync(path.join(hand, SID), 0o755);
    expect(segStore.ensureSegmentDir(hand, SID)).toBe(path.join(hand, SID));
    expect([segMode(hand), segMode(path.join(hand, SID))]).toEqual([0o700, 0o700]);
    expect(() => segStore.ensureSegmentDir(hand, '../elsewhere')).toThrow(TypeError);
  });

  it('format guard: a built segment\'s schema is EXPORT_SEGMENT_FORMAT\'s literal; a blob row is bytes or a stub, never a mix', () => {
    const FORMATS: Record<number, Record<string, string[]>> = {
      1: {
        meta: ['k TEXT pk', 'v TEXT nn'],
        blobs: ['sha256 BLOB pk', 'codec TEXT nn', 'raw_len INTEGER nn', 'z BLOB', 'pruned INTEGER nn'],
        families: ['ord INTEGER pk', 'ccrc_id TEXT nn', 'generation TEXT nn', 'project TEXT nn',
          'first_seen_ms INTEGER nn'],
        transcripts: ['ord INTEGER pk', 'cc_session_uuid TEXT nn', 'agent_id TEXT nn', 'harness TEXT nn',
          'parent_tool_use_id TEXT', 'workflow_run_id TEXT', 'agent_type TEXT'],
        epochs: ['ord INTEGER pk', 'ccrc_id TEXT nn', 'generation TEXT nn', 'seq INTEGER nn',
          'cc_session_uuid TEXT nn', 'cause TEXT nn', 'declared_by TEXT nn', 'started_ms INTEGER', 'cwd TEXT',
          'cwd_real TEXT', 'git_branch TEXT', 'confirmed_ms INTEGER'],
        files: ['ord INTEGER pk', 'path TEXT nn', 'dev INTEGER nn', 'ino INTEGER nn', 'cc_session_uuid TEXT nn',
          'agent_id TEXT nn', 'size INTEGER', 'mtime_ns INTEGER', 'eof_ms INTEGER'],
        entries: ['ord INTEGER pk', 'uuid TEXT nn', 'cc_session_uuid TEXT nn', 'agent_id TEXT nn', 'type TEXT nn',
          'subtype TEXT', 'role TEXT', 'model TEXT', 'parent_uuid TEXT', 'ts_ms INTEGER', 'request_id TEXT',
          'api_block_index INTEGER', 'msg_id TEXT', 'source_tool_use_id TEXT', 'tool_name TEXT',
          'is_compact_summary INTEGER nn', 'provenance TEXT nn', 'prov_version INTEGER nn', 'parse_state TEXT nn',
          'struct_rank_ns INTEGER nn', 'struct_path TEXT nn', 'struct_dev INTEGER nn', 'struct_ino INTEGER nn',
          'blob_sha256 BLOB nn'],
        variants: ['ord INTEGER pk', 'uuid TEXT nn', 'blob_sha256 BLOB nn', 'first_path TEXT nn',
          'first_dev INTEGER nn', 'first_ino INTEGER nn', 'first_seen_ms INTEGER nn', 'cause TEXT nn'],
        boundaries: ['ord INTEGER pk', 'uuid TEXT nn', 'cc_session_uuid TEXT nn', 'agent_id TEXT nn',
          'boundary_ord INTEGER nn', 'trigger TEXT', 'head_uuid TEXT', 'anchor_uuid TEXT', 'tail_uuid TEXT',
          'kept_sha256 BLOB', 'pre_tokens INTEGER', 'post_tokens INTEGER', 'duration_ms INTEGER'],
        sidecars: ['ord INTEGER pk', 'cc_session_uuid TEXT nn', 'agent_id TEXT nn', 'name TEXT nn',
          'blob_sha256 BLOB nn', 'uuid TEXT', 'first_seen_ms INTEGER nn'],
        memberships: ['ord INTEGER pk', 'path TEXT nn', 'dev INTEGER nn', 'ino INTEGER nn', 'uuid TEXT nn',
          'line INTEGER nn'],
      },
    };
    const dir = freshDir();
    const p = publishOne(dir, 1);
    const db = segStore.openSegment(p);
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid").all().map((t) => String(t['name']));
      const schema = Object.fromEntries(tables.map((t) => [t, db.prepare('SELECT name, type, "notnull" AS nn, pk FROM pragma_table_info(?) ORDER BY cid').all(t)
        .map((c) => `${String(c['name'])} ${String(c['type'])}${Number(c['nn']) ? ' nn' : ''}${Number(c['pk']) ? ' pk' : ''}`)]));
      expect(schema, 'the segment DDL changed: bump EXPORT_SEGMENT_FORMAT and add its literal here').toEqual(FORMATS[segLib.EXPORT_SEGMENT_FORMAT]);
    } finally {
      db.close();
    }
    const seg = segStore.createSegment(dir, nameOf(2), meta(2));
    const ins = segStore.segmentInserts(seg);
    expect(() => ins.blob({ sha256: sha(5), codec: 'br5', raw_len: 1, z: null, pruned: false })).toThrow();
    expect(() => ins.blob({ sha256: sha(6), codec: 'br5', raw_len: 1, z: new Uint8Array([1]), pruned: true })).toThrow();
    seg.db!.close();
  });

  it('openSegment is read-only, and refuses a link, a directory, an empty file and a file that is not a segment', () => {
    const dir = freshDir();
    const p = publishOne(dir, 1);
    const db = segStore.openSegment(p);
    try {
      expect(() => db.exec("INSERT INTO meta (k, v) VALUES ('x', 'y')")).toThrow();
      expect(() => db.exec('CREATE TEMP TABLE t (a)'), 'query_only refuses what readOnly lets through').toThrow();
    } finally {
      db.close();
    }
    const link = path.join(dir, nameOf(2));
    fs.symlinkSync(p, link);
    fs.mkdirSync(path.join(dir, nameOf(3)));
    fs.writeFileSync(path.join(dir, nameOf(4)), '');
    fs.writeFileSync(path.join(dir, nameOf(5)), 'not a database at all, but long enough to be read as one');
    expect(segWord(() => segStore.openSegment(link))).toBe('segment-unreadable');
    expect(segWord(() => segStore.openSegment(path.join(dir, nameOf(3))))).toBe('segment-unreadable');
    expect(segWord(() => segStore.openSegment(path.join(dir, nameOf(4))))).toBe('segment-unreadable');
    expect(segWord(() => segStore.openSegment(path.join(dir, 'absent.db')))).toBe('segment-unreadable');
    expect(segWord(() => {
      const junk = segStore.openSegment(path.join(dir, nameOf(5)));
      try { return segStore.segmentMeta(junk); } finally { junk.close(); }
    })).toBe('segment-unreadable');
    expect(segStore.listSegments(dir).map((s) => s.name), 'a link, a directory and a stray are not segments').toEqual([nameOf(1), nameOf(4), nameOf(5)]);
  });

  it('segmentMeta reads a newer format\'s meta by the same six keys, and a key off its grammar is segment-unreadable', () => {
    const dir = freshDir();
    const p2 = publishOne(dir, 2, { format: 2 });
    const db2 = segStore.openSegment(p2);
    try { expect(segStore.segmentMeta(db2)).toEqual(meta(2, { format: 2 })); } finally { db2.close(); }
    const p1 = publishOne(dir, 1);
    const w = new DatabaseSync(p1);
    w.exec("UPDATE meta SET v = 'NOT-HEX!' WHERE k = 'writer'");
    w.close();
    const db1 = segStore.openSegment(p1);
    try { expect(segWord(() => segStore.segmentMeta(db1))).toBe('segment-unreadable'); } finally { db1.close(); }
    expect(segStore.listSegments(dir).map((s) => s.name), '(seq, writer) order').toEqual([nameOf(1), nameOf(2)]);
    publishOne(dir, 10);
    expect(segStore.listSegments(dir).map((s) => s.seq), 'seq numerically, never 10 before 2').toEqual([1, 2, 10]);
  });

  it('every insert takes exactly its columns: a missing or an unknown one throws and writes nothing; createSegment refuses a name off its meta, a bad meta and a temp that exists', () => {
    const dir = freshDir();
    const seg = segStore.createSegment(dir, nameOf(1), meta(1));
    const ins = segStore.segmentInserts(seg);
    const t = { cc_session_uuid: U1, agent_id: '', harness: 'claude-code', parent_tool_use_id: null, workflow_run_id: null, agent_type: null };
    const { parent_tool_use_id: _gone, ...missing } = t;
    expect(() => ins.transcript(missing as segStore.SegmentRows['transcript'])).toThrow(/missing column parent_tool_use_id/);
    expect(() => ins.transcript({ ...t, bogus: 1 } as segStore.SegmentRows['transcript'])).toThrow(/unknown column\(s\) bogus/);
    expect(() => ins.blob({ sha256: sha(1), codec: 'br5', raw_len: 1, z: null, pruned: 1 as unknown as boolean })).toThrow(TypeError);
    expect(ins.transcript(t), 'the counter did not move').toBe(1);
    seg.db!.close();
    expect(() => segStore.createSegment(dir, nameOf(2), meta(3))).toThrow(TypeError);
    expect(() => segStore.createSegment(dir, nameOf(4), meta(4, { writer: 'NOTHEX00' }))).toThrow(TypeError);
    fs.writeFileSync(path.join(dir, segLib.segmentTempName(nameOf(5))), '');
    expect(() => segStore.createSegment(dir, nameOf(5), meta(5))).toThrow(/EEXIST/);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts -t 'export segments')
```

Expected: FAIL, `Tests 11 failed`. Nine fail `TypeError: ensureSegmentDir is not a function` (the F22 case through `freshDir`, the F23 case directly), and the two child cases (the kill and the umask) fail on the child's `SyntaxError: The requested module '…/ccd/history/store.mjs' does not provide an export named 'createSegment'` (the kill case reads `expected null to be 'SIGKILL'`, the umask case `expected 1 to be +0`).

- [ ] **Step 4: Implement.** In `ccd/history/store.mjs`, add the four names `orderSegmentNames`, `parseSegmentName`, `segmentName` and `segmentTempName` to the existing `from './lib.mjs'` import clause, in its sorted order, keeping every name already there (B1 has `CONTROL_FILE_MAX`, which its `readBindingFile` and `readAttempts` read; B2 added `ftsTextOf`). B1's clause is a single line; with the four names, and before B2's addition, it reads:

```js
import { BUSY_TIMEOUT_MS, CONTROL_FILE_MAX, MAX_INTERRUPTED_ATTEMPTS, SCHEMA_VERSION, UUID_RE, WRITER_RE, historyPaths, newSha256, orderSegmentNames, parseSegmentName, segmentName, segmentTempName } from './lib.mjs';
```

Never copy that line over the base's clause: add the four names to the clause as the base has it. Then append to the END of the file:

```js
// ── export segments (spec §9.15 "Write", "Who reads it"; §9.14 "Export replay"; §6.4: store.mjs owns them; W1-B4) ──
//
// A segment is an immutable SQLite file, export/<store_id>/<seq>.<writer>.db on the home filesystem. It is BUILT in
// a dot-temp beside its name (lib segmentTempName), O_CREAT|O_EXCL 0600, with no rollback journal and no fsync per
// statement: a crash leaves only the temp, which the next pass removes, so nothing in it needs a journal. It is
// PUBLISHED by link(), which fails on a name that exists, and never by rename, which would silently replace one;
// then the temp is unlinked and the directory fsynced. Nothing ever writes a published segment again. It is READ
// only by the recovery step, through openSegment's read-only handle; the CLI never opens one.
//
// THE FORMAT (EXPORT_SEGMENT_FORMAT, lib): `meta`, `blobs` keyed by sha256, and one typed table per row kind. Every
// row table shares ONE write-order column, `ord`, drawn from one counter, so replay walks all of them with one cursor
// (segment, ord) and meets each row after the rows it names, as the writer put them. No internal id of the store
// (entry_id, blob_id, transcript_pk, file_id, session_pk) is written: rows name each other by natural keys only — a
// blob by its sha256, an entry by its uuid, a transcript by (cc_session_uuid, agent_id), a file by (path, dev, ino),
// a family by (ccrc_id, generation). Every later format keeps meta's six keys with their meaning, so a build reads
// any segment's meta and can refuse a newer format by name (lib decideSegmentReplay); a format bump changes tables,
// never meta. history-store.test.ts holds the built schema equal to its format-1 literal.
// ⟦D:history-sole-copy-export⟧ D-4226

/** Each row kind's table and columns, in order, after the shared `ord INTEGER PRIMARY KEY`. The one declaration
 *  of the format's rows: SEGMENT_DDL and segmentInserts are derived from it. */
const SEGMENT_ROW_TABLES = Object.freeze({
  family: Object.freeze({ table: 'families', cols: Object.freeze([
    ['ccrc_id', 'TEXT NOT NULL'], ['generation', 'TEXT NOT NULL'], ['project', 'TEXT NOT NULL'], ['first_seen_ms', 'INTEGER NOT NULL'],
  ]) }),
  transcript: Object.freeze({ table: 'transcripts', cols: Object.freeze([
    ['cc_session_uuid', 'TEXT NOT NULL'], ['agent_id', 'TEXT NOT NULL'], ['harness', 'TEXT NOT NULL'],
    ['parent_tool_use_id', 'TEXT'], ['workflow_run_id', 'TEXT'], ['agent_type', 'TEXT'],
  ]) }),
  epoch: Object.freeze({ table: 'epochs', cols: Object.freeze([
    ['ccrc_id', 'TEXT NOT NULL'], ['generation', 'TEXT NOT NULL'], ['seq', 'INTEGER NOT NULL'], ['cc_session_uuid', 'TEXT NOT NULL'],
    ['cause', 'TEXT NOT NULL'], ['declared_by', 'TEXT NOT NULL'], ['started_ms', 'INTEGER'], ['cwd', 'TEXT'], ['cwd_real', 'TEXT'],
    ['git_branch', 'TEXT'], ['confirmed_ms', 'INTEGER'],
  ]) }),
  file: Object.freeze({ table: 'files', cols: Object.freeze([
    ['path', 'TEXT NOT NULL'], ['dev', 'INTEGER NOT NULL'], ['ino', 'INTEGER NOT NULL'], ['cc_session_uuid', 'TEXT NOT NULL'],
    ['agent_id', 'TEXT NOT NULL'], ['size', 'INTEGER'], ['mtime_ns', 'INTEGER'], ['eof_ms', 'INTEGER'],
  ]) }),
  entry: Object.freeze({ table: 'entries', cols: Object.freeze([
    ['uuid', 'TEXT NOT NULL'], ['cc_session_uuid', 'TEXT NOT NULL'], ['agent_id', 'TEXT NOT NULL'], ['type', 'TEXT NOT NULL'],
    ['subtype', 'TEXT'], ['role', 'TEXT'], ['model', 'TEXT'], ['parent_uuid', 'TEXT'], ['ts_ms', 'INTEGER'], ['request_id', 'TEXT'],
    ['api_block_index', 'INTEGER'], ['msg_id', 'TEXT'], ['source_tool_use_id', 'TEXT'], ['tool_name', 'TEXT'],
    ['is_compact_summary', 'INTEGER NOT NULL'], ['provenance', 'TEXT NOT NULL'], ['prov_version', 'INTEGER NOT NULL'],
    ['parse_state', 'TEXT NOT NULL'], ['struct_rank_ns', 'INTEGER NOT NULL'], ['struct_path', 'TEXT NOT NULL'],
    ['struct_dev', 'INTEGER NOT NULL'], ['struct_ino', 'INTEGER NOT NULL'], ['blob_sha256', 'BLOB NOT NULL'],
  ]) }),
  variant: Object.freeze({ table: 'variants', cols: Object.freeze([
    ['uuid', 'TEXT NOT NULL'], ['blob_sha256', 'BLOB NOT NULL'], ['first_path', 'TEXT NOT NULL'], ['first_dev', 'INTEGER NOT NULL'],
    ['first_ino', 'INTEGER NOT NULL'], ['first_seen_ms', 'INTEGER NOT NULL'], ['cause', 'TEXT NOT NULL'],
  ]) }),
  boundary: Object.freeze({ table: 'boundaries', cols: Object.freeze([
    ['uuid', 'TEXT NOT NULL'], ['cc_session_uuid', 'TEXT NOT NULL'], ['agent_id', 'TEXT NOT NULL'], ['boundary_ord', 'INTEGER NOT NULL'],
    ['trigger', 'TEXT'], ['head_uuid', 'TEXT'], ['anchor_uuid', 'TEXT'], ['tail_uuid', 'TEXT'], ['kept_sha256', 'BLOB'],
    ['pre_tokens', 'INTEGER'], ['post_tokens', 'INTEGER'], ['duration_ms', 'INTEGER'],
  ]) }),
  sidecar: Object.freeze({ table: 'sidecars', cols: Object.freeze([
    ['cc_session_uuid', 'TEXT NOT NULL'], ['agent_id', 'TEXT NOT NULL'], ['name', 'TEXT NOT NULL'], ['blob_sha256', 'BLOB NOT NULL'],
    ['uuid', 'TEXT'], ['first_seen_ms', 'INTEGER NOT NULL'],
  ]) }),
  membership: Object.freeze({ table: 'memberships', cols: Object.freeze([
    ['path', 'TEXT NOT NULL'], ['dev', 'INTEGER NOT NULL'], ['ino', 'INTEGER NOT NULL'], ['uuid', 'TEXT NOT NULL'], ['line', 'INTEGER NOT NULL'],
  ]) }),
});

/** The columns a reader gets back as BigInt (statSync's `bigint: true` values, as the store keeps them): a dev, an
 *  ino or a nanosecond time can pass 2^53. Every other integer comes back a number. */
const SEGMENT_BIGINT_COLS = Object.freeze(new Set(['dev', 'ino', 'mtime_ns', 'struct_rank_ns', 'struct_dev', 'struct_ino', 'first_dev', 'first_ino']));

const SEGMENT_BLOB_COLS = Object.freeze(['sha256', 'codec', 'raw_len', 'z', 'pruned']);

/** The format-1 schema, in creation order. A blob row is carried bytes (`pruned` 0, `z` set) or a stub of a pruned
 *  blob (`pruned` 1, `z` NULL), never a mix. */
export const SEGMENT_DDL = Object.freeze([
  'CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE blobs (sha256 BLOB PRIMARY KEY, codec TEXT NOT NULL, raw_len INTEGER NOT NULL, z BLOB, pruned INTEGER NOT NULL, CHECK (pruned IN (0, 1) AND (z IS NULL) = (pruned = 1)))',
  ...Object.values(SEGMENT_ROW_TABLES).map(({ table, cols }) => `CREATE TABLE ${table} (ord INTEGER PRIMARY KEY, ${cols.map(([c, t]) => `${c} ${t}`).join(', ')})`),
]);

/** A row object with exactly `cols` as keys, bound in that order. A missing or an extra key is a caller's bug and
 *  throws: a misspelt column must never write NULL where a value was meant. */
function segmentBind(what, cols, row) {
  const keys = Object.keys(row);
  for (const c of cols) if (!Object.hasOwn(row, c)) throw new TypeError(`segment ${what}: missing column ${c}`);
  if (keys.length !== cols.length) throw new TypeError(`segment ${what}: unknown column(s) ${keys.filter((k) => !cols.includes(k)).join(', ')}`);
  return cols.map((c) => row[c]);
}

/** The segment's meta as the writer gives it, checked: every key, by the grammar segmentMeta reads it back with. */
function checkSegmentMeta(meta) {
  const ok = UUID_RE.test(String(meta.storeId)) && WRITER_RE.test(String(meta.writer))
    && Number.isSafeInteger(meta.seq) && meta.seq > 0 && Number.isSafeInteger(meta.format) && meta.format > 0
    && Number.isSafeInteger(meta.cutoffMs) && meta.cutoffMs >= 0
    && Array.isArray(meta.harnesses) && meta.harnesses.every((h) => typeof h === 'string' && h !== '');
  if (!ok) throw new TypeError(`createSegment: meta is not a segment's meta: ${JSON.stringify(meta)}`);
}

/** export/ and export/<store_id>/ exist, each 0700 (§9.6), whatever the umask or a hand-made export/ left; answers
 *  the store's segment directory. `storeId` is a store id (UUID_RE), so no path is formed from anything else.
 *  F23: every new directory entry is fsynced (mkdirDurable), so a published segment's directory survives a power
 *  loss, and the marks committed after its link never name a segment the disk lost with its directory. */
export function ensureSegmentDir(exportRoot, storeId) {
  if (!UUID_RE.test(String(storeId))) throw new TypeError(`ensureSegmentDir: not a store id: ${JSON.stringify(storeId)}`);
  const dir = `${exportRoot}/${storeId}`;
  mkdirDurable(dir, 0o700);
  chmodSync(exportRoot, 0o700);
  chmodSync(dir, 0o700);
  return dir;
}

/** A new segment, built in its temp `<dir>/.<name>.tmp` (§9.15 "Write"): created O_CREAT|O_EXCL 0600, so a temp left
 *  behind is never reopened (the pass removes stale ones first, under the lock), then the format's schema and meta.
 *  journal_mode OFF and synchronous OFF: the temp is discarded whole on any failure, and published only after the
 *  one fsync publishSegment does. The name must be the one segmentName gives meta's seq and writer. */
export function createSegment(dir, name, meta) {
  checkSegmentMeta(meta);
  if (name !== segmentName({ seq: meta.seq, writer: meta.writer })) throw new TypeError(`createSegment: ${JSON.stringify(name)} is not segment ${meta.seq} of ${meta.writer}`);
  const temp = `${dir}/${segmentTempName(name)}`;
  for (const s of ['-journal', '-wal', '-shm']) {
    if (existsSync(`${temp}${s}`)) throw new Error(`${temp}${s} exists; a temp with sidecars is never opened`);
  }
  closeSync(openSync(temp, FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY, 0o600));
  let db;
  try {
    db = new DatabaseSync(temp);
    db.exec('PRAGMA journal_mode = OFF');
    db.exec('PRAGMA synchronous = OFF');
    for (const sql of SEGMENT_DDL) db.exec(sql);
    const put = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
    put.run('store_id', meta.storeId);
    put.run('writer', meta.writer);
    put.run('seq', String(meta.seq));
    put.run('harnesses', JSON.stringify(meta.harnesses));
    put.run('cutoff_ms', String(meta.cutoffMs));
    put.run('format', String(meta.format));
    return { db, temp, name };
  } catch (e) {
    try { db?.close(); } catch { /* the throw below is the signal */ }
    removeEntry(temp);   // by type (review 316 F22); the next pass's stale-temp removal takes what this leaves
    throw e;
  }
}

/** One insert per kind into an open segment, each taking an object with exactly its table's columns and answering
 *  the `ord` it drew (blobs answer nothing: they are keyed by sha256 and replayed in their own pass). The counter
 *  continues from the highest `ord` already in the segment. */
export function segmentInserts(seg) {
  const db = seg.db;
  const top = db.prepare(`SELECT max(m) AS m FROM (${Object.values(SEGMENT_ROW_TABLES).map(({ table }) => `SELECT max(ord) AS m FROM ${table}`).join(' UNION ALL ')})`).get();
  let ord = top.m === null ? 0 : Number(top.m);
  const out = {};
  const blobIns = db.prepare(`INSERT INTO blobs (${SEGMENT_BLOB_COLS.join(', ')}) VALUES (${SEGMENT_BLOB_COLS.map(() => '?').join(', ')})`);
  out.blob = (row) => {
    const v = segmentBind('blob', SEGMENT_BLOB_COLS, row);
    if (typeof v[4] !== 'boolean') throw new TypeError('segment blob: pruned must be a boolean');
    v[4] = v[4] ? 1 : 0;
    blobIns.run(...v);
  };
  for (const [kind, { table, cols }] of Object.entries(SEGMENT_ROW_TABLES)) {
    const names = cols.map(([c]) => c);
    const ins = db.prepare(`INSERT INTO ${table} (ord, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`);
    out[kind] = (row) => {
      const v = segmentBind(kind, names, row);
      ord += 1;
      ins.run(ord, ...v);
      return ord;
    };
  }
  return out;
}

/** The meta a segment file carries, read back on a handle of its own (publishSegment's name check). */
function tempMeta(temp) {
  const db = new DatabaseSync(temp, { readOnly: true });
  try { return segmentMeta(db); } finally { db.close(); }
}

/** Publish a built segment under `name` (§9.15 "Write"): close it, check the name is the one its meta's seq and
 *  writer give (a renumbered temp is published under its new number only), fsync the temp, and link() it to
 *  `<dir>/<name>`. A name that exists answers `exists` and keeps the temp, which the caller renumbers
 *  (setSegmentSeq) and publishes again; it is never replaced. On `linked` the temp is unlinked and the directory
 *  fsynced. */
export function publishSegment(seg, dir, name) {
  if (seg.db !== null) {
    seg.db.close();
    seg.db = null;
  }
  const m = tempMeta(seg.temp);
  if (name !== segmentName({ seq: m.seq, writer: m.writer })) throw new TypeError(`publishSegment: ${JSON.stringify(name)} is not segment ${m.seq} of ${m.writer}`);
  const fd = openSync(seg.temp, FS.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
  try {
    linkSync(seg.temp, `${dir}/${name}`);
  } catch (e) {
    if (e && e.code === 'EEXIST') return 'exists';
    throw e;
  }
  unlinkSync(seg.temp);
  fsyncDir(dir);
  return 'linked';
}

/** Renumber a closed temp's meta (the EEXIST retry, §9.15: "the pass then takes the next number"). */
export function setSegmentSeq(temp, seq) {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new TypeError(`setSegmentSeq: seq must be a positive safe integer, got ${String(seq)}`);
  const db = new DatabaseSync(temp);
  try {
    db.exec('PRAGMA journal_mode = OFF');
    const r = db.prepare("UPDATE meta SET v = ? WHERE k = 'seq'").run(String(seq));
    if (Number(r.changes) !== 1) throw new StoreError('segment-unreadable', `${temp} has no meta seq to renumber`);
  } finally {
    db.close();
  }
}

/** The read-only handle on a published segment (§9.15 "Who reads it": the recovery step only). A path that is not a
 *  non-empty regular file (a link, a directory, a truncated file) is refused, never followed or adopted. */
export function openSegment(path) {
  let st;
  try { st = lstatSync(path); } catch (e) {
    throw new StoreError('segment-unreadable', `${path} cannot be stat'ed: ${e && e.code ? e.code : String(e)}`);
  }
  if (!st.isFile() || st.size === 0) throw new StoreError('segment-unreadable', `${path} is not a non-empty regular file`);
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA query_only = ON');
    return db;
  } catch (e) {
    try { db?.close(); } catch { /* the refusal below is the signal */ }
    throw new StoreError('segment-unreadable', `${path} does not open as a segment: ${e && e.message ? e.message : String(e)}`);
  }
}

const SEGMENT_INT_RE = /^(0|[1-9][0-9]{0,15})$/;
const segmentInt = (v) => (typeof v === 'string' && SEGMENT_INT_RE.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null);

/** A segment's meta, every key by its grammar, or StoreError('segment-unreadable'): a file that is not a SQLite
 *  database, has no meta, or holds a key off its grammar is never half-read. Every format keeps these six keys
 *  (above), so this reads a newer format's meta too, and decideSegmentReplay refuses it by name. */
export function segmentMeta(db) {
  let rows;
  try {
    rows = db.prepare('SELECT k, v FROM meta').all();
  } catch (e) {
    throw new StoreError('segment-unreadable', `no segment meta: ${e && e.message ? e.message : String(e)}`);
  }
  const m = new Map(rows.map((r) => [String(r.k), String(r.v)]));
  let harnesses = null;
  try { harnesses = JSON.parse(m.get('harnesses') ?? 'null'); } catch { harnesses = null; }
  const out = {
    storeId: m.get('store_id') ?? '', writer: m.get('writer') ?? '', seq: segmentInt(m.get('seq')),
    harnesses, cutoffMs: segmentInt(m.get('cutoff_ms')), format: segmentInt(m.get('format')),
  };
  try {
    checkSegmentMeta(out);
  } catch {
    throw new StoreError('segment-unreadable', `segment meta is off its grammar: ${JSON.stringify([...m])}`);
  }
  return out;
}

/** The first blobs after `rowid`, in rowid order, until the next one's bytes would pass `maxBytes` (the first is
 *  always taken): one bounded chunk of the replay's blob pass. A stub (pruned) has `z` null and counts 0 bytes. */
export function segmentBlobsAfter(db, rowid, maxBytes) {
  const out = [];
  let bytes = 0;
  for (const r of db.prepare('SELECT rowid AS rowid, sha256, codec, raw_len, z, pruned FROM blobs WHERE rowid > ? ORDER BY rowid').iterate(rowid)) {
    const n = r.z === null ? 0 : r.z.length;
    if (out.length > 0 && bytes + n > maxBytes) break;
    bytes += n;
    out.push({ rowid: Number(r.rowid), sha256: r.sha256, codec: String(r.codec), raw_len: Number(r.raw_len), z: r.z, pruned: Number(r.pruned) === 1 });
  }
  return out;
}

/** The first `limit` rows of every kind after `ord`, in write order: `{ ord, kind, row }`, `row` holding the kind's
 *  columns without `ord` (SEGMENT_BIGINT_COLS as BigInt, every other integer a number). One bounded chunk of the
 *  replay's row pass. */
export function segmentRowsAfter(db, ord, limit) {
  const all = [];
  for (const [kind, { table }] of Object.entries(SEGMENT_ROW_TABLES)) {
    const st = db.prepare(`SELECT * FROM ${table} WHERE ord > ? ORDER BY ord LIMIT ?`);
    st.setReadBigInts(true);
    for (const r of st.all(ord, limit)) {
      const row = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === 'ord') continue;
        row[k] = typeof v === 'bigint' && !SEGMENT_BIGINT_COLS.has(k) ? Number(v) : v;
      }
      all.push({ ord: Number(r.ord), kind, row });
    }
  }
  all.sort((a, b) => a.ord - b.ord);
  return all.slice(0, limit);
}

/** The published segments in `dir`, as regular files whose names parse, in lib orderSegmentNames' (seq, writer)
 *  order, each with its size (status counts them by name and size, and never opens one). An absent directory is
 *  none; any other failure to list it throws, never folded into "none" (the removeStaleTemps rule). */
export function listSegments(dir) {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  const files = new Map();
  for (const e of ents) if (e.isFile() && parseSegmentName(e.name) !== null) files.set(e.name, e);
  return orderSegmentNames([...files.keys()]).map((name) => {
    const p = parseSegmentName(name);
    return { name, seq: p.seq, writer: p.writer, bytes: lstatSync(`${dir}/${name}`).size };
  });
}

/** The temps a killed pass left in `dir` (`.<segment name>.tmp`, with any SQLite sidecar), removed; answers their
 *  names. Only the pass holding the lock builds a temp, so every one found is stale. An absent directory answers
 *  []; any other listing failure throws. A name is removed BY TYPE (B1's removeEntry): a file, link or FIFO is
 *  unlinked and an empty directory rmdir'd; a non-empty directory planted at the name is kept, not listed, never
 *  recursed into, and blocks nothing, so it cannot wedge the step that runs this before its preflight every tick
 *  (review 316 F22; B1's history-planted-entries-never-wedge). */
export function removeStaleSegmentTemps(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  const removed = [];
  for (const n of names.sort()) {
    const m = /^\.(.+)\.tmp(?:-journal|-wal|-shm)?$/.exec(n);
    if (m === null || parseSegmentName(m[1]) === null) continue;
    if (removeEntry(`${dir}/${n}`) === 'removed') removed.push(n);   // a non-empty directory planted at the name is kept (review 316 F22)
  }
  return removed;
}
```

Checks, from the repository root:

```bash
node --check ccd/history/store.mjs
grep -c "^import " ccd/history/store.mjs        # unchanged from the base: no second import of a module
grep -cP '\x00' ccd/history/store.mjs           # expect 0
```

- [ ] **Step 5: Declare the types.** Append to the END of `ccd/history/store.d.mts` (its `import type { DatabaseSync } from 'node:sqlite';` line is B1's):

```ts
// --- W1-B4 Task 4: export segments (spec §9.15 "Write", "Who reads it"; §9.14 "Export replay")
/** A dev, an ino or a nanosecond time: a number on the way in, a BigInt on the way out of a reader. */
export type SegmentInt = number | bigint;
export const SEGMENT_DDL: readonly string[];
export interface SegmentMeta { storeId: string; writer: string; seq: number; harnesses: readonly string[]; cutoffMs: number; format: number }
export interface SegmentHandle { db: DatabaseSync | null; readonly temp: string; readonly name: string }
export interface SegmentBlobRow { sha256: Uint8Array; codec: string; raw_len: number; z: Uint8Array | null; pruned: boolean }
export interface SegmentRows {
  family: { ccrc_id: string; generation: string; project: string; first_seen_ms: number };
  transcript: { cc_session_uuid: string; agent_id: string; harness: string; parent_tool_use_id: string | null; workflow_run_id: string | null; agent_type: string | null };
  epoch: {
    ccrc_id: string; generation: string; seq: number; cc_session_uuid: string; cause: string; declared_by: string;
    started_ms: number | null; cwd: string | null; cwd_real: string | null; git_branch: string | null; confirmed_ms: number | null;
  };
  file: { path: string; dev: SegmentInt; ino: SegmentInt; cc_session_uuid: string; agent_id: string; size: number | null; mtime_ns: SegmentInt | null; eof_ms: number | null };
  entry: {
    uuid: string; cc_session_uuid: string; agent_id: string; type: string; subtype: string | null; role: string | null; model: string | null;
    parent_uuid: string | null; ts_ms: number | null; request_id: string | null; api_block_index: number | null; msg_id: string | null;
    source_tool_use_id: string | null; tool_name: string | null; is_compact_summary: number; provenance: string; prov_version: number;
    parse_state: string; struct_rank_ns: SegmentInt; struct_path: string; struct_dev: SegmentInt; struct_ino: SegmentInt; blob_sha256: Uint8Array;
  };
  variant: { uuid: string; blob_sha256: Uint8Array; first_path: string; first_dev: SegmentInt; first_ino: SegmentInt; first_seen_ms: number; cause: string };
  boundary: {
    uuid: string; cc_session_uuid: string; agent_id: string; boundary_ord: number; trigger: string | null; head_uuid: string | null;
    anchor_uuid: string | null; tail_uuid: string | null; kept_sha256: Uint8Array | null; pre_tokens: number | null; post_tokens: number | null;
    duration_ms: number | null;
  };
  sidecar: { cc_session_uuid: string; agent_id: string; name: string; blob_sha256: Uint8Array; uuid: string | null; first_seen_ms: number };
  membership: { path: string; dev: SegmentInt; ino: SegmentInt; uuid: string; line: number };
}
export type SegmentRowKind = keyof SegmentRows;
export type SegmentInserts = { blob(row: SegmentBlobRow): void } & { [K in SegmentRowKind]: (row: SegmentRows[K]) => number };
export type SegmentRowRead = { [K in SegmentRowKind]: { ord: number; kind: K; row: SegmentRows[K] } }[SegmentRowKind];
export function ensureSegmentDir(exportRoot: string, storeId: string): string;
export function createSegment(dir: string, name: string, meta: SegmentMeta): SegmentHandle;
export function segmentInserts(seg: SegmentHandle): SegmentInserts;
export function publishSegment(seg: SegmentHandle, dir: string, name: string): 'linked' | 'exists';
export function setSegmentSeq(temp: string, seq: number): void;
export function openSegment(path: string): DatabaseSync;
export function segmentMeta(db: DatabaseSync): SegmentMeta;
export function segmentBlobsAfter(db: DatabaseSync, rowid: number, maxBytes: number): Array<SegmentBlobRow & { rowid: number }>;
export function segmentRowsAfter(db: DatabaseSync, ord: number, limit: number): SegmentRowRead[];
export function listSegments(dir: string): { name: string; seq: number; writer: string; bytes: number }[];
export function removeStaleSegmentTemps(dir: string): string[];
```

Check that each function is declared once:

```bash
for n in ensureSegmentDir createSegment segmentInserts publishSegment setSegmentSeq openSegment segmentMeta segmentBlobsAfter segmentRowsAfter listSegments removeStaleSegmentTemps; do printf '%s %s\n' "$n" "$(grep -c "^export function $n(" ccd/history/store.d.mts)"; done
grep -c '^export const SEGMENT_DDL:' ccd/history/store.d.mts
```

Expected: every line ends ` 1`, and the last count is 1.

- [ ] **Step 6: Run them and see them pass; then the whole file, the typecheck and the ring.** In the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts -t 'export segments')
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
```

Expected: `Tests 11 passed`; then every case in the file (B1's and B2's binding, migration, lineage and backup cases unchanged); `tsc` silent; single-definition green (store.mjs stays the sole `node:sqlite` importer, no `process.env` read, no switch spelled). Measured while drafting: the first nine cases and the file's B1 cases pass on Node 24.14.1 (the F22 and F23 cases were added after B1's review 316 fix rounds and are not yet measured), and the typecheck of the file is clean; the CI node-floor leg re-runs the file on 22.16.0 (B1 Task 36 put it in that leg's list).

- [ ] **Step 7: Measure every guard red, then green.** From the repository root:

```bash
cat > .superpowers/sdd/history-w1-b4/scratch/mutants-task4.json <<'MUT_EOF'
[
 {
  "name": "O39 CONTROL: published by rename, which replaces an existing segment",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "    linkSync(seg.temp, `${dir}/${name}`);\n", "replacement": "    renameSync(seg.temp, `${dir}/${name}`);\n    fsyncDir(dir);\n    return 'linked';\n" }]
 },
 {
  "name": "O39: EEXIST drops the temp, so the retry has nothing to publish",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "    if (e && e.code === 'EEXIST') return 'exists';", "replacement": "    if (e && e.code === 'EEXIST') { removeEntry(seg.temp); return 'exists'; }" }]
 },
 {
  "name": "F23: export/ and export/<store_id>/ made by a plain mkdir, no entry fsynced",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  mkdirDurable(dir, 0o700);\n  chmodSync(exportRoot, 0o700);", "replacement": "  mkdirSync(dir, { recursive: true, mode: 0o700 });\n  chmodSync(exportRoot, 0o700);" }]
 },
 {
  "name": "F22: removeStaleSegmentTemps unlinks by name, not by type (B4's first rmSync), so a planted directory throws",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "    if (removeEntry(`${dir}/${n}`) === 'removed') removed.push(n);   // a non-empty directory planted at the name is kept (review 316 F22)", "replacement": "    unlinkSync(`${dir}/${n}`);\n    removed.push(n);" }]
 },
 {
  "name": "F22: a kept directory listed as removed",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "    if (removeEntry(`${dir}/${n}`) === 'removed') removed.push(n);   // a non-empty directory planted at the name is kept (review 316 F22)", "replacement": "    removeEntry(`${dir}/${n}`);\n    removed.push(n);" }]
 },
 {
  "name": "9.15: a segment published under a name its meta does not give",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  if (name !== segmentName({ seq: m.seq, writer: m.writer })) throw new TypeError(`publishSegment: ${JSON.stringify(name)} is not segment ${m.seq} of ${m.writer}`);\n", "replacement": "" }]
 },
 {
  "name": "9.6: the temp created with the umask's mode",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  closeSync(openSync(temp, FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY, 0o600));\n  let db;", "replacement": "  closeSync(openSync(temp, FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY, 0o666));\n  let db;" }]
 },
 {
  "name": "9.15: a temp that exists reopened",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  closeSync(openSync(temp, FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY, 0o600));\n  let db;", "replacement": "  closeSync(openSync(temp, FS.O_CREAT | FS.O_WRONLY, 0o600));\n  let db;" }]
 },
 {
  "name": "9.6: a hand-made export/ keeps its mode",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  chmodSync(exportRoot, 0o700);\n", "replacement": "" }]
 },
 {
  "name": "9.6: a hand-made export/<store_id>/ keeps its mode",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  chmodSync(exportRoot, 0o700);\n  chmodSync(dir, 0o700);\n", "replacement": "  chmodSync(exportRoot, 0o700);\n" }]
 },
 {
  "name": "9.15: a segment directory formed from an unchecked store id",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  if (!UUID_RE.test(String(storeId))) throw new TypeError(`ensureSegmentDir: not a store id: ${JSON.stringify(storeId)}`);\n", "replacement": "" }]
 },
 {
  "name": "9.15: a segment built under a name its meta does not give",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  if (name !== segmentName({ seq: meta.seq, writer: meta.writer })) throw new TypeError(`createSegment: ${JSON.stringify(name)} is not segment ${meta.seq} of ${meta.writer}`);\n", "replacement": "" }]
 },
 {
  "name": "9.15: a misspelt or missing column writes NULL",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  for (const c of cols) if (!Object.hasOwn(row, c)) throw new TypeError(`segment ${what}: missing column ${c}`);\n", "replacement": "" }]
 },
 {
  "name": "9.15: an unknown column ignored",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  if (keys.length !== cols.length) throw new TypeError(`segment ${what}: unknown column(s) ${keys.filter((k) => !cols.includes(k)).join(', ')}`);\n", "replacement": "" }]
 },
 {
  "name": "9.15 Who reads it: a link or a directory opened as a segment",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  if (!st.isFile() || st.size === 0) throw new StoreError('segment-unreadable', `${path} is not a non-empty regular file`);", "replacement": "  if (st.size === 0) throw new StoreError('segment-unreadable', `${path} is not a non-empty regular file`);" }]
 },
 {
  "name": "9.15 Who reads it: the reader can create a temp table",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "    db.exec('PRAGMA query_only = ON');\n    return db;", "replacement": "    return db;" }]
 },
 {
  "name": "9.14: a segment meta read past its grammar",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  try {\n    checkSegmentMeta(out);\n  } catch {", "replacement": "  try {\n  } catch {" }]
 },
 {
  "name": "9.15: a dev or ino past 2^53 read as a lossy number",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "        row[k] = typeof v === 'bigint' && !SEGMENT_BIGINT_COLS.has(k) ? Number(v) : v;", "replacement": "        row[k] = typeof v === 'bigint' ? Number(v) : v;" }]
 },
 {
  "name": "9.14: rows of several kinds read in table order, not write order",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  all.sort((a, b) => a.ord - b.ord);\n", "replacement": "" }]
 },
 {
  "name": "9.14: a blob page refuses its first blob over the bound (replay never moves)",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "    if (out.length > 0 && bytes + n > maxBytes) break;", "replacement": "    if (bytes + n > maxBytes) break;" }]
 },
 {
  "name": "9.6: a link in the segment directory listed as a segment",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  for (const e of ents) if (e.isFile() && parseSegmentName(e.name) !== null) files.set(e.name, e);", "replacement": "  for (const e of ents) if (parseSegmentName(e.name) !== null) files.set(e.name, e);" }]
 },
 {
  "name": "9.14: segments listed by their names' lexical order",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "  return orderSegmentNames([...files.keys()]).map((name) => {", "replacement": "  return [...files.keys()].sort().map((name) => {" }]
 },
 {
  "name": "9.15: a stale-temp sweep removes a dot-file that is not a segment's temp",
  "file": "ccd/history/store.mjs",
  "test": "test/history-store.test.ts",
  "filter": "export segments",
  "edits": [{ "anchor": "    if (m === null || parseSegmentName(m[1]) === null) continue;", "replacement": "    if (m === null) continue;" }]
 }
]
MUT_EOF
(cd server && node ../.superpowers/sdd/history-w1-b4/scratch/mutate.mjs ../.superpowers/sdd/history-w1-b4/scratch/mutants-task4.json)
```

Foreground, timeout at least 600000 ms. Expected: every row `red (N failed)` then `green`, and `every guard measured red, then green`, exit 0. Measured while drafting: every row red with 1 failed case, except the rename CONTROL (2: the EEXIST case, whose planted segment it replaces, and the kill case, whose killed `linkSync` is never called). The three rows added after B1's review 316 fix rounds are predicted, not measured: `F23: … a plain mkdir` reds the F23 case (`expected [] to deeply equal [ <base>, <base>/export ]`); `F22: … unlinks by name` reds the F22 case (`EISDIR`, or `EPERM` on macOS, thrown where no throw was expected); `F22: a kept directory listed as removed` reds it on the returned list.

- [ ] **Step 8: Confirm the restore, and commit.** In the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts) && test -z "$(ls -A .superpowers/sdd/history-w1-b4/scratch/keep)" && echo RESTORED
```

Only after `RESTORED`, in a separate call:

```bash
git diff --stat
git add ccd/history/store.mjs ccd/history/store.d.mts server/test/history-store.test.ts
git commit -m "feat(history): export segments: one write order, a 0600 temp published by link, the read-only open, pages, the listing and stale temps (W1-B4 task 4)"
```

`git diff --stat` must list exactly those three files.
### Task 5: sweep: exportPass: select due rows, write one segment through store.mjs, publish it, then mark (in-process)

**Files:**
- Modify: `ccd/history/sweep.mjs` (B1-created; B2 and possibly B3 extend it; no line of it exists at f7e51156f, so every anchor is by content).
  - Insert one block directly ABOVE the entry guard `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`, below every block B1, B2 and B3 put there (R1). The guard stays the file's last statement, and nothing in the block awaits at top level.
  - Merge the names Step 6's script prints into the existing `from './lib.mjs'`, `from './store.mjs'` and `from 'node:fs'` import statements, one statement per module.
- Modify: `server/test/historyHelpers.ts` (B1-created; B2 appended to it): append one block at the end of the file. No import line changes: `fs`, `path` and `DatabaseSync` are already this file's (B1 Task 14).
- Create: `server/test/history-export.test.ts`.
- Modify: `.github/workflows/ci.yml` (job `node-floor`, step `Test`): one line in the heredoc between `cat > "$RUNNER_TEMP/tests.txt" <<'EOF'` and `EOF`, directly above the line `          test/measure-history.test.ts` (B2 Task 25's anchor). At f7e51156f that heredoc holds only `          test/node-floor.test.ts`; B1 and B2 added the history files.

**Interfaces:**
- Consumes:
  - Task 1 (`lib.mjs`): `EXPORT_DIR` (`'export'`), `EXPORT_SEGMENT_MAX_BYTES` (`256 * 1024 * 1024`), `EXPORT_SEGMENT_FORMAT` (`1`), `segmentName({ seq, writer }): string`, `nextSegmentSeq({ onDisk: readonly number[]; recorded: number | null }): number`, `HEALTH_META.exportPassMs` (`'export_pass_ms'`).
  - Task 2 (`lib.mjs`): `planSegment({ nowMs, homeRetentionDays, rows, boundBytes, reducer?, takenBefore? }): SegmentPlan`, its default reducer B2's `EXPORT_REDUCERS.perCopy`, the census's (this task passes none: RD1's one clock), where a row is a `SegmentCandidate { key; tsMs: number | null; files: { home: string | null; mtimeMs: number; present: boolean }[]; blobs: { key; zBytes: number; exported: boolean; pruned: boolean }[] }` and the answer is `{ take: string[]; carry: string[]; stubs: string[]; bytes: number; leftDue: number; oldestLeftDueSinceMs: number | null }`, `bytes` counting each taken row's new blob bytes plus `EXPORT_ROW_META_BYTES` (`1536`, also Task 2's).
  - Task 4 (`store.mjs`):
    - `ensureSegmentDir(exportRoot, storeId): string` (export/ and export/<store_id>/, each chmod 0700; a store id off `UUID_RE` throws), the one directory maker, which `ensureExportDirs` wraps;
    - `createSegment(dir, name, meta: SegmentMeta): SegmentHandle`, with `SegmentMeta = { storeId, writer, seq, harnesses: string[], cutoffMs, format }` and `SegmentHandle = { db, temp, name }`;
    - `segmentInserts(seg)`, whose ten members each take ONE object keyed by that segment table's column names (no `ord`: each member assigns the next one). This task passes exactly these keys, and they are the segment's column names, which the tests read back by name:
      - `blob({ sha256, codec, raw_len, z, pruned })`, `pruned` a boolean (Task 4's insert refuses anything else; it stores 0 or 1), `z` null and `pruned` true for a stub;
      - `family({ ccrc_id, generation, project, first_seen_ms })`;
      - `transcript({ cc_session_uuid, agent_id, harness, parent_tool_use_id, workflow_run_id, agent_type })`;
      - `epoch({ ccrc_id, generation, seq, cc_session_uuid, cause, declared_by, started_ms, cwd, cwd_real, git_branch, confirmed_ms })`;
      - `file({ path, dev, ino, cc_session_uuid, agent_id, size, mtime_ns, eof_ms })` (Task 4's `files` table carries no `birth_ns`: a dead-file row never needs it, and an extra key throws);
      - `entry({ uuid, cc_session_uuid, agent_id, type, subtype, role, model, parent_uuid, ts_ms, request_id, api_block_index, msg_id, source_tool_use_id, tool_name, is_compact_summary, provenance, prov_version, parse_state, struct_rank_ns, struct_path, struct_dev, struct_ino, blob_sha256 })`;
      - `variant({ uuid, blob_sha256, first_path, first_dev, first_ino, first_seen_ms, cause })`;
      - `boundary({ uuid, cc_session_uuid, agent_id, boundary_ord, trigger, head_uuid, anchor_uuid, tail_uuid, kept_sha256, pre_tokens, post_tokens, duration_ms })`. The boundary's own per-transcript ordinal (`boundaries.ord` in the store) is the column `boundary_ord`, because `ord` is every segment row table's shared write-order key (Task 4's DDL; a second `ord` column is `duplicate column name: ord`, measured on a prototype);
      - `sidecar({ cc_session_uuid, agent_id, name, blob_sha256, uuid, first_seen_ms })`, `uuid` null for an unlinked sidecar;
      - `membership({ path, dev, ino, uuid, line })`.
      `dev`, `ino`, `mtime_ns`, `struct_rank_ns`, `struct_dev`, `struct_ino`, `first_dev` and `first_ino` are passed as bigints (node:sqlite binds them as INTEGER); every sha256 as the store's BLOB bytes.
    - `publishSegment(seg, dir, name): 'linked' | 'exists'`;
    - `listSegments(dir): { name; seq; writer; bytes }[]` (Task 6's `exportStep`, not this task, calls `removeStaleSegmentTemps(dir)`);
    - test side: `openSegment(path): DatabaseSync`, `segmentMeta(db): SegmentMeta`.
  - B1 `lib.mjs`: `HEALTH_META`, `CLAUDE_CODE_DEFAULT_RETENTION_DAYS`, `shortestRetention(homeRetentionDays)` and `exportHorizonDays(retentionDays)` (for the `ts_ms` prefilter's cutoff and the unrostered-file mapping only; neither decides a row), `historyPaths`.
  - B2 `lib.mjs` (B2 Task 35): `dueTranscriptKeys<K>({ nowMs, homeRetentionDays, transcripts: { key: K; files: ExportFile[] }[], reducer? }): K[]`, the census's exact prefilter, its default reducer the per-copy rule; this task passes no reducer (RD1's one clock). sweep.mjs already imports it for the census.
  - B1 `store.mjs`: `withTx`, `bump`, `getMeta`, `setMeta`, `openWriter`, `closeWriter`.
  - B1 `sweep.mjs`, same file: the census's private `transcriptFiles(db, homes)` (the file clock: per transcript, its files' `{ home, mtimeMs, present }`) and its module const `DAY_MS` (B1 Task 26); `newBudget(now, limits)`, `budgetLeft(budget)`, `countOutside(db, name)`, `isBusy(e)`, `idsFromFiles(P)`.
  - B2: `store.mjs`'s `pruneDryRun(db, cutoffMs): { blobs; bytes; exported }` (Task 20) for the §6.6 supporting check; `passCtx`'s budget from `deps.budget`.
  - B1 test side: `makeHistoryBox`, `runSweep`, `skipOnDarwin`, `openStoreRO`, `counters`, `journalRecords`, `plantSession`, `plantTranscript`, `HistoryBox`; `historyFixtures`' `userRow`; `tmpHelpers`' `removeTmpFixturesEachTest`.
- Produces (`ccd/history/sweep.mjs`; it ships no `.d.mts`):
  - `export async function exportPass(db, ctx): Promise<ExportPassResult>`, where `ExportPassResult = { state: 'written' | 'nothing-due' | 'no-horizon' | 'held' | 'failed'; segment: string | null; rows: number; blobs: number; bytes: number; complete: boolean }`. `complete` is true when every due row the pass found fit in its segment; Task 8 resets the missing-segment WARN on it. Task 6 adds the state `'paused'`, which only `exportStep` answers. `ctx` is a TickCtx (`passCtx`'s names): `paths`, `ids`, `now`, `homes`, `rosterUnreadable`, `budget`, `deps`.
  - Module-private: `EXPORT_PAGE_ROWS`, `EXPORT_SEQ_META` (`'export_seq'`), `EXPORT_ATTEMPT_META` (`'export_attempt_ms'`), `EXPORT_DUE_ENTRIES_SQL`, `EXPORT_NULL_TS_ENTRIES_SQL`, `EXPORT_TRANSCRIPT_ENTRIES_SQL`, `EXPORT_UNLINKED_SQL`, `EXPORT_STMTS`/`exportStmts(db)`, `segInt(v)`, `exportHomeDays(db, homes)`, `exportDirFor(P, storeId)`, `ensureExportDirs(P, storeId)`, `exportSelect(db, ctx, nowMs, homeDays, boundBytes)`, `writeSegmentRows(db, ctx, seg, sel)`, `discardSegment(seg)`, `noteExportPassDone(db, nowMs, complete)` and `markExported(db, m)`. The name `EXPORT_CANDIDATES_SQL` is NOT used: B1 Task 26's census already declares that const in this module, and a second declaration is a SyntaxError.
  - One in-process seam: `exportSelect` pages by `ctx.deps.exportPageRows` when it is a positive safe integer, else `EXPORT_PAGE_ROWS`. Only a test passes it (the page-boundary case pages one row at a time); no env var, flag or file arms it (B1's D-4247 (`history-test-seams-not-env`), the `ctx.deps.statfs` precedent).
  - meta written: `export_seq` and `HEALTH_META.exportPassMs`, both in the mark transaction (`exportPassMs` alone on a `nothing-due` pass); `export_attempt_ms` on a failed pass.
  - Counter: `export_write_failed`.
- Produces (test side):
  - `historyHelpers.ts`: `exportDirOf(box: HistoryBox): string`, `segmentsOf(box: HistoryBox): string[]` (every name in the directory, a temp included, sorted; `[]` while it does not exist), `segmentRows(file: string, table: string): Array<Record<string, unknown>>`.
  - `history-export.test.ts`, module scope: `ID`, `G`, `U`, `SLUG`, `WORK`, `MIN`, `HOUR`, `DAY`, `GIB`, `TIB`, `rid`, `row`, `PassResult`, `SweepExport`, `SW`, `pass`, `ingestedBox`, `exportCtx`, `onStore`, `plain`, `q`, `metaOf`, `marks`, `pick`, `byUuid`. Tasks 6, 7 and 8 append to this file and use them.

**Spec:**
- §9.15 "What is due" (the row rule, ruled Q15 in rev 3.4: every holding file past its mtime plus its own home's retention, minus 30 days, a gone file passed, a row with no holding file due at once; "a due row is exported whole", memberships by `(path, dev, ino, line)`, "No internal id is written"), "The pass" (Write: one segment, at most 256 MiB, within the run budget; Mark: one transaction after the link), "Pruned blobs are never exported or counted due", "Who reads it" (nothing here reads a segment).
- §9.2 step 6 and step 7 (one run budget, never reset); §9.3 (the run byte budget); §6.6 (`prune` never touches the export; its dry run counts `exported`); §9.8 (bytes verbatim, 0600, never printed).
- Pins: **O39**'s core (one segment holding the blob's bytes, every referrer's named columns, their family, epoch and transcript rows, memberships with their file identity; marks after the link; a second pass writes nothing new; the hot blob with a young referrer). The kill, collision and variant halves of O39 are Tasks 7 and 8. **O58**'s sweep half (the pass answers by the per-copy default: a 30-day home holding only a swap copy brings nothing forward, with the node-shortest default as its CONTROL; a file gone from disk has passed).
- Departures: ⟦D:history-sole-copy-export⟧, ⟦D:history-export-row-carries-blob⟧, ⟦D:history-export-due-per-copy⟧ (B2-defined, ruled Q15: the pass decides each row through `planSegment`'s default, the census's per-copy reducer, and selects, whatever their time, the rows of every transcript that rule makes due now, through the census's own `dueTranscriptKeys`), ⟦D:history-export-pruned-row-stub⟧ (Task 2's NEW slug; this task writes the stub), ⟦D:history-export-segment-bound-estimated⟧ (Task 2's NEW slug; this task pages under it and pins the file's size), B1's D-4248 (`history-export-holding-files-by-transcript`) (reused: every candidate, an unlinked sidecar included, is due by its transcript's files through B1's `transcriptFiles`, not the row's own copies; the per-row set B1 left owed to B4 is not delivered, so the export and the census keep one clock; ruled so by coordinator ruling RD1, and kept by the operator's Q15 ruling as the per-copy rule's per-row set), B1's D-4210 (`history-retention-read-from-settings`) (the pass reads each home's retention as the census kept it, 30 only for a home never measured, and measures each holding file against its own home's), B1's D-4172 (`history-store-fixed-root`), B1's D-4247 (`history-test-seams-not-env`), and NEW ⟦D:history-export-unlinked-sidecar-with-blob⟧: schema v1 gives `sidecars` no mark column, so an unlinked sidecar row travels with its blob's bytes, and an unlinked sidecar whose blob nothing else carries is a candidate of its own (keyed by that blob), so its text is never left store-only.
- Plan choices (no departure):
  - **Selection order.** The selection only offers candidates; lib's `planSegment`, with its per-copy default and no reducer passed, decides every one (RD1's one clock). Rows with a NULL `ts_ms` come first (the `ts_ms` prefilter cannot see them; like every row, they are due by their transcript's files, B1 Task 26's transcript-level set, B1's D-4248 (`history-export-holding-files-by-transcript`)). Then, for every transcript the default rule makes due now (B2's `dueTranscriptKeys`, the census's own prefilter), its rows at or past the prefilter's cutoff, by `(ts_ms, entry_id)` through `entries_ts`: under the per-copy rule every row of one transcript falls due at one instant whatever its own time, and the prefilter would pass over the young ones. Then rows by `(ts_ms, entry_id)` through `entries_unexported` with `ts_ms` below the cutoff, then unlinked sidecars by blob id. The entry candidates the pass offers are therefore every unexported row the census can count due. A page is 256 rows; lib's `planSegment` decides every page under what is left of the bound, with `takenBefore` from the moment an earlier page took a row.
  - **The `ts_ms` prefilter's cutoff** stays `nowMs` minus the SHORTEST rostered home's horizon, B1's census cutoff. It is no longer the census's prefilter: B2 Task 35 replaced that with the exact `dueTranscriptKeys`. Alone it would hide due rows: those of a transcript with no file left on disk, a row held only by files gone from disk while an older file of its transcript stays on disk, and a row stamped later than its file's mtime. So it only bounds the old-rows phase, and the due-transcript phase above offers every younger row of a due transcript. Which transcripts that phase walks is lib's verdict (`dueTranscriptKeys` over `transcriptFiles`, the census's own call on the same file clock), and `planSegment` still decides each row, so the pass and the census answer one clock (RD1) and every due blob is selectable.
  - **The bound** is `min(EXPORT_SEGMENT_MAX_BYTES, budget.maxBytes - budget.bytes)`, counted as each taken row's new blob bytes (`length(z)`) plus `EXPORT_ROW_META_BYTES` (Task 2). The writer adds the blob bytes it reads to `ctx.budget.bytes`.
  - **One membership scan per segment.** Schema v1 has no index led by `memberships.entry_id` (B1's choice), so the taken entries' memberships come from ONE full scan per pass that writes, filtered by a set. That costs one scan an hour, not one per row.
  - **A caught failure counts toward the hourly cadence** (meta `export_attempt_ms`, read by Task 6's `exportStep`), so a pass that keeps failing with a caught error retries once an hour, never every tick, while doctor's last-pass clock (`HEALTH_META.exportPassMs`) stays on the last pass that ran to its end. A pass that is killed records nothing, so the next tick retries it, as B1's ingest retries a killed tick; Task 7 lengthens the wait after a pass that published and could not mark, and makes a busy error after the link record the published seq and the attempt clock before it is rethrown (RD3). Here a busy is rethrown with nothing recorded, B1's O22 rule.
  - **Stops stay distinct** (no adapter narrows them): `no-horizon` (no rostered home whose retention could be read: an unreadable roster or no home), `held` (history-off, or the run's budget, before a row was published), `nothing-due`, `written`, `failed`.
  - **The segment's place** (B1's D-4172 (`history-store-fixed-root`)): the pass writes under the fixed root, `~/.ccrc/history/export/<store_id>/` on the home filesystem (Task 4's `ensureSegmentDir`), never under the symlinkable `db/`, so a segment survives the loss of `db/`'s volume.

- [ ] **Step 1: Add the read-back helpers.** Append to the end of `server/test/historyHelpers.ts`:

```ts
// ── W1-B4 Task 5: the export's segments, read back ───────────────────────────────────────────────────────────────
/** The bound store's export directory: `~/.ccrc/history/export/<store.id>` (spec §9.15 "Write"). */
export function exportDirOf(box: HistoryBox): string {
  return path.join(box.root, 'export', fs.readFileSync(path.join(box.root, 'store.id'), 'utf8').trim());
}

/** Every name in that directory, a writer's temp included, sorted; [] while the directory does not exist. */
export function segmentsOf(box: HistoryBox): string[] {
  const dir = exportDirOf(box);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

/** One table of a segment file, opened read-only, in write order (rowid: the shared `ord` of a row table, insertion
 *  order for `blobs`). An integer comes back as a number when it is a safe integer and as a bigint otherwise (mtime_ns,
 *  struct_rank_ns); a BLOB comes back as lowercase hex, so a sha256 compares with the store's `lower(hex(…))`. */
export function segmentRows(file: string, table: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const st = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`);
    st.setReadBigInts(true);
    return (st.all() as Array<Record<string, unknown>>).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k,
      typeof v === 'bigint' && v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v)
        : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v])));
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Write the failing tests.** Create `server/test/history-export.test.ts`:

```ts
// server/test/history-export.test.ts — the sole-copy export (spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §9.15, §9.2 step 6), W1-B4. Two ways in:
//   - sweep.mjs's exportPass (and, from Task 6, exportStep), imported in-process against a REAL store that real
//     scheduled passes ingested, where a case needs a clock, a budget or a statfs answer of its own: injected
//     dependencies, never a variable the shipped code reads (slug history-test-seams-not-env);
//   - the real sweep as the timer runs it (runSweep, and the run-pass driver runDriver where a case needs the pass clock
//     past the store's first hour), with the test-only preloads for faults.
// Every store lives in a mkTmp fixture HOME (makeHistoryBox); nothing reads or writes the live ~/.ccrc, and each test's
// fixture HOMEs are removed when it ends (removeTmpFixturesEachTest).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  makeHistoryBox, runSweep, skipOnDarwin, openStoreRO, counters, journalRecords, plantSession, plantTranscript,
  exportDirOf, segmentsOf, segmentRows, type HistoryBox,
} from './historyHelpers.js';
import { userRow } from './historyFixtures.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { EXPORT_ROW_META_BYTES, HEALTH_META, historyPaths } from '../../ccd/history/lib.mjs';
import { closeWriter, openSegment, openWriter, pruneDryRun, segmentMeta, setMeta } from '../../ccd/history/store.mjs';

skipOnDarwin();
removeTmpFixturesEachTest();

const ID = 'claude-demo';
const G = '0189abcd-1234-4678-9abc-0123456789ab';
const U = '6f1c2e3a-0b4d-4c5e-8f60-718293a4b5c6';
const SLUG = '-home-u-tree-demo';
const WORK = '/home/u/tree/demo';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GIB = 1024 ** 3;
const TIB = 1024 ** 4;
/** A row uuid from a small number (the UUID grammar, readable in a failure). */
const rid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** One typed prompt of session U, its timestamp `agoMs` before now. */
const row = (n: number, text: string, agoMs: number): Record<string, unknown> =>
  userRow({ uuid: rid(n), ts: new Date(Date.now() - agoMs).toISOString(), text, sessionId: U, cwd: WORK });

interface PassResult { state: string; segment: string | null; rows: number; blobs: number; bytes: number; complete: boolean }
/** The slice of sweep.mjs these tests call. It grows task by task; every member is a real export. */
interface SweepExport {
  exportPass(db: DatabaseSync, ctx: Record<string, unknown>): Promise<PassResult>;
  newBudget(now?: () => number, limits?: { maxMs?: number; maxBytes?: number; chunkBytes?: number }): Record<string, unknown>;
}
let SW: SweepExport;
beforeAll(async () => { SW = (await import('../../ccd/history/sweep.mjs')) as unknown as SweepExport; });

/** One scheduled pass that must exit 0. */
const pass = (box: HistoryBox): void => {
  const r = runSweep(box);
  expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
};
/** A box whose registry names session U of `claude-demo`, its transcript planted under claude-a and ingested by
 *  `passes` scheduled passes (the first may only create the store). `plant` runs before the passes. Every pass here
 *  runs in the store's first hour, so once the tick holds the export (Task 6) none of them exports. */
function ingestedBox(prefix: string, rows: object[], o: { passes?: number; plant?: (box: HistoryBox) => void } = {}):
  { box: HistoryBox; transcript: string; ids: { storeId: string; writer: string } } {
  const box = makeHistoryBox(prefix);
  plantSession(box, ID, { uuid: U, generation: G, project: 'demo', workdir: WORK });
  const transcript = plantTranscript(box, 'claude-a', SLUG, U, rows);
  o.plant?.(box);
  for (let i = 0; i < (o.passes ?? 2); i += 1) pass(box);
  const P = historyPaths(box.home);
  return { box, transcript, ids: { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() } };
}
/** What exportPass (and exportStep) read of a TickCtx, passCtx's names, built in-process. `now` is the pass clock and
 *  the run budget's; `deps` the injected dependencies (Task 6's statfs); `limits` the run budget's. */
const exportCtx = (box: HistoryBox, ids: { storeId: string; writer: string }, now: () => number = () => Date.now(),
  o: { deps?: Record<string, unknown>; limits?: { maxMs?: number; maxBytes?: number }; homes?: string[] } = {}): Record<string, unknown> => ({
  home: box.home, paths: historyPaths(box.home), ids, now, out: () => {}, deps: o.deps ?? {},
  homes: o.homes ?? box.homes, rosterUnreadable: false,
  parsed: { secrets: [], homes: o.homes ?? box.homes, rosterUnreadable: false },
  budget: SW.newBudget(now, o.limits ?? {}),
});
/** `fn` on a writer handle of the box's store, closed when it settles. */
async function onStore<T>(box: HistoryBox, fn: (db: DatabaseSync) => T | Promise<T>): Promise<T> {
  const db = openWriter(historyPaths(box.home).dbFile);
  try { return await fn(db); } finally { closeWriter(db); }
}
/** A row with its integers as numbers when safe (bigint otherwise) and its BLOBs as lowercase hex: segmentRows' rule,
 *  so the store's rows and a segment's compare directly. */
const plain = (r: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(r).map(([k, v]) => [k,
  typeof v === 'bigint' && v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v)
    : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v]));
/** One query on the box's store, read-only. */
const q = (box: HistoryBox, sql: string, ...args: Array<string | number>): Array<Record<string, unknown>> => {
  const db = openStoreRO(box);
  try {
    const st = db.prepare(sql);
    st.setReadBigInts(true);
    return (st.all(...args) as Array<Record<string, unknown>>).map(plain);
  } finally {
    db.close();
  }
};
const metaOf = (box: HistoryBox, k: string): string | null => {
  const r = q(box, 'SELECT v FROM meta WHERE k = ?', k);
  return r.length === 0 ? null : String(r[0]!['v']);
};
/** Every entry's exported_seg (null when unmarked), by uuid. */
const marks = (box: HistoryBox): Record<string, unknown> =>
  Object.fromEntries(q(box, 'SELECT uuid, exported_seg FROM entries ORDER BY uuid').map((r) => [String(r['uuid']), r['exported_seg'] ?? null]));
const pick = (keys: readonly string[]) => (r: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, r[k]]));
const byUuid = (a: Record<string, unknown>, b: Record<string, unknown>): number => {
  const x = String(a['uuid']); const y = String(b['uuid']);
  return x < y ? -1 : x > y ? 1 : 0;
};

describe('the export pass, in-process (W1-B4 Task 5; spec §9.15 "What is due", "The pass")', () => {
  it('O39: due rows go into ONE segment with their blobs as stored, their named columns, the family, epoch and transcript rows that place them and their memberships by file identity; the marks come after the link; nothing is journaled; a second pass writes nothing new', async () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-o39-', [
      row(1, 'first prompt', 3 * DAY), row(2, 'second prompt', 2 * DAY), row(3, 'third prompt', DAY),
    ]);
    const NOW = Date.now();
    const name = `1.${ids.writer}.db`;
    const journal = journalRecords(box);
    const before = await onStore(box, (db) => pruneDryRun(db, NOW + DAY));
    expect(before, 'every row is a prune candidate and none is exported yet').toEqual({ blobs: 3, bytes: before.bytes, exported: 0 });

    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
    expect(r).toEqual({ state: 'written', segment: name, rows: 3, blobs: 3, bytes: r.bytes, complete: true });
    expect(r.bytes).toBeGreaterThan(0);
    expect(segmentsOf(box), 'one segment, under its name, and no temp left').toEqual([name]);
    const seg = path.join(exportDirOf(box), name);
    expect(fs.statSync(seg).mode & 0o777).toBe(0o600);
    const h = openSegment(seg);
    try {
      // the fixture homes carry no cleanupPeriodDays: 30 days, horizon 0, so the cutoff is the pass's clock
      expect(segmentMeta(h)).toEqual({ storeId: ids.storeId, writer: ids.writer, seq: 1, harnesses: ['claude-code'], cutoffMs: NOW, format: 1 });
    } finally {
      h.close();
    }

    // the blobs, as stored, each marked with this segment AFTER the link
    const blobs = q(box, 'SELECT sha256, codec, raw_len, z, exported_ms, exported_seg FROM blobs ORDER BY sha256');
    expect(blobs.map(pick(['exported_ms', 'exported_seg']))).toEqual(blobs.map(() => ({ exported_ms: NOW, exported_seg: name })));
    expect(segmentRows(seg, 'blobs').map(pick(['sha256', 'codec', 'raw_len', 'z', 'pruned']))
      .sort((a, b) => (String(a['sha256']) < String(b['sha256']) ? -1 : 1)))
      .toEqual(blobs.map((b) => ({ sha256: b['sha256'], codec: b['codec'], raw_len: b['raw_len'], z: b['z'], pruned: 0 })));

    // every referrer's named columns, its blob by sha256, its transcript by natural key
    const cols = ['uuid', 'type', 'subtype', 'role', 'model', 'parent_uuid', 'ts_ms', 'request_id', 'api_block_index', 'msg_id',
      'source_tool_use_id', 'tool_name', 'is_compact_summary', 'provenance', 'prov_version', 'parse_state'];
    const stored = q(box, `SELECT ${cols.map((c) => `e.${c}`).join(', ')}, lower(hex(b.sha256)) AS blob_sha256, e.exported_ms,
      e.exported_seg FROM entries e JOIN blobs b ON b.blob_id = e.blob_id ORDER BY e.uuid`);
    expect(stored.map(pick(['exported_ms', 'exported_seg']))).toEqual(stored.map(() => ({ exported_ms: NOW, exported_seg: name })));
    const segEntries = segmentRows(seg, 'entries').sort(byUuid);
    expect(segEntries.map(pick([...cols, 'blob_sha256']))).toEqual(stored.map(pick([...cols, 'blob_sha256'])));
    expect(segEntries.map(pick(['cc_session_uuid', 'agent_id']))).toEqual(stored.map(() => ({ cc_session_uuid: U, agent_id: '' })));

    // the rows that place them: the family's natural key and project, the transcript, every epoch naming it
    expect(segmentRows(seg, 'families').map(pick(['ccrc_id', 'generation', 'project']))).toEqual([{ ccrc_id: ID, generation: G, project: 'demo' }]);
    expect(segmentRows(seg, 'transcripts').map(pick(['cc_session_uuid', 'agent_id', 'harness'])))
      .toEqual([{ cc_session_uuid: U, agent_id: '', harness: 'claude-code' }]);
    expect(segmentRows(seg, 'epochs').map(pick(['ccrc_id', 'generation', 'seq', 'cc_session_uuid', 'cause', 'declared_by', 'cwd'])))
      .toEqual(q(box, `SELECT s.ccrc_id, s.generation, e.seq, e.cc_session_uuid, e.cause, e.declared_by, e.cwd
        FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk ORDER BY s.ccrc_id, s.generation, e.seq`));

    // memberships by (path, dev, ino, line): the identity the store measured, which is the file's as it stats now
    const st = fs.statSync(transcript, { bigint: true });
    const copies = q(box, `SELECT p.path, f.dev, f.ino, e.uuid, m.line FROM memberships m JOIN ingest_files f ON f.file_id = m.file_id
      JOIN file_paths p ON p.file_id = f.file_id JOIN entries e ON e.entry_id = m.entry_id ORDER BY e.uuid`);
    expect(copies.map((c) => [c['dev'], c['ino']])).toEqual(copies.map(() => [Number(st.dev), Number(st.ino)]));
    expect(segmentRows(seg, 'memberships').map(pick(['path', 'dev', 'ino', 'uuid', 'line'])).sort(byUuid)).toEqual(copies);
    expect(segmentRows(seg, 'files').map(pick(['path', 'dev', 'ino', 'cc_session_uuid', 'agent_id'])))
      .toEqual([{ path: copies[0]!['path'], dev: Number(st.dev), ino: Number(st.ino), cc_session_uuid: U, agent_id: '' }]);

    // the pass journals nothing; prune now counts what the export holds and touches none of it (§6.6)
    expect(journalRecords(box)).toEqual(journal);
    expect(await onStore(box, (db) => pruneDryRun(db, NOW + DAY))).toEqual({ ...before, exported: 3 });
    expect(metaOf(box, HEALTH_META.exportPassMs)).toBe(String(NOW));
    expect(metaOf(box, 'export_seq')).toBe('1');

    // a second pass: nothing is due that is not already exported
    const again = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW + HOUR)));
    expect(again).toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    expect(segmentsOf(box)).toEqual([name]);
    expect(metaOf(box, HEALTH_META.exportPassMs), 'a pass that finds nothing is still a pass').toBe(String(NOW + HOUR));
  }, 120_000);

  it('O39 / BK12: a hot blob with a young referrer — the due old rows are exported with the blob\'s bytes and the blob is marked; the young row waits', async () => {
    // Under the per-copy rule (⟦D:history-export-due-per-copy⟧) every row of one transcript shares its files' clock, so
    // the young referrer is a second session's row, in a transcript under claude-b, a home measured below at 180 days
    // (due 150 days after its file's last write). Session U's transcript sits under claude-a, on the 30-day default:
    // its rows are due from its file's last write, which is before this pass.
    const U2 = '7d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6';
    const { box, ids } = ingestedBox('ccrc-history-export-hot-', [
      row(1, 'the same prompt', 40 * DAY), row(2, 'an old prompt of its own', 40 * DAY),
    ], {
      plant: (b) => {
        plantSession(b, 'claude-b-demo', { uuid: U2, generation: '0189abcd-1234-4678-9abc-0123456789ac', project: 'demo', workdir: WORK });
        plantTranscript(b, 'claude-b', SLUG, U2,
          [userRow({ uuid: rid(3), ts: new Date(Date.now() - DAY).toISOString(), text: 'the same prompt', sessionId: U2, cwd: WORK })]);
      },
    });
    const shaOf = (n: number): unknown =>
      q(box, 'SELECT lower(hex(b.sha256)) AS sha FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(n))[0]?.['sha'];
    expect(shaOf(3), 'the fixture must make one blob of the two sessions\' same prompt').toBe(shaOf(1));
    const name = `1.${ids.writer}.db`;
    const r = await onStore(box, (db) => {
      setMeta(db, `retention:${box.accountHome['claude-b']!}`, '180');   // claude-b measured at 180 days: its copy waits 150 days
      return SW.exportPass(db, exportCtx(box, ids));
    });
    expect(r).toMatchObject({ state: 'written', segment: name, rows: 2, blobs: 2 });
    expect(marks(box)).toEqual({ [rid(1)]: name, [rid(2)]: name, [rid(3)]: null });
    const hot = q(box, 'SELECT lower(hex(b.sha256)) AS sha, b.exported_seg FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(3))[0]!;
    expect(hot['exported_seg'], 'the young referrer\'s blob travelled with the old row').toBe(name);
    const seg = path.join(exportDirOf(box), name);
    expect(segmentRows(seg, 'blobs').map((b) => b['sha256'])).toContain(hot['sha']);
    expect(segmentRows(seg, 'entries').map((e) => e['uuid']).sort()).toEqual([rid(1), rid(2)]);
  }, 120_000);

  it('Q15, per copy: a 30-day home that holds only a swap copy brings nothing forward, because the 180-day home\'s copy holds every row back; once that copy is gone from disk the 30-day copy alone decides, and the rows go', async () => {
    const rows = [row(1, 'one', 2 * DAY), row(2, 'two', DAY)];
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-swap-', rows, {
      // the swap copy: the same transcript under claude-b, a home that keeps Claude Code's 30-day default
      plant: (b) => { plantTranscript(b, 'claude-b', SLUG, U, rows); },
    });
    expect(q(box, 'SELECT count(*) AS n FROM ingest_files')[0]!['n'], 'the fixture must hold two copies').toBe(2);
    expect(q(box, 'SELECT count(*) AS n FROM transcripts')[0]!['n'], 'of ONE transcript').toBe(1);
    const r = await onStore(box, (db) => {
      setMeta(db, `retention:${box.accountHome['claude-a']!}`, '180');   // claude-a measured at 180 days: its copy waits 150 days
      return SW.exportPass(db, exportCtx(box, ids));
    });
    expect(r, 'the node-shortest rule would have exported both rows now').toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    expect(segmentsOf(box)).toEqual([]);
    expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null });
    fs.rmSync(transcript);   // claude-a's copy gone from disk: it has passed its due date (§9.15 "A file's due date")
    const next = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    expect(next).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 2, complete: true });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: `1.${ids.writer}.db` });
  }, 120_000);

  it('per copy: a transcript whose every holding file is gone has its rows taken whatever their own time, though the ts prefilter (the shortest home\'s horizon) would pass over them: that text may already be the store\'s only copy', async () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-gone-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const r0 = await onStore(box, (db) => {
      for (const h of box.homes) setMeta(db, `retention:${h}`, '180');   // every home at 180 days: the cutoff is 150 days back
      return SW.exportPass(db, exportCtx(box, ids));
    });
    expect(r0, 'CONTROL: while its file is on disk, nothing is due').toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    fs.rmSync(transcript);   // deleted early, days after its rows were written
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    expect(r).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 2, complete: true });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: `1.${ids.writer}.db` });
  }, 120_000);

  it('per copy: once its transcript is due, a young row held only by a file gone from disk is taken though an older file of that transcript stays on disk: the pass offers every row the census counts due', async () => {
    // Copy A (claude-a, the ingested transcript) holds both rows, written now. Copy B (claude-b) holds row 1 only,
    // last written 160 days ago. Every home keeps 180 days, so the ts prefilter's cutoff is 150 days back, and row 2,
    // 35 days old, is younger than it.
    const rows = [row(1, 'one', 200 * DAY), row(2, 'two', 35 * DAY)];
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-older-', rows, {
      plant: (b) => {
        const copyB = plantTranscript(b, 'claude-b', SLUG, U, [rows[0]!]);
        const at = new Date(Date.now() - 160 * DAY);
        fs.utimesSync(copyB, at, at);
      },
    });
    expect(q(box, 'SELECT count(*) AS n FROM ingest_files')[0]!['n'], 'the fixture must hold two copies').toBe(2);
    expect(q(box, 'SELECT count(*) AS n FROM transcripts')[0]!['n'], 'of ONE transcript').toBe(1);
    const r0 = await onStore(box, (db) => {
      for (const h of box.homes) setMeta(db, `retention:${h}`, '180');
      return SW.exportPass(db, exportCtx(box, ids));
    });
    expect(r0, 'CONTROL: copy A, written now, holds both rows back').toEqual({ state: 'nothing-due', segment: null, rows: 0, blobs: 0, bytes: 0, complete: true });
    fs.rmSync(transcript);   // copy A deleted early: copy B decides, and its 150 days passed 10 days ago
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    expect(r, 'row 2 too, though only copy A ever held it and the ts prefilter passes over it')
      .toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 2, complete: true });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: `1.${ids.writer}.db` });
  }, 120_000);

  it('a row whose blob prune tombstoned travels with a stub of that blob (sha256, codec, raw_len, no bytes); the stub is never marked exported, the row is', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-stub-', [row(1, 'kept text', 2 * DAY), row(2, 'pruned text', 2 * DAY)]);
    const NOW = Date.now();
    const name = `1.${ids.writer}.db`;
    const prunedSha = String(q(box, 'SELECT lower(hex(b.sha256)) AS sha FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(2))[0]!['sha']);
    const r = await onStore(box, (db) => {
      // B2 Task 20's tombstone, as prune --apply writes it
      db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE blob_id = (SELECT blob_id FROM entries WHERE uuid = ?)')
        .run(NOW - MIN, rid(2));
      return SW.exportPass(db, exportCtx(box, ids, () => NOW));
    });
    expect(r).toMatchObject({ state: 'written', segment: name, rows: 2, blobs: 1 });
    const segBlobs = segmentRows(path.join(exportDirOf(box), name), 'blobs');
    expect(segBlobs.find((b) => b['sha256'] === prunedSha), 'the pruned row\'s blob has no stub').toMatchObject({ z: null, pruned: 1 });
    expect(segBlobs.filter((b) => b['pruned'] === 0)).toHaveLength(1);
    expect(q(box, 'SELECT exported_ms, exported_seg FROM blobs WHERE lower(hex(sha256)) = ?', prunedSha))
      .toEqual([{ exported_ms: null, exported_seg: null }]);
    expect(marks(box)).toEqual({ [rid(1)]: name, [rid(2)]: name });
  }, 120_000);

  it('an unlinked sidecar travels with its blob, and is a candidate of its own while nothing else carries that blob', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-sidecar-', [row(1, 'a prompt', DAY)], {
      passes: 3,
      plant: (b) => {
        const dir = path.join(b.accountHome['claude-a']!, 'projects', SLUG, U, 'tool-results');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'b9x0-orphan.txt'), 'output no tool_result names');
      },
    });
    expect(q(box, 'SELECT name, entry_id FROM sidecars'), 'the fixture must leave one unlinked sidecar')
      .toEqual([{ name: 'b9x0-orphan.txt', entry_id: null }]);
    const name = `1.${ids.writer}.db`;
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    expect(r).toMatchObject({ state: 'written', segment: name, rows: 2, blobs: 2 });
    const side = q(box, 'SELECT lower(hex(b.sha256)) AS sha, b.exported_seg FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id')[0]!;
    expect(side['exported_seg']).toBe(name);
    const seg = path.join(exportDirOf(box), name);
    expect(segmentRows(seg, 'sidecars').map(pick(['cc_session_uuid', 'agent_id', 'name', 'uuid', 'blob_sha256'])))
      .toEqual([{ cc_session_uuid: U, agent_id: '', name: 'b9x0-orphan.txt', uuid: null, blob_sha256: side['sha'] }]);
    expect(segmentRows(seg, 'blobs').map((b) => b['sha256'])).toContain(side['sha']);
  }, 120_000);

  it('the bound: a segment takes at least one row even past it, stops there, and the rest go into the next pass\'s segment', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bound-', [
      row(1, 'oldest', 3 * DAY), row(2, 'middle', 2 * DAY), row(3, 'newest', DAY),
    ]);
    const NOW = Date.now();
    // a run byte budget of ONE byte: what is left of it bounds the segment, and every blob is larger
    const r1 = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW, { limits: { maxBytes: 1 } })));
    expect(r1).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 1, blobs: 1, complete: false });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: null, [rid(3)]: null });
    const r2 = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW + HOUR)));
    expect(r2).toMatchObject({ state: 'written', segment: `2.${ids.writer}.db`, rows: 2, complete: true });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: `2.${ids.writer}.db`, [rid(3)]: `2.${ids.writer}.db` });
  }, 120_000);

  it('the wall clock: when the run\'s clock runs out mid-segment, the rows already written are published and marked, and the rest wait', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-clock-', [
      row(1, 'oldest', 3 * DAY), row(2, 'middle', 2 * DAY), row(3, 'newest', DAY),
    ]);
    const NOW = Date.now();
    const dir = path.join(box.root, 'export', ids.storeId);
    // The writer reads the run's clock once before each row. Once the segment's temp exists, the clock's first read
    // answers NOW and its second answers two run budgets later: one row is written, then the clock has run out.
    let readsSinceTemp = 0;
    const clock = (): number => {
      if (fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n.endsWith('.tmp'))) readsSinceTemp += 1;
      return readsSinceTemp >= 2 ? NOW + 2 * 90_000 : NOW;
    };
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, clock)));
    expect(r).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 1, complete: false });
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`]);
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: null, [rid(3)]: null });
  }, 120_000);

  it('history-off between rows: the temp is removed, nothing is published or marked, and the next pass writes', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-off-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const dir = path.join(box.root, 'export', ids.storeId);
    const off = historyPaths(box.home).off;
    // The operator's switch appears once the segment's temp exists: the clock the writer reads before its first row
    // plants it, exactly between the temp's creation and that row.
    const clock = (): number => {
      if (!fs.existsSync(off) && fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n.endsWith('.tmp'))) fs.writeFileSync(off, '');
      return NOW;
    };
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, clock)));
    expect(r).toEqual({ state: 'held', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(fs.existsSync(off), 'the switch never appeared: the case proved nothing').toBe(true);
    expect(segmentsOf(box), 'a temp or a segment was left').toEqual([]);
    expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null });
    expect(metaOf(box, HEALTH_META.exportPassMs), 'a held pass is not a pass').toBeNull();
    fs.rmSync(off);
    const next = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
    expect(next).toMatchObject({ state: 'written', rows: 2 });
  }, 120_000);

  it('no rostered home, no horizon: nothing is selected and no directory is made', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-nohome-', [row(1, 'one', DAY)]);
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => Date.now(), { homes: [] })));
    expect(r).toEqual({ state: 'no-horizon', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(fs.existsSync(path.join(box.root, 'export'))).toBe(false);
    expect(marks(box)).toEqual({ [rid(1)]: null });
  }, 120_000);

  it('a page boundary: the next page\'s first due row is held to what is left of the bound, never taken whatever its size (one row a page)', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-page-', [
      row(1, 'oldest', 3 * DAY), row(2, 'middle', 2 * DAY), row(3, 'newest', DAY),
    ]);
    const z1 = Number(q(box, 'SELECT length(b.z) AS n FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', rid(1))[0]!['n']);
    expect(z1, 'the fixture\'s first row must leave room under the bound').toBeLessThan(EXPORT_ROW_META_BYTES / 2);
    // A bound of one and a half rows' metadata: the first row fits with room left over, and no second row can.
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => Date.now(),
      { limits: { maxBytes: 1.5 * EXPORT_ROW_META_BYTES }, deps: { exportPageRows: 1 } })));
    expect(r).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, rows: 1, complete: false });
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: null, [rid(3)]: null });
  }, 120_000);

  it('row metadata counts toward the bound: many small rows fill a segment to about the bound and never past it by more than the schema\'s pages', async () => {
    const N = 300;
    const { box, ids } = ingestedBox('ccrc-history-export-meta-', Array.from({ length: N }, (_, i) => row(i + 1, `short prompt ${i}`, DAY + i * MIN)));
    const bound = 100 * EXPORT_ROW_META_BYTES;
    const r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => Date.now(), { limits: { maxBytes: bound } })));
    expect(r).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db`, complete: false });
    expect(r.rows, 'the bound counted blob bytes alone: every small row fit').toBeLessThanOrEqual(100);
    // Task 4's format-1 schema pages: 56 KiB on a prototype of its tables; 64 KiB allowed.
    expect(fs.statSync(path.join(exportDirOf(box), `1.${ids.writer}.db`)).size).toBeLessThanOrEqual(bound + 64 * 1024);
  }, 120_000);
});
```

- [ ] **Step 3: Put the file on the floor leg.** In `.github/workflows/ci.yml`, job `node-floor`, step `Test`, add this line directly above the line `          test/measure-history.test.ts`, with the same ten-space indentation:

```
          test/history-export.test.ts
```

`ci-pipeline.test.ts` derives the leg's expected list from `server/test` and compares sorted lists, so the line's place among the history files does not matter, and a history test file missing from the heredoc reds that pin. An edit under `.github/` selects the full suite on the PR; the coordinator dispatches that run, never the worker.

- [ ] **Step 4: Run the new file and see it fail.** From inside `server/`, in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts
```

Expected: all 13 cases red, each at its first `SW.exportPass` call with `TypeError: SW.exportPass is not a function` (the ingest passes, the hot-blob, swap-copy, older-file, sidecar and page-boundary cases' preconditions and the `pruneDryRun` read before it all succeed). If the hot-blob case reds on `the fixture must make one blob of the two sessions' same prompt`, or the swap-copy or older-file case on `the fixture must hold two copies`, the merged B1 keys blobs or transcripts differently from this plan's reading: stop and report, never loosen the fixture's assertion. If instead the file fails to load with `does not provide an export named 'openSegment'`, Task 4 is not on this branch: stop and report.

- [ ] **Step 5: Write the pass.** In `ccd/history/sweep.mjs`, insert directly ABOVE the entry guard `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`:

```js
// ── W1-B4 Task 5: the sole-copy export pass (spec §9.15 "What is due", "The pass"; ⟦D:history-sole-copy-export⟧) ──────
// One pass writes ONE immutable segment, export/<store_id>/<seq>.<writer>.db, on the home filesystem and never under
// db/, so a lost volume leaves it (D-4172). Four phases, one function each:
//   1. exportSelect: the candidate rows, oldest first, page by page. Rows with no ts_ms come first, then the young rows
//      of each transcript lib's dueTranscriptKeys makes due, then rows by time through entries' partial index
//      entries_unexported, then the unlinked sidecars whose blob nothing has exported
//      (⟦D:history-export-unlinked-sidecar-with-blob⟧). Every candidate carries its transcript's files, the census's
//      per-row set (D-4248), and lib's planSegment (L1), with its default
//      reducer, the census's per-copy one (⟦D:history-export-due-per-copy⟧; RD1's one clock), decides each page under
//      what is left of the bound: EXPORT_SEGMENT_MAX_BYTES, or what the run's byte budget has left, each row counted at
//      its new blob bytes and its metadata (⟦D:history-export-segment-bound-estimated⟧).
//   2. writeSegmentRows: through store.mjs, each row after what places it (its families, transcript, epochs and the
//      files it names), then the entry, its variants, its boundary, its linked sidecars and its memberships by (path,
//      dev, ino, line). The bytes of every blob it references that is not yet exported travel with it
//      (⟦D:history-export-row-carries-blob⟧), and a pruned blob as a stub with no bytes
//      (⟦D:history-export-pruned-row-stub⟧). No internal id is written.
//   3. publishSegment (store.mjs): link(), never rename, so an existing name is never replaced.
//   4. markExported: ONE transaction, after the link, sets exported_ms and exported_seg on the blobs and entries the
//      segment holds. A crash before it leaves rows the next segment repeats, which replay absorbs (§9.15 "Mark").
// The pass reads no segment and appends no journal record. It decides nothing: lib's planSegment and nextSegmentSeq do.
// Its stops stay apart: 'written', 'nothing-due', 'no-horizon' (no rostered home to read a retention from), 'held'
// (history-off, or the run's budget, before a row was published) and 'failed' (a throw, counted export_write_failed).

/** Rows per page of the selection: a bound on one statement's work, not a rule. */
const EXPORT_PAGE_ROWS = 256;
/** meta: the last segment number this store published. The next is past it AND past every name on disk (§9.15 "Write"). */
const EXPORT_SEQ_META = 'export_seq';
/** meta: when a pass last failed with a CAUGHT error. exportStep's cadence counts it as a pass, so a pass that keeps
 *  failing that way retries hourly, never every tick; doctor's last-pass clock (HEALTH_META.exportPassMs) does not, so
 *  it still reads stale. A killed pass writes nothing here, and the next tick retries it. */
const EXPORT_ATTEMPT_META = 'export_attempt_ms';
/** Candidate rows with a time, oldest first, keyset-paged by (ts_ms, entry_id): the partial index entries_unexported
 *  orders them. `ts_ms < cutoff` (the shortest home's horizon) is only a prefilter; planSegment decides each row by its
 *  holding files. It hides no due row held by a file on disk: no file's horizon is shorter than the shortest home's
 *  (an unrostered file is mapped to that home), and a row is written no later than its file's last write. */
const EXPORT_DUE_ENTRIES_SQL = 'SELECT entry_id, ts_ms, transcript_pk FROM entries WHERE exported_ms IS NULL AND ts_ms IS NOT NULL '
  + 'AND ts_ms < ? AND (ts_ms > ? OR (ts_ms = ? AND entry_id > ?)) ORDER BY ts_ms, entry_id LIMIT ?';
/** Rows with no time: the prefilter cannot see them, so every one is a candidate; like every row, each is due by its
 *  transcript's files (§9.15 "A row is due"). */
const EXPORT_NULL_TS_ENTRIES_SQL = 'SELECT entry_id, ts_ms, transcript_pk FROM entries WHERE exported_ms IS NULL AND ts_ms IS NULL '
  + 'AND entry_id > ? ORDER BY entry_id LIMIT ?';
/** One transcript's rows at or past the prefilter's cutoff, oldest first, keyset-paged by (ts_ms, entry_id) through
 *  entries_ts (transcript_pk, ts_ms). Asked only for a transcript lib's dueTranscriptKeys makes due now: under the
 *  per-copy rule every row of it is due at that instant, however young (⟦D:history-export-due-per-copy⟧). Its rows
 *  below the cutoff come through EXPORT_DUE_ENTRIES_SQL, never twice. */
const EXPORT_TRANSCRIPT_ENTRIES_SQL = 'SELECT entry_id, ts_ms, transcript_pk FROM entries WHERE transcript_pk = ? AND exported_ms IS NULL '
  + 'AND ts_ms >= ? AND (ts_ms > ? OR (ts_ms = ? AND entry_id > ?)) ORDER BY ts_ms, entry_id LIMIT ?';
/** Blobs only an unlinked sidecar names, unexported and unpruned: schema v1 has no mark on a sidecar row, so the blob's
 *  mark is the row's (⟦D:history-export-unlinked-sidecar-with-blob⟧). */
const EXPORT_UNLINKED_SQL = 'SELECT DISTINCT s.blob_id AS blob_id FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id '
  + 'WHERE s.entry_id IS NULL AND b.exported_ms IS NULL AND b.z IS NOT NULL AND s.blob_id > ? ORDER BY s.blob_id LIMIT ?';

const EXPORT_STMTS = new WeakMap();
/** The export's prepared statements, one set per connection. Each names its columns. The ingest_files and entries reads
 *  take integers as bigints: mtime_ns and struct_rank_ns pass 2^53, and node:sqlite throws a RangeError on such
 *  a value read as a number. */
function exportStmts(db) {
  let s = EXPORT_STMTS.get(db);
  if (s !== undefined) return s;
  const big = (st) => { st.setReadBigInts(true); return st; };
  s = {
    dueEntries: db.prepare(EXPORT_DUE_ENTRIES_SQL),
    nullTsEntries: db.prepare(EXPORT_NULL_TS_ENTRIES_SQL),
    transcriptEntries: db.prepare(EXPORT_TRANSCRIPT_ENTRIES_SQL),
    transcriptPks: db.prepare('SELECT transcript_pk FROM transcripts ORDER BY transcript_pk'),
    unlinked: db.prepare(EXPORT_UNLINKED_SQL),
    rowBlobs: db.prepare('SELECT blob_id FROM entries WHERE entry_id = ? UNION SELECT blob_id FROM entry_variants WHERE entry_id = ? '
      + 'UNION SELECT kept_blob_id FROM boundaries WHERE entry_id = ? AND kept_blob_id IS NOT NULL'),
    blobFact: db.prepare('SELECT length(z) AS zlen, z IS NULL AS pruned, exported_ms IS NOT NULL AS exported FROM blobs WHERE blob_id = ?'),
    blobRow: db.prepare('SELECT sha256, codec, raw_len, z FROM blobs WHERE blob_id = ?'),
    blobSha: db.prepare('SELECT sha256 FROM blobs WHERE blob_id = ?'),
    sidecarsOf: db.prepare('SELECT name, blob_id, entry_id, first_seen_ms FROM sidecars WHERE transcript_pk = ? ORDER BY name, blob_id'),
    unlinkedOf: db.prepare('SELECT transcript_pk, name, first_seen_ms FROM sidecars WHERE blob_id = ? AND entry_id IS NULL ORDER BY transcript_pk, name'),
    entry: big(db.prepare(`SELECT uuid, transcript_pk, type, subtype, role, model, parent_uuid, ts_ms, request_id, api_block_index,
        msg_id, source_tool_use_id, tool_name, is_compact_summary, provenance, prov_version, parse_state, struct_rank_ns,
        struct_file_id, blob_id FROM entries WHERE entry_id = ?`)),
    variants: db.prepare('SELECT blob_id, first_file_id, first_seen_ms, cause FROM entry_variants WHERE entry_id = ? ORDER BY blob_id'),
    boundary: db.prepare(`SELECT transcript_pk, ord, trigger, head_uuid, anchor_uuid, tail_uuid, kept_blob_id, pre_tokens, post_tokens,
        duration_ms FROM boundaries WHERE entry_id = ?`),
    transcript: db.prepare('SELECT cc_session_uuid, harness, agent_id, parent_tool_use_id, workflow_run_id, agent_type FROM transcripts WHERE transcript_pk = ?'),
    epochsOf: db.prepare(`SELECT s.ccrc_id, s.generation, s.project, s.first_seen_ms, e.seq, e.cause, e.declared_by, e.started_ms,
        e.cwd, e.cwd_real, e.git_branch, e.confirmed_ms
      FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE e.cc_session_uuid = ? ORDER BY s.ccrc_id, s.generation, e.seq`),
    file: big(db.prepare(`SELECT f.dev, f.ino, f.transcript_pk, f.size, f.mtime_ns, f.eof_ms,
        (SELECT min(p.path) FROM file_paths p WHERE p.file_id = f.file_id) AS path FROM ingest_files f WHERE f.file_id = ?`)),
    memberships: db.prepare('SELECT file_id, entry_id, line FROM memberships'),
    markBlob: db.prepare('UPDATE blobs SET exported_ms = ?, exported_seg = ? WHERE blob_id = ? AND exported_ms IS NULL'),
    markEntry: db.prepare('UPDATE entries SET exported_ms = ?, exported_seg = ? WHERE entry_id = ?'),
  };
  EXPORT_STMTS.set(db, s);
  return s;
}

/** A bigint read whose value fits a number (an id, a size, a ms time), as a number; NULL stays null. */
function segInt(v) {
  return v === null || v === undefined ? null : Number(v);
}

/** Each rostered home's retention, the census's rule (§9.15): the last value retentionCensus kept in meta, or the
 *  harness default for a home never measured (D-4210). Never read from settings.json
 *  here: the census reads the files once, and the pass and doctor read the same numbers. */
function exportHomeDays(db, homes) {
  const days = {};
  for (const h of homes) {
    const raw = getMeta(db, `retention:${h}`);
    days[h] = raw !== null && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : CLAUDE_CODE_DEFAULT_RETENTION_DAYS;
  }
  return days;
}

/** export/<store_id>/ under the fixed root: lib's EXPORT_DIR is the one spelling, and historyPaths gains no key (B3 owns
 *  that edit, and B3 and B4 merge in either order). */
function exportDirFor(P, storeId) {
  return `${P.root}/${EXPORT_DIR}/${storeId}`;
}

/** Both export directories, 0700 whatever the umask, as §9.6's mode check wants every directory: store.mjs's
 *  ensureSegmentDir (Task 4), the one directory maker, which also refuses a store id off its grammar. */
function ensureExportDirs(P, storeId) {
  ensureSegmentDir(`${P.root}/${EXPORT_DIR}`, storeId);
}

/** Phase 1 (§9.15 "What is due"): the candidates this segment takes, in order, decided page by page by lib's
 *  planSegment under what is left of `boundBytes`. Answers the taken candidates, the blob ids whose bytes travel
 *  (`carry`), the pruned blob ids that travel as stubs, the transcripts they name, each transcript's linked sidecars,
 *  the cutoff, and `complete`: false when the bound or the run's budget stopped the selection with due rows left. */
function exportSelect(db, ctx, nowMs, homeDays, boundBytes) {
  const s = exportStmts(db);
  const homes = Object.keys(homeDays);
  // The shortest rostered home decides two things here and no due verdict: the ts prefilter's cutoff, and the home a
  // file outside every rostered home is measured against (the census's mapping, B1: the early side). planSegment's
  // per-copy default measures every other file against its own home (⟦D:history-export-due-per-copy⟧).
  const minDays = shortestRetention(homeDays);
  const minHome = homes.find((h) => homeDays[h] === minDays) ?? null;
  const cutoffMs = nowMs - exportHorizonDays(minDays) * DAY_MS;
  // A candidate's holding files are its TRANSCRIPT's, B1's census clock, not its own copies through memberships: the
  // export and the census read one clock (D-4248).
  const files = transcriptFiles(db, homes);
  const filesOf = (pk) => (files.get(pk) ?? []).map((f) => ({ home: f.home ?? minHome, mtimeMs: f.mtimeMs, present: f.present }));
  // Rows per page: EXPORT_PAGE_ROWS, or an in-process test's ctx.deps.exportPageRows (D-4247).
  const pageRows = Number.isSafeInteger(ctx.deps?.exportPageRows) && ctx.deps.exportPageRows > 0 ? ctx.deps.exportPageRows : EXPORT_PAGE_ROWS;
  const sel = { taken: [], carry: new Set(), stubs: new Set(), transcripts: new Set(), linked: new Map(), cutoffMs, complete: true };
  const facts = new Map();
  const blobFact = (id) => {
    let f = facts.get(id);
    if (f === undefined) {
      const r = s.blobFact.get(id);
      f = { zBytes: Number(r.zlen ?? 0), pruned: Number(r.pruned) === 1, exported: Number(r.exported) === 1 };
      facts.set(id, f);
    }
    return f;
  };
  // A blob this pass already carries is `exported` to every later page, so it is never counted or carried twice.
  const blobsFor = (ids) => [...ids].sort((a, b) => a - b).map((id) => {
    const f = blobFact(id);
    return { key: String(id), zBytes: f.zBytes, exported: f.exported || sel.carry.has(id), pruned: f.pruned };
  });
  const linkedOf = (pk) => {
    let m = sel.linked.get(pk);
    if (m === undefined) {
      m = new Map();
      for (const r of s.sidecarsOf.all(pk)) {
        if (r.entry_id === null) continue;
        const list = m.get(Number(r.entry_id)) ?? [];
        list.push({ name: r.name, blobId: Number(r.blob_id), firstSeenMs: Number(r.first_seen_ms) });
        m.set(Number(r.entry_id), list);
      }
      sel.linked.set(pk, m);
    }
    return m;
  };
  const entryCand = (r) => {
    const id = Number(r.entry_id);
    const pk = Number(r.transcript_pk);
    const ids = new Set(s.rowBlobs.all(id, id, id).map((b) => Number(b.blob_id)));
    for (const sc of linkedOf(pk).get(id) ?? []) ids.add(sc.blobId);
    return { kind: 'entry', id, pks: [pk], cand: { key: `e${id}`, tsMs: r.ts_ms === null ? null : Number(r.ts_ms), files: filesOf(pk), blobs: blobsFor(ids) } };
  };
  const sidecarCand = (r) => {
    const id = Number(r.blob_id);
    const pks = [...new Set(s.unlinkedOf.all(id).map((x) => Number(x.transcript_pk)))];
    return { kind: 'sidecar', id, pks, cand: { key: `s${id}`, tsMs: null, files: pks.flatMap(filesOf), blobs: blobsFor([id]) } };
  };
  let left = boundBytes;
  /** One page through planSegment. False when the bound or the run's budget ends the selection. Once an earlier page
   *  took a row, this page's first row must fit what is left (takenBefore): only the pass's first row is taken
   *  whatever its size. No reducer is passed: planSegment's default is the census's (B2's per-copy reducer), so the
   *  pass and the census answer one clock (RD1). */
  const decide = (cands) => {
    if (cands.length > 0) {
      const plan = planSegment({ nowMs, homeRetentionDays: homeDays, rows: cands.map((c) => c.cand), boundBytes: left, takenBefore: sel.taken.length > 0 });
      const byKey = new Map(cands.map((c) => [c.cand.key, c]));
      for (const k of plan.take) {
        const c = byKey.get(k);
        sel.taken.push(c);
        for (const pk of c.pks) sel.transcripts.add(pk);
      }
      for (const k of plan.carry) sel.carry.add(Number(k));
      for (const k of plan.stubs) sel.stubs.add(Number(k));
      left -= plan.bytes;
      if (plan.leftDue > 0 || left <= 0) { sel.complete = false; return false; }
    }
    if (!budgetLeft(ctx.budget)) { sel.complete = false; return false; }
    return true;
  };
  for (let after = 0; ;) {
    const page = s.nullTsEntries.all(after, pageRows);
    if (page.length === 0) break;
    after = Number(page[page.length - 1].entry_id);
    if (!decide(page.map(entryCand))) return sel;
  }
  // The rows, at or past the cutoff, of every transcript the default rule makes due now: lib's dueTranscriptKeys, the
  // census's own prefilter over the same file clock (RD1). Under the per-copy rule every row of one transcript falls
  // due at one instant whatever its own time, so the ts prefilter below would pass over the young ones: a transcript
  // with no holding file left on disk, and one whose young rows outlived the files that held them while an older file
  // of it stays on disk (⟦D:history-export-due-per-copy⟧). planSegment still decides each row.
  const transcripts = s.transcriptPks.all().map((t) => ({ key: Number(t.transcript_pk), files: filesOf(Number(t.transcript_pk)) }));
  for (const pk of dueTranscriptKeys({ nowMs, homeRetentionDays: homeDays, transcripts })) {
    for (let ts = cutoffMs, after = 0; ;) {
      const page = s.transcriptEntries.all(pk, cutoffMs, ts, ts, after, pageRows);
      if (page.length === 0) break;
      ts = Number(page[page.length - 1].ts_ms);
      after = Number(page[page.length - 1].entry_id);
      if (!decide(page.map(entryCand))) return sel;
    }
  }
  for (let ts = Number.MIN_SAFE_INTEGER, after = 0; ;) {
    const page = s.dueEntries.all(cutoffMs, ts, ts, after, pageRows);
    if (page.length === 0) break;
    ts = Number(page[page.length - 1].ts_ms);
    after = Number(page[page.length - 1].entry_id);
    if (!decide(page.map(entryCand))) return sel;
  }
  for (let after = 0; ;) {
    const page = s.unlinked.all(after, pageRows);
    if (page.length === 0) break;
    after = Number(page[page.length - 1].blob_id);
    if (!decide(page.filter((r) => !sel.carry.has(Number(r.blob_id))).map(sidecarCand))) return sel;
  }
  return sel;
}

/** Phase 2: the taken candidates into the segment, each row after what places it. Before every row it reads the run's
 *  clock and history-off; it stops at either, so what it wrote is whole rows. Answers the entry and blob ids written,
 *  the rows and bytes, and why it stopped early ('budget' | 'off' | null). */
function writeSegmentRows(db, ctx, seg, sel) {
  const s = exportStmts(db);
  const ins = segmentInserts(seg);
  const out = { entries: [], blobs: [], rows: 0, bytes: 0, stopped: null };
  // Every membership of the taken entries in ONE scan: schema v1 has no index led by memberships.entry_id, and one scan
  // a segment costs less than one a row.
  const want = new Set(sel.taken.filter((t) => t.kind === 'entry').map((t) => t.id));
  const held = new Map();
  for (const m of s.memberships.iterate()) {
    const id = Number(m.entry_id);
    if (!want.has(id)) continue;
    const list = held.get(id) ?? [];
    list.push({ fileId: Number(m.file_id), line: Number(m.line) });
    held.set(id, list);
  }
  const keys = new Map();
  const files = new Map();
  const done = { families: new Set(), epochs: new Set(), blobs: new Set() };
  const shaOf = (id) => s.blobSha.get(id).sha256;
  // A transcript by its natural key, after its families and before its epochs: what placed the row, which the transcript
  // alone gave and a rebuild could not re-derive once it is gone (§9.15, BK11).
  const ensureTranscript = (pk) => {
    let k = keys.get(pk);
    if (k !== undefined) return k;
    const t = s.transcript.get(pk);
    k = { cc_session_uuid: t.cc_session_uuid, agent_id: t.agent_id };
    const epochs = s.epochsOf.all(t.cc_session_uuid);
    for (const e of epochs) {
      const fk = `${e.ccrc_id}\0${e.generation}`;
      if (done.families.has(fk)) continue;
      done.families.add(fk);
      ins.family({ ccrc_id: e.ccrc_id, generation: e.generation, project: e.project, first_seen_ms: e.first_seen_ms });
    }
    ins.transcript({ ...k, harness: t.harness, parent_tool_use_id: t.parent_tool_use_id, workflow_run_id: t.workflow_run_id, agent_type: t.agent_type });
    for (const e of epochs) {
      const ek = `${e.ccrc_id}\0${e.generation}\0${e.seq}`;
      if (done.epochs.has(ek)) continue;
      done.epochs.add(ek);
      ins.epoch({
        ccrc_id: e.ccrc_id, generation: e.generation, seq: e.seq, cc_session_uuid: t.cc_session_uuid, cause: e.cause,
        declared_by: e.declared_by, started_ms: e.started_ms, cwd: e.cwd, cwd_real: e.cwd_real, git_branch: e.git_branch,
        confirmed_ms: e.confirmed_ms,
      });
    }
    keys.set(pk, k);
    return k;
  };
  // A file by its identity (path, dev, ino), after its transcript. A file whose paths were all re-pointed (a retired
  // row) has no path left: '' stands in, and replay keys its dead-file row by (dev, ino) alone (lib exportedSourceKey
  // accepts '', Task 1).
  const ensureFile = (fileId) => {
    let f = files.get(fileId);
    if (f !== undefined) return f;
    const r = s.file.get(fileId);
    if (r === undefined) throw new Error(`ingest_files row ${fileId} is gone and a row still names it`);
    const k = ensureTranscript(segInt(r.transcript_pk));
    f = { path: r.path ?? '', dev: r.dev, ino: r.ino };
    ins.file({ ...f, ...k, size: segInt(r.size), mtime_ns: r.mtime_ns, eof_ms: segInt(r.eof_ms) });
    files.set(fileId, f);
    return f;
  };
  // A carried blob's bytes as stored, with every unlinked sidecar row naming it; a pruned blob as a stub. A blob already
  // exported is in its own segment, which replay applies first (every segment's blobs before any rows, §9.14).
  const ensureBlob = (id) => {
    if (done.blobs.has(id)) return;
    done.blobs.add(id);
    if (sel.carry.has(id)) {
      const b = s.blobRow.get(id);
      ins.blob({ sha256: b.sha256, codec: b.codec, raw_len: b.raw_len, z: b.z, pruned: false });
      ctx.budget.bytes += b.z.length;
      out.bytes += b.z.length;
      out.blobs.push(id);
      for (const u of s.unlinkedOf.all(id)) {
        const k = ensureTranscript(Number(u.transcript_pk));
        ins.sidecar({ ...k, name: u.name, blob_sha256: b.sha256, uuid: null, first_seen_ms: u.first_seen_ms });
      }
    } else if (sel.stubs.has(id)) {
      const b = s.blobRow.get(id);
      ins.blob({ sha256: b.sha256, codec: b.codec, raw_len: b.raw_len, z: null, pruned: true });
    }
  };
  const writeEntry = (id) => {
    const e = s.entry.get(id);
    const pk = segInt(e.transcript_pk);
    const k = ensureTranscript(pk);
    const struct = ensureFile(segInt(e.struct_file_id));
    const variants = s.variants.all(id);
    const firsts = variants.map((v) => ensureFile(Number(v.first_file_id)));
    const copies = (held.get(id) ?? []).map((m) => ({ ...ensureFile(m.fileId), line: m.line }));
    const bd = s.boundary.get(id);
    const sidecars = sel.linked.get(pk)?.get(id) ?? [];
    const keptId = bd !== undefined && bd.kept_blob_id !== null ? Number(bd.kept_blob_id) : null;
    for (const b of [segInt(e.blob_id), ...variants.map((v) => Number(v.blob_id)), ...(keptId === null ? [] : [keptId]), ...sidecars.map((x) => x.blobId)]) {
      ensureBlob(b);
    }
    ins.entry({
      uuid: e.uuid, ...k, type: e.type, subtype: e.subtype, role: e.role, model: e.model, parent_uuid: e.parent_uuid,
      ts_ms: segInt(e.ts_ms), request_id: e.request_id, api_block_index: segInt(e.api_block_index), msg_id: e.msg_id,
      source_tool_use_id: e.source_tool_use_id, tool_name: e.tool_name, is_compact_summary: segInt(e.is_compact_summary),
      provenance: e.provenance, prov_version: segInt(e.prov_version), parse_state: e.parse_state, struct_rank_ns: e.struct_rank_ns,
      struct_path: struct.path, struct_dev: struct.dev, struct_ino: struct.ino, blob_sha256: shaOf(segInt(e.blob_id)),
    });
    variants.forEach((v, i) => {
      ins.variant({
        uuid: e.uuid, blob_sha256: shaOf(Number(v.blob_id)), first_path: firsts[i].path, first_dev: firsts[i].dev,
        first_ino: firsts[i].ino, first_seen_ms: v.first_seen_ms, cause: v.cause,
      });
    });
    if (bd !== undefined) {
      const bk = ensureTranscript(Number(bd.transcript_pk));
      ins.boundary({
        uuid: e.uuid, ...bk, boundary_ord: bd.ord, trigger: bd.trigger, head_uuid: bd.head_uuid, anchor_uuid: bd.anchor_uuid,
        tail_uuid: bd.tail_uuid, kept_sha256: keptId === null ? null : shaOf(keptId), pre_tokens: bd.pre_tokens,
        post_tokens: bd.post_tokens, duration_ms: bd.duration_ms,
      });
    }
    for (const sc of sidecars) ins.sidecar({ ...k, name: sc.name, blob_sha256: shaOf(sc.blobId), uuid: e.uuid, first_seen_ms: sc.firstSeenMs });
    for (const c of copies) ins.membership({ path: c.path, dev: c.dev, ino: c.ino, uuid: e.uuid, line: c.line });
  };
  for (const t of sel.taken) {
    if (!budgetLeft(ctx.budget)) { out.stopped = 'budget'; break; }
    if (existsSync(ctx.paths.off)) { out.stopped = 'off'; break; }
    if (t.kind === 'entry') {
      writeEntry(t.id);
      out.entries.push(t.id);
    } else {
      ensureBlob(t.id);
    }
    out.rows += 1;
  }
  return out;
}

/** A segment that will not be published: its handle closed (publishSegment may have closed it already) and its temp gone. */
function discardSegment(seg) {
  try { seg.db.close(); } catch { /* already closed */ }
  removeEntry(seg.temp);   // B1's removal by type (review 316 F22); store.mjs owns the temp's name
}

/** What a pass that ran to its end records, inside the caller's transaction: the last-pass clock doctor's export-due
 *  rule and the hourly cadence read. `complete` says every due row the pass found fit in its segment. */
function noteExportPassDone(db, nowMs, complete) {
  setMeta(db, HEALTH_META.exportPassMs, String(nowMs));
}

/** Phase 4 (§9.15 "Mark"): ONE transaction, after the link: the blobs whose bytes the segment holds and the entries it
 *  holds take its name, and the counter takes its number. A stub is never marked: a pruned blob is never exported. */
function markExported(db, m) {
  const s = exportStmts(db);
  withTx(db, 'NORMAL', () => {
    for (const id of m.blobs) s.markBlob.run(m.nowMs, m.name, id);
    for (const id of m.entries) s.markEntry.run(m.nowMs, m.name, id);
    setMeta(db, EXPORT_SEQ_META, String(m.seq));
    noteExportPassDone(db, m.nowMs, m.complete);
  });
}

/** One export pass (§9.15 "The pass"). It never throws but for busy (O22): anything else that fails, from making the
 *  directories to the mark, removes its temp, marks nothing, is counted export_write_failed with one stderr line, and
 *  answers 'failed', so the tick goes on. */
export async function exportPass(db, ctx) {
  const stop = (state) => ({ state, segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
  if (ctx.ids === null || ctx.rosterUnreadable === true || ctx.homes.length === 0) return stop('no-horizon');
  const nowMs = ctx.now();
  let seg = null;
  try {
    const { storeId, writer } = ctx.ids;
    const dir = exportDirFor(ctx.paths, storeId);
    ensureExportDirs(ctx.paths, storeId);
    // A stale temp (a killed pass's) is removed by Task 6's exportStep before its preflight, so a pause never keeps it.
    const room = Math.min(EXPORT_SEGMENT_MAX_BYTES, ctx.budget.maxBytes - ctx.budget.bytes);
    if (room <= 0 || !budgetLeft(ctx.budget)) return stop('held');
    const sel = exportSelect(db, ctx, nowMs, exportHomeDays(db, ctx.homes), room);
    if (sel.taken.length === 0) {
      if (!sel.complete) return stop('held');
      withTx(db, 'NORMAL', () => { noteExportPassDone(db, nowMs, true); });
      return { ...stop('nothing-due'), complete: true };
    }
    const s = exportStmts(db);
    const recorded = getMeta(db, EXPORT_SEQ_META);
    let seq = nextSegmentSeq({
      onDisk: listSegments(dir).map((x) => x.seq),
      recorded: recorded !== null && /^[1-9][0-9]{0,15}$/.test(recorded) ? Number(recorded) : null,
    });
    let name = segmentName({ seq, writer });
    const harnesses = [...new Set([...sel.transcripts].map((pk) => s.transcript.get(pk).harness))].sort();
    seg = createSegment(dir, name, { storeId, writer, seq, harnesses, cutoffMs: sel.cutoffMs, format: EXPORT_SEGMENT_FORMAT });
    const w = writeSegmentRows(db, ctx, seg, sel);
    if (w.stopped === 'off' || w.rows === 0) {
      discardSegment(seg);
      seg = null;
      return stop('held');
    }
    const linked = publishSegment(seg, dir, name);
    if (linked !== 'linked') throw new Error(`the segment name ${name} is already on disk`);
    seg = null;
    const complete = sel.complete && w.stopped === null;
    markExported(db, { name, seq, nowMs, blobs: w.blobs, entries: w.entries, complete });
    return { state: 'written', segment: name, rows: w.rows, blobs: w.blobs.length, bytes: w.bytes, complete };
  } catch (e) {
    if (seg !== null) discardSegment(seg);
    if (isBusy(e)) throw e;
    process.stderr.write(`history-sweep: an export segment write failed and nothing was marked: ${e && e.message ? e.message : String(e)}\n`);
    countOutside(db, 'export_write_failed');
    try { setMeta(db, EXPORT_ATTEMPT_META, String(nowMs)); } catch { /* busy: the next tick retries sooner, nothing is lost */ }
    return stop('failed');
  }
}
```

`let seq` and `let name` are reassigned by Task 7's retry; nothing else in this task reassigns them.

- [ ] **Step 6: Add the imports the block needs.** From the repository root:

```bash
python3 - <<'EOF'
import re
s = open('ccd/history/sweep.mjs').read()
want = {
    './lib.mjs': ['EXPORT_DIR', 'EXPORT_SEGMENT_MAX_BYTES', 'EXPORT_SEGMENT_FORMAT', 'segmentName', 'nextSegmentSeq',
                  'planSegment', 'HEALTH_META', 'CLAUDE_CODE_DEFAULT_RETENTION_DAYS', 'shortestRetention', 'exportHorizonDays',
                  'dueTranscriptKeys'],
    './store.mjs': ['ensureSegmentDir', 'createSegment', 'segmentInserts', 'publishSegment', 'listSegments',
                    'withTx', 'bump', 'getMeta', 'setMeta', 'removeEntry'],
    'node:fs': ['existsSync'],
}
for mod, names in want.items():
    m = re.search(r"import (?:fs, )?\{([^}]*)\} from '" + re.escape(mod) + r"';", s)
    assert m, f'no named import from {mod}'
    have = {n.strip().split(' as ')[-1] for n in m.group(1).split(',') if n.strip()}
    missing = [n for n in names if n not in have]
    print(f"{mod}: add {', '.join(missing) if missing else '(nothing)'}")
EOF
```

Add every printed name to that module's existing import statement (`node:fs`'s is the `import fs, { … } from 'node:fs';` statement). Keep one statement per module and never repeat a name. Re-run until all three lines say `(nothing)`. Then check that the guard is still last, with no top-level await, and that no name is declared twice:

```bash
grep -c 'import.meta.url === pathToFileURL' ccd/history/sweep.mjs                    # 1
sed -n "$(grep -n 'import.meta.url === pathToFileURL' ccd/history/sweep.mjs | cut -d: -f1),\$p" ccd/history/sweep.mjs
grep -nE '^(await|(const|let|var) [^=]+= *await)\b' ccd/history/sweep.mjs            # prints nothing
grep -cE '^(const|function) (EXPORT_CANDIDATES_SQL|DAY_MS|transcriptFiles)\b' ccd/history/sweep.mjs   # 3: B1's, untouched
node --check ccd/history/sweep.mjs
```

The `sed` must print exactly the guard, from its `if (process.argv[1] …` line to its closing `}`, and nothing after it.

- [ ] **Step 7: Run and see it pass.** From inside `server/`, each command in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts
./node_modules/.bin/vitest run test/history-sweep.test.ts test/history-ingest.test.ts test/history-op.test.ts
./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history'
./node_modules/.bin/vitest run test/ci-pipeline.test.ts
node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected: every case green; tsc prints nothing. Nothing in the tick calls `exportPass` yet (Task 6 wires it), so the earlier files are unchanged by this task; they run here because the block shares their module. `single-definition`'s O13 and O14 stay green: sweep.mjs spells no `/history-off` (it reads `ctx.paths.off`) and declares no lib vocabulary. A red case in a file CLAUDE.md lists as a load flake (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) is re-run alone before it is called a break; `history-ingest` is not on that list, so a red there is a break until an isolated re-run says otherwise.

- [ ] **Step 8: Mutations — each new guard reds its case.** From the repository root, once:

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w1-b4/scratch"; mkdir -p "$SCRATCH"; cp ccd/history/sweep.mjs "$SCRATCH/sweep.mjs.t5"; cp ccd/history/lib.mjs "$SCRATCH/lib.mjs.t5"
```

Each mutation below is applied by hand to the file it names (`ccd/history/sweep.mjs` unless it says `lib.mjs`), run from inside `server/` with `./node_modules/.bin/vitest run test/history-export.test.ts -t '<filter>'`, seen red, and undone with `cp "$SCRATCH/sweep.mjs.t5" ccd/history/sweep.mjs` and `cp "$SCRATCH/lib.mjs.t5" ccd/history/lib.mjs` (from the repository root) before the next. Never `git stash`.

| Mutation | `-t` filter | Expected red |
|---|---|---|
| In `writeSegmentRows`, delete the line `    if (existsSync(ctx.paths.off)) { out.stopped = 'off'; break; }` | `history-off between rows` | `expected { state: 'written', … } to deeply equal { state: 'held', … }` |
| In `ensureBlob`, delete the `} else if (sel.stubs.has(id)) {` arm (its three lines) | `travels with a stub` | `the pruned row's blob has no stub: expected undefined to match object { z: null, pruned: 1 }` |
| In `EXPORT_DUE_ENTRIES_SQL`, delete `exported_ms IS NULL AND ` | `O39: due rows go into ONE segment` | the second pass answers `state: 'written'`, not `'nothing-due'` |
| In `ensureBlob`, delete the `for (const u of s.unlinkedOf.all(id)) { … }` loop | `an unlinked sidecar travels` | `expected [] to deeply equal [ { cc_session_uuid: …, name: 'b9x0-orphan.txt', … } ]` |
| In `writeSegmentRows`, delete the line `    if (!budgetLeft(ctx.budget)) { out.stopped = 'budget'; break; }` | `the wall clock` | `rows: 3` where `rows: 1` was expected |
| In `exportSelect`'s `decide`, change `if (plan.leftDue > 0 \|\| left <= 0)` to `if (false)` | `the bound` | `complete: true` where `complete: false` was expected |
| In `exportSelect`'s `decide`, delete `, takenBefore: sel.taken.length > 0` from the `planSegment` call | `a page boundary` | `rows: 2` where `rows: 1` was expected |
| In `lib.mjs`'s `planSegment`, change `    let add = EXPORT_ROW_META_BYTES;` to `    let add = 0;` | `row metadata counts toward the bound` | `complete: true` where `complete: false` was expected (every small row fit) |
| O58's CONTROL through the sweep: in `lib.mjs`'s `planSegment`, change `reducer = EXPORT_REDUCERS.perCopy, takenBefore = false })` to `reducer = EXPORT_REDUCERS.shortestHome, takenBefore = false })` | `a 30-day home that holds only a swap copy` | `the node-shortest rule would have exported both rows now: expected { state: 'written', … } to deeply equal { state: 'nothing-due', … }` |
| In `exportSelect`, delete the due-transcript phase: the `const transcripts = s.transcriptPks.all()…` line, the `for (const pk of dueTranscriptKeys(` loop below it and the five comment lines above them | `every holding file is gone` | `expected { state: 'nothing-due', … } to match object { state: 'written', … }` |
| In `exportSelect`, narrow the due-transcript phase to transcripts with no file on disk: change `dueTranscriptKeys({ nowMs, homeRetentionDays: homeDays, transcripts })` to `dueTranscriptKeys({ nowMs, homeRetentionDays: homeDays, transcripts: transcripts.filter((t) => !t.files.some((f) => f.present)) })` | `an older file of that transcript stays on disk` | `rows: 1` where `rows: 2` was expected (only row 1, below the cutoff, is offered) |

The quoted reds are what the assertions print, not a contract; any red on the named case is the measurement. After the last restore, run the whole file once more and see it green, and `cmp "$SCRATCH/sweep.mjs.t5" ccd/history/sweep.mjs` and `cmp "$SCRATCH/lib.mjs.t5" ccd/history/lib.mjs` print nothing.

- [ ] **Step 9: Commit**, from the repository root, on this workspace's branch:

```bash
git add ccd/history/sweep.mjs server/test/historyHelpers.ts server/test/history-export.test.ts .github/workflows/ci.yml
git commit -m "feat(history): the sole-copy export pass — due rows into one segment through store.mjs, published by link, marked after it (W1-B4)"
```

### Task 6: sweep: exportStep in the tick: the hourly cadence, the home-filesystem preflight, never on the recover arm; the history-export lifecycle row; the B4 blast radius over the B1/B2 suites

**Files:**
- Modify: `ccd/history/sweep.mjs` (by content; R1):
  - insert one block directly ABOVE the entry guard `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`, below Task 5's block;
  - in `tick` (B1 Task 24's listing, extended by B2 and possibly B3), insert four lines (three of comment, one of code) directly above the line `  // <<< history tick steps`, which stays where it is;
  - in `tick`'s doc comment, one numbered item, `exportStep`, directly below the `markScan` item, every item renumbered: B1's F39 describe in `history-sweep.test.ts` requires the new `exportStep(db` call to be listed in body order;
  - merge the names Step 5's script prints into the `from './lib.mjs'` and `from './store.mjs'` import statements.
- Modify: `server/test/fixtures/history/preload-statfs.mjs` (B1-created; B1 Tasks 19 and 26 and B2 appended to it): append one delimited block at the end of the file.
- Modify: `server/test/history-export.test.ts` (Task 5): in place, its `./historyHelpers.js` import list gains `runDriver` and `recoverRow`, and its `interface SweepExport` gains one member; append the module-scope helpers `driverAt` and `passAt` and one describe at the end of the file.
- Modify: `shared/lifecycle.ts`: insert one row directly below B2's `history-backups` row (its last line ends `removes a stale .tmp first)' },`), before the closing `];`. Measured at B1's tip (561609adc), `];` is `shared/lifecycle.ts:78`, below B1's six history rows (the last, `history-switches`, ends at `:77`); the B2 and B3 rows land above it. If B3 has merged, its two rows may sit between B2's row and `];`; this row still goes directly below B2's.
- Modify: `server/test/lifecycle.test.ts` (inside `describe('shared/lifecycle.ts — the policy §4(a) manifest'`, in B1 Task 33's block): the `HISTORY_LANDED` line in place, and one case directly below B2's `it('declares history-backups: …` case (below that case's closing `  });`).
- Modify, only as Step 7 finds: the B1/B2 test files whose cases the export now reaches, each change listed by file and case title in the commit body.

**Interfaces:**
- Consumes:
  - Task 1 (`lib.mjs`): `decideExportPass({ nowMs, lastPassMs: number | null, firstTickMs: number | null }): 'run' | 'wait'`; `planExportRoom(free): { admit: boolean; word: 'ok' | 'low-disk' | 'unsettled'; needBytes: number | null }`, whose input is `statfsWithDeadline`'s answer (`{ state: 'ok', bytes, fsSize } | { state: 'unsettled' } | { state: 'threw' }`); `EXPORT_DIR`; `HEALTH_META.exportPassMs`, `HEALTH_META.exportPaused` (`'export_paused'`).
  - Task 5 (`sweep.mjs`): `exportPass(db, ctx)`, `ExportPassResult`, `ensureExportDirs`, `exportDirFor`, `EXPORT_ATTEMPT_META`.
  - Task 4 (`store.mjs`): `removeStaleSegmentTemps(dir)` (`[]` for an absent directory; any other listing failure throws; each name removed by type through B1's `removeEntry`, so a non-empty directory planted at a temp's name is kept and not listed, and never makes this step throw on every tick).
  - B1 `sweep.mjs`: `statfsWithDeadline(p, ms, statfs?)` (the statfs seam receives the path), `tick`'s `// <<< history tick steps` marker, `passCtx`'s `deps`, `countOutside(db, name)`; B1 `lib.mjs`: `STATFS_DEADLINE_MS`; B1 `store.mjs`: `withTx`, `bump`, `getMeta`, `setMeta`.
  - B2: `isRecovering` and the recover arm (`recoverPass` never calls `tick`); `historyHelpers`' `recoverRow(box)`; `passCtx`'s budget from `deps.budget`.
  - B1 test side: `runDriver(box, deps, args?, opts?)` with `DriverDeps.offsetMs` and `DriverDeps.sizeBytes` (the measured-size seam that puts a store at its cap); the statfs preload's top-level `fs`, `real`, `answer` and `syncBuiltinESMExports`; `lifecycle.test.ts`'s `HISTORY_ROWS_BY_PR` (`B4: ['history-export']`) and `HISTORY_LANDED`; `LifecycleClass` (`shared/lifecycle.ts:5-14` at B1's tip, 561609adc: `name`, `root`, `pattern`, `creators`, `collector`, `bound`, `tier`, `ruling`).
- Produces:
  - `sweep.mjs`: `export async function exportStep(db, ctx): Promise<ExportPassResult | null>`: null when the cadence waits; `{ state: 'paused', … }` when the preflight refuses; otherwise `exportPass`'s answer. `ExportPassResult['state']` gains `'paused'`.
  - `tick` runs `if (ctx.ids !== null) await exportStep(db, ctx);` as its last step inside the `>>> history tick steps` markers, after `recordTick` and `markScan`.
  - Counter `export_paused_low_disk`. meta `HEALTH_META.exportPaused`: the `planExportRoom` word (`'low-disk'` or `'unsettled'`) while paused, `''` as soon as a preflight admits, whatever the pass then answers (`held`, `failed` and `no-horizon` included). Task 9 reads it for `status --json` and doctor's WARN.
  - Before the probe, once the cadence says run, `exportStep` removes every stale segment temp under `export/<store_id>/` (Task 4's `removeStaleSegmentTemps`; a failure counts `export_write_failed` and the step goes on), so a pause never keeps a killed pass's temp on the filesystem it measures. Task 5's `exportPass` no longer removes them itself.
  - `history-export.test.ts`, module scope: `driverAt(box, min, { env?, preloads?, sizeBytes? }): DriverResult` and `passAt(box, min, { env?, sizeBytes? }): void` (asserts exit 0). Tasks 7 and 8 use both.
  - `preload-statfs.mjs`: `HISTORY_TEST_STATFS_EXPORT = hang | throw | <bavail>:<size>`, answering only a statfs whose path holds `/.ccrc/history/export`.
  - `shared/lifecycle.ts`: the `history-export` row. `lifecycle.test.ts`: `HISTORY_LANDED` gains `'B4'`, and the case `declares history-export: an O class the sweep writes through store.mjs, kept with the store`.

**Spec:**
- §9.2 step 6 (the export pass after the ticks row and the tick record, "at most once an hour", *chosen*); §9.15 "Preflight" (`fs.promises.statfs` on `~/.ccrc/history/export` under the 5 s deadline, `planCopy` with that filesystem's own threshold and the segment bound as the size; "A refusal skips the pass: `export_paused_low_disk`, doctor WARN. Capture is unaffected."); §9.3 (the floor on its own filesystem; "The journal and the export live on the home filesystem, not under `db/`"); §9.4 (the `history-export` row, Lands in B4); §9.10 "Export preflight"; §13 (the export never under `db/`).
- Pins: **O40**, spawned (a home-filesystem statfs seam below its floor → no segment, `export_paused_low_disk` +1, ingest proceeds in the same tick; the verdict from `planCopy` with the segment bound as the size, RC9). Doctor's WARN clause is Task 9's. **O17**'s B4 half.
- Departures: B1's D-4224 (`history-tick-order`), B1's D-4172 (`history-store-fixed-root`), B1's D-4247 (`history-test-seams-not-env`), B1's D-4179 (`history-free-space-floor`), ⟦D:history-backup-preflight-and-rename⟧ (planCopy is the one copy preflight), ⟦D:history-export-cadence-from-first-tick⟧ (Task 1's NEW slug; this task wires it), and NEW ⟦D:history-export-outside-capture-pause⟧: §9.2 says only ingest pauses under a cap or floor pause and names no rule for the export; the pass runs outside the ingest gate because text keeps ageing toward its source's deletion while capture is paused, and the segment has its own floor on its own filesystem. The marks are written on `db/`, which the export's preflight never measures: one segment's mark transaction costs about its carried bytes (1–2×) in `db/`'s WAL, as B1's own `fts_indexed` sweep does. A mark that fails there leaves its rows for a later segment, and Task 7 backs that retry off (⟦D:history-export-mark-failure-backs-off⟧) rather than skip the export while `db/` is paused, which would remove the protection exactly while text ages.
- Plan choices (no departure): the cadence's last-pass time is the later of `HEALTH_META.exportPassMs` and Task 5's attempt clock; a paused attempt moves neither, so a pause retries every tick (one statfs); an admitting preflight clears the pause at once, so a pass that is then held or fails never leaves a stale `export-paused-low-disk` WARN pointing at room that is already free; stale temps go before the probe, never after an admit; `lifecycle.ts`'s creators read `ccd/history/sweep.mjs (through store.mjs)`, B1's `history-store` spelling of the spec row's "`sweep.mjs` (through `store.mjs`)", rather than a bare `['ccd/history/sweep.mjs']`.
- **Choices citing B1's departures** (no new departure):
  - B1's D-4224 (`history-tick-order`): `exportStep` is the tick's last step inside the tick-steps markers, after the ticks row and the tick record (`recordTick`, `markScan`), and never on the recover arm: that arm runs `recoverPass` in place of `tick` (B2 Task 25), so no export pass runs while a recovery step is registered.
  - B1's D-4172 (`history-store-fixed-root`): the export lives under the fixed root, `~/.ccrc/history/export/<store_id>/`, on the home filesystem, never under the symlinkable `db/`; the preflight measures that filesystem.
  - B1's D-4179 (`history-free-space-floor`): the preflight applies the floor's formula to the home filesystem (Task 1's `planExportRoom`), and a pause there is the export's own (`export_paused_low_disk`); the store's floor on `db/` does not gate it.

- [ ] **Step 1: Give the spawned passes an export filesystem of their own.** Append to the end of `server/test/fixtures/history/preload-statfs.mjs`:

```js
// ── W1-B4 Task 6: the export's own filesystem (spec §9.15 "Preflight"; O40) ─────────────────────────────────────────
// HISTORY_TEST_STATFS_EXPORT = hang | throw | <bavail>:<size>: a statfs whose path lies under /.ccrc/history/export
//   answers as given; every other statfs answers as the blocks above say. So the export's probe on the home filesystem
//   and the store's probe on db/ can disagree, as they do when db/ is a link onto a volume. Unset: the export's probe
//   answers as every other call does (one filesystem). The real statfs runs first in the <bavail>:<size> mode, as in
//   this file's first block, so a missing export directory still answers ENOENT.
// This block reuses the file's top-level `fs`, `real`, `answer` and `syncBuiltinESMExports` (Task 19's precedent); its
// own names carry the Exp suffix.
{
  const modeExp = process.env.HISTORY_TEST_STATFS_EXPORT ?? '';
  if (modeExp !== '') {
    const fixedExp = /^([0-9]+):([0-9]+)$/.exec(modeExp);
    if (!fixedExp && modeExp !== 'hang' && modeExp !== 'throw') {
      throw new Error(`preload-statfs: HISTORY_TEST_STATFS_EXPORT=${modeExp} is not hang, throw or <bavail>:<size>`);
    }
    const innerExp = fs.promises.statfs;
    fs.promises.statfs = async function statfsExportExp(p, opts) {
      if (!String(p).includes('/.ccrc/history/export')) return innerExp(p, opts);
      if (modeExp === 'hang') return new Promise(() => {});
      if (modeExp === 'throw') throw Object.assign(new Error(`EIO: i/o error, statfs '${p}'`), { code: 'EIO' });
      await real(p, opts);
      return answer(Number(fixedExp[1]), Number(fixedExp[2]));
    };
    syncBuiltinESMExports();
  }
}
```

- [ ] **Step 2: Write the failing tests.** In `server/test/history-export.test.ts`:
  - add `runDriver` and `recoverRow` to the `./historyHelpers.js` import list (both are already that module's: B1 Task 24 and B2 Task 25);
  - in `interface SweepExport`, add this member below `exportPass(…)`:

```ts
  exportStep(db: DatabaseSync, ctx: Record<string, unknown>): Promise<PassResult | null>;
```

Then append to the end of the file. `driverAt` and `passAt` sit at module scope, because Tasks 7 and 8 use them too:

```ts
/** One pass through the run-pass driver (B1 Task 24), its clock `min` minutes ahead of the real one. `preloads`, when
 *  given, replaces the driver's default list, so it names the statfs preload itself. */
const driverAt = (box: HistoryBox, min: number, o: { env?: Record<string, string>; preloads?: string[]; sizeBytes?: number } = {}) =>
  runDriver(box, { offsetMs: min * MIN, sizeBytes: o.sizeBytes }, [], { env: o.env ?? {}, preloads: o.preloads });
/** The same pass, which must exit 0. */
const passAt = (box: HistoryBox, min: number, o: { env?: Record<string, string>; sizeBytes?: number } = {}): void => {
  const r = driverAt(box, min, o);
  expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
};

describe('the export in the tick (W1-B4 Task 6; spec §9.2 step 6, §9.15 "Preflight")', () => {

  it('the cadence: no pass in the store\'s first hour, one after it, then at most hourly; a pass that finds nothing due still moves the clock', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-cadence-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    passAt(box, 30);
    expect(segmentsOf(box), 'a pass inside the first hour after the store\'s first tick').toEqual([]);
    expect(metaOf(box, HEALTH_META.exportPassMs)).toBeNull();
    const t65 = Date.now();
    passAt(box, 65);
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`]);
    const first = Number(metaOf(box, HEALTH_META.exportPassMs));
    expect(first).toBeGreaterThanOrEqual(t65 + 65 * MIN);
    passAt(box, 95);
    expect(metaOf(box, HEALTH_META.exportPassMs), 'a second pass inside the hour').toBe(String(first));
    const t130 = Date.now();
    passAt(box, 130);
    expect(segmentsOf(box), 'nothing new was due').toEqual([`1.${ids.writer}.db`]);
    expect(Number(metaOf(box, HEALTH_META.exportPassMs))).toBeGreaterThanOrEqual(t130 + 130 * MIN);
  }, 300_000);

  it('O40: below the home filesystem\'s own floor the pass is skipped (no segment, export_paused_low_disk +1, the pause in meta) and the same pass still ingests', () => {
    const { box, transcript } = ingestedBox('ccrc-history-export-o40-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    fs.appendFileSync(transcript, `${JSON.stringify(row(3, 'three, written after the last pass', HOUR))}\n`);
    passAt(box, 65, { env: { HISTORY_TEST_STATFS_EXPORT: `1000:${10 * GIB}` } });
    expect(segmentsOf(box)).toEqual([]);
    expect(counters(box)['export_paused_low_disk']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportPaused)).toBe('low-disk');
    expect(metaOf(box, HEALTH_META.exportPassMs), 'a pause is not a pass').toBeNull();
    expect(q(box, 'SELECT count(*) AS n FROM entries')[0]!['n'], 'capture is unaffected: the appended row was ingested in the same pass').toBe(3);
  }, 300_000);

  it('O40: an export probe that never settles is a pause at its 5 s deadline, and the pass ends and exits 0', () => {
    const { box } = ingestedBox('ccrc-history-export-hang-', [row(1, 'one', DAY)]);
    const t = Date.now();
    passAt(box, 65, { env: { HISTORY_TEST_STATFS_EXPORT: 'hang' } });
    const ms = Date.now() - t;
    expect(ms, 'the probe was not bounded by its deadline').toBeLessThan(60_000);
    expect(ms, 'the export never probed').toBeGreaterThanOrEqual(4_500);
    expect(segmentsOf(box)).toEqual([]);
    expect(counters(box)['export_paused_low_disk']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportPaused)).toBe('unsettled');
  }, 300_000);

  it('O40 / RC9: the preflight statfs-es ~/.ccrc/history/export and never db/, even with db/ a link onto a roomier volume; a refusal writes nothing, and the next preflight that admits clears the pause, even when its pass is then held', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vol-', [row(1, 'one', DAY), row(2, 'two', DAY)], {
      plant: (b) => {
        // db/ a link onto a "volume", made before the first install as §9.3 "Store location" says, target 0700
        const vol = path.join(b.home, 'vol', 'history-db');
        fs.mkdirSync(vol, { recursive: true, mode: 0o700 });
        fs.chmodSync(vol, 0o700);
        fs.mkdirSync(b.root, { recursive: true, mode: 0o700 });
        fs.symlinkSync(vol, path.join(b.root, 'db'));
      },
    });
    expect(fs.lstatSync(path.join(box.root, 'db')).isSymbolicLink(), 'the fixture must store through a linked db/').toBe(true);
    const seen: string[] = [];
    const statfs = async (p: string): Promise<{ bsize: number; bavail: number; blocks: number }> => {
      seen.push(p);
      return p.endsWith('/export') ? { bsize: 1, bavail: 1000, blocks: 10 * GIB } : { bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB };
    };
    const later = Date.now() + 2 * HOUR;
    const r = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => later, { deps: { statfs } })));
    expect(seen, 'the export probed something other than its own directory').toEqual([path.join(box.root, 'export')]);
    expect(r).toEqual({ state: 'paused', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(segmentsOf(box)).toEqual([]);
    expect(counters(box)['export_paused_low_disk']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportPaused)).toBe('low-disk');
    expect(fs.statSync(path.join(box.root, 'export')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(exportDirOf(box)).mode & 0o777).toBe(0o700);
    const roomy = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB });
    // Room is back, and history-off is set: the preflight admits, then the pass is held before its first row.
    const off = historyPaths(box.home).off;
    fs.writeFileSync(off, '');
    const held = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => later, { deps: { statfs: roomy } })));
    expect(held).toEqual({ state: 'held', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
    expect(metaOf(box, HEALTH_META.exportPaused), 'an admitting preflight clears the pause, even when its pass is held').toBe('');
    fs.rmSync(off);
    const ok = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => later, { deps: { statfs: roomy } })));
    expect(ok).toMatchObject({ state: 'written', segment: `1.${ids.writer}.db` });
    expect(metaOf(box, HEALTH_META.exportPaused)).toBe('');
  }, 120_000);

  it('outside the capture pause: a store at its cap pauses ingest and still exports', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-cap-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    passAt(box, 65, { sizeBytes: 60 * GIB });   // over the default 50 GiB cap
    expect(counters(box)['capture_paused_at_cap'], 'the fixture must put the store at its cap').toBeGreaterThanOrEqual(1);
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`]);
  }, 300_000);

  it('never on the recover arm: while a recovery step is registered no export pass runs; the first tick after it completes exports', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-recover-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const db = openWriter(historyPaths(box.home).dbFile);
    try {
      // a recovery step as a restore's commit registers one (B2 Task 25's registerRecovery)
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
    } finally {
      closeWriter(db);
    }
    passAt(box, 65);
    expect(segmentsOf(box), 'an export pass ran on the recover arm').toEqual([]);
    expect(recoverRow(box), 'the fixture\'s recovery step must complete in one pass').toMatchObject({ completed_ms: expect.any(Number) });
    passAt(box, 66);
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`]);
  }, 300_000);
});
```

In `server/test/lifecycle.test.ts`, replace the `HISTORY_LANDED` line in place: append `'B4'` as its last member. On a base without B3 it then reads:

```ts
  const HISTORY_LANDED: readonly HistoryPr[] = ['B1', 'B2', 'B4'];
```

and with B3 merged, `['B1', 'B2', 'B3', 'B4']`. Then insert directly below B2's `it('declares history-backups: …` case:

```ts
  it('declares history-export: an O class the sweep writes through store.mjs, kept with the store', () => {
    const c = LIFECYCLE.find((x) => x.name === 'history-export');
    expect(c, 'shared/lifecycle.ts declares no history-export class').toBeTruthy();
    expect(c!.pattern).toBe('O');
    expect(c!.creators).toEqual(['ccd/history/sweep.mjs (through store.mjs)']);
    expect(c!.collector).toBeNull();
    expect(c!.ruling).toContain('kept with the store; removed only with it, or by hand by segment');
    expect(c!.ruling).toContain('stale .tmp');
    expect(c!.root).toContain('~/.ccrc/history/export/<store_id>/<seq>.<writer>.db');
    expect(c!.tier).toContain('256 MiB');
  });
```

- [ ] **Step 3: Run them and see them fail.** From inside `server/`, each in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts -t 'the export in the tick'
./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'policy'
```

Expected:
- the cadence, O40 (both), cap and recover-arm cases red on their first assertion about the export (no tick runs it yet: `expected [] to deeply equal [ '1.<writer>.db' ]`, `expected undefined to be 1`, or for the hang case `the export never probed`);
- the volume case red with `TypeError: SW.exportStep is not a function`;
- lifecycle: the O17 case red with `history-export lands in B4, which has landed, and shared/lifecycle.ts declares no such class: expected false to be true`, and the new case with `shared/lifecycle.ts declares no history-export class: expected undefined to be truthy`.

The quoted reds are measured when the step runs, not contractual.

- [ ] **Step 4: Write exportStep and wire it.** In `ccd/history/sweep.mjs`, insert directly ABOVE the entry guard, below Task 5's block:

```js
// ── W1-B4 Task 6: the export in the tick (spec §9.2 step 6, §9.15 "Preflight") ─────────────────────────────────────

/** §9.2 step 6, last (W1-B4): the export pass, at most once an hour by its own clock, anchored on the store's first tick
 *  (lib decideExportPass; ⟦D:history-export-cadence-from-first-tick⟧), behind a preflight on the HOME filesystem (§9.15
 *  "Preflight"): statfs on ~/.ccrc/history/export under STATFS_DEADLINE_MS, then lib planExportRoom, which is planCopy
 *  with that filesystem's own floor and the segment bound as the size (RC9; ⟦D:history-backup-preflight-and-rename⟧).
 *  Never db/, which may be a link onto a volume whose floor the tick already guards (§9.3; D-4179).
 *  A refusal, or a probe that does not settle, skips the pass: counted export_paused_low_disk and kept in meta for doctor
 *  (HEALTH_META.exportPaused, planExportRoom's word) until a preflight admits. Capture is unaffected, and the next tick
 *  retries: a pause is not a pass. A stale temp is removed before the probe, so a pause never keeps one. A pass that
 *  fails with a caught error counts for the cadence (Task 5's attempt clock), so it retries hourly. Null when the
 *  cadence waits. */
export async function exportStep(db, ctx) {
  const nowMs = ctx.now();
  const msOf = (k) => {
    const v = getMeta(db, k);
    return v !== null && /^[0-9]{1,16}$/.test(v) ? Number(v) : null;
  };
  const lastPass = msOf(HEALTH_META.exportPassMs);
  const lastAttempt = msOf(EXPORT_ATTEMPT_META);
  const first = db.prepare('SELECT ts_ms FROM ticks ORDER BY tick_id LIMIT 1').get();
  const verdict = decideExportPass({
    nowMs,
    lastPassMs: lastPass === null ? lastAttempt : lastAttempt === null ? lastPass : Math.max(lastPass, lastAttempt),
    firstTickMs: first === undefined ? null : Number(first.ts_ms),
  });
  if (verdict === 'wait') return null;
  // A directory that cannot be made (EACCES, EROFS, ENOSPC on the home filesystem) is a pause, never a throw out of the
  // tick: the probe below then fails on the missing directory, and planExportRoom answers low-disk.
  try { ensureExportDirs(ctx.paths, ctx.ids.storeId); } catch { /* the probe decides */ }
  // Every temp is stale here: only a pass under the shim's lock writes one (the lifecycle row's "the writer removes a
  // stale .tmp itself"). It goes BEFORE the probe, so a pause never keeps a killed pass's temp on the filesystem whose
  // room the probe measures. A removal that fails is counted and the step goes on.
  try { removeStaleSegmentTemps(exportDirFor(ctx.paths, ctx.ids.storeId)); } catch { countOutside(db, 'export_write_failed'); }
  const probe = await statfsWithDeadline(`${ctx.paths.root}/${EXPORT_DIR}`, STATFS_DEADLINE_MS, ctx.deps.statfs);
  const room = planExportRoom(probe);
  if (!room.admit) {
    withTx(db, 'NORMAL', () => {
      bump(db, 'export_paused_low_disk');
      setMeta(db, HEALTH_META.exportPaused, room.word);
    });
    return { state: 'paused', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false };
  }
  // An admitting preflight ends a pause, whatever the pass then answers (held, failed or no-horizon included).
  if ((getMeta(db, HEALTH_META.exportPaused) ?? '') !== '') withTx(db, 'NORMAL', () => { setMeta(db, HEALTH_META.exportPaused, ''); });
  return exportPass(db, ctx);
}
```

In `tick`, insert directly above the line `  // <<< history tick steps`:

```js
  // §9.2 step 6, last (W1-B4): the export pass, after the ticks row and the tick record, at most once an hour (exportStep).
  // It is OUTSIDE the ingest gate: under a cap or db-floor pause text keeps ageing toward its source's deletion, and the
  // export has its own floor, on the home filesystem (⟦D:history-export-outside-capture-pause⟧).
  if (ctx.ids !== null) await exportStep(db, ctx);
```

Then name the step in `tick`'s doc comment, the `/**` directly above `export async function tick(db, ctx) {`. B1's `history-sweep.test.ts` describe `tick()'s docstring names its steps in the order the body runs them (review 316 F39)` reads every `name(db` call in the body (comments stripped; `bump`, `countOutside` and `scanDue` excepted) and requires each to be a numbered item, in the order the body first calls them; `exportStep(db` is a new call, so `every step the body calls with db is listed` reds without this edit. The body calls it after `markScan` and before anything below the `// <<< history tick steps` marker (B3's `ensureHistoryDirs`, if B3 has merged), so its item goes directly below the `markScan` item. From the repository root:

```bash
python3 - <<'PYEOF'
import re
p = 'ccd/history/sweep.mjs'
t = open(p, encoding='utf8').read()
at = t.index('export async function tick(db, ctx) {')
start = t.rindex('/**', 0, at)
lines = t[start:at].split('\n')
item = re.compile(r'^ \*\s*\d+\. `([A-Za-z]\w*)`')
cont = re.compile(r'^ \*\s{4,}\S')                   # an item's continuation line: four or more spaces after the `*`
names = [m.group(1) for l in lines if (m := item.match(l))]
assert names.count('markScan') == 1 and names.count('deriveNodes') == 1 and 'exportStep' not in names, names
i = next(k for k, l in enumerate(lines) if (m := item.match(l)) and m.group(1) == 'markScan')
while i + 1 < len(lines) and cont.match(lines[i + 1]) and not item.match(lines[i + 1]):
    i += 1
last = names[-1] == 'markScan'
if last:
    assert lines[i].endswith('.'), lines[i]
    lines[i] = lines[i][:-1] + ';'
lines[i + 1:i + 1] = [
    ' * 0. `exportStep`: §9.2 step 6, last (W1-B4): the export pass, at most once an hour, with a writer token only,',
    ' *     outside the ingest gate, behind its own floor on the home filesystem' + ('.' if last else ';'),
]
n = 0
for k, l in enumerate(lines):
    if item.match(l):
        n += 1
        lines[k] = re.sub(r'^ \*\s*\d+\.', ' *' + f'{n:>3}' + '.', l, count=1)
t = t[:start] + '\n'.join(lines) + t[at:]
open(p, 'w', encoding='utf8').write(t)
print(f'tick doc comment: {n} steps, exportStep at {names.index("markScan") + 2}')
PYEOF
```

Expected: `tick doc comment: 19 steps, exportStep at 19` on a base with B1 and B2 only (B1's 16; B2's Task 29 `beltNodesStep` at 7 and Task 8 `deriveNodes` at 15; `markScan` at 18), or `tick doc comment: 23 steps, exportStep at 22` once B3 has merged (its `cardStep`, `withdrawCards` and `collectPurgedHistoryFiles` above `markScan`, its `ensureHistoryDirs` last). An assertion error means the list is not one this plan knows: read `tick` and its doc comment, place the item where the body calls `exportStep`, and report it. The items keep B1's form, ` *  9.` below ten and ` * 10.` from ten.

`noteExportPassDone` (Task 5) is not edited here: the pause ends at the admit above, not at the end of a pass.

In `shared/lifecycle.ts`, insert directly below B2's `history-backups` row:

```ts
  // ccrc history, W1-B4 (spec 2026-10-05 §9.4, §9.15): the sole-copy export, one immutable segment per pass on the home
  // filesystem, never under db/; kept with the store like the journal.
  { name: 'history-export', root: '~/.ccrc/history/export/<store_id>/<seq>.<writer>.db, and its .<seq>.<writer>.db.tmp while one is written', pattern: 'O',
    creators: ['ccd/history/sweep.mjs (through store.mjs)'], collector: null,
    bound: 'store lifetime', tier: 'about the store\'s growth rate once text nears its retention (inferred); at most one segment of about 256 MiB an hour; paused below the home filesystem\'s floor',
    ruling: 'kept with the store; removed only with it, or by hand by segment (the writer removes a stale .tmp itself)' },
```

- [ ] **Step 5: Add the imports.** From the repository root, run Task 5 Step 6's script with this `want`:

```python
want = {
    './lib.mjs': ['decideExportPass', 'planExportRoom', 'STATFS_DEADLINE_MS', 'EXPORT_DIR', 'HEALTH_META'],
    './store.mjs': ['removeStaleSegmentTemps', 'withTx', 'bump', 'getMeta', 'setMeta'],
}
```

Add every printed name to that module's import statement, re-run until both lines say `(nothing)`, then run Task 5 Step 6's guard checks (`grep -c`, the `sed`, the top-level-await `grep`, `node --check`).

- [ ] **Step 6: Run and see it pass.** From inside `server/`, each in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts
./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'policy'
./node_modules/.bin/vitest run test/history-sweep.test.ts -t "tick()'s docstring"
node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected: green, B1's three F39 docstring cases included (without Step 4's doc item, `every step the body calls with db is listed` reds with `expected [ 'exportStep' ] to deeply equal []`), Task 5's cases included (every `ingestedBox` pass runs in the store's first hour, so the tick's export waits there); tsc prints nothing.

- [ ] **Step 7: The blast radius over the B1 and B2 suites.** Every pass whose clock crosses its store's first hour now exports. From inside `server/`, list the history test files present on this base, then run EACH ALONE in the foreground (timeout ≥ 600000 ms per command, never backgrounded, never several files in one call):

```bash
ls test/history-*.test.ts
./node_modules/.bin/vitest run test/<one file from the list>.test.ts
./node_modules/.bin/vitest run test/measure-history.test.ts
./node_modules/.bin/vitest run test/install-history-skill.test.ts
./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history'
./node_modules/.bin/vitest run test/ci-pipeline.test.ts
./node_modules/.bin/vitest run test/lifecycle.test.ts
./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t history
./node_modules/.bin/vitest run test/ccrc-install.test.ts -t history
./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts -t history
```

Record every red case (file and title). Then, for each:
- **A red naming something the export wrote**: a segment or temp under `export/`, an `exported_ms`/`exported_seg` value, `export_paused_low_disk` or `export_write_failed` in an exact counters map, `export_pass_ms`/`export_seq`/`export_paused`/`export_attempt_ms` (and, from Tasks 7 and 8, `export_mark_fails`, `export_marks_checked_ms`, `export_marks_checked_binds`) in an exact meta listing, or a census `export_due` lower than the case expects after a pass clock past the first hour. This is the B4 build doing what §9.15 "The pass" says, and it gets one of two fixture changes, in that case only:
  - when the case is about something else (a census count, a drain, an ingest), reads only individual counters, meta keys or census counts, and only its pass clock crosses the hour: pass `HISTORY_TEST_STATFS_EXPORT: '0:1099511627776'` in that spawn's env (`runDriver`'s `opts.env`, `runSweep`'s `env`). The export then pauses before it selects, writes or marks anything, so no row or blob is marked and no segment exists, which is what such a case was written against. A pause is NOT invisible, though: it makes `export/` and `export/<store_id>/`, adds 1 to `export_paused_low_disk` on every tick whose cadence says run, writes meta `export_paused`, and from Task 9 on WARNs `export-paused-low-disk` in status and doctor. So never use it in a case that reads an exact counters map, an exact meta listing, a listing of `~/.ccrc/history`, or status/doctor health after the hour, and do not assert the pause where it is used;
  - when the case asserts an exact map, a listing or health that the export legitimately joins, or that the first rule would leave a trace in: add the export's entry to the expectation, with a one-line comment citing §9.15 "The pass" or "Preflight", or, when the hour is not what the case tests, move its pass clock inside the store's first hour.
- **A red in a file CLAUDE.md lists as a load flake** (`session-hook`, `ccd-session-state`, …): re-run it alone; green alone is a flake.
- **Any other red** is a B4 defect: fix `ccd/history/sweep.mjs`, never the test, and re-run that file.
- Never delete an assertion and never weaken a guard. Re-run every changed file alone until green.

One red is known in advance, read (not run) from B1's tip (561609adc): `history-op.test.ts`, describe `'O38: the export\'s due rule (B1 half)'`. Its `census(box, MS, k)` helper (module-local, directly below `censusBox`) is `runDriver(box, { offsetMs: k * 31 * MIN, managedSettings: MS })` with no `opts`, and its cases read `export_due` / `export_overdue` exactly while only the pass clock crosses the hour: at k=2 the clock is 62 min, past the store's first tick plus an hour, so the export runs and takes due blobs before the census counts. Expect three cases to red until the helper changes: `'a home without the key: 30, horizon 0, everything due, and retention-lowered names that home'` (its `census(box, MS, 2)` then `due` 2), `'a managed-settings file with 90 under homes of 180 gives 90, and a managed-settings.d/ drop-in with 60 gives 60'` (k=2, `due` 4) and `'overdue by the file clock: a due blob whose holding file is gone, or past its mtime plus its home\'s retention, FAILs; fresh files never'` (k=2, `export_overdue` `'2'`, should a due blob be exported first). The counts are B1's; B2's per-copy task re-ran these cases, so read them on the base. The fix is rule 1, applied in the helper, since the cases cannot reach the spawn's env: give `census` a 4th `runDriver` argument (after an empty `args`), `runDriver(box, { offsetMs: k * 31 * MIN, managedSettings: MS }, [], { env: { HISTORY_TEST_STATFS_EXPORT: '0:1099511627776' } })`. Cases at k=1, or at a fixed 31–34 min offset, stay inside the first hour and are unaffected; none of the helper's cases reads an exact counters map, a meta listing or health, so rule 1's limits hold.

- [ ] **Step 8: Mutations — each new guard reds its case.** From the repository root: `cp ccd/history/sweep.mjs "$SCRATCH/sweep.mjs.t6"; cp shared/lifecycle.ts "$SCRATCH/lifecycle.ts.t6"` (`SCRATCH` as Task 5 Step 8 set it: `$PWD/.superpowers/sdd/history-w1-b4/scratch`). Apply each by hand, run from inside `server/` with the filter shown, see it red, restore with `cp` from the scratch copy, and see the file green again after the last one. Never `git stash`.

| Mutation | Run | Expected red |
|---|---|---|
| In `exportStep`, delete the line `  if (verdict === 'wait') return null;` | `vitest run test/history-export.test.ts -t 'the cadence'` | `a pass inside the first hour after the store's first tick: expected [ '1.<writer>.db' ] to deeply equal []` |
| In `exportStep`, change `` `${ctx.paths.root}/${EXPORT_DIR}` `` to `ctx.paths.dbDir` | `-t 'never db/'` | `the export probed something other than its own directory` |
| In `tick`, change `if (ctx.ids !== null) await exportStep(db, ctx);` to `if (ctx.ids !== null && ctx.ingest) await exportStep(db, ctx);` | `-t 'outside the capture pause'` | `expected [] to deeply equal [ '1.<writer>.db' ]` |
| In `exportStep`, change `if (!room.admit) {` to `if (false) {` | `-t 'own floor the pass is skipped'` | `expected [ '1.<writer>.db' ] to deeply equal []` |
| In `exportStep`, delete the admit's clear (the line that begins `  if ((getMeta(db, HEALTH_META.exportPaused) ?? '') !== '')`) | `-t 'never db/'` | `an admitting preflight clears the pause, even when its pass is held: expected 'low-disk' to be ''` |
| In `shared/lifecycle.ts`, delete the `history-export` row (its comment lines and its four lines) | `vitest run test/lifecycle.test.ts -t 'policy'` | `history-export lands in B4, which has landed, and shared/lifecycle.ts declares no such class` |
| In `lifecycle.test.ts`, set `HISTORY_LANDED` back to its value before this task, with the row in place | `vitest run test/lifecycle.test.ts -t 'policy'` | `history-export lands in B4 and is declared before it` |

The never-on-the-recover-arm case pins B2's structure (`recoverPass` never calls `tick`) rather than a guard this task adds; its CONTROL is a mutant that adds `await exportStep(db, ctx);` as the first statement inside `recoverPass`'s `try {`, which reds it with `an export pass ran on the recover arm`.

- [ ] **Step 9: Commit**, from the repository root:

```bash
git add ccd/history/sweep.mjs server/test/history-export.test.ts server/test/fixtures/history/preload-statfs.mjs \
  shared/lifecycle.ts server/test/lifecycle.test.ts
git commit -m "feat(history): the export in the tick — hourly from the first tick, its own home-filesystem preflight, never on the recover arm; the history-export lifecycle row (W1-B4)"
```

Add to the `git add` line every B1/B2 test file Step 7 changed, and name each changed case in the commit body with the rule from Step 7 that it took.

### Task 7: sweep: crash and collision safety (spawned, and in-process for a busy): kills mid-write and between link and marks, a counter behind the directory, the EEXIST retry, a failed segment write, a failed or busy mark

**Files:**
- Modify: `ccd/history/sweep.mjs` (by content; R1):
  - in Task 5's `exportPass`, replace its two publish lines (the one that begins `const linked = publishSegment(seg, dir, name);` and the one after it that begins `if (linked !== 'linked') throw`) with the retry loop of Step 4; replace its line `  let seg = null;` with two lines; replace the four lines of its catch from `    if (isBusy(e)) throw e;` to the one that begins `    try { setMeta(db, EXPORT_ATTEMPT_META,`;
  - in Task 5's `markExported`, insert three lines (one of comment, two of code) directly below `    setMeta(db, EXPORT_SEQ_META, String(m.seq));`;
  - in Task 6's `exportStep`, insert one line directly below `    firstTickMs: first === undefined ? null : Number(first.ts_ms),`;
  - insert two consts with their doc comments directly below Task 5's `const EXPORT_ATTEMPT_META = 'export_attempt_ms';`;
  - merge `setSegmentSeq` into the `from './store.mjs'` import statement and `exportPassIntervalMs`, `exportMarkFailsOf` and `decideMarkOutcome` into the `from './lib.mjs'` one.
- Modify: `server/test/history-export.test.ts`: in place, its `./historyHelpers.js` import list gains `PRELOADS`; add one import statement directly below the file's top import block; append one describe at the end of the file.

**Interfaces:**
- Consumes:
  - Task 4 (`store.mjs`): `publishSegment(seg, dir, name): 'linked' | 'exists'`. On `'exists'` it keeps the temp and the call can be made again on the same handle (its close of `seg.db` tolerates a handle it already closed); `setSegmentSeq(temp, seq)` rewrites the seq in the temp's meta; `listSegments(dir)`; `removeStaleSegmentTemps(dir)`. The segment's family insert runs the SQL text `INSERT INTO families (ord, …)`: `segmentInserts` builds it at runtime from `SEGMENT_ROW_TABLES`' table name `families`, so no source line spells `INTO families`. Step 1 measures it, because two cases fault that statement.
  - Task 5 (`sweep.mjs`): `exportPass`, its `let seq` and `let name`, `EXPORT_ATTEMPT_META`, `EXPORT_SEQ_META`, `discardSegment`, `markExported`; Task 6: `exportStep` in the tick, its cadence reading the attempt clock, and its stale-temp removal before the probe.
  - Task 1 (`lib.mjs`): `nextSegmentSeq`, `segmentName`, `segmentTempName(name)` (`.${name}.tmp`), `exportPassIntervalMs(markFails)` and `decideExportPass`'s `intervalMs`; the mark-failure decision (RD2): `exportMarkFailsOf(recorded)` and `decideMarkOutcome({ outcome: 'marked' | 'mark-failed' | 'mark-busy' | 'write-failed', recorded }): { markFails; write: string | null; intervalMs }`.
  - B1 `sweep.mjs`: `isBusy(e)` (SQLITE_BUSY by `errcode & 0xff === 5`) and its O22 rule: a busy ends the tick, and the scheduled pass exits 0; B1 `store.mjs`: `withTx(db, sync, fn)`, which runs `db.exec('BEGIN IMMEDIATE')` on the connection it is given.
  - B1 fault preloads (`server/test/fixtures/history/preload-faults.mjs`): `HISTORY_TEST_KILL=<fn>:<substring>:<nth>[:before|:after]` (SIGKILL at the nth call of a node:fs sync function whose first argument holds `<substring>`) and `HISTORY_TEST_KILL_SQL=<substring>` (SIGKILL when a statement whose SQL holds it runs). B2 Task 25's `HISTORY_TEST_THROW_SQL=<substring>` (every statement whose SQL holds it throws, the process lives on).
  - Task 6's `driverAt`, `passAt`; Task 5's module scope; B1 `historyHelpers`' `PRELOADS`.
- Produces:
  - In `exportPass`, the bounded EEXIST retry: on `'exists'` the pass counts `export_seq_taken`, takes `nextSegmentSeq` past every name on disk and past the number it just tried, rewrites the temp's seq with `setSegmentSeq`, and publishes again under the new name; after `EXPORT_SEQ_RETRIES` (`8`) tries it fails the pass (Task 5's catch: temp removed, `export_write_failed`, attempt clock). A name is never replaced.
  - Counter `export_seq_taken`.
  - The mark-failure backoff (⟦D:history-export-mark-failure-backs-off⟧), decided by lib (RD2): `exportPass` notes the segment's name and number once it is linked (`published = { name, seq }`); a failure after that is the mark's, printed as such. The caught failure's record asks lib `decideMarkOutcome` with `'mark-failed'` (or `'write-failed'` when nothing was linked) and writes what it answers to meta `export_mark_fails` (module-private `EXPORT_MARK_FAILS_META`) in the same small transaction as the attempt clock; `markExported` asks it with `'marked'` and writes what it answers (`'0'` over any other value, nothing over none); `exportStep` passes `exportPassIntervalMs(exportMarkFailsOf(<meta>))` to `decideExportPass` as `intervalMs`. A pass that published and could not mark therefore waits two hours, then four, at most a day, instead of publishing another copy every hour. Every caught failure still counts `export_write_failed`.
  - A busy error after the link (coordinator ruling RD3): before it is rethrown, one small transaction records meta `export_seq` = the published segment's number and the attempt clock (and whatever `decideMarkOutcome('mark-busy')` answers: nothing, a busy is the lock's), so the next tick's cadence waits instead of publishing the same rows again a minute later. If that record throws, it is swallowed, the first error still ends the tick (B1's O22), and the next pass repeats the rows into a later segment, which replay absorbs (insert-or-ignore by sha256): a residual the PR body names. No counter: a busy is not a failed write. A busy before the link records nothing, as Task 5 did.
  - Tests only otherwise, plus any fix the cases expose.

**Spec:**
- §9.15 "Write" (the temp, fsync, `link()` "which fails if that name exists (the pass then takes the next number)", never rename, never rewritten; one number space per store, past every name on disk of any writer and past meta's), "Mark" (after the link; a crash before it repeats the rows; one transaction, written on `db/`).
- §9.10 rows "Export segment" (killed mid-write → only the `.tmp`, removed by the next pass, nothing marked), "Export marks" (killed after the link, before the marks → the next pass writes them again into a new segment), "Export segment name" (a name already on disk → never overwritten).
- Pins: **O39**'s kill, counter and name halves, with its two CONTROLs (marking before the link; publishing by rename over an existing name).
- Departures: B1's D-4226 (`history-journal-writer-token`) (one number space per store, the writer in every name), ⟦D:history-sole-copy-export⟧, B1's D-4247 (`history-test-seams-not-env`) (the EEXIST case patches `node:fs` in-process with `syncBuiltinESMExports`, the B1 Task 20F idiom; the two busy cases patch `node:fs`'s `linkSync` the same way, to see the link, and the `exec` of the test's OWN writer connection, B1's O22 precedent of a setting on the test's connection; shipped code reads no seam), ⟦D:history-export-mark-failure-backs-off⟧ (Task 1's NEW slug; this task measures the outcome, records lib's answer and wires the interval).
- Coordinator rulings: RD2 (the backoff's decision is lib's `decideMarkOutcome` and `exportMarkFailsOf`; this task measures and acts) and RD3 (a busy between the link and the marks records the published seq and the attempt clock before it is rethrown). The busy is driven in-process because no preload throws a busy: B2's `HISTORY_TEST_THROW_SQL` throws `ERR_SQLITE_ERROR` with no `errcode`, which `isBusy` reads as a failure, not a busy.
- Residual (RD3, named in the PR body): when the busy record itself meets busy, nothing is recorded, the next pass publishes the same rows again into a later segment, and replay absorbs the copy (insert-or-ignore by sha256, newest-rank for rows). The second busy case pins that the first error is the one that ends the tick.
- Not done (review, recorded): a pass's attempt clock is not committed before its write, so a pass that is KILLED (the carrier's memory cap or its start timeout) is retried on the next tick rather than an hour later. No input the plan knows of makes such a kill repeat (the statfs probe is deadline-bounded, the run clock is 90 s, and Task 2's row metadata bounds a segment's rows and the pass's memory), B1's ingest retries a killed tick the same way, and the three kill cases below keep that retry.

- [ ] **Step 1: Measure the statement two cases fault.** From the repository root:

```bash
node --input-type=module -e "import { SEGMENT_DDL } from './ccd/history/store.mjs'; console.log(SEGMENT_DDL.filter((s) => s.startsWith('CREATE TABLE families (ord INTEGER PRIMARY KEY,')).length)"   # 1: Task 4's family table
grep -rn 'INTO families' ccd/history/ || echo 'no statement against history.db spells INTO families'
```

Expected: `1`, then the `echo` line: the store's own tables have no `families` (a family is a `sessions` row), so the substring faults the segment's family insert and nothing else. If the first prints 0, Task 4 named the table differently: use that insert's distinctive runtime text (`INTO <its table> (ord,`, which no statement against `history.db` holds) as the substring in Step 2's two cases, and say so in the commit body.

- [ ] **Step 2: Write the tests.** In `server/test/history-export.test.ts`, add `PRELOADS` to the `./historyHelpers.js` import list (B1 Task 14 exports it), and add this statement directly below the file's top import block:

```ts
import { syncBuiltinESMExports } from 'node:module';
```

Append to the end of the file:

```ts
describe('crash and collision safety (W1-B4 Task 7; spec §9.15 "Write", "Mark", §9.10)', () => {
  const FAULTS = [PRELOADS.statfs, PRELOADS.faults];
  /** Every blob and entry mark the store holds: none means nothing was marked. */
  const marked = (box: HistoryBox): number =>
    Number(q(box, 'SELECT (SELECT count(*) FROM blobs WHERE exported_ms IS NOT NULL) + (SELECT count(*) FROM entries WHERE exported_ms IS NOT NULL) AS n')[0]!['n']);

  it('O39: a kill mid-write leaves only the temp; nothing is marked; the next pass removes it and writes the segment', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-killw-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const name = `1.${ids.writer}.db`;
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_KILL_SQL: 'INTO families' } });
    expect(r.signal, `${r.stdout}\n${r.stderr}`).toBe('SIGKILL');
    expect(segmentsOf(box), 'a kill mid-write left more than its temp').toEqual([`.${name}.tmp`]);
    expect(marked(box)).toBe(0);
    passAt(box, 70);
    expect(segmentsOf(box), 'the stale temp outlived the next pass').toEqual([name]);
    expect(marks(box)).toEqual({ [rid(1)]: name, [rid(2)]: name });
  }, 300_000);

  it('O39: a kill just before the link leaves only the temp and nothing marked (CONTROL: marking before the link reds here)', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-killb-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const name = `1.${ids.writer}.db`;
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_KILL: `linkSync:.${name}.tmp:1:before` } });
    expect(r.signal, `${r.stdout}\n${r.stderr}`).toBe('SIGKILL');
    expect(segmentsOf(box)).toEqual([`.${name}.tmp`]);
    expect(marked(box), 'rows were marked with no segment to hold them').toBe(0);
    passAt(box, 70);
    expect(segmentsOf(box)).toEqual([name]);
    expect(marks(box)).toEqual({ [rid(1)]: name, [rid(2)]: name });
  }, 300_000);

  it('O39: a kill between the link and the marks: the next pass writes the same rows into the next segment, and both hold them', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-killa-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_KILL: `linkSync:.${s1}.tmp:1:after` } });
    expect(r.signal, `${r.stdout}\n${r.stderr}`).toBe('SIGKILL');
    expect(segmentsOf(box), 'the link happened and the temp is still there').toEqual([`.${s1}.tmp`, s1]);
    expect(marked(box)).toBe(0);
    passAt(box, 70);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s2 });
    expect(metaOf(box, 'export_seq')).toBe('2');
    const uuidsOf = (n: string): unknown[] => segmentRows(path.join(exportDirOf(box), n), 'entries').map((e) => e['uuid']).sort();
    expect(uuidsOf(s1)).toEqual([rid(1), rid(2)]);
    expect(uuidsOf(s2), 'the repeated rows are not the same as the published ones').toEqual(uuidsOf(s1));
  }, 300_000);

  it('a counter behind the directory: the next number is past every name on disk, of any writer, and past meta\'s; the name on disk is untouched', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-behind-', [row(1, 'one', DAY)]);
    const dir = path.join(box.root, 'export', ids.storeId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const theirs = path.join(dir, '5.0badc0de.db');
    fs.writeFileSync(theirs, 'a segment another writer of this store published', { mode: 0o600 });
    await onStore(box, (db) => { setMeta(db, 'export_seq', '2'); });   // a restored store whose counter is behind
    passAt(box, 65);
    expect(segmentsOf(box)).toEqual(['5.0badc0de.db', `6.${ids.writer}.db`]);
    expect(fs.readFileSync(theirs, 'utf8')).toBe('a segment another writer of this store published');
    expect(metaOf(box, 'export_seq')).toBe('6');
    expect(marks(box)).toEqual({ [rid(1)]: `6.${ids.writer}.db` });
  }, 300_000);

  it('an existing name is never replaced: a name taken between the listing and the link sends the pass to the next number (CONTROL: publishing by rename reds here)', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-eexist-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const taken = `/export/${ids.storeId}/1.${ids.writer}.db`;
    let planted = 0;
    // The name appears between the pass's listing and its publish: whichever node:fs call publishes the segment, its
    // target is planted first, exactly once. syncBuiltinESMExports() carries the patch to store.mjs's named imports.
    const plant = (to: unknown): void => {
      if (planted === 0 && String(to).endsWith(taken)) { fs.writeFileSync(String(to), 'planted by the test'); planted += 1; }
    };
    const realLink = fs.linkSync;
    const realRename = fs.renameSync;
    (fs as { linkSync: unknown }).linkSync = (from: fs.PathLike, to: fs.PathLike): void => { plant(to); realLink(from, to); };
    (fs as { renameSync: unknown }).renameSync = (from: fs.PathLike, to: fs.PathLike): void => { plant(to); realRename(from, to); };
    syncBuiltinESMExports();
    let r: PassResult;
    try {
      r = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids)));
    } finally {
      (fs as { linkSync: unknown }).linkSync = realLink;
      (fs as { renameSync: unknown }).renameSync = realRename;
      syncBuiltinESMExports();
    }
    expect(planted, 'the name was never taken: the publish reached neither link nor rename').toBe(1);
    expect(fs.readFileSync(path.join(exportDirOf(box), `1.${ids.writer}.db`), 'utf8'), 'an existing name was written over')
      .toBe('planted by the test');
    expect(r).toMatchObject({ state: 'written', segment: `2.${ids.writer}.db` });
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`, `2.${ids.writer}.db`]);
    expect(marks(box)).toEqual({ [rid(1)]: `2.${ids.writer}.db`, [rid(2)]: `2.${ids.writer}.db` });
    expect(counters(box)['export_seq_taken']).toBe(1);
    expect(metaOf(box, 'export_seq')).toBe('2');
    const h = openSegment(path.join(exportDirOf(box), `2.${ids.writer}.db`));
    try {
      expect(segmentMeta(h).seq, 'the segment\'s own number disagrees with its name').toBe(2);
    } finally {
      h.close();
    }
  }, 120_000);

  it('a failed segment write removes its temp, marks nothing, is counted, and the pass exits 0; the next tick ingests, and the export retries an hour later', () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-fail-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_THROW_SQL: 'INTO families' } });
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stderr).toContain('history-sweep: an export segment write failed and nothing was marked');
    expect(segmentsOf(box)).toEqual([]);
    expect(marked(box)).toBe(0);
    expect(counters(box)['export_write_failed']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportPassMs), 'a failed pass is not a pass').toBeNull();
    fs.appendFileSync(transcript, `${JSON.stringify(row(3, 'three', HOUR))}\n`);
    passAt(box, 100);
    expect(q(box, 'SELECT count(*) AS n FROM entries')[0]!['n'], 'the tick after a failed export still ingests').toBe(3);
    expect(segmentsOf(box), 'a failed pass retried inside its hour').toEqual([]);
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([`1.${ids.writer}.db`]);
    expect(marks(box)).toEqual({ [rid(1)]: `1.${ids.writer}.db`, [rid(2)]: `1.${ids.writer}.db`, [rid(3)]: `1.${ids.writer}.db` });
  }, 300_000);

  it('a stale temp goes before the preflight: a pass paused for room after a kill mid-write leaves no temp on the filesystem it measured (CONTROL: removing it only after an admit reds here)', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-killp-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const name = `1.${ids.writer}.db`;
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_KILL_SQL: 'INTO families' } });
    expect(r.signal, `${r.stdout}\n${r.stderr}`).toBe('SIGKILL');
    expect(segmentsOf(box)).toEqual([`.${name}.tmp`]);
    passAt(box, 70, { env: { HISTORY_TEST_STATFS_EXPORT: `1000:${10 * GIB}` } });
    expect(counters(box)['export_paused_low_disk'], 'the follow-up pass must be paused for room').toBe(1);
    expect(segmentsOf(box), 'the paused pass kept a dead segment\'s temp on the filesystem it measured').toEqual([]);
  }, 300_000);

  it('a pass that published its segment and could not mark it backs off: the next segment waits two hours, not one, so a store that cannot take its marks does not publish a copy every hour; a marked pass ends the backoff', () => {
    const { box, ids } = ingestedBox('ccrc-history-export-markfail-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    // the mark transaction's blob update throws, the stand-in for db/'s volume refusing the WAL growth (SQLITE_FULL)
    const r = driverAt(box, 65, { preloads: FAULTS, env: { HISTORY_TEST_THROW_SQL: 'UPDATE blobs SET exported_ms = ?, exported_seg = ? WHERE blob_id' } });
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stderr).toContain(`history-sweep: export segment ${s1} was published and could not be marked`);
    expect(segmentsOf(box), 'the segment was published before its mark failed').toEqual([s1]);
    expect(marked(box)).toBe(0);
    expect(counters(box)['export_write_failed']).toBe(1);
    expect(metaOf(box, 'export_mark_fails')).toBe('1');
    passAt(box, 130);   // over an hour after the failed attempt: a second copy of the same rows would be published here
    expect(segmentsOf(box), 'the pass after a mark failure came back within two hours of it').toEqual([s1]);
    passAt(box, 190);   // over two hours after it
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s2 });
    expect(metaOf(box, 'export_mark_fails'), 'a marked pass ends the backoff').toBe('0');
  }, 300_000);

  // RD3: a busy error between the link and the marks. No preload throws a busy (B2's HISTORY_TEST_THROW_SQL throws
  // ERR_SQLITE_ERROR with no errcode), so these two cases run exportPass in-process on the test's OWN writer connection:
  // node:fs's linkSync is wrapped to see the link (the EEXIST case's idiom), and that connection's exec answers the next
  // `n` BEGIN IMMEDIATEs after the link with SQLITE_BUSY (errcode 5, what B1's isBusy reads): the stand-in for another
  // connection holding the write lock past busy_timeout. Every other statement runs as it would. Shipped code reads no seam.
  const roomy = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB });
  async function busyAfterLink(box: HistoryBox, ids: { storeId: string; writer: string }, nowMs: number, n: number): Promise<unknown> {
    return onStore(box, async (db) => {
      let linked = false;
      let busied = 0;
      const realLink = fs.linkSync;
      (fs as { linkSync: unknown }).linkSync = (from: fs.PathLike, to: fs.PathLike): void => { realLink(from, to); linked = true; };
      syncBuiltinESMExports();
      const realExec = db.exec.bind(db);
      (db as unknown as { exec: (sql: string) => void }).exec = (sql: string): void => {
        if (linked && busied < n && sql === 'BEGIN IMMEDIATE') {
          busied += 1;
          throw Object.assign(new Error(`database is locked (BEGIN ${busied} after the link)`), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });
        }
        realExec(sql);
      };
      try {
        return await SW.exportPass(db, exportCtx(box, ids, () => nowMs)).then(() => null, (e: unknown) => e);
      } finally {
        (fs as { linkSync: unknown }).linkSync = realLink;
        syncBuiltinESMExports();
      }
    });
  }

  it('a busy error between the link and the marks: the pass records the published segment\'s number and the attempt clock, then rethrows it, so the next step publishes nothing new; a busy is not a mark failure (RD3)', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-busy-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now() + 2 * HOUR;   // past the store's first hour: only the attempt clock can hold the next step
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const err = (await busyAfterLink(box, ids, NOW, 1)) as { errcode?: number; message?: string } | null;
    expect(err?.errcode, 'the busy error was not rethrown').toBe(5);
    expect(err?.message).toBe('database is locked (BEGIN 1 after the link)');
    expect(segmentsOf(box), 'the segment was published before the busy mark').toEqual([s1]);
    expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null });
    expect(metaOf(box, 'export_seq'), 'the published segment\'s number').toBe('1');
    expect(metaOf(box, 'export_attempt_ms'), 'the attempt clock').toBe(String(NOW));
    expect(metaOf(box, 'export_mark_fails'), 'a busy is the lock\'s, not the volume\'s: no backoff').toBeNull();
    expect(counters(box)['export_write_failed'], 'a busy ends the tick; it is not a failed write').toBeUndefined();
    const next = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 5 * MIN, { deps: { statfs: roomy } })));
    expect(next, 'the next step published the same rows again').toBeNull();
    expect(segmentsOf(box)).toEqual([s1]);
    // an hour on, the unmarked rows go into the next segment, as after a kill between the link and the marks
    const later = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 65 * MIN, { deps: { statfs: roomy } })));
    expect(later).toMatchObject({ state: 'written', segment: s2 });
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s2 });
  }, 120_000);

  it('RD3\'s residual: when that record meets busy too, the first error is the one rethrown, nothing is recorded, and the next pass repeats the rows into the next segment, which replay absorbs', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-busy2-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now() + 2 * HOUR;
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const err = (await busyAfterLink(box, ids, NOW, 2)) as { errcode?: number; message?: string } | null;
    expect(err?.errcode, 'the busy error was not rethrown').toBe(5);
    expect(err?.message, 'the record\'s own error escaped in place of the mark\'s').toBe('database is locked (BEGIN 1 after the link)');
    expect(segmentsOf(box)).toEqual([s1]);
    expect(metaOf(box, 'export_attempt_ms'), 'a record that met busy recorded nothing').toBeNull();
    expect(metaOf(box, 'export_seq')).toBeNull();
    const next = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 5 * MIN, { deps: { statfs: roomy } })));
    expect(next).toMatchObject({ state: 'written', segment: s2 });
    const uuidsOf = (n: string): unknown[] => segmentRows(path.join(exportDirOf(box), n), 'entries').map((e) => e['uuid']).sort();
    expect(uuidsOf(s2), 'the residual: the same rows in two segments, which Task 10\'s replay absorbs').toEqual(uuidsOf(s1));
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s2 });
  }, 120_000);
});
```

- [ ] **Step 3: Run them.** From inside `server/`, in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts -t 'crash and collision safety'
```

Expected: three cases are red.
- The EEXIST case, because Task 5 fails the pass on a taken name: `expected { state: 'failed', … } to match object { state: 'written', segment: '2.<writer>.db' }`, after `planted` reads 1 and the planted file is intact.
- The mark-failure case, on its stderr line: Task 5's catch prints the write-failure line for every failure (`expected '…an export segment write failed and nothing was marked…' to contain 'history-sweep: export segment 1.<writer>.db was published and could not be marked'`).
- The first busy case (RD3), after the busy is rethrown and the segment is published: Task 5's catch rethrows a busy with nothing recorded (`the published segment's number: expected null to be '1'`).

The other seven are green already: Task 5 publishes before it marks, numbers past the directory, counts and survives a failed write, and rethrows a busy before any record, which is all RD3's residual case asks of a record that cannot be written; Task 6's `exportStep` removes stale temps before its probe. Each of those seven is pinned by a CONTROL in Step 6, measured red there. If any of the seven is red here, it is a defect Task 5 or Task 6 left: fix `exportPass` or `exportStep`, name the case in the commit body, and re-run. If a busy case's first assertion is red (`the busy error was not rethrown`, or no segment), the merged `withTx` does not open its transaction with `db.exec('BEGIN IMMEDIATE')` on the connection it is given: read it on the base and match the wrapper's test to its statement text, never change `withTx`.

- [ ] **Step 4: Take the next number on a taken name, back off after a mark that failed, and record a busy after the link.** In `ccd/history/sweep.mjs`, add directly below Task 5's `const EXPORT_ATTEMPT_META = 'export_attempt_ms';`:

```js
/** Names tried past a taken one before the pass fails: a directory whose names keep appearing under the lock is a fault,
 *  never a loop (§9.15 "Write"). */
const EXPORT_SEQ_RETRIES = 8;
/** meta: how many export passes in a row published their segment and then failed to mark it (§9.15 "Mark": the marks
 *  are one transaction on db/, which the export's preflight never measures). Each such pass leaves its rows unmarked,
 *  so the next pass publishes them again. lib decides the count after each outcome and the wait (decideMarkOutcome,
 *  exportMarkFailsOf, exportPassIntervalMs; coordinator ruling RD2): the wait doubles per failure, at most a day, so a
 *  store whose own volume refuses the marks does not publish a copy every hour until the home filesystem's floor
 *  (⟦D:history-export-mark-failure-backs-off⟧, NEW). This module only writes what lib answers. */
const EXPORT_MARK_FAILS_META = 'export_mark_fails';
```

In `exportPass`, replace its line

```js
  let seg = null;
```

with

```js
  let seg = null;
  let published = null;   // { name, seq } once the segment is linked: a failure after that is the mark's
```

In `exportPass`, replace these two lines:

```js
    const linked = publishSegment(seg, dir, name);
    if (linked !== 'linked') throw new Error(`the segment name ${name} is already on disk`);
```

with:

```js
    // §9.15 "Write": link() fails on a name already on disk, and the pass takes the next number past every name there,
    // of any writer, and past the one it tried. A name is never replaced (D-4226).
    let linked = publishSegment(seg, dir, name);
    for (let tries = 1; linked === 'exists'; tries += 1) {
      if (tries > EXPORT_SEQ_RETRIES) throw new Error(`no free segment name in ${EXPORT_SEQ_RETRIES} tries past ${name}`);
      countOutside(db, 'export_seq_taken');
      seq = nextSegmentSeq({ onDisk: listSegments(dir).map((x) => x.seq), recorded: seq });
      name = segmentName({ seq, writer });
      setSegmentSeq(seg.temp, seq);
      linked = publishSegment(seg, dir, name);
    }
    published = { name, seq };   // linked: from here a failure is the mark's, and these rows go into a later segment
```

In `exportPass`'s catch, replace its four lines

```js
    if (isBusy(e)) throw e;
    process.stderr.write(`history-sweep: an export segment write failed and nothing was marked: ${e && e.message ? e.message : String(e)}\n`);
    countOutside(db, 'export_write_failed');
    try { setMeta(db, EXPORT_ATTEMPT_META, String(nowMs)); } catch { /* busy: the next tick retries sooner, nothing is lost */ }
```

with

```js
    if (isBusy(e)) {
      // RD3: SQLITE_BUSY after the link (another connection held the write lock through the marks). The segment is
      // published and its rows are unmarked. Its number and the attempt clock are recorded before the error ends the
      // tick (O22), so the next tick's cadence waits rather than publish the same rows again a minute later. lib says a
      // busy is the lock's, not the volume's: the backoff stands as it is. If this record meets busy too, the first
      // error still ends the tick, the next pass repeats these rows into a later segment, and replay absorbs the copy
      // (insert-or-ignore by sha256): a residual the PR body names. A busy before the link records nothing.
      if (published !== null) {
        try {
          withTx(db, 'NORMAL', () => {
            setMeta(db, EXPORT_SEQ_META, String(published.seq));
            setMeta(db, EXPORT_ATTEMPT_META, String(nowMs));
            const held = decideMarkOutcome({ outcome: 'mark-busy', recorded: getMeta(db, EXPORT_MARK_FAILS_META) });
            if (held.write !== null) setMeta(db, EXPORT_MARK_FAILS_META, held.write);
          });
        } catch { /* busy again: the residual above */ }
      }
      throw e;
    }
    const why = e && e.message ? e.message : String(e);
    process.stderr.write(published === null
      ? `history-sweep: an export segment write failed and nothing was marked: ${why}\n`
      : `history-sweep: export segment ${published.name} was published and could not be marked; its rows go into a later segment: ${why}\n`);
    countOutside(db, 'export_write_failed');
    try {
      withTx(db, 'NORMAL', () => {
        setMeta(db, EXPORT_ATTEMPT_META, String(nowMs));
        // lib decides whether this pass backs off (RD2): one step more after a published, unmarked segment; as it stands
        // after a failure before the link
        const after = decideMarkOutcome({ outcome: published === null ? 'write-failed' : 'mark-failed', recorded: getMeta(db, EXPORT_MARK_FAILS_META) });
        if (after.write !== null) setMeta(db, EXPORT_MARK_FAILS_META, after.write);
      });
    } catch { /* busy or full: the next tick retries sooner, nothing is lost */ }
```

The busy branch's `setMeta(db, EXPORT_ATTEMPT_META, String(nowMs));` sits twelve spaces in and the caught failure's record keeps its own at eight; Step 6 names each by its indentation.

In `markExported`, insert directly below `    setMeta(db, EXPORT_SEQ_META, String(m.seq));`:

```js
    // marked: lib decideMarkOutcome ends the backoff, writing '0' only over another value (RD2)
    const ended = decideMarkOutcome({ outcome: 'marked', recorded: getMeta(db, EXPORT_MARK_FAILS_META) });
    if (ended.write !== null) setMeta(db, EXPORT_MARK_FAILS_META, ended.write);
```

In `exportStep` (Task 6), insert directly below `    firstTickMs: first === undefined ? null : Number(first.ts_ms),` (inside the `decideExportPass({ … })` call):

```js
    intervalMs: exportPassIntervalMs(exportMarkFailsOf(getMeta(db, EXPORT_MARK_FAILS_META))),   // Task 7: lib's wait after failed marks
```

Then, from the repository root, run Task 5 Step 6's script with `want = {'./store.mjs': ['setSegmentSeq', 'withTx', 'getMeta', 'setMeta'], './lib.mjs': ['exportPassIntervalMs', 'exportMarkFailsOf', 'decideMarkOutcome']}`, add what it prints, and run its guard checks. Then confirm the sweep decides nothing about the backoff itself (RD2): `grep -n 'EXPORT_MARK_FAILS_META' ccd/history/sweep.mjs` prints eight lines, the declaration and seven uses, and each use is an argument of `decideMarkOutcome(` or `exportMarkFailsOf(`, or a `setMeta(db, EXPORT_MARK_FAILS_META, <answer>.write)`; no arithmetic on the count and no `'0'` literal beside it.

- [ ] **Step 5: Run and see it pass.** From inside `server/`, each in the foreground:

```bash
./node_modules/.bin/vitest run test/history-export.test.ts
node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected: every case green; tsc prints nothing.

- [ ] **Step 6: CONTROLs — each guard reds its case.** From the repository root: `cp ccd/history/sweep.mjs "$SCRATCH/sweep.mjs.t7"; cp ccd/history/store.mjs "$SCRATCH/store.mjs.t7"; cp ccd/history/lib.mjs "$SCRATCH/lib.mjs.t7"` (`SCRATCH` as in Task 5 Step 8). Apply each by hand; run from inside `server/` with `./node_modules/.bin/vitest run test/history-export.test.ts -t '<filter>'`; see it red; restore all three files with `cp` before the next. Never `git stash`. The two `lib.mjs` rows are Task 1's pure mutants run through this file, so they show the sweep acts on lib's answer rather than its own.

| Mutation | `-t` filter | Expected red |
|---|---|---|
| O39's first CONTROL, marking before the link: in `exportPass`, move the line `    markExported(db, { name, seq, nowMs, blobs: w.blobs, entries: w.entries, complete });` (and the `const complete = …` line it reads) to directly above `    let linked = publishSegment(seg, dir, name);` | `a kill just before the link` | `rows were marked with no segment to hold them: expected 4 to be +0` |
| O39's second CONTROL, publishing by rename: in Task 4's `publishSegment` (`ccd/history/store.mjs`), replace its `linkSync(<temp>, <target>)` call with `renameSync(<temp>, <target>)`, leaving its arguments as they are | `an existing name is never replaced` | `an existing name was written over: expected '…' to be 'planted by the test'` |
| In `exportStep` (Task 6), delete its line that begins `  try { removeStaleSegmentTemps(` | `a kill mid-write` | the next pass cannot create its temp (O_EXCL) and fails: `the stale temp outlived the next pass` |
| In `exportStep`, move that `try { removeStaleSegmentTemps(…) } catch { … }` line from above the probe to directly below the `if (!room.admit) { … }` block (removed only after an admit) | `a stale temp goes before the preflight` | `the paused pass kept a dead segment's temp on the filesystem it measured: expected [ '.1.<writer>.db.tmp' ] to deeply equal []` |
| In `exportPass`'s catch, in the caught failure's record (not the busy branch), delete the line `        setMeta(db, EXPORT_ATTEMPT_META, String(nowMs));` (eight spaces in) | `a failed segment write` | `a failed pass retried inside its hour: expected [ '1.<writer>.db' ] to deeply equal []` |
| In `exportPass`'s catch, delete the line `    countOutside(db, 'export_write_failed');` | `a failed segment write` | `expected undefined to be 1` |
| In the retry loop, delete `      setSegmentSeq(seg.temp, seq);` | `an existing name is never replaced` | the renamed publish fails Task 4's own name check (`publishSegment: "2.<writer>.db" is not segment 1 of <writer>`), so the pass answers `failed`: `expected { state: 'failed', … } to match object { state: 'written', segment: '2.<writer>.db' }`. Task 4's check guards this path too; the case is measured red through it |
| In `exportStep`, delete the line that begins `    intervalMs: exportPassIntervalMs(` | `could not mark it backs off` | `the pass after a mark failure came back within two hours of it: expected [ '1.<writer>.db', '2.<writer>.db' ] to deeply equal [ '1.<writer>.db' ]` |
| In `exportPass`'s catch, delete the line `        if (after.write !== null) setMeta(db, EXPORT_MARK_FAILS_META, after.write);` | `could not mark it backs off` | `expected null to be '1'` |
| In `exportPass`'s catch, measure every failure as one before the link: change `published === null ? 'write-failed' : 'mark-failed'` to `'write-failed'` | `could not mark it backs off` | `expected null to be '1'` |
| In `markExported`, delete the line `    if (ended.write !== null) setMeta(db, EXPORT_MARK_FAILS_META, ended.write);` | `could not mark it backs off` | `a marked pass ends the backoff: expected '1' to be '0'` |
| In `lib.mjs`'s `decideMarkOutcome` (Task 1's mutant `RD2 backoff: a failed mark leaves the backoff where it was`), change `    case 'mark-failed': markFails = prev + 1; write = String(markFails); break;` to `    case 'mark-failed': markFails = prev; write = String(markFails); break;` | `could not mark it backs off` | `expected '0' to be '1'` |
| RD3: in `exportPass`'s busy branch, delete the line `            setMeta(db, EXPORT_SEQ_META, String(published.seq));` | `a busy error between the link and the marks` | `the published segment's number: expected null to be '1'` |
| RD3: in `exportPass`'s busy branch, delete the line `            setMeta(db, EXPORT_ATTEMPT_META, String(nowMs));` (twelve spaces in; the caught failure's record keeps its own) | `a busy error between the link and the marks` | `the attempt clock: expected null to be '<NOW>'` |
| RD3: the busy record before the rethrow, removed: in `exportPass`'s busy branch, change `      if (published !== null) {` to `      if (false) {` | `a busy error between the link and the marks` | `the published segment's number: expected null to be '1'` |
| RD3: the record's own failure escapes: in the busy branch, replace `        } catch { /* busy again: the residual above */ }` with `        } finally { /* RD3 CONTROL: the record's own error escapes */ }` | `RD3's residual` | `the record's own error escaped in place of the mark's: expected 'database is locked (BEGIN 2 after the link)' to be 'database is locked (BEGIN 1 after the link)'` |
| RD3 through lib: in `lib.mjs`'s `decideMarkOutcome` (Task 1's mutant `RD2/RD3 backoff: a busy after the link backs off`), replace the two lines `    case 'mark-busy':` and `    case 'write-failed': markFails = prev; break;` with `    case 'write-failed': markFails = prev; break;` and `    case 'mark-busy': markFails = prev + 1; write = String(markFails); break;` | `a busy error between the link and the marks` | `a busy is the lock's, not the volume's: no backoff: expected '1' to be null` |

After the last restore, run the whole file green once more, and `cmp` each scratch copy (`sweep.mjs.t7`, `store.mjs.t7`, `lib.mjs.t7`) with its file: `lib.mjs` and `store.mjs` end this task unchanged.

- [ ] **Step 7: Commit**, from the repository root:

```bash
git add ccd/history/sweep.mjs server/test/history-export.test.ts
git commit -m "feat(history): export crash and collision safety — never a replaced name, kills leave only a temp, a failed write marks nothing and retries hourly, a failed mark backs off by lib's decision, a busy mark records its segment first (W1-B4)"
```

### Task 8: sweep: marks that move: a late variant or a late-linked sidecar clears its entry's marks; the first tick after any bind clears the marks whose segment is missing

**Files:**
- Modify: `ccd/history/sweep.mjs` (by content; R1):
  - in B1's `function stmts(db)` (the ingest's prepared statements, B1 Task 19), insert one member directly below the `variantIns:` member (its second line ends ``VALUES (?, ?, ?, ?, ?) ON CONFLICT(entry_id, blob_id) DO NOTHING`),``);
  - in B1's `writeChunk`, insert one line directly below `        s.variantIns.run(entryId, blobId, chunk.fileId, chunk.nowMs, cause);` (the second of the variant branch's two `variantIns.run` calls);
  - in B1's `ingestSidecar` (B1 Task 21), inside its second `withTx(db, 'NORMAL', () => { … })`, insert four lines (three of comment, one of code) directly below `      if (ins.changes === 1 && entryId === null) bump(db, 'sidecar_unlinked');`. Read the merged function first: the anchor is its unlinked-sidecar count, directly after `const ins = q.sidecarIns.run(transcriptPk, s.name, blobId, entryId, ctx.nowMs);`;
  - insert one block directly ABOVE the entry guard `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`, below Task 6's block;
  - in Task 6's `exportStep`, insert eleven lines (three of comment, eight of code) directly below `export async function exportStep(db, ctx) {`;
  - in Task 5's `noteExportPassDone`, add two lines (one of comment, one of code) directly below `  setMeta(db, HEALTH_META.exportPassMs, String(nowMs));`;
  - merge `decideMarkCheck` and `missingSegmentNames` into the `from './lib.mjs'` import statement.
- Modify: `server/test/history-export.test.ts`: in place, its `./historyHelpers.js` import list gains `CLI` and `preloadOptions` (and `PRELOADS`, unless Task 7 already added it), and its `./historyFixtures.js` import gains `toolResultRow`; add one import statement directly below the file's top import block; append the module-scope helper `adoptOnPty` and one describe at the end of the file.

**Interfaces:**
- Consumes:
  - B1 `sweep.mjs`: `stmts(db)` and `writeChunk(db, chunk)`'s variant branch (`before !== undefined && before.blob_id !== blobId && variantHas … === undefined`), and `ingestSidecar(db, ctx, s, budget, cache)`'s transaction (`const ins = q.sidecarIns.run(…)`, `entryId` from `linkSidecar`), which this task edits in place; `isBusy(e)`, `countOutside(db, name)`. B1 ingests a uuid's sidecars only in a tick whose ingest completed and only once every copy of its transcript is caught up (`ingestSidecars`' `notCaughtUp`), so a sidecar can link a tick, or many, after its entry: a budget-cut or floor-paused tick, a copy still behind, or a tool-results file that lands late.
  - B2 (`store.mjs` Task 24, `sweep.mjs` Task 26): every binding writes meta `bound:<ms>` = `adopt` | `restore` | `rebuild` inside its transaction (`insertBindFacts`), and `doctor --adopt` (the CLI door `ccrc history doctor --adopt`, which needs a TTY) binds an unbound store under a new writer token, keeping its `store_id`.
  - B1 `lib.mjs`: `HEALTH_META.exportSegmentMissing` (`'export_segment_missing'`), whose `deriveHealth` rule WARNs `export-segment-missing` while it is above 0.
  - Task 4 (`store.mjs`): `listSegments(dir)`. Task 5: `exportDirFor`, `noteExportPassDone(db, nowMs, complete)` and the `complete` it is given (true only when every due row the pass found fit). Task 6: `exportStep`.
  - Task 1 (`lib.mjs`), the check after a bind's decisions (coordinator ruling RD2): `decideMarkCheck({ metaKeys, checkedRecord }): { check; facts; record }` (whether this step checks, by KEY and never by clock, and the JSON record the check writes) and `missingSegmentNames({ named, present }): string[]`.
  - Test side: Task 5's and Task 6's module scope; B1 `historyHelpers`' `CLI`, `preloadOptions`, `PRELOADS`; `node-pty` (a server dependency, already installed by `npm ci`; B2 Task 25's terminal idiom).
- Produces (`sweep.mjs`):
  - `stmts(db).exportClear`: `UPDATE entries SET exported_ms = NULL, exported_seg = NULL WHERE entry_id = ? AND exported_ms IS NOT NULL`, run in `writeChunk`'s variant branch, in the chunk's transaction, and in `ingestSidecar`'s transaction when a NEW sidecar row links to an entry (`ins.changes === 1 && entryId !== null`); a no-op for an entry not yet exported (⟦D:history-export-late-sidecar-clears-marks⟧).
  - `export function checkSegmentMarks(db, ctx, record: string): { cleared: number; segments: string[] }`: measures the marked names and the listing, asks lib's `missingSegmentNames` which are missing, and clears every blob and entry mark naming one, in one NORMAL transaction; when it cleared any, `export_segment_missing` +1 and meta `HEALTH_META.exportSegmentMissing` = the number of marks cleared; meta `export_marks_checked_ms` = the check's clock and meta `export_marks_checked_binds` = `record` (lib's), either way. It throws on a listing that fails for any reason but ENOENT (Task 4's `listSegments`).
  - Module-private `EXPORT_MARKS_CHECKED_META` (`'export_marks_checked_ms'`, for display), `EXPORT_MARKS_CHECKED_BINDS_META` (`'export_marks_checked_binds'`) and `bindFactKeys(db): string[]` (every meta key `LIKE 'bound:%'`, a measurement; lib says which are bind facts).
  - `exportStep` runs `checkSegmentMarks` first, before the cadence, when lib's `decideMarkCheck` over the measured keys and the last check's record answers `check` (a bind fact the last check did not cover, decided by KEY and never by comparing clocks: a bind stamped on a box whose clock is behind, or after the wall clock stepped back, is still checked), and never otherwise. A check that throws anything but busy is counted `export_marks_check_failed` with one stderr line naming the directory, records nothing, and runs again on the next step; it never throws out of the tick.
  - `noteExportPassDone`: a complete pass resets `HEALTH_META.exportSegmentMissing` to `'0'` when it holds anything else, so the WARN clears once the re-export leaves nothing due behind.
  - Counters `export_segment_missing` and `export_marks_check_failed`.

**Spec:**
- §9.15 "Mark" ("A variant first seen after its entry was exported clears that entry's marks, so the next pass writes the entry again with all its variants"), "After a bind" (the first tick checks that every segment a mark names is on this box; a missing one's marks are cleared so its rows export again; `export_segment_missing`, doctor WARN; "Carrying the directory before the verb avoids the re-export").
- §8.4 `doctor --adopt` ("Carry before the verb"); §9.6 (`export-segment-missing` WARN); §9.10 "Export marks after a bind".
- Pins: **O39**'s variant case ("a variant first seen after its entry's export → the entry is written again with both variants") and its adopt case ("after an adopt with the segments left behind → the marks are cleared, `export_segment_missing` +1, and the rows export again"); the late-sidecar case, its sibling.
- Departures: B1's D-4226 (`history-journal-writer-token`) (each mark names its segment, cleared when the segment is missing after a bind), ⟦D:history-binding-facts-before-link⟧ (the check reads the bind fact the binding wrote into the database), and NEW ⟦D:history-export-late-sidecar-clears-marks⟧: §9.15 names only a late variant. Schema v1 gives `sidecars` no mark, and the pass selects only unexported entries and unlinked sidecars, so a sidecar row linked to an already exported entry would never be exported: its text would stay store-only while B1's census counts its blob due for good (`export-due` WARN, then `export-overdue` FAIL once the source goes). A NEW linked sidecar row therefore clears its entry's marks, as a late variant does, and the next pass writes the entry again with every sidecar row; the entry's own blobs are not carried again. It is not narrowed to an unexported blob: a row naming a blob another row already exported is still a sidecar ROW the export lacks.
- Coordinator ruling RD2: which keys are bind facts, whether a step checks, what the check records and which marked segments are missing are lib's decisions (Task 1, with their pure tests and mutants); this task measures meta, the marked names and the listing, calls them and acts. Step 6 runs Task 1's clock mutant through this file too.
- Plan choices (no departure): the check runs once per bind fact, from the fact's key, never on the cadence and never by comparing a bind's clock with the last check's, and scans `exported_seg` once per bind with no index (none is added: no migration); the meta count is written only when a check clears something, so a later check that finds nothing never hides a WARN still owed; a restore's check runs on the first tick after its recovery step completes, because no tick runs while it is registered (B2); a check that cannot list the directory is counted and retried, never thrown (the tick's census and journal steps still run).

- [ ] **Step 1: Write the failing tests.** In `server/test/history-export.test.ts`, add `CLI` and `preloadOptions` to the `./historyHelpers.js` import list (B1 Task 14's and Task 24's exports; add `PRELOADS` too if Task 7 has not), add `toolResultRow` to the `./historyFixtures.js` import (B1's fixture, beside `userRow`), and add this statement directly below the file's top import block:

```ts
import * as pty from 'node-pty';
```

Append to the end of the file:

```ts
/** `ccrc history doctor --adopt` on a REAL terminal (node-pty): the irreversible forms refuse without one (§8.4). A pty
 *  child leads its own process group, so the safety timer kills the whole group, the shim and the sweep under it too
 *  (W1-B2 Task 25's onPty idiom). A pty merges stdout and stderr. */
function adoptOnPty(box: HistoryBox): Promise<{ code: number; out: string }> {
  const env: Record<string, string> = {};
  const merged: NodeJS.ProcessEnv = { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions([PRELOADS.statfs]) };
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) env[k] = v;
  return new Promise((resolve) => {
    const p = pty.spawn(process.execPath, ['--no-warnings', CLI, 'doctor', '--adopt'], { name: 'xterm-color', cols: 200, rows: 40, cwd: box.home, env });
    let out = '';
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out });
    };
    const timer = setTimeout(() => {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { p.kill(); }
      finish(-1);
    }, 40_000);
    p.onData((d) => { out += d; });
    p.onExit(({ exitCode }) => finish(exitCode));
  });
}

describe('marks that move (W1-B4 Task 8; spec §9.15 "Mark", "After a bind")', () => {
  it('O39: a variant first seen after its entry was exported clears that entry\'s marks, and the next pass writes the entry again with both variants', () => {
    const { box, transcript, ids } = ingestedBox('ccrc-history-export-variant-', [row(1, 'body one', 2 * DAY), row(2, 'another row', 2 * DAY)]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    passAt(box, 65);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s1 });
    // the same uuid with another body, as a later copy of the row writes it (B1's DM2: one entry, two variants)
    fs.appendFileSync(transcript, `${JSON.stringify(row(1, 'body two', 2 * DAY))}\n`);
    passAt(box, 100);   // the scan reads the appended line; the export waits, its last pass at +65
    expect(q(box, 'SELECT count(*) AS n FROM entry_variants')[0]!['n'], 'the fixture must make a variant').toBe(2);
    expect(marks(box), 'the late variant left its entry marked').toEqual({ [rid(1)]: null, [rid(2)]: s1 });
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s1 });
    const seg2 = path.join(exportDirOf(box), s2);
    expect(segmentRows(seg2, 'entries').map((e) => e['uuid'])).toEqual([rid(1)]);
    const both = q(box, `SELECT lower(hex(b.sha256)) AS sha FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id
      JOIN blobs b ON b.blob_id = v.blob_id WHERE e.uuid = ? ORDER BY sha`, rid(1)).map((r) => r['sha']);
    expect(segmentRows(seg2, 'variants').map((v) => v['blob_sha256']).sort()).toEqual(both);
    // the first body's bytes are in segment 1 already: segment 2 carries only the new one
    expect(segmentRows(seg2, 'blobs')).toHaveLength(1);
  }, 300_000);

  it('O39: after an adopt with the segments left behind, the first tick clears every mark naming a missing segment, export_segment_missing +1, and the rows export again under the new writer', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-adopt-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const P = historyPaths(box.home);
    passAt(box, 65);
    expect(Object.values(marks(box))).toEqual([`1.${ids.writer}.db`, `1.${ids.writer}.db`]);
    // the store comes to "this box" and its export directory stays on the one it came from (§8.4's carry, not done)
    fs.renameSync(exportDirOf(box), path.join(box.home, 'export-left-behind'));
    fs.rmSync(P.storeId);
    fs.rmSync(P.writer);
    const adopt = await adoptOnPty(box);
    expect(adopt.code, adopt.out).toBe(0);
    const writer = fs.readFileSync(P.writer, 'utf8').trim();
    expect(writer, 'adopt mints a new writer token').not.toBe(ids.writer);
    expect(q(box, "SELECT v FROM meta WHERE k LIKE 'bound:%'")).toEqual([{ v: 'adopt' }]);
    passAt(box, 70);   // the first tick after the bind; the cadence still waits (last pass at +65)
    expect(Object.values(marks(box)), 'a mark still names a segment this box does not have').toEqual([null, null]);
    expect(q(box, 'SELECT count(*) AS n FROM blobs WHERE exported_ms IS NOT NULL')[0]!['n']).toBe(0);
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'two entries\' marks and two blobs\'').toBe('4');
    expect(segmentsOf(box), 'the check wrote a segment').toEqual([]);
    passAt(box, 130);
    const again = `2.${writer}.db`;
    expect(segmentsOf(box)).toEqual([again]);
    expect(Object.values(marks(box))).toEqual([again, again]);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'the re-export left nothing due behind: the WARN clears').toBe('0');
    expect(counters(box)['export_segment_missing'], 'a second check ran without a second bind').toBe(1);
  }, 300_000);

  it('the check runs on the first step after a bind and not again until the next one: marks naming a present segment stay; a restore\'s bind clears those naming a missing one', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindcheck-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const name = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    expect(Object.values(marks(box))).toEqual([name, name]);
    // an adopt's bind fact, as B2's insertBindFacts writes it; the segment IS here, so nothing is cleared
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + MIN}`, 'adopt');
      return SW.exportStep(db, exportCtx(box, ids, at(2 * MIN)));
    });
    expect(metaOf(box, 'export_marks_checked_ms')).toBe(String(NOW + 2 * MIN));
    expect(Object.values(marks(box))).toEqual([name, name]);
    expect(counters(box)['export_segment_missing']).toBeUndefined();
    expect(metaOf(box, HEALTH_META.exportSegmentMissing)).toBeNull();
    // the segment goes, with no bind since the check: no check runs, and the marks stay
    fs.rmSync(path.join(exportDirOf(box), name));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(Object.values(marks(box)), 'a check ran with no bind since the last one').toEqual([name, name]);
    // a restore's bind: the next step clears every mark naming the missing segment
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + 4 * MIN}`, 'restore');
      return SW.exportStep(db, exportCtx(box, ids, at(5 * MIN)));
    });
    expect(Object.values(marks(box))).toEqual([null, null]);
    expect(q(box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg IS NOT NULL')[0]!['n']).toBe(0);
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing)).toBe('4');
  }, 120_000);

  it('the check follows the bind facts it has not covered, never their clocks: a bind stamped before the last check (a box whose clock is behind) still runs it', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindkey-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const name = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + 5 * MIN}`, 'adopt');
      return SW.exportStep(db, exportCtx(box, ids, at(6 * MIN)));
    });
    expect(metaOf(box, 'export_marks_checked_ms')).toBe(String(NOW + 6 * MIN));
    expect(Object.values(marks(box))).toEqual([name, name]);
    // a restore whose bind fact carries a clock behind the last check's, with the segment gone
    fs.rmSync(path.join(exportDirOf(box), name));
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + 3 * MIN}`, 'restore');
      return SW.exportStep(db, exportCtx(box, ids, at(7 * MIN)));
    });
    expect(Object.values(marks(box)), 'a bind stamped before the last check was never checked').toEqual([null, null]);
    expect(counters(box)['export_segment_missing']).toBe(1);
  }, 120_000);

  it('a check that cannot list export/<store_id>/ is counted and retried, never thrown out of the tick: the marks stay, and the next step checks again', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindlist-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const name = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    const dir = exportDirOf(box);
    fs.renameSync(dir, `${dir}.kept`);
    fs.writeFileSync(dir, 'a stray file under the directory\'s name');   // listing it fails ENOTDIR
    // the cadence waits inside the hour after the pass at NOW, so only the check runs
    await onStore(box, async (db) => {
      setMeta(db, `bound:${NOW + MIN}`, 'adopt');
      await SW.exportStep(db, exportCtx(box, ids, at(2 * MIN)));   // resolves: the step never throws it
    });
    expect(counters(box)['export_marks_check_failed']).toBe(1);
    expect(Object.values(marks(box)), 'a check that could not list cleared marks').toEqual([name, name]);
    expect(metaOf(box, 'export_marks_checked_ms'), 'a failed check is not a check').toBeNull();
    fs.rmSync(dir);
    fs.renameSync(`${dir}.kept`, dir);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'the next step checks again').toBe(String(NOW + 3 * MIN));
    expect(Object.values(marks(box))).toEqual([name, name]);
  }, 120_000);

  it('a sidecar linked after its entry was exported clears that entry\'s marks, and the next pass writes the entry again with the sidecar row and its bytes; the census\'s due count returns to 0', () => {
    const late = toolResultRow({
      uuid: rid(2), ts: new Date(Date.now() - 2 * DAY).toISOString(), sessionId: U, cwd: WORK, toolUseId: 'toolu_01B4LATE',
      content: 'Output too large. Full output saved to: /home/u/x/tool-results/b4late01.txt',
    });
    const { box, ids } = ingestedBox('ccrc-history-export-latesc-', [row(1, 'a prompt', 2 * DAY), late]);
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    passAt(box, 65);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s1 });
    // the tool's output file lands after its row was exported (a tick behind its JSONL line, or held back by a copy
    // still behind: §9.2 step 4)
    const dir = path.join(box.accountHome['claude-a']!, 'projects', SLUG, U, 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'b4late01.txt'), 'the late tool output body\n');
    passAt(box, 100);   // a scan tick (over 30 min after the last): it finds and links the sidecar; the export waits
    expect(q(box, 'SELECT s.name, e.uuid FROM sidecars s LEFT JOIN entries e ON e.entry_id = s.entry_id'), 'the fixture must link the sidecar to the exported row')
      .toEqual([{ name: 'b4late01.txt', uuid: rid(2) }]);
    expect(marks(box), 'the late sidecar left its entry marked').toEqual({ [rid(1)]: s1, [rid(2)]: null });
    expect(metaOf(box, 'export_due'), 'the census counts the late sidecar\'s blob due').toBe('1');
    passAt(box, 130);
    expect(segmentsOf(box)).toEqual([s1, s2]);
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
    const side = q(box, 'SELECT lower(hex(b.sha256)) AS sha, b.exported_seg FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id')[0]!;
    expect(side['exported_seg'], 'the sidecar\'s bytes stayed store-only').toBe(s2);
    const seg2 = path.join(exportDirOf(box), s2);
    expect(segmentRows(seg2, 'entries').map((e) => e['uuid'])).toEqual([rid(2)]);
    expect(segmentRows(seg2, 'sidecars').map(pick(['name', 'uuid', 'blob_sha256'])))
      .toEqual([{ name: 'b4late01.txt', uuid: rid(2), blob_sha256: side['sha'] }]);
    expect(segmentRows(seg2, 'blobs').map((b) => b['sha256']), 'segment 2 carries only the sidecar\'s new bytes').toEqual([side['sha']]);
    expect(metaOf(box, 'export_due'), 'nothing is left due').toBe('0');
  }, 300_000);
});
```

- [ ] **Step 2: Run them and see them fail.** From inside `server/`, in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts -t 'marks that move'
```

Expected:
- the variant case: `the late variant left its entry marked: expected { … '1.<writer>.db' … } to deeply equal { …: null, … }`;
- the adopt case (after the adopt itself exits 0): `a mark still names a segment this box does not have: expected [ '1.<writer>.db', '1.<writer>.db' ] to deeply equal [ null, null ]`;
- the in-process case: `expected null to be '<NOW + 2 min>'` on `export_marks_checked_ms`, and the bind-key case the same way at `<NOW + 6 min>`;
- the unlistable-directory case: `expected undefined to be 1` on `export_marks_check_failed` (no check runs yet);
- the late-sidecar case, after its precondition holds (the sidecar is linked to `rid(2)`): `the late sidecar left its entry marked: expected { …: '1.<writer>.db' } to deeply equal { …: null }`.

If the adopt exits non-zero, read `adopt.out`: a refusal there is B2's door, not this task's, and blocks this task until resolved. If the late-sidecar case's precondition is red (no sidecar row, or one with no entry), B1's link rule did not match the fixture: read B1's `linkSidecar` and its DM47 cases on the base and give the fixture's `content` the form they link, never change B1's rule.

- [ ] **Step 3: Clear an exported entry's marks on its late variant and its late-linked sidecar.** In `ccd/history/sweep.mjs`, in B1's `stmts(db)` literal, insert directly below the `variantIns:` member:

```js
    // W1-B4 Task 8 (§9.15 "Mark"): a variant first seen after its entry was exported clears the entry's marks, so the
    // next export pass writes the entry again with every variant (O39); so does a sidecar row first linked to it.
    exportClear: db.prepare('UPDATE entries SET exported_ms = NULL, exported_seg = NULL WHERE entry_id = ? AND exported_ms IS NOT NULL'),
```

In B1's `writeChunk`, insert directly below `        s.variantIns.run(entryId, blobId, chunk.fileId, chunk.nowMs, cause);`:

```js
        s.exportClear.run(entryId);   // in the chunk's own transaction: the variant and the cleared mark commit together
```

In B1's `ingestSidecar`, inside its second `withTx(db, 'NORMAL', () => { … })`, insert directly below `      if (ins.changes === 1 && entryId === null) bump(db, 'sidecar_unlinked');`:

```js
      // W1-B4 Task 8 (⟦D:history-export-late-sidecar-clears-marks⟧, NEW): a sidecar row first linked after its entry was
      // exported clears the entry's marks, in this transaction, so the next pass writes the entry again with the new
      // row and its bytes. A no-op for an entry not yet exported.
      if (ins.changes === 1 && entryId !== null) stmts(db).exportClear.run(entryId);
```

`ingestSidecar` already reads `stmts(db)` (its `blobIns` and `blobId`), so no import or handle is new.

- [ ] **Step 4: The check after a bind.** Insert directly ABOVE the entry guard, below Task 6's block:

```js
// ── W1-B4 Task 8: the marks after a bind (spec §9.15 "After a bind"; D-4226) ───────────────
// lib decides (coordinator ruling RD2): decideMarkCheck whether a step checks and what the check records, from the bind
// facts' KEYS and never their clocks; missingSegmentNames which marked segments this box lacks. This block measures the
// meta keys, the last check's record, the marked names and the directory listing, calls those, and acts.

/** meta: when the export last checked its marks against the segments on this box (for display; never a decision). */
const EXPORT_MARKS_CHECKED_META = 'export_marks_checked_ms';
/** meta: the bind facts the last check covered, as lib decideMarkCheck's `record` gives them (a JSON list of
 *  `bound:<ms>` keys). */
const EXPORT_MARKS_CHECKED_BINDS_META = 'export_marks_checked_binds';

/** The meta keys that may be bind facts: every adopt, restore and rebuild writes `bound:<ms>` inside its binding
 *  transaction (⟦D:history-binding-facts-before-link⟧). A measurement only: lib decideMarkCheck says which are facts.
 *  [] when none: a store only ever created on this box has nothing to check. */
function bindFactKeys(db) {
  return db.prepare("SELECT k FROM meta WHERE k LIKE 'bound:%'").all().map((r) => String(r.k));
}

/** §9.15 "After a bind": every blob and entry mark whose segment is not in export/<store_id>/ on THIS box is cleared,
 *  so its rows export again. A directory left on the box the store came from is the usual cause; carrying it before
 *  the verb avoids the re-export (§8.4). Which names are missing is lib missingSegmentNames' answer over the marked
 *  names and the listing measured here. One NORMAL transaction; when anything was cleared, export_segment_missing +1
 *  and HEALTH_META.exportSegmentMissing holds how many marks, which doctor WARNs on until a complete pass resets it.
 *  Either way it records its clock and `record`, the bind facts lib decideMarkCheck says it covers. One DISTINCT scan
 *  of exported_seg per bind; the column has no index and gets none. A listing that fails for any reason but ENOENT
 *  throws (listSegments), before anything is cleared or recorded; exportStep counts it and the next step tries again. */
export function checkSegmentMarks(db, ctx, record) {
  const dir = exportDirFor(ctx.paths, ctx.ids.storeId);
  const present = existsSync(dir) ? listSegments(dir).map((x) => x.name) : [];
  const named = new Set();
  for (const r of db.prepare('SELECT DISTINCT exported_seg AS seg FROM blobs WHERE exported_seg IS NOT NULL').all()) named.add(String(r.seg));
  for (const r of db.prepare('SELECT DISTINCT exported_seg AS seg FROM entries WHERE exported_seg IS NOT NULL').all()) named.add(String(r.seg));
  const segments = missingSegmentNames({ named, present });
  let cleared = 0;
  withTx(db, 'NORMAL', () => {
    const blobs = db.prepare('UPDATE blobs SET exported_ms = NULL, exported_seg = NULL WHERE exported_seg = ?');
    const entries = db.prepare('UPDATE entries SET exported_ms = NULL, exported_seg = NULL WHERE exported_seg = ?');
    for (const seg of segments) cleared += Number(blobs.run(seg).changes) + Number(entries.run(seg).changes);
    if (cleared > 0) {
      bump(db, 'export_segment_missing');
      setMeta(db, HEALTH_META.exportSegmentMissing, String(cleared));
    }
    setMeta(db, EXPORT_MARKS_CHECKED_META, String(ctx.now()));
    setMeta(db, EXPORT_MARKS_CHECKED_BINDS_META, record);
  });
  return { cleared, segments };
}
```

In `exportStep` (Task 6), insert directly below `export async function exportStep(db, ctx) {`:

```js
  // §9.15 "After a bind": first, and outside the cadence, on the first step after an adopt, a restore or a rebuild. lib
  // decideMarkCheck decides it from WHICH bind facts the last check covered, never their clocks (RD2). A check that
  // cannot list the directory is counted and tried again next step, never thrown out of the tick.
  const markCheck = decideMarkCheck({ metaKeys: bindFactKeys(db), checkedRecord: getMeta(db, EXPORT_MARKS_CHECKED_BINDS_META) });
  if (markCheck.check) {
    try { checkSegmentMarks(db, ctx, markCheck.record); } catch (e) {
      if (isBusy(e)) throw e;
      process.stderr.write(`history-sweep: the export marks could not be checked against ${exportDirFor(ctx.paths, ctx.ids.storeId)}: ${e && e.message ? e.message : String(e)}\n`);
      countOutside(db, 'export_marks_check_failed');
    }
  }
```

In `noteExportPassDone`, add directly below `  setMeta(db, HEALTH_META.exportPassMs, String(nowMs));`:

```js
  // A complete pass left no due row behind: what a missing segment's cleared marks owed has exported again (Task 8).
  if (complete && (getMeta(db, HEALTH_META.exportSegmentMissing) ?? '0') !== '0') setMeta(db, HEALTH_META.exportSegmentMissing, '0');
```

From the repository root, run Task 5 Step 6's script with `want = {'./lib.mjs': ['decideMarkCheck', 'missingSegmentNames']}`, add what it prints, then run `node --check ccd/history/sweep.mjs` and Task 5 Step 6's guard checks. No other import is new: `existsSync`, `listSegments`, `withTx`, `bump`, `getMeta`, `setMeta` and `HEALTH_META` came in with Tasks 5 and 6, and `isBusy` and `countOutside` are B1's own in this module. Then confirm the sweep holds no bind-fact grammar of its own (RD2): `grep -nE "bound:\[0-9\]|JSON\.parse\(getMeta\(db, EXPORT_MARKS_CHECKED_BINDS_META" ccd/history/sweep.mjs || echo 'the bind check is decided in lib'` must print the `echo` line.

- [ ] **Step 5: Run and see it pass, with the hot ingest path.** From inside `server/`, each in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts
./node_modules/.bin/vitest run test/history-ingest.test.ts
./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'O20'
./node_modules/.bin/vitest run test/history-recover.test.ts
node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected: every case green, tsc silent. `history-ingest` runs because the variant branch and `ingestSidecar` are B1's ingest path (DM2, DM2b, the DM47 sidecar cases and O20's RSS bound must hold); a red in it that is not a variant or sidecar case is re-run alone before it is called a break. `history-recover` runs because its adopt, restore and rebuild cases now meet the bind check on their first tick after the bind: on a store with no export marks the check clears nothing and writes only `export_marks_checked_ms` and `export_marks_checked_binds` (an exact meta listing there takes Task 6 Step 7's second rule).

- [ ] **Step 6: Mutations — each new guard reds its case.** From the repository root: `cp ccd/history/sweep.mjs "$SCRATCH/sweep.mjs.t8"; cp ccd/history/lib.mjs "$SCRATCH/lib.mjs.t8"` (`SCRATCH` as in Task 5 Step 8). Apply each by hand; run from inside `server/` with `./node_modules/.bin/vitest run test/history-export.test.ts -t '<filter>'`; see it red; restore both files with `cp` before the next. Never `git stash`. The predicate's own mutants are Task 1's (pure, RD2); the `lib.mjs` row below runs one of them through this file, to show the sweep acts on lib's answer.

| Mutation | `-t` filter | Expected red |
|---|---|---|
| In `writeChunk`, delete the line `        s.exportClear.run(entryId);   …` | `a variant first seen after` | `the late variant left its entry marked` |
| In `ingestSidecar`, delete the line `      if (ins.changes === 1 && entryId !== null) stmts(db).exportClear.run(entryId);` | `a sidecar linked after its entry` | `the late sidecar left its entry marked: expected { …: '1.<writer>.db' } to deeply equal { …: null }` |
| In `exportStep`, ignore lib's answer: change `  if (markCheck.check) {` to `  if (true) {` (a check on every step) | `not again until the next one` | `a check ran with no bind since the last one: expected [ null, null ] to deeply equal [ '1.<writer>.db', '1.<writer>.db' ]` |
| In `checkSegmentMarks`, record no fact covered: replace `    setMeta(db, EXPORT_MARKS_CHECKED_BINDS_META, record);` with `    setMeta(db, EXPORT_MARKS_CHECKED_BINDS_META, '[]');` | `not again until the next one` | `a check ran with no bind since the last one: expected [ null, null ] to deeply equal [ '1.<writer>.db', '1.<writer>.db' ]` |
| In `lib.mjs`'s `decideMarkCheck`, decide by clocks (Task 1's mutant `RD2 after a bind: decided by the facts' clocks, not their keys`): replace `  return { check: facts.some((k) => !have.has(k)), facts, record: JSON.stringify(facts) };` with `  return { check: facts.some((k) => Number(k.slice(6)) > Math.max(0, ...[...have].map((c) => Number(c.slice(6))))), facts, record: JSON.stringify(facts) };` | `never their clocks` | `a bind stamped before the last check was never checked: expected [ '1.<writer>.db', '1.<writer>.db' ] to deeply equal [ null, null ]` |
| In `exportStep`, unwrap the check: replace `    try { checkSegmentMarks(db, ctx, markCheck.record); } catch (e) {` with `    checkSegmentMarks(db, ctx, markCheck.record); if (false) { const e = null;` | `cannot list export` | the step rejects with `ENOTDIR: not a directory, scandir '…'` |
| In `checkSegmentMarks`, delete the line `    for (const seg of segments) cleared += …;` | `bind clears those naming a missing one` | `expected [ '1.<writer>.db', '1.<writer>.db' ] to deeply equal [ null, null ]` |
| In `noteExportPassDone`, delete the `HEALTH_META.exportSegmentMissing` reset line | `after an adopt with the segments left behind` | `the re-export left nothing due behind: the WARN clears: expected '4' to be '0'` |
| In `checkSegmentMarks`, measure no segment present: change `missingSegmentNames({ named, present })` to `missingSegmentNames({ named, present: [] })` (every mark cleared, present or not) | `not again until the next one` | `expected [ null, null ] to deeply equal [ '1.<writer>.db', '1.<writer>.db' ]` right after the adopt's bind |

After the last restore, run the whole file green once more, and `cmp "$SCRATCH/sweep.mjs.t8" ccd/history/sweep.mjs` and `cmp "$SCRATCH/lib.mjs.t8" ccd/history/lib.mjs` print nothing: `lib.mjs` ends this task unchanged.

- [ ] **Step 7: Commit**, from the repository root:

```bash
git add ccd/history/sweep.mjs server/test/history-export.test.ts
git commit -m "feat(history): export marks that move — a late variant or a late-linked sidecar clears its entry's marks; the first tick after a bind clears marks whose segment is missing (W1-B4)"
```
### Task 9: status and doctor: export-due with the writer live; the pause and last pass in status --json; the census's oldest due-since; doctor's O41 rows re-planted

**Files:**
- Modify: `ccd/history/lib.mjs` (B1-created; B2 and Tasks 1–3 extend it). Anchors are by content, in B1 Task 28's health block:
  - in `deriveHealth`, the one line that begins `  if (h.exportDue > 0 && !h.exportWriterLive) warn.push(item('export-due',` is replaced in place by two lines;
  - in `remedyFor`, two lines are inserted directly above its `    default:` line;
  - one section is appended at the END of the file (lib.mjs has no entry guard), after Tasks 1–3's sections.
- Modify: `ccd/history/lib.d.mts`: in `HealthInputs`, two fields directly after the line `  readonly exportPausedLowDisk: boolean;`, in place; and one block appended at the END (the due-since meta's three declarations).
- Modify: `ccd/history/sweep.mjs` (B1 Task 26's census; B2 and Tasks 3–8 extend the file). In place, all above the R1 entry guard:
  - in `exportCensus`, two lines after `    state.overdue += plan.overdue.length;`, and one line after `  setMeta(db, 'export_overdue', String(state.overdue));`;
  - the `from './lib.mjs'` import gains `exportDueOldestMeta`, beside `planExport`;
  - in `periodicCensus`, the one line `    stepCursorSet(db, 'export-census', { last: 0, due: 0, overdue: 0, homeDays, startMs: nowMs });`.
- Modify: `ccd/history/cli.mjs` (B1 Tasks 27–28; B2 extends it). In place, all above the R1 entry guard:
  - `emptyEnvelope`: one line after `        oldest_row_ms: null, first_due_ms: null, first_deletion_ms: null,`;
  - `readStore`: one block (its comments and six statements) after `    ex.first_deletion_ms = num('first_deletion_ms');`;
  - `healthInputsOf`: its two placeholder lines `exportWriterLive: false, …// B4 sets it with the export writer` and `exportPausedLowDisk: false, …// B4 sets it with the export writer` are replaced by four;
  - one helper function, `segmentCount`, inserted directly above `statusWithHealth`'s doc comment (``/** `statusEnvelope` with its `health` filled and the store's device named. */``), so that comment stays on `export async function statusWithHealth(`.
- Modify: `server/test/history-lib.test.ts` (B1-created). In place: B1 Task 28's `base()` literal inside the describe `'deriveHealth: every §9.6 rule as a word with its class, detail and remedy (task 28)'`, its line `    thresholdBytes: 20_000_000_000, copyBps: null, backupsDb: [], journalStoreDirs: [], extrasUnmeasured: [],` (B1 Task 28F's `extrasUnmeasured` already ends it). Append one describe at the end of the file. No import line is added: B1 Task 28's namespace import `healthLib` covers every name used.
- Modify: `server/test/history-export.test.ts` (Task 5 creates it). Add one import block directly after the file's last import statement; append two describes at the end.
- Modify: `server/test/ccrc-doctor.test.ts`. The file is pre-existing (main-ro f7e51156f); the history describes it edits are B1 Task 32's end-appended ones, anchored by content. Other tests cite this file by line at `:66`, `:70`, `:195` and `:884` (measured at f7e51156f: `ccrc-install.test.ts`, `pool-name-parity.test.ts` and two in `ccrc-account.test.ts`; B1's history-CLI link block at `:110-115` moved the last two to `:200` and `:889` at B1's tip, and B2 Task 36 Step 4A re-cites those two by helper name, as Global Constraints says); every edit here is far below all four, inside B1's history describes (from `:1248` down at 561609adc), which B1 appended at the end of the file:
  - in `describeLinux('ccrc doctor: history — a real store, state by state (O15, O28, O37, O41, O55, DM43)', …)`'s `STATES` table: the three-line row whose `name` is `'O41: a due blob WARNs export-due, naming the count, and FAILs nothing while none is overdue'` is replaced; two rows are inserted after the two-line row whose `name` is `'O41: an overdue blob FAILs export-overdue'`;
  - in the same describe, one `it` is inserted after the `it` titled `'O41: nothing due and nothing overdue: neither export word'`;
  - in `describe('ccrc doctor: history — the relay (O15: every word, and the one rule no fixture can plant)', …)`, the `cleanInputs` literal's line `    journalStoreDirs: [], extrasUnmeasured: [],` (B1 Task 28F's field already on it) gains two fields on the same line.
- Not edited: `server/test/history-cli.test.ts`. B1 Task 28 put `base()` and every pure `deriveHealth` case in `history-lib.test.ts` (namespace `healthLib`); `history-cli.test.ts` holds no `HealthInputs` literal and is only re-run here (its STATUS_SQL cost pin), never edited. Re-checked at B1's tip (561609adc, after fix round 3, whose one row there pins the refused-node count): no case asserts the whole `export['claude-code']` block (`:341` pins only `Object.keys(e.export)`), and the `Envelope` type's `export` member (`:35`, `segments: number`, no `last_pass_ms`, `due_oldest_ms` or `paused_low_disk`) is a read-side annotation no case checks against the runtime value, so the new members and `segments: number | null` stay additive and the file needs no edit. If the base adds a `toEqual` on that block, add the three members (and `segments` as `number | null`) to it in place instead.

**Interfaces:**
- Consumes:
  - Task 1 (`lib.mjs`): `EXPORT_DIR = 'export'`, `EXPORT_PASS_INTERVAL_MS = 3_600_000`, `HEALTH_META.exportPassMs` (`'export_pass_ms'`), `HEALTH_META.exportDueOldestMs` (`'export_due_oldest_ms'`), `HEALTH_META.exportPaused` (`'export_paused'`), each declared in `lib.d.mts` by Task 1.
  - Task 2 (`lib.mjs`): `planExport(…)`'s answer gains `oldestDueSinceMs: number | null`: the minimum over the DATED due blobs of each blob's latest dated referrer due time, by the reducer (B2's per-copy default, so a referrer falls due when its last holding file on disk passes its mtime plus its home's horizon). A referrer nothing on disk holds back is dated by the last write its recorded files saw, else its row's time, never the epoch. It is null when no due blob carries a date, and the answer's `due` says whether any is due.
  - Task 4 (`store.mjs`): `listSegments(dir: string): { name: string; seq: number; writer: string; bytes: number }[]`, which lists by name and size and never opens a segment; it answers `[]` for an absent directory and throws for any other failure.
  - Tasks 5–6 (`sweep.mjs`): meta `HEALTH_META.exportPassMs` is the time of the last COMPLETED pass, written by every pass that ran to its end (`written`, `nothing-due`; Task 5's `noteExportPassDone`), never by a `no-horizon`, `paused`, `held` or `failed` one (a `no-horizon` pass judged nothing, so it is not a pass); meta `HEALTH_META.exportPaused` holds `planExportRoom`'s word (`low-disk` or `unsettled`) while the pass is paused for room, and `''` as soon as a preflight admits, whatever the pass then answers. `readStore` reads any non-empty value as paused.
  - B1 `lib.mjs` (Task 28): `deriveHealth`, `HealthInputs`, `HealthResult`, `HealthItem`, `HEALTH_REMEDIES`, `HEALTH_WORDS`, and the module-private `minutesOf`, `SWEEP_LOG`, `remedyFor`.
  - B1 `sweep.mjs` (Task 26): `exportCensus(db, nowMs, budget): boolean`, `periodicCensus(db, ctx)`, `stepCursorGet`/`stepCursorSet`/`stepCursorDone`, `getMeta`/`setMeta`; `newBudget(now, limits)` (B1 Task 19, B2 Task 25's limits). `HEALTH_META` is already in sweep.mjs's lib import (B2 Task 25).
  - B1 `cli.mjs` (Tasks 27–28): `emptyEnvelope(P)`, `readStore(env, P, nowMs)` with its private `num(k)`, `healthInputsOf(env, x, nowMs)`, the namespace imports `healthLib` and `healthStore`, and `join` from `node:path`.
  - B1 test side: `historyHelpers`' `makeHistoryBox`, `runSweep`, `HistoryBox`; B2 Task 10's `runCli(box, args, opts?)`; B1 Task 32's doctor helpers `historyBox`, `withStore`, `setHistoryMeta`, `freshTick`, `setExport`, `metaOnFreshTick`, `runHistoryCheck`, `historyLines`, `HEALTH_META` (already imported there) and `deriveHealth`'s `cleanInputs`.
- Produces:
  - `lib.mjs`: `HealthInputs` gains `exportLastPassMs: number | null` and `exportDueOldestMs: number | null | 'unmeasured'` (a time; null: the census counted nothing due; `'unmeasured'`: no census of this build recorded one, or it could date none of the due blobs), both required. lib also exports `EXPORT_DUE_OLDEST_UNMEASURED = 'unmeasured'`, `exportDueOldestMeta(due, dueOldestMs): string` (what the census writes: `''`, a positive whole-ms time, or the word) and `readExportDueOldest(v: string | undefined): number | null | 'unmeasured'` (what status reads: `''` is null, a positive integer is a time, and anything else, an absent key and `'0'` included, is the word), each declared once in `lib.d.mts`. `deriveHealth`'s `export-due` rule becomes three arms, decided by the module-private `exportGapArm(h): 'no-writer' | 'stale-pass' | 'waited' | null`:
    - `no-writer` (B1's ruled arm, unchanged): `exportDue > 0 && !exportWriterLive`;
    - `stale-pass`: the writer live, `exportLastPassMs !== null && nowMs − exportLastPassMs > 2 × EXPORT_PASS_INTERVAL_MS`;
    - `waited`: the writer live, `exportDueOldestMs` a number and `nowMs − exportDueOldestMs > 2 × EXPORT_PASS_INTERVAL_MS`; null and `'unmeasured'` never fire it.
    `stale-pass` outranks `waited`; each arm has its own detail (`exportDueDetail`) and remedy (`exportDueRemedy`, reached through `remedyFor`). No `HEALTH_WORDS` member is added.
  - `sweep.mjs`: the census state gains `dueOldest: number | null` (a B1-started census that lacks it reads as null). On completion the census sets meta `HEALTH_META.exportDueOldestMs` to `exportDueOldestMeta(state.due, state.dueOldest)`: `''` when it counted nothing due, the time, or `'unmeasured'` when it counted due blobs and could date none (the sweep delivers, lib decides).
  - `cli.mjs`: the envelope's `export[h]` gains `last_pass_ms: number | null`, `due_oldest_ms: number | null | 'unmeasured'` (lib's `readExportDueOldest` over the meta value; `'unmeasured'` in the no-store envelope) and `paused_low_disk: boolean`; `segments` and `segment_bytes` are filled from `listSegments` over `export/<store_id>/` (both `null` when the directory cannot be listed: unmeasured, never zero). `healthInputsOf` sets `exportWriterLive: true` and maps the three new inputs. No statement is added to the status path, so B1's STATUS_SQL cost pin is unchanged.

**Spec:**
- §9.6 "WARN on": `export-due` (the B4 arm) and `export-paused-low-disk`; §9.15 "The gap guard"; §9.11 O41's B4 cases ("steady state with an hourly pass → PASS; a due blob older than two pass intervals, or a last pass older than 2 h → WARN"), O40's doctor clause.
- Pins: O41 (B4 cases); O40's doctor WARN.
- Departures: B1's D-4207 (`history-export-due-escalates`); B1's D-4251 (`history-doctor-state-words`) (its precedence unchanged); ⟦D:history-export-wait-from-census⟧ (NEW: the "waited more than two pass intervals" rule needs a due-since time, and the spec names no clock for it. The census computes it from the store's rows, never from a date. Census staleness (≤ 30 min) plus the pass interval (≤ 1 h) stays under 2 h, so a steady store reads PASS); B1's D-4248 (`history-export-holding-files-by-transcript`) (reused: the due-since is the census's, read through the same reducer (B2's per-copy default, ⟦D:history-export-due-per-copy⟧) and the same per-row file set, a referrer's transcript's files, as Task 5's pass decides by, so the wait arm and the pass never disagree about which rows are due).

**Choices this task makes:**
- **The writer arms are wired here** (B1's D-4207 (`history-export-due-escalates`)): B1 shipped the arm for a build without the export writer (a WARN from the first due blob) and its `export-overdue` FAIL; this task sets `exportWriterLive` and wires the two writer arms the row describes, `export-due` only after two pass intervals (`waited`) or a stale pass (`stale-pass`). B1's arm is kept for a build without the writer.
- An unmeasured clock (a last pass of `null`, a due-since of `'unmeasured'`) fires neither writer arm by itself: no pass since this build landed, or no census since, is not a gap until the other clock says so.
- The census's due-since is one of three values in meta, in `status --json`'s `due_oldest_ms` and in `HealthInputs`: a time; `null` (the census counted nothing due, meta `''`); `'unmeasured'` (no census of this build has written the key, or the census counted due blobs and could date none of them). Only lib's `exportDueOldestMeta` writes it and only `readExportDueOldest` reads it. B1's `num()` folds an absent key and `''` into one null, so it is not used here. No value at or before the epoch is a time, so status never relays a 1970 date and doctor never counts minutes from it (⟦D:history-export-wait-from-census⟧). `'unmeasured'` fires no wait arm; the stale-pass arm still guards.
- A stale pass outranks a wait in the one `export-due` item; the paused export keeps its own `export-paused-low-disk` WARN beside it, and `export-due`'s remedy then names the room first.
- `segments`/`segment_bytes` read `null` on a listing that throws, so status never reports an unlistable export as empty.

- [ ] **Step 1: Write the failing pure tests.** In `server/test/history-lib.test.ts`, inside the describe `'deriveHealth: every §9.6 rule as a word with its class, detail and remedy (task 28)'`, replace the one line of its `base` literal (B1 Task 28F's `extrasUnmeasured: [],` already ends it, so the two new fields follow that one)

```ts
    thresholdBytes: 20_000_000_000, copyBps: null, backupsDb: [], journalStoreDirs: [], extrasUnmeasured: [],
```

with

```ts
    thresholdBytes: 20_000_000_000, copyBps: null, backupsDb: [], journalStoreDirs: [], extrasUnmeasured: [], exportLastPassMs: null, exportDueOldestMs: null,
```

Then append at the end of the file:

```ts
// ── W1-B4 Task 9: export-due with the export writer live (spec §9.6, §9.15 "The gap guard"; O41's B4 cases) ─────
// Pure, every input a parameter, the clock included. B1's arm (no export writer: WARN from the first due blob) is
// Task 28's describe above; these are the arms a build with the writer adds.
describe('deriveHealth, W1-B4: with the export writer live, export-due waits for a gap (O41\'s B4 cases)', () => {
  const NOW = 1_800_000_000_000;
  const MIN = 60_000;
  const STORE = '5f0c2d3e-8a1b-4c2d-9e3f-0a1b2c3d4e5f';
  const GAP = 2 * healthLib.EXPORT_PASS_INTERVAL_MS;
  const gapMin = Math.round(GAP / MIN);
  /** Task 28's healthy baseline on a build with the export writer: five blobs due, an hourly pass ten minutes ago,
   *  the oldest due blob ninety minutes old. Every case breaks one leg of it. */
  const live = (o: Partial<healthLib.HealthInputs> = {}): healthLib.HealthInputs => ({
    nowMs: NOW, storeId: STORE, exit: 0, reason: null,
    shimMtimeMs: NOW - 60 * MIN, lastTickMs: NOW - MIN, lagS: 5, sizeBytes: 1_000_000,
    capGb: 50, capMalformed: false, capFile: '/home/u/.ccrc/cap-fixture', capturePause: '',
    migration: 'none', userVersion: 1, codeVersion: 1, historyOff: false, recovering: null, op: null,
    bytesBehindLast3: [0, 0, 0], fts: 'ready', modesWrong: [], rootIsSymlink: false,
    redactUnreadable: [], breakerOpen: false, rosterUnreadable: false, exportDue: 5, exportOverdue: 0,
    exportWriterLive: true, exportPausedLowDisk: false, retentionLowered: null, retentionUnmeasured: [],
    journalGrowth30d: 0, journalSkipped: 0, blobUndecodable: 0, drainRejected: 0, spoolDisplaced: 0, spoolBlocked: 0, spoolUnreadable: 0, spoolNotDirectory: false, spoolNodesRefused: 0,
    exportSegmentNewer: [], exportSegmentMissing: 0,
    journalUnwritable: false, dbPath: '/home/u/.ccrc/history/db', freeBytes: 100_000_000_000,
    thresholdBytes: 20_000_000_000, copyBps: null, backupsDb: [], journalStoreDirs: [], extrasUnmeasured: [],
    exportLastPassMs: NOW - 10 * MIN, exportDueOldestMs: NOW - 90 * MIN,
    ...o,
  });
  const dueItem = (r: healthLib.HealthResult): healthLib.HealthItem | undefined => r.warn.find((i) => i.word === 'export-due');

  it('steady state at every phase between a census, a pass and the next census: PASS ok, nothing to warn', () => {
    for (const passAgo of [1, 30, 59, 61, 89]) {
      for (const oldestAgo of [0, 45, 90, 119]) {
        expect(healthLib.deriveHealth(live({ exportLastPassMs: NOW - passAgo * MIN, exportDueOldestMs: NOW - oldestAgo * MIN })),
          `pass ${passAgo} min ago, oldest due ${oldestAgo} min ago`).toEqual({ pass: 'ok', warn: [], fail: [] });
      }
    }
  });

  it('a due blob that has waited more than two pass intervals WARNs export-due, naming the count and the wait', () => {
    const r = healthLib.deriveHealth(live({ exportDueOldestMs: NOW - GAP - MIN }));
    expect(r.warn.map((i) => i.word)).toEqual(['export-due']);
    expect(dueItem(r)!.detail).toBe(
      `store ${STORE}: 5 unexported blob(s) are due, the oldest for ${gapMin + 1} min (over ${gapMin} min, two export pass intervals)`);
    expect(dueItem(r)!.remedy).toContain('one segment an hour');
  });

  it('a last pass more than two intervals old WARNs export-due naming its age; it outranks the wait, and its remedy reads the sweep', () => {
    const r = healthLib.deriveHealth(live({ exportLastPassMs: NOW - GAP - 2 * MIN, exportDueOldestMs: NOW - GAP - MIN }));
    expect(r.warn.map((i) => i.word)).toEqual(['export-due']);
    expect(dueItem(r)!.detail).toBe(
      `store ${STORE}: 5 unexported blob(s) are due, and the last export pass completed ${gapMin + 2} min ago (over ${gapMin} min)`);
    expect(dueItem(r)!.remedy).toContain('read the sweep: journalctl --user -u ccd-history-sweep');
  });

  it('the threshold is strict: exactly two intervals is no gap, one minute past is', () => {
    expect(healthLib.deriveHealth(live({ exportDueOldestMs: NOW - GAP })).pass).toBe('ok');
    expect(healthLib.deriveHealth(live({ exportLastPassMs: NOW - GAP })).pass).toBe('ok');
    expect(dueItem(healthLib.deriveHealth(live({ exportDueOldestMs: NOW - GAP - MIN })))).toBeDefined();
    expect(dueItem(healthLib.deriveHealth(live({ exportLastPassMs: NOW - GAP - MIN })))).toBeDefined();
  });

  it('an unmeasured clock fires neither writer arm by itself: no pass yet and no census yet is no WARN', () => {
    expect(healthLib.deriveHealth(live({ exportLastPassMs: null, exportDueOldestMs: 'unmeasured' })).pass).toBe('ok');
    expect(dueItem(healthLib.deriveHealth(live({ exportLastPassMs: null, exportDueOldestMs: NOW - GAP - MIN })))).toBeDefined();
    expect(dueItem(healthLib.deriveHealth(live({ exportLastPassMs: NOW - GAP - MIN, exportDueOldestMs: 'unmeasured' })))).toBeDefined();
  });

  it('the census\'s due-since meta: nothing due writes \'\' and reads null; due blobs it could date none of write unmeasured; a key never written reads unmeasured, never "nothing due"; no value at or before the epoch is a time', () => {
    expect(healthLib.EXPORT_DUE_OLDEST_UNMEASURED).toBe('unmeasured');
    expect(healthLib.exportDueOldestMeta(0, null)).toBe('');
    expect(healthLib.exportDueOldestMeta(0, NOW - 90 * MIN), 'nothing due: no clock is carried').toBe('');
    expect(healthLib.exportDueOldestMeta(3, NOW - 90 * MIN + 0.4), 'a file clock\'s fraction is rounded').toBe(String(NOW - 90 * MIN));
    for (const t of [null, 0, 0.3, -5, Number.NaN, Number.NEGATIVE_INFINITY]) expect(healthLib.exportDueOldestMeta(3, t), String(t)).toBe('unmeasured');
    expect(healthLib.readExportDueOldest('')).toBeNull();
    expect(healthLib.readExportDueOldest(undefined)).toBe('unmeasured');
    expect(healthLib.readExportDueOldest('unmeasured')).toBe('unmeasured');
    for (const v of ['0', '-5', '1.5', 'NaN', ' 12']) expect(healthLib.readExportDueOldest(v), v).toBe('unmeasured');
    expect(healthLib.readExportDueOldest(String(NOW - 90 * MIN))).toBe(NOW - 90 * MIN);
    expect(healthLib.readExportDueOldest(healthLib.exportDueOldestMeta(3, NOW - 90 * MIN)), 'round trip').toBe(NOW - 90 * MIN);
  });

  it('an unmeasured due-since never fires the wait arm, so no export-due detail ever counts minutes from the epoch', () => {
    expect(dueItem(healthLib.deriveHealth(live({ exportDueOldestMs: healthLib.readExportDueOldest('0') })))).toBeUndefined();
    expect(dueItem(healthLib.deriveHealth(live({ exportDueOldestMs: 'unmeasured' })))).toBeUndefined();
    // CONTROL: a real clock past two intervals fires it, its minutes counted from that clock.
    expect(dueItem(healthLib.deriveHealth(live({ exportDueOldestMs: NOW - GAP - MIN })))!.detail).toContain(`the oldest for ${gapMin + 1} min`);
  });

  it('nothing due, whatever the clocks: no export-due', () => {
    expect(healthLib.deriveHealth(live({ exportDue: 0, exportLastPassMs: NOW - 10 * GAP, exportDueOldestMs: NOW - 10 * GAP })).pass).toBe('ok');
  });

  it('with the pass paused for room, export-due\'s remedy is that room, beside its own export-paused-low-disk WARN', () => {
    const r = healthLib.deriveHealth(live({ exportPausedLowDisk: true, exportLastPassMs: NOW - GAP - MIN }));
    expect(r.warn.map((i) => i.word)).toEqual(['export-due', 'export-paused-low-disk']);
    expect(dueItem(r)!.remedy).toContain('paused for room');
  });

  it('a build without the writer keeps B1\'s arm: a WARN from the first due blob, with B1\'s detail and remedy', () => {
    const r = healthLib.deriveHealth(live({ exportWriterLive: false, exportDue: 1 }));
    expect(dueItem(r)!.detail).toBe(`store ${STORE}: 1 unexported blob(s) are due by the horizon, and this build has no export writer`);
    expect(dueItem(r)!.remedy).toBe(healthLib.HEALTH_REMEDIES['export-due']);
  });
});
```

- [ ] **Step 2: Run them and see them fail.** From the repository root, in the foreground, timeout ≥ 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'export-due waits for a gap')
```

Expected: red. The steady-state, nothing-due and without-the-writer cases already hold (B1's rule fires only without the writer). The waited, stale-pass, strict-threshold, unmeasured-clock and paused cases fail, for example `expected [] to deeply equal [ 'export-due' ]` and `expected undefined to be defined`. The two new due-since cases fail too: `healthLib.exportDueOldestMeta is not a function` (and `EXPORT_DUE_OLDEST_UNMEASURED` reads undefined), and in the wait-arm case `healthLib.readExportDueOldest is not a function`.

- [ ] **Step 3: Write the lib rule.** In `ccd/history/lib.mjs`, in `deriveHealth`, replace the one line

```js
  if (h.exportDue > 0 && !h.exportWriterLive) warn.push(item('export-due', `${h.exportDue} unexported blob(s) are due by the horizon, and this build has no export writer`));
```

with

```js
  const exportGap = exportGapArm(h);   // W1-B4 Task 9: the gap guard's arms (§9.15), decided at the end of this file
  if (exportGap !== null) warn.push(item('export-due', exportDueDetail(exportGap, h)));
```

In `remedyFor`, insert directly above its line `    default:`:

```js
    case 'export-due':
      return exportDueRemedy(h);
```

Append at the END of `ccd/history/lib.mjs`:

```js
// ── W1-B4 Task 9: export-due on a build with the export writer (spec §9.6, §9.15 "The gap guard") ──────────────
// B1 shipped the ruled arm for a build without the writer: WARN from the first due blob. With the writer (this
// build), rows cross the horizon continuously and the pass runs at most hourly, so a due count alone is the pass's
// ordinary cadence, not a gap. export-due then WARNs only when the last completed pass is older than two pass
// intervals, or the oldest due blob the census counted has waited longer than that (chosen: 2 h). Both clocks are
// the store's own (meta the pass and the census keep), never a calendar date (O41; D-4207).
// The census's due-since is its own measure of the rows, read at most one census interval late, which keeps a
// steady store under the threshold (⟦D:history-export-wait-from-census⟧, NEW).
// The three helpers are function declarations: deriveHealth and remedyFor, above, call them at call time, and the
// constant they read (EXPORT_PASS_INTERVAL_MS, Task 1) is initialised by then.

/** Which arm of export-due fires, or null. `no-writer` is B1's ruled arm; `stale-pass` outranks `waited`. A clock
 *  that is not a time fires neither writer arm by itself: a last pass of null (none since this build landed), and a
 *  due-since of null (the census counted nothing due) or EXPORT_DUE_OLDEST_UNMEASURED (no census of this build has
 *  recorded one, or it could date none of the due blobs). `over` reads only a number. */
function exportGapArm(h) {
  if (!(h.exportDue > 0)) return null;
  if (!h.exportWriterLive) return 'no-writer';
  const gapMs = 2 * EXPORT_PASS_INTERVAL_MS;
  const over = (t) => typeof t === 'number' && h.nowMs - t > gapMs;
  if (over(h.exportLastPassMs)) return 'stale-pass';
  if (over(h.exportDueOldestMs)) return 'waited';
  return null;
}

/** export-due's detail, one per arm. B1's arm keeps B1's text verbatim. */
function exportDueDetail(arm, h) {
  const gapMin = minutesOf(2 * EXPORT_PASS_INTERVAL_MS);
  if (arm === 'stale-pass') {
    return `${h.exportDue} unexported blob(s) are due, and the last export pass completed ${minutesOf(h.nowMs - h.exportLastPassMs)} min ago (over ${gapMin} min)`;
  }
  if (arm === 'waited') {
    return `${h.exportDue} unexported blob(s) are due, the oldest for ${minutesOf(h.nowMs - h.exportDueOldestMs)} min (over ${gapMin} min, two export pass intervals)`;
  }
  return `${h.exportDue} unexported blob(s) are due by the horizon, and this build has no export writer`;
}

/** export-due's remedy, by arm: B1's for a build without the writer; the room first while the pass is paused for
 *  it; the sweep's log for a pass that stopped completing; nothing to do while a backlog drains. */
function exportDueRemedy(h) {
  const arm = exportGapArm(h);
  if (arm === null || arm === 'no-writer') return HEALTH_REMEDIES['export-due'];
  if (h.exportPausedLowDisk) return 'free space on the home filesystem: the export pass is paused for room there, and the due text waits for it';
  if (arm === 'stale-pass') return `read the sweep: ${SWEEP_LOG}; an export pass completes at least hourly, and none has for over two intervals`;
  return `none needed while the backlog drains at one segment an hour; if the count does not fall, read the sweep: ${SWEEP_LOG}`;
}

// The census's oldest due-since in meta (HEALTH_META.exportDueOldestMs), written and read back here only, so the sweep
// delivers and status relays, and neither decides (⟦D:history-export-wait-from-census⟧). Three values, never folded:
//   ''                            the census counted nothing due (read back: null);
//   a positive integer            when the oldest dated due blob fell due (read back: the number);
//   EXPORT_DUE_OLDEST_UNMEASURED  blobs are due and the census could date none (no clock on record, or only the part a
//                                 B1 pass started counted them); a key never written reads the same, never "nothing
//                                 due". No value at or before the epoch is a time: it would render as 1970 and the
//                                 wait arm would count some 29 million minutes from it.

/** The word for a due-since the census has not measured (status --json's due_oldest_ms, HealthInputs). */
export const EXPORT_DUE_OLDEST_UNMEASURED = 'unmeasured';

/** What the census writes on completion, from its due count and its oldest dated due-since (planExport's
 *  oldestDueSinceMs, min over chunks). A file clock's fraction of a ms is rounded. */
export function exportDueOldestMeta(due, dueOldestMs) {
  if (!(due > 0)) return '';
  const ms = typeof dueOldestMs === 'number' && Number.isFinite(dueOldestMs) ? Math.round(dueOldestMs) : 0;
  return ms > 0 ? String(ms) : EXPORT_DUE_OLDEST_UNMEASURED;
}

/** The census's due-since read back from meta: a time, null (nothing due), or EXPORT_DUE_OLDEST_UNMEASURED. */
export function readExportDueOldest(v) {
  if (v === undefined) return EXPORT_DUE_OLDEST_UNMEASURED;
  if (v === '') return null;
  return /^[1-9][0-9]*$/.test(v) ? Number(v) : EXPORT_DUE_OLDEST_UNMEASURED;
}
```

`EXPORT_DUE_OLDEST_UNMEASURED` is a `const` in this appended block; `exportGapArm` names it only in its doc comment, and `readExportDueOldest` and `exportDueOldestMeta` read it at call time, after the module has loaded.

In `ccd/history/lib.d.mts`, in `export interface HealthInputs`, insert directly after the line `  readonly exportPausedLowDisk: boolean;`:

```ts
  /** W1-B4 Task 9: the last completed export pass (meta HEALTH_META.exportPassMs); null before the first. */
  readonly exportLastPassMs: number | null;
  /** W1-B4 Task 9: when the oldest due blob the census counted became due (meta HEALTH_META.exportDueOldestMs, read by
   *  readExportDueOldest): a time; null when the census counted nothing due; 'unmeasured' when no census of this build
   *  has recorded it, or it could date none of the due blobs. Never a time at or before the epoch. */
  readonly exportDueOldestMs: number | null | 'unmeasured';
```

Then append to the END of `ccd/history/lib.d.mts`:

```ts
// --- W1-B4 Task 9: the census's oldest due-since in meta, written and read back (no epoch, no overloaded null)
export const EXPORT_DUE_OLDEST_UNMEASURED: 'unmeasured';
export function exportDueOldestMeta(due: number, dueOldestMs: number | null): string;
export function readExportDueOldest(v: string | undefined): number | null | 'unmeasured';
```

Check: `grep -c '^export function readExportDueOldest(' ccd/history/lib.d.mts ccd/history/lib.mjs` prints 1 for each file.

- [ ] **Step 4: Run them and see them pass, then the typecheck.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
git grep -n 'exportWriterLive:' -- server/test
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- `history-lib.test.ts` green, B1 Task 28's describe included. Its `['export-due', 'warn', { exportDue: 12 }]` row and the first assertion of `'a B1 build WARNs export-due from the first due blob; a live export writer (B4) is B4\'s rule'` hold because `base()` keeps `exportWriterLive: false`. That case's second assertion (`exportWriterLive: true`, `exportDue: 1` → pass `'ok'`) holds only because `base()` carries `exportLastPassMs: null` and `exportDueOldestMs: null`, so neither writer arm fires. Step 1 therefore gives `base()` both fields as null, never a time (and never `'unmeasured'` either: `base()` has nothing due, which is what null says).
- `git grep` lists every `HealthInputs` literal under `server/test`: Task 28's `base` and this task's `live` in `history-lib.test.ts`, and `cleanInputs` in `ccrc-doctor.test.ts`. Each must carry the two new fields; Step 5 adds them to `cleanInputs`. Any other literal the grep prints (one a later B2 or B4 task added) gains `exportLastPassMs: null, exportDueOldestMs: null` on its `journalStoreDirs` line, after that line's `extrasUnmeasured: [],`, the same way.
- tsc: red on `cleanInputs` only (`Property 'exportLastPassMs' is missing`) until Step 5; after Step 5, no output. `live` is not red because Step 1 gives it the seven fields B1's fix rounds made required on `HealthInputs` (`blobUndecodable`, `drainRejected`, `spoolDisplaced`, `spoolBlocked`, `spoolUnreadable`, `spoolNotDirectory`, `spoolNodesRefused`; `lib.d.mts:384-391` at 561609adc), as B1's `base()` and `cleanInputs` already carry them. A `live` without them is red here too (`Property 'blobUndecodable' is missing`), though its cases still pass at runtime: add them, never a cast.

- [ ] **Step 5: Write the failing delivery tests.** Three files.

(a) `server/test/ccrc-doctor.test.ts`, in the relay describe's `cleanInputs`, replace the one line (its last; B1 Task 28F's `extrasUnmeasured: [],` already ends it)

```ts
    journalStoreDirs: [], extrasUnmeasured: [],
```

with

```ts
    journalStoreDirs: [], extrasUnmeasured: [], exportLastPassMs: null, exportDueOldestMs: null,
```

(b) `server/test/ccrc-doctor.test.ts`, in the `STATES` table of `'ccrc doctor: history — a real store, state by state …'`, replace the three lines

```ts
    { name: 'O41: a due blob WARNs export-due, naming the count, and FAILs nothing while none is overdue', word: 'export-due', cls: 'WARN',
      plant: (home) => withStore(home, (db) => { freshTick(db); setExport(db, 3, 0); }),
      names: () => ['3'], absent: ['FAIL history: export-overdue'] },
```

with

```ts
    // O41's B4 cases: this build has the export writer, so a due count alone is the pass's cadence; the WARN needs
    // a gap — the last pass over two intervals old, or the oldest due blob waiting longer than that.
    { name: 'O41 (B4): a due blob with the last export pass over 2 h old WARNs export-due, naming the count, and FAILs nothing while none is overdue', word: 'export-due', cls: 'WARN',
      plant: (home) => withStore(home, (db) => { freshTick(db); setExport(db, 3, 0); setHistoryMeta(db, HEALTH_META.exportPassMs, String(Date.now() - 3 * 3_600_000)); }),
      names: () => ['3'], absent: ['FAIL history: export-overdue'] },
```

Then, directly after the two lines

```ts
    { name: 'O41: an overdue blob FAILs export-overdue', word: 'export-overdue', cls: 'FAIL',
      plant: (home) => withStore(home, (db) => { freshTick(db); setExport(db, 3, 2); }) },
```

insert

```ts
    { name: 'O41 (B4): a due blob that has waited over two pass intervals WARNs export-due, though the last pass is fresh', word: 'export-due', cls: 'WARN',
      plant: (home) => withStore(home, (db) => {
        freshTick(db);
        setExport(db, 3, 0);
        setHistoryMeta(db, HEALTH_META.exportPassMs, String(Date.now() - 10 * 60_000));
        setHistoryMeta(db, HEALTH_META.exportDueOldestMs, String(Date.now() - 3 * 3_600_000));
      }),
      names: () => ['3'], absent: ['FAIL history: '] },
    { name: 'O40 (B4): an export paused for room on the home filesystem WARNs export-paused-low-disk, and FAILs nothing', word: 'export-paused-low-disk', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportPaused, 'low-disk')),   // Task 6 writes planExportRoom's word
      absent: ['FAIL history: '] },
```

Then, in the same describe, directly after the closing `  });` of the `it` titled `'O41: nothing due and nothing overdue: neither export word'`, insert

```ts

  it('O41 (B4): steady state — three blobs due, an hourly pass 10 min ago, the oldest due 90 min ago — PASSes ok', () => {
    const { home, storeId } = historyBox('ccrc-doctor-history-export-steady-');
    withStore(home, (db) => {
      freshTick(db);
      setExport(db, 3, 0);
      setHistoryMeta(db, HEALTH_META.exportPassMs, String(Date.now() - 10 * 60_000));
      setHistoryMeta(db, HEALTH_META.exportDueOldestMs, String(Date.now() - 90 * 60_000));
    });
    const r = runHistoryCheck(home);
    expect(historyLines(r.stdout), r.stdout).toHaveLength(1);
    expect(historyLines(r.stdout)[0]).toMatch(new RegExp(`^PASS history: ok: store ${storeId}: `));
    expect(r.code).toBe(0);
  });
```

Locate the three anchors with this check first, from the repository root; each count must be 1:

```bash
grep -c "name: 'O41: a due blob WARNs export-due, naming the count, and FAILs nothing while none is overdue'" server/test/ccrc-doctor.test.ts
grep -c "name: 'O41: an overdue blob FAILs export-overdue'" server/test/ccrc-doctor.test.ts
grep -c "it('O41: nothing due and nothing overdue: neither export word'" server/test/ccrc-doctor.test.ts
```

(c) `server/test/history-export.test.ts` (Task 5's file). Its `vitest` import must name `describe`, `it`, `expect` and `beforeEach`; add any of the four that is missing to that import line. Then add this block directly after the file's last import statement. Every binding is new, so none collides with Tasks 5–8's imports:

```ts
// ── W1-B4 Task 9: imports under x9 aliases, so no binding collides with Tasks 5–8 above ───────────────────────
import * as x9Fs from 'node:fs';
import * as x9Path from 'node:path';
import { createHash as x9Hash } from 'node:crypto';
import { DatabaseSync as X9Db } from 'node:sqlite';
import * as x9Lib from '../../ccd/history/lib.mjs';
import * as x9Store from '../../ccd/history/store.mjs';
import * as x9H from './historyHelpers.js';
```

Append at the end of the file:

```ts
// ── W1-B4 Task 9: the census's oldest due-since, and status --json's export block (spec §9.6, §9.15) ─────────────
// The census case runs sweep.mjs's exportCensus in-process against a real store; the status cases spawn the real
// CLI, as doctor does. Every HOME is a fixture (makeHistoryBox); nothing reads or writes the live ~/.ccrc.
interface X9Sweep {
  exportCensus(db: X9Db, nowMs: number, budget: Record<string, unknown>): boolean;
  newBudget(now?: () => number, limits?: { maxMs?: number; maxBytes?: number; chunkBytes?: number }): Record<string, unknown>;
}
interface X9Item { word: string; detail: string; remedy: string }
interface X9Export {
  due_blobs: number; segments: number | null; segment_bytes: number | null;
  last_pass_ms: number | null; due_oldest_ms: number | null | 'unmeasured'; paused_low_disk: boolean;
}
interface X9Envelope { exit: number; export: Record<string, X9Export>; health: { pass: string | null; warn: X9Item[]; fail: X9Item[] } }
const X9_MIN = 60_000;
const X9_HOUR = 3_600_000;

describe('W1-B4 Task 9: the census records when the oldest due blob became due (spec §9.15 "The gap guard")', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  /** A store holding two due blobs, each with one referrer row in a transcript of its own whose one file is present
   *  and was last written five and three hours ago (so neither is overdue), and a census in progress over one 30-day
   *  home (horizon 0). Under the per-copy rule (⟦D:history-export-due-per-copy⟧) each row is due from its file's last
   *  write, so the two rows need two files to fall due at two times. Each time is whole seconds, so a file's mtime
   *  set by utimes reads back exactly. `cursor` is the census state as a pass left it. Runs exportCensus to its end;
   *  answers the two meta values. */
  async function x9Census(prefix: string, cursor: (ids: { a: number; b: number }, home: string) => Record<string, unknown>):
    Promise<{ due: string | null; oldest: string | null; tA: number; tB: number }> {
    const sw = (await import('../../ccd/history/sweep.mjs')) as unknown as X9Sweep;
    const box = x9H.makeHistoryBox(prefix);
    x9Store.createStore(box.home);
    const home = box.homes[0]!;
    const now = Date.now();
    const tA = Math.floor((now - 5 * X9_HOUR) / 1000) * 1000;
    const tB = Math.floor((now - 3 * X9_HOUR) / 1000) * 1000;
    const db = x9Store.openWriter(x9Lib.historyPaths(box.home).dbFile);
    try {
      /** One transcript with one present file of `home`, last written at `atMs`: its rows' per-copy clock. */
      const transcript = (uuid: string, name: string, ino: number, atMs: number): { t: number; f: number } => {
        const file = x9Path.join(home, 'projects', '-home-u-tree-demo', name);
        x9Fs.mkdirSync(x9Path.dirname(file), { recursive: true });
        x9Fs.writeFileSync(file, '{}\n');
        x9Fs.utimesSync(file, atMs / 1000, atMs / 1000);
        const t = Number(db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)').run(uuid).lastInsertRowid);
        const f = Number(db.prepare("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, status, parser_version) VALUES (1, ?, '', ?, 'live', 1)")
          .run(ino, t).lastInsertRowid);
        db.prepare('INSERT INTO file_paths (path, file_id, last_seen_ms) VALUES (?, ?, ?)').run(file, f, now);
        return { t, f };
      };
      const older = transcript('90909090-0000-4000-8000-000000000001', 'x9-census-a.jsonl', 2, tA);
      const younger = transcript('90909090-0000-4000-8000-000000000002', 'x9-census-b.jsonl', 3, tB);
      const blob = (text: string): number => Number(db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?)')
        .run(x9Hash('sha256').update(text).digest(), x9Store.CODEC, x9Store.brotli(Buffer.from(text)), Buffer.byteLength(text)).lastInsertRowid);
      const a = blob('x9 the older due row');
      const b = blob('x9 the younger due row');
      const entry = (uuid: string, at: { t: number; f: number }, blobId: number, tsMs: number): void => {
        db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'operator', 1, 1, ?, ?, ?)")
          .run(uuid, at.t, at.f, blobId, tsMs);
      };
      entry('90909090-0000-4000-8000-0000000000a1', older, a, tA);
      entry('90909090-0000-4000-8000-0000000000b1', younger, b, tB);
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('export-census', 1, ?, NULL)")
        .run(JSON.stringify(cursor({ a, b }, home)));
      expect(sw.exportCensus(db, now, sw.newBudget(() => now)), 'the census ran to its end').toBe(true);
      return { due: x9Store.getMeta(db, 'export_due'), oldest: x9Store.getMeta(db, x9Lib.HEALTH_META.exportDueOldestMs), tA, tB };
    } finally {
      x9Store.closeWriter(db);
    }
  }

  it('over two due blobs, a census B4 started records the EARLIER due-since: with a horizon of 0, the older file\'s last write (the per-copy clock)', async () => {
    const r = await x9Census('ccrc-hist-x9-census-', (_ids, home) => ({ last: 0, due: 0, overdue: 0, homeDays: { [home]: 30 }, startMs: Date.now(), dueOldest: null }));
    expect(r.due).toBe('2');
    expect(r.oldest).toBe(String(r.tA));
  });

  it('a census a B1 pass started carries no dueOldest: B4 resumes it, reads the field as null, and records the due-since of the blobs it counted', async () => {
    const r = await x9Census('ccrc-hist-x9-census-b1-', (ids, home) => ({ last: ids.a, due: 1, overdue: 0, homeDays: { [home]: 30 }, startMs: Date.now() }));
    expect(r.due).toBe('2');
    expect(r.oldest).toBe(String(r.tB));
  });

  it('a due blob nothing on disk holds back dates by the last write its recorded files saw, never the epoch; one with no clock on record leaves the due-since unmeasured, never "nothing due"', async () => {
    const sw = (await import('../../ccd/history/sweep.mjs')) as unknown as X9Sweep;
    const box = x9H.makeHistoryBox('ccrc-hist-x9-census-gone-');
    x9Store.createStore(box.home);
    const home = box.homes[0]!;
    const now = Date.now();
    const tGone = Math.floor((now - 4 * X9_HOUR) / 1000) * 1000;
    const db = x9Store.openWriter(x9Lib.historyPaths(box.home).dbFile);
    try {
      const t = Number(db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)').run('90909090-0000-4000-8000-000000000003').lastInsertRowid);
      // Ingested, then deleted out of band: its path no longer stats, and its recorded mtime is all that dates it.
      const f = Number(db.prepare("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, mtime_ns, status, parser_version) VALUES (1, 4, '', ?, ?, 'live', 1)")
        .run(t, BigInt(tGone) * 1_000_000n).lastInsertRowid);
      db.prepare('INSERT INTO file_paths (path, file_id, last_seen_ms) VALUES (?, ?, ?)')
        .run(x9Path.join(home, 'projects', '-home-u-tree-demo', 'x9-gone.jsonl'), f, now);
      const b = Number(db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?)')
        .run(x9Hash('sha256').update('x9 gone').digest(), x9Store.CODEC, x9Store.brotli(Buffer.from('x9 gone')), 7).lastInsertRowid);
      db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'operator', 1, 1, ?, ?, ?)")
        .run('90909090-0000-4000-8000-0000000000c1', t, f, b, tGone);
      /** One whole census over one 180-day home (horizon 150 days: only a file gone from disk makes this row due). */
      const census = (): string | null => {
        db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('export-census', 1, ?, NULL) ON CONFLICT (step, version) DO UPDATE SET cursor = excluded.cursor, completed_ms = NULL")
          .run(JSON.stringify({ last: 0, due: 0, overdue: 0, homeDays: { [home]: 180 }, startMs: now, dueOldest: null }));
        expect(sw.exportCensus(db, now, sw.newBudget(() => now)), 'the census ran to its end').toBe(true);
        return x9Store.getMeta(db, x9Lib.HEALTH_META.exportDueOldestMs);
      };
      expect(census(), 'the recorded last write, 4 h ago: never \'0\' (1970)').toBe(String(tGone));
      expect(x9Store.getMeta(db, 'export_due')).toBe('1');
      // The same file with no mtime on record (B1's transcriptFiles reads it as 0): still due and counted, and undated.
      db.prepare('UPDATE ingest_files SET mtime_ns = NULL WHERE file_id = ?').run(f);
      expect(census(), 'due but undated is unmeasured, never \'\' (nothing due)').toBe('unmeasured');
      expect(x9Store.getMeta(db, 'export_due')).toBe('1');
    } finally {
      x9Store.closeWriter(db);
    }
  });
});

describe('W1-B4 Task 9: status --json reads the export pass and counts segments; doctor\'s export-due waits for a gap (spec §9.6, §9.15)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  /** A bound store after B1's first-install pass (the export's hourly clock has not run out, so no pass wrote
   *  anything), then `meta` planted as the pass and the census leave it. */
  function x9Bound(prefix: string, meta: Record<string, string>): { box: x9H.HistoryBox; storeId: string } {
    const box = x9H.makeHistoryBox(prefix, { role: 'fleet', shim: true });
    const r = x9H.runSweep(box);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    const P = x9Lib.historyPaths(box.home);
    const db = x9Store.openWriter(P.dbFile);
    try { for (const [k, v] of Object.entries(meta)) x9Store.setMeta(db, k, v); } finally { x9Store.closeWriter(db); }
    return { box, storeId: x9Fs.readFileSync(P.storeId, 'utf8').trim() };
  }
  /** `ccrc history status --json` as doctor runs it: exit 0 and a clean stderr. */
  function x9Status(box: x9H.HistoryBox): X9Envelope {
    const r = x9H.runCli(box, ['status', '--json']);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stderr).toBe('');
    return r.json as unknown as X9Envelope;
  }
  const exportOf = (e: X9Envelope): X9Export => e.export[x9Lib.HARNESSES[0]!]!;

  it('the export block names the last pass, the oldest due-since and the pause from meta, and counts segments by name and size without opening one', () => {
    const now = Date.now();
    const { box, storeId } = x9Bound('ccrc-hist-x9-env-', {
      [x9Lib.HEALTH_META.exportPassMs]: String(now - 10 * X9_MIN),
      [x9Lib.HEALTH_META.exportDueOldestMs]: String(now - 40 * X9_MIN),
      [x9Lib.HEALTH_META.exportPaused]: 'low-disk',
    });
    const dir = x9Path.join(box.root, x9Lib.EXPORT_DIR, storeId);
    x9Fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Not a database: status must count it by name and size. A read of it would fail on its first statement.
    const body = 'not a database: status never opens a segment\n';
    x9Fs.writeFileSync(x9Path.join(dir, '1.0a1b2c3d.db'), body, { mode: 0o600 });
    x9Fs.writeFileSync(x9Path.join(dir, '.2.0a1b2c3d.db.tmp'), 'a writer\'s temp is no segment', { mode: 0o600 });
    const e = x9Status(box);
    expect(exportOf(e)).toMatchObject({
      segments: 1, segment_bytes: Buffer.byteLength(body),
      last_pass_ms: now - 10 * X9_MIN, due_oldest_ms: now - 40 * X9_MIN, paused_low_disk: true,
    });
    expect(e.health.warn.map((i) => i.word)).toContain('export-paused-low-disk');
    // CONTROL: a store none of them touched. Its first pass's census counted nothing due, so meta holds '' and
    // due_oldest_ms reads null: nothing due, which is not 'unmeasured'.
    const bare = x9Bound('ccrc-hist-x9-env-bare-', {});
    expect(exportOf(x9Status(bare.box))).toMatchObject({
      segments: 0, segment_bytes: 0, last_pass_ms: null, due_oldest_ms: null, paused_low_disk: false,
    });
    // No overloaded null: a key no census of this build wrote reads 'unmeasured', never null ("nothing due").
    const never = x9Bound('ccrc-hist-x9-env-never-', { export_due: '3', [x9Lib.HEALTH_META.exportPassMs]: String(now - 10 * X9_MIN) });
    const ndb = x9Store.openWriter(x9Lib.historyPaths(never.box.home).dbFile);
    try { ndb.prepare('DELETE FROM meta WHERE k = ?').run(x9Lib.HEALTH_META.exportDueOldestMs); } finally { x9Store.closeWriter(ndb); }
    const ne = x9Status(never.box);
    expect(exportOf(ne).due_oldest_ms).toBe('unmeasured');
    expect(ne.health.warn.map((i) => i.word), 'an unmeasured due-since fires no wait arm').not.toContain('export-due');
    // No epoch: a stored '0' is not a time, so status never relays 1970 and doctor never counts 29 million minutes.
    const epoch = x9Bound('ccrc-hist-x9-env-epoch-', {
      export_due: '3', [x9Lib.HEALTH_META.exportPassMs]: String(now - 10 * X9_MIN), [x9Lib.HEALTH_META.exportDueOldestMs]: '0',
    });
    const ee = x9Status(epoch.box);
    expect(exportOf(ee).due_oldest_ms).toBe('unmeasured');
    expect(ee.health.warn.map((i) => i.word)).not.toContain('export-due');
  }, 120_000);

  it('doctor\'s inputs through status: a due count with a fresh pass and a young due-since is no WARN; a due-since over two intervals, or a pass over 2 h old, WARNs export-due', () => {
    const now = Date.now();
    const passKey = x9Lib.HEALTH_META.exportPassMs;
    const oldestKey = x9Lib.HEALTH_META.exportDueOldestMs;
    const steady = x9Bound('ccrc-hist-x9-steady-', { export_due: '3', [passKey]: String(now - 10 * X9_MIN), [oldestKey]: String(now - 90 * X9_MIN) });
    expect(x9Status(steady.box).health.warn.map((i) => i.word)).not.toContain('export-due');
    const waited = x9Bound('ccrc-hist-x9-waited-', { export_due: '3', [passKey]: String(now - 10 * X9_MIN), [oldestKey]: String(now - 3 * X9_HOUR) });
    expect(x9Status(waited.box).health.warn.find((i) => i.word === 'export-due')?.detail).toContain('3 unexported blob(s) are due, the oldest for');
    const stale = x9Bound('ccrc-hist-x9-stale-', { export_due: '3', [passKey]: String(now - 3 * X9_HOUR) });
    expect(x9Status(stale.box).health.warn.find((i) => i.word === 'export-due')?.detail).toContain('3 unexported blob(s) are due, and the last export pass completed');
  }, 120_000);
});
```

- [ ] **Step 6: Run them and see them fail.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'W1-B4 Task 9')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'O41|O40 \(B4\)')
```

Expected: red.
- The census cases fail on the due-since meta: `expected null to be '…'` (no census writes `export_due_oldest_ms` yet). `export_due` already reads `'2'`, and `'1'` in the gone-file case, whose first assertion fails as `expected null to be '<tGone>'`.
- The envelope case fails at `toMatchObject`: `last_pass_ms`, `due_oldest_ms` and `paused_low_disk` are absent and `segments` reads 0 (the `never` and `epoch` lines after the CONTROL are not reached until it passes; after Step 7 they hold).
- The doctor-inputs case fails at `not.toContain('export-due')`: B1's `healthInputsOf` still answers `exportWriterLive: false`, so the first due blob WARNs.
- In `ccrc-doctor.test.ts`: the steady-state `it` fails (`WARN history: export-due` instead of one PASS line), and so does the `O40 (B4)` row (no `WARN history: export-paused-low-disk: store` line). The two `O41 (B4)` export-due rows already pass on B1's arm, as does B1's untouched overdue row.

- [ ] **Step 7: Write the census and the status half.**

In `ccd/history/sweep.mjs`, in `exportCensus`, directly after the line `    state.overdue += plan.overdue.length;`, insert:

```js
    // W1-B4 Task 9: when the oldest due blob became due (§9.15 "The gap guard"; ⟦D:history-export-wait-from-census⟧),
    // on this census's own clock, the one the pass selects by (D-4248).
    // A census a B1 pass started carries no dueOldest: it reads as null, never as a time.
    const prevOldest = typeof state.dueOldest === 'number' ? state.dueOldest : null;
    state.dueOldest = plan.oldestDueSinceMs === null ? prevOldest : (prevOldest === null ? plan.oldestDueSinceMs : Math.min(prevOldest, plan.oldestDueSinceMs));
```

In the same function, directly after the line `  setMeta(db, 'export_overdue', String(state.overdue));`, insert:

```js
  setMeta(db, HEALTH_META.exportDueOldestMs, exportDueOldestMeta(state.due, state.dueOldest));   // '', a time, or 'unmeasured': lib decides
```

and, in sweep.mjs's `from './lib.mjs'` import, add `exportDueOldestMeta` beside `planExport`. Check: `grep -c 'exportDueOldestMeta' ccd/history/sweep.mjs` prints 2.

In `periodicCensus`, replace the one line

```js
    stepCursorSet(db, 'export-census', { last: 0, due: 0, overdue: 0, homeDays, startMs: nowMs });
```

with

```js
    stepCursorSet(db, 'export-census', { last: 0, due: 0, overdue: 0, homeDays, startMs: nowMs, dueOldest: null });
```

In `ccd/history/cli.mjs`, in `emptyEnvelope`, directly after the line `        oldest_row_ms: null, first_due_ms: null, first_deletion_ms: null,`, insert:

```js
        last_pass_ms: null, due_oldest_ms: healthLib.EXPORT_DUE_OLDEST_UNMEASURED, paused_low_disk: false,
```

In `readStore`, directly after the line `    ex.first_deletion_ms = num('first_deletion_ms');`, insert:

```js
    // W1-B4 Task 9: the export pass's own record (HEALTH_META, Task 1), and its segments counted by name and size,
    // never opened (§9.15 "Who reads it": only the recovery step).
    ex.last_pass_ms = num(healthLib.HEALTH_META.exportPassMs);
    // Never num(), which reads an absent key and '' as one null: lib's reader keeps "nothing due" (null) apart from
    // "no census of this build measured it" ('unmeasured'), and reads no value at or before the epoch as a time.
    ex.due_oldest_ms = healthLib.readExportDueOldest(meta.get(healthLib.HEALTH_META.exportDueOldestMs));
    ex.paused_low_disk = (meta.get(healthLib.HEALTH_META.exportPaused) ?? '') !== '';
    const segs = env.store_id === null ? { n: 0, bytes: 0 } : segmentCount(join(P.root, healthLib.EXPORT_DIR, String(env.store_id)));
    ex.segments = segs.n;
    ex.segment_bytes = segs.bytes;
```

In `healthInputsOf`, replace the two lines

```js
    exportWriterLive: false,       // B4 sets it with the export writer
    exportPausedLowDisk: false,    // B4 sets it with the export writer
```

with

```js
    exportWriterLive: true,        // W1-B4: this build carries the export writer (a build fact, never measured)
    exportPausedLowDisk: exp.paused_low_disk === true,
    exportLastPassMs: typeof exp.last_pass_ms === 'number' ? exp.last_pass_ms : null,
    exportDueOldestMs: exp.due_oldest_ms === undefined ? healthLib.EXPORT_DUE_OLDEST_UNMEASURED : exp.due_oldest_ms,   // lib's reader made it
```

Insert directly above `statusWithHealth`'s own doc comment, the line ``/** `statusEnvelope` with its `health` filled and the store's device named. */`` (B1's cli.mjs puts it on the line before `export async function statusWithHealth(home, nowMs) {`), followed by one blank line, so each function keeps its own doc comment:

```js
/** W1-B4 Task 9: the export's segments under `dir`, by name and size (store.mjs listSegments), never opened. A
 *  listing that throws is unmeasured (null), never zero: an absent directory is listSegments' own [] (no export yet). */
function segmentCount(dir) {
  let list;
  try { list = healthStore.listSegments(dir); } catch { return { n: null, bytes: null }; }
  return { n: list.length, bytes: list.reduce((sum, s) => sum + s.bytes, 0) };
}

```

The result reads, in order: `segmentCount`'s doc comment, `function segmentCount(dir) {` … `}`, a blank line, ``/** `statusEnvelope` with its `health` filled and the store's device named. */``, `export async function statusWithHealth(home, nowMs) {`.

Then check the placement and the guards, from the repository root:

```bash
for f in ccd/history/sweep.mjs ccd/history/cli.mjs; do
  grep -c 'import.meta.url === pathToFileURL' "$f"                                   # 1
  sed -n "$(grep -n 'import.meta.url === pathToFileURL' "$f" | cut -d: -f1),\$p" "$f" | grep -c 'segmentCount\|dueOldest'   # 0
  node --check "$f"
done
grep -c 'B4 sets it with the export writer' ccd/history/cli.mjs                          # 0
```

- [ ] **Step 8: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'W1-B4 Task 9')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: all green; tsc prints nothing. In `ccrc-doctor.test.ts` every history describe is green: the gates, every `STATES` row (O41's re-planted row WARNs on the last-pass arm, the waited row on the wait arm, `O40 (B4)` on the pause), the steady-state PASS, and the relay's `CONTROL: deriveHealth answers the clean inputs with PASS ok`.

- [ ] **Step 9: Measure every new guard red, then green.** From the repository root. Each block copies the file aside, applies one exact replacement asserted to match once, runs one filter and shows it red, then restores with `cp`. The python bodies are quoted heredocs.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w1-b4/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}

# M1 (O41's CONTROL): B1's rule kept on a build with the writer — a WARN from the first due blob.
cp ccd/history/lib.mjs "$SCRATCH/lib.orig"
mut ccd/history/lib.mjs "  if (!h.exportWriterLive) return 'no-writer';" "  return 'no-writer';"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'steady state at every phase')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED: expected { pass: null, warn: [ { word: 'export-due', … } ] } to deeply equal { pass: 'ok', … }.

# M2 (O41's CONTROL): the wait arm dropped.
mut ccd/history/lib.mjs "  if (over(h.exportDueOldestMs)) return 'waited';" ""
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'waited more than two pass intervals')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED: expected [] to deeply equal [ 'export-due' ].

# M3: the CLI answers that this build has no writer.
cp ccd/history/cli.mjs "$SCRATCH/cli.orig"
mut ccd/history/cli.mjs "    exportWriterLive: true, " "    exportWriterLive: false, "
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'O41 \(B4\): steady state')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED: the history lines hold a WARN history: export-due line, so toHaveLength(1) fails.

# M4: the pause not mapped into deriveHealth's input.
mut ccd/history/cli.mjs "    exportPausedLowDisk: exp.paused_low_disk === true," "    exportPausedLowDisk: false,"
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'O40 \(B4\)')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED: no "WARN history: export-paused-low-disk: store " line.

# M5: segments not counted.
mut ccd/history/cli.mjs "    ex.segments = segs.n;" "    ex.segments = 0;"
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'counts segments by name and size')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED: toMatchObject reads segments 0, expected 1.

# M6: a B1-started census's missing field read bare.
cp ccd/history/sweep.mjs "$SCRATCH/sweep.orig"
mut ccd/history/sweep.mjs "    const prevOldest = typeof state.dueOldest === 'number' ? state.dueOldest : null;" "    const prevOldest = state.dueOldest;"
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'a census a B1 pass started')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: expected 'unmeasured' to be '<tB>' (the NaN due-since is no time: lib's exportDueOldestMeta writes the word).

# M7 (no overloaded null): the census writes B4's first shape, '' for "due, but undated" as for "nothing due".
mut ccd/history/sweep.mjs "  setMeta(db, HEALTH_META.exportDueOldestMs, exportDueOldestMeta(state.due, state.dueOldest));   // '', a time, or 'unmeasured': lib decides" "  setMeta(db, HEALTH_META.exportDueOldestMs, typeof state.dueOldest === 'number' ? String(state.dueOldest) : '');"
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'nothing on disk holds back')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: expected '' to be 'unmeasured' (the file with no mtime on record).

# M8 (no overloaded null): a key no census wrote read as "nothing due".
mut ccd/history/lib.mjs "  if (v === undefined) return EXPORT_DUE_OLDEST_UNMEASURED;" "  if (v === undefined) return null;"
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'counts segments by name and size')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED: expected null to be 'unmeasured' (the store whose due-since key was never written).

# M9 (no epoch): B4's first reader, num(), reads '0' as a time.
mut ccd/history/lib.mjs '  return /^[1-9][0-9]*$/.test(v) ? Number(v) : EXPORT_DUE_OLDEST_UNMEASURED;' '  return Number.isFinite(Number(v)) ? Number(v) : EXPORT_DUE_OLDEST_UNMEASURED;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'never fires the wait arm')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED: expected { word: 'export-due', detail: '… the oldest for 29… min …', … } to be undefined.

git diff --stat -- ccd/history   # the three files show only this task's edits; re-run Step 8 once: green
```

- [ ] **Step 10: Run the neighbours that read these files.** Foreground, timeout ≥ 600000 ms; re-run a red file alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'O38|W1-j')
(cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'ends with doctor, and a box that passes every check exits 0')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
```

Then re-run, alone and in the foreground, every B1/B2 test file Task 6 Step 7 changed (its commit body lists them): this task maps `export_paused` into health and status, so a case Step 7 neutralised with `HISTORY_TEST_STATFS_EXPORT` now meets an `export-paused-low-disk` WARN if it reads health. A red there takes Task 6 Step 7's second rule.

Expected: green.
- `history-cli.test.ts`: its STATUS_SQL cost pin holds, because this task prepares no statement (the new fields come from the meta map `STATUS_SQL.meta` already read, and `listSegments` is a directory listing). Its other cases hold too: at B1's tip (561609adc, fix round 3 included) none asserts the whole export block, as this task's Files list records; re-read its status rows on the base before calling a red there a B4 defect.
- `history-op.test.ts`: B1's census cases (O38) hold with the census's new field.
- The fresh-install case stays at `0 warned`: a fresh store's first tick writes no export meta and its census counts nothing due.
- `single-definition`: no new `process.env` read, no `/history-off` spelling, no vocabulary declared outside lib.

- [ ] **Step 11: Commit.**

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs ccd/history/cli.mjs \
  server/test/history-lib.test.ts server/test/history-export.test.ts server/test/ccrc-doctor.test.ts
git commit -m "feat(history): export-due waits for a gap with the export writer live; status reads the export pass (W1-B4 Task 9)"
```

### Task 10: sweep: segment replay: export-blobs, then export-rows, in B2's recovery step; O44's segment case

**Files:**
- Modify: `ccd/history/sweep.mjs` (B1-created; B2 Task 25 wrote the recovery section; Task 3 put two placeholder executors in it). Anchors by content, all above the R1 entry guard `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`:
  - Task 3's two placeholder functions, `function recoverExportBlobsChunk(` and `function recoverExportRowsChunk(` (each with its doc comment, if it has one), are removed;
  - one section is inserted directly above the doc comment that begins `/** One executor per RECOVER_PHASES phase, keyed by its name.` (B2's, which Task 3 Step 5(c) edited and which documents the literal below it), where Task 3's placeholders were, so that doc comment stays directly on `export const RECOVER_EXECUTORS = Object.freeze({`. The literal itself is not edited: Task 3 already keys it `'export-blobs': recoverExportBlobsChunk` and `'export-rows': recoverExportRowsChunk`, between `apply:` and `reindex:`, and the section defines those two names again;
  - its lib and store import statements gain the names Step 6's script prints.
- Modify: `server/test/historyHelpers.ts` (B1-created; B2 Tasks 10 and 25 and Task 5 append to it): one import block at the end of its top import block; one section appended at the end of the file.
- Modify: `server/test/history-recover.test.ts` (B2 Task 25 created it; B2 Tasks 26–29 append): one section appended at the END of the file, after B2 Task 29's describes. No import line is added: it uses B2's module-scope names (`SW`, `stepCtx`, `cursorOn`, `countersOn`, `pass`, `rows`, `countOf`, `metaOf`, `registerRecovery`, `plantJournalFile`, `status`, `ID`, `WORK`) and B2 Tasks 25–27's imports (`fs`, `path`, `DatabaseSync`, `beforeEach`, `makeHistoryBox`, `runDriver`, `counters`, `recoverRow`, `PRELOADS`, `historyPaths`, `journalRecord`, `HEALTH_META`, `createStore`, `openWriter`, `closeWriter`, `rrRandomBytes`, and the namespaces `rrLib` and `rrH`), plus B2 Task 28's `rrJournalKinds`. Re-read the merged file's import block first: a name missing there is added to the import statement of its module, never as a second statement.

**Interfaces:**
- Consumes:
  - Task 3 (`lib.mjs`): `RECOVER_PHASES = ['index', 'apply', 'export-blobs', 'export-rows', 'reindex']`; `parseRecoverCursor`'s export arm (`<phase>[:<seq>.<writer>.db:<offset>][+pairs]`); `formatRecoverCursor` (B2's, printing `:<file>:<offset>` for a non-reindex phase); `decideSegmentReplay({ meta: { storeId, format }, storeId }): 'replay' | 'newer' | 'foreign'`; `orderSegmentNames(names): string[]` ((seq numeric, writer) order, unparseable names dropped).
  - Task 1 (`lib.mjs`): `EXPORT_DIR`, `EXPORT_SEGMENT_FORMAT`, `segmentName({ seq, writer })`, `exportedSourceKey(path, dev, ino): string` (`'exported:' + sha256Hex(path ∖0 dev ∖0 ino)`, dev and ino rendered decimal).
  - Task 4 (`store.mjs`, declared in `store.d.mts`):
    - `openSegment(path): DatabaseSync` (read-only; throws on a path it cannot open as a regular file);
    - `segmentMeta(db): SegmentMeta` = `{ storeId, writer, seq, harnesses, cutoffMs, format }`, throwing `StoreError('segment-unreadable')`;
    - `segmentBlobsAfter(db, rowid, maxBytes): { rowid, sha256: Buffer, codec, raw_len, z: Buffer | null, pruned }[]`, which answers at least one blob while any is left past `rowid`, however small `maxBytes`;
    - `segmentRowsAfter(db, ord, limit): { ord, kind, row }[]`, `kind` one of `segmentInserts`' keys, `row` a plain object keyed by the row table's column names, its INTEGER ns, dev and ino columns read as BigInt;
    - `listSegments(dir): { name, seq, writer, bytes }[]`, `[]` for an absent directory;
    - `createSegment(dir, name, meta: SegmentMeta)`, `segmentInserts(seg)` (each insert takes ONE object keyed by its table's column names) and `publishSegment(seg, dir, name): 'linked' | 'exists'`, used by the test builder only. `createSegment` writes the meta it is given, `format` included, so a test can plant a newer format.
  - **The format-1 row contract this task reads** (Task 4 writes it, Task 5 fills it; every name below is a column of Task 4's `SEGMENT_DDL`, one table per `kind`; a row names its neighbours by natural keys only, never an internal id):

    | kind | columns read |
    |---|---|
    | `family` | `ccrc_id, generation, project, first_seen_ms` |
    | `transcript` | `cc_session_uuid, agent_id, harness, parent_tool_use_id, workflow_run_id, agent_type` |
    | `epoch` | `ccrc_id, generation, seq, cc_session_uuid, cause, declared_by, started_ms, cwd, git_branch, cwd_real, confirmed_ms` |
    | `file` | `path, dev, ino, cc_session_uuid, agent_id, size, mtime_ns, eof_ms` |
    | `entry` | `uuid, cc_session_uuid, agent_id, type, subtype, role, model, parent_uuid, ts_ms, request_id, api_block_index, msg_id, source_tool_use_id, tool_name, is_compact_summary, provenance, prov_version, parse_state, struct_rank_ns, struct_path, struct_dev, struct_ino, blob_sha256` |
    | `variant` | `uuid` (its entry), `blob_sha256, first_path, first_dev, first_ino, first_seen_ms, cause` |
    | `boundary` | `uuid` (its entry), `cc_session_uuid, agent_id, boundary_ord, trigger, head_uuid, anchor_uuid, tail_uuid, kept_sha256, pre_tokens, post_tokens, duration_ms` |
    | `sidecar` | `cc_session_uuid, agent_id, name, blob_sha256, uuid` (its entry, or null when unlinked), `first_seen_ms` |
    | `membership` | `path, dev, ino, uuid` (its entry), `line` |

    These are Task 4's `SegmentRows` names exactly: an entry is named by `uuid` in every kind, and a boundary's own per-transcript ordinal is `boundary_ord`, because `ord` is every row table's shared write-order key. `segmentInserts` throws on a missing or an extra key, so a planted row with any other name fails at `plantSegment`. Rows sit in one write order (`ord`) with every row's dependencies before it: its family, transcript, epoch and files (the entry's structural file and each variant's first file), then the entry, then its variants, boundary, sidecars and memberships (Task 4, Task 5).
  - B2 Task 25 (`sweep.mjs`, merged): `recoveryStep`'s `run` (`version`, `P`, `storeId`, `budget`, `now`, `pairsAdded`), `RECOVER_CURSOR_SQL`, the executor contract, `RECOVER_EXECUTORS`. Re-read the merged section before editing it: the B2 plan's text is not ground truth for it.
  - B1 `sweep.mjs`: `stmts(db)` (its `entryUpsert`, which is `ENTRY_UPSERT`'s newest-rank rule, and its `membership`, which keeps min(line)), `ensureFamily(db, ccrcId, generation, project, nowMs)`, `DELETE_CANDIDATE`, `PARSER_VERSION`, `withTx`, `bump`, `getMeta`, `setMeta`.
  - Test side: B2 Task 25's `stepCtx`, `registerRecovery`, `plantJournalFile`, `cursorOn`, `countersOn`, `pass`, `rows`, `countOf`, `metaOf`, `status`, `SW`; B2 Task 28's `rrJournalKinds`; `runDriver`'s `budgetBytes` and `chunkBytes` (B2 Task 25); the faults preload's `HISTORY_TEST_THROW_SQL` (B2 Task 25).
- Produces:
  - `sweep.mjs` (no `.d.mts`): the real `recoverExportBlobsChunk(db, run, cursor)` and `recoverExportRowsChunk(db, run, cursor)`, keeping B2's executor contract; their module-private helpers `exportPhaseChunk`, `exportReplayListing`, `openForReplay`, `noteSkippedSegment`, `replayBlobPage`, `replayRowPage`, `replayStmts`, the nine `replay…Row` applicators and `EXPORT_ROW_APPLY`.
  - Counters: `export_segment_foreign`, `export_row_blob_missing`, `export_epoch_conflict`, and `export_row_unplaced` (a row whose transcript, entry or file neither the store nor an earlier row of its segment placed).
  - Meta `HEALTH_META.exportSegmentNewer` (B1's key): reset to `'[]'` when an export-blobs phase starts, then the JSON list of every segment skipped as newer.
  - Rows written: `blobs` (insert-or-ignore by sha256; a blob with bytes marked `exported_ms`, `exported_seg`), a dead-file `ingest_files` row per gone file (`source_key` from `exportedSourceKey`, `status` `'exported'`, `eof_ms` carried or else the segment's cutoff, no `file_paths` row), and the named-column rows of the table above; every replayed entry marked with its segment.
  - `historyHelpers.ts`: `export type SegmentRowKind`, `export interface PlantSegmentRow { kind; row }`, `export interface PlantSegmentBlob { text: string | null; sha256?: Buffer; rawLen?: number }`, `export interface PlantSegmentSpec { seq; writer; blobs; rows; format?; cutoffMs?; metaStoreId? }`, `export function segmentSha(text: string): Buffer`, `export function plantSegment(box: HistoryBox, storeId: string, s: PlantSegmentSpec): string` (the published segment's path).

**Spec:**
- §9.14 "Export replay" (two passes, blobs first; rows in (seq, writer) order through the ingest's named-column inserts, entries by the newest-rank rule; families and epochs from the journal first, the segment filling only what the journal lacks; memberships onto dead-file rows; a newer format refused loudly and skipped; replayed blobs and rows marked with their segment); §9.14 "Recovery" (the cursor advanced in the same transaction as what it applies; the run budget and the floor; recovery-stalled); §9.3 (no floor exemption); §9.15 "Memberships of a gone file"; §6.2 (`ingest_files.source_key`); §9.10 "Export replay".
- Pins: **O44's segment case** (a format-2 segment → the step completes, doctor FAILs `export-segment-newer`); BK21's two-pass order; the journal-first fill; memberships never on a live row; the cursor in the chunk's transaction, resumable, `+pairs` carried; the floor; foreign and unreadable segments.
- Departures:
  - ⟦D:history-recovery-replay⟧, ⟦D:history-export-row-carries-blob⟧, B1's D-4179 (`history-free-space-floor`), ⟦D:history-recovery-chunk-failure-counted⟧ (B2's slug, reused: an unreadable segment fails its chunk), B1's D-4226 (`history-journal-writer-token`), ⟦D:history-b4-after-b2⟧;
  - ⟦D:history-export-pruned-row-stub⟧ (Task 2's NEW slug): a stub blob replays with `z` NULL and `pruned_ms` the replay's time, the time this store learned it was pruned;
  - ⟦D:history-export-late-sidecar-clears-marks⟧ (Task 8's NEW slug): the entry it re-exports sits in two segments, the second with its sidecar row and only the sidecar's bytes; replay absorbs the repeat through insert-or-ignore and newest-rank (a case below);
  - ⟦D:history-export-dead-file-eof⟧ (NEW): B2's leaf readiness reads the holding copy's `eof_ms`. A replayed `exported:` row with none would never ripen a raw leaf after source loss, so it takes the carried `eof_ms`, or the segment's cutoff;
  - ⟦D:history-export-segment-unreadable-stalls⟧ (NEW): §9.14 makes only a newer format skippable, and an unreadable segment silently skipped would drop text. The cost is named: no tick runs while the recovery step is registered (B2), so capture is held for the whole stall while Claude Code's retention keeps running. The chunk's failure line therefore names the way out (move the segment aside under a non-segment name to skip it, its text not replayed, or put a good copy back), and Task 12's PR body tells the operator to check a carried `export/<store_id>/` for zero-length or partial files before a restore or an adopt;
  - ⟦D:history-export-variant-first-file⟧ (NEW): a replayed variant's `first_file_id` is the dead-file row of the first file the segment names for it (`first_path`, `first_dev`, `first_ino`), the memberships' rule; when that row was not placed, its entry's own dead-file row. A gone file's identity is all a rebuild has, and schema v1's `first_file_id` is NOT NULL.

**Choices this task makes:**
- **Replay keeps the store's floor** (B1's D-4179 (`history-free-space-floor`)): the export phases probe `db/` before each chunk as every recovery chunk does, with no exemption, and a probe below the floor pauses them with `capture_paused_low_disk`, the cursor where it was (the floor case below). The export's own floor, on the home filesystem, gates only the export pass (Tasks 1 and 6).
- A row the segment cannot place is counted `export_row_unplaced` and skipped, never a foreign-key failure that stalls the step; a format-1 segment always places its rows, so only a damaged one meets it.
- A replayed blob's and entry's `exported_ms` is the replay's time and `exported_seg` the segment's name; a stub never counts as exported text, so it is not marked.
- An epoch the journal holds by uuid keeps its own `seq`, `cause` and `declared_by`; the segment fills its NULL launch facts, `cwd`, `cwd_real` and `confirmed_ms` (and drops the uuid's waiting candidate when it confirms one). An epoch the journal lacks is inserted at the segment's `seq`, unless that `seq` or that uuid is already taken (`export_epoch_conflict`).
- A family the journal holds keeps its project; a segment fills an empty one.
- A foreign segment is counted once per export-blobs walk of it; a walk restarted (its cursor's segment gone) counts it again.

- [ ] **Step 1: Give the tests their segment builder.** In `server/test/historyHelpers.ts`, add these three statements as the last lines of the file's top import block. Every binding is new:

```ts
import * as b4SegStore from '../../ccd/history/store.mjs';
import * as b4SegLib from '../../ccd/history/lib.mjs';
import { createHash as b4SegHash } from 'node:crypto';
```

Append at the end of the file:

```ts
// ── W1-B4 Task 10: export segments planted through store.mjs, for the replay cases ─────────────────────────────
/** The kinds of row a format-1 segment holds: Task 4's segmentInserts keys. */
export type SegmentRowKind = 'family' | 'transcript' | 'epoch' | 'file' | 'entry' | 'variant' | 'boundary' | 'sidecar' | 'membership';
/** One row as a segment carries it: its table's columns by name, natural keys only (Task 10's contract table). */
export interface PlantSegmentRow { kind: SegmentRowKind; row: Record<string, unknown> }
/** A blob as a segment stores it: `text` compressed with the store's codec, or a stub (`text: null`) for a blob
 *  prune tombstoned, which carries its sha256 and length and no bytes. */
export interface PlantSegmentBlob { text: string | null; sha256?: Buffer; rawLen?: number }
export interface PlantSegmentSpec {
  seq: number; writer: string; blobs: PlantSegmentBlob[]; rows: PlantSegmentRow[];
  /** a newer one to plant a segment this build must refuse; the build's own by default */
  format?: number;
  cutoffMs?: number;
  /** another store's id, to plant a foreign segment in this store's directory */
  metaStoreId?: string;
}

/** A blob's key as the store and a segment hold it: the sha256 of its raw bytes. */
export function segmentSha(text: string): Buffer {
  return b4SegHash('sha256').update(text, 'utf8').digest();
}

/** One published segment, ~/.ccrc/history/export/<storeId>/<seq>.<writer>.db, written through store.mjs's
 *  createSegment, segmentInserts and publishSegment (Task 4), so a planted segment and the export pass's share one
 *  DDL. Returns its path. Throws when the name is already on disk: a case never means to plant one twice. */
export function plantSegment(box: HistoryBox, storeId: string, s: PlantSegmentSpec): string {
  const dir = path.join(box.root, b4SegLib.EXPORT_DIR, storeId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = b4SegLib.segmentName({ seq: s.seq, writer: s.writer });
  const seg = b4SegStore.createSegment(dir, name, {
    storeId: s.metaStoreId ?? storeId, writer: s.writer, seq: s.seq, harnesses: [...b4SegLib.HARNESSES],
    cutoffMs: s.cutoffMs ?? Date.now(), format: s.format ?? b4SegLib.EXPORT_SEGMENT_FORMAT,
  });
  const ins = b4SegStore.segmentInserts(seg) as unknown as Record<string, (row: Record<string, unknown>) => void>;
  for (const b of s.blobs) {
    if (b.text === null) {
      if (b.sha256 === undefined) throw new Error('plantSegment: a stub blob needs its sha256');
      ins['blob']!({ sha256: b.sha256, codec: b4SegStore.CODEC, raw_len: b.rawLen ?? 0, z: null, pruned: true });
      continue;
    }
    const raw = Buffer.from(b.text, 'utf8');
    ins['blob']!({ sha256: b.sha256 ?? segmentSha(b.text), codec: b4SegStore.CODEC, raw_len: raw.length, z: b4SegStore.brotli(raw), pruned: false });
  }
  for (const r of s.rows) ins[r.kind]!(r.row);
  if (b4SegStore.publishSegment(seg, dir, name) !== 'linked') throw new Error(`plantSegment: ${name} is already in ${dir}`);
  return path.join(dir, name);
}
```

`fs`, `path` and `HistoryBox` are already this file's (B1 Task 14).

- [ ] **Step 2: Write the failing tests.** Append at the END of `server/test/history-recover.test.ts`:

```ts
// ── W1-B4 Task 10: export replay, the recovery step's two export phases (spec §9.14 "Export replay", §9.15) ─────
// Segments are planted through store.mjs (historyHelpers' plantSegment), never by hand, and every HOME is a fixture.
// In-process cases run sweep.mjs's recoveryStep on a store createStore made; the O44 and rollback cases spawn the
// real pass. Every name here is prefixed x10/X10, so nothing collides with B2's cases above.
const X10_ID = 'claude-a-segment';
const X10_G = '0189abcd-1234-4678-9abc-0000000010a1';
const X10_WRITER = '0a1b2c3d';
const X10_DEV = 64769;
const X10_DAY = 86_400_000;
const x10U = (n: number): string => `10101010-0000-4000-8000-${String(n).padStart(12, '0')}`;
interface X10Text { uuid: string; text: string; tsMs: number; line: number }
interface X10Family {
  uuid: string; path: string; ino: number; texts: X10Text[];
  id?: string; generation?: string; project?: string; seq?: number; cwd?: string; eofMs?: number | null;
}
/** `n` row texts of one transcript, old enough to be due anywhere, at byte offsets 0, 4096, … */
const x10Texts = (base: number, n: number, word: string, t0: number): X10Text[] =>
  Array.from({ length: n }, (_, i) => ({ uuid: x10U(base + i), text: `${word} row ${i} ${'x'.repeat(40)}`, tsMs: t0 + i * 1000, line: i * 4096 }));
/** One family's rows as a format-1 segment carries them (Task 10's contract table): the family, its transcript, one
 *  confirmed startup epoch launched in `cwd`, the gone file (path, dev, ino), then per text its entry and its
 *  membership. */
function x10Rows(o: X10Family): rrH.PlantSegmentRow[] {
  const id = o.id ?? X10_ID;
  const generation = o.generation ?? X10_G;
  const t0 = o.texts[0]?.tsMs ?? Date.now() - 400 * X10_DAY;
  const cwd = o.cwd ?? WORK;
  const out: rrH.PlantSegmentRow[] = [
    { kind: 'family', row: { ccrc_id: id, generation, project: o.project ?? 'demo', first_seen_ms: t0 } },
    { kind: 'transcript', row: { cc_session_uuid: o.uuid, agent_id: '', harness: 'claude-code', parent_tool_use_id: null, workflow_run_id: null, agent_type: null } },
    { kind: 'epoch', row: {
      ccrc_id: id, generation, seq: o.seq ?? 1, cc_session_uuid: o.uuid, cause: 'startup', declared_by: 'hook',
      started_ms: t0, cwd, git_branch: 'main', cwd_real: cwd, confirmed_ms: t0,
    } },
    { kind: 'file', row: {
      path: o.path, dev: X10_DEV, ino: o.ino, cc_session_uuid: o.uuid, agent_id: '', size: 4096 * o.texts.length,
      mtime_ns: BigInt(t0) * 1_000_000n, eof_ms: o.eofMs === undefined ? t0 + 60_000 : o.eofMs,
    } },
  ];
  for (const x of o.texts) {
    out.push({ kind: 'entry', row: {
      uuid: x.uuid, cc_session_uuid: o.uuid, agent_id: '', type: 'user', subtype: null, role: 'user', model: null,
      parent_uuid: null, ts_ms: x.tsMs, request_id: null, api_block_index: null, msg_id: null, source_tool_use_id: null,
      tool_name: null, is_compact_summary: 0, provenance: 'operator', prov_version: 1, parse_state: 'ok',
      struct_rank_ns: BigInt(t0) * 1_000_000n, struct_path: o.path, struct_dev: X10_DEV, struct_ino: o.ino,
      blob_sha256: rrH.segmentSha(x.text),
    } });
    out.push({ kind: 'membership', row: { path: o.path, dev: X10_DEV, ino: o.ino, uuid: x.uuid, line: x.line } });
  }
  return out;
}
/** A store createStore made, its recovery step registered at `cursor` (null: the step's start), opened for writing. */
function x10Store(prefix: string, cursor: string | null = null): { box: ReturnType<typeof makeHistoryBox>; ids: { storeId: string; writer: string }; db: DatabaseSync } {
  const box = makeHistoryBox(prefix);
  const ids = createStore(box.home);
  const db = openWriter(historyPaths(box.home).dbFile);
  db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, ?, NULL)").run(Date.now(), cursor);
  return { box, ids, db };
}
const x10Count = (db: DatabaseSync, table: string): number =>
  Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);

describe('W1-B4 Task 10: export replay in the recovery step (spec §9.14 "Export replay")', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  it('O44, the segment case: a format-2 segment beside a format-1 one, under a step larger than one pass\'s budget: the step completes, format 1 replays and is marked, format 2 is skipped and FAILs export-segment-newer naming it', () => {
    const box = makeHistoryBox('ccrc-history-b4-o44seg-');
    pass(box);
    const storeId = fs.readFileSync(historyPaths(box.home).storeId, 'utf8').trim();
    // 256 random hex characters each, so Brotli cannot shrink a blob below the chunk bound: the step spans passes.
    const texts = x10Texts(0x100, 12, 'zqo44seg', Date.now() - 400 * X10_DAY).map((t) => ({ ...t, text: `${t.text} ${rrRandomBytes(128).toString('hex')}` }));
    const one = rrH.plantSegment(box, storeId, {
      seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })),
      rows: x10Rows({ uuid: x10U(0x10), path: '/home/u/gone/o44.jsonl', ino: 9001, texts }),
    });
    const two = rrH.plantSegment(box, storeId, { seq: 2, writer: X10_WRITER, format: 2, blobs: [{ text: 'zqo44seg a newer build wrote this' }], rows: [] });
    const kinds0 = rrJournalKinds(box);
    const version = Date.now();
    registerRecovery(box, version);
    let passes = 0;
    for (;;) {
      const r = runDriver(box, { budgetBytes: 1200, chunkBytes: 400 });
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
      passes += 1;
      if (recoverRow(box)!.completed_ms !== null) break;
      expect(passes, 'the step never completed').toBeLessThan(60);
    }
    expect(passes, 'the step spans several passes').toBeGreaterThanOrEqual(2);
    expect(rows(box, 'SELECT exported_seg AS seg, count(*) AS n FROM entries GROUP BY exported_seg')).toEqual([{ seg: path.basename(one), n: 12 }]);
    expect(countOf(box, 'memberships')).toBe(12);
    expect(rows(box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', path.basename(one))).toEqual([{ n: 12 }]);
    expect(rows(box, 'SELECT count(*) AS n FROM blobs WHERE lower(hex(sha256)) = ?', rrH.segmentSha('zqo44seg a newer build wrote this').toString('hex')),
      'the newer segment\'s blob was never inserted').toEqual([{ n: 0 }]);
    expect(metaOf(box, HEALTH_META.exportSegmentNewer)).toBe(JSON.stringify([path.basename(two)]));
    const newer = (status(box).health.fail as Array<{ word: string; detail?: string }>).find((f) => f.word === 'export-segment-newer');
    expect(newer?.detail, 'doctor FAILs export-segment-newer, naming the segment').toContain(path.basename(two));
    expect(counters(box)['recover_chunk_failed'] ?? 0).toBe(0);
    // O36's replay half for segments: the step journaled nothing.
    expect(rrJournalKinds(box)).toEqual(kinds0);
  }, 240_000);

  it('BK21: a row whose blob sits only in a LATER segment replays, because every segment\'s blobs go in before any segment\'s rows; replayed blobs and rows are marked with their own segments', async () => {
    const { box, ids, db } = x10Store('ccrc-history-b4-bk21-');
    try {
      const texts = x10Texts(0x200, 1, 'zqbk21', Date.now() - 400 * X10_DAY);
      rrH.plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: [], rows: x10Rows({ uuid: x10U(0x20), path: '/home/u/gone/bk21.jsonl', ino: 9101, texts }) });
      rrH.plantSegment(box, ids.storeId, { seq: 2, writer: 'feedface', blobs: [{ text: texts[0]!.text }], rows: [] });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(db.prepare('SELECT e.uuid AS uuid, b.exported_seg AS blobSeg, e.exported_seg AS rowSeg FROM entries e JOIN blobs b ON b.blob_id = e.blob_id')
        .all().map((r) => ({ ...r }))).toEqual([{ uuid: texts[0]!.uuid, blobSeg: '2.feedface.db', rowSeg: `1.${X10_WRITER}.db` }]);
      expect(countersOn(db, 'export_row_blob_missing', 'export_row_unplaced')).toEqual({ export_row_blob_missing: 0, export_row_unplaced: 0 });
    } finally {
      closeWriter(db);
    }
  });

  it('a late-linked sidecar\'s second segment (the entry again, with its sidecar row and only the sidecar\'s bytes) replays beside the first with no duplicate row', async () => {
    const { box, ids, db } = x10Store('ccrc-history-b4-latesc-');
    try {
      const texts = x10Texts(0xa00, 1, 'zqlatesc', Date.now() - 400 * X10_DAY);
      const fam: X10Family = { uuid: x10U(0xa0), path: '/home/u/gone/latesc.jsonl', ino: 9951, texts };
      const side = 'zqlatesc the tool output that landed after its row was exported';
      rrH.plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })), rows: x10Rows(fam) });
      rrH.plantSegment(box, ids.storeId, { seq: 2, writer: X10_WRITER, blobs: [{ text: side }], rows: [
        ...x10Rows(fam),
        { kind: 'sidecar', row: { cc_session_uuid: fam.uuid, agent_id: '', name: 'b4late01.txt', blob_sha256: rrH.segmentSha(side), uuid: texts[0]!.uuid, first_seen_ms: texts[0]!.tsMs + 60_000 } },
      ] });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(['entries', 'memberships', 'sidecars', 'blobs', 'epochs'].map((t) => x10Count(db, t))).toEqual([1, 1, 1, 2, 1]);
      expect(db.prepare('SELECT s.name AS name, e.uuid AS uuid, b.exported_seg AS seg FROM sidecars s JOIN entries e ON e.entry_id = s.entry_id JOIN blobs b ON b.blob_id = s.blob_id')
        .all().map((r) => ({ ...r }))).toEqual([{ name: 'b4late01.txt', uuid: texts[0]!.uuid, seg: `2.${X10_WRITER}.db` }]);
      expect(countersOn(db, 'export_row_blob_missing', 'export_row_unplaced', 'export_epoch_conflict'))
        .toEqual({ export_row_blob_missing: 0, export_row_unplaced: 0, export_epoch_conflict: 0 });
    } finally {
      closeWriter(db);
    }
  });

  it('journal first: a segment\'s family and epoch rows fill only what the journal lacks, through merged_into; a seq the journal gave another uuid is skipped and counted export_epoch_conflict', async () => {
    const { box, ids, db } = x10Store('ccrc-history-b4-jfirst-');
    try {
      const t0 = Date.now() - 400 * X10_DAY;
      const [U1, U2, U3] = [x10U(0x31), x10U(0x32), x10U(0x33)];
      // The journal: (X10_ID, '') and (X10_ID, X10_G), both project demo, the '' family re-keyed into G, and an operator
      // mapping that chains U1 into G at seq 1 with no launch facts.
      plantJournalFile(box, ids.storeId, new Date(t0).toISOString().slice(0, 7), 'feedbeef', t0, [
        journalRecord('verdict', t0 + 1, { event_key: 'none', kind: 'family', ccrc_id: X10_ID, generation: '', project: 'demo', first_seen_ms: t0 + 1 }),
        journalRecord('verdict', t0 + 2, { event_key: 'none', kind: 'family', ccrc_id: X10_ID, generation: X10_G, project: 'demo', first_seen_ms: t0 + 2 }),
        journalRecord('verdict', t0 + 3, { event_key: 'none', kind: 'rekeyed', ccrc_id: X10_ID, generation: X10_G }),
        journalRecord('verdict', t0 + 4, {
          event_key: 'none', kind: 'mapping', ccrc_id: X10_ID, generation: X10_G, cc_session_uuid: U1, declared_by: 'operator',
          path: '/home/u/gone/j1.jsonl',
        }),
      ]);
      const epoch = (generation: string, seq: number, uuid: string): rrH.PlantSegmentRow => ({ kind: 'epoch', row: {
        ccrc_id: X10_ID, generation, seq, cc_session_uuid: uuid, cause: 'startup', declared_by: 'hook',
        started_ms: t0, cwd: WORK, git_branch: 'main', cwd_real: WORK, confirmed_ms: t0,
      } });
      rrH.plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: [], rows: [
        // a family the journal merged: it lands in (X10_ID, X10_G), whose project the journal set
        { kind: 'family', row: { ccrc_id: X10_ID, generation: '', project: 'elsewhere', first_seen_ms: t0 } },
        epoch('', 1, U1),        // the journal's U1, named by its pre-merge family: launch facts filled, seq and cause kept
        epoch(X10_G, 1, U2),     // seq 1 is U1's: skipped, counted
        epoch(X10_G, 2, U3),     // the journal lacks it: inserted at its own seq
      ] });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(db.prepare('SELECT generation, project, merged_into IS NOT NULL AS merged FROM sessions WHERE ccrc_id = ? ORDER BY generation')
        .all(X10_ID).map((r) => ({ ...r }))).toEqual([
        { generation: '', project: 'demo', merged: 1 },
        { generation: X10_G, project: 'demo', merged: 0 },
      ]);
      expect(db.prepare(`SELECT e.seq AS seq, e.cc_session_uuid AS uuid, e.cause AS cause, e.declared_by AS by, e.cwd AS cwd,
          e.started_ms AS started, e.confirmed_ms AS confirmed FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk
          WHERE s.ccrc_id = ? AND s.generation = ? ORDER BY e.seq`).all(X10_ID, X10_G).map((r) => ({ ...r }))).toEqual([
        { seq: 1, uuid: U1, cause: 'import', by: 'operator', cwd: WORK, started: t0, confirmed: t0 + 4 },
        { seq: 2, uuid: U3, cause: 'startup', by: 'hook', cwd: WORK, started: t0, confirmed: t0 },
      ]);
      expect(countersOn(db, 'export_epoch_conflict')).toEqual({ export_epoch_conflict: 1 });
    } finally {
      closeWriter(db);
    }
  });

  it('a gone file\'s memberships land on its exported: row (status exported, eof carried, else the segment\'s cutoff), never on a live row that reuses its inode; a blob the store holds is kept and marked', async () => {
    const { box, ids, db } = x10Store('ccrc-history-b4-dead-');
    try {
      const t0 = Date.now() - 400 * X10_DAY;
      const CUT = Date.now() - 200 * X10_DAY;
      const [UA, UB] = [x10U(0x41), x10U(0x42)];
      const [pa, pb] = ['/home/u/gone/a.jsonl', '/home/u/gone/b.jsonl'];
      const a = x10Texts(0x410, 3, 'zqdeada', t0);
      const b = x10Texts(0x420, 2, 'zqdeadb', t0);
      // A live file of another transcript that now holds a's (dev, ino), and a's first blob already in the store.
      const other = Number(db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)').run(x10U(0x4f)).lastInsertRowid);
      const live = Number(db.prepare("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, status, parser_version) VALUES (?, 9401, '', ?, 'live', 1)")
        .run(X10_DEV, other).lastInsertRowid);
      const raw0 = Buffer.from(a[0]!.text, 'utf8');
      db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?)').run(rrH.segmentSha(a[0]!.text), 'br5', rrH.segmentSha('a stored body'), raw0.length);
      rrH.plantSegment(box, ids.storeId, {
        seq: 1, writer: X10_WRITER, cutoffMs: CUT, blobs: [...a, ...b].map((x) => ({ text: x.text })),
        rows: [
          ...x10Rows({ uuid: UA, path: pa, ino: 9401, texts: a }),
          ...x10Rows({ uuid: UB, path: pb, ino: 9402, texts: b, seq: 2, eofMs: null }),
        ],
      });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      const files = db.prepare('SELECT file_id, source_key, status, eof_ms FROM ingest_files WHERE file_id <> ? ORDER BY file_id').all(live)
        .map((r) => ({ ...r })) as Array<{ file_id: number; source_key: string; status: string; eof_ms: number }>;
      expect(files.map(({ source_key, status, eof_ms }) => ({ source_key, status, eof_ms }))).toEqual([
        { source_key: rrLib.exportedSourceKey(pa, X10_DEV, 9401), status: 'exported', eof_ms: a[0]!.tsMs + 60_000 },
        { source_key: rrLib.exportedSourceKey(pb, X10_DEV, 9402), status: 'exported', eof_ms: CUT },
      ]);
      const held = (fileId: number): string[] => db.prepare('SELECT e.uuid AS uuid FROM memberships m JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? ORDER BY m.line')
        .all(fileId).map((r) => String((r as { uuid: string }).uuid));
      expect(held(live), 'the live row holds nothing of the gone file').toEqual([]);
      expect(held(files[0]!.file_id)).toEqual(a.map((x) => x.uuid));
      expect(held(files[1]!.file_id)).toEqual(b.map((x) => x.uuid));
      expect(db.prepare('SELECT DISTINCT struct_file_id AS f FROM entries ORDER BY f').all().map((r) => Number((r as { f: number }).f)))
        .toEqual(files.map((f) => f.file_id));
      expect({ ...(db.prepare('SELECT count(*) AS n, max(exported_seg) AS seg FROM blobs WHERE sha256 = ?').get(rrH.segmentSha(a[0]!.text)) as object) },
        'insert-or-ignore kept the store\'s blob, and marked it').toEqual({ n: 1, seg: `1.${X10_WRITER}.db` });
      expect(x10Count(db, 'file_paths'), 'a gone file gets no path: the live ingest can never find it').toBe(0);
    } finally {
      closeWriter(db);
    }
  });

  it('the cursor: each chunk commits its segment and position with what it applied; a step split over many small budgets re-applies nothing and keeps +pairs through both export phases', async () => {
    const { box, ids, db } = x10Store('ccrc-history-b4-cursor-', 'index+pairs');
    try {
      const t0 = Date.now() - 400 * X10_DAY;
      const [U1, U2] = [x10U(0x51), x10U(0x52)];
      plantJournalFile(box, ids.storeId, new Date(t0).toISOString().slice(0, 7), 'feedbeef', t0, [
        journalRecord('verdict', t0 + 1, { event_key: 'none', kind: 'family', ccrc_id: X10_ID, generation: X10_G, project: 'demo', first_seen_ms: t0 + 1 }),
        journalRecord('verdict', t0 + 2, {
          event_key: 'none', kind: 'mapping', ccrc_id: X10_ID, generation: X10_G, cc_session_uuid: U1, declared_by: 'operator',
          path: '/home/u/gone/c1.jsonl',
        }),
      ]);
      const texts = x10Texts(0x500, 8, 'zqcursor', t0);
      // U2's epoch claims seq 1, which the journal gave U1: one conflict, which a re-applied chunk would count twice.
      rrH.plantSegment(box, ids.storeId, {
        seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })),
        rows: x10Rows({ uuid: U2, path: '/home/u/gone/c2.jsonl', ino: 9501, texts }),
      });
      const seen: string[] = [];
      let finished = false;
      for (let i = 0; i < 200 && !finished; i += 1) {
        const r = await SW.recoveryStep(db, stepCtx(box, ids, { maxBytes: 600, chunkBytes: 300 }));
        const c = cursorOn(db);
        if (c !== null) seen.push(c);
        finished = r.done || (c !== null && c.startsWith('reindex'));
      }
      expect(finished, `the step reached reindex: ${seen.join(' | ')}`).toBe(true);
      const exportCursors = seen.filter((c) => c.startsWith('export-'));
      expect(exportCursors.some((c) => new RegExp(`^export-rows:1\\.${X10_WRITER}\\.db:[1-9][0-9]*\\+pairs$`).test(c)),
        `a pass ended inside the rows of segment 1: ${seen.join(' | ')}`).toBe(true);
      expect(exportCursors.filter((c) => !c.endsWith('+pairs')), '+pairs survives every export cursor').toEqual([]);
      expect(countersOn(db, 'export_epoch_conflict')).toEqual({ export_epoch_conflict: 1 });
      expect([x10Count(db, 'entries'), x10Count(db, 'memberships')]).toEqual([8, 8]);
    } finally {
      closeWriter(db);
    }
  });

  it('the floor: a per-chunk probe below it pauses the export phases with capture_paused_low_disk, the cursor where it was', async () => {
    const { box, ids, db } = x10Store('ccrc-history-b4-floor-');
    try {
      const texts = x10Texts(0x600, 6, 'zqfloor', Date.now() - 400 * X10_DAY);
      rrH.plantSegment(box, ids.storeId, {
        seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })),
        rows: x10Rows({ uuid: x10U(0x60), path: '/home/u/gone/floor.jsonl', ino: 9601, texts }),
      });
      let calls = 0;
      const roomy = { bsize: 1, bavail: 4 * 2 ** 40, blocks: 8 * 2 ** 40 };
      const low = { bsize: 1, bavail: 1024, blocks: 8 * 2 ** 40 };
      // Probes 1-3 (index, apply, the first export-blobs chunk) have room; the fourth, before the next chunk, does not.
      const ctx = { ...stepCtx(box, ids, { chunkBytes: 100 }), deps: { statfs: async () => (++calls <= 3 ? roomy : low) } };
      expect(await SW.recoveryStep(db, ctx)).toEqual({ moved: true, done: false, held: true });
      expect(countersOn(db, 'capture_paused_low_disk')).toEqual({ capture_paused_low_disk: 1 });
      const at = cursorOn(db);
      expect(at).toMatch(new RegExp(`^export-blobs:1\\.${X10_WRITER}\\.db:[1-9][0-9]*$`));
      expect(x10Count(db, 'entries'), 'no row before every blob').toBe(0);
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(x10Count(db, 'entries')).toBe(6);
    } finally {
      closeWriter(db);
    }
  });

  it('a segment whose meta names another store is skipped and counted export_segment_foreign, its rows never replayed', async () => {
    const { box, ids, db } = x10Store('ccrc-history-b4-foreign-');
    try {
      const mine = x10Texts(0x700, 2, 'zqmine', Date.now() - 400 * X10_DAY);
      const theirs = x10Texts(0x710, 2, 'zqtheirs', Date.now() - 400 * X10_DAY);
      rrH.plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: mine.map((t) => ({ text: t.text })),
        rows: x10Rows({ uuid: x10U(0x70), path: '/home/u/gone/mine.jsonl', ino: 9701, texts: mine }) });
      rrH.plantSegment(box, ids.storeId, { seq: 2, writer: X10_WRITER, metaStoreId: '0189abcd-1234-4678-9abc-0000000010ff',
        blobs: theirs.map((t) => ({ text: t.text })), rows: x10Rows({ uuid: x10U(0x71), path: '/home/u/gone/theirs.jsonl', ino: 9702, texts: theirs, seq: 2 }) });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(db.prepare('SELECT uuid FROM entries ORDER BY uuid').all().map((r) => String((r as { uuid: string }).uuid))).toEqual(mine.map((t) => t.uuid));
      expect(countersOn(db, 'export_segment_foreign')).toEqual({ export_segment_foreign: 1 });
    } finally {
      closeWriter(db);
    }
  });

  it('a segment that cannot be read fails its chunk (recover_chunk_failed) and the step waits for it, never skipping it; removed, the step completes', async () => {
    const { box, ids, db } = x10Store('ccrc-history-b4-unreadable-');
    try {
      const texts = x10Texts(0x800, 2, 'zqunread', Date.now() - 400 * X10_DAY);
      const one = rrH.plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })),
        rows: x10Rows({ uuid: x10U(0x80), path: '/home/u/gone/unread.jsonl', ino: 9801, texts }) });
      const broken = path.join(path.dirname(one), `3.${X10_WRITER}.db`);
      fs.writeFileSync(broken, 'not a database, and not a newer format either\n', { mode: 0o600 });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: false, held: false });
      expect(countersOn(db, 'recover_chunk_failed')).toEqual({ recover_chunk_failed: 1 });
      expect(cursorOn(db), 'the step waits at the unreadable segment').toBe(`export-blobs:3.${X10_WRITER}.db:0`);
      expect(await SW.recoveryStep(db, stepCtx(box, ids)), 'still unreadable: still waiting').toEqual({ moved: false, done: false, held: false });
      fs.rmSync(broken);
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(x10Count(db, 'entries')).toBe(2);
    } finally {
      closeWriter(db);
    }
  });

  it('a chunk that throws rolls back what it applied with its cursor; the next pass applies it once', () => {
    const box = makeHistoryBox('ccrc-history-b4-rollback-');
    pass(box);
    const storeId = fs.readFileSync(historyPaths(box.home).storeId, 'utf8').trim();
    const t0 = Date.now() - 400 * X10_DAY;
    const [U1, U2] = [x10U(0x91), x10U(0x92)];
    plantJournalFile(box, storeId, new Date(t0).toISOString().slice(0, 7), 'feedbeef', t0, [
      journalRecord('verdict', t0 + 1, { event_key: 'none', kind: 'family', ccrc_id: X10_ID, generation: X10_G, project: 'demo', first_seen_ms: t0 + 1 }),
      journalRecord('verdict', t0 + 2, {
        event_key: 'none', kind: 'mapping', ccrc_id: X10_ID, generation: X10_G, cc_session_uuid: U1, declared_by: 'operator',
        path: '/home/u/gone/r1.jsonl',
      }),
    ]);
    const texts = x10Texts(0x900, 4, 'zqrollback', t0);
    rrH.plantSegment(box, storeId, { seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })),
      rows: x10Rows({ uuid: U2, path: '/home/u/gone/r2.jsonl', ino: 9901, texts }) });
    registerRecovery(box, Date.now());
    // Every membership insert throws: the rows chunk (one chunk at the default budget) rolls back whole.
    pass(box, { HISTORY_TEST_THROW_SQL: 'INTO memberships' }, [PRELOADS.faults]);
    expect(counters(box)['recover_chunk_failed']).toBe(1);
    expect([countOf(box, 'entries'), countOf(box, 'memberships'), counters(box)['export_epoch_conflict'] ?? 0], 'nothing of the failed chunk stayed').toEqual([0, 0, 0]);
    expect(recoverRow(box)!.cursor).toBe('export-rows');
    pass(box);
    expect(recoverRow(box)!.completed_ms).not.toBeNull();
    expect([countOf(box, 'entries'), countOf(box, 'memberships'), counters(box)['export_epoch_conflict']]).toEqual([4, 4, 1]);
  }, 120_000);
});
```

- [ ] **Step 3: Run the new describe and see it fail.** From the repository root, foreground, timeout ≥ 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'W1-B4 Task 10')
```

Expected: red. Task 3's placeholders answer `phaseDone` at once, so the step completes with nothing replayed: `expected [] to deeply equal [ { seg: '1.0a1b2c3d.db', n: 12 } ]` (O44's case), `expected [] to deeply equal [ { uuid: …, blobSeg: '2.feedface.db', … } ]` (BK21), `expected [ 0, 0, 0, 0, 0 ] to deeply equal [ 1, 1, 1, 2, 1 ]` (the late-linked sidecar's two segments), the epochs list missing U3 and the launch facts (journal first), no `exported:` rows (the gone-file case), `expected false to be true` on `a pass ended inside the rows of segment 1` (the cursor), the floor case's cursor (`export-rows`, where a paused export-blobs chunk is expected), `export_segment_foreign: 0`, `recover_chunk_failed: 0` for the unreadable segment, and `recover_chunk_failed` undefined in the rollback case. B2's own cases in the file stay green.

- [ ] **Step 4: Remove Task 3's placeholders and insert the replay section.** First, from the repository root, remove the two placeholder functions and check the literal still names both:

```bash
python3 - <<'EOF'
import re
p = 'ccd/history/sweep.mjs'
s = open(p).read()
for name in ('recoverExportBlobsChunk', 'recoverExportRowsChunk'):
    # one function: a one-line body, or a header line, then only indented or empty lines, then a column-0 `}`;
    # with its doc comment when one sits directly above it
    pat = re.compile(r'(?:^/\*\*(?:(?!\*/).)*\*/\n)?^(?:async )?function ' + name
                     + r'\((?:[^\n]*\}\n|[^\n]*\n(?:(?:[ \t][^\n]*)?\n)*?\}\n)', re.S | re.M)
    hits = pat.findall(s)
    assert len(hits) == 1, (name, len(hits))
    s = pat.sub('', s, count=1)
lit = re.search(r'^export const RECOVER_EXECUTORS = Object\.freeze\(\{\n(.*?)^\}\);', s, re.S | re.M)
assert lit, 'no RECOVER_EXECUTORS literal'
keys = re.findall(r"^\s*'?([a-z-]+)'?:", lit.group(1), re.M)
assert keys == ['index', 'apply', 'export-blobs', 'export-rows', 'reindex'], keys
open(p, 'w').write(s)
print('placeholders removed; literal keys', keys)
EOF
```

Expected: `placeholders removed; literal keys ['index', 'apply', 'export-blobs', 'export-rows', 'reindex']`.

Then insert this section directly above the doc comment that begins `/** One executor per RECOVER_PHASES phase, keyed by its name.` (where the placeholders were), never between that comment and the literal it documents:

```js
// ── W1-B4 Task 10: export replay, the recovery step's two export phases (spec §9.14 "Export replay", §9.15) ─────
//
// After the journal (index, apply), the step replays this store's export segments in two passes, so no row ever
// waits on a blob in a later segment (BK21):
//   export-blobs  every segment's blobs, insert-or-ignore by sha256; each replayed blob that holds bytes is marked
//                 with its segment, so it is never exported again;
//   export-rows   every segment's rows in their write order (ord), through the ingest's named columns:
//                 - families and epochs fill only what the journal lacks, through merged_into;
//                 - a gone file becomes a dead-file ingest_files row keyed 'exported:' + hex(sha256(path ∖0 dev ∖0
//                   ino)), never a live row, even one that now reuses its inode (§9.15), and with no file_paths row,
//                   so the live ingest can never find it;
//                 - entries go through ENTRY_UPSERT's newest-rank rule, each marked with its segment;
//                 - variants, boundaries (their carried ord), sidecars and memberships, idempotently.
// Segments go in (seq, writer) order (lib orderSegmentNames), whatever their writer, and lib decideSegmentReplay
// judges each from its meta: a newer format is refused loudly (meta export_segment_newer lists it, doctor FAIL
// export-segment-newer) and skipped; another store's is skipped and counted export_segment_foreign. A segment that
// cannot be opened or read fails its chunk (recover_chunk_failed) and the step waits for it, capture held with it:
// only a newer format is skippable, and the failure line names the way out
// (⟦D:history-export-segment-unreadable-stalls⟧, NEW).
// THE CURSOR is lib's RecoverCursor at its phase: `file` the segment's name, `offset` the last blobs rowid
// (export-blobs) or the last row ord (export-rows) applied. It is committed in the chunk's own NORMAL transaction
// with what it applied, and `pairsAdded` rides along as the step holds it, so Task 29's reindex phase still sees a
// learned pair. Replay writes no journal record (O36) and no segment.

/** Rows read per page of one segment; a chunk applies them until run.budget.chunkBytes. */
const EXPORT_REPLAY_PAGE = 256;

const EXPORT_REPLAY_STMTS = new WeakMap();
/** Export replay's prepared statements, one set per connection, each naming its columns (stmts(db)'s idiom). */
function replayStmts(db) {
  let s = EXPORT_REPLAY_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    blobIns: db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT (sha256) DO NOTHING'),
    blobMark: db.prepare('UPDATE blobs SET exported_ms = ?, exported_seg = ? WHERE sha256 = ? AND z IS NOT NULL AND exported_ms IS NULL'),
    blobId: db.prepare('SELECT blob_id FROM blobs WHERE sha256 = ?'),
    familySel: db.prepare('SELECT session_pk, merged_into FROM sessions WHERE ccrc_id = ? AND generation = ?'),
    familyFill: db.prepare("UPDATE sessions SET project = ? WHERE session_pk = ? AND project = ''"),
    epochMine: db.prepare('SELECT seq FROM epochs WHERE session_pk = ? AND cc_session_uuid = ?'),
    epochFill: db.prepare(`UPDATE epochs SET started_ms = coalesce(started_ms, ?), cwd = coalesce(cwd, ?),
        git_branch = coalesce(git_branch, ?), cwd_real = coalesce(cwd_real, ?), confirmed_ms = coalesce(confirmed_ms, ?)
      WHERE session_pk = ? AND seq = ?`),
    epochElsewhere: db.prepare('SELECT 1 AS x FROM epochs WHERE cc_session_uuid = ? AND session_pk <> ? AND confirmed_ms IS NOT NULL LIMIT 1'),
    epochSeqTaken: db.prepare('SELECT 1 AS x FROM epochs WHERE session_pk = ? AND seq = ?'),
    epochIns: db.prepare(`INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, started_ms, cwd,
        git_branch, cwd_real, confirmed_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    candidateDel: db.prepare(DELETE_CANDIDATE),
    transcriptUpsert: db.prepare(`INSERT INTO transcripts (cc_session_uuid, agent_id, harness, parent_tool_use_id,
        workflow_run_id, agent_type) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (cc_session_uuid, agent_id) DO UPDATE SET
        parent_tool_use_id = coalesce(transcripts.parent_tool_use_id, excluded.parent_tool_use_id),
        workflow_run_id = coalesce(transcripts.workflow_run_id, excluded.workflow_run_id),
        agent_type = coalesce(transcripts.agent_type, excluded.agent_type)`),
    transcriptPk: db.prepare('SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ?'),
    deadFileUpsert: db.prepare(`INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, size, mtime_ns, offset,
        status, eof_ms, parser_version) VALUES (?, ?, ?, ?, ?, ?, 0, 'exported', ?, ?)
      ON CONFLICT (dev, ino, source_key) DO UPDATE SET eof_ms = coalesce(ingest_files.eof_ms, excluded.eof_ms)`),
    deadFileId: db.prepare('SELECT file_id FROM ingest_files WHERE dev = ? AND ino = ? AND source_key = ?'),
    entrySel: db.prepare('SELECT entry_id, struct_file_id FROM entries WHERE uuid = ?'),
    entryMark: db.prepare('UPDATE entries SET exported_ms = ?, exported_seg = ? WHERE entry_id = ? AND exported_ms IS NULL'),
    variantIns: db.prepare(`INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms, cause)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (entry_id, blob_id) DO NOTHING`),
    boundaryIns: db.prepare(`INSERT INTO boundaries (entry_id, transcript_pk, ord, trigger, head_uuid, anchor_uuid,
        tail_uuid, kept_blob_id, pre_tokens, post_tokens, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`),
    sidecarIns: db.prepare(`INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (transcript_pk, name, blob_id) DO NOTHING`),
  };
  EXPORT_REPLAY_STMTS.set(db, s);
  return s;
}

const blobIdOf = (db, sha) => {
  const b = replayStmts(db).blobId.get(sha);
  return b === undefined ? null : Number(b.blob_id);
};
const transcriptPkOf = (db, uuid, agentId) => {
  const t = replayStmts(db).transcriptPk.get(uuid, agentId);
  return t === undefined ? null : Number(t.transcript_pk);
};
/** The family a segment row names, through merged_into (a re-keyed '' family answers with the one it merged into),
 *  or null when the store has none: a row never creates a family the segment's own family row did not. */
function familyPkOf(db, ccrcId, generation) {
  const row = replayStmts(db).familySel.get(ccrcId, generation);
  if (row === undefined) return null;
  return row.merged_into === null ? Number(row.session_pk) : Number(row.merged_into);
}
/** The dead-file row of a gone file, made when absent (§9.15 "Memberships of a gone file"). Its eof_ms is the one the
 *  segment carried, else the segment's cutoff (⟦D:history-export-dead-file-eof⟧, NEW): B2's leaf readiness reads it. */
function ensureDeadFile(db, seg, path, dev, ino, transcriptPk, size, mtimeNs, eofMs) {
  const s = replayStmts(db);
  const key = exportedSourceKey(path, dev, ino);
  s.deadFileUpsert.run(dev, ino, key, transcriptPk, size, mtimeNs, eofMs ?? seg.cutoffMs, PARSER_VERSION);
  return Number(s.deadFileId.get(dev, ino, key).file_id);
}
const deadFileIdOf = (db, path, dev, ino) => {
  const row = replayStmts(db).deadFileId.get(dev, ino, exportedSourceKey(path, dev, ino));
  return row === undefined ? null : Number(row.file_id);
};

function replayFamilyRow(db, _seg, r) {
  const f = ensureFamily(db, r.ccrc_id, r.generation, r.project, r.first_seen_ms);
  if (!f.created && r.project !== '') replayStmts(db).familyFill.run(r.project, f.sessionPk);
}
function replayTranscriptRow(db, _seg, r) {
  replayStmts(db).transcriptUpsert.run(r.cc_session_uuid, r.agent_id, r.harness, r.parent_tool_use_id, r.workflow_run_id, r.agent_type);
}
/** An epoch the journal holds (by uuid, in the family the row names after merged_into) keeps its seq, cause and
 *  declared_by and gains only its NULL columns; one the journal lacks goes in at the segment's seq, unless that seq,
 *  or the uuid confirmed in another family, is taken (export_epoch_conflict). */
function replayEpochRow(db, _seg, r) {
  const s = replayStmts(db);
  const pk = familyPkOf(db, r.ccrc_id, r.generation);
  if (pk === null) { bump(db, 'export_row_unplaced'); return; }
  const mine = s.epochMine.get(pk, r.cc_session_uuid);
  if (mine !== undefined) {
    s.epochFill.run(r.started_ms, r.cwd, r.git_branch, r.cwd_real, r.confirmed_ms, pk, mine.seq);
    if (r.confirmed_ms !== null) s.candidateDel.run(r.cc_session_uuid, r.ccrc_id);
    return;
  }
  if (s.epochElsewhere.get(r.cc_session_uuid, pk) !== undefined || s.epochSeqTaken.get(pk, r.seq) !== undefined) {
    bump(db, 'export_epoch_conflict');
    return;
  }
  s.epochIns.run(pk, r.seq, r.cc_session_uuid, r.cause, r.declared_by, r.started_ms, r.cwd, r.git_branch, r.cwd_real, r.confirmed_ms);
  if (r.confirmed_ms !== null) s.candidateDel.run(r.cc_session_uuid, r.ccrc_id);
}
function replayFileRow(db, seg, r) {
  const t = transcriptPkOf(db, r.cc_session_uuid, r.agent_id);
  if (t === null) { bump(db, 'export_row_unplaced'); return; }
  ensureDeadFile(db, seg, r.path, r.dev, r.ino, t, r.size, r.mtime_ns, r.eof_ms);
}
function replayEntryRow(db, seg, r) {
  const t = transcriptPkOf(db, r.cc_session_uuid, r.agent_id);
  if (t === null) { bump(db, 'export_row_unplaced'); return; }
  const blobId = blobIdOf(db, r.blob_sha256);
  if (blobId === null) { bump(db, 'export_row_blob_missing'); return; }
  const fileId = ensureDeadFile(db, seg, r.struct_path, r.struct_dev, r.struct_ino, t, null, null, null);
  stmts(db).entryUpsert.run(r.uuid, t, r.type, r.subtype, r.role, r.model, r.parent_uuid, r.ts_ms, r.request_id,
    r.api_block_index, r.msg_id, r.source_tool_use_id, r.tool_name, r.is_compact_summary, r.provenance, r.prov_version,
    r.parse_state, r.struct_rank_ns, fileId, blobId);
  const s = replayStmts(db);
  const e = s.entrySel.get(r.uuid);
  s.entryMark.run(seg.markMs, seg.name, e.entry_id);
}
/** A variant's first file is the dead-file row of the first file the segment names for it (first_path, first_dev,
 *  first_ino; the export pass writes that file row before the entry), else its entry's own dead-file row
 *  (⟦D:history-export-variant-first-file⟧, NEW). */
function replayVariantRow(db, _seg, r) {
  const s = replayStmts(db);
  const e = s.entrySel.get(r.uuid);
  if (e === undefined) { bump(db, 'export_row_unplaced'); return; }
  const blobId = blobIdOf(db, r.blob_sha256);
  if (blobId === null) { bump(db, 'export_row_blob_missing'); return; }
  const first = deadFileIdOf(db, r.first_path, r.first_dev, r.first_ino) ?? Number(e.struct_file_id);
  s.variantIns.run(e.entry_id, blobId, first, r.first_seen_ms, r.cause);
}
function replayBoundaryRow(db, _seg, r) {
  const s = replayStmts(db);
  const t = transcriptPkOf(db, r.cc_session_uuid, r.agent_id);
  const e = s.entrySel.get(r.uuid);
  if (t === null || e === undefined) { bump(db, 'export_row_unplaced'); return; }
  let kept = null;
  if (r.kept_sha256 !== null) {
    kept = blobIdOf(db, r.kept_sha256);
    if (kept === null) bump(db, 'export_row_blob_missing');
  }
  s.boundaryIns.run(e.entry_id, t, r.boundary_ord, r.trigger, r.head_uuid, r.anchor_uuid, r.tail_uuid, kept, r.pre_tokens, r.post_tokens, r.duration_ms);
}
function replaySidecarRow(db, _seg, r) {
  const s = replayStmts(db);
  const t = transcriptPkOf(db, r.cc_session_uuid, r.agent_id);
  if (t === null) { bump(db, 'export_row_unplaced'); return; }
  const blobId = blobIdOf(db, r.blob_sha256);
  if (blobId === null) { bump(db, 'export_row_blob_missing'); return; }
  let entryId = null;
  if (r.uuid !== null) {
    const e = s.entrySel.get(r.uuid);
    if (e === undefined) bump(db, 'export_row_unplaced');
    else entryId = e.entry_id;
  }
  s.sidecarIns.run(t, r.name, blobId, entryId, r.first_seen_ms);
}
function replayMembershipRow(db, _seg, r) {
  const fileId = deadFileIdOf(db, r.path, r.dev, r.ino);
  const e = replayStmts(db).entrySel.get(r.uuid);
  if (fileId === null || e === undefined) { bump(db, 'export_row_unplaced'); return; }
  stmts(db).membership.run(fileId, e.entry_id, r.line);
}

/** One applicator per row kind a format-1 segment holds (Task 4's segmentInserts keys). */
const EXPORT_ROW_APPLY = Object.freeze({
  family: replayFamilyRow,
  transcript: replayTranscriptRow,
  epoch: replayEpochRow,
  file: replayFileRow,
  entry: replayEntryRow,
  variant: replayVariantRow,
  boundary: replayBoundaryRow,
  sidecar: replaySidecarRow,
  membership: replayMembershipRow,
});

/** A row's size for the chunk bound: its strings' and byte arrays' lengths, eight bytes per other value. */
function rowBytes(row) {
  let n = 0;
  for (const v of Object.values(row)) {
    if (typeof v === 'string') n += Buffer.byteLength(v);
    else if (v instanceof Uint8Array) n += v.length;
    else n += 8;
  }
  return n;
}

/** This store's segment names in replay order, listed once per pass (the run object is the pass's). An absent
 *  directory is no segment; a listing that throws fails the chunk. */
function exportReplayListing(run) {
  if (run.exportListing === undefined) {
    const dir = `${run.P.root}/${EXPORT_DIR}/${run.storeId}`;
    run.exportListing = { dir, names: orderSegmentNames(listSegments(dir).map((s) => s.name)) };
  }
  return run.exportListing;
}

/** A segment opened read-only and judged by lib from its meta, the judgement cached for the pass. Either read
 *  failing throws, naming the segment and the way out: an unreadable segment fails its chunk and is never skipped,
 *  and while the step waits for it no tick ingests (⟦D:history-export-segment-unreadable-stalls⟧). */
function openForReplay(run, dir, name) {
  let sdb = null;
  try {
    sdb = openSegment(`${dir}/${name}`);
    if (run.exportVerdicts === undefined) run.exportVerdicts = new Map();
    let verdict = run.exportVerdicts.get(name);
    if (verdict === undefined) {
      const meta = segmentMeta(sdb);
      verdict = { word: decideSegmentReplay({ meta: { storeId: meta.storeId, format: meta.format }, storeId: run.storeId }), meta };
      run.exportVerdicts.set(name, verdict);
    }
    return { sdb, verdict };
  } catch (e) {
    if (sdb !== null) sdb.close();
    throw new Error(`export segment ${dir}/${name} cannot be read (${e && e.message ? e.message : String(e)}); `
      + 'recovery waits for it and capture is held. Move it aside under a non-segment name to skip it (its text is not '
      + 'replayed), or put a good copy back');
  }
}

/** A segment the export-blobs walk skips, once per walk: a newer format joins meta export_segment_newer (doctor FAIL
 *  export-segment-newer, naming it); another store's is counted export_segment_foreign. Each prints one line. */
function noteSkippedSegment(db, name, verdict) {
  if (verdict.word === 'newer') {
    let listed = [];
    try {
      const v = JSON.parse(getMeta(db, HEALTH_META.exportSegmentNewer) ?? '[]');
      if (Array.isArray(v)) listed = v.filter((x) => typeof x === 'string');
    } catch {
      listed = [];
    }
    if (!listed.includes(name)) setMeta(db, HEALTH_META.exportSegmentNewer, JSON.stringify([...listed, name]));
    process.stderr.write(`history-sweep: export segment ${name} is format ${verdict.meta.format}, newer than this build's ${EXPORT_SEGMENT_FORMAT}; it was not replayed\n`);
    return;
  }
  bump(db, 'export_segment_foreign');
  process.stderr.write(`history-sweep: export segment ${name} names store ${verdict.meta.storeId}, not this one; it was not replayed\n`);
}

/** One page of one segment's blobs past `after` (a rowid), bounded by the chunk's bytes. insert-or-ignore by sha256
 *  (§9.14): a blob the store already holds, whole or pruned, keeps its row; one with bytes is marked with its
 *  segment. A stub (no bytes) goes in pruned (⟦D:history-export-pruned-row-stub⟧). An empty page ends the segment. */
function replayBlobPage(db, run, sdb, name, after) {
  const page = segmentBlobsAfter(sdb, after, run.budget.chunkBytes);
  if (page.length === 0) return { pos: after, done: true, bytes: 0 };
  const s = replayStmts(db);
  const markMs = run.now();
  let bytes = 0;
  for (const b of page) {
    s.blobIns.run(b.sha256, b.codec, b.z, b.raw_len, b.z === null ? markMs : null);
    if (b.z !== null) {
      s.blobMark.run(markMs, name, b.sha256);
      bytes += b.z.length;
    }
  }
  return { pos: Number(page[page.length - 1].rowid), done: false, bytes };
}

/** One page of one segment's rows past `after` (an ord), applied in order until the chunk's bytes; at least one. An
 *  empty page ends the segment. A kind format 1 does not define fails the chunk. */
function replayRowPage(db, run, sdb, name, meta, after) {
  const page = segmentRowsAfter(sdb, after, EXPORT_REPLAY_PAGE);
  if (page.length === 0) return { pos: after, done: true, bytes: 0 };
  const seg = { name, markMs: run.now(), cutoffMs: meta.cutoffMs };
  let bytes = 0;
  let pos = after;
  for (const r of page) {
    if (bytes >= run.budget.chunkBytes) break;
    const apply = Object.hasOwn(EXPORT_ROW_APPLY, r.kind) ? EXPORT_ROW_APPLY[r.kind] : undefined;
    if (apply === undefined) throw new Error(`export segment ${name} holds a row of kind ${String(r.kind)}, which format ${meta.format} does not define`);
    apply(db, seg, r.row);
    bytes += rowBytes(r.row);
    pos = Number(r.ord);
  }
  return { pos, done: false, bytes };
}

/** One bounded chunk of an export phase: one page of one segment, applied with the cursor past it in one NORMAL
 *  transaction (B2's executor contract). `blobs` picks the phase's page. */
function exportPhaseChunk(db, run, cursor, blobs) {
  const { dir, names } = exportReplayListing(run);
  // A cursor naming a segment this listing does not hold restarts the phase: segments are never removed by the sweep,
  // and every insert here is idempotent.
  const found = cursor.file === null ? -1 : names.indexOf(cursor.file);
  const at = found === -1 ? 0 : found;
  const after = found === -1 ? 0 : cursor.offset;
  const name = at < names.length ? names[at] : null;
  const position = (file, offset) => ({ phase: cursor.phase, file, offset, blobId: null, pairsAdded: run.pairsAdded });
  // An unreadable segment throws here, before the transaction: the chunk fails and the step waits for it.
  const opened = name === null ? { sdb: null, verdict: null } : openForReplay(run, dir, name);
  let page = { pos: after, done: true, bytes: 0 };
  let next;
  try {
    next = withTx(db, 'NORMAL', () => {
      if (blobs && cursor.file === null) setMeta(db, HEALTH_META.exportSegmentNewer, '[]');
      if (opened.verdict !== null && opened.verdict.word === 'replay') {
        page = blobs
          ? replayBlobPage(db, run, opened.sdb, name, after)
          : replayRowPage(db, run, opened.sdb, name, opened.verdict.meta, after);
      } else if (opened.verdict !== null && blobs) {
        noteSkippedSegment(db, name, opened.verdict);
      }
      const c = name === null ? position(null, 0)
        : page.done && at + 1 < names.length ? position(names[at + 1], 0)
          : position(name, page.pos);
      db.prepare(RECOVER_CURSOR_SQL).run(formatRecoverCursor(c), run.version);
      return c;
    });   // the chunk's one transaction: what it applied, and the cursor past it
  } finally {
    if (opened.sdb !== null) opened.sdb.close();
  }
  run.budget.bytes += page.bytes;
  return {
    cursor: next,
    moved: formatRecoverCursor(next) !== formatRecoverCursor(cursor),
    phaseDone: name === null || (page.done && at + 1 >= names.length),
  };
}

/** export-blobs: every segment's blobs, before any segment's rows (BK21). */
function recoverExportBlobsChunk(db, run, cursor) {
  return exportPhaseChunk(db, run, cursor, true);
}

/** export-rows: every segment's rows, in (seq, writer) order. */
function recoverExportRowsChunk(db, run, cursor) {
  return exportPhaseChunk(db, run, cursor, false);
}
```

- [ ] **Step 5: Check the placement.**

```bash
grep -c '^function recoverExportBlobsChunk(\|^function recoverExportRowsChunk(' ccd/history/sweep.mjs      # 2: one each
awk '/^\/\*\* One executor per RECOVER_PHASES phase/{d=NR} /^export const RECOVER_EXECUTORS = Object.freeze\(\{/{e=NR} /^function recoverExportRowsChunk\(/{f=NR} d && !e && NR>d && $0 !~ /^ \*/{bad=1} END{print (f<d && d<e && !bad ? "section above the doc comment; the doc comment directly on the literal" : "MISPLACED")}' ccd/history/sweep.mjs
grep -c 'import.meta.url === pathToFileURL' ccd/history/sweep.mjs                                          # 1
sed -n "$(grep -n 'import.meta.url === pathToFileURL' ccd/history/sweep.mjs | cut -d: -f1),\$p" ccd/history/sweep.mjs | grep -c 'exportPhaseChunk\|EXPORT_ROW_APPLY'   # 0
```

- [ ] **Step 6: Add the imports the section needs.** Run from the repository root:

```bash
python3 - <<'EOF'
import re
s = open('ccd/history/sweep.mjs').read()
want = {
    './lib.mjs': ['EXPORT_DIR', 'EXPORT_SEGMENT_FORMAT', 'exportedSourceKey', 'decideSegmentReplay', 'orderSegmentNames',
                  'HEALTH_META', 'formatRecoverCursor'],
    './store.mjs': ['openSegment', 'segmentMeta', 'segmentBlobsAfter', 'segmentRowsAfter', 'listSegments', 'withTx',
                    'bump', 'getMeta', 'setMeta'],
}
for mod, names in want.items():
    m = re.search(r"import \{([^}]*)\} from '" + re.escape(mod) + r"';", s)
    assert m, f'no named import from {mod}'
    have = {n.strip().split(' as ')[-1] for n in m.group(1).split(',') if n.strip()}
    missing = [n for n in names if n not in have]
    print(f"{mod}: add {', '.join(missing) if missing else '(nothing)'}")
for local in ('function stmts(', 'export function ensureFamily(', 'const DELETE_CANDIDATE', 'PARSER_VERSION =', 'const RECOVER_CURSOR_SQL'):
    assert local in s, f'module-local name missing: {local}'
print('module-local names present')
EOF
```

Add every printed name to that module's existing import statement, one statement per module and no name twice; re-run until both lines say `(nothing)`. Then `node --check ccd/history/sweep.mjs` (a name declared twice is a SyntaxError).

- [ ] **Step 7: Run and see it pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'RecoverCursor|RECOVER_PHASES')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: all green; tsc prints nothing.
- `history-recover.test.ts` whole: this task's nine cases, and every B2 case, including `'RECOVER_EXECUTORS runs every RECOVER_PHASES phase, and only those'` (the literal is untouched), O44's journal case (no export directory: both export phases end at once), O35's drill and O47.
- `single-definition`: no `process.env` read, no `/history-off` spelling, RECOVER_PHASES still declared only in lib.

- [ ] **Step 8: Measure every new guard red, then green.** From the repository root, with Task 9 Step 9's `mut` helper and `$SCRATCH` (define them again in a new shell). Each block mutates one file, runs one filter, shows it red, and restores with `cp`.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w1-b4/scratch"; mkdir -p "$SCRATCH"
mut() {
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp ccd/history/sweep.mjs "$SCRATCH/sweep.orig"
cp ccd/history/lib.mjs "$SCRATCH/lib.orig"
T() { (cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t "$1"); }

# M1 (BK21's CONTROL): rows before blobs — the two export phases swapped in lib's order.
mut ccd/history/lib.mjs "Object.freeze(['index', 'apply', 'export-blobs', 'export-rows', 'reindex'])" "Object.freeze(['index', 'apply', 'export-rows', 'export-blobs', 'reindex'])"
T 'BK21'; cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED: expected [] to deeply equal [ { uuid: …, blobSeg: '2.feedface.db', … } ] (export_row_blob_missing 1).

# M2: a segment's family overwrites the project the journal set.
mut ccd/history/sweep.mjs "familyFill: db.prepare(\"UPDATE sessions SET project = ? WHERE session_pk = ? AND project = ''\")," "familyFill: db.prepare('UPDATE sessions SET project = ? WHERE session_pk = ?'),"
T 'journal first'; cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: (X10_ID, X10_G) reads project 'elsewhere', expected 'demo'.

# M3: no seq check — the conflicting epoch's insert breaks PRIMARY KEY (session_pk, seq).
mut ccd/history/sweep.mjs " || s.epochSeqTaken.get(pk, r.seq) !== undefined" ""
T 'journal first'; cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: recoveryStep answers { moved: true, done: false, held: false } (the rows chunk throws, recover_chunk_failed).

# M4: the dead-file row keyed as a live one.
mut ccd/history/sweep.mjs "  const key = exportedSourceKey(path, dev, ino);" "  const key = '';"
T 'never on a live row'; cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: no ingest_files row carries an exported: source_key (the dead rows took the live key), and the gone
# file's memberships, looked up by their exported: key, are dropped as export_row_unplaced.

# M5: a newer format replayed as if readable.
mut ccd/history/sweep.mjs "opened.verdict !== null && opened.verdict.word === 'replay'" "opened.verdict !== null && opened.verdict.word !== 'foreign'"
T 'O44, the segment case'; cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: the newer segment's blob is inserted ([{ n: 1 }]) and export_segment_newer reads '[]'.

# M6: an unreadable segment skipped instead of failing its chunk.
mut ccd/history/sweep.mjs "  const opened = name === null ? { sdb: null, verdict: null } : openForReplay(run, dir, name);" \
  "  const opened = name === null ? { sdb: null, verdict: null } : (() => { try { return openForReplay(run, dir, name); } catch { return { sdb: null, verdict: null }; } })();"
T 'cannot be read'; cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: the first step answers done: true and recover_chunk_failed reads 0.

# M7: a resumed chunk restarts its segment — it re-applies what an earlier chunk committed.
mut ccd/history/sweep.mjs "  const after = found === -1 ? 0 : cursor.offset;" "  const after = 0;"
T 'the cursor'; cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: the step never reaches reindex within 200 small budgets (expected false to be true), and
# export_epoch_conflict counts more than once.

# M8: +pairs dropped by the export cursor.
mut ccd/history/sweep.mjs "blobId: null, pairsAdded: run.pairsAdded });" "blobId: null, pairsAdded: false });"
T 'the cursor'; cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: '+pairs survives every export cursor' lists the cursors without it.

# M9: replayed entries left unmarked.
mut ccd/history/sweep.mjs "  s.entryMark.run(seg.markMs, seg.name, e.entry_id);" ""
T 'BK21'; cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: rowSeg reads null, expected '1.0a1b2c3d.db'.

# M10: the chunk outside one transaction — a failed chunk leaves its earlier rows behind.
mut ccd/history/sweep.mjs "    next = withTx(db, 'NORMAL', () => {" "    next = (() => {"
mut ccd/history/sweep.mjs "    });   // the chunk's one transaction: what it applied, and the cursor past it" "    })();   // MUTANT: no transaction"
T 'rolls back what it applied'; cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED: 'nothing of the failed chunk stayed' reads [1, 0, 1]: the first entry and the conflict count stayed.

cmp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs && cmp "$SCRATCH/lib.orig" ccd/history/lib.mjs && echo restored
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'W1-B4 Task 10')   # green again
```

- [ ] **Step 9: Commit.**

```bash
git add ccd/history/sweep.mjs server/test/historyHelpers.ts server/test/history-recover.test.ts
git commit -m "feat(history): export replay in the recovery step, blobs then rows, onto dead-file rows (W1-B4 Task 10)"
```

### Task 11: O43: the export survives source loss: export, lose the transcripts and history.db, rebuild, then expand, describe and --workspace; a reused inode

**Files:**
- Modify: `server/test/history-recover.test.ts`: one describe appended at the END of the file, after Task 10's. No import line: it uses B2 Tasks 27–28's `rr*` helpers and namespaces (`rrH`, `rrLib`, `rrFs`, `rrPath`, `rrFx`, `rrU`, `rrIso`, `rrQ`, `rrCount`, `rrRoot`, `rrLose`, `rrTickUntil`, `rrCliPty`, `rrLeafIds`, `rrRecovered`, `rrStart`, `rrTalk`, `RR_SLUG`, `RrBox`).
- Modify, only for a fix this drill exposes: `ccd/history/sweep.mjs` (Task 10's export-replay section, in place). A fix carries a one-line comment naming the O43 case that found it, and goes into the PR body's choices.

**Interfaces:**
- Consumes:
  - Tasks 5–10: the export pass (`exportStep`, run past its hourly clock by the driver's `offsetMs`), its segment format and marks, and Task 10's replay.
  - Task 5 (`historyHelpers.ts`): `segmentsOf(box): string[]` (the store's published segments; this task reads each entry's `path.basename`, so names and paths both serve).
  - Task 1 (`lib.mjs`): `exportedSourceKey(path, dev, ino)`.
  - B2: `doctor --rebuild` through the CLI door on a terminal (Task 28), `expand <message uuid>`, `describe <node id> --json` (its `items[0].node_id`) and `tree --workspace --json` (its `scope.families[].ccrc_id`) from a `cc-` pane (Tasks 12–17, via B2 Task 10's `withPane` and `runCli`), derivation's readiness (`pickHoldingCopy`, `leafReady`: a holding copy's `eof_ms` at least five minutes past its boundary).
  - B2 test helpers: `rrH.makeHistoryBox(prefix, { role: 'fleet' })`, `rrH.plantSession`, `rrH.plantTranscript`, `rrH.spoolLine`, `rrH.runDriver(box, { offsetMs })`, `rrH.runShim`, `rrH.counters`, `rrH.withPane`, `rrH.runCli`, and the `rr*` helpers above; the historyFixtures builders `userRow`, `assistantRow`, `boundaryRow`, `summaryRow` (as `rrFx`).
- Produces: the O43 describe (three cases). No new helper outside it.

**Spec:**
- §9.11 O43; §9.14 (rebuild, then export replay, then re-ingest by cursor); §8.4 `doctor --rebuild`; §9.15 "Memberships of a gone file"; §6.1 (leaf ids re-derive equal).
- Pin: **O43** (both halves: the rebuild answers from the export; a reused inode's memberships stay on the `exported:` row).
- Review focus: the same rebuild with the live transcript KEPT: each row once, the leaf id equal, the replayed marks surviving the re-ingest.
- Departure: ⟦D:history-sole-copy-export⟧.

**Choices this task makes:**
- The drill keeps the registry. O43's spec text loses the transcripts and `history.db`, nothing else. The reading pane needs its own `$REG/<id>.project`, `.workdir` and `.generation` for `--workspace`, and O35 already pins that replay never reads `$REG`. Nothing the registry holds can give back the text, the gone file's memberships or the epoch's `cwd`, so every assertion below still has only the export as its source.
- Inode reuse is simulated by RENAMING A's file onto B's path and rewriting it in place (truncate and write keep the inode), never by relying on the allocator.

- [ ] **Step 1: Check the base carries B2's rebuild fix.** B2's plan text once read `journalEnds(…)?.head.store_id` in `journalStoreDirs`, while its `journalEnds` answers `{ headT, headStore, lastT }`, so any readable month file threw `TypeError` and `doctor --rebuild` with it. B2's plan now carries the fix (it reads `?.headStore`; coordinator ruling RD4), so B4 depends on no patch of its own; this step still checks that the merged base holds it. From the repository root:

```bash
grep -n '\.head\.store_id' ccd/history/sweep.mjs || echo 'no .head.store_id read: the fix is on the base'
```

Expected: `no .head.store_id read: the fix is on the base`. If a line prints, stop: report to the coordinator that the merged B2 still carries the defect, and do not patch B2's code in this task.

- [ ] **Step 2: Write the drill.** Append at the END of `server/test/history-recover.test.ts`:

```ts
// ── W1-B4 Task 11: O43, the export survives source loss (spec §9.11 O43, §9.14, §9.15) ─────────────────────────────
// The whole path through the real sweep, the real CLI and the real rebuild. A family is captured in a real workdir
// and compacted; its leaf derives; the export pass, run two hours on (past its hourly clock; the fixture homes carry
// no cleanupPeriodDays, so the transcript's home has horizon 0 and, under the per-copy rule, every row is due from the
// file's last write, two hours before the pass's clock), writes one segment. Then the transcript and
// history.db are lost, and `doctor --rebuild` replays the journal and the export. Only the export holds the text, the
// gone file's memberships and the epoch's launch cwd, so each read verb that answers proves the segment came back.
describe('O43: the export survives source loss (W1-B4 Task 11)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  const O43_ID = 'claude-a-export';
  const O43_G = '0189abcd-1234-4678-9abc-0000000043a1';
  const O43_U = 'b43b43b4-0000-4000-8000-000000000431';
  const O43_HOUR = 3_600_000;
  const O43_WORK = 'Polishing the export fixture.';
  const O43_TEXT = `zqb4export ask about ${O43_WORK}`;

  /** rrCompacted's transcript, launched in `cwd`: a user and an assistant row, a manual compaction's boundary, its
   *  summary right after it, then one more row. Row uuids are rrU(base)…rrU(base + 4); one native leaf derives. */
  function o43Compacted(sid: string, base: number, cwd: string): object[] {
    const at = (k: number) => ({
      uuid: rrU(base + k), ts: rrIso(10 - k), parentUuid: k === 0 ? null : rrU(base + k - 1), sessionId: sid, cwd,
    });
    const anchor = rrU(base + 3);
    const summary = [
      '<summary>',
      '1. Primary Request and Intent:',
      '   Keep the fixture repository healthy.',
      '8. Current Work:',
      `   ${O43_WORK}`,
      '9. Optional Next Step:',
      '   Run the suite again.',
      '</summary>',
    ].join('\n');
    return [
      rrFx.userRow({ ...at(0), text: O43_TEXT }),
      rrFx.assistantRow({ ...at(1), text: 'zqb4export answer' }),
      rrFx.boundaryRow({ ...at(2), trigger: 'manual', headUuid: anchor, anchorUuid: anchor, tailUuid: anchor, allUuids: [] }),
      rrFx.summaryRow({ ...at(3), text: summary }),
      rrFx.userRow({ ...at(4), text: 'zqb4export after the compaction' }),
    ];
  }

  interface O43Built { box: RrBox; transcript: string; workdir: string; leaf: string; segment: string; dev: bigint; ino: bigint }
  /** A bound box whose store captured one compacted family launched in a real workdir, derived its leaf, and then
   *  exported every row in one pass run two hours on. Nothing writes the transcript after it is planted, so its mtime,
   *  the per-copy clock, is before every pass's. */
  function o43Built(prefix: string): O43Built {
    const box = rrH.makeHistoryBox(prefix, { role: 'fleet' });
    const workdir = rrPath.join(box.home, 'work', 'w');
    rrFs.mkdirSync(workdir, { recursive: true });
    rrH.plantSession(box, O43_ID, { uuid: O43_U, generation: O43_G, project: 'demo', workdir });
    const transcript = rrH.plantTranscript(box, 'claude-a', RR_SLUG, O43_U, o43Compacted(O43_U, 430, workdir));
    rrH.spoolLine(box, O43_ID, rrStart(O43_ID, O43_U, 'startup', { reg: O43_U, gen: O43_G }));
    rrTickUntil(box, () => rrCount(box, 'entries') === 5 && rrLeafIds(box).length === 1, 10);
    const leaf = rrLeafIds(box)[0]!;
    const st = rrFs.statSync(transcript, { bigint: true });
    const r = rrH.runDriver(box, { offsetMs: 2 * O43_HOUR });
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    const segs = rrH.segmentsOf(box).map((s) => rrPath.basename(s));
    expect(segs, 'one segment, written past the export\'s hourly clock').toHaveLength(1);
    expect(rrQ<{ n: number }>(box, 'SELECT count(*) AS n FROM entries WHERE exported_seg = ?', segs[0]!)[0]!.n, 'every row exported').toBe(5);
    return { box, transcript, workdir, leaf, segment: segs[0]!, dev: st.dev, ino: st.ino };
  }

  const launch = (box: RrBox): unknown[] =>
    rrQ(box, 'SELECT cc_session_uuid, cwd, cwd_real, started_ms, git_branch FROM epochs ORDER BY cc_session_uuid');

  it('O43: exported, then the transcript and history.db lost: doctor --rebuild replays the segment, and expand, describe and --workspace answer from it; nothing is exported twice', async () => {
    const b = o43Built('ccrc-hist-o43-');
    const { box } = b;
    const before = launch(box);
    expect(before, 'CONTROL: the lost store knew the launch cwd').toEqual([expect.objectContaining({ cc_session_uuid: O43_U, cwd: b.workdir })]);
    rrFs.rmSync(b.transcript);
    rrLose(box, { binding: false, journal: false });
    const r = await rrCliPty(box, ['doctor', '--rebuild']);
    expect(r.code, r.out).toBe(0);
    rrTickUntil(box, () => rrRecovered(box) && rrLeafIds(box).length === 1, 12);
    expect(rrLeafIds(box), 'the leaf re-derives from the exported copy, with the lost store\'s id').toEqual([b.leaf]);
    expect(launch(box), 'the epoch\'s launch facts came back from the segment alone').toEqual(before);
    expect(rrQ(box, 'SELECT source_key, status FROM ingest_files ORDER BY file_id'), 'one dead-file row, and no live one')
      .toEqual([{ source_key: rrLib.exportedSourceKey(b.transcript, b.dev, b.ino), status: 'exported' }]);
    expect(rrQ<{ n: number }>(box, 'SELECT count(*) AS n FROM entries WHERE exported_seg = ?', b.segment)[0]!.n, 'replayed rows are marked').toBe(5);
    const pane = rrH.withPane(box, O43_ID);
    const ex = rrH.runCli(box, ['expand', rrU(430)], { env: pane });
    expect(ex.code, `${ex.stdout}\n${ex.stderr}`).toBe(0);
    expect(ex.stdout).toContain(O43_TEXT);
    const d = rrH.runCli(box, ['describe', b.leaf, '--json'], { env: pane });
    expect(d.code, `${d.stdout}\n${d.stderr}`).toBe(0);
    expect((d.json?.['items'] as Array<{ node_id: string }>)[0]!.node_id).toBe(b.leaf);
    const w = rrH.runCli(box, ['tree', '--workspace', '--json'], { env: pane });
    expect(w.code, `${w.stdout}\n${w.stderr}`).toBe(0);
    expect((w.json?.['scope'] as { families: Array<{ ccrc_id: string }> }).families.map((f) => f.ccrc_id)).toEqual([O43_ID]);
    // The replay marked every row, so a pass past the rebuilt store's own hourly clock finds nothing due, though the
    // per-copy rule makes every row of the gone transcript due at once: marked rows are never candidates.
    const again = rrH.runDriver(box, { offsetMs: 2 * O43_HOUR });
    expect(again.code, `${again.stdout}\n${again.stderr}`).toBe(0);
    expect(rrH.segmentsOf(box).map((s) => rrPath.basename(s))).toEqual([b.segment]);
  }, 300_000);

  it('O43, a reused inode: the gone file\'s exported memberships land on its exported: row, never on the live file that now has its inode, and ingesting that file moves nothing of them', async () => {
    const b = o43Built('ccrc-hist-o43-inode-');
    const { box } = b;
    const B_ID = 'claude-a-inode';
    const B_U = 'b43b43b4-0000-4000-8000-000000000432';
    const B_G = '0189abcd-1234-4678-9abc-0000000043b1';
    const aUuids = [0, 1, 2, 3, 4].map((k) => rrU(430 + k));
    const bUuids = [rrU(440), rrU(441)];
    // The reuse: A's file renamed onto B's canonical path keeps its inode, and rewriting it in place keeps it too.
    const pB = rrPath.join(rrPath.dirname(b.transcript), `${B_U}.jsonl`);
    rrFs.renameSync(b.transcript, pB);
    rrFs.writeFileSync(pB, `${rrTalk(B_U, 440, 2).map((x) => JSON.stringify(x)).join('\n')}\n`);
    expect(rrFs.statSync(pB, { bigint: true }).ino, 'CONTROL: B\'s file holds A\'s inode').toBe(b.ino);
    rrLose(box, { binding: false, journal: false });
    expect((await rrCliPty(box, ['doctor', '--rebuild'])).code).toBe(0);
    rrH.plantSession(box, B_ID, { uuid: B_U, generation: B_G, project: 'demo' });
    rrH.spoolLine(box, B_ID, rrStart(B_ID, B_U, 'startup', { reg: B_U, gen: B_G }));
    const held = (fileId: number): string[] => rrQ<{ uuid: string }>(box,
      'SELECT e.uuid AS uuid FROM memberships m JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? ORDER BY m.line', fileId).map((x) => x.uuid);
    const fileOf = (sourceKey: string): number | undefined => rrQ<{ file_id: number }>(box,
      'SELECT file_id FROM ingest_files WHERE source_key = ? AND dev = ? AND ino = ?', sourceKey, Number(b.dev), Number(b.ino))[0]?.file_id;
    rrTickUntil(box, () => rrRecovered(box) && fileOf('') !== undefined && held(fileOf('')!).length === 2, 12);
    const dead = fileOf(rrLib.exportedSourceKey(b.transcript, b.dev, b.ino));
    const live = fileOf('')!;
    expect(dead, 'A\'s dead-file row').toBeDefined();
    expect(rrQ(box, 'SELECT status FROM ingest_files WHERE file_id = ?', dead!)).toEqual([{ status: 'exported' }]);
    expect(held(dead!)).toEqual(aUuids);
    expect(held(live)).toEqual(bUuids);
    rrTickUntil(box, () => true, 1);   // one more tick over the live file
    expect(held(dead!), 'nothing of A moved').toEqual(aUuids);
    expect(held(live)).toEqual(bUuids);
    expect(rrH.counters(box)['inode_recycled'] ?? 0, 'the dead row is never taken for the live file').toBe(0);
  }, 300_000);

  it('review focus: the same rebuild with the live transcript KEPT: expand prints each row once, the leaf keeps its id, and the replayed marks survive the re-ingest', async () => {
    const b = o43Built('ccrc-hist-o43-kept-');
    const { box } = b;
    rrLose(box, { binding: false, journal: false });
    expect((await rrCliPty(box, ['doctor', '--rebuild'])).code).toBe(0);
    rrTickUntil(box, () => rrRecovered(box) && rrLeafIds(box).length === 1
      && rrQ<{ n: number }>(box, "SELECT count(*) AS n FROM ingest_files WHERE source_key = '' AND eof_ms IS NOT NULL")[0]!.n === 1, 12);
    expect(rrLeafIds(box)).toEqual([b.leaf]);
    expect(rrCount(box, 'entries'), 'one row per uuid, whichever copy brought it').toBe(5);
    const ex = rrH.runCli(box, ['expand', b.leaf], { env: rrH.withPane(box, O43_ID) });
    expect(ex.code, `${ex.stdout}\n${ex.stderr}`).toBe(0);
    expect(ex.stdout.split(O43_TEXT).length - 1, 'each row once').toBe(1);
    expect(rrQ<{ n: number }>(box, 'SELECT count(*) AS n FROM entries WHERE exported_seg = ?', b.segment)[0]!.n,
      'the re-ingest left the replayed marks, so nothing is exported twice').toBe(5);
  }, 300_000);
});
```

- [ ] **Step 3: Run it.** Foreground, timeout ≥ 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'O43')
```

Expected: green, Tasks 5–10 being in place. A red names a gap between them; fix it in Task 10's section (or the task that owns the failing half), in place, with a one-line comment naming the O43 case that found it. The likely reds, with where each points:
- `rrTickUntil: not done after 12 passes` with no leaf: the dead-file row's `eof_ms` (Task 10's `ensureDeadFile`) or the summary row's replay; read the row with `rrQ(box, 'SELECT source_key, eof_ms FROM ingest_files')`.
- `expand` exit 3: the entry or its membership was skipped; read `rrH.counters(box)` for `export_row_unplaced` and `export_row_blob_missing`.
- the launch facts differ: the segment's epoch row (Task 5) or `replayEpochRow`'s fill.
- a second segment after `again`: a replayed entry left unmarked.

- [ ] **Step 4: Measure the drill red with segment replay disabled.** The drill passes only through the export, so a step that skips the rows must red it:

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w1-b4/scratch"; mkdir -p "$SCRATCH"
cp ccd/history/sweep.mjs "$SCRATCH/sweep.orig"
python3 - <<'EOF'
p = 'ccd/history/sweep.mjs'
s = open(p).read()
old = "function recoverExportRowsChunk(db, run, cursor) {\n  return exportPhaseChunk(db, run, cursor, false);\n}"
assert s.count(old) == 1
open(p, 'w').write(s.replace(old, "function recoverExportRowsChunk(db, run, cursor) {\n  return { cursor, moved: false, phaseDone: true };\n}"))
EOF
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'O43: exported, then')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
```

Expected RED: `rrTickUntil: not done after 12 passes` (no row came back, so no leaf derives). Then the reused-inode case with the dead-file key made live (Task 10's M4 at the end-to-end level):

```bash
python3 - <<'EOF'
p = 'ccd/history/sweep.mjs'
s = open(p).read()
old = "  const key = exportedSourceKey(path, dev, ino);"
assert s.count(old) == 1
open(p, 'w').write(s.replace(old, "  const key = '';"))
EOF
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'O43, a reused inode')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
cmp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs && echo restored
```

Expected RED: `A's dead-file row` is undefined: the replay wrote A's row under the live key, B's ingest then met it as a recycled inode (`inode_recycled` 1), and A's memberships are on a `retired:` row.

- [ ] **Step 5: Run the whole recovery file.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
```

Expected: green: B2's cases, Task 10's and these three.

- [ ] **Step 6: Commit.** `ccd/history/sweep.mjs` is staged only if Step 3 needed a fix:

```bash
git add server/test/history-recover.test.ts
git diff --quiet -- ccd/history/sweep.mjs || git add ccd/history/sweep.mjs
git commit -m "test(history): O43, the export survives the loss of its transcripts and history.db (W1-B4 Task 11)"
```

### Task 12: Wrap-up: single-definition and O13/O14 re-checks, README's history sentence in place, CLAUDE.md's figure, the whole-PR checks and the PR body with the coordinator's and operator's steps

**Files:**
- Modify, only if Step 1 measures a new lib vocabulary: `server/test/single-definition.test.ts`, in place, in B1's end-appended O14 describe `'ccrc history: every vocabulary is declared once, in lib.mjs, and bound to its uses (spec 2026-10-05 §9.11 O14)'`, its `VOCABS` array (B2 Task 36 widened it). It is a citation-corpus file: no import line, no insertion.
- Modify: `README.md`. In place, in B2's `### Session history: lossless recall (\`ccrc history\`)` section, its last paragraph (`**Box verbs and operator verbs.**`), anchored by content: the four lines from `` `cc-*` pane. These are speed bumps, not walls: `` to `` refuses (`recovering`). `` are reflowed into seven. No `file.ext:N` token is added, so README's census entry stays empty.
- Modify, only if Step 3's measurement calls for it: `CLAUDE.md`, the `README.md (~N lines)` figure on its line 10 (pre-existing; measured at main-ro f7e51156f as `(~5700 lines)`; B1, B2 and other programmes re-measure it, so read it on this base), in place.
- Create (gitignored scratch, not committed): `.superpowers/sdd/history-w1-b4/pr-body.md`.
- Test: `single-definition`, `pools-prose`, `readme-holds`, `oss-metadata`, `topology-clean`, `readme-roster-mirror`, the session-hook citation census, `deviation-refs`, `ci-pipeline`, and every suite Step 6 lists.

**Interfaces:**
- Consumes: every earlier task; B1 and B2's end-appended single-definition blocks (O13 `HOLDERS`, O14 `VOCABS`, the env `ALLOWED` list); B2 Task 33's README history section; CLAUDE.md's README figure.
- Produces: the README sentence; CLAUDE.md's figure when it moved; the PR body file.

**Spec:**
- §10.5 (B4's contents and pins: O39, O40, O43, O44's segment case); §10.6 step 3; §10.7 W1-g and W1-k; §9.12 (rollout by the release lane only); §13 (single definition, switches with no writer); §15.1 and §15.3 (Q15–Q19 and prune at low disk, ruled 2026-10-07, rev 3.4).
- Departures: ⟦D:history-b4-after-b2⟧, B1's D-4246 (`history-w1b-three-prs`) (B4 follows B2; B3's order does not matter), and NEW ⟦D:history-readme-export-sentence⟧: rev 3.2's §10.5 "Edited files" assigns each README edit to a PR (B1, B2, B3, W3) and gives B4 none, but B2's history section says the store is the text's only copy past Claude Code's retention, which is false once the export ships, so B4 repairs that one sentence in place (B2 marked its own unlisted README edits the same way, as a NEW slug of its plan).

- [ ] **Step 1: Re-check the single-definition bindings this PR could break.** From the repository root:

```bash
git fetch origin main
# O14: RECOVER_PHASES is still declared once, in lib.mjs (Task 3 changed it in place).
grep -rnE '^(export )?(const|let|var) RECOVER_PHASES\b' ccd/history deploy shared
# O14: every frozen array or object export this PR added to lib.mjs; RECOVER_PHASES is already bound.
git diff origin/main -- ccd/history/lib.mjs | grep -E '^\+export const [A-Z_]+ = Object\.freeze' || echo 'no new frozen export'
# O13: sweep.mjs never spells a switch path; history-off is read through ctx.paths.off.
grep -n '/history-off' ccd/history/sweep.mjs ccd/history/cli.mjs || echo 'no /history-off spelling'
# The env allow-list: no new process.env read anywhere in ccd/history.
git diff origin/main -- ccd/history | grep -n '^+.*process\.env' || echo 'no new process.env read'
```

Expected: one declaration line, `ccd/history/lib.mjs:<n>:export const RECOVER_PHASES = Object.freeze([…])`; then either `no new frozen export` or only the `RECOVER_PHASES` line (changed in place); `no /history-off spelling`; `no new process.env read`. If the second command prints any other name, add it to `VOCABS` in place (the array's last element gains it, nothing else on the line changes) and re-run `(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')`, which must stay green. Then run it in any case:

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
```

Expected: green.

- [ ] **Step 2: Repair README's "only copy" clause in place** (⟦D:history-readme-export-sentence⟧, NEW). B2's section says the store is the text's only copy past Claude Code's retention; with the export it no longer is. Measure README first, then replace the four lines by content:

```bash
wc -l < README.md                      # note it as B
sed -n 10p CLAUDE.md                   # note the N in `README.md` (~N lines)
python3 - <<'EOF'
p = 'README.md'
s = open(p, encoding='utf8').read()
old = """`cc-*` pane. These are speed bumps, not walls: the store holds verbatim session text, secrets
included, and past Claude Code's retention it is that text's only copy. `doctor --backup` writes
`db/backups/<UTC time>.db`; `--restore <name>` puts one back, `--rebuild` remakes a lost store from
the journal, and until the sweep has replayed it every other writing verb refuses (`recovering`).
"""
new = """`cc-*` pane. These are speed bumps, not walls: the store holds verbatim session text, secrets
included, and past Claude Code's retention it and its export are that text's only copies. As text
nears that retention, the sweep copies it into immutable SQLite segments under
`~/.ccrc/history/export/` on the home filesystem, at most one segment an hour, pausing before that
filesystem's free-space floor. `doctor --backup` writes `db/backups/<UTC time>.db`; `--restore <name>`
puts one back, `--rebuild` remakes a lost store from the journal and the export, and until the sweep
has replayed them every other writing verb refuses (`recovering`).
"""
assert s.count(old) == 1, s.count(old)
open(p, 'w', encoding='utf8').write(s.replace(old, new))
print('replaced')
EOF
wc -l < README.md                      # B + 3
```

Expected: `replaced`, and the second count is `B + 3`. If the assertion fails, B2's paragraph was reworded at its merge: find the sentence that holds `it is that text's only copy` by content, and make the same change by hand, keeping every other word of the paragraph.

- [ ] **Step 3: Re-measure CLAUDE.md's README figure.** Run `n=$(wc -l < README.md); echo $(( (n + 50) / 100 * 100 ))`. If it differs from the `N` noted in Step 2, change that number in place on `CLAUDE.md:10`, one number on one line and nothing else. If it equals `N`, leave `CLAUDE.md` untouched.

- [ ] **Step 4: Run every suite that reads README or CLAUDE.md, and the citation census.** Foreground, timeout ≥ 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts test/readme-holds.test.ts test/oss-metadata.test.ts test/topology-clean.test.ts test/readme-roster-mirror.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored|THE CITATION DEBT')
```

Expected: green. `pools-prose` holds the figure within 100 lines of README's length. The census is unchanged: README's own entry stays empty and the headline unmoved, because the edit sits in B2's history section and adds no `file.ext:N` token (README is repaired by content, not counted). If `topology-clean` reds, the sentence names a host or an id; it must not.

- [ ] **Step 5: Check the node-floor leg's list and its time.**

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w1-b4/scratch"; mkdir -p "$SCRATCH"
grep -E '^ {10}test/' .github/workflows/ci.yml | sed 's/^ *//' > "$SCRATCH/floor-list.txt"
echo "listed $(wc -l < "$SCRATCH/floor-list.txt"), expected $(( $(ls server/test/history-*.test.ts | wc -l) + 2 ))"
grep -c '^test/history-export.test.ts$' "$SCRATCH/floor-list.txt"
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts)
(cd server && CCRC_TEST_LIST="$SCRATCH/floor-list.txt" ./node_modules/.bin/vitest run --config vitest.select.config.ts 2>&1 | tail -6)
```

Expected: the two counts equal (every `history-*.test.ts` plus `node-floor` and `measure-history`), `1` for Task 5's file, `ci-pipeline` green, and a green summary whose last lines carry `Duration`; copy it into the PR body. If `Duration` exceeds 15 minutes, raise the `node-floor` job's deadline in place and re-run the two suites that pin it, as B2's wrap-up did:

```bash
sed -i '/^  node-floor:$/,/^    timeout-minutes:/ s/^    timeout-minutes: 30$/    timeout-minutes: 60/' .github/workflows/ci.yml
git diff -U0 -- .github/workflows/ci.yml   # exactly one changed line
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts test/oss-metadata.test.ts)
```

If `Duration` exceeds 40 minutes, report it to the coordinator instead: the leg then needs a second job or a split list, which this plan does not design.

- [ ] **Step 6: Run every B4 suite and its neighbours, in the foreground.** One line at a time, timeout ≥ 600000 ms. Re-run a red file alone before calling it a break (CLAUDE.md names the load flakes):

```bash
for f in $(ls server/test/history-*.test.ts | xargs -n1 basename); do (cd server && ./node_modules/.bin/vitest run "test/$f" 2>&1 | tail -4); done
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts test/lifecycle.test.ts test/single-definition.test.ts test/ci-pipeline.test.ts test/license.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'history|ends with doctor')
(cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts -t 'history|purge')
(cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts test/readme-holds.test.ts test/topology-clean.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: all green; tsc prints nothing. Copy each `Test Files … | Tests …` summary line, as printed, into the PR body. Every spawning history suite skips on darwin; on Linux they run whole.

- [ ] **Step 7: Check the deviation ledger against `main` without merging.**

```bash
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: green. A red means a deviation number defined in two plans: report it to the coordinator. Never renumber one yourself; this PR defines none (every departure is a `⟦D:<slug>⟧` the coordinator mints).

- [ ] **Step 8: Confirm the tree holds only this PR's work.** Run `git status --short`. It lists nothing but this task's files (`README.md`, `CLAUDE.md` when Step 3 moved its figure, `single-definition.test.ts` when Step 1 widened `VOCABS`, `.github/workflows/ci.yml` when Step 5 raised the deadline). Every scratch file sits under the ignored `.superpowers/`. No step of this plan read or wrote a live `~/.ccrc`: every test ran in a fixture HOME, and every history verb ran against a fixture store.

- [ ] **Step 9: Write the PR body.** Write `.superpowers/sdd/history-w1-b4/pr-body.md` with exactly the following. Then replace its three parenthesised lines: the one under `### Departures` with the plan's `## Deviations found` list (each number as the coordinator minted it, one per line); the one under `### Choices the tasks made` with every task's "Choices this task makes" and "Plan choices" bullets, one line each, its task number first, plus any fix Task 11 Step 3 needed (the coordinator's rulings RD1–RD4 have their own section, already final); and the one under `### Tests run` with Steps 5 and 6's summary lines as printed. Use the file as the body of the wave's PR, opened the way the brief says.

```markdown
## ccrc history W1-B4 "sole-copy export"

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.5), §10.5's B4 bullet and §9.15 (ruled Q6, e; its due rule the per-copy one, ruled Q15).
Plan: the B4 plan this wave's brief names.

Before Claude Code deletes a transcript, the sweep copies its text into immutable SQLite segments on the home
filesystem, and a rebuild replays them, so a store lost with its transcripts can still expand, describe and scope
that text:

- lib decisions: the export constants, segment names and numbering past every name on disk, the hourly cadence, the
  home-filesystem preflight (`planCopy` with that filesystem's own floor and the 256 MiB segment bound), the
  mark-failure backoff and the check after a bind (RD2: the sweep measures and acts), the row-level due rule that
  carries a due row's unexported blobs (B2's per-copy reducer as its default, the census's, so the two keep one
  clock), the oldest due-since, the two export recovery phases and their cursor arm, the
  segment replay verdict, and doctor's `export-due` rule with the writer live;
- store.mjs segments: a temp written `O_EXCL` 0600 with journal mode off, published by `link()` (never by rename, never
  overwritten), a read-only open, page readers, the listing and stale temps;
- the export pass in the tick: at most once an hour (backed off after a pass that published and could not mark), one
  segment per pass, marks set after the link (a busy between the link and the marks records the segment's number and
  the attempt clock before it ends the tick, RD3), a late variant or a late-linked sidecar clearing its entry's marks,
  and marks naming a segment this box lacks cleared after any bind;
- segment replay in B2's recovery step, between `apply` and `reindex`: every segment's blobs, then every segment's
  rows, the journal's families and epochs first, a gone file's memberships onto an `exported:` dead-file row;
- status `--json`'s export block (segments counted by name and size, never opened; the last pass; the oldest
  due-since; the pause) and doctor's `export-due`, which WARNs on a gap rather than on the pass's cadence;
- the `history-export` lifecycle row, and README's one repaired sentence.

No hook, `ccd/ccrc`, deploy, server or PWA edit; no schema migration (schema v1 already carries `exported_ms` and
`exported_seg`); no `WRITING_FORMS` entry, journal record kind or health word.

### Pins

O39, O40, O43, O44's segment case; O41's B4 cases (steady state PASS; a due blob waiting more than two pass intervals,
or a last pass older than 2 h, WARNs); O58's B4 half (`planSegment` and the pass answer by the per-copy default, with
its CONTROLs). O41's B1 half and O38 stay B1's (O38's due cases as B2 re-pinned them) and stay green.

### Departures

(the plan's `## Deviations found` list, as minted)

### Steps for the coordinator or the operator, never the worker

1. **W1-k, read-only, before merge.** On every session-hosting node, read `ccrc history status --json`'s export
   block (`oldest_row_ms`, `first_due_ms`, `first_deletion_ms`). The live-by date for this PR is the earliest of
   those dates and 2026-12-19 (§9.15, §10.6; ⟦D:history-b4-after-b2⟧).
2. **Full suite.** This PR edits `.github/workflows/ci.yml` (Task 5's node-floor line), which selects the full suite.
   If the PR's `select tests` summary does not show a full run, dispatch one:
   `gh workflow run ci.yml --ref <this branch> -f mode=full`.
3. **Rollout through the release lane only** (§9.12): merge, then promote and move the fleet with the update control
   plane or `ccrc rollout`. Nothing is rolled out by hand.
4. **Expect the backlog.** Under the per-copy rule (ruled Q15, rev 3.4; B2's default before this PR), text whose
   every holding file sits in a home on Claude Code's 30-day default (no `cleanupPeriodDays`; ccrc never writes the
   key, so every newly added account) is due from its file's last write, and so is text whose every file is gone from
   disk. On a node whose transcripts live mostly in such homes the first passes drain that backlog at one segment of
   about 256 MiB an hour (each row counted at its new blob bytes plus an estimate of its metadata, so a segment can
   pass 256 MiB by that estimate's error, or by one row larger than the bound) and WARN `export-due` until they have.
   A 30-day home that holds only swap copies of a 180-day home's transcripts brings nothing forward. Check that
   node's home-filesystem headroom first (`df -h ~`): the export's preflight pauses it before that filesystem's floor
   (`export-paused-low-disk`). `retention-lowered` stays as a reminder, not a gate: setting the key in the named home
   defers that home's rows.
5. **After the rollout, per node:** doctor's `history` reads PASS, or only the expected WARNs (`retention-lowered`,
   and `export-due` while a backlog drains); `export_paused_low_disk` is 0 in `status --json`'s counters; no
   `export-overdue`.
6. **Optional, the rebuild drill with the export (W1-l's shape):** into a scratch HOME, with copies of one node's
   `journal/<store_id>/` and `export/<store_id>/`, from a TTY outside any `cc-` pane, as §10.7's W1-l row describes.
   The live HOME is never written.
7. **B3's order does not matter:** B3 and B4 merge in either order after B2 (B1's D-4246 (`history-w1b-three-prs`)).
8. **Before a restore or an adopt that carries `export/<store_id>/`,** compare the carried directory with its source
   (names and sizes, `ls -l`). A zero-length or partial `<seq>.<writer>.db` left by an interrupted copy stalls the
   recovery step, and capture with it, until it is moved aside under a non-segment name (its text then not replayed)
   or replaced by a good copy; doctor FAILs `recovery-stalled` and the sweep's log names the segment
   (⟦D:history-export-segment-unreadable-stalls⟧).

### Residuals, named

- An unlinked sidecar row naming a blob an earlier segment already exported travels again with its next carrier;
  schema v1 gives sidecars no mark (⟦D:history-export-unlinked-sidecar-with-blob⟧).
- The memberships of a copy first seen after its rows were exported are not exported until a variant or a newly
  linked sidecar clears the entry's marks; a rebuild meanwhile has the rows from the earlier copy only.
- Every row is due by the files of its transcript, not its own copies (B1's D-4248 (`history-export-holding-files-by-transcript`),
  the per-row set the operator's Q15 ruling keeps): a fresher file of the same transcript that does not hold the
  row makes it due later than its own copies would, and a forked or resumed file of another transcript that holds it
  is not counted. B1 left the per-row set owed to B4; B4 keeps the census's clock so the export and doctor agree, as
  the coordinator ruled (RD1).
- The pass's `ts_ms` prefilter (the shortest home's horizon, B1's census cutoff) bounds only its old-rows phase. Its
  due-transcript phase walks the transcripts B2's `dueTranscriptKeys` makes due, the census's own prefilter, and offers
  every younger row of each, so no row the census counts due is left unselectable: neither a transcript with no file
  left on disk, nor a row held only by files gone from disk while an older file of its transcript stays on disk, nor a
  row stamped later than its file's mtime. The cost is one `dueTranscriptKeys` call over every transcript per pass,
  over the `transcriptFiles` measurement the pass already makes. B2 Task 35's named swap-prefix residual (rows written
  after a swap wait for the frozen source copy, which holds none of them) is the census's as much as the pass's: one
  clock (RD1).
- A segment's size is counted, not measured: each row at its new blob bytes plus a 1.5 KiB estimate of its metadata,
  so a segment lands near 256 MiB and can pass it by the estimate's error; a single row larger than the bound travels
  whole (⟦D:history-export-segment-bound-estimated⟧).
- An export segment that cannot be read stalls the recovery step and holds capture until an operator acts (step 8
  above; ⟦D:history-export-segment-unreadable-stalls⟧).
- A pass that is killed (the carrier's memory cap or its start timeout) records no attempt, so the next tick retries
  it; only a pass that fails with a caught error waits the hour, and one that published and could not mark backs
  off further (⟦D:history-export-mark-failure-backs-off⟧).
- A busy error between a segment's link and its marks records the segment's number and the attempt clock before it
  ends the tick (RD3). When that record meets busy too, nothing is recorded: the next tick's pass publishes the same
  rows again into a later segment, and replay absorbs the copy (insert-or-ignore by sha256, entries by the
  newest-rank rule). One extra segment per such double busy; no text is lost.
- `export-segment-newer` stays listed until a later recovery step walks the export again on a build that reads that
  format.
- A foreign segment is counted once per export-blobs walk; a walk restarted because its cursor's segment vanished
  counts it again.
- One full `memberships` scan runs per segment-writing pass: schema v1 has no index led by `memberships.entry_id`,
  and B4 adds no migration.

### Coordinator rulings (RD1–RD4)

Ruled on this plan, and landed as follows:

- **RD1.** Accepted as implemented: the cadence from the store's first tick, and a clock that went backwards runs the
  pass (Tasks 1, 6); the pass outside the capture pause (Task 6); a pruned row's byte-less stub (Tasks 2, 5, 10); an
  unlinked sidecar with its blob (Task 5); doctor's wait arm from the census's oldest due-since (Tasks 2, 9); a gone
  file's carried `eof_ms`, an unreadable segment stalling the step, a replayed variant's first file (Task 10); epoch
  replay filling NULL launch facts, `cwd`, `cwd_real` and `confirmed_ms` and skipping a seq the journal gave another
  uuid, `export_epoch_conflict` (Task 10); `exportWriterLive` a build fact (Task 9); the per-row holding-file set NOT
  delivered, one clock with the census (Tasks 5, 9); the estimated segment bound (Tasks 2, 5); the mark-failure
  backoff (Tasks 1, 7); a late-linked sidecar clearing its entry's marks (Task 8). Its last item, Q15 keeping the
  node-shortest reducer, is superseded by the operator's Q15 ruling (rev 3.4, 2026-10-07): the per-copy reducer is
  the default of the census's `planExport` (B2) and of `planSegment` (Task 2), and RD1's one clock still holds.
- **RD2.** The check after a bind's predicate and the mark-failure decision are lib's pure functions
  (`decideMarkCheck`, `missingSegmentNames`, `exportMarkFailsOf`, `decideMarkOutcome`; Task 1, pure tests and
  mutants); `sweep.mjs` only measures, calls them and acts (Tasks 7, 8, each with a CONTROL that runs a lib mutant
  through the sweep).
- **RD3.** A busy error between the link and the marks records the published segment's seq and the attempt clock
  before it is rethrown (Task 7, two in-process cases on the test's own connection, with CONTROLs); a record that
  itself fails is the residual named above.
- **RD4.** B2's rebuild defect in `journalStoreDirs` is fixed in B2's plan (`?.headStore`); Task 11 Step 1 confirmed
  the merged base holds it.

### Choices the tasks made where the spec and the rulings are silent

(every task's "Choices this task makes" and "Plan choices" bullets, one line each, its task number first)

### Operator rulings (spec §15.1, rev 3.4, 2026-10-07)

- Q15, yes: the per-copy due rule. B2 made `EXPORT_REDUCERS.perCopy` the default of `planExport` (the census and
  doctor's export arms); this PR's `planSegment` takes the same parameter with the same default, and the pass passes
  none, so the export and the census read one clock. The cadence and the preflight are unchanged.
- Q16, yes (B2): a `fork` epoch travels in a segment and replays like any other epoch; B4 writes no spool line.
- Q17, as recommended (B1, B2): no B4 wording. Q18: a W2 matter. Q19, no: B4 maps nothing.
- Prune at low disk, confirmed (`history-prune-not-floor-gated`, ruled): B4 does not touch prune.

### Tests run (foreground, on the worker's box)

(Steps 5 and 6's summary lines, as printed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

  - The three parenthesised lines are the only text this step replaces. Every other line is final.
  - The body names no host, account, home or session id. Check with `grep -nE '[0-9]{1,3}(\.[0-9]{1,3}){3}|\.ts\.net|/home/' .superpowers/sdd/history-w1-b4/pr-body.md`, which must print nothing.

- [ ] **Step 10: Commit.**

```bash
git add README.md
git diff --quiet -- CLAUDE.md || git add CLAUDE.md                                         # only when Step 3 moved the figure
git diff --quiet -- server/test/single-definition.test.ts || git add server/test/single-definition.test.ts   # only when Step 1 widened VOCABS
git diff --quiet -- .github/workflows/ci.yml || git add .github/workflows/ci.yml           # only when Step 5 raised the deadline
git commit -m "docs(history): README names the export beside the store; B4's whole-PR checks (W1-B4 Task 12)"
```

The PR body file stays under `.superpowers/` (gitignored) and is not committed.

## Deviations found

Every departure this plan takes from the spec is listed once below, in the order its first task meets it, with the task(s) that carry it. The text is the spec's §16 departure, except for the NEW departures, which no §16 row covers; each of those is marked "NEW departure (no spec §16 row)" with its one-line why. One slug is B2's NEW departure, reused here and marked so.

**No number is written here.** Each entry carries its slug as the placeholder `⟦D:<slug>⟧`, exactly as the tasks and source comments do. The numbers are minted by the allocator (`POST /api/ledger/deviations`) when the coordinator commits the plan, and the placeholders are replaced in that commit. A slug B2 defines keeps the number it is minted there. A departure B1 defined is not listed here: B1 is merged, so the tasks cite it by its issued number as "B1's D-NNNN (`<slug>`)", defined in `docs/superpowers/plans/2026-10-05-ccrc-history-w1-capture.md`'s `## Deviations found`.

- ⟦D:history-sole-copy-export⟧ (Tasks 1, 4, 5, 7, 11): Per source harness, blobs whose every referrer is due are exported with their referrer rows (due by the per-copy rule since rev 3.4, ruled Q15, ⟦D:history-export-due-per-copy⟧; rev 3.1 to 3.3 said older than the shortest measured retention minus 30 days), and the rows that place them, to immutable SQLite segments `export/<store_id>/<seq>.<writer>.db` on the home filesystem, published by `link()` and never overwritten; doctor WARNs `export-due` from the first unexported one on a build without the writer (§9.15; ruled Q6, W1-B4, live before the first measured due date, at the latest 2026-12-19 since rev 3.2).
- ⟦D:history-backup-preflight-and-rename⟧ (Tasks 1, 6): `doctor --backup` writes temp then renames, and its preflight counts the copy's size; since rev 3.1 that preflight is `planCopy`, shared with the pre-migration snapshot, `--restore` and the export (§8.4, §6.11). B2-defined; B4 uses it as the export's preflight, with the segment bound as the size.
- ⟦D:history-export-cadence-from-first-tick⟧ (Tasks 1, 6): NEW departure (no spec §16 row). §9.15 says only "at most once an hour"; the hourly clock runs from the store's first tick until the first pass, so a new store writes no segment in its first hour, the pass and doctor's last-pass rule read one clock, and every B1/B2 fixture HOME (no `cleanupPeriodDays`, so horizon 0) keeps its counters, files and statfs call counts.
- ⟦D:history-export-cadence-clock-backwards⟧ (Task 1): NEW departure (no spec §16 row). A last pass (or first tick) stamped after now means the wall clock went back; the pass runs rather than wait for the clock to catch up, because a late segment widens the window in which the store is the text's only copy and an early one costs nothing.
- ⟦D:history-export-mark-failure-backs-off⟧ (Tasks 1, 7): NEW departure (no spec §16 row). §9.15 says "at most once an hour" and that a crash before the mark repeats the rows in the next segment. The marks are one transaction on `db/`, which the export's preflight never measures, so while `db/`'s volume refuses them every hourly pass would publish another copy of the same rows until the home filesystem's floor. After a pass that published its segment and then failed to mark it, the wait doubles per such pass in a row (2 h, 4 h, …, at most a day, meta `export_mark_fails`), and a marked pass ends the backoff; the export is never skipped for a `db/` pause, which would remove its protection exactly while text ages. Ruled as implemented (RD1); the count and the wait are lib's decision (`decideMarkOutcome`, RD2), and a busy after the link does not back off (RD3).
- ⟦D:history-export-row-carries-blob⟧ (Tasks 2, 5, 10): A due row is exported with the bytes of every unexported blob it references, whatever that blob's younger referrers, a superset of the ruled rule; segments also carry the family, epoch and transcript rows that place it, and gone files' memberships replay onto `exported:` rows (§9.15; rev 3.1 review, BK11, BK12).
- ⟦D:history-export-due-per-copy⟧ (Tasks 2, 5, 9): The default due rule reads each row's own copies: a row is due when every one of its holding files (B1's per-row set, its transcript's files, B1's D-4248 (`history-export-holding-files-by-transcript`)) has passed its mtime plus its own home's retention minus 30 days, and a blob when its rows are; one reducer, `EXPORT_REDUCERS.perCopy`, made the default in W1-B2 for the census, doctor's `export-due`, `export-overdue` and `retention-lowered` arms and B4's pass, with no signature change; the node-shortest reducer is history and `retention-lowered` a reminder (§9.6, §9.15; O58; ruled Q15, rev 3.4). B2-defined. B4's `planSegment` takes the same reducer with the same default and the pass passes none (RD1's one clock); the pass also selects, whatever their time, the rows of every transcript the rule makes due now, through the census's own `dueTranscriptKeys`. It replaces B1's row clock (slug `history-export-row-age-early`, now history), on which this plan no longer departs.
- ⟦D:history-export-pruned-row-stub⟧ (Tasks 2, 5, 10): NEW departure (no spec §16 row). §9.15 says pruned blobs are never exported or counted due and is silent on their rows; a row that falls due after prune tombstoned its blob travels with a byte-less stub (sha256, codec, raw_len), because `entries.blob_id` is NOT NULL and a rebuild would otherwise lose the row and its structure. A stub is never marked exported, and its size never counts toward the bound (its row's metadata does).
- ⟦D:history-export-wait-from-census⟧ (Tasks 2, 9): NEW departure (no spec §16 row). "A due blob has waited more than two pass intervals" needs a due-since time the spec gives no clock for. It is measured from the census's oldest due-since (`planExport`'s `oldestDueSinceMs`), from the store's rows and never from a calendar date, so a steady store reads PASS. A blob nothing on disk holds back (the reducer answers `-Infinity`) is dated as B2 dates W1-k's holders: by the last write its recorded files saw, else its row's time. It is never dated as the epoch, which would render as 1970 and fire the wait arm the moment the census counted the blob. A blob the census can date by neither is due and counted but undated. The meta value, `status --json`'s `due_oldest_ms` and doctor's input keep three conditions apart: a time; `null`, nothing due; `'unmeasured'`, no census of this build recorded one, or it could date none of the due blobs. Neither `null` nor `'unmeasured'` fires the wait arm; the stale-pass arm still does.
- ⟦D:history-export-segment-bound-estimated⟧ (Tasks 2, 5): NEW departure (no spec §16 row). §9.15 says a segment holds "at most 256 MiB". The bound counts each taken row's new blob bytes plus `EXPORT_ROW_META_BYTES` (1.5 KiB, chosen) for its metadata, which a prototype measured at 0.8–1.1 KiB per entry with one membership; counting blob bytes alone let a review prototype's files reach 1.14× the bound at 8 KiB blobs and 2.3× at 0.5–2 KiB, and let rows with no new bytes grow a segment and the pass's memory until the wall clock. A segment therefore lands near 256 MiB, can pass it only by the estimate's error, and holds at most about 175,000 rows; the first due row of a pass still travels whatever its size (so every pass moves the export forward), which the preflight's floor margin absorbs.
- ⟦D:history-recovery-replay⟧ (Tasks 3, 10): Restore and rebuild share one resumable derivation step, under the free-space floor, that replays redaction pairs first, then the journal (drain-time verdicts at their lines' positions, never a `$REG` read; unknown records skipped and counted), then the export (every segment's blobs before any rows), while drain and ingest wait; replay writes no journal records (§9.14; rev 3.1, ruled Q6). B2-defined; B4 adds the export half as the phases `export-blobs` and `export-rows`, between `apply` and `reindex`.
- ⟦D:history-b4-after-b2⟧ (Tasks 3, 10, 12): W1-B4 merges after B2, and is live before the earliest measured due date, at the latest 2026-12-19 (§9.15, §10.5; rev 3.2 review, FE15). B2-defined.
- ⟦D:history-export-unlinked-sidecar-with-blob⟧ (Tasks 5, 12): NEW departure (no spec §16 row). Schema v1 gives `sidecars` no mark column, so an unlinked sidecar row travels with its carried blob, and one whose blob nothing else carries is a candidate of its own, so its text is never left store-only; a later unlinked row naming an already exported blob is a named residual, since B4 has no migration.
- ⟦D:history-export-outside-capture-pause⟧ (Task 6): NEW departure (no spec §16 row). §9.2 pauses only ingest under a cap or db-floor pause and names no rule for the export; the pass runs outside the ingest gate, because text keeps ageing toward its source's deletion while capture is paused, and the segment has its own floor on its own filesystem. The marks are written on `db/`, which the preflight never measures: one segment's mark costs about its carried bytes (1–2×) in `db/`'s WAL, as B1's `fts_indexed` sweep does, and a mark that fails there is backed off rather than repeated hourly (⟦D:history-export-mark-failure-backs-off⟧).
- ⟦D:history-binding-facts-before-link⟧ (Task 8): Restore and rebuild write the binding, the writer token and the recovery step into the database before it becomes `history.db`; adopt commits before writing `store.id` (§6.2, §8.4; rev 3.2 review, DI3). B2-defined. B4's mark check reads that bind fact (`bound:<ms>`), by key.
- ⟦D:history-export-late-sidecar-clears-marks⟧ (Tasks 8, 10): NEW departure (no spec §16 row). §9.15 names only a late variant as clearing an exported entry's marks. Schema v1 gives `sidecars` no mark and the pass selects only unexported entries and unlinked sidecars, so a sidecar row first linked to an already exported entry (a budget-cut or floor-paused tick, a copy still behind, a tool-results file that lands late) would never be exported, while B1's census counts its blob due for good. A new linked sidecar row clears its entry's marks in B1's `ingestSidecar` transaction, and the next pass writes the entry again with every sidecar row; replay absorbs the repeat.
- ⟦D:history-recovery-chunk-failure-counted⟧ (Task 10): NEW departure (no spec §16 row), B2's, reused here. §9.14 names the stall but not its cause's counter: `recover_chunk_failed`, with one stderr line per failed chunk. B4 counts an unreadable segment's chunk the same way.
- ⟦D:history-export-dead-file-eof⟧ (Task 10): NEW departure (no spec §16 row). B2's leaf readiness reads the holding copy's `eof_ms`, and a replayed `exported:` row with none would never ripen a raw leaf after source loss, so it takes the carried `eof_ms`, or the segment's cutoff.
- ⟦D:history-export-segment-unreadable-stalls⟧ (Tasks 10, 12): NEW departure (no spec §16 row). §9.14 makes only a newer format skippable, and an unreadable segment silently skipped would drop text, so it fails its chunk (`recover_chunk_failed`, then `recovery-stalled`) and the step waits for it. Capture is held for the whole stall (no tick runs while the step is registered), so the failure line names the way out (move the segment aside under a non-segment name, its text then not replayed, or put a good copy back), and the PR body tells the operator to check a carried export directory for zero-length or partial files first.
- ⟦D:history-export-variant-first-file⟧ (Task 10): NEW departure (no spec §16 row). The spec names no replay rule for a variant's first file; a replayed variant's `first_file_id` is the dead-file row of the identity the segment names for it, the memberships' rule, else its entry's own dead-file row, because a gone file's identity is all a rebuild has and schema v1's column is NOT NULL.
- ⟦D:history-readme-export-sentence⟧ (Task 12): NEW departure (no spec §16 row). §10.5's "Edited files" (rev 3.2, FE17, IV7) assigns README edits to B1, B2, B3 and W3 and none to B4, but B2's history section calls the store the text's only copy past Claude Code's retention, which is false once the export ships; B4 reflows that one sentence in place (three lines added, no `file.ext:N` token).

21 slugs in all: 13 NEW to this plan, 1 NEW reused from B2's plan (`history-recovery-chunk-failure-counted`), and 7 spec §16 slugs (5 B2-defined, and 2 this plan defines first: `history-sole-copy-export` and `history-export-row-carries-blob`). B1's departures are cited by number in the tasks and not listed: D-4226 (`history-journal-writer-token`), D-4179 (`history-free-space-floor`), D-4210 (`history-retention-read-from-settings`), D-4172 (`history-store-fixed-root`), D-4247 (`history-test-seams-not-env`), D-4248 (`history-export-holding-files-by-transcript`, B1's NEW departure, which the coordinator's RD1 and the operator's Q15 ruling keep as the per-row set; B4 does not deliver a per-row set, see Residuals), D-4224 (`history-tick-order`), D-4207 (`history-export-due-escalates`), D-4251 (`history-doctor-state-words`) and D-4246 (`history-w1b-three-prs`). Since rev 3.4, `history-export-due-per-copy` (B2-defined) stands where B1's `history-export-row-age-early` stood: the per-copy rule replaced the row clock as the default before B4 exists.
