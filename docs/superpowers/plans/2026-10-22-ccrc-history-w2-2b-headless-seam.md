# ccrc history wave W2-2b: the headless seam, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship W2's headless seam in ONE PR on `main`, on the fleet lane after W2-2a (#1126) merged. It is the last fleet-lane PR before W2-5b (W2-D2). The seam is how W2's replay driver, and nothing else, reads one listed family's history as it stood at one boundary: no pane, three `CCRC_RECALL_*` variables, an operator-written marker, `~/.ccrc/history/headless-on`, that names the store and the families it arms, and W2-2a's as-of cut set from `CCRC_RECALL_ASOF`. Task by task:
- **Task 1 (W2-D42, W2-D44, W2-D48, W2-D12).** Lib's vocabulary and the marker, pure. `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES` (65,536) and `HEADLESS_LIST_MAX_PAIRS` (1,000), each declared once, typed and appended to O14's `VOCABS`. `parseHeadlessList(text)` is W2-D44's grammar and `formatHeadlessList({ storeId, pairs })` its one producer; `headlessMarkerOf(read)` folds the marker's one read, store.mjs's existing `readBounded`, into `headless-unarmed`, `headless-malformed` or the parsed list (R2). `headless-malformed` and `headless-arm-unknown` join `REASON_ROWS`' exit-2 list. A single-definition describe pins the one read, the one quote of the arm words and the parser's one home. Cites D-5768 and D-5769.
- **Task 2 (W2-D40, W2-D45, W2-D46).** Lib's deciders, pure, wired nowhere. `decideHeadless({ recall, paneSet, marker })` is W2-D46 step 1 in the ruled order and calls W2-2a's `recallSeamEngaged` and `decideSeamInPane` (R1). `asOfFamilySql()` is the one statement over the ASOF row, its boundary's transcript (D-6281), that transcript's confirmed epochs and their families after one `merged_into` hop. `decideHeadlessStore({ list, storeId })` is step 4's first row, the marker's store line, which the CLI answers before any ASOF row is read, and `decideAsOfFamily({ session, asof, rows, list, storeId })` is step 4's admission, calling it first (R3). `GenerationChoice.via` gains `'asof'`. Cites D-5767 and D-5768.
- **Task 3 (W2-D40, W2-D41, W2-D45, W2-D46, W2-D47).** The wiring (R4). With no pane and a seam value set, `readContextIn` hands the read verbs to a new `readContextEnv`, which runs steps 1 to 7, sets `seen.id`, `seen.gen` and `seen.arm` at step 4's admission, and sets `rc.scope.cut` from ASOF through W2-2a's `asOfCutOf`, so every door W2-2a cut applies it. Lib gains `decideEnvProject` (W2-D41's env-only `cross-project` guard, R7) and `decideHeadlessRead` (steps 5 and 6, exit 8), and `SCOPE_SOURCES` gains `'env'`. Box and operator verbs never read the seam, pinned (C28 extended). W2-2a Task 5's no-pane case is edited in place (R8).
- **Task 4 (W2-D43, W2-D46's counting rule).** A counted env call carries its arm: `recallLine` is the single writer of `arm`, `readContext` stamps Task 3's `seen.arm` on every answer, and the drain skips the `recall_off_stale` bump for any line carrying `arm` (R4, R5, R6). A spawned ladder pins that no refusal before step 4 writes a line and history-off writes nothing, and the C-R pin runs a treatment call through W2-3's merged window, which does not count it.
- **Task 5 (W2-D49).** `shared/lifecycle.ts`' `history-switches` row names `~/.ccrc/history/headless-on` and its 64 KiB bound in W2-D49's words (R12), its pin moves (O17), and README's Session history section gains the seam's paragraph (R11).
- **Task 6.** The whole-PR checks (the file list, D-5767, D-5768 and D-5769 once each, the spec unchanged, lib's 67 redaction declarations byte-identical, the census of W2-D46's order), then the PR body and the PR.

Sessions see no change. With every `CCRC_RECALL_*` unset or empty, the read path is byte for byte W2-2a's (W2-D45), and inside a pane W2-2a's `headless-in-pane` stands. The one answer that moves is a read verb run with no pane and a seam value set: W2-2a answered `no-identity` there, and W2-2b answers W2-D46's step-1 words, `headless-unarmed` on a box with no marker. No shipped caller sets a seam value before W2-5b's driver, and nothing in the tree writes the marker. The hook, `ccd`, `ccd/ccd-history-sweep` and the wire are untouched. The rollout is part of W2's final release (W2-D6), the operator's, never the worker's.

**Architecture:** Fleet-side `ccd/history/*`, one L0 manifest row and one README paragraph. Ring membership is a property of a file's imports.

*L1 `ccd/history/lib.mjs`* (imports `node:crypto` only; it returns SQL text and runs none; it reads no file) decides:
- `RECALL_ARMS`, the two bounds, `parseHeadlessList`, `formatHeadlessList`, `headlessMarkerOf` and the two exit-2 words (Task 1);
- `decideHeadless`, `decideHeadlessStore`, `asOfFamilySql` and `decideAsOfFamily`, with the anchor rule (`cwd_real ?? cwd`) in lib, never in L4 (Task 2);
- `decideEnvProject`, `decideHeadlessRead`, and `SCOPE_SOURCES` gaining `'env'` (Task 3).

*L4* measures and applies lib's answers, deciding nothing:
- `ccd/history/cli.mjs`: in `readContextIn`, W2-2a's three seam reads stay one each and its in-pane refusal keeps its place before any tmux spawn; an engaged seam goes to `readContextEnv` (Task 3), which reads the marker on one line, `const marker = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));` (R1), answers the marker's store line through `decideHeadlessStore` before it runs lib's `asOfFamilySql()` on the admitted read handle (`asOfRowsOf`, R3), and hands each measurement to lib. `recallLine` writes `arm`, which rides from step 4's admission to `countRecall` on `readContext`'s `seen` (Task 4).
- `ccd/history/sweep.mjs`: `applyEventLine`'s recall arm skips the `recall_off_stale` bump for a line carrying `arm` (Task 4).
- `ccd/history/recall.mjs` is **not edited**: `asOfCutOf`, `familiesOf`, `transcriptsOf` and `visibleScope` are consumed as W2-2a merged them, and the env path is reachable only through the CLI.

*L3 `ccd/history/store.mjs`* stays `node:sqlite`'s sole importer and is not edited: `readBounded` (D-4347's one bounded reader: O_RDONLY|O_NONBLOCK|O_NOCTTY plus O_NOFOLLOW, the type judged on the descriptor, at most `max` + 1 bytes) and `openReader` are consumed as they are. `derive.mjs` and `regex-worker.mjs` are not edited.

*L0 `shared/lifecycle.ts`* names the marker and its bound as text (it imports nothing); one `lifecycle.test.ts` case holds the figure to lib's constant (Task 5).

No schema migration (the store stays v2), no table, column, index or counter, and `JOURNAL_V` stays 1 (W2-D10). The spool grammar already admits `arm` (`SPOOL_KEYS.recall`, `SPOOL_VALUE.arm`), `recall_calls.arm` is a v1 column, and the drain already inserts `rec.arm ?? null`.

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`); the read handle is the one `openReader` opens.
- SQLite through `node:sqlite`, named parameters bound by bare name. `asOfFamilySql` has one, `:asof`, and LEFT JOINs `boundaries`, `transcripts`, confirmed `epochs`, `sessions` and the session a `merged_into` names.
- vitest in `server/`: pure lib cases in process (they run on darwin too, the real-store case included); the CLI spawned through the placed shim with fixture HOMEs (`historyHelpers.ts`), skipped on darwin. No in-process test imports cli.mjs: importing it sets the process's umask, so Task 4's `recallLine` case runs in a child process. Task 4's C-R pin runs `python3 -I -B deploy/measure-history.py` read-only and imports `deploy/history-gate.mjs` dynamically, as W2-1's RP8 does.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6 as amended in place by W2-1. **W2-2b amends none of it**: errata E2 (its W2-2b half), E7, E8, E9 and E10 are W2-5b's (decisions §6, W2-D3), and Task 6 checks the spec's diff is empty. Line numbers are hints measured at `d119d6e90`. The sections this PR implements:
- §8.2's headless bullets (about :1525-1531): the three seams, honoured only with no `TMUX_PANE` and with the marker; the marker names the families it arms (about :1527, the sentence D-5768 departs from); "Uses are counted `scope_source=env`" (about :1529, read as `recall_calls.arm IS NOT NULL`, E10); `ARM=control` answers exit 8; `recall-off/<id>` applies to the resolved family.
- §8.2's generation chain (about :1509) and `--workspace` definition (about :1514), from which the env path departs (D-5767).
- §8.1's "Replay runs add `"arm":…` and are excluded from live counters" (about :1492).
- §8.3's exit table, the exit-2 row (about :1671), which names neither new word until W2-5b's E2 (D-5769).
- §9.4's history-switches row (about :2171) and §9.7's headless-on row (about :2307), until E7 and E9.
- §10.1's Seams bullet (about :2618): the allow-list already admits the three names (W2-2a); W2-2b reads no new one.
- The pins (§8.9): C4 complete (Task 3), C16's two words (Tasks 1 and 3), C24 under env (Tasks 3 and 4), C28 extended (Task 3), C30 (Task 3), C48 tmux-only (Tasks 2 and 3), C50 (Task 3); O13, O14 (Task 1) and O17 (Task 5); the decisions document's C-R pin (Task 4).

**Authority:** `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md` (the W2 decisions document): section 2's "W2-2b (fleet): the headless seam" entry; section 3 E (W2-D40 to W2-D50; W2-D50 is W2-4's and W2-5b's, and W2-2b only supplies what it needs); W2-D12 (O14's `VOCABS`); section 3 D (W2-2a's, with the coordinator's in-place amendments to W2-D35 and W2-D39); section 6's errata rows E2, E7, E8, E9 and E10, which name W2-2b's numbers and are amended by W2-5b; section 7's residuals. Then the coordinator's rulings R1 to R12 and R5a, its amendment to R5 (Decisions below), then the spec, then the merged code at the base, then the W2-2a plan as merged (`docs/superpowers/plans/2026-10-22-ccrc-history-w2-2a-as-of-cut.md`: its R1 to R8, its "Not in this plan" and its "Deviations found", which define D-5765, D-5766, D-6281, D-6282, D-6283 and D-6284; this plan cites them and never redefines one). The decisions document was written at `bd363a76b`, long before W2-1 and W2-2a merged; every line it cites is a hint, and "Drifts since the decisions document" below lists what moved. Before editing a function in place, re-read the merged code at the base: plan text is never ground truth.

**Ledger:** `docs/superpowers/programs/ccrc-history.md`: the W2-2b row; "Decisions & deviations" (the W2 block issued 2026-10-19, of which D-5767, D-5768 and D-5769 are this plan's to define); "Carried constraints" ("For W2-5b's plan", which this PR feeds); "Later (coordinator), from the build" (the display doors and the widened rules, which Task 6 measures and leaves open). The ledger is the coordinator's file. No task edits it.

**Base:** `main` after W2-2a (#1126) merges. Anchors were measured at `d119d6e90`, a read-only checkout of `main` at `4f9d7ac4d` plus W2-2a's branch; for every file W2-2b touches its content equals the merged base's unless `main` moves. It holds W2-2a's `asOfCut`, `asOfEntrySql`, `asOfBinds`, `recallSeamEngaged` and `decideSeamInPane` in lib (about :4230 and :4238), `asOfCutOf(rc, asof)` and `visibleScope` in recall.mjs, `asof-invalid` in `REASON_ROWS` (about :64), and the seven-name `process.env` allow-list. Each task's Step 0 checks the base, or the earlier tasks' names, by content and stops before any edit if one is missing.

## Global Constraints

- **One PR, fleet lane.** One commit per task, in task order; Task 6 commits only to correct a figure in this plan's own text. The fleet lane runs one worker at a time (W2-D2), and W2-2b dispatches only when no running worker claims any of its paths (W2-D3).
- **No schema change (W2-D10).** No table, column, index, counter, `SCHEMA_ADDED` entry or migration. `SCHEMA_VERSION` stays 2 and `JOURNAL_V` stays 1.
- **No new file (W2-D5).** No new test file, source file or `.d.mts`. A worker who finds a new file unavoidable stops and reports to the coordinator first.
- **The files this PR may modify:** `ccd/history/lib.mjs`, `ccd/history/lib.d.mts`, `ccd/history/cli.mjs`, `ccd/history/sweep.mjs`, `shared/lifecycle.ts` (the `history-switches` row only), `README.md` (the seam paragraph only, R11); appends to `server/test/history-lib.test.ts`, `history-cli.test.ts`, `history-sweep.test.ts`, `single-definition.test.ts` and `lifecycle.test.ts`; three in-place test edits, each named by its task: `single-definition.test.ts`' O14 `VOCABS` (two lines for two, Task 1), `lifecycle.test.ts`' `declares history-switches` pin (Task 5, W2-D49), and W2-2a Task 5's no-pane case in `history-cli.test.ts` (Task 3, R8); and this plan, only by Task 6's conditional correction. `ccd/history/recall.mjs` and `history-recall.test.ts` are allowed by the decisions document and not needed: the env path is reachable only through the CLI, and the cut's in-process doors are W2-2a's.
- **Never touched by this PR:** the spec, `deploy/**` (run read-only by Task 4's C-R pin, never edited), `ccd/history/derive.mjs`, `store.mjs`, `store.d.mts`, `regex-worker.mjs` and `card.mjs`, `ccd/session-hook.sh`, `ccd/ccd`, `ccd/ccrc`, `ccd/ccd-history-sweep`, `.github/**`, `CLAUDE.md`, the programme ledger and the decisions document, `ccd/history-skill/SKILL.md` (its exit-2 row is generic, W2-D48), every lifecycle row but `history-switches` and every lifecycle key (W2-D9), the growth check's machinery (`GROWTH_MACHINERY`) and `growth-waivers.json`. A mutant may edit a file in place, one mutant per tool call, through its task's helpers under `.superpowers/sdd/history-w2-2b/t<N>/` (every file restored and checked with `cmp` when the call exits, a signal included); each task's commit step checks the restore again, and no mutant is committed.
- **The spec stays rev 3.6 with W2-1's errata, byte for byte (W2-D3).** Task 6 Step 1 checks the diff is empty, that each rev 3.6 sentence E2, E7, E8, E9 and E10 change still stands once, that the spec names neither new word, and that line 3 still reads rev 3.6.
- **Entry guards.** `cli.mjs` and `sweep.mjs` end in their entry guard; every new block goes above it, with no top-level await.
- **The seam's safety properties** (each pinned by a named task, Review Focus):
  - the seam engages only as W2-D45 says: a `CCRC_RECALL_*` value is set iff non-empty, and with none set the path is the base's, byte for byte;
  - a seam value inside a pane (`TMUX_PANE` defined, `''` included) refuses `headless-in-pane` before any tmux spawn (W2-2a's line, kept, R1);
  - the env path never reads `$REG/<id>.generation`, `CCRC_SESSION_GENERATION` or the newest-family fallback, and never spawns tmux (W2-D40, D-5767); the tmux path's `resolveGeneration` stays byte-identical;
  - a counter line is written iff step 4 admitted the family (a refusal, a read failure or a defect before the admission writes none), it carries the arm, a tmux line never does, and under history-off nothing is written (W2-D43, W2-D46, R5);
  - the marker is read only through the bounded O_NOFOLLOW reader, on one line, only on the headless path, after the in-pane refusal (R1; Task 3's "seam source"); the marker's store line is answered before any ASOF row is read (R3); O13's `headless-on` holders stay `['ccd/history/lib.mjs']` and the symbolic write scan stays green (W2-D44);
  - box and operator verbs ignore every `CCRC_RECALL_*` (W2-D47).
- **Every refusal at its step.** Each refusal W2-2b owns is pinned at its step of W2-D46's order with a CONTROL one step later in the order, and every new guard has a named mutant that reds it. Task 6 Step 4 takes the census.
- **Single definition.** `RECALL_ARMS`, the two bounds, `parseHeadlessList`, `formatHeadlessList`, `headlessMarkerOf`, `decideHeadless`, `decideHeadlessStore`, `asOfFamilySql`, `decideAsOfFamily`, `decideEnvProject` and `decideHeadlessRead` are each declared once in lib.mjs and once in `lib.d.mts` (count them: `skipLibCheck` hides a duplicate). No ccd/history code line quotes `'control'` or `'treatment'` but `RECALL_ARMS`' own. W2-D45's "empty means unset" lives only in `recallSeamEngaged`, the in-pane rule only in `decideSeamInPane`, the marker's fold only in `headlessMarkerOf`. The three seam names stay read once each, dotted, in cli.mjs alone (W2-2a's holders describe), and the allow-list stays exactly seven names.
- **No overloaded null at a seam.** `decideHeadless`'s `marker`: `null` means not read, never absent; `paneSet` is a boolean, and anything but `false` is a pane. `recallLine`'s `arm`: absent and `null` mean none; any other non-word is no line, never a line without one. `decideHeadlessStore`'s and `decideAsOfFamily`'s `storeId`: the meta row's `store_id` or `null`, never the binding-file fallback, and `null` matches no store line. A resolved generation is `''` for a legacy family and never `null`.
- **FIXTURE HOMEs only.** Tests use `historyHelpers.ts` (`makeHistoryBox`, `runSweep`, `runCli`, `withPane`, `seedFamily`, `plantSession`, `spoolLine`, `openStoreRO`, `counters`) with `tmux`, `claude`, `gh`, `ssh`, `curl` and the managers poisoned. No step runs `ccd`, `ccrc`, the shim, `sweep.mjs`, `cli.mjs` or any history verb against the live `$HOME`, and no step reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or any account home. Describes that seed a store through the sweep or spawn the CLI skip on darwin.
- **Running tests.** From the repository root, `(cd server && ./node_modules/.bin/vitest run test/<file>.test.ts -t '<regex>')`, in the foreground, with a timeout of at least 600000 ms and one suite per tool call. Never bare `npx vitest`. Each `-t` filter is regex-safe and selects at least one test: a run that reports only skipped tests selected nothing and is not green. Re-run CLAUDE.md's load flakes alone before calling a red a break.
- **Red-first.** Every new guard is watched red on the unguarded code, with the prediction written before the run; then each mutant in its task's list is measured red, then green again. A red at a CONTROL is the fixture's to fix, never the guard's to weaken. A guard no mutant can red is not added. A mutant whose red differs from its prediction is recorded as measured and reported, never re-predicted. Scratch goes under `.superpowers/sdd/history-w2-2b/` (gitignored), never `git stash`.
- **Never on timing.** No assertion reads a duration. Fixture stamps are fixed integers.
- **Citation corpus.** `session-hook.test.ts`' citation audit cites `single-definition.test.ts` by line: Task 1's `VOCABS` edit is line-neutral, new describes are appended at the end, and the CITATION DEBT case runs after each edit of that file. `citations.test.ts` refuses an added numeric line citation in code or tests (D-5893); README's new paragraph holds no colon followed by a digit. `growth-check.test.ts` (armed, D-6178) lists no file this PR edits: every row reads `delta +0`, and no waiver (D-6223) or exemption (D-6211) is added.
- **Fixtures.** Key-shaped fixtures are assembled at runtime from parts. Non-ASCII fixture characters are built with `String.fromCharCode`, never a backslash-u escape (an agent's file write decodes those). Fixture paths are synthetic, `/home/u/tree` style. Fixture ids follow ccd's grammar with neutral words (`acct-a-demo`, `w2b-demo`).
- **Public repo.** No host, user, account, wrapper, lane, pool, session or person name, no private project name, no IP address, no absolute home path, no private ticket id and no docserver URL, in plan text, fixtures, comments, commits or the PR body. Task 6 Step 8 runs the private-name count over every added line, every commit message and the PR body; it must print 0.
- **D-numbers.** This plan defines exactly three issued numbers, once each, in "Deviations found" at its end, which lands on `main` with the plan before dispatch (R9): **D-5767** (`history-w2-env-identity-from-asof`, W2-D40, E8; Task 2's), **D-5768** (`history-w2-marker-grammar`, W2-D44, E7 and E9; Task 1's) and **D-5769** (`history-w2-headless-refusal-words`, W2-D48, E2's W2-2b half; Task 1's). Tasks 1, 2 and 3 cite them in code comments; no task adds a second definition. Earlier numbers are cited bare: D-4228, D-4347, D-4675, D-5023, D-5745, D-5748, D-5765, D-5766, D-5774, D-5893, D-6045, D-6178, D-6211, D-6223 and D-6281. Never write a number that was not issued, and never a range: cite each number on its own. A departure found while executing takes the next unused number from the run's block named in the brief, defined in "Deviations found" in the commit that first cites it; with no block, write `D-TBD-<slug>` and report it, never invent one. Before the PR: `git fetch origin main`, then `(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)`.
- **Peers.** Before each first edit of an existing file, read `GET /api/claims?project=ccrc-pwa`. The hot paths are `ccd/history/*.mjs`, the history tests, `single-definition.test.ts`, `shared/lifecycle.ts`, `lifecycle.test.ts` and README. Whichever PR lands second merges `main` (never a rebase) and keeps both sides.

## Decisions

| # | Decision | Status | Task(s) |
|---|---|---|---|
| W2-D40 | **The env family comes from ASOF** (D-5767). The ASOF row must have a boundaries row on a main transcript whose `cc_session_uuid` is a confirmed epoch of exactly one family with `ccrc_id = SESSION`, following `merged_into`; else `asof-invalid`. That family's generation (`''` for legacy) is the resolved generation, an exact key, `via: 'asof'`. The env path never reads `CCRC_SESSION_GENERATION`, `$REG/<id>.generation` or the newest family; `--session <own id>` reads the resolved generation; `--workspace` anchors on the ASOF epoch's `cwd_real ?? cwd`. Residuals: the harness from `$REG`, and `--session <other>`'s newest family. | coordinator ruling (W2 decisions document) | 2 (`asOfFamilySql`, `decideAsOfFamily`, the real-store purge-and-reuse pin); 3 (the wiring, the spawned purge-and-reuse and workspace pins) |
| W2-D41 | **Widened scopes are cut, not refused.** `--project`, `--workspace` and `--session` stay legal on env; `decideScope` runs with `source: 'env'`; a family with no visible epoch is dropped from the scope and its count (W2-2a's `visibleScope`); the env-only guard answers `cross-project` when the resolved family's stored project differs from the registry project `decideScope` used. | coordinator ruling (W2 decisions document) | 3 |
| W2-D42 | **ARM and ASOF.** `RECALL_ARMS` in lib, typed, in `VOCABS`; an empty, absent or unknown ARM is `headless-arm-unknown` and an empty or non-UUID ASOF `asof-invalid`, both before the store; `ARM=control` is exit 8, counted, after admission and recall-off. | coordinator ruling (W2 decisions document) | 1 (the constant); 2 (the pre-store rows); 3 (exit 8 via `decideHeadlessRead`) |
| W2-D43 | **Counting.** `recallLine` is the single writer of `arm`, on every counted env call and never on a tmux call, with `gen` only when it is a UUID; the drain skips `recall_off_stale` for a line carrying `arm`; no schema change; the C-R pin. | coordinator ruling (W2 decisions document) | 4 |
| W2-D44 | **The marker grammar** (D-5768): the path, the bounded read, the parser and formatter, the store line checked at admission, zero pairs `headless-unlisted`, the two bounds in `VOCABS`. | coordinator ruling (W2 decisions document) | 1 (grammar, fold, the one-read pin); 2 (store line and pair at admission, `decideHeadlessStore`, zero pairs); 3 (the one read, spawned: link, FIFO, cap; the store line before the ASOF rows) |
| W2-D45 | **Empty means unset; a defined `TMUX_PANE` is a pane;** with nothing set, the base's path byte for byte. | coordinator ruling (W2 decisions document); its in-pane half merged (W2-2a) | 2 (through `recallSeamEngaged`); 3 (spawned, nothing set); 4 (an empty ARM in a pane counts as tmux) |
| W2-D46 | **The decision order** (0 the darwin and role table; 1 `decideHeadless`; 2 the harness; 3 the store; 4 admission; 5 recall-off; 6 `ARM=control`; 7 scope, guard, cut, verb) **and which refusals count**: a counter line iff step 4 admitted; nothing under history-off. | coordinator ruling (W2 decisions document) | 2 (step 1's and step 4's deciders, every adjacent pair); 3 (steps 0 to 7 wired, the spawned ladder); 4 (the counting ladder, history-off) |
| W2-D47 | **Box verbs ignore the seam**; C28 extended. | coordinator ruling (W2 decisions document) | 3 |
| W2-D48 | **`headless-malformed` and `headless-arm-unknown`** in `REASON_ROWS` (D-5769); SKILL.md not edited. | coordinator ruling (W2 decisions document) | 1 (the words, C16); 3 (reached through the CLI) |
| W2-D49 | **The history-switches row**: root gains `~/.ccrc/history/headless-on`, tier names the 64 KiB bound and the store line; its pin moves in the same PR. | coordinator ruling (W2 decisions document) | 5 |
| W2-D12 | **O14's `VOCABS`** gains `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES` and `HEADLESS_LIST_MAX_PAIRS`. | coordinator ruling (W2 decisions document) | 1 |
| W2-D50 | **The arm env** (W2-4's RP1-contract, W2-5b's RP1-arm). W2-2b supplies only `RECALL_ARMS` and reads no name beyond the three seam names, so the allow-list stays seven. | spec-decides; W2-4's and W2-5b's | 1 (the constant); 3 and 6 (allow-list unchanged) |
| W2-D35, W2-D36, W2-D38 | **The cut, consumed**: `rc.scope.cut` from `asOfCutOf(rc, asof)` at step 7, so hidden means absent at every door W2-2a cut. | merged (W2-2a) | 3 |
| W2-D2, W2-D3, W2-D4, W2-D5, W2-D6, W2-D9, W2-D10 | **Lane, claims, D-numbers, no new file, rollout, one lifecycle row, no schema change.** | coordinator ruling (W2 decisions document) | all; 6 checks them |
| R1 | **The marker read and `decideHeadless`'s contract.** The marker is read on ONE ccd/history code line, only on the headless path (seam engaged, not in a pane): `const marker = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));` (Task 1's single-definition pin holds it; no other code line names `.headlessOn` but `historyPaths`' field). `headlessMarkerOf(read)` (Task 1) is the one fold of the read: absent → `headless-unarmed`; unreadable or over-cap → `headless-malformed`; a value → `parseHeadlessList(value)`. `decideHeadless` (Task 2) is pure and CALLS W2-2a's `recallSeamEngaged` and `decideSeamInPane` (W2-2a's R3 left this to this plan). Its input is `{ recall, paneSet, marker }`, `marker` being `headlessMarkerOf`'s answer, or `null` when the seam is not engaged or a pane is set. It answers in W2-D46 step 1's order: no seam → `{ ok: true, path: 'tmux' }`; pane → `headless-in-pane`; the marker's refusal as `headlessMarkerOf` gave it; SESSION unset → `no-identity`; bad id → `bad-id`; not on a list line (zero pairs included) → `headless-unlisted`; ARM not in `RECALL_ARMS` → `headless-arm-unknown`; ASOF grammar → `asof-invalid`; else `{ ok: true, path: 'headless', session, arm, asof, list: { storeId, pairs } }`. cli.mjs keeps W2-2a's in-pane refusal lines as they are. Applied as: `paneSet` is a boolean, true iff `TMUX_PANE` is defined, handed to `decideSeamInPane` as `''` (a defined pane), and anything but `false` is a pane. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 2, 3 |
| R2 | **The marker grammar** (D-5768). `parseHeadlessList(text)` takes TEXT: `readBounded` answers a string and store.mjs is not edited. "Decodes UTF-8 fatally" is implemented as: a text containing U+FFFD is malformed. Its answer is frozen `{ ok: true, storeId, pairs: [{ ccrcId, generation }] }`, `generation` `''` for `-`, zero pairs parsing ok; otherwise `{ ok: false, rc: 2, reason: 'headless-malformed' }`. `decideHeadless` answers `headless-unlisted` for zero pairs; the store-line mismatch is answered at admission (step 4). The parser also refuses a text over `HEADLESS_LIST_MAX_BYTES` (W2-D44 lists it), and the reader's over-cap answer folds the same way. Task 1's strictures stand, fail closed: an empty line before the store line, an id spelled `store`, whitespace at either end of any line (comments included) and a literal U+FFFD are each malformed. `formatHeadlessList({ storeId, pairs })` returns the marker text; pairs are `{ ccrcId, generation }` with `''` for legacy. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 |
| R3 | **`decideAsOfFamily`** (D-5767). Strict: a transcript confirmed by families of more than one `ccrc_id` refuses `asof-invalid` ("exactly one family", W2-D40), with its mutant and the real-store two-family case. Inside step 4 the store line is checked before the ASOF rows are read. Inputs and answer as Task 3 drafted: `rows` carry Task 3's column names, and the ok answer is `{ ok: true, via: 'asof', generation, family: { ccrcId, project }, anchor }`, `anchor` the matched epoch's `cwd_real ?? cwd`, or `null` when both are NULL; the anchor rule lives in lib, not in L4. `GenerationChoice.via` gains `'asof'`; `ScopeInputs.generation` is widened only as far as `decideScope`'s typed callers need (no further edit: it is a `GenerationChoice`). Both edits are Task 2's. Applied as: the statement keeps Task 3's column names (plus the ASOF row's own `uuid`, which the decider checks against `asof`) and is returned by lib's `asOfFamilySql()`, which the CLI's `asOfRowsOf` runs, because the real-store case R3 keeps runs it in process and no in-process test may import cli.mjs. The store line is its own lib decision, `decideHeadlessStore({ list, storeId })`, which the CLI calls before `asOfRowsOf` runs, so a marker naming another store causes no ASOF query and a fault in that query cannot pre-empt `headless-unlisted`; `decideAsOfFamily` calls it as its own first row, so the rule is spelled once (Task 3's "seam ladder" pins the order at the CLI, with a fault planted on the statement's text). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2, 3 |
| R4 | **Who owns the counting plumbing.** Task 3 owns the env branch in cli.mjs; at step 4's admission it sets `seen.id`, `seen.gen` AND `seen.arm`, and every refusal before step 4 leaves them null. Task 4 owns `recallLine` (it writes `arm` and, for a UUID generation, `gen`), the stamp of `seen.arm` on every answer, `ReadDefect`'s arm, `readVerb`'s pass-through, the drain skip in sweep.mjs, and their pins. One set of names across both tasks: the binding `head`, `seen.id`/`seen.gen`/`seen.arm`, `pairIndexOf` at step 7. Between Task 3's commit and Task 4's, admitted env calls are counted without `arm`: acceptable, nothing ships between commits and every suite stays green. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3, 4 |
| R5 | **Which refusals count.** As ruled: "Step 4's own refusals (asof-invalid's store half, and headless-unlisted from the store-line check) write no line: they did not admit (W2-D46, literal). The ladder pins both." Amended by R5a (the next row), which says which `asof-invalid` R5 meant. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3, 4 |
| R5a | **Which `asof-invalid` R5 meant.** As amended: "R5's "asof-invalid's store half" meant step 4's own asof-invalid, decideAsOfFamily's family refusal, which writes no line. D-5765's store half (asOfCut's validation: a boundary row, a main transcript and T_N) runs at step 7 with the cut, after admission, so W2-D46 counts it. Both are pinned as the plan has them." So step 4's `asof-invalid` (`decideAsOfFamily`'s, which this plan calls the family half, beside step 1's pre-store grammar half) and its `headless-unlisted` (the store line and the pair) stay uncounted, pinned by Tasks 3 and 4's ladders (R5); the `asof-invalid` that `asOfCutOf` answers with the cut at W2-D46 step 7 is counted, pinned by Task 3's "seam cut" and its mutant M16. | the coordinator's amendment to R5, 2026-10-22, in the operator's place under the directive of 2026-10-19 | 3, 4 |
| R6 | **The spool's arm grammar.** No narrowing of `SPOOL_VALUE.arm` to `RECALL_ARMS` (W2-D43: "any line carrying arm"; W2-D10). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| R7 | **W2-D41's guard on the default scope.** The env-only `cross-project` guard applies to every scope verdict that used a registry project, the default family scope included (literal, fail closed). A verdict with no registry project passes. Both pinned. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3 |
| R8 | **The in-place edit of W2-2a's case.** Task 3 edits W2-2a Task 5's history-cli case (seam set, no pane) in place: its answer changes from `no-identity` to `headless-unarmed`, because W2-D46 changes it. Licensed; the commit and the PR body name it as the one in-place test edit of history-cli. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3 |
| R9 | **The plan lands before dispatch.** As W2-2a's R7: the plan merges to `main` before dispatch, carrying D-5767, D-5768 and D-5769 in its "Deviations found". Task 1 cites D-5768 and D-5769 and Task 2 cites D-5767, defined in the plan as merged. The PR defines no number except one taken from the run's block for a departure found while executing. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 2, 6 |
| R10 | **The arm words' second spelling.** `deploy/history-gate.mjs`' `ASSIGNMENT_ARMS` spells the arm words beyond W2-2b's files. W2-5b adds a parity pin with `RECALL_ARMS` (or replaces it with an import) beside its driver arm-word scan. W2-2b's PR body names it as a residual, and the coordinator carries it to W2-5b's plan. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 6 |
| R11 | **README.** The seam paragraph goes inside "Session history: lossless recall", after the box-verbs and operator-verbs paragraph, before the section's closing rule. Task 6's README-section check agrees with that anchor. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 5, 6 |
| R12 | **The history-switches row.** Root and tier exactly as W2-D49 names them; no "(removed at W2 close)" parenthesis in the ruling. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 5 |
| P1 | **`SCOPE_SOURCES` gains `'env'` in Task 3**, its first caller, in place in lib.mjs and `lib.d.mts`; history-lib's C50 case is re-run (it filters members out of its refused list, so `'env'` moves to the members with no edit); O14's `VOCABS` already names it. | this plan's choice | 3 |

## Review Focus

Each of these would bite a person who relies on the seam to read one family's past and nothing else. Each names the task whose tests pin it, and what the reviewer should probe beyond those tests.

1. **An empty variable read as set, or a set one read as unset.** `CCRC_RECALL_SESSION=''` must answer `no-identity`, never `bad-id`, and an all-empty seam must take the tmux path byte for byte (Task 2: `recallSeamEngaged` on SESSION alone, mutants H10 and H15; Task 3: the nothing-set CONTROL and mutant M2). `TMUX_PANE=''` is a pane (W2-2a's case (c), "an empty or malformed TMUX_PANE is a pane", re-run). An empty `CCRC_RECALL_ARM` in a pane is no seam, and its tmux line carries no arm (Task 4). The reviewer probes that no line in cli.mjs tests a seam value's truthiness itself instead of calling `recallSeamEngaged`.
2. **A marker that is not what it looks like.** A symlink to a valid list, a FIFO (never waited on), a directory, an unreadable file, exactly 65,536 bytes (read) and 65,537 (malformed), a CR anywhere, edge whitespace (a byte-order mark, a no-break space), an invalid UTF-8 byte or a literal U+FFFD, an empty line before the store line, a second `store ` line, more than 1,000 pair lines, and a store line naming another store (refused at admission, not at parse). Unreadable and over-cap are `headless-malformed`, never `headless-unarmed` (IV5). Task 1 (every shape, the fold and its other shapes, real files through `readBounded`, mutants M5 to M28 and M34 to M39), Task 2 (the marker's refusal passed through, H14; the store line at admission, F1, F17 to F19), Task 3 (spawned: link, FIFO, the cap, M24; the store line answered before any ASOF row is read, M30; "seam source": the one read line, inside `readContextEnv`, after the in-pane refusal, M34 to M36). The reviewer probes that the store id compared is the meta row's, never `refusalStoreId`'s fallback.
3. **A reused session id whose registry generation is not ASOF's family.** Purge and reuse: (X, G1) listed, ASOF in G1's transcript, `$REG/X.generation` and `CCRC_SESSION_GENERATION` both G2: the default scope and `--session X` read G1 (Task 2's real-store case and mutant F15; Task 3's "seam reuse" and its env, registry and newest mutants M5 to M7). A merged `''` family is admitted, an unmerged legacy family is read by its exact `''` key (Task 3's "seam legacy"), a transcript two families confirm refuses (R3, F6), and a reused id whose registry project now differs refuses `cross-project` on env (Task 3, R7). The reviewer probes the two stated residuals (the harness from `$REG`, and `--session <other>`'s newest family) and that `--workspace` on env never resolves a path at read time.
4. **A refusal answered at the wrong step, so a counter line is written or not.** Each step-1 row against its neighbour (Task 2's adjacent pairs, mutants H2 to H7); each step of W2-D46 spawned with the spool compared before and after (Task 3's "seam ladder", its pairs across steps 1, 2 and 3, and its M3, M4, M29, M31 and M32; Task 4's ladder, every spool file byte for byte, with step 3's failed open and `decideStatusRead` refusal and a defect and a read failure before the admission, and its C1 to C5 on Task 3's lines); steps 5 and 6 in lib (M22, indistinguishable at the CLI); history-off on the env path (Task 4, H1); an eval call never counted live: an unknown arm writes no line, and the C-R pin runs treatment and control calls through `measure-history.py` and the gate's window with an unfiltered CONTROL (Task 4). The reviewer probes that every post-admission answer, a defect included, carries the arm through the one carrier (R4), and that step 4's own refusals stay uncounted (R5).
5. **A box verb, or a widened scope, that reads past the seam.** `status`, `doctor` and the operator verbs answer as with nothing set, in a pane or not, and write no line (Task 3's "seam box verbs", M25: holds by construction, since `main` dispatches them before `readVerb`). A widened env scope names and counts no family the cut hides (Task 3's "seam widened", over W2-2a's `visibleScope`) and the cut is always set on the env path (Task 3's "seam cut", M15). The reviewer probes that no new caller of `readContextIn` appears outside `readVerb`.

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `ccd/history/lib.mjs` | modify | **Task 1:** `    'headless-malformed', 'headless-arm-unknown',` after `    'asof-invalid',` (about :64) with a four-line comment ending `// D-5769 (history-w2-headless-refusal-words)`; a section directly after `decideSeamInPane`'s body (about :4238) holding `RECALL_ARMS`, the two bounds, six module-private constants, `parseHeadlessList`, `formatHeadlessList` and `headlessMarkerOf`. **Task 2:** `decideHeadless` directly above `decideIdentity`'s doc comment (`/** The session's id from tmux (§8.2, D-4675 …`); a section ending `// D-5767 (history-w2-env-identity-from-asof)` with `decideHeadlessStore`, `asOfFamilySql`, the module-private `asOfRowFamily` and `decideAsOfFamily` directly above `decideHarness`'s doc comment, after `resolveGeneration` (about :4267, untouched). **Task 3:** `decideEnvProject` and `decideHeadlessRead` directly above `displayPrefixes`' doc comment (after `decideScope`, about :4312); `SCOPE_SOURCES` becomes `Object.freeze(['tmux', 'env'])` in place (about :295, P1). | L1 | 1, 2, 3 |
| `ccd/history/lib.d.mts` | modify | **Task 1:** after `decideSeamInPane`'s declaration (about :524): `RECALL_ARMS`, the two bounds, `HeadlessPair`, `HeadlessList`, `parseHeadlessList`, `formatHeadlessList`, `HeadlessMarkerRead`, `headlessMarkerOf`. **Task 2:** `decideHeadless` after `headlessMarkerOf`'s declaration; `GenerationChoice.via` gains `'asof'` in place (about :525); `decideHeadlessStore`, `AsOfFamilyRow`, `asOfFamilySql` and `decideAsOfFamily` after `resolveGeneration`'s declaration. **Task 3:** `decideEnvProject` and `decideHeadlessRead` after `decideScope`'s (about :539); `SCOPE_SOURCES: readonly ['tmux', 'env']` in place (about :98). | types | 1, 2, 3 |
| `ccd/history/cli.mjs` | modify | **Task 3:** the read verbs' lib import gains two lines (after `  decideRecallOff, parseSpoolLine,`, about :60); the recall.mjs import gains `asOfCutOf`; the dispatcher's order comment gains the headless steps (after about :467); `readContext`'s `seen` gains `arm: null` (about :676); W2-2a's seam block in `readContextIn` (about :691-703) names the three values once as `recall` and sends an engaged seam to `readContextEnv`; `asOfRowsOf` and `readContextEnv` (steps 1 to 7, `seen.arm = head.arm;` at the admission) directly above `/** The recall.mjs runner each read verb calls.` (about :800). **Task 4:** the lib import line gains `RECALL_ARMS`; `recallLine` (about :603) writes `arm`; `countRecall`'s doc comment (about :646); `ReadDefect` (about :663) carries `arm`; `readContext` stamps `seen.arm` on its answer and passes it to `ReadDefect` (about :676-680); `readVerb`'s two `who` literals and its counter call. | L4 | 3, 4 |
| `ccd/history/sweep.mjs` | modify | **Task 4:** `applyEventLine`'s recall arm (about :830-831): the bump line gains `typeof rec.arm !== 'string' && ` after `c.replay !== true && `, and its comment a line. | L4 | 4 |
| `shared/lifecycle.ts` | modify | **Task 5:** the `history-switches` row (about :81-83): its root and tier lines, with a three-line comment above; `name`, `pattern`, `creators`, `collector`, `bound` and `ruling` unchanged. | L0 | 5 |
| `README.md` | modify | **Task 5:** one paragraph, `**The headless seam (W2's replay eval).**`, after the line ending `which the operator removes by hand.` (about :5866), before the section's `---` rule (R11). | docs | 5 |
| `server/test/history-lib.test.ts` | modify | **Task 1:** `W2-2b Task 1: RECALL_ARMS, the marker bounds, the marker grammar and its fold (W2-D42, W2-D44, W2-D48)`, 11 cases (pure; one reads real files through `readBounded`). **Task 2:** `W2-2b headless seam: decideHeadless, decideHeadlessStore and decideAsOfFamily, the seam's pure deciders (W2-D40, W2-D45, W2-D46)`, 8 cases (one on a real store's schema). | test | 1, 2 |
| `server/test/single-definition.test.ts` | modify | **Task 1:** in place, line-neutral, O14's `VOCABS` (its last two lines, about :5342-5343, become two that add the three names; the other `const VOCABS` at about :2833 is untouched); an appended describe, `ccrc history: the headless marker and the arm words are defined once, in lib.mjs, and read one way (W2-D42, W2-D44; W2-2b Task 1)`, 4 cases. | test (citation corpus) | 1 |
| `server/test/history-cli.test.ts` | modify | **Task 3:** in place, W2-2a Task 5's case (b), `CONTROL, no pane: the seam variables change nothing, …` (about :1563-1575), now `headless-unarmed` with a no-seam `no-identity` CONTROL (R8); `W2-2b Task 3: the env path's own decisions and its source shape (R1; W2-D40, W2-D41, W2-D46)`, 3 pure cases; `W2-2b Task 3: the headless path, wired in the W2-D46 order (…)`, 10 spawned cases; `W2-2b Task 3: box verbs ignore the seam (W2-D47; C28 extended)`, 1 spawned case. **Task 4:** `W2-D43 and W2-D46: the counter line on the env path carries its arm (W2-2b Task 4)`, 4 cases (the `recallLine` case in a child process); `C-R: a treatment-arm run on a live A/B family writes a non-null arm, and the window does not count it (W2-2b Task 4)`, 1 case. **Task 5:** `README states the headless seam: its variables, the marker, the refusal words in their order (W2-2b Task 5)`, 3 pure cases. No import line is added: helpers through `healthHh`, modules through dynamic `import()`. | test | 3, 4, 5 |
| `server/test/history-sweep.test.ts` | modify | **Task 4:** `W2-D43: the drain skips the recall_off_stale bump for a line carrying arm (W2-2b Task 4)`, 2 cases (in process, and drained by the pass). | test | 4 |
| `server/test/lifecycle.test.ts` | modify | **Task 5:** in place, `declares history-switches`' root pin (about :1216-1225; 2 lines become 3); one case appended as the manifest describe's last, after W2-1's `declares history-recall-off` case (ends about :1358), holding the tier to `HEADLESS_LIST_MAX_BYTES`, `parseHeadlessList` and `formatHeadlessList`. `HISTORY_ROWS_BY_PR` and `HISTORY_LANDED` unchanged. | test | 5 |
| `ccd/history/recall.mjs`, `server/test/history-recall.test.ts` | not modified | Consumed and re-run (C4, C24, C48, C68, F6). | L4, test | 3, 4, 6 |
| this plan | modify (conditional) | **Task 6:** only to correct a figure its own text predicted, if a step measures another. | docs | 6 |

## Drifts since the decisions document

The decisions document was written at `bd363a76b`; the anchors are `d119d6e90`'s. Each row gives what the document says, what the code at the base says, and what that changes here.

| Document says | Code at `d119d6e90` | Effect | Task |
|---|---|---|---|
| W2-D12, W2-D44: O14's `VOCABS` "at single-definition.test.ts:5228" | The O14 describe is at about :5319, its `VOCABS` ends at about :5342-5343 (`'RECALL_OFF_KEYS'] as const;`); another `const VOCABS` (another describe) sits at about :2833 | Edited by content, two lines for two, so the citation census cannot move; the :2833 list is untouched; Task 6 selects the three `it.each` rows by title | 1, 6 |
| W2-D44: "Path: `historyPaths(home).headlessOn`", as if new | `historyPaths(home).headlessOn` (lib about :459), `SWITCHES.headlessOn` (about :132) and its `lib.d.mts` field exist since W2-1 (W2-D29) | No path is added; the one-read pin allows `historyPaths`' own line | 1 |
| W2-D44: a generic bounded reader "(the `presenceOf(p)` shape)", O_RDONLY\|O_NOFOLLOW\|O_NONBLOCK, at most 65,537 bytes | `presenceOf` reads at most `FIELD_READ_MAX` (4,096) bytes and trims; store.mjs's `readBounded(path, max, follow)`, already imported by cli.mjs, is D-4347's generic reader: one open with those flags plus O_NOCTTY, type and size judged on the descriptor, at most `max` + 1 bytes, answering `absent`, `unreadable`, `over-cap` or `value` (text, replacement-decoded, untrimmed) | `readBounded` is the marker's reader, no new one (R1); CR and edge whitespace reach the parser untrimmed | 1, 3 |
| W2-D44: `parseHeadlessList(text)` "decodes UTF-8 fatally" | A text argument cannot be decoded again, and `readBounded` decodes with replacement | A text holding U+FFFD is malformed (an invalid byte, a lone surrogate, a literal U+FFFD), stated in D-5768 (R2) | 1 |
| W2-D46 step 1: "unreadable or malformed → `headless-malformed`" | `readBounded` has a fourth answer, `over-cap` | `headlessMarkerOf` folds `over-cap` with `unreadable` (mutant M27) | 1 |
| W2-D48, W2-D12: `REASON_ROWS` as the document knew it | W2-1 and W2-2a appended `generation-malformed`, `generation-mismatch` and `asof-invalid` (about :59-64): `REASONS` 54 keys, `REFUSALS` 36; `headless-unarmed`, `headless-in-pane`, `headless-unlisted`, `no-identity`, `bad-id` and `cross-project` already exist | The two words go after `asof-invalid`'s line: 56 and 38 after; Task 1's C16 case asserts the old seam words as a CONTROL | 1, 6 |
| W2-D40 and E8 "§8.2:1508"; W2-D44 and E9 "§8.2:1524-1526"; E10 "§8.2:1528"; E2 "§8.3 (:1670)"; E7 and W2-D49 "§9.4 (:2170)" | The generation chain is at about :1509 and `--workspace` at about :1514; the headless bullets at about :1525-1531 (the pairs sentence :1527, "Uses are counted `scope_source=env`." :1529); §8.3's exit-2 row at about :1671; §9.4's switches row at about :2171; §9.7's headless-on row at about :2307 | The three entries cite "about :NNN at d119d6e90"; code comments cite by content (D-5893); Task 6 asserts each rev 3.6 sentence by content, once | 1, 2, 4, 6 |
| W2-2a R3: `decideHeadless` calls `recallSeamEngaged` and `decideSeamInPane` or folds them | Both exported (lib about :4230 and :4238), called by `readContextIn` (about :694), pinned by W2-2a Task 5's describes | Called, not folded (R1): both stay exported and unchanged; Task 2 scans `decideHeadless` for a second spelling (H9) | 2, 3 |
| W2-D40: "`--session <own id>` uses the resolved generation (cli.mjs:745-746)" | The tmux line is `const famGen = …` at about :764-765, reading `$REG/<id>.generation` for own and other ids; lib's `decideScope` own-id arm is `generation: session === i.id ? i.generation.value : null` (about :4327) | The env path never runs the cli line; it hands `decideScope` `{ value: generation, via: 'asof' }`, so `decideScope` needs no edit; C48 stays tmux-only | 2, 3 |
| W2-D40: the ASOF row "sits on a main transcript" (no column named) | D-6281 (W2-2a review): `entries.transcript_pk` and `boundaries.transcript_pk` can diverge; `asOfCutOf` uses the boundaries row's | `asOfFamilySql` joins `transcripts` on `bd.transcript_pk`; Task 2 plants the D-6281 shape (F12) | 2 |
| W2-D40: "following merged_into" | `mergeFamily` moves every epoch into (id, G); recall.mjs's `ownFamily` follows one hop | One hop (the `into_*` columns); a hop landing on a merged row refuses `asof-invalid` (fail closed) | 2 |
| W2-D40: `decideAsOfFamily({session, asof, rows, list, storeId})`, `rows` undefined | No such statement; W2-2a's precedent is lib returning SQL text (`asOfEntrySql`) | lib gains `asOfFamilySql()` with Task 3's column names (R3); history-lib runs it on a real schema; the CLI's `asOfRowsOf` runs it | 2, 3 |
| W2-D44: the store line is checked against "this store's meta `store_id`" | `readContextIn`'s `storeId` holds the meta value when present, else `refusalStoreId`'s binding-file fallback | `decideHeadlessStore`, and `decideAsOfFamily` through it, takes the meta value or `null`; the CLI calls it before the ASOF rows are read (R3) | 2, 3 |
| W2-D40: the resolved generation's `via` is `'asof'` | `lib.d.mts`' `GenerationChoice.via` is `'env' \| 'registry' \| 'newest'` (about :525), and `ScopeInputs.generation` is a `GenerationChoice` | `GenerationChoice.via` gains `'asof'` (R3, Task 2); `ScopeInputs` needs no edit | 2, 3 |
| W2-D41: `decideScope` runs with `source: 'env'` | `SCOPE_SOURCES` is `Object.freeze(['tmux'])` (lib about :295; `lib.d.mts` about :98); history-lib's C50 case refuses each non-member and runs its table under each member | Task 3 adds `'env'` (P1); C50's table then runs under `'env'` too, unedited | 3 |
| W2-D39 (W2-2a, as amended): with no pane the CLI still answers `no-identity`, pinned by W2-2a Task 5's case (b) | That case runs each seam variable with no pane and expects `no-identity` (about :1563-1575) | W2-D46 step 1 answers `headless-unarmed` there on a box with no marker; Task 3 edits case (b) in place and keeps a no-seam `no-identity` CONTROL (R8) | 3 |
| W2-D46 step 5: recall-off against the resolved generation, after admission | The tmux path decides recall-off before the store when the generation came from env or the registry (`offNow`) | The env path decides it after step 4 only (`decideHeadlessRead`); the tmux path is unchanged | 3 |
| W2-D46: a counter line iff step 4 admitted | `readVerb` counts any answer whose `id` is a string (D-5023); the tmux path's harness and store refusals carry the id | Every env refusal of steps 1 to 4 passes a null id; `seen.id` is set only at admission | 3, 4 |
| W2-D43: "the `arm` field on counter lines", as if new | The spool grammar admits an optional `arm` (`SPOOL_VALUE.arm`, `/^[a-z]{1,16}$/`), `recall_calls.arm` is a v1 column, the drain inserts `rec.arm ?? null`; `refusal`, `ReadDefect`, `readContext` and `readVerb` carry no arm | No lib, store or schema edit for it; Task 3 sets `seen.arm`, Task 4 writes and carries it (R4) | 3, 4 |
| W2-D43's C-R pin: W2-3's window in `deploy/history-gate.mjs` filters `arm IS NULL` | The filter is W2-D13's, in `deploy/measure-history.py`'s `family_report`; the gate's `CallRow` is "one recall_calls row with arm NULL" | Task 4 runs both, read-only, as W2-1's RP8 does; its CONTROL drops the filter | 4 |
| (no document text) where `recallLine` lives | cli.mjs, about :603, exported; importing cli.mjs in process sets the process's umask | Task 4's `recallLine` case runs in a child process | 4 |
| W2-D41: "a family with no visible epoch is dropped from the scope and its count" | W2-2a's `visibleScope` drops it at the header, the `--json` scope and tree's headings and leaves `rc.scope` intact (W2-2a R5) | No narrowing of `rc.scope`; Task 3's "seam widened" pins the count and names under env | 3 |
| W2-D41: exit 2 `cross-project` | A W1 exit-2 word in `REASON_ROWS` | No new word; `decideEnvProject` answers it | 3 |
| W2-D47: status, doctor and the operator verbs ignore the seam | `main` dispatches them before `readVerb`; the three reads live only in `readContextIn` | Holds by construction; Task 3 pins it (M25) | 3 |
| W2-D39: `ALLOWED` "at single-definition.test.ts:5364" | About :5467, already seven names (W2-2a) | No new env name is read; Tasks 3 and 6 re-run the allow-list and holders scans | 3, 6 |
| W2-D49 and §2: the pin at lifecycle.test.ts:1183-1184; W2-D9: ":1077-1102 and :1183" | `declares history-switches` is at about :1216-1225 (root pin about :1224); `HISTORY_ROWS_BY_PR` (about :1095) lists the row under B1 and `HISTORY_LANDED` holds B1; W2-1's `declares history-recall-off` is the describe's last case (ends about :1358) | Edited in place by content; the new case goes after W2-1's; no key or `HISTORY_LANDED` edit | 5, 6 |
| §9.4's row spells `history/headless-on` relative to `~/.ccrc` | `shared/lifecycle.ts` spells each root path in full | `~/.ccrc/history/headless-on`, held to `SWITCHES` by the new case | 5 |
| §2 Files: "README.md (the seam)" | README has no seam or as-of text; its Session history section runs from about :5784 to the `---` rule at about :5868 | A new paragraph after about :5866 (R11); Task 6's `readme-section.mjs` reds any README change outside the section | 5, 6 |
| §2 Tests: "history-recall" among the appended suites | No task needs a history-recall case: the env path is reachable only through the CLI, and the cut's in-process doors are W2-2a's | history-recall is re-run, not appended | 3, 4, 6 |
| The brief's "section 7 and its D-numbers list" | Section 7 holds residuals only; each number's "Defined in" is §6's last column and each W2-D build line; the ledger lists the 19-number W2 block | The three slugs are §6's, prefixed `history-w2-` as W2-2a's are | 6 |
| The decisions predate the armed growth check (D-6178), its exemptions (D-6211) and its waiver ledger (D-6223) | `GROWTH_FILES` lists nine paths, none of them `shared/lifecycle.ts`, README or `ccd/history/`; `L1_L2_NEW_FILE_DIRS` names `shared/`, for added files only | Nine `delta +0` rows; no waiver, no exemption | 6 |
| W2-D42 and W2-D12: the arm words live once, as `RECALL_ARMS` | `deploy/history-gate.mjs` declares `ASSIGNMENT_ARMS = Object.freeze(['treatment', 'control'])` (about :70) | No collision for D-5774's or O14's name scans; outside W2-2b (`deploy/**`), a residual for W2-5b (R10) | 1, 6 |
| W2-2a's rules-same figures, measured at `cd622b2f6` | At `d119d6e90`: 67 redaction declarations; `4f9d7ac4d` to `d119d6e90` reads `changed: none` | Task 6 Step 3 runs it as a second, clean CONTROL | 6 |

## Not in this plan

- **W2-5b.** The `marker` subcommand that prints `formatHeadlessList`'s text (W2-D84) and handles its `RangeError` (for long ids the 65,536-byte bound binds before the 1,000-pair one); the driver's scan that it imports `RECALL_ARMS` and never spells the words (W2-D42), and the parity of `ASSIGNMENT_ARMS` with `RECALL_ARMS` (R10); W2-D78 (i)'s `family-unlisted` over `parseHeadlessList`; RP1-arm with the real ARM values (W2-D50); the spec errata **E2** (its W2-2b half), **E7**, **E8**, **E9** and **E10** (decisions §6), amended in place by W2-5b, never by W2-2b.
- **W2-D50's arm env.** W2-4's RP1-contract and W2-5b's RP1-arm assert it. This PR needs nothing beyond the three seam names, already on the allow-list.
- **The `arm IS NULL` window.** W2-3's (W2-D13), consumed read-only by Task 4's C-R pin.
- **The display doors and the widened rules** (the ledger's "Later" item): left open; Task 6 Step 3 measures that this PR moves no redaction declaration (D-5745).
- **A marker writer.** Nothing in the tree writes `headless-on` (O13); the operator writes it for an eval window and removes it.
- **The rollout** (W2-D6, W2-D10) and **the window and its operator acts** (decisions §5): the coordinator's or the operator's, never the worker's.

**PR:** One PR against `main`, on this workspace's own branch, executed in task order: six tasks, one commit each, the sixth only when Task 6 corrects a figure in this plan:
1. `feat(history): the headless seam's arm words, the marker's grammar and its fold in lib, and two refusal words (W2-2b Task 1; W2-D42, W2-D44, W2-D48, W2-D12; D-5768, D-5769)`;
2. `feat(history): the headless seam's pure deciders, decideHeadless, decideHeadlessStore and decideAsOfFamily (W2-2b Task 2; W2-D40, W2-D45, W2-D46; D-5767, D-5768)`;
3. `feat(history): the read verbs take the headless path in W2-D46's order, counted once admitted (W2-2b Task 3; W2-D40, W2-D41, W2-D45, W2-D46, W2-D47; D-5767)`;
4. `feat(history): a counted env call carries its arm, and the drain skips recall_off_stale for it (W2-2b Task 4; W2-D43, W2-D46)`;
5. `feat(history): the history-switches row names headless-on and its 64 KiB bound, and README states the headless seam (W2-2b Task 5; W2-D49, W2-D44, W2-D46, W2-D47, W2-D48)`;
6. `docs(history): the W2-2b plan's predicted figures, as measured (W2-2b Task 6; W2-D4)`, only when needed.

Task 1 goes first: every later task reads its words and its marker. Task 2 needs Task 1's `RECALL_ARMS`, parser, fold and words. Task 3 needs Tasks 1 and 2: it wires Task 2's deciders. Task 4 needs Task 3's admission (`seen.id`, `seen.gen`, `seen.arm`, `head`). Task 5 reads Tasks 1 to 4's names and touches none of their regions. Task 6 checks Tasks 1 to 5 and runs last. Every task leaves every suite green at its commit. Task 6 Step 9 opens the PR, only after Steps 0 to 8, ready for review (not a draft), titled **"ccrc history wave W2-2b: the headless seam"**, with the body Task 6 Step 8 gives. The plan's "## Deviations found" comes at its end, after Task 6, holding D-5767 (Task 2's entry), D-5768 and D-5769 (Task 1's), in that order.

---

### Task 1: lib's seam vocabulary and the marker grammar, pure (W2-D42, W2-D44, W2-D48, W2-D12)

Every later task of this plan reads the seam's words and the marker through what this task adds, and nothing else: Task 2's `decideHeadless` checks the arm against `RECALL_ARMS` and takes the marker as `headlessMarkerOf` folded it; Task 3's CLI makes the marker's one read (R1); W2-5b's replay driver imports `RECALL_ARMS` and `parseHeadlessList`, and its `marker` subcommand prints `formatHeadlessList`'s text (W2-D78 (i), W2-D84). lib.mjs is L1: it imports `node:crypto` alone and reads no file. So the marker is split the way every lib decision is:
- the read is **store.mjs's `readBounded`**, unchanged, the generic bounded reader W2-D29 already uses for `recall-off/<id>`. It takes a path argument, opens once with O_RDONLY|O_NONBLOCK|O_NOCTTY plus O_NOFOLLOW when `follow` is false, judges the type on the descriptor, reads at most `max` + 1 bytes, and answers `absent`, `unreadable`, `over-cap` or `value` (this plan's "Drifts since the decisions document": cli.mjs's `presenceOf`, the shape W2-D44 names, reads at most 4,096 bytes and trims, so it cannot be the marker's reader);
- `headlessMarkerOf(read)` folds that answer (R1): absent is exit 2 `headless-unarmed`; unreadable and over-cap are exit 2 `headless-malformed`, never absent (IV5); a value goes to `parseHeadlessList`;
- `parseHeadlessList(text)` is W2-D44's grammar, pure, over text (R2); `formatHeadlessList({ storeId, pairs })` is its paired formatter and the only producer of marker text;
- `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES` and `HEADLESS_LIST_MAX_PAIRS` are declared once, typed, and appended to O14's `VOCABS` (W2-D12);
- `headless-malformed` and `headless-arm-unknown` join `REASON_ROWS`' exit-2 list, so `REFUSALS` holds them (W2-D48, C16).

This task changes nothing a session sees. No door reads the marker, checks an arm or prints either new word until Task 2 builds `decideHeadless` and Task 3 wires it into cli.mjs; the read verbs' path is byte-identical to W2-2a's.

**Order.** This is the plan's first task. It edits two regions of lib.mjs (`REASON_ROWS`' last exit-2 line, and a new block directly after `decideSeamInPane`), one region of `lib.d.mts`, two lines of `single-definition.test.ts` in place (line-neutral), and appends one describe to the end of each of `history-lib.test.ts` and `single-definition.test.ts`. It first cites D-5768 and D-5769, whose entries are in this plan's "Deviations found" and land on `main` with the plan before dispatch (R9); this task cites them in lib.mjs's comments and defines nothing. Line numbers are hints measured at `d119d6e90`; every edit is anchored by content, and Step 4's script asserts that each anchor occurs exactly once.

**Files:**
- Modify: `ccd/history/lib.mjs`:
  - `REASON_ROWS`' exit-2 list. After `    'asof-invalid',` (about :64 at d119d6e90), before the list's `  ]],`, a four-line comment ending `// D-5769 (history-w2-headless-refusal-words)`, then `    'headless-malformed', 'headless-arm-unknown',`. `REASONS` and `REFUSALS` stay derived: 54 and 36 keys at the base, 56 and 38 after.
  - A new section, `the headless seam's vocabulary and its marker`, directly after `decideSeamInPane`'s body (`export function decideSeamInPane({ pane, recall }) {`, about :4238 at d119d6e90) and before `decideIdentity`'s doc comment (`/** The session's id from tmux (§8.2, D-4675 (history-identity-from-tmux)). The`). It holds `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES`, `HEADLESS_LIST_MAX_PAIRS`, six module-private constants (`HEADLESS_STORE_PREFIX`, `HEADLESS_LEGACY_GENERATION`, `HEADLESS_REPLACEMENT_CHAR`, `HEADLESS_PAIR_RE`, `HEADLESS_UNARMED`, `HEADLESS_MALFORMED`), `parseHeadlessList`, `formatHeadlessList` and `headlessMarkerOf`. It calls the module's own `refuseScope` (about :4223), `idOk` (about :382) and `UUID_RE` (about :256), all above it, and the `Buffer` global lib already uses. No new import.
- Modify: `ccd/history/lib.d.mts`: one block directly after `export function decideSeamInPane(i: { pane: string | null; recall: RecallSeamValues }): { ok: true } | ScopeRefusal<'headless-in-pane'>;` (about :524), holding `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES`, `HEADLESS_LIST_MAX_PAIRS`, `HeadlessPair`, `HeadlessList`, `parseHeadlessList`, `formatHeadlessList`, `HeadlessMarkerRead` and `headlessMarkerOf`. `ScopeRefusal<R>` (about :517) is reused. lib.d.mts imports nothing, so `HeadlessMarkerRead` restates store.d.mts's `BoundedRead` structurally.
- Test: `server/test/history-lib.test.ts`: one describe appended at the end of the file, 11 cases. No import line: lib is reached by dynamic import, and the file-level `EXIT`, `REASONS`, `REFUSALS`, `SPOOL_ID_MAX`, `readFileSync`, `fileURLToPath`, `join`, `spawnSync`, `mkTmp`, `t17fs` (`node:fs`, namespace) and `replayStore` (store.mjs, namespace) are already imported.
- Test: `server/test/single-definition.test.ts`:
  - in place, line-neutral: O14's `VOCABS` (the describe `ccrc history: every vocabulary is declared once, in lib.mjs, and bound to its uses`, about :5319 at d119d6e90). Its last two lines, `    // W2-1 Task 4 (W2-D30): the presence record's meta keys, each built from RECALL_OFF_META.` and `    'RECALL_OFF_KEYS'] as const;` (about :5342-5343), are replaced by two lines that add the three names. The file's other `const VOCABS` (about :2833) is a different describe and is not touched.
  - one describe appended after the last describe (about :8496), 4 cases, with no import line. `HISTORY_MJS`, `ALL_MJS`, `stallCode` and `rel` are the CCRC HISTORY block's.
- Not edited: `cli.mjs`, `sweep.mjs` and `recall.mjs` (later tasks, and only mutants here); `store.mjs` (its `readBounded` is consumed as it is); `derive.mjs`, `regex-worker.mjs`; `recallSeamEngaged` and `decideSeamInPane` (W2-2a's; Task 2's `decideHeadless` calls them, R1); the spec; README.md; `shared/lifecycle.ts`; `ccd/history-skill/SKILL.md` (its exit-2 row is generic, W2-D48).

**Interfaces:**
- Consumes (base, unchanged):
  - `lib.mjs`: `UUID_RE` (lowercase 8-4-4-4-12), `idOk(id)` (`^[A-Za-z0-9._-]+$`, not `.` or `..`, at most `SPOOL_ID_MAX` = 224 characters), the module-private `refuseScope(reason)` answering `{ ok: false, rc: EXIT.REFUSED, reason }`, `EXIT`, `REASON_ROWS`, `REASONS`, `REFUSALS`; `historyPaths(home).headlessOn` and `SWITCHES.headlessOn` (`.ccrc/history/headless-on`), both added by W2-1 (W2-D29).
  - `lib.d.mts`: `ScopeRefusal<R extends string> { ok: false; rc: 2; reason: R }`.
  - `store.mjs`: `readBounded(path, max, follow): { state: 'absent' } | { state: 'unreadable' } | { state: 'over-cap' } | { state: 'value', value: string }` (store.d.mts's `BoundedRead`). Its value is `buf.toString('utf8')`, so an invalid byte arrives as U+FFFD.
- Produces:
  - `lib.mjs`: `export const RECALL_ARMS = Object.freeze(['control', 'treatment'])`.
  - `lib.mjs`: `export const HEADLESS_LIST_MAX_BYTES = 65536` and `export const HEADLESS_LIST_MAX_PAIRS = 1000`.
  - `lib.mjs`: `export function parseHeadlessList(text)`: `text: string` (anything else throws `TypeError`). Answers either
    - `{ ok: true, storeId: string, pairs: readonly { ccrcId: string, generation: string }[] }`, the answer, its `pairs` and each pair frozen; `storeId` is the store line's lowercase UUID; `pairs` are in file order with duplicates kept; `generation` is a lowercase UUID, or `''` for a line that spells it `-`; zero pairs is `pairs: []`, never malformed; or
    - `{ ok: false, rc: 2, reason: 'headless-malformed' }` (one frozen object).
  - `lib.mjs`: `export function formatHeadlessList({ storeId, pairs }): string`: `store <storeId>\n`, then `<ccrcId> <generation or ->\n` per pair in the given order. It throws `TypeError` for a store id that is not a lowercase UUID, `pairs` that is not an array, an id `idOk` refuses or spelled `store`, or a generation that is neither `''` nor a lowercase UUID; `RangeError` for more than `HEADLESS_LIST_MAX_PAIRS` pairs or text longer than `HEADLESS_LIST_MAX_BYTES` bytes. For every list it accepts, `parseHeadlessList(formatHeadlessList(x))` deep-equals `{ ok: true, ...x }` and formatting that answer gives the same bytes.
  - `lib.mjs`: `export function headlessMarkerOf(read)`: `{ state: 'absent' }` answers `{ ok: false, rc: 2, reason: 'headless-unarmed' }`; `unreadable`, `over-cap` and any other shape answer `{ ok: false, rc: 2, reason: 'headless-malformed' }`; `{ state: 'value', value }` answers `parseHeadlessList(value)`.
  - `lib.d.mts`: one declaration each of `RECALL_ARMS: readonly ['control', 'treatment']`, `HEADLESS_LIST_MAX_BYTES: 65536`, `HEADLESS_LIST_MAX_PAIRS: 1000`, `HeadlessPair`, `HeadlessList` (`{ readonly ok: true; readonly storeId: string; readonly pairs: readonly HeadlessPair[] }`), `parseHeadlessList(text: string): HeadlessList | ScopeRefusal<'headless-malformed'>`, `formatHeadlessList(list: { storeId: string; pairs: readonly HeadlessPair[] }): string`, `HeadlessMarkerRead` and `headlessMarkerOf(read: HeadlessMarkerRead): HeadlessList | ScopeRefusal<'headless-unarmed' | 'headless-malformed'>`.
  - `REASONS['headless-malformed'] === 2` and `REASONS['headless-arm-unknown'] === 2`, so `REFUSALS` holds both.
- The contract later tasks keep, pinned by this task's single-definition describe:
  - the marker is read on ONE code line in ccd/history, of the shape `readBounded(<expr>.headlessOn, HEADLESS_LIST_MAX_BYTES, false)` (a namespace prefix such as `healthStore.` or `healthLib.` is allowed), whose answer goes to `headlessMarkerOf`; Task 3 writes it as R1 gives it, `const marker = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));`; no other ccd/history code line names `.headlessOn` except `historyPaths`' own field, so no line pairs an open, an `existsSync` or a `readFileSync` with the marker's path (O13, W2-D44);
  - the arm is checked as `RECALL_ARMS.includes(arm)`; no ccd/history code line quotes `'control'` or `'treatment'` but `RECALL_ARMS`' own;
  - Task 2's `decideHeadless` answers `headless-unlisted` for a parsed marker with zero pairs, and Task 2's `decideHeadlessStore` (which `decideAsOfFamily` calls first) for one whose store line is not this store's meta `store_id`, at admission (W2-D46 step 4, R2, R3): `parseHeadlessList` decides neither.

**Choices this task makes:**
- **The reader is reused, not written (R1).** store.mjs's `readBounded(path, HEADLESS_LIST_MAX_BYTES, false)` is exactly W2-D44's read: a path argument, one O_RDONLY|O_NOFOLLOW|O_NONBLOCK open (plus O_NOCTTY), a regular-file check on the descriptor, and at most 65,537 bytes read (its buffer is the measured size plus one, and a size over the bound answers `over-cap` before any read). A second reader in cli.mjs would be a second spelling of D-4347's rule; store.mjs is not touched.
- **"Decodes UTF-8 fatally", over text (R2).** The reader's answer is already text, decoded with replacement. So the fatal decode is the rule "a text whose UTF-8 round trip holds U+FFFD is malformed": an invalid byte (which `readBounded` turned into U+FFFD), a lone surrogate (which becomes U+FFFD on the way to bytes) and a literal U+FFFD all fail closed. No hand-written list needs the character. D-5768's entry states it.
- **`HEADLESS_REPLACEMENT_CHAR` is `String.fromCharCode(0xfffd)`**, and the tests build every non-ASCII fixture character with `String.fromCharCode`, never a backslash-u escape: an agent's file write decodes those escapes, so a plan or a source file that spelled one would not hold what it says.
- **The bound is in bytes, checked first.** `Buffer.from(text, 'utf8').length > HEADLESS_LIST_MAX_BYTES` is malformed whatever the reader did, so a caller that hands `parseHeadlessList` text it read some other way (W2-5b's driver, W2-D78 (i)) gets the same bound; a 65,536-character text of 65,537 bytes is malformed (the case pins bytes, not characters).
- **Before the store line, only comments (R2's strictures, fail closed, in D-5768).** W2-D44: "the first non-comment line must be `store <store_id>`". An empty line is not a comment, so an empty line before the store line is malformed; after it, empty lines are allowed.
- **A second store line is any later line that begins `store `.** So `store -` after the store line is malformed, not a pair, and an id spelled `store` cannot be listed: `formatHeadlessList` refuses it (TypeError), which keeps the round trip whole. Real ids carry a wrapper prefix (`<wrapper>-<project>`), so no family is lost.
- **Whitespace is `\s` at either end of any line, comments included.** That catches a byte-order mark and a no-break space; a tab or a second space between the two fields fails the exact `<ccrc_id> <generation>` shape instead. A CR anywhere, mid-comment included, is malformed.
- **Duplicates are kept, and counted.** "Duplicate pairs are tolerated": the answer keeps every pair line in file order, and the 1,000 bound counts pair lines, duplicates included, so the parser's work stays bounded by lines, never by distinct pairs.
- **The answer is a `ScopeRefusal`, frozen.** `{ ok: false, rc: 2, reason }` is how lib's deciders answer a refusal (`decideSeamInPane`, `asOfCut`), so `decideHeadless` passes it through unchanged. One frozen object per word, so no caller can mutate a shared answer.
- **The formatter refuses what the parser would not read back**, TypeError for a grammar fault and RangeError for a bound, so its output always parses: 300 pairs of 224-character ids pass 65,536 bytes before they pass 1,000 pairs, and the case pins that bound separately.
- **The arm words are quoted once in ccd/history.** O14's `VOCABS` row checks only that `RECALL_ARMS` is declared once; a reader that spelled `'control'` would stay green. The single-definition describe pins the quoted words to `RECALL_ARMS`' line (W2-5b's scan does the same for the driver, W2-D42). `deploy/history-gate.mjs` quotes the words for W2-3's assignment and is outside this scan's corpus.

**Residuals, named:** A `.headlessOn` path held in a variable or destructured on one line and read on a later line is not seen by the reader-shape scan (the known width O13's own scans state). A literal U+FFFD in a comment is malformed (fail closed, D-5768). Both new words reach no door in this task: their spawned C16 checks come with Task 3.

- [ ] **Step 0: Check the base holds W2-2a.** From the repository root, before any edit. W2-2b's base is `main` after #1126 merged; the merge commit's SHA is the queue's, so the check is by content:

```bash
grep -c '^export function asOfCut({ asof, boundary, copy, kept }) {$' ccd/history/lib.mjs
grep -c '^export function asOfCutOf(rc, asof) {$' ccd/history/recall.mjs
grep -c "^    'asof-invalid',$" ccd/history/lib.mjs
```

Expected: `1`, `1`, `1`. On any `0`, make no edit and report to the coordinator: W2-2a is not on this base.

- [ ] **Step 1: Confirm the anchors, that no name is taken, the two entries, and the base counts.** From the repository root:

```bash
grep -c "^  if (typeof pane === 'string' && recallSeamEngaged(recall)) return refuseScope('headless-in-pane');$" ccd/history/lib.mjs
grep -c '^export function decideSeamInPane(i: { pane: string | null; recall: RecallSeamValues }): { ok: true } | ScopeRefusal<.headless-in-pane.>;$' ccd/history/lib.d.mts
grep -cxF '    headlessOn: `${h}/${SWITCHES.headlessOn}`,' ccd/history/lib.mjs
grep -c '^export function readBounded(path, max, follow) {$' ccd/history/store.mjs
grep -cxF "    // W2-1 Task 4 (W2-D30): the presence record's meta keys, each built from RECALL_OFF_META." server/test/single-definition.test.ts
grep -cxF "    'RECALL_OFF_KEYS'] as const;" server/test/single-definition.test.ts
grep -c '^- \*\*D-5768\*\* — `history-w2-marker-grammar`' docs/superpowers/plans/2026-10-22-ccrc-history-w2-2b-headless-seam.md
grep -c '^- \*\*D-5769\*\* — `history-w2-headless-refusal-words`' docs/superpowers/plans/2026-10-22-ccrc-history-w2-2b-headless-seam.md
grep -c 'RECALL_ARMS\|HEADLESS_LIST_MAX\|parseHeadlessList\|formatHeadlessList\|headlessMarkerOf\|headless-malformed\|headless-arm-unknown\|HeadlessPair\|HeadlessList\|HeadlessMarkerRead' ccd/history/*.mjs ccd/history/lib.d.mts deploy/*.mjs server/test/history-lib.test.ts server/test/single-definition.test.ts
```

Expected (measured at `d119d6e90`): `1` for each of the first eight lines (the last two: this plan's entries, on `main` with it, R9); `0` for every file on the last line.

Then record the base counts, each in the foreground with a timeout of at least 600000 ms, one suite per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts)
```

Write each `N passed` (and any `skipped`) to `.superpowers/sdd/history-w2-2b/base-counts-task1.txt` (gitignored), creating the directory first with `mkdir -p .superpowers/sdd/history-w2-2b`. Every file must be green at the base.

- [ ] **Step 2: Write the failing tests.** Three edits.

(a) `server/test/history-lib.test.ts`: append after the file's last line:

```ts

// ── W2-2b Task 1 (W2-D42, W2-D44, W2-D48): the headless seam's vocabulary and the marker, pure ────────────────────────
// RECALL_ARMS is the arm vocabulary decideHeadless checks and the replay driver imports; HEADLESS_LIST_MAX_BYTES and
// HEADLESS_LIST_MAX_PAIRS bound headless-on; parseHeadlessList is its grammar and formatHeadlessList the one producer of
// its text; headlessMarkerOf folds the marker's one read, store.mjs's readBounded. Pure, so it runs on darwin too: the
// reader case reads real files in a scratch directory. Every non-ASCII fixture character is built with fromCharCode.
// D-5768 (history-w2-marker-grammar), D-5769 (history-w2-headless-refusal-words)
describe('W2-2b Task 1: RECALL_ARMS, the marker bounds, the marker grammar and its fold (W2-D42, W2-D44, W2-D48)', () => {
  type Lib = typeof import('../../ccd/history/lib.mjs');
  type Pair = { ccrcId: string; generation: string };
  const lib = async (): Promise<Lib> => await import('../../ccd/history/lib.mjs');
  const ch = (c: number): string => String.fromCharCode(c);
  const S = '0189abcd-1234-4678-9abc-00000000beef';   // the store's meta store_id
  const G1 = '0189abcd-1234-4678-9abc-0000000000a1';
  const MAL = { ok: false, rc: 2, reason: 'headless-malformed' };
  const UNARMED = { ok: false, rc: 2, reason: 'headless-unarmed' };
  const BASE = `store ${S}\nacct-a-demo ${G1}\n`;
  const listed = (pairs: Pair[], storeId = S): { ok: true; storeId: string; pairs: Pair[] } => ({ ok: true, storeId, pairs });

  it('C16, its two words: headless-malformed and headless-arm-unknown are exit-2 REASONS words, so REFUSALS holds them', () => {
    for (const w of ['headless-malformed', 'headless-arm-unknown']) {
      expect(REASONS[w], w).toBe(EXIT.REFUSED);
      expect(REFUSALS, w).toContain(w);
    }
    // CONTROL: the other words W2-D46's step 1 answers were exit-2 words before this task.
    for (const w of ['headless-unarmed', 'headless-in-pane', 'headless-unlisted', 'no-identity', 'bad-id', 'asof-invalid']) {
      expect(REASONS[w], w).toBe(EXIT.REFUSED);
    }
  });

  it('REASON_ROWS lists the two words on one line, beside their departure, D-5769', () => {
    const src = readFileSync(fileURLToPath(new URL('../../ccd/history/lib.mjs', import.meta.url)), 'utf8').split('\n');
    const at = src.findIndex((l) => l === "    'headless-malformed', 'headless-arm-unknown',");
    expect(at, 'REASON_ROWS lists the two words on one line').toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 4), at).join('\n')).toContain('D-5769 (history-w2-headless-refusal-words)');
  });

  it('RECALL_ARMS is the two arm words, in order, frozen; the marker\'s bounds are 65,536 bytes and 1,000 pairs', async () => {
    const l = await lib();
    expect(l.RECALL_ARMS).toEqual(['control', 'treatment']);
    expect(Object.isFrozen(l.RECALL_ARMS), 'RECALL_ARMS is frozen').toBe(true);
    expect(l.HEADLESS_LIST_MAX_BYTES).toBe(65536);
    expect(l.HEADLESS_LIST_MAX_PAIRS).toBe(1000);
  });

  it('parseHeadlessList: comments, the store line, then pairs, comments and empty lines; - is the legacy generation; the final LF is optional; duplicates kept in file order; zero pairs parses', async () => {
    const l = await lib();
    const text = ['# W2 quiz, node a', `store ${S}`, '', '# the pilot pairs', `acct-a-demo ${G1}`, 'acct-b-demo -', `acct-a-demo ${G1}`, ''].join('\n');
    const want = listed([{ ccrcId: 'acct-a-demo', generation: G1 }, { ccrcId: 'acct-b-demo', generation: '' }, { ccrcId: 'acct-a-demo', generation: G1 }]);
    const got = l.parseHeadlessList(text);
    expect(got).toEqual(want);
    expect(l.parseHeadlessList(text.slice(0, -1)), 'no final LF').toEqual(want);
    expect(got.ok && Object.isFrozen(got) && Object.isFrozen(got.pairs) && got.pairs.every((p) => Object.isFrozen(p)), 'one answer has one form').toBe(true);
    expect(l.parseHeadlessList(`store ${S}\n`), 'zero pairs parses: decideHeadless answers headless-unlisted for it').toEqual(listed([]));
    expect(l.parseHeadlessList(`# only a comment\nstore ${S}`)).toEqual(listed([]));
    expect(l.parseHeadlessList(`store ${S}\n${'a'.repeat(SPOOL_ID_MAX)} -\n`), 'an id at SPOOL_ID_MAX').toEqual(listed([{ ccrcId: 'a'.repeat(SPOOL_ID_MAX), generation: '' }]));
  });

  it('parseHeadlessList: every other shape is headless-malformed; CONTROL: the base marker each is cut from parses', async () => {
    const l = await lib();
    expect(l.parseHeadlessList(BASE), 'CONTROL').toEqual(listed([{ ccrcId: 'acct-a-demo', generation: G1 }]));
    const pair = `acct-a-demo ${G1}`;
    const shapes: Array<[string, string]> = [
      ['empty text', ''],
      ['comments and no store line', '# a\n# b\n'],
      ['an empty line before the store line', `\n${BASE}`],
      ['a pair before the store line', `${pair}\nstore ${S}\n`],
      ['a second store line', `${BASE}store ${S}\n`],
      ['a second store line naming -, never a pair', `${BASE}store -\n`],
      ['a store line naming no UUID', `store not-a-uuid\n${pair}\n`],
      ['an uppercase store id', `store ${S.toUpperCase()}\n${pair}\n`],
      ['two spaces after store', `store  ${S}\n${pair}\n`],
      ['CR LF line ends', BASE.replace(/\n/g, '\r\n')],
      ['a CR inside a comment', `# a\rb\n${BASE}`],
      ['leading whitespace on a pair', `store ${S}\n ${pair}\n`],
      ['trailing whitespace on a pair', `store ${S}\n${pair} \n`],
      ['trailing whitespace on a comment', `${BASE}# note \n`],
      ['a line of spaces', `${BASE}   \n`],
      ['a no-break space after the store id', `store ${S}${ch(0xa0)}\n${pair}\n`],
      ['a byte-order mark', `${ch(0xfeff)}${BASE}`],
      ['a tab between id and generation', `store ${S}\nacct-a-demo\t${G1}\n`],
      ['two spaces between id and generation', `store ${S}\nacct-a-demo  ${G1}\n`],
      ['three fields', `${BASE}${pair} x\n`],
      ['one field', `${BASE}acct-a-demo\n`],
      ['an uppercase generation', `store ${S}\nacct-a-demo ${G1.toUpperCase()}\n`],
      ['a generation neither a UUID nor -', `store ${S}\nacct-a-demo --\n`],
      ['an id off the grammar: ..', `store ${S}\n.. ${G1}\n`],
      ['an id off the grammar: a slash', `store ${S}\nacct/a ${G1}\n`],
      ['an id longer than SPOOL_ID_MAX', `store ${S}\n${'a'.repeat(SPOOL_ID_MAX + 1)} -\n`],
      ['U+FFFD, what readBounded writes for an invalid byte', `# a${ch(0xfffd)}b\n${BASE}`],
      ['a lone surrogate', `# a${ch(0xd800)}b\n${BASE}`],
    ];
    for (const [what, text] of shapes) expect(l.parseHeadlessList(text), what).toEqual(MAL);
    expect(REASONS[MAL.reason], 'the refusal is a REASONS word of its exit').toBe(EXIT.REFUSED);
    expect(() => l.parseHeadlessList(5 as never), 'text that is not a string is the caller\'s defect, named').toThrow(/the marker text is not a string/);
  });

  it('parseHeadlessList: the bounds are inclusive, counted in bytes and in pair lines', async () => {
    const l = await lib();
    const head = `store ${S}\n`;
    const fill = 65536 - Buffer.byteLength(head) - 2;   // the comment's '#' and its LF
    const at = `${head}#${'x'.repeat(fill)}\n`;
    expect(Buffer.byteLength(at), 'CONTROL: the fixture is exactly the bound').toBe(l.HEADLESS_LIST_MAX_BYTES);
    expect(l.parseHeadlessList(at), 'exactly 65,536 bytes').toEqual(listed([]));
    expect(l.parseHeadlessList(`${head}#${'x'.repeat(fill + 1)}\n`), 'one byte over').toEqual(MAL);
    const wide = `${head}#${ch(0xe9)}${'x'.repeat(fill - 1)}\n`;
    expect([wide.length, Buffer.byteLength(wide)], 'CONTROL: 65,536 characters, 65,537 bytes').toEqual([65536, 65537]);
    expect(l.parseHeadlessList(wide), 'the bound is in bytes, never characters').toEqual(MAL);
    const pairs = (n: number): string => `${head}${Array.from({ length: n }, (_, i) => `acct-${i}-demo -\n`).join('')}`;
    const r1000 = l.parseHeadlessList(pairs(1000));
    expect(r1000.ok && r1000.pairs.length, 'exactly 1,000 pairs').toBe(1000);
    expect(l.parseHeadlessList(pairs(1001)), '1,001 pairs').toEqual(MAL);
    expect(l.parseHeadlessList(`${head}${'acct-a-demo -\n'.repeat(1001)}`), 'the bound counts pair lines, duplicates included').toEqual(MAL);
  });

  it('formatHeadlessList: the store line, one line per pair in the given order, - for the legacy generation, one final LF, no comment', async () => {
    const l = await lib();
    expect(l.formatHeadlessList({ storeId: S, pairs: [{ ccrcId: 'acct-a-demo', generation: G1 }, { ccrcId: 'acct-b-demo', generation: '' }] }))
      .toBe(`store ${S}\nacct-a-demo ${G1}\nacct-b-demo -\n`);
    expect(l.formatHeadlessList({ storeId: S, pairs: [] })).toBe(`store ${S}\n`);
  });

  it('formatHeadlessList refuses every list parseHeadlessList would not read back: TypeError for the grammar, RangeError for a bound', async () => {
    const l = await lib();
    expect(() => l.formatHeadlessList({ storeId: S, pairs: [{ ccrcId: 'acct-a-demo', generation: G1 }] }), 'CONTROL').not.toThrow();
    const grammar: Array<[string, { storeId: string; pairs: Pair[] }]> = [
      ['a store id that is no UUID', { storeId: 'not-a-uuid', pairs: [] }],
      ['an uppercase store id', { storeId: S.toUpperCase(), pairs: [] }],
      ['the id store, which would read as a second store line', { storeId: S, pairs: [{ ccrcId: 'store', generation: '' }] }],
      ['an id off the grammar', { storeId: S, pairs: [{ ccrcId: 'acct a', generation: G1 }] }],
      ['an id longer than SPOOL_ID_MAX', { storeId: S, pairs: [{ ccrcId: 'a'.repeat(SPOOL_ID_MAX + 1), generation: '' }] }],
      ['- as a generation: it is the marker\'s spelling of \'\', not a generation', { storeId: S, pairs: [{ ccrcId: 'acct-a-demo', generation: '-' }] }],
      ['an uppercase generation', { storeId: S, pairs: [{ ccrcId: 'acct-a-demo', generation: G1.toUpperCase() }] }],
    ];
    for (const [what, x] of grammar) expect(() => l.formatHeadlessList(x), what).toThrow(TypeError);
    expect(() => l.formatHeadlessList({ storeId: S, pairs: null as never }), 'pairs that is not an array').toThrow(/pairs is not an array/);
    expect(() => l.formatHeadlessList({ storeId: S, pairs: [null as never] }), 'a pair that is not an object').toThrow(/undefined cannot be listed/);
    const many = Array.from({ length: 1001 }, (_, i) => ({ ccrcId: `acct-${i}-demo`, generation: '' }));
    expect(() => l.formatHeadlessList({ storeId: S, pairs: many.slice(0, 1000) }), 'CONTROL: 1,000 pairs').not.toThrow();
    expect(() => l.formatHeadlessList({ storeId: S, pairs: many }), '1,001 pairs').toThrow(RangeError);
    const long = Array.from({ length: 300 }, (_, i) => ({ ccrcId: `${String(i).padStart(3, '0')}${'a'.repeat(SPOOL_ID_MAX - 3)}`, generation: G1 }));
    expect(() => l.formatHeadlessList({ storeId: S, pairs: long.slice(0, 200) }), 'CONTROL: 200 long pairs fit').not.toThrow();
    expect(() => l.formatHeadlessList({ storeId: S, pairs: long }), '300 pairs of 224-character ids pass 65,536 bytes').toThrow(RangeError);
  });

  it('round trip: parseHeadlessList(formatHeadlessList(x)) answers x, and formatting the answer gives the same bytes', async () => {
    const l = await lib();
    let seed = 7;
    const rnd = (): number => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const lists: Array<{ storeId: string; pairs: Pair[] }> = [
      { storeId: S, pairs: [] },
      { storeId: S, pairs: [{ ccrcId: 'a'.repeat(SPOOL_ID_MAX), generation: '' }, { ccrcId: 'acct_b.demo', generation: G1 }] },
      { storeId: S, pairs: Array.from({ length: 1000 }, (_, i) => ({ ccrcId: `acct-${i % 7}-demo`, generation: i % 3 === 0 ? '' : G1 })) },
    ];
    for (let k = 0; k < 200; k += 1) {
      lists.push({ storeId: S, pairs: Array.from({ length: Math.floor(rnd() * 12) }, () => ({ ccrcId: `acct-${Math.floor(rnd() * 5)}-demo`, generation: rnd() < 0.3 ? '' : G1 })) });
    }
    expect(lists.filter((x) => x.pairs.some((p) => p.generation === '')).length, 'CONTROL: the lists carry legacy pairs').toBeGreaterThan(100);
    for (const x of lists) {
      const text = l.formatHeadlessList(x);
      const back = l.parseHeadlessList(text);
      expect(back, text.slice(0, 80)).toEqual({ ok: true, ...x });
      if (back.ok) expect(l.formatHeadlessList(back), 'formatting the answer gives the bytes back').toBe(text);
    }
  });

  it('headlessMarkerOf: absent is headless-unarmed; unreadable and over-cap are headless-malformed, never absent (IV5); a value is parseHeadlessList\'s answer', async () => {
    const l = await lib();
    expect(l.headlessMarkerOf({ state: 'absent' })).toEqual(UNARMED);
    expect(l.headlessMarkerOf({ state: 'unreadable' })).toEqual(MAL);
    expect(l.headlessMarkerOf({ state: 'over-cap' })).toEqual(MAL);
    expect(l.headlessMarkerOf({ state: 'value', value: BASE })).toEqual(l.parseHeadlessList(BASE));
    expect(l.headlessMarkerOf({ state: 'value', value: BASE }), 'CONTROL').toEqual(listed([{ ccrcId: 'acct-a-demo', generation: G1 }]));
    expect(l.headlessMarkerOf({ state: 'value', value: '' }), 'an empty marker is malformed, never unarmed').toEqual(MAL);
    // Any other shape is malformed, never unarmed and never thrown (IV5, fail closed).
    const odd: Array<[string, unknown]> = [['null', null], ['a value that is not text', { state: 'value', value: 5 }],
      ['an unknown state carrying text', { state: 'bogus', value: BASE }]];
    for (const [what, read] of odd) expect(l.headlessMarkerOf(read as never), what).toEqual(MAL);
  });

  it('the marker\'s one read, store.mjs readBounded at HEADLESS_LIST_MAX_BYTES with no link followed: the bound reads; one byte over, an invalid byte, a link, a directory and a FIFO are malformed', async () => {
    const l = await lib();
    const d = mkTmp('ccrc-history-headless-');
    const read = (name: string) => l.headlessMarkerOf(replayStore.readBounded(join(d, name), l.HEADLESS_LIST_MAX_BYTES, false));
    const head = `store ${S}\n`;
    const fill = l.HEADLESS_LIST_MAX_BYTES - Buffer.byteLength(head) - 2;
    t17fs.writeFileSync(join(d, 'at'), `${head}#${'x'.repeat(fill)}\n`);
    t17fs.writeFileSync(join(d, 'over'), `${head}#${'x'.repeat(fill + 1)}\n`);
    t17fs.writeFileSync(join(d, 'ok'), BASE);
    t17fs.writeFileSync(join(d, 'bad-byte'), Buffer.concat([Buffer.from('# a'), Buffer.from([0xff]), Buffer.from(`\n${BASE}`)]));
    t17fs.symlinkSync(join(d, 'ok'), join(d, 'link'));
    t17fs.mkdirSync(join(d, 'dir'));
    expect(spawnSync('mkfifo', [join(d, 'fifo')]).status, 'CONTROL: the FIFO was made').toBe(0);
    expect(read('ok'), 'CONTROL').toEqual(listed([{ ccrcId: 'acct-a-demo', generation: G1 }]));
    expect(read('at'), 'exactly HEADLESS_LIST_MAX_BYTES').toEqual(listed([]));
    expect(replayStore.readBounded(join(d, 'over'), l.HEADLESS_LIST_MAX_BYTES, false), 'CONTROL: the reader answers over-cap').toEqual({ state: 'over-cap' });
    expect(read('over')).toEqual(MAL);
    expect(read('bad-byte'), 'an invalid UTF-8 byte').toEqual(MAL);
    expect(read('link'), 'a link to a well-formed marker').toEqual(MAL);
    expect(read('dir')).toEqual(MAL);
    expect(read('fifo'), 'never waited on').toEqual(MAL);
    expect(read('absent')).toEqual(UNARMED);
  });
});
```

(b) `server/test/single-definition.test.ts`, in place and line-neutral: in O14's `VOCABS`, replace the two lines

```ts
    // W2-1 Task 4 (W2-D30): the presence record's meta keys, each built from RECALL_OFF_META.
    'RECALL_OFF_KEYS'] as const;
```

with

```ts
    // W2-1 Task 4 (W2-D30): the presence record's meta keys, each built from RECALL_OFF_META. W2-2b Task 1 (W2-D12): the arm words and the marker's bounds.
    'RECALL_OFF_KEYS', 'RECALL_ARMS', 'HEADLESS_LIST_MAX_BYTES', 'HEADLESS_LIST_MAX_PAIRS'] as const;
```

Two lines become two lines, so no line of the file moves (the citation corpus: `session-hook.test.ts` cites this file by line). `it.each(VOCABS)` gains three rows.

(c) `server/test/single-definition.test.ts`: append after the file's last line:

```ts

// W2-2b Task 1 (W2-D42, W2-D44; O13, O14): the marker's parser, formatter and fold are defined once, in lib.mjs; the arm
// words are quoted once in ccd/history, on RECALL_ARMS' line; and every ccd/history code line naming headless-on's path
// is historyPaths' own field or the marker's one read, store.mjs's readBounded at HEADLESS_LIST_MAX_BYTES with no link
// followed. APPENDED after the last describe, for the reason the CCRC HISTORY block above states; no import line is
// added. HISTORY_MJS, ALL_MJS, stallCode and rel are that block's. KNOWN WIDTH: a path held in a variable, or
// destructured, on one line and read on a later line is not seen, as O13's own scans say of theirs.
describe('ccrc history: the headless marker and the arm words are defined once, in lib.mjs, and read one way (W2-D42, W2-D44; W2-2b Task 1)', () => {
  const DEFINES = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`);
  const definers = (name: string): string[] =>
    ALL_MJS.filter((f) => stallCode(f).split('\n').some((l) => DEFINES(name).test(l))).map(rel).sort();
  /** An arm word in quotes of any kind. */
  const ARM_WORD = /(['"`])(?:control|treatment)\1/;
  /** A code line naming the marker's path, through a historyPaths(...) result or SWITCHES. */
  const NAMES_MARKER = /\.headlessOn\b/;
  /** historyPaths' own field: the one line that may name the path without reading it. */
  const PATHS_FIELD = 'headlessOn: `${h}/${SWITCHES.headlessOn}`,';
  /** The marker's one read (W2-D44): readBounded at the marker's bound, no link followed. */
  const ONE_READ = /\breadBounded\([^,]*\.headlessOn, (?:[A-Za-z_$][\w$]*\.)?HEADLESS_LIST_MAX_BYTES, false\)/;
  const allowed = (l: string): boolean => !NAMES_MARKER.test(l) || l.trim() === PATHS_FIELD || ONE_READ.test(l);

  it('CONTROL: the patterns see a definition and not a call, a quoted arm word and not a longer one, and the one read and nothing else', () => {
    expect(DEFINES('parseHeadlessList').test('export function parseHeadlessList(text) {')).toBe(true);
    expect(DEFINES('headlessMarkerOf').test('const headlessMarkerOf = (r) => r;')).toBe(true);
    expect(DEFINES('formatHeadlessList').test('  const t = formatHeadlessList({ storeId, pairs });')).toBe(false);
    expect(ARM_WORD.test("export const RECALL_ARMS = Object.freeze(['control', 'treatment']);")).toBe(true);
    expect(ARM_WORD.test('if (arm === "treatment") return 8;')).toBe(true);
    expect(ARM_WORD.test("const c = 'controls';")).toBe(false);
    expect(ARM_WORD.test('if (RECALL_ARMS.includes(arm)) return null;')).toBe(false);
    expect(allowed('  const m = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));')).toBe(true);
    expect(allowed('  const m = healthStore.readBounded(historyPaths(home).headlessOn, healthLib.HEADLESS_LIST_MAX_BYTES, false);')).toBe(true);
    expect(allowed(`    ${PATHS_FIELD}`)).toBe(true);
    expect(allowed('  const m = readBounded(P.headlessOn, CONTROL_FILE_MAX, false);')).toBe(false);
    expect(allowed('  const m = readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, true);')).toBe(false);
    expect(allowed("  const t = readFileSync(historyPaths(home).headlessOn, 'utf8');")).toBe(false);
    expect(allowed('  const armed = existsSync(P.headlessOn);')).toBe(false);
    expect(allowed('  const p = P.headlessOn;')).toBe(false);
  });

  it('parseHeadlessList, formatHeadlessList and headlessMarkerOf are each defined in lib.mjs alone', () => {
    for (const name of ['parseHeadlessList', 'formatHeadlessList', 'headlessMarkerOf']) expect(definers(name), name).toEqual(['ccd/history/lib.mjs']);
  });

  it('the arm words are quoted once in ccd/history, on RECALL_ARMS\' line in lib.mjs (W2-D42)', () => {
    const hits = HISTORY_MJS.flatMap((f) => stallCode(f).split('\n').filter((l) => ARM_WORD.test(l)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(hits).toEqual(["ccd/history/lib.mjs: export const RECALL_ARMS = Object.freeze(['control', 'treatment']);"]);
  });

  it('every ccd/history code line naming headless-on\'s path is historyPaths\' field or the marker\'s one bounded read (W2-D44; O13)', () => {
    const named = HISTORY_MJS.flatMap((f) => stallCode(f).split('\n').filter((l) => NAMES_MARKER.test(l)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(named, 'CONTROL: historyPaths names it').toContain(`ccd/history/lib.mjs: ${PATHS_FIELD}`);
    expect(named.filter((x) => !allowed(x.slice(x.indexOf(': ') + 2)))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call. First list what each filter selects:

```bash
(cd server && ./node_modules/.bin/vitest list test/history-lib.test.ts -t 'W2-2b Task 1:')
(cd server && ./node_modules/.bin/vitest list test/single-definition.test.ts -t 'the headless marker and the arm words')
(cd server && ./node_modules/.bin/vitest list test/single-definition.test.ts -t 'RECALL_ARMS is declared|HEADLESS_LIST_MAX_BYTES is declared|HEADLESS_LIST_MAX_PAIRS is declared')
```

Expected: 11 tests, 4 tests and 3 tests. Then run them:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-2b Task 1:')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the headless marker and the arm words')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_ARMS is declared|HEADLESS_LIST_MAX_BYTES is declared|HEADLESS_LIST_MAX_PAIRS is declared')
```

Expected (predicted, written before the code):
- history-lib: `11 failed`.
  - `C16, its two words`: `headless-malformed: expected undefined to be 2`.
  - `REASON_ROWS lists the two words`: `expected -1 to be greater than -1`.
  - `RECALL_ARMS is the two arm words`: `expected undefined to deeply equal [ 'control', 'treatment' ]`.
  - `the bounds are inclusive`: `CONTROL: the fixture is exactly the bound: expected 65536 to be undefined`.
  - `the marker's one read`: `TypeError: … headlessMarkerOf is not a function`, at `read('ok')` (`readBounded` with an undefined bound reads the file, then the call fails).
  - `formatHeadlessList refuses`: `CONTROL: expected [Function] to not throw an error but 'TypeError: … formatHeadlessList is not a function' was thrown`.
  - The other five: `TypeError: … is not a function` (`parseHeadlessList`, `formatHeadlessList` or `headlessMarkerOf`), on each case's first call.
- single-definition, the describe: `2 failed | 2 passed`. The CONTROL passes; `defined in lib.mjs alone` fails on `parseHeadlessList` with `[]` against `[ 'ccd/history/lib.mjs' ]`; `the arm words are quoted once` fails with `[]` against the one `RECALL_ARMS` line; `every ccd/history code line naming headless-on's path` PASSES at the base, by design: its one hit is `historyPaths`' field. It guards the read Task 3 adds, and Step 6's M31 and M32 red it.
- single-definition, the `VOCABS` rows: `3 failed`, each `<NAME>: a second declaration: expected [] to deeply equal [ 'ccd/history/lib.mjs' ]`.

- [ ] **Step 4: Write the code.** From the repository root, run this script. Each replacement asserts that its anchor occurs exactly once. The python body is a quoted heredoc, and every block is a raw string, so `'\r'`, `'\n'` and `/^\s|\s$/u` reach the file as written.

```bash
python3 - . <<'PYEOF'
import sys
ROOT = sys.argv[1]
def rep(rel, old, new):
    p = f'{ROOT}/{rel}'
    s = open(p, encoding='utf-8').read()
    assert s.count(old) == 1, (rel, old[:80], s.count(old))
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))

# lib.mjs: the two exit-2 words, after W2-2a's, beside their departure.
rep('ccd/history/lib.mjs',
r"""    'asof-invalid',
  ]],
""",
r"""    'asof-invalid',
    // `headless-malformed` and `headless-arm-unknown` (W2-2b, W2-D48): the headless seam's two new refusals, in
    // decideHeadless's order (W2-D46). The marker headless-on is unreadable, longer than HEADLESS_LIST_MAX_BYTES, or off
    // its grammar (D-5768); the seam's arm is empty, absent or outside RECALL_ARMS while the seam is engaged (W2-D42).
    // D-5769 (history-w2-headless-refusal-words)
    'headless-malformed', 'headless-arm-unknown',
  ]],
""")

# lib.mjs: the seam's vocabulary and the marker, after decideSeamInPane.
rep('ccd/history/lib.mjs',
r"""export function decideSeamInPane({ pane, recall }) {
  if (typeof pane === 'string' && recallSeamEngaged(recall)) return refuseScope('headless-in-pane');
  return { ok: true };
}
""",
r"""export function decideSeamInPane({ pane, recall }) {
  if (typeof pane === 'string' && recallSeamEngaged(recall)) return refuseScope('headless-in-pane');
  return { ok: true };
}

// ── the headless seam's vocabulary and its marker (W2-2b; W2-D42, W2-D44, W2-D48) ──────────
// The arm words decideHeadless checks and the replay driver imports (W2-D42), and headless-on's grammar (W2-D44): its
// two bounds, parseHeadlessList over the text, formatHeadlessList as the one producer of that text, and
// headlessMarkerOf, the fold of the marker's one read. That read is store.mjs's readBounded(historyPaths(home).headlessOn,
// HEADLESS_LIST_MAX_BYTES, false), the generic bounded reader W2-D29 already uses (no link followed, nonblocking, the
// type judged on the descriptor, at most the bound plus one byte), so no line pairs an open with the marker's path
// (O13). D-5768 (history-w2-marker-grammar), D-5769 (history-w2-headless-refusal-words)

/** The W2 replay's two arms (W2-D42): CCRC_RECALL_ARM must be one of these, else exit 2 headless-arm-unknown. Spelled
 *  once, here: decideHeadless reads it and the replay driver imports it, and neither spells its words. */
export const RECALL_ARMS = Object.freeze(['control', 'treatment']);
/** headless-on's byte bound (W2-D44, chosen): its read stops one byte past it, and a longer marker is malformed. */
export const HEADLESS_LIST_MAX_BYTES = 65536;
/** headless-on's pair bound (W2-D44, chosen): more pair lines than this, duplicates counted, is malformed. */
export const HEADLESS_LIST_MAX_PAIRS = 1000;
/** The store line's prefix, and the legacy generation's spelling on a pair line (the family's generation is ''). */
const HEADLESS_STORE_PREFIX = 'store ';
const HEADLESS_LEGACY_GENERATION = '-';
/** What readBounded's utf8 decode writes for an invalid byte (and what a lone surrogate becomes on the way to bytes). */
const HEADLESS_REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const HEADLESS_PAIR_RE = /^([^ ]+) ([^ ]+)$/;
const HEADLESS_UNARMED = Object.freeze(refuseScope('headless-unarmed'));
const HEADLESS_MALFORMED = Object.freeze(refuseScope('headless-malformed'));

/** headless-on's text, parsed (W2-D44). Pure. The text splits on LF, and one final LF is optional. The first line that
 *  is not a `#` comment must be `store <store_id>`, a lowercase UUID; only comments come before it. After it, each line
 *  is empty, a `#` comment, or exactly `<ccrc_id> <generation>`: an id idOk passes, one space, and a lowercase UUID or
 *  `-` (a legacy family, generation ''). Answers `{ ok: true, storeId, pairs }`, frozen, the pairs as
 *  `{ ccrcId, generation }` in file order with duplicates kept, or exit 2 headless-malformed when the text:
 *  - is longer than HEADLESS_LIST_MAX_BYTES bytes, or holds more than HEADLESS_LIST_MAX_PAIRS pair lines;
 *  - is not UTF-8 throughout: its UTF-8 round trip holds U+FFFD, which is how readBounded's decode marks an invalid
 *    byte, so a literal U+FFFD is malformed too (the fatal decode, failing closed);
 *  - holds a CR anywhere, or a line with leading or trailing whitespace (any \s, so a BOM or a no-break space);
 *  - has no store line, a second one (any later line beginning `store `), or any other line.
 *  Zero pairs parses: decideHeadless answers headless-unlisted for it, as for a family the list omits. Whether the store
 *  line names THIS store is checked at admission, after the store opens (W2-D46 step 4). D-5768 (history-w2-marker-grammar) */
export function parseHeadlessList(text) {
  if (typeof text !== 'string') throw new TypeError('parseHeadlessList: the marker text is not a string');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > HEADLESS_LIST_MAX_BYTES) return HEADLESS_MALFORMED;
  if (bytes.toString('utf8').includes(HEADLESS_REPLACEMENT_CHAR) || text.includes('\r')) return HEADLESS_MALFORMED;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let storeId = null;
  const pairs = [];
  for (const line of lines) {
    if (/^\s|\s$/u.test(line)) return HEADLESS_MALFORMED;
    if (line.startsWith('#')) continue;
    if (storeId === null) {
      if (!line.startsWith(HEADLESS_STORE_PREFIX) || !UUID_RE.test(line.slice(HEADLESS_STORE_PREFIX.length))) return HEADLESS_MALFORMED;
      storeId = line.slice(HEADLESS_STORE_PREFIX.length);
      continue;
    }
    if (line === '') continue;
    if (line.startsWith(HEADLESS_STORE_PREFIX)) return HEADLESS_MALFORMED;
    const m = HEADLESS_PAIR_RE.exec(line);
    if (m === null || !idOk(m[1]) || !(m[2] === HEADLESS_LEGACY_GENERATION || UUID_RE.test(m[2]))) return HEADLESS_MALFORMED;
    pairs.push(Object.freeze({ ccrcId: m[1], generation: m[2] === HEADLESS_LEGACY_GENERATION ? '' : m[2] }));
    if (pairs.length > HEADLESS_LIST_MAX_PAIRS) return HEADLESS_MALFORMED;
  }
  if (storeId === null) return HEADLESS_MALFORMED;
  return Object.freeze({ ok: true, storeId, pairs: Object.freeze(pairs) });
}

/** headless-on's text for `{ storeId, pairs }` (W2-D44): the paired formatter, and the only producer of marker text
 *  (W2-5b's `marker` prints it). The store line, then one `<ccrc_id> <generation>` line per pair in the given order, a
 *  legacy '' written `-`, one final LF, and no comment, so parseHeadlessList answers exactly `{ ok: true, storeId, pairs }`
 *  for it and formatting that answer gives the same bytes. A list the parser would not read back throws: a TypeError for
 *  a store id that is not a lowercase UUID, an id idOk refuses or spelled `store` (it would read as a second store line),
 *  or a generation that is neither '' nor a lowercase UUID; a RangeError past either bound. */
export function formatHeadlessList({ storeId, pairs }) {
  if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) throw new TypeError('formatHeadlessList: the store id is not a lowercase UUID');
  if (!Array.isArray(pairs)) throw new TypeError('formatHeadlessList: pairs is not an array');
  if (pairs.length > HEADLESS_LIST_MAX_PAIRS) throw new RangeError(`formatHeadlessList: more than ${HEADLESS_LIST_MAX_PAIRS} pairs`);
  const lines = [`${HEADLESS_STORE_PREFIX}${storeId}`];
  for (const p of pairs) {
    const id = p === null || typeof p !== 'object' ? undefined : p.ccrcId;
    const g = p === null || typeof p !== 'object' ? undefined : p.generation;
    if (!idOk(id) || `${id} ` === HEADLESS_STORE_PREFIX) throw new TypeError(`formatHeadlessList: ${JSON.stringify(id)} cannot be listed`);
    if (!(g === '' || (typeof g === 'string' && UUID_RE.test(g)))) throw new TypeError(`formatHeadlessList: ${JSON.stringify(g)} is not a generation`);
    const spelled = g === '' ? HEADLESS_LEGACY_GENERATION : g;
    lines.push(`${id} ${spelled}`);
  }
  const text = `${lines.join('\n')}\n`;
  if (Buffer.byteLength(text, 'utf8') > HEADLESS_LIST_MAX_BYTES) throw new RangeError(`formatHeadlessList: over ${HEADLESS_LIST_MAX_BYTES} bytes`);
  return text;
}

/** The marker as its one read answered (W2-D44): store.mjs's readBounded(historyPaths(home).headlessOn,
 *  HEADLESS_LIST_MAX_BYTES, false), folded into what decideHeadless needs. Absent is exit 2 headless-unarmed. Unreadable
 *  (a link, a FIFO, a directory, any open or read failure) and over-cap are exit 2 headless-malformed, never absent
 *  (IV5: unreadable is never absent). A value is parseHeadlessList's answer. D-5769 (history-w2-headless-refusal-words) */
export function headlessMarkerOf(read) {
  if (read !== null && typeof read === 'object' && read.state === 'absent') return HEADLESS_UNARMED;
  if (read === null || typeof read !== 'object' || read.state !== 'value' || typeof read.value !== 'string') return HEADLESS_MALFORMED;
  return parseHeadlessList(read.value);
}
""")

# lib.d.mts: one block after decideSeamInPane's declaration.
rep('ccd/history/lib.d.mts',
r"""export function decideSeamInPane(i: { pane: string | null; recall: RecallSeamValues }): { ok: true } | ScopeRefusal<'headless-in-pane'>;
""",
r"""export function decideSeamInPane(i: { pane: string | null; recall: RecallSeamValues }): { ok: true } | ScopeRefusal<'headless-in-pane'>;
// --- W2-2b Task 1: the headless seam's vocabulary and its marker (W2-D42, W2-D44, W2-D48)
/** The W2 replay's two arms (W2-D42), frozen: the only values the seam's arm may take. */
export const RECALL_ARMS: readonly ['control', 'treatment'];
/** headless-on's bounds (W2-D44, chosen): bytes, and pair lines with duplicates counted. */
export const HEADLESS_LIST_MAX_BYTES: 65536;
export const HEADLESS_LIST_MAX_PAIRS: 1000;
/** One listed family: its ccrc_id and its generation, '' for a legacy family (the marker spells it `-`). */
export interface HeadlessPair { readonly ccrcId: string; readonly generation: string }
/** A well-formed marker, frozen: its store line's store_id and its pairs in file order, duplicates kept. */
export interface HeadlessList { readonly ok: true; readonly storeId: string; readonly pairs: readonly HeadlessPair[] }
export function parseHeadlessList(text: string): HeadlessList | ScopeRefusal<'headless-malformed'>;
export function formatHeadlessList(list: { storeId: string; pairs: readonly HeadlessPair[] }): string;
/** store.mjs readBounded's answer (store.d.mts's BoundedRead), restated so this file imports nothing. */
export type HeadlessMarkerRead = { state: 'absent' } | { state: 'unreadable' } | { state: 'over-cap' } | { state: 'value'; value: string };
export function headlessMarkerOf(read: HeadlessMarkerRead): HeadlessList | ScopeRefusal<'headless-unarmed' | 'headless-malformed'>;
""")
print('lib.mjs and lib.d.mts written')
PYEOF
```

Then check that no backslash-u escape and no stray control byte reached either file, and that the two escapes the code needs are there as text:

```bash
grep -c 'fromCharCode(0xfffd)' ccd/history/lib.mjs
grep -cF "text.includes('\r')" ccd/history/lib.mjs
grep -cF 'if (/^\s|\s$/u.test(line)) return HEADLESS_MALFORMED;' ccd/history/lib.mjs
LC_ALL=C grep -c "$(printf '\r')" ccd/history/lib.mjs ccd/history/lib.d.mts
```

Expected: `1`, `1`, `1`, then `0` for both files.

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-2b Task 1:')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the headless marker and the arm words')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_ARMS is declared|HEADLESS_LIST_MAX_BYTES is declared|HEADLESS_LIST_MAX_PAIRS is declared')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: `11 passed`, `4 passed`, `3 passed`, and tsc silent with exit 0. Then count the declarations, because `skipLibCheck` hides a duplicate:

```bash
grep -c '^export const RECALL_ARMS:\|^export const HEADLESS_LIST_MAX_BYTES:\|^export const HEADLESS_LIST_MAX_PAIRS:\|^export interface HeadlessPair \|^export interface HeadlessList \|^export function parseHeadlessList(\|^export function formatHeadlessList(\|^export type HeadlessMarkerRead \|^export function headlessMarkerOf(' ccd/history/lib.d.mts
```

Expected: `9`, one each.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each mutant runs in its own tool call, through helpers written once to `.superpowers/sdd/history-w2-2b/t1/mut.sh`: it applies one exact replacement, asserted to match once, runs its filter and shows red, then restores every file the mutants touch and checks each with `cmp`. The helpers also restore on exit, a signal included, so a call killed by its timeout never leaves a mutant in the tree. A red at a CONTROL is the fixture's to fix, never the guard's to weaken.

First write the helpers, once, after Step 5's green run. They copy the files as they stand then, so a file changed on purpose after this point needs this block run again before any later mutant:

```bash
mkdir -p .superpowers/sdd/history-w2-2b/t1
cat > .superpowers/sdd/history-w2-2b/t1/mut.sh <<'SH'
SCRATCH=.superpowers/sdd/history-w2-2b/t1
FILES="ccd/history/lib.mjs ccd/history/cli.mjs ccd/history/recall.mjs ccd/history/sweep.mjs"
# mut <file> <old> <new>: one exact replacement, refused unless <old> occurs exactly once.
mut() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8').read()
c = s.count(old)
if c != 1:
    sys.exit(f'anchor occurs {c} times in {p}')
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PY
}
# restore: every file back to its copy, checked with cmp. It also runs when the call exits, by a signal too.
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; cmp -s "$SCRATCH/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done; }
trap restore EXIT
trap 'exit 143' INT TERM HUP
LIB_T='W2-2b Task 1:'
SD_T='the headless marker and the arm words'
SH
for f in ccd/history/lib.mjs ccd/history/cli.mjs ccd/history/recall.mjs ccd/history/sweep.mjs; do cp "$f" ".superpowers/sdd/history-w2-2b/t1/$(basename "$f").orig"; done
```

Then each mutant, ONE tool call each, in the foreground with a timeout of at least 600000 ms. Never split one mutant across calls: the helpers restore every file when a call exits. A call that prints `NOT RESTORED` stops the task: report it. Each prediction below was written before any run; a mutant whose red differs is recorded as measured and reported, never re-predicted.

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M1: both words missing from REASON_ROWS (W2-D48).
mut ccd/history/lib.mjs "    'headless-malformed', 'headless-arm-unknown',
" ''
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 3 failed. 'C16, its two words', 'REASON_ROWS lists the two words', and 'every other shape is
# headless-malformed' on its last line (REASONS has no such word).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M2: headless-arm-unknown alone missing.
mut ccd/history/lib.mjs "    'headless-malformed', 'headless-arm-unknown'," "    'headless-malformed',"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'C16, its two words' (headless-arm-unknown: expected undefined to be 2) and
# 'REASON_ROWS lists the two words' (the line is gone).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M3: the arm words swapped.
mut ccd/history/lib.mjs "export const RECALL_ARMS = Object.freeze(['control', 'treatment']);" "export const RECALL_ARMS = Object.freeze(['treatment', 'control']);"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'RECALL_ARMS is the two arm words'.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M4: RECALL_ARMS not frozen.
mut ccd/history/lib.mjs "export const RECALL_ARMS = Object.freeze(['control', 'treatment']);" "export const RECALL_ARMS = ['control', 'treatment'];"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_ARMS is declared')
restore
# Expected RED (predicted): history-lib 1 failed, 'RECALL_ARMS is the two arm words' (RECALL_ARMS is frozen). VOCABS row
# 1 failed: 'RECALL_ARMS is not frozen'.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M5: the byte bound one higher.
mut ccd/history/lib.mjs 'export const HEADLESS_LIST_MAX_BYTES = 65536;' 'export const HEADLESS_LIST_MAX_BYTES = 65537;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'RECALL_ARMS is the two arm words' (65537 for 65536) and 'the bounds are inclusive'
# (its CONTROL: 65536 against 65537). The reader case stays green: its fixtures are built from the constant.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M6: the byte bound counted in characters.
mut ccd/history/lib.mjs '  if (bytes.length > HEADLESS_LIST_MAX_BYTES) return HEADLESS_MALFORMED;' '  if (text.length > HEADLESS_LIST_MAX_BYTES) return HEADLESS_MALFORMED;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the bounds are inclusive')
restore
# Expected RED (predicted): 'the bound is in bytes, never characters' parses ok.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M7: the byte bound dropped from the parser.
mut ccd/history/lib.mjs '  if (bytes.length > HEADLESS_LIST_MAX_BYTES) return HEADLESS_MALFORMED;' '  // (removed)'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'the bounds are inclusive' ('one byte over' parses ok). The reader case stays green:
# readBounded answers over-cap before the parser runs, so the parser's own bound is pinned by the pure case alone.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M8: the pair bound one lower.
mut ccd/history/lib.mjs '    if (pairs.length > HEADLESS_LIST_MAX_PAIRS) return HEADLESS_MALFORMED;' '    if (pairs.length >= HEADLESS_LIST_MAX_PAIRS) return HEADLESS_MALFORMED;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'the bounds are inclusive' ('exactly 1,000 pairs': false for 1000) and the round trip
# (its 1,000-pair list is malformed).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M9: the pair bound dropped.
mut ccd/history/lib.mjs '    if (pairs.length > HEADLESS_LIST_MAX_PAIRS) return HEADLESS_MALFORMED;' '    // (removed)'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the bounds are inclusive')
restore
# Expected RED (predicted): '1,001 pairs' parses ok.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M10: a CR no longer refused.
mut ccd/history/lib.mjs "  if (bytes.toString('utf8').includes(HEADLESS_REPLACEMENT_CHAR) || text.includes('\r')) return HEADLESS_MALFORMED;" "  if (bytes.toString('utf8').includes(HEADLESS_REPLACEMENT_CHAR)) return HEADLESS_MALFORMED;"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'every other shape is headless-malformed' at 'a CR inside a comment'. CR LF line
# ends stay refused by the trailing-whitespace rule, so that shape alone would not pin this guard.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M11: the fatal decode dropped.
mut ccd/history/lib.mjs "  if (bytes.toString('utf8').includes(HEADLESS_REPLACEMENT_CHAR) || text.includes('\r')) return HEADLESS_MALFORMED;" "  if (text.includes('\r')) return HEADLESS_MALFORMED;"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'every other shape' (U+FFFD and the lone surrogate, both in a comment) and the
# reader case ('an invalid UTF-8 byte' parses ok).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M12: leading and trailing whitespace no longer refused.
mut ccd/history/lib.mjs '    if (/^\s|\s$/u.test(line)) return HEADLESS_MALFORMED;' '    // (removed)'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'every other shape' at 'trailing whitespace on a comment'. Named: every other
# whitespace shape is refused by the grammar as well (a pair's exact shape, the store line's UUID, the store prefix), so
# the comment line is the one this rule alone decides.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M13: an empty line admitted before the store line.
mut ccd/history/lib.mjs '    if (storeId === null) {' "    if (storeId === null && line !== '') {"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'every other shape' at 'an empty line before the store line'.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M14: a second store line read as a pair.
mut ccd/history/lib.mjs '    if (line.startsWith(HEADLESS_STORE_PREFIX)) return HEADLESS_MALFORMED;' '    // (removed)'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'every other shape' at 'a second store line' and 'a second store line naming -'
# (each parses as a pair whose id is store).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M15: the store id's grammar dropped.
mut ccd/history/lib.mjs ' || !UUID_RE.test(line.slice(HEADLESS_STORE_PREFIX.length))) return HEADLESS_MALFORMED;' ') return HEADLESS_MALFORMED;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'every other shape' at 'a store line naming no UUID', 'an uppercase store id' and
# 'two spaces after store'.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M16: a marker with no store line not refused.
mut ccd/history/lib.mjs '  if (storeId === null) return HEADLESS_MALFORMED;' '  // (removed)'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'every other shape' ('empty text', 'comments and no store line') and headlessMarkerOf
# ('an empty marker is malformed, never unarmed': it answers ok with storeId null).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M17: '-' kept as the generation.
mut ccd/history/lib.mjs "generation: m[2] === HEADLESS_LEGACY_GENERATION ? '' : m[2] }" 'generation: m[2] }'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'parseHeadlessList: comments, the store line' (acct-b-demo's generation reads -)
# and the round trip (every legacy pair).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M18: the generation's grammar dropped.
mut ccd/history/lib.mjs '|| UUID_RE.test(m[2]))) return HEADLESS_MALFORMED;' '|| true)) return HEADLESS_MALFORMED;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'every other shape' at 'an uppercase generation' and 'a generation neither a UUID nor -'.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M19: the id's grammar dropped.
mut ccd/history/lib.mjs 'if (m === null || !idOk(m[1]) || ' 'if (m === null || '
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'every other shape' at '..', 'a slash' and 'an id longer than SPOOL_ID_MAX'.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M20: the answer no longer frozen.
mut ccd/history/lib.mjs '  return Object.freeze({ ok: true, storeId, pairs: Object.freeze(pairs) });' '  return { ok: true, storeId, pairs };'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'parseHeadlessList: comments, the store line' at 'one answer has one form' (the
# deep-equals above it pass: toEqual ignores freezing).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M21: the formatter takes any store id.
mut ccd/history/lib.mjs "  if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) throw" "  if (typeof storeId !== 'string') throw"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'formatHeadlessList refuses' at 'a store id that is no UUID'.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M22: the formatter lists the id store.
mut ccd/history/lib.mjs '    if (!idOk(id) || `${id} ` === HEADLESS_STORE_PREFIX) throw' '    if (!idOk(id)) throw'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'formatHeadlessList refuses' at 'the id store'.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M23: the formatter takes '-' as a generation.
mut ccd/history/lib.mjs "    if (!(g === '' || (typeof g === 'string' && UUID_RE.test(g)))) throw" "    if (!(g === '' || g === '-' || (typeof g === 'string' && UUID_RE.test(g)))) throw"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'formatHeadlessList refuses' at '- as a generation'.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M24: the formatter writes a legacy generation as ''.
mut ccd/history/lib.mjs "    const spelled = g === '' ? HEADLESS_LEGACY_GENERATION : g;" '    const spelled = g;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'formatHeadlessList: the store line' (acct-b-demo's line ends in a space) and the
# round trip (that line parses as malformed).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M25: the formatter's byte bound dropped.
mut ccd/history/lib.mjs "  if (Buffer.byteLength(text, 'utf8') > HEADLESS_LIST_MAX_BYTES) throw" '  if (false) throw'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'formatHeadlessList refuses' at '300 pairs of 224-character ids'.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M26: the formatter's pair bound dropped.
mut ccd/history/lib.mjs '  if (pairs.length > HEADLESS_LIST_MAX_PAIRS) throw' '  if (false) throw'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'formatHeadlessList refuses' at '1,001 pairs' (about 16 KB, inside the byte bound).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M27: over-cap folded into absent.
mut ccd/history/lib.mjs "read.state === 'absent') return HEADLESS_UNARMED;" "(read.state === 'absent' || read.state === 'over-cap')) return HEADLESS_UNARMED;"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'headlessMarkerOf' (over-cap reads headless-unarmed) and the reader case ('over').
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M28: unreadable folded into absent (IV5).
mut ccd/history/lib.mjs "read.state === 'absent') return HEADLESS_UNARMED;" "(read.state === 'absent' || read.state === 'unreadable')) return HEADLESS_UNARMED;"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'headlessMarkerOf' (unreadable reads headless-unarmed) and the reader case (first
# at 'a link to a well-formed marker'; the directory and the FIFO answer the same).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M29: a second definition of the parser in recall.mjs.
mut ccd/history/recall.mjs 'const IN_PART = 500;' 'const IN_PART = 500;
function parseHeadlessList(text) { return text; }'
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "$SD_T")
restore
# Expected RED (predicted): 1 failed | 3 passed: parseHeadlessList's definers [ 'ccd/history/lib.mjs', 'ccd/history/recall.mjs' ].
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M30: an arm word spelled in cli.mjs.
mut ccd/history/cli.mjs 'const NO_PAIRS = makePairIndex([]);' "const NO_PAIRS = makePairIndex([]);
const ARM_CONTROL = 'control';"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "$SD_T")
restore
# Expected RED (predicted): 1 failed | 3 passed: 'the arm words are quoted once' holds cli.mjs's line too.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M31: the marker read at another bound.
mut ccd/history/cli.mjs 'const NO_PAIRS = makePairIndex([]);' 'const NO_PAIRS = makePairIndex([]);
const headlessProbe = (P) => readBounded(P.headlessOn, CONTROL_FILE_MAX, false);'
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "$SD_T")
restore
# Expected RED (predicted): 1 failed | 3 passed: 'every ccd/history code line naming headless-on's path' lists cli.mjs's line.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M32: the marker's presence read outside the one read.
mut ccd/history/cli.mjs 'const NO_PAIRS = makePairIndex([]);' 'const NO_PAIRS = makePairIndex([]);
const headlessProbe = (P) => existsSync(P.headlessOn);'
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "$SD_T")
restore
# Expected RED (predicted): 1 failed | 3 passed, the same case. O13's existing describes stay green: they look for the
# path text /headless-on and for write verbs, and this line has neither.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M33: a second declaration of a bound, in sweep.mjs (O14's VOCABS row).
mut ccd/history/sweep.mjs 'export function recallOffPresence(home, id) {' 'const HEADLESS_LIST_MAX_PAIRS = 1000;
export function recallOffPresence(home, id) {'
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'HEADLESS_LIST_MAX_PAIRS is declared')
restore
# Expected RED (predicted): 1 failed: 'HEADLESS_LIST_MAX_PAIRS: a second declaration' lists lib.mjs and sweep.mjs.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M34: the parser's text check dropped.
mut ccd/history/lib.mjs "  if (typeof text !== 'string') throw new TypeError('parseHeadlessList: the marker text is not a string');" '  // (removed)'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'every other shape' at 'text that is not a string is the caller's defect, named':
# Buffer.from throws its own TypeError, whose message is not the named one.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M35: the formatter's array check dropped.
mut ccd/history/lib.mjs "  if (!Array.isArray(pairs)) throw new TypeError('formatHeadlessList: pairs is not an array');" '  // (removed)'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'formatHeadlessList refuses' at 'pairs that is not an array' (node's "Cannot read
# properties of null", not the named message).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M36: the formatter reads a pair's id without checking the pair is an object.
mut ccd/history/lib.mjs "    const id = p === null || typeof p !== 'object' ? undefined : p.ccrcId;" '    const id = p.ccrcId;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'formatHeadlessList refuses' at 'a pair that is not an object' (node's "Cannot read
# properties of null", not the named message).
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M37: the fold's null check dropped (any other shape, IV5).
mut ccd/history/lib.mjs "  if (read === null || typeof read !== 'object' || read.state !== 'value'" "  if (typeof read !== 'object' || read.state !== 'value'"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'headlessMarkerOf' at 'null': a TypeError reading `state` of null, not headless-malformed.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M38: the fold hands the parser a value that is not text.
mut ccd/history/lib.mjs " || read.state !== 'value' || typeof read.value !== 'string') return HEADLESS_MALFORMED;" " || read.state !== 'value') return HEADLESS_MALFORMED;"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'headlessMarkerOf' at 'a value that is not text': parseHeadlessList throws its
# named TypeError instead of the fold answering headless-malformed.
```

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
# M39: the fold reads any state that carries text as a value.
mut ccd/history/lib.mjs " || read.state !== 'value' || typeof read.value !== 'string') return HEADLESS_MALFORMED;" " || typeof read.value !== 'string') return HEADLESS_MALFORMED;"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 1 failed, 'headlessMarkerOf' at 'an unknown state carrying text': it answers the parsed list.
```

After the last mutant, one more call:

```bash
. .superpowers/sdd/history-w2-2b/t1/mut.sh
for f in ccd/history/lib.mjs ccd/history/cli.mjs ccd/history/recall.mjs ccd/history/sweep.mjs; do cmp -s ".superpowers/sdd/history-w2-2b/t1/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "$SD_T")
```

Expected: each mutant red as predicted, and no call printing `NOT RESTORED`; then the last call's loop prints nothing, and its runs print `11 passed` and `4 passed`.

| Guard | Mutant(s) | Case(s) that red |
|---|---|---|
| the two words in `REASON_ROWS` (W2-D48, C16) | M1, M2 | `C16, its two words`; `REASON_ROWS lists the two words`; the malformed table's last line (M1) |
| `RECALL_ARMS`' words, order and freezing (W2-D42) | M3, M4 | `RECALL_ARMS is the two arm words`; O14's `RECALL_ARMS` row (M4) |
| the byte bound, its value and its unit | M5, M6, M7 | `RECALL_ARMS is the two arm words` (M5); `the bounds are inclusive` |
| the pair bound | M8, M9 | `the bounds are inclusive`; the round trip (M8) |
| CR, the fatal decode, edge whitespace | M10, M11, M12 | the malformed table; the reader case (M11) |
| the store line: first, once, a UUID, present | M13, M14, M15, M16 | the malformed table; `headlessMarkerOf` (M16) |
| the pair line: `-`, generation, id | M17, M18, M19 | the grammar case and the round trip (M17); the malformed table |
| the answer's one form | M20 | `one answer has one form` |
| the formatter refuses what the parser would not read back | M21 to M26 | `formatHeadlessList refuses`; `formatHeadlessList: the store line` and the round trip (M24) |
| the fold: unreadable and over-cap are never absent (IV5) | M27, M28 | `headlessMarkerOf`; the reader case |
| one definition, one arm spelling, one read (O13, O14) | M29 to M33 | the appended single-definition describe; O14's `HEADLESS_LIST_MAX_PAIRS` row (M33) |
| the defensive guards: the parser's text, the formatter's array and pair, the fold's other shapes (IV5) | M34 to M39 | the malformed table's named TypeError (M34); `formatHeadlessList refuses` (M35, M36); `headlessMarkerOf`'s other shapes (M37 to M39) |

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms, ONE tool call per line. A red file is re-run alone before it is called a break:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts -t 'store.mjs: readBounded')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'DRIVER_REASONS is disjoint from lib REASONS')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'O14, local half')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'THE CITATION DEBT this task creates')
(cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected green, each against Step 1's base count:
- `history-lib`: the base's count plus 11. `single-definition -t 'ccrc history'`: plus 7 (three `VOCABS` rows and the new describe's four cases; its name begins `ccrc history:`). O13's describes, the symbolic-write scan and W2-2a's seam-name scan stay green: the new lib lines name no switch path, no write verb and no `CCRC_RECALL_` name outside comments.
- `history-skill`: exactly the base's count. Its C16 derivation holds both words, and its exit-code table is unchanged.
- `history-store -t 'store.mjs: readBounded'`: green and unchanged (store.mjs is not edited).
- `history-replay -t 'DRIVER_REASONS …'` and `measure-history -t 'O14, local half'`: green. Neither new word is a driver word (C-J), and the gate declares none of the new names (D-5774).
- `history-cli`: green; no CLI path changed. `citations`: green; no numeric line citation added. `dtbd`: green. tsc: silent.
- The citation-debt case: green and unchanged. This task's only in-place edit of `single-definition.test.ts` swaps two lines for two (line-neutral), and the describe is appended below the last one. If the case's per-file census for `server/test/single-definition.test.ts` moves, record the measured number and stop: do not edit the census to fit it; report it.

Then the ledger check:

```bash
grep -rn 'D-TBD-[a-z0-9]' ccd/history server/test/history-lib.test.ts server/test/single-definition.test.ts || echo 'no D-TBD token'
grep -c 'D-5768\|D-5769' ccd/history/lib.mjs
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: `no D-TBD token`; `5` (two lines of the `REASON_ROWS` comment, which names D-5768 and ends with D-5769, the section header, and `parseHeadlessList`'s and `headlessMarkerOf`'s doc comments); then green: both numbers are cited in lib.mjs and defined once, in this plan.

- [ ] **Step 8: Commit.** This task defines no departure, so `## Deviations found` is not touched.

First write the message, with a quoted heredoc so nothing in it is expanded:

```bash
cat > .superpowers/sdd/history-w2-2b/t1/commit-msg.txt <<'EOF'
feat(history): the headless seam's arm words, the marker's grammar and its fold in lib, and two refusal words (W2-2b Task 1; W2-D42, W2-D44, W2-D48, W2-D12; D-5768, D-5769)

<each mutant's measured red line from Step 6, M1 to M39, one line each, its mutant first>
<the passing counts of Steps 5 and 7>
<any re-anchoring Step 1 or Step 6 needed, or: no re-anchoring>

<the attribution line the session's reminder names>
EOF
```

Replace each `<…>` line with what it names, from the scratch notes. Then:

```bash
for f in ccd/history/lib.mjs ccd/history/cli.mjs ccd/history/recall.mjs ccd/history/sweep.mjs; do cmp -s ".superpowers/sdd/history-w2-2b/t1/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
git diff --quiet -- ccd/history/cli.mjs ccd/history/recall.mjs ccd/history/sweep.mjs && echo 'no mutant left in cli, recall or sweep'
grep -c '^<' .superpowers/sdd/history-w2-2b/t1/commit-msg.txt
git add ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-lib.test.ts server/test/single-definition.test.ts
git status --short
git commit -F .superpowers/sdd/history-w2-2b/t1/commit-msg.txt
git status --short
```

The loop prints nothing, and the next line prints `no mutant left in cli, recall or sweep`: no mutant is left in a file the commit takes or in one this task must not change (a `NOT RESTORED` line stops the commit; report it). Then `0` (no placeholder left). `git status --short` must list exactly these four files before the commit, and nothing after it. Nothing under `.superpowers/` appears: it is gitignored.

---

### Task 2: the headless seam's pure deciders in lib.mjs, decideHeadless, decideHeadlessStore and decideAsOfFamily (W2-D40, W2-D45, W2-D46)

This task adds the decisions the env path is built on, in lib.mjs (L1), and wires none of them. Nothing calls them until Task 3, so no session sees any change at this task's commit.

- `decideHeadless({ recall, paneSet, marker })` is W2-D46 step 1: the seam's rows before the store, in the ruled order (R1). It answers the tmux path (`{ ok: true, path: 'tmux' }`), one exit-2 refusal, or the seam's validated values plus the parsed marker (`{ ok: true, path: 'headless', session, arm, asof, list: { storeId, pairs } }`).
- `decideAsOfFamily({ session, asof, rows, list, storeId })` is W2-D40 with W2-D44's admission, at W2-D46 step 4 (R3). It answers the env path's resolved family (`{ ok: true, via: 'asof', generation, family: { ccrcId, project }, anchor }`), or `asof-invalid`, or `headless-unlisted`. `rows` is the answer of `asOfFamilySql()`, a statement this task also adds to lib, as W2-2a added `asOfEntrySql`: lib returns SQL text and runs none, and Task 3's `asOfRowsOf` runs it.
- `decideHeadlessStore({ list, storeId })` is step 4's first row, W2-D44's store line on its own (R3): `{ ok: true }`, or `headless-unlisted` when the marker's store line is not this store's meta `store_id`. The read verbs call it before they run `asOfFamilySql()`, so a marker written for another store causes no ASOF query, and `decideAsOfFamily` calls it as its own first row, so the rule is spelled once.
- `lib.d.mts`' `GenerationChoice.via` gains `'asof'` (R3), so `{ value, via: 'asof' }` is a `GenerationChoice` and `ScopeInputs` needs no edit.

**R1: called, not folded.** W2-2a's `recallSeamEngaged` and `decideSeamInPane` stay exported and unchanged, and `decideHeadless` calls them for its rows 1 and 2. Its row 4 ("SESSION unset") also calls `recallSeamEngaged`, on SESSION alone. The reasons:
- **One spelling of each rule.** W2-D45's "empty means unset" lives only in `recallSeamEngaged`, the in-pane rule (a defined `TMUX_PANE`, `''` included) only in `decideSeamInPane`, and the marker's fold only in Task 1's `headlessMarkerOf`. Calling them adds no second spelling: case 4 scans `decideHeadless`'s text for one, and mutant H9 adds one and goes red.
- **Every suite stays green with appends only.** W2-2a Task 5's pure and spawned describes in `history-cli.test.ts` test the two functions by name.
- **The marker is never read in a pane.** Task 3 keeps W2-2a's `inPane` refusal where it stands in `readContextIn`, before any tmux spawn, and sends only an engaged seam with no pane to the line that reads the marker. `decideHeadless` still runs the pane row itself, so its answer is complete for every input and W2-D46's order is pinned here, purely.
- **`paneSet` is a boolean**, true iff `TMUX_PANE` is defined (W2-D45: `''` included). `decideSeamInPane` reads only whether a pane is defined, so `decideHeadless` hands it `''` for any pane. Anything but `false` is a pane (fail closed; mutant H15).

**What `marker`, `rows`, `list` and `storeId` are.** These are the inputs the read verbs measure.
- `marker` is Task 1's `headlessMarkerOf` answer: a frozen `HeadlessList` (`{ ok: true, storeId, pairs }`), or its `headless-unarmed` or `headless-malformed` refusal, which `decideHeadless` passes through unchanged. `null` means the caller did not read it (the seam not engaged, or a pane), and a `null` marker past the pane row throws `TypeError`.
- `list` is `decideHeadless`'s answer: the marker's store line and its pairs, `{ storeId, pairs }`, each pair `{ ccrcId, generation }`, `''` standing for the marker's `-`.
- `storeId` is the admitted store's own `meta` `store_id`, or `null` when the meta table holds none. It is never the id `refusalStoreId` falls back to from the binding file.
- `rows` is `db.prepare(asOfFamilySql()).all({ asof })`, passed whole. The statement returns one row per confirmed epoch of the transcript N's `boundaries` row names, each with its family and the family that one merged into (`into_*`, one hop). It returns one row with NULL epoch and family columns when there is no confirmed epoch or no boundary, and no row when no entry has the uuid. Its column names are Task 3's (R3): `uuid`, `entry_id`, `boundary_entry_id`, `agent_id`, `cwd`, `cwd_real`, `session_pk`, `ccrc_id`, `generation`, `project`, `merged_into`, `into_session_pk`, `into_ccrc_id`, `into_generation`, `into_project`, `into_merged_into`.

**Where list membership is judged.** It is judged twice, because the generation is known only after the store opens:
- at step 1 (`decideHeadless`), SESSION must be the `ccrc_id` of some list line, as W2-D44 and W2-D46 put it: "not on a list line", a marker with zero pairs included (R2);
- at step 4, the marker's store line must be this store's `store_id` (`decideHeadlessStore`, answered before any ASOF row is read, R3), and then the exact pair (SESSION, the ASOF family's generation) must be listed (`decideAsOfFamily`).

Both step-4 checks are lib's: `decideAsOfFamily` holds the whole admission and calls `decideHeadlessStore` as its first row, and the read verbs call `decideHeadlessStore` alone before they read the rows, so Task 3 adds no rule of its own.

**Order.** This task runs after Task 1 and before Task 3. Task 1 ships `RECALL_ARMS`, `parseHeadlessList`, `formatHeadlessList`, `headlessMarkerOf`, the `HeadlessPair` and `HeadlessList` types and the two new exit-2 words. This task edits two new regions of lib.mjs, two new regions and one line of `lib.d.mts`, and appends one describe to the end of `history-lib.test.ts`. It edits no existing function. It cites D-5767 and D-5768, which this plan's "Deviations found" defines (on `main` with the plan before dispatch, R9), and D-5765 and D-6281 bare, both defined in the W2-2a plan. Line numbers are hints measured at `d119d6e90`. Step 1 asserts that each anchor occurs exactly once.

**Files:**
- Modify: `ccd/history/lib.mjs`. All edits are inserts, and no existing line changes:
  - Directly above the doc comment that begins `/** The session's id from tmux (§8.2, D-4675 (history-identity-from-tmux)). The` (`decideIdentity`'s), and so directly after Task 1's section: `decideHeadless` with its doc comment.
  - Directly above the doc comment that begins `/** The harness check every read verb runs after the identity (§6.10 item 4,` (`decideHarness`'s, about :4273), and so directly after `resolveGeneration`'s closing `}`: a section header ending `// D-5767 (history-w2-env-identity-from-asof)`, then `decideHeadlessStore`, `asOfFamilySql`, the module-private `asOfRowFamily` and `decideAsOfFamily` with their doc comments. `resolveGeneration` (about :4267) is not touched, and case 8 pins its text.
  - No new import and no new module-level constant, so O14's `VOCABS` does not change in this task.
- Modify: `ccd/history/lib.d.mts`:
  - after Task 1's `export function headlessMarkerOf(read: HeadlessMarkerRead): HeadlessList | ScopeRefusal<'headless-unarmed' | 'headless-malformed'>;`: `decideHeadless`;
  - in place, `export interface GenerationChoice { value: string | null; via: 'env' | 'registry' | 'newest' }` gains `| 'asof'`;
  - after `export function resolveGeneration(i: { envGen: string | null; regGen: Presence<string> }): GenerationChoice;`: `decideHeadlessStore`, `AsOfFamilyRow`, `asOfFamilySql` and `decideAsOfFamily`.
- Test: `server/test/history-lib.test.ts`. One describe, 8 cases, appended after the file's last line (after Task 1's describe). It adds no import line. The file already imports `EXIT`, `REASONS`, `EPOCH_CAUSES`, `DECLARED_BY`, `readFileSync`, `fileURLToPath`, `createHash`, `mkTmp` and `replayStore` (store.mjs).
- Not edited: `cli.mjs`, `recall.mjs`, `sweep.mjs`, `regex-worker.mjs`, `derive.mjs`, `store.mjs`; `shared/lifecycle.ts`; `README.md`; the spec; `ccd/history-skill/SKILL.md` (W2-D48); every other test file.

**Interfaces:**
- Consumes (at the base, unchanged):
  - `lib.mjs` (W2-2a Task 5): `recallSeamEngaged({ session, arm, asof }): boolean`, true iff at least one value is a non-empty string; `decideSeamInPane({ pane, recall }): { ok: true } | { ok: false, rc: 2, reason: 'headless-in-pane' }`, refusing iff `pane` is a string and the seam is engaged.
  - `lib.mjs`, older: module-private `refuseScope(reason)`; `idOk(id)`; `UUID_RE` (lowercase); `EXIT`, `REASONS`; `resolveGeneration` (read, never edited).
  - `lib.d.mts`: `RecallSeamValues`, `ScopeRefusal<R>`, `GenerationChoice`.
  - The store's v1 columns `asOfFamilySql` names: `entries.uuid` and `entry_id`; `boundaries.entry_id` and `transcript_pk`; `transcripts.transcript_pk`, `cc_session_uuid` and `agent_id`; `epochs.session_pk`, `seq`, `cc_session_uuid`, `cwd`, `cwd_real` and `confirmed_ms`; `sessions.session_pk`, `ccrc_id`, `generation`, `project` and `merged_into`.
  - **From Task 1, checked by Step 0 before any edit:** `RECALL_ARMS`, frozen `['control', 'treatment']`; `parseHeadlessList(text)`, answering frozen `{ ok: true, storeId, pairs }` (generation `''` for `-`, zero pairs allowed) or `{ ok: false, rc: 2, reason: 'headless-malformed' }`; `formatHeadlessList({ storeId, pairs }): string`; `headlessMarkerOf(read)`; `REASONS['headless-malformed'] === 2` and `REASONS['headless-arm-unknown'] === 2`; `lib.d.mts`' `HeadlessPair`, `HeadlessList` and `HeadlessMarkerRead`.
- Produces:
  - `lib.mjs`: `export function decideHeadless({ recall, paneSet, marker })` → `{ ok: true, path: 'tmux' }`, or `{ ok: true, path: 'headless', session, arm, asof, list: { storeId, pairs } }`, or `{ ok: false, rc: 2, reason }` with `reason` one of `headless-in-pane`, `headless-unarmed`, `headless-malformed`, `no-identity`, `bad-id`, `headless-unlisted`, `headless-arm-unknown`, `asof-invalid`, in that order of precedence.
  - `lib.mjs`: `export function decideHeadlessStore({ list, storeId })` → `{ ok: true }` or `{ ok: false, rc: 2, reason: 'headless-unlisted' }`, refusing iff `list.storeId !== storeId` (a `null` `storeId` matches no store line).
  - `lib.mjs`: `export function asOfFamilySql(): string`, with one named parameter, `:asof`, and the columns above, ordered by the epoch's `(session_pk, seq)`.
  - `lib.mjs`: `export function decideAsOfFamily({ session, asof, rows, list, storeId })` → `{ ok: true, via: 'asof', generation: string, family: { ccrcId: string, project: string }, anchor: string | null }` or `{ ok: false, rc: 2, reason: 'headless-unlisted' | 'asof-invalid' }`. `generation` is an exact key (`''` for a legacy family, never `null`); `family.project` is the family's STORED project; `anchor` is the matched epoch's `cwd_real ?? cwd`.
  - `lib.d.mts`, each declared once: `decideHeadless`, `decideHeadlessStore`, `AsOfFamilyRow`, `asOfFamilySql`, `decideAsOfFamily`; `GenerationChoice.via` with `'asof'`.
- The contract Task 3 keeps (stated here so it is not re-decided there): keep W2-2a's `inPane` lines; read the marker with R1's one line only on the headless path, and hand `decideHeadless` `paneSet: pane !== null`; after `decideStatusRead` (W2-D46 step 4), call `decideHeadlessStore` with `storeId` from the `meta` row alone, and only when it answers `ok` run `asOfFamilySql()` on the admitted store and pass its rows whole to `decideAsOfFamily`, with the same `storeId` (R3: the store line before the ASOF rows are read); hand `decideScope` `{ value: generation, via }`, W2-D41's guard `family.project`, and the env `--workspace` presence `anchor`; set `seen.id`, `seen.gen` and `seen.arm` only after `decideAsOfFamily` answered `ok` (R4).

**Choices this task makes:**
- **The marker arrives folded.** `decideHeadless` never sees a read's state words: Task 1's `headlessMarkerOf` is the one fold (absent, unreadable, over-cap, value), and `decideHeadless` passes its refusal through unchanged (mutant H14). Unreadable is never absent (IV5) by Task 1's M27 and M28.
- **SESSION unset is `recallSeamEngaged` on SESSION alone.** So `''` is unset by W2-D45's one rule, and `''` answers `no-identity`, not `bad-id`, though `idOk('')` is false. Mutant H10 pins it.
- **ARM and ASOF absence fold into their grammar words** (W2-D42): absent, empty and out-of-vocabulary ARM are `headless-arm-unknown`, and absent, empty, non-UUID and upper-case ASOF are `asof-invalid` (`UUID_RE` is lowercase, like every uuid the store holds). `ARM=control` passes step 1: its exit 8 is step 6's.
- **The store line comes first at admission, as its own decision** (R3: "the store line is checked before the ASOF rows are read"). A marker written for another store arms nothing on this one, so `decideHeadlessStore` answers it before any ASOF row is read: the read verbs call it before they run `asOfFamilySql`, and `decideAsOfFamily` calls it as its first row. A foreign marker with a bad ASOF, or with an ASOF read that would fail, answers `headless-unlisted`. A store whose meta holds no `store_id` matches no store line (fail closed).
- **"Exactly one family", read strictly** (R3). The transcript's `cc_session_uuid` must be a confirmed epoch of exactly one family after the hop, of ANY id, and that family's `ccrc_id` must be SESSION. A transcript that a second family also confirms has no single owner (derivation's `epochOf` would pick the lower `session_pk`), so it refuses `asof-invalid`, whichever family is SESSION's.
- **One `merged_into` hop, as `ownFamily` follows it.** `mergeFamily` moves every epoch into (id, G), so a well-formed store holds no epoch on a merged row. The hop covers a store mid-merge or replayed. A hop that lands on a row merged again, or on no row, which only a damaged store holds, refuses (fail closed).
- **The transcript is the boundaries row's** (D-6281, the W2-2a whole-branch review's ruling for `asOfCutOf`): `asOfFamilySql` joins `transcripts` on `bd.transcript_pk`, never `e.transcript_pk`. Mutant F12 pins it.
- **The statement lives in lib, beside its decider, with Task 3's column names** (R3). It returns SQL text, as W2-2a's `asOfEntrySql` does, so "what the ASOF family is" is defined in one file and history-lib runs it on a real store's schema; no in-process test may import cli.mjs. The `uuid` column, beyond Task 3's names, lets the decider check the rows are ASOF's.
- **The anchor rule lives in lib** (R3): the first epoch row's `cwd_real ?? cwd`, in `(session_pk, seq)` order. Only a store mid-merge holds two rows of one family.

**Residuals, named:**
- No door answers any of these words at this task's commit. Task 3 produces them, with C4's seam half, C30 and the spawned W2-D40 pin (purge and reuse through the real registry and env, with its registry-read mutants).
- W2-D40's two registry residuals, the harness read and `--session <other>`'s newest family, are Task 3's. D-5767's entry names them.
- The anchor rule for two epoch rows of one family, and the refused chain, apply only to a damaged or mid-merge store.

**Security doors this task owns.** W2-D46 step 1's order, and step 4's admission:
- **Each refusal word at its step.** Case 1 is a staircase: each input fixes one more condition than the one before it, so each case is the CONTROL of the step before it.
- **The order, pair by pair.** Case 2 gives each pair of adjacent steps an input that fails both, so a swap of the two rows answers the later word. Mutants H2 to H7 are those swaps.
- **The marker is consulted only past the pane row.** Case 3 runs with a marker object whose `ok` getter throws: no seam, empty seam values and every pane leave it untouched, and one step past the pane row reads it.
- **No registry or environment generation reaches the env path.** `decideAsOfFamily` takes no such input. Case 8 scans its text, `asOfFamilySql`'s and `decideHeadless`'s, and mutant F15 makes it read one and goes red.
- **The marker for another store is refused at admission, before any ASOF row** (cases 5 and 7; `decideHeadlessStore` on its own and as `decideAsOfFamily`'s first row in case 5; mutants F1 and F17 to F19). Task 3 pins the CLI's order with a fault planted on the statement's text.

- [ ] **Step 0: Check the base and Task 1's names.** From the repository root, before any edit:

```bash
grep -c '^export function asOfCutOf(rc, asof) {$' ccd/history/recall.mjs
grep -c '^export function decideSeamInPane({ pane, recall }) {$' ccd/history/lib.mjs
node --input-type=module -e "
const l = await import('./ccd/history/lib.mjs');
const S = 'c3c3c3c3-3333-4333-8333-333333333333';
const pairs = [{ ccrcId: 'w2b-demo', generation: 'a1a1a1a1-1111-4111-8111-111111111111' }, { ccrcId: 'w2b-legacy', generation: '' }];
const t = l.formatHeadlessList({ storeId: S, pairs });
const p = l.headlessMarkerOf({ state: 'value', value: t });
const z = l.parseHeadlessList(l.formatHeadlessList({ storeId: S, pairs: [] }));
console.log(JSON.stringify([[...l.RECALL_ARMS], Object.isFrozen(l.RECALL_ARMS), l.REASONS['headless-malformed'], l.REASONS['headless-arm-unknown'],
  typeof t, p.ok, p.storeId, p.pairs, z.ok, z.pairs, l.headlessMarkerOf({ state: 'absent' }).reason, l.headlessMarkerOf({ state: 'over-cap' }).reason]));
"
```

Expected:
- `1`, then `1` (W2-2a is on the base);
- then exactly `[["control","treatment"],true,2,2,"string",true,"c3c3c3c3-3333-4333-8333-333333333333",[{"ccrcId":"w2b-demo","generation":"a1a1a1a1-1111-4111-8111-111111111111"},{"ccrcId":"w2b-legacy","generation":""}],true,[],"headless-unarmed","headless-malformed"]`.

On any other output, make no edit and report to the coordinator: a missing name means Task 1 has not run.

- [ ] **Step 1: Confirm the anchors, that no name is taken, and the base counts.** From the repository root:

```bash
grep -c "^/\*\* The session's id from tmux (§8.2, D-4675 (history-identity-from-tmux)). The$" ccd/history/lib.mjs
grep -c '^/\*\* The harness check every read verb runs after the identity (§6.10 item 4,$' ccd/history/lib.mjs
grep -c '^export function resolveGeneration({ envGen, regGen }) {$' ccd/history/lib.mjs
grep -c '^export function recallSeamEngaged({ session, arm, asof }) {$' ccd/history/lib.mjs
grep -c "^export function headlessMarkerOf(read: HeadlessMarkerRead): HeadlessList | ScopeRefusal<'headless-unarmed' | 'headless-malformed'>;$" ccd/history/lib.d.mts
grep -c "^export interface GenerationChoice { value: string | null; via: 'env' | 'registry' | 'newest' }$" ccd/history/lib.d.mts
grep -c '^export function resolveGeneration(i: { envGen: string | null; regGen: Presence<string> }): GenerationChoice;$' ccd/history/lib.d.mts
grep -c '^- \*\*D-5767\*\* — `history-w2-env-identity-from-asof`' docs/superpowers/plans/2026-10-22-ccrc-history-w2-2b-headless-seam.md
grep -c '^export function decideHeadless(\|^export function decideHeadlessStore(\|^export function decideAsOfFamily(\|^export function asOfFamilySql(\|^function asOfRowFamily(\|^export interface AsOfFamilyRow ' ccd/history/*.mjs ccd/history/lib.d.mts deploy/*.mjs server/test/history-lib.test.ts
```

Expected (measured at `d119d6e90` plus Task 1, the D-5767 line with this plan on `main`): `1` for each of the first eight lines; `0` for every file on the last line. The last line counts declarations, not mentions: Task 1's comments and its describe already name `decideHeadless` (five lines of lib.mjs, two of `history-lib.test.ts`), and none declares it.

Then record the base counts, each in the foreground with a timeout of at least 600000 ms, one per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
```

Write each `N passed` (and any `skipped`) to `.superpowers/sdd/history-w2-2b/base-counts-task2.txt` (gitignored). Both must be green. A red file is re-run alone before it is reported.

- [ ] **Step 2: Write the failing tests.** Append to `server/test/history-lib.test.ts`, after its last line:

```ts

// ── W2-2b Task 2 (W2-D40, W2-D45, W2-D46): the headless seam's pure deciders ─────────────────────────────────────
// decideHeadless takes the seam's rows before the store (W2-D46 step 1) and calls W2-2a's recallSeamEngaged and
// decideSeamInPane (called, not folded); its marker is Task 1's headlessMarkerOf answer. decideAsOfFamily admits the
// env path's family from CCRC_RECALL_ASOF at step 4, with the marker's store line and its pair, over asOfFamilySql's
// rows. Pure, so it runs on darwin too; one case runs the statement on a real store's schema. Each refusal is pinned at
// its step with the CONTROL one step later, and the order pair by pair. D-5767 (history-w2-env-identity-from-asof)
describe('W2-2b headless seam: decideHeadless, decideHeadlessStore and decideAsOfFamily, the seam\'s pure deciders (W2-D40, W2-D45, W2-D46)', () => {
  type Lib = typeof import('../../ccd/history/lib.mjs');
  type Row = import('../../ccd/history/lib.mjs').AsOfFamilyRow;
  type HIn = Parameters<Lib['decideHeadless']>[0];
  type AIn = Parameters<Lib['decideAsOfFamily']>[0];
  type Marker = HIn['marker'];
  type Recall = HIn['recall'];
  type Pair = { ccrcId: string; generation: string };
  const lib = async (): Promise<Lib> => await import('../../ccd/history/lib.mjs');
  const S = 'w2b-demo';
  const OTHER_ID = 'w2b-other';
  const G1 = 'a1a1a1a1-1111-4111-8111-111111111111';
  const G2 = 'b2b2b2b2-2222-4222-8222-222222222222';
  const STORE = 'c3c3c3c3-3333-4333-8333-333333333333';
  const FOREIGN = 'c4c4c4c4-4444-4444-8444-444444444444';
  const ASOF = 'd4d4d4d4-4444-4444-8444-444444444444';
  const NONE: Recall = { session: null, arm: null, asof: null };
  const TMUX = { ok: true, path: 'tmux' };
  const refused = (reason: string): { ok: false; rc: number; reason: string } => ({ ok: false, rc: 2, reason });
  /** A marker as Task 1's fold answers it, from the one formatter (W2-D44). */
  const markerOf = (l: Lib, pairs: Pair[], storeId: string = STORE): Marker =>
    l.headlessMarkerOf({ state: 'value', value: l.formatHeadlessList({ storeId, pairs }) });
  /** The same marker text with its first LF made CRLF: a CR anywhere is malformed (W2-D44). */
  const withCr = (l: Lib): Marker =>
    l.headlessMarkerOf({ state: 'value', value: l.formatHeadlessList({ storeId: STORE, pairs: [{ ccrcId: S, generation: G1 }] }).replace('\n', '\r\n') });
  /** A marker that throws when looked at: a row before the marker row never reads it. */
  const UNTOUCHABLE = { get ok(): never { throw new Error('the marker was looked at'); } } as unknown as Marker;
  /** A function's text in lib.mjs: its `export function <name>(` line through the next line that is exactly `}`. */
  const fnText = (name: string): string => {
    const src = readFileSync(fileURLToPath(new URL('../../ccd/history/lib.mjs', import.meta.url)), 'utf8').split('\n');
    const at = src.findIndex((x) => x.startsWith(`export function ${name}(`));
    return at < 0 ? '' : src.slice(at, src.indexOf('}', at) + 1).join('\n');
  };
  /** Every seam value set and valid, the treatment arm; and the marker that lists S under G1. */
  const full = (l: Lib): Recall => ({ session: S, arm: l.RECALL_ARMS[1]!, asof: ASOF });
  const listed = (l: Lib): Marker => markerOf(l, [{ ccrcId: S, generation: G1 }]);
  /** decideHeadless's input with no pane: every value valid unless `recall` overrides it. */
  const atOf = (l: Lib) => (recall: Partial<Recall>, marker: Marker = listed(l)): HIn =>
    ({ recall: { ...full(l), ...recall }, paneSet: false, marker });
  /** One confirmed epoch of (S, G1), not merged, on a main transcript, holding ASOF's boundary. */
  const row = (o: Partial<Row> = {}): Row => ({
    uuid: ASOF, entry_id: 40, boundary_entry_id: 40, agent_id: '', cwd: '/home/u/tree/a', cwd_real: '/home/u/tree/a-real',
    session_pk: 1, ccrc_id: S, generation: G1, project: 'proj-a', merged_into: null,
    into_session_pk: null, into_ccrc_id: null, into_generation: null, into_project: null, into_merged_into: null, ...o,
  });
  const LIST = { storeId: STORE, pairs: [{ ccrcId: S, generation: G1 }] };
  const askOf = (l: Lib) => (o: Partial<AIn> = {}): unknown =>
    l.decideAsOfFamily({ session: S, asof: ASOF, rows: [row()], list: LIST, storeId: STORE, ...o });
  const admitted = (generation: string, anchor: string | null, ccrcId: string = S): unknown =>
    ({ ok: true, via: 'asof', generation, family: { ccrcId, project: 'proj-a' }, anchor });

  it('decideHeadless: each word at its step, each case the CONTROL of the one before it (W2-D46 step 1)', async () => {
    const l = await lib();
    const FULL = full(l);
    const at = atOf(l);
    const steps: Array<[string, HIn, unknown]> = [
      ['1. no seam value set, no pane: the tmux path', { recall: NONE, paneSet: false, marker: null }, TMUX],
      ['1. no seam value set, in a pane: today\'s tmux path', { recall: NONE, paneSet: true, marker: null }, TMUX],
      ['2. the seam set in a pane', { recall: FULL, paneSet: true, marker: null }, refused('headless-in-pane')],
      ['3. no marker', at({}, l.headlessMarkerOf({ state: 'absent' })), refused('headless-unarmed')],
      ['3. a marker that cannot be read is never read as absent', at({}, l.headlessMarkerOf({ state: 'unreadable' })), refused('headless-malformed')],
      ['3. a marker the grammar refuses', at({}, withCr(l)), refused('headless-malformed')],
      ['4. SESSION unset', at({ session: null }), refused('no-identity')],
      ['4. SESSION empty is unset', at({ session: '' }), refused('no-identity')],
      ['5. SESSION off the id grammar', at({ session: '../w2b-demo' }), refused('bad-id')],
      ['6. SESSION on no list line', at({ session: OTHER_ID }), refused('headless-unlisted')],
      ['6. a marker with zero pairs lists nobody', at({}, markerOf(l, [])), refused('headless-unlisted')],
      ['7. ARM absent', at({ arm: null }), refused('headless-arm-unknown')],
      ['7. ARM empty', at({ arm: '' }), refused('headless-arm-unknown')],
      ['7. ARM outside RECALL_ARMS', at({ arm: 'other' }), refused('headless-arm-unknown')],
      ['7. ARM in another case', at({ arm: FULL.arm!.toUpperCase() }), refused('headless-arm-unknown')],
      ['8. ASOF absent', at({ asof: null }), refused('asof-invalid')],
      ['8. ASOF empty', at({ asof: '' }), refused('asof-invalid')],
      ['8. ASOF off the UUID grammar', at({ asof: 'not-a-uuid' }), refused('asof-invalid')],
      ['8. ASOF in upper case', at({ asof: ASOF.toUpperCase() }), refused('asof-invalid')],
    ];
    for (const [why, input, want] of steps) expect(l.decideHeadless(input), why).toEqual(want);
    const passed = { ok: true, path: 'headless', session: S, asof: ASOF, list: { storeId: STORE, pairs: [{ ccrcId: S, generation: G1 }] } };
    for (const arm of l.RECALL_ARMS) {
      expect(l.decideHeadless(at({ arm })), `past every row, ARM ${arm}: its exit 8 is step 6's, not this decider's`).toEqual({ ...passed, arm });
    }
    for (const w of ['headless-in-pane', 'headless-unarmed', 'headless-malformed', 'no-identity', 'bad-id', 'headless-unlisted',
      'headless-arm-unknown', 'asof-invalid']) expect(REASONS[w], `${w} is an exit-2 REASONS word`).toBe(EXIT.REFUSED);
  });

  it('decideHeadless: an input that fails two adjacent steps answers the earlier word, pair by pair', async () => {
    const l = await lib();
    const at = atOf(l);
    // Rows 1 and 2 cannot be told apart by any input (decideSeamInPane refuses only an engaged seam).
    const pairs: Array<[string, HIn, unknown]> = [
      ['2 before 3: a pane, and no marker', { recall: full(l), paneSet: true, marker: l.headlessMarkerOf({ state: 'absent' }) }, refused('headless-in-pane')],
      ['3 before 4: a refused marker, and no SESSION', at({ session: null }, withCr(l)), refused('headless-malformed')],
      ['4 before 5: an empty SESSION, which idOk refuses too', at({ session: '' }), refused('no-identity')],
      ['5 before 6: an id off the grammar, on no list line', at({ session: '../w2b-demo' }), refused('bad-id')],
      ['6 before 7: an unlisted id, and an unknown ARM', at({ session: OTHER_ID, arm: 'other' }), refused('headless-unlisted')],
      ['7 before 8: an unknown ARM, and an ASOF off the grammar', at({ arm: null, asof: 'not-a-uuid' }), refused('headless-arm-unknown')],
    ];
    for (const [why, input, want] of pairs) expect(l.decideHeadless(input), why).toEqual(want);
  });

  it('W2-D45: empty is unset, a set paneSet is a pane, and the marker is looked at only past the pane row', async () => {
    const l = await lib();
    const EMPTY: Recall = { session: '', arm: '', asof: '' };
    for (const paneSet of [false, true]) {
      expect(l.decideHeadless({ recall: EMPTY, paneSet, marker: UNTOUCHABLE }), `empty values, paneSet ${paneSet}`).toEqual(TMUX);
      expect(l.decideHeadless({ recall: NONE, paneSet, marker: UNTOUCHABLE }), `no values, paneSet ${paneSet}`).toEqual(TMUX);
    }
    expect(l.decideHeadless({ recall: { ...NONE, asof: ASOF }, paneSet: true, marker: UNTOUCHABLE }), 'a pane').toEqual(refused('headless-in-pane'));
    expect(l.decideHeadless({ recall: { ...NONE, asof: ASOF }, paneSet: undefined as unknown as boolean, marker: UNTOUCHABLE }),
      'anything but false is a pane (fail closed)').toEqual(refused('headless-in-pane'));
    expect(() => l.decideHeadless({ recall: { ...NONE, arm: 'x' }, paneSet: false, marker: UNTOUCHABLE }),
      'CONTROL: one row past the pane, the marker is looked at').toThrow('the marker was looked at');
    expect(() => l.decideHeadless({ recall: { ...NONE, session: S }, paneSet: false, marker: null }),
      'a marker not read past the pane row is the caller\'s defect').toThrow(/the seam is engaged and the marker was not read/);
  });

  it('R1: decideHeadless calls W2-2a\'s recallSeamEngaged and decideSeamInPane, which stay exported, and spells neither rule, nor the marker\'s fold, again', async () => {
    const body = fnText('decideHeadless');
    expect(body, 'decideHeadless is found').toContain('export function decideHeadless({ recall, paneSet, marker }) {');
    expect(body, 'row 1 is W2-D45\'s rule').toContain("  if (!recallSeamEngaged(recall)) return { ok: true, path: 'tmux' };");
    expect(body, 'row 2 is W2-D39\'s rule').toContain("  const inPane = decideSeamInPane({ pane: paneSet === false ? null : '', recall });");
    expect(body, 'row 3 is headlessMarkerOf\'s answer').toContain('  if (!marker.ok) return marker;');
    expect(body, 'row 4 is W2-D45\'s rule on SESSION alone')
      .toContain("  if (!recallSeamEngaged({ session, arm: null, asof: null })) return refuseScope('no-identity');");
    for (const second of [/typeof pane/, /PANE_RE/, /=== ''|!== ''/, /\.length\b/, /headless-in-pane/, /\.state\b/]) {
      expect(body, `no second spelling: ${String(second)}`).not.toMatch(second);
    }
    const l = await lib();
    expect([typeof l.recallSeamEngaged, typeof l.decideSeamInPane], 'kept, not folded').toEqual(['function', 'function']);
  });

  it('decideAsOfFamily: each word at its step, each case the CONTROL of the one before it (W2-D40; W2-D44\'s store line and pair)', async () => {
    const l = await lib();
    const ask = askOf(l);
    const NO_EPOCH: Partial<Row> = { cwd: null, cwd_real: null, session_pk: null, ccrc_id: null, generation: null, project: null };
    const HOP = { into_session_pk: 1, into_ccrc_id: S, into_generation: G1, into_project: 'proj-a', into_merged_into: null };
    const steps: Array<[string, unknown, unknown]> = [
      ['1. the store line names another store', ask({ list: { ...LIST, storeId: FOREIGN } }), refused('headless-unlisted')],
      ['1. this store\'s meta holds no store_id', ask({ storeId: null }), refused('headless-unlisted')],
      ['2. no entry has the uuid', ask({ rows: [] }), refused('asof-invalid')],
      ['2. the rows are another uuid\'s', ask({ rows: [row({ uuid: G2 })] }), refused('asof-invalid')],
      ['2. the entry has no boundaries row', ask({ rows: [row({ boundary_entry_id: null })] }), refused('asof-invalid')],
      ['3. the boundary\'s transcript is a sidechain', ask({ rows: [row({ agent_id: 'a1' })] }), refused('asof-invalid')],
      ['3. the boundary names no transcript', ask({ rows: [row({ agent_id: null })] }), refused('asof-invalid')],
      ['4. the merged_into hop lands on a merged row', ask({ rows: [row({ session_pk: 4, generation: '', merged_into: 1, ...HOP, into_merged_into: 9 })] }), refused('asof-invalid')],
      ['4. the merged_into hop lands on no row', ask({ rows: [row({ session_pk: 4, generation: '', merged_into: 9 })] }), refused('asof-invalid')],
      ['4. no confirmed epoch', ask({ rows: [row(NO_EPOCH)] }), refused('asof-invalid')],
      ['4. two families confirm the transcript',
        ask({ rows: [row(), row({ session_pk: 6, ccrc_id: OTHER_ID, generation: G2 })] }), refused('asof-invalid')],
      ['5. the one family is another id\'s, though (SESSION, its generation) is a pair',
        ask({ rows: [row({ ccrc_id: OTHER_ID })] }), refused('asof-invalid')],
      ['6. (SESSION, the family\'s generation) is no pair', ask({ rows: [row({ session_pk: 2, generation: G2 })] }), refused('headless-unlisted')],
      ['admitted: an exact key, and the anchor is cwd_real', ask(), admitted(G1, '/home/u/tree/a-real')],
      ['admitted: the anchor falls back to cwd', ask({ rows: [row({ cwd_real: null })] }), admitted(G1, '/home/u/tree/a')],
      ['admitted: an epoch with neither has no anchor', ask({ rows: [row({ cwd: null, cwd_real: null })] }), admitted(G1, null)],
      ['admitted: one family through two epoch rows, one on a row merged into it, and the first row\'s anchor',
        ask({ rows: [row(), row({ session_pk: 4, generation: '', merged_into: 1, ...HOP, cwd_real: '/home/u/tree/b' })] }), admitted(G1, '/home/u/tree/a-real')],
      ['admitted: a legacy family, generation \'\'',
        ask({ rows: [row({ generation: '' })], list: { storeId: STORE, pairs: [{ ccrcId: S, generation: '' }] } }), admitted('', '/home/u/tree/a-real')],
    ];
    for (const [why, got, want] of steps) expect(got, why).toEqual(want);
    // R3: row 1 is its own decision, which the read verbs call before any ASOF row is read, and decideAsOfFamily's first row.
    expect(l.decideHeadlessStore({ list: LIST, storeId: STORE }), 'CONTROL: this store\'s own line').toEqual({ ok: true });
    expect(l.decideHeadlessStore({ list: { ...LIST, storeId: FOREIGN }, storeId: STORE }), 'another store\'s line').toEqual(refused('headless-unlisted'));
    expect(l.decideHeadlessStore({ list: LIST, storeId: null }), 'no meta store_id matches no line').toEqual(refused('headless-unlisted'));
    const body = fnText('decideAsOfFamily');
    expect(body, 'decideAsOfFamily\'s first row is decideHeadlessStore').toContain('  const store = decideHeadlessStore({ list, storeId });');
    expect(body, 'and it spells the store-line rule no second time').not.toContain('list.storeId !==');
  });

  it('decideAsOfFamily: an input that fails two adjacent steps answers the earlier word', async () => {
    const l = await lib();
    const ask = askOf(l);
    expect(ask({ list: { ...LIST, storeId: FOREIGN }, rows: [] }), '1 before 2: a foreign store line, and no entry')
      .toEqual(refused('headless-unlisted'));
    expect(ask({ rows: [row({ session_pk: 6, ccrc_id: OTHER_ID, generation: G2 })] }),
      '5 before 6: another id\'s family, whose generation is no pair of SESSION\'s').toEqual(refused('asof-invalid'));
    // Rows 2 to 5 answer one word, so swapping two of them changes no answer: each is pinned by its own drop mutant.
  });

  it('decideAsOfFamily over asOfFamilySql on a real store: purge and reuse, legacy and merged families, the D-6281 shape, each refusal', async () => {
    const l = await lib();
    const home = mkTmp('ccrc-history-w2b-family-');
    replayStore.createStore(home, { storeId: STORE });
    const db = replayStore.openWriter(l.historyPaths(home).dbFile);
    try {
      const G3 = 'e3e3e3e3-3333-4333-8333-333333333333';
      const G4 = 'e4e4e4e4-4444-4444-8444-444444444444';
      const G5 = 'e5e5e5e5-5555-4555-8555-555555555555';
      const G6 = 'e6e6e6e6-6666-4666-8666-666666666666';
      const uuid = (k: number): string => `f0f0f0f0-0000-4000-8000-${String(k).padStart(12, '0')}`;
      const fam = db.prepare('INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms, merged_into) VALUES (?, ?, ?, ?, ?, ?)');
      fam.run(1, S, G1, 'proj-a', 1000, null);
      fam.run(2, S, G2, 'proj-a', 2000, null);              // S's newest family: the id was purged and reused
      fam.run(3, 'w2b-legacy', '', 'proj-a', 500, null);
      fam.run(5, 'w2b-merged', G3, 'proj-a', 600, null);
      fam.run(4, 'w2b-merged', '', 'proj-a', 400, 5);       // a '' family merged into (w2b-merged, G3), still holding an epoch
      fam.run(6, OTHER_ID, G4, 'proj-b', 700, null);
      fam.run(9, 'w2b-chain', G6, 'proj-a', 320, null);
      fam.run(8, 'w2b-chain', G5, 'proj-a', 310, 9);
      fam.run(7, 'w2b-chain', '', 'proj-a', 300, 8);        // its one hop lands on a row merged again
      const tr = db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid, agent_id) VALUES (?, ?, ?)');
      for (const [tpk, k] of [[1, 101], [2, 102], [3, 103], [4, 104], [5, 105], [6, 106], [8, 108]] as const) tr.run(tpk, uuid(k), '');
      tr.run(7, uuid(101), 'a1');                           // a sidechain of transcript 1's session
      const ep = db.prepare(`INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, cwd, cwd_real, confirmed_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      const epoch = (pk: number, seq: number, k: number, cwd: string | null, real: string | null, confirmed: number | null): void => {
        ep.run(pk, seq, uuid(k), EPOCH_CAUSES[0]!, DECLARED_BY[0]!, cwd, real, confirmed);
      };
      epoch(1, 1, 101, '/home/u/tree/a', '/home/u/tree/a-real', 1100);
      epoch(2, 1, 102, '/home/u/tree/b', '/home/u/tree/b', 2100);
      epoch(3, 1, 103, '/home/u/tree/l', null, 600);
      epoch(4, 1, 104, null, null, 450);
      epoch(1, 2, 105, null, null, 1200);
      epoch(6, 1, 105, null, null, 800);                    // transcript 5 is confirmed by two families
      epoch(1, 3, 106, null, null, null);                   // transcript 6's one epoch is unconfirmed
      epoch(7, 1, 108, null, null, 350);
      const blob = db.prepare("INSERT INTO blobs (blob_id, sha256, codec, raw_len) VALUES (?, ?, 'raw', 0)");
      const ent = db.prepare(`INSERT INTO entries (entry_id, uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns,
        struct_file_id, blob_id) VALUES (?, ?, ?, 'system', 'harness', 1, ?, 1, ?)`);
      const bnd = db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, ?, ?)');
      /** Entry k on transcript `tpk`, with a boundaries row on `onTpk` (ord `ord`) unless that is null. */
      const plant = (k: number, tpk: number, onTpk: number | null, ord = 1): string => {
        blob.run(k, createHash('sha256').update(`w2b-family-${k}`).digest());
        ent.run(k, uuid(k), tpk, k, k);
        if (onTpk !== null) bnd.run(k, onTpk, ord);
        return uuid(k);
      };
      const N1 = plant(1, 1, 1);
      const N2 = plant(2, 2, 2);
      const NL = plant(3, 3, 3);
      const NM = plant(4, 4, 4);
      const NB = plant(5, 5, 5);
      const NU = plant(6, 6, 6);
      const NS = plant(7, 7, 7);
      const NP = plant(8, 1, null);                         // a plain row: no boundaries row
      const NX = plant(9, 7, 1, 2);                         // D-6281: the entries row names the sidechain, the boundaries row the main transcript
      const NC = plant(10, 8, 8);
      const NZ = uuid(99);                                  // no entry has it
      const own = (db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get() as unknown as { v: string }).v;
      expect(own, 'CONTROL: the store is the one the marker names').toBe(STORE);
      const pairs: Pair[] = [{ ccrcId: S, generation: G1 }, { ccrcId: 'w2b-legacy', generation: '' }, { ccrcId: 'w2b-merged', generation: G3 },
        { ccrcId: OTHER_ID, generation: G4 }, { ccrcId: 'w2b-chain', generation: G5 }, { ccrcId: 'w2b-chain', generation: G6 }];
      /** Step 1, then the statement, then step 4's decision, as Task 3 composes them. */
      const admit = (session: string, asof: string, marker: Marker = markerOf(l, pairs)): unknown => {
        const seam = l.decideHeadless({ recall: { session, arm: l.RECALL_ARMS[1]!, asof }, paneSet: false, marker });
        if (!seam.ok || seam.path !== 'headless') throw new Error(`step 1 refused: ${JSON.stringify(seam)}`);
        const rows = db.prepare(l.asOfFamilySql()).all({ asof: seam.asof }) as unknown as Row[];
        return l.decideAsOfFamily({ session: seam.session, asof: seam.asof, rows, list: seam.list, storeId: own });
      };
      expect(admit(S, N1), 'purge and reuse: ASOF in G1\'s transcript reads G1, though S\'s newest family is G2')
        .toEqual(admitted(G1, '/home/u/tree/a-real'));
      expect(admit(S, N2), 'CONTROL: ASOF in G2\'s transcript, and (S, G2) is no pair').toEqual(refused('headless-unlisted'));
      expect(admit(S, NX), 'D-6281: the boundaries row\'s transcript decides main, never the entries row\'s')
        .toEqual(admitted(G1, '/home/u/tree/a-real'));
      expect(admit('w2b-legacy', NL), 'a legacy family: \'\' is an exact key, and the anchor falls back to cwd')
        .toEqual(admitted('', '/home/u/tree/l', 'w2b-legacy'));
      expect(admit('w2b-merged', NM), 'a merged \'\' family is admitted as the family it merged into')
        .toEqual(admitted(G3, null, 'w2b-merged'));
      for (const [why, asof] of [['two families confirm its transcript', NB], ['its one epoch is unconfirmed', NU],
        ['a sidechain boundary', NS], ['a plain row', NP], ['no entry', NZ]] as const) {
        expect(admit(S, asof), why).toEqual(refused('asof-invalid'));
      }
      expect(admit('w2b-chain', NC), 'a hop that lands on a merged row').toEqual(refused('asof-invalid'));
      expect(admit(OTHER_ID, N1), 'another id\'s family').toEqual(refused('asof-invalid'));
      expect(admit(S, N1, markerOf(l, pairs, FOREIGN)), 'a marker for another store passes step 1 and is refused at admission')
        .toEqual(refused('headless-unlisted'));
    } finally { db.close(); }
  });

  it('the env path reads no registry or environment generation, and the tmux path\'s resolveGeneration is byte-identical (W2-D40; C48 stays tmux-only)', async () => {
    for (const name of ['decideHeadless', 'decideHeadlessStore', 'asOfFamilySql', 'decideAsOfFamily']) {
      const body = fnText(name);
      expect(body.length, `${name} is found`).toBeGreaterThan(0);
      expect(body, name).not.toMatch(/resolveGeneration|envGen|regGen|process\.env|CCRC_SESSION_GENERATION|\.workdir\b|newest/);
    }
    expect(fnText('resolveGeneration').split('\n'), 'resolveGeneration, byte for byte as at d119d6e90').toEqual([
      'export function resolveGeneration({ envGen, regGen }) {',
      "  if (typeof envGen === 'string' && UUID_RE.test(envGen)) return { value: envGen, via: 'env' };",
      "  if (regGen.state === 'value' && UUID_RE.test(regGen.value.trim())) return { value: regGen.value.trim(), via: 'registry' };",
      "  return { value: null, via: 'newest' };",
      '}',
    ]);
    const l = await lib();
    expect(l.resolveGeneration({ envGen: G2, regGen: { state: 'value', value: G1 } }), 'CONTROL: the tmux path still reads the env first')
      .toEqual({ value: G2, via: 'env' });
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call. First list what the filter selects:

```bash
(cd server && ./node_modules/.bin/vitest list test/history-lib.test.ts -t 'W2-2b headless seam')
```

Expected: 8 tests. Then run them:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-2b headless seam')
```

Expected (predicted, written before the code): `8 failed`.
- The three `decideHeadless` cases: `TypeError: … decideHeadless is not a function`, each at its first call (Task 1's `formatHeadlessList` and `headlessMarkerOf`, which `markerOf` calls, already exist).
- `R1: decideHeadless calls …`: `expected '' to contain 'export function decideHeadless({ recall, paneSet, marker }) {'`.
- The two hand-row `decideAsOfFamily` cases: `TypeError: … decideAsOfFamily is not a function`, when the steps array is built.
- The real-store case: `TypeError: … decideHeadless is not a function` inside `admit`. The fixture inserts before it succeed: the statement shapes match the schema.
- `the env path reads no …`: `decideHeadless is found: expected 0 to be greater than 0`. Its `resolveGeneration` half is never reached, and would pass: that function does not change.

- [ ] **Step 4: Write the code.** From the repository root, run this script. Each replacement asserts that its anchor occurs exactly once. The python body is a quoted heredoc, and every block is a raw string.

```bash
python3 - . <<'PYEOF'
import sys
ROOT = sys.argv[1]
def rep(rel, old, new):
    p = f'{ROOT}/{rel}'
    s = open(p, encoding='utf-8').read()
    assert s.count(old) == 1, (rel, old[:80], s.count(old))
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))

# lib.mjs: decideHeadless, after Task 1's section and above decideIdentity's doc comment.
rep('ccd/history/lib.mjs',
r"""/** The session's id from tmux (§8.2, D-4675 (history-identity-from-tmux)). The
""",
r"""/** W2-D46 step 1: the headless seam's rows before the store, in the ruled order (§8.2; W2-D45, W2-D46). It calls
 *  W2-2a's recallSeamEngaged and decideSeamInPane and spells neither rule again (called, not folded). What the read
 *  verbs measured:
 *  - `recall`: CCRC_RECALL_SESSION, CCRC_RECALL_ARM and CCRC_RECALL_ASOF, each null when undefined (empty is unset);
 *  - `paneSet`: whether TMUX_PANE is defined (W2-D45: defined is set, '' included); anything but false is a pane;
 *  - `marker`: headlessMarkerOf's answer for the marker's one read (W2-D44), a parsed list or its headless-unarmed or
 *    headless-malformed refusal, or null when the caller did not read it. The caller reads it only on the headless
 *    path (the seam engaged, no pane), so neither the tmux path nor a pane reads it; a null marker past the pane row
 *    is the caller's defect and throws.
 *  The rows, each refusal exit 2, the first that applies winning:
 *   1. no seam value set: `{ ok: true, path: 'tmux' }`, and nothing else is looked at;
 *   2. a pane: headless-in-pane;
 *   3. the marker's refusal as headlessMarkerOf gave it: headless-unarmed (absent) or headless-malformed (W2-D48);
 *   4. SESSION unset, by recallSeamEngaged's own rule applied to SESSION alone: no-identity;
 *   5. SESSION off ccd's id grammar: bad-id (idOk, before it is compared with anything);
 *   6. SESSION on no list line, a marker with zero pairs included: headless-unlisted (W2-D44);
 *   7. ARM outside RECALL_ARMS, empty and absent included: headless-arm-unknown (W2-D42, W2-D48);
 *   8. ASOF off the UUID grammar, empty and absent included: asof-invalid, its pre-store half (W2-D42; D-5765).
 *  Past them: `{ ok: true, path: 'headless', session, arm, asof, list }`, `list` the parsed marker's store line and
 *  pairs, which decideAsOfFamily judges once the store is open (W2-D46 step 4). ARM=control is not decided here: its
 *  exit 8 comes after admission and the recall-off check (step 6). Rows 1 and 2 cannot be swapped to any effect,
 *  because decideSeamInPane refuses only an engaged seam. */
export function decideHeadless({ recall, paneSet, marker }) {
  const { session, arm, asof } = recall;
  if (!recallSeamEngaged(recall)) return { ok: true, path: 'tmux' };
  // W2-D45: decideSeamInPane reads only whether a pane is defined, so any pane is handed on as a defined, empty one.
  const inPane = decideSeamInPane({ pane: paneSet === false ? null : '', recall });
  if (!inPane.ok) return inPane;
  if (marker === null) throw new TypeError('decideHeadless: the seam is engaged and the marker was not read');
  if (!marker.ok) return marker;
  if (!recallSeamEngaged({ session, arm: null, asof: null })) return refuseScope('no-identity');
  if (!idOk(session)) return refuseScope('bad-id');
  if (!marker.pairs.some((p) => p.ccrcId === session)) return refuseScope('headless-unlisted');
  if (!RECALL_ARMS.includes(arm)) return refuseScope('headless-arm-unknown');
  if (!UUID_RE.test(asof ?? '')) return refuseScope('asof-invalid');
  return { ok: true, path: 'headless', session, arm, asof, list: { storeId: marker.storeId, pairs: marker.pairs } };
}

/** The session's id from tmux (§8.2, D-4675 (history-identity-from-tmux)). The
""")

# lib.mjs: the env path's family, after resolveGeneration and above decideHarness's doc comment.
rep('ccd/history/lib.mjs',
r"""/** The harness check every read verb runs after the identity (§6.10 item 4,
""",
r"""// ── the env path's family (W2-2b; W2-D40, W2-D44, W2-D46 step 4) ──────────
// On the headless seam's env path the family is the one CCRC_RECALL_ASOF's boundary sits in. The generation chain
// above (CCRC_SESSION_GENERATION, then $REG/<id>.generation, then the id's newest family) is not read there, so
// resolveGeneration stays the tmux path's alone, byte for byte. asOfFamilySql is the statement whose rows
// decideAsOfFamily reads: the read verbs run it on the admitted store and pass its rows whole, once decideHeadlessStore
// has passed the marker's store line.
// D-5767 (history-w2-env-identity-from-asof)

/** W2-D44's store line, the first row of W2-D46 step 4, judged once the store is open and BEFORE any ASOF row is read
 *  (R3): the marker's store line must name this store's own meta store_id, else exit 2 headless-unlisted. `storeId` is
 *  that meta value as the read verb read it, null when the meta table holds none, and null matches no store line (fail
 *  closed). The read verbs call it before they run asOfFamilySql, so a marker written for another store causes no ASOF
 *  query; decideAsOfFamily calls it as its own first row, so the rule is spelled once. D-5768 (history-w2-marker-grammar) */
export function decideHeadlessStore({ list, storeId }) {
  if (list.storeId !== storeId) return refuseScope('headless-unlisted');
  return { ok: true };
}

/** The rows decideAsOfFamily reads (W2-D40), with one named parameter, `:asof`: the entries row whose uuid is :asof;
 *  its boundaries row; the transcript the BOUNDARIES row names (D-6281: the column derivation spans with, never the
 *  entries row's); every CONFIRMED epoch of that transcript's cc_session_uuid with its family; and the family that one
 *  merged into, with its own merged_into (one hop, as recall.mjs's ownFamily follows it, so a longer chain is seen).
 *  LEFT JOINs: one row per confirmed epoch, in (session_pk, seq) order; one row with NULL epoch and family columns when
 *  there is none or no boundary; no row when no entry has the uuid. Ids, keys and launch facts only: no text is read. */
export function asOfFamilySql() {
  return `SELECT e.uuid AS uuid, e.entry_id AS entry_id, bd.entry_id AS boundary_entry_id, t.agent_id AS agent_id,
      ep.cwd AS cwd, ep.cwd_real AS cwd_real,
      s.session_pk AS session_pk, s.ccrc_id AS ccrc_id, s.generation AS generation, s.project AS project,
      s.merged_into AS merged_into,
      m.session_pk AS into_session_pk, m.ccrc_id AS into_ccrc_id, m.generation AS into_generation,
      m.project AS into_project, m.merged_into AS into_merged_into
    FROM entries e
      LEFT JOIN boundaries bd ON bd.entry_id = e.entry_id
      LEFT JOIN transcripts t ON t.transcript_pk = bd.transcript_pk
      LEFT JOIN epochs ep ON ep.cc_session_uuid = t.cc_session_uuid AND ep.confirmed_ms IS NOT NULL
      LEFT JOIN sessions s ON s.session_pk = ep.session_pk
      LEFT JOIN sessions m ON m.session_pk = s.merged_into
    WHERE e.uuid = :asof
    ORDER BY ep.session_pk, ep.seq`;
}

/** One asOfFamilySql row's family after its one merged_into hop: its own family when that is not merged, else the family
 *  it merged into when that one is not merged again; null for a chain or a hop to no row (fail closed). */
function asOfRowFamily(r) {
  if (r.merged_into === null) return { pk: r.session_pk, ccrcId: r.ccrc_id, generation: r.generation, project: r.project };
  if (r.into_session_pk === null || r.into_merged_into !== null) return null;
  return { pk: r.into_session_pk, ccrcId: r.into_ccrc_id, generation: r.into_generation, project: r.into_project };
}

/** W2-D40 with W2-D44's admission: the env path's family, decided at W2-D46 step 4, once the store is open. Inputs:
 *  - `session`, `asof` and `list`: decideHeadless's answer (SESSION passed idOk and a list line, ASOF the UUID
 *    grammar; `list` is `{ storeId, pairs }`, each pair `{ ccrcId, generation }`, '' for a legacy family);
 *  - `storeId`: this store's own meta store_id as the read verb read it, null when the meta table holds none (never
 *    an id read from the binding file in its place);
 *  - `rows`: asOfFamilySql's rows for `asof`, whole.
 *  No registry file and no environment variable is an input. The rows, the first that applies winning:
 *   1. the marker's store line is not this store's: headless-unlisted (W2-D44): decideHeadlessStore's answer, which the
 *      read verbs also take before they read any row (R3);
 *   2. no entry has the uuid, the rows are another uuid's, or the entry has no boundaries row: asof-invalid;
 *   3. the boundary's transcript is not a main one (agent_id ''): asof-invalid;
 *   4. its cc_session_uuid is a confirmed epoch of a family whose merged_into hop lands on a merged row or on no row, of
 *      no family, or of two or more families of any id: asof-invalid (fail closed: only a damaged store holds a chain,
 *      and a transcript two families confirm has no one owner);
 *   5. that one family's ccrc_id is not SESSION: asof-invalid;
 *   6. (SESSION, that family's generation) is not a pair of the list: headless-unlisted.
 *  Admitted: `{ ok: true, via: 'asof', generation, family: { ccrcId, project }, anchor }`. `generation` is an exact key
 *  ('' for a legacy family, never null), so decideScope's own-id `--session` and the family read take it unchanged;
 *  `family.project` is the family's stored project (W2-D41's guard); `anchor` is the ASOF epoch's cwd_real ?? cwd, the
 *  env path's `--workspace` anchor in place of $REG/<id>.workdir (null when it carries neither). When one family confirms
 *  the transcript through two epoch rows (only mid-merge: mergeFamily moves every epoch), the anchor is the first
 *  row's. D-5767 (history-w2-env-identity-from-asof) */
export function decideAsOfFamily({ session, asof, rows, list, storeId }) {
  const store = decideHeadlessStore({ list, storeId });
  if (!store.ok) return store;
  const n = rows[0];
  if (n === undefined || n.uuid !== asof || n.boundary_entry_id === null) return refuseScope('asof-invalid');
  if (n.agent_id !== '') return refuseScope('asof-invalid');
  const epochs = rows.filter((r) => r.session_pk !== null);
  const fams = epochs.map(asOfRowFamily);
  if (fams.some((f) => f === null)) return refuseScope('asof-invalid');
  if (new Set(fams.map((f) => f.pk)).size !== 1) return refuseScope('asof-invalid');
  const fam = fams[0];
  if (fam.ccrcId !== session) return refuseScope('asof-invalid');
  if (!list.pairs.some((p) => p.ccrcId === session && p.generation === fam.generation)) return refuseScope('headless-unlisted');
  const at = epochs[0];
  return { ok: true, via: 'asof', generation: fam.generation, family: { ccrcId: fam.ccrcId, project: fam.project }, anchor: at.cwd_real ?? at.cwd };
}

/** The harness check every read verb runs after the identity (§6.10 item 4,
""")

# lib.d.mts: decideHeadless, after Task 1's headlessMarkerOf.
rep('ccd/history/lib.d.mts',
r"""export function headlessMarkerOf(read: HeadlessMarkerRead): HeadlessList | ScopeRefusal<'headless-unarmed' | 'headless-malformed'>;
""",
r"""export function headlessMarkerOf(read: HeadlessMarkerRead): HeadlessList | ScopeRefusal<'headless-unarmed' | 'headless-malformed'>;
// --- W2-2b Task 2: the headless seam's rows before the store (W2-D45, W2-D46 step 1)
export function decideHeadless(i: {
  recall: RecallSeamValues; paneSet: boolean; marker: HeadlessList | ScopeRefusal<'headless-unarmed' | 'headless-malformed'> | null;
}):
  | { ok: true; path: 'tmux' }
  | { ok: true; path: 'headless'; session: string; arm: string; asof: string; list: { storeId: string; pairs: readonly HeadlessPair[] } }
  | ScopeRefusal<'headless-in-pane' | 'headless-unarmed' | 'headless-malformed' | 'no-identity' | 'bad-id' | 'headless-unlisted'
    | 'headless-arm-unknown' | 'asof-invalid'>;
""")

# lib.d.mts: GenerationChoice gains the env path's via (W2-D40).
rep('ccd/history/lib.d.mts',
r"""export interface GenerationChoice { value: string | null; via: 'env' | 'registry' | 'newest' }
""",
r"""export interface GenerationChoice { value: string | null; via: 'env' | 'registry' | 'newest' | 'asof' }
""")

# lib.d.mts: the env path's family, after resolveGeneration's declaration.
rep('ccd/history/lib.d.mts',
r"""export function resolveGeneration(i: { envGen: string | null; regGen: Presence<string> }): GenerationChoice;
""",
r"""export function resolveGeneration(i: { envGen: string | null; regGen: Presence<string> }): GenerationChoice;
// --- W2-2b Task 2: the env path's family, from CCRC_RECALL_ASOF (W2-D40, W2-D44, W2-D46 step 4)
/** The marker's store line against this store's meta store_id, before any ASOF row is read (R3). */
export function decideHeadlessStore(i: { list: { storeId: string; pairs: readonly HeadlessPair[] }; storeId: string | null }):
  { ok: true } | ScopeRefusal<'headless-unlisted'>;
/** One row of asOfFamilySql's answer: the ASOF entry, its boundary's transcript, one confirmed epoch with its family,
 *  and the family that one merged into (one hop). */
export interface AsOfFamilyRow {
  readonly uuid: string; readonly entry_id: number | bigint; readonly boundary_entry_id: number | bigint | null;
  readonly agent_id: string | null; readonly cwd: string | null; readonly cwd_real: string | null;
  readonly session_pk: number | bigint | null; readonly ccrc_id: string | null; readonly generation: string | null;
  readonly project: string | null; readonly merged_into: number | bigint | null;
  readonly into_session_pk: number | bigint | null; readonly into_ccrc_id: string | null; readonly into_generation: string | null;
  readonly into_project: string | null; readonly into_merged_into: number | bigint | null;
}
export function asOfFamilySql(): string;
export function decideAsOfFamily(i: {
  session: string; asof: string; rows: readonly AsOfFamilyRow[]; list: { storeId: string; pairs: readonly HeadlessPair[] };
  storeId: string | null;
}): { ok: true; via: 'asof'; generation: string; family: { ccrcId: string; project: string }; anchor: string | null }
  | ScopeRefusal<'headless-unlisted' | 'asof-invalid'>;
""")
PYEOF
```

Expected: no output and exit 0.

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms, one per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-2b headless seam')
```
```bash
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: `8 passed`, then tsc silent with exit 0. Then count the declarations, since `skipLibCheck` hides a duplicate:

```bash
grep -c '^export function decideHeadless(\|^export function decideHeadlessStore(\|^export function decideAsOfFamily(\|^export function asOfFamilySql(' ccd/history/lib.mjs
grep -c '^export function decideHeadless(\|^export function decideHeadlessStore(\|^export function decideAsOfFamily(\|^export function asOfFamilySql(\|^export interface AsOfFamilyRow ' ccd/history/lib.d.mts
grep -c "^export interface GenerationChoice { value: string | null; via: 'env' | 'registry' | 'newest' | 'asof' }$" ccd/history/lib.d.mts
grep -c 'D-5767' ccd/history/lib.mjs
```

Expected: `4`, `5`, `1` and `2`. The last is the section header and `decideAsOfFamily`'s doc comment (`decideHeadlessStore`'s cites D-5768).

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each mutant runs in its own tool call, through helpers written once to `.superpowers/sdd/history-w2-2b/t2/`. A call applies one named replacement from a table, refused unless its old text occurs exactly once. It then runs the describe and shows red, then restores lib.mjs and checks it with `cmp`. The helpers also restore on exit, a signal included, so a call killed by its timeout never leaves a mutant in the tree. A red at a CONTROL is the fixture's to fix, never the guard's to weaken.

First write the helpers, once, after Step 5's green run. They copy lib.mjs as it stands then:

```bash
mkdir -p .superpowers/sdd/history-w2-2b/t2
cat > .superpowers/sdd/history-w2-2b/t2/mutants.py <<'PY'
# One mutant per name: (old, new), each an exact text of ccd/history/lib.mjs after Task 2's Step 4.
M = {}
D_ROW1 = "  if (!recallSeamEngaged(recall)) return { ok: true, path: 'tmux' };\n"
PANE1 = "  const inPane = decideSeamInPane({ pane: paneSet === false ? null : '', recall });\n"
PANE = PANE1 + "  if (!inPane.ok) return inPane;\n"
NULLM = "  if (marker === null) throw new TypeError('decideHeadless: the seam is engaged and the marker was not read');\n"
MARK = "  if (!marker.ok) return marker;\n"
NOID = "  if (!recallSeamEngaged({ session, arm: null, asof: null })) return refuseScope('no-identity');\n"
BADID = "  if (!idOk(session)) return refuseScope('bad-id');\n"
UNL = "  if (!marker.pairs.some((p) => p.ccrcId === session)) return refuseScope('headless-unlisted');\n"
ARM = "  if (!RECALL_ARMS.includes(arm)) return refuseScope('headless-arm-unknown');\n"
ASOF = "  if (!UUID_RE.test(asof ?? '')) return refuseScope('asof-invalid');\n"
M['H1'] = (D_ROW1, '')
M['H2'] = (PANE + NULLM + MARK, NULLM + MARK + PANE)
M['H3'] = (MARK + NOID, NOID + MARK)
M['H4'] = (NOID + BADID, BADID + NOID)
M['H5'] = (BADID + UNL, UNL + BADID)
M['H6'] = (UNL + ARM, ARM + UNL)
M['H7'] = (ARM + ASOF, ASOF + ARM)
M['H8'] = (NULLM, '')
M['H9'] = (PANE1, "  const inPane = paneSet === true ? refuseScope('headless-in-pane') : { ok: true };\n")
M['H10'] = (NOID, "  if (session === null) return refuseScope('no-identity');\n")
M['H11'] = (UNL, '')
M['H12'] = (ARM, "  if (!arm) return refuseScope('headless-arm-unknown');\n")
M['H13'] = (ASOF, "  if (!asof) return refuseScope('asof-invalid');\n")
M['H14'] = (MARK, "  if (!marker.ok) return refuseScope('headless-unarmed');\n")
M['H15'] = (PANE1, "  const inPane = decideSeamInPane({ pane: paneSet === true ? '' : null, recall });\n")
STORE = ("  const store = decideHeadlessStore({ list, storeId });\n"
         "  if (!store.ok) return store;\n")
STORE_RULE = "  if (list.storeId !== storeId) return refuseScope('headless-unlisted');\n"
ROW2 = ("  const n = rows[0];\n"
        "  if (n === undefined || n.uuid !== asof || n.boundary_entry_id === null) return refuseScope('asof-invalid');\n")
SIDE = "  if (n.agent_id !== '') return refuseScope('asof-invalid');\n"
CHAIN = "  if (r.into_session_pk === null || r.into_merged_into !== null) return null;\n"
ONE = "  if (new Set(fams.map((f) => f.pk)).size !== 1) return refuseScope('asof-invalid');\n"
IDF = "  if (fam.ccrcId !== session) return refuseScope('asof-invalid');\n"
PAIR = ("  if (!list.pairs.some((p) => p.ccrcId === session && p.generation === fam.generation)) "
        "return refuseScope('headless-unlisted');\n")
M['F1'] = (STORE + ROW2, ROW2 + STORE)
M['F2'] = ('n === undefined || n.uuid !== asof || ', 'n === undefined || ')
M['F3'] = (' || n.boundary_entry_id === null) return', ') return')
M['F4'] = (SIDE, '')
M['F5'] = (CHAIN, "  if (r.into_session_pk === null) return null;\n")
M['F6'] = (ONE, '')
M['F7'] = (IDF, '')
M['F8'] = (IDF + PAIR, PAIR + IDF)
M['F9'] = ('p.ccrcId === session && p.generation === fam.generation', 'p.ccrcId === session')
M['F10'] = ("{ ok: true, via: 'asof', generation:", "{ ok: true, via: 'registry', generation:")
M['F11'] = ('anchor: at.cwd_real ?? at.cwd }', 'anchor: at.cwd ?? at.cwd_real }')
M['F12'] = ('LEFT JOIN transcripts t ON t.transcript_pk = bd.transcript_pk', 'LEFT JOIN transcripts t ON t.transcript_pk = e.transcript_pk')
M['F13'] = (' AND ep.confirmed_ms IS NOT NULL', '')
M['F14'] = ('LEFT JOIN sessions m ON m.session_pk = s.merged_into', 'LEFT JOIN sessions m ON 0')
M['F15'] = ("via: 'asof', generation: fam.generation,",
            "via: 'asof', generation: resolveGeneration({ envGen: null, regGen: { state: 'value', value: fam.generation } }).value,")
M['F16'] = ('  if (r.merged_into === null) return', '  if (r.merged_into === null || true) return')
M['F17'] = (STORE_RULE, "  if (storeId !== null && list.storeId !== storeId) return refuseScope('headless-unlisted');\n")
M['F18'] = (STORE, '')
M['F19'] = (STORE, STORE_RULE)
M['R1'] = ("UUID_RE.test(envGen)) return { value: envGen, via: 'env' };", "UUID_RE.test(envGen.trim())) return { value: envGen, via: 'env' };")
PY
cat > .superpowers/sdd/history-w2-2b/t2/mut.sh <<'SH'
SCRATCH=.superpowers/sdd/history-w2-2b/t2
FILES="ccd/history/lib.mjs"
# mutn <name>: the named replacement from mutants.py, refused unless its old text occurs exactly once.
mutn() {
  python3 - "$1" <<'PYM'
import sys
sys.path.insert(0, '.superpowers/sdd/history-w2-2b/t2')
from mutants import M
old, new = M[sys.argv[1]]
p = 'ccd/history/lib.mjs'
s = open(p, encoding='utf-8').read()
c = s.count(old)
if c != 1:
    sys.exit(f'MUTANT NOT APPLIED: {sys.argv[1]} anchor occurs {c} times')
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PYM
}
# restore: lib.mjs back to its copy, checked with cmp. It also runs when the call exits, by a signal too.
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; cmp -s "$SCRATCH/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done; }
trap restore EXIT
trap 'exit 143' INT TERM HUP
LIB_T='W2-2b headless seam'
SH
cp ccd/history/lib.mjs .superpowers/sdd/history-w2-2b/t2/lib.mjs.orig
. .superpowers/sdd/history-w2-2b/t2/mut.sh
for m in H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 H11 H12 H13 H14 H15 F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 F13 F14 F15 F16 F17 F18 F19 R1; do
  mutn "$m" && restore
done
```

The last loop applies and restores every mutant once, with no test run, so an anchor that does not match once is found before any red is read. It must print nothing. A `MUTANT NOT APPLIED` line is a table entry to correct against the code as written, never a mutant to skip.

Then each mutant, ONE tool call each, in the foreground with a timeout of at least 600000 ms, in this form:

```bash
. .superpowers/sdd/history-w2-2b/t2/mut.sh
mutn H1 && (cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
```

The cases are numbered as in Step 2: (1) the decideHeadless staircase, (2) its adjacent pairs, (3) W2-D45, (4) the R1 scan, (5) the decideAsOfFamily staircase, (6) its adjacent pairs, (7) the real store, (8) the env-path scan. Expected RED, predicted, for each name:

| Mutant | What it does | Predicted red |
|---|---|---|
| H1 | row 1 (no seam → the tmux path) dropped | 3 failed: (1) the row-1 cases throw at their null marker; (3) the empty-values case reads the marker (`the marker was looked at`); (4) row 1's line is missing |
| H2 | the marker rows before the pane row | 3 failed: (1) the row-2 case throws at its null marker; (2) `2 before 3` answers `headless-unarmed`; (3) a pane with the seam set reads the marker |
| H3 | rows 3 and 4 swapped | 2 failed: (2) `3 before 4` answers `no-identity`; (3) `CONTROL: one row past the pane, the marker is looked at` answers `no-identity` without reading it |
| H4 | rows 4 and 5 swapped | 2 failed: (1) both row-4 cases answer `bad-id`; (2) `4 before 5` |
| H5 | rows 5 and 6 swapped | 2 failed: (1) the row-5 case answers `headless-unlisted`; (2) `5 before 6` |
| H6 | rows 6 and 7 swapped | 1 failed: (2) `6 before 7` answers `headless-arm-unknown` |
| H7 | rows 7 and 8 swapped | 1 failed: (2) `7 before 8` answers `asof-invalid` |
| H8 | the null-marker throw dropped | 1 failed: (3) the defect throws node's `Cannot read properties of null` instead of the named message |
| H9 | the pane rule spelled again | 2 failed: (3) `anything but false is a pane` reads the marker; (4) row 2's exact line and `no second spelling: /headless-in-pane/` |
| H10 | SESSION unset as `session === null` | 3 failed: (1) `4. SESSION empty is unset` answers `bad-id`; (2) `4 before 5`; (4) row 4's line is missing |
| H11 | row 6 (SESSION on a list line) dropped | 2 failed: (1) both row-6 cases are admitted; (2) `6 before 7` answers `headless-arm-unknown` |
| H12 | ARM checked for presence only | 1 failed: (1) `7. ARM outside RECALL_ARMS` and `7. ARM in another case` pass |
| H13 | ASOF checked for presence only | 1 failed: (1) `8. ASOF off the UUID grammar` and `8. ASOF in upper case` pass |
| H14 | the marker's refusal rewritten as `headless-unarmed` | 3 failed: (1) the two `headless-malformed` row-3 cases; (2) `3 before 4`; (4) row 3's exact line |
| H15 | `paneSet` read as set only when `true` | 2 failed: (3) `anything but false is a pane` reads the marker; (4) row 2's exact line |
| F1 | store line and row 2 swapped | 1 failed: (6) `1 before 2` answers `asof-invalid` |
| F2 | the rows' uuid not checked | 1 failed: (5) `2. the rows are another uuid's` is admitted |
| F3 | the boundaries row not required | 1 failed: (5) `2. the entry has no boundaries row` is admitted. (7)'s plain row stays refused at row 3, because the statement gives it no transcript |
| F4 | the sidechain row dropped | 2 failed: (5) both row-3 cases are admitted; (7) the sidechain boundary is admitted as G1 |
| F5 | the chain refusal dropped | 2 failed: (5) `4. the merged_into hop lands on a merged row` is admitted; (7) the chain is admitted as (w2b-chain, G5), which the marker lists |
| F6 | the one-family row dropped | 2 failed: (5) two families are admitted as the first, and no epoch throws; (7) the two-family transcript is admitted as G1, and the unconfirmed one throws |
| F7 | the id row dropped | 3 failed: (5) row 5 is admitted; (6) `5 before 6` answers `headless-unlisted`; (7) `another id's family` answers `headless-unlisted` |
| F8 | rows 5 and 6 swapped | 2 failed: (6) `5 before 6` answers `headless-unlisted`; (7) `another id's family` answers `headless-unlisted` |
| F9 | the pair checked by id alone | 2 failed: (5) row 6 is admitted as G2; (7) the purge-and-reuse CONTROL (G2's transcript) is admitted |
| F10 | `via` is not `'asof'` | 2 failed: (5) and (7), every admitted case |
| F11 | the anchor reads `cwd` before `cwd_real` | 2 failed: (5) `admitted: an exact key, and the anchor is cwd_real`; (7) purge and reuse, and D-6281 |
| F12 | the statement takes the entries row's transcript (D-6281) | 1 failed: (7) the D-6281 shape answers `asof-invalid` |
| F13 | the statement admits unconfirmed epochs | 1 failed: (7) `its one epoch is unconfirmed` is admitted as G1 |
| F14 | the statement follows no `merged_into` hop | 1 failed: (7) the merged `''` family answers `asof-invalid` (its hop lands on no row) |
| F15 | the env path reads a generation through `resolveGeneration` | 3 failed: (5) and (7), the legacy `''` reads `null` via `newest`; (8) the scan finds `resolveGeneration`, `regGen` and `envGen` in `decideAsOfFamily` |
| F16 | the decider ignores the hop | 2 failed: (5) the chain and the hop to no row answer `headless-unlisted` (their own `''` pair is not listed), and the two rows of one family become two families (`asof-invalid`); (7) the merged `''` family and the chain answer `headless-unlisted` |
| F17 | `decideHeadlessStore` passes a store whose meta holds no `store_id` | 1 failed: (5) `1. this store's meta holds no store_id` is admitted (and its direct row answers `{ ok: true }`) |
| F18 | `decideAsOfFamily` no longer calls `decideHeadlessStore` | 3 failed: (5) both row-1 cases are admitted; (6) `1 before 2` answers `asof-invalid`; (7) the foreign marker is admitted as G1 |
| F19 | the store-line rule spelled again inside `decideAsOfFamily` | 1 failed: (5) at `decideAsOfFamily's first row is decideHeadlessStore` (every answer is unchanged) |
| R1 | `resolveGeneration` edited | 1 failed: (8) the byte-for-byte pin; its CONTROL still passes |

Equivalent by construction, named and not run: swapping rows 1 and 2 (`decideSeamInPane` refuses only an engaged seam); swapping two of `decideAsOfFamily`'s rows 2 to 5 (one word). Each of those rows has its own drop mutant above.

After the last mutant, one more call:

```bash
. .superpowers/sdd/history-w2-2b/t2/mut.sh
cmp -s .superpowers/sdd/history-w2-2b/t2/lib.mjs.orig ccd/history/lib.mjs || echo "NOT RESTORED: ccd/history/lib.mjs"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
```

Expected: each mutant red as predicted, and no call printing `NOT RESTORED` or `MUTANT NOT APPLIED`. Then this last call's `cmp` prints nothing and its run prints `8 passed`. A mutant whose red differs from its prediction is recorded as measured and reported, never re-predicted. A mutant that stays green means its guard is unpinned: stop and report to the coordinator.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms, ONE tool call per line. A red file is re-run alone before it is called a break:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'O14, local half')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'DRIVER_REASONS is disjoint from lib REASONS')
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected green, each against Step 1's base count:
- `history-lib`: the base's count plus 8.
- `history-cli`: exactly the base's count. W2-2a's `decideSeamInPane` describes are unedited and still pass, because this task changed neither function and wired nothing.
- `single-definition -t 'ccrc history'`: green and unchanged. O13's holders stay `['ccd/history/lib.mjs']` (no new line names the marker path, and no write verb meets a switch symbol), the `process.env` allow-list is unchanged (no read added), O14's `VOCABS` is unchanged (no new constant), and Task 1's one-read and arm-word scans stay green (`decideHeadless` checks `RECALL_ARMS.includes(arm)`).
- `measure-history -t 'O14, local half'`: green; the gate declares none of the three new names (D-5774).
- `history-replay -t 'DRIVER_REASONS …'`: green; no word is added here.
- `citations`: green; no numeric line citation added (D-5893).
- `dtbd`: green.
- tsc: silent; `GenerationChoice`'s widened `via` breaks no typed caller.

Then the ledger check:

```bash
grep -rn 'D-TBD-[a-z0-9]' ccd/history server/test/history-lib.test.ts || echo 'no D-TBD token'
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: `no D-TBD token`; then green. D-5767 and D-5768 are cited in lib.mjs and defined once, in this plan; D-5765 and D-6281 are cited bare and defined in the W2-2a plan.

- [ ] **Step 8: Commit.**

First write the message, with a quoted heredoc so nothing in it is expanded:

```bash
cat > .superpowers/sdd/history-w2-2b/t2/commit-msg.txt <<'EOF'
feat(history): the headless seam's pure deciders, decideHeadless, decideHeadlessStore and decideAsOfFamily (W2-2b Task 2; W2-D40, W2-D45, W2-D46; D-5767, D-5768)

<each mutant's measured red line from Step 6, H1 to H15, F1 to F19 and R1, one line each, its mutant first>
<the passing counts of Steps 5 and 7>
<any re-anchoring Step 1 or Step 6 needed, or: no re-anchoring>

<the attribution line the session's reminder names>
EOF
```

Replace each `<…>` line with what it names, from the scratch notes. Then:

```bash
cmp -s .superpowers/sdd/history-w2-2b/t2/lib.mjs.orig ccd/history/lib.mjs || echo "NOT RESTORED: ccd/history/lib.mjs"
grep -c '^<' .superpowers/sdd/history-w2-2b/t2/commit-msg.txt
git add ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-lib.test.ts
git status --short
git commit -F .superpowers/sdd/history-w2-2b/t2/commit-msg.txt
git status --short
```

The `cmp` prints nothing: no mutant is left in the file the commit takes. A `NOT RESTORED` line stops the commit; report it. Then `0` (no placeholder left). `git status --short` must list exactly these three files before the commit, and nothing after it. Nothing under `.superpowers/` appears: it is gitignored.

---

### Task 3: the read verbs take the headless path in W2-D46's order, counted once step 4 admits the family (W2-D40, W2-D41, W2-D45, W2-D46, W2-D47)

Tasks 1 and 2 give lib the seam's vocabulary and its pure decisions (`RECALL_ARMS`, the marker's parser and fold, `decideHeadless`, `asOfFamilySql`, `decideAsOfFamily`, the two new exit-2 words). Nothing calls them yet. This task wires them into cli.mjs (R4: the env branch is this task's), so a read verb run with no pane and a seam value set takes the **headless path**, in W2-D46's order:

0. the Darwin and server-role rows (unchanged; readContextIn's first statement);
1. W2-2a's in-pane row (kept, R1), then the marker's one read and `decideHeadless` over it and the three values;
2. the harness, still `$REG/<id>.harness` (W2-D40's stated residual);
3. §8.3's store table after the 2 s stat, the read-only open, `decideStatusRead`;
4. the marker's store line (`decideHeadlessStore`, before any ASOF row is read, R3), then `decideAsOfFamily` over `asOfFamilySql`'s rows and the pair: **the family is admitted here**, and `seen.id`, `seen.gen` and `seen.arm` are set;
5. recall-off against the resolved generation: exit 8;
6. `ARM=control`: exit 8;
7. `decideScope` with source `env`, the W2-D41 guard, the families and transcripts, then the cut from ASOF through W2-2a's `asOfCutOf(rc, asof)`, set on `rc.scope.cut`, so every door W2-2a cut applies it; then the verb.

A counter line is written iff step 4 admitted the family (W2-D46, R5). Under `history-off` nothing is written (`countRecall`, unchanged). The line carries the arm from Task 4 on: this task sets `seen.arm` at the admission and Task 4 writes it (R4), so between the two commits an admitted env call is counted without its arm. On this path the CLI never reads `CCRC_SESSION_GENERATION`, `$REG/<id>.generation` or the id's newest family, and never spawns tmux (W2-D40, D-5767). `--session <own id>` reads the resolved generation, and `--workspace` anchors on the ASOF epoch's stored `cwd_real ?? cwd`, never on `$REG/<id>.workdir` (D-5767). With nothing set, the read path is today's, byte for byte (W2-D45). `status`, `doctor` and the operator verbs never reach `readContextIn`, so they ignore every `CCRC_RECALL_*`; this task pins that (W2-D47, C28 extended).

The task adds two small lib decisions of its own, because cli.mjs is L4 and must not decide: `decideEnvProject` (W2-D41's env-only guard, answering the existing W1 word `cross-project`, R7) and `decideHeadlessRead` (W2-D46 steps 5 and 6). It adds `'env'` to `SCOPE_SOURCES` (P1). It defines no departure and no new reason word. It cites D-5767 in the code comments that implement it, and D-5765 (W2-2a's, cited bare) where the store half's `asof-invalid` is answered at step 7.

**Order.** Task 3 needs Task 1's names and Task 2's deciders. It touches cli.mjs's read path only: the lib import, the recall.mjs import, the dispatcher's order comment, `readContext`'s `seen` literal, the W2-2a seam block in `readContextIn`, and a new `asOfRowsOf` and `readContextEnv` above `READ_RUNNERS`' doc comment. `refusal`, `readFailure`, `ReadDefect`, `readContext`'s answer and `readVerb` are Task 4's (R4); `main`'s dispatch is not edited (only mutant M25 touches it). Line numbers below were measured at `d119d6e90` and are hints only: Step 1 asserts each anchor occurs exactly once.

**Files:**
- Modify: `ccd/history/lib.mjs`:
  - in place, `export const SCOPE_SOURCES = Object.freeze(['tmux']);` (about :295) becomes `Object.freeze(['tmux', 'env'])` (P1);
  - `decideEnvProject` and `decideHeadlessRead`, with their doc comments, directly above the doc comment that begins `/** The shortest prefix of each id, its letter plus at least` (`displayPrefixes`', about :4341 at d119d6e90, right after `decideScope`). Both use the module-private `refuseScope`, `EXIT`, `SCOPE_SOURCES` and Task 1's `RECALL_ARMS`. No import changes; lib stays `node:crypto`-only.
- Modify: `ccd/history/lib.d.mts`: in place, `export const SCOPE_SOURCES: readonly ['tmux'];` (about :98) becomes `readonly ['tmux', 'env']`; two declarations directly after `export function decideScope(i: ScopeInputs): ScopeVerdict;` (about :539).
- Modify: `ccd/history/cli.mjs`:
  - the read verbs' lib import: two lines inserted after `  decideRecallOff, parseSpoolLine,` (about :60);
  - the recall.mjs import line (about :64) gains `asOfCutOf`;
  - the dispatcher's order comment: a paragraph inserted after `//        tick recorded, read now) for output redaction (§8.3 layers 1 and 4).` (about :467);
  - `readContext`'s `const seen = { id: null, gen: null };` (about :676) becomes `{ id: null, gen: null, arm: null }`;
  - in `readContextIn`, W2-2a's seam block (about :691-703) names the three values once as `recall` (still one read each) and keeps its refusal line as it is; one line after it sends an engaged seam to `readContextEnv`;
  - `asOfRowsOf` and `readContextEnv`, new, directly above the doc comment that begins `/** The recall.mjs runner each read verb calls.` (about :800).
- Test: `server/test/history-cli.test.ts`:
  - **in place**, W2-2a Task 5's case (b), whose title begins `CONTROL, no pane: the seam variables change nothing` (about :1563-1575): W2-D46 changes that answer by design, so its expected word and title change (R8); 13 lines become 20;
  - three describes appended at the end of the file (after about :1606): a pure one (3 cases, runs on darwin too; the third reads cli.mjs's text), a spawned one (10 cases, skipped on darwin) and a spawned box-verb one (1 case, skipped on darwin). No import line is added: lib, recall.mjs and `historyFixtures.js` are reached through dynamic `import()`, and the helpers through the file's `healthHh` namespace (W2-2a Task 5's precedent).
- Not edited: the spec, `README.md` (Task 5's), `deploy/**`, `shared/**`, `ccd/history/recall.mjs` (`asOfCutOf`, `familiesOf`, `transcriptsOf` and `visibleScope` are consumed as they are), `sweep.mjs`, `store.mjs`, `derive.mjs`, `regex-worker.mjs`, `ccd/history-skill/SKILL.md` (W2-D48), `ccd/session-hook.sh`, `ccd/ccd`, `.github/**`, `lifecycle.test.ts`, `single-definition.test.ts` (its allow-list must stay exactly W2-2a's seven names: this task reads no new env name), `history-recall.test.ts`.

**Interfaces:**
- Consumes, merged at the base:
  - W2-2a: lib `recallSeamEngaged` and `decideSeamInPane`; recall.mjs `asOfCutOf(rc, asof)`, which reads `rc.db` only and answers `{ ok: true, cut }` or `{ ok: false, rc: 2, reason: 'asof-invalid' }` (D-5765's store half, D-6281's transcript key); `visibleScope`, through which the header, the `--json` scope and tree's family headings count and name only what the cut leaves visible (W2-2a R5, R8). `rc.scope.cut` absent or `null` means no cut.
  - W1 and W2-1, unchanged: lib `decideScope(i)` (its verdict `{ ok: true, kind, source, id, generation, project, workdir }`; `generation` is `i.generation.value` for the own id, null for another id under `--session`), `decideHarness`, `decideRecallOff({ file, generation }): 'off' | 'stale' | 'none'`, `decideCliStore`, `decideStatusRead`, `idOk`, `EXIT`, `REASONS`; sweep.mjs `recallOffPresence(home, id)`; recall.mjs `familiesOf(db, { kind, id, generation, project, workdir, workdirReal })` (an exact `(id, generation)` key when `generation` is a string, `''` included; the newest family when null) and `transcriptsOf`; store.mjs `readBounded` (already imported by cli.mjs); cli.mjs's module-private `regPresence`, `ABSENT`, `refusal(exit, reason, storeId, id, gen)`, `readFailure`, `refusalStoreId`, `measureReach`, `cliFactsOf`, `pairIndexOf`, `scopeArgsOf`, `countRecall`.
  - From Tasks 1 and 2 (Step 0 probes each and stops on any difference): `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES`, `headlessMarkerOf(read)`, the two words; `decideHeadless({ recall, paneSet, marker })` → `{ ok: true, path: 'tmux' }`, `{ ok: true, path: 'headless', session, arm, asof, list: { storeId, pairs } }` or a step-1 refusal (R1); `decideHeadlessStore({ list, storeId })` → `{ ok: true }` or `ScopeRefusal<'headless-unlisted'>` (R3); `asOfFamilySql()`; `decideAsOfFamily({ session, asof, rows, list, storeId })` → `{ ok: true, via: 'asof', generation, family: { ccrcId, project }, anchor }` or `ScopeRefusal<'headless-unlisted' | 'asof-invalid'>` (R3).
- Produces:
  - lib.mjs: `SCOPE_SOURCES` deep-equal to `['tmux', 'env']`;
  - lib.mjs: `export function decideEnvProject({ verdict, storedProject }): { ok: true } | { ok: false, rc: 2, reason: 'cross-project' }`, refusing iff `verdict.source === SCOPE_SOURCES[1]` (env) **and** `verdict.project !== null` **and** `verdict.project !== storedProject` (R7);
  - lib.mjs: `export function decideHeadlessRead({ recallOff, arm }): { ok: true } | { ok: false, rc: 8, why: 'recall-off' | 'arm' }`: `recallOff === 'off'` answers `why: 'recall-off'` first (step 5); then any `arm` other than `RECALL_ARMS[1]` answers `why: 'arm'` (step 6, fail closed);
  - lib.d.mts: one declaration each, after `decideScope`'s;
  - cli.mjs (module-private, no export changes): `asOfRowsOf(db, asof)`, lib's `asOfFamilySql()` run on the admitted handle once `decideHeadlessStore` passed; `readContextEnv(home, P, parsed, nowMs, seen, recall, pane)`, steps 1 to 7, which throws a `TypeError` if `decideHeadless` answers the tmux path, whose refusals before the admission, step 4's own included, name no id (`refusal(…, null, null)`), whose admission sets `seen.id = id`, `seen.gen = gen` and `seen.arm = head.arm`, and whose context carries `scope.cut`; `readContext`'s `seen` starts as `{ id: null, gen: null, arm: null }`.

**Choices this task makes:**
- **Call, don't fold (R1).** W2-2a's `decideSeamInPane` keeps its place right after row 0 and before any tmux spawn, and its refusal line is unchanged; its three reads move into one `recall` object, still one read each. `recallSeamEngaged(recall)` then selects the headless path, so the marker is read only there, and with nothing set nothing new is read (W2-D45). `decideHeadless` re-runs the pane row on `paneSet: pane !== null`, which on this path is always false.
- **The marker's read is R1's one line**, `const marker = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));`. It takes a path argument through store.mjs's reader, so O13's symbolic write scan stays green, the `headless-on` holders stay `['ccd/history/lib.mjs']`, and Task 1's one-read pin holds it.
- **Nothing is counted before the admission.** Every refusal of steps 1 to 4 is `refusal(..., null, null)`, a failed open or read before the admission is `readFailure(..., null, null)`, `seen.id` stays null until admission, and a throw before it is a plain defect with no counter line (Task 4's ladder pins each, its mutants C1 to C5). From step 4 on, every answer names the id and the resolved generation, and `seen` carries them and the arm, so even a defect is counted (D-5023's rule, extended).
- **`storeId` for admission is the meta row's alone**, `null` when the meta holds none (W2-D44): never `refusalStoreId`'s binding-file fallback, which the refusals still print.
- **The store line before the ASOF rows** (R3). `decideHeadlessStore` runs before `asOfRowsOf`, so a marker naming another store causes no ASOF query and no fault in that query can pre-empt `headless-unlisted`. "seam ladder" plants a fault on the statement's text under a foreign marker and still reads `headless-unlisted`, with this store's line as its CONTROL (mutant M30).
- **Fail closed on a tmux answer.** `readContextEnv` is reached only when `recallSeamEngaged` holds, so `decideHeadless` cannot answer the tmux path there. If it ever did, the next line throws a `TypeError`, an uncounted defect (`seen.id` is still null), rather than reading on with no session. "seam source" pins the line (M33).
- **Steps 5 and 6 are one lib decision.** Both answer exit 8 and both are counted, so the CLI cannot tell them apart; their order is pinned in lib (mutant M22) and named equivalent at the CLI.
- **`decideScope` on env gets** `source: SCOPE_SOURCES[1]`, the resolved generation as `{ value, via: 'asof' }` (a `GenerationChoice` since Task 2), the registry's project for `SESSION` (§8.2's `--project`, and what the W2-D41 guard compares), a workdir presence built from `decideAsOfFamily`'s `anchor` (ABSENT when null, so `--workspace` answers `workspace-unreadable`, never a wider scope), and the other id's registry project under `--session <other>`.
- **The families are read with `verdict.generation` as is**: the resolved generation, an exact key, for the own id (default scope and `--session <own id>`); null, the other id's newest family, for another id (W2-D40's residual). The workspace anchor is passed as both `workdir` and `workdirReal`: it is already the stored realpath (or the verbatim `cwd` when none was stored), so nothing is resolved at read time.
- **The W2-D41 guard applies to every scope kind** whose verdict carries a registry project, the default family scope included (R7): a reused id whose registry now names another project refuses on env (fail closed). A verdict with no project used none and passes.
- **The cut is computed last** (W2-D46 step 7: scope, the guard, the cut, the verb), through `asOfCutOf({ db }, asof)`. Its `asof-invalid` (D-5765's store half) therefore comes after admission and is counted (R5a: D-5765's store half is step 7's; step 4's own `asof-invalid` is `decideAsOfFamily`'s, uncounted by R5).
- **`rc.scope` is not narrowed.** A family with no visible epoch is dropped from the scope's count and names by W2-2a's `visibleScope` and from every read by the cut in SQL (W2-2a's R5).

**Residuals, named:**
- The harness is still read from `$REG/<id>.harness`, so a reused id whose new life has another harness refuses (W2-D40, fail closed).
- `--session <other>` reads the other id's newest family, then the cut: a reused other id answers 3 (W2-D40).
- A legacy `''` family's counter line carries no `gen` (decisions section 7); from Task 4 it carries `arm`, and the gate excludes it by `arm IS NOT NULL`.
- An epoch whose `cwd_real` was NULL at ingest is matched under `--workspace` by its verbatim `cwd` only, as on the tmux path.
- Steps 5 and 6 are indistinguishable at the CLI (both exit 8, both counted); their order is lib's (M22).
- `seen.arm` is read by nothing at this task's commit; Task 4's mutant A7 is its red.

**Security doors this task owns.** The headless path is the one door through which a session could read another family's past, one `env -u TMUX_PANE` away. Each refusal of steps 0 to 4 is pinned at its own step, with the step after it as its CONTROL ("seam ladder"); each answers before the store opens (steps 0 to 2: `store_id` null) or before admission (steps 3 and 4: nothing counted), and none spawns tmux. The family is never taken from the environment's or the registry's generation ("seam reuse", "seam legacy"). The cut always rides on `rc.scope.cut` ("seam cut", with the tmux path reading the same family with no cut as its CONTROL). A widened scope never names or reads a family the cut hides, and never reaches another project ("seam widened", "seam workspace", "seam C50"). The marker is never read through a link, a FIFO or past its cap ("seam marker read"), and it is read on one line, inside `readContextEnv`, which `readContextIn` calls on one line after its in-pane refusal ("seam source"). The box verbs never read the seam ("seam box verbs").

**The spec pins this task carries** (spec §8.9; each read in the spec at d119d6e90):
- **C4** (complete): "no pane → exit 2 `no-identity`; the seam half, the seam variables inside a pane → exit 2 `headless-in-pane`". With no seam and no pane, `no-identity` (edited case (b)'s CONTROL; history-recall's C4 case re-run); in a pane, W2-2a's case (a), re-run.
- **C16** (its two words): "seam ladder" reaches `headless-malformed` and `headless-arm-unknown` through the CLI, exit 2 each.
- **C24 under env**: "a read-verb call → one fenced `ev:"recall"` spool line with `cmd`, `rc` and `ms`, and no query text, drained to one `recall_calls` row; under `history-off` → none". "seam C24" runs it under env with the resolved `gen`; Task 4 adds the arm and its key set.
- **C28** (extended by W2-D47): "`status --json` with no `TMUX_PANE` → exit 0", now also with `SESSION` and `ARM` set, and no line written ("seam box verbs").
- **C30**: "no `headless-on` → exit 2 `headless-unarmed`; armed for a list that omits the family → exit 2 `headless-unlisted`; armed and listed + `recall-off/<id>` naming the resolved generation → exit 8; armed and listed + `ARM=control` → exit 8". All four rows are in "seam ladder".
- **C48** stays tmux-only: "seam reuse"'s CONTROL reads (X, G2) on the tmux path while the env path ignores the registry; history-recall's C48 case is re-run.
- **C50**: "`decideScope` called with source `env` or `tmux` → the same verdicts as the CLI; an unknown source → refused, not defaulted". "seam C50" compares the CLI's answer on the env path, flag set by flag, with `decideScope` called in process with source `env`; history-lib's C50 case runs its table under both members.

- [ ] **Step 0: Check the base, and probe the contract with Tasks 1 and 2.** From the repository root, before any edit:

```bash
git fetch origin main
W2A=$(git log --format=%H -1 -E --grep='[(]#1126[)]$' origin/main)
test -n "$W2A" && git merge-base --is-ancestor "$W2A" HEAD && echo 'base holds W2-2a' || echo 'STOP: W2-2a (#1126) is not on this base'
git log --oneline -3
node --no-warnings --input-type=module -e "
const L = await import('./ccd/history/lib.mjs');
const asof = '0189abcd-1234-4678-9abc-00000000e2fd';
const sid = '0189abcd-1234-4678-9abc-00000000e2fe';
const recall = { session: 'acct-a-probe', arm: L.RECALL_ARMS[1], asof };
console.log(JSON.stringify([L.RECALL_ARMS, L.HEADLESS_LIST_MAX_BYTES, L.SCOPE_SOURCES, L.REASONS['headless-malformed'], L.REASONS['headless-arm-unknown']]));
console.log(JSON.stringify(L.decideHeadless({ recall, paneSet: false, marker: L.headlessMarkerOf({ state: 'absent' }) })));
const ok = L.decideHeadless({ recall, paneSet: false, marker: L.headlessMarkerOf({ state: 'value', value: 'store ' + sid + '\nacct-a-probe -\n' }) });
console.log(JSON.stringify([ok.ok, ok.path, ok.session, ok.arm, ok.asof, ok.list && ok.list.storeId]));
console.log(JSON.stringify([L.decideHeadlessStore({ list: ok.list, storeId: sid }), L.decideHeadlessStore({ list: ok.list, storeId: null })]));
console.log(JSON.stringify(L.decideAsOfFamily({ session: 'acct-a-probe', asof, rows: [], list: ok.list, storeId: sid })));
console.log(typeof L.asOfFamilySql(), typeof L.decideEnvProject, typeof L.decideHeadlessRead);
"
```

Expected, line by line:
- `base holds W2-2a`: W2-2a's squash commit on `main`, found by its subject's `(#1126)` as Task 6 Step 0 finds it (the merge queue squashes, so W2-2a's branch tip `d119d6e90` is never an ancestor), is on this branch; and Tasks 1 and 2 of this plan are the two commits on top of the base (the third line of the log is the base's);
- `[["control","treatment"],65536,["tmux"],2,2]`;
- `{"ok":false,"rc":2,"reason":"headless-unarmed"}`;
- `[true,"headless","acct-a-probe","treatment","0189abcd-1234-4678-9abc-00000000e2fd","0189abcd-1234-4678-9abc-00000000e2fe"]`;
- `[{"ok":true},{"ok":false,"rc":2,"reason":"headless-unlisted"}]` (this store's line passes; a store with no meta `store_id` is never the marker's);
- `{"ok":false,"rc":2,"reason":"asof-invalid"}`;
- `string undefined undefined` (this task's names are free).

On `STOP` or any other output, make no edit and report to the coordinator.

- [ ] **Step 1: Confirm the anchors, that no name is taken, and the base counts.** From the repository root:

```bash
for a in \
  '  decideRecallOff, parseSpoolLine,' \
  "import { runTree, grepVerb, describeVerb, expandVerb, familiesOf, transcriptsOf, scopeHeader, scopeJsonOf } from './recall.mjs';" \
  '//        tick recorded, read now) for output redaction (§8.3 layers 1 and 4).' \
  '  const seen = { id: null, gen: null };' \
  '  const inPane = decideSeamInPane({' \
  '  if (!inPane.ok) return refusal(inPane.rc, inPane.reason, null, null, null);' \
  '/** The recall.mjs runner each read verb calls.' \
  ; do printf '%s  cli.mjs: %s\n' "$(grep -cF -- "$a" ccd/history/cli.mjs)" "$a"; done
grep -cF '/** The shortest prefix of each id, its letter plus at least' ccd/history/lib.mjs
grep -cxF "export const SCOPE_SOURCES = Object.freeze(['tmux']);" ccd/history/lib.mjs
grep -cxF "export const SCOPE_SOURCES: readonly ['tmux'];" ccd/history/lib.d.mts
grep -cF 'export function decideScope(i: ScopeInputs): ScopeVerdict;' ccd/history/lib.d.mts
grep -cF "  it('CONTROL, no pane: the seam variables change nothing, and every read verb still answers 2 no-identity with no tmux call (C4, no-pane half)', async () => {" server/test/history-cli.test.ts
grep -c 'readContextEnv\|asOfRowsOf\|decideEnvProject\|decideHeadlessRead\|seam ladder' ccd/history/*.mjs ccd/history/lib.d.mts server/test/history-cli.test.ts
grep -n 'asOfCutOf\|headlessOn' ccd/history/cli.mjs
```

Expected: `1` on every line of the loop and for the five greps after it; `0` for every file of the names grep; no output for the last line. A count other than 1 means the line moved: re-read the region, re-anchor on the line that now holds the same code, and record the substitution for the commit body. A non-zero name count stops the task: report it.

Then record the base counts, one command per tool call, each in the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the read verbs: identity|the read verbs: --session|HA2: --json carries the hint')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'process.env is read by name|seam names are each read once|operator switches have readers only|writes a switch through its symbolic spelling|the headless marker and the arm words')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'C50: every SCOPE_SOURCES member')
```

Write each `N passed` (and any `skipped`) into `.superpowers/sdd/history-w2-2b/t3/base-counts.txt` (gitignored), creating the directory first with `mkdir -p .superpowers/sdd/history-w2-2b/t3` (Step 7's helpers reuse it). Every file must be green; a red file is re-run alone (CLAUDE.md's load flakes) before it is reported.

- [ ] **Step 2: Write the failing tests.** One in-place edit, then three appends after the file's last line, never above an existing describe.

(a) `server/test/history-cli.test.ts`, in place: replace W2-2a Task 5's case (b), these 13 lines:

```ts
  it('CONTROL, no pane: the seam variables change nothing, and every read verb still answers 2 no-identity with no tmux call (C4, no-pane half)', async () => {
    const box = await seededBox();
    healthHh.withPane(box, ID);   // a working tmux IS on PATH; the env below carries no TMUX_PANE
    fs.rmSync(calls(box), { force: true });
    for (const [label, seam] of SEAM) {
      for (const argv of VERBS) {
        const r = healthHh.runCli(box, [...argv], { env: seam });
        expect(ans(r), `${label}, ${argv.join(' ')}: ${r.stderr}${r.stdout}`).toEqual([2, 'no-identity']);
        expect(r.stdout, label).not.toContain(WORD);
      }
    }
    expect(fs.existsSync(calls(box))).toBe(false);
  }, 240_000);
```

with these 20:

```ts
  // W2-2b Task 3 changed this case in place: with no pane a seam value now takes the headless path (W2-D46 step 1),
  // which on this box, with no marker, answers headless-unarmed; with nothing set the answer is still no-identity.
  it('no pane: a seam variable takes the headless path, which on a box with no marker answers 2 headless-unarmed for every read verb, with no tmux call and no counter line; CONTROL: with none set, no-identity (C4 complete, C30)', async () => {
    const box = await seededBox();
    healthHh.withPane(box, ID);   // a working tmux IS on PATH; the env below carries no TMUX_PANE
    fs.rmSync(calls(box), { force: true });
    const counted = spool(box);
    for (const [label, seam] of SEAM) {
      for (const argv of VERBS) {
        const r = healthHh.runCli(box, [...argv], { env: seam });
        expect(ans(r), `${label}, ${argv.join(' ')}: ${r.stderr}${r.stdout}`).toEqual([2, 'headless-unarmed']);
        expect(r.stdout, label).not.toContain(WORD);
      }
    }
    for (const argv of VERBS) {
      expect(ans(healthHh.runCli(box, [...argv])), `CONTROL, nothing set, ${argv.join(' ')}`).toEqual([2, 'no-identity']);
    }
    expect(fs.existsSync(calls(box)), 'no tmux spawn').toBe(false);
    expect(spool(box), 'no counter line: nothing was admitted').toBe(counted);
  }, 240_000);
```

(b) `server/test/history-cli.test.ts`: append after the file's last line:

```ts

// ── W2-2b Task 3 (W2-D41, W2-D46): the headless path's own two decisions, pure ─────────────────────────────────────
describe('W2-2b Task 3: the env path\'s own decisions and its source shape (R1; W2-D40, W2-D41, W2-D46)', () => {
  type Lib = {
    decideEnvProject(i: { verdict: Record<string, unknown>; storedProject: string }): unknown;
    decideHeadlessRead(i: { recallOff: string; arm: string }): unknown;
    SCOPE_SOURCES: readonly string[]; RECALL_ARMS: readonly string[]; EXIT: Record<string, number>;
  };
  const lib = async (): Promise<Lib> => (await import('../../ccd/history/lib.mjs')) as unknown as Lib;
  const verdict = (o: Record<string, unknown>): Record<string, unknown> =>
    ({ ok: true, kind: 'family', source: 'env', id: 'acct-a-seamx', generation: null, project: 'demo', workdir: null, ...o });
  const CROSS = { ok: false, rc: 2, reason: 'cross-project' };

  it('seam pure decideEnvProject: on env the registry project decideScope used must be the stored one, else 2 cross-project; a verdict with no project, and a tmux verdict, pass', async () => {
    const L = await lib();
    expect(L.SCOPE_SOURCES, 'W2-D41: the env source').toEqual(['tmux', 'env']);
    expect(L.decideEnvProject({ verdict: verdict({}), storedProject: 'demo' })).toEqual({ ok: true });
    for (const kind of ['family', 'project', 'workspace']) {
      expect(L.decideEnvProject({ verdict: verdict({ kind }), storedProject: 'other' }), kind).toEqual(CROSS);
    }
    expect(L.decideEnvProject({ verdict: verdict({ project: null }), storedProject: 'demo' }), 'no project used: nothing to compare').toEqual({ ok: true });
    expect(L.decideEnvProject({ verdict: verdict({ source: 'tmux' }), storedProject: 'other' }), 'CONTROL: the guard is the env path alone').toEqual({ ok: true });
  });

  it('seam pure decideHeadlessRead: recall-off naming the resolved generation is exit 8 first, then ARM=control is exit 8; the treatment arm reads, and any other arm withholds', async () => {
    const L = await lib();
    const [CONTROL_ARM, TREATMENT] = [L.RECALL_ARMS[0]!, L.RECALL_ARMS[1]!];
    expect(L.EXIT['RECALL_OFF']).toBe(8);
    expect(L.decideHeadlessRead({ recallOff: 'off', arm: TREATMENT })).toEqual({ ok: false, rc: 8, why: 'recall-off' });
    expect(L.decideHeadlessRead({ recallOff: 'off', arm: CONTROL_ARM }), 'step 5 comes before step 6').toEqual({ ok: false, rc: 8, why: 'recall-off' });
    expect(L.decideHeadlessRead({ recallOff: 'none', arm: CONTROL_ARM })).toEqual({ ok: false, rc: 8, why: 'arm' });
    expect(L.decideHeadlessRead({ recallOff: 'stale', arm: CONTROL_ARM })).toEqual({ ok: false, rc: 8, why: 'arm' });
    expect(L.decideHeadlessRead({ recallOff: 'none', arm: TREATMENT })).toEqual({ ok: true });
    expect(L.decideHeadlessRead({ recallOff: 'stale', arm: TREATMENT }), 'CONTROL: a stale file is no switch').toEqual({ ok: true });
    expect(L.decideHeadlessRead({ recallOff: 'none', arm: 'placebo' }), 'fail closed').toEqual({ ok: false, rc: 8, why: 'arm' });
  });

  // R1 and W2-D40 at the source: no answer moves when the read is hoisted, repeated or moved past the dispatch, so
  // the pin reads cli.mjs. It reads the text only: no in-process test imports cli.mjs.
  it('seam source: R1, the marker is read on one ccd/history code line, inside readContextEnv, which readContextIn calls on one line after its in-pane refusal; readContextEnv reads no generation chain (W2-D40) and fails closed on a tmux answer', () => {
    const dir = path.join(REPO, 'ccd', 'history');
    const code = (l: string): boolean => !/^\s*(\/\/|\/?\*)/.test(l);
    const READ = /\breadBounded\([^,]*\.headlessOn, (?:[A-Za-z_$][\w$]*\.)?HEADLESS_LIST_MAX_BYTES, false\)/;
    const reads = fs.readdirSync(dir).filter((n) => n.endsWith('.mjs')).sort()
      .flatMap((n) => fs.readFileSync(path.join(dir, n), 'utf8').split('\n').filter((l) => code(l) && READ.test(l)).map((l) => `${n}:${l}`));
    expect(reads, 'R1: one read, in cli.mjs, of R1\'s exact line')
      .toEqual(['cli.mjs:  const marker = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));']);
    const cli = fs.readFileSync(path.join(dir, 'cli.mjs'), 'utf8').split('\n');
    /** A function's lines in cli.mjs: its first line through the next line that is exactly `}`. */
    const body = (head: string): string[] => {
      const at = cli.findIndex((l) => l.startsWith(head));
      expect(at, `${head} is found`).toBeGreaterThan(-1);
      return cli.slice(at, cli.indexOf('}', at) + 1);
    };
    const env = body('async function readContextEnv(');
    const inn = body('async function readContextIn(');
    expect(env.filter((l) => READ.test(l)), 'the one read is readContextEnv\'s').toHaveLength(1);
    const DISPATCH = '  if (recallSeamEngaged(recall)) return readContextEnv(home, P, parsed, nowMs, seen, recall, pane);';
    expect(cli.filter((l) => code(l) && /\breadContextEnv\(/.test(l) && !l.startsWith('async function readContextEnv(')),
      'readContextEnv is called on one line, readContextIn\'s dispatch').toEqual([DISPATCH]);
    const refusalAt = inn.indexOf('  if (!inPane.ok) return refusal(inPane.rc, inPane.reason, null, null, null);');
    expect(refusalAt, 'CONTROL: W2-2a\'s in-pane refusal is readContextIn\'s').toBeGreaterThan(-1);
    expect(inn.indexOf(DISPATCH), 'the dispatch comes after the in-pane refusal').toBeGreaterThan(refusalAt);
    const envCode = env.filter(code).join('\n');
    for (const chain of [/resolveGeneration/, /CCRC_SESSION_GENERATION/, /process\.env/, /'generation'\)/]) {
      expect(envCode, `W2-D40: readContextEnv reads no generation chain: ${String(chain)}`).not.toMatch(chain);
    }
    expect(inn.filter(code).join('\n'), 'CONTROL: readContextIn\'s tmux path reads it').toMatch(/resolveGeneration/);
    expect(env, 'fail closed: a tmux answer is a defect, never read on as the headless path')
      .toContain("  if (head.path !== 'headless') throw new TypeError('readContextEnv: decideHeadless answered the tmux path');");
  });
});

// ── W2-2b Task 3 (W2-D40, W2-D41, W2-D45, W2-D46; D-5767): the headless path, spawned ─────────────────────────────
// One box, captured once, holds:
//   - (X, GX1): boundary N at ts(4) keeps one row; a row after it (ts 6) the cut hides; its epoch ran in ws-link, a link
//     to ws-real (cwd_real), both removed after seeding, so the stored anchor no longer resolves on the box;
//   - (X, GX2): X purged and reused, rows only after T_N; $REG/X.generation says GX2; $REG/X.workdir names another dir;
//   - OF (demo, epoch in ws-real, rows before T_N) and OL (demo, another cwd, rows after T_N);
//   - LEG: a legacy '' family re-keyed into (LEG, GLM) (DM18b's merge); LEG2: an unmerged '' family and a newer
//     (LEG2, GL9); NT: a family whose first row is a boundary with no stamp (the store half refuses it);
//   - XP: a registry project 'other', no family.
// The marker lists (X, GX1), (LEG, GLM), (LEG2, ''), (NT, GNT).
describe('W2-2b Task 3: the headless path, wired in the W2-D46 order (C4, C16, C24, C30, C50; W2-D40, W2-D41, W2-D45, W2-D46; D-5767)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const X = 'acct-a-seamx';
  const OF = 'acct-a-seamof';
  const OL = 'acct-a-seamol';
  const XP = 'acct-b-seamxp';
  const LEG = 'acct-a-seamleg';
  const LEG2 = 'acct-a-seamlg2';
  const NT = 'acct-a-seamnt';
  const GX1 = '0189abcd-1234-4678-9abc-00000000e201';
  const GX2 = '0189abcd-1234-4678-9abc-00000000e202';
  const GOF = '0189abcd-1234-4678-9abc-00000000e203';
  const GOL = '0189abcd-1234-4678-9abc-00000000e204';
  const GLM = '0189abcd-1234-4678-9abc-00000000e205';
  const GL9 = '0189abcd-1234-4678-9abc-00000000e206';
  const GNT = '0189abcd-1234-4678-9abc-00000000e207';
  const OTHER_STORE = '0189abcd-1234-4678-9abc-00000000e2ff';
  const TX1 = 'e2b30001';
  const TX2 = 'e2b30002';
  const TOF = 'e2b30003';
  const TOL = 'e2b30004';
  const TLEG = 'e2b30005';
  const TLG2 = 'e2b30006';
  const TLG9 = 'e2b30007';
  const TNT = 'e2b30008';
  const u = (tag: string, i: number): string => `${tag}-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const ts = (i: number): string => new Date(Date.UTC(2026, 9, 1, 10, 0, i)).toISOString();
  const N = u(TX1, 4);
  const NL = u(TLEG, 4);
  const NL2 = u(TLG2, 4);
  const NB = u(TNT, 1);
  const NB2 = u(TNT, 4);
  type Fx = typeof import('./historyFixtures.js');
  type Run = ReturnType<typeof healthHh.runCli>;
  interface EnvFx { box: HistoryBox; marker: string; realRp: string; list: string; sid: string; control: string; treatment: string }
  const ans = (r: Run): unknown[] => [r.code, r.json?.['reason']];
  const PANE_ENV: Record<string, string> = { TMUX_PANE: healthHh.PANE };
  const markerText = (storeId: string, pairs: ReadonlyArray<readonly [string, string]>): string =>
    `store ${storeId}\n${pairs.map(([id, g]) => `${id} ${g === '' ? '-' : g}\n`).join('')}`;
  /** A boundary N at ts(4) keeping row 3, its summary at ts(5), rows 1 to 3 before it and row 6 after it. */
  const leafRows = (fx: Fx, tag: string, cwd: string, word: string): object[] => {
    const b = { sessionId: u(tag, 0), cwd };
    return [
      fx.userRow({ ...b, uuid: u(tag, 1), ts: ts(1), text: `${word}pre the question` }),
      fx.assistantRow({ ...b, uuid: u(tag, 2), ts: ts(2), parentUuid: u(tag, 1), text: `${word}pre the answer`, requestId: `req_${tag}_2`, msgId: `msg_${tag}_2` }),
      fx.userRow({ ...b, uuid: u(tag, 3), ts: ts(3), parentUuid: u(tag, 2), text: `${word}pre kept by the boundary` }),
      fx.boundaryRow({ ...b, uuid: u(tag, 4), ts: ts(4), parentUuid: u(tag, 3), trigger: 'manual', headUuid: u(tag, 3), anchorUuid: u(tag, 5), tailUuid: u(tag, 3), allUuids: [u(tag, 3)] }),
      fx.summaryRow({ ...b, uuid: u(tag, 5), ts: ts(5), parentUuid: u(tag, 4), text: `<summary>\n1. Primary Request and Intent:\n   ${word} intent\n</summary>` }),
      fx.userRow({ ...b, uuid: u(tag, 6), ts: ts(6), parentUuid: u(tag, 5), text: `${word}post after the boundary` }),
    ];
  };
  const plainRows = (fx: Fx, tag: string, cwd: string, at: number, word: string): object[] => [
    fx.userRow({ sessionId: u(tag, 0), cwd, uuid: u(tag, 1), ts: ts(at), text: `${word} the question` }),
    fx.assistantRow({ sessionId: u(tag, 0), cwd, uuid: u(tag, 2), ts: ts(at + 1), parentUuid: u(tag, 1), text: `${word} the answer`, requestId: `req_${tag}_2`, msgId: `msg_${tag}_2` }),
  ];
  /** NB is the transcript's first row, a boundary with no stamp, so asOfCut finds no stamp at or before it; NB2 is stamped. */
  const ntRows = (fx: Fx): object[] => {
    const b = { sessionId: u(TNT, 0), cwd: '/home/u/tree/legacy' };
    const first = { ...fx.boundaryRow({ ...b, uuid: NB, ts: ts(1), trigger: 'manual', headUuid: u(TNT, 9), anchorUuid: u(TNT, 2), tailUuid: u(TNT, 9), allUuids: [] }) } as Record<string, unknown>;
    delete first['timestamp'];
    return [
      first,
      fx.summaryRow({ ...b, uuid: u(TNT, 2), ts: ts(2), parentUuid: NB, text: '<summary>\n1. Primary Request and Intent:\n   zqseamnt intent\n</summary>' }),
      fx.userRow({ ...b, uuid: u(TNT, 3), ts: ts(3), parentUuid: u(TNT, 2), text: 'zqseamntpre before the second boundary' }),
      fx.boundaryRow({ ...b, uuid: NB2, ts: ts(4), parentUuid: u(TNT, 3), trigger: 'manual', headUuid: u(TNT, 3), anchorUuid: u(TNT, 5), tailUuid: u(TNT, 3), allUuids: [u(TNT, 3)] }),
      fx.summaryRow({ ...b, uuid: u(TNT, 5), ts: ts(5), parentUuid: NB2, text: '<summary>\n1. Primary Request and Intent:\n   zqseamnttwo intent\n</summary>' }),
    ];
  };
  let built: EnvFx | null = null;
  /** The box, captured once for the describe (the seededBox precedent above): every case may run alone under -t. */
  async function envFx(): Promise<EnvFx> {
    if (built !== null) return built;
    const fx = await import('./historyFixtures.js');
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { RECALL_ARMS: readonly string[] };
    const box = makeHistoryBox('ccrc-hist-cli-seamenv-', { role: 'fleet', shim: true });
    const real = path.join(box.home, 'ws-real');
    const link = path.join(box.home, 'ws-link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    const realRp = fs.realpathSync(real);
    healthHh.seedFamily(box, { id: X, project: 'demo', uuid: u(TX1, 0), generation: GX1, rows: leafRows(fx, TX1, link, 'zqseamx') });
    healthHh.seedFamily(box, { id: OF, project: 'demo', uuid: u(TOF, 0), generation: GOF, rows: plainRows(fx, TOF, real, 1, 'zqseamofword') });
    healthHh.seedFamily(box, { id: OL, project: 'demo', uuid: u(TOL, 0), generation: GOL, rows: plainRows(fx, TOL, '/home/u/tree/elsewhere', 30, 'zqseamolword') });
    healthHh.seedFamily(box, { id: X, project: 'demo', uuid: u(TX2, 0), generation: GX2, rows: plainRows(fx, TX2, '/home/u/tree/reuse', 20, 'zqseamxreuse') });
    healthHh.seedFamily(box, { id: LEG, project: 'legacy', uuid: u(TLEG, 0), generation: null, rows: leafRows(fx, TLEG, '/home/u/tree/legacy', 'zqseamleg') });
    // DM18b's re-key: a generation minted later for a uuid the '' family holds merges that family into (LEG, GLM).
    healthHh.plantSession(box, LEG, { generation: GLM });
    healthHh.spoolLine(box, LEG, { v: 1, ev: 'SessionStart', id: LEG, sid: u(TLEG, 0), src: 'resume', reg: u(TLEG, 0), gen: GLM });
    healthHh.seedFamily(box, { id: LEG2, project: 'legacy', uuid: u(TLG2, 0), generation: null, rows: leafRows(fx, TLG2, '/home/u/tree/legacy', 'zqseamlg2') });
    healthHh.seedFamily(box, { id: LEG2, project: 'legacy', uuid: u(TLG9, 0), generation: GL9, rows: plainRows(fx, TLG9, '/home/u/tree/legacy', 40, 'zqseamlg2new') });
    healthHh.seedFamily(box, { id: NT, project: 'legacy', uuid: u(TNT, 0), generation: GNT, rows: ntRows(fx) });
    for (let i = 0; i < 2; i += 1) { const s = runSweep(box); expect(s.code, s.stderr).toBe(0); }
    healthHh.plantSession(box, X, { workdir: '/home/u/tree/elsewhere' });
    healthHh.plantSession(box, XP, { project: 'other' });
    fs.rmSync(link);
    fs.rmSync(real, { recursive: true });
    healthHh.withPane(box, X);
    const sid = metaStoreId(box);
    built = {
      box, marker: path.join(box.root, 'headless-on'), realRp, sid,
      list: markerText(sid, [[X, GX1], [LEG, GLM], [LEG2, ''], [NT, GNT]]),
      control: L.RECALL_ARMS[0]!, treatment: L.RECALL_ARMS[1]!,
    };
    return built;
  }
  const armWith = (f: EnvFx, text: string): void => {
    fs.rmSync(f.marker, { force: true });
    fs.writeFileSync(f.marker, text, { mode: 0o600 });
  };
  const ENV = (f: EnvFx, o: Record<string, string> = {}): Record<string, string> =>
    ({ CCRC_RECALL_SESSION: X, CCRC_RECALL_ARM: f.treatment, CCRC_RECALL_ASOF: N, ...o });
  const run = (f: EnvFx, argv: readonly string[], env: Record<string, string>): Run => healthHh.runCli(f.box, [...argv], { env });
  const calls = (f: EnvFx): string => path.join(f.box.home, 'tmux-calls');
  /** The recall lines in spool/<id>.jsonl, oldest first. */
  const lines = (f: EnvFx, id: string): Array<Record<string, unknown>> => {
    const p = hist(f.box, 'spool', `${id}.jsonl`);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>).filter((r) => r['ev'] === 'recall');
  };
  /** The --json scope's families as `id:generation`, sorted. */
  const gens = (r: Run): string[] => {
    const s = r.json?.['scope'] as { families?: Array<{ ccrc_id: string; generation: string }> } | null | undefined;
    return (s?.families ?? []).map((x) => `${x.ccrc_id}:${x.generation}`).sort();
  };

  it('seam fixture: CONTROL: the families, epochs, boundaries and registry are what the cases assume, and asOfCutOf cuts at N, NL, NL2 and NB2 but not at NB', async () => {
    const f = await envFx();
    const R = (await import('../../ccd/history/recall.mjs')) as unknown as { asOfCutOf(rc: { db: unknown }, asof: string): { ok: boolean; reason?: string } };
    const db = healthHh.openStoreRO(f.box);
    try {
      expect(db.prepare(`SELECT ccrc_id, generation, project, merged_into IS NOT NULL AS merged FROM sessions
        WHERE ccrc_id IN (?, ?, ?, ?, ?, ?) ORDER BY ccrc_id, generation`).all(X, OF, OL, LEG, LEG2, NT)).toEqual([
        { ccrc_id: LEG, generation: '', project: 'legacy', merged: 1 },
        { ccrc_id: LEG, generation: GLM, project: 'legacy', merged: 0 },
        { ccrc_id: LEG2, generation: '', project: 'legacy', merged: 0 },
        { ccrc_id: LEG2, generation: GL9, project: 'legacy', merged: 0 },
        { ccrc_id: NT, generation: GNT, project: 'legacy', merged: 0 },
        { ccrc_id: OF, generation: GOF, project: 'demo', merged: 0 },
        { ccrc_id: OL, generation: GOL, project: 'demo', merged: 0 },
        { ccrc_id: X, generation: GX1, project: 'demo', merged: 0 },
        { ccrc_id: X, generation: GX2, project: 'demo', merged: 0 },
      ]);
      expect(db.prepare(`SELECT s.ccrc_id AS id, s.generation AS g, e.cwd AS cwd, e.cwd_real AS cwd_real FROM epochs e
        JOIN sessions s ON s.session_pk = e.session_pk WHERE e.confirmed_ms IS NOT NULL AND s.ccrc_id IN (?, ?, ?)
        ORDER BY s.ccrc_id, s.generation`).all(X, OF, OL), 'the anchor is stored: cwd verbatim, cwd_real resolved at ingest').toEqual([
        { id: OF, g: GOF, cwd: path.join(f.box.home, 'ws-real'), cwd_real: f.realRp },
        { id: OL, g: GOL, cwd: '/home/u/tree/elsewhere', cwd_real: null },
        { id: X, g: GX1, cwd: path.join(f.box.home, 'ws-link'), cwd_real: f.realRp },
        { id: X, g: GX2, cwd: '/home/u/tree/reuse', cwd_real: null },
      ]);
      expect(db.prepare(`SELECT x.uuid AS uuid, x.ts_ms IS NULL AS unstamped FROM boundaries b JOIN entries x ON x.entry_id = b.entry_id
        WHERE x.uuid IN (?, ?, ?, ?, ?) ORDER BY x.uuid`).all(N, NL, NL2, NB, NB2)).toEqual([
        { uuid: N, unstamped: 0 }, { uuid: NL, unstamped: 0 }, { uuid: NL2, unstamped: 0 }, { uuid: NB, unstamped: 1 }, { uuid: NB2, unstamped: 0 },
      ]);
      for (const b of [N, NL, NL2, NB2]) expect(R.asOfCutOf({ db }, b).ok, b).toBe(true);
      expect(R.asOfCutOf({ db }, NB), 'no stamp at or before NB: the store half refuses').toMatchObject({ ok: false, reason: 'asof-invalid' });
    } finally {
      db.close();
    }
    expect(fs.readFileSync(path.join(f.box.reg, `${X}.generation`), 'utf8'), 'the registry says the reused life').toBe(GX2);
    expect(fs.readFileSync(path.join(f.box.reg, `${X}.project`), 'utf8')).toBe('demo');
    expect(fs.existsSync(f.realRp), 'the anchor no longer resolves on this box').toBe(false);
  }, 900_000);

  it('seam ladder: each step of W2-D46 answers its own word in order, with no tmux call; nothing is counted before step 4 admits the family, and every call after it is counted (C16, C30)', async () => {
    const f = await envFx();
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { REASONS: Record<string, number> };
    expect([L.REASONS['headless-malformed'], L.REASONS['headless-arm-unknown']], 'C16: both words are exit 2').toEqual([2, 2]);
    fs.rmSync(calls(f), { force: true });
    fs.rmSync(f.marker, { force: true });
    let seen = lines(f, X).length;
    const step = (what: string, env: Record<string, string>, want: readonly unknown[], counted: boolean, storeNamed: boolean): Run => {
      const r = run(f, ['grep', 'zqseamxpre', '--json'], env);
      expect(ans(r), `${what}: ${r.stderr}${r.stdout}`).toEqual([...want]);
      expect(r.json?.['store_id'] ?? null, `${what}: the store is named from step 3 on, never before`).toBe(storeNamed ? f.sid : null);
      const now = lines(f, X).length;
      expect(now - seen, `${what}: a counter line iff step 4 admitted the family`).toBe(counted ? 1 : 0);
      seen = now;
      return r;
    };
    // Row 0: the server-role row answers before the seam is looked at.
    const ccrcEnv = path.join(f.box.home, '.ccrc', 'ccrc.env');
    fs.writeFileSync(ccrcEnv, 'CCRC_ROLE=server\n');
    try {
      step('row 0, a server role', ENV(f), [9, undefined], false, false);
    } finally {
      fs.writeFileSync(ccrcEnv, 'CCRC_ROLE=fleet\n');
    }
    // W2-D45: empty values are unset, so this is the tmux path, which with no pane is no-identity.
    step('empty values are unset', { CCRC_RECALL_SESSION: '', CCRC_RECALL_ARM: '', CCRC_RECALL_ASOF: '' }, [2, 'no-identity'], false, false);
    // Step 1, in its order.
    step('step 1, no marker (C30)', ENV(f), [2, 'headless-unarmed'], false, false);
    armWith(f, 'not a marker\n');
    step('step 1, a malformed marker (C16)', ENV(f), [2, 'headless-malformed'], false, false);
    armWith(f, f.list);
    step('step 1, SESSION unset', { CCRC_RECALL_ARM: f.treatment, CCRC_RECALL_ASOF: N }, [2, 'no-identity'], false, false);
    step('step 1, a bad id', ENV(f, { CCRC_RECALL_SESSION: '../x' }), [2, 'bad-id'], false, false);
    step('step 1, an id on no list line (C30)', ENV(f, { CCRC_RECALL_SESSION: 'acct-z-unlisted' }), [2, 'headless-unlisted'], false, false);
    step('step 1, ARM empty (C16)', ENV(f, { CCRC_RECALL_ARM: '' }), [2, 'headless-arm-unknown'], false, false);
    step('step 1, ARM off the vocabulary', ENV(f, { CCRC_RECALL_ARM: 'placebo' }), [2, 'headless-arm-unknown'], false, false);
    step('step 1, ASOF not a uuid', ENV(f, { CCRC_RECALL_ASOF: 'not-a-uuid' }), [2, 'asof-invalid'], false, false);
    // Step 2: the harness, still $REG/<id>.harness (W2-D40's residual).
    const harness = path.join(f.box.reg, `${X}.harness`);
    fs.writeFileSync(harness, 'codex');
    try {
      step('step 2, an unsupported harness', ENV(f), [2, 'harness-unsupported'], false, false);
      // W2-D46's order across steps 1, 2 and 3: an input that fails two adjacent steps answers the earlier word. Each
      // pair's CONTROL is the later step's row alone: the harness row above, and Task 4's store-table row.
      fs.rmSync(f.marker);
      step('step 1 before step 2: no marker, and an unsupported harness', ENV(f), [2, 'headless-unarmed'], false, false);
      armWith(f, f.list);
      const storeIdFile = hist(f.box, 'store.id');
      const savedStoreId = fs.readFileSync(storeIdFile);
      fs.writeFileSync(storeIdFile, `${OTHER_STORE}\n`);
      try {
        step('step 2 before step 3: an unsupported harness, and another store\'s store.id', ENV(f), [2, 'harness-unsupported'], false, false);
      } finally {
        fs.writeFileSync(storeIdFile, savedStoreId);
      }
    } finally {
      fs.rmSync(harness);
    }
    // Step 4: the family from ASOF, the store line and the pair. The store is named; nothing is counted.
    step('step 4, an ASOF no row has', ENV(f, { CCRC_RECALL_ASOF: u('e2b3ffff', 1) }), [2, 'asof-invalid'], false, true);
    step('step 4, an ASOF that is no boundary', ENV(f, { CCRC_RECALL_ASOF: u(TX1, 1) }), [2, 'asof-invalid'], false, true);
    step('step 4, a boundary of another id', ENV(f, { CCRC_RECALL_ASOF: NL }), [2, 'asof-invalid'], false, true);
    armWith(f, markerText(OTHER_STORE, [[X, GX1]]));
    step('step 4, another store marker', ENV(f), [2, 'headless-unlisted'], false, true);
    // R3: the store line is answered before any ASOF row is read, so a fault planted on asOfFamilySql's own text never
    // fires for a foreign marker. CONTROL: under this store's own line the same fault fires, a read failure before the
    // admission (5, uncounted).
    const faulted = (): Run => healthHh.runCli(f.box, ['grep', 'zqseamxpre', '--json'],
      { preloads: [PRELOADS.faults], env: { ...ENV(f), HISTORY_TEST_THROW_PREPARE: 'SqliteError:zqseamfault@AS into_merged_into' } });
    const foreign = faulted();
    expect(ans(foreign), `step 4, another store marker, its ASOF read faulted: ${foreign.stderr}`).toEqual([2, 'headless-unlisted']);
    armWith(f, f.list);
    const own = faulted();
    expect(ans(own), `CONTROL, step 4, this store's line, the ASOF read faulted: ${own.stderr}`).toEqual([5, 'store-read-failed']);
    expect(lines(f, X).length, 'neither faulted call is counted: neither was admitted').toBe(seen);
    armWith(f, markerText(f.sid, [[X, GX2]]));
    step('step 4, the id listed under another generation (C30)', ENV(f), [2, 'headless-unlisted'], false, true);
    step('step 4 before step 6: ARM=control on an unlisted pair is not 8', ENV(f, { CCRC_RECALL_ARM: f.control }), [2, 'headless-unlisted'], false, true);
    armWith(f, f.list);
    // Step 5: recall-off naming the resolved generation: exit 8, counted (C30).
    const off = hist(f.box, 'recall-off', X);
    fs.mkdirSync(path.dirname(off), { recursive: true });
    fs.writeFileSync(off, `${GX1}\n`);
    try {
      step('step 5, recall-off naming G1 (C30)', ENV(f), [8, undefined], true, true);
    } finally {
      fs.rmSync(off);
    }
    // The lines carry the resolved generation here; Task 4 adds the arm to them (R4) and pins it in its own ladder.
    expect(lines(f, X).at(-1), 'the step-5 line: the resolved generation').toMatchObject({ gen: GX1, cmd: 'grep', rc: 8 });
    // Step 6: ARM=control: exit 8, counted (C30).
    step('step 6, ARM=control (C30)', ENV(f, { CCRC_RECALL_ARM: f.control }), [8, undefined], true, true);
    expect(lines(f, X).at(-1)).toMatchObject({ gen: GX1, rc: 8 });
    // Step 7: the treatment arm reads.
    const r = step('step 7, the treatment arm', ENV(f), [0, undefined], true, true);
    expect(r.stdout).toContain('zqseamxpre');
    expect(lines(f, X).at(-1)).toMatchObject({ gen: GX1, rc: 0 });
    expect(fs.existsSync(calls(f)), 'no step of the headless path asks tmux').toBe(false);
    // Step 3, on a box whose first tick has not run: 6, the store never opened. Its CONTROL is every step-4 row above,
    // which named the store, so step 3 had passed.
    const bare = makeHistoryBox('ccrc-hist-cli-seamenv3-', { role: 'fleet', shim: true });
    fs.mkdirSync(bare.root, { recursive: true });
    fs.writeFileSync(path.join(bare.root, 'headless-on'), markerText(OTHER_STORE, [[X, GX1]]), { mode: 0o600 });
    expect(status(bare).code, 'CONTROL: the shim-only row of the table is 6').toBe(6);
    const r3 = healthHh.runCli(bare, ['grep', 'zqseamxpre', '--json'], { env: ENV(f) });
    expect(ans(r3), `step 3, no store: ${r3.stderr}`).toEqual([6, undefined]);
    expect(r3.json?.['store_id'] ?? null).toBeNull();
  }, 900_000);

  it('seam reuse: W2-D40 purge and reuse, (X, G1) listed and ASOF in its transcript while the registry and CCRC_SESSION_GENERATION both say G2: the default scope and --session X read G1, and recall-off is judged against G1; CONTROL: the tmux path reads G2 (C48 stays tmux-only)', async () => {
    const f = await envFx();
    armWith(f, f.list);
    const env = ENV(f, { CCRC_SESSION_GENERATION: GX2 });
    for (const extra of [[], ['--session', X]]) {
      const r = run(f, ['grep', 'zqseamxpre', ...extra, '--json'], env);
      expect(ans(r), `${extra.join(' ')}: ${r.stderr}`).toEqual([0, undefined]);
      expect(gens(r), `${extra.join(' ')}: the family ASOF sits in`).toEqual([`${X}:${GX1}`]);
      expect(r.stdout).toContain('zqseamxpre');
    }
    const off = hist(f.box, 'recall-off', X);
    fs.mkdirSync(path.dirname(off), { recursive: true });
    fs.writeFileSync(off, `${GX2}\n`);
    try {
      expect(ans(run(f, ['grep', 'zqseamxpre', '--json'], env)), 'recall-off naming G2 is stale for the resolved G1: the call reads').toEqual([0, undefined]);
      expect(ans(run(f, ['grep', 'zqseamxreuse', '--json'], { ...PANE_ENV, CCRC_SESSION_GENERATION: GX2 })), 'CONTROL: the tmux path resolves G2, so the same file is off').toEqual([8, undefined]);
    } finally {
      fs.rmSync(off);
    }
    // CONTROL, C48 stays tmux-only: no CCRC_SESSION_GENERATION and $REG/<id>.generation = G2: the tmux scope is (X, G2).
    const t = run(f, ['grep', 'zqseamxreuse', '--json'], PANE_ENV);
    expect(ans(t), t.stderr).toEqual([0, undefined]);
    expect(gens(t)).toEqual([`${X}:${GX2}`]);
  }, 900_000);

  it('seam legacy: W2-D40, a merged legacy family is admitted under the family it merged into, and an unmerged legacy family is read by its exact empty key, never the newest; that call is counted with no gen', async () => {
    const f = await envFx();
    armWith(f, f.list);
    const m = run(f, ['grep', 'zqseamlegpre', '--json'], ENV(f, { CCRC_RECALL_SESSION: LEG, CCRC_RECALL_ASOF: NL }));
    expect(ans(m), m.stderr).toEqual([0, undefined]);
    expect(gens(m), 'the merged family is read as the one it merged into').toEqual([`${LEG}:${GLM}`]);
    expect(lines(f, LEG).at(-1)).toMatchObject({ gen: GLM, rc: 0 });
    for (const extra of [[], ['--session', LEG2]]) {
      const r = run(f, ['grep', 'zqseamlg2pre', ...extra, '--json'], ENV(f, { CCRC_RECALL_SESSION: LEG2, CCRC_RECALL_ASOF: NL2 }));
      expect(ans(r), `${extra.join(' ')}: ${r.stderr}`).toEqual([0, undefined]);
      expect(gens(r), `${extra.join(' ')}: the exact empty key`).toEqual([`${LEG2}:`]);
    }
    const last = lines(f, LEG2).at(-1)!;
    expect(last, 'counted').toMatchObject({ rc: 0 });
    expect('gen' in last, 'no gen: the resolved generation is not a uuid (decisions section 7)').toBe(false);
    // CONTROL: LEG2's newest family is (LEG2, GL9), which the tmux path reads from the registry.
    healthHh.withPane(f.box, LEG2);
    try {
      const t = run(f, ['grep', 'zqseamlg2new', '--json'], PANE_ENV);
      expect(ans(t), t.stderr).toEqual([0, undefined]);
      expect(gens(t)).toEqual([`${LEG2}:${GL9}`]);
    } finally {
      healthHh.withPane(f.box, X);
    }
  }, 900_000);

  it('seam cut: W2-D46 step 7 sets the cut from ASOF through asOfCutOf, so the W2-2a doors hide what follows N; the store half refusing at step 7 is counted (D-5765)', async () => {
    const f = await envFx();
    armWith(f, f.list);
    const at = (argv: readonly string[], env: Record<string, string>): unknown[] => ans(run(f, argv, env));
    // CONTROL: the tmux path reads (X, G1) with no cut when CCRC_SESSION_GENERATION names G1.
    const noCut = { ...PANE_ENV, CCRC_SESSION_GENERATION: GX1 };
    expect(at(['grep', 'zqseamxpost', '--json'], noCut), 'CONTROL: with no cut the row after N is there').toEqual([0, undefined]);
    expect(at(['expand', u(TX1, 6), '--json'], noCut)).toEqual([0, undefined]);
    expect(at(['grep', 'zqseamxpost', '--json'], ENV(f)), 'under ASOF=N the row after N is absent').toEqual([3, undefined]);
    expect(at(['grep', 'zqseamxpre', '--json'], ENV(f))).toEqual([0, undefined]);
    expect(at(['expand', u(TX1, 6), '--json'], ENV(f)), 'hidden means absent: exit 3, never out-of-scope (W2-D36)').toEqual([3, undefined]);
    expect(at(['expand', u(TX1, 1), '--json'], ENV(f))).toEqual([0, undefined]);
    const rx = run(f, ['grep', '--regex', 'zqseamx(pre|post)', '--json'], ENV(f));
    expect(ans(rx), rx.stderr).toEqual([0, undefined]);
    expect(rx.stdout).toContain('zqseamxpre');
    expect(rx.stdout, 'the regex child gets the cut too').not.toContain('zqseamxpost');
    const tree = run(f, ['tree', '--json'], ENV(f));
    expect(ans(tree), tree.stderr).toEqual([0, undefined]);
    expect(tree.json?.['scope'], 'the header counts what the cut shows').toMatchObject({ transcripts: 1, families_total: 1 });
    // NT's first boundary has no stamp at or before it: the store half answers asof-invalid after admission, counted (R5a).
    const before = lines(f, NT).length;
    const nt = run(f, ['grep', 'zqseamntpre', '--json'], ENV(f, { CCRC_RECALL_SESSION: NT, CCRC_RECALL_ASOF: NB }));
    expect(ans(nt), nt.stderr).toEqual([2, 'asof-invalid']);
    expect(lines(f, NT).length - before, 'counted: step 4 admitted the family').toBe(1);
    expect(lines(f, NT).at(-1)).toMatchObject({ gen: GNT, rc: 2 });
    expect(at(['grep', 'zqseamntpre', '--json'], ENV(f, { CCRC_RECALL_SESSION: NT, CCRC_RECALL_ASOF: NB2 })), 'CONTROL: the stamped boundary of the same family cuts').toEqual([0, undefined]);
  }, 900_000);

  it('seam widened: W2-D41, --project and --session stay legal on env and are cut, a family with no visible epoch is dropped from the scope and its count; the env-only guard answers cross-project when the registry project is not the stored one', async () => {
    const f = await envFx();
    armWith(f, f.list);
    // CONTROL: the tmux path (X's registry life, G2) sees the project's four families, OL's text included.
    const t = run(f, ['tree', '--project', '--json'], PANE_ENV);
    expect(ans(t), t.stderr).toEqual([0, undefined]);
    expect(gens(t)).toEqual([`${OF}:${GOF}`, `${OL}:${GOL}`, `${X}:${GX1}`, `${X}:${GX2}`].sort());
    expect(ans(run(f, ['grep', 'zqseamolword', '--project', '--json'], PANE_ENV))).toEqual([0, undefined]);
    // Under ASOF=N: OL and (X, G2) hold only rows stamped after T_N, so they leave the scope and its count.
    const e = run(f, ['tree', '--project', '--json'], ENV(f));
    expect(ans(e), e.stderr).toEqual([0, undefined]);
    expect(e.json?.['scope']).toMatchObject({ kind: 'project', families_total: 2 });
    expect(gens(e)).toEqual([`${OF}:${GOF}`, `${X}:${GX1}`]);
    expect(ans(run(f, ['grep', 'zqseamolword', '--project', '--json'], ENV(f))), 'a dropped family text is absent').toEqual([3, undefined]);
    expect(ans(run(f, ['grep', 'zqseamofword', '--project', '--json'], ENV(f)))).toEqual([0, undefined]);
    // --session <other> takes the other id's newest family, then the cut (W2-D40's residual).
    expect(ans(run(f, ['grep', 'zqseamofword', '--session', OF, '--json'], ENV(f)))).toEqual([0, undefined]);
    expect(ans(run(f, ['grep', 'zqseamolword', '--session', OL, '--json'], ENV(f)))).toEqual([3, undefined]);
    // The env-only guard: $REG/X.project names another project than the family's stored one.
    const proj = path.join(f.box.reg, `${X}.project`);
    const before = lines(f, X).length;
    fs.writeFileSync(proj, 'other');
    try {
      expect(ans(run(f, ['grep', 'zqseamxpre', '--json'], ENV(f))), 'the guard: cross-project').toEqual([2, 'cross-project']);
      expect(lines(f, X).length - before, 'counted: the guard is step 7, after admission').toBe(1);
      expect(ans(run(f, ['grep', 'zqseamxreuse', '--json'], PANE_ENV)), 'CONTROL: the tmux path has no such guard').toEqual([0, undefined]);
      fs.rmSync(proj);
      expect(ans(run(f, ['grep', 'zqseamxpre', '--json'], ENV(f))), 'no registry project: the default scope used none, and reads').toEqual([0, undefined]);
      expect(ans(run(f, ['grep', 'zqseamxpre', '--project', '--json'], ENV(f))), 'and --project needs one').toEqual([2, 'project-unreadable']);
    } finally {
      fs.writeFileSync(proj, 'demo');
    }
  }, 900_000);

  it('seam workspace: D-5767, --workspace on env anchors on the stored cwd_real or cwd of the epoch ASOF sits in, never on the registry workdir, and matches it as stored, with no realpath at read time', async () => {
    const f = await envFx();
    armWith(f, f.list);
    expect(fs.readFileSync(path.join(f.box.reg, `${X}.workdir`), 'utf8'), 'CONTROL: the registry names another workdir').toBe('/home/u/tree/elsewhere');
    const e = run(f, ['tree', '--workspace', '--json'], ENV(f));
    expect(ans(e), e.stderr).toEqual([0, undefined]);
    expect(e.json?.['scope']).toMatchObject({ kind: 'workspace' });
    expect(gens(e), 'the G1 family and OF, whose epochs ran in the anchor; never OL, the registry workdir').toEqual([`${OF}:${GOF}`, `${X}:${GX1}`]);
    expect(ans(run(f, ['grep', 'zqseamofword', '--workspace', '--json'], ENV(f)))).toEqual([0, undefined]);
    // CONTROL: the tmux path anchors on $REG/<id>.workdir, as spec 8.2 says: OL alone.
    const t = run(f, ['tree', '--workspace', '--json'], PANE_ENV);
    expect(ans(t), t.stderr).toEqual([0, undefined]);
    expect(gens(t)).toEqual([`${OL}:${GOL}`]);
  }, 900_000);

  it('seam C50: on the env path the CLI answers the decideScope verdict with source env, flag set by flag; an unknown source is refused', async () => {
    const f = await envFx();
    armWith(f, f.list);
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { decideScope(i: Record<string, unknown>): Record<string, unknown> };
    const pres = (p: string): Record<string, unknown> =>
      (fs.existsSync(p) ? { state: 'value', value: fs.readFileSync(p, 'utf8') } : { state: 'absent' });
    const ROWS: ReadonlyArray<readonly string[]> = [
      [], ['--project'], ['--workspace'], ['--session', X], ['--session', OF], ['--session', XP], ['--project', '--workspace'], ['--session', '../x'],
    ];
    for (const extra of ROWS) {
      const at = extra.indexOf('--session');
      const session = at < 0 ? null : extra[at + 1]!;
      const v = L.decideScope({
        source: 'env', id: X, generation: { value: GX1, via: 'asof' },
        flags: { project: extra.includes('--project'), workspace: extra.includes('--workspace'), session },
        reg: {
          project: pres(path.join(f.box.reg, `${X}.project`)),
          workdir: { state: 'value', value: f.realRp },
          sessionProject: session === null ? null
            : (/^[A-Za-z0-9._-]+$/.test(session) ? pres(path.join(f.box.reg, `${session}.project`)) : { state: 'absent' }),
        },
      });
      const want = v['ok'] === true ? [0, v['kind']] : [v['rc'], v['reason']];
      if (extra.length === 0) expect(want, 'CONTROL: decideScope admits source env, so the default row is a family verdict').toEqual([0, 'family']);
      const r = run(f, ['tree', ...extra, '--json'], ENV(f));
      const got = r.code === 0 ? [0, (r.json?.['scope'] as Record<string, unknown>)['kind']] : [r.code, r.json?.['reason']];
      expect(got, `${extra.join(' ') || '(default)'}: ${r.stderr}`).toEqual(want);
    }
    expect(L.decideScope({
      source: 'relay', id: X, generation: { value: GX1, via: 'asof' }, flags: { project: false, workspace: false, session: null },
      reg: { project: { state: 'value', value: 'demo' }, workdir: { state: 'absent' }, sessionProject: null },
    }), 'an unknown source is refused, not defaulted').toEqual({ ok: false, rc: 2, reason: 'no-identity' });
  }, 900_000);

  it('seam C24: under env an admitted call writes one fenced recall line with the resolved gen and no query text, drained to a recall_calls row; a tmux call carries no arm; under history-off nothing is written', async () => {
    const f = await envFx();
    armWith(f, f.list);
    const p = hist(f.box, 'spool', `${X}.jsonl`);
    const text = (): string => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
    const t0 = text();
    expect(ans(run(f, ['grep', 'zqseamxpre', '--json'], ENV(f)))).toEqual([0, undefined]);
    const added = text().slice(t0.length);
    expect(added, 'fenced as the hook fences its lines').toMatch(/^\n\{.*\}\n$/);
    const line = JSON.parse(added.trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ v: 1, ev: 'recall', id: X, gen: GX1, cmd: 'grep', rc: 0 });
    // Every key but `arm`, which Task 4 adds (R4); its key set is Task 4's ladder's.
    expect(Object.keys(line).filter((k) => k !== 'arm').sort()).toEqual(['cmd', 'ev', 'gen', 'id', 'ms', 'rc', 'ts', 'v']);
    expect(added, 'no query text (G5)').not.toContain('zqseamxpre');
    const t1 = text();
    expect(ans(run(f, ['grep', 'zqseamxreuse', '--json'], PANE_ENV))).toEqual([0, undefined]);
    const tmuxLine = JSON.parse(text().slice(t1.length).trim()) as Record<string, unknown>;
    expect(tmuxLine, 'a tmux call').toMatchObject({ id: X, gen: GX2, cmd: 'grep', rc: 0 });
    expect('arm' in tmuxLine, 'a tmux call writes no arm (W2-D43)').toBe(false);
    // The drain, with the marker set aside so the tick sees the box as it is outside a window.
    fs.rmSync(f.marker, { force: true });
    const s = runSweep(f.box);
    expect(s.code, s.stderr).toBe(0);
    const db = healthHh.openStoreRO(f.box);
    try {
      const rows = db.prepare('SELECT generation, verb, rc, arm FROM recall_calls WHERE ccrc_id = ? AND rc = 0 ORDER BY ts_ms, event_key')
        .all(X) as Array<Record<string, unknown>>;
      expect(rows.map((x) => ({ generation: x['generation'], verb: x['verb'], rc: x['rc'] })), 'the env call is a row of its family').toEqual(expect.arrayContaining([{ generation: GX1, verb: 'grep', rc: 0 }]));
      expect(rows.filter((x) => x['generation'] === GX2).map((x) => x['arm']), 'the tmux calls').toContain(null);
      expect(rows.filter((x) => x['generation'] === GX2 && x['arm'] !== null), 'no tmux call has an arm').toEqual([]);
    } finally {
      db.close();
    }
    // history-off: nothing is written (C24).
    armWith(f, f.list);
    const offFile = path.join(f.box.home, '.ccrc', 'history-off');
    fs.writeFileSync(offFile, '');
    try {
      const t2 = text();
      run(f, ['grep', 'zqseamxpre', '--json'], ENV(f));
      expect(text(), 'under history-off no counter line').toBe(t2);
    } finally {
      fs.rmSync(offFile);
    }
  }, 900_000);

  it('seam marker read: W2-D44, the marker is read only through store.mjs\'s bounded reader: a link to a valid list and a FIFO are headless-malformed; a list of exactly HEADLESS_LIST_MAX_BYTES bytes is read, and one byte more is malformed', async () => {
    const f = await envFx();
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { HEADLESS_LIST_MAX_BYTES: number };
    const MAX = L.HEADLESS_LIST_MAX_BYTES;
    expect(MAX).toBe(65_536);
    const q = (): unknown[] => ans(run(f, ['grep', 'zqseamxpre', '--json'], ENV(f)));
    const aside = path.join(f.box.home, 'list-aside');
    fs.writeFileSync(aside, f.list);
    fs.rmSync(f.marker, { force: true });
    fs.symlinkSync(aside, f.marker);
    expect(q(), 'a link is never followed').toEqual([2, 'headless-malformed']);
    fs.rmSync(f.marker);
    fs.copyFileSync(aside, f.marker);
    expect(q(), 'CONTROL: the same text as a regular file').toEqual([0, undefined]);
    fs.rmSync(f.marker);
    expect(spawnSync('mkfifo', [f.marker]).status).toBe(0);
    expect(q(), 'a FIFO is no regular file, and is never waited on').toEqual([2, 'headless-malformed']);
    fs.rmSync(f.marker);
    const head = f.list.endsWith('\n') ? f.list : `${f.list}\n`;
    const padded = (n: number): string => `${head}#${'x'.repeat(n - head.length - 2)}\n`;
    expect(Buffer.byteLength(padded(MAX))).toBe(MAX);
    armWith(f, padded(MAX));
    expect(q(), 'exactly HEADLESS_LIST_MAX_BYTES bytes: read whole').toEqual([0, undefined]);
    armWith(f, padded(MAX + 1));
    expect(q(), 'one byte more: malformed, never read as a prefix').toEqual([2, 'headless-malformed']);
    armWith(f, f.list);
  }, 900_000);
});

// ── W2-2b Task 3 (W2-D47): the box verbs ignore the seam (C28 extended) ──────────────────────────────────────────────
describe('W2-2b Task 3: box verbs ignore the seam (W2-D47; C28 extended)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  it('seam box verbs: status, doctor and an operator verb answer with SESSION and ARM set, in a pane or not, as with none, and write no counter line; CONTROL: a read verb under the same values takes the headless path', async () => {
    const L = (await import('../../ccd/history/lib.mjs')) as unknown as { RECALL_ARMS: readonly string[] };
    const box = boundBox('ccrc-hist-cli-w2d47-');
    const pane = healthHh.withPane(box, ID);
    const tmuxCalls = path.join(box.home, 'tmux-calls');
    const seam: Record<string, string> = { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: L.RECALL_ARMS[1]! };
    const spoolDir = hist(box, 'spool');
    const before = fs.readdirSync(spoolDir).sort();
    const base = status(box);
    expect([base.code, base.env.exit], 'CONTROL: status with nothing set').toEqual([0, 0]);
    const d0 = healthHh.runCli(box, ['doctor', '--json']);
    const envs: Array<Record<string, string>> = [seam, { ...seam, CCRC_RECALL_ASOF: U9 }, { ...seam, ...pane }];
    for (const env of envs) {
      const what = JSON.stringify(env);
      const s = status(box, { env });
      expect([s.code, s.env.exit, s.env.reason], `C28 extended, status --json: ${what}`).toEqual([0, 0, undefined]);
      const d = healthHh.runCli(box, ['doctor', '--json'], { env });
      expect([d.code, d.json?.['exit'], d.json?.['reason']], `doctor --json: ${what}`).toEqual([d0.code, d0.json?.['exit'], d0.json?.['reason']]);
    }
    healthHh.stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const op = healthHh.runCli(box, ['recall-off', ID, '--generation', G1, '--json'], { env: seam });
    expect(op.code, `${op.stdout}${op.stderr}`).toBe(0);
    expect(fs.readFileSync(path.join(box.home, 'stub-shim-argv'), 'utf8'), 'the operator verb reached its door as typed').toContain(`--op recall-off ${ID} --generation ${G1}`);
    expect(fs.readdirSync(spoolDir).sort(), 'no box verb wrote a counter line').toEqual(before);
    expect(fs.existsSync(tmuxCalls), 'no box verb asked tmux').toBe(false);
    // CONTROL: the same values reach a read verb: with no pane the headless path (no marker on this box), in a pane
    // W2-2a's refusal. So the box verbs above ignored values the read path reads.
    const read = healthHh.runCli(box, ['tree', '--json'], { env: seam });
    expect([read.code, read.json?.['reason']], read.stderr).toEqual([2, 'headless-unarmed']);
    const inPane = healthHh.runCli(box, ['tree', '--json'], { env: { ...seam, ...pane } });
    expect([inPane.code, inPane.json?.['reason']]).toEqual([2, 'headless-in-pane']);
  }, 240_000);
});
```

(c) No import line is added, and no numeric line citation is written into the file (`citations.test.ts`, D-5893). Fixture paths are `/home/u/tree` style or built at run time under the fixture HOME; ids follow ccd's grammar with neutral words.

- [ ] **Step 3: Run the new tests and watch them fail as predicted.** One per tool call, each from the repository root:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'seam pure')
```
Predicted: `2 failed`: `decideEnvProject` at its first line, `W2-D41: the env source: expected [ 'tmux' ] to deeply equal [ 'tmux', 'env' ]`; `decideHeadlessRead` with `TypeError: L.decideHeadlessRead is not a function` (its `EXIT` line passes first).

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'seam source')
```
Predicted: `1 failed`, at `R1: one read, in cli.mjs, of R1's exact line`: `expected [] to deeply equal [ 'cli.mjs:  const marker = …' ]` (Task 2's commit reads no marker).

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'seam (fixture|ladder|reuse|legacy|cut|widened|workspace|C50|C24|marker read)')
```
Predicted: `9 failed | 1 passed`. The fixture case passes (it reads the store and recall.mjs only). Every other case fails at its first headless run with W2-2a's no-pane answer, `expected [ 2, 'no-identity' ] to deeply equal [ … ]`: the ladder at `step 1, no marker (C30)` (its row 0 and its empty-values row pass first), reuse, legacy, cut, widened, workspace and C24 at their first env run, C50 at its CONTROL on the default row (`expected [ 2, 'no-identity' ] to deeply equal [ 0, 'family' ]`: `decideScope` refuses source `env` until P1), marker read at its link row.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'seam box verbs|a seam variable takes the headless path')
```
Predicted: `2 failed`. "seam box verbs" passes every status, doctor and operator line (W2-D47 already holds at the base) and fails at its CONTROL, `expected [ 2, 'no-identity' ] to deeply equal [ 2, 'headless-unarmed' ]`. The edited case (b) fails at its first row with the same message.

Record each first failing line in the scratch notes. A red anywhere else, the fixture case included, is the fixture's to fix before any code is written (for example, a merge that the resume line did not make: re-read history-drain's DM18b case and match its line).

- [ ] **Step 4: lib.mjs and lib.d.mts.**

(a) `ccd/history/lib.mjs`, in place: `export const SCOPE_SOURCES = Object.freeze(['tmux']);` becomes

```js
export const SCOPE_SOURCES = Object.freeze(['tmux', 'env']);
```

and `ccd/history/lib.d.mts`, in place: `export const SCOPE_SOURCES: readonly ['tmux'];` becomes `export const SCOPE_SOURCES: readonly ['tmux', 'env'];`. The tmux path keeps `SCOPE_SOURCES[0]`; the env path names `SCOPE_SOURCES[1]`.

(b) `ccd/history/lib.mjs`: insert directly above `/** The shortest prefix of each id, its letter plus at least`:

```js
/** W2-D41's env-only guard (§8.2 "Across projects: never"), run after decideScope on the headless path: the registry
 *  project decideScope used (`verdict.project`, from $REG/<CCRC_RECALL_SESSION>.project) must equal the resolved family's
 *  STORED sessions.project, or the answer is exit 2 cross-project. Every scope kind is guarded, the default family scope
 *  included; a verdict with no project used none and passes. A verdict of any other source passes: the guard is the env
 *  path's alone. */
export function decideEnvProject({ verdict, storedProject }) {
  if (verdict.source !== SCOPE_SOURCES[1] || verdict.project === null) return { ok: true };
  return verdict.project === storedProject ? { ok: true } : refuseScope('cross-project');
}

/** W2-D46 steps 5 and 6 on the headless path, after step 4 admitted the family, so both answers are counted. `recallOff`
 *  is decideRecallOff's answer for recall-off/<id> against the RESOLVED generation (§9.7): 'off' is exit 8 (step 5).
 *  Then the arm (step 6, W2-D42): the treatment arm reads, and every other value is exit 8. decideHeadless admits only
 *  RECALL_ARMS' words, so the other value a caller can pass is the control arm; anything else withholds too, fail
 *  closed. `why` names the step for tests: exit 8 carries no word. */
export function decideHeadlessRead({ recallOff, arm }) {
  if (recallOff === 'off') return { ok: false, rc: EXIT.RECALL_OFF, why: 'recall-off' };
  if (arm !== RECALL_ARMS[1]) return { ok: false, rc: EXIT.RECALL_OFF, why: 'arm' };
  return { ok: true };
}

```

(c) `ccd/history/lib.d.mts`: insert directly after `export function decideScope(i: ScopeInputs): ScopeVerdict;`:

```ts
// --- W2-2b Task 3: the headless path's own two decisions (W2-D41, W2-D46)
export function decideEnvProject(i: { verdict: Extract<ScopeVerdict, { ok: true }>; storedProject: string }): { ok: true } | ScopeRefusal<'cross-project'>;
export function decideHeadlessRead(i: { recallOff: 'off' | 'stale' | 'none'; arm: string }): { ok: true } | { ok: false; rc: 8; why: 'recall-off' | 'arm' };
```

Count the declarations (`skipLibCheck` hides a duplicate), then run the pure cases and history-lib's C50:

```bash
grep -c '^export function decideEnvProject\|^export function decideHeadlessRead' ccd/history/lib.d.mts ccd/history/lib.mjs
grep -c "SCOPE_SOURCES = Object.freeze(\['tmux', 'env'\])\|SCOPE_SOURCES: readonly \['tmux', 'env'\]" ccd/history/lib.mjs ccd/history/lib.d.mts
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'seam pure')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'C50: every SCOPE_SOURCES member')
```

Expected: 2 in each file, then 1 in each; `2 passed`; `1 passed` (C50's table now also runs under `'env'`, and `'env'` leaves its refused list).

- [ ] **Step 5: cli.mjs.**

(a) The read verbs' lib import: insert two lines directly after `  decideRecallOff, parseSpoolLine,`:

```js
  recallSeamEngaged, decideHeadless, headlessMarkerOf, HEADLESS_LIST_MAX_BYTES,
  decideHeadlessStore, asOfFamilySql, decideAsOfFamily, decideHeadlessRead, decideEnvProject,
```

(b) The recall.mjs import, in place:

```js
import { runTree, grepVerb, describeVerb, expandVerb, familiesOf, transcriptsOf, scopeHeader, scopeJsonOf, asOfCutOf } from './recall.mjs';
```

(c) The dispatcher's order comment: insert directly after `//        tick recorded, read now) for output redaction (§8.3 layers 1 and 4).`:

```js
//   - With no pane and a seam value set (W2-D45: a CCRC_RECALL_* variable is set iff it is non-empty), the READ verbs
//     take the HEADLESS path after steps 1, 2 and 2a, in W2-D46's order (readContextEnv;
//     D-5767 (history-w2-env-identity-from-asof)):
//     h1. the marker's one read (store.mjs readBounded at HEADLESS_LIST_MAX_BYTES, no link followed, folded by
//         headlessMarkerOf), then decideHeadless: headless-unarmed, headless-malformed, no-identity, bad-id,
//         headless-unlisted, headless-arm-unknown, asof-invalid;
//     h2. the harness, still $REG/<id>.harness (W2-D40's stated residual);
//     h3. the rest of §8.3's table after the 2 s stat, the read-only open, decideStatusRead;
//     h4. decideHeadlessStore, the marker's store line, before any ASOF row is read; then decideAsOfFamily over
//         asOfFamilySql's rows and the pair: the family is ADMITTED here, and only an admitted call writes a counter
//         line (W2-D46);
//     h5 and h6. decideHeadlessRead: recall-off/<id> against the resolved generation, then ARM=control: exit 8, counted;
//     h7. decideScope with source env (--workspace anchored on the ASOF epoch's stored cwd_real ?? cwd),
//         decideEnvProject (W2-D41: cross-project), the families and transcripts, then the cut (asOfCutOf) on
//         rc.scope.cut.
//     CCRC_SESSION_GENERATION, $REG/<id>.generation and the id's newest family are never read on this path, and tmux
//     is never spawned.
```

(d) `readContext`, in place: `  const seen = { id: null, gen: null };` becomes `  const seen = { id: null, gen: null, arm: null };`. Nothing else in `readContext` changes here (R4: its answer's arm is Task 4's).

(e) In `readContextIn`, replace W2-2a's block:

```js
  const pane = process.env.TMUX_PANE ?? null;
  // W2-D39: the seam variables inside a pane are 2 headless-in-pane, decided before any tmux spawn (C4, C31). Each of
  // the three is read here, by name and once; lib decides what set means (W2-D45).
  const inPane = decideSeamInPane({
    pane,
    recall: {
      session: process.env.CCRC_RECALL_SESSION ?? null,
      arm: process.env.CCRC_RECALL_ARM ?? null,
      asof: process.env.CCRC_RECALL_ASOF ?? null,
    },
  });
  if (!inPane.ok) return refusal(inPane.rc, inPane.reason, null, null, null);
```

with:

```js
  const pane = process.env.TMUX_PANE ?? null;
  // W2-D39: the seam variables inside a pane are 2 headless-in-pane, decided before any tmux spawn (C4, C31). Each of
  // the three is read here, by name and once; lib decides what set means (W2-D45).
  const recall = {
    session: process.env.CCRC_RECALL_SESSION ?? null,
    arm: process.env.CCRC_RECALL_ARM ?? null,
    asof: process.env.CCRC_RECALL_ASOF ?? null,
  };
  const inPane = decideSeamInPane({ pane, recall });
  if (!inPane.ok) return refusal(inPane.rc, inPane.reason, null, null, null);
  // W2-D45, W2-D46: no pane and a seam value set is the headless path, whose identity and family come from the seam,
  // never from tmux, CCRC_SESSION_GENERATION or the registry's generation (D-5767 (history-w2-env-identity-from-asof)).
  // With nothing set the path below is today's, unchanged.
  if (recallSeamEngaged(recall)) return readContextEnv(home, P, parsed, nowMs, seen, recall, pane);
```

(f) The headless path: insert directly above the doc comment that begins `/** The recall.mjs runner each read verb calls.`:

```js
/** W2-D40's measurement (D-5767): lib's asOfFamilySql over the row stored under CCRC_RECALL_ASOF, on the admitted
 *  read-only handle, run only once decideHeadlessStore passed the marker's store line (R3). Ids, keys and launch facts
 *  only: no text is read. */
function asOfRowsOf(db, asof) {
  return db.prepare(asOfFamilySql()).all({ asof });
}

/** The headless path (§8.2's seam; W2-D46's order after its row 0 and W2-2a's in-pane row, which readContextIn ran). It
 *  measures and hands each measurement to lib; it decides nothing. A refusal before step 4 names no id, so readVerb writes
 *  no counter line for it; at step 4's admission `seen` takes the id, the resolved generation and the arm, and every
 *  later answer names the id and generation (W2-D43, W2-D46). D-5767 (history-w2-env-identity-from-asof): the family is
 *  the one CCRC_RECALL_ASOF's boundary sits in, never CCRC_SESSION_GENERATION's, $REG/<id>.generation's or the id's
 *  newest; `--session <own id>` reads it, and `--workspace` anchors on its epoch's stored cwd_real ?? cwd, never on
 *  $REG/<id>.workdir. Residuals, stated (W2-D40): the harness is still $REG/<id>.harness, and `--session <other>` takes
 *  the other id's newest family, then the cut. */
async function readContextEnv(home, P, parsed, nowMs, seen, recall, pane) {
  // Step 1: the marker's one read (W2-D44; readContextIn sends only an engaged seam with no pane here), then
  // decideHeadless's rows.
  const marker = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));
  const head = decideHeadless({ recall, paneSet: pane !== null, marker });
  if (!head.ok) return refusal(head.rc, head.reason, null, null, null);
  // readContextIn sends only an engaged seam here, so decideHeadless cannot answer the tmux path; if it ever did, fail
  // closed: an uncounted defect (seen.id is still null), never a read with no session.
  if (head.path !== 'headless') throw new TypeError('readContextEnv: decideHeadless answered the tmux path');
  const id = head.session;
  // Step 2: the harness (W2-D40's stated residual: a reused id with another harness refuses, fail closed).
  const harness = decideHarness(regPresence(P, id, 'harness'));
  if (!harness.ok) return refusal(harness.rc, harness.reason, null, null, null);
  // Step 3: §8.3's table after the 2 s stat, the read-only open and decideStatusRead.
  const reach = await measureReach(home);
  const d = decideCliStore(cliFactsOf(reach));
  if (!d.read) return refusal(d.exit, d.reason, refusalStoreId(reach, P), null, null);
  let db;
  try {
    db = openReader(P.dbFile);
  } catch (e) {
    const f = readFailure(e, refusalStoreId(reach, P), null, null);
    if (f === null) throw e;
    return f;
  }
  let handed = false;
  let storeId = refusalStoreId(reach, P);
  try {
    const meta = db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get();
    if (meta !== undefined) storeId = meta.v;
    const mode = db.prepare('PRAGMA journal_mode').get().journal_mode;
    const version = userVersion(db);
    const rd = decideStatusRead({ userVersion: version, journalMode: mode, recordedMigration: undefined });
    if (rd.reason !== undefined) return refusal(rd.exit, rd.reason, storeId, null, null);
    // Step 4: the marker's store line first, against the meta row alone (W2-D44), before any ASOF row is read (R3); then
    // the family from ASOF and its pair. ADMITTED here (W2-D46): from now on the call is counted.
    const ownStore = meta === undefined ? null : meta.v;
    const storeLine = decideHeadlessStore({ list: head.list, storeId: ownStore });
    if (!storeLine.ok) return refusal(storeLine.rc, storeLine.reason, storeId, null, null);
    const fam = decideAsOfFamily({
      session: id, asof: head.asof, rows: asOfRowsOf(db, head.asof), list: head.list, storeId: ownStore,
    });
    if (!fam.ok) return refusal(fam.rc, fam.reason, storeId, null, null);
    const gen = fam.generation;
    seen.id = id;
    seen.gen = gen;
    seen.arm = head.arm;
    // Steps 5 and 6: recall-off/<id> against the RESOLVED generation, then ARM=control: exit 8, counted (W2-D42).
    const gate = decideHeadlessRead({ recallOff: decideRecallOff({ file: recallOffPresence(home, id), generation: gen }), arm: head.arm });
    if (!gate.ok) return refusal(gate.rc, undefined, storeId, id, gen);
    // Step 7: the scope with source env (W2-D41; C50), its env-only project guard, the families, then the cut.
    const o = parsed.opts;
    const session = typeof o.session === 'string' ? o.session : null;
    const verdict = decideScope({
      source: SCOPE_SOURCES[1], id, generation: { value: gen, via: fam.via },
      flags: { project: o.project === true, workspace: o.workspace === true, session },
      reg: {
        project: regPresence(P, id, 'project'),
        workdir: fam.anchor === null ? ABSENT : { state: 'value', value: fam.anchor },
        sessionProject: session === null ? null : (idOk(session) ? regPresence(P, session, 'project') : ABSENT),
      },
    });
    if (!verdict.ok) return refusal(verdict.rc, verdict.reason, storeId, id, gen);
    const guard = decideEnvProject({ verdict, storedProject: fam.family.project });
    if (!guard.ok) return refusal(guard.rc, guard.reason, storeId, id, gen);
    // verdict.generation is the resolved one, an exact key ('' for a legacy family), for the own id, and null (that id's
    // newest family) for another. The workspace anchor is matched as stored: no realpath at read time.
    const families = familiesOf(db, {
      kind: verdict.kind, id: verdict.id, generation: verdict.generation, project: verdict.project,
      workdir: verdict.workdir, workdirReal: verdict.workdir,
    });
    const transcriptPks = transcriptsOf(db, families.map((f) => f.sessionPk));
    if (transcriptPks.length === 0) return refusal(EXIT.NOT_INDEXED, undefined, storeId, id, gen);
    // The cut (W2-D46 step 7): W2-2a's store half, so every door that reads rc.scope.cut applies it. Its asof-invalid
    // (D-5765) comes after admission and is counted.
    const cut = asOfCutOf({ db }, head.asof);
    if (!cut.ok) return refusal(cut.rc, cut.reason, storeId, id, gen);
    const rc = {
      db, version, schema: SCHEMA_ADDED, storeId, nowMs, home, id, gen,
      scope: {
        kind: verdict.kind, id: verdict.id, generation: families.length === 1 ? families[0].generation : null,
        project: verdict.project, workdir: verdict.workdir,
        sessionPks: families.map((f) => f.sessionPk), transcriptPks, families, cut: cut.cut,
      },
      scopeArgs: scopeArgsOf(o),
      pairIdx: pairIndexOf(db, home),
    };
    handed = true;
    return rc;
  } catch (e) {
    // A failed read of the admitted store is ONE exit-5 answer, counted only once step 4 admitted the family.
    const f = readFailure(e, storeId, seen.id, seen.gen);
    if (f === null) throw e;
    return f;
  } finally {
    if (!handed) db.close();
  }
}

```

Then smoke-load the module in a child, so its umask never reaches a vitest worker, and check no new env name is read:

```bash
node --no-warnings --input-type=module -e "await import('./ccd/history/cli.mjs'); process.stdout.write('loaded\n')"
diff <(git show HEAD:ccd/history/cli.mjs | grep -o 'process\.env\.[A-Za-z_]*' | sort | uniq -c) <(grep -o 'process\.env\.[A-Za-z_]*' ccd/history/cli.mjs | sort | uniq -c) && echo 'same env reads'
grep -c 'headlessOn' ccd/history/cli.mjs
```

Expected: `loaded`; `same env reads` (HEAD is Task 2's commit; the three seam names stay one read each, so W2-2a's seven-name allow-list stays exact); `1` (R1's one line).

- [ ] **Step 6: Run the new tests green.** One per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'seam (pure|source|fixture|ladder|reuse|legacy|cut|widened|workspace|C50|C24|marker read|box verbs)')
```
Expected: `14 passed`.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'W2-D39')
```
Expected: `6 passed`: W2-2a's two describes, the edited case (b) among them.

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the headless marker and the arm words')
```
Expected: `4 passed`: Task 1's one-read pin admits R1's line by its shape; "seam source" pins that it is the one such line, inside `readContextEnv`.

- [ ] **Step 7: Measure each guard red under its mutant, then green.** From the repository root. First write the helpers, once:

```bash
SCRATCH=.superpowers/sdd/history-w2-2b/t3
mkdir -p "$SCRATCH"
for f in ccd/history/cli.mjs ccd/history/lib.mjs; do cp "$f" "$SCRATCH/$(basename "$f").orig"; done
cat > "$SCRATCH/mut.sh" <<'EOF'
SCRATCH=.superpowers/sdd/history-w2-2b/t3
FILES="ccd/history/cli.mjs ccd/history/lib.mjs"
# mut <file>: replace the text of $SCRATCH/old with $SCRATCH/new in <file>, refusing unless it occurs exactly once.
mut() {
  python3 - "$1" "$SCRATCH/old" "$SCRATCH/new" <<'PY'
import sys
p, o, n = sys.argv[1], open(sys.argv[2], encoding='utf-8').read(), open(sys.argv[3], encoding='utf-8').read()
t = open(p, encoding='utf-8').read()
c = t.count(o)
if c != 1:
    sys.exit(f'anchor occurs {c} times in {p}')
open(p, 'w', encoding='utf-8').write(t.replace(o, n))
PY
}
# restore: every file back to its copy, checked with cmp. It also runs when the call exits, by a signal too, so a call
# that is killed mid-mutant never leaves the mutant in the tree.
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; cmp -s "$SCRATCH/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done; }
trap restore EXIT
trap 'exit 143' INT TERM HUP
EOF
```

Then run each mutant in its own tool call. Each call sources the helpers, writes `old` and `new` with quoted heredocs, applies the mutant, runs the named filter in the foreground (timeout at least 600000 ms), and ends with `restore`. A `mut` that exits non-zero means the anchor moved: re-read the region, re-anchor on the line that now makes the same decision, and name the substitution in the commit body. Never split one mutant across calls. A call that prints `NOT RESTORED` stops the task: report it. Every block below has this shape; M1 is written in full, and every later block differs only in its comment, its two heredoc bodies, its `mut` file and its filter, which are given exactly.

```bash
. .superpowers/sdd/history-w2-2b/t3/mut.sh
# M1 (W2-D46 row 0): the headless path taken before the Darwin and server-role rows.
cat > "$SCRATCH/old" <<'EOF'
  const P = historyPaths(home);
  if (process.platform === 'darwin' || readRole(P) === 'server') {
EOF
cat > "$SCRATCH/new" <<'EOF'
  const P = historyPaths(home);
  const early = { session: process.env.CCRC_RECALL_SESSION ?? null, arm: process.env.CCRC_RECALL_ARM ?? null, asof: process.env.CCRC_RECALL_ASOF ?? null };
  if (process.env.TMUX_PANE === undefined && recallSeamEngaged(early)) return readContextEnv(home, P, parsed, nowMs, seen, early, null);
  if (process.platform === 'darwin' || readRole(P) === 'server') {
EOF
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'seam ladder')
restore
# Predicted RED: 1 failed, at 'row 0, a server role': expected [ 2, 'headless-unarmed' ] to deeply equal [ 9, undefined ].
```

The other mutants, each its own call in M1's shape (`old` → `new`; file; filter; predicted red):

- **M2 (W2-D45: the headless path only when a value is set).** cli.mjs. old: `  if (recallSeamEngaged(recall)) return readContextEnv(home, P, parsed, nowMs, seen, recall, pane);` new: `  if (recall !== null) return readContextEnv(home, P, parsed, nowMs, seen, recall, pane);` Filter: `seam ladder|a seam variable takes the headless path`. Predicted: `2 failed`: the ladder at `empty values are unset`, case (b) at its first `CONTROL, nothing set` row, each `[ 1, undefined ]` for `[ 2, 'no-identity' ]`: with no value set, `decideHeadless` answers the tmux path, and `readContextEnv`'s fail-closed line throws, an uncounted defect. Record each measured answer.
- **M3 (W2-D46, R5: no line before admission, step 4).** cli.mjs. old: `    if (!fam.ok) return refusal(fam.rc, fam.reason, storeId, null, null);` new: `    if (!fam.ok) return refusal(fam.rc, fam.reason, storeId, id, null);` Filter: `seam ladder`. Predicted: `1 failed`, at `step 4, an ASOF no row has: a counter line iff step 4 admitted the family`: expected 1 to be 0.
- **M4 (W2-D46: no line before admission, step 1).** cli.mjs. old: `  if (!head.ok) return refusal(head.rc, head.reason, null, null, null);` new: `  if (!head.ok) return refusal(head.rc, head.reason, null, typeof recall.session === 'string' && recall.session !== '' ? recall.session : null, null);` Filter: `seam ladder`. Predicted: `1 failed`, at `step 1, no marker (C30)`'s counter line: expected 1 to be 0.
- **M5 (W2-D40: the environment's generation).** cli.mjs. old: `    const gen = fam.generation;` new: `    const gen = resolveGeneration({ envGen: process.env.CCRC_SESSION_GENERATION ?? null, regGen: regPresence(P, id, 'generation') }).value ?? fam.generation;` Filter: `seam reuse`. Predicted: `1 failed`, at its first row: `[ 3, undefined ]` for `[ 0, undefined ]` (the scope is (X, G2), which holds no `zqseamxpre`).
- **M6 (W2-D40: the registry's generation).** cli.mjs. old as M5. new: `    const gen = resolveGeneration({ envGen: null, regGen: regPresence(P, id, 'generation') }).value ?? fam.generation;` Filter: `seam reuse`. Predicted: as M5.
- **M7 (W2-D40: the newest family).** cli.mjs. old as M5. new: `    const gen = null;` Filter: `seam reuse`. Predicted: as M5 (the newest family of X is (X, G2)).
- **M8 (W2-D40: `--session <own id>` reads the resolved generation).** cli.mjs. old: `      kind: verdict.kind, id: verdict.id, generation: verdict.generation, project: verdict.project,` new: `      kind: verdict.kind, id: verdict.id, generation: session === null ? verdict.generation : resolveGeneration({ envGen: null, regGen: regPresence(P, verdict.id, 'generation') }).value, project: verdict.project,` Filter: `seam reuse|seam legacy`. Predicted: `2 failed`: reuse at its `--session acct-a-seamx` row (`[ 3, undefined ]`; the default row passes first), legacy at its `--session acct-a-seamlg2` row.
- **M9 (W2-D40: the exact empty key).** cli.mjs. old as M8. new: `      kind: verdict.kind, id: verdict.id, generation: verdict.generation === '' ? null : verdict.generation, project: verdict.project,` Filter: `seam legacy`. Predicted: `1 failed`, at its first LEG2 row: `[ 3, undefined ]` (the newest family, (LEG2, GL9), holds no `zqseamlg2pre`).
- **M10 (D-5767: the workspace anchor from ASOF).** cli.mjs. old: `        workdir: fam.anchor === null ? ABSENT : { state: 'value', value: fam.anchor },` new: `        workdir: regPresence(P, id, 'workdir'),` Filter: `seam workspace`. Predicted: `1 failed`: gens `[]` for `[ 'acct-a-seamof:…e203', 'acct-a-seamx:…e201' ]` (the registry's workdir reaches OL alone, which the cut hides).
- **M11 (D-5767: no realpath at read).** cli.mjs. old: `      workdir: verdict.workdir, workdirReal: verdict.workdir,` new: `      workdir: verdict.workdir, workdirReal: typeof verdict.workdir === 'string' ? realOrNull(verdict.workdir) : null,` Filter: `seam workspace`. Predicted: `1 failed`: `[ 6, undefined ]` for `[ 0, undefined ]` (the anchor no longer resolves, so no family matches).
- **M12 (W2-D46 step 5).** cli.mjs. old: `    const gate = decideHeadlessRead({ recallOff: decideRecallOff({ file: recallOffPresence(home, id), generation: gen }), arm: head.arm });` new: `    const gate = decideHeadlessRead({ recallOff: 'none', arm: head.arm });` Filter: `seam ladder`. Predicted: `1 failed`, at `step 5, recall-off naming G1 (C30)`: `[ 0, undefined ]` for `[ 8, undefined ]`.
- **M13 (W2-D46 step 5 against the resolved generation, not the registry's).** cli.mjs. old as M12. new: `    const gate = decideHeadlessRead({ recallOff: decideRecallOff({ file: recallOffPresence(home, id), generation: resolveGeneration({ envGen: null, regGen: regPresence(P, id, 'generation') }).value ?? '' }), arm: head.arm });` Filter: `seam ladder|seam reuse`. Predicted: `2 failed`: the ladder at step 5 (`[ 0, undefined ]`), reuse at its stale row (`[ 8, undefined ]` for `[ 0, undefined ]`).
- **M14 (W2-D46: step 6 after admission).** cli.mjs. old: `    const fam = decideAsOfFamily({` new: two lines, `    if (head.arm === 'control') return refusal(EXIT.RECALL_OFF, undefined, storeId, null, null);` then the old line. Filter: `seam ladder`. Predicted: `1 failed`, at `step 4 before step 6: ARM=control on an unlisted pair is not 8`: `[ 8, undefined ]` for `[ 2, 'headless-unlisted' ]`.
- **M15 (W2-D46 step 7: the cut set).** cli.mjs. old: `        sessionPks: families.map((f) => f.sessionPk), transcriptPks, families, cut: cut.cut,` new: `        sessionPks: families.map((f) => f.sessionPk), transcriptPks, families, cut: null,` Filter: `seam cut|seam widened`. Predicted: `2 failed`: cut at `under ASOF=N the row after N is absent` (`[ 0, undefined ]` for `[ 3, undefined ]`), widened at `families_total` (4 for 2).
- **M16 (R5a: D-5765's store half answered at step 7, counted).** cli.mjs. old: `    if (!cut.ok) return refusal(cut.rc, cut.reason, storeId, id, gen);` new: `    if (!cut.ok) cut.cut = null;` Filter: `seam cut`. Predicted: `1 failed`, at the NT row: `[ 0, undefined ]` for `[ 2, 'asof-invalid' ]`.
- **M17 (W2-D41's guard called).** cli.mjs. old: `    if (!guard.ok) return refusal(guard.rc, guard.reason, storeId, id, gen);` new: `    // the guard dropped (mutant M17)` Filter: `seam widened`. Predicted: `1 failed`, at `the guard: cross-project`: `[ 0, undefined ]` for `[ 2, 'cross-project' ]`.
- **M18 (C50: decideScope runs with source env).** cli.mjs. old: `      source: SCOPE_SOURCES[1], id, generation: { value: gen, via: fam.via },` new: `      source: SCOPE_SOURCES[0], id, generation: { value: gen, via: fam.via },` Filter: `seam widened`. Predicted: as M17 (a tmux verdict passes the guard).
- **M19 (lib `decideEnvProject`: a verdict with no project passes).** lib.mjs. old: `  if (verdict.source !== SCOPE_SOURCES[1] || verdict.project === null) return { ok: true };` new: `  if (verdict.source !== SCOPE_SOURCES[1]) return { ok: true };` Filter: `seam pure decideEnvProject|seam widened`. Predicted: `2 failed`: pure at `no project used: nothing to compare`, widened at `no registry project: the default scope used none, and reads` (`[ 2, 'cross-project' ]`).
- **M20 (lib `decideEnvProject`: the env path alone).** lib.mjs. old as M19. new: `  if (verdict.project === null) return { ok: true };` Filter: `seam pure decideEnvProject|seam widened`. Predicted: `1 failed | 1 passed`: pure at `CONTROL: the guard is the env path alone`; widened stays green (the CLI calls the guard on the env path only). Named: this guard's only red is the pure row.
- **M21 (lib `decideHeadlessRead`: step 5).** lib.mjs. old: `  if (recallOff === 'off') return { ok: false, rc: EXIT.RECALL_OFF, why: 'recall-off' };` new: `  // step 5 dropped (mutant M21)` Filter: `seam pure decideHeadlessRead|seam ladder`. Predicted: `2 failed`: pure at its first row, the ladder at step 5.
- **M22 (lib `decideHeadlessRead`: step 5 before step 6).** lib.mjs. old: the two lines `  if (recallOff === 'off') return { ok: false, rc: EXIT.RECALL_OFF, why: 'recall-off' };` and `  if (arm !== RECALL_ARMS[1]) return { ok: false, rc: EXIT.RECALL_OFF, why: 'arm' };`; new: the same two lines in the other order. Filter: `seam pure decideHeadlessRead|seam ladder`. Predicted: `1 failed | 1 passed`: pure at `step 5 comes before step 6` (`why: 'arm'`); the ladder stays green: both steps answer exit 8, counted, so the CLI cannot tell them apart (named equivalent at the CLI).
- **M23 (lib `decideHeadlessRead`: fail closed on any other arm).** lib.mjs. old: `  if (arm !== RECALL_ARMS[1]) return { ok: false, rc: EXIT.RECALL_OFF, why: 'arm' };` new: `  if (arm === RECALL_ARMS[0]) return { ok: false, rc: EXIT.RECALL_OFF, why: 'arm' };` Filter: `seam pure decideHeadlessRead`. Predicted: `1 failed`, at `fail closed`. (Unreachable through the CLI: `decideHeadless` refuses such an arm first.)
- **M24 (W2-D44, R1: never through a link).** cli.mjs. old: `  const marker = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));` new: `  const marker = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, true));` Filter: `seam marker read`. Predicted: `1 failed`, at `a link is never followed`: `[ 0, undefined ]`. (Task 1's one-read pin reds on it too; it is not in this filter.)
- **M25 (W2-D47: status ignores the seam).** cli.mjs. old: `  if (verb === 'status') return statusVerb(home, rest);` new: two lines, `  if (verb === 'status' && (process.env.CCRC_RECALL_SESSION ?? '') !== '') return readVerb(home, 'tree', ['--json']);` then the old line. Filter: `seam box verbs`. Predicted: `1 failed`, at `C28 extended, status --json`: `[ 2, 2, 'headless-unarmed' ]` for `[ 0, 0, undefined ]`.
- **M26 (W2-D40: the family is the ASOF epoch's, not the id's).** lib.mjs. old: `      LEFT JOIN sessions s ON s.session_pk = ep.session_pk` new: `      LEFT JOIN sessions s ON s.ccrc_id = (SELECT x.ccrc_id FROM sessions x WHERE x.session_pk = ep.session_pk)` Filter: `seam ladder|seam reuse`. Predicted: `2 failed`: X then has two families, so `decideAsOfFamily` answers `asof-invalid` where the family should be admitted: the ladder at its first admitted row (`step 5`, or an earlier step-4 row whose expected word differs), reuse at its first row. Record the measured first red line.
- **M27 (W2-D40's residual: the harness is still read on env).** cli.mjs. old, two lines: `  // Step 2: the harness (W2-D40's stated residual: a reused id with another harness refuses, fail closed).` and `  const harness = decideHarness(regPresence(P, id, 'harness'));`; new: the comment line and `  const harness = decideHarness(ABSENT);`. Filter: `seam ladder`. Predicted: `1 failed`, at `step 2, an unsupported harness`: `[ 0, undefined ]`, store named.
- **M28 (W2-D46 step 3 before the open).** cli.mjs. old: `  if (!d.read) return refusal(d.exit, d.reason, refusalStoreId(reach, P), null, null);` new: `  // step 3's table skipped (mutant M28)` Filter: `seam ladder`. Predicted: `1 failed`, at `step 3, no store`: not `[ 6, undefined ]` (an exit-5 refusal from the open, or exit 1); record the measured answer.
- **M29 (R5: the store line's refusal is uncounted).** cli.mjs. old: `    if (!storeLine.ok) return refusal(storeLine.rc, storeLine.reason, storeId, null, null);` new: `    if (!storeLine.ok) return refusal(storeLine.rc, storeLine.reason, storeId, id, null);` Filter: `seam ladder`. Predicted: `1 failed`, at `step 4, another store marker: a counter line iff step 4 admitted the family`: expected 1 to be 0.
- **M30 (R3: the store line before the ASOF rows are read).** cli.mjs. old, two lines: `    const storeLine = decideHeadlessStore({ list: head.list, storeId: ownStore });` and `    if (!storeLine.ok) return refusal(storeLine.rc, storeLine.reason, storeId, null, null);`; new: `    // the store line left to decideAsOfFamily (mutant M30)`. Filter: `seam ladder`. Predicted: `1 failed`, at `step 4, another store marker, its ASOF read faulted`: `[ 5, 'store-read-failed' ]` for `[ 2, 'headless-unlisted' ]` (the unfaulted row above it still passes: `decideAsOfFamily` checks the store line first).
- **M31 (W2-D46: step 2 before step 3).** cli.mjs. old, the seven lines from `  // Step 2: the harness (W2-D40's stated residual: a reused id with another harness refuses, fail closed).` through `  if (!d.read) return refusal(d.exit, d.reason, refusalStoreId(reach, P), null, null);`; new: step 3's three code lines (`  const reach = await measureReach(home);`, `  const d = decideCliStore(cliFactsOf(reach));`, the `if (!d.read)` line), then step 2's two (`  const harness = decideHarness(regPresence(P, id, 'harness'));`, the `if (!harness.ok)` line). Filter: `seam ladder`. Predicted: `1 failed`, at `step 2 before step 3: an unsupported harness, and another store's store.id`: `[ 5, 'store-mismatch' ]` for `[ 2, 'harness-unsupported' ]`.
- **M32 (W2-D46: step 1 before step 2).** cli.mjs. old: `  const marker = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));` new: three lines, `  const early = decideHarness(regPresence(P, recall.session, 'harness'));`, `  if (!early.ok) return refusal(early.rc, early.reason, null, null, null);`, then the old line. Filter: `seam ladder`. Predicted: `1 failed`, at `step 1 before step 2: no marker, and an unsupported harness`: `[ 2, 'harness-unsupported' ]` for `[ 2, 'headless-unarmed' ]` (every earlier row's id names no harness file, which `decideHarness` passes, as M27's prediction relies on).
- **M33 (fail closed on a tmux answer).** cli.mjs. old: `  if (head.path !== 'headless') throw new TypeError('readContextEnv: decideHeadless answered the tmux path');` new: `  // fail-closed line dropped (mutant M33)` Filter: `seam source`. Predicted: `1 failed`, at `fail closed: a tmux answer is a defect`. (No spawned answer moves: `readContextIn` dispatches only an engaged seam, so the line is unreachable today and is pinned at the source; with M2's dispatch as well, the answer is still an uncounted exit 1, a TypeError further down.)
- **M34 (R1: the read hoisted above the in-pane refusal).** cli.mjs. old: `  if (!inPane.ok) return refusal(inPane.rc, inPane.reason, null, null, null);` new: two lines, `  const early = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));` then the old line. Filter: `seam source`. Predicted: `1 failed`, at `R1: one read, in cli.mjs, of R1's exact line` (two lines). Every spawned answer is unchanged, which is why this pin reads the source.
- **M35 (R1: the headless path dispatched before the in-pane refusal).** cli.mjs. old: `  const inPane = decideSeamInPane({ pane, recall });` new: two lines, `  if (pane === null && recallSeamEngaged(recall)) return readContextEnv(home, P, parsed, nowMs, seen, recall, pane);` then the old line. Filter: `seam source`. Predicted: `1 failed`, at `readContextEnv is called on one line, readContextIn's dispatch`.
- **M36 (R1: a second read in readContextEnv).** cli.mjs. old: `  const head = decideHeadless({ recall, paneSet: pane !== null, marker });` new: two lines, `  const again = headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false));` then the old line. Filter: `seam source`. Predicted: `1 failed`, at `R1: one read, in cli.mjs, of R1's exact line` (two lines).
- **M37 (W2-D40: no generation read on the env path, used or not).** cli.mjs. old: `  const id = head.session;` new: two lines, the old line, then `  const unusedGen = regPresence(P, id, 'generation');`. Filter: `seam source`. Predicted: `1 failed`, at `W2-D40: readContextEnv reads no generation chain: /'generation'\)/`. (M5 to M7 red a read that is used; this one changes no answer.)
- **M38 (C50: the env path hands decideScope the flags as given).** cli.mjs. old, two lines: `      source: SCOPE_SOURCES[1], id, generation: { value: gen, via: fam.via },` and `      flags: { project: o.project === true, workspace: o.workspace === true, session },`; new: the first line, then `      flags: { project: o.project === true, workspace: false, session },`. Filter: `seam C50`. Predicted: `1 failed`, at its `--workspace` row: `[ 0, 'family' ]` for `[ 0, 'workspace' ]`.

M14's new line quotes an arm word, which Task 1's arm-word scan forbids: that scan is not in M14's filter, and the mutant is restored at once.

Named equivalents, no guard claimed: **the read's bound plus one** (`HEADLESS_LIST_MAX_BYTES + 1` in R1's line): a 65,537-byte marker then reads as a value, and `parseHeadlessList`'s own byte bound refuses it (Task 1's M7 pins that half); **the admission's `storeId` from the fallback** (`const ownStore = storeId;` in place of `const ownStore = meta === undefined ? null : meta.v;`): a store whose meta holds no `store_id` is refused by §8.3's table first, so only lib's hand row (Task 2) can show the difference; **the `merged_into` hop dropped in the SQL** (Task 2's F14 reds it on the real store; no spawned store holds an epoch on a merged row, since `mergeFamily` moves every epoch); **M22 at the CLI** (above).

After the last block:

```bash
for f in ccd/history/cli.mjs ccd/history/lib.mjs; do cmp "$f" ".superpowers/sdd/history-w2-2b/t3/$(basename "$f").orig" || echo "NOT RESTORED: $f"; done
git status --short
```

Expected: the loop prints nothing, and `git status --short` lists exactly this task's four files, modified. If a mutant stays green, its guard does not hold: report it, and never weaken the guard or fit a CONTROL to the mutant. Record each measured red line in the scratch notes, for the commit body.

**Mutants, by guard:**

| Guard (new unless named) | Mutant | Must red | Must stay green |
|---|---|---|---|
| cli: row 0 before the seam (W2-D46) | M1 | seam ladder, row 0 | — |
| cli: the headless path only when a value is set (W2-D45) | M2 | seam ladder (empty values); case (b)'s CONTROL | — |
| cli: no counter line before step 4 (W2-D46, R5) | M3, M4 | seam ladder (step 4; step 1) | — |
| cli and lib: the family from ASOF, never the env's, the registry's or the newest generation (W2-D40, D-5767) | M5, M6, M7, M26 | seam reuse; M26 also the ladder | — |
| cli: `--session <own id>` reads the resolved generation (W2-D40) | M8 | seam reuse (`--session` row), seam legacy | reuse's default row |
| cli: the resolved generation as an exact key (W2-D40) | M9 | seam legacy | — |
| cli: the workspace anchor from ASOF, matched as stored (D-5767) | M10, M11 | seam workspace | — |
| cli: recall-off at step 5, against the resolved generation (W2-D46) | M12, M13 | seam ladder (step 5); M13 also seam reuse | — |
| cli: ARM=control at step 6, after admission (W2-D42, W2-D46) | M14 | seam ladder | — |
| cli: the cut from ASOF on `rc.scope.cut` (W2-D46 step 7) | M15, M16 | seam cut; M15 also seam widened | — |
| cli: the W2-D41 guard, with source env (C50, R7) | M17, M18 | seam widened | — |
| lib `decideEnvProject` | M19, M20 | the pure rows; M19 also seam widened | M20: seam widened |
| lib `decideHeadlessRead` | M21, M22, M23 | the pure rows; M21 also seam ladder | M22: seam ladder |
| cli: the marker's one read (W2-D44, R1) | M24 | seam marker read | — |
| cli: box verbs never read the seam (W2-D47, existing by construction) | M25 | seam box verbs | — |
| cli: the harness still read on env (W2-D40's residual) | M27 | seam ladder (step 2) | — |
| cli: step 3 before the open | M28 | seam ladder (step 3) | — |
| cli: step 4's store-line refusal uncounted (R5) | M29 | seam ladder (step 4, another store) | — |
| cli: the store line before the ASOF rows are read (R3) | M30 | seam ladder (the faulted foreign marker) | the unfaulted foreign-marker row |
| cli: W2-D46's order across steps 1, 2 and 3 | M31, M32 | seam ladder (the two pair rows) | — |
| cli: fail closed on a tmux answer | M33 | seam source | every spawned case |
| cli: the one marker read, in `readContextEnv`, dispatched once, after the in-pane refusal (R1) | M34, M35, M36 | seam source | every spawned case |
| cli: `readContextEnv` reads no generation chain (W2-D40) | M37 | seam source | — |
| cli: `decideScope`'s flags on env as given (C50) | M38 | seam C50 | — |

`seen.arm = head.arm;` and the `seen` literal's `arm: null` have no red here: nothing reads them until Task 4, whose mutants A7 and T1 red them.

- [ ] **Step 8: Run the neighbours that read these files.** Run each in the foreground with a timeout of at least 600000 ms, one per tool call, from the repository root. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes: `typecheck-tests` and `session-hook` are among them).

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the read verbs: identity|the read verbs: --session|HA2: --json carries the hint')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'process.env is read by name|seam names are each read once|operator switches have readers only|writes a switch through its symbolic spelling|the headless marker and the arm words')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
```

Expected: green. The predictions, by file:
- **`history-cli`**: the base count plus 14. W2-2a's in-pane cases (a) and (c) are unchanged (a pane is refused before the headless branch, and a fourth `CCRC_RECALL_*` name is still not read); case (b) is the edited one.
- **`history-recall`'s two read-verb describes and HA2**: unchanged. `scrubbedEnv` removes every `CCRC_RECALL_*`, so C1, C3, C4 (no-pane half), C48, C5, C24 and C46 take the tmux path; HA2's defect and counter cases keep their counts (the tmux path's lines are byte-identical).
- **`single-definition`**: unchanged counts. The allow-list holds the seven names (this task reads no new one), each seam name is still read once, dotted, in cli.mjs alone, the `headless-on` holders stay `['ccd/history/lib.mjs']`, no `.mjs` line pairs a write verb with a switch symbol, and Task 1's one-read pin admits R1's line.
- **`history-lib`**: the count after Task 2; C50 runs under both members.
- **`typecheck-tests`**: the new cases type through their casts and `lib.d.mts`' declarations. A red names a declaration mismatch: fix the declaration, never the test.
- **`citations`**: no numeric line citation was added (D-5893).

Compare each count with Step 1's notes.

- [ ] **Step 9: Commit.** This task defines no departure, so `## Deviations found` is not touched.

```bash
cat > .superpowers/sdd/history-w2-2b/t3/commit-msg.txt <<'EOF'
feat(history): the read verbs take the headless path in W2-D46's order, counted once admitted (W2-2b Task 3; W2-D40, W2-D41, W2-D45, W2-D46, W2-D47; D-5767)

The one in-place test edit of history-cli: W2-2a Task 5's no-pane case now answers headless-unarmed (W2-D46; R8).
<each mutant's measured red line from Step 7, M1 to M38, one line each, its mutant first>
<the named equivalents: the read's bound plus one, the admission storeId fallback, the SQL hop, M22 at the CLI>
<the passing counts of Steps 6 and 8>
<any re-anchoring Step 1 or Step 7 needed, or: no re-anchoring>

<the attribution line the session's reminder names>
EOF
```

Replace each `<…>` line with what it names, from the scratch notes. Then:

```bash
for f in ccd/history/cli.mjs ccd/history/lib.mjs; do cmp -s ".superpowers/sdd/history-w2-2b/t3/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
grep -c '^<' .superpowers/sdd/history-w2-2b/t3/commit-msg.txt
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/cli.mjs server/test/history-cli.test.ts
git status --short
git commit -F .superpowers/sdd/history-w2-2b/t3/commit-msg.txt
git status --short
```

Expected: the loop prints nothing (a `NOT RESTORED` line stops the commit: report it); then `0` (no placeholder left); then `git status --short` lists exactly these four files, modified, before the commit, and nothing after it. Nothing under `.superpowers/` appears: it is gitignored.

**Not in this task:** the vocabulary, the marker's grammar and fold, the two `REASON_ROWS` words and O14's three `VOCABS` names (Task 1); `decideHeadless`, `decideHeadlessStore`, `asOfFamilySql`, `decideAsOfFamily` and `GenerationChoice`'s `'asof'` (Task 2); `recallLine`'s `arm`, its carriage to the counter and the drain's `recall_off_stale` skip (Task 4, R4); the `history-switches` lifecycle row and its pin (W2-D49) and README's seam paragraph (Task 5); the spec errata E2, E7, E8, E9 and E10, which W2-5b amends, never this PR; the driver's env (W2-D50), which W2-4 and W2-5b assert; the gate's `arm IS NULL` window (W2-3, W2-D13).

---

### Task 4: a counted env call carries its arm, and the drain skips recall_off_stale for it (W2-D43, W2-D46's counting rule)

W2-D43 gives this task the counter line's `arm`. Spec §8.1 already says it: "Replay runs add `"arm":…` and are excluded from live counters (§10.2)" (about :1492 at `d119d6e90`). Three changes, one commit:
- **cli.mjs `recallLine` is the single writer of `arm`.** A counted env call passes the `RECALL_ARMS` word its step 1 admitted, and the line carries it. A tmux call passes none: absent and `null` both mean none. Any other value answers `null`, so no line is written. Dropping the word instead would count an eval call as a live one, the C-R hazard. `gen` rides exactly as today: only when the resolved generation has the UUID grammar, so a legacy `''` family's arm line carries none (decisions section 7 names that residual).
- **cli.mjs carries the arm from the env branch's admission to the counter.** Task 3's `seen` holds `arm: null`, and its env branch sets `seen.arm = head.arm;` on the line that admits the family at step 4, beside `seen.id` and `seen.gen` (R4). This task makes `readContext` stamp `seen.arm` on every answer it returns, a refusal included, `ReadDefect` carry it, and `readVerb` hand it to `countRecall`. The tmux branch never sets it.
- **sweep.mjs's drain skips the `recall_off_stale` bump for any line carrying `arm`** (`applyEventLine`'s recall arm). Such a line is no live observation, so the drain reads no `recall-off/<id>` file for it. The `recall_calls` row is inserted exactly as today, its `arm` column filled from the line. The drain already did that before this task. The spool's `arm` grammar is not narrowed (R6).

**No schema change and no new counter (W2-D10).** The spool grammar already admits `arm` (lib.mjs `SPOOL_KEYS.recall`'s optional keys and `SPOOL_VALUE.arm`, `/^[a-z]{1,16}$/`). `recall_calls.arm` is a v1 column (store.mjs's DDL, `ms INTEGER NOT NULL, arm TEXT`), and the drain inserts `rec.arm ?? null`. So this task edits no lib.mjs, store.mjs or lib.d.mts line. §8.2's "Uses are counted `scope_source=env`" (about :1529 at `d119d6e90`; the decisions document cites :1528) **reads as** `recall_calls.arm IS NOT NULL`. That is an erratum, not a departure. E10 records it, and W2-5b amends the spec, never this PR. `recallLine`'s doc comment says so in words.

**W2-D46's counting rule, made true and pinned here.** "A counter line is written iff step 4 admitted the family. Under history-off, nothing is written." Today `readVerb` counts every answer whose `id` is a string (D-5023: "one counter line per identity-resolved read call, whatever its exit"). On the tmux path that includes a harness refusal, which carries the id (`refusal(harness.rc, harness.reason, null, id, null)`). On the env path, Task 3's branch passes `null` as the id of every refusal before step 4's admission and the session id after it, so the same `readVerb` rule writes a line iff step 4 admitted. This task does not move that rule. It pins it, with step 4's own refusals uncounted (R5):
- spawned, step by step through W2-D46's order, from step 1's first row to step 4's two refusals, with step 3's failed open and `decideStatusRead` refusal, and a defect and a failed read of the ASOF rows before the admission (no id, so no line: a defect leaves bare, rc 1);
- with a CONTROL one step later (step 5, recall-off, exit 8), which writes exactly one line, carrying its arm;
- with mutants on Task 3's step-2, step-3 and step-4 refusals and on where its admission takes the id (C1 to C5).

History-off is `countRecall`'s existing first line (`existsSync(historyPaths(home).off)`), now pinned on the env path too.

**The C-R pin, in history-cli.test.ts.** The task text names `deploy/history-gate.mjs` as the module that filters `arm IS NULL`. At `d119d6e90` it does not. The filter is W2-D13's: `deploy/measure-history.py`'s `family_report` selects `calls` with `AND arm IS NULL`. history-gate.mjs's `CallRow` is "one recall_calls row with arm NULL", and its `buildWindows`, `windowOf`, `windowTotals` and `splitAtFirstExit8` window those rows. So the pin runs W2-3's merged pipeline exactly as W2-1's RP8 does (history-recall.test.ts, "RP8 end to end"):
- `python3 -I -B deploy/measure-history.py` over the store, read-only;
- then the gate's functions, through a dynamic `import()`.

It edits neither file. The pin is one family that is both listed in `headless-on` (a quiz family) and in the measure's families list (a live A/B family, the treatment side: no recall-off file). It carries three calls:
1. one live tmux call;
2. one env `ARM=treatment` call;
3. one env `ARM=control` call (exit 8).

The live call alone reaches the measure's `calls`, the window and the first-exit-8 split. The CONTROL is the same window over every row of the family, the arm filter dropped: it counts all three, and finds the control arm's exit 8. The pin needs nothing from W2-5b, so it lands here.

**No D-number.** This task defines no departure. W2-D43 is marked "no" in section 3 E, and the erratum E10 is W2-5b's. The task cites D-5023 (the counter's defect rule, whose comment it edits in place), D-4228 (the sweep comment it extends), and D-5893 and D-6178 (the citation ratchet and the armed growth check, which it runs). Each is cited bare.

**Order.** The task runs after Tasks 1 to 3 and needs from them:
- `RECALL_ARMS` and the two new words (Task 1);
- the marker grammar (Task 1), which this task's fixtures write by hand;
- the deciders (Task 2) and the env branch in `readContextIn` in W2-D46's order, with W2-D40's identity, W2-D41's scope, step 7's cut and the admission's `seen.arm` (Task 3).

It touches none of their regions: its mutants A7 and T1 red Task 3's `seen.arm` line and `seen` literal, C1 and C2 Task 3's step-2 and step-4 refusals, C3 the place Task 3 takes the id (the admission, never earlier), and C4 and C5 Task 3's failed open and `decideStatusRead` refusal. Line numbers below are hints measured at `d119d6e90`. Step 1 asserts each anchor by content, and re-anchors on the line that now makes the same decision if Tasks 1 to 3 moved one.

**Files:**
- Modify: `ccd/history/cli.mjs`:
  - the read verbs' lib import line `  decideRecallOff, parseSpoolLine,` (about :60) gains ` RECALL_ARMS,` at its end, in place (Task 3 imports no `RECALL_ARMS` into cli.mjs);
  - `recallLine`'s doc comment and body (about :600-614): one sentence block added to the comment, and four lines after `  rec.ts = i.ts;`;
  - `countRecall`'s one-line doc comment `/** One counter line per identity-resolved read call, whatever its exit. */` (about :646), replaced in place by three lines;
  - `ReadDefect` (about :660-667): its doc comment's last sentence, the constructor's parameter list, and one line after `    this.gen = gen;`;
  - `readContext` (about :672-680): the `return await readContextIn(…)` line and the `ReadDefect` construction (Task 3 owns the `seen` literal);
  - `readVerb` (about :865-895): the two `who = { … }` literals and the `countRecall(…)` call in its `finally`;
- Modify: `ccd/history/sweep.mjs`, in `applyEventLine`'s recall arm (about :830-831): the comment line `    // This is a live drain observation after line/registry generation joining; replay never re-observes controls.` gains a second line, and the bump line gains `typeof rec.arm !== 'string' && ` after `c.replay !== true && `.
- Test: `server/test/history-cli.test.ts`. Append two describes at the end of the file, both skipped on darwin:
  - one with 4 cases: the `recallLine` vocabulary (in a child process, because importing cli.mjs sets the importing process's umask; history-recall's C1 probe is the precedent); the step ladder; the defect and the legacy family; and history-off;
  - one with the C-R pin.

  No import line is added. Every helper is reached through the file's `healthHh` namespace or its existing named imports and module-level helpers (`spawnSync`, `pathToFileURL`, `DatabaseSync`, `CLI`, `REPO`, `PRELOADS`, `makeHistoryBox`, `runSweep`, `hist`, `dbFile`, `storeIdOf`, `ID`, `G1`). `historyFixtures.js` and `deploy/history-gate.mjs` are reached through a dynamic `import()`.
- Test: `server/test/history-sweep.test.ts`. Append one describe at the end of the file, with 2 cases: the in-process drain decision, and the same decision drained by the pass. No import line is added. `applyEventLine` and `spoolLine`/`plantSession` come through dynamic `import()`s, the precedent of history-recall's C68 replay case.
- Not edited:
  - lib.mjs, lib.d.mts, store.mjs, recall.mjs, derive.mjs, regex-worker.mjs;
  - `deploy/**` (`history-gate.mjs` and `measure-history.py` are run read-only);
  - the spec;
  - README.md (Task 5's);
  - `shared/lifecycle.ts`, `ccd/session-hook.sh`, `ccd/ccd`, `.github/**`;
  - `ccd/history-skill/SKILL.md`;
  - history-recall.test.ts (its C24, C68 and F6 cases re-run unedited in Step 9).

**Interfaces:**
- Consumes (at the base, unchanged):
  - cli.mjs:
    - `recallLine(i)`, exported, called once, by `countRecall`;
    - `countRecall(home, i)`, which returns at once when `historyPaths(home).off` exists;
    - `writeRecallLine`;
    - `readVerb`'s count rule: `if (who !== null && typeof who.id === 'string') countRecall(…)`;
    - `ReadDefect`;
    - `readContext(home, verb, parsed, nowMs)`;
    - `refusal(exit, reason, storeId, id, gen)`, whose `id` is read only by `readVerb`'s count rule.
  - lib.mjs:
    - `UUID_RE`, and `parseSpoolLine`, which admits `arm` as an optional key whose value matches `/^[a-z]{1,16}$/`;
    - `historyPaths(home)`'s `off`, `spool`, `recallOffDir` and `dbFile`;
    - `decideRecallOff`.
  - sweep.mjs: `applyEventLine(db, c, ev)`, exported; `recallOffPresence`; the module-private `bump`.
  - deploy, read-only:
    - `measure-history.py`'s `--families FILE --window-start MS --window-end MS --row-cap N` mode, which prints `{w2: {families: [{ccrc_id, generation, found, merged_generations, calls, boundaries}]}}`;
    - `history-gate.mjs`'s `ROW_CAP`, `buildWindows(family)`, `windowOf(boundary, calls)`, `windowTotals(windows)` and `splitAtFirstExit8(calls) → {upTo, after}`.
  - Tests:
    - `historyHelpers.ts`: `makeHistoryBox`, `runSweep`, `runCli`, `withPane`, `seedFamily`, `plantSession`, `spoolLine`, `counters`, `PRELOADS.faults`, whose `HISTORY_TEST_THROW_PREPARE=<kind>@<substring>` throws when a statement holding `<substring>` is prepared (`TypeError`, or `SqliteError:<msg>` carrying `ERR_SQLITE_ERROR`), and whose `HISTORY_TEST_FAIL_QUERY_ONLY=<n>` fails the n-th reader open (`openReader`'s `PRAGMA query_only = ON`);
    - `historyFixtures.ts`: `compactionSequence` and `assistantRow`.
- Consumes (from Tasks 1 to 3 of this plan; Step 0 stops if one is missing):
  - lib.mjs: `export const RECALL_ARMS = Object.freeze(['control', 'treatment']);` and `REASONS['headless-malformed'] === 2`, `REASONS['headless-arm-unknown'] === 2` (Task 1, W2-D42, W2-D48).
  - The marker grammar (Task 1, W2-D44): the first non-comment line `store <store_id>`, then one `<ccrc_id> <generation>` per line, with the generation a lowercase UUID or `-`. This task's fixtures write that text by hand, deliberately not through `formatHeadlessList`: these cases test the counter, and a fixture built by the formatter under test could hide a formatter defect.
  - cli.mjs's env branch in `readContextIn` (Task 3, W2-D46):
    - every refusal it answers before step 4's admission passes `null` as its id and gen;
    - at the admission (after `decideAsOfFamily`'s ok verdict, which includes the store-line check), it sets `seen.id` to the session id, `seen.gen` to the resolved generation (`''` for a legacy family) and `seen.arm` to `head.arm` (R4); `readContext`'s `seen` starts as `{ id: null, gen: null, arm: null }`;
    - every answer after the admission passes the session id and the resolved generation;
    - at step 7 it builds the context's `pairIdx` with `pairIndexOf(db, home)`, the tmux branch's call and the read path's one statement over `redact_hashes` (the defect case's fault needle);
    - `head` is the binding of `decideHeadless`'s ok answer, whose `session` is the id and `arm` the admitted `RECALL_ARMS` word;
    - its step-2 and step-4 refusals are `  if (!harness.ok) return refusal(harness.rc, harness.reason, null, null, null);` and `    if (!fam.ok) return refusal(fam.rc, fam.reason, storeId, null, null);` (its store-line refusal, `storeLine`'s, passes null too);
    - its step-3 failed open and `decideStatusRead` refusal are `    const f = readFailure(e, refusalStoreId(reach, P), null, null);` and `    if (rd.reason !== undefined) return refusal(rd.exit, rd.reason, storeId, null, null);`, and `  const id = head.session;` takes the id from `decideHeadless`'s answer without setting `seen.id`.
  - The answers this task's ladder walks, each Task 3's:
    - step 1's `headless-unarmed`, `headless-malformed`, `no-identity`, `bad-id`, `headless-unlisted`, `headless-arm-unknown` and `asof-invalid` (D-5765's word);
    - step 2's `harness-unsupported`;
    - step 3's `[5, 'store-mismatch']` and `[5, 'store-unmeasured']` (the table; the second by `HISTORY_TEST_FAIL_QUERY_ONLY=1`, which fails the first reader open, `measureReach`'s `peekStoreId` inside `measureStoreFacts`), `[5, 'store-read-failed']` (the read-only open, failed by the faults preload's `HISTORY_TEST_FAIL_QUERY_ONLY=2`: `readContextEnv`'s `openReader` is the second reader open on this path, as the preload's header counts status's) and `[5, 'store-schema-missing']` (`decideStatusRead`, on a store set to `user_version` 0 and restored);
    - step 4's `asof-invalid` and `headless-unlisted`, and, before the admission, an exit-1 defect and `[5, 'store-read-failed']` from a fault planted on `asOfFamilySql`'s text;
    - step 5's and step 6's `[8, undefined]`.
- Produces:
  - cli.mjs:
    - `export function recallLine(i: { id, gen, cmd, rc, ms, ts, arm?: string | null }): string | null`. With `arm` absent or `null` the line is today's. With `arm` in `RECALL_ARMS` the line gains `"arm":"<word>"`. With any other `arm` (`''` included) the answer is `null`.
    - `readContext`'s every answer, refusal or context, carries `arm: string | null`: `seen.arm`, set only by Task 3's env branch at step 4's admission.
    - `ReadDefect` gains a fourth constructor parameter and field, `arm`.
    - `readVerb`'s `who` is `{ id, gen, arm }`, and `countRecall` receives `arm`.
  - sweep.mjs: `applyEventLine` bumps `recall_off_stale` only for a live line, `c.replay !== true`, carrying no `arm`, that `decideRecallOff` reads as `'stale'`. It reads no `recall-off` file for an arm line.
  - No new export, constant, word, counter, column or file.

**Choices this task makes:**
- **An unknown arm writes no line, rather than a line without one.** `readVerb` never passes one: the env branch admits only a `RECALL_ARMS` word (W2-D42), and the tmux branch passes `null`. So the branch is a defect's, and its safe failure is an uncounted call, never an eval call counted live. `''` is no exception. W2-D45's "empty means unset" is about the env variables, which the env branch reads. A `''` at `recallLine` would mean a caller passed the raw variable, and the spawned tmux case with `CCRC_RECALL_ARM=''` in a pane pins that the tmux path passes `null`.
- **The arm rides on `seen`, stamped in `readContext` (R4).** It is not threaded through every `refusal(…)` call of Task 3's branch. Task 3's one assignment at the admission, this task's one stamp, and one `ReadDefect` field cover every counted env answer:
  - step 5's and step 6's exit 8;
  - step 7's scope refusals and `not-indexed`;
  - the verb's own result;
  - a defect after the admission (rc 1).

  The tmux branch has no such line, so no tmux answer can carry one.
- **The drain's skip is presence, not vocabulary (R6).** W2-D43 says "any line carrying `arm`". The spool grammar admits any `/^[a-z]{1,16}$/` word, and the drain keeps the word it got. A same-user writer can forge any spool line already (spec §8.1: policy, not an OS wall), so a narrower test buys nothing. The skip sits before `decideRecallOff`, so an arm line costs no file read.
- **The ladder walks W2-D46's order in one box.** Each row breaks exactly one condition, asserts the word at its step, and asserts the spool unchanged, every file and every byte, so a line written under any id is caught. It then restores the condition. The rows after the admission each assert one new line and its fields. The tmux CONTROL closes the ladder in the same box and family.

**Residuals, named:**
- **A legacy `''` family's arm line carries no `gen`** (decisions section 7). The drain joins it to the registry's observed generation (`joinGeneration`), which for a purged and reused id can be the new family's. `arm IS NOT NULL` excludes it from every live statistic, and no gate statistic reads it. The legacy case below pins the line's key set.
- **A defect before step 4's admission is not counted.** `seen.id` is still null there, so `readContext` rethrows it bare and `readVerb` writes no line. That is W2-D46's rule, pinned by the ladder's step-4 defect row (mutant C3: taking the id before the admission, as the tmux path does after its harness, would count it with no arm). A defect after the admission is counted, rc 1, with its arm.

**Security doors this task owns.** Its door is the counter line and the live counters downstream of it:
- an eval call must never count as a live one: the arm is written on every counted env answer, the C-R pin runs it through the gate's window, and an unknown arm writes nothing;
- a refusal, a failed read or a defect before step 4's admission must never leave a line (the ladder, every spool file compared byte for byte);
- under history-off nothing is written (the history-off case, and C24 re-run);
- the drain must not bump a live counter for an eval line (history-sweep's two cases).

Each has a CONTROL on the same fixture: the tmux call in the same family carries no arm and is counted, the arm-less line on the same stale file bumps once, and the same env call without the switch writes its line.

- [ ] **Step 0: Check the base and Tasks 1 to 3.** From the repository root, before any edit:

```bash
grep -c "^export function asOfCutOf(rc, asof) {$" ccd/history/recall.mjs
grep -c "^export const RECALL_ARMS = Object.freeze(\['control', 'treatment'\]);$" ccd/history/lib.mjs
grep -c "'headless-malformed'" ccd/history/lib.mjs
grep -c "'headless-arm-unknown'" ccd/history/lib.mjs
grep -c "^export function decideHeadless(" ccd/history/lib.mjs
grep -c "^export function decideAsOfFamily(" ccd/history/lib.mjs
grep -n "^export const SCOPE_SOURCES" ccd/history/lib.mjs
grep -n "decideHeadless(\|decideAsOfFamily(\|asOfCutOf(" ccd/history/cli.mjs
```

Expected:
- `1` for the first two lines, and at least `1` for each of the next four. W2-2a's store half is on the base, and Task 1's constant and words and Task 2's deciders exist.
- `SCOPE_SOURCES` reads `Object.freeze(['tmux', 'env'])` (Task 3).
- cli.mjs calls `decideHeadless`, `decideAsOfFamily` and `asOfCutOf` (Task 3).

On any other answer, make no edit and report to the coordinator: this task's ladder walks Task 3's branch.

- [ ] **Step 1: Confirm the anchors, Task 3's contract, and the base counts.** From the repository root:

```bash
grep -c "^export function recallLine(i) {$" ccd/history/cli.mjs
grep -c "^  rec.ts = i.ts;$" ccd/history/cli.mjs
grep -c "^ \*  spool grammar would reject (parseSpoolLine) is never written: the answer is null. \*/$" ccd/history/cli.mjs
grep -c "^/\*\* One counter line per identity-resolved read call, whatever its exit. \*/$" ccd/history/cli.mjs
grep -c "^  constructor(cause, id, gen) {$" ccd/history/cli.mjs
grep -c "^    this.gen = gen;$" ccd/history/cli.mjs
grep -c "^ \*  identity-resolved call. \`cause\` is the thrown value itself. \*/$" ccd/history/cli.mjs
grep -c "^  const seen = { id: null, gen: null, arm: null };$" ccd/history/cli.mjs
grep -c "^    return await readContextIn(home, verb, parsed, nowMs, seen);$" ccd/history/cli.mjs
grep -c "^    if (typeof seen.id === 'string') throw new ReadDefect(e, seen.id, seen.gen);$" ccd/history/cli.mjs
grep -c "^      who = { id: x.id, gen: x.gen };$" ccd/history/cli.mjs
grep -c "^    who = { id: ctx.id, gen: ctx.gen };$" ccd/history/cli.mjs
grep -c "countRecall(home, { id: who.id, gen: who.gen, cmd: verb, rc: exit, ms: Date.now() - t0, ts: Date.now() });$" ccd/history/cli.mjs
grep -c "^  decideRecallOff, parseSpoolLine,$" ccd/history/cli.mjs
grep -c "RECALL_ARMS" ccd/history/cli.mjs
grep -c "^    seen\.arm = head\.arm;$" ccd/history/cli.mjs
grep -c "^    // This is a live drain observation after line/registry generation joining; replay never re-observes controls.$" ccd/history/sweep.mjs
grep -c "^    if (c.replay !== true && decideRecallOff({ file: recallOffPresence(c.home, rec.id), generation: g.generation }) === 'stale') bump(db, 'recall_off_stale');$" ccd/history/sweep.mjs
grep -c "W2-2b Task 4\|zqarmline" server/test/history-cli.test.ts server/test/history-sweep.test.ts
grep -cxF '  if (!harness.ok) return refusal(harness.rc, harness.reason, null, null, null);' ccd/history/cli.mjs
grep -cxF '    if (!fam.ok) return refusal(fam.rc, fam.reason, storeId, null, null);' ccd/history/cli.mjs
grep -cxF '  const id = head.session;' ccd/history/cli.mjs
grep -cxF '    const f = readFailure(e, refusalStoreId(reach, P), null, null);' ccd/history/cli.mjs
grep -cxF '    if (rd.reason !== undefined) return refusal(rd.exit, rd.reason, storeId, null, null);' ccd/history/cli.mjs
awk '/const head = decideHeadless\(/{on=1} on && /refusal\(/{print FNR": "$0} /seen\.id = /{if(on) exit}' ccd/history/cli.mjs
```

Expected, (a) to (f):
- (a) `1` for each of the first fourteen lines (the eighth is Task 3's `seen` literal). If an earlier task rewrote one of them, re-anchor on the line that now holds the same text, and record it.
- (b) The fifteenth line (`RECALL_ARMS` in cli.mjs): `0`.
- (c) `1` for Task 3's `    seen.arm = head.arm;` (R4: Task 3 sets it, this task stamps and writes it).
- (d) `1` for each of the two sweep.mjs lines.
- (e) `0` in both test files for the `W2-2b Task 4` and `zqarmline` line: the names are free.
- (f) `1` for each of Task 3's five lines (C1 to C5's anchors: the step-2 refusal, the step-4 refusal, `const id = head.session;`, the failed open and the `decideStatusRead` refusal), then the awk prints every `refusal(` call of the env branch from `decideHeadless(` up to the admission's `seen.id = `. **Each must pass `null` as its fourth and fifth arguments** (W2-D46: nothing before step 4 is counted). If any printed call passes a non-null id, stop and report: that is Task 3's to fix before this task, and the ladder below would red on it.

Then record the base counts. Run each command in the foreground with a timeout of at least 600000 ms, one per tool call, each from the repository root:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C24: consecutive|C68 |F6: a read that ends')
```

Write each `N passed` (and any `skipped`) into `.superpowers/sdd/history-w2-2b/t4/base-counts.txt` (gitignored), creating the directory first with `mkdir -p .superpowers/sdd/history-w2-2b/t4` (Step 3's notes and Step 8's helpers reuse it). Every file must be green. Re-run a red file alone (CLAUDE.md's load flakes) before reporting it.

- [ ] **Step 2: Write the failing tests.** Three appends, each after its file's last line, never above an existing describe.

(a) `server/test/history-cli.test.ts`: append:

```ts

// ── W2-2b Task 4 (W2-D43, W2-D46): a counted env call carries its arm; nothing before step 4 is counted ────────────
// recallLine (cli.mjs) is the single writer of `arm`: a RECALL_ARMS word on every counted env call, none on a tmux call,
// and no line at all for any other value. A counter line is written iff step 4 admitted the family, and none under
// history-off. The marker is written here in W2-D44's grammar by hand, never through formatHeadlessList: these cases
// test the counter, and a fixture built by the formatter under test could hide its defect.
describe('W2-D43 and W2-D46: the counter line on the env path carries its arm (W2-2b Task 4)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const AL_T = 'e5e5e5e5-5555-4555-8555-555555555555';
  const AL_ID2 = 'acct-b-demo';
  const AL_T2 = 'f6f6f6f6-6666-4666-8666-666666666666';
  const OTHER_STORE = 'abababab-abab-4bab-8bab-abababababab';
  const NOT_STORED = 'c7c7c7c7-7777-4777-8777-777777777777';
  const ENV_KEYS = ['arm', 'cmd', 'ev', 'gen', 'id', 'ms', 'rc', 'ts', 'v'];
  const TMUX_KEYS = ['cmd', 'ev', 'gen', 'id', 'ms', 'rc', 'ts', 'v'];
  type Run = ReturnType<typeof healthHh.runCli>;
  type Line = Record<string, unknown>;
  const ans = (r: Run): unknown[] => [r.code, r.json?.['reason']];
  /** Every regular file under spool/, with its bytes: a refusal before step 4 must leave all of it as it was. */
  const spoolState = (box: HistoryBox): Array<[string, string]> => {
    const dir = hist(box, 'spool');
    return fs.readdirSync(dir).sort().filter((n) => fs.statSync(path.join(dir, n)).isFile())
      .map((n): [string, string] => [n, fs.readFileSync(path.join(dir, n), 'utf8')]);
  };
  const linesOf = (box: HistoryBox, id: string): Line[] => {
    const p = hist(box, 'spool', `${id}.jsonl`);
    return (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Line);
  };
  /** The lines `run` added to spool/<id>.jsonl. */
  const added = (box: HistoryBox, id: string, run: () => Run): { r: Run; lines: Line[] } => {
    const before = linesOf(box, id).length;
    const r = run();
    return { r, lines: linesOf(box, id).slice(before) };
  };
  const writeMarker = (box: HistoryBox, storeId: string, pairs: ReadonlyArray<readonly [string, string]>): void => {
    fs.writeFileSync(hist(box, 'headless-on'), `store ${storeId}\n${pairs.map(([i, g]) => `${i} ${g}\n`).join('')}`);
  };
  let seeded: { box: HistoryBox; asof: string; asofLegacy: string } | null = null;
  /** Two families, each one manual compaction: (ID, G1), and AL_ID2's legacy '' family (a gen-less line, no
   *  $REG/<id>.generation). Captured once for the describe; every case restores what it changes. */
  async function seededBox(): Promise<{ box: HistoryBox; asof: string; asofLegacy: string }> {
    if (seeded !== null) return seeded;
    const fx = await import('./historyFixtures.js');
    const box = makeHistoryBox('ccrc-hist-cli-zqarmline-', { role: 'fleet', shim: true });
    const a = fx.compactionSequence({ n: 1, trigger: 'manual', sessionId: AL_T, seed: 0xe5, tailRows: 0 });
    healthHh.seedFamily(box, { id: ID, project: 'demo', uuid: AL_T, generation: G1, rows: a.rows });
    const b = fx.compactionSequence({ n: 1, trigger: 'manual', sessionId: AL_T2, seed: 0xf6, tailRows: 0 });
    healthHh.seedFamily(box, { id: AL_ID2, project: 'demo', uuid: AL_T2, generation: null, rows: b.rows });
    seeded = { box, asof: a.boundaryUuids[0]!, asofLegacy: b.boundaryUuids[0]! };
    return seeded;
  }

  it('recallLine writes a RECALL_ARMS word or no line at all, and gen only as a UUID (W2-D43)', () => {
    // A child process: importing cli.mjs sets the importing process's umask, so no case imports it in this worker.
    const box = makeHistoryBox('ccrc-hist-cli-recallline-', { role: 'fleet', shim: false });
    const src = [
      `import { recallLine } from ${JSON.stringify(pathToFileURL(CLI).href)};`,
      `const base = { id: ${JSON.stringify(ID)}, cmd: 'tree', rc: 0, ms: 1, ts: 1759312800000 };`,
      `const g = ${JSON.stringify(G1)};`,
      'process.stdout.write(JSON.stringify({',
      '  tmux: recallLine({ ...base, gen: g }),',
      '  tmuxNull: recallLine({ ...base, gen: g, arm: null }),',
      "  control: recallLine({ ...base, gen: g, arm: 'control', rc: 8 }),",
      "  treatment: recallLine({ ...base, gen: g, arm: 'treatment' }),",
      "  legacy: recallLine({ ...base, gen: '', arm: 'treatment' }),",
      "  unknown: recallLine({ ...base, gen: g, arm: 'fixture' }),",
      "  empty: recallLine({ ...base, gen: g, arm: '' }),",
      '}));',
    ].join('\n');
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', src],
      { cwd: box.home, env: box.env, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGTERM' });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, string | null>;
    const keys = (k: string): string[] => Object.keys(JSON.parse(out[k]!) as Line).sort();
    expect(keys('tmux'), 'a tmux call: today\'s line, no arm').toEqual(TMUX_KEYS);
    expect(out['tmuxNull'], 'null means no arm, exactly as absent does').toBe(out['tmux']);
    expect(keys('control'), 'W2-D43: the control arm is written').toEqual(ENV_KEYS);
    expect(JSON.parse(out['control']!)).toMatchObject({ id: ID, gen: G1, rc: 8, arm: 'control' });
    expect(JSON.parse(out['treatment']!)).toMatchObject({ id: ID, gen: G1, rc: 0, arm: 'treatment' });
    expect(keys('legacy'), 'a legacy family: the arm, and no gen (section 7)').toEqual(ENV_KEYS.filter((k) => k !== 'gen'));
    expect(out['unknown'], 'a word outside RECALL_ARMS: no line, never a line without its arm').toBeNull();
    expect(out['empty'], 'an empty arm is no word: no line').toBeNull();
  }, 120_000);

  it('the ladder: each refusal at steps 1 to 4 writes no counter line; each answer after the admission writes one, carrying its arm; the tmux CONTROL carries none', async () => {
    const { box, asof } = await seededBox();
    const sid = storeIdOf(box);
    const marker = hist(box, 'headless-on');
    const env = (o: Record<string, string> = {}): Record<string, string> =>
      ({ CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: asof, ...o });
    const tree = (o: Record<string, string> = {}, args: string[] = []): Run =>
      healthHh.runCli(box, ['tree', ...args, '--json'], { env: env(o) });
    fs.rmSync(marker, { force: true });
    const before = spoolState(box);
    const none = (r: Run, want: unknown[], what: string): void => {
      expect(ans(r), `${what}: ${r.stderr}${r.stdout}`).toEqual(want);
      expect(spoolState(box), `${what}: no counter line before step 4 admits the family (W2-D46)`).toEqual(before);
    };
    // Step 1, in W2-D46's order.
    none(tree(), [2, 'headless-unarmed'], 'step 1, no marker');
    fs.writeFileSync(marker, 'not a marker\n');
    none(tree(), [2, 'headless-malformed'], 'step 1, a malformed marker');
    writeMarker(box, sid, [[ID, G1]]);
    none(tree({ CCRC_RECALL_SESSION: '' }), [2, 'no-identity'], 'step 1, SESSION unset');
    none(tree({ CCRC_RECALL_SESSION: '..' }), [2, 'bad-id'], 'step 1, a bad id');
    writeMarker(box, sid, [[AL_ID2, '-']]);
    none(tree(), [2, 'headless-unlisted'], 'step 1, not on a list line');
    writeMarker(box, sid, [[ID, G1]]);
    none(tree({ CCRC_RECALL_ARM: 'bogus' }), [2, 'headless-arm-unknown'], 'step 1, ARM');
    none(tree({ CCRC_RECALL_ASOF: 'not-a-uuid' }), [2, 'asof-invalid'], 'step 1, the ASOF grammar');
    // Step 2: the harness, still read from $REG/<id>.harness on the env path (W2-D40's residual).
    const harness = path.join(box.reg, `${ID}.harness`);
    fs.writeFileSync(harness, 'codex');
    try { none(tree(), [2, 'harness-unsupported'], 'step 2, the harness'); } finally { fs.rmSync(harness); }
    // Step 3: the store table.
    const storeIdFile = hist(box, 'store.id');
    const savedStoreId = fs.readFileSync(storeIdFile);
    fs.writeFileSync(storeIdFile, `${OTHER_STORE}\n`);
    try { none(tree(), [5, 'store-mismatch'], 'step 3, the store table'); } finally { fs.writeFileSync(storeIdFile, savedStoreId); }
    // Step 3, faulted: the table's own store-id read, then the read-only open, then decideStatusRead. Each refuses
    // before the admission.
    const faults = (o: Record<string, string>): Run =>
      healthHh.runCli(box, ['tree', '--json'], { preloads: [PRELOADS.faults], env: env(o) });
    // The faults preload counts reader opens: n=1 is measureReach's own (measureStoreFacts' peekStoreId), which §8.3's
    // table reads as an unreadable meta store_id; n=2 is readContextEnv's openReader, the CLI's read-only open.
    none(faults({ HISTORY_TEST_FAIL_QUERY_ONLY: '1' }), [5, 'store-unmeasured'], 'step 3, the table: the store id unreadable');
    none(faults({ HISTORY_TEST_FAIL_QUERY_ONLY: '2' }), [5, 'store-read-failed'], 'step 3, the read-only open');
    const userVersionOf = (): number => {
      const w = new DatabaseSync(dbFile(box));
      try { return Number((w.prepare('PRAGMA user_version').get() as { user_version: number }).user_version); } finally { w.close(); }
    };
    const setUserVersion = (n: number): void => {
      const w = new DatabaseSync(dbFile(box));
      try { w.exec(`PRAGMA user_version = ${n}`); } finally { w.close(); }
    };
    const savedVersion = userVersionOf();
    expect(savedVersion, 'CONTROL: the store has a version to restore').toBeGreaterThan(0);
    setUserVersion(0);
    try { none(tree(), [5, 'store-schema-missing'], 'step 3, decideStatusRead'); } finally { setUserVersion(savedVersion); }
    // Step 4: the family from ASOF; a defect and a failed read of its rows, before the admission (a fault planted on
    // asOfFamilySql's own text); then the store line. None admits, so none is counted: the defect leaves bare, rc 1.
    none(tree({ CCRC_RECALL_ASOF: NOT_STORED }), [2, 'asof-invalid'], 'step 4, an ASOF the store does not hold');
    const d4 = faults({ HISTORY_TEST_THROW_PREPARE: 'TypeError@AS into_merged_into' });
    expect(d4.stderr, 'CONTROL: it is the defect arm').toContain('ccrc history: internal error: ');
    none(d4, [1, undefined], 'step 4, a defect before the admission');
    none(faults({ HISTORY_TEST_THROW_PREPARE: 'SqliteError:zqarmline-planted@AS into_merged_into' }), [5, 'store-read-failed'],
      'step 4, a failed read before the admission');
    writeMarker(box, OTHER_STORE, [[ID, G1]]);
    none(tree(), [2, 'headless-unlisted'], 'step 4, another store\'s marker');
    writeMarker(box, sid, [[ID, G1]]);
    // CONTROL, one step later: step 5 (recall-off naming the resolved generation) is after the admission: one line, with
    // the arm and the resolved generation.
    fs.mkdirSync(hist(box, 'recall-off'), { recursive: true });
    fs.writeFileSync(hist(box, 'recall-off', ID), `${G1}\n`);
    const s5 = ((): { r: Run; lines: Line[] } => {
      try { return added(box, ID, () => tree()); } finally { fs.rmSync(hist(box, 'recall-off', ID)); }
    })();
    expect(ans(s5.r), `step 5: ${s5.r.stderr}`).toEqual([8, undefined]);
    expect(s5.lines, 'step 5: exactly one counter line').toHaveLength(1);
    expect(Object.keys(s5.lines[0]!).sort()).toEqual(ENV_KEYS);
    expect(s5.lines[0]).toMatchObject({ v: 1, ev: 'recall', id: ID, gen: G1, cmd: 'tree', rc: 8, arm: 'treatment' });
    // Step 6: ARM=control is exit 8, counted, with its own arm (W2-D42).
    const s6 = added(box, ID, () => tree({ CCRC_RECALL_ARM: 'control' }));
    expect(ans(s6.r), `step 6: ${s6.r.stderr}`).toEqual([8, undefined]);
    expect(s6.lines.map((l) => [l['rc'], l['arm'], l['gen']])).toEqual([[8, 'control', G1]]);
    // Step 7: the verb's own answer, and a scope refusal after the admission, each counted with the arm.
    const s7 = added(box, ID, () => tree());
    expect(ans(s7.r), `step 7: ${s7.r.stderr}`).toEqual([0, undefined]);
    expect(s7.lines.map((l) => [l['rc'], l['arm'], l['gen']])).toEqual([[0, 'treatment', G1]]);
    const s7b = added(box, ID, () => tree({}, ['--session', '..']));
    expect(ans(s7b.r), `step 7, scope: ${s7b.r.stderr}`).toEqual([2, 'bad-id']);
    expect(s7b.lines.map((l) => [l['rc'], l['arm']]), 'a refusal after the admission is counted').toEqual([[2, 'treatment']]);
    // CONTROL: the same family from its pane, no seam: counted, with no arm. Then an empty ARM in the pane: empty is
    // unset (W2-D45), so it is no seam, and the tmux path still writes its line with no arm.
    const pane = healthHh.withPane(box, ID);
    const t = added(box, ID, () => healthHh.runCli(box, ['tree', '--json'], { env: pane }));
    expect(ans(t.r), `tmux: ${t.r.stderr}`).toEqual([0, undefined]);
    expect(t.lines.map((l) => Object.keys(l).sort()), 'W2-D43: never an arm on a tmux call').toEqual([TMUX_KEYS]);
    const te = added(box, ID, () => healthHh.runCli(box, ['tree', '--json'], { env: { ...pane, CCRC_RECALL_ARM: '' } }));
    expect(ans(te.r), `tmux, empty ARM: ${te.r.stderr}`).toEqual([0, undefined]);
    expect(te.lines.map((l) => Object.keys(l).sort()), 'an empty ARM in a pane: counted, no arm').toEqual([TMUX_KEYS]);
  }, 240_000);

  it('a defect after the admission is counted rc 1 with its arm, and a legacy family\'s arm line carries no gen (W2-D43; section 7)', async () => {
    const { box, asof, asofLegacy } = await seededBox();
    writeMarker(box, storeIdOf(box), [[ID, G1], [AL_ID2, '-']]);
    // pairIndexOf, the last read of readContext (step 7), is the one statement over redact_hashes: the throw comes after
    // the admission, inside readContext, so it leaves as a ReadDefect.
    const d = added(box, ID, () => healthHh.runCli(box, ['tree', '--json'], {
      preloads: [PRELOADS.faults],
      env: { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: asof, HISTORY_TEST_THROW_PREPARE: 'TypeError@FROM redact_hashes' },
    }));
    expect(d.r.code, d.r.stderr).toBe(1);
    expect(d.r.stderr, 'CONTROL: it is the defect arm').toContain('ccrc history: internal error: ');
    expect(d.lines, 'the defect: exactly one counter line').toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ ev: 'recall', id: ID, gen: G1, cmd: 'tree', rc: 1, arm: 'treatment' });
    // The legacy family: the resolved generation is '' (W2-D40), so the line carries the arm and no gen.
    const l = added(box, AL_ID2, () => healthHh.runCli(box, ['tree', '--json'],
      { env: { CCRC_RECALL_SESSION: AL_ID2, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: asofLegacy } }));
    expect(ans(l.r), `legacy: ${l.r.stderr}${l.r.stdout}`).toEqual([0, undefined]);
    expect(l.lines.map((x) => Object.keys(x).sort())).toEqual([ENV_KEYS.filter((k) => k !== 'gen')]);
    expect(l.lines[0]).toMatchObject({ id: AL_ID2, rc: 0, arm: 'treatment' });
  }, 240_000);

  it('under history-off nothing is written on the env path either; CONTROL: without the switch the same call writes its line', async () => {
    const { box, asof } = await seededBox();
    writeMarker(box, storeIdOf(box), [[ID, G1]]);
    const env = { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'treatment', CCRC_RECALL_ASOF: asof };
    const off = path.join(box.home, '.ccrc', 'history-off');
    const before = spoolState(box);
    fs.writeFileSync(off, '');
    try {
      const r = healthHh.runCli(box, ['tree', '--json'], { env });
      expect(ans(r), `the CLI still reads under the switch: ${r.stderr}`).toEqual([0, undefined]);
      expect(spoolState(box), 'and writes no line (W2-D46)').toEqual(before);
    } finally {
      fs.rmSync(off);
    }
    const c = added(box, ID, () => healthHh.runCli(box, ['tree', '--json'], { env }));
    expect(ans(c.r), c.r.stderr).toEqual([0, undefined]);
    expect(c.lines.map((l) => [l['rc'], l['arm']]), 'CONTROL: the switch removed, the line is written').toEqual([[0, 'treatment']]);
  }, 240_000);
});

// ── W2-2b Task 4: the C-R pin (W2-D43, W2-D13) ──────────────────────────────────────────────────────────────────────
// A treatment-arm run on a listed family that is also a live A/B family writes a non-null arm, and W2-3's window does not
// count it. The window is W2-3's merged pipeline, run as W2-1's RP8 runs it: measure-history.py's raw rows (its `calls`
// select `arm IS NULL`, W2-D13), then history-gate.mjs's buildWindows, windowTotals and splitAtFirstExit8. Both run
// read-only: the script is spawned isolated (-I) and bytecode-free (-B), and the gate is imported dynamically.
describe('C-R: a treatment-arm run on a live A/B family writes a non-null arm, and the window does not count it (W2-2b Task 4)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const CR_T = 'a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7';
  const CR_MEASURE = path.join(REPO, 'deploy', 'measure-history.py');
  type CrCall = [ts_ms: number, rc: number, verb: string];
  interface CrBoundary { boundary_uuid: string; ts_ms: number; copies: unknown[] }
  interface CrFamily { ccrc_id: string; generation: string; found: boolean; merged_generations: string[]; calls: CrCall[]; boundaries: CrBoundary[] }
  interface CrWindow { state: 'measured' | 'unmeasured'; start_ms: number; end_ms: number | null; end_inclusive: boolean; turns: number; calls: number; with_call: boolean }
  interface CrGate {
    ROW_CAP: number;
    buildWindows(family: CrFamily, k?: number): CrWindow[];
    windowOf(boundary: CrBoundary, calls: CrCall[], k?: number): CrWindow;
    windowTotals(windows: CrWindow[]): { windows: number; with_call: number; calls: number; turns: number; unmeasured: number };
    splitAtFirstExit8(calls: CrCall[]): { upTo: CrCall[]; after: CrCall[] };
  }

  it('C-R: the live call alone is in the measure\'s calls, the window and the first-exit-8 split; CONTROL: with the arm filter dropped, all three are', async () => {
    const fx = await import('./historyFixtures.js');
    const gate = (await import('../../deploy/history-gate.mjs')) as unknown as CrGate;
    const box = makeHistoryBox('ccrc-hist-cli-zqarmline-cr-', { role: 'fleet', shim: true });
    // One manual compaction, then two assistant turns, the second stamped a day past now: fewer than K turns and no next
    // boundary, so the boundary's window ends inclusive at that row and spans every call this case makes (W2-D14).
    const late = Date.now() + 86_400_000;
    const seq = fx.compactionSequence({ n: 1, trigger: 'manual', sessionId: CR_T, seed: 0xa7, tailRows: 0 });
    const rows = [
      ...seq.rows,
      fx.assistantRow({ uuid: 'a7a7a7a7-0000-4000-8000-0000000000f1', ts: '2026-10-01T11:00:00.000Z', sessionId: CR_T,
        text: 'Fixture answer after the summary.', requestId: 'req_cr_1', msgId: 'msg_cr_1' }),
      fx.assistantRow({ uuid: 'a7a7a7a7-0000-4000-8000-0000000000f2', ts: new Date(late).toISOString(), sessionId: CR_T,
        text: 'Fixture answer, stamped late.', requestId: 'req_cr_2', msgId: 'msg_cr_2' }),
    ];
    healthHh.seedFamily(box, { id: ID, project: 'demo', uuid: CR_T, generation: G1, rows });
    const sid = storeIdOf(box);
    // The quiz family is listed (W2-D44's grammar, by hand), and it is a live A/B family on the treatment side: no
    // recall-off file.
    fs.writeFileSync(hist(box, 'headless-on'), `store ${sid}\n${ID} ${G1}\n`);
    const seam = { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ASOF: seq.boundaryUuids[0]! };
    const live = healthHh.runCli(box, ['tree', '--json'], { env: healthHh.withPane(box, ID) });
    expect([live.code, live.json?.['reason']], `the live call: ${live.stderr}`).toEqual([0, undefined]);
    const treat = healthHh.runCli(box, ['tree', '--json'], { env: { ...seam, CCRC_RECALL_ARM: 'treatment' } });
    expect([treat.code, treat.json?.['reason']], `the treatment arm: ${treat.stderr}${treat.stdout}`).toEqual([0, undefined]);
    const ctrl = healthHh.runCli(box, ['tree', '--json'], { env: { ...seam, CCRC_RECALL_ARM: 'control' } });
    expect([ctrl.code, ctrl.json?.['reason']], `the control arm: ${ctrl.stderr}`).toEqual([8, undefined]);
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);   // tick N renames the lines, tick N+1 drains them

    // C-R: the rows hold each call's arm, a non-null one for each eval call.
    const got = ((): Array<{ ts_ms: number; rc: number; verb: string; arm: string | null }> => {
      const db = healthHh.openStoreRO(box);
      try {
        return db.prepare('SELECT ts_ms, rc, verb, arm FROM recall_calls WHERE ccrc_id = ? ORDER BY ts_ms, event_key').all(ID) as
          Array<{ ts_ms: number; rc: number; verb: string; arm: string | null }>;
      } finally {
        db.close();
      }
    })();
    expect(got.map((g) => [Number(g.rc), g.arm]), 'C-R: the live call has no arm, each eval call its own').toEqual([[0, null], [0, 'treatment'], [8, 'control']]);
    const all = got.map((g): CrCall => [Number(g.ts_ms), Number(g.rc), g.verb]);

    // W2-3's window over the listed family.
    const families = path.join(box.home, 'cr-families.json');
    fs.writeFileSync(families, JSON.stringify([{ store_id: sid, ccrc_id: ID, generation: G1 }]));
    const m = spawnSync('python3', ['-I', '-B', CR_MEASURE, '--db', hist(box, 'db', 'history.db'), '--families', families,
      '--window-start', String(Date.parse('2026-10-01T00:00:00.000Z')), '--window-end', String(late + 1), '--row-cap', String(gate.ROW_CAP)],
    { encoding: 'utf8', env: { ...box.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
    expect(m.status, m.stderr).toBe(0);
    const fams = (JSON.parse(m.stdout) as { w2: { families: CrFamily[] } }).w2.families;
    expect(fams.map((f) => [f.ccrc_id, f.generation, f.found])).toEqual([[ID, G1, true]]);
    const fam = fams[0]!;
    expect(fam.calls.map((c) => [c[1], c[2]]), 'C-R: the measure\'s calls hold the live call alone').toEqual([[0, 'tree']]);
    const windows = gate.buildWindows(fam);
    expect(windows.map((w) => w.state), 'one measured window').toEqual(['measured']);
    const w = windows[0]!;
    for (const c of all) expect(w.start_ms <= c[0] && c[0] <= w.end_ms!, `CONTROL: the window spans the call at ${c[0]}`).toBe(true);
    expect(gate.windowTotals(windows).calls, 'C-R: the window counts the live call alone').toBe(1);
    expect(gate.splitAtFirstExit8(fam.calls), 'the control arm\'s exit 8 is no live first exit 8').toEqual({ upTo: fam.calls, after: [] });
    // CONTROL: the same window over every row of the family, the arm filter dropped, counts all three, and the split
    // finds the control arm's exit 8. So only the arm keeps the eval calls out.
    expect(gate.windowOf(fam.boundaries[0]!, all).calls, 'CONTROL: no arm filter').toBe(3);
    expect(gate.splitAtFirstExit8(all).upTo.at(-1)?.[1], 'CONTROL: the unfiltered split stops at the control arm\'s exit 8').toBe(8);
  }, 240_000);
});
```

(b) `server/test/history-sweep.test.ts`: append:

```ts

// ── W2-2b Task 4 (W2-D43): the drain skips the recall_off_stale bump for a line carrying arm ───────────────────────
// recall_off_stale is a live drain observation (§9.7, §9.14). A line carrying `arm` is an eval call, excluded from live
// counters (§8.1, §10.2), so the drain bumps nothing for it and reads no recall-off file. Its recall_calls row is still
// written, with its arm. No schema change and no new counter (W2-D10).
describe('W2-D43: the drain skips the recall_off_stale bump for a line carrying arm (W2-2b Task 4)', () => {
  const ID = 'claude-a-demo';
  const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
  const G4 = '0189abcd-1234-4678-9abc-0123456789ae';
  const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
  interface SweepMod { applyEventLine(db: DatabaseSync, c: object, ev: object): unknown }
  const bound = (prefix: string): HistoryBox => {
    const box = makeHistoryBox(prefix);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    return box;
  };
  /** recall-off/<ID> names G4, another generation than every line's G1: the drain's live read of it is 'stale'. */
  const plantStale = (box: HistoryBox): void => {
    const dir = historyPaths(box.home).recallOffDir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, ID), `${G4}\n`);
  };
  const recLine = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ v: 1, ev: 'recall', id: ID, gen: G1, cmd: 'tree', rc: 0, ms: 1, ts: T0, ...extra });
  const counterRows = (db: DatabaseSync): Array<[string, number]> =>
    (db.prepare('SELECT name, n FROM counters ORDER BY name').all() as Array<{ name: string; n: number }>).map((r): [string, number] => [r.name, Number(r.n)]);
  const staleOn = (db: DatabaseSync): number =>
    Number((db.prepare("SELECT n FROM counters WHERE name = 'recall_off_stale'").get() as { n: number } | undefined)?.n ?? 0);

  it('an arm line on a stale recall-off file bumps nothing and adds no counter, and its row keeps its arm; CONTROL: the same line without arm bumps once', async () => {
    const sweep = (await import('../../ccd/history/sweep.mjs')) as unknown as SweepMod;
    const box = bound('ccrc-history-sweep-zqarmline-');
    plantStale(box);
    const db = new DatabaseSync(historyPaths(box.home).dbFile);
    try {
      const c = { home: box.home, now: () => T0 };
      const ev = (key: string, rec: Record<string, unknown>): object => ({ key, rec, recvMs: T0, tsMs: T0, obs: { generation: { state: 'absent' } } });
      const before = counterRows(db);
      sweep.applyEventLine(db, c, ev('drained.1.1:1', recLine({ arm: 'treatment' })));
      sweep.applyEventLine(db, c, ev('drained.1.1:2', recLine({ arm: 'control', rc: 8 })));
      expect(staleOn(db), 'W2-D43: a line carrying arm is no live observation').toBe(0);
      expect(counterRows(db), 'W2-D10: no counter is bumped or added').toEqual(before);
      // CONTROL: the same file and a line without arm: the drain's live observation reads it as stale.
      sweep.applyEventLine(db, c, ev('drained.1.1:3', recLine()));
      expect(staleOn(db), 'CONTROL: an arm-less line on the same file bumps once').toBe(1);
      const rows = (db.prepare('SELECT event_key, generation, rc, arm FROM recall_calls ORDER BY event_key').all() as
        Array<{ event_key: string; generation: string; rc: number; arm: string | null }>).map((r) => [r.event_key, r.generation, Number(r.rc), r.arm]);
      expect(rows, 'every line is received, each with its arm').toEqual([
        ['drained.1.1:1', G1, 0, 'treatment'], ['drained.1.1:2', G1, 8, 'control'], ['drained.1.1:3', G1, 0, null],
      ]);
    } finally {
      db.close();
    }
  });

  it('drained by the pass: a spooled arm line lands in recall_calls with its arm and bumps nothing; CONTROL: an arm-less line bumps once', async () => {
    const h = await import('./historyHelpers.js');
    const box = bound('ccrc-history-sweep-zqarmline-drain-');
    h.plantSession(box, ID, { generation: G1, project: 'demo' });
    plantStale(box);
    const arms = (): Array<string | null> => {
      const db = openStoreRO(box);
      try {
        return (db.prepare('SELECT arm FROM recall_calls WHERE ccrc_id = ? ORDER BY ts_ms, event_key').all(ID) as Array<{ arm: string | null }>).map((r) => r.arm);
      } finally {
        db.close();
      }
    };
    h.spoolLine(box, ID, recLine({ arm: 'treatment' }));
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);   // tick N renames the line, tick N+1 drains it
    expect(arms(), 'the arm line is received').toEqual(['treatment']);
    expect(counters(box)['recall_off_stale'] ?? 0, 'W2-D43: the drain bumps nothing for it').toBe(0);
    h.spoolLine(box, ID, recLine({ ts: T0 + 1 }));
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);
    expect(arms(), 'CONTROL: the arm-less line is received too').toEqual(['treatment', null]);
    expect(counters(box)['recall_off_stale'], 'CONTROL: and it bumps once').toBe(1);
  }, 120_000);
});
```

- [ ] **Step 3: Run the new tests and watch them fail as predicted.** One per tool call, each from the repository root, in the foreground with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'recallLine writes a RECALL_ARMS word')
```
Predicted: `1 failed`, at `W2-D43: the control arm is written`: `expected [ 'cmd', 'ev', 'gen', 'id', 'ms', 'rc', 'ts', 'v' ] to deeply equal [ 'arm', 'cmd', … ]`. The base `recallLine` ignores `i.arm`. The two rows above it pass.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
```
Predicted: `1 failed`, at step 5's key set: `expected [ 'cmd', 'ev', 'gen', 'id', 'ms', 'rc', 'ts', 'v' ] to deeply equal [ 'arm', … ]`. Every `none(…)` row before it passes, because Task 3's branch already counts nothing before step 4 (Step 1 (f)), and counts each admitted call without its arm (R4).

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'a defect after the admission')
```
Predicted: `1 failed`, at `toMatchObject`: the line lacks `arm: 'treatment'`.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'under history-off nothing is written')
```
Predicted: `1 failed`, at the CONTROL: `expected [ [ 0, undefined ] ] to deeply equal [ [ 0, 'treatment' ] ]`. The history-off half passes: `countRecall`'s first line is already there.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'C-R: the live call alone')
```
Predicted: `1 failed`, at `C-R: the live call has no arm, each eval call its own`: `expected [ [ 0, null ], [ 0, null ], [ 8, null ] ] to deeply equal [ [ 0, null ], [ 0, 'treatment' ], [ 8, 'control' ] ]`.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'an arm line on a stale recall-off file')
```
Predicted: `1 failed`: `W2-D43: a line carrying arm is no live observation`: `expected 2 to be 0`.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'drained by the pass')
```
Predicted: `1 failed`: `W2-D43: the drain bumps nothing for it`: `expected 1 to be 0`. The row check above it passes: the drain already stores the line's arm.

Record each first failing line in `.superpowers/sdd/history-w2-2b/t4/notes.txt`. A red at any CONTROL, or at a `none(…)` row, is the fixture's to fix, or Task 3's to report, before any code is written.

- [ ] **Step 4: sweep.mjs.** In `applyEventLine`'s recall arm, replace these two lines:

```js
    // This is a live drain observation after line/registry generation joining; replay never re-observes controls.
    if (c.replay !== true && decideRecallOff({ file: recallOffPresence(c.home, rec.id), generation: g.generation }) === 'stale') bump(db, 'recall_off_stale');
```

with:

```js
    // This is a live drain observation after line/registry generation joining; replay never re-observes controls. A line
    // carrying `arm` is an eval call (W2-D43), excluded from live counters: it bumps nothing and reads no recall-off file.
    if (c.replay !== true && typeof rec.arm !== 'string' && decideRecallOff({ file: recallOffPresence(c.home, rec.id), generation: g.generation }) === 'stale') bump(db, 'recall_off_stale');
```

The `INSERT INTO recall_calls …` line after it is unchanged: it already writes `rec.arm ?? null`.

- [ ] **Step 5: cli.mjs.**

(a) Replace the read verbs' lib import line

```js
  decideRecallOff, parseSpoolLine,
```

with

```js
  decideRecallOff, parseSpoolLine, RECALL_ARMS,
```

(b) `recallLine`. Replace its doc comment's last line

```js
 *  spool grammar would reject (parseSpoolLine) is never written: the answer is null. */
```

with

```js
 *  spool grammar would reject (parseSpoolLine) is never written: the answer is null.
 *  W2-D43: this is the single writer of `arm`. A counted env call passes the RECALL_ARMS word step 1 admitted, and the
 *  line carries it, so every live counter (`arm IS NULL`, W2-D13) leaves the call out; §8.2's "counted
 *  `scope_source=env`" reads as `recall_calls.arm IS NOT NULL` (an erratum, E10, W2-5b's to amend). A tmux call passes
 *  none: absent and null both mean none. Any other value answers null, so no line is written: a line without its word
 *  would count an eval call as a live one (C-R). */
```

and directly after

```js
  rec.ts = i.ts;
```

insert

```js
  if (i.arm !== undefined && i.arm !== null) {
    if (!RECALL_ARMS.includes(i.arm)) return null;
    rec.arm = i.arm;
  }
```

(c) `countRecall`, `ReadDefect`, `readContext` and `readVerb`:
- Replace `/** One counter line per identity-resolved read call, whatever its exit. */` with:

```js
/** One counter line per counted read call, whatever its exit (D-5023): on the tmux path every call whose identity resolved,
 *  on the env path every call step 4 admitted (W2-D46; the env branch's answers before it carry no id), with its arm
 *  (W2-D43). None under history-off. */
```

- In `ReadDefect`'s doc comment, replace ` *  identity-resolved call. \`cause\` is the thrown value itself. */` with:

```js
 *  identity-resolved call. `cause` is the thrown value itself. `arm` is the env branch's admitted arm (W2-D43), null on
 *  the tmux path. */
```

  Replace `  constructor(cause, id, gen) {` with `  constructor(cause, id, gen, arm) {`, and directly after `    this.gen = gen;` insert `    this.arm = arm;`.
- In `readContext`, replace these three lines (the first is Task 3's, unchanged):

```js
  const seen = { id: null, gen: null, arm: null };
  try {
    return await readContextIn(home, verb, parsed, nowMs, seen);
```

with:

```js
  const seen = { id: null, gen: null, arm: null };
  try {
    // W2-D43: Task 3's env branch sets seen.arm at step 4's admission, beside id and gen; every answer carries it.
    const r = await readContextIn(home, verb, parsed, nowMs, seen);
    r.arm = seen.arm;
    return r;
```

  Replace `    if (typeof seen.id === 'string') throw new ReadDefect(e, seen.id, seen.gen);` with:

```js
    if (typeof seen.id === 'string') throw new ReadDefect(e, seen.id, seen.gen, seen.arm);
```

- In `readVerb`:
  - replace `      who = { id: x.id, gen: x.gen };` with `      who = { id: x.id, gen: x.gen, arm: x.arm };`;
  - replace `    who = { id: ctx.id, gen: ctx.gen };` with `    who = { id: ctx.id, gen: ctx.gen, arm: ctx.arm };`;
  - in the `finally`, replace `countRecall(home, { id: who.id, gen: who.gen, cmd: verb, rc: exit, ms: Date.now() - t0, ts: Date.now() });` with:

```js
countRecall(home, { id: who.id, gen: who.gen, arm: who.arm, cmd: verb, rc: exit, ms: Date.now() - t0, ts: Date.now() });
```

  keeping the `if (who !== null && typeof who.id === 'string') ` before it on the same line.

- [ ] **Step 6: Run the new tests green.** One per tool call, in the foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'W2-2b Task 4')
```
Expected: `5 passed` (the four cases of the first describe and the C-R pin, both of whose titles hold `W2-2b Task 4`).

```bash
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'W2-2b Task 4')
```
Expected: `2 passed`.

- [ ] **Step 7: Check what the task did not touch.** From the repository root:

```bash
git diff --stat
git diff -U0 ccd/history/cli.mjs ccd/history/sweep.mjs | grep -c "^+.*'control'\|^+.*'treatment'"
grep -c "seen\.arm = " ccd/history/cli.mjs
grep -c "arm: who.arm" ccd/history/cli.mjs
git diff --quiet -- ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/store.mjs ccd/history/recall.mjs deploy docs/superpowers/specs && echo 'untouched'
```

Expected:
- `git diff --stat` lists exactly `ccd/history/cli.mjs`, `ccd/history/sweep.mjs`, `server/test/history-cli.test.ts` and `server/test/history-sweep.test.ts`.
- `0`: no shipped line spells an arm word. `recallLine` reads `RECALL_ARMS`, and W2-D42's spelling is lib's alone.
- `1` and `1`: Task 3's one carrier assignment and this task's one pass-through.
- `untouched`.

- [ ] **Step 8: Measure each guard red under its mutant, then green.** From the repository root. First write the helpers, once:

```bash
SCRATCH=.superpowers/sdd/history-w2-2b/t4
mkdir -p "$SCRATCH"
for f in ccd/history/cli.mjs ccd/history/sweep.mjs; do cp "$f" "$SCRATCH/$(basename "$f").orig"; done
cat > "$SCRATCH/mut.sh" <<'EOF'
SCRATCH=.superpowers/sdd/history-w2-2b/t4
FILES="ccd/history/cli.mjs ccd/history/sweep.mjs"
# mut <file>: replace the text of $SCRATCH/old with $SCRATCH/new in <file>, refusing unless it occurs exactly once.
mut() {
  python3 - "$1" "$SCRATCH/old" "$SCRATCH/new" <<'PY'
import sys
p, o, n = sys.argv[1], open(sys.argv[2]).read(), open(sys.argv[3]).read()
t = open(p).read()
c = t.count(o)
if c != 1:
    sys.exit(f'anchor occurs {c} times in {p}')
open(p, 'w').write(t.replace(o, n))
PY
}
# restore: every file back to its copy, checked with cmp; also on exit, a signal included.
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; cmp -s "$SCRATCH/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done; }
trap restore EXIT
trap 'exit 143' INT TERM HUP
EOF
```

Run each mutant in its own tool call, in the foreground, with a timeout of at least 600000 ms:
- Each call starts with `. .superpowers/sdd/history-w2-2b/t4/mut.sh`.
- It writes `old` and `new` with quoted heredocs, applies the mutant, runs the named filters one at a time, and ends with `restore`.
- A `mut` that exits non-zero means the anchor moved. Re-anchor on the line that now makes the same decision, and name the substitution in the commit body.
- Never split one mutant across calls.
- A call that prints `NOT RESTORED` stops the task: report it.

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# A1: recallLine drops the arm (the single writer writes none).
cat > "$SCRATCH/old" <<'EOF'
    if (!RECALL_ARMS.includes(i.arm)) return null;
    rec.arm = i.arm;
EOF
cat > "$SCRATCH/new" <<'EOF'
    if (!RECALL_ARMS.includes(i.arm)) return null;
EOF
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'recallLine writes a RECALL_ARMS word')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'C-R: the live call alone')
restore
# Predicted RED: each `1 failed`: the recallLine case at "the control arm is written"; the ladder at step 5's key set;
# C-R at "the live call has no arm, each eval call its own" ([[0,null],[0,null],[8,null]]).
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# A2: no vocabulary check (any word the spool grammar admits is written).
cat > "$SCRATCH/old" <<'EOF'
    if (!RECALL_ARMS.includes(i.arm)) return null;
    rec.arm = i.arm;
EOF
cat > "$SCRATCH/new" <<'EOF'
    rec.arm = i.arm;
EOF
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'recallLine writes a RECALL_ARMS word')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
restore
# Predicted RED: the recallLine case `1 failed` at "a word outside RECALL_ARMS: no line": expected '{"v":1,…,"arm":"fixture"}'
# to be null. CONTROL: the ladder stays green (the env branch passes only RECALL_ARMS words; '' still fails the spool
# grammar, so the "empty" row stays null).
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# A3: an unknown arm is dropped and the line written anyway (fail open).
cat > "$SCRATCH/old" <<'EOF'
    if (!RECALL_ARMS.includes(i.arm)) return null;
    rec.arm = i.arm;
EOF
cat > "$SCRATCH/new" <<'EOF'
    if (RECALL_ARMS.includes(i.arm)) rec.arm = i.arm;
EOF
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'recallLine writes a RECALL_ARMS word')
restore
# Predicted RED: `1 failed` at "a word outside RECALL_ARMS: no line, never a line without its arm": an arm-less line, not null.
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# A4: null read as a value (an overloaded null: the tmux path's null answers no line).
printf '  if (i.arm !== undefined && i.arm !== null) {\n' > "$SCRATCH/old"
printf '  if (i.arm !== undefined) {\n' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'recallLine writes a RECALL_ARMS word')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C24: consecutive')
restore
# Predicted RED: the recallLine case at "null means no arm, exactly as absent does" (null, not the line); the ladder at
# "never an arm on a tmux call" (no line: expected [] to deeply equal [[…]]); C24 at its first spool read, an ENOENT,
# because no tmux line is written at all.
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# A5: readVerb does not pass the arm on.
# The anchor is the call's head, with no line break.
printf 'countRecall(home, { id: who.id, gen: who.gen, arm: who.arm, cmd: verb,' > "$SCRATCH/old"
printf 'countRecall(home, { id: who.id, gen: who.gen, cmd: verb,' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'a defect after the admission')
restore
# Predicted RED: the ladder at step 5's key set; the defect case at its toMatchObject (no arm).
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# A6: ReadDefect loses the arm (the defect path alone).
printf "    if (typeof seen.id === 'string') throw new ReadDefect(e, seen.id, seen.gen, seen.arm);\n" > "$SCRATCH/old"
printf "    if (typeof seen.id === 'string') throw new ReadDefect(e, seen.id, seen.gen, null);\n" > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'a defect after the admission')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
restore
# Predicted RED: the defect case `1 failed` at its toMatchObject: the rc 1 line has no arm. CONTROL: the ladder stays
# green (no defect in it).
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# A7: the env branch never sets the arm (Task 3's admission line deleted, R4).
printf '    seen.arm = head.arm;\n' > "$SCRATCH/old"
printf '' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'C-R: the live call alone')
restore
# Predicted RED: the ladder at step 5's key set; C-R at its arm row ([[0,null],[0,null],[8,null]]).
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# T1: an arm on the tmux path (a default where none belongs).
printf '  const seen = { id: null, gen: null, arm: null };\n' > "$SCRATCH/old"
printf "  const seen = { id: null, gen: null, arm: 'treatment' };\n" > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'C-R: the live call alone')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C24: consecutive')
restore
# Predicted RED: the ladder at "W2-D43: never an arm on a tmux call"; C-R at its arm row ([0,'treatment'] for the live
# call); C24 at its key set (an 'arm' key on a tmux line).
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# C1: the env branch's step-2 refusal carries the session id (a pre-admission answer counted).
printf '  if (!harness.ok) return refusal(harness.rc, harness.reason, null, null, null);\n' > "$SCRATCH/old"
printf '  if (!harness.ok) return refusal(harness.rc, harness.reason, null, head.session, null);\n' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
restore
# Predicted RED: `1 failed` at "step 2, the harness: no counter line before step 4 admits the family": a new spool line
# (rc 2, no arm). CONTROL: every step-1 row before it passed.
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# C2: the env branch's step-4 refusal (decideAsOfFamily's) carries the session id (R5).
printf '    if (!fam.ok) return refusal(fam.rc, fam.reason, storeId, null, null);\n' > "$SCRATCH/old"
printf '    if (!fam.ok) return refusal(fam.rc, fam.reason, storeId, head.session, null);\n' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
restore
# Predicted RED: `1 failed` at "step 4, an ASOF the store does not hold: no counter line before step 4 admits the family".
# CONTROL: the rows of steps 1 to 3 passed.
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# C3: the env branch takes the id before the admission (where the tmux path takes it, after its harness), so a defect
# before step 4 leaves as a ReadDefect and is counted, with no arm: the C-R hazard.
printf '  const id = head.session;\n' > "$SCRATCH/old"
printf '  const id = head.session;\n  seen.id = id;\n' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
restore
# Predicted RED: `1 failed` at "step 4, a defect before the admission: no counter line before step 4 admits the family":
# an rc 1 line with no arm. CONTROL: every refusal row before it passed (a refusal names its own id, null).
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# C4: the env branch's failed open carries the session id.
printf '    const f = readFailure(e, refusalStoreId(reach, P), null, null);\n' > "$SCRATCH/old"
printf '    const f = readFailure(e, refusalStoreId(reach, P), id, null);\n' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
restore
# Predicted RED: `1 failed` at "step 3, the read-only open: no counter line before step 4 admits the family". CONTROL: the
# rows of steps 1 and 2 and the store table passed.
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# C5: the env branch's decideStatusRead refusal carries the session id.
printf '    if (rd.reason !== undefined) return refusal(rd.exit, rd.reason, storeId, null, null);\n' > "$SCRATCH/old"
printf '    if (rd.reason !== undefined) return refusal(rd.exit, rd.reason, storeId, id, null);\n' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the ladder')
restore
# Predicted RED: `1 failed` at "step 3, decideStatusRead: no counter line before step 4 admits the family". CONTROL: the
# read-only open's row before it passed. (The store's user_version is restored by the case's own finally.)
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# H1: the history-off check removed from countRecall (an existing guard, pinned here on the env path).
printf '  if (existsSync(historyPaths(home).off)) return;\n' > "$SCRATCH/old"
printf '' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'under history-off nothing is written')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C24: consecutive')
restore
# Predicted RED: the history-off case at "and writes no line (W2-D46)"; C24 at "and writes no line".
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# G1: gen written whatever its grammar (an existing guard: a legacy env call would carry gen '', which the spool grammar
# refuses, so no line at all).
printf "  if (typeof i.gen === 'string' && UUID_RE.test(i.gen)) rec.gen = i.gen;\n" > "$SCRATCH/old"
printf "  if (typeof i.gen === 'string') rec.gen = i.gen;\n" > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'recallLine writes a RECALL_ARMS word')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'a defect after the admission')
restore
# Predicted RED: the recallLine case at the "legacy" row: `TypeError: Cannot convert undefined or null to object` (its
# answer is null, and keys() reads Object.keys of it); the defect case at the legacy half: expected [] to deeply equal [[…]].
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# S1: the drain skip removed.
printf "    if (c.replay !== true && typeof rec.arm !== 'string' && decideRecallOff(" > "$SCRATCH/old"
printf "    if (c.replay !== true && decideRecallOff(" > "$SCRATCH/new"
mut ccd/history/sweep.mjs
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'an arm line on a stale recall-off file')
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'drained by the pass')
restore
# Predicted RED: the in-process case at "a line carrying arm is no live observation": expected 2 to be 0; the pass
# case at "the drain bumps nothing for it": expected 1 to be 0.
```

```bash
. .superpowers/sdd/history-w2-2b/t4/mut.sh
# S2: the skip inverted (only arm lines are observed).
printf "    if (c.replay !== true && typeof rec.arm !== 'string' && decideRecallOff(" > "$SCRATCH/old"
printf "    if (c.replay !== true && typeof rec.arm === 'string' && decideRecallOff(" > "$SCRATCH/new"
mut ccd/history/sweep.mjs
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'an arm line on a stale recall-off file')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C68 .CLI half.')
restore
# Predicted RED: the in-process case at "a line carrying arm is no live observation" (expected 2 to be 0); C68's CLI half
# at its last line, `expected undefined to be 1` (an arm-less tmux line no longer bumps). So the CONTROL is held two ways.
```

After the last block:

```bash
for f in ccd/history/cli.mjs ccd/history/sweep.mjs; do cmp "$f" ".superpowers/sdd/history-w2-2b/t4/$(basename "$f").orig" || echo "NOT RESTORED: $f"; done
git status --short
```

Expected:
- The loop prints nothing.
- `git status --short` lists exactly this task's four files, modified.

If a mutant stays green, its guard does not hold. Report it. Never weaken the guard or fit a CONTROL to the mutant. A red that differs from its prediction is recorded as measured, never re-predicted. Record each measured red line in the notes, for the commit body.

**Mutants, by guard:**

| Guard (new unless named) | Mutant | Must red | Must stay green |
|---|---|---|---|
| cli.mjs `recallLine` writes the arm (W2-D43, the single writer) | A1 | recallLine case; the ladder (step 5); C-R | history-sweep |
| cli.mjs `recallLine`: only a `RECALL_ARMS` word | A2 | recallLine case's "unknown" row | the ladder |
| cli.mjs `recallLine`: fail closed, no arm-less line | A3 | recallLine case's "unknown" row | — |
| cli.mjs `recallLine`: null is no arm (no overloaded null) | A4 | recallLine "tmuxNull"; the ladder's tmux CONTROL; history-recall C24 | — |
| cli.mjs `readVerb` passes the arm | A5 | the ladder; the defect case | — |
| cli.mjs `ReadDefect` carries the arm | A6 | the defect case | the ladder |
| Task 3's env branch sets `seen.arm` at the admission (R4) | A7 | the ladder; C-R | — |
| cli.mjs: never an arm on a tmux call | T1 | the ladder's tmux CONTROL; C-R; C24 | — |
| Task 3's env branch: no id before step 4's admission (W2-D46, R5, pinned here) | C1 to C5 | the ladder at step 2 (C1), step 4 (C2), the step-4 defect (C3), step 3's open (C4) and step 3's `decideStatusRead` (C5) | the earlier rows |
| cli.mjs `countRecall`: nothing under history-off (existing) | H1 | the history-off case; C24 | — |
| cli.mjs `recallLine`: gen only as a UUID (existing) | G1 | recallLine "legacy"; the legacy half | the ladder |
| sweep.mjs: the drain skips the bump for an arm line | S1, S2 | both history-sweep cases (S1); the in-process case and C68's CLI half (S2) | — |

- [ ] **Step 9: Run the neighbours that read these files.** Run each in the foreground with a timeout of at least 600000 ms, one per tool call, from the repository root. Re-run a red file alone before calling it a break (CLAUDE.md's load flakes).

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C24: consecutive|C68 |F6: a read that ends|RP8 end to end|counter writer')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts -t 'O48, the replay order')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
```

Expected: green. The predictions, by file:
- **history-cli**: the base count plus 5.
- **history-sweep**: the base count plus 2.
- **history-recall**: unchanged. C24's tmux lines keep their eight keys. The C68 cases' arm-less lines still bump. The F6 defect case still counts rc 1. RP8's G1 window still counts its one exit 8. The counter-writer belts call `recallLine` without `arm`.
- **history-recover's replay case**: unchanged (a replayed line reads no recall-off file, as before).
- **single-definition**: unchanged. This task reads no `process.env` name, and declares no vocabulary.
- **typecheck-tests**: the appended cases type through their own casts.
- **citations**: no numeric line citation was added (D-5893). `growth-check` lists none of these files (D-6178).

Compare each count with Step 1's notes.

- [ ] **Step 10: Commit.** This task defines no departure, so `## Deviations found` is not touched.

First write the message, with a quoted heredoc so nothing in it is expanded:

```bash
cat > .superpowers/sdd/history-w2-2b/t4/commit-msg.txt <<'EOF'
feat(history): a counted env call carries its arm, and the drain skips recall_off_stale for it (W2-2b Task 4; W2-D43, W2-D46)

<each mutant's measured red line from Step 8, all seventeen, one line each, its mutant first>
<Step 3's first red line of each of the seven cases>
<the passing counts of Steps 6 and 9>
<any re-anchoring Step 1 or Step 8 needed, or: no re-anchoring>

<the attribution line the session's reminder names>
EOF
```

Replace each `<…>` line with what it names, from the notes. Then:

```bash
for f in ccd/history/cli.mjs ccd/history/sweep.mjs; do cmp -s ".superpowers/sdd/history-w2-2b/t4/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
grep -c '^<' .superpowers/sdd/history-w2-2b/t4/commit-msg.txt
git add ccd/history/cli.mjs ccd/history/sweep.mjs server/test/history-cli.test.ts server/test/history-sweep.test.ts
git status --short
git commit -F .superpowers/sdd/history-w2-2b/t4/commit-msg.txt
git status --short
```

Expected:
- The loop prints nothing. No mutant is left in a file the commit takes. A `NOT RESTORED` line stops the commit: report it.
- Then `0`: no placeholder is left.
- `git status --short` lists exactly these four files, modified, before the commit, and nothing after it. Nothing under `.superpowers/` appears, because it is gitignored.

---

### Task 5: the history-switches row names headless-on and its bound, and README states the headless seam (W2-D49; W2-D44's bounds and W2-D45 to W2-D48 in prose)

W2-D49 gives W2-2b the one lifecycle edit W2 still owes after W2-1 and W2-4 (W2-D9): the `history-switches` row of `shared/lifecycle.ts` gains the marker Tasks 1 and 3 taught the CLI to read, `~/.ccrc/history/headless-on`, and its tier states that marker's bound, which is not the "<64 B" of the other switches. The pin in `server/test/lifecycle.test.ts` moves in the same commit (O17). The same task writes the seam's operator-facing paragraph in README's "Session history" section (decisions §2, "Files modified: … README.md (the seam)"), because README is where an operator reads what `headless-on` arms and which word a refusal prints.

Two changes, both text; no runtime behaviour moves:
- **`shared/lifecycle.ts`, in place, the `history-switches` row only.** Its `root` becomes `~/.ccrc/history-off, ~/.ccrc/history-max-gb, ~/.ccrc/history/headless-on`, each path spelled from `~/.ccrc` as the row's two others are (lib's `SWITCHES.headlessOn` is `.ccrc/history/headless-on`, HOME-relative). Its `tier` becomes `` <64 B each; `headless-on` bounded at 64 KiB (HEADLESS_LIST_MAX_BYTES), one store line plus one line per listed family ``, W2-D49's words exactly, its backticks included (R12). `name`, `pattern`, `creators`, `collector`, `bound` and `ruling` are byte-identical. A three-line comment above the row says why it names the constant as text.
- **`README.md`, one new paragraph**, `**The headless seam (W2's replay eval).**`, the last paragraph of "Session history: lossless recall (`ccrc history`)", directly after the paragraph that ends `which the operator removes by hand.` and before the `---` rule (R11). It names the three variables, the driver as their only intended caller, the marker's path, grammar and two bounds, every refusal word in W2-D46's order with its exit code, the env family and the cut, that box and operator verbs ignore the seam, and when a call is counted.

**L0 and the one textual copy.** `shared/*.ts` is L0 and imports nothing, not even `node:*` (CLAUDE.md, Rings; its ring is held by `server/test/rings/shared-imports.test.ts`, D-6045), so the row cannot import `HEADLESS_LIST_MAX_BYTES`. It names the constant inside its tier string and carries the derived figure "64 KiB", never the byte count `65536`. That is the precedent the row of the B3 numbers (`PURGED_FILES_GRACE_MS`, `CARD_LINE_MAX`), W2-4's `OUT_MARKER` and 5h-2's marker bounds (D-5748) already set: the manifest carries a figure as prose, and one `lifecycle.test.ts` case holds that figure to lib's constant, measured, never restated. Nothing in `single-definition.test.ts` forbids it, measured at `d119d6e90`:
- O14's `DECL_CORPUS` reads `.mjs` files only (`HISTORY_MJS` and every `.mjs` under `deploy/` and `shared/`), and its `declares(name)` pattern needs `const|let|var <NAME>`; a name inside a `.ts` string literal is neither. W2-D12's append of `HEADLESS_LIST_MAX_BYTES` to `VOCABS` (Task 1) therefore stays green with the row naming it.
- O13's switch scan reads `BASH`, `ALL_MJS` (`.mjs` under `ccd/`, `deploy/`, `shared/`) and the skill text. `shared/lifecycle.ts` and `README.md` are in neither, which is why the row already spells `~/.ccrc/history-off` and `~/.ccrc/history-max-gb` while `history-off`'s holders stay three files. `headless-on`'s holders stay `['ccd/history/lib.mjs']` (O13), and Step 8 re-runs that case.
- No scan in the tree counts a second numeric copy of a history constant in `shared/*.ts`; the byte count is kept out of the row by the exact `toBe` below, not by a scan.

**README's neighbours.** Eleven suites read README whole or by section. This task's text is written against each, and Step 8 runs them:
- `history-cli.test.ts`' W2-1 case (`README states the verb, its flag and its refusal words (W2-1)`): its three strings are in the recall-off paragraph, which is not edited.
- `history-skill.test.ts`' "README states grep's reach…" describe: `SEARCH_REACH`, `DISPLAY_INEXACT_NOTE` and `SPOOL_NODE_KINDS` ("a FIFO, a link, a directory or any other non-regular node") must each occur once. The new paragraph spells none of them; it says "a regular file, never through a link".
- `session-hook.test.ts`' two compaction-card describes put README in their corpus. "every line citation is anchored" matches `(<file>)?:<digits>`, so the paragraph holds no colon followed by a digit (Step 5 greps for one). The other matches retracted purge phrasings the paragraph does not use.
- `history-lib.test.ts`' "no false positive: 1 MiB of prose…" redacts README under two indexes and compares; any prose passes.
- `topology-clean.test.ts` reads README for host, address, account and path residue: the paragraph names no host, account or absolute path.
- `install-session-hooks.test.ts` (the hook section), `box-token-census.test.ts` (the auth paragraph), `license.test.ts` (the License section) and `readme-holds.test.ts` read other sections, which are not edited. `oss-metadata.test.ts` and `pools-prose.test.ts` read `readmeSizeClaim` over CLAUDE.md, not README. `docs-parity.test.ts` excludes README.
- `citations.test.ts` (D-5893) counts numeric line citations in code and test files: neither the row, its comment, nor the new cases carries one.
- `growth-check.test.ts` (armed, D-6178): `GROWTH_FILES` lists none of this task's files.

**What this task does not do.**
- It owns no refusal. It decides nothing at runtime: the seam's words, their order and the marker's reading are Tasks 1 to 4's, and the README paragraph describes them. So it carries no CONTROL "one step later" of its own; the README case pins that the paragraph lists step 1's words in W2-D46's order, against lib's `REASONS`.
- It does not touch the spec. §9.4's row (about :2171 at `d119d6e90`) keeps "`headless-on` one line per listed family" until W2-5b amends E7, and §9.7's row (about :2307) keeps "one per line" until E9 (decisions §6). The row departs from the spec's tier under D-5768 (the required store line), which this plan defines; the code comment cites it.
- It does not edit the row's `ruling`, `bound` or `creators` (W2-D49 names root and tier only; R12), `HISTORY_ROWS_BY_PR` or `HISTORY_LANDED` (`history-switches` landed in B1; W2-2b widens it and adds no class), or any other lifecycle row (W2-D9).
- It does not edit `ccd/history-skill/SKILL.md` (W2-D48: its exit-2 row is generic) or describe the driver's own flags: README's driver paragraph is W2-5b's (the ledger's "Carried constraints", "For W2-5b's plan").

**Order.** Task 5 runs after Tasks 1 to 4, which ship the names it reads: `HEADLESS_LIST_MAX_BYTES`, `HEADLESS_LIST_MAX_PAIRS`, `parseHeadlessList` and `formatHeadlessList` (Task 1, W2-D44), `RECALL_ARMS` (W2-D42), the two new `REASONS` words (W2-D48), and, for the README's accuracy, `decideHeadless` in W2-D46's order with the env family and the counting (Tasks 2 to 4; W2-D40, W2-D41, W2-D43, W2-D47). Step 0 stops before any edit if one is missing. It touches no region of `ccd/history/*.mjs`. Line numbers below are hints measured at `d119d6e90`; Step 1 asserts that each anchor occurs exactly once, and an anchor Tasks 1 to 4 moved is re-found by its quoted content.

**Files:**
- Modify: `shared/lifecycle.ts`, the `history-switches` row only (about :81-83 at `d119d6e90`), found by its first line `  { name: 'history-switches', root: '~/.ccrc/history-off, ~/.ccrc/history-max-gb', pattern: 'O',`. Its first two lines are replaced and a three-line comment goes directly above it; its `ruling` line is unchanged. No import is added: the file keeps importing nothing.
- Modify: `README.md`. One paragraph inserted after the line `names it skipped (a directory, a FIFO, a socket or a device, or an entry it could not measure or remove), which the operator removes by hand.` (about :5866), separated from it and from the following `---` by one blank line each. No other line of README changes.
- Test: `server/test/lifecycle.test.ts`:
  - in place, inside `it('declares history-switches: operator files with no writer in the tree, touched by hand', …)` (about :1216-1225; the decisions document's ":1183-1184"): its last two lines, the comment `// B1's two; W2 adds headless-on and W3 the steer markers, …` and `expect(c!.root).toBe('~/.ccrc/history-off, ~/.ccrc/history-max-gb');`, become three lines;
  - one case appended as the last case of `describe('shared/lifecycle.ts — the policy §4(a) manifest', …)`, directly after W2-1's `declares history-recall-off` case (which ends about :1358), with a four-line header comment in the W2-4 and W2-1 cases' style. It imports lib dynamically inside the case, as those two do, so the file's import block is unchanged.
- Test: `server/test/history-cli.test.ts`. One describe with 3 pure cases, appended after the file's last line (after Task 4's describes). It reads README through the file's existing `fs`, `path` and `REPO` imports and imports lib dynamically, so no import line is added. It does not skip on darwin: it spawns nothing.
- Not edited: the spec, `ccd/history/*.mjs` and `lib.d.mts`, `ccd/history-skill/SKILL.md`, `single-definition.test.ts`, `history-lib`, `history-recall` and `history-sweep` tests, `deploy/**`, `.github/**`, `ccd/session-hook.sh`, `ccd/ccd`, the ledger.

**Interfaces:**
- Consumes (from Tasks 1 to 4; Step 0 checks each):
  - `ccd/history/lib.mjs`:
    - `HEADLESS_LIST_MAX_BYTES === 65536` and `HEADLESS_LIST_MAX_PAIRS === 1000` (W2-D44), each exported, in O14's `VOCABS`;
    - `RECALL_ARMS`, deep-equal to `['control', 'treatment']`, frozen (W2-D42);
    - `parseHeadlessList(text: string)`: pure; answers an object whose `ok` is `true` for a marker in W2-D44's grammar, and `{ ok: false, rc: 2, reason: 'headless-malformed' }` for text that breaks it, a text over `HEADLESS_LIST_MAX_BYTES` UTF-8 bytes included (W2-D44 lists "more than 65,536 bytes" among the whole marker's malformed conditions);
    - `formatHeadlessList({ storeId, pairs })`, `pairs` an array of `{ ccrcId: string, generation: string }` with `''` for a legacy family: the only producer of marker text, writing `store <storeId>` and then one `<ccrcId> <generation>` line per pair, `-` for `''`;
    - `REASONS['headless-malformed'] === 2` and `REASONS['headless-arm-unknown'] === 2` (W2-D48, D-5769), beside W1-B2's `headless-unarmed`, `headless-in-pane`, `headless-unlisted`, `no-identity`, `bad-id`, `cross-project` and W2-2a's `asof-invalid`;
    - unchanged at the base: `SWITCHES` (`off: '.ccrc/history-off'`, `maxGb: '.ccrc/history-max-gb'`, `headlessOn: '.ccrc/history/headless-on'`) and `EXIT.REFUSED === 2`.
  - `ccd/history/lib.d.mts`: declarations of the five names above (Task 1's), so `typecheck-tests` types this task's dynamic imports.
  - Tests: `lifecycle.test.ts`' file-level `LIFECYCLE` import; `history-cli.test.ts`' `fs`, `path` and `REPO` (from `historyHelpers.ts`).
- Produces:
  - `LIFECYCLE`'s `history-switches` entry: `root === '~/.ccrc/history-off, ~/.ccrc/history-max-gb, ~/.ccrc/history/headless-on'`; `` tier === '<64 B each; `headless-on` bounded at 64 KiB (HEADLESS_LIST_MAX_BYTES), one store line plus one line per listed family' `` (W2-D49's words, R12); every other field unchanged (`pattern: 'O'`, `creators: ['operator shell']`, `collector: null`, `bound: 'until removed'`, the ruling).
  - README's paragraph beginning `**The headless seam (W2's replay eval).**`, once, inside the Session history section.
  - Tests: `lifecycle.test.ts`, the edited switches case and one new case, `the history-switches tier is lib's: …`; `history-cli.test.ts`, the describe `README states the headless seam: its variables, the marker, the refusal words in their order (W2-2b Task 5)`, 3 cases.

**Choices this task makes:**
- **The row's spelling.** Spec §9.4 lists the class's paths relative to `~/.ccrc` after its first (`history/headless-on`); the row as shipped spells every path in full. The new path follows the row (`~/.ccrc/history/headless-on`) and lib's `SWITCHES`, and the new case holds all three to `SWITCHES`, so a fourth spelling cannot drift in.
- **The tier's words are W2-D49's, exactly (R12).** W2-D49 writes `` `headless-on` `` in backticks, and the row keeps them, as several `ruling` strings of `LIFECYCLE` already carry backticked names.
- **The ruling is left as it is (R12).** Spec §9.4's ruling column adds "(`headless-on` removed at W2 close …)". The row's ruling already says "touched by hand; persists until removed", which covers it, and W2-D49 names root and tier only.
- **The tier is pinned exactly (`toBe`), from lib.** An exact pin reds a tier that copies the byte count, drops the store line or keeps the KiB figure after the constant moves. A `toContain` pin would let a second figure in beside the right one.
- **The bound is tied to the grammar, not only to the constant.** The row's figure is the number of bytes the marker may hold, so the case also builds a marker of exactly `HEADLESS_LIST_MAX_BYTES` bytes that `parseHeadlessList` takes and one of a byte more that it refuses (`headless-malformed`), as D-5748's case measures the op and pass markers' longest lines from lib's parsers. The "one store line plus one line per listed family" half is tied to `formatHeadlessList`'s output.
- **README's words are derived from lib where lib owns them.** The seam's exit-2 words are every `headless-*` key of `REASONS` plus `asof-invalid`, so a later `headless-*` word reds the README case until the paragraph names it; the path is `~/${SWITCHES.headlessOn}`; the bounds are the two constants; the arm words are `RECALL_ARMS`. The order is W2-D46's step 1, as a literal list in the test, because lib holds no order table: `decideHeadless`'s code is the order, and Task 2's own tests pin it.
- **The paragraph sits in "Session history", after the operator verbs (R11).** README has no seam or as-of text at the base (W2-2a never touched README). The seam is a property of the read verbs, but its only caller is the operator's eval, so it goes last in the section, after `recall-off`, the eval's other operator-facing switch.

**Residuals, named:**
- **The README describes, it does not decide.** If Tasks 1 to 4's order or words change, the README case reds only for a word or a step-1 order it lists; the sentences on the env family, the cut, `cross-project` and counting are pinned by those tasks' spawned cases, not by this text. The reviewer reads the paragraph against `decideHeadless` and `readContextIn` at the PR's head.
- **The spec's two rows stay rev 3.6 until W2-5b** (E7, E9): the manifest and the spec disagree on the tier for one PR's lifetime, by design (W2-D3).

- [ ] **Step 0: Check the base and Tasks 1 to 4's names.** From the repository root, before any edit:

```bash
grep -c '^export function asOfCut(' ccd/history/lib.mjs
grep -cE '^export const HEADLESS_LIST_MAX_BYTES\b' ccd/history/lib.mjs
grep -cE '^export const HEADLESS_LIST_MAX_PAIRS\b' ccd/history/lib.mjs
grep -cE '^export const RECALL_ARMS\b' ccd/history/lib.mjs
grep -c '^export function parseHeadlessList(' ccd/history/lib.mjs
grep -c '^export function formatHeadlessList(' ccd/history/lib.mjs
grep -cxF "    'headless-malformed', 'headless-arm-unknown'," ccd/history/lib.mjs
grep -n 'HEADLESS_LIST_MAX_BYTES\|HEADLESS_LIST_MAX_PAIRS\|RECALL_ARMS\|parseHeadlessList\|formatHeadlessList\|interface HeadlessPair ' ccd/history/lib.d.mts
node --input-type=module -e "import('./ccd/history/lib.mjs').then((l) => console.log(l.HEADLESS_LIST_MAX_BYTES, l.HEADLESS_LIST_MAX_PAIRS, JSON.stringify(l.RECALL_ARMS), l.REASONS['headless-malformed'], l.REASONS['headless-arm-unknown'], l.SWITCHES.headlessOn))"
```

Expected: `1` for each of the first seven lines (W2-2a's `asOfCut` is on the base; each of Task 1's names is declared once; the two new words are `REASON_ROWS`' one line, Task 1's. Each word is quoted once more in lib.mjs, by `HEADLESS_MALFORMED` and by `decideHeadless`, so the line is matched whole, never the word); the `lib.d.mts` grep lists a declaration of each of the five names, among them exactly `export function formatHeadlessList(list: { storeId: string; pairs: readonly HeadlessPair[] }): string;`, and the line `export interface HeadlessPair { readonly ccrcId: string; readonly generation: string }`; and the node line prints exactly:

```
65536 1000 ["control","treatment"] 2 2 .ccrc/history/headless-on
```

On any other answer, make no edit and report to the coordinator.

- [ ] **Step 1: Confirm the anchors and record the base counts.** From the repository root:

```bash
grep -c "^  { name: 'history-switches', root: '~/.ccrc/history-off, ~/.ccrc/history-max-gb', pattern: 'O',$" shared/lifecycle.ts
grep -c "^    creators: \['operator shell'\], collector: null, bound: 'until removed', tier: '<64 B each',$" shared/lifecycle.ts
grep -c "^    ruling: 'touched by hand; persists until removed (no writer in the tree, pinned by single-definition.test.ts)' },$" shared/lifecycle.ts
grep -c '^import ' shared/lifecycle.ts
grep -c "^    // B1's two; W2 adds headless-on and W3 the steer markers, each to this root in its own PR$" server/test/lifecycle.test.ts
grep -c "^    expect(c!.root).toBe('~/.ccrc/history-off, ~/.ccrc/history-max-gb');$" server/test/lifecycle.test.ts
grep -cF '    expect(c!.tier).toContain(`at most ${Buffer.byteLength(`${g}\n`)} B`);' server/test/lifecycle.test.ts
grep -c "^names it skipped (a directory, a FIFO, a socket or a device, or an entry it could not measure or remove), which the operator removes by hand.$" README.md
grep -c 'headless' README.md
grep -c 'README states the headless seam\|history-switches tier is lib' server/test/history-cli.test.ts server/test/lifecycle.test.ts
grep -cF "'headless-unarmed', 'headless-in-pane', 'headless-unlisted', 'no-identity'," ccd/history/lib.mjs
```

Expected (measured at `d119d6e90`): `1` for each of the first three lines; `0` for the fourth (`shared/lifecycle.ts` imports nothing); `1` for the next four (the last of them is W2-1's case's last assertion, followed by `  });` and the describe's `});`); `0` for README's `headless` (the base README names no seam); `0` in both test files (the titles are free); `1` for the last line, the W1-B2 `REASON_ROWS` fragment mutant RD4 anchors on (if the line moved, re-anchor mutant RD4 on its new content, keeping its one inserted word). Then the base counts, each in the foreground with a timeout of at least 600000 ms, one per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'README states')
```

Write each `N passed` into `.superpowers/sdd/history-w2-2b/base-counts-task5.txt` (gitignored). Both must be green; `README states` selects W2-1's case alone here (1 passed).

- [ ] **Step 2: Write the failing tests.** Three edits, test files only.

(a) `server/test/lifecycle.test.ts`, in place. Replace exactly these two lines of the switches case:

```ts
    // B1's two; W2 adds headless-on and W3 the steer markers, each to this root in its own PR
    expect(c!.root).toBe('~/.ccrc/history-off, ~/.ccrc/history-max-gb');
```

with these three:

```ts
    // B1's two and W2-2b's headless-on (W2-D49), each spelled from ~/.ccrc as lib's SWITCHES is; W3 adds the steer
    // markers to this root in its own PR
    expect(c!.root).toBe('~/.ccrc/history-off, ~/.ccrc/history-max-gb, ~/.ccrc/history/headless-on');
```

(b) `server/test/lifecycle.test.ts`, appended as the describe's last case: insert directly after W2-1's case's last two lines,

```ts
    expect(c!.tier).toContain(`at most ${Buffer.byteLength(`${g}\n`)} B`);
  });
```

and before the describe's closing `});`, this block (it opens with one blank line):

```ts

  // ── ccrc history W2-2b (spec 2026-10-05 §9.4, O17; W2-D9, W2-D49, W2-D44; D-5768) ──────────────────────────────────
  // headless-on joins B1's switches row: the one switch with content, a store line and one line per listed family. The
  // manifest is L0 and imports nothing, so the row names HEADLESS_LIST_MAX_BYTES as text and carries its KiB figure; this
  // case holds the figure to lib's constant and to the grammar, and the paths to SWITCHES, as the B3 numbers are above.
  it('the history-switches tier is lib\'s: headless-on is bounded at HEADLESS_LIST_MAX_BYTES in KiB, which the marker grammar takes exactly, with one store line plus one line per family (W2-2b Task 5)', async () => {
    const { HEADLESS_LIST_MAX_BYTES, SWITCHES, parseHeadlessList, formatHeadlessList } = await import('../../ccd/history/lib.mjs');
    const c = LIFECYCLE.find((x) => x.name === 'history-switches');
    expect(c, 'shared/lifecycle.ts declares no history-switches class').toBeTruthy();
    expect(c!.root.split(', '), 'the row spells a switch otherwise than lib\'s SWITCHES')
      .toEqual([SWITCHES.off, SWITCHES.maxGb, SWITCHES.headlessOn].map((s) => `~/${s}`));
    expect(HEADLESS_LIST_MAX_BYTES % 1024, 'CONTROL: the bound is a whole number of KiB').toBe(0);
    expect(c!.tier).toBe('<64 B each; `headless-on` bounded at ' + `${HEADLESS_LIST_MAX_BYTES / 1024}` + ' KiB (HEADLESS_LIST_MAX_BYTES), one store line plus one line per listed family');
    // The grammar takes exactly the bound the row states: a marker of HEADLESS_LIST_MAX_BYTES bytes parses, one more does not.
    const STORE = ['1b2c3d4e', '5f60', '4a7b', '8c9d', '0e1f2a3b4c5d'].join('-');
    const GEN = ['2c3d4e5f', '6071', '4b8c', '9d0e', '1f2a3b4c5d6e'].join('-');
    const head = `store ${STORE}\nwrap-a-demo ${GEN}\nwrap-b-demo -\n#`;
    const sized = (n: number): string => `${head}${'x'.repeat(n - Buffer.byteLength(head) - 1)}\n`;
    expect(Buffer.byteLength(sized(HEADLESS_LIST_MAX_BYTES)), 'CONTROL: the fixture is the bound exactly').toBe(HEADLESS_LIST_MAX_BYTES);
    expect(parseHeadlessList(sized(HEADLESS_LIST_MAX_BYTES)).ok, 'a marker of exactly the bound is refused').toBe(true);
    const over = parseHeadlessList(sized(HEADLESS_LIST_MAX_BYTES + 1));
    expect(over.ok, 'a marker one byte over the bound parses').toBe(false);
    expect((over as { reason?: string }).reason).toBe('headless-malformed');
    // "one store line plus one line per listed family": the formatter's text for two families, a legacy one among them.
    const text = formatHeadlessList({ storeId: STORE, pairs: [{ ccrcId: 'wrap-a-demo', generation: GEN }, { ccrcId: 'wrap-b-demo', generation: '' }] });
    expect(text.split('\n').filter((l) => l !== '' && !l.startsWith('#'))).toEqual([`store ${STORE}`, `wrap-a-demo ${GEN}`, 'wrap-b-demo -']);
    expect(parseHeadlessList(text).ok, 'CONTROL: the formatter\'s text is a marker the grammar takes').toBe(true);
  });
```

(c) `server/test/history-cli.test.ts`: append after the file's last line:

```ts

// ── W2-2b Task 5 (W2-D44, W2-D45, W2-D46, W2-D47, W2-D48): README states the headless seam ────────────────────────────
// The operator-facing account of the seam, held to lib: every exit-2 word the seam answers (each `headless-*` REASONS
// word, derived, plus `asof-invalid`) is named, and step 1's words come in W2-D46's order; the marker's path is SWITCHES';
// its two bounds are HEADLESS_LIST_MAX_BYTES (in KiB) and HEADLESS_LIST_MAX_PAIRS; the arm words are RECALL_ARMS'. A word,
// a bound or a path that moves in lib reds here until README follows. Pure: it reads README and imports lib, nothing else.
describe('README states the headless seam: its variables, the marker, the refusal words in their order (W2-2b Task 5)', () => {
  const SEAM = '**The headless seam';
  /** The Session history section: its heading to the next `---` rule. */
  const section = (): string => {
    const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
    const from = readme.indexOf('### Session history: lossless recall');
    expect(from, 'README has no Session history section').toBeGreaterThan(-1);
    const to = readme.indexOf('\n---\n', from);
    expect(to, 'the Session history section has no end').toBeGreaterThan(from);
    return readme.slice(from, to);
  };
  /** The seam paragraph, whitespace (line breaks included) collapsed to single spaces. */
  const paragraph = (): string => {
    const s = section();
    const at = s.indexOf(SEAM);
    expect(at, 'the Session history section has no headless seam paragraph').toBeGreaterThan(-1);
    expect(s.split(SEAM).length - 1, 'the seam paragraph is written more than once').toBe(1);
    const end = s.indexOf('\n\n', at);
    return (end < 0 ? s.slice(at) : s.slice(at, end)).replace(/\s+/g, ' ');
  };

  it('names the three variables, the driver as their one caller, empty as unset, and the verbs that ignore them', () => {
    const p = paragraph();
    for (const n of ['CCRC_RECALL_SESSION', 'CCRC_RECALL_ARM', 'CCRC_RECALL_ASOF']) expect(p, `README does not name ${n}`).toContain(`\`${n}\``);
    expect(p).toContain('`deploy/history-replay.mjs`');
    expect(p).toContain('Nothing else is meant to set them');
    expect(p).toContain('A variable counts as set only when it is non-empty');
    expect(p).toContain('`status`, `doctor` and the operator verbs ignore all three');
  });

  it('states the marker from lib: its path, its grammar, both bounds and the arm words', async () => {
    const { SWITCHES, HEADLESS_LIST_MAX_BYTES, HEADLESS_LIST_MAX_PAIRS, RECALL_ARMS } = await import('../../ccd/history/lib.mjs');
    const p = paragraph();
    expect(p).toContain(`\`~/${SWITCHES.headlessOn}\``);
    expect(p).toContain('`store <store_id>`');
    expect(p).toContain('`<ccrc_id> <generation>`');
    expect(HEADLESS_LIST_MAX_BYTES % 1024, 'CONTROL: the byte bound is a whole number of KiB').toBe(0);
    expect(p).toContain(`more than ${HEADLESS_LIST_MAX_BYTES / 1024} KiB`);
    expect(p).toContain(`more than ${HEADLESS_LIST_MAX_PAIRS.toLocaleString('en-US')} families`);
    for (const a of RECALL_ARMS) expect(p, `README does not name the arm ${a}`).toContain(`\`${a}\``);
  });

  it('names every exit-2 word of the seam, each a REASONS word of exit 2, with step 1 in W2-D46 order', async () => {
    const { REASONS, EXIT } = await import('../../ccd/history/lib.mjs');
    const p = paragraph();
    const words = [...Object.keys(REASONS).filter((w) => w.startsWith('headless-')), 'asof-invalid'];
    expect(words, 'CONTROL: the derivation sees the seam words').toEqual(expect.arrayContaining([
      'headless-unarmed', 'headless-in-pane', 'headless-unlisted', 'headless-malformed', 'headless-arm-unknown', 'asof-invalid']));
    for (const w of words) {
      expect(REASONS[w], `${w} is not an exit-2 word`).toBe(EXIT.REFUSED);
      expect(p, `README does not name ${w}`).toContain(`\`${w}\``);
    }
    const ORDER = ['headless-in-pane', 'headless-unarmed', 'headless-malformed', 'no-identity', 'bad-id',
      'headless-unlisted', 'headless-arm-unknown', 'asof-invalid'];
    const at = ORDER.map((w) => p.indexOf(`\`${w}\``));
    expect(ORDER.filter((_, k) => at[k]! < 0), 'a step-1 word is missing').toEqual([]);
    expect([...at].sort((a, b) => a - b), 'README states step 1 out of W2-D46 order').toEqual(at);
    expect(p).toContain('exit 2');
    expect(p).toContain('exit 8');
  });
});
```

- [ ] **Step 3: Run them; watch them fail as predicted.** One per tool call, foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'history-switches')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'README states the headless seam')
```

Predicted (written before the run):
- lifecycle: `2 failed`. `declares history-switches`: expected `'~/.ccrc/history-off, ~/.ccrc/history-max-gb'` to be `'~/.ccrc/history-off, ~/.ccrc/history-max-gb, ~/.ccrc/history/headless-on'`. The new case: at its root assertion, `the row spells a switch otherwise than lib's SWITCHES` (an array of two against three), before the tier.
- history-cli: `3 failed`, each at `the Session history section has no headless seam paragraph` (expected -1 to be greater than -1).

A red anywhere else (an import that does not resolve, a CONTROL) is the fixture's or Step 0's: stop and fix that, never the guard.

- [ ] **Step 4: Edit the row.** `shared/lifecycle.ts`, in place. Replace exactly these two lines:

```ts
  { name: 'history-switches', root: '~/.ccrc/history-off, ~/.ccrc/history-max-gb', pattern: 'O',
    creators: ['operator shell'], collector: null, bound: 'until removed', tier: '<64 B each',
```

with these six (the row's `ruling` line, which follows, is unchanged):

```ts
  // W2-2b (W2-D49; D-5768): headless-on joins the switches. It is the one with content, a store line and one line per
  // listed family, so its tier is its own. L0 imports nothing, so the tier names HEADLESS_LIST_MAX_BYTES as text and
  // carries its KiB figure; lifecycle.test.ts holds the figure to lib's constant and to the marker grammar.
  { name: 'history-switches', root: '~/.ccrc/history-off, ~/.ccrc/history-max-gb, ~/.ccrc/history/headless-on', pattern: 'O',
    creators: ['operator shell'], collector: null, bound: 'until removed',
    tier: '<64 B each; `headless-on` bounded at 64 KiB (HEADLESS_LIST_MAX_BYTES), one store line plus one line per listed family',
```

Then:

```bash
grep -c '^import ' shared/lifecycle.ts
grep -c '65536\|65,536' shared/lifecycle.ts
git diff --stat -- shared/lifecycle.ts
```

Expected: `0`; `0` (the byte count is in no row); `1 file changed, 6 insertions(+), 2 deletions(-)`.

- [ ] **Step 5: Write the README paragraph.** Insert, directly after the line `names it skipped (a directory, a FIFO, a socket or a device, or an entry it could not measure or remove), which the operator removes by hand.`, one blank line and then these 28 lines, so that the existing blank line and `---` follow the paragraph unchanged:

```markdown
**The headless seam (W2's replay eval).** The read verbs have one caller outside any pane: W2's replay
driver, `deploy/history-replay.mjs`, which runs each eval arm as a headless `claude -p` and sets three
variables: `CCRC_RECALL_SESSION`, the session's id; `CCRC_RECALL_ARM`, `control` or `treatment`; and
`CCRC_RECALL_ASOF`, the uuid of the compaction boundary the run replays from. Nothing else is meant to set
them. A variable counts as set only when it is non-empty; with none set, every verb works exactly as above,
and `status`, `doctor` and the operator verbs ignore all three. The seam is armed only by
`~/.ccrc/history/headless-on`, which nothing in ccrc writes: the operator writes it for an eval window, from
the W2 open record, and removes it when the window closes. Its first line that is not a `#` comment is
`store <store_id>`, naming this box's store; every later line is empty, a `#` comment, or
`<ccrc_id> <generation>` for one admitted family, with `-` as the generation of a family that has none.
A carriage return, a space at either end of a line, any other line, a second store line, more than 64 KiB
or more than 1,000 families makes the whole file malformed, and it is read only as a regular file, never
through a link. After a macOS or server-role box's exit 9, the seam's refusals come in this order, each
exit 2: `headless-in-pane` when any of the three is set inside a pane (`TMUX_PANE` defined, even empty),
before tmux is asked; `headless-unarmed` with no marker; `headless-malformed` when the marker cannot be
read or breaks its grammar; `no-identity` with no session id, and `bad-id` for one outside ccd's id
grammar; `headless-unlisted` for a family the marker does not list, or a marker that lists none;
`headless-arm-unknown` for an arm that is unset or neither word; and `asof-invalid` for a boundary that
is unset or not a uuid. Once the store is open, a store line naming another store is `headless-unlisted`
too, and the boundary must be a boundary on a main transcript of a confirmed epoch of exactly that
family, or the answer is `asof-invalid`. The family and its generation come from that boundary, never
from the registry or `CCRC_SESSION_GENERATION`. Then the family answers exit 8 when its recall is
switched off, and `control` answers exit 8 too. Under `treatment` every verb reads the store as of the
boundary: rows, nodes and epochs after it are absent; `--project`, `--workspace` and `--session` still
widen the scope, the cut applies to every family in it, and a family with nothing visible is left out;
`--workspace` anchors on the working directory of the boundary's epoch; and a family whose stored
project is not the session's answers exit 2 `cross-project`. A call is counted only once its family is
admitted, and its counter line carries the arm; under `~/.ccrc/history-off` nothing is counted.
```

Each sentence is a decision of this plan: the caller and the variables (W2-D42, W2-D50, spec §8.2); empty means unset and the box verbs (W2-D45, W2-D47); the marker (W2-D44, D-5768; the bounded `O_NOFOLLOW` reader); the order and the words (W2-D46, W2-D48, D-5769; W2-D42's pre-store `asof-invalid`); the store-line check and the family from ASOF (W2-D44, W2-D40, D-5767, whose `--workspace` anchor the cut sentence states); exit 8 twice (W2-D46 steps 5 and 6); the widened scopes and `cross-project` (W2-D41); counting (W2-D43, W2-D46). Then:

```bash
mkdir -p .superpowers/sdd/history-w2-2b/t5
git diff -U0 -- README.md | grep '^+' | grep -v '^+++' > .superpowers/sdd/history-w2-2b/t5/readme-added.txt
wc -l < .superpowers/sdd/history-w2-2b/t5/readme-added.txt
grep -nE ':[0-9]' .superpowers/sdd/history-w2-2b/t5/readme-added.txt
grep -c 'a FIFO, a link, a directory or any other non-regular node\|reaches at most the first\|window redacted alone' .superpowers/sdd/history-w2-2b/t5/readme-added.txt
awk 'length > 110' .superpowers/sdd/history-w2-2b/t5/readme-added.txt
git diff --stat -- README.md
```

Expected: `29` (the blank line and the 28 lines); no output from the colon-digit grep (the citation audit's `:<digits>` pattern); `0` (no once-only phrase of `history-skill`'s README describe is repeated); no line over 110 columns; `1 file changed, 29 insertions(+)`.

- [ ] **Step 6: Run the tests green.** One per tool call, foreground, timeout at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'history-switches')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'README states the headless seam')
```

Expected: `2 passed` and `3 passed`. A red at the grammar half of the lifecycle case (`a marker of exactly the bound is refused`, or `a marker one byte over the bound parses`) says Task 1 checks the size somewhere other than `parseHeadlessList` (R2 puts it there): stop and report, never loosen the case.

- [ ] **Step 7: Measure every new guard red, then green.** From the repository root. Each mutant runs in its own tool call, foreground, timeout at least 600000 ms, through helpers written once after Step 6's green run. They restore every file this task's mutants touch, check each with `cmp`, and restore on exit, a signal included, so a call killed by its timeout never leaves a mutant in the tree. A red at a CONTROL is the fixture's to fix, never the guard's to weaken; a mutant whose red differs from its prediction is recorded as measured and reported, never re-predicted.

```bash
mkdir -p .superpowers/sdd/history-w2-2b/t5
cat > .superpowers/sdd/history-w2-2b/t5/mut.sh <<'SH'
SCRATCH=.superpowers/sdd/history-w2-2b/t5
FILES="shared/lifecycle.ts README.md ccd/history/lib.mjs"
# mut <file> <old> <new>: one exact replacement, refused unless <old> occurs exactly once.
mut() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
c = s.count(old)
if c != 1:
    sys.exit(f'anchor occurs {c} times in {p}')
open(p, 'w').write(s.replace(old, new))
PY
}
# mutline <file> <line regex> <new line>: the one whole line matching <regex> replaced, refused unless exactly one matches.
mutline() {
  python3 - "$1" "$2" "$3" <<'PY'
import re, sys
p, rx, new = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(p).read().split('\n')
at = [i for i, l in enumerate(lines) if re.fullmatch(rx, l)]
if len(at) != 1:
    sys.exit(f'{rx!r} matches {len(at)} lines in {p}')
lines[at[0]] = new
open(p, 'w').write('\n'.join(lines))
PY
}
# mutfn <file> <name> <old> <new>: inside `export function <name>(`'s body (to the next line that is exactly `}`), every
# <old> replaced by <new>; refused when the function is not declared once, or its body holds no <old>.
mutfn() {
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import sys
p, fn, old, new = sys.argv[1:5]
lines = open(p).read().split('\n')
at = [i for i, l in enumerate(lines) if l.startswith(f'export function {fn}(')]
if len(at) != 1:
    sys.exit(f'{fn} is declared {len(at)} times in {p}')
end = next(i for i in range(at[0] + 1, len(lines)) if lines[i] == '}')
body = '\n'.join(lines[at[0]:end + 1])
if old not in body:
    sys.exit(f'{old!r} does not occur in {fn}')
lines[at[0]:end + 1] = body.replace(old, new).split('\n')
open(p, 'w').write('\n'.join(lines))
PY
}
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; cmp -s "$SCRATCH/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done; }
trap restore EXIT
trap 'exit 143' INT TERM HUP
LC_T='history-switches'
RM_T='README states the headless seam'
SH
for f in shared/lifecycle.ts README.md ccd/history/lib.mjs; do cp "$f" ".superpowers/sdd/history-w2-2b/t5/$(basename "$f").orig"; done
```

Then each mutant, ONE tool call each:

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# L1: the row's root without headless-on (B1's root).
mut shared/lifecycle.ts "'~/.ccrc/history-off, ~/.ccrc/history-max-gb, ~/.ccrc/history/headless-on'" "'~/.ccrc/history-off, ~/.ccrc/history-max-gb'"
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t "$LC_T")
restore
# Predicted RED: 2 failed. 'declares history-switches' (toBe); the new case at 'the row spells a switch otherwise than lib's SWITCHES'.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# L2: the new path spelled as spec §9.4's column does, relative.
mut shared/lifecycle.ts ', ~/.ccrc/history/headless-on' ', history/headless-on'
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t "$LC_T")
restore
# Predicted RED: 2 failed, as L1, the arrays differing in their third element.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# L3: the tier's figure drifts from the constant.
mut shared/lifecycle.ts 'bounded at 64 KiB' 'bounded at 128 KiB'
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t "$LC_T")
restore
# Predicted RED: 1 failed, the new case at the tier toBe. 'declares history-switches' stays green (it pins the root only).
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# L4: the tier back at spec rev 3.6's words, without the store line.
mut shared/lifecycle.ts 'one store line plus one line per listed family' 'one line per listed family'
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t "$LC_T")
restore
# Predicted RED: 1 failed, the new case at the tier toBe.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# L5: the tier carries the byte count beside the constant's name.
mut shared/lifecycle.ts '64 KiB (HEADLESS_LIST_MAX_BYTES)' '64 KiB (65536 B, HEADLESS_LIST_MAX_BYTES)'
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t "$LC_T")
restore
# Predicted RED: 1 failed, the new case at the tier toBe.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# L6: the constant moves and the row does not (lib's bound doubled).
mutline ccd/history/lib.mjs '^export const HEADLESS_LIST_MAX_BYTES = [^;]*;.*$' 'export const HEADLESS_LIST_MAX_BYTES = 131072;'
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t "$LC_T")
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t "$RM_T")
restore
# Predicted RED: lifecycle 1 failed, the new case at the tier toBe (expected '… 128 KiB …'); its grammar half is not
# reached. history-cli 1 failed, 'states the marker from lib' at 'more than 128 KiB'.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# L7: the grammar takes one byte more than the bound the row states.
mutfn ccd/history/lib.mjs parseHeadlessList 'HEADLESS_LIST_MAX_BYTES' '(HEADLESS_LIST_MAX_BYTES + 1)'
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t "$LC_T")
restore
# Predicted RED: 1 failed, the new case at 'a marker one byte over the bound parses' (expected true to be false).
# If mutfn refuses ("does not occur in parseHeadlessList"), the size check lives outside the parser: stop and report (R2).
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# L8: the formatter writes a second store line (the tier's "one store line" broken).
mutfn ccd/history/lib.mjs formatHeadlessList 'return ' "return 'store x\\n' + "
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t "$LC_T")
restore
# Predicted RED: 1 failed, the new case at the formatter's lines (an extra 'store x' first).
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# RD1: README drops a seam word.
mut README.md '`headless-arm-unknown` for an arm' '`headless-arm` for an arm'
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t "$RM_T")
restore
# Predicted RED: 1 failed, 'names every exit-2 word' at 'README does not name headless-arm-unknown'.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# RD2: README states step 1 out of order (the marker rows swapped).
mut README.md '`headless-unarmed` with no marker; `headless-malformed` when' '`headless-malformed` with no marker; `headless-unarmed` when'
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t "$RM_T")
restore
# Predicted RED: 1 failed, 'names every exit-2 word' at 'README states step 1 out of W2-D46 order'. Every word is still named.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# RD3: README's pair bound drifts from HEADLESS_LIST_MAX_PAIRS.
mut README.md 'more than 1,000 families' 'more than 100 families'
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t "$RM_T")
restore
# Predicted RED: 1 failed, 'states the marker from lib' at 'more than 1,000 families'.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# RD4: lib gains a seam word README does not name.
mut ccd/history/lib.mjs "'headless-unarmed', 'headless-in-pane', 'headless-unlisted', 'no-identity'," "'headless-unarmed', 'headless-in-pane', 'headless-unlisted', 'headless-zz', 'no-identity',"
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t "$RM_T")
restore
# Predicted RED: 1 failed, 'names every exit-2 word' at 'README does not name headless-zz'.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# RD5: README names another marker path than SWITCHES.
mut README.md '`~/.ccrc/history/headless-on`, which nothing' '`~/.ccrc/headless-on`, which nothing'
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t "$RM_T")
restore
# Predicted RED: 1 failed, 'states the marker from lib' at the path.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# RD6: README narrows the verbs that ignore the seam (W2-D47).
mut README.md '`status`, `doctor` and the operator verbs ignore all three' '`status` ignores all three'
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t "$RM_T")
restore
# Predicted RED: 1 failed, 'names the three variables'.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# RD7: README misspells a variable.
mut README.md '`CCRC_RECALL_ASOF`, the uuid' '`CCRC_RECALL_AS_OF`, the uuid'
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t "$RM_T")
restore
# Predicted RED: 1 failed, 'names the three variables' at 'README does not name CCRC_RECALL_ASOF'.
```

```bash
. .superpowers/sdd/history-w2-2b/t5/mut.sh
# RD8: lib's pair bound moves and README does not.
mutline ccd/history/lib.mjs '^export const HEADLESS_LIST_MAX_PAIRS = [^;]*;.*$' 'export const HEADLESS_LIST_MAX_PAIRS = 2000;'
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t "$RM_T")
restore
# Predicted RED: 1 failed, 'states the marker from lib' at 'more than 2,000 families'.
```

After the last block:

```bash
for f in shared/lifecycle.ts README.md ccd/history/lib.mjs; do cmp ".superpowers/sdd/history-w2-2b/t5/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
git status --short
```

Expected: the loop prints nothing, and `git status --short` lists exactly `shared/lifecycle.ts`, `README.md`, `server/test/lifecycle.test.ts` and `server/test/history-cli.test.ts`, modified (`ccd/history/lib.mjs` is not listed: its mutants are restored). If a mutant stays green, its guard does not hold: report it, and never weaken the guard or fit a CONTROL to the mutant. Record each measured red line in the scratch notes, for the commit body.

**Mutants, by guard:**

| Guard (new unless named) | Mutant | Must red | Must stay green |
|---|---|---|---|
| `declares history-switches`' root (existing, edited) | L1, L2 | `declares history-switches` | — |
| the new case: the root's three paths are `SWITCHES`' | L1, L2 | the new case | — |
| the new case: the tier, exactly, from `HEADLESS_LIST_MAX_BYTES` | L3, L4, L5, L6 | the new case | `declares history-switches` (L3, L4, L5) |
| the new case: the grammar takes exactly the bound | L7 | the new case's over-bound assertion | its at-bound assertion and CONTROLs |
| the new case: one store line plus one line per family | L8 | the new case's formatter lines | — |
| README case: three variables, the driver, empty as unset, box verbs | RD6, RD7 | `names the three variables` | the other two cases |
| README case: path, grammar, bounds, arm words from lib | RD3, RD5, RD8, L6 | `states the marker from lib` | the other two cases |
| README case: every seam word, derived from `REASONS`, in step-1 order | RD1, RD2, RD4 | `names every exit-2 word` | the other two cases |

- [ ] **Step 8: Run the neighbours that read these files.** Each in the foreground with a timeout of at least 600000 ms, one per tool call, from the repository root. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes: `session-hook` and `typecheck-tests` are among them).

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'README states')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts -t 'README states')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'no false positive: 1 MiB of prose')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored|the two documents say what the code does')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/install-session-hooks.test.ts -t 'hook section states the managed timeout')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts -t 'README')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/license.test.ts -t 'README states the notice')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/rings/shared-imports.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean')
```
```bash
git fetch origin main && (cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: green. The predictions, by file:
- **`lifecycle`**: Step 1's count plus 1 (one case added; the switches case edited in place). The O17 thirteen-class case and `every history class names its creators and its tier` are unchanged: no class is added and the tier is non-empty.
- **`history-cli -t 'README states'`**: 4 passed (W2-1's case and this task's three).
- **`history-skill`'s README describe**: unchanged; the once-only phrases still occur once each.
- **`history-lib`'s no-false-positive case**, **`session-hook`'s two describes**, **`topology-clean`**, **`install-session-hooks`**, **`box-token-census`**, **`license`**: unchanged counts, green.
- **`single-definition -t 'ccrc history'`**: unchanged. O13's `headless-on` row still lists `['ccd/history/lib.mjs']` (neither `shared/lifecycle.ts` nor README is in its corpus), and O14's `VOCABS` rows for Task 1's three constants still find one declaration each.
- **`shared-imports`**: green; `shared/lifecycle.ts` still imports nothing.
- **`citations`**: green; no numeric line citation was added (D-5893).
- **`typecheck-tests`**: green; `lib.d.mts`' declarations type both new cases' dynamic imports. A red names a declaration mismatch: report it, never cast the test into silence.
- **`deviation-refs`**: green; this task cites D-5767, D-5768 and D-5769, which this plan defines, and D-5748, D-5893, D-6045 and D-6178, defined before it. It defines none.

Compare each count with Step 1's notes.

- [ ] **Step 9: Commit.** This task defines no departure, so `## Deviations found` is not touched.

First write the message, with a quoted heredoc so nothing in it is expanded:

```bash
cat > .superpowers/sdd/history-w2-2b/t5/commit-msg.txt <<'EOF'
feat(history): the history-switches row names headless-on and its 64 KiB bound, and README states the headless seam (W2-2b Task 5; W2-D49, W2-D44, W2-D46, W2-D47, W2-D48)

<each mutant's measured red line from Step 7, all sixteen, one line each, its mutant first>
<the passing counts of Steps 6 and 8>
<any re-anchoring Step 1 needed, or: no re-anchoring>

<the attribution line the session's reminder names>
EOF
```

Replace each `<…>` line with what it names, from the scratch notes. Then:

```bash
for f in shared/lifecycle.ts README.md ccd/history/lib.mjs; do cmp -s ".superpowers/sdd/history-w2-2b/t5/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
grep -c '^<' .superpowers/sdd/history-w2-2b/t5/commit-msg.txt
git add shared/lifecycle.ts README.md server/test/lifecycle.test.ts server/test/history-cli.test.ts
git status --short
git commit -F .superpowers/sdd/history-w2-2b/t5/commit-msg.txt
git status --short
```

Expected: the loop prints nothing (a `NOT RESTORED` line stops the commit: report it); then `0` (no placeholder left); then `git status --short` lists exactly these four files, staged, before the commit, and nothing after it. Nothing under `.superpowers/` appears: it is gitignored.

---

### Task 6: the whole-PR checks, the departures check and the PR

W2-2b never holds the spec path (W2-D3: only 5h-1, 5h-2, W2-1, W2-5b and W2-6 claim it). The five errata this PR's code makes true are amended in place by W2-5b (decisions §6, "Amended by"), never by W2-2b: E2's W2-2b half (§8.3's exit-2 row gains `headless-malformed` and `headless-arm-unknown`), E7 (§9.4's history-switches row: the `headless-on` tier, 64 KiB and a store line), E8 (§8.2's generation chain and its `--workspace` anchor on the env path), E9 (§8.2's marker grammar and §9.7's headless-on row) and E10 (§8.2's "counted `scope_source=env`" reads as `recall_calls.arm IS NOT NULL`, a reading with no number). So the spec stays at rev 3.6 with W2-1's errata, byte for byte, and this task checks that each of those rev 3.6 sentences still stands once. It adds no code, no test and no guard. It checks that the PR holds only W2-2b's files, that D-5767, D-5768 and D-5769 are defined once each, that no lifecycle key other than the switches row moved (W2-D9, W2-D49), that README moved only inside its Session history section, that lib's redaction declarations are byte-identical to the merge-base (W2-2a's rules-same check, reused), and that every refusal W2-2b owns has a case at its step of W2-D46's order with a CONTROL one step later; it runs the whole-PR checks, writes the PR body and opens the PR.

This plan defines exactly three departures, all in "## Deviations found" at its end, in the em-dash form, landed on `main` with the plan before dispatch (R9), as W2-2a's plan was (its R7): **D-5767** (`history-w2-env-identity-from-asof`, W2-D40: on the env path the family comes from ASOF, and `CCRC_SESSION_GENERATION`, `$REG/<id>.generation` and the newest-family fallback are never read; `--workspace` anchors on the ASOF epoch's `cwd_real ?? cwd`, never on `$REG/<id>.workdir`; erratum E8), **D-5768** (`history-w2-marker-grammar`, W2-D44: a required `store <store_id>` line and a grammar beyond §8.2's "one per line", `-` for the legacy `''`, comments, a 64 KiB and 1,000-pair bound, zero pairs answering `headless-unlisted`; errata E7 and E9) and **D-5769** (`history-w2-headless-refusal-words`, W2-D48: the plan-chosen spellings `headless-malformed` and `headless-arm-unknown`; erratum E2's W2-2b half). Section 6 of the decisions document names W2-2b as their "Defined in" PR. This task checks each is there once, in the commit that first cites it, and defines nothing. A number this run's block issued for a departure found while executing is defined in the commit that first cites it, and Step 2 lists it. Cited bare, defined elsewhere: D-5765 and D-5766 (the W2-2a plan: `asof-invalid` and the time cut, whose pre-store and family halves W2-2b adds under the same word), D-5745 (the 5h-2 plan: the widened rules), D-5774 (the W2-3 plan: the gate declares no lib name), D-5893 (no added numeric line citation), and D-6178, D-6211 and D-6223 (the armed growth check, its PR exemption and its waiver ledger).

**Files:** (anchors measured at `d119d6e90`, `main` at `4f9d7ac4d` plus wave W2-2a, #1126; every one is re-anchored by its content)
- Modify: none by default. This task edits this plan (`docs/superpowers/plans/2026-10-22-ccrc-history-w2-2b-headless-seam.md`) only to correct a figure in its own text that a step measured otherwise (a task's predicted count or output); it never adds or edits a `## Deviations found` entry.
- Read, no edit: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (§8.2's generation sentence, about :1509; `--workspace`'s anchor, about :1514; the headless bullets, about :1525-1531; §8.3's exit-2 row, about :1671; §9.4's history-switches row, about :2171; §9.7's headless-on row, about :2307; the status line, :3); this plan's `## Deviations found`; `server/test/growth-check.test.ts`' `GROWTH_FILES` (about :57); `server/test/growthCheck.ts`' `GROWTH_LIMIT`, `L1_L2_NEW_FILE_DIRS` and `GROWTH_MACHINERY` (about :46, :54 and :320); `server/test/growth-waivers.json`; `shared/lifecycle.ts`' history-switches row (about :81-83); `server/test/lifecycle.test.ts`' `HISTORY_ROWS_BY_PR` and `HISTORY_LANDED` (about :1095-1105) and its case `declares history-switches` (about :1216-1225); `single-definition.test.ts`' O13 describe (about :5111, `HOLDERS` about :5124-5131), O14 describe (about :5319, its `VOCABS` about :5321), the symbolic write scan (about :5489), the env allow-list (about :5464-5467) and W2-2a's seam-name holders describe (about :8476); README's "Session history: lossless recall" section (about :5784 to the `---` rule about :5868).
- Create (gitignored scratch, never committed): `.superpowers/sdd/history-w2-2b/rules-same.mjs`, `.superpowers/sdd/history-w2-2b/switches-only.mjs`, `.superpowers/sdd/history-w2-2b/readme-section.mjs`, `.superpowers/sdd/history-w2-2b/titles.txt`, `.superpowers/sdd/history-w2-2b/names-control.tsv` and `.superpowers/sdd/history-w2-2b/pr-body.md`.
- Never edited by this task or this PR: the spec; `deploy/**`; `.github/**`; `CLAUDE.md`; the programme ledger and the W2 decisions document; `ccd/history/derive.mjs`, `store.mjs`, `store.d.mts`, `regex-worker.mjs` and `card.mjs`; `ccd/history-skill/SKILL.md` (W2-D48: its exit-2 row is generic); `ccd/session-hook.sh`, `ccd/ccd`, `ccd/ccrc` and `ccd/ccd-history-sweep`; every lifecycle row but history-switches (W2-D9); the growth check's own files (`GROWTH_MACHINERY`) and `growth-waivers.json`. Step 1 checks every one.

**Interfaces:**
- Consumes (names the checks and the PR body state; Step 1 measures each, and this task defines none):
  - `ccd/history/lib.mjs`: `RECALL_ARMS` (`Object.freeze(['control', 'treatment'])`, W2-D42), `HEADLESS_LIST_MAX_BYTES` (65,536) and `HEADLESS_LIST_MAX_PAIRS` (1,000) (W2-D44), each exported, declared once in `lib.d.mts` and named in O14's `VOCABS`; `parseHeadlessList(text)` and `formatHeadlessList({ storeId, pairs })` (W2-D44; W2-5b's `marker` subcommand calls the formatter); `headlessMarkerOf(read)` (R1); `decideHeadless({ recall, paneSet, marker })` (W2-D45, W2-D46, R1), `decideHeadlessStore({ list, storeId })`, `asOfFamilySql()` and `decideAsOfFamily({ session, asof, rows, list, storeId })` with `via: 'asof'` (W2-D40, W2-D44, R3); `decideEnvProject` and `decideHeadlessRead` (W2-D41, W2-D46); `REASONS['headless-malformed'] === EXIT.REFUSED` and `REASONS['headless-arm-unknown'] === EXIT.REFUSED` (W2-D48, D-5769), so `Object.keys(REASONS).length` goes from 54 to 56 and `REFUSALS.length` from 36 to 38; `SCOPE_SOURCES` deep-equal to `['tmux', 'env']` (W2-D41, C50); `resolveGeneration` byte-identical to the merge-base (W2-D40: the tmux path's chain is not edited); `recallSeamEngaged` and `decideSeamInPane` called by `decideHeadless`, kept and unchanged (R1); lib's 67 redaction declarations, unchanged;
  - `ccd/history/cli.mjs`: `recallLine(i)` writing `arm` on every counted env call and never on a tmux call (W2-D43); the marker read on one line, only on the headless path, through store.mjs's `readBounded` at `HEADLESS_LIST_MAX_BYTES` with no link followed (O_RDONLY | O_NOFOLLOW | O_NONBLOCK, a regular file, at most `HEADLESS_LIST_MAX_BYTES + 1` bytes), folded by `headlessMarkerOf` (W2-D44, R1); `seen.id`, `seen.gen` and `seen.arm` set at step 4's admission (R4);
  - `ccd/history/sweep.mjs`: the drain skips the `recall_off_stale` bump for a line carrying `arm` (W2-D43);
  - `shared/lifecycle.ts`: the history-switches row's root naming `~/.ccrc/history/headless-on` and its tier W2-D49's words, 64 KiB and `HEADLESS_LIST_MAX_BYTES` (R12), every other row unchanged;
  - `server/test/single-definition.test.ts`: the O13 `HOLDERS` row `['headless-on', ['ccd/history/lib.mjs']]` unchanged; the symbolic write scan's `KEYS` unchanged and green; O14's `VOCABS` holding `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES` and `HEADLESS_LIST_MAX_PAIRS`; the env allow-list still exactly seven names;
  - `server/test/lifecycle.test.ts`: the case `declares history-switches` pinning the new root and tier; `HISTORY_ROWS_BY_PR` and `HISTORY_LANDED` unchanged (history-switches landed in B1, and no `W2-2b` key is added);
  - the seam cases Tasks 1 to 5 added to `history-cli.test.ts`, `history-lib.test.ts` and `history-sweep.test.ts` (Step 4 takes their census by title; `history-recall.test.ts` gets none);
  - this plan's D-5767, D-5768 and D-5769, each defined once in "## Deviations found".
- Produces: text only. The PR body file and the PR. No repository file by default.

**Decisions:** W2-D2 (the fleet lane runs one PR at a time; W2-2b after W2-2a, and the last fleet-lane PR before W2-5b), W2-D3 (no spec path; E2, E7, E8, E9 and E10 are W2-5b's), W2-D4 (D-5767, D-5768 and D-5769 defined once, in this plan), W2-D5 (no new file), W2-D6 and W2-D10 (rollout with W2's final release; no schema change, no migrate), W2-D9 (no lifecycle key but the switches row), W2-D12 (O14's three constants), and W2-D40 to W2-D49 as the PR body states them; W2-D50 is W2-4's and W2-5b's, and this PR supplies only the names it needs (`RECALL_ARMS`; the three seam names the CLI already reads, so the allow-list stays at seven).

**Choices this task makes:**
- **No spec edit, and the check that there is none.** Step 1 asserts the spec's diff is empty, that each rev 3.6 sentence E2, E7, E8, E9 and E10 change still stands once, that the spec names none of `headless-malformed`, `headless-arm-unknown`, `asof-invalid`, `RECALL_ARMS` or `HEADLESS_LIST_MAX_BYTES`, and that line 3 still reads rev 3.6. The PR body says the spec stays rev 3.6 with W2-1's errata until W2-5b.
- **The departures are checked where they were first cited.** The plan lands on `main` before dispatch (R9), so the three entries are at the merge-base and no PR commit adds one. Step 2 does not rely on that: for every number this plan defines, it finds the first commit, on this branch's history, whose diff in this plan or in W2-2b's paths cites the number, and the first commit whose diff adds its entry, and requires them equal. The same rule covers a number this run's block issued during the build. No D-number range is ever written: every loop names each number on its own.
- **Lifecycle: the switches row and its cases, nothing else.** `switches-only.mjs` compares `shared/lifecycle.ts` and `lifecycle.test.ts` at the merge-base and at HEAD with three blocks cut out by content: the history-switches row with the comment lines directly above it, the `declares history-switches` case, each found once on both sides, and Task 5's appended `the history-switches tier is lib's` case with its blank line and header, absent at the base and at most once at HEAD; everything else must be identical. Its CONTROL, run first on W2-1's change (`02d75ae5f` to `cd622b2f6`, which added the history-recall-off row and its case), must red; its second CONTROL, on W2-2a's squash commit on `main` (`$W2A^` to `$W2A`, found by its `(#1126)` subject; measured at planning time as `4f9d7ac4d` to `d119d6e90`, the same diff, no lifecycle edit), must read clean. Both were measured at planning time on a read-only checkout of `d119d6e90`.
- **README: the Session history section, nothing else.** `readme-section.mjs` requires every changed README line, on either side of the diff, to lie between the heading `### Session history: lossless recall (`ccrc history`)` and the `---` rule after it. Its CONTROL, run on #1054's change (`3e029984a` to `105e1ea2a`), must red; W2-1's own README change (`cd622b2f6~1` to `cd622b2f6`, eight lines inside the section) must read clean. Both measured at planning time.
- **The redaction rules stay byte-identical (W2-2a's rules-same check, reused).** The ledger's "Later" item on the display doors and the widened rules waits for "the first wave after 5h-2 that may change a base reading or the widened rules (D-5745's)". W2-2b changes neither: it decides who may read and under which cut, never what a door prints for a text. Step 3 reuses W2-2a's script unchanged (its CONTROL, 5h-2's change `3af16cf97` to `02d75ae5f`, names 33 redaction declarations and exits 1; W2-2a's own change, its squash commit `$W2A^` to `$W2A`, measured at planning time as `4f9d7ac4d` to `d119d6e90`, prints `redaction declarations: 67; changed: none`), then runs it over this PR. The item stays open, and the PR body says so.
- **growth-check lists no W2-2b file.** `GROWTH_FILES` is `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh`, `server/src/watch.ts`, `server/src/coord/store.ts`, `server/src/coord/routes.ts`, `server/src/server.ts`, `server/src/sessionws.ts` and `pwa/src/lib/api.ts`: neither `shared/lifecycle.ts` nor `README.md` is listed, and no `ccd/history/` path is. `shared/` is in `L1_L2_NEW_FILE_DIRS`, but that list only waives growth when a diff ADDS a file under it; W2-2b adds none (W2-D5), so it neither needs nor uses that waiver. The check is armed (D-6178): every row reads `delta +0`, `GROWTH_OVER: (none)` and `ledger entries this diff adds: (none)`; no waiver entry (D-6223), no exemption (D-6211) and no `GROWTH_MACHINERY` file is in the diff. Growth in `lib.mjs` or `cli.mjs`, however large, is not measured by it.
- **The refusal order is counted by title, then read.** W2-D46 fixes the order and W2-D45 when the seam engages. Step 4 lists every added test title and counts, per row of the table below, the titles naming the row and those naming a CONTROL; the worker then reads each case to confirm it asserts the right word at the right step, and that its CONTROL, one step later in the order (the same fixture with the earlier condition cured), answers the next row's word. A row with no case, or with no CONTROL anywhere, is a finding against the task that ships the row's decision, reported to the coordinator and never added here.
- **No commit by default.** Every edit this PR makes is in Tasks 1 to 5. If a step measures a figure that differs from a prediction in this plan's text, the correction is this task's one commit, touching only this plan's text.
- **Free-space cases are box state, not breaks.** Three cases, two in `history-holds` and one in `history-export`, read the box's real free space and fail on a box below the store's free-space floor, at the base too (the ledger's "Later" item from W2-1's reviews). A red there is re-run alone; if it still reds, the worker names each case by title, records the assertion line and the free space of the test volume (`df -P --output=avail` on the fixture root, a number only), and says so in the PR body. CI on the quiet box is the arbiter, and only for a file its selection ran.

**The seam's order, and the decision whose task pins each row** (W2-D45, W2-D46; the security properties of W2-D40, W2-D43, W2-D44 and W2-D46 as rows of their own). Each refusal is a case at its step with a CONTROL one step later. The Task column is filled from this plan's File Structure, by the decision named:

| Step (W2-D46) | Condition | Answer | CONTROL one step later | Decision |
|---|---|---|---|---|
| 1 (no seam) | every `CCRC_RECALL_*` unset or empty | the tmux path, byte for byte the base's (statements, answer, counter line) | one variable non-empty engages the seam | W2-D45 |
| 1 (pane) | a seam variable non-empty and `TMUX_PANE` defined, `''` included | exit 2 `headless-in-pane`, before any tmux spawn (C4) | `TMUX_PANE` unset: `headless-unarmed` with no marker | W2-D45 (W2-2a's half, called per R1) |
| 1 (marker absent) | no `headless-on` | exit 2 `headless-unarmed` (C30) | a malformed marker: `headless-malformed` | W2-D44, W2-D46 |
| 1 (marker unusable) | a FIFO, a symlink, a directory, an unreadable file, more than 65,536 bytes, a CR, leading or trailing whitespace, a missing or second store line, an unknown line, more than 1,000 pairs, invalid UTF-8 | exit 2 `headless-malformed`, never blocking on a FIFO | the same marker made well-formed: `no-identity` with SESSION unset | W2-D44, W2-D48 |
| 1 (identity) | `CCRC_RECALL_SESSION` unset or empty | exit 2 `no-identity` | SESSION set to an id off the grammar: `bad-id` | W2-D46 |
| 1 (grammar) | SESSION fails `idOk` | exit 2 `bad-id` | a good id on no list line: `headless-unlisted` | W2-D46 |
| 1 (listed) | the id is on no list line; zero pairs | exit 2 `headless-unlisted` (C30) | listed, ARM empty: `headless-arm-unknown` | W2-D44 |
| 1 (arm) | ARM empty, absent or outside `RECALL_ARMS` | exit 2 `headless-arm-unknown`, before the store is opened | ARM valid, ASOF empty: `asof-invalid` | W2-D42, W2-D48 |
| 1 (asof, pre-store) | ASOF empty or not a UUID | exit 2 `asof-invalid`, before the store is opened | ASOF a UUID: the harness step | W2-D42 (D-5765's word) |
| 2 | `$REG/<id>.harness` without a `HARNESS_TABLE` row | exit 2 `harness-unsupported` (residual: read from the registry, fail closed) | `claude-code`: the store steps | W2-D40, W2-D46 |
| 4 (family) | ASOF names no boundary on a main transcript of exactly one family of SESSION (merged_into followed) | exit 2 `asof-invalid`, with no counter line (R5) | the same ASOF in a listed family: admitted, one counter line | W2-D40 (D-5767) |
| 4 (store line) | the marker's `store` line is not this store's `store_id` | exit 2 `headless-unlisted`, with no counter line (R5), before any ASOF row is read, so a fault planted on that read never fires (R3) | the store's own id: admitted, and under the same fault a read failure, uncounted | W2-D44 (D-5768) |
| 4 (registry never read) | purge and reuse: (X, G1) listed, ASOF in G1, `$REG` and `CCRC_SESSION_GENERATION` both say G2 | the default scope and `--session X` both read G1; a merged `''` family is admitted | a mutant reading the registry or the env generation reds | W2-D40 (D-5767) |
| 4 (workspace) | `--workspace` on the env path | anchors on the ASOF epoch's `cwd_real ?? cwd`, never on `$REG/<id>.workdir` | the tmux path still anchors on the workdir | W2-D40 (D-5767) |
| 5 | `recall-off/<id>` naming the resolved generation | exit 8, counted with `arm` (C30) | a stale `recall-off`: ARM decides | W2-D46 |
| 6 | `ARM=control` | exit 8, counted with `arm` (C30) | `ARM=treatment`: the verb runs | W2-D42 |
| 7 (guard) | the resolved family's stored project differs from the registry project `decideScope` used, the default scope included (R7) | exit 2 `cross-project` | the same project: the cut and the verb | W2-D41 |
| 7 (cut) | `--project`, `--workspace` or `--session` on the env path | the cut applies to every family in scope; a family with no visible epoch is dropped from the scope and its count | the same widened scope with no cut lists it | W2-D41 (W2-2a's `visibleScope`) |
| counting | any refusal, failed read or defect before step 4's admission / admitted at step 4 | no counter line / exactly one line, with `arm`, and `gen` when the resolved generation is a UUID; never `arm` on a tmux call (C24 under env) | the tmux call's line, without `arm` | W2-D43, W2-D46 |
| counting (C-R) | a treatment-arm call on a listed family that is also a live A/B family | `recall_calls.arm` non-null | a tmux call on that family: `arm` null | W2-D43 |
| drain | a spooled line carrying `arm` with a stale `recall-off` | no `recall_off_stale` bump | the same line without `arm` bumps it | W2-D43 |
| history-off | `~/.ccrc/history-off` present on an env call | nothing written, at any step | the same call without it writes its line | W2-D46 |
| box verbs | `status`, `doctor` and the operator verbs with SESSION and ARM set | exit 0, no identity derived, no line written (C28 extended) | — (no seam on a box verb) | W2-D47 |
| scope source | `decideScope` with `source: 'env'`, `'tmux'` or an unknown word | the same verdicts as the CLI; unknown refused, never defaulted (C50) | `'tmux'` | W2-D41 |
| O13 | any `.mjs`, bash or skill line naming `/headless-on`, or pairing a write verb (`open` included) with `.headlessOn` | holders stay `['ccd/history/lib.mjs']`; the symbolic scan stays green | the scans' own CONTROL cases | W2-D44 |
| O14, O17 | the three constants; the switches row | each declared once in lib.mjs; the row's new root and tier pinned | the describes' CONTROL cases | W2-D12, W2-D49 |

- [ ] **Step 0: Measure the base and main.** From the repository root:

```bash
git fetch origin main
W2A=$(git log --format=%H -1 -E --grep='[(]#1126[)]$' origin/main)
test -n "$W2A" && git merge-base --is-ancestor "$W2A" HEAD && echo 'on W2-2a' || echo 'BASE MISSING'
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-2b-headless-seam.md
git cat-file -e "origin/main:$PLAN" && echo 'plan on main' || echo 'PLAN NOT ON MAIN'
MB=$(git merge-base origin/main HEAD); git rev-parse --short "$MB"
git diff --name-only "$MB" origin/main | grep -xF -f <(git diff --name-only "$MB" HEAD) || echo 'main moved no path of this PR'
```

Expected: `on W2-2a`; `plan on main`; the merge-base's short sha; `main moved no path of this PR`. W2-5a and other deploy-lane PRs run beside this one on disjoint files (W2-D2), so a listed path is another PR's edit of one of ours: merge `origin/main` (never a rebase), keep both sides, and run Steps 1 to 5 on the merge. `BASE MISSING` or `PLAN NOT ON MAIN` stops the task: report it to the coordinator. A conflict in a path outside this PR's list is reported, never resolved here.

- [ ] **Step 1: Check that the PR holds only W2-2b's files, and what they state.** From the repository root:

```bash
MB=$(git merge-base origin/main HEAD)
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-2b-headless-seam.md
SPEC=docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
git diff --name-only "$MB" HEAD | grep -vxF -f <(printf '%s\n' \
  ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/cli.mjs ccd/history/sweep.mjs ccd/history/recall.mjs \
  shared/lifecycle.ts README.md "$PLAN" server/test/history-cli.test.ts server/test/history-lib.test.ts \
  server/test/history-recall.test.ts server/test/history-sweep.test.ts server/test/single-definition.test.ts \
  server/test/lifecycle.test.ts) || echo 'only W2-2b files'
git diff --name-only "$MB" HEAD -- ccd/history/recall.mjs | wc -l
git diff --name-only "$MB" HEAD -- docs/superpowers/specs deploy .github CLAUDE.md docs/superpowers/programs \
  docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md ccd/history/derive.mjs ccd/history/store.mjs \
  ccd/history/store.d.mts ccd/history/regex-worker.mjs ccd/history/card.mjs ccd/history-skill ccd/session-hook.sh \
  ccd/ccd ccd/ccrc ccd/ccd-history-sweep server/test/growthCheck.ts server/test/growth-check.test.ts \
  server/test/growth-exemptions.json server/test/growth-waivers.json server/test/rings server/test/scan/parse.ts | wc -l
git diff --name-only --diff-filter=A "$MB" HEAD | wc -l
for n in $(git diff "$MB" HEAD -- ccd/history/lib.mjs | sed -nE 's/^\+export (async )?(function\*? |const |let )([A-Za-z_$][A-Za-z0-9_$]*).*/\3/p' | sort -u); do
  git show "$MB":ccd/history/lib.mjs | grep -qE "^export (async )?(function\*? |const |let )$n\b" && continue
  printf 'added %s d.mts %s' "$n" "$(grep -cE "^export (function|const|let) $n\b" ccd/history/lib.d.mts)"
  case "$n" in [A-Z]*) grep -qw "'$n'" server/test/single-definition.test.ts && printf ' bound\n' || printf ' UNBOUND\n';; *) printf '\n';; esac
done
for n in $(git diff "$MB" HEAD -- ccd/history/lib.mjs | sed -nE 's/^-export (async )?(function\*? |const |let )([A-Za-z_$][A-Za-z0-9_$]*).*/\3/p' | sort -u); do
  grep -qE "^export (async )?(function\*? |const |let )$n\b" ccd/history/lib.mjs && continue
  printf 'removed %s d.mts %s users %s\n' "$n" "$(grep -cE "^export (function|const|let) $n\b" ccd/history/lib.d.mts)" \
    "$(git grep -lw "$n" -- ccd deploy server/test shared | wc -l)"
done
node --input-type=module -e "const l = await import('./ccd/history/lib.mjs'); console.log(JSON.stringify(l.RECALL_ARMS), Object.isFrozen(l.RECALL_ARMS), l.HEADLESS_LIST_MAX_BYTES, l.HEADLESS_LIST_MAX_PAIRS, l.REASONS['headless-malformed'], l.REASONS['headless-arm-unknown'], l.EXIT.REFUSED, Object.keys(l.REASONS).length, l.REFUSALS.length, JSON.stringify(l.SCOPE_SOURCES), ['parseHeadlessList', 'formatHeadlessList', 'decideHeadless', 'decideAsOfFamily'].map((n) => typeof l[n]).join(','))"
node -e "const s=require('fs').readFileSync('server/test/single-definition.test.ts','utf8'); const o14=s.indexOf('every vocabulary is declared once, in lib.mjs'); const v=s.slice(o14, s.indexOf('] as const;', o14)); console.log(['RECALL_ARMS','HEADLESS_LIST_MAX_BYTES','HEADLESS_LIST_MAX_PAIRS'].map((n)=>n+' '+(v.match(new RegExp(\"'\"+n+\"'\",'g'))||[]).length).join(' ')); const m=/const ALLOWED = (\[[^\]]*\])/.exec(s); console.log(m ? [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x)=>x[1]).sort().join(' ') : 'ALLOWED not found'); console.log((s.match(/\['headless-on', \['ccd\/history\/lib\.mjs'\]\]/g)||[]).length)"
git diff "$MB" HEAD -- ccd/history | grep -E '^\+.*process\.env' \
  | grep -vE "process\.env(\.|\[')(HOME|TMUX_PANE|CLAUDECODE|CCRC_SESSION_GENERATION|CCRC_RECALL_SESSION|CCRC_RECALL_ARM|CCRC_RECALL_ASOF)\b" \
  || echo 'every new env read is one of the seven, by name'
diff <(git show "$MB":ccd/history/lib.mjs | sed -n '/^export function resolveGeneration(/,/^}/p') \
  <(sed -n '/^export function resolveGeneration(/,/^}/p' ccd/history/lib.mjs) >/dev/null && echo 'resolveGeneration unchanged'
grep -nE '\b(SCHEMA_ADDED|JOURNAL_V)\b' <(git diff "$MB" HEAD -- ccd/history/lib.mjs | grep '^[-+]' | grep -v '^[-+][-+]') || echo 'no schema or journal change'
git diff "$MB" HEAD -- ccd/history server/test shared | grep -nE '^\+.*\b(lib|cli|sweep|store|derive|recall|card|regex-worker)\.mjs:[0-9]' || echo 'no new mjs line citation'
{ git diff "$MB" HEAD | grep '^+' | grep -v '^+++'; git log --format=%B "$MB"..HEAD; } \
  | grep -nE '\bD-[0-9]+(\.\.|-[0-9]|–| to D-)' || echo 'no D-number range'
git diff --quiet "$MB" HEAD -- "$SPEC" && echo 'spec untouched'
for p in '  - The generation is `CCRC_SESSION_GENERATION` when it has the UUID grammar.' \
  "widens to every family with an epoch whose launch directory matches this session's \`\$REG/<id>.workdir\`" \
  'Its content is the pre-registered list of admitted (`ccrc_id`, generation) pairs, one per line, which the operator writes from the W2 open record.' \
  '  - Uses are counted `scope_source=env`.' \
  '<64 B each; `headless-on` one line per listed family' \
  'for the (`ccrc_id`, generation) pairs it lists, one per line' \
  'headless seam (`headless-unarmed`, `headless-in-pane`, `headless-unlisted`; W2), no identity'; do
  grep -cF -- "$p" "$SPEC"; done | tr '\n' ' '; echo
grep -cE 'headless-malformed|headless-arm-unknown|asof-invalid|RECALL_ARMS|HEADLESS_LIST_MAX' "$SPEC"
sed -n '3p' "$SPEC" | grep -c 'rev 3\.6'
```

Expected:
- `only W2-2b files`; then `0` for `recall.mjs` (not edited); `0` (no never-edit path); `0` (no added file: W2-D5, and the plan is on `main` before dispatch);
- one `added` line per new lib export, each `d.mts 1` (count them: `skipLibCheck` hides a duplicate): `HEADLESS_LIST_MAX_BYTES`, `HEADLESS_LIST_MAX_PAIRS`, `RECALL_ARMS`, `asOfFamilySql`, `decideAsOfFamily`, `decideEnvProject`, `decideHeadless`, `decideHeadlessRead`, `decideHeadlessStore`, `formatHeadlessList`, `headlessMarkerOf` and `parseHeadlessList`, every upper-case one `bound`; and no `removed` line (R1: `recallSeamEngaged` and `decideSeamInPane` are called, not folded). An `UNBOUND`, a `d.mts` count other than 1, or a `removed` line is a finding against the task that made it;
- `["control","treatment"] true 65536 1000 2 2 2 56 38 ["tmux","env"] function,function,function,function` (54 and 36 at `d119d6e90`: W2-2b adds exactly C16's two words);
- `RECALL_ARMS 1 HEADLESS_LIST_MAX_BYTES 1 HEADLESS_LIST_MAX_PAIRS 1` (O14), then `CCRC_RECALL_ARM CCRC_RECALL_ASOF CCRC_RECALL_SESSION CCRC_SESSION_GENERATION CLAUDECODE HOME TMUX_PANE` (seven, unchanged since W2-2a), then `1` (O13's headless-on row unchanged);
- `every new env read is one of the seven, by name`; `resolveGeneration unchanged` (W2-D40: the tmux path's chain is byte-identical); `no schema or journal change` (W2-D10); `no new mjs line citation` (D-5893); `no D-number range`;
- `spec untouched`; `1 1 1 1 1 1 1` (E8's two sentences, E9's §8.2 sentence, E10's, E7's, E9's §9.7 row and E2's exit-2 words, each standing once at rev 3.6); `0`; `1`.

Any other path, an eighth env name, a changed `resolveGeneration`, a new line citation, a range, or a spec change is a finding against the task that made it: report it to the coordinator, and never fix it here.

Then the two content checks, each with its CONTROLs measured first. Write the scripts (quoted heredocs, so nothing in them is expanded):

```bash
mkdir -p .superpowers/sdd/history-w2-2b
cat > .superpowers/sdd/history-w2-2b/switches-only.mjs <<'EOF'
// Whether shared/lifecycle.ts and server/test/lifecycle.test.ts differ between two commits ONLY inside the
// history-switches row (with the comment lines directly above it), its one case, and W2-2b Task 5's appended case
// (W2-D49: no other lifecycle key moves). Reads git objects only. A cut marked `once` must be found exactly once on
// both sides; the appended case is absent at the base and at most once at the head.
import { execFileSync } from 'node:child_process';
const [a, b] = process.argv.slice(2);
const show = (ref, f) => execFileSync('git', ['show', `${ref}:${f}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
const CUTS = [
  ['shared/lifecycle.ts', [
    [/^(?:  \/\/.*\n)*  \{ name: 'history-switches',[\s\S]*?\},\n/gm, 'once'],
  ]],
  ['server/test/lifecycle.test.ts', [
    [/^  it\('declares history-switches[\s\S]*?\n  \}\);\n/gm, 'once'],
    [/^\n  \/\/ ── ccrc history W2-2b [\s\S]*?\n  \}\);\n/gm, 'added'],
  ]],
];
let bad = 0;
for (const [f, cuts] of CUTS) {
  let x = show(a, f), y = show(b, f);
  const counts = [];
  for (const [re, kind] of cuts) {
    const nx = (x.match(re) || []).length, ny = (y.match(re) || []).length;
    counts.push(`${nx} ${ny}`);
    if (kind === 'once' ? nx !== 1 || ny !== 1 : nx !== 0 || ny > 1) bad += 1;
    const put = kind === 'once' ? '<switches>\n' : '';
    x = x.replace(re, put);
    y = y.replace(re, put);
  }
  const same = x === y;
  if (!same) bad += 1;
  console.log(`${f}: blocks ${counts.join(', ')}; outside the blocks: ${same ? 'identical' : 'DIFFERS'}`);
}
process.exitCode = bad ? 1 : 0;
EOF
cat > .superpowers/sdd/history-w2-2b/readme-section.mjs <<'EOF'
// Whether every README.md line changed between two commits lies inside the "Session history" section: from its
// heading to the `---` rule that opens the internals reference. Reads git objects only.
import { execFileSync } from 'node:child_process';
const [a, b] = process.argv.slice(2);
const HEAD_LINE = '### Session history: lossless recall (`ccrc history`)';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const section = (ref) => {
  const lines = git('show', `${ref}:README.md`).split('\n');
  const from = lines.indexOf(HEAD_LINE) + 1;
  if (from === 0) throw new Error(`${ref}: no Session history heading`);
  const to = lines.findIndex((l, i) => i >= from && l === '---') + 1;
  if (to === 0) throw new Error(`${ref}: no --- after the heading`);
  return [from, to];
};
const [oa, ob] = section(a), [na, nb] = section(b);
const out = [];
for (const m of git('diff', '-U0', a, b, '--', 'README.md').matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
  const [os, oc, ns, nc] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  if (oc > 0 && (os <= oa || os + oc - 1 >= ob)) out.push(`old ${os},${oc}`);
  if (nc > 0 && (ns <= na || ns + nc - 1 >= nb)) out.push(`new ${ns},${nc}`);
}
console.log(out.length ? `outside the section: ${out.join('; ')}` : 'every changed line is inside the Session history section');
process.exitCode = out.length ? 1 : 0;
EOF
```

Then run the CONTROLs, then the real comparisons, then the row's and the case's new text:

```bash
S=.superpowers/sdd/history-w2-2b
W2A=$(git log --format=%H -1 -E --grep='[(]#1126[)]$' origin/main)
node "$S/switches-only.mjs" 02d75ae5f cd622b2f6; echo "rc $?"
node "$S/switches-only.mjs" "$W2A^" "$W2A"; echo "rc $?"
node "$S/readme-section.mjs" 3e029984a 105e1ea2a > /dev/null; echo "rc $?"
node "$S/readme-section.mjs" cd622b2f6~1 cd622b2f6; echo "rc $?"
MB=$(git merge-base origin/main HEAD)
node "$S/switches-only.mjs" "$MB" HEAD; echo "rc $?"
node "$S/readme-section.mjs" "$MB" HEAD; echo "rc $?"
sed -n "/name: 'history-switches'/,/},\$/p" shared/lifecycle.ts | grep -c '~/.ccrc/history/headless-on'
sed -n "/name: 'history-switches'/,/},\$/p" shared/lifecycle.ts | grep -c '64 KiB (HEADLESS_LIST_MAX_BYTES), one store line plus one line per listed family'
sed -n "/name: 'history-switches'/,/},\$/p" shared/lifecycle.ts | grep -c "creators: \['operator shell'\], collector: null"
git diff "$MB" HEAD -- README.md | grep '^+' | grep -v '^+++' | grep -cE 'CCRC_RECALL_(SESSION|ARM|ASOF)|headless-on'
```

Expected (the four CONTROLs measured at planning time on a read-only checkout of `d119d6e90`, which holds every commit named; W2-2a's was measured as `4f9d7ac4d` to `d119d6e90`, the diff its squash commit `$W2A` carries, since the merge queue squashes and `d119d6e90` is on no branch of `main`; a different figure there is recorded as measured, and Step 0 already stopped if `$W2A` is empty):
- `shared/lifecycle.ts: blocks 1 1; outside the blocks: DIFFERS`, `server/test/lifecycle.test.ts: blocks 1 1, 0 0; outside the blocks: DIFFERS`, `rc 1` (W2-1 added the history-recall-off row and its case outside the switches blocks);
- `shared/lifecycle.ts: blocks 1 1; outside the blocks: identical`, `server/test/lifecycle.test.ts: blocks 1 1, 0 0; outside the blocks: identical`, `rc 0` (W2-2a edited neither);
- `rc 1` (#1054 edited README far outside the section);
- `every changed line is inside the Session history section`, `rc 0` (W2-1's eight lines);
- then, over this PR: `shared/lifecycle.ts: blocks 1 1; outside the blocks: identical` (Task 5's three comment lines sit directly above the row, inside its cut), `server/test/lifecycle.test.ts: blocks 1 1, 0 1; outside the blocks: identical` (Task 5's appended case, with its blank line and header, is the second cut), `rc 0`; `every changed line is inside the Session history section`, `rc 0`. The script was measured at planning time against `d119d6e90` with Task 5's two edits applied in memory: these exact lines;
- `1`, `1`, `1` (the root names the marker, the tier is W2-D49's, and the row is still an operator file with no collector); then a positive count (README's seam paragraph names the seam variables and the marker).

A `DIFFERS` over this PR means a lifecycle key other than the switches row moved (W2-D9), and a README line outside the section is a finding: report either against the task that wrote it.

- [ ] **Step 2: Check the departures.** From the repository root:

```bash
MB=$(git merge-base origin/main HEAD)
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-2b-headless-seam.md
PATHS="$PLAN ccd/history shared/lifecycle.ts README.md server/test"
for d in D-5767 D-5768 D-5769; do printf '%s %s\n' "$d" "$(grep -c "^- \*\*$d\*\* — " "$PLAN")"; done
grep -cE '^- \*\*D-[0-9]+\*\* — ' "$PLAN"
grep -oE '^- \*\*D-[0-9]+\*\* — ' "$PLAN" | grep -oE 'D-[0-9]+' | grep -vxF -e D-5767 -e D-5768 -e D-5769 || echo 'no other number defined'
grep '^- \*\*D-5767\*\* — `history-w2-env-identity-from-asof`' "$PLAN" | grep -c 'W2-D40'
grep '^- \*\*D-5768\*\* — `history-w2-marker-grammar`' "$PLAN" | grep -c 'W2-D44'
grep '^- \*\*D-5769\*\* — `history-w2-headless-refusal-words`' "$PLAN" | grep -c 'W2-D48'
for d in $(grep -oE '^- \*\*D-[0-9]+\*\* — ' "$PLAN" | grep -oE 'D-[0-9]+'); do
  cite=$(git log --reverse --format=%h -S"$d" HEAD -- $PATHS | head -1)
  def=$(git log --reverse --format=%h -S"- **$d** — " HEAD -- "$PLAN" | head -1)
  printf '%s first-cites %s defines %s at-merge-base %s plans %s\n' "$d" "$cite" "$def" \
    "$(git show "$MB:$PLAN" | grep -c "^- \*\*$d\*\* — ")" "$(git grep -l -F -e "- **$d** — " -- docs/superpowers/plans | wc -l)"
done
for d in D-5767 D-5768 D-5769; do printf '%s cited in %s\n' "$d" "$(git grep -l -F "$d" -- ccd/history | tr '\n' ' ')"; done
git diff "$MB" HEAD -- docs ":(exclude)$PLAN" | grep -cE '^\+(#{2,4} |- \*\*)D-[0-9]+'
git grep -n 'D-TBD-[a-z0-9]' -- "$PLAN" ccd/history shared server/test README.md || echo 'no D-TBD token'
```

Expected:
- `D-5767 1`, `D-5768 1`, `D-5769 1`; `3` (the plan defines those three and no other); `no other number defined`; `1`, `1`, `1` (each entry in the em-dash form under its slug, naming its decision);
- one line per defined number, its `first-cites` sha equal to its `defines` sha, `at-merge-base 1` and `plans 1` for each of the three (they came with the plan, on `main` before dispatch, so no PR commit adds one);
- each of D-5767, D-5768 and D-5769 `cited in` at least one of `ccd/history/lib.mjs`, `cli.mjs` and `sweep.mjs` (the task that ships the departure cites it beside its code: `decideAsOfFamily`, `parseHeadlessList`, `REASON_ROWS`' two words); the worker copies the three lines into the PR body;
- `0` (no other document defines a number); `no D-TBD token`.

A count of definitions above 3, a line from the `grep -vxF` filter, or a fourth row in the loop, is either a number from this run's block that the worker used for a departure found while executing (its `first-cites` equal to its `defines`, `at-merge-base 0`, `plans 1`, and listed in the brief one by one: name it in the wave-done and the PR body), or a finding. A `first-cites` older than its `defines` is a finding against the task whose commit cited the number first. Never add a second definition, never renumber, and never list in the PR body a number of the block this PR did not define (an issued but undefined number above the high-water reds `deviation-refs`).

- [ ] **Step 3: Measure that no base reading and no widened rule moved (the ledger's "Later" item).** From the repository root, write W2-2a's script unchanged (a quoted heredoc, so nothing in it is expanded):

```bash
mkdir -p .superpowers/sdd/history-w2-2b
cat > .superpowers/sdd/history-w2-2b/rules-same.mjs <<'EOF'
// Which top-level declarations of ccd/history/lib.mjs differ between two commits, and whether any of them is a
// redaction rule or door: the base reading (BASE_RULES, 5h-2's R11) or the widened rules (D-5745). Reads git only.
import { execFileSync } from 'node:child_process';
const [a, b] = process.argv.slice(2);
const RULES = /[Rr]edact|[Rr]ules|RULES|Door|[Dd]isplay|Snippet|[Bb]elt|BELT|PairIndex|IndexText/;
const DECL = /^(?:export )?(?:async )?(?:function\*? |const |let |class )([A-Za-z_$][\w$]*)/;
const TOP = /^(?:export )?(?:async )?(?:function|const|let|class) |^\/\*\*|^\/\/|^if \(/;
function chunks(sha) {
  const lines = execFileSync('git', ['show', `${sha}:ccd/history/lib.mjs`], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n');
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = DECL.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !TOP.test(lines[j])) j++;
    if (out.has(m[1])) throw new Error(`${sha}: ${m[1]} declared twice`);
    out.set(m[1], lines.slice(i, j).join('\n').trimEnd());
  }
  return out;
}
const A = chunks(a), B = chunks(b);
const differ = [...new Set([...A.keys(), ...B.keys()])].sort().filter((n) => A.get(n) !== B.get(n));
const rules = differ.filter((n) => RULES.test(n));
console.log(`redaction declarations: ${[...B.keys()].filter((n) => RULES.test(n)).length}; changed: ${rules.length ? rules.join(', ') : 'none'}`);
console.log(`every changed declaration: ${differ.length ? differ.join(', ') : 'none'}`);
process.exitCode = rules.length ? 1 : 0;
EOF
```

Then its two CONTROLs, which must red and read clean respectively, and the real comparison:

```bash
S=.superpowers/sdd/history-w2-2b
node "$S/rules-same.mjs" 3af16cf97 02d75ae5f > "$S/rules-control.txt"; r=$?
head -1 "$S/rules-control.txt" | tr ',' '\n' | wc -l; echo "rc $r"; rm -f "$S/rules-control.txt"
W2A=$(git log --format=%H -1 -E --grep='[(]#1126[)]$' origin/main)
node "$S/rules-same.mjs" "$W2A^" "$W2A" | head -1; echo "rc ${PIPESTATUS[0]}"
MB=$(git merge-base origin/main HEAD)
node "$S/rules-same.mjs" "$MB" HEAD; r=$?; echo "rc $r"
git diff -U0 "$MB" HEAD -- ccd/history/cli.mjs ccd/history/sweep.mjs ccd/history/recall.mjs \
  | grep -nE '^[-+].*\b(redact[A-Za-z]*|displaySnippet|displayWindow|entryIndexText|sidecarIndexText|blobPlainText|makeBelt|makePairIndex)\b' \
  || echo 'no changed line names a door'
```

Expected (both CONTROLs measured at planning time on a read-only checkout of `d119d6e90`, W2-2a's as `4f9d7ac4d` to `d119d6e90`, the diff its squash commit carries; a different figure is recorded as measured): `33` and `rc 1` (5h-2 changed 33 redaction declarations); `redaction declarations: 67; changed: none` and `rc 0` (W2-2a changed none). Then, over this PR: `redaction declarations: 67; changed: none`, then `every changed declaration: ` followed by exactly the names Tasks 1 to 3 add or edit in `lib.mjs`, in the script's sort: `HEADLESS_LEGACY_GENERATION, HEADLESS_LIST_MAX_BYTES, HEADLESS_LIST_MAX_PAIRS, HEADLESS_MALFORMED, HEADLESS_PAIR_RE, HEADLESS_REPLACEMENT_CHAR, HEADLESS_STORE_PREFIX, HEADLESS_UNARMED, REASON_ROWS, RECALL_ARMS, SCOPE_SOURCES, asOfFamilySql, asOfRowFamily, decideAsOfFamily, decideEnvProject, decideHeadless, decideHeadlessRead, decideHeadlessStore, formatHeadlessList, headlessMarkerOf, parseHeadlessList`; then `rc 0`; then `no changed line names a door`. A hit there is read: a line removed and re-added with the same door arguments (a moved import, a re-indented call) is not a change of what a door prints, and is listed in the PR body with that reading.

So W2-2b changes no base reading and no widened rule: it decides whether a headless call is admitted, which family it reads and under which cut, never what a door prints for a text. The ledger's "Later" item on the display doors and the widened rules stays open, and the PR body states this with the two counts. A redaction name in the `changed:` list, a door named on a changed line in a way that changes its arguments, or a changed declaration no task names, is a finding: report it to the coordinator, who rules whether this PR has become that wave.

- [ ] **Step 4: Take the census of the seam's order.** From the repository root:

```bash
MB=$(git merge-base origin/main HEAD)
T=.superpowers/sdd/history-w2-2b/titles.txt
git diff "$MB" HEAD -- server/test/history-cli.test.ts server/test/history-lib.test.ts server/test/history-recall.test.ts \
  server/test/history-sweep.test.ts server/test/single-definition.test.ts server/test/lifecycle.test.ts \
  | grep -E "^\+\s*(describe|it)(\.[A-Za-z]+(\([^)]*\))?)?\(" | sed -E 's/^\+\s*//' > "$T"
wc -l < "$T"
for row in 'W2-D45|empty|unset|byte' 'headless-in-pane|C4|pane' 'headless-unarmed' 'headless-malformed|FIFO|symlink|O_NOFOLLOW|65,?537|65,?536|over the cap' \
  'no-identity' 'bad-id' 'headless-unlisted|zero pairs|store line' 'headless-arm-unknown|RECALL_ARMS' 'asof-invalid' 'harness' \
  'W2-D40|purge|reuse|registry|decideAsOfFamily|merged' 'workspace|cwd_real' 'cross-project|W2-D41|visible epoch|widened' \
  'exit 8|recall-off|control' 'counter|recallLine|arm|C24' 'C-R|treatment' 'recall_off_stale|drain' 'history-off' \
  'C28|W2-D47|box verb|status|doctor' 'C50|SCOPE_SOURCES|env source' 'parseHeadlessList|formatHeadlessList|marker|grammar' \
  'O13|headless-on|headlessOn' 'O14|VOCABS|HEADLESS_LIST_MAX' 'O17|history-switches'; do
  printf '%s: %s titles, %s naming a CONTROL\n' "$row" "$(grep -ciE "$row" "$T")" "$(grep -iE "$row" "$T" | grep -c 'CONTROL')"
done
```

Expected: a title count, then one line per row pattern, each with at least one title. Then read every case those titles name and fill one table, row by row as in the table above: the case title that asserts the row's answer at its step, and the case (or the same case's CONTROL half) that shows the same fixture with the row's condition cured answering the next row's word. A 0 in the CONTROL column is settled by reading the case: a CONTROL inside the same `it` counts. The `O13`, `O14` and `O17` rows may read 0 titles, because their pins are existing cases whose bodies the PR edited or whose `VOCABS` and `HOLDERS` lists it read: Step 5 runs them by name. Any other row left with no case at its step, or with no CONTROL anywhere, is a finding against the task that ships the row's decision: report it to the coordinator, and never write the case here. The table goes into the PR body under `### Pins`.

- [ ] **Step 5: The whole-PR checks.** Each line in the foreground, with a timeout of at least 600000 ms, ONE tool call per line: never two suites in one call, never a loop over suites, never a suite in the background (the history suites together run far past 600 s). Re-run a red file alone before calling it a break: CLAUDE.md names the load flakes. The census first: every `history-*.test.ts` file runs, the seventeen at `d119d6e90`, and any other one on a line of its own.

```bash
ls server/test/history-*.test.ts | wc -l
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-drain.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-holds.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-parser.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'the history classes are|declares history-switches|every history class names its creators and its tier')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'operator switches have readers only|writes a switch through its symbolic spelling')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'RECALL_ARMS is declared in ccd/history/lib.mjs|HEADLESS_LIST_MAX_BYTES is declared in ccd/history/lib.mjs|HEADLESS_LIST_MAX_PAIRS is declared in ccd/history/lib.mjs|REFUSALS is REASONS')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'process.env is read by name, from an allow-list|the three CCRC_RECALL_ seam names are each read once')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts)
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts)
(cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts)
(cd server && GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit)
(cd server && ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- the census prints `17`, or 17 plus a history suite another PR added on `main`, which then gets a line of its own like these;
- every `history-*.test.ts` file green alone, with this PR's pins among them: C4 complete (the in-pane half from W2-2a and the env half here), C16's two words (in `history-lib` and `history-skill`'s derivation), C24 under env, C30, C50, the C-R pin, W2-D40's purge-and-reuse pin with its registry-reading CONTROL, and the drain skip in `history-sweep`;
- `history-replay` and `measure-history` green, read and never edited: `measure-history`'s "the gate declares no name lib.mjs exports" (D-5774) reds if a new lib export shares a name with `deploy/history-gate.mjs` (its arm list is `ASSIGNMENT_ARMS`, not `RECALL_ARMS`), and `history-replay`'s driver-words describe reds if `headless-malformed` or `headless-arm-unknown` collides with a driver word (the W2-5a plan records that neither does);
- `lifecycle` green, and its O17 run selects three cases and is green: the thirteen classes, each in the PR its Lands-in column names (history-switches still B1's), the switches row's new root and tier (W2-D49), and every history class's creators and tier;
- `single-definition` green, and its three named runs each select at least one case and are green: O13 (`headless-on` holders stay `['ccd/history/lib.mjs']`; no `.mjs` line pairs a write verb, `open` included, with `.headlessOn`), O14 (the three constants each declared once, in lib.mjs, exported; `REFUSALS` still derived), and the env allow-list at seven with each seam name read once in cli.mjs; then the `CITATION DEBT` case green, because `session-hook.test.ts` cites `single-definition.test.ts` by line and the tasks editing it kept the cited lines where they were;
- `ccrc-doctor`'s `'history'` cases green: doctor runs `status`, a box verb, which ignores every `CCRC_RECALL_*` (W2-D47);
- `docs-policy`, `topology-clean`, `citations` (no added numeric line citation, D-5893), `docs-parity` (it walks `shared/`, so it reads `lifecycle.ts`) and `dtbd` (no concrete `D-TBD-` token) green;
- `growth-check` prints `growth-check: net code lines against the merge-base`, nine rows each `delta +0`, `GROWTH_OVER: (none)` and `ledger entries this diff adds: (none)`, and is green: no W2-2b file is listed (D-6178), and the PR adds no waiver (D-6223) and no exemption (D-6211);
- both `tsc` runs print nothing (the server's compile reads `shared/lifecycle.ts`).

Copy each `Test Files … | Tests …` summary line, as printed, into the PR body. A `topology-clean` red means a new sentence names a host, an id or a private path: report it against the task that wrote it, never touch the scanner. A `single-definition` red on a new spelling, a new holder of `/headless-on` or a symbolic write is a finding against the task that added it: report it, never weaken the scan.

- [ ] **Step 6: Check the deviation ledger against `main` without merging.**

```bash
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: green. A red names a number defined in two plans: report it to the coordinator, and never renumber one. D-5767, D-5768 and D-5769 are defined once, in this plan's "## Deviations found", on `main` (Step 2); every other number the PR cites (Global Constraints' list, each named in the PR body's "Cited bare, defined elsewhere" with its plan) is cited bare and defined in an earlier plan on `main` (D-5765, D-5766 and D-6281 in the W2-2a plan).

- [ ] **Step 7: Confirm the tree holds only this PR's work.** Run `git status --short`. It lists nothing: Tasks 1 to 5 committed their work, and the scratch files sit under the ignored `.superpowers/`. No step read or wrote a live `~/.ccrc`: every test ran in a fixture HOME, and no step ran `ccd`, the shim, `sweep.mjs`, `cli.mjs` or any history verb. Then remove this task's scratch, `rm -f .superpowers/sdd/history-w2-2b/titles.txt`, and nothing else: the test fixture directories are `historyHelpers.ts`' and `tmpHelpers.ts`' to clean up, never removed by hand.

- [ ] **Step 8: Write the PR body, and check it, every added line and every message for private names.** Write `.superpowers/sdd/history-w2-2b/pr-body.md` with exactly the text below. Then replace its six parenthesised lines, each from the source it names:
  - under `### Departures`, the line with this plan's three `## Deviations found` entries, D-5767, D-5768 and D-5769, copied whole, then one line per number this run's block issued during the build (each defined in this plan in the commit that first cites it), each as defined, then Step 2's three `cited in` lines;
  - under `### Pins`, the line with Step 4's table, row by row, each cell a case title;
  - under `### Rulings made in the operator's place`, the line with this plan's Decisions-table rows R1 to R12 and R5a, one line each, then every ruling the coordinator made during the build, one line each with its date;
  - under `### Choices the tasks made`, the line with every task's choice bullets, one line each, its task number first (P1, `SCOPE_SOURCES`' `'env'` in Task 3, among them), plus any finding Steps 1 to 4 reported and the coordinator's answer to it;
  - under `### The display doors and the widened rules`, nothing: the paragraph is final, and Step 3's two counts are in it;
  - under `### Tests run`, the line with Step 5's and Step 6's summary lines as printed, Step 1's content-check `rc` lines, Step 3's two `rc` lines, and any free-space case Step 5 recorded.

Every other line is final.

```markdown
## ccrc history wave W2-2b: the headless seam

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6 with W2-1's errata, **not edited by this PR**: §8.2's headless seam (`CCRC_RECALL_SESSION`, `CCRC_RECALL_ARM`, `CCRC_RECALL_ASOF` and `~/.ccrc/history/headless-on`), §8.3's exit table (exit 2 and exit 8), §9.4's history-switches row, §9.7's headless-on row, and the pins C4, C16, C24, C28, C30, C50 and C-R, with O13, O14 and O17. The five errata this PR's code makes true are amended in place by W2-5b, which holds the spec path after the fleet lane ends (W2-D3; decisions §6): E2 (`headless-malformed` and `headless-arm-unknown` in the exit-2 row), E7 (the switches row's `headless-on` tier), E8 (the env path's generation and its `--workspace` anchor), E9 (the marker grammar) and E10 ("counted `scope_source=env`" reads as `recall_calls.arm IS NOT NULL`).
Decisions: `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md`, §2's "W2-2b (fleet): the headless seam" entry and §3 E: W2-D40 to W2-D49, with W2-D12's three constants; W2-D50 is W2-4's and W2-5b's. Plan: `docs/superpowers/plans/2026-10-22-ccrc-history-w2-2b-headless-seam.md`.

W2's arms run headless `claude -p` sessions with no tmux pane, so the CLI needs an identity, an arm and a cut that do not come from tmux. This PR builds that seam, the fleet lane's last PR before W2-5b, after W2-2a (#1126) (W2-D2):

- **The env identity comes from ASOF** (W2-D40, D-5767): once the store is admitted, `decideAsOfFamily` requires the `CCRC_RECALL_ASOF` row to have a boundaries row, to sit on a main transcript, and to belong to exactly one confirmed family of `CCRC_RECALL_SESSION` (merged_into followed); otherwise `asof-invalid`. That family's generation, `''` for a legacy family, is the scope's. On the env path `CCRC_SESSION_GENERATION`, `$REG/<id>.generation` and the newest-family fallback are never read, `--session <own id>` uses the resolved generation, and `--workspace` anchors on the ASOF epoch's `cwd_real ?? cwd`, never on `$REG/<id>.workdir`. The tmux path's `resolveGeneration` is byte-identical.
- **Widened scopes are cut, not refused** (W2-D41): `--project`, `--workspace` and `--session` stay legal; `decideScope` runs with `source: 'env'` (`SCOPE_SOURCES` gains `'env'`, C50); W2-2a's cut applies to every family in scope and a family with no visible epoch is dropped from it; a resolved family whose stored project differs from the registry project answers `cross-project`.
- **ARM and ASOF are required** (W2-D42): `RECALL_ARMS = ['control', 'treatment']`, frozen, in lib and O14's `VOCABS`; an empty, absent or unknown ARM answers `headless-arm-unknown` and an empty or non-UUID ASOF `asof-invalid`, both before the store is opened; `ARM=control` answers exit 8, counted, after admission and the recall-off check. The W2 driver imports `RECALL_ARMS` and never spells its words (W2-5b pins that).
- **Counting** (W2-D43): `recallLine` writes `arm` on every counted env call, and `gen` when the resolved generation is a UUID, and never `arm` on a tmux call; the arm rides from step 4's admission on `seen`; the drain skips the `recall_off_stale` bump for a line carrying `arm`. No schema change: `recall_calls.arm` exists since v1.
- **The marker** (W2-D44, D-5768): `~/.ccrc/history/headless-on` is read on one line, only on the headless path, through store.mjs's bounded reader (O_RDONLY | O_NOFOLLOW | O_NONBLOCK, a regular file, at most 65,537 bytes), and folded by `headlessMarkerOf`. `parseHeadlessList` requires a first non-comment line `store <store_id>`, then empty lines, `#` comments or exactly `<ccrc_id> <generation>` (a lowercase UUID, or `-` for the legacy `''`); any CR, stray whitespace, other line, missing or second store line, more than 65,536 bytes (`HEADLESS_LIST_MAX_BYTES`) or more than 1,000 pairs (`HEADLESS_LIST_MAX_PAIRS`) is `headless-malformed`; zero pairs, an unlisted family, and a store line naming another store (checked at admission) are `headless-unlisted`. `formatHeadlessList` is the one producer of marker text, for W2-5b's `marker`.
- **The order** (W2-D45, W2-D46): a `CCRC_RECALL_*` variable is set iff non-empty, and with none set every verb reads exactly as before. `decideHeadless` answers, in order: inside a pane `headless-in-pane`, before any tmux spawn; no marker `headless-unarmed`; unreadable or malformed `headless-malformed`; SESSION unset `no-identity`; a bad id `bad-id`; not listed `headless-unlisted`; ARM `headless-arm-unknown`; ASOF's grammar `asof-invalid`. Then the harness, the store, the marker's store line (`decideHeadlessStore`, before any ASOF row is read) and `decideAsOfFamily` (admitted here), recall-off (8), `ARM=control` (8), then scope, the W2-D41 guard, the cut and the verb. A counter line is written iff the family was admitted (a refusal, a failed read or a defect before the admission writes none): step 4's own `asof-invalid` and `headless-unlisted` write none (R5), and the cut's `asof-invalid` at step 7, D-5765's store half, is counted (R5a); under `history-off` nothing is written.
- **Box verbs ignore the seam** (W2-D47): `status`, `doctor` and the operator verbs derive no identity and read no `CCRC_RECALL_*` (C28 extended: SESSION and ARM set, exit 0, no line).
- **Two new exit-2 words** (W2-D48, D-5769): `headless-malformed` and `headless-arm-unknown` join `REASON_ROWS`; `REFUSALS` stays derived; the skill's exit-2 row is generic and is not edited.
- **The history-switches lifecycle row** (W2-D49): its root gains `~/.ccrc/history/headless-on`, its tier the 64 KiB bound and the store line, and its pin follows in the same PR. No other lifecycle key moves.

Sessions in panes see no change. A headless call is refused until the operator writes `headless-on` for a window (decisions §5), and it then reaches only the families the marker lists, on this store. Files: `ccd/history/lib.mjs`, `lib.d.mts`, `cli.mjs` and `sweep.mjs`, `shared/lifecycle.ts`, README's Session history section, and appended tests in `history-cli`, `history-lib`, `history-sweep`, `single-definition` and `lifecycle` (in place: O14's `VOCABS`, the switches case, and W2-2a Task 5's no-pane case in `history-cli`, whose answer W2-D46 changes, R8). Schema v2, no migration (W2-D10), no new file (W2-D5), and nothing in the spec, `deploy/**`, `.github/**`, `derive.mjs`, `store.mjs`, `regex-worker.mjs`, the skill, `ccd/session-hook.sh` or `ccd/ccd`.

### Departures

(this plan's three `## Deviations found` entries, D-5767, D-5768 and D-5769, copied whole, then any number of this run's block, as defined, then Step 2's three `cited in` lines)

Cited bare, defined elsewhere, each in the plan named: D-4228 and D-4347 (`2026-10-05-ccrc-history-w1-capture.md`: CLI counters are spool lines the sweep folds, and the one bounded reader of small files, `readBounded`, which reads the marker); D-4675 and D-5023 (`2026-10-06-ccrc-history-w1-b2-recall.md`: the identity from tmux, and the counter's defect rule); D-5745 and D-5748 (`2026-10-19-ccrc-history-w5h2-redaction-and-ops.md`: the widened rules, and the op marker's grammar, whose bounds the manifest states as figures held to lib); D-5765, D-5766 and D-6281 (`2026-10-22-ccrc-history-w2-2a-as-of-cut.md`: the word `asof-invalid`, to which this PR adds the pre-store and family halves, the time cut, and the boundaries row's transcript); D-5774 (`2026-10-19-ccrc-history-w2-3-gate-module.md`: the gate declares no lib name); D-5893 (`2026-10-20-backlog-bl130.md`: no added numeric line citation); D-6045, D-6178 and D-6223 (`2026-10-19-consolidation-w0-pins.md`: the ring rules that keep `shared/` importing nothing, the armed growth check and its waiver ledger); D-6211 (`2026-10-21-growth-check-pr-exemption.md`: the growth check's PR exemption).

### Decisions this PR applies

- W2-D40 and W2-D41: the env family from ASOF (D-5767); widened scopes cut, with the cross-project guard.
- W2-D42 and W2-D43: `RECALL_ARMS`, ARM and ASOF required, exit 8 for control; `arm` on counted env lines and the drain skip.
- W2-D44, W2-D45 and W2-D46: the marker grammar (D-5768); empty means unset; the decision order and which refusals count.
- W2-D47, W2-D48 and W2-D49: box verbs ignore the seam; the two words (D-5769); the switches row.
- W2-D12: `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES` and `HEADLESS_LIST_MAX_PAIRS` in O14's `VOCABS`.
- W2-D2, W2-D3, W2-D5, W2-D9 and W2-D10: the fleet lane's order, no spec path, no new file, the one lifecycle row, no schema change.

### Pins

C4 complete; C16's two words; C24 under env; C28 extended; C30; C50; the C-R pin (a treatment-arm call on a listed family that is also a live A/B family writes a non-null `arm`); W2-D40's purge-and-reuse pin, whose CONTROL is a mutant reading the registry; O13 (`headless-on` holders stay `['ccd/history/lib.mjs']`, and the symbolic write scan stays green); O14 (the three constants); O17 (the switches row). Every new guard was measured red under its mutant, then green; the plan lists each mutant and the case it reds. The seam's order, each refusal at its step with its CONTROL one step later:

(Step 4's table, row by row, each cell a case title)

### The display doors and the widened rules

The ledger's "Later" item from 5h-2's reviews waits for the first wave that changes a base reading or the widened rules (D-5745). This PR changes neither: every one of `lib.mjs`'s 67 redaction declarations is byte-identical to the merge-base (W2-2a's scan, whose CONTROL over 5h-2's own change names 33 of them and whose run over W2-2a's change names none), and no changed line in `cli.mjs` or `sweep.mjs` changes what a door is called with. The seam decides who may read, which family and under which cut, never what a door prints for a given text. The item stays open, for a later wave.

### Steps for the coordinator or the operator, never the worker

1. **Full suite.** This PR changes no `.github/` file, so the pull request runs its selection. Check that its `select tests` summary lists `history-cli`, `history-lib`, `history-recall`, `history-sweep`, `history-skill`, `history-replay`, `measure-history`, `lifecycle` and `single-definition`; if one is missing, dispatch a full run: `gh workflow run ci.yml --ref <this branch> -f mode=full`.
2. **Rollout through the release lane only**, and only as part of W2's final release (W2-D6). No node owes a `doctor --migrate` (W2-D10).
3. **The marker is the operator's.** No verb writes or removes `~/.ccrc/history/headless-on` (O13). Its text comes from W2-5b's `marker`, through `formatHeadlessList`; the operator writes it for the window and removes it at close (decisions §5, acts 26 and 27).
4. **The spec errata.** E2's W2-2b half, E7, E8, E9 and E10 are W2-5b's to amend in place (W2-D3), beside W2-2a's E2 half and E11; until then the spec reads rev 3.6 with W2-1's errata, and this PR's departures are stated in its plan.
5. **The ledger.** Its W2-2b row, and the "Later" item above (still open), are the coordinator's.

### Residuals, named

- **The harness is still read from the registry on the env path** (W2-D40): a reused id whose `$REG/<id>.harness` names another harness refuses (fail closed).
- **`--session <other>` takes the other id's newest family before the cut** (W2-D40), so a reused other id answers exit 3.
- **A legacy `''` family's arm line carries no `gen`.** It is excluded by `arm IS NOT NULL`'s reading, and no gate statistic reads it (decisions §7).
- **The gate's `ASSIGNMENT_ARMS` spells the arm words a second time**, deploy-local by W2-D12 and in another order (`['treatment', 'control']`); O14 sees names, not values, so nothing ties it to `RECALL_ARMS`. W2-5b adds a parity pin with `RECALL_ARMS`, or replaces it with an import, beside its driver arm-word scan (R10); the coordinator carries it to W2-5b's plan.
- **The seam is policy, not an OS wall** (§8.2): every session runs as the same UNIX user, and the marker is a speed bump an operator arms for a window.

### Rulings made in the operator's place

(this plan's Decisions-table rows R1 to R12 and R5a, one line each, then every ruling made during the build, one line each with its date)

Every ruling here is the coordinator's, under the operator's directive of 2026-10-19 to proceed through the build waves; the operator may change any of them.

### Choices the tasks made

(every task's choice bullets, one line each, its task number first, plus any finding Steps 1 to 4 reported and the coordinator's answer)

### How it was measured

Each task's guards were watched red on the unguarded code, with the prediction written before the run, then each mutant in its task's list was measured red and the code green again. Every refusal was pinned at its step of W2-D46's order, with a CONTROL on the same fixture one step later. The whole-PR checks ran one suite per call, in the foreground, on the worker's box; the lifecycle, README and redaction-rule scans each ran their CONTROLs first; `deviation-refs` ran against `origin/main` without merging; the private-name count over every added line, every commit message and this body is 0.

### Tests run (foreground, on the worker's box)

(Step 5's and Step 6's summary lines as printed, Step 1's content-check rc lines, Step 3's two rc lines, and any free-space case Step 5 recorded)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then check the scans' CONTROLs, and the body, every added line and every message. Each command prints a count or a line number, never a token:

```bash
S=.superpowers/sdd/history-w2-2b
printf '# comment\nk\tzqprivword\n' > "$S/names-control.tsv"
printf 'one zqprivword two\nzqprivwordy\n' | grep -c -i -w -F -f <(cut -f2 "$S/names-control.tsv" | grep -v '^#')
printf '/%s/zqowner/x\n/home/u/tree\n' home | grep -cE '([0-9]{1,3}\.){3}[0-9]{1,3}|\.ts\.net|/mnt/|/tmp/claude-|/home/([^u]|u[^/])'
printf '%s%s\n' 'AKIA' 'QZQZQZQZQZQZQZQZ' | grep -cE 'AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|sk-ant-[A-Za-z0-9_-]{20,}'
LIST="$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names"
test -s "$LIST" && grep -vc '^#' "$LIST" || echo 'PRIVATE-NAME LIST MISSING'
MB=$(git merge-base origin/main HEAD)
TITLE='ccrc history wave W2-2b: the headless seam'
ALL() { git diff -U0 "$MB" HEAD | grep '^+' | grep -v '^+++'; git log --format=%B "$MB"..HEAD; printf '%s\n' "$TITLE"; cat "$S/pr-body.md"; }
ALL | grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}|\.ts\.net|/mnt/|/tmp/claude-|/home/([^u]|u[^/])' | cut -d: -f1 || echo 'no host or home path'
ALL | grep -nE 'AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|sk-ant-[A-Za-z0-9_-]{20,}' | cut -d: -f1 || echo 'no key-shaped literal'
ALL | grep -c -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#')
rm -f "$S/names-control.tsv"
```

Expected: `1` (the private-name pipeline counts a whole-word hit and skips a comment line and a longer word); `1` (the host and home-path pattern takes a home path and leaves the `/home/u/tree` fixture style alone); `1` (the key-shape pattern takes a key assembled at runtime); a positive count, the number of names the real list holds (a missing or empty list would hand `grep -f` no pattern, and its `0` would read as a pass, so `PRIVATE-NAME LIST MISSING` or `0` here stops the step: report it, and run no scan until the list is there); `no host or home path`; `no key-shaped literal` (key-shaped fixtures are assembled at runtime, never written whole); `0`. A non-zero count or a line number is judged by its line, never by printing the token: re-run the same pipeline with `grep -n -i -w -F -f <(…) | cut -d: -f1` for line numbers only, read those lines, and have the task that wrote each one rewrite it with a neutral stand-in before any push (a commit message by an amended commit before the first push only; after it, report to the coordinator). The fixture paths in this PR's tests are `/home/u/…` style; the body names none. The plan is on `main` before dispatch, so its own pattern lines are not among the PR's added lines; a Task 6 correction commit changes figures only, never these lines.

- [ ] **Step 9: Open the PR, then read its review threads.** Push the workspace branch, then open the PR against `main`, ready for review (not a draft):

```bash
gh pr create --base main --head "$(git branch --show-current)" \
  --title "ccrc history wave W2-2b: the headless seam" \
  --body-file .superpowers/sdd/history-w2-2b/pr-body.md
read -r OWNER REPO < <(gh repo view --json owner,name -q '.owner.login + " " + .name')
PR=$(gh pr view --json number -q .number)
gh api graphql -F o="$OWNER" -F r="$REPO" -F n="$PR" -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){totalCount nodes{isResolved path line}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads | "threads \(.totalCount) open \([.nodes[] | select(.isResolved | not)] | length)"'
gh pr checks "$PR"
```

Expected: the PR URL; `threads N open 0`; and, once CI settles, every required check green (build-pwa, test (agent), test (pwa), test (server), node floor, typecheck), with `test (server)`'s `select tests` summary read as Step 8's body asks the coordinator to. Re-read the threads after every push. A thread left open blocks the merge even while its check reads green; a CodeQL thread's cause is fixed in code by the task that owns the line (argv arrays, never a shell; no env value in a command string; SQL by bound parameters, never by a concatenated value; a marker path opened only through the bounded reader), and a thread is never resolved, nor an alert dismissed, by the worker. Wave-done is the brief's: the PR open, its checks green, no open thread, and the branch tip the PR head.

**Mutants.** This task adds no guard, no test and no code path, so it has no mutant list. Its scripted checks carry their own CONTROLs, each measured before the real run: Step 1's `switches-only.mjs` reds on W2-1's lifecycle change (`rc 1`) and reads clean on W2-2a's (`rc 0`), and `readme-section.mjs` reds on #1054's README change (`rc 1`) and reads clean on W2-1's in-section one (`rc 0`); Step 3's scan reds on 5h-2's rules change (33 declarations, `rc 1`) and reads clean on W2-2a's (`rc 0`); Step 8's three scans each count a planted hit (`1`, `1` and `1`) before they are trusted to read 0 over the PR. Every guard this PR adds is in Tasks 1 to 5, each with its own mutant list, and Step 4 checks every row of the seam's order has a case and a CONTROL there.

**Commit:** none by default; Steps 0 to 9 change no tracked file. If a step measures a figure that differs from what this plan predicted in its own text (a task's predicted count or output), the correction is this task's one commit, touching only this plan's text and never a `## Deviations found` entry: `docs(history): the W2-2b plan's predicted figures, as measured (W2-2b Task 6; W2-D4)`.

---

## Deviations found

D-5767, D-5768 and D-5769 were issued on 2026-10-19 in the W2 decisions document's block, and this plan is the one that defines them (decisions §6's "Defined in"). Each is defined once, here, and lands on `main` with the plan before dispatch (R9); Task 1 cites D-5768 and D-5769, Task 2 D-5767 and D-5768, and Task 3 D-5767 in code comments, Task 6 checks each entry is here once, and the PR defines no number but one taken from the run's block for a departure found while executing, defined here in the commit that first cites it. Every other number this plan cites is defined on `main` or in the W2-2a plan, and is cited bare.

- **D-5767** — `history-w2-env-identity-from-asof` (Task 2; W2-D40, R3, erratum E8): on the headless seam's env path the family, and with it the generation, comes from `CCRC_RECALL_ASOF`, never from the generation chain. The rule: the ASOF entry must have a `boundaries` row; the transcript that row names (D-6281: the boundaries row's, never the entries row's) must be a main one (`agent_id = ''`); and that transcript's `cc_session_uuid` must be a confirmed epoch of exactly one family after one `merged_into` hop, of any id, whose `ccrc_id` is `CCRC_RECALL_SESSION`. Otherwise the answer is exit 2 `asof-invalid`, D-5765's word, its family half. That family's generation, `''` for a legacy family, is the resolved generation, an exact key handed to `decideScope` as `{ value, via: 'asof' }` (`GenerationChoice.via` gains `'asof'`). On the env path the CLI never reads `CCRC_SESSION_GENERATION`, `$REG/<id>.generation` or the newest-family fallback, and `--session <own id>` takes the resolved generation through `decideScope`'s own-id arm, unedited. **`--workspace` changes anchor on the env path**: it widens to every family with an epoch launched in the ASOF epoch's stored `cwd_real ?? cwd` (lib's `decideAsOfFamily` answers it as `anchor`), matched as stored with no realpath at read time, never in `$REG/<id>.workdir`; with neither column set it answers `workspace-unreadable`. This departs from spec §8.2's generation chain ("The generation is `CCRC_SESSION_GENERATION` when it has the UUID grammar. Otherwise the CLI reads `$REG/<id>.generation` read-only …", about :1509 at d119d6e90) and from §8.2's `--workspace` definition ("widens to every family with an epoch whose launch directory matches this session's `$REG/<id>.workdir`", about :1514), each on the env path only; the tmux path is unchanged and `resolveGeneration` is byte-identical. Why: a headless arm runs with no pane and no `CCRC_SESSION_GENERATION` in its environment (W2-D50); an id reused after a purge has a registry, and a newest family, naming another generation (G2) than the one the quiz was built from (G1); the boundary the arm is cut at already names its family, so reading anything else could only scope the arm to the wrong family (SEAM-a, both seam checkers' registry-read findings). How it is decided: lib's `decideAsOfFamily` over the rows of lib's `asOfFamilySql` (Task 3's column names, run by the CLI's `asOfRowsOf`), with W2-D44's store line (first, lib's `decideHeadlessStore`, which the CLI answers before it reads the rows, R3) and pair at the same admission (W2-D46 step 4); the anchor rule lives in lib, not in L4 (R3). Two readings fail closed, and only a damaged or mid-merge store reaches either: "exactly one family" is read strictly (a second family of any id that confirms the transcript refuses), and a hop that lands on a row merged again, or on no row, refuses. Residuals, named (W2-D40): the harness check still reads `$REG/<id>.harness`, so a reused id with another harness refuses; `--session <other>` takes the other id's newest family before the cut, so a reused other id answers 3. Erratum E8 is amended in place by W2-5b, never by W2-2b. Pins: Task 2's history-lib describe (the `decideAsOfFamily` staircase with each row's CONTROL and its adjacent pairs; the real-store case: purge and reuse reading G1 while S's newest family is G2, with the CONTROL in G2's transcript answering `headless-unlisted`, a legacy and a merged `''` family, the D-6281 shape, and the refusals for two families, an unconfirmed epoch, a sidechain boundary, a plain row, no entry, a chain, another id's family and a foreign store line; the scan that no registry or environment generation reaches the env path, and the byte-for-byte `resolveGeneration` pin), with mutants F2 to F16 and R1; Task 3's spawned "seam reuse" (the default scope and `--session X` read G1 through the real `$REG` and env, mutants M5 to M8), "seam legacy" (M9) and "seam workspace" (M10, M11).
- **D-5768** — `history-w2-marker-grammar` (Task 1; W2-D44, R2): `~/.ccrc/history/headless-on`'s content is a grammar this plan chooses, beyond spec §8.2's "the pre-registered list of admitted (`ccrc_id`, generation) pairs, one per line" (about :1527 at d119d6e90) and §9.7's headless-on row (about :2307). The grammar: the text is UTF-8 throughout, split on LF, one final LF optional. The first line that is not a `#` comment must be `store <store_id>`, a lowercase UUID; only comments come before it. After it each line is empty, a `#` comment, or exactly `<ccrc_id> <generation>`: an id `idOk` passes, one space, and a lowercase UUID or `-`, which spells a legacy family's `''`. The whole marker is malformed on a CR anywhere; leading or trailing whitespace on any line, comments included (JavaScript's `\s`, so a byte-order mark or a no-break space too); any other line; a missing store line, or a second one (any later line beginning `store `, so an id spelled `store` cannot be listed and `formatHeadlessList` refuses it); more than `HEADLESS_LIST_MAX_BYTES` = 65,536 bytes; more than `HEADLESS_LIST_MAX_PAIRS` = 1,000 pair lines, duplicates counted (*chosen*); or a text whose UTF-8 round trip holds U+FFFD. R2's strictures, each fail closed and none produced by `formatHeadlessList`: an empty line before the store line, an id spelled `store`, whitespace at either end of any line (comments included), and a literal U+FFFD. That last rule is how "decodes UTF-8 fatally" reads over the reader's text (`parseHeadlessList` takes text, R2): store.mjs's `readBounded`, the marker's one read, decodes with replacement, so an invalid byte arrives as U+FFFD, and a literal U+FFFD is malformed too (fail closed). Duplicate pairs are otherwise tolerated and kept. `parseHeadlessList` answers `{ ok: true, storeId, pairs }` or exit 2 `headless-malformed`; `headlessMarkerOf` answers `headless-unarmed` for an absent marker and `headless-malformed` for an unreadable or over-cap one, never absent (IV5); zero pairs parses, and `decideHeadless` answers `headless-unlisted` for it (spec-decided, not part of this departure), as `decideHeadlessStore` does for a store line that does not name the store's meta `store_id`, at admission and before any ASOF row is read (W2-D46 step 4, R3; `decideAsOfFamily` calls it as its first row). `formatHeadlessList` is the only producer of marker text (W2-5b's `marker` prints it) and refuses any list the parser would not read back. Why: the store line binds a marker to one store, so a marker copied to another node or left across a rebind lists nothing (SEAM-f, the legacy-portability finding); `-` gives a legacy `''` family a spelling a line can carry; comments let the operator annotate a hand-written file; the bounds keep the read and the parse bounded (the read stops at 65,537 bytes, O_NOFOLLOW and nonblocking, W2-D44). Errata E7 (§9.4's history-switches tier) and E9 (§8.2 and §9.7, which also carry W2-D42's required ARM and ASOF, not a departure) are amended in place by W2-5b, never by W2-2b. The marker is read on one line, only on the headless path, as `headlessMarkerOf(readBounded(P.headlessOn, HEADLESS_LIST_MAX_BYTES, false))` (R1). Pins: Task 1's history-lib cases (the grammar with its CONTROL, every malformed shape, the bounds at and past each edge in bytes and pair lines, the formatter's refusals, the round trip, the fold, and the one read through `readBounded` over real files) with mutants M5 to M28 and M34 to M39; Task 1's single-definition describe (one definition, the one read, M29, M31, M32) and O14's two bound rows (M33); Task 2's `decideHeadlessStore` rows (F1, F17 to F19); Task 3's spawned "seam marker read" (a link, a FIFO, the bound and one byte past it, M24), its "seam ladder" row with a fault planted on the ASOF read under a foreign store line (M30), and "seam source" (the one read, inside `readContextEnv`, after the in-pane refusal, M34 to M36).
- **D-5769** — `history-w2-headless-refusal-words` (Task 1; W2-D48): the headless seam's two new refusals are spelled `headless-malformed` (the marker headless-on cannot be read, being a link, a FIFO, a directory or any failed open or read, is longer than 65,536 bytes, or breaks D-5768's grammar) and `headless-arm-unknown` (the seam is engaged and `CCRC_RECALL_ARM` is empty, absent or not a `RECALL_ARMS` word, W2-D42). Both are exit-2 words in lib's `REASON_ROWS`, after W2-2a's `asof-invalid`, so `REFUSALS` holds them (C16). Spec §8.3's exit-2 row (about :1671 at d119d6e90) names only `headless-unarmed`, `headless-in-pane` and `headless-unlisted` for the seam, and §8.2 names no word for a marker that cannot be read or parsed, or for an arm outside the vocabulary: the spellings are this plan's. Why two new words and not a fold into the old ones: an unreadable or malformed marker is not an absent one (IV5: unreadable is never absent), so it cannot be `headless-unarmed`; folding it into `headless-unlisted` would tell the operator that a family is missing when the file is broken; and an unknown arm is not a listing question at all. Erratum E2 adds both words to §8.3's exit-2 row, amended in place by W2-5b, never by W2-2b. `ccd/history-skill/SKILL.md` is not edited: its exit-2 row is generic (W2-D48). Pins: Task 1's history-lib C16 case and its `REASON_ROWS` case beside this entry's comment (mutants M1 and M2), and the fold's case, which answers `headless-malformed` and never `headless-unarmed` for an unreadable or over-cap marker (M27, M28); the spawned C16 checks are Task 3's "seam ladder".
- **D-6444** — `history-w2-readme-unlisted-order` (Task 5; W2-D46, R11): Task 5's README paragraph, as this plan wrote it, said step 1's `headless-unlisted` is "a family the marker does not list" and, later, that the boundary must be on a main transcript of a confirmed epoch of exactly that family "or the answer is `asof-invalid`". The code differs. `decideHeadless` (step 1) checks only that some marker line names the session id (`marker.pairs.some((p) => p.ccrcId === session)`), so step 1's `headless-unlisted` is a session id no marker line names, or a marker that lists none. The generation is checked once the store is open, in `decideAsOfFamily` (step 4), after the store line, the boundary and the family checks: the boundary must sit on a main transcript of a confirmed epoch of exactly one family whose id is the session's, else `asof-invalid`; only then, if that family's generation is not listed beside the id, `headless-unlisted`. A marker that lists `a` with one generation, a session `a`, an unknown arm and a boundary in another generation of `a` therefore answers `headless-arm-unknown`, where the plan's text predicted `headless-unlisted`. README now states the code's order: step 1's `headless-unlisted` is the session id no marker line names (or an empty list), and the generation half is stated after the store opens, following the `asof-invalid` half. Two wording corrections ride with it, each to what the code does: the bound "more than 1,000 families" counts pair lines, duplicates included, so the paragraph says "(a line each, duplicates counted)", and "a space at either end of a line" becomes "whitespace at either end of a line", because the grammar refuses JavaScript's `\s` (a tab, a byte-order mark and a no-break space too, D-5768). The words and their step 1 order are unchanged, so Task 5's README case holds as written. No code moves.

- **D-6445** — `history-w2-env-workspace-anchor-untrimmed` (whole-branch review M-1; W2-D40, W2-D41, D-5767): on the headless path `--workspace` anchors on the stored `cwd_real ?? cwd` of the epoch ASOF sits in (`decideAsOfFamily`'s `anchor`), and `readContextEnv` hands it to `decideScope` as the registry workdir; the workspace arm ran it through `presenceText`, which trims, and `familiesOf` then matches it by exact equality within the project. `cwd` is stored verbatim at ingest and `cwd_real` is its realpath, so a session launched in a directory whose name begins or ends in whitespace is stored with that whitespace, and the trimmed anchor never equalled it: the headless call answered not-indexed (counted), or read a sibling directory without the whitespace in the same project. That contradicted D-5767's "matched as stored, with no realpath at read time". The tmux path trims `$REG/<id>.workdir` file text, which is right there (a text file's newline must go) and stays. The coordinator ruled on 2026-10-22, in the operator's place under the directive of 2026-10-19, to fix it in this PR: `decideScope`'s workspace arm is edited in place (lib, L1; `cli.mjs` unchanged) so that when the scope source is the headless one the anchor is used untrimmed, the tmux source keeps its trim, and the blank, absent and unreadable refusals stay exactly as they were. Two pins: a `history-lib` case (the headless source returns `/t/a ` and ` /t/a` as given, the tmux source with the same input returns the trimmed text as the CONTROL, and the refusals still refuse under the headless source) and a spawned seam case in `history-cli` (two real sibling directories `a ` and `a` in one project, the ASOF boundary in the session launched from `a `: `--workspace` on the headless path reads the families of `a ` and not of `a`).
