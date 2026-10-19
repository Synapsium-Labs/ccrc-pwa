# ccrc history wave 5h-1: B4's export hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Close the programme ledger's "Owed from B4" list in ONE PR on `main`, after B4 (#623, merged as `ad65fb394`). B4 left the sole-copy export working with eight known gaps. This plan closes them, task by task:
- **Task 1.** The check after a bind runs in bounded batches instead of one unbounded transaction. Each batch is one NORMAL transaction that clears its blobs' referrers before those blobs' marks. It pages by keyset, stays under a byte bound and the existing row cap, truncates the WAL after each batch, and stops with a word: `budget`, `off` or `wal-held`. A check may now span steps. The done stamp is written only after the last batch, and a step that owes no check deletes a stop record left standing (a rollback to B4 and a roll-forward can leave one).
- **Task 2.** When the check stops short, doctor says so: WARN `export-marks-unchecked`, which escalates to FAIL `export-marks-stalled` once an escalating word (`wal-held`, `unlistable`, `failed`) has stood past `EXPORT_MARKS_STALL_MS` (24 h). `budget` and `off` never escalate. The word comes from one new meta key, `export_marks_check`, which the check writes and its done stamp deletes.
- **Task 3.** A carried segment counts as present only when it is whole and belongs to this store. A short, long, non-SQLite, header-invalid, unreadable, foreign or misnamed file is treated as missing: its marks clear and its rows export again. It is counted `export_segment_damaged`, and doctor WARNs `export-segment-damaged`. Nothing under `export/` is renamed or removed.
- **Task 4.** A segment the last check saw that has since vanished re-arms the check, as a bind fact does. The trigger is a compact listing record over every listed name, damaged ones included, not the list of names.
- **Task 5.** Replay marks a blob or entry with the LAST segment that carries it, in (seq, writer) order. Losing a later segment then clears its marks, which closes review 621 F3.
- **Task 6.** Two read-side residuals:
  - `expand` attaches variants to every non-bytes answer, in `--json` and in the human form;
  - `ENTRY_UPSERT`'s tie: a replayed copy never wins a tie, and at ingest a live copy beats an `exported:` holder at an equal rank.
- **Task 7.** The operator's text and the wave's paperwork:
  - the store-unbound remedy and adopt's carry line gain the history-off advice;
  - B4's errata: the plan still shows the `/bin/sh` umask wrapper, and the modes case title says "inherited umask";
  - every spec sentence Tasks 1–7 depart from, amended in place, each citing its D-number;
  - the whole-PR checks and the PR body.

Sessions see no change. The rollout to each session-hosting node, and the operator's answer to R5 at plan approval, are coordinator or operator steps named in the PR body, never the worker's.

**Architecture:** Fleet-side only. There is no wire, server, PWA, hook, `ccd/ccrc`, `ccd/ccd` or deploy change. Doctor's bash (`ccd/ccrc-doctor-checks`) already relays the status envelope's health words and needs no edit. The layers are B1's to B4's, and ring membership is a property of a file's imports.

*L1 `ccd/history/lib.mjs`* (imports `node:crypto` only) makes every decision (B4's RD2):
- the bind check's bounds: `EXPORT_BIND_BYTES` (16 MiB), `EXPORT_BIND_WAL_CEILING` (64 MiB), and `EXPORT_BIND_BATCH`, moved here from `sweep.mjs`;
- whether a batch may start: `markCheckStop`;
- what one batch takes: `planMarkCheckBatch`;
- the stop record's one grammar: `MARK_CHECK_WORDS`, `formatMarkCheckState`, `parseMarkCheckState` and `nextMarkCheckState` over `HEALTH_META.exportMarksCheck`, with the escalating class `MARK_CHECK_STALL_WORDS`;
- `EXPORT_MARKS_STALL_MS` and `deriveHealth`'s two new words;
- the whole-and-own verdicts: `decideSegmentWhole` and `decideSegmentOwn`, and the damaged record's reader `readSegmentNameList`;
- the listing record: `segmentListingDigest`, `segmentListingRecord`, `addSegmentToListing` and `segmentListingVanished`, plus `decideMarkCheck`'s new `vanished` input;
- replay's mark order: `segmentOrdersAfter`, over `orderSegmentNames`' (seq, writer) order;
- the store-unbound remedy's text: `carryHoldAdvice` and `adoptCarryAdvice`.

*L3 `ccd/history/store.mjs`* stays the sole `node:sqlite` importer. It gains one raw-file measurement, `segmentFileFacts(path)`: one open `O_RDONLY | O_NONBLOCK | O_NOCTTY | O_NOFOLLOW` (a link is refused, a FIFO never waited on), an `fstat` on that descriptor, and a 100-byte header read. It opens no SQLite handle and decides nothing.

*L4 `ccd/history/sweep.mjs`* delivers without deciding:
- `checkSegmentMarks` becomes the batched loop;
- `exportStep` measures the listing, the stop inputs and the record, then calls lib and acts, and deletes a stop record no owed check stands behind;
- `exportPass` keeps the listing record in its mark transaction;
- replay's mark statements move to the last carrier;
- `ENTRY_UPSERT` gains the bound tie flag `?21` (1 at ingest, 0 at replay);
- adopt's carry line gains the history-off sentence.

*L4 `ccd/history/cli.mjs`* reads the new meta records into `HealthInputs`. A missing record reads as `null`, and a malformed one throws, so status reports `status-unreadable` naming the key. Status still never opens a segment and never reads a segment's header. *L4 `ccd/history/recall.mjs`* changes only `expandEntryText` and its three non-text human blocks.

No schema migration (the store stays v2), no new store table, column or index, and no segment format change (format 1, and segment meta keeps its six keys).

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`): `node:sqlite` `DatabaseSync` (`PRAGMA busy_timeout`, `PRAGMA wal_checkpoint(TRUNCATE)` and its busy/log/checkpointed answer, keyset `SELECT … WHERE blob_id > ? … LIMIT ?`), `node:fs` (`openSync` with `O_RDONLY | O_NONBLOCK | O_NOCTTY | O_NOFOLLOW`, `fstatSync`, `readSync` of the 100-byte SQLite header), and `node:crypto` (the listing digest);
- vitest in `server/`, in-process with fixture HOMEs, plus B4's spawned cases where a task reuses them.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6. Line numbers below were measured at `e4936efab` and are hints only; re-anchor by content.
- §9.15 "The sole-copy export" (`:2545`): its "After a bind" bullet (`:2575`) is the rule Tasks 1, 3 and 4 refine.
- §9.14 "The journal, and recovery" (`:2480`): its "Export replay" bullet (`:2539`, "marked with their segment, the first segment that carries them") is the rule Task 5 reverses, and its "entries by the newest-rank rule" is the rule Task 6 refines.
- Also touched:
  - §9.6 "Doctor `history` check" (`:2231`): new rows for `export-marks-unchecked` and `export-marks-stalled` (Task 2) and `export-segment-damaged` (Task 3);
  - §9.10's failure table (`:2400`): the same three words' rows (Tasks 2 and 3);
  - §6.1's structure tie-break, "ties broken by the larger `file_id`" (`:654`), and §9.2's RV15 statement of it (`:2088`), both Task 6;
  - §9.15's "Who reads it" (`:2578`), which names only the recovery step: under R6 the check after a bind reads a segment's header and a whole one's meta too (Task 3);
  - §8.4's "Carry before the verb" (`:1776`, R11). It says the remedy line asks for the carry before `--adopt`. Since RB11, adopt prints the carry line after its bind instead.

No task before Task 7 edits the spec. Task 7's spec step amends, in place, every sentence Tasks 1–7 depart from, and each amended sentence cites its D-number.

**Ledger:** `docs/superpowers/programs/ccrc-history.md`, "Owed from B4" (wave 5h). Every item maps to a task:

| Item | What is owed | Task |
|---|---|---|
| 1 | Bound the check after a bind | 1 |
| 2 | A doctor rule for a check that cannot finish | 2 |
| 3 | An adopt that checks each carried segment (review 623 F2) | 3 |
| 4 | `expand --json` reports `variants: []` over a pruned primary body | 6 |
| 5 | On a restore, an entry's structure moves onto its `exported:` row (review 614 F7) | 6 |
| 6 | First-wins replay marks (review 621 F3) | 5 |
| 7 | Review 624's advice: history-off during a late carry, and a move-aside after the first tick | 7 (late carry), 4 (move-aside) |
| 8 | Errata (review 625) | 7 |

The list's B2 and B3 items are wave 5h-2's (see "Not in this plan"). The ledger is the coordinator's file; no task edits it.

**Base:** `main` at `e4936efab` (B4's ledger closure, #678). B4 merged as `ad65fb394` at head `2eca753d7`. Every `file:line` in this plan was measured at `e4936efab`, and the worker re-anchors each by its quoted content on its own base. Two hints that moved since the scope was measured:
- `exportStep` is called at `sweep.mjs:3625`;
- `checkSegmentMarks` starts at `sweep.mjs:8757`.

Before editing a B1, B2 or B4 function in place, re-read the merged code at the base: a plan text is never ground truth.

**PR:** One PR, executed in task order. Wave 5h-2 (B2's and B3's owed items) is a separate PR. Both waves edit `ccd/history/lib.mjs` (`deriveHealth`'s FAIL block, `HEALTH_REMEDIES`) and `sweep.mjs`, so whichever lands second merges `main` and keeps both sides.

## Global Constraints

- **Schema v2, no migration.** No new table, column or index in `history.db`, and no `SCHEMA_ADDED` entry (`lib.mjs:2964`, v2 is B2's index-only migration). Every keyset pages by a primary key (`blob_id`, `entry_id`); `exported_seg` stays unindexed. The segment format stays 1, and segment meta keeps its six keys (`store_id`, `writer`, `seq`, `harnesses`, `cutoff_ms`, `format`). The only new persistent state is store meta:
  - `export_marks_check` (`HEALTH_META.exportMarksCheck`, Tasks 1–2);
  - `export_marks_counted`, the sweep-private once-a-check flag (Task 1);
  - the damaged-segment record (`HEALTH_META.exportSegmentDamaged`, Task 3);
  - `export_marks_checked_listing` (Task 4);
  - the counter `export_segment_damaged`.

  Each new key is spelled once, in `HEALTH_META` or a single `sweep.mjs` const. None reuses a B1, B2 or B4 meta name: `export_marks_checked_ms`, `export_marks_checked_binds`, `export_segment_missing`, `export_marks_check_failed`, `export_segment_newer`, `export_pass_ms`, `export_due_oldest_ms`, `export_paused`, `held_pass_ms` and the rest.
- **Files this PR never edits:** `ccd/session-hook.sh`, `ccd/ccd`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`, anything under `deploy/`, `shared/*.ts`, `.github/workflows/*`, `README.md` and `CLAUDE.md`. No task creates a test file, so `ci.yml`'s node-floor heredoc is unchanged; it already lists `history-export.test.ts` and `history-recall.test.ts`. A worker who finds a new file unavoidable adds it to that heredoc in the same commit and records the departure.
- **Rings by imports.**
  - `lib.mjs` is L1 and imports only `node:crypto` (`:23`). It makes every decision: the stop word, the batch cut, the record's grammar and transitions, the health words, the whole verdict, the vanished trigger and the mark order. The sweep only measures and acts (B4's RD2).
  - `store.mjs` is L3, the sole `node:sqlite` importer. It measures a segment file and decides nothing.
  - `sweep.mjs`, `cli.mjs` and `recall.mjs` are L4.
- **No overloaded null.** No adapter narrows a distinction it received:
  - `parseMarkCheckState` throws on a malformed value. A missing key is `null`, and status reports a malformed one as `status-unreadable` naming the key.
  - `decideSegmentWhole`'s six words stay distinct. They are `whole`, `short`, `long`, `not-sqlite`, `header-invalid` and `unreadable`.
  - A listing that fails with `ENOTDIR` or `EACCES` is `unlistable`, never "every segment vanished" and never "nothing is missing".
  - `markCheckStop`'s three words are three conditions with three remedies.
- **R1 (entry guards).** `sweep.mjs` (`:8807`) and `cli.mjs` (`:1668`) end in `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`. Every new block goes above that guard, and there is no top-level await. `lib.mjs` and `store.mjs` have no guard; new code is appended at their end or placed beside the function it extends, where a task's **Files** names that anchor (Tasks 3, 4 and 5 do), and a constant that an existing export reads at load time goes above its reader. Each new export is declared exactly once in `lib.d.mts` or `store.d.mts`. `skipLibCheck` hides a duplicate, so count them.
- **Single definition.** `EXPORT_BIND_BYTES`, `EXPORT_BIND_WAL_CEILING`, `EXPORT_BIND_BATCH`, `EXPORT_MARKS_STALL_MS` and `MARK_CHECK_WORDS` are declared once, in `lib.mjs` (Task 1), as is `SEGMENT_HEADER_BYTES` (Task 3); Task 2 reads them and `MARK_CHECK_STALL_WORDS` and declares none. `EXPORT_BIND_BATCH` leaves `sweep.mjs` (`:8734`) in the same commit, and `ctx.deps.exportBindBatch` stays its in-process seam. Following B3's and B4's precedent, each new constant joins `VOCABS` in place in `single-definition.test.ts`'s O14 describe ("every vocabulary is declared once, in lib.mjs", `:5228`). New health words live only in `HEALTH_WORDS`'s class lists, and `history-lib.test.ts`'s coverage case binds each word to a producer in both directions. `sweep.mjs` never spells `/history-off`: it reads history-off through `ctx.paths.off` (O13).
- **Seams.** Test seams are `ctx.deps` members (D-4247), such as `exportBindBytes`, `exportBindBatch` and a between-batches hook. Shipped code reads no new env var, flag or file to arm one, and the `process.env` allow-list stays `HOME`, `TMUX_PANE`, `CLAUDECODE` and `CCRC_SESSION_GENERATION`.
- **Readers of a segment.** The CLI never opens a segment and never reads its header; status counts names and sizes as before (`cli.mjs` `segmentCount`). Under R6, the check after a bind becomes the export's second reader, after the recovery step. It reads the raw header through `segmentFileFacts`, and for a whole file it reads meta through `openSegment` plus `segmentMeta`, read-only. It never runs `quick_check`, and never renames, removes or writes anything under `export/`.
- **FIXTURE HOMEs only.**
  - Tests use `historyHelpers.ts` (`makeHistoryBox`, `mkTmp`), with `tmux`, `claude` and `gh` poisoned and `CLAUDECODE`, `CLAUDE_CONFIG_DIR`, `TMUX`, `TMUX_PANE` and `CCRC_RECALL_*` scrubbed.
  - No step runs `ccd`, `ccrc`, the history shim, `sweep.mjs`, `cli.mjs` or any history verb against the live `$HOME`, and no step touches `~/.ccrc`, tmux, units or any account home.
  - Sweep tests skip on darwin (`skipOnDarwin()`). Lib and store tests run there, so Task 3's `segmentFileFacts` cases in `history-store.test.ts` must pass on macOS.
  - Never kill a process by pattern.
- **Running tests.** Run from `server/` as `./node_modules/.bin/vitest run test/<file>.test.ts`, in the foreground, with a timeout of at least 600000 ms, and never with bare `npx vitest`. CLAUDE.md's load flakes are re-run in isolation before a red is called a break.
- **Filters.** vitest compiles a `-t` filter with `new RegExp(pattern)` and matches it against the full name. Filters here use no metacharacter except a deliberate `|` alternation or an escaped one. Each step states what its filter selects (`vitest list … -t '<filter>'`). A run that reports only skipped tests selected nothing: the filter is wrong, and the step is not green.
- **Fixtures.** Key-shaped fixtures (anything a secret scanner or push protection would read as a credential) are assembled at runtime from parts, never written whole.
- **Red-first.** Every guard is pinned red-first: watch the test fail on the unguarded code, then measure each mutant red after the guard lands, then green again. Scratch copies go under `.superpowers/sdd/history-w5h1/scratch` (gitignored), never `git stash`.
- **Node floor.** `>=22.16.0`, identical in `server/`, `agent/` and `pwa/`'s `engines` and pinned by `node-floor.test.ts`. No task changes it; if that test reds, raise the engines, never lower them.
- **Public repo.** No hostnames, user, account, wrapper, lane or home names, pool names, session ids, IP addresses, absolute home paths, private ticket ids or docserver URLs, in plan text, fixtures, comments, commits or the PR body. Fixture paths are synthetic, in the `/home/u/tree` style.
- **D-numbers.** This plan's departures were issued by the allocator.
  - A task cites only the number(s) its own text names, and defines each in "Deviations found" in the em-dash form (``- **D-N** — `slug` (Task k): …``), in the commit that first cites it.
  - Never write a number that was not issued, and never write a range: cite each number on its own (D-5393, D-5394, …).
  - Earlier plans' numbers are cited bare (for example D-4762, D-5395 or D-5399), or as "B4's D-N" or "B2's D-N" where the owner helps the reader; the namespace is global, and they are never defined here. This plan's own numbers are D-5632, D-5633, D-5634, D-5635, D-5636, D-5637 and D-5638, and no other.
  - A departure this plan does not list takes a number only from a block the coordinator names in the brief; otherwise the worker writes `D-TBD-<slug>` and reports it.
  - Existing `D-N` refs in source comments are history: read them, never delete them. Where a task changes the behaviour a comment describes (Task 5's first-wins prose), it appends the new reading and keeps the old ref.
  - Before the PR: `git fetch origin main`, then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.
- **Peers.** Before each first edit of an existing file, the worker reads `GET /api/claims?project=ccrc-pwa`. The hot files are `ccd/history/*.mjs` and the history tests.

## Decisions

| # | Decision | Status | Task(s) |
|---|---|---|---|
| R1 | **The check after a bind runs in bounded batches.** Each batch is one NORMAL transaction that clears its blobs' referrers before those blobs' marks (never the blobs first, so D-5395 and D-5396 hold at every commit). Batches page by a `blob_id` keyset, then an `entry_id` keyset. A batch is bounded by `EXPORT_BIND_BYTES` (16 MiB) and the existing row cap. After each batch, `PRAGMA busy_timeout = 0` then `PRAGMA wal_checkpoint(TRUNCATE)`, with `BUSY_TIMEOUT_MS` restored in a `finally`. A busy answer is tolerated; once its WAL passes `EXPORT_BIND_WAL_CEILING` (64 MiB), the check stops with the word `wal-held`. No batch starts once the run budget is spent. `HEALTH_META.exportSegmentMissing` accumulates per batch. The done stamp follows the last batch. No cursor is kept across steps: each step recomputes the missing set and restarts the keyset. | ruled by the coordinator | 1 |
| R2 | **B4's D-4762 stands.** The check stays outside `db/`'s free-space floor, as the export pass does. One batch's WAL (about 42 MiB at most, truncated after each batch) sits under `journal_size_limit` (64 MiB) and below one segment mark's WAL, which D-4762 already accepts. There is no `low-disk` stop word. | ruled by the coordinator | 1 |
| R3 | **The export pass still runs while a check is unfinished,** in the same step. The cost is over-clearing only, never a loss: an entry the pass marks before a later batch clears its blob is exported once more. | ruled by the coordinator | 1 |
| R4 | **Budget starvation behind ingest is accepted and made visible.** `exportStep` stays last in the tick, with no tick-order change (B1's D-4224). A starved check shows as Task 2's WARN with the word `budget`. | ruled by the coordinator | 2 |
| R5 | **Doctor's rule** (amended by the coordinator). WARN `export-marks-unchecked` whenever the check stopped short. FAIL `export-marks-stalled`, which replaces that WARN, when an escalating word (`wal-held`, `unlistable`, `failed`) has stood longer than `EXPORT_MARKS_STALL_MS` = 24 h. A first stop recorded in the future never FAILs. A FAIL turns doctor red and makes `ccrc update` exit 3. `budget` and `off` never escalate: an ingest backlog that long already FAILs `lag-high`, and `off` holds back every other freshness FAIL (D-4314). The record's `sinceMs` restarts when the word moves between the escalating class and the other one, and is kept while it stays within one class (Task 1's `nextMarkCheckState`). | **provisional, for the operator at plan approval** | 1, 2 |
| R6 | **A carried segment counts only when it is whole and this store's.** Whole: its size equals `page_size × page_count` from its header, with valid SQLite magic. Own: `segmentMeta`'s `storeId` and its name match. Otherwise it is treated as missing: its marks clear, and it is counted `export_segment_damaged`. Doctor's `export-segment-damaged` is a WARN only, read from a meta record the check writes, never from a live header read in status. The check never renames or removes anything, and there is no `quick_check` in the tick. | ruled by the coordinator | 3 |
| R7 | **A vanished segment re-arms the check, as code.** The trigger is a compact listing record, `export_marks_checked_listing` = `'<count> <digest>'` with an order-independent digest, not the list of names. It digests every listed name, damaged ones included, so moving a damaged file out of `export/<store_id>/` re-arms the check (the coordinator's reconciliation with Task 3). | ruled by the coordinator | 4 |
| R8 | **Replay marks by the LAST carrier,** in `orderSegmentNames`' (seq, writer) order, closing review 621 F3. This reverses the coordinator's own convention from ask 58. | ruled by the coordinator | 5 |
| R9 | **`expand` attaches variants to every non-bytes answer** (pruned, too large, undecodable), in `--json` and in the human form, restoring D-4596's true `variants_total`. | ruled by the coordinator | 6 |
| R10 | **`ENTRY_UPSERT`'s tie, both arms.** A replayed copy never wins a tie: bound flag `?21`, 1 at ingest and 0 at replay. At ingest, a live copy beats an `exported:` holder at an equal rank. | ruled by the coordinator | 6 |
| R11 | **The store-unbound remedy and adopt's carry line gain the history-off advice:** set `~/.ccrc/history-off` before the adopt when a carry will follow, and remove it once both directories are complete. This reverses RB11's note that the remedy text stays unchanged. | ruled by the coordinator | 7 |
| R12 | **The operator's open restore question stays open.** No code in this plan: replay keeps a segment's bytes out over a held tombstone (`export_blob_tombstone_kept`), as now. | ruled by the coordinator (the question itself stays the operator's) | — |
| R13 | **The check charges the stored bytes it rewrites to the run's byte budget** (`ctx.budget.bytes`), as the export pass charges what it writes. The export pass still runs in the same step whenever budget remains (R3); a check that spends the budget holds the pass, which records its attempt and says so (D-5394). | ruled by the coordinator | 1 |

## Review Focus

These five inputs follow from the spec and would bite an operator, and no case the scope measured exercises them. Each names the task that adds its pin.

1. **A carry that finishes, or a segment moved aside, between two steps of one unfinished check** (stopped at `budget`). Expected: each step recomputes the missing set (R1). Marks an earlier step cleared stay cleared, so their rows export again. Marks naming the segment that has now arrived stand. A segment moved aside mid-check is cleared too. `strandedBlobs` is `[]` after every step, and the done stamp's record covers every bind fact seen, one written mid-check included. **Task 1**, through its case `a segment that arrives and one moved aside between two steps of one unfinished check`, whose guard Step 10's mutant 21 (a missing set carried across steps) measures.
2. **A stale `export_marks_check` key that no check will ever delete.** The shape: a node runs this build, stops a check, is rolled back to B4 (which finishes the check in one transaction and never deletes the key), then rolled forward. `decideMarkCheck` now answers no check, the key ages, and after 24 h on an escalating word `export-marks-stalled` FAILs, so the roll-forward's own `ccrc update` exits 3. Expected: a step on which `decideMarkCheck` answers that no check is owed deletes a standing key and the once-a-check flag, whichever stands, and doctor reads PASS; a step whose listing cannot be measured deletes neither (Task 4). **Task 1**, through its planted-key case (`standing when no check is owed`), whose status half bites once Task 2 lands, and its flag-alone case (`a once-a-check flag standing alone`); Task 4's `a listing that fails never deletes the stop record`.
3. **A listing that changes and stays changed.** For example, a damaged segment the operator moves aside for good, or a segment carried in from another box. Expected: one re-armed check, not one per step, because the done stamp records the listing it measured. A damaged name (Task 3) counts in the record like any listed name, so a damaged file left in place re-arms nothing after the check that recorded it, and moving it out re-arms one check, which empties the damaged record. A listing that fails (`ENOTDIR`, `EACCES`) re-arms nothing and deletes no stop record a check left standing; only a check that then runs records it `unlistable`. **Task 4.**
4. **Two writers' segments at the same seq** (a directory carried in after an adopt), **and a restore whose backup's mark names a segment that orders AFTER the one being replayed.** Expected: a mark only moves forward in (seq, writer) order, never back. `segmentOrdersAfter` breaks an equal seq by writer, and a restore keeps the later mark. Losing the last carrier clears the mark, so the rows export again. **Task 5** (the scope's case 3, never built).
5. **After a restore, ingest re-reads the unchanged live file from the backup's cursor** at an equal rank, with a smaller `file_id` than the replayed `exported:` row that took the structure through a strictly newer rank. Expected: the live-over-exported arm moves the structure back onto the live row with status `live`. A replay-against-replay tie keeps the first segment's structure. **Task 6**, in process: its `ingest:` case replays a segment through `recoveryStep` and then feeds the live file's re-read through ingest's own `writeChunk` at the equal rank (the scope's end-to-end case (2), a real `doctor --restore` and a scheduled tick, stays unbuilt), and its `replay against replay` case pins the first segment's structure with a `?21` = 1 mutant.

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `ccd/history/lib.mjs` | modify | **Task 1:** `EXPORT_BIND_BYTES`, `EXPORT_BIND_WAL_CEILING`, `EXPORT_BIND_BATCH` (moved from `sweep.mjs`), `EXPORT_MARKS_STALL_MS`, `MARK_CHECK_WORDS`, the module-private `MARK_CHECK_STALL_WORDS`, `markCheckStop`, `planMarkCheckBatch`, `HEALTH_META.exportMarksCheck`, `formatMarkCheckState`, `parseMarkCheckState` and `nextMarkCheckState`. **Task 2:** `export-marks-unchecked` (warn) and `export-marks-stalled` (fail) in `HEALTH_WORDS`, with `deriveHealth`'s arms, their detail and each word's remedy. **Task 3:** `SEGMENT_HEADER_BYTES`, `decideSegmentWhole`, `decideSegmentOwn`, `readSegmentNameList`, `HEALTH_META.exportSegmentDamaged`, and `export-segment-damaged` (warn) with its remedy. **Task 4:** `segmentListingDigest`, `segmentListingRecord`, `addSegmentToListing`, `segmentListingVanished`, and `decideMarkCheck`'s `vanished` input. **Task 5:** `segmentOrdersAfter`. **Task 7:** `carryHoldAdvice` and `adoptCarryAdvice`, and the store-unbound remedy's history-off sentence. | L1 | 1, 2, 3, 4, 5, 7 |
| `ccd/history/lib.d.mts` | modify | One declaration per new lib export and type: the mark-check state type, the facts and verdict types, the listing functions, `segmentOrdersAfter`, the two advice functions, and `HealthInputs`' `exportMarksCheck` and damaged-segment fields. | types | 1, 2, 3, 4, 5, 7 |
| `ccd/history/store.mjs` | modify | `segmentFileFacts(path)`: one open `O_RDONLY \| O_NONBLOCK \| O_NOCTTY \| O_NOFOLLOW` (a link refused), an fstat on the descriptor and a 100-byte header read, answering `{size, magic, pageSize, pageCount, headerValid}` or `{unreadable}`. No SQLite open; inserted directly above `listSegments`. | L3 | 3 |
| `ccd/history/store.d.mts` | modify | `segmentFileFacts` and its answer type, declared once. | types | 3 |
| `ccd/history/sweep.mjs` | modify | **Task 1:** `checkSegmentMarks` as bounded batches (keyset paging, one NORMAL transaction per batch, the short-timeout TRUNCATE checkpoint, stop words, the done stamp), with `exportStep` acting on lib's answers; `exportStep`'s catch records `unlistable` or `failed`; a step that owes no check deletes a standing stop record and the once-a-check flag. **Task 3:** present means whole and own; `export_segment_damaged` and its record. **Task 4:** the listing record over every listed name, kept by `markExported`'s mark transaction and by the done stamp, and the measured `vanished` input. **Task 5:** replay's `blobMark` and `entryMark` by the last carrier. **Task 6:** `ENTRY_UPSERT`'s `?21`, passed by ingest and by `replayEntryRow`. **Task 7:** adopt's carry line. All above the R1 guard. | L4 | 1, 3, 4, 5, 6, 7 |
| `ccd/history/cli.mjs` | modify | `readStoreExtras` reads `HEALTH_META.exportMarksCheck` (Task 2) and the damaged-segment record (Task 3): a missing record is `null`, and a malformed one is named in `unmeasured`, giving `status-unreadable`. `healthInputsOf` maps both. Status never opens or header-reads a segment. In place, above the R1 guard. | L4 | 2, 3 |
| `ccd/history/recall.mjs` | modify | `expandEntryText` reads the variant rows before `expandBlob`, and attaches their causes to every non-bytes answer. The variant tail is printed on the pruned, too-large and undecodable human blocks. | L4 | 6 |
| `server/test/history-lib.test.ts` | modify | Pure cases: the stop word, the batch cut, the record's round trip and its malformed inputs, `WORD_CASES` rows and the stall threshold, the whole verdict, the listing digest and the vanished trigger, segment order, and the store-unbound remedy. The `base()` fixture gains the new `HealthInputs` fields. | test | 1, 2, 3, 4, 5, 7 |
| `server/test/history-store.test.ts` | modify | **Task 3:** `segmentFileFacts` and the verdict over real `createSegment`/`publishSegment` segments: truncations, an appended page, all zeros, header bytes 92–95 flipped, and a symlink refused. **Task 7:** the modes case's title (`:2608`). | test | 3, 7 |
| `server/test/history-export.test.ts` | modify | **Task 1:** the batched check: multi-step, commit point, pruned referrers, keyset, the WAL bound, a busy checkpoint, history-off, a pass mid-check, a stale stop record; the paged-ids case re-titled for keyset paging. **Task 2:** status integration of the stop record. **Task 3:** damaged and foreign segments, and the damaged record in status. **Task 4:** the vanished re-arm, including B4 Task 8's flipped case (`:994-997`). **Task 5:** last-carrier end to end. **Task 6:** the D-5396 end-to-end case expects the variant in `expand`. **Task 7:** history-off holds the check during a late carry. | test | 1, 2, 3, 4, 5, 6, 7 |
| `server/test/history-recover.test.ts` | modify | Last-carrier replay, with the first-wins pins re-expected. The tie cases in the x10 block. The adopt case (`:1184-1199`) expects the history-off sentence. | test | 5, 6, 7 |
| `server/test/history-recall.test.ts` | modify | Beside H-19: variants over a pruned, a too-large and an undecodable primary, in `--json` and in the human form. | test | 6 |
| `server/test/ccrc-doctor.test.ts` | modify | `STATES` rows for `export-marks-unchecked`, `export-marks-stalled` (Task 2) and `export-segment-damaged` (Task 3); `cleanInputs` gains `exportSegmentDamaged` (Task 3). | test | 2, 3 |
| `server/test/single-definition.test.ts` | modify | In place in the O14 `VOCABS` list: Task 1's new lib constants and Task 3's `SEGMENT_HEADER_BYTES`. No import line, and no edit outside the history blocks. | test (citation corpus) | 1, 3 |
| `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` | modify | In-place sentences, all in Task 7's Step 7, each citing its D-number: §9.15 "After a bind" (Tasks 1, 2, 3, 4) and "Who reads it" (Task 3); §9.6's and §9.10's rows for the three new words (Tasks 2, 3); §9.14's "the first segment that carries them" (Task 5); §6.1's tie-break, §9.2's RV15 statement and §9.14's "entries by the newest-rank rule" (Task 6); §8.4's "Carry before the verb" (R11). | docs | 7 |
| `docs/superpowers/plans/2026-10-07-ccrc-history-w1-b4-export.md` | modify | **Task 5:** a note in "Residuals, named" that this plan closes the first-wins residual, and one appended sentence each on D-5396's and D-5399's entries (their definitions stay as history). **Task 7:** the errata, one superseded clause each: Global Constraints' `/bin/sh` sentence (`:118`) and Task 4's Step 2 line (`:2267`, its `childPublish` block); the block, its `:2468` title and its `:2601` red stay as written. | docs | 5, 7 |

## Not in this plan

- **Wave 5h-2: B2's and B3's owed items.** A separate plan and PR. It holds:
  - B2's items 1–5:
    - the value classes ending at `"`, `'`, `&`, `;` and `,`, widened with a reindex plan (D-5021's residual);
    - the operator relay's multi-line reading with a per-stream look-behind window (D-5022);
    - the op marker's process identity (D-5016's identity, D-5026's residual);
    - `lag-high`'s remedy naming a standing hold (D-5027);
    - B2's errata: `(1 << 20) - 1`, "never on timing", the stale-stamp window, and "at most 87 B" for `pass`, which is 86;
  - B3's errata: the "512-character" path bound in `single-definition.test.ts`, which is 512 bytes; and "only a FIFO (or a device node, which only root can plant) changes the verdict".

  None of these touches this plan's code paths. Both waves share `lib.mjs`'s `deriveHealth` and `HEALTH_REMEDIES`, so the second to land merges `main`.
- **B2's item 6, "later, unless a measurement asks for them sooner":** strict O(owed), an ineligible-when-written state (D-5017), and a rescan from a pinned cursor for the leaves' `todo` and fork scans (D-5024). Wave 5h measured them on 2026-10-19 and nothing asks for them. The one measurement that could, a read-only query of the leaves cursor and the waiting boundaries above it on a live store, is the operator's to run or authorise, never a worker's.
- **The operator's open restore question (R12).** The question: a restore whose backup holds a tombstone keeps that text body-less, even when ingest revived it after the backup and a later segment carries it. Should replay keep such bytes out (now, counted `export_blob_tombstone_kept`) or take them? This plan writes no code for it. Two answers were measured on a prototype:
  - **(A) Take every body over a held tombstone.** About five lines, but it also undoes a prune whose bytes an older segment holds, which reverses the operator's 2026-10-18 ruling for every restore.
  - **(B) Take a body only from a segment written after the held tombstone's `pruned_ms`.** Ready to plan if the operator rules "take". The change:
    - a new segment meta key, `written_ms`, written by `exportPass`. An older build ignores it, and the segment format stays 1.
    - replay's blob arm reads the held tombstone's `pruned_ms` in its existing probe. When `written_ms > pruned_ms`, it revives the blob, clears the held mark, marks the blob with this segment, and counts a new `export_blob_tombstone_taken`.
    - A segment written before the change, with no key, stays kept out.

    That keeps the ruling's purpose (a recovery never undoes a prune made after the bytes were exported). It needs its own D-number, re-expects O39's `segmentMeta` shape, and is size M. Clock skew across an adopt between boxes can mis-sort a near tie.

  The question and its answer stay the operator's. Until a ruling, bytes stay out over a held tombstone, as now; on "take", (B) is the plan's ready shape.
- **Out of scope for this wave:**
  - an opt-in `quick_check` of a carried directory at adopt time, or any `quick_check` in the tick (R6). A same-length in-place corruption stays uncaught until replay stalls on it (B4's D-4765).
  - the check renaming or removing a damaged segment (R6).
  - a floor probe or `low-disk` stop word for the check (R2).
  - a slice of the run budget, or an earlier tick slot, for the check (R4).
- **An unmeasured concern, named for the coordinator.** On a restore, a replayed segment can mark an entry while lacking a late variant row the backup holds, because D-5395 gates only on blob states. It holds under first-wins and last-carrier alike. No task here measures or changes it.
- **Steps that are never the worker's.** The rollout to each session-hosting node, the operator's acceptance or change of R5 at plan approval, and any real-data drill are coordinator or operator steps named in the PR body.

---

### Task 1: the check after a bind runs in bounded, resumable batches

**Files:**
- Modify: `ccd/history/lib.mjs` (by content; anchors measured at `e4936efab`):
  - in place, in `export const HEALTH_META = Object.freeze({` (`:3307-3316`), add one member (two lines of comment, one of code) directly below `  heldPassMs: 'held_pass_ms',` (`:3315`);
  - append one block at the end of the file, below `readExportDueOldest` (`:8596-8600`).
- Modify: `ccd/history/lib.d.mts`: in `export const HEALTH_META: Readonly<{` (`:449-457`) add one member directly below `  heldPassMs: 'held_pass_ms';` (`:456`); append one block at the end of the file (`:980`).
- Modify: `ccd/history/sweep.mjs` (by content; every new block goes ABOVE the entry guard at `:8807`):
  - the `from './lib.mjs'` import statement (`:43-66`) gains one line directly below `  decideMarkCheck, missingSegmentNames, deadFileSourceKey, decideSegmentReplay, orderSegmentNames, entryMayHoldMark, segmentMayMarkEntry,` (`:65`);
  - in `exportStep` (`:8669`), the catch's `      countOutside(db, 'export_marks_check_failed');` (`:8678`) is replaced, and one block goes directly above `  const nowMs = ctx.now();` (`:8681`), below the mark check's `if (markCheck.check) { … }`;
  - the docstring and declaration of `const EXPORT_BIND_BATCH = 50_000;` (`:8730-8734`) are replaced by a new block (the constant moves to lib);
  - `checkSegmentMarks`, its docstring and its body (`:8743-8805`, from `/** §9.15 "After a bind": every blob and entry mark whose segment is not in export/<store_id>/ on THIS box is cleared,` through `  return { cleared, segments };` and its closing `}`) are replaced. `bindFactKeys` (`:8736-8741`) stays as it is, between the two.
- Modify: `server/test/history-lib.test.ts`: append one import and one describe at the end of the file (`:8671`).
- Modify: `server/test/history-export.test.ts`: in place, two import lines below `import * as x9H from './historyHelpers.js';` (`:34`); the `checkSegmentMarks` member of `interface SweepExport` (`:67`); the unlistable loop (`:1036-1077`); the `(f)` loop (`:2216-2223`); the D-5395 references case (`:2424-2466`) and the paged-ids case (`:2468-2545`); append one describe at the end of the file (`:2699`).
- Modify: `server/test/single-definition.test.ts`: the history `VOCABS` list (`:5242`).
- Scratch only, never committed: `$SCRATCH/measure-bindcheck-wal.mjs` (Step 11).

**Interfaces:**
- Consumes:
  - B4 `sweep.mjs`: `exportStep(db, ctx)`; `checkSegmentMarks(db, ctx, record)` (rewritten here); `clearReferrerMarks(db, blobIds: number[]): number` and its four `REFERRER_CLEAR_SQL` statements (unchanged, D-5395 (history-export-mark-needs-its-blobs)); `bindFactKeys(db)`; `EXPORT_MARKS_CHECKED_META` (`'export_marks_checked_ms'`) and `EXPORT_MARKS_CHECKED_BINDS_META` (`'export_marks_checked_binds'`); `exportDirFor(paths, storeId)`; `budgetLeft(budget)`; `isBusy(e)`; `noteExportPassDone` (unchanged: a complete pass still resets `HEALTH_META.exportSegmentMissing` to `'0'`).
  - `store.mjs`: `listSegments(dir)` (`[]` only for ENOENT, throws otherwise), `withTx(db, 'NORMAL', fn)`, `getMeta`, `setMeta`, `bump`.
  - `lib.mjs`: `decideMarkCheck({ metaKeys, checkedRecord })`, `missingSegmentNames({ named, present })`, `HEALTH_META`, `BUSY_TIMEOUT_MS` (30000; newly imported by sweep.mjs).
  - Test side: `history-export.test.ts`'s `ingestedBox`, `exportCtx`, `onStore`, `q`, `metaOf`, `marks`, `counting`, `rid`, `row`, `runCli`, `setMeta`, `MIN`/`HOUR`/`DAY`/`TIB`, `PassResult`, `MemDb`, `MIGRATIONS`, `x9Lib`; `historyHelpers`' `plantSegment`, `strandedBlobs`, `strandedBlobsOn`, `counters`, `exportDirOf`.
- Produces (`lib.mjs`, each export declared once in `lib.d.mts`):
  - `EXPORT_BIND_BYTES = 16 * 1024 * 1024`; `EXPORT_BIND_WAL_CEILING = 64 * 1024 * 1024`; `EXPORT_BIND_BATCH = 50_000` (moved from sweep.mjs); `EXPORT_MARKS_STALL_MS = 24 * 60 * 60 * 1000` (declared and pinned here; Task 2's `deriveHealth` is its only reader).
  - `MARK_CHECK_WORDS = Object.freeze(['budget', 'off', 'wal-held', 'unlistable', 'failed'])`, the shared name Task 2 imports; types `MarkCheckWord`, `MarkCheckState { word; sinceMs; cleared }`.
  - Module-private `MARK_CHECK_STALL_WORDS = Object.freeze(['wal-held', 'unlistable', 'failed'])`: the escalating class (R5 as amended). `nextMarkCheckState` reads it here, and Task 2's `deriveHealth` arm reads it in the same module; neither task declares a second copy.
  - `markCheckStop({ budgetLeft: boolean, off: boolean, walBytes: number, walCeiling: number }): null | 'budget' | 'off' | 'wal-held'` (precedence `off`, then `wal-held` when `walBytes > walCeiling`, then `budget`).
  - `planMarkCheckBatch({ rows: { id, bytes }[], maxBytes, maxRows }): { ids: number[]; bytes: number; after: number | null }` (at least one row; `after` is the last TAKEN id; throws TypeError on a row that is not two non-negative safe integers).
  - `HEALTH_META.exportMarksCheck = 'export_marks_check'`, value grammar `'<word> <sinceMs> <cleared>'`.
  - `formatMarkCheckState(s: MarkCheckState): string` (throws on anything else); `parseMarkCheckState(v: string | null): MarkCheckState | null` (null only for null; throws TypeError on malformed, never folds it to absent); `nextMarkCheckState({ recorded: string | null, word, nowMs, cleared }): MarkCheckState` (cleared added; `sinceMs` kept while the word stays within one class, the escalating `MARK_CHECK_STALL_WORDS` or the other two, and restarted at `nowMs` when it moves between them; a recorded text off the grammar restarts the record).
- Produces (`sweep.mjs`):
  - `checkSegmentMarks(db, ctx, record): { cleared: number; segments: string[]; stopped: null | 'budget' | 'off' | 'wal-held' }`. It now reads `ctx.budget` (and charges the stored bytes it rewrites to `ctx.budget.bytes`) and `ctx.paths.off`; a listing failure throws the module-private `SegmentsUnlistable` (message = the listing's own). A stop writes `HEALTH_META.exportMarksCheck` and no done stamp; the done stamp (`export_marks_checked_ms`, `export_marks_checked_binds`) comes after the last batch and deletes `HEALTH_META.exportMarksCheck` and the private flag in the same transaction.
  - `exportStep`'s catch: a non-busy error is counted `export_marks_check_failed` and records `unlistable` (a `SegmentsUnlistable`) or `failed` (anything else) with `cleared` 0, in one transaction, best effort; a busy is rethrown as before.
  - `exportStep`'s stale-record delete: when `decideMarkCheck` answers that no check is owed and `HEALTH_META.exportMarksCheck` stands, one NORMAL transaction deletes it and the once-a-check flag. A build that finished a check without deleting the key (B4, after a rollback and a roll-forward) would otherwise leave a record that ages into Task 2's FAIL.
  - Module-private: `EXPORT_MARKS_COUNTED_META = 'export_marks_counted'` (the once-a-check flag), `MARK_CHECK_BLOB_PAGE_SQL`, `MARK_CHECK_ENTRY_PAGE_SQL`, `SegmentsUnlistable`, `truncateWalAfterBatch(db, pageSize): number`, `noteMarksCleared(db, n)`, `noteMarkCheckStop(db, ctx, word, cleared)`.
  - In-process test seams (D-4247; shipped code reads lib's values): `ctx.deps.exportBindBatch`, `ctx.deps.exportBindBytes`, `ctx.deps.exportBindWalCeiling`, and the hook `ctx.deps.afterMarkBatch({ ids, bytes, walBytes })`, called after each batch's commit and checkpoint.
  - For Task 2: the key `export_marks_check` stands from a check's first stop until its done stamp, or until a step that owes no check deletes it; its `sinceMs` is when the current class of word first stood (restarted when the word crosses between `MARK_CHECK_STALL_WORDS` and `budget`/`off`, kept within a class); it is never written for a check that is running or was killed mid-batch.
  - For Task 4: `checkSegmentMarks(db, ctx, record)`'s done stamp, the one transaction after the last batch that runs `setMeta(db, EXPORT_MARKS_CHECKED_BINDS_META, record);`, is where Task 4 adds its listing line; the listing statement is `try { present = listSegments(dir)… }`, which Task 3 re-points.

**Spec and rulings:**
- §9.15 "After a bind" ("the first tick checks that every segment a mark names is on this box"); §9.10 "Export marks after a bind"; O39's adopt case (`export_segment_missing` +1 once per check).
- Coordinator rulings: R1 (the batch design, its constants, the busy-tolerant checkpoint with the `wal-held` stop, the budget stop, the per-batch accumulate, the done stamp after the last batch, no cursor); R2 (D-4762 (history-export-outside-capture-pause) stands: the check stays outside db/'s free-space floor, as the pass does; no floor probe and no `low-disk` word); R3 (the export pass still runs while a check is unfinished: over-clearing only); R4 (budget starvation behind ingest is accepted; the tick order is unchanged, Task 2 makes it visible); R5 as amended (the escalating class, and `sinceMs` restarted when the word crosses classes).
- Departure: NEW **D-5632** (`history-export-bind-check-batched`), defined in this plan's "Deviations found". It refines D-5395 (`history-export-mark-needs-its-blobs`) and D-5396 (`history-export-bind-clears-pruned-referrers`) without changing their rule: both hold at every batch commit, which Steps 6 to 10 pin. The spec text is Task 7's (Step 7).
- Plan choices (no departure): `export_segment_missing` is bumped by the FIRST batch that clears, behind the sweep-private flag `export_marks_counted` the done stamp deletes (accepted by the coordinator), not at the done stamp from a running total: a kill between two committed batches loses the in-memory total, so a done-stamp bump would under-count a check killed after its last batch (Step 10's mutant 7 measures it: the counter reads undefined instead of 1); the stop record's `cleared` is display only and may miss a killed step's batches. The page read is inside its batch's transaction. `off` and `wal-held` win over `budget`, so a starved check that is also blocked says what blocks it. Task 2 escalates only `wal-held`, `unlistable` and `failed`. A step that owes no check deletes a standing stop record and the flag, whichever of the two stands (Review Focus 2), so the next check counts once even when a check killed between two batches left the flag alone and a build that never deletes it (B4, after a rollback) finished that check; pinned by `standing when no check is owed` and `a once-a-check flag standing alone`. Since Task 4 the delete runs only on a measured listing.

- [ ] **Step 1: Write the failing lib tests.** Append to the end of `server/test/history-lib.test.ts`:

```ts
// ===========================================================================
// W5h-1 Task 1: the check after a bind in bounded, resumable batches, decided
// in lib (D-5632 (history-export-bind-check-batched); RD2). Pure, on lib.mjs alone.
// ===========================================================================
import * as libBind from '../../ccd/history/lib.mjs';

describe('W5h-1: the check after a bind in bounded batches, decided in lib (D-5632)', () => {
  const MIB = 1024 * 1024;
  it('the bounds are lib constants: 16 MiB of stored z a batch, a 64 MiB WAL ceiling, 50,000 rows a page, a 24 h stall; the stop words and the meta key are spelled once', () => {
    expect(libBind.EXPORT_BIND_BYTES).toBe(16 * MIB);
    expect(libBind.EXPORT_BIND_WAL_CEILING).toBe(64 * MIB);
    expect(libBind.EXPORT_BIND_BATCH).toBe(50_000);
    expect(libBind.EXPORT_MARKS_STALL_MS).toBe(24 * 3_600_000);
    expect(libBind.MARK_CHECK_WORDS).toEqual(['budget', 'off', 'wal-held', 'unlistable', 'failed']);
    expect(Object.isFrozen(libBind.MARK_CHECK_WORDS)).toBe(true);
    expect(libBind.HEALTH_META.exportMarksCheck).toBe('export_marks_check');
  });
  it('markCheckStop: null while every gate is open; off, then wal-held past the ceiling (not at it), then budget', () => {
    const open = { budgetLeft: true, off: false, walBytes: 0, walCeiling: 64 };
    expect(libBind.markCheckStop(open)).toBeNull();
    expect(libBind.markCheckStop({ ...open, walBytes: 64 }), 'at the ceiling is not past it').toBeNull();
    expect(libBind.markCheckStop({ ...open, budgetLeft: false })).toBe('budget');
    expect(libBind.markCheckStop({ ...open, off: true })).toBe('off');
    expect(libBind.markCheckStop({ ...open, walBytes: 65 })).toBe('wal-held');
    expect(libBind.markCheckStop({ budgetLeft: false, off: true, walBytes: 65, walCeiling: 64 }), 'a non-progress word wins').toBe('off');
    expect(libBind.markCheckStop({ budgetLeft: false, off: false, walBytes: 65, walCeiling: 64 })).toBe('wal-held');
  });
  it('planMarkCheckBatch: rows in order until the stored bytes would pass the bound or the rows reach the cap; an exact fit is taken; the first row whatever its size; `after` is the last row TAKEN', () => {
    const rows = [{ id: 3, bytes: 400 }, { id: 5, bytes: 400 }, { id: 9, bytes: 400 }, { id: 12, bytes: 1 }];
    expect(libBind.planMarkCheckBatch({ rows, maxBytes: 1000, maxRows: 10 }), 'the byte cut').toEqual({ ids: [3, 5], bytes: 800, after: 5 });
    expect(libBind.planMarkCheckBatch({ rows, maxBytes: 1200, maxRows: 10 }), 'an exact fit is taken').toEqual({ ids: [3, 5, 9], bytes: 1200, after: 9 });
    expect(libBind.planMarkCheckBatch({ rows, maxBytes: 10_000, maxRows: 2 }), 'the row cap').toEqual({ ids: [3, 5], bytes: 800, after: 5 });
    expect(libBind.planMarkCheckBatch({ rows: [{ id: 7, bytes: 5000 }, { id: 8, bytes: 1 }], maxBytes: 1000, maxRows: 10 }), 'one row over the bound is still taken, alone')
      .toEqual({ ids: [7], bytes: 5000, after: 7 });
    expect(libBind.planMarkCheckBatch({ rows: [{ id: 4, bytes: 0 }, { id: 6, bytes: 0 }], maxBytes: 1, maxRows: 10 }), 'pruned blobs and entries weigh nothing')
      .toEqual({ ids: [4, 6], bytes: 0, after: 6 });
    expect(libBind.planMarkCheckBatch({ rows: [], maxBytes: 1000, maxRows: 10 }), 'an empty page ends the phase').toEqual({ ids: [], bytes: 0, after: null });
  });
  it('planMarkCheckBatch: a row that is not two non-negative safe integers, or a bound that is not positive, throws (a NULL length never reads as 0)', () => {
    expect(typeof libBind.planMarkCheckBatch, 'CONTROL: the function exists, so a throw below is its own').toBe('function');
    for (const bad of [{ id: 1, bytes: null }, { id: 1, bytes: -1 }, { id: 0, bytes: 1 }, { id: 1.5, bytes: 1 }, { id: 2, bytes: '3' }]) {
      expect(() => libBind.planMarkCheckBatch({ rows: [{ id: 1, bytes: 1 }, bad as unknown as { id: number; bytes: number }], maxBytes: 10, maxRows: 10 }), JSON.stringify(bad)).toThrow(TypeError);
    }
    expect(() => libBind.planMarkCheckBatch({ rows: [], maxBytes: 0, maxRows: 10 })).toThrow(TypeError);
    expect(() => libBind.planMarkCheckBatch({ rows: [], maxBytes: 10, maxRows: 0 })).toThrow(TypeError);
  });
  it('the stop record: format and parse round-trip; absent is null; a value off the grammar throws, never null', () => {
    const s = { word: 'wal-held' as const, sinceMs: 1_700_000_000_000, cleared: 42 };
    expect(libBind.formatMarkCheckState(s)).toBe('wal-held 1700000000000 42');
    expect(libBind.parseMarkCheckState(libBind.formatMarkCheckState(s))).toEqual(s);
    for (const w of libBind.MARK_CHECK_WORDS) expect(libBind.parseMarkCheckState(`${w} 1 0`)!.word).toBe(w);
    expect(libBind.parseMarkCheckState(null)).toBeNull();
    for (const bad of ['', 'budget', 'budget x 1', 'nope 1 1', 'budget -1 0', 'budget 1 -1', 'budget 12345678901234567 0', 'budget 1 0 ', ' budget 1 0', 'budget 99999999999999999 1', 'budget 9007199254740993 0']) {
      expect(() => libBind.parseMarkCheckState(bad), JSON.stringify(bad)).toThrow(TypeError);
    }
    expect(() => libBind.formatMarkCheckState({ word: 'started' as unknown as 'budget', sinceMs: 1, cleared: 0 })).toThrow(TypeError);
    expect(() => libBind.formatMarkCheckState({ word: 'budget', sinceMs: -1, cleared: 0 })).toThrow(TypeError);
  });
  it('nextMarkCheckState: the first stop starts the clock; a later stop in the same class keeps it, takes the new word and adds what it cleared; a stop that crosses between the escalating words (wal-held, unlistable, failed) and the others (budget, off) restarts it; a record off the grammar restarts', () => {
    expect(libBind.nextMarkCheckState({ recorded: null, word: 'budget', nowMs: 1000, cleared: 4 })).toEqual({ word: 'budget', sinceMs: 1000, cleared: 4 });
    expect(libBind.nextMarkCheckState({ recorded: 'wal-held 1000 4', word: 'failed', nowMs: 5000, cleared: 3 }), 'since kept, cleared added')
      .toEqual({ word: 'failed', sinceMs: 1000, cleared: 7 });
    expect(libBind.nextMarkCheckState({ recorded: 'budget 1000 4', word: 'off', nowMs: 5000, cleared: 0 }), 'within budget and off: since kept')
      .toEqual({ word: 'off', sinceMs: 1000, cleared: 4 });
    expect(libBind.nextMarkCheckState({ recorded: 'budget 1000 4', word: 'wal-held', nowMs: 5000, cleared: 3 }), 'into the escalating class: since restarts')
      .toEqual({ word: 'wal-held', sinceMs: 5000, cleared: 7 });
    expect(libBind.nextMarkCheckState({ recorded: 'unlistable 1000 4', word: 'off', nowMs: 5000, cleared: 0 }), 'out of the escalating class: since restarts')
      .toEqual({ word: 'off', sinceMs: 5000, cleared: 4 });
    expect(libBind.nextMarkCheckState({ recorded: 'torn', word: 'off', nowMs: 5000, cleared: 2 }), 'the writer cures a record status cannot read')
      .toEqual({ word: 'off', sinceMs: 5000, cleared: 2 });
    expect(() => libBind.nextMarkCheckState({ recorded: null, word: 'off', nowMs: -1, cleared: 0 })).toThrow(TypeError);
  });
});
```

- [ ] **Step 2: Run them and see them fail.** From inside `server/`, in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-lib.test.ts -t 'bounded batches, decided in lib'
```

Expected (measured at `e4936efab` with this step's tests applied): `6 failed`, `1083 skipped`; the constants case `expected undefined to be 16777216`; the others `TypeError: markCheckStop is not a function`, `planMarkCheckBatch is not a function` (and, in the throws case, its CONTROL line `expected 'undefined' to be 'function'`, predicted), `formatMarkCheckState is not a function`, `nextMarkCheckState is not a function`. The filter selects 6 (measured with `vitest list`).

- [ ] **Step 3: Write the lib implementation.** In `ccd/history/lib.mjs`, in `HEALTH_META`, insert directly below `  heldPassMs: 'held_pass_ms',`:

```js
  // W5h-1 Task 1 (D-5632 (history-export-bind-check-batched)): why the check after a bind stopped short, since when, and the
  // marks it has cleared so far ('<word> <sinceMs> <cleared>', lib formatMarkCheckState); deleted by its done stamp.
  exportMarksCheck: 'export_marks_check',
```

Append to the end of `ccd/history/lib.mjs`:

```js
// ── W5h-1 Task 1: the check after a bind, in bounded batches (D-5632 (history-export-bind-check-batched)) ──────────
// The check of §9.15 "After a bind" clears the marks naming a segment this box lacks a batch at a time, each batch one
// NORMAL transaction with a TRUNCATE checkpoint after it, and may span steps: a step that stops records why
// (HEALTH_META.exportMarksCheck) and the next step recomputes the missing set and starts again from the first row. lib
// decides when a batch may start, what a batch takes and what a stop records (RD2); sweep.mjs measures and acts.

/** The stored bytes (length(z)) one batch of the check clears the marks of, at most. A cleared mark rewrites its whole row
 *  and z's overflow pages, so a batch's WAL is about 2.1 times this plus about 160 B a row (measured), which keeps one
 *  batch under the writer's journal_size_limit of 64 MiB. A batch still takes its first row whatever its size. */
export const EXPORT_BIND_BYTES = 16 * 1024 * 1024;
/** The WAL left after a batch's checkpoint answered busy (bytes) past which the check stops, worded `wal-held`: a reader on
 *  an older snapshot keeps every frame, so batching alone bounds nothing while it stays (measured: the WAL grew to the
 *  unbatched size). */
export const EXPORT_BIND_WAL_CEILING = 64 * 1024 * 1024;
/** Rows one batch reads at most (a page of the keyset): the check's memory bound and its row bound. Moved here from
 *  sweep.mjs (D-5395's batch); an in-process test's ctx.deps.exportBindBatch overrides it (D-4247). */
export const EXPORT_BIND_BATCH = 50_000;
/** How long a check's escalating stop (MARK_CHECK_STALL_WORDS) may stand before doctor fails it (export-marks-stalled;
 *  read by deriveHealth). */
export const EXPORT_MARKS_STALL_MS = 24 * 60 * 60 * 1000;
/** Why a check after a bind stopped short. `budget`: the run's budget was spent before a batch (it resumes each tick);
 *  `off`: history-off was planted; `wal-held`: a checkpoint answered busy and the WAL stands past EXPORT_BIND_WAL_CEILING;
 *  `unlistable`: export/<store_id>/ could not be listed; `failed`: another caught error. */
export const MARK_CHECK_WORDS = Object.freeze(['budget', 'off', 'wal-held', 'unlistable', 'failed']);
/** The escalating stop words (coordinator ruling R5, as amended): no later tick moves the check past them by itself, so
 *  doctor FAILs one that has stood past EXPORT_MARKS_STALL_MS (Task 2's deriveHealth arm reads this list). `budget`
 *  resumes each tick, and `off` is the operator's switch, which holds back every other freshness FAIL (D-4314), so
 *  neither escalates. A stop's clock restarts when its word moves between this class and the other (nextMarkCheckState). */
const MARK_CHECK_STALL_WORDS = Object.freeze(['wal-held', 'unlistable', 'failed']);

/** Whether the check may start its next batch: null, or the word it stops with. A non-progress word wins over `budget`,
 *  so a check that is both starved and blocked says what blocks it: `off` (history-off exists), then `wal-held` (the
 *  WAL the last checkpoint could not truncate, `walBytes`, is past `walCeiling`), then `budget` (`budgetLeft` false). */
export function markCheckStop({ budgetLeft, off, walBytes, walCeiling }) {
  if (off) return 'off';
  if (walBytes > walCeiling) return 'wal-held';
  if (!budgetLeft) return 'budget';
  return null;
}

/** One batch of the check from one page of its keyset (`rows`, ascending ids, each `{ id, bytes }` with `bytes` the
 *  stored length of z, 0 for a pruned blob or an entry): rows in order while the stored bytes stay within `maxBytes` and
 *  the rows within `maxRows`, always at least the first row. `after` is the LAST TAKEN id, where the next page starts
 *  (null for an empty page: the phase is done). A row that is not two non-negative safe integers is a caller's bug and
 *  throws, so a NULL length never reads as 0. */
export function planMarkCheckBatch({ rows, maxBytes, maxRows }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new TypeError(`planMarkCheckBatch: bounds must be positive integers, not ${JSON.stringify({ maxBytes, maxRows })}`);
  }
  for (const r of rows) {
    if (!Number.isSafeInteger(r.id) || r.id < 1 || !Number.isSafeInteger(r.bytes) || r.bytes < 0) {
      throw new TypeError(`planMarkCheckBatch: not a { id, bytes } row: ${JSON.stringify(r)}`);
    }
  }
  const ids = [];
  let bytes = 0;
  for (const r of rows) {
    if (ids.length >= maxRows) break;
    if (ids.length > 0 && bytes + r.bytes > maxBytes) break;
    ids.push(r.id);
    bytes += r.bytes;
  }
  return { ids, bytes, after: ids.length === 0 ? null : ids[ids.length - 1] };
}

const MARK_CHECK_STATE_RE = new RegExp(`^(${MARK_CHECK_WORDS.join('|')}) ([0-9]{1,16}) ([0-9]{1,16})$`);
const markCheckCount = (n) => Number.isSafeInteger(n) && n >= 0;

/** HEALTH_META.exportMarksCheck's text: `<word> <sinceMs> <cleared>`. Anything else is a caller's bug and throws. */
export function formatMarkCheckState({ word, sinceMs, cleared }) {
  if (!MARK_CHECK_WORDS.includes(word) || !markCheckCount(sinceMs) || !markCheckCount(cleared)) {
    throw new TypeError(`formatMarkCheckState: not a check state: ${JSON.stringify({ word, sinceMs, cleared })}`);
  }
  return `${word} ${sinceMs} ${cleared}`;
}

/** HEALTH_META.exportMarksCheck read back: null when the key is absent (the check is not stopped short), else its word,
 *  since and cleared. A value off the grammar THROWS: it is never folded into absent, so status names it unmeasured. */
export function parseMarkCheckState(v) {
  if (v === null) return null;
  const m = typeof v === 'string' ? MARK_CHECK_STATE_RE.exec(v) : null;
  if (m === null || !markCheckCount(Number(m[2])) || !markCheckCount(Number(m[3]))) {
    throw new TypeError(`export_marks_check: not '<word> <sinceMs> <cleared>': ${JSON.stringify(v)}`);
  }
  return { word: m[1], sinceMs: Number(m[2]), cleared: Number(m[3]) };
}

/** The state a stop records, from what meta holds (`recorded`, the text as read, or null) and this step's stop: the new
 *  word; since when the check has stopped on words of this word's class (MARK_CHECK_STALL_WORDS, or `budget` and `off`):
 *  kept while the word stays within one class, `nowMs` for the first stop and for a stop whose word crosses between the
 *  classes (R5 as amended: doctor ages the escalating class alone); and the marks cleared so far (`cleared` added to the
 *  recorded count). A recorded text off the grammar is the writer's to cure: the check restarts its record from this
 *  stop rather than keep a value status cannot read. */
export function nextMarkCheckState({ recorded, word, nowMs, cleared }) {
  if (!markCheckCount(nowMs) || !markCheckCount(cleared)) {
    throw new TypeError(`nextMarkCheckState: not a clock and a count: ${JSON.stringify({ nowMs, cleared })}`);
  }
  let prev;
  try { prev = parseMarkCheckState(recorded); } catch { prev = null; }
  const sameClass = prev !== null && MARK_CHECK_STALL_WORDS.includes(prev.word) === MARK_CHECK_STALL_WORDS.includes(word);
  return { word, sinceMs: sameClass ? prev.sinceMs : nowMs, cleared: (prev === null ? 0 : prev.cleared) + cleared };
}
```

In `ccd/history/lib.d.mts`, in `HEALTH_META`'s type, insert directly below `  heldPassMs: 'held_pass_ms';`:

```ts
  exportMarksCheck: 'export_marks_check';
```

and append to the end of the file:

```ts
// --- W5h-1 Task 1: the check after a bind, in bounded batches (D-5632 (history-export-bind-check-batched))
export const EXPORT_BIND_BYTES: number;
export const EXPORT_BIND_WAL_CEILING: number;
export const EXPORT_BIND_BATCH: number;
export const EXPORT_MARKS_STALL_MS: number;
export type MarkCheckWord = 'budget' | 'off' | 'wal-held' | 'unlistable' | 'failed';
export const MARK_CHECK_WORDS: readonly MarkCheckWord[];
export interface MarkCheckState { word: MarkCheckWord; sinceMs: number; cleared: number }
export function markCheckStop(i: { budgetLeft: boolean; off: boolean; walBytes: number; walCeiling: number }): null | 'budget' | 'off' | 'wal-held';
export function planMarkCheckBatch(i: { rows: readonly { id: number; bytes: number }[]; maxBytes: number; maxRows: number }): { ids: number[]; bytes: number; after: number | null };
export function formatMarkCheckState(s: MarkCheckState): string;
export function parseMarkCheckState(v: string | null): MarkCheckState | null;
export function nextMarkCheckState(i: { recorded: string | null; word: MarkCheckWord; nowMs: number; cleared: number }): MarkCheckState;
```

Then `node --check ccd/history/lib.mjs`, and confirm lib still imports only `node:crypto`: `grep -nE "^import" ccd/history/lib.mjs` prints only the `node:crypto` line it printed before. Count the declarations (skipLibCheck hides a duplicate): `grep -cE "^export (const|function|type|interface) (EXPORT_BIND_BYTES|EXPORT_BIND_WAL_CEILING|EXPORT_BIND_BATCH|EXPORT_MARKS_STALL_MS|MARK_CHECK_WORDS|MarkCheckWord|MarkCheckState|markCheckStop|planMarkCheckBatch|formatMarkCheckState|parseMarkCheckState|nextMarkCheckState)\b" ccd/history/lib.d.mts` prints `12`.

- [ ] **Step 4: Run them and see them pass.** From inside `server/`, in the foreground:

```bash
./node_modules/.bin/vitest run test/history-lib.test.ts -t 'bounded batches, decided in lib'
./node_modules/.bin/vitest run test/history-lib.test.ts
```

Expected: `6 passed`; then the whole file green (`1089 passed`, measured on `e4936efab` plus this task).

- [ ] **Step 5: Lib mutations: each guard reds its case.** From the repository root: `SCRATCH="$PWD/.superpowers/sdd/history-w5h1/scratch"; mkdir -p "$SCRATCH"; cp ccd/history/lib.mjs "$SCRATCH/lib.mjs.t1"`. Apply each mutation by hand to `ccd/history/lib.mjs`, run from inside `server/` `./node_modules/.bin/vitest run test/history-lib.test.ts -t '<filter>'`, see it red, and restore with `cp "$SCRATCH/lib.mjs.t1" ccd/history/lib.mjs` before the next. Never `git stash`. Every red below was measured.

1. At least one row: replace `    if (ids.length > 0 && bytes + r.bytes > maxBytes) break;` with `    if (bytes + r.bytes > maxBytes) break;`. Filter `planMarkCheckBatch: rows in order`. Red: `one row over the bound is still taken, alone: expected { ids: [], bytes: +0, after: null } to deeply equal { ids: [ 7 ], bytes: 5000, after: 7 }`.
2. `after` is the last row TAKEN: replace `  return { ids, bytes, after: ids.length === 0 ? null : ids[ids.length - 1] };` with `  return { ids, bytes, after: rows.length === 0 ? null : rows[rows.length - 1].id };`. Filter `planMarkCheckBatch: rows in order`. Red: `the byte cut: expected { Object (ids, bytes, ...) } to deeply equal { ids: [ 3, 5 ], bytes: 800, after: 5 }`.
3. An exact fit is taken: replace `bytes + r.bytes > maxBytes) break;` with `bytes + r.bytes >= maxBytes) break;`. Filter `planMarkCheckBatch: rows in order`. Red: `an exact fit is taken: expected { ids: [ 3, 5 ], bytes: 800, after: 5 } to deeply equal { ids: [ 3, 5, 9 ], bytes: 1200, …(1) }`.
4. Delete the line `  if (off) return 'off';`. Filter `markCheckStop: null while`. Red: `expected null to be 'off'`.
5. Delete the line `  if (walBytes > walCeiling) return 'wal-held';`. Filter `markCheckStop: null while`. Red: `expected null to be 'wal-held'`.
6. Delete the line `  if (!budgetLeft) return 'budget';`. Filter `markCheckStop: null while`. Red: `expected null to be 'budget'`.
7. Past the ceiling, not at it: replace `  if (walBytes > walCeiling) return 'wal-held';` with `  if (walBytes >= walCeiling) return 'wal-held';`. Filter `markCheckStop: null while`. Red: `at the ceiling is not past it: expected 'wal-held' to be null`.
8. Since kept: in `nextMarkCheckState`'s return, replace `sinceMs: sameClass ? prev.sinceMs : nowMs` with `sinceMs: nowMs`. Filter `nextMarkCheckState: the first stop`. Red: `since kept, cleared added: expected { word: 'failed', …(2) } to deeply equal { word: 'failed', …(2) }` (predicted: measured on the row's earlier form, whose word was `wal-held`).
9. Cleared accumulates: in the same return, replace `cleared: (prev === null ? 0 : prev.cleared) + cleared` with `cleared`. Filter `nextMarkCheckState: the first stop`. Red: `since kept, cleared added: expected { word: 'failed', …(2) } to deeply equal { word: 'failed', …(2) }` (wording predicted, as in 8).
10. Malformed is never absent: in `parseMarkCheckState`, replace ``    throw new TypeError(`export_marks_check: not '<word> <sinceMs> <cleared>': ${JSON.stringify(v)}`);`` with `    return null;`. Filter `the stop record: format and parse`. Red: `"": expected [Function] to throw an error` (the first malformed value, `''`).
11. The clock restarts across classes (R5 as amended): in `nextMarkCheckState`, replace `  const sameClass = prev !== null && MARK_CHECK_STALL_WORDS.includes(prev.word) === MARK_CHECK_STALL_WORDS.includes(word);` with `  const sameClass = prev !== null;`. Filter `nextMarkCheckState: the first stop`. Red (predicted): `into the escalating class: since restarts: expected { word: 'wal-held', …(2) } to deeply equal { word: 'wal-held', …(2) }`.

After the last restore, `cmp "$SCRATCH/lib.mjs.t1" ccd/history/lib.mjs` prints nothing and Step 4's two runs are green again.

- [ ] **Step 6: Write the failing sweep tests.** In `server/test/history-export.test.ts`:

(a) Directly below `import * as x9H from './historyHelpers.js';`, add:

```ts
// ── W5h-1 Task 1: imports under t1 aliases ───────────────────────────────────────────────────────────────────────
import { spawnSync as t1Spawn } from 'node:child_process';
import { randomBytes as t1Random } from 'node:crypto';
```

(b) In `interface SweepExport`, replace the `checkSegmentMarks` member with:

```ts
  checkSegmentMarks(db: DatabaseSync, ctx: Record<string, unknown>, record: string): { cleared: number; segments: string[]; stopped: string | null };
```

(c) In the unlistable loop (`for (const where of ['export/<store_id>', 'export'] as const) {`), insert directly below `      expect(metaOf(box, 'export_marks_checked_binds'), 'a failed check covers no bind fact').toBeNull();`:

```ts
      expect(metaOf(box, HEALTH_META.exportMarksCheck), 'the stop is recorded unlistable, beside the count (D-5632)').toBe(`unlistable ${NOW + 2 * MIN} 0`);
```

and, at the end of the same case, directly below its last `      expect(Object.values(marks(box))).toEqual([name, name]);` (the one after `'the next step checks again'`):

```ts
      expect(metaOf(box, HEALTH_META.exportMarksCheck), 'a check that ran to its done stamp deleted the stop').toBeNull();
```

(d) In the `(f)` loop (`for (const room of ['the first row forced past a small room', 'a room the first row fills exactly'] as const) {`), replace these eight lines:

```ts
      // the segment stays on the box it came from, and a restore's bind fact makes the next step check the marks
      fs.rmSync(path.join(exportDirOf(box), name));
      const T = NOW + 2 * HOUR;
      const r = await onStore(box, (db) => {
        setMeta(db, `bound:${NOW + MIN}`, 'restore');
        return SW.exportStep(db, exportCtx(box, ids, () => T, { deps: { statfs: roomy }, limits: { maxBytes } }));
      });
      expect(counters(box)['export_segment_missing'], 'the check ran in this step and cleared the marks').toBe(1);
```

with:

```ts
      // the segment stays on the box it came from, and a restore's bind fact makes the next step check the marks. The check
      // charges the stored bytes it rewrites to the run's budget (D-5632 (history-export-bind-check-batched)), so it runs in a
      // step of its own, inside the hour after the pass at NOW, and the pass below has its small budget to itself.
      fs.rmSync(path.join(exportDirOf(box), name));
      await onStore(box, (db) => {
        setMeta(db, `bound:${NOW + MIN}`, 'restore');
        return SW.exportStep(db, exportCtx(box, ids, () => NOW + 2 * MIN));
      });
      expect(counters(box)['export_segment_missing'], 'the check ran in its own step and cleared the marks').toBe(1);
      const T = NOW + 2 * HOUR;
      const r = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T, { deps: { statfs: roomy }, limits: { maxBytes } })));
```

The rest of the case is unchanged. It passes before and after Step 8; left as it was, its first arm reds under Step 8's code (measured: `the row went into the second segment, and nothing was left behind: expected { state: 'held', segment: null, …(4) } to match object { state: 'written', …(3) }`), because a 1-byte budget spent by the check now holds the pass behind it in the same step.

(e) The D-5395 references case becomes a loop over two bounds. Replace its opening line

```ts
  it('the bind check clears the entries that reference a blob whose mark it clears, through each of the four references (its own blob, a variant, a linked sidecar, a kept blob) and whether that blob is live or pruned since (D-5396), and keeps those whose blobs it did not clear', async () => {
```

with

```ts
  // D-5632 (history-export-bind-check-batched): the same case in batches of one blob, so every batch boundary falls between
  // two of the references and the pruned blob is a batch of its own (D-5396 under the keyset).
  for (const bounds of [{ name: 'one batch', deps: {}, statements: 4 }, { name: 'one blob a batch', deps: { exportBindBytes: 1, exportBindBatch: 1 }, statements: 20 }] as const) {
  it(`the bind check clears the entries that reference a blob whose mark it clears, through each of the four references (its own blob, a variant, a linked sidecar, a kept blob) and whether that blob is live or pruned since (D-5396), and keeps those whose blobs it did not clear: ${bounds.name}`, async () => {
```

in it, replace `      const out = SW.checkSegmentMarks(watch.db, { paths: historyPaths(box.home), ids, now: () => Date.now() }, '["bound:1"]');` with

```ts
      const out = SW.checkSegmentMarks(watch.db, { paths: historyPaths(box.home), ids, now: () => Date.now(), deps: bounds.deps, budget: SW.newBudget() }, '["bound:1"]');
```

replace `however many blobs').toHaveLength(4);` with `however many blobs').toHaveLength(bounds.statements);` and, in the same message, `four statements, one for each reference` with `four statements a batch, one for each reference`; and close the loop with one line `  }` directly below the case's closing `  }, 120_000);` (the one after `    expect(r.stranded).toEqual([]);`).

(f) The paged-ids case. Replace its title line with

```ts
  it('the bind check pages its lost blob ids by a blob_id keyset, at most the row cap a page (ctx.deps.exportBindBatch overrides it), and hands each page to the referrer clears: ceil(N/cap) batches of four statements, and the same cleared count and end state as one batch', async () => {
```

replace `        const out = SW.checkSegmentMarks(watch.db, { paths: historyPaths(box.home), ids, now: () => 1, deps: batch === undefined ? {} : { exportBindBatch: batch } }, '["bound:1"]');` with

```ts
        const out = SW.checkSegmentMarks(watch.db, { paths: historyPaths(box.home), ids, now: () => 1, deps: batch === undefined ? {} : { exportBindBatch: batch }, budget: SW.newBudget() }, '["bound:1"]');
```

replace the two lines

```ts
      // how the lost-ids select ran: through iterate (never materialised), once, and never through all
      const lostSelect = r.calls.filter((c) => c.text.startsWith('SELECT blob_id FROM blobs WHERE exported_seg IN'));
```

with

```ts
      // how the lost ids were read (D-5632): a page of at most the row cap at a time, and one empty page that ends the phase
      const lostSelect = r.calls.filter((c) => c.text.startsWith('SELECT blob_id AS id, coalesce(length(z), 0) AS bytes FROM blobs'));
```

replace the two lines `    expect(one.lostSelect, 'the lost ids are read through iterate, once: a row at a time, never every lost blob materialised by all()').toEqual(['iterate']);` and `    expect(two.lostSelect, 'and the same however small the batch').toEqual(['iterate']);` with

```ts
    expect(one.lostSelect, 'six ids in one page of at most the default cap, then the empty page that ends the phase').toEqual(['all', 'all']);
    expect(two.lostSelect, 'six ids at two a page: three pages, then the empty one').toEqual(['all', 'all', 'all', 'all']);
```

and replace `    expect(four.lostSelect).toEqual(['iterate']);` with

```ts
    expect(four.lostSelect, 'five ids at two a page: two full pages, a page of one, then the empty one').toEqual(['all', 'all', 'all', 'all']);
```

Its `arms` (4, 12, 4, 12) and `cleared` (13, 11) assertions are unchanged: the same ids reach the same four statements, a batch at a time.

(g) Append to the end of the file:

```ts
// ── W5h-1 Task 1: the check after a bind in bounded, resumable batches (D-5632 (history-export-bind-check-batched)) ─────
describe('the check after a bind runs in bounded, resumable batches (W5h-1 Task 1; D-5632)', () => {
  const roomy = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB });
  /** A box whose store, besides the ingested row, holds `lost` live blobs of `zBytes` incompressible stored bytes, each marked
   *  with a segment this box lacks (S1) and referenced by its own entry marked with one it has (S2); with `kept`, as many live
   *  blobs marked S2 (each with its own S2 entry) interleaved by blob_id with the first lost ones; `stubs` pruned blobs marked
   *  S1, each referenced the same way (D-5396); and one entry marked S1 itself over a blob S2 holds. No bind fact yet, and
   *  every step here runs inside the store's first hour, so the export pass waits unless a case moves the clock past it. */
  async function lostBox(prefix: string, o: { lost: number; zBytes: number; kept?: number; stubs?: number }):
    Promise<{ box: HistoryBox; ids: { storeId: string; writer: string }; S1: string; S2: string }> {
    const { box, ids } = ingestedBox(prefix, [row(1, 'a prompt', DAY)]);
    const S1 = `1.${ids.writer}.db`;
    const S2 = path.basename(plantSegment(box, ids.storeId, { seq: 2, writer: ids.writer, blobs: [], rows: [] }));
    await onStore(box, (db) => {
      const one = (sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
      const tp = one('SELECT transcript_pk AS n FROM transcripts');
      const file = one('SELECT file_id AS n FROM ingest_files');
      const blob = (z: Buffer | null, seg: string): number => Number(db.prepare(
        'INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms, exported_ms, exported_seg) VALUES (?, ?, ?, ?, ?, 1, ?)')
        .run(t1Random(32), 'br5', z, z === null ? 4 : z.length, z === null ? 1 : null, seg).lastInsertRowid);
      const entry = (n: number, blobId: number, seg: string): void => {
        db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, exported_ms, exported_seg) VALUES (?, ?, 'user', 'x', 1, 0, ?, ?, 1, 1, ?)")
          .run(rid(n), tp, file, blobId, seg);
      };
      db.exec('BEGIN');
      let n = 100;
      const held = blob(t1Random(64), S2);
      for (let i = 0; i < o.lost; i += 1) {
        entry(n++, blob(t1Random(o.zBytes), S1), S2);                                // its own blob lost
        if (i < (o.kept ?? 0)) entry(n++, blob(t1Random(o.zBytes), S2), S2);           // a blob a present segment holds
      }
      for (let i = 0; i < (o.stubs ?? 0); i += 1) entry(n++, blob(null, S1), S2);     // pruned since S1 carried it
      entry(n++, held, S1);                                                             // marked with the missing segment itself
      db.exec('COMMIT');
    });
    expect(strandedBlobs(box), 'CONTROL: marked blobs strand nobody').toEqual([]);
    return { box, ids, S1, S2 };
  }
  const bind = (box: HistoryBox, ms: number): Promise<void> => onStore(box, (db) => { setMeta(db, `bound:${ms}`, 'restore'); });
  /** The marks, the check's meta and its counter, the box's own segment names normalised and no clock. */
  const endState = (b: { box: HistoryBox; S1: string; S2: string }): Record<string, unknown> => {
    const norm = (v: unknown): unknown => (v === b.S1 ? 'S1' : v === b.S2 ? 'S2' : v ?? null);
    return {
      blobs: q(b.box, 'SELECT exported_seg FROM blobs ORDER BY blob_id').map((r) => norm(r['exported_seg'])),
      entries: q(b.box, 'SELECT uuid, exported_seg FROM entries ORDER BY uuid').map((r) => [r['uuid'], norm(r['exported_seg'])]),
      missing: metaOf(b.box, HEALTH_META.exportSegmentMissing),
      stop: metaOf(b.box, HEALTH_META.exportMarksCheck),
      binds: metaOf(b.box, 'export_marks_checked_binds'),
      counted: metaOf(b.box, 'export_marks_counted'),
      counter: counters(b.box)['export_segment_missing'] ?? 0,
    };
  };
  /** The test's writer connection answers its `nth` BEGIN IMMEDIATE with SQLITE_BUSY, the stand-in for another connection
   *  holding the write lock (the idiom of the busy case above); shipped code reads no seam. */
  const busyAt = (db: DatabaseSync, nth: number): void => {
    let begins = 0;
    const realExec = db.exec.bind(db);
    (db as unknown as { exec: (sql: string) => void }).exec = (sql: string): void => {
      if (sql === 'BEGIN IMMEDIATE' && (begins += 1) === nth) {
        throw Object.assign(new Error(`database is locked (BEGIN ${nth})`), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });
      }
      realExec(sql);
    };
  };
  /** exportStep in a child of its own, SIGKILLed right after its `killAt`-th batch has committed and checkpointed: a kill,
   *  not a throw, so no `finally` and no stop record runs (the faults preload's idiom). */
  function killAfterBatch(box: HistoryBox, ids: { storeId: string; writer: string }, nowMs: number, bindBytes: number, killAt: number): ReturnType<typeof t1Spawn> {
    const script = path.join(box.home, 'kill-after-batch.mjs');
    fs.writeFileSync(script, [
      'const [sweepUrl, storeUrl, libUrl, home, idsJson, nowText, bytesText, killText] = process.argv.slice(2);',
      'const SW = await import(sweepUrl); const ST = await import(storeUrl); const L = await import(libUrl);',
      'const P = L.historyPaths(home); const now = () => Number(nowText); let seen = 0;',
      'const db = ST.openWriter(P.dbFile);',
      'const die = () => { process.kill(process.pid, "SIGKILL"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000); };',
      'const deps = { exportBindBytes: Number(bytesText), afterMarkBatch: () => { if ((seen += 1) === Number(killText)) die(); } };',
      'await SW.exportStep(db, { home, paths: P, ids: JSON.parse(idsJson), now, out: () => {}, deps, homes: [], rosterUnreadable: false, parsed: { secrets: [], homes: [], rosterUnreadable: false }, budget: SW.newBudget(now) });',
      'process.exit(3);',
    ].join('\n'));
    const url = (rel: string): string => new URL(rel, import.meta.url).href;
    return t1Spawn(process.execPath, ['--no-warnings', script, url('../../ccd/history/sweep.mjs'), url('../../ccd/history/store.mjs'),
      url('../../ccd/history/lib.mjs'), box.home, JSON.stringify(ids), String(nowMs), String(bindBytes), String(killAt)],
    { env: box.env, cwd: box.home, encoding: 'utf8', timeout: 60_000 });
  }

  it('a check the run budget stops resumes on the next step: no batch starts on a spent budget; the stop records its first time and the marks cleared so far; exportSegmentMissing accumulates; the done stamp comes after the last batch; the counter is bumped once; the end state is one uninterrupted check\'s', async () => {
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const step = { deps: { exportBindBytes: 2000 }, limits: { maxBytes: 2000 } };   // two 1000-byte blobs a batch, one batch a step
    const a = await lostBox('ccrc-history-export-bindstep-', { lost: 6, zBytes: 1000 });
    const b = await lostBox('ccrc-history-export-bindwhole-', { lost: 6, zBytes: 1000 });
    for (const x of [a, b]) await bind(x.box, NOW + MIN);
    await onStore(a.box, (db) => SW.exportStep(db, exportCtx(a.box, a.ids, at(2 * MIN), step)));
    expect(metaOf(a.box, HEALTH_META.exportMarksCheck), 'step 1: one batch (two blobs and their two referrers), then the budget').toBe(`budget ${NOW + 2 * MIN} 4`);
    expect(metaOf(a.box, HEALTH_META.exportSegmentMissing)).toBe('4');
    expect(metaOf(a.box, 'export_marks_checked_binds'), 'the done stamp waits for the last batch').toBeNull();
    expect(metaOf(a.box, 'export_marks_checked_ms')).toBeNull();
    expect(counters(a.box)['export_segment_missing'], 'the first batch that clears counts the check').toBe(1);
    expect(strandedBlobs(a.box), 'D-5395 at the commit').toEqual([]);
    await onStore(a.box, (db) => SW.exportStep(db, exportCtx(a.box, a.ids, at(3 * MIN), step)));
    expect(metaOf(a.box, HEALTH_META.exportMarksCheck), 'step 2 resumes: the first stop\'s time kept, the cleared marks added').toBe(`budget ${NOW + 2 * MIN} 8`);
    expect(metaOf(a.box, HEALTH_META.exportSegmentMissing), 'accumulated, never overwritten').toBe('8');
    expect(counters(a.box)['export_segment_missing'], 'once per check, however many steps').toBe(1);
    expect(strandedBlobs(a.box)).toEqual([]);
    await onStore(a.box, (db) => SW.exportStep(db, exportCtx(a.box, a.ids, at(4 * MIN), { deps: { exportBindBytes: 2000 } })));
    expect(metaOf(a.box, HEALTH_META.exportMarksCheck), 'the done stamp deletes the stop').toBeNull();
    expect(metaOf(a.box, 'export_marks_checked_ms')).toBe(String(NOW + 4 * MIN));
    expect(metaOf(a.box, HEALTH_META.exportSegmentMissing), 'six blobs, their six referrers and the entry marked S1 itself').toBe('13');
    await onStore(b.box, (db) => SW.exportStep(db, exportCtx(b.box, b.ids, at(2 * MIN), { deps: { exportBindBytes: 2000 } })));
    expect(endState(b), 'CONTROL: one uninterrupted check').toMatchObject({ missing: '13', stop: null, counted: null, counter: 1 });
    expect(endState(a), 'three steps end where one does').toEqual(endState(b));
  }, 300_000);

  it('a segment that arrives and one moved aside between two steps of one unfinished check: each step recomputes the missing set, what an earlier step cleared stays cleared, marks naming the arrived segment stand, the moved-aside segment\'s marks clear, D-5395 holds after every step, and the done stamp covers a bind fact written mid-check', async () => {
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const step = { deps: { exportBindBytes: 2000 }, limits: { maxBytes: 2000 } };   // two 1000-byte blobs a batch, one batch a step
    const x = await lostBox('ccrc-history-export-bindmove-', { lost: 6, zBytes: 1000 });
    const lost = q(x.box, 'SELECT blob_id FROM blobs WHERE exported_seg = ? ORDER BY blob_id', x.S1).map((r) => Number(r['blob_id']));
    expect(lost, 'CONTROL: six lost blobs, marked with the segment this box lacks').toHaveLength(6);
    const segOf = (id: number): unknown => q(x.box, 'SELECT exported_seg FROM blobs WHERE blob_id = ?', id)[0]!['exported_seg'] ?? null;
    await bind(x.box, NOW + MIN);
    await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, at(2 * MIN), step)));
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'step 1 stops at the budget after one batch').toBe(`budget ${NOW + 2 * MIN} 4`);
    expect(lost.slice(0, 2).map(segOf), 'step 1 cleared the first two lost blobs').toEqual([null, null]);
    expect(strandedBlobs(x.box)).toEqual([]);
    // between the two steps: the carry of S1 finishes, S2 is moved aside, and a second bind fact is written
    expect(path.basename(plantSegment(x.box, x.ids.storeId, { seq: 1, writer: x.ids.writer, blobs: [], rows: [] }))).toBe(x.S1);
    fs.renameSync(path.join(exportDirOf(x.box), x.S2), path.join(x.box.home, 'moved-aside-segment'));
    await bind(x.box, NOW + 2 * MIN + 30_000);
    for (let n = 3; n < 10 && (n === 3 || metaOf(x.box, HEALTH_META.exportMarksCheck) !== null); n += 1) {
      await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, at(n * MIN), step)));
      expect(strandedBlobs(x.box), `D-5395 after the step at minute ${n}`).toEqual([]);
    }
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'the check finished').toBeNull();
    expect(lost.slice(0, 2).map(segOf), 'an earlier step\'s clears stay cleared: the arrived segment restores no mark').toEqual([null, null]);
    expect(lost.slice(2).map(segOf), 'marks naming the segment that arrived stand').toEqual([x.S1, x.S1, x.S1, x.S1]);
    expect(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S2)[0]!['n'], 'the moved-aside segment\'s blob marks clear').toBe(0);
    expect(q(x.box, 'SELECT count(*) AS n FROM entries WHERE exported_seg = ?', x.S2)[0]!['n'], 'and its entry marks').toBe(0);
    expect(metaOf(x.box, 'export_marks_checked_binds'), 'the done stamp covers every bind fact seen, the one written mid-check too')
      .toBe(JSON.stringify([`bound:${NOW + MIN}`, `bound:${NOW + 2 * MIN + 30_000}`].sort()));
    expect(counters(x.box)['export_segment_missing'], 'one check, however many steps and however its missing set moved').toBe(1);
  }, 300_000);

  it('D-5395 at every commit: a busy at any BEGIN of the check leaves no live blob unmarked under marked entries, and the next step ends where an uninterrupted check does', async () => {
    const NOW = Date.now();
    const ctl = await lostBox('ccrc-history-export-bindtx-ctl-', { lost: 6, zBytes: 1000 });
    await bind(ctl.box, NOW + MIN);
    await onStore(ctl.box, (db) => SW.exportStep(db, exportCtx(ctl.box, ctl.ids, () => NOW + 2 * MIN, { deps: { exportBindBytes: 2000 } })));
    for (const nth of [2, 3, 4, 5]) {
      const x = await lostBox(`ccrc-history-export-bindtx${nth}-`, { lost: 6, zBytes: 1000 });
      await bind(x.box, NOW + MIN);
      const err = await onStore(x.box, (db) => {
        busyAt(db, nth);
        return SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, { deps: { exportBindBytes: 2000 } })).then(() => null, (e: unknown) => e);
      }) as { errcode?: number } | null;
      expect(err?.errcode, `busy at BEGIN ${nth} was not rethrown`).toBe(5);
      expect(strandedBlobs(x.box), `D-5395 at every commit point (busy at BEGIN ${nth})`).toEqual([]);
      expect(metaOf(x.box, 'export_marks_checked_binds'), `a check that met busy at BEGIN ${nth} is not done`).toBeNull();
      await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 3 * MIN, { deps: { exportBindBytes: 2000 } })));
      expect(endState(x), `busy at BEGIN ${nth}, then the next step`).toEqual(endState(ctl));
    }
  }, 300_000);

  for (const killAt of [1, 4] as const) {
    it(`a kill after batch ${killAt} of 4, then the next step: the same marks, meta and counter as one uninterrupted check, and D-5395 holds at the kill`, async () => {
      const NOW = Date.now();
      const a = await lostBox(`ccrc-history-export-bindkill${killAt}-`, { lost: 6, zBytes: 1000 });
      const b = await lostBox(`ccrc-history-export-bindnokill${killAt}-`, { lost: 6, zBytes: 1000 });
      for (const x of [a, b]) await bind(x.box, NOW + MIN);
      const r = killAfterBatch(a.box, a.ids, NOW + 2 * MIN, 2000, killAt);
      expect(r.signal, `${r.stdout}\n${r.stderr}`).toBe('SIGKILL');
      expect(strandedBlobs(a.box), 'D-5395 at the kill').toEqual([]);
      expect(metaOf(a.box, 'export_marks_checked_binds'), 'a killed check is not done').toBeNull();
      expect(counters(a.box)['export_segment_missing'], 'the first batch that cleared counted the check before the kill').toBe(1);
      for (const x of [a, b]) await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 3 * MIN, { deps: { exportBindBytes: 2000 } })));
      expect(endState(a), 'killed, then resumed').toEqual(endState(b));
      expect(endState(b)).toMatchObject({ missing: '13', stop: null, counted: null, counter: 1 });
    }, 300_000);
  }

  it('each batch is one page of a blob_id keyset, then of an entry_id keyset, cut at the byte bound (always one row) and the row cap; marks a present segment holds stay; each page seeks by the primary key', async () => {
    const NOW = Date.now();
    const x = await lostBox('ccrc-history-export-bindkeyset-', { lost: 5, zBytes: 1000, kept: 5, stubs: 2 });
    await bind(x.box, NOW + MIN);
    const batches: Array<{ ids: number; bytes: number }> = [];
    const plans = await onStore(x.box, async (db) => {
      const watch = counting(db);
      await SW.exportStep(watch.db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, {
        deps: { exportBindBytes: 2500, exportBindBatch: 3, afterMarkBatch: (m: { ids: number; bytes: number }) => { batches.push({ ids: m.ids, bytes: m.bytes }); } },
      }));
      return { blobs: watch.calls.find((c) => c.text.startsWith('SELECT blob_id AS id'))!.text, entries: watch.calls.find((c) => c.text.startsWith('SELECT entry_id AS id'))!.text };
    });
    // The plans on the store's schema with no statistics: this fixture's own sqlite_stat1, taken while the store held one row,
    // makes any plan a scan (measured), so the seek is read where only the SQL decides it.
    const schema = new MemDb(':memory:');
    let explained: { blobs: string; entries: string };
    try {
      for (const m of MIGRATIONS) schema.exec(m);
      const plan = (sql: string): string => (schema.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(0, '[]', 1) as Array<{ detail: string }>).map((p) => p.detail).join(' | ');
      explained = { blobs: plan(plans.blobs), entries: plan(plans.entries) };
    } finally {
      schema.close();
    }
    // lost blobs of 1000 bytes interleaved with kept ones, then two stubs: 2500 bytes take two lost blobs, twice; then the last
    // lost blob and both stubs (0 bytes) fill the cap of three; then the entry marked S1 itself
    expect(batches).toEqual([{ ids: 2, bytes: 2000 }, { ids: 2, bytes: 2000 }, { ids: 3, bytes: 1000 }, { ids: 1, bytes: 0 }]);
    expect(explained.blobs, 'the blob page seeks by blob_id').toContain('SEARCH blobs USING INTEGER PRIMARY KEY (rowid>?)');
    expect(explained.entries, 'the entry page seeks by entry_id').toContain('SEARCH entries USING INTEGER PRIMARY KEY (rowid>?)');
    expect(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S1)[0]!['n'], 'every lost blob mark is cleared').toBe(0);
    expect(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S2)[0]!['n'], 'every blob S2 holds keeps its mark').toBe(6);
    expect(q(x.box, 'SELECT count(*) AS n FROM entries WHERE exported_seg = ?', x.S2)[0]!['n'], 'the entries over kept blobs keep theirs').toBe(5);
    expect(metaOf(x.box, HEALTH_META.exportSegmentMissing), 'seven blob marks, their seven referrers and the entry marked S1').toBe('15');
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck)).toBeNull();
    expect(strandedBlobs(x.box)).toEqual([]);
  }, 120_000);

  it('one TRUNCATE checkpoint after each batch keeps the WAL to about a batch: 2,000 blobs of 8 KiB at 1 MiB a batch peak under 2 MiB at a commit, and leave 0 bytes after each checkpoint', async () => {
    const NOW = Date.now();
    const x = await lostBox('ccrc-history-export-bindwal-', { lost: 2000, zBytes: 8192 });
    await onStore(x.box, (db) => {
      setMeta(db, `bound:${NOW + MIN}`, 'restore');
      db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    });
    const wal = historyPaths(x.box.home).wal;
    const size = (): number => { try { return fs.statSync(wal).size; } catch { return 0; } };
    const atCommit: number[] = [];
    const afterBatch: number[] = [];
    const checkpoints = await onStore(x.box, async (db) => {
      const realExec = db.exec.bind(db);
      (db as unknown as { exec: (sql: string) => void }).exec = (sql: string): void => { realExec(sql); if (sql === 'COMMIT') atCommit.push(size()); };
      const watch = counting(db);
      await SW.exportStep(watch.db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, { deps: { exportBindBytes: 1024 * 1024, afterMarkBatch: () => { afterBatch.push(size()); } } }));
      return watch.ran.filter((t) => t === 'PRAGMA wal_checkpoint(TRUNCATE)').length;
    });
    expect(afterBatch, '16 batches of 128 blobs, then the entry marked S1').toHaveLength(17);
    expect(Math.max(...atCommit), `the WAL at each commit: ${atCommit.join(',')}`).toBeLessThan(2 * 1024 * 1024);
    expect(afterBatch.every((n) => n === 0), `the WAL after each checkpoint: ${afterBatch.join(',')}`).toBe(true);
    expect(checkpoints, 'one checkpoint a batch').toBe(afterBatch.length);
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck)).toBeNull();
  }, 300_000);

  it('a reader on an older snapshot: each checkpoint answers busy at once (busy_timeout 0 around it, the writer\'s restored after), the check stops wal-held once the WAL passes the ceiling, and the next step after the reader ends finishes', async () => {
    const NOW = Date.now();
    const x = await lostBox('ccrc-history-export-bindheld-', { lost: 40, zBytes: 8192 });
    await bind(x.box, NOW + MIN);
    const deps = { exportBindBytes: 16 * 1024, exportBindWalCeiling: 64 * 1024 };
    const reader = new MemDb(historyPaths(x.box.home).dbFile, { readOnly: true });
    let ms = 0;
    let timeout = 0;
    try {
      reader.exec('BEGIN');
      reader.prepare('SELECT count(*) AS n FROM blobs').get();   // holds its snapshot until it closes
      const t0 = Date.now();
      timeout = await onStore(x.box, async (db) => {
        await SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, { deps }));
        return Number((db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout);
      });
      ms = Date.now() - t0;
    } finally {
      reader.close();
    }
    expect(ms, 'a busy checkpoint waited for the reader').toBeLessThan(5000);
    expect(timeout, 'the writer\'s busy_timeout is restored').toBe(x9Lib.BUSY_TIMEOUT_MS);
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck) ?? 'no stop', 'stopped at the WAL ceiling').toMatch(new RegExp(`^wal-held ${NOW + 2 * MIN} [1-9][0-9]*$`));
    const left = Number(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S1)[0]!['n']);
    expect(left, 'some batches ran, and not all').toBeGreaterThan(0);
    expect(left).toBeLessThan(40);
    expect(metaOf(x.box, 'export_marks_checked_binds')).toBeNull();
    expect(strandedBlobs(x.box)).toEqual([]);
    await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 3 * MIN, { deps })));
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'with the reader gone the check ends').toBeNull();
    expect(q(x.box, 'SELECT count(*) AS n FROM blobs WHERE exported_seg = ?', x.S1)[0]!['n']).toBe(0);
    expect(metaOf(x.box, HEALTH_META.exportSegmentMissing), 'forty blobs, forty referrers and the entry marked S1').toBe('81');
  }, 300_000);

  it('a stop record standing when no check is owed (a B4 build finished the check without deleting it, before a roll-forward) is deleted by the next step with the once-a-check flag, and status shows neither word', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindstale-', [row(1, 'one', DAY)]);
    const NOW = Date.now();
    await onStore(box, (db) => {
      // every bind fact covered by the last check's record, so lib decideMarkCheck owes no check
      setMeta(db, `bound:${NOW - DAY}`, 'restore');
      setMeta(db, 'export_marks_checked_binds', JSON.stringify([`bound:${NOW - DAY}`]));
      setMeta(db, HEALTH_META.exportMarksCheck, `wal-held ${NOW - 2 * DAY} 5`);
      setMeta(db, 'export_marks_counted', '1');
    });
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 2 * MIN)));
    expect(metaOf(box, 'export_marks_checked_ms'), 'CONTROL: no check was owed, so none ran').toBeNull();
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'a stop record no owed check stands behind is deleted').toBeNull();
    expect(metaOf(box, 'export_marks_counted'), 'and the once-a-check flag with it').toBeNull();
    const st = runCli(box, ['status', '--json']);
    expect(st.code, `${st.stdout}\n${st.stderr}`).toBe(0);
    const health = (st.json as unknown as { health: { warn: Array<{ word: string }>; fail: Array<{ word: string }> } }).health;
    const words = [...health.warn, ...health.fail].map((i) => i.word);
    expect(words).not.toContain('export-marks-unchecked');
    expect(words).not.toContain('export-marks-stalled');
  }, 120_000);

  it('a once-a-check flag standing alone when no check is owed (a check killed after a batch, then finished by a B4 build after a rollback) is deleted by the next step, so the next check counts once', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindflag-', [row(1, 'one', DAY)]);
    const NOW = Date.now();
    const s1 = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
    expect(Object.values(marks(box))).toEqual([s1]);
    await onStore(box, (db) => {
      // every bind fact covered, no stop record, and the flag a killed check left
      setMeta(db, `bound:${NOW - DAY}`, 'restore');
      setMeta(db, 'export_marks_checked_binds', JSON.stringify([`bound:${NOW - DAY}`]));
      setMeta(db, 'export_marks_counted', '1');
    });
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 2 * MIN)));
    expect(metaOf(box, 'export_marks_checked_ms'), 'CONTROL: no check was owed, so none ran').toBeNull();
    expect(metaOf(box, 'export_marks_counted'), 'a once-a-check flag no owed check stands behind is deleted').toBeNull();
    // a later bind with the segment gone: its check clears the mark and counts itself
    fs.rmSync(path.join(exportDirOf(box), s1));
    await bind(box, NOW + 3 * MIN);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => NOW + 4 * MIN)));
    expect(Object.values(marks(box)), 'CONTROL: the later check cleared the gone segment\'s mark').toEqual([null]);
    expect(counters(box)['export_segment_missing'], 'the later check counted itself once (O39)').toBe(1);
  }, 120_000);

  it('history-off planted between two batches stops the check before the next (off), keeping what it cleared; the next step after it goes finishes', async () => {
    const NOW = Date.now();
    const x = await lostBox('ccrc-history-export-bindoff-', { lost: 6, zBytes: 1000 });
    await bind(x.box, NOW + MIN);
    const off = historyPaths(x.box.home).off;
    await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, { deps: { exportBindBytes: 2000, afterMarkBatch: () => { fs.writeFileSync(off, ''); } } })));
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'history-off stopped the check after its first batch').toBe(`off ${NOW + 2 * MIN} 4`);
    expect(metaOf(x.box, 'export_marks_checked_binds')).toBeNull();
    expect(strandedBlobs(x.box)).toEqual([]);
    fs.rmSync(off);
    await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 3 * MIN, { deps: { exportBindBytes: 2000 } })));
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck)).toBeNull();
    expect(metaOf(x.box, HEALTH_META.exportSegmentMissing)).toBe('13');
  }, 120_000);

  it('any other error between batches is counted and recorded failed with one stderr line; the batch before it stays committed, and the next step finishes', async () => {
    const NOW = Date.now();
    const x = await lostBox('ccrc-history-export-bindfail-', { lost: 6, zBytes: 1000 });
    await bind(x.box, NOW + MIN);
    let seen = 0;
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let lines: string[] = [];
    try {
      await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 2 * MIN, {
        deps: { exportBindBytes: 2000, afterMarkBatch: () => { if ((seen += 1) === 1) throw new Error('a fault between two batches'); } },
      })));
      lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep: the export marks could not be checked'));
    } finally {
      err.mockRestore();
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('a fault between two batches');
    expect(counters(x.box)['export_marks_check_failed']).toBe(1);
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck), 'the stop is recorded with the count').toBe(`failed ${NOW + 2 * MIN} 0`);
    expect(metaOf(x.box, HEALTH_META.exportSegmentMissing), 'the batch before the fault committed').toBe('4');
    expect(strandedBlobs(x.box)).toEqual([]);
    await onStore(x.box, (db) => SW.exportStep(db, exportCtx(x.box, x.ids, () => NOW + 3 * MIN, { deps: { exportBindBytes: 2000 } })));
    expect(metaOf(x.box, HEALTH_META.exportMarksCheck)).toBeNull();
    expect(metaOf(x.box, HEALTH_META.exportSegmentMissing)).toBe('13');
  }, 120_000);

  it('R3: the export pass still runs in a step whose check stopped short, and nothing is lost: the rows the check cleared go into the next segment, the rest after the check ends', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-bindpass-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    const s3 = `3.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, () => NOW)));
    expect(Object.values(marks(box))).toEqual([s1, s1]);
    fs.rmSync(path.join(exportDirOf(box), s1));
    await bind(box, NOW + MIN);
    const T = NOW + 2 * HOUR;
    const deps = { statfs: roomy, exportBindBytes: 1, exportBindWalCeiling: 1 };   // one blob a batch; any held WAL stops it
    const reader = new MemDb(historyPaths(box.home).dbFile, { readOnly: true });
    let r: PassResult | null;
    try {
      reader.exec('BEGIN');
      reader.prepare('SELECT count(*) AS n FROM blobs').get();
      r = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T, { deps })));
    } finally {
      reader.close();
    }
    expect(metaOf(box, HEALTH_META.exportMarksCheck) ?? 'no stop', 'the check stopped after one batch').toMatch(new RegExp(`^wal-held ${T} 2$`));
    expect(r, 'R3: the pass ran behind a check that stopped short').toMatchObject({ state: 'written', segment: s2, rows: 1 });
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s1 });
    expect(strandedBlobs(box)).toEqual([]);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + MIN, { deps })));
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'with the reader gone the check ends').toBeNull();
    expect(marks(box), 'only the missing segment\'s marks go; the new segment\'s stay').toEqual({ [rid(1)]: s2, [rid(2)]: null });
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, () => T + 61 * MIN, { deps })));
    expect(marks(box)).toEqual({ [rid(1)]: s2, [rid(2)]: s3 });
    expect(strandedBlobs(box)).toEqual([]);
  }, 300_000);
});
```

(h) In `server/test/single-definition.test.ts`, in the history `VOCABS` list, replace `'EXPORT_MARK_BACKOFF_MAX_MS', 'EXPORT_DUE_OLDEST_UNMEASURED'] as const;` with:

```ts
'EXPORT_MARK_BACKOFF_MAX_MS', 'EXPORT_DUE_OLDEST_UNMEASURED',
    // W5h-1 Task 1 (D-5632 (history-export-bind-check-batched)): the check after a bind's bounds and stop words; EXPORT_BIND_BATCH moved here from sweep.mjs.
    'EXPORT_BIND_BYTES', 'EXPORT_BIND_WAL_CEILING', 'EXPORT_BIND_BATCH', 'EXPORT_MARKS_STALL_MS', 'MARK_CHECK_WORDS'] as const;
```

- [ ] **Step 7: Run them and see them fail.** From inside `server/`, in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts -t 'bounded, resumable batches|cannot list export|clears the entries that reference a blob|pages its lost blob ids|the WARN a bind check set resets'
./node_modules/.bin/vitest run test/single-definition.test.ts -t 'is declared in ccd/history/lib\.mjs'
```

The first filter selects 20 cases (17 measured with `vitest list` before the stale-record, flag-alone and arrive-and-move-aside cases were added; 20 predicted) and the second 63 (measured). Expected, measured with Steps 1 to 6 applied and `sweep.mjs` as at `e4936efab`, except the stale-record line, which is predicted:
- the stale-record case: `a stop record no owed check stands behind is deleted: expected 'wal-held <NOW-2d> 5' to be null` (predicted; its status lines are green until Task 2 makes status read the record);
- the flag-alone case: `a once-a-check flag no owed check stands behind is deleted: expected '1' to be null` (predicted);
- the two unlistable cases: `the stop is recorded unlistable, beside the count (D-5632): expected null to be 'unlistable <NOW+2min> 0'`;
- the paged-ids case: `six ids in one page of at most the default cap, then the empty page that ends the phase: expected [] to deeply equal [ 'all', 'all' ]`;
- the budget case: `step 1: one batch (two blobs and their two referrers), then the budget: expected null to be 'budget <NOW+2min> 4'`;
- the arrive-and-move-aside case: `step 1 stops at the budget after one batch: expected null to be 'budget <NOW+2min> 4'` (predicted: the old check clears every lost mark in one transaction);
- the commit-point case: `busy at BEGIN 2 was not rethrown: expected undefined to be 5` (the old check is one transaction: there is no second BEGIN);
- both kill cases: `expected null to be 'SIGKILL'` (no batch hook fires, and the child reaches its `process.exit(3)`);
- the keyset case: `TypeError: Cannot read properties of undefined (reading 'text')` (no page statement ran);
- the WAL case: `16 batches of 128 blobs, then the entry marked S1: expected [] to have a length of 17 but got +0`;
- the reader case: `stopped at the WAL ceiling: expected 'no stop' to match /^wal-held <NOW+2min> [1-9][0-9]*$/`;
- the history-off case: `history-off stopped the check after its first batch: expected null to be 'off <NOW+2min> 4'`;
- the error case: `expected [] to have a length of 1 but got +0` (the hook never runs, so nothing fails);
- the R3 case: `the check stopped after one batch: expected 'no stop' to match /^wal-held <T> 2$/`;
- green already: both `(f)` arms and both references arms (the old check ignores the bounds; the one-blob arm is the pin Step 10's mutants 13 and 14 red);
- single-definition: `EXPORT_BIND_BATCH is declared in ccd/history/lib.mjs and in no other .mjs, exported, and frozen` reds with `EXPORT_BIND_BATCH: a second declaration: expected [ 'ccd/history/lib.mjs', …(1) ] to deeply equal [ 'ccd/history/lib.mjs' ]` (predicted wording; the red itself measured): sweep.mjs still declares its own.

- [ ] **Step 8: The check in bounded batches.** In `ccd/history/sweep.mjs`:

(a) In the `from './lib.mjs'` import statement, insert directly below `  decideMarkCheck, missingSegmentNames, deadFileSourceKey, decideSegmentReplay, orderSegmentNames, entryMayHoldMark, segmentMayMarkEntry,`:

```js
  BUSY_TIMEOUT_MS, EXPORT_BIND_BATCH, EXPORT_BIND_BYTES, EXPORT_BIND_WAL_CEILING, markCheckStop, planMarkCheckBatch, formatMarkCheckState, nextMarkCheckState,
```

(b) In `exportStep`'s catch, replace `      countOutside(db, 'export_marks_check_failed');` with:

```js
      // D-5632 (history-export-bind-check-batched): counted, and the check's stop recorded beside the count (HEALTH_META.exportMarksCheck),
      // `unlistable` for a listing that failed and `failed` for any other caught error; best effort, as countOutside is.
      try {
        withTx(db, 'NORMAL', () => {
          bump(db, 'export_marks_check_failed');
          noteMarkCheckStop(db, ctx, e instanceof SegmentsUnlistable ? 'unlistable' : 'failed', 0);
        });
      } catch { /* counted and recorded on the next step that meets it */ }
```

and, directly above `  const nowMs = ctx.now();` (below the mark check's `if (markCheck.check) { … }` block), insert:

```js
  // D-5632 (history-export-bind-check-batched): no check is owed, so no stop record and no once-a-check flag may stand.
  // A build that finished the check without deleting them (B4, after a rollback and a roll-forward) leaves a record that
  // would age into doctor's export-marks-stalled, or, after a check killed between two batches, the flag alone; both are
  // deleted whichever of the two stands, so the next check counts once.
  if (!markCheck.check && (getMeta(db, HEALTH_META.exportMarksCheck) !== null || getMeta(db, EXPORT_MARKS_COUNTED_META) !== null)) {
    withTx(db, 'NORMAL', () => {
      const del = db.prepare('DELETE FROM meta WHERE k = ?');
      del.run(HEALTH_META.exportMarksCheck);
      del.run(EXPORT_MARKS_COUNTED_META);
    });
  }
```

(c) Replace the five lines from `/** Lost live blob ids the bind check hands the referrer clears at a time (D-5395 (history-export-mark-needs-its-blobs)):` through `const EXPORT_BIND_BATCH = 50_000;` with:

```js
/** meta: set in the transaction of the first batch of a check after a bind that clears any mark, and deleted by the check's
 *  done stamp: export_segment_missing is bumped once per check, however many batches and steps it takes, a kill between two
 *  batches included (O39; D-5632 (history-export-bind-check-batched)). */
const EXPORT_MARKS_COUNTED_META = 'export_marks_counted';
/** One page of the check's blob keyset: the blobs whose mark names a missing segment, pruned ones too (D-5396), from
 *  blob_id `after` on, with their stored length (0 for a pruned blob, so a NULL length never reaches lib). */
const MARK_CHECK_BLOB_PAGE_SQL = 'SELECT blob_id AS id, coalesce(length(z), 0) AS bytes FROM blobs WHERE blob_id > ? AND exported_seg IN (SELECT value FROM json_each(?)) ORDER BY blob_id LIMIT ?';
/** The same over the entries marked with a missing segment themselves; an entry is bounded by rows only. */
const MARK_CHECK_ENTRY_PAGE_SQL = 'SELECT entry_id AS id, 0 AS bytes FROM entries WHERE entry_id > ? AND exported_seg IN (SELECT value FROM json_each(?)) ORDER BY entry_id LIMIT ?';

/** export/<store_id>/ could not be listed (listSegments threw: ENOTDIR, EACCES and the rest, never ENOENT). Its message is
 *  the listing's own, so the step's stderr line names the cause; exportStep records the stop as `unlistable`. */
class SegmentsUnlistable extends Error {
  constructor(cause) {
    super(cause && cause.message ? cause.message : String(cause), { cause });
    this.name = 'SegmentsUnlistable';
  }
}

/** After a batch of the check commits: a TRUNCATE checkpoint under busy_timeout 0, so a reader on an older snapshot answers
 *  busy at once instead of after BUSY_TIMEOUT_MS (measured: 30 s a batch), with the writer's timeout restored whatever
 *  happened. A busy answer is tolerated, never thrown. Answers the WAL bytes the checkpoint could not truncate: 0 when it
 *  did, the log's frames times the page size when it answered busy, which lib markCheckStop reads against the ceiling. */
function truncateWalAfterBatch(db, pageSize) {
  db.exec('PRAGMA busy_timeout = 0');
  try {
    const r = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    return Number(r.busy) === 0 ? 0 : Math.max(0, Number(r.log)) * pageSize;
  } finally {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  }
}

/** A batch's cleared marks, in the batch's transaction: HEALTH_META.exportSegmentMissing ACCUMULATES them (the marks
 *  cleared since the last complete pass, which resets it to 0), and the first batch of a check that clears any bumps
 *  export_segment_missing, once (EXPORT_MARKS_COUNTED_META). */
function noteMarksCleared(db, n) {
  if (n === 0) return;
  const prev = getMeta(db, HEALTH_META.exportSegmentMissing);
  setMeta(db, HEALTH_META.exportSegmentMissing, String((prev !== null && /^[0-9]{1,16}$/.test(prev) ? Number(prev) : 0) + n));
  if (getMeta(db, EXPORT_MARKS_COUNTED_META) === null) {
    bump(db, 'export_segment_missing');
    setMeta(db, EXPORT_MARKS_COUNTED_META, '1');
  }
}

/** A check that stopped short records why, in the caller's transaction: HEALTH_META.exportMarksCheck, lib's
 *  nextMarkCheckState over what meta holds (the word; since when its class of word first stood, kept within a class and
 *  restarted across classes; the marks cleared so far, added) in formatMarkCheckState's grammar. */
function noteMarkCheckStop(db, ctx, word, cleared) {
  const next = nextMarkCheckState({ recorded: getMeta(db, HEALTH_META.exportMarksCheck), word, nowMs: ctx.now(), cleared });
  setMeta(db, HEALTH_META.exportMarksCheck, formatMarkCheckState(next));
}
```

(d) Replace `checkSegmentMarks`, from its docstring's first line `/** §9.15 "After a bind": every blob and entry mark whose segment is not in export/<store_id>/ on THIS box is cleared,` through its closing `}` (below `  return { cleared, segments };`), with:

```js
/** §9.15 "After a bind": every blob and entry mark whose segment is not in export/<store_id>/ on THIS box is cleared, so its
 *  rows export again. A directory left on the box the store came from is the usual cause; carrying it before the verb avoids
 *  the re-export (§8.4). Which names are missing is lib missingSegmentNames' answer over the marked names (two DISTINCT
 *  scans of exported_seg, blobs then entries; no index, none added) and the listing measured here, recomputed on every step:
 *  no cursor is kept, and rows a step already cleared no longer match.
 *
 *  In bounded batches (D-5632 (history-export-bind-check-batched)), blobs first and then entries, each paged by its primary
 *  key from the first row. A blob batch is one NORMAL transaction that reads its page, takes what lib planMarkCheckBatch
 *  says (EXPORT_BIND_BYTES of stored z, at most EXPORT_BIND_BATCH rows, always one), clears the marks of every entry that
 *  references one of those blobs (the four referrer statements, D-5395 (history-export-mark-needs-its-blobs), pruned blobs
 *  included, D-5396 (history-export-bind-clears-pruned-referrers)) and THEN the blobs' own marks, so no commit leaves a live
 *  blob unmarked under marked entries. An entry batch clears the marks naming a missing segment on the entries themselves.
 *  Each batch adds its count to HEALTH_META.exportSegmentMissing and its stored bytes to the run's budget, and is followed by
 *  a TRUNCATE checkpoint that a reader may answer busy. Before each batch lib markCheckStop decides whether it may start:
 *  history-off (`off`), a WAL the last checkpoint could not truncate past EXPORT_BIND_WAL_CEILING (`wal-held`) or a spent
 *  run budget (`budget`) stops the check, recorded in HEALTH_META.exportMarksCheck, with no done stamp, so the next step
 *  checks again. After the last batch, one transaction stamps export_marks_checked_ms and `record` (the bind facts lib
 *  decideMarkCheck says this check covers) and deletes the stop record and the once-a-check flag.
 *
 *  Outside db/'s free-space floor, as the export pass is (D-4762 (history-export-outside-capture-pause)): one batch's WAL is
 *  about 42 MiB at most, under the writer's journal_size_limit. A directory that is absent (ENOENT) lists as none, so every
 *  mark naming a segment is missing; one that cannot be listed for any other reason throws SegmentsUnlistable before
 *  anything is cleared or recorded. Answers what it cleared in this step, the missing names, and the word it stopped with
 *  (null when it ran to its done stamp). */
export function checkSegmentMarks(db, ctx, record) {
  const dir = exportDirFor(ctx.paths, ctx.ids.storeId);
  let present;
  try { present = listSegments(dir).map((x) => x.name); } catch (e) { throw new SegmentsUnlistable(e); }   // [] only for ENOENT
  const named = new Set();
  for (const r of db.prepare('SELECT DISTINCT exported_seg AS seg FROM blobs WHERE exported_seg IS NOT NULL').all()) named.add(String(r.seg));
  for (const r of db.prepare('SELECT DISTINCT exported_seg AS seg FROM entries WHERE exported_seg IS NOT NULL').all()) named.add(String(r.seg));
  const segments = missingSegmentNames({ named, present });
  const names = JSON.stringify(segments);
  // ctx.deps.exportBindBatch, exportBindBytes and exportBindWalCeiling are an in-process test's bounds (D-4247); shipped code
  // reads lib's.
  const seam = (v, d) => (Number.isSafeInteger(v) && v > 0 ? v : d);
  const maxRows = seam(ctx.deps?.exportBindBatch, EXPORT_BIND_BATCH);
  const maxBytes = seam(ctx.deps?.exportBindBytes, EXPORT_BIND_BYTES);
  const walCeiling = seam(ctx.deps?.exportBindWalCeiling, EXPORT_BIND_WAL_CEILING);
  const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size);
  let cleared = 0;
  let walBytes = 0;
  /** One phase's batches until its keyset is spent (null) or a stop word. */
  const phase = (pageSql, clearBatch) => {
    const page = db.prepare(pageSql);
    let after = 0;
    for (;;) {
      const word = markCheckStop({ budgetLeft: budgetLeft(ctx.budget), off: existsSync(ctx.paths.off), walBytes, walCeiling });
      if (word !== null) return word;
      const b = withTx(db, 'NORMAL', () => {
        const plan = planMarkCheckBatch({ rows: page.all(after, names, maxRows), maxBytes, maxRows });
        if (plan.ids.length === 0) return null;
        const n = clearBatch(plan.ids);
        noteMarksCleared(db, n);
        return { ...plan, n };
      });
      if (b === null) return null;
      cleared += b.n;
      ctx.budget.bytes += b.bytes;
      after = b.after;
      walBytes = truncateWalAfterBatch(db, pageSize);
      ctx.deps?.afterMarkBatch?.({ ids: b.ids.length, bytes: b.bytes, walBytes });   // an in-process test's hook (D-4247)
    }
  };
  if (segments.length > 0) {
    const blobClear = db.prepare('UPDATE blobs SET exported_ms = NULL, exported_seg = NULL WHERE blob_id IN (SELECT value FROM json_each(?)) AND exported_seg IN (SELECT value FROM json_each(?))');
    const entryClear = db.prepare('UPDATE entries SET exported_ms = NULL, exported_seg = NULL WHERE entry_id IN (SELECT value FROM json_each(?)) AND exported_seg IN (SELECT value FROM json_each(?))');
    const stopped = phase(MARK_CHECK_BLOB_PAGE_SQL, (ids) => clearReferrerMarks(db, ids) + Number(blobClear.run(JSON.stringify(ids), names).changes))
      ?? phase(MARK_CHECK_ENTRY_PAGE_SQL, (ids) => Number(entryClear.run(JSON.stringify(ids), names).changes));
    if (stopped !== null) {
      withTx(db, 'NORMAL', () => noteMarkCheckStop(db, ctx, stopped, cleared));
      return { cleared, segments, stopped };
    }
  }
  withTx(db, 'NORMAL', () => {
    setMeta(db, EXPORT_MARKS_CHECKED_META, String(ctx.now()));
    setMeta(db, EXPORT_MARKS_CHECKED_BINDS_META, record);
    const del = db.prepare('DELETE FROM meta WHERE k = ?');
    del.run(HEALTH_META.exportMarksCheck);
    del.run(EXPORT_MARKS_COUNTED_META);
  });
  return { cleared, segments, stopped: null };
}
```

Then, from the repository root: `node --check ccd/history/sweep.mjs`; `grep -n "const EXPORT_BIND_BATCH" ccd/history/*.mjs` prints only the lib.mjs line; `grep -c "PRAGMA busy_timeout = 0" ccd/history/sweep.mjs` prints `1`; and confirm the sweep keeps no stop grammar of its own (RD2): `grep -nE "'(budget|wal-held|unlistable) " ccd/history/sweep.mjs || echo 'the stop record is formatted in lib'` prints the `echo` line. No other import is new: `existsSync`, `withTx`, `getMeta`, `setMeta`, `bump`, `listSegments`, `HEALTH_META`, `budgetLeft` and `isBusy` are already in the module.

- [ ] **Step 9: Run and see it pass, with the suites the check meets.** From inside `server/`, each in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts -t 'bounded, resumable batches|cannot list export|clears the entries that reference a blob|pages its lost blob ids|the WARN a bind check set resets'
./node_modules/.bin/vitest run test/history-export.test.ts
./node_modules/.bin/vitest run test/history-lib.test.ts
./node_modules/.bin/vitest run test/single-definition.test.ts
./node_modules/.bin/vitest run test/history-recover.test.ts
./node_modules/.bin/vitest run test/history-op.test.ts
./node_modules/.bin/vitest run test/history-cli.test.ts
node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected (measured on `e4936efab` plus this task before the stale-record, flag-alone and arrive-and-move-aside cases were added; with them, `20 passed` and history-export `98 passed`, predicted): `17 passed`; history-export `95 passed` (about 65 s); history-lib `1089 passed`; single-definition `743 passed`; history-recover `139 passed` (its adopt, restore and rebuild cases meet the check on their first tick after the bind: on a store with no export marks it finds no missing segment and writes only its done stamp, so no stop key and no flag remain); history-op `108 passed`; history-cli `72 passed | 1 skipped`; tsc silent. A red in a file CLAUDE.md lists as a load flake is re-run alone before it is called a break.

- [ ] **Step 10: Sweep mutations: each guard reds its case.** From the repository root: `SCRATCH="$PWD/.superpowers/sdd/history-w5h1/scratch"; mkdir -p "$SCRATCH"; cp ccd/history/sweep.mjs "$SCRATCH/sweep.mjs.t1"; cp ccd/history/lib.mjs "$SCRATCH/lib.mjs.t1"`. Apply each by hand; run from inside `server/` `./node_modules/.bin/vitest run test/<file>.test.ts -t '<filter>'` (the file is history-export unless named); see it red; restore with `cp` before the next. Never `git stash`. Every red below was measured.

1. The done stamp only after the last batch: insert `      setMeta(db, EXPORT_MARKS_CHECKED_BINDS_META, record);` directly below `      cleared += b.n;` in `checkSegmentMarks`. Filter `a check the run budget stops resumes`. Red: `the done stamp waits for the last batch: expected '["bound:<ms>"]' to be null`.
2. No batch on a spent budget: replace `markCheckStop({ budgetLeft: budgetLeft(ctx.budget),` with `markCheckStop({ budgetLeft: true,`. Filter `a check the run budget stops resumes`. Red: `step 1: one batch (two blobs and their two referrers), then the budget: expected null to be 'budget <ms> 4'`.
3. Once per check: delete the line `    setMeta(db, EXPORT_MARKS_COUNTED_META, '1');` in `noteMarksCleared`. Filter `a check the run budget stops resumes`. Red: `once per check, however many steps: expected 2 to be 1`.
4. exportSegmentMissing accumulates: in `noteMarksCleared`, replace `String((prev !== null && /^[0-9]{1,16}$/.test(prev) ? Number(prev) : 0) + n)` with `String(n)`. Filter `a check the run budget stops resumes`. Red: `accumulated, never overwritten: expected '4' to be '8'`.
5. Referrers before their blobs, in one transaction (blobs first, with a stop between): replace the blob phase's clear `(ids) => clearReferrerMarks(db, ids) + Number(blobClear.run(JSON.stringify(ids), names).changes))` with `(ids) => { const k = Number(blobClear.run(JSON.stringify(ids), names).changes); db.exec('COMMIT'); db.exec('BEGIN IMMEDIATE'); return k + clearReferrerMarks(db, ids); })`. Filter `D-5395 at every commit`. Red: `D-5395 at every commit point (busy at BEGIN 2): expected [ …(2) ] to deeply equal []`.
6. Keyset paging: in `MARK_CHECK_BLOB_PAGE_SQL`, replace `FROM blobs WHERE blob_id > ? AND exported_seg IN` with `FROM blobs WHERE ? >= 0 AND exported_seg IN` (same parameters; every page reads from the first row). Filter `each batch is one page of a blob_id keyset`. Red: `the blob page seeks by blob_id: expected 'SCAN blobs | LIST SUBQUERY 1 | SCAN j…' to contain 'SEARCH blobs USING INTEGER PRIMARY KE…'`.
7. The counter is bumped by the first clearing batch, not at the done stamp from a running total: in `noteMarksCleared`, delete the four lines from `  if (getMeta(db, EXPORT_MARKS_COUNTED_META) === null) {` through its closing `  }`, and insert `    if (cleared > 0) bump(db, 'export_segment_missing');` directly below `    setMeta(db, EXPORT_MARKS_CHECKED_BINDS_META, record);` in the done stamp. Filter `a kill after batch 4 of 4`. Red: `the first batch that cleared counted the check before the kill: expected undefined to be 1`.
8. One TRUNCATE checkpoint a batch: delete the line `      walBytes = truncateWalAfterBatch(db, pageSize);`. Filter `one TRUNCATE checkpoint after each batch`. Red: `the WAL at each commit: 1178352,2344312,3514392,4692712,…: expected 4754512 to be less than 2097152` (SQLite's own 1000-page autocheckpoint caps the file near 4.5 MiB, never truncating it).
9. A busy checkpoint is tolerated: in `truncateWalAfterBatch`, replace `    return Number(r.busy) === 0 ? 0 : Math.max(0, Number(r.log)) * pageSize;` with `    if (Number(r.busy) !== 0) throw Object.assign(new Error('checkpoint busy'), { errcode: 5 }); return 0;`. Filter `a reader on an older snapshot`. Red: the step rejects with `Error: checkpoint busy`.
10. busy_timeout 0 around the checkpoint: delete the line `  db.exec('PRAGMA busy_timeout = 0');`. Filter `a reader on an older snapshot` (it runs about 60 s). Red: `a busy checkpoint waited for the reader: expected 60093 to be less than 5000`.
11. The writer's timeout restored: replace the `finally`'s ``    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);`` with `    /* not restored */`. Filter `a reader on an older snapshot`. Red: `the writer's busy_timeout is restored: expected +0 to be 30000`.
12. The WAL ceiling: replace `walBytes, walCeiling });` (in `phase`'s `markCheckStop` call) with `walBytes: 0, walCeiling });`. Filter `a reader on an older snapshot`. Red: `stopped at the WAL ceiling: expected 'no stop' to match /^wal-held <ms> [1-9][0-9]*$/`.
13. Pruned blobs are in the batch (D-5396): in `MARK_CHECK_BLOB_PAGE_SQL`, replace `WHERE blob_id > ? AND exported_seg IN` with `WHERE blob_id > ? AND z IS NOT NULL AND exported_seg IN`. Filter `one blob a batch`. Red: `the referrers of the five blobs whose marks went … four statements a batch, one for each reference, however many blobs: expected [ …(16) ] to have a length of 20 but got 16`.
14. A NULL length never reaches lib: replace `coalesce(length(z), 0) AS bytes FROM blobs` with `length(z) AS bytes FROM blobs`. Filter `one blob a batch`. Red: `TypeError: planMarkCheckBatch: not a { id, bytes } row: {"id":7,"bytes":null}`.
15. history-off: replace `off: existsSync(ctx.paths.off),` with `off: false,`. Filter `history-off planted between two batches`. Red: `history-off stopped the check after its first batch: expected null to be 'off <ms> 4'`.
16. The catch records its stop: delete the line `          noteMarkCheckStop(db, ctx, e instanceof SegmentsUnlistable ? 'unlistable' : 'failed', 0);`. Filter `any other error between batches|cannot list export` (3 cases). Red, all three: `the stop is recorded unlistable, beside the count (D-5632): expected null to be 'unlistable <ms> 0'` twice and `the stop is recorded with the count: expected null to be 'failed <ms> 0'`.
17. Unlistable is not folded into failed: replace `e instanceof SegmentsUnlistable ? 'unlistable' : 'failed'` with `'failed'`. Filter `cannot list export`. Red: `expected 'failed <ms> 0' to be 'unlistable <ms> 0'`, both cases.
18. R3, the pass still runs (CONTROL: the ruled behaviour, not a guard): insert `  if (getMeta(db, HEALTH_META.exportMarksCheck) !== null) return null;` directly above `  const nowMs = ctx.now();` in `exportStep`. Filter `R3: the export pass still runs`. Red: `R3: the pass ran behind a check that stopped short: expected null to match object { state: 'written', …(2) }`.
19. The constant moved: in the `from './lib.mjs'` import, replace `  BUSY_TIMEOUT_MS, EXPORT_BIND_BATCH, EXPORT_BIND_BYTES,` with `  BUSY_TIMEOUT_MS, EXPORT_BIND_BYTES,`, and insert `const EXPORT_BIND_BATCH = 50_000;` directly below `const EXPORT_MARKS_COUNTED_META = 'export_marks_counted';`. Run `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'EXPORT_BIND_BATCH is declared'`. Red: `EXPORT_BIND_BATCH: a second declaration: expected [ 'ccd/history/lib.mjs', …(1) ] to deeply equal [ 'ccd/history/lib.mjs' ]`.
20. A stale stop record is deleted when no check is owed: in `exportStep`, replace `  if (!markCheck.check && (getMeta(db, HEALTH_META.exportMarksCheck) !== null || getMeta(db, EXPORT_MARKS_COUNTED_META) !== null)) {` with `  if (false) {`. Filter `standing when no check is owed`. Red (predicted): `a stop record no owed check stands behind is deleted: expected 'wal-held <ms> 5' to be null`.
21. The missing set is recomputed on every step, never carried over (R1's "no cursor"): directly above `export function checkSegmentMarks(db, ctx, record) {` insert `const MISSING_CACHE = new Map();`, and replace `  const segments = missingSegmentNames({ named, present });` with `  const segments = MISSING_CACHE.get(dir) ?? missingSegmentNames({ named, present }); MISSING_CACHE.set(dir, segments);`. Filter `one moved aside between two steps`. Red (predicted): `marks naming the segment that arrived stand: expected [ null, null, null, null ] to deeply equal [ '1.<writer>.db', … ]`, because the later steps keep clearing S1's marks after S1 has arrived.
22. The flag goes even when no record stands: replace `  if (!markCheck.check && (getMeta(db, HEALTH_META.exportMarksCheck) !== null || getMeta(db, EXPORT_MARKS_COUNTED_META) !== null)) {` with `  if (!markCheck.check && getMeta(db, HEALTH_META.exportMarksCheck) !== null) {`. Filter `a once-a-check flag standing alone`. Red (predicted): `a once-a-check flag no owed check stands behind is deleted: expected '1' to be null`.

After the last restore, `cmp "$SCRATCH/sweep.mjs.t1" ccd/history/sweep.mjs` and `cmp "$SCRATCH/lib.mjs.t1" ccd/history/lib.mjs` print nothing, and `./node_modules/.bin/vitest run test/history-export.test.ts` is green once more.

- [ ] **Step 11: Measure the WAL per batch on 400 MiB, against the unbatched check as the control.** Not a test and never committed. Write `$SCRATCH/measure-bindcheck-wal.mjs`:

```js
// The WAL a check after a bind leaves, per batch: at each COMMIT and right after each TRUNCATE checkpoint. Not a test and
// never committed: run it against a copy of ccd/history (argv[2] is the directory that holds ccd/). The store lives in a
// fixture HOME made under os.tmpdir() (TMPDIR) and removed at the end, whatever happened.
//   node measure-bindcheck-wal.mjs <tree> [blobs=52000] [blobBytes=8192]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const tree = path.resolve(process.argv[2] ?? '.');
const N = Number(process.argv[3] ?? 52_000);
const SIZE = Number(process.argv[4] ?? 8192);
const lib = await import(pathToFileURL(path.join(tree, 'ccd/history/lib.mjs')).href);
const store = await import(pathToFileURL(path.join(tree, 'ccd/history/store.mjs')).href);
const sweep = await import(pathToFileURL(path.join(tree, 'ccd/history/sweep.mjs')).href);

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-history-walmeasure-'));
try {
  const ids = store.createStore(home);
  const P = lib.historyPaths(home);
  const opened = sweep.openStore(home, P, 'fleet', {});
  if ('word' in opened) throw new Error(`openStore refused: ${opened.word}`);
  const db = opened.db;
  try {
    const S1 = `1.${ids.writer}.db`;   // marked on every row, and absent from export/<store_id>/: every mark is lost
    store.withTx(db, 'NORMAL', () => {
      const tp = Number(db.prepare("INSERT INTO transcripts (cc_session_uuid) VALUES ('6f1c2e3a-0b4d-4c5e-8f60-718293a4b5c6')").run().lastInsertRowid);
      const file = Number(db.prepare("INSERT INTO ingest_files (dev, ino, transcript_pk, status, parser_version) VALUES (1, 1, ?, 'live', 1)").run(tp).lastInsertRowid);
      const blob = db.prepare("INSERT INTO blobs (sha256, codec, z, raw_len, exported_ms, exported_seg) VALUES (?, 'br5', ?, ?, 1, ?)");
      const entry = db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, exported_ms, exported_seg) VALUES (?, ?, 'user', 'x', 1, 0, ?, ?, 1, 1, ?)");
      for (let i = 0; i < N; i += 1) {
        const z = randomBytes(SIZE);   // incompressible, as stored
        const id = Number(blob.run(createHash('sha256').update(z).digest(), z, SIZE, S1).lastInsertRowid);
        entry.run(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, tp, file, id, S1);   // one referrer a blob
      }
      db.prepare("INSERT INTO meta (k, v) VALUES ('bound:1', 'restore')").run();
    });
    db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    const stored = Number(db.prepare('SELECT sum(length(z)) AS n FROM blobs').get().n);
    const walOf = () => { try { return fs.statSync(P.wal).size; } catch { return 0; } };
    const seen = [];
    let on = false;
    const realExec = db.exec.bind(db);
    db.exec = (sql) => { const r = realExec(sql); if (on && sql === 'COMMIT') seen.push({ at: 'commit', bytes: walOf() }); return r; };
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const st = realPrepare(sql);
      if (!/wal_checkpoint\(TRUNCATE\)/.test(sql)) return st;
      return { get: (...a) => { const r = st.get(...a); if (on) seen.push({ at: 'truncate', bytes: walOf(), busy: Number(r.busy) }); return r; } };
    };
    const ctx = { home, paths: P, ids, now: () => Date.now(), deps: {}, out: () => {}, budget: sweep.newBudget(() => Date.now()) };
    const t0 = Date.now();
    on = true;
    const out = sweep.checkSegmentMarks(db, ctx, '["bound:1"]');
    on = false;
    const commits = seen.filter((s) => s.at === 'commit').map((s) => s.bytes);
    const truncs = seen.filter((s) => s.at === 'truncate').map((s) => s.bytes);
    const MiB = (b) => (b / 1048576).toFixed(1);
    console.log(JSON.stringify({
      tree, blobs: N, blobBytes: SIZE, storedMiB: MiB(stored), ms: Date.now() - t0, cleared: out.cleared, stopped: out.stopped ?? null,
      commits: commits.length, walPeakAtCommitMiB: MiB(Math.max(0, ...commits)), truncates: truncs.length,
      walPeakAfterTruncateMiB: MiB(Math.max(0, ...truncs)), walRatioAtCommit: (Math.max(0, ...commits) / stored).toFixed(3),
    }));
  } finally {
    store.closeWriter(db);
  }
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
```

Then, from the repository root (the control is `e4936efab`'s `ccd/history` and the `compact-card.mjs` it imports, copied out with `git archive`; nothing is checked out):

```bash
CTRL="$SCRATCH/ctrl-e4936efab"; rm -rf "$CTRL"; mkdir -p "$CTRL" "$SCRATCH/tmp" "$SCRATCH/home"
git archive e4936efab ccd/history ccd/compact-card.mjs | tar -x -C "$CTRL"
for tree in "$CTRL" "$PWD"; do
  env -u NODE_OPTIONS HOME="$SCRATCH/home" TMPDIR="$SCRATCH/tmp" timeout 900 node --no-warnings "$SCRATCH/measure-bindcheck-wal.mjs" "$tree" 52000 8192
done
ls -A "$SCRATCH/tmp"; rm -rf "$CTRL" "$SCRATCH/tmp" "$SCRATCH/home"
```

Each run builds a store of 52,000 incompressible 8 KiB blobs (406.3 MiB of stored z), each referenced by one entry, all marked with a segment the box lacks, through `createStore` and sweep's `openStore` (the writer's own pragmas: `busy_timeout` 30000, `journal_size_limit` 64 MiB), then runs `checkSegmentMarks` once on a default run budget (90 s, 512 MiB) and prints one JSON line. Expected (measured): the control `"cleared":104000,"commits":1,"walPeakAtCommitMiB":"440.3","truncates":0,"walRatioAtCommit":"1.084"`, about 4 s; this task `"cleared":104000,"stopped":null,"commits":29,"walPeakAtCommitMiB":"17.4","truncates":26,"walPeakAfterTruncateMiB":"0.0","walRatioAtCommit":"0.043"`, about 6.4 s (26 batches of 16 MiB, each followed by its checkpoint; the other three commits are the two empty pages that end the phases and the done stamp). `ls -A` prints nothing: each fixture HOME was removed. Record both lines in the task report; a peak at a commit above 42 MiB, or any after-truncate size above 0, is a red to stop on.

- [ ] **Step 12: Commit**, from the repository root. D-5632 is defined in this plan's "Deviations found" already; the source comments above cite it.

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs server/test/history-lib.test.ts server/test/history-export.test.ts server/test/single-definition.test.ts
git commit -m "feat(history): the check after a bind runs in bounded, resumable batches (W5h-1 Task 1; D-5632)"
```

---

### Task 2: doctor sees a check that cannot finish

Task 1 runs the check after a bind in bounded batches, so one check can take several ticks. When it stops short it writes a stop record, meta `HEALTH_META.exportMarksCheck` (`'<word> <sinceMs> <cleared>'`), and its done stamp deletes that record. While the record stands, a mark may still name a segment that is not on this box, and the gap guard cannot see those rows. Doctor has no rule for this yet: the B4 plan's residual says so, and scope b4-bindcheck item 2 owes one. This task gives `status` a reader for the record and gives `deriveHealth` two words, each with a remedy per stop word:
- **WARN `export-marks-unchecked`** while the record stands;
- **FAIL `export-marks-stalled`** in place of that WARN when the record's word is an escalating one, which no tick moves past by itself (`wal-held`, `unlistable`, `failed`: Task 1's `MARK_CHECK_STALL_WORDS`), and the record's `sinceMs` is more than `EXPORT_MARKS_STALL_MS` (24 h) ago. Task 1 restarts `sinceMs` when the word crosses between the escalating class and the other, so the age is the escalating class's own.

`budget` and `off` never escalate: `off` holds back every other freshness FAIL (D-4314), so it holds this one too. The rule is coordinator ruling R5, as amended by the coordinator. R5 is **provisional**: the operator rules on it at plan approval, because a FAIL turns doctor red and makes `ccrc update` exit 3. The departure is D-5633 (`history-export-bind-check-doctor`).

**Files:**
- Modify: `ccd/history/lib.mjs`. Line numbers were measured at `e4936efab`; re-anchor by the quoted content:
  - the `HEALTH_WORDS` doc comment's last line `` *  `spool-planted`. */`` (`:336`);
  - in `healthEntries`, the warn row `    'drain-rejected', 'spool-planted',` (`:346`) and the fail row `    'export-segment-newer', 'export-overdue', 'status-unreadable',` (`:353`);
  - in `HEALTH_REMEDIES`, two entries directly after `  'export-segment-missing': 'carry the export directory …',` (`:3420`);
  - in `remedyFor`, two cases directly above its `    default:` line, which follows `    case 'export-overdue':` / `      return exportOverdueRemedy(h);` (`:3477-3479`);
  - in `deriveHealth`, four lines directly after the `export-overdue` FAIL line (`:3676`) and one line directly after the `export-segment-missing` WARN line (`:3695`);
  - one section appended at the END of the file. lib.mjs has no entry guard, and the section goes after Task 1's sections.
- Modify: `ccd/history/lib.d.mts`. In `export interface HealthInputs`, one field directly after `  readonly heldPassMs?: number | null;` (`:403`).
- Modify: `ccd/history/cli.mjs`:
  - in `readStoreExtras` (`:1161`) and in `readHealthExtras`'s no-store default (`:1208`), the two default literals that end `heldPassMs: null, unmeasured: [] }` (`:1162`, `:1208`);
  - one `read(…)` block directly after the `heldPassMs` read, which ends `      x.heldPassMs = Number(v);` / `    });` (`:1184-1185`);
  - in `healthInputsOf`, one line directly after `    heldPassMs: x.heldPassMs ?? null,` (`:1268`).
- Not here: the spec. Its §9.6 and §9.10 rows for both words are Task 7's (Step 7), citing D-5633.
- Test: `server/test/history-lib.test.ts`:
  - two rows in task 28's `WORD_CASES`, directly after `    ['spool-planted', 'warn', { spoolDisplaced: 2, spoolBlocked: 1 }],` (`:3730`);
  - one describe appended at the end of the file.
  The namespace import `healthLib` (`:38`) covers every name used.
- Test: `server/test/history-export.test.ts`. One describe appended at the end. It reuses B4 Task 9's module-level `X9Envelope`, `X9_MIN`, `X9_HOUR` (`:1723-1737`) and the `x9H`, `x9Lib`, `x9Store` imports (`:26-34`), and adds no import.
- Test: `server/test/ccrc-doctor.test.ts`. In `describeLinux('ccrc doctor: history — a real store, state by state …')`'s `STATES`, two rows directly after the three-line `export-segment-missing` row that begins `    { word: 'export-segment-missing', cls: 'WARN',` (`:14417-14419`).
- Not edited:
  - `ccd/ccrc-doctor-checks`: it relays `health` words and spells only `status-unreadable`;
  - `ccd/history/sweep.mjs`: Task 1 writes the record, records `unlistable` and `failed` in exportStep's catch, and deletes a record no owed check stands behind;
  - `server/test/history-cli.test.ts`: it is only re-run, for the STATUS_SQL cost pin;
  - `server/test/single-definition.test.ts`: Task 1 binds `EXPORT_MARKS_STALL_MS` and `MARK_CHECK_WORDS`; this task declares no exported constant.

  The relay describe in `ccrc-doctor.test.ts` iterates `HEALTH_WORDS`, so both new words get a relay case without an edit.

**Interfaces:**
- Consumes (Task 1, `lib.mjs` and `lib.d.mts`):
  - `HEALTH_META.exportMarksCheck = 'export_marks_check'`;
  - `EXPORT_MARKS_STALL_MS = 24 * 60 * 60 * 1000`;
  - `MARK_CHECK_WORDS` (exported, frozen: `budget`, `off`, `wal-held`, `unlistable`, `failed`), the shared name this task's tests import; and the module-private `MARK_CHECK_STALL_WORDS` (`wal-held`, `unlistable`, `failed`), which this task's arm reads in the same module and never declares again.
  - `parseMarkCheckState(v)`. It answers `{ word, sinceMs, cleared }` for a value in the grammar `'<word> <sinceMs> <cleared>'`, where word is a `MARK_CHECK_WORDS` member. Off the grammar, it throws. `sinceMs` is when the word's class first stood: `nextMarkCheckState` keeps it while the word stays within one class and restarts it when the word crosses between `MARK_CHECK_STALL_WORDS` and `budget`/`off`. `cleared` is the check's running total.
  - Task 1's check writes the record on every stop and deletes it with its done stamp; exportStep's catch writes `unlistable` and `failed`; a step that owes no check deletes a standing record (Task 1's stale-record case, which this task's status read makes bite).
- Consumes (base):
  - `lib.mjs`: `deriveHealth`, `HEALTH_WORDS`, `HEALTH_REMEDIES`, `remedyFor`, and the module-private `minutesOf`, `SWEEP_LOG`, `SWITCHES`, `EXPORT_DIR`;
  - `cli.mjs`: `readStoreExtras`' `read(name, fn)` and `meta(k)`, which reuse `STATUS_SQL.metaKey`, and `healthInputsOf`;
  - B4 Task 9's test helpers named above, and `ccrc-doctor.test.ts`'s `withStore`, `metaOnFreshTick` and `HEALTH_META`.
- Produces:
  - `lib.d.mts`: `HealthInputs.exportMarksCheck?: ReturnType<typeof parseMarkCheckState> | null`. It is optional like D-5027's `heldPassMs`: absent and null both mean that no check stands unfinished, and an unreadable record rides `extrasUnmeasured`.
  - `lib.mjs`: `HEALTH_WORDS` gains `export-marks-unchecked` (warn) and `export-marks-stalled` (fail), and `HEALTH_REMEDIES` gains a fallback text for each. These module-private names are added:
    - `MARK_CHECK_GLOSS`;
    - `markCheckClassWords(word)`: the words of a stop word's class, `'wal-held, unlistable or failed'` or `'budget or off'`, for the detail;
    - `markCheckArm(h): null | 'unchecked' | 'stalled'`, over Task 1's `MARK_CHECK_STALL_WORDS`;
    - `markCheckDetail(arm, h)`;
    - `markCheckRemedy(word, h)`, which `remedyFor` reaches for both words.
  - `cli.mjs`: `readStoreExtras`' result gains `exportMarksCheck`, which is null when the key is absent. A value the parser refuses is named `export_marks_check` in `unmeasured`. `healthInputsOf` maps it. No statement is added to the status path, and the envelope gains no field.

**Spec:** §9.6 "FAIL on" and "WARN on", §9.10's failure table, §9.15 "After a bind"; the spec text is Task 7's (Step 7). Departure: D-5633 (`history-export-bind-check-doctor`), with its line in "Deviations found". Coordinator rulings: R4 (starvation behind ingest is accepted and made visible), R5 as amended by the coordinator (the escalating class `wal-held`, `unlistable`, `failed`; the threshold; provisional), R2 and D-4762 (the check stays outside db/'s floor, so no `low-disk` word exists).

**Choices this task makes:**
- **The age is the escalating class's.** The record carries one clock, `sinceMs`, which Task 1 keeps while the word stays within one class and restarts when it crosses. So a check starved on `budget` for over a day that then stops on `wal-held` is a fresh WARN, and FAILs only once it has stopped on escalating words for 24 h.
- **A first stop recorded in the future** (the clock stepped back) reads as 0 min and never FAILs. A FAIL needs a positive age past 24 h, so the rule needs no `PASS_FUTURE_SLACK_MS` guard. That guard exists for `heldPassMs`, which grants freshness; this rule only withholds a FAIL on a future clock.
- **`off` never escalates** (R5 as amended): the off switch holds back every other freshness FAIL (D-4314), so a node kept off for days after an adopt stays a WARN with the off remedy.
- **The two details stay distinct.** `export-segment-missing` says how many marks were cleared. `export-marks-unchecked` says the check is unfinished, what it last stopped on, and what that leaves unseen. Each has its own remedy.
- **The field is optional, as D-5027's `heldPassMs` is,** so no existing `HealthInputs` literal changes: Task 28's `base()`, B4's `live` and `ccrc-doctor`'s `cleanInputs` stay as they are.

- [ ] **Step 1: Confirm Task 1's names before using them.** From the repository root:

```bash
grep -c "exportMarksCheck: 'export_marks_check'" ccd/history/lib.mjs
grep -c '^export const EXPORT_MARKS_STALL_MS = ' ccd/history/lib.mjs
grep -c '^export function parseMarkCheckState(' ccd/history/lib.mjs ccd/history/lib.d.mts
grep -c "'EXPORT_MARKS_STALL_MS'" server/test/single-definition.test.ts
grep -c '^export const MARK_CHECK_WORDS = ' ccd/history/lib.mjs
grep -c "^const MARK_CHECK_STALL_WORDS = Object.freeze(\['wal-held', 'unlistable', 'failed'\]);" ccd/history/lib.mjs
node --input-type=module -e "const l = await import('./ccd/history/lib.mjs'); console.log(JSON.stringify(l.parseMarkCheckState('wal-held 1800000000000 4')), l.EXPORT_MARKS_STALL_MS, l.MARK_CHECK_WORDS.join(','))"
```

Expected:
- every count is 1, and for the third command 1 for each file;
- the last line prints `{"word":"wal-held","sinceMs":1800000000000,"cleared":4} 86400000 budget,off,wal-held,unlistable,failed`. lib.mjs is L1 and reads no file and no HOME.

A 0 or a different shape is a gap in Task 1. Stop and report it. Never define any of these names here: single-definition allows one declaration, and it is Task 1's.

- [ ] **Step 2: Write the failing pure tests.** In `server/test/history-lib.test.ts`, in task 28's `WORD_CASES`, replace the one line

```ts
    ['spool-planted', 'warn', { spoolDisplaced: 2, spoolBlocked: 1 }],
```

with

```ts
    ['spool-planted', 'warn', { spoolDisplaced: 2, spoolBlocked: 1 }],
    // W5h-1 Task 2 (D-5633): a check after a bind that has not finished; stopped on an escalating word past EXPORT_MARKS_STALL_MS, it FAILs.
    ['export-marks-unchecked', 'warn', { exportMarksCheck: { word: 'budget', sinceMs: NOW - MIN, cleared: 4 } }],
    ['export-marks-stalled', 'fail', { exportMarksCheck: { word: 'failed', sinceMs: NOW - 25 * 60 * MIN, cleared: 0 } }],
```

Then append at the end of the file:

```ts

// ── W5h-1 Task 2: doctor sees a check after a bind that cannot finish (D-5633 (history-export-bind-check-doctor)) ─
// Pure, every input a parameter, the clock included. Task 1 writes HEALTH_META.exportMarksCheck ('<word> <sinceMs>
// <cleared>') when the check stops short and deletes it with the done stamp; status reads it through Task 1's
// parseMarkCheckState. This is the rule doctor relays (coordinator ruling R5, as amended): WARN export-marks-unchecked
// while the record stands; FAIL export-marks-stalled IN ITS PLACE once an escalating word (wal-held, unlistable, failed)
// has stood, by the record's sinceMs, more than EXPORT_MARKS_STALL_MS. `budget` and `off` never escalate (R4, R5, D-4314).
describe('deriveHealth, W5h-1: a check after a bind that cannot finish (D-5633)', () => {
  const NOW = 1_800_000_000_000;
  const MIN = 60_000;
  const STORE = '5f0c2d3e-8a1b-4c2d-9e3f-0a1b2c3d4e5f';
  const STALL = healthLib.EXPORT_MARKS_STALL_MS;
  const TAIL = 'until it finishes, a mark may still name a segment that is not on this box, and the gap guard cannot see those rows';
  type Check = NonNullable<healthLib.HealthInputs['exportMarksCheck']>;
  /** Task 28's healthy baseline: a bound store that ticked a minute ago, with no check standing. */
  const clean = (o: Partial<healthLib.HealthInputs> = {}): healthLib.HealthInputs => ({
    nowMs: NOW, storeId: STORE, exit: 0, reason: null,
    shimMtimeMs: NOW - 60 * MIN, lastTickMs: NOW - MIN, lagS: 5, sizeBytes: 1_000_000,
    capGb: 50, capMalformed: false, capFile: '/home/u/.ccrc/cap-fixture', capturePause: '',
    migration: 'none', userVersion: 1, codeVersion: 1, historyOff: false, recovering: null, op: null, pass: null,
    bytesBehindLast3: [0, 0, 0], fts: 'ready', modesWrong: [], rootIsSymlink: false,
    redactUnreadable: [], breakerOpen: false, rosterUnreadable: false, exportDue: 0, exportOverdue: 0,
    exportWriterLive: true, exportPausedLowDisk: false, retentionLowered: null, retentionUnmeasured: [],
    journalGrowth30d: 0, journalSkipped: 0, blobUndecodable: 0, drainRejected: 0, spoolDisplaced: 0, spoolBlocked: 0, spoolUnreadable: 0, spoolNotDirectory: false, spoolNodesRefused: 0, exportSegmentNewer: [], exportSegmentMissing: 0,
    journalUnwritable: false, dbPath: '/home/u/.ccrc/history/db', freeBytes: 100_000_000_000,
    thresholdBytes: 20_000_000_000, copyBps: null, backupsDb: [], journalStoreDirs: [], extrasUnmeasured: [], exportLastPassMs: null, exportDueOldestMs: null,
    ...o,
  });
  /** The stop record as status hands it over: `word`, its `sinceMs` `agoMs` before NOW, `cleared` marks so far. */
  const check = (word: Check['word'], agoMs: number, cleared = 0): Partial<healthLib.HealthInputs> =>
    ({ exportMarksCheck: { word, sinceMs: NOW - agoMs, cleared } });
  const words = (r: healthLib.HealthResult, cls: 'warn' | 'fail'): string[] => r[cls].map((i) => i.word);
  const ESCALATING = ['wal-held', 'unlistable', 'failed'] as const;
  const NEVER = ['budget', 'off'] as const;
  const ALL = healthLib.MARK_CHECK_WORDS;   // Task 1's shared name: the five stop words
  /** One fragment of each word's own remedy. */
  const REMEDY: Record<Check['word'], string> = {
    budget: 'once ingest leaves it room',
    off: `remove ~/${healthLib.SWITCHES.off} when capture should resume`,
    'wal-held': 'so a checkpoint can truncate the WAL',
    unlistable: `make ~/.ccrc/history/${healthLib.EXPORT_DIR}/${STORE} a directory this user can read`,
    failed: 'the check\'s error is logged there each tick it fails',
  };

  it('no stop record, absent or null, is no word: the baseline stays PASS ok', () => {
    expect(healthLib.deriveHealth(clean())).toEqual({ pass: 'ok', warn: [], fail: [] });
    expect(healthLib.deriveHealth(clean({ exportMarksCheck: null }))).toEqual({ pass: 'ok', warn: [], fail: [] });
  });

  it('a check that stopped WARNs export-marks-unchecked, naming its last word, how long it has stopped on words of that class and the marks it cleared so far', () => {
    const r = healthLib.deriveHealth(clean(check('budget', 30 * MIN, 4)));
    expect(words(r, 'warn')).toEqual(['export-marks-unchecked']);
    expect(words(r, 'fail')).toEqual([]);
    expect(r.warn[0]!.detail).toBe(`store ${STORE}: the check of the export marks after a bind has not finished: it last stopped on budget `
      + `(the run budget was spent before its next batch, ingest first), has stopped on budget or off for 30 min, and has cleared 4 mark(s) so far; ${TAIL}`);
  });

  it.each(ALL)('stopped on %s: the detail names the word, and the remedy is that word\'s own, then the prune hold', (word) => {
    const i = healthLib.deriveHealth(clean(check(word, 30 * MIN))).warn.find((x) => x.word === 'export-marks-unchecked');
    expect(i?.detail).toContain(`it last stopped on ${word} (`);
    expect(i?.remedy).toContain(REMEDY[word]);
    expect(i?.remedy, 'prune --apply is not gated on the marks').toContain('; until the check finishes, hold any ccrc history prune --apply');
  });

  it('the five words carry five remedies, none of them the fallback text', () => {
    const remedies = ALL.map((w) => healthLib.deriveHealth(clean(check(w, 30 * MIN))).warn[0]!.remedy);
    expect(new Set(remedies).size).toBe(ALL.length);
    for (const r of remedies) expect(r).not.toBe(healthLib.HEALTH_REMEDIES['export-marks-unchecked']);
  });

  it('every MARK_CHECK_WORDS member has its own remedy text, and the table names no other word (Task 1\'s shared list, bound both ways)', () => {
    expect(Object.keys(REMEDY).sort()).toEqual([...healthLib.MARK_CHECK_WORDS].sort());
    for (const w of healthLib.MARK_CHECK_WORDS) {
      const remedy = healthLib.deriveHealth(clean(check(w, 30 * MIN))).warn.find((x) => x.word === 'export-marks-unchecked')?.remedy;
      expect(remedy, w).toContain(REMEDY[w]);
      expect(remedy, w).not.toBe(healthLib.HEALTH_REMEDIES['export-marks-unchecked']);
    }
  });

  it.each(ESCALATING)('%s standing past EXPORT_MARKS_STALL_MS FAILs export-marks-stalled, which replaces the WARN', (word) => {
    const r = healthLib.deriveHealth(clean(check(word, STALL + 60 * MIN, 7)));
    expect(words(r, 'fail')).toEqual(['export-marks-stalled']);
    expect(words(r, 'warn')).toEqual([]);
    expect(r.fail[0]!.detail).toContain(`has not finished: it last stopped on ${word} (`);
    expect(r.fail[0]!.detail).toContain(`has stopped on wal-held, unlistable or failed for ${Math.round(STALL / MIN) + 60} min (over ${Math.round(STALL / MIN)} min), words no tick moves past by itself, and has cleared 7 mark(s) so far; ${TAIL}`);
    expect(r.fail[0]!.remedy).toContain(REMEDY[word]);
  });

  it('the threshold is strict, and R5 ruled it 24 h: at EXPORT_MARKS_STALL_MS still the WARN, one ms past the FAIL', () => {
    expect(STALL).toBe(24 * 60 * MIN);
    const at = healthLib.deriveHealth(clean(check('failed', STALL)));
    expect(words(at, 'warn')).toEqual(['export-marks-unchecked']);
    expect(words(at, 'fail')).toEqual([]);
    expect(words(healthLib.deriveHealth(clean(check('failed', STALL + 1))), 'fail')).toEqual(['export-marks-stalled']);
  });

  it.each(NEVER)('%s never escalates: a check stopped on it for thirty days stays a WARN (R4, R5 as amended; off holds back every freshness FAIL, D-4314)', (word) => {
    const r = healthLib.deriveHealth(clean(check(word, 30 * 24 * 60 * MIN, 2)));
    expect(words(r, 'fail')).toEqual([]);
    expect(words(r, 'warn')).toEqual(['export-marks-unchecked']);
    expect(r.warn[0]!.detail).toContain('has stopped on budget or off for 43200 min');
  });

  it('a first stop recorded in the future (the clock stepped back) reads 0 min and never FAILs', () => {
    const r = healthLib.deriveHealth(clean(check('failed', -10 * MIN)));
    expect(words(r, 'fail')).toEqual([]);
    expect(r.warn[0]!.detail).toContain('has stopped on wal-held, unlistable or failed for 0 min');
  });

  it('beside export-segment-missing: two items with two sentences, what was cleared and that the check is unfinished, and two remedies', () => {
    const r = healthLib.deriveHealth(clean({ exportSegmentMissing: 3, ...check('budget', 30 * MIN, 3) }));
    expect(words(r, 'warn').sort()).toEqual(['export-marks-unchecked', 'export-segment-missing']);
    const missing = r.warn.find((i) => i.word === 'export-segment-missing')!;
    const unchecked = r.warn.find((i) => i.word === 'export-marks-unchecked')!;
    const tag = `store ${STORE}: `;
    expect(unchecked.detail).not.toContain(missing.detail.slice(tag.length));
    expect(missing.detail).not.toContain('has not finished');
    expect(unchecked.remedy).not.toBe(missing.remedy);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'D-5633|export-marks|every HEALTH_WORDS member')
```

Expected: red, `19 failed | 1 passed` (predicted: measured as `18 failed | 1 passed` against a stand-in for Task 1's three names before R5's amendment reshaped the describe and the `MARK_CHECK_WORDS` binding case was added). The one that passes is the no-record CONTROL. The two `WORD_CASES` rows fail with `{"pass":"ok","warn":[],"fail":[]}: expected [] to include 'export-marks-unchecked'` (and `'export-marks-stalled'`). Task 28's coverage case fails with `expected [ 'at-cap', 'blob-undecodable', …(48) ] to deeply equal [ 'at-cap', 'blob-undecodable', …(46) ]`: the table names two words that `HEALTH_WORDS` lacks. The new describe's cases fail with `expected [] to deeply equal [ 'export-marks-unchecked' ]`, `expected [] to deeply equal [ 'export-marks-stalled' ]`, and, in the per-word case, `the given combination of arguments (undefined and string) is invalid for this assertion`.

- [ ] **Step 4: Write the lib rule.** In `ccd/history/lib.mjs`:

(a) In the `HEALTH_WORDS` doc comment, replace the one line

```js
 *  `spool-planted`. */
```

with

```js
 *  `spool-planted`, and D-5633's `export-marks-unchecked` and `export-marks-stalled`. */
```

(b) In `healthEntries`, replace the warn row's last line

```js
    'drain-rejected', 'spool-planted',
```

with

```js
    'drain-rejected', 'spool-planted', 'export-marks-unchecked',
```

and the fail row's line

```js
    'export-segment-newer', 'export-overdue', 'status-unreadable',
```

with

```js
    'export-segment-newer', 'export-overdue', 'export-marks-stalled', 'status-unreadable',
```

(c) In `HEALTH_REMEDIES`, directly after the line `  'export-segment-missing': 'carry the export directory from the box the store came from, or let the rows export again',`, insert:

```js
  // D-5633 (history-export-bind-check-doctor): the fallback texts; remedyFor answers by the word the check stopped on.
  'export-marks-unchecked': `none needed while the check resumes each tick; otherwise act on the word it stopped on (history off, a long-running reader, an unreadable export directory), or read the sweep: ${SWEEP_LOG}`,
  'export-marks-stalled': `act on the word the check stopped on (history off, a long-running reader, an unreadable export directory), or read the sweep: ${SWEEP_LOG}`,
```

(d) In `remedyFor`, replace

```js
    case 'export-overdue':
      return exportOverdueRemedy(h);
    default:
```

with

```js
    case 'export-overdue':
      return exportOverdueRemedy(h);
    case 'export-marks-unchecked':
    case 'export-marks-stalled':
      return markCheckRemedy(word, h);
    default:
```

(e) In `deriveHealth`, directly after the one line that begins `  if (h.exportOverdue > 0) fail.push(item('export-overdue',`, insert:

```js
  // D-5633 (history-export-bind-check-doctor): a check after a bind that has stopped on escalating words (wal-held,
  // unlistable, failed) for over EXPORT_MARKS_STALL_MS FAILs in place of its WARN below (coordinator ruling R5, as amended).
  const markCheck = markCheckArm(h);
  if (markCheck === 'stalled') fail.push(item('export-marks-stalled', markCheckDetail(markCheck, h)));
```

and directly after the one line that begins `  if (h.exportSegmentMissing > 0) warn.push(item('export-segment-missing',`, insert:

```js
  if (markCheck === 'unchecked') warn.push(item('export-marks-unchecked', markCheckDetail(markCheck, h)));   // D-5633: the stalled FAIL above replaces it
```

(f) Append at the END of `ccd/history/lib.mjs`:

```js

// ── W5h-1 Task 2: doctor sees a check after a bind that cannot finish (D-5633 (history-export-bind-check-doctor)) ─
// Task 1's check after a bind runs in bounded batches over as many ticks as it needs, and writes
// HEALTH_META.exportMarksCheck ('<word> <sinceMs> <cleared>', parsed by parseMarkCheckState) each time it stops short;
// its done stamp deletes the record. Until then a mark may still name a segment that is not on this box, so the gap
// guard cannot see those rows. Two words (coordinator ruling R5 as amended, put to the operator at plan approval):
//   export-marks-unchecked  WARN while the record stands;
//   export-marks-stalled    FAIL in its place once the word is one no tick moves past by itself (Task 1's
//                           MARK_CHECK_STALL_WORDS: wal-held, unlistable, failed) and the record's sinceMs is more than
//                           EXPORT_MARKS_STALL_MS ago (a FAIL turns doctor red, and `ccrc update` exits 3 on it).
// `budget` is progress: the check resumes as each tick's budget allows, and its starvation behind ingest is accepted
// and made visible by the WARN (R4); it never escalates, since an ingest backlog that long already FAILs lag-high.
// `off` never escalates either: the operator's switch holds back every other freshness FAIL (D-4314).
// The age is the record's sinceMs, which Task 1 keeps while the word stays within one class and restarts when it
// crosses between the escalating words and budget/off, so it is the escalating class's own. A sinceMs recorded in the
// future (the clock stepped back) reads as 0 min, so it never reaches the FAIL.
// These are function declarations and frozen consts read at call time: deriveHealth and remedyFor, above, call
// them only after the module has loaded. MARK_CHECK_WORDS and MARK_CHECK_STALL_WORDS are Task 1's, declared once.

/** The words of a stop word's class, for the detail: 'wal-held, unlistable or failed', or 'budget or off'. */
function markCheckClassWords(word) {
  const ws = MARK_CHECK_WORDS.filter((w) => MARK_CHECK_STALL_WORDS.includes(w) === MARK_CHECK_STALL_WORDS.includes(word));
  return ws.length === 1 ? ws[0] : `${ws.slice(0, -1).join(', ')} or ${ws[ws.length - 1]}`;
}

/** What each stop word means, for the detail. */
const MARK_CHECK_GLOSS = Object.freeze({
  budget: 'the run budget was spent before its next batch, ingest first',
  off: 'capture is off',
  'wal-held': 'a reader held the store\'s WAL past its ceiling',
  unlistable: 'the export directory could not be listed',
  failed: 'an error the sweep logged',
});

/** Which of the two words the record raises, or null when no check stands unfinished. */
function markCheckArm(h) {
  const s = h.exportMarksCheck ?? null;
  if (s === null) return null;
  if (MARK_CHECK_STALL_WORDS.includes(s.word) && h.nowMs - s.sinceMs > EXPORT_MARKS_STALL_MS) return 'stalled';
  return 'unchecked';
}

/** The detail of either word. It says what is unfinished, never what was cleared: export-segment-missing says that. */
function markCheckDetail(arm, h) {
  const s = h.exportMarksCheck;
  const age = Math.max(0, minutesOf(h.nowMs - s.sinceMs));
  const why = `${s.word} (${MARK_CHECK_GLOSS[s.word] ?? 'a word this build does not know'})`;
  const since = `has stopped on ${markCheckClassWords(s.word)} for ${age} min`;
  const tail = `has cleared ${s.cleared} mark(s) so far; until it finishes, a mark may still name a segment that is not on this box, and the gap guard cannot see those rows`;
  if (arm === 'stalled') {
    return `the check of the export marks after a bind has not finished: it last stopped on ${why}, ${since} (over ${minutesOf(EXPORT_MARKS_STALL_MS)} min), words no tick moves past by itself, and ${tail}`;
  }
  return `the check of the export marks after a bind has not finished: it last stopped on ${why}, ${since}, and ${tail}`;
}

/** Said after every word's own remedy: until the check finishes, a mark may name a segment that is not on this box whole,
 *  and prune --apply is not gated on the marks, so a blob it tombstones then keeps its bytes in no segment here. */
const MARK_CHECK_PRUNE_HOLD = 'until the check finishes, hold any ccrc history prune --apply: a blob it tombstones while its mark names a segment not on this box whole keeps its bytes in no segment here';

/** The remedy of either word, by the word the check last stopped on, with the prune hold; the fallback text when there
 *  is no record. */
function markCheckRemedy(word, h) {
  const own = markCheckOwnRemedy(word, h);
  return (h.exportMarksCheck ?? null) === null ? own : `${own}; ${MARK_CHECK_PRUNE_HOLD}`;
}

/** The remedy of the word the check last stopped on alone. */
function markCheckOwnRemedy(word, h) {
  const s = h.exportMarksCheck ?? null;
  switch (s === null ? null : s.word) {
    case 'budget':
      return `none needed: the check resumes within each tick's budget once ingest leaves it room; if it stands for days, read the sweep: ${SWEEP_LOG}`;
    case 'off':
      return `remove ~/${SWITCHES.off} when capture should resume: the check resumes with the next tick`;
    case 'wal-held':
      return 'end the long-running read of the store (a ccrc history verb or another reader left open), so a checkpoint can truncate the WAL: the check resumes with the next tick';
    case 'unlistable':
      return `make ~/.ccrc/history/${EXPORT_DIR}/${h.storeId ?? '<store_id>'} a directory this user can read: the check resumes with the next tick`;
    case 'failed':
      return `read the sweep: ${SWEEP_LOG}; the check's error is logged there each tick it fails`;
    default:
      return HEALTH_REMEDIES[word];
  }
}
```

(g) In `ccd/history/lib.d.mts`, in `export interface HealthInputs`, directly after the line `  readonly heldPassMs?: number | null;`, insert:

```ts
  /** D-5633 (W5h-1 Task 2): the check after a bind's stop record (meta HEALTH_META.exportMarksCheck, read by parseMarkCheckState); null or absent when no check stands unfinished. A value the parser refuses rides extrasUnmeasured. */
  readonly exportMarksCheck?: ReturnType<typeof parseMarkCheckState> | null;
```

`ReturnType` names Task 1's declaration and adds no second spelling of its type. Check: `grep -c '^const MARK_CHECK_STALL_WORDS = ' ccd/history/lib.mjs` prints 1 (Task 1's; this task declares none).

- [ ] **Step 5: Run them and see them pass, then the typecheck.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- `history-lib.test.ts` is green as a whole: `1108 passed` on this plan's tree, that is the base's 1083, Task 1's 6 and this task's 19 (17 in the new describe and 2 `WORD_CASES` rows) (predicted: measured as `1102`, the base plus this task alone, against a stand-in for Task 1's three names, and as `1101` before the binding case was added). That includes task 28's coverage case, its `HEALTH_REMEDIES names exactly the warn and fail words` case (both new words carry a fallback text), and its `every item names the store it measured and carries a non-empty remedy` case over the two new rows.
- tsc prints nothing. The new field is optional, so no existing `HealthInputs` literal needs it. A line that names only `agent/src/` or a module that is not installed comes from the worktree's install, not this task. A line naming any of this task's files is this task's.

- [ ] **Step 6: Write the failing delivery tests.** Two files.

(a) `server/test/history-export.test.ts`. Append at the end of the file:

```ts

// ── W5h-1 Task 2: status reads the check's stop record, and doctor's two words come from it (D-5633) ───────────────
// The real CLI against a store B1's first scheduled pass made (fixture HOMEs only, as B4 Task 9's describes above). The
// record is planted exactly as Task 1's check leaves it: '<word> <sinceMs> <cleared>' in HEALTH_META.exportMarksCheck.
describe('W5h-1 Task 2: status reads export_marks_check; a stopped check WARNs, a stalled one FAILs, a malformed one is unmeasured (D-5633)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  /** A bound store after its first scheduled pass. */
  function w5Bound(prefix: string): x9H.HistoryBox {
    const box = x9H.makeHistoryBox(prefix, { role: 'fleet', shim: true });
    const r = x9H.runSweep(box);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    return box;
  }
  /** The check's stop record set to `v`, or deleted when `v` is null (the done stamp's delete). */
  function w5Plant(box: x9H.HistoryBox, v: string | null): void {
    const db = x9Store.openWriter(x9Lib.historyPaths(box.home).dbFile);
    try {
      if (v === null) db.prepare('DELETE FROM meta WHERE k = ?').run(x9Lib.HEALTH_META.exportMarksCheck);
      else x9Store.setMeta(db, x9Lib.HEALTH_META.exportMarksCheck, v);
    } finally { x9Store.closeWriter(db); }
  }
  /** `ccrc history status --json`'s health, as doctor reads it. */
  function w5Health(box: x9H.HistoryBox): X9Envelope['health'] {
    const r = x9H.runCli(box, ['status', '--json']);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    return (r.json as unknown as X9Envelope).health;
  }
  const w5Words = (h: X9Envelope['health']): string[] => [...h.warn, ...h.fail].map((i) => i.word);

  it('planted, the record WARNs export-marks-unchecked; an escalating word past the stall FAILs export-marks-stalled instead; deleted, neither', () => {
    const box = w5Bound('ccrc-hist-w5h2-status-');
    expect(w5Words(w5Health(box)), 'CONTROL: a fresh store has no check standing').not.toContain('export-marks-unchecked');
    w5Plant(box, `budget ${Date.now() - 30 * X9_MIN} 4`);
    const warned = w5Health(box);
    const item = warned.warn.find((i) => i.word === 'export-marks-unchecked');
    expect(item, JSON.stringify(warned)).toBeDefined();
    expect(item!.detail).toContain('it last stopped on budget (');
    expect(item!.detail).toContain('has cleared 4 mark(s) so far');
    expect(warned.fail.map((i) => i.word)).not.toContain('status-unreadable');
    w5Plant(box, `wal-held ${Date.now() - x9Lib.EXPORT_MARKS_STALL_MS - X9_HOUR} 4`);
    const failed = w5Health(box);
    expect(failed.fail.map((i) => i.word)).toContain('export-marks-stalled');
    expect(failed.warn.map((i) => i.word), 'the FAIL replaces the WARN').not.toContain('export-marks-unchecked');
    w5Plant(box, null);
    const words = w5Words(w5Health(box));
    expect(words).not.toContain('export-marks-unchecked');
    expect(words).not.toContain('export-marks-stalled');
  }, 120_000);

  it('a record the parser refuses is unmeasured: FAIL status-unreadable naming export_marks_check, never "no check standing"', () => {
    const box = w5Bound('ccrc-hist-w5h2-malformed-');
    w5Plant(box, 'budget soon 4');
    const h = w5Health(box);
    const unread = h.fail.find((i) => i.word === 'status-unreadable');
    expect(unread, JSON.stringify(h)).toBeDefined();
    expect(unread!.detail).toContain(x9Lib.HEALTH_META.exportMarksCheck);
    expect(w5Words(h)).not.toContain('export-marks-unchecked');
  }, 120_000);
});
```

(b) `server/test/ccrc-doctor.test.ts`. In the `STATES` table of `describeLinux('ccrc doctor: history — a real store, state by state (O15, O28, O37, O41, O55, DM43)', …)`, replace the three lines

```ts
    { word: 'export-segment-missing', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportSegmentMissing, '2')),
      names: () => ['2'] },
```

with

```ts
    { word: 'export-segment-missing', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportSegmentMissing, '2')),
      names: () => ['2'] },
    // W5h-1 Task 2 (D-5633): the check after a bind's stop record, as Task 1's check writes it ('<word> <sinceMs> <cleared>').
    { name: 'D-5633: a check after a bind that stopped WARNs export-marks-unchecked, naming its word and the marks it cleared', word: 'export-marks-unchecked', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportMarksCheck, `budget ${Date.now() - 30 * 60_000} 4`)),
      names: () => ['budget', '4 mark(s)'], remedyNames: () => ['once ingest leaves it room'], absent: ['FAIL history: '] },
    { name: 'D-5633: a check stopped on an escalating word for over a day FAILs export-marks-stalled, so doctor goes red', word: 'export-marks-stalled', cls: 'FAIL',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportMarksCheck, `unlistable ${Date.now() - 25 * 3_600_000} 0`)),
      names: () => ['unlistable'], remedyNames: () => ['a directory this user can read'], absent: ['WARN history: export-marks-unchecked'] },
```

The table's `it.each` asserts the check's return code: 1 when a FAIL line is printed, which is what makes `ccrc update` exit 3, and 2 for WARNs only. First check that the anchor is unique, from the repository root: `grep -c "{ word: 'export-segment-missing', cls: 'WARN'," server/test/ccrc-doctor.test.ts` prints 1.

- [ ] **Step 7: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'W5h-1 Task 2')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'D-5633')
```

Expected: red, with lib's rule in place and status not yet reading the record (measured):
- `history-export.test.ts`: `2 failed`, each `{"pass":"ok","warn":[],"fail":[]}: expected undefined to be defined`. Status hands `deriveHealth` no record, so neither word nor `status-unreadable` appears.
- `ccrc-doctor.test.ts`: `2 failed`, `no "WARN history: export-marks-unchecked: store " line` and `no "FAIL history: export-marks-stalled: store " line`.

- [ ] **Step 8: Write the status read.** In `ccd/history/cli.mjs`:

(a) Two default literals end `heldPassMs: null, unmeasured: [] }`: `readStoreExtras`' first line and `readHealthExtras`' no-store default. In both, replace `heldPassMs: null, unmeasured: [] }` with

```js
heldPassMs: null, exportMarksCheck: null, unmeasured: [] }
```

Check first: `grep -c 'heldPassMs: null, unmeasured: \[\] }' ccd/history/cli.mjs` prints 2, and prints 0 afterwards.

(b) In `readStoreExtras`, directly after the `heldPassMs` read's last two lines

```js
      x.heldPassMs = Number(v);
    });
```

insert

```js
    // D-5633 (history-export-bind-check-doctor): absent is no unfinished check; a value lib's parser refuses is unmeasured (read names
    // it, and deriveHealth answers status-unreadable), never "no unfinished check".
    read(healthLib.HEALTH_META.exportMarksCheck, () => {
      const v = meta(healthLib.HEALTH_META.exportMarksCheck);
      x.exportMarksCheck = v === null ? null : healthLib.parseMarkCheckState(v);
    });
```

(c) In `healthInputsOf`, directly after the line `    heldPassMs: x.heldPassMs ?? null,`, insert

```js
    exportMarksCheck: x.exportMarksCheck ?? null,   // D-5633: the check after a bind's stop record, or null when none stands
```

The read reuses `STATUS_SQL.metaKey`, so the status path prepares no new statement.

- [ ] **Step 9: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'W5h-1 Task 2|standing when no check is owed')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'D-5633|export-marks')
```

Expected: green. `history-export`: `3 passed` (this task's two, about 4 s measured, and Task 1's stale-record case, whose status lines now read a real record: predicted). `ccrc-doctor`: `4 passed`: the two `STATES` rows, plus the relay describe's `export-marks-unchecked (warn)` and `export-marks-stalled (fail)` rows, which `HEALTH_WORDS` now produces.

- [ ] **Step 10: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w5h1/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp ccd/history/lib.mjs "$SCRATCH/lib.orig"
cp ccd/history/cli.mjs "$SCRATCH/cli.orig"

# M1: the stalled arm dropped, so a check that cannot finish never turns doctor red.
mut ccd/history/lib.mjs "  if (MARK_CHECK_STALL_WORDS.includes(s.word) && h.nowMs - s.sinceMs > EXPORT_MARKS_STALL_MS) return 'stalled';
" ""
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'standing past EXPORT_MARKS_STALL_MS FAILs')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED: 3 failed (predicted; measured 4 failed over the four words R5 named before its amendment),
# expected [] to deeply equal [ 'export-marks-stalled' ].

# M2: the threshold made inclusive.
mut ccd/history/lib.mjs "h.nowMs - s.sinceMs > EXPORT_MARKS_STALL_MS) return 'stalled';" "h.nowMs - s.sinceMs >= EXPORT_MARKS_STALL_MS) return 'stalled';"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the threshold is strict, and R5 ruled it 24 h')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): expected [] to deeply equal [ 'export-marks-unchecked' ] (at exactly 24 h the WARN became a FAIL).

# M3: budget escalates (R4 and R5 say it never does). The list is Task 1's; this mutant edits it in place.
mut ccd/history/lib.mjs "const MARK_CHECK_STALL_WORDS = Object.freeze(['wal-held', " "const MARK_CHECK_STALL_WORDS = Object.freeze(['budget', 'wal-held', "
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'budget never escalates')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured on the pre-amendment list): expected [ 'export-marks-stalled' ] to deeply equal [].

# M3b: off escalates (R5 as amended says it never does; D-4314).
mut ccd/history/lib.mjs "const MARK_CHECK_STALL_WORDS = Object.freeze(['wal-held', " "const MARK_CHECK_STALL_WORDS = Object.freeze(['off', 'wal-held', "
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'off never escalates')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): expected [ 'export-marks-stalled' ] to deeply equal [].

# M4: the WARN printed beside the FAIL instead of being replaced by it.
mut ccd/history/lib.mjs "  if (markCheck === 'unchecked') warn.push(" "  if (markCheck !== null) warn.push("
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'which replaces the WARN')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED: 3 failed (predicted; measured 4 failed before R5's amendment), expected [ 'export-marks-unchecked' ] to deeply equal [].

# M5: one generic remedy for every word.
mut ccd/history/lib.mjs "      return markCheckRemedy(word, h);" "      return HEALTH_REMEDIES[word];"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'five words carry five remedies')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): expected 1 to be 5.

# M6: a first stop in the future read as a negative age.
mut ccd/history/lib.mjs "  const age = Math.max(0, minutesOf(h.nowMs - s.sinceMs));" "  const age = minutesOf(h.nowMs - s.sinceMs);"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'a first stop recorded in the future')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured on the detail's earlier wording; this wording predicted): expected 'store 5f0c2d3e-…' to contain
# 'has stopped on wal-held, unlistable or failed for 0 min' (it reads -10 min).

# M6b: the prune hold dropped from the remedy.
mut ccd/history/lib.mjs "  return (h.exportMarksCheck ?? null) === null ? own : \`\${own}; \${MARK_CHECK_PRUNE_HOLD}\`;" "  return own;"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'then the prune hold')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): prune --apply is not gated on the marks: expected '…' to contain '; until the check finishes, hold any ccrc history prune --apply', five cases.

# M7 (no overloaded null): status folds a record the parser refuses into "no check standing".
mut ccd/history/cli.mjs "      x.exportMarksCheck = v === null ? null : healthLib.parseMarkCheckState(v);" "      try { x.exportMarksCheck = v === null ? null : healthLib.parseMarkCheckState(v); } catch { x.exportMarksCheck = null; }"
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'a record the parser refuses is unmeasured')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (measured): {"pass":"ok","warn":[],"fail":[]}: expected undefined to be defined (no status-unreadable).

# M8: status reads the record but never hands it to deriveHealth.
mut ccd/history/cli.mjs "    exportMarksCheck: x.exportMarksCheck ?? null," "    exportMarksCheck: null,"
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'D-5633')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (measured): 2 failed, no "WARN history: export-marks-unchecked: store " line, and the same for the FAIL row.

git diff --stat -- ccd/history   # lib.mjs, lib.d.mts and cli.mjs show only this task's edits (and Task 1's, if not yet committed)
```

Then run Step 5's and Step 9's commands once more: green.

- [ ] **Step 11: The spec is Task 7's.** No edit here. Task 7's Step 7 adds this rule's §9.6 FAIL and WARN bullets and its §9.10 rows, each citing D-5633, with the rest of the wave's spec text.

- [ ] **Step 12: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'D-5027')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'ends with doctor, and a fresh box ends green')
```

Expected: green (measured at the base with Task 1's names stood in):
- `history-cli`: `72 passed | 1 skipped`. The STATUS_SQL cost pin holds because no statement was added.
- `single-definition -t 'ccrc history'`: `92 passed`. `HEALTH_WORDS` is still declared once and every word `_check_history` spells is a member.
- `ccrc-doctor -t history`: `127 passed`, including both words' relay rows.
- `history-export`: `86 passed` at the base, plus Task 1's cases.
- `history-op`'s D-5027 describe: green. It is the `held_pass_ms` read this one sits beside.
- The fresh-install case: still `0 warned`. A fresh store's first tick writes no stop record.

- [ ] **Step 13: Commit.**

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/cli.mjs \
  server/test/history-lib.test.ts server/test/history-export.test.ts server/test/ccrc-doctor.test.ts
git commit -m "feat(history): doctor WARNs a check after a bind that has not finished and FAILs one that stalls (W5h-1 Task 2, D-5633)"
```

---

### Task 3: a carried segment counts only when it is whole and this store's

**Files:**
- Modify: `ccd/history/lib.mjs` (by content; anchors measured at e4936efab):
  - directly below `export const EXPORT_SEGMENT_FORMAT = 1;` (lib.mjs:160), add the constant `SEGMENT_HEADER_BYTES`;
  - in `HEALTH_META` (lib.mjs:3307-3316), directly below `  exportSegmentMissing: 'export_segment_missing',` (lib.mjs:3310), add `exportSegmentDamaged` (Tasks 1 and 2 add their own members to the same literal; the order does not matter);
  - in `healthEntries`' warn row (lib.mjs:345), `'export-segment-missing',` becomes `'export-segment-missing', 'export-segment-damaged',`;
  - in `HEALTH_REMEDIES`, directly below the `'export-segment-missing': …` member (lib.mjs:3420), add one member;
  - in `deriveHealth`, directly below the line `  if (h.exportSegmentMissing > 0) warn.push(item('export-segment-missing', …));` (lib.mjs:3695), add two lines (one of comment, one of code);
  - directly below `decideSegmentReplay`'s closing brace (its last statement is `  return meta.format > EXPORT_SEGMENT_FORMAT ? 'newer' : 'replay';`, lib.mjs:8512-8513), add one block: `decideSegmentWhole`, `decideSegmentOwn`, `readSegmentNameList`.
- Modify: `ccd/history/lib.d.mts`: directly below `export const EXPORT_SEGMENT_FORMAT: number;` (:940); directly below `export function decideSegmentReplay(…)` (:975); in `HealthInputs` directly below `  readonly exportSegmentMissing: number;` (:434); in `HEALTH_META`'s type directly below `  exportSegmentMissing: 'export_segment_missing';` (:452).
- Modify: `ccd/history/store.mjs`: its `from './lib.mjs'` import (store.mjs:27) gains `SEGMENT_HEADER_BYTES`; insert one block directly ABOVE `listSegments`' docstring, the line beginning `/** The published segments in \`dir\`, as regular files whose names parse` (store.mjs:2102).
- Modify: `ccd/history/store.d.mts`: its `import type { … } from './lib.mjs'` (:5) gains `SegmentFileFacts`; one declaration directly above `export function listSegments(…)` (:157).
- Modify: `ccd/history/sweep.mjs`:
  - the `from './lib.mjs'` import gains `decideSegmentWhole, decideSegmentOwn, readSegmentNameList` (a new line directly below the line beginning `  decideMarkCheck, missingSegmentNames, deadFileSourceKey,`, sweep.mjs:65); the `from './store.mjs'` import's line `  openSegment, segmentMeta, segmentBlobsAfter, segmentRowsAfter, segmentHasBlob,` (sweep.mjs:76) gains `segmentFileFacts`;
  - insert one block (two module-private functions) directly below `function bindFactKeys(db) { … }`'s closing brace (sweep.mjs:8739-8741);
  - in `checkSegmentMarks`, replace the two lines that list the segments as Task 1 leaves them: `  let present;` and `  try { present = listSegments(dir).map((x) => x.name); } catch (e) { throw new SegmentsUnlistable(e); }   // [] only for ENOENT` (at e4936efab the one statement `  const present = listSegments(dir).map((x) => x.name);   // [] only for a proven ENOENT; ENOTDIR, EACCES and the rest throw`, sweep.mjs:8759). Task 1 keeps this listing per step (R1: the missing set is recomputed each step, no cursor). After this edit `present`, which feeds `missingSegmentNames({ named, present })`, holds only the whole-and-own names, and a listing failure still throws `SegmentsUnlistable`.
- Modify: `ccd/history/cli.mjs`: in `readStoreExtras` and `readHealthExtras`, the two default literals that contain `exportSegmentNewer: [], exportSegmentMissing: 0, copyBps: null,` (cli.mjs:1162 and :1208); one `read(…)` statement directly below the `read(healthLib.HEALTH_META.exportSegmentMissing, …)` line (cli.mjs:1178); in `healthInputsOf`, one member directly below `    exportSegmentMissing: x.exportSegmentMissing,` (cli.mjs:1296).
- Not here: the spec. Its §9.6 WARN bullet, §9.10 row, §9.15 "After a bind" sentence and §9.15 "Who reads it" sentence for this rule are Task 7's (Step 7), citing D-5634.
- Test: `server/test/history-store.test.ts` (one describe appended at the end of the file, after :2818; it uses the module-scope `segStore`/`segLib` imports at :2361-2362 and the file's `spawnSync`, `randomBytes`, `fs`, `path`, `mkTmp`).
- Test: `server/test/history-lib.test.ts`: in place, the `base` fixture (:3675), the `live` fixture (:8558) and Task 2's `clean` fixture (in its describe `deriveHealth, W5h-1: a check after a bind that cannot finish (D-5633)`) each gain `exportSegmentDamaged: []` directly after `exportSegmentMissing: 0,` (the field is required, so a literal without it fails tsc and makes `deriveHealth` read `.length` of undefined); `WORD_CASES` gains one row directly below `    ['export-segment-missing', 'warn', { exportSegmentMissing: 2 }],` (:3725); one describe appended at the end of the file (after :8671; it uses the module-scope `libReplay` import at :44).
- Test: `server/test/history-export.test.ts` (one describe appended at the end of the file, after :2699; every helper it calls is already module scope: `ingestedBox`, `exportCtx`, `onStore`, `marks`, `q`, `metaOf`, `rid`, `row`, `SW`, `counters`, `exportDirOf`, `plantSegment`, `strandedBlobs`, `runCli`, `setMeta`, `HEALTH_META`, `vi`).
- Test: `server/test/ccrc-doctor.test.ts`: in place, `cleanInputs` (:14629) gains `exportSegmentDamaged: []`; `STATES` gains one row directly below the `export-segment-missing` row (:14417-14419).
- Test: `server/test/single-definition.test.ts`: in place, the history `VOCABS` list Task 1 extended gains `'SEGMENT_HEADER_BYTES'` (Global Constraints "Single definition"; B3's and B4's precedent for a numeric constant, `EXPORT_SEGMENT_FORMAT`).

**Interfaces:**
- Consumes:
  - Task 1's `checkSegmentMarks(db, ctx, record)` in its batched form (R1): per step it lists `export/<store_id>/` (a listing failure throws the module-private `SegmentsUnlistable`, which `exportStep` records `unlistable`), recomputes the missing set from the marked names and the listing through lib `missingSegmentNames({ named, present })`, and clears in bounded batches; this task changes only what `present` holds, and leaves the parameter list as Task 1 has it (Task 4 appends `listing`).
  - B4 `store.mjs`: `listSegments(dir)` (regular files whose names parse; throws on anything but ENOENT), `openSegment(path)` (read-only; `StoreError('segment-unreadable')` on any failure), `segmentMeta(db)` (`{ storeId, writer, seq, harnesses, cutoffMs, format }`, or `StoreError('segment-unreadable')`), `StoreError` (its `.word`), `withTx`, `bump(db, name, by = 1)`, `getMeta`, `setMeta`.
  - B4 `lib.mjs`: `segmentName({ seq, writer })`, `parseSegmentName(name)`, `orderSegmentNames(names)`, `EXPORT_DIR`, `HEALTH_META`, `HEALTH_WORDS`, `HEALTH_REMEDIES`, `deriveHealth(h)`; `decideSegmentReplay`'s store rule (`meta.storeId !== storeId` is `foreign`), which `decideSegmentOwn` repeats for the check.
  - B4 `cli.mjs`: `readStoreExtras`' `read(name, fn)` (a throw names `name` in `unmeasured`, which `deriveHealth` answers `status-unreadable`).
  - Test side: `historyHelpers`' `plantSegment(box, storeId, { seq, writer, metaStoreId, blobs, rows })` (W1-B4 Task 10), `runCli`, `strandedBlobs`.
- Produces:
  - `store.mjs`: `segmentFileFacts(path: string): SegmentFileFacts`, answering `{ size, magic, pageSize, pageCount, headerValid }` or `{ unreadable: <code> }` (`ELOOP` for a link, `not-a-regular-file` for a FIFO, device or directory, `ENOENT`, …); one open `O_RDONLY|O_NONBLOCK|O_NOCTTY|O_NOFOLLOW`, an fstat on the descriptor and a read of the first `SEGMENT_HEADER_BYTES` bytes; never a throw, never a write.
  - `lib.mjs`: `SEGMENT_HEADER_BYTES = 100`; `decideSegmentWhole(facts): 'whole' | 'short' | 'long' | 'not-sqlite' | 'header-invalid' | 'unreadable'`; `decideSegmentOwn({ meta, storeId, name }): 'own' | 'foreign' | 'renamed' | 'meta-unreadable'` (`meta` null when the open or meta read failed); `readSegmentNameList(v: string | null): string[]` (null is `[]`; a JSON list of segment names reads back; anything else throws `TypeError`); `HEALTH_META.exportSegmentDamaged = 'export_segment_damaged'` (a JSON list of names in `(seq, writer)` order); health word `export-segment-damaged` (warn) with its remedy; `HealthInputs.exportSegmentDamaged: readonly string[]`. `lib.d.mts` gains the types `SegmentFileFacts` and `SegmentWholeVerdict`.
  - `sweep.mjs` (module-private): `segmentsWholeAndOwn(dir, names, storeId): { present: string[]; damaged: Array<{ name; verdict }> }` and `noteSegmentsDamaged(db, dir, damaged)`; in `checkSegmentMarks`, `listed` holds every name `listSegments` gave, damaged ones included, and `present` only the whole-and-own ones. Task 4's listing record digests the same set as `listed` (every listed name, damaged ones included), measured by its own `listSegments` call in `exportStep`. Counter `export_segment_damaged` (+1 for each name that joins the record, never again while it stays recorded). One stderr line per newly recorded name: `history-sweep: export segment <name> in <dir> is <verdict>: its marks are cleared and its rows export again; it is left in place`.
  - `cli.mjs`: `status --json`'s health reads `HEALTH_META.exportSegmentDamaged` through `readSegmentNameList`. That is the check's own record, never a live header read: status still never opens a segment (R6).

**Spec:**
- §9.15 "After a bind" (the first tick checks that every segment a mark names is on this box; a missing one's marks clear so its rows export again); §9.15 "Who reads it" (the CLI never reads a segment); §9.6's WARN list; §9.10 "Export marks after a bind". The spec text is Task 7's (Step 7).
- Departure: NEW **D-5634** (`history-export-segment-whole-check`). §9.15 checks only that a marked segment is on this box. B4 compared names only (`present` from `listSegments` names, `missingSegmentNames` by name), so a carried file under a marked name counted as present and kept its marks, even when the file was cut short by a copy, was not SQLite at all, belonged to another store, or held another segment's bytes. A later `--restore` or `--rebuild` then stalls on it (D-4765 (`history-export-segment-unreadable-stalls`)). Now a listed segment counts as present only when it is whole (its length equals its own SQLite header's page size times page count, under a header SQLite trusts) and is this store's (its meta's `store_id`, under the name its seq and writer give). Any other listed segment is treated as missing, the over-clear direction and never a loss: its marks clear (with D-5395's and D-5396's referrers, through Task 1's batches) and its rows export again. It is counted, recorded for doctor, and left in place.
- Coordinator ruling R6, binding:
  - a segment counts only when whole and this store's, otherwise it is treated as missing;
  - doctor WARNs, from a meta record the check writes, and never a live header read in status;
  - the check never renames or removes anything;
  - `quick_check` stays out of the tick: it took 102 ms for 239 MiB with the file still in the page cache (scope measurement), and its cost grows with the whole export.
- R2 (D-4762): the header reads and the record write sit outside db/'s free-space floor, like the check they belong to. R3: the export pass still runs while a check is unfinished.
- Measured in the scope, on a real 1,724,416-byte segment:
  - the header test catches 0 bytes, 50 bytes, one page, half, one page short, 100 bytes short, 1 byte short, all zeros at the right length and a page appended; it misses only 8 KiB zeroed in the middle at the same length;
  - `openSegment` plus `segmentMeta` alone miss the 100-byte and 1-byte truncations;
  - cost per segment: 0.01 ms for the header read and 0.18 ms for open plus meta, warm.
- Plan choices (no further departure):
  - the verdicts are lib's (RD2); the sweep measures and acts;
  - only a `segment-unreadable` `StoreError` from the open or the meta read is a verdict (`meta-unreadable`); any other throw is a bug and reaches `exportStep`'s existing catch (`export_marks_check_failed`, retried);
  - the record is rewritten only when it changes, so a clean check writes nothing (the existing exact-meta cases keep their listings), and a check that finds no damage empties a record that held names;
  - a record that does not read back is rewritten whole by the sweep, and every name in it counts as new; status names that record `unmeasured` (`status-unreadable`) and never reads it as "nothing damaged" (no overloaded null).
- Residuals, named:
  - damage inside a file of the right length is not caught here; replay finds it (D-4765);
  - the WARN clears when a check runs after the files are moved out. Task 4's re-arm on a vanished segment makes that the next step; before Task 4, it is the next bind;
  - a tick during an operator's late carry now reads the half-copied file as `short` and clears its marks: a re-export, never a loss. The history-off advice on adopt's carry line (R11) covers it.
  - text the store pruned whose only copy is a damaged file is lost to that damage: the re-export carries the blob's stub, never its bytes. The WARN's remedy therefore asks for a whole copy back before the file is moved aside.

- [ ] **Step 1: Write the failing tests.** Four files.

In `server/test/history-store.test.ts`, append at the end of the file:

```ts

// ── W5h-1 Task 3: a carried segment counts only when it is whole (D-5634 (history-export-segment-whole-check)) ─────
describe('store.mjs segmentFileFacts and lib decideSegmentWhole: a segment file\'s length against its own SQLite header (W5h-1 Task 3; D-5634)', () => {
  const SID = '0189abcd-1234-4678-9abc-0000000000f3';
  const W = '0a1b2c3e';
  /** One published segment of `blobs` random 3 KiB blobs (several pages), built through createSegment, segmentInserts and
   *  publishSegment, as the export pass builds one. */
  const wholeSegment = (blobs = 8): { dir: string; file: string } => {
    const dir = segStore.ensureSegmentDir(path.join(mkTmp('ccrc-history-segwhole-'), segLib.EXPORT_DIR), SID);
    const name = segLib.segmentName({ seq: 1, writer: W });
    const seg = segStore.createSegment(dir, name, { storeId: SID, writer: W, seq: 1, harnesses: ['claude-code'], cutoffMs: 1_764_000_000_000, format: segLib.EXPORT_SEGMENT_FORMAT });
    const ins = segStore.segmentInserts(seg);
    for (let i = 0; i < blobs; i += 1) ins.blob({ sha256: new Uint8Array(32).fill(i + 1), codec: 'br5', raw_len: 3072, z: randomBytes(3072), pruned: false });
    expect(segStore.publishSegment(seg, dir, name)).toBe('linked');
    return { dir, file: path.join(dir, name) };
  };
  /** A copy of `file` beside it under `as`, cut or edited by `edit`. */
  const copyAs = (file: string, as: string, edit: (b: Buffer) => Buffer): string => {
    const out = path.join(path.dirname(file), as);
    fs.writeFileSync(out, edit(fs.readFileSync(file)));
    return out;
  };
  const verdictOf = (p: string): string => segLib.decideSegmentWhole(segStore.segmentFileFacts(p));

  it('a whole published segment: SQLite\'s magic, a header SQLite trusts, and page size × page count equal to its length; whole', () => {
    const { file } = wholeSegment();
    const facts = segStore.segmentFileFacts(file);
    if (facts.unreadable !== undefined) throw new Error(`the whole segment read unreadable: ${facts.unreadable}`);
    const size = fs.statSync(file).size;
    expect(facts.size).toBe(size);
    expect(facts.magic).toBe(true);
    expect(facts.headerValid).toBe(true);
    expect(facts.pageSize * facts.pageCount, 'the header\'s pages are the file\'s length').toBe(size);
    expect(facts.pageCount, 'CONTROL: the fixture spans several pages').toBeGreaterThan(4);
    expect(verdictOf(file)).toBe('whole');
  });

  it('a truncated copy at every length tried is short: 0, 50 and 99 bytes, one page, half, one page short, 100 bytes short and 1 byte short', () => {
    const { file } = wholeSegment();
    const size = fs.statSync(file).size;
    const page = fs.readFileSync(file).readUInt16BE(16);
    for (const keep of [0, 50, 99, page, Math.floor(size / 2), size - page, size - 100, size - 1]) {
      const cut = copyAs(file, `cut-${keep}`, (b) => b.subarray(0, keep));
      expect(verdictOf(cut), `kept ${keep} of ${size} bytes`).toBe('short');
    }
  });

  it('a page appended is long; all zeros at the same length and a file that is not SQLite are not-sqlite', () => {
    const { file } = wholeSegment();
    const page = fs.readFileSync(file).readUInt16BE(16);
    expect(verdictOf(copyAs(file, 'appended', (b) => Buffer.concat([b, Buffer.alloc(page)])))).toBe('long');
    expect(verdictOf(copyAs(file, 'zeros', (b) => Buffer.alloc(b.length)))).toBe('not-sqlite');
    expect(verdictOf(copyAs(file, 'text', () => Buffer.from('not a database at all, '.repeat(20))))).toBe('not-sqlite');
  });

  it('a header SQLite would not trust is header-invalid: the version-valid-for number off the change counter, a page count of 0, a page size that is not a power of two', () => {
    const { file } = wholeSegment();
    const edited = (as: string, at: number, write: (b: Buffer) => void): string => copyAs(file, as, (b) => {
      const c = Buffer.from(b);
      write(c);
      expect(c.equals(b), `CONTROL: ${as} changed a byte at ${at}`).toBe(false);
      return c;
    });
    expect(verdictOf(edited('valid-for', 92, (c) => c.writeUInt32BE((c.readUInt32BE(92) + 1) >>> 0, 92)))).toBe('header-invalid');
    expect(verdictOf(edited('no-pages', 28, (c) => c.writeUInt32BE(0, 28)))).toBe('header-invalid');
    expect(verdictOf(edited('odd-page', 16, (c) => c.writeUInt16BE(3000, 16)))).toBe('header-invalid');
  });

  it('a link, a FIFO, a directory and an absent name are unreadable, never followed or waited on; the measured file is never written', () => {
    const { dir, file } = wholeSegment();
    const before = fs.statSync(file);
    const link = path.join(dir, 'link');
    fs.symlinkSync(file, link);
    const fifo = path.join(dir, 'fifo');
    spawnSync('mkfifo', [fifo]);
    expect(fs.lstatSync(fifo).isFIFO(), 'CONTROL: the FIFO was made').toBe(true);
    fs.mkdirSync(path.join(dir, 'sub'));
    expect(segStore.segmentFileFacts(link)).toEqual({ unreadable: 'ELOOP' });
    expect(segStore.segmentFileFacts(fifo)).toEqual({ unreadable: 'not-a-regular-file' });
    expect(segStore.segmentFileFacts(path.join(dir, 'sub'))).toEqual({ unreadable: 'not-a-regular-file' });
    expect(segStore.segmentFileFacts(path.join(dir, 'absent'))).toEqual({ unreadable: 'ENOENT' });
    for (const p of [link, fifo, path.join(dir, 'sub'), path.join(dir, 'absent')]) expect(verdictOf(p), p).toBe('unreadable');
    const after = fs.statSync(file);
    expect([after.ino, after.size, after.mtimeMs]).toEqual([before.ino, before.size, before.mtimeMs]);
  });
});
```

In `server/test/history-lib.test.ts`:
- in the `base` fixture, in the `live` fixture and in Task 2's `clean` fixture, insert `exportSegmentDamaged: [],` directly after `exportSegmentMissing: 0,` (one occurrence in each, three in all: `…, exportSegmentNewer: [], exportSegmentMissing: 0,` becomes `…, exportSegmentNewer: [], exportSegmentMissing: 0, exportSegmentDamaged: [],`; first check `grep -c 'exportSegmentNewer: \[\], exportSegmentMissing: 0,' server/test/history-lib.test.ts` prints 3, and 0 afterwards);
- in `WORD_CASES`, insert directly below `    ['export-segment-missing', 'warn', { exportSegmentMissing: 2 }],`:

```ts
    ['export-segment-damaged', 'warn', { exportSegmentDamaged: ['2.0a1b2c3d.db'] }],
```

- append at the end of the file:

```ts

// ── W5h-1 Task 3: the verdicts over a carried segment (D-5634 (history-export-segment-whole-check)) ──────────────
describe('decideSegmentWhole, decideSegmentOwn and readSegmentNameList (W5h-1 Task 3; D-5634)', () => {
  const SID = '0189abcd-1234-4678-9abc-0000000000f3';
  const W = '0a1b2c3e';
  /** A whole 4 KiB-page file of 12 pages; each case changes one fact. */
  const whole = { size: 12 * 4096, magic: true, pageSize: 4096, pageCount: 12, headerValid: true } as const;
  const WHOLE_CASES: Array<[string, libReplay.SegmentFileFacts, libReplay.SegmentWholeVerdict]> = [
    ['whole', whole, 'whole'],
    ['unreadable', { unreadable: 'ELOOP' }, 'unreadable'],
    ['empty', { ...whole, size: 0, magic: false, pageSize: 0, pageCount: 0, headerValid: false }, 'short'],
    ['under the header', { ...whole, size: 99, headerValid: false }, 'short'],
    ['one page short', { ...whole, size: 11 * 4096 }, 'short'],
    ['one byte short', { ...whole, size: 12 * 4096 - 1 }, 'short'],
    ['one page long', { ...whole, size: 13 * 4096 }, 'long'],
    ['one byte long', { ...whole, size: 12 * 4096 + 1 }, 'long'],
    ['no magic', { ...whole, magic: false }, 'not-sqlite'],
    ['valid-for off the counter', { ...whole, headerValid: false }, 'header-invalid'],
    ['no pages', { ...whole, pageCount: 0, size: 4096 }, 'header-invalid'],
    ['page size not a power of two', { ...whole, pageSize: 3000, size: 12 * 3000 }, 'header-invalid'],
    ['page size under 512', { ...whole, pageSize: 256, size: 12 * 256 }, 'header-invalid'],
    ['the largest page size', { ...whole, pageSize: 65536, size: 12 * 65536 }, 'whole'],
  ];
  it.each(WHOLE_CASES)('decideSegmentWhole: %s', (_what, facts, want) => {
    expect(libReplay.decideSegmentWhole(facts)).toBe(want);
  });

  const meta = (o: Partial<{ storeId: string; seq: number; writer: string }> = {}) => ({ storeId: SID, seq: 3, writer: W, ...o });
  const own = `3.${W}.db`;
  const OWN_CASES: Array<[string, Parameters<typeof libReplay.decideSegmentOwn>[0], string]> = [
    ['own', { meta: meta(), storeId: SID, name: own }, 'own'],
    ['meta-unreadable', { meta: null, storeId: SID, name: own }, 'meta-unreadable'],
    ['foreign', { meta: meta({ storeId: '0189abcd-1234-4678-9abc-0000000000f4' }), storeId: SID, name: own }, 'foreign'],
    ['renamed: another seq\'s bytes under this name', { meta: meta({ seq: 2 }), storeId: SID, name: own }, 'renamed'],
    ['renamed: another writer\'s bytes under this name', { meta: meta({ writer: '0a1b2c3f' }), storeId: SID, name: own }, 'renamed'],
  ];
  it.each(OWN_CASES)('decideSegmentOwn: %s', (_what, input, want) => {
    expect(libReplay.decideSegmentOwn(input)).toBe(want);
  });

  it('readSegmentNameList: never written is []; a list of segment names reads back; anything else throws, never []', () => {
    expect(libReplay.readSegmentNameList(null)).toEqual([]);
    expect(libReplay.readSegmentNameList('[]')).toEqual([]);
    expect(libReplay.readSegmentNameList(JSON.stringify([own, `10.${W}.db`]))).toEqual([own, `10.${W}.db`]);
    for (const bad of ['', 'nope', '{}', '"3.0a1b2c3e.db"', '[3]', '["3.0a1b2c3e.db.tmp"]', '[null]']) {
      expect(() => libReplay.readSegmentNameList(bad), bad).toThrow(TypeError);
    }
  });
});
```

In `server/test/ccrc-doctor.test.ts`:
- in `cleanInputs`, `    exportSegmentNewer: [], exportSegmentMissing: 0, journalUnwritable: false,` becomes `    exportSegmentNewer: [], exportSegmentMissing: 0, exportSegmentDamaged: [], journalUnwritable: false,`;
- in `STATES`, insert directly below the row whose `word` is `'export-segment-missing'` (its last line is `      names: () => ['2'] },`):

```ts
    { word: 'export-segment-damaged', cls: 'WARN',
      plant: (home) => withStore(home, metaOnFreshTick(HEALTH_META.exportSegmentDamaged, JSON.stringify(['2.0a1b2c3d.db']))),
      names: () => ['2.0a1b2c3d.db'], remedyNames: () => ['move each named file out of'] },
```

In `server/test/single-definition.test.ts`, in the history `VOCABS` list, replace `'EXPORT_MARKS_STALL_MS', 'MARK_CHECK_WORDS'] as const;` (Task 1's line) with:

```ts
'EXPORT_MARKS_STALL_MS', 'MARK_CHECK_WORDS',
    // W5h-1 Task 3 (D-5634 (history-export-segment-whole-check)): SQLite's header length, which store.mjs segmentFileFacts reads and lib decideSegmentWhole compares.
    'SEGMENT_HEADER_BYTES'] as const;
```

In `server/test/history-export.test.ts`, append at the end of the file:

```ts

// ── W5h-1 Task 3: a carried segment counts only when it is whole and this store's (D-5634 (history-export-segment-whole-check)) ──
// An adopt carries export/<store_id>/ by hand, and the check after the bind used to compare NAMES only: a file cut short by a
// copy, a file that is not SQLite, another store's segment or another segment's bytes under a marked name counted as present,
// and its marks stood over text no segment on this box holds. Each case below exports two segments in-process, damages the
// second, plants a bind fact and runs one step: the damaged one is treated as missing and left exactly where it is.
describe('a carried segment counts only when it is whole and this store\'s (W5h-1 Task 3; spec §9.15 "After a bind"; D-5634)', () => {
  const OTHER_STORE = '0189abcd-1234-4678-9abc-0000000000f9';
  /** Rows 1 to 3 exported in two in-process passes: row 1 into segment 1 (a run budget of one byte bounds it), rows 2 and 3
   *  into segment 2 an hour later. Answers the box, its ids, the two names, a clock and the export directory. */
  async function twoSegments(prefix: string): Promise<{ box: HistoryBox; ids: { storeId: string; writer: string }; s1: string; s2: string; at: (ms: number) => () => number; dir: string }> {
    const { box, ids } = ingestedBox(prefix, [row(1, 'oldest', 3 * DAY), row(2, 'middle', 2 * DAY), row(3, 'newest', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0), { limits: { maxBytes: 1 } })));
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(HOUR))));
    expect(marks(box), 'CONTROL: row 1 in segment 1, rows 2 and 3 in segment 2').toEqual({ [rid(1)]: s1, [rid(2)]: s2, [rid(3)]: s2 });
    return { box, ids, s1, s2, at, dir: exportDirOf(box) };
  }
  /** Every name in the export directory with its inode, size and mtime: what the check must never change. */
  const listing = (dir: string): Array<[string, number, number, number]> =>
    fs.readdirSync(dir).sort().map((n) => { const st = fs.statSync(path.join(dir, n)); return [n, st.ino, st.size, st.mtimeMs]; });
  /** One step with a new bind fact at `bindMs`, run at `stepMs`, with stderr captured: the lines the check printed about a damaged segment. */
  async function bindStep(box: HistoryBox, ids: { storeId: string; writer: string }, at: (ms: number) => () => number, bindMs: number, stepMs: number): Promise<string[]> {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await onStore(box, async (db) => {
        setMeta(db, `bound:${at(bindMs)()}`, 'adopt');
        await SW.exportStep(db, exportCtx(box, ids, at(stepMs)));
      });
      return err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep: export segment '));
    } finally {
      err.mockRestore();
    }
  }

  const DAMAGE: Array<[string, string, (dir: string, s1: string, s2: string, box: HistoryBox, ids: { storeId: string; writer: string }) => void]> = [
    ['cut to half its length (a copy still running, or one that stopped)', 'short', (dir, _s1, s2) => {
      const p = path.join(dir, s2);
      fs.truncateSync(p, Math.floor(fs.statSync(p).size / 2));
    }],
    ['cut to 0 bytes', 'short', (dir, _s1, s2) => { fs.truncateSync(path.join(dir, s2), 0); }],
    ['a file that is not SQLite, at the same length', 'not-sqlite', (dir, _s1, s2) => {
      const p = path.join(dir, s2);
      fs.writeFileSync(p, Buffer.alloc(fs.statSync(p).size, 'x'));
    }],
    ['another store\'s segment under its name', 'foreign', (dir, _s1, s2, box, ids) => {
      fs.rmSync(path.join(dir, s2));
      plantSegment(box, ids.storeId, { seq: 2, writer: ids.writer, metaStoreId: OTHER_STORE, blobs: [{ text: 'another store\'s body' }], rows: [] });
    }],
    ['segment 1\'s bytes copied under segment 2\'s name (whole, this store\'s, but renamed)', 'renamed', (dir, s1, s2) => {
      fs.copyFileSync(path.join(dir, s1), path.join(dir, s2));
    }],
  ];
  for (const [what, verdict, damage] of DAMAGE) {
    it(`segment 2 ${what}: the check after a bind reads it ${verdict}, clears only the marks naming it, counts export_segment_damaged once, records its name for doctor, and leaves export/ as it was; the next pass exports its rows again`, async () => {
      const { box, ids, s1, s2, at, dir } = await twoSegments(`ccrc-history-export-segdmg-${verdict}-`);
      damage(dir, s1, s2, box, ids);
      const before = listing(dir);
      const lines = await bindStep(box, ids, at, HOUR + MIN, HOUR + 2 * MIN);   // the cadence waits (last pass at +1 h): only the check runs
      expect(marks(box), 'a mark still names a segment that is not whole or not this store\'s').toEqual({ [rid(1)]: s1, [rid(2)]: null, [rid(3)]: null });
      expect(q(box, 'SELECT DISTINCT exported_seg AS seg FROM blobs WHERE exported_seg IS NOT NULL').map((r) => r['seg'])).toEqual([s1]);
      expect(counters(box)['export_segment_damaged']).toBe(1);
      expect(counters(box)['export_segment_missing'], 'its marks were cleared as a missing segment\'s are').toBe(1);
      expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe(JSON.stringify([s2]));
      expect(lines, 'one line, naming the segment, its directory and its verdict').toEqual([
        `history-sweep: export segment ${s2} in ${dir} is ${verdict}: its marks are cleared and its rows export again; it is left in place\n`,
      ]);
      expect(listing(dir), 'the check renamed, removed or wrote something under export/').toEqual(before);
      expect(strandedBlobs(box)).toEqual([]);
      await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(2 * HOUR + 3 * MIN))));
      const s3 = `3.${ids.writer}.db`;
      expect(marks(box), 'rows 2 and 3 export again, into the next number past the damaged name').toEqual({ [rid(1)]: s1, [rid(2)]: s3, [rid(3)]: s3 });
      expect(strandedBlobs(box)).toEqual([]);
    }, 120_000);
  }

  it('CONTROL: two whole segments of this store stay present: the check clears nothing, counts nothing and writes no record', async () => {
    const { box, ids, s1, s2, at } = await twoSegments('ccrc-history-export-segwhole-');
    const lines = await bindStep(box, ids, at, HOUR + MIN, HOUR + 2 * MIN);
    expect(metaOf(box, 'export_marks_checked_ms'), 'CONTROL: the check ran').toBe(String(at(HOUR + 2 * MIN)()));
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2, [rid(3)]: s2 });
    expect(counters(box)['export_segment_damaged']).toBeUndefined();
    expect(counters(box)['export_segment_missing']).toBeUndefined();
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged), 'a clean check writes no record').toBeNull();
    expect(lines).toEqual([]);
  }, 120_000);

  it('the record follows the files: a later check counts and prints only a name it has not recorded; once the damaged files are moved out of export/<store_id>/, the next check empties the record', async () => {
    const { box, ids, s1, s2, at, dir } = await twoSegments('ccrc-history-export-segrecord-');
    fs.truncateSync(path.join(dir, s2), 0);
    await bindStep(box, ids, at, HOUR + MIN, HOUR + 2 * MIN);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged)).toBe(JSON.stringify([s2]));
    // segment 1 is cut too; segment 2 is still in place, still damaged, and already recorded
    fs.truncateSync(path.join(dir, s1), 0);
    const again = await bindStep(box, ids, at, HOUR + 3 * MIN, HOUR + 4 * MIN);
    expect(again, 'one line, for the name not yet recorded').toEqual([
      `history-sweep: export segment ${s1} in ${dir} is short: its marks are cleared and its rows export again; it is left in place\n`,
    ]);
    expect(counters(box)['export_segment_damaged'], 'a name already recorded is not counted again').toBe(2);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged), 'in (seq, writer) order').toBe(JSON.stringify([s1, s2]));
    expect(marks(box)).toEqual({ [rid(1)]: null, [rid(2)]: null, [rid(3)]: null });
    for (const s of [s1, s2]) fs.renameSync(path.join(dir, s), path.join(box.home, `${s}.aside`));   // the remedy: out of export/<store_id>/
    await bindStep(box, ids, at, HOUR + 5 * MIN, HOUR + 6 * MIN);
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged), 'the WARN clears once the files are out and a check runs').toBe('[]');
    expect(counters(box)['export_segment_damaged']).toBe(2);
  }, 120_000);

  it('status reads the check\'s record and never a segment: the WARN export-segment-damaged names it; a record that does not read back is status-unreadable, never "nothing damaged"', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-segstatus-', [row(1, 'one', DAY)]);
    type Health = { health: { warn: Array<{ word: string; detail: string; remedy: string }>; fail: Array<{ word: string; detail: string }> } };
    const status = (): Health => {
      const r = runCli(box, ['status', '--json']);
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
      return r.json as unknown as Health;
    };
    const name = `2.${ids.writer}.db`;
    await onStore(box, (db) => setMeta(db, HEALTH_META.exportSegmentDamaged, JSON.stringify([name])));
    const warned = status().health.warn.find((i) => i.word === 'export-segment-damaged');
    expect(warned?.detail).toContain(name);
    expect(warned?.remedy).toContain('move each named file out of');
    await onStore(box, (db) => setMeta(db, HEALTH_META.exportSegmentDamaged, 'not a list'));
    const h = status().health;
    expect(h.warn.map((i) => i.word)).not.toContain('export-segment-damaged');
    expect(h.fail.map((i) => i.word), 'a record that does not read back was read as "nothing damaged"').toContain('status-unreadable');
    expect(h.fail.find((i) => i.word === 'status-unreadable')!.detail).toContain(HEALTH_META.exportSegmentDamaged);
    await onStore(box, (db) => setMeta(db, HEALTH_META.exportSegmentDamaged, '[]'));
    const clean = status().health;
    expect(clean.warn.map((i) => i.word)).not.toContain('export-segment-damaged');
    expect(clean.fail.map((i) => i.word)).not.toContain('status-unreadable');
  }, 120_000);
});
```

- [ ] **Step 2: Run them and see them fail.** From inside `server/`, each in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-store.test.ts -t 'W5h-1 Task 3'
./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W5h-1 Task 3|export-segment-damaged|every HEALTH_WORDS member|HEALTH_REMEDIES names exactly'
./node_modules/.bin/vitest run test/history-export.test.ts -t 'W5h-1 Task 3'
./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'export-segment-damaged'
./node_modules/.bin/vitest run test/single-definition.test.ts -t 'SEGMENT_HEADER_BYTES is declared'
```

Expected (measured at e4936efab with only this task's tests added, except the single-definition line, which is predicted; with Tasks 1 and 2 applied the reds are the same in kind, predicted):
- `history-store`: all 5 cases fail with `TypeError: … segmentFileFacts is not a function`.
- `history-lib`: 22 cases fail and `HEALTH_REMEDIES names exactly` stays green (nothing new on either side yet):
  - the 20 cases of the new describe (14 `WHOLE_CASES` rows, 5 `OWN_CASES` rows and the `readSegmentNameList` case) fail with `TypeError: … decideSegmentWhole is not a function`, `… decideSegmentOwn is not a function` or `… readSegmentNameList is not a function`;
  - `export-segment-damaged is produced, in its class (warn)` fails with `{"pass":"ok","warn":[],"fail":[]}: expected [] to include 'export-segment-damaged'`;
  - `every HEALTH_WORDS member has a producing case` fails with `expected [ 'at-cap', 'blob-undecodable', …(N+1) ] to deeply equal [ 'at-cap', 'blob-undecodable', …(N) ]`: one case more than `HEALTH_WORDS` has words.
- `history-export`: 8 cases fail:
  - each of the five damage cases fails with `a mark still names a segment that is not whole or not this store's: expected { …(3) } to deeply equal { …(3) }`, because the names-only check keeps the marks naming segment 2;
  - the CONTROL, record and status cases fail with `TypeError: Provided value cannot be bound to SQLite parameter 1.`, because `HEALTH_META.exportSegmentDamaged` is still undefined.
- `ccrc-doctor`: `export-segment-damaged` fails with `TypeError: Provided value cannot be bound to SQLite parameter 1.`
- `single-definition`: the one `SEGMENT_HEADER_BYTES` case fails: lib.mjs does not declare it yet (predicted).

- [ ] **Step 3: lib: the two verdicts, the record's reader, the meta key and the WARN.** In `ccd/history/lib.mjs`, directly below `export const EXPORT_SEGMENT_FORMAT = 1;`:

```js
/** SQLite's database header, the first 100 bytes of every database file: store.mjs segmentFileFacts reads this much of a
 *  segment, and a shorter segment is short (decideSegmentWhole). D-5634 (history-export-segment-whole-check). */
export const SEGMENT_HEADER_BYTES = 100;
```

In `HEALTH_META`, directly below `  exportSegmentMissing: 'export_segment_missing',`:

```js
  // D-5634 (history-export-segment-whole-check): the listed segments the last check after a bind found not whole or not this
  // store's (a JSON list of names, in (seq, writer) order), read back by readSegmentNameList.
  exportSegmentDamaged: 'export_segment_damaged',
```

In `healthEntries`' warn row, `    'export-segment-missing', 'journal-record-skipped', 'journal-growth', 'blob-undecodable',` becomes `    'export-segment-missing', 'export-segment-damaged', 'journal-record-skipped', 'journal-growth', 'blob-undecodable',`.

In `HEALTH_REMEDIES`, directly below `  'export-segment-missing': 'carry the export directory from the box the store came from, or let the rows export again',`:

```js
  'export-segment-damaged': `put a whole copy of each named file back if one exists (the source box or a backup): text the store pruned that only that file held cannot be exported again; otherwise move each named file out of ~/.ccrc/history/${EXPORT_DIR}/<store_id>/ (its live rows export again by themselves); a later ccrc history doctor --restore or --rebuild stops at a segment it cannot read`,
```

In `deriveHealth`, directly below `  if (h.exportSegmentMissing > 0) warn.push(item('export-segment-missing', `${h.exportSegmentMissing} export mark(s) named a segment not on this box and were cleared`));`:

```js
  // D-5634 (history-export-segment-whole-check): a listed segment the check after a bind found not whole or not this store's.
  if (h.exportSegmentDamaged.length > 0) warn.push(item('export-segment-damaged', `export segment(s) ${h.exportSegmentDamaged.join(', ')} are not whole or not this store's; the check after a bind treated them as missing, so their marks were cleared and their rows export again`));
```

Directly below `decideSegmentReplay`'s closing brace:

```js

// ── W5h-1 Task 3: a carried segment counts only when it is whole and this store's (§9.15 "After a bind"; D-5634
// (history-export-segment-whole-check)). store.mjs segmentFileFacts measures a segment file's length and its SQLite
// header without opening it; the two verdicts below judge those facts and the meta a whole file then gives. The check
// after a bind (sweep.mjs checkSegmentMarks) counts a listed name present only when both answer whole and own; any
// other name is treated as missing, so its marks clear and its rows export again. Nothing here renames or removes it.

/** Whether a segment file is whole, from store.mjs segmentFileFacts: `unreadable` when it could not be measured;
 *  `short` when it is shorter than SQLite's header, or than the page size times the in-header page count; `not-sqlite`
 *  when it does not begin with SQLite's magic (a file of zeros, or another kind of file); `header-invalid` when the
 *  header's page count is not one SQLite trusts (its version-valid-for number differs from its change counter, or it is
 *  0) or its page size is not a power of two from 512 to 65536; `long` when it is longer than those pages; `whole`
 *  otherwise. A length check only: damage inside a file of the right length is not seen here (only quick_check or
 *  replay sees it, and neither runs in the tick). */
export function decideSegmentWhole(facts) {
  if (facts.unreadable !== undefined) return 'unreadable';
  if (facts.size < SEGMENT_HEADER_BYTES) return 'short';
  if (!facts.magic) return 'not-sqlite';
  const ps = facts.pageSize;
  if (!facts.headerValid || !(facts.pageCount > 0) || !(ps >= 512 && ps <= 65536 && (ps & (ps - 1)) === 0)) return 'header-invalid';
  const expect = ps * facts.pageCount;
  if (facts.size < expect) return 'short';
  if (facts.size > expect) return 'long';
  return 'whole';
}

/** Whether a whole segment file is this store's, under its own name, from the meta store.mjs segmentMeta read back
 *  (`meta`), or null when that open or read failed: `meta-unreadable`; `foreign` when its store_id is not this store's
 *  (decideSegmentReplay's rule); `renamed` when the name its seq and writer give is not the name it is listed under (a
 *  copy of another segment, or a file moved between names); `own` otherwise. */
export function decideSegmentOwn({ meta, storeId, name }) {
  if (meta === null) return 'meta-unreadable';
  if (meta.storeId !== storeId) return 'foreign';
  return segmentName({ seq: meta.seq, writer: meta.writer }) === name ? 'own' : 'renamed';
}

/** HEALTH_META.exportSegmentDamaged read back: null (never written) is []; otherwise a JSON list of segment names
 *  (parseSegmentName's grammar). Anything else throws, so status names the key unmeasured and never reads a damaged
 *  record as "nothing damaged". */
export function readSegmentNameList(v) {
  if (v === null) return [];
  let a;
  try { a = JSON.parse(v); } catch { a = null; }
  if (!Array.isArray(a) || !a.every((n) => parseSegmentName(n) !== null)) throw new TypeError(`not a list of segment names: ${JSON.stringify(v)}`);
  return a;
}
```

In `ccd/history/lib.d.mts`, directly below `export const EXPORT_SEGMENT_FORMAT: number;`:

```ts
export const SEGMENT_HEADER_BYTES: 100;
```

Directly below `export function decideSegmentReplay(i: { meta: { storeId: string; format: number }; storeId: string }): 'replay' | 'newer' | 'foreign';`:

```ts
/** W5h-1 Task 3 (D-5634): store.mjs segmentFileFacts' answer, and the two verdicts over it. */
export type SegmentFileFacts =
  | { readonly size: number; readonly magic: boolean; readonly pageSize: number; readonly pageCount: number; readonly headerValid: boolean; readonly unreadable?: undefined }
  | { readonly unreadable: string };
export type SegmentWholeVerdict = 'whole' | 'short' | 'long' | 'not-sqlite' | 'header-invalid' | 'unreadable';
export function decideSegmentWhole(facts: SegmentFileFacts): SegmentWholeVerdict;
export function decideSegmentOwn(i: { meta: { storeId: string; seq: number; writer: string } | null; storeId: string; name: string }): 'own' | 'foreign' | 'renamed' | 'meta-unreadable';
export function readSegmentNameList(v: string | null): string[];
```

In `HealthInputs`, directly below `  readonly exportSegmentMissing: number;`:

```ts
  /** D-5634: the listed segments the last check after a bind found not whole or not this store's (HEALTH_META.exportSegmentDamaged). */
  readonly exportSegmentDamaged: readonly string[];
```

In `HEALTH_META`'s type, directly below `  exportSegmentMissing: 'export_segment_missing';`:

```ts
  exportSegmentDamaged: 'export_segment_damaged';
```

- [ ] **Step 4: store.mjs: the header measurement.** In `ccd/history/store.mjs`, its `from './lib.mjs'` import's `RECOVER_PHASES, SCHEMA_VERSION, SIDECAR_WHOLE_MAX,` becomes `RECOVER_PHASES, SCHEMA_VERSION, SEGMENT_HEADER_BYTES, SIDECAR_WHOLE_MAX,`. Insert directly ABOVE `listSegments`' docstring (`/** The published segments in \`dir\`, as regular files whose names parse, …`):

```js
/** The 16 bytes every SQLite database file begins with: "SQLite format 3" and a NUL. */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/** What a segment file says about its own length, read WITHOUT opening it as a database (§9.15 "After a bind"; D-5634
 *  (history-export-segment-whole-check)): ONE open with O_RDONLY|O_NONBLOCK|O_NOCTTY|O_NOFOLLOW, the type and size taken
 *  from the DESCRIPTOR (readBounded's rule: a link is refused, ELOOP, and a FIFO or a device is never waited on), then
 *  the first SEGMENT_HEADER_BYTES bytes, SQLite's database header. `size` is the file's length; `magic` whether it
 *  begins with SQLite's 16 magic bytes; `pageSize` the header's page size (offset 16, big-endian; the stored 1 means
 *  65536); `pageCount` its in-header page count (offset 28); `headerValid` whether the whole header was read and its
 *  version-valid-for number (offset 92) equals its change counter (offset 24), the condition under which SQLite itself
 *  trusts that page count. A field past the bytes read is 0. Measurements only: lib decideSegmentWhole judges them.
 *  `{ unreadable: <code> }` when the file cannot be opened or read, or is not a regular file; never a throw, and nothing
 *  is ever written, renamed or removed. */
export function segmentFileFacts(path) {
  let fd;
  try {
    fd = openSync(path, FS.O_RDONLY | FS.O_NONBLOCK | FS.O_NOCTTY | FS.O_NOFOLLOW);
  } catch (e) {
    return { unreadable: e && e.code ? String(e.code) : String(e) };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { unreadable: 'not-a-regular-file' };
    const head = Buffer.alloc(SEGMENT_HEADER_BYTES);
    let n = 0;
    while (n < SEGMENT_HEADER_BYTES) {
      const r = readSync(fd, head, n, SEGMENT_HEADER_BYTES - n, n);
      if (r === 0) break;
      n += r;
    }
    const raw = n >= 18 ? head.readUInt16BE(16) : 0;
    return {
      size: st.size,
      magic: n >= SQLITE_MAGIC.length && head.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC),
      pageSize: raw === 1 ? 65536 : raw,
      pageCount: n >= 32 ? head.readUInt32BE(28) : 0,
      headerValid: n === SEGMENT_HEADER_BYTES && head.readUInt32BE(92) === head.readUInt32BE(24),
    };
  } catch (e) {
    return { unreadable: e && e.code ? String(e.code) : String(e) };
  } finally {
    closeSync(fd);
  }
}

```

`openSync`, `fstatSync`, `readSync`, `closeSync` and `FS` are already in store.mjs's `node:fs` import. In `ccd/history/store.d.mts`, `import type { FkRow, MigrationVerdict, PairIndex, Presence, StoreFacts } from './lib.mjs';` becomes `import type { FkRow, MigrationVerdict, PairIndex, Presence, SegmentFileFacts, StoreFacts } from './lib.mjs';`, and directly above `export function listSegments(dir: string): …`:

```ts
export function segmentFileFacts(path: string): SegmentFileFacts;
```

- [ ] **Step 5: sweep: present only when whole and own; the damaged names recorded.** In `ccd/history/sweep.mjs`, directly below the lib import line that begins `  decideMarkCheck, missingSegmentNames, deadFileSourceKey,`, add the line:

```js
  decideSegmentWhole, decideSegmentOwn, readSegmentNameList,
```

and in the store import, `  openSegment, segmentMeta, segmentBlobsAfter, segmentRowsAfter, segmentHasBlob,` becomes `  openSegment, segmentMeta, segmentBlobsAfter, segmentRowsAfter, segmentHasBlob, segmentFileFacts,`. `StoreError`, `bump`, `withTx`, `getMeta`, `setMeta`, `HEALTH_META` and `orderSegmentNames` are already imported.

Insert directly below `function bindFactKeys(db) { … }`'s closing brace:

```js

/** W5h-1 Task 3 (D-5634 (history-export-segment-whole-check)): which of the listed segment names count as present. A name
 *  counts only when lib decideSegmentWhole answers `whole` over store.mjs segmentFileFacts (its length agrees with its
 *  SQLite header) and lib decideSegmentOwn answers `own` over the meta openSegment and segmentMeta read back (this store's
 *  store_id, under the name its seq and writer give). Every other listed name is `damaged`, with the verdict that failed
 *  it, and the caller treats it as missing. A header read and one read-only open per listed segment; no quick_check (its
 *  cost grows with the whole export). Only a segment-unreadable StoreError is a verdict; any other throw is a bug and
 *  propagates, so exportStep counts the check failed and it runs again. Nothing under export/ is written, renamed or
 *  removed here. */
function segmentsWholeAndOwn(dir, names, storeId) {
  const present = [];
  const damaged = [];
  for (const name of names) {
    const p = `${dir}/${name}`;
    let verdict = decideSegmentWhole(segmentFileFacts(p));
    if (verdict === 'whole') {
      let meta = null;
      try {
        const h = openSegment(p);
        try { meta = segmentMeta(h); } finally { h.close(); }
      } catch (e) {
        if (!(e instanceof StoreError && e.word === 'segment-unreadable')) throw e;
      }
      verdict = decideSegmentOwn({ meta, storeId, name });
    }
    if (verdict === 'own') present.push(name);
    else damaged.push({ name, verdict });
  }
  return { present, damaged };
}

/** The damaged names this check found, recorded for doctor (HEALTH_META.exportSegmentDamaged, a JSON list in (seq, writer)
 *  order; lib readSegmentNameList reads it back), in one NORMAL transaction of its own, and only when the record changes:
 *  each name not already recorded counts export_segment_damaged once and prints one stderr line naming its verdict. A
 *  check that finds none empties a record that held some, so doctor's WARN clears once the files are moved out and a
 *  check runs. A record that does not read back is rewritten whole, every name in it counted as new. */
function noteSegmentsDamaged(db, dir, damaged) {
  const names = orderSegmentNames(damaged.map((d) => d.name));
  const text = JSON.stringify(names);
  const was = getMeta(db, HEALTH_META.exportSegmentDamaged);
  if ((was ?? '[]') === text) return;
  let before;
  try { before = new Set(readSegmentNameList(was)); } catch { before = new Set(); }
  const fresh = damaged.filter((d) => !before.has(d.name));
  withTx(db, 'NORMAL', () => {
    if (fresh.length > 0) bump(db, 'export_segment_damaged', fresh.length);
    setMeta(db, HEALTH_META.exportSegmentDamaged, text);
  });
  for (const d of fresh) {
    process.stderr.write(`history-sweep: export segment ${d.name} in ${dir} is ${d.verdict}: its marks are cleared and its rows export again; it is left in place\n`);
  }
}
```

In `checkSegmentMarks`, replace Task 1's two listing lines

```js
  let present;
  try { present = listSegments(dir).map((x) => x.name); } catch (e) { throw new SegmentsUnlistable(e); }   // [] only for ENOENT
```

with:

```js
  let listed;
  try { listed = listSegments(dir).map((x) => x.name); } catch (e) { throw new SegmentsUnlistable(e); }   // [] only for ENOENT
  // D-5634 (history-export-segment-whole-check): a listed name is present only when whole and this store's; a damaged one is
  // treated as missing (its marks clear, its rows export again) and recorded for doctor, and stays where it is.
  const { present, damaged } = segmentsWholeAndOwn(dir, listed, ctx.ids.storeId);
  noteSegmentsDamaged(db, dir, damaged);
```

Nothing else in Task 1's batches changes. The missing set Task 1 builds from `present` now includes the damaged names, so their marks and their referrers clear in its bounded batches like an absent segment's. These lines run once per step that checks, before Task 1's first `markCheckStop` probe. Their cost is the header read and one read-only open per listed segment (0.01 ms and 0.18 ms per segment, warm, measured in the scope). Then run `node --check ccd/history/sweep.mjs` from the repository root, and confirm that the sweep spells no header offset of its own (RD2): `grep -nE "readUInt(16|32)BE|SQLite format 3" ccd/history/sweep.mjs || echo 'the header is store.mjs and lib.mjs only'` must print the `echo` line.

- [ ] **Step 6: cli: status reads the record.** In `ccd/history/cli.mjs`, each of the two default literals that contains `exportSegmentNewer: [], exportSegmentMissing: 0, copyBps: null,` becomes `exportSegmentNewer: [], exportSegmentMissing: 0, exportSegmentDamaged: [], copyBps: null,`. Directly below `    read(healthLib.HEALTH_META.exportSegmentMissing, () => { x.exportSegmentMissing = intOf(meta(healthLib.HEALTH_META.exportSegmentMissing)); });`:

```js
    // D-5634: the check's own record, never a live header read (segments are never opened here); a record that does not read
    // back throws, so it is named unmeasured and never read as "nothing damaged".
    read(healthLib.HEALTH_META.exportSegmentDamaged, () => { x.exportSegmentDamaged = healthLib.readSegmentNameList(meta(healthLib.HEALTH_META.exportSegmentDamaged)); });
```

In `healthInputsOf`, directly below `    exportSegmentMissing: x.exportSegmentMissing,`:

```js
    exportSegmentDamaged: x.exportSegmentDamaged,
```

Then `node --check ccd/history/cli.mjs`.

- [ ] **Step 7: The spec is Task 7's.** No edit here. Task 7's Step 7 adds this rule's §9.15 "After a bind" sentence, its §9.6 WARN bullet and its §9.10 row, each citing D-5634.

- [ ] **Step 8: Run and see it pass.** From inside `server/`, each in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-store.test.ts
./node_modules/.bin/vitest run test/history-lib.test.ts
./node_modules/.bin/vitest run test/history-export.test.ts
./node_modules/.bin/vitest run test/history-cli.test.ts
./node_modules/.bin/vitest run test/history-recover.test.ts
./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'export-segment'
./node_modules/.bin/vitest run test/single-definition.test.ts
node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected: every case green, tsc silent. Measured at e4936efab with this task alone:
- history-store: 137 passed;
- history-lib: 1104;
- history-export: 92;
- history-cli: 72 passed and 1 skipped;
- history-recover: 139;
- six `export-segment` doctor cases: the three `STATES` rows (`export-segment-newer`, `-missing` and `-damaged`) and the relay describe's three rows for the same words, which iterate `HEALTH_WORDS` and so gain the new word;
- tsc reports nothing in a history file.

With Tasks 1 and 2 applied the counts grow by their own cases. `history-recover` runs because its adopt, restore and rebuild cases meet the check on their first tick after the bind. Their segments are whole and the store's own, so the check records nothing, and their exact meta listings are unchanged.

- [ ] **Step 9: Mutations: each new guard reds its case.** From the repository root, `SCRATCH="$PWD/.superpowers/sdd/history-w5h1/scratch"; mkdir -p "$SCRATCH"` (the plan's scratch directory, Global Constraints "Red-first"), then `for f in lib.mjs store.mjs sweep.mjs cli.mjs; do cp "ccd/history/$f" "$SCRATCH/$f.t3"; done`. Apply each mutation by hand. Run it from inside `server/` with `./node_modules/.bin/vitest run <file> -t '<filter>'` and see it red, then restore the file with `cp "$SCRATCH/<f>.t3" ccd/history/<f>` before the next one. Never `git stash`. Every row was measured red at e4936efab with this task applied:

In the table below, `\|` is Markdown's escape for a pipe inside a cell: type `|`, so `\|\|` is `||`. A filter or a mutation text copied from the raw file keeps no backslash before a pipe. The two filters that alternate are also given unescaped in the block after the table.

| # | File | Mutation | Test file, `-t` filter | Expected red |
|---|---|---|---|---|
| 1 | store.mjs | in `segmentFileFacts`, drop ` \| FS.O_NOFOLLOW` from the open's flags (a link followed) | `test/history-store.test.ts`, `never followed or waited on` | `expected { size: …, magic: true, …(3) } to deeply equal { unreadable: 'ELOOP' }` |
| 2 | store.mjs | delete `    if (!st.isFile()) return { unreadable: 'not-a-regular-file' };` | `test/history-store.test.ts`, `never followed or waited on` | `expected { unreadable: 'ESPIPE' } to deeply equal { unreadable: 'not-a-regular-file' }` (the FIFO) |
| 3 | store.mjs | `headerValid: n === SEGMENT_HEADER_BYTES && head.readUInt32BE(92) === head.readUInt32BE(24),` becomes `headerValid: n === SEGMENT_HEADER_BYTES,` | `test/history-store.test.ts`, `a header SQLite would not trust` | `expected 'whole' to be 'header-invalid'` |
| 4 | lib.mjs | delete `  if (facts.unreadable !== undefined) return 'unreadable';` | `test/history-lib.test.ts`, `decideSegmentWhole` | `decideSegmentWhole: unreadable`: `expected 'not-sqlite' to be 'unreadable'` |
| 5 | lib.mjs | delete `  if (facts.size < SEGMENT_HEADER_BYTES) return 'short';` | `test/history-lib.test.ts`, `decideSegmentWhole` | `empty`: `expected 'not-sqlite' to be 'short'`; `under the header`: `expected 'header-invalid' to be 'short'` |
| 6 | lib.mjs | delete `  if (!facts.magic) return 'not-sqlite';` | `test/history-lib.test.ts`, `decideSegmentWhole` | `no magic`: `expected 'whole' to be 'not-sqlite'` |
| 7 | lib.mjs | `  if (!facts.headerValid \|\| !(facts.pageCount > 0) \|\|` becomes `  if (!(facts.pageCount > 0) \|\|` | `test/history-lib.test.ts`, `decideSegmentWhole` | `valid-for off the counter`: `expected 'whole' to be 'header-invalid'` |
| 8 | lib.mjs | `  if (!facts.headerValid \|\| !(facts.pageCount > 0) \|\|` becomes `  if (!facts.headerValid \|\|` | `test/history-lib.test.ts`, `decideSegmentWhole` | `no pages`: `expected 'long' to be 'header-invalid'` |
| 9 | lib.mjs | ` \|\| !(ps >= 512 && ps <= 65536 && (ps & (ps - 1)) === 0)) return 'header-invalid';` becomes `) return 'header-invalid';` | `test/history-lib.test.ts`, `decideSegmentWhole` | `page size not a power of two` and `page size under 512`: `expected 'whole' to be 'header-invalid'` |
| 10 | lib.mjs | delete `  if (facts.size < expect) return 'short';` | `test/history-lib.test.ts`, `decideSegmentWhole` | `one page short` and `one byte short`: `expected 'whole' to be 'short'` |
| 11 | lib.mjs | delete `  if (facts.size > expect) return 'long';` | `test/history-lib.test.ts`, `decideSegmentWhole` | `one page long` and `one byte long`: `expected 'whole' to be 'long'` |
| 12 | lib.mjs | delete `  if (meta === null) return 'meta-unreadable';` | `test/history-lib.test.ts`, `decideSegmentOwn` | `meta-unreadable`: `TypeError: Cannot read properties of null (reading 'storeId')` |
| 13 | lib.mjs | in `decideSegmentOwn`, delete `  if (meta.storeId !== storeId) return 'foreign';` | `test/history-lib.test.ts`, `decideSegmentOwn` | `foreign`: `expected 'own' to be 'foreign'` |
| 14 | lib.mjs | `=== name ? 'own' : 'renamed';` becomes `!== null ? 'own' : 'renamed';` | `test/history-lib.test.ts`, `decideSegmentOwn` | both `renamed` cases: `expected 'own' to be 'renamed'` |
| 15 | lib.mjs | in `readSegmentNameList`, the `throw new TypeError(…)` becomes `return [];` (malformed folded to "nothing damaged") | `test/history-lib.test.ts`, `readSegmentNameList` | `expected function to throw an error, but it didn't` |
| 16 | lib.mjs | `  if (h.exportSegmentDamaged.length > 0) warn.push(` becomes `  if (false) warn.push(` | `test/history-lib.test.ts`, `export-segment-damaged is produced` | `{"pass":"ok","warn":[],"fail":[]}: expected [] to include 'export-segment-damaged'` |
| 17 | sweep.mjs | names only again: `  const { present, damaged } = segmentsWholeAndOwn(dir, listed, ctx.ids.storeId);` becomes the two lines `  const present = listed;` and `  const damaged = [];` | `test/history-export.test.ts`, `segment 2 cut to half its length` | `a mark still names a segment that is not whole or not this store's: expected { …(3) } to deeply equal { …(3) }` |
| 18 | sweep.mjs | skip the identity: `      verdict = decideSegmentOwn({ meta, storeId, name });` becomes `      verdict = 'own';` | `test/history-export.test.ts`, `segment 2 another store\|segment 2 segment 1` | the foreign and renamed cases: `a mark still names a segment that is not whole or not this store's: …` |
| 19 | sweep.mjs | skip the length: `    let verdict = decideSegmentWhole(segmentFileFacts(p));` becomes `    let verdict = 'whole';` | `test/history-export.test.ts`, `segment 2 cut\|segment 2 a file that is not` | the three cases: `one line, naming the segment, its directory and its verdict: expected [ Array(1) ] to deeply equal [ Array(1) ]` (each now reads `meta-unreadable`, not its length verdict) |
| 20 | sweep.mjs | count every damaged name every time: `  const fresh = damaged.filter((d) => !before.has(d.name));` becomes `  const fresh = damaged;` | `test/history-export.test.ts`, `the record follows the files` | `one line, for the name not yet recorded: expected [ …(2) ] to deeply equal [ Array(1) ]` |
| 21 | sweep.mjs | never empty the record: insert `  if (damaged.length === 0) return;` as `noteSegmentsDamaged`'s first statement | `test/history-export.test.ts`, `the record follows the files` | `the WARN clears once the files are out and a check runs: expected '["1.<writer>.db","2.<writer>.db"]' to be '[]'` |
| 22 | sweep.mjs | a clean check writes: `  if ((was ?? '[]') === text) return;` becomes `  if (was === text) return;` | `test/history-export.test.ts`, `CONTROL: two whole segments` | `a clean check writes no record: expected '[]' to be null` |
| 23 | cli.mjs | fold the reader: wrap the `x.exportSegmentDamaged = healthLib.readSegmentNameList(…)` assignment as `try { … } catch { x.exportSegmentDamaged = []; }` | `test/history-export.test.ts`, `status reads the check` | `a record that does not read back was read as "nothing damaged": expected [] to include 'status-unreadable'` |
| 24 | store.mjs | a second copy of the header length: remove `SEGMENT_HEADER_BYTES, ` from store.mjs's `from './lib.mjs'` import, and insert `const SEGMENT_HEADER_BYTES = 100;` directly above `segmentFileFacts`' docstring | `test/single-definition.test.ts`, `SEGMENT_HEADER_BYTES is declared` | `SEGMENT_HEADER_BYTES: a second declaration: expected [ 'ccd/history/lib.mjs', …(1) ] to deeply equal [ 'ccd/history/lib.mjs' ]` (predicted wording, as Task 1's mutant 19) |

The rows whose cells hold a pipe, unescaped (rows 1, 7, 8 and 9 are mutation texts, rows 18 and 19 filters):

```text
row 1:  drop  ` | FS.O_NOFOLLOW`  from the open's flags
row 7:  `  if (!facts.headerValid || !(facts.pageCount > 0) ||`  becomes  `  if (!(facts.pageCount > 0) ||`
row 8:  `  if (!facts.headerValid || !(facts.pageCount > 0) ||`  becomes  `  if (!facts.headerValid ||`
row 9:  ` || !(ps >= 512 && ps <= 65536 && (ps & (ps - 1)) === 0)) return 'header-invalid';`  becomes  `) return 'header-invalid';`
row 18: -t 'segment 2 another store|segment 2 segment 1'
row 19: -t 'segment 2 cut|segment 2 a file that is not'
```

After the last restore, run the three history files from Step 8 once more, green, and confirm that `for f in lib.mjs store.mjs sweep.mjs cli.mjs; do cmp "$SCRATCH/$f.t3" "ccd/history/$f"; done` prints nothing. Then remove this task's copies only, `rm "$SCRATCH"/*.t3`, and leave the directory.

- [ ] **Step 10: Commit**, from the repository root:

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/store.mjs ccd/history/store.d.mts ccd/history/sweep.mjs ccd/history/cli.mjs \
  server/test/history-store.test.ts server/test/history-lib.test.ts server/test/history-export.test.ts server/test/ccrc-doctor.test.ts \
  server/test/single-definition.test.ts
git commit -m "feat(history): a carried export segment counts only when it is whole and this store's; doctor WARNs export-segment-damaged (W5h-1 Task 3, D-5634)"
```

---

### Task 4: the check re-arms when a segment it saw is gone

**Files:**
- Modify: `ccd/history/lib.mjs`:
  - in `decideMarkCheck` (lib.mjs:8320 at `e4936efab`), change the parameter list `{ metaKeys, checkedRecord }` to `{ metaKeys, checkedRecord, vanished = false }`, and in its return line (lib.mjs:8326) change `check: facts.some((k) => !have.has(k))` to `check: vanished === true || facts.some((k) => !have.has(k))`;
  - insert one block directly below `missingSegmentNames` (lib.mjs:8331-8334; the function ends `  return [...new Set(named)].filter((n) => !here.has(n)).sort();` and `}`), above Task 3's `decideSegmentWhole` if Task 3 put it there.
- Modify: `ccd/history/lib.d.mts`: replace the `decideMarkCheck` declaration (lib.d.mts:959), and insert four declarations directly below `missingSegmentNames`' declaration (lib.d.mts:960).
- Modify: `ccd/history/sweep.mjs` (re-anchor each by content; line numbers measured at `e4936efab`, before Tasks 1-3 moved them):
  - the `from './lib.mjs'` import statement (sweep.mjs:43-66): merge `segmentListingRecord`, `addSegmentToListing` and `segmentListingVanished`;
  - in `markExported` (sweep.mjs:8528), insert five lines (three of comment, two of code) directly below `    setMeta(db, EXPORT_SEQ_META, String(m.seq));` (sweep.mjs:8533; the only line with that text);
  - in `exportStep` (sweep.mjs:8669), replace the `const markCheck = decideMarkCheck({ … });` line (sweep.mjs:8673) with six lines (three of comment, three of code), and add `, listing` to the end of the argument list of the one `checkSegmentMarks(db, ctx, markCheck.record` call below it (sweep.mjs:8675);
  - directly below `const EXPORT_MARKS_CHECKED_BINDS_META = 'export_marks_checked_binds';` (sweep.mjs:8729), insert one const and `measureSegmentListing`;
  - in `checkSegmentMarks` (sweep.mjs:8757, which Task 1 rewrote into bounded batches), add `listing = null` as its last parameter (Task 1's signature is `(db, ctx, record)`, which Task 3 leaves as it is), and in its done stamp, the transaction that runs `    setMeta(db, EXPORT_MARKS_CHECKED_BINDS_META, record);` (sweep.mjs:8802; after Task 1 it runs only after the last batch), insert three lines (two of comment, one of code) directly below that line.
- Not here: the spec. Its §9.15 "After a bind" passage for this trigger is Task 7's (Step 7), citing D-5636.
- Test: `server/test/history-lib.test.ts`: append one describe at the end of the file (8671 lines at `e4936efab`). It uses the module-scope `libSeg` namespace import (history-lib.test.ts:7961) and `createHash` (history-lib.test.ts:10), which are already imported.
- Test: `server/test/history-export.test.ts`:
  - change, in place, B4 Task 8's case `the check runs on the first step after a bind and not again until the next one: …` (history-export.test.ts:978): its title, and the four lines from `    // the segment goes, with no bind since the check: no check runs, and the marks stay` to `    // a restore's bind: the next step clears every mark naming the missing segment` (history-export.test.ts:994-998);
  - change, in place, B4 Task 8's case `the check follows the bind facts it has not covered, never their clocks: …` (history-export.test.ts:1010): one comment line (history-export.test.ts:1022) and one statement inside its restore step;
  - append one describe at the end of the file (2699 lines at `e4936efab`). It uses `plantSegment`, `strandedBlobs`, `segmentsOf`, `setMeta`, `HEALTH_META`, `x9Lib`, `TIB`, `vi`, `exportCtx`, `onStore`, `marks`, `metaOf` and `counters`, all of which the file already has.

**Interfaces:**
- Consumes:
  - Task 1 (`sweep.mjs`):
    - `checkSegmentMarks(db, ctx, record, …)`, the bounded check after a bind. Its done stamp, after the last batch, writes `EXPORT_MARKS_CHECKED_META` and `EXPORT_MARKS_CHECKED_BINDS_META` (`record`, lib `decideMarkCheck`'s, decided by the step that finishes the check). A check that stops (`markCheckStop`'s word) writes no done stamp, so `decideMarkCheck` answers `check` again on the next step.
    - The step lists the segments again and recomputes the missing set on every step, with no cursor kept.
    - `exportStep` still runs `decideMarkCheck` first, before the cadence. A non-busy throw from the check is counted `export_marks_check_failed` and recorded `unlistable` or `failed`, with one stderr line, and a busy is rethrown. When `decideMarkCheck` answers no check, a standing stop record is deleted (Task 1); this task's `vanished` feeds that same answer.
  - Task 3: the check counts a listed name present only when whole and own, records the damaged names in `HEALTH_META.exportSegmentDamaged`, and empties that record on a check that finds none. This task's listing does not judge a file: it digests every listed name, damaged ones included, as Task 3's `listed` holds them (coordinator's reconciliation), so moving a damaged file out of `export/<store_id>/` re-arms the check and Task 3's record empties.
  - B4 (`store.mjs`): `listSegments(dir)`, which answers `[]` only for a proven ENOENT and throws on ENOTDIR, EACCES and every other failure. B4 (`sweep.mjs`): `markExported(db, m)`, the pass's one mark transaction after the link; `exportDirFor(paths, storeId)`; `join` from `node:path`.
  - B4 (`lib.mjs`): `decideMarkCheck({ metaKeys, checkedRecord })`, `missingSegmentNames`. `createHash` from `node:crypto`, lib's only import.
  - Test side: B4's `historyHelpers` `plantSegment(box, storeId, { seq, writer, blobs, rows })` (a whole segment of this store, published by link), `strandedBlobs(box)`; this file's `ingestedBox`, `exportCtx`, `onStore`, `marks`, `metaOf`, `rid`, `row`, `MIN`, `DAY`, `TIB`.
- Produces:
  - `lib.mjs`:
    - `segmentListingDigest(names: Iterable<string>): string`: the XOR of the first 16 bytes of each distinct name's sha256, as 32 lowercase hex digits (`'0'` x 32 for none). The same set in any order gives the same digest, and the digest is additive.
    - `segmentListingRecord(names: Iterable<string>): string`: `'<count> <digest>'` over the distinct names.
    - `addSegmentToListing(recorded: string | null, name: string): string | null`: the record after a pass published `name`, with one more name and its digest XORed in. Over `null` it starts the record at `name`. Over a record that does not parse it answers `null`, which means write nothing.
    - `segmentListingVanished({ recorded: string | null, measured: string | null }): boolean`:
      - `measured` null (unmeasured) answers `false`;
      - `recorded` null answers `true` only when `measured` counts at least one segment;
      - a `recorded` value that does not parse answers `true`;
      - otherwise it answers whether the count or the digest differs;
      - a `measured` value that does not parse throws `TypeError` (a caller's bug).
    - `decideMarkCheck({ metaKeys, checkedRecord, vanished?: boolean })`: `check` is true when `vanished` is true, or when a bind fact is not yet covered. When `vanished` is absent or false, the bind rule stands as it was. `facts` and `record` are unchanged.
  - `sweep.mjs`:
    - module-private `EXPORT_MARKS_CHECKED_LISTING_META` (`'export_marks_checked_listing'`), the listing record, `'<count> <digest>'`;
    - module-private `measureSegmentListing(ctx): string | null`, the record of every name `listSegments` gives (one readdir, no header read, no open);
    - `checkSegmentMarks(…, listing = null)`. Its done stamp writes the listing record measured at the start of the step whenever `listing` is not null.
    - `exportStep` measures the listing on every step. `vanished` is lib's answer, and `decideMarkCheck` receives it.
    - `markExported` adds its segment's name to the listing record in its mark transaction.
  - Meta key `export_marks_checked_listing`. No counter, no health word, no schema change.

**Spec:**
- §9.15 "After a bind": "the first tick checks that every segment a mark names is on this box". This task adds a second trigger. A segment the last check saw that is gone later, outside a bind, re-arms the check on the next step. Task 7's spec step states it, citing D-5636.
- Departure: **D-5636** (`history-export-vanished-rearm`), NEW (no spec §16 row). It closes the ledger's "Owed from B4" item 7b, review 624's advice "a move-aside after the first tick clears nothing until the next bind". It flips B4 Task 8's pinned case "the segment goes, with no bind since the check: no check runs, and the marks stay".
- Coordinator ruling R7: the re-arm is taken as code, with a compact listing record (a count plus an order-independent digest), never the names list. The record is updated in `exportPass`'s mark transaction and in Task 1's done stamp, and `decideMarkCheck` gains a `vanished` input.
- Coordinator ruling R6, with the coordinator's reconciliation of Tasks 3 and 4: the listing digests every listed name, damaged ones included, and judges no file; whether a listed file is whole and this store's is Task 3's check, run only when the check runs. Moving a damaged file out of `export/<store_id>/` changes the listing, so the next step re-arms the check and Task 3's damaged record empties. The check never renames or removes anything, and there is no `quick_check` in the tick.
- Coordinator ruling R1: a re-armed check is Task 1's bounded check, so moving one large segment aside costs batches, not one unbounded transaction. That is why this task lands after Task 1.
- Coordinator ruling RD2 (B4): whether the listing differs, and whether a step checks, are lib's decisions (`segmentListingVanished`, `decideMarkCheck`). The sweep only measures the directory, the headers and meta, calls them and acts.
- Plan choices:
  - **Any difference re-arms.** A count and a digest cannot tell a segment gone from one added, so any difference re-arms the check. A carry that only adds segments therefore costs one check that clears nothing (the check is keyed on the marks: it clears only a mark naming a segment this box lacks), and that check records the new listing. Re-arming only when the count falls would miss a loss hidden behind a carry of the same count (pinned).
  - **The record the check writes is the listing measured at the start of its step.** It is never re-measured at the done stamp. So a segment that goes after that measurement differs from the record and re-arms the next step.
  - **A pass adds its own name and never re-measures.** A segment that went before the pass stays in the record and re-arms the next step (pinned).
  - **A crash between link and marks writes no record.** The record is written in the mark transaction, so a crash there leaves the published segment out of the record. The next step re-arms and clears nothing, which is harmless.
  - **No record.** A store whose segments predate the record (an upgraded store) checks once, then the record exists. A fresh store with no segment does not check.
  - **An unmeasured listing never re-arms.** A directory that cannot be listed for any reason but ENOENT never re-arms the check; only a bind does, as before, and the check's own listing then counts the failure (B4's ENOTDIR cases at history-export.test.ts:1036-1076 stay green).
  - **Cost per step.** One `readdir`. No header read and no open: a file's state is the check's to judge (Task 3). Never the two DISTINCT `exported_seg` scans, which run only when the check runs.
  - **A damaged file left in place re-arms nothing.** Its name counts in the record the check that found it wrote, so later steps match the record and stay quiet; the WARN `export-segment-damaged` stands until the file is moved out (which re-arms one check) or the next bind.
  - **Not covered.** A later segment that no mark names, lost after a rebuild (ledger item 6), is not reached by any trigger keyed on marks. Task 5's last-carrier replay is the change there. A segment damaged in place after the last check (cut short or overwritten under the same name) changes no listing, so its marks stand until the next bind or listing change; replay finds such a file (D-4765).

- [ ] **Step 1: Write the failing pure tests.** Append to the end of `server/test/history-lib.test.ts`:

```ts

// ===========================================================================
// W5h-1 Task 4: the check re-arms when a segment it saw is gone (D-5636 (history-export-vanished-rearm)). Pure, on
// lib.mjs alone: the compact listing record (a count and an order-independent digest of every listed segment's name,
// damaged ones included, never the names), what a pass adds to it, whether a measured listing differs from it, and
// decideMarkCheck's `vanished` input.
// ===========================================================================
describe('W5h-1 Task 4: the listing record and decideMarkCheck\'s vanished input (D-5636 (history-export-vanished-rearm))', () => {
  const T4W = '0a1b2c3d';
  const T4C = 'c0ffee00';
  const s = (seq: number, w: string = T4W): string => `${seq}.${w}.db`;
  const zero = '0'.repeat(32);
  const head16 = (n: string): string => createHash('sha256').update(n, 'utf8').digest().subarray(0, 16).toString('hex');
  it('segmentListingDigest: the XOR of each distinct name\'s first 16 sha256 bytes, so the same set in any order gives one digest', () => {
    const fwd = libSeg.segmentListingDigest([s(1), s(2), s(1, T4C)]);
    expect(libSeg.segmentListingDigest([s(1, T4C), s(2), s(1)]), 'the same set in another order').toBe(fwd);
    expect(fwd).toMatch(/^[0-9a-f]{32}$/);
    expect(libSeg.segmentListingDigest([])).toBe(zero);
    expect(libSeg.segmentListingDigest([s(1)])).toBe(head16(s(1)));
    expect(libSeg.segmentListingDigest(new Set([s(2), s(1, T4C), s(1)])), 'any iterable').toBe(fwd);
    expect(libSeg.segmentListingDigest([s(1), s(1), s(2), s(1, T4C)]), 'a name twice counts once').toBe(fwd);
    expect(libSeg.segmentListingDigest([s(1), s(2)]), 'another set').not.toBe(fwd);
  });
  it('segmentListingRecord: "<count> <digest>" over the distinct names', () => {
    expect(libSeg.segmentListingRecord([])).toBe(`0 ${zero}`);
    expect(libSeg.segmentListingRecord([s(2), s(1), s(2)])).toBe(`2 ${libSeg.segmentListingDigest([s(1), s(2)])}`);
  });
  it('addSegmentToListing: one more name, its digest XORed in, equal to the record of the whole set; no record starts one; a torn record is left for the check', () => {
    expect(libSeg.addSegmentToListing(null, s(1))).toBe(libSeg.segmentListingRecord([s(1)]));
    expect(libSeg.addSegmentToListing(libSeg.segmentListingRecord([s(1), s(1, T4C)]), s(2)), 'the pass never lists the directory')
      .toBe(libSeg.segmentListingRecord([s(1), s(1, T4C), s(2)]));
    expect(libSeg.addSegmentToListing(`0 ${zero}`, s(3))).toBe(libSeg.segmentListingRecord([s(3)]));
    for (const torn of ['', 'x', `1 ${zero.slice(1)}`, `01 ${zero}`, `-1 ${zero}`, `1 ${'A'.repeat(32)}`, `1  ${zero}`]) {
      expect(libSeg.addSegmentToListing(torn, s(2)), JSON.stringify(torn)).toBeNull();
    }
  });
  it('segmentListingVanished: any difference from the record re-arms (a count and a digest cannot tell a segment gone from one added); an unmeasured listing never does', () => {
    const rec = (...n: string[]): string => libSeg.segmentListingRecord(n);
    expect(libSeg.segmentListingVanished({ recorded: rec(s(1), s(2)), measured: rec(s(2), s(1)) }), 'the same set').toBe(false);
    expect(libSeg.segmentListingVanished({ recorded: rec(s(1), s(2)), measured: rec(s(2)) }), 'one gone').toBe(true);
    expect(libSeg.segmentListingVanished({ recorded: rec(s(1)), measured: rec(s(1), s(1, T4C)) }), 'one carried in').toBe(true);
    expect(libSeg.segmentListingVanished({ recorded: rec(s(1)), measured: rec(s(1, T4C)) }), 'one gone and one carried in, the count unchanged').toBe(true);
    expect(libSeg.segmentListingVanished({ recorded: rec(s(1)), measured: null }), 'a listing that could not be measured is never vanished').toBe(false);
    expect(libSeg.segmentListingVanished({ recorded: null, measured: rec() }), 'no record and no segment').toBe(false);
    expect(libSeg.segmentListingVanished({ recorded: null, measured: rec(s(1)) }), 'segments that predate the record: one check records them').toBe(true);
    for (const torn of ['', 'not a record', `2 ${zero.slice(2)}`]) {
      expect(libSeg.segmentListingVanished({ recorded: torn, measured: rec(s(1)) }), `a torn record ${JSON.stringify(torn)} fails toward a check`).toBe(true);
    }
    expect(() => libSeg.segmentListingVanished({ recorded: null, measured: 'torn' }), 'a measured record is lib\'s own; a torn one is a caller\'s bug').toThrow(TypeError);
  });
  it('decideMarkCheck: vanished checks with no new bind fact, and records the facts it covers; absent or false leaves the bind rule as it was', () => {
    expect(libSeg.decideMarkCheck({ metaKeys: [], checkedRecord: null, vanished: true })).toEqual({ check: true, facts: [], record: '[]' });
    expect(libSeg.decideMarkCheck({ metaKeys: ['bound:5'], checkedRecord: '["bound:5"]', vanished: true }), 'a covered fact and a segment gone')
      .toEqual({ check: true, facts: ['bound:5'], record: '["bound:5"]' });
    expect(libSeg.decideMarkCheck({ metaKeys: ['bound:5'], checkedRecord: '["bound:5"]', vanished: false }).check, 'neither').toBe(false);
    expect(libSeg.decideMarkCheck({ metaKeys: ['bound:5'], checkedRecord: '["bound:5"]' }).check, 'no vanished input').toBe(false);
    expect(libSeg.decideMarkCheck({ metaKeys: ['bound:5'], checkedRecord: null, vanished: false }).check, 'a new fact still checks').toBe(true);
  });
});
```

- [ ] **Step 2: Run them and see them fail.** From inside `server/`, in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W5h-1 Task 4'
```

Expected (measured at `e4936efab` with these tests added): `5 failed`:
- `TypeError: segmentListingDigest is not a function`;
- `TypeError: segmentListingRecord is not a function`;
- `TypeError: addSegmentToListing is not a function`;
- `TypeError: segmentListingRecord is not a function` (the vanished case builds its records first);
- for the `decideMarkCheck` case, `AssertionError: expected { check: false, facts: [], …(1) } to deeply equal { Object (check, facts, ...) }`.

- [ ] **Step 3: Write lib's listing record and the `vanished` input.** In `ccd/history/lib.mjs`, in `decideMarkCheck`, replace

```js
export function decideMarkCheck({ metaKeys, checkedRecord }) {
```

with

```js
export function decideMarkCheck({ metaKeys, checkedRecord, vanished = false }) {
```

and replace its return line

```js
  return { check: facts.some((k) => !have.has(k)), facts, record: JSON.stringify(facts) };
```

with

```js
  return { check: vanished === true || facts.some((k) => !have.has(k)), facts, record: JSON.stringify(facts) };
```

Add one sentence to the end of `decideMarkCheck`'s doc comment. Its last line ends the comment on the same line (`` … `record` is every fact this check covers, sorted, as the check writes it. */``, `lib.mjs:8319` at e4936efab), so the new lines go INSIDE the comment, never after that line: replace that whole line with

```js
 *  the check runs rather than miss a bind. `record` is every fact this check covers, sorted, as the check writes it.
 *  `vanished` (W5h-1 Task 4, D-5636 (history-export-vanished-rearm)) is lib segmentListingVanished's answer for this step:
 *  true checks whatever the bind facts say; absent or false leaves the bind rule as it was. */
```

and check with `node --check ccd/history/lib.mjs`.

Then insert directly below `missingSegmentNames` (its closing `}`):

```js

// ── W5h-1 Task 4 (D-5636 (history-export-vanished-rearm)): the listing record ─────────────────────────────────────
// What the last check saw of export/<store_id>/, and every segment a pass published since, kept as meta
// export_marks_checked_listing: `<count> <digest>`, never the names (coordinator ruling R7). A step re-arms the check when
// the segment names it lists now, damaged ones included, differ from it, so a segment moved aside or deleted after the
// first tick has its marks cleared and its rows export again, with no bind.

/** The value grammar of the listing record: a count, one space, 32 lowercase hex digits. */
const SEGMENT_LISTING_RE = /^(0|[1-9][0-9]{0,15}) ([0-9a-f]{32})$/;

/** An order-independent digest of a set of segment names: the XOR of the first 16 bytes of each distinct name's
 *  sha256, as 32 lowercase hex digits ('0' x 32 for none). Additive: a pass XORs its own name into the record without
 *  listing the directory (addSegmentToListing). A name is never published twice (link() never replaces one, and the
 *  sequence only grows), so the XOR never cancels a name it added. */
export function segmentListingDigest(names) {
  const acc = Buffer.alloc(16);
  for (const n of new Set(names)) {
    const h = createHash('sha256').update(String(n), 'utf8').digest();
    for (let i = 0; i < 16; i += 1) acc[i] ^= h[i];
  }
  return acc.toString('hex');
}

/** The listing record of a set of names, `<count> <digest>`: the value the check's done stamp writes. */
export function segmentListingRecord(names) {
  const set = new Set(names);
  return `${set.size} ${segmentListingDigest(set)}`;
}

/** A listing record's count and digest, or null when it does not parse. */
function parseSegmentListing(v) {
  const m = typeof v === 'string' ? SEGMENT_LISTING_RE.exec(v) : null;
  return m === null ? null : { count: Number(m[1]), digest: m[2] };
}

/** The record after a pass published `name`, written in its mark transaction: one more, its digest XORed in. Over no
 *  record it starts one at `name`; over a record that does not parse it answers null (write nothing): the next step
 *  re-arms on it anyway and the check writes a true one. Never a re-measurement of the directory: a segment gone
 *  before the pass stays in the record, so the next step still re-arms on it. */
export function addSegmentToListing(recorded, name) {
  if (recorded === null) return segmentListingRecord([name]);
  const r = parseSegmentListing(recorded);
  if (r === null) return null;
  const add = Buffer.from(segmentListingDigest([name]), 'hex');
  const acc = Buffer.from(r.digest, 'hex');
  for (let i = 0; i < 16; i += 1) acc[i] ^= add[i];
  return `${r.count + 1} ${acc.toString('hex')}`;
}

/** Whether a segment the last record saw may be gone (decideMarkCheck's `vanished`). `measured` is the record of every
 *  segment name listed now, damaged ones included, or null when the directory could not be listed (an unreadable
 *  directory is never a vanished segment); `recorded` is meta's. The record holds a count and a digest, never the names,
 *  so it cannot tell a segment gone from one added: any difference answers true, and the check, keyed on the marks,
 *  clears only what a mark names and this box lacks (a segment carried in clears nothing). No record answers true when
 *  segments are listed (segments that predate the record: one check records them); a record that does not parse
 *  answers true. */
export function segmentListingVanished({ recorded, measured }) {
  if (measured === null) return false;
  const now = parseSegmentListing(measured);
  if (now === null) throw new TypeError(`segmentListingVanished: not a listing record: ${JSON.stringify(measured)}`);
  if (recorded === null) return now.count > 0;
  const was = parseSegmentListing(recorded);
  if (was === null) return true;
  return was.count !== now.count || was.digest !== now.digest;
}
```

`Buffer` is already used in lib.mjs (e.g. `Buffer.byteLength` in its spool-line check), and `createHash` is its one import, so the ring stays L1.

In `ccd/history/lib.d.mts`, replace

```ts
export function decideMarkCheck(i: { metaKeys: readonly string[]; checkedRecord: string | null }): { check: boolean; facts: string[]; record: string };
```

with

```ts
export function decideMarkCheck(i: { metaKeys: readonly string[]; checkedRecord: string | null; vanished?: boolean }): { check: boolean; facts: string[]; record: string };
```

and insert directly below `export function missingSegmentNames(i: { named: Iterable<string>; present: Iterable<string> }): string[];`:

```ts
// W5h-1 Task 4: the listing record (D-5636 (history-export-vanished-rearm))
export function segmentListingDigest(names: Iterable<string>): string;
export function segmentListingRecord(names: Iterable<string>): string;
export function addSegmentToListing(recorded: string | null, name: string): string | null;
export function segmentListingVanished(i: { recorded: string | null; measured: string | null }): boolean;
```

Run `node --check ccd/history/lib.mjs` from the repository root.

- [ ] **Step 4: Run the pure tests green.** From inside `server/`, in the foreground:

```bash
./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W5h-1 Task 4'
./node_modules/.bin/vitest run test/history-lib.test.ts -t 'decideMarkCheck'
```

Expected: the first prints `5 passed`. The second runs B4's two `decideMarkCheck` cases, which never pass `vanished`, and this task's case, all green (measured).

- [ ] **Step 5: Write the failing sweep tests.** In `server/test/history-export.test.ts`, in B4 Task 8's describe `marks that move (…)`, change three places in place.

First, replace the title of the case at history-export.test.ts:978:

```ts
  it('the check runs on the first step after a bind and not again until the next one: marks naming a present segment stay; a restore\'s bind clears those naming a missing one', async () => {
```

with

```ts
  it('the check runs on the first step after a bind, and again on a step that finds a segment it saw gone, never otherwise: marks naming a present segment stay; a segment gone after the check has its marks cleared with no bind (D-5636 (history-export-vanished-rearm)); a restore\'s bind after that finds nothing left to clear', async () => {
```

Second, in the same case, replace

```ts
    // the segment goes, with no bind since the check: no check runs, and the marks stay
    fs.rmSync(path.join(exportDirOf(box), name));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(Object.values(marks(box)), 'a check ran with no bind since the last one').toEqual([name, name]);
    // a restore's bind: the next step clears every mark naming the missing segment
```

with

```ts
    // a step with no new bind fact and every segment the check saw still here: no check runs
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(2 * MIN + 30_000))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'a check ran with no bind and no segment gone').toBe(String(NOW + 2 * MIN));
    // the segment goes, with no bind since the check: the next step re-arms the check (W5h-1 Task 4, D-5636
    // (history-export-vanished-rearm)), which clears every mark naming it
    fs.rmSync(path.join(exportDirOf(box), name));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(Object.values(marks(box)), 'a segment gone after the check left its marks standing').toEqual([null, null]);
    expect(metaOf(box, 'export_marks_checked_ms')).toBe(String(NOW + 3 * MIN));
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing)).toBe('4');
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
    // a restore's bind: the next step checks again and finds no mark left naming the missing segment
```

The case's remaining assertions after the restore's bind are unchanged and hold:
- marks `[null, null]`;
- no blob mark;
- `export_segment_missing` still 1, because a check that clears nothing does not bump it (Task 1's done stamp);
- `HEALTH_META.exportSegmentMissing` still `'4'`: Task 1 accumulates it per batch, and this check adds 0;
- `strandedBlobs` `[]`.

The new step at `+2 min 30 s` keeps B4 Task 8's "a check on every step" mutant red.

Third, in the case `the check follows the bind facts it has not covered, never their clocks: …` (history-export.test.ts:1010), replace

```ts
    // a restore whose bind fact carries a clock behind the last check's, with the segment gone
    fs.rmSync(path.join(exportDirOf(box), name));
    await onStore(box, (db) => {
      setMeta(db, `bound:${NOW + 3 * MIN}`, 'restore');
```

with

```ts
    // a restore whose bind fact carries a clock behind the last check's, with the segment gone. The listing record goes
    // too, so only the bind fact can arm this step: with it, the segment gone would re-arm the check whatever the bind's
    // clock (W5h-1 Task 4, D-5636 (history-export-vanished-rearm)), and this case would pin nothing about the clock.
    fs.rmSync(path.join(exportDirOf(box), name));
    await onStore(box, (db) => {
      db.prepare('DELETE FROM meta WHERE k = ?').run('export_marks_checked_listing');
      setMeta(db, `bound:${NOW + 3 * MIN}`, 'restore');
```

With no record and no segment listed, `segmentListingVanished` answers false, so the step checks only because of the bind fact. Without this deletion, B4 Task 8's clock mutant survives this case once Step 7 lands. That was measured: `Tests 1 passed` with the mutant applied and the deletion left out.

Then append to the end of the file:

```ts

// ── W5h-1 Task 4: the check re-arms when a segment it saw is gone (D-5636 (history-export-vanished-rearm)) ──────────
// The listing record is meta export_marks_checked_listing: lib segmentListingRecord's `<count> <digest>` over every segment
// name the last check listed, damaged ones included, plus each segment a pass published since (added in the pass's mark
// transaction). Every step lists export/<store_id>/ and re-arms the check when the names differ from the record.
describe('the check re-arms when a segment it saw is gone (W5h-1 Task 4; D-5636 (history-export-vanished-rearm))', () => {
  const t4Roomy = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * TIB, blocks: 8 * TIB });
  const LISTING = 'export_marks_checked_listing';

  it('a segment moved aside after the first tick re-arms the check on the next step with no bind: its marks are cleared and its rows export again', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanish-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    expect(Object.values(marks(box))).toEqual([s1, s1]);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(2 * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'the first tick after the pass: nothing gone, no check').toBeNull();
    // moved aside, outside any bind (an operator's tidy-up, a disk move): no bind fact is written
    fs.renameSync(path.join(exportDirOf(box), s1), path.join(box.home, 'moved-aside.db'));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(Object.values(marks(box)), 'a segment gone after the first tick left its marks standing').toEqual([null, null]);
    expect(metaOf(box, 'export_marks_checked_ms')).toBe(String(NOW + 3 * MIN));
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'two entries\' marks and two blobs\'').toBe('4');
    expect(metaOf(box, LISTING), 'the check records what it saw: no segment').toBe(`0 ${'0'.repeat(32)}`);
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
    // an hour on, the cadence is due: the rows export again, into the next number
    const again = await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(65 * MIN), { deps: { statfs: t4Roomy } })));
    expect(again).toMatchObject({ state: 'written', segment: s2, complete: true });
    expect(segmentsOf(box)).toEqual([s2]);
    expect(Object.values(marks(box))).toEqual([s2, s2]);
    expect(metaOf(box, HEALTH_META.exportSegmentMissing), 'the re-export left nothing due behind: the WARN clears').toBe('0');
    expect(counters(box)['export_segment_missing'], 'one check cleared marks').toBe(1);
  }, 120_000);

  it('a segment a pass published does not re-arm the check: the pass adds its name to the listing record in its mark transaction', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishpub-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    for (const m of [2, 3, 4]) await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(m * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'a step re-armed the check on the pass\'s own segment').toBeNull();
    expect(Object.values(marks(box))).toEqual([s1, s1]);
    expect(metaOf(box, LISTING), 'the pass started the record at its own segment').toBe(`1 ${x9Lib.segmentListingDigest([s1])}`);
  }, 120_000);

  it('a segment that goes before a pass stays in the listing record: the pass adds its own name and never starts the record over, so the next step still re-arms', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishpre-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const s2 = `2.${ids.writer}.db`;
    // a budget of one byte: the first due row still travels, alone (D-4760), so the second is left for a later pass
    const first = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0), { limits: { maxBytes: 1 } })));
    expect(first, 'the fixture must leave a row for a second pass').toMatchObject({ state: 'written', segment: s1, rows: 1, complete: false });
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: null });
    fs.rmSync(path.join(exportDirOf(box), s1));
    // the pass runs before any step measures the directory (as when the segment goes inside a step, after its listing)
    const second = await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(5 * MIN))));
    expect(second).toMatchObject({ state: 'written', segment: s2 });
    expect(marks(box)).toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(6 * MIN))));
    expect(marks(box), 'the pass\'s record forgot the segment that went before it').toEqual({ [rid(1)]: null, [rid(2)]: s2 });
    expect(counters(box)['export_segment_missing']).toBe(1);
    expect(strandedBlobs(box)).toEqual([]);
  }, 120_000);

  it('a carry that adds a segment clears nothing, and the check records it so the next step is quiet; one that adds a segment while another is gone still clears the gone one\'s marks', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishcarry-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const OLD = 'c0ffee00';   // the writer of the box the store came from
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    // a segment carried in late from the old box: this store's, whole, and named by no mark here
    const carried = path.basename(plantSegment(box, ids.storeId, { seq: 1, writer: OLD, blobs: [], rows: [] }));
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(2 * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'the record cannot tell an add from a loss: the step checks').toBe(String(NOW + 2 * MIN));
    expect(Object.values(marks(box)), 'a carry that adds a segment cleared marks').toEqual([s1, s1]);
    expect(counters(box)['export_segment_missing']).toBeUndefined();
    expect(metaOf(box, HEALTH_META.exportSegmentMissing)).toBeNull();
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'the check did not record the listing it saw: every step checks again').toBe(String(NOW + 2 * MIN));
    // one more carried in while this box's own segment goes: the count is unchanged, the digest is not
    fs.rmSync(path.join(exportDirOf(box), carried));
    plantSegment(box, ids.storeId, { seq: 2, writer: OLD, blobs: [], rows: [] });
    fs.rmSync(path.join(exportDirOf(box), s1));
    plantSegment(box, ids.storeId, { seq: 3, writer: OLD, blobs: [], rows: [] });
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(4 * MIN))));
    expect(Object.values(marks(box)), 'a segment gone behind a carry of the same count left its marks standing').toEqual([null, null]);
    expect(counters(box)['export_segment_missing']).toBe(1);
  }, 120_000);

  it('a damaged segment moved out of export/<store_id>/ re-arms the check with no bind, and the damaged record empties: every listed name counts in the record, damaged ones included', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishdmg-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    const p1 = path.join(exportDirOf(box), s1);
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    fs.truncateSync(p1, fs.statSync(p1).size - 1);   // one byte short of its header's page_size x page_count
    // a bind: the check reads segment 1 short (Task 3), clears its marks and records its name
    await onStore(box, (db) => { setMeta(db, `bound:${NOW + MIN}`, 'restore'); return SW.exportStep(db, exportCtx(box, ids, at(2 * MIN))); });
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged), 'CONTROL: the check recorded the damaged name').toBe(JSON.stringify([s1]));
    expect(metaOf(box, LISTING), 'the record counts the damaged name').toBe(`1 ${x9Lib.segmentListingDigest([s1])}`);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'a damaged file left in place re-armed the check').toBe(String(NOW + 2 * MIN));
    fs.renameSync(p1, path.join(box.home, `${s1}.aside`));   // the remedy: out of export/<store_id>/
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(4 * MIN))));
    expect(metaOf(box, 'export_marks_checked_ms'), 'a damaged segment moved aside did not re-arm the check').toBe(String(NOW + 4 * MIN));
    expect(metaOf(box, HEALTH_META.exportSegmentDamaged), 'the damaged record empties once the file is out').toBe('[]');
    expect(metaOf(box, LISTING)).toBe(`0 ${'0'.repeat(32)}`);
  }, 120_000);

  it('CONTROL: a listing that fails for any reason but ENOENT is never read as a segment gone: with no bind, no check runs, nothing is counted and the marks stay', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishlist-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    const dir = exportDirOf(box);
    fs.renameSync(dir, `${dir}.kept`);
    fs.writeFileSync(dir, 'a stray file under the directory\'s name');   // listing it fails ENOTDIR
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let lines: string[] = [];
    try {
      await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(2 * MIN))));
      lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('history-sweep: the export marks could not be checked'));
    } finally {
      err.mockRestore();
    }
    expect(counters(box)['export_marks_check_failed'], 'an unlistable directory was read as a segment gone').toBeUndefined();
    expect(lines).toEqual([]);
    expect(metaOf(box, 'export_marks_checked_ms')).toBeNull();
    expect(Object.values(marks(box))).toEqual([s1, s1]);
  }, 120_000);

  it('a listing that fails never deletes the stop record of a check the listing re-armed: unmeasured is not "no check owed"; the next measured step finishes the check', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-vanishstop-', [row(1, 'one', DAY), row(2, 'two', DAY)]);
    const NOW = Date.now();
    const at = (ms: number) => (): number => NOW + ms;
    const s1 = `1.${ids.writer}.db`;
    await onStore(box, (db) => SW.exportPass(db, exportCtx(box, ids, at(0))));
    const dir = exportDirOf(box);
    fs.rmSync(path.join(dir, s1));   // gone outside any bind: only the listing owes the check
    // one blob a batch and a one-byte run budget: the re-armed check stops at the budget after its first batch
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(3 * MIN), { deps: { exportBindBytes: 1 }, limits: { maxBytes: 1 } })));
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'CONTROL: the vanish-owed check stopped at the budget').toBe(`budget ${NOW + 3 * MIN} 2`);
    expect(Object.values(marks(box)).filter((v) => v === s1), 'CONTROL: one mark still names the gone segment').toHaveLength(1);
    fs.renameSync(dir, `${dir}.kept`);
    fs.writeFileSync(dir, 'a stray file under the directory\'s name');   // listing it fails ENOTDIR
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(4 * MIN))));
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'an unmeasured listing deleted the stop record of a check it could not see finish')
      .toBe(`budget ${NOW + 3 * MIN} 2`);
    expect(Object.values(marks(box)).filter((v) => v === s1), 'nothing cleared while the directory could not be listed').toHaveLength(1);
    fs.rmSync(dir);
    fs.renameSync(`${dir}.kept`, dir);
    await onStore(box, (db) => SW.exportStep(db, exportCtx(box, ids, at(5 * MIN))));
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'listed again, the check finishes').toBeNull();
    expect(Object.values(marks(box))).toEqual([null, null]);
    expect(strandedBlobs(box)).toEqual([]);
  }, 120_000);
});
```

Every step before the hour runs only the check: the pass at `NOW` holds the cadence, so no statfs is reached and `exportCtx`'s empty `deps` serves. What a truncated segment's marks become is Task 3's case (R6: a segment that is not whole is treated as missing); the damaged-segment case here pins only the re-arm on its removal, and that a damaged file left in place re-arms nothing.

- [ ] **Step 6: Run them and see them fail.** From inside `server/`, in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts -t 'W5h-1 Task 4|the check runs on the first step after a bind|never their clocks'
```

Expected: `7 failed | 2 passed`. This was measured at `e4936efab` with Step 3's lib applied and the sweep unchanged, with a cut-short case in the damaged case's place and before the stop-record case was added (`6 failed | 2 passed`); the damaged case's and the stop-record case's reds are predicted. Tasks 1 to 3 do not change these messages (predicted). The failures:
- the flipped case: `a segment gone after the check left its marks standing: expected [ '1.<writer>.db', '1.<writer>.db' ] to deeply equal [ null, null ]`;
- the move-aside case: `a segment gone after the first tick left its marks standing: expected [ '1.<writer>.db', '1.<writer>.db' ] to deeply equal [ null, null ]`;
- the published case: `the pass started the record at its own segment: expected null to be '1 <32 hex>'`;
- the gone-before-a-pass case: `the pass's record forgot the segment that went before it: expected { …(2) } to deeply equal { …(2) }`;
- the carry case: `the record cannot tell an add from a loss: the step checks: expected null to be '<NOW + 2 min>'`;
- the damaged case (predicted; it needs Task 3's check for its CONTROL): `the record counts the damaged name: expected null to be '1 <32 hex>'`;
- the stop-record case (predicted): `CONTROL: the vanish-owed check stopped at the budget: expected null to be 'budget <NOW + 3 min> 2'`, because no step re-arms on the listing yet.

The clock case and the CONTROL are green. They are guards for Steps 7 and 9, not reds.

- [ ] **Step 7: Measure the listing each step, re-arm on it, and keep the record in the pass and the done stamp.** In `ccd/history/sweep.mjs`:

Merge into the `from './lib.mjs'` import statement (append to its last line, which at `e4936efab` is `  decideMarkCheck, missingSegmentNames, deadFileSourceKey, decideSegmentReplay, orderSegmentNames, entryMayHoldMark, segmentMayMarkEntry,`):

```js
  segmentListingRecord, addSegmentToListing, segmentListingVanished,
```

No other import is new: `listSegments`, `exportDirFor`, `getMeta` and `setMeta` are already in the module.

In `markExported`, insert directly below `    setMeta(db, EXPORT_SEQ_META, String(m.seq));`:

```js
    // W5h-1 Task 4 (D-5636 (history-export-vanished-rearm)): the published name joins the listing record in the same
    // transaction as its marks, so a crash never records a name whose marks did not commit, and the next step does not
    // re-arm the check on this pass's own segment. lib adds the name; the directory is never re-measured here.
    const listed = addSegmentToListing(getMeta(db, EXPORT_MARKS_CHECKED_LISTING_META), m.name);
    if (listed !== null) setMeta(db, EXPORT_MARKS_CHECKED_LISTING_META, listed);
```

In `exportStep`, replace

```js
  const markCheck = decideMarkCheck({ metaKeys: bindFactKeys(db), checkedRecord: getMeta(db, EXPORT_MARKS_CHECKED_BINDS_META) });
```

with

```js
  // W5h-1 Task 4 (D-5636 (history-export-vanished-rearm)): and again, with no new bind fact, when the segment names
  // listed now (damaged ones included) differ from the record the last check and every pass since left (lib
  // segmentListingVanished): a segment moved aside or deleted after the first tick re-arms the check. A listing that
  // cannot be measured is never vanished.
  const listing = measureSegmentListing(ctx);
  const vanished = segmentListingVanished({ recorded: getMeta(db, EXPORT_MARKS_CHECKED_LISTING_META), measured: listing });
  const markCheck = decideMarkCheck({ metaKeys: bindFactKeys(db), checkedRecord: getMeta(db, EXPORT_MARKS_CHECKED_BINDS_META), vanished });
```

In the same function, the one call `checkSegmentMarks(db, ctx, markCheck.record` (Task 1 keeps it as `    try { checkSegmentMarks(db, ctx, markCheck.record); } catch (e) {`) gains `, listing` as its last argument: `    try { checkSegmentMarks(db, ctx, markCheck.record, listing); } catch (e) {`. Task 1's stale-record delete below it reads `markCheck.check`, which now includes `vanished`; it now also needs a MEASURED listing, because a listing that fails reads as not vanished, and a check owed only through the listing would otherwise read as "no check owed" and lose its stop record (no overloaded null). Replace its condition line `  if (!markCheck.check && (getMeta(db, HEALTH_META.exportMarksCheck) !== null || getMeta(db, EXPORT_MARKS_COUNTED_META) !== null)) {` with:

```js
  // W5h-1 Task 4 (D-5636): only on a measured listing. An unlistable directory (null) is never vanished, so a check
  // owed through the listing alone would read as "no check owed" here; its stop record and the flag stay until a step can list.
  if (!markCheck.check && listing !== null && (getMeta(db, HEALTH_META.exportMarksCheck) !== null || getMeta(db, EXPORT_MARKS_COUNTED_META) !== null)) {
```

Insert directly below `const EXPORT_MARKS_CHECKED_BINDS_META = 'export_marks_checked_binds';`:

```js
/** meta: the compact record of every segment name the last check listed, damaged ones included, plus every segment a
 *  pass published since (lib segmentListingRecord's `<count> <digest>`; W5h-1 Task 4, D-5636
 *  (history-export-vanished-rearm)). Never the names. */
const EXPORT_MARKS_CHECKED_LISTING_META = 'export_marks_checked_listing';

/** The listing record of export/<store_id>/ now: lib segmentListingRecord over EVERY name listSegments gives, damaged
 *  ones included. Whether a listed file is whole and this store's is the check's to judge (Task 3, D-5634); this record
 *  only notices that the listing changed, so moving a damaged file out re-arms the check and empties Task 3's record.
 *  One readdir: no header read, no open. Null when the directory cannot be listed for any reason but ENOENT
 *  (listSegments throws: ENOTDIR, EACCES), which lib never reads as a vanished segment; an absent directory lists none.
 *  W5h-1 Task 4 (D-5636). */
function measureSegmentListing(ctx) {
  let segs;
  try { segs = listSegments(exportDirFor(ctx.paths, ctx.ids.storeId)); } catch { return null; }
  return segmentListingRecord(segs.map((x) => x.name));
}
```

In `checkSegmentMarks`, add `listing = null` as the last parameter. At `e4936efab` the signature is `export function checkSegmentMarks(db, ctx, record) {`, which becomes `export function checkSegmentMarks(db, ctx, record, listing = null) {`. Then, in its done stamp, insert directly below `    setMeta(db, EXPORT_MARKS_CHECKED_BINDS_META, record);`:

```js
    // W5h-1 Task 4 (D-5636): the listing measured at the start of this step, never re-measured here, so a segment that
    // goes after that measurement differs from the record and re-arms the next step. Null (unmeasured): left as it is.
    if (listing !== null) setMeta(db, EXPORT_MARKS_CHECKED_LISTING_META, listing);
```

Callers that pass no `listing` write nothing: Task 1's direct `SW.checkSegmentMarks(…, '["bound:1"]')` cases at history-export.test.ts:2454 and :2506 do this. A check that stops short writes no done stamp, so it writes no record either: the next step re-arms on the bind fact or on the listing, as Task 1 requires.

Run `node --check ccd/history/sweep.mjs` from the repository root. Then confirm the sweep decides nothing about the record (RD2). This must print the `echo` line:

```bash
grep -nE "\.count !==|digest !==|\^= " ccd/history/sweep.mjs || echo 'the listing is decided in lib'
```

- [ ] **Step 8: Run them green, with the suites that meet the step.** From inside `server/`, each in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-export.test.ts
./node_modules/.bin/vitest run test/history-lib.test.ts
./node_modules/.bin/vitest run test/history-recover.test.ts
./node_modules/.bin/vitest run test/history-sweep.test.ts
node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected: every case green and tsc silent. Measured at `e4936efab` with this task alone (and a stand-in for Task 3's two functions), before the damaged-segment case replaced the cut-short case (the count is unchanged; the damaged case's green is predicted):
- `history-export` 90 passed (91 with the stop-record case, predicted);
- `history-recover` and `history-lib` green;
- `history-sweep` 37 passed;
- no tsc error in a history file.

Why these suites run:
- `history-recover`: its adopt, restore and rebuild cases meet the step after their bind. The bind arms the check as before, and its done stamp now also writes `export_marks_checked_listing`.
- `history-sweep`: every tick now runs the listing measurement (one readdir).

A red in a file the root `CLAUDE.md` lists as a known load flake is re-run alone before it is called a break.

- [ ] **Step 9: Mutations: each new guard reds its case.** From the repository root, `SCRATCH="$PWD/.superpowers/sdd/history-w5h1/scratch"; mkdir -p "$SCRATCH"; cp ccd/history/sweep.mjs "$SCRATCH/sweep.mjs.w5h4"; cp ccd/history/lib.mjs "$SCRATCH/lib.mjs.w5h4"` (the plan's scratch directory, Global Constraints "Red-first"). For each row:
- apply the mutation by hand;
- run, from inside `server/`, `./node_modules/.bin/vitest run test/<file> -t '<filter>'`;
- see it red;
- restore both files with `cp` before the next row.

Never `git stash`. Every red below was measured at `e4936efab` with this task applied. In the table, `\|` is Markdown's escape for a pipe inside a cell: type `|`, so `\|\|` is `||`. Unescaped, the two texts that hold one:

```text
decideMarkCheck:        `check: vanished === true || facts.some(`  becomes  `check: facts.some(`
segmentListingVanished: `  return was.count !== now.count || was.digest !== now.digest;`  becomes  `  return was.count !== now.count;`
```

| Mutation | File, `-t` filter | Expected red |
|---|---|---|
| `lib.mjs` `decideMarkCheck` ignores `vanished`: in its return line change `check: vanished === true \|\| facts.some(` to `check: facts.some(` | `history-export.test.ts`, `the check runs on the first step after a bind` | `a segment gone after the check left its marks standing: expected [ '1.<writer>.db', '1.<writer>.db' ] to deeply equal [ null, null ]` |
| the same | `history-lib.test.ts`, `decideMarkCheck: vanished checks` | `expected { check: false, facts: [], …(1) } to deeply equal { Object (check, facts, ...) }` |
| `markExported` does not add its name: delete the line `    if (listed !== null) setMeta(db, EXPORT_MARKS_CHECKED_LISTING_META, listed);` | `history-export.test.ts`, `a segment a pass published does not re-arm` | `a step re-armed the check on the pass's own segment: expected '<NOW + 2 min>' to be null` |
| `markExported` starts the record over: change `addSegmentToListing(getMeta(db, EXPORT_MARKS_CHECKED_LISTING_META), m.name)` to `addSegmentToListing(null, m.name)` | `history-export.test.ts`, `a segment that goes before a pass` | `the pass's record forgot the segment that went before it: expected { …(2) } to deeply equal { …(2) }` |
| the done stamp records no listing: delete the line `    if (listing !== null) setMeta(db, EXPORT_MARKS_CHECKED_LISTING_META, listing);` | `history-export.test.ts`, `a carry that adds a segment` | `the check did not record the listing it saw: every step checks again: expected '<NOW + 3 min>' to be '<NOW + 2 min>'` |
| `segmentListingVanished` compares counts only: change `  return was.count !== now.count \|\| was.digest !== now.digest;` to `  return was.count !== now.count;` | `history-export.test.ts`, `a carry that adds a segment` | `a segment gone behind a carry of the same count left its marks standing: expected [ '1.<writer>.db', '1.<writer>.db' ] to deeply equal [ null, null ]` |
| the same | `history-lib.test.ts`, `segmentListingVanished: any difference` | `one gone and one carried in, the count unchanged: expected false to be true` |
| the stale-record delete reads an unmeasured listing as "no check owed": in `exportStep`, replace `  if (!markCheck.check && listing !== null && (getMeta(db, HEALTH_META.exportMarksCheck) !== null || getMeta(db, EXPORT_MARKS_COUNTED_META) !== null)) {` with Task 1's `  if (!markCheck.check && (getMeta(db, HEALTH_META.exportMarksCheck) !== null || getMeta(db, EXPORT_MARKS_COUNTED_META) !== null)) {` | `history-export.test.ts`, `a listing that fails never deletes the stop record` | `an unmeasured listing deleted the stop record of a check it could not see finish: expected null to be 'budget <ms> 2'` (predicted) |
| an unlistable directory measured as empty: in `measureSegmentListing` change `catch { return null; }` to `catch { return segmentListingRecord([]); }` | `history-export.test.ts`, `CONTROL: a listing that fails` | `an unlistable directory was read as a segment gone: expected 1 to be undefined` |
| `segmentListingVanished` reads an unmeasured listing as gone: change `  if (measured === null) return false;` to `  if (measured === null) return true;` | `history-export.test.ts`, `CONTROL: a listing that fails` | `an unlistable directory was read as a segment gone: expected 1 to be undefined` |
| the same | `history-lib.test.ts`, `segmentListingVanished: any difference` | `a listing that could not be measured is never vanished: expected true to be false` |
| the listing counts only whole names (a damaged name left out): in `measureSegmentListing` change `segs.map((x) => x.name)` to `segs.filter((x) => decideSegmentWhole(segmentFileFacts(exportDirFor(ctx.paths, ctx.ids.storeId) + '/' + x.name)) === 'whole').map((x) => x.name)` (both names are Task 3's sweep imports) | `history-export.test.ts`, `a damaged segment moved out` | predicted: `the record counts the damaged name: expected '0 <32 zeros>' to be '1 <32 hex>'` |
| an order-dependent digest: in `segmentListingDigest` insert `  return createHash('sha256').update([...new Set(names)].join('\n'), 'utf8').digest('hex').slice(0, 32);` as its first line | `history-lib.test.ts`, `segmentListingDigest: the XOR` | `the same set in another order: expected '<hex>' to be '<hex>'` |
| no record never re-arms: change `  if (recorded === null) return now.count > 0;` to `  if (recorded === null) return false;` | `history-lib.test.ts`, `segmentListingVanished: any difference` | `segments that predate the record: one check records them: expected false to be true` |
| a torn record re-arms nothing: change `  if (was === null) return true;` to `  if (was === null) return false;` | `history-lib.test.ts`, `segmentListingVanished: any difference` | `a torn record "" fails toward a check: expected false to be true` |
| B4 Task 8's clock mutant, through this task's edit: in `decideMarkCheck`'s return line replace `facts.some((k) => !have.has(k))` with `facts.some((k) => Number(k.slice(6)) > Math.max(0, ...[...have].map((c) => Number(c.slice(6)))))` | `history-export.test.ts`, `never their clocks` | `a bind stamped before the last check was never checked: expected [ '1.<writer>.db', '1.<writer>.db' ] to deeply equal [ null, null ]` |

After the last restore:
- run `history-export.test.ts` and `history-lib.test.ts` whole, green once more;
- `cmp "$SCRATCH/sweep.mjs.w5h4" ccd/history/sweep.mjs` and `cmp "$SCRATCH/lib.mjs.w5h4" ccd/history/lib.mjs` print nothing;
- remove this task's two copies, `rm "$SCRATCH"/*.w5h4`, and leave the directory.

- [ ] **Step 10: The spec is Task 7's.** No edit here. Task 7's Step 7 states this trigger in §9.15 "After a bind", citing D-5636.

- [ ] **Step 11: Commit**, from the repository root:

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs server/test/history-lib.test.ts server/test/history-export.test.ts
git commit -m "feat(history): the export mark check re-arms when a segment it saw is gone, from a count-and-digest listing record (W5h-1 Task 4, D-5636)"
```

---

### Task 5: replay marks by the last carrier (scope b4-read-residuals, item 6; review 621 F3; D-5637)

**Files:**
- Modify: `ccd/history/lib.mjs`. Anchors were measured at `e4936efab`; re-anchor by content.
  - In `orderSegmentNames` (:8163), the sort line `  parsed.sort((a, b) => a.seq - b.seq || (a.writer < b.writer ? -1 : a.writer > b.writer ? 1 : 0));` (:8169) becomes `  parsed.sort(segmentPartsOrder);`.
  - Two functions go directly below `orderSegmentNames`' closing `}`, above `nextSegmentSeq`'s doc comment.
  - One line of `segmentMayMarkEntry`'s doc comment changes (:8356, ` *  (the entry is marked by the first segment that carries it), and the loss of that segment clears the blob's referrers with`).
- Modify: `ccd/history/lib.d.mts`: add one line directly below `export function orderSegmentNames(names: readonly string[]): string[];` (:944).
- Modify: `ccd/history/sweep.mjs`:
  - the `from './lib.mjs'` import (:65, the line ending `orderSegmentNames, entryMayHoldMark, segmentMayMarkEntry,`) gains `segmentOrdersAfter`;
  - the W1-B4 Task 10 export-replay header comment, two places (:2628-2629 `export-blobs`; :2646-2647 `entry an earlier segment marked already is not marked again;`);
  - in `replayStmts(db)`:
    - `blobMark:` (:2677) loses its `AND exported_ms IS NULL` and gains a two-line comment;
    - a new member `blobMarkOf:` goes directly below `blobMark:`;
    - the `entrySel` comment's two lines change (:2703-2704);
    - `entryMark:` (:2706) loses its `AND exported_ms IS NULL`;
  - in `replayEntryRow` (:2797), everything from `  // D-5395: the segment holds this row's bytes` (:2808) through the function's closing `}` (:2821) is replaced;
  - in `replayBlobPage`, one doc line (:3009) and two body lines (:3022-3023);
  - in `ingestSidecar`, the last three lines of the D-5399 comment (:5265-5267).
- Modify: `docs/superpowers/plans/2026-10-07-ccrc-history-w1-b4-export.md`: three appended sentences (:7864, :7993, :7996). These are history notes that point to this plan, not rewrites.
- Test: `server/test/history-lib.test.ts`:
  - one case below `orderSegmentNames is (seq, writer) …` (:7990-7993);
  - one title (:8361).
- Test: `server/test/history-recover.test.ts`:
  - F6's continuation, inside its `it` body after the `for (const r of reads.filter((x) => !x.asserted)) {…}` loop (:4447-4449);
  - the re-expected D-5396 cases (:4714-4833) and D-5397 cases (:4951, :4971, :4998, :5024);
  - a new describe directly above `// ── W1-B4 whole-branch review: replay resumes after a segment the operator moved aside (D-4765's way out)` (:4841).
- Test: `server/test/history-export.test.ts`: `D-5396, F1c, end to end` (:1358-1364, :1398-1399, :1415-1431) and `D-5397, end to end` (:1502).

**Interfaces:**
- Consumes:
  - lib `parseSegmentName(name): { seq; writer } | null` and `orderSegmentNames(names)` (B4 Task 1); `segmentMayMarkEntry({ blobs })` (D-5396). Its rule is unchanged: the coordinator's pin keeps it for entries over pruned, unmarked blobs.
  - sweep `replayStmts(db)`, `stmts(db).exportClear` (B4 Task 8), `blobStateIn(seg, b, markNamesSeg)` and `segmentCarries` (D-5396), and `replayBlobPage(db, run, sdb, dir, name, after, stubs)` (D-5397).
  - `unmarkEntryOverBlobIn(db, seg, entry, blobId)` stays as it is. Its "entry marked by another segment" arm is now reached only where the mark names a segment that does not order before the row's segment, which is a restore's backup. This task's restore-shaped case pins that arm.
  - The check after a bind, as Tasks 1, 3 and 4 leave it, reached only through the tick (`runDriver`). The contract relied on: the first tick after a new bind fact (here a real `doctor --adopt`) clears every blob and entry mark that names a segment missing from `export/<store_id>/`, along with that blob's referrers (D-5395, D-5396). It bumps `export_segment_missing` once per check (Task 1's flag; this fixture is one batch, so one step), and the export pass still runs in the same tick (R3). Task 4's listing record also differs here (segment 2 left the directory), which arms the same one check.
  - Test side:
    - history-recover's module scope: `x10Store`, `x10Texts`, `x10Rows`, `x10U`, `x10Count`, `X10_WRITER`, `X10_DEV`, `X10_DAY`, `X10Family`, `stepCtx`, `countersOn`, `plantSegment`, `segmentSha`, `exportDirOf`, `strandedBlobsOn`, `SW.recoveryStep`;
    - F6's own scope: `F6_*`, `f6Ask`, `reads`, `ask`, `leafOf`, `blobSha`, `both`, `seg2`, `names`, `journal`;
    - `rrRoot`, `rrLose`, `rrTickUntil`, `rrRecovered`, `cliOnPty`, `runDriver`, `counters`, `metaOf`, `countOf`, `segmentsOf`, `segmentRows`.
- Produces:
  - lib `export function segmentOrdersAfter(a: string, b: string | null): boolean`. It answers whether segment `a` orders strictly after `b` in `orderSegmentNames`' (seq, writer) order:
    - `b` null, or `b` off the segment grammar, names no carrier, so the answer is `true`;
    - `a` off the grammar throws `TypeError` (a caller's bug: replay's names come from the listing);
    - a name is never after itself.
  - Module-private `segmentPartsOrder(a, b)` is the one comparator that `orderSegmentNames` and `segmentOrdersAfter` share.
  - `lib.d.mts`: `export function segmentOrdersAfter(a: string, b: string | null): boolean;`.
  - sweep `replayStmts(db).blobMarkOf`: `SELECT exported_seg AS seg FROM blobs WHERE sha256 = ? AND z IS NOT NULL`.
  - `blobMark` and `entryMark` no longer keep a mark in SQL. The sweep asks `segmentOrdersAfter` before it runs either. `replayEntryRow` takes the older mark off (`exportClear`) when a later carrier may not mark the entry.
  - No schema change, no meta key, no counter, no health word.

**Spec and rulings:**
- §9.14 "Export replay" (rev 3.6) says "Replayed blobs and rows are marked with their segment, the first segment that carries them". This task departs from that text: NEW D-5637 (`history-export-replay-last-carrier`). The spec text is Task 7's: its Step 7 amends that sentence in place, citing D-5637; this task edits no spec.
- Coordinator ruling R8 reverses the coordinator's own first-wins convention: the ask-58 amendment, and D-5396's refinement ("an exported blob still licenses the first segment that carries the row"). This closes review 621 F3's residual.
- Cited:
  - D-5395 (an entry is marked only while every blob it references is exported or pruned);
  - D-5396 (a pruned, unmarked blob licenses a mark only in a segment that carries it);
  - D-5397 (bytes before stubs; insert-or-ignore);
  - D-5399 (the unlinked row whose re-export is the F3 shape);
  - D-4765 (a segment moved aside).
- Why it is sound:
  - Every export of an entry writes everything the store held of it at the time: every variant, its boundary, every linked sidecar and every membership.
  - Every carried blob carries every unlinked row that names it.
  - Nothing in `ccd/history` deletes or updates those rows.
  - So a later carrier holds everything an earlier one did, and the last carrier's mark is the one whose loss must make the row due again.
- The one non-superset shape is two writers at one seq: a directory carried in from another box. The take-off arm covers it, and the `a later carrier that lacks` case pins it.
- Not in this task: R12, the operator's restore question. Keep bytes out over a held tombstone. This task adds nothing there; `export_blob_tombstone_kept` still counts.

- [ ] **Step 1: Write the failing tests.**

(a) `server/test/history-lib.test.ts`: insert this case directly below the case `orderSegmentNames is (seq, writer) with seq numeric, never the names\' lexical order; a non-segment is dropped` (its closing `  });`):

```ts
  it('segmentOrdersAfter is orderSegmentNames\' order, strict: a later seq, or the same seq and a later writer; never itself or an earlier one; no mark, or a mark off the grammar, names no carrier (D-5637 (history-export-replay-last-carrier))', () => {
    expect(libSeg.segmentOrdersAfter('10.0000000a.db', '9.ffffffff.db'), 'seq is numeric, never lexical').toBe(true);
    expect(libSeg.segmentOrdersAfter('9.ffffffff.db', '10.0000000a.db')).toBe(false);
    expect(libSeg.segmentOrdersAfter('9.ffffffff.db', '9.0000000b.db'), 'the same seq: the writer token decides').toBe(true);
    expect(libSeg.segmentOrdersAfter('9.0000000b.db', '9.ffffffff.db')).toBe(false);
    expect(libSeg.segmentOrdersAfter('9.0000000b.db', '9.0000000b.db'), 'never after itself: a page replayed again moves nothing').toBe(false);
    expect(libSeg.segmentOrdersAfter('1.0000000a.db', null), 'no mark').toBe(true);
    expect(libSeg.segmentOrdersAfter('1.0000000a.db', 'notes.db'), 'a mark off the grammar names no carrier').toBe(true);
    expect(() => libSeg.segmentOrdersAfter('01.0000000a.db', null), 'the replayed name is the caller\'s, from the listing').toThrow(TypeError);
    const names = libSeg.orderSegmentNames(['10.0000000a.db', '9.ffffffff.db', '9.0000000b.db', '2.0000000c.db', '2.0000000b.db']);
    for (let i = 0; i < names.length; i += 1) {
      for (let j = 0; j < names.length; j += 1) expect(libSeg.segmentOrdersAfter(names[i]!, names[j]!), `${names[i]!} after ${names[j]!}: one order with orderSegmentNames`).toBe(i > j);
    }
  });
```

In the same file, change only the title of the case at :8361. `segmentMayMarkEntry`'s rule is unchanged; only "first wins" was false:

```ts
  it('an exported blob licenses the mark whether or not the segment carries it, pruned since or not: first wins stays for what is exported', () => {
```
becomes
```ts
  it('an exported blob licenses the mark whether or not the segment carries it, pruned since or not: any carrier of the row may take it (replay gives it to the last, D-5637)', () => {
```

(b) `server/test/history-recover.test.ts`, F6 (D-5399): review 621 F3's double fault, end to end on the real verbs, in both journal arms. Inside the F6 `it` body, directly below the loop that ends the case:

```ts
      for (const r of reads.filter((x) => !x.asserted)) {
        expect([after[r.key]!.exit, after[r.key]!.hasS, after[r.key]!.hasShared], `${r.key} answers as before`).toEqual([before[r.key]!.exit, before[r.key]!.hasS, before[r.key]!.hasShared]);
      }
```
insert:
```ts

      // ── Review 621 F3, the double fault, closed by D-5637 (history-export-replay-last-carrier). The rebuild marks the blob,
      // and T1's tool_result row that segment 2 carried again, by segment 2: the LAST segment that carries them, and the only
      // one that holds S's row. Then segment 2 is lost too (moved aside), an adopt binds the store again, its first tick checks
      // the marks and runs a pass, and a second rebuild from the live segments alone must still place S. Under first-wins every
      // mark named segment 1, so the check cleared nothing, no pass wrote S again (export_due 0), and after the second
      // rebuild all six scoped greps missed S (review 621's measurement).
      expect(rrQ(box, 'SELECT exported_seg AS seg FROM blobs WHERE lower(hex(sha256)) = ?', blobSha),
        'D-5637: the rebuild marked the blob by its last carrier, the one segment that holds S\'s row').toEqual([{ seg: both[1]! }]);
      expect(rrQ(box, 'SELECT exported_seg AS seg FROM entries WHERE uuid = ?', rrU(611)),
        'D-5637: and T1\'s tool_result row, which segment 2 carried again with the blob').toEqual([{ seg: both[1]! }]);
      expect(metaOf(box, 'export_marks_checked_binds'), 'CONTROL: the check after the rebuild\'s bind ran before segment 2 went, so its loss needs a bind of its own').not.toBeNull();
      // Segment 2 is lost: the store is adopted on a box its export directory came to without that segment (§8.4's carry,
      // not done for it).
      const aside = path.join(box.home, 'export-aside');
      fs.mkdirSync(aside);
      fs.renameSync(seg2, path.join(aside, both[1]!));
      fs.rmSync(rrRoot(box).storeId);
      fs.rmSync(rrRoot(box).writer);
      const adopted = await cliOnPty(box, ['doctor', '--adopt']);
      expect(adopted.code, adopted.out).toBe(0);
      const checked = runDriver(box, { offsetMs: 9 * F6_HOUR });   // the first tick after the adopt: the bind check, then the pass
      expect(checked.code, `${checked.stdout}\n${checked.stderr}`).toBe(0);
      expect(counters(box)['export_segment_missing'], 'the check found segment 2 missing and cleared the marks naming it').toBe(1);
      const live = segmentsOf(box).map((n) => path.basename(n));
      expect(live, 'segment 1 and the one the pass wrote').toHaveLength(2);
      expect(live[0]).toBe(names[0]);
      const seg3 = path.join(exportDirOf(box), live[1]!);
      expect(segmentRows(seg3, 'sidecars').map((x) => [x['name'], x['uuid']]).sort(), 'the pass wrote S again, with the blob and T1\'s linked row')
        .toEqual([[F6_ORPHAN, null], [F6_SHARED, rrU(611)]]);
      expect(segmentRows(seg3, 'blobs').map((b) => b['sha256'])).toEqual([blobSha]);
      // The second rebuild, from segment 1 and the segment the pass wrote.
      rrLose(box, { binding: false, journal });
      const again = await cliOnPty(box, ['doctor', '--rebuild']);
      expect(again.code, again.out).toBe(0);
      rrTickUntil(box, () => rrRecovered(box) && countOf(box, 'entries') === 8 && leafOf(F6_ID2).length === 1, 12);
      const twice = ask();
      const lost = reads.filter((r) => r.asserted && !twice[r.key]!.hasS).map((r) => r.key);
      expect(lost, `scoped reads that no longer find S after the second rebuild:\n${reads.map((r) => `${r.key}: ${JSON.stringify(twice[r.key])}`).join('\n')}`).toEqual([]);
```

Measured at `e4936efab` with this task's code: the rebuild's own bind is checked before the case reaches this point (`export_marks_checked_binds` is set). That is why the case makes its own bind with a real `doctor --adopt`, never a planted meta row. Each arm took about 17 s.

(c) `server/test/history-recover.test.ts`: the new describe, inserted directly above `// ── W1-B4 whole-branch review: replay resumes after a segment the operator moved aside (D-4765's way out) ───────────`:

```ts
// ── wave 5h-1: replay marks by the LAST carrier (D-5637 (history-export-replay-last-carrier)), closing review 621 F3 ────────
// Every export of an entry writes all the store holds of it, and every export of a blob carries every unlinked row naming it,
// and nothing deletes those rows, so a later segment that carries a row holds everything an earlier one did. Replay used to
// mark by the FIRST carrier, so a row that only a later segment holds (a late variant over bytes another entry exported, a
// later unlinked sidecar row) had no mark naming its one carrier: once that segment was lost, the check after a bind cleared
// nothing and nothing exported the row again. In-process on planted segments; the real verbs are F6's double fault above.
describe('D-5637: export replay marks an entry and a blob by the last segment that carries them (wave 5h-1; review 621 F3)', () => {
  const seg = (n: number): string => `${n}.${X10_WRITER}.db`;
  const marksOf = (db: DatabaseSync): Array<string | null> =>
    db.prepare('SELECT exported_seg AS seg FROM entries ORDER BY ts_ms, entry_id').all().map((r) => (r as { seg: string | null }).seg);
  const blobMarkOf = (db: DatabaseSync, text: string): string | null =>
    (db.prepare('SELECT exported_seg AS seg FROM blobs WHERE sha256 = ?').get(segmentSha(text)) as { seg: string | null }).seg;
  const stub = (text: string): PlantSegmentBlob => ({ text: null, sha256: segmentSha(text), rawLen: text.length });

  it('the variant probe: segment 2 carries an entry again with a late variant over bytes segment 1 exported with another entry; the entry is marked by segment 2, the only one that holds that link', async () => {
    const { box, ids, db } = x10Store('ccrc-history-d5637-variant-');
    try {
      const t0 = Date.now() - 400 * X10_DAY;
      const texts = x10Texts(0x1700, 2, 'zqd5637v', t0);
      const fam: X10Family = { uuid: x10U(0x17), path: '/home/u/gone/d5637v.jsonl', ino: 9951, texts };
      const variant = (i: number, text: string): PlantSegmentRow => ({ kind: 'variant', row: {
        uuid: texts[i]!.uuid, blob_sha256: segmentSha(text), first_path: fam.path, first_dev: X10_DEV, first_ino: fam.ino, first_seen_ms: t0 + 5, cause: 'unknown',
      } });
      // Segment 1: E0 and E1 with their bytes. E0 then gains a variant whose body is E1's (already exported), so the pass
      // writes E0 again with both its variants and no bytes: segment 2.
      plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })), rows: x10Rows(fam) });
      plantSegment(box, ids.storeId, { seq: 2, writer: X10_WRITER, blobs: [], rows: [
        ...x10Rows({ ...fam, texts: [texts[0]!] }), variant(0, texts[0]!.text), variant(0, texts[1]!.text),
      ] });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(x10Count(db, 'entry_variants'), 'CONTROL: segment 2 linked E0 to the second body').toBe(2);
      expect(marksOf(db), 'E0 is marked by segment 2, the last segment that carries it and the only one with its late variant; E1 by segment 1')
        .toEqual([seg(2), seg(1)]);
      expect([blobMarkOf(db, texts[0]!.text), blobMarkOf(db, texts[1]!.text)], 'segment 2 carries no bytes, so each blob keeps segment 1').toEqual([seg(1), seg(1)]);
      expect(strandedBlobsOn(db)).toEqual([]);
      expect(countersOn(db, 'export_row_blob_missing', 'export_row_unplaced')).toEqual({ export_row_blob_missing: 0, export_row_unplaced: 0 });
    } finally {
      closeWriter(db);
    }
  });

  it('the unlinked-row probe: segment 2 carries a blob\'s bytes again with a new unlinked sidecar row (D-5399\'s re-export); the blob is marked by segment 2, and so is the entry segment 2 carried again', async () => {
    const { box, ids, db } = x10Store('ccrc-history-d5637-unlinked-');
    try {
      const t0 = Date.now() - 400 * X10_DAY;
      const texts = x10Texts(0x1800, 2, 'zqd5637u', t0);
      const fam: X10Family = { uuid: x10U(0x18), path: '/home/u/gone/d5637u.jsonl', ino: 9952, texts };
      const out = 'zqd5637u the saved tool output';
      const sidecar = (name: string, uuid: string | null): PlantSegmentRow => ({ kind: 'sidecar', row: {
        cc_session_uuid: fam.uuid, agent_id: '', name, blob_sha256: segmentSha(out), uuid, first_seen_ms: t0 + 5,
      } });
      // Segment 1: E0 links the output through its sidecar, the bytes with it. Segment 2: an unlinked row naming the same bytes
      // took the blob's mark off and its referrer's (D-5399), so the pass carried the bytes again, E0 with its linked row, and
      // the unlinked row.
      plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: [...texts.map((t) => ({ text: t.text })), { text: out }],
        rows: [...x10Rows(fam), sidecar('d5637u-linked.txt', texts[0]!.uuid)] });
      plantSegment(box, ids.storeId, { seq: 2, writer: X10_WRITER, blobs: [{ text: out }],
        rows: [...x10Rows({ ...fam, texts: [texts[0]!] }), sidecar('d5637u-linked.txt', texts[0]!.uuid), sidecar('d5637u-orphan.txt', null)] });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(db.prepare('SELECT name, entry_id IS NULL AS unlinked FROM sidecars ORDER BY name').all().map((r) => ({ ...(r as object) })), 'CONTROL: both rows placed')
        .toEqual([{ name: 'd5637u-linked.txt', unlinked: 0 }, { name: 'd5637u-orphan.txt', unlinked: 1 }]);
      expect(blobMarkOf(db, out), 'the blob is marked by segment 2, the last that carries its bytes and the only one with the unlinked row').toBe(seg(2));
      expect(marksOf(db), 'E0, carried again by segment 2, is marked by it; E1 keeps segment 1').toEqual([seg(2), seg(1)]);
      expect(strandedBlobsOn(db)).toEqual([]);
    } finally {
      closeWriter(db);
    }
  });

  it('a mark naming a segment that orders AFTER the one being replayed stays, on an entry and on a blob, as a restore\'s backup holds it; a row of the earlier segment that links a pruned, unmarked blob to such an entry still takes its mark off (D-5396)', async () => {
    const { box, ids, db } = x10Store('ccrc-history-d5637-later-');
    try {
      const t0 = Date.now() - 400 * X10_DAY;
      const texts = x10Texts(0x1900, 2, 'zqd5637l', t0);
      const fam: X10Family = { uuid: x10U(0x19), path: '/home/u/gone/d5637l.jsonl', ino: 9953, texts };
      const late = 'zqd5637l late body, pruned before the pass';
      const variant: PlantSegmentRow = { kind: 'variant', row: {
        uuid: texts[1]!.uuid, blob_sha256: segmentSha(late), first_path: fam.path, first_dev: X10_DEV, first_ino: fam.ino, first_seen_ms: t0 + 5, cause: 'unknown',
      } };
      const every = { blobs: [...texts.map((t) => ({ text: t.text })), stub(late)], rows: [...x10Rows(fam), variant] };
      plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })), rows: x10Rows(fam) });
      plantSegment(box, ids.storeId, { seq: 2, writer: X10_WRITER, ...every });
      plantSegment(box, ids.storeId, { seq: 3, writer: X10_WRITER, ...every });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(marksOf(db), 'CONTROL: the first replay marks both entries by segment 3, the last carrier').toEqual([seg(3), seg(3)]);
      expect(texts.map((t) => blobMarkOf(db, t.text)), 'CONTROL: and both bodies').toEqual([seg(3), seg(3)]);
      // The store now holds marks naming segment 3, as a backup taken after its pass does; segment 3 is not on this box, and a
      // replay of segments 1 and 2 (a restore's) runs over those marks.
      fs.renameSync(path.join(exportDirOf(box), seg(3)), path.join(box.home, seg(3)));
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now() + 5000);
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(texts.map((t) => blobMarkOf(db, t.text)), 'a blob marked by a later segment keeps that mark: segments 1 and 2 order before it').toEqual([seg(3), seg(3)]);
      expect(marksOf(db), 'E0 keeps segment 3; E1 loses it, because segment 2\'s variant row links the pruned late body and what segment 3 carries is not measured (D-5396\'s over-clear, never a loss): the check after the restore\'s bind clears E0 with the missing segment')
        .toEqual([seg(3), null]);
      expect(strandedBlobsOn(db)).toEqual([]);
    } finally {
      closeWriter(db);
    }
  });

  it('a later carrier that lacks a pruned, unmarked blob the entry needs takes the earlier mark off too, so the next pass writes the entry with the stub: the same seq from two writers, a directory carried in from another box (over-clearing, never a loss)', async () => {
    const { box, ids, db } = x10Store('ccrc-history-d5637-lacks-');
    try {
      const t0 = Date.now() - 400 * X10_DAY;
      const texts = x10Texts(0x1a00, 2, 'zqd5637k', t0);
      const fam: X10Family = { uuid: x10U(0x1a), path: '/home/u/gone/d5637k.jsonl', ino: 9954, texts };
      const OTHER = 'ffffffff';   // orders after X10_WRITER at the same seq
      // E0's own body was pruned before any pass: segment 1 of this writer carries its stub; segment 1 of the other writer
      // carries E0's row without it. E1 is live and carried by both.
      plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: [stub(texts[0]!.text), { text: texts[1]!.text }], rows: x10Rows(fam) });
      plantSegment(box, ids.storeId, { seq: 1, writer: OTHER, blobs: [{ text: texts[1]!.text }], rows: x10Rows(fam) });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(countersOn(db, 'export_row_blob_missing', 'export_row_unplaced'), 'CONTROL: both rows placed').toEqual({ export_row_blob_missing: 0, export_row_unplaced: 0 });
      expect(marksOf(db), 'E0 is unmarked: the later carrier holds its row without the stub, and the earlier mark goes with it; E1 is marked by the later carrier')
        .toEqual([null, `1.${OTHER}.db`]);
      expect(strandedBlobsOn(db)).toEqual([]);
    } finally {
      closeWriter(db);
    }
  });
});

```

Every name the describe uses is already imported or defined at module scope: `fs`, `path`, `DatabaseSync`, `closeWriter`, `segmentSha`, `plantSegment`, `exportDirOf`, `strandedBlobsOn`, the `PlantSegmentRow` and `PlantSegmentBlob` types, and the x10 helpers. No import changes.

(d) `server/test/history-recover.test.ts`: re-expect the D-5396 cases that pinned first-wins. Each edit says why it changed.

`D-5396, refined`: under the new rule, E4, whose stub is in both segments, goes to segment 2. Replace the comment's last two lines and the title (:4716-4718):
```ts
  // what the entry needs, as the pass's does (planSegment stubs those blobs in the segment that marks the entry). First wins
  // stays for what is exported: its bytes are where its own mark names, and losing that segment clears the entry with the blob.
  it('D-5396, refined: an entry whose own blob is pruned and unmarked is marked by the first segment that carries that blob (its stub or its bytes), not by an earlier one that carries the row without it; one no segment carries stays unmarked; a pruned blob that was exported licenses the first segment whatever it carries', async () => {
```
with
```ts
  // what the entry needs, as the pass's does (planSegment stubs those blobs in the segment that marks the entry). Among the
  // segments that may mark it, the LAST takes the mark (D-5637 (history-export-replay-last-carrier), wave 5h-1, reversing the
  // first-wins this case pinned for E4). An exported blob licenses any of them: its bytes are where its own mark names, and
  // losing that segment clears the entry with the blob.
  it('D-5396, refined: an entry whose own blob is pruned and unmarked is marked by the last segment that carries that blob (its stub or its bytes), never by one that carries the row without it; one no segment carries stays unmarked; a pruned blob that was exported licenses a segment whatever it carries', async () => {
```
At :4732, change `      // segments (first wins among the carriers). E5: a live blob, carried by segment 1.` to `      // segments (the last of the carriers takes it, D-5637). E5: a live blob, carried by segment 1.`. At :4740-4741, replace
```ts
      expect(marksOf(db), 'E0 is marked by segment 2, which carries its stub, not by segment 1; E1 stays unmarked: no segment carries its blob; E2 is marked by segment 1, which carries its bytes; E3 by segment 1 (exported); E4 by the first of the two that carry its stub; E5 by segment 1')
        .toEqual([`2.${X10_WRITER}.db`, null, D_SEG, D_SEG, D_SEG, D_SEG]);
```
with
```ts
      expect(marksOf(db), 'E0 is marked by segment 2, which carries its stub, not by segment 1; E1 stays unmarked: no segment carries its blob; E2 is marked by segment 1, which carries its bytes; E3 by segment 1 (exported); E4 by segment 2, the last of the two that carry its stub (D-5637: first-wins gave segment 1); E5 by segment 1')
        .toEqual([`2.${X10_WRITER}.db`, null, D_SEG, D_SEG, `2.${X10_WRITER}.db`, D_SEG]);
```

The planted `D-5396, F1c` case: segment 2's own entry rows now move each mark to segment 2 before its rows link the pruned bodies, so the rows keep the mark. The arm that clears an entry marked by another segment is pinned by (c)'s restore-shaped case. Replace the comment's last two lines and the title (:4755-4757):
```ts
  // and the stub. Planted here for the three arms (a variant, a linked sidecar, a kept blob); the real flow is in
  // history-export.test.ts.
  it('D-5396, F1c: a row of a later segment that links a pruned, unmarked blob clears an entry an EARLIER segment marked, whichever of the three row kinds it is; one marked by that same segment keeps its mark when the segment carries the blob, and an exported blob clears nothing', async () => {
```
with
```ts
  // and the stub. Planted here for the three arms (a variant, a linked sidecar, a kept blob); the real flow is in
  // history-export.test.ts. Since D-5637 (history-export-replay-last-carrier, wave 5h-1) segment 2's own entry row moves each
  // entry's mark to segment 2 before its rows link the pruned bodies, so the rows meet an entry marked by the segment that
  // carries their stubs, and the mark stays. The arm that clears an entry another segment marks is reached now only where the
  // mark names a segment that does not order before the row's (a restore's backup): the D-5637 describe below pins it.
  it('D-5396, F1c: a row of a later segment that links a pruned, unmarked blob it carries keeps the mark its own entry row moved to that segment (D-5637), whichever of the three row kinds it is, and an exported blob clears nothing', async () => {
```
and at :4787-4788 replace
```ts
      expect(marksOf(db), 'E0 (a variant), E1 (a sidecar) and E2 (a kept blob): unmarked, each over a pruned blob segment 1 does not carry; E3 is marked by segment 2, which carries its stub; E4 keeps segment 1 over an exported blob')
        .toEqual([null, null, null, `2.${X10_WRITER}.db`, D_SEG]);
```
with
```ts
      expect(marksOf(db), 'E0 (a variant), E1 (a sidecar) and E2 (a kept blob): marked by segment 2, whose entry rows took the marks before its rows linked the pruned bodies it carries as stubs (D-5637: first-wins left segment 1\'s marks, and the rows cleared them); E3 by segment 2, which carries its stub; E4 by segment 2 too, over an exported blob')
        .toEqual(Array(5).fill(`2.${X10_WRITER}.db`));
```

The lookup cost pin `D-5396, F1c: an entry an earlier segment marked is not looked up …`: a later carrier's entry row may now take the mark, so it is asked. The lookups measured under the new rule go from 1 to 3. Replace the comment and the title (:4797-4800):
```ts
  // Minor 6 of review 614 (an optimisation that must keep replay's answers): an entry an earlier segment marked already is not marked
  // again (entryMark changes nothing on it), so the later segment's entry row asks that segment nothing; and a row that links a blob to
  // an entry marked by ANOTHER segment measures nothing in this one (it cannot count as carried there).
  it('D-5396, F1c: an entry an earlier segment marked is not looked up in a later segment: its entry row, and a row that links a pruned blob to it, cost no lookup in the later segment\'s blobs', async () => {
```
with
```ts
  // Minor 6 of review 614 (an optimisation that must keep replay's answers), as D-5637 (history-export-replay-last-carrier, wave 5h-1)
  // reshapes it: a segment is asked whether it carries a pruned, unmarked blob only where it may take or holds the entry's mark. A
  // later segment's entry row may take the mark from an earlier one (the last carrier wins), so it is asked; a segment that orders
  // before the mark is not (the D-5637 describe's restore case); and a row that links a blob to an entry marked by ANOTHER segment
  // measures nothing in this one (it cannot count as carried there).
  it('D-5396, F1c: a segment is looked up only where it may take or holds the entry\'s mark: segment 1 for E0\'s pruned own blob, segment 2 (the last carrier, D-5637) for it again and for the pruned late body its variant row links; an exported blob costs none', async () => {
```
and at :4831-4833 replace
```ts
      expect(lookups, 'one lookup in all: segment 1 is asked whether it carries E0\'s pruned own blob; segment 2\'s entry rows (both entries already marked) and its variant row (E0 is marked by segment 1) ask segment 2 nothing').toBe(1);
      expect(marksOf(db), 'the answers are unchanged by that: E0 was marked by segment 1, then its variant row on a pruned blob segment 1 does not carry took the mark off (F1c); E1 keeps segment 1')
        .toEqual([null, D_SEG]);
```
with
```ts
      expect(lookups, 'three lookups: segment 1 for E0\'s pruned own blob at its entry row; segment 2 for it again at E0\'s entry row there, which takes the mark (D-5637; first-wins asked nothing there); segment 2 for the pruned late body its variant row links to E0, now marked by segment 2; E1\'s exported blob costs none').toBe(3);
      expect(marksOf(db), 'E0 is marked by segment 2, which carries both its pruned bodies as stubs; E1 by segment 2, over an exported blob (D-5637: first-wins left E0 unmarked and E1 on segment 1)')
        .toEqual([`2.${X10_WRITER}.db`, `2.${X10_WRITER}.db`]);
```

(e) `server/test/history-recover.test.ts`: re-expect the D-5397 cases. Their bytes-before-stubs claims are unchanged; only the marks move to the last carrier.

The title at :4951:
```ts
  it('a stub in an earlier segment and the same blob\'s bytes in a later one, the two in separate passes: the bytes land, marked by the later segment; the entry is marked by the first segment that carries it; the text reads', async () => {
```
becomes
```ts
  it('a stub in an earlier segment and the same blob\'s bytes in a later one, the two in separate passes: the bytes land, marked by the later segment; the entry is marked by the last segment that carries it (D-5637); the text reads', async () => {
```
At :4971 the line
```ts
      expect(markOf(db, texts[0]!.uuid), 'replay\'s first-wins entry mark is unchanged: the first segment that carries the row').toBe(segName(1));
```
becomes
```ts
      expect(markOf(db, texts[0]!.uuid), 'the entry is marked by segment 2, the last segment that carries its row (D-5637: first-wins gave segment 1)').toBe(segName(2));
```
At :4998 (in `the bytes in an earlier segment and a stub of the same blob in a later one`) the line `      expect(markOf(db, texts[0]!.uuid)).toBe(segName(1));` becomes
```ts
      expect(markOf(db, texts[0]!.uuid), 'the entry is marked by segment 2, the last that carries its row; its blob keeps segment 1, which holds the bytes (D-5637: first-wins gave segment 1)').toBe(segName(2));
```
At :5024 (in `CONTROL: a tombstone the store held before the replay …`) the line `      expect(blobOf(db, texts[1]!.text)).toEqual({ stub: 0, pruned: 0, seg: segName(1) });` becomes
```ts
      expect(blobOf(db, texts[1]!.text), 'row 1\'s body is marked by segment 2, the last that carries its bytes (D-5637: first-wins gave segment 1)').toEqual({ stub: 0, pruned: 0, seg: segName(2) });
```

(f) `server/test/history-export.test.ts`, `D-5396, F1c, end to end`. The first rebuild now marks row 1 with segment 2, which holds the stub. Segment 2's loss clears that mark at the bind. The second rebuild marks row 1 with the segment the pass wrote. The extra export per rebuild that F1c accepted no longer happens: measured, there is no third export and no third rebuild. Replace the comment's last line and the title (:1363-1364):
```ts
  // nothing named it, no pass wrote row 1 again, and the (row 1, late body) link lived in the store alone: a later rebuild dropped it.
  it('D-5396, F1c, end to end: a late variant pruned before the pass; a rebuild from segments 1 and 2 leaves row 1 unmarked (segment 2\'s variant row links the pruned late body, which segment 1 does not carry); with segment 2 moved aside a pass writes row 1 again with the link and a stub, and a second rebuild places the link', async () => {
```
with
```ts
  // nothing named it, no pass wrote row 1 again, and the (row 1, late body) link lived in the store alone: a later rebuild dropped it.
  // Since D-5637 (history-export-replay-last-carrier, wave 5h-1) the rebuild marks row 1 with segment 2, its last carrier, which
  // holds the stub; segment 2's loss then clears that mark at the bind, and the over-clear F1c accepted (one more export per
  // rebuild) is gone: the second rebuild marks row 1 with the segment the pass wrote, and nothing is due after it.
  it('D-5396, F1c, end to end: a late variant pruned before the pass; a rebuild from segments 1 and 2 marks row 1 with segment 2, the last carrier, which holds the stub (D-5637); with segment 2 moved aside, a bind and a pass write row 1 again with the link and a stub, a second rebuild places the link and marks row 1 with that segment, and the next pass writes nothing', async () => {
```
At :1398-1399 replace
```ts
    expect(marks(box), 'D-5396, F1c: row 1 is NOT marked by segment 1 (the entry row marked it there, and segment 2\'s variant row then linked a pruned, unmarked blob that segment 1 does not carry); row 2 is')
      .toEqual({ [rid(1)]: null, [rid(2)]: s1 });
```
with
```ts
    expect(marks(box), 'D-5637: row 1 is marked by segment 2, the last segment that carries it, and the one that holds the stub of its late body (first-wins left it unmarked: segment 1\'s mark, then segment 2\'s variant row cleared it); row 2 by segment 1')
      .toEqual({ [rid(1)]: s2, [rid(2)]: s1 });
```
Then replace the case's tail, from the second `    await rebuildFromSegments(box);` (:1415) through `  }, 1_500_000);` (:1432):
```ts
    await rebuildFromSegments(box);
    expectRowOneComplete('the second rebuild');
    // The cost of the rule, measured: only the segment being replayed is open, so segment 1 (which marked row 1 at its entry row)
    // and the new segment's variant row on the pruned late body meet again, and row 1 reads unmarked once more. It is one more
    // export, never a loss: the new segment still holds the link and the stub.
    expect(marks(box), 'the second rebuild: the same shape again (the new segment\'s variant row, row 1 marked by segment 1), so row 1 is unmarked once more')
      .toEqual({ [rid(1)]: null, [rid(2)]: s1 });
    passAt(box, 270);   // the pass writes row 1 a third time; its entry row now meets an unmarked entry in the segment that carries the stub
    const third = segmentsOf(box);
    expect(third, 'the live segments: the two before and the third').toHaveLength(3);
    expect(segmentRows(path.join(exportDirOf(box), third[2]!), 'entries').map((e) => e['uuid']), 'the third carries row 1 again').toEqual([rid(1)]);
    await rebuildFromSegments(box);
    expectRowOneComplete('the third rebuild');
    expect(marks(box), 'the third rebuild marks row 1 with the third segment: its entry row meets the unmarked entry the second segment\'s variant row left, and every variant row of it names a blob it carries')
      .toEqual({ [rid(1)]: third[2], [rid(2)]: s1 });
    passAt(box, 340);
    expect(segmentsOf(box), 'and the next pass finds nothing due: the cost was one export').toEqual(third);
  }, 1_500_000);
```
with
```ts
    await rebuildFromSegments(box);
    expectRowOneComplete('the second rebuild');
    // D-5637: the new segment is row 1's last carrier and holds the link and the stub, so the second rebuild marks row 1 with it
    // (first-wins read row 1 unmarked once more here, and a third pass and a third rebuild followed).
    expect(marks(box), 'the second rebuild marks row 1 with the segment the pass wrote, its last carrier').toEqual({ [rid(1)]: live[1], [rid(2)]: s1 });
    passAt(box, 270);
    expect(segmentsOf(box), 'and the next pass finds nothing due: no export more than the lost segment cost').toEqual(live);
  }, 1_500_000);
```

(g) `server/test/history-export.test.ts`, `D-5397, end to end`: at :1502,
```ts
    expect(marks(box), 'row 2 is marked by the first segment that carries it').toEqual({ [rid(1)]: s1, [rid(2)]: s1 });
```
becomes
```ts
    expect(marks(box), 'row 2 is marked by segment 2, the last segment that carries it (D-5637: first-wins gave segment 1)').toEqual({ [rid(1)]: s1, [rid(2)]: s2 });
```

- [ ] **Step 2: Run them and see them fail.** From inside `server/`, in the foreground, each with a timeout of at least 600000 ms:

```bash
./node_modules/.bin/vitest run test/history-lib.test.ts -t 'segmentOrdersAfter is'
./node_modules/.bin/vitest run test/history-recover.test.ts -t 'D-5395|D-5396|D-5397|D-5637|F6 \(D-5399\)'
./node_modules/.bin/vitest run test/history-export.test.ts -t 'D-5396, F1c, end to end|D-5397, end to end'
```

Expected reds, measured at `e4936efab` with only Step 1 applied: 15 in all, 1 + 12 + 2. Every other case those filters select stays green.
- history-lib (1): `TypeError: libSeg.segmentOrdersAfter is not a function`.
- history-recover (12):
  - both F6 arms: `D-5637: the rebuild marked the blob by its last carrier, the one segment that holds S's row: expected [ { seg: '1.<writer>.db' } ] to deeply equal [ { seg: '2.<writer>.db' } ]`;
  - `D-5396, refined`: E4 `'1.0a1b2c3d.db'` where `'2.0a1b2c3d.db'` is expected;
  - the planted `D-5396, F1c`: `expected [ null, null, null, …(2) ] to deeply equal [ '2.0a1b2c3d.db', …(4) ]`;
  - the lookup pin: `expected 1 to be 3`;
  - the variant probe: `expected [ '1.0a1b2c3d.db', '1.0a1b2c3d.db' ] to deeply equal [ '2.0a1b2c3d.db', '1.0a1b2c3d.db' ]`;
  - the unlinked-row probe: `expected '1.0a1b2c3d.db' to be '2.0a1b2c3d.db'`;
  - the later-mark case, at its CONTROL: `expected [ '1.0a1b2c3d.db', '3.0a1b2c3d.db' ] to deeply equal [ '3.0a1b2c3d.db', '3.0a1b2c3d.db' ]`;
  - the lacks-the-stub case: `expected [ '1.0a1b2c3d.db', '1.0a1b2c3d.db' ] to deeply equal [ null, '1.ffffffff.db' ]`;
  - the three D-5397 cases: `expected '1.0a1b2c3d.db' to be '2.0a1b2c3d.db'` twice, then the CONTROL's blob `seg` `'1.0a1b2c3d.db'` against `'2.0a1b2c3d.db'`.
- history-export (2): the F1c end-to-end case at `D-5637: row 1 is marked by segment 2, …` (row 1 `null`), and the D-5397 end-to-end case at `row 2 is marked by segment 2, …` (row 2 `s1`).

- [ ] **Step 3: lib: one (seq, writer) comparator, and `segmentOrdersAfter`.** In `ccd/history/lib.mjs`, in `orderSegmentNames`, replace `  parsed.sort((a, b) => a.seq - b.seq || (a.writer < b.writer ? -1 : a.writer > b.writer ? 1 : 0));` with `  parsed.sort(segmentPartsOrder);`. Then insert directly below `orderSegmentNames`' closing `}`, leaving a blank line before `nextSegmentSeq`'s doc comment:

```js

/** Replay's (seq, writer) order over two parsed names: seq numerically, then the writer token in code-unit order. One
 *  comparator for orderSegmentNames and segmentOrdersAfter, so the order replay walks in and the order its marks follow
 *  are one order. */
function segmentPartsOrder(a, b) {
  return a.seq - b.seq || (a.writer < b.writer ? -1 : a.writer > b.writer ? 1 : 0);
}

/** Whether segment `a` orders strictly after `b` in replay's (seq, writer) order (orderSegmentNames'), so that replay
 *  moves a mark naming `b` to `a`, the later carrier (D-5637 (history-export-replay-last-carrier), wave 5h-1). `b` is
 *  the mark the store holds: null (no mark) or a name off the segment grammar names no carrier, and any segment orders
 *  after it. `a` is the segment being replayed, a name from the listing: off the grammar it is a caller's bug and
 *  throws. The same name is not after itself, so a page replayed again after a kill moves nothing. */
export function segmentOrdersAfter(a, b) {
  const pa = parseSegmentName(a);
  if (pa === null) throw new TypeError(`segmentOrdersAfter: not a segment name: ${JSON.stringify(a)}`);
  if (b === null) return true;
  const pb = parseSegmentName(b);
  return pb === null ? true : segmentPartsOrder(pa, pb) > 0;
}
```

In `segmentMayMarkEntry`'s doc comment, replace the line ` *  (the entry is marked by the first segment that carries it), and the loss of that segment clears the blob's referrers with` with ` *  (replay gives the mark to the entry's last carrier, D-5637), and the loss of that segment clears the blob's referrers with`. The function body is unchanged. In `ccd/history/lib.d.mts`, add directly below `export function orderSegmentNames(names: readonly string[]): string[];`:

```ts
export function segmentOrdersAfter(a: string, b: string | null): boolean;
```

Then run `node --check ccd/history/lib.mjs` and the lib filter from Step 2. It is green.

- [ ] **Step 4: sweep: replay marks by the last carrier.** In `ccd/history/sweep.mjs`:

The lib import: change `  decideMarkCheck, missingSegmentNames, deadFileSourceKey, decideSegmentReplay, orderSegmentNames, entryMayHoldMark, segmentMayMarkEntry,` to keep that line and add a line `  segmentOrdersAfter,` directly below it, before `} from './lib.mjs';`. Re-read the import first, because Tasks 1-4 add names to it; merge only `segmentOrdersAfter`.

In `replayStmts(db)`, replace the `blobMark:` member
```js
    blobMark: db.prepare('UPDATE blobs SET exported_ms = ?, exported_seg = ? WHERE sha256 = ? AND z IS NOT NULL AND exported_ms IS NULL'),
```
with
```js
    // D-5637 (history-export-replay-last-carrier): a blob's mark moves to the LAST segment that carries its bytes; the sweep asks
    // lib segmentOrdersAfter of blobMarkOf's answer before it runs, so the statement itself no longer keeps a mark.
    blobMark: db.prepare('UPDATE blobs SET exported_ms = ?, exported_seg = ? WHERE sha256 = ? AND z IS NOT NULL'),
    blobMarkOf: db.prepare('SELECT exported_seg AS seg FROM blobs WHERE sha256 = ? AND z IS NOT NULL'),
```
Replace the two comment lines above `entrySel:`
```js
    // exported_ms and exported_seg: an entry's mark, which replay reads where it would mark or unmark it (D-5396): an entry already
    // marked is not marked again, and a row of another segment than the one that marks it can only take the mark off.
```
with
```js
    // exported_ms and exported_seg: an entry's mark, which replay reads where it would mark or unmark it (D-5396): an entry row moves
    // the mark only to a segment that orders after it (D-5637), and a row of another segment than the one that marks it can only take
    // the mark off.
```
and the `entryMark:` member with
```js
    entryMark: db.prepare('UPDATE entries SET exported_ms = ?, exported_seg = ? WHERE entry_id = ?'),
```

In `replayEntryRow`, replace everything from the line `  // D-5395: the segment holds this row's bytes, but the store may hold more of the entry than the segment did (a late` through the function's closing `}` with:
```js
  // D-5395: the segment holds this row's bytes, but the store may hold more of the entry than the segment did (a late
  // variant, a late-linked sidecar, a revived blob in the backup a restore started from): marked only when lib says every
  // blob the entry references, as the store holds them now, is exported, or pruned and carried by THIS segment (D-5396).
  // D-5637 (history-export-replay-last-carrier): the entry's mark goes to the LAST segment that carries its row, in replay's
  // (seq, writer) order (lib segmentOrdersAfter), not the first. Every export of an entry writes all the store held of it
  // then (every variant, its boundary, every linked sidecar, every membership), and nothing deletes those rows, so a later
  // carrier holds all an earlier one did, and the mark names the segment whose loss would lose the most: the check after a
  // bind then clears it with that segment, and the next pass writes the entry again. A segment that orders after the mark
  // takes it when lib says it may (segmentMayMarkEntry, `carried` measured in this segment); when lib says it may not (a
  // pruned blob no mark names that this segment lacks, or a live, unmarked one) the older mark goes too (exportClear), so
  // the next pass writes the entry with all it needs: over-clearing, never a loss. A segment that does not order after the
  // mark (the same one replayed again, or a restore's backup marked by a later segment) moves nothing and costs no lookup.
  // The rows of this segment that link a blob to the entry are judged by unmarkEntryOverBlobIn.
  if (!segmentOrdersAfter(seg.name, e.exported_seg === null ? null : String(e.exported_seg))) return;
  const states = s.entryBlobStates.all(e.entry_id, e.entry_id, t, e.entry_id, e.entry_id).map((b) => blobStateIn(seg, b, true));
  if (segmentMayMarkEntry({ blobs: states })) s.entryMark.run(seg.markMs, seg.name, e.entry_id);
  else stmts(db).exportClear.run(e.entry_id);
}
```
The lines above it (`const s = replayStmts(db);` and `const e = s.entrySel.get(r.uuid);`) and the upsert call stay as they are; Task 6 edits the upsert later.

In `replayBlobPage`'s doc comment, replace ` *  bytes is marked with its segment. A body ignored over a prune tombstone is counted export_blob_tombstone_kept; the` with ` *  bytes is marked with its last carrier (D-5637). A body ignored over a prune tombstone is counted export_blob_tombstone_kept; the`. In its body, replace
```js
      if (Number(ins.changes) === 0 && s.blobTombstone.get(b.sha256) !== undefined) bump(db, 'export_blob_tombstone_kept');
      s.blobMark.run(markMs, name, b.sha256);
```
with
```js
      // D-5637 (history-export-replay-last-carrier): the blob's mark goes to the last segment that carries its bytes. A fresh
      // row has no mark and costs no statement more; a blob the store held already is read once, and its mark moves only to
      // a segment that orders after it (a restore's backup may hold a mark naming a later segment, which stays).
      if (Number(ins.changes) === 1) s.blobMark.run(markMs, name, b.sha256);
      else if (s.blobTombstone.get(b.sha256) !== undefined) bump(db, 'export_blob_tombstone_kept');
      else {
        const held = s.blobMarkOf.get(b.sha256);
        if (held !== undefined && segmentOrdersAfter(name, held.seg === null ? null : String(held.seg))) s.blobMark.run(markMs, name, b.sha256);
      }
```
The tombstone probe still runs only after an ignored insert, so `the tombstone probe runs only where an insert was ignored` stays green unchanged (measured).

The prose that named first-wins changes in the same commit:
- In the W1-B4 Task 10 header comment, replace
  ```
  //   export-blobs  every segment's blobs that carry bytes, insert-or-ignore by sha256; each replayed blob is marked with
  //                 its segment, so it is never exported again. A body ignored over a prune tombstone the store held
  ```
  with
  ```
  //   export-blobs  every segment's blobs that carry bytes, insert-or-ignore by sha256; each replayed blob is marked with
  //                 the LAST segment that carries its bytes (D-5637 (history-export-replay-last-carrier)), so it is never
  //                 exported again while that segment is on the box. A body ignored over a prune tombstone the store held
  ```
- In the same header, replace
  ```
  //                   mark names licenses one only in a segment that holds its stub or its bytes, as the pass writes them; an
  //                   entry an earlier segment marked already is not marked again;
  ```
  with
  ```
  //                   mark names licenses one only in a segment that holds its stub or its bytes, as the pass writes them; the
  //                   LAST segment that carries the entry's row and may mark it takes the mark, and one that carries the row
  //                   but may not takes an earlier mark off (D-5637); a segment that does not order after the mark moves nothing;
  ```
- In `ingestSidecar`'s D-5399 comment, replace its last three lines
  ```
          // already. Replay marks the blob and its referrers by the first segment that carries them, so after a rebuild no mark
          // on them names the later segment that carried them again with the new rows: once that segment is lost nothing carries
          // those rows again, and a second rebuild drops them (the plan's first-wins residual).
  ```
  with
  ```
          // already. Replay marks the blob and its referrers by the LAST segment that carries them (D-5637
          // (history-export-replay-last-carrier), wave 5h-1), the one that carried them again with the new rows, so once that
          // segment is lost the check after a bind clears those marks and the next pass carries the rows again (closing B4's
          // first-wins residual, review 621 F3).
  ```

Then run `node --check ccd/history/sweep.mjs`, and check that no prose naming first-wins is left: `grep -nE "first-wins|first segment that|first wins" ccd/history/sweep.mjs ccd/history/lib.mjs || echo 'no first-wins prose left'` must print the `echo` line.

- [ ] **Step 5: The B4 plan's residual and entries point here.** In `docs/superpowers/plans/2026-10-07-ccrc-history-w1-b4-export.md`, append text and remove nothing. B4's text stays as the record of what B4 shipped.
  - Under "### Residuals, named", the bullet that begins `- Replay marks an entry by the first segment that carries it` ends with the line `  blob clears an entry another segment marked (D-5396).` Add this continuation line directly below it, indented two spaces like the bullet:
    `  Closed by wave 5h-1 (D-5637 (`history-export-replay-last-carrier`)): replay now marks by the last carrier, so the marks that cover such a row name the one segment that holds it, the check after a bind clears them when that segment is lost, and the next pass carries the row again; the F6 cases in history-recover.test.ts replay review 621's sequence to the second rebuild.`
  - D-5396's entry ends with `the cases that pinned "a pruned blob owes nothing" there now pin the clear.` Append to that same line: ` Since wave 5h-1, D-5637 (`history-export-replay-last-carrier`) gives the mark to the last segment that carries the row, not the first; the rule for a pruned, unmarked blob is unchanged.`
  - D-5399's entry ends with `measured by review 621: all six scoped greps missed the row).` Append to that same line: ` Wave 5h-1 closes that residual (D-5637 (`history-export-replay-last-carrier`)).`

None of these lines begins with a `D-` definition form, so `deviation-refs` reads them as citations. They hold no `file.ext:N` token.

- [ ] **Step 6: Run and see it pass.** From inside `server/`, in the foreground, each with a timeout of at least 600000 ms:

```bash
./node_modules/.bin/vitest run test/history-lib.test.ts
./node_modules/.bin/vitest run test/history-recover.test.ts
./node_modules/.bin/vitest run test/history-export.test.ts
node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected: every case is green and tsc is silent. Measured on `e4936efab` plus this task alone: history-lib 1084 passed (about 70 s), history-recover 143 passed (about 95 s) and history-export 84 passed (about 55 s). Tasks 1-4 add cases of their own, so the counts at this point of the plan are higher. A red outside the cases this task names gets re-run alone before it is called a break. The `the tombstone probe runs only where an insert was ignored` and `D-5395` cases must stay green unchanged, along with every `history-export` case except the two this task re-expects.

- [ ] **Step 7: Mutations: each new guard reds its case.** From the repository root: `SCRATCH="$PWD/.superpowers/sdd/history-w5h1/scratch"; mkdir -p "$SCRATCH"; cp ccd/history/sweep.mjs "$SCRATCH/sweep.mjs.t5"; cp ccd/history/lib.mjs "$SCRATCH/lib.mjs.t5"` (this plan's scratch directory, Global Constraints "Red-first"; never B4's `history-w1-b4`). Apply each mutation by hand. Run it from inside `server/` with `./node_modules/.bin/vitest run test/<file>.test.ts -t '<filter>'` and see it red. Restore both files with `cp` before the next one. Never `git stash`. Every row below was measured.

| Mutation | File, `-t` filter | Expected red |
|---|---|---|
| M1, first-wins on the entry arm: in `replayStmts`, `entryMark`'s SQL ends `WHERE entry_id = ? AND exported_ms IS NULL'),` | history-recover, `the variant probe` | `E0 is marked by segment 2, …: expected [ '1.0a1b2c3d.db', '1.0a1b2c3d.db' ] to deeply equal [ '2.0a1b2c3d.db', '1.0a1b2c3d.db' ]` |
| M2, first-wins on the blob arm: `blobMark`'s SQL ends `AND z IS NOT NULL AND exported_ms IS NULL'),` | history-recover, `the unlinked-row probe` | `the blob is marked by segment 2, …: expected '1.0a1b2c3d.db' to be '2.0a1b2c3d.db'` |
| M3, no order gate on the entry: in `replayEntryRow`, delete the line `  if (!segmentOrdersAfter(seg.name, e.exported_seg === null ? null : String(e.exported_seg))) return;` | history-recover, `a mark naming a segment that orders AFTER` | `E0 keeps segment 3; E1 loses it, …: expected [ '2.0a1b2c3d.db', '2.0a1b2c3d.db' ] to deeply equal [ '3.0a1b2c3d.db', null ]` |
| M4, no order gate on the blob: in `replayBlobPage`, `if (held !== undefined && segmentOrdersAfter(name, held.seg === null ? null : String(held.seg))) s.blobMark.run(…);` becomes `if (held !== undefined) s.blobMark.run(markMs, name, b.sha256);` | history-recover, `a mark naming a segment that orders AFTER` | `a blob marked by a later segment keeps that mark: …: expected [ '2.0a1b2c3d.db', '2.0a1b2c3d.db' ] to deeply equal [ '3.0a1b2c3d.db', '3.0a1b2c3d.db' ]` |
| M5, a later carrier that may not mark keeps the older mark: in `replayEntryRow`, delete `  else stmts(db).exportClear.run(e.entry_id);` | history-recover, `a later carrier that lacks` | `E0 is unmarked: …: expected [ '1.0a1b2c3d.db', '1.ffffffff.db' ] to deeply equal [ null, '1.ffffffff.db' ]` |
| M6, first-wins restored (M1 and M2 together): review 621 F3 end to end | history-recover, `F6 \(D-5399\)` | both arms: `D-5637: the rebuild marked the blob by its last carrier, the one segment that holds S's row: expected [ { seg: '1.<writer>.db' } ] to deeply equal [ { seg: '2.<writer>.db' } ]` |
| L1, not strict: in `segmentOrdersAfter`, `segmentPartsOrder(pa, pb) > 0` becomes `>= 0` | history-lib, `segmentOrdersAfter is` | `never after itself: a page replayed again moves nothing: expected true to be false` |
| L2: `  if (b === null) return true;` becomes `return false;` | history-lib, `segmentOrdersAfter is` | `no mark: expected false to be true` |
| L3, lexical order: `segmentPartsOrder(pa, pb) > 0` becomes `a > b` | history-lib, `segmentOrdersAfter is` | `seq is numeric, never lexical: expected false to be true` |
| L4: `return pb === null ? true :` becomes `return pb === null ? false :` | history-lib, `segmentOrdersAfter is` | `a mark off the grammar names no carrier: expected false to be true` |
| L5: delete the `if (pa === null) throw new TypeError(…)` line | history-lib, `segmentOrdersAfter is` | `the replayed name is the caller's, from the listing` (no TypeError thrown) |

M6 was also measured with the F6 continuation's mark, counter and segment assertions removed, so the case runs to its last line. In both arms all six asserted greps then miss S after the second rebuild (`"exit":3`, `hasS:false`). That is review 621's result reproduced, which shows the case pins the loss itself and not only the marks.

After the last restore, run the three files green once more. `cmp "$SCRATCH/sweep.mjs.t5" ccd/history/sweep.mjs` and `cmp "$SCRATCH/lib.mjs.t5" ccd/history/lib.mjs` must print nothing; then `rm "$SCRATCH"/*.t5`.

- [ ] **Step 8: Commit**, from the repository root:

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs server/test/history-lib.test.ts server/test/history-recover.test.ts server/test/history-export.test.ts docs/superpowers/plans/2026-10-07-ccrc-history-w1-b4-export.md
git commit -m "fix(history): export replay marks by the last carrier, so a lost later segment's rows export again (wave 5h-1, D-5637; review 621 F3)"
```

---

### Task 6: expand shows a pruned body's variants, and a live copy keeps an entry's structure on a tie

Two read-side residuals from "Owed from B4" (scope `b4-read-residuals`, items 4 and 5). Item 4 is a defect against B2's D-4596 (`history-read-fixed-fields-fit-the-cap`), whose `variants_total` names the true count. Today `expandEntryText` returns `expandBlob`'s non-bytes answer before it reads the variant rows, so over a pruned, too-large or undecodable primary `expand --json` says `variants: []`, `variants_total: 0`, and the human form loses its `variant cause=` lines. Item 5 is review 614 F7. Replay goes through ingest's `ENTRY_UPSERT`, whose tie goes to the larger `file_id`, so on a restore an entry's structure moves off the live file the backup held and onto the `exported:` dead-file row that replay has just made. That row is new, so its `file_id` is always the larger. The fix binds the tie arm. A replayed copy never wins a tie. At ingest, a live copy beats an `exported:` holder at an equal rank (coordinator ruling R10: both arms). Item 4 is coordinator ruling R9 and takes no number. Item 5 is NEW D-5638 (`history-ingest-live-beats-exported-tie`).

**Files:**
- Modify: `ccd/history/recall.mjs` (anchors measured at `e4936efab`; re-anchor by content):
  - `function expandEntryText(rc, s, e) {` (:1486): move the variant read above the `expandBlob` call, and replace `  if (p.state !== 'bytes') return p;` (:1488, the FIRST of the file's two such lines; the second, at :1514, is `expandSidecarText`'s and stays) with a return that carries the causes;
  - in `expandRenderItem`, `  const causes = t.state === 'text' ? t.causes : [];` (:1584);
  - the three non-text blocks: `const block = [lead, \`content pruned ${when}\`].join('\n');` (:1612), the `content too large to expand here: …` block (:1621) and the `content does not decode: …` block (:1630) each gain `...tail`.
- Modify: `ccd/history/sweep.mjs` (anchors measured at `e4936efab`; re-anchor by content):
  - `const ENTRY_UPSERT = \`INSERT INTO entries (uuid, transcript_pk, …` (:4253): a five-line comment above it, and its last two lines (:4264–4265, `  WHERE excluded.struct_rank_ns > entries.struct_rank_ns` / `     OR (excluded.struct_rank_ns = entries.struct_rank_ns AND excluded.struct_file_id > entries.struct_file_id)\`;`);
  - in `replayEntryRow`, the `stmts(db).entryUpsert.run(…)` call's last line, `    r.parse_state, r.struct_rank_ns, fileId, blobId);` (:2805). Task 5 edits this function's mark lines and leaves this call alone;
  - in `writeChunk`, the `s.entryUpsert.run(…)` call's last line, `        chunk.rankNs, chunk.fileId, blobId);` (:4558).
- Test: `server/test/history-recall.test.ts`: one case inside the HA1 describe (`describe.skipIf(process.platform === 'darwin')('HA1: the read verbs fit the cap, …`), directly above `  it('H-10 and H-19: a stored uuid or type that forges a line or a tag, …` (:4723), which is directly below H-19 (:4688).
- Test: `server/test/history-export.test.ts`: in the case `it('D-5396, end to end: a late variant re-marks row 1 into segment 2, …`, add six lines directly below `    expect(ex.stdout, 'expand on the pruned first body still says so').toContain('content pruned on');` (:1317; this line appears once in the file).
- Test: `server/test/history-recover.test.ts`: in `interface SweepRecover` (:47–60), add one member directly above its closing `}`, and append one describe at the end of the file (:5159 lines at `e4936efab`; Task 5 may have appended before it).

**Interfaces:**
- Consumes:
  - `recall.mjs`: `expandBlob(s, blobId, isSidecar)`, which answers `{ state: 'bytes', bytes }`, `{ state: 'pruned', prunedMs }`, `{ state: 'too-large', rawLen, bound? }` or `{ state: 'undecodable', rawLen }`; `s.variants.all(entryId)` rows `{ blob_id, cause }`; `expandRenderItem`'s `tail` (the `variant cause=` lines and the `variant causes: +N more` line) and `extra` (`variants`, `variants_total`, D-4596).
  - `sweep.mjs`: `ENTRY_UPSERT` and `stmts(db).entryUpsert`; `writeChunk(db, chunk)` (exported); `replayEntryRow(db, seg, r)` and `ensureDeadFile(…)`, which makes a gone file's `exported:` row (status `exported`, D-4764) and is always newer than a restored backup's live row.
  - Test side: the HA1 describe's `writer(box)`, `cli(args)`, `h(i)`, `t16items`, `T0`, `HEAVY` and `libRead.SIDECAR_WHOLE_MAX`; `history-export.test.ts`'s `runCli`, `withPane`, `ID`, `rid`; `history-recover.test.ts`'s x10 helpers at module scope (`X10Family`, `X10Text`, `x10Texts`, `x10Rows`, `x10Store`, `x10U`, `x10Count`, `X10_DEV`, `X10_DAY`, `X10_WRITER`), `plantSegment`, `segmentSha`, `exportedSourceKey`, `stepCtx`, `closeWriter` and `SW`.
- Produces:
  - `recall.mjs`: every answer from `expandEntryText` carries `causes: string[]`, the entry's variant causes other than its primary blob's, whatever the primary's state. `expandRenderItem` reads `const causes = t.causes ?? [];`, where a sidecar's non-text answer carries none. The pruned, too-large and undecodable human blocks end with `tail`, as the bytes path's blocks already do. `--json` and human now agree.
  - `sweep.mjs`: `ENTRY_UPSERT` takes a 21st bound parameter, `?21`, the tie flag: `1` at ingest (`writeChunk`) and `0` at replay (`replayEntryRow`). Its update condition is `excluded.struct_rank_ns > entries.struct_rank_ns OR (?21 = 1 AND excluded.struct_rank_ns = entries.struct_rank_ns AND (excluded.struct_file_id > entries.struct_file_id OR (SELECT status FROM ingest_files WHERE file_id = entries.struct_file_id) = 'exported'))`.
  - Test side: `SweepRecover.writeChunk(db, chunk): { newEntries: number; minNewTsMs: number | null }`.

**Spec:**
- §6.1 "Structure fields come from the newest copy: the copy whose file has the larger `mtime_ns` at read time, ties broken by the larger `file_id`"; §9.2 step 5 (RV15, the `ON CONFLICT(uuid) DO UPDATE SET … WHERE` rule); §9.14 "Export replay" ("through the same named-column inserts as ingest, entries by the newest-rank rule (§9.2)"). The spec text is Task 7's: its Step 7 amends all three in place, citing D-5638; this task edits no spec.
- Departures: item 4 departs from nothing. It restores B2's D-4596 (`history-read-fixed-fields-fit-the-cap`), whose totals are the true counts. Item 5 is NEW **D-5638** (`history-ingest-live-beats-exported-tie`), the replay tie and the ingest tie both, as ruled by R10.
- Pins: `expand --json` and the human form on a pruned primary with a placed variant, in both the HA1 store and B4's D-5396 end-to-end rebuild. The too-large and undecodable arms come in the same case. The restore-order case of review 614 F7, where `struct_file_id` stays on the live row. The ingest arm: a live copy beats an `exported:` holder at an equal rank. Each guard has its own mutant.
- Plan choices (no departure): a replay-versus-replay tie keeps the first segment's structure (pinned by the `replay against replay` case and its `?21` = 1 mutant). A live-versus-live tie at ingest still goes to the larger `file_id`. A strictly newer rank still wins from either caller. Only ties change.

- [ ] **Step 1: Write the failing tests for item 4.** In `server/test/history-recall.test.ts`, inside the HA1 describe, insert directly above `  it('H-10 and H-19: a stored uuid or type that forges a line or a tag, or runs 300,000 characters, prints as one bounded quoted token in describe and in expand', () => {`:

```ts
  it('an entry whose primary body is pruned, too large or undecodable still lists its variants and their true count, in --json and the human form (D-4596; "Owed from B4" item 4)', () => {
    const w = writer(box);
    const e1 = w.prepare('SELECT entry_id, blob_id FROM entries WHERE uuid = ?').get(h(1)) as { entry_id: number; blob_id: number };
    const other = (w.prepare('SELECT blob_id FROM entries WHERE uuid = ?').get(h(2)) as { blob_id: number }).blob_id;
    const orig = w.prepare('SELECT z, raw_len, pruned_ms FROM blobs WHERE blob_id = ?').get(e1.blob_id) as { z: Uint8Array; raw_len: number; pruned_ms: number | null };
    const putBack = w.prepare('UPDATE blobs SET z = ?, raw_len = ?, pruned_ms = ? WHERE blob_id = ?');
    /** expand h(1) in both forms: the --json item's variants and total, and the human page. */
    const seen = (): { variants: unknown; total: unknown; human: string } => {
      const json = cli(['expand', h(1), '--json']);
      expect(json.code, json.stderr).toBe(0);
      const it1 = t16items(json).find((i) => i.uuid === h(1)) as unknown as { variants: unknown; variants_total: unknown };
      const human = cli(['expand', h(1)]);
      expect(human.code, human.stderr).toBe(0);
      return { variants: it1.variants, total: it1.variants_total, human: human.stdout };
    };
    try {
      // one variant row on h(1), naming another entry's live blob (B1's DM2 shape: one entry, two bodies)
      w.prepare("INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms, cause) VALUES (?, ?, 1, ?, 'zqvarcause')").run(e1.entry_id, other, T0);
      const live = seen();
      expect([live.variants, live.total], 'CONTROL: over its live primary the variant is listed').toEqual([[{ cause: 'zqvarcause' }], 1]);
      expect(live.human, 'CONTROL: and the human form names it').toContain('variant cause=zqvarcause');
      const arms: Array<{ arm: string; set: () => void; line: string }> = [
        { arm: 'pruned', set: () => { w.prepare('UPDATE blobs SET z = NULL, pruned_ms = ? WHERE blob_id = ?').run(Date.UTC(2026, 0, 2), e1.blob_id); }, line: 'content pruned on 2026-01-02' },
        { arm: 'too-large', set: () => { w.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = ?').run(libRead.SIDECAR_WHOLE_MAX + 1, e1.blob_id); }, line: 'content too large to expand here' },
        { arm: 'undecodable', set: () => { w.prepare('UPDATE blobs SET z = NULL WHERE blob_id = ?').run(e1.blob_id); }, line: 'content does not decode' },
      ];
      for (const a of arms) {
        putBack.run(orig.z, orig.raw_len, orig.pruned_ms, e1.blob_id);
        a.set();
        const got = seen();
        expect(got.human, `CONTROL: ${a.arm}: the fixture reaches the arm`).toContain(a.line);
        expect([got.variants, got.total], `${a.arm}: --json lists the variant and its true count`).toEqual([[{ cause: 'zqvarcause' }], 1]);
        expect(got.human, `${a.arm}: the human form names the variant`).toContain('variant cause=zqvarcause');
      }
    } finally {
      putBack.run(orig.z, orig.raw_len, orig.pruned_ms, e1.blob_id);
      w.prepare("DELETE FROM entry_variants WHERE cause = 'zqvarcause'").run();
      w.close();
    }
  }, 2 * HEAVY);

```

In `server/test/history-export.test.ts`, in the case `it('D-5396, end to end: a late variant re-marks row 1 into segment 2, …`, insert directly below `    expect(ex.stdout, 'expand on the pruned first body still says so').toContain('content pruned on');`. This is the shape the ledger names: a rebuilt store whose first body is a tombstone and whose late variant is placed.

```ts
    expect(ex.stdout, 'and names the placed late variant (D-4596)').toContain('variant cause=');
    const exj = runCli(box, ['expand', rid(1), '--json'], { env: withPane(box, ID) });
    expect(exj.code, `${exj.stdout}\n${exj.stderr}`).toBe(0);
    const item1 = ((exj.json?.['items'] ?? []) as Array<Record<string, unknown>>).find((i) => i['uuid'] === rid(1));
    expect(item1?.['variants_total'], 'expand --json counts the placed late variant over the pruned first body (D-4596)').toBe(1);
```

- [ ] **Step 2: Run them and see them fail.** From inside `server/`, in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-recall.test.ts -t 'still lists its variants and their true count'
./node_modules/.bin/vitest run test/history-export.test.ts -t 'D-5396, end to end'
```

Expected red (measured at `e4936efab`):
- recall: both CONTROLs pass, and then `pruned: --json lists the variant and its true count: expected [ [], +0 ] to deeply equal [ [ { cause: 'zqvarcause' } ], 1 ]`;
- export: `and names the placed late variant (D-4596): expected 'scope=family(…' to contain 'variant cause='`.

If a CONTROL is red, the fixture is wrong, not the code. If `CONTROL: over its live primary` is red, h(1) already has a variant row, or h(2) shares h(1)'s blob. If an arm's `the fixture reaches the arm` is red, `expandBlob`'s order changed on the base. Read it, and fix the fixture.

- [ ] **Step 3: Read the variants before the primary, and show them on every arm.** In `ccd/history/recall.mjs`, replace the first five lines of `expandEntryText`:

```js
function expandEntryText(rc, s, e) {
  const p = expandBlob(s, e.blob_id, false);
  if (p.state !== 'bytes') return p;
  const primary = expandParse(p.bytes);
  const rows = s.variants.all(e.entry_id).filter((v) => v.blob_id !== e.blob_id);
```

with:

```js
function expandEntryText(rc, s, e) {
  // The variant rows are read before the primary's bytes, so every answer names them: a pruned, too-large or undecodable
  // primary still lists its entry's variants and their true count (D-4596 (history-read-fixed-fields-fit-the-cap)).
  const rows = s.variants.all(e.entry_id).filter((v) => v.blob_id !== e.blob_id);
  const p = expandBlob(s, e.blob_id, false);
  if (p.state !== 'bytes') return { ...p, causes: rows.map((v) => v.cause) };
  const primary = expandParse(p.bytes);
```

The rest of the function is unchanged. It still returns `causes: rows.map((v) => v.cause)` on the text path. `expandSidecarText` keeps its own `if (p.state !== 'bytes') return p;`.

In `expandRenderItem`, replace `  const causes = t.state === 'text' ? t.causes : [];` with:

```js
  const causes = t.causes ?? [];   // every entry answer carries its variant causes (expandEntryText); a sidecar's non-text answer carries none
```

Then give each of the three non-text human blocks the tail. Make three in-place replacements:
- `    const block = [lead, \`content pruned ${when}\`].join('\n');` becomes `    const block = [lead, \`content pruned ${when}\`, ...tail].join('\n');`;
- `    const block = [lead, \`content too large to expand here: ${t.rawLen} bytes, over the ${t.bound ?? xlib.SIDECAR_WHOLE_MAX}-byte bound one call decompresses\`].join('\n');` becomes the same line with `, ...tail` before its `]`;
- `    const block = [lead, \`content does not decode: the stored blob is damaged (recorded ${t.rawLen} bytes)\`].join('\n');` becomes the same line with `, ...tail` before its `]`.

`tail` and `extra` are already computed above these blocks, and `measure(block, json)` already counts the block, so a non-text item's cost now includes its list. That list is at most `EXPAND_LIST_ROOM` (2,000 characters), the same bound the text path has. Run `node --check ccd/history/recall.mjs`.

- [ ] **Step 4: Run and see them pass, with every suite that calls expand.** From inside `server/`, each in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-recall.test.ts -t 'still lists its variants and their true count'
./node_modules/.bin/vitest run test/history-export.test.ts -t 'D-5396, end to end'
./node_modules/.bin/vitest run test/history-recall.test.ts
./node_modules/.bin/vitest run test/history-export.test.ts
./node_modules/.bin/vitest run test/history-recover.test.ts
./node_modules/.bin/vitest run test/history-maint.test.ts
```

Expected: every case is green. Measured at `e4936efab` with this step alone: history-recall 193 passed and 1 skipped, history-export 84 passed, history-maint 118 passed. H-19's `OUTPUT_CAP` case stays green. The other suites that run expand assert `content pruned on` with `toContain`, so the new tail line breaks none of them.

- [ ] **Step 5: Mutations, each guard reds its case.** From the repository root, run `SCRATCH="$PWD/.superpowers/sdd/history-w5h1/scratch"; mkdir -p "$SCRATCH"; cp ccd/history/recall.mjs "$SCRATCH/recall.mjs.t6a"`. Apply each mutation by hand and run the filter from inside `server/`. See it red, then `cp "$SCRATCH/recall.mjs.t6a" ccd/history/recall.mjs` before the next one. Never `git stash`.

| Mutation | Command (from `server/`) | Expected red (measured) |
|---|---|---|
| In `expandEntryText`, replace `  if (p.state !== 'bytes') return { ...p, causes: rows.map((v) => v.cause) };` with `  if (p.state !== 'bytes') return p;` | `./node_modules/.bin/vitest run test/history-recall.test.ts -t 'still lists its variants and their true count'` | `pruned: --json lists the variant and its true count: expected [ [], +0 ] to deeply equal [ [ { cause: 'zqvarcause' } ], 1 ]` |
| The same mutation | `./node_modules/.bin/vitest run test/history-export.test.ts -t 'D-5396, end to end'` | `and names the placed late variant (D-4596): expected 'scope=family(…' to contain 'variant cause='` |
| In `expandRenderItem`, replace `  const causes = t.causes ?? [];` with `  const causes = t.state === 'text' ? t.causes : [];` (the shipped line) | `./node_modules/.bin/vitest run test/history-recall.test.ts -t 'still lists its variants and their true count'` | `pruned: --json lists the variant and its true count: expected [ [], +0 ] to deeply equal [ [ { cause: 'zqvarcause' } ], 1 ]` |
| Drop `, ...tail` from the pruned block | `./node_modules/.bin/vitest run test/history-recall.test.ts -t 'still lists its variants and their true count'` | `pruned: the human form names the variant: expected 'scope=family(…' to contain 'variant cause=zqvarcause'` |
| Drop `, ...tail` from the too-large block | `./node_modules/.bin/vitest run test/history-recall.test.ts -t 'still lists its variants and their true count'` | `too-large: the human form names the variant: expected 'scope=family(…' to contain 'variant cause=zqvarcause'` |
| Drop `, ...tail` from the undecodable block | `./node_modules/.bin/vitest run test/history-recall.test.ts -t 'still lists its variants and their true count'` | `undecodable: the human form names the variant: expected 'scope=family(…' to contain 'variant cause=zqvarcause'` |

After the last restore, `cmp "$SCRATCH/recall.mjs.t6a" ccd/history/recall.mjs` prints nothing, and the first filter of Step 4 is green again.

- [ ] **Step 6: Commit**, from the repository root:

```bash
git add ccd/history/recall.mjs server/test/history-recall.test.ts server/test/history-export.test.ts
git commit -m "fix(history): expand lists an entry's variants and their true count over a pruned, too-large or undecodable primary, in --json and the human form (D-4596; wave 5h-1)"
```

- [ ] **Step 7: Write the failing tests for item 5.** In `server/test/history-recover.test.ts`, add this member to `interface SweepRecover`, directly above its closing `}`:

```ts
  writeChunk(db: DatabaseSync, chunk: Record<string, unknown>): { newEntries: number; minNewTsMs: number | null };
```

Append to the end of the file:

```ts

// ── wave 5h-1 Task 6: a live copy keeps an entry's structure on a tie (D-5638 (history-ingest-live-beats-exported-tie);
// review 614 F7; "Owed from B4" item 5) ─────────────────────────────────────────────────────────────────────────────────
// A restore's backup holds an entry on its live file at struct rank R; a segment carries the same entry at R. Replay goes
// through ingest's ENTRY_UPSERT with the exported: dead-file row, which is new and so has the larger file_id: under the
// shipped "ties broken by the larger file_id" (RV15) the structure moved onto that row. Replay now never wins a tie, and
// ingest's live copy beats an exported: holder at an equal rank whatever the file ids.
describe('a live copy keeps an entry\'s structure on a tie (wave 5h-1 Task 6; D-5638 (history-ingest-live-beats-exported-tie))', () => {
  /** The store a restore starts from: `fam`'s transcript, its LIVE file (an ingest_files row with its file_paths row) and
   *  each text's blob and entry on that file at struct rank `rankOf(i)`. The live file_id. */
  function x10LiveStore(db: DatabaseSync, fam: X10Family, rankOf: (i: number) => bigint): { live: number; transcriptPk: number } {
    const transcriptPk = Number(db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)').run(fam.uuid).lastInsertRowid);
    const live = Number(db.prepare("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, status, parser_version) VALUES (?, ?, '', ?, 'live', 1)")
      .run(X10_DEV, fam.ino, transcriptPk).lastInsertRowid);
    db.prepare('INSERT INTO file_paths (path, file_id, last_seen_ms) VALUES (?, ?, ?)').run(fam.path, live, Date.now());
    fam.texts.forEach((x, i) => {
      const blob = Number(db.prepare("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', ?, ?)")
        .run(segmentSha(x.text), segmentSha(`a stored body ${i}`), Buffer.byteLength(x.text, 'utf8')).lastInsertRowid);
      db.prepare("INSERT INTO entries (uuid, transcript_pk, type, role, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'user', 'operator', 1, ?, ?, ?, ?)")
        .run(x.uuid, transcriptPk, rankOf(i), live, blob, x.tsMs);
    });
    return { live, transcriptPk };
  }
  /** Where an entry's structure sits: its struct_file_id, that row's status, and its rank as text (past 2^53). */
  const structOf = (db: DatabaseSync, uuid: string): Record<string, unknown> => ({ ...(db.prepare(
    'SELECT e.struct_file_id AS file, f.status AS status, CAST(e.struct_rank_ns AS TEXT) AS rank FROM entries e JOIN ingest_files f ON f.file_id = e.struct_file_id WHERE e.uuid = ?',
  ).get(uuid) as object) });
  const deadOf = (db: DatabaseSync, fam: X10Family): number =>
    Number((db.prepare('SELECT file_id FROM ingest_files WHERE source_key = ?').get(exportedSourceKey(fam.path, X10_DEV, fam.ino)) as { file_id: number }).file_id);

  it('replay: a segment carrying an entry at the rank the store holds it leaves the structure on the live file; a newer carried rank still takes it to the exported: row', async () => {
    const { box, ids, db } = x10Store('ccrc-history-5h-tie-replay-');
    try {
      const texts = x10Texts(0xd00, 2, 'zqtiereplay', Date.now() - 400 * X10_DAY);
      const fam: X10Family = { uuid: x10U(0xd0), path: '/home/u/live/tie-replay.jsonl', ino: 9961, texts };
      const R = BigInt(texts[0]!.tsMs) * 1_000_000n;   // x10Rows gives every entry of the family this struct_rank_ns
      // texts[0] is held at R, the rank the segment carries (a tie); texts[1] at R - 1, older than the carried copy
      const { live } = x10LiveStore(db, fam, (i) => (i === 0 ? R : R - 1n));
      plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })), rows: x10Rows(fam) });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      const dead = deadOf(db, fam);
      expect(dead, 'CONTROL: the exported: row is new, so its file_id is the larger').toBeGreaterThan(live);
      expect(structOf(db, texts[1]!.uuid), 'CONTROL: a newer carried rank takes the structure (the newest-rank rule is kept)')
        .toEqual({ file: dead, status: 'exported', rank: String(R) });
      expect(structOf(db, texts[0]!.uuid), 'a replayed copy never wins a tie: the structure stays on the live file')
        .toEqual({ file: live, status: 'live', rank: String(R) });
    } finally {
      closeWriter(db);
    }
  });

  it('replay against replay: two segments carrying one entry at one rank, each through its own file, leave the structure on the first segment\'s exported: row', async () => {
    const { box, ids, db } = x10Store('ccrc-history-5h-tie-replay2-');
    try {
      const texts = x10Texts(0xd20, 1, 'zqtiereplaytwo', Date.now() - 400 * X10_DAY);
      // one session's entry, carried by segment 1 through file A and by segment 2 through file B, at the same struct rank
      const famA: X10Family = { uuid: x10U(0xd2), path: '/home/u/live/tie-replay-a.jsonl', ino: 9963, texts };
      const famB: X10Family = { uuid: x10U(0xd2), path: '/home/u/live/tie-replay-b.jsonl', ino: 9964, texts };
      const R = BigInt(texts[0]!.tsMs) * 1_000_000n;
      plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })), rows: x10Rows(famA) });
      plantSegment(box, ids.storeId, { seq: 2, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })), rows: x10Rows(famB) });
      let r = await SW.recoveryStep(db, stepCtx(box, ids));
      for (let i = 0; i < 5 && !r.done; i += 1) r = await SW.recoveryStep(db, stepCtx(box, ids));
      expect(r, 'CONTROL: both segments replayed').toMatchObject({ done: true, held: false });
      const first = deadOf(db, famA);
      const second = deadOf(db, famB);
      expect(second, 'CONTROL: the second segment\'s exported: row is the newer, so its file_id is the larger').toBeGreaterThan(first);
      expect(structOf(db, texts[0]!.uuid), 'a replay-against-replay tie keeps the first segment\'s structure')
        .toEqual({ file: first, status: 'exported', rank: String(R) });
    } finally {
      closeWriter(db);
    }
  });

  it('ingest: a live copy read at the rank an exported: row holds an entry\'s structure at takes it back though its file_id is the smaller; a live copy at an older rank does not', async () => {
    const { box, ids, db } = x10Store('ccrc-history-5h-tie-ingest-');
    try {
      const texts = x10Texts(0xd10, 2, 'zqtieingest', Date.now() - 400 * X10_DAY);
      const fam: X10Family = { uuid: x10U(0xd1), path: '/home/u/live/tie-ingest.jsonl', ino: 9962, texts };
      const R = BigInt(texts[0]!.tsMs) * 1_000_000n;
      // the backup held both rows at R - 1; the segment carries them at R, newer, so replay moves both onto the exported: row
      const { live, transcriptPk } = x10LiveStore(db, fam, () => R - 1n);
      plantSegment(box, ids.storeId, { seq: 1, writer: X10_WRITER, blobs: texts.map((t) => ({ text: t.text })), rows: x10Rows(fam) });
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      const dead = deadOf(db, fam);
      expect(texts.map((x) => structOf(db, x.uuid)['file']), 'CONTROL: replay moved both onto the exported: row').toEqual([dead, dead]);
      // The live file is read again from the backup's cursor: texts[0] at R (its file now has the carried copy's mtime), and
      // texts[1] at R - 1 (an older read). One chunk each, through ingest's own writeChunk, on the LIVE file_id.
      const chunkOf = (x: X10Text, rankNs: bigint): Record<string, unknown> => ({
        blobs: new Map([[segmentSha(x.text).toString('hex'), { sha: segmentSha(x.text), z: null, rawLen: 0 }]]), counts: new Map(),
        rows: [{
          kind: 'row', at: x.line, provenance: 'operator', sha: segmentSha(x.text), json: '{}', ftsText: null, ftsOverCap: false, boundary: null, kept: null,
          entry: { uuid: x.uuid, type: 'user', subtype: null, role: 'user', model: null, parentUuid: null, tsMs: x.tsMs, requestId: null,
            apiBlockIndex: null, msgId: null, sourceToolUseId: null, toolName: null, isCompactSummary: 0 },
        }],
        transcriptPk, fileId: live, rankNs, first: null, cursor: { offset: 0, tailSha: null }, size: 0, mtimeNs: 0n, rawError: null,
        nowMs: Date.now(), pairIdx: null, ccUuid: fam.uuid,
      });
      SW.writeChunk(db, chunkOf(texts[0]!, R));
      SW.writeChunk(db, chunkOf(texts[1]!, R - 1n));
      expect(structOf(db, texts[0]!.uuid), 'a live copy beats an exported: holder at an equal rank')
        .toEqual({ file: live, status: 'live', rank: String(R) });
      expect(structOf(db, texts[1]!.uuid), 'CONTROL: an older live copy never takes the structure')
        .toEqual({ file: dead, status: 'exported', rank: String(R) });
      expect(x10Count(db, 'entry_variants'), 'CONTROL: the same bodies made no variant').toBe(0);
    } finally {
      closeWriter(db);
    }
  });
});
```

The chunk is `writeChunk`'s own shape, the one history-export's hot-path cases build. Its blob is `{ z: null, rawLen: 0 }`, the shape the ingest gives a blob the store already holds live (`blobLive`). So the chunk stores no bytes, and with the same sha it adds no variant.

- [ ] **Step 8: Run them and see them fail.** From inside `server/`, in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-recover.test.ts -t 'structure on a tie'
```

Expected red, all three cases, with every CONTROL passing first (measured at `e4936efab` for the first two; the replay-against-replay case is predicted):
- replay: `a replayed copy never wins a tie: the structure stays on the live file: expected { file: 2, status: 'exported', …(1) } to deeply equal { file: 1, status: 'live', …(1) }`;
- replay against replay: `a replay-against-replay tie keeps the first segment's structure: expected { file: <second>, status: 'exported', …(1) } to deeply equal { file: <first>, status: 'exported', …(1) }`, because the shipped tie goes to the larger `file_id`;
- ingest: `a live copy beats an exported: holder at an equal rank: expected { file: 2, status: 'exported', …(1) } to deeply equal { file: 1, status: 'live', …(1) }`.

- [ ] **Step 9: Bind the tie arm.** In `ccd/history/sweep.mjs`, insert directly above `const ENTRY_UPSERT = \`INSERT INTO entries (uuid, transcript_pk, type, subtype, role, model, parent_uuid,`:

```js
// D-5638 (history-ingest-live-beats-exported-tie): the tie arm is bound by ?21, 1 at ingest (writeChunk) and 0 at segment
// replay (replayEntryRow). A replayed copy never wins a tie, so a restore's entry keeps its structure on the live file the
// backup held rather than move onto the exported: row replay just made (whose file_id is always the larger); and at ingest
// a live copy beats an exported: holder at an equal rank whatever the file ids, which brings back an entry a replay took at
// a strictly newer rank once the live file is read at that rank. A strictly newer rank wins from either caller, as before.
```

Replace the statement's last two lines:

```js
  WHERE excluded.struct_rank_ns > entries.struct_rank_ns
     OR (excluded.struct_rank_ns = entries.struct_rank_ns AND excluded.struct_file_id > entries.struct_file_id)`;
```

with:

```js
  WHERE excluded.struct_rank_ns > entries.struct_rank_ns
     OR (?21 = 1 AND excluded.struct_rank_ns = entries.struct_rank_ns
         AND (excluded.struct_file_id > entries.struct_file_id
              OR (SELECT status FROM ingest_files WHERE file_id = entries.struct_file_id) = 'exported'))`;
```

The VALUES list keeps its twenty plain `?`. SQLite numbers them 1 to 20, so `?21` is the 21st argument (measured on `node:sqlite`).

In `replayEntryRow`, replace `    r.parse_state, r.struct_rank_ns, fileId, blobId);` with:

```js
    r.parse_state, r.struct_rank_ns, fileId, blobId, 0);   // 0: a replayed copy never wins a tie (D-5638)
```

In `writeChunk`, replace `        chunk.rankNs, chunk.fileId, blobId);` with:

```js
        chunk.rankNs, chunk.fileId, blobId, 1);   // 1: ingest's tie arm (D-5638)
```

These are the statement's only two callers (`grep -n 'entryUpsert.run' ccd/history/sweep.mjs` prints two lines). Run `node --check ccd/history/sweep.mjs`.

- [ ] **Step 10: Run and see them pass, with the ingest hot path.** From inside `server/`, each in the foreground (timeout ≥ 600000 ms):

```bash
./node_modules/.bin/vitest run test/history-recover.test.ts -t 'structure on a tie'
./node_modules/.bin/vitest run test/history-recover.test.ts
./node_modules/.bin/vitest run test/history-ingest.test.ts
./node_modules/.bin/vitest run test/history-export.test.ts
node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected: every case is green, and tsc is silent (predicted for a worktree whose packages are all installed). Measured at `e4936efab` with Steps 3 and 9 alone, before the replay-against-replay case was added: history-recover 141 passed (142 with it, predicted), history-ingest 163 passed (O20's RSS bound included), history-export 84 passed. The O43 reused-inode case (`the newest-rank rule puts every entry's structure on the live copy`) stays green: there the live row is the newer row and wins by the larger `file_id` at ingest. A red in history-ingest that is not a structure or variant case gets re-run alone before it is called a break.

- [ ] **Step 11: Mutations, each guard reds its case.** From the repository root, run `cp ccd/history/sweep.mjs "$SCRATCH/sweep.mjs.t6b"`, after `SCRATCH="$PWD/.superpowers/sdd/history-w5h1/scratch"; mkdir -p "$SCRATCH"` (the same directory as Step 5's). Apply each mutation by hand, run it from inside `server/`, see it red, then `cp "$SCRATCH/sweep.mjs.t6b" ccd/history/sweep.mjs` before the next one. Keep `?21` in the SQL in every mutant. Deleting `?21 = 1 AND ` outright leaves the 21st argument out of range, and the step then fails its chunk (`expected { moved: true, done: false, … }`, measured) before it reaches the guard's assertion.

| Mutation | `-t` filter (`test/history-recover.test.ts`) | Expected red (measured) |
|---|---|---|
| Restore the shipped tie for replay: replace `     OR (?21 = 1 AND excluded.struct_rank_ns = entries.struct_rank_ns` with `     OR (?21 IN (0, 1) AND excluded.struct_rank_ns = entries.struct_rank_ns` | `replay: a segment carrying an entry at the rank` | `a replayed copy never wins a tie: the structure stays on the live file: expected { file: 2, status: 'exported', …(1) } to deeply equal { file: 1, status: 'live', …(1) }` |
| In `replayEntryRow`, bind `1` instead of `0` (`fileId, blobId, 0);` becomes `fileId, blobId, 1);`) | `replay: a segment carrying an entry at the rank` | the same red as the row above |
| The same mutation | `replay against replay` | `a replay-against-replay tie keeps the first segment's structure: expected { file: <second>, status: 'exported', …(1) } to deeply equal { file: <first>, status: 'exported', …(1) }` (predicted) |
| Drop the ingest arm: replace the two lines `         AND (excluded.struct_file_id > entries.struct_file_id` / `              OR (SELECT status FROM ingest_files WHERE file_id = entries.struct_file_id) = 'exported'))\`;` with the one line `         AND (excluded.struct_file_id > entries.struct_file_id))\`;` | `ingest: a live copy read at the rank` | `a live copy beats an exported: holder at an equal rank: expected { file: 2, status: 'exported', …(1) } to deeply equal { file: 1, status: 'live', …(1) }` |
| In `writeChunk`, bind `0` instead of `1` (`chunk.fileId, blobId, 1);` becomes `chunk.fileId, blobId, 0);`) | `ingest: a live copy read at the rank` | the same red as the row above |
| Name the wrong holder: in the subquery, `= 'exported'))` becomes `= 'live'))` | `ingest: a live copy read at the rank` | the same red as the row above |

After the last restore, `cmp "$SCRATCH/sweep.mjs.t6b" ccd/history/sweep.mjs` prints nothing. Run the first filter of Step 10 green once more, then remove this task's copies only, `rm "$SCRATCH"/recall.mjs.t6a "$SCRATCH"/sweep.mjs.t6b`.

- [ ] **Step 12: Commit**, from the repository root:

```bash
git add ccd/history/sweep.mjs server/test/history-recover.test.ts
git commit -m "fix(history): a replayed copy never wins an entry's structure on a tie, and at ingest a live copy beats an exported: holder at an equal rank (D-5638; wave 5h-1)"
```

---

### Task 7: the operator's text, the B4 errata, and the whole-PR checks

**Files:**
- Modify: `ccd/history/lib.mjs`. In place, `HEALTH_REMEDIES['store-unbound']` (`:3397` at e4936efab) and `remedyFor`'s `case 'store-unbound':` (`:3459-3460`); appended at the END of the file (after `readExportDueOldest`, `:8600` at e4936efab, as later tasks leave it): `carryHoldAdvice` and `adoptCarryAdvice`.
- Modify: `ccd/history/lib.d.mts`, appended at the END (`:980` at e4936efab): one declaration each.
- Modify: `ccd/history/sweep.mjs`, in place, all above the R1 entry guard: the `from './lib.mjs'` import clause's closing line (`:66`), `adoptArm`'s docstring (`:3415-3417`, the sentence ending `HEALTH_REMEDIES is unchanged.`), and its carry line (`:3433`, `out(\`history-sweep: the operator, from a terminal outside any session: …\`)`).
- Modify: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, in place, the wave's only spec edits (no earlier task edits the spec): §6.1's structure tie-break line (`:654`); §8.4's `**Carry before the verb.**` bullet (`:1776`); §9.2 step 5's RV15 line (`:2088`); §9.6's "FAIL on" list (after the `export-overdue` bullet, `:2270`) and "WARN on" list (after the `export-segment-missing` bullet, `:2287`); §9.10's failure table (after the `Export marks after a bind` row, `:2400`); §9.14's `**Export replay**` paragraph (`:2539`), its "entries by the newest-rank rule" clause and its last-but-one sentence; §9.15's `**After a bind**` bullet (`:2575`) and its `**Who reads it.**` sentence (`:2578`).
- Modify: `docs/superpowers/plans/2026-10-07-ccrc-history-w1-b4-export.md`, in place, one clause each: Global Constraints' **Tests** bullet (`:118`) and Task 4's `- [ ] **Step 2: Write the failing tests.**` line (`:2267`).
- Test: `server/test/history-lib.test.ts` (a case after `it('store-unbound names meta.store_id and the --adopt remedy'`, `:4287-4291`), `server/test/history-recover.test.ts` (C55's adopt case, after its H-100 expectation, `:1196-1199`), `server/test/history-export.test.ts` (in `marks that move`, after the `O39: after an adopt with the segments left behind` case, `:949-981`), `server/test/history-store.test.ts` (the `modes:` case's title only, `:2608`).
- Read, no edit: `README.md`'s `### Session history: lossless recall (\`ccrc history\`)` section (`:5517` at e4936efab); `CLAUDE.md` (README's line count does not move).
- Create (gitignored scratch, never committed): `.superpowers/sdd/history-w5h1/scratch/t7-mutants.py`, `.superpowers/sdd/history-w5h1/pr-body.md`.

Every anchor was measured at e4936efab. Tasks 1–6 edit the same files first, so re-anchor each edit by its content. Each script below asserts that its anchor occurs exactly once.

**Interfaces:**
- Consumes: lib's `SWITCHES.off` (`'.ccrc/history-off'`, the switch's one spelling, O13), `HISTORY_ROOT_REL` (`'.ccrc/history'`), `EXPORT_DIR` (`'export'`); `HEALTH_REMEDIES` and `remedyFor`'s `store-unbound` arm; sweep's `adoptArm` and `scheduledPass` (whose `if (existsSync(P.off)) { out('history-sweep: off'); return EXIT.OK; }` is this task's CONTROL guard and is unchanged); the export test helpers `ingestedBox`, `passAt`, `adoptOnPty`, `marks`, `metaOf`, `counters`, `exportDirOf`, `segmentsOf`. From Task 1: `HEALTH_META.exportMarksCheck`, `EXPORT_BIND_BYTES`, `EXPORT_BIND_WAL_CEILING`, `EXPORT_MARKS_STALL_MS`, `MARK_CHECK_STALL_WORDS` (the escalating class). From Task 2: the words `export-marks-unchecked` and `export-marks-stalled`. From Task 3: the counter `export_segment_damaged` and the word `export-segment-damaged`. From Task 4: the meta key `export_marks_checked_listing` (every listed name, damaged ones included). From Task 5: `segmentOrdersAfter`. From Task 6: `ENTRY_UPSERT`'s `?21` and `expandEntryText`'s `causes`.
- Produces:
  - `lib.mjs`: `export function carryHoldAdvice(when: 'before the adopt' | 'before you copy'): string` returns `` `touch ~/${SWITCHES.off} ${when} and remove it only once both directories are here, complete and matching their source: a tick before then clears the export mark of every segment not here whole, and its rows export again` ``.
  - `lib.mjs`: `export function adoptCarryAdvice(storeId: string | null): string` returns `` `when ~/${HISTORY_ROOT_REL}/journal/${id}/ and ~/${HISTORY_ROOT_REL}/${EXPORT_DIR}/${id}/ are to come from the box the store left, copy them here before the adopt, or ${carryHoldAdvice('before the adopt')}` ``, where `id` is `storeId ?? '<store_id>'`.
  - The `store-unbound` remedy, both its fallback and its dynamic form, ends with `` `; ${adoptCarryAdvice(…)}` ``.
  - The adopt's carry line ends with `` `; if you copy them after this adopt, ${carryHoldAdvice('before you copy')}` ``.
  - The spec's and the B4 plan's amended text, the retitled `modes:` case, and the PR body file.

**Spec:**
- §8.4 (`doctor --adopt`, "Carry before the verb"); §6.1 and §9.2 step 5 (the structure tie-break, RV15); §9.14 ("Export replay"); §9.15 ("After a bind"); §9.6 (every non-PASS line carries a remedy); §9.10 (the failure table); §9.7 and O13 (switches have readers only); §9.12 (rollout through the release lane only).
- This task holds every spec edit of the wave (Step 7). Each amended sentence cites its D-number: D-5632 (Task 1), D-5633 (Task 2), D-5634 (Task 3), D-5635 (this task), D-5636 (Task 4), D-5637 (Task 5) and D-5638 (Task 6).
- Departures:
  - NEW **D-5635** (`history-export-adopt-carry-remedy`): it reverses B2's RB11 note that "HEALTH_REMEDIES text is unchanged" (coordinator ruling R11).
  - This task cites, and defines no number for: D-4762 (`history-export-outside-capture-pause`; R2 keeps the check outside `db/`'s floor), D-4765 (`history-export-segment-unreadable-stalls`), D-5395 (`history-export-mark-needs-its-blobs`), D-5396 (`history-export-bind-clears-pruned-referrers`), D-4314 (the off switch holds back freshness FAILs), and Tasks 1–6's numbers in the spec sentences it writes for them.
  - The B4 plan's errata take no number (ruled): they record review 624's shipped CodeQL change as a superseded clause.
- Choices this task makes:
  - **One text, two readers.** lib's `carryHoldAdvice` holds the hold sentence once. The remedy says it `'before the adopt'`, and the carry line says it `'before you copy'`.
  - **No switch spelling in sweep.mjs.** Its carry line interpolates the lib function, so `sweep.mjs` never spells `/history-off` (O13's holders stay `ccd/ccd-history-sweep`, `ccd/history/lib.mjs`, `ccd/session-hook.sh`).
  - **Appended, not inserted.** The two functions are appended at lib's end, not placed above `HEALTH_REMEDIES`, which calls them while the module loads. A function declaration is hoisted whole, and every const either one reads is initialised above `HEALTH_REMEDIES`.
  - **A premise pin.** The history-export case pins the advice's premise: history-off holds the check after a bind. It is green on the base by design, because no code path changes, and its guard is measured by mutant M4. On this PR's tree two guards hold that tick: `scheduledPass`'s `if (existsSync(P.off))`, which ends the tick before it opens the store, and Task 1's own `off` stop in `checkSegmentMarks` (`markCheckStop`'s `off: existsSync(ctx.paths.off)`, pinned by Task 1's mutant 15). Under M4 alone the second still stops the check before its first batch, so the marks and `export_marks_checked_binds` would hold; the case therefore also asserts, right after the tick under history-off, that no stop record stands (`HEALTH_META.exportMarksCheck` is `null`). Under M4 that record reads `off <ms> 0`, and the case reds.
  - **The PR's checks.** README is not edited, because its history section states no rule this PR changes (Step 9 measures that). The spec gains no rev bump; its sentences are amended in place, as B4's own §9.14 edit was.

- [ ] **Step 1: Write the failing tests.** From the repository root:

```bash
python3 - <<'EOF'
def sub(rel, old, new):
    s = open(rel, encoding='utf8').read()
    assert s.count(old) == 1, (rel, old[:70], s.count(old))
    open(rel, 'w', encoding='utf8').write(s.replace(old, new))
    print('edited', rel)

# history-lib.test.ts: inside deriveHealth's describe, after the store-unbound dynamic-remedy case
sub('server/test/history-lib.test.ts',
"""    expect(r.fail[0]!.remedy).toContain('ccrc history doctor --adopt');
  });
""",
"""    expect(r.fail[0]!.remedy).toContain('ccrc history doctor --adopt');
  });
  it('store-unbound\\'s remedy says to carry before the adopt or to hold the ticks with history-off until the carry is whole (D-5635)', () => {
    const hold = 'touch ~/.ccrc/history-off before the adopt and remove it only once both directories are here, complete and matching their source';
    const loss = 'a tick before then clears the export mark of every segment not here whole, and its rows export again';
    const fallback = healthLib.HEALTH_REMEDIES['store-unbound']!;
    expect(fallback).toContain('; when ~/.ccrc/history/journal/<store_id>/ and ~/.ccrc/history/export/<store_id>/ are to come from the box the store left, copy them here before the adopt, or ');
    expect(fallback).toContain(hold);
    expect(fallback).toContain(loss);
    const r = healthLib.deriveHealth(base({ exit: 5, reason: 'store-unbound', storeId: STORE })).fail[0]!.remedy;
    expect(r).toContain(`; when ~/.ccrc/history/journal/${STORE}/ and ~/.ccrc/history/export/${STORE}/ are to come from the box the store left`);
    expect(r).toContain(hold);
    expect(r).toContain(loss);
    expect(r, 'the bind half is unchanged').toContain(`if store ${STORE} is another box's, remove the ~/.ccrc/history/db link or move the DB aside`);
    expect(healthLib.carryHoldAdvice('before you copy')).toBe(
      `touch ~/.ccrc/history-off before you copy and remove it only once both directories are here, complete and matching their source: ${loss}`);
  });
""")

# history-recover.test.ts: C55's adopt case, after its H-100 expectation
sub('server/test/history-recover.test.ts',
"""      `the operator, from a terminal outside any session: if the box this store left still has ~/.ccrc/history/journal/${storeId}/`);
""",
"""      `the operator, from a terminal outside any session: if the box this store left still has ~/.ccrc/history/journal/${storeId}/`);
    // D-5635: a carry after the bind holds the ticks with history-off until it is whole, said where the operator reads it.
    expect(r.out.replace(/\\r/g, '')).toContain(
      "their file names never collide with this box's; if you copy them after this adopt, touch ~/.ccrc/history-off before you copy and remove it only once both directories are here, complete and matching their source");
""")

# history-export.test.ts: in 'marks that move', after the O39 adopt case
sub('server/test/history-export.test.ts',
"""    expect(counters(box)['export_segment_missing'], 'a second check ran without a second bind').toBe(1);
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
  }, 300_000);
""",
"""    expect(counters(box)['export_segment_missing'], 'a second check ran without a second bind').toBe(1);
    expect(strandedBlobs(box), 'D-5395: no live blob is held only by marked entries').toEqual([]);
  }, 300_000);

  it('D-5635: history-off touched before an adopt holds the check while a late carry runs, and a carry whole by the time the switch goes clears nothing', async () => {
    const { box, ids } = ingestedBox('ccrc-history-export-carryoff-', [row(1, 'one', 2 * DAY), row(2, 'two', DAY)]);
    const P = historyPaths(box.home);
    passAt(box, 65);
    const s1 = `1.${ids.writer}.db`;
    expect(Object.values(marks(box))).toEqual([s1, s1]);
    // the store comes to "this box"; its export directory is still on the one it came from, and the operator holds the ticks first
    const away = path.join(box.home, 'export-still-on-the-old-box');
    const here = exportDirOf(box);
    fs.renameSync(here, away);
    fs.rmSync(P.storeId);
    fs.rmSync(P.writer);
    fs.writeFileSync(P.off, '');
    const adopt = await adoptOnPty(box);
    expect(adopt.code, adopt.out).toBe(0);
    passAt(box, 70);   // a timer tick while the copy runs
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'no step ran under history-off').toBeNull();
    expect(Object.values(marks(box)), 'a tick under history-off checked the marks').toEqual([s1, s1]);
    expect(metaOf(box, 'export_marks_checked_binds'), 'no check ran under history-off').toBeNull();
    // the copy is whole, then the switch goes: the next tick checks, and every marked segment is here
    fs.renameSync(away, here);
    fs.rmSync(P.off);
    passAt(box, 72);
    expect(metaOf(box, 'export_marks_checked_binds'), 'the check ran once the switch went').not.toBeNull();
    expect(metaOf(box, HEALTH_META.exportMarksCheck), 'the check finished: no stop word stands').toBeNull();
    expect(Object.values(marks(box)), 'a carried segment, whole, keeps its marks').toEqual([s1, s1]);
    expect(counters(box)['export_segment_missing']).toBeUndefined();
    expect(counters(box)['export_segment_damaged'], 'the carried segment reads whole and this store\\'s').toBeUndefined();
    expect(segmentsOf(box), 'nothing was exported again').toEqual([s1]);
  }, 300_000);
""")
EOF
```

Expected: three `edited` lines.

- [ ] **Step 2: Run them and see the two text cases fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'hold the ticks with history-off')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'binds it under a new writer, journals the bind')
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'holds the check while a late carry runs')
```

Each filter selects exactly 1 case (measured). Expected results, measured at e4936efab on a copy with this step's edits:
- **history-lib:** `Tests  1 failed | 1083 skipped (1084)`, with `AssertionError: expected 'if the store is another box\'s, remov…' to contain '; when ~/.ccrc/history/journal/<store…'`.
- **history-recover:** `Tests  1 failed | 138 skipped (139)`, with `AssertionError: expected 'history-sweep: adopt: store <uuid>…' to contain 'their file names never collide with t…'`.
- **history-export:** `Tests  1 passed`. It is GREEN by design: it pins the advice's premise, which `scheduledPass` already holds, and Step 5's mutant M4 measures its guard.

The measured base run had neither of the two `HEALTH_META.exportMarksCheck` lines nor the `export_segment_damaged` line. On this PR's tree, Tasks 1 and 3 define both names. A red here on either line is a finding against that task: report it, and never weaken the line. The skipped counts are e4936efab's and grow with Tasks 1–6.

- [ ] **Step 3: Implement.** From the repository root:

```bash
python3 - <<'EOF'
def sub(rel, old, new):
    s = open(rel, encoding='utf8').read()
    assert s.count(old) == 1, (rel, old[:70], s.count(old))
    open(rel, 'w', encoding='utf8').write(s.replace(old, new))
    print('edited', rel)
def append(rel, text):
    s = open(rel, encoding='utf8').read()
    if not s.endswith('\n'): s += '\n'
    open(rel, 'w', encoding='utf8').write(s + text)
    print('appended', rel)

# lib.mjs: the store-unbound remedy, fallback and dynamic, gains the carry half
sub('ccd/history/lib.mjs',
"""which binds it, from a terminal outside any session (capture stays held until then)`,
  'store-unreachable':""",
"""which binds it, from a terminal outside any session (capture stays held until then); ${adoptCarryAdvice(null)}`,
  'store-unreachable':""")
sub('ccd/history/lib.mjs',
"""which binds it, from a terminal outside any session (capture stays held until then)`;
    case 'store-recoverable':""",
"""which binds it, from a terminal outside any session (capture stays held until then); ${adoptCarryAdvice(h.storeId ?? null)}`;
    case 'store-recoverable':""")
append('ccd/history/lib.mjs', """
// ── D-5635 (history-export-adopt-carry-remedy): the hold a carry after an adopt needs ─────────────────────────────
/** The first tick after a bind clears the export mark of every segment that is not on this box whole (§9.15
 *  "After a bind"), so a carry still running at that tick costs a re-export of every row the missing segments held.
 *  history-off holds that tick (sweep's scheduledPass ends before it opens the store) while the three binding verbs
 *  still run under it (§8.4), so the operator holds the ticks until the copy is whole. One text, two readers: the
 *  store-unbound remedy, read before the adopt (`'before the adopt'`), and the adopt's carry line, printed after its
 *  bind (`'before you copy'`). SWITCHES.off is the switch's one spelling (O13). Declared below HEALTH_REMEDIES,
 *  which calls it while the module loads: a function declaration is hoisted whole, and every const it reads
 *  (SWITCHES, HISTORY_ROOT_REL, EXPORT_DIR) is initialised above HEALTH_REMEDIES. */
export function carryHoldAdvice(when) {
  return `touch ~/${SWITCHES.off} ${when} and remove it only once both directories are here, complete and matching their source: a tick before then clears the export mark of every segment not here whole, and its rows export again`;
}

/** The store-unbound remedy's carry half (D-5635): the two directories a store's id keys (`<store_id>` when the id is
 *  not known), copied here before the adopt, or held behind history-off from before it. */
export function adoptCarryAdvice(storeId) {
  const id = storeId ?? '<store_id>';
  return `when ~/${HISTORY_ROOT_REL}/journal/${id}/ and ~/${HISTORY_ROOT_REL}/${EXPORT_DIR}/${id}/ are to come from the box the store left, copy them here before the adopt, or ${carryHoldAdvice('before the adopt')}`;
}
""")
append('ccd/history/lib.d.mts', """/** D-5635: the hold a carry after an adopt needs; the store-unbound remedy and the adopt's carry line both say it. */
export function carryHoldAdvice(when: 'before the adopt' | 'before you copy'): string;
/** D-5635: the store-unbound remedy's carry half, for a store id (or null when it is not known). */
export function adoptCarryAdvice(storeId: string | null): string;
""")

# sweep.mjs: the import, the carry line, and the docstring RB11's note sat in
sub('ccd/history/sweep.mjs',
"""
} from './lib.mjs';""",
"""
  carryHoldAdvice,
} from './lib.mjs';""")
sub('ccd/history/sweep.mjs',
"""copy each to the same path here (~/.ccrc/history/journal/${id}/, ~/.ccrc/history/export/${id}/); their file names never collide with this box's`);""",
"""copy each to the same path here (~/.ccrc/history/journal/${id}/, ~/.ccrc/history/export/${id}/); their file names never collide with this box's; if you copy them after this adopt, ${carryHoldAdvice('before you copy')}`);""")
sub('ccd/history/sweep.mjs',
""" *  keyed by the store's id, not by this box; adopt prints it itself (RB11), and HEALTH_REMEDIES is unchanged. */""",
""" *  keyed by the store's id, not by this box; adopt prints it itself (RB11). D-5635 reverses RB11's "HEALTH_REMEDIES is
 *  unchanged": the store-unbound remedy, read before the verb, and this line, printed after it, both say lib's
 *  carryHoldAdvice, because a carry still running at the first tick after the bind clears its segments' marks. */""")
EOF
grep -c 'export function carryHoldAdvice' ccd/history/lib.d.mts
grep -c 'export function adoptCarryAdvice' ccd/history/lib.d.mts
```

Expected: three `edited` lines for the lib remedies and sweep, then two `appended` lines, then `1` and `1`. Each export is declared exactly once, because `skipLibCheck` would hide a duplicate.

- [ ] **Step 4: Run them green, with the whole lib file, the CONTROL, O13 and the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'hold the ticks with history-off')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'binds it under a new writer, journals the bind')
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'holds the check while a late carry runs')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'history-off')
grep -n '/history-off' ccd/history/sweep.mjs ccd/history/cli.mjs || echo 'no /history-off spelling'
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- The three new or extended cases pass, `Tests  1 passed` each. All three were measured green at e4936efab with Steps 1 and 3 applied.
- The whole of history-lib is green: 1084/1084 measured at e4936efab plus this case. Tasks 1–6 add more.
- The CONTROL `history-off: the shim ends a scheduled pass silently, and sweep.mjs itself says off` passes, `Tests  1 passed` (measured).
- The grep prints `no /history-off spelling`.
- single-definition's `'ccrc history'` cases are green: at least 48 selected, the B4 plan's measured floor.
- tsc prints nothing.

- [ ] **Step 5: Measure every guard red, then green.** From the repository root. The runner is a gitignored scratch tool, never committed. It copies each file to `scratch/keep/`, applies one mutant, runs that mutant's case (which must fail), restores the file, removes the copy, and runs the case again (which must pass):

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w5h1/scratch"; mkdir -p "$SCRATCH/keep"
cat > "$SCRATCH/t7-mutants.py" <<'EOF'
import os, shutil, subprocess, sys
KEEP = sys.argv[1]
M = [
 ('M1 the fallback remedy loses its carry half', 'ccd/history/lib.mjs',
  "(capture stays held until then); ${adoptCarryAdvice(null)}`,", "(capture stays held until then)`,",
  'test/history-lib.test.ts', 'hold the ticks with history-off'),
 ('M2 the dynamic remedy loses its carry half', 'ccd/history/lib.mjs',
  "(capture stays held until then); ${adoptCarryAdvice(h.storeId ?? null)}`;", "(capture stays held until then)`;",
  'test/history-lib.test.ts', 'hold the ticks with history-off'),
 ('M3 the carry line loses the hold', 'ccd/history/sweep.mjs',
  "; if you copy them after this adopt, ${carryHoldAdvice('before you copy')}`);", "`);",
  'test/history-recover.test.ts', 'binds it under a new writer, journals the bind'),
 ('M4 a scheduled pass runs under history-off', 'ccd/history/sweep.mjs',
  "  if (existsSync(P.off)) {\n    out('history-sweep: off');\n    return EXIT.OK;\n  }\n  const role = readRole(P);", "  const role = readRole(P);",
  'test/history-export.test.ts', 'holds the check while a late carry runs'),
]
def run(test, filt):
    return subprocess.run(['./node_modules/.bin/vitest', 'run', test, '-t', filt], cwd='server', capture_output=True, text=True).returncode
for name, rel, old, new, test, filt in M:
    keep = os.path.join(KEEP, os.path.basename(rel))
    if os.path.exists(keep):
        sys.exit(f'refusing: {keep} is left from a killed run; restore it with: cp {keep} {rel} && rm {keep}')
    shutil.copyfile(rel, keep)
    try:
        s = open(rel, encoding='utf8').read()
        assert s.count(old) == 1, (name, s.count(old))
        open(rel, 'w', encoding='utf8').write(s.replace(old, new))
        red = run(test, filt)
    finally:
        shutil.copyfile(keep, rel)
        os.remove(keep)
    print(f'{name}: mutant rc {red}, restored rc {run(test, filt)}')
EOF
python3 "$SCRATCH/t7-mutants.py" "$SCRATCH/keep"
ls -A "$SCRATCH/keep"
```

Expected: four lines, each ending `mutant rc 1, restored rc 0`, then an empty listing. All four were measured at e4936efab. The failure each mutant produces:
- **M1:** `expected 'if the store is another box\'s, remov…' to contain '; when ~/.ccrc/history/journal/<store…'`.
- **M2:** the dynamic remedy's `toContain` reds; the exact message wording is predicted.
- **M3:** Step 2's recover red, `… to contain 'their file names never collide with t…'`.
- **M4:** on this PR's tree, `AssertionError: no step ran under history-off: expected 'off <ms> 0' to be null` (predicted). The red measured at e4936efab, before Task 1's own `off` stop existed and before this line was added, was `AssertionError: a tick under history-off checked the marks: expected [ null, null ] to deeply equal [ '1.<writer>.db', '1.<writer>.db' ]`. On this PR's tree two guards hold the tick: `scheduledPass`'s, which M4 deletes, and Task 1's `off` stop in `checkSegmentMarks`, which Task 1's mutant 15 measures. With only M4 applied, Task 1's stop leaves the marks and `export_marks_checked_binds` as they were, so the `HEALTH_META.exportMarksCheck` line is what reds it.

M4 also reds the history-sweep CONTROL; this runner runs only the export case. If any line reads `mutant rc 0`, that guard is unpinned: report it, and never weaken the guard.

- [ ] **Step 6: Commit the code.**

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs server/test/history-lib.test.ts server/test/history-recover.test.ts server/test/history-export.test.ts
git commit -m "fix(history): the store-unbound remedy and the adopt's carry line say to hold the ticks with history-off during a late carry (D-5635; wave 5h-1 Task 7)"
```

- [ ] **Step 7: Amend the spec in place for Tasks 1–6 and this task.** This is the wave's only spec edit; no earlier task touches the spec. Each amended sentence cites its D-number. These sentences change:
  - §8.4's "Carry before the verb" says what the remedy and the carry line now say (D-5635; R11).
  - §9.15's "Who reads it" names the check after a bind as the export's second reader, by header and by a whole segment's meta, read-only (Task 3, D-5634; R6).
  - §9.15's "After a bind" says that the check also runs on a changed listing of every listed name (Task 4, D-5636; R7), counts a segment only when it is whole and this store's (Task 3, D-5634; R6), runs in bounded batches with its stop words and outside `db/`'s floor, and deletes a stop record no owed check stands behind (Task 1, D-5632; R1, R2, R3), and has doctor's two words (Task 2, D-5633; R4, R5 as amended).
  - §9.6 gains a FAIL bullet for `export-marks-stalled` and WARN bullets for `export-marks-unchecked` and `export-segment-damaged`; §9.10's failure table gains a row for each of the three words (Tasks 2 and 3, D-5633, D-5634).
  - §9.14's replay sentence says replay marks by the last carrier (Task 5, D-5637; R8).
  - §6.1's tie-break, §9.2's RV15 statement and §9.14's "entries by the newest-rank rule" say a replayed copy never wins a tie and a live copy beats an `exported:` holder (Task 6, D-5638; R10).

**R5's ruling first.** R5 was provisional when this plan was written, and the operator rules on it at plan approval, before execution, so the brief states that ruling. The three sentences below that name doctor's FAIL carry the token `R5_RULED`, which the script replaces with `R5_RULED_TEXT`:
- the operator accepted R5 as written: set `R5_RULED_TEXT` to `ruled by the operator at plan approval, <the date the brief gives>`;
- the operator changed R5 (another threshold, another class, or WARN only): the brief names the change, and Task 2's code, these three sentences, D-5633 and the PR body follow the brief, never this plan. A departure this plan does not list takes `D-TBD-<slug>` (Global Constraints), and the worker reports it.

In the same commit, append one sentence to D-5633's **Provisional** bullet in this plan's "Deviations found": `Ruled by the operator at plan approval (<date>): <the brief's R5 ruling, in one line>.` The bullet's first sentence stays as history.

From the repository root:

```bash
python3 - <<'EOF'
def sub(rel, old, new):
    s = open(rel, encoding='utf8').read()
    assert s.count(old) == 1, (rel, old[:70], s.count(old))
    open(rel, 'w', encoding='utf8').write(s.replace(old, new))
    print('edited', rel)
SPEC = 'docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md'
# R5's ruling, from the brief (see the paragraph above this script): never left as a placeholder
R5_RULED_TEXT = 'ruled by the operator at plan approval'
_sub = sub
def sub(rel, old, new):
    _sub(rel, old, new.replace('R5_RULED', R5_RULED_TEXT))
# §8.4, the adopt's carry (D-5635)
sub(SPEC,
"""  - **Carry before the verb.** The remedy line says to copy those two directories from the box the store left, when that box still has them, before running `--adopt`. A carry after it is still safe, because names never collide, but the first tick after any bind clears the export marks whose segment is not on this box, so they export again (§9.15). A journal left behind is never merged by hand.""",
"""  - **Carry before the verb, or hold the ticks** (wave 5h-1, D-5635). The `store-unbound` remedy says to copy those two directories from the box the store left, when that box still has them, before running `--adopt`, or to touch `~/.ccrc/history-off` before the adopt and remove it only once both copies are complete and match their source; the adopt prints the same hold after its bind, in its carry line (RB11). A carry after the verb is still safe, because names never collide, but the first tick after any bind clears the export mark of every segment that is not on this box whole (§9.15), so its rows export again; `history-off` holds that tick, because a scheduled pass ends before it opens the store, while the binding verbs still run under it. A journal left behind is never merged by hand.""")
# §9.15 "After a bind" (Tasks 1, 2, 3, 4)
sub(SPEC,
"""- **After a bind** (an adopt or a restore), the first tick checks that every segment a mark names is on this box. A mark whose segment is missing (the directory was left on the box the store came from) is cleared, so its rows export again; counted `export_segment_missing`, doctor WARN. Carrying the directory before the verb avoids the re-export (§8.4).""",
"""- **After a bind** (an adopt or a restore), and whenever this store's segment listing no longer matches the record the last finished check left, the sweep checks that every segment a mark names is on this box whole. The record (wave 5h-1, D-5636) is meta `export_marks_checked_listing`: a count and an order-independent digest of every listed name, damaged ones included, never the names; every pass adds its own segment to it in the transaction that writes its marks. Any difference re-arms the check, so a segment moved aside or removed outside a bind clears its marks too; the record cannot tell a segment gone from one carried in, so a carry re-arms one check that clears nothing, and a directory that cannot be listed never re-arms it.
  - **Whole** (wave 5h-1, D-5634). A segment counts only when its size equals the page size times the page count its own header records, under a header SQLite trusts, it carries SQLite's magic, and its meta names this store and the file's own name. Any other file under a marked name counts as missing: counted `export_segment_damaged` once per name, named in doctor's WARN `export-segment-damaged`, and left in place. The check never renames, removes or writes anything under `export/`, and it runs no `quick_check`, so a corruption that keeps the file's length, or a file damaged in place after the last check, is found only by a later check or by replay (§9.14, D-4765).
  - **Cleared.** A mark whose segment is missing (the directory was left on the box the store came from, or a copy of it is not yet whole) is cleared with its blob's referrers' marks (D-5395, D-5396), so its rows export again; counted `export_segment_missing` once per check, doctor WARN, the WARN's count summing, batch by batch, the marks cleared since the last complete pass, which resets it (D-5632); a pass that completes while a check is unfinished therefore restarts the count partway through that check.
  - **Bounded** (wave 5h-1, D-5632). The check runs in batches, each one NORMAL transaction that clears its blobs' referrers before those blobs' marks, paged by `blob_id` and then `entry_id`, at most 16 MiB of stored bytes a batch, each followed by a `TRUNCATE` checkpoint that waits for no reader. No batch starts once the run budget is spent (`budget`), under `history-off` (`off`), or once a reader holds the WAL past 64 MiB (`wal-held`); a stop, or a caught failure (`unlistable`, `failed`), is recorded in meta `export_marks_check`. It keeps no cursor (each step recomputes the missing set) and records itself done only after its last batch, so one check may span steps; a step that owes no check deletes a stop record left standing. The export pass keeps running meanwhile, which can only clear more, never lose a row. Like the pass, it runs outside `db/`'s free-space floor (D-4762).
  - **Doctor** (wave 5h-1, D-5633; 24 h *chosen*, R5_RULED). A check that stopped short WARNs `export-marks-unchecked`, naming why; one that has stopped for more than 24 h on a held WAL, an unlistable directory or an error (`wal-held`, `unlistable`, `failed`), counted from when its word entered that class, FAILs `export-marks-stalled`. A check that waits on the run budget or on `history-off` never escalates: an ingest backlog that long already FAILs `lag-high`, and `history-off` holds back every other freshness FAIL (D-4314).
  - Carrying the directory before the verb, or holding the ticks with `history-off` until the carry is whole, avoids the re-export (§8.4, D-5635).""")
# §9.15 "Who reads it" (Task 3, under R6): the check after a bind becomes the export's second reader
sub(SPEC,
"""**Who reads it.** Only the recovery step (§9.14), through `store.mjs`'s read-only open. The CLI never reads it and never prints from it.""",
"""**Who reads it.** The recovery step (§9.14), through `store.mjs`'s read-only open; and the check after a bind (wave 5h-1, D-5634), which reads each listed segment's 100-byte header without SQLite and the meta of a whole one read-only, never runs `quick_check` and never writes, renames or removes anything under `export/`. The CLI never reads it and never prints from it.""")
# §9.14, replay's marks (Task 5)
sub(SPEC,
"""Replayed blobs and rows are marked with their segment, the first segment that carries them, so they are not written again (§9.15); an entry is marked from a segment only when that segment also carries the entry's pruned, unmarked blobs (D-5396).""",
"""Replayed blobs and rows are marked with their segment, the last segment in (seq, writer) order that carries them (wave 5h-1, D-5637, closing review 621's first-wins residual), so they are not written again (§9.15), and the loss of a later segment clears the marks of the rows only it carries; an entry is marked from a segment only when that segment also carries the entry's pruned, unmarked blobs (D-5396).""")
# §9.14, replay's entries and the tie (Task 6)
sub(SPEC,
"""through the same named-column inserts as ingest, entries by the newest-rank rule (§9.2).""",
"""through the same named-column inserts as ingest, entries by the newest-rank rule (§9.2), under which a replayed copy never wins a tie (wave 5h-1, D-5638).""")
# §6.1, the structure tie-break (Task 6)
sub(SPEC,
"""- Structure fields come from the newest copy: the copy whose file has the larger `mtime_ns` at read time, ties broken by the larger `file_id`.""",
"""- Structure fields come from the newest copy: the copy whose file has the larger `mtime_ns` at read time, ties broken by the larger `file_id`, except that a copy segment replay writes never wins a tie, and a copy ingest reads beats one whose file is an `exported:` dead-file row at an equal rank, whatever the ids (wave 5h-1, D-5638).""")
# §9.2 step 5, RV15's statement of the rule (Task 6)
sub(SPEC,
"""the structure columns `WHERE excluded.struct_rank_ns > entries.struct_rank_ns OR (= AND excluded.struct_file_id > entries.struct_file_id)` (RV15);""",
"""the structure columns `WHERE excluded.struct_rank_ns > entries.struct_rank_ns OR (?21 = 1 AND = AND (excluded.struct_file_id > entries.struct_file_id OR the holder's status is 'exported'))` (RV15; wave 5h-1, D-5638: the bound tie flag is 1 at ingest and 0 at segment replay);""")
# §9.6, doctor's FAIL on (Task 2)
sub(SPEC,
"""only through the default reducer that decides due-ness.

Every line names the `store_id` it measured, so per-node doctor output can be told apart.""",
"""only through the default reducer that decides due-ness.
- `export-marks-stalled` (§9.15 "After a bind"; wave 5h-1, D-5633 (`history-export-bind-check-doctor`); 24 h *chosen*, R5_RULED): the check of the export marks after a bind has stopped for over 24 h on a word no tick moves past by itself (`wal-held`, `unlistable`, `failed`), counted from when its word entered that class. It replaces `export-marks-unchecked`. A check that waits on the run budget (`budget`) or on `history-off` (`off`) never escalates: an ingest backlog that long already FAILs `lag-high`, and `history-off` holds back every other freshness FAIL (D-4314).

Every line names the `store_id` it measured, so per-node doctor output can be told apart.""")
# §9.6, doctor's WARN on (Tasks 2 and 3)
sub(SPEC,
"""- export marks cleared because their segment is not on this box (`export-segment-missing`, after an adopt or a restore, §9.15);
""",
"""- export marks cleared because their segment is not on this box (`export-segment-missing`, after an adopt or a restore, §9.15);
- a check of the export marks after a bind that has not finished (`export-marks-unchecked`, §9.15 "After a bind"; wave 5h-1, D-5633), from its stop record (meta `export_marks_check`), naming the word it last stopped on, how long it has stopped on words of that class and the marks it has cleared so far, with a remedy per word; until it finishes, a mark may still name a segment that is not on this box. A record status cannot parse is `status-unreadable`, never "no check";
- a carried segment that is not whole or not this store's, treated as missing by the check after a bind (`export-segment-damaged`, naming each, §9.15; wave 5h-1, D-5634);
""")
# §9.10, the failure table (Tasks 2 and 3)
sub(SPEC,
"""| Export marks after a bind | a mark names a segment that is not on this box | the mark is cleared so the rows export again; `export_segment_missing` +1, doctor WARN (§9.15) |
""",
"""| Export marks after a bind | a mark names a segment that is not on this box | the mark is cleared so the rows export again; `export_segment_missing` +1, doctor WARN (§9.15) |
| Export segment after a bind | a listed segment shorter or longer than its header's pages, not SQLite, another store's, or another segment's bytes under its name | treated as missing: its marks are cleared so its rows export again; `export_segment_damaged` +1 per name, doctor WARN `export-segment-damaged`; the file is left in place (§9.15; wave 5h-1, D-5634) |
| Export marks check stopped short | the run budget spent, `history-off`, a reader holding the WAL past 64 MiB, an unlistable directory or an error before the check's last batch | its word is recorded in meta `export_marks_check` and a later step resumes, keeping what it cleared; doctor WARN `export-marks-unchecked` (§9.15; wave 5h-1, D-5632, D-5633) |
| Export marks check stalled | the check has stopped on `wal-held`, `unlistable` or `failed` for over 24 h | doctor FAIL `export-marks-stalled` in place of the WARN, so `ccrc update` exits 3; `budget` and `off` never escalate (§9.6; wave 5h-1, D-5633, R5_RULED) |
""")
EOF
grep -nE '^export const (EXPORT_BIND_BYTES|EXPORT_BIND_WAL_CEILING|EXPORT_MARKS_STALL_MS) = ' ccd/history/lib.mjs
grep -nE "^const MARK_CHECK_STALL_WORDS = " ccd/history/lib.mjs
grep -c 'export_marks_checked_listing' ccd/history/lib.mjs ccd/history/sweep.mjs
grep -c "'export-segment-damaged'\|'export-marks-unchecked'\|'export-marks-stalled'" ccd/history/lib.mjs
grep -n 'export function segmentOrdersAfter' ccd/history/lib.mjs
grep -n '?21 = 1' ccd/history/sweep.mjs
for d in D-5632 D-5633 D-5634 D-5635 D-5636 D-5637 D-5638; do printf '%s %s\n' "$d" "$(grep -c "$d" docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md)"; done
grep -c 'R5_RULED\|D-5633, provisional\|provisional for the operator' docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
```

Expected: ten `edited` lines. Then the three constants read 16 MiB, 64 MiB and 24 h (`16 * 2 ** 20` or its equal, `64 * 2 ** 20`, `24 * 60 * 60 * 1000`); `MARK_CHECK_STALL_WORDS` lists `wal-held`, `unlistable` and `failed` and nothing else; the listing key is counted at least once; the three words at least three times; `segmentOrdersAfter` once; the tie flag once; and each of the seven numbers is counted at least once in the spec; the last grep prints `0` (R5's ruling is in, no placeholder or provisional left). Each new sentence states shipped behaviour. Where a measurement disagrees with one (another constant, another key name), correct the sentence to the shipped value, never the code, and name the correction in the PR body's "Choices".
- The spec edits add no `file.ext:N` token. No test reads the spec by line: the tests name it only in header comments, by section.
- The spec's §9.15 bold labels ("After a bind", "Mark") are kept, so the `§9.15 "After a bind"` citations in test headers still resolve.

- [ ] **Step 8: Note the B4 plan's two superseded spots and retitle the modes case.** Each note is one clause, and none takes a number. From the repository root:

```bash
python3 - <<'EOF'
def sub(rel, old, new):
    s = open(rel, encoding='utf8').read()
    assert s.count(old) == 1, (rel, old[:70], s.count(old))
    open(rel, 'w', encoding='utf8').write(s.replace(old, new))
    print('edited', rel)
B4 = 'docs/superpowers/plans/2026-10-07-ccrc-history-w1-b4-export.md'
sub(B4,
"""a plain-node child (under the fault preload, as B1's own store cases do) and `/bin/sh` for the umask.""",
"""a plain-node child (under the fault preload, as B1's own store cases do) and `/bin/sh` for the umask (superseded at review 624: the shipped child sets its own umask with `process.umask`, from its argv, before it imports store.mjs, so no shell is in the path).""")
sub(B4,
"""- [ ] **Step 2: Write the failing tests.** Append to the END of `server/test/history-store.test.ts`:
""",
"""- [ ] **Step 2: Write the failing tests.** Append to the END of `server/test/history-store.test.ts` (its `childPublish` is superseded at review 624 by the shipped helper, which passes the umask in argv and sets it with `process.umask` before a dynamic import of store.mjs, with no `/bin/sh`, so Step 3's two child cases fail on `TypeError: ensureSegmentDir is not a function` instead, and the `modes:` case is retitled in wave 5h-1):
""")
sub('server/test/history-store.test.ts',
"""  it('modes: under an inherited umask 0002 the segment is 0600""",
"""  it('modes: under umask 0002, which the child sets before it imports store.mjs, the segment is 0600""")
EOF
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts -t 'modes: under umask 0002')
grep -c 'inherited umask' server/test/history-store.test.ts
```

Expected: three `edited` lines, then `Tests  1 passed` (the filter selects exactly the retitled case; measured at e4936efab: `1 passed | 131 skipped (132)`), then `0`.
- The B4 plan's Task 4 code block, its `:2468` copy of the old title and its `:2601` red expectation stay as they were written. The Step 2 clause says each is superseded, and the plan is a snapshot: trust shipped source over it.
- No test reads the B4 plan by name. deviation-refs reads only D-number definitions, and these clauses add none.
- Nothing cites history-store.test.ts by line above `:2600`, so the title edit moves no citation.

- [ ] **Step 9: Check that README's history section says nothing this PR changes.** From the repository root:

```bash
sed -n '/^### Session history: lossless recall/,/^---$/p' README.md | grep -nwE 'carry|carried|marks?|marked|segments?|first-wins|tie|variants?|whole'
```

Expected: three lines, each about something else (measured at e4936efab: `40:` "the whole project", `46:` "carries the whole exit table", `71:` "SQLite segments under `~/.ccrc/history/export/`"). None states the bind check, a carry, replay's marks, the tie rule or expand's variants, so README is not edited, its line count does not move, and CLAUDE.md's `README.md (~N lines)` figure stays. If a fourth line appears (another programme's edit on `main`), read it: edit README only if it states a rule this PR changes, and then re-run `pools-prose` and `readme-holds` with Step 11.

- [ ] **Step 10: Commit the docs.**

```bash
git add docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md docs/superpowers/plans/2026-10-07-ccrc-history-w1-b4-export.md server/test/history-store.test.ts
git commit -m "docs(history): spec 6.1, 8.4, 9.2, 9.6, 9.10, 9.14 and 9.15 say what wave 5h-1 ships; B4's /bin/sh umask noted superseded, the modes case retitled (wave 5h-1 Task 7)"
```

- [ ] **Step 11: The whole-PR checks.** From the repository root, each line in the foreground with a timeout of at least 600000 ms. Re-run a red file alone before calling it a break, because CLAUDE.md names the load flakes:

```bash
git fetch origin main
# single-definition: every frozen lib export this PR added is bound in VOCABS; no switch spelled; no new env read
for n in $(git diff origin/main...HEAD -- ccd/history/lib.mjs | sed -nE 's/^\+export const ([A-Z_]+) = Object\.freeze.*/\1/p'); do
  grep -qw "$n" server/test/single-definition.test.ts && echo "bound $n" || echo "UNBOUND $n"; done
grep -n '/history-off' ccd/history/sweep.mjs ccd/history/cli.mjs || echo 'no /history-off spelling'
git diff origin/main...HEAD -- ccd/history | grep -n '^+.*process\.env' || echo 'no new process.env read'
# no new history test file, so ci.yml's node-floor list is unchanged
git diff --name-only --diff-filter=A origin/main...HEAD -- 'server/test/history-*.test.ts' | wc -l
# every touched suite, alone
for f in $(git diff --name-only origin/main...HEAD -- 'server/test/*.test.ts' | xargs -n1 basename); do
  echo "== $f"; (cd server && ./node_modules/.bin/vitest run "test/$f" 2>&1 | tail -4); done
# the rest of the history suites, which read the files this PR changes, alone
for f in $(ls server/test/history-*.test.ts | xargs -n1 basename); do
  git diff --quiet origin/main...HEAD -- "server/test/$f" || continue
  echo "== $f"; (cd server && ./node_modules/.bin/vitest run "test/$f" 2>&1 | tail -4); done
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts)
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts)
(cd server && ./node_modules/.bin/vitest run test/node-floor.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- Only `bound …` lines print, or none at all. An `UNBOUND` name is a finding against the task that added it (it owns the binding): report it to the coordinator.
- Then `no /history-off spelling`, `no new process.env read`, and `0`.
- Every suite is green: each touched suite alone, every other `history-*.test.ts` alone, and `ccrc-doctor`'s `'history'` cases (at least 114 selected, the B4 plan's floor).
- `single-definition`, `docs-policy`, `topology-clean`, `ci-pipeline` and `node-floor` are green.
- tsc prints nothing.

Copy each `Test Files … | Tests …` summary line, as printed, into the PR body. Two reds need a specific response:
- A `topology-clean` red means a new sentence names a host, an id or a private path. Rewrite that sentence; never touch the scanner.
- A `ci-pipeline` red with a non-zero count from the `--diff-filter=A` line means a task created a history test file without adding it to the node-floor heredoc. Add the file there in place, as B4's Task 5 did, and re-run `ci-pipeline`.

- [ ] **Step 12: Check the deviation ledger against `main` without merging.**

```bash
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: green. A red names a number defined in two plans: report it to the coordinator. Never renumber one yourself. This plan's numbers were issued by the allocator before it was committed. D-5635 is defined once, in this plan's `## Deviations found`, and the spec only cites it.

- [ ] **Step 13: Confirm the tree holds only this PR's work.** Run `git status --short`.
- It lists nothing: Steps 6 and 10 committed every file of this task, and every scratch file sits under the ignored `.superpowers/`.
- No step read or wrote a live `~/.ccrc`: every test ran in a fixture HOME, and every history verb ran against a fixture store.

- [ ] **Step 14: Write the PR body, and check it and every added line for private names.** Write `.superpowers/sdd/history-w5h1/pr-body.md` with exactly the text below. Then replace its four parenthesised lines:
  - the one in the `R5` bullet under `### Coordinator rulings`, with the operator's R5 ruling as the brief states it, and its date (the same ruling Step 7 wrote into the spec and D-5633);
  - the one under `### Departures`, with this plan's `## Deviations found` list, each number as the allocator minted it, one per line;
  - the one under `### Choices the tasks made`, with every task's choice bullets ("Plan choices" in Tasks 1, 3, 4 and 6, "Choices this task makes" in Tasks 2 and 7, and Task 5's "Why it is sound" and two-writers bullets), one line each, its task number first, plus any correction Step 7 made;
  - the one under `### Tests run`, with Step 11's summary lines as printed.

Every other line is final. Use the file as the body of the wave's PR, opened the way the brief says.

```markdown
## ccrc history wave 5h-1: B4's export hardening

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.6, amended in place), §6.1's and §9.2's structure tie-break, §8.4's adopt, §9.6's doctor words, §9.10's failure table, §9.14's export replay and §9.15's "After a bind".
Plan: the wave 5h-1 plan this wave's brief names.

B4 shipped the sole-copy export; its reviews left the check after a bind unbounded, blind to a partial segment and
blind to a segment lost outside a bind, and replay marking by the first carrier. This PR closes those:

- the check after a bind runs in bounded batches (Task 1): one NORMAL transaction a batch, referrers cleared before
  their blobs' marks, `blob_id` then `entry_id` keyset paging, at most 16 MiB of stored bytes a batch, a `TRUNCATE`
  checkpoint with no busy wait after each, the stop words `budget`, `off` and `wal-held` (a reader holding the WAL
  past 64 MiB), no cursor kept across steps, and the done stamp after the last batch; a step that owes no check deletes
  a stop record left standing; it stays outside `db/`'s floor, like the pass (D-4762), and the pass keeps running while
  a check is unfinished;
- doctor's rule for a check that cannot finish (Task 2): meta `export_marks_check` (`<word> <sinceMs> <cleared>`), WARN
  `export-marks-unchecked` while it stands, FAIL `export-marks-stalled` when an escalating word (`wal-held`,
  `unlistable`, `failed`) has stood longer than 24 h; `budget` and `off` never escalate;
- a carried segment counts only when it is whole and this store's (Task 3): its size equals its header's page size
  times page count, SQLite's magic, its meta's store and name; otherwise its marks clear, counted
  `export_segment_damaged`, WARN `export-segment-damaged`; the check never renames or removes a file and runs no
  `quick_check`;
- a segment that vanishes outside a bind re-arms the check (Task 4): meta `export_marks_checked_listing`, a count and an
  order-independent digest of every listed name, damaged ones included, so moving a damaged file out re-arms it too;
- replay marks a blob or an entry by the last segment that carries it (Task 5), closing review 621's first-wins
  residual;
- `expand` attaches a body's variants to every answer that is not its bytes (pruned, too large, undecodable), in
  `--json` and in the human form (Task 6);
- `ENTRY_UPSERT`'s tie (Task 6): a replayed copy never wins a tie, and a live copy beats an `exported:` holder at an
  equal rank;
- the operator's text (Task 7): the `store-unbound` remedy and the adopt's carry line say to hold the ticks with
  `history-off` while a carry is incomplete (D-5635, reversing RB11's "HEALTH_REMEDIES text is unchanged"); spec
  §6.1, §8.4, §9.2, §9.6, §9.10, §9.14 and §9.15 amended in place, each sentence citing its departure; B4's plan
  notes its `/bin/sh` umask as superseded, and the `modes:` case's title says what the test does.

Fleet-side only: `ccd/history/*` and its tests. No schema migration (still v2), no journal record kind, no
`WRITING_FORMS` entry.

### Departures

(this plan's `## Deviations found` list, as minted)

### Steps for the coordinator or the operator, never the worker

1. **Full suite.** This PR changes no `.github/` file, so the pull request runs its selection. Check that its
   `select tests` summary lists `history-export`, `history-lib`, `history-recover`, `history-store` and
   `history-recall`; if one is missing, dispatch a full run: `gh workflow run ci.yml --ref <this branch> -f mode=full`.
2. **Rollout through the release lane only** (§9.12): merge, promote, then move the fleet with the update control
   plane or `ccrc rollout`. Nothing is rolled out by hand.
3. **What doctor says after the rollout, per node.** `history` reads PASS, or only the WARNs it read before. A check
   of the export marks may run at the first tick after the update; on a node whose export directory is whole it
   clears nothing, and `ccrc history status --json`'s counters gain neither `export_segment_missing` nor
   `export_segment_damaged`. The new words, and what each asks:
   - WARN `export-marks-unchecked`: a check of the export marks stopped short. By its word: `budget`, none, it
     resumes each tick (a long ingest backlog spends the budget first); `off`, remove `~/.ccrc/history-off` once any
     carry is whole; `wal-held`, end the long-running `ccrc history` read another terminal holds; `unlistable`, make
     `~/.ccrc/history/export/<store_id>` a readable directory; `failed`, read the sweep's log
     (`journalctl --user -u ccd-history-sweep -n 50`). Whatever the word, hold any `ccrc history prune --apply` until
     the check finishes: prune is not gated on the marks.
   - FAIL `export-marks-stalled`: the check has stopped on `wal-held`, `unlistable` or `failed` for more than 24 h.
     Doctor reads red and `ccrc update` on that node exits 3: the node IS on the new build, and the FAIL is its health;
     `ccrc rollout` relays it, continues, and exits 3. The remedy is the WARN's, by its word. `budget` and `off` stay
     WARNs however long they stand.
   - WARN `export-segment-damaged`: a file under a marked segment name is not whole or not this store's. Its marks
     were cleared and its live rows export again; nothing was renamed or removed. Put a whole copy back first if one
     exists (the source box or a backup): text the store pruned that only that file held cannot be exported again.
     Otherwise move each named file aside under a non-segment name, before any `--restore` or `--rebuild`, which
     would stall on it (D-4765).
   - WARN `export-segment-missing`, as before; its count now sums, batch by batch, the marks cleared since the last complete pass (a pass that completes mid-check restarts it).
4. **Adopting a store onto another box, with a carry.** From a terminal outside any session, on the box the store
   comes to:
   1. `touch ~/.ccrc/history-off` BEFORE the adopt. The adopt runs under it; scheduled ticks do not.
   2. `ccrc history doctor --adopt`. It prints the carry line, which now repeats this hold.
   3. Copy `~/.ccrc/history/journal/<store_id>/` and `~/.ccrc/history/export/<store_id>/` from the box the store
      left to the same paths here.
   4. Compare each directory with its source, file by file (`ls -l` on both sides): the same names, the same sizes.
   5. `rm ~/.ccrc/history-off`. The next tick checks the marks. `status --json` should show neither
      `export_segment_missing` nor `export_segment_damaged`, and doctor no `export-segment-damaged`.

   Without a carry, skip steps 1, 3, 4 and 5: the first tick clears the marks and the rows export again at one
   segment an hour, so check the home filesystem's headroom first (`df -h ~`). A restore or a rebuild that carries
   `export/<store_id>/` takes the same hold: its recovery step waits for the switch's removal, so remove it only
   once the copy is whole.
5. **Moving a segment aside** (D-4765's way out): since Task 4, the check re-arms when a segment it saw is gone, so
   that segment's rows export again on the following steps, one bounded batch at a time.
6. **B4's plan errata are docs only.** The shipped `childPublish` already sets its umask itself (review 624's CodeQL
   change); the plan text now says so.

### Residuals, named

- A corruption that keeps a segment's length is not caught by the whole-segment check (R6); replay finds it and
  stalls on it (D-4765).
- The check runs last in the tick and may start no batch while ingest spends the run budget (R4): visible as
  `export-marks-unchecked` (`budget`), which never escalates; a backlog that long already FAILs `lag-high`.
- The check runs outside `db/`'s free-space floor (R2, D-4762): one batch's WAL at a time, truncated after each batch.
- The export pass runs while a check is unfinished (R3): an entry the pass marks before a later batch clears its
  blob is exported once more, never lost.
- `prune --apply` is not gated on the marks. While a check stands unfinished (`budget` and `off` for as long as they
  last), a blob whose mark still names a segment not on this box whole counts as one the export holds, and a prune
  that tombstones it leaves its bytes in no segment here; the check that reaches it later gives it only a stub (D-5396).
  B4 had the same window for one tick. The WARN's remedy says to hold any prune until the check finishes; gating
  prune on a standing check is not in this PR.
- The listing record is a count and a digest (R7): it says that the listing changed, not which name, so any change
  runs a check, which clears only what is missing. It counts every listed name, so a segment damaged in place after
  the last check (same name) re-arms nothing; its marks stand until the next bind or listing change, and replay finds
  such a file (D-4765).
- Replay still keeps a segment's bytes out over a tombstone a restore's backup held (`export_blob_tombstone_kept`):
  the operator's restore question stays open, and this PR has no code for it (R12).

### Coordinator rulings (R1–R12)

- **R1.** The check after a bind runs in bounded batches, as above (Task 1).
- **R2.** D-4762 stands: the check stays outside `db/`'s free-space floor (Task 1).
- **R3.** The export pass runs while a check is unfinished (Task 1).
- **R4.** Budget starvation behind ingest is accepted and made visible; no tick-order change (Task 2).
- **R5.** Doctor WARNs `export-marks-unchecked` and FAILs `export-marks-stalled` after 24 h on an escalating word
  (`wal-held`, `unlistable`, `failed`); `budget` and `off` never escalate (Tasks 1 and 2; as amended by the
  coordinator). The operator's ruling at plan approval: (the brief's R5 ruling, with its date).
- **R6.** A carried segment counts only when whole and this store's; WARN only, from a meta record the check writes;
  no rename, no `quick_check` (Task 3).
- **R7.** The re-arm on a vanished segment, with a compact listing record over every listed name (Task 4).
- **R8.** Replay marks by the last carrier, closing review 621 F3 (Task 5).
- **R9.** `expand` attaches variants to every answer that is not its bytes, in `--json` and the human form (Task 6).
- **R10.** `ENTRY_UPSERT`'s tie, both arms (Task 6).
- **R11.** The `store-unbound` remedy and the adopt's carry line gain the `history-off` hold (Task 7, D-5635).
- **R12.** The operator's restore question stays open: no code.

### Choices the tasks made

(every task's choice bullets, one line each, its task number first)

### Tests run (foreground, on the worker's box)

(Step 11's summary lines, as printed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then check the body and every added line. The second command prints a count, never a token:

```bash
grep -nE '[0-9]{1,3}(\.[0-9]{1,3}){3}|\.ts\.net|/home/' .superpowers/sdd/history-w5h1/pr-body.md || echo 'no host or home path'
LIST="$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names"
{ git diff -U0 origin/main...HEAD | grep '^+' | grep -v '^+++'; git log --format=%B origin/main..HEAD; cat .superpowers/sdd/history-w5h1/pr-body.md; } \
  | grep -c -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#')
```

Expected: `no host or home path`, then `0`. A non-zero count is judged by its line, never by printing the token. Re-run the pipeline with `grep -n -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#') | cut -d: -f1` to get line numbers only, read those lines, and rewrite each hit with a neutral stand-in before any push. Without `-w`, a short entry also matches inside ordinary words. The PR body stays under `.superpowers/` (gitignored) and is not committed.

---

## Deviations found

This plan's own departures, issued to it on 2026-10-19 and defined here in the plan's first commit. A worker defines any departure it finds while executing from its run's own block, in this section, in the commit that first cites it.

- **D-5632** — `history-export-bind-check-batched` (Task 1): NEW departure (no spec §16 row).
  - **The gap.** §9.15 "After a bind" has the first tick check every export mark against the segments on this box, and B4 shipped that check as one transaction over every lost mark, so its WAL grew with the store (review 621: 1.08 to 2.05 times the stored bytes; measured at e4936efab, 440.3 MiB at one commit for 406.3 MiB of 8 KiB blobs).
  - **Batches.** The check now runs in bounded batches that may span steps. Each batch is one NORMAL transaction that clears the referrers of its blobs before those blobs' own marks, so D-5395 and D-5396 hold at every commit. Batches page blob_id and then entry_id as keysets, with at most EXPORT_BIND_BYTES (16 MiB) of stored z and EXPORT_BIND_BATCH (50,000, moved into lib) rows each. After each batch the check sets PRAGMA busy_timeout = 0 and runs wal_checkpoint(TRUNCATE), and a busy answer is tolerated.
  - **Stops.** Before each batch, lib markCheckStop stops the check on history-off (`off`), on a WAL a reader holds past EXPORT_BIND_WAL_CEILING (64 MiB; `wal-held`) or on a spent run budget (`budget`). A stop, or a caught failure (`unlistable`, `failed`), is recorded in HEALTH_META.exportMarksCheck as '<word> <sinceMs> <cleared>' (the five words are lib's MARK_CHECK_WORDS); `sinceMs` is kept while the word stays within one class and restarts when it crosses between the escalating words (`wal-held`, `unlistable`, `failed`, lib's MARK_CHECK_STALL_WORDS) and `budget`/`off` (R5 as amended by the coordinator). The done stamp is written only after the last batch and deletes the record.
  - **A stale record.** A step on which decideMarkCheck answers that no check is owed deletes a standing record and the flag below, whichever of the two stands, in one transaction (since D-5636 only on a measured listing: an unlistable directory is never vanished, so it cannot show that no check is owed): after a rollback to B4 (which finishes a check in one transaction and never deletes the key) and a roll-forward, the key would otherwise stand for good and age into D-5633's FAIL.
  - **No cursor.** Each step recomputes the missing set and pages from the first row. HEALTH_META.exportSegmentMissing now accumulates per batch instead of being overwritten.
  - **The once-a-check flag.** export_segment_missing is bumped once per check, by its first clearing batch, behind the sweep-private meta key export_marks_counted (accepted by the coordinator), which the done stamp deletes, so a kill between batches neither loses the count nor doubles it (O39). Why a flag and not a running total bumped at the done stamp: measured (Task 1 Step 10's mutant 7), the running-total variant under-counts a check killed after its last batch (the counter reads undefined instead of 1), because the kill loses the in-memory total.
  - **Budget and floor.** The check charges the stored bytes it rewrites to the run's byte budget. Under the coordinator's rulings it stays outside db/'s free-space floor, as the export pass does (D-4762 stands), and the pass still runs while a check is unfinished.
  - **Measured** on the same 406.3 MiB: a WAL peak of 17.4 MiB at a commit, and 0 bytes after each of 26 checkpoints.
- **D-5633** — `history-export-bind-check-doctor` (Task 2): NEW departure (no spec §16 row).
  - **The gap.** §9.6 and §9.15 "After a bind" name no doctor rule for the check after a bind, and B4's residual left that rule owed ("doctor has no rule for it yet"). Since Task 1, the check runs in bounded batches over as many ticks as it needs. A check that stops short leaves marks that may name a segment that is not on this box, and the gap guard cannot see those rows.
  - **The WARN.** Doctor now WARNs `export-marks-unchecked` while the check's stop record stands (meta `export_marks_check`, `'<word> <sinceMs> <cleared>'`). The detail names the word it last stopped on, how long it has stopped on words of that class and the marks cleared so far, and the remedy is that word's own (every MARK_CHECK_WORDS member has its own, bound by a test), followed by one shared sentence: hold any `prune --apply` until the check finishes, because prune is not gated on the marks and a blob it tombstones while its mark names a segment not on this box whole keeps its bytes in no segment here. The detail stays distinct from `export-segment-missing`'s.
  - **The FAIL.** Doctor FAILs `export-marks-stalled` in place of the WARN when two things hold: the word is an escalating one, which no tick moves past by itself (`wal-held`, `unlistable`, `failed`), and the record's `sinceMs` is more than `EXPORT_MARKS_STALL_MS` ago (24 h, *chosen*). Doctor then turns red and `ccrc update` exits 3.
  - **`budget` and `off` never escalate** (coordinator rulings R4 and R5 as amended): an ingest backlog that long already FAILs `lag-high`, and the off switch holds back every other freshness FAIL (D-4314), so it holds this one too.
  - **The age.** It counts from `sinceMs`, which Task 1 restarts when the word crosses between the escalating class and `budget`/`off`, so a check starved for a day that then stops on `wal-held` is a fresh WARN. A `sinceMs` recorded in the future reads as 0 min and never FAILs.
  - **An unparseable record** is named unmeasured (`status-unreadable`), never read as "no check".
  - **Provisional.** The FAIL's class and threshold are provisional (R5), for the operator at plan approval.
- **D-5634** — `history-export-segment-whole-check` (Task 3): NEW departure (no spec §16 row).
  - **What the spec says.** §9.15 "After a bind" checks only that a segment a mark names is on this box.
  - **What B4 did.** Its check compared names only. A carried file under a marked name therefore counted as present, and its marks stood over text no segment on this box holds, when the file was cut short by a copy, was not SQLite at all, belonged to another store, or held another segment's bytes. A later `--restore` or `--rebuild` then stalls on it (D-4765 (`history-export-segment-unreadable-stalls`)).
  - **What the check does now.** A listed segment counts as present only when both hold:
    - it is whole: its length equals the page size times the page count its own SQLite header records, under a header SQLite trusts (store.mjs `segmentFileFacts`, lib `decideSegmentWhole`);
    - it is this store's: its meta names this store and the name it is listed under (lib `decideSegmentOwn`).
  - **A segment that fails either test** is treated as missing. For live rows this is the over-clear direction: its marks clear, with their referrers, through the batched check, and its rows export again. Text the store pruned and only that file held cannot be exported again (a re-export carries its stub), so that text is already lost to the damage; the WARN's remedy asks for a whole copy back first (coordinator ruling on review finding 2026-10-19). It is counted `export_segment_damaged` once per name and recorded in meta `export_segment_damaged`. Doctor's WARN `export-segment-damaged` reads that record; status never reads or opens a segment. The check never renames, removes or writes anything under `export/`.
  - **Not covered.** Damage inside a file of the right length is not caught. `quick_check` stays out of the tick: it measured 102 ms for 239 MiB warm, and its cost grows with the whole export. Replay remains where that damage is found. Coordinator ruling R6.
- **D-5635** — `history-export-adopt-carry-remedy` (Task 7): NEW departure (no spec §16 row).
  - **What RB11 left.** B2's ruling RB11 had the adopt print its carry line after the bind and kept the `HEALTH_REMEDIES` text unchanged. Spec §8.4 said that "the remedy line" asked for the carry before the verb, but it never did. So the adopt's own instruction is a carry after the bind.
  - **Why that costs.** A carry after the bind races the first tick after it. That tick clears the export mark of every segment not yet on the box whole, so every row those segments held is exported again onto the home filesystem, with the check's WAL cost in `db/`.
  - **What changes.** The `store-unbound` remedy, which the operator reads before the verb, now says to copy `journal/<store_id>/` and `export/<store_id>/` here before the adopt, or to touch `~/.ccrc/history-off` before the adopt and remove it only once both copies are complete and match their source. The adopt's carry line gains the same hold for a copy made after it. lib's `carryHoldAdvice` is the one text both say, with `SWITCHES.off` its only switch spelling (O13), and `adoptCarryAdvice` names the two directories.
  - **What it reverses.** This reverses RB11's "HEALTH_REMEDIES text is unchanged" (coordinator ruling R11). Spec §8.4's "Carry before the verb" is corrected in place (Task 7's spec step).
  - **What stays.** No code path changes: `scheduledPass` already ends before it opens the store under history-off, while the binding verbs still run. Since D-5632 a second guard holds the same tick: the check's own `off` stop, before its first batch. A new history-export case pins that premise, and asserts that no stop record stands after the tick under history-off; its mutant, a scheduled pass that runs under history-off, reds it (measured at e4936efab, on the marks; on this PR's tree, with Task 1's stop in place, it reds on the stop record, which Task 7 Step 5 measures).
- **D-5636** — `history-export-vanished-rearm` (Task 4): NEW departure (no spec §16 row).
  - **What it departs from.** §9.15 "After a bind" runs the mark check only for a bind fact. So a segment moved aside or deleted after the first tick kept its marks. The rows and blobs only that segment held, a pruned blob's bytes included (D-5396), were never exported again, and doctor said nothing until a later rebuild found them gone (the ledger's "Owed from B4" item 7b, review 624's advice). B4 Task 8 pinned that behaviour ("the segment goes, with no bind since the check: no check runs, and the marks stay").
  - **What changes.**
    - The check now also re-arms when the segment names listed in `export/<store_id>/`, every listed name with damaged ones included, differ from a compact record, meta `export_marks_checked_listing`. The listing judges no file (Task 3's check does that when it runs), so moving a damaged file out of `export/<store_id>/` re-arms the check and empties Task 3's damaged record (the coordinator's reconciliation of Tasks 3 and 4).
    - The record is `<count> <digest>`. The digest is the XOR of the first 16 sha256 bytes of each name, so it is order-independent and additive. The record never holds the names (coordinator ruling R7).
    - The check's done stamp writes the listing measured at the start of its step. Each pass adds its own segment in its mark transaction, and never re-measures the directory. So a segment gone before a pass still re-arms the next step.
  - **Limits.**
    - The record cannot tell a segment gone from one carried in, so a carry re-arms one check, and that check clears nothing. Re-arming only when the count fell would miss a loss behind a carry of the same count.
    - A directory that cannot be listed (ENOTDIR, EACCES) never re-arms the check, and never deletes a stop record a check left standing: an unmeasured listing is not "no check owed", so Task 1's stale-record delete runs only on a measured listing.
    - A store whose segments predate the record checks once.
    - A crash between link and marks costs one check that clears nothing.
    - A damaged file left in place re-arms nothing after the check that recorded it.
  - **Cost.** One readdir per tick; no header read and no open.
  - **Not covered.** A later segment no mark names, lost after a rebuild (item 6). A segment damaged in place after the last check, under the same name: its marks stand until the next bind or listing change, and replay finds it (D-4765).
  - **Decided in lib.** lib decides whether the listing differs and whether a step checks (`segmentListingVanished`, `decideMarkCheck`'s new `vanished` input; RD2). A re-armed check is Task 1's bounded check (R1).
- **D-5637** — `history-export-replay-last-carrier` (Task 5): NEW departure (no spec §16 row).
  - **What the spec says.** §9.14 (rev 3.6) says replayed blobs and rows are marked with "the first segment that carries them" (amended in place by Task 7's spec step). B4 kept that first-wins convention through review 614's fix round: the coordinator's ask-58 amendment, and D-5396's "an exported blob still licenses the first segment that carries the row".
  - **The loss.** First-wins loses a row that only a later segment holds:
    - a late variant over bytes another entry exported;
    - a late-linked sidecar;
    - D-5399's unlinked rows.
  - **Review 621 F3.** After a rebuild, every mark that covers such a row names an earlier segment. Once the later segment is lost, the check after a bind clears nothing, no pass writes the row again, and a second rebuild drops it. It was measured again here on F6's real verbs in both journal arms: all six greps scoped to the unlinked row miss it, with exit 3.
  - **The change.** Replay now marks by the LAST carrier, in (seq, writer) order. lib's `segmentOrdersAfter` makes that call, using one comparator shared with `orderSegmentNames`.
    - A blob's mark moves to a segment that carries its bytes and orders after the mark.
    - An entry row moves the entry's mark to its segment when that segment orders after the mark and lib's `segmentMayMarkEntry` (unchanged) says it may.
    - When the entry row may not take the mark, it takes the older mark off, so the next pass writes the entry with everything it needs. That over-clears and never loses a row.
    - A segment that does not order after the mark moves nothing: the same segment replayed again, or a restore's backup marked by a later segment.
  - **Why it is sound.** Every export of an entry writes everything the store held of it at the time: every variant, its boundary, every linked sidecar and every membership. Every carried blob carries every unlinked row that names it, and nothing in `ccd/history` deletes or updates those rows. So a later carrier holds everything an earlier one did. The one exception is two writers at the same seq, which happens when a directory is carried in from another box. The take-off arm covers that case.
  - **Cost.**
    - No schema change, no meta key, no extra export bytes and no extra segments.
    - Replay reads a carried blob's mark once when its insert was ignored.
    - Replay asks a later carrier whether it holds an entry's pruned, unmarked blobs. The F1c lookup pin goes from 1 to 3.
    - It also removes D-5396's accepted extra export per rebuild in the exporter's own shape: the F1c end-to-end case no longer needs a third export or a third rebuild.
  - **Tests.** Eight existing cases that pinned first-wins are re-expected, each with its reason: three D-5396 cases and three D-5397 cases in history-recover, and the D-5396 F1c and D-5397 end-to-end cases in history-export.
  - **Residual, unchanged and unmeasured.** It holds under either convention. On a restore, an entry that the backup holds unmarked because of a late variant over an already-exported blob can be marked by a replayed segment that lacks that variant row, because D-5395 gates on blob states only.
- **D-5638** — `history-ingest-live-beats-exported-tie` (Task 6): NEW departure (no spec §16 row).
  - **What the spec says.** §6.1 says structure fields come from the newest copy, "ties broken by the larger `file_id`". §9.2 step 5 writes that rule as ENTRY_UPSERT's `WHERE excluded.struct_rank_ns > entries.struct_rank_ns OR (= AND excluded.struct_file_id > entries.struct_file_id)` (RV15). §9.14's export replay sends entries "by the newest-rank rule (§9.2)" through the same inserts as ingest. Task 7's spec step amends all three in place.
  - **The defect.** On a restore, that rule moved an entry's structure off the live file the backup held and onto the `exported:` dead-file row that replay had just made. That row is new, so its `file_id` is always the larger, and the segment carries the store's own rank, so the two copies tie (review 614 F7; measured: `struct_file_id` on the `exported:` row, status `exported`). No read verb reads `struct_file_id`, but the export writer does. Until a copy with a strictly newer rank arrived, the entry's next export wrote the `exported:` key as its struct path, and replay's first-file fallback for a variant inherited it.
  - **The change.** The tie arm is now bound by `?21`. Replay binds 0, so a replayed copy never wins a tie, and a replay-versus-replay tie keeps the first segment's structure. Ingest binds 1: at an equal rank, a live copy wins by the larger `file_id` as before, and it also wins over any holder whose `ingest_files.status` is `exported`, whatever the ids. That brings back an entry a replay took at a strictly newer rank once the live file is read at that rank. Both arms follow coordinator ruling R10. A strictly newer rank wins from either caller, as before.
  - **Cost.** The subquery runs only on an equal rank and is a primary-key lookup. Ingest's hot path is otherwise unchanged (history-ingest stays green, O20 included). No schema change and no meta key.
- **D-5639** — `history-export-bind-check-wal-first` (Task 1): found while executing (run 626's pre-flight).
  - **The gap.** The plan's batched check measured the WAL only after each batch's checkpoint and began every step at 0. So while a reader held its snapshot across ticks, each step wrote one more batch into a WAL that no checkpoint could truncate. The ceiling then bounded one step, not the check, against R1 ("once its WAL passes EXPORT_BIND_WAL_CEILING, the check stops with the word wal-held").
  - **The change.** The check runs the same busy-tolerant TRUNCATE checkpoint (busy_timeout 0) once before the first batch of every step that owes a check. A step that starts behind a held WAL past the ceiling therefore stops `wal-held` without writing a batch, and the record keeps its `sinceMs` and its cleared count.
  - **Cost.** One extra checkpoint per check step.
  - **Pinned** by the reader case's second step, run with the reader still open, and by a mutant that deletes the pre-batch measurement. The checkpoint-count case counts one per batch plus one.
- **D-5640** — `history-export-bind-check-doctor-off-holds` (Task 2): found while executing (run 626's pre-flight).
  - **The gap.** The plan's stalled arm read only the record's word and age. No scheduled pass runs under `~/.ccrc/history-off`, so nothing rewrites or deletes a record that stood on an escalating word (`wal-held`, `unlistable`, `failed`) when the switch was set. It kept ageing, and after EXPORT_MARKS_STALL_MS doctor FAILed `export-marks-stalled` and the update exited 3. That is against R5's own reason ("`off` holds back every other freshness FAIL (D-4314)") and Task 2's Choice that a node kept off for days stays a WARN.
  - **The change.** `markCheckArm` answers `unchecked`, never `stalled`, while `historyOff` stands, so the switch holds this FAIL back as it holds every freshness FAIL. The WARN stays, beside deriveHealth's own `off` WARN, which names the switch.
  - **Cost.** Once the switch is removed, a record that aged past the stall threshold under it FAILs at the next doctor run unless a tick finishes the check first. Its `sinceMs` is not reset by the switch.
  - **Pinned** by a pure case (a `failed` record past the stall threshold with history-off set is a WARN with no FAIL) and by a mutant that drops the switch's guard.
