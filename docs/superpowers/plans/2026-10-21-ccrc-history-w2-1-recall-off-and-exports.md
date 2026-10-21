# ccrc history wave W2-1: recall-off, the presence record and the deploy lane's exports, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship W2's fleet half of the replay eval in ONE PR on `main`, on the fleet lane after wave 5h-2 (#1010), W2-3 (#856) and W2-4 (#826) merged. The deploy lane (W2-5a onward) builds on three things this PR gives it: a `recall-off` verb that writes exactly the family the census assigned, a per-tick record of when each `recall-off` file appeared, changed or went, and the store reads the driver will call. Task by task:
- **Task 1 (W2-D33).** The exports the deploy lane reads, as a pure refactor: `stampAtOrBefore` **moves** from derive.mjs into lib.mjs, takes plain `(rows, index)`, and is declared in `lib.d.mts`; derive.mjs exports `bodyOf` and `keptOf` and a new `blobReadStmts(db)` that `stmts(db)` spreads, so each blob SELECT is spelled once; recall.mjs splits `expandEntryBody(rc, e)` out of `expandEntryText`, which reads through it and answers byte for byte as before; cli.mjs exports `pairIndexOf` in place. The body pick answers five state words where W2-D33 listed four (D-6238; R1).
- **Task 2 (W2-D17, W2-D23, W2-D29's first bullet, W2-D30's constants, W2-D12).** The shared names: `historyPaths(home)` gains `recallOffDir` and `headlessOn`, and `recallOffPath` builds on `recallOffDir`; lib declares `RECALL_OFF_META = 'recall_off:'`, `RECALL_OFF_GAP_MS = 600000` and `RECALL_OFF_SCAN_MAX = 4096`, each bound in O14's `VOCABS`; `isSyntheticModel` is extracted from `backendOf`. `deploy/history-gate.mjs` imports `isSyntheticModel` and `RECALL_OFF_META` in place of W2-3's two temporary local spellings, `deploy/measure-history.py` spells the prefix once (a Python twin of lib's, pinned equal) and emits the raw rows as `w2.recall_off`, and a pin holds `SCHEMA_VERSION` at 2 (W2-D10).
- **Task 3 (W2-D26, W2-D27, W2-D28, the rest of W2-D29, W2-D9's W2-1 half).** The verb, end to end through the shim: `recall-off <id> [--generation <uuid>] [--clear]` and `recall-off --clear-all` write as invoked (D-5763); under the lock and before any write, the write form checks `$REG/<id>.generation` by W2-D27's table and refuses exit 2 `generation-malformed` or `generation-mismatch` (D-5764). `sweep.mjs`'s `recallOffPass` is the one writer (0700 directory, 0600 file through `recall-off/~tmp.<pid>` opened `O_CREAT|O_EXCL|O_NOFOLLOW`, then a rename; links never followed; `--clear-all` counts what it cleared and names every skipped entry), and every content reader moves onto `readBounded` at `CONTROL_FILE_MAX`, the drain's and the CLI's through the exported `recallOffPresence` (R3). The CLI relays it like `import`, `prune` and `reparse`; O13's last case becomes "exactly one writer, sweep.mjs"; `shared/lifecycle.ts` declares `history-recall-off` and `'W2-1'` joins `HISTORY_LANDED`; README states the verb. The pass touches no store (D-6239; R3).
- **Task 4 (W2-D30, W2-D31).** The presence record: a new tick step, `recordRecallOff`, immediately before `recordTick` on the normal pass only, reads `recall-off/` (counted, bounded by `RECALL_OFF_SCAN_MAX`, each id's file through `readBounded` itself) and keeps `state:<id>`, `seen_ms`, `change:<ts_ms>:<id>` and `gap:<ts_ms>` meta rows under `RECALL_OFF_KEYS`; each change and gap row is a `recall-off` journal record inserted through `journal_outbox` in its own transaction and flushed after it; replay rebuilds the rows without reading the directory. `status --json` gains `recall_off: {seen_ms, files, unreadable}` and one human line. `seen_ms` survives a restore or an adopt (D-6240; R4).
- **Task 5 (W2-D32).** Tests only: RP8 end to end (the verb writes G1; a purge and a reuse give G2; the read verb exits 0, the hook serves the card line, the drain counts `recall_off_stale` once, and W2-3's pipeline counts no G2 line in G1's window, with a CONTROL that drops the generation filter), RP10's card half (its verb half is Task 3's; R5), and C66, C67 and C68 re-run over verb-written files.
- **Task 6 (W2-D3; decisions §6).** The spec errata W2-1 carries for itself, W2-3 and W2-4 (E1, E3, E4, E5, E6, E12, E13, E14, E15, E16, E17, E18, E26) and three added errata with no number (§9.4's two "Lands in" cells, §8.8's `recall-off` generation row, §9.14's journal kinds; R6), each amended in place inside its own line(s); the whole-PR checks; the PR body; the PR.

Sessions see no change in behaviour: the hook, `ccd`, `ccd/ccd-history-sweep` and the wire are untouched, and a `recall-off` file is read exactly as B2 and B3 read it, now through one reader. The rollout is part of W2's final release (W2-D6), the operator's, never the worker's.

**Architecture:** Fleet-side `ccd/history/*`, one L0 row, and the deploy lane's two read-only consumers of lib (the gate's imports and the census's raw rows). Ring membership is a property of a file's imports.

*L1 `ccd/history/lib.mjs`* (imports `node:crypto` only) decides:
- `stampAtOrBefore(rows, index)`, beside `eofAfterBoundary` (Task 1);
- `historyPaths`' `recallOffDir` and `headlessOn`, `recallOffPath`, `isSyntheticModel` (which `backendOf` calls), and the three presence constants beside `RECALL_OFF_DIR` (Task 2);
- `parseOpVerbArgs`' `recall-off` case, `decideRecallOffWrite` (W2-D27's table, replacing B2's `decideRecallOffPreflight`) and the two exit-2 `REASONS` words in `REASON_ROWS` (Task 3);
- the `recall-off` journal kind's grammar and replay step, `RECALL_OFF_KEYS`, `recallOffStateOf`, `planRecallOffObservation`, `recallOffReplayRows` and `recallOffStatusOf` (Task 4).

*L3 `ccd/history/store.mjs`* stays `node:sqlite`'s sole importer and is not edited: `readBounded`, `withTx`, `getMeta` and `setMeta` are consumed as they are, and `insertBindFacts` stays private (Task 4 flushes as `verdictTx` does instead).

*L4* measures and acts on lib's answers, deciding nothing:
- `ccd/history/sweep.mjs`: `recallOffPresence` (exported, on `readBounded`: the drain's and the CLI's reader), `OP_VERBS` and `opPass`'s `recall-off` arm, `recallOffPass` (the one writer) (Task 3); `recordRecallOff`, its scan (on `readBounded` itself), tick docstring item 19 and `applyReplayAction`'s `recall-off` case (Task 4);
- `ccd/history/cli.mjs`: `pairIndexOf` exported (Task 1); `recall-off` relayed through `OP_OF_VERB`, `runOpVerb` and `opRelay`, B2's `recallOffVerb` deleted, `readContextIn` reading through `recallOffPresence` (Task 3); the status envelope's `recall_off` block and line (Task 4);
- `ccd/history/derive.mjs` and `ccd/history/recall.mjs`: the exports and the split (Task 1).

*Deploy, pure:* `deploy/history-gate.mjs` changes only its lib import line and the two temporary definitions it retires (Task 2). `deploy/measure-history.py` stays a raw-row instrument that decides nothing (W2-D13): one constant, one read, one report key (Task 2).

*L0 `shared/lifecycle.ts`* imports nothing; Task 3 adds the `history-recall-off` row as string data.

No schema migration (the store stays v2), no new table, column or index, and `JOURNAL_V` stays 1: the presence record is meta rows in the existing `meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)` table, and a `recall-off` journal record is a new kind an older build answers `'unknown'`, skips and counts.

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`): `node:sqlite` through `store.mjs` only; `node:fs` `opendirSync` with a counted iteration, `lstatSync`, `openSync` with `O_CREAT|O_EXCL|O_NOFOLLOW`, `renameSync`, `fchmodSync`, `mkdirSync` and a directory fsync through the existing `fsyncDir`;
- Python 3's `sqlite3` over the existing read-only URI in `deploy/measure-history.py`, with `substr` prefix matching (never `LIKE` or `GLOB`);
- vitest in `server/`, in-process and through the placed shim with fixture HOMEs (`historyHelpers.ts`); Task 5 also spawns `deploy/measure-history.py` and `ccd/session-hook.sh` from `history-recall.test.ts`, and imports the gate dynamically.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6, amended in place, no rev bump. Only Task 6 edits it, in one commit, one replacement per erratum part, adding or removing no line. Line numbers are hints measured at `02d75ae5f`; the decisions document's were measured at `bd363a76b` and have all moved. The sections amended:
- §8.3's exit table, the exit-2 row (about :1671): E1, `generation-malformed` and `generation-mismatch` (D-5764). E2's words are W2-5b's, later, in the same row;
- §8.4's `status` durability bullet (about :1737): E5, the `recall_off` block (no number);
- §8.4's "Dry run by default." (about :1742): E3, names `import`, `prune` and `reparse`; the `doctor` flags and `recall-off`'s three forms write as invoked (D-5763). The relay bullet below it is 5h-2's (D-5747) and is not touched;
- §8.4's two `recall-off` bullets (about :1799-1800): E4, the grammar, the generation checks, the writer's temp and `--clear-all`'s `skipped` (D-5763, D-5764);
- §8.8's failure table, the `recall-off` generation row (about :1922): an added erratum under E4, `generation-malformed` and `generation-mismatch` (D-5764; R6);
- §9.4's `history-recall-off` row (about :2170): E6, the writer's temp (no number), and its "Lands in" cell, `W2-1`; and the `history-replay-out` row's "Lands in" cell (about :2172), `W2-4`: an added erratum, no number (R6). The `history-store-id` row (about :2163) is 5h-2's (D-5748) and is checked, never written;
- §9.14 "What it holds", the `tick` bullet (about :2503): the `recall-off` journal kind, an added erratum, no number (R6);
- §9.11's O32 row (about :2446) and O52 row (about :2466): E13 (D-5772) and E14 (D-5770);
- §10.2 "The instruments" (about :2634, :2636), "Questions" (about :2650), the spawn flag list (about :2684), "Account and budget" (about :2709), "The live A/B" (about :2739, :2744) and "The queries" (about :2746, :2749): E12 (D-5770, D-5771; it names `w2.recall_off`, R2), E13, E17 (D-5775), E26, E18, E16 (D-5773);
- §10.7's W2 row, its data-source cell (about :2907): E14 (D-5770);
- §13's single-definition bullet (about :3063): E15 (D-5774).

No §16 row and no §17 line: 5h-1 and 5h-2 added none, and Task 6 Step 4 measures §17.

**Authority:** `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md` (the W2 decisions document): section 2's "W2-1 (fleet)" entry, section 3's decisions named in the Decisions table below, section 6's errata, section 7's residuals and its D-numbers. Then the spec, then the merged code at the base. The decisions document was written at `bd363a76b`, before 5h-1 (#737), W2-3 (#856), W2-4 (#826) and 5h-2 (#1010) merged: every line it cites is a hint, and "Drifts since the decisions document" below lists what moved and what that changes. Before editing a function in place, re-read the merged code at the base: a plan text is never ground truth.

**Ledger:** `docs/superpowers/programs/ccrc-history.md`, the W2-1 row ("after 5h-2 (the fleet lane runs one PR at a time)"), "Decisions & deviations" (the W2 block of 19 numbers, of which D-5763 and D-5764 are W2-1's to define) and "Carried constraints". The ledger is the coordinator's file; no task edits it.

**Base:** `main` at `02d75ae5f`, #1010's merge (wave 5h-2), which holds 5h-1 (#737, `3af16cf97`, including its Task 6's variant read in `expandEntryText`), W2-3 (#856, `36d0a92c1`) and W2-4 (#826, `780c8126c`), every PR W2-1 waits for (W2-D2). Task 1's Step 0 runs `git merge-base --is-ancestor 02d75ae5f HEAD` and stops before any edit if it fails. No deploy worker runs while W2-1 runs (W2-D3): W2-3 and W2-4 have merged, and W2-5a waits for W2-1.

**PR:** see the PR paragraph at the end of this header.

## Global Constraints

- **One PR, fleet lane.** Six commits, one per task, in task order; the fleet lane runs one worker at a time (W2-D2), and W2-1 dispatches only when no running worker claims any of its paths (W2-D3).
- **Schema v2, no migration (W2-D10).** No table, column, index, `SCHEMA_ADDED` entry or migration; `SCHEMA_VERSION` stays 2, and Task 2 pins it with W2-D10 in the case title. `JOURNAL_V` stays 1. The presence record is meta rows under `RECALL_OFF_META`.
- **No new file.** No new test file (W2-D5: W2-4's `history-replay.test.ts` is W2's only one), no new source file, no `.d.mts` for derive.mjs, recall.mjs or cli.mjs, so `ci.yml`'s node-floor heredoc is unchanged. A worker who finds a new file unavoidable stops and reports to the coordinator first.
- **Never touched by this PR:** `deploy/history-replay.mjs`, `server/test/history-replay.test.ts`, `.github/workflows/*` (W2-1's own list), and also `ccd/session-hook.sh`, `ccd/ccd`, `ccd/ccrc`, `ccd/ccd-history-sweep`, `ccd/ccrc-doctor-checks`, `ccd/history/store.mjs`, `ccd/history/card.mjs`, `CLAUDE.md`, the programme ledger, `history-maint.test.ts`, `history-derive.test.ts`, `history-card.test.ts`, `history-drain.test.ts` and `session-hook.test.ts`. Two mutant blocks edit files on this list, or files their own task does not commit, in place in the working tree, one mutant at a time: Task 3's Step 13 appends to `ccd/ccd-history-sweep` (M20), and Task 5's Step 5 mutates `measure-history.py`, `sweep.mjs`, `lib.mjs` and `session-hook.sh`. Each block first copies every file it mutates under `.superpowers/sdd/history-w2-1/scratch`, restores each from that copy byte for byte after its run (checked with `cmp`), and commits none of it.
- **The spec path (W2-D3).** Only 5h-1, 5h-2, W2-1, W2-5b and W2-6 ever claim it, never two running workers at once; W2-1 holds it only while it runs, and only Task 6 writes it. W2-5b's errata (E2, E7, E8, E9, E10, E11, E19, E20, E21, E22, E23, E24) and W2-6's (E25) are left standing, and Task 6's script asserts each old sentence is unchanged.
- **Rings by imports.** `lib.mjs` imports only `node:crypto` and decides; `store.mjs` is L3 and is not edited; `sweep.mjs`, `cli.mjs`, `derive.mjs` and `recall.mjs` measure and act; `shared/lifecycle.ts` imports nothing; `deploy/history-gate.mjs` imports lib alone (W2-D11).
- **Entry guards.** `sweep.mjs` and `cli.mjs` end in `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {` (cli.mjs about :1695 at `02d75ae5f`). Every new block goes above it, with no top-level await. Importing cli.mjs runs `process.umask(0o077)` (about :69) in the importing process; Task 1's import pin runs in a child process for that reason.
- **Single definition.** `stampAtOrBefore`, `isSyntheticModel`, `RECALL_OFF_META`, `RECALL_OFF_GAP_MS`, `RECALL_OFF_SCAN_MAX` and `RECALL_OFF_KEYS` are each declared once, in lib.mjs, and declared once in `lib.d.mts` (count them: `skipLibCheck` hides a duplicate). The four constants join O14's `VOCABS`; `RECALL_OFF_META` also joins H-149's "quoted once" scan. The two blob SELECTs are spelled once, in `blobReadStmts`. The angle-bracket model test sits on one code line of the `ccd/history`, `deploy` and `shared` `.mjs` corpus. `recall-off/<id>` has exactly one writer, `sweep.mjs`'s `recallOffPass`, and every content reader reads it through `store.mjs`'s `readBounded(recallOffPath(...), CONTROL_FILE_MAX, false)` (W2-D29): `recallOffPresence` for the drain and the CLI (Task 3), and the tick's scan (Task 4).
- **No overloaded null.** `expandEntryBody` answers five state words, never folding `undecodable` into `tombstone` or `unparseable`; `recallOffStateOf` reads unreadable and over-cap as `{s: 'unreadable', v: null}`, never absent; `parseJournalRecord` answers `unknown` for a newer `rk` and `malformed` for any other breach; status's `recall_off` is `{seen_ms: null, files: 0, unreadable: 0}` when no store was read, and `seen_ms: null` before the first complete observation. `bodyOf`'s one null over three conditions is unchanged from the base and named as a residual.
- **Refusals before writes.** Every `recall-off` refusal (`bad-args`, `bad-id`, `generation-unreadable`, `generation-malformed`, `generation-mismatch`, an unusable directory) answers before the `mkdir`, the stale-temp removal or any write; the writer follows no link.
- **Seams.** Test seams are `ctx.deps` members or function parameters. No new env var, flag or file arms one; the `process.env` allow-list stays `HOME`, `TMUX_PANE`, `CLAUDECODE` and `CCRC_SESSION_GENERATION`.
- **FIXTURE HOMEs only.** Tests use `historyHelpers.ts` (`makeHistoryBox`, `runShim`, `runCli`, `runSweep`, `withPane`, `seedFamily`, `plantSession`), with `tmux`, `claude`, `gh`, `ssh`, `curl` and the managers poisoned. No step runs `ccd`, `ccrc`, the shim, `sweep.mjs`, `cli.mjs` or any history verb against the live `$HOME`, and no step reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or any account home. Spawning describes skip on darwin as their files already do; lib, lifecycle and single-definition cases run there.
- **Running tests.** From `server/`, `./node_modules/.bin/vitest run test/<file>.test.ts -t '<regex>'`, in the foreground, timeout at least 600000 ms, one suite per tool call, never bare `npx vitest`. Each `-t` filter is regex-safe and selects at least one test; a run that reports only skipped tests selected nothing and is not green. CLAUDE.md's load flakes are re-run alone before a red is called a break.
- **Red-first.** Every new guard is watched red on the unguarded code (the prediction written before the run), then each mutant in its task's list is measured red, then green again. A red at a CONTROL is the fixture's to fix, never the guard's to weaken. Scratch goes under `.superpowers/sdd/history-w2-1/` (gitignored), never `git stash`.
- **Never on timing.** No assertion reads a duration. Task 5's window spans the G2 call by a transcript row stamped `Date.now() + 86400000`, and the case asserts the span.
- **Citation corpus.** `single-definition.test.ts` is cited by line by `session-hook.test.ts`'s citation audit: new describes are appended at the end, in-place edits keep their line counts or sit below the audit's anchors, and the CITATION DEBT case runs after each edit of that file. `citations.test.ts` refuses an added numeric line citation in code or tests (D-5893). `growth-check.test.ts` (armed 2026-10-21, D-6178) lists no file this PR edits.
- **Fixtures.** Key-shaped fixtures are assembled at runtime from parts, never written whole, in tests and plan text alike. Fixture paths are synthetic, in the `/home/u/tree` style; fixture ids follow ccd's grammar with neutral words.
- **Node floor.** `>=22.16.0`, identical in `server/`, `agent/` and `pwa/`'s `engines`; no task changes it.
- **Public repo.** No host, user, account, wrapper, lane, pool, session or person name, no private project name, no IP address, no absolute home path, no private ticket id and no docserver URL, in plan text, fixtures, comments, commits or the PR body. Task 6 Step 10 runs the private-name count over every added line, every commit message and the PR body; it must print 0.
- **D-numbers.**
  - This plan defines exactly six issued numbers, once each, in "Deviations found" at its end, in the em-dash form: **D-5763** and **D-5764** (Task 3; W2-D26, W2-D27; decisions §6's "Defined in"), and the three departures found while planning, **D-6238** (Task 1), **D-6239** (Task 3) and **D-6240** (Task 4), ruled by R1, R3 and R4, and **D-6241** (Task 3), issued to the execution run and defined in the commit that first cites it. The first five entries come with the plan, so they are on the base when the worker starts: a task cites the numbers its own text names, checks that each entry is there once, and never adds a second definition. A task edits its own entry only to correct a figure its own measurement changed.
  - Earlier numbers are cited bare and never defined here, among them D-4170, D-4232, D-4596, D-4690, D-5747, D-5748, D-5770, D-5771, D-5772, D-5773, D-5774, D-5775, D-5893, D-6069 and D-6178.
  - Never write a number that was not issued, and never write a range: cite each number on its own. `dtbd.test.ts` reds any concrete `D-TBD-` token in a tracked file.
  - A departure the worker finds while executing takes the next unused number from the run's block named in the brief, defined in "Deviations found" in the commit that first cites it; otherwise it is reported, never invented.
  - Before the PR: `git fetch origin main`, then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.
- **Peers.** Before each first edit of an existing file, read `GET /api/claims?project=ccrc-pwa`. Hot paths: `ccd/history/*.mjs`, the history tests, `single-definition.test.ts`, `measure-history.test.ts`, `lifecycle.test.ts`, `shared/lifecycle.ts` and the spec. Whichever PR lands second merges `main` (never a rebase) and keeps both sides.

## Decisions

| # | Decision | Status | Task(s) |
|---|---|---|---|
| W2-D3 | **Claims and the spec path.** W2-1 holds the spec only while it runs and amends W2-1's, W2-3's and W2-4's errata in place; the history-store-id row's 86 B correction stays 5h-2's. | coordinator ruling (W2 decisions document, as amended) | 6 |
| W2-D9 | **Lifecycle keys, W2-1's half.** `'W2-1'` joins `HISTORY_LANDED`; `history-recall-off` is declared, its row naming the writer's temp `recall-off/~tmp.<pid>`. The `'W2-1'` key itself is W2-4's split, already on `main`. | coordinator ruling (W2 decisions document) | 3 |
| W2-D10 | **No schema change.** Meta rows only; `SCHEMA_VERSION` pinned at 2 with W2-D10 in the case title. | coordinator ruling (W2 decisions document) | 2 (pin), all |
| W2-D11 | **The gate imports lib alone.** Its pinned import line gains the two names; no other import. | coordinator ruling (W2 decisions document) | 2 |
| W2-D12 | **Vocabularies.** `REASONS` gains only `generation-malformed` and `generation-mismatch`; `RECALL_OFF_META` joins O14's `VOCABS`, and by R2 so do `RECALL_OFF_GAP_MS` and `RECALL_OFF_SCAN_MAX` (Task 2) and `RECALL_OFF_KEYS` (Task 4). D-5774 cited bare. | coordinator ruling (W2 decisions document) | 2, 3, 4 |
| W2-D13, W2-D14, W2-D15, W2-D16 | **The census's raw rows, the window in Node, the copy rules, O32 narrowed.** Implemented by W2-3; W2-1 states them in errata E12, E13 and E14, emits the `recall_off:` raw rows, and Task 5's RP8 runs the merged window rule. | coordinator ruling (W2 decisions document) | 2, 5, 6 |
| W2-D17 | **`isSyntheticModel`.** Extracted into lib, `backendOf` calls it, the gate imports it, a pin names lib its sole definer. Null-model rows stay turns. | coordinator ruling (W2 decisions document) | 2 |
| W2-D20 | **Families active at W2 open, W2-1's part.** The verb accepts `--generation` on the write form and refuses a generation that is not the id's; `marker --section ab` is W2-5b's. | coordinator ruling (W2 decisions document) | 3 |
| W2-D23 | **Changed families.** lib's `RECALL_OFF_META`, the gate rewired to it, the Python twin pin, and `measure-history.py`'s raw rows, so the reader ships with its writer. | coordinator ruling (W2 decisions document) | 2, 4 (the rows' contract) |
| W2-D26 | **No dry run.** `recall-off`'s three forms write as invoked (D-5763; E3). | coordinator ruling (W2 decisions document) | 3, 6 |
| W2-D27 | **The generation checks.** W2-D27's table under the lock, before any write; `--generation` a lowercase UUID on the write form only (D-5764; E1, E4). | coordinator ruling (W2 decisions document) | 3, 6 |
| W2-D28 | **Writer mechanics.** 0700 directory, no link followed, 0600 write through `recall-off/~tmp.<pid>` (`O_CREAT|O_EXCL|O_NOFOLLOW`) and a rename, stale temps removed at start, `--clear` and `--clear-all` as ruled; `history-off` refuses, recovery exempt (RB12), role gate and `CLAUDECODE` bump apply (E4, E6). The pass touches no store (D-6239). | coordinator ruling (W2 decisions document) | 3, 6 |
| W2-D29 | **O13 for recall-off, and `historyPaths`.** `recallOffDir` and `headlessOn` (Task 2); every content reader on `readBounded` (R3), O13's one-writer case with its CONTROLs, the writer shape and the KNOWN WIDTH comment (Task 3); the scan's reads (Task 4). | coordinator ruling (W2 decisions document) | 2, 3, 4 |
| W2-D30 | **The presence record.** Constants (Task 2); the tick step, its rows, its journal kind and replay, and the seven pins (Task 4). `seen_ms` after a restore or adopt departs from its text (D-6240). | coordinator ruling (W2 decisions document) | 2, 4 |
| W2-D31 | **`status --json`'s `recall_off`.** Additive and identity-free, with one human line; `seen_ms` after a write and a tick is greater than the write time (E5). | coordinator ruling (W2 decisions document) | 4, 6 |
| W2-D32 | **RP8 end to end.** One `it` in a poisoned-gh fixture HOME through W2-3's pipeline, with the generation-filter CONTROL. | coordinator ruling (W2 decisions document) | 5 |
| W2-D33 | **Exports for the deploy lane.** `pairIndexOf`, `bodyOf`, `keptOf`, `blobReadStmts`, the body pick, and `stampAtOrBefore` moved into lib; the `keptOf` scan is W2-5a's. The body pick's five words depart from its text (D-6238). | coordinator ruling (W2 decisions document) | 1 |
| W2-D55, W2-D57, W2-D60 | **The limits stop and budget, step 0's `--verbose`, fact kinds.** Implemented by W2-4 and W2-3; W2-1 states them in errata E18, E26 and E17. | coordinator ruling (W2 decisions document) | 6 |
| R1 | **Task 1's exports.** `expandEntryBody` takes `rc` (`{db, version, schema}`), not expand's statement set, and answers five state words (D-6238). No new `.d.mts`: only `stampAtOrBefore` is declared in `lib.d.mts`, and the other exports are typed at their test call sites, as the precedent casts do. `deploy/history-replay.mjs`'s header sentence "never loads node:sqlite in any form" stops being true once the driver imports these exports; W2-5a rewords it, and W2-1 never touches that file. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 |
| R2 | **Task 2's shared names.** Task 2 declares `RECALL_OFF_META`, `RECALL_OFF_GAP_MS` (600,000) and `RECALL_OFF_SCAN_MAX` (4,096) and binds all three in O14's `VOCABS`, as 5h-2 bound `RELAY_LOOKBEHIND_BYTES`; Task 4 consumes them, and its `RECALL_OFF_KEYS` row goes after them. `measure-history.py` emits the presence record's raw rows as `w2.recall_off`: `[k, v]` pairs ordered by `k`, every row under the prefix (`state:`, `seen_ms`, `change:`, `gap:`), in families mode only. The script decides nothing (W2-D13); E12 names `w2.recall_off`. The new `SCHEMA_VERSION === 2` pin stays (W2-D10): the PR that raises the schema needs a ruling and edits it anyway. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2, 4, 6 |
| R3 | **Task 3's verb and its one writer.** The pass touches no store (D-6239). A history root that is not a directory, or a `recall-off/` that is a link or not a directory, answers exit 1 with one line and no new reason word. `--clear` on an entry that is neither a regular file nor a link answers rc 1 with a line naming it, and removes nothing. `--clear-all`'s `cleared` is a count and `skipped` the list of names. Task 3 re-expects C66's B2-half assertion (`recall-off <id> --json` was `[2, 'bad-args']`, "the writing verb ships with W2") in its own commit, so every suite stays green at every commit; Task 5 only checks that the line is gone. Task 3 moves every recall-off content reader onto `readBounded` (W2-D29), `sweep.mjs`'s `recallOffPresence` and `cli.mjs` included; Task 4's scan calls `readBounded` itself. Task 3 writes README's verb text, `shared/lifecycle.ts`'s `history-recall-off` row and `lifecycle.test.ts`'s `'W2-1'` (W2-D3, W2-D9). `ccd/session-hook.sh`'s comment that the CLI reads 4,096 bytes of `recall-off/<id>` goes stale: the hook is outside W2-1's files and stays fail-closed, and the next fleet PR that holds it corrects the sentence. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3, 4, 5 |
| R4 | **Task 4's presence record.** `seen_ms` survives a restore or an adopt, as built (D-6240). A `recall-off` file whose content is not a generation is recorded as `v = 'sha256:<hex>'` of its trimmed text, never the raw text. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| R5 | **Task 5's end-to-end pins.** RP10's card half ("the next card line serves for each family") lands in Task 5, beside RP8, which already drives the hook. RP8 runs W2-3's pipeline only as W2-D32 names it (the .py raw rows, `buildWindows`, the count), and does not run `changedFamilies`. A transcript row stamped in the future is how G1's window spans the G2 call, and the case asserts the span. RP10 asserts `cleared === 3` and `skipped` empty, as R3 rules. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3, 5 |
| R6 | **Task 6's errata and checks.** Added errata, amended in place by W2-1, with no number: §9.4's "Lands in" cells for `history-recall-off` and `history-replay-out` read `W2-1` and `W2-4`; §8.8's failure-table row for the `recall-off` generation gains `generation-malformed` and `generation-mismatch`, under E4; §9.14's "What it holds" gains the `recall-off` journal kind; and §8.4 `status`'s `recall_off` block (E5). D-5763's and D-5764's entries name Task 3. The whole-PR checks add `GROWTH_CHECK=1` growth-check, the citations test, and a grep for added `.mjs:N` citations. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 6 |

## Review Focus

These five inputs follow from the decisions and the spec and would bite an operator or the eval. Each names the task whose tests pin it, and what the reviewer probes beyond them.

1. **A registry generation that is not the one the census assigned, and a planted entry at the write path.** `$REG/<id>.generation` can be unreadable, absent, empty, padded, a UUID that differs from `--generation`, or a link; `recall-off/<id>` or `recall-off/` itself can be a link, a directory, a file or a FIFO, the history root a link or a file, and a stale `~tmp.<pid>` can be left by a dead writer. Expected: W2-D27's table exactly, every refusal before any write, no link followed at any path the writer touches (the history root, `recall-off/`, `recall-off/<id>` and its temp), a stale temp removed under the lock, `--clear` on a non-file answering rc 1 and `--clear-all` naming what it skipped. The registry read is not the writer's: it follows a link at `$REG/<id>.generation`, as every registry read does, and reads its target's content (Task 3's Choices). **Task 3** pins the table in `decideRecallOffWrite`'s rows and through the shim at both doors (a linked `.generation` among its rows), the temp's open flags, the pass's own 0700 and 0600 modes under umask 022 and the directory fsync in process, the link cases end to end, and the unusable root and `recall-off/` (a link, a file, a FIFO) at every form. The reviewer probes the one-LF trim against the drain's whole-whitespace trim (a padded value is `generation-malformed` to the verb but its generation to the drain), and the skipped store halves (D-6239) against §9.2 and §8.4.
2. **The presence record across clocks, recoveries and rollbacks.** A clock step during a scan, a rebuild mid-window, a recover pass with files planted, a restore or adopt from another box, and a rollback to a build that does not know the `recall-off` journal kind. Expected: change rows never later than the change and `prev_seen_ms` never earlier than the observation (two clocks per observation), no change row for a file unchanged across a rebuild, none written by a recover pass or under replay, unreadable never read as absent, and an older build skipping and counting each record. **Task 4** pins these in `history-lib` (the planner, the grammar, replay rows equal live rows, the gate's `changedFamilies` contract), `history-sweep` (one change per transition, gap after a skipped interval with its CONTROL), `history-recover` (replay without the directory, rebuild then tick, recover pass) and `history-cli` (`seen_ms` after a write and a tick). The reviewer probes a backward clock onto an earlier observation's ms for the same id (DO NOTHING keeps the first row), and the restore and adopt edge (D-6240), which no case drives.
3. **A hostile or oversized `recall-off/`.** More than `RECALL_OFF_SCAN_MAX` names, names off ccd's grammar, files over `CONTROL_FILE_MAX`, a link swapped in for the directory. Expected: a capped or unreadable directory writes nothing and does not advance `seen_ms`, non-id names are counted and never read, and an over-cap file is `unreadable`. **Task 4** pins the capped, unreadable and skipped-name counters end to end, and **Task 3** pins the one reader at `CONTROL_FILE_MAX` for the CLI and the drain alike; the scan reads each id's file through `readBounded` with the same arguments (R3). The reviewer probes the cost of a full-size planted directory every tick; that the step draws nothing from `ctx.budget`, which no case pins (Task 4's Choices put it outside the run budget, as `recordTick` is, its reads bounded by `RECALL_OFF_SCAN_MAX` and `CONTROL_FILE_MAX`); and the `lstatSync` to `opendirSync` window (an out-of-band actor only: the tick and the writer share the shim's lock).
4. **A reused id with a new generation inside the eval's window, and the instrument that reads it.** Expected: the new family reads (exit 0) and gets its card line, `recall_off_stale` counts once, the analysis counts no G2 line in G1's window, and the census emits every `recall_off:` row raw with the prefix lib declares. **Task 5** pins RP8 end to end through `measure-history.py`, `buildWindows` and `windowTotals`, with a CONTROL that recomputes the window without the generation filter and a mutant that drops the filter from the script; **Task 2** pins the Python twin (one assignment, one occurrence of the value) and the `substr` match against `LIKE` with CONTROL keys `recallXoff:` and `RECALL_OFF:`. The reviewer probes that the verb's write at `Date.now()` lies inside RP8's analysis window, so `changedFamilies` would flag G1 there (RP8 does not run it, R5), and that CI's test selection picks `history-recall.test.ts` for a change to `measure-history.py` or `session-hook.sh`, which it now spawns.
5. **The exports' byte identity and their import-time effects.** `expandEntryText` after the split, `stampAtOrBefore` with a stamp of 0, an undefined index and a NULL run, `bodyOf` over a tombstone, and importing cli.mjs from another process. Expected: every existing reader answers as before; the umask after the import is 0o077 and `main` never runs. **Task 1** pins `stampAtOrBefore`'s five cases, the five body states with `expandBlob`'s answer handed back, `bodyOf`'s null against `keptOf`'s empty set (W2-D68's CONTROL), the child-process import pin, and the single-definition shape of the blob reads; Step 6 measures the moved function identical to the private one over every call the suites make. The reviewer probes `expandEntryText`'s spread order and its `RangeError` fallback on `k.blob.bytes`, which only the existing DM2b, D-4596 and nested-row cases pin, and whether anything else in the sweep's module graph has an import-time effect on the importing process.

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `ccd/history/lib.mjs` | modify | **Task 1:** `stampAtOrBefore(rows, index)`, exported, directly above `eofAfterBoundary`'s doc comment. **Task 2:** `historyPaths`' `recallOffDir` and `headlessOn` and its doc lines; `recallOffPath` returns `${historyPaths(home).recallOffDir}/${id}` after `idOk`; `isSyntheticModel` above `backendOf`, which calls it; `RECALL_OFF_META`, `RECALL_OFF_GAP_MS` and `RECALL_OFF_SCAN_MAX` directly after `RECALL_OFF_DIR`. **Task 3:** two exit-2 words in `REASON_ROWS` with D-5764's comment; `parseOpVerbArgs`' `recall-off` case; `decideRecallOffWrite` replacing `decideRecallOffPreflight` and its section header. **Task 4:** `JOURNAL_KINDS` gains `'recall-off'`; the module-private record shapes after `VERDICT_SHAPES`; `parseJournalRecord`'s and `replayStep`'s `recall-off` branches; after `decideRecallOff`, `RECALL_OFF_KEYS`, `recallOffStateOf`, `planRecallOffObservation`, `recallOffReplayRows` and `recallOffStatusOf`. | L1 | 1, 2, 3, 4 |
| `ccd/history/lib.d.mts` | modify | One declaration per new export: `stampAtOrBefore` (Task 1); `HistoryPaths`' two fields, `isSyntheticModel` and the three constants (Task 2); `OpArgs`' `recall-off` arm, `RecallOffWrite` and `decideRecallOffWrite`, with `RecallOffPreflight` and `decideRecallOffPreflight` removed (Task 3); `RECALL_OFF_KEYS`, `RecallOffState`, `RecallOffRow`, `RecallOffPlan` and four functions, with `JournalKind` and `ReplayAction` widened in place (Task 4). | types | 1, 2, 3, 4 |
| `ccd/history/derive.mjs` | modify | **Task 1:** `blobReadStmts(db)` above `stmts`, which spreads it; `export` on `bodyOf` and `keptOf`; the private `stampAtOrBefore` deleted and imported from lib; `deriveOne`'s call passes `(copy.rows, copy.index.get(b.uuid))`. | L4 | 1 |
| `ccd/history/recall.mjs` | modify | **Task 1:** `expandParseMeasured` (module-private) with `expandParse` as its projection; `export function expandEntryBody(rc, e)`; `expandEntryText(rc, e)` reads through it; `expandRenderItem`'s call drops `s`. | L4 | 1 |
| `ccd/history/cli.mjs` | modify | **Task 1:** `export` on `pairIndexOf`. **Task 3:** lib import lines; `recallOffPresence` imported from sweep.mjs; the dispatcher comment, `USAGE` and `FIELD_READ_MAX`'s comment; `readContextIn` reads through `recallOffPresence`; `recallOffVerb` and its `main` line deleted; `OP_OF_VERB['recall-off']`. **Task 4:** `emptyEnvelope`'s and `readStore`'s `recall_off`, and `render`'s human line, through the existing `healthLib` namespace import. All above the entry guard. | L4 | 1, 3, 4 |
| `ccd/history/sweep.mjs` | modify | **Task 3:** `node:fs` gains `fchmodSync` and `mkdirSync`; `recallOffPresence` exported on `readBounded` at `CONTROL_FILE_MAX`; `OP_VERBS` holds `'recall-off'`; `opPass` answers it after the gate and the role check; `recallOffPass`, the one writer, after `writeOpMarker`. **Task 4:** its own import statements after the `card.mjs` import; `recordRecallOff` and its scan (each id's file through `readBounded` itself) above `recordTick`'s doc comment, called between `mergeSteps` and `recordTick` in `tick` only; tick docstring item 19 (items 19 to 23 renumbered 20 to 24); `applyReplayAction`'s `recall-off` case; four counters. All above the entry guard. | L4 | 3, 4 |
| `deploy/history-gate.mjs` | modify | **Task 2:** the lib import line gains `RECALL_OFF_META` and `isSyntheticModel`; `isSyntheticLocal` and `RECALL_OFF_PREFIX_LOCAL` with their `TEMPORARY` comments deleted; `turnsOf`'s call and doc lines and `parseRecallOffRow`'s two prefix lines name the imports. Export set unchanged. | deploy (pure) | 2 |
| `deploy/measure-history.py` | modify | **Task 2:** module-level `RECALL_OFF_META`; `recall_off_rows(db)`; `w2.recall_off` in families mode, read after `families_report` in its snapshot; the docstring's `w2` entry and one paragraph. | deploy (instrument) | 2 |
| `shared/lifecycle.ts` | modify | **Task 3:** the `history-recall-off` row (pattern O, creator `sweep.mjs --op recall-off`, root naming `recall-off/~tmp.<pid>`, tier at most 37 B), directly after `history-replay-out`. The only `shared/` file this PR edits. | L0 | 3 |
| `README.md` | modify | **Task 3:** new lines after the "Box verbs and operator verbs." paragraph stating the verb; that paragraph's pinned words are kept. | docs | 3 |
| `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` | modify | **Task 6:** errata E1, E3, E4, E5, E6, E12, E13, E14, E15, E16, E17, E18 and E26, and the three added errata (R6), in place, no line added or removed. | docs | 6 |
| `docs/superpowers/plans/2026-10-21-ccrc-history-w2-1-recall-off-and-exports.md` (this plan) | modify only to correct a task's own entry | "Deviations found" defines D-5763, D-5764, D-6238, D-6239 and D-6240 once each, from the plan's own commit, and D-6241 (issued to the execution run, Task 3) from Task 3's. Tasks 1, 3 and 4 check their entries; Task 6 Step 1 finds each once (its glob is `docs/superpowers/plans/*-ccrc-history-w2-1-*.md`). | docs | 1, 3, 4, 6 (check only) |
| `server/test/history-lib.test.ts` | modify | One describe appended per task: `stampAtOrBefore` (Task 1, 5 cases); the paths, constants, `isSyntheticModel` and the W2-D10 pin (Task 2, 20 cases); C16's two words, the grammar and `decideRecallOffWrite`'s rows (Task 3, which also re-expects `parseOpVerbArgs`' base case that refused `recall-off`, in place); the presence record (Task 4, 15 cases). | test | 1, 2, 3, 4 |
| `server/test/history-recall.test.ts` | modify | **Task 1:** the exports describe (4 cases, darwin-skipped). **Task 3:** the `decideRecallOffPreflight` case replaced and its describe's title renamed in place, `C66 (B2 half)`'s `'the writing verb ships with W2'` line replaced, and the one-reader and RP10 verb-half describe appended. **Task 5:** one describe of four `it`s (RP8, RP10's card half, C66's and C67's W2 halves) with module-private helpers, and no import line. | test | 1, 3, 5 |
| `server/test/history-op.test.ts` | modify | **Task 3:** two describes appended: C64's recall-off rows at both doors, and the writer through the shim (modes, W2-D27's table, temps, links, an unusable root or `recall-off/`, `--clear`, `--clear-all`), and in process (the pass's own modes under umask 022, open flags, directory fsync). **Task 4:** the O34 audit case's outbox count re-expected in place to count verdict rows only (the presence record's gap record waits beside them). | test | 3, 4 |
| `server/test/history-cli.test.ts` | modify | **Task 3:** the CLI door relays the shim, C16 spawned, `--clear-all`'s summary, README's text. **Task 4:** `status`'s `recall_off`, with and without a store. | test | 3, 4 |
| `server/test/history-recover.test.ts` | modify | **Task 3:** RB12 at both doors and C67 at the direct door. **Task 4:** the presence record across a recovery (3 cases). | test | 3, 4 |
| `server/test/history-sweep.test.ts` | modify | **Task 4:** one describe of 4 end-to-end cases. The tick-docstring describe is not edited; it pins the new item. | test | 4 |
| `server/test/measure-history.test.ts` | modify | **Task 2:** in place, the `W2` interface, the `w2` `toEqual` (`recall_off: []`), W2-3's import-line pin, and W2-3 Task 5's header comment and one title (assertions unchanged); appended, the gate-reads-lib describe (4 cases: CONTROL, no local spelling, the Python twin, the emission through `changedFamilies`). | test | 2 |
| `server/test/single-definition.test.ts` | modify | **Task 1:** an appended describe (the deploy lane's exports defined once). **Task 2:** `VOCABS` gains the three constants in place (+2 lines); H-149 names `RECALL_OFF_META` (no line moves); an appended describe (`isSyntheticModel`'s sole definer and the one angle-bracket line). **Task 3:** O13's six header comment lines and its last case, replaced by "recall-off/<id>: exactly one writer, sweep.mjs" with its CONTROLs and KNOWN WIDTH comment. **Task 4:** `'RECALL_OFF_KEYS'` joins `VOCABS` after Task 2's entries, and O13's reader-count line moves from 1 to 2 in place (the tick's scan, R3). No import line. | test (citation corpus) | 1, 2, 3, 4 |
| `server/test/lifecycle.test.ts` | modify | **Task 3:** `HISTORY_LANDED` appends `'W2-1'`; one case after the `history-replay-out` case declares `history-recall-off` (O17's W2-1 half). | test | 3 |

## Drifts since the decisions document

The decisions document was written at `bd363a76b`; the base is `02d75ae5f`. Each row: what the document says, what the code at the base says, and what that changes here.

| Document says | Code at `02d75ae5f` | Effect | Task |
|---|---|---|---|
| §2: W2-1 waits for 5h-2, W2-3, W2-4 and 5h-1's Task 6 | All merged at `02d75ae5f`; the ledger's 5h-2 row still reads "run 702, dispatched" | Task 1 Step 0 checks the ancestry; the ledger is the coordinator's | 1, 6 |
| W2-D33: cli.mjs's entry guard at :1668 | The guard is about :1695; `process.umask(0o077)` still about :69 | Anchored by content; the import pin runs in a child with no `argv[1]` | 1, 6 |
| W2-D33: the helper answers `'body'\|'tombstone'\|'over-cap'\|'unparseable'` | 5h-1's Task 6 reads the variant rows before the primary's bytes (D-4596); `expandBlob` answers `pruned`, `too-large`, `undecodable` or `bytes`, and the `RangeError` fallback needs the primary's bytes | `expandEntryBody(rc, e)` with five states, `causes` and `blob`; D-6238 (R1) | 1 |
| W2-D33: `stampAtOrBefore` "typed in lib.d.mts", "everything exported" | Only lib.mjs has a hand-written `.d.mts`; tests cast derive.mjs's imports | Only `stampAtOrBefore` is declared; the others are typed at their test call sites (R1) | 1 |
| W2-D33: `stampAtOrBefore` takes plain `(rows, index)` | The private one at derive.mjs about :206 takes `(copy, uuid)` and reads `copy.index` | `index` is the integer position; derive passes `copy.index.get(b.uuid)`, and `undefined` still answers null (15014 identical calls measured) | 1 |
| W2-D33: `bodyOf(blobReadStmts(db), blobId, budget)` | `budget` is `{ bytes }`, mutated; `bodyOf`'s null folds three conditions | Typed and pinned as `{ bytes: number }`; the fold is a named residual | 1 |
| `deploy/history-replay.mjs`'s header: "never loads node:sqlite in any form" | derive.mjs, recall.mjs and cli.mjs import `store.mjs`, as W2-D51's `openReader` route already does; W2-4's scan reads direct specifiers only | No change in W2-1; W2-5a rewords the header (R1) | 1 |
| W2-D29: `recallOffPath` at lib.mjs:3933 | About :4332, building `${historyPaths(home).root}/${RECALL_OFF_DIR}/${id}`; `RECALL_OFF_DIR` about :4144, below `historyPaths` (about :418) | Anchored by content; Task 2 checks no module-level statement calls `historyPaths` (TDZ) and smoke-imports lib | 2, 3, 5 |
| W2-D12: O14's `VOCABS` at single-definition.test.ts:5228 | The O14 describe begins about :5281 and `VOCABS` closes `'SEGMENT_HEADER_BYTES'] as const;` about :5301; `] as const;` occurs 26 times in the file | Replaced in place by content; Task 4 locates the list by its declaration, never a bare match; the CITATION DEBT case runs | 2, 4, 6 |
| W2-D11: the gate imports `canonicalJson`, `sha256Hex`, `EXIT`, `producerOf`, `backendOf`, `pickHoldingCopy` | It imports `EXIT`, `UUID_RE`, `canonicalJson`, `pickHoldingCopy`, `producerOf`, `sha256Hex`; W2-3 pins that exact line | The pinned line is rewritten in place with the two new names; no `backendOf` import | 2 |
| W2-D17: a single-definition pin naming lib the sole definer | O14's `declares` reads `const`/`let`/`var` only | A separate appended describe scans function-or-const declarations and counts the angle-bracket line | 2 |
| W2-D23: the twin compares "the prefix measure-history.py spells"; W2-3 defers the emission to W2-1 | The script spells no prefix and reads no meta row but `store_id`; no document fixes where the rows go; `w2` is pinned by a whole-object `toEqual` | Twin and emission created together as `w2.recall_off`; the `toEqual` gains `recall_off: []` in place (R2) | 2 |
| W2-3 plan Task 5: "W2-1's rewire leaves this describe green with no edit" | Its assertions stay green; its header comment and one case title call the prefix temporary and module-local | Same-line-count text edits; no assertion changes | 2 |
| §2: the gate's change is "the two import rewires only" | The rewire also retires `isSyntheticLocal` and `RECALL_OFF_PREFIX_LOCAL` with their comments, and edits `turnsOf`'s and `parseRecallOffRow`'s lines | Listed as the rewire's mechanical consequences; export set unchanged | 2 |
| W2-D9: W2-1 appends `'W2-1'` and declares `history-recall-off` | `HISTORY_ROWS_BY_PR` already has `'W2-1': ['history-recall-off']` (W2-4's split); `HISTORY_LANDED` is `['B1','B2','B3','B4','W2-4']` | Task 2 leaves both files green and untouched; Task 3 appends and declares | 2, 3 |
| W2-D29: the symbolic scan at single-definition.test.ts:5381-5420 | About :5447-5480 | None (not edited) | 3 |
| W2-D29: replace O13's last case | The case is about :5273-5281; the describe's header comment (about :5119-5124) says W2 adds recall-off to `HOLDERS` and drops the exemption | Task 3 rewrites that comment in the same edit | 3 |
| W2-D29 implies the one-writer pin reds first on its writers list | At the base the needle scan already answers `['ccd/history/sweep.mjs']`, because `recallOffPresence` opens with `openSync`, a write verb to the classifier | The red-first comes from the reader count, the writer shape and "outside `recallOffPass`" (mutants M18 to M22) | 3 |
| W2-D27: `generation-unreadable` is "shipped C67" | The CLI decides it alone (`decideRecallOffPreflight` through `recallOffVerb`), with no shim | It moves under the lock into the sweep; the existing C67 cases stay green through the shim, and a direct-door case is added | 3 |
| W2-D28: `--clear-all` "prints `{rc, reason, cleared, skipped: [names]}`" | `decideRelay` answers exit 1 for a result line holding any key but `rc` and `reason` | The summary is its own line before the result line `{"rc":0}`; human mode on stdout, `--json` on stderr, where Task 5's RP10 reads it (R3, R5) | 3, 5 |
| W2-D29: every content reader moves onto `readBounded` at `CONTROL_FILE_MAX` | The CLI read 4,096 bytes (`presenceOf`) and the drain 128; the hook's comment states the CLI's 4,096 | Both now read up to 64 KiB and agree, and Task 4's scan reads the same way; the hook comment goes stale outside W2-1's files (R3) | 3, 4 |
| §2 Pins: C64 (the recall-off forms) | C64's table is `history-maint.test.ts`' `GT_FORMS`, whose CONTROL excludes the pair; that file is not W2-1's | The recall-off rows go into `history-op.test.ts`, both doors | 3 |
| W2-D26: `formOf` at lib.mjs:1094-1095 | About :1097-1098; `WRITING_FORMS` at :95-96 as cited | None (not edited) | 3, 6 |
| Spec §9.4: "one generation (≤40 B) per file" | The writer's largest file is a UUID and one LF, 37 B | `shared/lifecycle.ts`' tier says at most 37 B, pinned to `UUID_RE`'s grammar; the spec cell is Task 6's E6 | 3, 6 |
| W2-D27: "empty (after trimming one LF)" | The drain's `readRegPresence` trims all whitespace | The verb trims exactly one LF; a padded value is `generation-malformed` to the verb (safe direction) | 3 |
| W2-D30: the step runs "in the normal pass only (:3618)", never "in the recover arm (:3301)" | `tick` starts about :3657 and calls `recordTick` about :3751 after `mergeSteps`; `recoverPass` is about :3394 | Placed between `mergeSteps` and `recordTick` in `tick` only; mutant M2 pins that `recoverPass` never calls it | 4 |
| W2-D30: a new numbered item in tick's docstring | The docstring has 23 items; 5h-1's bounded check and 5h-2's re-clean added none (both draw on `ctx.budget` inside existing steps) | Item 19, items 19 to 23 renumbered 20 to 24; the step takes none of the run budget | 4 |
| W2-D30: "the insertBindFacts pattern" | `insertBindFacts` is private to `store.mjs` and leaves its rows for the next tick's flush; `store.mjs` is off W2-1's list | `outboxRow` inside the step's own `withTx`, flushed after it as `verdictTx` does | 4 |
| W2-D30: `seen_ms` absent "after a recovery" | A rebuild starts empty, but a restore copies the backup's meta and an adopt keeps the store's | D-6240 (R4) | 4 |
| §6: E5 is W2-1's; §9.14 enumerates every journal kind | No erratum row covers a §9.14 bullet for `'recall-off'` | Task 4 edits no spec; Task 6 appends the kind to §9.14's `tick` bullet as an added erratum (R6) | 4, 6 |
| W2-D32: "py raw rows → `buildWindows` → count" | The count is the gate's `windowTotals` (about :311); `windowOf` (about :273) is exported | RP8 counts with `windowTotals` and builds the unfiltered CONTROL with `windowOf` | 5 |
| W2-D32: the analysis "does not count the G2 line" | The filter is `measure-history.py`'s `family_report` calls query (about :230); `buildWindows` counts whatever calls the report carries | The CONTROL is mutant M1 on the script plus an in-test recomputation; the gate is not touched | 5 |
| W2-D32: "the hook serves the card line" | No shared helper runs `ccd/session-hook.sh` in a `makeHistoryBox` HOME; `_hook_history_card` serves only after a fresh PreCompact scope marker and a prediction written on a pass that read the transcript to its end | A module-private `rpCompactStart` plants the marker; one Stop-hinted pass precedes each prediction read | 5 |
| W2-D32 lists the hook before the drain | Running the drain first keeps the counted state exactly W2-D32's, whatever the hook later spools (SessionStart(compact) is not in `SPOOL_SOURCES`, so the hook spools no history spool line for it; the delegation spool does record a compact start) | The drain runs first; no asserted value changes | 5 |
| §2: "C66, C67, C68 (re-run)" with no holders named | C66 is held in `history-recall`, `history-lib`, `history-drain` and `history-card`; C67 in `history-recover`, `history-lib` and `history-recall`; C68 in `history-recall` and `session-hook` | Every holder re-runs unedited; the W2 halves go in `history-recall` only | 5 |
| Spec §10.7: "a hand-planted file is pinned before W2 writes any" (C68) | The existing C68 cases plant `G1` with no LF; the verb writes `<G>\n` | Task 5 uses only verb-written files; mutant M5 (the hook's trim removed) reds there and in session-hook.test.ts's C19/C68 parity rows, which plant LF-terminated files too (12 failed, measured) | 5 |
| §6: rev 3.6 spec anchors (E1 :1670, E3 :1741, E4 :1798-1799, E6 :2169, E12 :2620-2624 and :2734-2737, E13 :2624 and O32 :2439, E14 :2459, E15 :3051, E16 :2727 and :2732, E17 :2638, E18 :2697) | E1 :1671, E5 :1737, E3 :1742, E4 :1799-1800, E6 :2170, E12 :2634, :2746 and :2749, E13 :2636 and O32 :2446, E14 :2466 and §10.7 :2907, E15 :3063, E16 :2739 and :2744, E17 :2650, E18 :2709, E26 :2684 | Each replacement is anchored by quoted content and asserted unique | 3, 6 |
| §6 E6: the history-store-id row's 86 B correction is 5h-2's Task 4 | #1010 merged it: the row reads "at most 86 B" and op "at most 119 B; W5h-2, D-5748" | Task 6 checks the tokens and never writes the row | 6 |
| §8.4's operator-verbs region as rev 3.6 wrote it | 5h-2 rewrote the relay bullet directly below "Dry run by default." (D-5747, D-6069) | E3 replaces only its own line; E3 and E5 show as one diff hunk but stay two asserted replacements | 6 |
| W2-D55's limits stops | `decideLimits` also refuses `limits-stale` on a percentage out of range, a null `ts` and a future `ts`; `decideBudget` is a soft stop (D-5814) | E18 states the shipped set | 6 |
| W2-D57 / E26: add `--verbose` to the spec's flags | `spawnArgv` already passes `'--verbose'` on every spawn | E26 states shipped behaviour; Task 6 Step 1 checks the literal | 6 |
| The decisions predate the growth check and the citations ratchet | `growth-check.test.ts` armed 2026-10-21 (D-6178); `citations.test.ts` refuses added numeric line citations outside docs (D-5893) | Task 6 runs both in the whole-PR checks and greps for an added `.mjs:N` citation | 6 |
| 5h-2's census: 16 history suites | 17 at the base (W2-4 added `history-replay.test.ts`) | Task 6 runs all 17 alone, `history-replay` included (read, never edited) | 6 |
| §9.4's "Lands in" for `history-recall-off` reads W2; W2-D9 splits the test key | `lifecycle.test.ts` keys `'W2-1'` and `'W2-4'`; both spec cells still read W2 | Task 6 amends both cells, `W2-1` and `W2-4`, as an added erratum (R6) | 6 |
| §6 has no erratum for §8.8's failure table | Its `recall-off` generation row names only `generation-unreadable` | Task 6 amends it under E4 with the two new words (R6) | 6 |
| §1 "Departures": a departure is written `D-TBD-<slug>` until allocated | `dtbd.test.ts` reds any concrete `D-TBD-` token in a tracked file | The three departures found while planning carry their issued numbers, D-6238, D-6239 and D-6240 (R1, R3, R4) | 1, 3, 4 |

## Not in this plan

- **W2-2a, the as-of cut** (W2-D34 and its neighbours): the next fleet PR, after W2-1. It consumes Task 1's `stampAtOrBefore`; this plan adds no `asof-invalid` word and no cut.
- **W2-2b, the headless seam** (W2-D49 and its neighbours): after W2-2a. `historyPaths(home).headlessOn` is named here (W2-D29) and read by nothing new; the marker grammar, the `RECALL_ARMS` and `HEADLESS_LIST_MAX_*` constants and the `history-switches` row are W2-2b's.
- **W2-5a's `keptOf` scan and its CONTROL** (W2-D33, W2-D68), in `history-replay.test.ts`, which W2-1 never touches; with it, W2-5a's rewording of `deploy/history-replay.mjs`'s "never loads node:sqlite" header (R1), and the `CODE_SHA_FILES`/`GATE_CODE_FILES` and `flags_accepted` parity pins (decisions §7).
- **W2-5b's and W2-6's errata** (E2, E7, E8, E9, E10, E11, E19, E20, E21, E22, E23, E24, and E25): left standing, each checked unchanged by Task 6's script. `marker --section ab`'s `--generation` (W2-D20) is W2-5b's.
- **Session-facing changes:** `ccd/session-hook.sh`, `ccd/ccd`, `ccd/ccd-history-sweep` and the wire. The hook's comment that the CLI reads 4,096 bytes of `recall-off/<id>` goes stale with Task 3; the hook still withholds wherever the CLI answers 8, so behaviour stays fail-closed, and the next fleet PR that holds `ccd/session-hook.sh` corrects the sentence (R3).
- **The rollout.** Through the release lane only, as part of W2's final release rolled onto every named node before part 1 of the open record (W2-D6); no node owes a `doctor --migrate` (W2-D10). The coordinator's or the operator's, never the worker's.
- **The window and its operator acts** (decisions §5): the census, the open record's two parts, the build and maintenance freezes (W2-D6, W2-D7), the backfill re-run and 5h-2's re-clean before pilot sourcing (W2-D8), `recall-off` at window start and `--clear-all` at close. None is the worker's.
- **The ledger's superseded sentence** "only the quiz waits on the backfill" (decisions §6's note): the coordinator's, at the ledger's next edit.

**PR:** One PR against `main`, on this workspace's own branch, executed in task order with six commits, one per task:
1. `refactor(history): export the reads the deploy lane needs, and move stampAtOrBefore into lib (W2-1 Task 1; W2-D33; D-6238)`;
2. `feat(history): lib names the recall-off directory, the presence record's prefix and bounds and the one synthetic-model test, and the gate and the census read them (W2-1 Task 2; W2-D17, W2-D23, W2-D29, W2-D30)`;
3. `feat(history): recall-off writes through the shim, checks the id's generation under the lock, and has one writer (W2-1 Task 3; W2-D26, W2-D27, W2-D28, W2-D29; D-5763, D-5764, D-6239)`;
4. `feat(history): record recall-off presence on every tick, journaled through the outbox, and report it in status (W2-1 Task 4; W2-D30, W2-D31; D-6240)`;
5. `test(history): RP8 end to end, RP10, and C66, C67 and C68 re-run over the shipped recall-off verb (W2-1 Task 5; W2-D32)`;
6. `docs(history): spec errata for W2-1, W2-3 and W2-4, amended in place (W2-1 Task 6; W2-D3, D-5763, D-5764, D-6241)`.

Task 1 stands alone and goes first. Task 2's names are consumed by Tasks 3, 4 and 5; Task 3's verb by Task 5, and its O13 reader count by Task 4, whose scan adds the second `readBounded` line (R3); Task 4's record by Task 5's ticks; Task 6 states what Tasks 1 to 4 shipped and runs last. Every task leaves every suite green at its commit. The PR is opened by Task 6 Step 11, only after Steps 6 to 10 (the file list, the whole-PR checks, `deviation-refs` against `origin/main`, a clean tree, and the private-name count of 0), ready for review (not a draft), titled **"ccrc history wave W2-1: recall-off, the presence record and the deploy lane's exports"**, with the body Task 6 Step 10 gives.

---

### Task 1: the exports the deploy lane reads, with stampAtOrBefore moved into lib (W2-D33)

W2-5a's driver (`deploy/history-replay.mjs`) reads a store the way the store's own readers do, and holds no second decode (W2-D74): a kept list through `bodyOf`, an entry's body through expand's body pick, and the run's pair index through the CLI's own builder. W2-2a's as-of cut reads a boundary's time through the same rule derive.mjs's raw-leaf grace uses (W2-D34). Today all of those are module-private. This task exports them, and nothing else:
- `stampAtOrBefore` **moves** from derive.mjs, where it is private and takes `(copy, uuid)`, into lib.mjs. There it is exported, takes plain `(rows, index)` and is declared in `lib.d.mts`. derive.mjs imports it. lib cannot import derive.mjs, which imports lib, so this is the only direction that leaves one definition.
- derive.mjs: `export` on `bodyOf` and `keptOf`. A new `export function blobReadStmts(db)` prepares exactly the two blob SELECTs, and `stmts(db)` spreads it, so each SQL text is spelled once. The driver calls `bodyOf(blobReadStmts(db), blobId, budget)`.
- recall.mjs: the body pick is split out of `expandEntryText` as `export function expandEntryBody(rc, e)`, and `expandEntryText` reads through it. Its exact signature and answer are fixed here, against the merged `expandEntryText` (5h-1's Task 6 moved the variant read ahead of the primary's bytes, D-4596).
- cli.mjs: an in-place `export` on `pairIndexOf`.

The task is a pure refactor and goes first in W2-1. What every existing reader answers is unchanged, byte for byte. Step 6 proves this for the moved function against the private one it replaces, and Step 8 re-runs the suites whose cases pin expand's and derive's outputs. Its departure is **D-6238** (`history-expand-body-five-states`; R1): W2-D33 lists four state words for the helper, and the merged code needs five (Choices). Its entry is in this plan's "Deviations found", written with the plan, and Step 8 checks it is there once. Spec: none. W2-D33 is not a departure (section 3 marks it "no"), and section 6 has no erratum for it.

**Importing cli.mjs (W2-D33's last paragraph, re-anchored at `02d75ae5f`).**
- At import, cli.mjs runs `process.umask(0o077);` (about :69). That sets the umask of the **importing** process, so every file the driver creates afterwards defaults to 0600 and every directory to 0700.
- It also loads `./sweep.mjs`, `./recall.mjs` and `./store.mjs`. store.mjs is `node:sqlite`'s one importer, so the driver loads `node:sqlite` through it.
- `main` runs only behind the entry guard, the file's last statement, `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {` (about :1695 at `02d75ae5f`; the decisions document's :1668 predates 5h-2). Under the driver, `process.argv[1]` is the driver's own path, so the guard is false.
- derive.mjs and recall.mjs have no entry guard, and no top-level effect besides their imports.
- Step 2's import pin runs in a child process, so the umask never leaks into a vitest worker. It pins two facts: the umask after the import is 0o077, and stdout holds only the child's own line, so `main` did not run.

**Order.** This task touches none of the later W2-1 tasks' regions: the recall-off verb, the presence record, status, the O13 pin and the gate rewires. Line numbers below were measured at `02d75ae5f`, the base this task needs, and are hints only. Re-anchor by the quoted content: Step 4's script asserts that each anchor occurs exactly once.

**Files:**
- Modify: `ccd/history/lib.mjs`. Insert `stampAtOrBefore` and its doc comment directly above the doc comment that begins `/** Whether the file holding a boundary was read to its end late enough to say its summary row is missing.` (the `eofAfterBoundary` block, about :5803 at `02d75ae5f`). No import changes: lib stays `node:crypto`-only.
- Modify: `ccd/history/lib.d.mts`: one declaration, directly after `export function eofAfterBoundary(i: { eofMs: number | null; boundaryTsMs: number | null }): boolean;` (about :668).
- Modify: `ccd/history/derive.mjs`:
  - the lib import's last name line, `  secretUnits, summaryParts, summaryRowFor, withinBudget, BELT_NODES_STEP, REPARSE_MAX_TARGETS, topicsOfColumn,` (about :20), gains `stampAtOrBefore,`;
  - `blobReadStmts`, new, directly above `stmts`' doc comment, which begins `/** The prepared statements, one set per connection.` (about :35);
  - in `stmts`, the two lines `blobZ: db.prepare('SELECT z FROM blobs WHERE blob_id = ?'),` and `blobLen: db.prepare('SELECT raw_len FROM blobs WHERE blob_id = ?'),` (about :82-83) become `...blobReadStmts(db),`;
  - `function bodyOf(s, blobId, budget) {` (about :162) and `function keptOf(s, blobId, budget) {` (about :177) gain `export`, and each doc comment gains one sentence;
  - the private `stampAtOrBefore` and its doc comment (about :204-212) are deleted;
  - its one caller, in `deriveOne`, `boundaryTsMs: stampAtOrBefore(copy, b.uuid) }),` (about :397), passes `(copy.rows, copy.index.get(b.uuid))`.
- Modify: `ccd/history/recall.mjs`:
  - `expandParse` (about :1478) becomes a projection of the new module-private `expandParseMeasured`;
  - the new `export function expandEntryBody(rc, e)` goes directly after `expandParse`;
  - `function expandEntryText(rc, s, e) {` (about :1486) becomes `function expandEntryText(rc, e) {`, which reads through `expandEntryBody`;
  - its one caller, in `expandRenderItem`, `const t = isEntry ? expandEntryText(rc, s, e) : expandSidecarText(rc, s, it.blobId);` (about :1581), drops `s`.
- Modify: `ccd/history/cli.mjs`: `function pairIndexOf(db, home) {` (about :556) gains `export`, and its doc comment gains one sentence. Nothing else in cli.mjs changes.
- Test: `server/test/history-lib.test.ts`: one describe appended at the end of the file (about :10500), 5 cases.
- Test: `server/test/history-recall.test.ts`: one describe appended at the end of the file (about :5400), 4 cases, skipped on darwin like every spawning describe there.
- Test: `server/test/single-definition.test.ts`: one describe appended at the end of the file (about :8316), 4 cases. It is APPENDED after the last describe and adds no import line, for the reason that file's CCRC HISTORY block states: `session-hook.test.ts`' citation audit cites the file by line.
- Not edited:
  - `deploy/history-replay.mjs`, `server/test/history-replay.test.ts` and `.github/workflows/*` (W2-1's never-touch list). W2-5a writes the `keptOf` scan beside its CONTROL (W2-D33, W2-D68).
  - `ccd/history/sweep.mjs` and `store.mjs`.
  - `history-derive.test.ts` and `history-card.test.ts`: neither is in W2-1's test list. They run unchanged in Step 8, as the identity check for derive.mjs.
  - The spec and README.md: no sentence states these modules' export lists.
  - No `.d.mts` is created for derive.mjs, recall.mjs or cli.mjs (Choices).

**Interfaces:**
- Consumes (base, unchanged):
  - `lib.mjs`:
    - `pickExpandBody({ primary, variants: { body, cause }[] }): unknown`;
    - `jsonWithinStructureBound(bytes: Uint8Array): boolean`;
    - `renderEntryText(body: unknown): string`;
    - `variantCauseOf(a, b)`, which answers `'unknown'` for anything that is not two equal-length arrays;
    - `eofAfterBoundary({ eofMs, boundaryTsMs })`;
    - `SCHEMA_ADDED`, and `selectColumns(version, table, cols, schema)` through `expandStmts`.
  - recall.mjs, module-private:
    - `expandStmts(rc)`, cached per `rc.db` in `EXPAND_STMTS`. It reads `rc.db`, `rc.version` and `rc.schema` only.
    - `expandBlob(s, blobId, isSidecar)`. It answers `{ state: 'pruned', prunedMs: number | null }`, `{ state: 'too-large', rawLen, bound? }`, `{ state: 'undecodable', rawLen }` or `{ state: 'bytes', bytes: Buffer }`.
  - derive.mjs: `stmts(db)`, cached per connection in `DERIVE_STMTS`; `unbrotli` and `blobOverDecodeCap` through `bodyOf`.
  - cli.mjs: `loadSecrets`, `makePairIndex`, `makeBelt`, `beltUnits`, `parseRedactSources` and `REDACT_SOURCES_META`, through `pairIndexOf`.
  - Tests: `historyHelpers.ts` (`makeHistoryBox`, `runCli`, `withPane`, `openStoreRO`, `plantTranscript`, `REPO`), and history-recall's file-level `t16uuid`, `t16ts`, `t16summary`, `t16seed`, `t16scan`, `t16items` and `t16brotliCompress`.
- Produces:
  - `lib.mjs`: `export function stampAtOrBefore(rows, index): number | null`.
    - It answers the newest non-null `rows[i].ts_ms` for `i` from `index` down to 0, as a `Number`, and null when there is none or when `index` is `undefined`.
    - A stamp of 0 is a time.
    - Otherwise `index` is at most `rows.length - 1`; past that it throws, as the private one did.
  - `lib.d.mts`: `export function stampAtOrBefore(rows: readonly { readonly ts_ms: number | bigint | null }[], index: number | undefined): number | null;`, declared once.
  - `derive.mjs`:
    - `export function blobReadStmts(db): { blobZ: StatementSync; blobLen: StatementSync }`. It prepares exactly `'SELECT z FROM blobs WHERE blob_id = ?'` and `'SELECT raw_len FROM blobs WHERE blob_id = ?'`, and is not cached.
    - `export function bodyOf(s, blobId, budget): unknown`. `s` is any object with `blobZ` and `blobLen`, and `budget` is `{ bytes: number }`, mutated by `+= z.length`. The answer is the parsed body, or null for a tombstone, a body that is not JSON, or an over-cap or unmeasured body. These are three conditions with one answer, unchanged from the base (Residuals).
    - `export function keptOf(s, blobId: number | null, budget): Set<string>`, unchanged.
  - `recall.mjs`: `export function expandEntryBody(rc, e): { state, body, primary, causes, blob }`.
    - Arguments: `rc` is `{ db, version, schema }` (a read handle, its `user_version`, `SCHEMA_ADDED`), and `e` is `{ entry_id, blob_id }`.
    - `state: 'body'`: the primary parsed as JSON. `body` is pickExpandBody's pick over the decodable `ccd-sanitize` variants, and `primary` is the parsed primary.
    - `state: 'unparseable'`: the primary decoded but is past B1's structure bound or is not JSON. `body === primary`, its text.
    - `state: 'tombstone'` (expandBlob's `pruned`, no blob row included), `'over-cap'` (`too-large`, either arm) or `'undecodable'`: `body` and `primary` are null.
    - `causes: string[]`: every variant row's cause except the primary blob's own, read before the primary's bytes (D-4596).
    - `blob`: expandBlob's own answer for the primary, untouched.
  - `recall.mjs`, module-private: `expandParseMeasured(bytes): { parsed: boolean, value: unknown }`. `expandParse(bytes)` is its `.value`. `expandEntryText(rc, e)` answers exactly what `expandEntryText(rc, s, e)` answered.
  - `cli.mjs`: `export function pairIndexOf(db, home): PairIndex`, unchanged.

**Choices this task makes:**
- **`stampAtOrBefore(rows, index)` takes the row's position, not its uuid.** "Plain `(rows, index)`" (W2-D33) leaves room for two readings: the position, or the uuid map plus a uuid. A uuid map is a copy's internal structure; W2-2a's cut has the boundary's position in N's holding copy. derive.mjs passes `copy.index.get(b.uuid)`, which is `undefined` for a uuid the copy does not hold. The loop `for (let i = index; i >= 0; ...)` reads `undefined` as no iteration and answers null, exactly as the private one did. The private body is otherwise copied unchanged, `Number(t)` and the `t !== null` test included (so a stamp of 0 is a time, and mutant M1 pins it).
- **`expandEntryBody` takes `rc`, not expand's statement set (R1).** expand's statements are module-private and read their columns at the store's version (`selectColumns`, DM44). Handing them out would make the driver build them, and handing out `expandStmts` would export a second name. `rc` needs only `{ db, version, schema }`, which the driver has from `openReader` and `userVersion`. Inside expand, `expandStmts(rc)` hits the same `EXPAND_STMTS` entry that `runExpand`'s `s` came from, since `runExpand` is the only caller and passes that `rc` through. So `expandEntryText` drops its unused `s`.
- **Five state words, not four (D-6238; R1).** W2-D33 names `'body'|'tombstone'|'over-cap'|'unparseable'`, written before 5h-1. The merged `expandBlob` tells four primary states apart. One of them, `undecodable` (a NULL `z` with no `pruned_ms`, or bytes that do not decompress), is a damaged store and not a pruned blob: expandBlob's doc comment says so, and expand prints "content does not decode" for it, not "content pruned". Folding it into `tombstone` would be an overloaded value at a seam, and so would folding it into `unparseable`, which carries a body. W2-5a discards on all three non-body states, but counts each by its own reason (W2-D68, "counted").
- **`unparseable` is decided at the parse, never from the value's type.** A stored body that is itself a JSON string (`"…"`) parses to a string. So `expandParseMeasured` reports `parsed`, and `expandParse` stays its projection, so its other two callers (`expandPairedPath`, `expandPrimaryBody`) are untouched. Mutant M9 pins this.
- **`blob` carries expandBlob's answer whole.** `expandEntryText` then answers `{ ...k.blob, causes: k.causes }` for a non-bytes primary, the same keys in the same order as `{ ...p, causes }`, and its RangeError fallback reads `k.blob.bytes` as it read `p.bytes`.
- **`blobReadStmts` is not cached.** `stmts` caches its own set per connection and calls it once per connection. A driver that reads many kept lists calls it once and keeps the answer. Caching it in a second WeakMap would add state with no reader.
- **No `.d.mts` for derive.mjs, recall.mjs or cli.mjs (R1).** Only lib.mjs has a hand-written type mirror. W2-1 creates no source file, and its consumers are JavaScript (the driver) or tests that cast at the import, as `history-card.test.ts` and `history-derive.test.ts` already do for derive.mjs. So `lib.d.mts` gains exactly one declaration, the moved function. This departs from W2-D33's "typed in lib.d.mts" only for names that are not lib's (Drifts).

**Residuals, named:**
- **`bodyOf`'s null is three conditions:** a tombstone, a body that is not JSON, and an over-cap or unmeasured body. This is unchanged from the base, and W2-D68 reads them as one reason, `kept-unreadable`. Step 2's case (c) pins only that a tombstone answers null where `keptOf` answers an empty set.
- **`keptOf` still folds a NULL id, a tombstone and a non-array body into an empty set.** W2-5a's scan (that no `deploy/*.mjs` calls it) is the guard, as W2-D33 assigns.
- **The driver's header sentence.** `deploy/history-replay.mjs` says that it "never loads node:sqlite in any form". Importing any of these exports loads store.mjs, and with it `node:sqlite`, as W2-D51's own `openReader` route does. W2-4's scan reads direct specifiers only and stays green. Rewording the header is W2-5a's job, because W2-1 never touches that file (R1).
- **Importing cli.mjs sets the importing process's umask to 0o077** and loads the sweep's module graph. W2-D33 names this, and `history-replay.test.ts` sets fixture modes explicitly.

- [ ] **Step 0: Check the base.** From the repository root, before any edit:

```bash
git merge-base --is-ancestor 02d75ae5f HEAD && echo 'base holds 5h-2' || echo 'STOP: 5h-2 (#1010) is not on this base'
```

Expected: `base holds 5h-2`. On `STOP`, make no edit and report to the coordinator. `02d75ae5f` is #1010's merge. It holds 5h-1 (#737, `expandEntryText`'s variant read), W2-3 (#856) and W2-4 (#826), which W2-1 waits for (section 2).

- [ ] **Step 1: Confirm the anchors, that no name is taken, and the base counts.** From the repository root:

```bash
grep -c '^function stampAtOrBefore(copy, uuid) {$' ccd/history/derive.mjs
grep -c '^function bodyOf(s, blobId, budget) {$' ccd/history/derive.mjs
grep -c '^function keptOf(s, blobId, budget) {$' ccd/history/derive.mjs
grep -c "^    blobZ: db.prepare('SELECT z FROM blobs WHERE blob_id = ?'),$" ccd/history/derive.mjs
grep -c '^function expandEntryText(rc, s, e) {$' ccd/history/recall.mjs
grep -c '^function pairIndexOf(db, home) {$' ccd/history/cli.mjs
grep -c '^process.umask(0o077);$' ccd/history/cli.mjs
grep -c '^if (process.argv\[1\] && import.meta.url === pathToFileURL(realpathSync(process.argv\[1\])).href) {$' ccd/history/cli.mjs
grep -c 'blobReadStmts\|expandEntryBody\|expandParseMeasured' ccd/history/*.mjs ccd/history/lib.d.mts deploy/*.mjs server/test/history-lib.test.ts server/test/history-recall.test.ts server/test/single-definition.test.ts
grep -c 'stampAtOrBefore' ccd/history/lib.mjs ccd/history/lib.d.mts deploy/*.mjs
```

Expected (measured at `02d75ae5f`):
- 1 for each of the first eight lines;
- 0 in every file for the last two lines (the four new names are free, and `stampAtOrBefore` is spelled in derive.mjs alone).

Then record the base counts. Step 8 compares against them. In the foreground, with a timeout of at least 600000 ms, one suite per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
```

Write each `N passed` (and any `skipped`) into the run's scratch notes, `.superpowers/sdd/history-w2-1/base-counts.txt` (gitignored). Every file must be green at the base. A red file is re-run alone (CLAUDE.md's load flakes) before it is reported.

- [ ] **Step 2: Write the failing tests.** Three appends. Each goes after the file's last line, never above an existing describe.

(a) `server/test/history-lib.test.ts`: append:

```ts

// ── W2-1 Task 1 (W2-D33): stampAtOrBefore, moved from derive.mjs into lib, over plain (rows, index) ────────────
// Pure, so it runs on darwin too. derive.mjs's raw-leaf grace reads it unchanged; W2-2a's as-of cut reads it (W2-D34).
describe('stampAtOrBefore: the newest stamped row at or before an index (W2-D33; W2-1 Task 1)', () => {
  type Stamped = { ts_ms: number | bigint | null };
  const R = (...ts: Array<number | bigint | null>): Stamped[] => ts.map((t) => ({ ts_ms: t }));
  const lib = async () => await import('../../ccd/history/lib.mjs');

  it('answers the stamp of the row at the index when it has one', async () => {
    expect((await lib()).stampAtOrBefore(R(100, 200, 300), 1)).toBe(200);
  });

  it('answers the newest stamp before a row that has none', async () => {
    expect((await lib()).stampAtOrBefore(R(100, null, null, 400), 2)).toBe(100);
  });

  it('never reads a row after the index, so no stamp at or before it is null', async () => {
    expect((await lib()).stampAtOrBefore(R(null, null, 300), 1)).toBeNull();
  });

  it('a stamp of 0 is a time', async () => {
    expect((await lib()).stampAtOrBefore(R(0, null), 1)).toBe(0);
  });

  it('an index the uuid map does not hold is null, and a bigint stamp reads as a number', async () => {
    const l = await lib();
    expect(l.stampAtOrBefore(R(100), undefined), 'derive.mjs passes copy.index.get(uuid), undefined for a uuid the copy does not hold').toBeNull();
    expect(l.stampAtOrBefore(R(7n), 0)).toBe(7);
  });
});
```

(b) `server/test/history-recall.test.ts`: append:

```ts

// ── W2-1 Task 1 (W2-D33): the exports the deploy lane reads ─────────────────────────────────────────────────
// These are recall.mjs expandEntryBody (the body pick expand now reads through), derive.mjs blobReadStmts, bodyOf
// and keptOf, lib.mjs stampAtOrBefore and cli.mjs pairIndexOf. Each is exported so that W2-5a's driver reads a body,
// a kept list and the pair index the way the store's own readers do, with no second decode in deploy/. The cases run
// in-process against one fixture store in the DM2b shape (a ccd-sanitize pair whose sanitised copy is ingested first),
// except the import pin. That one runs in a child, because importing cli.mjs sets the process umask to 0o077 (its
// top-level process.umask call), and this worker's later cases must not inherit it.
describe.skipIf(process.platform === 'darwin')('W2-D33: the exports the deploy lane reads (W2-1 Task 1)', () => {
  const XID = 'claude-a-w2d33';
  const XT = 'a1d33001';
  const XU = t16uuid(XT, 0);
  const x = (i: number): string => t16uuid(XT, i);
  interface PickedBody {
    state: string; body: unknown; primary: unknown; causes: string[];
    blob: { state: string; prunedMs?: number | null; rawLen?: number; bound?: number; bytes?: Uint8Array };
  }
  type Rc = { db: RDatabaseSync; version: number; schema: unknown };
  type Recall = { expandEntryBody(rc: Rc, e: { entry_id: number; blob_id: number }): PickedBody };
  type Derive = {
    blobReadStmts(db: RDatabaseSync): Record<string, unknown>;
    bodyOf(s: Record<string, unknown>, blobId: number, budget: { bytes: number }): unknown;
    keptOf(s: Record<string, unknown>, blobId: number | null, budget: { bytes: number }): Set<string>;
  };
  let box: rH.HistoryBox;
  const writer = (): RDatabaseSync => new RDatabaseSync(libRead.historyPaths(box.home).dbFile);
  const rcOf = (db: RDatabaseSync): Rc => ({
    db, version: Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), schema: libRead.SCHEMA_ADDED,
  });
  const entryOf = (db: RDatabaseSync, uuid: string): { entry_id: number; blob_id: number } =>
    db.prepare('SELECT entry_id, blob_id FROM entries WHERE uuid = ?').get(uuid) as { entry_id: number; blob_id: number };
  /** expandEntryBody over a fresh read handle, closed after: expand's statements are cached per handle. */
  const picked = async (uuid: string): Promise<PickedBody> => {
    const recall = (await import('../../ccd/history/recall.mjs')) as unknown as Recall;
    const db = rH.openStoreRO(box);
    try { return recall.expandEntryBody(rcOf(db), entryOf(db, uuid)); } finally { db.close(); }
  };

  beforeAll(() => {
    box = rH.makeHistoryBox('ccrc-hist-w2d33-');
    const rows = (fill: string): object[] => {
      const a = rFx.toolUseRow({ uuid: x(2), ts: t16ts(2), parentUuid: x(1), sessionId: XU, toolUseId: 'toolu_01W2D33', name: 'Read', input: { file_path: '/home/u/tree/demo/b.md' } });
      const m = a['message'] as { content: unknown[] };
      m.content = [{ type: 'text', text: fill }, ...m.content];
      return [
        rFx.userRow({ uuid: x(1), ts: t16ts(1), sessionId: XU, text: 'zqw2d33 question' }),
        a,
        rFx.boundaryRow({ uuid: x(3), ts: t16ts(3), parentUuid: x(2), sessionId: XU, trigger: 'manual', headUuid: x(2), anchorUuid: x(4),
          tailUuid: x(2), allUuids: [x(1), x(2)] }),
        rFx.summaryRow({ uuid: x(4), ts: t16ts(4), parentUuid: x(3), sessionId: XU, text: t16summary('zqw2d33') }),
      ];
    };
    // The sanitised copy is ingested FIRST, so the entry's primary body is the "..." one (the DM2b case's shape).
    const t = t16seed(box, { id: XID, project: 'demo', generation: '0189abcd-1234-4678-9abc-000000002d33', uuid: XU, rows: rows('...') });
    rH.plantTranscript(box, 'claude-b', path.basename(path.dirname(t)), XU, rows(''));
    t16scan(box);
  }, 3 * HEAVY);

  it('expandEntryBody picks the unsanitised ccd-sanitize variant, and expand prints exactly its rendering', async () => {
    const k = await picked(x(2));
    expect(k.state).toBe('body');
    expect((k.primary as Array<{ text?: string }>)[0]!.text, 'CONTROL: the primary is the sanitised copy, ingested first').toBe('...');
    expect((k.body as Array<{ text?: string }>)[0]!.text, 'the body is the unsanitised side').toBe('');
    expect(k.causes).toEqual(['ccd-sanitize']);
    expect(k.blob.state).toBe('bytes');
    const j = rH.runCli(box, ['expand', x(2), '--json'], { env: rH.withPane(box, XID) });
    expect(j.code, j.stderr).toBe(0);
    const item = t16items(j)[0]!;
    expect(item.text).toBe('\n[tool_use Read] {"file_path":"/home/u/tree/demo/b.md"}');
    expect(libRead.renderEntryText(k.body), 'expand prints the rendering of the body the helper picked').toBe(item.text);
    expect(item.variants).toEqual(k.causes.map((cause) => ({ cause })));
  }, HEAVY);

  it('expandEntryBody tells five states apart and hands back the expandBlob answer', async () => {
    const w = writer();
    const e1 = entryOf(w, x(1));
    const orig = w.prepare('SELECT z, raw_len, pruned_ms FROM blobs WHERE blob_id = ?').get(e1.blob_id) as { z: Uint8Array; raw_len: number; pruned_ms: number | null };
    const putBack = (): void => { w.prepare('UPDATE blobs SET z = ?, raw_len = ?, pruned_ms = ? WHERE blob_id = ?').run(orig.z, orig.raw_len, orig.pruned_ms, e1.blob_id); };
    const stored = (text: string): void => {
      const bytes = Buffer.from(text, 'utf8');
      w.prepare('UPDATE blobs SET z = ?, raw_len = ? WHERE blob_id = ?').run(t16brotliCompress(bytes), bytes.length, e1.blob_id);
    };
    const shape = (k: PickedBody): object => ({ state: k.state, body: k.body, primary: k.primary, causes: k.causes, blob: k.blob.state === 'bytes' ? 'bytes' : k.blob });
    const PRUNED = Date.UTC(2026, 0, 2);
    try {
      const live = await picked(x(1));
      expect([live.state, live.causes, live.blob.state], 'CONTROL: over its live primary the body parses').toEqual(['body', [], 'bytes']);
      const arms: Array<{ arm: string; set: () => void; want: object }> = [
        { arm: 'pruned', set: () => { w.prepare('UPDATE blobs SET z = NULL, pruned_ms = ? WHERE blob_id = ?').run(PRUNED, e1.blob_id); },
          want: { state: 'tombstone', body: null, primary: null, causes: [], blob: { state: 'pruned', prunedMs: PRUNED } } },
        { arm: 'over the decode cap', set: () => { w.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = ?').run(libRead.BLOB_DECODE_MAX + 1, e1.blob_id); },
          want: { state: 'over-cap', body: null, primary: null, causes: [], blob: { state: 'too-large', rawLen: libRead.BLOB_DECODE_MAX + 1, bound: libRead.BLOB_DECODE_MAX } } },
        { arm: 'over the expand bound', set: () => { w.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = ?').run(libRead.SIDECAR_WHOLE_MAX + 1, e1.blob_id); },
          want: { state: 'over-cap', body: null, primary: null, causes: [], blob: { state: 'too-large', rawLen: libRead.SIDECAR_WHOLE_MAX + 1 } } },
        { arm: 'undecodable', set: () => { w.prepare('UPDATE blobs SET z = NULL WHERE blob_id = ?').run(e1.blob_id); },
          want: { state: 'undecodable', body: null, primary: null, causes: [], blob: { state: 'undecodable', rawLen: Number(orig.raw_len) } } },
        { arm: 'not JSON', set: () => { stored('zq not json {'); },
          want: { state: 'unparseable', body: 'zq not json {', primary: 'zq not json {', causes: [], blob: 'bytes' } },
        { arm: 'a JSON string', set: () => { stored('"zq a json string"'); },
          want: { state: 'body', body: 'zq a json string', primary: 'zq a json string', causes: [], blob: 'bytes' } },
      ];
      for (const a of arms) {
        putBack();
        a.set();
        expect(shape(await picked(x(1))), a.arm).toEqual(a.want);
      }
    } finally {
      putBack();
      w.close();
    }
  }, HEAVY);

  it('blobReadStmts prepares the two blob reads, and bodyOf over them tells a tombstone from an empty kept list', async () => {
    const D = (await import('../../ccd/history/derive.mjs')) as unknown as Derive;
    const keptId = (db: RDatabaseSync): number | null => (db.prepare(`SELECT b.kept_blob_id AS k FROM boundaries b
      JOIN entries e ON e.entry_id = b.entry_id WHERE e.uuid = ?`).get(x(3)) as { k: number | null }).k;
    const read = (): { body: unknown; kept: string[]; none: number; bytes: number } => {
      const db = rH.openStoreRO(box);
      try {
        const s = D.blobReadStmts(db);
        expect(Object.keys(s).sort(), 'exactly the two blob reads').toEqual(['blobLen', 'blobZ']);
        const id = keptId(db);
        expect(id, 'CONTROL: the boundary stored its kept list').not.toBeNull();
        const budget = { bytes: 0 };
        const body = D.bodyOf(s, id!, budget);
        return { body, kept: [...D.keptOf(s, id, { bytes: 0 })], none: D.keptOf(s, null, { bytes: 0 }).size, bytes: budget.bytes };
      } finally { db.close(); }
    };
    const live = read();
    expect(live.body).toEqual([x(1), x(2)]);
    expect(live.kept).toEqual([x(1), x(2)]);
    expect(live.bytes, 'bodyOf charges the compressed bytes it read to the budget').toBeGreaterThan(0);
    expect(live.none, 'CONTROL (W2-D68): keptOf answers an empty set for a NULL id').toBe(0);
    const w = writer();
    const id = keptId(w)!;
    const orig = w.prepare('SELECT z, pruned_ms FROM blobs WHERE blob_id = ?').get(id) as { z: Uint8Array; pruned_ms: number | null };
    try {
      w.prepare('UPDATE blobs SET z = NULL, pruned_ms = ? WHERE blob_id = ?').run(Date.UTC(2026, 0, 2), id);
      const gone = read();
      expect(gone.body, 'bodyOf answers null for a tombstoned kept list').toBeNull();
      expect(gone.kept, 'keptOf folds it into the empty set a NULL id answers, which is why deploy/ never calls keptOf (W2-D68)').toEqual([]);
    } finally {
      w.prepare('UPDATE blobs SET z = ?, pruned_ms = ? WHERE blob_id = ?').run(orig.z, orig.pruned_ms, id);
      w.close();
    }
  }, HEAVY);

  it('the deploy lane imports each export by name, and importing cli.mjs sets umask 0o077 without running main', () => {
    const url = (f: string): string => pathToFileURL(path.join(REPO, 'ccd', 'history', f)).href;
    const code = [
      'process.umask(0o022);',
      `const lib = await import(${JSON.stringify(url('lib.mjs'))});`,
      `const derive = await import(${JSON.stringify(url('derive.mjs'))});`,
      `const recall = await import(${JSON.stringify(url('recall.mjs'))});`,
      `const cli = await import(${JSON.stringify(url('cli.mjs'))});`,
      'const umask = process.umask(0o022);',
      'console.log(JSON.stringify({ umask, kinds: [typeof lib.stampAtOrBefore, typeof derive.blobReadStmts, typeof derive.bodyOf,',
      '  typeof derive.keptOf, typeof recall.expandEntryBody, typeof cli.pairIndexOf] }));',
    ].join('\n');
    // No argument after the script, so process.argv[1] is undefined and cli.mjs's entry guard is false.
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { encoding: 'utf8', env: box.env, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines, 'main did not run: stdout is the child line alone').toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ umask: 0o077, kinds: Array(6).fill('function') });
  });
});
```

(c) `server/test/single-definition.test.ts`: append:

```ts

// W2-1 Task 1 (W2-D33): the exports the deploy lane reads are each defined once. APPENDED after the last describe, for
// the reason the CCRC HISTORY block above states; no import line is added. ALL_MJS, HISTORY_DIR, stallCode and rel are
// that block's.
describe('ccrc history: the deploy lane exports are each defined once (W2-D33; W2-1 Task 1)', () => {
  const DEFINES = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\s*\\(`);
  const definers = (name: string): string[] =>
    ALL_MJS.filter((f) => stallCode(f).split('\n').some((l) => DEFINES(name).test(l))).map(rel).sort();
  /** The body of the function whose head line `head` matches: from that line to the first line that is exactly `}`. */
  const bodyOfFn = (src: string, head: RegExp): string => {
    const lines = src.split('\n');
    const at = lines.findIndex((l) => head.test(l));
    if (at < 0) return '';
    const end = lines.findIndex((l, i) => i > at && l === '}');
    return lines.slice(at, end + 1).join('\n');
  };
  const DERIVE = path.join(HISTORY_DIR, 'derive.mjs');
  const RECALL = path.join(HISTORY_DIR, 'recall.mjs');
  const BLOB_SQL = ["'SELECT z FROM blobs WHERE blob_id = ?'", "'SELECT raw_len FROM blobs WHERE blob_id = ?'"] as const;

  it('CONTROL: the definition pattern sees a declaration, exported or not, and never a call or an import', () => {
    expect(DEFINES('stampAtOrBefore').test('export function stampAtOrBefore(rows, index) {')).toBe(true);
    expect(DEFINES('stampAtOrBefore').test('function stampAtOrBefore(copy, uuid) {')).toBe(true);
    expect(DEFINES('stampAtOrBefore').test('    fileAtEofAfterBoundary: eofAfterBoundary({ eofMs: holding.eof_ms, boundaryTsMs: stampAtOrBefore(copy.rows, copy.index.get(b.uuid)) }),')).toBe(false);
    expect(DEFINES('stampAtOrBefore').test('  secretUnits, summaryParts, stampAtOrBefore,')).toBe(false);
    expect(bodyOfFn('x\nfunction f(a) {\n  return a;\n}\ny', /^function f\(/)).toBe('function f(a) {\n  return a;\n}');
    expect(bodyOfFn('x\n', /^function f\(/), 'an absent head reads as no body').toBe('');
  });

  it('stampAtOrBefore is defined in lib.mjs alone, and derive.mjs imports it from lib', () => {
    expect(definers('stampAtOrBefore')).toEqual(['ccd/history/lib.mjs']);
    const block = /^import \{\n([^}]*)\} from '\.\/lib\.mjs';$/m.exec(stallCode(DERIVE));
    expect(block, 'derive.mjs has no multi-line named import from ./lib.mjs').not.toBeNull();
    expect(block![1]!.split(',').map((s) => s.trim())).toContain('stampAtOrBefore');
  });

  it('each blob SELECT is spelled once in shipped code, inside blobReadStmts, and stmts takes both from it', () => {
    for (const sql of BLOB_SQL) {
      expect(ALL_MJS.filter((f) => stallCode(f).includes(sql)).map(rel), sql).toEqual(['ccd/history/derive.mjs']);
      expect(stallCode(DERIVE).split(sql).length - 1, `${sql}: spelled more than once in derive.mjs`).toBe(1);
    }
    const reads = bodyOfFn(stallCode(DERIVE), /^export function blobReadStmts\(db\) \{$/);
    for (const sql of BLOB_SQL) expect(reads, `${sql} is not in blobReadStmts`).toContain(sql);
    expect((reads.match(/\.prepare\(/g) ?? []).length, 'blobReadStmts prepares exactly the two blob reads').toBe(2);
    expect(bodyOfFn(stallCode(DERIVE), /^function stmts\(db\) \{$/)).toContain('...blobReadStmts(db),');
  });

  it('pickExpandBody is called once in shipped code, by expandEntryBody, and expandEntryText reads through expandEntryBody', () => {
    const calls = ALL_MJS.flatMap((f) => stallCode(f).split('\n')
      .filter((l) => /\bpickExpandBody\(/.test(l) && !DEFINES('pickExpandBody').test(l)).map(() => rel(f)));
    expect(calls).toEqual(['ccd/history/recall.mjs']);
    const src = stallCode(RECALL);
    expect(bodyOfFn(src, /^export function expandEntryBody\(rc, e\) \{$/)).toMatch(/\bpickExpandBody\(/);
    const text = bodyOfFn(src, /^function expandEntryText\(rc, e\) \{$/);
    expect(text, 'expandEntryText is gone or its signature moved').not.toBe('');
    expect(text).toContain('expandEntryBody(rc, e)');
    expect(text, 'expandEntryText decodes no blob of its own').not.toMatch(/\bexpandBlob\(|\bexpandParse\(/);
  });
});
```

The names used here are already in scope in each file. history-recall imports `spawnSync`, `pathToFileURL`, `path`, `RDatabaseSync`, `libRead`, `rH`, `rFx`, `REPO` and `t16brotliCompress` at its head. single-definition defines `ALL_MJS`, `HISTORY_DIR`, `stallCode`, `rel` and `path` above its CCRC HISTORY block. No import line is added to any file.

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms, one suite per tool call. First list what each filter selects:

```bash
(cd server && ./node_modules/.bin/vitest list test/history-lib.test.ts -t 'stampAtOrBefore: the newest stamped row')
(cd server && ./node_modules/.bin/vitest list test/history-recall.test.ts -t 'W2-D33: the exports the deploy lane reads')
(cd server && ./node_modules/.bin/vitest list test/single-definition.test.ts -t 'the deploy lane exports are each defined once')
```

Expected: 5, 4 and 4 tests. Then run them:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'stampAtOrBefore: the newest stamped row')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-D33: the exports the deploy lane reads')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the deploy lane exports are each defined once')
```

Expected (predicted, written before the code):
- history-lib: `5 failed`, each `TypeError: …stampAtOrBefore is not a function`.
- history-recall: `4 failed`.
  - (a) and (b): `recall.expandEntryBody is not a function`.
  - (c): `D.blobReadStmts is not a function`.
  - The import pin: `{ umask: 63, kinds: [ 'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined' ] }` against six `'function'`. The umask half is already green at the base, because cli.mjs already sets it.
- single-definition: `3 failed | 1 passed`. The CONTROL passes.
  - `stampAtOrBefore …`: `[ 'ccd/history/derive.mjs' ]` against `[ 'ccd/history/lib.mjs' ]`.
  - `each blob SELECT …`: `blobReadStmts`' body reads as `''`, so `toContain` fails on the first SQL.
  - `pickExpandBody …`: the call census passes (`['ccd/history/recall.mjs']`), but `expandEntryBody`'s body reads as `''`.

- [ ] **Step 4: Write the code.** From the repository root, run this script. Each replacement asserts its anchor occurs exactly once. The python body is a quoted heredoc, and every block is a raw string.

```bash
python3 - . <<'PYEOF'
import sys
ROOT = sys.argv[1]
def rep(rel, old, new):
    p = f'{ROOT}/{rel}'
    s = open(p).read()
    assert s.count(old) == 1, (rel, old[:80], s.count(old))
    open(p, 'w').write(s.replace(old, new))

# lib.mjs: stampAtOrBefore, moved, directly above eofAfterBoundary's doc comment.
rep('ccd/history/lib.mjs',
r"""/** Whether the file holding a boundary was read to its end late enough to say its summary row is missing. `eofMs`
""",
r"""/** The newest stamped row's time at or before row `index` of `rows`, in the order `rows` holds (a copy's file
 *  order): row `index`'s own time when it has one, and a stamp of 0 is a time. Null when no row up to it has one,
 *  and when `index` is undefined (derive.mjs passes what a copy's uuid map answers). Otherwise `index` is at most
 *  `rows.length - 1`. Moved from derive.mjs, where it was private (W2-D33), so that W2-2a's as-of cut (W2-D34) reads
 *  the one definition: lib cannot import derive.mjs, which imports lib. lib's raw-leaf grace reads it through
 *  derive.mjs (D-4690 (history-raw-leaf-grace)). */
export function stampAtOrBefore(rows, index) {
  for (let i = index; i >= 0; i -= 1) {
    const t = rows[i].ts_ms;
    if (t !== null) return Number(t);
  }
  return null;
}

/** Whether the file holding a boundary was read to its end late enough to say its summary row is missing. `eofMs`
""")

# lib.d.mts: its one declaration, directly after eofAfterBoundary's.
rep('ccd/history/lib.d.mts',
r"""export function eofAfterBoundary(i: { eofMs: number | null; boundaryTsMs: number | null }): boolean;
""",
r"""export function eofAfterBoundary(i: { eofMs: number | null; boundaryTsMs: number | null }): boolean;
/** W2-D33: moved from derive.mjs. Null for an undefined index, or when no row up to it has a stamp. */
export function stampAtOrBefore(rows: readonly { readonly ts_ms: number | bigint | null }[], index: number | undefined): number | null;
""")

# derive.mjs: import it from lib; blobReadStmts; stmts takes the two reads from it; bodyOf and keptOf exported;
# the private stampAtOrBefore removed, and its one caller passing plain (rows, index).
rep('ccd/history/derive.mjs',
r"""  secretUnits, summaryParts, summaryRowFor, withinBudget, BELT_NODES_STEP, REPARSE_MAX_TARGETS, topicsOfColumn,
} from './lib.mjs';""",
r"""  secretUnits, summaryParts, summaryRowFor, withinBudget, BELT_NODES_STEP, REPARSE_MAX_TARGETS, topicsOfColumn, stampAtOrBefore,
} from './lib.mjs';""")
rep('ccd/history/derive.mjs',
r"""/** The prepared statements, one set per connection. Each names its columns. A row's copies are found through
""",
r"""/** W2-D33: the two blob reads, prepared on `db`. `blobZ` reads the stored z, and its SQL is the text Task 21's fault
 *  seam matches (preload-faults' HISTORY_TEST_THROW_BLOB); `blobLen` reads the raw_len B1's decode bound needs.
 *  stmts(db) takes both from here, and the deploy lane's driver calls bodyOf(blobReadStmts(db), blobId, budget), so
 *  each SQL text is spelled once. Not cached: stmts keeps its own set per connection, and a caller that reads many
 *  blobs keeps this answer. */
export function blobReadStmts(db) {
  return {
    blobZ: db.prepare('SELECT z FROM blobs WHERE blob_id = ?'),
    blobLen: db.prepare('SELECT raw_len FROM blobs WHERE blob_id = ?'),
  };
}

/** The prepared statements, one set per connection. Each names its columns. A row's copies are found through
""")
rep('ccd/history/derive.mjs',
r"""    blobZ: db.prepare('SELECT z FROM blobs WHERE blob_id = ?'),
    blobLen: db.prepare('SELECT raw_len FROM blobs WHERE blob_id = ?'),
    paths: """,
r"""    ...blobReadStmts(db),
    paths: """)
rep('ccd/history/derive.mjs',
r""" *  byte budget, as the FTS backfill's do. */
function bodyOf(s, blobId, budget) {""",
r""" *  byte budget, as the FTS backfill's do. Exported for the deploy lane (W2-D33): its driver passes blobReadStmts(db)
 *  as `s` and a `{ bytes }` object as `budget`. Its null still folds no row, a tombstone or a damaged blob, a body that
 *  is not JSON or is JSON null, and an over-cap body alike. */
export function bodyOf(s, blobId, budget) {""")
rep('ccd/history/derive.mjs',
r"""/** A boundary's kept list (preservedMessages.allUuids, stored as its own blob by B1's ingest), as a set. */
function keptOf(s, blobId, budget) {""",
r"""/** A boundary's kept list (preservedMessages.allUuids, stored as its own blob by B1's ingest), as a set. Exported
 *  for the deploy lane (W2-D33), which never calls it (W2-D68): a NULL id, a tombstone and a body that is not an
 *  array all answer an empty set here, so the driver reads the kept blob through bodyOf and tells them apart. */
export function keptOf(s, blobId, budget) {""")
rep('ccd/history/derive.mjs',
r"""/** The newest stamped row's time at or before `uuid` in the copy's file order: the boundary's own time when it has
 *  one. lib's raw-leaf grace reads it (D-4690 (history-raw-leaf-grace)); null only when no row up to it has a time. */
function stampAtOrBefore(copy, uuid) {
  for (let i = copy.index.get(uuid); i >= 0; i -= 1) {
    const t = copy.rows[i].ts_ms;
    if (t !== null) return Number(t);
  }
  return null;
}

""",
"")
rep('ccd/history/derive.mjs',
r"""boundaryTsMs: stampAtOrBefore(copy, b.uuid) }),""",
r"""boundaryTsMs: stampAtOrBefore(copy.rows, copy.index.get(b.uuid)) }),""")

# recall.mjs: expandParseMeasured, expandEntryBody, and expandEntryText reading through it.
rep('ccd/history/recall.mjs',
r""" *  never parsed: its text is shown as stored. */
function expandParse(bytes) {
  const text = bytes.toString('utf8');
  if (!xlib.jsonWithinStructureBound(bytes)) return text;
  try { return JSON.parse(text); } catch { return text; }
}
""",
r""" *  never parsed: its text is shown as stored. expandParseMeasured says which it was: `parsed` is false for that text,
 *  so a stored body that is itself a JSON string (parsed, and a string) is never read as one that did not parse. */
function expandParseMeasured(bytes) {
  const text = bytes.toString('utf8');
  if (!xlib.jsonWithinStructureBound(bytes)) return { parsed: false, value: text };
  try { return { parsed: true, value: JSON.parse(text) }; } catch { return { parsed: false, value: text }; }
}

function expandParse(bytes) {
  return expandParseMeasured(bytes).value;
}

/** W2-D33: an entry's body as expand picks it, read by expandEntryText and by the deploy lane's driver (W2-5a's
 *  mining and payload, W2-D65 and W2-D74), so that deploy/ holds no second decode. `rc` needs only
 *  `{ db, version, schema }`: a read handle (store.mjs openReader), its user_version and SCHEMA_ADDED, at which the
 *  statements' columns are read (DM44). `e` needs only `{ entry_id, blob_id }`. Answers
 *  `{ state, body, primary, causes, blob }`:
 *  - 'body': the primary parsed as JSON. `body` is lib's pickExpandBody over the primary and the entry's decodable
 *    ccd-sanitize variants (the unsanitised side, DM2b), and `primary` is the parsed primary;
 *  - 'unparseable': the primary decoded, but is past B1's structure bound or is not JSON. `body` and `primary` are
 *    its text (lib's variantCauseOf reads arrays, so no variant is picked over a text);
 *  - 'tombstone' (pruned_ms set, or no blob row), 'over-cap' (past expandBlobFits or B1's decode cap) and
 *    'undecodable' (a NULL z with no pruned_ms, or bytes that do not decompress): `body` and `primary` are null.
 *    Five words, not four: a damaged blob is not a pruned one (expandBlob's rule), and a caller counts them apart
 *    (D-6238 (history-expand-body-five-states)).
 *  `causes` is every variant row's cause but the primary blob's own. `blob` is expandBlob's own answer for the
 *  primary, untouched, so expandEntryText keeps its words, the pruned date, raw_len and the bound. */
export function expandEntryBody(rc, e) {
  const s = expandStmts(rc);
  // The variant rows are read before the primary's bytes, so every answer names them: a pruned, too-large or undecodable
  // primary still lists its entry's variants and their true count (D-4596 (history-read-fixed-fields-fit-the-cap)).
  const rows = s.variants.all(e.entry_id).filter((v) => v.blob_id !== e.blob_id);
  const p = expandBlob(s, e.blob_id, false);
  if (p.state !== 'bytes') {
    const state = p.state === 'pruned' ? 'tombstone' : p.state === 'too-large' ? 'over-cap' : 'undecodable';
    return { state, body: null, primary: null, causes: rows.map((v) => v.cause), blob: p };
  }
  const m = expandParseMeasured(p.bytes);
  const primary = m.value;
  const others = [];
  for (const v of rows.filter((x) => x.cause === 'ccd-sanitize')) {
    const vb = expandBlob(s, v.blob_id, false);
    if (vb.state === 'bytes') others.push({ body: expandParse(vb.bytes), cause: v.cause });
  }
  const body = others.length === 0 ? primary : xlib.pickExpandBody({ primary, variants: others });
  return { state: m.parsed ? 'body' : 'unparseable', body, primary, causes: rows.map((v) => v.cause), blob: p };
}
""")
rep('ccd/history/recall.mjs',
r""" *  unsanitised variant when the pair is ccd's own (DM2b), a tombstone as `pruned`. */
function expandEntryText(rc, s, e) {
  // The variant rows are read before the primary's bytes, so every answer names them: a pruned, too-large or undecodable
  // primary still lists its entry's variants and their true count (D-4596 (history-read-fixed-fields-fit-the-cap)).
  const rows = s.variants.all(e.entry_id).filter((v) => v.blob_id !== e.blob_id);
  const p = expandBlob(s, e.blob_id, false);
  if (p.state !== 'bytes') return { ...p, causes: rows.map((v) => v.cause) };
  const primary = expandParse(p.bytes);
  const others = [];
  for (const v of rows.filter((x) => x.cause === 'ccd-sanitize')) {
    const vb = expandBlob(s, v.blob_id, false);
    if (vb.state === 'bytes') others.push({ body: expandParse(vb.bytes), cause: v.cause });
  }
  const body = others.length === 0 ? primary : xlib.pickExpandBody({ primary, variants: others });
  let text;
  try {
    text = xlib.renderEntryText(body);
""",
r""" *  unsanitised variant when the pair is ccd's own (DM2b), a tombstone as `pruned`. The body is expandEntryBody's
 *  (W2-D33), and a primary that is not bytes keeps expandBlob's own words, its pruned date, raw_len and bound. */
function expandEntryText(rc, e) {
  const k = expandEntryBody(rc, e);
  if (k.blob.state !== 'bytes') return { ...k.blob, causes: k.causes };
  let text;
  try {
    text = xlib.renderEntryText(k.body);
""")
rep('ccd/history/recall.mjs',
r"""    text = p.bytes.toString('utf8');
  }
  return { state: 'text', text, causes: rows.map((v) => v.cause), primary };
}""",
r"""    text = k.blob.bytes.toString('utf8');
  }
  return { state: 'text', text, causes: k.causes, primary: k.primary };
}""")
rep('ccd/history/recall.mjs',
r"""  const t = isEntry ? expandEntryText(rc, s, e) : expandSidecarText(rc, s, it.blobId);""",
r"""  const t = isEntry ? expandEntryText(rc, e) : expandSidecarText(rc, s, it.blobId);""")

# cli.mjs: an in-place export on pairIndexOf.
rep('ccd/history/cli.mjs',
r""" *  (never an import(): B1's ring census refuses one in a shipped module); Task 19's operator relay reuses this index. */
function pairIndexOf(db, home) {""",
r""" *  (never an import(): B1's ring census refuses one in a shipped module); Task 19's operator relay reuses this index.
 *  Exported for the deploy lane (W2-D33): W2-5a builds its run's index once through it (W2-D54, W2-D67). Importing
 *  this module sets the process umask to 0o077 and loads sweep.mjs, recall.mjs and store.mjs; main runs only behind
 *  the entry guard, this file's last statement. */
export function pairIndexOf(db, home) {""")
print('step 4: every anchor matched once')
PYEOF
node --check ccd/history/lib.mjs && node --check ccd/history/derive.mjs && node --check ccd/history/recall.mjs && node --check ccd/history/cli.mjs && echo 'syntax ok'
grep -c '^export function stampAtOrBefore(' ccd/history/lib.d.mts
grep -c 'stampAtOrBefore' ccd/history/derive.mjs
```

Expected:
- `step 4: every anchor matched once` and `syntax ok`. This was measured on a copy of `02d75ae5f`'s five files.
- `1`: one declaration in `lib.d.mts`. `skipLibCheck` hides a duplicate, so count it.
- `2` in derive.mjs: the import line and the one call.

No added line holds a numeric line citation (`citations.test.ts`' added-lines rule; measured over this script's diff).

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'stampAtOrBefore: the newest stamped row')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-D33: the exports the deploy lane reads')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the deploy lane exports are each defined once')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'DM2b: a ccd-sanitize variant pair prints the unsanitised body')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'still lists its variants and their true count')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a row nested past JSON')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- `5 passed`, `4 passed` and `4 passed` for the new describes.
- The three existing expand cases, each `1 passed`. These are expand's ccd-sanitize pick, D-4596's variant list over a pruned, too-large or undecodable primary, and the RangeError fallback that now reads `k.blob.bytes`. Each was green at the base and pins one arm of `expandEntryText` that this task re-routes.
- tsc: no line names a file this task touched. A line that names only `agent/src/` (the `ws` module) or `test/workflow-yaml-parses.test.ts` (the `yaml` module) comes from the worktree's install, not from this task.

The import pin's output was measured outside vitest on a copy of the edited tree: `{"umask":63,"kinds":["function","function","function","function","function","function"]}`, one line.

- [ ] **Step 6: Prove the moved function answers what the private one answered.** This is the output-identity check. It runs BEFORE the commit, so `HEAD` is still the base and `git show HEAD:ccd/history/derive.mjs` holds the private function. From the repository root:

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-1/scratch"; mkdir -p "$SCRATCH"
cat > "$SCRATCH/stamp-identity.mjs" <<'EOF'
// Scratch, never committed: the moved stampAtOrBefore against the private one it replaced, read from HEAD (the base).
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const src = execFileSync('git', ['show', 'HEAD:ccd/history/derive.mjs'], { encoding: 'utf8' });
const m = /\nfunction stampAtOrBefore\(copy, uuid\) \{\n[\s\S]*?\n\}\n/.exec(src);
if (m === null) throw new Error('HEAD:ccd/history/derive.mjs holds no private stampAtOrBefore: HEAD is not the base');
const old = new Function(`${m[0]}; return stampAtOrBefore;`)();
const { stampAtOrBefore } = await import(pathToFileURL(path.resolve('ccd/history/lib.mjs')).href);
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let n = 0;
let nulls = 0;
for (let k = 0; k < 2000; k += 1) {
  const rows = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, i) => ({ uuid: `u${i}`, ts_ms: rnd() < 0.4 ? null : (rnd() < 0.05 ? 0 : Math.floor(rnd() * 1e6)) }));
  const index = new Map(rows.map((r, i) => [r.uuid, i]));
  for (const u of [...index.keys(), 'absent']) {
    const a = old({ rows, index }, u);
    const b = stampAtOrBefore(rows, index.get(u));
    if (a !== b) { console.log('DIFF', JSON.stringify({ rows, u, a, b })); process.exit(1); }
    n += 1;
    if (a === null) nulls += 1;
  }
}
console.log('identical over', n, 'calls,', nulls, 'of them null');
EOF
node "$SCRATCH/stamp-identity.mjs"
```

Expected: `identical over 15014 calls, 3317 of them null`. This was measured with the same generator, over `02d75ae5f`'s private function and the body Step 4 writes. Every list holds at least one stamp of 0 or null, and each one's uuid map is probed with one uuid it does not hold.

The other moves have no second body to compare against: `bodyOf`, `keptOf` and `pairIndexOf` change only by `export`, `stmts` by a spread of the same two prepares, and `expandEntryText` by a call to the body it held. Their identity is the suites whose cases pin those outputs exactly: expand's text, causes, words and pages; the leaves' content-derived ids, their gists and the raw-leaf grace in history-derive; derive's slot lists in history-card. Step 8 re-runs each of them against Step 1's counts.

- [ ] **Step 7: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement (or two), asserted to match once, runs its filters and shows red, then restores the file with `cp`. A red at a CONTROL is the fixture's to fix, never the guard's to weaken.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-1/scratch"; mkdir -p "$SCRATCH"
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
cp ccd/history/derive.mjs "$SCRATCH/derive.orig"
cp ccd/history/recall.mjs "$SCRATCH/recall.orig"
cp ccd/history/cli.mjs "$SCRATCH/cli.orig"
LIB_T='stampAtOrBefore: the newest stamped row'
REC_T='W2-D33: the exports the deploy lane reads'
SD_T='the deploy lane exports are each defined once'

# M1: a stamp of 0 read as no stamp.
mut ccd/history/lib.mjs '    if (t !== null) return Number(t);' '    if (t) return Number(t);'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'a stamp of 0 is a time')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): expected null to be +0.

# M2: the row at the index skipped.
mut ccd/history/lib.mjs '  for (let i = index; i >= 0; i -= 1) {' '  for (let i = index - 1; i >= 0; i -= 1) {'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 2 failed | 3 passed: the stamp of the row at the index, expected 100 to be 200, and the
# bigint case, whose `R(7n), 0` starts below row 0 and reads nothing, expected null to be 7.

# M3: a row after the index read.
mut ccd/history/lib.mjs '  for (let i = index; i >= 0; i -= 1) {' '  for (let i = rows.length - 1; i >= 0; i -= 1) {'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 4 failed | 1 passed (300 for 200, 400 for 100, 300 for null, 100 for null); the stamp-0 case stays green.

# M4: the move undone. derive.mjs keeps a private copy again, and every derive suite would stay green.
mut ccd/history/derive.mjs '  secretUnits, summaryParts, summaryRowFor, withinBudget, BELT_NODES_STEP, REPARSE_MAX_TARGETS, topicsOfColumn, stampAtOrBefore,' '  secretUnits, summaryParts, summaryRowFor, withinBudget, BELT_NODES_STEP, REPARSE_MAX_TARGETS, topicsOfColumn,'
mut ccd/history/derive.mjs 'function copyPlan(s, pass, fileId, budget) {' 'function stampAtOrBefore(copy, uuid) {
  for (let i = copy.index.get(uuid); i >= 0; i -= 1) {
    const t = copy.rows[i].ts_ms;
    if (t !== null) return Number(t);
  }
  return null;
}

function copyPlan(s, pass, fileId, budget) {'
mut ccd/history/derive.mjs 'boundaryTsMs: stampAtOrBefore(copy.rows, copy.index.get(b.uuid)) }),' 'boundaryTsMs: stampAtOrBefore(copy, b.uuid) }),'
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'stampAtOrBefore is defined in lib')
cp "$SCRATCH/derive.orig" ccd/history/derive.mjs
# Expected RED (predicted): [ 'ccd/history/derive.mjs', 'ccd/history/lib.mjs' ] against [ 'ccd/history/lib.mjs' ].

# M5: stmts spells the two blob reads again.
mut ccd/history/derive.mjs '    ...blobReadStmts(db),' "    blobZ: db.prepare('SELECT z FROM blobs WHERE blob_id = ?'),
    blobLen: db.prepare('SELECT raw_len FROM blobs WHERE blob_id = ?'),"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'each blob SELECT is spelled once')
cp "$SCRATCH/derive.orig" ccd/history/derive.mjs
# Expected RED (predicted): spelled more than once in derive.mjs, expected 2 to be 1.

# M6: blobReadStmts prepares a third statement.
mut ccd/history/derive.mjs "    blobLen: db.prepare('SELECT raw_len FROM blobs WHERE blob_id = ?'),
  };" "    blobLen: db.prepare('SELECT raw_len FROM blobs WHERE blob_id = ?'),
    blobPruned: db.prepare('SELECT pruned_ms FROM blobs WHERE blob_id = ?'),
  };"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'each blob SELECT is spelled once')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'blobReadStmts prepares the two blob reads')
cp "$SCRATCH/derive.orig" ccd/history/derive.mjs
# Expected RED (predicted): expected 3 to be 2; and [ 'blobLen', 'blobPruned', 'blobZ' ] against [ 'blobLen', 'blobZ' ].

# M7: the helper returns the primary, never the pick. expand reads through it, so the existing DM2b case reds too.
mut ccd/history/recall.mjs '  const body = others.length === 0 ? primary : xlib.pickExpandBody({ primary, variants: others });' '  const body = primary;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'expandEntryBody picks the unsanitised')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'DM2b: a ccd-sanitize variant pair prints the unsanitised body')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'pickExpandBody is called once')
cp "$SCRATCH/recall.orig" ccd/history/recall.mjs
# Expected RED (predicted): the body is the unsanitised side, expected '...' to be ''; DM2b's item.text gains the '...' block;
# the call census is [] against [ 'ccd/history/recall.mjs' ].

# M8: undecodable folded into tombstone.
mut ccd/history/recall.mjs "p.state === 'too-large' ? 'over-cap' : 'undecodable';" "p.state === 'too-large' ? 'over-cap' : 'tombstone';"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'expandEntryBody tells five states apart')
cp "$SCRATCH/recall.orig" ccd/history/recall.mjs
# Expected RED (predicted): the undecodable arm, state 'tombstone' against 'undecodable'.

# M9: the state read from the value's type, so a stored JSON string reads as unparseable.
mut ccd/history/recall.mjs "state: m.parsed ? 'body' : 'unparseable'," "state: typeof primary === 'string' ? 'unparseable' : 'body',"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'expandEntryBody tells five states apart')
cp "$SCRATCH/recall.orig" ccd/history/recall.mjs
# Expected RED (predicted): the a-JSON-string arm, state 'unparseable' against 'body'.

# M10: the variant causes dropped for a primary that is not bytes (D-4596, now inside the helper).
mut ccd/history/recall.mjs '    return { state, body: null, primary: null, causes: rows.map((v) => v.cause), blob: p };' '    return { state, body: null, primary: null, causes: [], blob: p };'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'still lists its variants and their true count')
cp "$SCRATCH/recall.orig" ccd/history/recall.mjs
# Expected RED (predicted): pruned: --json lists the variant and its true count, [ [], 0 ] against [ [ { cause: 'zqvarcause' } ], 1 ].

# M11: expandEntryText decodes a blob of its own again.
mut ccd/history/recall.mjs '  const k = expandEntryBody(rc, e);' '  if (e.blob_id === null) return expandBlob(expandStmts(rc), e.blob_id, false);
  const k = expandEntryBody(rc, e);'
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'pickExpandBody is called once')
cp "$SCRATCH/recall.orig" ccd/history/recall.mjs
# Expected RED (predicted): expandEntryText decodes no blob of its own.

# M12: each export removed in turn. The import pin reds on each; the in-process cases red where they call it.
for pair in 'ccd/history/recall.mjs|export function expandEntryBody(rc, e) {' 'ccd/history/derive.mjs|export function blobReadStmts(db) {' \
            'ccd/history/derive.mjs|export function bodyOf(s, blobId, budget) {' 'ccd/history/derive.mjs|export function keptOf(s, blobId, budget) {' \
            'ccd/history/cli.mjs|export function pairIndexOf(db, home) {'; do
  f="${pair%%|*}"; head="${pair#*|}"
  cp "$f" "$SCRATCH/one.orig"
  mut "$f" "$head" "${head#export }"
  (cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the deploy lane imports each export by name')
  cp "$SCRATCH/one.orig" "$f"
done
# Expected RED (predicted), five times: one kinds entry 'undefined' (index 4, 1, 2, 3 and 5 in turn).

# M13: the documented import effect changed.
mut ccd/history/cli.mjs 'process.umask(0o077);' 'process.umask(0o027);'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the deploy lane imports each export by name')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (predicted): umask 23 against 63.

for f in lib derive recall cli; do cmp -s "$SCRATCH/$f.orig" "ccd/history/$f.mjs" && echo "$f restored" || echo "$f DIFFERS"; done
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$REC_T")
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "$SD_T")
```

Expected:
- every mutant red as stated;
- the four files restored;
- the three describes green again: `5 passed`, `4 passed`, `4 passed`.

If a mutant stays green, its guard does not hold: report it, and never weaken the mutant to make it red. Record each red's first failing line in the scratch notes.

- [ ] **Step 8: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms, ONE tool call per line. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'THE CITATION DEBT this task creates')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected green, each against Step 1's base count:
- `history-lib`: the base's count plus 5.
- `history-recall`: the base's count plus 4. Every existing expand case is unchanged: C11, DM2b, D-4596's variants, H-8, the cut and the nested row.
- `single-definition -t 'ccrc history'`: the base's count plus 4. The new describe's name begins `ccrc history:`, so the filter selects it.
- `history-derive` and `history-card`: exactly the base's counts. These are derive.mjs's identity check: the leaves, their ids, the raw-leaf grace that reads `stampAtOrBefore` and the exported slot lists.
- `history-cli` and `history-maint`: green. They read `pairIndexOf` through status, the read verbs and the operator relay.
- `history-sweep`: green. sweep.mjs imports derive.mjs.
- `citations`: green. The added-lines rule finds no numeric line citation, and the tree's count does not rise.
- the citation-debt case: green and unchanged. This task's `single-definition.test.ts` edit is an append below the file's last describe, so no cited line moves (`session-hook` is a load flake: re-run it alone before calling a red a break).
- tsc: as in Step 5.

Then the departure's entry and the ledger check. D-6238's entry is already in this plan's "Deviations found" (it came with the plan): the first command prints 1. Never add a second. If a figure this task measured differs from the entry's, correct the entry and add the plan file to Step 9's `git add`.

```bash
grep -c '^- \*\*D-6238\*\* — ' docs/superpowers/plans/2026-10-21-ccrc-history-w2-1-recall-off-and-exports.md
grep -rn 'D-TBD-[a-z0-9]' ccd/history server/test/history-lib.test.ts server/test/history-recall.test.ts server/test/single-definition.test.ts || echo 'no D-TBD token'
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: `1`, `no D-TBD token`, then green.

- [ ] **Step 9: Commit.**

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/derive.mjs ccd/history/recall.mjs ccd/history/cli.mjs \
  server/test/history-lib.test.ts server/test/history-recall.test.ts server/test/single-definition.test.ts
git status --short
git commit -m "refactor(history): export the reads the deploy lane needs, and move stampAtOrBefore into lib (W2-1 Task 1; W2-D33; D-6238)"
```

`git status --short` must list exactly these eight files, plus this plan only if Step 8 corrected D-6238's entry. Nothing under `.superpowers/` appears: it is gitignored.

---

### Task 2: the shared names, vocabularies and the gate rewires

This task gives the rest of W2-1 and the deploy lane the names they share, and it rewires the gate's two temporary spellings onto them. It adds no verb, no tick step and no reader of the recall-off directory. Those are Tasks 3 and 4, and they consume what this task produces.

- **The paths (W2-D29, first bullet only).** `historyPaths(home)` gains `headlessOn` (`${h}/${SWITCHES.headlessOn}`) and `recallOffDir` (`${root}/${RECALL_OFF_DIR}`). `recallOffPath(home, id)` keeps its `idOk` check first, then returns `` `${historyPaths(home).recallOffDir}/${id}` ``. After this task, `RECALL_OFF_DIR` is joined onto a path on one code line of `lib.mjs`, the `recallOffDir` field. The rest of W2-D29 is Task 3's (moving every content reader onto `readBounded`, O13's one-writer case, the writer shape and its CONTROLs) and Task 4's (the scan's reads).
- **The presence constants (W2-D30, W2-D12).** `lib.mjs` declares:
  - `RECALL_OFF_META = 'recall_off:'`, the meta-key prefix of the presence record;
  - `RECALL_OFF_GAP_MS` = 600,000 (10 minutes, *chosen*);
  - `RECALL_OFF_SCAN_MAX` = 4,096 (*chosen*).

  Each is typed in `lib.d.mts` and appended to O14's `VOCABS` (R2); Task 4's `RECALL_OFF_KEYS` row goes after them. `RECALL_OFF_META` also joins the H-149 "quoted once" scan, because a `VOCABS` check is vacuous for a primitive: a reader that spells `'recall_off:'` instead of naming the constant would stay green.
- **isSyntheticModel (W2-D17).** The angle-bracket test moves out of `backendOf` into a new export, `isSyntheticModel(model)`, and `backendOf` calls it. A single-definition pin names `lib.mjs` as the only file that declares it, and that pin also requires the angle-bracket test to appear on exactly one code line of the `.mjs` corpus: the one inside `isSyntheticModel`.
- **The gate rewires (W2-D17, W2-D23, W2-D11).** `deploy/history-gate.mjs` imports `isSyntheticModel` and `RECALL_OFF_META` from lib. It drops its module-local `isSyntheticLocal` and `RECALL_OFF_PREFIX_LOCAL`, together with their `TEMPORARY` comments. `turnsOf`'s one call line and `parseRecallOffRow`'s two prefix lines name the imports. Nothing else in the gate changes: no export is added, removed or renamed, so W2-3's describes stay green.
- **The census's raw rows and the Python twin (W2-D23).** `deploy/measure-history.py` spells the prefix once, in a module-level `RECALL_OFF_META` that is lib's twin. In families mode it emits the presence record's raw meta rows as `w2.recall_off`: `[k, v]` for every meta row whose key starts with that prefix, ordered by `k`, unparsed (R2). `measure-history.test.ts` holds the twin equal to lib's constant, so a changed copy on either side goes red. It also runs the emitted rows through the gate's `changedFamilies`, so the reader ships with its writer.

**The two constraints this task honours:**
- **W2-D9 (lifecycle keys).** This task edits neither `shared/lifecycle.ts` nor `server/test/lifecycle.test.ts`, and it creates nothing on disk:
  - `recallOffDir` is a name; the directory and its entries are created by the verb's executor, Task 3's;
  - the presence record lives in the store's existing `meta` table, under the existing store row.

  At `02d75ae5f`, `HISTORY_ROWS_BY_PR` already carries `'W2-1': ['history-recall-off']` (W2-4's key split) and `HISTORY_LANDED` does not yet name `'W2-1'`. So `lifecycle.test.ts` stays green at this task's commit, unchanged. The `history-recall-off` row's text (the writer's temp `~tmp.<pid>`) and the `'W2-1'` append go with Task 3, in the commit that adds the writer (R3).
- **W2-D10 (no schema change).** The presence record is meta rows: `meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)` exists in schema v1. This task adds no table, column, index or migration, and `measure-history.py` reads `meta` through its existing read-only URI. A new case pins `SCHEMA_VERSION` at 2 with W2-D10 in its title (R2). A W2 PR that raises it goes red there and needs a ruling first. Mutant M13 measures that pin.

**Order.** This task reads no name an earlier task of this plan adds, and no later task's name. Where Task 1 has appended to the same test files, this task appends after it. Where Task 1 changed an anchor line quoted below, re-anchor on its content. Every line number below is a hint, measured at `02d75ae5f`.

**Files:**
- Modify: `ccd/history/lib.mjs` (re-anchor by the quoted content; Step 4's script asserts each anchor occurs once):
  - `historyPaths`' doc comment, the two lines that begin ` *  Each is derived from STORE_DB_REL, HISTORY_ROOT_REL or SWITCHES` (about :414-415 at 02d75ae5f);
  - in `historyPaths`' returned object, a `recallOffDir` line directly after `` passDied: `${root}/pass-died`, `` (about :440), and a `headlessOn` line directly after `` cap: `${h}/${SWITCHES.maxGb}`, `` (about :443);
  - `export function isSyntheticModel(model)` with its doc comment, inserted directly above `backendOf`'s doc comment, which begins `/** A row's backend, from its model name alone` (about :1518);
  - in `backendOf`, one doc line, `` (`<synthetic>`: Claude Code's own notices, no backend's output) is `` (about :1520), and its body line `if (model.startsWith('<') && model.endsWith('>')) return 'unknown';` (about :1525);
  - `RECALL_OFF_META`, `RECALL_OFF_GAP_MS` and `RECALL_OFF_SCAN_MAX`, each with its doc comment, directly after `export const RECALL_OFF_DIR = 'recall-off';` (about :4144);
  - `recallOffPath`'s last doc line and its return line (about :4331-4334).
- Modify: `ccd/history/lib.d.mts`:
  - in `interface HistoryPaths`, one line after `readonly op: string; readonly pass: string; readonly passDied: string; …` (about :124);
  - `isSyntheticModel`'s declaration directly above `export function backendOf(model: string | null | undefined): Backend;` (about :275);
  - three declarations directly after `export const RECALL_OFF_DIR: 'recall-off';` (about :510).
- Modify: `deploy/history-gate.mjs`. Only the rewire and the two temporary definitions it retires:
  - the lib import line (about :22);
  - `isSyntheticLocal` and its `TEMPORARY (W2-D17)` doc comment (about :212-218), deleted;
  - `turnsOf`'s doc line and its call line `if (isSyntheticLocal(row[5])) continue;` (about :226, :232);
  - `RECALL_OFF_PREFIX_LOCAL` and its `TEMPORARY (W2-D23)` doc comment (about :480-483), deleted;
  - `parseRecallOffRow`'s two lines that name `RECALL_OFF_PREFIX_LOCAL` (about :508-509).
- Modify: `deploy/measure-history.py`:
  - the docstring's `w2` entry (about :41-42) and one paragraph after `The model text is printed raw: …` (about :79);
  - `RECALL_OFF_META` after `WEEK_MS = 7 * 86_400_000` (about :98);
  - `recall_off_rows(db)` directly above `def w1e_statistic(counters):` (about :260);
  - in `main`, the `report['w2'] = …` literal (about :374-376).
- Test: `server/test/history-lib.test.ts`. One describe appended at the end of the file (about :10500), `'W2-1 Task 2: the recall-off paths, the presence constants and isSyntheticModel'`. It needs no new import: `readFileSync` (:11) and `fileURLToPath` (:13) are imported already, and lib is imported dynamically in each case, as the file's later blocks do.
- Test: `server/test/measure-history.test.ts`:
  - **in place**, four places:
    - the `W2` interface (about :36) gains `recall_off`;
    - the case `'the W2 raw rows: demo-a\'s calls and its two main boundaries, …'` (its `expect(rep.w2).toEqual({ row_cap: 400, …` line, about :222) gains `recall_off: []`;
    - W2-3 Task 2's import-line pin (about :1018-1024) names the two new imports;
    - W2-3 Task 5's header comment (about :2037-2038) and the title of its case `'the temporary recall_off: prefix is module-local: …'` (about :2273), reworded with the assertion unchanged.

    No other line of the file moves.
  - **appended** at the end of the file (about :5812): two namespace imports, `gateW21` and `libW21`, and the describe `'W2-1 Task 2: the gate reads lib\'s names, and the instrument\'s prefix is lib\'s'`. It reuses the file's top-level `ROOT`, `SCRIPT`, `NOW`, `G1`, `plantedStore`, `report`, `path`, `readFileSync` and `DatabaseSync`.
- Test: `server/test/single-definition.test.ts`:
  - **in place:**
    - O14's `VOCABS` ends `'SEGMENT_HEADER_BYTES'] as const;` (about :5301), which becomes three lines (+2);
    - the H-149 case's title line and its `for (const name of [...])` line (about :5384, :5389) each gain `RECALL_OFF_META`, so no line count changes.
  - **appended** at the end of the file (about :8316): the describe `'ccrc history W2-1 Task 2: isSyntheticModel is declared once, in lib.mjs, and holds the one angle-bracket test (W2-D17)'`. It is appended rather than nested in O14, because this file states that `session-hook.test.ts`'s citation audit cites it by line. Step 7 measures that audit.
- Not edited:
  - `shared/lifecycle.ts` and `server/test/lifecycle.test.ts` (W2-D9, above);
  - `ccd/history/cli.mjs` and `ccd/history/sweep.mjs`, whose `recallOffPath` callers (cli.mjs about :690, sweep.mjs about :811) get the same path string;
  - `deploy/history-replay.mjs`, `server/test/history-replay.test.ts` and `.github/workflows/*`;
  - the spec. Its errata, E12's sentence naming `w2.recall_off` included, are Task 6's.

**Interfaces:**
- Consumes (base, `02d75ae5f`):
  - `lib.mjs`:
    - `idOk(id): boolean`;
    - `SWITCHES.headlessOn = '.ccrc/history/headless-on'`;
    - `HISTORY_ROOT_REL`;
    - `RECALL_OFF_DIR = 'recall-off'` (declared below `historyPaths`, and read only when `historyPaths` runs);
    - `backendOf(model): 'anthropic'|'other'|'unknown'`;
    - `SCHEMA_VERSION` (2).
  - `history-gate.mjs` (W2-3, unchanged signatures):
    - `turnsOf(rows: RawRow[]): Turn[]`;
    - `parseRecallOffRow(k, v): {kind:'change',…}|{kind:'gap',…}|{kind:'other'}`;
    - `changedFamilies(metaRows: Array<{store_id, k, v}>, window: {start_ms, end_ms}, list: Array<{store_id, ccrc_id, generation}>): {changed: string[], gaps: Array<{store_id, ts_ms, from, to}>}`;
    - `familyKey(storeId, ccrcId, generation): string`.
  - `measure-history.py`: `families_report(db, families, start_ms, end_ms, row_cap)`. It opens one read transaction that `main`'s `db.close()` ends.
  - Tests:
    - `measure-history.test.ts`'s `plantedStore()` (a `createStore` store; it plants no meta key under the prefix), `report(args)`, `NOW`, `G1`, `ROOT` and `SCRIPT`;
    - `single-definition.test.ts`'s top-level `HISTORY_MJS`, `mjsUnder`, `stallCode`, `rel` and `ccrcRoot`.
- Produces:
  - `lib.mjs`:
    - `historyPaths(home)` adds `headlessOn: string` (`${h}/${SWITCHES.headlessOn}`) and `recallOffDir: string` (`${root}/${RECALL_OFF_DIR}`). The answer stays frozen, and every other field is unchanged.
    - `recallOffPath(home: string, id: string): string` is `` `${historyPaths(home).recallOffDir}/${id}` `` after `idOk(id)`. It throws a `TypeError` first on a bad id, as before.
    - `export const RECALL_OFF_META = 'recall_off:'`, `export const RECALL_OFF_GAP_MS = 10 * 60 * 1000` (600,000) and `export const RECALL_OFF_SCAN_MAX = 4096`.
    - `export function isSyntheticModel(model: unknown): boolean`. It is true iff `model` is a string that starts with `<` and ends with `>`, so `'<>'` is true, and `'<'`, `''`, `null` and every other value are false.
    - `backendOf` answers exactly as before, through `isSyntheticModel`.
  - `lib.d.mts`:
    - `HistoryPaths` gains `readonly headlessOn: string; readonly recallOffDir: string;`;
    - `export function isSyntheticModel(model: unknown): boolean;`;
    - `export const RECALL_OFF_META: 'recall_off:';`, `export const RECALL_OFF_GAP_MS: number;` and `export const RECALL_OFF_SCAN_MAX: number;`.

    Each is declared once.
  - `history-gate.mjs`: the import line `import { EXIT, RECALL_OFF_META, UUID_RE, canonicalJson, isSyntheticModel, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';`. Its export set is unchanged.
  - `measure-history.py`:
    - module-level `RECALL_OFF_META = 'recall_off:'`;
    - `recall_off_rows(db) -> list[[str, str]]`;
    - the report's `w2` becomes `{row_cap, window_start_ms, window_end_ms, families, recall_off}`, where `recall_off` is `Array<[k: string, v: string]>`, ordered by `k` (BINARY, that is bytewise), read after `families_report` in its snapshot. `census` and the W1 keys are unchanged, and `w2` is still `null` without `--families`.

**Spec:** §9.7 (`recall-off/<id>`, `headless-on`), §9.11 O13 and O14, §10.2 "The live A/B" (the changed-assignment bullet) and "The queries". Decisions: W2-D9 and W2-D10 (constraints, above), W2-D11 (the gate imports lib alone), W2-D12 (`VOCABS`; its departure is D-5774, defined in the W2-3 plan and cited here only), W2-D17, W2-D23, W2-D29 (first bullet) and W2-D30 (the constants only). measure-history.py's whole-text O32 bans (D-5772, W2-D16) constrain its new lines. This task defines no departure and cites no other.

**Choices this task makes:**
- **The raw rows go in `w2`, as `recall_off: [[k, v], …]` (R2).** Neither W2-D13 nor the W2-3 plan fixes where they go. `changedFamilies` reads them only over a window, and `w2` is the families-mode object that carries the window. The gate's `assembleReports` reads `w2.row_cap`, the two echoed window fields and `w2.families`, and ignores any other key (measured at `02d75ae5f`: `deploy/history-gate.mjs` reads `rep.w2.families`, `.window_start_ms` and `.window_end_ms` only). So no W2-3 or W2-4 pin moves except the one `toEqual` of `w2` this task edits in place. The rows are pairs, not `{store_id, k, v}`: the report is headed by its own `store_id`, and W2-5b's caller adds it, as this task's emission case does.
- **Every row under the prefix is emitted, unparsed (R2).** That includes the `state:<id>` and `seen_ms` rows that `changedFamilies` reads as `other`. W2-D23 says the script emits "the raw `recall_off:*` rows", and the script decides nothing (W2-D13). A row off W2-D30's grammar therefore reaches the gate, whose `parseRecallOffRow` throws on it. It is never silently dropped by the script.
- **The prefix is compared with `substr`, never `LIKE` or `GLOB`.** `LIKE` reads the underscore in `recall_off:` as a wildcard and ignores case. The emission case's CONTROL rows `recallXoff:…` and `RECALL_OFF:…` are each matched by a `LIKE` reading (M6). `substr` also keeps the script clear of O32's whole-text bans, which forbid `startswith`, `.endswith(`, an `re.` call and any comparison word after the word `model` (measure-history.test.ts :174-187 and :590-627; D-5772). The docstring paragraph names no model for the same reason.
- **The snapshot.** `recall_off_rows` is the last value in the `w2` literal. Python evaluates a dict display left to right, so it runs after `families_report`'s `BEGIN` and reads the same snapshot as the family rows.
- **`RECALL_OFF_GAP_MS` and `RECALL_OFF_SCAN_MAX` join `VOCABS` beside `RECALL_OFF_META` (R2).** W2-D12 names only `RECALL_OFF_META` for W2-1. Its rule, though, is "new lib constants that other modules read": Task 4's tick step in `sweep.mjs` reads `RECALL_OFF_SCAN_MAX`, and its tests read both. 5h-2's `RELAY_LOOKBEHIND_BYTES` is the precedent. Without the rows a second declaration goes unseen (mutant M12).
- **The twin pin has two halves.** The first: the script assigns `RECALL_OFF_META` exactly once, at module level, to lib's value. The second: the value's text appears in the script's source exactly once, on that line. A second hand-spelled copy in a query, a comment or the docstring therefore goes red too.
- **The isSyntheticModel pin is a separate describe at the end of `single-definition.test.ts`.** O14's `declares` reads `const`, `let` and `var` only, so `VOCABS` cannot hold a function. The file's own comments say its lines are cited by `session-hook.test.ts`'s citation audit, so the new cases go at the end, where they shift no anchor.
- **The angle-bracket census covers the `.mjs` corpus O14 reads:** `ccd/history`, `deploy` and `shared`. At `02d75ae5f` it finds two lines, `backendOf`'s and the gate's. After this task it finds exactly one, `isSyntheticModel`'s return. `lib.mjs`'s `startsWith('<local-command-stdout>')` is not an angle-bracket test, and the CONTROL checks it.

- [ ] **Step 1: Confirm the anchors, and that no name is taken.** Run this from the repository root, on the base with Task 1 applied:

```bash
git log -1 --format=%H
grep -c "isSyntheticModel\|RECALL_OFF_META\|RECALL_OFF_GAP_MS\|RECALL_OFF_SCAN_MAX\|recallOffDir" ccd/history/lib.mjs ccd/history/lib.d.mts deploy/measure-history.py
grep -n "isSyntheticModel\|RECALL_OFF_META" deploy/history-gate.mjs
grep -nE '^[^ ].*historyPaths\(' ccd/history/lib.mjs
grep -n "export const RECALL_OFF_DIR = 'recall-off';\|^export function historyPaths(home) {\|^export function backendOf(model) {\|^export function recallOffPath(home, id) {" ccd/history/lib.mjs
grep -n "isSyntheticLocal\|RECALL_OFF_PREFIX_LOCAL" deploy/history-gate.mjs
grep -nE "startsWith\(\s*['\"\`]<['\"\`]\s*\)|endsWith\(\s*['\"\`]>['\"\`]\s*\)" -r --include=*.mjs ccd deploy shared
grep -n "'SEGMENT_HEADER_BYTES'\] as const;" server/test/single-definition.test.ts
grep -n "'recall_off'\|recall_off_rows\|^RECALL_OFF_META" deploy/measure-history.py
```

Expected:
- the first `grep -c` prints `0` for each of the three files;
- the gate's two hits are comment lines only, the `TEMPORARY` notes about :213 and :481;
- the `historyPaths(` grep prints one line, its declaration (`418:export function historyPaths(home) {` at 02d75ae5f). No module-level statement of `lib.mjs` calls it, so it reads `RECALL_OFF_DIR` (declared about :4144) only after module evaluation, never in its temporal dead zone;
- each of the four declarations is found once;
- the gate's temporary names are found at about :216, :232, :483, :508 and :509;
- the angle-bracket grep prints exactly `deploy/history-gate.mjs:217` and `ccd/history/lib.mjs:1525`;
- `VOCABS`' last line is found once (about :5301);
- the last grep prints nothing.

On any other answer, stop and report it before any edit.

- [ ] **Step 2: Write the failing tests.** Three files.

**(a)** In `server/test/history-lib.test.ts`, append at the end of the file:

```ts

// ── W2-1 Task 2: the shared names (W2-D29's paths, W2-D30's constants, W2-D17's predicate; W2-D10) ─────────────────
// historyPaths names the recall-off directory and the headless-on switch, so recallOffPath joins one id onto
// recallOffDir and RECALL_OFF_DIR is joined onto a path on one code line of lib.mjs (W2-D29, first bullet). The
// presence record's meta prefix and its two chosen bounds are lib's (W2-D30). isSyntheticModel is the one
// angle-bracket test: backendOf reads it and deploy/history-gate.mjs imports it (W2-D17). The store schema does not
// move (W2-D10): the presence record is meta rows.
describe('W2-1 Task 2: the recall-off paths, the presence constants and isSyntheticModel', () => {
  const LIB_SRC = (): string => readFileSync(fileURLToPath(new URL('../../ccd/history/lib.mjs', import.meta.url)), 'utf8');
  /** Comment lines dropped, so a sentence about a name is never counted as code. */
  const codeOf = (text: string): string[] => text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));

  it('historyPaths gains recallOffDir under the root and headlessOn from SWITCHES, and recallOffPath is recallOffDir/<id> (W2-D29)', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const p = lib.historyPaths('/home/u');
    expect(p.recallOffDir).toBe(`${p.root}/${lib.RECALL_OFF_DIR}`);
    expect(p.recallOffDir).toBe('/home/u/.ccrc/history/recall-off');
    expect(p.headlessOn).toBe(`/home/u/${lib.SWITCHES.headlessOn}`);
    expect(lib.recallOffPath('/home/u', 'demo-a')).toBe(`${p.recallOffDir}/demo-a`);
    expect(lib.historyPaths('/home/u/').recallOffDir, 'a trailing slash on HOME changes nothing').toBe(p.recallOffDir);
    expect(() => lib.recallOffPath('/home/u', '../x'), 'the id is still checked before a path is formed (C66)').toThrow(TypeError);
  });

  it('RECALL_OFF_DIR is joined onto a path on one code line of lib.mjs, historyPaths\' recallOffDir, and recallOffPath reads it (W2-D29)', () => {
    const code = codeOf(LIB_SRC());
    expect(code.filter((l) => l.includes('${RECALL_OFF_DIR}')).map((l) => l.trim())).toEqual(['recallOffDir: `${root}/${RECALL_OFF_DIR}`,']);
    expect(code.filter((l) => l.includes('historyPaths(home).recallOffDir}/${id}')), 'recallOffPath joins the id onto recallOffDir').toHaveLength(1);
  });

  it('the presence record\'s meta prefix and its two chosen bounds are W2-D30\'s', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.RECALL_OFF_META).toBe('recall_off:');
    expect(lib.RECALL_OFF_GAP_MS).toBe(600_000);
    expect(lib.RECALL_OFF_SCAN_MAX).toBe(4096);
  });

  // [label, model, synthetic]: an angle-bracketed name only. A null or empty model is not synthetic: that row stays a
  // turn (W2-D17).
  const SYNTHETIC: Array<[string, unknown, boolean]> = [
    ['<synthetic>', '<synthetic>', true],
    ['an empty pair of brackets', '<>', true],
    ['an angle-bracketed phrase', '<a notice from the harness>', true],
    ['a bare <', '<', false],
    ['a bare >', '>', false],
    ['an open bracket only', '<synthetic', false],
    ['a close bracket only', 'synthetic>', false],
    ['a leading space', ' <synthetic>', false],
    ['a trailing space', '<synthetic> ', false],
    ['empty', '', false],
    ['null', null, false],
    ['undefined', undefined, false],
    ['a number', 7, false],
    ['a claude name', 'claude-fixture-4', false],
    ['another name', 'gpt-fixture-5', false],
  ];
  it.each(SYNTHETIC)('isSyntheticModel: %s', async (_label, model, want) => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.isSyntheticModel(model)).toBe(want);
  });

  it('backendOf reads isSyntheticModel for its unknown, and its body spells no angle-bracket test of its own (W2-D17)', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    for (const [label, model, synthetic] of SYNTHETIC) {
      if (synthetic) expect(lib.backendOf(model as string), label).toBe('unknown');
    }
    expect(lib.backendOf('claude-fixture-4'), 'CONTROL: a claude name is still anthropic').toBe('anthropic');
    expect(lib.backendOf('<claude-fixture-4>'), 'an angle-bracketed claude name is synthetic first').toBe('unknown');
    const src = LIB_SRC();
    const at = src.indexOf('export function backendOf(model) {');
    expect(at, 'backendOf is declared as the base declares it').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body).toContain('isSyntheticModel(model)');
    expect(body).not.toMatch(/startsWith\(\s*['"`]<['"`]\s*\)|endsWith\(\s*['"`]>['"`]\s*\)/);
  });

  it('W2-D10: the store schema stays at version 2 through W2 (the presence record is meta rows, never a table)', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.SCHEMA_VERSION).toBe(2);
  });
});
```

**(b)** In `server/test/measure-history.test.ts`, four in-place edits, then one append. Replace the one line

```ts
interface W2 { row_cap: number; window_start_ms: number; window_end_ms: number; families: FamilyReport[] }
```

with

```ts
interface W2 { row_cap: number; window_start_ms: number; window_end_ms: number; families: FamilyReport[]; recall_off: Array<[k: string, v: string]> }
```

In the case `'the W2 raw rows: demo-a\'s calls and its two main boundaries, copy by copy and row by row (W2-D13)'`, replace the one line

```ts
    expect(rep.w2).toEqual({ row_cap: 400, window_start_ms: 1500, window_end_ms: 6000, families: [{
```

with

```ts
    expect(rep.w2).toEqual({ row_cap: 400, window_start_ms: 1500, window_end_ms: 6000, recall_off: [], families: [{
```

In `describe('W2-3 Task 2: the gate module is pure and its words are its own'`, case `'imports only node:crypto and lib.mjs, and lib.mjs exactly as W2-D11 lists it'`, replace the one line

```ts
      "import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';");
```

with

```ts
      "import { EXIT, RECALL_OFF_META, UUID_RE, canonicalJson, isSyntheticModel, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';");
```

Above `import * as gateT5 from '../../deploy/history-gate.mjs';`, replace the two comment lines

```ts
// timed row (W2-D14). The presence record's keys are W2-D30's grammar, spelled here as text: the gate's prefix is
// module-local and temporary until W2-1 (W2-D23).
```

with

```ts
// timed row (W2-D14). The presence record's keys are W2-D30's grammar, spelled here as text: since W2-1 the gate
// reads lib's RECALL_OFF_META, and this describe never reads the binding (W2-D23).
```

In the same describe, replace the one line

```ts
  it('the temporary recall_off: prefix is module-local: the gate exports no binding of it for another module to read', () => {
```

with

```ts
  it('the presence prefix is lib\'s RECALL_OFF_META: the gate re-exports no binding of it for another module to read', () => {
```

Then append at the end of the file:

```ts

// ── W2-1 Task 2: the gate reads lib's names, and the instrument's prefix is lib's (W2-D17, W2-D23, W2-D11) ─────────
// W2-3 left two spellings module-local and temporary in deploy/history-gate.mjs, and W2-1 rewires both to lib.mjs:
// turnsOf drops a row through lib's isSyntheticModel, and parseRecallOffRow reads keys under lib's RECALL_OFF_META.
// The instrument emits the presence record's raw meta rows as w2.recall_off. It spells the prefix once, as the twin
// of lib's constant, and the two are held equal here, so a changed copy on either side reds. Fixture HOMEs only.
import * as gateW21 from '../../deploy/history-gate.mjs';
import * as libW21 from '../../ccd/history/lib.mjs';

describe('W2-1 Task 2: the gate reads lib\'s names, and the instrument\'s prefix is lib\'s', () => {
  const GATE = path.join(ROOT, 'deploy', 'history-gate.mjs');
  /** Comment lines dropped, so a sentence about a name is never counted as code. */
  const codeOf = (text: string): string[] => text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
  /** A spelling of the presence prefix, and an angle-bracket model test, as a code line could hold either. */
  const PREFIX_LITERAL = /['"`]recall_off:/;
  const ANGLE_TEST = /startsWith\(\s*['"`]<['"`]\s*\)|endsWith\(\s*['"`]>['"`]\s*\)/;

  it('CONTROL: the two patterns see the base gate\'s two temporary lines, and not the import or the calls that replace them', () => {
    expect(PREFIX_LITERAL.test("const RECALL_OFF_PREFIX_LOCAL = 'recall_off:';")).toBe(true);
    expect(ANGLE_TEST.test("  return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');")).toBe(true);
    expect(PREFIX_LITERAL.test("import { EXIT, RECALL_OFF_META, UUID_RE } from '../ccd/history/lib.mjs';")).toBe(false);
    expect(PREFIX_LITERAL.test("  if (typeof k !== 'string' || !k.startsWith(RECALL_OFF_META)) return { kind: 'other' };")).toBe(false);
    expect(ANGLE_TEST.test('    if (isSyntheticModel(row[5])) continue;')).toBe(false);
  });

  it('the gate\'s code spells neither the presence prefix nor an angle-bracket model test: both are lib\'s (W2-D17, W2-D23)', () => {
    const hits = codeOf(readFileSync(GATE, 'utf8')).filter((l) => PREFIX_LITERAL.test(l) || ANGLE_TEST.test(l)).map((l) => l.trim());
    expect(hits).toEqual([]);
  });

  it('the instrument\'s RECALL_OFF_META is lib\'s: measure-history.py assigns it once and spells the value nowhere else (W2-D23\'s twin)', () => {
    expect(typeof libW21.RECALL_OFF_META, 'lib exports the prefix').toBe('string');
    const src = readFileSync(SCRIPT, 'utf8');
    const assigned = [...src.matchAll(/^RECALL_OFF_META = '([^'\n]*)'$/gm)].map((m) => m[1]);
    expect(assigned, 'one module-level assignment, equal to lib\'s value').toEqual([libW21.RECALL_OFF_META]);
    expect(src.split(libW21.RECALL_OFF_META).length - 1, 'the value is spelled once, on that line').toBe(1);
  });

  it('w2.recall_off is every meta row under RECALL_OFF_META, raw and ordered by key, and changedFamilies reads it as emitted (W2-D23)', () => {
    const f = plantedStore();
    const P = libW21.RECALL_OFF_META;
    // A change row in Task 4's grammar (from and to are state objects; a from of 'unobserved' carries prev_seen_ms null).
    const change = JSON.stringify({ from: { s: 'unreadable', v: null }, to: { s: 'value', v: G1 }, prev_seen_ms: 3000 });
    const gap = JSON.stringify({ from: 1000, to: 2500 });
    const state = JSON.stringify({ s: 'value', v: G1 });
    const db = new DatabaseSync(f.db);
    try {
      const put = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
      put.run(`${P}state:demo-a`, state);
      put.run(`${P}seen_ms`, '5500');
      put.run(`${P}change:4000:demo-a`, change);
      put.run(`${P}gap:2500`, gap);
      // CONTROL rows: no key below begins with the prefix. LIKE would take the first two (its _ is a wildcard and it
      // ignores case); a prefix test without the colon would take the third.
      put.run('recallXoff:change:4000:demo-a', change);
      put.run('RECALL_OFF:gap:2500', gap);
      put.run('recall_off', 'no colon');
    } finally {
      db.close();
    }
    const rep = report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000',
      '--row-cap', '400']);
    const rows = rep.w2!.recall_off;
    expect(rows).toEqual([[`${P}change:4000:demo-a`, change], [`${P}gap:2500`, gap], [`${P}seen_ms`, '5500'], [`${P}state:demo-a`, state]]);
    const got = gateW21.changedFamilies(rows.map(([k, v]) => ({ store_id: rep.store_id!, k, v })), { start_ms: 1500, end_ms: 6000 },
      [{ store_id: f.storeId, ccrc_id: 'demo-a', generation: G1 }]);
    expect(got).toEqual({
      changed: [gateW21.familyKey(f.storeId, 'demo-a', G1)],
      gaps: [{ store_id: f.storeId, ts_ms: 2500, from: 1000, to: 2500 }],
    });
  });
});
```

**(c)** In `server/test/single-definition.test.ts`, two in-place edits, then one append. In the O14 describe's `VOCABS`, replace the one line

```ts
    'SEGMENT_HEADER_BYTES'] as const;
```

with

```ts
    'SEGMENT_HEADER_BYTES',
    // W2-1 Task 2 (W2-D12, W2-D30): the presence record's meta prefix and its two bounds, read by lib's planner, sweep.mjs and (the prefix) the gate.
    'RECALL_OFF_META', 'RECALL_OFF_GAP_MS', 'RECALL_OFF_SCAN_MAX'] as const;
```

In the same describe, replace the one line

```ts
  it('the string vocabularies EXPAND_LABEL, BELT_META, BELT_NODES_STEP and REDACT_SOURCES_META are quoted once, at their declaration (H-149)', async () => {
```

with

```ts
  it('the string vocabularies EXPAND_LABEL, BELT_META, BELT_NODES_STEP, REDACT_SOURCES_META and RECALL_OFF_META are quoted once, at their declaration (H-149)', async () => {
```

and in that case replace the one line

```ts
    for (const name of ['EXPAND_LABEL', 'BELT_META', 'BELT_NODES_STEP', 'REDACT_SOURCES_META'] as const) {
```

with

```ts
    for (const name of ['EXPAND_LABEL', 'BELT_META', 'BELT_NODES_STEP', 'REDACT_SOURCES_META', 'RECALL_OFF_META'] as const) {
```

Then append at the end of the file:

```ts

// CCRC HISTORY W2-1 TASK 2 (W2-D17): isSyntheticModel is the one angle-bracket model test. APPENDED, for the reason
// the blocks above state: session-hook.test.ts's citation audit cites this file by line. O14's `declares` reads const,
// let and var only, so a function needs its own scan: lib.mjs declares it and no other .mjs under ccd/history, deploy
// or shared does, and the angle-bracket test it holds is spelled on one code line of that corpus, its own.
describe('ccrc history W2-1 Task 2: isSyntheticModel is declared once, in lib.mjs, and holds the one angle-bracket test (W2-D17)', () => {
  const CORPUS = [...new Set([...HISTORY_MJS, ...mjsUnder(path.join(ccrcRoot, 'deploy')), ...mjsUnder(path.join(ccrcRoot, 'shared'))])];
  const declaresFn = (name: string): RegExp =>
    new RegExp(`(?:^|[\\s;])(?:export\\s+)?(?:(?:async\\s+)?function\\*?\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b)`);
  const ANGLE_TEST = /startsWith\(\s*['"`]<['"`]\s*\)|endsWith\(\s*['"`]>['"`]\s*\)/;

  it('CONTROL: the corpus holds lib.mjs and the gate, and the two patterns see what they look for and nothing else', () => {
    expect(CORPUS.map(rel)).toEqual(expect.arrayContaining(['ccd/history/lib.mjs', 'deploy/history-gate.mjs']));
    expect(declaresFn('isSyntheticModel').test('export function isSyntheticModel(model) {')).toBe(true);
    expect(declaresFn('isSyntheticModel').test('function isSyntheticModel(m) {')).toBe(true);
    expect(declaresFn('isSyntheticModel').test("const isSyntheticModel = (m) => m === '<x>';")).toBe(true);
    expect(declaresFn('isSyntheticModel').test('    if (isSyntheticModel(row[5])) continue;')).toBe(false);
    expect(declaresFn('isSyntheticModel').test("import { EXIT, isSyntheticModel } from '../ccd/history/lib.mjs';")).toBe(false);
    expect(ANGLE_TEST.test("  return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');")).toBe(true);
    expect(ANGLE_TEST.test("  if (leadText(content).trimStart().startsWith('<local-command-stdout>')) return 'harness';")).toBe(false);
  });

  it('lib.mjs is the one file of the corpus that declares isSyntheticModel', () => {
    expect(CORPUS.filter((f) => stallCode(f).split('\n').some((l) => declaresFn('isSyntheticModel').test(l))).map(rel).sort())
      .toEqual(['ccd/history/lib.mjs']);
  });

  it('the angle-bracket model test is spelled on one code line of the corpus, the return of lib.mjs\'s isSyntheticModel', () => {
    const hits = CORPUS.flatMap((f) => stallCode(f).split('\n').filter((l) => ANGLE_TEST.test(l)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(hits).toEqual(["ccd/history/lib.mjs: return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');"]);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** Run each command in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-1 Task 2')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-1 Task 2')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'imports only node:crypto and lib.mjs')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'the W2 raw rows: demo-a.s calls')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_OFF_(META|GAP_MS|SCAN_MAX) is declared in')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'quoted once, at their declaration')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'W2-1 Task 2')
```

Expected (predicted, written before the code):
- **history-lib:** `19 failed | 1 passed`:
  - the paths case: `expected undefined to be '/home/u/.ccrc/history/recall-off'`;
  - the join case: its one line is recallOffPath's `` return `${historyPaths(home).root}/${RECALL_OFF_DIR}/${id}`; ``;
  - the constants case: `expected undefined to be 'recall_off:'`;
  - all 15 `isSyntheticModel:` rows: `lib.isSyntheticModel is not a function`;
  - the backendOf case: its body does not contain `isSyntheticModel(model)`.

  Only the W2-D10 case is green. It is a standing pin of the base's value, and its red is M13's.
- **measure-history `W2-1 Task 2`:** `3 failed | 1 passed`. The CONTROL is green. The gate case finds two lines: `const RECALL_OFF_PREFIX_LOCAL = 'recall_off:';` and `` return typeof model === 'string' && model.startsWith('<') && model.endsWith('>'); ``. The twin case fails with `lib exports the prefix: expected 'undefined' to be 'string'`. The emission case fails with `expected undefined to deeply equal [ …(4) ]`.
- **measure-history, the import pin:** `1 failed` (the gate's line differs).
- **measure-history, the W2 raw rows case:** `1 failed` (`recall_off` is missing from the actual `w2`).
- **single-definition VOCABS:** `3 failed`. Each reads `<NAME>: a second declaration: expected [] to deeply equal [ 'ccd/history/lib.mjs' ]`.
- **single-definition H-149:** `1 failed`, with `RECALL_OFF_META is a string: expected 'undefined' to be 'string'`.
- **single-definition `W2-1 Task 2`:** `2 failed | 1 passed`. The declaration case gets `[]` where it expects `[ 'ccd/history/lib.mjs' ]`. The angle-bracket case finds two lines: `` ccd/history/lib.mjs: if (model.startsWith('<') && model.endsWith('>')) return 'unknown'; `` and the gate's.

- [ ] **Step 4: Write the names and the rewires.** From the repository root, run this script. Each replacement asserts that its anchor occurs exactly once. The body is a quoted heredoc, so no backtick or `$` in it is expanded. The script writes four files and prints one line.

```bash
python3 - <<'EOF'
import pathlib

def rep(path, old, new):
    p = pathlib.Path(path)
    s = p.read_text(encoding='utf-8')
    n = s.count(old)
    assert n == 1, (path, old[:70], n)
    p.write_text(s.replace(old, new), encoding='utf-8')

LIB = 'ccd/history/lib.mjs'
rep(LIB, """ *  Each is derived from STORE_DB_REL, HISTORY_ROOT_REL or SWITCHES — never a
 *  second spelling. `journalFile` is SQLite's rollback journal beside the DB
""", """ *  Each is derived from STORE_DB_REL, HISTORY_ROOT_REL, SWITCHES or
 *  RECALL_OFF_DIR — never a second spelling; `recallOffDir` is the one place
 *  RECALL_OFF_DIR is joined onto a path (W2-D29). `journalFile` is SQLite's
 *  rollback journal beside the DB
""")
rep(LIB, """    passDied: `${root}/pass-died`,
""", """    passDied: `${root}/pass-died`,
    recallOffDir: `${root}/${RECALL_OFF_DIR}`,
""")
rep(LIB, """    cap: `${h}/${SWITCHES.maxGb}`,
""", """    cap: `${h}/${SWITCHES.maxGb}`,
    headlessOn: `${h}/${SWITCHES.headlessOn}`,
""")
rep(LIB, """/** A row's backend, from its model name alone (§6.2, `BACKENDS`). A name
 *  starting `claude` is `anthropic`; NULL, empty, or angle-bracketed
 *  (`<synthetic>`: Claude Code's own notices, no backend's output) is
""", """/** Whether a row's model name is Claude Code's own notice rather than any
 *  backend's output: an angle-bracketed name (`<synthetic>`). NULL, empty and
 *  every other name are not, so a row with no model stays a turn. The one
 *  predicate (W2-D17): backendOf reads it for `unknown`, and
 *  deploy/history-gate.mjs's turnsOf imports it to drop such rows. */
export function isSyntheticModel(model) {
  return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');
}

/** A row's backend, from its model name alone (§6.2, `BACKENDS`). A name
 *  starting `claude` is `anthropic`; NULL, empty, or angle-bracketed
 *  (`<synthetic>`, isSyntheticModel: Claude Code's own notices) is
""")
rep(LIB, """  if (model.startsWith('<') && model.endsWith('>')) return 'unknown';
""", """  if (isSyntheticModel(model)) return 'unknown';
""")
rep(LIB, """export const RECALL_OFF_DIR = 'recall-off';
""", """export const RECALL_OFF_DIR = 'recall-off';

/** The recall-off presence record's meta-key prefix (W2-D30): its `state:<id>`,
 *  `seen_ms`, `change:<ts_ms>:<id>` and `gap:<ts_ms>` rows are keyed under it in
 *  the store's `meta` table, so the record needs no schema change (W2-D10). The
 *  sweep writes them, status reads them, deploy/history-gate.mjs's
 *  changedFamilies parses them and deploy/measure-history.py emits them raw.
 *  Spelled once, here; measure-history.py's twin is held equal to it by
 *  measure-history.test.ts (W2-D23). */
export const RECALL_OFF_META = 'recall_off:';
/** When the time since the presence record's last observation exceeds this,
 *  the tick writes a gap row (W2-D30, chosen). */
export const RECALL_OFF_GAP_MS = 10 * 60 * 1000;
/** The most `recall-off/` entries one tick's scan reads (W2-D30, chosen): the
 *  counted iteration stops there, and a capped directory writes nothing and
 *  does not advance the record's seen time. */
export const RECALL_OFF_SCAN_MAX = 4096;
""")
rep(LIB, """ *  (D-4170, C66). */
export function recallOffPath(home, id) {
  if (!idOk(id)) throw new TypeError(`recallOffPath: not a session id: ${JSON.stringify(id)}`);
  return `${historyPaths(home).root}/${RECALL_OFF_DIR}/${id}`;
""", """ *  (D-4170, C66). The directory is historyPaths' recallOffDir (W2-D29). */
export function recallOffPath(home, id) {
  if (!idOk(id)) throw new TypeError(`recallOffPath: not a session id: ${JSON.stringify(id)}`);
  return `${historyPaths(home).recallOffDir}/${id}`;
""")

DTS = 'ccd/history/lib.d.mts'
rep(DTS, """  readonly op: string; readonly pass: string; readonly passDied: string; readonly lock: string; readonly off: string; readonly cap: string;
""", """  readonly op: string; readonly pass: string; readonly passDied: string; readonly lock: string; readonly off: string; readonly cap: string;
  /** W2-D29: the headless-on switch (SWITCHES.headlessOn) and the recall-off directory (RECALL_OFF_DIR under the root). */
  readonly headlessOn: string; readonly recallOffDir: string;
""")
rep(DTS, """export function backendOf(model: string | null | undefined): Backend;
""", """export function isSyntheticModel(model: unknown): boolean;
export function backendOf(model: string | null | undefined): Backend;
""")
rep(DTS, """export const RECALL_OFF_DIR: 'recall-off';
""", """export const RECALL_OFF_DIR: 'recall-off';
export const RECALL_OFF_META: 'recall_off:';
export const RECALL_OFF_GAP_MS: number;
export const RECALL_OFF_SCAN_MAX: number;
""")

GATE = 'deploy/history-gate.mjs'
rep(GATE, """import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';
""", """import { EXIT, RECALL_OFF_META, UUID_RE, canonicalJson, isSyntheticModel, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';
""")
rep(GATE, """/** TEMPORARY (W2-D17): Claude Code's own notices carry an angle-bracketed model name and are no backend's turn.
 *  W2-1 extracts lib's isSyntheticModel, has backendOf use it, and rewires this file to import it in place of this
 *  module-local test. A null or empty model is not synthetic: that row stays a turn.
 *  @param {string|null} model @returns {boolean} */
function isSyntheticLocal(model) {
  return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');
}

""", "")
rep(GATE, """/** A copy's assistant turns in file order (W2-D14): synthetic rows dropped, consecutive rows with one key grouped.
""", """/** A copy's assistant turns in file order (W2-D14): synthetic rows dropped through lib's isSyntheticModel (W2-D17; a
 *  null or empty model is not synthetic, so that row stays a turn), consecutive rows with one key grouped.
""")
rep(GATE, """    if (isSyntheticLocal(row[5])) continue;
""", """    if (isSyntheticModel(row[5])) continue;
""")
rep(GATE, """/** TEMPORARY (W2-D23): the presence record's meta prefix (W2-D30), spelled here only until W2-1 defines
 *  `RECALL_OFF_META` in lib.mjs, replaces this binding with an import of it and adds the Python twin pin. Module-
 *  local and never exported, so no other module can come to read this spelling. */
const RECALL_OFF_PREFIX_LOCAL = 'recall_off:';

""", "")
rep(GATE, """  if (typeof k !== 'string' || !k.startsWith(RECALL_OFF_PREFIX_LOCAL)) return { kind: 'other' };
  const rest = k.slice(RECALL_OFF_PREFIX_LOCAL.length);
""", """  if (typeof k !== 'string' || !k.startsWith(RECALL_OFF_META)) return { kind: 'other' };
  const rest = k.slice(RECALL_OFF_META.length);
""")

PY = 'deploy/measure-history.py'
rep(PY, """  w2                      null without --families; else {row_cap, window_start_ms, window_end_ms, families},
                          the W2 raw rows, below; the two window fields echo --window-start and --window-end
""", """  w2                      null without --families; else {row_cap, window_start_ms, window_end_ms, families,
                          recall_off}, the W2 raw rows, below; the two window fields echo --window-start and
                          --window-end
""")
rep(PY, """The model text is printed raw: this file never tests, compares or classifies it (O32 narrowed, D-5772).
""", """The model text is printed raw: this file never tests, compares or classifies it (O32 narrowed, D-5772).

THE PRESENCE RECORD (W2-D23, W2-D30). w2.recall_off is the recall-off presence record's raw meta rows: [k, v]
for every meta row whose key begins with RECALL_OFF_META (lib.mjs's constant, spelled once below as its twin,
which measure-history.test.ts holds equal), ordered by k and read in the families snapshot. Nothing here parses
them: deploy/history-gate.mjs's changedFamilies decides which listed families' files changed during the window.
""")
rep(PY, """WEEK_MS = 7 * 86_400_000
""", """WEEK_MS = 7 * 86_400_000
# The presence record's meta prefix: lib.mjs's RECALL_OFF_META, spelled here once because this file imports nothing
# from lib (W2-D23). measure-history.test.ts holds the two equal, so a changed copy on either side goes red.
RECALL_OFF_META = 'recall_off:'
""")
rep(PY, """def w1e_statistic(counters):
""", """def recall_off_rows(db):
    \"\"\"The presence record's raw rows (W2-D23, W2-D30): [k, v] for every meta row whose key begins with
    RECALL_OFF_META, ordered by k, unparsed. The prefix is compared whole, by substr: LIKE would read its underscore
    as a wildcard and ignore case. main calls this after families_report, so it reads that function's snapshot.\"\"\"
    sql = 'SELECT k, v FROM meta WHERE substr(k, 1, ?) = ? ORDER BY k'
    return [[k, v] for k, v in db.execute(sql, (len(RECALL_OFF_META), RECALL_OFF_META)).fetchall()]


def w1e_statistic(counters):
""")
rep(PY, """                            'families': families_report(db, load_families(a.families, store_id), a.window_start,
                                                        a.window_end, a.row_cap)}
""", """                            'families': families_report(db, load_families(a.families, store_id), a.window_start,
                                                        a.window_end, a.row_cap),
                            'recall_off': recall_off_rows(db)}   # after families: its snapshot (W2-D23)
""")
print('W2-1 Task 2: lib.mjs, lib.d.mts, history-gate.mjs and measure-history.py written')
EOF
node -e "import('./ccd/history/lib.mjs').then((l) => console.log(l.historyPaths('/home/u').recallOffDir, l.recallOffPath('/home/u', 'demo-a'), l.isSyntheticModel('<synthetic>'), l.backendOf('<synthetic>')))"
```

Expected: the script prints its one line, and the `node` line prints `/home/u/.ccrc/history/recall-off /home/u/.ccrc/history/recall-off/demo-a true unknown`. That shows `historyPaths` reads `RECALL_OFF_DIR` after module evaluation, never in its dead zone. The Python string `\"\"\"` sequences are escaped quotes inside the outer triple-quoted literal, and the file gets plain `"""` docstring quotes. Check with `grep -n 'def recall_off_rows' -A2 deploy/measure-history.py`.

- [ ] **Step 5: Run them and see them pass, then the whole files and the typecheck.** Run each command in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-1 Task 2')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-1 Task 2')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'imports only node:crypto and lib.mjs')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'the W2 raw rows: demo-a.s calls')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_OFF_(META|GAP_MS|SCAN_MAX) is declared in')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'quoted once, at their declaration')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'W2-1 Task 2')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected (predicted):
- each filter green: `20 passed`, `4 passed`, `1 passed`, `1 passed`, `3 passed`, `1 passed` and `3 passed`;
- `history-lib` whole: the count at Task 1's commit plus 20;
- `measure-history` whole: the count at Task 1's commit plus 4, all green. W2-3's describes are unchanged in their assertions: Tasks 3 (RP6's `<synthetic>` case), 5 (`parseRecallOffRow`, `changedFamilies`) and 2 (purity, the O14 local half, the class scan);
- `single-definition -t 'ccrc history'`: the count at Task 1's commit plus 6 (3 `VOCABS` rows and 3 appended cases; the H-149 case is renamed, not added);
- tsc reports no line naming a file this task touched. A line that names only `agent/src/` or `test/workflow-yaml-parses.test.ts` comes from the worktree's install.

Record each printed count in the task's report. If a whole-file run reds a case outside this task's, re-run that file alone before calling it a break (CLAUDE.md's load flakes).

- [ ] **Step 6: Measure every new guard red, then green.** Run this from the repository root. Each block makes one exact replacement (asserted to match once), or one append, then runs its filters, shows them red, and restores every file with `cp`. The replacement text is read from quoted heredocs, so nothing in it is expanded. The scratch directory is gitignored (`.superpowers/`) and is never committed.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-1/scratch"; mkdir -p "$SCRATCH"
cat > "$SCRATCH/mut.py" <<'EOF'
import sys
p, o, n = sys.argv[1:4]
old, new = open(o, encoding='utf-8').read()[:-1], open(n, encoding='utf-8').read()[:-1]
s = open(p, encoding='utf-8').read()
assert s.count(old) == 1, (p, s.count(old))
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
EOF
FILES="ccd/history/lib.mjs deploy/history-gate.mjs deploy/measure-history.py ccd/history/cli.mjs ccd/history/sweep.mjs"
for f in $FILES; do cp "$f" "$SCRATCH/$(basename "$f").orig"; done
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; done; }
mut() { python3 "$SCRATCH/mut.py" "$1" "$SCRATCH/old" "$SCRATCH/new"; }

# M1: isSyntheticModel loses its closing-bracket test.
cat > "$SCRATCH/old" <<'EOF'
  return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');
EOF
cat > "$SCRATCH/new" <<'EOF'
  return typeof model === 'string' && model.startsWith('<');
EOF
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-1 Task 2.*isSyntheticModel: ')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'W2-1 Task 2')
restore
# Expected RED (predicted): history-lib `3 failed | 12 passed` ('a bare <', 'an open bracket only', 'a trailing space');
# single-definition `1 failed | 2 passed` (the one code line is no longer the expected text).

# M2: backendOf keeps its own angle-bracket test (the extraction undone).
cat > "$SCRATCH/old" <<'EOF'
  if (isSyntheticModel(model)) return 'unknown';
EOF
cat > "$SCRATCH/new" <<'EOF'
  if (model.startsWith('<') && model.endsWith('>')) return 'unknown';
EOF
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'backendOf reads isSyntheticModel')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'W2-1 Task 2')
restore
# Expected RED (predicted): history-lib `1 failed` (the body does not contain isSyntheticModel(model)); single-definition
# `1 failed | 2 passed` (two lines: backendOf's and isSyntheticModel's).

# M3: the gate keeps a local angle-bracket test (the W2-D17 rewire undone in turnsOf).
cat > "$SCRATCH/old" <<'EOF'
    if (isSyntheticModel(row[5])) continue;
EOF
cat > "$SCRATCH/new" <<'EOF'
    if (typeof row[5] === 'string' && row[5].startsWith('<') && row[5].endsWith('>')) continue;
EOF
mut deploy/history-gate.mjs
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-1 Task 2')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'W2-1 Task 2')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'RP6: a .synthetic. row is not a turn')
restore
# Expected RED (predicted): measure-history `1 failed | 3 passed` (the gate's code line); single-definition `1 failed |
# 2 passed` (deploy/history-gate.mjs listed). CONTROL: RP6's <synthetic> case stays green, so the pins, not behaviour, see it.

# M4: the gate declares its own RECALL_OFF_META in place of the import (the W2-D23 rewire undone).
cat > "$SCRATCH/old" <<'EOF'
import { EXIT, RECALL_OFF_META, UUID_RE, canonicalJson, isSyntheticModel, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';
EOF
cat > "$SCRATCH/new" <<'EOF'
import { EXIT, UUID_RE, canonicalJson, isSyntheticModel, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';
const RECALL_OFF_META = 'recall_off:';
EOF
mut deploy/history-gate.mjs
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'imports only node:crypto and lib.mjs|O14, local half|W2-1 Task 2')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_OFF_META is declared in')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 5')
restore
# Expected RED (predicted): measure-history `3 failed | 3 passed` (the import pin, the O14 local half, the gate's code
# line); single-definition `1 failed` ([lib.mjs, deploy/history-gate.mjs]). CONTROL: W2-3 Task 5 stays green.

# M5: the instrument's twin drifts (the script side).
cat > "$SCRATCH/old" <<'EOF'
RECALL_OFF_META = 'recall_off:'
EOF
cat > "$SCRATCH/new" <<'EOF'
RECALL_OFF_META = 'recall-off:'
EOF
mut deploy/measure-history.py
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-1 Task 2')
restore
# Expected RED (predicted): `2 failed | 2 passed`: the twin case (one module-level assignment, ['recall-off:'] against
# ['recall_off:']) and the emission case (expected [] to deeply equal [ …(4) ]).

# M5b: the twin drifts (lib's side).
cat > "$SCRATCH/old" <<'EOF'
export const RECALL_OFF_META = 'recall_off:';
EOF
cat > "$SCRATCH/new" <<'EOF'
export const RECALL_OFF_META = 'recall-off:';
EOF
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-1 Task 2')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'meta prefix and its two chosen bounds')
restore
# Expected RED (predicted): measure-history `2 failed | 2 passed` (the twin case, and the emission case: rows planted
# under lib's prefix are not the script's); history-lib `1 failed`.

# M6: the script's prefix test through LIKE (its _ a wildcard, its match case-blind).
cat > "$SCRATCH/old" <<'EOF'
    sql = 'SELECT k, v FROM meta WHERE substr(k, 1, ?) = ? ORDER BY k'
EOF
cat > "$SCRATCH/new" <<'EOF'
    sql = "SELECT k, v FROM meta WHERE ? > 0 AND k LIKE ? || '%' ORDER BY k"
EOF
mut deploy/measure-history.py
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'w2.recall_off is every meta row')
restore
# Expected RED (predicted): `1 failed`: the CONTROL rows RECALL_OFF:gap:2500 and recallXoff:change:4000:demo-a are emitted.

# M7: the script emits no rows.
cat > "$SCRATCH/old" <<'EOF'
                            'recall_off': recall_off_rows(db)}   # after families: its snapshot (W2-D23)
EOF
cat > "$SCRATCH/new" <<'EOF'
                            'recall_off': []}
EOF
mut deploy/measure-history.py
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'w2.recall_off is every meta row')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'the W2 raw rows: demo-a.s calls')
restore
# Expected RED (predicted): the emission case `1 failed`. CONTROL: the W2 raw rows case stays green (an empty record is []).

# M8: recallOffPath joins RECALL_OFF_DIR itself again (W2-D29's one join undone).
cat > "$SCRATCH/old" <<'EOF'
  return `${historyPaths(home).recallOffDir}/${id}`;
EOF
cat > "$SCRATCH/new" <<'EOF'
  return `${historyPaths(home).root}/${RECALL_OFF_DIR}/${id}`;
EOF
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'RECALL_OFF_DIR is joined onto a path on one code line')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'historyPaths gains recallOffDir')
restore
# Expected RED (predicted): the join case `1 failed` (two lines spell ${RECALL_OFF_DIR}). CONTROL: the paths case stays
# green, so only the source pin sees a second join.

# M9: headlessOn spelled as a literal path, not through SWITCHES (an existing O13 guard covers the new line).
cat > "$SCRATCH/old" <<'EOF'
    headlessOn: `${h}/${SWITCHES.headlessOn}`,
EOF
cat > "$SCRATCH/new" <<'EOF'
    headlessOn: `${h}/.ccrc/history/headless-on`,
EOF
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'headless-on: named on a code line only')
restore
# Expected RED (predicted): `1 failed`: "headless-on: lib.mjs names it outside SWITCHES".

# M10: the gap bound moved.
cat > "$SCRATCH/old" <<'EOF'
export const RECALL_OFF_GAP_MS = 10 * 60 * 1000;
EOF
cat > "$SCRATCH/new" <<'EOF'
export const RECALL_OFF_GAP_MS = 60 * 1000;
EOF
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'meta prefix and its two chosen bounds')
restore
# Expected RED (predicted): `1 failed`: expected 60000 to be 600000.

# M11: a history module quotes the prefix's value instead of naming the constant (H-149's new row).
printf "const RO_SECOND = 'recall_off:';\n" >> ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'quoted once, at their declaration')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_OFF_META is declared in')
restore
# Expected RED (predicted): H-149 `1 failed` (RECALL_OFF_META: the value is quoted outside its declaration). CONTROL: the
# VOCABS row stays green, which is why H-149 carries the name.

# M12: a second declaration of a bound in another history module (VOCABS' new rows).
printf 'export const RECALL_OFF_SCAN_MAX = 4096;\n' >> ccd/history/sweep.mjs
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_OFF_SCAN_MAX is declared in')
restore
# Expected RED (predicted): `1 failed`: [ccd/history/lib.mjs, ccd/history/sweep.mjs].

# M13: a W2 build raises the schema (W2-D10's pin).
cat > "$SCRATCH/old" <<'EOF'
  2: Object.freeze({ heavy: true, tables: Object.freeze({}) }),
EOF
cat > "$SCRATCH/new" <<'EOF'
  2: Object.freeze({ heavy: true, tables: Object.freeze({}) }),
  3: Object.freeze({ heavy: false, tables: Object.freeze({}) }),
EOF
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-D10: the store schema stays at version 2')
restore
# Expected RED (predicted): `1 failed`: expected 3 to be 2.

# M14: a second module declares the predicate (the single-definition declaration pin). cli.mjs imports no
# isSyntheticModel, so the planted declaration loads; the pin reads text only.
printf 'function isSyntheticModel(model) { return false; }\n' >> ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'lib.mjs is the one file of the corpus that declares isSyntheticModel')
restore
# Expected RED (predicted): `1 failed`: [ccd/history/cli.mjs, ccd/history/lib.mjs].

for f in $FILES; do cmp "$f" "$SCRATCH/$(basename "$f").orig" || echo "NOT RESTORED: $f"; done
git status --short
```

Expected: each block's filter shows the red its comment names, and the final loop prints nothing. `git status --short` lists only this task's seven files. If a mutant cannot be made red, report it: never weaken the guard, and never make the CONTROL fixture fit the mutant.

- [ ] **Step 7: Run the neighbours that read these files.** Run each command in the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes; `session-hook` is one).

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'THE CITATION DEBT this task creates')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C68')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'the fixture path is lib.s recallOffPath|the driver names recall-off on exactly one code line')
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts)
```

Expected green. The predictions, by file:
- **The citation-debt case** is unchanged. This task's only line-count change in `single-definition.test.ts` is the +2 in `VOCABS` (about :5301), and every other change is a same-count line swap or is below the file's last describe. If the case's per-file census for `server/test/single-definition.test.ts` moves, record the measured number. Do not edit the census to fit it: stop and report.
- **`history-recall -t C68`:** the CLI's `recall-off` read gets the same path string from `recallOffPath`.
- **`history-replay`:** the driver's one `lstatSync(recallOffPath(home, id))` line, and its fixture path, still equal lib's.
- **`lifecycle`:** W2-D9; this task touches neither file.
- **`history-store`:** `SCHEMA_VERSION` equals `MIGRATIONS.length`, and W2-D10 is unchanged.

- [ ] **Step 8: Commit.** This task defines no departure, so `## Deviations found` is not touched.

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts deploy/history-gate.mjs deploy/measure-history.py \
  server/test/history-lib.test.ts server/test/measure-history.test.ts server/test/single-definition.test.ts
git commit -m "feat(history): lib names the recall-off directory, the presence record's prefix and bounds and the one synthetic-model test, and the gate and the census read them (W2-1 Task 2; W2-D17, W2-D23, W2-D29, W2-D30)"
```

**Mutants, by guard** (Step 6 measures each one red at this task's tip, then restores the file):

| Guard (new unless named) | Mutant | Must red |
|---|---|---|
| history-lib `isSyntheticModel: <label>` rows | M1 | `a bare <`, `an open bracket only`, `a trailing space` |
| history-lib `backendOf reads isSyntheticModel …` | M2 | that case |
| single-definition `W2-1 Task 2` angle-bracket census | M1, M2, M3 | `the angle-bracket model test is spelled on one code line …` |
| single-definition `W2-1 Task 2` declaration | M14 | `lib.mjs is the one file of the corpus that declares isSyntheticModel` |
| measure-history `the gate's code spells neither …` | M3, M4 | that case |
| measure-history import-line pin (W2-3's, edited in place) | M4 | `imports only node:crypto and lib.mjs, …` |
| W2-3's O14 local half (existing) | M4 | `O14, local half: the gate declares no name lib.mjs exports` |
| single-definition `VOCABS` rows | M4 (`RECALL_OFF_META`), M12 (`RECALL_OFF_SCAN_MAX`) | `<NAME> is declared in ccd/history/lib.mjs and in no other .mjs, …` |
| single-definition H-149 (extended) | M11 | `… and RECALL_OFF_META are quoted once, at their declaration (H-149)` |
| measure-history twin pin | M5, M5b | `the instrument's RECALL_OFF_META is lib's …` |
| measure-history emission and `changedFamilies` | M5, M5b, M6, M7 | `w2.recall_off is every meta row under RECALL_OFF_META …` |
| history-lib join pin | M8 | `RECALL_OFF_DIR is joined onto a path on one code line …` |
| O13 `headless-on` holders row (existing, covers the new line) | M9 | `headless-on: named on a code line only by its declaration and its readers …` |
| history-lib constants | M5b, M10 | `the presence record's meta prefix and its two chosen bounds are W2-D30's` |
| history-lib W2-D10 | M13 | `W2-D10: the store schema stays at version 2 …` |

The CONTROLs that must stay green under a mutant:
- RP6's `<synthetic>` case under M3: behaviour is unchanged, so only the pins see the mutant;
- W2-3 Task 5's describe under M4;
- the W2 raw rows case under M7;
- the paths case under M8;
- the `VOCABS` row under M11.

The CONTROL cases in each new describe are green at the base and stay green throughout.

---

### Task 3: the recall-off verb, end to end through the shim, and its one writer

At the base, `ccrc history recall-off` is B2's stub. `cli.mjs`'s `recallOffVerb` answers only its refusals (`bad-args`, `bad-id`, `generation-unreadable`), and every well-formed form is `bad-args` "naming W2". `sweep.mjs` has no `--op recall-off`: its `OP_VERBS` leaves it out, so the direct door answers `bad-args` too. Nothing in the tree writes `recall-off/<id>`, so every control-arm file the W2 eval needs would be planted by hand.

This task ships the verb (W2-D26, W2-D27 and W2-D28) and pins its one writer (W2-D29):
- **The verb writes as invoked, with no dry run** (W2-D26, D-5763). `formOf` already names both forms writing (`WRITING_FORMS`' `recall-off` and `recall-off-clear-all`), and this task gives them no dry run.
- **Its grammar** is `recall-off <id> [--generation <uuid>] [--clear]` and `recall-off --clear-all` (W2-D27, D-5764). lib's `parseOpVerbArgs` reads it for both doors:
  - `--generation` is a lowercase UUID, on the write form only; anything else is `bad-args`;
  - `bad-args` is decided before the id grammar, and an id off that grammar is `bad-id` before any path is formed from it (C66).
- **Under the shim's lock, the write form reads `$REG/<id>.generation` raw** and lib's `decideRecallOffWrite` decides W2-D27's table:

  | Registry `.generation` | Without `--generation` | With `--generation G` |
  |---|---|---|
  | unreadable | exit 2 `generation-unreadable` | the same |
  | absent | write `''` | exit 2 `generation-mismatch` |
  | empty, after trimming one LF | write `''` | exit 2 `generation-mismatch` |
  | a UUID | write it | write it iff it equals G; otherwise exit 2 `generation-mismatch` |
  | anything else | exit 2 `generation-malformed` | exit 2 `generation-malformed` |

  The two new words are exit-2 `REASONS`, listed in `REASON_ROWS` beside the comment `D-5764 (history-w2-recall-off-generation-checks)`. Every refusal answers before any write.
- **The executor is one function, `sweep.mjs`'s `recallOffPass`** (W2-D28). In order:
  - it creates `recall-off/` with mode 0700 and follows no link;
  - it removes every stale `~tmp.*` entry;
  - it writes `<generation>\n`, or an empty file for `''`, at 0600, through `recall-off/~tmp.<pid>`. The temp is opened `O_CREAT|O_EXCL|O_NOFOLLOW` and renamed within the directory;
  - `--clear` unlinks the one entry without following it, and a missing entry is rc 0;
  - `--clear-all` lstats every entry, whatever its name. It unlinks regular files and links, skips directories, FIFOs, sockets and devices, and prints `{rc, reason, cleared, skipped}`.

  `history-off` refuses both forms, and a recovery step refuses neither (RB12). The role gate and the `CLAUDECODE` bump apply at both doors.
- **One writer, and every reader on `readBounded`** (W2-D29; R3). Every content reader of a recall-off file in `ccd/history` moves onto `store.mjs`'s `readBounded(recallOffPath(...), CONTROL_FILE_MAX, false)`. Here that is `sweep.mjs`'s exported `recallOffPresence`, which the drain's stale check and the CLI's read verbs call; Task 4's scan calls `readBounded` itself, with the same arguments, and moves O13's reader count from 1 to 2. O13's last case becomes "recall-off/<id>: exactly one writer, sweep.mjs", with:
  - its needles;
  - the bash half;
  - the writer-shape rule;
  - its CONTROLs;
  - the KNOWN WIDTH comment.
- **The CLI's relay replaces the stub.** `recall-off` becomes an operator verb of the door that already relays `import`, `prune` and `reparse` (`OP_OF_VERB`, `runOpVerb`, `opRelay`). README states the verb. `shared/lifecycle.ts` declares `history-recall-off`, and `lifecycle.test.ts` appends `'W2-1'` to `HISTORY_LANDED` (W2-D3, W2-D9; R3).
- **C66's B2-half line is re-expected here** (R3). `history-recall.test.ts`' `C66 (B2 half)` expected `recall-off <id> --json` to answer `[2, 'bad-args']` ("the writing verb ships with W2"). This commit ships the verb, so it re-expects that line in the same commit, and every suite stays green at every commit.

**What W2-D20 asks of this task.** `marker --section ab` always printing `--generation` is W2-5b's: its marker subcommand lives in `deploy/history-replay.mjs`, which W2-1 never touches. From W2-1 it needs only that the verb accepts `--generation <uuid>` on the write form and refuses a generation that is not the id's (`generation-mismatch`). Steps 1 and 5 pin both. §7's residual stands as written: an empty `.generation` without `--generation` writes `''`, per the spec, and the W2 flow always passes `--generation`.

**The shim needs no edit.** `ccd/ccd-history-sweep` passes any `--op` verb to `sweep.mjs` under its `flock -n 9` (answering 75 when the lock is held, which the CLI reads as `writer-busy`). The gate, the role check and the verb are the sweep's. "End to end through the shim" is measured: every direct-door case below runs the placed shim (`runShim`), and every CLI-door case runs the CLI, which spawns it.

**Files:** (anchors measured at `02d75ae5f`; line numbers are hints only, so re-anchor each edit by its quoted content.)
- Modify: `ccd/history/lib.mjs`:
  - `REASON_ROWS`' `[EXIT.REFUSED, [ … ]]` array: two words and their comment, after the line `    'roster-unreadable', 'uuid-claimed',` (about :54 at 02d75ae5f);
  - `parseOpVerbArgs`: in its doc comment, the sentence that ends `` (recall-off is W2's) is `bad-args`. */ `` (about :5930); a `case 'recall-off':` directly above its `default:` (about :5985);
  - the section header `// ── recall: the read verbs' arguments, selects by store version, recall-off's B2 refusals (W1-B2 Task 10) ──` (about :7145);
  - `decideRecallOffPreflight` with its doc comment, which begins `` /** `recall-off` in B2 (slug history-recall-off-preflight-b2, NEW) `` (about :7308-7327). They are replaced by `decideRecallOffWrite`.
  - Not touched: `WRITING_FORMS` (about :95-96), `formOf` (about :1097-1098), `recoveryExempt`'s `case 'recall-off': return true;` (about :1118), `decideOpGate`, `decideRecallOff` and `RECALL_OFF_DIR`. Task 2 owns `historyPaths` and `recallOffPath`.
- Modify: `ccd/history/lib.d.mts`:
  - `OpArgs`' last arm, `  | { readonly op: 'rebuild'; readonly storeId: string | null };` (about :693);
  - the comment `// --- W1-B2 Task 10: the read verbs' arguments, version-aware selects, recall-off's B2 refusals` (about :802);
  - `RecallOffPreflight` and `decideRecallOffPreflight`'s declaration (about :826-829), replaced.
- Modify: `ccd/history/sweep.mjs`:
  - the `node:fs` import's names (about :33-36): `fchmodSync` and `mkdirSync` are added;
  - the lib import line `  decideRecallOff, recallOffPath, decideReparse, REPARSE_MAX_TARGETS, planCopy, STORE_DB_REL,` (about :59);
  - `recallOffPresence` with its doc comment (about :806-825), replaced by the exported one-reader version;
  - `OP_VERBS` and its doc comment (about :6260-6262);
  - `opPass`: an arm directly after the role check that ends `    out('history-sweep: store-create-refused-role');\n    return result(EXIT.NO_STORE);\n  }` (about :6706-6710);
  - the recall-off executor block, inserted directly after `writeOpMarker` (about :6343-6350), above `projectsRootOf`.
- Modify: `ccd/history/cli.mjs`:
  - the lib import lines `  decideIdentity, decideHarness, resolveGeneration, decideScope, parseReadArgs, decideRecallOffPreflight, paneOk,` and `  decideRecallOff, recallOffPath, parseSpoolLine, SCOPE_FAMILIES_JSON_MAX,` (about :59-60);
  - `import { loadSecrets, procIdentityOf, measureOpProcess } from './sweep.mjs';` (about :63);
  - the dispatcher comment's `` `recall-off`, which in B2 answers only its refusals `` lines (about :442-443);
  - `USAGE`'s operator-verbs line (about :469);
  - `FIELD_READ_MAX`'s comment (about :494);
  - in `readContextIn`, `  const offFile = presenceOf(recallOffPath(home, id));` (about :690);
  - `recallOffVerb` with its doc comment (about :917-927), deleted;
  - in `main`, `  if (verb === 'recall-off') return recallOffVerb(home, rest);` (about :938), deleted;
  - THE OPERATOR DOOR's first comment lines (about :1351-1352);
  - `OP_OF_VERB` (about :1380-1383).
- Modify: `shared/lifecycle.ts`: the `history-recall-off` row, inserted directly after the `history-replay-out` row, which ends `    ruling: 'operator-made; removed by hand once the W2 decision is recorded' },` (about :110-113). The file is L0 and imports nothing, so the edit is string text only.
- Modify: `README.md`: the "**Box verbs and operator verbs.**" paragraph's last line, `` an older restored store needs first and the `--adopt` an unbound one needs. `` (about :5740). Its words are kept: `history-skill.test.ts` pins them. New lines follow it.
- Test: `server/test/history-lib.test.ts`:
  - in `describe("parseOpVerbArgs: each verb's argv, decided once for both doors (spec 8.4)"`, the case `it('a verb B2 does not run is bad-args (recall-off ships in W2)', () => {` (about :6503-6506), re-expected in place with its line count unchanged: its `recall-off` line refused the verb this task ships, so it would red at this task's own commit;
  - one describe appended at the end of the file (pins C16's two words, W2-D27's grammar and its table).
- Test: `server/test/history-op.test.ts`: two describes appended at the end of the file. They pin C64's recall-off rows at both doors, the role gate, W2-D27's and W2-D28's mechanics through the shim (R3's unusable root and `recall-off/` among them), and in process the writer's own modes, open flags and directory fsync.
- Test: `server/test/history-cli.test.ts`: one describe appended at the end of the file. It pins the CLI door's relay, C16 spawned, and the README text. One in-place number: H-32's `the scan sees every stderr write` count goes from 9 to 8, because deleting `recallOffVerb` deletes the stub's one `process.stderr.write` (measured: the case reds `expected 8 to be 9` at Step 14's full history-cli run; a comment beside the number says why).
- Test: `server/test/history-recall.test.ts`:
  - the title line of the describe that holds the next case, `describe('the read verbs\' pure halves: parseReadArgs, selectColumns, decideRecallOffPreflight (W1-B2 Task 10)', () => {` (about :156), renamed in place so it names no removed function;
  - the case `it('decideRecallOffPreflight: the id grammar first, then the generation read, then W2\'s word', () => {` (about :203-214), replaced;
  - in `it('C66 (B2 half): …'`, the line `    expect(answer(runCli(box, ['recall-off', ID, '--json'])), 'the writing verb ships with W2').toEqual([2, 'bad-args']);` (about :412), replaced;
  - one describe appended at the end of the file, pinning W2-D29's one reader and RP10's verb half.
- Test: `server/test/history-recover.test.ts`: one describe appended at the end of the file (pins RB12 for recall-off at both doors, and C67 at the direct door).
- Test: `server/test/single-definition.test.ts`: inside `describe('ccrc history: the operator switches have readers only (spec 2026-10-05 §9.11 O13)'`:
  - the six comment lines that begin `` // `recall-off/<id>` is O13's seventh name `` (about :5119-5124);
  - the last case, `it('recall-off/<id>: no corpus file but sweep.mjs writes it (B1 holds this half; W2 adds sweep.mjs as its one writer)', () => {` (about :5273-5281), replaced. Every edit is below line 5100. `session-hook.test.ts`' citation audit anchors into this file only far above it (Step 14 runs it).
- Test: `server/test/lifecycle.test.ts`: the line `  const HISTORY_LANDED: readonly HistoryPr[] = ['B1', 'B2', 'B3', 'B4', 'W2-4'];` (about :1105); one case directly after the `history-replay-out` case, which ends `` expect(c!.root, 'the row names another marker than the driver writes').toContain(`marked by ${OUT_MARKER}`); `` and `  });` (about :1338-1339). The describe's closing `});` follows the new case.
- Not edited:
  - `ccd/ccd-history-sweep` (above);
  - `ccd/session-hook.sh`, whose comment about :2922-2925 still says "the CLI's is 4,096 bytes" (see Choices; R3);
  - `server/test/history-maint.test.ts`, whose C64 table (`GT_FORMS`) keeps excluding the recall-off pair by its own CONTROL;
  - the spec, whose errata E1, E3, E4 and E6 cite D-5763 and D-5764 (see Not in this task);
  - `deploy/**`, `server/test/history-replay.test.ts`, `.github/workflows/*`, `history-sweep.test.ts`, `measure-history.test.ts`.

**Interfaces:**
- Consumes:
  - Task 2's `historyPaths(home).recallOffDir: string` (`${root}/recall-off`) and its `recallOffPath(home: string, id: string): string`, which is `${historyPaths(home).recallOffDir}/${id}` after `idOk` and throws a `TypeError` on an id off the grammar.
  - `store.mjs`: `readBounded(path, max, follow): { state: 'absent' } | { state: 'unreadable' } | { state: 'over-cap' } | { state: 'value'; value: string }`; `CONTROL_FILE_MAX` (lib, 65536).
  - `sweep.mjs` (module-private, unchanged): `readSmall(path, max): Presence<string>`, raw and untrimmed, which folds over-cap into unreadable; `REG_VALUE_MAX` (4096); `ABSENT` and `UNREADABLE`; `fsyncDir(dir)`; `readRole(P)`.
  - lib (unchanged): `decideOpGate(form, env, isTTY, paneName)`, `recoveryExempt` (`'recall-off'` → true), `formOf('recall-off', args)`, `UUID_RE`, `idOk`, `EXIT`, `REASONS`, `decideRecallOff({ file, generation }): 'off' | 'stale' | 'none'`.
  - `cli.mjs` (unchanged): `runOpVerb`, `opRelay`, `operatorMain`, and lib's `decideRelay`, which reads a result line of `rc` and `reason` keys only.
- Produces:
  - lib `parseOpVerbArgs('recall-off', args)`: `{ ok: true, args: { op: 'recall-off', mode: 'write' | 'clear' | 'clear-all', id: string | null, generation: string | null } } | { ok: false, reason: 'bad-args' | 'bad-id' }`. `id` is null only for `clear-all`, and `generation` is non-null only for `write`.
  - lib `decideRecallOffWrite({ registry: Presence<string>, want: string | null }): { ok: true, generation: string } | { ok: false, rc: 2, reason: 'generation-unreadable' | 'generation-malformed' | 'generation-mismatch' }`. `generation` is `''` for the legacy family.
  - lib `REASONS['generation-malformed'] === 2` and `REASONS['generation-mismatch'] === 2`, so `REFUSALS` holds both.
  - lib: `decideRecallOffPreflight` and the `RecallOffPreflight` type are removed.
  - lib.d.mts: `OpArgs`' `recall-off` arm, `RecallOffWrite`, and `decideRecallOffWrite`, each declared once.
  - sweep `export function recallOffPresence(home: string, id: string): Presence<string>`: readBounded at `CONTROL_FILE_MAX`, never following a link, folding over-cap into unreadable, the value untrimmed. The drain and the CLI call it. Task 4's scan calls `readBounded` itself, with the same arguments, and folds over-cap into unreadable through lib's `recallOffStateOf` (R3).
  - sweep `export function recallOffPass(home: string, args: OpArgs & { op: 'recall-off' }, out: (line: string) => void): { rc: number; reason?: string }`.
  - sweep: `OP_VERBS` holds `'recall-off'`, and `opPass` answers it after the gate and the role check, before the lock-take journal half.
  - The `--op recall-off --clear-all` stdout carries one summary line, `{"rc":0,"reason":null,"cleared":<n>,"skipped":[<names>]}`, before the result line `{"rc":0}`. `cleared` is a count and `skipped` the sorted names (R3).
  - cli: `OP_OF_VERB['recall-off'] === 'recall-off'`, and `recallOffVerb` is removed. `readContextIn` reads `recall-off/<id>` through `recallOffPresence`.
  - `shared/lifecycle.ts`: the class `history-recall-off`.

**Spec:**
- §8.3's exit table, exit 2 (about :1671);
- §8.4's operator verbs (about :1741), "Dry run by default" (about :1742), and the `recall-off` bullets (about :1799-1800);
- §9.4's `history-recall-off` row (about :2170);
- §9.7's `recall-off/<id>` row (about :2314);
- O13 (about :2427), O17 (about :2431), C16 (about :1961), C64 (about :2010), C66 (about :2012), C67 (about :2013), and RP10 (about :2761).

This task edits none of them. Its departures are D-5763 (`history-w2-recall-off-no-dry-run`), D-5764 (`history-w2-recall-off-generation-checks`) and D-6239 (`history-recall-off-touches-no-store`, Choices; R3). Their entries are in this plan's `## Deviations found`, written with the plan, and Step 15 checks each.

**Choices this task makes:**
- **The pass touches no store** (D-6239; R3). `opPass` answers `recall-off` after THE GATE and the role check, and before the lock-take journal half. It opens no store, writes no op marker, journals nothing and flushes no outbox. That departs from two rules written for passes that write the store:
  - §9.2's "an --op pass runs the journal half too" (D-4232);
  - §8.4's "Every writing form flushes its outbox before it exits 0".

  The verb records nothing in the store, since the presence record is the tick's (W2-D30, Task 4), so it has nothing of its own to journal. It must also run on any store state, a recovery included (RB12). The store observes the control file only through Task 4's per-tick presence record.
- **An unusable directory answers exit 1, with one line and no word (R3).** A history root that is not a directory, or a `recall-off/` that is a link, a file, a special file or unmeasurable, answers `{"rc":1}` after one `history-sweep: recall-off: … is …, not a directory this pass writes in; nothing written` line. That is decided after the generation check and before any write, for every form. `REASONS` gains only the two words W2-D27 names; a third would need its own number.
- **`--clear` on an entry that is neither a file nor a link** (a directory, a FIFO, a socket or a device) answers exit 1 with one line naming it, and removes nothing (R3). That is `--clear-all`'s type rule applied to one entry: the operator removes it by hand. A missing entry is rc 0, as W2-D28 says, and an absent `recall-off/` is rc 0 for both clear forms, which never create it.
- **The `--clear-all` summary rides as an ordinary stdout line.** lib's `decideRelay` reads a result line holding `rc` and `reason` only, and answers exit 1 for any other key. So the summary `{rc, reason, cleared, skipped}` is printed on its own line before the result line `{"rc":0}`, and the CLI relays it: human mode on stdout, `--json` on stderr. `reason` is `null` there, because `--clear-all` past the directory check always answers rc 0: an entry it cannot remove is named in `skipped`. `cleared` is a count and `skipped` the sorted names (R3). Task 5's RP10 reads the summary from stderr under `--json`.
- **The registry read trims one LF, and only one** (W2-D27). `readSmall` reads `.generation` raw (following a link, as every registry read does; the writer's `W2-D27 under the lock` table has a linked row), and `decideRecallOffWrite` strips one trailing LF. A value padded otherwise is `generation-malformed`, where the drain's `readRegPresence` (which trims all whitespace) reads it as its generation. This refusal is in the safe direction: nothing is written.
- **The reader's window grows from 4,096 bytes (CLI) and 128 bytes (drain) to `CONTROL_FILE_MAX`** (W2-D29). A file over 64 KiB is unreadable, which reads as off (IV5). Both sides now read the whole file, so they agree on every file. The hook's comment in `ccd/session-hook.sh` (about :2922-2925) still says "the CLI's is 4,096 bytes". The hook reads `CCRC_ID_MAX` characters and withholds on a full read, so it still withholds wherever the CLI answers 8. Only that sentence goes stale, in a file outside W2-1's list: the next fleet PR that holds `ccd/session-hook.sh` corrects it (R3).
- **C64's recall-off rows live in `history-op.test.ts`, both doors.** `history-maint.test.ts`' C64 table (`GT_FORMS`, about :2603-2620) excludes the pair by its CONTROL and is not W2-1's file. The two forms are reversible, so every row runs piped, and the pane row proves tmux is never asked.
- **RP10's verb half is here; its card half is Task 5's** (R5). "The next card line serves for each family" needs the hook, which RP8's end-to-end case (W2-D32) already drives, so that half is beside it.

- [ ] **Step 1: Write the failing lib tests.** Two edits in `server/test/history-lib.test.ts`.

(a) Append at the end of the file:

```ts

// ── W2-1 Task 3: recall-off's grammar and its decision under the lock (W2-D27; D-5764 (history-w2-recall-off-generation-checks)) ──
// parseOpVerbArgs reads `recall-off <id> [--generation <uuid>] [--clear]` and `recall-off --clear-all` for both doors, every
// shape error bad-args before the id grammar's bad-id (C66). decideRecallOffWrite is W2-D27's table over $REG/<id>.generation
// read raw (one trailing LF trimmed, nothing else) and the --generation argument. Both new refusal words are exit-2 REASONS (C16).
describe('W2-1 recall-off: the grammar and the generation checks (D-5764)', () => {
  const G = '0189abcd-1234-4678-9abc-0123456789ab';
  const G2 = '0189abcd-1234-4678-9abc-0123456789ac';
  const RID = 'claude-a-demo';

  it('C16, its two words: generation-malformed and generation-mismatch are exit-2 REASONS words, so REFUSALS holds them', () => {
    expect(REASONS['generation-malformed']).toBe(EXIT.REFUSED);
    expect(REASONS['generation-mismatch']).toBe(EXIT.REFUSED);
    expect(REFUSALS).toEqual(expect.arrayContaining(['generation-unreadable', 'generation-malformed', 'generation-mismatch']));
  });

  it('REASON_ROWS lists the two words beside their departure, D-5764', () => {
    const src = readFileSync(fileURLToPath(new URL('../../ccd/history/lib.mjs', import.meta.url)), 'utf8').split('\n');
    const at = src.findIndex((l) => l.includes("'generation-malformed', 'generation-mismatch',"));
    expect(at, 'REASON_ROWS lists the two words on one line').toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 4), at).join('\n')).toContain('D-5764 (history-w2-recall-off-generation-checks)');
  });

  const READS: ReadonlyArray<readonly [string, readonly string[], Record<string, unknown>]> = [
    ['the write form', [RID], { op: 'recall-off', mode: 'write', id: RID, generation: null }],
    ['the write form with --generation', [RID, '--generation', G], { op: 'recall-off', mode: 'write', id: RID, generation: G }],
    ['--generation before the id', ['--generation', G, RID], { op: 'recall-off', mode: 'write', id: RID, generation: G }],
    ['--clear', [RID, '--clear'], { op: 'recall-off', mode: 'clear', id: RID, generation: null }],
    ['--clear-all alone', ['--clear-all'], { op: 'recall-off', mode: 'clear-all', id: null, generation: null }],
  ];
  it.each(READS)('recall-off argv reads: %s', (_what, argv, args) => {
    expect(libPlan.parseOpVerbArgs('recall-off', argv)).toEqual({ ok: true, args });
  });

  const REFUSES: ReadonlyArray<readonly [string, readonly string[], string]> = [
    ['no id', [], 'bad-args'],
    ['two ids', [RID, RID], 'bad-args'],
    ['--generation with no value', [RID, '--generation'], 'bad-args'],
    ['an upper-case UUID', [RID, '--generation', G.toUpperCase()], 'bad-args'],
    ['a padded UUID', [RID, '--generation', ` ${G}`], 'bad-args'],
    ['a word for a UUID', [RID, '--generation', 'not-a-uuid'], 'bad-args'],
    ['--generation with --clear', [RID, '--generation', G, '--clear'], 'bad-args'],
    ['--clear then --generation', [RID, '--clear', '--generation', G], 'bad-args'],
    ['--generation twice', [RID, '--generation', G, '--generation', G], 'bad-args'],
    ['--clear twice', [RID, '--clear', '--clear'], 'bad-args'],
    ['--clear-all with an id', ['--clear-all', RID], 'bad-args'],
    ['--clear-all with --generation', ['--clear-all', '--generation', G], 'bad-args'],
    ['--clear-all twice', ['--clear-all', '--clear-all'], 'bad-args'],
    ['an unknown flag', [RID, '--bogus'], 'bad-args'],
    ['a shape error before a bad id', ['../x', '--generation', 'not-a-uuid'], 'bad-args'],
    ['an id that climbs out', ['../x', '--clear'], 'bad-id'],
    ['the id ..', ['..'], 'bad-id'],
    ['an id with a slash', ['a/b', '--generation', G], 'bad-id'],
  ];
  it.each(REFUSES)('recall-off argv refuses: %s', (_what, argv, reason) => {
    expect(libPlan.parseOpVerbArgs('recall-off', argv)).toEqual({ ok: false, reason });
  });

  const no = (reason: string): Record<string, unknown> => ({ ok: false, rc: EXIT.REFUSED, reason });
  const yes = (generation: string): Record<string, unknown> => ({ ok: true, generation });
  // [what, the registry read, --generation, the answer]
  const DECIDES: ReadonlyArray<readonly [string, Record<string, unknown>, string | null, Record<string, unknown>]> = [
    ['unreadable, no --generation', { state: 'unreadable' }, null, no('generation-unreadable')],
    ['unreadable, --generation G', { state: 'unreadable' }, G, no('generation-unreadable')],
    ['over the cap is unreadable', { state: 'over-cap' }, null, no('generation-unreadable')],
    ['absent, no --generation: the legacy family', { state: 'absent' }, null, yes('')],
    ['absent, --generation G', { state: 'absent' }, G, no('generation-mismatch')],
    ['empty, no --generation', { state: 'value', value: '' }, null, yes('')],
    ['one LF, no --generation', { state: 'value', value: '\n' }, null, yes('')],
    ['empty, --generation G', { state: 'value', value: '' }, G, no('generation-mismatch')],
    ['G, no --generation', { state: 'value', value: G }, null, yes(G)],
    ['G and one LF, no --generation', { state: 'value', value: `${G}\n` }, null, yes(G)],
    ['G, --generation G', { state: 'value', value: G }, G, yes(G)],
    ['G, --generation G2', { state: 'value', value: G }, G2, no('generation-mismatch')],
    ['G and two LFs', { state: 'value', value: `${G}\n\n` }, null, no('generation-malformed')],
    ['G padded with a space', { state: 'value', value: ` ${G}` }, null, no('generation-malformed')],
    ['G upper-cased', { state: 'value', value: G.toUpperCase() }, null, no('generation-malformed')],
    ['a word, --generation G', { state: 'value', value: 'not-a-generation' }, G, no('generation-malformed')],
    ['two LFs alone', { state: 'value', value: '\n\n' }, null, no('generation-malformed')],
  ];
  it.each(DECIDES)('decideRecallOffWrite: %s', async (_what, registry, want, answer) => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.decideRecallOffWrite({ registry: registry as never, want })).toEqual(answer);
  });
});
```

(b) Re-expect the base case that refuses the verb this task ships. Anchor it first; the command prints `1`:

```bash
grep -c "it('a verb B2 does not run is bad-args (recall-off ships in W2)', () => {" server/test/history-lib.test.ts
```

In `describe("parseOpVerbArgs: each verb's argv, decided once for both doors (spec 8.4)"` (about :6503-6506), replace

```ts
  it('a verb B2 does not run is bad-args (recall-off ships in W2)', () => {
    expect(why('recall-off', ['claude-demo'])).toBe('bad-args');
    expect(why('frobnicate', [])).toBe('bad-args');
  });
```

with the same four lines, so no line below it moves:

```ts
  it('a verb this build does not run is bad-args, and recall-off parses since W2-1', () => {
    expect(ok('recall-off', ['claude-demo'])).toEqual({ op: 'recall-off', mode: 'write', id: 'claude-demo', generation: null });
    expect(why('frobnicate', [])).toBe('bad-args');
  });
```

The describe's own `ok` helper throws `recall-off claude-demo: bad-args` while the verb is refused, so the case is red until Step 3 lands, and `frobnicate` stays its CONTROL.

- [ ] **Step 2: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-1 recall-off')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'recall-off parses since W2-1')
```

Expected RED (predicted): 27 failed | 15 passed. Every `decideRecallOffWrite` row (17) fails with `lib.decideRecallOffWrite is not a function`. Every `recall-off argv reads` row (5) fails with `expected { ok: false, reason: 'bad-args' } to deeply equal { ok: true, … }`. The three `bad-id` rows fail with `reason: 'bad-args'`, because the base's `default:` arm refuses every recall-off argv. The C16 case fails with `expected undefined to be 2`, and the comment case with `REASON_ROWS lists the two words on one line: expected -1 to be greater than -1`. The 15 `bad-args` rows pass at the base for that same reason. Step 13's M5 and M6 are what pin them.

Then 1 failed: Step 1 (b)'s re-expected case, with `Error: recall-off claude-demo: bad-args` thrown by the describe's `ok` helper (its `frobnicate` CONTROL is never reached on the red run; it is checked green at Step 4).

- [ ] **Step 3: Write the lib grammar, the decision and the two words.** In `ccd/history/lib.mjs`:

(a) In `REASON_ROWS`, replace

```js
    'roster-unreadable', 'uuid-claimed',
  ]],
```

with

```js
    'roster-unreadable', 'uuid-claimed',
    // `generation-malformed` and `generation-mismatch` (W2-1, W2-D27): recall-off's two refusals of the id's generation,
    // decided under the shim's lock before any write: $REG/<id>.generation holds neither nothing nor one generation, or
    // `--generation` names another than the registry's (or the registry holds none).
    // D-5764 (history-w2-recall-off-generation-checks)
    'generation-malformed', 'generation-mismatch',
  ]],
```

(b) In `parseOpVerbArgs`' doc comment, replace

```js
 *  `restore-refused` when it is not one (C57). `rebuild` takes `--store-id <uuid>`. A verb B2 does not run
 *  (recall-off is W2's) is `bad-args`. */
```

with

```js
 *  `restore-refused` when it is not one (C57). `rebuild` takes `--store-id <uuid>`. `recall-off` (W2-1, W2-D27;
 *  D-5764 (history-w2-recall-off-generation-checks)) takes `<id> [--generation <uuid>]`, `<id> --clear`, or `--clear-all`
 *  alone; `--generation` is a lowercase UUID on the write form only. Any other verb is `bad-args`. */
```

If the base's sentence is wrapped at another point, re-anchor on the words `` (recall-off is W2's) is `bad-args`. */ ``. Then, directly above that function's

```js
    default:
      return refuse('bad-args');
  }
}
```

insert

```js
    case 'recall-off': {
      // Every shape error is bad-args, read before the id grammar, which is bad-id before any path is formed (C66).
      if (args.length === 1 && args[0] === '--clear-all') return ok({ op, mode: 'clear-all', id: null, generation: null });
      const r = readOpFlags(args, { '--generation': 'value', '--clear': 'bool' });
      if (r === null || r.positional.length !== 1) return refuse('bad-args');
      const generation = r.flags['--generation'] ?? null;
      const clear = r.flags['--clear'] === true;
      if (generation !== null && (clear || !UUID_RE.test(generation))) return refuse('bad-args');
      const id = r.positional[0];
      if (!idOk(id)) return refuse('bad-id');
      return ok({ op, mode: clear ? 'clear' : 'write', id, generation });
    }
```

(c) Replace the section header

```js
// ── recall: the read verbs' arguments, selects by store version, recall-off's B2 refusals (W1-B2 Task 10) ──
```

with

```js
// ── recall: the read verbs' arguments and selects by store version (W1-B2 Task 10); recall-off's write, decided (W2-1) ──
```

(d) Replace `decideRecallOffPreflight` and its whole doc comment (from `` /** `recall-off` in B2 (slug history-recall-off-preflight-b2, NEW) `` through the function's closing `}`) with

```js
/** What `recall-off <id> [--generation G]` writes, decided under the shim's lock (W2-1, W2-D27; D-5764
 *  (history-w2-recall-off-generation-checks)). `registry` is $REG/<id>.generation read raw now: absent, unreadable, or its
 *  text (any other state, an over-cap read, is unreadable here too). `want` is the `--generation` argument, or null. One
 *  trailing LF is trimmed and nothing else: ccd writes the field with no LF, and a padded value is not a generation.
 *   - unreadable: generation-unreadable, with or without want (C67: a '' written then would put a pre-registered control
 *     family in the treatment arm);
 *   - absent, or empty after that trim: '' (the legacy family, §8.4; the hook's "absent or empty" reading), or
 *     generation-mismatch when want names a generation;
 *   - a UUID: it, when want is null or equals it; otherwise generation-mismatch;
 *   - anything else: generation-malformed, with or without want.
 *  A refusal is `{ ok: false, rc, reason }`, which the executor answers before any write. */
export function decideRecallOffWrite({ registry, want }) {
  const refuse = (reason) => ({ ok: false, rc: EXIT.REFUSED, reason });
  if (registry.state !== 'absent' && registry.state !== 'value') return refuse('generation-unreadable');
  const raw = registry.state === 'absent' ? '' : registry.value;
  const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  if (text === '') return want === null ? { ok: true, generation: '' } : refuse('generation-mismatch');
  if (!UUID_RE.test(text)) return refuse('generation-malformed');
  return want === null || want === text ? { ok: true, generation: text } : refuse('generation-mismatch');
}
```

In `ccd/history/lib.d.mts`, replace

```ts
  | { readonly op: 'rebuild'; readonly storeId: string | null };
```

with

```ts
  | { readonly op: 'rebuild'; readonly storeId: string | null }
  | { readonly op: 'recall-off'; readonly mode: 'write' | 'clear' | 'clear-all'; readonly id: string | null; readonly generation: string | null };
```

Replace `// --- W1-B2 Task 10: the read verbs' arguments, version-aware selects, recall-off's B2 refusals` with `// --- W1-B2 Task 10: the read verbs' arguments, version-aware selects; W2-1: recall-off's write, decided`. Then replace

```ts
export type RecallOffPreflight =
  | { done: true; exit: 2; reason: 'bad-args' | 'bad-id' | 'generation-unreadable' }
  | { done: false; id: string };
export function decideRecallOffPreflight(i: { args: readonly string[]; generation: Presence<string> | null }): RecallOffPreflight;
```

with

```ts
export type RecallOffWrite =
  | { ok: true; generation: string }
  | { ok: false; rc: 2; reason: 'generation-unreadable' | 'generation-malformed' | 'generation-mismatch' };
export function decideRecallOffWrite(i: { registry: Presence<string>; want: string | null }): RecallOffWrite;
```

`cli.mjs` still imports `decideRecallOffPreflight` until Step 7 removes the stub, so the CLI does not load between Steps 3 and 7. Step 4 runs no CLI. Commit nothing before Step 16.

- [ ] **Step 4: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-1 recall-off')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'exit codes and reason words|writing forms')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'recall-off parses since W2-1')
```

Expected: 42 passed, then every case of the two older describes passes unchanged, then 1 passed (Step 1 (b)'s case: the write form parses and `frobnicate` is still `bad-args`).

- [ ] **Step 5: Write the failing delivery tests.** Six files.

(a) `server/test/history-op.test.ts`: append at the end of the file:

```ts

// ── W2-1 Task 3: the recall-off verb through the shim (W2-D26, W2-D27, W2-D28; D-5763, D-5764) ─────────────────────
// recall-off writes as invoked, with no dry run (D-5763), through the REAL shim, which execs the REAL sweep.mjs. Its one
// writer is sweep.mjs's recallOffPass (O13). C64's rows for its two forms are here, both doors: the forms are reversible,
// so the TTY and pane bumps never apply and every row runs piped (history-maint.test.ts's C64 table, GT_FORMS, excludes
// them by its CONTROL). The mechanics are W2-D27's table under the lock (D-5764) and W2-D28's writer.
const W21_G2 = '0189abcd-1234-4678-9abc-0123456789ac';
const w21Dir = (box: HistoryBox): string => path.join(paths(box).root, 'recall-off');
interface W21Answer { code: number; reason: string | undefined; raw: string; stdout: string }
/** A bound fleet box (a server box has no store) whose $REG/<ID>.generation is G1. */
function w21Box(prefix: string, role: 'fleet' | 'server' = 'fleet'): HistoryBox {
  const box = role === 'server' ? makeHistoryBox(prefix, { role: 'server' }) : boundBox(prefix);
  plantSession(box, ID, { generation: G1 });
  return box;
}
/** `ccrc history recall-off <args> --json`, piped: the envelope is stdout's last line, and its exit the process's. */
function w21Cli(box: HistoryBox, args: string[], env: Record<string, string> = {}): W21Answer {
  const r = runCli(box, ['recall-off', ...args, '--json'], { env });
  const raw = `${r.stdout}${r.stderr}`;
  expect(r.json, `the --json envelope is stdout's last line\n${raw}`).not.toBeNull();
  expect(r.code, `the process exits with the envelope's exit\n${raw}`).toBe(r.json!['exit']);
  const reason = r.json!['reason'];
  return { code: r.code!, reason: typeof reason === 'string' ? reason : undefined, raw, stdout: r.stdout };
}
/** `ccd-history-sweep --op recall-off <args>`, piped: the last {"rc":…} line, and its rc the process's. */
function w21Op(box: HistoryBox, args: string[], env: Record<string, string> = {}): W21Answer {
  const r = runShim(box, ['--op', 'recall-off', ...args], { env });
  const raw = `${r.stdout}${r.stderr}`;
  const a = lastResult(r.stdout);
  expect(r.code, `the process exits with the rc it printed\n${raw}`).toBe(a.rc);
  return { code: a.rc, reason: a.reason, raw, stdout: r.stdout };
}
/** --clear-all's summary line, which precedes the result line. */
function w21Summary(stdout: string): unknown {
  const lines = stdout.trimEnd().split('\n');
  const at = lines.findIndex((l) => l.startsWith('{"rc"') && l.includes('"cleared"'));
  expect(at, `no --clear-all summary line in:\n${stdout}`).toBeGreaterThan(-1);
  expect(at, 'the summary precedes the result line').toBeLessThan(lines.length - 1);
  return JSON.parse(lines[at]!);
}

describe('W2-1 recall-off: C64, its two forms at both doors', () => {
  const FORMS = [
    { form: 'recall-off', args: [ID] },
    { form: 'recall-off-clear-all', args: ['--clear-all'] },
  ] as const;

  it('CONTROL: the rows are the recall-off forms of WRITING_FORMS, reversible and not binding, each named by formOf from its own argv', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(FORMS.map((f) => f.form).sort()).toEqual(Object.keys(WRITING_FORMS).filter((k) => k.startsWith('recall-off')).sort());
    for (const f of FORMS) {
      expect(lib.formOf('recall-off', [...f.args]), f.form).toBe(f.form);
      expect(WRITING_FORMS[f.form]!.irreversible, f.form).toBe(false);
      expect(WRITING_FORMS[f.form]!.binding, f.form).toBe(false);
    }
  });

  it('CLAUDECODE set: both forms answer apply-in-session at both doors and write nothing', () => {
    const box = w21Box('ccrc-hist-w21-c64a-');
    for (const f of FORMS) {
      const before = snapshot(box);
      const c = w21Cli(box, [...f.args], { CLAUDECODE: '1' });
      expect([c.code, c.reason], `${f.form} via cli\n${c.raw}`).toEqual([2, 'apply-in-session']);
      const d = w21Op(box, [...f.args], { CLAUDECODE: '1' });
      expect([d.code, d.reason], `${f.form} via direct\n${d.raw}`).toEqual([2, 'apply-in-session']);
      expect(snapshot(box), `${f.form}: nothing written`).toEqual(before);
    }
  }, 60_000);

  it('history-off: both forms answer history-off at both doors, neither binding a store, and write nothing', () => {
    const box = w21Box('ccrc-hist-w21-c64b-');
    fs.writeFileSync(paths(box).off, '');
    for (const f of FORMS) {
      const before = snapshot(box);
      const c = w21Cli(box, [...f.args]);
      expect([c.code, c.reason], `${f.form} via cli\n${c.raw}`).toEqual([2, 'history-off']);
      const d = w21Op(box, [...f.args]);
      expect([d.code, d.reason], `${f.form} via direct\n${d.raw}`).toEqual([2, 'history-off']);
      expect(snapshot(box), `${f.form}: nothing written`).toEqual(before);
    }
  }, 60_000);

  it('piped, from a cc- pane: both forms pass every bump at both doors and write as invoked, with no dry run (D-5763); tmux is never asked', async () => {
    const box = w21Box('ccrc-hist-w21-c64c-');
    const hh = await import('./historyHelpers.js');
    const pane = hh.withPane(box, ID);
    for (const door of ['cli', 'direct'] as const) {
      const run = (args: string[]): W21Answer => (door === 'cli' ? w21Cli(box, args, pane) : w21Op(box, args, pane));
      const w = run([ID]);
      expect([w.code, w.reason], `write via ${door}\n${w.raw}`).toEqual([0, undefined]);
      expect(fs.readFileSync(path.join(w21Dir(box), ID), 'utf8'), `write via ${door}: written as invoked`).toBe(`${G1}\n`);
      const c = run(['--clear-all']);
      expect([c.code, c.reason], `clear-all via ${door}\n${c.raw}`).toEqual([0, undefined]);
      expect(names(w21Dir(box)), `clear-all via ${door}: cleared as invoked`).toEqual([]);
    }
    expect(fs.existsSync(path.join(box.home, 'tmux-calls')), 'a reversible form never reads the pane').toBe(false);
  }, 60_000);

  it('the role gate: on a server box both doors answer 9 and write nothing; the direct door says store-create-refused-role', () => {
    const box = w21Box('ccrc-hist-w21-role-', 'server');
    const before = snapshot(box);
    const c = w21Cli(box, [ID]);
    expect([c.code, c.reason], c.raw).toEqual([9, undefined]);
    const d = w21Op(box, [ID]);
    expect([d.code, d.reason], d.raw).toEqual([9, undefined]);
    expect(d.raw).toContain('history-sweep: store-create-refused-role');
    expect(snapshot(box), 'nothing written').toEqual(before);
  }, 60_000);
});

describe('W2-1 recall-off: the writer through the shim (W2-D27, W2-D28)', () => {
  it('the write form makes recall-off/ 0700 and writes `<generation>\\n` at 0600, leaving no temp; a legacy family\'s file is empty', () => {
    const box = w21Box('ccrc-hist-w21-w-');
    const dir = w21Dir(box);
    const w = w21Op(box, [ID]);
    expect([w.code, w.reason], w.raw).toEqual([0, undefined]);
    expect(w.stdout).toContain(`history-sweep: recall-off/${ID} written`);
    expect(fs.lstatSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.lstatSync(path.join(dir, ID)).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(path.join(dir, ID), 'utf8')).toBe(`${G1}\n`);
    const LEGACY = 'claude-a-legacy';   // no $REG/<id>.generation: the legacy '' family (§8.4)
    expect(w21Op(box, [LEGACY]).code).toBe(0);
    expect(fs.readFileSync(path.join(dir, LEGACY), 'utf8')).toBe('');
    expect(fs.lstatSync(path.join(dir, LEGACY)).mode & 0o777).toBe(0o600);
    expect(names(dir)).toEqual([ID, LEGACY].sort());
  }, 60_000);

  // [what, $REG/<id>.generation ('<dir>': a directory, which no read opens; '<link>': a link to a file holding G1, which the
  // registry read follows, as every registry read does; null: absent), extra argv, rc, reason, the file after (null: none)]
  const TABLE: ReadonlyArray<readonly [string, string | null, readonly string[], number, string | undefined, string | null]> = [
    ['unreadable, no --generation', '<dir>', [], 2, 'generation-unreadable', null],
    ['unreadable, --generation G1', '<dir>', ['--generation', G1], 2, 'generation-unreadable', null],
    ['absent, no --generation: the legacy family', null, [], 0, undefined, ''],
    ['absent, --generation G1', null, ['--generation', G1], 2, 'generation-mismatch', null],
    ['empty, no --generation', '', [], 0, undefined, ''],
    ['one LF, no --generation', '\n', [], 0, undefined, ''],
    ['empty, --generation G1', '', ['--generation', G1], 2, 'generation-mismatch', null],
    ['G1, no --generation', G1, [], 0, undefined, `${G1}\n`],
    ['G1 and one LF, --generation G1', `${G1}\n`, ['--generation', G1], 0, undefined, `${G1}\n`],
    ['G1, --generation G2', G1, ['--generation', W21_G2], 2, 'generation-mismatch', null],
    ['G1 and two LFs', `${G1}\n\n`, [], 2, 'generation-malformed', null],
    ['G1 upper-cased', G1.toUpperCase(), [], 2, 'generation-malformed', null],
    ['a word, --generation G1', 'not-a-generation', ['--generation', G1], 2, 'generation-malformed', null],
    ['a link to a file holding G1, no --generation', '<link>', [], 0, undefined, `${G1}\n`],
  ];
  it('W2-D27 under the lock, row by row: every refusal answers before any write, and every write holds the decided generation', () => {
    const box = w21Box('ccrc-hist-w21-t-');
    const reg = path.join(box.reg, `${ID}.generation`);
    const target = path.join(box.home, 'generation-target');
    fs.writeFileSync(target, G1);
    for (const [what, plant, extra, rc, reason, content] of TABLE) {
      fs.rmSync(w21Dir(box), { recursive: true, force: true });
      fs.rmSync(reg, { recursive: true, force: true });
      if (plant === '<dir>') fs.mkdirSync(reg);
      else if (plant === '<link>') fs.symlinkSync(target, reg);
      else if (plant !== null) fs.writeFileSync(reg, plant);
      const before = snapshot(box);
      const r = w21Op(box, [ID, ...extra]);
      expect([r.code, r.reason], `${what}\n${r.raw}`).toEqual([rc, reason]);
      if (content === null) expect(snapshot(box), `${what}: nothing written`).toEqual(before);
      else expect(fs.readFileSync(path.join(w21Dir(box), ID), 'utf8'), what).toBe(content);
    }
  }, 120_000);

  it('bad-args and bad-id at the direct door, before anything is written: an upper-case or padded --generation, --generation with --clear, --clear-all with more, no id, an id off the grammar', () => {
    const box = w21Box('ccrc-hist-w21-ba-');
    const before = snapshot(box);
    const ROWS: ReadonlyArray<readonly [readonly string[], string]> = [
      [[ID, '--generation', G1.toUpperCase()], 'bad-args'], [[ID, '--generation', ` ${G1}`], 'bad-args'],
      [[ID, '--generation', G1, '--clear'], 'bad-args'], [['--clear-all', ID], 'bad-args'], [[], 'bad-args'],
      [['../x', '--clear'], 'bad-id'],
    ];
    for (const [args, reason] of ROWS) {
      const r = w21Op(box, [...args]);
      expect([r.code, r.reason], `${JSON.stringify(args)}\n${r.raw}`).toEqual([2, reason]);
    }
    expect(snapshot(box), 'nothing written').toEqual(before);
  }, 60_000);

  it('stale ~tmp entries are removed by every form, a planted link among them never followed', () => {
    const box = w21Box('ccrc-hist-w21-tmp-');
    const dir = w21Dir(box);
    const victim = path.join(box.home, 'victim');
    fs.writeFileSync(victim, 'keep');
    const plant = (): void => {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, '~tmp.4242'), 'stale');
      fs.symlinkSync(victim, path.join(dir, '~tmp.1'));
    };
    plant();
    expect(w21Op(box, [ID]).code).toBe(0);
    expect(names(dir), 'the write form').toEqual([ID]);
    plant();
    expect(w21Op(box, ['claude-a-other', '--clear']).code, 'a missing entry is rc 0').toBe(0);
    expect(names(dir), 'the clear form').toEqual([ID]);
    plant();
    const all = w21Op(box, ['--clear-all']);
    expect([all.code, all.reason], all.raw).toEqual([0, undefined]);
    expect(w21Summary(all.stdout), 'the stale temps are gone before the listing').toEqual({ rc: 0, reason: null, cleared: 1, skipped: [] });
    expect(names(dir)).toEqual([]);
    expect(fs.readFileSync(victim, 'utf8'), 'no link followed').toBe('keep');
  }, 60_000);

  it('the executor follows no link: a link at recall-off/<id> is replaced or unlinked, never written through; a link at recall-off/ refuses every form, rc 1, writing nothing', () => {
    const box = w21Box('ccrc-hist-w21-link-');
    const dir = w21Dir(box);
    const victim = path.join(box.home, 'victim');
    fs.writeFileSync(victim, 'keep');
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.symlinkSync(victim, path.join(dir, ID));
    expect(w21Op(box, [ID]).code).toBe(0);
    expect(fs.lstatSync(path.join(dir, ID)).isFile(), 'the rename replaced the link').toBe(true);
    expect(fs.readFileSync(path.join(dir, ID), 'utf8')).toBe(`${G1}\n`);
    expect(fs.readFileSync(victim, 'utf8'), 'the write went through no link').toBe('keep');
    fs.rmSync(path.join(dir, ID));
    fs.symlinkSync(victim, path.join(dir, ID));
    expect(w21Op(box, [ID, '--clear']).code).toBe(0);
    expect(names(dir), 'the link itself is unlinked').toEqual([]);
    expect(fs.readFileSync(victim, 'utf8'), 'its target is not').toBe('keep');
    fs.rmdirSync(dir);
    const elsewhere = path.join(box.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, dir);
    for (const args of [[ID], [ID, '--clear'], ['--clear-all']]) {
      const r = w21Op(box, args);
      expect([r.code, r.reason], `${JSON.stringify(args)}\n${r.raw}`).toEqual([1, undefined]);
      expect(r.stdout).toContain('history-sweep: recall-off: ~/.ccrc/history/recall-off is a link, not a directory this pass writes in; nothing written');
    }
    expect(names(elsewhere), 'nothing written through the link').toEqual([]);
  }, 60_000);

  // R3's other unusable directories: a recall-off/ that is a file or a FIFO, and a history root that is a link or a file.
  // The root is lstat'ed before recall-off/ is, so a link at the root is refused, never followed into recall-off/.
  it('an unusable history root or recall-off/ refuses every form, rc 1, writing nothing: recall-off/ a file or a FIFO, the root a link to a directory or a file', () => {
    const box = w21Box('ccrc-hist-w21-root-');
    const root = paths(box).root;
    const dir = w21Dir(box);
    const refusesEveryForm = (what: string, line: string): void => {
      for (const args of [[ID], [ID, '--clear'], ['--clear-all']]) {
        const before = snapshot(box);
        const r = w21Op(box, args);
        expect([r.code, r.reason], `${what}: ${JSON.stringify(args)}\n${r.raw}`).toEqual([1, undefined]);
        expect(r.stdout, `${what}: ${JSON.stringify(args)}`).toContain(`history-sweep: recall-off: ${line}, not a directory this pass writes in; nothing written`);
        expect(snapshot(box), `${what}: ${JSON.stringify(args)}: nothing written`).toEqual(before);
      }
    };
    fs.writeFileSync(dir, '');
    refusesEveryForm('recall-off/ a file', '~/.ccrc/history/recall-off is a file');
    fs.rmSync(dir);
    expect(spawnSync('mkfifo', [dir]).status, 'CONTROL: the FIFO was made').toBe(0);
    refusesEveryForm('recall-off/ a FIFO', '~/.ccrc/history/recall-off is a FIFO, a socket or a device');
    fs.rmSync(dir);
    const moved = path.join(box.home, 'history-moved');      // outside ~/.ccrc, so snapshot() never walks it: checked by hand
    fs.renameSync(root, moved);
    fs.symlinkSync(moved, root);
    refusesEveryForm('the root a link', '~/.ccrc/history is a link');
    expect(fs.existsSync(path.join(moved, 'recall-off')), 'nothing made behind the link').toBe(false);
    fs.rmSync(root);
    fs.writeFileSync(root, '');
    refusesEveryForm('the root a file', '~/.ccrc/history is a file');
  }, 120_000);

  it('the clear form: a missing entry, and a missing recall-off/, are rc 0 and make nothing; a directory at the entry is left, rc 1', () => {
    const box = w21Box('ccrc-hist-w21-clear-');
    const dir = w21Dir(box);
    const none = w21Op(box, [ID, '--clear']);
    expect([none.code, none.reason], none.raw).toEqual([0, undefined]);
    expect(fs.existsSync(dir), 'a clear never makes recall-off/').toBe(false);
    fs.mkdirSync(path.join(dir, ID), { recursive: true });
    const d = w21Op(box, [ID, '--clear']);
    expect([d.code, d.reason], d.raw).toEqual([1, undefined]);
    expect(d.stdout).toContain(`history-sweep: recall-off/${ID} is a directory, neither a file nor a link`);
    expect(fs.lstatSync(path.join(dir, ID)).isDirectory(), 'left for the operator').toBe(true);
  }, 60_000);

  it('--clear-all lstats every entry, whatever its name: files and links unlinked, a directory and a FIFO skipped and named; its summary precedes the result; with no recall-off/ it makes none', () => {
    const box = w21Box('ccrc-hist-w21-all-');
    const dir = w21Dir(box);
    const none = w21Op(box, ['--clear-all']);
    expect([none.code, none.reason], none.raw).toEqual([0, undefined]);
    expect(w21Summary(none.stdout)).toEqual({ rc: 0, reason: null, cleared: 0, skipped: [] });
    expect(fs.existsSync(dir), 'clear-all never makes recall-off/').toBe(false);
    const victim = path.join(box.home, 'victim');
    fs.writeFileSync(victim, 'keep');
    fs.mkdirSync(dir, { mode: 0o700 });
    for (const n of [ID, 'claude-b-demo']) fs.writeFileSync(path.join(dir, n), `${G1}\n`);
    fs.writeFileSync(path.join(dir, 'not an id'), '');                 // off the id grammar: lstat'ed all the same
    fs.symlinkSync(victim, path.join(dir, 'claude-c-link'));
    fs.mkdirSync(path.join(dir, 'claude-d-dir'));
    expect(spawnSync('mkfifo', [path.join(dir, 'claude-e-fifo')]).status, 'CONTROL: the FIFO was made').toBe(0);
    fs.writeFileSync(path.join(dir, '~tmp.77'), 'stale');
    const r = w21Op(box, ['--clear-all']);
    expect([r.code, r.reason], r.raw).toEqual([0, undefined]);
    expect(w21Summary(r.stdout)).toEqual({ rc: 0, reason: null, cleared: 4, skipped: ['claude-d-dir', 'claude-e-fifo'] });
    expect(names(dir)).toEqual(['claude-d-dir', 'claude-e-fifo']);
    expect(fs.readFileSync(victim, 'utf8'), 'a link is unlinked, never followed').toBe('keep');
  }, 60_000);

  // The shim (umask 077) and runPass (process.umask(0o077)) both mask what a spawned pass makes, so the 0700 and 0600 the
  // write form asserts through the shim would hold with no mode in the pass at all. Here the pass runs in this fork under
  // umask 022, restored in `finally`, so only the pass's own modes can make 0700 and 0600 (vitest's pool is forks, where
  // process.umask(mask) is allowed; history-replay.test.ts does the same).
  it('in-process, under umask 022: recall-off/ is made 0700 and the file 0600 by the pass\'s own modes; the temp is recall-off/~tmp.<pid>, opened O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW, and the directory is fsynced after the rename', async () => {
    const box = w21Box('ccrc-hist-w21-flags-');
    const sweep = await import('../../ccd/history/sweep.mjs');
    const hh = await import('./historyHelpers.js');
    const args = { op: 'recall-off', mode: 'write', id: ID, generation: null } as const;
    expect(fs.existsSync(w21Dir(box)), 'CONTROL: recall-off/ is absent, so this pass makes it').toBe(false);
    const umask = process.umask(0o022);
    const first = (() => {
      try { return hh.recordOpenFlags(() => sweep.recallOffPass(box.home, args, () => {})); } finally { process.umask(umask); }
    })();
    const { out, opens } = first;
    expect(out).toEqual({ rc: 0 });
    expect(fs.lstatSync(w21Dir(box)).mode & 0o777, 'the directory\'s mode is the pass\'s, not the umask\'s').toBe(0o700);
    expect(fs.lstatSync(path.join(w21Dir(box), ID)).mode & 0o777, 'the file\'s mode is the pass\'s, not the umask\'s').toBe(0o600);
    const tmp = opens.filter((o) => o.path === path.join(w21Dir(box), `~tmp.${process.pid}`));
    expect(tmp, JSON.stringify(opens)).toHaveLength(1);
    const want = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
    expect(tmp[0]!.flags & want).toBe(want);
    const { dirs } = hh.recordDirFsyncs(() => sweep.recallOffPass(box.home, args, () => {}));
    expect(dirs, 'the rename is made durable').toContain(w21Dir(box));
    expect(fs.readFileSync(path.join(w21Dir(box), ID), 'utf8')).toBe(`${G1}\n`);
  });
});
```

(b) `server/test/history-cli.test.ts`: append at the end of the file:

```ts

// ── W2-1 Task 3: recall-off through the CLI door (W2-D26, W2-D27, W2-D28; D-5763, D-5764) ──────────────────────────
// B2's stub answered only its refusals. Since W2-1 recall-off is an operator verb of the door that relays import, prune
// and reparse: the CLI parses its argv (bad-args and bad-id spawn nothing), runs the gate, and spawns the shim, whose pass
// decides the rest under the lock; the CLI relays the pass's lines and its result.
describe('W2-1 recall-off: the CLI door relays the shim', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const G2 = '0189abcd-1234-4678-9abc-0123456789ac';
  function rBox(prefix: string): HistoryBox {
    const box = makeHistoryBox(prefix);
    expect(runSweep(box).code).toBe(0);
    healthHh.plantSession(box, ID, { generation: G1 });
    return box;
  }

  it('the write form runs the shim and relays its line, human on stdout and --json on stderr beside the envelope', () => {
    const box = rBox('ccrc-hist-cli-w21a-');
    const human = healthHh.runCli(box, ['recall-off', ID]);
    expect(human.code, `${human.stdout}${human.stderr}`).toBe(0);
    expect(human.stdout).toContain(`history-sweep: recall-off/${ID} written`);
    expect(fs.readFileSync(hist(box, 'recall-off', ID), 'utf8')).toBe(`${G1}\n`);
    const json = healthHh.runCli(box, ['recall-off', ID, '--generation', G1, '--json']);
    expect(json.json, json.stdout).toMatchObject({ exit: 0 });
    expect(json.stderr).toContain(`history-sweep: recall-off/${ID} written`);
    expect(json.stdout.trim().split('\n'), 'stdout is the envelope alone').toHaveLength(1);
  }, 60_000);

  it('C16, spawned: the two new words reach the envelope as exit-2 reasons, and the human line names the word and the operator', () => {
    const box = rBox('ccrc-hist-cli-w21b-');
    const mm = healthHh.runCli(box, ['recall-off', ID, '--generation', G2, '--json']);
    expect([mm.code, mm.json?.['reason']], `${mm.stdout}${mm.stderr}`).toEqual([2, 'generation-mismatch']);
    fs.writeFileSync(path.join(box.reg, `${ID}.generation`), 'not-a-generation');
    const mf = healthHh.runCli(box, ['recall-off', ID, '--json']);
    expect([mf.code, mf.json?.['reason']], `${mf.stdout}${mf.stderr}`).toEqual([2, 'generation-malformed']);
    const human = healthHh.runCli(box, ['recall-off', ID]);
    expect(human.code).toBe(2);
    expect(human.stderr).toContain('ccrc history recall-off: refused: generation-malformed; ');
    expect(fs.existsSync(hist(box, 'recall-off')), 'every refusal comes before any write').toBe(false);
  }, 60_000);

  it('bad-args and bad-id are the CLI\'s own and spawn nothing; a valid form reaches the shim with its argv as typed', () => {
    const box = rBox('ccrc-hist-cli-w21c-');
    healthHh.stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const ROWS: ReadonlyArray<readonly [readonly string[], string]> = [
      [[ID, '--generation', G1.toUpperCase()], 'bad-args'], [[ID, '--generation', ` ${G1}`], 'bad-args'],
      [[ID, '--generation', G1, '--clear'], 'bad-args'], [['--clear-all', ID], 'bad-args'],
      [['--clear-all', '--generation', G1], 'bad-args'], [[], 'bad-args'], [['../x', '--clear'], 'bad-id'],
    ];
    for (const [args, word] of ROWS) {
      const r = healthHh.runCli(box, ['recall-off', ...args, '--json']);
      expect([r.code, r.json?.['reason']], JSON.stringify(args)).toEqual([2, word]);
    }
    expect(fs.existsSync(path.join(box.home, 'stub-shim-argv')), 'no refusal spawned the shim').toBe(false);
    // CONTROL: a valid form does reach the stand-in.
    const ok = healthHh.runCli(box, ['recall-off', ID, '--generation', G1, '--json']);
    expect(ok.code, `${ok.stdout}${ok.stderr}`).toBe(0);
    expect(fs.readFileSync(path.join(box.home, 'stub-shim-argv'), 'utf8')).toContain(`--op recall-off ${ID} --generation ${G1}`);
  }, 60_000);

  it('--clear-all relays its summary line, the operator\'s check at close: human on stdout, --json on stderr', () => {
    const box = rBox('ccrc-hist-cli-w21d-');
    expect(healthHh.runCli(box, ['recall-off', ID]).code).toBe(0);
    fs.mkdirSync(hist(box, 'recall-off', 'claude-d-dir'));
    const human = healthHh.runCli(box, ['recall-off', '--clear-all']);
    expect(human.code, human.stderr).toBe(0);
    expect(human.stdout).toContain('{"rc":0,"reason":null,"cleared":1,"skipped":["claude-d-dir"]}');
    const json = healthHh.runCli(box, ['recall-off', '--clear-all', '--json']);
    expect(json.json, json.stdout).toMatchObject({ exit: 0 });
    expect(json.stderr).toContain('{"rc":0,"reason":null,"cleared":0,"skipped":["claude-d-dir"]}');
  }, 60_000);

  it('README states the verb, its flag and its refusal words (W2-1)', () => {
    const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
    expect(readme).toContain('`recall-off <id> [--generation <uuid>] [--clear]` and `recall-off --clear-all`');
    expect(readme).toContain('with no dry run');
    for (const w of ['generation-mismatch', 'generation-malformed', 'generation-unreadable']) expect(readme).toContain(`\`${w}\``);
  });
});
```

(c) `server/test/history-recall.test.ts`, four edits. First, the case below lives in a describe whose title names the function this task removes. Rename it in place, on its one line (about :156), so it names no deleted function; no `-t` filter in this plan selects it by its old title. Replace

```ts
describe('the read verbs\' pure halves: parseReadArgs, selectColumns, decideRecallOffPreflight (W1-B2 Task 10)', () => {
```

with

```ts
describe('the read verbs\' pure halves: parseReadArgs, selectColumns and recall-off\'s argv (W1-B2 Task 10)', () => {
```

Second, replace the whole case

```ts
  it('decideRecallOffPreflight: the id grammar first, then the generation read, then W2\'s word', () => {
```

through its closing `  });` (the line after `    expect(pre({ args: [ID, '--bogus'], generation: null })).toEqual({ done: true, exit: 2, reason: 'bad-args' });`) with

```ts
  it('recall-off\'s argv is parseOpVerbArgs\' since W2-1: the B2 preflight is gone, and the id grammar still comes before any path (C66)', () => {
    expect('decideRecallOffPreflight' in libRead, 'the B2 stub\'s decision went with the stub').toBe(false);
    const p = libRead.parseOpVerbArgs;
    expect(p('recall-off', ['../x', '--clear'])).toEqual({ ok: false, reason: 'bad-id' });
    expect(p('recall-off', [ID])).toEqual({ ok: true, args: { op: 'recall-off', mode: 'write', id: ID, generation: null } });
    expect(p('recall-off', ['--clear-all'])).toEqual({ ok: true, args: { op: 'recall-off', mode: 'clear-all', id: null, generation: null } });
    expect(p('recall-off', [ID, '--bogus'])).toEqual({ ok: false, reason: 'bad-args' });
  });
```

Third, in `it('C66 (B2 half): …'`, replace

```ts
    expect(answer(runCli(box, ['recall-off', ID, '--json'])), 'the writing verb ships with W2').toEqual([2, 'bad-args']);
```

with

```ts
    expect(answer(runCli(box, ['recall-off', ID, '--json'])), 'the verb writes since W2-1').toEqual([0, undefined]);
    expect(fs.readFileSync(hist(box, 'recall-off', ID), 'utf8'), 'the id\'s generation, through the shim').toBe(`${G1}\n`);
```

Fourth, append at the end of the file:

```ts

// ── W2-1 Task 3: one reader of recall-off/<id>, and RP10's verb half (W2-D28, W2-D29) ─────────────────────────────────
// W2-D29: the CLI's read verbs and the drain's stale check read recall-off/<id> through ONE reader, sweep.mjs's
// recallOffPresence (store.mjs readBounded at CONTROL_FILE_MAX), so they agree on every file. At the base the CLI read 4,096
// bytes and the drain 128, and a file whose 129th byte onward differs from its head could be stale to one and off to the
// other. RP10's verb half: the W2 close step clears every assigned file through the shim (its card half is beside RP8, W2-D32).
describe('W2-1 recall-off: one reader, and RP10\'s verb half', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  it('W2-D29, one reader: G1, 200 spaces and a word is stale for the CLI and for the drain alike', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-w21one-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    fs.mkdirSync(hist(box, 'recall-off'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(hist(box, 'recall-off', ID), `${G1}${' '.repeat(200)}word\n`);
    const r = treeJson(box);
    expect(r.code, `the CLI reads the whole file: not G1, so stale, and recall proceeds. ${r.stderr}`).toBe(0);
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);
    expect(recallRows11(box).map((x) => x.rc)).toEqual([0]);
    expect(counters(box)['recall_off_stale'] ?? 0, 'the drain reads the same whole file, so it reaches the same verdict').toBe(1);
  }, HEAVY);

  it('RP10, verb half: three families switched off by the verb answer 8; recall-off --clear-all leaves none, cleared 3 and skipped none, and each family reads again', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-rp10-');
    const FAMS = [[ID, TA, G1], [ID_B, TB, G2], [ID_D11, TD11, G4_11]] as const;
    for (const [id, uuid, g] of FAMS) seedFamily(box, { id, project: PROJECT, uuid, generation: g, rows: turns(uuid, 2) });
    for (const [id, , g] of FAMS) {
      const w = runCli(box, ['recall-off', id, '--generation', g, '--json']);
      expect(answer(w), `${w.stdout}${w.stderr}`).toEqual([0, undefined]);
      expect(answer(treeJson(box, id)), `${id} is in the control arm`).toEqual([8, undefined]);
    }
    expect(fs.readdirSync(hist(box, 'recall-off')).sort()).toEqual(FAMS.map(([id]) => id).sort());
    const all = runCli(box, ['recall-off', '--clear-all']);
    expect(all.code, `${all.stdout}${all.stderr}`).toBe(0);
    expect(all.stdout).toContain('{"rc":0,"reason":null,"cleared":3,"skipped":[]}');
    expect(fs.readdirSync(hist(box, 'recall-off')), 'none left').toEqual([]);
    for (const [id] of FAMS) expect(treeJson(box, id).code, `${id} reads again`).toBe(0);
  }, 1.5 * HEAVY);
});
```

(d) `server/test/history-recover.test.ts`: append at the end of the file:

```ts

// ── W2-1 Task 3: recall-off under a recovery step, and its generation read under the lock (W2-D27, W2-D28; RB12, C67) ──
describe('W2-1 recall-off: RB12 and C67, decided under the lock', () => {
  it('RB12: a registered recovery step never refuses recall-off; both forms run at both doors, and the step stays open', () => {
    const box = makeHistoryBox('ccrc-history-recover-w21-rb12-');
    seedFamily(box, {
      id: ID, project: 'demo', uuid: u(0x41), generation: u(0xa4), workdir: WORK,
      rows: [userRow({ uuid: u(0x4001), ts: new Date(Date.now() - 5 * MIN).toISOString(), text: 'zqrbtwelve words' })],
    });
    registerRecovery(box, Date.now());
    // CONTROL: the step is registered, and it refuses a form RB12 does not exempt.
    expect(lastRc(runShim(box, ['--op', 'import', '--apply']).stdout)).toEqual({ rc: 2, reason: 'recovering' });
    const dir = path.join(historyPaths(box.home).root, 'recall-off');
    const c = runCli(box, ['recall-off', ID, '--json']);
    expect([c.code, c.json?.['reason']], `the CLI door\n${c.stdout}${c.stderr}`).toEqual([0, undefined]);
    expect(fs.readFileSync(path.join(dir, ID), 'utf8')).toBe(`${u(0xa4)}\n`);
    expect(lastRc(runShim(box, ['--op', 'recall-off', ID, '--clear']).stdout), 'the direct door').toEqual({ rc: 0 });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(lastRc(runShim(box, ['--op', 'recall-off', ID]).stdout)).toEqual({ rc: 0 });
    const all = runCli(box, ['recall-off', '--clear-all', '--json']);
    expect([all.code, all.json?.['reason']], `${all.stdout}${all.stderr}`).toEqual([0, undefined]);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(recoverRow(box)).toMatchObject({ cursor: null, completed_ms: null });
  }, HEAVY);

  it('C67 at the direct door: a $REG/<id>.generation present but unreadable refuses generation-unreadable under the lock, with or without --generation, and writes nothing', () => {
    const box = makeHistoryBox('ccrc-history-recover-w21-c67-');
    expect(runSweep(box).code).toBe(0);
    plantSession(box, ID, { generation: 'unreadable' });
    const before = ccrcSnapshot(box);
    for (const extra of [[], ['--generation', u(0xa4)]]) {
      const r = runShim(box, ['--op', 'recall-off', ID, ...extra]);
      expect(lastRc(r.stdout), `${r.stdout}${r.stderr}`).toEqual({ rc: 2, reason: 'generation-unreadable' });
      expect(r.code).toBe(2);
    }
    expect(ccrcSnapshot(box), 'nothing written').toEqual(before);
    expect(fs.existsSync(path.join(historyPaths(box.home).root, 'recall-off'))).toBe(false);
  }, HEAVY);
});
```

(e) `server/test/single-definition.test.ts`, inside `describe('ccrc history: the operator switches have readers only (spec 2026-10-05 §9.11 O13)'`. First, replace the six comment lines

```ts
  // `recall-off/<id>` is O13's seventh name and is NOT in HOLDERS: spec O13 gives it exactly one writer,
  // `sweep.mjs` (`--op recall-off`, spec :1863 and the :2007 lifecycle row), which ships in W2. B1 holds the half
  // it can: the last case below reds when any corpus file but `ccd/history/sweep.mjs` writes it. The other half,
  // that `sweep.mjs` DOES write it and is the only file naming it, lands with W2's `--op recall-off`: W2 adds
  // `recall-off` to this describe's holders as `['recall-off', ['ccd/history/sweep.mjs']]` and drops the
  // exemption below.
```

with

```ts
  // `recall-off/<id>` is O13's seventh name and is NOT in HOLDERS: spec O13 gives it exactly one writer, sweep.mjs's
  // `--op recall-off` (recallOffPass, W2-1), and it has readers in more files than the exact-holders form can list (the
  // read verbs and the drain through readBounded, the hook's bash read, the replay driver's lstat). W2-1
  // (W2-D29) replaced B1's half-case with the last case below: one writer, the hook the one bash file naming it, and the
  // writer's shape.
```

Then replace the whole last case, from

```ts
  it('recall-off/<id>: no corpus file but sweep.mjs writes it (B1 holds this half; W2 adds sweep.mjs as its one writer)', () => {
```

through its closing `  });` (the line after `    expect(writers, 'recall-off/<id> has exactly one writer, sweep.mjs (spec O13): a write here is a second one').toEqual([]);`), with

```ts
  // W2-1 (W2-D29): recall-off/<id> has exactly one writer, sweep.mjs's recallOffPass, and every content reader reads it
  // through store.mjs's readBounded, so no corpus line pairs a write verb (`open` included) with a recall-off needle but the
  // writer's own. KNOWN WIDTH: a recall-off path held in a variable and written on a later line (`const p = recallOffPath(
  // home, id);` then `unlinkSync(p)`) is invisible to the needle scan. Inside recallOffPass the writer-shape rule below
  // closes it (every mutation there names `recallOffPath(` or `.recallOffDir` on its own line); outside it, nothing does.
  it('recall-off/<id>: exactly one writer, sweep.mjs', () => {
    const WRITER = 'ccd/history/sweep.mjs';
    const NEEDLES = ['recall-off', 'recallOffPath', 'recallOffDir', 'RECALL_OFF_DIR'] as const;
    const langOf = (f: string): 'bash' | 'mjs' => (BASH.includes(f) ? 'bash' : 'mjs');
    const writesOff = (l: string, lang: 'bash' | 'mjs'): boolean => NEEDLES.some((n) => l.includes(n) && writes(l, lang, n));
    // CONTROL: the classifier sees the planted writer shapes.
    expect(writesOff('writeFileSync(recallOffPath(home, id), g);', 'mjs')).toBe(true);
    expect(writesOff('    unlinkSync(`${P.recallOffDir}/${n}`);', 'mjs')).toBe(true);
    expect(writesOff('touch "$H/recall-off/$id"', 'bash')).toBe(true);
    // CONTROL: and not the two reads W2-D29 keeps, each read from the real file it lives in.
    const SWEEP_MJS = path.join(HISTORY_DIR, 'sweep.mjs');
    const reader = code(SWEEP_MJS).filter((l) => l.includes('readBounded(recallOffPath('));
    expect(reader, 'sweep.mjs reads recall-off/<id> through readBounded exactly once (W2-D29)').toHaveLength(1);
    const driver = code(path.join(ccrcRoot, 'deploy', 'history-replay.mjs')).filter((l) => l.includes('lstatSync(recallOffPath('));
    expect(driver, 'the replay driver\'s one recall-off line (W2-D78 (ii))').toHaveLength(1);
    for (const l of [...reader, ...driver]) expect(writesOff(l, 'mjs'), l.trim()).toBe(false);
    const writers = CORPUS.filter((f) => code(f).some((l) => writesOff(l, langOf(f)))).map(rel).sort();
    expect(writers, 'recall-off/<id> has exactly one writer, sweep.mjs (spec O13)').toEqual([WRITER]);
    // The bash half: the hook reads recall-off/<id> and is the one bash file naming it; none of its lines writes it.
    const bashNaming = BASH.filter((f) => code(f).some((l) => l.includes('/recall-off')));
    expect(bashNaming.map(rel).sort()).toEqual(['ccd/session-hook.sh']);
    for (const f of bashNaming) {
      for (const l of code(f).filter((x) => x.includes('/recall-off'))) expect(writes(l, 'bash', 'recall-off'), `${rel(f)}: \`${l.trim()}\``).toBe(false);
    }
    // The writer shape: recallOffPass's body, from its declaration to the next line that is exactly `}`.
    const lines = code(SWEEP_MJS);
    const at = lines.findIndex((l) => /^export function recallOffPass\(/.test(l));
    expect(at, 'sweep.mjs declares no recallOffPass').toBeGreaterThan(-1);
    let end = at + 1;
    while (end < lines.length && lines[end] !== '}') end += 1;
    const VERB = /\b(?:writeFile|appendFile|rename|unlink|rm|rmdir|mkdir|copyFile|cp|symlink|link|truncate|open)(?:Sync)?\s*\(|\b(?:removeEntry|writeFileAtomic|mkdirDurable)\s*\(/;
    const mutations = lines.slice(at + 1, end).filter((l) => VERB.test(l));
    for (const l of mutations) {
      expect(/recallOffPath\(|\.recallOffDir\b/.test(l), `recallOffPass: \`${l.trim()}\` names no recall-off path on its own line`).toBe(true);
    }
    for (const v of ['mkdirSync(', 'openSync(', 'renameSync(', 'unlinkSync(']) expect(mutations.some((l) => l.includes(v)), `recallOffPass makes no ${v}`).toBe(true);
    // Every recall-off write in sweep.mjs is the executor's.
    const outside = lines.filter((l, i) => (i <= at || i >= end) && writesOff(l, 'mjs')).map((l) => l.trim());
    expect(outside, 'a recall-off write in sweep.mjs outside recallOffPass').toEqual([]);
  });
```

- [ ] **Step 6: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms, one suite per call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'W2-1 recall-off')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'W2-1 recall-off')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-1 recall-off|C66|since W2-1')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'W2-1 recall-off')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'exactly one writer, sweep')
```

The history-recall filter selects this task's cases only. A bare `W2-1` would also select Task 1's describe (`… (W2-1 Task 1)`), whose CLI-spawning `expand` case and child-process import pin need `cli.mjs` to load, and it does not load between Steps 3 and 7, so two of Task 1's cases would red here for that reason alone.

Expected RED (predicted). Step 3 left `cli.mjs` importing the removed `decideRecallOffPreflight`, so every CLI spawn dies on its import (exit 1, no envelope) until Step 7. The failures below are named as they would read with the CLI still loading the base stub. Either way, each listed case is red.
- history-op: 13 failed | 1 passed.
  - The CONTROL passes, because `WRITING_FORMS` and `formOf` ship the forms already.
  - The C64 rows fail at the CLI door, which answers `bad-args` from the stub where `apply-in-session`, `history-off`, 0 or 9 is expected.
  - Every mechanics row fails at the direct door with `expected [ 2, 'bad-args' ] to deeply equal …`, because `OP_VERBS` lacks `recall-off`. That includes the unusable-directory case, at its first form (`recall-off/ a file`, `[ 1, undefined ]` expected).
  - The in-process case passes its CONTROL (no `recall-off/` yet), then fails with `sweep.recallOffPass is not a function`; its `finally` restores the umask.
- history-cli: 5 failed. The write case (`expected 2 to be 0`), C16 (`'bad-args'`), the bad-args case at its CONTROL (`expected 2 to be 0`), the summary case, and README (`expected … to contain '`recall-off <id> [--generation <uuid>] [--clear]` and `recall-off --clear-all`'`).
- history-recall: 3 failed | 1 passed (measured; the plan said 4 failed). The replaced case, "recall-off's argv is parseOpVerbArgs' since W2-1 …", is green on arrival, because Step 3 already shipped the grammar and the case asserts only the removed stub's absence and the new parser's answers. Step 13's M31 is what pins it. The three that fail:
  - C66, at its replaced line;
  - the one-reader case, with `the drain reads the same whole file…: expected 0 to be 1`, because the base drain reads 128 bytes, so it sees G1 and answers off;
  - RP10, at its first write.
- history-recover: 2 failed. RB12 fails after its CONTROL, at the CLI door; C67 with `expected { rc: 2, reason: 'bad-args' } to deeply equal { rc: 2, reason: 'generation-unreadable' }`.
- single-definition: 1 failed, with `sweep.mjs reads recall-off/<id> through readBounded exactly once (W2-D29): expected [] to have length 1`.

At the base the plain `writers` assertion is green on its own: `recallOffPresence`'s `openSync(recallOffPath(...` line counts as a write to the classifier. So the reader and writer-shape assertions are what red.

- [ ] **Step 7: Write the executor, the one reader, the relay and README.**

(a) `ccd/history/sweep.mjs`. In the `node:fs` import, add `fchmodSync` and `mkdirSync` in alphabetical order:

```js
import fs, {
  accessSync, chmodSync, closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  readdirSync, readFileSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeSync,
} from 'node:fs';
```

If the base's list holds other names than the two lines read at `02d75ae5f`, keep them all and add only these two. In the lib import, replace `  decideRecallOff, recallOffPath, decideReparse, REPARSE_MAX_TARGETS, planCopy, STORE_DB_REL,` with `  decideRecallOff, decideRecallOffWrite, recallOffPath, decideReparse, REPARSE_MAX_TARGETS, planCopy, STORE_DB_REL,`.

Replace `recallOffPresence` and its doc comment (from `` /** `recall-off/<id>` as a Presence, read bounded `` through the function's closing `}`) with

```js
/** `recall-off/<id>` as a Presence (W2-1, W2-D29): the drain's stale check below and the CLI's read verbs call it, and every
 *  other content reader of a recall-off file in ccd/history reads through readBounded with the same arguments. It is
 *  store.mjs's readBounded at CONTROL_FILE_MAX, never following a link: ENOENT is absent; a link, a non-regular file, a failed
 *  read and a file over the cap are unreadable, which decideRecallOff reads as off (IV5); a value is the whole text, which
 *  decideRecallOff trims. */
export function recallOffPresence(home, id) {
  const r = readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false);
  return r.state === 'value' ? { state: 'value', value: r.value } : r.state === 'absent' ? ABSENT : UNREADABLE;
}
```

Replace `OP_VERBS` and its doc comment with

```js
/** The --op verbs this build runs (§8.4). Each B2 verb joins in the task that ships its path (Tasks 20–28): a verb
 *  named here has an entry in OP_HANDLERS, or an arm in bindingPass, and one in OP_DRY_RUNS when it has a dry run.
 *  W2-1 adds recall-off, whose arm is opPass's own (recallOffPass): it has no dry run (D-5763 (history-w2-recall-off-no-dry-run)). */
const OP_VERBS = new Set(['import', 'migrate', 'prune', 'reparse', 'backup', 'repair', 'adopt', 'restore', 'rebuild', 'recall-off']);
```

In `opPass`, replace

```js
  const role = readRole(P);
  if (role === 'server') {
    out('history-sweep: store-create-refused-role');
    return result(EXIT.NO_STORE);
  }
```

with

```js
  const role = readRole(P);
  if (role === 'server') {
    out('history-sweep: store-create-refused-role');
    return result(EXIT.NO_STORE);
  }
  if (parsed.op === 'recall-off') {
    // W2-1 (W2-D26, W2-D27, W2-D28): recall-off's own pass. It runs after THE GATE (`apply-in-session`, and `history-off`,
    // which refuses both its forms, neither binding a store) and the role check, and BEFORE the lock-take journal half: it
    // opens no store, writes no op marker and journals nothing (D-6239 (history-recall-off-touches-no-store)). A
    // registered recovery step never refuses it (RB12, lib recoveryExempt), so the RB6 half below would add nothing.
    const r = recallOffPass(home, args, out);
    return result(r.rc, r.reason);
  }
```

Directly after `writeOpMarker`'s closing `}` and above `projectsRootOf`'s doc comment, insert

```js

// ── W2-1: THE recall-off EXECUTOR (spec §8.4, §9.7; W2-D26, W2-D27, W2-D28) ──────────────────────────────────────────────
// `--op recall-off <id> [--generation <uuid>]`, `--op recall-off <id> --clear` and `--op recall-off --clear-all`, under the
// shim's lock, after opPass's gate and role check. It writes as invoked: recall-off has no dry run
// (D-5763 (history-w2-recall-off-no-dry-run)). It is the ONE writer of recall-off/ (spec O13). Every mutation below names
// `recallOffPath(` or `.recallOffDir` on its own line, which single-definition.test.ts's "recall-off/<id>: exactly one writer,
// sweep.mjs" reads as the writer's shape. A path held in a variable and written on a later line is invisible to that pin's
// needle scan, its KNOWN WIDTH, so none is. In order:
//   1. the write form only: $REG/<id>.generation read raw, bounded, decided by lib's decideRecallOffWrite (W2-D27;
//      D-5764 (history-w2-recall-off-generation-checks)). A refusal answers here, before any write;
//   2. the root and recall-off/, by lstat. A root that is not a directory, or a recall-off/ that is a link or not a
//      directory, answers rc 1 with one line, before any write. The executor follows no link;
//   3. recall-off/ is made 0700 when absent, by the write form only: a clear of a directory that does not exist is rc 0;
//   4. every `~tmp.*` entry is removed. Under the lock any such entry is stale, since no other writer is mid-write;
//   5. the form:
//      - the write goes through `recall-off/~tmp.<pid>` (`~` is outside ID_RE, so no reader takes it for an id), opened
//        O_CREAT|O_EXCL|O_NOFOLLOW at 0600, written whole and fsynced, renamed over recall-off/<id>, and the directory
//        fsynced;
//      - `--clear` unlinks the one entry when it is a file or a link, never following it, and a missing one is rc 0;
//      - `--clear-all` lstats every entry, whatever its name, unlinks files and links, and skips directories, FIFOs, sockets
//        and devices. It prints `{rc, reason, cleared, skipped}` on its own line before the result line (lib decideRelay
//        reads a result of rc and reason only), so the operator can check at close that `skipped` is empty.

/** What lstat says a recall-off path is: 'absent', 'dir', 'link', 'file', 'special' (a FIFO, a socket, a device) or
 *  'unmeasured' (any other failure). It never follows a link. */
function recallOffKind(p) {
  let st;
  try {
    st = lstatSync(p);
  } catch (e) {
    return e !== null && typeof e === 'object' && e.code === 'ENOENT' ? 'absent' : 'unmeasured';
  }
  if (st.isSymbolicLink()) return 'link';
  if (st.isDirectory()) return 'dir';
  return st.isFile() ? 'file' : 'special';
}

/** The words a recall-off path's kind is named with in a line. */
const RECALL_OFF_KIND_WORDS = Object.freeze({
  absent: 'absent', dir: 'a directory', file: 'a file', link: 'a link', special: 'a FIFO, a socket or a device', unmeasured: 'unmeasurable',
});

/** One recall-off pass (the block above). `args` is parseOpVerbArgs' `{ op: 'recall-off', mode, id, generation }`, and `out`
 *  prints one stdout line. Answers `{ rc, reason? }`, which opPass prints as the result line. */
export function recallOffPass(home, args, out) {
  const P = historyPaths(home);
  let content = null;
  if (args.mode === 'write') {
    const d = decideRecallOffWrite({ registry: readSmall(`${P.reg}/${args.id}.generation`, REG_VALUE_MAX), want: args.generation });
    if (!d.ok) return { rc: d.rc, reason: d.reason };
    content = d.generation === '' ? '' : `${d.generation}\n`;
  }
  const rootKind = recallOffKind(P.root);
  const dirKind = rootKind === 'dir' ? recallOffKind(P.recallOffDir) : null;
  if (rootKind !== 'dir' || (dirKind !== 'dir' && dirKind !== 'absent')) {
    const [where, kind] = rootKind !== 'dir' ? ['~/.ccrc/history', rootKind] : ['~/.ccrc/history/recall-off', dirKind];
    out(`history-sweep: recall-off: ${where} is ${RECALL_OFF_KIND_WORDS[kind]}, not a directory this pass writes in; nothing written`);
    return { rc: EXIT.INTERNAL };
  }
  if (dirKind === 'absent') {
    if (args.mode === 'clear-all') out(JSON.stringify({ rc: EXIT.OK, reason: null, cleared: 0, skipped: [] }));
    if (args.mode !== 'write') return { rc: EXIT.OK };
    mkdirSync(P.recallOffDir, { mode: 0o700 });
    fsyncDir(P.root);
  }
  for (const n of readdirSync(P.recallOffDir).sort()) {
    if (!n.startsWith('~tmp.')) continue;
    try { unlinkSync(`${P.recallOffDir}/${n}`); } catch { /* a directory there stays, and --clear-all names it */ }
  }
  if (args.mode === 'write') {
    let renamed = false;
    try {
      const fd = openSync(`${P.recallOffDir}/~tmp.${process.pid}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        fchmodSync(fd, 0o600);
        const buf = Buffer.from(content, 'utf8');
        for (let off = 0; off < buf.length;) {
          const n = writeSync(fd, buf, off, buf.length - off);
          if (!(n > 0)) throw new Error('recall-off: a short write');
          off += n;
        }
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(`${P.recallOffDir}/~tmp.${process.pid}`, recallOffPath(home, args.id));
      renamed = true;
    } finally {
      if (!renamed) { try { unlinkSync(`${P.recallOffDir}/~tmp.${process.pid}`); } catch { /* the next recall-off pass removes it */ } }
    }
    fsyncDir(P.recallOffDir);
    out(`history-sweep: recall-off/${args.id} written`);
    return { rc: EXIT.OK };
  }
  if (args.mode === 'clear') {
    const kind = recallOffKind(recallOffPath(home, args.id));
    if (kind === 'absent') {
      out(`history-sweep: recall-off/${args.id} was already absent`);
      return { rc: EXIT.OK };
    }
    if (kind !== 'file' && kind !== 'link') {
      out(`history-sweep: recall-off/${args.id} is ${RECALL_OFF_KIND_WORDS[kind]}, neither a file nor a link: the operator removes it by hand; nothing removed`);
      return { rc: EXIT.INTERNAL };
    }
    unlinkSync(recallOffPath(home, args.id));
    fsyncDir(P.recallOffDir);
    out(`history-sweep: recall-off/${args.id} cleared`);
    return { rc: EXIT.OK };
  }
  const skipped = [];
  let cleared = 0;
  for (const n of readdirSync(P.recallOffDir).sort()) {
    const kind = recallOffKind(`${P.recallOffDir}/${n}`);
    if (kind === 'absent') continue;
    if (kind !== 'file' && kind !== 'link') { skipped.push(n); continue; }
    try {
      unlinkSync(`${P.recallOffDir}/${n}`);
      cleared += 1;
    } catch (e) {
      if (!(e !== null && typeof e === 'object' && e.code === 'ENOENT')) skipped.push(n);
    }
  }
  fsyncDir(P.recallOffDir);
  out(JSON.stringify({ rc: EXIT.OK, reason: null, cleared, skipped }));
  return { rc: EXIT.OK };
}
```

No string on a line naming a recall-off needle may hold a write-verb word followed by `(`. For example, "a link (…" would read as a `link(` call to O13's classifier, so the lines above say "a link:" and "a link,". Keep it so when editing.

(b) `ccd/history/cli.mjs`:
- In the lib import, `  decideIdentity, decideHarness, resolveGeneration, decideScope, parseReadArgs, decideRecallOffPreflight, paneOk,` becomes `  decideIdentity, decideHarness, resolveGeneration, decideScope, parseReadArgs, paneOk,`.
- `  decideRecallOff, recallOffPath, parseSpoolLine, SCOPE_FAMILIES_JSON_MAX,` becomes `  decideRecallOff, parseSpoolLine, SCOPE_FAMILIES_JSON_MAX,`.
- `import { loadSecrets, procIdentityOf, measureOpProcess } from './sweep.mjs';` becomes `import { loadSecrets, procIdentityOf, measureOpProcess, recallOffPresence } from './sweep.mjs';`.

In the dispatcher comment, replace

```js
//   - BOX verbs derive no identity: `status`; `recall-off`, which in B2 answers only its refusals (the verb that
//     writes ships with W2); and, from Task 19, the operator verbs.
```

with

```js
//   - BOX verbs derive no identity: `status`; and, from Task 19, the operator verbs, `recall-off` among them since
//     W2-1 (THE OPERATOR DOOR, below).
```

In `USAGE`, replace

```js
  '  operator verbs: import | prune | reparse | doctor [--repair | --backup | --migrate | --adopt | --restore <file> | --rebuild [--store-id <uuid>]]',
```

with

```js
  '  operator verbs: import | prune | reparse | recall-off <id> [--generation <uuid>] [--clear] | recall-off --clear-all',
  '    | doctor [--repair | --backup | --migrate | --adopt | --restore <file> | --rebuild [--store-id <uuid>]]',
```

Replace `/** A registry field or a recall-off file is a few dozen bytes; a read stops here. */` with `/** A registry field is a few dozen bytes; a read stops here. A recall-off file is read by sweep.mjs's recallOffPresence (W2-D29). */`. In `readContextIn`, replace

```js
  const offFile = presenceOf(recallOffPath(home, id));
```

with

```js
  // W2-D29: the one reader of recall-off/<id>, the drain's too (store.mjs readBounded at CONTROL_FILE_MAX).
  const offFile = recallOffPresence(home, id);
```

Delete the whole of

```js
/** `recall-off` in B2: its refusals only (decideRecallOffPreflight). The verb writes nothing and spawns
 *  nothing. */
function recallOffVerb(home, args) {
```

through that function's closing `}` and the blank line after it. In `main`, delete the line `  if (verb === 'recall-off') return recallOffVerb(home, rest);`. The `OP_OF_VERB` test on the next line routes the verb to `operatorMain`. In THE OPERATOR DOOR's comment, replace

```js
// `ccrc history import|prune|reparse …` and `ccrc history doctor --repair|--backup|--migrate|--adopt|
```

with

```js
// `ccrc history import|prune|reparse|recall-off …` and `ccrc history doctor --repair|--backup|--migrate|--adopt|
```

Replace

```js
export const OP_OF_VERB = Object.freeze({
  import: 'import', prune: 'prune', reparse: 'reparse',
```

with

```js
export const OP_OF_VERB = Object.freeze({
  import: 'import', prune: 'prune', reparse: 'reparse', 'recall-off': 'recall-off',
```

(c) `README.md`: replace the line

```
an older restored store needs first and the `--adopt` an unbound one needs.
```

with

```
an older restored store needs first and the `--adopt` an unbound one needs.
`recall-off <id> [--generation <uuid>] [--clear]` and `recall-off --clear-all` set and clear the W2 replay
eval's control arm, `~/.ccrc/history/recall-off/<id>`. They write as invoked, with no dry run, through the
same shim; they refuse inside a session and under `~/.ccrc/history-off`, and still run during a recovery.
The write records the id's generation as `$REG/<id>.generation` holds it then, and refuses before writing
anything: `generation-mismatch` when `--generation` names another generation or the registry holds none,
`generation-malformed` when the registry holds something that is not a generation, and
`generation-unreadable` when it cannot be read. `--clear-all` prints how many files it removed and the
names it skipped (a directory, a FIFO, a socket or a device, or an entry it could not measure or remove), which the operator removes by hand.
```

- [ ] **Step 8: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'W2-1 recall-off')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'W2-1 recall-off')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-1|C66|C68')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'W2-1 recall-off|C67')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'operator switches have readers only')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-1 recall-off')
```

Expected: every case passes. That includes the base's C68 cases, which now read through `recallOffPresence`, and the base's C67 case (`.generation for recall-off, store.id for status …`), whose recall-off clause now goes through the shim and still writes nothing.

- [ ] **Step 9: Write the failing lifecycle test.** In `server/test/lifecycle.test.ts`, replace

```ts
  const HISTORY_LANDED: readonly HistoryPr[] = ['B1', 'B2', 'B3', 'B4', 'W2-4'];
```

with

```ts
  const HISTORY_LANDED: readonly HistoryPr[] = ['B1', 'B2', 'B3', 'B4', 'W2-4', 'W2-1'];
```

Then, directly after the `history-replay-out` case, whose last lines are

```ts
    expect(c!.root, 'the row names another marker than the driver writes').toContain(`marked by ${OUT_MARKER}`);
  });
```

insert

```ts

  // ── ccrc history W2-1 (spec 2026-10-05 §9.4, O17's W2-1 half; W2-D9, W2-D28) ──────────────────────────────────────
  // The replay eval's control arm. sweep.mjs's --op recall-off is its one writer (O13), through its temp recall-off/~tmp.<pid>,
  // which the next recall-off pass removes; the operator verbs collect it, `recall-off --clear-all` at W2 close. The manifest is
  // L0 and imports nothing, so the per-file bound is bound here to the code's own UUID grammar, as the B3 numbers are above.
  it('declares history-recall-off: the eval\'s control arm, an O class sweep.mjs writes through --op recall-off, collected by the operator verbs', async () => {
    const c = LIFECYCLE.find((x) => x.name === 'history-recall-off');
    expect(c, 'shared/lifecycle.ts declares no history-recall-off class').toBeTruthy();
    expect(c!.pattern).toBe('O');
    expect(c!.creators).toEqual(['ccd/history/sweep.mjs (--op recall-off)']);
    expect(c!.root).toContain('~/.ccrc/history/recall-off/<id>');
    expect(c!.root, 'the row names its temp').toContain('recall-off/~tmp.<pid>');
    expect(c!.collector).toContain('ccrc history recall-off <id> --clear');
    expect(c!.collector).toContain('recall-off --clear-all at W2 close');
    expect(c!.ruling).toBeNull();
    const { UUID_RE } = await import('../../ccd/history/lib.mjs');
    const g = '0189abcd-1234-4678-9abc-0123456789ab';
    expect(UUID_RE.test(g), 'CONTROL: a generation the grammar takes').toBe(true);
    expect(c!.tier).toContain(`at most ${Buffer.byteLength(`${g}\n`)} B`);
  });
```

- [ ] **Step 10: Run it and see it fail.**

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'history-recall-off|O17')
```

Expected RED (predicted): 2 failed. The O17 case fails with `history-recall-off lands in W2-1, which has landed, and shared/lifecycle.ts declares no such class: expected false to be true`. The new case fails with `shared/lifecycle.ts declares no history-recall-off class: expected undefined to be truthy`.

- [ ] **Step 11: Write the row.** In `shared/lifecycle.ts`, replace

```ts
    ruling: 'operator-made; removed by hand once the W2 decision is recorded' },
```

with

```ts
    ruling: 'operator-made; removed by hand once the W2 decision is recorded' },
  // ccrc history, W2-1 (spec 2026-10-05 §9.4; W2-D9, W2-D28): the replay eval's control arm. sweep.mjs's --op recall-off is its
  // one writer (O13), through its temp recall-off/~tmp.<pid>, which the next recall-off pass removes; the operator verbs clear
  // it, `recall-off --clear-all` at W2 close, and an entry that verb skips is removed by hand.
  { name: 'history-recall-off', root: '~/.ccrc/history/recall-off/<id>, and the writer\'s temp recall-off/~tmp.<pid> while one is written', pattern: 'O',
    creators: ['ccd/history/sweep.mjs (--op recall-off)'],
    collector: 'ccrc history recall-off <id> --clear, and recall-off --clear-all at W2 close (operator verbs through the shim, spec §10.6), or rm for an entry --clear-all skips; a stale ~tmp.<pid> is removed by the next recall-off pass',
    bound: 'until cleared; every file by W2 close', tier: 'one generation per file: at most 37 B (a UUID and one LF), empty for a legacy family', ruling: null },
```

- [ ] **Step 12: Run it and see it pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'history-recall-off|O17|every history class')
```

Expected: 3 passed.

- [ ] **Step 13: Measure every new guard red, then green.** From the repository root. Each block:
  1. applies one exact replacement, asserted to match once (the `mut` helper; the multi-line ones are quoted python heredocs);
  2. runs one filter and shows it red (every expected red below was predicted before the code);
  3. restores the file with `cp`.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-1/scratch"; mkdir -p "$SCRATCH"
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
cp ccd/history/sweep.mjs "$SCRATCH/sweep.orig"
cp ccd/history/cli.mjs "$SCRATCH/cli.orig"
cp ccd/ccd-history-sweep "$SCRATCH/shim.orig"
cp shared/lifecycle.ts "$SCRATCH/lifecycle.orig"

# M1: no LF trimmed, so ccd's field written with one reads as malformed.
mut ccd/history/lib.mjs "  const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw;" "  const text = raw;"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'decideRecallOffWrite')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 2 failed | 15 passed, the "one LF" and "G and one LF" rows, reason generation-malformed.

# M2: --generation never compared with a registry UUID.
mut ccd/history/lib.mjs "  return want === null || want === text ? { ok: true, generation: text } : refuse('generation-mismatch');" "  return { ok: true, generation: text };"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'decideRecallOffWrite')
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'W2-D27 under the lock')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): history-lib 1 failed | 16 passed, "G, --generation G2"; history-op 1 failed, row "G1, --generation G2".

# M3: an absent or empty registry with --generation writes the legacy ''.
mut ccd/history/lib.mjs "  if (text === '') return want === null ? { ok: true, generation: '' } : refuse('generation-mismatch');" "  if (text === '') return { ok: true, generation: '' };"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'decideRecallOffWrite')
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'W2-D27 under the lock')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): history-lib 2 failed | 15 passed ("absent, --generation G", "empty, --generation G"); history-op 1 failed at
# row "absent, --generation G1": expected [ 0, undefined ] to deeply equal [ 2, 'generation-mismatch' ].

# M4: malformed content folded into the legacy ''.
mut ccd/history/lib.mjs "  if (!UUID_RE.test(text)) return refuse('generation-malformed');" "  if (!UUID_RE.test(text)) return want === null ? { ok: true, generation: '' } : refuse('generation-mismatch');"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'decideRecallOffWrite')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 5 failed | 12 passed, the five generation-malformed rows.

# M5: an upper-case --generation accepted.
mut ccd/history/lib.mjs "      if (generation !== null && (clear || !UUID_RE.test(generation))) return refuse('bad-args');" "      if (generation !== null && (clear || !UUID_RE.test(generation.toLowerCase()))) return refuse('bad-args');"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'recall-off argv refuses')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'bad-args and bad-id are the CLI')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): history-lib 1 failed | 17 passed, "an upper-case UUID"; history-cli 1 failed, the upper-case row answered by the
# stand-in (exit 0) and stub-shim-argv present.

# M6: --generation accepted beside --clear.
mut ccd/history/lib.mjs "      if (generation !== null && (clear || !UUID_RE.test(generation))) return refuse('bad-args');" "      if (generation !== null && !UUID_RE.test(generation)) return refuse('bad-args');"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'recall-off argv refuses')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 2 failed | 16 passed, "--generation with --clear" and "--clear then --generation".

# M7: over-cap no longer folded into unreadable.
mut ccd/history/lib.mjs "  if (registry.state !== 'absent' && registry.state !== 'value') return refuse('generation-unreadable');" "  if (registry.state === 'unreadable') return refuse('generation-unreadable');"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'decideRecallOffWrite')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 1 failed | 16 passed, "over the cap is unreadable" (a TypeError reading undefined's endsWith).

# M8: the two words dropped to one, so a refusal names a word REASONS does not hold.
mut ccd/history/lib.mjs "    'generation-malformed', 'generation-mismatch'," "    'generation-malformed',"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'its two words|beside their departure')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 2 failed: expected undefined to be 2, and REASON_ROWS lists the two words on one line: expected -1 to be greater than -1.

# M9: a write before the refusal (recall-off/ made before the generation is decided).
mut ccd/history/sweep.mjs "  const P = historyPaths(home);
  let content = null;" "  const P = historyPaths(home);
  try { mkdirSync(P.recallOffDir, { mode: 0o700 }); } catch { /* M9 */ }
  let content = null;"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'W2-D27 under the lock')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'C67 at the direct door')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): history-op 1 failed at row "unreadable, no --generation: nothing written" (the snapshot gains history/recall-off/);
# history-recover 1 failed, the same.

# M10: the temp opened without O_NOFOLLOW.
mut ccd/history/sweep.mjs '~tmp.${process.pid}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);' '~tmp.${process.pid}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);'
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'in-process')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed: expected 193 to be 131265 (Linux's flag values).

# M11: stale temps never removed.
mut ccd/history/sweep.mjs "    if (!n.startsWith('~tmp.')) continue;" "    continue;"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'stale ~tmp entries')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed: the write form: expected [ 'claude-a-demo', '~tmp.1', '~tmp.4242' ] to deeply equal [ 'claude-a-demo' ].

# M12: --clear-all removes a FIFO (only a directory skipped).
mut ccd/history/sweep.mjs "    if (kind !== 'file' && kind !== 'link') { skipped.push(n); continue; }" "    if (kind === 'dir') { skipped.push(n); continue; }"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'lstats every entry')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed: { cleared: 5, skipped: [ 'claude-d-dir' ] } where cleared 4 and both names are expected.

# M13: --clear follows a link.
mut ccd/history/sweep.mjs "    unlinkSync(recallOffPath(home, args.id));" "    unlinkSync(realpathSync(recallOffPath(home, args.id)));"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'follows no link')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed: the link itself is unlinked: expected [ 'claude-a-demo' ] to deeply equal [] (the victim went instead).

# M14 (C64's CONTROL): the recall-off arm moved above THE GATE, so only cli.mjs gates the form.
python3 - ccd/history/sweep.mjs <<'EOF'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("  if (parsed.op === 'recall-off') {\n")
tail = "    return result(r.rc, r.reason);\n  }\n"
end = s.index(tail, start) + len(tail)
arm = s[start:end]
s = s[:start] + s[end:]
gate = "  const gate = decideOpGate(form, gateEnv, tty, paneName);\n"
assert s.count(gate) == 1
open(p, 'w').write(s.replace(gate, arm + gate))
EOF
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'W2-1 recall-off: C64')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (measured: 3 failed | 2 passed; the plan said 2 failed): the CLAUDECODE and history-off rows at the DIRECT door (`recall-off via direct`:
# expected [ 0, undefined ] to deeply equal [ 2, 'apply-in-session' ] or [ 2, 'history-off' ]; the CLI door still refuses), and the role-gate case, because
# the arm above THE GATE also skips the role check: [ 1, undefined ] where [ 9, undefined ] is expected.

# M15: the recall-off arm moved above the role check.
python3 - ccd/history/sweep.mjs <<'EOF'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("  if (parsed.op === 'recall-off') {\n")
tail = "    return result(r.rc, r.reason);\n  }\n"
end = s.index(tail, start) + len(tail)
arm = s[start:end]
s = s[:start] + s[end:]
role = "  const role = readRole(P);\n  if (role === 'server') {\n    out('history-sweep: store-create-refused-role');\n    return result(EXIT.NO_STORE);\n"
assert s.count(role) == 1, s.count(role)   # the shorter anchor also matches scheduledPass (count 2): opPass's block ends in this return
open(p, 'w').write(s.replace(role, arm + role))
EOF
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'the role gate')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed at the direct door: expected [ 1, undefined ] to deeply equal [ 9, undefined ] (a server box has no history root).

# M16: RB12 dropped for recall-off.
mut ccd/history/lib.mjs "    case 'recall-off': return true;
" ""
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'RB12: a registered')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 1 failed at the CLI door: expected [ 2, 'recovering' ] to deeply equal [ 0, undefined ] (the CLI's pre-check
# reads recoveryExempt; the sweep's arm answers before its RB6 half, so the direct door would still write).

# M17: the one reader back to a 128-byte window.
mut ccd/history/sweep.mjs "  const r = readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false);" "  const r = readBounded(recallOffPath(home, id), 128, false);"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'one reader')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed: the 241-byte file is over that cap, so unreadable, so off: expected 8 to be 0.

# M18 (O13 CONTROL): a second writer planted in cli.mjs.
mut ccd/history/cli.mjs "process.umask(0o077);" "process.umask(0o077);
const plantedW21 = (home, id, g) => writeFileSync(recallOffPath(home, id), g);"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'exactly one writer, sweep')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (predicted): expected [ 'ccd/history/cli.mjs', 'ccd/history/sweep.mjs' ] to deeply equal [ 'ccd/history/sweep.mjs' ].

# M19 (O13 CONTROL): sweep.mjs with its writer lines removed.
python3 - ccd/history/sweep.mjs <<'EOF'
import re, sys
p = sys.argv[1]
lines = open(p).read().split('\n')
at = next(i for i, l in enumerate(lines) if l.startswith('export function recallOffPass('))
end = next(i for i in range(at + 1, len(lines)) if lines[i] == '}')
verb = re.compile(r'\b(?:writeFile|appendFile|rename|unlink|rm|rmdir|mkdir|copyFile|cp|symlink|link|truncate|open)(?:Sync)?\s*\(')
kept = lines[:at + 1] + [l for l in lines[at + 1:end] if not verb.search(l)] + lines[end:]
assert len(kept) < len(lines)
open(p, 'w').write('\n'.join(kept))
EOF
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'exactly one writer, sweep')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): expected [] to deeply equal [ 'ccd/history/sweep.mjs' ].

# M20 (O13 CONTROL): a bash writer planted in the shim.
printf '%s\n' 'touch "$HOME/.ccrc/history/recall-off/x"' >> ccd/ccd-history-sweep
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'exactly one writer, sweep')
cp "$SCRATCH/shim.orig" ccd/ccd-history-sweep
# Expected RED (predicted): expected [ 'ccd/ccd-history-sweep', 'ccd/history/sweep.mjs' ] to deeply equal [ 'ccd/history/sweep.mjs' ].

# M21 (O13, W2-D29's reader): the drain's reader back on an open() of its own.
mut ccd/history/sweep.mjs "  const r = readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false);" "  const r = openSync(recallOffPath(home, id), constants.O_RDONLY);"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'exactly one writer, sweep')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): sweep.mjs reads recall-off/<id> through readBounded exactly once (W2-D29): expected [] to have length 1.

# M22 (the writer shape): a mutation that names its path through a variable.
mut ccd/history/sweep.mjs "    unlinkSync(recallOffPath(home, args.id));" "    const gone = recallOffPath(home, args.id);
    unlinkSync(gone);"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'exactly one writer, sweep')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): recallOffPass: `unlinkSync(gone);` names no recall-off path on its own line: expected false to be true.

# M23: the CLI door loses the verb.
mut ccd/history/cli.mjs "  import: 'import', prune: 'prune', reparse: 'reparse', 'recall-off': 'recall-off'," "  import: 'import', prune: 'prune', reparse: 'reparse',"
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the write form runs the shim')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (predicted): 1 failed: expected 2 to be 0 (an unknown verb, bad-args).

# M24: the lifecycle row no longer names the writer's temp.
mut shared/lifecycle.ts "recall-off/<id>, and the writer\'s temp recall-off/~tmp.<pid> while one is written" "recall-off/<id>"
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'declares history-recall-off')
cp "$SCRATCH/lifecycle.orig" shared/lifecycle.ts
# Expected RED (predicted): the row names its temp: expected '~/.ccrc/history/recall-off/<id>' to contain 'recall-off/~tmp.<pid>'.

# M25 (W2-D28's 0700): recall-off/ made with no mode of its own, so the umask decides it.
mut ccd/history/sweep.mjs "    mkdirSync(P.recallOffDir, { mode: 0o700 });" "    mkdirSync(P.recallOffDir);"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'in-process')
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'makes recall-off/ 0700')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): the in-process case, 1 failed: the directory's mode is the pass's, not the umask's: expected 493 to be
# 448 (0755 under umask 022). The shim's write-form case stays green (umask 077 makes 0700 anyway): that is why the
# in-process case asserts the modes.

# M26 (W2-D28's 0600): the temp opened 0644 and its fchmod deleted, so the umask decides the file's mode.
mut ccd/history/sweep.mjs '~tmp.${process.pid}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);' '~tmp.${process.pid}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);'   # the bare `O_EXCL | O_NOFOLLOW, 0o600);` also matches an older open (count 2)
mut ccd/history/sweep.mjs "        fchmodSync(fd, 0o600);
" ""
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'in-process')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed: the file's mode is the pass's, not the umask's: expected 420 to be 384 (0644).

# M27 (R3, the root): the root's own lstat dropped, so a link at the root is followed into recall-off/.
mut ccd/history/sweep.mjs "  const dirKind = rootKind === 'dir' ? recallOffKind(P.recallOffDir) : null;" "  const dirKind = recallOffKind(P.recallOffDir);"
mut ccd/history/sweep.mjs "  if (rootKind !== 'dir' || (dirKind !== 'dir' && dirKind !== 'absent')) {" "  if (rootKind === 'file' || rootKind === 'special' || (dirKind !== 'dir' && dirKind !== 'absent')) {"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'an unusable history root')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed at 'the root a link: ["claude-a-demo"]': expected [ 0, undefined ] to deeply equal [ 1, undefined ]
# (the write form made recall-off/ behind the link and wrote there).

# M28 (R3, recall-off/): a regular file at recall-off/ admitted as the directory.
mut ccd/history/sweep.mjs "  if (rootKind !== 'dir' || (dirKind !== 'dir' && dirKind !== 'absent')) {" "  if (rootKind !== 'dir' || (dirKind !== 'dir' && dirKind !== 'absent' && dirKind !== 'file')) {"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'an unusable history root')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed at 'recall-off/ a file: ["claude-a-demo"]': the pass throws on readdirSync (ENOTDIR) and still
# answers rc 1, but with no refusal line: expected '…' to contain 'history-sweep: recall-off: ~/.ccrc/history/recall-off is a file, …'.

# M29: the directory not fsynced after the rename.
mut ccd/history/sweep.mjs "    fsyncDir(P.recallOffDir);
    out(\`history-sweep: recall-off/\${args.id} written\`);" "    out(\`history-sweep: recall-off/\${args.id} written\`);"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'in-process')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed: the rename is made durable: expected [ … ] to include '…/.ccrc/history/recall-off' (the
# second call finds recall-off/ already made, so the rename's fsync was its only one of that directory).

# M30 (R3, --clear): only a FIFO, a socket or a device refused, so a directory at the entry reaches unlinkSync.
python3 - ccd/history/sweep.mjs <<'EOF'
import sys
p = sys.argv[1]
s = open(p).read()
old = "    if (kind !== 'file' && kind !== 'link') {\n      out(`history-sweep: recall-off/${args.id} is "
assert s.count(old) == 1, s.count(old)
open(p, 'w').write(s.replace(old, "    if (kind === 'special') {\n      out(`history-sweep: recall-off/${args.id} is "))
EOF
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'the clear form: a missing entry')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed: unlinkSync throws on the directory, the pass answers rc 1 with no line naming it: expected '…' to
# contain 'history-sweep: recall-off/claude-a-demo is a directory, neither a file nor a link'.

# M31 (P5: the replaced history-recall case): a recall-off `bad-args` arm restored in parseOpVerbArgs, ahead of the real one.
mut ccd/history/lib.mjs "    case 'recall-off': {
      // Every shape error" "    case 'recall-off':
      return refuse('bad-args');
    case 'recall-off-unreachable': {
      // Every shape error"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "recall-off.s argv is parseOpVerbArgs")
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Measured RED: 1 failed | 199 skipped: expected { ok: false, reason: 'bad-args' } to deeply equal { ok: false, reason: 'bad-id' }.

# M32 (P10: a clear never makes recall-off/): the mkdir moved above the write-form split, so the clear forms make the directory too.
mut ccd/history/sweep.mjs "    if (args.mode !== 'write') return { rc: EXIT.OK };
    mkdirSync(P.recallOffDir, { mode: 0o700 });" "    mkdirSync(P.recallOffDir, { mode: 0o700 });
    if (args.mode !== 'write') return { rc: EXIT.OK };"
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'the clear form: a missing entry|lstats every entry')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Measured RED: 2 failed: `a clear never makes recall-off/: expected true to be false` and `clear-all never makes recall-off/: expected true to be false`.

for f in lib sweep cli; do cmp "$SCRATCH/$f.orig" "ccd/history/$f.mjs"; done
cmp "$SCRATCH/shim.orig" ccd/ccd-history-sweep && cmp "$SCRATCH/lifecycle.orig" shared/lifecycle.ts && echo restored
```

Every `cmp` must be silent and the last line must print `restored`. Re-run each touched filter once more, green: Step 8's six lines, then Step 12's.

A mutant that stays green is a guard that does not hold. Report it, and never weaken the test to make it red. A CONTROL that reds before its guard runs is the fixture's to fix.

- [ ] **Step 14: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms, one suite per call. If a file goes red, re-run it alone before calling it a break: `typecheck-tests` and `session-hook` are among CLAUDE.md's load flakes.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts -t 'C64|operator door')
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'recall-off parity|CITATION DEBT|RANGE BOUND')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
```

Expected: each passes.
- `history-skill`'s README pin (`bar the `--migrate` an older restored store needs first …`) still holds, because Step 7 kept that line whole.
- `history-maint`'s C64 CONTROL still excludes the recall-off pair.
- `session-hook`'s citation audit still reads its two frozen documents' anchors, all far above line 5100 of `single-definition.test.ts`, so its per-file census does not move.

- [ ] **Step 15: Check the departures' entries.** D-5763, D-5764 and D-6239 are defined in this plan's `## Deviations found`. They came with the plan, and this task is the first in the PR that ships them. Each of the first three commands prints 1, and the fourth prints `no D-TBD token`. Never add a second entry.

```bash
grep -c '^- \*\*D-5763\*\* — ' docs/superpowers/plans/2026-10-21-ccrc-history-w2-1-recall-off-and-exports.md
grep -c '^- \*\*D-5764\*\* — ' docs/superpowers/plans/2026-10-21-ccrc-history-w2-1-recall-off-and-exports.md
grep -c '^- \*\*D-6239\*\* — ' docs/superpowers/plans/2026-10-21-ccrc-history-w2-1-recall-off-and-exports.md
grep -rn 'D-TBD-[a-z0-9]' ccd/history shared README.md server/test || echo 'no D-TBD token'
```

If a figure this task measured differs from an entry's text, correct the entry and add the plan file to Step 16's `git add`. Then:

```bash
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

- [ ] **Step 16: Commit.**

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs ccd/history/cli.mjs shared/lifecycle.ts README.md \
  server/test/history-lib.test.ts server/test/history-op.test.ts server/test/history-cli.test.ts server/test/history-recall.test.ts \
  server/test/history-recover.test.ts server/test/single-definition.test.ts server/test/lifecycle.test.ts
git commit -m "feat(history): recall-off writes through the shim, checks the id's generation under the lock, and has one writer (W2-1 Task 3; W2-D26, W2-D27, W2-D28, W2-D29; D-5763, D-5764, D-6239)"
```

**Not in this task:**
- The spec's errata E1, E3, E4 and E6 (decisions §6), citing D-5764, D-5763, D-5764 and nothing respectively, and the added §8.8 and §9.4 errata (R6): Task 6 amends them in place, in this PR. This task edits no spec text.
- W2-D30's presence record and its scan (Task 4), which reads each id's file through `readBounded` itself (R3).
- RP8 end to end (W2-D32), and with it RP10's card half (Task 5; R5).
- `status --json`'s `recall_off` block (W2-D31; Task 4).
- `ccd/session-hook.sh`'s stale "4,096 bytes" sentence: the next fleet PR that holds the hook (R3).

---

### Task 4: the per-tick presence record and status --json

W2-D30 and W2-D31. The eval drops a family from the reported arm comparisons when its `recall-off/<id>` file appeared, changed or went during the window (spec §10.2 "A changed assignment", `recall_off_changed`). Nothing records that today: the CLI and the hook read the file when they answer, and no tick keeps what it saw. W2-3 already ships the reader (`deploy/history-gate.mjs` `parseRecallOffRow` and `changedFamilies`, over W2-D30's keys). This task ships the writer:
- a new tick step, `recordRecallOff`, immediately before `recordTick`, on the normal pass only. It reads `recall-off/` once with `opendirSync` and a counted iteration that stops past `RECALL_OFF_SCAN_MAX`, reads each idOk name through `readBounded`, and keeps what it saw in meta rows under `RECALL_OFF_META`: `state:<id>`, `seen_ms`, `change:<ts_ms>:<id>` and `gap:<ts_ms>`. No schema change;
- the change and gap rows' durability: each one is a `recall-off` journal record, inserted into `journal_outbox` in the same transaction as its meta rows and flushed right after, as `verdictTx` flushes. `JOURNAL_KINDS` gains `'recall-off'`, and replay rebuilds the rows from the journal without reading the directory;
- `status --json`'s `recall_off: {seen_ms, files, unreadable}`, read from the meta rows, and one human line (W2-D31).

lib decides everything: the state a read is, the rows and records one complete observation writes, the rows one journal record replays to, and what status reports. `sweep.mjs` measures the directory and writes the rows, and `cli.mjs` reports them. W2-D30 and W2-D31 are "build · no". This task's one departure from W2-D30's text is D-6240 (`history-recall-off-seen-survives-restore`; Choices, below; R4), whose entry is in this plan's "Deviations found". This task does not edit the spec: E5 (§8.4 `status`) and the added §9.14 erratum for the new journal kind are Task 6's (R6).

**Order.** This task runs after Task 2 and Task 3 have been committed on this branch. It uses Task 2's constants and `historyPaths(home).recallOffDir`, Task 3's writer only through the files it leaves on disk, and Task 3's O13 case, whose reader count its scan moves from 1 to 2 (Step 10; R3). The tests plant those files the way the writer leaves them: `<generation>\n`, mode 0600, in a 0700 `recall-off/`. This task never calls the verb. Every line number below was measured at `02d75ae5f` (wave 5h-2's merge, #1010). Tasks 1 to 3 of this plan move them, so each anchor is re-found by its quoted content, and Step 1 asserts that each one occurs once.

**Files:**
- Modify: `ccd/history/lib.mjs` (L1; imports `node:crypto` only):
  - `JOURNAL_KINDS` (about :288 at 02d75ae5f), the line `export const JOURNAL_KINDS = Object.freeze(['head', 'file', 'spool', 'verdict', 'redact', 'tick']);`: gains `'recall-off'`;
  - directly above the doc comment that begins ``/** Exactly the declared fields beyond `v`, `k`, `t`: none missing, none extra,`` (about :756), i.e. right after `VERDICT_SHAPES` closes: the module-private `RECALL_OFF_DIGEST_RE`, `isRecallOffState`, `RECALL_OFF_RKS`, `RECALL_OFF_BASE` and `RECALL_OFF_SHAPES`;
  - `parseJournalRecord` (about :772): a `recall-off` branch inserted above its last line, `  return fieldsOk(o, {}, RECORD_SHAPES[o.k]) ? { kind: 'record', rec: o } : { kind: 'malformed' };`;
  - `replayStep` (about :6319): a `case 'recall-off'` inserted after the `case 'tick'` block, whose return line is `      return { state, actions: rec.t > state.ticksAfter && before ? [{ do: 'tick', t: rec.t, lagMs: rec.lag_ms }] : [] };`;
  - directly after `decideRecallOff`'s body, which ends `  return file.value.trim() === generation ? 'off' : 'stale';` and `}` (about :4350-4354): the new block, holding `RECALL_OFF_KEYS`, `recallOffStateOf`, `planRecallOffObservation`, `recallOffReplayRows`, `recallOffStatusOf`, and the module-private `RECALL_OFF_SEEN_RE`, `recallOffSeenOf`, `recallOffStateRowOf` and `recallOffById`. `RECALL_OFF_KEYS` reads Task 2's `RECALL_OFF_META` when the module loads, so Task 2's declaration must stand above this block (Step 1 checks).
- Modify: `ccd/history/lib.d.mts`:
  - `export type JournalKind = 'head' | 'file' | 'spool' | 'verdict' | 'redact' | 'tick';` (about :102): gains `'recall-off'`;
  - in `ReplayAction` (about :726), one member after `  | { do: 'tick'; t: number; lagMs: number | null }`;
  - directly after `export function decideRecallOff(i: { file: Presence<string>; generation: string }): 'off' | 'stale' | 'none';` (about :537): the block of declarations, each declared exactly once.
- Modify: `ccd/history/sweep.mjs` (L4):
  - a new pair of import statements directly after `import { cardStep, collectPurgedHistoryFiles, ensureHistoryDirs, withdrawCards } from './card.mjs';` (about :88). They are this task's own statements, so the long import lists that Tasks 2 and 3 edit are left alone;
  - `tick`'s docstring (about :3614-3656): a new item 19, `recordRecallOff`, and items 19 to 23 renumbered 20 to 24;
  - `tick`'s body (about :3749-3751): the call between `  mergeSteps(db, ictx, ctx.budget);` and the comment line `  // §9.2 step 6: the tick's row and journal record. A paused ingest records an unmeasured lag.`;
  - `applyReplayAction` (about :2573): a `case 'recall-off'` after the `case 'tick'` block, whose body line is `      db.prepare(RECOVER_TICK_INSERT).run(a.t, a.lagMs);`;
  - directly above the doc comment that begins ``/** The tick's `ticks` row and its journal `tick` record (§9.2 step 6; W1-b, doctor's catching-up; slug`` (about :5172): `RECALL_OFF_INSERT_SQL`, `RECALL_OFF_DELETE_SQL`, `RECALL_OFF_STATE_SQL`, the module-private `scanRecallOff`, and the export `recordRecallOff`.
  - Everything goes above the entry guard. There is no top-level await.
  - Not touched: `recoverPass` (about :3394), which never calls the step; `recallOffPresence`, which is Task 3's (W2-D29), and which the scan does not call: it reads each id's file through `readBounded` itself, with the same arguments (R3); the writer, which is Task 3's.
- Modify: `ccd/history/cli.mjs` (L4):
  - `emptyEnvelope` (about :154): one member after the line `    redact_unreadable: [],`;
  - `readStore` (about :285): one line after `    env.redact_unreadable = Array.isArray(unreadable) ? unreadable.filter((x) => typeof x === 'string') : [];`;
  - `render` (about :410): one human line after the `export(…)` loop, whose last template line is ``        + `due=${ex.due_blobs} overdue=${ex.overdue_blobs} segments=${ex.segments}`);``.
  - It reads lib through the existing `healthLib` namespace import (:44), so it adds no name to an import list that Task 3 edits.
- Test: `server/test/history-lib.test.ts`: two import lines (`roLib`, `roGate`) and one describe, appended at the end of the file, after whatever Tasks 1 to 3 appended.
- Test: `server/test/history-sweep.test.ts`: two import lines and one describe, appended at the end (after :557). The existing describe `tick()'s docstring names its steps in the order the body runs them` (:530-557) is not edited: it pins the new item.
- Test: `server/test/history-recover.test.ts`: one import line and one describe, appended at the end (after :6382).
- Test: `server/test/history-cli.test.ts`: one describe, appended at the end (after :1296).
- Test: `server/test/history-op.test.ts`: one line re-expected in place, line count unchanged. In `describe('W1-j and O34: the journal audit'`, the case `it('verdicts still in the outbox are not missing: an audit pass whose journal cannot be appended skips, and runs once the outbox empties'` (about :1554-1576) asserts `expect(countOf(box, 'journal_outbox'), 'the flush could not append, so the row waits').toBe(1);` (about :1566). Its pass clock is a month ahead of the passes before it, so the new step writes a gap record (W2-D30) whose flush fails beside the planted verdict, and the outbox holds 2 rows. The line counts the verdict rows alone (Step 6 (e)).
- Test: `server/test/single-definition.test.ts`, two in-place edits, neither moving a line below it but the one `VOCABS` line:
  - `'RECALL_OFF_KEYS'` joins O14's `VOCABS` at the list's close, after Task 2's entries (R2);
  - in O13's case `recall-off/<id>: exactly one writer, sweep.mjs` (Task 3's), the reader-count line `    expect(reader, 'sweep.mjs reads recall-off/<id> through readBounded exactly once (W2-D29)').toHaveLength(1);` becomes a count of 2, because the scan reads each id's file through `readBounded` itself (W2-D29; R3).
- Not edited: `ccd/history/store.mjs`, `derive.mjs`, `recall.mjs`, `card.mjs`; `deploy/**` (`history-gate.mjs` is read by a test, never edited here); `deploy/history-replay.mjs`; `server/test/history-replay.test.ts`; `.github/workflows/*`; `shared/**`; README.md; the spec. No file is created.

**Interfaces:**
- Consumes (Task 2, on disk at this task's base; Step 1 checks each):
  - `lib.mjs`: `RECALL_OFF_META = 'recall_off:'`, `RECALL_OFF_GAP_MS = 600000`, `RECALL_OFF_SCAN_MAX = 4096`, each exported and declared in `lib.d.mts`;
  - `historyPaths(home).recallOffDir`, the `recall-off/` directory under the history root, and `recallOffPath(home, id)`, which answers `${recallOffDir}/${id}` after `idOk` and throws a `TypeError` otherwise.
- Consumes (Task 3): no name in code. Tests plant the files the verb leaves, and Step 10 moves O13's reader count, which Task 3 wrote, from 1 to 2.
- Consumes (base, unchanged):
  - `store.mjs`: `readBounded(path, max, follow): { state: 'absent' } | { state: 'unreadable' } | { state: 'over-cap' } | { state: 'value'; value: string }` (opened with `O_NOFOLLOW` when `follow` is false; a non-regular file is `unreadable`); `withTx(db, 'NORMAL' | 'FULL', fn)`; `getMeta`, `setMeta`, `bump`.
  - `lib.mjs`: `CONTROL_FILE_MAX` (65536), `idOk`, `canonicalJson`, `sha256Hex`, `journalRecord`, `parseJournalRecord`, `replayStep`; the module-private `isGen`, `isMs`, `oneOf`, `shape` and `fieldsOk`.
  - `sweep.mjs`: `isRecovering(db): boolean` (:2086), `outboxRow(db, rec)` (:6393), `flushOutbox(db, home, ids, nowMs)` (:303), `countOutside(db, name, by)` (:311), `JournalError` (:167), and `verdictTx`'s flush shape (:1489).
  - `deploy/history-gate.mjs` (W2-3, merged), tests only: `parseRecallOffRow(k, v)` and `changedFamilies(metaRows, window, list)`.
- Produces (`lib.mjs`):
  - `JOURNAL_KINDS` gains `'recall-off'`. `JOURNAL_V` stays 1.
  - A `recall-off` journal record is `{v: 1, k: 'recall-off', t, rk, …}`:
    - `rk: 'change'` carries exactly `id` (idOk), `from` (`'unobserved'` or a state), `to` (`'absent'` or a state) and `prev_seen_ms` (ms or null);
    - `rk: 'gap'` carries exactly `from` (ms or null) and `to` (ms);
    - a state is exactly `{s: 'value', v}`, with `v` either a generation (`''` or a lowercase UUID) or `sha256:` and 64 hex digits, or exactly `{s: 'unreadable', v: null}`;
    - `parseJournalRecord` answers `unknown` for an `rk` outside `['change', 'gap']` (a newer build's row kind) and `malformed` for any other breach.
  - `replayStep` answers a recall-off record with `[{ do: 'recall-off', rec }]`, at its own position in the journal.
  - `export const RECALL_OFF_KEYS`, frozen: `{ seen: 'recall_off:seen_ms', state: 'recall_off:state:', change: 'recall_off:change:', gap: 'recall_off:gap:' }`, each built from `RECALL_OFF_META`, so the prefix is never spelled again.
  - `export function recallOffStateOf(read): RecallOffState | 'absent'`, over `readBounded`'s answer.
  - `export function planRecallOffObservation({ seenRaw, stateRows, files, startMs, endMs }): { seen: {k, v}, put: {k, v}[], del: string[], insert: {k, v}[], records: { t, fields }[], malformed: number }`.
    - `seenRaw` is meta `seen_ms` or null. `stateRows` is `{id, raw}[]`, from the `state:` rows. `files` is `{id, state}[]`, each id idOk.
    - It throws a `TypeError` when `startMs` or `endMs` is not an ms, when `endMs < startMs`, or when a file id fails idOk.
    - `insert` holds the change and gap rows, written `DO NOTHING`. `put` and `del` are the state rows. `records` are the journal records, each `{ t: endMs, fields }`.
  - `export function recallOffReplayRows(rec): { insert: {k, v}, put: {k, v} | null, del: string | null }`. For any record the plan wrote, it gives the same row bytes the plan wrote.
  - `export function recallOffStatusOf(meta: Iterable<[string, string]>): { seen_ms: number | null, files: number, unreadable: number }`.
- Produces (`lib.d.mts`): `RECALL_OFF_KEYS`, `RecallOffState`, `RecallOffRow`, `RecallOffPlan`, and the four functions, each declared once. `JournalKind` and `ReplayAction` are widened in place.
- Produces (`sweep.mjs`):
  - `export function recordRecallOff(db, ctx): void`, tick step 19. It reads `ctx.home`, `ctx.paths.recallOffDir`, `ctx.now` and `ctx.ids`.
  - `applyReplayAction` applies `{ do: 'recall-off', rec }`.
  - New counters: `recall_off_scan_capped`, `recall_off_dir_unreadable`, `recall_off_name_skipped` (by the number of names) and `recall_off_state_malformed`.
- Produces (`cli.mjs`): the envelope's `recall_off: { seen_ms: number | null, files: number, unreadable: number }`, which is `{ seen_ms: null, files: 0, unreadable: 0 }` when no store was read, and the human line `recall-off: seen=<ISO time or never> files=<n> unreadable=<n>`. It is additive and names no id.

**Spec:** §9.2 (the tick's order), §9.14 "What it holds" and "Journal replay", §10.2 "A changed assignment" (`recall_off_changed`, which these rows realise), §8.4 `status`. This task edits none of them; Task 6 amends E5 and §9.14 (R6). Decisions: W2-D30 and W2-D31 in full, W2-D29's "every content reader … `readBounded(recallOffPath(...), CONTROL_FILE_MAX, false)`" for the scan (R3), and W2-D23 (the gate reads these rows). Its departure is D-6240 (Choices; R4).

**Choices this task makes:**
- **Two clocks per observation.** `startMs` is read before the directory is opened, and it becomes `seen_ms`. `endMs`, read after the last file and never before `startMs`, keys every change and gap row the observation writes and is each record's `t`. A file read during the scan changed at some time in `(prev_seen_ms, endMs]`, so both bounds sit on the conservative side of W2-3's drop test, `(prev_seen_ms ?? -∞) < window_end && ts_ms >= window_start`. One clock read after the scan would make `prev_seen_ms` later than the read it stands for. One clock read before the scan would make `ts_ms` earlier than a change made during it.
- **A value is the file's text, trimmed as `decideRecallOff` trims it (R4).** It is kept as it is when it is a generation (`''` or a lowercase UUID, what Task 3 writes). Any other content is kept as `sha256:<hex>`. So a planted file's change is still seen, a state row and a journal line stay under 80 bytes of `v` whatever the file holds, and the record's grammar stays closed. `'G\n'` and `'G'` are one state, as they are one answer to the CLI. W2-D30 names `v` and does not define it.
- **The first observation of a file, or of any file with no state row, is a change from `'unobserved'` with `prev_seen_ms: null`**, even when `seen_ms` is present and the last complete observation saw no such file. This is W2-D30's letter, and it is the conservative reading: W2-3 reads null as -∞. A file that comes back after the window can drop its family. That costs the eval sample size, never correctness.
- **A state row off the grammar reads as `'unobserved'`** (the change carries `prev_seen_ms: null` and the row is rewritten), and **a state row whose key names no idOk id is deleted with no record**, because `journalRecord` would refuse such an id. Each is counted in `recall_off_state_malformed`. **A `seen_ms` off the grammar reads as absent**, which gives a gap from null.
- **The step flushes its records right after its transaction**, as `verdictTx` does (a `JournalError` is counted `journal_write_failed`; with no writer token the rows wait in the outbox for the next tick's first step). W2-D30 names "the insertBindFacts pattern". That function is `store.mjs`-private and leaves its rows for the next tick's flush, and `store.mjs` is not on W2-1's file list. The transaction is `FULL` when it holds a record, as every outbox insert is, and `NORMAL` when it only moves `seen_ms`, which is every quiet tick.
- **Outside the run budget, as `recordTick` is.** `RECALL_OFF_SCAN_MAX` bounds its reads. A step held by a spent budget would leave `seen_ms` behind on every busy tick, and the next tick would write a gap row. 5h-1's bounded export check and 5h-2's re-clean draw on `ctx.budget` inside `exportStep` and `rederiveFts`. This step takes none of it.
- **The directory is lstat'ed first, and only a real directory is opened.** ENOENT is an empty, complete observation. A link, a file, any other lstat failure, an `opendirSync` failure, or a `readSync` that throws mid-listing is `unreadable`. Names are listed before any file is read, so a capped directory has none of its files read.
- **`recordRecallOff` also returns at its first line while `isRecovering(db)`.** The scheduled path reaches `tick` only on planRun's `run` arm, which is never chosen while a recovery step is registered. The guard keeps that true for any other caller (an in-process `tick`), and a CONTROL pins it.
- **`RECALL_OFF_KEYS` is exported and joins O14's `VOCABS`.** The sweep reads the state rows by key range, `[state, state with ':' replaced by ';')`, so meta's primary key bounds the read. The change and gap rows, which accumulate, are never read by a tick. Status reads every meta row already (`STATUS_SQL.meta`), so it needs no new query.
- **`seen_ms` survives a restore or an adopt (D-6240; R4).** W2-D30 says `seen_ms` is absent "after a recovery". At the base, a rebuild starts from an empty store, so that holds there. A restore copies the backup's meta, and an adopt keeps the store's, so `seen_ms` survives both and nothing in W2-1's file list removes it. Built as is, the first tick after a restore uses the backup's `seen_ms`. That is earlier than any observation since, so the interval and gap it writes are wider, which is safe. The first tick after an adopt compares the old box's state rows with this box's directory, carrying the old box's `seen_ms`. R4 keeps it as built: after a restore every change keeps a finite `prev_seen_ms` bound instead of −∞, and the named nodes' trees are frozen through the window, so neither a restore nor an adopt is expected there.
- **Residuals, named:**
  - (a) the restore and adopt edge above;
  - (b) a link swapped in at `recall-off/` between the `lstatSync` and the `opendirSync`, which needs an out-of-band actor, because the tick and the writer both hold the shim's lock;
  - (c) a clock that steps back onto an earlier observation's `endMs` for the same id: the second change row's insert does nothing, so the first row stands (both records are journaled, and replay keeps the first in journal order). A backward step can also give a row whose `ts_ms` is below its `prev_seen_ms`;
  - (d) the step's cost on a planted directory: up to `RECALL_OFF_SCAN_MAX` reads of up to `CONTROL_FILE_MAX` bytes each, outside the run budget;
  - (e) after a rollback, an older build skips each `recall-off` record, counting it `journal_record_unknown` in replay and `journal_skipped` in the journal audit (doctor WARN `journal-record-skipped`, whose remedy already reads "none needed if the journal came from a newer build"). Its ticks write no presence rows. After the roll forward, the stale `seen_ms` gives a gap row that covers the interval.

- [ ] **Step 1: Confirm the base, Task 2's names and the anchors.** From the repository root:

```bash
grep -nE '^export const (RECALL_OFF_META|RECALL_OFF_GAP_MS|RECALL_OFF_SCAN_MAX) = ' ccd/history/lib.mjs
grep -n '^export function decideRecallOff(' ccd/history/lib.mjs
grep -cE 'recallOffDir: ' ccd/history/lib.mjs
grep -cE '^export const (RECALL_OFF_META|RECALL_OFF_GAP_MS|RECALL_OFF_SCAN_MAX): ' ccd/history/lib.d.mts
grep -cF -f - ccd/history/lib.mjs <<'EOF'
export const JOURNAL_KINDS = Object.freeze(['head', 'file', 'spool', 'verdict', 'redact', 'tick']);
EOF
grep -cF -f - ccd/history/lib.mjs <<'EOF'
  return fieldsOk(o, {}, RECORD_SHAPES[o.k]) ? { kind: 'record', rec: o } : { kind: 'malformed' };
EOF
grep -cF -f - ccd/history/lib.mjs <<'EOF'
/** Exactly the declared fields beyond `v`, `k`, `t`: none missing, none extra,
EOF
grep -cF -f - ccd/history/lib.mjs <<'EOF'
      return { state, actions: rec.t > state.ticksAfter && before ? [{ do: 'tick', t: rec.t, lagMs: rec.lag_ms }] : [] };
EOF
grep -cF -f - ccd/history/lib.mjs <<'EOF'
  return file.value.trim() === generation ? 'off' : 'stale';
EOF
grep -cF -f - ccd/history/lib.d.mts <<'EOF'
export type JournalKind = 'head' | 'file' | 'spool' | 'verdict' | 'redact' | 'tick';
EOF
grep -cF -f - ccd/history/lib.d.mts <<'EOF'
  | { do: 'tick'; t: number; lagMs: number | null }
EOF
grep -cF -f - ccd/history/lib.d.mts <<'EOF'
export function decideRecallOff(i: { file: Presence<string>; generation: string }): 'off' | 'stale' | 'none';
EOF
grep -cF -f - ccd/history/sweep.mjs <<'EOF'
import { cardStep, collectPurgedHistoryFiles, ensureHistoryDirs, withdrawCards } from './card.mjs';
EOF
grep -cF -f - ccd/history/sweep.mjs <<'EOF'
 * 19. `recordTick`: the tick's row and journal record (a paused ingest records an unmeasured lag);
EOF
grep -cF -f - ccd/history/sweep.mjs <<'EOF'
  // §9.2 step 6: the tick's row and journal record. A paused ingest records an unmeasured lag.
EOF
grep -cF -f - ccd/history/sweep.mjs <<'EOF'
/** The tick's `ticks` row and its journal `tick` record (§9.2 step 6; W1-b, doctor's catching-up; slug
EOF
grep -cF -f - ccd/history/sweep.mjs <<'EOF'
      db.prepare(RECOVER_TICK_INSERT).run(a.t, a.lagMs);
EOF
grep -cF -f - ccd/history/sweep.mjs <<'EOF'
    recordTick(db, ictx, null);
EOF
grep -cF -f - ccd/history/cli.mjs <<'EOF'
    redact_unreadable: [],
EOF
grep -cF -f - ccd/history/cli.mjs <<'EOF'
    env.redact_unreadable = Array.isArray(unreadable) ? unreadable.filter((x) => typeof x === 'string') : [];
EOF
grep -cF -f - ccd/history/cli.mjs <<'EOF'
        + `due=${ex.due_blobs} overdue=${ex.overdue_blobs} segments=${ex.segments}`);
EOF
grep -c "const VOCABS = \['NODE_KINDS'" server/test/single-definition.test.ts
awk '/const VOCABS = \[/{f=1} f && /\] as const;/{print NR": "$0; exit}' server/test/single-definition.test.ts
grep -c 'RECALL_OFF_KEYS\|recallOffStateOf\|planRecallOffObservation\|recallOffReplayRows\|recallOffStatusOf\|recordRecallOff\|scanRecallOff\|RECALL_OFF_RKS\|recall_off_scan_capped' \
  ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs ccd/history/cli.mjs
grep -c 'opendirSync' ccd/history/sweep.mjs
```

Expected:
- the first command prints three lines, one per constant (`RECALL_OFF_GAP_MS` is 600000, `RECALL_OFF_SCAN_MAX` 4096), each at a SMALLER line number than `decideRecallOff`'s, which the second command prints. `RECALL_OFF_KEYS` reads `RECALL_OFF_META` when the module loads; if `RECALL_OFF_META` were declared after `decideRecallOff`, the module would throw a `ReferenceError` at load, so stop and report it;
- `recallOffDir: ` counts 1, and the `lib.d.mts` count is 3;
- every anchor count is 1, the `VOCABS` declaration included. The `awk` line prints the one line that closes `VOCABS`. At 02d75ae5f that line is `    'SEGMENT_HEADER_BYTES'] as const;` (about :5301), and after Task 2 it closes on Task 2's last entry. `] as const;` alone occurs 26 times in that file, so Step 10 edits only the line the `awk` prints;
- the name count is 0 in each of the four files;
- `opendirSync` counts 0: Task 3 adds only `fchmodSync` and `mkdirSync` to `sweep.mjs`'s `node:fs` import, so Step 8's own statement binds it once.

Any other answer means the base moved: re-read the region, and stop and report if Task 2's names are not there. Before the first edit of each file, read the claims as the plan's Global Constraints say.

- [ ] **Step 2: Write the failing lib tests.** Append at the end of `server/test/history-lib.test.ts`:

```ts

// ── W2-1 Task 4: the recall-off presence record (W2-D30), its journal records, and status's block (W2-D31) ────────────
// lib decides every row the sweep's tick step writes: the state a read is, the rows and records one complete observation
// writes, the rows one journal record replays to (byte for byte the live ones), and status's counts. The gate's own reader
// (deploy/history-gate.mjs, W2-3) reads the rows back, so the two ends of W2-D30's keys are pinned against each other.
import * as roLib from '../../ccd/history/lib.mjs';
import * as roGate from '../../deploy/history-gate.mjs';

describe('lib: the recall-off presence record (W2-D30, W2-D31; W2-1 Task 4)', () => {
  const K = roLib.RECALL_OFF_KEYS;
  const GAP = roLib.RECALL_OFF_GAP_MS;
  const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
  const G2 = '0189abcd-1234-4678-9abc-0123456789ac';
  const X = 'claude-a-demo';
  const Y = 'claude-b-demo';
  const C = 'claude-c-demo';
  const val = (v: string): { s: 'value'; v: string } => ({ s: 'value', v });
  const UNREADABLE = { s: 'unreadable' as const, v: null };
  const row = (id: string, st: object): { id: string; raw: string } => ({ id, raw: roLib.canonicalJson(st) });
  type PlanIn = Parameters<typeof roLib.planRecallOffObservation>[0];
  const plan = (o: Partial<PlanIn>): roLib.RecallOffPlan =>
    roLib.planRecallOffObservation({ seenRaw: '1000', stateRows: [], files: [], startMs: 2000, endMs: 2005, ...o });
  const changeOf = (p: roLib.RecallOffPlan, id: string): Array<Record<string, unknown>> => p.insert
    .filter((r) => r.k.startsWith(K.change) && r.k.endsWith(`:${id}`)).map((r) => ({ k: r.k, ...(JSON.parse(r.v) as object) }));
  const gapsOf = (p: roLib.RecallOffPlan): Array<Record<string, unknown>> => p.insert
    .filter((r) => r.k.startsWith(K.gap)).map((r) => ({ k: r.k, ...(JSON.parse(r.v) as object) }));

  it('RECALL_OFF_KEYS: the four keys, each under RECALL_OFF_META, frozen', () => {
    const M = roLib.RECALL_OFF_META;
    expect(K).toEqual({ seen: `${M}seen_ms`, state: `${M}state:`, change: `${M}change:`, gap: `${M}gap:` });
    expect(Object.isFrozen(K)).toBe(true);
  });

  it('recallOffStateOf: a generation trimmed, unreadable and over-cap never absent, any other content a digest', () => {
    expect(roLib.recallOffStateOf({ state: 'value', value: `${G1}\n` })).toEqual(val(G1));
    expect(roLib.recallOffStateOf({ state: 'value', value: '' })).toEqual(val(''));
    expect(roLib.recallOffStateOf({ state: 'unreadable' })).toEqual(UNREADABLE);
    expect(roLib.recallOffStateOf({ state: 'over-cap' })).toEqual(UNREADABLE);
    expect(roLib.recallOffStateOf({ state: 'absent' })).toBe('absent');
    expect(roLib.recallOffStateOf({ state: 'value', value: ' not a generation \n' })).toEqual(val(`sha256:${roLib.sha256Hex('not a generation')}`));
    expect(roLib.recallOffStateOf({ state: 'value', value: G1.toUpperCase() }), 'an uppercase UUID is no generation')
      .toEqual(val(`sha256:${roLib.sha256Hex(G1.toUpperCase())}`));
  });

  it('the first observation ever: a gap from null, and a present file a change from unobserved with prev_seen_ms null', () => {
    const p = plan({ seenRaw: null, files: [{ id: X, state: val(G1) }] });
    expect(gapsOf(p)).toEqual([{ k: `${K.gap}2005`, from: null, to: 2000 }]);
    expect(changeOf(p, X)).toEqual([{ k: `${K.change}2005:${X}`, from: 'unobserved', to: val(G1), prev_seen_ms: null }]);
    expect(p.put).toEqual([{ k: `${K.state}${X}`, v: roLib.canonicalJson(val(G1)) }]);
    expect(p.seen, 'seen_ms is the observation\'s START; its rows are keyed by its END').toEqual({ k: K.seen, v: '2000' });
    expect(p.records).toEqual([
      { t: 2005, fields: { rk: 'gap', from: null, to: 2000 } },
      { t: 2005, fields: { rk: 'change', id: X, from: 'unobserved', to: val(G1), prev_seen_ms: null } },
    ]);
  });

  it('an unchanged file is not flagged: no row, no record, no rewrite, and seen_ms still moves', () => {
    const p = plan({ stateRows: [row(X, val(G1))], files: [{ id: X, state: val(G1) }] });
    expect([p.insert, p.records, p.put, p.del]).toEqual([[], [], [], []]);
    expect(p.seen.v).toBe('2000');
  });

  it('one change row per transition: a new generation and a file gone carry the last observation, a new file null', () => {
    const p = plan({ stateRows: [row(X, val(G1)), row(Y, val(G2))], files: [{ id: X, state: val(G2) }, { id: C, state: val(G1) }] });
    expect(changeOf(p, X)).toEqual([{ k: `${K.change}2005:${X}`, from: val(G1), to: val(G2), prev_seen_ms: 1000 }]);
    expect(changeOf(p, Y)).toEqual([{ k: `${K.change}2005:${Y}`, from: val(G2), to: 'absent', prev_seen_ms: 1000 }]);
    expect(changeOf(p, C), 'a file with no state row is unobserved, whatever seen_ms says')
      .toEqual([{ k: `${K.change}2005:${C}`, from: 'unobserved', to: val(G1), prev_seen_ms: null }]);
    expect(p.put).toEqual([{ k: `${K.state}${X}`, v: roLib.canonicalJson(val(G2)) }, { k: `${K.state}${C}`, v: roLib.canonicalJson(val(G1)) }]);
    expect(p.del).toEqual([`${K.state}${Y}`]);
    expect(p.records.map((r) => r.fields.rk)).toEqual(['change', 'change', 'change']);
  });

  it('unreadable is never absent: an unreadable read is a change to unreadable, its state row kept', () => {
    const p = plan({ stateRows: [row(X, val(G1))], files: [{ id: X, state: UNREADABLE }] });
    expect(changeOf(p, X)).toEqual([{ k: `${K.change}2005:${X}`, from: val(G1), to: UNREADABLE, prev_seen_ms: 1000 }]);
    expect(p.del).toEqual([]);
    expect(p.put).toEqual([{ k: `${K.state}${X}`, v: roLib.canonicalJson(UNREADABLE) }]);
    // CONTROL: a file gone between the listing and its read (readBounded answered absent) IS absent.
    const gone = plan({ stateRows: [row(X, val(G1))], files: [{ id: X, state: 'absent' }] });
    expect(changeOf(gone, X).map((c) => c['to'])).toEqual(['absent']);
    expect([gone.put, gone.del]).toEqual([[], [`${K.state}${X}`]]);
  });

  it('a gap row when the last observation is more than RECALL_OFF_GAP_MS old, and none at exactly that age', () => {
    const at = 10 * GAP;
    expect(gapsOf(plan({ seenRaw: String(at - GAP - 1), startMs: at, endMs: at + 3 })))
      .toEqual([{ k: `${K.gap}${at + 3}`, from: at - GAP - 1, to: at }]);
    expect(gapsOf(plan({ seenRaw: String(at - GAP), startMs: at, endMs: at + 3 })), 'CONTROL: exactly the gap is no gap').toEqual([]);
  });

  it('after a rebuild (state rows replayed, seen_ms never replayed): a gap from null, no row for an unchanged file, null for a changed one', () => {
    const p = plan({ seenRaw: null, stateRows: [row(X, val(G1)), row(Y, val(G1))], files: [{ id: X, state: val(G1) }, { id: Y, state: val(G2) }] });
    expect(gapsOf(p).map((g) => g['from'])).toEqual([null]);
    expect(changeOf(p, X), 'unchanged since before the rebuild: no change row').toEqual([]);
    expect(changeOf(p, Y)).toEqual([{ k: `${K.change}2005:${Y}`, from: val(G1), to: val(G2), prev_seen_ms: null }]);
  });

  it('a seen_ms off its grammar reads as never observed; a state row off its grammar as unobserved; the state rows counted', () => {
    const p = plan({
      seenRaw: '01000',
      stateRows: [{ id: X, raw: '{"s":"maybe"}' }, { id: '../x', raw: roLib.canonicalJson(val(G1)) }],
      files: [{ id: X, state: val(G1) }],
    });
    expect(gapsOf(p).map((g) => g['from'])).toEqual([null]);
    expect(changeOf(p, X)).toEqual([{ k: `${K.change}2005:${X}`, from: 'unobserved', to: val(G1), prev_seen_ms: null }]);
    expect(p.malformed).toBe(2);
    expect(p.del).toEqual([`${K.state}../x`]);
    expect(p.records.some((r) => r.fields['id'] === '../x'), 'no record names an id outside the grammar').toBe(false);
  });

  it('refuses an observation that ends before it starts, and a file id outside the grammar', () => {
    expect(() => plan({ startMs: 2000, endMs: 1999 })).toThrow(/planRecallOffObservation: startMs and endMs/);
    expect(() => plan({ files: [{ id: '../x', state: val(G1) }] })).toThrow(/planRecallOffObservation: not a session id/);
  });

  it('journal: change and gap round-trip as recall-off records at v 1; an unknown rk is unknown, any other breach malformed', () => {
    expect(roLib.JOURNAL_KINDS).toContain('recall-off');
    const p = plan({ seenRaw: null, stateRows: [row(Y, val(G1))], files: [{ id: X, state: UNREADABLE }] });
    expect(p.records.map((r) => r.fields.rk)).toEqual(['gap', 'change', 'change']);
    for (const r of p.records) {
      const line = roLib.journalRecord('recall-off', r.t, r.fields);
      expect(roLib.parseJournalRecord(line)).toEqual({ kind: 'record', rec: { v: 1, k: 'recall-off', t: r.t, ...r.fields } });
    }
    const read = (o: object): string => roLib.parseJournalRecord(JSON.stringify({ v: 1, k: 'recall-off', t: 5, ...o })).kind;
    const ok = { rk: 'change', id: X, from: 'unobserved', to: val(G1), prev_seen_ms: null };
    expect(read(ok), 'CONTROL: well formed').toBe('record');
    expect(read({ rk: 'moved', id: X }), 'a newer build\'s row kind: skipped and counted, never malformed').toBe('unknown');
    expect(read({ rk: 7 })).toBe('malformed');
    expect(read({ rk: 'gap', from: null })).toBe('malformed');
    expect(read({ rk: 'gap', from: null, to: 4, id: X }), 'a field the gap shape does not declare').toBe('malformed');
    expect(read({ ...ok, id: '../x' })).toBe('malformed');
    expect(read({ ...ok, from: 'absent' }), 'from is never absent').toBe('malformed');
    expect(read({ ...ok, to: 'unobserved' }), 'to is never unobserved').toBe('malformed');
    expect(read({ ...ok, to: { s: 'value', v: 'x' } }), 'a value is a generation or a digest').toBe('malformed');
    expect(read({ ...ok, to: { s: 'unreadable', v: 'x' } })).toBe('malformed');
    expect(read({ ...ok, to: { s: 'value', v: G1, w: 1 } }), 'a state is exactly {s, v}').toBe('malformed');
    expect(read({ ...ok, prev_seen_ms: -1 })).toBe('malformed');
  });

  it('an older build reads a recall-off record as an unknown kind, skipped and counted: v stays 1, so it is never newer', () => {
    const o = JSON.parse(roLib.journalRecord('recall-off', 5, { rk: 'gap', from: null, to: 4 })) as Record<string, unknown>;
    expect(o['v'], 'W2-1 does not bump JOURNAL_V: an older build answers unknown, not newer (counted malformed)').toBe(1);
    expect(['head', 'file', 'spool', 'verdict', 'redact', 'tick'], 'the kinds a build before W2-1 knows').not.toContain(o['k']);
    // A build without the kind reads it as this build reads any kind outside its list.
    const older = roLib.parseJournalRecord(JSON.stringify({ ...o, k: 'recall-off-unknown-to-this-reader' }));
    expect(older).toEqual({ kind: 'unknown' });
    const state = { storeId: '00000000-0000-4000-8000-000000000001', file: null, recvMs: 0, drained: new Set<string>(),
      verdictsByKey: new Map<string, readonly roLib.JournalRecord[]>(), ticksAfter: 0, ticksBefore: null };
    expect(roLib.replayStep(state, older).actions).toEqual([{ do: 'skip', counter: 'journal_record_unknown' }]);
  });

  it('replayStep applies each recall-off record at its own position; recallOffReplayRows gives the rows the plan wrote, byte for byte', () => {
    const withGap = plan({ seenRaw: null, files: [] });
    const p = plan({ seenRaw: '1000', stateRows: [row(X, val(G1)), row(Y, val(G1))], files: [{ id: X, state: val(G2) }] });
    const reads = [...withGap.records, ...p.records].map((r) => roLib.parseJournalRecord(roLib.journalRecord('recall-off', r.t, r.fields)));
    const state = { storeId: '00000000-0000-4000-8000-000000000001', file: null, recvMs: 0, drained: new Set<string>(),
      verdictsByKey: new Map<string, readonly roLib.JournalRecord[]>(), ticksAfter: 0, ticksBefore: null };
    const recs = reads.map((r) => (r as { kind: 'record'; rec: roLib.JournalRecord }).rec);
    for (const [i, r] of reads.entries()) expect(roLib.replayStep(state, r).actions).toEqual([{ do: 'recall-off', rec: recs[i] }]);
    const rows = recs.map((rec) => roLib.recallOffReplayRows(rec));
    expect(rows.map((r) => r.insert)).toEqual([...withGap.insert, ...p.insert]);
    expect(rows.flatMap((r) => (r.put === null ? [] : [r.put]))).toEqual(p.put);
    expect(rows.flatMap((r) => (r.del === null ? [] : [r.del])), 'a change to absent deletes the state row').toEqual(p.del);
  });

  it('every row the plan writes reads back through the gate\'s parseRecallOffRow, and changedFamilies drops the family it names', () => {
    const S = '00000000-0000-4000-8000-0000000000aa';
    const p = plan({ seenRaw: null, stateRows: [row(X, val(G1))], files: [{ id: X, state: val(G2) }], startMs: 5000, endMs: 5007 });
    expect(p.insert.map((r) => roGate.parseRecallOffRow(r.k, r.v))).toEqual([
      { kind: 'gap', ts_ms: 5007, from: null, to: 5000 },
      { kind: 'change', ts_ms: 5007, id: X, from: val(G1), to: val(G2), prev_seen_ms: null },
    ]);
    expect(roGate.parseRecallOffRow(p.seen.k, p.seen.v), 'seen_ms is one of the gate\'s other rows').toEqual({ kind: 'other' });
    for (const r of p.put) expect(roGate.parseRecallOffRow(r.k, r.v)).toEqual({ kind: 'other' });
    const metaRows = p.insert.map((r) => ({ store_id: S, k: r.k, v: r.v }));
    const list = [{ store_id: S, ccrc_id: X, generation: G2 }];
    expect(roGate.changedFamilies(metaRows, { start_ms: 4000, end_ms: 6000 }, list).changed).toHaveLength(1);
    expect(roGate.changedFamilies(metaRows, { start_ms: 5008, end_ms: 9000 }, list).changed, 'CONTROL: a window after the change drops nothing')
      .toEqual([]);
  });

  it('recallOffStatusOf: seen_ms, the state rows, and those unreadable or off the grammar; counts only', () => {
    const meta = new Map<string, string>([
      [K.seen, '2000'], [`${K.state}${X}`, roLib.canonicalJson(val(G1))], [`${K.state}${Y}`, roLib.canonicalJson(UNREADABLE)],
      [`${K.state}${C}`, 'not json'], [`${K.change}2005:${X}`, '{}'], [`${K.gap}2005`, '{}'], ['store_id', 'x'],
    ]);
    expect(roLib.recallOffStatusOf(meta)).toEqual({ seen_ms: 2000, files: 3, unreadable: 2 });
    expect(roLib.recallOffStatusOf(new Map()), 'no record yet').toEqual({ seen_ms: null, files: 0, unreadable: 0 });
    expect(roLib.recallOffStatusOf(new Map([[K.seen, 'soon']])).seen_ms).toBeNull();
  });
});
```

The gate module (`deploy/history-gate.mjs`) imports only `node:crypto` and `../ccd/history/lib.mjs` and is pure, so `history-lib.test.ts` still runs on darwin. `measure-history.test.ts` imports it the same way. No earlier task binds `roLib` or `roGate` in this file (Tasks 1 to 3 import lib dynamically or through the file's existing namespaces). ES imports are hoisted, so the import lines may sit at the end, as `libBind`'s does.

- [ ] **Step 3: Run them and see them fail.** From `server/`, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
```

Expected RED (predicted, written before the code): `15 failed`, the rest of the file skipped. `RECALL_OFF_KEYS` is undefined, so the keys case fails at its `toEqual`, and every other case fails with `TypeError: Cannot read properties of undefined` (reading `state`, `change` or `gap`) or `roLib.planRecallOffObservation is not a function`. The journal case fails first at `expect(JOURNAL_KINDS).toContain('recall-off')`. The filter selects only this describe: if the run reports `0 failed`, the filter is wrong. Measured: `15 failed` as predicted, with these wordings: the `recallOffStateOf` case fails with `recallOffStateOf is not a function`, the older-build case with `journalRecord`'s own `TypeError` (`"recall-off" is not a JOURNAL_KINDS member`), and the refusal case at its message match (`expected [Function] to throw error matching /planRecallOffObservation: startMs and endMs/`). The refusal case matches the thrown messages, not the `TypeError` class: with `toThrow(TypeError)` it would pass before the code exists, because calling the undefined function throws a `TypeError` of its own, and Step 3 would read `14 failed | 1 passed`.

- [ ] **Step 4: Write the lib grammar, the plan and the replay rows.** Five edits to `ccd/history/lib.mjs` and three to `ccd/history/lib.d.mts`. Each `old` text below is asserted unique before it is replaced (Step 11's `mut` helper does exactly that, and can be used here).

(a) `lib.mjs`, replace

```js
export const JOURNAL_KINDS = Object.freeze(['head', 'file', 'spool', 'verdict', 'redact', 'tick']);
```

with

```js
// W2-1 Task 4 (W2-D30): 'recall-off' carries the presence record's change and gap rows. JOURNAL_V stays 1, so a build
// before W2-1 reads such a record as an unknown kind, skipped and counted (journal_record_unknown), never as newer.
export const JOURNAL_KINDS = Object.freeze(['head', 'file', 'spool', 'verdict', 'redact', 'tick', 'recall-off']);
```

(b) `lib.mjs`, directly above the line ``/** Exactly the declared fields beyond `v`, `k`, `t`: none missing, none extra,``, insert

```js
// W2-1 Task 4 (W2-D30): a `recall-off` record is one change or gap row of the presence record, keyed by `rk` as a verdict is
// by `kind`. A state is exactly `{s, v}`: `{s: 'value', v}`, v a generation ('' or a lowercase UUID) or `sha256:` and a
// hex digest (recallOffStateOf), or `{s: 'unreadable', v: null}`. A change's `from` may also be 'unobserved' (no state row)
// and its `to` 'absent' (no file); a gap's `from` is the last observation's start, or null when none is recorded.
const RECALL_OFF_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
function isRecallOffState(x) {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const keys = Object.keys(x).sort();
  if (keys.length !== 2 || keys[0] !== 's' || keys[1] !== 'v') return false;
  if (x.s === 'unreadable') return x.v === null;
  return x.s === 'value' && typeof x.v === 'string' && (isGen(x.v) || RECALL_OFF_DIGEST_RE.test(x.v));
}
const RECALL_OFF_RKS = Object.freeze(['change', 'gap']);
const RECALL_OFF_BASE = Object.freeze({ rk: oneOf(RECALL_OFF_RKS) });
const RECALL_OFF_SHAPES = Object.freeze({
  change: shape({
    id: idOk,
    from: (x) => x === 'unobserved' || isRecallOffState(x),
    to: (x) => x === 'absent' || isRecallOffState(x),
    prev_seen_ms: (x) => x === null || isMs(x),
  }),
  gap: shape({ from: (x) => x === null || isMs(x), to: isMs }),
});

```

(c) `lib.mjs`, replace the last line of `parseJournalRecord`

```js
  return fieldsOk(o, {}, RECORD_SHAPES[o.k]) ? { kind: 'record', rec: o } : { kind: 'malformed' };
```

with

```js
  if (o.k === 'recall-off') {
    if (typeof o.rk !== 'string') return { kind: 'malformed' };
    // An rk this build does not know is a newer build's row kind: unknown, skipped and counted, never malformed (W2-1 Task 4).
    if (!RECALL_OFF_RKS.includes(o.rk)) return { kind: 'unknown' };
    return fieldsOk(o, RECALL_OFF_BASE, RECALL_OFF_SHAPES[o.rk]) ? { kind: 'record', rec: o } : { kind: 'malformed' };
  }
  return fieldsOk(o, {}, RECORD_SHAPES[o.k]) ? { kind: 'record', rec: o } : { kind: 'malformed' };
```

(d) `lib.mjs`, in `replayStep`, replace

```js
      return { state, actions: rec.t > state.ticksAfter && before ? [{ do: 'tick', t: rec.t, lagMs: rec.lag_ms }] : [] };
    }
```

with

```js
      return { state, actions: rec.t > state.ticksAfter && before ? [{ do: 'tick', t: rec.t, lagMs: rec.lag_ms }] : [] };
    }
    case 'recall-off':
      // W2-1 Task 4 (W2-D30): applied at its own position, so a state row is last-wins in journal order. The executor
      // inserts the change or gap row DO NOTHING and never reads the directory; seen_ms is never replayed.
      return { state, actions: [{ do: 'recall-off', rec }] };
```

(e) `lib.mjs`, replace

```js
  return file.value.trim() === generation ? 'off' : 'stale';
}
```

with

```js
  return file.value.trim() === generation ? 'off' : 'stale';
}

// ── W2-1 Task 4: the recall-off presence record (W2-D30) and status's block (W2-D31) ──────────────────────────────
// The sweep observes recall-off/ once per tick (sweep.mjs recordRecallOff) and keeps what it saw in meta rows under
// RECALL_OFF_META; no schema change. Every decision is here: the state a read is, the rows and journal records one
// complete observation writes, the rows one journal record replays to, and what status reports.

/** The presence record's meta keys (W2-D30): `seen`, the last complete observation's start in ms; `state` + id, one
 *  file's state, absent while the file is; `change` + `<ts_ms>:<id>`, one transition `{from, to, prev_seen_ms}`; and
 *  `gap` + `<ts_ms>`, one interval with no observation `{from, to}`. deploy/history-gate.mjs's parseRecallOffRow reads
 *  the change and gap rows (W2-D23). */
export const RECALL_OFF_KEYS = Object.freeze({
  seen: `${RECALL_OFF_META}seen_ms`,
  state: `${RECALL_OFF_META}state:`,
  change: `${RECALL_OFF_META}change:`,
  gap: `${RECALL_OFF_META}gap:`,
});

/** One recall-off/<id> read (store.mjs readBounded's answer) as the record keeps it (W2-D30). 'absent' has no state
 *  row. An unreadable or over-cap read is `{s: 'unreadable', v: null}`, never absent (C67: a file that exists says the
 *  id was assigned). A value is the text trimmed as decideRecallOff trims it, kept as it is when that is a generation
 *  ('' or a lowercase UUID) and otherwise as `sha256:` and its hex digest, so a planted file's change is still seen and
 *  a state row stays bounded whatever the file holds. */
export function recallOffStateOf(read) {
  if (read.state === 'absent') return 'absent';
  if (read.state !== 'value') return { s: 'unreadable', v: null };
  const t = read.value.trim();
  return { s: 'value', v: isGen(t) ? t : `sha256:${sha256Hex(t)}` };
}

const RECALL_OFF_SEEN_RE = /^(?:0|[1-9][0-9]{0,15})$/;
/** seen_ms as stored: a decimal ms, else null. A value off that grammar reads as never observed, the conservative
 *  reading: a null prev_seen_ms reads as -Infinity downstream (W2-D23), and a null gap `from` reports the gap. */
function recallOffSeenOf(raw) {
  if (typeof raw !== 'string' || !RECALL_OFF_SEEN_RE.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
/** A state row's value, or null when it is off the grammar (isRecallOffState). */
function recallOffStateRowOf(raw) {
  let x;
  try { x = JSON.parse(raw); } catch { return null; }
  return isRecallOffState(x) ? x : null;
}
const recallOffById = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** What one COMPLETE observation of recall-off/ writes (W2-D30), as data; the sweep writes it in one transaction.
 *  - `seen`: seen_ms becomes the observation's start, `startMs`. Every row it writes is keyed by its end, `endMs`, and
 *    every record's `t` is `endMs`: a change made during the scan lies in (prev_seen_ms, endMs], on the conservative
 *    side of W2-3's drop test at both bounds.
 *  - A gap row `{from, to: startMs}` when seen_ms is absent or off its grammar (`from` null: the first observation, or
 *    the first after a rebuild) or more than RECALL_OFF_GAP_MS before `startMs` (`from` the old seen_ms).
 *  - Changes are recorded only against state rows. A present file with no state row (or one off the grammar) is a change
 *    from 'unobserved' with prev_seen_ms null; a state row whose file is not present (or read absent) is a change to
 *    'absent' and its row is deleted; a state that differs is a change carrying the old seen_ms. An unchanged file writes
 *    nothing. A state row whose key names no idOk id is deleted with no record (journalRecord would refuse its id).
 *  - `insert` rows are written DO NOTHING; `put` and `del` are the state rows; `malformed` counts the rows off grammar. */
export function planRecallOffObservation({ seenRaw, stateRows, files, startMs, endMs }) {
  if (!isMs(startMs) || !isMs(endMs) || endMs < startMs) {
    throw new TypeError(`planRecallOffObservation: startMs and endMs are ms, startMs <= endMs: ${JSON.stringify([startMs, endMs])}`);
  }
  for (const f of files) {
    if (!idOk(f.id)) throw new TypeError(`planRecallOffObservation: not a session id: ${JSON.stringify(f.id)}`);
  }
  const prevSeen = recallOffSeenOf(seenRaw);
  const plan = { seen: { k: RECALL_OFF_KEYS.seen, v: String(startMs) }, put: [], del: [], insert: [], records: [], malformed: 0 };
  const row = (rk, k, body, fields) => {
    plan.insert.push({ k, v: canonicalJson(body) });
    plan.records.push({ t: endMs, fields: { rk, ...fields } });
  };
  const change = (id, from, to, prev) => {
    const body = { from, to, prev_seen_ms: prev };
    row('change', `${RECALL_OFF_KEYS.change}${endMs}:${id}`, body, { id, ...body });
  };
  if (prevSeen === null || startMs - prevSeen > RECALL_OFF_GAP_MS) {
    const body = { from: prevSeen, to: startMs };
    row('gap', `${RECALL_OFF_KEYS.gap}${endMs}`, body, body);
  }
  const prior = new Map();
  for (const r of [...stateRows].sort(recallOffById)) {
    if (!idOk(r.id)) {
      plan.malformed += 1;
      plan.del.push(`${RECALL_OFF_KEYS.state}${r.id}`);
      continue;
    }
    const st = recallOffStateRowOf(r.raw);
    if (st === null) plan.malformed += 1;
    prior.set(r.id, st);
  }
  const present = new Set();
  for (const f of [...files].sort(recallOffById)) {
    if (f.state === 'absent') continue;
    present.add(f.id);
    const was = prior.get(f.id);
    if (was === undefined || was === null) change(f.id, 'unobserved', f.state, null);
    else if (canonicalJson(was) === canonicalJson(f.state)) continue;
    else change(f.id, was, f.state, prevSeen);
    plan.put.push({ k: `${RECALL_OFF_KEYS.state}${f.id}`, v: canonicalJson(f.state) });
  }
  for (const [id, was] of prior) {
    if (present.has(id)) continue;
    change(id, was ?? 'unobserved', 'absent', was === null ? null : prevSeen);
    plan.del.push(`${RECALL_OFF_KEYS.state}${id}`);
  }
  return plan;
}

/** The rows one replayed `recall-off` record gives (W2-D30), byte for byte the rows the live plan wrote for it: the
 *  change or gap row (inserted DO NOTHING), and for a change its state row, last-wins from `to` and deleted when `to` is
 *  'absent'. seen_ms is never replayed, and nothing here reads the directory. */
export function recallOffReplayRows(rec) {
  if (rec.rk === 'gap') {
    return { insert: { k: `${RECALL_OFF_KEYS.gap}${rec.t}`, v: canonicalJson({ from: rec.from, to: rec.to }) }, put: null, del: null };
  }
  const insert = { k: `${RECALL_OFF_KEYS.change}${rec.t}:${rec.id}`, v: canonicalJson({ from: rec.from, to: rec.to, prev_seen_ms: rec.prev_seen_ms }) };
  const key = `${RECALL_OFF_KEYS.state}${rec.id}`;
  return rec.to === 'absent' ? { insert, put: null, del: key } : { insert, put: { k: key, v: canonicalJson(rec.to) }, del: null };
}

/** status --json's `recall_off` (W2-D31), from the meta rows alone: the last complete observation's start, the files
 *  it recorded present, and how many of them read unreadable. A state row off the grammar counts as unreadable: status
 *  never reports a row it cannot read as a readable file. Counts only, never an id, so status stays identity-free. */
export function recallOffStatusOf(meta) {
  let seen = null;
  let files = 0;
  let unreadable = 0;
  for (const [k, v] of meta) {
    if (k === RECALL_OFF_KEYS.seen) seen = recallOffSeenOf(v);
    else if (k.startsWith(RECALL_OFF_KEYS.state)) {
      files += 1;
      const st = recallOffStateRowOf(v);
      if (st === null || st.s === 'unreadable') unreadable += 1;
    }
  }
  return { seen_ms: seen, files, unreadable };
}
```

(f) `lib.d.mts`, replace

```ts
export type JournalKind = 'head' | 'file' | 'spool' | 'verdict' | 'redact' | 'tick';
```

with

```ts
export type JournalKind = 'head' | 'file' | 'spool' | 'verdict' | 'redact' | 'tick' | 'recall-off';
```

(g) `lib.d.mts`, replace

```ts
  | { do: 'tick'; t: number; lagMs: number | null }
```

with

```ts
  | { do: 'tick'; t: number; lagMs: number | null }
  | { do: 'recall-off'; rec: JournalRecord }
```

(h) `lib.d.mts`, directly after `export function decideRecallOff(i: { file: Presence<string>; generation: string }): 'off' | 'stale' | 'none';`, insert

```ts

// --- W2-1 Task 4: the recall-off presence record (W2-D30) and status's block (W2-D31)
export const RECALL_OFF_KEYS: Readonly<{ seen: string; state: string; change: string; gap: string }>;
export type RecallOffState = { s: 'value'; v: string } | { s: 'unreadable'; v: null };
export function recallOffStateOf(
  read: { state: 'absent' } | { state: 'unreadable' } | { state: 'over-cap' } | { state: 'value'; value: string },
): RecallOffState | 'absent';
export interface RecallOffRow { k: string; v: string }
export interface RecallOffPlan {
  seen: RecallOffRow; put: RecallOffRow[]; del: string[]; insert: RecallOffRow[];
  records: Array<{ t: number; fields: JournalFields & { rk: 'change' | 'gap' } }>;
  malformed: number;
}
export function planRecallOffObservation(i: {
  seenRaw: string | null;
  stateRows: ReadonlyArray<{ id: string; raw: string }>;
  files: ReadonlyArray<{ id: string; state: RecallOffState | 'absent' }>;
  startMs: number; endMs: number;
}): RecallOffPlan;
export function recallOffReplayRows(rec: JournalRecord): { insert: RecallOffRow; put: RecallOffRow | null; del: string | null };
export function recallOffStatusOf(meta: Iterable<readonly [string, string]>): { seen_ms: number | null; files: number; unreadable: number };
```

`JournalFields` and `JournalRecord` are declared above, at about :166-168.

- [ ] **Step 5: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'replayStep: one journal line|planReplay|parseJournalRecord')
```

Expected green (predicted): `15 passed` for the first command. The second command runs the existing journal and replay cases, which `parseJournalRecord`'s new branch and the new `case` must leave green. Its count is whatever those describes held at the base: all of them pass, and none fails.

- [ ] **Step 6: Write the failing delivery tests.** Four files, and one line re-expected in a fifth.

(a) Append at the end of `server/test/history-sweep.test.ts`:

```ts

// ── W2-1 Task 4: the per-tick presence record (W2-D30) ───────────────────────────────────────────────────────────
// The real sweep, as the box runs it. recall-off/ is planted the way the W2 verb leaves it (`<generation>\n`, 0600, in a
// 0700 directory); this file never runs the verb. The step's place in tick is pinned by the docstring describe above.
import * as roLib from '../../ccd/history/lib.mjs';
import { journalRecords as roJournal } from './historyHelpers.js';

describe('the recall-off presence record, one tick step (W2-D30; W2-1 Task 4)', () => {
  const K = roLib.RECALL_OFF_KEYS;
  const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
  const G2 = '0189abcd-1234-4678-9abc-0123456789ac';
  const X = 'claude-a-demo';
  const UNREADABLE = { s: 'unreadable', v: null };
  const dirOf = (box: HistoryBox): string => path.join(box.root, 'recall-off');
  const plant = (box: HistoryBox, id: string, text: string): void => {
    fs.mkdirSync(dirOf(box), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dirOf(box), id), text, { mode: 0o600 });
  };
  const tickOk = (box: HistoryBox): void => {
    const r = runSweep(box);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
  };
  /** Every presence row, by key: the meta keys from RECALL_OFF_META up to the same prefix with ':' replaced by ';'. */
  const presence = (box: HistoryBox): Record<string, string> => {
    const db = openStoreRO(box);
    try {
      const out: Record<string, string> = {};
      const all = db.prepare('SELECT k, v FROM meta WHERE k >= ? AND k < ? ORDER BY k')
        .all(roLib.RECALL_OFF_META, `${roLib.RECALL_OFF_META.slice(0, -1)};`) as Array<{ k: string; v: string }>;
      for (const r of all) out[r.k] = r.v;
      return out;
    } finally {
      db.close();
    }
  };
  const changesOf = (p: Record<string, string>, id: string): Array<Record<string, unknown>> => Object.entries(p)
    .filter(([k]) => k.startsWith(K.change) && k.endsWith(`:${id}`))
    .map(([k, v]) => ({ ts: Number(k.slice(K.change.length, k.lastIndexOf(':'))), ...(JSON.parse(v) as object) }));
  const body = (c: Record<string, unknown>): Record<string, unknown> => ({ from: c['from'], to: c['to'], prev_seen_ms: c['prev_seen_ms'] });
  const stateOf = (p: Record<string, string>, id: string): unknown => {
    const v = p[`${K.state}${id}`];
    return v === undefined ? undefined : JSON.parse(v);
  };
  const gapsOf = (p: Record<string, string>): Array<{ from: number | null; to: number }> => Object.entries(p)
    .filter(([k]) => k.startsWith(K.gap)).map(([, v]) => JSON.parse(v) as { from: number | null; to: number });
  const setSeen = (box: HistoryBox, ms: number): void => {
    const db = new DatabaseSync(historyPaths(box.home).dbFile);
    try {
      expect(Number(db.prepare('UPDATE meta SET v = ? WHERE k = ?').run(String(ms), K.seen).changes)).toBe(1);
    } finally {
      db.close();
    }
  };
  const outboxRows = (box: HistoryBox): number => {
    const db = openStoreRO(box);
    try { return Number((db.prepare('SELECT count(*) AS n FROM journal_outbox').get() as { n: number }).n); } finally { db.close(); }
  };

  it('one change row per transition and none for an unchanged file; each row journaled as a recall-off record through the outbox', () => {
    const box = makeHistoryBox('ccrc-history-roff-trans-');
    tickOk(box);   // first install: the first observation ever, of no directory, is complete
    const p0 = presence(box);
    expect(gapsOf(p0).map((g) => g.from), 'the first observation ever is a gap from null').toEqual([null]);
    expect(p0[K.seen], 'an absent directory is an empty, complete observation: seen_ms advances').toMatch(/^[0-9]+$/);
    plant(box, X, `${G1}\n`);
    tickOk(box);
    const p1 = presence(box);
    expect(changesOf(p1, X).map(body)).toEqual([{ from: 'unobserved', to: { s: 'value', v: G1 }, prev_seen_ms: null }]);
    expect(stateOf(p1, X)).toEqual({ s: 'value', v: G1 });
    tickOk(box);   // nothing changed
    const p2 = presence(box);
    expect(changesOf(p2, X), 'an unchanged file is not flagged').toHaveLength(1);
    expect(Number(p2[K.seen]), 'CONTROL: that tick observed, and seen_ms moved').toBeGreaterThan(Number(p1[K.seen]));
    plant(box, X, `${G2}\n`);
    tickOk(box);
    const p3 = presence(box);
    fs.rmSync(path.join(dirOf(box), X));
    tickOk(box);
    const p4 = presence(box);
    expect(changesOf(p4, X).map(body)).toEqual([
      { from: 'unobserved', to: { s: 'value', v: G1 }, prev_seen_ms: null },
      { from: { s: 'value', v: G1 }, to: { s: 'value', v: G2 }, prev_seen_ms: Number(p2[K.seen]) },
      { from: { s: 'value', v: G2 }, to: 'absent', prev_seen_ms: Number(p3[K.seen]) },
    ]);
    expect(stateOf(p4, X), 'a file gone has no state row').toBeUndefined();
    // Journaled: one recall-off record per row, its t the row's key ms, and nothing left in the outbox.
    const firstGap = Number(Object.keys(p0).find((k) => k.startsWith(K.gap))!.slice(K.gap.length));
    expect(roJournal(box).filter((r) => r['k'] === 'recall-off').map((r) => [r['rk'], r['id'] ?? null, r['t']])).toEqual([
      ['gap', null, firstGap],
      ...changesOf(p4, X).map((c) => ['change', X, c['ts']]),
    ]);
    expect(outboxRows(box)).toBe(0);
  }, 120_000);

  it('unreadable is never absent: a link, a directory and an over-cap file at an id each read unreadable, with a state row', () => {
    const box = makeHistoryBox('ccrc-history-roff-unread-');
    tickOk(box);
    plant(box, X, `${G1}\n`);
    tickOk(box);
    const p1 = presence(box);
    const target = path.join(box.home, 'g1');
    fs.writeFileSync(target, `${G1}\n`);
    fs.rmSync(path.join(dirOf(box), X));
    fs.symlinkSync(target, path.join(dirOf(box), X));   // a link to the same generation: never followed
    fs.mkdirSync(path.join(dirOf(box), 'claude-b-demo'));
    plant(box, 'claude-c-demo', 'a'.repeat(roLib.CONTROL_FILE_MAX + 1));
    plant(box, 'claude-d-demo', '');                   // CONTROL: an empty file is a value, ''
    tickOk(box);
    const p2 = presence(box);
    expect(changesOf(p2, X).map(body).at(-1)).toEqual({ from: { s: 'value', v: G1 }, to: UNREADABLE, prev_seen_ms: Number(p1[K.seen]) });
    expect([stateOf(p2, X), stateOf(p2, 'claude-b-demo'), stateOf(p2, 'claude-c-demo'), stateOf(p2, 'claude-d-demo')])
      .toEqual([UNREADABLE, UNREADABLE, UNREADABLE, { s: 'value', v: '' }]);
    expect(Object.values(p2).some((v) => v.includes('"absent"')), 'no transition to absent').toBe(false);
  }, 120_000);

  it('a gap row after an interval longer than RECALL_OFF_GAP_MS with no observation, and none after a shorter one', () => {
    const box = makeHistoryBox('ccrc-history-roff-gap-');
    tickOk(box);
    const long = Date.now() - roLib.RECALL_OFF_GAP_MS - 60_000;
    setSeen(box, long);
    tickOk(box);
    const after = gapsOf(presence(box));
    expect(after).toHaveLength(2);
    expect(after[1]!.from).toBe(long);
    expect(after[1]!.to - long).toBeGreaterThan(roLib.RECALL_OFF_GAP_MS);
    setSeen(box, Date.now());   // the next tick starts after this, inside the case's 120 s timeout, which is below the gap
    tickOk(box);
    expect(gapsOf(presence(box)), 'CONTROL: an interval shorter than the gap writes none').toHaveLength(2);
  }, 120_000);

  it('a capped or unreadable directory writes nothing, leaves seen_ms and is counted; names outside the id grammar are counted, never read', () => {
    const box = makeHistoryBox('ccrc-history-roff-cap-');
    tickOk(box);
    fs.mkdirSync(dirOf(box), { mode: 0o700 });
    // RECALL_OFF_SCAN_MAX + 1 entries, none of them an id (`~` is outside ID_RE, like the writer's `~tmp.<pid>`).
    for (let i = 0; i <= roLib.RECALL_OFF_SCAN_MAX; i += 1) fs.writeFileSync(path.join(dirOf(box), `~tmp.${i}`), '');
    const seen0 = presence(box)[K.seen];
    tickOk(box);
    expect(presence(box)[K.seen], 'a capped directory leaves seen_ms').toBe(seen0);
    expect(counters(box)['recall_off_scan_capped']).toBe(1);
    expect(counters(box)['recall_off_name_skipped'], 'a capped scan counts no name').toBeUndefined();
    fs.rmSync(path.join(dirOf(box), '~tmp.0'));   // CONTROL: exactly RECALL_OFF_SCAN_MAX entries is a complete observation
    tickOk(box);
    expect(Number(presence(box)[K.seen])).toBeGreaterThan(Number(seen0));
    expect(counters(box)).toMatchObject({ recall_off_scan_capped: 1, recall_off_name_skipped: roLib.RECALL_OFF_SCAN_MAX });
    expect(Object.keys(presence(box)).filter((k) => k.startsWith(K.state)), 'a name outside the grammar is never a state row').toEqual([]);
    // An unreadable directory: a link standing at recall-off/, to a directory that holds an id's file. Never followed.
    fs.rmSync(dirOf(box), { recursive: true });
    const real = path.join(box.home, 'elsewhere');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, X), `${G1}\n`);
    fs.symlinkSync(real, dirOf(box));
    const seen1 = presence(box)[K.seen];
    tickOk(box);
    expect(presence(box)[K.seen], 'an unreadable directory leaves seen_ms').toBe(seen1);
    expect(stateOf(presence(box), X), 'and the link is never followed').toBeUndefined();
    expect(counters(box)['recall_off_dir_unreadable']).toBe(1);
  }, 240_000);
});
```

`HistoryBox`, `makeHistoryBox`, `runSweep`, `openStoreRO`, `counters`, `historyPaths`, `DatabaseSync`, `fs` and `path` are already bound at the file's head. No earlier task of this plan edits this file.

(b) Append at the end of `server/test/history-recover.test.ts`:

```ts

// ── W2-1 Task 4: the presence record across a recovery (W2-D30) ──────────────────────────────────────────────────
// Replay rebuilds the change, gap and state rows from the journal without reading recall-off/, never replays seen_ms, and
// never rewrites a row the store holds; the recover arm runs no presence step; the first ordinary tick after a rebuild
// writes no change row for a file unchanged since before it.
import * as roLib from '../../ccd/history/lib.mjs';

describe('the recall-off presence record across a recovery (W2-D30; W2-1 Task 4)', () => {
  interface RecallOffStep { recordRecallOff(db: DatabaseSync, ctx: Record<string, unknown>): void }
  const K = roLib.RECALL_OFF_KEYS;
  const [GA, GB, GC] = [u(0xc1), u(0xc2), u(0xc3)];
  const [X, Y, W, Z] = ['claude-a-demo', 'claude-b-demo', 'claude-c-demo', 'claude-d-demo'];
  const dirOf = (box: HistoryBox): string => path.join(box.root, 'recall-off');
  const plant = (box: HistoryBox, id: string, gen: string): void => {
    fs.mkdirSync(dirOf(box), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dirOf(box), id), `${gen}\n`, { mode: 0o600 });
  };
  const presence = (box: HistoryBox): Record<string, string> => Object.fromEntries(
    rows(box, 'SELECT k, v FROM meta WHERE k >= ? AND k < ? ORDER BY k', roLib.RECALL_OFF_META, `${roLib.RECALL_OFF_META.slice(0, -1)};`)
      .map((r) => [String(r['k']), String(r['v'])]));
  const changeKeys = (p: Record<string, string>, id?: string): string[] =>
    Object.keys(p).filter((k) => k.startsWith(K.change) && (id === undefined || k.endsWith(`:${id}`)));
  const changeCountOn = (db: DatabaseSync): number =>
    Number((db.prepare('SELECT count(*) AS n FROM meta WHERE k >= ? AND k < ?').get(K.change, `${K.change.slice(0, -1)};`) as { n: number }).n);
  /** A store whose record holds a first gap, X unchanged at GA, Y moved GA to GB, and W planted and then removed. Then
   *  the DB is lost and recall-off/ moved away, so a replay that read it would find nothing; a rebuild is bound. */
  const lostAfterTicks = (prefix: string): { box: HistoryBox; before: Record<string, string>; version: number } => {
    const box = makeHistoryBox(prefix);
    const P = historyPaths(box.home);
    pass(box);
    plant(box, X, GA); plant(box, Y, GA); plant(box, W, GA);
    pass(box);
    plant(box, Y, GB);
    fs.rmSync(path.join(dirOf(box), W));
    pass(box);
    const before = presence(box);
    expect(changeKeys(before, W), 'CONTROL: W came and went').toHaveLength(2);
    expect(before[`${K.state}${W}`]).toBeUndefined();
    const storeId = fs.readFileSync(P.storeId, 'utf8').trim();
    for (const f of [P.dbFile, P.wal, P.shm]) fs.rmSync(f, { force: true });
    fs.renameSync(dirOf(box), `${dirOf(box)}.away`);
    return { box, before, version: boundEmptyStore(box, storeId).version };
  };

  it('replay rebuilds the change, gap and state rows from the journal without reading the directory; seen_ms is never replayed', () => {
    const { box, before, version } = lostAfterTicks('ccrc-history-roff-replay-');
    pass(box);   // the recovery step, whole; the recover arm runs no presence step
    expect(recoverRow(box)).toMatchObject({ version, completed_ms: expect.any(Number) });
    const after = presence(box);
    expect(after[K.seen], 'seen_ms is not replayed').toBeUndefined();
    expect(after).toEqual(Object.fromEntries(Object.entries(before).filter(([k]) => k !== K.seen)));
    expect(fs.existsSync(dirOf(box)), 'CONTROL: the directory was away for the whole replay').toBe(false);
  }, HEAVY);

  it('a rebuild mid-window, then a tick: no change row for a file unchanged since before the rebuild, a gap from null, and null for one changed meanwhile', () => {
    const { box, before } = lostAfterTicks('ccrc-history-roff-midwin-');
    pass(box);   // the recovery step
    fs.renameSync(`${dirOf(box)}.away`, dirOf(box));
    plant(box, Y, GC);   // CONTROL: Y changed while the store was rebuilt; X did not
    pass(box);   // the first ordinary tick after the step
    const after = presence(box);
    expect(changeKeys(after, X), 'X is unchanged since before the rebuild: no new change row').toEqual(changeKeys(before, X));
    const newY = changeKeys(after, Y).filter((k) => !(k in before));
    expect(newY.map((k) => JSON.parse(after[k]!) as unknown)).toEqual([{ from: { s: 'value', v: GB }, to: { s: 'value', v: GC }, prev_seen_ms: null }]);
    const newGaps = Object.keys(after).filter((k) => k.startsWith(K.gap) && !(k in before));
    expect(newGaps.map((k) => (JSON.parse(after[k]!) as { from: unknown }).from), 'the first observation after a rebuild is a gap from null').toEqual([null]);
    expect(after[K.seen]).toMatch(/^[0-9]+$/);
  }, HEAVY);

  it('a recover pass with planted files writes no change: row and replay keeps a row the store holds; the step writes nothing while a recovery step is registered', () => {
    const box = makeHistoryBox('ccrc-history-roff-recover-');
    const P = historyPaths(box.home);
    pass(box);   // the first observation: one gap row, journaled
    const p0 = presence(box);
    const gapKey = Object.keys(p0).find((k) => k.startsWith(K.gap));
    expect(gapKey, 'the first observation wrote its gap row').toBeDefined();
    plant(box, Z, GA);
    // A row the store already holds under a journaled key, with another value: replay inserts DO NOTHING, so it stays.
    const held = roLib.canonicalJson({ from: null, to: 1 });
    const raw = new DatabaseSync(P.dbFile);
    try { expect(Number(raw.prepare('UPDATE meta SET v = ? WHERE k = ?').run(held, gapKey!).changes)).toBe(1); } finally { raw.close(); }
    registerRecovery(box, Date.now());
    pass(box);   // the recover arm: the step replays this store's own journal and completes
    expect(recoverRow(box)?.completed_ms).toEqual(expect.any(Number));
    const mid = presence(box);
    expect(changeKeys(mid), 'the recover arm wrote no change: row').toEqual([]);
    expect(mid[`${K.state}${Z}`]).toBeUndefined();
    expect(mid[K.seen], 'and observed nothing').toBe(p0[K.seen]);
    expect(mid[gapKey!], 'a replayed gap record leaves the row the store held').toBe(held);
    // The step guards itself: called in-process while a recovery step is registered, it writes nothing.
    registerRecovery(box, Date.now() + 1);
    const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
    const db = openWriter(P.dbFile);
    try {
      (SW as unknown as RecallOffStep).recordRecallOff(db, stepCtx(box, ids));
      expect(changeCountOn(db), 'no change: row while a recovery step is registered').toBe(0);
      db.prepare("DELETE FROM derivation_state WHERE step = 'recover' AND completed_ms IS NULL").run();
      (SW as unknown as RecallOffStep).recordRecallOff(db, stepCtx(box, ids));
      expect(changeCountOn(db), 'CONTROL: with none registered, the planted file is recorded').toBe(1);
    } finally {
      closeWriter(db);
    }
  }, HEAVY);
});
```

`u`, `HEAVY`, `pass`, `rows`, `registerRecovery`, `stepCtx`, `SW`, `recoverRow`, `boundEmptyStore`, `makeHistoryBox`, `historyPaths`, `openWriter`, `closeWriter`, `DatabaseSync`, `fs`, `path` and `HistoryBox` are already bound in this file. Task 3's appended describe binds no `roLib`.

(c) Append at the end of `server/test/history-cli.test.ts`:

```ts

// ── W2-1 Task 4: status --json's recall_off block (W2-D31) ───────────────────────────────────────────────────────
describe('status recall_off: the presence record, counts only (W2-D31; W2-1 Task 4)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  type RecallOffBlock = { seen_ms: number | null; files: number; unreadable: number };
  const blockOf = (env: Envelope): RecallOffBlock => (env as unknown as { recall_off: RecallOffBlock }).recall_off;
  const RID = 'claude-a-roffid';
  const RID2 = 'claude-b-roffid';

  it('after a write and a tick, seen_ms is later than the write; files and unreadable count the state rows; no id is printed', () => {
    const box = boundBox('ccrc-hist-cli-roff-');
    const dir = hist(box, 'recall-off');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, RID), `${G1}\n`, { mode: 0o600 });
    fs.symlinkSync(path.join(box.home, 'nowhere'), path.join(dir, RID2));   // a link: unreadable, never absent
    const wrote = fs.statSync(path.join(dir, RID)).mtimeMs;
    const t = runSweep(box);
    expect(t.code, t.stderr).toBe(0);
    const s = status(box);
    expect(s.code, s.stderr).toBe(0);
    const ro = blockOf(s.env);
    expect(Object.keys(ro).sort()).toEqual(['files', 'seen_ms', 'unreadable']);
    expect(ro.seen_ms).toBeGreaterThan(wrote);
    expect([ro.files, ro.unreadable]).toEqual([2, 1]);
    expect(s.stdout, 'status is identity-free').not.toContain(RID);
    expect(s.stdout).not.toContain(RID2);
    const human = status(box, { args: ['status'] });
    expect(human.code).toBe(0);
    expect(human.stdout.split('\n')).toContain(`recall-off: seen=${new Date(ro.seen_ms!).toISOString()} files=2 unreadable=1`);
  });

  it('with no store read, the block is there and says nothing was observed', () => {
    const shimOnly = makeHistoryBox('ccrc-hist-cli-roff-none-', { role: 'fleet', shim: true });
    const s = status(shimOnly);
    expect(s.code).toBe(6);
    expect(blockOf(s.env)).toEqual({ seen_ms: null, files: 0, unreadable: 0 });
  });
});
```

`Envelope`, `status`, `boundBox`, `hist`, `G1`, `runSweep`, `makeHistoryBox`, `fs`, `path` and `beforeEach` are bound at the file's head (:9-73).

(d) No edit to `single-definition.test.ts` yet. Step 10 adds the VOCABS entry, which is green on arrival, and mutant M17 measures its guard.

(e) `server/test/history-op.test.ts`: one line, in place. Anchor it first; the command prints `1`:

```bash
grep -cF "      expect(countOf(box, 'journal_outbox'), 'the flush could not append, so the row waits').toBe(1);" server/test/history-op.test.ts
```

In the case `verdicts still in the outbox are not missing: …` (about :1566), replace

```ts
      expect(countOf(box, 'journal_outbox'), 'the flush could not append, so the row waits').toBe(1);
```

with

```ts
      expect(q<{ n: number }>(box, `SELECT count(*) AS n FROM journal_outbox WHERE rec LIKE '%"k":"verdict"%'`)[0]!.n, 'the flush could not append, so the planted verdict waits (the tick\'s recall-off gap record, W2-D30, waits beside it)').toBe(1);
```

The case's pass runs with its clock a month past the passes `auditBox` made, so from Step 8 on, that pass's presence step writes a gap record (`startMs - seen_ms > RECALL_OFF_GAP_MS`) into `journal_outbox` in its own transaction, and that record's flush fails into the same 0500 directory. `countOf(box, 'journal_outbox')` would read 2 there. The new line counts the planted verdict alone, which is what the case is about. `q` is the file's own query helper (:53). The case's CONTROL after its `finally`, `CONTROL: the next flush empties it`, is unchanged: the next pass's flush appends both records, and that pass's own gap record, if it writes one, is flushed in the same pass.

- [ ] **Step 7: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms, one suite per call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'presence record across a recovery')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'status recall_off')
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'verdicts still in the outbox are not missing')
```

Expected RED (predicted):
- history-sweep: `4 failed`. Case 1 fails at its first gap assertion (`[]` where `[null]` is expected): no tick writes a presence row yet. Case 2 fails at `.at(-1)` (`undefined`). Case 3 fails earlier than that, in `setSeen`, at `expected +0 to be 1` (no `seen_ms` row exists to update, measured). Case 4 fails at `recall_off_scan_capped` (`undefined` where 1 is expected).
- history-recover: `3 failed`. Cases 1 and 2 fail at the CONTROL `W came and went` (0 where 2 is expected). Case 3 fails at `the first observation wrote its gap row`.
- history-cli: `2 failed`, each at `Object.keys(undefined)` or `toEqual` on `undefined`: the envelope has no `recall_off` yet.
- history-op: `1 passed` (skipped when run as root, as the case says). Step 6 (e)'s line is a re-expectation, not a new guard: before Step 8 the outbox holds the planted verdict alone, so the filtered count and the old one agree. Step 9 runs it again after the step lands.

- [ ] **Step 8: Write the tick step, its replay, and status's block.**

(a) `sweep.mjs`, replace

```js
import { cardStep, collectPurgedHistoryFiles, ensureHistoryDirs, withdrawCards } from './card.mjs';
```

with

```js
import { cardStep, collectPurgedHistoryFiles, ensureHistoryDirs, withdrawCards } from './card.mjs';
// W2-1 Task 4 (W2-D30): the presence record's one directory read and its lib decisions, in statements of their own.
import { opendirSync } from 'node:fs';
import { RECALL_OFF_KEYS, RECALL_OFF_SCAN_MAX, recallOffStateOf, planRecallOffObservation, recallOffReplayRows } from './lib.mjs';
```

No earlier statement in `sweep.mjs` binds `opendirSync` or any of the five lib names (Step 1 counted them), so each is bound once.

(b) `sweep.mjs`, in `tick`'s docstring, replace

```js
 * 19. `recordTick`: the tick's row and journal record (a paused ingest records an unmeasured lag);
 * 20. `collectPurgedHistoryFiles`: at a due scan, the scope markers and card directories of purged sessions,
 *     7 days on (card.mjs; W1-B3 Task 7);
 * 21. `markScan`: a due scan is marked done, unless the roster was unreadable;
 * 22. `exportStep`: §9.2 step 6, last (W1-B4): the export pass, at most once an hour, with a writer token only,
 *     outside the ingest gate, behind its own floor on the home filesystem;
 * 23. `ensureHistoryDirs`: last, below the spool/ line the next sentence names, scope/ and card/ made 0700, a link
 *     or a file there refused and counted (card.mjs; W1-B3 Task 5).
```

with

```js
 * 19. `recordRecallOff`: W2-D30's presence record (W2-1 Task 4): recall-off/ read once, at most RECALL_OFF_SCAN_MAX
 *     entries, outside the run budget; its meta rows and its change and gap records committed in one transaction through
 *     the outbox; only while no recovery step is registered (the recover arm never calls it, and replay never observes);
 * 20. `recordTick`: the tick's row and journal record (a paused ingest records an unmeasured lag);
 * 21. `collectPurgedHistoryFiles`: at a due scan, the scope markers and card directories of purged sessions,
 *     7 days on (card.mjs; W1-B3 Task 7);
 * 22. `markScan`: a due scan is marked done, unless the roster was unreadable;
 * 23. `exportStep`: §9.2 step 6, last (W1-B4): the export pass, at most once an hour, with a writer token only,
 *     outside the ingest gate, behind its own floor on the home filesystem;
 * 24. `ensureHistoryDirs`: last, below the spool/ line the next sentence names, scope/ and card/ made 0700, a link
 *     or a file there refused and counted (card.mjs; W1-B3 Task 5).
```

No earlier task of this plan changes this list (Step 1 found its item 19 once); the new item goes directly above `recordTick`'s, and every item below it moves down by one.

(c) `sweep.mjs`, in `tick`'s body, replace

```js
  mergeSteps(db, ictx, ctx.budget);
  // §9.2 step 6: the tick's row and journal record. A paused ingest records an unmeasured lag.
```

with

```js
  mergeSteps(db, ictx, ctx.budget);
  // W2-D30 (W2-1 Task 4): the recall-off presence record, immediately before the tick's row, on this normal pass only. It
  // returns at once while a recovery step is registered; recoverPass never calls it.
  recordRecallOff(db, ctx);
  // §9.2 step 6: the tick's row and journal record. A paused ingest records an unmeasured lag.
```

(d) `sweep.mjs`, in `applyReplayAction`, replace

```js
      db.prepare(RECOVER_TICK_INSERT).run(a.t, a.lagMs);
      return;
```

with

```js
      db.prepare(RECOVER_TICK_INSERT).run(a.t, a.lagMs);
      return;
    case 'recall-off': {
      // W2-1 Task 4 (W2-D30): a change or gap row is inserted DO NOTHING (a restored backup may already hold it); a state row
      // is last-wins from the record's `to`, in journal order, and deleted on 'absent'. seen_ms is never replayed, and no
      // directory is read: the first ordinary tick after a rebuild observes, with no seen_ms, and writes a gap from null.
      const r = recallOffReplayRows(a.rec);
      db.prepare(RECALL_OFF_INSERT_SQL).run(r.insert.k, r.insert.v);
      if (r.put !== null) setMeta(db, r.put.k, r.put.v);
      if (r.del !== null) db.prepare(RECALL_OFF_DELETE_SQL).run(r.del);
      return;
    }
```

(e) `sweep.mjs`, directly above the doc comment that begins ``/** The tick's `ticks` row and its journal `tick` record (§9.2 step 6; W1-b, doctor's catching-up; slug``, insert

```js
// ── W2-1 Task 4: the recall-off presence record, tick step 19 (W2-D30) ──────────────────────────────────────────────
/** A change or gap row, live or replayed: a row the store already holds is never rewritten. */
const RECALL_OFF_INSERT_SQL = 'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO NOTHING';
const RECALL_OFF_DELETE_SQL = 'DELETE FROM meta WHERE k = ?';
/** The state rows by key range, from RECALL_OFF_KEYS.state up to the same prefix with its last character (':') replaced
 *  by the next code point (';'): meta's primary key bounds the read, and the change and gap rows, which accumulate, are
 *  never read by a tick. */
const RECALL_OFF_STATE_SQL = 'SELECT k, v FROM meta WHERE k >= ? AND k < ?';

/** recall-off/ read once (W2-D30). ENOENT is an empty, complete observation. Any other lstat failure, a link or a
 *  non-directory there, an opendir that fails or a listing that throws is `unreadable`, and nothing behind a link is read.
 *  More than RECALL_OFF_SCAN_MAX entries is `capped`, found by a counted iteration that stops at the first entry past it;
 *  names come first, so a capped directory has none of its files read. Only idOk names are read, each through
 *  readBounded with no link followed (W2-D29's one reader shape); any other name (the writer's `~tmp.<pid>`, a name with a
 *  space) is counted in `skipped` and never opened. */
function scanRecallOff(home, dir) {
  let st;
  try {
    st = lstatSync(dir);
  } catch (e) {
    return e !== null && typeof e === 'object' && e.code === 'ENOENT' ? { kind: 'complete', files: [], skipped: 0 } : { kind: 'unreadable' };
  }
  if (!st.isDirectory()) return { kind: 'unreadable' };
  let d;
  try {
    d = opendirSync(dir);
  } catch {
    return { kind: 'unreadable' };
  }
  const names = [];
  try {
    for (let e = d.readSync(); e !== null; e = d.readSync()) {
      if (names.length === RECALL_OFF_SCAN_MAX) return { kind: 'capped' };
      names.push(e.name);
    }
  } catch {
    return { kind: 'unreadable' };
  } finally {
    try { d.closeSync(); } catch { /* already closed */ }
  }
  const ids = names.filter((n) => idOk(n));
  const files = ids.map((id) => ({ id, state: recallOffStateOf(readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false)) }));
  return { kind: 'complete', files, skipped: names.length - ids.length };
}

/** Tick step 19 (W2-D30): the recall-off presence record, immediately before recordTick, on the normal pass only and only
 *  while no recovery step is registered. lib decides (planRecallOffObservation); this measures and writes.
 *  - The observation starts at `startMs`, read before the directory is opened, which becomes seen_ms; its rows are keyed
 *    by `endMs`, read after the last file, so a change made during the scan lies inside (prev_seen_ms, ts_ms].
 *  - A capped or unreadable directory writes nothing, leaves seen_ms, and is counted (recall_off_scan_capped,
 *    recall_off_dir_unreadable).
 *  - A complete one writes, in ONE transaction: seen_ms, the state rows, the change and gap rows, the skipped-name and
 *    malformed-row counts, and one journal_outbox row per change and gap record, FULL when it holds a record, NORMAL when
 *    only seen_ms moves. The records are flushed right after, as verdictTx flushes (a JournalError counted
 *    journal_write_failed; with no writer token they wait in the outbox), never through recordTick's best-effort append.
 *  Outside the run budget, as recordTick is: RECALL_OFF_SCAN_MAX bounds its reads. seen_ms is kept across a restore or an
 *  adopt (D-6240 (history-recall-off-seen-survives-restore)). A restore only widens the next interval. After an adopt, a
 *  clock running ahead on the old box narrows the next interval; the PR names that as a residual. */
export function recordRecallOff(db, ctx) {
  if (isRecovering(db)) return;
  const startMs = ctx.now();
  const scan = scanRecallOff(ctx.home, ctx.paths.recallOffDir);
  if (scan.kind !== 'complete') {
    countOutside(db, scan.kind === 'capped' ? 'recall_off_scan_capped' : 'recall_off_dir_unreadable');
    return;
  }
  const endMs = Math.max(startMs, ctx.now());
  const lo = RECALL_OFF_KEYS.state;
  const stateRows = db.prepare(RECALL_OFF_STATE_SQL).all(lo, `${lo.slice(0, -1)};`)
    .map((r) => ({ id: String(r.k).slice(lo.length), raw: String(r.v) }));
  const plan = planRecallOffObservation({ seenRaw: getMeta(db, RECALL_OFF_KEYS.seen), stateRows, files: scan.files, startMs, endMs });
  withTx(db, plan.records.length > 0 ? 'FULL' : 'NORMAL', () => {
    setMeta(db, plan.seen.k, plan.seen.v);
    for (const r of plan.put) setMeta(db, r.k, r.v);
    for (const k of plan.del) db.prepare(RECALL_OFF_DELETE_SQL).run(k);
    for (const r of plan.insert) db.prepare(RECALL_OFF_INSERT_SQL).run(r.k, r.v);
    if (scan.skipped > 0) bump(db, 'recall_off_name_skipped', scan.skipped);
    if (plan.malformed > 0) bump(db, 'recall_off_state_malformed', plan.malformed);
    for (const r of plan.records) outboxRow(db, journalRecord('recall-off', r.t, r.fields));
  });
  if (plan.records.length === 0 || ctx.ids === null) return;
  try {
    flushOutbox(db, ctx.home, ctx.ids, ctx.now());
  } catch (e) {
    if (!(e instanceof JournalError)) throw e;
    countOutside(db, 'journal_write_failed');
  }
}

```

The names `lstatSync`, `readBounded`, `recallOffPath`, `CONTROL_FILE_MAX`, `idOk`, `getMeta`, `setMeta`, `withTx`, `bump` and `journalRecord` are already imported (:34-81). `isRecovering`, `countOutside`, `outboxRow`, `flushOutbox` and `JournalError` are this file's own. `RECALL_OFF_INSERT_SQL` and `RECALL_OFF_DELETE_SQL` are module constants that `applyReplayAction` reads only when it is called, so their place below it is safe.

(f) `cli.mjs`, replace

```js
    redact_unreadable: [],
```

with

```js
    redact_unreadable: [],
    recall_off: { seen_ms: null, files: 0, unreadable: 0 },   // W2-D31 (W2-1 Task 4): no store read, no observation
```

(g) `cli.mjs`, replace

```js
    env.redact_unreadable = Array.isArray(unreadable) ? unreadable.filter((x) => typeof x === 'string') : [];
```

with

```js
    env.redact_unreadable = Array.isArray(unreadable) ? unreadable.filter((x) => typeof x === 'string') : [];
    env.recall_off = healthLib.recallOffStatusOf(meta);   // W2-D31 (W2-1 Task 4): from the meta rows, counts only
```

(h) `cli.mjs`, in `render`, replace

```js
        + `due=${ex.due_blobs} overdue=${ex.overdue_blobs} segments=${ex.segments}`);
    }
```

with

```js
        + `due=${ex.due_blobs} overdue=${ex.overdue_blobs} segments=${ex.segments}`);
    }
    const ro = env.recall_off;   // W2-D31 (W2-1 Task 4): the presence record, counts only
    lines.push(`recall-off: seen=${ro.seen_ms === null ? 'never' : new Date(ro.seen_ms).toISOString()} files=${ro.files} unreadable=${ro.unreadable}`);
```

- [ ] **Step 9: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step|docstring names its steps')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'presence record across a recovery')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'status recall_off')
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'verdicts still in the outbox are not missing')
```

Expected green (predicted):
- history-sweep: `7 passed`, this task's 4 and the docstring describe's 3. The docstring's item 19 is called in the body, in the listed order, and `recordRecallOff(db` is listed;
- history-recover: `3 passed`;
- history-cli: `2 passed`;
- history-op: `1 passed`. With the old line, this run reads `expected 2 to be 1` (`the flush could not append, so the row waits`): the gap record waits beside the verdict.

- [ ] **Step 10: Bind `RECALL_OFF_KEYS` in O14, and move O13's reader count to two.** In `server/test/single-definition.test.ts`, two in-place edits.

(a) In the `VOCABS` list of the describe `ccrc history: every vocabulary is declared once, in lib.mjs, and bound to its uses`, Task 2's closing line reads

```ts
    'RECALL_OFF_META', 'RECALL_OFF_GAP_MS', 'RECALL_OFF_SCAN_MAX'] as const;
```

Replace it with

```ts
    'RECALL_OFF_META', 'RECALL_OFF_GAP_MS', 'RECALL_OFF_SCAN_MAX',
    // W2-1 Task 4 (W2-D30): the presence record's meta keys, each built from RECALL_OFF_META.
    'RECALL_OFF_KEYS'] as const;
```

(b) In O13's case `recall-off/<id>: exactly one writer, sweep.mjs` (Task 3's), replace the one line

```ts
    expect(reader, 'sweep.mjs reads recall-off/<id> through readBounded exactly once (W2-D29)').toHaveLength(1);
```

with

```ts
    expect(reader, 'sweep.mjs reads recall-off/<id> through readBounded on two lines, recallOffPresence and the tick scan (W2-D29, W2-D30)').toHaveLength(2);
```

Step 8's scan adds the second `readBounded(recallOffPath(` line to `sweep.mjs` (R3), so from Step 8 until this edit O13 reads `expected [ …(2) ] to have length 1`. The case's next assertion, that no reader line counts as a write to O13's classifier, now reads both lines. Both edits sit far below `session-hook.test.ts`' citation anchors; (a) moves only the lines after `VOCABS` by 2, and (b) moves none. Then:

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_OFF_KEYS is declared|every kind the sweep journals')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'operator switches have readers only')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT')
```

Expected green: `2 passed`, then every case of the O13 describe, then the citation-debt case. `RECALL_OFF_KEYS` is declared once, in lib, exported and frozen. The scan of every `journalRecord('<kind>'` literal finds `'recall-off'` in `sweep.mjs` and finds it a `JOURNAL_KINDS` member. Both are green on arrival, and M17 and M21 measure them red. (b)'s count of two is measured red by M23, which swaps the scan's `readBounded` read for a read of its own; M22 measures the scan's no-follow argument, end to end in history-sweep.

- [ ] **Step 11: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs its filter, shows it red, and restores the file with `cp`. Scratch copies go under `.superpowers/sdd/history-w2-1/scratch` (gitignored), never `git stash`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-1/scratch"; mkdir -p "$SCRATCH"
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
cp ccd/history/sweep.mjs "$SCRATCH/sweep.orig"
cp ccd/history/cli.mjs "$SCRATCH/cli.orig"

# M1: the step's call removed from tick (its docstring item kept).
mut ccd/history/sweep.mjs '  recordRecallOff(db, ctx);
  // §9.2 step 6' '  // §9.2 step 6'
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step|docstring names its steps')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 5 failed | 2 passed: the docstring's 'every listed step is called in the body' and this task's 4.

# M2: the step run in the recover arm too.
mut ccd/history/sweep.mjs '    recordTick(db, ictx, null);' '    recordRecallOff(db, ctx);
    recordTick(db, ictx, null);'
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'presence record across a recovery')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (measured: 3 failed). Case 1 at 'seen_ms is not replayed' (the step observed the away directory, so seen_ms
# is written); case 2: X gains change rows; case 3: 'the recover arm wrote no change: row' (Z is recorded once the step
# completes within the pass).

# M3: the step's own guard removed.
mut ccd/history/sweep.mjs '  if (isRecovering(db)) return;
  const startMs = ctx.now();' '  const startMs = ctx.now();'
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'presence record across a recovery')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed | 2 passed, case 3 at 'no change: row while a recovery step is registered' (1, not 0).

# M4: seen_ms replayed.
mut ccd/history/sweep.mjs '      if (r.del !== null) db.prepare(RECALL_OFF_DELETE_SQL).run(r.del);' '      if (r.del !== null) db.prepare(RECALL_OFF_DELETE_SQL).run(r.del);
      setMeta(db, RECALL_OFF_KEYS.seen, String(a.rec.t));'
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'presence record across a recovery')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (measured, clock-dependent: 2 or 3 failed): case 1 at 'seen_ms is not replayed'; case 2 at Y's prev_seen_ms
# (a number, not null) and at its new gaps ([], not [null]); case 3, at 'and observed nothing', fails only when the
# first tick's clock read for startMs and for endMs differ by a millisecond (the replayed gap record's t is endMs and
# the original seen_ms is startMs): 3 failed in 1 run of 3, 2 failed | 1 passed in the other 2. Nondeterministic by
# construction; the guard is red either way.

# M5: a replayed change to absent writes the state row instead of deleting it.
mut ccd/history/lib.mjs "  return rec.to === 'absent' ? { insert, put: null, del: key } : { insert, put: { k: key, v: canonicalJson(rec.to) }, del: null };" "  return { insert, put: { k: key, v: canonicalJson(rec.to) }, del: null };"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'presence record across a recovery')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): history-lib 1 failed (the replayStep case: put gains Y, del is []); history-recover case 1
# (state:W present after the replay).

# M6: replay upserts its rows over the ones the store holds.
mut ccd/history/sweep.mjs '      db.prepare(RECALL_OFF_INSERT_SQL).run(r.insert.k, r.insert.v);' '      setMeta(db, r.insert.k, r.insert.v);'
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'presence record across a recovery')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 1 failed | 2 passed, case 3 at 'a replayed gap record leaves the row the store held'.

# M7: every present file flagged, changed or not.
mut ccd/history/lib.mjs '    else if (canonicalJson(was) === canonicalJson(f.state)) continue;' '    else if (false) continue;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): history-lib 2 failed (the unchanged case and the rebuild case); history-sweep case 1 at 'an
# unchanged file is not flagged'.

# M8: an unreadable read folded into absent.
mut ccd/history/lib.mjs "  if (read.state !== 'value') return { s: 'unreadable', v: null };" "  if (read.state !== 'value') return 'absent';"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): history-lib 1 failed (recallOffStateOf); history-sweep case 2 (X's last change is to 'absent').

# M9: the gap boundary taken as at-least.
mut ccd/history/lib.mjs '  if (prevSeen === null || startMs - prevSeen > RECALL_OFF_GAP_MS) {' '  if (prevSeen === null || startMs - prevSeen >= RECALL_OFF_GAP_MS) {'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 1 failed, the gap case at its CONTROL 'exactly the gap is no gap'.

# M9b: a gap only on the first observation.
mut ccd/history/lib.mjs '  if (prevSeen === null || startMs - prevSeen > RECALL_OFF_GAP_MS) {' '  if (prevSeen === null) {'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): history-lib 1 failed (the gap case); history-sweep case 3 (one gap row, not two).

# M10: a file with no state row given the last observation as prev_seen_ms.
mut ccd/history/lib.mjs "    if (was === undefined || was === null) change(f.id, 'unobserved', f.state, null);" "    if (was === undefined || was === null) change(f.id, 'unobserved', f.state, prevSeen);"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): history-lib 1 failed (the transition case, C's prev_seen_ms); history-sweep case 1 (X's first change).

# M11: the cap one entry early.
mut ccd/history/sweep.mjs "      if (names.length === RECALL_OFF_SCAN_MAX) return { kind: 'capped' };" "      if (names.length === RECALL_OFF_SCAN_MAX - 1) return { kind: 'capped' };"
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): case 4 at its CONTROL (exactly RECALL_OFF_SCAN_MAX entries leaves seen_ms unmoved).

# M12: a link at recall-off/ followed.
mut ccd/history/sweep.mjs "  if (!st.isDirectory()) return { kind: 'unreadable' };" "  if (!st.isDirectory() && !st.isSymbolicLink()) return { kind: 'unreadable' };"
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): case 4 at 'an unreadable directory leaves seen_ms'.

# M13: names outside the id grammar read too.
mut ccd/history/sweep.mjs '  const ids = names.filter((n) => idOk(n));' '  const ids = names;'
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): case 4: recallOffPath throws a TypeError on `~tmp.1`, the pass exits 1, and tickOk fails.

# M14: the records never reach the outbox.
mut ccd/history/sweep.mjs "    for (const r of plan.records) outboxRow(db, journalRecord('recall-off', r.t, r.fields));
" ''
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'presence record across a recovery')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): history-sweep case 1 at the journal list ([]); history-recover cases 1 and 2 (nothing replays).

# M15: a state row off the grammar not counted unreadable.
mut ccd/history/lib.mjs "      if (st === null || st.s === 'unreadable') unreadable += 1;" "      if (st !== null && st.s === 'unreadable') unreadable += 1;"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 1 failed, the recallOffStatusOf case (unreadable 1, not 2).

# M15b: status never reads the record.
mut ccd/history/cli.mjs '    env.recall_off = healthLib.recallOffStatusOf(meta);' '    // gone'
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'status recall_off')
cp "$SCRATCH/cli.orig" ccd/history/cli.mjs
# Expected RED (predicted): 1 failed | 1 passed, the first case at seen_ms (null, not greater than the write time).

# M16: an unknown rk read as malformed.
mut ccd/history/lib.mjs "    if (!RECALL_OFF_RKS.includes(o.rk)) return { kind: 'unknown' };" "    if (!RECALL_OFF_RKS.includes(o.rk)) return { kind: 'malformed' };"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 1 failed, the journal case at 'a newer build's row kind'.

# M17: RECALL_OFF_KEYS not frozen.
mut ccd/history/lib.mjs 'export const RECALL_OFF_KEYS = Object.freeze({' 'export const RECALL_OFF_KEYS = ({'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_OFF_KEYS is declared')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): history-lib 1 failed (the keys case); single-definition 1 failed ('RECALL_OFF_KEYS is not frozen').

# M18: seen_ms taken from the observation's end.
mut ccd/history/lib.mjs 'v: String(startMs) }' 'v: String(endMs) }'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 2 failed (the first-observation case, '2005' not '2000', and the unchanged case).

# M20: a file read absent treated as present.
mut ccd/history/lib.mjs "    if (f.state === 'absent') continue;
    present.add(f.id);" "    present.add(f.id);"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 1 failed, the unreadable case's CONTROL (put holds a state row of 'absent', del is []).

# M21: 'recall-off' dropped from JOURNAL_KINDS.
mut ccd/history/lib.mjs "'redact', 'tick', 'recall-off']);" "'redact', 'tick']);"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'one tick step')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'every kind the sweep journals')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): history-lib 3 failed (the journal, older-build and replay cases: journalRecord throws, not a
# JOURNAL_KINDS member); history-sweep 4 failed, all four cases (the pass's step throws, exit 1, at tickOk's first
# assertion); single-definition 1 failed ('ccd/history/sweep.mjs: recall-off').

# M22: the scan follows a link at recall-off/<id> (W2-D29's no-follow read, R3).
mut ccd/history/sweep.mjs '  const files = ids.map((id) => ({ id, state: recallOffStateOf(readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false)) }));' '  const files = ids.map((id) => ({ id, state: recallOffStateOf(readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, true)) }));'
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'unreadable is never absent: a link')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): the link to G1's file reads as the value G1, unchanged, so no new change row: X's last change is
# { from: 'unobserved', to: { s: 'value', v: G1 }, … }, not the change to unreadable.

# M23 (O13's reader count, Step 10 (b)): the scan reads each file through a read of its own, not readBounded.
mut ccd/history/sweep.mjs '  const files = ids.map((id) => ({ id, state: recallOffStateOf(readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false)) }));' "  const files = ids.map((id) => ({ id, state: recallOffStateOf({ state: 'value', value: readFileSync(recallOffPath(home, id), 'utf8') }) }));"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'exactly one writer, sweep')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): sweep.mjs reads recall-off/<id> through readBounded on two lines, recallOffPresence and the tick
# scan (W2-D29, W2-D30): expected [ …(1) ] to have length 2. The scan is a text scan, so it reds whether or not sweep.mjs
# imports readFileSync.

# M24: the plan accepts an observation that ends before it starts.
mut ccd/history/lib.mjs '  if (!isMs(startMs) || !isMs(endMs) || endMs < startMs) {' '  if (!isMs(startMs) || !isMs(endMs)) {'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): 1 failed, the refusal case ('expected [Function] to throw an error').

# M25: the plan accepts a file id outside the grammar.
mut ccd/history/lib.mjs '    if (!idOk(f.id)) throw new TypeError(`planRecallOffObservation: not a session id: ${JSON.stringify(f.id)}`);' ''
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'lib: the recall-off presence record')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (measured): 1 failed, the refusal case ('expected [Function] to throw an error').

cmp "$SCRATCH/lib.orig" ccd/history/lib.mjs && cmp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs \
  && cmp "$SCRATCH/cli.orig" ccd/history/cli.mjs && echo restored
```

Expected: `restored`. Then run Steps 5, 9 and 10's commands once more: all green. Record each measured red line in the commit body. If a mutant cannot be made red, report it; never weaken a CONTROL to make one red.

- [ ] **Step 12: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-drain.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-holds.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts)
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected green (predicted). Each file's count is its count before this task plus this task's cases: history-lib +15, history-sweep +4, history-recover +3, history-cli +2, single-definition `-t 'ccrc history'` +1 (the `VOCABS` row; O13's edited line adds no case), the rest +0. What each neighbour tests against this change:
- history-drain runs `tick` in-process (`EP.tick`, :2315-2382) with a fake clock. Its RF5b F16 cases count `readdirSync` walks of `projects/`, and this step lists with `opendirSync`, so their counts do not move.
- history-recover's O48 compares journal kinds across a recovery pass, which journals no recall-off record. Its `before` already holds the first tick's gap record.
- history-recall plants `recall-off/` files for C68 and RP cases. The step reads them each tick and asserts nothing about them.
- history-op's O34 audit cases run passes 31 minutes and more apart, so each such pass writes a gap record and flushes it. Their counters are `journal_missing_*`, `journal_skipped` and `journal_audit_ms`, which a recall-off record does not move. The one exact outbox count among them is Step 6 (e)'s, which counts verdict rows. The O34 kill case's next pass runs seconds after the last complete tick, so it writes no gap record and its outbox still empties.
- tsc: no line names a file this task touched. A line that names only `agent/src/` (the `ws` module) or `test/workflow-yaml-parses.test.ts` (the `yaml` module) comes from the worktree's install, not this task.

Then the departure's entry and the ledger check, which compares against `origin/main` without merging. D-6240's entry came with the plan: the first command prints 1. Never add a second; if a figure this task measured differs from the entry's, correct the entry and add the plan file to Step 13's `git add`.

```bash
grep -c '^- \*\*D-6240\*\* — ' docs/superpowers/plans/2026-10-21-ccrc-history-w2-1-recall-off-and-exports.md
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: `1`, then green.

- [ ] **Step 13: Commit.**

```bash
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs ccd/history/cli.mjs \
  server/test/history-lib.test.ts server/test/history-sweep.test.ts server/test/history-recover.test.ts \
  server/test/history-cli.test.ts server/test/history-op.test.ts server/test/single-definition.test.ts
git commit -m "feat(history): record recall-off presence on every tick, journaled through the outbox, and report it in status (W2-1 Task 4; W2-D30, W2-D31; D-6240)"
```

The commit body names the measured red line of every mutant in Step 11 and the passing counts of Steps 9, 10 and 12. `git status --short` lists exactly these ten files, plus this plan only if Step 12 corrected D-6240's entry.

---

### Task 5: RP8 end to end, RP10, and C66, C67 and C68 re-run over the shipped recall-off verb

W2-1's section 2 entry pins RP8 and RP10, and "C66, C67, C68 (re-run)". Task 3 ships the verb (W2-D26, W2-D27, W2-D28), its one writer and the move of its content readers onto `readBounded` (W2-D29), on Task 2's shared names; Task 4 ships the presence record (W2-D30) and `status`'s block (W2-D31). B2 pinned C66, C67 and C68 against a verb that only refused, and C68 against hand-planted files, "so a hand-planted file is pinned before W2 writes any" (spec §10.7, about :2020). This task re-runs those pins against the shipped verb and adds the two end-to-end pins the spec gives W2:
- **RP8** (spec §10.2 Pins, about :2759; W2-D32): a control file naming G1, then a purge and a reuse of the id with G2. The new family gets recall (exit 0) and its card line, `recall_off_stale` +1, and the analysis drops its lines. One `it`, in a fixture HOME with a poisoned gh (`makeHistoryBox` poisons gh, tmux, ssh, curl and the managers): the verb writes G1; purge and reuse give G2 with driven ticks; the read verb exits 0; the drain counts `recall_off_stale` +1; the hook serves the card line; the analysis runs through W2-3's merged pipeline (`measure-history.py`'s raw rows, then `buildWindows`, then `windowTotals`) and does not count the G2 line. G1's boundary window is planted to span the G2 call's ts. A CONTROL recomputes that window with the generation filter dropped, and counts the G2 line. Mutant M1 drops the filter in the script itself and goes red.
- **RP10** (about :2761): the W2 close step. `recall-off --clear-all` on a node with three assigned files leaves none, and the next card line serves for each family. Its card half is this task's, beside RP8, which already drives the hook; its verb half is Task 3's (R5). The case asserts `cleared === 3` and `skipped` empty (R3, R5).
- **C66, C67, C68** (spec §10.7, about :2012-2014): the existing holders run unedited, and one W2 half each is appended where the shipped verb gives the spec sentence something new to measure. RP8 and RP10 carry C68's half.

This task writes tests only. Its guards are Tasks 2 to 4's and W2-3's (`measure-history.py`'s calls query), plus the hook's card arm from B3. So red-first is measured by mutant (Step 5): each prediction is written before its run.

**Where each pin lands, and why.**

| Pin | File | Why |
|---|---|---|
| RP8 | `server/test/history-recall.test.ts` | C68's CLI half (stale read, drain count) lives here (`C68 (CLI half)`, about :976), and RP8 is that pin end to end over the verb's own bytes. The file holds every fixture the steps need: `seedFamily`, `withPane`, `treeJson`, `recallRows11`, `cycles`, `turns`, and the module constants. `measure-history.test.ts` holds the .py's own pins but none of the CLI and pane fixtures. `session-hook.test.ts` and `history-card.test.ts` hold the hook's and the prediction's pins, but they are not W2-1 files (section 2). The script is reached by `spawnSync`, the gate by dynamic import and the hook by `spawnSync('bash', …)`, so the file gains no import line. |
| RP10 | `server/test/history-recall.test.ts` | Same fixtures as RP8. Its CONTROL is C68's card half over verb-written files. |
| C66 (W2 half) | `server/test/history-recall.test.ts`, beside `C66 (B2 half)` (about :401) | The B2 half measured the preflight. The W2 half runs every form, `--generation` included, through the shipped verb, with `recall-off/` present so `recall-off/../x` would resolve. |
| C67 (W2 half) | `server/test/history-recall.test.ts` | C67's recall-off clause already sits in `C66 (B2 half)` (`'C67\'s recall-off clause'`, about :411). `history-recover.test.ts`'s `C67:` describe (about :2545) needs the recover fixture and a pty for its binding-verb half, and the W2 form needs neither. |
| C68 | `history-recall.test.ts` (RP8's exit-8 and stale steps; RP10's CONTROL) | The CLI half's existing cases plant files by hand on purpose (§10.7) and stay as they are. `session-hook.test.ts`'s parity table (`C19/C68 (card half)`, about :12844, :12860) stays on hand-planted files, also on purpose, and is re-run unedited (Step 4). |

**Files:** (anchors measured at 02d75ae5f, or written by Task 3 where Step 1 says so; Tasks 2 to 4 edit the files the mutants touch, so each mutant is anchored by its quoted content, and Step 1 asserts each anchor.)
- Modify (test): `server/test/history-recall.test.ts`. Append ONE describe at the end of the file, after whatever describe is last at Task 4's commit. At 02d75ae5f the last is the describe titled `whole-branch fix 5: grep --json masks a context key behind angle brackets …`, about :5371, and the file ends at :5400. The describe reuses the module-level `ID`, `ID_B`, `ID_D11`, `PROJECT`, `G1`, `G2`, `G4_11`, `TA`, `TB`, `TD11`, `T0`, `HEAVY`, `rid`, `iso`, `turns`, `cycles`, `hist`, `storeIdOf`, `treeJson`, `answer`, `scopeOf` and `recallRows11` (about :40-110 and :658-670), and the existing imports `fs`, `path`, `spawnSync`, `makeHistoryBox`, `runSweep`, `runCli`, `withPane`, `seedFamily`, `plantSession`, `spoolLine`, `counters`, `openStoreRO`, `REPO`, `HistoryBox`, `assistantRow`, `Row` and `libRead`. It adds no import line.
- Mutated in Step 5 only, then restored byte for byte and never committed: `deploy/measure-history.py`, `ccd/history/sweep.mjs`, `ccd/history/lib.mjs`, `ccd/session-hook.sh`.
- Run, not edited: `history-lib.test.ts`, `history-drain.test.ts`, `history-card.test.ts`, `history-recover.test.ts`, `session-hook.test.ts`, `measure-history.test.ts`, `single-definition.test.ts`.
- Not edited: every source file, the spec, README.md, `deploy/history-replay.mjs`, `server/test/history-replay.test.ts`, `.github/workflows/*`. No file is created.

**Interfaces:**
- Consumes, from Task 3 (W2-D26, W2-D27, W2-D28; re-read the code at Task 4's commit before Step 2):
  - `ccrc history recall-off <id> --generation <uuid> --json`. It is relayed through the placed shim to `sweep.mjs`'s executor, the one writer (W2-D29). It exits 0 on a write and leaves `~/.ccrc/history/recall-off/<id>` holding exactly `<uuid>\n` (W2-D28). Run with no pane: it is a box verb.
  - `recall-off <id> --json` (no `--generation`) with `$REG/<id>.generation` unreadable answers exit 2, `reason: 'generation-unreadable'`, and writes nothing. The same holds with `--generation <uuid>` (W2-D27's table).
  - Any form with an id off ccd's grammar answers exit 2, `reason: 'bad-id'`, before any path is formed (C66).
  - `recall-off --clear-all --json` exits 0. The pass prints its summary `{"rc":0,"reason":null,"cleared":<count>,"skipped":[<names>]}` on its own line before the result line, and under `--json` the CLI relays that line on stderr; stdout's last line is the CLI's own envelope (R3). It unlinks every regular file and symlink in `recall-off/`.
  - The presence record (W2-D30) and `status`'s `recall_off` (W2-D31) are not read here. They tick alongside and must change none of the answers above.
- Consumes, base (unchanged at 02d75ae5f):
  - `deploy/measure-history.py --db <db> --families <file> --window-start <ms> --window-end <ms> --row-cap <n>` prints one JSON object whose `w2.families[]` is `{ccrc_id, generation, found, merged_generations, calls: [ts_ms, rc, verb][], boundaries: [{boundary_uuid, ts_ms, copies}]}`. `family_report`'s calls query (about :230) keeps `recall_calls` rows with `ccrc_id = ? AND generation IN (<own + merged>) AND arm IS NULL AND ts_ms >= start`. That is "the generation filter".
  - `deploy/history-gate.mjs`:
    - `ROW_CAP` (400, about :44);
    - `buildWindows(family, k = K): Window[]` (about :300);
    - `windowOf(boundary, calls, k = K): Window` (about :273);
    - `windowTotals(windows): {windows, with_call, calls, turns, unmeasured}` (about :311);
    - `Window` is `{boundary_uuid, ts_ms, producer, state, start_ms, end_ms, end_inclusive, turns, calls, with_call}`.
  - `ccd/session-hook.sh`'s SessionStart(compact) arm and `_hook_history_card` (about :2959). Its checks run in order:
    - the id from the pane's tmux name `cc-<id>`;
    - `psid` = the payload's `session_id`;
    - `recall-off/<id>` compared with the env generation, after the hook trims ASCII whitespace;
    - `scope/<id>` reading `main <psid> <ms>`, fresh;
    - `card/<id>/<psid>.txt` matching `HISTORY_CARD_RE`.
    It prints one JSON line whose `hookSpecificOutput.additionalContext` holds the line.
  - `lib.mjs`'s `CARD_LINE_RE`; `sweep.mjs`'s drain-time stale count in `applyEventLine` (about :840); `lib.mjs`'s `decideRecallOff` (about :4350).
- Produces: test-only, all module-private to `history-recall.test.ts`:
  - `RP_HOOK`, `RP_MEASURE` and `RP_LATE_MS` (86,400,000);
  - the types `RpCall`, `RpBoundary`, `RpFamily`, `RpWindow` and `RpGate`;
  - `rpGate(): Promise<RpGate>`;
  - `rpRowsG1(late: number): Row[]`;
  - `rpPurge(box, id): void`;
  - `rpPredicted(box, id, sid): string`, which returns the prediction's line without its LF;
  - `rpCompactStart(box, id, sid, gen, transcript): {code, stderr, context: string | null}`;
  - `rpMeasure(box, families, start, end, rowCap): RpFamily[]`;
  - `rpCallsOf(box, id): RpCall[]`;
  - `rpTsOf(box, id, gen): number`;
  - four `it`s in one describe, `W2-1 Task 5: …`.

**Spec:** no edit. RP8 and RP10 (§10.2 Pins, about :2759 and :2761), C66, C67 and C68 (§10.7, about :2012-2014), §9.7's recall-off row (about :2314). The spec text this task pins needs no erratum. No D-number is cited or taken, and no departure was found.

**Choices this task makes:**
- **The window spans the G2 call by its end, not by a clock seam (R5).** The CLI stamps its recall line with the wall clock, and `cli.mjs` has no test clock. G1's transcript ends with an assistant row stamped `Date.now() + RP_LATE_MS`. Its copy then has two turns after the summary (fewer than K) and no next boundary, so `windowOf` ends the window INCLUSIVE at the copy's last timed row (W2-D14, the gate's own rule). The window `[boundary ts, late]` spans every call the case makes while the case runs for less than a day. The case asserts that the window spans `rpTsOf(box, ID, G2)`, so a slow box cannot pass vacuously.
- **The CONTROL is a recomputation, and the mutant is the filter.** RP8's CONTROL feeds `windowOf` the same boundary with every arm-NULL call of the id (`rpCallsOf`: no generation filter) and expects 2 calls, G1's exit 8 and the G2 read. So the fixture is sensitive, and only the filter keeps the G2 line out. Mutant M1 removes the filter from `measure-history.py` and reds the case's earlier assertion "the family's calls are G1's exit 8 alone" (`[8, 0]` vs `[8]`, measured), before `windowTotals` is reached.
- **G1's own exit-8 read is in the window**, so the count asserted is 1, never a vacuous 0. The G2 line is the one that must not be counted.
- **The drain runs before the hook.** Draining first keeps the counted state exactly what W2-D32 lists, whatever the hook later spools. (The reason is not that the SessionStart(compact) arm spools its own history spool line (the delegation spool does record a compact start): lib's `SPOOL_SOURCES` is `startup`, `resume`, `clear` and `fork`, and the hook's spool case leaves `compact` out.) The hook neither reads nor writes `recall_calls` or the counter, so this order changes no assertion of W2-D32's.
- **The scope marker is planted, not written by a driven PreCompact.** The card arm serves only after a fresh `main <psid> <ms>` marker (check 5). PreCompact's marker is S16's, pinned in `session-hook.test.ts`. `rpCompactStart` plants the same three fields, as that file's card describe does (`mark()`, about :12290).
- **A Stop line and one pass before each prediction is read** (`rpPredicted`), the `pokeC` pattern of `history-card.test.ts` (about :563). The pass reads the transcript to its end, which is when the sweep writes `card/<id>/<uuid>.txt`. The case asserts that the file exists and matches `CARD_LINE_RE` before it relies on it.
- **The purge is `_reg_purge`'s effect, done by hand in the fixture.** `rpPurge` removes every `$REG/<id>.*`. `recall-off/` lives under `~/.ccrc/history`, outside `$REG` (§9.7), so the case asserts that it survives. No `ccd` verb runs.
- **No recall-off file is written by hand.** Every file is the verb's bytes, `<G>\n`. That is what distinguishes this re-run from B2's pins: the hook must trim the LF (mutant M5 reds here and in session-hook.test.ts's C19/C68 parity rows, 12 failed, measured), and the CLI and the drain trim in JS.
- **The analysis lists only (ID, G1).** The pre-registered list is fixed before the reuse (§10.2, "What the analysis counts"), and the G2 family is a new family, off it. The analysis does not run `changedFamilies`, which W2-D32 does not name (R5): the verb's write at `Date.now()` lies inside `[T0, late]`, so a changed-family reading would flag G1, and changed-family reading is pinned by W2-3's and Task 4's own cases.

- [ ] **Step 0: Check that the base holds Tasks 2 to 4.** From the repository root:

```bash
for n in "'generation-mismatch'" "'generation-malformed'" 'recallOffDir' 'RECALL_OFF_META'; do printf '%s ' "$n"; grep -cF "$n" ccd/history/lib.mjs; done
grep -cF '~tmp.' ccd/history/sweep.mjs
```

Expected: every count at least 1 (each measured 0 at 02d75ae5f). A 0 means that Tasks 2 to 4 are not on this base: make no edit, and report to the coordinator.

- [ ] **Step 1: Confirm the anchors, the free names and Task 3's re-expectation.** From the repository root:

```bash
grep -cF "WHERE ccrc_id = ? AND generation IN ({marks(len(gens))}) '" deploy/measure-history.py
grep -cF "(ccrc_id, *gens, start_ms)).fetchall()]" deploy/measure-history.py
grep -cF "=== 'stale') bump(db, 'recall_off_stale');" ccd/history/sweep.mjs
grep -cF '[[ "$o" == "$gen" ]] && return 0' ccd/session-hook.sh
grep -cF 'o="${o#"${o%%[!$ws]*}"}"; o="${o%"${o##*[!$ws]}"}"' ccd/session-hook.sh
grep -cF "  return file.value.trim() === generation ? 'off' : 'stale';" ccd/history/lib.mjs
grep -cF "      if (!idOk(id)) return refuse('bad-id');" ccd/history/lib.mjs
grep -cF '  if (!idOk(id)) throw new TypeError(`recallOffPath: not a session id' ccd/history/lib.mjs
grep -cF "  if (registry.state !== 'absent' && registry.state !== 'value') return refuse('generation-unreadable');" ccd/history/lib.mjs
grep -cF '      unlinkSync(`${P.recallOffDir}/${n}`);' ccd/history/sweep.mjs
grep -c 'decideRecallOffPreflight' ccd/history/lib.mjs
grep -c 'the writing verb ships with W2' server/test/history-recall.test.ts
grep -c 'rpGate\|rpCompactStart\|rpPredicted\|rpMeasure\|rpRowsG1\|rpPurge\|rpCallsOf\|rpTsOf\|RP_HOOK\|RP_MEASURE\|RP_LATE_MS\|W2-1 Task 5' server/test/history-recall.test.ts
```

Expected:
- the first ten counts are 1 each. The first six, and `recallOffPath`'s own test (the eighth, which Task 2 keeps), were measured 1 at 02d75ae5f. The other three are Task 3's: `parseOpVerbArgs`' `recall-off` case's id test (the other `bad-id` lines in that function test `session`, not `id`), `decideRecallOffWrite`'s unreadable line, and the `--clear-all` arm's unlink in `recallOffPass` (the stale-temp removal spells its unlink after `try { ` on one line, so it does not match);
- `decideRecallOffPreflight`: 0. Task 3 removed B2's preflight, so M7 and M8 mutate the lines that now make its decisions;
- `the writing verb ships with W2`: 0. `C66 (B2 half)`'s last assertion expected `[2, 'bad-args']` for `recall-off <id>` at 02d75ae5f (about :412). The shipped verb writes there, so Task 3's commit re-expected it (R3). A 1 means Task 3's commit is red: stop and report to the coordinator. Never edit it here;
- the name count: 0.

A different count means that the base moved: re-read the region before writing a mutant, re-anchor the mutant on the line that now makes the same decision, and name the substitution in the commit body.

- [ ] **Step 2: Append the tests.** At the end of `server/test/history-recall.test.ts`, append:

```ts

// ── W2-1 Task 5: RP8 end to end, RP10, and C66, C67 and C68 re-run over the shipped recall-off verb ───────────────
// Spec 2026-10-05 §10.2 (RP8, RP10), §10.7 (C66, C67, C68), §8.4 (recall-off), §8.6 (the card line), §9.7.
// W2-D32: RP8 is ONE `it`, in a fixture HOME whose gh (and tmux, ssh, curl and the managers) is poisoned
// (makeHistoryBox). Each part runs as shipped: the verb through the CLI and the placed shim, the read verb in a pane,
// the drain as the timer's pass, ccd/session-hook.sh as Claude Code runs it, and the analysis through W2-3's merged
// pipeline: measure-history.py's raw rows, then history-gate.mjs's buildWindows, then windowTotals.
// No recall-off file here is written by hand. B2 pinned hand-planted files before W2 wrote any (§10.7); these re-runs
// hold the verb's own bytes, `<generation>\n` (W2-D28), which the CLI and the drain trim in JS and the hook trims of
// ASCII whitespace. The hook and the measure are spawned and the gate is imported dynamically: no import line is added.
const RP_HOOK = path.join(REPO, 'ccd', 'session-hook.sh');
const RP_MEASURE = path.join(REPO, 'deploy', 'measure-history.py');
/** How far past the case's start G1's last row is stamped, so G1's window spans every call the case makes. */
const RP_LATE_MS = 86_400_000;
type RpCall = [ts_ms: number, rc: number, verb: string];
interface RpBoundary { boundary_uuid: string; ts_ms: number; copies: unknown[] }
interface RpFamily {
  ccrc_id: string; generation: string; found: boolean; merged_generations: string[]; calls: RpCall[]; boundaries: RpBoundary[];
}
interface RpWindow {
  state: 'measured' | 'unmeasured'; start_ms: number; end_ms: number | null; end_inclusive: boolean; turns: number; calls: number; with_call: boolean;
}
/** The names of W2-3's merged gate module this describe reads. */
interface RpGate {
  ROW_CAP: number;
  buildWindows(family: RpFamily, k?: number): RpWindow[];
  windowOf(boundary: RpBoundary, calls: RpCall[], k?: number): RpWindow;
  windowTotals(windows: RpWindow[]): { windows: number; with_call: number; calls: number; turns: number; unmeasured: number };
}
const rpGate = async (): Promise<RpGate> => (await import('../../deploy/history-gate.mjs')) as unknown as RpGate;

/** G1's transcript: one manual compaction (`cycles`: the main boundary the analysis windows, at iso(8), its summary at
 *  iso(9)), then two assistant turns, the second stamped `late`. Two turns is fewer than K and no boundary follows, so
 *  the window ends INCLUSIVE at the copy's last timed row, `late` (W2-D14). */
function rpRowsG1(late: number): Row[] {
  const cwd = '/home/u/worktrees/p/quiet-basin';
  return [
    ...cycles(TA, 1),
    assistantRow({ uuid: rid(TA, 6), ts: iso(10), sessionId: TA, cwd, text: 'Fixture answer after the summary.', requestId: 'req_rp8_1', msgId: 'msg_rp8_1' }),
    assistantRow({ uuid: rid(TA, 7), ts: new Date(late).toISOString(), sessionId: TA, cwd, text: 'Fixture answer, stamped late.', requestId: 'req_rp8_2', msgId: 'msg_rp8_2' }),
  ];
}

/** ccd's `_reg_purge` as this fixture's registry holds it: every `$REG/<id>.<field>` removed. recall-off/ lives
 *  under ~/.ccrc/history, outside $REG, so a purge leaves it (§9.7). */
function rpPurge(box: HistoryBox, id: string): void {
  for (const n of fs.readdirSync(box.reg)) if (n.startsWith(`${id}.`)) fs.rmSync(path.join(box.reg, n), { recursive: true, force: true });
}

/** The prediction the sweep writes for `sid`, `card/<id>/<sid>.txt`, as its one line without the LF. A Stop line and
 *  one pass come first, so that pass reads the transcript to its end (history-card.test.ts's pokeC). */
function rpPredicted(box: HistoryBox, id: string, sid: string): string {
  spoolLine(box, id, { v: 1, ev: 'Stop', id });
  const r = runSweep(box);
  expect(r.code, r.stderr).toBe(0);
  const p = hist(box, 'card', id, `${sid}.txt`);
  expect(fs.existsSync(p), `CONTROL: the sweep predicted ${id}'s card line`).toBe(true);
  const line = fs.readFileSync(p, 'utf8').replace(/\n$/, '');
  expect(libRead.CARD_LINE_RE.test(line), line).toBe(true);
  return line;
}

/** SessionStart(compact) for `id`'s transcript `sid`, run as Claude Code runs the hook in that pane: the payload on
 *  stdin, the pane's identity through withPane's tmux, the session generation in the env. PreCompact's scope marker
 *  (`main <sid> <ms>`, S16's grammar) is planted first: no PreCompact is driven here. `context` is the
 *  additionalContext the hook printed, or null when it printed nothing. */
function rpCompactStart(box: HistoryBox, id: string, sid: string, gen: string, transcript: string): { code: number | null; stderr: string; context: string | null } {
  fs.mkdirSync(hist(box, 'scope'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(hist(box, 'scope', id), `main ${sid} ${Date.now()}\n`);
  const r = spawnSync('bash', [RP_HOOK], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', cwd: box.home, transcript_path: transcript,
      session_id: sid, prompt_id: 'p1', model: 'claude-fixture-4' }),
    encoding: 'utf8', cwd: box.home, timeout: 60_000, killSignal: 'SIGTERM',
    env: { ...box.env, ...withPane(box, id), CLAUDE_CODE_SESSION_ID: sid, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: gen, CLAUDE_JOB_DIR: '' },
  });
  const out = (r.stdout ?? '').trim();
  if (out === '') return { code: r.status, stderr: r.stderr ?? '', context: null };
  const j = JSON.parse(out.split('\n').at(-1)!) as { hookSpecificOutput?: { additionalContext?: unknown } };
  return { code: r.status, stderr: r.stderr ?? '', context: String(j.hookSpecificOutput?.additionalContext ?? '') };
}

/** measure-history.py's W2 raw rows for the listed families, isolated (-I) and bytecode-free (-B). */
function rpMeasure(box: HistoryBox, families: string, start: number, end: number, rowCap: number): RpFamily[] {
  const r = spawnSync('python3', ['-I', '-B', RP_MEASURE, '--db', hist(box, 'db', 'history.db'), '--families', families,
    '--window-start', String(start), '--window-end', String(end), '--row-cap', String(rowCap)],
  { encoding: 'utf8', env: { ...box.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
  expect(r.status, r.stderr).toBe(0);
  return (JSON.parse(r.stdout) as { w2: { families: RpFamily[] } }).w2.families;
}

/** Every arm-NULL recall_calls row of `id`, of any generation, in the script's order: the calls with the generation
 *  filter dropped. */
function rpCallsOf(box: HistoryBox, id: string): RpCall[] {
  const db = openStoreRO(box);
  try {
    return (db.prepare('SELECT ts_ms, rc, verb FROM recall_calls WHERE ccrc_id = ? AND arm IS NULL ORDER BY ts_ms, event_key')
      .all(id) as Array<{ ts_ms: number; rc: number; verb: string }>).map((c): RpCall => [Number(c.ts_ms), Number(c.rc), c.verb]);
  } finally {
    db.close();
  }
}

/** The ts_ms of the one recall_calls row of (id, gen). */
function rpTsOf(box: HistoryBox, id: string, gen: string): number {
  const db = openStoreRO(box);
  try {
    const rows = db.prepare('SELECT ts_ms FROM recall_calls WHERE ccrc_id = ? AND generation = ?').all(id, gen) as Array<{ ts_ms: number }>;
    expect(rows, `one recall_calls row of (${id}, ${gen})`).toHaveLength(1);
    return Number(rows[0]!.ts_ms);
  } finally {
    db.close();
  }
}

describe.skipIf(process.platform === 'darwin')('W2-1 Task 5: RP8 end to end, RP10, and C66, C67 and C68 over the shipped recall-off verb (spec 10.2, 10.7)', () => {
  it('RP8 end to end (W2-D32): the verb writes G1; a purge and a reuse give G2; the new family reads (exit 0) and gets its card line, the drain counts recall_off_stale once, and the analysis counts no G2 line in G1\'s window', async () => {
    const gate = await rpGate();
    const box = makeHistoryBox('ccrc-hist-rcl-rp8-');
    const late = Date.now() + RP_LATE_MS;
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: rpRowsG1(late) });
    const ro = openStoreRO(box);
    try {
      const b = ro.prepare("SELECT count(*) AS n FROM boundaries b JOIN transcripts t ON t.transcript_pk = b.transcript_pk WHERE t.cc_session_uuid = ? AND t.agent_id = ''")
        .get(TA) as { n: number };
      expect(Number(b.n), 'CONTROL: G1\'s one main boundary is ingested').toBe(1);
    } finally {
      ro.close();
    }

    // 1. The verb writes G1: as invoked, no dry run (W2-D26); the registry's generation equals --generation (W2-D27).
    const off = hist(box, 'recall-off', ID);
    const wrote = runCli(box, ['recall-off', ID, '--generation', G1, '--json']);
    expect(wrote.code, `${wrote.stderr}${wrote.stdout}`).toBe(0);
    expect(fs.readFileSync(off, 'utf8'), 'the verb\'s bytes: the generation and one LF (W2-D28)').toBe(`${G1}\n`);
    // C68 over the verb's bytes: G1's read answers 8, counted, and its drain counts no stale read.
    expect(answer(treeJson(box)), 'C68: the file names this generation').toEqual([8, undefined]);
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);
    expect(recallRows11(box).map((x) => [x.generation, x.rc])).toEqual([[G1, 8]]);
    expect(counters(box)['recall_off_stale'] ?? 0, 'CONTROL: a read the file names is not stale').toBe(0);

    // 2. A purge and a reuse of the id with G2: seedFamily drives the reuse's ticks, and rpPredicted's pass reads TB to
    //    its end, so the sweep predicts the new family's card line.
    rpPurge(box, ID);
    const { transcript: tB } = seedFamily(box, { id: ID, project: PROJECT, uuid: TB, generation: G2, rows: turns(TB, 2) });
    expect(fs.readFileSync(off, 'utf8'), 'the purge leaves recall-off/<id>').toBe(`${G1}\n`);
    const line = rpPredicted(box, ID, TB);

    // 3. The read verb exits 0: the file names G1 and the resolved generation is G2, so the file is stale (§9.7).
    const read = treeJson(box);
    expect(read.code, `RP8: the new family gets recall. ${read.stderr}${read.stdout}`).toBe(0);
    expect(scopeOf(read).families.map((f) => [f.ccrc_id, f.generation])).toEqual([[ID, G2]]);

    // 4. The drain counts recall_off_stale +1. The first tick renames the line, the second drains it while the file still
    //    names G1. The drain runs before the hook. SessionStart(compact) is not a history spool source
    //    (`SPOOL_SOURCES`), so the hook adds no history spool line;
    //    draining first keeps the counted state exactly W2-D32's.
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);
    expect(recallRows11(box).map((x) => [x.generation, x.rc])).toEqual([[G1, 8], [G2, 0]]);
    expect(counters(box)['recall_off_stale'], 'RP8: the drain counts the stale read once').toBe(1);

    // 5. The hook serves the new family's card line.
    const h = rpCompactStart(box, ID, TB, G2, tB);
    expect(h.code, h.stderr).toBe(0);
    expect(h.stderr, 'the hook is silent on stderr').toBe('');
    expect(h.context ?? '', 'RP8: the new family gets its card line').toContain(line);

    // 6. The analysis, through W2-3's merged pipeline, over the pre-registered list (ID, G1) only: the G2 family is a
    //    new family, off the list (§10.2 "What the analysis counts").
    const families = path.join(box.home, 'rp8-families.json');
    fs.writeFileSync(families, JSON.stringify([{ store_id: storeIdOf(box), ccrc_id: ID, generation: G1 }]));
    const fams = rpMeasure(box, families, T0, late + 1, gate.ROW_CAP);
    expect(fams.map((f) => [f.ccrc_id, f.generation, f.found])).toEqual([[ID, G1, true]]);
    const g2Ts = rpTsOf(box, ID, G2);
    const windows = gate.buildWindows(fams[0]!);
    expect(windows.map((w) => [w.state, w.end_inclusive, w.end_ms]), 'one measured window, inclusive at the late row').toEqual([['measured', true, late]]);
    expect(windows[0]!.start_ms <= g2Ts && g2Ts <= late, 'the G1 boundary\'s window spans the G2 call\'s ts').toBe(true);
    expect(fams[0]!.calls.map((c) => c[1]), 'the family\'s calls are G1\'s exit 8 alone').toEqual([8]);
    expect(gate.windowTotals(windows), 'RP8: the analysis does not count the G2 line')
      .toEqual({ windows: 1, with_call: 1, calls: 1, turns: 2, unmeasured: 0 });
    // CONTROL: the same window over the id's calls with the generation filter dropped counts the G2 line as well, so
    // only the filter keeps it out.
    expect(gate.windowOf(fams[0]!.boundaries[0]!, rpCallsOf(box, ID)).calls, 'CONTROL: no generation filter').toBe(2);
  }, 2 * HEAVY);

  it('RP10 the W2 close step: recall-off --clear-all on a node with three verb-written files leaves none, and the next card line serves for each family', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-rp10-');
    const fams = [{ id: ID, sid: TA, gen: G1 }, { id: ID_B, sid: TB, gen: G2 }, { id: ID_D11, sid: TD11, gen: G4_11 }]
      .map((f) => ({ ...f, transcript: seedFamily(box, { id: f.id, project: PROJECT, uuid: f.sid, generation: f.gen, rows: turns(f.sid, 2) }).transcript }));
    const lines = fams.map((f) => rpPredicted(box, f.id, f.sid));
    for (const f of fams) {
      const w = runCli(box, ['recall-off', f.id, '--generation', f.gen, '--json']);
      expect(w.code, `${f.id}: ${w.stderr}${w.stdout}`).toBe(0);
    }
    expect(fs.readdirSync(hist(box, 'recall-off')).sort(), 'three assigned files').toEqual([ID, ID_B, ID_D11].sort());
    // CONTROL, and C68's card and CLI halves over the verb's bytes: each file names its family's generation, so the
    // hook withholds that family's line and its read verb answers 8.
    for (const f of fams) {
      const h = rpCompactStart(box, f.id, f.sid, f.gen, f.transcript);
      expect(h.code, h.stderr).toBe(0); expect(h.stderr, 'the hook is quiet on stderr').toBe('');
      expect(h.context ?? '', `${f.id}: no card line while its file names its generation`).not.toContain('History: node ');
      expect(answer(treeJson(box, f.id)), `${f.id}: exit 8 while recall is off`).toEqual([8, undefined]);
    }
    const clear = runCli(box, ['recall-off', '--clear-all', '--json']);
    expect(clear.code, `${clear.stderr}${clear.stdout}`).toBe(0);
    // The pass prints its summary on its own line before the result line, and under --json the CLI relays it on stderr;
    // stdout's last line is the CLI's envelope (W2-D28).
    const summary = clear.stderr.split('\n').find((l) => l.startsWith('{"rc"') && l.includes('"cleared"'));
    expect(summary, `the --clear-all summary is relayed on stderr\n${clear.stderr}`).toBeDefined();
    const sum = JSON.parse(summary!) as { cleared: unknown; skipped: unknown };
    expect([sum.cleared, sum.skipped], 'W2-D28: three cleared, none skipped').toEqual([3, []]);
    expect(fs.readdirSync(hist(box, 'recall-off')), 'RP10: none left').toEqual([]);
    fams.forEach((f, k) => {
      const h = rpCompactStart(box, f.id, f.sid, f.gen, f.transcript);
      expect(h.code, h.stderr).toBe(0); expect(h.stderr, 'the hook is quiet on stderr').toBe('');
      expect(h.context ?? '', `RP10: ${f.id}'s next card line serves`).toContain(lines[k]!);
      expect(treeJson(box, f.id).code, `${f.id}: its read verb reads again`).toBe(0);
    });
  }, 3 * HEAVY);

  it('C66 W2 half: every recall-off form whose id is off ccd\'s grammar answers 2 bad-id through the shipped verb, and no path is formed', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c66w-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    // CONTROL: the verb writes in this box. recall-off/ then exists, so `recall-off/../x` WOULD resolve to the victim
    // below: a refusal that rested on a missing directory would not show here.
    const w = runCli(box, ['recall-off', ID, '--generation', G1, '--json']);
    expect(w.code, `${w.stderr}${w.stdout}`).toBe(0);
    const victim = hist(box, 'x');   // where recall-off/../x lands
    fs.writeFileSync(victim, 'keep');
    for (const args of [['../x', '--clear'], ['../x', '--generation', G1], ['../x'], ['..', '--clear'], ['a/b', '--generation', G1]]) {
      expect(answer(runCli(box, ['recall-off', ...args, '--json'])), args.join(' ')).toEqual([2, 'bad-id']);
    }
    expect(fs.readFileSync(victim, 'utf8'), 'nothing unlinked, nothing written').toBe('keep');
    expect(fs.readdirSync(hist(box, 'recall-off')), 'no entry but the CONTROL\'s').toEqual([ID]);
  }, HEAVY);

  it('C67 W2 half: an unreadable $REG/<id>.generation refuses the write form with and without --generation, 2 generation-unreadable, and nothing is written', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c67w-');
    seedFamily(box, { id: ID_B, project: PROJECT, uuid: TB, generation: G2, rows: turns(TB, 2) });
    // CONTROL: the same verb writes for an id whose .generation reads.
    const w = runCli(box, ['recall-off', ID_B, '--generation', G2, '--json']);
    expect(w.code, `${w.stderr}${w.stdout}`).toBe(0);
    plantSession(box, ID, { generation: 'unreadable' });   // present, and no read of it succeeds
    for (const args of [[ID], [ID, '--generation', G1]]) {
      expect(answer(runCli(box, ['recall-off', ...args, '--json'])), args.join(' ')).toEqual([2, 'generation-unreadable']);
    }
    expect(fs.readdirSync(hist(box, 'recall-off')), 'nothing written for the unreadable id').toEqual([ID_B]);
  }, HEAVY);
});
```

- [ ] **Step 3: Run them.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-1 Task 5')
```

Expected GREEN (predicted): `4 passed`, with the rest of the file skipped. The code is Tasks 2 to 4's, W2-3's and B3's, so a red here is one of two things:
- a defect in those tasks, which you report to the coordinator, never weakening the case;
- a fixture that does not do what its CONTROL says. A red at a CONTROL is the fixture's to fix, never the guard's to weaken:
  - `CONTROL: G1's one main boundary is ingested`: `cycles` gives the boundary, and `seedFamily` ticks to end-of-file;
  - `CONTROL: the sweep predicted …'s card line`: add the pass `pokeC` would, never a hand-written card;
  - `the G1 boundary's window spans the G2 call's ts`: `late` is a day ahead.

Each case alone, so that a later step's filter is known to select it:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'RP8 end to end \(W2-D32\)')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'RP10 the W2 close step')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C66 W2 half')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C67 W2 half')
```

Expected: `1 passed` each.

- [ ] **Step 4: Re-run the existing holders of C66, C67 and C68, unedited.** In the foreground, one command per tool call, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C66|C67|C68')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'C66|C67')
(cd server && ./node_modules/.bin/vitest run test/history-drain.test.ts -t 'C66 spool half')
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'C66 shape')
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'C67')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'C68')
```

Expected green (predicted). What each command selects:
- `history-recall`:
  - `C66 (B2 half)`, whose last assertion Task 3 re-expected;
  - the four `C68 …` cases: the CLI half, newest family, replay half and joined generation;
  - this task's four cases (`RP8 end to end`, `RP10 the W2 close step`, `C66 W2 half` and `C67 W2 half`), all selected because their describe's title names C66, C67 and C68, and `C54 + C67 (harness half)`;
- `history-lib`: the C66 and C67 pure halves and `decideBind`'s C67 case;
- `history-drain`: the spool half;
- `history-card`: the path helpers;
- `history-recover`: `C67: unreadable is not absent`, whose `recall-off <id> --json` with an unreadable `.generation` now runs the shipped verb, still `generation-unreadable` with the `ccrcSnapshot` unchanged;
- `session-hook`: every `C19/C68 (card half)` parity row, on hand-planted files.

If one goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes). A red that holds names a defect in Tasks 2 to 4: report it, and never edit the holder here.

- [ ] **Step 5: Measure each pin red under a mutant of the guard it holds, then green.** From the repository root. Each block applies its replacement and asserts the match count, runs one filter and shows it red, then restores the file with `cp`. The python bodies are quoted heredocs. A mutant that cannot be made red is reported to the coordinator, never dropped.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-1/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp deploy/measure-history.py "$SCRATCH/measure.orig"
cp ccd/history/sweep.mjs "$SCRATCH/sweep.orig"
cp ccd/history/lib.mjs "$SCRATCH/lib.orig"
cp ccd/session-hook.sh "$SCRATCH/hook.orig"

# M1 (RP8's analysis): the script's generation filter dropped, so every arm-NULL call of the id is the family's.
mut deploy/measure-history.py "WHERE ccrc_id = ? AND generation IN ({marks(len(gens))}) '" "WHERE ccrc_id = ? '"
mut deploy/measure-history.py "(ccrc_id, *gens, start_ms)).fetchall()]" "(ccrc_id, start_ms)).fetchall()]"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'RP8 end to end \(W2-D32\)')
cp "$SCRATCH/measure.orig" deploy/measure-history.py
# Expected RED (predicted): "the family's calls are G1's exit 8 alone": expected [ 8, 0 ] to deeply equal [ 8 ].

# M2 (RP8's drain, and C68's CLI half): the drain-time stale check never counts.
mut ccd/history/sweep.mjs "=== 'stale') bump(db, 'recall_off_stale');" "=== 'never-stale') bump(db, 'recall_off_stale');"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'RP8 end to end \(W2-D32\)|C68 \(CLI half\)')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): 2 failed. RP8 "the drain counts the stale read once" and C68 (CLI half): expected undefined to be 1.

# M3 (RP8's read verb): every recall-off file that reads is off, stale folded into off.
mut ccd/history/lib.mjs "  return file.value.trim() === generation ? 'off' : 'stale';" "  return 'off';"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'RP8 end to end \(W2-D32\)|C68 \(CLI half\)')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): 2 failed. RP8 "the new family gets recall": expected 8 to be 0; C68 (CLI half) the same at its stale step.

# M4 (RP8's card line): the hook withholds whenever recall-off/<id> exists, so a stale file withholds too.
mut ccd/session-hook.sh '[[ "$o" == "$gen" ]] && return 0' 'return 0'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'RP8 end to end \(W2-D32\)|RP10 the W2 close step')
cp "$SCRATCH/hook.orig" ccd/session-hook.sh
# Expected RED (predicted): 1 failed | 1 passed. RP8 "the new family gets its card line": expected '…' to contain 'History: node …'.
# RP10 stays green: its CONTROL expects a withheld line, and after --clear-all no file exists.

# M5 (RP8's card line, over the verb's bytes): the hook's ASCII trim of recall-off/<id> removed, so the verb's LF
# reaches the grammar test and every verb-written file withholds. B2's hand-planted C68 file had no LF.
# session-hook.test.ts's C19/C68 parity rows plant LF-terminated files too, so they red under M5 as well (12 failed, measured).
mut ccd/session-hook.sh 'o="${o#"${o%%[!$ws]*}"}"; o="${o%"${o##*[!$ws]}"}"' ':'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'RP8 end to end \(W2-D32\)')
cp "$SCRATCH/hook.orig" ccd/session-hook.sh
# Expected RED (predicted): "RP8: the new family gets its card line": expected '…' to contain 'History: node …'.

# M6 (RP10's CONTROL, C68's card half over the verb's bytes): the hook ignores the control arm.
mut ccd/session-hook.sh '[[ "$o" == "$gen" ]] && return 0' '[[ "$o" == "never" ]] && return 0'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'RP10 the W2 close step|RP8 end to end \(W2-D32\)')
cp "$SCRATCH/hook.orig" ccd/session-hook.sh
# Expected RED (predicted): 1 failed | 1 passed. RP10: "claude-a-demo: no card line while its file names its generation":
# expected '…History: node …' not to contain 'History: node '. RP8 stays green (its file is stale).

# M7 (C66 W2 half): no idOk test on the recall-off id, at both places Task 3's verb relies on: parseOpVerbArgs' recall-off
# case (both doors parse with it) and recallOffPath's own test.
mut ccd/history/lib.mjs "      if (!idOk(id)) return refuse('bad-id');" "      if (!Boolean(id)) return refuse('bad-id');"
mut ccd/history/lib.mjs '  if (!idOk(id)) throw new TypeError(`recallOffPath: not a session id' '  if (!Boolean(id)) throw new TypeError(`recallOffPath: not a session id'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C66 W2 half')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): "../x --clear": any answer but [ 2, 'bad-id' ] (the clear form reaches recall-off/../x, the
# victim, a regular file, and unlinks it).

# M8 (C67 W2 half): unreadable no longer decides generation-unreadable (decideRecallOffWrite's first test, Task 3's).
mut ccd/history/lib.mjs "  if (registry.state !== 'absent' && registry.state !== 'value') return refuse('generation-unreadable');" "  if (registry.state === 'never') return refuse('generation-unreadable');"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C67 W2 half')
cp "$SCRATCH/lib.orig" ccd/history/lib.mjs
# Expected RED (predicted): the first form, `claude-a-demo`: any answer but [ 2, 'generation-unreadable' ] (the unreadable
# read falls through to a value it does not hold, and the pass throws).

# M9 (RP10): --clear-all counts each entry but unlinks none (the arm's one unlink, in recallOffPass).
mut ccd/history/sweep.mjs '      unlinkSync(`${P.recallOffDir}/${n}`);
      cleared += 1;' '      cleared += 1;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'RP10 the W2 close step')
cp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs
# Expected RED (predicted): the summary still says three cleared, so "RP10: none left" reds: the three ids are still listed
# where [] is expected.

cmp "$SCRATCH/measure.orig" deploy/measure-history.py && cmp "$SCRATCH/sweep.orig" ccd/history/sweep.mjs \
  && cmp "$SCRATCH/lib.orig" ccd/history/lib.mjs && cmp "$SCRATCH/hook.orig" ccd/session-hook.sh && echo restored
git status --porcelain deploy/measure-history.py ccd/history/sweep.mjs ccd/history/lib.mjs ccd/session-hook.sh
```

Expected: `restored`, and no `git status` line for the four files. Then run Step 3's first command again: `4 passed`.

Which case each mutant must red:

| Mutant | Guard | Must red | Must stay green |
|---|---|---|---|
| M1 | `measure-history.py` calls query, the generation filter (W2-3) | RP8 | — |
| M2 | the drain's stale count (`sweep.mjs`, B2) | RP8, `C68 (CLI half)` | — |
| M3 | `decideRecallOff`'s stale arm (`lib.mjs`, B2) | RP8, `C68 (CLI half)` | — |
| M4 | the hook serves a stale file (B3) | RP8 | RP10 |
| M5 | the hook's ASCII trim, over the verb's LF (B3) | RP8 | — |
| M6 | the hook withholds a file naming the generation (B3) | RP10 | RP8 |
| M7 | idOk before any recall-off path (B2, Tasks 2 and 3) | C66 W2 half | — |
| M8 | unreadable is not absent (B2, Task 3; W2-D27) | C67 W2 half | — |
| M9 | `--clear-all` unlinks (Task 3; W2-D28) | RP10 | — |

- [ ] **Step 6: Run the neighbours.** In the foreground, one per tool call, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected green (predicted):
- `history-recall`: the count at Task 4's commit plus 4.
- `measure-history`: its count at Task 4's commit, unchanged. This task touches neither the script nor that file.
- `single-definition -t 'ccrc history'`: unchanged. The O13 writer scan (W2-D29) reads shipped files: this task adds no recall-off write to any file, and its test writes none by hand.
- tsc: no line names `history-recall.test.ts`. A line that names only `agent/src/` (the `ws` module) or `test/workflow-yaml-parses.test.ts` (the `yaml` module) comes from the worktree's install, not this task.

- [ ] **Step 7: Commit.**

```bash
git add server/test/history-recall.test.ts
git commit -m "test(history): RP8 end to end, RP10, and C66, C67 and C68 re-run over the shipped recall-off verb (W2-1 Task 5; W2-D32)"
```

Record in the commit body each mutant's measured red line from Step 5 (each of the nine), and any re-anchoring that Step 1 or Step 5 needed. This task defines no D-number and cites none.

---

### Task 6: the spec errata, the departures W2-1 defines, the whole-PR checks and the PR

W2-1 holds the spec path for W2's fleet lane, and it is the first holder after W2-3 (#856) and W2-4 (#826) merged, so it amends in place every rev 3.6 sentence that W2-1, W2-3 and W2-4 changed (W2-D3; decisions §6). Thirteen errata name W2-1 in their "Amended by" column: E1, E3, E4, E5, E6, E12, E13, E14, E15, E16, E17, E18 and E26. R6 adds three more, amended in place by W2-1 with no number: §9.4's "Lands in" cells for `history-recall-off` and `history-replay-out` (`W2-1`, `W2-4`), §8.8's failure-table row for the `recall-off` generation (its two new words, under E4) and §9.14's "What it holds" (the `recall-off` journal kind). This task writes all of them in one commit, each as its own replacement inside its own line(s), each sentence citing its D-number where §6 gives one. It adds no code, no test and no guard. It then runs the whole-PR checks, writes the PR body and opens the PR.

This plan defines five departures, all in "## Deviations found" at its end, written with the plan: **D-5763** (`history-w2-recall-off-no-dry-run`, W2-D26) and **D-5764** (`history-w2-recall-off-generation-checks`, W2-D27), which §6's "Defined in" column gives W2-1 and whose entries name Task 3 (R6), and **D-6238**, **D-6239** and **D-6240**, found while planning (R1, R3, R4). This task checks each is there once and never adds a second. Its spec sentences cite D-5763 and D-5764; every other number they cite is cited bare: D-5770, D-5771, D-5772, D-5773, D-5774 and D-5775 are defined in W2-3's plan, and D-5748 in 5h-2's.

**Not this task's errata, never touched here.** W2-5b amends E2 (the same exit-2 row as E1, later), E7, E8, E9, E10, E11, E19, E20, E21, E22, E23 and E24; W2-6 amends E25 (W2-D3). The '87 B → 86 B' correction of the `history-store-id` row (E6's note) was 5h-2's Task 4, and is on `main` (#1010). Step 3's script asserts that each of those sentences is still there, unchanged.

**Files:** (anchors measured at `02d75ae5f`; every one is re-anchored by its quoted content, and the script asserts each anchor occurs exactly once)
- Modify: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, in place, one replacement per erratum part, none adding or removing a line:
  - **E1**, §8.3's exit table, the exit 2 row (about :1671 at 02d75ae5f): after `` `generation-unreadable`, `` and before `` `writer-absent`, ``. E2 (W2-5b) edits this row later, which is why the replacement is the smallest span that holds the new words;
  - **E5**, §8.4's `status` paragraph, the bullet that begins `- Since rev 3.1 it also reports the durability state` (about :1737): one sentence appended after `` and `recovering` with its cursor while a recovery step runs. ``;
  - **E3**, §8.4's operator-verbs bullet `- Dry run by default.` (about :1742). The bullet below it, the operator relay, is 5h-2's (D-5747, D-6069) and is not touched;
  - **E4**, §8.4's operator-verbs line, `` **Operator verbs**: `import`, `prune`, `doctor [`…`]`, `reparse`, and in W2 `recall-off <id> [--clear]` and `recall-off --clear-all`. `` (about :1741): its `recall-off <id> [--clear]` becomes `recall-off <id> [--generation <uuid>] [--clear]`, the grammar E4a gives the bullet, so §8.4 states one grammar. Then §8.4's two `recall-off` bullets (about :1799 and :1800): the head of `- **`recall-off <id>`** writes or `--clear`s …`, one passage appended after its last sentence (`… (rev 3.2 review, IV5).`), and one passage appended to `- **`recall-off --clear-all`** removes …`;
  - **E6**, §9.4's `history-recall-off` row (about :2170): its root, collector and tier cells, and (an added erratum, R6) its `Lands in` cell, `W2` to `W2-1`. The `history-store-id` row (about :2163) is checked, never written;
  - **added (R6)**, §9.4's `history-replay-out` row (about :2172): its `Lands in` cell, `W2` to `W2-4`;
  - **added under E4 (R6)**, §8.8's failure table, the `recall-off` generation row (about :1922): `generation-malformed` and `generation-mismatch` beside `generation-unreadable`, citing D-5764;
  - **added (R6)**, §9.14 "What it holds", the `tick` bullet (about :2503): one sentence naming the `recall-off` kind;
  - **E13**, §9.11's O32 row (about :2446), and §10.2 "The instruments", the bullet `  - It never classifies a model. …` (about :2636);
  - **E14**, §9.11's O52 row (about :2466), and §10.7's W2 row, its data-source cell (about :2907);
  - **E12**, §10.2 "The instruments", the bullet `  - It opens one node's DB `?mode=ro` …` (about :2634), its first sentence only; and "The queries", its head (about :2746) and its bullet `  - **the W2 window statistic**: …` (about :2749);
  - **E17**, §10.2 "Questions", the sentence `Each asks for an exact fact F (…) that is present only *before* the compaction.` (about :2650);
  - **E26**, §10.2's spawn flag list, the item `  - `--output-format stream-json`;` (about :2684);
  - **E18**, §10.2 "Account and budget", the sentence ending `and stops at a stated threshold: the one `~/.cc-limits` read in this spec (§5.2).` (about :2709);
  - **E16**, §10.2 "The live A/B", its first sentence (about :2739), and "What the analysis counts", its `''` sentence (about :2744);
  - **E15**, §13's `- **Single definition.**` bullet (about :3063), its first sentence.
- Read, no edit: this plan's `## Deviations found` (its five entries, written with the plan); `README.md`'s `### Session history: lossless recall (`ccrc history`)` section (about :5664), whose `recall-off` text is Task 3's (R3); `shared/lifecycle.ts`'s `history-recall-off` row and `server/test/lifecycle.test.ts`'s `HISTORY_LANDED` (W2-D9, Task 3's); `CLAUDE.md`.
- Create (gitignored scratch, never committed): `.superpowers/sdd/history-w2-1/t6-errata.py` and `.superpowers/sdd/history-w2-1/pr-body.md`.
- Never edited by this task or this PR: `deploy/history-replay.mjs`, `server/test/history-replay.test.ts`, `.github/workflows/*`, the programme ledger, and any spec sentence outside the thirteen errata.

**Interfaces:**
- Consumes (names this task's sentences state; Step 1 checks each exists, and this task never defines one):
  - `ccd/history/lib.mjs`: `export function isSyntheticModel(model)` (W2-D17), `export const RECALL_OFF_META = 'recall_off:'` (W2-D23, W2-D30), `REASONS['generation-malformed'] === EXIT.REFUSED` and `REASONS['generation-mismatch'] === EXIT.REFUSED` (exit 2, W2-D27), `JOURNAL_KINDS` holding `'recall-off'` (W2-D30), `historyPaths(home).recallOffDir` and `.headlessOn` (W2-D29);
  - `deploy/history-gate.mjs`: imports `isSyntheticModel` and `RECALL_OFF_META` from lib, and no longer declares `isSyntheticLocal` or `RECALL_OFF_PREFIX_LOCAL` (W2-D17, W2-D23); `buildWindows`, `windowCopyOf`, `producerCopyOf`, `turnsOf`, `K_UNIT = 'assistant-turns'` and `ROW_CAP`, as W2-3 shipped them (unchanged);
  - `deploy/history-replay.mjs` (read only): `spawnArgv`'s `'--verbose'`, `decideLimits`' `limits-stale` and `limits-threshold`, `decideBudget`'s `budget-exhausted` and `LIMITS_DEFAULTS` (`threshold_pct: 70`, `max_age_ms: 3_600_000`), as W2-4 shipped them;
  - `deploy/measure-history.py`: the `recall_off:` raw rows (W2-D23);
  - `ccd/history/cli.mjs`: `status --json`'s `recall_off: {seen_ms, files, unreadable}` (W2-D31);
  - `shared/lifecycle.ts`: the `history-recall-off` row naming `~tmp.<pid>` (W2-D9, W2-D28);
  - this plan's D-5763, D-5764, D-6238, D-6239 and D-6240, each defined once in "## Deviations found".
- Produces: text only. The thirteen errata and R6's three added ones in the spec; the PR body file; the PR.

**Spec:** §8.3 (exit table), §8.4 (status, operator verbs, `recall-off`), §8.8 (failure table), §9.4 (`history-recall-off`, `history-replay-out`), §9.11 (O32, O52), §9.14 (journal kinds), §10.2 (instruments, questions, flags, account and budget, live A/B, queries), §10.7 (W2 row), §13 (single definition). D-5763 (E3, E4) and D-5764 (E1, E4) are W2-1's; D-5770 (E12, E14), D-5771 (E12), D-5772 (E13), D-5773 (E16), D-5774 (E15) and D-5775 (E17) are W2-3's, cited bare; E5, E6, E18 and E26 take no number (§6), and neither do R6's added errata, except that the §8.8 row, under E4, cites D-5764.

**Choices this task makes:**
- **One script, one commit, every line kept.** Every replacement sits inside its own line (E4's two bullets are two adjacent lines), so the spec's line count does not move and no citation below an edit moves. The script edits in memory and writes once, at the end, so a failed anchor writes nothing. E5 (about :1737), E4's operator-verbs line (about :1741) and E3 (about :1742) lie within six lines of each other, so `git diff` prints them as one hunk; they remain three replacements, each asserted on its own anchor.
- **Each sentence states the shipped code.** E12's window rule is read from W2-3's `windowOf` and `turnsOf` (the summary-past-the-next-boundary and null-model clauses included); E18's stop list from W2-4's `decideLimits` and `decideBudget`, which refuse a few more rows than W2-D55 names (a percentage outside 0 to 100, a null `ts`, a `ts` ahead of the clock), so the sentence names them; E26 from `spawnArgv`. A sentence that disagrees with the code at the worker's base is a finding against the task or PR that owns the code: report it, never edit the code here.
- **The two `Lands in` cells read `W2-1` and `W2-4` (R6).** `lifecycle.test.ts` keys the rows `'W2-1'` and `'W2-4'` since W2-4's split (W2-D9), and W2-1 is the last fleet PR to hold the spec before W2-5b, so it amends both cells; O17 reads the column per PR.
- **§9.14 gains the kind on the `tick` bullet's line (R6).** A bullet of its own would add a line; one sentence appended to the last kind's line keeps the line count.
- **E12 also names `w2.recall_off`**, the raw `recall_off:` rows measure-history.py emits from this PR in families mode (W2-D23; R2), so the instruments sentence lists every raw row it prints; E13's O32 row names `isSyntheticModel` as `backendOf`'s synthetic test (W2-D17), because both ship in this PR and the row is the one-backend-rule pin.
- **No §16 rows and no §17 line.** 5h-1 and 5h-2 defined their departures in their plans and added no §16 row; §17 holds no line for 5h-1 or 5h-2 at `02d75ae5f`. Step 4 measures §17, and a line found there is reported to the coordinator, never written here.
- **README is Task 3's (R3).** The decisions list README (the verb) among W2-1's files; this task only checks, in Step 1, that the section names `recall-off`. A miss is reported against Task 3.

- [ ] **Step 1: Measure what the text will state.** Before the first edit of the spec, read `GET /api/claims?project=ccrc-pwa`: only 5h-1, 5h-2, W2-1, W2-5b and W2-6 claim the spec (W2-D3), and no other run may hold it now. Then, from the repository root:

```bash
for f in isSyntheticModel stampAtOrBefore; do printf '%s %s\n' "$f" "$(grep -cE "^export function $f\(" ccd/history/lib.mjs)"; done
grep -nE "^export const RECALL_OFF_META = 'recall_off:';$" ccd/history/lib.mjs | cut -d: -f1
node -e "import('./ccd/history/lib.mjs').then((l)=>{console.log('malformed', l.REASONS['generation-malformed'], 'mismatch', l.REASONS['generation-mismatch'], 'refused', l.EXIT.REFUSED); console.log('journal', l.JOURNAL_KINDS.includes('recall-off')); const p=l.historyPaths('/home/u'); console.log('paths', p.recallOffDir, p.headlessOn)})"
grep -cE "isSyntheticModel|RECALL_OFF_META" deploy/history-gate.mjs
grep -cE "isSyntheticLocal|RECALL_OFF_PREFIX_LOCAL" deploy/history-gate.mjs
grep -c "'--verbose'" deploy/history-replay.mjs
grep -nE "threshold_pct: 70, max_age_ms: 3_600_000" deploy/history-replay.mjs | cut -d: -f1
grep -c "recall_off" deploy/measure-history.py
grep -c "recall_off" ccd/history/cli.mjs
grep -c '~tmp.<pid>' shared/lifecycle.ts
grep -nE "^  const HISTORY_LANDED: readonly HistoryPr\[\] = \[.*'W2-1'.*\];$" server/test/lifecycle.test.ts | cut -d: -f1
sed -n '/^### Session history: lossless recall/,/^---$/p' README.md | grep -c 'recall-off'
PLAN=$(ls docs/superpowers/plans/*-ccrc-history-w2-1-*.md); echo "$PLAN" | wc -l
for d in D-5763 D-5764 D-6238 D-6239 D-6240 D-6241; do printf '%s %s\n' "$d" "$(grep -c "^- \*\*$d\*\* — " "$PLAN")"; done
grep -cE '^- \*\*D-[0-9]+\*\* — ' "$PLAN"
```

Expected:
- `isSyntheticModel 1` and `stampAtOrBefore 1`; one line number for `RECALL_OFF_META`;
- `malformed 2 mismatch 2 refused 2`, `journal true`, `paths /home/u/.ccrc/history/recall-off /home/u/.ccrc/history/headless-on` (the node line reads only: importing lib runs no I/O);
- the gate's count of the two lib names at least `2`, then `0` for the two temporary local spellings;
- `--verbose` at least `1`; one line number for `LIMITS_DEFAULTS`' two values;
- `recall_off` at least `1` in `measure-history.py` and at least `1` in `cli.mjs`; `~tmp.<pid>` at least `1` in `lifecycle.ts`; one line number for `HISTORY_LANDED` holding `'W2-1'`;
- README's history section: at least `1`;
- `1` (exactly one W2-1 plan), then `D-5763 1`, `D-5764 1`, `D-6238 1`, `D-6239 1`, `D-6240 1` and `D-6241 1`, then `6`: the plan defines those six numbers and no other.

A name, a value or an entry that is missing or differs is a finding against the task that owns it: report it to the coordinator, and never write it here. The sentences Step 3 writes state only what these measurements show.

- [ ] **Step 2: Write the errata script, and run its CONTROL.** From the repository root, write the script (a quoted heredoc, so nothing in it is expanded):

```bash
mkdir -p .superpowers/sdd/history-w2-1
cat > .superpowers/sdd/history-w2-1/t6-errata.py <<'EOF'
import sys
ARGS = sys.argv[1:]
CHECK = '--check' in ARGS
PATHS = [a for a in ARGS if a != '--check']
SPEC = PATHS[0] if PATHS else 'docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md'
s0 = open(SPEC, encoding='utf8').read()
s = s0
def sub(tag, old, new):
    global s
    n = s.count(old)
    assert n == 1, (tag, 'anchor count', n, old[:80])
    assert '\n' not in old.rstrip('\n') and '\n' not in new.rstrip('\n'), (tag, 'one line only')
    s = s.replace(old, new)
    print('edited', tag)
# E1: section 8.3's exit table, the exit 2 row (D-5764). E2 (W2-5b) edits the same row later.
sub('E1 exit-2 row',
"""`harness-unreadable`, `generation-unreadable`, `writer-absent`,""",
"""`harness-unreadable`, `generation-unreadable`, `generation-malformed` and `generation-mismatch` (`recall-off`'s generation checks, §8.4; W2-1, D-5764), `writer-absent`,""")
# E5: section 8.4's status, the recall_off block (no number)
sub('E5 status recall_off',
"""and `recovering` with its cursor while a recovery step runs.
""",
"""and `recovering` with its cursor while a recovery step runs. Since W2-1 it also reports `recall_off: {seen_ms, files, unreadable}`, and one human line for it, read from the sweep's per-tick presence record of `recall-off/` (meta rows under `RECALL_OFF_META`, `recall_off:`; no schema change): `seen_ms` is when the last complete observation of the directory started, `null` before the first, `files` counts the files that observation recorded present and `unreadable` those of them it could not read. It is additive and identity-free, and the operator's pre-window check reads it.
""")
# E3: section 8.4's "Dry run by default" names the forms it covers (D-5763)
sub('E3 dry run',
"""- Dry run by default.
""",
"""- Dry run by default for `import`, `prune` and `reparse`, which write only with `--apply`. The `doctor` flags write as invoked, and so do `recall-off`'s three forms, `recall-off <id>`, `recall-off <id> --clear` and `recall-off --clear-all`, as RP8, RP10 and §10.6's close step need them to (W2-1, D-5763).
""")
# E4: section 8.4's operator-verbs list states the same grammar as the bullet below (no number here: that bullet cites
# D-5763 and D-5764)
sub('E4 verbs list',
"""`reparse`, and in W2 `recall-off <id> [--clear]` and `recall-off --clear-all`.""",
"""`reparse`, and in W2 `recall-off <id> [--generation <uuid>] [--clear]` and `recall-off --clear-all`.""")
# E4 (a): recall-off <id>'s grammar (D-5763)
sub('E4a recall-off grammar',
"""- **`recall-off <id>`** writes or `--clear`s `~/.ccrc/history/recall-off/<id>`, through the shim.""",
"""- **`recall-off <id> [--generation <uuid>] [--clear]`** writes or `--clear`s `~/.ccrc/history/recall-off/<id>`, through the shim, as invoked (D-5763).""")
# E4 (b): the generation checks and the writer's temp (D-5764)
sub('E4b generation checks',
"""silently put a pre-registered control family in the treatment arm (rev 3.2 review, IV5).
""",
"""silently put a pre-registered control family in the treatment arm (rev 3.2 review, IV5). **The generation checks** (W2-1, D-5764) are decided under the lock, before any write, on `.generation` with one trailing LF trimmed: an absent or empty file writes `''` without `--generation`, and with it refuses exit 2 `generation-mismatch`; a UUID is written without `--generation`, and with `--generation G` only when it equals G, else `generation-mismatch`; any other content refuses exit 2 `generation-malformed`, with the flag or without it. `--generation` takes only a lowercase UUID (else `bad-args`), and only on the write form; the W2 flow always passes it, so it never writes a legacy `''` control file. The writer creates `recall-off/` with mode 0700 and follows no link. It writes the generation and one LF, or an empty file for `''`, with mode 0600, through the temp `recall-off/~tmp.<pid>` (opened `O_CREAT|O_EXCL|O_NOFOLLOW`; `~` is outside the id grammar, so no reader takes it for an id), then renames it within the directory; at start, under the lock, it removes every `~tmp.*` entry, each of which is stale. A history root that is not a directory, or a `recall-off/` that is a link or not a directory, refuses every form with exit 1 and one line, before any write. `--clear` unlinks the one entry without following it; a missing entry is rc 0, and an entry that is neither a regular file nor a symlink is left, rc 1, with a line naming it. The pass opens no store: the sweep records the file through its per-tick presence record (`status`, above).
""")
# E4 (c): --clear-all skips non-regular entries and reports them
sub('E4c clear-all',
"""through the shim: the W2 close step (§10.6; rev 3.2 review, IV15).
""",
"""through the shim: the W2 close step (§10.6; rev 3.2 review, IV15). It lstats every entry, whatever its name, unlinks regular files and symlinks without following them, skips directories, FIFOs, sockets and devices, and prints `{rc, reason, cleared, skipped: [names]}`, `cleared` a count, on its own line before its result; at close the operator checks that `skipped` is empty and removes by hand anything it names (W2-1).
""")
# E6: section 9.4's history-recall-off row, the writer's temp (no number). The history-store-id row is 5h-2's (D-5748).
sub('E6 lifecycle row',
"""| `history-recall-off` | `~/.ccrc/history/recall-off/<id>` | O | `sweep.mjs --op recall-off` | `ccrc history recall-off <id> --clear`, `recall-off --clear-all` at W2 close (operator verbs through the shim, §10.6) or `rm` | one generation (≤40 B) per file | W2 |""",
"""| `history-recall-off` | `~/.ccrc/history/recall-off/<id>`, and the writer's temp `recall-off/~tmp.<pid>` while one is written (W2-1) | O | `sweep.mjs --op recall-off` | `ccrc history recall-off <id> --clear`, `recall-off --clear-all` at W2 close (operator verbs through the shim, §10.6) or `rm`, which also removes an entry `--clear-all` skipped as neither a regular file nor a symlink. A temp is stale whenever the verb takes the lock, because only the verb holding it writes one: the verb removes every `~tmp.*` entry when it starts (§8.4) | one generation (≤40 B) per file; a temp is one file's size until the next `recall-off` | W2-1 |""")
# Added (R6): section 9.4's history-replay-out row, its Lands in cell (no number)
sub('added history-replay-out lands in',
"""| one W2 run's transcripts and scores | W2 |""",
"""| one W2 run's transcripts and scores | W2-4 |""")
# Added under E4 (R6): section 8.8's failure-table row for the recall-off generation (D-5764)
sub('added 8.8 generation row',
"""| `recall-off` generation | `.generation` exists but cannot be read | exit 2 `generation-unreadable`; nothing written (§8.4) |""",
"""| `recall-off` generation | `.generation` exists but cannot be read; holds neither nothing nor one generation; or is not the generation `--generation` names | exit 2 `generation-unreadable`, `generation-malformed` or `generation-mismatch`, decided in that order under the lock; nothing written (§8.4; W2-1, D-5764) |""")
# Added (R6): section 9.14 What it holds, the recall-off journal kind (no number)
sub('added 9.14 recall-off kind',
"""- `tick`: the tick's time and `lag_ms`, so the W2 lag series survives.
""",
"""- `tick`: the tick's time and `lag_ms`, so the W2 lag series survives. Since W2-1, `recall-off`: one change or gap row of the sweep's `recall-off/` presence record (§8.4 `status`), keyed by `rk` and carrying an id, its states (a generation, a `sha256:` digest of any other content, or unreadable) and times, never a file's text, so replay rebuilds the change, gap and state rows without reading the directory; `seen_ms` is never replayed. `JOURNAL_V` stays 1, so a build without the kind skips each record and counts it.
""")
# E13: O32, the no-classification pin (D-5772)
sub('E13 O32 row',
"""(`claude`, `startswith`, `<synthetic>`); it reads `<counter>:<backend>` rows only. `backendOf` is the one classifier |""",
"""(`claude`, `startswith`, `<synthetic>`) and no comparison or membership test on a value named `model` or `models` (the no-classification pin): it reads `<counter>:<backend>` rows for counters and prints `entries.model` strings raw for W2's windows, which Node folds through `producerOf` (W2-3, D-5772). `backendOf` is the one classifier, and its synthetic-row test is `lib.mjs`'s `isSyntheticModel`, which `deploy/history-gate.mjs` imports (W2-1) |""")
# E14 (a): O52 re-pinned against the Node builder (D-5770)
sub('E14a O52 row',
"""W1-b's and W1-f's p95 and the W2 window statistic, computed from fixture rows by the queries §10.2 names, equal hand-computed values |""",
"""W1-b's and W1-f's p95, computed from fixture rows by the queries §10.2 names, equal hand-computed values; the W2 window statistic, built in Node by `deploy/history-gate.mjs`'s `buildWindows` from `measure-history.py`'s raw rows over the same fixture, equals hand-computed totals (windows, windows with a call, calls, turns and unmeasured windows; W2-3, D-5770) |""")
# E12 (a): section 10.2 "The instruments": raw rows (D-5770)
sub('E12a instruments',
"""  - It opens one node's DB `?mode=ro` and prints one JSON object of counters and of the queries below, headed by that store's `store_id`.""",
"""  - It opens one node's DB `?mode=ro` and prints one JSON object of counters, of W1's queries below and, for W2, of raw rows, headed by that store's `store_id` (W2-3, D-5770). For each listed family: its `arm IS NULL` calls, its merged `''` generations and its main boundaries in the window, and for each boundary every copy that holds it, with that copy's assistant rows after its summary row (each with its line, `ts_ms`, `msg_id`, `request_id`, uuid and model) up to a required `--row-cap`, `truncated` when the cap cut them, its next main boundary, and its `models`, every distinct model after the summary row to the copy's end, uncapped. Since W2-1 the same families-mode report also holds `w2.recall_off`, the sweep's raw `recall_off:` presence rows as `[k, v]` pairs ordered by `k`, unparsed. With `--census`, every family's census rows. The script spells neither K nor the turn rule: Node builds each window (below).""")
# E13: section 10.2's "Backend strata arrive already folded" (D-5772)
sub('E13 instruments',
"""  - It never classifies a model. Backend strata arrive already folded into counter names by the sweep (`<counter>:<backend>`, §6.2), so the backend rule is spelled once, in `lib.mjs` (pin O32).""",
"""  - It never classifies a model. A counter's backend stratum arrives already folded into its name by the sweep (`<counter>:<backend>`, §6.2); for W2's windows the script prints each `entries.model` string raw and never tests, compares or classifies one, and Node folds a window's producer through `lib.mjs`'s `producerOf` (W2-3, D-5772). So the backend rule is spelled once, in `lib.mjs` (pin O32).""")
# E17: section 10.2 Questions: decisions are not sourced (D-5775)
sub('E17 questions',
"""Each asks for an exact fact F (a command, path, SHA, error string or decision) that is present only *before* the compaction.""",
"""Each asks for an exact fact F (a command, path, SHA or error string) that is present only *before* the compaction. A decision is not sourced: nothing mines one mechanically, and no string match can score prose (W2-3, D-5775).""")
# E26: section 10.2 Flags: --verbose (no number)
sub('E26 flags',
"""  - `--output-format stream-json`;
""",
"""  - `--output-format stream-json`, with `--verbose`, which print mode needs for that format: every spawn's argv carries it, the question writer's and the judge's included, and step 0a records that it is accepted (W2-4; the coordinator's amendment of 2026-10-19);
""")
# E18: section 10.2 Account and budget: the limits row and the spend budget (no number)
sub('E18 limits and budget',
"""and stops at a stated threshold: the one `~/.cc-limits` read in this spec (§5.2).""",
"""and stops at a stated threshold: the one `~/.cc-limits` read in this spec (§5.2). It also stops on a row it cannot trust, each `limits-stale` (W2-4): absent, not a regular file, unreadable or malformed; `five` or `seven` null or outside 0 to 100; a value read as 0 only because of the row's age (only a `resetAt` fact counts as a reset); a null `ts`, a `ts` ahead of the clock, or one older than `limits.max_age_ms` (default 1 h). It stops `limits-threshold` when `max(five, seven)` is at or over `limits.threshold_pct` (default 70). And it stops `budget-exhausted` when its own cumulative stream-json usage under `--out` (input, cache creation, cache read and output tokens, over every writer, arm and judge spawn) reaches the budget in force: before part 1 of the open record a required `--budget`, with no default and refused before any spawn when missing; then part 1's `pilot_budget`; then part 2's `spend_budget`. The budget is a soft stop on admission: a run's spend lands when the run closes, so the ledger can end up to c whole runs past it, where c is the batch's concurrency.""")
# E16 (a): section 10.2 The live A/B: the active rule, legacy families excluded, W2 open (D-5773)
sub('E16a active',
"""is assigned by coin flip over the families active at W2 open on the named nodes, keyed (`store_id`, `ccrc_id`, `generation`).""",
"""is assigned by coin flip over the families active at W2 open on the named nodes, keyed (`store_id`, `ccrc_id`, `generation`). W2 open is each node's census instant T0. A family is active at it when it is unmerged and its generation is a UUID, it is its id's newest unmerged family (by `first_seen_ms`, then `session_pk`, the order the CLI resolves the newest family by), and a main transcript of one of its confirmed epochs has an entry in the look-back before T0 (7 days by default, signed in the open record). Legacy `''` families are never active, and that is fixed, not a default: a re-key mid-window would leave a legacy family's control file stale with no change row, and the W2 flow never writes a legacy control file (W2-3, D-5773).""")
# E16 (b): the '' mapping narrowed (D-5773)
sub('E16b merged',
"""A `''` family merged during the window is mapped to its generation through `merged_into`.""",
"""A `''` family a re-key has merged is mapped to the generation it merged into through `merged_into`: the census folds it into that family as a merged generation, and never lists it on its own (W2-3, D-5773).""")
# E12 (b): section 10.2 The queries: the window statistic is built in Node (D-5770, D-5771)
sub('E12b queries head',
"""- **The queries** (rev 3.2 review, FE2; slug `history-event-tables-v1`), each run by `measure-history.py` over one node's store:""",
"""- **The queries** (rev 3.2 review, FE2; slug `history-event-tables-v1`), each run by `measure-history.py` over one node's store, the W2 window statistic built in Node from its raw rows (W2-3, D-5770):""")
sub('E12c window statistic',
"""  - **the W2 window statistic**: for each main boundary of a listed family inside the window, its window is the first K = 10 assistant entries after its summary row in the copy that holds it; the window counts when a `recall_calls` row of that family (`ccrc_id`, generation), with a read verb and `arm IS NULL`, has a `ts_ms` from the boundary's `ts_ms` up to the 10th assistant entry's (or the copy's last row, when fewer). The per-turn rate divides the same calls by the window's assistant entries. The cluster bootstrap then runs over families.""",
"""  - **the W2 window statistic** (W2-3, D-5770; the copy rules, D-5771): for each main boundary of a listed family inside the window, the window copy is the copy holding the boundary with the most membership rows after it (W1's rule; ties go to lib's `pickHoldingCopy`), and the boundary's producer stratum reads `pickHoldingCopy`'s copy over its `models` (§6.2). K = 10 counts assistant **turns**: that copy's assistant rows after its summary row in file order, `<synthetic>` rows dropped (`isSyntheticModel`; a row with no model stays a turn), consecutive rows grouped by `msg_id`, else `request_id`, else uuid. The window opens at the boundary's `ts_ms`, inclusive, and ends, exclusive, at the earlier of turn 11's first row and the next main boundary's row in that copy; with neither, it ends, inclusive, at the copy's last timed row. It is `unmeasured`, excluded and counted, when its copy has no timed row, when its summary row lies past the next main boundary, or when the row cap cut the copy before turn 11's first row was seen, whether or not a next boundary exists. The window counts when a `recall_calls` row of that family (`ccrc_id`, generation), with a read verb and `arm IS NULL`, has a `ts_ms` inside it. The per-turn rate divides the same calls by the window's turns (at most K). The cluster bootstrap then runs over families.""")
# E14 (b): section 10.7's W2 row, its data source (D-5770)
sub('E14b acceptance W2 row',
"""| the driver's `--out`, `recall_calls` by §10.2's window query |""",
"""| the driver's `--out`; `recall_calls` as `measure-history.py`'s raw rows, windowed in Node by §10.2's window statistic (`deploy/history-gate.mjs`; W2-3, D-5770) |""")
# E15: section 13's single definition: ccd/history's vocabularies; the deploy files' words are local (D-5774)
sub('E15 single definition',
"""- **Single definition.** Every vocabulary is enumerated once in `lib.mjs`, pinned by the new end-appended describes over `.mjs` and bash.""",
"""- **Single definition.** Every `ccd/history` vocabulary is enumerated once in `lib.mjs`, pinned by the new end-appended describes over `.mjs` and bash. The W2 gate's and driver's words are local to their deploy files, each frozen once there and never a `REASONS` word, which stays the CLI's vocabulary: `GATE_REASONS`, `FACT_KINDS`, `LABELS`, `RUBRIC_IDS` and the gate's other closed sets in `deploy/history-gate.mjs`, and `DRIVER_REASONS` in `deploy/history-replay.mjs`; no `deploy/*.mjs` declares a name `lib.mjs` exports (W2-3, D-5774).""")
# Not this PR's errata: W2-5b's (E2, E7 to E11, E19 to E24) and W2-6's (E25). Each old sentence must still stand, untouched.
NOT_OURS = [
    ('E2 (W2-5b)', 'headless seam (`headless-unarmed`, `headless-in-pane`, `headless-unlisted`; W2), no identity'),
    ('E7 (W2-5b)', '<64 B each; `headless-on` one line per listed family'),
    ('E8 (W2-5b)', 'Otherwise the CLI reads `$REG/<id>.generation` read-only (rev 3, RG10)'),
    ('E9 (W2-5b)', 'Its content is the pre-registered list of admitted (`ccrc_id`, generation) pairs, one per line'),
    ('E10 (W2-5b)', '  - Uses are counted `scope_source=env`.'),
    ('E11 (W2-5b)', '  - `ASOF` makes every verb treat rows, nodes and epochs after that boundary as absent.'),
    ('E19 (W2-5b)', '**Answerability.** F must occur in a span row with searchable provenance, within the sidecar FTS window.'),
    ('E20 (W2-5b)', 'The question writer sees F and its span, and never either arm'),
    ('E21 (W2-5b)', 'The operator writes `headless-on` for the window, listing the quiz'),
    ('E22 (W2-5b)', '`correct`: the exact fact, matched by string;'),
    ('E23 (W2-5b)', '**Pre-registration.** Before the live window starts, the W2 open record holds:'),
    ('E24 (W2-5b)', 'The quiz can start once B2 is live, W2'),
    ('E25 (W2-6)', 're-discovery: the same file re-read within 10 assistant turns of a compaction (*chosen*);'),
]
for tag, t in NOT_OURS:
    assert s.count(t) == 1, (tag, 'not this PR\'s sentence moved or is not unique', s.count(t))
print('untouched', len(NOT_OURS))
assert s.count('\n') == s0.count('\n'), ('line count moved', s0.count('\n'), s.count('\n'))
for d in ['D-5763', 'D-5764', 'D-5770', 'D-5771', 'D-5772', 'D-5773', 'D-5774', 'D-5775']:
    print(d, s0.count(d), '->', s.count(d))
if not CHECK:
    open(SPEC, 'w', encoding='utf8').write(s)
    print('wrote', SPEC)
else:
    print('check only: nothing written')
EOF
```

Then show that it refuses a moved anchor before it touches the real file. The CONTROL is a copy of the spec whose E3 line has moved; the script must stop at that anchor and write nothing:

```bash
SPEC=docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
mkdir -p .superpowers/sdd/history-w2-1/scratch
sed 's/^- Dry run by default\.$/- Dry run by default (moved)./' "$SPEC" > .superpowers/sdd/history-w2-1/scratch/spec-control.md
python3 -I .superpowers/sdd/history-w2-1/t6-errata.py --check .superpowers/sdd/history-w2-1/scratch/spec-control.md; r=$?; echo "rc $r"
python3 -I .superpowers/sdd/history-w2-1/t6-errata.py --check; r=$?; echo "rc $r"
git status --short "$SPEC" | wc -l
```

Expected (both runs measured on a copy of `02d75ae5f`): the first run prints `edited E1 exit-2 row` and `edited E5 status recall_off`, then `AssertionError: ('E3 dry run', 'anchor count', 0, '- Dry run by default.\n')` and `rc 1`. The second run prints twenty-four `edited` lines (E1, E5, E3, E4 verbs list, E4a, E4b, E4c, E6, the three added ones, E13 O32, E14a, E12a, E13 instruments, E17, E26, E18, E16a, E16b, E12b, E12c, E14b, E15), `untouched 13`, then the counts `D-5763 0 -> 2`, `D-5764 0 -> 3`, `D-5770 0 -> 5`, `D-5771 0 -> 1`, `D-5772 0 -> 2`, `D-5773 0 -> 2`, `D-5774 0 -> 1` and `D-5775 0 -> 1`, then `check only: nothing written` and `rc 0`. Then `0`: the spec is untouched. A failed assertion on the real file names its tag: an anchor that moved on `main` is re-anchored by its content in the script, with the new sentence unchanged; an `untouched` failure means another PR edited a sentence W2-5b or W2-6 owns, which is reported to the coordinator, never rewritten here.

- [ ] **Step 3: Amend the spec.** From the repository root:

```bash
SPEC=docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
wc -l < "$SPEC"
grep -cE '(lib|cli|sweep|store|derive|recall)\.mjs:[0-9]' "$SPEC"
python3 -I .superpowers/sdd/history-w2-1/t6-errata.py; r=$?; echo "rc $r"
wc -l < "$SPEC"
grep -cE '(lib|cli|sweep|store|derive|recall)\.mjs:[0-9]' "$SPEC"
rm -r .superpowers/sdd/history-w2-1/scratch
```

Expected: the line count (3563 at `02d75ae5f`) and the `file.mjs:N` count (2 at `02d75ae5f`); then the same twenty-four `edited` lines, `untouched 13`, the same eight count lines, `wrote docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` and `rc 0`; then the same line count and the same `file.mjs:N` count (no new sentence cites a line).

- [ ] **Step 4: Check what stands after the edit.** From the repository root:

```bash
SPEC=docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
python3 - <<'EOF'
SPEC = 'docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md'
s = open(SPEC, encoding='utf8').read()
def row(prefix):
    rows = [l for l in s.split('\n') if l.startswith(prefix)]
    assert len(rows) == 1, (prefix, len(rows))
    return rows[0]
# 5h-2's history-store-id row (D-5748 and the 86 B erratum): checked, never written here
r = row('| `history-store-id` |')
for t in ['`op` (about 77 B, at most 119 B; W5h-2, D-5748)', '`pass` (about 70 B, at most 86 B)']:
    assert t in r, ('history-store-id', t)
assert 'at most 87 B' not in r
# every W2-1 erratum's old wording is gone
for gone in ['- Dry run by default.\n', 'each run by `measure-history.py` over one node\'s store:\n',
             'its window is the first K = 10 assistant entries after its summary row',
             'Backend strata arrive already folded into counter names by the sweep',
             'a command, path, SHA, error string or decision', 'Every vocabulary is enumerated once in `lib.mjs`',
             'A `\'\'` family merged during the window', '`recall_calls` by §10.2\'s window query',
             '`recall-off <id> [--clear]`']:
    assert gone not in s, ('old wording left', gone[:60])
# the exit 2 row holds both words, beside the shipped one, and E2's words are W2-5b's
r = row('| 2 | refused:')
for t in ['`generation-unreadable`', '`generation-malformed`', '`generation-mismatch`', 'D-5764']:
    assert t in r, ('exit 2 row', t)
assert 'asof-invalid' not in r and 'headless-malformed' not in r and 'headless-arm-unknown' not in r
# R6's added errata: the two Lands in cells, the section 8.8 row, the section 9.14 kind
assert row('| `history-recall-off` |').endswith('| W2-1 |'), 'history-recall-off Lands in'
assert row('| `history-replay-out` |').endswith('| W2-4 |'), 'history-replay-out Lands in'
r = row('| `recall-off` generation |')
for t in ['`generation-unreadable`', '`generation-malformed`', '`generation-mismatch`', 'D-5764']:
    assert t in r, ('section 8.8 row', t)
assert row('- `tick`: ').count('`recall-off`') == 1, 'section 9.14 kind'
print('checked')
at = s.find('\n## 17. Revision history')
assert at != -1, 'no §17 heading'
print('§17 lines naming 5h-1, 5h-2 or W2-1:', len([l for l in s[at:].split('\n') if '5h-1' in l or '5h-2' in l or 'W2-1' in l]))
EOF
git diff --stat -- "$SPEC"
```

Expected: `checked`, then `§17 lines naming 5h-1, 5h-2 or W2-1: 0`, then one file changed with the same number of insertions and deletions (measured on a copy of `02d75ae5f`: 23 lines changed, `23 insertions(+), 23 deletions(-)`: E4 and E12 three lines each, E13, E14 and E16 two each, E1, E3, E5, E6, E15, E17, E18 and E26 one each, and R6's three added lines, the `history-replay-out` row, §8.8's row and §9.14's `tick` bullet, one each; E6's line also holds its `Lands in` cell). A §17 count other than 0 is reported to the coordinator, who rules whether this PR adds a §17 line; this task writes none.
- No test reads the spec's errata sentences: the history tests name the spec only in header comments, by section. `docs-policy`, `topology-clean` and `deviation-refs` read the docs tree, and Step 7 runs them.

- [ ] **Step 5: Commit the spec.**

```bash
git add docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
git commit -m "docs(history): spec errata for W2-1, W2-3 and W2-4, amended in place (W2-1 Task 6; W2-D3, D-5763, D-5764, D-6241)"
```

- [ ] **Step 6: Check that the PR holds only W2-1's files.** From the repository root:

```bash
git fetch origin main
git diff --name-only origin/main...HEAD | grep -vxF -f <(printf '%s\n' \
  ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs ccd/history/cli.mjs ccd/history/derive.mjs \
  ccd/history/recall.mjs deploy/history-gate.mjs deploy/measure-history.py shared/lifecycle.ts README.md \
  docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md \
  docs/superpowers/plans/2026-10-21-ccrc-history-w2-1-recall-off-and-exports.md \
  server/test/history-op.test.ts server/test/history-recall.test.ts server/test/history-lib.test.ts \
  server/test/history-recover.test.ts server/test/history-sweep.test.ts server/test/history-cli.test.ts \
  server/test/measure-history.test.ts server/test/single-definition.test.ts server/test/lifecycle.test.ts) \
  || echo 'only W2-1 files'
git diff --name-only origin/main...HEAD -- deploy/history-replay.mjs server/test/history-replay.test.ts .github/workflows | wc -l
git diff --name-only --diff-filter=A origin/main...HEAD | wc -l
for n in $(git diff origin/main...HEAD -- ccd/history/lib.mjs | sed -nE 's/^\+export const ([A-Z_][A-Z0-9_]*) = .*/\1/p' | sort -u); do
  git show origin/main:ccd/history/lib.mjs | grep -qE "^export const $n = " && continue
  grep -qw "'$n'" server/test/single-definition.test.ts && echo "bound $n" || echo "UNBOUND $n"; done
git diff origin/main...HEAD -- ccd/history shared deploy | grep -n '^+.*process\.env' || echo 'no new process.env read'
git diff origin/main...HEAD -- ccd/history shared deploy server/test | grep -nE '^\+.*\b(lib|cli|sweep|store|derive|recall|card|regex-worker)\.mjs:[0-9]' || echo 'no new mjs line citation'
```

Expected: `only W2-1 files` (this plan is listed only because a task may correct its own entry); `0` (no never-edit path); `0` (the PR creates no file: W2-D5, and the plan is on `main` before dispatch); `bound RECALL_OFF_GAP_MS`, `bound RECALL_OFF_KEYS`, `bound RECALL_OFF_META` and `bound RECALL_OFF_SCAN_MAX` (W2-D12, R2), and no other line; `no new process.env read`; `no new mjs line citation`. Any other path, an `UNBOUND` name, a new `process.env` read or a new line citation is a finding against the task that added it: report it to the coordinator, and never fix it here.

- [ ] **Step 7: The whole-PR checks.** From the repository root, each line in the foreground with a timeout of at least 600000 ms, ONE tool call per line: never two suites in one call, never a loop over suites, never a suite in the background, because the history suites together run far past 600 s (at `bd363a76b`, history-maint alone took about 4 min 36 s, history-ingest about 2 min 12 s and history-op about 62 s). Re-run a red file alone before calling it a break: CLAUDE.md names the load flakes. The census first: every `history-*.test.ts` file is run, the seventeen at `02d75ae5f` (W2-4 added `history-replay`, which this PR never edits but which imports `lib.mjs` and the gate), and any other one on a line of its own.

```bash
ls server/test/history-*.test.ts | wc -l
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-drain.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-holds.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-parser.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts)
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit)
(cd server && ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- the census prints `17`, or 17 plus a history suite another PR added on `main`, which then gets a line of its own like these;
- every `history-*.test.ts` file green alone, with this PR's pins among them: RP8 end to end (W2-D32) and RP10, C16's two words, C64's recall-off forms, C66, C67 and C68 re-run, the presence record's pins (W2-D30) and `status`'s `recall_off` (W2-D31);
- `measure-history` green: the `RECALL_OFF_META` Python twin pin (W2-D23), O32, O52's re-pinned totals and the gate's import rewires;
- `single-definition` green: O13's one-writer case for `recall-off/<id>` with its two `readBounded` reader lines (W2-D29, R3), O14 with `RECALL_OFF_META`, `RECALL_OFF_GAP_MS`, `RECALL_OFF_SCAN_MAX` and `RECALL_OFF_KEYS` (W2-D12, R2), `isSyntheticModel`'s sole definer (W2-D17) and the deploy lane's exports (W2-D33);
- `lifecycle` green: O17 with `history-recall-off` declared and `'W2-1'` in `HISTORY_LANDED` (W2-D9, Task 3);
- `ccrc-doctor`'s `'history'` cases green (`status --json` gains a field, which doctor's reader must tolerate);
- `docs-policy`, `topology-clean` and `ci-pipeline` green; `citations` green (no added line holds a numeric line citation, D-5893's ratchet); `growth-check` green, every listed file's row present and none `GROWTH_OVER` (this PR edits none of its listed files, which the operator armed on 2026-10-21, D-6178);
- both `tsc` runs print nothing.

Copy each `Test Files … | Tests …` summary line, as printed, into the PR body. A `topology-clean` red means a new sentence names a host, an id or a private path: rewrite that sentence, never touch the scanner. A `single-definition` red on a new constant or spelling is a finding against the task that added it: report it, never weaken the scan.

- [ ] **Step 8: Check the deviation ledger against `main` without merging.**

```bash
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: green. A red names a number defined in two plans: report it to the coordinator, and never renumber one. D-5763, D-5764, D-6238, D-6239 and D-6240 are defined once, in this plan's "## Deviations found", from the plan's own commit; this task cites D-5763 and D-5764 in the spec and defines nothing. Every other W2 number in the spec's new sentences is defined in W2-3's plan and cited bare.

- [ ] **Step 9: Confirm the tree holds only this PR's work.** Run `git status --short`. It lists nothing: Step 5 committed the spec, and the scratch files sit under the ignored `.superpowers/`. No step read or wrote a live `~/.ccrc`: every test ran in a fixture HOME, and no step ran `ccd`, the shim, `sweep.mjs`, `cli.mjs` or any history verb.

- [ ] **Step 10: Write the PR body, and check it and every added line for private names.** Write `.superpowers/sdd/history-w2-1/pr-body.md` with exactly the text below. Then replace its three parenthesised lines:
  - the one under `### Departures`, with this plan's five `## Deviations found` entries (D-5763, D-5764, D-6238, D-6239 and D-6240), then one line per number this run's block issued during the build (each defined in the same plan), each as issued;
  - the one under `### Choices the tasks made`, with every task's choice bullets, one line each, its task number first, then the plan's rulings R1 to R6, one line each, plus any finding Steps 1, 2 and 6 reported and the coordinator's answer to it;
  - the one under `### Tests run`, with Step 7's and Step 8's summary lines as printed.

Every other line is final.

```markdown
## ccrc history wave W2-1: recall-off, the presence record and the deploy lane's exports

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.6, amended in place): §8.3's exit table, §8.4's `status` and `recall-off`, §8.8's failure table, §9.4's `history-recall-off` and `history-replay-out` rows, §9.11's O13, O14, O17, O32 and O52, §9.14's journal kinds, §10.2's replay eval and §10.7's W2 row, §13's single definition.
Decisions: `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md`, §2's "W2-1 (fleet)" entry, §3 C (W2-D26 to W2-D33), W2-D17, W2-D23 and W2-D12, and §6's errata. Plan: the W2-1 plan this wave's brief names.

W2's replay eval needs three things from the fleet side before its deploy lane can build on them: a `recall-off` verb that writes exactly the family the census assigned, a record of when each `recall-off` file appeared or went, and the store reads the driver will call. This PR ships them, on the fleet lane after 5h-2, W2-3 and W2-4:

- **`recall-off`, end to end through the shim** (W2-D26 to W2-D28): `recall-off <id> [--generation <uuid>] [--clear]` and `recall-off --clear-all` write as invoked (D-5763). Under the lock, before any write, the verb checks `$REG/<id>.generation` against `--generation`, and refuses exit 2 `generation-malformed` or `generation-mismatch` (D-5764). The writer creates `recall-off/` 0700, writes 0600 through `recall-off/~tmp.<pid>` (O_CREAT|O_EXCL|O_NOFOLLOW) and renames; `--clear-all` unlinks regular files and links without following them and names every other entry in `skipped`. O13 holds it to exactly one writer, `sweep.mjs`, and every content reader reads through `readBounded` (W2-D29). The pass opens no store (D-6239).
- **The presence record** (W2-D30): each normal tick, before `recordTick` and never in the recover arm or under replay, reads `recall-off/` (counted, bounded at `RECALL_OFF_SCAN_MAX`) and records `state:<id>`, `seen_ms`, `change:` and `gap:` meta rows under `RECALL_OFF_META`; each change and gap row is journaled through `journal_outbox` in its transaction (`JOURNAL_KINDS` gains `recall-off`), and replay rebuilds the rows without reading the directory; `seen_ms` survives a restore or an adopt (D-6240). `status --json` gains `recall_off: {seen_ms, files, unreadable}` (W2-D31). RP8 runs end to end through W2-3's window pipeline (W2-D32).
- **The deploy lane's exports** (W2-D33): `pairIndexOf` (cli.mjs), `bodyOf`, `keptOf` and `blobReadStmts(db)` (derive.mjs, with `stmts(db)` calling it), the body-pick helper split from `expandEntryText` (recall.mjs), which answers five state words (D-6238), and `stampAtOrBefore` moved into lib. `isSyntheticModel` is extracted into lib and `backendOf` uses it (W2-D17); `deploy/history-gate.mjs` imports it and `RECALL_OFF_META` in place of its two temporary local spellings, and `deploy/measure-history.py` emits the raw `recall_off:` rows, held to lib's prefix by a Python twin pin (W2-D23).
- **The spec errata** for W2-1, W2-3 and W2-4 (W2-D3; decisions §6): E1, E3, E4, E5, E6, E12, E13, E14, E15, E16, E17, E18 and E26, and three added with no number (§9.4's two "Lands in" cells, §8.8's `recall-off` generation row, §9.14's journal kinds), each amended in place inside its own line(s). W2-5b's errata (E2, E7 to E11, E19 to E24) and W2-6's (E25) are left for those PRs.

Fleet-side `ccd/history/*`, `shared/lifecycle.ts`'s `history-recall-off` row, two import rewires in `deploy/history-gate.mjs`, `deploy/measure-history.py`'s raw rows, README's verb, the spec and their tests. Schema v2, no migration (W2-D10), no new store table, column or index, no wire change, no new test file (W2-D5), and nothing in `deploy/history-replay.mjs`, `server/test/history-replay.test.ts` or `.github/workflows/*`.

### Departures

(this plan's `## Deviations found` entries, as issued)

Cited bare, defined elsewhere: D-5770, D-5771, D-5772, D-5773, D-5774 and D-5775 (W2-3's plan, the errata E12 to E17 state them); D-5748 (5h-2's plan, the `history-store-id` row this PR leaves as 5h-2 wrote it).

### Decisions this PR applies

- W2-D3: W2-1 holds the spec and amends W2-1's, W2-3's and W2-4's errata; W2-D9: `history-recall-off` is declared and `'W2-1'` joins `HISTORY_LANDED`; W2-D10: no schema change; W2-D12 and R2: `RECALL_OFF_META`, `RECALL_OFF_GAP_MS`, `RECALL_OFF_SCAN_MAX` and `RECALL_OFF_KEYS` join O14's `VOCABS`, and lib's `REASONS` gains only the two CLI words.
- W2-D17 and W2-D23: the two gate rewires, each replacing a spelling W2-3 marked temporary.
- W2-D26 to W2-D33, as the bullets above say. The verb's order of checks is W2-D27's table, exactly.
- The plan's rulings R1 to R6, each the coordinator's ruling in the operator's place under the directive of 2026-10-19 (listed under Choices below).
- Every ruling here is the coordinator's, under the operator's directive of 2026-10-19 to proceed through the build waves; the operator may change any of them.

### Pins

RP8 end to end and RP10; C16 (its two words), C64 (the recall-off forms), C66, C67 and C68 (re-run); O13 (recall-off: exactly one writer, with its CONTROLs and its stated known width); O14 (`RECALL_OFF_META`, `RECALL_OFF_GAP_MS`, `RECALL_OFF_SCAN_MAX` and `RECALL_OFF_KEYS`); O17 (`history-recall-off`); the `RECALL_OFF_META` Python twin; `isSyntheticModel`'s sole definer; the presence record's seven pins (W2-D30) and `status`'s `recall_off` (W2-D31). Each new guard was measured red under its mutant, then green; the plan lists each mutant and the case it reds.

### Steps for the coordinator or the operator, never the worker

1. **Full suite.** This PR changes no `.github/` file, so the pull request runs its selection. Check that its `select tests` summary lists every `history-*` suite this PR edits, `measure-history`, `single-definition` and `lifecycle`; if one is missing, dispatch a full run: `gh workflow run ci.yml --ref <this branch> -f mode=full`.
2. **Rollout through the release lane only** (§9.12), and only as part of W2's final release (W2-D6): every W2 PR merges and that release is rolled onto the named nodes before part 1 of the open record is signed. No node owes a `doctor --migrate` (W2-D10).
3. **The ledger's owed sentence.** "only the quiz waits on the backfill" is superseded by W2-D8 (decisions §6, the note under the table); the coordinator corrects it at the ledger's next edit.

### Residuals, named

- O13's known width: a `recall-off` path held in a variable and written on a later line is invisible to the needle scan (W2-D29).
- A generation that moves between the census and the write leaves a control family `assignment-unrealised`: dropped from the reported comparisons, never moved to treatment (W2-D23, W2-D27).
- An empty `.generation` without `--generation` writes `''`, as the spec says; the W2 flow always passes `--generation`, and legacy families are excluded (W2-D20).
- A build older than this one reads a `recall-off` journal record as `'unknown'`, skips it and counts it (W2-D30).

### Choices the tasks made

(every task's choice bullets, one line each, its task number first)

### Tests run (foreground, on the worker's box)

(Step 7's and Step 8's summary lines, as printed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then check the body and every added line. The second command prints a count, never a token:

```bash
grep -nE '[0-9]{1,3}(\.[0-9]{1,3}){3}|\.ts\.net|/home/' .superpowers/sdd/history-w2-1/pr-body.md || echo 'no host or home path'
LIST="$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names"
{ git diff -U0 origin/main...HEAD | grep '^+' | grep -v '^+++'; git log --format=%B origin/main..HEAD; cat .superpowers/sdd/history-w2-1/pr-body.md; } \
  | grep -c -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#')
```

Expected: `no host or home path`, then `0`. A non-zero count is judged by its line, never by printing the token: re-run the pipeline with `grep -n -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#') | cut -d: -f1` for line numbers only, read those lines, and rewrite each hit with a neutral stand-in before any push. The fixture paths in this PR's tests are `/home/u/…` style; the body names none.

- [ ] **Step 11: Open the PR, then read its review threads.** Push the workspace branch, then open the PR against `main`, ready for review (not a draft), the way the brief says:

```bash
gh pr create --base main --head "$(git branch --show-current)" \
  --title "ccrc history wave W2-1: recall-off, the presence record and the deploy lane's exports" \
  --body-file .superpowers/sdd/history-w2-1/pr-body.md
read -r OWNER REPO < <(gh repo view --json owner,name -q '.owner.login + " " + .name')
PR=$(gh pr view --json number -q .number)
gh api graphql -F o="$OWNER" -F r="$REPO" -F n="$PR" -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){totalCount nodes{isResolved path line}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads | "threads \(.totalCount) open \([.nodes[] | select(.isResolved | not)] | length)"'
gh pr checks "$PR"
```

Expected: the PR URL; `threads N open 0`; and, once CI settles, every required check green (build-pwa, test (agent), test (pwa), test (server), node floor, typecheck). Re-read the threads after every push. A thread left open blocks the merge even while its check reads green; a CodeQL thread's cause is fixed in code (argv arrays, never a shell; no env value in a command string), and a thread is never resolved, nor an alert dismissed, by the worker. Wave-done is the brief's: the PR open, its checks green, no open thread, and the branch tip the PR head.

**Mutants.** This task adds no guard, no test and no code path, so it has no mutant list. Its script's anchor assertions are its checks, and Step 2's CONTROL shows one of them red on a moved anchor before the real file is touched. Every guard this PR adds is in Tasks 1–5, each with its own mutant list.

**Commit:** one, Step 5's: `docs(history): spec errata for W2-1, W2-3 and W2-4, amended in place (W2-1 Task 6; W2-D3, D-5763, D-5764, D-6241)`.

---

## Deviations found

D-5763 and D-5764 were issued on 2026-10-19 in the W2 decisions document's block, and this plan is the one that defines them (decisions §6's "Defined in"). D-6238, D-6239 and D-6240 were issued to this plan's planning run for the three departures found against the decisions document's text while the plan was drafted; the coordinator ruled each one a departure (R1, R3, R4). Each of the five is defined once, here, from the plan's own commit; a task checks its entry and never adds a second. Every other number this plan cites is defined on `main` and cited bare. D-6241 was issued to this plan's execution run for a departure found while executing Task 3.

- **D-5763** — `history-w2-recall-off-no-dry-run` (Task 3; W2-D26, with Task 6's §8.4 sentences): `recall-off <id>`, `recall-off <id> --clear` and `recall-off --clear-all` write as invoked: no dry run and no `--apply`, as B1's `formOf` already maps them (`'recall-off'` and `'recall-off-clear-all'`, neither reading `--apply`). This departs from spec §8.4's generic operator-verb bullet "Dry run by default", which named no form. The spec's verb-specific text decides it: RP8's verb-written G1 file, RP10's `--clear-all` leaving "none left", and §10.6's close step, which runs `--clear-all` and expects every control family's recall back. Each form stays gated as every writing form is: `apply-in-session` under `CLAUDECODE`, `history-off`, the role gate and the shim's one lock, with recovery exempt (RB12). Erratum E3 (decisions §6) is amended in place by Task 6: the bullet names `import`, `prune` and `reparse` as the dry-run forms and says the `doctor` flags and `recall-off`'s three forms write as invoked; E4's grammar line cites this number too.
- **D-5764** — `history-w2-recall-off-generation-checks` (Task 3; W2-D27, with Task 6's §8.3, §8.4 and §8.8 sentences): `recall-off <id>` gains `--generation <uuid>` and two refusals, each exit 2 and each a lib `REASONS` word: `generation-malformed` and `generation-mismatch`. Under the lock and before any write, the verb reads `$REG/<id>.generation` with one trailing LF trimmed. Unreadable refuses `generation-unreadable` (C67, as shipped). Absent or empty writes `''` without `--generation`, and with it refuses `generation-mismatch`. A UUID is written without the flag, and with `--generation G` only when it equals G, else `generation-mismatch`. Any other content refuses `generation-malformed`, with the flag or without it. `--generation` takes a lowercase UUID only, else `bad-args`, and only on the write form. This departs from spec §8.4's `recall-off <id> [--clear]`, whose one rule was "`''` when absent" with `generation-unreadable` its only refusal, from §8.3's exit table, whose exit-2 row held neither word, and from §8.8's failure table, whose `recall-off` generation row named only `generation-unreadable`. The ground is W2-D27: the file the verb writes is the family the census assigned, or nothing, and `marker --section ab` always prints `--generation`, so the W2 flow never writes a legacy `''` control file (W2-D20). Residuals: a generation that moves between the census and the write leaves the family `assignment-unrealised`, dropped from the reported comparisons and never moved to treatment (W2-D23); an empty `.generation` without `--generation` writes `''`, as the spec says. The same erratum, E4, also states W2-D28's writer mechanics, which take no number: the 0700 directory that follows no link, the 0600 write through `recall-off/~tmp.<pid>` (`~` is outside `ID_RE`) and its rename, the stale temps removed at start, `--clear`'s unlink without following, and `--clear-all`'s `cleared` count and `skipped` list (R3). Errata E1 and E4, and §8.8's row under E4 (R6), are amended in place by Task 6.
- **D-6238** — `history-expand-body-five-states` (Task 1; W2-D33, R1): the body-pick helper split from `expandEntryText`, `expandEntryBody(rc, e)`, answers five state words, `'body'`, `'unparseable'`, `'tombstone'`, `'over-cap'` and `'undecodable'`, adding `'undecodable'` to the four W2-D33 lists (written before 5h-1's Task 6 merged). The merged `expandBlob` tells a damaged store (a NULL `z` with no `pruned_ms`, or bytes that do not decompress, which expand prints as "content does not decode") apart from a pruned blob; folding it into `'tombstone'`, or into `'unparseable'`, which carries a body, would put an overloaded value at a seam (CLAUDE.md, "No overloaded null at a seam"). The helper also hands back `causes` (read before the primary's bytes, D-4596) and `blob`, `expandBlob`'s untouched answer, so `expandEntryText` stays byte-identical. It takes `rc` (`{db, version, schema}`), not expand's statement set (R1). W2-5a discards on every non-body state and counts each by its own reason (W2-D68). Pins: history-recall's five-state case with `expandBlob`'s answer handed back, and the existing DM2b, D-4596 and nested-row cases; mutants M7 to M11 of Task 1.
- **D-6239** — `history-recall-off-touches-no-store` (Task 3; W2-D28, R3): `recall-off`'s `--op` pass answers after the gate and the role check and before the lock-take journal half. It opens no store, writes no op marker, journals nothing and flushes no outbox. This departs from spec §9.2's "an --op pass runs the journal half too" (D-4232) and §8.4's "Every writing form flushes its outbox before it exits 0", both written for passes that write the store. The verb writes a control file outside the store; the store observes it only through Task 4's per-tick presence record (W2-D30). It runs on any store state, a recovery included (RB12). Pins: the arm's place after the gate and the role check is pinned by Task 3's C64 rows at both doors and its role-gate case (mutants M14 and M15), and its running under a registered recovery step by Task 3's RB12 case.
- **D-6240** — `history-recall-off-seen-survives-restore` (Task 4; W2-D30, R4): W2-D30 says `seen_ms` is absent after a recovery. As built, a rebuild starts from an empty store, so it holds there; but a restore keeps the backup's `seen_ms`, and an adopt keeps the store's own. After a restore the next tick's interval runs from the backup's older `seen_ms`, which only widens it (a gap row is written once it exceeds `RECALL_OFF_GAP_MS`), so every change keeps a finite `prev_seen_ms` bound instead of −∞. Residual, named: after an adopt, the old box's state rows are compared with this box's directory. The named nodes' trees are frozen through the window, so neither a restore nor an adopt is expected there. No case drives the restore or adopt edge; the rebuild half is pinned by Task 4's history-recover cases (`seen_ms` never replayed, a gap from null after a rebuild).
- **D-6241** — `history-recall-off-stale-temp-kinds` (Task 3; W2-D28, R3): W2-D28 and Task 3's text remove every stale `~tmp.*` entry at the start of a pass. As built, that loop unlinks only a regular file or a link: a directory, FIFO, socket or device named `~tmp.*`, or one it cannot measure, stays, `--clear-all` names it in `skipped`, and the writer's failure path unlinks its own temp only when this pass created it. `--clear-all` also names in `skipped` an entry the directory listing returned that `lstat` then answers absent (a name that is not valid UTF-8). Why: the writer only ever makes regular temps, so any other kind there is a planted entry the operator removes by hand, as R3 already rules for every other name `--clear-all` skips; skipping it without a trace would let the operator's close check (`skipped` empty) pass over an entry left behind.
