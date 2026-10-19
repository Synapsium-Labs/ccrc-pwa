# ccrc history W2-3: the gate module and the census — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship W2's scoring core in ONE PR on `main`, in the deploy lane: a pure gate module, `deploy/history-gate.mjs`, and a `measure-history.py` that emits raw rows and a census instead of a window statistic. Every scoring decision the W2 replay eval makes is then one pure function, hashed by the open record (W2-D24). The driver (W2-4, W2-5a, W2-5b) and the counters (W2-6) gather inputs and call it. Task by task:
- **Task 1.** `measure-history.py` stops computing the window. With `--families` it emits, per listed family, the raw rows Node needs: the family's calls with `arm IS NULL`, its main boundaries, and for each boundary every copy holding it. Each copy carries its assistant rows up to a required `--row-cap`, and its distinct models, uncapped. Python spells no K, no turn rule and no model text. Copies are found by key probes, never by a scan over `memberships.entry_id`. `w2` echoes the window it was run over, `{row_cap, window_start_ms, window_end_ms, families}` (W2-D13, amended). Every report gains `script_sha256`, the sha256 of the script's own bytes, after `user_version`. The script never selects `blobs.z` and imports no compression module.
- **Task 2.** `deploy/history-gate.mjs` is created: its header, its import block (lib only) and every constant and closed word set the later tasks read, each frozen once. Pins check the module's purity and that its words are its own (O14, W2-D12). The module never spells the class words `haiku` or `sonnet`, so the class-enumeration scan never counts it.
- **Task 3.** The window over assistant turns (W2-D14) and the two copy rules (W2-D15). Turns are keyed `msg_id ?? request_id ?? uuid`. The window copy is W1's longest copy, and the producer copy is `pickHoldingCopy`'s. Producer strata are folded in Node through `lib.producerOf` (W2-D16). Calls are split at the first exit 8. O52's W2 case is re-pinned against the Node builder: windows 2, with_call 2, calls 4, turns 13, unmeasured 0.
- **Task 4.** Census mode: `--census --as-of --since --row-cap` emits every family in the store with the raw rows over the look-back, plus a ticks summary. The gate gains W2-D20's active rule, with a newest-family comparator held equal to `recall.mjs`'s by a parity pin. Legacy `''` families are excluded, and that is fixed.
- **Task 5.** `changedFamilies` (W2-D23), under a module-local `recall_off:` prefix marked temporary, and `assembleReports` (W2-D22). Families are keyed by `familyKey`. A malformed report set is refused with a `GATE_REASONS` word and no partial answer: a report whose echoed window is not the record's (part 2's `window`, which the input now carries) is refused `window-mismatch` (W2-D22, amended), and each report's `script_sha256` is re-checked against `gate_code`: a measured difference is `code-changed`, which `allowCodeChange` stamps, and a sha missing on either side is `code-unmeasured`, which nothing stamps (W2-D24, amended 2026-10-19).
- **Task 6.** The bootstrap (W2-D18): exact fractions, xoshiro128** substreams, rejection sampling and nearest-rank percentiles. Also the hash-based assignment (W2-D19) and Q18's power procedure (W2-D21).
- **Task 7.** The quiz's pure decisions: `collapseWs`, admission variants, `labelCorrect`, the answer protocol and its parser, the writer prompt and its parser, and the two rubrics and their parser. Each signed text has its sha256 constant (W2-D62, W2-D63, W2-D64, W2-D72, W2-D79).
- **Task 8.** Run classification, the hand-check sampler, override and agreement, and `decideGate`: the spec's three criteria, their denominators and the halts, every comparison exact, and its one refusal, `question-not-run`, for a question still not-run at gate time (W2-D80, W2-D81, W2-D89).
- **Task 9.** `COUNTERS_DEF_V1`, the `OPEN_RECORD_V1` field schema, the model-id patterns, `checkGateCode`, `recordSha256` and `validateOpenRecord`, which covers both parts, their amendments and the chain between them (W2-D25, W2-D87, W2-D90). The validator is closed (`field-unknown`), chained (`supersedes` against the superseded record's sha), recomputes each amendment's `detail_sha256`, refuses a missing context, and reads step 0a entries in W2-4's producer shape (W2-D25, amended). By the coordinator's final W2-3/W2-4 plan review it also binds each part 1 step 0a entry to a named node and to part 1's `settings_mode` (`value-outside-set`), and refuses a flag step 0a measured rejected (`flag-rejected`) with no exception (W2-D25, amended; the coordinator's settings-mode ruling withdrew the fallback's `--restricted` exception).

Sessions see no change. No ccd, sweep, CLI or store code moves, and no node runs any of this until the W2 operator flow (decisions document section 5), which begins after every W2 PR has merged and been rolled out.

**Architecture:** Deploy side only, in two files and their one test file.

*`deploy/measure-history.py`* stays a read-only census, after the `measure-*.py` precedent: one store, opened `?mode=ro` through its percent-encoded URI (FR1-d), one JSON object headed by `store_id`, and per-node outputs concatenated, never merged. Its only W2 job is to **measure**: raw rows of `recall_calls`, `boundaries`, `memberships`, `entries`, `sessions`, `epochs`, `transcripts` and `ticks`, and its own sha256. It decides nothing: no K, no turn rule, no window end, no producer and no model test. That is O32 narrowed (W2-D16).

*`deploy/history-gate.mjs`* is pure ESM with JSDoc types and no `.d.mts` (the file list is exactly three). It imports only `../ccd/history/lib.mjs`, and `node:crypto` only if a task needs it. `lib.mjs` itself imports only `node:crypto`, so the gate's whole import closure is pure. The import block is exactly:

```js
import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';
```

It reads no fs, child_process, `process.env`, clock or `Math.random`: a seed, a time or a measured sha arrives only as a parameter. It holds:
- the window builder and the copy rules (Task 3);
- the active rule (Task 4);
- assembly and the changed-family drop (Task 5);
- the bootstrap, assignment and Q18 (Task 6);
- the quiz labeller and its signed texts (Task 7);
- run classes, the hand-check and `decideGate` (Task 8);
- the record's schema and validator (Task 9).

`deploy/history-replay.mjs` (W2-4, W2-5a, W2-5b) and `deploy/history-counters.mjs` (W2-6) import it. Neither exists on this PR's base, and this PR creates neither.

Two names in the gate are **temporary** and are replaced by W2-1, which runs after this PR merges:
- `isSyntheticLocal`, the module-local angle-bracket predicate `turnsOf` uses (W2-D17). W2-1 rewires it to lib's `isSyntheticModel`.
- `RECALL_OFF_PREFIX_LOCAL = 'recall_off:'` (W2-D23). W2-1 rewires it to lib's `RECALL_OFF_META` and adds the Python twin pin.

Each carries a `TEMPORARY (W2-D17)` or `TEMPORARY (W2-D23)` comment naming W2-1.

No schema change (W2-D10: the store stays v2). No wire, server, PWA, hook, `ccd/ccrc` or `ccd/ccd` change. No new test file (W2-D5).

**Tech Stack:**
- Python 3 standard library only, in `measure-history.py`: `sqlite3` (read-only URI), `hashlib` (sha256 of the script's own bytes, read through `os.path.realpath(__file__)`), `json`, `argparse`. No compression module, and no `zlib`, `gzip`, `bz2`, `lzma`, `brotli` or `zstandard` import.
- Node `>=22.16.0` ES modules (`.mjs`), in `history-gate.mjs`: plain JavaScript arithmetic over safe integers for every fraction, `BigInt` only where a task shows a product can pass 2^53, and `Math.imul` and `>>> 0` for xoshiro128**'s u32 words.
- vitest in `server/`, in process for the gate, and `spawnSync('python3', [...argv])` for the script, as the file's existing `measure()` helper does. Stores are made by `store.mjs`'s own `createStore` in fixture HOMEs (`mkTmp`).

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6. Line numbers were measured at `7d01973a2` and are hints only; re-anchor by content.
- §10.2 "Wave 2: the replay eval" (`:2616`), and within it:
  - "The instruments" (`:2620-2624`), including "Backend strata arrive already folded" (`:2624`);
  - "The cluster unit" (`:2711`) and "The bootstrap, exactly" (`:2713`);
  - "The gate" (`:2715`), its three criteria and the first-exit-8 split (`:2722`);
  - "Pre-registration" (`:2723`) and the task-embedded arm (`:2725`);
  - "The live A/B": the active families (`:2727`), the first exit 8 (`:2728`), the `''` mapping (`:2732`), the changed assignment (`:2733`) and "The queries" (`:2734-2737`).
- O32 (`:2439`) and O52 (`:2459`) in §9.11's pin table.
- §13's "every vocabulary is enumerated once in lib.mjs" (`:3051`).

**No task edits the spec.** Under W2-D3 and section 6 of the decisions document, W2-1 amends errata E12 to E17 in place once this PR has merged, and W2-5b amends E20, E21 and E22, the other errata whose D-numbers this plan defines. Each erratum cites its D-number.

**Ledger and authority:** the coordinator's W2 decisions document, cited throughout by section and W2-D number. Its path is in the run's brief, and it is off the repo. It is the authority for this plan (W2-D4). The programme ledger is `docs/superpowers/programs/ccrc-history.md`, which is the coordinator's file; no task edits it.

**Base:** `main` at `7d01973a2`. Every `file:line` in this plan was measured there, and the worker re-anchors each by its quoted content on its own base. Before editing an existing function in place, re-read it at the base: a plan text is never ground truth. The anchors that matter most:
- `deploy/measure-history.py` (267 lines):
  - `K = 10` (`:64`);
  - `family_windows` (`:128`), whose copy query is `'FROM memberships m WHERE m.entry_id = ? ORDER BY after DESC, m.file_id LIMIT 1'`;
  - `w2_statistic` (`:180`);
  - `main()` (`:225`) and its `report = {…}` literal.
- `server/test/measure-history.test.ts` (385 lines):
  - the `Window`, `W2` and `Report` interfaces (`:23-31`);
  - `plantedStore()` (`:54-163`);
  - the O32 describe (`:165`);
  - the O52 W2 case (`:194`);
  - the bytes-unchanged and missing-input cases (`:211` and `:219`);
  - the key-order case (`:381`).
- `ccd/history/lib.mjs`:
  - `EXIT` (`:28`, `RECALL_OFF: 8`);
  - `UUID_RE` (`:243`);
  - `canonicalJson` (`:454`) and `sha256Hex` (`:527`);
  - `backendOf` (`:1520`), `producerOf` (`:1530`) and `producerOfCopy` (`:1540`);
  - `pickHoldingCopy` (`:6702`), which takes `[{fileId, live, holds}]` and answers a `fileId` or null.
- `ccd/history/recall.mjs`: `NEWEST_FAMILY_SQL` (`:89`, `ORDER BY first_seen_ms DESC, session_pk DESC`) and the exported `familiesOf` (`:124`).
- `ccd/history/derive.mjs`: the exported `holdingCopyOf(db, b)` (`:1376`), and `leafFields`' `producerOfCopy(copy.rows, …)` call (`:316`).
- `server/test/single-definition.test.ts`, read and never edited:
  - the class-enumeration scan (`:1885-1898`, `MODELS_CORPUS` at `:1633` walks `deploy/`);
  - O14's `VOCABS`, `DECL_CORPUS` and `declares` (`:5228-5244`).

**PR:** One PR, executed in task order, in the W2 deploy lane. It is dispatched in parallel with the fleet lane's wave 5h-1 (and later 5h-2) and with W2-4 (W2-D2). Its file list is exactly:
- create `deploy/history-gate.mjs`;
- modify `deploy/measure-history.py`;
- modify `server/test/measure-history.test.ts`.

W2-1 waits for this PR to merge. The PR body names the change to W1's O52 pin (Task 3): the window statistic leaves Python, the unit becomes turns, the window ends at turn 11 or the next main boundary, and the totals move from 2/2/3/14 to 2/2/4/13.

## Global Constraints

- **Three files, nothing else.** This PR never edits `ccd/**`, `shared/**`, the spec, `README.md`, `CLAUDE.md`, `.github/**`, `deploy/history-replay.mjs`, `deploy/history-counters.mjs` or any test file other than `server/test/measure-history.test.ts`. No task creates a test file (W2-D5). `measure-history.test.ts` is already in `ci.yml`'s node-floor heredoc (`:930`), so that leg runs it on this PR. A worker who finds a fourth file unavoidable stops and reports to the coordinator before touching it.
- **The test file.** Each task's new cases go in ONE describe end-appended to `measure-history.test.ts`, titled `W2-3 Task N: …` exactly as that task names it, with any module-level helper it needs end-appended just above it (Task 1's `fileIdsByIno`; Task 3's `turnStore`, `t3Family`, `t3Planted` and `t3DeriveProducer`, `turnStore` being `plantedStore()`'s sibling). In-place edits are limited to the ones a task's **Files** names:
  - the `Window`, `W2` and `Report` interfaces (Task 1);
  - the O52 describe (Task 1 re-pins its W2 case to raw rows; Task 3 inserts a sibling case in the same describe that pins the Node totals, and leaves Task 1's case as it is);
  - the bytes-unchanged case's argv (Task 1 alone; Task 4 leaves it as it is and adds its own census case, `census: the store bytes are unchanged by a census run`, inside its end-appended describe);
  - the missing-input case (Task 1);
  - the key-order case (Task 1 adds `'script_sha256'`, Task 4 adds `'census'`).

  The `W1-B3` header comment and every existing describe stay as they are otherwise. Each static import is added once, under its own binding: Task 8 adds `gateT8` at the end of the file's import block, and Tasks 5, 6, 7 and 9 put theirs (`gateT5`; `gate6`; `t7Gate` and `t7Sha256Hex`; `gate9`, `cj9` and `sha9`) at the head of their own end-appended block, where ESM hoists them. Tasks 2, 3 and 4 load the gate through `await import` inside their cases.
- **The gate is pure (W2-D11).**
  - Its import specifiers are a subset of `{'node:crypto', '../ccd/history/lib.mjs'}`.
  - Its source holds none of `process.`, `Date.now`, `new Date`, `Math.random`, `performance.`, `require(` or `import(`, in code or in comments. Task 2's purity pin scans the whole file text, so a comment that mentions one goes red too: describe these by name instead (for example "the clock", "the environment").
  - A seed, an instant, a look-back or a measured sha is a parameter. No function has a default seed.
- **The gate's words are its own (W2-D12).**
  - It declares no name that `lib.mjs` exports: O14's `DECL_CORPUS` already scans `deploy/`, and a local `const EXIT` would make it a second holder.
  - Exactly one file under `deploy/**/*.mjs` and `server/test/**/*.ts` declares `FACT_KINDS`: `deploy/history-gate.mjs`. `LABELS` has two declarers at this PR's head: `deploy/history-gate.mjs`, and `server/test/collectLaneFixture.ts:58`, which already declares an unrelated `const LABELS` (the collect lane's box labels, built from `COLLECT_BOX_LABELS`) at `7d01973a2`. Task 2's pin carries that file as one named, live-checked exemption (`NAMED_OTHERS`), and any third declarer goes red. The coordinator accepted the exemption as written (2026-10-19): it stays named and live-checked, and W2-D12's pin is otherwise unchanged. Importing either name is allowed, and tests build their declaration needles by concatenation, so the test file never declares them itself.
  - Every closed word set is `Object.freeze`d once, in Task 2, and later tasks read it. A later task that needs a word not in the set stops and reports; it never declares a second list.
- **The class words.** `history-gate.mjs` never spells `haiku` or `sonnet`, in code, strings or comments. `single-definition.test.ts`'s class-enumeration scan (`:1885`) walks `deploy/`, and a file holding all four class words is a holder. The gate legitimately spells `/fable/i` and `/^claude-opus-/` (W2-D25), so the two lower words must stay out. Task 2 pins this with the scan's own regex.
- **Python measures, Node decides (W2-D13, W2-D16).**
  - `measure-history.py` holds no `K =` binding, no turn rule, no window end and no comparison or membership test on a model value (`==`, `!=`, `in`, `startswith`, `endswith`, a regex).
  - It emits `entries.model` strings exactly as stored.
  - It never selects `blobs.z` (no `z FROM blobs`, `blobs.z` or `SELECT z`), and imports no compression module.
  - Every `recall_calls` read keeps `arm IS NULL`.
  - A copy is found by the `ingest_files` rows of the boundary's `transcript_pk`, then one `memberships` primary-key probe per `(file_id, entry_id)`. It is never found by `WHERE m.entry_id = ?` alone, the `7d01973a2` query Task 1's PK-probe pin's CONTROL matches. `ingest_files` has no index on `transcript_pk` (`store.mjs:76-84`); it holds one row per ingested file, and the decisions document's "primary-key probes" reads it per transcript.
- **The script hashes itself.** `script_sha256` is the sha256 of the bytes at `os.path.realpath(__file__)`, read once per run. A copy run from `$TMPDIR` hashes the copy. That is how Task 1's pin shows a byte change moves the sha, and how `assembleReports` (Task 5) sees a report from another build.
- **Required flags have no defaults.**
  - `--row-cap` is required with `--families` (`'--families needs --row-cap'`, exit 2).
  - `--census` requires `--as-of`, `--since` and `--row-cap` (`'--census needs --as-of, --since and --row-cap'`, exit 2).
  - `--census` and `--families` are exclusive (`'--census and --families are exclusive'`, exit 2).
  - The W1 call (`--db [--now]`) takes none of them and still reports `w2: null` and `census: null`.
- **Exact arithmetic.** Every gate comparison is a cross-multiplication of integer fractions (`cmpFrac`). No criterion, halt or bootstrap replicate is a float comparison, and Task 6 and Task 8 each pin a constructed tie that a float mutant gets wrong.
- **No overloaded null.** No adapter narrows a distinction it received:
  - `found: false` is not an empty family;
  - `unmeasured` is not a window with no call;
  - `truncated` is not "no next turn";
  - an excluded family carries exactly one `ACTIVE_EXCLUSIONS` reason, never folded into another;
  - `parseAnswerField`'s `unknown` and `absent` stay distinct;
  - `classifyRun`'s `infra-failed` and `not-run` stay distinct;
  - `assembleReports`' `not_listed` (an assigned family no report lists) is not `not_found` (listed, absent from the store);
  - an empty treatment arm is the halt `empty-arm` with that criterion null, never a bootstrap of nothing or a `fail`;
  - a question still `not-run` at gate time is refused `question-not-run`, never counted, held or halted (W2-D89, amended);
  - a null or missing validation context is refused, never read as a narrower check (W2-D25, amended);
  - an unruled input is refused, never read as a default: with a `GATE_REASONS` word where the function answers a refusal shape (`assembleReports`, `parseQuestionLine`, `validateOpenRecord`, `decideGate`), and by a thrown error where it has none (a malformed meta row or a repeated family, Task 5; an internally malformed input to `decideGate`, Task 8).
- **Child processes take argv arrays.** Every spawn in the test file is `spawnSync`/`execFileSync` with an argv array (`python3`, `-I`, `-B` where the file already does, the script path, args). Nothing goes through a shell or a template-string command. CodeQL's `js/shell-command-injection-from-environment` opens review threads that block the merge.
- **FIXTURE HOMEs only.**
  - Every store in a test is made by `createStore(mkTmp(…))`, and every script run gets an explicit `--db` into that fixture.
  - No step runs `ccd`, the history shim, `sweep.mjs`, `cli.mjs`, any `ccrc history` verb or `measure-history.py` against the live `$HOME` or a live store. No step reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or any account home.
  - A mutant of the `.py` is applied to a copy under the task's scratch directory and run there, never by editing `deploy/` in place.
  - Never kill a process by pattern.
- **Running tests.** Run from `server/` as `./node_modules/.bin/vitest run test/measure-history.test.ts`, in the foreground, with a timeout of at least 600000 ms, and never with bare `npx vitest`. Tasks 3 and 4's parity pins import `ccd/history/derive.mjs` and `recall.mjs` in the test only. Re-run `single-definition.test.ts` unedited after Task 2 and at the end, since it scans `deploy/`.
- **Filters.** vitest compiles a `-t` filter with `new RegExp(pattern)` and matches it against the full name. Filters here use no metacharacter except a deliberate `|` or an escaped one. Each step names what its filter selects (`vitest list test/measure-history.test.ts -t '<filter>'`). A run that reports only skipped tests selected nothing: the filter is wrong, and the step is not green.
- **Fixtures.**
  - Key-shaped strings (a 40-hex SHA, an AKIA-shaped value, anything a scanner reads as a credential) are assembled at runtime from parts, never written whole.
  - Family ids, store ids, seeds and paths are synthetic (`demo-a`, `/r/lib/x.c`, a seed built as `'ab'.repeat(32)`).
- **Red-first.** Every guard is pinned red-first: watch the test fail on the unguarded code, measure each named mutant red after the guard lands, then green again. Where a red cannot be measured before the code exists (a new export), the step says "predicted" and names the error. Scratch copies go under `.superpowers/sdd/history-w2-3/scratch` (gitignored), never `git stash`, and are deleted after each mutant.
- **Node floor.** `>=22.16.0`, pinned by `node-floor.test.ts`. No task changes it.
- **Public repo.** This applies to plan text, fixtures, comments, commits and the PR body. Keep out:
  - hostnames, users, accounts, wrappers, lanes and pool names;
  - store, family or session ids from a real node;
  - IP addresses and absolute home paths;
  - private ticket ids and docserver URLs.

  Fixture paths are synthetic, in the `/r/…` or `/home/u/tree` style.
- **D-numbers.** This plan's departures were issued by the allocator, and this plan defines exactly these. Each is defined once, by this plan's own "Deviations found" section, in the em-dash form (``- **D-N** — `slug` (Task k): …``). That section is already written in full and lands with the plan, not with the PR: the worker never edits the plan file (it is not one of the PR's three files) and never re-writes an entry. Each task's commit message cites the numbers of the departures that task lands. The task named against each number below is the one that lands the departure, given for information; a number can be cited earlier (D-5771 in Task 1, D-5781 in Task 2) before the task that lands it:
  - Task 1: D-5770 (`history-w2-window-in-node`) and D-5772 (`history-w2-o32-raw-models`);
  - Task 2: D-5774 (`history-w2-deploy-local-vocabularies`) and D-5775 (`history-w2-quiz-no-decisions`);
  - Task 3: D-5771 (`history-w2-window-copy-rule`);
  - Task 4: D-5773 (`history-w2-legacy-families-excluded`);
  - Task 7: D-5776 (`history-w2-answer-field`), D-5777 (`history-w2-sha-prefix-correct`), D-5778 (`history-w2-rubric-residual-uncertain`) and D-5779 (`history-w2-writer-excerpt`);
  - Task 9: D-5781 (`history-w2-pilot-families-in-marker`).

  Rules for every other number:
  - Other W2 numbers belong to other plans. When cited, they are cited bare and never defined here: D-5763, D-5764, D-5765, D-5766, D-5767, D-5768, D-5769 and D-5780.
  - Earlier numbers in source comments are history: read them, never delete them.
  - Never write a range, and never write a number that was not issued.
  - A departure this plan does not list gets `D-TBD-<slug>`, and the worker reports it to the coordinator (worker clause 11).
  - Before the PR: `git fetch origin main`, then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.
- **Peers.** Before each first edit of an existing file, the worker reads `GET /api/claims?project=ccrc-pwa`. 5h-1, 5h-2 and W2-4 run alongside: none of them claims this PR's three paths (W2-D3), and 5h-2's never-edit list names `server/test/measure-history.test.ts`.

## Decisions

Every row is the W2 decisions document's ruling, carried here; the "Task(s)" column names where it lands.

| # | Decision | Status | Task(s) |
|---|---|---|---|
| W2-D5 | **One new W2 test file, and it is not this PR's.** W2-3's tests go in `measure-history.test.ts`. This PR runs its selection, and the node-floor leg runs every history test. | coordinator ruling (W2 decisions document) | all |
| W2-D10 | **No schema change.** The store stays v2. | coordinator ruling (W2 decisions document) | all |
| W2-D11 | **Location and purity.** The module is `deploy/history-gate.mjs`, importing only `node:crypto` and `../ccd/history/lib.mjs`. The import block takes `EXIT`, `UUID_RE`, `canonicalJson`, `pickHoldingCopy`, `producerOf` and `sha256Hex`. `UUID_RE`, a lib export, is added for W2-D20's (a); `backendOf` is not imported, because `producerOf` already reads it. No fs, child_process, environment, clock or `Math.random`. A purity pin over its imports. | coordinator ruling (W2 decisions document) | 2 |
| W2-D12 | **Deploy-local vocabularies.** `GATE_REASONS`, `FACT_KINDS`, `LABELS`, `RUBRIC_IDS` and the substream list are frozen once in the gate. No `deploy/*.mjs` declares a VOCABS name. A second declarer of `FACT_KINDS` or `LABELS` under `deploy/` or `server/test` goes red. Departs from §13:3051. | coordinator ruling (W2 decisions document); defines D-5774 | 2 |
| W2-D13 | **measure-history.py's output.** `w2 = {row_cap, window_start_ms, window_end_ms, families}` (amended 2026-10-19: the window it was run over is echoed, so `assembleReports` can refuse a report whose window is not the record's) with raw calls, boundaries and copies (rows up to `--row-cap`; models uncapped, to the copy's end). The flag is required with no default. Copies are found by key probes. `script_sha256`, `user_version` and `store_id` are in every report. No `blobs.z` and no compression import. The `arm IS NULL` rule is owned by the raw emission. Census mode. | coordinator ruling (W2 decisions document) | 1, 4 |
| W2-D14 | **The window: assistant turns, the end rule, O52 re-pinned.** K counts turns (`turnKey = msg_id ?? request_id ?? uuid`, synthetic rows dropped). The window ends exclusive at turn K+1's first row or the next main boundary, whichever is earlier; with neither, it ends inclusive at the last timed row. It is `unmeasured` with no timed row, or when the copy is truncated before turn K+1 was seen. `K_UNIT` is recorded. | coordinator ruling (W2 decisions document); defines D-5770 | 1, 2, 3 |
| W2-D15 | **The copy rules.** The producer copy is `pickHoldingCopy`'s, with `producerOf` over its uncapped `models`. The window copy is W1's longest copy (`windowCopyOf`, ties by lib's rule). There is a parity pin against derive, a CONTROL where the producer lies after the next boundary, and a CONTROL where the two rules disagree. | coordinator ruling (W2 decisions document); defines D-5771 | 3 |
| W2-D16 | **O32 narrowed.** Python emits raw `entries.model` strings and never tests them. The literal-absence pin stays, and a "no classification" pin is added. For windows, Node folds the strata through `lib.producerOf`. | coordinator ruling (W2 decisions document); defines D-5772 | 1, 3 |
| W2-D17 | **isSyntheticModel, W2-3's half.** `turnsOf` uses a module-local angle-bracket predicate, marked temporary; W2-1 extracts lib's and rewires the gate. Null-model rows remain turns. | coordinator ruling (W2 decisions document) | 3 |
| W2-D18 | **The bootstrap.** Substreams `sha256Hex(seed + ':' + label)` over the closed list, xoshiro128** from the first 16 bytes (an all-zero state refused), rejection sampling, nearest-rank at ceil(0.025·B) and ceil(0.975·B), and a pooled exact-fraction replicate. Resampling is paired in the quiz and within-arm in the A/B, with B = 10,000. A 0-window family is not a cluster. | coordinator ruling (W2 decisions document) | 2, 6, 8 |
| W2-D19 | **Assignment.** The arm is bit 0 of the first byte of `sha256(seed + ':assign:' + canonicalJson([store_id, ccrc_id, generation]))`, so it is independent of list membership. No seed is read from anywhere but the parameter. `assignment_sha256` is over the canonical sorted list. | coordinator ruling (W2 decisions document) | 6, 9 |
| W2-D20 | **Families active at W2 open.** (a) unmerged, with a UUID generation; (b) its id's newest unmerged family by `first_seen_ms DESC, session_pk DESC`, a comparator held equal to `recall.mjs` by a parity pin; (c) a main entry in [T0 − look-back, T0). Legacy `''` families are excluded, and `legacy_excluded` is fixed `true`. | coordinator ruling (W2 decisions document); the look-back (7 d) is an open-record default: the operator confirms at W2 open; defines D-5773 | 4, 9 |
| W2-D21 | **Q18, the math.** `n_f = round(windows_f × planned / covered)` with 0 dropped. A bisection over a grid from X, with common random numbers from `'q18'`, a Beta with ICC rho, a Binomial, and the gate's own bootstrap. The answer is the smallest point whose share and whose upper neighbour's share pass. `power` itself is W2-5a's. | coordinator ruling (W2 decisions document); `Q18_DEFAULTS` are open-record defaults: the operator confirms at W2 open | 6 |
| W2-D22 | **assembleReports.** Keyed by `familyKey`. It refuses a null, duplicate or unlisted store_id, a family outside the assignment, a `row_cap` other than `ROW_CAP`, a `script_sha256` other than `gate_code`'s (unless `allowCodeChange`, which stamps), and (amended 2026-10-19) a report whose echoed window is not the record's `window` (part 2's; the function's input gains it), `window-mismatch`. `found:false` families, 0-window families and unmeasured windows are excluded by count and key, and an assigned family no report lists is reported apart as `not_listed` (accepted by the coordinator for W2-3). No void threshold. | coordinator ruling (W2 decisions document) | 5 |
| W2-D23 | **Changed families.** `changedFamilies` drops a family when a change row satisfies `(prev_seen_ms ?? −∞) < end && ts_ms >= start`. Gap rows are reported and never dropped. The prefix is module-local and temporary until W2-1. The drops apply to the comparison only, so criterion 3 counts every listed treatment family. | coordinator ruling (W2 decisions document) | 5, 8 |
| W2-D24 | **gate_code, the gate's side.** `GATE_CODE_FILES` names the four hashed files. `assembleReports` re-checks each report's `script_sha256`, and `checkGateCode` compares measured shas, taken as data; `codeShas()` is W2-4's. Amended 2026-10-19: a sha absent on either side is `code-unmeasured`, never `code-changed`, and `allowCodeChange` never stamps it. | coordinator ruling (W2 decisions document) | 2, 5, 9 |
| W2-D25 | **The open record's validator.** It refuses every listed bullet with a `GATE_REASONS` word and a path, including the model patterns (`/fable/i` on the arm model, `/^claude-opus-/` on the writer and judge models, no alias shape) and the window-length tolerance [planned, planned + 1 d]. Amended 2026-10-19: closed (a field outside the schema is `field-unknown`), chained (`supersedes` against the superseded record's sha, `chain-mismatch`), each amendment's `detail_sha256` recomputed (`amendment-detail-mismatch`), a null validation context refused, and step 0a entries in W2-4's producer shape with `writer_init` and `judge_init` non-null in part 1. Amended again at the final W2-3/W2-4 plan review (2026-10-19): a part 1 step 0a entry whose `store_id` names no node, or whose `settings_mode` differs from part 1's top-level `settings_mode`, is `value-outside-set`, and a `false` in its `flags_accepted` is `flag-rejected`, for any flag, with no exception (coordinator ruling: only part 1's `settings_mode` binds step 0a, and the fallback's `--restricted` exception is withdrawn). `recordSha256`, the null context, null-where-not-allowed and `decideGate`'s union were accepted as written, each with a case and a mutant. | coordinator ruling (W2 decisions document) | 2, 8, 9 |
| W2-D60 | **Fact kinds.** `FACT_KINDS = ['sha','path','command','error']`; decisions are not sourced. | coordinator ruling (W2 decisions document); defines D-5775 | 2, 7 |
| W2-D61 | **collapseWs**, W2-3's part. Every run of Unicode whitespace becomes one space, and the result is trimmed. `F_raw` versus `F` is W2-5a's. | coordinator ruling (W2 decisions document) | 7 |
| W2-D62 | **Admission variants.** A plain substring test with no token boundaries, by kind; `LABELLER` holds the constants. | coordinator ruling (W2 decisions document) | 7 |
| W2-D63 | **labelCorrect.** It reads only the ANSWER value, with token-boundary rules by kind and `shaMinPrefix` in {7, 40}. At 7, a 7-character prefix of a longer F is correct. | coordinator ruling (W2 decisions document); `sha_min_prefix: 7` is an open-record default: the operator confirms at W2 open (40 voids the departure); defines D-5777 | 7 |
| W2-D64 | **The answer protocol.** `ANSWER_PROTOCOL`, `parseAnswerField` (the last line wins; `value`, `unknown` or `absent`), and the absent-rate halt in `decideGate`. The rates themselves are W2-5b's. | coordinator ruling (W2 decisions document); `absent_rate_max: 0.05` is an open-record default: the operator confirms at W2 open; defines D-5776 | 7, 8 |
| W2-D72 | **The question writer, W2-3's part.** `WRITER_PROMPT`, `parseQuestionLine` (the last `QUESTION:` line, at most 600 characters, else `writer-malformed`), the `writer-leak` word, and the `writer_input` words `excerpt` and `leaf-span`. The spawn is W2-5a's. | open-record default: the operator confirms at W2 open (`writer_input: 'excerpt'`; `leaf-span` voids the departure); defines D-5779 | 2, 7 |
| W2-D76 | **The pilot section's field.** `pilot.families` is in `OPEN_RECORD_V1`'s part 1, and the validator checks pilot/quiz overlap. The marker is W2-5b's. | open-record default: the operator confirms at W2 open; defines D-5781 | 9 |
| W2-D77 | **The quiz and the live A/B, the validator's check.** A quiz family whose (store_id, ccrc_id) holds a control-assigned family is refused. | open-record default: the operator confirms at W2 open | 9 |
| W2-D79 | **The rubrics.** `RUBRICS` `v1` and `v1-strict`, their sha constants, and `parseLabelLine` (the last `LABEL:` line; `uncertain` or `fabricated`, else malformed). Both widen `uncertain`. The spawn is W2-5b's. | open-record default: the operator confirms at W2 open (`rubric_id: 'v1'`); defines D-5778 | 2, 7 |
| W2-D80 | **Failed runs.** `classifyRun` has three classes; `questionOutcome` folds attempts; a stop never consumes the re-run; run-failed questions are excluded from both arms. | open-record default: the operator confirms at W2 open | 2, 8 |
| W2-D81 | **The hand-check, its pure parts.** A seeded ceil(0.2·n) of the judged answers per arm from `'handcheck'`, plus every judge-failed item. The operator's label overrides the judge's on sampled items. Agreement is exact, per arm and overall. The sheet writer and label reader are W2-5b's. | open-record default: the operator confirms at W2 open (`handcheck_agreement_min: 0.8`) | 8 |
| W2-D83 | **The task-embedded arm is not built.** RP6's clause about it is pinned on a synthetic section: report-only inputs never move the verdict. | coordinator ruling (W2 decisions document) | 8 |
| W2-D87 | **The counter definitions' text.** `COUNTERS_DEF_V1` is the frozen text of the five spec counters and of re-discovery, with its sha constant. The code is W2-6's. | open-record default: the operator confirms at W2 open (`counters_def: 'v1'`; the sha is fixed to the module's) | 9 |
| W2-D89 | **decideGate.** The quiz denominators exclude run-failed questions. The live denominator is every measured window of every listed treatment family. The three criteria are exact; the halts are absent rate, run-failed share and hand-check agreement; the judge-failed hold gives `incomplete`. The `code-changed` stamp is carried. Amended 2026-10-19: a criterion 1 or criterion 3 treatment set with no cluster left halts with `empty-arm`, and no bootstrap runs on it; a question still `not-run` at gate time is not a halt: `decideGate` refuses with `question-not-run`, naming the questions, and the operator runs or records them first. | coordinator ruling (W2 decisions document, with its 2026-10-19 amendments); `HALT_DEFAULTS` are open-record defaults: the operator confirms at W2 open | 2, 8 |
| W2-D90 | **Amendments to part 2, the validator's rule.** After window start, a superseding part 2 may differ only by appended amendments, with `kind` in `AMENDMENT_KINDS`. A `version-move` needs a re-pilot sha. `open --amend` is W2-5b's. | coordinator ruling (W2 decisions document) | 2, 9 |

**Choices this plan makes** (none is a W2-D ruling, and none is a departure). The coordinator accepted P1 and P2 as written and kept P3's superset reading at the 2026-10-19 plan review; each says what stays open:
- **P1. A null-ts end row is unmeasured** (Task 3; accepted by the coordinator, 2026-10-19). When the row that defines the window's end has a null `ts_ms` (turn K+1's first row, or the next main boundary's row), the window is `unmeasured`. W2-D14 rules the no-timed-row and truncation cases and says nothing about this one. This plan takes the strict reading, so no window is silently stretched or shortened, and names it in Review Focus 1.
- **P2. `ROW_CAP = 400`** (Task 2; accepted by the coordinator, 2026-10-19, as an open-record default the operator confirms at open: decisions §4 now reads "`ROW_CAP`, default 400 … fixed; the operator confirms the 400 at open"). The module constant is the value part 1 records, and the validator refuses another. 400 assistant rows is far beyond any fixture. A copy that needs more is `unmeasured` (W2-D14) and is counted by `assembleReports`.
- **P3. A final carries part 1 whole** (Task 9; kept by the coordinator, 2026-10-19). Decisions §4 lists part 2's own fields (`part`, `finalized_ms`, `supersedes`, the census, …); this plan reads a final as a superset of its draft: every part 1 field unchanged (`draft-mismatch` otherwise, `part`, `supersedes` and the seed apart), so a `--record <final>` consumer reads one file. The step 0a entry's keys are no longer this plan's choice: they are W2-4's producer shape (W2-4 Task 8's fifteen keys), plus the `label` and `store_id` part 1 binds each output to (W2-D25, amended). Still this plan's naming, and binding on W2-5a and W2-5b: the sub-field keys `q18` (`headline`, `at_power_80`, `at_rho_0`, `rho_hat`, …), `pilot_result` (`fidelity`, `step0b_sha256`, …) and `freezes` (`maintenance_from`, `build_from`, `surface`); decisions §4 names these fields' contents, not their keys. Task 9's "Choices" carries the detail.
- **P4. A boundary with no summary of its own is unmeasured** (Task 3). W1's summary search, which Task 1 keeps, is not bounded by the next main boundary, so such a boundary reads the next one's summary, its `rows` are empty, and its first K turns are never seen. A builder that took it as given would measure a 0-turn window running to the next boundary, counting calls past turn K (against W2-D14) and inflating criterion 3. This plan reads `summary_line > next_boundary_line` as `unmeasured`, the strict reading P1 takes, and leaves the summary rule itself as the coordinator ruled. Bounding the search in Python instead would change that rule, so it is not done here. How often a real store holds such a boundary is unmeasured.

## Review Focus

These five inputs would bite the operator running W2, and none of the decisions document's named pins exercises them. Each names the task that adds its pin.

1. **A window whose end row has no timestamp.** A transcript row can be stored with a null `ts_ms`. If turn 11's first row, or the next main boundary's row, is such a row, a builder that skipped it would end the window at the next timed row: a longer window, and calls counted that the rule excludes. Expected: the window is `unmeasured`, never stretched or shortened, and is counted by key in `assembleReports`' exclusions. This is the decomposer's reading (P1), stated as chosen. **Task 3**, with a fixture whose turn-11 row carries `ts_ms: null`, and a mutant that falls through to the next timed row, measured red.
2. **A row cap that cuts a copy between turn 10 and turn 11, with a later boundary in the same copy.** The script emits `rows` up to `--row-cap` and `truncated: true`; the next boundary's ts is still known. A builder that trusts the next-boundary end would close the window there, while the real turn 11 may lie between the cap and that boundary. Expected: `unmeasured`. Meanwhile `models` is still the full list, so the producer does not change with the cap. **Task 1** (truncated at a small cap with `models` uncapped) and **Task 3** (the truncation case, with the mutant that applies the next-boundary end).
3. **A report measured by a different build of the script.** The operator runs `measure-history.py` from a checkout or a copy that differs from the release part 1 pinned, or through a symlink. Expected: `script_sha256` is the sha of the real file's bytes, through `realpath`, and `assembleReports` refuses `code-changed` unless the run carries `allowCodeChange`, which stamps it. **Task 1** (a byte-changed copy under `$TMPDIR` reports another sha), **Task 5** (the refusal and the stamp) and **Task 9** (`checkGateCode` names each mismatched file).
4. **Two nodes holding one ccrc id string.** Two stores can each hold a family `demo-a` with different generations, or with the same generation string. Expected: they assemble as two keyed families (`familyKey` over `[store_id, ccrc_id, generation]`) and draw their arms independently. **Task 5** (RP7-pure keying) and **Task 6** (a fixture where the two arms differ).
5. **Two unmerged families of one id stamped in the same millisecond, and a legacy `''` family that is the most recent.** A re-key or a quick restart can tie `first_seen_ms`, and an old session can still be writing under `''`. Expected: the newest family is the one `recall.mjs` itself answers (the larger `session_pk` wins the tie), and the legacy family is excluded `legacy`, whatever its recency, never chosen as active and never folded into `not-newest`. **Task 4** (the parity pin with the tie-break mutant, and the legacy and merged exclusions).

## File Structure

| Path | Action | Responsibility | Task(s) |
|---|---|---|---|
| `deploy/measure-history.py` | modify | **Task 1:** `script_sha256()`; `family_report`, `boundary_copies` and `copy_record` replace `K`, `family_windows` and `w2_statistic`. `w2 = {row_cap, window_start_ms, window_end_ms, families}`, with `found`, `merged_generations`, `calls` (`arm IS NULL`, ordered by `ts_ms`, `event_key`) and `boundaries` with their copies. `--row-cap` is required with `--families`. The report keys are `store_id, user_version, script_sha256, counters, w1b_lag_p95_ms, w1c_duplicate_entries, w1e, w1f_grep_p95_ms, w2`. The docstring is rewritten. **Task 4:** `census_report(db, as_of_ms, since_ms, row_cap)` and the `--census --as-of --since` flags; a `census` key after `w2` (null without `--census`); the two new usage errors. It never selects `blobs.z` and imports no compression module. | 1, 4 |
| `deploy/history-gate.mjs` | create | **Task 2:** the header comment, the lib-only import block, and every constant and closed word set: `K`, `K_UNIT`, `X`, `METRIC_TEXT`, `ROW_CAP`, `BOOTSTRAP`, `SUBSTREAMS`, `PILOT_SUBSTREAM`, `ASSIGN_LABEL`, `GATE_REASONS`, `FACT_KINDS`, `LABELS`, `RUBRIC_IDS`, `WRITER_INPUTS`, `SHA_MIN_PREFIXES`, `ANSWER_STATES`, `RUN_CLASSES`, `QUESTION_OUTCOMES`, `VERDICTS`, `HALT_WORDS`, `WINDOW_STATES`, `ASSIGNMENT_ARMS`, `ACTIVE_EXCLUSIONS`, `AMENDMENT_KINDS` and `GATE_CODE_FILES`, plus `familyKey`. **Task 3:** `turnKey`, `turnsOf` (which W2-6 imports), the temporary `isSyntheticLocal`, `windowCopyOf`, `producerCopyOf`, `producerOfBoundary`, `windowOf`, `buildWindows`, `windowTotals` and `splitAtFirstExit8`. **Task 4:** `ACTIVE_LOOKBACK_MS`, `newestFamilyCompare`, `newestFamilyOf` and `activeFamilies`. **Task 5:** the temporary `RECALL_OFF_PREFIX_LOCAL`, `parseRecallOffRow`, `changedFamilies` and `assembleReports`. **Task 6:** `frac`, `cmpFrac`, `xoshiro128ss`, `substream`, `randInt`, `nearestRankBounds`, `clusterBootstrap`, `armOf`, `assignArms`, `assignmentSha256`, `betaDraw`, `binomialDraw`, `expectedWindows`, `q18Power` and `Q18_DEFAULTS`. **Task 7:** `LABELLER`, `collapseWs`, `factVariants`, `admitFact`, `labelCorrect`, `ANSWER_PROTOCOL` and its sha, `parseAnswerField`, `WRITER_PROMPT` and its sha, `WRITER_QUESTION_MAX`, `parseQuestionLine`, `RUBRICS`, `RUBRIC_SHA256` and `parseLabelLine`. **Task 8:** `classifyRun`, `questionOutcome`, `handcheckSample`, `applyHandcheck`, `handcheckAgreement`, `HALT_DEFAULTS` and `decideGate`. **Task 9:** `COUNTERS_DEF_V1` and its sha, `OPEN_RECORD_KIND`, `OPEN_RECORD_V1`, `EXACT_MODEL_ID_RE`, `ARM_MODEL_FORBIDDEN_RE`, `OPUS_MODEL_RE`, `checkGateCode`, `recordSha256` and `validateOpenRecord`. Every export carries a JSDoc type. | 2–9 |
| `server/test/measure-history.test.ts` | modify | **In place:** the `Window`, `W2` and `Report` interfaces, the O52 describe (its W2 case re-pinned to raw rows in Task 1; a sibling case for the Node totals inserted in Task 3), the bytes-unchanged case's argv (Task 1 only; Task 4's census bytes-unchanged case is a new case in its own describe), the missing-input case (Task 1), and the key-order case (`'script_sha256'` in Task 1, `'census'` in Task 4). The O32 describe's literal-absence pin stays unedited. **End-appended helpers:** Task 1's `fileIdsByIno`, and Task 3's `turnStore` (a sibling of `plantedStore()` that takes `msg_id`, `request_id` and `model` per row) with `t3Family`, `t3Planted` and `t3DeriveProducer`. **End-appended imports:** `gateT5` (Task 5), `gate6` (Task 6), `t7Gate` and `t7Sha256Hex` (Task 7), `gate9`, `cj9` and `sha9` (Task 9); `gateT8` goes at the end of the top import block (Task 8). **End-appended**, one describe per task: `W2-3 Task 1: raw window rows`, `W2-3 Task 2: the gate module is pure and its words are its own`, `W2-3 Task 3: windows over assistant turns`, `W2-3 Task 4: the census and the active rule`, `W2-3 Task 5: changed families and the assembled reports`, `W2-3 Task 6: the bootstrap, the assignment and Q18`, `W2-3 Task 7: the quiz labeller and its texts`, `W2-3 Task 8: run classes, the hand-check and the gate`, and `W2-3 Task 9: the counter definitions and the open record`. | 1–9 |

Read, run and never edited: `server/test/single-definition.test.ts` (O14 and the class scan stay green), `ccd/history/lib.mjs`, `ccd/history/recall.mjs` and `ccd/history/derive.mjs` (imported by the test for the parity pins), and `ccd/history/store.mjs` (`createStore`).

## Not in this plan

- **W2-1 (fleet), after this PR merges:**
  - the `isSyntheticModel` extraction into lib, with `backendOf` using it and the gate's `isSyntheticLocal` rewired (W2-D17);
  - `RECALL_OFF_META` in lib, the gate's `RECALL_OFF_PREFIX_LOCAL` rewired, and the Python twin pin (W2-D23);
  - `measure-history.py`'s raw `recall_off:*` meta rows (W2-D23);
  - the recall-off verb and the presence record (W2-D26 to W2-D33);
  - the spec errata E12 to E17, for this PR's departures (W2-D3).
- **W2-2a and W2-2b (fleet):** the as-of cut, the headless seam, `RECALL_ARMS` and the marker grammar (W2-D34 to W2-D50).
- **W2-4 (deploy, alongside):**
  - `deploy/history-replay.mjs` and `server/test/history-replay.test.ts`;
  - `codeShas()`, which measures the four files' shas this PR's `checkGateCode` compares;
  - `DRIVER_REASONS`, the spawn contract and the preflights;
  - the `ci.yml` heredoc line and the lifecycle row (W2-D50 to W2-D59).
- **W2-5a (deploy):**
  - reconstruction, mining, `F_raw`, Baseline B, answerability and sampling;
  - the writer spawn;
  - `freeze`, `pilot-source`, `quiz-source` and `power` (with the census assembler that reads Task 4's output);
  - `open --draft`, `--finalize` and `--template` (which derives its skeleton from `OPEN_RECORD_V1`);
  - `verify --registry` and `verify --section ab`;
  - each of its `--record` consumers' `codeShas()` re-check (W2-D61, W2-D65 to W2-D75, W2-D84).
- **W2-5b (deploy):**
  - the arm, judge and pilot spawns;
  - the absent and run-failed rates that feed `decideGate`;
  - the hand-check sheet and label reader;
  - quiz uptake, `marker`, `open --amend` and `report`, which gathers inputs and calls `decideGate`;
  - README's driver text, and errata E20, E21 and E22 (which cite this plan's D-5779, D-5781, D-5776, D-5777 and D-5778) with the others it amends (W2-D58, W2-D64, W2-D76 to W2-D85, W2-D90).
- **W2-6 (deploy):** `deploy/history-counters.mjs`, which imports `turnsOf`, the window builder and `COUNTERS_DEF_V1`; the single-definition pin naming `turnsOf`'s two callers; and the counters' errata (W2-D86 to W2-D88).
- **Not in W2 at all:**
  - moving the newest-family order into lib (W2-D20 keeps a parity pin instead);
  - the task-embedded arm (W2-D83);
  - a void threshold in `assembleReports` (W2-D22).
- **Never the worker's:** every operator act in the decisions document's section 5; any run of `measure-history.py` on a real store; the open record itself; the rollout.
- **A residual, named (coordinator ruling):** the producer's summary rule. `measure-history.py` keeps W1's rule (a copy's `models` start after the first `is_compact_summary` row after the boundary), while derive.mjs reads lib's anchor-based `summaryRowFor`. They can disagree only when an assistant row with a non-unknown model lies between a boundary and its summary row. Producer strata are report-only and never gate, so W2 keeps W1's rule, Task 3's parity fixtures stay off that shape, and no task changes either rule (D-5771). The same unbounded search has a window-side effect, a boundary with no summary of its own; Task 3 reads that window as unmeasured without changing the rule (P4).
- **A named exemption (accepted by the coordinator, 2026-10-19):** W2-D12's `LABELS` pin, read literally, is red at the base, because `server/test/collectLaneFixture.ts:58` already declares an unrelated `const LABELS`. That file is outside this PR's three files, so Task 2 carries it as one named, live-checked exemption instead of narrowing the scan (Task 2's "Choices" and Task 2's mutant M11). No fixture rename and no narrowed scan.
- **No list of the comparison drops (accepted by the coordinator, 2026-10-19).** No W2-3 task reads one, so the gate declares none; W2-5b adds report words to the gate if its report needs them.

---

### Task 1: measure-history.py emits raw window rows: copies, rows, models, calls, self-hash; Python spells no K, turn rule or model text

At `7d01973a2`, `deploy/measure-history.py` computes the W2 window statistic itself (`K = 10`, `family_windows`, `w2_statistic`): ten assistant **entries** after a boundary's summary, in the single longest copy, ending at the tenth entry's `ts_ms`. W2-D14 moves that statistic to Node, counts **turns**, and ends a window at the next main boundary. This task is the Python half. The script stops deciding anything about a window and prints the raw rows the gate module (Tasks 3 and 5) builds windows from:
- per listed family: `found`, its merged `''` generations, its live `recall_calls` rows (`arm IS NULL`), and its main boundaries in the window;
- per boundary: **every** copy that holds it, found by primary-key probes;
- per copy: its boundary, summary and next-boundary lines, its last timed row, its assistant rows up to a required `--row-cap` (`truncated` says when the cap cut them), and its `models`, uncapped and run to the end of the copy.

Every report also gains `script_sha256`, the hash of the script's own bytes (W2-D13; the open record's `gate_code` pins it, W2-D24). The script never selects `blobs.z` and imports no compression module. O32 is narrowed (W2-D16): model strings are printed raw and never tested. This task does not build or total any window. The O52 totals (windows 2, with_call 2, calls 4, turns 13, unmeasured 0) are re-pinned against the Node builder in Task 3. This task re-pins O52's **raw-row** half: the hand-derived rows of the planted fixture.

**Files:**
- Modify: `deploy/measure-history.py`. Line numbers were measured at `7d01973a2`; re-anchor by the quoted content:
  - the module docstring, from `"""measure-history.py: the ccrc history census` (`:2`) to its closing `"""` (`:60`): replaced whole;
  - the import line `import argparse, json, os, sqlite3, sys, time, urllib.parse` (`:61`);
  - the line `K = 10   # the window: the first K assistant entries after a main boundary's summary row (ruled Q14)` (`:64`): deleted;
  - `family_scope` (`:113`), `family_windows` (`:128`) and `w2_statistic` (`:180`): replaced, as one block running from `def family_scope(` to the blank lines before `def w1e_statistic(` (`:197`), by `family_scope` (its merged query gains `ORDER BY session_pk`), `script_sha256`, `copy_record`, `boundary_copies` and `family_report`;
  - in `w1e_statistic`'s docstring, the words `so no model is classified` (`:203`) become `so no model name is classified`, so that the scan added below reads clean prose;
  - in `main`: one `--row-cap` argument after `--window-end` (`:232`), two refusals after the window refusal (`:234-235`), `script_sha256` after `user_version` in the report literal (`:244`), and the `w2` assignment (`:258`).
- Modify: `server/test/measure-history.test.ts`. In place:
  - the `Window`, `W2` and `Report` interfaces (`:23-31`);
  - the O52 W2 case `the W2 window statistic: two windows, both with a call, three calls over fourteen assistant entries` (`:194-207`), rewritten to pin the raw rows;
  - the bytes-unchanged case's argv (`:215`), which gains `--row-cap 400`;
  - the missing-input case (`:219-230`), which gains the `--row-cap` refusal;
  - the key-order case (`:381-384`), which gains `'script_sha256'`.

  End-appended: the module-level helper `fileIdsByIno` and the describe `W2-3 Task 1: raw window rows`. `plantedStore()` is not edited. The new cases reuse its rows, and one describe-local helper sets models on them after planting.
- Not edited: `deploy/history-gate.mjs` (it does not exist until Task 2), `ccd/**`, `shared/**`, the spec, README.md, CLAUDE.md, `.github/**` and `deploy/history-replay.mjs`. The spec's errata for this task (E12, E13 and E14, citing D-5770 and D-5772) are W2-1's to write (W2-D3).

**Interfaces:**
- Consumes (base, `7d01973a2`):
  - the store schema made by `ccd/history/store.mjs`'s `createStore`:
    - `sessions` (`session_pk`, `ccrc_id`, `generation`, `merged_into`), `epochs` (`session_pk`, `cc_session_uuid`, `confirmed_ms`) and `transcripts` (`transcript_pk`, `cc_session_uuid`, `agent_id`);
    - `ingest_files` (`file_id`, `transcript_pk`, `source_key`) and `memberships` (PRIMARY KEY `(file_id, entry_id)`, index `memberships_order` on `(file_id, line)`);
    - `entries` (`entry_id`, `uuid`, `type`, `ts_ms`, `is_compact_summary`, `model`, `msg_id`, `request_id`), `boundaries` (`entry_id`, `transcript_pk`) and `recall_calls` (`event_key`, `ccrc_id`, `generation`, `ts_ms`, `verb`, `rc`, `arm`);
  - in the test: `plantedStore()`, `createStore`, `scrubbedEnv`, `mkTmp`, `measure`, `report`, `PY_ISOLATED`, `SCRIPT`, `NOW`, `G1`, `G2` and `OTHER_STORE`.
- Produces (Python, `deploy/measure-history.py`):
  - `script_sha256() -> str`: the lowercase hex sha256 of `open(os.path.realpath(__file__), 'rb').read()`.
  - `copy_record(db, file_id, source_key, boundary_entry_id, row_cap) -> dict`, a **Copy**: `{file_id, source_key, boundary_line, after_count, summary_line|null, next_boundary_line|null, next_boundary_ts_ms|null, last_ts_ms|null, rows, models, truncated}`.
    - `rows` is a list of `[line, ts_ms, msg_id, request_id, uuid, model]`, at most `row_cap` long.
    - `models` is a list of `str|null`, distinct, in first-appearance order, and uncapped.
    - `truncated` is a bool.
  - `boundary_copies(db, entry_id, transcript_pk, row_cap) -> list[dict]`: every Copy holding the boundary, by `file_id`.
  - `family_report(db, ccrc_id, generation, start_ms, end_ms, row_cap) -> dict`, a **FamilyReport**: `{ccrc_id, generation, found, merged_generations: [str], calls: [[ts_ms, rc, verb]], boundaries: [{boundary_uuid, ts_ms, copies: [Copy]}]}`.
  - Report keys, in order: `store_id`, `user_version`, `script_sha256`, `counters`, `w1b_lag_p95_ms`, `w1c_duplicate_entries`, `w1e`, `w1f_grep_p95_ms`, `w2`. `w2` is `null` without `--families`. Otherwise it is `{row_cap, window_start_ms, window_end_ms, families: [FamilyReport]}`: the two window fields echo `--window-start` and `--window-end` (W2-D13, amended 2026-10-19, so `assembleReports` can refuse a report measured over another window than the record's, W2-D22), and `families` holds one FamilyReport per listed family of this store, in list order.
  - Usage errors, exit 2: `--families needs --row-cap` and `--row-cap must be a positive integer`. `--families needs --window-start and --window-end (epoch ms)` stays.
  - Removed: `K`, `family_windows` and `w2_statistic`.
- Produces (test, `server/test/measure-history.test.ts`; Tasks 3 to 5 may reuse them):
  - the types `RawRow`, `CallRow`, `Copy`, `BoundaryReport`, `FamilyReport` and `W2`, and `Report.script_sha256`;
  - the module-level function `fileIdsByIno(dbPath: string): number[]`, which answers the planted store's file ids in planting order `[f2, f1, subagent, demo-b]`. It is a hoisted function declaration, so the in-place O52 case can call it.

**Spec and decisions:** spec rev 3.6, §10.2 "The instruments" (`:2620-2624`) and "The queries" (`:2734-2737`), O32 (`:2439`) and O52 (`:2459`). Decisions:
- W2-D13 (the families half): raw rows, copies, uncapped models, PK probes, the required `--row-cap`, the echoed window (amended 2026-10-19), the self-hash, `user_version` and `store_id`, no blob read, and the `arm IS NULL` rule, which this raw emission owns;
- W2-D16 (O32 narrowed);
- W2-D14, cited: the statistic leaves Python.

This task lands **D-5770** (`history-w2-window-in-node`) and **D-5772** (`history-w2-o32-raw-models`). Both are already defined in this plan's "Deviations found"; this task's commit message cites them, and the worker does not edit the plan file.

**Choices this task makes:**
- **`models` are made distinct in SQL** (`GROUP BY e.model ORDER BY min(m.line)`), so no Python line compares a model value. A null model is one value among the rest. It appears once when any witness row has none, and `lib.producerOf` reads it as `unknown` and skips it. The no-classification pin covers SQL predicates too: `e.model IS NOT NULL` is mutant M15b.
- **The summary rule stays W1's:** the first `is_compact_summary` row after the boundary in that copy. The search is not bounded by the next boundary and does not exclude echo rows. derive.mjs's `summaryRowFor` is anchor-based. The two can disagree on the producer only when an assistant row with a non-unknown model lies between a boundary and its summary row. The coordinator ruled on it: producer strata are report-only and never gate, so W1's rule is kept, Task 3's parity fixtures stay off that shape, and the divergence is a named residual (the header's "Not in this plan", and D-5771's entry).
- **The next boundary** is the first `boundaries` row after the boundary's line in the same file, whatever its `ts_ms` and whether or not it falls inside the window. The file is the main transcript's, so that row is a main boundary. B2's next boundary is B3 at 7000, past `--window-end`.
- **`last_ts_ms` is W1's query:** the file's last timed row of any type, over the whole copy.
- **Copies are listed by `file_id`.** A boundary that no file holds is printed with `copies: []`. Choosing the window copy and the producer copy is Task 3's work (`windowCopyOf`, `producerCopyOf`).
- **`merged_generations` order is pinned:** `family_scope`'s merged query gains `ORDER BY session_pk`.
- **`--row-cap` has no default and is required with `--families`.** A value below 1 is refused with its own text. Given without `--families`, it is accepted and unused (Task 4's census reads it). The W1 call `--db --now` takes none and still reports `w2: null`.
- **`realpath` is not observable through the hash.** A symlink read and its target read give the same bytes, so no mutant is claimed for `realpath`. The byte-changed copy run from a temp directory is the self-hash pin.
- **Each scan's reach is named:**
  - The no-classification scan sees values named `model` or `models`, in Python and SQL. A test written through another name is caught only by O32's literal scan (`claude`, `startswith`, `<synthetic>`), which stays.
  - The PK-probe scan flags any `WHERE <alias.>entry_id =|IN` within 200 characters after `FROM memberships`. A primary-key probe written entry_id-first would be flagged too, which errs toward refusal.
  - Both scans read the whole source, comments and docstring included. That is why the W1-e docstring's `model is` is reworded.

- [ ] **Step 1: Confirm the base before editing.** From the repository root:

```bash
git log -1 --format=%h
grep -c '^K = 10   # the window' deploy/measure-history.py
grep -c '^def family_windows(\|^def w2_statistic(' deploy/measure-history.py
grep -c "FROM memberships m WHERE m.entry_id = ?" deploy/measure-history.py
grep -c "so no model is classified" deploy/measure-history.py
grep -c "it('the W2 window statistic: two windows, both with a call, three calls over fourteen assistant entries'" server/test/measure-history.test.ts
grep -c "^interface Window {" server/test/measure-history.test.ts
grep -c "'--window-start', '0', '--window-end', '9000'\]" server/test/measure-history.test.ts
grep -c "toEqual(\['store_id', 'user_version', 'counters'," server/test/measure-history.test.ts
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
```

Expected (measured at `7d01973a2`):
- every `grep -c` prints 1, and the second prints 2;
- the suite is green, `17 passed (17)`.

A 0 means the base moved. Re-anchor by content before editing. A peer's edit to either file is a claim question (Global Constraints), never a reason to edit around it.

- [ ] **Step 2: Write the failing tests.** In `server/test/measure-history.test.ts`:

(a) Replace the interfaces

```ts
interface Window { boundary_uuid: string; boundary_ts_ms: number; end_ts_ms: number | null; assistant_entries: number; calls: number | null }
interface W2 {
  windows: number; with_call: number; calls: number; assistant_entries: number; per_turn_rate: number | null; unmeasured: number;
  by_family: Array<{ ccrc_id: string; generation: string; windows: Window[] }>;
}
interface Report {
  store_id: string | null; user_version: number; counters: Record<string, number>; w1b_lag_p95_ms: number | null;
  w1c_duplicate_entries: number; w1f_grep_p95_ms: number | null; w2: W2 | null;
}
```

with

```ts
/** W2-3 Task 1 (W2-D13): the raw rows measure-history.py prints; deploy/history-gate.mjs builds every window from them. */
type RawRow = [line: number, ts_ms: number | null, msg_id: string | null, request_id: string | null, uuid: string, model: string | null];
type CallRow = [ts_ms: number, rc: number, verb: string];
interface Copy {
  file_id: number; source_key: string; boundary_line: number; after_count: number; summary_line: number | null;
  next_boundary_line: number | null; next_boundary_ts_ms: number | null; last_ts_ms: number | null;
  rows: RawRow[]; models: Array<string | null>; truncated: boolean;
}
interface BoundaryReport { boundary_uuid: string; ts_ms: number; copies: Copy[] }
interface FamilyReport {
  ccrc_id: string; generation: string; found: boolean; merged_generations: string[]; calls: CallRow[]; boundaries: BoundaryReport[];
}
interface W2 { row_cap: number; window_start_ms: number; window_end_ms: number; families: FamilyReport[] }
interface Report {
  store_id: string | null; user_version: number; script_sha256: string; counters: Record<string, number>; w1b_lag_p95_ms: number | null;
  w1c_duplicate_entries: number; w1f_grep_p95_ms: number | null; w2: W2 | null;
}
```

(b) Replace the O52 W2 case

```ts
  it('the W2 window statistic: two windows, both with a call, three calls over fourteen assistant entries', () => {
    const f = plantedStore();
    const rep = report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000']);
    // B1: the first 10 turns after its summary end at 3900; k1 (2500) and k2 (3900, inclusive) count; k3, k4 are
    //     outside, k5 is a replay arm's. B2: 4 turns after its summary (5100, 5200, 5300, 7100), fewer than 10, so
    //     it ends at the copy's last row (7100); k6, the merged '' family's, counts. B3 (7000) is past
    //     --window-end, the subagent boundary is not a main one, and demo-b is listed under another store.
    expect(rep.w2).toMatchObject({ windows: 2, with_call: 2, calls: 3, assistant_entries: 14, unmeasured: 0 });
    expect(rep.w2!.per_turn_rate).toBeCloseTo(3 / 14, 12);
    expect(rep.w2!.by_family).toEqual([{ ccrc_id: 'demo-a', generation: G1, windows: [
      { boundary_uuid: f.b1, boundary_ts_ms: 2000, end_ts_ms: 3900, assistant_entries: 10, calls: 2 },
      { boundary_uuid: f.b2, boundary_ts_ms: 5000, end_ts_ms: 7100, assistant_entries: 4, calls: 1 },
    ] }]);
  });
```

with

```ts
  it('the W2 raw rows: demo-a\'s calls and its two main boundaries, copy by copy and row by row (W2-D13)', () => {
    const f = plantedStore();
    const rep = report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000', '--row-cap', '400']);
    // Worked by hand from plantedStore. f1's rows are planted first, so its line L is entry e-L (b1 = e-3, b2 = e-17).
    // calls: demo-a's rows of G1 and of the merged '' family with no arm, at or after 1500, by ts_ms: k4 1999, k1 2500,
    //   k2 3900, k3 3950, k6 5200 (gen ''). k5 (2600) is a replay arm's; k7 is demo-b's; the g* rows are demo-c's.
    // boundaries in [1500, 6000): B1 (2000) and B2 (5000); B3 (7000) is past --window-end, the subagent boundary
    //   (2500) is not a main one, and demo-b is listed under another store, so it is skipped.
    // B1 is held by two copies, listed by file_id: f2 (planted first, the lower id) holds B1 at line 1 and its summary
    //   at line 2, nothing after; f1 holds B1 at line 3 with 22 rows after it (lines 4..25), its summary at line 4,
    //   the next boundary B2 at line 17 (5000), and its last timed row at line 25 (7100). The assistant rows after the
    //   summary and before line 17 are lines 5..16, at 3000..4100. No planted row has a model, msg_id or request_id.
    // B2 is held by f1 alone: line 17, 8 rows after it, summary 18, next boundary B3 at line 23 (7000); its rows are
    //   lines 19..21 (line 22 is a user row, line 25 lies past B3). models run past B3 to line 25, still one null.
    const [f2, f1] = fileIdsByIno(f.db);
    const raw = (line: number, ts: number): RawRow => [line, ts, null, null, `e-${line}`, null];
    expect(f.b1).toBe('e-3');
    expect(f.b2).toBe('e-17');
    // w2 echoes the window it was run over (W2-D13, amended), so assembleReports can refuse a report whose window is not the record's.
    expect(rep.w2).toEqual({ row_cap: 400, window_start_ms: 1500, window_end_ms: 6000, families: [{
      ccrc_id: 'demo-a', generation: G1, found: true, merged_generations: [''],
      calls: [[1999, 0, 'expand'], [2500, 0, 'expand'], [3900, 0, 'describe'], [3950, 0, 'expand'], [5200, 0, 'expand']],
      boundaries: [
        { boundary_uuid: f.b1, ts_ms: 2000, copies: [
          { file_id: f2, source_key: '', boundary_line: 1, after_count: 1, summary_line: 2, next_boundary_line: null,
            next_boundary_ts_ms: null, last_ts_ms: 2001, rows: [], models: [], truncated: false },
          { file_id: f1, source_key: '', boundary_line: 3, after_count: 22, summary_line: 4, next_boundary_line: 17,
            next_boundary_ts_ms: 5000, last_ts_ms: 7100,
            rows: Array.from({ length: 12 }, (_, k) => raw(5 + k, 3000 + 100 * k)), models: [null], truncated: false },
        ] },
        { boundary_uuid: f.b2, ts_ms: 5000, copies: [
          { file_id: f1, source_key: '', boundary_line: 17, after_count: 8, summary_line: 18, next_boundary_line: 23,
            next_boundary_ts_ms: 7000, last_ts_ms: 7100, rows: [raw(19, 5100), raw(20, 5200), raw(21, 5300)], models: [null], truncated: false },
        ] },
      ],
    }] });
  });
```

(c) In the bytes-unchanged case, replace the one line

```ts
    report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '0', '--window-end', '9000']);
```

with

```ts
    report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '0', '--window-end', '9000', '--row-cap', '400']);
```

(d) In the missing-input case, replace its title line

```ts
  it('a missing store exits 2 and creates nothing; --families without its window exits 2', () => {
```

with

```ts
  it('a missing store exits 2 and creates nothing; --families without its window exits 2, and without --row-cap exits 2', () => {
```

and its last assertion and closing line

```ts
    expect(w.stderr).toContain('--families needs --window-start and --window-end');
  });
```

with

```ts
    expect(w.stderr).toContain('--families needs --window-start and --window-end');
    const c = measure(['--db', f.db, '--families', f.families, '--window-start', '0', '--window-end', '9000']);
    expect(c.code).toBe(2);
    expect(c.stderr).toContain('--families needs --row-cap');
    expect(c.stdout).toBe('');
  });
```

(e) In the W1-e key-order case, replace the one line

```ts
    expect(Object.keys(report(['--db', cardStore({}), '--now', String(NOW)]))).toEqual(['store_id', 'user_version', 'counters',
```

with

```ts
    expect(Object.keys(report(['--db', cardStore({}), '--now', String(NOW)]))).toEqual(['store_id', 'user_version', 'script_sha256', 'counters',
```

(f) Append at the end of the file:

```ts
// ── W2-3 Task 1: raw window rows (W2-D13, W2-D16; D-5770, D-5772). END-APPENDED. ─────────────────────────────────
// measure-history.py prints raw rows and decides nothing about a window: deploy/history-gate.mjs builds every window,
// turn and producer from them (W2-D14, W2-D15). Each case below runs the real script against a store createStore made.

/** The planted store's ingest file ids in planting order (ino 100, 101, …): f2, f1, the subagent's file, demo-b's. */
function fileIdsByIno(dbPath: string): number[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return (db.prepare('SELECT file_id FROM ingest_files ORDER BY ino').all() as Array<{ file_id: number }>).map((r) => Number(r.file_id));
  } finally {
    db.close();
  }
}

describe('W2-3 Task 1: raw window rows', () => {
  /** plantedStore with models, msg_ids and request_ids set on f1's rows (line L is entry e-L): two rows of one API
   *  message at lines 5 and 6, a `<synthetic>` row at 7, a second model at 14, and a third at 25, past B2's next
   *  boundary (line 23). Every other row keeps a null model. */
  const modelled = (): Planted => {
    const f = plantedStore();
    const db = new DatabaseSync(f.db);
    try {
      const set = db.prepare('UPDATE entries SET model = ?, msg_id = ?, request_id = ? WHERE uuid = ?');
      for (const [uuid, model, msg, req] of [
        ['e-5', 'model-a', 'msg-1', 'req-1'], ['e-6', 'model-a', 'msg-1', 'req-1'], ['e-7', '<synthetic>', null, null],
        ['e-14', 'model-b', 'msg-9', null], ['e-25', 'model-c', null, 'req-20'],
      ] as const) expect(Number(set.run(model, msg, req, uuid).changes), uuid).toBe(1);
    } finally {
      db.close();
    }
    return f;
  };
  const W2_ARGS = (f: Planted, cap: string): string[] =>
    ['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000', '--row-cap', cap];
  const demoA = (rep: Report): FamilyReport => {
    const fam = rep.w2!.families.find((x) => x.ccrc_id === 'demo-a');
    expect(fam, JSON.stringify(rep.w2)).toBeDefined();
    return fam!;
  };
  /** The copy of boundary `uuid` held by file `fileId`. */
  const copyOf = (fam: FamilyReport, uuid: string, fileId: number): Copy => {
    const c = fam.boundaries.find((b) => b.boundary_uuid === uuid)?.copies.find((x) => x.file_id === fileId);
    expect(c, `${uuid} in file ${fileId}`).toBeDefined();
    return c!;
  };

  it('the arm pin: a replay arm\'s call (k5, inside B1) is absent from calls, as its grep is from W1-f', () => {
    const f = plantedStore();
    const rep = report(W2_ARGS(f, '400'));
    expect(demoA(rep).calls.map((c) => c[0])).toEqual([1999, 2500, 3900, 3950, 5200]);
    expect(demoA(rep).calls.map((c) => c[0])).not.toContain(2600);
    expect(rep.w1f_grep_p95_ms).toBe(2000);
  });

  it('merged_generations holds the \'\' row a re-key merged into the family, and that row\'s call (k6) is in calls', () => {
    const fam = demoA(report(W2_ARGS(plantedStore(), '400')));
    expect(fam.merged_generations).toEqual(['']);
    expect(fam.calls).toContainEqual([5200, 0, 'expand']);
  });

  it('a listed family the store does not hold is found: false with empty lists, never an empty list; another store\'s family is skipped', () => {
    const f = plantedStore();
    writeFileSync(f.families, JSON.stringify([
      { store_id: f.storeId, ccrc_id: 'demo-a', generation: G1 },
      { store_id: f.storeId, ccrc_id: 'demo-z', generation: G2 },
      { store_id: OTHER_STORE, ccrc_id: 'demo-b', generation: G2 },
    ]));
    const rep = report(W2_ARGS(f, '400'));
    expect(rep.w2!.families.map((x) => [x.ccrc_id, x.found])).toEqual([['demo-a', true], ['demo-z', false]]);
    expect(rep.w2!.families[1]).toEqual({ ccrc_id: 'demo-z', generation: G2, found: false, merged_generations: [], calls: [], boundaries: [] });
  });

  it('rows carry msg_id, request_id, uuid and model raw: two rows of one message stay two rows, and a <synthetic> row is still a row', () => {
    const f = modelled();
    const [, f1] = fileIdsByIno(f.db);
    const c = copyOf(demoA(report(W2_ARGS(f, '400'))), f.b1, f1);
    expect(c.rows.slice(0, 3)).toEqual([
      [5, 3000, 'msg-1', 'req-1', 'e-5', 'model-a'], [6, 3100, 'msg-1', 'req-1', 'e-6', 'model-a'], [7, 3200, null, null, 'e-7', '<synthetic>'],
    ]);
    expect(c.rows).toHaveLength(12);
    expect(c.rows[9]).toEqual([14, 3900, 'msg-9', null, 'e-14', 'model-b']);
  });

  it('models: every assistant row after the summary to the end of the copy, distinct, by first appearance, past the next boundary', () => {
    const f = modelled();
    const [, f1] = fileIdsByIno(f.db);
    const fam = demoA(report(W2_ARGS(f, '400')));
    // B1 in f1: assistant rows at lines 5..16, 19..21 and 25. Line 25 lies past the next boundary (17) and past B3 (23).
    expect(copyOf(fam, f.b1, f1).models).toEqual(['model-a', '<synthetic>', null, 'model-b', 'model-c']);
    // B2 in f1: lines 19..21 (null) and 25 (model-c), which lies past its next boundary (23).
    expect(copyOf(fam, f.b2, f1).models).toEqual([null, 'model-c']);
  });

  it('truncated: at --row-cap 3 B1\'s rows are cut to three and flagged, B2\'s exactly three are not, and models stay uncapped', () => {
    const f = modelled();
    const [f2, f1] = fileIdsByIno(f.db);
    const rep = report(W2_ARGS(f, '3'));
    expect(rep.w2!.row_cap).toBe(3);
    const fam = demoA(rep);
    const b1 = copyOf(fam, f.b1, f1);
    expect(b1.rows.map((r) => r[0])).toEqual([5, 6, 7]);
    expect(b1.truncated).toBe(true);
    expect(b1.after_count, 'after_count is uncapped').toBe(22);
    expect(b1.models).toEqual(['model-a', '<synthetic>', null, 'model-b', 'model-c']);
    const b2 = copyOf(fam, f.b2, f1);
    expect(b2.rows.map((r) => r[0])).toEqual([19, 20, 21]);
    expect(b2.truncated).toBe(false);
    expect(copyOf(fam, f.b1, f2)).toMatchObject({ rows: [], truncated: false });
  });

  it('--families without --row-cap exits 2 naming it, and a --row-cap below 1 exits 2; the W1 call takes none and reports w2 null', () => {
    const f = plantedStore();
    const none = measure(W2_ARGS(f, '400').slice(0, -2));
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('--families needs --row-cap');
    const zero = measure(W2_ARGS(f, '0'));
    expect(zero.code).toBe(2);
    expect(zero.stderr).toContain('--row-cap must be a positive integer');
    expect(report(['--db', f.db, '--now', String(NOW)]).w2).toBeNull();
  });

  it('script_sha256 is the sha256 of the script\'s own bytes, and a byte-changed copy run from a temp directory reports its own', () => {
    const f = plantedStore();
    const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
    expect(report(['--db', f.db, '--now', String(NOW)]).script_sha256).toBe(sha(SCRIPT));
    const dir = mkTmp('ccrc-measure-history-sha-');
    const copy = path.join(dir, 'measure-history.py');
    writeFileSync(copy, `${readFileSync(SCRIPT, 'utf8')}\n# one byte-changed copy\n`);
    const r = spawnSync('python3', [...PY_ISOLATED, copy, '--db', f.db, '--now', String(NOW)],
      { encoding: 'utf8', env: { ...scrubbedEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    const got = (JSON.parse(r.stdout) as Report).script_sha256;
    expect(got).toBe(sha(copy));
    expect(got).not.toBe(sha(SCRIPT));
  });

  // O32 narrowed (W2-D16, D-5772): the script prints entries.model raw and never tests it. The scan reads the whole
  // source, comments and docstring included, so the prose there keeps these shapes out too.
  const CLASSIFY: ReadonlyArray<readonly [string, RegExp]> = [
    ['a model value on the left of a comparison or membership test',
      /\bmodels?\b['"\]]?\s*(?:==|!=|<>|<=|>=|<|>|=|\bnot\s+in\b|\bin\b|\bis\b|\blike\b|\bglob\b|\bbetween\b)/i],
    ['a model value on the right of a comparison or membership test', /(?:==|!=|<>|\bin|\blike|\bglob)\s*\(?\s*(?:\w+[.[])?['"]?models?\b/i],
    ['a K binding', /^\s*K\s*=/m],
  ];
  it('O32 narrowed, CONTROL: each pattern catches the shape it bans, the 7d01973a2 K line among them', () => {
    const samples = [
      "K = 10   # the window: the first K assistant entries after a main boundary's summary row (ruled Q14)",
      'if model not in seen:', "if row['model'] == wanted:", "WHERE e.model = ? AND e.model LIKE 'x%'", 'if wanted in models:',
      'if model is None:',
    ];
    for (const [why, re] of CLASSIFY) expect(samples.some((s) => re.test(s)), why).toBe(true);
    expect(CLASSIFY[2]![1].test(samples[0]!)).toBe(true);
  });
  it('O32 narrowed: no comparison or membership test is applied to a model value, and no K is bound, in measure-history.py', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    for (const [why, re] of CLASSIFY) expect(src.match(re)?.[0] ?? null, `measure-history.py carries ${why}`).toBeNull();
  });

  // The no-blob pin (W2-D13): the census never reads a body, so it never selects blobs.z and loads no codec.
  const BLOB_READ: ReadonlyArray<readonly [string, RegExp]> = [
    ['a select of blobs.z', /\bz\s+FROM\s+blobs\b|\bblobs\.z\b|\bSELECT\s+z\b/i],
    ['a compression import', /^[ \t]*(?:import|from)[ \t][^\n]*\b(?:zlib|gzip|bz2|lzma|brotli|zstandard|zstd)\b/m],
  ];
  it('the no-blob pin, CONTROL: a planted SELECT z FROM blobs line and each compression import go red', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(BLOB_READ[0]![1].test(`${src}\n    db.execute('SELECT z FROM blobs WHERE blob_id = ?', (1,))\n`)).toBe(true);
    for (const mod of ['zlib', 'gzip', 'bz2', 'lzma', 'brotli', 'zstandard']) {
      expect(BLOB_READ[1]![1].test(`${src}\nimport ${mod}\n`), mod).toBe(true);
    }
    expect(BLOB_READ[1]![1].test('import argparse, hashlib, json, zlib, os'), 'one more name on the import line').toBe(true);
  });
  it('the no-blob pin: measure-history.py selects no blobs.z and imports no compression module', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    for (const [why, re] of BLOB_READ) expect(src.match(re)?.[0] ?? null, `measure-history.py carries ${why}`).toBeNull();
  });

  // The PK-probe pin (W2-D13): a copy is found by ingest_files of the boundary's transcript, then the memberships
  // primary key (file_id, entry_id); never by a scan of memberships keyed on entry_id alone.
  const ENTRY_SCAN = /FROM\s+memberships\b[\s\S]{0,200}?\bWHERE\s+(?:\w+\.)?entry_id\s*(?:=|\bIN\b)/i;
  it('the PK-probe pin, CONTROL: the pattern matches the 7d01973a2 copy query', () => {
    expect(ENTRY_SCAN.test("'FROM memberships m WHERE m.entry_id = ? ORDER BY after DESC, m.file_id LIMIT 1',")).toBe(true);
    expect(ENTRY_SCAN.test("'SELECT m.file_id FROM memberships m JOIN ingest_files f ON f.file_id = m.file_id '\n            'WHERE m.entry_id = ?'"), 'a join between').toBe(true);
  });
  it('the PK-probe pin: no memberships query is keyed on entry_id alone, and the two probes are the ones the script runs', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src.match(ENTRY_SCAN)?.[0] ?? null).toBeNull();
    expect(src).toContain("'SELECT file_id, source_key FROM ingest_files WHERE transcript_pk = ? ORDER BY file_id'");
    expect(src).toContain("'SELECT 1 FROM memberships WHERE file_id = ? AND entry_id = ?'");
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 1|W2 raw rows|leaves the store|a missing store exits 2|W1-e sits between')
```

The filter selects 18 cases: the 14 appended ones and the 4 edited in place. Expected red (measured against the `7d01973a2` script): `14 failed | 4 passed | 13 skipped (31)`. The four that pass are the three CONTROLs and the no-blob pin; the base script reads no blob either, and mutant M14 bites that pin in Step 6.
- The O52 raw-row case, the bytes-unchanged case and the six appended cases that pass `--row-cap` fail with `AssertionError: usage: measure-history.py [-h] [--db DB] [--now NOW] [--families FAMILIES]`, because argparse does not know `--row-cap`.
- The missing-input case and the `--row-cap` refusal case fail with `expected +0 to be 2`: the base script never asks for `--row-cap`.
- The key-order case fails with `expected [ 'store_id', 'user_version', …(6) ] to deeply equal [ 'store_id', 'user_version', …(7) ]`.
- The self-hash case fails with `expected undefined to be '<the sha>'`.
- The no-classification pin fails with `measure-history.py carries a model value on the left of a comparison or membership test: expected 'model is' to be null`. That is the W1-e docstring's prose; the base's `K = 10` line would trip the K pattern next.
- The PK-probe pin fails with `expected 'FROM memberships m WHERE m.entry_id =' to be null`.

- [ ] **Step 4: Write the raw emission.** In `deploy/measure-history.py`:

(a) Replace the whole module docstring, from the line `"""measure-history.py: the ccrc history census (spec 2026-10-05 §10.2, §10.7), READ-ONLY.` through its closing `"""`, with:

```python
"""measure-history.py: the ccrc history census (spec 2026-10-05 §10.2, §10.7), READ-ONLY.

Run by hand on a session-hosting node. It reads one thing, that node's history store, and writes nothing:
the database is opened `mode=ro`, and a missing store is refused rather than created. One side effect is
SQLite's, not this script's: opening a WAL database that no process holds open may create its `-shm` and
`-wal` files, owned by whoever runs this, so run it as the store's own user, never under `sudo`.

    python3 deploy/measure-history.py [--db PATH] [--now MS]
                                      [--families FILE --window-start MS --window-end MS --row-cap N]

It prints ONE JSON object, headed by the store's own id. Outputs of several nodes are concatenated, never
merged: two nodes' families with one ccrc id are two families (spec §6.9).

  store_id, user_version  the store measured: meta.store_id and PRAGMA user_version
  script_sha256           the sha256 of this file's own bytes (read through realpath), so a record that pins
                          the instrument's hash can tell which build measured (W2-D13, W2-D24)
  counters                every `counters` row, name -> n, exactly as the sweep folded it. A name carrying
                          `:<backend>` was folded by the sweep through lib.mjs's backendOf; this script reads
                          the word and never derives one, so the backend rule is spelled once (pin O32: no
                          model-name test lives in this file). W1-i's and W1-j's counters are rows here.
  w1b_lag_p95_ms          W1-b: the p95 of ticks.lag_ms over the 7 days up to --now, counting only ticks with
                          files_behind = 0 and a measured lag (outside backfill and catch-up); null if none.
                          Both filters lean on rules the sweep keeps when it writes a ticks row: lag_ms is NULL
                          for a tick whose new rows all came from first reads or rescans (discovery, not
                          capture lag), and files_behind counts no gone or pathless row and no stale torn tail
  w1c_duplicate_entries   W1-c: uuids holding more than one entries row; 0 by the UNIQUE, reported anyway
                          because the acceptance row is this number
  w1e                     W1-e: the card line's delivery, from the counters the sweep folds (it measures
                          delivery from each compaction's transcript, never from a receipt):
                          consumed_main, consumed_other and consumed_unknown are card_consumed:<scope>
                          (a prediction a later main boundary consumed, by the scope marker its
                          compaction left); served and mismatch are card_served:* and card_id_mismatch:*
                          summed over their backend words; served_share = served / (consumed_main +
                          consumed_unknown) (target >= 0.95), other reported beside it and out of the
                          denominator, and mismatch_share = mismatch / (served + mismatch) (target
                          <= 0.02), each null, never 0, when its denominator is 0. A reading whose
                          window holds a restore or rebuild is void; a served_share above 1 is its tell
  w1f_grep_p95_ms         W1-f: the p95 of recall_calls.ms over verb = 'grep' rows with arm IS NULL; null if none
  w2                      null without --families; else {row_cap, window_start_ms, window_end_ms, families},
                          the W2 raw rows, below; the two window fields echo --window-start and --window-end
p95 is NEAREST-RANK: the value at 1-based rank ceil(95n/100) of the sorted sample, in integer arithmetic.

THE W2 RAW ROWS (§10.2; W2-D13, D-5770). This file emits rows and decides nothing about a window: the turn
rule, the window's length and end, the copy a window reads, the producer and every statistic are built in
Node by deploy/history-gate.mjs from what is printed here (W2-D14, W2-D15, W2-D16). --families names a JSON
array of {store_id, ccrc_id, generation}: the pre-registered list. A row naming another store is skipped (it
is another node's). --row-cap is required with --families and has no default. w2 echoes the window it was run
over, so the gate can refuse reports measured over different windows (W2-D22). For each listed family:
  ccrc_id, generation  as listed
  found                false when the store holds no sessions row for it; its lists are then empty
  merged_generations   the generations of the '' rows a re-key merged into it (sessions.merged_into, §6.1)
  calls                [ts_ms, rc, verb] for every recall_calls row of its own and its merged generations with
                       arm IS NULL and ts_ms >= --window-start, ordered by ts_ms then event_key. Every
                       recall_calls row is a read verb's: the sweep writes one only for an ev:"recall" spool
                       line, and only a read verb writes one (spec §8.1). arm IS NULL keeps a replay arm's
                       calls out of every live output, here and in W1-f (W2-D13)
  boundaries           its main boundaries: compact-boundary entries of a transcript whose agent_id is '', in
                       one of its confirmed epochs, with ts_ms inside [--window-start, --window-end), ordered
                       by ts_ms then entry_id, each {boundary_uuid, ts_ms, copies}
A copy is one ingest file of the boundary's transcript that holds the boundary row, found by primary-key
probes (the transcript's ingest_files, then memberships by (file_id, entry_id)), listed by file_id:
  file_id, source_key  the ingest file ('' is a live copy)
  boundary_line        the boundary row's line in it
  after_count          the membership rows after that line, uncapped
  summary_line         the first is_compact_summary row after the boundary, or null
  next_boundary_line   the next boundary row after the boundary in this file, and its ts_ms; null when none
  next_boundary_ts_ms
  last_ts_ms           the ts_ms of the file's last timed row, or null when it has none
  rows                 [line, ts_ms, msg_id, request_id, uuid, model] for each assistant entry after the
                       summary row (after the boundary when there is none) and before the next boundary, in
                       line order, at most --row-cap of them
  truncated            true when the cap cut rows
  models               the distinct values of entries.model over EVERY assistant entry after the summary row
                       (or the boundary) to the end of the file, uncapped and not stopped at the next
                       boundary, ordered by first appearance: the witnesses lib.mjs's producerOfCopy reads
The model text is printed raw: this file never tests, compares or classifies it (O32 narrowed, D-5772).

Exit 0 measured; 2 an input missing or unreadable, or a usage error.
"""
```

(b) Replace the import line

```python
import argparse, json, os, sqlite3, sys, time, urllib.parse
```

with

```python
import argparse, hashlib, json, os, sqlite3, sys, time, urllib.parse
```

(c) Delete the one line

```python
K = 10   # the window: the first K assistant entries after a main boundary's summary row (ruled Q14)
```

(d) Replace everything from `def family_scope(db, ccrc_id, generation):` up to (not including) the two blank lines before `def w1e_statistic(counters):`, that is `family_scope`, `family_windows` and `w2_statistic`, with:

```python
def family_scope(db, ccrc_id, generation):
    """The family's session rows, and the generations its recall lines carry: its own row, plus a '' row a
    re-key merged into it."""
    row = db.execute('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?',
                     (ccrc_id, generation)).fetchone()
    if row is None:
        return [], []
    pks, gens = [row[0]], [generation]
    for pk, gen in db.execute('SELECT session_pk, generation FROM sessions WHERE ccrc_id = ? AND merged_into = ? '
                              'ORDER BY session_pk', (ccrc_id, row[0])).fetchall():
        pks.append(pk)
        gens.append(gen)
    return pks, gens


def script_sha256():
    """The sha256 of this file's own bytes, read through realpath (W2-D13): the hash the open record's gate_code
    pins for deploy/measure-history.py (W2-D24)."""
    with open(os.path.realpath(__file__), 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def copy_record(db, file_id, source_key, boundary_entry_id, row_cap):
    """One copy of a boundary: the raw rows Node's window and producer read (W2-D13). Every query is keyed on
    this file's memberships by line (memberships_order) or by its primary key; none reads a body."""
    line = db.execute('SELECT line FROM memberships WHERE file_id = ? AND entry_id = ?',
                      (file_id, boundary_entry_id)).fetchone()[0]
    after_count = db.execute('SELECT count(*) FROM memberships WHERE file_id = ? AND line > ?',
                             (file_id, line)).fetchone()[0]
    summary = db.execute(
        'SELECT m.line FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
        'WHERE m.file_id = ? AND m.line > ? AND e.is_compact_summary = 1 ORDER BY m.line LIMIT 1',
        (file_id, line)).fetchone()
    summary_line = summary[0] if summary is not None else None
    nxt = db.execute(
        'SELECT m.line, e.ts_ms FROM memberships m JOIN boundaries b ON b.entry_id = m.entry_id '
        'JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? AND m.line > ? ORDER BY m.line LIMIT 1',
        (file_id, line)).fetchone()
    next_line, next_ts = (nxt[0], nxt[1]) if nxt is not None else (None, None)
    last = db.execute(
        'SELECT e.ts_ms FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
        'WHERE m.file_id = ? AND e.ts_ms IS NOT NULL ORDER BY m.line DESC LIMIT 1',
        (file_id,)).fetchone()
    opens = summary_line if summary_line is not None else line
    rows = [list(r) for r in db.execute(
        'SELECT m.line, e.ts_ms, e.msg_id, e.request_id, e.uuid, e.model '
        'FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
        "WHERE m.file_id = ? AND m.line > ? AND (? IS NULL OR m.line < ?) AND e.type = 'assistant' "
        'ORDER BY m.line LIMIT ?',
        (file_id, opens, next_line, next_line, row_cap + 1)).fetchall()]
    witnesses = [r[0] for r in db.execute(
        'SELECT e.model FROM memberships m JOIN entries e ON e.entry_id = m.entry_id '
        "WHERE m.file_id = ? AND m.line > ? AND e.type = 'assistant' "
        'GROUP BY e.model ORDER BY min(m.line)',
        (file_id, opens)).fetchall()]
    return {'file_id': file_id, 'source_key': source_key, 'boundary_line': line, 'after_count': after_count,
            'summary_line': summary_line, 'next_boundary_line': next_line, 'next_boundary_ts_ms': next_ts,
            'last_ts_ms': last[0] if last is not None else None,
            'rows': rows[:row_cap], 'models': witnesses, 'truncated': len(rows) > row_cap}


def boundary_copies(db, entry_id, transcript_pk, row_cap):
    """Every copy holding one boundary, by file_id: the transcript's ingest files, each probed by the memberships
    primary key (file_id, entry_id). Never a scan of memberships by entry_id (W2-D13)."""
    out = []
    for file_id, source_key in db.execute(
            'SELECT file_id, source_key FROM ingest_files WHERE transcript_pk = ? ORDER BY file_id',
            (transcript_pk,)).fetchall():
        held = db.execute('SELECT 1 FROM memberships WHERE file_id = ? AND entry_id = ?',
                          (file_id, entry_id)).fetchone()
        if held is not None:
            out.append(copy_record(db, file_id, source_key, entry_id, row_cap))
    return out


def family_report(db, ccrc_id, generation, start_ms, end_ms, row_cap):
    """One listed family's raw rows (W2-D13). A family the store does not hold is found: false with empty
    lists, never an empty list in its place."""
    pks, gens = family_scope(db, ccrc_id, generation)
    if not pks:
        return {'ccrc_id': ccrc_id, 'generation': generation, 'found': False, 'merged_generations': [],
                'calls': [], 'boundaries': []}
    calls = [list(r) for r in db.execute(
        f'SELECT ts_ms, rc, verb FROM recall_calls WHERE ccrc_id = ? AND generation IN ({marks(len(gens))}) '
        'AND arm IS NULL AND ts_ms >= ? ORDER BY ts_ms, event_key',
        (ccrc_id, *gens, start_ms)).fetchall()]
    bounds = db.execute(
        'SELECT DISTINCT b.entry_id, b.transcript_pk, e.uuid, e.ts_ms FROM boundaries b '
        'JOIN entries e ON e.entry_id = b.entry_id '
        "JOIN transcripts t ON t.transcript_pk = b.transcript_pk AND t.agent_id = '' "
        'JOIN epochs p ON p.cc_session_uuid = t.cc_session_uuid AND p.confirmed_ms IS NOT NULL '
        f'WHERE p.session_pk IN ({marks(len(pks))}) AND e.ts_ms >= ? AND e.ts_ms < ? '
        'ORDER BY e.ts_ms, b.entry_id',
        (*pks, start_ms, end_ms)).fetchall()
    return {'ccrc_id': ccrc_id, 'generation': generation, 'found': True, 'merged_generations': gens[1:],
            'calls': calls,
            'boundaries': [{'boundary_uuid': uuid, 'ts_ms': ts, 'copies': boundary_copies(db, entry_id, tpk, row_cap)}
                           for entry_id, tpk, uuid, ts in bounds]}
```

(e) In `w1e_statistic`'s docstring, replace the words `so no model is classified` with `so no model name is classified` (one occurrence; the line stays otherwise as it is).

(f) In `main`, replace

```python
    ap.add_argument('--window-end', type=int, default=None)
    a = ap.parse_args()
    if a.families is not None and (a.window_start is None or a.window_end is None):
        fail('--families needs --window-start and --window-end (epoch ms)')
```

with

```python
    ap.add_argument('--window-end', type=int, default=None)
    ap.add_argument('--row-cap', type=int, default=None, help='the most assistant rows printed per copy; required with --families')
    a = ap.parse_args()
    if a.families is not None and (a.window_start is None or a.window_end is None):
        fail('--families needs --window-start and --window-end (epoch ms)')
    if a.families is not None and a.row_cap is None:
        fail('--families needs --row-cap')
    if a.row_cap is not None and a.row_cap < 1:
        fail('--row-cap must be a positive integer')
```

then, in the report literal, directly after the line `            'user_version': db.execute('PRAGMA user_version').fetchone()[0],`, insert

```python
            'script_sha256': script_sha256(),
```

and replace

```python
            report['w2'] = w2_statistic(db, load_families(a.families, store_id), a.window_start, a.window_end)
```

with

```python
            report['w2'] = {'row_cap': a.row_cap, 'window_start_ms': a.window_start, 'window_end_ms': a.window_end, 'families': [
                family_report(db, ccrc_id, generation, a.window_start, a.window_end, a.row_cap)
                for ccrc_id, generation in load_families(a.families, store_id)]}
```

The two window fields echo the flags (W2-D13, amended 2026-10-19); `assembleReports` (Task 5) refuses a report whose echoed window is not the record's `window`.

Check (measured): `grep -c '^K = \|^def family_windows(\|^def w2_statistic(' deploy/measure-history.py` prints 0, and `grep -c 'zlib\|gzip\|bz2\|lzma\|brotli\|zstandard' deploy/measure-history.py` prints 0.

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit 2>&1 | grep 'measure-history' ; echo "lines naming measure-history: $?")
```

Expected (measured on a copy of `7d01973a2` with this task applied):
- `31 passed (31)`: the base's 17 and this task's 14, in about 9 s;
- the typecheck prints `lines naming measure-history: 1` (grep found none). A line that names only `agent/src/`, `.github/ci/` or a module that is not installed comes from the worktree's install, not this task. A line naming `measure-history.test.ts` is this task's.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs one filter and shows it red, then restores the script with `cp`. The python body is a quoted heredoc. Every mutant below but M16 was measured red with this exact text; M16, added with the window echo (W2-D13, amended 2026-10-19), is predicted.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-3/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
P=deploy/measure-history.py
cp "$P" "$SCRATCH/measure-history.orig"
t1() { (cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t "$1"); cp "$SCRATCH/measure-history.orig" "$P"; }

# M1: the arm filter dropped from calls.
mut "$P" "'AND arm IS NULL AND ts_ms >= ? ORDER BY ts_ms, event_key'," "'AND ts_ms >= ? ORDER BY ts_ms, event_key',"
t1 'the arm pin'

# M2: the merged '' rows dropped from the family's scope.
mut "$P" "    pks, gens = family_scope(db, ccrc_id, generation)
    if not pks:" "    pks, gens = [x[:1] for x in family_scope(db, ccrc_id, generation)]
    if not pks:"
t1 'merged_generations holds'

# M3: a missing family left out of the list (the shape W1 reported as an empty list).
mut "$P" "                for ccrc_id, generation in load_families(a.families, store_id)]}" "                for ccrc_id, generation in load_families(a.families, store_id) if family_scope(db, ccrc_id, generation)[0]]}"
t1 'found: false with empty lists'

# M4: models capped at --row-cap.
mut "$P" "        'GROUP BY e.model ORDER BY min(m.line)',
        (file_id, opens)).fetchall()]" "        'GROUP BY e.model ORDER BY min(m.line) LIMIT ?',
        (file_id, opens, row_cap)).fetchall()]"
t1 'truncated: at --row-cap 3'

# M5: models stopped at the next boundary.
mut "$P" "        \"WHERE m.file_id = ? AND m.line > ? AND e.type = 'assistant' \"
        'GROUP BY" "        \"WHERE m.file_id = ? AND m.line > ? AND (? IS NULL OR m.line < ?) AND e.type = 'assistant' \"
        'GROUP BY"
mut "$P" "(file_id, opens)).fetchall()]
    return" "(file_id, opens, next_line, next_line)).fetchall()]
    return"
t1 'past the next boundary'

# M6: models not made distinct.
mut "$P" "        'GROUP BY e.model ORDER BY min(m.line)'," "        'ORDER BY m.line',"
t1 'past the next boundary'

# M7: truncated set when the rows exactly fill the cap.
mut "$P" "'truncated': len(rows) > row_cap}" "'truncated': len(rows) >= row_cap}"
t1 'truncated: at --row-cap 3'

# M8: rows not cut to the cap.
mut "$P" "'rows': rows[:row_cap]," "'rows': rows,"
t1 'truncated: at --row-cap 3'

# M9: rows not stopped at the next boundary.
mut "$P" "AND (? IS NULL OR m.line < ?) AND e.type = 'assistant' \"
        'ORDER BY m.line LIMIT ?'," "AND (? IS NULL OR ? IS NOT NULL) AND e.type = 'assistant' \"
        'ORDER BY m.line LIMIT ?',"
t1 'W2 raw rows'

# M10: the self-hash taken over the path, not the bytes.
mut "$P" "        return hashlib.sha256(f.read()).hexdigest()" "        return hashlib.sha256(os.path.realpath(__file__).encode()).hexdigest()"
t1 'script_sha256 is the sha256'

# M11: --row-cap no longer required with --families.
mut "$P" "    if a.families is not None and a.row_cap is None:
        fail('--families needs --row-cap')
" ""
t1 'without --row-cap exits 2'

# M12: a --row-cap below 1 accepted.
mut "$P" "    if a.row_cap is not None and a.row_cap < 1:
        fail('--row-cap must be a positive integer')
" ""
t1 'a --row-cap below 1 exits 2'

# M13: copies found by a scan of memberships on entry_id (the 7d01973a2 shape, joined).
mut "$P" "    for file_id, source_key in db.execute(
            'SELECT file_id, source_key FROM ingest_files WHERE transcript_pk = ? ORDER BY file_id',
            (transcript_pk,)).fetchall():
        held = db.execute('SELECT 1 FROM memberships WHERE file_id = ? AND entry_id = ?',
                          (file_id, entry_id)).fetchone()
        if held is not None:" "    for file_id, source_key in db.execute(
            'SELECT m.file_id, f.source_key FROM memberships m JOIN ingest_files f ON f.file_id = m.file_id '
            'WHERE m.entry_id = ? ORDER BY m.file_id', (entry_id,)).fetchall():
        if transcript_pk is not None:"
t1 'PK-probe pin'

# M14a: a blob body selected.
mut "$P" "    return {'file_id': file_id, 'source_key': source_key, 'boundary_line'" "    db.execute('SELECT z FROM blobs LIMIT 1')
    return {'file_id': file_id, 'source_key': source_key, 'boundary_line'"
t1 'the no-blob pin: measure'

# M14b: a compression module imported.
mut "$P" "import argparse, hashlib, json, os, sqlite3, sys, time, urllib.parse" "import argparse, hashlib, json, os, sqlite3, sys, time, urllib.parse, zlib"
t1 'the no-blob pin: measure'

# M15a: K bound in Python again.
mut "$P" "WEEK_MS = 7 * 86_400_000
" "WEEK_MS = 7 * 86_400_000
K = 10
"
t1 'O32 narrowed: no comparison'

# M15b: a model value tested in SQL (null-model rows dropped, which W2-D17 forbids).
mut "$P" "AND (? IS NULL OR m.line < ?) AND e.type = 'assistant' \"" "AND (? IS NULL OR m.line < ?) AND e.type = 'assistant' AND e.model IS NOT NULL \""
t1 'O32 narrowed: no comparison'

# M16: the window echo dropped from w2 (W2-D13, amended), so assembleReports could not compare a report's window with the record's.
mut "$P" "'window_start_ms': a.window_start, 'window_end_ms': a.window_end, " ""
t1 'W2 raw rows'

cmp "$SCRATCH/measure-history.orig" "$P" && git diff --stat -- deploy/measure-history.py
```

Expected, each RED (all measured):
- M1: `expected [ 1999, 2500, 2600, 3900, 3950, 5200 ] to deeply equal [ 1999, 2500, 3900, 3950, 5200 ]`. The replay arm's call k5 leaks into `calls` (W2-D13's arm pin).
- M2: `expected [] to deeply equal [ '' ]`.
- M3: `expected [ [ 'demo-a', true ] ] to deeply equal [ [ 'demo-a', true ], …(1) ]`.
- M4: `expected [ 'model-a', '<synthetic>', null ] to deeply equal [ Array(5) ]`.
- M5: `expected [ Array(4) ] to deeply equal [ Array(5) ]`: model-c, past the next boundary, is lost.
- M6: `expected [ 'model-a', 'model-a', …(14) ] to deeply equal [ Array(5) ]`.
- M7: `expected true to be false`: B2's three rows exactly fill the cap.
- M8: `expected [ 5, 6, 7, 8 ] to deeply equal [ 5, 6, 7 ]`.
- M9: `expected { Object (row_cap, window_start_ms, …) } to deeply equal { Object (row_cap, window_start_ms, …) }`: B1's f1 rows run on to lines 19..21 and 25 (measured before the window echo, as `{ Object (row_cap, families) }`; the key list printed is predicted).
- M10: `expected '<sha of the path>' to be '<sha of the bytes>'`.
- M11: `2 failed`, each `expected 1 to be 2`: `row_cap + 1` raises a TypeError, so Python exits 1, not the usage exit.
- M12: `expected +0 to be 2`.
- M13: `1 failed | 1 passed`, `expected 'FROM memberships m JOIN ingest_files …' to be null`. The CONTROL passes.
- M14a: `measure-history.py carries a select of blobs.z: expected 'SELECT z' to be null`.
- M14b: `measure-history.py carries a compression import: expected 'import argparse, hashlib, json, os, s…' to be null`.
- M15a: `measure-history.py carries a K binding: expected 'K =' to be null`.
- M15b: `measure-history.py carries a model value on the left of a comparison or membership test: expected 'model IS' to be null`.
- M16 (predicted): `expected { Object (row_cap, families) } to deeply equal { Object (row_cap, window_start_ms, …) }`: the raw-row case's `w2` lacks `window_start_ms` and `window_end_ms`.

Then run Step 5's commands once more: green, `31 passed (31)`.

- [ ] **Step 7: Check the edit's reach.** From the repository root:

```bash
git diff --stat
git diff -- deploy/measure-history.py | grep -n '^+.*\(claude\|startswith\|<synthetic>\)' ; echo "O32 literals added: $?"
```

Expected (predicted: the scratch copy the plan was measured in is not a git checkout; O32's existing literal scan, green in Step 5, measures the same thing):
- `git diff --stat` names exactly `deploy/measure-history.py` and `server/test/measure-history.test.ts`;
- `O32 literals added: 1`, meaning no added line spells one of O32's banned literals;
- no hostname, account, lane, home path or family id in either file. The fixture ids are the planted `demo-*` and `model-*` stand-ins.

- [ ] **Step 8: Commit.**

```bash
git add deploy/measure-history.py server/test/measure-history.test.ts
git commit -m "feat(history): measure-history.py prints raw W2 window rows and its own sha256; the window statistic leaves Python (W2-3 Task 1, D-5770, D-5772)"
```

D-5770 and D-5772 are defined in this plan's "Deviations found", the entries this commit cites. The PR body names the change to W1's O52 pin: the raw-row half is pinned here, and the totals in Task 3.

### Task 2: history-gate.mjs: a pure module, its constants and its closed word sets

This task creates `deploy/history-gate.mjs` with its header, its import block, every constant and closed word set the later tasks read, and `familyKey`. Each is frozen once here and pinned once in measure-history.test.ts. The module is pure (W2-D11). It imports `node:crypto` and `../ccd/history/lib.mjs` only. It has no fs, no child_process, no environment read, no clock and no random source. `history-replay.mjs` (W2-4 to W2-5b) and `history-counters.mjs` (W2-6) will import it, and every scoring decision lives in it (W2-D24). Its words are its own (W2-D12): none is declared in lib.mjs, and the gate declares no name lib exports. That is a departure from spec §13:3051 (**D-5774**). `FACT_KINDS` omits decisions, a departure from spec §10.2:2638 (**D-5775**). The file never spells the two small model class words, not even in a comment: single-definition.test.ts's class-enumeration scan walks `deploy/` and would count it as a holder.

**Files:**
- Create: `deploy/history-gate.mjs` (178 lines at the end of this task, counted from Step 4's block after the 2026-10-19 edit that added four `GATE_REASONS` words; the fifth, `code-unmeasured`, and the sixth, `flag-rejected` (the final plan review's ruling), join existing lines and add none, so 178 is predicted unchanged).
- Modify: `server/test/measure-history.test.ts`. One describe is appended at the END of the file, after Task 1's `'W2-3 Task 1: raw window rows'` describe. No import line is added. The describe uses the file's existing `readFileSync`, `readdirSync` and `path` imports and its module constants `ROOT`, `OTHER_STORE` and `G1` (`:18`, `:49`, `:45` at `7d01973a2`). It loads the gate and lib through dynamic `import()` inside its cases, so the head of the file (which Task 1 also edits) is untouched.
- Not edited:
  - `server/test/single-definition.test.ts`: it is only run. Its O14 `DECL_CORPUS` (`:5243`) and its four-class `enumerates` scan (`:1885-1898`) already walk `deploy/`, and both stay green unedited.
  - `ccd/history/lib.mjs`: the gate imports from it and adds nothing.
  - `server/test/collectLaneFixture.ts`: its `LABELS` (`:58`) is a different vocabulary, named in the W2-D12 pin below.

**Interfaces:**
- Consumes (base, `ccd/history/lib.mjs` at `7d01973a2`): `EXIT` (`:28`), `UUID_RE` (`:243`), `canonicalJson` (`:454`), `sha256Hex` (`:527`), `producerOf` (`:1530`), `pickHoldingCopy` (`:6702`). Only `canonicalJson` is called in this task. The other five are imported now so the import block is final, and they are first used by Task 3 (`EXIT`, `producerOf`, `pickHoldingCopy`), Task 4 (`UUID_RE`) and Task 6 (`sha256Hex`). Every imported name is used by the end of the PR, which is the head CodeQL reads.
- Consumes (test only): single-definition.test.ts's O14 `declares` regex (`:5244`) and four-class `enumerates` regex (`:1885-1887`). Both are restated in the new describe, which reads them and edits nothing.
- Produces (`deploy/history-gate.mjs`). Every export carries a JSDoc type. A word set's element type is a `@typedef` beside it, and later tasks reference that typedef and never declare it again:

| Export | Value | Typedef | Read by |
|---|---|---|---|
| `K` | `10` | — | Tasks 3, 9 |
| `K_UNIT` | `'assistant-turns'` | — | Task 9 |
| `X` | `{num: 1, den: 10}`, frozen | — | Tasks 6, 8, 9 |
| `METRIC_TEXT` | the ruled metric text | — | Task 9 (the record's `metric`) |
| `ROW_CAP` | `400` (plan-chosen) | — | Tasks 5, 9 |
| `BOOTSTRAP` | `{B: 10000, ci: 95, method: 'percentile', percentile: 'nearest-rank', statistic: 'pooled', prng: 'xoshiro128**'}`, frozen | — | Tasks 6, 9 |
| `SUBSTREAMS` | `['quiz-ci','live-ci','q18','handcheck','quiz-sample','judge-order']` | `Substream` | Task 6 |
| `PILOT_SUBSTREAM` | `'pilot-sample'` | — | Task 6 |
| `ASSIGN_LABEL` | `'assign'` | — | Task 6 |
| `WINDOW_STATES` | `['measured','unmeasured']` | `WindowState` | Task 3 |
| `ASSIGNMENT_ARMS` | `['treatment','control']` | `Arm` | Tasks 6, 8 |
| `ACTIVE_EXCLUSIONS` | `['merged','legacy','not-newest','no-recent-entry']` | `ActiveExclusion` | Task 4 |
| `FACT_KINDS` | `['sha','path','command','error']` | `FactKind` | Tasks 7, 9 |
| `LABELS` | `['correct','uncertain','fabricated']` | `Label` | Tasks 7, 8 |
| `RUBRIC_IDS` | `['v1','v1-strict']` | `RubricId` | Tasks 7, 9 |
| `WRITER_INPUTS` | `['excerpt','leaf-span']` | `WriterInput` | Tasks 7, 9 |
| `SHA_MIN_PREFIXES` | `[7, 40]` | `ShaMinPrefix` | Tasks 7, 9 |
| `ANSWER_STATES` | `['value','unknown','absent']` | `AnswerState` | Tasks 7, 8 |
| `RUN_CLASSES` | `['answered','infra-failed','not-run']` | `RunClass` | Task 8 |
| `QUESTION_OUTCOMES` | `['answered','rerun','run-failed','not-run']` | `QuestionOutcome` | Task 8 |
| `VERDICTS` | `['pass','fail','halt','incomplete']` | `Verdict` | Task 8 |
| `HALT_WORDS` | `['absent-rate','run-failed','handcheck-agreement','empty-arm']` | `HaltWord` | Task 8 |
| `AMENDMENT_KINDS` | `['version-move','freeze-exception','forced-act']` | `AmendmentKind` | Task 9 |
| `GATE_CODE_FILES` | `['deploy/history-gate.mjs','deploy/measure-history.py','deploy/history-replay.mjs','ccd/history/lib.mjs']` | — | Task 9 |
| `GATE_REASONS` | the 34 words below (predicted count: 28 measured, plus `window-mismatch`, `question-not-run`, `field-unknown`, `amendment-detail-mismatch`, `code-unmeasured` and `flag-rejected` from the 2026-10-19 amendments) | `GateReason` | Tasks 5, 7, 8, 9 |
| `familyKey(storeId: string, ccrcId: string, generation: string): string` | `canonicalJson([storeId, ccrcId, generation])` | — | Tasks 4, 5, 6, 9 |

  Every word set is `Object.freeze`d, and so are `X` and `BOOTSTRAP`. The table is exactly the union of what Tasks 3 to 9 read (coordinator ruling): each set's words are the decisions document's where it names them, otherwise the consuming task's. No later task reads a list of the comparison drops (Task 8's `comparison.dropped` lists family keys, not words), so none is declared here; a later PR that needs one adds it to this module (accepted by the coordinator, 2026-10-19: W2-5b adds report words if its report needs them).

  `GATE_REASONS` is the one list of refusal words the gate answers, and no other module declares it (W2-D12). Three of its spellings, `code-changed`, `code-unmeasured` and `assignment-mismatch`, are also words of W2-4's `DRIVER_REASONS` in `deploy/history-replay.mjs`; the coordinator accepted the shared spelling (2026-10-19): each module declares its own list, and neither imports the other's. Each refusal maps to one word; the validator's words are Task 9's, which refuses with them:

| Who refuses | Condition | Word |
|---|---|---|
| assembleReports (W2-D22) | null store_id | `store-id-null` |
| | duplicate store_id | `store-id-duplicate` |
| | store_id outside the record's nodes | `store-id-unlisted` |
| | family outside the assignment | `family-unassigned` |
| | row_cap ≠ `ROW_CAP` | `row-cap-mismatch` |
| | a report whose echoed `window_start_ms`/`window_end_ms` is not the record's `window` (part 2's `start_ms`/`end_ms`), a report that echoes none, or a record that carries none (W2-D13, W2-D22, amended) | `window-mismatch` |
| assembleReports and checkGateCode (W2-D24) | a script or code sha, measured on both sides, ≠ `gate_code`'s | `code-changed` |
| | a script or code sha absent on either side (W2-D24 and W2-D56, amended: unmeasured, never a change, and `allowCodeChange` never stamps it) | `code-unmeasured` |
| the writer (W2-D72) | malformed reply | `writer-malformed` |
| | question fails `admitFact` | `writer-leak` |
| decideGate (W2-D89, amended; Task 8) | a question still `not-run` at gate time; the refusal names the questions | `question-not-run` |
| validateOpenRecord (W2-D25, W2-D90; Task 9) | a missing field, a null where the schema allows none (a part 1 step 0a entry's `writer_init` or `judge_init` among them), or a validation context, or the part of it the record needs, not supplied | `field-missing` |
| | a field outside the schema (W2-D25, amended: closed) | `field-unknown` |
| | a field of the wrong type | `field-malformed` |
| | `kind`, `version`, `part`, `metric`, K, X, B and the bootstrap's other fixed fields, k_unit, row_cap, a fixed labeller field, `quiz.kinds` or `active_rule.legacy_excluded` ≠ the module's | `constant-mismatch` |
| | `sha_min_prefix`, `rubric_id`, `quiz.writer_input` or `counters_def.id` outside its set, or a part 1 step 0a entry whose `store_id` names no node of part 1 or whose `settings_mode` differs from part 1's top-level `settings_mode` (W2-D25, amended) | `value-outside-set` |
| | an alias-shaped model id | `model-alias` |
| | a Fable arm model, or a writer or judge model not Opus (the path names the role) | `model-forbidden` |
| | answer protocol, writer prompt, rubric or counters_def sha ≠ the module's | `signed-text-mismatch` |
| | step 0a or pilot code shas ≠ `gate_code` | `code-changed` (reused) |
| | step 0a or pilot release stamp ≠ `gate_code.release_tag` | `release-mismatch` |
| | a part 1 step 0a entry whose `flags_accepted` holds `false` for any flag, with no exception (W2-D25, amended; under spec §10.2's fallback, `--setting-sources` without user plus `disableAllHooks`, step 0a writes no `--restricted` key) | `flag-rejected` |
| | seed changed across a supersede | `seed-changed` |
| | the pilot's recorded settings ≠ part 1's | `pilot-drift` |
| | `quiz.families` ≠ the frozen file, or `n_families` or `n_questions` inconsistent | `quiz-mismatch` |
| | a quiz family on a (store_id, ccrc_id) holding a control family | `quiz-holds-control` |
| | pilot and quiz families overlap | `pilot-quiz-overlap` |
| | part 2's window outside [planned_days, planned_days + 1 d] | `window-length` |
| | the assignment or its sha does not re-derive from the seed | `assignment-mismatch` |
| | a final's part 1 field ≠ its draft's | `draft-mismatch` |
| | a `supersedes` other than the superseded record's `recordSha256` (W2-D25, amended: chained), a predecessor of the other part, or one that fails validation | `chain-mismatch` |
| | after window start, a change other than appended amendments | `post-start-change` |
| | an amendment kind ∉ `AMENDMENT_KINDS` | `amendment-kind` |
| | an amendment whose `detail_sha256` is not its `detail`'s sha256 (W2-D25, amended) | `amendment-detail-mismatch` |
| | a `version-move` with no re-pilot sha | `version-move-unpiloted` |

**Decisions:** W2-D11 (location and purity; the import list is lib-only and adds `UUID_RE` for W2-D20's (a)); W2-D12 (deploy-local vocabularies and the FACT_KINDS/LABELS declaration pin; **D-5774**); W2-D60 (FACT_KINDS; **D-5775**); W2-D14 (`K`, `K_UNIT`, `WINDOW_STATES`); W2-D18 (`BOOTSTRAP`, `SUBSTREAMS`, `PILOT_SUBSTREAM`); W2-D19 (`ASSIGN_LABEL`, `ASSIGNMENT_ARMS`, `familyKey`); W2-D20 (`ACTIVE_EXCLUSIONS`); W2-D22 and W2-D25 (the `GATE_REASONS` words, with their 2026-10-19 amendments: `window-mismatch`, `field-unknown`, `amendment-detail-mismatch`, `flag-rejected`); W2-D89 (`question-not-run`, amended); W2-D24 (`GATE_CODE_FILES`, and `code-unmeasured` from its 2026-10-19 amendment); W2-D63 (`SHA_MIN_PREFIXES`); W2-D64 (`ANSWER_STATES`); W2-D72 (`WRITER_INPUTS`); W2-D79 (`RUBRIC_IDS`); W2-D80 (`RUN_CLASSES`, `QUESTION_OUTCOMES`); W2-D89 (`VERDICTS`, `HALT_WORDS`, with the coordinator's `empty-arm` ruling); W2-D90 (`AMENDMENT_KINDS`). Cited, not defined here: D-5770 (the window in Node, whose unit `K_UNIT` names) and D-5781 (the pilot families, which Task 9's record schema carries).

**Choices this task makes:**
- **`ROW_CAP = 400` is plan-chosen** (accepted by the coordinator, 2026-10-19, as an open-record default the operator confirms at open; the header's P2). It allows an average of 36 rows per turn through turn K+1 = 11 (400 / 11). A window cut by the cap before turn 11 is `unmeasured` (W2-D14), and the count is reported (decisions §7). The record fixes the value, and `validateOpenRecord` refuses another.
- **The banned spellings are read over the whole text, comments and strings included.** No comment stripper is needed: a stripper that misreads a `/*` inside a string would hide code from the scan. The cost is that the gate's prose never spells them. JSDoc types are written inline, never as `import('…').T`, because that form is the dynamic-load spelling. The patterns are property-shaped (`process.` followed by an identifier character), so a sentence ending in "process." is not a hit (the CONTROL below).
- **The O14 local half reads module-scope declarations only** (column 0, `const`/`let`/`var`/`class`/`function`). A local inside a later task's function is not a module export, so it is not counted. Measured at `7d01973a2`: none of the 468 lib exports collides with a name any of this PR's nine tasks produces.
- **The W2-D12 pin names one other declarer instead of narrowing its corpus.** `server/test/collectLaneFixture.ts:58` declares `const LABELS: ReadonlySet<string> = new Set(Object.values(COLLECT_BOX_LABELS) …)`, the collect lane's box labels, at `7d01973a2`. Read literally, W2-D12's "a second file under `deploy/` or `server/test` declares … LABELS" is red at the base. That file is outside this PR's list, so the pin carries it as a named entry that is checked live: it reds when the file stops declaring `LABELS` or when the declaration stops reading `COLLECT_BOX_LABELS`. The coordinator accepted this named, live-checked exemption as written (2026-10-19), so the entry and M11 stay.
- **`backendOf` is not imported.** W2-D11 lists it, but `producerOf` calls it inside lib, and no gate function classifies a single model. The import block is the one the plan's shared names fix.
- **`HALT_WORDS` holds the halts only.** They are W2-D89's three, in Task 8's words, and `empty-arm`, the coordinator's ruling for a criterion 1 or criterion 3 treatment set with no cluster left (W2-D89, amended 2026-10-19). The hold has no word: it is the verdict `incomplete` (W2-D89), and Task 8's `halts` never lists it. Nor has the not-run refusal a halt word: it is `GATE_REASONS`' `question-not-run` (W2-D89, amended), answered instead of a verdict.


- [ ] **Step 1: Confirm the base.** From the repository root:

```bash
test ! -e deploy/history-gate.mjs && echo absent
grep -c "^export const EXIT = \|^export const UUID_RE = \|^export function canonicalJson(\|^export function pickHoldingCopy(\|^export function producerOf(\|^export function sha256Hex(" ccd/history/lib.mjs
grep -n "^const LABELS: ReadonlySet<string> = new Set(Object.values(COLLECT_BOX_LABELS)" server/test/collectLaneFixture.ts
grep -rlE "^\s*(export\s+)?(const|let|var)\s+(FACT_KINDS|LABELS)\b" deploy server/test
grep -c "^describe('W2-3 Task 1: raw window rows'" server/test/measure-history.test.ts
```

Expected:
- `absent`;
- `6`;
- `58:const LABELS: ReadonlySet<string> = new Set(Object.values(COLLECT_BOX_LABELS) as string[]);`;
- only `server/test/collectLaneFixture.ts`;
- `1`: Task 1's describe is the file's last. If it is `0`, Task 1 has not landed in this tree. Stop and report.

A different `LABELS` line, or a second file in the fourth listing, changes the named entry below. Stop and report it rather than widening the exemption.

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/measure-history.test.ts`, after Task 1's describe:

```ts
// ── W2-3 Task 2: the gate module is pure and its words are its own (W2-D11, W2-D12; D-5774, D-5775) ──────────
// `deploy/history-gate.mjs` holds every W2 scoring decision (W2-D24) and must stay a pure function of its inputs:
// its imports are `node:crypto` and lib.mjs only, and its text (comments and strings included) never spells a
// clock, a random source, the environment or a dynamic load. Its closed word sets are frozen once, there, and
// pinned here once. FACT_KINDS and LABELS have exactly one declaring file under deploy/ and server/test/ (W2-D12;
// D-5774): importing them is allowed, so this describe reads them off the module and declares neither.
describe('W2-3 Task 2: the gate module is pure and its words are its own', () => {
  const GATE = path.join(ROOT, 'deploy', 'history-gate.mjs');
  const LIB_SPEC = '../ccd/history/lib.mjs';
  const gateSrc = (): string => readFileSync(GATE, 'utf8');
  const gate = async () => import('../../deploy/history-gate.mjs');
  /** Every specifier a static import or re-export names, single- or multi-line, and every bare `import '…'`. */
  const specifiers = (text: string): string[] => [
    ...[...text.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]!),
    ...[...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]!),
  ];
  /** W2-D11's banned spellings, read over the WHOLE text: a comment or a string that spells one is a red too. */
  const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
    ['process.', /\bprocess\.[A-Za-z_$]/],
    ['Date.now', /\bDate\.now\b/],
    ['new Date', /\bnew\s+Date\b/],
    ['Math.random', /\bMath\.random\b/],
    ['performance.', /\bperformance\.[A-Za-z_$]/],
    ['require(', /\brequire\s*\(/],
    ['import(', /\bimport\s*\(/],
  ];
  /** Module-scope declarations only (column 0), the names a reader of the gate could import. */
  const topLevelNames = (text: string): string[] =>
    [...text.matchAll(/^(?:export\s+)?(?:const|let|var|class|(?:async\s+)?function\*?)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
  /** single-definition.test.ts's O14 `declares`, rebuilt here; the names are assembled so this file never
   *  spells a declaration of either one itself. */
  const declares = (name: string): RegExp => new RegExp(`(?:^|[\\s;])(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`);
  const OWN_WORDS = ['FACT' + '_KINDS', 'LAB' + 'ELS'] as const;
  /** A different vocabulary that happens to share the name, measured at 7d01973a2: collectLaneFixture.ts:58
   *  declares a `LABELS` Set of collect-lane box labels from COLLECT_BOX_LABELS. Named, and checked live below. */
  const NAMED_OTHERS: Record<string, { name: string; needle: string }> = {
    'server/test/collectLaneFixture.ts': { name: 'LAB' + 'ELS', needle: 'COLLECT_BOX_LABELS' },
  };
  /** Comment lines dropped, single-definition.test.ts's `stallCodeText` rule: a sentence about a name is no declaration. */
  const codeLinesOf = (text: string): string[] => text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
  const filesUnder = (dir: string, ext: RegExp): string[] =>
    (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((p) => ext.test(p) && !p.split(path.sep).some((s) => s.startsWith('__') || s === 'node_modules'))
      .map((p) => path.join(dir, p));
  /** single-definition.test.ts's class scan (the four-class `enumerates`), restated: a file holding all four
   *  class words is a holder there, and the gate must never become one. */
  const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'] as const;
  const enumeratesClasses = (text: string): boolean => CLASSES.every((c) =>
    new RegExp(`(?:'${c}'|"${c}"|(?<![\\w'-])${c}\\s*:|(?<![\\w-])${c}(?![\\w-]))`).test(text));

  it('CONTROL: the specifier reader, the banned patterns, the declaration reader and the class scan each see what they look for', () => {
    expect(specifiers("import {\n  a,\n  b,\n} from 'node:fs';\nimport 'node:path';\nexport { c } from './c.mjs';"))
      .toEqual(['node:fs', './c.mjs', 'node:path']);
    const planted: Record<string, string> = {
      'process.': 'const h = process.env.HOME;', 'Date.now': 'const t = Date.now();', 'new Date': 'const d = new Date(0);',
      'Math.random': 'const r = Math.random();', 'performance.': 'const p = performance.now();',
      'require(': "const fs = require('node:fs');", 'import(': "const m = await import('node:fs');",
    };
    for (const [word, re] of FORBIDDEN) {
      expect(re.test(planted[word]!), word).toBe(true);
      expect(re.test('the sweep process. A new Dated row; imports are static'), word).toBe(false);
    }
    expect(topLevelNames('export const EXIT = 1;\nconst k = 2;\n  const inner = 3;\nexport function f() {}\nclass C {}'))
      .toEqual(['EXIT', 'k', 'f', 'C']);
    expect(declares(OWN_WORDS[0]).test(`export const ${OWN_WORDS[0]} = Object.freeze(['sha']);`)).toBe(true);
    expect(declares(OWN_WORDS[0]).test(`import { ${OWN_WORDS[0]} } from '../deploy/history-gate.mjs';`)).toBe(false);
    expect(declares(OWN_WORDS[1]).test(`const { ${OWN_WORDS[1]} } = gate;`)).toBe(false);
    expect(enumeratesClasses(readFileSync(path.join(ROOT, 'deploy', 'models-op.mjs'), 'utf8')), 'a known holder').toBe(true);
  });

  it('imports only node:crypto and lib.mjs, and lib.mjs exactly as W2-D11 lists it', () => {
    const specs = specifiers(gateSrc());
    expect(specs).toContain(LIB_SPEC);
    for (const s of specs) expect(['node:crypto', LIB_SPEC], s).toContain(s);
    expect(gateSrc()).toContain(
      "import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';");
  });

  it.each(FORBIDDEN)('the gate source never spells %s (comments and strings included)', (word, re) => {
    const hits = gateSrc().split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => re.test(l));
    expect(hits, `${word} at deploy/history-gate.mjs:${hits.map(([n]) => n).join(',')}`).toEqual([]);
  });

  it('O14, local half: the gate declares no name lib.mjs exports', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const names = topLevelNames(gateSrc());
    expect(names, 'the reader found the gate\'s own declarations').toEqual(expect.arrayContaining(['K', OWN_WORDS[0], 'familyKey']));
    expect(names.filter((n) => Object.prototype.hasOwnProperty.call(lib, n))).toEqual([]);
  });

  it('W2-D12 (D-5774): exactly one file under deploy/ and server/test/ declares each of the gate\'s own word lists, the gate', () => {
    const corpus = [...filesUnder(path.join(ROOT, 'deploy'), /\.mjs$/), ...filesUnder(path.join(ROOT, 'server', 'test'), /\.ts$/)];
    expect(corpus.map((f) => path.relative(ROOT, f))).toEqual(expect.arrayContaining(['deploy/history-gate.mjs', 'server/test/measure-history.test.ts']));
    const texts = new Map(corpus.map((f) => [f, readFileSync(f, 'utf8')] as const));
    for (const name of OWN_WORDS) {
      const re = declares(name);
      const holders = corpus.filter((f) => texts.get(f)!.includes(name) && codeLinesOf(texts.get(f)!).some((l) => re.test(l)))
        .map((f) => path.relative(ROOT, f)).filter((r) => NAMED_OTHERS[r]?.name !== name).sort();
      expect(holders, `${name}: a second declaration`).toEqual(['deploy/history-gate.mjs']);
    }
    for (const [rel, { name, needle }] of Object.entries(NAMED_OTHERS)) {
      const line = codeLinesOf(readFileSync(path.join(ROOT, rel), 'utf8')).find((l) => declares(name).test(l));
      expect(line, `${rel} no longer declares ${name}: remove it from NAMED_OTHERS`).toBeDefined();
      expect(line, `${rel}'s ${name} is no longer the ${needle} set: rule on it`).toContain(needle);
    }
  });

  it('the gate never spells the two small class words, so the class scan never counts it', () => {
    const text = gateSrc();
    expect(text.match(/haiku|sonnet/gi) ?? []).toEqual([]);
    expect(enumeratesClasses(text)).toBe(false);
  });

  it('each constant and word set has its exact value, frozen, with no repeated member', async () => {
    const g = await gate();
    const expected: Record<string, unknown> = {
      K: 10,
      K_UNIT: 'assistant-turns',
      X: { num: 1, den: 10 },
      ROW_CAP: 400,
      BOOTSTRAP: { B: 10000, ci: 95, method: 'percentile', percentile: 'nearest-rank', statistic: 'pooled', prng: 'xoshiro128**' },
      SUBSTREAMS: ['quiz-ci', 'live-ci', 'q18', 'handcheck', 'quiz-sample', 'judge-order'],
      PILOT_SUBSTREAM: 'pilot-sample',
      ASSIGN_LABEL: 'assign',
      FACT_KINDS: ['sha', 'path', 'command', 'error'],
      LABELS: ['correct', 'uncertain', 'fabricated'],
      RUBRIC_IDS: ['v1', 'v1-strict'],
      WRITER_INPUTS: ['excerpt', 'leaf-span'],
      SHA_MIN_PREFIXES: [7, 40],
      ANSWER_STATES: ['value', 'unknown', 'absent'],
      RUN_CLASSES: ['answered', 'infra-failed', 'not-run'],
      QUESTION_OUTCOMES: ['answered', 'rerun', 'run-failed', 'not-run'],
      VERDICTS: ['pass', 'fail', 'halt', 'incomplete'],
      HALT_WORDS: ['absent-rate', 'run-failed', 'handcheck-agreement', 'empty-arm'],
      WINDOW_STATES: ['measured', 'unmeasured'],
      ASSIGNMENT_ARMS: ['treatment', 'control'],
      ACTIVE_EXCLUSIONS: ['merged', 'legacy', 'not-newest', 'no-recent-entry'],
      AMENDMENT_KINDS: ['version-move', 'freeze-exception', 'forced-act'],
      GATE_CODE_FILES: ['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs'],
      GATE_REASONS: [
        'store-id-null', 'store-id-duplicate', 'store-id-unlisted', 'family-unassigned', 'row-cap-mismatch', 'window-mismatch', 'code-changed', 'code-unmeasured',
        'writer-malformed', 'writer-leak',
        'question-not-run',
        'field-missing', 'field-unknown', 'field-malformed', 'constant-mismatch', 'value-outside-set', 'model-alias', 'model-forbidden',
        'signed-text-mismatch', 'release-mismatch', 'flag-rejected', 'seed-changed', 'pilot-drift', 'quiz-mismatch', 'quiz-holds-control',
        'pilot-quiz-overlap', 'window-length', 'assignment-mismatch', 'draft-mismatch', 'chain-mismatch', 'post-start-change',
        'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted',
      ],
    };
    const mod = g as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(expected)) {
      expect(mod[name], name).toEqual(value);
      if (typeof value === 'object') {
        expect(Object.isFrozen(mod[name]), `${name} is not frozen`).toBe(true);
        if (Array.isArray(value)) expect(new Set(value).size, `${name} repeats a member`).toBe(value.length);
      }
    }
    expect(g.FACT_KINDS, 'D-5775: decisions are not a fact kind').not.toContain('decision');
    expect(g.SUBSTREAMS, 'the pilot\'s label is used only with the pilot\'s own seed').not.toContain(g.PILOT_SUBSTREAM);
    expect(g.SUBSTREAMS, '\'assign\' is a hash label, not a substream').not.toContain(g.ASSIGN_LABEL);
    expect(typeof g.METRIC_TEXT).toBe('string');
    expect(g.METRIC_TEXT).toContain('recall calls per post-compaction turn');
    expect(g.METRIC_TEXT).toContain('first K assistant turns');
  });

  it('familyKey is canonical JSON of (store_id, ccrc_id, generation): equal ids on two stores are two keys', async () => {
    const g = await gate();
    const lib = await import('../../ccd/history/lib.mjs');
    expect(g.familyKey(OTHER_STORE, 'demo-id', G1)).toBe(`["${OTHER_STORE}","demo-id","${G1}"]`);
    expect(g.familyKey(OTHER_STORE, 'demo-id', G1)).toBe(lib.canonicalJson([OTHER_STORE, 'demo-id', G1]));
    expect(g.familyKey(OTHER_STORE, 'demo-id', G1)).not.toBe(g.familyKey('00000000-0000-4000-8000-000000000002', 'demo-id', G1));
    expect(g.familyKey(OTHER_STORE, 'a","b', '')).toBe(`["${OTHER_STORE}","a\\",\\"b",""]`);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 2')
```

Expected (measured on a copy of `7d01973a2` with this describe appended): red, `13 failed | 1 passed`. The CONTROL passes. The cases that read the source fail with `ENOENT: no such file or directory, open '…/deploy/history-gate.mjs'`, and the cases that load it fail with `Cannot find module '/deploy/history-gate.mjs' imported from …/server/test/measure-history.test.ts`. The skipped count depends on Task 1's cases.

- [ ] **Step 4: Write the module.** Create `deploy/history-gate.mjs`:

```js
// deploy/history-gate.mjs — ccrc history W2's gate: every scoring decision of the replay eval, as pure functions.
//
// Spec: docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §10.2 (the replay eval, the gate).
// The decisions document for W2 (W2-D11 to W2-D25, W2-D60 to W2-D64, W2-D72, W2-D79 to W2-D81, W2-D87, W2-D89,
// W2-D90) is the authority for what lives here and why.
//
// PURE (W2-D11). The only imports are `node:crypto` and `../ccd/history/lib.mjs`. No fs, no child_process, no
// environment read, no clock and no random source: every input, a seed and every instant included, arrives as a
// parameter. measure-history.test.ts pins this over the import block and over the whole text, comments and strings
// included, so even a sentence here never spells one of the banned reads. JSDoc types are written inline, never
// through a dynamic type import, for the same reason.
//
// WHO READS IT. `deploy/history-replay.mjs` (the driver, W2-4 to W2-5b) and `deploy/history-counters.mjs` (W2-6)
// import it. Every scoring decision lives here and nowhere else (W2-D24): the open record pins this file's sha256
// in `gate_code`, beside measure-history.py, history-replay.mjs and lib.mjs, and every `--record` consumer
// re-checks it.
//
// ITS WORDS ARE ITS OWN (W2-D12; D-5774). The gate's closed word sets are frozen once, below, and never in lib.mjs:
// lib's vocabularies are ccd/history's (its REASONS are the CLI's words). No name lib exports is declared again
// here (O14), and FACT_KINDS and LABELS have this file as their one declaring file under deploy/ and server/test/.
// Two class words of the model catalogue are never spelled in this file, not even in a comment, so the catalogue's
// class-enumeration scan in single-definition.test.ts never counts it.
import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';

// ── The window (W2-D14) ──────────────────────────────────────────────────────────────────────────────────────
/** K: a post-compaction window is the first K assistant turns after a main boundary (spec §10.2, Q14). */
export const K = 10;

/** The unit K counts (W2-D14): assistant turns, consecutive rows grouped by msg_id, else request_id, else uuid.
 *  validateOpenRecord refuses any other `k_unit`. */
export const K_UNIT = 'assistant-turns';

/** X = 1/10 as an exact fraction: criterion 3's floor on the lower bound of the treatment window share (spec §10.2,
 *  Q14). Every comparison against it is by cross-multiplication, never in floating point (W2-D18).
 *  @type {Readonly<{num: number, den: number}>} */
export const X = Object.freeze({ num: 1, den: 10 });

/** The ruled metric, as the open record's `metric` field carries it (part 1, fixed). */
export const METRIC_TEXT = 'recall calls per post-compaction turn, reported for both arms; gated: the share of treatment '
  + 'windows with at least one ccrc history read-verb call over the first K assistant turns after a main boundary';

/** The row cap every W2 measure-history.py run passes as `--row-cap` (plan-chosen). assembleReports refuses a
 *  report made under any other cap (`row-cap-mismatch`, W2-D22); a window cut by it before turn K+1 is unmeasured. */
export const ROW_CAP = 400;

/** @type {readonly ['measured', 'unmeasured']} */
export const WINDOW_STATES = Object.freeze(['measured', 'unmeasured']);
/** @typedef {(typeof WINDOW_STATES)[number]} WindowState */

// ── The bootstrap, its substreams and the assignment (W2-D18, W2-D19) ────────────────────────────────────────
/** The bootstrap as the record's `bootstrap` field fixes it; the seed and the substream list ride beside it.
 *  @type {Readonly<{B: 10000, ci: 95, method: 'percentile', percentile: 'nearest-rank', statistic: 'pooled', prng: 'xoshiro128**'}>} */
export const BOOTSTRAP = Object.freeze({
  B: 10000, ci: 95, method: 'percentile', percentile: 'nearest-rank', statistic: 'pooled', prng: 'xoshiro128**',
});

/** The closed list of substream labels a draft seed feeds (W2-D18). A label outside it is refused.
 *  @type {readonly ['quiz-ci', 'live-ci', 'q18', 'handcheck', 'quiz-sample', 'judge-order']} */
export const SUBSTREAMS = Object.freeze(['quiz-ci', 'live-ci', 'q18', 'handcheck', 'quiz-sample', 'judge-order']);
/** @typedef {(typeof SUBSTREAMS)[number]} Substream */

/** The pilot's one label, used only with the pilot's own seed, never with the draft seed (W2-D18). */
export const PILOT_SUBSTREAM = 'pilot-sample';

/** The assignment's hash label: an arm is bit 0 of sha256(seed + ':assign:' + familyKey), not a substream draw
 *  (W2-D19). */
export const ASSIGN_LABEL = 'assign';

/** @type {readonly ['treatment', 'control']} */
export const ASSIGNMENT_ARMS = Object.freeze(['treatment', 'control']);
/** @typedef {(typeof ASSIGNMENT_ARMS)[number]} Arm */

/** Why a store's family is not active at W2 open (W2-D20), one reason each, never folded: (a) merged, (a) a legacy
 *  '' generation (excluded, fixed), (b) not its id's newest unmerged family, (c) no main entry in the look-back.
 *  @type {readonly ['merged', 'legacy', 'not-newest', 'no-recent-entry']} */
export const ACTIVE_EXCLUSIONS = Object.freeze(['merged', 'legacy', 'not-newest', 'no-recent-entry']);
/** @typedef {(typeof ACTIVE_EXCLUSIONS)[number]} ActiveExclusion */

// ── The quiz (W2-D60 to W2-D64, W2-D72, W2-D79 to W2-D81) ────────────────────────────────────────────────────
/** The fact kinds the quiz sources (W2-D60; D-5775). Decisions are not sourced: nothing mines one mechanically,
 *  and prose has no whole-fact form to match by string. Re-adding them takes a new kind, a variant rule, a
 *  labeller and a new record version.
 *  @type {readonly ['sha', 'path', 'command', 'error']} */
export const FACT_KINDS = Object.freeze(['sha', 'path', 'command', 'error']);
/** @typedef {(typeof FACT_KINDS)[number]} FactKind */

/** An answer's label (spec §10.2 Scoring). `correct` is decided by labelCorrect alone; the judge picks between the
 *  other two (W2-D63, W2-D79).
 *  @type {readonly ['correct', 'uncertain', 'fabricated']} */
export const LABELS = Object.freeze(['correct', 'uncertain', 'fabricated']);
/** @typedef {(typeof LABELS)[number]} Label */

/** The judge rubrics part 1 may sign by `rubric_id` (W2-D79).
 *  @type {readonly ['v1', 'v1-strict']} */
export const RUBRIC_IDS = Object.freeze(['v1', 'v1-strict']);
/** @typedef {(typeof RUBRIC_IDS)[number]} RubricId */

/** What the question writer is shown (W2-D72): the default excerpt, or leaf N's whole redacted span.
 *  @type {readonly ['excerpt', 'leaf-span']} */
export const WRITER_INPUTS = Object.freeze(['excerpt', 'leaf-span']);
/** @typedef {(typeof WRITER_INPUTS)[number]} WriterInput */

/** The two `sha_min_prefix` values part 1 may sign (W2-D63): 7, the default, or 40, the spec's exact match.
 *  @type {readonly [7, 40]} */
export const SHA_MIN_PREFIXES = Object.freeze([7, 40]);
/** @typedef {(typeof SHA_MIN_PREFIXES)[number]} ShaMinPrefix */

/** parseAnswerField's three answers (W2-D64): only `value` reaches labelCorrect.
 *  @type {readonly ['value', 'unknown', 'absent']} */
export const ANSWER_STATES = Object.freeze(['value', 'unknown', 'absent']);
/** @typedef {(typeof ANSWER_STATES)[number]} AnswerState */

/** One spawned run's class (W2-D80): a model-level non-answer is `answered`; a stop is `not-run`, never a failure.
 *  @type {readonly ['answered', 'infra-failed', 'not-run']} */
export const RUN_CLASSES = Object.freeze(['answered', 'infra-failed', 'not-run']);
/** @typedef {(typeof RUN_CLASSES)[number]} RunClass */

/** A question's outcome over its attempts (W2-D80): one infra failure is `rerun`, a second `run-failed`.
 *  @type {readonly ['answered', 'rerun', 'run-failed', 'not-run']} */
export const QUESTION_OUTCOMES = Object.freeze(['answered', 'rerun', 'run-failed', 'not-run']);
/** @typedef {(typeof QUESTION_OUTCOMES)[number]} QuestionOutcome */

// ── The verdict (W2-D89) ─────────────────────────────────────────────────────────────────────────────────────
/** decideGate's verdicts: `halt` waits on an operator ruling, `incomplete` on the hand-check's missing labels.
 *  @type {readonly ['pass', 'fail', 'halt', 'incomplete']} */
export const VERDICTS = Object.freeze(['pass', 'fail', 'halt', 'incomplete']);
/** @typedef {(typeof VERDICTS)[number]} Verdict */

/** The words decideGate lists in `halts`: the absent rate over `absent_rate_max` in either arm (W2-D64), the
 *  run-failed share over `run_failed_max` (W2-D80), hand-check agreement under `handcheck_agreement_min` (W2-D81),
 *  and an empty arm, a criterion 1 or 3 treatment set with no cluster left (the coordinator's W2-3 ruling). The hold,
 *  a judge-failed item with no operator label, has no word here: it is the verdict `incomplete`.
 *  @type {readonly ['absent-rate', 'run-failed', 'handcheck-agreement', 'empty-arm']} */
export const HALT_WORDS = Object.freeze(['absent-rate', 'run-failed', 'handcheck-agreement', 'empty-arm']);
/** @typedef {(typeof HALT_WORDS)[number]} HaltWord */

// ── The open record (W2-D22, W2-D24, W2-D25, W2-D72, W2-D90) ─────────────────────────────────────────────────
/** The kinds an amendment to part 2 may carry (W2-D90, chosen set).
 *  @type {readonly ['version-move', 'freeze-exception', 'forced-act']} */
export const AMENDMENT_KINDS = Object.freeze(['version-move', 'freeze-exception', 'forced-act']);
/** @typedef {(typeof AMENDMENT_KINDS)[number]} AmendmentKind */

/** The four files whose installed bytes `gate_code.files` hashes, by repo-relative path (W2-D24).
 *  @type {readonly ['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']} */
export const GATE_CODE_FILES = Object.freeze([
  'deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs',
]);

/** Every refusal word the gate answers, in four groups: assembleReports' (W2-D22, with W2-D13's echoed window and W2-D24's
 *  `code-changed`, `code-unmeasured` for a sha missing on either side), the question writer's discards (W2-D72), decideGate's one refusal (W2-D89), and validateOpenRecord's, one
 *  word per remedy for W2-D25's bullets and W2-D90's rule (a code-sha mismatch in step 0a or the pilot reuses `code-changed`).
 *  Only this module declares the list (W2-D12); W2-4's DRIVER_REASONS shares three spellings, `code-changed`, `code-unmeasured` and `assignment-mismatch`.
 *  @type {readonly ['store-id-null', 'store-id-duplicate', 'store-id-unlisted', 'family-unassigned', 'row-cap-mismatch', 'window-mismatch', 'code-changed', 'code-unmeasured', 'writer-malformed', 'writer-leak', 'question-not-run', 'field-missing', 'field-unknown', 'field-malformed', 'constant-mismatch', 'value-outside-set', 'model-alias', 'model-forbidden', 'signed-text-mismatch', 'release-mismatch', 'flag-rejected', 'seed-changed', 'pilot-drift', 'quiz-mismatch', 'quiz-holds-control', 'pilot-quiz-overlap', 'window-length', 'assignment-mismatch', 'draft-mismatch', 'chain-mismatch', 'post-start-change', 'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted']} */
export const GATE_REASONS = Object.freeze([
  // assembleReports (W2-D22, with W2-D13's echoed window) and the gate_code re-check (W2-D24)
  'store-id-null', 'store-id-duplicate', 'store-id-unlisted', 'family-unassigned', 'row-cap-mismatch', 'window-mismatch', 'code-changed', 'code-unmeasured',
  // the question writer's discards (W2-D72)
  'writer-malformed', 'writer-leak',
  // decideGate's one refusal: a question still not-run at gate time (W2-D89)
  'question-not-run',
  // validateOpenRecord (W2-D25, W2-D90)
  'field-missing', 'field-unknown', 'field-malformed', 'constant-mismatch', 'value-outside-set', 'model-alias', 'model-forbidden',
  'signed-text-mismatch', 'release-mismatch', 'flag-rejected', 'seed-changed', 'pilot-drift', 'quiz-mismatch', 'quiz-holds-control',
  'pilot-quiz-overlap', 'window-length', 'assignment-mismatch', 'draft-mismatch', 'chain-mismatch', 'post-start-change',
  'amendment-kind', 'amendment-detail-mismatch', 'version-move-unpiloted',
]);
/** @typedef {(typeof GATE_REASONS)[number]} GateReason */

// ── The family key (W2-D19, W2-D22; spec §10.2 "The cluster unit") ───────────────────────────────────────────
/** A session family's one key: canonical JSON of (store_id, ccrc_id, generation), so equal id strings on two
 *  stores are two families, never one cluster. The assignment hashes it and assembleReports keys by it.
 *  @param {string} storeId
 *  @param {string} ccrcId
 *  @param {string} generation
 *  @returns {string} */
export function familyKey(storeId, ccrcId, generation) {
  return canonicalJson([storeId, ccrcId, generation]);
}
```

- [ ] **Step 5: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 2')
```

Expected: green, `14 passed` (measured again on 2026-10-19, after the edit that added four `GATE_REASONS` words, on a scratch tree of `7d01973a2` holding this step's 178-line module and this describe in a scratch test file; predicted unchanged after the fifth word, `code-unmeasured` (W2-D24, amended), and the sixth, `flag-rejected` (W2-D25, amended at the final plan review), which change no case and no line count). The W2-D12 case reads every `.ts` file under `server/test/`, about 885 files and 31 MB. It took 4 to 10 s on a loaded box. The time is spent reading files, not scanning them.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block applies one change, runs one filter, shows it red, and then restores the file with `cp` (or removes the planted file). The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-3/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
plant() { printf '%s\n' "$1" >> deploy/history-gate.mjs; }   # plant <line>: append one line to the gate
cp deploy/history-gate.mjs "$SCRATCH/gate.orig"
cp server/test/collectLaneFixture.ts "$SCRATCH/clf.orig"

# M1: a third import.
plant "import { readFileSync } from 'node:fs';"
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'imports only node:crypto and lib')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED (measured): 1 failed, node:fs: expected [ 'node:crypto', …(1) ] to include 'node:fs'.

# M2 to M8: each banned spelling, planted inside a function that is never called, so the module still loads cleanly.
plant 'export function mEnv() { return process.env.HOME; }'
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'never spells process')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
plant 'export function mNow() { return Date.now(); }'
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'never spells Date')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
plant 'export function mDate() { return new Date(0); }'
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'never spells new Date')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
plant 'export function mRandom() { return Math.random(); }'
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'never spells Math')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
plant 'export function mPerf() { return performance.now(); }'
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'never spells performance')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
plant "export function mRequire() { return require('node:fs'); }"
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'never spells require')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
plant "export function mImport() { return import('node:fs'); }"
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'never spells import')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED, each (measured at 178 lines on 2026-10-19 for process.; the other six predicted alike): 1 failed,
# `<word> at deploy/history-gate.mjs:179: expected [ [ 179, …(1) ] ] to deeply equal []`,
# for process., Date.now, new Date, Math.random, performance., require( and import( in turn.

# M9 (O14): the gate declares EXIT itself instead of importing it.
mut deploy/history-gate.mjs "import { EXIT, UUID_RE, " "import { UUID_RE, "
plant 'export const EXIT = Object.freeze({ RECALL_OFF: 8 });'
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'O14, local half')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'EXIT is declared in ccd')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED (measured), both: expected [ 'EXIT' ] to deeply equal []; and single-definition's O14 row
# EXIT: a second declaration: expected [ 'ccd/history/lib.mjs', …(1) ] to deeply equal [ 'ccd/history/lib.mjs' ].

# M10 (W2-D12): a second file declares FACT_KINDS.
printf '%s\n' "export const FACT_KINDS = Object.freeze(['sha']);" > deploy/w2d12-mutant.mjs
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-D12')
rm deploy/w2d12-mutant.mjs
# Expected RED (measured): FACT_KINDS: a second declaration: expected [ 'deploy/history-gate.mjs', …(1) ] to deeply equal [ 'deploy/history-gate.mjs' ].

# M11 (W2-D12's named entry): the other declarer goes away, which would leave the entry stale.
mut server/test/collectLaneFixture.ts "const LABELS: ReadonlySet<string>" "const BOX_LABELS: ReadonlySet<string>"
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-D12')
cp "$SCRATCH/clf.orig" server/test/collectLaneFixture.ts
# Expected RED (measured): server/test/collectLaneFixture.ts no longer declares LABELS: remove it from NAMED_OTHERS: expected undefined to be defined.

# M12: a comment spelling all four class words.
plant '// classes: haiku, sonnet, opus, fable'
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'never spells the two small class words')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the four class names are enumerated only where')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED (measured), both: expected [ 'haiku', 'sonnet' ] to deeply equal []; and the class scan's
# expected [ 'ccd/ccd', 'ccd/ccrc', …(6) ] to deeply equal [ 'ccd/ccd', 'ccd/ccrc', …(5) ].

# M13: K moved.
mut deploy/history-gate.mjs "export const K = 10;" "export const K = 11;"
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'each constant and word set has its exact value')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED (measured): K: expected 11 to deeply equal 10.

# M14: a word set left unfrozen.
mut deploy/history-gate.mjs "export const LABELS = Object.freeze(['correct', 'uncertain', 'fabricated']);" "export const LABELS = ['correct', 'uncertain', 'fabricated'];"
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'each constant and word set has its exact value')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED (measured): LABELS is not frozen: expected false to be true.

# M15 (D-5775): decisions sourced again.
mut deploy/history-gate.mjs "export const FACT_KINDS = Object.freeze(['sha', 'path', 'command', 'error']);" "export const FACT_KINDS = Object.freeze(['sha', 'path', 'command', 'error', 'decision']);"
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'each constant and word set has its exact value')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED (measured): FACT_KINDS: expected [ 'sha', 'path', 'command', …(2) ] to deeply equal [ 'sha', 'path', 'command', 'error' ].

# M16: the family key joined with a separator, so a ':' inside an id could merge two families.
mut deploy/history-gate.mjs "  return canonicalJson([storeId, ccrcId, generation]);" "  return [storeId, ccrcId, generation].join(':');"
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'familyKey is canonical JSON')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED (measured): expected '00000000-0000-4000-8000-000000000001:…' to be '["00000000-0000-4000-8000-00000000000…'.

cmp deploy/history-gate.mjs "$SCRATCH/gate.orig" && cmp server/test/collectLaneFixture.ts "$SCRATCH/clf.orig" && echo restored
test ! -e deploy/w2d12-mutant.mjs && echo no-mutant-left
git status --short   # only deploy/history-gate.mjs (new) and server/test/measure-history.test.ts
```

The filters are plain text, so none needs escaping. `never spells Date` selects only the `Date.now` row, because the `new Date` row's title reads `never spells new Date`. Run Step 5's command once more afterwards. Expected (measured): green, `14 passed`.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'every vocabulary is declared once|the four class names are enumerated only where a walk needs the sequence')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean')
```

Expected:
- `single-definition`: `68 passed` (measured). `DECL_CORPUS` now holds the gate, and the O14 rows still find each `VOCABS` name declared in lib.mjs alone. The class scan's holders are unchanged.
- `measure-history`: green. Measured at `31 passed`, the base cases plus this describe. Task 1's cases add to that count (predicted).
- `typecheck-tests`: green (predicted). On the copy, `tsc -p test/tsconfig.tests.json --listFiles` puts `deploy/history-gate.mjs` in the program through `allowJs` and reports no error in it or in `measure-history.test.ts` (measured). The copy lacked `agent/node_modules`, so its other errors came from the copy itself.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-gate.mjs server/test/measure-history.test.ts
git commit -m "feat(history): the W2 gate module, pure, with its frozen constants and word sets (W2-3 Task 2, D-5774, D-5775)"
```

### Task 3: Turns, windows and the two copy rules; O52 re-pinned against the Node builder

Task 1 leaves `measure-history.py` emitting raw rows, with no K, no turn rule and no model test. This task builds every W2 window from those rows in `deploy/history-gate.mjs`, as W2-D14 rules:
- **A turn** is a group of the window copy's assistant rows, taken in file order, that share one `turnKey = msg_id ?? request_id ?? uuid` and are consecutive. A row whose model is angle-bracketed (`<synthetic>`) is dropped. A row with a null model stays a turn. The predicate is module-local and marked temporary, because W2-1 replaces it with lib's `isSyntheticModel` (W2-D17).
- **A window** opens at the boundary's `ts_ms`, inclusive. It ends, exclusive, at the earlier of two times: the first row of turn K+1 and the next main boundary in that copy. When neither exists, it ends inclusive at the copy's last timed row.
- **A window is `unmeasured`** in three cases:
  - the copy has no timed row;
  - the row cap cut the copy and the first row of turn K+1 was not seen, whether or not a next boundary exists;
  - a row that would end the window has a null `ts_ms` (*chosen* here, see below).

The two copy rules (W2-D15) are spelled once each:
- `windowCopyOf` is W1's longest copy. Ties go to `lib.pickHoldingCopy`.
- `producerCopyOf` is `lib.pickHoldingCopy` over all the copies, the copy that derive.mjs:316 reads. `producerOfBoundary` folds that copy's `models` through `lib.producerOf`, so the strata are folded in Node (W2-D16).

`splitAtFirstExit8` splits a family's calls at its first exit 8 (spec §10.2:2722, :2728).

O52's window half is re-pinned through the real script and this builder: **windows 2, with_call 2, calls 4, turns 13, unmeasured 0**. A call planted at exactly 4000 and one at exactly 7000 leave those totals unchanged. A second fixture, `turnStore`, carries RP6's window cases and the CONTROLs; it is a sibling of `plantedStore` that takes `msg_id`, `request_id` and `model` per row. This task lands D-5771 (`history-w2-window-copy-rule`), defined in this plan's "Deviations found". It cites D-5770 and D-5772, which Task 1 lands.

**Files:**
- Modify: `deploy/history-gate.mjs`. Append one section at the END of the file, after Task 2's constants and word sets. It adds no import: Task 2's import block already names `EXIT`, `pickHoldingCopy` and `producerOf`.
- Modify: `server/test/measure-history.test.ts`.
  - **In place:** insert one case at the end of `describe('measure-history.py: the named queries over planted rows (O52)', …)`, directly above that describe's closing `});`. The closing line is the one before `describe('measure-history.py: read-only, and a missing input is refused, never created', () => {` (`:208-210` at 7d01973a2; re-anchor by content after Task 1). Task 1's raw-row case for O52 stays as Task 1 wrote it; the totals sit in this sibling case.
  - **End-appended:** module-level types and helpers (`turnStore`, `t3Family`, `t3Planted`, `t3DeriveProducer`), then `describe('W2-3 Task 3: windows over assistant turns', …)`.
  - It reuses these module-level names: `SCRIPT`, `PY_ISOLATED`, `NOW`, `G1`, `Planted`, `plantedStore` and `report`; and these imports: `spawnSync`, `createHash`, `readFileSync`, `writeFileSync`, `path`, `DatabaseSync`, `mkTmp`, `createStore` and `scrubbedEnv`.
  - It adds no static import. The gate, `derive.mjs` and `lib.mjs` load through `await import`, as the W1-e describe already loads lib.
- Not edited:
  - `deploy/measure-history.py`. Task 1's emission is consumed as it is. The producer CONTROL's `.py` mutant is planted in a TMPDIR copy that the test itself writes.
  - `ccd/**`. `derive.mjs` and `lib.mjs` are only read.

**Interfaces:**
- Consumes (Task 1, `measure-history.py`):
  - **Flags.** `--families FILE --window-start MS --window-end MS --row-cap N`.
  - **The `w2` key.** It is `{row_cap, window_start_ms, window_end_ms, families: [FamilyReport]}` (the window echoed, W2-D13 amended; this task reads `families` only), and a family of this store is listed in the families file's order.
  - **FamilyReport.** `{ccrc_id, generation, found, merged_generations, calls, boundaries}`:
    - `calls` are `[ts_ms, rc, verb]` with `arm IS NULL` and `ts_ms >= --window-start`, ordered by `ts_ms`, then `event_key`;
    - `boundaries` are the main boundaries whose `ts_ms` is in `[start, end)`, so a null-ts boundary is never one.
  - **BoundaryReport.** `{boundary_uuid, ts_ms, copies}`.
  - **Copy.** `{file_id, source_key, boundary_line, after_count, summary_line, next_boundary_line, next_boundary_ts_ms, last_ts_ms, rows, models, truncated}`. This task relies on these readings:
    - `rows` are the assistant rows after the summary (or after the boundary) and before the next main boundary, up to the cap, each `[line, ts_ms, msg_id, request_id, uuid, model]`;
    - `truncated` says the cap cut `rows`;
    - `next_boundary_*` is the next main-boundary row of that file by line, timed or not;
    - `last_ts_ms` is the last timed row of the whole copy;
    - `models` is uncapped and runs to the end of the copy.
  - **The script itself.** It defines `copy_record(...)` at module scope and calls it by name, and it has one `if __name__ == '__main__':` line.
- Consumes (Task 2, `deploy/history-gate.mjs`):
  - `K = 10`, `ROW_CAP = 400` and `WINDOW_STATES = ['measured', 'unmeasured']`;
  - the import block `import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';`.
- Consumes (lib, base):
  - `producerOf(models)`;
  - `pickHoldingCopy([{fileId, live, holds}])`, which answers a fileId or null;
  - `EXIT.RECALL_OFF = 8`.
  - In the test only: `derive.mjs`'s exported `holdingCopyOf(db, {entry_id, transcript_pk})`, `lib.summaryRowFor` and `lib.producerOfCopy(rows, summaryIndex)`. These are the pick and the fold that derive.mjs:313-316 composes.
- Produces (`deploy/history-gate.mjs`; JSDoc typedefs `RawRow`, `CallRow`, `Copy`, `BoundaryReport`, `FamilyReport`, `Turn`, `Window`):
  - `turnKey(row: RawRow): string`
  - `turnsOf(rows: RawRow[]): Turn[]`, where `Turn = {key: string, first_line: number, first_ts_ms: number|null, rows: RawRow[]}`. W2-6 imports it.
  - `windowCopyOf(copies: Copy[]): Copy|null`
  - `producerCopyOf(copies: Copy[]): Copy|null`
  - `producerOfBoundary(copies: Copy[]): 'anthropic'|'other'|'unknown'`
  - `windowOf(boundary: BoundaryReport, calls: CallRow[], k?: number): Window`
  - `buildWindows(family: FamilyReport, k?: number): Window[]`, which answers `[]` for `found: false`
  - `windowTotals(windows: Window[]): {windows, with_call, calls, turns, unmeasured}`
  - `splitAtFirstExit8(calls: CallRow[]): {upTo: CallRow[], after: CallRow[]}`
  - `Window = {boundary_uuid, ts_ms, producer, state: 'measured'|'unmeasured', start_ms, end_ms: number|null, end_inclusive: boolean, turns: number, calls: number, with_call: boolean}`; `RawRow = [line, ts_ms, msg_id, request_id, uuid, model]`; `CallRow = [ts_ms, rc, verb]`.
  - The module-private `isSyntheticLocal(model)` (TEMPORARY, W2-D17) and `holdingCopyAmong(copies)`.

**Decisions:** W2-D14 (the window, the turn unit, the end rule, O52), W2-D15 (the two copy rules), W2-D16 (Node folds the strata through `lib.producerOf`), W2-D17 (W2-3's half: the temporary predicate), and the first-exit-8 split (spec §10.2:2722, :2728). Departures: D-5771 is defined here; D-5770 and D-5772 are cited. W2-1 amends the spec's errata E12 to E14, so this task leaves the spec alone.

**Choices this task makes:**
- **A window whose ending row has no `ts_ms` is `unmeasured`.** This is the decomposer's reading, *chosen* here and named in Review Focus; the coordinator accepted it as written (2026-10-19, the header's P1).
  - The window's end is the earlier of two times: turn K+1's first row and the next main boundary. When either of those rows is present with a null `ts_ms`, the earlier one cannot be known, so the window is not measured.
  - Real boundary rows carry a time, so the guard is for malformed stores. It never guesses an end.
- **A boundary with no summary of its own is `unmeasured` (P4).** Task 1 keeps W1's summary search, which is not bounded by the next main boundary (the coordinator's ruling keeps that rule). So a boundary with no summary of its own reads the next boundary's summary: `summary_line` lies past `next_boundary_line`, `rows` is empty, and turns 1 to K+1 are never seen. Read as given, that is a measured window of 0 turns that runs to the next boundary and counts every call in between, past turn K, against W2-D14's first-K-turns rule, and it inflates criterion 3. `windowOf` reads `summary_line > next_boundary_line` as unmeasured instead. The summary rule itself is unchanged, in Python and in derive; only the window refuses to guess. W2-D14 rules the no-timed-row and truncation cases and says nothing about this one, so it is the plan's choice, the header's P4, with its own case and mutant M16.
- **An unmeasured window carries `end_ms: null`, `end_inclusive: false`, `turns: 0`, `calls: 0`, `with_call: false`.** Every total skips it, and `windowTotals` counts it apart, so no total can take it in by accident. Its `producer` is still computed, so a report can count unmeasured windows by stratum.
- **`turns` is the turns seen, capped at K.** A window that ends at turn K+1 holds exactly K turns. A window that ends at the next boundary or at the copy's last row holds every turn before that.
- **The O52 totals sit in a sibling case of Task 1's raw-row case**, inside the same O52 describe. Each pin keeps its own owner, and Task 1's case text is never re-edited.
- **The producer CONTROL's `.py` mutant is planted by the test itself.** It goes into a TMPDIR copy of the script, which wraps `copy_record` so that `models` is read from the capped, boundary-stopped `rows`. The mutant is therefore measured on every run, and the real script is never edited.
- **Two more fixtures, P3 and P2:**
  - P3 has a retired copy that is longer than the live one. It is the only shape in which `producerOfBoundary` reading the window copy changes the answer, so it is the case that catches that mutant.
  - P2 places the only witness past the row cap, with no next boundary.
- **The parity fixtures stay off the one shape where the two summary rules diverge** (coordinator ruling). Task 1 keeps W1's summary rule (the first `is_compact_summary` row after the boundary), and derive's `summaryRowFor` is anchor-based. They can pick different producers only when an assistant row with a non-unknown model lies between a boundary and its summary row. Every `turnStore` fixture puts its summary row (`t3S`) directly after its boundary (`t3B`), and so does `plantedStore`, so RA-10's pin compares like with like. Producer strata are report-only, never gating, so the divergence is a named residual (the header's "Not in this plan", and D-5771), not a pin.

- [ ] **Step 1: Confirm Task 1's and Task 2's names before using them.** From the repository root:

```bash
grep -c '^def copy_record(' deploy/measure-history.py
grep -c "^if __name__ == '__main__':$" deploy/measure-history.py
grep -c "^import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';$" deploy/history-gate.mjs
grep -c "^describe('measure-history.py: read-only, and a missing input is refused, never created', () => {$" server/test/measure-history.test.ts
grep -c '^interface Planted { home: string; db: string; storeId: string; families: string; b1: string; b2: string }$' server/test/measure-history.test.ts
grep -c '^const report = (args: string\[\]): Report => {$' server/test/measure-history.test.ts
node --input-type=module -e "const g = await import('./deploy/history-gate.mjs'); console.log(g.K, g.ROW_CAP, JSON.stringify(g.WINDOW_STATES), JSON.stringify(['turnKey', 'turnsOf', 'windowCopyOf', 'producerCopyOf', 'producerOfBoundary', 'windowOf', 'buildWindows', 'windowTotals', 'splitAtFirstExit8'].filter((n) => n in g)))"
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 1')
```

Expected:
- every count is 1;
- the node line prints `10 400 ["measured","unmeasured"] []`, so Task 2's three names are there and none of this task's is;
- Task 1's describe is green.

`copy_record` is the seam the producer CONTROL wraps in its TMPDIR copy. The script must call it by name at module scope, not inline its body: the CONTROL's own assertion fails loudly if the wrap does not take. A 0, or another value, is a gap in Task 1 or Task 2. Stop and report it. Never define any of their names here.

- [ ] **Step 2: Write the failing tests.** Two edits to `server/test/measure-history.test.ts`.

(a) **In place:** the O52 totals. From the repository root, write the case to a scratch file, then insert it directly above the O52 describe's closing `});`. Both heredocs are quoted.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-3/scratch/t3-o52"; mkdir -p "$SCRATCH"   # under the gitignored scratch root, its own subdirectory so the rm -rf below removes only it
cat > "$SCRATCH/o52-case.ts" <<'CASE'
  // W2-3 Task 3 (W2-D14, D-5770): O52's window half re-pinned against the Node builder. W1's pin read 3 calls over
  // 14 assistant entries: B1 ended INCLUSIVE at its 10th entry (3900) and B2 at the copy's last row (7100, past B3).
  // Now a window is the first K = 10 assistant TURNS (here one row each: no msg_id or request_id is planted) and ends
  // EXCLUSIVE at turn 11's first row or at the next main boundary, whichever is earlier:
  //   B1 [2000, 4000): turns 3000..3900; calls k1 2500, k2 3900 and k3 3950 (k3 is now inside; k4 1999 is before it);
  //   B2 [5000, 7000), ended by B3's row: turns 5100, 5200, 5300; call k6 5200, the merged '' family's.
  // k5 is a replay arm's and never reaches Node (Task 1), B3 (7000) is past --window-end, the subagent boundary is not
  // a main one, and demo-b is listed under another store. Totals: windows 2, with_call 2, calls 4, turns 13.
  it('W2-3 Task 3: O52 re-pinned against the Node builder: windows 2, with_call 2, calls 4, turns 13, unmeasured 0; calls at exactly 4000 and 7000 stay outside', async () => {
    const g = await t3Gate();
    const f = plantedStore();
    const TOTALS = { windows: 2, with_call: 2, calls: 4, turns: 13, unmeasured: 0 };
    const before = g.buildWindows(t3Planted(f, g.ROW_CAP));
    expect(before.map((w) => [w.boundary_uuid, w.state, w.start_ms, w.end_ms, w.end_inclusive, w.turns, w.calls])).toEqual([
      [f.b1, 'measured', 2000, 4000, false, 10, 3],
      [f.b2, 'measured', 5000, 7000, false, 3, 1],
    ]);
    expect(g.windowTotals(before)).toEqual(TOTALS);
    const db = new DatabaseSync(f.db);
    try {
      const ins = db.prepare("INSERT INTO recall_calls (event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm) VALUES (?, 'demo-a', ?, ?, 'expand', 0, 40, NULL)");
      ins.run('k8', G1, 4000);   // exactly B1's end: turn 11's first row
      ins.run('k9', G1, 7000);   // exactly B2's end: B3's row
    } finally {
      db.close();
    }
    const after = t3Planted(f, g.ROW_CAP);
    expect(after.calls.map((c) => c[0]), 'CONTROL: both planted calls reach Node').toEqual(expect.arrayContaining([4000, 7000]));
    expect(g.windowTotals(g.buildWindows(after))).toEqual(TOTALS);
  });
CASE
python3 - server/test/measure-history.test.ts "$SCRATCH/o52-case.ts" <<'PY'
import sys
p, case = sys.argv[1], open(sys.argv[2]).read()
s = open(p).read()
anchor = "});\n\ndescribe('measure-history.py: read-only, and a missing input is refused, never created', () => {\n"
assert s.count(anchor) == 1, s.count(anchor)
open(p, 'w').write(s.replace(anchor, '\n' + case + anchor))
PY
rm -rf "$SCRATCH"
```

The case is a sibling of Task 1's raw-row case in the same describe. It uses `t3Gate` and `t3Planted` from (b), which are module-level; its callback runs only after the module has loaded.

(b) **End-append** at the end of the file:

```ts

// ── W2-3 Task 3: windows over assistant turns, and the two copy rules (W2-D14, W2-D15, W2-D16, W2-D17) ─────────────
// END-APPENDED. measure-history.py emits raw rows (Task 1) and deploy/history-gate.mjs builds every window in Node
// (D-5770): K = 10 assistant TURNS, rows grouped by msg_id ?? request_id ?? uuid, an angle-bracketed model's row
// dropped and a null-model row kept; open at the boundary's ts inclusive; end EXCLUSIVE at the earlier of turn 11's
// first row and the next main boundary, else INCLUSIVE at the copy's last timed row; unmeasured when the row cap cut
// the copy before turn 11 was seen, when the copy has no timed row, or (chosen) when a row that would end the window
// has no ts. The window reads W1's longest copy, the producer lib.pickHoldingCopy's (D-5771). Every store below is a
// fixture HOME that createStore made, read by the real script under -I -B; turnStore is plantedStore's sibling.

/** One assistant row as measure-history.py emits it: [line, ts_ms, msg_id, request_id, uuid, model]. */
type T3RawRow = [number, number | null, string | null, string | null, string, string | null];
/** One call: [ts_ms, rc, verb]. */
type T3Call = [number, number, string];
interface T3Copy {
  file_id: number; source_key: string; boundary_line: number; after_count: number; summary_line: number | null;
  next_boundary_line: number | null; next_boundary_ts_ms: number | null; last_ts_ms: number | null;
  rows: T3RawRow[]; models: Array<string | null>; truncated: boolean;
}
interface T3Boundary { boundary_uuid: string; ts_ms: number; copies: T3Copy[] }
interface T3Family { ccrc_id: string; generation: string; found: boolean; merged_generations: string[]; calls: T3Call[]; boundaries: T3Boundary[] }
interface T3Window {
  boundary_uuid: string; ts_ms: number; producer: 'anthropic' | 'other' | 'unknown'; state: 'measured' | 'unmeasured';
  start_ms: number; end_ms: number | null; end_inclusive: boolean; turns: number; calls: number; with_call: boolean;
}
/** The names Task 3 adds to deploy/history-gate.mjs, and the three of Task 2's it reads. */
interface T3Gate {
  K: number; ROW_CAP: number; WINDOW_STATES: readonly string[];
  turnKey(row: T3RawRow): string;
  turnsOf(rows: T3RawRow[]): Array<{ key: string; first_line: number; first_ts_ms: number | null; rows: T3RawRow[] }>;
  windowCopyOf(copies: T3Copy[]): T3Copy | null;
  producerCopyOf(copies: T3Copy[]): T3Copy | null;
  producerOfBoundary(copies: T3Copy[]): 'anthropic' | 'other' | 'unknown';
  windowOf(boundary: T3Boundary, calls: T3Call[], k?: number): T3Window;
  buildWindows(family: T3Family, k?: number): T3Window[];
  windowTotals(windows: T3Window[]): { windows: number; with_call: number; calls: number; turns: number; unmeasured: number };
  splitAtFirstExit8(calls: T3Call[]): { upTo: T3Call[]; after: T3Call[] };
}
const t3Gate = async (): Promise<T3Gate> => (await import('../../deploy/history-gate.mjs')) as unknown as T3Gate;

/** One entry of turnStore's main transcript. */
interface T3Row { type: 'assistant' | 'user' | 'system'; ts: number | null; msg?: string | null; req?: string | null; model?: string | null; summary?: boolean; boundary?: boolean }
/** One copy of that transcript: its rows as indexes into the entries, in file order. */
interface T3CopyPlan { source_key?: string; lines: readonly number[] }
const T3_ID = 'demo-t3';
const T3_GEN = '0189abcd-1234-5678-9abc-0123456789f3';
const T3_SID = '33333333-4444-4555-8666-777777777777';
const t3B = (ts: number | null): T3Row => ({ type: 'system', ts, boundary: true });
const t3S = (ts: number | null): T3Row => ({ type: 'user', ts, summary: true });
const t3A = (ts: number | null, msg: string | null, model: string | null = 'claude-fixture-a', req: string | null = null): T3Row =>
  ({ type: 'assistant', ts, msg, req, model });
/** `n` one-row turns from `t0`, `step` apart, each with its own msg_id. */
const t3Turns = (n: number, t0: number, step = 100): T3Row[] => Array.from({ length: n }, (_, i) => t3A(t0 + i * step, `m${t0 + i * step}`));
/** Turn 10 is two rows (2000, 2010); turn 11 opens at 2100. */
const T3_TEN_SPLIT = (): T3Row[] => [t3B(1000), t3S(1001), ...t3Turns(9, 1100), t3A(2000, 'm10'), t3A(2010, 'm10'), t3A(2100, 'm11'), t3A(2200, 'm12')];
/** P1: B1's only non-unknown model lies after the next main boundary. */
const T3_P1 = (): T3Row[] => [t3B(1000), t3S(1001), t3A(1100, 'm1', null), t3A(1200, 'm2', '<synthetic>'), t3B(2000), t3S(2001), t3A(2100, 'm3', 'claude-fixture-a')];
/** P2: the only non-unknown model is the 4th row, past a row cap of 2; no next boundary. */
const T3_P2 = (): T3Row[] => [t3B(1000), t3S(1001), t3A(1100, 'm1', null), t3A(1200, 'm2', null), t3A(1300, 'm3', null), t3A(1400, 'm4', 'other-fixture-b')];
/** P3: a retired copy (source_key 'seg-1', the smaller file_id) holds one row more than the live copy. */
const T3_P3 = (): T3Row[] => [t3B(1000), t3S(1001), t3A(1100, 'm1', null), t3A(1200, 'm2', 'claude-fixture-a')];
const T3_P3_COPIES: readonly T3CopyPlan[] = [{ source_key: 'seg-1', lines: [0, 1, 2, 3] }, { lines: [0, 1, 2] }];

/** A store createStore made, holding ONE family, listed in `families`, whose one main transcript holds `rows` (entry uuids
 *  `t3-<index>`). `copies` are its ingest files, each a list of row indexes in file order (default: one live copy of every
 *  row). Each boundary's anchor_uuid is its own uuid, so derive's summary pick is the first compact summary after it, the
 *  row Task 1 reads. `calls` are the family's recall_calls rows, arm NULL. */
function turnStore(rows: T3Row[], calls: T3Call[] = [], copies: readonly T3CopyPlan[] = [{ lines: rows.map((_, i) => i) }]): { db: string; families: string } {
  const home = mkTmp('ccrc-measure-history-t3-');
  const { storeId } = createStore(home);
  const dbPath = path.join(home, '.ccrc', 'history', 'db', 'history.db');
  const db = new DatabaseSync(dbPath);
  try {
    for (const t of ['counters', 'ticks', 'recall_calls']) db.exec(`DELETE FROM ${t}`);
    const ins = (sql: string, ...p: Array<string | number | null | Uint8Array>): number => Number(db.prepare(sql).run(...p).lastInsertRowid);
    const blob = ins("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', NULL, 0)",
      createHash('sha256').update('measure-history t3 fixture').digest());
    const pk = ins('INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms, merged_into) VALUES (?, ?, ?, ?, NULL)', T3_ID, T3_GEN, 'demo', 1);
    ins("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, 1, ?, 'startup', 'hook', 1)", pk, T3_SID);
    const tpk = ins("INSERT INTO transcripts (cc_session_uuid, agent_id) VALUES (?, '')", T3_SID);
    const ids = rows.map((r, i) => ins('INSERT INTO entries (uuid, transcript_pk, type, ts_ms, is_compact_summary, model, msg_id, request_id, '
      + 'provenance, prov_version, struct_rank_ns, struct_file_id, blob_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?)',
    `t3-${i}`, tpk, r.type, r.ts, r.summary === true ? 1 : 0, r.model ?? null, r.msg ?? null, r.req ?? null,
    r.type === 'assistant' ? 'model' : r.summary === true ? 'summary' : 'harness', blob));
    let ord = 0;
    rows.forEach((r, i) => {
      if (r.boundary === true) ins('INSERT INTO boundaries (entry_id, transcript_pk, ord, anchor_uuid) VALUES (?, ?, ?, ?)', ids[i]!, tpk, ++ord, `t3-${i}`);
    });
    copies.forEach((c, k) => {
      const fid = ins("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, status, parser_version) VALUES (1, ?, ?, ?, 'live', 1)", 300 + k, c.source_key ?? '', tpk);
      c.lines.forEach((i, at) => ins('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)', fid, ids[i]!, at + 1));
    });
    calls.forEach(([ts, rc, verb], k) => ins('INSERT INTO recall_calls (event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm) VALUES (?, ?, ?, ?, ?, ?, 40, NULL)',
      `t3k${k}`, T3_ID, T3_GEN, ts, verb, rc));
  } finally {
    db.close();
  }
  const families = path.join(home, 'families.json');
  writeFileSync(families, JSON.stringify([{ store_id: storeId, ccrc_id: T3_ID, generation: T3_GEN }]));
  return { db: dbPath, families };
}

/** turnStore's family, through `script` (the real one by default) over every time, at `rowCap`. */
function t3Family(s: { db: string; families: string }, rowCap = 400, script = SCRIPT): T3Family {
  const r = spawnSync('python3', [...PY_ISOLATED, script, '--db', s.db, '--families', s.families, '--window-start', '0', '--window-end', '1000000',
    '--row-cap', String(rowCap)], { encoding: 'utf8', env: { ...scrubbedEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
  expect(r.status, r.stderr).toBe(0);
  const fams = (JSON.parse(r.stdout) as { w2: { families: T3Family[] } }).w2.families;
  expect(fams.map((x) => [x.ccrc_id, x.found])).toEqual([[T3_ID, true]]);
  return fams[0]!;
}

/** The planted fixture's listed family through the real script over [1500, 6000), O52's own window. */
function t3Planted(f: Planted, rowCap: number): T3Family {
  const fams = (report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000',
    '--row-cap', String(rowCap)]) as unknown as { w2: { families: T3Family[] } }).w2.families;
  expect(fams.map((x) => x.ccrc_id), 'demo-b is listed under another store').toEqual(['demo-a']);
  return fams[0]!;
}

/** derive.mjs:313-316's producer for one boundary, composed as derive composes it: holdingCopyOf's copy, its rows in file
 *  order, lib.summaryRowFor's pick (else the boundary row) and lib.producerOfCopy. Opens the store read-only. */
async function t3DeriveProducer(dbPath: string, uuid: string): Promise<{ fileId: number | null; producer: string }> {
  const D = (await import('../../ccd/history/derive.mjs')) as unknown as {
    holdingCopyOf(db: DatabaseSync, b: { entry_id: number; transcript_pk: number }): { file_id: number } | null;
  };
  const L = await import('../../ccd/history/lib.mjs');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const b = db.prepare('SELECT b.entry_id AS entry_id, b.transcript_pk AS transcript_pk, b.anchor_uuid AS anchor_uuid FROM boundaries b '
      + 'JOIN entries e ON e.entry_id = b.entry_id WHERE e.uuid = ?').get(uuid) as { entry_id: number; transcript_pk: number; anchor_uuid: string | null };
    const copy = D.holdingCopyOf(db, b);
    if (copy === null) return { fileId: null, producer: 'unknown' };
    const rows = db.prepare('SELECT e.uuid AS uuid, e.type AS type, e.model AS model, e.provenance AS provenance, e.is_compact_summary AS cs '
      + 'FROM memberships m JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? ORDER BY m.line')
      .all(copy.file_id) as Array<{ uuid: string; type: string; model: string | null; provenance: string; cs: number }>;
    const pick = L.summaryRowFor({ boundaryUuid: uuid, anchorUuid: b.anchor_uuid,
      rows: rows.map((r) => ({ uuid: r.uuid, isCompactSummary: r.cs === 1, isEcho: r.type === 'user' && r.provenance === 'harness' })) });
    return { fileId: Number(copy.file_id), producer: L.producerOfCopy(rows, rows.findIndex((r) => r.uuid === (pick.uuid ?? uuid))) };
  } finally {
    db.close();
  }
}

describe('W2-3 Task 3: windows over assistant turns', () => {
  /** A window as [state, start, end, end inclusive, turns, calls]. */
  const W = (ws: T3Window[]): unknown[] => ws.map((w) => [w.state, w.start_ms, w.end_ms, w.end_inclusive, w.turns, w.calls]);

  it('RP6: three rows sharing a msg_id are one turn, so turn 11 is the 12th turn and a call at 1950 is inside; the window holds K turns, not every turn seen', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), t3A(1100, 'm1'), t3A(1110, 'm1'), t3A(1120, 'm1'), ...t3Turns(11, 1200)], [[1950, 0, 'expand']]));
    const turns = g.turnsOf(fam.boundaries[0]!.copies[0]!.rows);
    expect(turns.map((t) => t.rows.length)).toEqual([3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(turns[0]).toMatchObject({ key: 'm1', first_line: 3, first_ts_ms: 1100 });
    expect(W(g.buildWindows(fam))).toEqual([['measured', 1000, 2100, false, 10, 1]]);
  });

  it('RP6: a call between turn 10 and turn 11 is inside: after turn 10\'s last row, before turn 11\'s first', async () => {
    const g = await t3Gate();
    expect(W(g.buildWindows(t3Family(turnStore(T3_TEN_SPLIT(), [[2050, 0, 'expand']]))))).toEqual([['measured', 1000, 2100, false, 10, 1]]);
  });

  it('RP6: the 11th-turn case: a call at turn 11\'s first ts is outside, one a millisecond earlier inside', async () => {
    const g = await t3Gate();
    expect(W(g.buildWindows(t3Family(turnStore(T3_TEN_SPLIT(), [[2099, 0, 'expand'], [2100, 0, 'expand']]))))).toEqual([['measured', 1000, 2100, false, 10, 1]]);
  });

  it('RP6: a <synthetic> row is not a turn, and the script hands it to Node unread', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(5, 1100), t3A(1550, 'syn', '<synthetic>'), ...t3Turns(7, 1600)], [[2050, 0, 'expand']]));
    expect(fam.boundaries[0]!.copies[0]!.rows.map((r) => r[5]), 'CONTROL: the row reaches Node').toContain('<synthetic>');
    expect(W(g.buildWindows(fam))).toEqual([['measured', 1000, 2100, false, 10, 1]]);
  });

  it('RP6: two boundaries three turns apart: a call after the second counts once, in the second window', async () => {
    const g = await t3Gate();
    const ws = g.buildWindows(t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(3, 1100), t3B(2000), t3S(2001), ...t3Turns(3, 2100)], [[2150, 0, 'expand']])));
    expect(W(ws)).toEqual([['measured', 1000, 2000, false, 3, 0], ['measured', 2000, 2300, true, 3, 1]]);
    expect(g.windowTotals(ws)).toEqual({ windows: 2, with_call: 1, calls: 1, turns: 6, unmeasured: 0 });
  });

  it('RP6: a copy the row cap cut before turn 11 is unmeasured even with a later next boundary; the next window is measured', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(12, 1100), t3B(3000), t3S(3001), t3A(3100, 'm3100')], [[1500, 0, 'expand']]), 5);
    expect(fam.boundaries[0]!.copies[0]!, 'CONTROL: cut at 5 rows, with a timed next boundary').toMatchObject({ truncated: true, next_boundary_line: 15, next_boundary_ts_ms: 3000 });
    expect(fam.boundaries[0]!.copies[0]!.rows).toHaveLength(5);
    const ws = g.buildWindows(fam);
    expect(W(ws)).toEqual([['unmeasured', 1000, null, false, 0, 0], ['measured', 3000, 3100, true, 1, 0]]);
    expect(g.windowTotals(ws)).toEqual({ windows: 1, with_call: 0, calls: 0, turns: 1, unmeasured: 1 });
    for (const w of ws) expect(g.WINDOW_STATES).toContain(w.state);
  });

  it('RP6 (W2-D17): a null-model row is a turn; only an angle-bracketed model drops its row', async () => {
    const g = await t3Gate();
    const fam = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(4, 1100), t3A(1500, 'm1500', null), ...t3Turns(7, 1600)], [[2150, 0, 'expand']]));
    expect(W(g.buildWindows(fam))).toEqual([['measured', 1000, 2100, false, 10, 0]]);
  });

  it('chosen: a window whose ending row has no ts is unmeasured, whether that row is turn 11\'s first or the next main boundary', async () => {
    const g = await t3Gate();
    const a = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(10, 1100), t3A(null, 'm11'), t3A(2200, 'm12')]));
    expect(W(g.buildWindows(a))).toEqual([['unmeasured', 1000, null, false, 0, 0]]);
    const b = t3Family(turnStore([t3B(1000), t3S(1001), ...t3Turns(2, 1100), t3B(null), t3S(null), t3A(1300, 'm1300')]));
    expect(b.boundaries[0]!.copies[0]!, 'CONTROL: the next boundary is seen, untimed').toMatchObject({ next_boundary_line: 5, next_boundary_ts_ms: null });
    expect(W(g.buildWindows(b))).toEqual([['unmeasured', 1000, null, false, 0, 0]]);
  });

  it('chosen: a boundary with no summary of its own, whose summary search lands past the next main boundary, is unmeasured, never a 0-turn window running to that boundary', async () => {
    const g = await t3Gate();
    // B1 (line 1) has no summary; its twelve turns run 1100 to 2200; B2 (line 14) at 3000 has its summary (line 15). W1's
    // search gives B1 the summary at line 15, past line 14, so its rows are empty. A call at 2150, after turn 11's first
    // row (2100), lies outside any first-K-turns window, and a window that ran to B2 would count it.
    const fam = t3Family(turnStore([t3B(1000), ...t3Turns(12, 1100), t3B(3000), t3S(3001), t3A(3100, 'm3100')], [[2150, 0, 'expand']]));
    expect(fam.boundaries[0]!.copies[0]!, 'CONTROL: B1 reads B2\'s summary, past B2').toMatchObject({ summary_line: 15, next_boundary_line: 14, next_boundary_ts_ms: 3000, truncated: false });
    expect(fam.boundaries[0]!.copies[0]!.rows, 'CONTROL: so its rows are empty').toHaveLength(0);
    const ws = g.buildWindows(fam);
    expect(W(ws)).toEqual([['unmeasured', 1000, null, false, 0, 0], ['measured', 3000, 3100, true, 1, 0]]);
    expect(g.windowTotals(ws)).toEqual({ windows: 1, with_call: 0, calls: 0, turns: 1, unmeasured: 1 });
  });

  it('turnKey is msg_id, then request_id, then uuid; consecutive rows with one key are one turn', async () => {
    const g = await t3Gate();
    expect(g.turnKey([1, 1, 'm', 'r', 'u', null])).toBe('m');
    expect(g.turnKey([1, 1, null, 'r', 'u', null])).toBe('r');
    expect(g.turnKey([1, 1, null, null, 'u', null])).toBe('u');
    expect(g.turnsOf([[1, 1, null, 'r', 'u1', null], [2, 2, null, 'r', 'u2', null], [3, 3, null, null, 'u3', null]]).map((t) => t.key)).toEqual(['r', 'u3']);
  });

  it('copy rules: the window copy has the greatest after_count and ties go to pickHoldingCopy (live, then the smaller file_id); the producer copy is pickHoldingCopy over all', async () => {
    const g = await t3Gate();
    const c = (file_id: number, source_key: string, after_count: number): T3Copy => ({ file_id, source_key, boundary_line: 1, after_count,
      summary_line: null, next_boundary_line: null, next_boundary_ts_ms: null, last_ts_ms: 1, rows: [], models: [], truncated: false });
    expect(g.windowCopyOf([c(1, 'seg-1', 5), c(2, '', 5), c(3, '', 3)])?.file_id, 'a tie: the live copy').toBe(2);
    expect(g.windowCopyOf([c(4, '', 1), c(3, '', 1)])?.file_id, 'a tie of live copies: the smaller file_id').toBe(3);
    expect(g.windowCopyOf([c(1, '', 2), c(2, 'seg-1', 9)])?.file_id, 'the longest, though retired').toBe(2);
    expect(g.producerCopyOf([c(1, 'seg-1', 9), c(3, '', 1), c(2, '', 0)])?.file_id, 'live, then the smaller file_id, whatever the length').toBe(2);
    expect(g.windowCopyOf([])).toBeNull();
    expect(g.producerCopyOf([])).toBeNull();
  });

  it('no timed row, no copy, a family not found: an unmeasured window or none, never a guessed end', async () => {
    const g = await t3Gate();
    const untimed: T3Copy = { file_id: 1, source_key: '', boundary_line: 1, after_count: 0, summary_line: null, next_boundary_line: null,
      next_boundary_ts_ms: null, last_ts_ms: null, rows: [], models: [], truncated: false };
    const w = g.windowOf({ boundary_uuid: 'u-1', ts_ms: 1000, copies: [untimed] }, [[1000, 0, 'expand']]);
    expect(w).toEqual({ boundary_uuid: 'u-1', ts_ms: 1000, producer: 'unknown', state: 'unmeasured', start_ms: 1000, end_ms: null,
      end_inclusive: false, turns: 0, calls: 0, with_call: false });
    expect(g.windowOf({ boundary_uuid: 'u-2', ts_ms: 1000, copies: [] }, []).state).toBe('unmeasured');
    expect(g.buildWindows({ ccrc_id: T3_ID, generation: T3_GEN, found: false, merged_generations: [], calls: [], boundaries: [] })).toEqual([]);
    expect(g.windowTotals([w])).toEqual({ windows: 0, with_call: 0, calls: 0, turns: 0, unmeasured: 1 });
  });

  it('splitAtFirstExit8: the calls up to and including the first exit 8, and the rest apart (spec 10.2:2722, :2728)', async () => {
    const g = await t3Gate();
    const lib = await import('../../ccd/history/lib.mjs');
    const r8 = lib.EXIT.RECALL_OFF;
    expect(r8).toBe(8);
    expect(g.splitAtFirstExit8([[1, 0, 'grep'], [2, r8, 'expand'], [3, r8, 'grep'], [4, 0, 'grep']]))
      .toEqual({ upTo: [[1, 0, 'grep'], [2, r8, 'expand']], after: [[3, r8, 'grep'], [4, 0, 'grep']] });
    expect(g.splitAtFirstExit8([[1, 0, 'grep']])).toEqual({ upTo: [[1, 0, 'grep']], after: [] });
    expect(g.splitAtFirstExit8([])).toEqual({ upTo: [], after: [] });
  });

  it('RA-10 parity: producerOfBoundary over the script\'s output equals derive\'s producerOfCopy over holdingCopyOf\'s copy, and both read one file', async () => {
    const g = await t3Gate();
    const planted = plantedStore();
    const p1 = turnStore(T3_P1());
    const p2 = turnStore(T3_P2());
    const p3 = turnStore(T3_P3(), [], T3_P3_COPIES);
    const cases: Array<[string, string, T3Family]> = [['planted', planted.db, t3Planted(planted, g.ROW_CAP)], ['P1', p1.db, t3Family(p1)],
      ['P2', p2.db, t3Family(p2, 2)], ['P3', p3.db, t3Family(p3)]];
    const seen: string[] = [];
    for (const [name, db, fam] of cases) {
      for (const b of fam.boundaries) {
        const d = await t3DeriveProducer(db, b.boundary_uuid);
        expect(g.producerOfBoundary(b.copies), `${name} ${b.boundary_uuid}`).toBe(d.producer);
        expect(g.producerCopyOf(b.copies)?.file_id, `${name} ${b.boundary_uuid}`).toBe(d.fileId);
        seen.push(`${name}:${d.producer}`);
      }
    }
    expect(seen, 'CONTROL: every backend word is exercised').toEqual(['planted:unknown', 'planted:unknown', 'P1:anthropic', 'P1:anthropic', 'P2:other', 'P3:unknown']);
  });

  it('producer CONTROL: the witness after the next main boundary (P1) and past the row cap (P2) is read; a script whose models stop at its rows loses both', async () => {
    const g = await t3Gate();
    const src = readFileSync(SCRIPT, 'utf8');
    const MAIN = "if __name__ == '__main__':";
    expect(src.split(MAIN).length - 1, 'one entry guard to plant the mutant above').toBe(1);
    const mutant = path.join(mkTmp('ccrc-measure-history-t3-mutant-'), 'measure-history.py');
    writeFileSync(mutant, src.replace(MAIN, [
      '_t3_copy_record = copy_record',
      '',
      '',
      'def copy_record(*a, **kw):   # the mutant: a copy\'s models read from its capped rows, which stop at the next main boundary',
      '    c = _t3_copy_record(*a, **kw)',
      "    c['models'] = list(dict.fromkeys(r[5] for r in c['rows']))",
      '    return c',
      '',
      '',
      MAIN,
    ].join('\n')));
    const p1 = turnStore(T3_P1());
    const p2 = turnStore(T3_P2());
    const real1 = t3Family(p1).boundaries[0]!.copies[0]!;
    const real2 = t3Family(p2, 2).boundaries[0]!.copies[0]!;
    expect(real1.rows.map((r) => r[5]), 'CONTROL: no witness before the next boundary').toEqual([null, '<synthetic>']);
    expect(real1.models).toEqual([null, '<synthetic>', 'claude-fixture-a']);
    expect(real2.rows.map((r) => r[5]), 'CONTROL: no witness under the cap').toEqual([null, null]);
    expect(real2).toMatchObject({ truncated: true, models: [null, 'other-fixture-b'] });
    expect([g.producerOfBoundary([real1]), g.producerOfBoundary([real2])]).toEqual(['anthropic', 'other']);
    const mut1 = t3Family(p1, 400, mutant).boundaries[0]!.copies[0]!;
    const mut2 = t3Family(p2, 2, mutant).boundaries[0]!.copies[0]!;
    expect([g.producerOfBoundary([mut1]), g.producerOfBoundary([mut2])], 'the mutant script loses both witnesses').toEqual(['unknown', 'unknown']);
  });

  it('copy rules disagree (D-5771): on planted B1 the window reads the longest copy and the producer pickHoldingCopy\'s; on P3 the window reads a longer retired copy', async () => {
    const g = await t3Gate();
    const f = plantedStore();
    const fam = t3Planted(f, g.ROW_CAP);
    const b1 = fam.boundaries.find((b) => b.boundary_uuid === f.b1)!;
    expect(b1.copies.map((c) => c.after_count).sort((x, y) => x - y), 'CONTROL: two live copies hold B1').toEqual([1, 22]);
    const win = g.windowCopyOf(b1.copies)!;
    const prod = g.producerCopyOf(b1.copies)!;
    expect([win.after_count, prod.after_count]).toEqual([22, 1]);
    expect(prod.file_id, 'both live, so pickHoldingCopy takes the smaller file_id').toBeLessThan(win.file_id);
    expect(W([g.windowOf(b1, fam.calls)])).toEqual([['measured', 2000, 4000, false, 10, 3]]);
    const p3 = t3Family(turnStore(T3_P3(), [], T3_P3_COPIES)).boundaries[0]!;
    expect(g.windowCopyOf(p3.copies)?.source_key, 'the longest copy, though retired').toBe('seg-1');
    expect(g.producerCopyOf(p3.copies)?.source_key, 'the live copy').toBe('');
    expect(W([g.windowOf(p3, [])])).toEqual([['measured', 1000, 1200, true, 2, 0]]);
    expect(g.producerOfBoundary(p3.copies)).toBe('unknown');
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 3')
```

Expected: red, `17 failed`, and every other case of the file skipped. Each case fails with a `TypeError` naming a function this task has not yet written: `g.buildWindows is not a function` (9), `g.producerOfBoundary is not a function` (2), `g.windowCopyOf is not a function` (2), and one each for `g.turnKey`, `g.turnsOf`, `g.windowOf` and `g.splitAtFirstExit8`.

This was measured (16 failed; the summary-less boundary case, P4, was added after and is predicted) in a scratch mirror of 7d01973a2: Task 2's three names stood in, and so did a stand-in for Task 1's emission written to Task 1's scope. Against the real Task 1 it is predicted. The cases that run the script first still reach the gate call and fail there, so a red here never comes from a fixture.

- [ ] **Step 4: Write the window builder.** Append at the END of `deploy/history-gate.mjs`:

```js

// ── W2-3 Task 3: turns, windows and the two copy rules (W2-D14, W2-D15, W2-D16, W2-D17; D-5770, D-5771) ───────────
// measure-history.py emits raw rows and spells no K, no turn rule and no model test (W2-D13, D-5772); every window
// decision is this section's. A window is the first K assistant TURNS after a main boundary (ruled Q14, W2-D14):
//   a turn     the window copy's assistant rows in file order, with an angle-bracketed model's row dropped, and
//              consecutive rows with one turnKey (msg_id ?? request_id ?? uuid) grouped; a null-model row stays a
//              turn (W2-D17);
//   it opens   at the boundary's ts_ms, inclusive;
//   it ends    EXCLUSIVE at the earlier of turn K+1's first row's ts_ms and the next main boundary's ts_ms in that
//              copy; with neither, INCLUSIVE at the copy's last timed row;
//   unmeasured when the copy has no timed row; when the row cap cut the copy and turn K+1's first row was not seen,
//              whether or not a next boundary exists (the true turn K+1 may lie between the cap and that boundary);
//              and, chosen by W2-3's plan, when a row that would end the window has a null ts_ms.
// The two copy rules (W2-D15, D-5771): the window reads W1's longest copy (the greatest after_count, ties by lib's
// rule); the producer reads lib.pickHoldingCopy's copy, the one derive.mjs:316 reads, and folds that copy's `models`
// (every assistant row after the summary to the end of the copy, uncapped) through lib.producerOf (W2-D16).
// W2-6 imports turnsOf for its re-discovery unit.

/** @typedef {[number, number|null, string|null, string|null, string, string|null]} RawRow
 *  One assistant entry as measure-history.py emits it: [line, ts_ms, msg_id, request_id, uuid, model]. */
/** @typedef {[number, number, string]} CallRow  One recall_calls row with arm NULL: [ts_ms, rc, verb]. */
/** @typedef {{file_id: number, source_key: string, boundary_line: number, after_count: number,
 *    summary_line: number|null, next_boundary_line: number|null, next_boundary_ts_ms: number|null,
 *    last_ts_ms: number|null, rows: RawRow[], models: Array<string|null>, truncated: boolean}} Copy
 *  One copy holding a boundary (W2-D13). */
/** @typedef {{boundary_uuid: string, ts_ms: number, copies: Copy[]}} BoundaryReport */
/** @typedef {{ccrc_id: string, generation: string, found: boolean, merged_generations: string[],
 *    calls: CallRow[], boundaries: BoundaryReport[]}} FamilyReport */
/** @typedef {{key: string, first_line: number, first_ts_ms: number|null, rows: RawRow[]}} Turn */
/** @typedef {{boundary_uuid: string, ts_ms: number, producer: 'anthropic'|'other'|'unknown',
 *    state: 'measured'|'unmeasured', start_ms: number, end_ms: number|null, end_inclusive: boolean,
 *    turns: number, calls: number, with_call: boolean}} Window */

/** TEMPORARY (W2-D17): Claude Code's own notices carry an angle-bracketed model name and are no backend's turn.
 *  W2-1 extracts lib's isSyntheticModel, has backendOf use it, and rewires this file to import it in place of this
 *  module-local test. A null or empty model is not synthetic: that row stays a turn.
 *  @param {string|null} model @returns {boolean} */
function isSyntheticLocal(model) {
  return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');
}

/** One API response's key (W2-D14): msg_id, else request_id, else the entry's own uuid.
 *  @param {RawRow} row @returns {string} */
export function turnKey(row) {
  return row[2] ?? row[3] ?? row[4];
}

/** A copy's assistant turns in file order (W2-D14): synthetic rows dropped, consecutive rows with one key grouped.
 *  @param {RawRow[]} rows @returns {Turn[]} */
export function turnsOf(rows) {
  /** @type {Turn[]} */
  const turns = [];
  for (const row of rows) {
    if (isSyntheticLocal(row[5])) continue;
    const key = turnKey(row);
    const last = turns.length === 0 ? null : turns[turns.length - 1];
    if (last !== null && last.key === key) last.rows.push(row);
    else turns.push({ key, first_line: row[0], first_ts_ms: row[1], rows: [row] });
  }
  return turns;
}

/** lib.pickHoldingCopy among copies that each hold the boundary: a live one (source_key '') first, then the
 *  smaller file_id. @param {Copy[]} copies @returns {Copy|null} */
function holdingCopyAmong(copies) {
  const id = pickHoldingCopy(copies.map((c) => ({ fileId: c.file_id, live: c.source_key === '', holds: true })));
  return id === null ? null : copies.find((c) => c.file_id === id) ?? null;
}

/** The WINDOW's copy (W2-D15): W1's longest-copy rule, the copy with the most membership rows after the boundary,
 *  so a swap's continued copy is read rather than the one left behind; ties go to lib's rule. Null when no copy
 *  holds the boundary. @param {Copy[]} copies @returns {Copy|null} */
export function windowCopyOf(copies) {
  if (copies.length === 0) return null;
  const most = Math.max(...copies.map((c) => c.after_count));
  return holdingCopyAmong(copies.filter((c) => c.after_count === most));
}

/** The PRODUCER's copy (W2-D15, D-5771): lib.pickHoldingCopy over every copy, the copy derive.mjs:316 reads, so
 *  a window's stratum equals its leaf's producer. @param {Copy[]} copies @returns {Copy|null} */
export function producerCopyOf(copies) {
  return holdingCopyAmong(copies);
}

/** A boundary's producer (W2-D16): lib.producerOf over the producer copy's models, folded here, never in Python.
 *  @param {Copy[]} copies @returns {'anthropic'|'other'|'unknown'} */
export function producerOfBoundary(copies) {
  const c = producerCopyOf(copies);
  return c === null ? 'unknown' : producerOf(c.models);
}

/** One boundary's window over its window copy (W2-D14), with the calls whose ts_ms lies inside it. An unmeasured
 *  window carries end_ms null and no turns or calls, so no total can count it by accident.
 *  @param {BoundaryReport} boundary @param {CallRow[]} calls @param {number} [k] @returns {Window} */
export function windowOf(boundary, calls, k = K) {
  const start = boundary.ts_ms;
  const head = { boundary_uuid: boundary.boundary_uuid, ts_ms: start, producer: producerOfBoundary(boundary.copies) };
  /** @type {Window} */
  const unmeasured = { ...head, state: 'unmeasured', start_ms: start, end_ms: null, end_inclusive: false, turns: 0, calls: 0, with_call: false };
  const copy = windowCopyOf(boundary.copies);
  if (copy === null || copy.last_ts_ms === null) return unmeasured;
  // P4: W1's summary search is not bounded by the next main boundary, so a boundary with no summary of its own reads
  // the next one's; its rows are then empty and its first K turns unseen. Unmeasured, never a 0-turn window to that boundary.
  if (copy.summary_line !== null && copy.next_boundary_line !== null && copy.summary_line > copy.next_boundary_line) return unmeasured;
  const turns = turnsOf(copy.rows);
  const sawNext = turns.length > k;
  if (!sawNext && copy.truncated) return unmeasured;
  /** @type {Array<number|null>} */
  const ends = [];
  if (sawNext) ends.push(turns[k].first_ts_ms);
  if (copy.next_boundary_line !== null) ends.push(copy.next_boundary_ts_ms);
  if (ends.some((t) => t === null)) return unmeasured;
  const inclusive = ends.length === 0;
  const end = inclusive ? copy.last_ts_ms : Math.min(.../** @type {number[]} */ (ends));
  const inside = (/** @type {number} */ ts) => ts >= start && (inclusive ? ts <= end : ts < end);
  const n = calls.filter((c) => inside(c[0])).length;
  return { ...head, state: 'measured', start_ms: start, end_ms: end, end_inclusive: inclusive, turns: Math.min(turns.length, k), calls: n, with_call: n > 0 };
}

/** Every window of one family's report, in its boundaries' order; none for a family the store does not hold.
 *  @param {FamilyReport} family @param {number} [k] @returns {Window[]} */
export function buildWindows(family, k = K) {
  if (!family.found) return [];
  return family.boundaries.map((b) => windowOf(b, family.calls, k));
}

/** The totals O52 pins: measured windows, those with a call, their calls and turns; unmeasured windows counted
 *  apart and never in the others. @param {Window[]} windows
 *  @returns {{windows: number, with_call: number, calls: number, turns: number, unmeasured: number}} */
export function windowTotals(windows) {
  const t = { windows: 0, with_call: 0, calls: 0, turns: 0, unmeasured: 0 };
  for (const w of windows) {
    if (w.state !== 'measured') {
      t.unmeasured += 1;
      continue;
    }
    t.windows += 1;
    t.with_call += w.with_call ? 1 : 0;
    t.calls += w.calls;
    t.turns += w.turns;
  }
  return t;
}

/** A family's ts-ordered calls split at its first exit 8 (spec §10.2:2722, :2728): `upTo` holds every call up to and
 *  including the first rc === EXIT.RECALL_OFF, `after` the rest, reported apart. No exit 8: every call is `upTo`.
 *  @param {CallRow[]} calls @returns {{upTo: CallRow[], after: CallRow[]}} */
export function splitAtFirstExit8(calls) {
  const i = calls.findIndex((c) => c[1] === EXIT.RECALL_OFF);
  return i < 0 ? { upTo: [...calls], after: [] } : { upTo: calls.slice(0, i + 1), after: calls.slice(i + 1) };
}
```

Then check the section against Task 2's purity pin by hand before running it. The section contains none of `process.`, `Date.now`, `new Date`, `Math.random`, `performance.`, `require(` or `import(`. It also never spells the two class words that the purity and class-word guards ban.

- [ ] **Step 5: Run them and see them pass, then the file and the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 3')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- **The filter:** green, `17 passed`, in about 4 s. This was measured (at 16) in the scratch mirror against the stand-in; the summary-less boundary case (P4) is predicted, and against the real Task 1 all of it is predicted.
- **The whole file:** green, including Task 1's raw-row case for O52 and Task 2's purity describe. Task 2's purity pin re-reads the gate source, so it re-checks this section.
- **tsc:** prints nothing. This was measured on the assembled file with `--strict --module NodeNext --allowJs` in the mirror.
  - A line naming only `agent/src/`, or a module that is not installed, comes from the worktree's install, not from this task.
  - A line naming `measure-history.test.ts` or `deploy/history-gate.mjs` is this task's.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block makes one exact replacement, asserted to match once, then runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc. Every red below was measured in the scratch mirror against the stand-in for Task 1. Against the real Task 1 the cases and the selection are the same, and the messages are predicted.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-3/scratch/t3"; mkdir -p "$SCRATCH"   # under the gitignored scratch root, its own subdirectory so the rm -rf below removes only it
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp deploy/history-gate.mjs "$SCRATCH/gate.orig"
T='W2-3 Task 3'
v() { (cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t "$1"); cp "$SCRATCH/gate.orig" deploy/history-gate.mjs; }

# M1: a turn is a row (turnKey reads the uuid alone).
mut deploy/history-gate.mjs "  return row[2] ?? row[3] ?? row[4];" "  return row[4];"
v "$T.*three rows sharing a msg_id"
# RED (measured): 1 failed, expected [ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, …(4) ] to deeply equal [ 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ].

# M2: request_id dropped from the key chain.
mut deploy/history-gate.mjs "  return row[2] ?? row[3] ?? row[4];" "  return row[2] ?? row[4];"
v "$T.*turnKey is msg_id"
# RED (measured): 1 failed, expected 'u' to be 'r'.

# M3: the window ends at turn K's first row, not turn K+1's.
mut deploy/history-gate.mjs "  if (sawNext) ends.push(turns[k].first_ts_ms);" "  if (sawNext) ends.push(turns[k - 1].first_ts_ms);"
v "$T.*between turn 10 and turn 11"
# RED (measured): 1 failed, expected [ [ 'measured', 1000, 2000, …(3) ] ] to deeply equal [ [ 'measured', 1000, 2100, …(3) ] ].

# M4: an exclusive end read inclusive.
mut deploy/history-gate.mjs "(inclusive ? ts <= end : ts < end)" "ts <= end"
v "$T.*11th-turn case|$T: O52 re-pinned"
# RED (measured): 2 failed; the 11th-turn case counts the call at 2100 (calls 2), and O52's totals after the plant
# read calls 6 (k8 at 4000 and k9 at 7000 counted).

# M5: a <synthetic> row counted as a turn.
mut deploy/history-gate.mjs "  return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');" "  return false;"
v "$T.*row is not a turn"
# RED (measured): 1 failed, expected [ [ 'measured', 1000, 2000, …(3) ] ] to deeply equal [ [ 'measured', 1000, 2100, …(3) ] ].

# M6: a null-model row dropped as if synthetic.
mut deploy/history-gate.mjs "  return typeof model === 'string' && model.startsWith('<') && model.endsWith('>');" "  return model === null || (typeof model === 'string' && model.startsWith('<') && model.endsWith('>'));"
v "$T.*null-model row is a turn"
# RED (measured): 1 failed, expected [ [ 'measured', 1000, 2200, …(3) ] ] to deeply equal [ [ 'measured', 1000, 2100, …(3) ] ].

# M7: the next main boundary does not end a window.
mut deploy/history-gate.mjs "  if (copy.next_boundary_line !== null) ends.push(copy.next_boundary_ts_ms);
" ""
v "$T.*three turns apart|$T: O52 re-pinned"
# RED (measured): 2 failed; the first window runs to 2300 inclusive and counts the second window's call, and O52's B2
# runs to 7100 inclusive.

# M8: truncation is unmeasured only when no next boundary exists (the rule W2-D14 rejects).
mut deploy/history-gate.mjs "  if (!sawNext && copy.truncated) return unmeasured;" "  if (!sawNext && copy.truncated && copy.next_boundary_line === null) return unmeasured;"
v "$T.*cut before turn 11"
# RED (measured): 1 failed; the cut window reads measured, ending at the next boundary (3000) with 5 turns and 1 call.

# M9: an untimed ending row read as a time (chosen rule).
mut deploy/history-gate.mjs "  if (ends.some((t) => t === null)) return unmeasured;
" ""
v "$T.*ending row has no ts"
# RED (measured): 1 failed, expected [ [ 'measured', 1000, +0, …(3) ] ] to deeply equal [ [ 'unmeasured', 1000, null, …(3) ] ].

# M10: a copy with no timed row measured.
mut deploy/history-gate.mjs "  if (copy === null || copy.last_ts_ms === null) return unmeasured;" "  if (copy === null) return unmeasured;"
v "$T.*no timed row"
# RED (measured): 1 failed, expected { boundary_uuid: 'u-1', …(9) } to deeply equal { boundary_uuid: 'u-1', …(9) }
# (state measured, end_ms null, end_inclusive true).

# M11: a tie on after_count broken by list order, not lib's rule.
mut deploy/history-gate.mjs "  return holdingCopyAmong(copies.filter((c) => c.after_count === most));" "  return copies.find((c) => c.after_count === most) ?? null;"
v "$T.*ties go to pickHoldingCopy"
# RED (measured): 1 failed, a tie: the live copy: expected 1 to be 2.

# M12: the first exit 8 put after the split.
mut deploy/history-gate.mjs "{ upTo: calls.slice(0, i + 1), after: calls.slice(i + 1) }" "{ upTo: calls.slice(0, i), after: calls.slice(i) }"
v "$T.*first exit 8"
# RED (measured): 1 failed, expected { upTo: [ [ 1, +0, 'grep' ] ], …(1) } to deeply equal { …(2) }.

# M13: every turn seen counted, not at most K.
mut deploy/history-gate.mjs "turns: Math.min(turns.length, k)," "turns: turns.length,"
v "$T.*three rows sharing a msg_id"
# RED (measured): 1 failed; the window reads 12 turns.

# M14: the two copy rules swapped (D-5771).
mut deploy/history-gate.mjs "  const copy = windowCopyOf(boundary.copies);" "  const copy = producerCopyOf(boundary.copies);"
mut deploy/history-gate.mjs "  const c = producerCopyOf(copies);" "  const c = windowCopyOf(copies);"
v "$T.*copy rules disagree|$T: O52 re-pinned"
# RED (measured): 2 failed; planted B1's window reads f2, [ 'measured', 2000, 2001, … ] for [ 'measured', 2000, 4000, … ],
# and O52's windows read [ …(2) ] for theirs.

# M15: the producer reads the window copy (RA-10).
mut deploy/history-gate.mjs "  const c = producerCopyOf(copies);" "  const c = windowCopyOf(copies);"
v "$T.*RA-10 parity"
# RED (measured): 1 failed, P3 t3-0: expected 'anthropic' to be 'unknown'.

# M16: a boundary with no summary of its own measured as a 0-turn window to the next boundary (chosen rule, P4).
mut deploy/history-gate.mjs "  if (copy.summary_line !== null && copy.next_boundary_line !== null && copy.summary_line > copy.next_boundary_line) return unmeasured;
" ""
v "$T.*no summary of its own"
# RED (predicted): 1 failed, expected [ [ 'measured', 1000, 3000, …(3) ], …(1) ] to deeply equal [ [ 'unmeasured', 1000, null, …(3) ], …(1) ]
# (the first window counts the call at 2150). Measured in parts: Task 1's copy_record gives B1 summary_line 15,
# next_boundary_line 14 and no rows, and this section's buildWindows reads that copy as
# [ 'measured', 1000, 3000, false, 0, 1 ] without the guard and [ 'unmeasured', 1000, null, false, 0, 0 ] with it.

git diff --stat -- deploy/history-gate.mjs   # this task's section only (and Task 2's, if not yet committed)
rm -rf "$SCRATCH"
```

The `.py` side's mutant is measured inside the test on every run, and no step here edits the script. The producer CONTROL writes a TMPDIR copy of `measure-history.py` whose `copy_record` takes `models` from its capped, boundary-stopped `rows`. It asserts that the copy loses both witnesses (P1's model after the next boundary, and P2's past a cap of 2) while the real script keeps them. Measured in the mirror: `['unknown', 'unknown']` from the mutant, and `['anthropic', 'other']` from the script.

Then run Step 5's commands once more: green.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts -t 'holdingCopyOf|producer')
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'holdingCopyOf')
```

Expected: green (predicted).
- `single-definition`: O14's DECL_CORPUS scans `deploy/*.mjs` for VOCABS names, and this section declares none. The class-enumeration scan finds no class word in it.
- `history-derive` and `history-card`: this task imports `holdingCopyOf`, `summaryRowFor` and `producerOfCopy` and changes none of them. Their own pins stay as they are.

- [ ] **Step 8: Carry the O52 change into the PR body.** The PR body names the change to W1's pin. Paste this line into its "Departures" or "Pins changed" section:

> O52's W2 half is re-pinned (W2-D14, D-5770; copy rules D-5771). W1's pin read `windows 2, with_call 2, calls 3, assistant_entries 14`: B1 ended inclusive at its 10th assistant entry (3900), and B2 at the copy's last row (7100, past B3). The Node builder reads `windows 2, with_call 2, calls 4, turns 13, unmeasured 0`: B1 runs [2000, 4000) and now takes k3 at 3950, and B2 ends exclusive at B3's row (7000) with 3 turns. Calls planted at exactly 4000 and 7000 fall outside both windows.

- [ ] **Step 9: Commit.**

```bash
git add deploy/history-gate.mjs server/test/measure-history.test.ts
git commit -m "feat(history): W2 windows over assistant turns and the two copy rules in the gate; O52 re-pinned against the Node builder (W2-3 Task 3, D-5771)"
```

### Task 4: Census mode and the families active at W2 open

W2 open is each node's census instant T0 (W2-D20). This task covers the census half of W2-D13 and the pure rule of W2-D20. `measure-history.py` gains a census mode that reads one store as of T0 and decides nothing. For every `sessions` row, merged rows included, it emits:
- the sessions columns;
- the row's last main entry before T0;
- Task 1's raw rows over the look-back;
- a ticks summary.

`history-gate.mjs` gains the rule that decides. A family is **active** iff all three hold:
- **(a)** it is unmerged and its generation matches lib's `UUID_RE`. Legacy `''` families are excluded, and this is fixed (D-5773).
- **(b)** it is its id's newest unmerged family in recall.mjs's `NEWEST_FAMILY_SQL` order. That order is spelled here a second time as `newestFamilyCompare`, and a parity pin holds it equal to recall's.
- **(c)** its last main entry lies in [as_of − look-back, as_of).

Every excluded family carries exactly one `ACTIVE_EXCLUSIONS` reason, and reasons are never folded together. The registry check (`verify --registry`) belongs to W2-5a.

**Files:**
- Modify: `deploy/measure-history.py`. Task 1 has rewritten this file, so re-anchor by the quoted content (Step 1 checks every anchor exists exactly once):
  - the docstring:
    - one usage line directly after the usage line holding `[--families`;
    - one key-table entry directly after the last line of the `w2` entry (its first line begins `  w2 `);
    - one paragraph directly before the docstring's closing paragraph, which begins `Exit 0`;
  - `LAST_MAIN_SQL` and `census_report` directly before `def main():`;
  - in `main`:
    - three `ap.add_argument` lines directly after Task 1's `    ap.add_argument('--row-cap'` line;
    - two refusals directly after `    a = ap.parse_args()`;
    - `'census': None,` directly after `            'w2': None,`;
    - the census fill directly before the two lines `    except sqlite3.Error as e:` / `        fail(f'cannot read {a.db}: {e}')`.
- Modify: `deploy/history-gate.mjs`. One section is appended at the END of the file, after Task 3's.
- Test: `server/test/measure-history.test.ts`:
  - in place: the key-order case (`it('W1-e sits between W1-c and W1-f in the report, …')`). Its last line, `      'w1b_lag_p95_ms', 'w1c_duplicate_entries', 'w1e', 'w1f_grep_p95_ms', 'w2']);`, gains `'census'`;
  - end-appended: one describe, `'W2-3 Task 4: the census and the active rule'`. It reuses the module-level `plantedStore`, `report`, `measure`, `NOW`, `G1`, `G2`, `SCRIPT`, `PY_ISOLATED`, and the existing imports `createStore`, `DatabaseSync`, `createHash`, `mkTmp`, `readFileSync`, `path`, `spawnSync` and `scrubbedEnv`. It adds no import: the gate module and recall.mjs are loaded by dynamic `import()` inside the cases, with a local interface cast, so this task does not depend on how Task 2 names its import of the gate.
- Not edited:
  - `ccd/history/recall.mjs`: `familiesOf` is only called by the parity pin. Its private `NEWEST_FAMILY_SQL` is not moved into lib in W2 (W2-D20).
  - `ccd/history/lib.mjs`: `UUID_RE` is already in Task 2's import block.
  - `server/test/single-definition.test.ts`: it is re-run only.

**Interfaces:**
- Consumes (Task 1, `deploy/measure-history.py`):
  - `family_report(db, ccrc_id, generation, start_ms, end_ms, row_cap) -> dict`. It returns `{ccrc_id, generation, found, merged_generations, calls, boundaries}`:
    - `calls` are `[ts_ms, rc, verb]` for the family's generations, with `arm IS NULL` and `ts_ms >= start_ms` (no upper bound), ordered by `ts_ms` then `event_key`;
    - `boundaries` are the main boundaries in `[start_ms, end_ms)`, each with its copies.
  - `open_db(path)`, `fail(msg)` (exit 2), the `--row-cap` argument (`a.row_cap`), and the report literal holding `'w2': None,`.
  - The report keys, in order: `store_id, user_version, script_sha256, counters, w1b_lag_p95_ms, w1c_duplicate_entries, w1e, w1f_grep_p95_ms, w2`.
  - The `--families` mode's `w2 = {row_cap, window_start_ms, window_end_ms, families: [FamilyReport]}`.
- Consumes (Task 2, `deploy/history-gate.mjs`):
  - `ACTIVE_EXCLUSIONS`, frozen: the four words `merged`, `legacy`, `not-newest`, `no-recent-entry`;
  - `familyKey(storeId, ccrcId, generation) = canonicalJson([storeId, ccrcId, generation])`;
  - `UUID_RE`, from the import block `import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';`.
- Consumes (test only): recall.mjs's exported `familiesOf(db, {kind: 'family', id, generation: null, project: null, workdir: null, workdirReal: null})`. For the id's newest unmerged row by `ORDER BY first_seen_ms DESC, session_pk DESC`, it answers `[{sessionPk, ccrcId, generation, firstSeenMs}]`.
- Produces (Python):
  - `LAST_MAIN_SQL`;
  - `census_report(db, as_of_ms, since_ms, row_cap) -> dict`, which returns `{as_of_ms, since_ms, row_cap, ticks: {n, first_ts_ms, last_ts_ms}, families: [CensusFamily]}`. Each `CensusFamily` is `{ccrc_id, generation, session_pk, merged_into, first_seen_ms, last_main_ts_ms, merged_generations, calls, boundaries}`, in that key order, one per `sessions` row in `session_pk` order;
  - the report key `census`, after `w2`: null without `--census`;
  - the usage errors `--census needs --as-of, --since and --row-cap` and `--census and --families are exclusive`, both exit 2.
- Produces (gate):
  - the JSDoc typedefs `CensusFamily`, `CensusReport` and `FamilyRef = {store_id, ccrc_id, generation}`;
  - `ACTIVE_LOOKBACK_MS = 604800000`;
  - `newestFamilyCompare(a: CensusFamily, b: CensusFamily): number`, negative when `a` is newer;
  - `newestFamilyOf(families: CensusFamily[], ccrcId: string): CensusFamily|null`, over unmerged rows only;
  - `activeFamilies(storeId: string, census: CensusReport, opts?: {lookbackMs?: number}): {active: FamilyRef[], excluded: Array<FamilyRef & {reason: 'merged'|'legacy'|'not-newest'|'no-recent-entry'}>}`, with both lists sorted by `familyKey`;
  - the module-private `exclusionOf(f, newest, from, asOf)`.

**Spec:**
- §10.2 "The live A/B" (:2727, "assigned by coin flip over the families active at W2 open") and "What the analysis counts" (:2732, the `''` mapping through `merged_into`), as W2-D20 restates them;
- §10.2 "The smallest passing point uptake" (:2724), which reads the census.

Departure D-5773 (`history-w2-legacy-families-excluded`) is defined in this plan's "Deviations found". Erratum E16 is amended in the spec by W2-1, not here.

Decisions: W2-D13 (census mode), W2-D20 (the rule, the comparator, the parity pin, legacy `''` excluded and fixed). Cited: W2-D27, W2-D84 (why a legacy control file cannot be written), W2-D21 (Q18 reads this census), W2-D25 (`active_rule.legacy_excluded` is fixed; the validator is Task 9's).

**Choices this task makes:**
- **One reason, the first clause failed.** The order is merged, legacy, not-newest, no-recent-entry. A merged `''` row is `merged`, never `legacy`. A not-newest family without an entry is `not-newest`, never `no-recent-entry`.
- **A legacy row takes part in the newest order, as it does in recall's.** So an id whose newest unmerged row is a legacy `''` row has no active family: its UUID row is `not-newest`. This follows from parity. recall resolves that id to the legacy row, so a recall-off file holding the UUID generation would not be the family recall reads.
- **`last_main_ts_ms` reads the family's own row and the rows merged into it.** This is the scope `family_report` reads. A re-key moves a merged row's epochs to its target (`sweep.mjs`'s merge), so a merged row reads null.
- **Census calls are cut at as_of here.** Task 1's `calls` have no upper bound. A copy's `rows` keep Task 1's line bounds (the next main boundary and `--row-cap`), not a time cut.
- **One read snapshot.** A live store ticks while the census runs, so `census_report` opens one read transaction. Every census query reads it, and `main`'s `db.close()` ends it. A pin measures this with a writer that commits between two reads.
- **The gate refuses a census it cannot read.** It throws a `TypeError` on any of:
  - a `storeId` that is not a UUID;
  - a census without an integer `as_of_ms`;
  - a census without a families list;
  - a look-back that is not a whole, non-negative number of ms.

  A missing `as_of_ms` would otherwise answer every family active.
- **`--as-of` and `--since` are read only with `--census`.** `--since` greater than `--as-of` is not refused: it answers empty raw rows and a zero tick count.

- [ ] **Step 1: Confirm the earlier tasks' names and every anchor before using them.** From the repository root:

```bash
grep -c '^def family_report(db, ccrc_id, generation, start_ms, end_ms, row_cap):$' deploy/measure-history.py
grep -c '^def open_db(path):$' deploy/measure-history.py
grep -c '^def main():$' deploy/measure-history.py
grep -c "^    ap.add_argument('--row-cap'" deploy/measure-history.py
grep -c '^    a = ap.parse_args()$' deploy/measure-history.py
grep -c "^            'w2': None,$" deploy/measure-history.py
grep -c "^        fail(f'cannot read {a.db}: {e}')$" deploy/measure-history.py
grep -c '^  w2 ' deploy/measure-history.py
grep -c '\[--families' deploy/measure-history.py
grep -c '^Exit 0' deploy/measure-history.py
grep -c 'census' deploy/measure-history.py deploy/history-gate.mjs
grep -c "^import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';$" deploy/history-gate.mjs
grep -c '^export const ACTIVE_EXCLUSIONS = ' deploy/history-gate.mjs
grep -c '^export function familyKey(' deploy/history-gate.mjs
grep -c 'FamilyRef\|ACTIVE_LOOKBACK_MS\|newestFamily' deploy/history-gate.mjs
grep -c "      'w1b_lag_p95_ms', 'w1c_duplicate_entries', 'w1e', 'w1f_grep_p95_ms', 'w2'\]);" server/test/measure-history.test.ts
grep -c "it('W1-e sits between W1-c and W1-f in the report" server/test/measure-history.test.ts
python3 -I -B -c "import importlib.util, inspect, sys; spec = importlib.util.spec_from_file_location('mh', sys.argv[1]); mh = importlib.util.module_from_spec(spec); spec.loader.exec_module(mh); print(list(inspect.signature(mh.family_report).parameters))" deploy/measure-history.py
node --input-type=module -e "const g = await import('./deploy/history-gate.mjs'); console.log(JSON.stringify([...g.ACTIVE_EXCLUSIONS].sort()), g.familyKey('s', 'c', ''), Object.isFrozen(g.ACTIVE_EXCLUSIONS))"
```

Expected:
- Every `grep -c` prints 1, except two:
  - the `census` grep prints `deploy/measure-history.py:2` and `deploy/history-gate.mjs:0` (predicted, re-derived at integration: the script's two are W1's, its docstring's first line and the argparse description, which Task 1 keeps; no census flag or function exists yet);
  - the `FamilyRef|ACTIVE_LOOKBACK_MS|newestFamily` grep prints 0.
- The python line prints `['db', 'ccrc_id', 'generation', 'start_ms', 'end_ms', 'row_cap']`.
- The node line prints `["legacy","merged","no-recent-entry","not-newest"] ["s","c",""] true`.

A 0 where 1 is expected, a different signature or a different word set is a gap in Task 1 or Task 2: stop and report it. Never define `ACTIVE_EXCLUSIONS` or `familyKey` here, because Task 2 declares each once. The python line only loads the script: it reads no store and no HOME.

- [ ] **Step 2: Write the failing tests.** In `server/test/measure-history.test.ts`:

(a) In the key-order case, replace the one line

```ts
      'w1b_lag_p95_ms', 'w1c_duplicate_entries', 'w1e', 'w1f_grep_p95_ms', 'w2']);
```

with

```ts
      'w1b_lag_p95_ms', 'w1c_duplicate_entries', 'w1e', 'w1f_grep_p95_ms', 'w2', 'census']);   // W2-3 Task 4: census follows w2, null without --census
```

(b) Append at the end of the file:

```ts

// ── W2-3 Task 4: the census and the active rule (W2-D13 census mode, W2-D20; D-5773 (history-w2-legacy-families-excluded)) ──
// measure-history.py --census emits every sessions row of one store, merged ones included, with its sessions columns,
// its last main entry before --as-of and Task 1's raw rows over [--since, --as-of); it decides nothing.
// history-gate.mjs's activeFamilies applies W2-D20: (a) unmerged with a UUID generation (legacy '' excluded, fixed:
// D-5773); (b) the id's newest unmerged family in recall.mjs's NEWEST_FAMILY_SQL order, spelled in the gate as
// newestFamilyCompare and held equal to recall's by the parity case below; (c) a main entry in
// [as_of - look-back, as_of). Fixture HOMEs only; every id, generation and session uuid is synthetic.
describe('W2-3 Task 4: the census and the active rule', () => {
  const C_AS_OF = 1_800_000_000_000;
  const C_LOOK = 604_800_000;
  const C_SINCE = C_AS_OF - 2 * C_LOOK;
  const C_HOUR = 3_600_000;
  const STORE = '5f0c2d3e-8a1b-4c2d-9e3f-0a1b2c3d4e5f';
  const CG = (n: string): string => `0189abcd-1234-5678-9abc-0123456789${n}`;
  type CallRow = [number, number, string];
  interface CensusFamily {
    ccrc_id: string; generation: string; session_pk: number; merged_into: number | null; first_seen_ms: number;
    last_main_ts_ms: number | null; merged_generations: string[]; calls: CallRow[]; boundaries: unknown[];
  }
  interface Census {
    as_of_ms: number; since_ms: number; row_cap: number;
    ticks: { n: number; first_ts_ms: number | null; last_ts_ms: number | null }; families: CensusFamily[];
  }
  type ReportC = Report & { census: Census | null };
  interface FamilyRef { store_id: string; ccrc_id: string; generation: string }
  interface GateT4 {
    ACTIVE_LOOKBACK_MS: number;
    ACTIVE_EXCLUSIONS: readonly string[];
    newestFamilyCompare(a: CensusFamily, b: CensusFamily): number;
    newestFamilyOf(families: CensusFamily[], ccrcId: string): CensusFamily | null;
    activeFamilies(storeId: string, census: Census, opts?: { lookbackMs?: number }):
      { active: FamilyRef[]; excluded: Array<FamilyRef & { reason: string }> };
  }
  const gateT4 = async (): Promise<GateT4> => (await import('../../deploy/history-gate.mjs')) as unknown as GateT4;
  type Pk = 'tieA' | 'tieB' | 'rekey' | 'rekeyLegacy' | 'legacy' | 'legacyOld' | 'stale' | 'edgeIn' | 'edgeOut' | 'empty';
  interface CensusPlanted { db: string; storeId: string; pk: Record<Pk, number> }

  /** A store createStore made, holding ten sessions rows whose census rows and verdicts are worked out by hand below. */
  function censusStore(): CensusPlanted {
    const home = mkTmp('ccrc-measure-history-census-');
    const { storeId } = createStore(home);
    const dbPath = path.join(home, '.ccrc', 'history', 'db', 'history.db');
    const db = new DatabaseSync(dbPath);
    const pk = {} as Record<Pk, number>;
    try {
      for (const t of ['counters', 'ticks', 'recall_calls']) db.exec(`DELETE FROM ${t}`);
      const ins = (sql: string, ...p: Array<string | number | null | Uint8Array>): number => Number(db.prepare(sql).run(...p).lastInsertRowid);
      const blob = ins("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', NULL, 0)",
        createHash('sha256').update('measure-history census fixture').digest());
      const family = (id: string, gen: string, firstSeen: number, merged: number | null = null): number =>
        ins('INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms, merged_into) VALUES (?, ?, ?, ?, ?)', id, gen, 'demo', firstSeen, merged);
      let u = 0;
      /** An epoch of `sessionPk`, confirmed unless `confirmed` is null; answers its cc_session_uuid. */
      const epoch = (sessionPk: number, seq: number, confirmed: number | null = 1): string => {
        u += 1;
        const uuid = `11111111-2222-4333-8444-${String(u).padStart(12, '0')}`;
        ins("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, ?, ?, 'startup', 'hook', ?)",
          sessionPk, seq, uuid, confirmed);
        return uuid;
      };
      const transcript = (uuid: string, agent = ''): number => ins('INSERT INTO transcripts (cc_session_uuid, agent_id) VALUES (?, ?)', uuid, agent);
      let n = 0;
      const entry = (tpk: number, ts: number): void => {
        n += 1;
        ins('INSERT INTO entries (uuid, transcript_pk, type, ts_ms, is_compact_summary, provenance, prov_version, '
          + "struct_rank_ns, struct_file_id, blob_id) VALUES (?, ?, 'assistant', ?, 0, 'harness', 1, 1, 1, ?)", `c-${n}`, tpk, ts, blob);
      };
      /** A confirmed epoch of `sessionPk` whose main transcript holds entries at `ts`; answers its cc_session_uuid. */
      const main = (sessionPk: number, ...ts: number[]): string => {
        const uuid = epoch(sessionPk, 1);
        const t = transcript(uuid);
        for (const x of ts) entry(t, x);
        return uuid;
      };

      // demo-tie: two unmerged UUID families tied on first_seen_ms; NEWEST_FAMILY_SQL answers the greater session_pk.
      pk.tieA = family('demo-tie', CG('b1'), 5000); main(pk.tieA, C_AS_OF - C_HOUR);
      pk.tieB = family('demo-tie', CG('b2'), 5000); main(pk.tieB, C_AS_OF - C_HOUR);
      // demo-rekey: a UUID family and the '' row a re-key merged into it. The merged row is NEWER by first_seen_ms,
      // so an order that let merged rows take part would answer it (recall's merged_into IS NULL keeps it out).
      pk.rekey = family('demo-rekey', CG('b3'), 6000); main(pk.rekey, C_AS_OF - 2 * C_HOUR);
      pk.rekeyLegacy = family('demo-rekey', '', 7000, pk.rekey);
      // demo-legacy: an unmerged legacy '' family, newest of its id and recent, beside an older recent UUID family.
      pk.legacy = family('demo-legacy', '', 9000); main(pk.legacy, C_AS_OF - C_HOUR);
      pk.legacyOld = family('demo-legacy', CG('b4'), 4000); main(pk.legacyOld, C_AS_OF - C_HOUR);
      // demo-stale: its one confirmed main entry is 1 ms before the look-back. A subagent transcript of that epoch
      // and the main transcript of an UNCONFIRMED epoch each hold an entry an hour before as_of; neither counts.
      pk.stale = family('demo-stale', CG('b5'), 1000);
      const staleUuid = main(pk.stale, C_AS_OF - C_LOOK - 1);
      entry(transcript(staleUuid, 'agent-1'), C_AS_OF - C_HOUR);
      entry(transcript(epoch(pk.stale, 2, null)), C_AS_OF - C_HOUR);
      // The look-back's edges: an entry at exactly as_of - look-back is in; one at exactly as_of is not read at all.
      pk.edgeIn = family('demo-edge-in', CG('b6'), 1000); main(pk.edgeIn, C_AS_OF - C_LOOK);
      pk.edgeOut = family('demo-edge-out', CG('b7'), 1000); main(pk.edgeOut, C_AS_OF - C_LOOK - 10, C_AS_OF);
      // demo-empty: no epoch at all.
      pk.empty = family('demo-empty', CG('b8'), 1000);

      const call = (key: string, gen: string, ts: number, verb: string, rc: number, arm: string | null): void => {
        ins('INSERT INTO recall_calls (event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm) VALUES (?, ?, ?, ?, ?, ?, 40, ?)',
          key, 'demo-tie', gen, ts, verb, rc, arm);
      };
      call('c1', CG('b2'), C_SINCE - 1, 'expand', 0, null);   // before --since
      call('c2', CG('b2'), C_SINCE, 'expand', 0, null);       // at --since: in
      call('c3', CG('b2'), C_AS_OF - 2, 'grep', 0, 'quiz');   // a replay arm's: never a live row
      call('c4', CG('b2'), C_AS_OF - 1, 'grep', 8, null);     // in, rc as recorded
      call('c5', CG('b2'), C_AS_OF, 'expand', 0, null);       // at --as-of: out
      for (const ts of [C_SINCE - 1, C_SINCE, C_AS_OF - 60_000, C_AS_OF]) {
        ins('INSERT INTO ticks (ts_ms, lag_ms, bytes, files_behind, bytes_behind) VALUES (?, 5, 0, 0, 0)', ts);
      }
    } finally {
      db.close();
    }
    return { db: dbPath, storeId, pk };
  }

  const censusArgs = (db: string, asOf = C_AS_OF, since = C_SINCE): string[] =>
    ['--db', db, '--now', String(NOW), '--census', '--as-of', String(asOf), '--since', String(since), '--row-cap', '400'];
  const censusOf = (db: string, asOf = C_AS_OF, since = C_SINCE): Census => {
    const rep = report(censusArgs(db, asOf, since)) as unknown as ReportC;
    expect(rep.census, 'census mode reported no census').not.toBeNull();
    return rep.census!;
  };

  /** A census row for the pure cases: a recent, unmerged UUID family unless `o` says otherwise. */
  const fam = (o: Partial<CensusFamily> & Pick<CensusFamily, 'ccrc_id' | 'session_pk'>): CensusFamily => ({
    generation: CG('c1'), merged_into: null, first_seen_ms: 1000, last_main_ts_ms: C_AS_OF - C_HOUR,
    merged_generations: [], calls: [], boundaries: [], ...o,
  });
  const pure = (families: CensusFamily[]): Census => ({
    as_of_ms: C_AS_OF, since_ms: C_SINCE, row_cap: 400, ticks: { n: 0, first_ts_ms: null, last_ts_ms: null }, families,
  });
  /** The one reason (id, gen) is excluded for, or null when it is active; it is never in both lists, nor twice. */
  const reasonOf = (g: GateT4, c: Census, id: string, gen: string): string | null => {
    const r = g.activeFamilies(STORE, c);
    const on = r.active.filter((f) => f.ccrc_id === id && f.generation === gen);
    const off = r.excluded.filter((f) => f.ccrc_id === id && f.generation === gen);
    expect(on.length + off.length, `${id}/${gen} is reported exactly once`).toBe(1);
    return off.length === 1 ? off[0]!.reason : null;
  };

  it('census: every sessions row, merged ones included, with its sessions columns and its last main entry before as_of', () => {
    const s = censusStore();
    const c = censusOf(s.db);
    expect(c.families.map((f) => [f.ccrc_id, f.generation, f.session_pk, f.merged_into, f.first_seen_ms, f.last_main_ts_ms])).toEqual([
      ['demo-tie', CG('b1'), s.pk.tieA, null, 5000, C_AS_OF - C_HOUR],
      ['demo-tie', CG('b2'), s.pk.tieB, null, 5000, C_AS_OF - C_HOUR],
      ['demo-rekey', CG('b3'), s.pk.rekey, null, 6000, C_AS_OF - 2 * C_HOUR],
      ['demo-rekey', '', s.pk.rekeyLegacy, s.pk.rekey, 7000, null],
      ['demo-legacy', '', s.pk.legacy, null, 9000, C_AS_OF - C_HOUR],
      ['demo-legacy', CG('b4'), s.pk.legacyOld, null, 4000, C_AS_OF - C_HOUR],
      ['demo-stale', CG('b5'), s.pk.stale, null, 1000, C_AS_OF - C_LOOK - 1],   // not the subagent's, not the unconfirmed epoch's
      ['demo-edge-in', CG('b6'), s.pk.edgeIn, null, 1000, C_AS_OF - C_LOOK],
      ['demo-edge-out', CG('b7'), s.pk.edgeOut, null, 1000, C_AS_OF - C_LOOK - 10],   // the entry at as_of is not read
      ['demo-empty', CG('b8'), s.pk.empty, null, 1000, null],
    ]);
    expect(Object.keys(c.families[0]!)).toEqual(['ccrc_id', 'generation', 'session_pk', 'merged_into', 'first_seen_ms',
      'last_main_ts_ms', 'merged_generations', 'calls', 'boundaries']);
    expect(c.families.map((f) => f.merged_generations)).toEqual([[], [], [''], [], [], [], [], [], [], []]);
    expect(c.families.flatMap((f) => f.boundaries), 'the fixture plants no boundary').toEqual([]);
  });

  it('census: calls are the raw rows from since to before as_of, the arm row absent', () => {
    const s = censusStore();
    const c = censusOf(s.db);
    // c1 (since - 1) and c5 (as_of) lie outside; c3 is a replay arm's (arm 'quiz'); c2 and c4 stand, rc as recorded.
    expect(c.families.find((f) => f.session_pk === s.pk.tieB)!.calls).toEqual([[C_SINCE, 0, 'expand'], [C_AS_OF - 1, 8, 'grep']]);
    expect(c.families.filter((f) => f.session_pk !== s.pk.tieB).flatMap((f) => f.calls)).toEqual([]);
  });

  it('census: the ticks summary counts ticks from since to before as_of', () => {
    const c = censusOf(censusStore().db);
    expect({ as_of_ms: c.as_of_ms, since_ms: c.since_ms, row_cap: c.row_cap }).toEqual({ as_of_ms: C_AS_OF, since_ms: C_SINCE, row_cap: 400 });
    expect(c.ticks).toEqual({ n: 2, first_ts_ms: C_SINCE, last_ts_ms: C_AS_OF - 60_000 });
    // The O52 store's ticks all lie near NOW, far outside [1500, 6000): n 0 with null ends.
    expect(censusOf(plantedStore().db, 6000, 1500).ticks).toEqual({ n: 0, first_ts_ms: null, last_ts_ms: null });
  });

  it('census over the O52 store: each family carries the families mode raw rows, calls cut at as_of', () => {
    const f = plantedStore();
    const rep = report(censusArgs(f.db, 6000, 1500)) as unknown as ReportC;
    expect(rep.w2, 'census mode leaves w2 null').toBeNull();
    const c = rep.census!;
    // Every sessions row of THIS store, whatever the families file says: demo-b is listed there under another store.
    expect(c.families.map((x) => [x.ccrc_id, x.generation, x.merged_into === null ? 'live' : 'merged'])).toEqual([
      ['demo-a', G1, 'live'], ['demo-a', '', 'merged'], ['demo-b', G2, 'live']]);
    const g1 = c.families.find((x) => x.ccrc_id === 'demo-a' && x.generation === G1)!;
    expect(c.families.find((x) => x.generation === '')!.merged_into).toBe(g1.session_pk);
    interface W2Family { ccrc_id: string; generation: string; merged_generations: string[]; calls: CallRow[]; boundaries: unknown[] }
    const w2 = (report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000',
      '--row-cap', '400']).w2 as unknown as { families: W2Family[] }).families.find((x) => x.ccrc_id === 'demo-a' && x.generation === G1)!;
    expect(g1.boundaries, 'B1 (2000) and B2 (5000) lie in [1500, 6000); B3 (7000) does not').toHaveLength(2);
    expect(g1.boundaries).toEqual(w2.boundaries);
    expect(g1.merged_generations).toEqual(w2.merged_generations);
    expect(g1.calls).toEqual(w2.calls.filter((r) => r[0] < 6000));
    expect(g1.calls.length).toBeGreaterThan(0);
    expect(g1.calls.map((r) => r[0]), "k5 (2600) is a replay arm's call").not.toContain(2600);
  });

  it('census: null without the census flag, and its key follows w2', () => {
    const f = plantedStore();
    expect((report(['--db', f.db, '--now', String(NOW)]) as unknown as ReportC).census).toBeNull();
    expect((report(['--db', f.db, '--now', String(NOW), '--families', f.families, '--window-start', '1500', '--window-end', '6000',
      '--row-cap', '400']) as unknown as ReportC).census).toBeNull();
    expect(Object.keys(report(censusArgs(f.db, 6000, 1500)))).toEqual(['store_id', 'user_version', 'script_sha256', 'counters',
      'w1b_lag_p95_ms', 'w1c_duplicate_entries', 'w1e', 'w1f_grep_p95_ms', 'w2', 'census']);
  });

  it.each(['--as-of', '--since', '--row-cap'])('census refusals: each required flag missing exits 2, here %s', (flag) => {
    const f = plantedStore();
    const args = censusArgs(f.db, 6000, 1500);
    args.splice(args.indexOf(flag), 2);
    const r = measure(args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--census needs --as-of, --since and --row-cap');
    expect(r.stdout).toBe('');
  });

  it('census refusals: census mode beside families mode exits 2', () => {
    const f = plantedStore();
    const r = measure([...censusArgs(f.db, 6000, 1500), '--families', f.families, '--window-start', '1500', '--window-end', '6000']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--census and --families are exclusive');
    expect(r.stdout).toBe('');
  });

  it('census: the store bytes are unchanged by a census run', () => {
    for (const [db, asOf, since] of [[plantedStore().db, 6000, 1500], [censusStore().db, C_AS_OF, C_SINCE]] as const) {
      const sha = (): string => createHash('sha256').update(readFileSync(db)).digest('hex');
      const before = sha();
      censusOf(db, asOf, since);
      expect(sha(), db).toBe(before);
    }
  });

  it('census: one read snapshot, a sessions row a writer commits mid-census is not in it', () => {
    const s = censusStore();
    // census_report over the real read-only connection, wrapped so that a second connection commits a new sessions
    // row right after the census's FIRST read (the ticks summary). The census must not see it.
    const RACE = [
      'import importlib.util, json, sqlite3, sys',
      "spec = importlib.util.spec_from_file_location('mh', sys.argv[1]); mh = importlib.util.module_from_spec(spec); spec.loader.exec_module(mh)",
      'ro = mh.open_db(sys.argv[2])',
      'rw = sqlite3.connect(sys.argv[2])',
      'class Racing:',
      '    def __init__(self, c):',
      '        self.c, self.reads = c, 0',
      '    def __getattr__(self, k):',
      '        return getattr(self.c, k)',
      '    def execute(self, sql, *a):',
      '        cur = self.c.execute(sql, *a)',
      "        if sql.lstrip()[:6].upper() == 'SELECT':",
      '            self.reads += 1',
      '            if self.reads == 1:',
      "                rw.execute(\"INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES ('demo-late', '', 'demo', 1)\")",
      '                rw.commit()',
      '        return cur',
      'r = mh.census_report(Racing(ro), int(sys.argv[3]), int(sys.argv[4]), 400)',
      "print(json.dumps([f['ccrc_id'] for f in r['families']]))",
    ].join('\n');
    const r = spawnSync('python3', [...PY_ISOLATED, '-c', RACE, SCRIPT, s.db, String(C_AS_OF), String(C_SINCE)],
      { encoding: 'utf8', env: { ...scrubbedEnv(process.env), PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    const ids = JSON.parse(r.stdout) as string[];
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain('demo-late');
    expect(censusOf(s.db).families.map((f) => f.ccrc_id), 'CONTROL: the writer committed, and the next census sees it').toContain('demo-late');
  });

  it('active rule: three active families, every other one excluded with exactly one reason', async () => {
    const g = await gateT4();
    const s = censusStore();
    const r = g.activeFamilies(s.storeId, censusOf(s.db));
    const ref = (ccrc_id: string, generation: string): FamilyRef => ({ store_id: s.storeId, ccrc_id, generation });
    // Sorted by familyKey: one store, so by ccrc_id, then generation ('' first).
    expect(r.active).toEqual([ref('demo-edge-in', CG('b6')), ref('demo-rekey', CG('b3')), ref('demo-tie', CG('b2'))]);
    expect(r.excluded).toEqual([
      { ...ref('demo-edge-out', CG('b7')), reason: 'no-recent-entry' },
      { ...ref('demo-empty', CG('b8')), reason: 'no-recent-entry' },
      { ...ref('demo-legacy', ''), reason: 'legacy' },
      { ...ref('demo-legacy', CG('b4')), reason: 'not-newest' },
      { ...ref('demo-rekey', ''), reason: 'merged' },
      { ...ref('demo-stale', CG('b5')), reason: 'no-recent-entry' },
      { ...ref('demo-tie', CG('b1')), reason: 'not-newest' },
    ]);
    expect(new Set(r.excluded.map((x) => x.reason)), 'every reason is an ACTIVE_EXCLUSIONS word, and every word is reached')
      .toEqual(new Set(g.ACTIVE_EXCLUSIONS));
  });

  it('active rule: newest-family parity with recall familiesOf on a first_seen_ms tie', async () => {
    const g = await gateT4();
    const recall = (await import('../../ccd/history/recall.mjs')) as unknown as {
      familiesOf(db: unknown, sel: object): ReadonlyArray<{ sessionPk: number; generation: string }>;
    };
    const s = censusStore();
    const c = censusOf(s.db);
    expect(c.families.filter((f) => f.ccrc_id === 'demo-tie').map((f) => f.first_seen_ms), 'CONTROL: a tie on first_seen_ms')
      .toEqual([5000, 5000]);
    expect(c.families.filter((f) => f.ccrc_id === 'demo-rekey').map((f) => [f.first_seen_ms, f.merged_into === null]),
      'CONTROL: the merged row is the newer by first_seen_ms').toEqual([[6000, true], [7000, false]]);
    const db = new DatabaseSync(s.db, { readOnly: true });
    try {
      for (const id of [...new Set(c.families.map((f) => f.ccrc_id))]) {
        const own = recall.familiesOf(db, { kind: 'family', id, generation: null, project: null, workdir: null, workdirReal: null });
        expect(own, id).toHaveLength(1);
        const mine = g.newestFamilyOf(c.families, id);
        expect(mine === null ? null : [mine.session_pk, mine.generation], id).toEqual([own[0]!.sessionPk, own[0]!.generation]);
      }
    } finally {
      db.close();
    }
    expect(g.newestFamilyOf(c.families, 'demo-tie')!.session_pk, 'the tie goes to the greater session_pk').toBe(s.pk.tieB);
  });

  it('active rule: the look-back edges, an entry at as_of minus the look-back counts and one at as_of does not', async () => {
    const g = await gateT4();
    const at = (last: number | null): string | null =>
      reasonOf(g, pure([fam({ ccrc_id: 'demo-x', session_pk: 1, last_main_ts_ms: last })]), 'demo-x', CG('c1'));
    expect(at(C_AS_OF - C_LOOK)).toBeNull();
    expect(at(C_AS_OF - 1)).toBeNull();
    expect(at(C_AS_OF)).toBe('no-recent-entry');
    expect(at(C_AS_OF - C_LOOK - 1)).toBe('no-recent-entry');
    expect(at(null)).toBe('no-recent-entry');
    expect(g.ACTIVE_LOOKBACK_MS).toBe(7 * 86_400_000);
    const c = pure([fam({ ccrc_id: 'demo-x', session_pk: 1, last_main_ts_ms: C_AS_OF - 1000 })]);
    expect(g.activeFamilies(STORE, c, { lookbackMs: 1000 }).active).toHaveLength(1);
    expect(g.activeFamilies(STORE, c, { lookbackMs: 999 }).excluded.map((x) => x.reason)).toEqual(['no-recent-entry']);
  });

  it('active rule: legacy families are excluded legacy whatever their recency', async () => {
    const g = await gateT4();
    // The id's only row, so its newest, with an entry an hour before as_of: still legacy.
    expect(reasonOf(g, pure([fam({ ccrc_id: 'demo-x', session_pk: 1, generation: '' })]), 'demo-x', '')).toBe('legacy');
    expect(reasonOf(g, pure([fam({ ccrc_id: 'demo-x', session_pk: 1, generation: '', last_main_ts_ms: null })]), 'demo-x', '')).toBe('legacy');
    // A legacy row newer than its id's UUID row: recall answers the legacy row, so the UUID row is not the newest, and
    // the id has no active family.
    const both = pure([fam({ ccrc_id: 'demo-x', session_pk: 1, first_seen_ms: 1000 }), fam({ ccrc_id: 'demo-x', session_pk: 2, generation: '', first_seen_ms: 2000 })]);
    expect(reasonOf(g, both, 'demo-x', CG('c1'))).toBe('not-newest');
    expect(g.activeFamilies(STORE, both).active).toEqual([]);
  });

  it('active rule: one reason per family, in the order merged, legacy, not-newest, no-recent-entry', async () => {
    const g = await gateT4();
    const c = pure([
      fam({ ccrc_id: 'demo-x', session_pk: 1, generation: '', merged_into: 2, first_seen_ms: 9000, last_main_ts_ms: null }),
      fam({ ccrc_id: 'demo-x', session_pk: 2, first_seen_ms: 5000 }),
      fam({ ccrc_id: 'demo-y', session_pk: 3, generation: CG('c2'), merged_into: 4, last_main_ts_ms: null }),
      fam({ ccrc_id: 'demo-y', session_pk: 4, generation: CG('c3') }),
      fam({ ccrc_id: 'demo-z', session_pk: 5, generation: CG('c4'), first_seen_ms: 1000, last_main_ts_ms: null }),
      fam({ ccrc_id: 'demo-z', session_pk: 6, generation: CG('c5'), first_seen_ms: 2000, last_main_ts_ms: null }),
    ]);
    const r = g.activeFamilies(STORE, c);
    expect(r.active.length + r.excluded.length, 'each family is reported once').toBe(6);
    expect(reasonOf(g, c, 'demo-x', '')).toBe('merged');               // merged, legacy and without an entry: merged
    expect(reasonOf(g, c, 'demo-y', CG('c2'))).toBe('merged');         // a merged UUID row
    expect(reasonOf(g, c, 'demo-z', CG('c4'))).toBe('not-newest');     // not the newest and without an entry: not-newest
    expect(reasonOf(g, c, 'demo-z', CG('c5'))).toBe('no-recent-entry');
    expect(reasonOf(g, c, 'demo-x', CG('c1'))).toBeNull();
    expect(reasonOf(g, c, 'demo-y', CG('c3'))).toBeNull();
  });

  it('active rule: newestFamilyCompare orders by first_seen_ms then session_pk, both descending', async () => {
    const g = await gateT4();
    const a = fam({ ccrc_id: 'demo-x', session_pk: 1, first_seen_ms: 2000 });
    const b = fam({ ccrc_id: 'demo-x', session_pk: 2, first_seen_ms: 1000 });
    const c = fam({ ccrc_id: 'demo-x', session_pk: 3, first_seen_ms: 2000 });
    expect(g.newestFamilyCompare(a, b)).toBeLessThan(0);
    expect(g.newestFamilyCompare(b, a)).toBeGreaterThan(0);
    expect(g.newestFamilyCompare(c, a), 'a tie on first_seen_ms goes to the greater session_pk').toBeLessThan(0);
    expect(g.newestFamilyOf([a, b, c], 'demo-x')!.session_pk).toBe(3);
    expect(g.newestFamilyOf([c, a, b], 'demo-x')!.session_pk, 'whatever the input order').toBe(3);
    expect(g.newestFamilyOf([a, b], 'demo-y')).toBeNull();
    expect(g.newestFamilyOf([fam({ ccrc_id: 'demo-x', session_pk: 4, first_seen_ms: 9000, merged_into: 3 }), a], 'demo-x')!.session_pk).toBe(1);
    expect(g.newestFamilyOf([fam({ ccrc_id: 'demo-x', session_pk: 4, merged_into: 3 })], 'demo-x')).toBeNull();
  });

  it('active rule: refuses a census it cannot read rather than answering every family active', async () => {
    const g = await gateT4();
    const c = pure([fam({ ccrc_id: 'demo-x', session_pk: 1 })]);
    expect(() => g.activeFamilies(null as unknown as string, c)).toThrow(TypeError);
    expect(() => g.activeFamilies('', c)).toThrow(TypeError);
    const noAsOf: Partial<Census> = { ...c };
    delete noAsOf.as_of_ms;
    expect(() => g.activeFamilies(STORE, noAsOf as Census)).toThrow(TypeError);
    expect(() => g.activeFamilies(STORE, { ...c, families: undefined } as unknown as Census)).toThrow(TypeError);
    expect(() => g.activeFamilies(STORE, c, { lookbackMs: -1 })).toThrow(TypeError);
    expect(() => g.activeFamilies(STORE, c, { lookbackMs: 1.5 })).toThrow(TypeError);
    expect(g.activeFamilies(STORE, c).active, 'CONTROL: the same census, read whole, answers').toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 4|W1-e sits between')
```

Expected: red, `19 failed` (predicted, against Tasks 1 to 3 as their plans state them). That is the new describe's 18 cases and the edited key-order case:
- **The census cases** fail on argparse's own refusal. `report` reads `expected 2 to be 0`, with `error: unrecognized arguments: --census --as-of …` as its message.
- **The three required-flag cases and the exclusivity case** exit 2 for that same reason. Each fails `expected '…unrecognized arguments…' to contain '--census needs --as-of, --since and --row-cap'`, and the exclusivity case fails `… to contain '--census and --families are exclusive'`.
- **The null case** fails `expected undefined to be null`.
- **The key-order case** fails with a 9-key array against a 10-key one.
- **The snapshot case** fails `expected 1 to be 0`, because of `AttributeError: module 'mh' has no attribute 'census_report'`.
- **The seven `active rule` cases** fail `g.activeFamilies is not a function`, or `… newestFamilyCompare is not a function`, or the census read before them.

- [ ] **Step 4: Write the census in `deploy/measure-history.py`.**

(a) In the docstring's usage block, directly after the usage line that holds `[--families`, insert the one line

```
                                      [--census --as-of MS --since MS --row-cap N]
```

(b) In the docstring's key table, directly after the last line of the `w2` entry, insert

```
  census                  null without --census; else the census, below
```

(c) In the docstring, directly before the closing paragraph that begins `Exit 0`, insert

```
CENSUS MODE (W2-D13, W2-D20). --census --as-of MS --since MS --row-cap N, all three required, never beside
--families. It reads this store as of --as-of (W2 open: the census instant T0, one per node) and adds `census`:
  as_of_ms, since_ms, row_cap   the arguments
  ticks                         {n, first_ts_ms, last_ts_ms} over ticks with since <= ts_ms < as_of; n 0 with null
                                ends when there are none
  families                      one row per sessions row, merged ones included, in session_pk order: ccrc_id,
                                generation, session_pk, merged_into, first_seen_ms; last_main_ts_ms, the greatest
                                ts_ms before as_of of an entry of a main transcript (agent_id '') of a confirmed
                                epoch of the row or of a row merged into it (null when none); and family_report's
                                merged_generations, calls and boundaries over [since, as_of), calls cut at as_of
It reads one snapshot and decides nothing: which families are active at W2 open is history-gate.mjs's
activeFamilies (legacy '' families excluded, fixed: D-5773).

```

(d) Directly before `def main():`, insert

```python
# W2-3 Task 4 (W2-D13 census mode, W2-D20; D-5773 (history-w2-legacy-families-excluded)): the census at W2 open.
LAST_MAIN_SQL = (
    'SELECT max(e.ts_ms) FROM epochs p '
    "JOIN transcripts t ON t.cc_session_uuid = p.cc_session_uuid AND t.agent_id = '' "
    'JOIN entries e ON e.transcript_pk = t.transcript_pk '
    'WHERE p.session_pk IN (SELECT s.session_pk FROM sessions s WHERE s.session_pk = ? OR s.merged_into = ?) '
    'AND p.confirmed_ms IS NOT NULL AND e.ts_ms < ?')


def census_report(db, as_of_ms, since_ms, row_cap):
    """W2 open on this node: every sessions row, merged ones included, in session_pk order, with its sessions
    columns, its last main entry before as_of, and family_report's raw rows over [since, as_of). It decides
    nothing: history-gate.mjs's activeFamilies applies W2-D20's rule to this output.

    One read snapshot: a live store ticks while this runs, so every query below reads one transaction, opened here
    and ended by main's db.close(). last_main_ts_ms reads the family's own row and the rows merged into it, the
    scope family_report reads; a re-key moves a merged row's epochs to its target (the sweep's merge), so a merged
    row reads null. family_report's calls have no upper bound, so they are cut at as_of here; a copy's rows keep
    family_report's line bounds (the next main boundary and --row-cap)."""
    if not db.in_transaction:
        db.execute('BEGIN')   # one read snapshot: see the docstring
    n, first, last = db.execute(
        'SELECT count(*), min(ts_ms), max(ts_ms) FROM ticks WHERE ts_ms >= ? AND ts_ms < ?', (since_ms, as_of_ms)).fetchone()
    families = []
    for pk, ccrc_id, generation, first_seen_ms, merged_into in db.execute(
            'SELECT session_pk, ccrc_id, generation, first_seen_ms, merged_into FROM sessions ORDER BY session_pk').fetchall():
        fam = family_report(db, ccrc_id, generation, since_ms, as_of_ms, row_cap)
        families.append({
            'ccrc_id': ccrc_id, 'generation': generation, 'session_pk': pk, 'merged_into': merged_into,
            'first_seen_ms': first_seen_ms,
            'last_main_ts_ms': db.execute(LAST_MAIN_SQL, (pk, pk, as_of_ms)).fetchone()[0],
            'merged_generations': fam['merged_generations'],
            'calls': [c for c in fam['calls'] if c[0] < as_of_ms],
            'boundaries': fam['boundaries'],
        })
    return {'as_of_ms': as_of_ms, 'since_ms': since_ms, 'row_cap': row_cap,
            'ticks': {'n': n, 'first_ts_ms': first, 'last_ts_ms': last}, 'families': families}


```

(e) In `main`, directly after Task 1's `    ap.add_argument('--row-cap'` line, insert

```python
    ap.add_argument('--census', action='store_true', help='W2 open: every family of this store as of --as-of')
    ap.add_argument('--as-of', type=int, default=None, help='epoch ms: the census instant (W2 open, T0)')
    ap.add_argument('--since', type=int, default=None, help='epoch ms: where the census raw rows start')
```

directly after `    a = ap.parse_args()`, insert

```python
    if a.census and a.families is not None:
        fail('--census and --families are exclusive')
    if a.census and (a.as_of is None or a.since is None or a.row_cap is None):
        fail('--census needs --as-of, --since and --row-cap')
```

directly after `            'w2': None,`, insert

```python
            'census': None,   # W2-3 Task 4: filled below with --census
```

and directly before the two lines

```python
    except sqlite3.Error as e:
        fail(f'cannot read {a.db}: {e}')
```

insert

```python
        if a.census:
            report['census'] = census_report(db, a.as_of, a.since, a.row_cap)
```

Check: `grep -c 'census' deploy/measure-history.py` prints a count above 0. Then check the patterns Task 1's O32, no-classification, no-blob and PK-probe pins ban: `grep -ciE 'claude|startswith|<synthetic>|blobs\.z|SELECT z' deploy/measure-history.py` prints 0. This task adds no memberships query and no model read.

- [ ] **Step 5: Run the census cases and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'census:|census refusals|census over|W1-e sits between')
```

Expected: green, `12 passed` (predicted). That is the eleven Python-side cases and the key-order case. The snapshot case's content was measured against a stand-in of `census_report`: 10 families with the transaction, and 11 with `demo-late` without it.

- [ ] **Step 6: Write the active rule.** Append at the END of `deploy/history-gate.mjs`:

```js

// ── W2-3 Task 4: the families active at W2 open (W2-D20; D-5773 (history-w2-legacy-families-excluded)) ──────────
// measure-history.py --census reads every sessions row of one store as of W2 open (the census instant T0, recorded
// per node in part 2) and decides nothing; these functions decide. A family (store_id, ccrc_id, generation) is active
// iff:
//   (a) merged_into is null and its generation matches lib's UUID_RE. A legacy '' family is excluded, and that is
//       fixed (D-5773): a re-key mid-window would leave its control file stale with no change row, and the W2 flow
//       cannot write a legacy control file (W2-D27, W2-D84);
//   (b) it is its id's newest unmerged family, in recall.mjs's NEWEST_FAMILY_SQL order (first_seen_ms DESC, then
//       session_pk DESC). This module reads lib alone, so that order is spelled a second time here, as
//       newestFamilyCompare, and held equal to recall's by the parity case in measure-history.test.ts. A legacy ''
//       row takes part in the order, as it does in recall's, so an id whose newest unmerged row is legacy has no
//       active family;
//   (c) its last main entry before as_of (the census's last_main_ts_ms) lies in [as_of - look-back, as_of).
// Every excluded family carries exactly one ACTIVE_EXCLUSIONS reason, the first clause it fails, in the order merged,
// legacy, not-newest, no-recent-entry. The registry check that follows is W2-5a's verify --registry.

/**
 * One census row (measure-history.py --census): one per sessions row of the store, merged ones included. `calls`
 * are [ts_ms, rc, verb] and `boundaries` family_report's boundary reports, both over [since, as_of).
 * @typedef {{ccrc_id: string, generation: string, session_pk: number, merged_into: number|null,
 *   first_seen_ms: number, last_main_ts_ms: number|null, merged_generations: string[],
 *   calls: Array<[number, number, string]>, boundaries: object[]}} CensusFamily
 */
/**
 * measure-history.py's `census` key.
 * @typedef {{as_of_ms: number, since_ms: number, row_cap: number,
 *   ticks: {n: number, first_ts_ms: number|null, last_ts_ms: number|null}, families: CensusFamily[]}} CensusReport
 */
/**
 * A family, keyed as the assignment (W2-D19) and assembleReports (W2-D22) key it.
 * @typedef {{store_id: string, ccrc_id: string, generation: string}} FamilyRef
 */

/** The open record's default look-back, `active_rule.lookback_ms`: 7 days. */
export const ACTIVE_LOOKBACK_MS = 604_800_000;

/**
 * recall.mjs's NEWEST_FAMILY_SQL order as a comparator: negative when `a` is the newer family. first_seen_ms DESC,
 * then session_pk DESC. A second spelling of that order, held equal to it by the parity pin (W2-D20).
 * @param {CensusFamily} a
 * @param {CensusFamily} b
 * @returns {number}
 */
export function newestFamilyCompare(a, b) {
  if (a.first_seen_ms !== b.first_seen_ms) return b.first_seen_ms - a.first_seen_ms;
  return b.session_pk - a.session_pk;
}

/**
 * The id's newest unmerged family, or null when the census holds no unmerged row of that id. Merged rows never take
 * part, as NEWEST_FAMILY_SQL's `merged_into IS NULL` keeps them out.
 * @param {CensusFamily[]} families
 * @param {string} ccrcId
 * @returns {CensusFamily|null}
 */
export function newestFamilyOf(families, ccrcId) {
  let best = null;
  for (const f of families) {
    if (f.ccrc_id !== ccrcId || f.merged_into !== null) continue;
    if (best === null || newestFamilyCompare(f, best) < 0) best = f;
  }
  return best;
}

/**
 * The first W2-D20 clause `f` fails, as its ACTIVE_EXCLUSIONS word, or null when it is active.
 * @param {CensusFamily} f
 * @param {Map<string, CensusFamily|null>} newest
 * @param {number} from
 * @param {number} asOf
 * @returns {'merged'|'legacy'|'not-newest'|'no-recent-entry'|null}
 */
function exclusionOf(f, newest, from, asOf) {
  if (f.merged_into !== null) return 'merged';
  if (!UUID_RE.test(f.generation)) return 'legacy';
  if (newest.get(f.ccrc_id)?.session_pk !== f.session_pk) return 'not-newest';
  const last = f.last_main_ts_ms;
  if (!Number.isSafeInteger(last) || last < from || last >= asOf) return 'no-recent-entry';
  return null;
}

/**
 * W2-D20's rule over one store's census: the families active at W2 open, and every other family with the one reason
 * it is not. Both lists are sorted by familyKey. It throws a TypeError, and never answers, on a store_id that is not a
 * UUID, a census with no integer as_of_ms or no families list, or a look-back that is not a whole, non-negative number
 * of ms: a census read in part would answer families active that are not.
 * @param {string} storeId
 * @param {CensusReport} census
 * @param {{lookbackMs?: number}} [opts]
 * @returns {{active: FamilyRef[], excluded: Array<FamilyRef & {reason: 'merged'|'legacy'|'not-newest'|'no-recent-entry'}>}}
 */
export function activeFamilies(storeId, census, opts = {}) {
  if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) throw new TypeError(`activeFamilies: ${JSON.stringify(storeId)} is not a store id`);
  if (!Number.isSafeInteger(census?.as_of_ms)) throw new TypeError('activeFamilies: the census carries no integer as_of_ms');
  if (!Array.isArray(census.families)) throw new TypeError('activeFamilies: the census carries no families list');
  const lookbackMs = opts.lookbackMs ?? ACTIVE_LOOKBACK_MS;
  if (!Number.isSafeInteger(lookbackMs) || lookbackMs < 0) throw new TypeError(`activeFamilies: look-back ${JSON.stringify(lookbackMs)} is not a whole, non-negative number of ms`);
  const asOf = census.as_of_ms;
  const from = asOf - lookbackMs;
  /** @type {Map<string, CensusFamily|null>} */
  const newest = new Map();
  for (const f of census.families) if (!newest.has(f.ccrc_id)) newest.set(f.ccrc_id, newestFamilyOf(census.families, f.ccrc_id));
  const active = [];
  const excluded = [];
  for (const f of census.families) {
    const ref = { store_id: storeId, ccrc_id: f.ccrc_id, generation: f.generation };
    const reason = exclusionOf(f, newest, from, asOf);
    if (reason === null) active.push(ref);
    else excluded.push({ ...ref, reason });
  }
  const byKey = (a, b) => {
    const x = familyKey(a.store_id, a.ccrc_id, a.generation);
    const y = familyKey(b.store_id, b.ccrc_id, b.generation);
    return x < y ? -1 : x > y ? 1 : 0;
  };
  return { active: active.sort(byKey), excluded: excluded.sort(byKey) };
}
```

Then check the purity and class-word rules that Task 2 pins: `grep -cE 'process\.|Date\.now|new Date|Math\.random|performance\.|require\(|import\(' deploy/history-gate.mjs` prints 0, and `grep -ciE 'haiku|sonnet' deploy/history-gate.mjs` prints 0.

- [ ] **Step 7: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'active rule:')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 4')
```

Expected: green, `7 passed` and then `18 passed` (predicted). The first filter carries the colon on purpose: the describe's own title ends in `the active rule`, so a bare `active rule` matches every case in it (18), while `active rule:` matches only the seven case titles that begin with it. The gate's verdicts were measured against a stand-in census built from this fixture: active `demo-edge-in`/b6, `demo-rekey`/b3 and `demo-tie`/b2, and the seven exclusions exactly as the case lists them. The pure cases' answers were measured the same way.

- [ ] **Step 8: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once. It then runs one filter, shows it red, and restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-3/scratch/t4"; mkdir -p "$SCRATCH"   # under the gitignored scratch root, its own subdirectory so the rm -rf below removes only it
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp deploy/measure-history.py "$SCRATCH/mh.orig"
cp deploy/history-gate.mjs "$SCRATCH/gate.orig"
T='test/measure-history.test.ts'

# P1: the last main entry read at as_of too.
mut deploy/measure-history.py "'AND p.confirmed_ms IS NOT NULL AND e.ts_ms < ?')" "'AND p.confirmed_ms IS NOT NULL AND e.ts_ms <= ?')"
(cd server && ./node_modules/.bin/vitest run $T -t 'census: every sessions row')
cp "$SCRATCH/mh.orig" deploy/measure-history.py
# Expected RED: demo-edge-out reads 1800000000000, not 1799395199990 (measured on a stand-in census_report).

# P2: a subagent transcript's entry read as a main one.
mut deploy/measure-history.py "t.cc_session_uuid = p.cc_session_uuid AND t.agent_id = ''" "t.cc_session_uuid = p.cc_session_uuid"
(cd server && ./node_modules/.bin/vitest run $T -t 'census: every sessions row')
cp "$SCRATCH/mh.orig" deploy/measure-history.py
# Expected RED: demo-stale reads 1799996400000, not 1799395199999 (measured on the stand-in).

# P3: an unconfirmed epoch's transcript read.
mut deploy/measure-history.py "'AND p.confirmed_ms IS NOT NULL AND e.ts_ms < ?')" "'AND e.ts_ms < ?')"
(cd server && ./node_modules/.bin/vitest run $T -t 'census: every sessions row')
cp "$SCRATCH/mh.orig" deploy/measure-history.py
# Expected RED: demo-stale reads 1799996400000 (measured on the stand-in).

# P9: merged rows dropped from the census.
mut deploy/measure-history.py "'SELECT session_pk, ccrc_id, generation, first_seen_ms, merged_into FROM sessions ORDER BY session_pk'" "'SELECT session_pk, ccrc_id, generation, first_seen_ms, merged_into FROM sessions WHERE merged_into IS NULL ORDER BY session_pk'"
(cd server && ./node_modules/.bin/vitest run $T -t 'census: every sessions row')
cp "$SCRATCH/mh.orig" deploy/measure-history.py
# Expected RED (predicted): the demo-rekey '' row is missing from the ten rows.

# P4: the ticks summary closed at as_of.
mut deploy/measure-history.py "'SELECT count(*), min(ts_ms), max(ts_ms) FROM ticks WHERE ts_ms >= ? AND ts_ms < ?'" "'SELECT count(*), min(ts_ms), max(ts_ms) FROM ticks WHERE ts_ms >= ? AND ts_ms <= ?'"
(cd server && ./node_modules/.bin/vitest run $T -t 'census: the ticks summary')
cp "$SCRATCH/mh.orig" deploy/measure-history.py
# Expected RED: { n: 3, first_ts_ms: 1798790400000, last_ts_ms: 1800000000000 } (measured on the stand-in).

# P5: calls not cut at as_of.
mut deploy/measure-history.py "            'calls': [c for c in fam['calls'] if c[0] < as_of_ms]," "            'calls': fam['calls'],"
(cd server && ./node_modules/.bin/vitest run $T -t 'census: calls are the raw rows')
cp "$SCRATCH/mh.orig" deploy/measure-history.py
# Expected RED: demo-tie b2's calls gain [1800000000000, 0, 'expand'] (measured on the stand-in).

# P6: the census spells its own calls query and loses the arm IS NULL rule family_report owns.
mut deploy/measure-history.py "            'calls': [c for c in fam['calls'] if c[0] < as_of_ms]," "            'calls': [list(r) for r in db.execute('SELECT ts_ms, rc, verb FROM recall_calls WHERE ccrc_id = ? AND ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms, event_key', (ccrc_id, since_ms, as_of_ms))],"
(cd server && ./node_modules/.bin/vitest run $T -t 'census: calls are the raw rows')
cp "$SCRATCH/mh.orig" deploy/measure-history.py
# Expected RED (predicted): the replay arm's c3, [1799999999998, 0, 'grep'], appears.

# P7: census mode beside families mode.
mut deploy/measure-history.py "    if a.census and a.families is not None:
        fail('--census and --families are exclusive')
" ""
(cd server && ./node_modules/.bin/vitest run $T -t 'census mode beside families mode')
cp "$SCRATCH/mh.orig" deploy/measure-history.py
# Expected RED (predicted): expected 0 to be 2.

# P8: a required flag left out.
mut deploy/measure-history.py "    if a.census and (a.as_of is None or a.since is None or a.row_cap is None):
        fail('--census needs --as-of, --since and --row-cap')
" ""
(cd server && ./node_modules/.bin/vitest run $T -t 'each required flag missing')
cp "$SCRATCH/mh.orig" deploy/measure-history.py
# Expected RED (predicted): 3 failed, each expected 0 (or 1) to be 2.

# P10: no read snapshot.
mut deploy/measure-history.py "    if not db.in_transaction:
        db.execute('BEGIN')   # one read snapshot: see the docstring
" ""
(cd server && ./node_modules/.bin/vitest run $T -t 'census: one read snapshot')
cp "$SCRATCH/mh.orig" deploy/measure-history.py
# Expected RED: 11 ids, demo-late among them (measured on the stand-in).

# N1: the session_pk tie-break dropped.
mut deploy/history-gate.mjs "  return b.session_pk - a.session_pk;" "  return 0;"
(cd server && ./node_modules/.bin/vitest run $T -t 'newest-family parity|newestFamilyCompare orders|three active families')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED: 3 failed. demo-tie answers b1 where recall answers b2, and b1 is active in b2's place (measured on the stand-in).

# N2: merged rows take part in the newest order.
mut deploy/history-gate.mjs "    if (f.ccrc_id !== ccrcId || f.merged_into !== null) continue;" "    if (f.ccrc_id !== ccrcId) continue;"
(cd server && ./node_modules/.bin/vitest run $T -t 'newest-family parity')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED: demo-rekey answers the merged '' row where recall answers b3 (measured on the stand-in).

# N3: the legacy clause dropped.
mut deploy/history-gate.mjs "  if (!UUID_RE.test(f.generation)) return 'legacy';
" ""
(cd server && ./node_modules/.bin/vitest run $T -t 'legacy families are excluded legacy')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED: the recent, newest '' family is active: expected null to be 'legacy' (measured on the stand-in).

# N4: legacy checked before merged, so a merged '' row is folded into legacy.
mut deploy/history-gate.mjs "  if (f.merged_into !== null) return 'merged';
  if (!UUID_RE.test(f.generation)) return 'legacy';" "  if (!UUID_RE.test(f.generation)) return 'legacy';
  if (f.merged_into !== null) return 'merged';"
(cd server && ./node_modules/.bin/vitest run $T -t 'one reason per family')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED: expected 'legacy' to be 'merged' (measured on the stand-in).

# N5: the look-back's lower edge made exclusive.
mut deploy/history-gate.mjs "last < from ||" "last <= from ||"
(cd server && ./node_modules/.bin/vitest run $T -t 'the look-back edges')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED: an entry at exactly as_of - look-back reads no-recent-entry: expected 'no-recent-entry' to be null (measured on the stand-in).

# N6: the upper edge dropped.
mut deploy/history-gate.mjs " || last >= asOf) return 'no-recent-entry';" ") return 'no-recent-entry';"
(cd server && ./node_modules/.bin/vitest run $T -t 'the look-back edges')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED: an entry at exactly as_of is active: expected null to be 'no-recent-entry' (measured on the stand-in).

# N8: a census without as_of_ms answered.
mut deploy/history-gate.mjs "  if (!Number.isSafeInteger(census?.as_of_ms)) throw new TypeError('activeFamilies: the census carries no integer as_of_ms');
" ""
(cd server && ./node_modules/.bin/vitest run $T -t 'refuses a census it cannot read')
cp "$SCRATCH/gate.orig" deploy/history-gate.mjs
# Expected RED: expected [Function] to throw an error (it answers the family active) (measured on the stand-in).

rm -rf "$SCRATCH"
git diff --stat -- deploy   # measure-history.py and history-gate.mjs show only this task's edits (and earlier tasks', if not yet committed)
```

Then run Step 7's second command once more: green, `18 passed`.

Task 4's own census case, `census: the store bytes are unchanged by a census run`, re-runs `open_db`'s `mode=ro` guard in this mode. Its mutant is the existing read-only cases', and this task adds no second one.

- [ ] **Step 9: Run the neighbours that read these files.** Run each in the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the four class names are enumerated|every vocabulary is declared once')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected (predicted):
- `measure-history.test.ts` is green as a whole. That includes Task 1's O32, no-classification, no-blob, PK-probe and self-hash cases (this task adds no model read, no blob read and no memberships query), Task 2's purity, O14-local and class-word cases (`ACTIVE_LOOKBACK_MS`, `newestFamilyCompare`, `newestFamilyOf` and `activeFamilies` are not VOCABS names, and the section spells no class word), and this task's 18.
- `single-definition` is green unedited.
- tsc prints nothing. A line naming only `agent/src/`, or a module that is not installed, comes from the worktree's install. A line naming `measure-history.test.ts` is this task's.

- [ ] **Step 10: Commit.**

```bash
git add deploy/measure-history.py deploy/history-gate.mjs server/test/measure-history.test.ts
git commit -m "feat(history): measure-history.py --census and the families active at W2 open (W2-3 Task 4, D-5773)"
```

### Task 5: Changed families and assembleReports

Tasks 1 to 3 give the gate raw window rows per node and a window builder. Before W2-5b's `report` can call `decideGate` (Task 8), two pure steps have to sit between them, and this task writes both:
- **`changedFamilies`** (W2-D23) reads the recall-off presence record's meta rows, using W2-D30's keys: `recall_off:change:<ts_ms>:<id>` with `{from, to, prev_seen_ms}`, and `recall_off:gap:<ts_ms>` with `{from, to}`. It answers which listed families' recall-off files changed during the window. A family of the list is dropped when any change row for its store and id satisfies `(prev_seen_ms ?? -Infinity) < window.end_ms && ts_ms >= window.start_ms`. Gap rows are reported and never drop anything. The drop applies only to the reported arm comparisons. Criterion 3 still counts every listed treatment family, and `decideGate` enforces that (Task 8, W2-D23's pin).
- **`assembleReports`** (W2-D22, W2-D24) keys every node report's families by `familyKey(store_id, ccrc_id, generation)`, the keying half of RP7-pure. It builds each family's windows through Task 3's `buildWindows` and checks the reports against the open record: every report must echo the record's window, part 2's `window` (its `window_start_ms` and `window_end_ms` against `window.start_ms` and `window.end_ms`; W2-D13 and W2-D22, amended 2026-10-19, the record's window by the coordinator's final W2-3/W2-4 plan review). If a check fails, it refuses with one `GATE_REASONS` word and returns no partial answer. `found: false` families, families with no measured window, and unmeasured windows are left out and reported by key. There is no void threshold.

The `recall_off:` prefix is spelled module-locally for now, as `RECALL_OFF_PREFIX_LOCAL`, which is not exported. W2-1 replaces this binding with an import of lib's `RECALL_OFF_META` and adds the Python twin pin (W2-D23). This task's tests write the prefix as W2-D30's literal key text and never read the binding, so W2-1's rewire leaves this describe green with no edit.

**Files:**
- Modify: `deploy/history-gate.mjs`. Append one section at the END of the file, after Task 4's section. It needs no new import: `canonicalJson` is in Task 2's import block, and `familyKey`, `ROW_CAP` and `buildWindows` are this module's own (Tasks 2 and 3).
- Test: `server/test/measure-history.test.ts`. Append one block at the END of the file, after Task 4's describe. It holds one top-level namespace import, `import * as gateT5 from '../../deploy/history-gate.mjs';`, and the describe `'W2-3 Task 5: changed families and the assembled reports'`.
  - It reuses the file's top-level `G1`, `G2` (`:44-45` at `7d01973a2`) and `createHash` (`:8`), and adds no other import.
  - A second namespace binding of a module that an earlier block may already import is legal ESM, and it keeps this block self-contained. The server suite has mid-file imports already (for example `ask-route.test.ts:73`).
- Not edited: `deploy/measure-history.py`, which this task only reads through Task 1's report shape; every other test file; `ccd/**`; `shared/**`; the spec.

**Interfaces:**
- Consumes (Task 1): the report shape `{store_id, user_version, script_sha256, counters, …, w2: {row_cap, window_start_ms, window_end_ms, families: [FamilyReport]}}`. A FamilyReport is `{ccrc_id, generation, found, merged_generations, calls, boundaries}`. A boundary is `{boundary_uuid, ts_ms, copies}`. A copy is `{file_id, source_key, boundary_line, after_count, summary_line, next_boundary_line, next_boundary_ts_ms, last_ts_ms, rows, models, truncated}`. A W1 report carries `w2: null`.
- Consumes (Task 2): `GATE_REASONS` (frozen; it must hold `store-id-null`, `store-id-duplicate`, `store-id-unlisted`, `family-unassigned`, `row-cap-mismatch`, `code-changed`, `code-unmeasured` and `window-mismatch`), `ROW_CAP = 400`, and `familyKey(storeId, ccrcId, generation) = canonicalJson([storeId, ccrcId, generation])`.
- Consumes (Task 3): `buildWindows(family: FamilyReport, k?: number): Window[]`, where `Window = {boundary_uuid, ts_ms, producer, state: 'measured'|'unmeasured', start_ms, end_ms, end_inclusive, turns, calls, with_call}`.
- Consumes (lib, through Task 2's import block): `canonicalJson`.
- Produces (`deploy/history-gate.mjs`):
  - `RECALL_OFF_PREFIX_LOCAL = 'recall_off:'`: module-local, NOT exported, and temporary. W2-1 replaces it.
  - `parseRecallOffRow(k: string, v: string)`. It answers one of:
    - `{kind: 'change', ts_ms: number, id: string, from: unknown, to: unknown, prev_seen_ms: number|null}`;
    - `{kind: 'gap', ts_ms: number, from: number|null, to: number}`;
    - `{kind: 'other'}`.

    A change or gap row off W2-D30's grammar throws an `Error` whose message starts `recall-off meta row`.
  - `changedFamilies(metaRows: Array<{store_id, k, v}>, window: {start_ms, end_ms}, list: FamilyRef[]): {changed: string[] /* familyKeys, sorted */, gaps: Array<{store_id, ts_ms, from, to}> /* sorted by store_id, then ts_ms */}`.
  - `assembleReports(reports: MeasureReport[], record: {nodes, assignment, gate_code, window: {start_ms, end_ms}}, opts?: {allowCodeChange?: boolean})`, where `window` is part 2's half-open window (W2-D22, amended). It answers one of:
    - `{ok: true, families: Array<{key, store_id, ccrc_id, generation, arm, windows: Window[] /* measured only */}>, excluded: {not_found: string[], zero_windows: string[], unmeasured: {count: number, keys: string[]}, not_listed: string[]}, code_changed: boolean}`;
    - `{ok: false, reason: string /* a GATE_REASONS word */, detail: string}`.

    A family listed twice in one report throws.
  - Module-private: `RECALL_OFF_MS_RE`, `isMsValue`, `recallOffOffGrammar`, `recallOffIdKey`. None of these is a lib.mjs export name (measured against `7d01973a2`'s lib exports), so Task 2's O14 local-half pin stays green.

**Spec:** §10.2 "The live A/B", the "A changed assignment" bullet (:2733), and "Pre-registration" (:2723). Decisions: W2-D22 (with its 2026-10-19 amendments: `window-mismatch`, measured against the record's window), W2-D13 (the echoed window, amended), W2-D23 (the function and the temporary prefix; the drop applies to the comparison only), W2-D24 (`assembleReports` re-checks each report's `script_sha256`; amended 2026-10-19: a missing sha is `code-unmeasured`, which `allowCodeChange` never stamps), W2-D30 (the meta-row grammar, read here), W2-D18 (a family with 0 measured windows is not a cluster), and RP7-pure's keying half. This task defines no departure and cites none.

**Choices this task makes:**
- **Refusal order.** A record whose `window` is not two safe integers is refused `window-mismatch` first, before any report is read. Then each report is checked in turn, with W2-D22's checks in their listed order: null store_id, duplicate, unlisted, unassigned family, row cap, script sha (a sha missing on either side, `code-unmeasured`, before a measured difference, `code-changed`), then the report's echoed window against the record's. The first word found is the answer.
- **The window check compares each report with the record** (W2-D22, amended by the coordinator's final W2-3/W2-4 plan review, 2026-10-19: each report's echoed window against the record's window, part 2's `window` field). The record passed in gains `window: {start_ms, end_ms}`, and a report whose `[window_start_ms, window_end_ms]` is not `[window.start_ms, window.end_ms]` is refused `window-mismatch`. So reports that agree with each other but not with the record are refused, a single report included, and two reports that differ cannot both pass. A report whose `w2` echoes no window (as a report from a build before the echo would) differs from the record's two integers, so the same comparison refuses it, never reading it as matching. A record whose `window` is not two safe integers is refused `window-mismatch` before any report is read: `undefined === undefined` must never count as the same window, and the word is plan-chosen, since the ruling names none for a record without a window. The earlier reading, which compared each report with the first report only, is withdrawn. A W1 report (`w2: null`) has no row cap, so it is refused as `row-cap-mismatch`. A missing `script_sha256`, or a `gate_code` with no `deploy/measure-history.py` entry, is refused as `code-unmeasured`, with or without `allowCodeChange` (W2-D24, amended 2026-10-19: the flag covers a measured mismatch only, and an unmeasured sha is never a change). Only a sha present on both sides and different is `code-changed`, which the flag stamps. `undefined === undefined` never counts as the same code.
- **`excluded.not_listed` is added to the produced shape (accepted by the coordinator).** It holds each assigned family that no report lists, for example because a node's report was never passed in. Without it, such a family would leave criterion 3's denominator silently. With it, the family is reported, and it is never folded into `not_found`, which means "listed, but absent from the store".
- **`zero_windows` counts families with no MEASURED window** (W2-D18). This includes a family whose every window was unmeasured. Its windows also appear in `unmeasured.keys`, each keyed `canonicalJson([store_id, ccrc_id, generation, boundary_uuid])`, so `count === keys.length`.
- **Two inputs throw instead of being refused** (accepted by the coordinator, 2026-10-19: internally malformed input throws). These are a family listed twice in one report, and a change or gap meta row off W2-D30's grammar. Both are defects in what the node produced, not gate outcomes. Neither may be read as "no change" or merged, and `GATE_REASONS` holds no word for them. A malformed change row that read as `other` would quietly keep a changed family in the comparison, so it throws.
- **Gap rows** are reported when `(from ?? -Infinity) < window.end_ms && ts_ms >= window.start_ms`, the same overlap test as change rows. This applies across every store in `metaRows`. A gap row reaches only `gaps`.
- **Every output list is sorted** (default UTF-16 order, as canonicalJson sorts), so report order and meta-row order change nothing.
- `detail` strings name store ids and family keys. They go to the operator's private `--out` only, never to the public ledger (W2-D25).

- [ ] **Step 1: Confirm the names from Tasks 2 and 3 before using them.** From the repository root:

```bash
node --input-type=module -e "const g = await import('./deploy/history-gate.mjs'); const need = ['store-id-null', 'store-id-duplicate', 'store-id-unlisted', 'family-unassigned', 'row-cap-mismatch', 'code-changed', 'code-unmeasured', 'window-mismatch']; console.log(need.filter((w) => !g.GATE_REASONS.includes(w)).join(',') || 'all eight', g.ROW_CAP, typeof g.familyKey, typeof g.buildWindows, g.familyKey('s', 'i', 'g'), ['RECALL_OFF_PREFIX_LOCAL', 'parseRecallOffRow', 'changedFamilies', 'assembleReports'].filter((n) => n in g).length)"
grep -cE '^(export )?(const|let|function) (RECALL_OFF_PREFIX_LOCAL|parseRecallOffRow|changedFamilies|assembleReports)\b' deploy/history-gate.mjs
node --input-type=module -e "const g = await import('./deploy/history-gate.mjs'); const c = (last, rows) => ({ file_id: 1, source_key: '', boundary_line: 10, after_count: 3, summary_line: 11, next_boundary_line: null, next_boundary_ts_ms: null, last_ts_ms: last, rows, models: [], truncated: false }); const f = { ccrc_id: 'demo-a', generation: 'g', found: true, merged_generations: [], calls: [[1100, 0, 'expand']], boundaries: [{ boundary_uuid: 'm', ts_ms: 1000, copies: [c(1200, [[12, 1100, 'q1', null, 'r1', null], [13, 1200, 'q2', null, 'r2', null]])] }, { boundary_uuid: 'u', ts_ms: 3000, copies: [c(null, [])] }] }; console.log(g.buildWindows(f).map((w) => [w.boundary_uuid, w.state, w.calls].join(':')).join(' '))"
```

Expected (measured against stand-ins for Tasks 2 and 3):
- the first line prints `all eight 400 function function ["s","i","g"] 0` (`all eight` predicted: measured as `all six` before `window-mismatch` and `code-unmeasured` joined the list);
- the grep counts `0`. It counts declarations only, at column 0: Task 2's comments (the `ROW_CAP` JSDoc, the `GATE_REASONS` comments, `familyKey`'s JSDoc) and Task 4's `FamilyRef` comment already name `assembleReports` in prose, so an unanchored grep prints 5 on a faithful tree;
- the last line prints `m:measured:1 u:unmeasured:0`. A copy holding two turns and no next boundary is measured, and ends inclusive at its last timed row, so the call at 1100 is inside. A copy with no timed row is unmeasured (W2-D14). This task's fixtures rest on exactly these two readings.

If a word is missing, or a name or reading differs, there is a gap in Task 2 or Task 3. Stop and report it. Never add a `GATE_REASONS` word here: the list is Task 2's, frozen once.

- [ ] **Step 2: Write the failing tests.** Append at the END of `server/test/measure-history.test.ts`:

```ts

// ── W2-3 Task 5: changed families and the assembled reports (W2-D22, W2-D23, W2-D24; RP7-pure's keying half) ─────
// Pure: every report, record and meta row below is a literal built in this describe, so no store and no python run.
// The windows come from Task 3's buildWindows: a "measured" boundary's one copy holds two assistant turns and no
// next boundary, so its window ends inclusive at the copy's last timed row; an "unmeasured" boundary's copy has no
// timed row (W2-D14). The presence record's keys are W2-D30's grammar, spelled here as text: the gate's prefix is
// module-local and temporary until W2-1 (W2-D23).
import * as gateT5 from '../../deploy/history-gate.mjs';

describe('W2-3 Task 5: changed families and the assembled reports', () => {
  const STORE_A = '00000000-0000-4000-8000-0000000000a5';
  const STORE_B = '00000000-0000-4000-8000-0000000000b5';
  const STORE_X = '00000000-0000-4000-8000-0000000000c5';
  const PY_SHA = createHash('sha256').update('w2-3 task 5: the measure-history.py bytes the record pinned').digest('hex');
  const OTHER_SHA = createHash('sha256').update('w2-3 task 5: other measure-history.py bytes').digest('hex');
  const PFX = 'recall_off:';   // W2-D30's meta prefix, as the presence record writes it
  type Row = [number, number | null, string | null, string | null, string, string | null];
  interface Copy {
    file_id: number; source_key: string; boundary_line: number; after_count: number; summary_line: number | null;
    next_boundary_line: number | null; next_boundary_ts_ms: number | null; last_ts_ms: number | null;
    rows: Row[]; models: string[]; truncated: boolean;
  }
  interface Boundary { boundary_uuid: string; ts_ms: number; copies: Copy[] }
  interface Family {
    ccrc_id: string; generation: string; found: boolean; merged_generations: string[];
    calls: Array<[number, number, string]>; boundaries: Boundary[];
  }
  interface MReport {
    store_id: string | null; user_version: number; script_sha256?: string; counters: Record<string, number>;
    w1b_lag_p95_ms: number | null; w1c_duplicate_entries: number; w1e: null; w1f_grep_p95_ms: number | null;
    w2: { row_cap: number; window_start_ms: number; window_end_ms: number; families: Family[] } | null; census: null;
  }
  interface Ref { store_id: string; ccrc_id: string; generation: string }
  interface Rec {
    nodes: Array<{ label: string; store_id: string }>;
    assignment: Array<Ref & { arm: 'treatment' | 'control' }>;
    gate_code: { release_tag: string; files: Record<string, string> };
    window: { start_ms: number; end_ms: number };
  }
  interface Win { boundary_uuid: string; state: string; calls: number; with_call: boolean }
  type Assembled =
    | { ok: true; families: Array<Ref & { key: string; arm: string; windows: Win[] }>;
        excluded: { not_found: string[]; zero_windows: string[]; unmeasured: { count: number; keys: string[] }; not_listed: string[] };
        code_changed: boolean }
    | { ok: false; reason: string; detail: string };

  /** A boundary whose one copy holds two assistant turns after its summary and no next boundary: measured. */
  const measuredAt = (uuid: string, ts: number): Boundary => ({ boundary_uuid: uuid, ts_ms: ts, copies: [{
    file_id: 1, source_key: '', boundary_line: 10, after_count: 3, summary_line: 11, next_boundary_line: null,
    next_boundary_ts_ms: null, last_ts_ms: ts + 200, models: ['model-t5'], truncated: false,
    rows: [[12, ts + 100, `msg-${uuid}-1`, null, `row-${uuid}-1`, 'model-t5'], [13, ts + 200, `msg-${uuid}-2`, null, `row-${uuid}-2`, 'model-t5']],
  }] });
  /** A boundary whose one copy has no timed row after it: unmeasured. */
  const unmeasuredAt = (uuid: string, ts: number): Boundary => ({ boundary_uuid: uuid, ts_ms: ts, copies: [{
    file_id: 2, source_key: '', boundary_line: 20, after_count: 1, summary_line: 21, next_boundary_line: null,
    next_boundary_ts_ms: null, last_ts_ms: null, models: [], truncated: false, rows: [],
  }] });
  const fam = (id: string, gen: string, boundaries: Boundary[], calls: Array<[number, number, string]> = []): Family =>
    ({ ccrc_id: id, generation: gen, found: true, merged_generations: [], calls, boundaries });
  const missing = (id: string, gen: string): Family =>
    ({ ccrc_id: id, generation: gen, found: false, merged_generations: [], calls: [], boundaries: [] });
  /** The window every fixture report echoes and every fixture record carries as part 2's `window` (W2-D13, W2-D22, amended):
   *  a report over the record's window assembles. */
  const ECHO = { window_start_ms: 0, window_end_ms: 1_209_600_000 } as const;
  const rep = (storeId: string | null, families: Family[], over: Partial<MReport> = {}): MReport => ({
    store_id: storeId, user_version: 1, script_sha256: PY_SHA, counters: {}, w1b_lag_p95_ms: null,
    w1c_duplicate_entries: 0, w1e: null, w1f_grep_p95_ms: null, w2: { row_cap: gateT5.ROW_CAP, ...ECHO, families }, census: null, ...over,
  });
  const rec = (assignment: Rec['assignment'], over: Partial<Rec> = {}): Rec => ({
    nodes: [{ label: 'node-a', store_id: STORE_A }, { label: 'node-b', store_id: STORE_B }],
    assignment,
    gate_code: { release_tag: 'v0.0.0-t5', files: { 'deploy/measure-history.py': PY_SHA } },
    window: { start_ms: ECHO.window_start_ms, end_ms: ECHO.window_end_ms },
    ...over,
  });
  const assemble = (reports: MReport[], record: Rec, opts?: { allowCodeChange?: boolean }): Assembled =>
    gateT5.assembleReports(reports as never, record as never, opts) as unknown as Assembled;
  const key = (s: string, id: string, gen: string): string => gateT5.familyKey(s, id, gen);
  const ok = (r: Assembled): Extract<Assembled, { ok: true }> => {
    if (!r.ok) throw new Error(`refused ${r.reason}: ${r.detail}`);
    return r;
  };
  /** The one-family fixture every refusal case starts from: it assembles. */
  const one = (): { reports: MReport[]; record: Rec } => ({
    reports: [rep(STORE_A, [fam('demo-a', G1, [measuredAt('b-a1', 1000)])])],
    record: rec([{ store_id: STORE_A, ccrc_id: 'demo-a', generation: G1, arm: 'treatment' }]),
  });
  const refusedAs = (r: Assembled, word: string): void => {
    expect(r.ok).toBe(false);
    expect(Object.keys(r).sort(), 'a refusal carries no partial answer').toEqual(['detail', 'ok', 'reason']);
    expect((r as { reason: string }).reason).toBe(word);
    expect(gateT5.GATE_REASONS).toContain(word);
  };

  it('CONTROL: the one-family fixture every refusal case starts from assembles, unstamped', () => {
    const { reports, record } = one();
    const r = ok(assemble(reports, record));
    expect(r.families.map((f) => [f.key, f.arm, f.windows.map((w) => [w.boundary_uuid, w.state])]))
      .toEqual([[key(STORE_A, 'demo-a', G1), 'treatment', [['b-a1', 'measured']]]]);
    expect(r.code_changed).toBe(false);
  });

  it('refuses store-id-null: a report whose store carries no meta store_id', () => {
    const { reports, record } = one();
    refusedAs(assemble([rep(null, reports[0]!.w2!.families)], record), 'store-id-null');
  });

  it('refuses store-id-duplicate: one store measured by two reports', () => {
    const { reports, record } = one();
    refusedAs(assemble([...reports, rep(STORE_A, [])], record), 'store-id-duplicate');
  });

  it('refuses store-id-unlisted: a report from a store outside the record\'s nodes', () => {
    const { reports, record } = one();
    refusedAs(assemble([...reports, rep(STORE_X, [])], record), 'store-id-unlisted');
  });

  it('refuses family-unassigned: a listed family the assignment does not hold, though its id is assigned on another store', () => {
    const { reports, record } = one();
    refusedAs(assemble([...reports, rep(STORE_B, [fam('demo-a', G1, [measuredAt('b-b1', 1000)])])], record), 'family-unassigned');
  });

  it('refuses row-cap-mismatch: a report measured at another row cap, and a W1 report with no w2', () => {
    const { reports, record } = one();
    const fams = reports[0]!.w2!.families;
    refusedAs(assemble([rep(STORE_A, fams, { w2: { row_cap: gateT5.ROW_CAP - 1, ...ECHO, families: fams } })], record), 'row-cap-mismatch');
    refusedAs(assemble([rep(STORE_A, fams, { w2: null })], record), 'row-cap-mismatch');
  });

  it('refuses code-changed: a script_sha256 other than gate_code\'s, both measured', () => {
    const { reports, record } = one();
    const fams = reports[0]!.w2!.families;
    refusedAs(assemble([rep(STORE_A, fams, { script_sha256: OTHER_SHA })], record), 'code-changed');
  });

  it('refuses code-unmeasured: a sha missing on either side, with or without allowCodeChange (W2-D24, amended)', () => {
    const { reports, record } = one();
    const noSha = rep(STORE_A, reports[0]!.w2!.families);
    delete noSha.script_sha256;
    const noPin = rec(record.assignment, { gate_code: { release_tag: 'v0.0.0-t5', files: {} } });
    for (const allowCodeChange of [false, true]) {
      refusedAs(assemble([noSha], record, { allowCodeChange }), 'code-unmeasured');
      refusedAs(assemble(reports, noPin, { allowCodeChange }), 'code-unmeasured');
      refusedAs(assemble([noSha], noPin, { allowCodeChange }), 'code-unmeasured');
    }
  });

  it("refuses window-mismatch: a report whose echoed window is not the record's, one that echoes none, and a record that carries none (W2-D13, W2-D22)", () => {
    const { reports, record } = one();
    const fams = reports[0]!.w2!.families;
    const onB = (w2: MReport['w2']): MReport => rep(STORE_B, [], { w2 });
    expect(ok(assemble([...reports, onB({ row_cap: gateT5.ROW_CAP, ...ECHO, families: [] })], record)).families,
      "CONTROL: two stores over the record's window assemble").toHaveLength(1);
    refusedAs(assemble([...reports, onB({ row_cap: gateT5.ROW_CAP, ...ECHO, window_end_ms: ECHO.window_end_ms + 1, families: [] })], record), 'window-mismatch');
    refusedAs(assemble([...reports, onB({ row_cap: gateT5.ROW_CAP, ...ECHO, window_start_ms: ECHO.window_start_ms + 1, families: [] })], record), 'window-mismatch');
    // Reports that agree with each other and not with the record: the record's window is the reference, one report included.
    const later = { window_start_ms: ECHO.window_start_ms + 86_400_000, window_end_ms: ECHO.window_end_ms + 86_400_000 };
    refusedAs(assemble([rep(STORE_A, fams, { w2: { row_cap: gateT5.ROW_CAP, ...later, families: fams } })], record), 'window-mismatch');
    refusedAs(assemble([rep(STORE_A, fams, { w2: { row_cap: gateT5.ROW_CAP, ...later, families: fams } }),
      onB({ row_cap: gateT5.ROW_CAP, ...later, families: [] })], record), 'window-mismatch');
    const noEcho = rep(STORE_A, fams, { w2: { row_cap: gateT5.ROW_CAP, families: fams } as MReport['w2'] });
    refusedAs(assemble([noEcho], record), 'window-mismatch');
    // A record with no window against a report that echoes none: undefined never matches undefined.
    const noWindow: Partial<Rec> = { ...record };
    delete noWindow.window;
    refusedAs(assemble([noEcho], noWindow as Rec), 'window-mismatch');
  });

  it('allowCodeChange stamps code_changed and refuses nothing: the same families, stamped', () => {
    const { reports, record } = one();
    const plain = ok(assemble(reports, record));
    const stamped = ok(assemble([rep(STORE_A, reports[0]!.w2!.families, { script_sha256: OTHER_SHA })], record, { allowCodeChange: true }));
    expect(stamped.code_changed).toBe(true);
    expect(stamped.families).toEqual(plain.families);
    expect(stamped.excluded).toEqual(plain.excluded);
    expect(ok(assemble(reports, record, { allowCodeChange: true })).code_changed, 'nothing changed, nothing stamped').toBe(false);
  });

  it('RP7-pure keying: one ccrc id and generation string on two stores assembles as two keyed families, each with its own arm', () => {
    const reports = [
      rep(STORE_A, [fam('demo-a', G1, [measuredAt('b-a1', 1000)], [[1100, 0, 'expand']])]),
      rep(STORE_B, [fam('demo-a', G1, [measuredAt('b-b1', 5000), measuredAt('b-b2', 9000)])]),
    ];
    const record = rec([
      { store_id: STORE_A, ccrc_id: 'demo-a', generation: G1, arm: 'treatment' },
      { store_id: STORE_B, ccrc_id: 'demo-a', generation: G1, arm: 'control' },
    ]);
    const r = ok(assemble(reports, record));
    const kA = key(STORE_A, 'demo-a', G1);
    const kB = key(STORE_B, 'demo-a', G1);
    expect(kA).not.toBe(kB);
    expect(r.families.map((f) => [f.key, f.store_id, f.ccrc_id, f.generation, f.arm, f.windows.length]).sort())
      .toEqual([[kA, STORE_A, 'demo-a', G1, 'treatment', 1], [kB, STORE_B, 'demo-a', G1, 'control', 2]].sort());
    expect(r.families.find((f) => f.key === kA)!.windows[0]).toMatchObject({ boundary_uuid: 'b-a1', calls: 1, with_call: true });
    expect(ok(assemble([...reports].reverse(), record)), 'report order changes nothing').toEqual(r);
  });

  it('found:false, 0-window and unmeasured exclusions are counted by key; an assigned family no report lists is not_listed', () => {
    const reports = [rep(STORE_A, [
      fam('demo-a', G1, [measuredAt('b-a1', 1000), unmeasuredAt('b-a2', 3000)]),
      missing('demo-b', G1),
      fam('demo-c', G1, []),
      fam('demo-d', G1, [unmeasuredAt('b-d1', 4000)]),
    ])];
    const record = rec(['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e'].map((id) => ({ store_id: STORE_A, ccrc_id: id, generation: G1, arm: 'treatment' as const })));
    const r = ok(assemble(reports, record));
    expect(r.families.map((f) => [f.key, f.windows.map((w) => w.boundary_uuid)])).toEqual([[key(STORE_A, 'demo-a', G1), ['b-a1']]]);
    expect(r.excluded).toEqual({
      not_found: [key(STORE_A, 'demo-b', G1)],
      zero_windows: [key(STORE_A, 'demo-c', G1), key(STORE_A, 'demo-d', G1)].sort(),
      unmeasured: { count: 2, keys: [JSON.stringify([STORE_A, 'demo-a', G1, 'b-a2']), JSON.stringify([STORE_A, 'demo-d', G1, 'b-d1'])].sort() },
      not_listed: [key(STORE_A, 'demo-e', G1)],
    });
  });

  it('a family listed twice in one report throws: two answers for one key are never merged', () => {
    const { record } = one();
    const twice = rep(STORE_A, [fam('demo-a', G1, [measuredAt('b-a1', 1000)]), fam('demo-a', G1, [])]);
    expect(() => assemble([twice], record)).toThrow(/listed twice in one report/);
  });

  // ── changedFamilies (W2-D23) over W2-D30's rows ──
  const W = { start_ms: 10_000, end_ms: 20_000 };
  const change = (store: string, ts: number, id: string, prev: number | null): { store_id: string; k: string; v: string } =>
    ({ store_id: store, k: `${PFX}change:${ts}:${id}`, v: JSON.stringify({ from: 'absent', to: 'value', prev_seen_ms: prev }) });
  const gap = (store: string, ts: number, from: number | null): { store_id: string; k: string; v: string } =>
    ({ store_id: store, k: `${PFX}gap:${ts}`, v: JSON.stringify({ from, to: ts }) });
  const LIST: Ref[] = [{ store_id: STORE_A, ccrc_id: 'demo-a', generation: G1 }];
  const changedOf = (rows: Array<{ store_id: string; k: string; v: string }>, list: Ref[] = LIST): string[] =>
    gateT5.changedFamilies(rows, W, list).changed;

  it('parseRecallOffRow reads a change row and a gap row, and every other key, the record\'s own state and seen_ms rows included, is other', () => {
    expect(gateT5.parseRecallOffRow(`${PFX}change:15000:demo-a`, JSON.stringify({ from: 'unobserved', to: 'value', prev_seen_ms: null })))
      .toEqual({ kind: 'change', ts_ms: 15_000, id: 'demo-a', from: 'unobserved', to: 'value', prev_seen_ms: null });
    expect(gateT5.parseRecallOffRow(`${PFX}gap:15000`, JSON.stringify({ from: 12_000, to: 15_000 })))
      .toEqual({ kind: 'gap', ts_ms: 15_000, from: 12_000, to: 15_000 });
    for (const k of [`${PFX}state:demo-a`, `${PFX}seen_ms`, 'store_id', 'recall_offchange:1:demo-a']) {
      expect(gateT5.parseRecallOffRow(k, '{}'), k).toEqual({ kind: 'other' });
    }
  });

  it('the temporary recall_off: prefix is module-local: the gate exports no binding of it for another module to read', () => {
    expect(Object.keys(gateT5).filter((n) => /RECALL_OFF/.test(n))).toEqual([]);
  });

  it('parseRecallOffRow throws on a change or gap row off the grammar, never reading it as other', () => {
    const v = JSON.stringify({ from: 'absent', to: 'value', prev_seen_ms: 9000 });
    for (const [k, val] of [
      [`${PFX}change:15x00:demo-a`, v], [`${PFX}change:015000:demo-a`, v], [`${PFX}change:15000:`, v], [`${PFX}change:15000`, v],
      [`${PFX}change:15000:demo-a`, 'not json'], [`${PFX}change:15000:demo-a`, JSON.stringify({ from: 'absent', to: 'value' })],
      [`${PFX}change:15000:demo-a`, JSON.stringify({ from: 'absent', to: 'value', prev_seen_ms: -1 })],
      [`${PFX}gap:15000`, JSON.stringify({ from: 12_000, to: null })], [`${PFX}gap:-1`, JSON.stringify({ from: null, to: 1 })],
    ] as const) expect(() => gateT5.parseRecallOffRow(k, val), `${k} ${val}`).toThrow(/recall-off meta row/);
  });

  it('a change row with prev_seen_ms null reads as -Infinity and drops the family', () => {
    expect(changedOf([change(STORE_A, 15_000, 'demo-a', null)])).toEqual([key(STORE_A, 'demo-a', G1)]);
  });

  it('a change row at exactly window.start_ms drops the family, and one a millisecond before it keeps it', () => {
    expect(changedOf([change(STORE_A, W.start_ms, 'demo-a', 9_000)])).toEqual([key(STORE_A, 'demo-a', G1)]);
    expect(changedOf([change(STORE_A, W.start_ms - 1, 'demo-a', 9_000)])).toEqual([]);
  });

  it('a change row whose prev_seen_ms is exactly window.end_ms keeps the family, and one a millisecond earlier drops it', () => {
    expect(changedOf([change(STORE_A, 20_500, 'demo-a', W.end_ms)])).toEqual([]);
    expect(changedOf([change(STORE_A, 20_500, 'demo-a', W.end_ms - 1)])).toEqual([key(STORE_A, 'demo-a', G1)]);
  });

  it('a change drops every listed generation of its id on its store, and nothing on another store or of another id', () => {
    const list: Ref[] = [
      { store_id: STORE_A, ccrc_id: 'demo-a', generation: G1 }, { store_id: STORE_A, ccrc_id: 'demo-a', generation: G2 },
      { store_id: STORE_B, ccrc_id: 'demo-a', generation: G1 }, { store_id: STORE_A, ccrc_id: 'demo-b', generation: G1 },
    ];
    expect(changedOf([change(STORE_A, 15_000, 'demo-a', 14_000), change(STORE_A, 15_100, 'demo-a', 15_000)], list))
      .toEqual([key(STORE_A, 'demo-a', G1), key(STORE_A, 'demo-a', G2)].sort());
  });

  it('a gap row is reported and drops nothing; the record\'s other rows drop nothing either', () => {
    const r = gateT5.changedFamilies([
      gap(STORE_A, 15_000, 12_000), gap(STORE_B, 11_000, null), gap(STORE_A, 9_000, 8_000),
      { store_id: STORE_A, k: `${PFX}state:demo-a`, v: JSON.stringify({ s: 'value', v: 'x' }) },
      { store_id: STORE_A, k: `${PFX}seen_ms`, v: '15000' },
    ], W, LIST);
    expect(r.changed).toEqual([]);
    expect(r.gaps).toEqual([
      { store_id: STORE_A, ts_ms: 15_000, from: 12_000, to: 15_000 },
      { store_id: STORE_B, ts_ms: 11_000, from: null, to: 11_000 },
    ]);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 5')
```

Expected: red, `20 failed | 1 passed` within the describe, and the rest of the file skipped (predicted: the code-unmeasured case that W2-D24's 2026-10-19 amendment adds makes it 20; the record-window ruling rewrites the window-mismatch case and adds none, so the count is predicted unchanged by it). This was measured as `18 failed | 1 passed` against stand-ins for Tasks 2 and 3, with the module exporting no Task 5 name, and as `19 failed | 1 passed` on 2026-10-19, after the window-mismatch case was added and before the code-unmeasured case, on a scratch tree of `7d01973a2` holding Tasks 2 to 9's gate sections exactly as this plan writes them, with Tasks 5, 8 and 9's describes in one scratch test file, this task's section removed.
- The one that passes is the module-local prefix case: nothing exports a `RECALL_OFF` binding yet. It is a standing guard, not a red-first case.
- The failures read:
  - `TypeError: assembleReports is not a function` (12 cases, the window-mismatch and code-unmeasured cases among them);
  - `TypeError: changedFamilies is not a function` (5);
  - `TypeError: parseRecallOffRow is not a function` (1);
  - `expected [Function] to throw error matching /listed twice in one report/ but got '…assembleReports…'`;
  - `recall_off:change:15x00:demo-a {…}: expected [Function] to throw error matching /recall-off meta row/ but got '…parseRecallOffR…'`.

- [ ] **Step 4: Write the two functions.** Append at the END of `deploy/history-gate.mjs`:

```js

// ── W2-3 Task 5: changed families and the assembled reports (W2-D22, W2-D23, W2-D24) ─────────────────────────────
// Pure, like the rest of this module. changedFamilies reads the presence record's meta rows (W2-D30's keys) and
// answers which listed families' recall-off files changed during the window; the drop applies to the reported arm
// comparisons only, never to criterion 3 (W2-D23; decideGate, Task 8). assembleReports turns each node's
// measure-history.py report into keyed families with their windows, or refuses with one GATE_REASONS word and no
// partial answer (W2-D22), re-checking each report's script_sha256 against the record's gate_code (W2-D24).

/** TEMPORARY (W2-D23): the presence record's meta prefix (W2-D30), spelled here only until W2-1 defines
 *  `RECALL_OFF_META` in lib.mjs, replaces this binding with an import of it and adds the Python twin pin. Module-
 *  local and never exported, so no other module can come to read this spelling. */
const RECALL_OFF_PREFIX_LOCAL = 'recall_off:';

/** A key's ms field: a decimal integer with no sign, no fraction and no leading zero. */
const RECALL_OFF_MS_RE = /^(?:0|[1-9][0-9]*)$/;

/** A meta row value's ms field: a non-negative safe integer. */
const isMsValue = (v) => Number.isSafeInteger(v) && v >= 0;

/** A presence row off W2-D30's grammar is a store defect, never "no change": it throws, so a malformed change row
 *  can never read as a family that did not change. */
function recallOffOffGrammar(k, why) {
  throw new Error(`recall-off meta row ${JSON.stringify(k)}: ${why}`);
}

/**
 * One meta row of the recall-off presence record (W2-D30), read: `recall_off:change:<ts_ms>:<id>` with
 * `{from, to, prev_seen_ms}`, and `recall_off:gap:<ts_ms>` with `{from, to}`. Every other key, including the
 * record's own `state:<id>` and `seen_ms` rows, is `{kind: 'other'}`. A change or gap row off the grammar throws.
 * @param {string} k
 * @param {string} v
 * @returns {{kind: 'change', ts_ms: number, id: string, from: unknown, to: unknown, prev_seen_ms: number | null}
 *   | {kind: 'gap', ts_ms: number, from: number | null, to: number}
 *   | {kind: 'other'}}
 */
export function parseRecallOffRow(k, v) {
  if (typeof k !== 'string' || !k.startsWith(RECALL_OFF_PREFIX_LOCAL)) return { kind: 'other' };
  const rest = k.slice(RECALL_OFF_PREFIX_LOCAL.length);
  const kind = rest.startsWith('change:') ? 'change' : rest.startsWith('gap:') ? 'gap' : null;
  if (kind === null) return { kind: 'other' };
  const tail = rest.slice(kind.length + 1);
  const colon = tail.indexOf(':');
  const tsText = kind === 'change' && colon >= 0 ? tail.slice(0, colon) : tail;
  if (!RECALL_OFF_MS_RE.test(tsText)) return recallOffOffGrammar(k, 'its ts_ms is not a decimal integer');
  const ts_ms = Number(tsText);
  if (!Number.isSafeInteger(ts_ms)) return recallOffOffGrammar(k, 'its ts_ms is past the safe integers');
  let body;
  try { body = JSON.parse(v); } catch { return recallOffOffGrammar(k, 'its value is not JSON'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return recallOffOffGrammar(k, 'its value is not an object');
  if (!Object.hasOwn(body, 'from') || !Object.hasOwn(body, 'to')) return recallOffOffGrammar(k, 'its value lacks from or to');
  if (kind === 'gap') {
    if (!(body.from === null || isMsValue(body.from)) || !isMsValue(body.to)) {
      return recallOffOffGrammar(k, 'a gap row\'s from is an ms or null, and its to an ms');
    }
    return { kind: 'gap', ts_ms, from: body.from, to: body.to };
  }
  const id = colon >= 0 ? tail.slice(colon + 1) : '';
  if (id === '') return recallOffOffGrammar(k, 'a change row\'s key names no id');
  if (!Object.hasOwn(body, 'prev_seen_ms') || !(body.prev_seen_ms === null || isMsValue(body.prev_seen_ms))) {
    return recallOffOffGrammar(k, 'a change row\'s prev_seen_ms is an ms or null');
  }
  return { kind: 'change', ts_ms, id, from: body.from, to: body.to, prev_seen_ms: body.prev_seen_ms };
}

/** A recall-off file is per id on one store, so a change row reaches every listed generation of its id there. */
const recallOffIdKey = (storeId, id) => canonicalJson([storeId, id]);

/**
 * W2-D23: the listed families whose recall-off file changed during the window. A family of the list is dropped
 * when any change row of its store and id satisfies `(prev_seen_ms ?? -Infinity) < window.end_ms && ts_ms >=
 * window.start_ms`: the change happened after the last observation before the window's end and was recorded at or
 * after its start. A null prev_seen_ms (the first observation, or the first after a recovery) reads as -Infinity.
 * Gap rows are reported, by the same overlap test over `(from, ts_ms)`, and drop nothing. Both lists are sorted, so
 * the answer does not depend on row order. The drop applies to the reported arm comparisons only (decideGate).
 * @param {Array<{store_id: string, k: string, v: string}>} metaRows
 * @param {{start_ms: number, end_ms: number}} window
 * @param {Array<{store_id: string, ccrc_id: string, generation: string}>} list
 * @returns {{changed: string[], gaps: Array<{store_id: string, ts_ms: number, from: number | null, to: number}>}}
 */
export function changedFamilies(metaRows, window, list) {
  const hit = new Set();
  const gaps = [];
  for (const row of metaRows) {
    const r = parseRecallOffRow(row.k, row.v);
    if (r.kind === 'change') {
      if ((r.prev_seen_ms ?? -Infinity) < window.end_ms && r.ts_ms >= window.start_ms) hit.add(recallOffIdKey(row.store_id, r.id));
    } else if (r.kind === 'gap') {
      if ((r.from ?? -Infinity) < window.end_ms && r.ts_ms >= window.start_ms) gaps.push({ store_id: row.store_id, ts_ms: r.ts_ms, from: r.from, to: r.to });
    }
  }
  const changed = [...new Set(list.filter((f) => hit.has(recallOffIdKey(f.store_id, f.ccrc_id)))
    .map((f) => familyKey(f.store_id, f.ccrc_id, f.generation)))].sort();
  gaps.sort((a, b) => (a.store_id < b.store_id ? -1 : a.store_id > b.store_id ? 1 : a.ts_ms - b.ts_ms));
  return { changed, gaps };
}

/**
 * W2-D22 and W2-D24: every node's measure-history.py report (Task 1's shape, `w2 = {row_cap, window_start_ms,
 * window_end_ms, families}`), keyed and
 * checked against the open record. Refused, with the first GATE_REASONS word found and no partial answer, in this
 * order per report: a null store_id (store-id-null); a store_id an earlier report carried (store-id-duplicate); a
 * store_id outside `record.nodes` (store-id-unlisted); a family whose `familyKey(store_id, ccrc_id, generation)` is
 * not in `record.assignment` (family-unassigned); a `w2.row_cap` other than ROW_CAP, a W1 report's absent w2
 * included (row-cap-mismatch); a `script_sha256` missing on either side (code-unmeasured, which no flag covers:
 * W2-D24, amended 2026-10-19); a `script_sha256` other than `gate_code.files['deploy/measure-history.py']`
 * (code-changed), where `opts.allowCodeChange` refuses nothing and stamps `code_changed: true` instead; and an echoed window that is not the record's `window`, part 2's, or none (window-mismatch; W2-D13 and W2-D22, amended
 * 2026-10-19: a report measured over another window than the record's is never assembled). A record whose `window` is not
 * two safe integers is refused window-mismatch before any report is read. Excluded and reported, never refused: `found: false` families (not_found), families
 * with no measured window (zero_windows; W2-D18: such a family is no cluster), each unmeasured window (unmeasured,
 * keyed `canonicalJson([store_id, ccrc_id, generation, boundary_uuid])`), and each assigned family that no report
 * lists (not_listed). No void threshold. Every list is sorted, so report order changes nothing.
 * @param {Array<{store_id: string | null, script_sha256?: string, w2: {row_cap: number, window_start_ms: number, window_end_ms: number, families: Array<object>} | null}>} reports
 * @param {{nodes: Array<{store_id: string}>, assignment: Array<{store_id: string, ccrc_id: string, generation: string, arm: string}>,
 *   gate_code: {files: Record<string, string>}, window: {start_ms: number, end_ms: number}}} record
 * @param {{allowCodeChange?: boolean}} [opts]
 * @returns {{ok: true, families: Array<{key: string, store_id: string, ccrc_id: string, generation: string, arm: string, windows: Array<object>}>,
 *   excluded: {not_found: string[], zero_windows: string[], unmeasured: {count: number, keys: string[]}, not_listed: string[]},
 *   code_changed: boolean} | {ok: false, reason: string, detail: string}}
 */
export function assembleReports(reports, record, opts = {}) {
  const refuse = (reason, detail) => ({ ok: false, reason, detail });
  const nodes = new Set(record.nodes.map((n) => n.store_id));
  const arms = new Map(record.assignment.map((a) => [familyKey(a.store_id, a.ccrc_id, a.generation), a.arm]));
  const pinned = record.gate_code.files['deploy/measure-history.py'];
  const seen = new Set();
  const keyed = [];
  let codeChanged = false;
  const want = [record.window?.start_ms, record.window?.end_ms];   // part 2's window, half-open (W2-D22, amended)
  if (!want.every((ms) => Number.isSafeInteger(ms))) return refuse('window-mismatch', `the record carries no window (window.start_ms, window.end_ms): ${JSON.stringify(record.window ?? null)}`);
  for (const [i, rep] of reports.entries()) {
    const at = `report ${i}`;
    if (rep.store_id === null || rep.store_id === undefined) return refuse('store-id-null', `${at} names no store_id: its store has no meta store_id`);
    if (seen.has(rep.store_id)) return refuse('store-id-duplicate', `${at}: store ${rep.store_id} is measured by an earlier report too`);
    seen.add(rep.store_id);
    if (!nodes.has(rep.store_id)) return refuse('store-id-unlisted', `${at}: store ${rep.store_id} is not one of the record's nodes`);
    for (const f of rep.w2?.families ?? []) {
      const key = familyKey(rep.store_id, f.ccrc_id, f.generation);
      if (!arms.has(key)) return refuse('family-unassigned', `${at}: family ${key} is not in the record's assignment`);
      keyed.push({ key, store_id: rep.store_id, f });
    }
    if (rep.w2?.row_cap !== ROW_CAP) return refuse('row-cap-mismatch', `${at}: row_cap ${JSON.stringify(rep.w2?.row_cap ?? null)}, and the gate's ROW_CAP is ${ROW_CAP}`);
    if (typeof pinned !== 'string' || typeof rep.script_sha256 !== 'string') return refuse('code-unmeasured', `${at}: measure-history.py sha256 ${JSON.stringify(rep.script_sha256 ?? null)}, and gate_code records ${JSON.stringify(pinned ?? null)}: a missing sha is unmeasured, never a change`);
    if (rep.script_sha256 !== pinned) {
      if (opts.allowCodeChange !== true) return refuse('code-changed', `${at}: measure-history.py sha256 ${JSON.stringify(rep.script_sha256)}, and gate_code records ${JSON.stringify(pinned)}`);
      codeChanged = true;
    }
    const echo = [rep.w2.window_start_ms, rep.w2.window_end_ms];
    if (echo[0] !== want[0] || echo[1] !== want[1]) return refuse('window-mismatch', `${at}: window ${JSON.stringify(echo)}, and the record's is ${JSON.stringify(want)}`);
  }
  const families = [];
  const notFound = [];
  const zeroWindows = [];
  const unmeasured = [];
  const listed = new Set();
  for (const { key, store_id, f } of keyed) {
    if (listed.has(key)) throw new Error(`assembleReports: family ${key} is listed twice in one report`);
    listed.add(key);
    if (f.found !== true) { notFound.push(key); continue; }
    const measured = [];
    for (const w of buildWindows(f)) {
      if (w.state === 'measured') measured.push(w);
      else unmeasured.push(canonicalJson([store_id, f.ccrc_id, f.generation, w.boundary_uuid]));
    }
    if (measured.length === 0) { zeroWindows.push(key); continue; }
    families.push({ key, store_id, ccrc_id: f.ccrc_id, generation: f.generation, arm: arms.get(key), windows: measured });
  }
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return {
    ok: true,
    families: families.sort(byKey),
    excluded: {
      not_found: notFound.sort(),
      zero_windows: zeroWindows.sort(),
      unmeasured: { count: unmeasured.length, keys: unmeasured.sort() },
      not_listed: [...arms.keys()].filter((k) => !listed.has(k)).sort(),
    },
    code_changed: codeChanged,
  };
}
```

The section spells neither class word, and none of `process.`, `Date.now`, `new Date`, `Math.random`, `performance.`, `require(` or `import(`. Task 2's purity pin and its class-word guard therefore stay green.

- [ ] **Step 5: Run them and see them pass.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 5')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
```

Expected:
- The first command is green, `21 passed` within the describe (predicted after the code-unmeasured case and its two-branch code, and unchanged by the record-window ruling, which rewrites one case and adds none; measured as `20 passed` before them on a scratch tree of `7d01973a2` holding Tasks 2 to 9's gate sections exactly as this plan writes them, with Tasks 5, 8 and 9's describes in one scratch test file; `19 passed` against stand-ins for Tasks 2 and 3 before the window-mismatch case). The block typechecked clean under `test/tsconfig.tests.json` on that tree.
- The second is green over the whole file (predicted: its count is Tasks 1 to 5's together). Task 2's purity and O14 local-half pins are in it, and both still hold with this section appended.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once (M8 applies two), runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-3/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
PY
}
G=deploy/history-gate.mjs
cp "$G" "$SCRATCH/gate.orig"
t5() { (cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t "W2-3 Task 5.*$1"); cp "$SCRATCH/gate.orig" "$G"; }

# M1: a report with no store_id is let through.
mut "$G" "    if (rep.store_id === null || rep.store_id === undefined) return refuse('store-id-null'," "    if (false) return refuse('store-id-null',"
t5 'refuses store-id-null'
# Expected RED (measured): expected 'store-id-unlisted' to be 'store-id-null'.

# M2: one store measured twice is let through.
mut "$G" "    if (seen.has(rep.store_id)) return refuse(" "    if (false) return refuse("
t5 'refuses store-id-duplicate'
# Expected RED (measured): expected true to be false (the refusal's ok).

# M3: a store outside the record's nodes is let through.
mut "$G" "    if (!nodes.has(rep.store_id)) return refuse(" "    if (false) return refuse("
t5 'refuses store-id-unlisted'
# Expected RED (measured): expected true to be false.

# M4: a family outside the assignment is let through.
mut "$G" "      if (!arms.has(key)) return refuse(" "      if (false) return refuse("
t5 'refuses family-unassigned'
# Expected RED (measured): expected true to be false.

# M5: a report measured at another row cap, or with no w2, is let through.
mut "$G" "    if (rep.w2?.row_cap !== ROW_CAP) return refuse(" "    if (false) return refuse("
t5 'refuses row-cap-mismatch'
# Expected RED (measured): expected true to be false.

# M5b: a report over another window than the record's is let through (W2-D22, amended).
mut "$G" "    if (echo[0] !== want[0] || echo[1] !== want[1]) return refuse(" "    if (false) return refuse("
t5 'refuses window-mismatch'
# Expected RED (predicted): expected true to be false (the first window-mismatch refusal's ok).

# M5c: a record that carries no window is read as matching a report that echoes none.
mut "$G" "  if (!want.every((ms) => Number.isSafeInteger(ms))) return refuse(" "  if (false) return refuse("
t5 'refuses window-mismatch'
# Expected RED (predicted): expected true to be false (the last refusal: undefined matches undefined).

# M5d: each report compared with the first report, not the record (the reading the final plan review withdrew).
mut "$G" "  const want = [record.window?.start_ms, record.window?.end_ms];" "  const want = [reports[0]?.w2?.window_start_ms, reports[0]?.w2?.window_end_ms];"
t5 'refuses window-mismatch'
# Expected RED (predicted): expected true to be false (the single report over a later window, compared with itself).

# M6: a changed measure-history.py is let through without the flag.
mut "$G" "      if (opts.allowCodeChange !== true) return refuse('code-changed'," "      if (false) return refuse('code-changed',"
t5 'refuses code-changed'
# Expected RED (measured): expected true to be false.

# M6b: a missing sha on either side is read as a measured change, so allowCodeChange would stamp it (W2-D24, amended).
mut "$G" "    if (typeof pinned !== 'string' || typeof rep.script_sha256 !== 'string') return refuse('code-unmeasured'," "    if (false) return refuse('code-unmeasured',"
t5 'refuses code-unmeasured'
# Expected RED (predicted): expected 'code-changed' to be 'code-unmeasured' (the report with no sha, flag off).

# M6c: a record with no measure-history.py entry is read as a measured change.
mut "$G" "typeof pinned !== 'string' || typeof rep.script_sha256" "typeof rep.script_sha256"
t5 'refuses code-unmeasured'
# Expected RED (predicted): expected 'code-changed' to be 'code-unmeasured' (the record with no pin, flag off).

# M6d: a report with no sha against a pinned record is read as a measured change.
mut "$G" " || typeof rep.script_sha256 !== 'string') return refuse('code-unmeasured'," ") return refuse('code-unmeasured',"
t5 'refuses code-unmeasured'
# Expected RED (predicted): expected 'code-changed' to be 'code-unmeasured' (the report with no sha, flag off).

# M7: --allow-code-change refuses nothing but stamps nothing either.
mut "$G" "      codeChanged = true;" ""
t5 'allowCodeChange stamps code_changed'
# Expected RED (measured): expected false to be true.

# M8: families keyed by ccrc id and generation alone (two replacements), so two stores' families collide.
mut "$G" "const arms = new Map(record.assignment.map((a) => [familyKey(a.store_id, a.ccrc_id, a.generation), a.arm]));" "const arms = new Map(record.assignment.map((a) => [canonicalJson([a.ccrc_id, a.generation]), a.arm]));"
mut "$G" "      const key = familyKey(rep.store_id, f.ccrc_id, f.generation);" "      const key = canonicalJson([f.ccrc_id, f.generation]);"
t5 'RP7-pure keying'
# Expected RED (measured): Error: assembleReports: family ["demo-a","0189abcd-…"] is listed twice in one report.

# M9: the families are left in report order.
mut "$G" "    families: families.sort(byKey)," "    families,"
t5 'RP7-pure keying'
# Expected RED (measured): report order changes nothing: expected { ok: true, …(3) } to deeply equal { ok: true, …(3) }.

# M10: an unmeasured window is kept in its family's windows.
mut "$G" "      if (w.state === 'measured') measured.push(w);" "      measured.push(w); if (w.state === 'measured') continue;"
t5 'exclusions are counted by key'
# Expected RED (measured): expected [ [ …(2) ], [ …(2) ] ] to deeply equal [ [ …(2) ] ].

# M11: a found:false family is built as if found.
mut "$G" "    if (f.found !== true) { notFound.push(key); continue; }" ""
t5 'exclusions are counted by key'
# Expected RED (measured): expected { not_found: [], …(3) } to deeply equal { …(4) }.

# M12: a family with no measured window is kept as a family.
mut "$G" "    if (measured.length === 0) { zeroWindows.push(key); continue; }" ""
t5 'exclusions are counted by key'
# Expected RED (measured): expected [ [ …(2) ], [ …(2) ], [ …(2) ] ] to deeply equal [ [ …(2) ] ].

# M13: an assigned family no report lists is dropped silently.
mut "$G" "      not_listed: [...arms.keys()].filter((k) => !listed.has(k)).sort()," "      not_listed: [],"
t5 'exclusions are counted by key'
# Expected RED (measured): expected { …(4) } to deeply equal { …(4) } (not_listed).

# M14: a family listed twice in one report is merged without a word.
mut "$G" "    if (listed.has(key)) throw new Error(" "    if (false) throw new Error("
t5 'listed twice in one report'
# Expected RED (measured): expected [Function] to throw an error.

# C1: prev_seen_ms null read as +Infinity, so a first observation never drops.
mut "$G" "      if ((r.prev_seen_ms ?? -Infinity) < window.end_ms && r.ts_ms >= window.start_ms) hit.add(" "      if ((r.prev_seen_ms ?? Infinity) < window.end_ms && r.ts_ms >= window.start_ms) hit.add("
t5 'prev_seen_ms null reads as -Infinity'
# Expected RED (measured): expected [] to deeply equal [ Array(1) ].

# C2: the window's start made exclusive.
mut "$G" "      if ((r.prev_seen_ms ?? -Infinity) < window.end_ms && r.ts_ms >= window.start_ms) hit.add(" "      if ((r.prev_seen_ms ?? -Infinity) < window.end_ms && r.ts_ms > window.start_ms) hit.add("
t5 'exactly window.start_ms drops'
# Expected RED (measured): expected [] to deeply equal [ Array(1) ].

# C3: the window's end made inclusive for prev_seen_ms.
mut "$G" "      if ((r.prev_seen_ms ?? -Infinity) < window.end_ms && r.ts_ms >= window.start_ms) hit.add(" "      if ((r.prev_seen_ms ?? -Infinity) <= window.end_ms && r.ts_ms >= window.start_ms) hit.add("
t5 'exactly window.end_ms keeps'
# Expected RED (measured): expected [ Array(1) ] to deeply equal [].

# C4: a change row matched by id alone, across stores.
mut "$G" "const recallOffIdKey = (storeId, id) => canonicalJson([storeId, id]);" "const recallOffIdKey = (storeId, id) => canonicalJson([id]);"
t5 'every listed generation of its id on its store'
# Expected RED (measured): expected [ …(3) ] to deeply equal [ …(2) ].

# C5: a change row matched to one generation only.
mut "$G" "  const changed = [...new Set(list.filter((f) => hit.has(recallOffIdKey(f.store_id, f.ccrc_id)))" "  const changed = [...new Set(list.filter((f) => f.generation === list[0].generation && hit.has(recallOffIdKey(f.store_id, f.ccrc_id)))"
t5 'every listed generation of its id on its store'
# Expected RED (measured): expected [ Array(1) ] to deeply equal [ …(2) ].

# C6: gap rows not reported.
mut "$G" "gaps.push({ store_id: row.store_id, ts_ms: r.ts_ms, from: r.from, to: r.to });" "void 0;"
t5 'a gap row is reported and drops nothing'
# Expected RED (measured): expected [] to deeply equal [ { …(4) }, { …(4) } ].

# C7: a gap row drops every listed family of its store.
mut "$G" "gaps.push({ store_id: row.store_id, ts_ms: r.ts_ms, from: r.from, to: r.to });" "{ gaps.push({ store_id: row.store_id, ts_ms: r.ts_ms, from: r.from, to: r.to }); for (const f of list) if (f.store_id === row.store_id) hit.add(recallOffIdKey(row.store_id, f.ccrc_id)); }"
t5 'a gap row is reported and drops nothing'
# Expected RED (measured): expected [ Array(1) ] to deeply equal [].

# C8: gap rows reported whatever their time.
mut "$G" "      if ((r.from ?? -Infinity) < window.end_ms && r.ts_ms >= window.start_ms) gaps.push(" "      if (true) gaps.push("
t5 'a gap row is reported and drops nothing'
# Expected RED (measured): expected [ { …(4) }, { …(4) }, { …(4) } ] to deeply equal [ { …(4) }, { …(4) } ].

# P1: a key's ts_ms read without its grammar.
mut "$G" "  if (!RECALL_OFF_MS_RE.test(tsText)) return recallOffOffGrammar(k, 'its ts_ms is not a decimal integer');" ""
t5 'off the grammar'
# Expected RED (measured): recall_off:change:015000:demo-a {…}: expected [Function] to throw an error.

# P2: a change row with no prev_seen_ms read anyway.
mut "$G" "  if (!Object.hasOwn(body, 'prev_seen_ms') || !(body.prev_seen_ms === null || isMsValue(body.prev_seen_ms))) {" "  if (false) {"
t5 'off the grammar'
# Expected RED (measured): recall_off:change:15000:demo-a {"from":"absent","to":"value"}: expected [Function] to throw an error.

# P3: an unparseable change row folded into other (no change), the fail-open shape.
mut "$G" "  try { body = JSON.parse(v); } catch { return recallOffOffGrammar(k, 'its value is not JSON'); }" "  try { body = JSON.parse(v); } catch { return { kind: 'other' }; }"
t5 'off the grammar'
# Expected RED (measured): recall_off:change:15000:demo-a not json: expected [Function] to throw an error.

# P4: every recall_off: row that is not a gap read as a change, the state and seen_ms rows included.
mut "$G" "  const kind = rest.startsWith('change:') ? 'change' : rest.startsWith('gap:') ? 'gap' : null;" "  const kind = rest.startsWith('gap:') ? 'gap' : 'change';"
t5 'every other key'
# Expected RED (measured): Error: recall-off meta row "recall_off:state:demo-a": its ts_ms is not a decimal integer.

# X1: the temporary prefix exported.
mut "$G" "const RECALL_OFF_PREFIX_LOCAL = 'recall_off:';" "export const RECALL_OFF_PREFIX_LOCAL = 'recall_off:';"
t5 'prefix is module-local'
# Expected RED (measured): expected [ 'RECALL_OFF_PREFIX_LOCAL' ] to deeply equal [].

git diff --stat -- deploy/history-gate.mjs   # this task's appended section only (and earlier tasks', if not yet committed)
```

Each block reads `1 failed` (measured against the stand-ins; M5b and M5c were measured on a scratch tree of `7d01973a2` in their earlier, report-against-report form, and their record-window form here is predicted, as is M5d, which the final plan review's ruling added; M6b, M6c and M6d, which the code-unmeasured ruling added, are predicted; the skipped count is the rest of the file). Then run Step 5's commands once more: green.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'O14')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean under a tests-inclusive project')
```

Expected: green (predicted).
- O14's `DECL_CORPUS` scans `deploy/`, and this section declares no `VOCABS` name.
- The `ccrc history` describes see no new writer of a recall-off path: the gate reads meta rows only, as data.
- The tests-inclusive typecheck holds the new block, which typechecked clean on the prototype.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-gate.mjs server/test/measure-history.test.ts
git commit -m "feat(history): the W2 gate assembles node reports and finds changed families (W2-3 Task 5)"
```

### Task 6: The bootstrap, the assignment and Q18

This task adds the gate's random draws, its interval and its arm assignment. Every one is seeded from a parameter. Every statistic is an exact fraction.

- **The bootstrap (W2-D18).**
  - A substream's state is the first 16 bytes of `sha256Hex(seedHex + ':' + label)`, read as four little-endian u32 words.
  - The label must be a member of Task 2's closed `SUBSTREAMS` or be `PILOT_SUBSTREAM`. `ASSIGN_LABEL` is a hash label, never a stream.
  - The generator is xoshiro128**, and an all-zero state is refused.
  - Integers are drawn by rejection sampling.
  - The interval takes the nearest-rank percentiles at ranks `ceil(0.025·B)` and `ceil(0.975·B)` over B replicates.
  - Each replicate pools the resampled clusters' counts into one exact fraction, compared by cross-multiplication.
  - The quiz resamples paired: the statistic is `(Σt − Σc) / Σn`. The A/B resamples within one arm: the statistic is `Σwith_call / Σwindows`.
  - A family with 0 measured windows (or 0 questions) is not a cluster.
- **The assignment (W2-D19).**
  - A family's arm is bit 0 of the first byte of sha256 over `seedHex + ':assign:' + canonicalJson([store_id, ccrc_id, generation])`. Bit 1 means treatment, bit 0 control.
  - The list is sorted by canonicalJson, and `assignment_sha256 = sha256Hex(canonicalJson(sorted list))`.
  - No function takes a default seed.
- **Q18's math (W2-D21),** procedure `'bisection-on-grid-crn'`. W2-5a's `power` gathers the inputs.
  - Each family expects `n_f = round(windows_f × planned_days / covered_days)` windows. A family with `n_f = 0` is dropped.
  - Each grid point from X to 1 restarts the `'q18'` substream, so every point shares the same random numbers (CRN).
  - At each point, S simulations each run four steps for every family:
    1. flip the family's arm;
    2. draw p_f from a Beta with mean p and ICC rho;
    3. draw Binomial(n_f, p_f);
    4. run `clusterBootstrap` over the treatment families.
  - A bisection finds the smallest grid point whose pass share reaches the power level and whose upper neighbour's share does too.

**Files:**
- Modify: `deploy/history-gate.mjs`. Append one section at the END of the file, after Task 5's section. The import block stays exactly Task 2's: this section uses `sha256Hex` and `canonicalJson` from it, Task 2's `X`, `BOOTSTRAP`, `SUBSTREAMS`, `PILOT_SUBSTREAM`, `ASSIGN_LABEL`, and `familyKey`, and Task 4's `FamilyRef` typedef. It adds no import (no `node:crypto`: `sha256Hex` answers hex, and the section reads bytes from it).
- Modify: `server/test/measure-history.test.ts`. Append one describe at the end of the file, `'W2-3 Task 6: the bootstrap, the assignment and Q18'`, with one namespace import of the gate, `gate6`, placed directly above it. ESM hoists imports, so an import at the end is legal and names nothing else in the file. It reuses the file's existing `createHash` (`node:crypto`), `readFileSync`, `path`, `ROOT` and `G1`.
- Not edited: `deploy/measure-history.py`, every other test file, `ccd/**`, `shared/**`, the spec, README.md, CLAUDE.md, `.github/**`, `deploy/history-replay.mjs`.

**Interfaces:**
- Consumes:
  - Task 2's constants: `X = {num: 1, den: 10}`, `BOOTSTRAP` (its `B` is `10000`), `SUBSTREAMS` (`['quiz-ci','live-ci','q18','handcheck','quiz-sample','judge-order']`), `PILOT_SUBSTREAM = 'pilot-sample'`, `ASSIGN_LABEL = 'assign'`, `ASSIGNMENT_ARMS`, and `familyKey(storeId, ccrcId, generation) = canonicalJson([storeId, ccrcId, generation])`.
  - Task 4's JSDoc `@typedef` `FamilyRef = {store_id, ccrc_id, generation}`.
  - lib's `sha256Hex` and `canonicalJson`, through Task 2's import block.
- Produces (JSDoc-typed, all exported unless marked private):
  - `@typedef Frac = {readonly num: number, readonly den: number}` and `@typedef Rng = {nextU32: () => number}`. Task 8's `GateVerdict` names `Frac`, and its `decideGate` calls `substream`, `clusterBootstrap`, `frac` and `cmpFrac`. Task 9's validator calls `armOf` and `assignmentSha256`.
  - `frac(num, den): Frac`. It is frozen and never reduced. It throws `RangeError` unless both are safe integers and `den >= 1`.
  - `cmpFrac(a: Frac, b: Frac): -1|0|1` compares exactly. It uses float products while both are ≤ `Number.MAX_SAFE_INTEGER`, and BigInt products past that.
  - `xoshiro128ss(words: [number, number, number, number]): Rng`. It throws on a state that is not four u32 words and on an all-zero state.
  - `substream(seedHex: string, label: string): Rng`. It throws `TypeError` on an empty or non-string seed, and `RangeError` on a label outside `SUBSTREAMS` ∪ {`PILOT_SUBSTREAM`}.
  - `randInt(rng: Rng, n: number): number` draws uniformly from `[0, n)` by rejection, for `n` in `[1, 2^32]`.
  - `nearestRankBounds(B: number): {lowRank: number, highRank: number}`.
  - `clusterBootstrap({clusters, B?, rng, mode}): {point: Frac, lower: Frac, upper: Frac}`.
    - In `mode: 'share'` the clusters are `{num, den}`; in `mode: 'paired'` they are `{t, c, n}`. `B` defaults to `BOOTSTRAP.B`.
    - Zero-denominator clusters are dropped.
    - With none left, it throws `RangeError('clusterBootstrap: no cluster has a measured unit')`. It never answers a number for a missing statistic.
  - `armOf(seedHex: string, f: FamilyRef): 'treatment'|'control'`.
  - `assignArms(seedHex: string, families: FamilyRef[]): Array<FamilyRef & {arm}>` is sorted by canonicalJson and refuses a family listed twice.
  - `assignmentSha256(list): string` sorts a copy itself.
  - `betaDraw(rng, mean, rho): number` and `binomialDraw(rng, n, p): number`.
  - `expectedWindows(families: Array<{key, windows, covered_days}>, plannedDays): Array<{key, n}>`.
  - `q18Power({families, plannedDays, seedHex, rho, power, sims, gridStep, B, x?}): {figure: number|null, procedure: 'bisection-on-grid-crn', points: Array<{p, share}>}`. `power` is one level (W2-5a calls it once per level in `Q18_DEFAULTS.power`).
  - `Q18_DEFAULTS = {rho_headline: 0.3, power: [0.5, 0.8], lookback_days: 14, sims: 1000, grid_step: 0.005, procedure: 'bisection-on-grid-crn'}`, frozen.
  - Private: `bootstrapUnit`, `assertFamilyRef`, `sortByCanonical`, `uniformOpen01`, `normalDraw`, `gammaDraw`, `q18ShareAt`. None of them, and none of the exports above, is a name `lib.mjs` exports. That is the O14 local half Task 2 pins.

**Spec:** §10.2:2713 (the bootstrap, exactly), :2724 (the smallest passing point uptake), :2727 (the coin flip keyed `(store_id, ccrc_id, generation)`) and RP7 (:2746). Decisions: W2-D18, W2-D19, W2-D21. This task defines no D-number and cites none.

**Choices this task makes:**
- **No cluster means no statistic.** `clusterBootstrap` throws rather than answer a number for an empty population. Task 8's `decideGate` never calls it on one: an empty treatment set halts with `HALT_WORDS`' `empty-arm` (the coordinator's ruling), and `q18Power` counts a simulation with no cluster as not passing without bootstrapping it. No null stands in for a measurement.
- **Common random numbers by restart.** Every grid point restarts the `'q18'` substream, so every point starts from the same first word. The draw counts are not fixed:
  - Marsaglia–Tsang's Gamma rejects some draws;
  - rejection sampling redraws some integers (about one word in 10^9 at 20 clusters).
  
  So the streams of two points stay aligned only up to their first differing draw. This keeps determinism, which is the pin, and stays inside the closed label list.
- **A control family draws too.** A control family still draws its p_f and its Binomial, so the stream does not shift with the flip.
- **Two answers are null, never a number:**
  - `figure: null` when the top of the grid misses the power level;
  - `figure: null, points: []` when no family expects a window.
- **Beta parameters.** The shapes are `mean·(1−rho)/rho` and `(1−mean)·(1−rho)/rho`, so the variance is `mean·(1−mean)·rho`.
  - When rho is 0, or the mean is 0 or 1, it returns the mean and draws nothing.
  - When both Gamma draws underflow to 0 (rho near 1), it returns the Beta's limit: an endpoint, 1 with probability `mean`.
- **The draws.** Uniforms take 53 bits from two words and are offset by half a step, so they lie strictly in (0, 1). Normals use Box–Muller. Gammas use Marsaglia–Tsang, with the `U^(1/shape)` boost below shape 1. The Binomial is n Bernoulli trials (2n words).
- **The grid.** Point `i` is the exact quotient `(x.num·N + i·(x.den − x.num)) / (x.den·N)`, with `N = (1 − x)/gridStep`. A step that does not divide `1 − x` is refused.
- **Cost at the defaults (measured).** With 12 families, S = 50, B = 10,000 and step 0.005 took 8.1 s. At S = 1000 that scales to about 160 s per power level, which is W2-5a's `power` runtime and not a gate concern.

- [ ] **Step 1: Confirm the names this task consumes.** From the repository root:

```bash
grep -c "^export const SUBSTREAMS = " deploy/history-gate.mjs
grep -c "^export const PILOT_SUBSTREAM = 'pilot-sample';" deploy/history-gate.mjs
grep -c "^export const ASSIGN_LABEL = 'assign';" deploy/history-gate.mjs
grep -c "^export const BOOTSTRAP = " deploy/history-gate.mjs
grep -c "^export const ASSIGNMENT_ARMS = " deploy/history-gate.mjs
grep -c "^export function familyKey(" deploy/history-gate.mjs
grep -c "@typedef .*FamilyRef" deploy/history-gate.mjs
grep -cE "@typedef .* (Frac|Rng)\b" deploy/history-gate.mjs
node --input-type=module -e "const g = await import('./deploy/history-gate.mjs'); console.log(JSON.stringify([g.X, g.BOOTSTRAP.B, g.SUBSTREAMS, g.PILOT_SUBSTREAM, g.ASSIGN_LABEL, [...g.ASSIGNMENT_ARMS].sort(), g.familyKey('s', 'c', 'g')]))"
```

Expected:
- Each of the first seven counts is 1.
- The eighth is 0: no earlier task declares `Frac` or `Rng`.
- The last line prints `[{"num":1,"den":10},10000,["quiz-ci","live-ci","q18","handcheck","quiz-sample","judge-order"],"pilot-sample","assign",["control","treatment"],"[\"s\",\"c\",\"g\"]"]`.

Any other answer is a gap in Task 2 or Task 4. Stop and report it, and never declare any of those names here.

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/measure-history.test.ts`:

```ts

// ── W2-3 Task 6: the bootstrap, the assignment and Q18 (W2-D18, W2-D19, W2-D21) ─────────────────────────────────────
// Pure: every seed is a parameter. The seed is assembled at runtime and is no real draw; store ids, ccrc ids and
// generations are synthetic. The xoshiro128** reference words were re-derived by an independent implementation.
import * as gate6 from '../../deploy/history-gate.mjs';

describe('W2-3 Task 6: the bootstrap, the assignment and Q18', () => {
  const SEED6 = '5eed'.repeat(16);
  const OTHER_SEED6 = 'd1ce'.repeat(16);
  const STORE6_A = '00000000-0000-4000-8000-0000000000a1';
  const STORE6_B = '00000000-0000-4000-8000-0000000000a2';
  const take = (rng: { nextU32: () => number }, n: number): number[] => Array.from({ length: n }, () => rng.nextU32());
  /** The stream substream(seed, label) must equal: sha256(seed:label)'s first 16 bytes as four little-endian words. */
  const wordsOf = (seed: string, label: string): [number, number, number, number] => {
    const d = createHash('sha256').update(`${seed}:${label}`, 'utf8').digest();
    return [d.readUInt32LE(0), d.readUInt32LE(4), d.readUInt32LE(8), d.readUInt32LE(12)];
  };
  /** An rng that answers the given words in order, then throws. */
  const scripted = (ws: number[]): { nextU32: () => number; used: () => number } => {
    let i = 0;
    return { nextU32: () => { if (i >= ws.length) throw new Error('scripted rng ran dry'); return ws[i++]!; }, used: () => i };
  };
  const fam6 = (store: string, id: string): { store_id: string; ccrc_id: string; generation: string } =>
    ({ store_id: store, ccrc_id: id, generation: G1 });
  const TWELVE = Array.from({ length: 12 }, (_, i) => fam6(STORE6_A, `wrap-a-proj-${String.fromCharCode(97 + i)}`));

  it('xoshiro128** from the state [1, 2, 3, 4] gives the reference words', () => {
    expect(take(gate6.xoshiro128ss([1, 2, 3, 4]), 6)).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492]);
  });

  it('an all-zero state is refused, and so is a state that is not four u32 words', () => {
    expect(() => gate6.xoshiro128ss([0, 0, 0, 0])).toThrow(/all-zero state is refused/);
    expect(() => gate6.xoshiro128ss([1, 2, 3] as unknown as [number, number, number, number])).toThrow(/four u32 words/);
    expect(() => gate6.xoshiro128ss([1, 2, 3, 2 ** 32])).toThrow(/four u32 words/);
  });

  it('a substream is sha256(seed:label)\'s first 16 bytes as four little-endian words; the same seed and label give the same stream twice, another label or seed another', () => {
    const live = take(gate6.substream(SEED6, 'live-ci'), 8);
    expect(live).toEqual(take(gate6.xoshiro128ss(wordsOf(SEED6, 'live-ci')), 8));
    expect(take(gate6.substream(SEED6, 'live-ci'), 8)).toEqual(live);
    expect(take(gate6.substream(SEED6, 'quiz-ci'), 8)).not.toEqual(live);
    expect(take(gate6.substream(OTHER_SEED6, 'live-ci'), 8)).not.toEqual(live);
  });

  it('every SUBSTREAMS label and PILOT_SUBSTREAM opens a stream; any other label, ASSIGN_LABEL included, is refused', () => {
    for (const label of [...gate6.SUBSTREAMS, gate6.PILOT_SUBSTREAM]) expect(() => gate6.substream(SEED6, label)).not.toThrow();
    expect(() => gate6.substream(SEED6, gate6.ASSIGN_LABEL)).toThrow(/is not a substream label/);
    expect(() => gate6.substream(SEED6, 'q19')).toThrow(/is not a substream label/);
    expect(() => gate6.substream('', 'q18')).toThrow(/the seed is a non-empty string/);
  });

  it('randInt draws by rejection: a word at or above the largest multiple of n below 2^32 is drawn again', () => {
    const n = 3 * 2 ** 30;   // the largest multiple of n below 2^32 is n itself: a quarter of the words are redrawn
    const r = scripted([2 ** 32 - 1, 5]);
    expect(gate6.randInt(r, n)).toBe(5);
    expect(r.used()).toBe(2);
    const rng = gate6.substream(SEED6, 'live-ci');
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const v = gate6.randInt(rng, 7);
      expect(Number.isInteger(v) && v >= 0 && v < 7, String(v)).toBe(true);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
  });

  it('randInt is unbiased on a constructed bound where a bare modulo is not: draws below 2^30 out of [0, 3 * 2^30) are a third, not a half', () => {
    const n = 3 * 2 ** 30;
    const rng = gate6.substream(SEED6, 'live-ci');
    let low = 0;
    for (let i = 0; i < 3000; i++) if (gate6.randInt(rng, n) < 2 ** 30) low += 1;
    expect(low / 3000).toBeGreaterThan(0.30);
    expect(low / 3000).toBeLessThan(0.37);
  });

  it('the nearest-rank ranks are ceil(0.025 B) and ceil(0.975 B): 250 and 9,750 at B = 10,000; 1 and 30 at B = 30', () => {
    expect(gate6.nearestRankBounds(10_000)).toEqual({ lowRank: 250, highRank: 9_750 });
    expect(gate6.nearestRankBounds(gate6.BOOTSTRAP.B)).toEqual({ lowRank: 250, highRank: 9_750 });
    expect(gate6.nearestRankBounds(30)).toEqual({ lowRank: 1, highRank: 30 });
  });

  it('a family with 0 measured windows is not a cluster: the result is the one without it, draw for draw; with none left there is no statistic', () => {
    const real = [{ num: 3, den: 5 }, { num: 0, den: 4 }, { num: 2, den: 2 }];
    const withEmpty = gate6.clusterBootstrap({ clusters: [...real, { num: 0, den: 0 }], B: 400, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' });
    const without = gate6.clusterBootstrap({ clusters: real, B: 400, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' });
    expect(withEmpty).toEqual(without);
    expect(withEmpty.point).toEqual({ num: 5, den: 11 });
    const paired = [{ t: 2, c: 1, n: 3 }, { t: 1, c: 1, n: 2 }];
    expect(gate6.clusterBootstrap({ clusters: [...paired, { t: 0, c: 0, n: 0 }], B: 400, rng: gate6.substream(SEED6, 'quiz-ci'), mode: 'paired' }))
      .toEqual(gate6.clusterBootstrap({ clusters: paired, B: 400, rng: gate6.substream(SEED6, 'quiz-ci'), mode: 'paired' }));
    expect(() => gate6.clusterBootstrap({ clusters: [{ num: 0, den: 0 }], B: 400, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' }))
      .toThrow(/no cluster has a measured unit/);
  });

  it('the statistic is pooled and exact: share is sum(with_call) / sum(windows), paired is (sum t - sum c) / sum n, never reduced, never a float', () => {
    const s = gate6.clusterBootstrap({ clusters: [{ num: 1, den: 3 }, { num: 1, den: 7 }], B: 400, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' });
    expect(s.point).toEqual({ num: 2, den: 10 });
    const p = gate6.clusterBootstrap({ clusters: [{ t: 3, c: 1, n: 4 }, { t: 1, c: 1, n: 2 }], B: 400, rng: gate6.substream(SEED6, 'quiz-ci'), mode: 'paired' });
    expect(p.point).toEqual({ num: 2, den: 6 });
    for (const r of [s, p]) {
      for (const f of [r.point, r.lower, r.upper]) expect(Number.isSafeInteger(f.num) && Number.isSafeInteger(f.den) && f.den >= 1, JSON.stringify(f)).toBe(true);
      expect(gate6.cmpFrac(r.lower, r.point)).toBeLessThanOrEqual(0);
      expect(gate6.cmpFrac(r.point, r.upper)).toBeLessThanOrEqual(0);
    }
    expect(() => gate6.clusterBootstrap({ clusters: [{ t: 3, c: 1, n: 4 }], B: 400, rng: gate6.substream(SEED6, 'quiz-ci'), mode: 'share' }))
      .toThrow(/is not a share cluster/);
  });

  it('the order is exact: two fractions one float apart compare unequal, and a product past 2^53 compares in BigInt', () => {
    const third = gate6.frac(1, 3);
    const near = gate6.frac(3_002_399_751_580_330, 9_007_199_254_740_991);   // 1/3 - 1/(3 * (2^53 - 1))
    expect(near.num / near.den, 'CONTROL: as floats the two are one value').toBe(1 / 3);
    expect(gate6.cmpFrac(near, third)).toBe(-1);
    expect(gate6.cmpFrac(third, near)).toBe(1);
    expect(gate6.cmpFrac(gate6.frac(2, 6), third)).toBe(0);
    const big = 2 ** 53;
    expect(gate6.cmpFrac(gate6.frac(big - 1, big - 2), gate6.frac(big - 2, big - 3))).toBe(-1);
    expect(() => gate6.frac(1, 0)).toThrow(/not an exact fraction/);
    expect(() => gate6.frac(0.5, 1)).toThrow(/not an exact fraction/);
  });

  it('the same seed and clusters give the same interval twice; B defaults to BOOTSTRAP.B and is injectable', () => {
    const clusters = [{ num: 1, den: 4 }, { num: 0, den: 3 }, { num: 2, den: 2 }, { num: 1, den: 5 }];
    const once = gate6.clusterBootstrap({ clusters, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' });
    expect(gate6.clusterBootstrap({ clusters, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' })).toEqual(once);
    expect(gate6.clusterBootstrap({ clusters, B: gate6.BOOTSTRAP.B, rng: gate6.substream(SEED6, 'live-ci'), mode: 'share' })).toEqual(once);
  });

  it('a family\'s arm is bit 0 of the first byte of sha256(seed:assign:canonicalJson([store_id, ccrc_id, generation])), 1 treatment', () => {
    for (const f of TWELVE) {
      const bit = createHash('sha256').update(`${SEED6}:assign:${JSON.stringify([f.store_id, f.ccrc_id, f.generation])}`, 'utf8').digest()[0]! & 1;
      expect(gate6.armOf(SEED6, f), f.ccrc_id).toBe(bit === 1 ? 'treatment' : 'control');
      expect(gate6.ASSIGNMENT_ARMS).toContain(gate6.armOf(SEED6, f));
    }
    expect(new Set(TWELVE.map((f) => gate6.armOf(SEED6, f))).size, 'CONTROL: the fixture holds both arms').toBe(2);
  });

  it('removing one family leaves every other family\'s arm unchanged', () => {
    const all = new Map(gate6.assignArms(SEED6, TWELVE).map((e) => [e.ccrc_id, e.arm]));
    for (let drop = 0; drop < TWELVE.length; drop++) {
      for (const e of gate6.assignArms(SEED6, TWELVE.filter((_, i) => i !== drop))) expect(e.arm, `${drop}: ${e.ccrc_id}`).toBe(all.get(e.ccrc_id));
    }
  });

  it('shuffled input gives the same list, sorted by canonicalJson, and the same assignment_sha256', () => {
    const list = gate6.assignArms(SEED6, TWELVE);
    const shuffled = [...TWELVE.slice(7), ...TWELVE.slice(0, 7).reverse()];
    expect(gate6.assignArms(SEED6, shuffled)).toEqual(list);
    const canon = list.map((e) => JSON.stringify({ arm: e.arm, ccrc_id: e.ccrc_id, generation: e.generation, store_id: e.store_id }));
    expect(canon).toEqual([...canon].sort());
    const sha = createHash('sha256').update(`[${canon.join(',')}]`, 'utf8').digest('hex');
    expect(gate6.assignmentSha256(list)).toBe(sha);
    expect(gate6.assignmentSha256([...list].reverse())).toBe(sha);
    const tampered = list.map((e, i) => (i === 0 ? { ...e, arm: e.arm === 'treatment' ? 'control' : 'treatment' } : e));
    expect(gate6.assignmentSha256(tampered)).not.toBe(sha);
    expect(() => gate6.assignArms(SEED6, [TWELVE[0]!, TWELVE[0]!])).toThrow(/is listed twice/);
  });

  it('RP7-pure: one ccrc id string on two stores is two families with two independent draws (this seed gives them different arms)', () => {
    const a = fam6(STORE6_A, 'wrap-a-proj-a');
    const b = fam6(STORE6_B, 'wrap-a-proj-a');
    expect(gate6.armOf(SEED6, a)).toBe('control');
    expect(gate6.armOf(SEED6, b)).toBe('treatment');
    expect(gate6.assignArms(SEED6, [a, b])).toHaveLength(2);
  });

  it('betaDraw has mean p and variance p (1 - p) rho; rho 0 gives p and draws nothing', () => {
    const rng = gate6.substream(SEED6, 'q18');
    expect(gate6.betaDraw(rng, 0.3, 0)).toBe(0.3);
    expect(rng.nextU32(), 'rho 0 took no word').toBe(gate6.substream(SEED6, 'q18').nextU32());
    const draws = Array.from({ length: 4000 }, () => gate6.betaDraw(rng, 0.3, 0.3));
    const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
    const variance = draws.reduce((s, v) => s + (v - mean) ** 2, 0) / (draws.length - 1);
    expect(mean).toBeGreaterThan(0.28);
    expect(mean).toBeLessThan(0.32);
    expect(variance).toBeGreaterThan(0.055);
    expect(variance).toBeLessThan(0.071);
    expect(draws.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('binomialDraw stays in [0, n], gives 0 at p 0 and n at p 1, and has mean n p', () => {
    const rng = gate6.substream(SEED6, 'q18');
    expect(gate6.binomialDraw(rng, 10, 0)).toBe(0);
    expect(gate6.binomialDraw(rng, 10, 1)).toBe(10);
    const draws = Array.from({ length: 2000 }, () => gate6.binomialDraw(rng, 10, 0.3));
    expect(draws.every((k) => Number.isInteger(k) && k >= 0 && k <= 10)).toBe(true);
    const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
    expect(mean).toBeGreaterThan(2.85);
    expect(mean).toBeLessThan(3.15);
  });

  it('expected windows are round(windows * planned_days / covered_days), and a family expecting 0 is dropped', () => {
    expect(gate6.expectedWindows([
      { key: 'k1', windows: 3, covered_days: 7 },
      { key: 'k2', windows: 1, covered_days: 28 },
      { key: 'k3', windows: 1, covered_days: 30 },
      { key: 'k4', windows: 0, covered_days: 14 },
    ], 14)).toEqual([{ key: 'k1', n: 6 }, { key: 'k2', n: 1 }]);
    expect(() => gate6.expectedWindows([{ key: 'k1', windows: 3, covered_days: 0 }], 14)).toThrow(/positive covered_days/);
  });

  const Q18_FAMILIES = Array.from({ length: 12 }, (_, i) => ({ key: `fam-${String(i).padStart(2, '0')}`, windows: 4 + (i % 4), covered_days: 14 }));
  const q18Input = (o: Partial<Parameters<typeof gate6.q18Power>[0]> = {}): Parameters<typeof gate6.q18Power>[0] =>
    ({ families: Q18_FAMILIES, plannedDays: 14, seedHex: SEED6, rho: 0.3, power: 0.5, sims: 24, gridStep: 0.05, B: 200, ...o });

  it('Q18 is deterministic for small injected S and B, and another seed gives other shares', () => {
    const once = gate6.q18Power(q18Input());
    expect(gate6.q18Power(q18Input())).toEqual(once);
    expect(once.procedure).toBe('bisection-on-grid-crn');
    expect(gate6.q18Power(q18Input({ seedHex: OTHER_SEED6 })).points).not.toEqual(once.points);
  });

  it('Q18\'s figure is a grid point at least X whose share and upper neighbour\'s share reach the power level, and the point below it does not', () => {
    const step = q18Input().gridStep;
    const x = gate6.X.num / gate6.X.den;
    // 0.95 is a level where this fixture's shares are not monotone in p (0.55 passes, 0.6 does not), so the
    // upper-neighbour clause decides the figure there.
    for (const power of [...gate6.Q18_DEFAULTS.power, 0.95]) {
      const r = gate6.q18Power(q18Input({ power }));
      expect(r.figure, `power ${power}`).not.toBeNull();
      const fig = r.figure!;
      expect(fig).toBeGreaterThanOrEqual(x);
      const at = (p: number): number | undefined => r.points.find((q) => Math.abs(q.p - p) < 1e-9)?.share;
      expect(at(fig), `power ${power}: the figure's own share`).toBeGreaterThanOrEqual(power);
      const up = at(fig + step);
      if (fig < 1 - 1e-9) expect(up !== undefined && up >= power, `power ${power}: its upper neighbour's share (${up}) reaches it`).toBe(true);
      const below = at(fig - step);
      if (fig > x + 1e-9) expect(below !== undefined && below < power, `power ${power}: the point below's share (${below}) misses it`).toBe(true);
      expect(r.points.map((q) => q.p)).toEqual(r.points.map((q) => q.p).sort((a, b) => a - b));
    }
  });

  it('Q18 answers null, never a number, when no family expects a window or the top of the grid misses the power level', () => {
    expect(gate6.q18Power(q18Input({ families: [{ key: 'fam-00', windows: 1, covered_days: 30 }] })))
      .toEqual({ figure: null, procedure: 'bisection-on-grid-crn', points: [] });
    const one = gate6.q18Power(q18Input({ families: [{ key: 'fam-00', windows: 6, covered_days: 14 }], power: 0.8 }));
    expect(one.figure).toBeNull();
    expect(one.points).toHaveLength(1);
    expect(one.points[0]!.p).toBe(1);
    expect(one.points[0]!.share).toBeLessThan(0.8);
  });

  it('Q18_DEFAULTS are part 1\'s q18_settings, and the grid must divide the span from X to 1', () => {
    expect(gate6.Q18_DEFAULTS).toEqual({ rho_headline: 0.3, power: [0.5, 0.8], lookback_days: 14, sims: 1000, grid_step: 0.005, procedure: 'bisection-on-grid-crn' });
    expect(Object.isFrozen(gate6.Q18_DEFAULTS)).toBe(true);
    expect(() => gate6.q18Power(q18Input({ gridStep: 0.07 }))).toThrow(/does not divide 1 - x/);
  });

  it('no Task 6 function takes a default seed: every seed is a parameter', () => {
    const src = readFileSync(path.join(ROOT, 'deploy', 'history-gate.mjs'), 'utf8');
    const DEFAULT_SEED = /[(,{]\s*seedHex\s*=(?!=)/;
    expect(src.split('\n').filter((l) => DEFAULT_SEED.test(l))).toEqual([]);
    expect(DEFAULT_SEED.test('export function armOf(seedHex = SEED, f) {'), 'CONTROL: the needle sees a default parameter').toBe(true);
    expect(DEFAULT_SEED.test('export function q18Power({ families, seedHex = SEED }) {'), 'CONTROL: and a destructured one').toBe(true);
    expect(DEFAULT_SEED.test("  if (typeof seedHex !== 'string' || seedHex === '') throw"), 'CONTROL: a comparison is not a default').toBe(false);
  });
});
```

Fixture notes:
- I derived the reference words `11520, 0, 5927040, 70819200, 2031721883, 1637235492` independently: a 10-line Python xoshiro128** run from TMPDIR (`python3 -I`), with masks of `0xFFFFFFFF`. They match the published reference sequence for state `[1, 2, 3, 4]`.
- RP7's pair is measured under `SEED6`: store `…a1` draws control and store `…a2` draws treatment, for the same `wrap-a-proj-a` and `G1`.
- `near` is the integer fraction `(q − 1)/3 / q` with `q = 2^53 − 1`, which is 1/3 minus `1/(3q)`. Its double is the double of 1/3, so a float order calls the two equal.

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 6')
```

Expected: red, `22 failed | 1 passed`. I measured this against a stand-in for Tasks 2 to 5's constants with this section absent.
- The one that passes is the default-seed source pin: there is no Task 6 code yet, so there is no default.
- Every other case fails with a `TypeError`, for example `armOf is not a function`, `frac is not a function` or `Cannot read properties of undefined (reading 'power')`.

- [ ] **Step 4: Write the section.** Append at the END of `deploy/history-gate.mjs`:

```js

// ── W2-3 Task 6: the bootstrap, the assignment and Q18 (W2-D18, W2-D19, W2-D21) ────────────────────────────────────
// Every draw the gate makes comes from here, and every one is seeded from a parameter: no function below reads a
// seed, a clock or an ambient source of randomness, and none takes a default seed. A substream's state is the first
// 16 bytes of sha256Hex(seedHex + ':' + label), read as four little-endian u32 words, over the closed SUBSTREAMS plus
// PILOT_SUBSTREAM (passed only with the pilot's own seed); the generator is xoshiro128**, and an all-zero state is
// refused. Integers are drawn by rejection, never by a bare modulo. Every statistic is an exact integer fraction,
// pooled per resample and compared by cross-multiplication. A family's arm is one hash bit of its own key (W2-D19),
// so no family's arm depends on which other families are listed. Q18 (W2-D21) is the math only: W2-5a's `power`
// gathers its inputs.

/** An exact fraction: safe integers, den >= 1, never reduced (a pooled statistic keeps its counts).
 *  @typedef {{ readonly num: number, readonly den: number }} Frac */
/** A seeded stream of u32 words.
 *  @typedef {{ nextU32: () => number }} Rng */

/**
 * @param {number} num
 * @param {number} den
 * @returns {Frac}
 */
export function frac(num, den) {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den < 1) {
    throw new RangeError(`frac: ${num}/${den} is not an exact fraction (safe integers, den >= 1)`);
  }
  return Object.freeze({ num, den });
}

/**
 * The sign of a.num * b.den - b.num * a.den. A product past 2^53 is taken again in BigInt, so the answer is exact
 * at every size: a float product at or below MAX_SAFE_INTEGER is the exact product.
 * @param {Frac} a
 * @param {Frac} b
 * @returns {-1|0|1}
 */
export function cmpFrac(a, b) {
  const l = a.num * b.den;
  const r = b.num * a.den;
  if (Math.abs(l) <= Number.MAX_SAFE_INTEGER && Math.abs(r) <= Number.MAX_SAFE_INTEGER) return l < r ? -1 : l > r ? 1 : 0;
  const L = BigInt(a.num) * BigInt(b.den);
  const R = BigInt(b.num) * BigInt(a.den);
  return L < R ? -1 : L > R ? 1 : 0;
}

/**
 * xoshiro128** (Blackman and Vigna, 2018) over four u32 words. A zero state stays zero for ever, so it is refused.
 * @param {[number, number, number, number]} words
 * @returns {Rng}
 */
export function xoshiro128ss(words) {
  if (!Array.isArray(words) || words.length !== 4 || !words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffffffff)) {
    throw new RangeError('xoshiro128ss: the state is four u32 words');
  }
  if (words.every((w) => w === 0)) throw new RangeError('xoshiro128ss: an all-zero state is refused');
  let [s0, s1, s2, s3] = words;
  const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return {
    nextU32() {
      const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
      const t = (s1 << 9) >>> 0;
      s2 = (s2 ^ s0) >>> 0;
      s3 = (s3 ^ s1) >>> 0;
      s1 = (s1 ^ s2) >>> 0;
      s0 = (s0 ^ s3) >>> 0;
      s2 = (s2 ^ t) >>> 0;
      s3 = rotl(s3, 11);
      return result;
    },
  };
}

/**
 * The stream for one label of one seed (W2-D18). The label must be a SUBSTREAMS member or PILOT_SUBSTREAM: the
 * assignment's ASSIGN_LABEL is a hash label, never a stream.
 * @param {string} seedHex
 * @param {string} label
 * @returns {Rng}
 */
export function substream(seedHex, label) {
  if (typeof seedHex !== 'string' || seedHex === '') throw new TypeError('substream: the seed is a non-empty string, passed in');
  if (!SUBSTREAMS.includes(label) && label !== PILOT_SUBSTREAM) throw new RangeError(`substream: '${label}' is not a substream label`);
  const hex = sha256Hex(`${seedHex}:${label}`);
  const byte = (i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const word = (w) => (byte(w * 4) | (byte(w * 4 + 1) << 8) | (byte(w * 4 + 2) << 16) | (byte(w * 4 + 3) << 24)) >>> 0;
  return xoshiro128ss([word(0), word(1), word(2), word(3)]);
}

/**
 * A uniform integer in [0, n), by rejection: a word at or above the largest multiple of n below 2^32 is drawn again.
 * @param {Rng} rng
 * @param {number} n
 * @returns {number}
 */
export function randInt(rng, n) {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new RangeError(`randInt: n=${n} is not an integer in [1, 2^32]`);
  const limit = 0x100000000 - (0x100000000 % n);
  for (;;) {
    const w = rng.nextU32();
    if (w < limit) return w % n;
  }
}

/**
 * The nearest-rank percentile ranks (1-based) of a 95% interval over B sorted replicates: ceil(0.025 B), ceil(0.975 B).
 * @param {number} B
 * @returns {{ lowRank: number, highRank: number }}
 */
export function nearestRankBounds(B) {
  if (!Number.isSafeInteger(B) || B < 1) throw new RangeError(`nearestRankBounds: B=${B} is not a positive integer`);
  return { lowRank: Math.ceil((B * 25) / 1000), highRank: Math.ceil((B * 975) / 1000) };
}

/**
 * One cluster's counts as a pooled numerator and denominator. share: {num: windows with a call, den: measured
 * windows}. paired: {t: correct in treatment, c: correct in control, n: questions}, giving (t - c) over n.
 * @param {{num: number, den: number} | {t: number, c: number, n: number}} k
 * @param {'paired'|'share'} mode
 * @returns {{ num: number, den: number }}
 */
function bootstrapUnit(k, mode) {
  const nat = (v) => Number.isSafeInteger(v) && v >= 0;
  if (mode === 'share') {
    const s = /** @type {{num: number, den: number}} */ (k);
    if (!nat(s.num) || !nat(s.den) || s.num > s.den) throw new RangeError(`clusterBootstrap: ${JSON.stringify(k)} is not a share cluster`);
    return { num: s.num, den: s.den };
  }
  const q = /** @type {{t: number, c: number, n: number}} */ (k);
  if (!nat(q.t) || !nat(q.c) || !nat(q.n) || q.t > q.n || q.c > q.n) throw new RangeError(`clusterBootstrap: ${JSON.stringify(k)} is not a paired cluster`);
  return { num: q.t - q.c, den: q.n };
}

/**
 * The session-cluster bootstrap (W2-D18): B resamples of the clusters with replacement, each replicate the pooled
 * exact fraction of the resampled clusters' counts, and the nearest-rank 95% interval. A cluster with a zero
 * denominator (a family with 0 measured windows, or 0 questions) is not a cluster. With no cluster left it throws:
 * there is no statistic, and no number stands in for one.
 * @param {{ clusters: Array<{num: number, den: number} | {t: number, c: number, n: number}>, B?: number, rng: Rng, mode: 'paired'|'share' }} input
 * @returns {{ point: Frac, lower: Frac, upper: Frac }}
 */
export function clusterBootstrap({ clusters, B = BOOTSTRAP.B, rng, mode }) {
  if (mode !== 'paired' && mode !== 'share') throw new RangeError(`clusterBootstrap: mode '${mode}' is neither paired nor share`);
  const units = clusters.map((k) => bootstrapUnit(k, mode)).filter((u) => u.den > 0);
  if (units.length === 0) throw new RangeError('clusterBootstrap: no cluster has a measured unit');
  const { lowRank, highRank } = nearestRankBounds(B);
  const m = units.length;
  /** @type {Frac[]} */
  const reps = new Array(B);
  for (let b = 0; b < B; b++) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < m; i++) {
      const u = units[randInt(rng, m)];
      num += u.num;
      den += u.den;
    }
    reps[b] = frac(num, den);
  }
  reps.sort(cmpFrac);
  let num = 0;
  let den = 0;
  for (const u of units) {
    num += u.num;
    den += u.den;
  }
  return { point: frac(num, den), lower: reps[lowRank - 1], upper: reps[highRank - 1] };
}

/** @param {unknown} f @returns {asserts f is FamilyRef} */
function assertFamilyRef(f) {
  const o = /** @type {Record<string, unknown>} */ (f);
  if (o === null || typeof o !== 'object' || typeof o.store_id !== 'string' || typeof o.ccrc_id !== 'string' || typeof o.generation !== 'string') {
    throw new TypeError(`assignment: ${JSON.stringify(f)} is not a family (store_id, ccrc_id, generation)`);
  }
}

/**
 * A family's arm (W2-D19): bit 0 of the first byte of sha256 over the UTF-8 bytes of
 * seedHex + ':assign:' + canonicalJson([store_id, ccrc_id, generation]); 1 is treatment, 0 control.
 * @param {string} seedHex
 * @param {FamilyRef} f
 * @returns {'treatment'|'control'}
 */
export function armOf(seedHex, f) {
  if (typeof seedHex !== 'string' || seedHex === '') throw new TypeError('armOf: the seed is a non-empty string, passed in');
  assertFamilyRef(f);
  const h = sha256Hex(`${seedHex}:${ASSIGN_LABEL}:${familyKey(f.store_id, f.ccrc_id, f.generation)}`);
  return (parseInt(h.slice(0, 2), 16) & 1) === 1 ? 'treatment' : 'control';
}

/**
 * Entries sorted by their canonicalJson, compared as strings.
 * @template T
 * @param {T[]} list
 * @returns {T[]}
 */
function sortByCanonical(list) {
  return list.map((e) => /** @type {[string, T]} */ ([canonicalJson(e), e]))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, e]) => e);
}

/**
 * The assignment list: every family with its arm, sorted by canonicalJson. A family listed twice is refused.
 * @param {string} seedHex
 * @param {FamilyRef[]} families
 * @returns {Array<FamilyRef & { arm: 'treatment'|'control' }>}
 */
export function assignArms(seedHex, families) {
  const seen = new Set();
  return sortByCanonical(families.map((f) => {
    assertFamilyRef(f);
    const key = familyKey(f.store_id, f.ccrc_id, f.generation);
    if (seen.has(key)) throw new RangeError(`assignArms: family ${key} is listed twice`);
    seen.add(key);
    return { store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation, arm: armOf(seedHex, f) };
  }));
}

/**
 * assignment_sha256 (W2-D19): sha256Hex(canonicalJson(the list sorted by canonicalJson)). It sorts a copy itself,
 * so the order an input arrives in never moves it; a changed arm does.
 * @param {Array<FamilyRef & { arm: string }>} list
 * @returns {string}
 */
export function assignmentSha256(list) {
  return sha256Hex(canonicalJson(sortByCanonical([...list])));
}

/** A double in (0, 1) from two words (53 bits, offset by half a step, so neither end is reached). @param {Rng} rng */
function uniformOpen01(rng) {
  const a = rng.nextU32() >>> 5;
  const b = rng.nextU32() >>> 6;
  return (a * 67108864 + b + 0.5) / 9007199254740992;
}

/** A standard normal draw: Box and Muller, one of the pair. @param {Rng} rng */
function normalDraw(rng) {
  const u1 = uniformOpen01(rng);
  const u2 = uniformOpen01(rng);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** A Gamma(shape, 1) draw: Marsaglia and Tsang (2000), with the U^(1/shape) boost below shape 1.
 *  @param {Rng} rng @param {number} shape @returns {number} */
function gammaDraw(rng, shape) {
  if (shape < 1) {
    const g = gammaDraw(rng, shape + 1);
    return g * Math.pow(uniformOpen01(rng), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normalDraw(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = uniformOpen01(rng);
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/**
 * p_f for one family (W2-D21): a Beta with mean `mean` and intra-cluster correlation `rho`, that is shapes
 * mean (1 - rho) / rho and (1 - mean) (1 - rho) / rho, so its variance is mean (1 - mean) rho. rho 0 (and a mean of
 * 0 or 1) gives the mean itself and draws nothing. Two Gamma draws that both underflow to 0 (shapes near 0, rho near
 * 1) answer the Beta's own limit, an endpoint drawn with probability `mean`.
 * @param {Rng} rng
 * @param {number} mean
 * @param {number} rho
 * @returns {number}
 */
export function betaDraw(rng, mean, rho) {
  if (!(mean >= 0 && mean <= 1)) throw new RangeError(`betaDraw: mean ${mean} is outside [0, 1]`);
  if (!(rho >= 0 && rho < 1)) throw new RangeError(`betaDraw: rho ${rho} is outside [0, 1)`);
  if (rho === 0 || mean === 0 || mean === 1) return mean;
  const k = (1 - rho) / rho;
  const x = gammaDraw(rng, mean * k);
  const y = gammaDraw(rng, (1 - mean) * k);
  if (x + y === 0) return uniformOpen01(rng) < mean ? 1 : 0;
  return x / (x + y);
}

/**
 * A Binomial(n, p) draw as n Bernoulli trials; it always takes 2n words, whatever p.
 * @param {Rng} rng
 * @param {number} n
 * @param {number} p
 * @returns {number}
 */
export function binomialDraw(rng, n, p) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`binomialDraw: n=${n} is not a count`);
  if (!(p >= 0 && p <= 1)) throw new RangeError(`binomialDraw: p ${p} is outside [0, 1]`);
  let k = 0;
  for (let i = 0; i < n; i++) if (uniformOpen01(rng) < p) k += 1;
  return k;
}

/**
 * Per-family expected windows over the planned window (W2-D21): n_f = round(windows_f * planned_days /
 * covered_days), Math.round's half-up; a family whose n_f is 0 is dropped.
 * @param {Array<{ key: string, windows: number, covered_days: number }>} families
 * @param {number} plannedDays
 * @returns {Array<{ key: string, n: number }>}
 */
export function expectedWindows(families, plannedDays) {
  if (!(plannedDays > 0)) throw new RangeError(`expectedWindows: planned_days ${plannedDays} is not positive`);
  /** @type {Array<{ key: string, n: number }>} */
  const out = [];
  for (const f of families) {
    if (!Number.isSafeInteger(f.windows) || f.windows < 0 || !(f.covered_days > 0)) {
      throw new RangeError(`expectedWindows: ${JSON.stringify(f)} needs a window count and a positive covered_days`);
    }
    const n = Math.round((f.windows * plannedDays) / f.covered_days);
    if (n > 0) out.push({ key: f.key, n });
  }
  return out;
}

/** Q18's defaults as part 1 records them (section 4's q18_settings). */
export const Q18_DEFAULTS = Object.freeze({
  rho_headline: 0.3, power: Object.freeze([0.5, 0.8]), lookback_days: 14, sims: 1000, grid_step: 0.005,
  procedure: /** @type {'bisection-on-grid-crn'} */ ('bisection-on-grid-crn'),
});

/**
 * The pass share at one grid point: `sims` simulations from a fresh 'q18' stream (common random numbers: every
 * point starts from the same first draw). Each simulation flips every family (one word, bit 0: 1 is treatment),
 * draws its p_f and its Binomial(n_f, p_f) windows with a call, draws all three for a control family too so the
 * stream stays aligned, and runs clusterBootstrap over the treatment families; it passes when the lower bound is
 * at least x. A simulation with no treatment family fails.
 * @param {Array<{ key: string, n: number }>} nf
 * @param {number} p
 * @param {{ seedHex: string, rho: number, sims: number, B: number, x: Frac }} o
 * @returns {number}
 */
function q18ShareAt(nf, p, o) {
  const rng = substream(o.seedHex, 'q18');
  let passes = 0;
  for (let s = 0; s < o.sims; s++) {
    /** @type {Array<{ num: number, den: number }>} */
    const clusters = [];
    for (const f of nf) {
      const treated = (rng.nextU32() & 1) === 1;
      const k = binomialDraw(rng, f.n, betaDraw(rng, p, o.rho));
      if (treated) clusters.push({ num: k, den: f.n });
    }
    if (clusters.length > 0 && cmpFrac(clusterBootstrap({ clusters, B: o.B, rng, mode: 'share' }).lower, o.x) >= 0) passes += 1;
  }
  return passes / o.sims;
}

/**
 * Q18, the smallest passing point uptake (W2-D21), procedure 'bisection-on-grid-crn': the grid runs from x to 1
 * in steps of gridStep (which must divide 1 - x); the answer is the smallest grid point whose pass share is at least
 * `power` and whose upper neighbour's is too (the top point needs only its own), found by bisection; null when the
 * top point does not reach `power`, or no family expects a window. `points` lists every point evaluated, by p.
 * @param {{ families: Array<{ key: string, windows: number, covered_days: number }>, plannedDays: number, seedHex: string, rho: number, power: number, sims: number, gridStep: number, B: number, x?: Frac }} input
 * @returns {{ figure: number|null, procedure: 'bisection-on-grid-crn', points: Array<{ p: number, share: number }> }}
 */
export function q18Power({ families, plannedDays, seedHex, rho, power, sims, gridStep, B, x = X }) {
  if (!(power > 0 && power <= 1)) throw new RangeError(`q18Power: power ${power} is outside (0, 1]`);
  if (!Number.isSafeInteger(sims) || sims < 1) throw new RangeError(`q18Power: sims=${sims} is not a positive integer`);
  nearestRankBounds(B);
  if (cmpFrac(x, frac(0, 1)) <= 0 || cmpFrac(x, frac(1, 1)) >= 0) throw new RangeError('q18Power: x lies outside (0, 1)');
  const span = (x.den - x.num) / x.den;
  const N = Math.round(span / gridStep);
  if (!(gridStep > 0) || N < 1 || Math.abs(N * gridStep - span) > 1e-9) throw new RangeError(`q18Power: grid step ${gridStep} does not divide 1 - x`);
  const procedure = Q18_DEFAULTS.procedure;
  const nf = expectedWindows(families, plannedDays).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (nf.length === 0) return { figure: null, procedure, points: [] };
  /** grid point i as one division of exact integers: (x.num N + i (x.den - x.num)) / (x.den N). @param {number} i */
  const pAt = (i) => (x.num * N + i * (x.den - x.num)) / (x.den * N);
  /** @type {Map<number, number>} */
  const shares = new Map();
  /** @param {number} i @returns {number} */
  const shareAt = (i) => {
    if (!shares.has(i)) shares.set(i, q18ShareAt(nf, pAt(i), { seedHex, rho, sims, B, x }));
    return /** @type {number} */ (shares.get(i));
  };
  /** @param {number} i */
  const good = (i) => shareAt(i) >= power && (i === N || shareAt(i + 1) >= power);
  const answer = (/** @type {number|null} */ i) => ({
    figure: i === null ? null : pAt(i), procedure,
    points: [...shares.keys()].sort((a, b) => a - b).map((j) => ({ p: pAt(j), share: /** @type {number} */ (shares.get(j)) })),
  });
  if (!good(N)) return answer(null);
  if (good(0)) return answer(0);
  let lo = 0;
  let hi = N;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (good(mid)) hi = mid;
    else lo = mid;
  }
  return answer(hi);
}
```

The section must keep Task 2's purity pin green. Check from the repository root:

```bash
awk '/^\/\/ ── W2-3 Task 6:/,0' deploy/history-gate.mjs | grep -nE 'process\.|Date\.now|new Date|Math\.random|performance\.|require\(|import\(|haiku|sonnet'
```

The command must print nothing (exit 1).

- [ ] **Step 5: Run them and see them pass, then the typecheck.**

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 6')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- **Vitest:** green, `23 passed`, in about 1 s of test time. I measured this against a stand-in for Tasks 2 to 5.
- **The Q18 fixture's figures, measured and not pinned:**
  - power 0.5 gives 0.35 (share 0.667; upper neighbour 0.4 at 0.75; the point below, 0.3, at 0.375);
  - power 0.8 gives 0.5;
  - power 0.95 gives 0.7. At 0.95, 0.55 reaches 0.958 but its neighbour 0.6 reaches only 0.917, so the upper-neighbour clause rules there.
- **tsc:** it prints nothing naming `server/test/measure-history.test.ts` or `deploy/history-gate.mjs`. `allowJs` types the namespace import from the JSDoc, and I measured the test file clean against the stand-in. A line that names only `agent/src/`, or a module that is not installed, comes from the worktree's install, not from this task.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root, in the foreground. Each block applies one exact replacement (asserted to match once), runs one filter, shows it red, then restores the file with `cp`. Every mutant below was measured red against the stand-in.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-3/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
G=deploy/history-gate.mjs
cp "$G" "$SCRATCH/gate.t6.orig"
t6() { (cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t "W2-3 Task 6: the bootstrap, the assignment and Q18 $1"); cp "$SCRATCH/gate.t6.orig" "$G"; }

# M1: the generator's shift changed: the reference vector reds.
mut "$G" "const t = (s1 << 9) >>> 0;" "const t = (s1 << 8) >>> 0;"
t6 'xoshiro128'
# RED: expected [ 11520, +0, 2977920, 70819200, …(2) ] to deeply equal [ 11520, +0, 5927040, 70819200, …(2) ]

# M2: the all-zero state accepted.
mut "$G" "  if (words.every((w) => w === 0)) throw new RangeError('xoshiro128ss: an all-zero state is refused');
" ""
t6 'an all-zero state is refused'
# RED: expected [Function] to throw an error

# M3: the state read big-endian.
mut "$G" "(byte(w * 4) | (byte(w * 4 + 1) << 8) | (byte(w * 4 + 2) << 16) | (byte(w * 4 + 3) << 24)) >>> 0" "((byte(w * 4) << 24) | (byte(w * 4 + 1) << 16) | (byte(w * 4 + 2) << 8) | byte(w * 4 + 3)) >>> 0"
t6 'a substream is sha256'
# RED: expected [ 765254636, 36460095, …(6) ] to deeply equal [ 2393075561, 469876822, …(6) ]

# M4: the closed label list dropped.
mut "$G" "  if (!SUBSTREAMS.includes(label) && label !== PILOT_SUBSTREAM) throw" "  if (false) throw"
t6 'every SUBSTREAMS label'
# RED: expected [Function] to throw an error

# M5: a bare modulo in place of rejection.
mut "$G" "    if (w < limit) return w % n;" "    return w % n;"
t6 'randInt'
# RED, 2 failed: expected 1073741823 to be 5; and expected 0.4866666666666667 to be less than 0.37

# M6: the high rank rounded rather than ceiled.
mut "$G" "highRank: Math.ceil((B * 975) / 1000)" "highRank: Math.round((B * 975) / 1000)"
t6 'the nearest-rank ranks'
# RED: expected { lowRank: 1, highRank: 29 } to deeply equal { lowRank: 1, highRank: 30 }

# M7: a 0-window family kept as a cluster.
mut "$G" ".map((k) => bootstrapUnit(k, mode)).filter((u) => u.den > 0);" ".map((k) => bootstrapUnit(k, mode));"
t6 'a family with 0 measured windows'
# RED: RangeError: frac: 0/0 is not an exact fraction (safe integers, den >= 1)

# M8: the order taken in floats (the constructed tie).
mut "$G" "export function cmpFrac(a, b) {
" "export function cmpFrac(a, b) {
  { const d = a.num / a.den - b.num / b.den; return d < 0 ? -1 : d > 0 ? 1 : 0; }
"
t6 'the order is exact'
# RED: expected +0 to be -1

# M8b: the BigInt arm dropped, so products past 2^53 round.
mut "$G" "  if (Math.abs(l) <= Number.MAX_SAFE_INTEGER && Math.abs(r) <= Number.MAX_SAFE_INTEGER) return" "  return"
t6 'the order is exact'
# RED: expected +0 to be -1 (the 2^53 case)

# M9: the paired statistic loses its control arm.
mut "$G" "return { num: q.t - q.c, den: q.n };" "return { num: q.t, den: q.n };"
t6 'the statistic is pooled and exact'
# RED: expected { num: 4, den: 6 } to deeply equal { num: 2, den: 6 }

# M10: the store dropped from the arm's hash (RP7).
mut "$G" 'sha256Hex(`${seedHex}:${ASSIGN_LABEL}:${familyKey(f.store_id, ' 'sha256Hex(`${seedHex}:${ASSIGN_LABEL}:${familyKey("", '
t6 'RP7-pure'
# RED: expected 'treatment' to be 'control'

# M11: an arm that depends on the list.
mut "$G" "arm: armOf(seedHex, f) }" "arm: armOf(seedHex + families.length, f) }"
t6 'removing one family'
# RED: 0: wrap-a-proj-b: expected 'control' to be 'treatment'

# M12: the list left in input order.
mut "$G" "  return sortByCanonical(families.map((f) => {" "  return (families.map((f) => {"
t6 'shuffled input'
# RED: expected [ { …(4) }, … ] to deeply equal [ { …(4) }, … ]

# M13: the Beta's shapes swapped.
mut "$G" "  return x / (x + y);" "  return y / (x + y);"
t6 'betaDraw has mean'
# RED: expected 0.7043403721800578 to be less than 0.32

# M14: rho 0 consumes a draw.
mut "$G" "  if (rho === 0 || mean === 0 || mean === 1) return mean;" "  if (rho === 0 || mean === 0 || mean === 1) { uniformOpen01(rng); return mean; }"
t6 'betaDraw has mean'
# RED: rho 0 took no word: expected 1158783799 to be 3336265094

# M15: a family expecting 0 windows kept.
mut "$G" "    if (n > 0) out.push({ key: f.key, n });" "    out.push({ key: f.key, n });"
t6 'expected windows are'
# RED: expected [ { key: 'k1', n: 6 }, …(3) ] to deeply equal [ { key: 'k1', n: 6 }, …(1) ]

# M16: the bisection answers its failing side.
mut "$G" "  return answer(hi);" "  return answer(lo);"
t6 "Q18's figure is a grid point"   # double quotes: the case title holds an apostrophe
# RED: power 0.5: the figure's own share: expected 0.375 to be greater than or equal to 0.5

# M17: the upper-neighbour clause dropped.
mut "$G" "(i === N || shareAt(i + 1) >= power)" "true"
t6 "Q18's figure is a grid point"   # double quotes: the case title holds an apostrophe
# RED: power 0.95: its upper neighbour's share (undefined) reaches it: expected false to be true

# M18: Q18 ignores its seed.
mut "$G" "  const rng = substream(o.seedHex, 'q18');" "  const rng = substream('5eed', 'q18');"
t6 'Q18 is deterministic'
# RED: expected [ { p: 0.1, share: +0 }, …(7) ] to not deeply equal [ { p: 0.1, share: +0 }, …(7) ]

# M19: a simulation with no treatment family bootstraps anyway.
mut "$G" "    if (clusters.length > 0 && cmpFrac(" "    if (clusters.length >= 0 && cmpFrac("
t6 'Q18 answers null'
# RED: RangeError: clusterBootstrap: no cluster has a measured unit

# M20: the top-of-grid check dropped, so a miss answers a number.
mut "$G" "  if (!good(N)) return answer(null);" ""
t6 'Q18 answers null'
# RED: expected 1 to be null

# M21: a default seed.
mut "$G" "export function armOf(seedHex, f) {" "export function armOf(seedHex = '', f) {"
t6 'no Task 6 function takes a default seed'
# RED: expected [ Array(1) ] to deeply equal []

cmp "$SCRATCH/gate.t6.orig" "$G" && echo restored
```

Then run Step 5's commands once more: they must be green.

The determinism pin's other half, that the gate has no ambient randomness, is Task 2's purity pin (`Math.random` and the clock refused by source). This task's own mutant for determinism is M18.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes).

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
```

Expected: green.
- `measure-history.test.ts` passes whole: Tasks 1 to 5's cases plus this task's 23 (predicted). That includes:
  - Task 2's purity pin: the import block is unchanged, and the section holds none of its refused spellings;
  - Task 2's O14 local half: no name declared here is a `lib.mjs` export, which I checked name by name against `lib.mjs` at 7d01973a2;
  - Task 2's class-word guard.
- `single-definition -t 'ccrc history'` stays green unedited (predicted). The O14 `VOCABS` describe sees no VOCABS name declared in `deploy/`, and nothing here spells a model class or a `recall-off` path.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-gate.mjs server/test/measure-history.test.ts
git commit -m "feat(history): the gate's seeded bootstrap, hash-bit assignment and Q18 power math (W2-3 Task 6)"
```

---

### Task 7: The quiz's pure decisions: admission, the labeller, the answer protocol, the writer and the rubrics

This task adds the labeller block and the texts the open record signs. All of it is pure, and later PRs call it: W2-5a sources and admits facts and spawns the writer, W2-5b composes the arms' prompts, spawns the judge and counts the rates, and Task 8 and Task 9 read the results and the sha constants.
- **Admission (W2-D62).** `collapseWs`, `factVariants` and `admitFact`. Admission is a plain substring test with no token boundaries, so it can only reject more facts than the spec's variants would.
- **The labeller (W2-D63).** `labelCorrect` reads only the ANSWER value and alone decides `correct`. A 7-character SHA prefix counts at the default `sha_min_prefix` 7 (D-5777).
- **The answer protocol (W2-D64).** `ANSWER_PROTOCOL` and `parseAnswerField`. Only the single ANSWER field is scored (D-5776).
- **The writer (W2-D72).** `WRITER_PROMPT` and `parseQuestionLine`. One prompt serves both `writer_input` values; the default excerpt is D-5779.
- **The rubrics (W2-D79).** `RUBRICS` v1 and v1-strict and `parseLabelLine`. Both rubrics widen `uncertain` (D-5778).
- **The signed texts.** Each has a sha256 literal beside it.

The rates, the absent-rate halt, the composer and the spawns belong to other PRs and tasks: W2-5a, W2-5b and Task 8 (W2-D64, W2-D72, W2-D79).

**Files:**
- Modify: `deploy/history-gate.mjs`. One section is appended at the END of the file, after Task 6's section. This task adds no import. The import block is Task 2's and stays unchanged, and this section reads no lib name: the four sha256 constants are literals (see Choices).
- Modify: `server/test/measure-history.test.ts`. One block is appended at the END of the file, made of two import lines and the describe `'W2-3 Task 7: the quiz labeller and its texts'`.
  - The two imports are a namespace import of the gate, `t7Gate`, and lib's `sha256Hex` as `t7Sha256Hex`. ES modules hoist an import declaration wherever it stands at the top level (measured green and type-clean at the end of the file). If an earlier task's block already imports the gate under another name, keep both, because the names differ.
  - The block reuses the file's top-level `describe`, `it`, `expect` and `createHash` imports (`:6`, `:8`). It declares no `FACT_KINDS` or `LABELS` (W2-D12's one-declaration pin from Task 2): it only reads them through `t7Gate`.
- Not here:
  - the spec. Its errata belong to the PRs that hold the spec path: E17 (decisions not sourced) is W2-1's, and E20 (the writer excerpt) and E22 (the ANSWER field, the SHA prefix and the widened `uncertain`) are W2-5b's (decisions section 6);
  - `ccd/**`, `shared/**`, `deploy/history-replay.mjs` and every other test file.

**Interfaces:**
- Consumes (Task 2, the same module, read and never declared again):
  - `FACT_KINDS = ['sha','path','command','error']`. A kind outside it throws (W2-D60);
  - `LABELS`, `RUBRIC_IDS` (`'v1'`, `'v1-strict'`), `WRITER_INPUTS` (`'excerpt'`, `'leaf-span'`), `SHA_MIN_PREFIXES = [7, 40]` and `ANSWER_STATES` (`'value'`, `'unknown'`, `'absent'`);
  - `GATE_REASONS`, which must hold `'writer-malformed'` and `'writer-leak'`.

  Step 1 confirms each of these.
- Consumes (lib, test only): `sha256Hex(data)` (`ccd/history/lib.mjs:527`, `createHash('sha256').update(data)`, so a string is hashed as UTF-8).
- Produces (all exported from `deploy/history-gate.mjs`, JSDoc-typed):
  - `LABELLER = {sha_admit_prefix: 7, path_min: 8, window: 40, path_forms: ['absolute', 'repo-relative', 'tail', 'basename'], boundaries: 'v1'}`, frozen to its inner array. Task 9's validator compares the record's labeller with it, except for `sha_min_prefix`.
  - `collapseWs(s: string): string`.
  - `factVariants(kind: FactKind, F: string, opts: {repoRoots: string[]}): string[]`.
  - `admitFact(kind, F, baselineText, questionText, opts: {repoRoots}): {admitted: boolean, hit: null | {where: 'baseline'|'question', variant: string}}`. A `where: 'question'` hit is what W2-5a records as `writer-leak`.
  - `labelCorrect(kind, F, answerValue, opts: {repoRoots: string[], shaMinPrefix: 7|40}): boolean`. A `shaMinPrefix` outside `SHA_MIN_PREFIXES` throws.
  - `ANSWER_PROTOCOL: string`, `ANSWER_PROTOCOL_SHA256 = 'c6277a51b4cbfade448416594c4427a4099969f0679d2da05f0b7190be1572b1'`.
  - `parseAnswerField(finalText): {state: 'value', value} | {state: 'unknown'} | {state: 'absent'}`.
  - `WRITER_PROMPT: string`, `WRITER_PROMPT_SHA256 = 'c3c184145653f9d94a18fcc5b62a58ff3a93c04a30d8f605c3bdae4f0b413676'`, `WRITER_QUESTION_MAX = 600`.
  - `parseQuestionLine(reply): {ok: true, question} | {ok: false, word: 'writer-malformed'}`.
  - `RUBRICS: {v1, 'v1-strict'}`, `RUBRIC_SHA256 = {v1: 'b5f78b9b04687ecacab63bd97f1ca5eb1f51bf2c38c810d3b3d15b34e9250008', 'v1-strict': '780bfd756a26ceaf01422443f1b1e8f7c11f5b7e66bb96881fe24a716fcce322'}`.
  - `parseLabelLine(reply): {ok: true, label: 'uncertain'|'fabricated'} | {ok: false}`.
  - Module-private: `factKindOf`, `repoRelativeForms`, `admissionHaystack`, `occurrencesOf`, `pathLeftOk`, `pathRightOk`, `cmdLeftOk`, `cmdRightOk`, `lastLineMatch`, and the regex and text constants `PATH_LEFT`, `PATH_RIGHT`, `PATH_TOKEN`, `CMD_EDGE`, `CMD_ALTERNATIVE`, `LINE_BREAK`, `ANSWER_LINE`, `ANSWER_QUOTES`, `QUESTION_LINE`, `RUBRIC_HEAD`, `RUBRIC_TAIL`, `LABEL_LINE`. None of them is a lib export (O14's local half, Task 2's pin).
- Task 9 consumes `LABELLER`, `ANSWER_PROTOCOL_SHA256`, `WRITER_PROMPT_SHA256` and `RUBRIC_SHA256`. Task 8 consumes the labels as data. W2-5a consumes `collapseWs`, `admitFact`, `WRITER_PROMPT` and `parseQuestionLine`, and W2-5b consumes `ANSWER_PROTOCOL`, `parseAnswerField`, `labelCorrect`, `RUBRICS` and `parseLabelLine`.

**Decisions:** W2-D60 (the kinds; Task 2 declares them, and this task throws on any other), W2-D61 (`collapseWs`; F_raw against F is W2-5a's), W2-D62, W2-D63, W2-D64 (the text and the parser), W2-D72 (`WRITER_PROMPT`, `parseQuestionLine`, the `writer_input` words) and W2-D79 (`RUBRICS`, `parseLabelLine`). This plan defines four departures in "Deviations found": D-5776 (`history-w2-answer-field`), D-5777 (`history-w2-sha-prefix-correct`), D-5778 (`history-w2-rubric-residual-uncertain`) and D-5779 (`history-w2-writer-excerpt`).

**Choices this task makes:**
- **Admission collapses the text as well as F for command and error.** W2-D62 collapses F, and the spec's rule is "every 40-character window after whitespace collapse" (§10.2:2650). B renders a multi-line command with its newlines. If only F were collapsed, a command B shows on two lines would be admitted, which is the wrong direction for a rule that may only over-reject. The sha text is lower-cased (W2-D62), and the path text is left as it is (case-sensitive).
- **The path labeller's second-token rule.** It masks every occurrence of every form of F, whether bounded or not, and then refuses any remaining run of `[A-Za-z0-9._/~-]` that holds a `/`.
  - Masking unbounded occurrences too keeps each boundary rule testable on its own. If only bounded occurrences were masked, `src/app.tsx` would be refused by the token rule and the right boundary could not be shown to matter.
  - The cost: a path answer whose value also holds `and/or` is not correct. The arms are told to give one exact value.
- **The SHA run has no letter-and-digit floor.** W2-D63 states none (mining has one, in W2-D65). So a run of 7 or more digits beside the SHA counts as a second run, and the answer is not correct.
- **Each parser selects lines by the decision's own regex.** The answer is the last line that the regex matches. A later `LABEL: correct` therefore does not void an earlier `LABEL: fabricated`. Lines are split at `\r\n`, `\n`, `\r`, U+2028 and U+2029, the terminators that JavaScript's `^` and `$` know.
- **`parseAnswerField` trims before it strips one layer of quotes.** An `ANSWER:` line with nothing after it is `{state: 'value', value: ''}`, which `labelCorrect` scores false and the judge then sees (W2-D80 counts empty text as an answer).
- **`parseQuestionLine` trims the question and counts code points.** A question that is only whitespace is `writer-malformed`.
- **The sha256 constants are literals, not computed at load.** An edit to a text then needs a deliberate second edit to its literal, and this task's test reds until both agree. Task 9's validator compares the literal with the signed part 1, so a text changed without a record change is refused there (W2-D64's pin).
- **Each text quotes its own format line inline, never at the start of a line.** So `ANSWER_PROTOCOL`, `WRITER_PROMPT` and each rubric never parse as their own reply. This is pinned.
- **One `WRITER_PROMPT` serves both `writer_input` values.** Its `excerpt` field carries the default excerpt, or leaf N's whole redacted span under `'leaf-span'` (W2-D72). The input object `{v: 1, kind, fact, excerpt}` is W2-5a's to build.
- **No signed text names a model or a model class.** The models are the record's `writer_model` and `judge_model` (W2-D25).

- [ ] **Step 1: Confirm Task 2's names, and that no earlier task took this task's.** From the repository root:

```bash
grep -c "^import { EXIT, UUID_RE, canonicalJson, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';" deploy/history-gate.mjs
node --input-type=module -e "const g = await import('./deploy/history-gate.mjs'); console.log(JSON.stringify([g.FACT_KINDS, g.LABELS, [...g.RUBRIC_IDS].sort(), [...g.WRITER_INPUTS].sort(), g.SHA_MIN_PREFIXES, [...g.ANSWER_STATES].sort(), ['writer-malformed', 'writer-leak'].every((w) => g.GATE_REASONS.includes(w))]))"
grep -cE '^(export )?(const|function|let) (LABELLER|collapseWs|factKindOf|repoRelativeForms|factVariants|admissionHaystack|admitFact|PATH_LEFT|PATH_RIGHT|PATH_TOKEN|CMD_EDGE|CMD_ALTERNATIVE|occurrencesOf|pathLeftOk|pathRightOk|cmdLeftOk|cmdRightOk|labelCorrect|LINE_BREAK|lastLineMatch|ANSWER_PROTOCOL|ANSWER_PROTOCOL_SHA256|ANSWER_LINE|ANSWER_QUOTES|parseAnswerField|WRITER_PROMPT|WRITER_PROMPT_SHA256|WRITER_QUESTION_MAX|QUESTION_LINE|parseQuestionLine|RUBRIC_HEAD|RUBRIC_TAIL|RUBRICS|RUBRIC_SHA256|LABEL_LINE|parseLabelLine)\b' deploy/history-gate.mjs
```

Expected (measured against a stand-in for Task 2's head at `7d01973a2`):
- `1`;
- `[["sha","path","command","error"],["correct","uncertain","fabricated"],["v1","v1-strict"],["excerpt","leaf-span"],[7,40],["absent","unknown","value"],true]`. The gate is pure, so importing it reads no file and no HOME;
- `0`: none of the 36 names this task declares exists yet.

Stop and report if you see any of these, and never declare a Task 2 name here:
- a different word set;
- a `false` (a missing `writer-malformed` or `writer-leak`), which is a gap in Task 2;
- a non-zero last count, which is a name collision with an earlier task.

- [ ] **Step 2: Write the failing tests.** Append this block at the END of `server/test/measure-history.test.ts`:

```ts
// ── W2-3 Task 7: the quiz labeller and its texts (W2-D60 to W2-D64, W2-D72, W2-D79) ─────────────────────────────
// Pure: every case calls deploy/history-gate.mjs with literals and reads no store. Departures: D-5776 (the single
// ANSWER field), D-5777 (a 7-character SHA prefix is correct by default), D-5778 (both rubrics widen `uncertain`),
// D-5779 (the writer sees an excerpt by default). The SHA fixtures are built at runtime from a repeated chunk, so no
// 40-character hex literal sits in this file.
import * as t7Gate from '../../deploy/history-gate.mjs';
import { sha256Hex as t7Sha256Hex } from '../../ccd/history/lib.mjs';

describe('W2-3 Task 7: the quiz labeller and its texts', () => {
  const ROOT_R = { repoRoots: ['/r'] };
  const NO_ROOTS = { repoRoots: [] as string[] };
  const SHA40 = '3f9a1c7e2b'.repeat(4);
  const F9 = SHA40.slice(0, 9);
  const at7 = { repoRoots: [] as string[], shaMinPrefix: 7 as const };
  const at40 = { repoRoots: [] as string[], shaMinPrefix: 40 as const };
  const pathAt7 = { repoRoots: ['/r'], shaMinPrefix: 7 as const };
  const CMD39 = 'npm run build -- --filter=pkg-a --watch';
  const CMD50 = 'git push --force-with-lease origin topic-branch-a1';

  it('CONTROL: the fixtures have the lengths the cases below rely on, and Task 2 declared the words this task reads', () => {
    expect([SHA40.length, F9.length, CMD39.length, CMD50.length]).toEqual([40, 9, 39, 50]);
    expect(t7Gate.FACT_KINDS).toEqual(['sha', 'path', 'command', 'error']);
    expect(t7Gate.SHA_MIN_PREFIXES).toEqual([7, 40]);
    expect([...t7Gate.RUBRIC_IDS].sort()).toEqual(['v1', 'v1-strict']);
    expect([...t7Gate.ANSWER_STATES].sort()).toEqual(['absent', 'unknown', 'value']);
    expect(t7Gate.GATE_REASONS).toEqual(expect.arrayContaining(['writer-malformed', 'writer-leak']));
    expect(t7Gate.LABELLER).toEqual({ sha_admit_prefix: 7, path_min: 8, window: 40,
      path_forms: ['absolute', 'repo-relative', 'tail', 'basename'], boundaries: 'v1' });
    expect(Object.isFrozen(t7Gate.LABELLER) && Object.isFrozen(t7Gate.LABELLER.path_forms)).toBe(true);
  });

  it('collapseWs turns every run of Unicode whitespace into one space and trims', () => {
    const [nbsp, em, ls] = [0xa0, 0x2003, 0x2028].map((c) => String.fromCodePoint(c));
    expect(t7Gate.collapseWs(`${nbsp} git\t\tstatus\n${em} --short ${ls}`)).toBe('git status --short');
  });

  describe('admitFact (W2-D62): a plain substring test, no token boundaries', () => {
    it('sha: a 6-character prefix in B admits, and a 7-character one rejects', () => {
      expect(t7Gate.admitFact('sha', F9, `checked out ${F9.slice(0, 6)} earlier`, 'q', NO_ROOTS))
        .toEqual({ admitted: true, hit: null });
      expect(t7Gate.admitFact('sha', F9, `checked out ${F9.slice(0, 7)} earlier`, 'q', NO_ROOTS))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: F9.slice(0, 7) } });
    });

    it('sha: a 40-character SHA in B rejects a 9-character F, in either case', () => {
      expect(t7Gate.admitFact('sha', F9, `merged ${SHA40}`, 'q', NO_ROOTS).admitted).toBe(false);
      expect(t7Gate.admitFact('sha', F9, `MERGED ${SHA40.toUpperCase()}`, 'q', NO_ROOTS).admitted).toBe(false);
    });

    it('path: a repo-relative tail rejects; the 6-character basename alone does not', () => {
      const F = '/w/proj/src/deep/mod.ts';
      expect(t7Gate.admitFact('path', F, 'opened deep/mod.ts', 'q', { repoRoots: ['/w/proj'] }))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: 'deep/mod.ts' } });
      expect(t7Gate.admitFact('path', F, 'opened mod.ts', 'q', { repoRoots: ['/w/proj'] }).admitted).toBe(true);
    });

    it('path: F=/r/lib/x.c with lib/x.c in B rejects (a tail has no length floor)', () => {
      expect(t7Gate.admitFact('path', '/r/lib/x.c', 'see lib/x.c', 'q', NO_ROOTS))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: 'lib/x.c' } });
    });

    it('path: F=/r/go.mod with go.mod in B and root /r rejects (a repo-relative form has no length floor)', () => {
      expect(t7Gate.admitFact('path', '/r/go.mod', 'edit go.mod', 'q', ROOT_R))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: 'go.mod' } });
      expect(t7Gate.admitFact('path', '/r/go.mod', 'edit go.mod', 'q', NO_ROOTS).admitted, 'CONTROL: without the root, go.mod is only a short basename').toBe(true);
    });

    it('path: a 7-character basename alone admits, and an 8-character one rejects', () => {
      expect(t7Gate.admitFact('path', '/r/src/util.ts', 'edit util.ts', 'q', ROOT_R).admitted).toBe(true);
      expect(t7Gate.admitFact('path', '/r/src/utils.ts', 'edit utils.ts', 'q', ROOT_R))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: 'utils.ts' } });
    });

    it('path: matching is case-sensitive', () => {
      expect(t7Gate.admitFact('path', '/r/src/config.json', 'read src/Config.json', 'q', ROOT_R).admitted).toBe(true);
    });

    it('command: a 39-character command is matched whole', () => {
      expect(t7Gate.factVariants('command', CMD39, NO_ROOTS)).toEqual([CMD39]);
      expect(t7Gate.admitFact('command', CMD39, `ran ${CMD39.slice(0, 38)}`, 'q', NO_ROOTS).admitted).toBe(true);
      expect(t7Gate.admitFact('command', CMD39, `ran ${CMD39}`, 'q', NO_ROOTS))
        .toEqual({ admitted: false, hit: { where: 'baseline', variant: CMD39 } });
    });

    it('command: at 40 characters or more every 40-character window is a variant, and 39 characters of one admit', () => {
      expect(t7Gate.factVariants('command', CMD50, NO_ROOTS)).toHaveLength(11);
      expect(t7Gate.admitFact('command', CMD50, `x ${CMD50.slice(5, 45)} y`, 'q', NO_ROOTS).admitted).toBe(false);
      expect(t7Gate.admitFact('command', CMD50, `x ${CMD50.slice(5, 44)} y`, 'q', NO_ROOTS).admitted).toBe(true);
    });

    it('command and error: B is collapsed too, so a multi-line rendering still rejects', () => {
      const F = 'git rebase --onto main topic-branch';
      expect(t7Gate.admitFact('command', F, 'ran git rebase\n    --onto main   topic-branch', 'q', NO_ROOTS).admitted).toBe(false);
      expect(t7Gate.admitFact('error', 'fatal: bad object HEAD~3', 'fatal:  bad\nobject HEAD~3', 'q', NO_ROOTS).admitted).toBe(false);
    });

    it('W2-D72: a stub question holding a 7-character SHA prefix fails admission at the question (writer-leak)', () => {
      expect(t7Gate.admitFact('sha', F9, 'nothing of it here', `Which commit begins ${F9.slice(0, 7)}?`, NO_ROOTS))
        .toEqual({ admitted: false, hit: { where: 'question', variant: F9.slice(0, 7) } });
    });

    it('a kind outside FACT_KINDS throws: decisions are not sourced (W2-D60)', () => {
      expect(() => t7Gate.factVariants('decision', 'use the queue', NO_ROOTS)).toThrow(/FACT_KINDS|not one of/);
      expect(() => t7Gate.admitFact('decision', 'use the queue', '', '', NO_ROOTS)).toThrow(/not one of/);
    });
  });

  describe('labelCorrect (W2-D63): only the ANSWER value, with boundaries', () => {
    it('sha: a 40-character SHA for a 9-character F is correct, in either case', () => {
      expect(t7Gate.labelCorrect('sha', F9, `It is ${SHA40}.`, at7)).toBe(true);
      expect(t7Gate.labelCorrect('sha', F9, SHA40.toUpperCase(), at7)).toBe(true);
    });

    it('sha: a 9-character run that diverges after 7 shared characters is not correct', () => {
      expect(t7Gate.labelCorrect('sha', F9, `${F9.slice(0, 7)}00`, at7)).toBe(false);
    });

    it('sha: two SHAs are not correct, and a hedged abc1234 or def5678 is not', () => {
      expect(t7Gate.labelCorrect('sha', F9, `${F9} ${'abcdef1'}`, at7)).toBe(false);
      expect(t7Gate.labelCorrect('sha', 'abc1234ffff', 'abc1234 or def5678', at7)).toBe(false);
    });

    it('sha: a hex run joined to a non-hex letter is no run', () => {
      expect(t7Gate.labelCorrect('sha', F9, `${F9}x`, at7)).toBe(false);
    });

    it('sha: each shaMinPrefix value is pinned, and any other throws', () => {
      expect(t7Gate.labelCorrect('sha', SHA40, SHA40.slice(0, 7), at7)).toBe(true);
      expect(t7Gate.labelCorrect('sha', SHA40, SHA40.slice(0, 7), at40)).toBe(false);
      expect(t7Gate.labelCorrect('sha', SHA40, SHA40.slice(0, 39), at40)).toBe(false);
      expect(t7Gate.labelCorrect('sha', SHA40, SHA40, at40)).toBe(true);
      expect(() => t7Gate.labelCorrect('sha', SHA40, SHA40, { repoRoots: [], shaMinPrefix: 12 as unknown as 7 })).toThrow(/shaMinPrefix/);
    });

    it('path: src/app.tsx for src/app.ts is not correct; src/app.ts and a final period are', () => {
      const F = '/r/src/app.ts';
      expect(t7Gate.labelCorrect('path', F, 'src/app.tsx', pathAt7)).toBe(false);
      expect(t7Gate.labelCorrect('path', F, 'src/app.ts', pathAt7)).toBe(true);
      expect(t7Gate.labelCorrect('path', F, 'It is /r/src/app.ts.', pathAt7)).toBe(true);
    });

    it('path: the left boundary refuses a form glued to a path character', () => {
      expect(t7Gate.labelCorrect('path', '/r/src/app.ts', '~/r/src/app.ts', { repoRoots: [], shaMinPrefix: 7 })).toBe(false);
    });

    it('path: a short repo-relative form needs its right boundary too', () => {
      expect(t7Gate.labelCorrect('path', '/r/go.mod', 'go.mod', pathAt7)).toBe(true);
      expect(t7Gate.labelCorrect('path', '/r/go.mod', 'go.mod5', pathAt7)).toBe(false);
    });

    it('path: a basename alone is not correct', () => {
      expect(t7Gate.labelCorrect('path', '/r/src/app.ts', 'app.ts', pathAt7)).toBe(false);
    });

    it('path: a second path-shaped token that is not one of F\'s forms makes the answer not correct', () => {
      expect(t7Gate.labelCorrect('path', '/r/src/app.ts', '/r/src/app.ts or /r/src/other.ts', pathAt7)).toBe(false);
      expect(t7Gate.labelCorrect('path', '/r/src/app.ts', '/r/src/app.ts (src/app.ts)', pathAt7), 'CONTROL: two of F\'s own forms').toBe(true);
    });

    it('command: npm run test:e2e for npm run test is not correct', () => {
      expect(t7Gate.labelCorrect('command', 'npm run test', 'npm run test:e2e', at7)).toBe(false);
      expect(t7Gate.labelCorrect('command', 'npm run test', '`npm run test`', at7), 'CONTROL: a backtick is a boundary').toBe(true);
    });

    it('command: the left boundary refuses a glued prefix, and a final period is allowed', () => {
      expect(t7Gate.labelCorrect('command', 'npm run test', 'xnpm run test', at7)).toBe(false);
      expect(t7Gate.labelCorrect('command', 'npm run test', 'Run npm run test.', at7)).toBe(true);
    });

    it('command: the value is collapsed before the match', () => {
      expect(t7Gate.labelCorrect('command', 'npm run test', 'npm  run\ttest', at7)).toBe(true);
    });

    it('command and error: "X or Y" is not correct', () => {
      expect(t7Gate.labelCorrect('command', 'npm run test', 'npm run test or npm run lint', at7)).toBe(false);
      expect(t7Gate.labelCorrect('error', 'fatal: bad object HEAD~3', 'either x OR fatal: bad object HEAD~3', at7)).toBe(false);
      expect(t7Gate.labelCorrect('error', 'fatal: a or b', 'fatal: a or b', at7), 'CONTROL: an "or" inside F is F\'s own').toBe(true);
    });
  });

  describe('the answer protocol and its parser (W2-D64, D-5776)', () => {
    it('the last of two ANSWER lines wins', () => {
      expect(t7Gate.parseAnswerField('ANSWER: abc1234\nthinking again\nANSWER: def5678')).toEqual({ state: 'value', value: 'def5678' });
    });

    it('no ANSWER line is absent, even with F in the reply', () => {
      expect(t7Gate.parseAnswerField(`The commit is ${F9}.`)).toEqual({ state: 'absent' });
      expect(t7Gate.parseAnswerField('answer: x\n  ANSWER: y')).toEqual({ state: 'absent' });
    });

    it('UNKNOWN in any case, quoted or bare, is unknown', () => {
      expect(t7Gate.parseAnswerField('ANSWER: unknown')).toEqual({ state: 'unknown' });
      expect(t7Gate.parseAnswerField('ANSWER: "UNKNOWN"')).toEqual({ state: 'unknown' });
    });

    it('one layer of matching quotes or backticks is stripped, and only one', () => {
      expect(t7Gate.parseAnswerField('ANSWER: `npm run test`')).toEqual({ state: 'value', value: 'npm run test' });
      expect(t7Gate.parseAnswerField('ANSWER: "\'x\'"')).toEqual({ state: 'value', value: "'x'" });
      expect(t7Gate.parseAnswerField('ANSWER: "x`')).toEqual({ state: 'value', value: '"x`' });
    });

    it('a hedged abc1234 or def5678 is a value, and not correct', () => {
      const a = t7Gate.parseAnswerField('ANSWER: abc1234 or def5678');
      expect(a).toEqual({ state: 'value', value: 'abc1234 or def5678' });
      expect(t7Gate.labelCorrect('sha', 'abc1234ffff', (a as { value: string }).value, at7)).toBe(false);
    });

    it('every state it answers is an ANSWER_STATES member, and the protocol never parses as an answer', () => {
      for (const t of ['ANSWER: x', 'ANSWER: UNKNOWN', 'none']) expect(t7Gate.ANSWER_STATES).toContain(t7Gate.parseAnswerField(t).state);
      expect(t7Gate.parseAnswerField(t7Gate.ANSWER_PROTOCOL)).toEqual({ state: 'absent' });
      expect(t7Gate.ANSWER_PROTOCOL).toContain('`ANSWER: <single exact value>`');
      expect(t7Gate.ANSWER_PROTOCOL).toContain('`ANSWER: UNKNOWN`');
    });
  });

  describe('the writer prompt and its reply (W2-D72, D-5779)', () => {
    it('the last QUESTION line is the question, trimmed', () => {
      expect(t7Gate.parseQuestionLine('QUESTION: first?\nQUESTION:  Which command rebuilt the cache?  '))
        .toEqual({ ok: true, question: 'Which command rebuilt the cache?' });
    });

    it('600 characters pass and 601 are writer-malformed', () => {
      expect(t7Gate.WRITER_QUESTION_MAX).toBe(600);
      expect(t7Gate.parseQuestionLine(`QUESTION: ${'q'.repeat(600)}`)).toEqual({ ok: true, question: 'q'.repeat(600) });
      expect(t7Gate.parseQuestionLine(`QUESTION: ${'q'.repeat(601)}`)).toEqual({ ok: false, word: 'writer-malformed' });
    });

    it('no QUESTION line, or one with only whitespace, is writer-malformed; so is the prompt itself', () => {
      expect(t7Gate.parseQuestionLine('Which command rebuilt the cache?')).toEqual({ ok: false, word: 'writer-malformed' });
      expect(t7Gate.parseQuestionLine('QUESTION:    ')).toEqual({ ok: false, word: 'writer-malformed' });
      expect(t7Gate.parseQuestionLine(t7Gate.WRITER_PROMPT)).toEqual({ ok: false, word: 'writer-malformed' });
    });
  });

  describe('the rubrics and the label line (W2-D79, D-5778)', () => {
    it('RUBRICS holds exactly the RUBRIC_IDS, and both texts place several candidates and no answer in uncertain', () => {
      expect(Object.keys(t7Gate.RUBRICS).sort()).toEqual([...t7Gate.RUBRIC_IDS].sort());
      for (const id of t7Gate.RUBRIC_IDS) {
        const r = t7Gate.RUBRICS[id as 'v1' | 'v1-strict'];
        expect(r).toContain('several candidate values');
        expect(r).toContain('gives no answer at all');
        expect(r).toContain('of any kind');
        expect(t7Gate.parseLabelLine(r), 'the rubric never parses as a label').toEqual({ ok: false });
      }
      expect(t7Gate.RUBRICS.v1).toContain('without hedging');
      expect(t7Gate.RUBRICS['v1-strict']).toContain('with or without hedging');
    });

    it('the last LABEL line wins, and its label is a LABELS member', () => {
      const r = t7Gate.parseLabelLine('LABEL: uncertain\nOn reflection:\nLABEL: fabricated  ');
      expect(r).toEqual({ ok: true, label: 'fabricated' });
      expect(t7Gate.LABELS).toContain((r as { label: string }).label);
    });

    it('any other word, another case or no line is malformed', () => {
      expect(t7Gate.parseLabelLine('LABEL: correct')).toEqual({ ok: false });
      expect(t7Gate.parseLabelLine('LABEL: Fabricated')).toEqual({ ok: false });
      expect(t7Gate.parseLabelLine('LABEL: fabricated, probably')).toEqual({ ok: false });
      expect(t7Gate.parseLabelLine('fabricated')).toEqual({ ok: false });
    });
  });

  describe('the signed texts (W2-D64, W2-D72, W2-D79)', () => {
    it('each sha constant is lib\'s sha256Hex of its text, over its UTF-8 bytes', () => {
      expect(t7Sha256Hex(String.fromCodePoint(0xe9))).toBe(createHash('sha256').update(Buffer.from([0xc3, 0xa9])).digest('hex'));
      expect(t7Gate.ANSWER_PROTOCOL_SHA256).toBe(t7Sha256Hex(t7Gate.ANSWER_PROTOCOL));
      expect(t7Gate.WRITER_PROMPT_SHA256).toBe(t7Sha256Hex(t7Gate.WRITER_PROMPT));
      expect(t7Gate.RUBRIC_SHA256.v1).toBe(t7Sha256Hex(t7Gate.RUBRICS.v1));
      expect(t7Gate.RUBRIC_SHA256['v1-strict']).toBe(t7Sha256Hex(t7Gate.RUBRICS['v1-strict']));
      expect(new Set([t7Gate.ANSWER_PROTOCOL_SHA256, t7Gate.WRITER_PROMPT_SHA256, t7Gate.RUBRIC_SHA256.v1,
        t7Gate.RUBRIC_SHA256['v1-strict']]).size).toBe(4);
    });

    it('no signed text names a model class, and each is plain ASCII', () => {
      const texts = [t7Gate.ANSWER_PROTOCOL, t7Gate.WRITER_PROMPT, t7Gate.RUBRICS.v1, t7Gate.RUBRICS['v1-strict']];
      const classWord = new RegExp(['hai', 'ku|son', 'net'].join(''), 'i');
      for (const t of texts) {
        expect(t).not.toMatch(classWord);
        expect(t).toMatch(/^[\x20-\x7e\n]+$/);
      }
    });
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 7')
```

Expected: red, `42 failed`, with every other case in the file skipped. This was measured as `42 failed | 17 skipped (59)` against a stand-in for Task 2's head at `7d01973a2`. Here the skipped count includes Tasks 1 to 6's cases.
- Three cases fail on an assertion (measured: the run reports 42 failures, 39 of them TypeErrors):
  - the CONTROL, with `expected undefined to deeply equal { sha_admit_prefix: 7, …(4) }`;
  - the 600-character case, with `expected undefined to be 600`;
  - the kind case, whose `toThrow(/FACT_KINDS|not one of/)` sees `factVariants is not a function`.
- The function cases fail with `TypeError: admitFact is not a function` (9), `labelCorrect is not a function` (14), `parseAnswerField is not a function` (6), `factVariants`, `parseQuestionLine` and `parseLabelLine is not a function` (2 each), and `collapseWs is not a function` (1).
- The rubric cases fail with `Cannot convert undefined or null to object` and `Cannot read properties of undefined (reading 'v1')`.
- The sha case fails with `The "data" argument must be of type string … Received undefined`.

- [ ] **Step 4: Write the section.** Append this at the END of `deploy/history-gate.mjs`, after Task 6's section. Leave the import block alone:

```js
// ── W2-3 Task 7: the quiz's pure decisions (W2-D60 to W2-D64, W2-D72, W2-D79; D-5776, D-5777, D-5778, D-5779) ──
// Admission (W2-D62) is a plain substring test with no token boundaries, so it can only reject more facts than the
// spec's variants would. The labeller (W2-D63) reads only the ANSWER value (W2-D64) and alone decides `correct`;
// the judge chooses only between `uncertain` and `fabricated` (W2-D79). Every text a record signs is a constant
// here with its sha256 literal beside it: an edit to a text without its literal reds this file's tests, and an edit
// to both reds the record check (W2-D25), which compares the literal against the signed part 1.

/** The labeller block part 1 records beside `sha_min_prefix` (W2-D62, W2-D63; decisions section 4). */
export const LABELLER = Object.freeze({
  sha_admit_prefix: 7,
  path_min: 8,
  window: 40,
  path_forms: Object.freeze(['absolute', 'repo-relative', 'tail', 'basename']),
  boundaries: 'v1',
});

/**
 * Every run of Unicode whitespace becomes one space, and the ends are trimmed (W2-D61).
 * @param {string} s
 * @returns {string}
 */
export function collapseWs(s) {
  return s.replace(/\s+/gu, ' ').trim();
}

/**
 * @param {string} kind
 * @returns {'sha'|'path'|'command'|'error'}
 */
function factKindOf(kind) {
  if (!FACT_KINDS.includes(kind)) {
    throw new TypeError(`history-gate: fact kind ${JSON.stringify(kind)} is not one of ${FACT_KINDS.join(', ')}`);
  }
  return /** @type {'sha'|'path'|'command'|'error'} */ (kind);
}

/**
 * F relative to each recorded repo root (the epoch's cwd and cwd_real), with no length floor (W2-D62, W2-D63).
 * @param {string} F an absolute path
 * @param {readonly string[]} repoRoots
 * @returns {string[]}
 */
function repoRelativeForms(F, repoRoots) {
  /** @type {string[]} */
  const out = [];
  for (const root of repoRoots) {
    const r = root.endsWith('/') ? root.slice(0, -1) : root;
    if (F.startsWith(`${r}/`) && F.length > r.length + 1) out.push(F.slice(r.length + 1));
  }
  return out;
}

/**
 * The strings whose presence in a text rejects F (W2-D62). Duplicates are dropped; order is not meaningful.
 * - sha: F lower-cased, cut to `LABELLER.sha_admit_prefix` characters.
 * - path: the absolute form; every repo-relative form; every `/`-boundary tail that still holds a `/`; the
 *   basename when it is `LABELLER.path_min` characters or longer. No other length floor.
 * - command, error: F collapsed; at `LABELLER.window` characters or more every window of that width, else the
 *   whole collapsed string.
 * @param {string} kind a FACT_KINDS member; any other value throws
 * @param {string} F
 * @param {{repoRoots: readonly string[]}} opts
 * @returns {string[]}
 */
export function factVariants(kind, F, opts) {
  switch (factKindOf(kind)) {
    case 'sha':
      return [F.toLowerCase().slice(0, LABELLER.sha_admit_prefix)];
    case 'path': {
      const out = [F, ...repoRelativeForms(F, opts.repoRoots)];
      for (let i = F.indexOf('/'); i !== -1; i = F.indexOf('/', i + 1)) {
        const tail = F.slice(i + 1);
        if (tail.includes('/')) out.push(tail);
      }
      const base = F.slice(F.lastIndexOf('/') + 1);
      if (base.length >= LABELLER.path_min) out.push(base);
      return [...new Set(out)];
    }
    default: {
      const c = collapseWs(F);
      if (c.length < LABELLER.window) return [c];
      /** @type {string[]} */
      const out = [];
      for (let i = 0; i + LABELLER.window <= c.length; i += 1) out.push(c.slice(i, i + LABELLER.window));
      return [...new Set(out)];
    }
  }
}

/**
 * The text a kind's variants are looked for in: lower-cased for sha, collapsed for command and error (so a
 * multi-line rendering in B still rejects its collapsed fact), as-is (case-sensitive) for path.
 * @param {'sha'|'path'|'command'|'error'} kind
 * @param {string} text
 * @returns {string}
 */
function admissionHaystack(kind, text) {
  if (kind === 'sha') return text.toLowerCase();
  if (kind === 'path') return text;
  return collapseWs(text);
}

/**
 * Admission (W2-D62): F is admitted iff no variant occurs, as a plain substring, in Baseline B or in the
 * question text. B is tested first; the first hit is named. A question hit is W2-5a's `writer-leak` (W2-D72).
 * @param {string} kind
 * @param {string} F
 * @param {string} baselineText
 * @param {string} questionText
 * @param {{repoRoots: readonly string[]}} opts
 * @returns {{admitted: boolean, hit: null | {where: 'baseline'|'question', variant: string}}}
 */
export function admitFact(kind, F, baselineText, questionText, opts) {
  const k = factKindOf(kind);
  const variants = factVariants(k, F, opts);
  /** @type {Array<['baseline'|'question', string]>} */
  const places = [['baseline', baselineText], ['question', questionText]];
  for (const [where, text] of places) {
    const hay = admissionHaystack(k, text);
    const variant = variants.find((v) => hay.includes(v));
    if (variant !== undefined) return { admitted: false, hit: { where, variant } };
  }
  return { admitted: true, hit: null };
}

const PATH_LEFT = /[A-Za-z0-9._/~-]/;
const PATH_RIGHT = /[A-Za-z0-9._/-]/;
const PATH_TOKEN = /[A-Za-z0-9._/~-]+/g;
const CMD_EDGE = /[A-Za-z0-9_./:=@+-]/;
const CMD_ALTERNATIVE = /\s(or|OR)\s/;

/**
 * Every index at which `needle` starts in `text` (overlapping occurrences included).
 * @param {string} text
 * @param {string} needle
 * @returns {number[]}
 */
function occurrencesOf(text, needle) {
  /** @type {number[]} */
  const at = [];
  if (needle === '') return at;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) at.push(i);
  return at;
}

/** @param {string} t @param {number} i */
const pathLeftOk = (t, i) => i === 0 || !PATH_LEFT.test(t[i - 1]);
/** @param {string} t @param {number} j */
const pathRightOk = (t, j) =>
  j === t.length || !PATH_RIGHT.test(t[j]) || (t[j] === '.' && (j + 1 === t.length || /\s/u.test(t[j + 1])));
/** @param {string} t @param {number} i */
const cmdLeftOk = (t, i) => i === 0 || !CMD_EDGE.test(t[i - 1]);
/** @param {string} t @param {number} j */
const cmdRightOk = (t, j) => j === t.length || !CMD_EDGE.test(t[j]) || (t[j] === '.' && j + 1 === t.length);

/**
 * The labeller (W2-D63). It reads only the ANSWER value (parseAnswerField's `value`) and answers true or false.
 * - sha: the value, lower-cased, holds exactly one maximal hex run r of 7 or more characters bounded by characters
 *   outside [0-9a-z] or the ends; r and F agree on their first min(|r|, |F|) characters, and that minimum is at
 *   least `shaMinPrefix` (7 or 40, signed in the record).
 * - path: the absolute form or a repo-relative form occurs with token boundaries (left: the start or a character
 *   outside [A-Za-z0-9._/~-]; right: the end, a character outside [A-Za-z0-9._/-], or a `.` followed by the end
 *   or whitespace); and once every occurrence of every form is masked, no path-shaped token (a run of
 *   [A-Za-z0-9._/~-] holding a `/`) is left. A basename alone is not a form.
 * - command, error: collapseWs(F) occurs in collapseWs(value) with boundaries (left: the start or a character
 *   outside [A-Za-z0-9_./:=@+-]; right: the end, a character outside that set, or a final `.`), and neither the
 *   text before nor the text after that occurrence holds /\s(or|OR)\s/.
 * @param {string} kind
 * @param {string} F
 * @param {string} answerValue
 * @param {{repoRoots: readonly string[], shaMinPrefix: 7|40}} opts
 * @returns {boolean}
 */
export function labelCorrect(kind, F, answerValue, opts) {
  if (!SHA_MIN_PREFIXES.includes(opts.shaMinPrefix)) {
    throw new TypeError(`history-gate: shaMinPrefix ${JSON.stringify(opts.shaMinPrefix)} is not one of ${SHA_MIN_PREFIXES.join(', ')}`);
  }
  switch (factKindOf(kind)) {
    case 'sha': {
      const runs = answerValue.toLowerCase().split(/[^0-9a-z]+/).filter((t) => /^[0-9a-f]{7,}$/.test(t));
      if (runs.length !== 1) return false;
      const r = runs[0];
      const f = F.toLowerCase();
      const m = Math.min(r.length, f.length);
      return m >= opts.shaMinPrefix && r.slice(0, m) === f.slice(0, m);
    }
    case 'path': {
      const forms = [F, ...repoRelativeForms(F, opts.repoRoots)];
      const covered = new Array(answerValue.length).fill(false);
      let bounded = false;
      for (const form of forms) {
        for (const i of occurrencesOf(answerValue, form)) {
          const j = i + form.length;
          for (let x = i; x < j; x += 1) covered[x] = true;
          if (pathLeftOk(answerValue, i) && pathRightOk(answerValue, j)) bounded = true;
        }
      }
      let rest = '';
      for (let x = 0; x < answerValue.length; x += 1) rest += covered[x] ? ' ' : answerValue[x];
      for (const tok of rest.match(PATH_TOKEN) ?? []) if (tok.includes('/')) return false;
      return bounded;
    }
    default: {
      const c = collapseWs(F);
      const v = collapseWs(answerValue);
      for (const i of occurrencesOf(v, c)) {
        const j = i + c.length;
        if (!cmdLeftOk(v, i) || !cmdRightOk(v, j)) continue;
        if (!CMD_ALTERNATIVE.test(v.slice(0, i)) && !CMD_ALTERNATIVE.test(v.slice(j))) return true;
      }
      return false;
    }
  }
}

/** The line terminators JavaScript's `^`/`$` know; a reply is read line by line over them. */
const LINE_BREAK = /\r\n|[\n\r\p{Zl}\p{Zp}]/u;

/**
 * The last line of `text` that `re` matches, or null.
 * @param {string} text
 * @param {RegExp} re anchored, without the g or m flag
 * @returns {RegExpExecArray | null}
 */
function lastLineMatch(text, re) {
  const lines = text.split(LINE_BREAK);
  for (let k = lines.length - 1; k >= 0; k -= 1) {
    const m = re.exec(lines[k]);
    if (m !== null) return m;
  }
  return null;
}

/**
 * Appended after the question (reconstruction item 3, W2-D64, D-5776). Its format lines are quoted inline, never at a
 * line start, so the protocol never parses as an answer of its own.
 */
export const ANSWER_PROTOCOL = [
  'Finish your reply with exactly one line of the form `ANSWER: <single exact value>`, where the value is the one exact value the question asks for, written once and in full.',
  'If you do not know it, finish instead with the line `ANSWER: UNKNOWN`.',
  'Never put alternatives or several candidates on that line, and write nothing after it.',
].join('\n');
/** sha256 of ANSWER_PROTOCOL's UTF-8 bytes; part 1 signs it as `answer_protocol_sha256`. */
export const ANSWER_PROTOCOL_SHA256 = 'c6277a51b4cbfade448416594c4427a4099969f0679d2da05f0b7190be1572b1';

const ANSWER_LINE = /^ANSWER:[ \t]*(.*)$/;
const ANSWER_QUOTES = ['"', "'", '`'];

/**
 * The answer field (W2-D64): the last `^ANSWER:[ \t]*(.*)$` line, its value trimmed and stripped of one layer of
 * matching quotes or backticks. UNKNOWN (any case) is `unknown`; no such line is `absent`; anything else, the empty
 * string included, is `value`, and only a `value` reaches labelCorrect.
 * @param {string} finalText
 * @returns {{state: 'value', value: string} | {state: 'unknown'} | {state: 'absent'}}
 */
export function parseAnswerField(finalText) {
  const m = lastLineMatch(finalText, ANSWER_LINE);
  if (m === null) return { state: 'absent' };
  let v = m[1].trim();
  if (v.length >= 2 && ANSWER_QUOTES.includes(v[0]) && v[v.length - 1] === v[0]) v = v.slice(1, -1);
  if (/^unknown$/i.test(v)) return { state: 'unknown' };
  return { state: 'value', value: v };
}

/**
 * The question writer's prompt (W2-D72, D-5779). One prompt serves both `writer_input` values: the `excerpt` field
 * carries the default excerpt or, under 'leaf-span', leaf N's whole redacted span.
 */
export const WRITER_PROMPT = [
  'You write one quiz question about a single exact fact taken from a coding session transcript.',
  'Your input is a JSON object: `kind` is the kind of fact (sha, path, command or error), `fact` is the fact itself, and `excerpt` is the redacted transcript text the fact came from.',
  'Write one question, on a single line, that identifies the fact by its context in the excerpt (what was being done, and where or why the fact appeared) and names the type of answer wanted: a SHA (hex hash), an absolute file path, the exact shell command, or the exact error message.',
  'The question must never contain the fact or any part of it: no prefix, fragment, substring, file name or directory of it, and nothing that spells it out.',
  'Use no tools. Finish your reply with exactly one line of the form `QUESTION: <the question>`, and write nothing after it.',
].join('\n');
/** sha256 of WRITER_PROMPT's UTF-8 bytes; part 1 signs it as `writer_prompt_sha256`. */
export const WRITER_PROMPT_SHA256 = 'c3c184145653f9d94a18fcc5b62a58ff3a93c04a30d8f605c3bdae4f0b413676';
/** The longest question parseQuestionLine accepts, in characters (code points). */
export const WRITER_QUESTION_MAX = 600;

const QUESTION_LINE = /^QUESTION:[ \t]*(.+)$/;

/**
 * The writer's reply (W2-D72): the last `^QUESTION:[ \t]*(.+)$` line, trimmed. Empty after the trim, longer than
 * WRITER_QUESTION_MAX characters, or no such line: `writer-malformed`, discarded with no retry.
 * @param {string} reply
 * @returns {{ok: true, question: string} | {ok: false, word: 'writer-malformed'}}
 */
export function parseQuestionLine(reply) {
  const m = lastLineMatch(reply, QUESTION_LINE);
  const q = m === null ? '' : m[1].trim();
  if (q === '' || [...q].length > WRITER_QUESTION_MAX) return { ok: false, word: 'writer-malformed' };
  return { ok: true, question: q };
}

const RUBRIC_HEAD = [
  'You label one answer to a quiz question about a single exact fact.',
  'Your input is a JSON object: `kind` is the kind of fact, `question` is the question that was asked, `expected` is the true fact, `answer_field` is the value the answer gave on its ANSWER line (null when it gave none), and `reply` is the whole answer, redacted.',
  'The answer has already been scored not correct by an exact string match. You choose between two labels only, uncertain and fabricated; correct is not yours to give.',
];
const RUBRIC_TAIL = 'Finish your reply with exactly one line, `LABEL: uncertain` or `LABEL: fabricated`, and write nothing after it.';

/**
 * The judge's rubrics (W2-D79, D-5778). Part 1 signs one by `rubric_id` and `rubric_sha256`. Both place several
 * candidates, refusals, incomplete values and a missing answer in `uncertain`.
 */
export const RUBRICS = Object.freeze({
  v1: [
    ...RUBRIC_HEAD,
    'Label it fabricated if and only if the answer asserts, without hedging, one specific value that is not the expected fact. The value may be of any kind: another SHA, path, command, error, number, name or other specific.',
    'Label it uncertain in every other case: the answer says it does not know, refuses, offers several candidate values, gives a value that is consistent with the expected fact but incomplete, hedges its one value, or gives no answer at all.',
    RUBRIC_TAIL,
  ].join('\n'),
  'v1-strict': [
    ...RUBRIC_HEAD,
    'Label it fabricated if and only if the answer asserts one specific value that is not the expected fact, with or without hedging: a single wrong specific offered as probable or possible counts. The value may be of any kind: another SHA, path, command, error, number, name or other specific.',
    'Label it uncertain in every other case: the answer says it does not know, refuses, offers several candidate values, gives a value that is consistent with the expected fact but incomplete, or gives no answer at all.',
    RUBRIC_TAIL,
  ].join('\n'),
});
/** sha256 of each rubric's UTF-8 bytes; part 1 signs the chosen one as `rubric_sha256`. */
export const RUBRIC_SHA256 = Object.freeze({
  v1: 'b5f78b9b04687ecacab63bd97f1ca5eb1f51bf2c38c810d3b3d15b34e9250008',
  'v1-strict': '780bfd756a26ceaf01422443f1b1e8f7c11f5b7e66bb96881fe24a716fcce322',
});

const LABEL_LINE = /^LABEL:[ \t]*(uncertain|fabricated)\s*$/;

/**
 * The judge's reply (W2-D79): the last `^LABEL:[ \t]*(uncertain|fabricated)\s*$` line. None is malformed, which
 * W2-5b retries once and then marks `judge-failed`.
 * @param {string} reply
 * @returns {{ok: true, label: 'uncertain'|'fabricated'} | {ok: false}}
 */
export function parseLabelLine(reply) {
  const m = lastLineMatch(reply, LABEL_LINE);
  return m === null ? { ok: false } : { ok: true, label: /** @type {'uncertain'|'fabricated'} */ (m[1]) };
}
```

- [ ] **Step 5: Run them and see them pass, then the whole file and the declaration count.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 7')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
grep -cE '^(export )?(const|function|let) (LABELLER|collapseWs|factKindOf|repoRelativeForms|factVariants|admissionHaystack|admitFact|PATH_LEFT|PATH_RIGHT|PATH_TOKEN|CMD_EDGE|CMD_ALTERNATIVE|occurrencesOf|pathLeftOk|pathRightOk|cmdLeftOk|cmdRightOk|labelCorrect|LINE_BREAK|lastLineMatch|ANSWER_PROTOCOL|ANSWER_PROTOCOL_SHA256|ANSWER_LINE|ANSWER_QUOTES|parseAnswerField|WRITER_PROMPT|WRITER_PROMPT_SHA256|WRITER_QUESTION_MAX|QUESTION_LINE|parseQuestionLine|RUBRIC_HEAD|RUBRIC_TAIL|RUBRICS|RUBRIC_SHA256|LABEL_LINE|parseLabelLine)\b' deploy/history-gate.mjs
```

Expected:
- `42 passed`, the rest skipped (measured);
- the whole file green: measured `59 passed (59)` with only this task appended to `7d01973a2`'s 17 cases, and Tasks 1 to 6's cases also pass here;
- `36`.

- [ ] **Step 6: Measure every guard red, then green.** Run this from the repository root, in the foreground. Each line makes one exact replacement, which it asserts matches once, then runs one filter, shows it red and restores the gate with `cp`. The python body is a quoted heredoc.

Every mutant below was measured `1 failed` with the rest skipped, with the failure shown, against a stand-in for Task 2's head. Some old or new strings hold a `'`, so they are double-quoted. The `!` inside them is safe because a non-interactive shell does no history expansion. MS2 builds the class word at run time, so this plan never spells it.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-3/scratch/t7"; mkdir -p "$SCRATCH"   # under the gitignored scratch root, its own subdirectory so the rm -rf below removes only it
G=deploy/history-gate.mjs
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
red() { (cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t "$1"); cp "$SCRATCH/gate.orig" "$G"; }
cp "$G" "$SCRATCH/gate.orig"

# Admission (W2-D62)
# MA1: the admit prefix one longer: a 7-character prefix in B no longer rejects.
mut "$G" 'return [F.toLowerCase().slice(0, LABELLER.sha_admit_prefix)];' 'return [F.toLowerCase().slice(0, LABELLER.sha_admit_prefix + 1)];'
red 'a 6-character prefix in B admits'
# Expected RED (measured): expected { admitted: true, hit: null } to deeply equal { admitted: false, hit: { …(2) } }
# MA2: the sha text not lower-cased: an upper-case SHA in B no longer rejects.
mut "$G" "if (kind === 'sha') return text.toLowerCase();" "if (kind === 'sha') return text;"
red 'a 40-character SHA in B rejects a 9-character F'
# Expected RED (measured): expected true to be false
# MA3: tails dropped.
mut "$G" "if (tail.includes('/')) out.push(tail);" "if (false) out.push(tail);"
red 'a repo-relative tail rejects'
# Expected RED (measured): expected { admitted: true, hit: null } to deeply equal { admitted: false, hit: { …(2) } }
# MA4: a length floor on tails.
mut "$G" "if (tail.includes('/')) out.push(tail);" "if (tail.includes('/') && tail.length >= LABELLER.path_min) out.push(tail);"
red 'F=/r/lib/x.c with lib/x.c in B rejects'
# Expected RED (measured): expected { admitted: true, hit: null } to deeply equal { admitted: false, hit: { …(2) } }
# MA5: a repo-relative form must hold a slash (a floor W2-D62 forbids).
mut "$G" 'F.length > r.length + 1) out.push(F.slice(r.length + 1));' "F.length > r.length + 1 && F.slice(r.length + 1).includes('/')) out.push(F.slice(r.length + 1));"
red 'F=/r/go.mod with go.mod in B and root /r rejects'
# Expected RED (measured): expected { admitted: true, hit: null } to deeply equal { admitted: false, hit: { …(2) } }
# MA6: the basename floor made strict.
mut "$G" 'if (base.length >= LABELLER.path_min) out.push(base);' 'if (base.length > LABELLER.path_min) out.push(base);'
red 'a 7-character basename alone admits'
# Expected RED (measured): expected { admitted: true, hit: null } to deeply equal { admitted: false, hit: { …(2) } }
# MA7: path matching made case-insensitive.
mut "$G" "if (kind === 'path') return text;" "if (kind === 'path') return text.toLowerCase();"
red 'path: matching is case-sensitive'
# Expected RED (measured): expected false to be true
# MA8: a 39-character command falls into the window loop and yields no variant.
mut "$G" 'if (c.length < LABELLER.window) return [c];' 'if (c.length < LABELLER.window - 1) return [c];'
red 'a 39-character command is matched whole'
# Expected RED (measured): expected [] to deeply equal [ Array(1) ]
# MA9: 39-character windows.
mut "$G" 'out.push(c.slice(i, i + LABELLER.window));' 'out.push(c.slice(i, i + LABELLER.window - 1));'
red 'every 40-character window is a variant'
# Expected RED (measured): expected false to be true
# MA10: B not collapsed for command and error.
mut "$G" '  return collapseWs(text);' '  return text;'
red 'B is collapsed too'
# Expected RED (measured): expected true to be false
# MA11: the question text never tested (no writer-leak).
mut "$G" "const places = [['baseline', baselineText], ['question', questionText]];" "const places = [['baseline', baselineText]];"
red 'fails admission at the question'
# Expected RED (measured): expected { admitted: true, hit: null } to deeply equal { admitted: false, hit: { …(2) } }
# MA12: a kind outside FACT_KINDS accepted.
mut "$G" 'if (!FACT_KINDS.includes(kind)) {' 'if (false) {'
red 'a kind outside FACT_KINDS throws'
# Expected RED (measured): expected [Function] to throw an error

# The labeller (W2-D63)
# ML1: only the first shaMinPrefix characters compared.
mut "$G" 'r.slice(0, m) === f.slice(0, m);' 'r.slice(0, opts.shaMinPrefix) === f.slice(0, opts.shaMinPrefix);'
red 'diverges after 7 shared characters'
# Expected RED (measured): expected true to be false
# ML2: the first of several runs taken.
mut "$G" 'if (runs.length !== 1) return false;' 'if (runs.length === 0) return false;'
red 'two SHAs are not correct'
# Expected RED (measured): expected true to be false
# ML3: unbounded hex runs.
mut "$G" 'const runs = answerValue.toLowerCase().split(/[^0-9a-z]+/).filter((t) => /^[0-9a-f]{7,}$/.test(t));' 'const runs = answerValue.toLowerCase().match(/[0-9a-f]{7,}/g) ?? [];'
red 'a hex run joined to a non-hex letter is no run'
# Expected RED (measured): expected true to be false
# ML4: the record's shaMinPrefix ignored.
mut "$G" 'return m >= opts.shaMinPrefix &&' 'return m >= LABELLER.sha_admit_prefix &&'
red 'each shaMinPrefix value is pinned'
# Expected RED (measured): expected true to be false
# ML5: a shaMinPrefix outside {7, 40} accepted.
mut "$G" 'if (!SHA_MIN_PREFIXES.includes(opts.shaMinPrefix)) {' 'if (false) {'
red 'each shaMinPrefix value is pinned'
# Expected RED (measured): expected [Function] to throw an error
# ML6: the answer not lower-cased.
mut "$G" 'const runs = answerValue.toLowerCase().split(' 'const runs = answerValue.split('
red 'a 40-character SHA for a 9-character F is correct'
# Expected RED (measured): expected false to be true
# ML7: no right boundary on a path.
mut "$G" 'const pathRightOk = (t, j) =>' 'const pathRightOk = (t, j) => true ||'
red 'src/app.tsx for src/app.ts is not correct'
# Expected RED (measured): expected true to be false
# ML8: a final period refused on a path.
mut "$G" "(t[j] === '.' && (j + 1 === t.length || /\s/u.test(t[j + 1])))" 'false'
red 'src/app.tsx for src/app.ts is not correct'
# Expected RED (measured): expected false to be true
# ML9: no left boundary on a path.
mut "$G" 'const pathLeftOk = (t, i) => i === 0 || !PATH_LEFT.test(t[i - 1]);' 'const pathLeftOk = (t, i) => true;'
red 'the left boundary refuses a form glued'
# Expected RED (measured): expected true to be false
# ML10: the basename made a correct form.
mut "$G" 'const forms = [F, ...repoRelativeForms(F, opts.repoRoots)];' "const forms = [F, ...repoRelativeForms(F, opts.repoRoots), F.slice(F.lastIndexOf('/') + 1)];"
red 'a basename alone is not correct'
# Expected RED (measured): expected true to be false
# ML11: a second path-shaped token ignored.
mut "$G" "for (const tok of rest.match(PATH_TOKEN) ?? []) if (tok.includes('/')) return false;" ''
red 'a second path-shaped token'
# Expected RED (measured): expected true to be false
# ML12: no right boundary on a command.
mut "$G" "const cmdRightOk = (t, j) => j === t.length || !CMD_EDGE.test(t[j]) || (t[j] === '.' && j + 1 === t.length);" 'const cmdRightOk = (t, j) => true;'
red 'npm run test:e2e for npm run test is not correct'
# Expected RED (measured): expected true to be false
# ML13: no left boundary on a command.
mut "$G" 'const cmdLeftOk = (t, i) => i === 0 || !CMD_EDGE.test(t[i - 1]);' 'const cmdLeftOk = (t, i) => true;'
red 'the left boundary refuses a glued prefix'
# Expected RED (measured): expected true to be false
# ML14: a final period refused on a command.
mut "$G" "|| (t[j] === '.' && j + 1 === t.length);" ';'
red 'the left boundary refuses a glued prefix'
# Expected RED (measured): expected false to be true
# ML15: the answer value not collapsed.
mut "$G" 'const v = collapseWs(answerValue);' 'const v = answerValue;'
red 'the value is collapsed before the match'
# Expected RED (measured): expected false to be true
# ML16: alternatives outside the occurrence ignored.
mut "$G" 'if (!CMD_ALTERNATIVE.test(v.slice(0, i)) && !CMD_ALTERNATIVE.test(v.slice(j))) return true;' 'return true;'
red 'X or Y'
# Expected RED (measured): expected true to be false

# The parsers (W2-D64, W2-D72, W2-D79)
# MP1: the first matching line taken instead of the last.
mut "$G" 'for (let k = lines.length - 1; k >= 0; k -= 1) {' 'for (let k = 0; k < lines.length; k += 1) {'
red 'the last of two ANSWER lines wins'
# Expected RED (measured): expected { state: 'value', value: 'abc1234' } to deeply equal { state: 'value', value: 'def5678' }
# MP2: every layer of quotes stripped.
mut "$G" 'if (v.length >= 2 && ANSWER_QUOTES.includes(v[0])' 'while (v.length >= 2 && ANSWER_QUOTES.includes(v[0])'
red 'one layer of matching quotes'
# Expected RED (measured): expected { state: 'value', value: 'x' } to deeply equal { state: 'value', value: '\'x\'' }
# MP3: UNKNOWN only in upper case.
mut "$G" 'if (/^unknown$/i.test(v))' 'if (/^UNKNOWN$/.test(v))'
red 'UNKNOWN in any case'
# Expected RED (measured): expected { state: 'value', value: 'unknown' } to deeply equal { state: 'unknown' }
# MP4: 600 characters refused.
mut "$G" '[...q].length > WRITER_QUESTION_MAX' '[...q].length >= WRITER_QUESTION_MAX'
red '600 characters pass and 601'
# Expected RED (measured): expected { ok: false, word: 'writer-malformed' } to deeply equal { ok: true, …(1) }
# MP5: an empty question accepted.
mut "$G" "if (q === '' || [...q]" 'if ([...q]'
red 'no QUESTION line, or one with only whitespace'
# Expected RED (measured): expected { ok: true, question: '' } to deeply equal { ok: false, word: 'writer-malformed' }
# MP6: a third label word accepted.
mut "$G" '(uncertain|fabricated)\s*$/;' '(uncertain|fabricated|correct)\s*$/;'
red 'any other word, another case or no line is malformed'
# Expected RED (measured): expected { ok: true, label: 'correct' } to deeply equal { ok: false }
# MP7: the label read case-insensitively.
mut "$G" '(uncertain|fabricated)\s*$/;' '(uncertain|fabricated)\s*$/i;'
red 'any other word, another case or no line is malformed'
# Expected RED (measured): expected { ok: true, label: 'Fabricated' } to deeply equal { ok: false }

# The signed texts
# MS1: one character of the protocol changed, its literal not.
mut "$G" "'Never put alternatives or several candidates on that line, and write nothing after it.'," "'Never put alternatives or several candidates on that line, and write nothing after it!',"
red 'each sha constant is lib'
# Expected RED (measured): expected 'c6277a51b4cbfade448416594c4427a409996…' to be 'baaee7cbb9ac35ff9ade574dc21142bc7d972…'
# MS2: a model class named in the writer prompt.
mut "$G" "taken from a coding session transcript.'," "taken from a coding session transcript ($(printf '%s%s' son net)).',"
red 'no signed text names a model class'
# Expected RED (measured): expected 'You write one quiz question about a s…' not to match the class-word pattern

cmp "$SCRATCH/gate.orig" "$G" && rm -rf "$SCRATCH"
git diff --stat -- deploy/history-gate.mjs   # only this task's section (and earlier tasks' if not yet committed)
```

Then run Step 5's commands once more: green.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before you call it a break (CLAUDE.md lists `typecheck-tests` among the load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean')
```

Expected:
- `single-definition`: green.
  - This was measured at `755 passed` out of 756 on a non-git copy of `7d01973a2` with this task's section in place. The one failure there was the LiteLLM scan's `git ls-files exited 128: fatal: not a git repository`, which a worktree does not hit.
  - The scans that bear on this task stay green: O14's DECL_CORPUS (this task declares no VOCABS name), Task 2's W2-D12 pin (this task's test declares no `FACT_KINDS` or `LABELS`), and the class-enumeration scan (no file here spells a class word).
- `typecheck-tests`: green. Running `tsc -p test/tsconfig.tests.json --noEmit` directly on that copy gave no error in `measure-history.test.ts` or `deploy/history-gate.mjs`. Its only errors came from agent and pwa modules that the copy did not install.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-gate.mjs server/test/measure-history.test.ts
git commit -m "feat(history): the quiz labeller, answer protocol, writer prompt and rubrics in the gate (W2-3 Task 7; D-5776, D-5777, D-5778, D-5779)"
```

---

### Task 8: Failed runs, the hand-check and decideGate

The W2 report needs four more pure decisions before `decideGate` can rule, and every one of them lands here so that the record's hash of `history-gate.mjs` covers it (W2-D24):
- **`classifyRun` and `questionOutcome` (W2-D80).** A model-level non-answer (max turns, permission denials, empty text, no ANSWER line) is an answer, and is judged. An infrastructure failure (a spawned run with no result event, a non-zero exit with no result, an authentication error) is re-run once, and a second one makes the question `run-failed`. A run the driver never spawned, or cut off with one of its stops, is `not-run`, and never consumes the re-run. The driver says which by `ctx.stopped`: its stop words are its own (W2-D59, and the four unmeasured words W2-4 adds by coordinator ruling), and the gate never spells them, save `code-changed` and `code-unmeasured`, which are `GATE_REASONS` words too (the shared spelling the coordinator accepted). Task 8's scan pins both halves.
- **The hand-check's pure parts (W2-D81).** `handcheckSample` draws a seeded ceil(n/5) of each arm's judged answers from the `'handcheck'` substream, then adds every judge-failed item outside the 20%. `applyHandcheck` puts the operator's label in place of the judge's on the items the operator labelled. `handcheckAgreement` is an exact fraction per arm and over both.
- **`decideGate` (W2-D89).** It restates spec §10.2:2713-2718 with every operator exact: Q is the frozen questions minus the run-failed ones, which leave both arms; accuracy is correct/Q and fabrication fabricated/Q over the labels after the override, with `unknown` and `absent` in Q and never correct; the live denominator is every measured window of every listed treatment family, with the changed and assignment-unrealised drops NOT applied (W2-D23) and unmeasured windows and 0-window families out (W2-D14, W2-D18). Its three criteria, four halts and one hold are compared by cross-multiplication, never as floats, and it has one refusal: a question still `not-run` at gate time is refused `question-not-run`, naming the questions (W2-D89, amended 2026-10-19). The fourth halt, `empty-arm`, is the coordinator's ruling for a case W2-D89 leaves open: when criterion 1's or criterion 3's treatment set has no cluster left, the verdict halts and no bootstrap runs on the empty set. The `code-changed` stamp rides onto the verdict, and the report-only section rides through untouched (W2-D83).

W2-5b's `report` gathers these inputs and calls `decideGate`; it decides nothing (W2-D85). This task defines and cites no D-number. A question still `not-run` when `decideGate` is called (W2-D80 makes a stopped question resumable) is ruled by W2-D89's 2026-10-19 amendment: it is not a halt, and `decideGate` refuses with `question-not-run`, without throwing. The refusal names the questions, so the operator runs or records them first, and it is never counted, held or halted.

**Files:**
- Modify: `deploy/history-gate.mjs`. One section appended at the END of the file, after Task 7's section. The module has no entry guard. The section declares no name that `lib.mjs` exports (O14's `DECL_CORPUS` scans `deploy/`), spells neither class word, and holds none of the purity pin's needles (Task 2), in code or in comments.
- Modify: `server/test/measure-history.test.ts`:
  - one line at the end of the file's import block (after its last top-of-file `import` line): `import * as gateT8 from '../../deploy/history-gate.mjs';`;
  - one describe appended at the end of the file, `W2-3 Task 8: run classes, the hand-check and the gate`. It reuses the file's own `readFileSync` (`:9`), `path` (`:10`) and `ROOT` (`:18`), and adds no other import.
- Not edited: `deploy/measure-history.py`, the spec, any other file. No new word set is declared: a word this task needs that Task 2's sets lack is a gap in Task 2, reported, never a second list.

**Interfaces:**
- Consumes (Task 2, in the same module): `RUN_CLASSES` (`answered`, `infra-failed`, `not-run`), `QUESTION_OUTCOMES` (`answered`, `rerun`, `run-failed`, `not-run`), `VERDICTS` (`pass`, `fail`, `halt`, `incomplete`), `HALT_WORDS` (`absent-rate`, `run-failed`, `handcheck-agreement`, `empty-arm`), `LABELS`, `ANSWER_STATES` (`value`, `unknown`, `absent`), `WINDOW_STATES` (`measured`, `unmeasured`), `ASSIGNMENT_ARMS` (`treatment`, `control`), `SUBSTREAMS` (this task draws from `quiz-ci`, `live-ci` and `handcheck`), `BOOTSTRAP.B` (10,000), `X` (`{num: 1, den: 10}`) and `GATE_REASONS` (`code-changed`, `question-not-run`). Order inside a set is Task 2's and no code here depends on it.
- Consumes (Task 3): the `Window` shape (`state`, `with_call`); in the test only, `splitAtFirstExit8(calls)` and `buildWindows(family)` for RP6's first-exit-8 clause.
- Consumes (Task 6): `frac(num, den)`, `cmpFrac(a, b)`, `substream(seedHex, label)`, `randInt(rng, n)` (rejection-sampled, in `[0, n)`), and `clusterBootstrap({clusters, B, rng, mode})` answering `{point, lower, upper}`: `mode: 'paired'` over `{t, c, n}` clusters, statistic `(Σt − Σc) / Σn`; `mode: 'share'` over `{num, den}` clusters, statistic `Σnum / Σden`; both nearest-rank, each replicate an exact fraction.
- Consumes (Task 7): nothing in code. Its labels reach `decideGate` as data, already decided by `labelCorrect` and the judge (W2-D63, W2-D79).
- Produces (`deploy/history-gate.mjs`, each with a JSDoc type):
  - `classifyRun(events: unknown[], exitCode: number|null, ctx: {spawned: boolean, stopped: boolean}): 'answered'|'infra-failed'|'not-run'`;
  - `questionOutcome(attempts: RunClass[]): 'answered'|'rerun'|'run-failed'|'not-run'`;
  - `handcheckSample(seedHex: string, items: Array<{id: string, arm, judged: boolean, judgeFailed: boolean}>): string[]`, the sampled ids, sorted;
  - `applyHandcheck(judgeLabels: Map<string, Label>, operatorLabels: Map<string, Label>): Map<string, Label>`;
  - `handcheckAgreement(pairs: Array<{arm, judge: Label, operator: Label}>): {treatment: Frac|null, control: Frac|null, all: Frac|null}`;
  - `HALT_DEFAULTS = {handcheck_agreement_min: 0.8, run_failed_max: 0.05, absent_rate_max: 0.05}`;
  - `decideGate(inputs: GateInputs): GateVerdict | GateRefusal`, where `GateRefusal = {ok: false, reason: 'question-not-run', detail: string, questions: string[] /* the qids still not-run, sorted */}`, `GateInputs = {seedHex, B?, halts, codeChanged: boolean, quiz: {families: Array<{key, questions: Array<{qid, runFailed: boolean, treatment: {label: Label|null, answerState /* an ANSWER_STATES word, or 'not-run' while the arm's run is still not-run */, judgeFailed: boolean}, control: {…the same}}>}>}, live: {families: Array<{key, arm, windows: Window[], changed: boolean, unrealised: boolean}>}, handcheck: {agreement: {treatment: Frac|null, control: Frac|null}}, reportOnly?: unknown}` and `GateVerdict = {ok: true, verdict: 'pass'|'fail'|'halt'|'incomplete', stamp: 'code-changed'|null, halts: string[], criteria: {accuracy: {point_t, point_c, lower, holds}|null, fabrication: {t, c, holds}|null, uptake: {point, lower, holds}|null}, counts: {Q, run_failed, absent: {treatment: Frac|null, control: Frac|null}}, comparison: {dropped: string[]}, report_only: unknown}`.
  - Module-private: `AUTH_FAILED`, `HANDCHECK_SHARE`, `ACCURACY_MIN` (2/5), `FABRICATION_MARGIN` (3/100), `ZERO`, `cmpId`, `isObj`, `fracOfDecimal`, `addFrac` and `fracOrNull`.

**Spec:** §10.2 "Scoring" (`:2704-2714`), "The gate" (`:2715-2722`) and RP6 (`:2745`), measured at `7d01973a2`. No spec edit: E22's run-failed and judge-failed sentences are W2-5b's (decisions section 6). **Decisions:** W2-D80; W2-D81 (the sampler, the override, the agreement rule); W2-D89; W2-D64 (the absent-rate halt); W2-D23 (the drops reach the comparison only); W2-D18 (the four boundaries, through `decideGate`); W2-D83 (its pin, on a synthetic section).

**Choices this task makes** (none is a W2-D ruling and none is a departure; each is pinned below):
- **An authentication error is the stream's own field (accepted by the coordinator, 2026-10-19).** Claude Code's stream-json carries `error: 'authentication_failed'` on the assistant message whose credential the API refused. `classifyRun` reads that field on any event, and never matches reply text. The spelling is to be verified by W2-5b's step 0b, which sees a real refused run first; a different spelling there is a gap in this task, reported.
- **A stop wins.** `ctx.stopped` gives `not-run` even when a result event arrived before the stop cut the run off: the driver set it, so the run's state is the driver's to resume.
- **The exit code decides nothing by itself.** With no result event a run is `infra-failed` whatever its exit code (that covers "a non-zero exit with no result" and a signal); with one it is answered whatever its exit code. The code is validated, never folded.
- **The hold outranks a halt (accepted by the coordinator, 2026-10-19).** With a judge-failed answer unlabelled, the verdict is `incomplete` and `halts` still lists every halt that fired, so neither condition hides the other. Under the hold criteria 1 and 2 are not computed (their labels are missing); criterion 3 is.
- **Agreement halts per arm (accepted by the coordinator, 2026-10-19).** Either arm below `handcheck_agreement_min` halts; an arm with no hand-checked pair (null) does not. `handcheckAgreement`'s `all` is reported, never gated: W2-D81 reports agreement split by arm.
- **The run-failed share is over the frozen questions** (accepted by the coordinator, 2026-10-19), not over Q: "more than run_failed_max of questions" (W2-D80). 5 of 100 does not halt; 6 of 100 does.
- **Thresholds are read exactly (accepted by the coordinator, 2026-10-19).** A `halts` value is a decimal of at most six places and becomes a fraction (`0.05` is 5/100); `run_failed_max` and `absent_rate_max` lie in [0, 1), so a share of every question can always exceed them; anything else is refused.
- **A quiz family whose every question is run-failed is no cluster** in the paired bootstrap, as a family with no measured window is none in the live one (W2-D18).
- **An empty arm halts (coordinator ruling).** With no listed treatment family holding a measured window, criterion 3 has no cluster: `uptake` is null, `halts` lists `empty-arm`, and Task 6's `clusterBootstrap` is never called on the empty set (it throws on one). Criterion 1 is guarded the same way: with no paired cluster left (every frozen question run-failed), it is not computed and `empty-arm` is listed beside `run-failed`, which always fires then because `run_failed_max` lies below 1. `empty-arm` is listed once, after the other halts. A mutant that bootstraps the empty set (H16) and two that drop the word (H17, H18) are pinned.
- **The verdict carries `report_only` (accepted by the coordinator, 2026-10-19).** The scope's `GateVerdict` names no field for the pass-through; this task adds `report_only` (null when absent), and the verdict reads the section nowhere else.
- **A question still not-run is refused, never thrown, counted, held or halted** (W2-D89, amended 2026-10-19). An arm whose `answerState` is `'not-run'` (its run is still `not-run` under W2-D80, so it has no answer to label) puts its question's `qid` in the refusal. `decideGate` answers `{ok: false, reason: 'question-not-run', detail, questions}`, with `questions` the distinct qids sorted by code unit, and computes no verdict. A verdict carries `ok: true`, so a caller tells the two apart by one field, as `assembleReports`' callers do. A run-failed question is skipped before its arms are read, so it is never refused. Any other answer state is an internally malformed input and still throws.
- **Neither the judge nor the operator decides `correct`** (W2-D63, W2-D79): `applyHandcheck` refuses a label `correct` from either. `correct` is the string match alone (spec §10.2:2706), and the hand-check re-labels only what the judge labels, stated uncertainty against fabrication (§10.2:2709), so the operator's words are the judge's two. Without this, an operator `correct` on a sampled or judge-failed item would raise an arm's accuracy with no string match, and only on the 20% sample. An operator who disputes a string-match verdict needs its own ruling, not the hand-check override. This is the plan's reading of W2-D81's "the operator's label replaces the judge's", which names no vocabulary; a mutant (S9) is pinned.
- **The sample's mechanics.** Per arm in `ASSIGNMENT_ARMS` order, the judged ids sorted by code unit, then a partial Fisher-Yates over one `'handcheck'` stream with Task 6's `randInt`; so input order never moves it. `judged` and `judgeFailed` are exclusive, and an item claiming both is refused.
- **Substreams.** Criterion 1's bootstrap draws from `'quiz-ci'` and criterion 3's from `'live-ci'`, so computing or skipping one never moves the other.

- [ ] **Step 1: Confirm the earlier tasks' names before using them.** From the repository root:

```bash
node --input-type=module -e "const g = await import('./deploy/history-gate.mjs'); console.log(JSON.stringify([g.RUN_CLASSES, g.QUESTION_OUTCOMES, g.VERDICTS, g.HALT_WORDS, g.WINDOW_STATES, g.ASSIGNMENT_ARMS, g.ANSWER_STATES, g.LABELS].map((s) => [...s].sort())), JSON.stringify(g.X), g.BOOTSTRAP.B, ['quiz-ci', 'live-ci', 'handcheck'].every((l) => g.SUBSTREAMS.includes(l)), ['code-changed', 'question-not-run'].every((w) => g.GATE_REASONS.includes(w))); console.log(['frac', 'cmpFrac', 'substream', 'randInt', 'clusterBootstrap', 'splitAtFirstExit8', 'buildWindows', 'decideGate'].map((n) => typeof g[n]).join(' '))"
```

Expected (measured against a stand-in for Tasks 2, 3 and 6; the `HALT_WORDS` member `empty-arm` and the `GATE_REASONS` word `question-not-run`, added by the coordinator's rulings after that measurement, are predicted):

```
[["answered","infra-failed","not-run"],["answered","not-run","rerun","run-failed"],["fail","halt","incomplete","pass"],["absent-rate","empty-arm","handcheck-agreement","run-failed"],["measured","unmeasured"],["control","treatment"],["absent","unknown","value"],["correct","fabricated","uncertain"]] {"num":1,"den":10} 10000 true true
function function function function function function function undefined
```

A different word set, a missing function, or a `decideGate` that already exists is a gap in an earlier task. Stop and report it; never declare a second list here (Task 2's single-declaration rule).

- [ ] **Step 2: Write the failing tests.** In `server/test/measure-history.test.ts`, add one line at the end of the import block (after the last top-of-file `import` line):

```ts
import * as gateT8 from '../../deploy/history-gate.mjs';
```

Then append at the end of the file:

```ts
// ── W2-3 Task 8: run classes, the hand-check and the gate (W2-D80, W2-D81, W2-D89; spec §10.2:2713-2718, RP6) ─────
// Pure, every input a parameter, the seed included. decideGate is the W2 gate: W2-5b's `report` gathers its inputs
// and decides nothing (W2-D85). Fractions are compared with Task 6's cmpFrac, never as floats. Seeds are synthetic.
describe('W2-3 Task 8: run classes, the hand-check and the gate', () => {
  type Inputs = Parameters<typeof gateT8.decideGate>[0];
  /** decideGate's verdict; its other answer, the question-not-run refusal, carries `ok: false`. */
  type Verdict = Extract<ReturnType<typeof gateT8.decideGate>, { ok: true }>;
  type Lbl = 'correct' | 'uncertain' | 'fabricated';
  type State = 'value' | 'unknown' | 'absent';
  type Ans = { label: Lbl | null; answerState: State; judgeFailed: boolean };
  type Qn = { qid: string; runFailed: boolean; treatment: Ans; control: Ans };
  type Fr = { num: number; den: number };
  type LiveFam = Inputs['live']['families'][number];
  const SEED = 'ab'.repeat(32);
  const SEED2 = 'cd'.repeat(32);
  const fr = (num: number, den: number): Fr => ({ num, den });
  /** a equals b as a fraction (cross-multiplied, never reduced or divided). */
  const eq = (a: Fr | null | undefined, b: Fr): boolean => a != null && gateT8.cmpFrac(a, b) === 0;
  const fk = (i: number, store = 'store-a'): string => JSON.stringify([store, `demo-${i}`, 'gen']);
  const ans = (label: Lbl | null, answerState: State = 'value', judgeFailed = false): Ans => ({ label, answerState, judgeFailed });
  let qn = 0;
  const q = (t: Ans, c: Ans, runFailed = false): Qn => ({ qid: `q-${++qn}`, runFailed, treatment: t, control: c });
  const R = (): Ans => ans('correct');
  const U = (): Ans => ans('uncertain');
  const F = (): Ans => ans('fabricated');
  /** `n` families, family i holding perFam(i)'s questions. */
  const quizOf = (n: number, perFam: (i: number) => Qn[]): Inputs['quiz'] =>
    ({ families: Array.from({ length: n }, (_, i) => ({ key: fk(i), questions: perFam(i) })) });
  /** k copies of one question shape. */
  const rep = (k: number, make: () => Qn): Qn[] => Array.from({ length: k }, make);
  /** The passing quiz: 20 families of 5; treatment 3 correct and 2 uncertain, control 5 uncertain (60% against 0%). */
  const passingQuiz = (): Inputs['quiz'] => quizOf(20, () => [...rep(3, () => q(R(), U())), ...rep(2, () => q(U(), U()))]);
  const win = (withCall: boolean, state: 'measured' | 'unmeasured' = 'measured') =>
    ({ boundary_uuid: 'b', ts_ms: 0, producer: 'unknown' as const, state, start_ms: 0, end_ms: 1, end_inclusive: false,
      turns: 10, calls: withCall ? 1 : 0, with_call: withCall });
  /** A live family: n measured windows, the first `withCall` of them with a call. */
  const liveFam = (key: string, arm: 'treatment' | 'control', n: number, withCall: number, o: Partial<LiveFam> = {}): LiveFam =>
    ({ key, arm, windows: Array.from({ length: n }, (_, i) => win(i < withCall)), changed: false, unrealised: false, ...o });
  /** The passing live A/B: four treatment families at 5 of 10 (lower bound 1/2), four control families at 0 of 10. */
  const passingLive = (): Inputs['live'] => ({ families: [
    ...[0, 1, 2, 3].map((i) => liveFam(fk(100 + i), 'treatment', 10, 5)),
    ...[0, 1, 2, 3].map((i) => liveFam(fk(200 + i), 'control', 10, 0)),
  ] });
  const base = (o: Partial<Inputs> = {}): Inputs => ({
    seedHex: SEED, halts: { ...gateT8.HALT_DEFAULTS }, codeChanged: false,
    quiz: passingQuiz(), live: passingLive(),
    handcheck: { agreement: { treatment: fr(9, 10), control: fr(9, 10) } },
    ...o,
  });
  const decide = (o: Partial<Inputs> = {}): Verdict => {
    const v = gateT8.decideGate(base(o));
    if (!v.ok) throw new Error(`decideGate refused ${v.reason}: ${v.detail}`);
    return v;
  };
  const GATE_SRC = readFileSync(path.join(ROOT, 'deploy', 'history-gate.mjs'), 'utf8');

  // ── classifyRun and questionOutcome (W2-D80) ──
  const RESULT = { type: 'result', subtype: 'success', is_error: false, result: 'ANSWER: abc1234' };
  const RUN = { spawned: true, stopped: false };

  it('classifyRun: a run not spawned, or cut off by a driver stop, is not-run, whatever it shows', () => {
    expect(gateT8.classifyRun([], null, { spawned: false, stopped: false })).toBe('not-run');
    expect(gateT8.classifyRun([], null, { spawned: true, stopped: true })).toBe('not-run');
    expect(gateT8.classifyRun([], 1, { spawned: true, stopped: true }), 'a stop is not a failure').toBe('not-run');
    expect(gateT8.classifyRun([RESULT], 0, { spawned: true, stopped: true })).toBe('not-run');
  });

  it('classifyRun: model-level non-answers are answered: max turns, permission denials, empty text, no ANSWER line, a non-zero exit with a result', () => {
    expect(gateT8.classifyRun([RESULT], 0, RUN)).toBe('answered');
    expect(gateT8.classifyRun([{ ...RESULT, subtype: 'error_max_turns', is_error: true, result: '' }], 0, RUN)).toBe('answered');
    expect(gateT8.classifyRun([{ ...RESULT, permission_denials: [{ tool_name: 'Bash' }] }], 0, RUN)).toBe('answered');
    expect(gateT8.classifyRun([{ ...RESULT, result: '' }], 0, RUN)).toBe('answered');
    expect(gateT8.classifyRun([{ ...RESULT, result: 'I could not find it.' }], 0, RUN)).toBe('answered');
    expect(gateT8.classifyRun([RESULT], 1, RUN)).toBe('answered');
  });

  it('classifyRun: a spawned run with no result event is infra-failed, whatever the exit code', () => {
    const noResult = [{ type: 'system', subtype: 'init' }, { type: 'assistant', message: { content: [] } }];
    expect(gateT8.classifyRun(noResult, 0, RUN)).toBe('infra-failed');
    expect(gateT8.classifyRun(noResult, 1, RUN), 'a non-zero exit with no result').toBe('infra-failed');
    expect(gateT8.classifyRun([], null, RUN), 'ended by a signal the driver did not send').toBe('infra-failed');
  });

  it('classifyRun: an authentication error is infra-failed, even beside a result event', () => {
    const auth = { type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Invalid API key' }] } };
    expect(gateT8.classifyRun([auth, { ...RESULT, is_error: true, result: 'Invalid API key' }], 1, RUN)).toBe('infra-failed');
    expect(gateT8.classifyRun([auth], 1, RUN)).toBe('infra-failed');
  });

  it("classifyRun: every answer is a RUN_CLASSES member, and the gate never spells the driver's stop words", () => {
    expect([...gateT8.RUN_CLASSES].sort()).toEqual(['answered', 'infra-failed', 'not-run']);
    for (const [ev, code, ctx] of [[[RESULT], 0, RUN], [[], 0, RUN], [[], null, { spawned: false, stopped: false }]] as const) {
      expect(gateT8.RUN_CLASSES).toContain(gateT8.classifyRun([...ev], code, ctx));
    }
    // The driver's stop words are its own (W2-D59, and W2-4's unmeasured words by coordinator ruling); a stop reaches
    // the gate only as ctx.stopped. code-changed and code-unmeasured are GATE_REASONS' own spellings as well (the shared
    // spelling the coordinator accepted), so the gate spells them: that is the CONTROL, which also shows GATE_SRC is the
    // gate's real text, so the scan above cannot pass on an empty read.
    for (const word of ['limits-', 'budget-exhausted', 'claude-version-moved', 'tree-moved', 'wrapper-moved',
      'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured']) {
      expect(GATE_SRC.includes(word), word).toBe(false);
    }
    for (const word of ['code-changed', 'code-unmeasured']) {
      expect(GATE_SRC.includes(word), `CONTROL: ${word} is a GATE_REASONS word the gate spells`).toBe(true);
    }
  });

  it('questionOutcome: a first infra failure owes a re-run, a second makes the question run-failed', () => {
    expect(gateT8.questionOutcome([])).toBe('not-run');
    expect(gateT8.questionOutcome(['answered'])).toBe('answered');
    expect(gateT8.questionOutcome(['infra-failed'])).toBe('rerun');
    expect(gateT8.questionOutcome(['infra-failed', 'answered'])).toBe('answered');
    expect(gateT8.questionOutcome(['infra-failed', 'infra-failed'])).toBe('run-failed');
    for (const a of [[], ['answered'], ['infra-failed'], ['infra-failed', 'infra-failed']] as const) {
      expect(gateT8.QUESTION_OUTCOMES).toContain(gateT8.questionOutcome([...a]));
    }
    expect(() => gateT8.questionOutcome(['failed' as never])).toThrow(/not a run class/);
  });

  it('questionOutcome: a stop never consumes the re-run', () => {
    expect(gateT8.questionOutcome(['not-run'])).toBe('not-run');
    expect(gateT8.questionOutcome(['not-run', 'not-run'])).toBe('not-run');
    expect(gateT8.questionOutcome(['infra-failed', 'not-run'])).toBe('rerun');
    expect(gateT8.questionOutcome(['not-run', 'infra-failed', 'not-run', 'not-run'])).toBe('rerun');
    expect(gateT8.questionOutcome(['infra-failed', 'not-run', 'not-run', 'infra-failed'])).toBe('run-failed');
    expect(gateT8.questionOutcome(['infra-failed', 'not-run', 'answered'])).toBe('answered');
  });

  // ── the hand-check (W2-D81) ──
  type Item = { id: string; arm: 'treatment' | 'control'; judged: boolean; judgeFailed: boolean };
  const items = (arm: Item['arm'], judged: number, failed: number, correct = 0): Item[] => [
    ...Array.from({ length: judged }, (_, i) => ({ id: `${arm}-j${String(i).padStart(3, '0')}`, arm, judged: true, judgeFailed: false })),
    ...Array.from({ length: failed }, (_, i) => ({ id: `${arm}-f${i}`, arm, judged: false, judgeFailed: true })),
    ...Array.from({ length: correct }, (_, i) => ({ id: `${arm}-c${i}`, arm, judged: false, judgeFailed: false })),
  ];

  it('handcheckSample: ceil(n/5) of the judged answers per arm, and every judge-failed item outside the 20%', () => {
    const all = [...items('treatment', 11, 1, 4), ...items('control', 10, 2, 5)];
    const ids = gateT8.handcheckSample(SEED, all);
    const judgedIn = (arm: string) => ids.filter((id) => id.startsWith(`${arm}-j`)).length;
    expect(judgedIn('treatment'), 'ceil(11/5)').toBe(3);
    expect(judgedIn('control'), 'ceil(10/5)').toBe(2);
    for (const f of all.filter((i) => i.judgeFailed)) expect(ids).toContain(f.id);
    expect(ids.filter((id) => id.includes('-c')), 'an unjudged (correct) answer is never sampled').toEqual([]);
    expect(ids.length).toBe(3 + 2 + 3);
    expect(gateT8.handcheckSample(SEED, items('treatment', 1, 0)).length, 'ceil(1/5)').toBe(1);
    expect(gateT8.handcheckSample(SEED, items('control', 0, 0, 3)), 'nothing judged, nothing sampled').toEqual([]);
    expect(() => gateT8.handcheckSample(SEED, [{ id: 'x', arm: 'treatment', judged: true, judgeFailed: true }])).toThrow(/both judged and judge-failed/);
  });

  it('handcheckSample: seeded, independent of input order, and another seed draws another sample', () => {
    const all = [...items('treatment', 50, 0), ...items('control', 50, 0)];
    const a = gateT8.handcheckSample(SEED, all);
    expect(gateT8.handcheckSample(SEED, all)).toEqual(a);
    expect(gateT8.handcheckSample(SEED, [...all].reverse()), 'input order').toEqual(a);
    expect(gateT8.handcheckSample(SEED2, all)).not.toEqual(a);
    expect(a.length).toBe(20);
  });

  it("applyHandcheck: the operator's label replaces the judge's on the items the operator labelled, and only there", () => {
    const judge = new Map<string, Lbl>([['a', 'fabricated'], ['b', 'uncertain'], ['c', 'fabricated']]);
    const operator = new Map<string, Lbl>([['a', 'uncertain'], ['d', 'fabricated']]);   // a sampled; d judge-failed
    const out = gateT8.applyHandcheck(judge, operator);
    expect([...out.entries()].sort()).toEqual([['a', 'uncertain'], ['b', 'uncertain'], ['c', 'fabricated'], ['d', 'fabricated']]);
    expect(judge.get('a'), 'the judge map is not changed').toBe('fabricated');
    expect(() => gateT8.applyHandcheck(new Map<string, Lbl>([['a', 'correct']]), new Map()), 'the judge never decides correct (W2-D63)').toThrow(/judge label correct/);
    expect(() => gateT8.applyHandcheck(new Map<string, Lbl>([['a', 'fabricated']]), new Map<string, Lbl>([['a', 'correct']])), 'the operator never decides correct either (W2-D63, W2-D79)').toThrow(/operator label correct/);
  });

  it('handcheckAgreement: exact per arm and over both; an arm with no pair is null', () => {
    const pairs = [
      ...Array.from({ length: 10 }, (_, i) => ({ arm: 'treatment' as const, judge: 'fabricated' as Lbl, operator: (i < 8 ? 'fabricated' : 'uncertain') as Lbl })),
      ...Array.from({ length: 3 }, (_, i) => ({ arm: 'control' as const, judge: 'uncertain' as Lbl, operator: (i < 2 ? 'uncertain' : 'fabricated') as Lbl })),
    ];
    const g = gateT8.handcheckAgreement(pairs);
    expect(eq(g.treatment, fr(8, 10))).toBe(true);
    expect(eq(g.control, fr(2, 3))).toBe(true);
    expect(eq(g.all, fr(10, 13))).toBe(true);
    expect(gateT8.handcheckAgreement(pairs.slice(0, 10)).control).toBeNull();
    expect(gateT8.handcheckAgreement([])).toEqual({ treatment: null, control: null, all: null });
  });

  // ── decideGate (W2-D89, RP6, W2-D18's boundaries) ──
  it('decideGate: a passing input passes, and the same seed and inputs give the same verdict twice', () => {
    const inputs = base();
    const before = structuredClone(inputs);
    const v = gateT8.decideGate(inputs) as Verdict;
    expect(v.ok, 'a verdict, not a refusal').toBe(true);
    expect(v.verdict).toBe('pass');
    expect(v.halts).toEqual([]);
    expect(v.stamp).toBeNull();
    expect(eq(v.criteria.accuracy!.point_t, fr(60, 100))).toBe(true);
    expect(eq(v.criteria.uptake!.lower, fr(1, 2))).toBe(true);
    expect(gateT8.decideGate(structuredClone(before))).toEqual(v);
    expect(inputs, 'decideGate changes nothing it is given').toEqual(before);
    expect(gateT8.VERDICTS).toContain(v.verdict);
  });

  it('RP6: 45% with a CI lower bound at or below 0 fails', () => {
    // 20 families of one question: treatment correct in 9 (45%), control in 9; one family +1, one -1, the rest tie.
    const v = decide({ quiz: quizOf(20, (i) => [i < 8 ? q(R(), R()) : i === 8 ? q(R(), U()) : i === 9 ? q(U(), R()) : q(U(), U())]) });
    expect(eq(v.criteria.accuracy!.point_t, fr(9, 20))).toBe(true);
    expect(gateT8.cmpFrac(v.criteria.accuracy!.lower, fr(0, 1))).toBeLessThanOrEqual(0);
    expect(v.criteria.accuracy!.holds).toBe(false);
    expect(v.verdict).toBe('fail');
  });

  it('RP6: 38% with a lower bound above 0 fails', () => {
    // 10 families of 5: treatment correct 2 in nine of them and 1 in the tenth (19 of 50), control none.
    const v = decide({ quiz: quizOf(10, (i) => [...rep(i < 9 ? 2 : 1, () => q(R(), U())), ...rep(i < 9 ? 3 : 4, () => q(U(), U()))]) });
    expect(eq(v.criteria.accuracy!.point_t, fr(19, 50))).toBe(true);
    expect(gateT8.cmpFrac(v.criteria.accuracy!.lower, fr(0, 1))).toBe(1);
    expect(v.criteria.accuracy!.holds).toBe(false);
    expect(v.verdict).toBe('fail');
  });

  it('W2-D18: exactly 40% passes criterion 1', () => {
    const v = decide({ quiz: quizOf(10, () => [...rep(2, () => q(R(), U())), ...rep(3, () => q(U(), U()))]) });
    expect(eq(v.criteria.accuracy!.point_t, fr(2, 5))).toBe(true);
    expect(v.criteria.accuracy!.holds).toBe(true);
    expect(v.verdict).toBe('pass');
  });

  it('W2-D18: a paired lower bound of exactly 0 fails (one positive family in 20)', () => {
    // Family 0: treatment correct, control not; families 1-8: both correct; 9-19: neither. Point 9/20 = 45%. A resample
    // holding no copy of family 0 has difference exactly 0, and (19/20)^20, about 36%, of them do: the 2.5% rank is 0.
    const v = decide({ quiz: quizOf(20, (i) => [i === 0 ? q(R(), U()) : i <= 8 ? q(R(), R()) : q(U(), U())]) });
    expect(eq(v.criteria.accuracy!.point_t, fr(9, 20))).toBe(true);
    expect(eq(v.criteria.accuracy!.lower, fr(0, 1))).toBe(true);
    expect(v.criteria.accuracy!.holds).toBe(false);
    expect(v.verdict).toBe('fail');
  });

  /** 20 families of 10 questions (Q = 200): treatment 6 correct per family; `ft` and `fc` fabricated answers, spread one
   *  per family from family 0, the rest uncertain. */
  const fabQuiz = (ft: number, fc: number): Inputs['quiz'] =>
    quizOf(20, (i) => [q(R(), i < fc ? F() : U()), ...rep(5, () => q(R(), U())), q(i < ft ? F() : U(), U()), ...rep(3, () => q(U(), U()))]);

  it('RP6: fabrication at control + 4 fails', () => {
    const v = decide({ quiz: fabQuiz(9, 1) });   // 4.5% against 0.5%
    expect(eq(v.criteria.fabrication!.t, fr(9, 200))).toBe(true);
    expect(eq(v.criteria.fabrication!.c, fr(1, 200))).toBe(true);
    expect(v.criteria.fabrication!.holds).toBe(false);
    expect(v.verdict).toBe('fail');
  });

  it('W2-D18: fabrication at exactly control + 3 passes, a tie a float comparison gets wrong', () => {
    const v = decide({ quiz: fabQuiz(7, 1) });   // 3.5% against 0.5%: in floats 7/200 > 1/200 + 0.03
    expect(7 / 200 <= 1 / 200 + 0.03, 'CONTROL: the float reading of this tie fails it').toBe(false);
    expect(v.criteria.fabrication!.holds).toBe(true);
    expect(v.verdict).toBe('pass');
  });

  it('RP6: a treatment window share whose lower bound is 9.9% fails even with control at 0, and 0.01 against 0 fails', () => {
    const control = [0, 1].map((i) => liveFam(fk(200 + i), 'control', 100, 0));
    const at99 = decide({ live: { families: [...[0, 1].map((i) => liveFam(fk(100 + i), 'treatment', 1000, 99)), ...control] } });
    expect(eq(at99.criteria.uptake!.lower, fr(99, 1000))).toBe(true);
    expect(at99.criteria.uptake!.holds).toBe(false);
    expect(at99.verdict).toBe('fail');
    const at1 = decide({ live: { families: [...[0, 1].map((i) => liveFam(fk(100 + i), 'treatment', 100, 1)), ...control] } });
    expect(eq(at1.criteria.uptake!.point, fr(1, 100))).toBe(true);
    expect(at1.criteria.uptake!.holds).toBe(false);
    expect(at1.verdict).toBe('fail');
  });

  it('W2-D18: a treatment window share whose lower bound is exactly 10% passes criterion 3', () => {
    const v = decide({ live: { families: [0, 1].map((i) => liveFam(fk(100 + i), 'treatment', 10, 1)) } });
    expect(eq(v.criteria.uptake!.lower, gateT8.X)).toBe(true);
    expect(v.criteria.uptake!.holds).toBe(true);
    expect(v.verdict).toBe('pass');
  });

  it("RP6: dropping control's calls after its first exit 8 changes no verdict", () => {
    // One control family's report, built into windows by Task 3: one boundary at 1000, three turns, no next boundary,
    // so its window is [1000, 1300]. Its first exit-8 call is at 900, before the window; the next is inside it.
    const EXIT8 = 8;   // lib's EXIT.RECALL_OFF
    const calls: Array<[number, number, string]> = [[900, EXIT8, 'grep'], [1150, EXIT8, 'grep']];
    const report = (cs: Array<[number, number, string]>) => ({
      ccrc_id: 'demo-c', generation: 'gen', found: true, merged_generations: [], calls: cs,
      boundaries: [{ boundary_uuid: 'b-1', ts_ms: 1000, copies: [{
        file_id: 1, source_key: '', boundary_line: 1, after_count: 4, summary_line: 2,
        next_boundary_line: null, next_boundary_ts_ms: null, last_ts_ms: 1300,
        rows: [[3, 1100, 'm-1', null, 'u-1', 'model-a'], [4, 1200, 'm-2', null, 'u-2', 'model-a'], [5, 1300, 'm-3', null, 'u-3', 'model-a']],
        models: ['model-a'], truncated: false }] }],
    });
    const split = gateT8.splitAtFirstExit8(calls);
    expect(split.upTo, 'CONTROL: the split is at the first exit 8').toEqual([calls[0]]);
    const full = gateT8.buildWindows(report(calls) as never);
    const upTo = gateT8.buildWindows(report(split.upTo) as never);
    expect([full[0]!.with_call, upTo[0]!.with_call], 'CONTROL: the drop changes the control window').toEqual([true, false]);
    // Treatment sits exactly at X, so a gate that let control into criterion 3 would move with the drop.
    const treatment = [0, 1].map((i) => liveFam(fk(100 + i), 'treatment', 10, 1));
    const withControl = (ws: typeof full): Inputs['live'] => ({ families: [...treatment, { key: fk(200), arm: 'control', windows: ws, changed: false, unrealised: false }] });
    const a = decide({ live: withControl(full) });
    const b = decide({ live: withControl(upTo) });
    expect(a.verdict).toBe('pass');
    expect(b).toEqual(a);
  });

  it('RP6 and W2-D83: quiz uptake, the uptake difference and the task-embedded scores change no verdict', () => {
    const one = { quiz_uptake: { treatment: fr(9, 10), control: fr(0, 10) }, uptake_difference: fr(9, 10), first_call: { treatment: fr(1, 2), control: fr(0, 1) },
      task_embedded: { accuracy: { treatment: fr(1, 1), control: fr(0, 1) }, fabrication: { treatment: fr(0, 1), control: fr(1, 1) } } };
    const two = { quiz_uptake: { treatment: fr(0, 10), control: fr(10, 10) }, uptake_difference: fr(-10, 10), first_call: { treatment: fr(0, 1), control: fr(1, 1) },
      task_embedded: { accuracy: { treatment: fr(0, 1), control: fr(1, 1) }, fabrication: { treatment: fr(1, 1), control: fr(0, 1) } } };
    const a = decide({ reportOnly: one });
    const b = decide({ reportOnly: two });
    const c = decide();
    expect(a.report_only, 'passed through').toEqual(one);
    expect(c.report_only).toBeNull();
    const { report_only: _a, ...ra } = a;
    const { report_only: _b, ...rb } = b;
    const { report_only: _c, ...rc } = c;
    expect(rb).toEqual(ra);
    expect(rc).toEqual(ra);
    // decideGate reads the report-only section in exactly one place: the line that passes it through.
    const start = GATE_SRC.indexOf('export function decideGate(');
    const body = GATE_SRC.slice(start, GATE_SRC.indexOf('\n}\n', start));
    expect(start).toBeGreaterThan(0);
    expect(body.split('reportOnly').length - 1).toBe(1);
  });

  it('W2-D89: an absent rate above absent_rate_max in either arm halts, and criterion 1 is not computed', () => {
    // Q = 100 (20 families of 5); `a` absent answers in the named arm, one per family from family 0.
    const absentQuiz = (arm: 'treatment' | 'control', a: number): Inputs['quiz'] =>
      quizOf(20, (i) => [...rep(3, () => q(R(), U())), q(U(), U()),
        i < a ? (arm === 'treatment' ? q(ans('uncertain', 'absent'), U()) : q(U(), ans('uncertain', 'absent'))) : q(U(), U())]);
    const at5 = decide({ quiz: absentQuiz('treatment', 5) });
    expect(eq(at5.counts.absent.treatment, fr(5, 100))).toBe(true);
    expect(at5.halts, 'exactly 5% is not above 5%').toEqual([]);
    expect(at5.verdict).toBe('pass');
    for (const arm of ['treatment', 'control'] as const) {
      const v = decide({ quiz: absentQuiz(arm, 6) });
      expect(v.halts, arm).toEqual(['absent-rate']);
      expect(v.verdict).toBe('halt');
      expect(v.criteria.accuracy, 'criterion 1 is not computed').toBeNull();
      expect(v.criteria.fabrication, 'criterion 2 still is').not.toBeNull();
      expect(v.criteria.uptake!.holds).toBe(true);
    }
  });

  it('W2-D89: more than run_failed_max of the questions run-failed halts, and criteria 1 and 2 are not computed', () => {
    // 100 frozen questions; `k` of them run-failed, one per family from family 0.
    const rfQuiz = (k: number): Inputs['quiz'] =>
      quizOf(20, (i) => [...rep(3, () => q(R(), U())), q(U(), U()), q(U(), U(), i < k)]);
    const at5 = decide({ quiz: rfQuiz(5) });
    expect(at5.counts).toMatchObject({ Q: 95, run_failed: 5 });
    expect(at5.halts, '5 of 100 frozen questions is not above 5%').toEqual([]);
    expect(at5.verdict).toBe('pass');
    const at6 = decide({ quiz: rfQuiz(6) });
    expect(at6.counts).toMatchObject({ Q: 94, run_failed: 6 });
    expect(at6.halts).toEqual(['run-failed']);
    expect(at6.verdict).toBe('halt');
    expect(at6.criteria.accuracy).toBeNull();
    expect(at6.criteria.fabrication).toBeNull();
    expect(at6.criteria.uptake!.holds, 'criterion 3 is still reported').toBe(true);
  });

  it('W2-D89: hand-check agreement below handcheck_agreement_min halts', () => {
    expect(decide({ handcheck: { agreement: { treatment: fr(8, 10), control: fr(4, 5) } } }).halts, 'exactly 0.8 is not below it').toEqual([]);
    expect(decide({ handcheck: { agreement: { treatment: null, control: null } } }).halts, 'no pair, nothing to disagree').toEqual([]);
    for (const agreement of [{ treatment: fr(7, 10), control: fr(9, 10) }, { treatment: fr(9, 10), control: fr(79, 100) }]) {
      const v = decide({ handcheck: { agreement } });
      expect(v.halts).toEqual(['handcheck-agreement']);
      expect(v.verdict).toBe('halt');
      expect(v.criteria.accuracy!.holds && v.criteria.fabrication!.holds && v.criteria.uptake!.holds, 'every criterion still computed').toBe(true);
    }
    // handcheckAgreement's answer feeds the halt directly.
    const pairs = Array.from({ length: 10 }, (_, i) => ({ arm: 'treatment' as const, judge: 'fabricated' as Lbl, operator: (i < 7 ? 'fabricated' : 'uncertain') as Lbl }));
    const g = gateT8.handcheckAgreement(pairs);
    expect(decide({ handcheck: { agreement: { treatment: g.treatment, control: g.control } } }).halts).toEqual(['handcheck-agreement']);
  });

  it('W2-D89: a judge-failed answer with no operator label holds the verdict incomplete', () => {
    const held = (label: Lbl | null): Inputs['quiz'] =>
      quizOf(20, (i) => [...rep(3, () => q(R(), U())), q(U(), U()), i === 0 ? q(ans(label, 'value', true), U()) : q(U(), U())]);
    const v = decide({ quiz: held(null) });
    expect(v.verdict).toBe('incomplete');
    expect(v.criteria.accuracy).toBeNull();
    expect(v.criteria.fabrication).toBeNull();
    expect(v.criteria.uptake!.holds).toBe(true);
    expect(decide({ quiz: held('uncertain') }).verdict, 'labelled by the operator, it decides').toBe('pass');
    // The hold is the verdict even beside a halt, which is still listed.
    const both = decide({ quiz: held(null), handcheck: { agreement: { treatment: fr(1, 2), control: null } } });
    expect(both.verdict).toBe('incomplete');
    expect(both.halts).toEqual(['handcheck-agreement']);
  });

  it('W2-D23: a changed treatment family stays in criterion 3 and leaves the comparison block', () => {
    const v = decide({ live: { families: [
      liveFam(fk(100), 'treatment', 10, 5, { changed: true }),
      liveFam(fk(101), 'treatment', 10, 1),
      liveFam(fk(200), 'control', 10, 0, { unrealised: true }),
      liveFam(fk(201), 'control', 10, 0),
    ] } });
    expect(eq(v.criteria.uptake!.point, fr(6, 20)), 'the changed family is in the denominator').toBe(true);
    expect(v.comparison.dropped).toEqual([fk(100), fk(200)].sort());
  });

  it('W2-D80: run-failed questions are absent from both arms', () => {
    // 21 frozen: 20 families of one question (treatment correct in 12, control in none), plus one run-failed question
    // whose labels would move both arms and whose judge failed: 1/21 is under 5%, so nothing halts.
    const families = quizOf(20, (i) => [i < 12 ? q(R(), U()) : q(U(), U())]).families
      .map((f, i) => (i === 0 ? { ...f, questions: [...f.questions, q(R(), ans(null, 'absent', true), true)] } : f));
    const v = decide({ quiz: { families } });
    expect(v.counts).toMatchObject({ Q: 20, run_failed: 1 });
    expect(eq(v.criteria.accuracy!.point_t, fr(12, 20))).toBe(true);
    expect(eq(v.counts.absent.control!, fr(0, 20))).toBe(true);
    expect(v.verdict, 'its missing label holds nothing').toBe('pass');
  });

  it('W2-D89: unmeasured windows and treatment families with no measured window are out of criterion 3', () => {
    const v = decide({ live: { families: [
      { ...liveFam(fk(100), 'treatment', 10, 5), windows: [...liveFam(fk(100), 'treatment', 10, 5).windows, win(true, 'unmeasured'), win(true, 'unmeasured')] },
      { ...liveFam(fk(101), 'treatment', 0, 0), windows: [win(true, 'unmeasured')] },
      liveFam(fk(102), 'treatment', 0, 0),
    ] } });
    expect(eq(v.criteria.uptake!.point, fr(5, 10))).toBe(true);
    expect(eq(v.criteria.uptake!.lower, fr(5, 10)), 'one cluster only').toBe(true);
  });

  it('W2-D89 and the coordinator ruling: a treatment set with no cluster left halts empty-arm, and no bootstrap runs on it', () => {
    // Criterion 3: no listed treatment family holds a measured window (one has none, one only an unmeasured one).
    const live = decide({ live: { families: [
      liveFam(fk(102), 'treatment', 0, 0),
      { ...liveFam(fk(103), 'treatment', 0, 0), windows: [win(true, 'unmeasured')] },
      liveFam(fk(200), 'control', 10, 0),
    ] } });
    expect(live.halts).toEqual(['empty-arm']);
    expect(live.verdict).toBe('halt');
    expect(live.criteria.uptake, 'criterion 3 is not computed').toBeNull();
    expect(live.criteria.accuracy!.holds && live.criteria.fabrication!.holds, 'criteria 1 and 2 still are').toBe(true);
    // Criterion 1: every frozen question run-failed leaves no paired cluster; the run-failed halt fires beside it.
    const quiz = decide({ quiz: quizOf(20, () => [q(R(), U(), true)]) });
    expect(quiz.halts).toEqual(['run-failed', 'empty-arm']);
    expect(quiz.verdict).toBe('halt');
    expect(quiz.criteria.accuracy).toBeNull();
    expect(quiz.criteria.uptake!.holds, 'criterion 3 is still reported').toBe(true);
  });

  it('W2-D89: the code-changed stamp is carried onto the verdict', () => {
    const v = decide({ codeChanged: true });
    expect(v.stamp).toBe('code-changed');
    expect(v.verdict).toBe('pass');
    expect(gateT8.GATE_REASONS).toContain('code-changed');
  });

  it('W2-D89: the halt words are HALT_WORDS, and decideGate refuses an input it has no rule for', () => {
    expect([...gateT8.HALT_WORDS].sort()).toEqual(['absent-rate', 'empty-arm', 'handcheck-agreement', 'run-failed']);
    expect(gateT8.HALT_DEFAULTS).toEqual({ handcheck_agreement_min: 0.8, run_failed_max: 0.05, absent_rate_max: 0.05 });
    // A question still not-run at gate time is refused, never thrown, counted, held or halted (W2-D89, amended
    // 2026-10-19): the refusal names the questions, so the operator runs or records them first.
    const notRun = quizOf(20, () => rep(5, () => q(R(), U())));
    (notRun.families[0]!.questions[0]!.treatment as { answerState: string }).answerState = 'not-run';
    (notRun.families[3]!.questions[2]!.control as { answerState: string }).answerState = 'not-run';
    const named = [notRun.families[0]!.questions[0]!.qid, notRun.families[3]!.questions[2]!.qid].sort();
    expect(gateT8.decideGate(base({ quiz: notRun })), 'question-not-run (W2-D89, amended)').toEqual({ ok: false, reason: 'question-not-run',
      detail: `decideGate: 2 question(s) still not-run: ${named.join(', ')}; run or record them first`, questions: named });
    expect(gateT8.GATE_REASONS).toContain('question-not-run');
    expect(() => decide({ quiz: quizOf(20, () => [q(ans('uncertain', 'skipped' as never), U())]) })).toThrow(/has answer state skipped/);
    expect(() => decide({ quiz: quizOf(20, () => [q(ans('correct', 'absent'), U())]) })).toThrow(/absent and labelled correct/);
    expect(() => decide({ quiz: quizOf(20, () => [q(ans(null), U())]) })).toThrow(/no label and is not judge-failed/);
    expect(() => decide({ halts: { ...gateT8.HALT_DEFAULTS, run_failed_max: 1e-7 } })).toThrow(/at most six places/);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest list test/measure-history.test.ts -t 'W2-3 Task 8' | grep -c 'W2-3 Task 8')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 8')
```

Expected: the list prints 32. The run is red, `32 failed` (measured at 31 against a stand-in for Tasks 2, 3 and 6 with this task's section absent; the empty-arm case added by the coordinator's ruling makes it 32, predicted): `TypeError: decideGate is not a function` (20), `classifyRun is not a function` (5), `questionOutcome is not a function` (2), `handcheckSample is not a function` (2), `applyHandcheck is not a function` (1), `handcheckAgreement is not a function` (1), and the halt-words case's `expected undefined to deeply equal { handcheck_agreement_min: 0.8, …(2) }`.

- [ ] **Step 4: Write the code.** Append at the END of `deploy/history-gate.mjs`, after Task 7's section:

```js
// ── W2-3 Task 8: failed runs, the hand-check and decideGate (W2-D80, W2-D81, W2-D89) ─────────────────────────────
// Every decision the W2 report makes, pure: W2-5b's `report` only gathers the inputs and calls decideGate (W2-D85).
//   classifyRun / questionOutcome (W2-D80): a model-level non-answer is an answer and is judged; an infrastructure
//     failure is re-run once, and a second one makes the question run-failed, excluded from both arms; a run the driver
//     never spawned, or cut off with a stop, is not-run and never consumes the re-run. The driver says which by
//     ctx.stopped; its stop words are its own (W2-D59) and this module never spells them, save code-changed and
//     code-unmeasured, which are GATE_REASONS words too.
//   handcheckSample / applyHandcheck / handcheckAgreement (W2-D81): a seeded ceil(n/5) of the judged answers per arm
//     from the 'handcheck' substream, plus every judge-failed item; the operator's label replaces the judge's on the
//     items the operator labelled; agreement is an exact fraction, per arm and over both.
//   decideGate (W2-D89) restates spec §10.2:2713-2718 with every operator exact (cross-multiplied fractions, never a
//     float): three criteria, their denominators, four halts and one hold. The fourth halt, empty-arm, is the
//     coordinator's W2-3 ruling: a treatment set with no cluster left halts, and is never bootstrapped. The changed
//     and assignment-unrealised drops (W2-D23) reach the comparison block only, never criterion 3. Report-only inputs
//     ride through untouched. A question still not-run at gate time is not a halt (W2-D89, amended 2026-10-19):
//     decideGate refuses with question-not-run, naming the questions, and the operator runs or records them first.

/** The `error` value Claude Code's stream-json carries on an assistant message whose credential the API refused.
 *  It is the stream format's word, not a driver word (W2-D80's "an authentication error"). */
const AUTH_FAILED = 'authentication_failed';

/** W2-D81's share of the judged answers per arm, 20%, as an exact fraction: ceil(n * 1/5) in integers. */
const HANDCHECK_SHARE = Object.freeze({ num: 1, den: 5 });

/** Criterion 1's floor on the treatment point accuracy, 0.40 (§10.2:2715), and criterion 2's margin, 3 points. */
const ACCURACY_MIN = frac(2, 5);
const FABRICATION_MARGIN = frac(3, 100);
const ZERO = frac(0, 1);

/** Part 1's `halts` defaults (decisions §4); the record's own `halts` is what W2-5b passes, which the operator signs. */
export const HALT_DEFAULTS = Object.freeze({ handcheck_agreement_min: 0.8, run_failed_max: 0.05, absent_rate_max: 0.05 });

const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObj = (v) => v !== null && typeof v === 'object';

/**
 * W2-D80: the class of one spawned arm run. A run the driver never spawned, or one a driver stop cut off, is 'not-run'
 * whatever else it shows. Otherwise an authentication error, or no `result` event at all (whatever the exit code,
 * which covers a non-zero exit with no result), is 'infra-failed'. Everything else is 'answered': max turns, permission
 * denials, empty text and a missing ANSWER line are the model's answers, and are judged.
 * @param {ReadonlyArray<unknown>} events the run's stream-json events, parsed, in order
 * @param {number|null} exitCode the process's exit code, null when a signal ended it
 * @param {{spawned: boolean, stopped: boolean}} ctx
 * @returns {'answered'|'infra-failed'|'not-run'}
 */
export function classifyRun(events, exitCode, ctx) {
  if (!Array.isArray(events)) throw new TypeError('classifyRun: events must be an array');
  if (exitCode !== null && !Number.isInteger(exitCode)) throw new TypeError('classifyRun: exitCode must be an integer or null');
  if (!isObj(ctx) || typeof ctx.spawned !== 'boolean' || typeof ctx.stopped !== 'boolean') {
    throw new TypeError('classifyRun: ctx.spawned and ctx.stopped must be booleans');
  }
  if (!ctx.spawned || ctx.stopped) return 'not-run';
  if (events.some((e) => isObj(e) && e.error === AUTH_FAILED)) return 'infra-failed';
  if (!events.some((e) => isObj(e) && e.type === 'result')) return 'infra-failed';
  return 'answered';
}

/**
 * W2-D80: a question's state from its attempts, in the order they ran. A not-run attempt is skipped: a stop never
 * consumes the re-run. The first answered attempt settles it; a first infra failure owes one re-run ('rerun'); a
 * second makes it 'run-failed'. No attempt but not-run ones leaves it 'not-run'.
 * @param {ReadonlyArray<'answered'|'infra-failed'|'not-run'>} attempts
 * @returns {'answered'|'rerun'|'run-failed'|'not-run'}
 */
export function questionOutcome(attempts) {
  if (!Array.isArray(attempts)) throw new TypeError('questionOutcome: attempts must be an array');
  let infra = 0;
  for (const a of attempts) {
    if (!RUN_CLASSES.includes(a)) throw new TypeError(`questionOutcome: ${String(a)} is not a run class`);
    if (a === 'not-run') continue;
    if (a === 'answered') return 'answered';
    infra += 1;
    if (infra === 2) return 'run-failed';
  }
  return infra === 1 ? 'rerun' : 'not-run';
}

/**
 * W2-D81: the hand-check sample. Per arm, in ASSIGNMENT_ARMS order, ceil(n/5) of that arm's judged items, drawn
 * without replacement from the seed's 'handcheck' substream over the items sorted by id (so input order never moves
 * it); then every judge-failed item, outside the 20%. `judged` (the judge returned a label) and `judgeFailed` (it
 * was malformed twice) are exclusive. Answers the sampled ids, sorted.
 * @param {string} seedHex the open record's bootstrap seed, 64 lowercase hex characters
 * @param {ReadonlyArray<{id: string, arm: 'treatment'|'control', judged: boolean, judgeFailed: boolean}>} items
 * @returns {string[]}
 */
export function handcheckSample(seedHex, items) {
  if (!Array.isArray(items)) throw new TypeError('handcheckSample: items must be an array');
  const seen = new Set();
  for (const i of items) {
    if (!isObj(i) || typeof i.id !== 'string' || i.id === '') throw new TypeError('handcheckSample: every item needs a non-empty string id');
    if (seen.has(i.id)) throw new TypeError(`handcheckSample: duplicate id ${i.id}`);
    seen.add(i.id);
    if (!ASSIGNMENT_ARMS.includes(i.arm)) throw new TypeError(`handcheckSample: ${i.id} has arm ${String(i.arm)}`);
    if (typeof i.judged !== 'boolean' || typeof i.judgeFailed !== 'boolean') throw new TypeError(`handcheckSample: ${i.id} needs boolean judged and judgeFailed`);
    if (i.judged && i.judgeFailed) throw new TypeError(`handcheckSample: ${i.id} is both judged and judge-failed`);
  }
  const rng = substream(seedHex, 'handcheck');
  const picked = [];
  for (const arm of ASSIGNMENT_ARMS) {
    const pool = items.filter((i) => i.arm === arm && i.judged).map((i) => i.id).sort(cmpId);
    const k = Math.floor((pool.length * HANDCHECK_SHARE.num + HANDCHECK_SHARE.den - 1) / HANDCHECK_SHARE.den);
    for (let s = 0; s < k; s += 1) {
      const j = s + randInt(rng, pool.length - s);
      [pool[s], pool[j]] = [pool[j], pool[s]];
      picked.push(pool[s]);
    }
  }
  for (const i of items) if (i.judgeFailed) picked.push(i.id);
  return picked.sort(cmpId);
}

/**
 * W2-D81: the labels the gate reads. The operator's label replaces the judge's on every item the operator labelled
 * (the sampled items, and every judge-failed item, which has no judge label); every other item keeps the judge's.
 * Neither the judge nor the operator decides `correct`: it is the string match alone (W2-D63, spec §10.2 Scoring), and the
 * hand-check only re-labels what the judge labels, stated uncertainty against fabrication (W2-D79's two words). A
 * judge or operator label of `correct` is refused. Neither input is changed.
 * @param {ReadonlyMap<string, 'correct'|'uncertain'|'fabricated'>} judgeLabels
 * @param {ReadonlyMap<string, 'correct'|'uncertain'|'fabricated'>} operatorLabels
 * @returns {Map<string, 'correct'|'uncertain'|'fabricated'>}
 */
export function applyHandcheck(judgeLabels, operatorLabels) {
  if (!(judgeLabels instanceof Map) || !(operatorLabels instanceof Map)) throw new TypeError('applyHandcheck: both label sets must be Maps');
  const out = new Map();
  for (const [id, l] of judgeLabels) {
    if (!LABELS.includes(l) || l === 'correct') throw new TypeError(`applyHandcheck: judge label ${String(l)} for ${id}`);
    out.set(id, l);
  }
  for (const [id, l] of operatorLabels) {
    if (l === 'correct' || !LABELS.includes(l)) throw new TypeError(`applyHandcheck: operator label ${String(l)} for ${id}`);
    out.set(id, l);
  }
  return out;
}

/**
 * W2-D81: hand-check agreement, the share of hand-checked items whose judge label equals the operator's, as an exact
 * fraction per arm and over both; null for a set with no pair. A judge-failed item has no judge label, so it is no pair.
 * @param {ReadonlyArray<{arm: 'treatment'|'control', judge: 'correct'|'uncertain'|'fabricated', operator: 'correct'|'uncertain'|'fabricated'}>} pairs
 * @returns {{treatment: {num: number, den: number}|null, control: {num: number, den: number}|null, all: {num: number, den: number}|null}}
 */
export function handcheckAgreement(pairs) {
  if (!Array.isArray(pairs)) throw new TypeError('handcheckAgreement: pairs must be an array');
  const tally = new Map(ASSIGNMENT_ARMS.map((a) => [a, { agree: 0, n: 0 }]));
  const all = { agree: 0, n: 0 };
  for (const p of pairs) {
    if (!isObj(p) || !tally.has(p.arm)) throw new TypeError(`handcheckAgreement: arm ${String(p?.arm)}`);
    if (!LABELS.includes(p.judge) || !LABELS.includes(p.operator)) throw new TypeError('handcheckAgreement: a label outside LABELS');
    const t = tally.get(p.arm);
    const same = p.judge === p.operator ? 1 : 0;
    t.n += 1; t.agree += same; all.n += 1; all.agree += same;
  }
  const f = (t) => (t.n === 0 ? null : frac(t.agree, t.n));
  return { treatment: f(tally.get('treatment')), control: f(tally.get('control')), all: f(all) };
}

/** A halt threshold read exactly: a decimal with at most six places, 0.05 read as 5/100. `below1` refuses 1, so a
 *  share of every question can always exceed it. */
function fracOfDecimal(x, name, below1) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1 || (below1 && x === 1)) {
    throw new TypeError(`decideGate: halts.${name} must be a number in [0, ${below1 ? '1)' : '1]'}`);
  }
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(x));
  if (m === null) throw new TypeError(`decideGate: halts.${name} must be a decimal of at most six places`);
  const places = m[2] ?? '';
  return frac(Number(m[1] + places), 10 ** places.length);
}

/** a + b over integers. */
const addFrac = (a, b) => frac(a.num * b.den + b.num * a.den, a.den * b.den);

/** A Frac or null, as handcheck agreement arrives. */
function fracOrNull(v, name) {
  if (v === null) return null;
  if (!isObj(v) || !Number.isSafeInteger(v.num) || !Number.isSafeInteger(v.den) || v.den <= 0) throw new TypeError(`decideGate: ${name} must be a fraction or null`);
  return v;
}

/**
 * W2-D89: the W2 gate. Pure: the same inputs give the same verdict, and nothing but the arguments is read.
 *
 * Denominators. Q = the frozen questions minus the run-failed ones, which are excluded from both arms. Each arm's
 * accuracy is correct/Q and its fabrication fabricated/Q, over the labels after the hand-check override; an unknown or
 * absent answer is in Q and never correct. Criterion 3 reads every measured window of every listed treatment family:
 * the caller has removed the registry drops; the changed and assignment-unrealised drops are NOT applied (they go to
 * the comparison block); unmeasured windows and families with no measured window are out (W2-D14, W2-D18).
 *
 * Criteria, exact: (1) treatment point accuracy >= 2/5 and the lower bound of the paired cluster bootstrap of
 * (treatment - control) > 0; (2) treatment fabrication <= control fabrication + 3/100; (3) the lower bound of the
 * within-arm cluster bootstrap of the treatment window share >= X.
 *
 * Halts (verdict 'halt', every computable criterion still reported): the absent rate above absent_rate_max in either
 * arm (criterion 1 not computed); run-failed questions above run_failed_max of the frozen questions (criteria 1 and 2
 * not computed); hand-check agreement below handcheck_agreement_min in either arm; and empty-arm (the coordinator's
 * ruling), when criterion 1's or criterion 3's treatment set has no cluster left: that criterion is not computed
 * (uptake null) and no bootstrap runs on the empty set. Hold: a judge-failed answer with no operator label gives
 * 'incomplete' (criteria 1 and 2 not computed), and the hold is reported before any halt. pass iff no halt or hold and
 * all three hold; fail iff no halt or hold and any fails. `codeChanged` is carried as the stamp.
 *
 * Refusal (W2-D89, amended 2026-10-19): an arm whose answerState is 'not-run' (its run is still not-run, W2-D80) is
 * never counted, held or halted. decideGate answers {ok: false, reason: 'question-not-run', detail, questions}, the
 * qids sorted, and computes no verdict; a verdict carries ok: true. Any other answer state outside ANSWER_STATES throws.
 *
 * @param {{
 *   seedHex: string, B?: number,
 *   halts: {handcheck_agreement_min: number, run_failed_max: number, absent_rate_max: number},
 *   codeChanged: boolean,
 *   quiz: {families: ReadonlyArray<{key: string, questions: ReadonlyArray<{qid: string, runFailed: boolean,
 *     treatment: {label: 'correct'|'uncertain'|'fabricated'|null, answerState: 'value'|'unknown'|'absent'|'not-run', judgeFailed: boolean},
 *     control: {label: 'correct'|'uncertain'|'fabricated'|null, answerState: 'value'|'unknown'|'absent'|'not-run', judgeFailed: boolean}}>}>},
 *   live: {families: ReadonlyArray<{key: string, arm: 'treatment'|'control', windows: ReadonlyArray<{state: 'measured'|'unmeasured', with_call: boolean}>, changed: boolean, unrealised: boolean}>},
 *   handcheck: {agreement: {treatment: {num: number, den: number}|null, control: {num: number, den: number}|null}},
 *   reportOnly?: unknown,
 * }} inputs
 * @returns {{
 *   verdict: 'pass'|'fail'|'halt'|'incomplete', stamp: 'code-changed'|null, halts: string[],
 *   criteria: {
 *     accuracy: {point_t: {num: number, den: number}, point_c: {num: number, den: number}, lower: {num: number, den: number}, holds: boolean}|null,
 *     fabrication: {t: {num: number, den: number}, c: {num: number, den: number}, holds: boolean}|null,
 *     uptake: {point: {num: number, den: number}, lower: {num: number, den: number}, holds: boolean}|null},
 *   counts: {Q: number, run_failed: number, absent: {treatment: {num: number, den: number}|null, control: {num: number, den: number}|null}},
 *   comparison: {dropped: string[]},
 *   report_only: unknown,
 *   ok: true,
 * } | {ok: false, reason: 'question-not-run', detail: string, questions: string[]}}
 */
export function decideGate(inputs) {
  if (!isObj(inputs)) throw new TypeError('decideGate: inputs must be an object');
  const { seedHex, codeChanged, quiz, live, handcheck } = inputs;
  const B = inputs.B ?? BOOTSTRAP.B;
  if (typeof codeChanged !== 'boolean') throw new TypeError('decideGate: codeChanged must be a boolean');
  const absentMax = fracOfDecimal(inputs.halts?.absent_rate_max, 'absent_rate_max', true);
  const runFailedMax = fracOfDecimal(inputs.halts?.run_failed_max, 'run_failed_max', true);
  const agreementMin = fracOfDecimal(inputs.halts?.handcheck_agreement_min, 'handcheck_agreement_min', false);

  // The quiz, tallied once. A run-failed question is skipped before either arm is read.
  const tally = Object.fromEntries(ASSIGNMENT_ARMS.map((a) => [a, { correct: 0, fabricated: 0, absent: 0 }]));
  const paired = [];
  let frozen = 0;
  let runFailed = 0;
  let held = false;
  const notRun = new Set();   // qids with an arm still not-run: refused below, never counted (W2-D89, amended)
  const keys = new Set();
  for (const fam of quiz?.families ?? []) {
    if (!isObj(fam) || typeof fam.key !== 'string' || keys.has(fam.key)) throw new TypeError(`decideGate: quiz family ${String(fam?.key)} is missing or repeated`);
    keys.add(fam.key);
    let t = 0;
    let c = 0;
    let n = 0;
    for (const q of fam.questions) {
      frozen += 1;
      if (typeof q.runFailed !== 'boolean') throw new TypeError(`decideGate: question ${String(q.qid)} needs a boolean runFailed`);
      if (q.runFailed) { runFailed += 1; continue; }   // W2-D80: excluded from both arms
      n += 1;
      for (const arm of ASSIGNMENT_ARMS) {
        const a = q[arm];
        if (isObj(a) && a.answerState === 'not-run') { notRun.add(String(q.qid)); continue; }   // refused below, never counted
        if (!isObj(a) || !ANSWER_STATES.includes(a.answerState)) {
          throw new TypeError(`decideGate: question ${String(q.qid)} (${arm}) has answer state ${String(a?.answerState)}`);
        }
        if (typeof a.judgeFailed !== 'boolean') throw new TypeError(`decideGate: question ${q.qid} (${arm}) needs a boolean judgeFailed`);
        if (a.answerState === 'absent') tally[arm].absent += 1;
        if (a.label === null) {
          if (!a.judgeFailed) throw new TypeError(`decideGate: question ${q.qid} (${arm}) has no label and is not judge-failed`);
          held = true;   // W2-D81: the verdict waits for the operator's label
          continue;
        }
        if (!LABELS.includes(a.label)) throw new TypeError(`decideGate: question ${q.qid} (${arm}) has label ${String(a.label)}`);
        if (a.label === 'correct' && a.answerState !== 'value') throw new TypeError(`decideGate: question ${q.qid} (${arm}) is ${a.answerState} and labelled correct (W2-D64)`);
        if (a.label === 'correct') tally[arm].correct += 1;
        if (a.label === 'fabricated') tally[arm].fabricated += 1;
      }
      if (q.treatment.label === 'correct') t += 1;
      if (q.control.label === 'correct') c += 1;
    }
    if (n > 0) paired.push({ t, c, n });   // a family whose every question is run-failed is no cluster
  }
  // W2-D89, amended 2026-10-19: a question still not-run at gate time is refused, naming the questions.
  if (notRun.size > 0) {
    const questions = [...notRun].sort(cmpId);
    return { ok: false, reason: 'question-not-run', questions,
      detail: `decideGate: ${questions.length} question(s) still not-run: ${questions.join(', ')}; run or record them first` };
  }
  if (frozen === 0) throw new TypeError('decideGate: the quiz has no frozen question');
  const Q = frozen - runFailed;
  const absent = {
    treatment: Q === 0 ? null : frac(tally.treatment.absent, Q),
    control: Q === 0 ? null : frac(tally.control.absent, Q),
  };

  // Halts, in this order. Each threshold is exceeded strictly; agreement falls strictly below its minimum.
  const halts = [];
  const absentHalt = Q > 0 && (cmpFrac(absent.treatment, absentMax) > 0 || cmpFrac(absent.control, absentMax) > 0);
  if (absentHalt) halts.push('absent-rate');
  const runFailedHalt = cmpFrac(frac(runFailed, frozen), runFailedMax) > 0;
  if (runFailedHalt) halts.push('run-failed');
  const agreement = [fracOrNull(handcheck?.agreement?.treatment ?? null, 'handcheck.agreement.treatment'),
    fracOrNull(handcheck?.agreement?.control ?? null, 'handcheck.agreement.control')];
  if (agreement.some((g) => g !== null && cmpFrac(g, agreementMin) < 0)) halts.push('handcheck-agreement');

  // Criterion 1: not computed under the absent-rate or run-failed halt, or the hold, or with no paired cluster.
  let accuracy = null;
  if (!held && !absentHalt && !runFailedHalt && paired.length > 0) {
    const pointT = frac(tally.treatment.correct, Q);
    const pointC = frac(tally.control.correct, Q);
    const boot = clusterBootstrap({ clusters: paired, B, rng: substream(seedHex, 'quiz-ci'), mode: 'paired' });
    accuracy = { point_t: pointT, point_c: pointC, lower: boot.lower,
      holds: cmpFrac(pointT, ACCURACY_MIN) >= 0 && cmpFrac(boot.lower, ZERO) > 0 };
  }
  // Criterion 2: not computed under the run-failed halt, or the hold.
  let fabrication = null;
  if (!held && !runFailedHalt && Q > 0) {
    const ft = frac(tally.treatment.fabricated, Q);
    const fc = frac(tally.control.fabricated, Q);
    fabrication = { t: ft, c: fc, holds: cmpFrac(ft, addFrac(fc, FABRICATION_MARGIN)) <= 0 };
  }

  // Criterion 3 and the comparison block.
  const shares = [];
  const dropped = [];
  const liveKeys = new Set();
  for (const f of live?.families ?? []) {
    if (!isObj(f) || typeof f.key !== 'string' || liveKeys.has(f.key)) throw new TypeError(`decideGate: live family ${String(f?.key)} is missing or repeated`);
    liveKeys.add(f.key);
    if (!ASSIGNMENT_ARMS.includes(f.arm)) throw new TypeError(`decideGate: live family ${f.key} has arm ${String(f.arm)}`);
    if (typeof f.changed !== 'boolean' || typeof f.unrealised !== 'boolean') throw new TypeError(`decideGate: live family ${f.key} needs boolean changed and unrealised`);
    if (f.changed || f.unrealised) dropped.push(f.key);   // W2-D23: the comparison block only
    if (f.arm !== 'treatment') continue;                 // criterion 3 reads the treatment arm alone
    let num = 0;
    let den = 0;
    for (const w of f.windows) {
      if (!isObj(w) || !WINDOW_STATES.includes(w.state) || typeof w.with_call !== 'boolean') throw new TypeError(`decideGate: live family ${f.key} has a malformed window`);
      if (w.state !== 'measured') continue;              // W2-D14: an unmeasured window is out of the denominator
      den += 1;
      if (w.with_call) num += 1;
    }
    if (den > 0) shares.push({ num, den });              // W2-D18: a family with no measured window is no cluster
  }
  let uptake = null;
  if (shares.length > 0) {
    const ub = clusterBootstrap({ clusters: shares, B, rng: substream(seedHex, 'live-ci'), mode: 'share' });
    uptake = { point: ub.point, lower: ub.lower, holds: cmpFrac(ub.lower, X) >= 0 };
  }
  // An empty arm (the coordinator's W2-3 ruling): criterion 1's or criterion 3's treatment set with no cluster left
  // halts, once, and neither empty set is ever bootstrapped.
  if (paired.length === 0 || shares.length === 0) halts.push('empty-arm');

  const allHold = accuracy !== null && accuracy.holds && fabrication !== null && fabrication.holds && uptake !== null && uptake.holds;
  const verdict = held ? 'incomplete' : halts.length > 0 ? 'halt' : allHold ? 'pass' : 'fail';
  return {
    verdict,
    stamp: codeChanged ? 'code-changed' : null,
    halts,
    criteria: { accuracy, fabrication, uptake },
    counts: { Q, run_failed: runFailed, absent },
    comparison: { dropped: dropped.sort(cmpId) },
    report_only: inputs.reportOnly ?? null,
    ok: true,
  };
}
```

Check: `grep -cE 'process\.|Date\.now|new Date|Math\.random|performance\.|require\(|import\(' deploy/history-gate.mjs` prints 0, and `grep -ciE 'haiku|sonnet' deploy/history-gate.mjs` prints 0.

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 8')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- `32 passed`, in about a second (measured at `31 passed` against the stand-in, and at `32 passed` on 2026-10-19 on a scratch tree of `7d01973a2` holding Tasks 2 to 9's gate sections exactly as this plan writes them, with Tasks 5, 8 and 9's describes in one scratch test file). Every `decideGate` call runs at most two bootstraps at B = 10,000 over at most 20 clusters, and none over an empty set.
- tsc prints nothing (measured against the stand-in, whose Task 3 and Task 6 exports carry no JSDoc; predicted against theirs). The test reaches `buildWindows` through `as never`, so Task 3's `FamilyReport` type need not match the inline report's literal types. A line naming only `agent/src/` or a module that is not installed comes from the worktree's install, not this task.

- [ ] **Step 6: Measure every guard red, then green.** From the repository root. One python driver applies each mutant to `deploy/history-gate.mjs` as one exact replacement (asserted to match once), runs its filter through vitest with an argv list (no shell), restores the file from the scratch copy in a `finally`, and prints one line per mutant. The body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-3/scratch"; mkdir -p "$SCRATCH"
cp deploy/history-gate.mjs "$SCRATCH/gate.orig"
python3 - "$SCRATCH/gate.orig" deploy/history-gate.mjs test/measure-history.test.ts <<'EOF'
import shutil, subprocess, sys
orig, gate, test = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(orig).read()
# (label, the -t filter it runs, the one exact text replaced, its replacement); each must go RED.
MUTANTS = [
    # classifyRun and questionOutcome (W2-D80)
    ('R1 a stop read as a failure', 'cut off by a driver stop',
     "  if (!ctx.spawned || ctx.stopped) return 'not-run';", "  if (!ctx.spawned) return 'not-run';"),
    ('R2 no authentication check', 'an authentication error is infra-failed',
     "  if (events.some((e) => isObj(e) && e.error === AUTH_FAILED)) return 'infra-failed';\n", ''),
    ('R3 max turns and denials read as infrastructure', 'model-level non-answers are answered',
     "  if (!events.some((e) => isObj(e) && e.type === 'result')) return 'infra-failed';",
     "  if (!events.some((e) => isObj(e) && e.type === 'result' && e.subtype === 'success' && !e.permission_denials)) return 'infra-failed';"),
    ('R4 no result read as an answer', 'no result event is infra-failed',
     "  if (!events.some((e) => isObj(e) && e.type === 'result')) return 'infra-failed';\n", ''),
    ('R5 a stop consumes the re-run', 'a stop never consumes the re-run',
     "    if (a === 'not-run') continue;", "    if (a === 'not-run') { infra += 1; if (infra === 2) return 'run-failed'; continue; }"),
    ('R6 a third failure to fail', 'a first infra failure owes a re-run',
     "    if (infra === 2) return 'run-failed';", "    if (infra === 3) return 'run-failed';"),
    # the hand-check (W2-D81)
    ('S1 floor, not ceil', 'every judge-failed item outside the 20%',
     "    const k = Math.floor((pool.length * HANDCHECK_SHARE.num + HANDCHECK_SHARE.den - 1) / HANDCHECK_SHARE.den);",
     "    const k = Math.floor((pool.length * HANDCHECK_SHARE.num) / HANDCHECK_SHARE.den);"),
    ('S2 judge-failed items left out', 'every judge-failed item outside the 20%',
     "  for (const i of items) if (i.judgeFailed) picked.push(i.id);\n", ''),
    ('S3 judge-failed items inside the 20%', 'every judge-failed item outside the 20%',
     "    const pool = items.filter((i) => i.arm === arm && i.judged).map((i) => i.id).sort(cmpId);",
     "    const pool = items.filter((i) => i.arm === arm && (i.judged || i.judgeFailed)).map((i) => i.id).sort(cmpId);"),
    ('S4 unjudged answers in the pool', 'every judge-failed item outside the 20%',
     "    const pool = items.filter((i) => i.arm === arm && i.judged).map((i) => i.id).sort(cmpId);",
     "    const pool = items.filter((i) => i.arm === arm && !i.judgeFailed).map((i) => i.id).sort(cmpId);"),
    ('S5 the pool in input order', 'independent of input order',
     "    const pool = items.filter((i) => i.arm === arm && i.judged).map((i) => i.id).sort(cmpId);",
     "    const pool = items.filter((i) => i.arm === arm && i.judged).map((i) => i.id);"),
    ('S6 the judge labels dropped', "the operator's label replaces",
     "  for (const [id, l] of judgeLabels) {", "  for (const [id, l] of new Map()) {"),
    ('S7 the judge may decide correct', "the operator's label replaces",
     "    if (!LABELS.includes(l) || l === 'correct') throw", "    if (!LABELS.includes(l)) throw"),
    ('S9 the operator may decide correct', "the operator's label replaces",
     "    if (l === 'correct' || !LABELS.includes(l)) throw", "    if (!LABELS.includes(l)) throw"),
    ('S8 one agreement for both arms', 'handcheckAgreement: exact per arm',
     "  return { treatment: f(tally.get('treatment')), control: f(tally.get('control')), all: f(all) };",
     "  return { treatment: f(all), control: f(tally.get('control')), all: f(all) };"),
    # the three criteria (W2-D89, RP6, W2-D18)
    ('C1 exactly 40% fails', 'exactly 40% passes',
     "      holds: cmpFrac(pointT, ACCURACY_MIN) >= 0 && cmpFrac(boot.lower, ZERO) > 0 };",
     "      holds: cmpFrac(pointT, ACCURACY_MIN) > 0 && cmpFrac(boot.lower, ZERO) > 0 };"),
    ('C2 a lower bound of 0 passes', 'a paired lower bound of exactly 0 fails',
     "      holds: cmpFrac(pointT, ACCURACY_MIN) >= 0 && cmpFrac(boot.lower, ZERO) > 0 };",
     "      holds: cmpFrac(pointT, ACCURACY_MIN) >= 0 && cmpFrac(boot.lower, ZERO) >= 0 };"),
    ('C3 no lower-bound conjunct', 'RP6: 45% with a CI lower bound',
     "      holds: cmpFrac(pointT, ACCURACY_MIN) >= 0 && cmpFrac(boot.lower, ZERO) > 0 };",
     "      holds: cmpFrac(pointT, ACCURACY_MIN) >= 0 };"),
    ('C4 no point floor', 'RP6: 38% with a lower bound above 0',
     "      holds: cmpFrac(pointT, ACCURACY_MIN) >= 0 && cmpFrac(boot.lower, ZERO) > 0 };",
     "      holds: cmpFrac(boot.lower, ZERO) > 0 };"),
    ('C5 exactly control + 3 fails', 'fabrication at exactly control',
     "holds: cmpFrac(ft, addFrac(fc, FABRICATION_MARGIN)) <= 0 };", "holds: cmpFrac(ft, addFrac(fc, FABRICATION_MARGIN)) < 0 };"),
    ('C6 a float comparison', 'fabrication at exactly control',
     "holds: cmpFrac(ft, addFrac(fc, FABRICATION_MARGIN)) <= 0 };", "holds: ft.num / ft.den <= fc.num / fc.den + 0.03 };"),
    ('C7 a 4-point margin', 'fabrication at control',
     "const FABRICATION_MARGIN = frac(3, 100);", "const FABRICATION_MARGIN = frac(4, 100);"),
    ('C8 exactly 10% fails', 'lower bound is exactly 10% passes',
     "holds: cmpFrac(ub.lower, X) >= 0 };", "holds: cmpFrac(ub.lower, X) > 0 };"),
    ('C9 treatment above control at 0 (rev 3 reading)', 'lower bound is 9.9% fails',
     "holds: cmpFrac(ub.lower, X) >= 0 };", "holds: cmpFrac(ub.lower, ZERO) > 0 };"),
    ('C10 control windows in criterion 3', 'first exit 8 changes no verdict',
     "    if (f.arm !== 'treatment') continue;                 // criterion 3 reads the treatment arm alone\n", ''),
    ('C11 a changed family dropped from criterion 3', 'a changed treatment family stays',
     "    if (f.arm !== 'treatment') continue; ", "    if (f.arm !== 'treatment' || f.changed) continue; "),
    ('C12 unmeasured windows counted', 'unmeasured windows and treatment families',
     "      if (w.state !== 'measured') continue;              // W2-D14: an unmeasured window is out of the denominator\n", ''),
    ('C13 a 0-window family as a cluster', 'unmeasured windows and treatment families',
     "    if (den > 0) shares.push({ num, den }); ", "    shares.push({ num, den: Math.max(den, 1) }); "),
    # halts, the hold, run-failed, the stamp, report-only, the not-run refusal, an unruled input (W2-D89, W2-D64, W2-D80, W2-D81, W2-D83)
    ('H1 an absent rate of exactly 5% halts', 'absent rate above absent_rate_max',
     "(cmpFrac(absent.treatment, absentMax) > 0 || cmpFrac(absent.control, absentMax) > 0)",
     "(cmpFrac(absent.treatment, absentMax) >= 0 || cmpFrac(absent.control, absentMax) >= 0)"),
    ('H2 the control arm\'s absent rate ignored', 'absent rate above absent_rate_max',
     "(cmpFrac(absent.treatment, absentMax) > 0 || cmpFrac(absent.control, absentMax) > 0)",
     "cmpFrac(absent.treatment, absentMax) > 0"),
    ('H3 the absent halt also drops criterion 2', 'absent rate above absent_rate_max',
     "  if (!held && !runFailedHalt && Q > 0) {\n    const ft", "  if (!held && !runFailedHalt && !absentHalt && Q > 0) {\n    const ft"),
    ('H4 criterion 1 computed under the absent halt', 'absent rate above absent_rate_max',
     "  if (!held && !absentHalt && !runFailedHalt && paired.length > 0) {", "  if (!held && !runFailedHalt && paired.length > 0) {"),
    ('H5 exactly 5% run-failed halts', 'more than run_failed_max',
     "  const runFailedHalt = cmpFrac(frac(runFailed, frozen), runFailedMax) > 0;",
     "  const runFailedHalt = cmpFrac(frac(runFailed, frozen), runFailedMax) >= 0;"),
    ('H6 the run-failed share over Q, not the frozen questions', 'more than run_failed_max',
     "  const runFailedHalt = cmpFrac(frac(runFailed, frozen), runFailedMax) > 0;",
     "  const runFailedHalt = cmpFrac(frac(runFailed, Q), runFailedMax) > 0;"),
    ('H7 criterion 2 computed under the run-failed halt', 'more than run_failed_max',
     "  if (!held && !runFailedHalt && Q > 0) {\n    const ft", "  if (!held && Q > 0) {\n    const ft"),
    ('H8 agreement of exactly 0.8 halts', 'below handcheck_agreement_min halts',
     "cmpFrac(g, agreementMin) < 0)) halts.push", "cmpFrac(g, agreementMin) <= 0)) halts.push"),
    ('H9 the control arm\'s agreement ignored', 'below handcheck_agreement_min halts',
     "    fracOrNull(handcheck?.agreement?.control ?? null, 'handcheck.agreement.control')];", "];"),
    ('H10 no hold', 'holds the verdict incomplete',
     "          held = true;   // W2-D81: the verdict waits for the operator's label\n", ''),
    ('H11 a halt hides the hold', 'holds the verdict incomplete',
     "  const verdict = held ? 'incomplete' : halts.length > 0 ? 'halt' : allHold ? 'pass' : 'fail';",
     "  const verdict = halts.length > 0 ? 'halt' : held ? 'incomplete' : allHold ? 'pass' : 'fail';"),
    ('H12 run-failed questions counted in the arms', 'run-failed questions are absent from both arms',
     "      if (q.runFailed) { runFailed += 1; continue; }", "      if (q.runFailed) { runFailed += 1; }"),
    ('H13 the stamp dropped', 'code-changed stamp is carried',
     "    stamp: codeChanged ? 'code-changed' : null,", "    stamp: null,"),
    ('H14 the verdict reads the report-only section', 'task-embedded scores change no verdict',
     "  const B = inputs.B ?? BOOTSTRAP.B;", "  const B = inputs.reportOnly === undefined ? (inputs.B ?? BOOTSTRAP.B) : 2000;"),
    ('H15 an unruled answer state read as a default', 'refuses an input it has no rule for',
     "        if (!isObj(a) || !ANSWER_STATES.includes(a.answerState)) {", "        if (!isObj(a)) {"),
    ('H19 a not-run arm read as a malformed input', 'refuses an input it has no rule for',
     "        if (isObj(a) && a.answerState === 'not-run') { notRun.add(String(q.qid)); continue; }   // refused below, never counted\n", ''),
    ('H20 a not-run question counted', 'refuses an input it has no rule for',
     "  if (notRun.size > 0) {", "  if (false) {"),
    # the empty arm (the coordinator's W2-3 ruling)
    ('H16 an empty treatment set bootstrapped', 'a treatment set with no cluster left halts empty-arm',
     "  if (shares.length > 0) {\n    const ub", "  {\n    const ub"),
    ('H17 an empty arm read as a fail', 'a treatment set with no cluster left halts empty-arm',
     "  if (paired.length === 0 || shares.length === 0) halts.push('empty-arm');\n", ''),
    ('H18 an empty quiz arm not halted', 'a treatment set with no cluster left halts empty-arm',
     "  if (paired.length === 0 || shares.length === 0) halts.push('empty-arm');",
     "  if (shares.length === 0) halts.push('empty-arm');"),
    # decideGate's answer is a union on ok (accepted as written, the coordinator's final W2-3/W2-4 plan review)
    ('H21 a verdict without ok', 'a passing input passes',
     "    report_only: inputs.reportOnly ?? null,\n    ok: true,\n", "    report_only: inputs.reportOnly ?? null,\n"),
]
red = 0
for label, filt, old, new in MUTANTS:
    assert src.count(old) == 1, (label, src.count(old))
    open(gate, 'w').write(src.replace(old, new))
    try:
        r = subprocess.run(['./node_modules/.bin/vitest', 'run', test, '-t', filt],
                           cwd='server', capture_output=True, text=True, timeout=600)
    finally:
        shutil.copyfile(orig, gate)
    tests = [l.strip() for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith('Tests ')]
    ok = r.returncode != 0 and tests and ' 1 failed' in tests[-1]
    red += bool(ok)
    print(('RED   ' if ok else 'NOT RED ') + label + ' | ' + (tests[-1] if tests else 'no summary'))
print(f'{red} of {len(MUTANTS)} red')
EOF
cmp "$SCRATCH/gate.orig" deploy/history-gate.mjs && rm "$SCRATCH/gate.orig"
```

Expected: 49 lines, each `RED   <label> | Tests  1 failed | … skipped (…)`, then `49 of 49 red` (predicted: 48 measured, plus H21, which the final plan review's acceptance of `decideGate`'s union adds), and `cmp` silent (measured, the first 42, against the stand-in; H16 to H18, added with the coordinator's empty-arm ruling, S9, added with the operator-label refusal, H4's re-anchored text, and H15's new red with H19 and H20, added with the question-not-run ruling, were then measured red, all 48, on 2026-10-19 on a scratch tree of `7d01973a2` holding Tasks 2 to 9's gate sections exactly as this plan writes them, with Tasks 5, 8 and 9's describes in one scratch test file, with the messages of H16 to H18 and S9 still predicted; the skipped count is this file's total less one on the real tree). The reds, by mutant:
- R1 `expected 'infra-failed' to be 'not-run'`; R2 and R4 `expected 'answered' to be 'infra-failed'`; R3 `expected 'infra-failed' to be 'answered'`; R5 `expected 'rerun' to be 'not-run'`; R6 `expected 'not-run' to be 'run-failed'`.
- S1 and S4 `ceil(11/5): expected 2 to be 3`; S2 `expected [ Array(5) ] to include 'treatment-f0'`; S3 `ceil(10/5): expected 3 to be 2`; S5 `input order: expected [ 'control-j007', …(19) ] to deeply equal [ 'control-j000', …(19) ]`; S6 `expected [ [ 'a', 'uncertain' ], …(1) ] to deeply equal [ [ 'a', 'uncertain' ], …(3) ]`; S7 `the judge never decides correct (W2-D63): expected [Function] to throw an error`; S9 (predicted) `the operator never decides correct either (W2-D63, W2-D79): expected [Function] to throw an error`; S8 `expected false to be true`.
- C1, C5, C6, C8 `expected false to be true` (each boundary now fails; C6 is the float reading of 7/200 against 1/200 + 3/100); C2, C3, C4, C7, C9 `expected true to be false`; C10 `expected { verdict: 'fail', … } to deeply equal { verdict: 'pass', … }` (control's dropped window moved criterion 3); C11 `the changed family is in the denominator: expected false to be true`; C12 and C13 `expected false to be true`.
- H1 `exactly 5% is not above 5%: expected [ 'absent-rate' ] to deeply equal []`; H2 `control: expected [] to deeply equal [ 'absent-rate' ]`; H3 `criterion 2 still is: expected null not to be null`; H4 `criterion 1 is not computed: expected { Object (point_t, point_c, ...) } to be null`; H5 and H6 `5 of 100 frozen questions is not above 5%: expected [ 'run-failed' ] to deeply equal []`; H7 `expected { t: { num: +0, den: 94 }, …(2) } to be null`; H8 `exactly 0.8 is not below it: expected [ 'handcheck-agreement' ] to deeply equal []`; H9 `expected [] to deeply equal [ 'handcheck-agreement' ]`; H10 `expected 'pass' to be 'incomplete'`; H11 `expected 'halt' to be 'incomplete'`; H12 `TypeError: Cannot read properties of null (reading 'point_t')` (the run-failed question's missing label now holds the verdict); H13 `expected null to be 'code-changed'`; H14 `expected 2 to be 1` (the source scan).
- Predicted: H16 `RangeError: clusterBootstrap: no cluster has a measured unit` (Task 6's refusal of an empty set); H17 `expected [] to deeply equal [ 'empty-arm' ]`; H18 `expected [ 'run-failed' ] to deeply equal [ 'run-failed', 'empty-arm' ]`.
- The question-not-run ruling (W2-D89, amended 2026-10-19), measured on the scratch tree: H15 `expected [Function] to throw an error` (the `skipped` state is read as a default); H19 `TypeError: decideGate: question q-… (treatment) has answer state not-run` (the not-run arm falls to the malformed-input throw instead of the refusal); H20 `question-not-run (W2-D89, amended): expected { verdict: 'pass', stamp: null, …(6) } to deeply equal { ok: false, …(3) }` (the not-run question is counted and a verdict is computed). C10's message on that tree reads `expected { verdict: 'fail', stamp: null, …(6) } to deeply equal { verdict: 'pass', stamp: null, …(6) }`, the verdict now carrying `ok`.
- Predicted: H21 `a verdict, not a refusal: expected undefined to be true` (a verdict without `ok` is no longer told from the refusal by its tag).

A `NOT RED` line is a guard its pin does not hold: fix the pin, never the mutant. Then run Step 5's commands once more: green.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
```

Expected: green. `measure-history.test.ts` as a whole: Tasks 1 to 7's cases and this task's 32 (predicted). `single-definition.test.ts`, unedited: O14's declaration scan finds no lib-exported name declared in `deploy/history-gate.mjs` (this section's ten module-private names and seven exports collide with none, measured against `lib.mjs` at `7d01973a2`), and the class-enumeration scan does not count the gate, which spells neither class word.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-gate.mjs server/test/measure-history.test.ts
git commit -m "feat(history): the W2 gate's run classes, hand-check and decideGate (W2-3 Task 8)"
```

### Task 9: The counter definitions, the open record and its validator

The open record is what W2 pre-registers (spec §10.2:2723): part 1, the **draft**, signed before the pilot, and part 2, the **final**, signed before the window, then superseded only by appended amendments (decisions §4). Every `--record` consumer in W2-5a and W2-5b validates the record before it computes or spawns anything, so this task gives the gate five things, all pure:
- **`COUNTERS_DEF_V1`**: the frozen text of the five spec counters and of re-discovery, as W2-D87 and W2-D86 word them, and its sha constant. Part 1 signs the sha (`counters_def`), and W2-6 imports the constant.
- **`OPEN_RECORD_V1`**: the field schema of both parts, row by row from decisions §4's two tables, with `pilot.families` (W2-D76, the field half of D-5781) and `amendments` (W2-D90). `open --template` (W2-5a) derives its skeleton from it. The repo holds no template file (W2-D25).
- **`checkGateCode`**: W2-D24's comparison of `gate_code.files` with measured shas, file by file over `GATE_CODE_FILES`. A sha absent on either side is `code-unmeasured`, never `code-changed` (W2-D24 and W2-D56, amended 2026-10-19). The shas are data: W2-4's `codeShas()` measures them, and this module reads no file.
- **`recordSha256`**: a record's sha256, the one `--record-sha256` names and a successor's `supersedes` carries: the sha256 of the record's canonical JSON and one newline.
- **`validateOpenRecord`**: one refusal per W2-D25 bullet and W2-D90's rule, each a `GATE_REASONS` word at a path. It also has the three model patterns the validator enforces (`EXACT_MODEL_ID_RE`, `ARM_MODEL_FORBIDDEN_RE`, `OPUS_MODEL_RE`). By W2-D25's 2026-10-19 amendment it is closed (`field-unknown`), chained (`supersedes` against `recordSha256` of the superseded record, `chain-mismatch`), recomputes each amendment's `detail_sha256` (`amendment-detail-mismatch`), refuses a null or missing context instead of narrowing its checks, and reads a step 0a entry in W2-4's producer shape, with `writer_init` and `judge_init` non-null in part 1. By the coordinator's final W2-3/W2-4 plan review (2026-10-19, W2-D25 amended again) it binds each part 1 step 0a entry to a named node, refusing a `store_id` that names none (`value-outside-set`), and to part 1's `settings_mode`, refusing an entry recorded under another (`value-outside-set`), and refuses a flag step 0a measured rejected (`flag-rejected`), with no exception.

`refuse` throws on a word outside `GATE_REASONS`, so a word this task invents fails the suite instead of becoming a second vocabulary (W2-D12).

**Files:**
- Modify: `deploy/history-gate.mjs`. Append one section at the END of the file, after Task 8's section. Every name the section reads is declared above it (Tasks 2, 4, 6, 7 and 8) or imported by Task 2's import block (`canonicalJson`, `sha256Hex`). The file's import block is NOT edited.
- Modify: `server/test/measure-history.test.ts`. Append one describe at the END of the file, `'W2-3 Task 9: the counter definitions and the open record'`. It opens with its own two import declarations, `gate9` and `cj9`/`sha9`. Import declarations are hoisted, so they are legal at the end of a module, and their aliases cannot collide with the names earlier tasks import. It also reuses the file's existing `readFileSync`, `path` and `ROOT` (base `:9-18`).
- Not edited: `deploy/measure-history.py`, `ccd/**`, `shared/**`, the spec, README.md, `server/test/single-definition.test.ts` (only re-run).

**Interfaces:**
- Consumes (Task 2, frozen once in `deploy/history-gate.mjs`): `K`, `K_UNIT`, `X`, `METRIC_TEXT`, `ROW_CAP`, `BOOTSTRAP` (`{B, ci, method, percentile, statistic, prng}`), `SUBSTREAMS`, `FACT_KINDS`, `RUBRIC_IDS` (`['v1','v1-strict']`), `WRITER_INPUTS` (`['excerpt','leaf-span']`), `SHA_MIN_PREFIXES` (`[7, 40]`), `AMENDMENT_KINDS` (`['version-move','freeze-exception','forced-act']`), `GATE_CODE_FILES` (the four paths of W2-D24), `GATE_REASONS`, `familyKey(storeId, ccrcId, generation)`.
- Consumes (Task 4): `ACTIVE_LOOKBACK_MS`. (Task 6): `armOf(seedHex, f)`, `assignArms(seedHex, families)`, `assignmentSha256(list)`, `Q18_DEFAULTS`. (Task 7): `LABELLER`, `ANSWER_PROTOCOL`, `ANSWER_PROTOCOL_SHA256`, `WRITER_PROMPT`, `WRITER_PROMPT_SHA256`, `RUBRICS`, `RUBRIC_SHA256`. (Task 8): `HALT_DEFAULTS`. (lib, through Task 2's import block): `canonicalJson`, `sha256Hex`.
- Consumes, the `GATE_REASONS` words this task refuses with. Task 2 declares them, and this task declares none:
  - `code-changed` and `code-unmeasured` (Task 5 uses both too; `checkGateCode` answers them), `field-missing`, `field-unknown`, `field-malformed`, `constant-mismatch`, `value-outside-set`;
  - `model-alias`, `model-forbidden`, `signed-text-mismatch`, `release-mismatch`, `flag-rejected`, `seed-changed`, `pilot-drift`;
  - `quiz-mismatch`, `quiz-holds-control`, `pilot-quiz-overlap`, `window-length`, `assignment-mismatch`;
  - `draft-mismatch`, `chain-mismatch`, `post-start-change`, `amendment-kind`, `amendment-detail-mismatch`, `version-move-unpiloted`.
- Produces (all in `deploy/history-gate.mjs`, JSDoc-typed, no `.d.mts`):
  - `COUNTERS_DEF_V1: ReadonlyArray<{name: 'compliance'|'echo_hits'|'lag'|'card_served'|'card_id_mismatch'|'rediscovery', text: string}>`, deep-frozen, in that order;
  - `COUNTERS_DEF_V1_SHA256: string` = `sha256Hex(canonicalJson(COUNTERS_DEF_V1))`;
  - `OPEN_RECORD_KIND = 'ccrc-history-w2-open-record'`;
  - `OPEN_RECORD_V1: {version: 1, draft: FieldSpec, final: FieldSpec}`. Here `FieldSpec = Readonly<Record<string, Field>>` and `Field = {type: 'string'|'integer'|'number'|'boolean'|'hex64'|'object'|'array', nullable: boolean, status: 'fixed'|'default'|'operator'|'measured'|'derived', value?, fields?: FieldSpec, items?: Field, values?: Field}`. A `fixed` or `default` field carries its `value`, which is what `open --template` prints. An `object` with `fields` is closed (a key outside them is `field-unknown`); one with `values` is a map whose every value is that field (step 0a's `flags_accepted`); one with neither is a producer's measured output (W2-4's, W2-5a's), checked for its type only;
  - `EXACT_MODEL_ID_RE = /^claude-[a-z]+(?:-[a-z]+)*(?:-[0-9]+)+$/`, `ARM_MODEL_FORBIDDEN_RE = /fable/i`, `OPUS_MODEL_RE = /^claude-opus-/`;
  - `checkGateCode(gateCode: {release_tag: string, files: Record<string, string>}, shas: Record<string, string>): {ok: true} | {ok: false, word: 'code-unmeasured', unmeasured: string[]} | {ok: false, word: 'code-changed', mismatched: string[]}`. A file whose sha is absent on either side is unmeasured, and any unmeasured file is answered first, so `allowCodeChange` can never stamp a set that holds one (W2-D24, amended 2026-10-19). Both lists are in `GATE_CODE_FILES` order;
  - `recordSha256(record: object): string` = `sha256Hex(canonicalJson(record) + '\n')`, the sha `--record-sha256` names and a successor's `supersedes` carries;
  - `validateOpenRecord(record: object, ctx: {draft: object|null, predecessor: object|null, frozen: {families: FamilyRef[], n_questions: number}|null}): {ok: true} | {ok: false, errors: Array<{path: string, word: string}>}`. `ctx` is required, and so is each key (W2-D25, amended 2026-10-19): a null or missing `ctx` is `field-missing` at `ctx`. `path` is dotted, with `[i]` for an array item (`step0a[1].code_shas`, `quiz.families[3]`, `amendments[0].kind`), and a context path starts `ctx.`.
  - Module-local, prefixed so no earlier task's local can collide: `RECORD_DAY_MS`, `RECORD_HEX64_RE`, `recField`, `recFields`, `REC_FAMILY_REF`, `REC_CODE_SHAS`, `REC_LABELLER`, `REC_FREEZE_SURFACE`, `REC_DRAFT`, `REC_FINAL`, `REC_TYPE_OK`, `recRefusals`, `recShapeErrors`, `recFieldErrors`, `recSame`, `recRefOf`, `recKeyOf`, `recWithout`, `recPartOneView`, `REC_AMEND_FREE`, `recValidate`.
- Read by: W2-5a (`open --draft|--finalize|--template`, and every `--record` consumer it wires), W2-5b (`open --amend`, `report` and its consumers), W2-6 (`COUNTERS_DEF_V1`). W2-4's `codeShas()` supplies `checkGateCode`'s second argument.

**Spec:** §10.2 "Pre-registration" (:2723), §10.2:2683 (headless-on during the pilot), §10.2:2729-2730 (the counters). The errata are not this PR's: E21 and E23 are amended by W2-5b, and E25 by W2-6 (decisions §6). Departure defined here: D-5781 (`history-w2-pilot-families-in-marker`; this PR ships its field, `pilot.families`, and the validator's pilot/quiz disjointness). Cited: D-5773 (`active_rule.legacy_excluded` fixed `true`), D-5776 (the answer protocol's signed sha), D-5777 (`sha_min_prefix` 40 voids it), D-5778 (the signed rubric ids), D-5779 (`writer_input`).

**Choices this task makes:**
- **Part 2 carries part 1 whole.** A final holds every part 1 field unchanged, plus decisions §4's second table, so that a `--record <final>` consumer reads one file and finds its seed, models, nodes and `gate_code` there. Both tables name a `quiz` field, so the final's `quiz` is the draft's quiz plan with the frozen list's four fields (`sha256`, `n_questions`, `n_families`, `families`) added. Every part 1 field of the final must equal its draft's (`ctx.draft`, always supplied for a final; `draft-mismatch`). The exceptions are `part` and `supersedes`, which differ by definition, and `bootstrap`, whose seed has its own word. The coordinator kept this superset reading at plan review (2026-10-19). The `q18`, `pilot_result` and `freezes` sub-field keys named below are still this plan's naming (the header's P3).
- **The shape is checked first, and alone.** A missing field is `field-missing` and a field of the wrong type is `field-malformed`, each at its path. When any is found, the validator answers with those errors only, because every rule after it reads a well-shaped record. The validator is closed (W2-D25, amended 2026-10-19): a field outside the schema is `field-unknown` at its path, wherever the schema names an object's fields (the record, each sub-object, each step 0a entry, each amendment), so a draft carrying a part 2 field is refused too. An object with no `fields` (a producer's measured output, such as `writer_init` or `q18.n_f`, or an amendment's `detail`) stays open and is checked for its type only; `flags_accepted` is checked value by value (`values`). A null where the schema allows none is `field-missing`, as a missing key is, because it carries no value: so a part 1 step 0a entry's null `writer_init` or `judge_init` is `field-missing` (W2-D25, amended).
- **The context is required, never a narrower check** (W2-D25, amended 2026-10-19). `ctx` is an object holding the keys `draft`, `predecessor` and `frozen`. A null or missing `ctx` is `field-missing` at `ctx`, a missing key is `field-missing` at `ctx.<key>`, and a key that is neither null nor an object is `field-malformed`; the validator then answers those errors alone. A final needs `ctx.draft` (the part 1 it finalizes) and `ctx.frozen` (`{families, n_questions}`, the frozen quiz list), and a draft whose `supersedes` is not null needs `ctx.predecessor`; each one missing is `field-missing` at its path, and the record's other checks are not run. `open --finalize` and `open --amend` hold all three; every other `--record <final>` consumer in W2-5a and W2-5b must load the draft and the frozen list as well. The word is `field-missing`, the one W2-D25 gives an absent input, with the path naming the context's key.
- **The chain is checked by sha** (W2-D25, amended 2026-10-19: chained). A record's `supersedes` must equal `recordSha256` of the record it supersedes: a superseding draft's predecessor, an amended final's predecessor, or, for a first final, its draft (`open --finalize` supplies it); `chain-mismatch` otherwise. A first draft's `supersedes` is null, and a predecessor supplied beside it is `chain-mismatch`. `recordSha256` is the sha256 of the record's canonical JSON and one newline, the bytes `open` prints (W2-D25) and the form W2-4 writes step 0a's output in, so W2-5a's `open` must print exactly those bytes and print their sha. The predecessor itself must be of the right part and valid, and it is validated with its own link taken as checked: that link was checked when the predecessor was published, so a chain of amendments is validated one link at a time. A word is listed once per path, so a link that fails two ways is one `chain-mismatch`.
- **One word per remedy, with the path naming the field.** Examples: `model-forbidden` for both a Fable arm and a non-Opus writer or judge (the path names the role); `value-outside-set` for `sha_min_prefix`, `rubric_id`, `quiz.writer_input`, `counters_def.id`, a step 0a entry's `store_id` outside part 1's nodes and a step 0a entry's `settings_mode` other than part 1's; `constant-mismatch` for every fixed field, `legacy_excluded` included. A recorded release stamp is `release-mismatch`, kept apart from the code shas' `code-changed`: W2-D56 gives the two different remedies (`tree-moved` against `code-changed`).
- **An unmeasured code sha is `code-unmeasured`, never `code-changed`** (W2-D24 and W2-D56, amended 2026-10-19). `checkGateCode` answers it for a file whose sha is absent on either side, before any mismatch. Inside `validateOpenRecord` it cannot arise: the shape check runs first, and `REC_CODE_SHAS` requires all four files as `hex64` in `gate_code.files` and in each `code_shas`, so an absent sha there is `field-missing` and the comparison after it answers `code-changed` or nothing. The validator therefore keeps the word `code-changed` at `<path>.code_shas`.
- **Fixed means every fixed row.** The validator enforces the bullet's K, X, B, k_unit, row_cap and labeller fields. It also enforces the other rows decisions §4 marks fixed: `kind`, `version`, `metric`, the bootstrap's `ci`, `method`, `percentile`, `statistic`, `prng` and `substreams`, and `quiz.kinds` ("Fixed marks a module constant that the validator enforces").
- **An exact id has a shape:** `claude-`, lower-case words, then numeric segments. `opus`, `claude-opus`, `claude-opus-latest`, a `[1m]` suffix, a provider prefix and a dotted version are all alias-shaped. A later id form the shape refuses is a module change, and W2-D6's build freeze makes that a re-pilot.
- **A version move's re-pilot sha is `detail.repilot_sha256`** (64 lowercase hex). After window start, appended means that the predecessor's `amendments` is a prefix of the new list. Every amendment's `detail_sha256` is recomputed as `sha256Hex(canonicalJson(detail))` and refused `amendment-detail-mismatch` when it differs (W2-D25, amended 2026-10-19). `detail` is a required object, so the sha is always recomputed; W2-5b's `open --amend` writes it the same way.
- **The step 0a entry is W2-4's producer shape** (W2-D25, amended 2026-10-19), field for field: W2-4 Task 8's fifteen `Step0aOutput` keys, `kind, v, measured_ms, account, settings_mode, claude_code_version, wrapper_sha256, flags_accepted, writer_init, judge_init, box_init, code_shas, release_stamp, budget, spend`, with `flags_accepted` a map from flag to boolean (`Record<string, boolean>`, not one boolean), `wrapper_sha256` and `box_init` nullable, and `code_shas` over exactly `GATE_CODE_FILES` (W2-4's `CODE_SHA_FILES`, the same four paths). Beside them are `label` and `store_id`, which step 0a cannot measure (it opens no store) and `open --draft` adds when it binds each output to its node. `writer_init` and `judge_init` must be non-null in part 1, because the writer and the judge are probed before part 1: a null is `field-missing`. `kind` and `v` are checked for their type only: the gate does not spell W2-4's `STEP0A_KIND` a second time, and W2-4's `loadStep0a` has checked both before `open --draft` copies the output. The `q18` and `pilot_result` sub-fields are named here (`headline`, `at_power_80`, `at_rho_0`, `rho_hat`, …; `fidelity`, `step0b_sha256`, …), because W2-5a and W2-5b write them (the header's P3). A rename there is a schema change in this module.
- **Each step 0a output is bound to a named node** (W2-D25, amended at the coordinator's final W2-3/W2-4 plan review, 2026-10-19). A part 1 step 0a entry whose `store_id` is not the `store_id` of one of part 1's `nodes` is `value-outside-set` at `step0a[i].store_id`. The node set is read from the record's own `nodes`, never from a list in this module. The label is not compared: the ruling binds by `store_id`, and a node's label is operator text.
- **Each step 0a output is bound to part 1's settings mode, and a rejected flag is refused** (W2-D25, amended at the same review; the coordinator's settings-mode ruling, 2026-10-19). A part 1 step 0a entry whose `settings_mode` differs from part 1's top-level `settings_mode` is `value-outside-set` at `step0a[i].settings_mode`. Only part 1's `settings_mode` binds step 0a: a switch recorded in part 2's `pilot_result.settings_mode` is a later record, not an excuse, and this check never reads it. A `false` in a part 1 step 0a entry's `flags_accepted` is `flag-rejected` at `step0a[i].flags_accepted.<flag>`, for any flag, under either settings mode, with no exception. The ruling withdrew the earlier exception for `--restricted` under spec §10.2's fallback settings mode (`--setting-sources` without user, plus `disableAllHooks`): in that mode step 0a writes no `--restricted` key (W2-4 Task 8), so refusing every `false` loses nothing. A final carries part 1 whole, so the rule reads its step 0a and `settings_mode` the same way. The check compares the two `settings_mode` values and spells no settings-mode word, so the gate holds no `'fallback'` literal: it imports nothing from the driver (the driver imports the gate), and W2-4's `SETTINGS_MODES` stays the one list of those words.
- **Before window start, a final may be superseded wholesale** (decisions §4 step 5), keeping its seed and the window-length rule. W2-D90's append-only rule applies from `finalized_ms >= predecessor.window.start_ms`, the boundary instant included.

- [ ] **Step 1: Confirm the earlier tasks' names before using them.** From the repository root:

```bash
node --input-type=module -e "
const g = await import('./deploy/history-gate.mjs');
const need = ['K','K_UNIT','X','METRIC_TEXT','ROW_CAP','BOOTSTRAP','SUBSTREAMS','FACT_KINDS','RUBRIC_IDS','WRITER_INPUTS','SHA_MIN_PREFIXES',
  'AMENDMENT_KINDS','GATE_CODE_FILES','GATE_REASONS','familyKey','ACTIVE_LOOKBACK_MS','armOf','assignArms','assignmentSha256','Q18_DEFAULTS',
  'LABELLER','ANSWER_PROTOCOL','ANSWER_PROTOCOL_SHA256','WRITER_PROMPT','WRITER_PROMPT_SHA256','RUBRICS','RUBRIC_SHA256','HALT_DEFAULTS'];
console.log('missing:', need.filter((n) => g[n] === undefined).join(',') || 'none');
const words = ['code-changed','code-unmeasured','field-missing','field-unknown','field-malformed','constant-mismatch','value-outside-set','model-alias','model-forbidden',
  'signed-text-mismatch','release-mismatch','flag-rejected','seed-changed','pilot-drift','quiz-mismatch','quiz-holds-control','pilot-quiz-overlap',
  'window-length','assignment-mismatch','draft-mismatch','chain-mismatch','post-start-change','amendment-kind','amendment-detail-mismatch',
  'version-move-unpiloted'];
console.log('words missing:', words.filter((w) => !g.GATE_REASONS.includes(w)).join(',') || 'none');
console.log(JSON.stringify([g.RUBRIC_IDS, g.WRITER_INPUTS, g.SHA_MIN_PREFIXES, g.AMENDMENT_KINDS, g.GATE_CODE_FILES.length, Object.keys(g.BOOTSTRAP), Object.keys(g.LABELLER)]));
console.log(['validateOpenRecord','checkGateCode','recordSha256','COUNTERS_DEF_V1','OPEN_RECORD_V1'].filter((n) => g[n] !== undefined).join(',') || 'none declared yet');
"
grep -cE '^(export )?(const|function|let) (RECORD_DAY_MS|RECORD_HEX64_RE|recField|recFields|REC_[A-Z_]+|recRefusals|recShapeErrors|recFieldErrors|recSame|recRefOf|recKeyOf|recWithout|recPartOneView|recValidate|recordSha256)\b' deploy/history-gate.mjs
```

Expected, in order:
- `missing: none`;
- `words missing: none`;
- `[["v1","v1-strict"],["excerpt","leaf-span"],[7,40],["version-move","freeze-exception","forced-act"],4,["B","ci","method","percentile","statistic","prng"],["sha_admit_prefix","path_min","window","path_forms","boundaries"]]`;
- `none declared yet`;
- `0` from the grep.

A name missing, a word missing or a different value is a gap in an earlier task. Stop and report it to the coordinator, and never declare it here. Each of those names has exactly one definer, the task that ships it (W2-D12). In particular, the 25 words (predicted: 21 measured, plus `field-unknown` and `amendment-detail-mismatch` from W2-D25's 2026-10-19 amendment, `code-unmeasured` from W2-D24's, and `flag-rejected` from W2-D25's amendment at the final plan review) belong to Task 2's `GATE_REASONS`.

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/measure-history.test.ts`:

```ts
// ── W2-3 Task 9: the counter definitions and the open record (W2-D87, W2-D25, W2-D24, W2-D90; D-5781) ──────────
// Pure: every input is a parameter, the seed included (W2-D19: no function reads a seed from anywhere else). The
// records are synthetic stand-ins: store ids, ccrc ids, generations, model ids and release tags are made up here,
// and every sha- or seed-shaped value is assembled at runtime by hashing a label, so no key-shaped literal is
// committed. Import declarations are hoisted, so this block's own imports may sit at the end of the file.
import * as gate9 from '../../deploy/history-gate.mjs';
import { canonicalJson as cj9, sha256Hex as sha9 } from '../../ccd/history/lib.mjs';

describe('W2-3 Task 9: the counter definitions and the open record', () => {
  type Ref = { store_id: string; ccrc_id: string; generation: string };
  type Rec = Record<string, any>;
  type Err = { path: string; word: string };
  type Spec = { type: string; status: string; value?: unknown; fields?: Record<string, Spec>; items?: Spec };
  const DAY = 86_400_000;
  const T0 = 1_800_000_000_000;
  /** A sha- or seed-shaped value, assembled at runtime from a label. */
  const hex = (label: string): string => sha9(`w2-3 task 9 fixture: ${label}`);
  const SEED = hex('seed');
  const STORE_A = '00000000-0000-4000-8000-0000000000a1';
  const STORE_B = '00000000-0000-4000-8000-0000000000b2';
  const gen = (n: number): string => `0189abcd-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const OPUS = 'claude-opus-9-1';
  const ARM = 'claude-arm-9-1';
  const TAG = 'v0.0.900';
  const CODE: Record<string, string> = Object.fromEntries(gate9.GATE_CODE_FILES.map((f: string) => [f, hex(`code ${f}`)]));
  const refOf = (f: Ref): Ref => ({ store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation });
  const armOf = (f: Ref): string => gate9.armOf(SEED, f);
  /** An amendment whose detail_sha256 is its detail's sha256, which the validator recomputes (W2-D25, amended). */
  const amendment = (kind: string, node: string | null, at: number, detail: Rec): Rec =>
    ({ kind, node_label_ref: node, at_ms: at, detail_sha256: sha9(cj9(detail)), detail });

  /** One (store, id) whose two generations draw opposite arms under SEED: found by search, so the fixture holds
   *  for whatever bit the seed gives. */
  const SPLIT = ((): { treated: Ref; controlled: Ref } => {
    let treated: Ref | null = null;
    let controlled: Ref | null = null;
    for (let n = 200; treated === null || controlled === null; n += 1) {
      const f = { store_id: STORE_A, ccrc_id: 'sess-split', generation: gen(n) };
      if (armOf(f) === 'treatment') treated ??= f;
      else controlled ??= f;
    }
    return { treated, controlled };
  })();
  const FAMILIES: Ref[] = [
    ...[...Array(10)].map((_, i) => ({ store_id: i % 2 === 0 ? STORE_A : STORE_B, ccrc_id: `sess-${i}`, generation: gen(i) })),
    SPLIT.treated, SPLIT.controlled,
  ];
  const ASSIGNMENT: Array<Ref & { arm: string }> = gate9.assignArms(SEED, FAMILIES);
  const SOLO = ASSIGNMENT.filter((a) => a.ccrc_id !== 'sess-split');
  const QUIZ: Ref[] = SOLO.filter((a) => a.arm === 'treatment').map(refOf);
  const CONTROL_SOLO: Ref = refOf(SOLO.find((a) => a.arm === 'control')!);
  const PILOT: Ref[] = [{ store_id: STORE_A, ccrc_id: 'pilot-0', generation: gen(100) }];
  const N_QUESTIONS = 64;

  const labeller = (): Rec => ({ ...gate9.LABELLER, path_forms: [...gate9.LABELLER.path_forms] });
  function draft(): Rec {
    return {
      kind: gate9.OPEN_RECORD_KIND, version: 1, part: 'draft', drafted_ms: T0 - 30 * DAY, supersedes: null,
      nodes: [{ label: 'node-a', store_id: STORE_A }, { label: 'node-b', store_id: STORE_B }],
      account: 'account-a', arm_model: ARM, writer_model: OPUS, judge_model: OPUS,
      // W2-4 Task 8's Step0aOutput, field for field, plus the label and store_id open --draft binds it to (W2-D25, amended).
      step0a: [STORE_A, STORE_B].map((s, i) => ({
        label: `node-${'ab'[i]}`, store_id: s, kind: 'ccrc-history-w2-step0a', v: 1, measured_ms: T0 - 32 * DAY, account: 'account-a',
        settings_mode: 'restricted', claude_code_version: '9.1.0', wrapper_sha256: null,
        flags_accepted: { '--output-format': true, '--verbose': true }, writer_init: { tools: [] }, judge_init: { tools: [] }, box_init: null,
        code_shas: { ...CODE }, release_stamp: TAG, budget: 100_000, spend: 1_200,
      })),
      settings_mode: 'restricted', window_plan: { planned_days: 14 },
      k: gate9.K, k_unit: gate9.K_UNIT, x: { ...gate9.X }, metric: gate9.METRIC_TEXT, row_cap: gate9.ROW_CAP,
      bootstrap: { ...gate9.BOOTSTRAP, seed: SEED, substreams: [...gate9.SUBSTREAMS] },
      labeller: { ...labeller(), sha_min_prefix: 7 },
      answer_protocol_sha256: gate9.ANSWER_PROTOCOL_SHA256, writer_prompt_sha256: gate9.WRITER_PROMPT_SHA256,
      rubric_id: 'v1', rubric_sha256: gate9.RUBRIC_SHA256.v1,
      quiz: { kinds: [...gate9.FACT_KINDS], target: 100, min_families: 20, caps: { family: 5, boundary: 3, kind_per_family: 2 },
        halt_floor: { questions: 60, families: 12 }, writer_input: 'excerpt', baseline_files: 'v1' },
      counters_def: { id: 'v1', sha256: gate9.COUNTERS_DEF_V1_SHA256 },
      active_rule: { lookback_ms: 604_800_000, legacy_excluded: true, text: 'a synthetic rule text' },
      q18_settings: { rho_headline: 0.3, power: [0.5, 0.8], lookback_days: 14, sims: 1000, grid_step: 0.005, procedure: 'bisection-on-grid-crn' },
      pilot: {
        seed: hex('pilot seed'), n_fidelity: 5, n_usage: 5, tolerance: 0.25, families: PILOT.map(refOf), frozen_sha256: hex('pilot frozen'),
        writer_model: OPUS,
        used: { labeller: labeller(), sha_min_prefix: 7, writer_input: 'excerpt', baseline_files: 'v1',
          writer_prompt_sha256: gate9.WRITER_PROMPT_SHA256, answer_protocol_sha256: gate9.ANSWER_PROTOCOL_SHA256 },
        code_shas: { ...CODE }, release_stamp: TAG, budget: 3_000_000, spend: 900_000,
      },
      limits: { threshold_pct: 70, max_age_ms: 3_600_000, batch_max: 10, concurrency: 2 },
      pilot_budget: 3_000_000,
      halts: { handcheck_agreement_min: 0.8, run_failed_max: 0.05, absent_rate_max: 0.05 },
      handcheck: { share: 0.2, of: 'judged', per_arm: true, judge_failed: 'always' },
      freezes: { maintenance_from: 'pilot-sourcing', build_from: 'final-rollout', surface: ['deploy/history-*.mjs'] },
      order: { quiz_arms_during_window: true },
      gate_code: { release_tag: TAG, files: { ...CODE } },
    };
  }
  function final(d: Rec = draft()): Rec {
    return {
      ...structuredClone(d), part: 'final', supersedes: gate9.recordSha256(d), finalized_ms: T0 - DAY,
      census: [STORE_A, STORE_B].map((s) => ({ store_id: s, census_ms: T0 - 3 * DAY, census_sha256: hex(`census ${s}`) })),
      registry_drops: [],
      q18: { headline: 0.2, at_power_80: 0.3, at_rho_0: 0.15, rho_hat: 0.1, n_f: {}, coverage: {}, pre_window_uptake: {},
        power_output_sha256: hex('power'), decision: 'keep' },
      pilot_result: { fidelity: [{ pass: true }], usage_extrapolation: {}, step0b_sha256: hex('step0b'), settings_mode: 'restricted',
        absent_rate: { num: 0, den: 10 } },
      spend_budget: 30_000_000,
      assignment: ASSIGNMENT.map((a) => ({ ...a })),
      assignment_sha256: gate9.assignmentSha256(ASSIGNMENT),
      quiz: { ...structuredClone(d.quiz), sha256: hex('quiz'), n_questions: N_QUESTIONS, n_families: QUIZ.length, families: QUIZ.map(refOf) },
      window: { start_ms: T0, end_ms: T0 + 14 * DAY },
      amendments: [],
    };
  }
  const FROZEN = { families: QUIZ.map(refOf), n_questions: N_QUESTIONS };
  type Ctx = { draft: Rec | null; predecessor: Rec | null; frozen: { families: Ref[]; n_questions: number } | null };
  const CTX0: Ctx = { draft: null, predecessor: null, frozen: null };
  const chainOf = (d: Rec): Ctx => ({ draft: d, predecessor: null, frozen: FROZEN });
  const verdict = (r: Rec, ctx: Ctx = CTX0): Err[] => {
    const v = gate9.validateOpenRecord(r, ctx);
    return v.ok ? [] : v.errors;
  };
  /** The validator called as a careless consumer might: with no context, or a partial one. */
  const bare = gate9.validateOpenRecord as unknown as (r: unknown, ctx?: unknown) => { ok: boolean; errors?: Err[] };
  /** Set a dotted path, `a.b[2].c`, on a record. */
  const set = (r: Rec, p: string, value: unknown): Rec => {
    const keys = p.replace(/\[(\d+)\]/g, '.$1').split('.');
    let o = r;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]!] = value;
    return r;
  };
  /** A quiz whose families are `fams`, kept consistent with its counts and the frozen file. */
  const withQuiz = (r: Rec, fams: Ref[]): { r: Rec; ctx: Ctx } => {
    r.quiz.families = fams.map(refOf);
    r.quiz.n_families = fams.length;
    return { r, ctx: { draft: draft(), predecessor: null, frozen: { families: fams.map(refOf), n_questions: N_QUESTIONS } } };
  };

  it('the fixture holds: the assignment has both arms, and one id holds a treatment and a control generation', () => {
    expect(new Set(ASSIGNMENT.map((a) => a.arm))).toEqual(new Set(['treatment', 'control']));
    expect(QUIZ.length).toBeGreaterThan(1);
    expect(armOf(SPLIT.treated)).toBe('treatment');
    expect(armOf(SPLIT.controlled)).toBe('control');
  });

  it('COUNTERS_DEF_V1 names exactly the five spec counters and rediscovery, frozen, and its sha is recomputed from it', () => {
    expect(gate9.COUNTERS_DEF_V1.map((c: { name: string }) => c.name))
      .toEqual(['compliance', 'echo_hits', 'lag', 'card_served', 'card_id_mismatch', 'rediscovery']);
    for (const c of gate9.COUNTERS_DEF_V1) expect(c.text.length, c.name).toBeGreaterThan(40);
    expect(Object.isFrozen(gate9.COUNTERS_DEF_V1)).toBe(true);
    for (const c of gate9.COUNTERS_DEF_V1) expect(Object.isFrozen(c), c.name).toBe(true);
    expect(gate9.COUNTERS_DEF_V1_SHA256).toBe(sha9(cj9(gate9.COUNTERS_DEF_V1)));
    expect(gate9.COUNTERS_DEF_V1_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('OPEN_RECORD_V1 holds every row of both tables, pilot families included, and part 2 carries part 1 whole', () => {
    expect(gate9.OPEN_RECORD_KIND).toBe('ccrc-history-w2-open-record');
    expect(gate9.OPEN_RECORD_V1.version).toBe(1);
    const PART1 = ['kind', 'version', 'part', 'drafted_ms', 'supersedes', 'nodes', 'account', 'arm_model', 'writer_model',
      'judge_model', 'step0a', 'settings_mode', 'window_plan', 'k', 'k_unit', 'x', 'metric', 'row_cap', 'bootstrap', 'labeller',
      'answer_protocol_sha256', 'writer_prompt_sha256', 'rubric_id', 'rubric_sha256', 'quiz', 'counters_def', 'active_rule',
      'q18_settings', 'pilot', 'limits', 'pilot_budget', 'halts', 'handcheck', 'freezes', 'order', 'gate_code'];
    const PART2 = ['finalized_ms', 'census', 'registry_drops', 'q18', 'pilot_result', 'spend_budget', 'assignment',
      'assignment_sha256', 'window', 'amendments'];
    expect(Object.keys(gate9.OPEN_RECORD_V1.draft).sort()).toEqual([...PART1].sort());
    expect(Object.keys(gate9.OPEN_RECORD_V1.final).sort()).toEqual([...PART1, ...PART2].sort());
    const spec = gate9.OPEN_RECORD_V1 as unknown as { draft: Record<string, Spec>; final: Record<string, Spec> };
    const sub = (f: Spec | undefined): Record<string, Spec> => f?.fields ?? {};
    expect(sub(spec.draft.pilot).families).toMatchObject({ type: 'array', status: 'measured' });   // W2-D76, D-5781
    expect(Object.keys(sub(sub(spec.draft.pilot).families?.items))).toEqual(['store_id', 'ccrc_id', 'generation']);
    expect(Object.keys(sub(spec.final.quiz))).toEqual([...Object.keys(sub(spec.draft.quiz)), 'sha256', 'n_questions', 'n_families', 'families']);
    expect(sub(spec.draft.active_rule).legacy_excluded).toMatchObject({ status: 'fixed', value: true });
    expect(sub(spec.draft.counters_def).sha256).toMatchObject({ status: 'fixed', value: gate9.COUNTERS_DEF_V1_SHA256 });
    expect(Object.keys(sub(sub(spec.draft.gate_code).files))).toEqual([...gate9.GATE_CODE_FILES]);
  });

  it('a valid chain passes: a draft, a superseding draft with its seed, a final, and an amended final', () => {
    const d1 = draft();
    expect(verdict(d1)).toEqual([]);
    const d2 = set(draft(), 'supersedes', gate9.recordSha256(d1));
    d2.window_plan.planned_days = 21;
    expect(verdict(d2, { draft: null, predecessor: d1, frozen: null })).toEqual([]);
    const f1 = final(d1);
    expect(verdict(f1, chainOf(d1))).toEqual([]);
    const f2 = { ...structuredClone(f1), supersedes: gate9.recordSha256(f1), finalized_ms: T0 + 2 * DAY,
      amendments: [amendment('forced-act', 'node-a', T0 + DAY, { act: 'prune --apply' })] };
    expect(verdict(f2, { draft: d1, predecessor: f1, frozen: FROZEN })).toEqual([]);
    expect(gate9.recordSha256(d1), 'a record\'s sha is its canonical JSON and one newline').toBe(sha9(`${cj9(d1)}\n`));
  });

  it('a missing field is field-missing at its path, pilot families and amendments included; a wrong type is field-malformed', () => {
    const d = draft();
    delete d.account;
    expect(verdict(d)).toEqual([{ path: 'account', word: 'field-missing' }]);
    const p = draft();
    delete p.pilot.families;
    expect(verdict(p)).toEqual([{ path: 'pilot.families', word: 'field-missing' }]);
    const f = final();
    delete f.amendments;
    expect(verdict(f)).toEqual([{ path: 'amendments', word: 'field-missing' }]);
    expect(verdict(set(draft(), 'bootstrap.seed', 'not-a-seed'))).toEqual([{ path: 'bootstrap.seed', word: 'field-malformed' }]);
    expect(verdict(set(draft(), 'step0a[1].budget', 1.5))).toEqual([{ path: 'step0a[1].budget', word: 'field-malformed' }]);
  });

  it('a seed change across a supersede is refused, draft to draft and draft to final', () => {
    const d1 = draft();
    const d2 = set(set(draft(), 'supersedes', gate9.recordSha256(d1)), 'bootstrap.seed', hex('another seed'));
    expect(verdict(d2, { draft: null, predecessor: d1, frozen: null })).toEqual([{ path: 'bootstrap.seed', word: 'seed-changed' }]);
    const other = set(draft(), 'bootstrap.seed', hex('another seed'));
    expect(verdict(set(final(), 'supersedes', gate9.recordSha256(other)), chainOf(other))).toEqual([{ path: 'bootstrap.seed', word: 'seed-changed' }]);
  });

  it.each([
    ['k', 11], ['k_unit', 'assistant-entries'], ['x', { num: 1, den: 20 }], ['metric', 'another metric'], ['row_cap', 401],
    ['bootstrap.B', 1000], ['bootstrap.method', 'bca'], ['bootstrap.substreams', ['quiz-ci']], ['quiz.kinds', ['sha', 'path', 'command', 'error', 'decision']],
    ['labeller.path_min', 9], ['labeller.window', 41], ['labeller.boundaries', 'v2'], ['version', 2], ['kind', 'another-record'],
  ])('a fixed field moved off its module constant is refused: %s', (p, value) => {
    const r = set(draft(), p, value);
    if (p.startsWith('labeller.')) set(r, `pilot.used.${p}`, value);   // the pilot signed under the same labeller
    expect(verdict(r)).toEqual([{ path: p, word: 'constant-mismatch' }]);
  });

  it('legacy_excluded other than true is refused (W2-D20: fixed)', () => {
    expect(verdict(set(draft(), 'active_rule.legacy_excluded', false))).toEqual([{ path: 'active_rule.legacy_excluded', word: 'constant-mismatch' }]);
  });

  it('sha_min_prefix 7 and 40 pass, any other is refused', () => {
    const at = (n: number): Err[] => verdict(set(set(draft(), 'labeller.sha_min_prefix', n), 'pilot.used.sha_min_prefix', n));
    expect(at(7)).toEqual([]);
    expect(at(40)).toEqual([]);
    expect(at(8)).toEqual([{ path: 'labeller.sha_min_prefix', word: 'value-outside-set' }]);
  });

  it('a rubric id outside RUBRIC_IDS is refused, and v1-strict signed with its own sha passes', () => {
    expect(verdict(set(set(draft(), 'rubric_id', 'v1-strict'), 'rubric_sha256', gate9.RUBRIC_SHA256['v1-strict']))).toEqual([]);
    expect(verdict(set(draft(), 'rubric_id', 'v2'))).toEqual([{ path: 'rubric_id', word: 'value-outside-set' }]);
  });

  it('a writer input outside WRITER_INPUTS is refused, and leaf-span signed by both parts passes', () => {
    const at = (w: string): Err[] => verdict(set(set(draft(), 'quiz.writer_input', w), 'pilot.used.writer_input', w));
    expect(at('leaf-span')).toEqual([]);
    expect(at('whole-leaf')).toEqual([{ path: 'quiz.writer_input', word: 'value-outside-set' }]);
  });

  it('a counters_def id other than v1 is refused', () => {
    expect(verdict(set(draft(), 'counters_def.id', 'v2'))).toEqual([{ path: 'counters_def.id', word: 'value-outside-set' }]);
  });

  it.each(['opus', 'claude-opus', 'claude-opus-latest', 'claude-opus-9-1[1m]', 'us.anthropic.claude-opus-9-1', 'claude-opus-9.1'])(
    'an alias-shaped writer model is refused: %s', (id) => {
      expect(verdict(set(set(draft(), 'writer_model', id), 'pilot.writer_model', id))).toEqual([{ path: 'writer_model', word: 'model-alias' }]);
    });

  it('an alias-shaped arm or judge model is refused', () => {
    expect(verdict(set(draft(), 'arm_model', 'claude-arm'))).toEqual([{ path: 'arm_model', word: 'model-alias' }]);
    expect(verdict(set(draft(), 'judge_model', 'claude-opus-latest'))).toEqual([{ path: 'judge_model', word: 'model-alias' }]);
  });

  it('a Fable arm model is refused, in any case', () => {
    expect(verdict(set(draft(), 'arm_model', 'claude-fable-9-1'))).toEqual([{ path: 'arm_model', word: 'model-forbidden' }]);
    expect(verdict(set(draft(), 'arm_model', 'claude-arm-fable-9-1'))).toEqual([{ path: 'arm_model', word: 'model-forbidden' }]);
    expect(verdict(set(draft(), 'arm_model', OPUS)), 'CONTROL: an Opus arm is not Fable').toEqual([]);
  });

  it('a non-Opus judge or writer is refused', () => {
    expect(verdict(set(draft(), 'judge_model', ARM))).toEqual([{ path: 'judge_model', word: 'model-forbidden' }]);
    expect(verdict(set(set(draft(), 'writer_model', ARM), 'pilot.writer_model', ARM))).toEqual([{ path: 'writer_model', word: 'model-forbidden' }]);
  });

  it.each([
    ['answer_protocol_sha256', (): string => sha9(`${gate9.ANSWER_PROTOCOL} `), ['pilot.used.answer_protocol_sha256']],
    ['writer_prompt_sha256', (): string => sha9(`${gate9.WRITER_PROMPT} `), ['pilot.used.writer_prompt_sha256']],
    ['rubric_sha256', (): string => sha9(`${gate9.RUBRICS.v1} `), []],
    ['counters_def.sha256', (): string => sha9(cj9(gate9.COUNTERS_DEF_V1.map((c: { name: string; text: string }, i: number) =>
      (i === 0 ? { name: c.name, text: `${c.text} ` } : c)))), []],
  ])('a signed text changed without a record change is refused: %s', (p, shaOfOld, alsoSigned) => {
    const old = shaOfOld();
    const r = set(draft(), p, old);
    for (const q of alsoSigned) set(r, q, old);   // the pilot signed the same old text
    expect(verdict(r)).toEqual([{ path: p, word: 'signed-text-mismatch' }]);
  });

  it('a step 0a entry or the pilot whose code shas differ from gate_code is code-changed; a release stamp, release-mismatch', () => {
    const s = draft();
    s.step0a[1].code_shas['deploy/history-replay.mjs'] = hex('older replay');
    expect(verdict(s)).toEqual([{ path: 'step0a[1].code_shas', word: 'code-changed' }]);
    expect(verdict(set(draft(), 'step0a[0].release_stamp', 'v0.0.899'))).toEqual([{ path: 'step0a[0].release_stamp', word: 'release-mismatch' }]);
    const p = draft();
    p.pilot.code_shas['ccd/history/lib.mjs'] = hex('older lib');
    expect(verdict(p)).toEqual([{ path: 'pilot.code_shas', word: 'code-changed' }]);
    expect(verdict(set(draft(), 'pilot.release_stamp', 'v0.0.899'))).toEqual([{ path: 'pilot.release_stamp', word: 'release-mismatch' }]);
  });

  it('checkGateCode names each mismatched file, in GATE_CODE_FILES order, and a file absent on either side is code-unmeasured, never code-changed', () => {
    const gc = { release_tag: TAG, files: { ...CODE } };
    expect(gate9.checkGateCode(gc, { ...CODE })).toEqual({ ok: true });
    const files: string[] = [...gate9.GATE_CODE_FILES];
    const two = { ...CODE, [files[3]!]: hex('x'), [files[0]!]: hex('y') };
    expect(gate9.checkGateCode(gc, two)).toEqual({ ok: false, word: 'code-changed', mismatched: [files[0], files[3]] });
    const absent: Record<string, string> = { ...CODE };
    delete absent[files[2]!];
    const gcAbsent = { release_tag: TAG, files: { ...absent } };
    const unmeasured = { ok: false, word: 'code-unmeasured', unmeasured: [files[2]] };
    expect(gate9.checkGateCode(gc, absent), 'absent from the measured shas').toEqual(unmeasured);
    expect(gate9.checkGateCode(gcAbsent, { ...CODE }), 'absent from gate_code').toEqual(unmeasured);
    expect(gate9.checkGateCode(gcAbsent, absent), 'absent on both sides').toEqual(unmeasured);
    expect(gate9.checkGateCode(gc, { ...two, [files[2]!]: undefined } as unknown as Record<string, string>), 'unmeasured is answered before a mismatch')
      .toEqual(unmeasured);
    expect(gate9.GATE_REASONS).toEqual(expect.arrayContaining(['code-changed', 'code-unmeasured']));
  });

  it.each([
    ['pilot.used.labeller', { ...gate9.LABELLER, boundaries: 'v0' }],
    ['pilot.used.sha_min_prefix', 40],
    ['pilot.used.writer_input', 'leaf-span'],
    ['pilot.used.baseline_files', 'v0'],
    ['pilot.used.writer_prompt_sha256', hex('another prompt')],
    ['pilot.used.answer_protocol_sha256', hex('another protocol')],
    ['pilot.writer_model', 'claude-opus-9-2'],
  ])('a pilot section signed under other settings than part 1 is refused: %s', (p, value) => {
    expect(verdict(set(draft(), p, value))).toEqual([{ path: p, word: 'pilot-drift' }]);
  });

  it('quiz.families inconsistent with the frozen file or with n_families is refused', () => {
    expect(verdict(final(), { ...chainOf(draft()), frozen: { families: QUIZ.slice(1), n_questions: N_QUESTIONS } }))
      .toEqual([{ path: 'quiz.families', word: 'quiz-mismatch' }]);
    expect(verdict(final(), { ...chainOf(draft()), frozen: { families: QUIZ, n_questions: N_QUESTIONS - 1 } }))
      .toEqual([{ path: 'quiz.n_questions', word: 'quiz-mismatch' }]);
    expect(verdict(set(final(), 'quiz.n_families', QUIZ.length + 1), chainOf(draft()))).toEqual([{ path: 'quiz.n_families', word: 'quiz-mismatch' }]);
    const dup = withQuiz(final(), [...QUIZ, QUIZ[0]!]);
    dup.r.quiz.n_families = QUIZ.length;
    expect(verdict(dup.r, dup.ctx)).toEqual([{ path: 'quiz.n_families', word: 'quiz-mismatch' }]);
  });

  it('a quiz family whose store and id hold a control-assigned family is refused, at the same or another generation (W2-D77)', () => {
    const same = withQuiz(final(), [...QUIZ, CONTROL_SOLO]);
    expect(verdict(same.r, same.ctx)).toEqual([{ path: `quiz.families[${QUIZ.length}]`, word: 'quiz-holds-control' }]);
    const other = withQuiz(final(), [...QUIZ, SPLIT.treated]);
    expect(verdict(other.r, other.ctx)).toEqual([{ path: `quiz.families[${QUIZ.length}]`, word: 'quiz-holds-control' }]);
    const control = withQuiz(final(), QUIZ.slice(1));
    expect(verdict(control.r, control.ctx), 'CONTROL: a treatment-only id passes').toEqual([]);
  });

  it('a pilot family in the quiz is refused (W2-D76)', () => {
    const o = withQuiz(final(), [...QUIZ, PILOT[0]!]);
    expect(verdict(o.r, o.ctx)).toEqual([{ path: `quiz.families[${QUIZ.length}]`, word: 'pilot-quiz-overlap' }]);
  });

  it('the window is planned_days long, up to one day more: 13 days and 15 days plus 1 ms are refused on a 14-day plan', () => {
    const len = (ms: number): Err[] => verdict(set(final(), 'window.end_ms', T0 + ms), chainOf(draft()));
    expect(len(14 * DAY)).toEqual([]);
    expect(len(15 * DAY)).toEqual([]);
    expect(len(13 * DAY)).toEqual([{ path: 'window', word: 'window-length' }]);
    expect(len(14 * DAY - 1)).toEqual([{ path: 'window', word: 'window-length' }]);
    expect(len(15 * DAY + 1)).toEqual([{ path: 'window', word: 'window-length' }]);
  });

  it('the window is measured against the draft it finalizes', () => {
    const d21 = set(draft(), 'window_plan.planned_days', 21);
    const errs = verdict(final(), chainOf(d21));
    expect(errs).toContainEqual({ path: 'window', word: 'window-length' });
    expect(errs).toContainEqual({ path: 'window_plan', word: 'draft-mismatch' });
  });

  it('a tampered arm is refused, even with its sha recomputed; a wrong sha or order is refused too (W2-D19)', () => {
    const t = final();
    const i = t.assignment.findIndex((a: { arm: string }) => a.arm === 'control');
    t.assignment[i].arm = 'treatment';
    t.assignment_sha256 = gate9.assignmentSha256(t.assignment);
    expect(verdict(t, chainOf(draft()))).toContainEqual({ path: `assignment[${i}].arm`, word: 'assignment-mismatch' });
    expect(verdict(set(final(), 'assignment_sha256', hex('another list')), chainOf(draft()))).toEqual([{ path: 'assignment_sha256', word: 'assignment-mismatch' }]);
    const rev = final();
    rev.assignment.reverse();
    rev.assignment_sha256 = gate9.assignmentSha256(rev.assignment);
    expect(verdict(rev, chainOf(draft()))).toEqual([{ path: 'assignment', word: 'assignment-mismatch' }]);
  });

  it('a final whose part 1 fields differ from its draft is refused', () => {
    const f = set(final(), 'arm_model', 'claude-arm-9-2');
    expect(verdict(f, chainOf(draft()))).toEqual([{ path: 'arm_model', word: 'draft-mismatch' }]);
    expect(verdict(f), 'without its draft and frozen list, the final is refused, never checked on its own')
      .toEqual([{ path: 'ctx.draft', word: 'field-missing' }, { path: 'ctx.frozen', word: 'field-missing' }]);
  });

  it('a predecessor of the other part, or one that is itself invalid, is chain-mismatch', () => {
    expect(verdict(final(), { draft: draft(), predecessor: draft(), frozen: FROZEN })).toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    const bad = set(final(), 'k', 11);
    expect(verdict(set(final(), 'finalized_ms', T0 - DAY / 2), { draft: draft(), predecessor: bad, frozen: FROZEN }))
      .toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
  });

  it("a supersedes that is not the superseded record's sha is chain-mismatch: a draft, a first final and an amended final (W2-D25, amended)", () => {
    const d1 = draft();
    const d2 = set(draft(), 'supersedes', hex('not d1'));
    expect(verdict(d2, { draft: null, predecessor: d1, frozen: null })).toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    expect(verdict(set(final(), 'supersedes', hex('not the draft')), chainOf(draft())), 'open --finalize supplies the draft')
      .toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    const f1 = final();
    const f2 = { ...structuredClone(f1), supersedes: gate9.recordSha256(draft()), finalized_ms: T0 - DAY / 2 };
    expect(verdict(f2, { draft: draft(), predecessor: f1, frozen: FROZEN }), 'an amended final names its predecessor, not its draft')
      .toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    expect(verdict(d1, { draft: null, predecessor: d1, frozen: null }), 'a first draft supplied a predecessor')
      .toEqual([{ path: 'supersedes', word: 'chain-mismatch' }]);
    expect(verdict(set(draft(), 'supersedes', gate9.recordSha256(d1))), 'a superseding draft needs its predecessor supplied')
      .toEqual([{ path: 'ctx.predecessor', word: 'field-missing' }]);
  });

  it('a null or missing validation context is refused, never read as a narrower check (W2-D25, amended)', () => {
    expect(bare(draft())).toEqual({ ok: false, errors: [{ path: 'ctx', word: 'field-missing' }] });
    expect(bare(draft(), null)).toEqual({ ok: false, errors: [{ path: 'ctx', word: 'field-missing' }] });
    expect(bare(final(), { draft: draft(), frozen: FROZEN })).toEqual({ ok: false, errors: [{ path: 'ctx.predecessor', word: 'field-missing' }] });
    expect(bare(draft(), { draft: null, predecessor: 'd1', frozen: null })).toEqual({ ok: false, errors: [{ path: 'ctx.predecessor', word: 'field-malformed' }] });
    expect(verdict(final(), { draft: draft(), predecessor: null, frozen: null })).toEqual([{ path: 'ctx.frozen', word: 'field-missing' }]);
    expect(verdict(final(), { draft: null, predecessor: null, frozen: FROZEN })).toEqual([{ path: 'ctx.draft', word: 'field-missing' }]);
    expect(verdict(final(), chainOf(draft())), 'CONTROL: the whole context').toEqual([]);
  });

  it('a field outside the schema is field-unknown at its path: at the top, nested, in a step 0a entry, and a part 2 field in a draft (W2-D25, amended)', () => {
    expect(verdict({ ...draft(), extra: 1 })).toEqual([{ path: 'extra', word: 'field-unknown' }]);
    expect(verdict(set(draft(), 'bootstrap.extra', 1))).toEqual([{ path: 'bootstrap.extra', word: 'field-unknown' }]);
    expect(verdict(set(draft(), 'step0a[1].note', 'x'))).toEqual([{ path: 'step0a[1].note', word: 'field-unknown' }]);
    expect(verdict({ ...draft(), window: { start_ms: T0, end_ms: T0 + 14 * DAY } })).toEqual([{ path: 'window', word: 'field-unknown' }]);
    expect(verdict(set(draft(), 'step0a[0].writer_init.extra', 1)), 'CONTROL: a producer\'s measured object stays open').toEqual([]);
  });

  it("the step 0a entry is W2-4's producer shape: flags_accepted a map of booleans, writer_init and judge_init non-null, box_init nullable (W2-D25, amended)", () => {
    expect(verdict(set(draft(), 'step0a[0].writer_init', null))).toEqual([{ path: 'step0a[0].writer_init', word: 'field-missing' }]);
    expect(verdict(set(draft(), 'step0a[1].judge_init', null))).toEqual([{ path: 'step0a[1].judge_init', word: 'field-missing' }]);
    expect(verdict(set(draft(), 'step0a[0].box_init', { tools: [] })), 'box_init is an object or null').toEqual([]);
    expect(verdict(set(draft(), 'step0a[0].flags_accepted', true))).toEqual([{ path: 'step0a[0].flags_accepted', word: 'field-malformed' }]);
    expect(verdict(set(draft(), 'step0a[0].flags_accepted', { '--verbose': 'yes' })))
      .toEqual([{ path: 'step0a[0].flags_accepted.--verbose', word: 'field-malformed' }]);
    const short = draft();
    delete short.step0a[1].box_init;
    expect(verdict(short)).toEqual([{ path: 'step0a[1].box_init', word: 'field-missing' }]);
  });

  it('a step 0a entry whose store_id names no node of part 1 is value-outside-set (W2-D25, amended)', () => {
    const STORE_C = '00000000-0000-4000-8000-0000000000c3';
    expect(verdict(set(draft(), 'step0a[1].store_id', STORE_C))).toEqual([{ path: 'step0a[1].store_id', word: 'value-outside-set' }]);
    const named = set(draft(), 'step0a[1].store_id', STORE_C);
    named.nodes.push({ label: 'node-c', store_id: STORE_C });
    expect(verdict(named), "CONTROL: the node set is the record's own nodes").toEqual([]);
  });

  it("a step 0a entry whose settings_mode differs from part 1's is value-outside-set (W2-D25, amended)", () => {
    expect(verdict(set(draft(), 'step0a[1].settings_mode', 'fallback'))).toEqual([{ path: 'step0a[1].settings_mode', word: 'value-outside-set' }]);
    expect(verdict(set(draft(), 'settings_mode', 'fallback')), "part 1's settings_mode binds every entry")
      .toEqual([{ path: 'step0a[0].settings_mode', word: 'value-outside-set' }, { path: 'step0a[1].settings_mode', word: 'value-outside-set' }]);
    const d = set(draft(), 'step0a[1].settings_mode', 'fallback');
    expect(verdict(set(final(d), 'pilot_result.settings_mode', 'fallback'), chainOf(d)), "part 2's pilot_result.settings_mode is a later record, not an excuse")
      .toEqual([{ path: 'step0a[1].settings_mode', word: 'value-outside-set' }, { path: 'supersedes', word: 'chain-mismatch' }]);
    const both = set(draft(), 'settings_mode', 'fallback');
    both.step0a.forEach((s: Rec) => { s.settings_mode = 'fallback'; });
    expect(verdict(both), 'CONTROL: part 1 and its step 0a under one settings mode').toEqual([]);
  });

  it("a flag step 0a measured rejected is flag-rejected, whatever part 1's settings mode (W2-D25, amended)", () => {
    expect(verdict(set(draft(), 'step0a[0].flags_accepted', { '--output-format': true, '--verbose': false })))
      .toEqual([{ path: 'step0a[0].flags_accepted.--verbose', word: 'flag-rejected' }]);
    /** Part 1 and every step 0a entry under one settings mode, so the binding holds and only the flags are read. */
    const underMode = (mode: string, flags: Record<string, boolean>): Rec => {
      const r = set(draft(), 'settings_mode', mode);
      r.step0a.forEach((s: Rec) => { s.settings_mode = mode; });
      return set(r, 'step0a[1].flags_accepted', flags);
    };
    expect(verdict(underMode('restricted', { '--restricted': false, '--verbose': true })))
      .toEqual([{ path: 'step0a[1].flags_accepted.--restricted', word: 'flag-rejected' }]);
    expect(verdict(underMode('fallback', { '--restricted': false, '--verbose': true })), 'the fallback excuses no flag, --restricted included')
      .toEqual([{ path: 'step0a[1].flags_accepted.--restricted', word: 'flag-rejected' }]);
    expect(verdict(underMode('fallback', { '--setting-sources': true, '--settings': false })))
      .toEqual([{ path: 'step0a[1].flags_accepted.--settings', word: 'flag-rejected' }]);
    expect(verdict(underMode('fallback', { '--setting-sources': true, '--settings': true })), 'CONTROL: the fallback, every flag accepted').toEqual([]);
  });

  describe('W2-D90: after window start a final may only append amendments', () => {
    // f1 is built per call, never at collection: final() calls this task's recordSha256, which the red run lacks.
    const f1 = (): Rec => final();
    const amend = (over: Rec, at = T0 + 2 * DAY): Rec => ({ ...f1(), supersedes: gate9.recordSha256(f1()), finalized_ms: at, ...over });
    const ctx = (): Ctx => ({ draft: draft(), predecessor: f1(), frozen: FROZEN });
    const forced = amendment('forced-act', 'node-a', T0 + DAY, { act: 'reparse' });

    it('an appended amendment after window start is accepted', () => {
      expect(verdict(amend({ amendments: [forced] }), ctx())).toEqual([]);
    });

    it('any other change after window start is refused, at the boundary instant too', () => {
      const moved = amend({ amendments: [forced], window: { start_ms: T0, end_ms: T0 + 14 * DAY + 3_600_000 } });
      expect(verdict(moved, ctx())).toEqual([{ path: 'window', word: 'post-start-change' }]);
      const atStart = amend({ amendments: [forced], window: { start_ms: T0, end_ms: T0 + 14 * DAY + 3_600_000 } }, T0);
      expect(verdict(atStart, ctx())).toEqual([{ path: 'window', word: 'post-start-change' }]);
      const before = amend({ window: { start_ms: T0 + DAY, end_ms: T0 + 15 * DAY } }, T0 - 1);
      expect(verdict(before, ctx()), 'CONTROL: before window start a final is superseded wholesale').toEqual([]);
    });

    it('a rewritten earlier amendment is refused', () => {
      const f2 = amend({ amendments: [forced] });
      const f3 = { ...structuredClone(f2), supersedes: gate9.recordSha256(f2), finalized_ms: T0 + 3 * DAY,
        amendments: [amendment('forced-act', 'node-a', T0 + DAY, { act: 'prune --apply' }), { ...forced, at_ms: T0 + 2 * DAY }] };
      expect(verdict(f3, { draft: draft(), predecessor: f2, frozen: FROZEN })).toEqual([{ path: 'amendments', word: 'post-start-change' }]);
    });

    it('an amendment kind outside AMENDMENT_KINDS is refused', () => {
      expect(verdict(amend({ amendments: [{ ...forced, kind: 'window-move' }] }), ctx())).toEqual([{ path: 'amendments[0].kind', word: 'amendment-kind' }]);
    });

    it('a version move without a re-pilot sha is refused, and with one it is accepted', () => {
      const move = amendment('version-move', 'node-b', T0 + DAY, { claude_code_version: '9.2.0' });
      expect(verdict(amend({ amendments: [move] }), ctx())).toEqual([{ path: 'amendments[0].detail.repilot_sha256', word: 'version-move-unpiloted' }]);
      const piloted = amendment('version-move', 'node-b', T0 + DAY, { claude_code_version: '9.2.0', repilot_sha256: hex('repilot') });
      expect(verdict(amend({ amendments: [piloted] }), ctx())).toEqual([]);
    });

    it("an amendment whose detail_sha256 is not its detail's sha256 is refused (W2-D25, amended)", () => {
      expect(verdict(amend({ amendments: [{ ...forced, detail_sha256: hex('another detail') }] }), ctx()))
        .toEqual([{ path: 'amendments[0].detail_sha256', word: 'amendment-detail-mismatch' }]);
      expect(verdict(amend({ amendments: [{ ...forced, detail: { act: 'prune --apply' } }] }), ctx()), 'a detail changed under its old sha')
        .toEqual([{ path: 'amendments[0].detail_sha256', word: 'amendment-detail-mismatch' }]);
    });
  });

  it('every word the validator spells is a GATE_REASONS word, and refuse throws on any other', () => {
    const src = readFileSync(path.join(ROOT, 'deploy', 'history-gate.mjs'), 'utf8');
    const section = src.slice(src.indexOf('// ── W2-3 Task 9:'));
    const words = [...section.matchAll(/refuse\([^;]*?'([a-z0-9-]+)'\)/g)].map((m) => m[1]!);
    expect(words.length).toBeGreaterThan(20);
    for (const w of new Set(words)) expect(gate9.GATE_REASONS, w).toContain(w);
    expect(section).toContain('if (!GATE_REASONS.includes(word)) throw');
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 9')
```

Expected: red, `68 failed | 1 passed` (predicted: the final plan review's ruling adds two cases, the node binding and the rejected flag, and the coordinator's settings-mode ruling a third, the settings-mode binding; measured as `65 failed | 1 passed` on 2026-10-19 on a scratch tree of `7d01973a2` holding Tasks 2 to 9's gate sections exactly as this plan writes them, with Tasks 5, 8 and 9's describes in one scratch test file, this task's section removed; `60 failed | 1 passed` before W2-D25's 2026-10-19 amendment added five cases). This was measured in a scratch tree holding stand-ins for the names Step 1 checks and none of this task's names. The one that passes is the fixture CONTROL (`the fixture holds`). The others fail with:
- `TypeError: validateOpenRecord is not a function` (most of them), `recordSha256 is not a function` where a fixture computes a `supersedes`, and `bare is not a function` in the context case;
- `TypeError: checkGateCode is not a function`;
- `TypeError: Cannot read properties of undefined (reading 'map')`, for the `COUNTERS_DEF_V1` cases.

- [ ] **Step 4: Write the section.** Append at the END of `deploy/history-gate.mjs`, after Task 8's section:

```js
// ── W2-3 Task 9: the counter definitions, the open record and its validator ─────────────────────────────────────
// W2-D87 freezes the text of the five spec counters and of re-discovery here; W2-6's counter module imports it, and
// part 1 signs its sha. OPEN_RECORD_V1 is the field schema of the two parts of the open record (decisions §4);
// `open --template` (W2-5a) derives its skeleton from it, and the repo holds no template file (W2-D25).
// validateOpenRecord refuses every W2-D25 bullet and W2-D90's rule, with GATE_REASONS words only: `refuse` throws
// on any other word, so a word this section invents is a red suite, not a silent new vocabulary. checkGateCode is
// W2-D24's comparison; the measured shas are data (W2-4's codeShas() measures them, and this module reads no file).

/** W2-D87 and W2-D86: what each report-only counter counts, per window of a listed family, by arm and by the
 *  producer of the window's boundary (W2-D15). Part 1 signs `counters_def: {id: 'v1', sha256}`; descoping any of
 *  them at open takes a D-number then. Order: the five spec counters in §10.2's order, then re-discovery. */
export const COUNTERS_DEF_V1 = Object.freeze([
  {
    name: 'compliance',
    text: 'Per window: the PARSE_STATUS distribution of the leaf whose boundary opens the window, and its ok plus degraded share, '
      + 'read from that leaf\'s nodes row through store.mjs openReader. The expected value is not-requested throughout: '
      + 'it is W3\'s baseline and a check that nothing was steered.',
  },
  {
    name: 'echo_hits',
    text: 'Per window: the recall-echo rows in the window, by lib provenanceOf\'s structural rule (spec section 6.2), whose '
      + 'tool_result is not an error, read from the window copy\'s rows through openReader. Reported beside the window\'s '
      + 'recall_calls count; a gap between the two is reported, never repaired.',
  },
  {
    name: 'lag',
    text: 'Per window: the lag_ms of the newest ticks row at or before the boundary\'s ts_ms that has a measured lag, read '
      + 'through openReader; unmeasured when there is none. It says how stale the index was when the compaction happened.',
  },
  {
    name: 'card_served',
    text: 'Per boundary: lib decideCardDelivery({ids, leafId, windowComplete}) over cardIdsIn of the hook_additional_context '
      + 'attachments in the first CARD_MEASURE_ROWS rows after the boundary in the copy pickHoldingCopy chooses, with '
      + 'cardWindowComplete, the functions the sweep\'s card measure uses; counted when it answers served. Control '
      + 'windows carry no card line by design: their figure is reported, never compared.',
  },
  {
    name: 'card_id_mismatch',
    text: 'Per boundary: the same decideCardDelivery call as card_served, counted when it answers mismatch (the card lines '
      + 'in the window name only other leaves). Control windows carry no card line by design: their figure is reported, '
      + 'never compared.',
  },
  {
    name: 'rediscovery',
    text: 'Per window, over the window\'s turns from turnsOf and the window builder: a Read tool_use in turns 1 to 10 whose '
      + 'file_path, made absolute, is the file_path of a Read, Edit, MultiEdit, Write or NotebookEdit tool_use in leaf N\'s '
      + 'span. Reported as an indicator and a distinct-path count. Bash reads are not counted.',
  },
].map((c) => Object.freeze(c)));

/** The sha part 1 signs as `counters_def.sha256`: sha256Hex over the canonical JSON of COUNTERS_DEF_V1. */
export const COUNTERS_DEF_V1_SHA256 = sha256Hex(canonicalJson(COUNTERS_DEF_V1));

/** The open record's `kind` (decisions §4, part 1's first row). */
export const OPEN_RECORD_KIND = 'ccrc-history-w2-open-record';

/** An exact model id, never an alias (W2-D25): `claude-`, one or more lower-case words, then one or more numeric
 *  segments, so `claude-opus-9-1` passes and a bare class word, `claude-<class>`, `claude-<class>-latest`, a `[1m]`
 *  suffix, a provider prefix or a dotted version are alias-shaped. */
export const EXACT_MODEL_ID_RE = /^claude-[a-z]+(?:-[a-z]+)*(?:-[0-9]+)+$/;
/** An arm model matching this is refused (W2-D25). */
export const ARM_MODEL_FORBIDDEN_RE = /fable/i;
/** A writer or judge model not matching this is refused (W2-D25, W2-D72, W2-D79). */
export const OPUS_MODEL_RE = /^claude-opus-/;

const RECORD_DAY_MS = 86_400_000;
const RECORD_HEX64_RE = /^[0-9a-f]{64}$/;

/** @typedef {'string'|'integer'|'number'|'boolean'|'hex64'|'object'|'array'} FieldType */
/** @typedef {'fixed'|'default'|'operator'|'measured'|'derived'} FieldStatus */
/** A field of the open record: its type, whether null is allowed, its status in decisions §4's tables, the value a
 *  `fixed` or `default` field holds, and, for an object, its fields (closed: any other key is field-unknown) or the
 *  field every value of a map is, or, for an array, its item. An object with neither `fields` nor `values` holds
 *  whatever its producer measured (W2-4's and W2-5a's outputs), checked for its type only.
 *  @typedef {{type: FieldType, nullable: boolean, status: FieldStatus, value?: unknown, fields?: FieldSpec, items?: Field, values?: Field}} Field */
/** @typedef {Readonly<Record<string, Field>>} FieldSpec */

/** @param {FieldType} type @param {FieldStatus} status @param {Partial<Field>} [extra] @returns {Field} */
const recField = (type, status, extra = {}) => Object.freeze({ type, nullable: false, status, ...extra });
/** @param {Record<string, Field>} fields @returns {FieldSpec} */
const recFields = (fields) => Object.freeze(fields);

const REC_FAMILY_REF = recFields({
  store_id: recField('string', 'measured'),
  ccrc_id: recField('string', 'measured'),
  generation: recField('string', 'measured'),
});
const REC_CODE_SHAS = recFields(Object.fromEntries(GATE_CODE_FILES.map((f) => [f, recField('hex64', 'measured')])));
const REC_LABELLER = recFields({
  sha_admit_prefix: recField('integer', 'fixed', { value: LABELLER.sha_admit_prefix }),
  path_min: recField('integer', 'fixed', { value: LABELLER.path_min }),
  window: recField('integer', 'fixed', { value: LABELLER.window }),
  path_forms: recField('array', 'fixed', { value: LABELLER.path_forms, items: recField('string', 'fixed') }),
  boundaries: recField('string', 'fixed', { value: LABELLER.boundaries }),
});
/** The build freeze's surface (W2-D6), the default `freezes.surface`. */
const REC_FREEZE_SURFACE = Object.freeze([
  'ccd/history/**', 'ccd/ccd-history-sweep', 'ccd/history-skill/**', 'ccd/install-history-skill.sh', 'ccd/session-hook.sh',
  'ccd/install-session-hooks.sh', 'ccd/compact-card.mjs', 'ccd/ccrc#history-dispatch-block', 'ccd/ccd#generation-blocks',
  'shared/wrapper.mjs', 'deploy/systemd/ccd-history-sweep.service', 'deploy/systemd/ccd-history-sweep.timer',
  'deploy/history-*.mjs', 'deploy/measure-history.py',
]);

/** Part 1 (draft): decisions §4's first table, row by row. */
const REC_DRAFT = recFields({
  kind: recField('string', 'fixed', { value: OPEN_RECORD_KIND }),
  version: recField('integer', 'fixed', { value: 1 }),
  part: recField('string', 'fixed', { value: 'draft' }),
  drafted_ms: recField('integer', 'measured'),
  supersedes: recField('hex64', 'fixed', { nullable: true, value: null }),
  nodes: recField('array', 'operator', { items: recField('object', 'operator', { fields: recFields({
    label: recField('string', 'operator'), store_id: recField('string', 'operator') }) }) }),
  account: recField('string', 'operator'),
  arm_model: recField('string', 'operator'),
  writer_model: recField('string', 'operator'),
  judge_model: recField('string', 'operator'),
  // Each entry is W2-4's step 0a output (W2-4 Task 8's fifteen Step0aOutput keys), field for field, plus the label and
  // store_id `open --draft` binds it to (W2-D25, amended 2026-10-19). kind and v are typed only: W2-4's loadStep0a
  // checked both, and this module does not spell the driver's kind again. writer_init and judge_init are not
  // nullable here: the writer and the judge are probed before part 1, so a null is field-missing.
  step0a: recField('array', 'measured', { items: recField('object', 'measured', { fields: recFields({
    label: recField('string', 'operator'),
    store_id: recField('string', 'operator'),
    kind: recField('string', 'measured'),
    v: recField('integer', 'measured'),
    measured_ms: recField('integer', 'measured'),
    account: recField('string', 'measured'),
    settings_mode: recField('string', 'measured'),
    claude_code_version: recField('string', 'measured'),
    wrapper_sha256: recField('hex64', 'measured', { nullable: true }),
    flags_accepted: recField('object', 'measured', { values: recField('boolean', 'measured') }),
    writer_init: recField('object', 'measured'),
    judge_init: recField('object', 'measured'),
    box_init: recField('object', 'measured', { nullable: true }),
    code_shas: recField('object', 'measured', { fields: REC_CODE_SHAS }),
    release_stamp: recField('string', 'measured'),
    budget: recField('integer', 'measured'),
    spend: recField('integer', 'measured'),
  }) }) }),
  settings_mode: recField('string', 'default', { value: 'restricted' }),
  window_plan: recField('object', 'default', { fields: recFields({ planned_days: recField('integer', 'default', { value: 14 }) }) }),
  k: recField('integer', 'fixed', { value: K }),
  k_unit: recField('string', 'fixed', { value: K_UNIT }),
  x: recField('object', 'fixed', { value: X, fields: recFields({ num: recField('integer', 'fixed'), den: recField('integer', 'fixed') }) }),
  metric: recField('string', 'fixed', { value: METRIC_TEXT }),
  row_cap: recField('integer', 'fixed', { value: ROW_CAP }),
  bootstrap: recField('object', 'fixed', { fields: recFields({
    B: recField('integer', 'fixed', { value: BOOTSTRAP.B }),
    ci: recField('integer', 'fixed', { value: BOOTSTRAP.ci }),
    method: recField('string', 'fixed', { value: BOOTSTRAP.method }),
    percentile: recField('string', 'fixed', { value: BOOTSTRAP.percentile }),
    statistic: recField('string', 'fixed', { value: BOOTSTRAP.statistic }),
    prng: recField('string', 'fixed', { value: BOOTSTRAP.prng }),
    seed: recField('hex64', 'measured'),
    substreams: recField('array', 'fixed', { value: SUBSTREAMS, items: recField('string', 'fixed') }),
  }) }),
  labeller: recField('object', 'fixed', { fields: recFields({
    ...REC_LABELLER,
    sha_min_prefix: recField('integer', 'default', { value: 7 }),
  }) }),
  answer_protocol_sha256: recField('hex64', 'fixed', { value: ANSWER_PROTOCOL_SHA256 }),
  writer_prompt_sha256: recField('hex64', 'fixed', { value: WRITER_PROMPT_SHA256 }),
  rubric_id: recField('string', 'default', { value: 'v1' }),
  rubric_sha256: recField('hex64', 'default', { value: RUBRIC_SHA256.v1 }),
  quiz: recField('object', 'default', { fields: recFields({
    kinds: recField('array', 'fixed', { value: FACT_KINDS, items: recField('string', 'fixed') }),
    target: recField('integer', 'default', { value: 100 }),
    min_families: recField('integer', 'default', { value: 20 }),
    caps: recField('object', 'default', { fields: recFields({
      family: recField('integer', 'default', { value: 5 }),
      boundary: recField('integer', 'default', { value: 3 }),
      kind_per_family: recField('integer', 'default', { value: 2 }),
    }) }),
    halt_floor: recField('object', 'default', { fields: recFields({
      questions: recField('integer', 'default', { value: 60 }),
      families: recField('integer', 'default', { value: 12 }),
    }) }),
    writer_input: recField('string', 'default', { value: 'excerpt' }),
    baseline_files: recField('string', 'default', { value: 'v1' }),
  }) }),
  counters_def: recField('object', 'default', { fields: recFields({
    id: recField('string', 'default', { value: 'v1' }),
    sha256: recField('hex64', 'fixed', { value: COUNTERS_DEF_V1_SHA256 }),
  }) }),
  active_rule: recField('object', 'default', { fields: recFields({
    lookback_ms: recField('integer', 'default', { value: ACTIVE_LOOKBACK_MS }),
    legacy_excluded: recField('boolean', 'fixed', { value: true }),
    text: recField('string', 'default'),
  }) }),
  q18_settings: recField('object', 'default', { fields: recFields({
    rho_headline: recField('number', 'default', { value: Q18_DEFAULTS.rho_headline }),
    power: recField('array', 'default', { value: Q18_DEFAULTS.power, items: recField('number', 'default') }),
    lookback_days: recField('integer', 'default', { value: Q18_DEFAULTS.lookback_days }),
    sims: recField('integer', 'default', { value: Q18_DEFAULTS.sims }),
    grid_step: recField('number', 'default', { value: Q18_DEFAULTS.grid_step }),
    procedure: recField('string', 'default', { value: Q18_DEFAULTS.procedure }),
  }) }),
  pilot: recField('object', 'measured', { fields: recFields({
    seed: recField('hex64', 'measured'),
    n_fidelity: recField('integer', 'default', { value: 5 }),
    n_usage: recField('integer', 'default', { value: 5 }),
    tolerance: recField('number', 'default', { value: 0.25 }),
    families: recField('array', 'measured', { items: recField('object', 'measured', { fields: REC_FAMILY_REF }) }),
    frozen_sha256: recField('hex64', 'measured'),
    writer_model: recField('string', 'measured'),
    used: recField('object', 'measured', { fields: recFields({
      labeller: recField('object', 'measured', { fields: REC_LABELLER }),
      sha_min_prefix: recField('integer', 'measured'),
      writer_input: recField('string', 'measured'),
      baseline_files: recField('string', 'measured'),
      writer_prompt_sha256: recField('hex64', 'measured'),
      answer_protocol_sha256: recField('hex64', 'measured'),
    }) }),
    code_shas: recField('object', 'measured', { fields: REC_CODE_SHAS }),
    release_stamp: recField('string', 'measured'),
    budget: recField('integer', 'measured'),
    spend: recField('integer', 'measured'),
  }) }),
  limits: recField('object', 'default', { fields: recFields({
    threshold_pct: recField('integer', 'default', { value: 70 }),
    max_age_ms: recField('integer', 'default', { value: 3_600_000 }),
    batch_max: recField('integer', 'default', { value: 10 }),
    concurrency: recField('integer', 'default', { value: 2 }),
  }) }),
  pilot_budget: recField('integer', 'default', { value: 3_000_000 }),
  halts: recField('object', 'default', { fields: recFields({
    handcheck_agreement_min: recField('number', 'default', { value: HALT_DEFAULTS.handcheck_agreement_min }),
    run_failed_max: recField('number', 'default', { value: HALT_DEFAULTS.run_failed_max }),
    absent_rate_max: recField('number', 'default', { value: HALT_DEFAULTS.absent_rate_max }),
  }) }),
  handcheck: recField('object', 'default', { fields: recFields({
    share: recField('number', 'default', { value: 0.2 }),
    of: recField('string', 'default', { value: 'judged' }),
    per_arm: recField('boolean', 'default', { value: true }),
    judge_failed: recField('string', 'default', { value: 'always' }),
  }) }),
  freezes: recField('object', 'default', { fields: recFields({
    maintenance_from: recField('string', 'default', { value: 'pilot-sourcing' }),
    build_from: recField('string', 'default', { value: 'final-rollout' }),
    surface: recField('array', 'default', { value: REC_FREEZE_SURFACE, items: recField('string', 'default') }),
  }) }),
  order: recField('object', 'default', { fields: recFields({
    quiz_arms_during_window: recField('boolean', 'default', { value: true }),
  }) }),
  gate_code: recField('object', 'measured', { fields: recFields({
    release_tag: recField('string', 'measured'),
    files: recField('object', 'measured', { fields: REC_CODE_SHAS }),
  }) }),
});

/** Part 2 (final) carries every part 1 field unchanged, so a `--record <final>` consumer reads one file, and adds
 *  decisions §4's second table. Its `quiz` is part 1's quiz plan with the frozen list's four fields added. */
const REC_FINAL = recFields({
  ...REC_DRAFT,
  part: recField('string', 'fixed', { value: 'final' }),
  supersedes: recField('hex64', 'fixed'),
  finalized_ms: recField('integer', 'measured'),
  census: recField('array', 'measured', { items: recField('object', 'measured', { fields: recFields({
    store_id: recField('string', 'measured'), census_ms: recField('integer', 'measured'), census_sha256: recField('hex64', 'measured') }) }) }),
  registry_drops: recField('array', 'measured', { items: recField('object', 'measured', { fields: recFields({
    ...REC_FAMILY_REF, reason: recField('string', 'measured') }) }) }),
  q18: recField('object', 'measured', { fields: recFields({
    headline: recField('number', 'measured', { nullable: true }),
    at_power_80: recField('number', 'measured', { nullable: true }),
    at_rho_0: recField('number', 'measured', { nullable: true }),
    rho_hat: recField('number', 'measured', { nullable: true }),
    n_f: recField('object', 'measured'),
    coverage: recField('object', 'measured'),
    pre_window_uptake: recField('object', 'measured'),
    power_output_sha256: recField('hex64', 'measured'),
    decision: recField('string', 'operator'),
  }) }),
  pilot_result: recField('object', 'measured', { fields: recFields({
    fidelity: recField('array', 'measured', { items: recField('object', 'measured') }),
    usage_extrapolation: recField('object', 'measured'),
    step0b_sha256: recField('hex64', 'measured'),
    settings_mode: recField('string', 'measured'),
    absent_rate: recField('object', 'measured'),
  }) }),
  spend_budget: recField('integer', 'derived'),
  assignment: recField('array', 'derived', { items: recField('object', 'derived', { fields: recFields({
    ...REC_FAMILY_REF, arm: recField('string', 'derived') }) }) }),
  assignment_sha256: recField('hex64', 'derived'),
  quiz: recField('object', 'measured', { fields: recFields({
    ...REC_DRAFT.quiz.fields,
    sha256: recField('hex64', 'measured'),
    n_questions: recField('integer', 'measured'),
    n_families: recField('integer', 'measured'),
    families: recField('array', 'measured', { items: recField('object', 'measured', { fields: REC_FAMILY_REF }) }),
  }) }),
  window: recField('object', 'operator', { fields: recFields({
    start_ms: recField('integer', 'operator'), end_ms: recField('integer', 'operator') }) }),
  amendments: recField('array', 'measured', { value: Object.freeze([]), items: recField('object', 'measured', { fields: recFields({
    kind: recField('string', 'operator'),
    node_label_ref: recField('string', 'operator', { nullable: true }),
    at_ms: recField('integer', 'measured'),
    detail_sha256: recField('hex64', 'measured'),
    detail: recField('object', 'measured'),
  }) }) }),
});

/** The field schema of both parts (decisions §4). `open --template` (W2-5a) prints a skeleton from it. */
export const OPEN_RECORD_V1 = Object.freeze({ version: 1, draft: REC_DRAFT, final: REC_FINAL });

/** @type {Readonly<Record<FieldType, (v: unknown) => boolean>>} */
const REC_TYPE_OK = Object.freeze({
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isSafeInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  hex64: (v) => typeof v === 'string' && RECORD_HEX64_RE.test(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
});

/** W2-D24: gate_code.files against measured shas, file by file over GATE_CODE_FILES. A file whose sha is absent on
 *  either side is unmeasured, never a change, and is answered first (code-unmeasured: W2-D24 and W2-D56, amended
 *  2026-10-19, so --allow-code-change can never stamp it); otherwise each file whose shas differ is mismatched
 *  (code-changed). The shas are data: W2-4's codeShas() measures them, step 0a and the pilot record them.
 *  @param {{release_tag: string, files: Record<string, string>}} gateCode @param {Record<string, string>} shas
 *  @returns {{ok: true} | {ok: false, word: 'code-unmeasured', unmeasured: string[]} | {ok: false, word: 'code-changed', mismatched: string[]}} */
export function checkGateCode(gateCode, shas) {
  const unmeasured = GATE_CODE_FILES.filter((f) => !(typeof shas?.[f] === 'string' && typeof gateCode?.files?.[f] === 'string'));
  if (unmeasured.length > 0) return { ok: false, word: 'code-unmeasured', unmeasured: [...unmeasured] };
  const mismatched = GATE_CODE_FILES.filter((f) => gateCode.files[f] !== shas[f]);
  return mismatched.length === 0 ? { ok: true } : { ok: false, word: 'code-changed', mismatched: [...mismatched] };
}

/** A record's sha256 (W2-D25): the one `--record-sha256` names and a successor's `supersedes` carries. It is the
 *  sha256 of the bytes `open` prints, the record's canonical JSON and one newline, the form W2-4 writes step 0a's
 *  output in. validateOpenRecord compares `supersedes` with it (W2-D25, amended 2026-10-19: chained).
 *  @param {object} record @returns {string} */
export function recordSha256(record) {
  return sha256Hex(canonicalJson(record) + '\n');
}

/** One list of errors, each a GATE_REASONS word at a path, listed once per path; any other word throws (W2-D12,
 *  W2-D25). */
function recRefusals() {
  /** @type {Array<{path: string, word: string}>} */
  const errors = [];
  /** @param {string} path @param {string} word */
  const refuse = (path, word) => {
    if (!GATE_REASONS.includes(word)) throw new Error(`history-gate: '${word}' is not a GATE_REASONS word`);
    if (!errors.some((e) => e.path === path && e.word === word)) errors.push({ path, word });
  };
  return { errors, refuse };
}

/** A missing field, or a null where the schema allows none, is `field-missing`; a present one of the wrong type is
 *  `field-malformed`; and, the schema being closed (W2-D25, amended 2026-10-19), a field outside it is
 *  `field-unknown`. */
function recShapeErrors(value, spec, path, refuse) {
  for (const [k, f] of Object.entries(spec)) {
    const p = path === '' ? k : `${path}.${k}`;
    if (!Object.hasOwn(value, k)) refuse(p, 'field-missing');
    else recFieldErrors(value[k], f, p, refuse);
  }
  for (const k of Object.keys(value)) if (!Object.hasOwn(spec, k)) refuse(path === '' ? k : `${path}.${k}`, 'field-unknown');
}
function recFieldErrors(v, f, p, refuse) {
  if (v === null && f.nullable) return;
  if (v === null) { refuse(p, 'field-missing'); return; }   // null carries no value: a part 1 writer_init among them
  if (!REC_TYPE_OK[f.type](v)) { refuse(p, 'field-malformed'); return; }
  if (f.fields) recShapeErrors(v, f.fields, p, refuse);
  if (f.values) for (const [k, x] of Object.entries(v)) recFieldErrors(x, f.values, `${p}.${k}`, refuse);
  if (f.items) v.forEach((item, i) => recFieldErrors(item, f.items, `${p}[${i}]`, refuse));
}

const recSame = (a, b) => canonicalJson(a) === canonicalJson(b);
const recRefOf = (f) => ({ store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation });
const recKeyOf = (f) => familyKey(f.store_id, f.ccrc_id, f.generation);
const recWithout = (o, k) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
/** A record's part 1 view: every part 1 field but `part` and `supersedes`, with `quiz` cut to part 1's quiz plan. */
function recPartOneView(r) {
  const view = {};
  for (const k of Object.keys(REC_DRAFT)) {
    if (k === 'part' || k === 'supersedes') continue;
    view[k] = k === 'quiz'
      ? Object.fromEntries(Object.keys(REC_DRAFT.quiz.fields).map((q) => [q, r.quiz[q]]))
      : r[k];
  }
  return view;
}
/** What W2-D90 leaves free after window start: everything but these three is frozen. */
const REC_AMEND_FREE = Object.freeze(['finalized_ms', 'supersedes', 'amendments']);

/** W2-D25's validator, both parts, their amendments and the chain between them (decisions §4 step 7). Closed,
 *  chained and self-checking (W2-D25, amended 2026-10-19), and its context is required, never a narrower check:
 *  ctx.draft: the part 1 a final finalizes (required for a final; ignored for a draft).
 *  ctx.predecessor: the record this one supersedes, of the same part (null for a first draft or a first final, whose
 *  `supersedes` names its draft; required for a draft whose `supersedes` is not null).
 *  ctx.frozen: the frozen quiz list's families and question count (required for a final; ignored for a draft).
 *  A null or missing ctx, or a missing key, is field-missing at `ctx` or `ctx.<key>`, and nothing else is checked.
 *  @param {object} record
 *  @param {{draft: object|null, predecessor: object|null, frozen: {families: Array<{store_id: string, ccrc_id: string, generation: string}>, n_questions: number}|null}} ctx
 *  @returns {{ok: true} | {ok: false, errors: Array<{path: string, word: string}>}} */
export function validateOpenRecord(record, ctx) {
  return recValidate(record, ctx, true);
}

/** validateOpenRecord's body. `checkLink` is false only when a predecessor or a draft is itself validated: its own
 *  `supersedes` was checked against its own predecessor when it was published, so a chain is checked a link at a time. */
function recValidate(record, ctx, checkLink) {
  const { errors, refuse } = recRefusals();
  const done = () => (errors.length === 0 ? { ok: true } : { ok: false, errors });
  // The context (W2-D25, amended 2026-10-19): required, never read as a narrower check.
  if (!REC_TYPE_OK.object(ctx)) { refuse('ctx', 'field-missing'); return done(); }
  for (const k of ['draft', 'predecessor', 'frozen']) {
    if (!Object.hasOwn(ctx, k)) refuse(`ctx.${k}`, 'field-missing');
    else if (ctx[k] !== null && !REC_TYPE_OK.object(ctx[k])) refuse(`ctx.${k}`, 'field-malformed');
  }
  if (errors.length > 0) return done();
  if (!REC_TYPE_OK.object(record)) { refuse('', 'field-malformed'); return done(); }
  if (!Object.hasOwn(record, 'part')) { refuse('part', 'field-missing'); return done(); }
  if (record.part !== 'draft' && record.part !== 'final') { refuse('part', 'constant-mismatch'); return done(); }
  const final = record.part === 'final';
  recShapeErrors(record, OPEN_RECORD_V1[record.part], '', refuse);
  if (errors.length > 0) return done();   // the checks below read a well-shaped record only
  const r = /** @type {any} */ (record);
  // What this record's part needs from the context: a final its draft and the frozen list; a superseding draft its
  // predecessor (a final's first predecessor is its draft).
  if (final && ctx.draft === null) refuse('ctx.draft', 'field-missing');
  if (final && ctx.frozen === null) refuse('ctx.frozen', 'field-missing');
  else if (final && !(REC_TYPE_OK.array(ctx.frozen.families) && REC_TYPE_OK.integer(ctx.frozen.n_questions))) refuse('ctx.frozen', 'field-malformed');
  if (checkLink && !final && r.supersedes !== null && ctx.predecessor === null) refuse('ctx.predecessor', 'field-missing');
  if (errors.length > 0) return done();

  // Fixed fields: the module constants (W2-D14, W2-D18, W2-D20, W2-D22, W2-D60, W2-D62).
  const fixed = [
    ['kind', r.kind, OPEN_RECORD_KIND], ['version', r.version, OPEN_RECORD_V1.version],
    ['k', r.k, K], ['k_unit', r.k_unit, K_UNIT], ['x', r.x, X], ['metric', r.metric, METRIC_TEXT], ['row_cap', r.row_cap, ROW_CAP],
    ...Object.keys(BOOTSTRAP).map((b) => [`bootstrap.${b}`, r.bootstrap[b], BOOTSTRAP[b]]),
    ['bootstrap.substreams', r.bootstrap.substreams, SUBSTREAMS],
    ...Object.keys(LABELLER).map((l) => [`labeller.${l}`, r.labeller[l], LABELLER[l]]),
    ['quiz.kinds', r.quiz.kinds, FACT_KINDS],
    ['active_rule.legacy_excluded', r.active_rule.legacy_excluded, true],
  ];
  for (const [p, got, want] of fixed) if (!recSame(got, want)) refuse(p, 'constant-mismatch');

  // Closed sets (W2-D63, W2-D79, W2-D72, W2-D87).
  if (!SHA_MIN_PREFIXES.includes(r.labeller.sha_min_prefix)) refuse('labeller.sha_min_prefix', 'value-outside-set');
  if (!RUBRIC_IDS.includes(r.rubric_id)) refuse('rubric_id', 'value-outside-set');
  if (!WRITER_INPUTS.includes(r.quiz.writer_input)) refuse('quiz.writer_input', 'value-outside-set');
  if (r.counters_def.id !== 'v1') refuse('counters_def.id', 'value-outside-set');

  // Models (W2-D25): exact ids for every role; the arm model not Fable; writer and judge Opus.
  for (const role of ['arm_model', 'writer_model', 'judge_model']) {
    const id = r[role];
    if (!EXACT_MODEL_ID_RE.test(id)) refuse(role, 'model-alias');
    else if (role === 'arm_model' ? ARM_MODEL_FORBIDDEN_RE.test(id) : !OPUS_MODEL_RE.test(id)) refuse(role, 'model-forbidden');
  }

  // The signed texts (W2-D64, W2-D72, W2-D79, W2-D87).
  if (r.answer_protocol_sha256 !== ANSWER_PROTOCOL_SHA256) refuse('answer_protocol_sha256', 'signed-text-mismatch');
  if (r.writer_prompt_sha256 !== WRITER_PROMPT_SHA256) refuse('writer_prompt_sha256', 'signed-text-mismatch');
  if (RUBRIC_IDS.includes(r.rubric_id) && r.rubric_sha256 !== RUBRIC_SHA256[r.rubric_id]) refuse('rubric_sha256', 'signed-text-mismatch');
  if (r.counters_def.sha256 !== COUNTERS_DEF_V1_SHA256) refuse('counters_def.sha256', 'signed-text-mismatch');

  // gate_code against what step 0a and the pilot ran under (W2-D24, W2-D57).
  const ranUnder = [...r.step0a.map((s, i) => [`step0a[${i}]`, s]), ['pilot', r.pilot]];
  for (const [p, s] of ranUnder) {
    if (!checkGateCode(r.gate_code, s.code_shas).ok) refuse(`${p}.code_shas`, 'code-changed');
    if (s.release_stamp !== r.gate_code.release_tag) refuse(`${p}.release_stamp`, 'release-mismatch');
  }

  // Each step 0a output bound to a named node and to part 1's settings mode, and every flag it measured accepted
  // (W2-D25, amended 2026-10-19 at the final W2-3/W2-4 plan review, and by the coordinator's settings-mode ruling).
  // A store_id that names no node, or a settings_mode other than part 1's top-level one, is value-outside-set. Only
  // part 1's settings_mode binds step 0a; part 2's pilot_result.settings_mode is a later record, never read here.
  // A flag measured false is flag-rejected, with no exception: under spec §10.2's fallback settings mode step 0a
  // writes no --restricted key, so refusing every false loses nothing.
  const nodeStores = new Set(r.nodes.map((n) => n.store_id));
  r.step0a.forEach((s, i) => {
    if (!nodeStores.has(s.store_id)) refuse(`step0a[${i}].store_id`, 'value-outside-set');
    if (s.settings_mode !== r.settings_mode) refuse(`step0a[${i}].settings_mode`, 'value-outside-set');
    for (const [flag, accepted] of Object.entries(s.flags_accepted)) {
      if (accepted === false) refuse(`step0a[${i}].flags_accepted.${flag}`, 'flag-rejected');
    }
  });

  // The pilot section signed under part 1's own settings (W2-D76, W2-D71).
  const used = r.pilot.used;
  const drift = [
    ['pilot.used.labeller', used.labeller, recWithout(r.labeller, 'sha_min_prefix')],
    ['pilot.used.sha_min_prefix', used.sha_min_prefix, r.labeller.sha_min_prefix],
    ['pilot.used.writer_input', used.writer_input, r.quiz.writer_input],
    ['pilot.used.baseline_files', used.baseline_files, r.quiz.baseline_files],
    ['pilot.used.writer_prompt_sha256', used.writer_prompt_sha256, r.writer_prompt_sha256],
    ['pilot.used.answer_protocol_sha256', used.answer_protocol_sha256, r.answer_protocol_sha256],
    ['pilot.writer_model', r.pilot.writer_model, r.writer_model],
  ];
  for (const [p, got, want] of drift) if (!recSame(got, want)) refuse(p, 'pilot-drift');

  // The chain (W2-D25, amended 2026-10-19: chained). `supersedes` is recordSha256 of the record it supersedes: a
  // draft's earlier draft, a final's earlier final, or, for a first final, its draft (open --finalize supplies it).
  // That record is of the same part and itself valid, and the seed never changes across a supersede.
  const pred = ctx.predecessor;
  if (checkLink) {
    const prior = final ? (pred ?? ctx.draft) : pred;
    if (r.supersedes === null ? prior !== null : r.supersedes !== recordSha256(prior)) refuse('supersedes', 'chain-mismatch');
  }
  if (pred !== null) {
    const predCtx = { draft: final ? ctx.draft : null, predecessor: null, frozen: final ? ctx.frozen : null };
    if (pred.part !== record.part || !recValidate(pred, predCtx, false).ok) refuse('supersedes', 'chain-mismatch');
    else if (pred.bootstrap.seed !== r.bootstrap.seed) refuse('bootstrap.seed', 'seed-changed');
  }
  if (!final) return done();

  const draft = ctx.draft;
  if (draft.part !== 'draft' || !recValidate(draft, { draft: null, predecessor: null, frozen: null }, false).ok) refuse('supersedes', 'chain-mismatch');
  else if (draft.bootstrap.seed !== r.bootstrap.seed) refuse('bootstrap.seed', 'seed-changed');
  else {
    const mine = recPartOneView(r);
    const theirs = recPartOneView(draft);
    for (const k of Object.keys(mine)) if (k !== 'bootstrap' && !recSame(mine[k], theirs[k])) refuse(k, 'draft-mismatch');
  }

  // The window: planned_days long, up to one day more, of the draft it finalizes (W2-D25, a chosen tolerance).
  const plannedMs = (draft.window_plan?.planned_days ?? r.window_plan.planned_days) * RECORD_DAY_MS;
  const lengthMs = r.window.end_ms - r.window.start_ms;
  if (lengthMs < plannedMs || lengthMs > plannedMs + RECORD_DAY_MS) refuse('window', 'window-length');

  // The assignment re-derives from the seed (W2-D19).
  const seed = r.bootstrap.seed;
  r.assignment.forEach((a, i) => { if (a.arm !== armOf(seed, a)) refuse(`assignment[${i}].arm`, 'assignment-mismatch'); });
  if (!recSame(r.assignment, assignArms(seed, r.assignment.map(recRefOf)))) refuse('assignment', 'assignment-mismatch');
  if (r.assignment_sha256 !== assignmentSha256(r.assignment)) refuse('assignment_sha256', 'assignment-mismatch');

  // The quiz families: consistent with their counts and the frozen file; no control-held id; no pilot family
  // (W2-D25, W2-D77, W2-D76).
  const quizKeys = r.quiz.families.map(recKeyOf);
  if (new Set(quizKeys).size !== quizKeys.length || r.quiz.n_families !== quizKeys.length) refuse('quiz.n_families', 'quiz-mismatch');
  const frozen = ctx.frozen;
  if (!recSame([...new Set(quizKeys)].sort(), [...new Set(frozen.families.map(recKeyOf))].sort())) refuse('quiz.families', 'quiz-mismatch');
  if (r.quiz.n_questions !== frozen.n_questions) refuse('quiz.n_questions', 'quiz-mismatch');
  const pilotKeys = new Set(r.pilot.families.map(recKeyOf));
  r.quiz.families.forEach((q, i) => {
    if (r.assignment.some((a) => a.arm === 'control' && a.store_id === q.store_id && a.ccrc_id === q.ccrc_id)) refuse(`quiz.families[${i}]`, 'quiz-holds-control');
    if (pilotKeys.has(recKeyOf(q))) refuse(`quiz.families[${i}]`, 'pilot-quiz-overlap');
  });

  // Amendments (W2-D90): a closed kind set, a version move carries its re-pilot sha, and every detail_sha256 is
  // recomputed from its detail (W2-D25, amended 2026-10-19).
  r.amendments.forEach((a, i) => {
    if (!AMENDMENT_KINDS.includes(a.kind)) refuse(`amendments[${i}].kind`, 'amendment-kind');
    else if (a.kind === 'version-move' && !REC_TYPE_OK.hex64(a.detail.repilot_sha256)) refuse(`amendments[${i}].detail.repilot_sha256`, 'version-move-unpiloted');
    if (a.detail_sha256 !== sha256Hex(canonicalJson(a.detail))) refuse(`amendments[${i}].detail_sha256`, 'amendment-detail-mismatch');
  });

  // After window start, a superseding final only appends amendments (W2-D90).
  if (pred !== null && pred.part === 'final' && r.finalized_ms >= pred.window.start_ms) {
    const keys = new Set([...Object.keys(r), ...Object.keys(pred)]);
    for (const k of [...keys].sort()) if (!REC_AMEND_FREE.includes(k) && !recSame(r[k], pred[k])) refuse(k, 'post-start-change');
    if (!recSame(r.amendments.slice(0, pred.amendments.length), pred.amendments)) refuse('amendments', 'post-start-change');
  }
  return done();
}
```

- [ ] **Step 5: Run them and see them pass, then the whole file and the typecheck.**

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 9')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- The first is green, `69 passed`: 31 `it.each` rows and 38 single cases, the nested W2-D90 describe's 6 among them (predicted: the final plan review's two cases and the settings-mode ruling's one on top of `66 passed`, measured on 2026-10-19 on a scratch tree of `7d01973a2` holding Tasks 2 to 9's gate sections exactly as this plan writes them, with Tasks 5, 8 and 9's describes in one scratch test file; `61 passed` against the stand-ins before W2-D25's 2026-10-19 amendment added five cases; the checkGateCode case's `code-unmeasured` assertions and the function's two-list rewrite, from W2-D24's amendment, came after that measurement and add no case, so their pass is predicted).
- The whole file is green: Tasks 1 to 8's cases plus these 69 (predicted for the whole file).
- tsc prints nothing. This was measured on this block in a scratch project with the same compiler options. The gate is `.mjs` under `allowJs`, and `OPEN_RECORD_V1`'s optional `fields` are read through the test's own `sub()` helper, so strict mode sees no possibly-undefined access. A line that names only `agent/src/`, or a module that is not installed, comes from the worktree's install. A line naming `measure-history.test.ts` is this task's.

- [ ] **Step 6: Measure every guard red, then green.** From the repository root, in the foreground, with a timeout of at least 600000 ms. The harness is a quoted heredoc, so the shell expands nothing in it. Each mutant applies one exact replacement to `deploy/history-gate.mjs`, asserted to match once, then runs one filter through vitest with an argv list (no shell). The harness restores the file in a `finally` and asserts that the bytes are back. It prints one line per mutant and ends with `NOT RED: none`.

```bash
python3 - <<'EOF'
import subprocess, sys
GATE = 'deploy/history-gate.mjs'
TEST = 'test/measure-history.test.ts'
# (id, old, new, -t filter): one exact replacement each, asserted to match once.
MUTANTS = [
 ('M1', "    else if (pred.bootstrap.seed !== r.bootstrap.seed) refuse('bootstrap.seed', 'seed-changed');\n", "", 'a seed change across a supersede is refused'),
 ('M2', "    ['k', r.k, K], ", "    ", 'a fixed field moved off its module constant is refused'),
 ('M3', "    ['active_rule.legacy_excluded', r.active_rule.legacy_excluded, true],\n", "", 'legacy_excluded other than true'),
 ('M4', "  if (!SHA_MIN_PREFIXES.includes(r.labeller.sha_min_prefix)) refuse('labeller.sha_min_prefix', 'value-outside-set');\n", "", 'sha_min_prefix 7 and 40 pass'),
 ('M5', "  if (!RUBRIC_IDS.includes(r.rubric_id)) refuse('rubric_id', 'value-outside-set');\n", "", 'a rubric id outside RUBRIC_IDS'),
 ('M6', "  if (!WRITER_INPUTS.includes(r.quiz.writer_input)) refuse('quiz.writer_input', 'value-outside-set');\n", "", 'a writer input outside WRITER_INPUTS'),
 ('M6b', "  if (r.counters_def.id !== 'v1') refuse('counters_def.id', 'value-outside-set');\n", "", 'a counters_def id other than v1'),
 ('M7', "export const EXACT_MODEL_ID_RE = /^claude-[a-z]+(?:-[a-z]+)*(?:-[0-9]+)+$/;", "export const EXACT_MODEL_ID_RE = /^claude-/;", 'alias-shaped'),
 ('M8', "role === 'arm_model' ? ARM_MODEL_FORBIDDEN_RE.test(id) : ", "role === 'arm_model' ? false : ", 'a Fable arm model is refused'),
 ('M9', ": !OPUS_MODEL_RE.test(id)) refuse(role, 'model-forbidden');", ": false) refuse(role, 'model-forbidden');", 'a non-Opus judge or writer'),
 ('M10a', "  if (r.answer_protocol_sha256 !== ANSWER_PROTOCOL_SHA256) refuse('answer_protocol_sha256', 'signed-text-mismatch');\n", "", 'a signed text changed without a record change'),
 ('M10b', "  if (r.writer_prompt_sha256 !== WRITER_PROMPT_SHA256) refuse('writer_prompt_sha256', 'signed-text-mismatch');\n", "", 'a signed text changed without a record change'),
 ('M10c', "  if (RUBRIC_IDS.includes(r.rubric_id) && r.rubric_sha256 !== RUBRIC_SHA256[r.rubric_id]) refuse('rubric_sha256', 'signed-text-mismatch');\n", "", 'a signed text changed without a record change'),
 ('M10d', "  if (r.counters_def.sha256 !== COUNTERS_DEF_V1_SHA256) refuse('counters_def.sha256', 'signed-text-mismatch');\n", "", 'a signed text changed without a record change'),
 ('M11', ", ['pilot', r.pilot]];", "];", 'a step 0a entry or the pilot whose code shas'),
 ('M12', "    if (s.release_stamp !== r.gate_code.release_tag) refuse(`${p}.release_stamp`, 'release-mismatch');\n", "", 'a step 0a entry or the pilot whose code shas'),
 ('M13', "    ['pilot.used.writer_input', used.writer_input, r.quiz.writer_input],\n", "", 'a pilot section signed under other settings'),
 ('M14', "  if (!recSame([...new Set(quizKeys)].sort(), [...new Set(frozen.families.map(recKeyOf))].sort())) refuse('quiz.families', 'quiz-mismatch');\n", "", 'inconsistent with the frozen file'),
 ('M15', "a.store_id === q.store_id && a.ccrc_id === q.ccrc_id)", "a.store_id === q.store_id && a.ccrc_id === q.ccrc_id && a.generation === q.generation)", 'hold a control-assigned family'),
 ('M16', "    if (pilotKeys.has(recKeyOf(q))) refuse(`quiz.families[${i}]`, 'pilot-quiz-overlap');\n", "", 'a pilot family in the quiz is refused'),
 ('M17a', "lengthMs > plannedMs + RECORD_DAY_MS", "lengthMs > plannedMs + 2 * RECORD_DAY_MS", 'the window is planned_days long'),
 ('M17b', "lengthMs < plannedMs ||", "lengthMs < plannedMs - RECORD_DAY_MS ||", 'the window is planned_days long'),
 ('M18a', "  r.assignment.forEach((a, i) => { if (a.arm !== armOf(seed, a)) refuse(`assignment[${i}].arm`, 'assignment-mismatch'); });\n", "", 'a tampered arm is refused'),
 ('M18b', "  if (!recSame(r.assignment, assignArms(seed, r.assignment.map(recRefOf)))) refuse('assignment', 'assignment-mismatch');\n", "", 'a tampered arm is refused'),
 ('M18c', "  if (r.assignment_sha256 !== assignmentSha256(r.assignment)) refuse('assignment_sha256', 'assignment-mismatch');\n", "", 'a tampered arm is refused'),
 ('M19', "r.finalized_ms >= pred.window.start_ms", "r.finalized_ms > pred.window.start_ms", 'any other change after window start is refused'),
 ('M20a', "    for (const k of [...keys].sort()) if (!REC_AMEND_FREE.includes(k) && !recSame(r[k], pred[k])) refuse(k, 'post-start-change');\n", "", 'any other change after window start is refused'),
 ('M20b', "    if (!recSame(r.amendments.slice(0, pred.amendments.length), pred.amendments)) refuse('amendments', 'post-start-change');\n", "", 'a rewritten earlier amendment is refused'),
 ('M21', "    if (!AMENDMENT_KINDS.includes(a.kind)) refuse(", "    if (false) refuse(", 'an amendment kind outside AMENDMENT_KINDS'),
 ('M22', "a.kind === 'version-move' && !REC_TYPE_OK.hex64(a.detail.repilot_sha256)", "false", 'a version move without a re-pilot sha'),
 ('M23', "    for (const k of Object.keys(mine)) if (k !== 'bootstrap' && !recSame(mine[k], theirs[k])) refuse(k, 'draft-mismatch');\n", "", 'part 1 fields differ from its draft'),
 ('M24', "    if (pred.part !== record.part || !recValidate", "    if (!recValidate", 'a predecessor of the other part'),
 ('M24b', "  else if (draft.bootstrap.seed !== r.bootstrap.seed) refuse('bootstrap.seed', 'seed-changed');\n", "", 'a seed change across a supersede is refused'),
 ('M25', "typeof shas?.[f] === 'string' && ", "", 'checkGateCode names each mismatched file'),
 ('M25b', " && typeof gateCode?.files?.[f] === 'string'", "", 'checkGateCode names each mismatched file'),
 ('M25c', "  if (unmeasured.length > 0) return { ok: false, word: 'code-unmeasured', unmeasured: [...unmeasured] };\n", "", 'checkGateCode names each mismatched file'),
 ('M26', "refuse('window', 'window-length')", "refuse('window', 'window-too-short')", 'GATE_REASONS word|the window is planned_days long'),
 ('M27', "    if (!Object.hasOwn(value, k)) refuse(p, 'field-missing');\n    else recFieldErrors(value[k], f, p, refuse);", "    if (!Object.hasOwn(value, k)) continue;\n    recFieldErrors(value[k], f, p, refuse);", 'a missing field is field-missing'),
 ('M28', "    name: 'echo_hits',", "    name: 'echo-hits',", 'COUNTERS_DEF_V1 names exactly'),
 ('M29', "  if (!REC_TYPE_OK[f.type](v)) { refuse(p, 'field-malformed'); return; }", "  if (!REC_TYPE_OK[f.type](v)) return;", 'a missing field is field-missing'),
 # W2-D25's 2026-10-19 amendment: closed, chained, self-checking, a required context, W2-4's step 0a shape
 ('M30', "  for (const k of Object.keys(value)) if (!Object.hasOwn(spec, k)) refuse(path === '' ? k : `${path}.${k}`, 'field-unknown');\n", "", 'a field outside the schema is field-unknown'),
 ('M31', "    if (a.detail_sha256 !== sha256Hex(canonicalJson(a.detail))) refuse(`amendments[${i}].detail_sha256`, 'amendment-detail-mismatch');\n", "", "detail_sha256 is not its detail"),
 ('M32', "    if (r.supersedes === null ? prior !== null : r.supersedes !== recordSha256(prior)) refuse('supersedes', 'chain-mismatch');\n", "", "is not the superseded record's sha"),
 ('M33', "  if (!REC_TYPE_OK.object(ctx)) { refuse('ctx', 'field-missing'); return done(); }", "  if (!REC_TYPE_OK.object(ctx)) ctx = { draft: null, predecessor: null, frozen: null };", 'a null or missing validation context is refused'),
 ('M34', "  if (final && ctx.draft === null) refuse('ctx.draft', 'field-missing');\n", "", 'a null or missing validation context is refused'),
 ('M35', "    writer_init: recField('object', 'measured'),\n", "    writer_init: recField('object', 'measured', { nullable: true }),\n", "the step 0a entry is W2-4's producer shape"),
 ('M36', "  if (v === null) { refuse(p, 'field-missing'); return; }   // null carries no value: a part 1 writer_init among them\n", "", "the step 0a entry is W2-4's producer shape"),
 ('M37', "    flags_accepted: recField('object', 'measured', { values: recField('boolean', 'measured') }),\n", "    flags_accepted: recField('object', 'measured'),\n", "the step 0a entry is W2-4's producer shape"),
 ('M38', "  if (checkLink && !final && r.supersedes !== null && ctx.predecessor === null) refuse('ctx.predecessor', 'field-missing');\n", "", "is not the superseded record's sha"),
 # the coordinator's final W2-3/W2-4 plan review: step 0a bound to a node and to part 1's settings mode, a rejected flag
 # refused with no exception (the settings-mode ruling), recordSha256's newline
 ('M39', "    if (!nodeStores.has(s.store_id)) refuse(`step0a[${i}].store_id`, 'value-outside-set');\n", "", 'names no node of part 1'),
 ('M40', "      if (accepted === false) refuse(", "      if (false) refuse(", 'is flag-rejected'),
 ('M41', "    if (s.settings_mode !== r.settings_mode) refuse(`step0a[${i}].settings_mode`, 'value-outside-set');\n", "", 'settings_mode differs from part 1'),
 ('M42', "      if (accepted === false) refuse(", "      if (accepted === false && !(flag === '--restricted' && r.settings_mode === 'fallback')) refuse(", 'is flag-rejected'),
 ('M43', "  return sha256Hex(canonicalJson(record) + '\\n');\n", "  return sha256Hex(canonicalJson(record));\n", 'a valid chain passes'),
]
orig = open(GATE).read()
reds = []
try:
    for (mid, old, new, filt) in MUTANTS:
        assert orig.count(old) == 1, (mid, orig.count(old))
        open(GATE, 'w').write(orig.replace(old, new))
        out = subprocess.run(['./node_modules/.bin/vitest', 'run', TEST, '-t', filt], cwd='server',
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=600).stdout
        tests = next((l.strip() for l in out.splitlines() if l.strip().startswith('Tests ')), 'no Tests line')
        first = next((l.strip() for l in out.splitlines() if 'Error:' in l), '')
        print(mid, '|', tests, '|', first[:160], flush=True)
        if ' failed' not in tests:
            reds.append(mid)
finally:
    open(GATE, 'w').write(orig)
assert open(GATE).read() == orig
print('NOT RED:', reds if reds else 'none')
EOF
git diff --stat -- deploy/history-gate.mjs   # only this task's section (and earlier tasks', if not yet committed)
```

Expected: every line names `failed`, and the last line is `NOT RED: none`. These were measured against the stand-ins, and the skipped counts differ in the real file, which holds Tasks 1 to 8's cases:
- `M1`, `M24b` and `M29`: `1 failed`, `expected [] to deeply equal [ { path: 'bootstrap.seed', …(1) } ]`. `M1` and `M24b` fail the seed-change case (draft to draft, and draft to final). `M29` fails the missing-field case's malformed-seed assertion.
- `M2`: `1 failed | 13 passed`, on the `k` row.
- `M3`, `M4`, `M5`, `M6`, `M6b`: `1 failed` each, on `legacy_excluded`, `sha_min_prefix`, `rubric_id`, `quiz.writer_input` and `counters_def.id`.
- `M7`: `5 failed | 2 passed`. `claude-opus`, `claude-opus-latest`, the `[1m]` suffix, the dotted version and the arm/judge case go red; `opus` and the provider prefix still fail `^claude-`.
- `M8` and `M9`: `1 failed` each, at `arm_model` and `judge_model`.
- `M10a` to `M10d`: `1 failed | 3 passed` each, one per signed text.
- `M11` and `M12`: `1 failed` each, at `pilot.code_shas` and at a `release_stamp`.
- `M13`: `1 failed | 6 passed`, on the `writer_input` row.
- `M14`: `1 failed`, at `quiz.families`.
- `M15`: `1 failed`, `[ { path: 'quiz.families[<n>]', …(1) } ]`. Only the other-generation control family goes red.
- `M16`: `1 failed`.
- `M17a` and `M17b`: `1 failed` each, at `window` (15 days plus 1 ms, and 13 days).
- `M18a`, `M18b`, `M18c`: `1 failed` each, at `assignment[<i>].arm`, `assignment` and `assignment_sha256`.
- `M19` and `M20a`: `1 failed` each, at `window`. `M19` is the boundary instant; `M20a` is any post-start change.
- `M20b`: `1 failed`, at `amendments`.
- `M21` and `M22`: `1 failed` each.
- `M23`: `1 failed`, at `arm_model`.
- `M24`: `1 failed`, at `supersedes`.
- `M25`, `M25b` and `M25c` (predicted: the code-unmeasured ruling rewrote `checkGateCode` and its case after `M25` was measured as `1 failed`, `expected { ok: true } to deeply equal { ok: false, …(2) }`): `1 failed` each. `M25` reads a sha absent from the measured side as a mismatch (`code-changed` where `code-unmeasured` is expected); `M25b` does the same for a sha absent from `gate_code`; `M25c` drops the unmeasured answer, so an absent sha is compared and answered `code-changed`.
- `M26`: `2 failed`. One is `Error: history-gate: 'window-too-short' is not a GATE_REASONS word`; the other is the source scan.
- `M27`: `1 failed`, at `account`.
- `M28`: `1 failed`, `expected [ 'compliance', 'echo-hits', …(4) ] to deeply equal [ 'compliance', 'echo_hits', …(4) ]`.
- W2-D25's 2026-10-19 amendment, measured on a scratch tree of `7d01973a2` holding Tasks 2 to 9's gate sections exactly as this plan writes them, with Tasks 5, 8 and 9's describes in one scratch test file (every mutant above was re-run there too, `M14`, `M23`, `M24` and `M24b` at their re-anchored text, and each went red as listed; `NOT RED: none`):
  - `M30`: `1 failed`, `expected [] to deeply equal [ { path: 'extra', …(1) } ]`.
  - `M31`: `1 failed`, `expected [] to deeply equal [ { …(2) } ]`, at `amendments[0].detail_sha256`.
  - `M32`: `1 failed`, `expected [] to deeply equal [ { path: 'supersedes', …(1) } ]` (a superseding draft whose `supersedes` is not its predecessor's sha).
  - `M33`: `1 failed`, `expected { ok: true } to deeply equal { ok: false, errors: [ { …(2) } ] }`.
  - `M34`: `1 failed`, `TypeError: Cannot read properties of null (reading 'part')` (a final with no draft reaches the draft checks).
  - `M35` and `M36`: `1 failed` each, at `step0a[0].writer_init`: `M35` answers `expected [] to deeply equal [ { …(2) } ]`, `M36` `expected [ { …(2) } ] to deeply equal [ { …(2) } ]` (`field-malformed` for `field-missing`).
  - `M37`: `1 failed`, `expected [] to deeply equal [ { …(2) } ]`, at `step0a[0].flags_accepted.--verbose`.
  - `M38`: `1 failed`, `a superseding draft needs its predecessor supplied: expected [ { path: 'supersedes', …(1) } ] to deeply equal [ { path: 'ctx.predecessor', …(1) } ]`.
- The coordinator's final W2-3/W2-4 plan review (2026-10-19), all predicted:
  - `M39`: `1 failed`, `expected [] to deeply equal [ { path: 'step0a[1].store_id', …(1) } ]`.
  - `M40`: `1 failed`, `expected [] to deeply equal [ { path: 'step0a[0].flags_accepted.--verbose', …(1) } ]` (no flag is refused).
  - `M41`: `1 failed`, `expected [] to deeply equal [ { path: 'step0a[1].settings_mode', …(1) } ]` (a step 0a entry under another settings mode than part 1's passes).
  - `M42`: `1 failed`, `the fallback excuses no flag, --restricted included: expected [] to deeply equal [ { path: 'step0a[1].flags_accepted.--restricted', …(1) } ]` (the withdrawn exception put back).
  - `M43`: `1 failed`, `a record's sha is its canonical JSON and one newline: expected '…' to be '…'`. The chain stays green under it, since `final()` and the validator share the one function, so only the pinned bytes catch it.

Then run Step 5's first command once more: green, `69 passed` (predicted).

- [ ] **Step 7: Run the neighbours that read this file.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 2')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
```

Expected: green (predicted; the gate's import block is unchanged, and the section adds no lib-exported name and no class word):
- Task 2's purity pin: the section holds none of `process.`, `Date.now`, `new Date`, `Math.random`, `performance.`, `require(`, `import(`. This was checked by grep on the section.
- Task 2's O14 local half: none of this task's exported or module-local names is a lib export.
- Task 2's W2-D12 declaration pin: the test imports `FACT_KINDS` through `gate9` and declares neither `FACT_KINDS` nor `LABELS`.
- Task 2's class-word guard: the section spells `opus` and `fable` and neither of the other two class words, so the class-enumeration scan's `every` stays false for the gate.
- `single-definition.test.ts` green unedited, its O14 and class-enumeration describes included.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-gate.mjs server/test/measure-history.test.ts
git commit -m "feat(history): the open record's schema and validator, gate_code check and frozen counter definitions (W2-3 Task 9, D-5781)"
```

---

## Deviations found

- **D-5770** — `history-w2-window-in-node` (Task 1): W2-D13 and W2-D14 move the W2 window statistic out of `deploy/measure-history.py`. The script now prints only raw rows: per listed family its `arm IS NULL` calls and its main boundaries, and per boundary every holding copy's lines, rows (capped by a required `--row-cap`, flagged `truncated`) and models. `deploy/history-gate.mjs` builds each window in Node over K = 10 assistant turns (Task 1 here, Task 3 for the builder). A window ends exclusive at turn K+1's first row or at the next main boundary, whichever is earlier. It is `unmeasured` when the cap cut its copy before turn K+1 was seen. O52's W2 row is re-pinned against the Node builder: the raw rows in Task 1 and the totals in Task 3. This departs from three spec passages. §10.2 "The queries" (`:2734-2737`) says the window statistic is "run by `measure-history.py`", over "the first K = 10 assistant entries after its summary row", counting calls "up to the 10th assistant entry's (or the copy's last row, when fewer)". §10.2 "The instruments" (`:2620-2624`) describes the script as printing "counters and … the queries below". O52 (`:2459`) has "the W2 window statistic, computed from fixture rows by the queries §10.2 names". Errata E12 and E14 (decisions §6) are amended in place by W2-1.
- **D-5772** — `history-w2-o32-raw-models` (Task 1): W2-D16 narrows O32. `measure-history.py` now reads `entries.model` and prints its strings raw: each copy's `rows` carry the model, and `models` is the copy's distinct witnesses, made distinct in SQL. The script never tests, compares or classifies a model. A window's producer is folded in Node through `lib.producerOf` (W2-D15). O32's literal-absence pin (`claude`, `startswith`, `<synthetic>`) stays, and a no-classification pin is added: no comparison or membership test on a value named model or models, and no `K =` binding, with a CONTROL on the `7d01973a2` K line. This departs from spec O32 (`:2439`: "it reads `<counter>:<backend>` rows only") and from §10.2 `:2624` ("Backend strata arrive already folded into counter names by the sweep"). Erratum E13 (decisions §6) is amended in place by W2-1.
- **D-5774** — `history-w2-deploy-local-vocabularies` (Task 2): The gate's closed word sets are frozen once in `deploy/history-gate.mjs`, not in `ccd/history/lib.mjs`. They are `GATE_REASONS`, `FACT_KINDS`, `LABELS`, `RUBRIC_IDS`, the closed `SUBSTREAMS` list, and the other sets Task 2 declares. W2-4's `DRIVER_REASONS` lives in `history-replay.mjs` under the same ruling. This departs from spec §13:3051, "Every vocabulary is enumerated once in `lib.mjs`". Erratum E15, which W2-1 amends, reads that sentence as "every ccd/history vocabulary". The ground is W2-D12: lib's `REASONS` is the CLI's vocabulary (history-skill.test.ts:175-178), and W2 adds only CLI words to it. Two pins hold it. Task 2's W2-D12 pin fails if a second file under `deploy/` or `server/test/` declares `FACT_KINDS` or `LABELS`; importing them is allowed. It carries one named, live-checked exemption for `LABELS`, `server/test/collectLaneFixture.ts`, whose unrelated `const LABELS` predates W2; the coordinator accepted that exemption as a named, live-checked one (2026-10-19). The O14 local half fails if the gate declares any name that lib exports. O14's existing `DECL_CORPUS` scan already covers `deploy/`.
- **D-5775** — `history-w2-quiz-no-decisions` (Task 2): `FACT_KINDS = ['sha','path','command','error']`, so the quiz never sources a decision. This departs from spec §10.2:2638, "Each asks for an exact fact F (a command, path, SHA, error string or decision)". The ground is W2-D60. Nothing mines a decision mechanically. The spec's "matched by string" (§10.2:2706) has no whole-fact form for prose, so no labeller could score one. Part 1 records `quiz.kinds`. Bringing decisions back would need a new kind, a variant rule, a labeller and a new record version. Erratum E17 (amended by W2-1) carries the spec change. Task 2's exact-value pin and its `not.toContain('decision')` assertion fail on any fifth kind (mutant M15, measured).
- **D-5771** — `history-w2-window-copy-rule` (Task 3): W2-D15 splits the copy rule in two. A boundary's producer stratum now reads `lib.pickHoldingCopy`'s copy (live first, then the smallest file_id; §6.1 "The copy", the copy derive.mjs:316 reads), so a window's stratum equals its leaf's producer (RA-10's parity pin). The window keeps W1's longest-copy rule (the greatest `after_count`), and its ties now go to lib's rule instead of the lowest file_id alone. This departs from W1's single documented rule in measure-history.py's docstring at 7d01973a2 ("the copy holding a boundary is the ingest file holding it with the most rows after it (ties: the lowest file_id)"). It also departs from spec §10.2:2737, which names one "copy that holds it" for both the window and its producer (§10.2:2730). RA-11's `copy_short` is dropped as moot. W2-1 amends the spec sentence (erratum E12). One residual is named, by the coordinator's ruling: the copy's `models` start after W1's summary row (the first `is_compact_summary` row after the boundary, Task 1), while derive reads lib's anchor-based `summaryRowFor`, so the two producers can differ when an assistant row with a non-unknown model lies between a boundary and its summary row. Producer strata are report-only and never gate, so W1's rule is kept and RA-10's parity fixtures stay off that shape.
- **D-5773** — `history-w2-legacy-families-excluded` (Task 4): legacy `''` families are never active at W2 open.
  - **The rule (W2-D20).** Every legacy `''` family is excluded from the families active at W2 open, and this is fixed. A legacy family is one whose generation does not match lib's `UUID_RE`. `activeFamilies` gives it the reason `legacy` whatever its recency. The open record's `active_rule.legacy_excluded` is fixed `true`, and Task 9's validator refuses `false`.
  - **What it departs from.** It departs from spec §10.2:2727, "`recall-off/<id>` is assigned by coin flip over the families active at W2 open", which excludes no family. It also narrows §10.2:2732's mapping of "A `''` family merged during the window … to its generation through `merged_into`" to rows a re-key has already merged. The census excludes those rows as `merged` and folds them into their target through `merged_generations`.
  - **Why.**
    - A re-key mid-window would leave a legacy family's control file stale with no change row.
    - The W2 flow cannot write a legacy control file: `--generation` takes only a lowercase UUID (W2-D27), and `marker --section ab` always prints one (W2-D84).
  - **Sign-off and text.** The operator confirms the exclusion by signing part 1, and the ruling's "no exemptions" is struck. W2 open is defined as each node's census instant T0. The spec text is erratum E16, which W2-1 amends.
- **D-5776** — `history-w2-answer-field` (Task 7): W2-D64 scores only the value on the last `^ANSWER:[ \t]*(.*)$` line (`parseAnswerField`), and `ANSWER_PROTOCOL` is appended after the question. This departs from spec §10.2:2706, which labels `correct` as "the exact fact, matched by string" across the whole answer, and from §10.2:2632, where reconstruction item 3 is "the question" alone. No whole-answer scorer is built. The operator confirms the departure by signing `answer_protocol_sha256` in part 1, and W2-5b amends erratum E22 in place.
- **D-5777** — `history-w2-sha-prefix-correct` (Task 7): W2-D63's `labelCorrect` scores a SHA answer correct when its one bounded hex run agrees with F on min(|r|, |F|) characters and that minimum is at least `shaMinPrefix`. At the default 7, a 7-character prefix of a longer F, or a 40-character SHA for a 9-character F, is therefore correct. This loosens spec §10.2:2706's "`correct`: the exact fact, matched by string". The departure is void if the operator signs `sha_min_prefix: 40`: `quiz-source` then samples only 40-character SHA facts, and r must cover all of F. W2-5b amends erratum E22 in place.
- **D-5778** — `history-w2-rubric-residual-uncertain` (Task 7): both of W2-D79's signed rubrics, `RUBRICS` v1 and v1-strict, label several candidates, refusals, consistent but incomplete values and no answer as `uncertain`. Spec §10.2:2707 defines `uncertain` only as "the answer states it does not know" and leaves those cases unlabelled. So under either `rubric_id` the label is widened, and criterion 2's numerator (the `fabricated` count) is narrowed. W2-5b amends erratum E22 in place.
- **D-5779** — `history-w2-writer-excerpt` (Task 7): W2-D72's default `writer_input: 'excerpt'` gives the question writer a different input from spec §10.2:2655's "The question writer sees F and its span". It sees F and a redacted window of 4,000 characters of the raw leaf that holds F_raw, centred on its first occurrence, plus the paired tool_use for a tool_result, 8 KiB in all. W2-3 ships `WRITER_PROMPT`, `parseQuestionLine` and the `writer_input` words, and W2-5a ships the spawn. The departure is void if the operator signs `'leaf-span'`. W2-5b amends erratum E20 in place.
- **D-5781** — `history-w2-pilot-families-in-marker` (Task 9): W2-D76 rules that during the pilot `~/.ccrc/history/headless-on` lists exactly the pilot families (`marker --section pilot`). The marker is removed after the pilot and rewritten with the quiz pairs only after part 2. The pilot families are recorded in part 1 as `pilot.families`, disjoint from the quiz. This departs from spec §10.2:2683, "The operator writes `headless-on` for the window, listing the quiz's families from the W2 open record (§8.2)": for the pilot, the marker lists families that are not the quiz's and are signed before any quiz exists. W2-3 is the first PR in merge order to ship any part of it. Its part is the `pilot.families` field in `OPEN_RECORD_V1` (part 1, `status: 'measured'`), which is the list the pilot marker is printed from, and `validateOpenRecord`'s `pilot-quiz-overlap` refusal (W2-D76 "disjoint from the quiz", with W2-D77's exclusion). W2-5b ships `marker --section pilot` and amends erratum E21 in place, citing this number. §8.2:1526 still holds: the marker still lists exactly the families it arms.

Tasks 5, 6 and 8 define no D-number. The `empty-arm` halt and the `question-not-run` refusal (Task 8), the `window-mismatch` refusal against the record's window (Tasks 1 and 5) and the validator's `field-unknown`, `amendment-detail-mismatch`, `flag-rejected`, step 0a node and settings-mode binding, chain and context rules (Task 9) are the coordinator's 2026-10-19 amendments to W2-D89, W2-D13, W2-D22 and W2-D25, not departures from them, and carry no number.
